import { App, ButtonComponent, Modal, Notice, Setting, setIcon } from "obsidian";
import type { BookingKind, BookingStatus, CostCategory } from "../../bookings/types";
import { BOOKING_KINDS, BOOKING_STATUSES, COST_CATEGORIES } from "../../bookings/types";
import type { BookingDraft } from "../../bookings/bookingWriter";
import type { TravelPlannerSettings, Trip } from "../../types";
import { AttachmentField } from "../components/attachmentField";
import { AirlineSuggest } from "../components/suggest";
import { COMMON_CURRENCIES, formatMoney, parseAmount } from "../../util/money";
import { formatDateRange, isValidISODate, todayISO } from "../../util/dates";

type FieldKey = "operator" | "reference" | "from" | "to" | "seat" | "title";

interface FieldSpec {
  key: FieldKey;
  label: string;
  placeholder: string;
}

/** Which detail fields each kind asks for, and what to call them. */
const FIELDS: Record<BookingKind, FieldSpec[]> = {
  flight: [
    { key: "operator", label: "Airline", placeholder: "KLM" },
    { key: "title", label: "Flight number", placeholder: "KL1885" },
    { key: "from", label: "From", placeholder: "Amsterdam (AMS)" },
    { key: "to", label: "To", placeholder: "Dubrovnik (DBV)" },
    { key: "seat", label: "Seat", placeholder: "14A" },
    { key: "reference", label: "Booking reference", placeholder: "ABC123" },
  ],
  stay: [
    { key: "title", label: "Property", placeholder: "Hotel Excelsior" },
    { key: "to", label: "Address", placeholder: "Frana Supila 12, Dubrovnik" },
    { key: "reference", label: "Confirmation number", placeholder: "1234567890" },
  ],
  activity: [
    { key: "title", label: "What", placeholder: "Old town walls walk" },
    { key: "to", label: "Venue", placeholder: "Pile Gate" },
    { key: "seat", label: "Seat / section", placeholder: "Block C, row 4" },
    { key: "reference", label: "Booking reference", placeholder: "ABC123" },
  ],
  transport: [
    { key: "operator", label: "Carrier", placeholder: "FlixBus" },
    { key: "title", label: "Service", placeholder: "Bus 402" },
    { key: "from", label: "From", placeholder: "Dubrovnik bus station" },
    { key: "to", label: "To", placeholder: "Kotor" },
    { key: "seat", label: "Seat", placeholder: "12" },
    { key: "reference", label: "Booking reference", placeholder: "ABC123" },
  ],
};

const STEPS = ["Details", "When", "Cost", "Attachments"] as const;

/**
 * Step-by-step booking capture.
 *
 * The cost entered here is the only place a flight or hotel price is typed —
 * the Costs tab reads it straight off the booking rather than asking for it
 * again in a budget table.
 */
export class BookingWizard extends Modal {
  private step = 0;
  private submitting = false;
  private draft: BookingDraft;
  private attachments!: AttachmentField;
  private bodyEl!: HTMLElement;
  private stepsEl!: HTMLElement;
  private backBtn!: ButtonComponent;
  private nextBtn!: ButtonComponent;
  private amountRaw = "";

  constructor(
    app: App,
    private settings: TravelPlannerSettings,
    private trip: Trip,
    kind: BookingKind,
    private currency: string,
    private stars: { isStarred: (v: string) => boolean; toggle: (v: string) => Promise<void> },
    private onSubmit: (draft: BookingDraft, files: File[]) => Promise<void>,
  ) {
    super(app);
    const start = isValidISODate(trip.startDate) ? trip.startDate : todayISO();
    this.draft = {
      kind,
      status: "booked",
      title: "",
      date: start,
      endDate: kind === "stay" && isValidISODate(trip.endDate) ? trip.endDate : start,
      time: "",
      endTime: "",
      amount: null,
      currency,
      category: BOOKING_KINDS.find((k) => k.id === kind)?.category ?? "Misc",
      reference: "",
      from: "",
      to: "",
      operator: "",
      seat: "",
      notes: "",
      attachments: [],
    };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-modal", "tp-wizard");
    this.modalEl.addClass("tp-modal-shell");

    const def = BOOKING_KINDS.find((k) => k.id === this.draft.kind);
    const head = contentEl.createDiv({ cls: "tp-wizard-head" });
    setIcon(head.createDiv({ cls: "tp-wizard-icon" }), def?.icon ?? "ticket");
    const headText = head.createDiv();
    headText.createDiv({ cls: "tp-modal-title", text: `Add ${def?.label.toLowerCase() ?? "booking"}` });
    headText.createDiv({
      cls: "tp-wizard-sub",
      text: `${this.trip.title} · ${formatDateRange(this.trip.startDate, this.trip.endDate)}`,
    });

    this.stepsEl = contentEl.createDiv({ cls: "tp-wizard-steps" });
    this.bodyEl = contentEl.createDiv({ cls: "tp-wizard-body" });

    // Built once and kept alive across steps so pending files survive Back.
    const hidden = contentEl.createDiv({ cls: "tp-attach-host is-hidden" });
    this.attachments = new AttachmentField(hidden);

    new Setting(contentEl)
      .setClass("tp-wizard-nav")
      .addButton((btn) => {
        this.backBtn = btn;
        btn.setButtonText("Back").onClick(() => this.go(this.step - 1));
      })
      .addButton((btn) => {
        this.nextBtn = btn;
        btn
          .setCta()
          .setButtonText("Next")
          .onClick(() => {
            if (this.step < STEPS.length - 1) this.go(this.step + 1);
            else void this.submit();
          });
      });

    this.go(0);
  }

