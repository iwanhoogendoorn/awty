import { App, Modal, Setting, setIcon } from "obsidian";
import { keepOpenOnBackgroundClick } from "../modalUtils";
import type TravelPlannerPlugin from "../../main";
import type { Trip } from "../../types";
import { SUB_NOTE_LABELS, kindDef } from "../../types";
import { formatDateRange } from "../../util/dates";
import { formatMoney, formatTotals, sumMoney } from "../../util/money";

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
    private plugin: TravelPlannerPlugin,
    private trip: Trip,
  ) {
    super(app);
  }

  onOpen(): void {
    keepOpenOnBackgroundClick(this);
    this.modalEl.addClass("tp-modal-shell");
    // Wizards launched from here change the answers, so redraw when they land.
    this.unsubscribe = this.plugin.store.onChange(() => this.render());
    this.render();
  }

  onClose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.contentEl.empty();
  }

  /** Re-reads the trip, since a wizard may have renamed or moved it. */
  private currentTrip(): Trip {
    return (
      this.plugin.store.getTrips().find((t) => t.folderPath === this.trip.folderPath) ?? this.trip
    );
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

    const bookings = plugin.bookings.getBookings(trip);
    const of = (kind: string) => bookings.filter((b) => b.kind === kind);
    const flights = [...of("flight"), ...of("transport")];
    const stays = of("stay");
    const activities = of("activity");

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
        done: Boolean(trip.city || trip.country),
        summary: [formatDateRange(trip.startDate, trip.endDate), [trip.city, trip.country].filter(Boolean).join(", ")]
          .filter(Boolean)
          .join(" · "),
        action: () => plugin.openEditTripModal(trip),
        actionLabel: "Edit",
        applies: true,
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
        key: "event",
        title: "Event details",
        detail: "Venue, doors, tickets.",
        icon: "ticket",
        done: progressOf("event-details")?.state !== "empty" && has("event-details"),
        summary: progressOf("event-details")?.detail ?? "Not started",
        action: () => plugin.openNoteWizard(trip, "event-details"),
        actionLabel: "Fill in",
        applies: def.hasVenue,
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
            : `${activities.length} booked`,
        action: () => plugin.openBookingWizard(trip, "activity"),
        actionLabel: activities.length ? "Add another" : "Add",
        applies: true,
      },
      {
        key: "itinerary",
        title: "Day by day",
        detail: "Plan out what happens when.",
        icon: "calendar-days",
        done: (progressOf("itinerary")?.state ?? "empty") !== "empty",
        summary: progressOf("itinerary")?.detail ?? "Not started",
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
        key: "budget",
        title: "Budget",
        detail: "What you plan to spend, against what you have.",
        icon: "wallet",
        done: budget.size > 0,
        summary:
          budget.size === 0
            ? "No budget set"
            : `${formatTotals(spent, formatMoney({ amount: 0, currency: plugin.bookings.getCurrency(trip) }))} of ${formatMoney({ amount: [...budget.values()].reduce((n, v) => n + v, 0), currency: plugin.bookings.getCurrency(trip) })}`,
        action: () => plugin.openBudgetModal(trip),
        actionLabel: budget.size ? "Edit" : "Set",
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

  private render(): void {
    const trip = this.currentTrip();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-modal", "tp-plan");

    const head = contentEl.createDiv({ cls: "tp-wizard-head" });
    setIcon(head.createDiv({ cls: "tp-wizard-icon" }), kindDef(trip.kind).icon);
    const headText = head.createDiv();
    headText.createDiv({ cls: "tp-modal-title", text: `Plan ${trip.title}` });
    headText.createDiv({
      cls: "tp-wizard-sub",
      text: formatDateRange(trip.startDate, trip.endDate),
    });

    const steps = this.buildSteps(trip);
    const done = steps.filter((s) => s.done).length;

    const progress = contentEl.createDiv({ cls: "tp-plan-progress" });
    progress.createSpan({ text: `${done} of ${steps.length} done` });
    const track = progress.createDiv({ cls: "tp-bar-track" });
    const fill = track.createDiv({ cls: "tp-bar-fill is-good" });
    fill.style.width = `${Math.round((done / Math.max(1, steps.length)) * 100)}%`;

    contentEl.createDiv({
      cls: "tp-plan-note",
      text: "Nothing here is required. Fill in what you know and come back when you know more.",
    });

    const list = contentEl.createDiv({ cls: "tp-plan-list" });
    for (const step of steps) {
      const row = list.createDiv({ cls: `tp-plan-row${step.done ? " is-done" : ""}` });

      const mark = row.createDiv({ cls: `tp-mark ${step.done ? "is-complete" : "is-empty"}` });
      setIcon(mark, step.done ? "check" : "x");

      const icon = row.createDiv({ cls: "tp-plan-icon" });
      setIcon(icon, step.icon);

      const text = row.createDiv({ cls: "tp-plan-text" });
      text.createDiv({ cls: "tp-plan-title", text: step.title });
      text.createDiv({ cls: "tp-plan-summary", text: step.summary || step.detail });

      const btn = row.createEl("button", {
        cls: `tp-plan-btn${step.done ? "" : " is-cta"}`,
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
