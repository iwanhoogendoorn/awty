import { App, Modal, Notice, Setting, TFile, setIcon } from "obsidian";
import { keepOpenOnBackgroundClick } from "../modalUtils";
import type TravelPlannerPlugin from "../../main";
import type { Trip } from "../../types";
import { SUB_NOTE_LABELS } from "../../types";
import type { Booking, DaySlot } from "../../bookings/types";
import { DAY_SLOTS } from "../../bookings/types";
import { assignBookingToDay } from "../../bookings/bookingWriter";
import { insertItineraryDay } from "../../store/noteWriter";
import { emptyDayDates, readDaySections } from "../../store/itinerary";
import { formatMoney } from "../../util/money";
import { datesInRange, isValidISODate, monthName, parseISO, todayISO } from "../../util/dates";

interface Placement {
  date: string;
  slot: DaySlot;
}

type Notes = Record<DaySlot, string>;

/**
 * Plans a day out of the activities you have already added.
 *
 * Holds its own state for the whole session rather than re-reading the vault on
 * every day change. Obsidian's metadata cache updates asynchronously after a
 * write, so reading frontmatter back immediately returned the previous values —
 * which is why a tick vanished the moment you changed day, even once the write
 * itself was correct.
 *
 * Everything saves as it is changed; there is no button to forget to press.
 */
export class AddDayModal extends Modal {
  private trip: Trip | null;
  private date = "";

  /** Activity note path -> where it sits. The authority while this is open. */
  private placements = new Map<string, Placement>();
  /** Per-day prose, read from the note when the trip loads. */
  private notesByDate = new Map<string, Notes>();
  /** Days that already have something written under them. */
  private planned = new Set<string>();

  private dateInput!: HTMLInputElement;
  private daySelect!: HTMLSelectElement;
  private bodyEl!: HTMLElement;
  private statusEl!: HTMLElement;

  private saveTimer = 0;
  private saving = false;
  /** Days edited since the last write, so a flush knows what to persist. */
  private pending = new Set<string>();

  constructor(
    app: App,
    private plugin: TravelPlannerPlugin,
    preselected: Trip | null,
    private onDone: () => void,
  ) {
    super(app);
    this.trip = preselected ?? this.inferTrip();
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

  private activities(): Booking[] {
    if (!this.trip) return [];
    return this.plugin.bookings
      .getBookings(this.trip)
      .filter((b) => b.kind === "activity" && b.status !== "cancelled");
  }

  // ------------------------------------------------------------- lifecycle

  async onOpen(): Promise<void> {
    keepOpenOnBackgroundClick(this);
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
    if (!this.trip) this.trip = trips[0];

    await this.loadTrip();

    new Setting(contentEl).setName("Trip").addDropdown((dd) => {
      for (const trip of trips) dd.addOption(trip.file.path, trip.title);
      dd.setValue(this.trip!.file.path);
      dd.onChange(async (path) => {
        await this.flush();
        this.trip = trips.find((t) => t.file.path === path) ?? this.trip;
        await this.loadTrip();
        this.applyDateBounds();
        this.renderDayOptions();
        this.renderSlots();
      });
    });

    const daySetting = new Setting(contentEl).setName("Day");
    this.daySelect = daySetting.controlEl.createEl("select", { cls: "dropdown" });
    this.daySelect.addEventListener("change", () => this.showDay(this.daySelect.value));

    this.dateInput = daySetting.controlEl.createEl("input", { cls: "tp-date-input" });
    this.dateInput.type = "date";
    this.dateInput.addEventListener("change", () => {
      if (isValidISODate(this.dateInput.value)) this.showDay(this.dateInput.value);
    });

    this.bodyEl = contentEl.createDiv();
    this.applyDateBounds();
    this.renderDayOptions();
    this.renderSlots();

    this.statusEl = contentEl.createDiv({ cls: "tp-autosave" });
    this.setStatus("Changes save as you make them.");

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText("Previous day").onClick(() => this.step(-1)))
      .addButton((btn) => btn.setButtonText("Next day").onClick(() => this.step(1)))
      .addButton((btn) =>
        btn
          .setButtonText("Done")
          .setCta()
          .onClick(async () => {
            await this.flush();
            this.close();
          }),
      );
  }

