import { AIRPORTS } from "../data/airports";
import type { TripStop } from "../types";

/**
 * The flights a route implies.
 *
 * A trip to Bangkok and Balikpapan is three journeys — out, between, home —
 * and a booking holds one. Nothing stopped you adding three flight bookings,
 * but nothing said so either, and each one meant looking up airport codes for
 * cities the trip already names.
 */
export interface FlightHop {
  label: string;
  from: string;
  to: string;
  /** Which stop this arrives at, so the date can be guessed sensibly. */
  arriveIndex: number;
}

/** The busiest airport serving a city, by the dataset's own ordering. */
export function airportForCity(city: string): string {
  const wanted = city.trim().toLowerCase();
  if (!wanted) return "";
  const hit = AIRPORTS.find((a) => a.c.trim().toLowerCase() === wanted);
  return hit ? hit.i : "";
}

/**
 * @param originAirport Where the traveller starts and ends, when known.
 */
export function flightHops(stops: TripStop[], originAirport: string): FlightHop[] {
  const places = stops.filter((stop) => stop.city);
  if (places.length === 0) return [];

  const home = originAirport.trim().toUpperCase();
  const codes = places.map((stop) => airportForCity(stop.city));
  const hops: FlightHop[] = [];

  if (home && codes[0]) {
    hops.push({ label: `${home} → ${places[0].city}`, from: home, to: codes[0], arriveIndex: 0 });
  }
  for (let i = 1; i < places.length; i += 1) {
    if (!codes[i - 1] || !codes[i]) continue;
    hops.push({
      label: `${places[i - 1].city} → ${places[i].city}`,
      from: codes[i - 1],
      to: codes[i],
      arriveIndex: i,
    });
  }
  const last = codes[codes.length - 1];
  if (home && last) {
    hops.push({
      label: `${places[places.length - 1].city} → ${home}`,
      from: last,
      to: home,
      arriveIndex: places.length - 1,
    });
  }
  return hops;
}
