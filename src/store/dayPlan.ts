import type { TFile } from "obsidian";
import type { Booking, BookingKind, DaySlot } from "../bookings/types";
import { bookingIcon } from "../bookings/types";
import { formatAshore, minutesAshore, portLabel, portOn } from "../bookings/cruise";
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
  /**
   * On the same ticket as a row that already shows a price.
   *
   * The way home on a return has no fare of its own — it was paid once, on the
   * way out. An empty cost column read as a figure nobody had got round to
   * entering, so it says so instead. Never both: a row shows a price or shows
   * that it is covered.
   */
  covered: boolean;
  file: TFile;
  kind: BookingKind;
  slot: DaySlot | "";
  /** Where a journey ends, so an arrival transfer can be spotted. */
  destination: string;
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

/**
 * When an untimed event happens, for ordering only.
 *
 * Sorting by clock time alone sent every untimed event to the end of its band,
 * so a 20:00 concert came before an activity pencilled in for the morning.
 */
const SLOT_TIME: Record<string, string> = {
  morning: "09:00",
  afternoon: "13:00",
  evening: "19:00",
};

/** When a hotel lets you in, absent anything better. Only used for ordering. */
const NOMINAL_CHECK_IN = "15:00";

function effectiveTime(event: DayEvent): string {
  if (event.time) return event.time;
  if (event.kind === "stay" && event.detail === "Check in") return NOMINAL_CHECK_IN;
  return SLOT_TIME[event.slot] || "99:99";
}

/**
 * Events that actually happen on a date.
 *
 * A hotel booked for seven nights is one check-in and one check-out, not seven
 * identical rows; a return flight is two departures, not a thing that happens
 * continuously for a week. Spanning bookings used to be matched with
 * `date >= start && date <= end`, which repeated them on every day between.
 */
export function eventsFor(booking: Booking, date: string): DayEvent[] {
  const icon = bookingIcon(booking);
  const cost = booking.cost ? formatMoney(booking.cost) : "";
  const slot = (booking.slot ?? "") as DaySlot | "";
  const base = {
    icon,
    covered: false,
    file: booking.file,
    kind: booking.kind,
    slot,
    destination: booking.to,
  };
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

  if (booking.kind === "cruise") {
    // A cruise is a fortnight of somewheres on one confirmation, so it earns a
    // row on each of those days rather than one row spanning the lot. A sea day
    // is a real day of the trip — it is where you are, and knowing there is no
    // port is exactly what you want the itinerary to tell you.
    const port = portOn(booking.ports, date);
    if (!port) return out;
    const ashore = minutesAshore(port);
    const first = date === booking.date;
    const last = date === booking.endDate && booking.endDate !== booking.date;
    out.push({
      ...base,
      // The time that matters is the one you can miss. Arriving somewhere is a
      // fact; sailing again is a deadline.
      time: port.departs || port.arrives,
      title: booking.title,
      detail: [
        port.atSea ? "At sea" : portLabel(port),
        port.atSea
          ? ""
          : [port.arrives, port.departs].filter(Boolean).join("–") +
            (ashore === null ? "" : ` · ${formatAshore(ashore)} ashore`),
        first ? "Embark" : last ? "Disembark" : "",
      ]
        .filter(Boolean)
        .join(" · "),
      // The fare is paid once, and it shows on the day you board.
      cost: first ? cost : "",
      band: first ? BAND.CheckIn : last ? BAND.CheckOut : BAND.During,
    });
    return out;
  }

  if (booking.kind === "flight") {
    // A ticket can hold flights days apart. Each shows on its own day; the
    // first is how you arrive and the last is how you leave.
    // Older bookings, and anything built without the store, have none.
    const journeys = booking.journeys ?? [];
    if (journeys.length > 0) {
      journeys.forEach((journey, index) => {
        if (journey.date !== date) return;
        const last = index === journeys.length - 1;
        out.push({
          ...base,
          time: journey.time,
          title: booking.title,
          detail: [journey.label, [journey.from, journey.to].filter(Boolean).join(" → ")]
            .filter(Boolean)
            .join(" · "),
          // Each flight shows what it cost, when they were priced one by one.
          // Otherwise the ticket price sits on the first, where it was paid.
          cost: journey.cost ? formatMoney(journey.cost) : index === 0 ? cost : "",
          covered: !journey.cost && index > 0 && Boolean(cost),
          band: index === 0 ? BAND.Arrive : last ? BAND.Depart : BAND.During,
        });
      });
      return out;
    }

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
        covered: Boolean(cost),
        band: BAND.Depart,
      });
    }
    return out;
  }

  if (booking.kind === "transport") {
    // A journey is up to three things that happen: setting off, being put down
    // somewhere, and coming back. Only the first was ever shown, so a ferry
    // booked out and back appeared as a single row in the morning and the way
    // home existed only inside the booking.
    // Both ways read the same. The outbound named only its destination while
    // the return spelled out the whole route, so one row of a pair said
    // "Lopud harbour" and the other "Return · Lopud harbour → Dubrovnik" —
    // which reads as two unrelated things rather than there and back.
    const route = [booking.from, booking.to].filter(Boolean).join(" → ");
    if (date === booking.date) {
      out.push({
        ...base,
        time: booking.time,
        title: booking.title,
        // Labelled only when there is a way back to tell it from. On a one-way
        // taxi "Outbound" is a distinction with nothing on the other side.
        detail:
          [booking.returnDate ? "Outbound" : "", route || booking.to || booking.slot || ""]
            .filter(Boolean)
            .join(" · "),
        cost,
        band: BAND.During,
      });
    }
    // An arrival on a later day: a sleeper, a hire car brought back on Friday.
    // On the same day it would be a second row saying what the first already
    // does, so it is left to the booking.
    if (booking.endDate && booking.endDate !== booking.date && date === booking.endDate) {
      out.push({
        ...base,
        time: booking.endTime,
        title: booking.title,
        detail: ["Arrives", booking.to].filter(Boolean).join(" · "),
        // Paid once, and shown where it was paid.
        cost: "",
        covered: Boolean(cost),
        band: BAND.During,
      });
    }
    if (booking.returnDate && date === booking.returnDate) {
      out.push({
        ...base,
        time: booking.returnTime,
        // The way home runs the other way, and saying so is the whole reason
        // the return is asked for rather than inferred from an end time.
        detail: `Return · ${[booking.to, booking.from].filter(Boolean).join(" → ")}`,
        title: booking.title,
        cost: "",
        covered: Boolean(cost),
        band: BAND.During,
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
  const events = bookings.flatMap((b) => eventsFor(b, date));

  // A transfer that ends where you are checking in today happens before that
  // check-in, whatever its band would otherwise say — you do not arrive at a
  // hotel you have already arrived at.
  const arrivingAt = new Set(
    events
      .filter((e) => e.kind === "stay" && e.detail === "Check in")
      .map((e) => e.title.trim().toLowerCase()),
  );
  for (const event of events) {
    if (event.kind !== "transport") continue;
    if (arrivingAt.has(event.destination.trim().toLowerCase())) {
      event.band = BAND.CheckIn;
    }
  }

  return events
    .sort(
      (a, b) =>
        a.band - b.band ||
        effectiveTime(a).localeCompare(effectiveTime(b)) ||
        a.title.localeCompare(b.title),
    );
}

/** The stays covering a date without starting or ending on it. */
export function ongoingOn(bookings: Booking[], date: string): Ongoing[] {
  return bookings.map((b) => ongoingFor(b, date)).filter((o): o is Ongoing => o !== null);
}