  /** Seeds this session's state from the trip, once. */
  private async loadTrip(): Promise<void> {
    this.placements.clear();
    this.notesByDate.clear();
    this.planned.clear();
    if (!this.trip) return;

    for (const activity of this.activities()) {
      if (isValidISODate(activity.date) && activity.slot) {
        this.placements.set(activity.file.path, { date: activity.date, slot: activity.slot });
      }
    }

    const file = this.itineraryFile();
    if (file) {
      const content = await this.app.vault.cachedRead(file);
      const empty = emptyDayDates(content);
      for (const date of this.days()) {
        if (!empty.has(date)) this.planned.add(date);
        this.notesByDate.set(date, readDaySections(content, date));
      }
    }

    // Start on the first day that still needs something.
    const today = todayISO();
    const days = this.days();
    this.date =
      days.find((d) => !this.planned.has(d)) ?? days.find((d) => d >= today) ?? days[0] ?? today;
  }

  private itineraryFile(): TFile | null {
    if (!this.trip) return null;
    const file = this.app.vault.getAbstractFileByPath(
      `${this.trip.folderPath}/${SUB_NOTE_LABELS.itinerary}.md`,
    );
    return file instanceof TFile ? file : null;
  }

  private days(): string[] {
    return this.trip ? datesInRange(this.trip.startDate, this.trip.endDate, 90) : [];
  }

  private notes(): Notes {
    let notes = this.notesByDate.get(this.date);
    if (!notes) {
      notes = { morning: "", afternoon: "", evening: "" };
      this.notesByDate.set(this.date, notes);
    }
    return notes;
  }

  // ---------------------------------------------------------------- saving

  private setStatus(text: string): void {
    this.statusEl?.setText(text);
  }

