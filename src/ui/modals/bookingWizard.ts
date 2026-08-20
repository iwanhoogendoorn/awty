import { App, ButtonComponent, Modal, Notice, Setting, setIcon } from "obsidian";
import { keepOpenOnBackgroundClick } from "../modalUtils";
import type { Booking, BookingKind, BookingStatus, CostCategory } from "../../bookings/types";
import { BOOKING_KINDS, BOOKING_STATUSES, allCategories, bookingIcon } from "../../bookings/types";
import { TRANSPORT_MODES, modeDef, modeLabel, readMode } from "../../bookings/transportMode";
import { countAttachmentsNamed, type BookingDraft } from "../../bookings/bookingWriter";
import { tripCities, tripCountries, tripStops, type AwtySettings, type Trip } from "../../types";
import { flightHops } from "../../bookings/flightHops";
import { AttachmentField } from "../components/attachmentField";
import {
  AirlineSuggest,
  AirportSuggest,
  CitySuggest,
  CountrySuggest,
  EndpointSuggest,
  FoodSpotSuggest,
} from "../components/suggest";
import { tripEndpoints, transferShortcuts, type Endpoint } from "../../bookings/tripEndpoints";
import { LegsField } from "../components/legsField";
import { PortsField } from "../components/portsField";
import {
  ABOARD,
  cruiseShape,
  cruiseWhereOptions,
  emptyPort,
  formatAshore,
  minutesAshore,
  orderPorts,
  portLabel,
  type CruisePort,
} from "../../bookings/cruise";
import { airportFromLabel } from "../components/suggest";
import { parseConfirmation, type ParsedConfirmation } from "../../flights/parseConfirmation";
import { localiseLegs } from "../../flights/localTime";
import type { PostalAddress } from "../../bookings/postalAddress";
import {
  EMPTY_ADDRESS,
  composeAddress,
  keepLocation,
  prefilledAddress,
  splitLegacyAddress,
} from "../../bookings/postalAddress";
import {
  emptyLeg,
  firstIncompleteLeg,
  groupJourneys,
  journeyCostTotal,
  looksLikeMoreJourneys,
  routeTitle,
  splitJourney,
  totalJourneyMinutes,
  formatLayover,
  type FlightLeg,
} from "../../bookings/legs";
import { COMMON_CURRENCIES, formatMoney, parseAmount } from "../../util/money";
import { formatDateRange, isValidISODate, todayISO } from "../../util/dates";

type FieldKey =
  | "operator"
  | "reference"
  | "from"
  | "to"
  | "seat"
  | "title"
  | "address"
  | "fromAddress"
  | "where";

/**
 * The keys that really are a single string on the draft.
 *
 * `address` and `fromAddress` name a group of boxes rather than one, so the
 * generic "read a field, write a field" code must never reach for them.
 */
type TextFieldKey = Exclude<FieldKey, "address" | "fromAddress" | "where">;

export type StarKind = "airline" | "airport";

interface FieldSpec {
  key: FieldKey;
  label: string;
  placeholder: string;
  /**
   * Required because the plugin cannot do its job without it — not because
   * the form would like it. A booking with no name is unreadable in every
   * list; a journey with no ends cannot be placed, timed or mapped.
   */
  required?: boolean;
}

/**
 * The city and country to start an address off with, for kinds that have one.
 *
 * A flight is deliberately excluded: it has no address field, and seeding one
 * would write a city onto a note whose location is an airport.
 */
function addressPrefillFor(kind: BookingKind, trip: Trip): PostalAddress {
  if (!FIELDS[kind].some((f) => f.key === "address" || f.key === "fromAddress")) {
    return { ...EMPTY_ADDRESS };
  }
  return prefilledAddress(tripCities(trip), tripCountries(trip));
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
    { key: "title", label: "Property", placeholder: "Hotel Excelsior", required: true },
    { key: "address", label: "Address", placeholder: "Frana Supila 12" },
    { key: "reference", label: "Confirmation number", placeholder: "1234567890" },
  ],
  activity: [
    { key: "title", label: "What", placeholder: "Old town walls walk", required: true },
    { key: "to", label: "Venue", placeholder: "Pile Gate" },
    { key: "address", label: "Address", placeholder: "Pile 1" },
    { key: "seat", label: "Seat / section", placeholder: "Block C, row 4" },
    { key: "reference", label: "Booking reference", placeholder: "ABC123" },
  ],
  restaurant: [
    { key: "title", label: "Restaurant", placeholder: "Nautika", required: true },
    // Only rendered on a trip that has a cruise; on every other trip a
    // restaurant is simply somewhere, and asking would be noise.
    { key: "where", label: "Where", placeholder: "" },
    { key: "address", label: "Address", placeholder: "Brsalje ul. 3" },
    { key: "operator", label: "Booked by", placeholder: "Optional" },
    { key: "reference", label: "Reservation reference", placeholder: "Optional" },
    { key: "seat", label: "Table", placeholder: "By the window" },
  ],
  cruise: [
    { key: "operator", label: "Cruise line", placeholder: "Regent Seven Seas" },
    { key: "title", label: "Ship", placeholder: "Seven Seas Prestige", required: true },
    { key: "from", label: "Embarks at", placeholder: "Miami, Florida", required: true },
    { key: "to", label: "Disembarks at", placeholder: "Miami, Florida" },
    { key: "seat", label: "Cabin", placeholder: "Concierge Suite 812" },
    { key: "reference", label: "Booking reference", placeholder: "ABC123" },
  ],
  excursion: [
    { key: "title", label: "Excursion", placeholder: "Mayan ruins at Uxmal", required: true },
    { key: "where", label: "Where", placeholder: "" },
    { key: "operator", label: "Operator", placeholder: "Booked through the ship" },
    { key: "seat", label: "Meeting point", placeholder: "Deck 4, midship" },
    { key: "reference", label: "Booking reference", placeholder: "ABC123" },
  ],
  transport: [
    { key: "operator", label: "Carrier", placeholder: "FlixBus" },
    { key: "title", label: "Service", placeholder: "Bus 402", required: true },
    { key: "from", label: "From", placeholder: "Dubrovnik Airport (DBV)", required: true },
    { key: "fromAddress", label: "From address", placeholder: "Street it picks you up on" },
    { key: "to", label: "To", placeholder: "Rausion Luxury Apartments", required: true },
    { key: "address", label: "To address", placeholder: "Street it drops you on" },
    { key: "seat", label: "Seat", placeholder: "12" },
    { key: "reference", label: "Booking reference", placeholder: "ABC123" },
  ],
};

