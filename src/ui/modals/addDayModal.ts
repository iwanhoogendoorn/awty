import { App, Modal, Notice, Setting, TFile, setIcon } from "obsidian";
import { keepOpenOnBackgroundClick } from "../modalUtils";
import type TravelPlannerPlugin from "../../main";
import type { Trip } from "../../types";
import { SUB_NOTE_LABELS } from "../../types";
import type { Booking, DaySlot } from "../../bookings/types";
import { DAY_SLOTS } from "../../bookings/types";
import { assignBookingToDay } from "../../bookings/bookingWriter";
import { emptyDayDates, insertItineraryDay } from "../../store/noteWriter";
import { formatMoney } from "../../util/money";
import { datesInRange, isValidISODate, monthName, parseISO, todayISO } from "../../util/dates";

/**
 * Plans a day out of the activities you have already added.
 *
 * "What to do" and "Day by day" used to be two unconnected records of the same
 * plan — you added a museum, then retyped "museum" into a day. Activities are
 * picked here instead, and the choice is written back onto the activity itself,
 * so the booking, the timeline and the itinerary note all agree on when it
 * happens.
 */
export class AddDayModal extends Modal {
  private trip: Trip | null;
  private date: string;
  private notes: Record<DaySlot, string> = { morning: "", afternoon: "", evening: "" };
  /** Activity note path -> the slot it has been put in for this day. */
  private placement = new Map<string, DaySlot>();
  private dateInput!: HTMLInputElement;
  private daySelect!: HTMLSelectElement;
  private bodyEl!: HTMLElement;
  /** Days already carrying content, so the dropdown can mark them. */
  private planned = new Set<string>();

  constructor(
    app: App,
    private plugin: TravelPlannerPlugin,
    preselected: Trip | null,
    private onDone: () => void,
  ) {
    super(app);
    this.trip = preselected ?? this.inferTrip();
    this.date = this.defaultDate();
  }

  private inferTrip(): Trip | null {
    const active = this.app.workspace.getActiveFile();
    if (active) {
      const fromActive = this.plugin.store.getTripForFile(active);
      if (fromActive) return fromActive;
    }
    const trips = this.plugin.store.getTrips();
    return (
      trips.find((t) => t.status === "current") ?? trips.find((t) => t.status === "upcoming") ?? null
    );
  }

  private defaultDate(): string {
    const today = todayISO();
    if (!this.trip) return today;
    if (today >= this.trip.startDate && today <= this.trip.endDate) return today;
    return isValidISODate(this.trip.startDate) ? this.trip.startDate : today;
  }

  private activities(): Booking[] {
    if (!this.trip) return [];
    return this.plugin.bookings
      .getBookings(this.trip)
      .filter((b) => b.kind === "activity" && b.status !== "cancelled");
  }

