import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import type { TravelPlannerSettings, Trip } from "../../types";
import { appendTableRow, ensureSubNote } from "../../store/sectionWriter";
import { isValidISODate, todayISO } from "../../util/dates";
import { FOODSPOT_COUNTRIES } from "../../data/countries";

/**
 * Books a table without opening the Food note.
 *
 * Restaurant discovery stays Food Spot's job — the generated `foodspot` block
 * already lists everywhere you want to try in this city. This records the ones
 * you have actually reserved.
 */
export class FoodModal extends Modal {
  private place = "";
  private date: string;
  private time = "";
  private bookedBy = "";
  private notes = "";
  private saveBtn: ButtonComponent | null = null;

  constructor(
    app: App,
    private settings: TravelPlannerSettings,
    private trip: Trip,
    private onSaved: () => void,
  ) {
    super(app);
    const today = todayISO();
    const inTrip = today >= trip.startDate && today <= trip.endDate;
    this.date = inTrip ? today : isValidISODate(trip.startDate) ? trip.startDate : today;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-modal");
    this.modalEl.addClass("tp-modal-shell");

    contentEl.createEl("h2", { text: "Book a table", cls: "tp-modal-title" });
    contentEl.createDiv({
      cls: "tp-wizard-sub",
      text: [this.trip.title, this.trip.city].filter(Boolean).join(" · "),
    });

    new Setting(contentEl).setName("Place").addText((t) => {
      t.setPlaceholder("Restaurant name");
      t.onChange((v) => (this.place = v.trim()));
      window.setTimeout(() => t.inputEl.focus(), 0);
    });

    const when = new Setting(contentEl).setName("When");
    const date = when.controlEl.createEl("input", { cls: "tp-date-input" });
    date.type = "date";
    date.value = this.date;
    if (isValidISODate(this.trip.startDate)) date.min = this.trip.startDate;
    if (isValidISODate(this.trip.endDate)) date.max = this.trip.endDate;
    date.addEventListener("change", () => (this.date = date.value));

    const time = when.controlEl.createEl("input", { cls: "tp-time-input" });
    time.type = "time";
    time.setAttribute("aria-label", "Time");
    time.addEventListener("change", () => (this.time = time.value));

    new Setting(contentEl).setName("Booked by").addText((t) => {
      t.setPlaceholder("Optional");
      t.onChange((v) => (this.bookedBy = v.trim()));
    });

    new Setting(contentEl).setName("Notes").addTextArea((ta) => {
      ta.inputEl.rows = 2;
      ta.setPlaceholder("Reference, dress code, table by the window…");
      ta.onChange((v) => (this.notes = v));
    });

    const hint = contentEl.createDiv({ cls: "tp-dash-hint" });
    hint.setText(
      this.trip.city
        ? `Places you still want to try are listed by the Food Spot block in this note, filtered to ${this.trip.city}.`
        : "Set a city on the trip and the Food Spot block will list places to try there.",
    );

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => {
        this.saveBtn = b;
        b.setButtonText("Save booking").setCta().onClick(() => void this.save());
      });
  }

  private async save(): Promise<void> {
    if (!this.place) {
      new Notice("Which place?");
      return;
    }
    this.saveBtn?.setDisabled(true).setButtonText("Saving…");

    try {
      const file = await ensureSubNote(this.app, this.trip, "food");

      // A Food note created before this wizard existed may have no embed yet.
      const content = await this.app.vault.read(file);
      if (this.settings.foodSpotEnabled && !content.includes("```foodspot")) {
        const block = ["```foodspot", `view: ${this.settings.foodSpotView}`];
        if (this.trip.country && FOODSPOT_COUNTRIES.has(this.trip.country)) {
          block.push(`country: ${this.trip.country}`);
        }
        if (this.trip.city) block.push(`city: ${this.trip.city}`);
        block.push("status: want-to-try", "```");
        await this.app.vault.modify(file, `${content.trimEnd()}\n\n${block.join("\n")}\n`);
      }

      await appendTableRow(
        this.app,
        file,
        "Booked",
        ["Date", "Time", "Place", "Booked by", "Notes"],
        [this.date, this.time || "", this.place, this.bookedBy || "", this.notes.replace(/\|/g, "\\|")],
      );

      new Notice(`Booked ${this.place}.`);
      this.onSaved();
      this.close();
    } catch (err) {
      new Notice(err instanceof Error ? err.message : "Could not save the booking.");
      console.error("[travel-planner]", err);
      this.saveBtn?.setDisabled(false).setButtonText("Save booking");
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
