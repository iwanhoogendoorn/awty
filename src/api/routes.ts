/**
 * The API as a pure function: a request in, a JSON response out.
 *
 * Every write goes through the same writers the modals use — createTrip,
 * updateBooking, saveMoments — handed in as `ApiDeps`, so an outside caller
 * cannot skip the bookkeeping (the budget table, the Moments section, links
 * that follow a rename) that keeps a trip's notes agreeing with each other.
 * Nothing here imports Obsidian, which is what lets the tests drive it.
 */
import type { AwtySettings, Trip, TripDraft, TripStage, TripStatus } from "../types";
import type { Booking, BookingKind } from "../bookings/types";
import type { BookingDraft } from "../bookings/bookingWriter";
import type { Moment } from "../trips/moments";
import { BOOKING_KINDS } from "../bookings/types";
import { API_VERSION } from "./base";
import { BadInput, WRITABLE_KINDS, newBookingDraft, newMoment, newTripDraft, patchBookingDraft, patchMoment, patchTripDraft, sameBooking, sameTrip } from "./input";
import { bookingId, bookingJson, momentIds, momentJson, momentsJson, tripId, tripJson } from "./json";
import { freshId } from "../util/hash";

export interface ApiDeps {
  version: string;
  vaultName: string;
  today: () => string;
  /** Changes only when a note under the trips folder actually changes. */
  revision: () => number;
  remoteWrites: () => boolean;
  settings: () => AwtySettings;
  trips: () => Trip[];
  bookings: (trip: Trip) => Booking[];
  /** The trip's own currency, else the vault default. */
  currency: (trip: Trip) => string;
  /**
   * Runs one write: one at a time, recording every vault path it touches, and
   * returning only once the metadata cache has caught up — so the reply is
   * read from what the notes now say, not from what they said a moment ago.
   */
  write: <T>(fn: () => Promise<T>) => Promise<WriteResult<T>>;
  /** Each returns the path of the note it wrote, after any rename. */
  createTrip: (draft: TripDraft) => Promise<string>;
  updateTrip: (trip: Trip, draft: TripDraft) => Promise<string>;
  deleteTrip: (trip: Trip) => Promise<void>;
  /** A saved booking as the booking form would reopen it. */
  bookingDraft: (trip: Trip, booking: Booking) => Promise<BookingDraft>;
  createBooking: (trip: Trip, draft: BookingDraft) => Promise<string>;
  updateBooking: (trip: Trip, booking: Booking, draft: BookingDraft) => Promise<string>;
  deleteBooking: (trip: Trip, booking: Booking) => Promise<void>;
  saveMoments: (trip: Trip, moments: Moment[]) => Promise<void>;
}

/**
 * What one write did. `written` is every path it created, changed or moved;
 * `deleted` every path it removed — kept apart so a client syncing files can
 * tell "fetch this again" from "forget this".
 */
export interface WriteResult<T> {
  value: T;
  written: string[];
  deleted: string[];
}