  async onOpen(): Promise<void> {
    keepOpenOnBackgroundClick(this);
    await this.useFirstUnplannedDay();

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-modal");
    this.modalEl.addClass("tp-modal-shell");
    contentEl.createEl("h2", { text: "Plan a day", cls: "tp-modal-title" });

    const trips = this.plugin.store.getTrips();
    if (trips.length === 0) {
      contentEl.createEl("p", { text: "No trips yet. Create one first." });
      new Setting(contentEl).addButton((b) => b.setButtonText("Close").onClick(() => this.close()));
      return;
    }

    new Setting(contentEl).setName("Trip").addDropdown((dd) => {
      for (const trip of trips) dd.addOption(trip.file.path, trip.title);
      dd.setValue(this.trip?.file.path ?? trips[0].file.path);
      if (!this.trip) this.trip = trips[0];
      dd.onChange(async (path) => {
        this.trip = trips.find((t) => t.file.path === path) ?? null;
        this.date = this.defaultDate();
        await this.useFirstUnplannedDay();
        this.dateInput.value = this.date;
        this.applyDateBounds();
        this.syncPlacement();
        this.renderSlots();
      });
    });

    // Every day of the trip in one dropdown, so planning eight days does not
    // mean opening this eight times.
    const daySetting = new Setting(contentEl).setName("Day");
    this.daySelect = daySetting.controlEl.createEl("select", { cls: "dropdown" });
    this.renderDayOptions();
    this.daySelect.addEventListener("change", () => {
      this.date = this.daySelect.value;
      this.syncPlacement();
      this.renderDayOptions();
      this.renderSlots();
    });

    this.dateInput = daySetting.controlEl.createEl("input", { cls: "tp-date-input" });
    this.dateInput.type = "date";
    this.dateInput.value = this.date;
    this.dateInput.addEventListener("change", () => {
      if (!isValidISODate(this.dateInput.value)) return;
      this.date = this.dateInput.value;
      this.syncPlacement();
      this.renderDayOptions();
      this.renderSlots();
    });
    this.applyDateBounds();

    this.bodyEl = contentEl.createDiv();
    this.syncPlacement();
    this.renderSlots();

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText("Close").onClick(() => this.close()))
      .addButton((btn) =>
        btn.setButtonText("Save day").onClick(() => void this.addDay(false)),
      )
      .addButton((btn) =>
        btn
          .setButtonText("Save & next day")
          .setCta()
          .onClick(() => void this.addDay(true)),
      );
  }

  /** Day 1 … Day N, each marked with whether it has anything in it yet. */
  private renderDayOptions(): void {
    if (!this.trip || !this.daySelect) return;
    this.daySelect.empty();

    const days = datesInRange(this.trip.startDate, this.trip.endDate, 90);
    for (const [index, date] of days.entries()) {
      const parsed = parseISO(date);
      const label = parsed
        ? `Day ${index + 1} · ${parsed.getUTCDate()} ${monthName(date)}`
        : `Day ${index + 1}`;
      const done = this.planned.has(date) ? "" : " — empty";
      const option = this.daySelect.createEl("option", { text: label + done, value: date });
      if (date === this.date) option.selected = true;
    }
    if (this.dateInput) this.dateInput.value = this.date;
  }

  /** Reflect what the activities already say about this date. */
  private syncPlacement(): void {
    this.placement.clear();
    for (const activity of this.activities()) {
      if (activity.date === this.date && activity.slot) {
        this.placement.set(activity.file.path, activity.slot);
      }
    }
  }

  private renderSlots(): void {
    this.bodyEl.empty();
    const activities = this.activities();

    for (const slot of DAY_SLOTS) {
      const section = this.bodyEl.createDiv({ cls: "tp-slot" });
      section.createDiv({ cls: "tp-section-label", text: slot.label });

      for (const activity of activities) {
        const placedIn = this.placement.get(activity.file.path);
        // Already on another day, so it is offered but visibly spoken for.
        const elsewhere =
          activity.date && activity.date !== this.date && activity.slot ? activity.date : null;

        const row = section.createEl("label", {
          cls: `tp-slot-activity${elsewhere ? " is-elsewhere" : ""}`,
        });
        const box = row.createEl("input");
        box.type = "checkbox";
        box.checked = placedIn === slot.id;
        box.addEventListener("change", () => {
          // One activity, one slot: ticking it here takes it out of any other.
          if (box.checked) this.placement.set(activity.file.path, slot.id);
          else this.placement.delete(activity.file.path);
          this.renderSlots();
        });

        row.createSpan({ cls: "tp-slot-activity-name", text: activity.title });
        if (activity.time) row.createSpan({ cls: "tp-slot-activity-meta", text: activity.time });
        if (activity.cost) {
          row.createSpan({ cls: "tp-slot-activity-meta", text: formatMoney(activity.cost) });
        }
        if (elsewhere) row.createSpan({ cls: "tp-slot-activity-meta", text: `on ${elsewhere}` });
      }

      const addRow = section.createDiv({ cls: "tp-slot-add" });
      setIcon(addRow.createSpan(), "plus");
      addRow.createSpan({ text: activities.length ? "Add another activity" : "Add an activity" });
      addRow.addEventListener("click", () => {
        if (this.trip) this.plugin.openBookingWizard(this.trip, "activity");
      });

      const notes = section.createEl("textarea", { cls: "tp-slot-notes" });
      notes.rows = 2;
      notes.placeholder = "Anything else — breakfast, a walk, nothing booked…";
      notes.value = this.notes[slot.id];
      notes.addEventListener("input", () => (this.notes[slot.id] = notes.value));
    }
  }

  /**
   * Trips are created with every day already headed, so "the first day" is
   * almost never the one you still need to plan.
   */
  private async useFirstUnplannedDay(): Promise<void> {
    if (!this.trip) return;
    const file = this.app.vault.getAbstractFileByPath(
      `${this.trip.folderPath}/${SUB_NOTE_LABELS.itinerary}.md`,
    );
    if (!(file instanceof TFile)) return;
    const empty = emptyDayDates(await this.app.vault.cachedRead(file));
    const all = datesInRange(this.trip.startDate, this.trip.endDate, 90);
    this.planned = new Set(all.filter((d) => !empty.has(d)));
    const next = [...empty].sort().find((d) => d >= this.trip!.startDate);
    if (next) this.date = next;
  }

  private applyDateBounds(): void {
    if (!this.trip) return;
    if (isValidISODate(this.trip.startDate)) this.dateInput.min = this.trip.startDate;
    if (isValidISODate(this.trip.endDate)) this.dateInput.max = this.trip.endDate;
  }

  private async addDay(advance: boolean): Promise<void> {
    if (!this.trip) {
      new Notice("Pick a trip first.");
      return;
    }
    if (!isValidISODate(this.date)) {
      new Notice("Pick a valid date.");
      return;
    }

    const byPath = new Map(this.activities().map((a) => [a.file.path, a]));

    // Each activity goes in as a link to its own note, so the itinerary and the
    // booking stay one record rather than two copies of the same plan.
    const sectionFor = (slot: DaySlot): string => {
      const lines: string[] = [];
      for (const [path, placed] of this.placement) {
        if (placed !== slot) continue;
        const activity = byPath.get(path);
        if (activity) lines.push(`- [[${activity.file.basename}]]`);
      }
      const note = this.notes[slot].trim();
      if (note) lines.push(note);
      return lines.join("\n");
    };

    const path = `${this.trip.folderPath}/${SUB_NOTE_LABELS.itinerary}.md`;
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      file = await this.app.vault.create(
        path,
        `---\ntype: itinerary\n---\n\n# Itinerary — ${this.trip.title}\n`,
      );
    }

    const result = await insertItineraryDay(this.app, file as TFile, this.date, {
      morning: sectionFor("morning"),
      afternoon: sectionFor("afternoon"),
      evening: sectionFor("evening"),
    });

    if (result === "duplicate") {
      new Notice(`${this.date} already has plans. Edit the note to change them.`);
      return;
    }

    // Push the placement back onto the activities themselves.
    for (const activity of this.activities()) {
      const placed = this.placement.get(activity.file.path);
      if (placed) {
        await assignBookingToDay(this.app, activity.file, this.date, placed);
      } else if (activity.date === this.date && activity.slot) {
        // Unticked here, so it is no longer part of this day.
        await assignBookingToDay(this.app, activity.file, activity.date, null);
      }
    }

    const placed = this.placement.size;
    new Notice(
      placed > 0
        ? `Planned ${this.date} with ${placed} activit${placed === 1 ? "y" : "ies"}.`
        : `Planned ${this.date}.`,
    );
    this.planned.add(this.date);
    this.plugin.bookings.invalidate();
    this.onDone();

    if (!advance) {
      this.close();
      return;
    }

    // Stay open and step to the next day, so a week is planned in one sitting.
    const days = datesInRange(this.trip.startDate, this.trip.endDate, 90);
    const next = days.find((d) => d > this.date);
    if (!next) {
      new Notice("That was the last day.");
      this.close();
      return;
    }
    this.date = next;
    this.notes = { morning: "", afternoon: "", evening: "" };
    this.syncPlacement();
    this.renderDayOptions();
    this.renderSlots();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
