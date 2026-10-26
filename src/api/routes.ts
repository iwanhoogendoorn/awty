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
  write: <T>(fn: () => Promise<T>) => Promise<{ value: T; written: string[] }>;
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
}

const ok = (body: unknown): ApiResponse => ({ status: 200, body });
const made = (body: unknown): ApiResponse => ({ status: 201, body });
const bad = (message: string): ApiResponse => ({ status: 400, body: { error: message } });
const missing = (message: string): ApiResponse => ({ status: 404, body: { error: message } });
const notAllowed = (method: string, path: string): ApiResponse => ({ status: 405, body: { error: `Cannot ${method} /${path}` } });

const STAGES: TripStage[] = ["planning", "going", "went", "cancelled"];
const STATUSES: TripStatus[] = ["current", "upcoming", "past"];
const KIND_IDS = BOOKING_KINDS.map((k) => k.id);

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

/** The trip after a write, found by the path the writer reported. */
function tripAfter(path: string, d: ApiDeps): Trip | undefined {
  return findTripByPath(path, d);
}

async function tripRoutes(method: string, parts: string[], req: ApiRequest, d: ApiDeps): Promise<ApiResponse> {
  const path = parts.join("/");
  if (parts.length === 1) {
    if (method === "GET") return listTrips(req.query, d);
    if (method === "POST") {
      const draft = newTripDraft(req.body, d.settings());
      const { value, written } = await d.write(() => d.createTrip(draft));
      const trip = tripAfter(value, d);
      return made({ trip: trip ? tripDetail(trip, d) : { path: value }, written });
    }
    return notAllowed(method, path);
  }

  const trip = findTrip(parts[1], d);
  if (!trip) return missing(`No trip ${parts[1]}`);

  if (parts.length === 2) {
    if (method === "GET") return ok({ trip: tripDetail(trip, d) });
    if (method === "PATCH") {
      const draft = patchTripDraft(trip, req.body);
      // Nothing to change is nothing to write: no file is touched, and the
      // revision stays where it was.
      if (sameTrip(draft, patchTripDraft(trip, {}))) return ok({ trip: tripDetail(trip, d), written: [] });
      const { value, written } = await d.write(() => d.updateTrip(trip, draft));
      const after = tripAfter(value, d);
      return ok({ trip: after ? tripDetail(after, d) : { path: value }, written });
    }
    if (method === "DELETE") {
      const id = tripId(trip);
      const { written } = await d.write(() => d.deleteTrip(trip));
      return ok({ deleted: id, written });
    }
    return notAllowed(method, path);
  }

  if (parts[2] === "bookings" && parts.length === 3) {
    if (method === "GET") return listBookings([trip], req.query, d);
    if (method === "POST") {
      const draft = newBookingDraft(req.body, trip, d.currency(trip));
      const { value, written } = await d.write(() => d.createBooking(trip, draft));
      const found = findBookingByPath(value, d);
      return made({ booking: found ? bookingJson(found.booking, found.trip) : { path: value }, written });
    }
    return notAllowed(method, path);
  }

  if (parts[2] === "moments") return momentRoutes(method, trip, parts, req, d);
  return missing(`No route /${path}`);
}

function findBookingByPath(path: string, d: ApiDeps): { trip: Trip; booking: Booking } | undefined {
  for (const trip of d.trips()) {
    const booking = d.bookings(trip).find((b) => b.file.path === path);
    if (booking) return { trip, booking };
  }
  return undefined;
}

async function bookingRoutes(method: string, parts: string[], req: ApiRequest, d: ApiDeps): Promise<ApiResponse> {
  const path = parts.join("/");
  if (parts.length === 1) {
    if (method !== "GET") return notAllowed(method, path);
    if (req.query.trip) {
      const trip = findTrip(req.query.trip, d);
      if (!trip) return missing(`No trip ${req.query.trip}`);
      return listBookings([trip], req.query, d);
    }
    return listBookings(d.trips(), req.query, d);
  }
  if (parts.length !== 2) return missing(`No route /${path}`);

  const found = findBooking(parts[1], d);
  if (!found) return missing(`No booking ${parts[1]}`);
  const { trip, booking } = found;

  if (method === "GET") return ok({ booking: bookingJson(booking, trip) });
  if (method !== "PATCH" && method !== "DELETE") return notAllowed(method, path);
  if (!WRITABLE_KINDS.includes(booking.kind)) return bad(`A ${booking.kind} booking can be read but not written through this version of the API`);

  if (method === "DELETE") {
    const id = bookingId(booking);
    const { written } = await d.write(() => d.deleteBooking(trip, booking));
    return ok({ deleted: id, written });
  }

  const current = await d.bookingDraft(trip, booking);
  const draft = patchBookingDraft(current, req.body);
  if (sameBooking(draft, current)) return ok({ booking: bookingJson(booking, trip), written: [] });
  const { value, written } = await d.write(() => d.updateBooking(trip, booking, draft));
  const after = findBookingByPath(value, d);
  return ok({ booking: after ? bookingJson(after.booking, after.trip) : { path: value }, written });
}

async function momentRoutes(method: string, trip: Trip, parts: string[], req: ApiRequest, d: ApiDeps): Promise<ApiResponse> {
  const path = parts.join("/");
  const moments = trip.moments;
  const ids = momentIds(moments);
  const save = async (next: Moment[]): Promise<{ trip: Trip | undefined; written: string[] }> => {
    const { written } = await d.write(() => d.saveMoments(trip, next));
    return { trip: findTripByPath(trip.file.path, d), written };
  };

  if (parts.length === 3) {
    if (method === "GET") return ok({ moments: momentsJson(moments), count: moments.length });
    if (method === "POST") {
      const moment = newMoment(req.body);
      const next = [...moments, moment];
      const r = await save(next);
      const id = momentIds(next)[next.length - 1];
      return made({ moment: momentJson(moment, id), written: r.written });
    }
    return notAllowed(method, path);
  }
  if (parts.length !== 4) return missing(`No route /${path}`);

  const at = ids.indexOf(parts[3]);
  if (at === -1) return missing(`No moment ${parts[3]} on this trip`);
  const current = moments[at];

  if (method === "GET") return ok({ moment: momentJson(current, ids[at]) });
  if (method === "PATCH") {
    const moment = patchMoment(current, req.body);
    if (moment.date === current.date && moment.title === current.title && moment.text === current.text) {
      return ok({ moment: momentJson(current, ids[at]), written: [] });
    }
    const next = moments.map((m, i) => (i === at ? moment : m));
    const r = await save(next);
    return ok({ moment: momentJson(moment, momentIds(next)[at]), written: r.written });
  }
  if (method === "DELETE") {
    const r = await save(moments.filter((_, i) => i !== at));
    return ok({ deleted: ids[at], written: r.written });
  }
  return notAllowed(method, path);
}

export async function handle(req: ApiRequest, d: ApiDeps): Promise<ApiResponse> {
  const method = req.method.toUpperCase();
  const parts = req.path.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  try {
    if (parts.length === 0 || (parts[0] === "health" && parts.length === 1)) {
      if (method !== "GET") return notAllowed(method, parts.join("/"));
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
    if (parts[0] === "trips") return await tripRoutes(method, parts, req, d);
    if (parts[0] === "bookings") return await bookingRoutes(method, parts, req, d);
    return missing(`No route /${parts.join("/")}`);
  } catch (e) {
    if (e instanceof BadInput) return bad(e.message);
    throw e;
  }
}
