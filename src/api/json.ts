/**
 * What the API says a trip, a booking and a moment are.
 *
 * Kept apart from the routes so the shapes are stated once: a list and a
 * detail and a write reply all describe a trip the same way, and a client never
 * has to learn two spellings of one field.
 */
import type { Trip } from "../types";
import type { Booking } from "../bookings/types";
import type { FlightLeg } from "../bookings/legs";
import type { Moment } from "../trips/moments";
import { orderMoments } from "../trips/moments";
import { hash, pathId } from "../util/hash";

/**
 * A trip's id is the one stored in its note, so renaming the trip — which
 * moves the note and its folder — leaves it alone. A note from before ids were
 * stored is named by its path until something is about to move it, at which
 * point that same name is written into it.
 */
export const tripId = (trip: Pick<Trip, "file" | "apiId">): string => trip.apiId || pathId("t", trip.file.path);
export const bookingId = (booking: Pick<Booking, "file" | "apiId">): string => booking.apiId || pathId("b", booking.file.path);

/**
 * A moment's id: the one stored with it, or failing that its content, with
 * identical moments told apart by their order. The API stores the id with the
 * moment the first time it saves the trip, so editing never renames it.
 */
export function momentIds(moments: Moment[]): string[] {
  const seen = new Map<string, number>();
  return moments.map((m) => {
    if (m.id) return m.id;
    const base = `m-${hash(`${m.date}\u0000${m.title}\u0000${m.text}`)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

export function momentJson(moment: Moment, id: string): Record<string, unknown> {
  return { id, date: moment.date || null, title: moment.title || null, text: moment.text };
}

/** A trip's moments in the order the trip shows them: by date, undated last. */
export function momentsJson(moments: Moment[]): Record<string, unknown>[] {
  const ids = momentIds(moments);
  const withIds = moments.map((m, i) => ({ m, id: ids[i] }));
  const order = orderMoments(moments);
  // orderMoments sorts copies of the same objects, so identity finds the id.
  return order.map((m) => momentJson(m, withIds.find((x) => x.m === m)?.id ?? ""));
}

export function legJson(leg: FlightLeg): Record<string, unknown> {
  return {
    airline: leg.operator || null,
    flight: leg.number || null,
    from: leg.from || null,
    to: leg.to || null,
    date: leg.date || null,
    departs: leg.depTime || null,
    arrivesOn: leg.arrDate || leg.date || null,
    arrives: leg.arrTime || null,
    separate: leg.separate === true,
    cost: typeof leg.cost === "number" ? leg.cost : null,
  };
}

const orNull = (s: string): string | null => (s ? s : null);

export function bookingJson(booking: Booking, trip: Trip): Record<string, unknown> {
  const postal = (p: Booking["postal"]): Record<string, string> | null =>
    p.line1 || p.line2 || p.postcode || p.city || p.country ? { ...p } : null;
  return {
    id: bookingId(booking),
    tripId: tripId(trip),
    path: booking.file.path,
    kind: booking.kind,
    status: booking.status,
    title: booking.title,
    date: orNull(booking.date),
    endDate: orNull(booking.endDate),
    time: orNull(booking.time),
    endTime: orNull(booking.endTime),
    cost: booking.cost ? booking.cost.amount : null,
    currency: booking.cost ? booking.cost.currency : null,
    category: booking.category,
    reference: orNull(booking.reference),
    from: orNull(booking.from),
    to: orNull(booking.to),
    operator: orNull(booking.operator),
    seat: orNull(booking.seat),
    mode: booking.kind === "transport" ? orNull(booking.mode) : null,
    address: postal(booking.postal),
    fromAddress: postal(booking.fromPostal),
    returnDate: orNull(booking.returnDate),
    returnTime: orNull(booking.returnTime),
    returnEndDate: orNull(booking.returnEndDate),
    returnEndTime: orNull(booking.returnEndTime),
    returnFrom: orNull(booking.returnFrom),
    returnTo: orNull(booking.returnTo),
    returnOperator: orNull(booking.returnOperator),
    returnService: orNull(booking.returnService),
    legs: booking.legs.map(legJson),
    returnLegs: booking.returnLegs.map(legJson),
    attachments: booking.attachments,
  };
}

export function tripJson(trip: Trip, extra: { bookings?: number } = {}): Record<string, unknown> {
  return {
    id: tripId(trip),
    path: trip.file.path,
    folder: trip.folderPath,
    title: trip.title,
    kind: trip.kind,
    // What the calendar makes of it, and what the note says: a trip stored as
    // "going" whose last day has passed is "went" without anyone saying so.
    stage: trip.stage,
    storedStage: trip.storedStage,
    status: trip.status,
    startDate: orNull(trip.startDate),
    endDate: orNull(trip.endDate),
    country: orNull(trip.country),
    city: orNull(trip.city),
    stops: trip.stops.map((s) => ({ country: s.country, city: s.city })),
    venue: orNull(trip.venue),
    travellers: trip.travellers,
    originCity: orNull(trip.originCity),
    originAirport: orNull(trip.originAirport),
    budgetTotal: trip.budgetTotal,
    passports: trip.passports,
    moments: trip.moments.length,
    ...(extra.bookings !== undefined ? { bookings: extra.bookings } : {}),
  };
}
