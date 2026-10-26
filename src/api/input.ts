/**
 * Reading a request body into something the writers accept.
 *
 * Everything is checked before anything is written: a bad field refuses the
 * whole request with a 400, so a client never gets half a booking. Unknown
 * fields are refused too — `start_date` instead of `startDate` would otherwise
 * be ignored, and the reply would look like it had worked.
 */
import type { AwtySettings, SubNoteId, Trip, TripDraft, TripStop } from "../types";
import { CREATABLE_SUB_NOTES, isCreatableStage, isTripKind, isTripStage, kindDef } from "../types";
import type { BookingDraft } from "../bookings/bookingWriter";
import type { BookingKind, BookingStatus } from "../bookings/types";
import { BOOKING_KINDS, isBookingStatus } from "../bookings/types";
import type { FlightLeg } from "../bookings/legs";
import type { PostalAddress } from "../bookings/postalAddress";
import { readMode } from "../bookings/transportMode";
import type { Moment } from "../trips/moments";
import { isValidISODate } from "../util/dates";

/** Thrown by a validator; the router turns it into a 400 before anything is written. */
export class BadInput extends Error {}

/** The booking kinds this version of the API writes. Every kind can be read. */
export const WRITABLE_KINDS: readonly BookingKind[] = ["flight", "stay", "transport"];

type Body = Record<string, unknown>;

const CONTROL = /[\u0000-\u001f\u007f]/;
/** Newlines and tabs are fine in a story; nothing else below a space is. */
const CONTROL_EXCEPT_BREAKS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function asBody(v: unknown): Body {
  if (v === undefined) return {};
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new BadInput("Body must be a JSON object");
  return v as Body;
}

export const has = (body: Body, key: string): boolean => Object.prototype.hasOwnProperty.call(body, key);

function only(body: Body, allowed: readonly string[]): void {
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length > 0) throw new BadInput(`Unknown field${extra.length > 1 ? "s" : ""}: ${extra.join(", ")}`);
}

/**
 * A single-line string. `null` and "" both mean empty. A newline would forge a
 * frontmatter key or break a heading, so control characters are refused.
 */
function line(v: unknown, field: string, max = 300): string {
  if (v === null || v === undefined) return "";
  if (typeof v !== "string") throw new BadInput(`${field} must be a string`);
  if (CONTROL.test(v)) throw new BadInput(`${field} must not contain line breaks or control characters`);
  if (v.length > max) throw new BadInput(`${field} is longer than ${max} characters`);
  return v.trim();
}

/** A piece of writing: line breaks are allowed. */
function prose(v: unknown, field: string, max = 20_000): string {
  if (v === null || v === undefined) return "";
  if (typeof v !== "string") throw new BadInput(`${field} must be a string`);
  if (CONTROL_EXCEPT_BREAKS.test(v)) throw new BadInput(`${field} must not contain control characters`);
  if (v.length > max) throw new BadInput(`${field} is longer than ${max} characters`);
  return v.replace(/\r\n?/g, "\n").trim();
}

function date(v: unknown, field: string): string {
  if (v === null || v === undefined || v === "") return "";
  if (!isValidISODate(v)) throw new BadInput(`${field} must be a real date, YYYY-MM-DD`);
  return v;
}

function time(v: unknown, field: string): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new BadInput(`${field} must be a time, HH:MM`);
  return v;
}

function money(v: unknown, field: string): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new BadInput(`${field} must be a number, 0 or more`);
  return Math.round(v * 100) / 100;
}

function currency(v: unknown, field: string): string {
  if (typeof v !== "string" || !/^[A-Za-z]{3}$/.test(v.trim())) throw new BadInput(`${field} must be a three-letter currency code`);
  return v.trim().toUpperCase();
}

function lines(v: unknown, field: string): string[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw new BadInput(`${field} must be a list of strings`);
  return v.map((x, i) => line(x, `${field}[${i}]`)).filter(Boolean);
}

function bool(v: unknown, field: string): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v !== "boolean") throw new BadInput(`${field} must be true or false`);
  return v;
}

// ------------------------------------------------------------------ trips

const TRIP_FIELDS = [
  "title", "kind", "stage", "startDate", "endDate", "country", "city", "stops", "venue",
  "travellers", "originCity", "originAirport", "budgetTotal", "passports",
] as const;

