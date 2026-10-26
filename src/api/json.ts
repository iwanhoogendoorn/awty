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

/**
 * cyrb53: a 53-bit string hash, plenty for a vault's worth of paths.
 *
 * Ids are derived rather than stored, so reading a trip never has to write an
 * id into somebody's note to be able to name it.
 */
export function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, "0");
}

/**
 * A trip's id follows its note's path. Renaming a trip (a new title moves the
 * note and its folder) gives it a new id, and the write that did it replies
 * with that new id.
 */
export const tripId = (trip: Pick<Trip, "file">): string => `t-${hash(trip.file.path)}`;
export const bookingId = (booking: Pick<Booking, "file">): string => `b-${hash(booking.file.path)}`;

/**
 * A moment's id is its content: identical moments are told apart by their
 * order. Editing one changes its id; the reply carries the new one.
 */
export function momentIds(moments: Moment[]): string[] {
  const seen = new Map<string, number>();
  return moments.map((m) => {
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
