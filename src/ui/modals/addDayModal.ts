import { App, Modal, Notice, Setting, TFile } from "obsidian";
import { keepOpenOnBackgroundClick } from "../modalUtils";
import type { Trip } from "../../types";
import { SUB_NOTE_LABELS } from "../../types";
import type { TripStore } from "../../store/tripStore";
import { emptyDayDates, insertItineraryDay } from "../../store/noteWriter";
import { isValidISODate, todayISO } from "../../util/dates";

/**
 * Adds a day to a trip's itinerary.
 *
 * 1.x refused outright when more than one Itinerary note existed and you didn't
 * happen to have the right one open. This offers a trip picker instead, seeded
 * from the active file when that's unambiguous.
 */
export class AddDayModal extends Modal {
  private trip: Trip | null;
  private date: string;
  private morning = "";
  private afternoon = "";
  private evening = "";
  private dateInput!: HTMLInputElement;

  constructor(
    app: App,
    private store: TripStore,
    preselected: Trip | null,
    private onDone: () => void,
  ) {
    super(app);
    // A caller that already knows the trip shouldn't need the note opened first
    // just so this can guess it back.
    this.trip = preselected ?? this.inferTrip();
    this.date = this.defaultDate();
  }

  private inferTrip(): Trip | null {
    const active = this.app.workspace.getActiveFile();
    if (active) {
      const fromActive = this.store.getTripForFile(active);
      if (fromActive) return fromActive;
    }
    const trips = this.store.getTrips();
    // Fall back to the trip that's happening now, then the next one up.
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

  async onOpen(): Promise<void> {
    keepOpenOnBackgroundClick(this);
    await this.useFirstUnplannedDay();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-modal");
    contentEl.createEl("h2", { text: "Add itinerary day", cls: "tp-modal-title" });

    const trips = this.store.getTrips();
    if (trips.length === 0) {
      contentEl.createEl("p", { text: "No trips yet. Create one first." });
      new Setting(contentEl).addButton((b) => b.setButtonText("Close").onClick(() => this.close()));
      return;
    }

    new Setting(contentEl).setName("Trip").addDropdown((dd) => {
      for (const trip of trips) {
        dd.addOption(trip.file.path, `${trip.title} (${trip.startDate})`);
      }
      dd.setValue(this.trip?.file.path ?? trips[0].file.path);
      if (!this.trip) this.trip = trips[0];
      dd.onChange((path) => {
        this.trip = trips.find((t) => t.file.path === path) ?? null;
        this.date = this.defaultDate();
        void this.useFirstUnplannedDay().then(() => {
          this.dateInput.value = this.date;
        });
        this.dateInput.value = this.date;
        this.applyDateBounds();
      });
    });

    const dateSetting = new Setting(contentEl).setName("Date");
    this.dateInput = dateSetting.controlEl.createEl("input", { cls: "tp-date-input" });
    this.dateInput.type = "date";
    this.dateInput.value = this.date;
    this.dateInput.addEventListener("change", () => {
      if (isValidISODate(this.dateInput.value)) this.date = this.dateInput.value;
    });
    this.applyDateBounds();

    const field = (name: string, onChange: (v: string) => void) =>
      new Setting(contentEl).setName(name).addTextArea((ta) => {
        ta.inputEl.rows = 3;
        ta.setPlaceholder(`${name} plans…`);
        ta.onChange(onChange);
      });

    field("Morning", (v) => (this.morning = v));
    field("Afternoon", (v) => (this.afternoon = v));
    field("Evening", (v) => (this.evening = v));

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((btn) => btn.setButtonText("Add day").setCta().onClick(() => void this.addDay()));
  }

  /** Constrain the picker to the trip's own dates — a nudge, not a hard block. */
  private applyDateBounds(): void {
    if (!this.trip) return;
    if (isValidISODate(this.trip.startDate)) this.dateInput.min = this.trip.startDate;
    if (isValidISODate(this.trip.endDate)) this.dateInput.max = this.trip.endDate;
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
    const next = [...empty].sort().find((d) => d >= this.trip!.startDate);
    if (next) this.date = next;
  }

  private async addDay(): Promise<void> {
    if (!this.trip) {
      new Notice("Pick a trip first.");
      return;
    }
    if (!isValidISODate(this.date)) {
      new Notice("Pick a valid date.");
      return;
    }

    const path = `${this.trip.folderPath}/${SUB_NOTE_LABELS.itinerary}.md`;
    let file = this.app.vault.getAbstractFileByPath(path);

    if (!(file instanceof TFile)) {
      // The trip may have been created without an itinerary; make one rather
      // than dead-ending the user.
      file = await this.app.vault.create(
        path,
        `---\ntype: itinerary\n---\n\n# Itinerary — ${this.trip.title}\n`,
      );
    }

    const result = await insertItineraryDay(this.app, file as TFile, this.date, {
      morning: this.morning,
      afternoon: this.afternoon,
      evening: this.evening,
    });

    if (result === "duplicate") {
      new Notice(`${this.date} already has plans. Edit the note to change them.`);
      return;
    }

    new Notice(
      result === "filled"
        ? `Planned ${this.date} for ${this.trip.title}.`
        : `Added ${this.date} to ${this.trip.title}.`,
    );
    // Stays where you were; open the note yourself if you want to read it.
    this.onDone();
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
