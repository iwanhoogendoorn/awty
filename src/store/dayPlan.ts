import type { TFile } from "obsidian";
import type { Booking, BookingKind, DaySlot } from "../bookings/types";
import { BOOKING_KINDS } from "../bookings/types";
import { formatMoney } from "../util/money";
import { datesInRange } from "../util/dates";

/**
 * The shape of one day on a trip.
 *
 * Kept free of Obsidian so the timeline, the travel-time fan-out and the tests
 * all agree on what happens in what order — the routes to fetch have to match
 * the sequence that gets drawn, or the timeline asks the cache for pairs nobody
 * ever calculated.
 */

/** One thing that happens at a point in time, as opposed to a stay that lasts. */
export interface DayEvent {
  time: string;
  title: string;
  detail: string;
  icon: string;
  cost: string;
  file: TFile;
  kind: BookingKind;
  slot: DaySlot | "";
  /**
   * The part of the day this belongs to. Times alone cannot order a day: a
   * check-out rarely has one, and sorting it to the end put it after the flight
   * home. You arrive, you check in, you do things, you check out, you leave.
   */
  band: EventBand;
}

export const BAND = {
  Arrive: 0,
  CheckIn: 1,
  During: 2,
  CheckOut: 3,
  Depart: 4,
} as const;

export type EventBand = (typeof BAND)[keyof typeof BAND];

/** A stay in progress on a given day, shown as a rail rather than a row. */
export interface Ongoing {
  title: string;
  night: number;
  nights: number;
  file: TFile;
}

const SLOT_RANK: Record<string, number> = { morning: 0, afternoon: 1, evening: 2 };

/**
 * Events that actually happen on a date.
 *
 * A hotel booked for seven nights is one check-in and one check-out, not seven
 * identical rows; a return flight is two departures, not a thing that happens
 * continuously for a week. Spanning bookings used to be matched with
 * `date >= start && date <= end`, which repeated them on every day between.
 */
export function eventsFor(booking: Booking, date: string): DayEvent[] {
  const def = BOOKING_KINDS.find((k) => k.id === booking.kind);
  const icon = def?.icon ?? "ticket";
  const cost = booking.cost ? formatMoney(booking.cost) : "";
  const slot = (booking.slot ?? "") as DaySlot | "";
  const base = { icon, file: booking.file, kind: booking.kind, slot };
  const out: DayEvent[] = [];

  if (booking.kind === "stay") {
    if (date === booking.date) {
      out.push({
        ...base,
        time: booking.time,
        title: booking.title,
        detail: "Check in",
        cost,
        band: BAND.CheckIn,
      });
    }
    if (booking.endDate && date === booking.endDate && booking.endDate !== booking.date) {
      out.push({
        ...base,
        time: booking.endTime,
        title: booking.title,
        detail: "Check out",
        // The price belongs to the stay, and it is already shown at check-in.
        cost: "",
        band: BAND.CheckOut,
      });
    }
    return out;
  }

  if (booking.kind === "flight") {
    if (date === booking.date) {
      out.push({
        ...base,
        time: booking.time,
        title: booking.title,
        detail: [booking.from, booking.to].filter(Boolean).join(" → ") || "Outbound",
        cost,
        band: BAND.Arrive,
      });
    }
    if (booking.returnDate && date === booking.returnDate) {
      out.push({
        ...base,
        time: booking.returnTime,
        title: booking.title,
        detail: `Return · ${[booking.to, booking.from].filter(Boolean).join(" → ")}`,
        cost: "",
        band: BAND.Depart,
      });
    }
    return out;
  }

  if (date !== booking.date) return out;
  out.push({
    ...base,
    time: booking.time,
    title: booking.title,
    detail: booking.slot ? booking.slot : (booking.to ?? ""),
    cost,
    band: BAND.During,
  });
  return out;
}

/** A stay covering this date, but neither arriving nor leaving on it. */
export function ongoingFor(booking: Booking, date: string): Ongoing | null {
  if (booking.kind !== "stay") return null;
  if (!booking.endDate || booking.endDate === booking.date) return null;
  if (date <= booking.date || date >= booking.endDate) return null;

  const nights = datesInRange(booking.date, booking.endDate).length - 1;
  const night = datesInRange(booking.date, date).length - 1;
  return { title: booking.title, night, nights, file: booking.file };
}

/** Everything happening on one date, in the order it happens. */
export function dayEvents(bookings: Booking[], date: string): DayEvent[] {
  return bookings
    .flatMap((b) => eventsFor(b, date))
    .sort(
      (a, b) =>
        a.band - b.band ||
        (a.time || "99:99").localeCompare(b.time || "99:99") ||
        (SLOT_RANK[a.slot] ?? 9) - (SLOT_RANK[b.slot] ?? 9) ||
        a.title.localeCompare(b.title),
    );
}

/** The stays covering a date without starting or ending on it. */
export function ongoingOn(bookings: Booking[], date: string): Ongoing[] {
  return bookings.map((b) => ongoingFor(b, date)).filter((o): o is Ongoing => o !== null);
}
