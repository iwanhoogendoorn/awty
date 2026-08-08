import type { App } from "obsidian";
import type { Booking } from "../bookings/types";
import type { Trip } from "../types";
import { tripCities } from "../types";
import { formatMoney } from "../util/money";
import { parseLocation } from "../travel/types";
import { airportPoint } from "./flightRoutes";
import type { PlaceKind, TripPlace } from "./tripPlaces";

/**
 * A trip's places, from coordinates the vault already holds.
 *
 * Read-only on purpose. `TravelService.placesFor` resolves a booking's address
 * by geocoding it when it does not know, which is a billed call — fine for a
 * button somebody pressed, unacceptable for a tab that draws itself. So this
 * takes what is already written down and says nothing about the rest, and a
 * booking with no coordinate simply does not appear rather than quietly costing
 * money every time the map repaints.
 *
 * Airports are the exception and come free: the bundled dataset knows where
 * they are, so a flight is always placeable even on a trip nobody has ever run
 * the travel-times command on.
 */

function kindOf(booking: Booking): PlaceKind {
  switch (booking.kind) {
    case "stay":
      return "stay";
    case "flight":
      return "airport";
    case "transport":
      return "transport";
    case "restaurant":
      return "restaurant";
    default:
      return "activity";
  }
}

function priceOf(booking: Booking): string {
  return booking.cost ? formatMoney(booking.cost) : "";
}

export interface TripPlaces {
  places: TripPlace[];
  /**
   * Bookings that name somewhere but have no coordinates yet.
   *
   * Said out loud rather than left as a dot that never appears. An address is
   * not a position — turning one into the other is a billed geocode, which this
   * will not do behind your back — so these are the places waiting for the
   * travel-times command to be run, and a map that just omitted them would look
   * complete while being wrong.
   */
  unplaced: number;
}

export function readTripPlaces(app: App, trip: Trip, bookings: Booking[]): TripPlaces {
  const places: TripPlace[] = [];
  const seen = new Set<string>();
  let unplaced = 0;

  const push = (place: TripPlace): void => {
    const key = `${place.kind}:${place.lat.toFixed(4)},${place.lng.toFixed(4)}:${place.date}`;
    if (seen.has(key)) return;
    seen.add(key);
    places.push(place);
  };

  for (const booking of bookings) {
    // A booking you called off is not somewhere the trip takes you.
    if (booking.status === "cancelled") continue;

    if (booking.kind === "flight") {
      // Every airport the ticket touches, not just the destination: a
      // connection is somewhere you spent two hours of the trip.
      for (const leg of [...booking.legs, ...booking.returnLegs]) {
        // Each end carries its own clock: the airport you leave has the
        // departure time and the one you land at has the arrival. Without them
        // both ends of a flight sat at the same nominal hour and the order fell
        // through to the alphabet — which drew the journey home as Amsterdam to
        // Dubrovnik, the wrong way down the runway.
        for (const [label, date, time] of [
          [leg.from, leg.date, leg.depTime],
          [leg.to, leg.arrDate || leg.date, leg.arrTime],
        ] as const) {
          const airport = airportPoint(label);
          if (!airport) continue;
          push({
            id: `${booking.file.path}:${airport.code}:${date}`,
            label: `${airport.code} — ${airport.city}`,
            kind: "airport",
            lat: airport.lat,
            lng: airport.lng,
            date: date || booking.date,
            time: time || "",
            path: booking.file.path,
            cost: "",
          });
        }
      }
      continue;
    }

    const coord = parseLocation(
      app.metadataCache.getFileCache(booking.file)?.frontmatter?.location,
    );
    if (!coord) {
      // Only counted when there is something a geocode could work from. A
      // booking with no address and no venue is not a place waiting to be
      // found; it is a booking with nowhere written on it.
      if (booking.address.trim() || booking.to.trim()) unplaced += 1;
      continue;
    }
    push({
      id: booking.file.path,
      label: booking.title || booking.to || booking.address,
      kind: kindOf(booking),
      lat: coord.lat,
      lng: coord.lng,
      date: booking.date,
      time: booking.time,
      path: booking.file.path,
      cost: priceOf(booking),
    });
  }

  // Food Spot's own notes for the cities this trip visits. They already carry
  // coordinates, so they cost nothing to place — and a restaurant you have not
  // booked is somewhere you might go, which is worth a dot even though it is
  // not on the route.
  const cities = new Set(tripCities(trip).map((c) => c.trim().toLowerCase()));
  if (cities.size > 0) {
    for (const file of app.vault.getMarkdownFiles()) {
      const fm = app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || fm.type !== "foodspot") continue;
      if (!cities.has(String(fm.city ?? "").trim().toLowerCase())) continue;
      const coord = parseLocation(fm.location);
      if (!coord) continue;
      push({
        id: file.path,
        label: String(fm.name ?? file.basename),
        kind: "restaurant",
        lat: coord.lat,
        lng: coord.lng,
        // No date: it is a suggestion, not an appointment, so the route does
        // not thread itself through somewhere you never said you were going.
        date: "",
        time: "",
        path: file.path,
        cost: "",
      });
    }
  }

  return { places, unplaced };
}
