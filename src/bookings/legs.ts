import { parseISO } from "../util/dates";

/**
 * A single hop. Most flights are one of these; a connecting itinerary is
 * several, and the interesting number is the gap between them.
 */
export interface FlightLeg {
  operator: string;
  number: string;
  from: string;
  to: string;
  /** ISO date of departure. */
  date: string;
  depTime: string;
  /** ISO date of arrival — a red-eye lands on the following day. */
  arrDate: string;
  arrTime: string;
}

export function emptyLeg(date: string): FlightLeg {
  return { operator: "", number: "", from: "", to: "", date, depTime: "", arrDate: date, arrTime: "" };
}

function minutesOf(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Absolute minutes since epoch-ish, for comparing two date+time pairs. */
function stamp(date: string, time: string): number | null {
  const day = parseISO(date);
  const mins = minutesOf(time);
  if (!day || mins === null) return null;
  return Math.floor(day.getTime() / 60000) + mins;
}

/**
 * Layover between two legs, in minutes.
 *
 * Null when either end lacks a time — better to show nothing than to invent a
 * connection time somebody might trust.
 */
export function layoverMinutes(previous: FlightLeg, next: FlightLeg): number | null {
  const arrive = stamp(previous.arrDate || previous.date, previous.arrTime);
  const depart = stamp(next.date, next.depTime);
  if (arrive === null || depart === null) return null;
  const gap = depart - arrive;
  return gap < 0 ? null : gap;
}

export function formatLayover(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** A layover this short is likely to be missed; this drives the warning. */
export const TIGHT_CONNECTION_MINUTES = 60;

/** "AMS → DBV" or "AMS → DBV via IST". */
export function routeTitle(legs: FlightLeg[]): string {
  const usable = legs.filter((l) => l.from || l.to);
  if (usable.length === 0) return "";
  const first = usable[0].from;
  const last = usable[usable.length - 1].to;
  const via = usable.slice(0, -1).map((l) => l.to).filter(Boolean);
  const base = [first, last].filter(Boolean).join(" → ");
  return via.length > 0 ? `${base} via ${via.join(", ")}` : base;
}

/** Total elapsed journey, including time spent in airports. */
export function totalJourneyMinutes(legs: FlightLeg[]): number | null {
  if (legs.length === 0) return null;
  const start = stamp(legs[0].date, legs[0].depTime);
  const lastLeg = legs[legs.length - 1];
  const end = stamp(lastLeg.arrDate || lastLeg.date, lastLeg.arrTime);
  if (start === null || end === null) return null;
  const total = end - start;
  return total < 0 ? null : total;
}

/** Frontmatter-friendly form: plain objects with readable keys. */
export function legsToFrontmatter(legs: FlightLeg[]): Record<string, string>[] {
  return legs.map((leg) => {
    const out: Record<string, string> = {};
    if (leg.operator) out.airline = leg.operator;
    if (leg.number) out.flight = leg.number;
    if (leg.from) out.from = leg.from;
    if (leg.to) out.to = leg.to;
    if (leg.date) out.date = leg.date;
    if (leg.depTime) out.departs = leg.depTime;
    if (leg.arrDate && leg.arrDate !== leg.date) out.arrives_on = leg.arrDate;
    if (leg.arrTime) out.arrives = leg.arrTime;
    return out;
  });
}

/**
 * A gap this long is a stay, not a connection.
 *
 * No airline schedules a twelve-hour layover as a normal connection, and no
 * holiday is shorter than one. It is the only reliable line between "still
 * travelling" and "arrived, and going home later".
 */
/**
 * Splits a parsed confirmation into the way out and the way home.
 *
 * Timings cannot tell these apart. A day trip has an eight-hour stay, a
 * long-haul ticket can have an eleven-hour connection, and a stopover can run
 * longer than either — every threshold gets one of them wrong, and legs typed
 * without times have no gap to measure at all.
 *
 * The route says it plainly instead. On a journey that ends where it began,
 * you are on the way home from the moment you arrive somewhere you have
 * already been. On one that ends elsewhere, a second journey starts where the
 * first did not end — the break between two airports that are not the same.
 */
export function splitJourney(legs: FlightLeg[]): { outbound: FlightLeg[]; back: FlightLeg[] } {
  const sorted = [...legs].sort((a, b) =>
    `${a.date}${a.depTime}`.localeCompare(`${b.date}${b.depTime}`),
  );
  if (sorted.length < 2) return { outbound: sorted, back: [] };

  const code = (value: string): string => value.trim().toUpperCase();
  const origin = code(sorted[0].from);
  const finish = code(sorted[sorted.length - 1].to);
  const roundTrip = Boolean(origin) && origin === finish;

  let pivot = -1;
  if (roundTrip) {
    const visited = new Set([origin]);
    for (let i = 0; i < sorted.length; i += 1) {
      const to = code(sorted[i].to);
      if (i > 0 && visited.has(to)) {
        pivot = i;
        break;
      }
      visited.add(to);
    }
  } else {
    for (let i = 1; i < sorted.length; i += 1) {
      // A connection leaves from where the last leg landed. Anything else is
      // the start of a separate journey.
      if (code(sorted[i].from) !== code(sorted[i - 1].to)) {
        pivot = i;
        break;
      }
    }
  }
  if (pivot <= 0) return { outbound: sorted, back: [] };

  return { outbound: sorted.slice(0, pivot), back: sorted.slice(pivot) };
}
