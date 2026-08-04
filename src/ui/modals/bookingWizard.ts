import { App, ButtonComponent, Modal, Notice, Setting, setIcon } from "obsidian";
import type { BookingKind, BookingStatus, CostCategory } from "../../bookings/types";
import { BOOKING_KINDS, BOOKING_STATUSES, COST_CATEGORIES } from "../../bookings/types";
import type { BookingDraft } from "../../bookings/bookingWriter";
import type { TravelPlannerSettings, Trip } from "../../types";
import { AttachmentField } from "../components/attachmentField";
import { AirlineSuggest, AirportSuggest, CitySuggest } from "../components/suggest";
import { LegsField } from "../components/legsField";
import { emptyLeg, routeTitle, totalJourneyMinutes, formatLayover } from "../../bookings/legs";
import { COMMON_CURRENCIES, formatMoney, parseAmount } from "../../util/money";
import { formatDateRange, isValidISODate, todayISO } from "../../util/dates";

type FieldKey = "operator" | "reference" | "from" | "to" | "seat" | "title";

export type StarKind = "airline" | "airport";

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
  private legsField: LegsField | null = null;

  constructor(
    app: App,
    private settings: TravelPlannerSettings,
    private trip: Trip,
    kind: BookingKind,
    private currency: string,
    private stars: {
      isStarred: (kind: StarKind, v: string) => boolean;
      toggle: (kind: StarKind, v: string) => Promise<void>;
    },
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
      legs: kind === "flight" ? [emptyLeg(start)] : [],
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
    if (this.draft.kind === "flight") {
      this.renderFlightLegs();
      this.renderStatusAndNotes();
      return;
    }
    for (const spec of FIELDS[this.draft.kind]) {
      // Anything with a known set of answers gets a picker; only genuinely
      // free-form fields stay as text boxes.
      if ((spec.key === "from" || spec.key === "to") && this.draft.kind === "transport") {
        this.renderCityField(spec);
        continue;
      }
      new Setting(this.bodyEl).setName(spec.label).addText((t) => {
        t.setPlaceholder(spec.placeholder);
        t.setValue(this.draft[spec.key]);
        t.onChange((v) => (this.draft[spec.key] = v.trim()));
      });
    }

    this.renderStatusAndNotes();
  }

  private renderStatusAndNotes(): void {
    new Setting(this.bodyEl).setName("Status").addDropdown((dd) => {
      for (const s of BOOKING_STATUSES) dd.addOption(s.id, s.label);
      dd.setValue(this.draft.status);
      dd.onChange((v) => (this.draft.status = v as BookingStatus));
    });

    if (this.trip.travellers.length > 1) {
      new Setting(this.bodyEl)
        .setName("For")
        .setDesc("Who this booking covers.")
        .addText((t) => {
          t.setPlaceholder(this.trip.travellers.join(", "));
          t.setValue(this.draft.seat);
          t.onChange((v) => (this.draft.seat = v.trim()));
        });
    }

    new Setting(this.bodyEl).setName("Notes").addTextArea((ta) => {
      ta.inputEl.rows = 2;
      ta.setValue(this.draft.notes);
      ta.onChange((v) => (this.draft.notes = v));
    });
  }

  /** Direct or connecting; the editor handles both and works out the layovers. */
  private renderFlightLegs(): void {
    const host = this.bodyEl.createDiv();
    this.legsField = new LegsField({
      app: this.app,
      container: host,
      legs: this.draft.legs,
      defaultDate: this.draft.date,
      stars: this.stars,
      nearby: () => ({ country: this.trip.country, city: this.trip.city }),
      onChange: () => this.syncFromLegs(),
    });
    this.syncFromLegs();
  }

  /** Collapses the legs down to the flat fields the rest of the plugin reads. */
  private syncFromLegs(): void {
    if (!this.legsField) return;
    const legs = this.legsField.getLegs();
    this.draft.legs = legs;
    if (legs.length === 0) return;

    const first = legs[0];
    const last = legs[legs.length - 1];
    this.draft.from = first.from;
    this.draft.to = last.to;
    this.draft.operator = first.operator;
    this.draft.date = first.date || this.draft.date;
    this.draft.time = first.depTime;
    this.draft.endDate = last.arrDate || last.date || this.draft.date;
    this.draft.endTime = last.arrTime;
    if (!this.draft.title) this.draft.title = legs.map((l) => l.number).filter(Boolean).join(" + ");
  }

  /** Text field backed by a picker, with a star button for the ones you reuse. */
  private renderPickerField(spec: FieldSpec, kind: StarKind): void {
    const setting = new Setting(this.bodyEl)
      .setName(spec.label)
      .setDesc(
        kind === "airline"
          ? "Star the airlines you fly and they stay at the top."
          : "Search by code, city or airport name. Star the ones you use often.",
      );

    let input!: HTMLInputElement;
    let syncStar = (): void => {};

    setting.addText((t) => {
      input = t.inputEl;
      t.setPlaceholder(spec.placeholder);
      t.setValue(this.draft[spec.key]);
      t.onChange((v) => {
        this.draft[spec.key] = v.trim();
        syncStar();
      });

      if (kind === "airline") {
        new AirlineSuggest(
          this.app,
          t.inputEl,
          (value) => this.stars.isStarred("airline", value),
          (value) => {
            this.draft[spec.key] = value;
            syncStar();
          },
        );
      } else {
        new AirportSuggest(
          this.app,
          t.inputEl,
          (value) => this.stars.isStarred("airport", value),
          (value) => {
            this.draft[spec.key] = value;
            syncStar();
          },
        );
      }
    });

    const starBtn = setting.controlEl.createEl("button", { cls: "tp-star-btn" });
    syncStar = () => {
      const value = this.draft[spec.key];
      const starred = value.length > 0 && this.stars.isStarred(kind, value);
      starBtn.empty();
      setIcon(starBtn, "star");
      starBtn.toggleClass("is-starred", starred);
      starBtn.toggleClass("is-disabled", value.length === 0);
      starBtn.setAttribute("aria-label", starred ? `Unstar ${value}` : `Star ${value || spec.label}`);
    };

    starBtn.addEventListener("click", async (evt) => {
      evt.preventDefault();
      const value = this.draft[spec.key];
      if (!value) return;
      await this.stars.toggle(kind, value);
      syncStar();
      input.focus();
    });

    syncStar();
  }

  /** Stations and stops are best described by their city. */
  private renderCityField(spec: FieldSpec): void {
    new Setting(this.bodyEl).setName(spec.label).addText((t) => {
      t.setPlaceholder(spec.placeholder);
      t.setValue(this.draft[spec.key]);
      t.onChange((v) => (this.draft[spec.key] = v.trim()));
      new CitySuggest(
        this.app,
        t.inputEl,
        () => this.trip.country,
        (value) => (this.draft[spec.key] = value),
      );
    });
  }

  private renderWhen(): void {
    if (this.draft.kind === "flight") {
      this.bodyEl.createDiv({
        cls: "tp-dash-hint",
        text: "Dates and times live on each leg, back on the Details step.",
      });
      this.bodyEl.createDiv({ cls: "tp-wizard-summary-value", text: this.whenSummary() });
      return;
    }
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
    const base = times ? `${range} · ${times}` : range;
    if (this.draft.legs.length > 1) {
      const total = totalJourneyMinutes(this.draft.legs);
      const stops = this.draft.legs.length - 1;
      const label = `${stops} stop${stops === 1 ? "" : "s"}`;
      return total === null ? `${base} · ${label}` : `${base} · ${label}, ${formatLayover(total)} total`;
    }
    return base;
  }

  /** Falls back to something readable when the title field was left blank. */
  private effectiveTitle(): string {
    if (this.draft.title) {
      if (this.draft.kind === "flight" && this.draft.from && this.draft.to) {
        return `${this.draft.title} ${this.draft.from} → ${this.draft.to}`;
      }
      return this.draft.title;
    }
    const route = routeTitle(this.draft.legs);
    if (route) return route;
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
    this.attachments?.destroy();
    this.contentEl.empty();
  }
}
