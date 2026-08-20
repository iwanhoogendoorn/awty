import { formatMoney } from "../util/money";

/**
 * Taxis, Ubers and the rest — logged after the fact, in a batch.
 *
 * Every other cost in this plugin is one note per thing, which is right for a
 * hotel and absurd for the eleven short rides a week away actually produces.
 * Nobody opens a wizard on a kerb, so they get logged at the end from a phone
 * full of receipts — and eleven notes with eleven lines in the Costs tab is
 * not a record of a holiday, it is a chore that never gets done.
 *
 * So: one log for the trip, holding many rides, totalling itself. One line in
 * the budget, under Transport, with every ride still readable underneath it.
 *
 * Kept free of Obsidian so the totals can be checked. A wrong total here is a
 * budget quietly out by a hundred euros.
 */

export interface Ride {
  /** ISO date it was taken. */
  date: string;
  /** "Uber", "Bolt", the name of a local firm — whatever the receipt says. */
  service: string;
  from: string;
  to: string;
  /**
   * What it cost, in the log's own currency.
   *
   * Null is a row you have not filled in yet, and it is left out of the total
   * rather than counted as free.
   */
  amount: number | null;
}

/** The names that come up most; the box stays free text for everything else. */
export const RIDE_SERVICES = ["Uber", "Bolt", "Taxi", "Lyft", "Grab", "FREE NOW"];

/** What the log is called, and how one is recognised again later. */
export const RIDES_DESCRIPTION = "Taxis & rides";

export function emptyRide(date: string, service = ""): Ride {
  return { date, service, from: "", to: "", amount: null };
}

/** Frontmatter rides are loose records; this is the only place that shape is known. */
export function readRides(value: unknown): Ride[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const ride = raw as Record<string, unknown>;
      const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
      // Hand-edited notes write numbers as numbers and as strings, and a
      // "12,50" typed by somebody Dutch is a number too.
      const cost = ride?.amount;
      const amount =
        typeof cost === "number" && Number.isFinite(cost)
          ? cost
          : typeof cost === "string" && cost.trim()
            ? Number(cost.replace(",", "."))
            : null;
      return {
        date: str(ride?.date),
        service: str(ride?.service),
        from: str(ride?.from),
        to: str(ride?.to),
        amount: amount !== null && Number.isFinite(amount) ? amount : null,
      };
    })
    .filter((ride) => ride.date || ride.service || ride.from || ride.to || ride.amount !== null);
}

/** Frontmatter-friendly form: plain objects, empties omitted. */
export function ridesToFrontmatter(rides: Ride[]): Record<string, string | number>[] {
  return rides.map((ride) => {
    const out: Record<string, string | number> = {};
    if (ride.date) out.date = ride.date;
    if (ride.service) out.service = ride.service;
    if (ride.from) out.from = ride.from;
    if (ride.to) out.to = ride.to;
    if (ride.amount !== null) out.amount = ride.amount;
    return out;
  });
}

/** By date, because the phone hands them over in whatever order it likes. */
export function orderRides(rides: Ride[]): Ride[] {
  return [...rides].sort(
    (a, b) => a.date.localeCompare(b.date) || a.service.localeCompare(b.service),
  );
}

/** Rows that carry a price. The rest are half-typed, not free. */
export function pricedRides(rides: Ride[]): Ride[] {
  return rides.filter((ride) => ride.amount !== null && ride.amount > 0);
}

/**
 * What the rides come to.
 *
 * Rounded to the cent, because adding a dozen fares in floating point produces
 * totals like 187.40000000000003 and that number would go straight into a note.
 */
export function ridesTotal(rides: Ride[]): number {
  const sum = pricedRides(rides).reduce((total, ride) => total + (ride.amount ?? 0), 0);
  return Math.round(sum * 100) / 100;
}

/**
 * The rows that are actually a fare.
 *
 * Adding a row carries the last one's service and date forward, which is what
 * makes a dozen Ubers quick to log — and it means an untouched row still looks
 * filled in. Saving that produced a ghost ride in the note's table: "Uber",
 * no route, no price, counting towards nothing. A row earns its place with a
 * price or with somewhere it went; a carried-forward service alone does not.
 */
export function meaningfulRides(rides: Ride[]): Ride[] {
  return rides.filter((ride) => ride.amount !== null || Boolean(ride.from) || Boolean(ride.to));
}

export interface RidesShape {
  /** Rides that have a price, which is what "how many taxis" means here. */
  count: number;
  total: number;
  /** First and last dates, so the log can say which stretch it covers. */
  from: string;
  to: string;
  /** The services used, in the order they first appear. */
  services: string[];
}

export function ridesShape(rides: Ride[]): RidesShape {
  const ordered = orderRides(rides);
  const dated = ordered.filter((ride) => ride.date);
  const services: string[] = [];
  for (const ride of ordered) {
    if (ride.service && !services.includes(ride.service)) services.push(ride.service);
  }
  return {
    count: pricedRides(ordered).length,
    total: ridesTotal(ordered),
    from: dated[0]?.date ?? "",
    to: dated[dated.length - 1]?.date ?? "",
    services,
  };
}

/** "11 rides · Uber, Bolt · €187.40", for a heading that has one line to work with. */
export function ridesSummary(rides: Ride[], currency: string): string {
  const shape = ridesShape(rides);
  if (shape.count === 0) return "";
  return [
    `${shape.count} ride${shape.count === 1 ? "" : "s"}`,
    shape.services.join(", "),
    formatMoney({ amount: shape.total, currency }),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The rides as a table in the note body.
 *
 * Written out so the log reads as a record without the plugin, which is the
 * deal everything else here makes too — and so a total can be checked against
 * the rows that made it rather than taken on trust.
 */
export function rideTable(rides: Ride[], currency: string): string[] {
  const ordered = orderRides(rides).filter(
    (ride) => ride.date || ride.service || ride.from || ride.to || ride.amount !== null,
  );
  if (ordered.length === 0) return [];
  const rows = ordered.map((ride) => [
    ride.date,
    ride.service,
    ride.from,
    ride.to,
    ride.amount === null ? "" : formatMoney({ amount: ride.amount, currency }),
  ]);
  return [
    "| Date | Service | From | To | Cost |",
    "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.join(" | ")} |`),
    `| | | | **Total** | **${formatMoney({ amount: ridesTotal(ordered), currency })}** |`,
  ];
}
