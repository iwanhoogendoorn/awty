import { App, TFile, normalizePath } from "obsidian";
import type { Coord, Place, TravelLeg, TravelMode } from "./types";
import { coordKey, formatLocation, legKey, parseLocation } from "./types";
import { MAX_DESTINATIONS, distanceMatrix, geocode } from "./googleApi";
import type { TravelPlannerSettings, Trip } from "../types";
import type { Booking } from "../bookings/types";
import { parseISO } from "../util/dates";

export interface TravelCache {
  /** legKey -> result. */
  legs: Record<string, { d: number; t: number; at: number }>;
  /** Lowercased address -> "lat,lng". */
  geocode: Record<string, string>;
}

export function emptyTravelCache(): TravelCache {
  return { legs: {}, geocode: {} };
}

export interface TripPlaces {
  hotels: Place[];
  airports: Place[];
  activities: Place[];
  restaurants: Place[];
}

/** Thrown when the feature is on but unusable, so callers can explain why. */
export class TravelUnavailable extends Error {}

export class TravelService {
  constructor(
    private app: App,
    private getSettings: () => TravelPlannerSettings,
    private cache: TravelCache,
    private persist: () => Promise<void>,
  ) {}

  setCache(cache: TravelCache): void {
    this.cache = cache;
  }

  isConfigured(): boolean {
    const settings = this.getSettings();
    return settings.travelTimesEnabled && settings.googleApiKey.trim().length > 0;
  }

  private requireKey(): string {
    const settings = this.getSettings();
    if (!settings.travelTimesEnabled) {
      throw new TravelUnavailable("Travel times are switched off in settings.");
    }
    const key = settings.googleApiKey.trim();
    if (!key) throw new TravelUnavailable("No Google API key set in Travel Planner settings.");
    return key;
  }

  // --------------------------------------------------------------- places

  /**
   * Coordinates for a booking, in cheapest-first order: the note's own
   * `location`, then the geocode cache, then an actual paid geocode whose result
   * is written back to the note so it is never paid for twice.
   */
  private async coordForBooking(booking: Booking, trip: Trip): Promise<Coord | null> {
    const fm = this.app.metadataCache.getFileCache(booking.file)?.frontmatter;
    const existing = parseLocation(fm?.location);
    if (existing) return existing;

    const address = this.addressFor(booking, trip);
    if (!address) return null;

    const coord = await this.geocodeCached(address);
    if (!coord) return null;

    await this.app.fileManager.processFrontMatter(booking.file, (front) => {
      front.location = formatLocation(coord);
    });
    return coord;
  }

  /** Best address string we can build for a booking. */
  private addressFor(booking: Booking, trip: Trip): string {
    const where = [trip.city, trip.country].filter(Boolean).join(", ");
    if (booking.kind === "flight") {
      // The destination airport is what matters for "airport to hotel".
      const airport = booking.to || booking.from;
      return airport ? `${airport} airport` : "";
    }
    const base = booking.to || booking.title;
    if (!base) return "";
    // Skip the city suffix when the address already names it.
    return where && !base.toLowerCase().includes(trip.city.toLowerCase())
      ? `${base}, ${where}`
      : base;
  }

  async geocodeCached(address: string): Promise<Coord | null> {
    const key = address.trim().toLowerCase();
    if (!key) return null;

    const hit = this.cache.geocode[key];
    if (hit) {
      const parsed = parseLocation(hit);
      if (parsed) return parsed;
    }

    const coord = await geocode(address, this.requireKey());
    if (!coord) return null;

    this.cache.geocode[key] = formatLocation(coord);
    await this.persist();
    return coord;
  }

  /** Restaurants come from Food Spot notes, which already carry coordinates. */
  restaurantsFor(trip: Trip): Place[] {
    const city = trip.city.trim().toLowerCase();
    if (!city) return [];

    const out: Place[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || fm.type !== "foodspot") continue;
      if (String(fm.city ?? "").trim().toLowerCase() !== city) continue;
      const coord = parseLocation(fm.location);
      if (!coord) continue;
      out.push({
        id: file.path,
        label: String(fm.name ?? file.basename),
        kind: "restaurant",
        coord,
        file,
      });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }

