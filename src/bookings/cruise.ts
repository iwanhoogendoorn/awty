import { parseISO } from "../util/dates";

/**
 * A cruise, which is the one booking that is also an itinerary.
 *
 * Everything else the plugin books happens at a place: a hotel is somewhere, a
 * restaurant is somewhere, a flight is two somewheres and the line between. A
 * cruise is a fortnight of somewheres on one confirmation, and the interesting
 * facts are which day you are where, and for how long — because that is what
 * decides whether an excursion fits before the ship leaves without you.
 *
 * Kept free of Obsidian so the ordering, the sea days and the hours ashore can
 * be checked. A wrong figure here is somebody standing on a quay watching their
 * cabin sail away.
 */

export interface CruisePort {
  /** ISO date the ship is there. */
  date: string;
  /** "Progreso", or on a sea day whatever the line calls the water. */
  port: string;
  country: string;
  /** "HH:MM" on the port's own clock. Empty on the day you board. */
  arrives: string;
  /** Empty on the day you get off for good. */
  departs: string;
  /**
   * A day at sea.
   *
   * Not inferred from having no times, because a port whose times you have not
   * filled in yet would then quietly become a day at sea — and a day at sea is
   * a day you cannot book anything ashore on. Said explicitly or not at all.
   */
  atSea: boolean;
}

export function emptyPort(date: string): CruisePort {
  return { date, port: "", country: "", arrives: "", departs: "", atSea: false };
}

/** Frontmatter ports are loose records; this is the only place that shape is known. */
export function readPorts(value: unknown): CruisePort[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const port = raw as Record<string, unknown>;
      const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
      return {
        date: str(port?.date),
        port: str(port?.port),
        country: str(port?.country),
        arrives: str(port?.arrives),
        departs: str(port?.departs),
        // Written as a string by the writer, but a hand-edited note may well
        // say `at_sea: true` and mean it.
        atSea: port?.at_sea === true || str(port?.at_sea).toLowerCase() === "true",
      };
    })
    .filter((port) => port.date || port.port);
}

/** Frontmatter-friendly form: plain objects with readable keys, empties omitted. */
export function portsToFrontmatter(ports: CruisePort[]): Record<string, string>[] {
  return ports.map((port) => {
    const out: Record<string, string> = {};
    if (port.date) out.date = port.date;
    if (port.port) out.port = port.port;
    if (port.country) out.country = port.country;
    if (port.arrives) out.arrives = port.arrives;
    if (port.departs) out.departs = port.departs;
    if (port.atSea) out.at_sea = "true";
    return out;
  });
}

/** By date, because a cruise is a sequence and the form lets you add out of order. */
export function orderPorts(ports: CruisePort[]): CruisePort[] {
  return [...ports].sort((a, b) => a.date.localeCompare(b.date) || a.port.localeCompare(b.port));
}

/** "Progreso, Mexico", or just the name when the country adds nothing. */
export function portLabel(port: CruisePort): string {
  return [port.port, port.atSea ? "" : port.country].filter(Boolean).join(", ");
}

/** Where the ship is on a given day, if the itinerary says. */
export function portOn(ports: CruisePort[], date: string): CruisePort | null {
  return ports.find((p) => p.date === date) ?? null;
}

/** Somewhere you can actually get off: not a sea day, and it has a name. */
export function isPortCall(port: CruisePort): boolean {
  return !port.atSea && Boolean(port.port);
}

/**
 * Minutes between docking and sailing.
 *
 * The number an excursion has to fit inside. Null when either end is unknown —
 * "plenty of time" is not something to infer from a blank box.
 */
export function minutesAshore(port: CruisePort): number | null {
  if (!isPortCall(port)) return null;
  const at = (time: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    return h > 23 || min > 59 ? null : h * 60 + min;
  };
  const from = at(port.arrives);
  const to = at(port.departs);
  if (from === null || to === null) return null;
  // A call that runs past midnight is rare but real; treat it as into the next
  // day rather than as a negative stay.
  return to >= from ? to - from : 24 * 60 - from + to;
}

export function formatAshore(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Every country the ship calls at, in order, without repeats. */
export function portCountries(ports: CruisePort[]): string[] {
  const out: string[] = [];
  for (const port of orderPorts(ports)) {
    if (!isPortCall(port) || !port.country) continue;
    if (!out.includes(port.country)) out.push(port.country);
  }
  return out;
}

export interface CruiseShape {
  /** Days the ship is alongside somewhere you can get off. */
  calls: number;
  /** Days at sea. */
  seaDays: number;
  /** Nights aboard: the span from boarding to getting off. */
  nights: number;
  countries: string[];
  /** First and last dates in the itinerary. */
  from: string;
  to: string;
}

export function cruiseShape(ports: CruisePort[]): CruiseShape {
  const ordered = orderPorts(ports);
  const dated = ordered.filter((p) => p.date);
  const from = dated[0]?.date ?? "";
  const to = dated[dated.length - 1]?.date ?? "";
  const start = from ? parseISO(from) : null;
  const end = to ? parseISO(to) : null;
  const nights =
    start && end ? Math.max(Math.round((end.getTime() - start.getTime()) / 86400000), 0) : 0;
  return {
    calls: ordered.filter(isPortCall).length,
    seaDays: ordered.filter((p) => p.atSea).length,
    nights,
    countries: portCountries(ordered),
    from,
    to,
  };
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon" for an ISO date, or "" when it is not one. */
export function weekdayOf(date: string): string {
  const day = parseISO(date);
  return day ? DAY_NAMES[day.getUTCDay()] : "";
}

/**
 * The itinerary as the cruise line prints it: date, day, port, in, out.
 *
 * Written into the note body so it reads the same as the confirmation you were
 * sent, and so it survives the plugin being uninstalled — which is the deal
 * everything else here makes too.
 */
export function portTable(ports: CruisePort[]): string[] {
  const ordered = orderPorts(ports);
  if (ordered.length === 0) return [];
  const rows = ordered.map((port) => {
    const ashore = minutesAshore(port);
    return [
      port.date,
      weekdayOf(port.date),
      portLabel(port) || (port.atSea ? "At sea" : ""),
      port.arrives || "—",
      port.departs || "—",
      ashore === null ? "" : formatAshore(ashore),
    ];
  });
  return [
    "| Date | Day | Port | Arrives | Departs | Ashore |",
    "|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ];
}

/**
 * Where a booking on a cruise happens.
 *
 * An excursion is either ashore at that day's port or somewhere on the ship,
 * and a restaurant on board is the same question with a different answer. Kept
 * as one idea because it is one idea: the alternative was two nearly-identical
 * fields that would drift apart.
 */
export const ABOARD = "On board";

/** Whether a booking's location means "on the ship" rather than a place ashore. */
export function isAboard(where: string): boolean {
  return where.trim().toLowerCase() === ABOARD.toLowerCase();
}

/**
 * The places a booking made on this cruise could be: the ship, or a port call.
 *
 * Sea days are left out on purpose — there is no gangway, so an excursion
 * ashore on a sea day is a thing that cannot happen, and offering it would be
 * inviting somebody to record one.
 */
export function cruiseWhereOptions(ports: CruisePort[]): string[] {
  const ashore = orderPorts(ports)
    .filter(isPortCall)
    .map(portLabel)
    .filter((label, i, all) => all.indexOf(label) === i);
  return [ABOARD, ...ashore];
}
