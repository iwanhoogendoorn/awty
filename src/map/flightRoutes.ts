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
  /** Titles of the trips this hop belongs to, for the tooltip. */
  trips: string[];
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
  journeys: FlightLeg[][];
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

export function routesFrom(inputs: RouteInput[]): RouteSet {
  const byPair = new Map<string, Route>();
  const points = new Map<string, MapPoint>();
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

    for (const journey of input.journeys) {
      for (const leg of journey) {
        const from = airportPoint(leg.from);
        const to = airportPoint(leg.to);
        if (!from || !to || from.code === to.code) {
          unknown += 1;
          continue;
        }
        points.set(from.code, from);
        points.set(to.code, to);

        const key = pairKey(from, to);
        const existing = byPair.get(key);
        if (existing) {
          existing.flights += 1;
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
            trips: [input.tripTitle],
          });
        }
      }
    }
  }

  return {
    // Longest first, so short hops draw over long ones rather than under them.
    routes: [...byPair.values()].sort((a, b) => b.km - a.km),
    points: [...points.values()],
    unknown,
  };
}
