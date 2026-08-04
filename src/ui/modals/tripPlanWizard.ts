import { App, Modal, Setting, setIcon } from "obsidian";
import { keepOpenOnBackgroundClick } from "../modalUtils";
import type AwtyPlugin from "../../main";
import type { Trip } from "../../types";
import {
  SUB_NOTE_LABELS,
  joinPlaces,
  kindDef,
  tripCities,
  tripCountries,
  tripStops,
} from "../../types";
import { daysBetween, formatDateRange } from "../../util/dates";
import { formatMoney, formatTotals, sumMoney } from "../../util/money";
import { checkVisa, exceedsAllowance } from "../../travel/visa";
import { entryExtrasFor } from "../../data/entryExtras";
import { ADVICE_MEANING } from "../../travel/advice";

interface Step {
  key: string;
  title: string;
  detail: string;
  icon: string;
  done: boolean;
  /** What you'd say out loud about this step's current state. */
  summary: string;
  action: () => void;
  actionLabel: string;
  /** Steps that don't apply to this kind of trip are left out entirely. */
  applies: boolean;
}

/**
 * The master planning flow.
 *
 * Real trips are not planned in one sitting: you know where and when long
 * before you know the flight number, and the hotel is booked weeks before you
 * think about a packing list. So this is a checklist rather than a linear
 * wizard — it opens after a trip is created, can be reopened any time, and each
 * step is optional and resumable. Nothing here blocks on anything else.
 */
export class TripPlanWizard extends Modal {
  private unsubscribe: (() => void) | null = null;

  constructor(
    app: App,
    private plugin: AwtyPlugin,
    private trip: Trip,
  ) {
    super(app);
  }

  onOpen(): void {
    keepOpenOnBackgroundClick(this);
    this.modalEl.addClass("awty-modal-shell");
    // Wizards launched from here change the answers, so redraw when they land.
    this.unsubscribe = this.plugin.store.onChange(() => this.render());
    this.render();
    // Progress comes from file reads the dashboard normally triggers. Opened
    // fresh after a reload, the cache is empty and every note read as "Not
    // started" — so the wizard fills the cache itself and paints once more.
    void this.hydrate();
  }