  private go(step: number): void {
    this.step = Math.max(0, Math.min(STEPS.length - 1, step));
    this.renderSteps();
    this.renderBody();
    this.backBtn.setDisabled(this.step === 0);
    this.nextBtn.setButtonText(this.step === STEPS.length - 1 ? "Save booking" : "Next");
  }

  private renderSteps(): void {
    this.stepsEl.empty();
    for (const [index, name] of STEPS.entries()) {
      const chip = this.stepsEl.createDiv({
        cls: `tp-wizard-step${index === this.step ? " is-active" : ""}${index < this.step ? " is-done" : ""}`,
      });
      chip.createSpan({ cls: "tp-wizard-step-num", text: String(index + 1) });
      chip.createSpan({ cls: "tp-wizard-step-name", text: name });
      chip.addEventListener("click", () => this.go(index));
    }
  }

  private renderBody(): void {
    this.bodyEl.empty();
    if (this.step === 0) this.renderDetails();
    else if (this.step === 1) this.renderWhen();
    else if (this.step === 2) this.renderCost();
    else this.renderAttachments();
  }

  private renderDetails(): void {
    for (const spec of FIELDS[this.draft.kind]) {
      // The airline gets a picker with your starred carriers pinned on top;
      // everything else is a plain text field.
      if (spec.key === "operator" && this.draft.kind === "flight") {
        this.renderAirlineField(spec);
        continue;
      }
      new Setting(this.bodyEl).setName(spec.label).addText((t) => {
        t.setPlaceholder(spec.placeholder);
        t.setValue(this.draft[spec.key]);
        t.onChange((v) => (this.draft[spec.key] = v.trim()));
      });
    }

    new Setting(this.bodyEl).setName("Status").addDropdown((dd) => {
      for (const s of BOOKING_STATUSES) dd.addOption(s.id, s.label);
      dd.setValue(this.draft.status);
      dd.onChange((v) => (this.draft.status = v as BookingStatus));
    });

    new Setting(this.bodyEl).setName("Notes").addTextArea((ta) => {
      ta.inputEl.rows = 2;
      ta.setValue(this.draft.notes);
      ta.onChange((v) => (this.draft.notes = v));
    });
  }

  private renderAirlineField(spec: FieldSpec): void {
    const setting = new Setting(this.bodyEl)
      .setName(spec.label)
      .setDesc("Star the ones you fly and they stay at the top of the list.");

    let input!: HTMLInputElement;
    setting.addText((t) => {
      input = t.inputEl;
      t.setPlaceholder(spec.placeholder);
      t.setValue(this.draft.operator);
      t.onChange((v) => {
        this.draft.operator = v.trim();
        syncStar();
      });
      new AirlineSuggest(
        this.app,
        t.inputEl,
        (value) => this.stars.isStarred(value),
        (value) => {
          this.draft.operator = value;
          syncStar();
        },
      );
    });

    const starBtn = setting.controlEl.createEl("button", {
      cls: "tp-star-btn",
      attr: { "aria-label": "Star this airline" },
    });

    const syncStar = () => {
      const starred = this.draft.operator.length > 0 && this.stars.isStarred(this.draft.operator);
      starBtn.empty();
      setIcon(starBtn, "star");
      starBtn.toggleClass("is-starred", starred);
      starBtn.setAttribute("aria-label", starred ? "Unstar this airline" : "Star this airline");
      starBtn.toggleClass("is-disabled", this.draft.operator.length === 0);
    };

    starBtn.addEventListener("click", async (evt) => {
      evt.preventDefault();
      if (!this.draft.operator) return;
      await this.stars.toggle(this.draft.operator);
      syncStar();
      input.focus();
    });

    syncStar();
  }

  private renderWhen(): void {
    const isStay = this.draft.kind === "stay";
    const wrap = this.bodyEl.createDiv({ cls: "tp-daterange" });

    const dateRow = (
      label: string,
      value: string,
      onChange: (v: string) => void,
      timeLabel: string,
      timeValue: string,
      onTime: (v: string) => void,
    ) => {
      const row = wrap.createDiv({ cls: "tp-date-row" });
      row.createEl("label", { text: label, cls: "tp-date-label" });
      const date = row.createEl("input", { cls: "tp-date-input" });
      date.type = "date";
      date.value = value;
      // Nudge towards the trip's own dates without forbidding anything else.
      if (isValidISODate(this.trip.startDate)) date.min = this.trip.startDate;
      date.addEventListener("change", () => onChange(date.value));

      const time = row.createEl("input", { cls: "tp-time-input" });
      time.type = "time";
      time.value = timeValue;
      time.setAttribute("aria-label", timeLabel);
      time.addEventListener("change", () => onTime(time.value));
    };

    dateRow(
      isStay ? "Check-in" : "Start",
      this.draft.date,
      (v) => {
        this.draft.date = v;
        if (this.draft.endDate < v) this.draft.endDate = v;
      },
      "Start time",
      this.draft.time,
      (v) => (this.draft.time = v),
    );

    dateRow(
      isStay ? "Check-out" : "End",
      this.draft.endDate,
      (v) => (this.draft.endDate = v),
      "End time",
      this.draft.endTime,
      (v) => (this.draft.endTime = v),
    );

    wrap.createDiv({
      cls: "tp-date-readout",
      text: isStay
        ? "Leave check-out the same as check-in for a single night."
        : "Leave the end blank-equal for a one-off departure and arrival on the same day.",
    });
  }

