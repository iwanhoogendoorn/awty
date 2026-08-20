import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import { keepOpenOnBackgroundClick } from "../modalUtils";
import type { BookingStatus, CostCategory } from "../../bookings/types";
import { BOOKING_STATUSES, allCategories } from "../../bookings/types";
import { countAttachmentsNamed, type ExpenseDraft } from "../../bookings/bookingWriter";
import type { AwtySettings, Trip } from "../../types";
import { AttachmentField } from "../components/attachmentField";
import { RidesField } from "../components/ridesField";
import type { Ride } from "../../bookings/rides";
import {
  RIDES_DESCRIPTION,
  emptyRide,
  meaningfulRides,
  orderRides,
  pricedRides,
  ridesShape,
  ridesTotal,
} from "../../bookings/rides";
import { COMMON_CURRENCIES, formatMoney } from "../../util/money";
import { formatDateRange, isValidISODate, todayISO } from "../../util/dates";

/**
 * The trip's taxis, logged in one sitting.
 *
 * Every other cost here is entered when it is committed to — a flight when you
 * book it, a hotel when you reserve it. Short rides are the opposite: they are
 * paid without a decision and remembered afterwards, from a phone full of
 * receipts, usually on the last evening. One step and one list, because the
 * moment this has to survive is somebody tired going through an app's history.
 *
 * It saves as a single expense whose amount is the total, so the budget gets
 * one Transport line rather than eleven — with every fare still written into
 * the note under it.
 */
export class RidesModal extends Modal {
  private submitting = false;
  private draft: ExpenseDraft;
  private field!: RidesField;
  private attachments!: AttachmentField;
  private saveBtn: ButtonComponent | null = null;
  private summaryEl: HTMLElement | null = null;

  constructor(
    app: App,
    private settings: AwtySettings,
    private trip: Trip,
    currency: string,
    private onSubmit: (draft: ExpenseDraft, files: File[]) => Promise<void>,
    /** Present when an existing log is being added to rather than started. */
    private initial?: Partial<ExpenseDraft>,
    private onDelete?: () => void,
  ) {
    super(app);
    const today = todayISO();
    const inTrip = today >= trip.startDate && today <= trip.endDate;
    const start = isValidISODate(trip.startDate) ? trip.startDate : today;
    this.draft = {
      date: inTrip ? today : start,
      description: RIDES_DESCRIPTION,
      status: "booked",
      amount: 0,
      currency,
      category: "Transport",
      paidBy: "",
      attachments: [],
      rides: [],
      ...initial,
    };
    // A log opened fresh starts on the day you are most likely logging: today
    // if you are still there, the first day of the trip if it is behind you.
    if (this.draft.rides.length === 0) {
      this.draft.rides = [emptyRide(inTrip ? today : start)];
    }
  }

  private get editing(): boolean {
    return this.initial !== undefined;
  }