  onClose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.contentEl.empty();
  }

  /**
   * Re-reads the trip, since a wizard may have renamed or moved it.
   *
   * Matching on the folder alone found nothing once an edit moved the trip to
   * a new folder, and fell back to the object captured when the wizard opened
   * — so every later step used the old title, dates and paths. The note itself
   * survives the move, so its path is what identifies the trip.
   */
  private currentTrip(): Trip {
    const trips = this.plugin.store.getTrips();
    const found =
      trips.find((t) => t.file.path === this.trip.file.path) ??
      trips.find((t) => t.folderPath === this.trip.folderPath);
    if (found) this.trip = found;
    return this.trip;
  }

  private buildSteps(trip: Trip): Step[] {
    const { plugin } = this;
    const def = kindDef(trip.kind);
    const notes = plugin.store.getSubNotes(trip);
    const has = (id: string) => notes.some((n) => n.id === id);
    const progressOf = (id: string) => {
      const note = notes.find((n) => n.id === id);
      return note ? plugin.progress.peek(note.file) : null;
    };

    // A cancelled flight is not a planned flight; counting it kept the step
    // green after the only booking behind it was struck through.
    const bookings = plugin.bookings.getBookings(trip).filter((b) => b.status !== "cancelled");
    const of = (kind: string) => bookings.filter((b) => b.kind === kind);
    const flights = [...of("flight"), ...of("transport")];
    const stays = of("stay");
    const activities = of("activity");

    // Entry requirements and safety advice, which are the two things that can
    // stop a trip happening at all.
    const passports = (
      trip.passports.length > 0 ? trip.passports : plugin.settings.passportCountries
    ).filter(Boolean);
    const checks = tripCountries(trip).flatMap((country) =>
      passports.map((passport) => checkVisa(passport, country)),
    );
    const tripDays = daysBetween(trip.startDate, trip.endDate);
    const blocking = checks.filter((c) => c.actionNeeded || exceedsAllowance(c, tripDays));
    const advice = tripCountries(trip)
      .map((country) => plugin.peekAdvice(country))
      .find((hit) => hit !== null);
    // An arrival card is not a visa, so "no visa needed" is not "nothing to
    // do" — and this step is the one that claims a trip is ready to take.
    const extras = tripCountries(trip)
      .flatMap((country) => entryExtrasFor(country))
      .filter((extra) => extra.status === "required");
    const needsNoAction = blocking.length === 0 && extras.length === 0;

    const documentSummary = (() => {
      const parts: string[] = [];
      if (checks.length === 0) parts.push("No passport set");
      else if (blocking.length > 0) parts.push(`${blocking[0].label} for ${blocking[0].passport}`);
      else parts.push("No visa needed");
      if (extras.length === 1) parts.push(extras[0].name);
      else if (extras.length > 1) parts.push(`${extras.length} arrival formalities`);
      if (advice) parts.push(`advice ${ADVICE_MEANING[advice.colour].label.toLowerCase()}`);
      else parts.push("advice not checked");
      return parts.join(" · ");
    })();

    const budget = plugin.bookings.getBudget(trip);
    const spent = sumMoney(
      plugin.bookings.getCostLines(trip).filter((l) => l.counted).map((l) => l.money),
    );

    return [
      {
        key: "basics",
        title: "Where and when",
        detail: "Destination, dates and what kind of trip this is.",
        icon: "map-pin",
        done: tripStops(trip).some((stop) => stop.city || stop.country),
        summary: [formatDateRange(trip.startDate, trip.endDate), [joinPlaces(tripCities(trip)), joinPlaces(tripCountries(trip))].filter(Boolean).join(", ")]
          .filter(Boolean)
          .join(" · "),
        action: () => plugin.openEditTripModal(trip),
        actionLabel: "Edit",
        applies: true,
      },
      {
        key: "documents",
        title: "Documents & advice",
        detail: "Visas, and the current government travel advice.",
        icon: "shield-check",
        done: needsNoAction && advice !== null,
        summary: documentSummary,
        action: () => {
          for (const country of tripCountries(trip)) {
            void plugin.refreshAdvice(country, () => this.render());
          }
        },
        actionLabel: advice ? "Re-check" : "Check",
        applies: tripCountries(trip).length > 0,
      },
      {
        key: "getting-there",
        title: "Getting there",
        detail: "Flights, trains, buses — anything that moves you.",
        icon: "plane",
        done: flights.length > 0,
        summary:
          flights.length === 0
            ? "Nothing booked"
            : `${flights.length} booking${flights.length === 1 ? "" : "s"}`,
        action: () => plugin.openBookingWizard(trip, "flight"),
        actionLabel: flights.length ? "Add another" : "Add",
        applies: true,
      },
      {
        key: "stay",
        title: "Where to stay",
        detail: "Hotels, apartments, anywhere with a check-in time.",
        icon: "bed",
        done: stays.length > 0,
        summary:
          stays.length === 0 ? "Nothing booked" : stays.map((s) => s.title).join(", "),
        action: () => plugin.openBookingWizard(trip, "stay"),
        actionLabel: stays.length ? "Add another" : "Add",
        applies: !def.singleDay || def.hasVenue === false,
      },
      {
        key: "activities",
        title: "What to do",
        detail: "Tours, tickets, museums, the things you're going for.",
        icon: "map",
        done: activities.length > 0,
        summary:
          activities.length === 0
            ? "Nothing booked"
            : `${activities.length} booked · ${activities.filter((a) => !a.slot).length} not on a day yet`,
        action: () => plugin.openBookingWizard(trip, "activity"),
        actionLabel: activities.length ? "Add another" : "Add",
        applies: true,
      },
      {
        key: "itinerary",
        title: "Day by day",
        detail: "Put the activities you added onto the days you will do them.",
        icon: "calendar-days",
        done: (progressOf("itinerary")?.state ?? "empty") !== "empty",
        summary: (() => {
          const planned = progressOf("itinerary")?.detail ?? "Not started";
          const loose = activities.filter((a) => !a.slot).length;
          return loose > 0 ? `${planned} · ${loose} activity to place` : planned;
        })(),
        action: () => plugin.openNoteWizard(trip, "itinerary"),
        actionLabel: "Add a day",
        applies: has("itinerary"),
      },
      {
        key: "food",
        title: "Where to eat",
        detail: "Restaurants worth booking ahead.",
        icon: "utensils",
        done: (progressOf("food")?.state ?? "empty") !== "empty",
        summary: progressOf("food")?.detail ?? "Not started",
        action: () => plugin.openNoteWizard(trip, "food"),
        actionLabel: "Book a table",
        applies: has("food"),
      },
      {
        key: "getting-around",
        title: "Getting around",
        detail: "How far the hotel is from the airport, your activities and the restaurants.",
        icon: "route",
        done: plugin.travelPlaces.has(trip.folderPath),
        summary: !plugin.travel.isConfigured()
          ? "Needs a Google API key in settings"
          : plugin.travelPlaces.has(trip.folderPath)
            ? "Distances worked out"
            : "Not calculated yet",
        action: () =>
          plugin.travel.isConfigured()
            ? void plugin.computeTravelTimes(trip, () => this.render())
            : plugin.openSettings(),
        actionLabel: plugin.travel.isConfigured() ? "Calculate" : "Settings",
        applies: stays.length > 0,
      },
      {
        key: "budget",
        title: "Budget",
        detail: "What you plan the trip to cost, against what it does.",
        icon: "wallet",
        done: plugin.bookings.getBudgetTotal(trip) > 0,
        summary:
          plugin.bookings.getBudgetTotal(trip) === 0
            ? "No budget set"
            : `cost ${formatTotals(spent, formatMoney({ amount: 0, currency: plugin.bookings.getCurrency(trip) }))} of ${formatMoney({ amount: plugin.bookings.getBudgetTotal(trip), currency: plugin.bookings.getCurrency(trip) })} budget`,
        action: () => plugin.openBudgetModal(trip),
        actionLabel: plugin.bookings.getBudgetTotal(trip) > 0 ? "Edit" : "Set",
        applies: has("budget"),
      },
      {
        key: "packing",
        title: "Packing",
        detail: "Quantities worked out from the length of the trip.",
        icon: "luggage",
        done: (progressOf("packing")?.state ?? "empty") !== "empty",
        summary: progressOf("packing")?.detail ?? "Not started",
        action: () => plugin.openNoteWizard(trip, "packing"),
        actionLabel: "Fill in",
        applies: has("packing"),
      },
    ].filter((step) => step.applies);
  }

  private async hydrate(): Promise<void> {
    let changed = false;
    for (const sub of this.plugin.store.getSubNotes(this.currentTrip())) {
      if (this.plugin.progress.peek(sub.file)) continue;
      try {
        await this.plugin.progress.get(sub.file, sub.id);
        changed = true;
      } catch (err) {
        console.error(`[awty] could not read ${sub.file.path}`, err);
      }
    }
    if (changed) this.render();
  }

  private render(): void {
    const trip = this.currentTrip();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("awty-modal", "awty-plan");

    const head = contentEl.createDiv({ cls: "awty-wizard-head" });
    setIcon(head.createDiv({ cls: "awty-wizard-icon" }), kindDef(trip.kind).icon);
    const headText = head.createDiv();
    headText.createDiv({ cls: "awty-modal-title", text: `Plan ${trip.title}` });
    headText.createDiv({
      cls: "awty-wizard-sub",
      text: formatDateRange(trip.startDate, trip.endDate),
    });

    const steps = this.buildSteps(trip);
    const done = steps.filter((s) => s.done).length;

    const progress = contentEl.createDiv({ cls: "awty-plan-progress" });
    progress.createSpan({ text: `${done} of ${steps.length} done` });
    const track = progress.createDiv({ cls: "awty-bar-track" });
    const fill = track.createDiv({ cls: "awty-bar-fill is-good" });
    fill.style.width = `${Math.round((done / Math.max(1, steps.length)) * 100)}%`;

    contentEl.createDiv({
      cls: "awty-plan-note",
      text: "Nothing here is required. Fill in what you know and come back when you know more.",
    });

    const list = contentEl.createDiv({ cls: "awty-plan-list" });
    for (const step of steps) {
      const row = list.createDiv({ cls: `awty-plan-row${step.done ? " is-done" : ""}` });

      const mark = row.createDiv({ cls: `awty-mark ${step.done ? "is-complete" : "is-empty"}` });
      setIcon(mark, step.done ? "check" : "x");

      const icon = row.createDiv({ cls: "awty-plan-icon" });
      setIcon(icon, step.icon);

      const text = row.createDiv({ cls: "awty-plan-text" });
      text.createDiv({ cls: "awty-plan-title", text: step.title });
      text.createDiv({ cls: "awty-plan-summary", text: step.summary || step.detail });

      const btn = row.createEl("button", {
        cls: `awty-plan-btn${step.done ? "" : " is-cta"}`,
        text: step.actionLabel,
      });
      btn.addEventListener("click", () => step.action());
    }

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText(done === steps.length ? "All done" : "Finish later")
        .setCta()
        .onClick(() => this.close()),
    );
  }
}