export interface ApiRequest {
  method: string;
  /** Path with the base and the slashes around it stripped: `trips`, `trips/t-abc/moments`, … */
  path: string;
  query: Record<string, string>;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

const ok = (body: unknown): ApiResponse => ({ status: 200, body });
const made = (body: unknown): ApiResponse => ({ status: 201, body });
const bad = (message: string): ApiResponse => ({ status: 400, body: { error: message } });
const missing = (message: string): ApiResponse => ({ status: 404, body: { error: message } });
const notAllowed = (method: string, path: string, allow: readonly string[]): ApiResponse => ({
  status: 405,
  body: { error: `Cannot ${method} /${path}. Allowed: ${allow.join(", ")}` },
  headers: { allow: allow.join(", ") },
});

const STAGES: TripStage[] = ["planning", "going", "went", "cancelled"];
const STATUSES: TripStatus[] = ["current", "upcoming", "past"];
const KIND_IDS = BOOKING_KINDS.map((k) => k.id);

/**
 * Every route, and what it answers to.
 *
 * The method is checked against this before anything is looked up, so a PUT
 * to a trip that does not exist is a 405 like a PUT to one that does — the
 * route is known whatever the id is, and the answer should not depend on it.
 */
const ROUTES: { pattern: string[]; methods: readonly string[] }[] = [
  { pattern: [], methods: ["GET"] },
  { pattern: ["health"], methods: ["GET"] },
  { pattern: ["trips"], methods: ["GET", "POST"] },
  { pattern: ["trips", ":trip"], methods: ["GET", "PATCH", "DELETE"] },
  { pattern: ["trips", ":trip", "bookings"], methods: ["GET", "POST"] },
  { pattern: ["trips", ":trip", "moments"], methods: ["GET", "POST"] },
  { pattern: ["trips", ":trip", "moments", ":moment"], methods: ["GET", "PATCH", "DELETE"] },
  { pattern: ["bookings"], methods: ["GET"] },
  { pattern: ["bookings", ":booking"], methods: ["GET", "PATCH", "DELETE"] },
];

function matchRoute(parts: string[]): { key: string; params: Record<string, string>; methods: readonly string[] } | undefined {
  for (const route of ROUTES) {
    if (route.pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    if (route.pattern.every((seg, i) => (seg.startsWith(":") ? ((params[seg.slice(1)] = parts[i]), true) : seg === parts[i]))) {
      return { key: route.pattern.join("/"), params, methods: route.methods };
    }
  }
  return undefined;
}

function findTrip(id: string, d: ApiDeps): Trip | undefined {
  return d.trips().find((t) => tripId(t) === id);
}

function findTripByPath(path: string, d: ApiDeps): Trip | undefined {
  return d.trips().find((t) => t.file.path === path);
}

function findBooking(id: string, d: ApiDeps): { trip: Trip; booking: Booking } | undefined {
  for (const trip of d.trips()) {
    const booking = d.bookings(trip).find((b) => bookingId(b) === id);
    if (booking) return { trip, booking };
  }
  return undefined;
}

function findBookingByPath(path: string, d: ApiDeps): { trip: Trip; booking: Booking } | undefined {
  for (const trip of d.trips()) {
    const booking = d.bookings(trip).find((b) => b.file.path === path);
    if (booking) return { trip, booking };
  }
  return undefined;
}

function tripDetail(trip: Trip, d: ApiDeps): Record<string, unknown> {
  const bookings = d.bookings(trip);
  // The detail carries the lists themselves where the summary has counts.
  return { ...tripJson(trip), bookings: bookings.map((b) => bookingJson(b, trip)), moments: momentsJson(trip.moments) };
}

function listTrips(q: Record<string, string>, d: ApiDeps): ApiResponse {
  if (q.stage && !STAGES.includes(q.stage as TripStage)) return bad(`stage must be one of ${STAGES.join(", ")}`);
  if (q.status && !STATUSES.includes(q.status as TripStatus)) return bad(`status must be one of ${STATUSES.join(", ")}`);
  const text = (q.q ?? "").trim().toLowerCase();
  const trips = d.trips().filter((t) =>
    (!q.stage || t.stage === q.stage) &&
    (!q.status || t.status === q.status) &&
    (!q.kind || t.kind === q.kind) &&
    (!text || [t.title, ...t.stops.flatMap((s) => [s.city, s.country]), t.venue].some((v) => v.toLowerCase().includes(text))),
  );
  return ok({ trips: trips.map((t) => tripJson(t, { bookings: d.bookings(t).length })), count: trips.length });
}

function listBookings(trips: Trip[], q: Record<string, string>, d: ApiDeps): ApiResponse {
  if (q.kind && !KIND_IDS.includes(q.kind as BookingKind)) return bad(`kind must be one of ${KIND_IDS.join(", ")}`);
  const out: Record<string, unknown>[] = [];
  for (const trip of trips) {
    for (const b of d.bookings(trip)) {
      if (q.kind && b.kind !== q.kind) continue;
      if (q.status && b.status !== q.status) continue;
      out.push(bookingJson(b, trip));
    }
  }
  return ok({ bookings: out, count: out.length });
}

/** The moments with every id written down, so the next save keeps them whatever is edited. */
function withIds(moments: Moment[]): Moment[] {
  const ids = momentIds(moments);
  return moments.map((m, i) => ({ ...m, id: ids[i] }));
}

async function route(key: string, params: Record<string, string>, method: string, req: ApiRequest, d: ApiDeps): Promise<ApiResponse> {
  if (key === "" || key === "health") {
    const trips = d.trips();
    return ok({
      ok: true,
      api: API_VERSION,
      version: d.version,
      vault: d.vaultName,
      revision: d.revision(),
      today: d.today(),
      remoteWrites: d.remoteWrites(),
      writableKinds: WRITABLE_KINDS,
      counts: { trips: trips.length, bookings: trips.reduce((n, t) => n + d.bookings(t).length, 0) },
    });
  }

  if (key === "trips") {
    if (method === "GET") return listTrips(req.query, d);
    const draft = newTripDraft(req.body, d.settings());
    const { value, written } = await d.write(() => d.createTrip(draft));
    const trip = findTripByPath(value, d);
    return made({ trip: trip ? tripDetail(trip, d) : { path: value }, written });
  }

  if (key === "bookings") {
    if (req.query.trip) {
      const trip = findTrip(req.query.trip, d);
      if (!trip) return missing(`No trip ${req.query.trip}`);
      return listBookings([trip], req.query, d);
    }
    return listBookings(d.trips(), req.query, d);
  }

  if (key === "bookings/:booking") {
    const found = findBooking(params.booking, d);
    if (!found) return missing(`No booking ${params.booking}`);
    const { trip, booking } = found;
    if (method === "GET") return ok({ booking: bookingJson(booking, trip) });
    if (!WRITABLE_KINDS.includes(booking.kind)) return bad(`A ${booking.kind} booking can be read but not written through this version of the API`);
    const id = bookingId(booking);
    if (method === "DELETE") {
      const { written, deleted } = await d.write(() => d.deleteBooking(trip, booking));
      return ok({ id, deleted, written });
    }
    const current = await d.bookingDraft(trip, booking);
    const draft = patchBookingDraft(current, req.body);
    if (sameBooking(draft, current)) return ok({ booking: bookingJson(booking, trip), written: [] });
    const { value, written } = await d.write(() => d.updateBooking(trip, booking, draft));
    const after = findBookingByPath(value, d);
    return ok({ booking: after ? bookingJson(after.booking, after.trip) : { id, path: value }, written });
  }

  // Everything else hangs off a trip.
  const trip = findTrip(params.trip, d);
  if (!trip) return missing(`No trip ${params.trip}`);

  if (key === "trips/:trip") {
    if (method === "GET") return ok({ trip: tripDetail(trip, d) });
    const id = tripId(trip);
    if (method === "DELETE") {
      const { written, deleted } = await d.write(() => d.deleteTrip(trip));
      return ok({ id, deleted, written });
    }
    const draft = patchTripDraft(trip, req.body);
    // Nothing to change is nothing to write: no file is touched, and the
    // revision stays where it was.
    if (sameTrip(draft, patchTripDraft(trip, {}))) return ok({ trip: tripDetail(trip, d), written: [] });
    const { value, written } = await d.write(() => d.updateTrip(trip, draft));
    const after = findTripByPath(value, d);
    return ok({ trip: after ? tripDetail(after, d) : { id, path: value }, written });
  }

  if (key === "trips/:trip/bookings") {
    if (method === "GET") return listBookings([trip], req.query, d);
    const draft = newBookingDraft(req.body, trip, d.currency(trip));
    const { value, written } = await d.write(() => d.createBooking(trip, draft));
    const found = findBookingByPath(value, d);
    return made({ booking: found ? bookingJson(found.booking, found.trip) : { path: value }, written });
  }

  const moments = withIds(trip.moments);
  const save = (next: Moment[]): Promise<WriteResult<void>> => d.write(() => d.saveMoments(trip, next));

  if (key === "trips/:trip/moments") {
    if (method === "GET") return ok({ moments: momentsJson(trip.moments), count: trip.moments.length });
    const moment: Moment = { ...newMoment(req.body, trip), id: freshId("m") };
    const { written } = await save([...moments, moment]);
    return made({ moment: momentJson(moment, moment.id ?? ""), written });
  }

  // trips/:trip/moments/:moment
  const at = moments.findIndex((m) => m.id === params.moment);
  if (at === -1) return missing(`No moment ${params.moment} on this trip`);
  const current = moments[at];
  const id = current.id ?? params.moment;
  if (method === "GET") return ok({ moment: momentJson(current, id) });
  if (method === "DELETE") {
    const { written } = await save(moments.filter((_, i) => i !== at));
    // A moment is a few lines of the trip note, not a file: nothing is deleted
    // from the vault, and the note it lived in is what was written.
    return ok({ id, deleted: [], written });
  }
  const moment = { ...patchMoment(current, req.body, trip), id };
  if (moment.date === current.date && moment.title === current.title && moment.text === current.text) {
    return ok({ moment: momentJson(current, id), written: [] });
  }
  const { written } = await save(moments.map((m, i) => (i === at ? moment : m)));
  return ok({ moment: momentJson(moment, id), written });
}

export async function handle(req: ApiRequest, d: ApiDeps): Promise<ApiResponse> {
  const method = req.method.toUpperCase();
  let parts: string[];
  try {
    parts = req.path.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  } catch {
    return bad("The path is not valid URL encoding");
  }
  const match = matchRoute(parts);
  if (!match) return missing(`No route /${parts.join("/")}`);
  if (!match.methods.includes(method)) return notAllowed(method, parts.join("/"), match.methods);
  try {
    return await route(match.key, match.params, method, req, d);
  } catch (e) {
    if (e instanceof BadInput) return bad(e.message);
    throw e;
  }
}