  onOpen(): void {
    keepOpenOnBackgroundClick(this);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("awty-modal", "awty-wizard");
    this.modalEl.addClass("awty-modal-shell");

    contentEl.createEl("h2", {
      text: this.editing ? "Taxis & rides" : "Log taxis & rides",
      cls: "awty-modal-title",
    });
    contentEl.createDiv({
      cls: "awty-wizard-sub",
      text: `${this.trip.title} · ${formatDateRange(this.trip.startDate, this.trip.endDate)}`,
    });
    contentEl.createDiv({
      cls: "awty-date-readout",
      text: "Every Uber and taxi of the trip, in one line on the budget. Add them whenever — nothing here has to be logged on the day.",
    });

    const list = contentEl.createDiv();
    this.field = new RidesField({
      container: list,
      rides: this.draft.rides,
      defaultDate: this.draft.date,
      currency: () => this.draft.currency,
      onChange: () => this.paintSummary(),
    });

    new Setting(contentEl).setName("Currency").addDropdown((dd) => {
      const options = new Set([this.draft.currency, ...COMMON_CURRENCIES]);
      for (const c of options) dd.addOption(c, c);
      dd.setValue(this.draft.currency);
      dd.onChange((v) => {
        this.draft.currency = v;
        // Every row's cost box is labelled with it, so they all have to redraw.
        this.field = new RidesField({
          container: list,
          rides: this.field.getRides(),
          defaultDate: this.draft.date,
          currency: () => this.draft.currency,
          onChange: () => this.paintSummary(),
        });
        this.paintSummary();
      });
    });

    new Setting(contentEl)
      .setName("Category")
      .setDesc("Which budget line the fares count against.")
      .addDropdown((dd) => {
        for (const c of allCategories(this.settings.customCategories, [this.draft.category])) {
          dd.addOption(c, c);
        }
        dd.setValue(this.draft.category);
        dd.onChange((v) => (this.draft.category = v as CostCategory));
      });

    new Setting(contentEl).setName("Status").addDropdown((dd) => {
      for (const status of BOOKING_STATUSES) dd.addOption(status.id, status.label);
      dd.setValue(this.draft.status);
      dd.onChange((v) => (this.draft.status = v as BookingStatus));
    });

    new Setting(contentEl).setName("Paid by").addText((t) => {
      t.setPlaceholder("Optional");
      t.setValue(this.draft.paidBy);
      t.onChange((v) => (this.draft.paidBy = v.trim()));
    });

    this.attachments = new AttachmentField(contentEl, {
      label: "Receipts",
      baseName: this.trip.title,
      startIndex: countAttachmentsNamed(this.app, this.settings, this.trip, this.trip.title),
      existing: this.draft.attachments,
      onRemoveExisting: (removed) => {
        this.draft.attachments = this.draft.attachments.filter((p) => p !== removed);
      },
    });

    this.summaryEl = contentEl.createDiv({ cls: "awty-rides-summary" });
    this.paintSummary();

    const nav = new Setting(contentEl).setClass("awty-wizard-nav");
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
          .setButtonText(this.editing ? "Save changes" : "Save rides")
          .setCta()
          .onClick(() => void this.submit());
      });
  }

  /** What the log comes to, and which stretch of the trip it covers. */
  private paintSummary(): void {
    if (!this.summaryEl) return;
    this.summaryEl.empty();
    const rides = this.field.getRides();
    const shape = ridesShape(rides);
    if (shape.count === 0) {
      this.summaryEl.setText("Give at least one ride a price before saving.");
      return;
    }
    this.summaryEl.setText(
      `${formatMoney({ amount: shape.total, currency: this.draft.currency })} across ${
        shape.count
      } ride${shape.count === 1 ? "" : "s"}${
        shape.from ? ` · ${formatDateRange(shape.from, shape.to)}` : ""
      }`,
    );
  }

  private async submit(): Promise<void> {
    if (this.submitting) return;
    // Half-typed rows are dropped rather than saved as empty ones: a row with
    // nothing in it is a row you started, not a fare you paid.
    const rides: Ride[] = meaningfulRides(orderRides(this.field.getRides()));
    const priced = pricedRides(rides);
    if (priced.length === 0) {
      new Notice("Give at least one ride a price.");
      return;
    }
    const missing = rides.length - priced.length;
    if (missing > 0) {
      new Notice(
        `${missing} ride${missing === 1 ? " has" : "s have"} no price and will not count towards the total.`,
        6000,
      );
    }

    this.draft.rides = rides;
    this.draft.amount = ridesTotal(rides);
    // The log sits on its first fare, so it lands on the right day of the trip
    // rather than always on day one.
    this.draft.date = priced[0]?.date || this.draft.date;

    this.submitting = true;
    this.saveBtn?.setDisabled(true).setButtonText("Saving…");
    try {
      await this.onSubmit({ ...this.draft }, this.attachments.getFiles());
      this.close();
    } catch (err) {
      new Notice(err instanceof Error ? err.message : "Could not save the rides.");
      console.error("[awty]", err);
      this.submitting = false;
      this.saveBtn?.setDisabled(false).setButtonText(this.editing ? "Save changes" : "Save rides");
    }
  }

  onClose(): void {
    this.attachments?.destroy();
    this.contentEl.empty();
  }
}