  private renderCost(): void {
    new Setting(this.bodyEl)
      .setName("Cost")
      .setDesc("Entered once here — it flows straight into the trip's Costs tab.")
      .addText((t) => {
        t.setPlaceholder("450");
        t.setValue(this.amountRaw);
        t.inputEl.inputMode = "decimal";
        t.onChange((v) => {
          this.amountRaw = v;
          this.draft.amount = parseAmount(v);
          this.renderCostPreview();
        });
      })
      .addDropdown((dd) => {
        const options = new Set([this.currency, ...COMMON_CURRENCIES]);
        for (const c of options) dd.addOption(c, c);
        dd.setValue(this.draft.currency);
        dd.onChange((v) => {
          this.draft.currency = v;
          this.renderCostPreview();
        });
      });

    new Setting(this.bodyEl)
      .setName("Category")
      .setDesc("Which budget line this counts against.")
      .addDropdown((dd) => {
        const options = new Set<string>([...COST_CATEGORIES, this.draft.category]);
        for (const c of options) dd.addOption(c, c);
        dd.setValue(this.draft.category);
        dd.onChange((v) => (this.draft.category = v as CostCategory));
      });

    this.bodyEl.createDiv({ cls: "tp-cost-preview" });
    this.renderCostPreview();
  }

  private renderCostPreview(): void {
    const el = this.bodyEl.querySelector<HTMLElement>(".tp-cost-preview");
    if (!el) return;
    el.empty();
    if (this.draft.amount === null) {
      el.setText("No cost recorded — the booking still shows up, just not in the totals.");
      return;
    }
    el.setText(
      `${formatMoney({ amount: this.draft.amount, currency: this.draft.currency })} against ${this.draft.category}`,
    );
  }

  private renderAttachments(): void {
    const host = this.contentEl.querySelector<HTMLElement>(".tp-attach-host");
    if (host) {
      host.removeClass("is-hidden");
      this.bodyEl.appendChild(host);
    }

    const summary = this.bodyEl.createDiv({ cls: "tp-wizard-summary" });
    summary.createDiv({ cls: "tp-section-label", text: "Review" });

    const rows: [string, string][] = [
      ["What", this.effectiveTitle()],
      ["When", this.whenSummary()],
      [
        "Cost",
        this.draft.amount === null
          ? "Not recorded"
          : `${formatMoney({ amount: this.draft.amount, currency: this.draft.currency })} · ${this.draft.category}`,
      ],
      ["Status", this.draft.status],
    ];
    for (const [label, value] of rows) {
      const row = summary.createDiv({ cls: "tp-wizard-summary-row" });
      row.createSpan({ cls: "tp-wizard-summary-label", text: label });
      row.createSpan({ cls: "tp-wizard-summary-value", text: value || "—" });
    }
  }

  private whenSummary(): string {
    const range = formatDateRange(this.draft.date, this.draft.endDate);
    const times = [this.draft.time, this.draft.endTime].filter(Boolean).join(" → ");
    return times ? `${range} · ${times}` : range;
  }

  /** Falls back to something readable when the title field was left blank. */
  private effectiveTitle(): string {
    if (this.draft.title) {
      if (this.draft.kind === "flight" && this.draft.from && this.draft.to) {
        return `${this.draft.title} ${this.draft.from} → ${this.draft.to}`;
      }
      return this.draft.title;
    }
    if (this.draft.from && this.draft.to) return `${this.draft.from} → ${this.draft.to}`;
    if (this.draft.operator) return this.draft.operator;
    return BOOKING_KINDS.find((k) => k.id === this.draft.kind)?.label ?? "Booking";
  }

  private async submit(): Promise<void> {
    if (this.submitting) return;
    if (!isValidISODate(this.draft.date)) {
      new Notice("Pick a valid date on the When step.");
      this.go(1);
      return;
    }

    this.submitting = true;
    this.nextBtn.setDisabled(true).setButtonText("Saving…");
    try {
      await this.onSubmit({ ...this.draft, title: this.effectiveTitle() }, this.attachments.getFiles());
      this.close();
    } catch (err) {
      new Notice(err instanceof Error ? err.message : "Could not save the booking.");
      console.error("[travel-planner]", err);
      this.submitting = false;
      this.nextBtn.setDisabled(false).setButtonText("Save booking");
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
