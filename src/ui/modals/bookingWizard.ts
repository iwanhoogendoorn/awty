import { App, ButtonComponent, Modal, Notice, Setting, setIcon } from "obsidian";
import { keepOpenOnBackgroundClick } from "../modalUtils";
import type { BookingKind, BookingStatus, CostCategory } from "../../bookings/types";
import { BOOKING_KINDS, BOOKING_STATUSES, allCategories } from "../../bookings/types";
import { countAttachmentsNamed, type BookingDraft } from "../../bookings/bookingWriter";
import type { AwtySettings, Trip } from "../../types";
import { AttachmentField } from "../components/attachmentField";
import { AirlineSuggest, AirportSuggest, CitySuggest } from "../components/suggest";
import { LegsField } from "../components/legsField";
import { airportFromLabel } from "../components/suggest";
import { parseConfirmation, type ParsedConfirmation } from "../../flights/parseConfirmation";
import {
  emptyLeg,
  routeTitle,
  splitJourney,
  totalJourneyMinutes,
  formatLayover,
  type FlightLeg,
} from "../../bookings/legs";
import { COMMON_CURRENCIES, formatMoney, parseAmount } from "../../util/money";
import { formatDateRange, isValidISODate, todayISO } from "../../util/dates";

type FieldKey = "operator" | "reference" | "from" | "to" | "seat" | "title" | "address";

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
    { key: "address", label: "Address", placeholder: "Frana Supila 12, Dubrovnik" },
    { key: "reference", label: "Confirmation number", placeholder: "1234567890" },
  ],
  activity: [
    { key: "title", label: "What", placeholder: "Old town walls walk" },
    { key: "to", label: "Venue", placeholder: "Pile Gate" },
    { key: "address", label: "Address", placeholder: "Optional — improves travel times" },
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
const FLIGHT_STEPS = ["Flights", "Cost", "Attachments"] as const;

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
  /** What the last confirmation yielded, shown in place of the hint. */
  private readSummary = "";
  private pasteHandler: ((evt: ClipboardEvent) => void) | null = null;
  private dropHandler: ((evt: DragEvent) => void) | null = null;
  private returnField: LegsField | null = null;
  private hasReturn = false;

  /** Flights hold their dates on each leg, so they skip the separate When step. */
  private get steps(): readonly string[] {
    return this.draft.kind === "flight" ? FLIGHT_STEPS : STEPS;
  }

  constructor(
    app: App,
    private settings: AwtySettings,
    private trip: Trip,
    kind: BookingKind,
    private currency: string,
    private stars: {
      isStarred: (kind: StarKind, v: string) => boolean;
      toggle: (kind: StarKind, v: string) => Promise<void>;
    },
    private onSubmit: (draft: BookingDraft, files: File[]) => Promise<void>,
    /** Present when an existing booking is being changed rather than created. */
    private initial?: Partial<BookingDraft>,
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
      address: "",
      seat: "",
      notes: "",
      attachments: [],
      // The trip already knows where you are leaving from; no reason to ask twice.
    legs: kind === "flight" ? [{ ...emptyLeg(start), from: trip.originAirport }] : [],
      returnLegs: [],
      ...initial,
    };
    this.hasReturn = (this.draft.returnLegs?.length ?? 0) > 0;
    if (this.draft.amount !== null) this.amountRaw = String(this.draft.amount);
  }

  /** True when this is changing something that already exists. */
  private get editing(): boolean {
    return this.initial !== undefined;
  }

  onOpen(): void {
    keepOpenOnBackgroundClick(this);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("awty-modal", "awty-wizard");
    this.modalEl.addClass("awty-modal-shell");

    const def = BOOKING_KINDS.find((k) => k.id === this.draft.kind);
    const head = contentEl.createDiv({ cls: "awty-wizard-head" });
    setIcon(head.createDiv({ cls: "awty-wizard-icon" }), def?.icon ?? "ticket");
    const headText = head.createDiv();
    headText.createDiv({
      cls: "awty-modal-title",
      text: `${this.editing ? "Edit" : "Add"} ${def?.label.toLowerCase() ?? "booking"}`,
    });
    headText.createDiv({
      cls: "awty-wizard-sub",
      text: `${this.trip.title} · ${formatDateRange(this.trip.startDate, this.trip.endDate)}`,
    });

    this.stepsEl = contentEl.createDiv({ cls: "awty-wizard-steps" });
    this.bodyEl = contentEl.createDiv({ cls: "awty-wizard-body" });

    // Built once and kept alive across steps so pending files survive Back.
    const hidden = contentEl.createDiv({ cls: "awty-attach-host is-hidden" });
    this.attachments = new AttachmentField(hidden, {
      baseName: this.trip.title,
      startIndex: countAttachmentsNamed(this.app, this.settings, this.trip, this.trip.title),
    });

    new Setting(contentEl)
      .setClass("awty-wizard-nav")
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
            if (this.step < this.steps.length - 1) this.go(this.step + 1);
            else void this.submit();
          });
      });

    this.registerConfirmationCapture();
    this.go(0);
  }

  private go(step: number): void {
    this.step = Math.max(0, Math.min(this.steps.length - 1, step));
    this.renderSteps();
    this.renderBody();
    this.backBtn.setDisabled(this.step === 0);
    this.nextBtn.setButtonText(
      this.step === this.steps.length - 1 ? (this.editing ? "Save changes" : "Save booking") : "Next",
    );
  }

  private renderSteps(): void {
    this.stepsEl.empty();
    for (const [index, name] of this.steps.entries()) {
      const chip = this.stepsEl.createDiv({
        cls: `awty-wizard-step${index === this.step ? " is-active" : ""}${index < this.step ? " is-done" : ""}`,
      });
      chip.createSpan({ cls: "awty-wizard-step-num", text: String(index + 1) });
      chip.createSpan({ cls: "awty-wizard-step-name", text: name });
      chip.addEventListener("click", () => this.go(index));
    }
  }

  private renderBody(): void {
    this.bodyEl.empty();
    const name = this.steps[this.step];
    if (name === "Details" || name === "Flights") this.renderDetails();
    else if (name === "When") this.renderWhen();
    else if (name === "Cost") this.renderCost();
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
      const setting = new Setting(this.bodyEl).setName(spec.label);
      if (spec.key === "address") {
        setting.setDesc("Used to work out travel times from your accommodation.");
      }
      setting.addText((t) => {
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
      // Answered once, on the trip. Repeating it here was the second place the
      // same fact had to be kept in step.
      this.bodyEl.createDiv({
        cls: "awty-dash-hint",
        text: `For ${this.trip.travellers.join(", ")} — change this on the trip.`,
      });
    }

    new Setting(this.bodyEl).setName("Notes").addTextArea((ta) => {
      ta.inputEl.rows = 2;
      ta.setValue(this.draft.notes);
      ta.onChange((v) => (this.draft.notes = v));
    });
  }

  /** Direct or connecting; the editor handles both and works out the layovers. */
  /**
   * One quiet line, rather than a panel.
   *
   * The capability matters more than the affordance: Cmd+V anywhere in the
   * wizard parses a confirmation, and a dropped .ics does the same, so this is
   * a reminder rather than a place you have to aim at.
   */
  private renderConfirmationHint(): void {
    const row = this.bodyEl.createDiv({ cls: "awty-confirm-row" });

    if (this.readSummary) {
      setIcon(row.createSpan({ cls: "awty-confirm-row-icon is-done" }), "check");
      row.createSpan({ cls: "awty-confirm-row-done", text: this.readSummary });
      const again = row.createEl("button", { cls: "awty-confirm-link", text: "read another" });
      again.type = "button";
      again.addEventListener("click", () => {
        this.readSummary = "";
        this.renderBody();
      });
      return;
    }

    setIcon(row.createSpan({ cls: "awty-confirm-row-icon" }), "clipboard-paste");
    row.createSpan({ text: "Paste your booking confirmation to fill this in" });

    const file = row.createEl("input");
    file.type = "file";
    file.accept = ".ics,.txt,.eml,text/calendar,message/rfc822,text/plain";
    file.addClass("awty-attach-input");
    file.addEventListener("change", async () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      const text = await chosen.text();
      file.value = "";
      this.readConfirmation(text, chosen.name);
    });

    const choose = row.createEl("button", { cls: "awty-confirm-link", text: "or open a file" });
    choose.type = "button";
    choose.addEventListener("click", () => file.click());
  }

  /**
   * Paste and drop anywhere in the wizard.
   *
   * Registered once for the modal's lifetime. Text that does not look like a
   * confirmation is left alone, so pasting into a field still behaves normally.
   */
  private registerConfirmationCapture(): void {
    this.pasteHandler = (evt: ClipboardEvent) => {
      if (this.draft.kind !== "flight") return;
      // A paste into a form field is someone filling that field in.
      const target = evt.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

      const text = evt.clipboardData?.getData("text/plain") ?? "";
      if (!text.trim() || !parseConfirmation(text)) return;
      evt.preventDefault();
      this.readConfirmation(text);
    };
    document.addEventListener("paste", this.pasteHandler);

    this.dropHandler = (evt: DragEvent) => {
      if (this.draft.kind !== "flight") return;
      const dropped = evt.dataTransfer?.files?.[0];
      if (!dropped || !/\.(ics|eml|txt)$/i.test(dropped.name)) return;
      evt.preventDefault();
      evt.stopPropagation();
      void dropped.text().then((text) => this.readConfirmation(text, dropped.name));
    };
    this.contentEl.addEventListener("drop", this.dropHandler);
    this.contentEl.addEventListener("dragover", (evt) => evt.preventDefault());
  }

  /** One entry point, whether the text was pasted, dropped or opened. */
  private readConfirmation(text: string, name?: string): void {
    if (!text.trim()) return;

    const parsed = parseConfirmation(text);
    if (!parsed || parsed.legs.length === 0) {
      new Notice(
        name
          ? `Could not find any flights in ${name}.`
          : "Could not find any flights in that. Fill the legs in by hand.",
        7000,
      );
      return;
    }
    this.applyParsed(parsed);
  }

  private applyParsed(parsed: ParsedConfirmation): void {
    const { outbound, back } = splitJourney(parsed.legs);
    const sorted = [...outbound, ...back];

    this.draft.legs = outbound;
    this.draft.returnLegs = back;
    this.hasReturn = back.length > 0;
    if (parsed.reference) this.draft.reference = parsed.reference;
    if (parsed.amount !== null) {
      this.draft.amount = parsed.amount;
      this.amountRaw = String(parsed.amount);
      if (parsed.currency) this.draft.currency = parsed.currency;
    }

    const detail = [
      `${sorted.length} leg${sorted.length === 1 ? "" : "s"}`,
      back.length > 0 ? "return included" : "",
      parsed.reference ? `ref ${parsed.reference}` : "",
      parsed.amount !== null ? formatMoney({ amount: parsed.amount, currency: this.draft.currency }) : "",
    ].filter(Boolean);

    this.readSummary = `Read ${detail.join(" · ")}${
      parsed.source === "ics" ? " from the calendar invite" : ""
    }${parsed.utcTimes ? " — times are UTC in that calendar, so check them" : ""}`;

    new Notice(
      parsed.source === "ics"
        ? "Filled in from the calendar invite."
        : "Filled in from the confirmation — check the times before saving.",
      6000,
    );
    this.renderBody();
  }

  private renderFlightLegs(): void {
    this.renderConfirmationHint();
    this.bodyEl.createDiv({ cls: "awty-section-label", text: "Outbound" });
    this.legsField = new LegsField({
      app: this.app,
      container: this.bodyEl.createDiv(),
      legs: this.draft.legs,
      defaultDate: this.draft.date,
      stars: this.stars,
      nearby: () => ({ country: this.trip.country, city: this.trip.city }),
      onChange: () => this.syncFromLegs(),
    });

    // Almost every holiday flight is a return, so this is one toggle rather
    // than making you run the whole wizard a second time.
    new Setting(this.bodyEl)
      .setName("Return flight")
      .setDesc("Same ticket, coming back.")
      .addToggle((t) => {
        t.setValue(this.hasReturn);
        t.onChange((value) => {
          this.hasReturn = value;
          if (value && this.draft.returnLegs.length === 0) {
            const outbound = this.draft.legs[this.draft.legs.length - 1];
            this.draft.returnLegs = [
              {
                ...emptyLeg(this.trip.endDate || this.draft.date),
                // The way home reverses the way out.
                from: outbound?.to ?? "",
                to: this.draft.legs[0]?.from ?? "",
              },
            ];
          }
          this.renderBody();
        });
      });

    if (this.hasReturn) {
      this.bodyEl.createDiv({ cls: "awty-section-label", text: "Return" });
      this.returnField = new LegsField({
        app: this.app,
        container: this.bodyEl.createDiv(),
        legs: this.draft.returnLegs,
        defaultDate: this.trip.endDate || this.draft.date,
        stars: this.stars,
        nearby: () => ({ country: this.trip.country, city: this.trip.city }),
        onChange: () => this.syncFromLegs(),
        });
    } else {
      this.returnField = null;
    }

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

    if (this.returnField) {
      const back = this.returnField.getLegs();
      this.draft.returnLegs = back;
      const lastBack = back[back.length - 1];
      if (lastBack) {
        this.draft.endDate = lastBack.arrDate || lastBack.date || this.draft.endDate;
        this.draft.endTime = lastBack.arrTime || this.draft.endTime;
      }
    } else {
      this.draft.returnLegs = [];
    }
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

    const starBtn = setting.controlEl.createEl("button", { cls: "awty-star-btn" });
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
    const isStay = this.draft.kind === "stay";
    const wrap = this.bodyEl.createDiv({ cls: "awty-daterange" });

    const dateRow = (
      label: string,
      value: string,
      onChange: (v: string) => void,
      timeLabel: string,
      timeValue: string,
      onTime: (v: string) => void,
    ) => {
      const row = wrap.createDiv({ cls: "awty-date-row" });
      row.createEl("label", { text: label, cls: "awty-date-label" });
      const date = row.createEl("input", { cls: "awty-date-input" });
      date.type = "date";
      date.value = value;
      // Nudge towards the trip's own dates without forbidding anything else.
      // Bound the picker to the trip, so it opens on the right month.
      if (isValidISODate(this.trip.startDate)) date.min = this.trip.startDate;
      if (isValidISODate(this.trip.endDate)) date.max = this.trip.endDate;
      date.addEventListener("change", () => onChange(date.value));

      const time = row.createEl("input", { cls: "awty-time-input" });
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
      cls: "awty-date-readout",
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
        for (const c of allCategories(this.settings.customCategories, [this.draft.category])) {
          dd.addOption(c, c);
        }
        dd.setValue(this.draft.category);
        dd.onChange((v) => (this.draft.category = v as CostCategory));
      });

    this.bodyEl.createDiv({ cls: "awty-cost-preview" });
    this.renderCostPreview();
  }

  private renderCostPreview(): void {
    const el = this.bodyEl.querySelector<HTMLElement>(".awty-cost-preview");
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
    const host = this.contentEl.querySelector<HTMLElement>(".awty-attach-host");
    if (host) {
      host.removeClass("is-hidden");
      this.bodyEl.appendChild(host);
    }

    const summary = this.bodyEl.createDiv({ cls: "awty-wizard-summary" });
    summary.createDiv({ cls: "awty-section-label", text: "Review" });

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
      const row = summary.createDiv({ cls: "awty-wizard-summary-row" });
      row.createSpan({ cls: "awty-wizard-summary-label", text: label });
      row.createSpan({ cls: "awty-wizard-summary-value", text: value || "—" });
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
    if (this.draft.kind === "flight") {
      const out = routeTitle(this.draft.legs);
      const back = routeTitle(this.draft.returnLegs);
      if (out && back) {
        const [from, to] = [this.draft.legs[0]?.from, this.draft.legs[this.draft.legs.length - 1]?.to];
        if (from && to) return `${from} ⇄ ${to}`;
      }
      if (out) return out;
    }
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
      console.error("[awty]", err);
      this.submitting = false;
      this.nextBtn.setDisabled(false).setButtonText(this.editing ? "Save changes" : "Save booking");
    }
  }

  onClose(): void {
    this.attachments?.destroy();
    if (this.pasteHandler) document.removeEventListener("paste", this.pasteHandler);
    this.pasteHandler = null;
    this.dropHandler = null;
    this.contentEl.empty();
  }
}
