import { AIRPORTS } from "../data/airports";

/**
 * Wall clocks, and the instants behind them.
 *
 * A boarding pass shows local time at both ends, and subtracting one from the
 * other is not a duration — it is two different clocks compared as though they
 * were one. Amsterdam 10:00 to New York 12:00 came out as two hours; the flight
 * is eight. Coming home read as thirteen and a half. Both numbers were wrong in
 * opposite directions, which is worse than being wrong consistently: a
 * transatlantic flight looked shorter than the taxi to the airport.
 *
 * The airports dataset carries an IANA zone per airport and the runtime carries
 * the zone database, so this is arithmetic rather than a table anybody has to
 * maintain. Kept free of Obsidian and of the leg types so it can be checked
 * against dates that actually cross a daylight-saving boundary.
 */

const BY_IATA = new Map(AIRPORTS.map((a) => [a.i, a]));

/** The IANA zone for whatever names an airport: "AMS", "Amsterdam (AMS)". */
export function zoneForAirport(label: string): string | null {
  const code = /\(([A-Z]{3})\)/.exec(label)?.[1] ?? (/^[A-Z]{3}$/.exec(label.trim())?.[0] ?? "");
  return (code && BY_IATA.get(code)?.z) || null;
}

/** The wall time `zone` shows at a given instant, as UTC-shaped parts. */
function wallClockAt(instant: Date, zone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
    const value = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    return Number.isNaN(value) ? null : value;
  } catch {
    // An unknown zone name. The caller falls back rather than guessing.
    return null;
  }
}

/**
 * How far ahead of UTC `zone` is at a given instant, in minutes.
 *
 * Instant-specific rather than zone-specific, because a zone's offset is not a
 * constant: Amsterdam is +60 in January and +120 in July, and picking either
 * one for the whole year puts every summer flight an hour out.
 */
export function zoneOffsetMinutes(instant: Date, zone: string): number | null {
  const wall = wallClockAt(instant, zone);
  return wall === null ? null : (wall - instant.getTime()) / 60000;
}

/**
 * A local wall time in a named zone, as minutes since the epoch.
 *
 * Two passes, and the second one matters. Converting a wall time to an instant
 * needs the offset, and the offset depends on the instant — so the first pass
 * guesses using the offset at the naive reading, and the second re-checks at
 * the instant that guess produced. They differ only within an hour or so of a
 * clock change, which is exactly when an unchecked guess would be an hour out
 * and look plausible.
 */
export function zonedStamp(dateISO: string, timeHHMM: string, zone: string): number | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO.trim());
  const clock = /^(\d{1,2}):(\d{2})$/.exec(timeHHMM.trim());
  if (!day || !clock) return null;
  const hours = Number(clock[1]);
  const minutes = Number(clock[2]);
  if (hours > 23 || minutes > 59) return null;

  const naive = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), hours, minutes);
  if (Number.isNaN(naive)) return null;

  const firstGuess = zoneOffsetMinutes(new Date(naive), zone);
  if (firstGuess === null) return null;
  const candidate = naive - firstGuess * 60000;

  const settled = zoneOffsetMinutes(new Date(candidate), zone);
  if (settled === null) return null;
  return (settled === firstGuess ? candidate : naive - settled * 60000) / 60000;
}

/**
 * Minutes between two local wall times, each read on its own clock.
 *
 * Null when either zone is unknown — an airport the dataset has never heard of.
 * Falling back to plain subtraction for one end and real arithmetic for the
 * other would mix the two, so the caller is told nothing was worked out and
 * decides what to do about it.
 */
export function zonedGapMinutes(
  from: { date: string; time: string; zone: string | null },
  to: { date: string; time: string; zone: string | null },
): number | null {
  if (!from.zone || !to.zone) return null;
  const start = zonedStamp(from.date, from.time, from.zone);
  const end = zonedStamp(to.date, to.time, to.zone);
  if (start === null || end === null) return null;
  return end - start;
}
