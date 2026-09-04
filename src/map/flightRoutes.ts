import type { FlightLeg } from "../bookings/legs";
import type { TripStage } from "../types";
import type { LatLng } from "./greatCircle";
import { distanceKm } from "./greatCircle";
import { AIRPORTS } from "../data/airports";

/**
 * Turning booked flights into routes a map can draw.
 *
 * Deliberately separate from the drawing: which flights count, which are only
 * proposed and which airports could not be found are all questions with right
 * answers, and answering them inside a render function makes them impossible
 * to check.
 */

const BY_IATA = new Map(AIRPORTS.map((a) => [a.i, a]));

export interface MapPoint extends LatLng {
  code: string;
  city: string;
  country: string;
}

/** The airport an "Amsterdam (AMS)" or bare "AMS" label names, if it is known. */
export function airportPoint(label: string): MapPoint | null {
  const code =
    /\(([A-Z]{3})\)/.exec(label)?.[1] ?? /^\s*([A-Z]{3})\s*$/.exec(label)?.[1] ?? "";
  const airport = BY_IATA.get(code);
  if (!airport) return null;
  return { code: airport.i, city: airport.c, country: airport.y, lat: airport.a, lng: airport.o };
}

/**
 * The point a ground label names, when it is not an airport.
 *
 * A train station has no IATA code, so "Rotterdam Alexander" resolved to
 * nothing and the map drew an empty world for a trip taken entirely by rail.
 * There is no station dataset here, but the airport list carries a city and a
 * position for several thousand cities, and at the scale a route is drawn on
 * an airport is the same dot as the station across town.
 *
 * A stand-in, and labelled as its city rather than its code so the map never
 * claims you caught a plane. Matched on whole words only: "Bar" the Montenegrin
 * port must not be found inside "Barcelona Sants".
 */
const BY_CITY = (() => {
  const map = new Map<string, MapPoint>();
  for (const a of AIRPORTS) {
    const key = a.c.trim().toLowerCase();
    // First wins: the dataset leads with the airport that serves the city.
    if (key && !map.has(key)) {
      map.set(key, { code: a.i, city: a.c, country: a.y, lat: a.a, lng: a.o });
    }
  }
  return map;
})();