function stops(v: unknown): TripStop[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw new BadInput("stops must be a list of { country, city }");
  return v
    .map((s, i) => {
      if (!s || typeof s !== "object" || Array.isArray(s)) throw new BadInput(`stops[${i}] must be { country, city }`);
      const r = s as Body;
      only(r, ["country", "city"]);
      return { country: line(r.country, `stops[${i}].country`), city: line(r.city, `stops[${i}].city`) };
    })
    .filter((s) => s.country || s.city);
}

/** A trip's current values as the editor would open them. */
export function tripDraftFrom(trip: Trip): TripDraft {
  return {
    title: trip.title,
    kind: trip.kind,
    // What the note says, not what the calendar implies, so a PATCH that only
    // changes the title does not also write a stage nobody chose.
    stage: trip.storedStage,
    country: trip.country,
    city: trip.city,
    stops: trip.stops.map((s) => ({ ...s })),
    venue: trip.venue,
    startDate: trip.startDate,
    endDate: trip.endDate,
    notes: "",
    subNotes: [],
    travellers: [...trip.travellers],
    originCity: trip.originCity,
    originAirport: trip.originAirport,
    budgetTotal: trip.budgetTotal,
    passports: [...trip.passports],
  };
}

/** Applies the trip fields in a body to a draft. Only what the body names changes. */
function applyTripFields(draft: TripDraft, body: Body, creating: boolean): TripDraft {
  const next: TripDraft = { ...draft, stops: draft.stops.map((s) => ({ ...s })) };
  if (has(body, "title")) {
    next.title = line(body.title, "title", 200);
    if (!next.title) throw new BadInput("title must not be empty");
  }
  if (has(body, "kind")) {
    if (!isTripKind(body.kind)) throw new BadInput("kind must be one of holiday, city-break, day-trip, concert, event, business");
    next.kind = body.kind;
  }
  if (has(body, "stage")) {
    if (creating ? !isCreatableStage(body.stage) : !isTripStage(body.stage)) {
      throw new BadInput(creating ? "stage must be planning or going for a new trip" : "stage must be one of planning, going, went, cancelled");
    }
    next.stage = body.stage as TripDraft["stage"];
  }
  if (has(body, "startDate")) {
    next.startDate = date(body.startDate, "startDate");
    if (!next.startDate) throw new BadInput("startDate must be a real date, YYYY-MM-DD");
  }
  if (has(body, "endDate")) next.endDate = date(body.endDate, "endDate") || next.startDate;
  if (has(body, "stops")) {
    next.stops = stops(body.stops);
    next.country = next.stops[0]?.country ?? "";
    next.city = next.stops[0]?.city ?? "";
  }
  // country and city name the first stop; on their own they move it.
  if (has(body, "country") || has(body, "city")) {
    const first = next.stops[0] ?? { country: next.country, city: next.city };
    if (has(body, "country")) first.country = line(body.country, "country");
    if (has(body, "city")) first.city = line(body.city, "city");
    next.stops = [first, ...next.stops.slice(1)];
    next.country = first.country;
    next.city = first.city;
  }
  if (has(body, "venue")) next.venue = line(body.venue, "venue");
  if (has(body, "travellers")) next.travellers = lines(body.travellers, "travellers");
  if (has(body, "passports")) next.passports = lines(body.passports, "passports");
  if (has(body, "originCity")) next.originCity = line(body.originCity, "originCity");
  if (has(body, "originAirport")) next.originAirport = line(body.originAirport, "originAirport");
  if (has(body, "budgetTotal")) {
    const total = money(body.budgetTotal, "budgetTotal");
    next.budgetTotal = total && total > 0 ? total : null;
  }

  if (kindDef(next.kind).singleDay) next.endDate = next.startDate;
  if (!next.endDate) next.endDate = next.startDate;
  if (next.endDate < next.startDate) throw new BadInput("endDate must not be before startDate");
  return next;
}

