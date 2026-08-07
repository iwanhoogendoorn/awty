import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import { keepOpenOnBackgroundClick } from "../modalUtils";
import { allCategories } from "../../bookings/types";
import { countAttachmentsNamed } from "../../bookings/bookingWriter";
import type { AwtySettings, Trip } from "../../types";
import { AttachmentField } from "../components/attachmentField";
import { COMMON_CURRENCIES, formatMoney, parseAmount } from "../../util/money";
import { formatDate, isValidISODate, todayISO } from "../../util/dates";
import type { PriceQuote, PriceTrack } from "../../planning/priceWatch";

/**
 * Logging a price you just looked up.
 *
 * Short on purpose: this gets filled in with a booking site open in the other
 * window, and anything that takes longer than pasting a screenshot will not
 * get done a second time — which is the time that matters, because one price
 * is a number and two are a trend.
 */
export class PriceQuoteModal extends Modal {
  private submitting = false;
  private draft: PriceQuote;
  private attachments!: AttachmentField;
  private saveBtn: ButtonComponent | null = null;
  /** Held so picking a track to re-check can fill them in without a re-render. */
  private labelInput: HTMLInputElement | null = null;
  private categoryEl: HTMLSelectElement | null = null;
  private currencyEl: HTMLSelectElement | null = null;

  constructor(
    app: App,
    private settings: AwtySettings,
    private trip: Trip,
    private onSubmit: (quote: PriceQuote, files: File[]) => Promise<void>,
    /** Existing quotes, so re-checking a price can reuse its label. */
    private tracks: PriceTrack[],
    initial?: Partial<PriceQuote>,
    /** Offered only when editing an existing quote. */
    private onDelete?: () => void,
  ) {
    super(app);
    this.draft = {
      id: "",
      checkedOn: todayISO(),
      category: "Transport",
      label: "",
      amount: 0,
      currency: settings.defaultCurrency,
      provider: "",
      url: "",
      note: "",
      screenshots: [],
      ...initial,
    };
  }

  private get editing(): boolean {
    return Boolean(this.onDelete);
  }

  onOpen(): void {
    keepOpenOnBackgroundClick(this);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("awty-modal");
    contentEl.createEl("h2", {
      text: this.editing ? "Edit price check" : "Log a price check",
      cls: "awty-modal-title",
    });
    contentEl.createDiv({ cls: "awty-wizard-sub", text: this.trip.title });

    // Re-checking something already being watched is the common case, and it
    // only works if the label matches exactly — so it is picked, not retyped.
    if (this.tracks.length > 0 && !this.editing) this.renderAgainRow(contentEl);

    const what = new Setting(contentEl)
      .setName("What did you price?")
      .setDesc("Be specific and reuse the wording — checks with the same name are tracked together.");
    what.nameEl.createSpan({ cls: "awty-required", text: "*" });
    what.addText((t) => {
      this.labelInput = t.inputEl;
      t.setPlaceholder("Return flights AMS→DPS, 17–31 Aug, 2 adults");
      t.setValue(this.draft.label);
      t.onChange((v) => (this.draft.label = v.trim()));
      window.setTimeout(() => t.inputEl.focus(), 0);
    });

    const price = new Setting(contentEl).setName("Price");
    price.nameEl.createSpan({ cls: "awty-required", text: "*" });
    price
      .addText((t) => {
        t.setPlaceholder("1245,00");
        if (this.draft.amount > 0) t.setValue(String(this.draft.amount));
        t.inputEl.inputMode = "decimal";
        t.onChange((v) => (this.draft.amount = parseAmount(v) ?? 0));
      })
      .addDropdown((dd) => {
        this.currencyEl = dd.selectEl;
        for (const c of new Set([this.draft.currency, ...COMMON_CURRENCIES])) dd.addOption(c, c);
        dd.setValue(this.draft.currency);
        dd.onChange((v) => (this.draft.currency = v));
      });

    // The date the price was seen, not the date it is for: a quote is only
    // worth anything if you know how old it is.
    const when = new Setting(contentEl)
      .setName("Checked on")
      .setDesc("The day you saw this price.");
    const date = when.controlEl.createEl("input", { cls: "awty-date-input" });
    date.type = "date";
    date.value = this.draft.checkedOn;
    date.addEventListener("change", () => (this.draft.checkedOn = date.value));

    new Setting(contentEl).setName("Category").addDropdown((dd) => {
      this.categoryEl = dd.selectEl;
      const used = this.tracks.map((t) => t.category);
      for (const c of allCategories(this.settings.customCategories, [
        this.draft.category,
        ...used,
      ])) {
        dd.addOption(c, c);
      }
      dd.setValue(this.draft.category);
      dd.onChange((v) => (this.draft.category = v));
    });

    new Setting(contentEl)
      .setName("Where")
      .setDesc("Who was quoting, and the page you found it on.")
      .addText((t) => {
        t.setPlaceholder("Skyscanner");
        t.setValue(this.draft.provider);
        t.onChange((v) => (this.draft.provider = v.trim()));
      })
      .addText((t) => {
        t.setPlaceholder("https://…");
        t.setValue(this.draft.url);
        t.onChange((v) => (this.draft.url = v.trim()));
      });

    new Setting(contentEl).setName("Note").addTextArea((ta) => {
      ta.setPlaceholder("Basic fare, no bags. Price jumped after the school holidays went on sale.");
      ta.inputEl.rows = 2;
      ta.setValue(this.draft.note);
      ta.onChange((v) => (this.draft.note = v.trim()));
    });

    this.attachments = new AttachmentField(contentEl, {
      label: "Screenshot of the price",
      baseName: `${this.trip.title} price`,
      startIndex: countAttachmentsNamed(
        this.app,
        this.settings,
        this.trip,
        `${this.trip.title} price`,
      ),
      existing: this.draft.screenshots,
      onRemoveExisting: (removed) => {
        this.draft.screenshots = this.draft.screenshots.filter((p) => p !== removed);
      },
    });

    const nav = new Setting(contentEl);
    if (this.onDelete) {
      nav.addButton((btn) =>
        btn
          .setButtonText("Delete")
          .setWarning()
          .onClick(() => {
            this.close();
            this.onDelete?.();
          }),
      );
    }
    nav
      .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((btn) => {
        this.saveBtn = btn;
        btn
          .setButtonText(this.editing ? "Save changes" : "Log price")
          .setCta()
          .onClick(() => void this.submit());
      });
  }