/** A quiet mark, so the requirement is visible before Save refuses. */
function markRequired(setting: Setting): void {
  setting.nameEl.createSpan({ cls: "awty-required", text: "*" });
  setting.nameEl.setAttribute("aria-label", `${setting.nameEl.textContent ?? ""} (required)`);
}

const STEPS = ["Details", "When", "Cost", "Attachments"] as const;
const FLIGHT_STEPS = ["Flights", "Cost", "Attachments"] as const;
// A cruise's dates come out of its itinerary, so asking for them separately
// would be asking the same question twice and inviting the two to disagree.
const CRUISE_STEPS = ["Details", "Itinerary", "Cost", "Attachments"] as const;

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
  private portsField: PortsField | null = null;
  private cruiseSummaryEl: HTMLElement | null = null;
  /** What the last confirmation yielded, shown in place of the hint. */
  private readSummary = "";
  private pasteHandler: ((evt: ClipboardEvent) => void) | null = null;
  private dropHandler: ((evt: DragEvent) => void) | null = null;
  private returnField: LegsField | null = null;
  /** "lat,lng" from a picked Food Spot entry, so nothing is geocoded twice. */
  private knownLocation = "";
  /** Repainted when the mode changes, so a ferry stops calling itself a train. */
  /** Whether the return question has been put once, so the offer is not re-made. */
  private returnAsked = false;
  /** Whether the offered return time came off an older booking's end time. */
  private returnLifted = false;
  private headIconEl!: HTMLElement;
  private headTitleEl!: HTMLElement;
  /**
   * The address this booking had when the form opened.
   *
   * A coordinate describes an address, so it survives an edit only as long as
   * the address does. Keeping it through a move would leave the pin on the old
   * doorway and quietly report travel times to somewhere you are not staying.
   */
  private openedWithAddress = "";
  private hasReturn = false;

  /** Flights hold their dates on each leg, so they skip the separate When step. */
  private get steps(): readonly string[] {
    if (this.draft.kind === "flight") return FLIGHT_STEPS;
    if (this.draft.kind === "cruise") return CRUISE_STEPS;
    return STEPS;
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
    /** Offered only when editing: removes the booking entirely. */
    private onDelete?: () => void,
    /** This trip's other bookings, which a transfer travels between. */
    private tripBookings?: () => Booking[],
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
      // Where the trip goes, already in the boxes. A restaurant on a trip to
      // Miami is in Miami, and asking again is asking somebody to type back
      // what they told the trip note. Both ends of a transfer get it, since a
      // taxi picks you up in the same town it drops you in. Saved only if you
      // actually add a street — see `meaningfulAddress`.
      postal: addressPrefillFor(kind, trip),
      fromPostal: addressPrefillFor(kind, trip),
      seat: "",
      notes: "",
      attachments: [],
      // The trip already knows where you are leaving from; no reason to ask twice.
    legs: kind === "flight" ? [{ ...emptyLeg(start), from: trip.originAirport }] : [],
      returnLegs: [],
      // One row to start with, so the itinerary is somewhere to type rather
      // than a button you have to find first.
      ports: kind === "cruise" ? [emptyPort(start)] : [],
      where: "",
      cruise: "",
      mode: "",
      returnDate: "",
      returnTime: "",
      ...initial,
    };
    this.hasReturn = (this.draft.returnLegs?.length ?? 0) > 0;
    this.knownLocation = this.draft.location ?? "";
    this.openedWithAddress = composeAddress(this.draft.postal);
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

    const head = contentEl.createDiv({ cls: "awty-wizard-head" });
    this.headIconEl = head.createDiv({ cls: "awty-wizard-icon" });
    const headText = head.createDiv();
    this.headTitleEl = headText.createDiv({ cls: "awty-modal-title" });
    headText.createDiv({
      cls: "awty-wizard-sub",
      text: `${this.trip.title} · ${formatDateRange(this.trip.startDate, this.trip.endDate)}`,
    });
    this.paintHead();

    this.stepsEl = contentEl.createDiv({ cls: "awty-wizard-steps" });
    this.bodyEl = contentEl.createDiv({ cls: "awty-wizard-body" });

    // Built once and kept alive across steps so pending files survive Back.
    const hidden = contentEl.createDiv({ cls: "awty-attach-host is-hidden" });
    this.attachments = new AttachmentField(hidden, {
      baseName: this.trip.title,
      startIndex: countAttachmentsNamed(this.app, this.settings, this.trip, this.trip.title),
      // What is already attached, so it can be seen and removed.
      existing: this.draft.attachments,
      onRemoveExisting: (removed) => {
        this.draft.attachments = this.draft.attachments.filter((p) => p !== removed);
      },
    });

    contentEl.createDiv({ cls: "awty-wizard-missing" });

    // Any typing anywhere in the form may complete the page, so the check
    // rides on the events rather than being wired to each field.
    for (const event of ["input", "change"]) {
      contentEl.addEventListener(event, () => this.refreshNav());
    }

    const nav = new Setting(contentEl).setClass("awty-wizard-nav");
    // Deleting belongs where you are already looking at the thing.
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

  /**
   * What is missing from the step on screen, named.
   *
   * Checked per step rather than only at Save, so you cannot walk past a
   * half-filled page and be told about it three screens later.
   */
  private missingOnStep(name: string): string | null {
    if (name === "Details") {
      const field = FIELDS[this.draft.kind].find(
        (spec) => spec.required && !this.fieldValue(spec.key).trim(),
      );
      return field ? field.label : null;
    }
    if (name === "Flights") {
      if (this.draft.status === "idea") return null;
      return firstIncompleteLeg([...this.draft.legs, ...this.draft.returnLegs]);
    }
    if (name === "When" && !isValidISODate(this.draft.date)) return "a valid date";
    return null;
  }

  /** Greys out Next while the page is incomplete, and says what is wanted. */
  private refreshNav(): void {
    const missing = this.missingOnStep(this.steps[this.step]);
    const last = this.step === this.steps.length - 1;
    this.nextBtn.setDisabled(missing !== null);
    this.nextBtn.setButtonText(
      last ? (this.editing ? "Save changes" : "Save booking") : "Next",
    );

    const hint = this.contentEl.querySelector<HTMLElement>(".awty-wizard-missing");
    if (!hint) return;
    hint.empty();
    hint.toggleClass("is-shown", missing !== null);
    if (!missing) return;
    setIcon(hint.createSpan({ cls: "awty-wizard-missing-icon" }), "alert-circle");
    hint.createSpan({
      text:
        this.draft.kind === "flight" && this.steps[this.step] === "Flights"
          ? `${missing} is needed on every leg — or set the status to Idea.`
          : `${missing} is needed before you can go on.`,
    });
  }

  private go(step: number): void {
    this.step = Math.max(0, Math.min(this.steps.length - 1, step));
    this.renderSteps();
    this.renderBody();
    this.backBtn.setDisabled(this.step === 0);
    this.refreshNav();
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
    else if (name === "Itinerary") this.renderPorts();
    else if (name === "When") this.renderWhen();
    else if (name === "Cost") this.renderCost();
    else this.renderAttachments();
  }

  /**
   * The icon and the title, which a transfer's mode gets a say in.
   *
   * "Add transport" with a train on it is what the form said while somebody
   * booked a boat. The mode is chosen in the first field, so the header follows
   * it rather than announcing the kind and leaving it at that.
   */
  private paintHead(): void {
    const def = BOOKING_KINDS.find((k) => k.id === this.draft.kind);
    setIcon(this.headIconEl, bookingIcon(this.draft));
    const noun =
      (this.draft.kind === "transport" ? modeLabel(this.draft.mode) : "") ||
      def?.label ||
      "booking";
    this.headTitleEl.setText(`${this.editing ? "Edit" : "Add"} ${noun.toLowerCase()}`);
  }

  /** Placeholders for a transfer, in the words of the thing actually booked. */
  private transportPlaceholder(spec: FieldSpec): string {
    const def = modeDef(this.draft.mode);
    if (!def) return spec.placeholder;
    if (spec.key === "operator") return def.carrier;
    if (spec.key === "title") return def.service;
    if (spec.key === "from") return def.from;
    if (spec.key === "to") return def.to;
    return spec.placeholder;
  }

  /**
   * Train, bus, ferry, taxi.
   *
   * First, because it changes how everything under it reads — and because a
   * ferry crossing recorded as generic "transport" is a boat you cannot tell
   * from a coach in the itinerary a week later.
   */
  private renderModeField(): void {
    new Setting(this.bodyEl)
      .setName("Mode")
      .setDesc("What it is. Sets the icon, and what the boxes below suggest.")
      .addDropdown((dd) => {
        // Nothing is a real answer: every transfer written before this field
        // existed gives it, and guessing a train for them would be inventing.
        dd.addOption("", "Not specified");
        for (const mode of TRANSPORT_MODES) dd.addOption(mode.id, mode.label);
        dd.setValue(this.draft.mode);
        dd.onChange((v) => {
          this.draft.mode = readMode(v);
          this.paintHead();
          this.renderBody();
        });
      });
  }

  private renderDetails(): void {
    if (this.draft.kind === "flight") {
      this.renderFlightLegs();
      this.renderStatusAndNotes();
      return;
    }
    if (this.draft.kind === "transport") {
      this.renderModeField();
      this.renderTransferShortcuts();
    }

    for (const spec of FIELDS[this.draft.kind]) {
      // Anything with a known set of answers gets a picker; only genuinely
      // free-form fields stay as text boxes.
      if ((spec.key === "from" || spec.key === "to") && this.draft.kind === "transport") {
        this.renderEndpointField(spec);
        continue;
      }
      if (spec.key === "title" && this.draft.kind === "restaurant") {
        this.renderRestaurantField(spec);
        continue;
      }
      if (spec.key === "address" || spec.key === "fromAddress") {
        this.renderAddressField(spec);
        continue;
      }
      if (spec.key === "where") {
        // An excursion is always part of a cruise, so it always asks. Anything
        // else asks only when there is a ship to be on.
        if (this.draft.kind === "excursion" || this.hasCruise()) this.renderWhereField(spec);
        continue;
      }
      const setting = new Setting(this.bodyEl).setName(spec.label);
      if (spec.required) markRequired(setting);
      setting.addText((t) => {
        t.setPlaceholder(
          this.draft.kind === "transport" ? this.transportPlaceholder(spec) : spec.placeholder,
        );
        t.setValue(this.draft[spec.key as TextFieldKey]);
        t.onChange((v) => (this.draft[spec.key as TextFieldKey] = v.trim()));
      });
    }

    this.renderStatusAndNotes();
  }

  /**
   * The cruise itinerary: a row per day, and the dates that fall out of it.
   *
   * The booking's own start and end are taken from the first and last rows
   * rather than asked for. A cruise that says it runs to the 8th while its last
   * port is the 9th is a booking arguing with itself, and the argument is
   * always won by the itinerary — that is the bit copied off the confirmation.
   */
  private renderPorts(): void {
    const intro = new Setting(this.bodyEl).setName("Itinerary").setHeading();
    intro.setDesc(
      "One row per day, the way the cruise line prints it. Days at sea count — they are days you are on the ship with nothing ashore to book.",
    );

    const host = this.bodyEl.createDiv();
    this.portsField = new PortsField({
      app: this.app,
      container: host,
      ports: this.draft.ports,
      defaultDate: this.draft.date || todayISO(),
      onChange: () => {
        this.draft.ports = this.portsField?.getPorts() ?? [];
        this.syncCruiseDates();
        this.paintCruiseSummary();
      },
    });
    this.draft.ports = this.portsField.getPorts();
    this.syncCruiseDates();

    this.cruiseSummaryEl = this.bodyEl.createDiv({ cls: "awty-dash-hint awty-cruise-summary" });
    this.paintCruiseSummary();
  }

  /** Boarding to getting off, read off the itinerary rather than asked twice. */
  private syncCruiseDates(): void {
    const dated = orderPorts(this.draft.ports).filter((p) => p.date);
    if (dated.length === 0) return;
    this.draft.date = dated[0].date;
    this.draft.endDate = dated[dated.length - 1].date;
    this.draft.time = dated[0].departs || this.draft.time;
    this.draft.endTime = dated[dated.length - 1].arrives || this.draft.endTime;
  }

  private paintCruiseSummary(): void {
    const el = this.cruiseSummaryEl;
    if (!el) return;
    el.empty();
    const shape = cruiseShape(this.draft.ports);
    if (shape.calls === 0 && shape.seaDays === 0) {
      el.setText("Add the ports and this will say what the cruise adds up to.");
      return;
    }
    const bits = [
      `${shape.nights} night${shape.nights === 1 ? "" : "s"}`,
      `${shape.calls} port${shape.calls === 1 ? "" : "s"} of call`,
      shape.seaDays > 0 ? `${shape.seaDays} day${shape.seaDays === 1 ? "" : "s"} at sea` : "",
      shape.countries.length > 0 ? shape.countries.join(", ") : "",
    ].filter(Boolean);
    el.setText(bits.join(" · "));
  }

  /**
   * Where on a cruise this happens: the ship, or one of its ports.
   *
   * Offered as a list rather than a box, because the answers are known — they
   * are on the cruise booking already — and typing "Progresso" where the
   * itinerary says "Progreso" is a mismatch nothing downstream can repair.
   * Sea days are absent: there is no gangway, so there is nothing to book.
   */
  private hasCruise(): boolean {
    return (this.tripBookings?.() ?? []).some((b) => b.kind === "cruise");
  }

  private renderWhereField(spec: FieldSpec): void {
    const cruises = (this.tripBookings?.() ?? []).filter((b) => b.kind === "cruise");
    const ports = cruises.flatMap((c) => c.ports);
    const options = cruiseWhereOptions(ports);

    const setting = new Setting(this.bodyEl).setName(spec.label);
    if (cruises.length === 0) {
      setting.setDesc("Add the cruise to this trip first and its ports will be offered here.");
      setting.addText((t) => {
        t.setPlaceholder("Ashore, or on board");
        t.setValue(this.draft.where);
        t.onChange((v) => (this.draft.where = v.trim()));
      });
      return;
    }

    setting.setDesc("On the ship, or ashore at one of its ports.");
    setting.addDropdown((dd) => {
      dd.addOption("", "Not said");
      for (const option of options) dd.addOption(option, option);
      // A value typed before the cruise existed is kept rather than silently
      // swapped for the first port in the list.
      if (this.draft.where && !options.includes(this.draft.where)) {
        dd.addOption(this.draft.where, `${this.draft.where} (not on the itinerary)`);
      }
      dd.setValue(this.draft.where);
      dd.onChange((v) => {
        this.draft.where = v;
        // Which cruise this hangs off, so the note can point back at it.
        this.draft.cruise = cruises[0]?.file.path ?? "";
        this.applyPortDay(ports);
        this.renderBody();
      });
    });

    this.renderAshoreHint(ports);
  }

  /**
   * Move an excursion onto the day its port is, and say how long there is.
   *
   * A shore excursion happens on exactly one day — the day the ship is there —
   * so making you look that up and type it in is asking you to copy a fact the
   * plugin already holds, with the chance of getting it wrong.
   */
  private applyPortDay(ports: CruisePort[]): void {
    if (!this.draft.where || this.draft.where === ABOARD) return;
    const match = orderPorts(ports).find((p) => portLabel(p) === this.draft.where);
    if (!match?.date) return;
    this.draft.date = match.date;
    this.draft.endDate = match.date;
  }

  private renderAshoreHint(ports: CruisePort[]): void {
    if (!this.draft.where) return;
    if (this.draft.where === ABOARD) {
      this.bodyEl.createDiv({
        cls: "awty-dash-hint",
        text: "On the ship. Nothing to get ashore for, and no tender to miss.",
      });
      return;
    }
    const match = orderPorts(ports).find((p) => portLabel(p) === this.draft.where);
    if (!match) return;
    const ashore = minutesAshore(match);
    this.bodyEl.createDiv({
      cls: "awty-dash-hint",
      text:
        ashore === null
          ? `${match.date} — the itinerary has no times for this port yet.`
          : `${match.date}, alongside ${match.arrives}–${match.departs}. ${formatAshore(ashore)} ashore, and the ship does not wait.`,
    });
  }

  /** A field's value as text, whichever shape it is stored in. */
  private fieldValue(key: FieldKey): string {
    if (key === "address") return composeAddress(this.draft.postal);
    if (key === "fromAddress") return composeAddress(this.draft.fromPostal);
    return this.draft[key] ?? "";
  }

  /**
   * An address as the several things it is.
   *
   * One box could hold all of it, and did — but a postcode and a country are
   * exactly what tells one street of the same name from another, and asked for
   * as free text they are simply missing more often than not. Separate boxes
   * ask for them.
   */
  private renderAddressField(spec: FieldSpec): void {
    const from = spec.key === "fromAddress";
    const address = from ? this.draft.fromPostal : this.draft.postal;

    const head = new Setting(this.bodyEl).setName(spec.label).setHeading();
    head.setDesc(
      from
        ? "Optional. Useful when the pick-up point is not somewhere already booked."
        : this.draft.kind === "transport"
          ? "Where this leaves you — what puts it on the map and in the travel times."
          : "Used to work out travel times from your accommodation. The postcode and country are what tell one street from another.",
    );

    const parts: { key: keyof PostalAddress; label: string; placeholder: string }[] = [
      { key: "line1", label: "Address line 1", placeholder: spec.placeholder },
      { key: "line2", label: "Address line 2", placeholder: "Apartment, floor, building" },
      { key: "postcode", label: "Postcode", placeholder: "20000" },
      { key: "city", label: "City", placeholder: this.trip.city || "Dubrovnik" },
      { key: "country", label: "Country", placeholder: this.trip.country || "Croatia" },
    ];

    for (const part of parts) {
      new Setting(this.bodyEl).setName(part.label).setClass("awty-address-part").addText((t) => {
        t.setPlaceholder(part.placeholder);
        t.setValue(address[part.key]);
        t.onChange((v) => {
          address[part.key] = v.trim();
        });

        // The same two lists the trip itself is built from. Typed free-hand,
        // "USA", "United States of America" and "US" are three countries as far
        // as anything matching on them is concerned, and a city spelt the local
        // way will not line up with the trip it belongs to.
        if (part.key === "country") {
          new CountrySuggest(this.app, t.inputEl, (value) => {
            address.country = value;
          });
        }
        if (part.key === "city") {
          new CitySuggest(
            this.app,
            t.inputEl,
            // Narrowed by the country in this address when there is one, so a
            // trip to two countries still offers the right Victoria.
            () => address.country,
            (value, picked) => {
              address.city = value;
              // Picking a city names its country, and an address missing one is
              // an address a geocoder has to guess at.
              if (!address.country && picked) {
                address.country = picked;
                this.renderBody();
              }
            },
            () => this.trip.country,
          );
        }
      });
    }
  }

  /**
   * The coordinate to save, if any still describes where this is.
   *
   * A freshly picked Food Spot entry brought its own and is always right. An
   * inherited one is only right while the address is untouched; change so much
   * as the street and it is dropped, so the next travel-times run finds the new
   * place rather than reporting confidently on the old one.
   */
  /**
   * Take a coordinate that arrived with an address, and remember they agree.
   *
   * Without the second half, picking a place mid-edit set a coordinate and
   * changed the address in the same breath — and the check below, seeing an
   * address that no longer matched the one the form opened with, threw away the
   * coordinate that pick had just handed over.
   */
  private takeLocation(location: string): void {
    this.knownLocation = location;
    this.openedWithAddress = composeAddress(this.draft.postal);
  }

  private locationToKeep(): string {
    return keepLocation(this.knownLocation, this.draft.postal, this.openedWithAddress);
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
   * What a read confirmation found, once it has found something.
   *
   * The standing "paste your confirmation here" prompt is gone: pasting still
   * works anywhere in the wizard, and a line asking for it every time you open
   * the form is clutter on the nine visits out of ten when you are typing.
   */
  private renderConfirmationHint(): void {
    if (!this.readSummary) return;

    const row = this.bodyEl.createDiv({ cls: "awty-confirm-row" });
    setIcon(row.createSpan({ cls: "awty-confirm-row-icon is-done" }), "check");
    row.createSpan({ cls: "awty-confirm-row-done", text: this.readSummary });
    const again = row.createEl("button", { cls: "awty-confirm-link", text: "read another" });
    again.type = "button";
    again.addEventListener("click", () => {
      this.readSummary = "";
      this.renderBody();
    });
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
    // UTC calendar times become each airport's local time before anything
    // else: conversion can move a leg across midnight, which changes the
    // ordering and the split. Unknown airports leave everything in UTC with
    // the warning intact — mixing two clocks in one table is worse.
    let legs = parsed.legs;
    let converted = false;
    if (parsed.utcTimes) {
      const local = localiseLegs(parsed.legs);
      if (local) {
        legs = local;
        converted = true;
      }
    }

    const { outbound, back } = splitJourney(legs);
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

    const multi = looksLikeMoreJourneys(legs);
    this.readSummary = `Read ${detail.join(" · ")}${
      parsed.source === "ics" ? " from the calendar invite" : ""
    }${
      parsed.utcTimes
        ? converted
          ? " — converted from UTC to local airport time"
          : " — times are UTC in that calendar, so check them"
        : ""
    }${
      multi ? " — this looks like more than two journeys; check the legs, a booking holds one out and one back" : ""
    }`;
    if (multi) {
      new Notice(
        "This ticket looks like more than two journeys. A booking holds one outbound and one return — check the legs before saving.",
        10000,
      );
    }

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
    this.renderFlightHops();
    this.bodyEl.createDiv({ cls: "awty-section-label", text: "Outbound" });
    this.legsField = new LegsField({
      app: this.app,
      container: this.bodyEl.createDiv(),
      legs: this.draft.legs,
      defaultDate: this.draft.date,
      stars: this.stars,
      nearby: () => ({ country: this.trip.country, cities: tripCities(this.trip) }),
      isIdea: () => this.draft.status === "idea",
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
        nearby: () => ({ country: this.trip.country, cities: tripCities(this.trip) }),
        isIdea: () => this.draft.status === "idea",
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
    // Only ever an airline or an airport box, never the address group.
    const key = spec.key as TextFieldKey;

    setting.addText((t) => {
      input = t.inputEl;
      t.setPlaceholder(spec.placeholder);
      t.setValue(this.draft[key]);
      t.onChange((v) => {
        this.draft[key] = v.trim();
        syncStar();
      });

      if (kind === "airline") {
        new AirlineSuggest(
          this.app,
          t.inputEl,
          (value) => this.stars.isStarred("airline", value),
          (value) => {
            this.draft[key] = value;
            syncStar();
          },
        );
      } else {
        new AirportSuggest(
          this.app,
          t.inputEl,
          (value) => this.stars.isStarred("airport", value),
          (value) => {
            this.draft[key] = value;
            syncStar();
          },
        );
      }
    });

    const starBtn = setting.controlEl.createEl("button", { cls: "awty-star-btn" });
    syncStar = () => {
      const value = this.draft[key];
      const starred = value.length > 0 && this.stars.isStarred(kind, value);
      starBtn.empty();
      setIcon(starBtn, "star");
      starBtn.toggleClass("is-starred", starred);
      starBtn.toggleClass("is-disabled", value.length === 0);
      starBtn.setAttribute("aria-label", starred ? `Unstar ${value}` : `Star ${value || spec.label}`);
    };

    starBtn.addEventListener("click", async (evt) => {
      evt.preventDefault();
      const value = this.draft[key];
      if (!value) return;
      await this.stars.toggle(kind, value);
      syncStar();
      input.focus();
    });

    syncStar();
  }

  /** Stations and stops are best described by their city. */
  /**
   * The restaurant name, offering what Food Spot already knows.
   *
   * Picking one brings its address and its coordinates, so the distance from
   * the hotel needs no billed geocoding — and the booking joins that record
   * rather than starting a second one under the same name.
   */
  private renderRestaurantField(spec: FieldSpec): void {
    const setting = new Setting(this.bodyEl)
      .setName(spec.label)
      .setDesc("Starts typing against your Food Spot places in this city.");
    if (spec.required) markRequired(setting);
    setting.addText((t) => {
      t.setPlaceholder(spec.placeholder);
      t.setValue(this.draft.title);
      t.onChange((v) => (this.draft.title = v.trim()));
      new FoodSpotSuggest(
        this.app,
        t.inputEl,
        // Restaurants anywhere on the route, not only in the first city.
        () => tripCities(this.trip).join("|"),
        (entry) => {
          this.draft.title = entry.name;
          if (entry.address) this.draft.postal = splitLegacyAddress(entry.address);
          this.takeLocation(entry.location);
          this.renderBody();
        },
      );
    });
  }

  /** This trip's places, for the transfer pickers and the shortcuts. */
  private endpoints(): Endpoint[] {
    return tripEndpoints(this.tripBookings?.() ?? [], (booking) =>
      String(this.app.metadataCache.getFileCache(booking.file)?.frontmatter?.location ?? ""),
    );
  }

  /**
   * A transfer's end, which is usually somewhere the trip already knows.
   *
   * Picking one brings its address and coordinates, so the transfer has a
   * position and a travel time without anything being typed twice or geocoded.
   */
  private renderEndpointField(spec: FieldSpec): void {
    const setting = new Setting(this.bodyEl).setName(spec.label);
    if (spec.required) markRequired(setting);
    // Only "from" and "to" reach here, never the address group.
    const key = spec.key as TextFieldKey;
    setting.addText((t) => {
      t.setPlaceholder(this.transportPlaceholder(spec));
      t.setValue(this.draft[key]);
      t.onChange((v) => (this.draft[key] = v.trim()));
      new EndpointSuggest(
        this.app,
        t.inputEl,
        () =>
          this.endpoints().map((e) => ({
            label: e.label,
            hint: e.kind,
            address: e.address,
            location: e.location,
          })),
        () => this.trip.country,
        (hit) => {
          this.draft[key] = hit.label;
          // Each end brings its own address; the destination also brings the
          // coordinates, since that is where the booking sits on a map. The
          // address arrives as one line from a booking written elsewhere, so it
          // lands on the first line rather than being guessed apart.
          if (spec.key === "to") {
            if (hit.address) this.draft.postal = splitLegacyAddress(hit.address);
            if (hit.location) this.takeLocation(hit.location);
          } else if (spec.key === "from" && hit.address) {
            this.draft.fromPostal = splitLegacyAddress(hit.address);
          }
          this.renderBody();
        },
      );
    });
  }

  /**
   * The flights this route implies, one click each.
   *
   * A booking holds one journey — out and optionally back — so a trip through
   * several countries is several bookings. Nothing prevented that, and nothing
   * suggested it either; this names the hops and fills in the airport codes
   * for cities the trip already knows.
   */
  private renderFlightHops(): void {
    const stops = tripStops(this.trip);
    if (stops.length < 2) return;

    const hops = flightHops(stops, this.trip.originAirport);
    if (hops.length === 0) return;

    const setting = new Setting(this.bodyEl)
      .setName("Flights this route needs")
      .setDesc("One booking per journey. Fills the first leg; add the others as their own flights.");
    setting.settingEl.addClass("awty-setting-stack");
    const row = setting.controlEl.createDiv({ cls: "awty-chip-row" });

    for (const hop of hops) {
      const chip = row.createEl("button", { cls: "awty-chip" });
      chip.type = "button";
      chip.setText(hop.label);
      chip.addEventListener("click", () => {
        // Fill the flight being worked on — the last one — not always the
        // first. Adding a second flight and then picking a hop wrote the hop
        // over flight one and left flight two blank.
        const legs = this.draft.legs;
        if (legs.length === 0) legs.push(emptyLeg(this.draft.date));
        const groups = groupJourneys(legs);
        const target = groups[groups.length - 1][0];
        target.from = hop.from;
        target.to = hop.to;
        this.renderBody();
      });
    }
  }

  /** One click for the transfers every trip has. */
  private renderTransferShortcuts(): void {
    const shortcuts = transferShortcuts(this.endpoints());
    if (shortcuts.length === 0) return;

    const setting = new Setting(this.bodyEl)
      .setName("Common transfers")
      .setDesc("Fills both ends from this trip's own bookings.");
    setting.settingEl.addClass("awty-setting-stack");
    const row = setting.controlEl.createDiv({ cls: "awty-chip-row" });

    for (const shortcut of shortcuts) {
      const chip = row.createEl("button", { cls: "awty-chip" });
      chip.setText(shortcut.label);
      chip.addEventListener("click", () => {
        this.draft.from = shortcut.from.label;
        this.draft.to = shortcut.to.label;
        if (shortcut.from.address) this.draft.fromPostal = splitLegacyAddress(shortcut.from.address);
        if (shortcut.to.address) this.draft.postal = splitLegacyAddress(shortcut.to.address);
        if (shortcut.to.location) this.takeLocation(shortcut.to.location);
        this.renderBody();
      });
    }
  }

  private renderCityField(spec: FieldSpec): void {
    const setting = new Setting(this.bodyEl).setName(spec.label);
    if (spec.required) markRequired(setting);
    const key = spec.key as TextFieldKey;
    setting.addText((t) => {
      t.setPlaceholder(spec.placeholder);
      t.setValue(this.draft[key]);
      t.onChange((v) => (this.draft[key] = v.trim()));
      new CitySuggest(
        this.app,
        t.inputEl,
        () => this.trip.country,
        (value) => (this.draft[key] = value),
      );
    });
  }

  private renderWhen(): void {
    const isStay = this.draft.kind === "stay";
    // A table is booked for a time on a day. Asking for an end invited an end
    // earlier than the start, and described it as departure and arrival.
    const oneMoment = this.draft.kind === "restaurant";
    // Before anything is drawn: lifting the end time into the return after the
    // rows were built left the old value on screen in both boxes.
    this.offerReturn();
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
      // No min or max. They were meant as a nudge towards the trip's own dates
      // and are nothing of the sort: the native picker greys out every day
      // outside them, so a ferry taken last week could not be written down at
      // all. Bookings get entered after the fact — from a quay, from a hotel
      // bar — and a form that refuses yesterday is a form you fight. The picker
      // still opens on the right month, because the date starts on the trip's.
      date.addEventListener("change", () => {
        onChange(date.value);
        this.renderBody();
      });

      const time = row.createEl("input", { cls: "awty-time-input" });
      time.type = "time";
      time.value = timeValue;
      time.setAttribute("aria-label", timeLabel);
      time.addEventListener("change", () => onTime(time.value));
    };

    dateRow(
      oneMoment ? "When" : isStay ? "Check-in" : "Start",
      this.draft.date,
      (v) => {
        this.draft.date = v;
        // The end has to follow, and be seen to: nudging the draft without
        // redrawing left an end date on screen that was before the start. The
        // redraw is the caller's now — every date change gets one.
        if (oneMoment || this.draft.endDate < v) this.draft.endDate = v;
      },
      oneMoment ? "Time" : "Start time",
      this.draft.time,
      (v) => (this.draft.time = v),
    );

    if (oneMoment) {
      this.draft.endDate = this.draft.date;
      this.draft.endTime = "";
      wrap.createDiv({
        cls: "awty-date-readout",
        text: "A table is booked for one sitting, so there is no end to give.",
      });
      this.renderOutsideTrip(wrap);
      return;
    }

    const isTransfer = this.draft.kind === "transport";

    dateRow(
      isStay ? "Check-out" : isTransfer ? "Arrives" : "End",
      this.draft.endDate,
      (v) => (this.draft.endDate = v),
      isTransfer ? "Arrival time" : "End time",
      this.draft.endTime,
      (v) => (this.draft.endTime = v),
    );

    wrap.createDiv({
      cls: "awty-date-readout",
      text: isStay
        ? "Leave check-out the same as check-in for a single night."
        : isTransfer
          ? "When this journey puts you down. Leave it alone for a hop with no arrival worth recording."
          : "Leave the end the same as the start for something that begins and ends on one day.",
    });

    if (isTransfer) this.renderReturnRow(wrap, dateRow);
    this.renderOutsideTrip(wrap);
  }

  /**
   * The way back, asked outright.
   *
   * A ferry out at ten and back at quarter to seven is one booking, and the
   * return had nowhere to live: put in the end time it was indistinguishable
   * from arriving somewhere else that evening, and the itinerary — which has to
   * choose a place to write — showed neither. So it is a question now, and the
   * two readings put different rows on different days.
   *
   * A booking that already has an end time on its own start day gets the box
   * ticked and that time offered, because a same-day end on a journey is very
   * nearly always the way home. Offered, not assumed: it is on screen, and
   * nothing is written until Save.
   */
  /**
   * A same-day end time offered as the way home.
   *
   * Written before the return existed, "10:00 → 18:45" on a ferry to an island
   * meant coming back — but it is indistinguishable from arriving somewhere
   * else that evening, so the itinerary showed neither. The guess is made once,
   * put on screen with the box ticked, and written only if you press Save.
   */
  private offerReturn(): void {
    if (this.draft.kind !== "transport" || this.returnAsked) return;
    this.returnAsked = true;
    const sameDayEnd =
      Boolean(this.draft.endTime) &&
      this.draft.endDate === this.draft.date &&
      !this.draft.returnDate;
    if (!sameDayEnd) return;
    this.draft.returnDate = this.draft.date;
    this.draft.returnTime = this.draft.endTime;
    this.draft.endTime = "";
    this.returnLifted = true;
  }

  private renderReturnRow(
    wrap: HTMLElement,
    dateRow: (
      label: string,
      value: string,
      onChange: (v: string) => void,
      timeLabel: string,
      timeValue: string,
      onTime: (v: string) => void,
    ) => void,
  ): void {
    const on = Boolean(this.draft.returnDate);
    const toggle = new Setting(wrap)
      .setName("Coming back the same way")
      .setDesc(
        this.returnLifted
          ? "Taken from this booking's end time. Untick it if the journey was one-way."
          : "For a return ticket — a day trip out and back, a hire car brought home.",
      )
      .addToggle((t) => {
        t.setValue(on);
        t.onChange((value) => {
          this.returnAsked = true;
          this.returnLifted = false;
          this.draft.returnDate = value ? this.draft.returnDate || this.draft.date : "";
          this.draft.returnTime = value ? this.draft.returnTime : "";
          this.renderBody();
        });
      });
    toggle.settingEl.addClass("awty-setting-stack");

    if (!on) return;
    dateRow(
      "Back",
      this.draft.returnDate,
      (v) => (this.draft.returnDate = v),
      "Return time",
      this.draft.returnTime,
      (v) => (this.draft.returnTime = v),
    );
  }

  /**
   * Said, not stopped.
   *
   * A date outside the trip is usually a typo and occasionally the point — a
   * train the day before, a hotel night on the way home. Refusing it was the
   * old behaviour and it made recording a leg after the fact impossible; saying
   * so keeps the catch without the fence.
   */
  private renderOutsideTrip(wrap: HTMLElement): void {
    const { startDate, endDate } = this.trip;
    if (!isValidISODate(startDate) || !isValidISODate(endDate)) return;
    const outside = [this.draft.date, this.draft.endDate].filter(
      (date) => isValidISODate(date) && (date < startDate || date > endDate),
    );
    if (outside.length === 0) return;
    wrap.createDiv({
      cls: "awty-date-outside",
      text: `Outside the trip (${formatDateRange(startDate, endDate)}) — saved anyway.`,
    });
  }

  private renderCost(): void {
    // Two flights days apart usually have two prices; the legs of a connection
    // share one, because that is how they are sold.
    const groups = this.draft.kind === "flight" ? groupJourneys(this.draft.legs) : [];
    if (groups.length > 1) {
      this.renderPerFlightCost(groups);
    } else {
      this.renderSingleCost();
    }

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

  /** One price per flight, adding up to what the booking cost. */
  private renderPerFlightCost(groups: FlightLeg[][]): void {
    this.bodyEl.createDiv({
      cls: "awty-dash-hint",
      text: "This booking holds more than one flight, so each is priced on its own. Connections within a flight share its price.",
    });

    for (const [index, group] of groups.entries()) {
      const first = group[0];
      const route = routeTitle(group) || `Flight ${index + 1}`;
      new Setting(this.bodyEl)
        .setName(`Flight ${index + 1}`)
        .setDesc(route)
        .addText((t) => {
          t.setPlaceholder("450");
          t.setValue(first.cost ? String(first.cost) : "");
          t.inputEl.inputMode = "decimal";
          t.onChange((v) => {
            const value = parseAmount(v);
            first.cost = value !== null && value > 0 ? value : undefined;
            this.applyJourneyCosts();
            this.renderCostPreview();
          });
        });
    }

    new Setting(this.bodyEl)
      .setName("Currency")
      .setDesc("One currency for the booking.")
      .addDropdown((dd) => {
        const options = new Set([this.currency, ...COMMON_CURRENCIES]);
        for (const c of options) dd.addOption(c, c);
        dd.setValue(this.draft.currency);
        dd.onChange((v) => {
          this.draft.currency = v;
          this.renderCostPreview();
        });
      });
  }

  /** Adds the per-flight prices into the one figure the rest of the plugin reads. */
  private applyJourneyCosts(): void {
    const total = journeyCostTotal(this.draft.legs);
    this.draft.amount = total;
    this.amountRaw = total === null ? "" : String(total);
  }

  private renderSingleCost(): void {
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

    const missingField = FIELDS[this.draft.kind].find(
      (spec) => spec.required && !this.fieldValue(spec.key).trim(),
    );
    if (missingField) {
      new Notice(`${missingField.label} is needed before this can be saved.`);
      this.go(0);
      return;
    }

    // A leg missing anything cannot be identified, placed, timed or ordered.
    // An idea is exempt: it is a placeholder for a flight not yet booked.
    if (this.draft.kind === "flight" && this.draft.status !== "idea") {
      const gap = firstIncompleteLeg([...this.draft.legs, ...this.draft.returnLegs]);
      if (gap) {
        new Notice(`${gap} is needed on every leg — set the status to Idea to save it unfinished.`);
        this.go(0);
        return;
      }
    }

    this.submitting = true;
    this.nextBtn.setDisabled(true).setButtonText("Saving…");
    try {
      await this.onSubmit(
        {
          ...this.draft,
          title: this.effectiveTitle(),
          location: this.locationToKeep() || undefined,
        },
        this.attachments.getFiles(),
      );
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