  /**
   * Every place on a trip worth measuring between. Geocodes on demand, so this
   * can make paid calls the first time it runs for a trip.
   */
  async placesFor(trip: Trip, bookings: Booking[]): Promise<TripPlaces> {
    const places: TripPlaces = { hotels: [], airports: [], activities: [], restaurants: [] };

    for (const booking of bookings) {
      if (booking.status === "cancelled") continue;
      const coord = await this.coordForBooking(booking, trip);
      if (!coord) continue;

      const place: Place = {
        id: booking.file.path,
        label: booking.title,
        kind:
          booking.kind === "stay"
            ? "hotel"
            : booking.kind === "flight"
              ? "airport"
              : booking.kind === "transport"
                ? "station"
                : "activity",
        coord,
        file: booking.file,
      };

      if (place.kind === "hotel") places.hotels.push(place);
      else if (place.kind === "airport") places.airports.push(place);
      else places.activities.push(place);
    }

    places.restaurants = this.restaurantsFor(trip);
    return places;
  }

  // ----------------------------------------------------------------- legs

  private readCache(from: Coord, to: Coord, mode: TravelMode): TravelLeg | null {
    const hit = this.cache.legs[legKey(from, to, mode)];
    if (!hit) return null;
    return { mode, distanceMeters: hit.d, durationSeconds: hit.t };
  }

  /** Cached results for a fan-out, with no network access at all. */
  peekLegs(
    origin: Place,
    destinations: Place[],
    modes: TravelMode[],
  ): Map<string, TravelLeg[]> {
    const out = new Map<string, TravelLeg[]>();
    for (const destination of destinations) {
      const legs: TravelLeg[] = [];
      for (const mode of modes) {
        const leg = this.readCache(origin.coord, destination.coord, mode);
        if (leg) legs.push(leg);
      }
      if (legs.length) out.set(destination.id, legs);
    }
    return out;
  }

  /** True when something in this fan-out would need a paid request. */
  needsFetch(origin: Place, destinations: Place[], modes: TravelMode[]): boolean {
    return destinations.some((d) =>
      modes.some((mode) => this.readCache(origin.coord, d.coord, mode) === null),
    );
  }

  /**
   * Fills in whatever is missing, batching up to 25 destinations per request and
   * per mode. Already-cached pairs cost nothing.
   */
  async fetchLegs(
    origin: Place,
    destinations: Place[],
    modes: TravelMode[],
    when?: Date,
  ): Promise<Map<string, TravelLeg[]>> {
    const key = this.requireKey();
    let dirty = false;

    for (const mode of modes) {
      const missing = destinations.filter(
        (d) =>
          this.readCache(origin.coord, d.coord, mode) === null &&
          coordKey(d.coord) !== coordKey(origin.coord),
      );

      for (let i = 0; i < missing.length; i += MAX_DESTINATIONS) {
        const batch = missing.slice(i, i + MAX_DESTINATIONS);
        const results = await distanceMatrix(
          origin.coord,
          batch.map((d) => d.coord),
          mode,
          key,
          when,
        );
        for (const [index, leg] of results.entries()) {
          if (!leg) continue;
          this.cache.legs[legKey(origin.coord, batch[index].coord, mode)] = {
            d: leg.distanceMeters,
            t: leg.durationSeconds,
            at: Date.now(),
          };
          dirty = true;
        }
      }
    }

    if (dirty) await this.persist();
    return this.peekLegs(origin, destinations, modes);
  }

  /** Departure time to ask about: 09:00 on the trip's first day. */
  departureTimeFor(trip: Trip): Date | undefined {
    const start = parseISO(trip.startDate);
    if (!start) return undefined;
    start.setUTCHours(9, 0, 0, 0);
    return start;
  }

  /** Wipes cached legs so the next look-up re-fetches. */
  async clearLegs(): Promise<void> {
    this.cache.legs = {};
    await this.persist();
  }

  countCached(): { legs: number; addresses: number } {
    return {
      legs: Object.keys(this.cache.legs).length,
      addresses: Object.keys(this.cache.geocode).length,
    };
  }

  /**
   * Reads the Google key out of the Food Spot plugin's own settings, so the two
   * can share one key without it being typed twice. Only ever called when the
   * user clicks the import button.
   */
  async importFoodSpotKey(): Promise<string | null> {
    const path = normalizePath(`${this.app.vault.configDir}/plugins/foodspot/data.json`);
    try {
      const raw = await this.app.vault.adapter.read(path);
      const parsed = JSON.parse(raw) as { settings?: { apiKeys?: { googlePlaces?: string } } };
      const key = parsed?.settings?.apiKeys?.googlePlaces;
      return typeof key === "string" && key.trim() ? key.trim() : null;
    } catch {
      return null;
    }
  }
}

export function tripPlaceCount(places: TripPlaces): number {
  return places.hotels.length + places.airports.length + places.activities.length + places.restaurants.length;
}

export function fileOf(place: Place): TFile | undefined {
  return place.file;
}