  /** Marks a day dirty and writes it shortly after; typing does not thrash. */
  private scheduleSave(date: string, delay = 500): void {
    this.pending.add(date);
    this.setStatus("Saving…");
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flush(), delay);
  }

  private async flush(): Promise<void> {
    window.clearTimeout(this.saveTimer);
    if (this.saving || this.pending.size === 0) return;

    this.saving = true;
    const dates = [...this.pending];
    this.pending.clear();

    try {
      for (const date of dates) await this.writeDay(date);
      this.plugin.bookings.invalidate();
      this.onDone();
      this.setStatus("Saved.");
      this.renderDayOptions();
    } catch (err) {
      // Put them back so a later flush retries rather than losing the edit.
      for (const date of dates) this.pending.add(date);
      this.setStatus("Could not save — trying again shortly.");
      new Notice(err instanceof Error ? err.message : "Could not save the day.", 8000);
      console.error("[travel-planner]", err);
    } finally {
      this.saving = false;
    }
  }

  private async writeDay(date: string): Promise<void> {
    if (!this.trip || !isValidISODate(date)) return;

    const byPath = new Map(this.activities().map((a) => [a.file.path, a]));
    const notes = this.notesByDate.get(date) ?? { morning: "", afternoon: "", evening: "" };

    const sectionFor = (slot: DaySlot): string => {
      const lines: string[] = [];
      for (const [path, placed] of this.placements) {
        if (placed.date !== date || placed.slot !== slot) continue;
        const activity = byPath.get(path);
        if (activity) lines.push(`- [[${activity.file.basename}]]`);
      }
      const note = notes[slot].trim();
      if (note) lines.push(note);
      return lines.join("\n");
    };

    let file = this.itineraryFile();
    if (!file) {
      file = await this.app.vault.create(
        `${this.trip.folderPath}/${SUB_NOTE_LABELS.itinerary}.md`,
        `---\ntype: itinerary\n---\n\n# Itinerary — ${this.trip.title}\n`,
      );
    }

    // Always replaces: the prose under this day was loaded into the editor, so
    // nothing typed straight into the note is lost.
    await insertItineraryDay(
      this.app,
      file,
      date,
      {
        morning: sectionFor("morning"),
        afternoon: sectionFor("afternoon"),
        evening: sectionFor("evening"),
      },
      true,
    );

    // Push placements onto the activities themselves.
    for (const activity of byPath.values()) {
      const placed = this.placements.get(activity.file.path);
      if (placed?.date === date) {
        await assignBookingToDay(this.app, activity.file, date, placed.slot);
      } else if (!placed && activity.date === date && activity.slot) {
        await assignBookingToDay(this.app, activity.file, activity.date, null);
      }
    }

    const hasContent =
      [...this.placements.values()].some((p) => p.date === date) ||
      Object.values(notes).some((n) => n.trim().length > 0);
    if (hasContent) this.planned.add(date);
    else this.planned.delete(date);
  }

  // ------------------------------------------------------------- rendering

  private step(delta: number): void {
    const days = this.days();
    const next = days[days.indexOf(this.date) + delta];
    if (next) this.showDay(next);
  }

  /** No reload: the state held here is the authority. */
  private showDay(date: string): void {
    if (!isValidISODate(date) || date === this.date) return;
    this.date = date;
    this.renderDayOptions();
    this.renderSlots();
  }

  private renderDayOptions(): void {
    if (!this.daySelect) return;
    this.daySelect.empty();

    for (const [index, date] of this.days().entries()) {
      const parsed = parseISO(date);
      const label = parsed
        ? `Day ${index + 1} · ${parsed.getUTCDate()} ${monthName(date)}`
        : `Day ${index + 1}`;
      const count = [...this.placements.values()].filter((p) => p.date === date).length;
      const suffix = count > 0 ? ` — ${count}` : this.planned.has(date) ? "" : " — empty";
      const option = this.daySelect.createEl("option", { text: label + suffix, value: date });
      if (date === this.date) option.selected = true;
    }
    if (this.dateInput) this.dateInput.value = this.date;
  }

  private applyDateBounds(): void {
    if (!this.trip || !this.dateInput) return;
    if (isValidISODate(this.trip.startDate)) this.dateInput.min = this.trip.startDate;
    if (isValidISODate(this.trip.endDate)) this.dateInput.max = this.trip.endDate;
  }

  private renderSlots(): void {
    this.bodyEl.empty();
    const activities = this.activities();
    const notes = this.notes();

    for (const slot of DAY_SLOTS) {
      const section = this.bodyEl.createDiv({ cls: "tp-slot" });
      section.createDiv({ cls: "tp-section-label", text: slot.label });

      for (const activity of activities) {
        const placed = this.placements.get(activity.file.path);
        const here = placed?.date === this.date && placed.slot === slot.id;
        const elsewhere = placed && placed.date !== this.date ? placed.date : null;

        const row = section.createEl("label", {
          cls: `tp-slot-activity${elsewhere ? " is-elsewhere" : ""}`,
        });
        const box = row.createEl("input");
        box.type = "checkbox";
        box.checked = here;
        box.addEventListener("change", () => {
          // One activity, one slot: ticking it here takes it out of anywhere else.
          const previous = this.placements.get(activity.file.path);
          if (box.checked) {
            this.placements.set(activity.file.path, { date: this.date, slot: slot.id });
          } else {
            this.placements.delete(activity.file.path);
          }

          this.scheduleSave(this.date, 0);
          // A day it was moved off also needs rewriting.
          if (previous && previous.date !== this.date) this.scheduleSave(previous.date, 0);

          this.renderSlots();
          this.renderDayOptions();
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

      const area = section.createEl("textarea", { cls: "tp-slot-notes" });
      area.rows = 2;
      area.placeholder = "Anything else — breakfast, a walk, nothing booked…";
      area.value = notes[slot.id];
      area.addEventListener("input", () => {
        notes[slot.id] = area.value;
        this.scheduleSave(this.date);
      });
    }
  }

  onClose(): void {
    void this.flush();
    this.contentEl.empty();
  }
}