/** Letters and spaces only, so "Dubrovnik (Gruž port)" can be read word by word. */
function words(label: string): string[] {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

export function cityPoint(label: string): MapPoint | null {
  const parts = words(label);
  // Longest run first, so "Frankfurt Oder" is not answered with "Frankfurt".
  for (let size = Math.min(3, parts.length); size >= 1; size -= 1) {
    for (let at = 0; at + size <= parts.length; at += 1) {
      const hit = BY_CITY.get(parts.slice(at, at + size).join(" "));
      if (hit) return hit;
    }
  }
  return null;
}

/** Where a journey's end is, however you got there. */
export function routePoint(label: string, surface: boolean): MapPoint | null {
  const airport = airportPoint(label);
  if (airport) return airport;
  return surface ? cityPoint(label) : null;
}

/**
 * Booked is a fact, proposed is an intention, cancelled is a thing that did not
 * happen. Drawn differently, because a map that shows an idea the same as a
 * ticket is a map that will get someone to an airport on the wrong day.
 */
export type RouteKind = "booked" | "proposed" | "cancelled";

/** Which wins when one airport pair is flown by several trips at once. */
const PRECEDENCE: Record<RouteKind, number> = { booked: 2, proposed: 1, cancelled: 0 };

export interface Route {
  from: MapPoint;
  to: MapPoint;
  /** Every flight along this exact pair, so a repeated hop draws once. */
  flights: number;
  km: number;
  kind: RouteKind;
  /**
   * Whether this pair was flown in both directions.
   *
   * The line is drawn once whichever way round you went — two arcs on top of
   * each other would make every return trip twice as dark as a one-way. But
   * "did you come back" is a real fact about the journey, and without it a
   * return trip animates as a plane leaving and never arriving home.
   */
  bothWays: boolean;
  /** Titles of the trips this hop belongs to, for the tooltip. */
  trips: string[];
  /**
   * Travelled on the ground every time, so the line is drawn as a road or a
   * railway rather than a flight path. One flight along the pair is enough to
   * make it a flight route: a great circle is then the honest shape.
   */
  surface: boolean;
}

export interface RouteSet {
  routes: Route[];
  /** Airports touched, deduplicated, for drawing the dots. */
  points: MapPoint[];
  /** Legs whose airports the dataset does not know, so the map is incomplete. */
  unknown: number;
}

export interface RouteInput {
  tripTitle: string;
  stage: TripStage;
  /** Each flight as booked, connections already grouped. */
  journeys?: FlightLeg[][];
  /**
   * Journeys made on the ground — a train, a ferry, a drive. Ends are place
   * names rather than airport codes, so they resolve through their city.
   */
  hops?: { from: string; to: string }[];
  /** Booking status of the flight these legs came from. */
  status: string;
}

/**
 * One route per airport pair, in either direction.
 *
 * Direction is folded together on purpose: a return trip is one line on a map,
 * not two on top of each other, and drawing both would make every round trip
 * look twice as dark as a one-way.
 */
function pairKey(a: MapPoint, b: MapPoint): string {
  return [a.code, b.code].sort().join("-");
}

/** A place the map can be told to go, and the airports that define it. */
export interface Scope {
  /** "" for everything, otherwise the country name. */
  id: string;
  label: string;
  points: MapPoint[];
}

/**
 * The countries the map can actually take you to.
 *
 * Built from the airports that are drawn, not from the trips' destinations: a
 * country you drove to has no airport on this map, and offering to fly you
 * there would be a menu entry that goes nowhere. Everything listed is somewhere
 * the map can genuinely frame.
 */
export function scopesFor(set: RouteSet): Scope[] {
  const byCountry = new Map<string, MapPoint[]>();
  for (const point of set.points) {
    const list = byCountry.get(point.country);
    if (list) list.push(point);
    else byCountry.set(point.country, [point]);
  }
  return [...byCountry.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([country, points]) => ({ id: country, label: country, points }));
}

export function routesFrom(inputs: RouteInput[]): RouteSet {
  const byPair = new Map<string, Route>();
  const points = new Map<string, MapPoint>();
  // Which way round each pair was actually flown, before the fold loses it.
  const headings = new Map<string, Set<string>>();
  let unknown = 0;

  for (const input of inputs) {
    // A cancelled booking was not taken, so there is no flight to draw at all.
    // A cancelled *trip* is different: the flights were real enough to plan,
    // and asking to see cancelled trips and being shown an empty map would be
    // a filter that lies. So it is classified, not dropped, and the caller
    // decides whether to feed it in.
    if (input.status === "cancelled") continue;
    // Booked means booked. A trip still being weighed up, or a flight held as
    // an idea, is a proposal however certain it feels.
    const kind: RouteKind =
      input.stage === "cancelled"
        ? "cancelled"
        : input.status === "booked" && input.stage !== "planning"
          ? "booked"
          : "proposed";

    // Flights and ground journeys reduced to the same thing: two ends and how
    // you covered the distance between them.
    const hops = [
      ...(input.journeys ?? []).flatMap((journey) =>
        journey.map((leg) => ({ from: leg.from, to: leg.to, surface: false })),
      ),
      ...(input.hops ?? []).map((hop) => ({ ...hop, surface: true })),
    ];

    {
      for (const leg of hops) {
        const from = routePoint(leg.from, leg.surface);
        const to = routePoint(leg.to, leg.surface);
        if (!from || !to || from.code === to.code) {
          unknown += 1;
          continue;
        }
        points.set(from.code, from);
        points.set(to.code, to);

        const key = pairKey(from, to);
        const heading = headings.get(key) ?? new Set<string>();
        heading.add(`${from.code}>${to.code}`);
        headings.set(key, heading);

        const existing = byPair.get(key);
        if (existing) {
          existing.flights += 1;
          // One flight along the pair and the line is a flight path.
          if (!leg.surface) existing.surface = false;
          // One booked flight on a pair makes the line solid: the route is
          // real, whatever else is being considered or called off along it.
          if (PRECEDENCE[kind] > PRECEDENCE[existing.kind]) existing.kind = kind;
          if (!existing.trips.includes(input.tripTitle)) existing.trips.push(input.tripTitle);
        } else {
          byPair.set(key, {
            from,
            to,
            flights: 1,
            km: distanceKm(from, to),
            kind,
            bothWays: false,
            trips: [input.tripTitle],
            surface: leg.surface,
          });
        }
      }
    }
  }

  for (const [key, route] of byPair) {
    route.bothWays = (headings.get(key)?.size ?? 0) > 1;
  }

  return {
    // Longest first, so short hops draw over long ones rather than under them.
    routes: [...byPair.values()].sort((a, b) => b.km - a.km),
    points: [...points.values()],
    unknown,
  };
}