/** A new trip from a POST body, with the defaults the new-trip form would use. */
export function newTripDraft(raw: unknown, settings: AwtySettings): TripDraft {
  const body = asBody(raw);
  only(body, [...TRIP_FIELDS, "subNotes"]);
  if (!has(body, "title")) throw new BadInput("title is required");
  if (!has(body, "startDate")) throw new BadInput("startDate is required");
  const kind = isTripKind(body.kind) ? body.kind : settings.defaultKind;
  let subNotes: SubNoteId[] = [...(settings.subNotesByKind[kind] ?? kindDef(kind).subNotes)];
  if (has(body, "subNotes")) {
    if (!Array.isArray(body.subNotes) || body.subNotes.some((s) => !CREATABLE_SUB_NOTES.includes(s as SubNoteId))) {
      throw new BadInput(`subNotes must be a list of ${CREATABLE_SUB_NOTES.join(", ")}`);
    }
    subNotes = [...new Set(body.subNotes as SubNoteId[])];
  }
  const base: TripDraft = {
    title: "",
    kind,
    stage: isCreatableStage(settings.defaultStage) ? settings.defaultStage : "planning",
    country: settings.defaultCountry,
    city: "",
    stops: [{ country: settings.defaultCountry, city: "" }],
    venue: "",
    startDate: "",
    endDate: "",
    notes: "",
    subNotes,
    travellers: [...settings.household],
    originCity: settings.homeCity,
    originAirport: settings.homeAirport,
    budgetTotal: null,
    passports: [...settings.passportCountries],
  };
  return applyTripFields(base, body, true);
}

/** A trip's draft with a PATCH body applied. */
export function patchTripDraft(trip: Trip, raw: unknown): TripDraft {
  const body = asBody(raw);
  only(body, TRIP_FIELDS);
  return applyTripFields(tripDraftFrom(trip), body, false);
}

/** Whether two drafts would write the same note. */
export function sameTrip(a: TripDraft, b: TripDraft): boolean {
  const key = (d: TripDraft): string =>
    JSON.stringify([d.title, d.kind, d.stage, d.stops, d.country, d.city, kindDef(d.kind).hasVenue ? d.venue : "",
      d.startDate, d.endDate, d.travellers, d.originCity, d.originAirport, d.budgetTotal, d.passports]);
  return key(a) === key(b);
}

// --------------------------------------------------------------- bookings

const BOOKING_FIELDS = [
  "kind", "status", "title", "date", "endDate", "time", "endTime", "cost", "currency", "category",
  "reference", "from", "to", "operator", "seat", "notes", "mode", "address", "fromAddress", "legs",
  "returnLegs", "returnDate", "returnTime", "returnEndDate", "returnEndTime", "returnFrom", "returnTo",
  "returnOperator", "returnService",
] as const;

const FLIGHT_ONLY = ["legs", "returnLegs"];
const TRANSPORT_ONLY = ["mode", "fromAddress"];
const NOT_FLIGHT = ["returnDate", "returnTime", "returnEndDate", "returnEndTime", "returnFrom", "returnTo", "returnOperator", "returnService"];

const EMPTY_POSTAL: PostalAddress = { line1: "", line2: "", postcode: "", city: "", country: "" };

function postal(v: unknown, field: string): PostalAddress {
  if (v === null || v === undefined) return { ...EMPTY_POSTAL };
  if (typeof v !== "object" || Array.isArray(v)) throw new BadInput(`${field} must be { line1, line2, postcode, city, country }`);
  const r = v as Body;
  only(r, ["line1", "line2", "postcode", "city", "country"]);
  return {
    line1: line(r.line1, `${field}.line1`),
    line2: line(r.line2, `${field}.line2`),
    postcode: line(r.postcode, `${field}.postcode`),
    city: line(r.city, `${field}.city`),
    country: line(r.country, `${field}.country`),
  };
}

const LEG_FIELDS = ["airline", "flight", "from", "to", "date", "departs", "arrivesOn", "arrives", "separate", "cost"];

