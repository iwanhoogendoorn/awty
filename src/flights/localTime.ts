import { AIRPORTS } from "../data/airports";
import type { FlightLeg } from "../bookings/legs";

/**
 * Turning a UTC calendar time into the local wall time a boarding pass shows.
 *
 * Airline invites often write DTSTART in UTC. Stored as-is, an 08:15Z
 * departure from Amsterdam reads as 08:15 when the gate closes at 10:15 local
 * — so either the time gets converted, or it is only a warning. The airports
 * dataset now carries an IANA zone per field, and the JavaScript runtime
 * carries the zone database, which together make conversion just arithmetic.
 */

const BY_IATA = new Map(AIRPORTS.map((a) => [a.i, a]));

/** The IANA zone for whatever names an airport: "AMS", "Amsterdam (AMS)". */
export function zoneForAirport(label: string): string | null {
  const code = /\(([A-Z]{3})\)/.exec(label)?.[1] ?? (/^[A-Z]{3}$/.exec(label.trim())?.[0] ?? "");
  return (code && BY_IATA.get(code)?.z) || null;
}

/** "2026-08-17" + "08:15" UTC → the same instant on the wall clock of `zone`. */
export function utcToLocal(
  dateISO: string,
  timeHHMM: string,
  zone: string,
): { date: string; time: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || !/^\d{2}:\d{2}$/.test(timeHHMM)) return null;
  const instant = new Date(`${dateISO}T${timeHHMM}:00Z`);
  if (Number.isNaN(instant.getTime())) return null;

  try {
    // en-CA formats as YYYY-MM-DD, which is the shape everything here stores.
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    const time = `${get("hour")}:${get("minute")}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) ? { date, time } : null;
  } catch {
    // An unknown zone name; the caller keeps the UTC value and the warning.
    return null;
  }
}

/**
 * Converts a parsed journey's UTC times to each airport's local time.
 *
 * All or nothing: converting the legs whose airports are known and leaving the
 * rest would mix two clocks in one table, which is worse than either alone.
 */
export function localiseLegs(legs: FlightLeg[]): FlightLeg[] | null {
  const out: FlightLeg[] = [];
  for (const leg of legs) {
    const next = { ...leg };
    if (leg.date && leg.depTime) {
      const zone = zoneForAirport(leg.from);
      const local = zone && utcToLocal(leg.date, leg.depTime, zone);
      if (!local) return null;
      next.date = local.date;
      next.depTime = local.time;
    }
    if (leg.arrTime) {
      const zone = zoneForAirport(leg.to);
      const local = zone && utcToLocal(leg.arrDate || leg.date, leg.arrTime, zone);
      if (!local) return null;
      next.arrDate = local.date;
      next.arrTime = local.time;
    }
    out.push(next);
  }
  return out;
}
