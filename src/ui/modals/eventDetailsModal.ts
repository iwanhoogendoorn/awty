import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import { keepOpenOnBackgroundClick } from "../modalUtils";
import type { Trip } from "../../types";
import { ensureSubNote, replaceSection, subNoteFile } from "../../store/sectionWriter";

/** Fills in the Event Details note without opening it. */
export class EventDetailsModal extends Modal {
  private fields = {
    venue: "",
    address: "",
    doors: "",
    start: "",
    tickets: "",
    reference: "",
    seat: "",
    lineup: "",
    notes: "",
  };
  private saveBtn: ButtonComponent | null = null;

  constructor(
    app: App,
    private trip: Trip,
    private onSaved: () => void,
  ) {
    super(app);
    this.fields.venue = trip.venue;
  }

  async onOpen(): Promise<void> {
    keepOpenOnBackgroundClick(this);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("awty-modal");
    this.modalEl.addClass("awty-modal-shell");

    contentEl.createEl("h2", { text: "Event details", cls: "awty-modal-title" });
    contentEl.createDiv({ cls: "awty-wizard-sub", text: this.trip.title });

    await this.prefillFromNote();

    const text = (name: string, key: keyof typeof this.fields, placeholder: string) =>
      new Setting(contentEl).setName(name).addText((t) => {
        t.setPlaceholder(placeholder);
        t.setValue(this.fields[key]);
        t.onChange((v) => (this.fields[key] = v.trim()));
      });

    text("Venue", "venue", "Ziggo Dome");
    text("Address", "address", "De Passage 100, Amsterdam");

    const timeRow = new Setting(contentEl).setName("Doors / start");
    for (const key of ["doors", "start"] as const) {
      const input = timeRow.controlEl.createEl("input", { cls: "awty-time-input" });
      input.type = "time";
      input.value = this.fields[key];
      input.setAttribute("aria-label", key === "doors" ? "Doors open" : "Start time");
      input.addEventListener("change", () => (this.fields[key] = input.value));
    }

    text("Tickets", "tickets", "2 × standing");
    text("Booking reference", "reference", "ABC123");
    text("Seat / section", "seat", "Block C, row 4");

    new Setting(contentEl).setName("Line-up").addTextArea((ta) => {
      ta.inputEl.rows = 3;
      ta.setPlaceholder("Support act, main act…");
      ta.setValue(this.fields.lineup);
      ta.onChange((v) => (this.fields.lineup = v));
    });

    new Setting(contentEl).setName("Notes").addTextArea((ta) => {
      ta.inputEl.rows = 2;
      ta.setValue(this.fields.notes);
      ta.onChange((v) => (this.fields.notes = v));
    });

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => {
        this.saveBtn = b;
        b.setButtonText("Save details").setCta().onClick(() => void this.save());
      });
  }

  /** Reads back what a previous run wrote, so editing is editing, not retyping. */
  private async prefillFromNote(): Promise<void> {
    const file = subNoteFile(this.app, this.trip, "event-details");
    if (!file) return;
    const content = await this.app.vault.cachedRead(file);

    const cell = (label: string): string => {
      const match = new RegExp(`\\|\\s*\\*\\*${label}\\*\\*\\s*\\|([^|]*)\\|`, "i").exec(content);
      const value = match?.[1]?.trim() ?? "";
      return value === "_TBC_" ? "" : value;
    };

    this.fields.venue = cell("Venue") || this.fields.venue;
    this.fields.address = cell("Address");
    this.fields.doors = cell("Doors");
    this.fields.start = cell("Start");
    this.fields.tickets = cell("Tickets");
    this.fields.reference = cell("Booking reference");
    this.fields.seat = cell("Seat / standing") || cell("Seat");
  }

  private async save(): Promise<void> {
    this.saveBtn?.setDisabled(true).setButtonText("Saving…");
    try {
      const file = await ensureSubNote(this.app, this.trip, "event-details");
      const f = this.fields;

      const rows: [string, string][] = [
        ["Date", this.trip.startDate],
        ["Venue", f.venue],
        ["Address", f.address],
        ["City", this.trip.city],
        ["Doors", f.doors],
        ["Start", f.start],
        ["Tickets", f.tickets],
        ["Booking reference", f.reference],
        ["Seat / standing", f.seat],
      ].filter(([, value]) => value.length > 0) as [string, string][];

      const table = ["| | |", "|---|---|", ...rows.map(([k, v]) => `| **${k}** | ${v} |`)].join("\n");
      await replaceSection(this.app, file, "Details", table);

      if (f.lineup.trim()) await replaceSection(this.app, file, "Line-up", f.lineup.trim());
      if (f.notes.trim()) await replaceSection(this.app, file, "Notes", f.notes.trim());

      // Venue belongs on the trip too, so the sidebar and search can see it.
      if (f.venue) {
        await this.app.fileManager.processFrontMatter(this.trip.file, (fm) => {
          fm.venue = f.venue;
        });
      }

      new Notice("Event details saved.");
      this.onSaved();
      this.close();
    } catch (err) {
      new Notice(err instanceof Error ? err.message : "Could not save the event details.");
      console.error("[awty]", err);
      this.saveBtn?.setDisabled(false).setButtonText("Save details");
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