  /**
   * One button per thing already being watched.
   *
   * Copies its label, category and currency across, so the second check lands
   * on the same track as the first instead of starting a new one a word apart —
   * which would leave two half-histories and no trend in either.
   */
  private renderAgainRow(parent: HTMLElement): void {
    const section = parent.createDiv({ cls: "awty-section" });
    section.createDiv({ cls: "awty-section-label", text: "Checking one of these again?" });
    const row = section.createDiv({ cls: "awty-pill-row" });

    for (const track of this.tracks) {
      const btn = row.createEl("button", { cls: "awty-pill is-quote" });
      btn.type = "button";
      btn.createSpan({ text: track.label });
      btn.createSpan({
        cls: "awty-pill-note",
        text: `was ${formatMoney({ amount: track.latest.amount, currency: track.currency })} on ${formatDate(track.latest.checkedOn)}`,
      });
      btn.addEventListener("click", (evt) => {
        evt.preventDefault();
        this.draft.label = track.label;
        this.draft.category = track.category;
        this.draft.currency = track.currency;
        // Set the fields rather than re-rendering: rebuilding the modal would
        // orphan the attachment field's paste listener on the document.
        if (this.labelInput) this.labelInput.value = track.label;
        if (this.categoryEl) this.categoryEl.value = track.category;
        if (this.currencyEl) this.currencyEl.value = track.currency;
        for (const other of Array.from(row.children)) other.removeClass("is-active");
        btn.addClass("is-active");
      });
    }
  }

  private async submit(): Promise<void> {
    if (this.submitting) return;
    if (!this.draft.label) {
      new Notice("Say what you priced — that name is how the checks are grouped.");
      return;
    }
    if (!Number.isFinite(this.draft.amount) || this.draft.amount <= 0) {
      new Notice("Enter a price above zero.");
      return;
    }
    if (!isValidISODate(this.draft.checkedOn)) {
      new Notice("Pick the date you checked the price.");
      return;
    }

    this.submitting = true;
    this.saveBtn?.setDisabled(true).setButtonText("Saving…");
    try {
      await this.onSubmit({ ...this.draft }, this.attachments.getFiles());
      this.close();
    } catch (err) {
      new Notice(err instanceof Error ? err.message : "Could not save the price check.");
      console.error("[awty]", err);
      this.submitting = false;
      this.saveBtn?.setDisabled(false).setButtonText(this.editing ? "Save changes" : "Log price");
    }
  }

  onClose(): void {
    this.attachments?.destroy();
    this.contentEl.empty();
  }
}