function legs(v: unknown, field: string): FlightLeg[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) throw new BadInput(`${field} must be a list of legs`);
  return v.map((raw, i) => {
    const at = `${field}[${i}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadInput(`${at} must be an object`);
    const r = raw as Body;
    only(r, LEG_FIELDS);
    const leg: FlightLeg = {
      operator: line(r.airline, `${at}.airline`),
      number: line(r.flight, `${at}.flight`),
      from: line(r.from, `${at}.from`),
      to: line(r.to, `${at}.to`),
      date: date(r.date, `${at}.date`),
      depTime: time(r.departs, `${at}.departs`),
      arrDate: "",
      arrTime: time(r.arrives, `${at}.arrives`),
    };
    if (!leg.date) throw new BadInput(`${at}.date is required`);
    leg.arrDate = date(r.arrivesOn, `${at}.arrivesOn`) || leg.date;
    if (leg.arrDate < leg.date) throw new BadInput(`${at}.arrivesOn must not be before ${at}.date`);
    if (bool(r.separate, `${at}.separate`)) leg.separate = true;
    const cost = money(r.cost, `${at}.cost`);
    if (cost !== null && cost > 0) leg.cost = cost;
    return leg;
  });
}

/** An empty booking of a kind, as the booking form would start one. */
export function emptyBookingDraft(kind: BookingKind, trip: Trip, defaultCurrency: string): BookingDraft {
  const start = isValidISODate(trip.startDate) ? trip.startDate : "";
  return {
    kind,
    status: "booked",
    title: "",
    date: start,
    endDate: kind === "stay" && isValidISODate(trip.endDate) ? trip.endDate : start,
    time: "",
    endTime: "",
    amount: null,
    currency: defaultCurrency,
    category: BOOKING_KINDS.find((k) => k.id === kind)?.category ?? "Misc",
    reference: "",
    from: "",
    to: "",
    postal: { ...EMPTY_POSTAL },
    fromPostal: { ...EMPTY_POSTAL },
    operator: "",
    seat: "",
    notes: "",
    attachments: [],
    legs: [],
    returnLegs: [],
    ports: [],
    where: "",
    cruise: "",
    mode: "",
    returnDate: "",
    returnTime: "",
    returnEndDate: "",
    returnEndTime: "",
    returnFrom: "",
    returnTo: "",
    returnOperator: "",
    returnService: "",
  };
}

/** Applies the booking fields in a body to a draft. Only what the body names changes. */
function applyBookingFields(draft: BookingDraft, body: Body): BookingDraft {
  const next: BookingDraft = { ...draft };
  const kind = next.kind;
  const misplaced = [
    ...(kind !== "flight" ? FLIGHT_ONLY : NOT_FLIGHT),
    ...(kind !== "transport" ? TRANSPORT_ONLY : []),
  ].filter((k) => has(body, k));
  if (misplaced.length > 0) throw new BadInput(`${misplaced.join(", ")} cannot be set on a ${kind} booking`);

  if (has(body, "status")) {
    if (typeof body.status !== "string" || !isBookingStatus(body.status)) throw new BadInput("status must be one of idea, reserved, booked, cancelled");
    next.status = body.status as BookingStatus;
  }
  if (has(body, "title")) {
    next.title = line(body.title, "title", 200);
    if (!next.title) throw new BadInput("title must not be empty");
  }
  if (has(body, "date")) {
    next.date = date(body.date, "date");
    if (!next.date) throw new BadInput("date must be a real date, YYYY-MM-DD");
  }
  if (has(body, "endDate")) next.endDate = date(body.endDate, "endDate");
  if (has(body, "time")) next.time = time(body.time, "time");
  if (has(body, "endTime")) next.endTime = time(body.endTime, "endTime");
  if (has(body, "cost")) next.amount = money(body.cost, "cost");
  if (has(body, "currency")) next.currency = currency(body.currency, "currency");
  if (has(body, "category")) {
    next.category = line(body.category, "category", 60);
    if (!next.category) throw new BadInput("category must not be empty");
  }
  for (const key of ["reference", "from", "to", "operator", "seat"] as const) {
    if (has(body, key)) next[key] = line(body[key], key);
  }
  if (has(body, "notes")) next.notes = prose(body.notes, "notes");
  if (has(body, "mode")) {
    const mode = readMode(body.mode);
    if (body.mode !== null && body.mode !== "" && !mode) throw new BadInput("mode must be one of train, bus, ferry, car, camper, metro, taxi, shuttle, bike, walk, other");
    next.mode = mode;
  }
  if (has(body, "address")) next.postal = postal(body.address, "address");
  if (has(body, "fromAddress")) next.fromPostal = postal(body.fromAddress, "fromAddress");
  if (has(body, "legs")) next.legs = legs(body.legs, "legs");
  if (has(body, "returnLegs")) next.returnLegs = legs(body.returnLegs, "returnLegs");
  if (has(body, "returnDate")) next.returnDate = date(body.returnDate, "returnDate");
  if (has(body, "returnTime")) next.returnTime = time(body.returnTime, "returnTime");
  if (has(body, "returnEndDate")) next.returnEndDate = date(body.returnEndDate, "returnEndDate");
  if (has(body, "returnEndTime")) next.returnEndTime = time(body.returnEndTime, "returnEndTime");
  for (const key of ["returnFrom", "returnTo", "returnOperator", "returnService"] as const) {
    if (has(body, key)) next[key] = line(body[key], key);
  }

  // A flight is its legs. One sent with only a route and a date gets the one
  // leg that says so, or the timeline and the map would have nothing to draw.
  if (kind === "flight" && next.legs.length === 0 && next.from && next.to && next.date) {
    next.legs = [{ operator: next.operator, number: "", from: next.from, to: next.to, date: next.date, depTime: next.time, arrDate: next.endDate || next.date, arrTime: next.endTime }];
  }
  if (kind === "flight" && next.legs.length > 0) {
    if (has(body, "date") && !has(body, "legs") && next.date !== next.legs[0].date) {
      throw new BadInput("a flight leaves when its first leg does; send legs to move it");
    }
    // The booking's own date is when the first flight leaves; the form keeps
    // them in step, and the timeline reads the booking's.
    next.date = next.legs[0].date;
    next.from = next.from || next.legs[0].from;
    next.to = next.to || next.legs[next.legs.length - 1].to;
  }
  if (!next.endDate || next.endDate < next.date) {
    if (has(body, "endDate") && next.endDate) throw new BadInput("endDate must not be before date");
    next.endDate = next.date;
  }
  if (next.returnDate && next.returnDate < next.date) throw new BadInput("returnDate must not be before date");
  if ((next.returnTime || next.returnEndTime || next.returnFrom || next.returnTo) && !next.returnDate) {
    throw new BadInput("returnDate is required for the rest of a return journey");
  }
  return next;
}

/** A new booking from a POST body. */
export function newBookingDraft(raw: unknown, trip: Trip, defaultCurrency: string): BookingDraft {
  const body = asBody(raw);
  only(body, BOOKING_FIELDS);
  if (!WRITABLE_KINDS.includes(body.kind as BookingKind)) throw new BadInput(`kind must be one of ${WRITABLE_KINDS.join(", ")}`);
  if (!has(body, "title")) throw new BadInput("title is required");
  const kind = body.kind as BookingKind;
  if (kind !== "flight" && !has(body, "date") && !isValidISODate(trip.startDate)) throw new BadInput("date is required");
  const { kind: _kind, ...rest } = body;
  return applyBookingFields(emptyBookingDraft(kind, trip, defaultCurrency), rest);
}

/** A booking's draft with a PATCH body applied. The kind of a booking does not change. */
export function patchBookingDraft(current: BookingDraft, raw: unknown): BookingDraft {
  const body = asBody(raw);
  only(body, BOOKING_FIELDS);
  if (has(body, "kind") && body.kind !== current.kind) throw new BadInput("kind cannot change; delete the booking and create a new one");
  const { kind: _kind, ...rest } = body;
  return applyBookingFields(current, rest);
}

/** Whether two drafts would write the same note. Attachments travel unchanged and are left out. */
export function sameBooking(a: BookingDraft, b: BookingDraft): boolean {
  const key = (d: BookingDraft): string => JSON.stringify({ ...d, attachments: [], location: "" });
  return key(a) === key(b);
}

// ---------------------------------------------------------------- moments

const MOMENT_FIELDS = ["date", "title", "text"] as const;

/** The days a moment can belong to: the trip's own, start to end. */
type TripDays = Pick<Trip, "startDate" | "endDate">;

function applyMomentFields(moment: Moment, body: Body, trip: TripDays): Moment {
  const next = { ...moment };
  if (has(body, "date")) next.date = date(body.date, "date");
  if (has(body, "title")) next.title = line(body.title, "title", 200);
  if (has(body, "text")) next.text = prose(body.text, "text");
  if (!next.text) throw new BadInput("text must not be empty");
  // A moment over the API is a day of the trip. One that "happened" a week
  // before it began is a typo, and the trip's timeline has nowhere to put it.
  if (!next.date) throw new BadInput("date is required, YYYY-MM-DD, within the trip");
  const end = trip.endDate || trip.startDate;
  if (next.date < trip.startDate || next.date > end) {
    throw new BadInput(`date must be within the trip, ${trip.startDate} to ${end}`);
  }
  return next;
}

export function newMoment(raw: unknown, trip: TripDays): Moment {
  const body = asBody(raw);
  only(body, MOMENT_FIELDS);
  if (!has(body, "text")) throw new BadInput("text is required");
  if (!has(body, "date")) throw new BadInput("date is required, YYYY-MM-DD, within the trip");
  return applyMomentFields({ date: "", title: "", text: "" }, body, trip);
}

export function patchMoment(current: Moment, raw: unknown, trip: TripDays): Moment {
  const body = asBody(raw);
  only(body, MOMENT_FIELDS);
  return applyMomentFields(current, body, trip);
}
