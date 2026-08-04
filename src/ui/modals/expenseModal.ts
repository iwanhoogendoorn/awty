import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import { keepOpenOnBackgroundClick } from "../modalUtils";
import type { CostCategory } from "../../bookings/types";
import { allCategories } from "../../bookings/types";
import { countAttachmentsNamed, type ExpenseDraft } from "../../bookings/bookingWriter";
import type { AwtySettings, Trip } from "../../types";
import { AttachmentField } from "../components/attachmentField";
import { COMMON_CURRENCIES, parseAmount } from "../../util/money";
import { isValidISODate, todayISO } from "../../util/dates";

/**
 * Logging spend as it happens. One step, because standing outside a restaurant
 * is not the moment for a four-page wizard.
 */
export class ExpenseModal extends Modal {
  private submitting = false;
  private draft: ExpenseDraft;
  private attachments!: AttachmentField;
  private saveBtn: ButtonComponent | null = null;

  constructor(
    app: App,
    private settings: AwtySettings,
    private trip: Trip,
    currency: string,
    private onSubmit: (draft: ExpenseDraft, files: File[]) => Promise<void>,
    /** Present when an existing expense is being changed rather than logged. */
    private initial?: Partial<ExpenseDraft>,
    /** Offered only when editing: removes the expense entirely. */
    private onDelete?: () => void,
  ) {
    super(app);
    const today = todayISO();
    // Default to today when you're actually on the trip, otherwise day one.
    const inTrip = today >= trip.startDate && today <= trip.endDate;
    this.draft = {
      date: inTrip ? today : isValidISODate(trip.startDate) ? trip.startDate : today,
      description: "",
      amount: 0,
      currency,
      category: "Food & drink",
      paidBy: "",
      attachments: [],
      ...initial,
    };
  }

  private get editing(): boolean {
    return this.initial !== undefined;
  }

  onOpen(): void {
    keepOpenOnBackgroundClick(this);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("awty-modal");
    contentEl.createEl("h2", {
      text: this.editing ? "Edit expense" : "Log an expense",
      cls: "awty-modal-title",
    });
    contentEl.createDiv({ cls: "awty-wizard-sub", text: this.trip.title });

    new Setting(contentEl).setName("What was it?").addText((t) => {
      t.setPlaceholder("Dinner at Proto");
      t.setValue(this.draft.description);
      t.onChange((v) => (this.draft.description = v.trim()));
      window.setTimeout(() => t.inputEl.focus(), 0);
    });

    new Setting(contentEl)
      .setName("Amount")
      .addText((t) => {
        t.setPlaceholder("62,50");
        if (this.draft.amount > 0) t.setValue(String(this.draft.amount));
        t.inputEl.inputMode = "decimal";
        t.onChange((v) => (this.draft.amount = parseAmount(v) ?? 0));
      })
      .addDropdown((dd) => {
        const options = new Set([this.draft.currency, ...COMMON_CURRENCIES]);
        for (const c of options) dd.addOption(c, c);
        dd.setValue(this.draft.currency);
        dd.onChange((v) => (this.draft.currency = v));
      });

    const dateSetting = new Setting(contentEl).setName("Date");
    const date = dateSetting.controlEl.createEl("input", { cls: "awty-date-input" });
    date.type = "date";
    date.value = this.draft.date;
    date.addEventListener("change", () => (this.draft.date = date.value));

    new Setting(contentEl).setName("Category").addDropdown((dd) => {
      for (const c of allCategories(this.settings.customCategories, [this.draft.category])) {
        dd.addOption(c, c);
      }
      dd.setValue(this.draft.category);
      dd.onChange((v) => (this.draft.category = v as CostCategory));
    });

    new Setting(contentEl).setName("Paid by").addText((t) => {
      t.setPlaceholder("Optional");
      t.setValue(this.draft.paidBy);
      t.onChange((v) => (this.draft.paidBy = v.trim()));
    });

    this.attachments = new AttachmentField(contentEl, {
      label: "Receipt",
      baseName: this.trip.title,
      startIndex: countAttachmentsNamed(this.app, this.settings, this.trip, this.trip.title),
    });

    const nav = new Setting(contentEl);
    if (this.editing && this.onDelete) {
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
          .setButtonText(this.editing ? "Save changes" : "Save expense")
          .setCta()
          .onClick(() => void this.submit());
      });
  }

  private async submit(): Promise<void> {
    if (this.submitting) return;
    if (!this.draft.description) {
      new Notice("Give the expense a description.");
      return;
    }
    if (!Number.isFinite(this.draft.amount) || this.draft.amount <= 0) {
      new Notice("Enter an amount above zero.");
      return;
    }
    if (!isValidISODate(this.draft.date)) {
      new Notice("Pick a valid date.");
      return;
    }

    this.submitting = true;
    this.saveBtn?.setDisabled(true).setButtonText("Saving…");
    try {
      await this.onSubmit({ ...this.draft }, this.attachments.getFiles());
      this.close();
    } catch (err) {
      new Notice(err instanceof Error ? err.message : "Could not save the expense.");
      console.error("[awty]", err);
      this.submitting = false;
      this.saveBtn?.setDisabled(false).setButtonText(this.editing ? "Save changes" : "Save expense");
    }
  }

  onClose(): void {
    this.attachments?.destroy();
    this.contentEl.empty();
  }
}
