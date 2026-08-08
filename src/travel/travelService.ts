import { App, TFile, normalizePath } from "obsidian";
import type { Coord, Place, TravelLeg, TravelMode } from "./types";
import { coordKey, formatLocation, legKey, parseLocation } from "./types";
import { geocodeQuery } from "../bookings/postalAddress";
import { MAX_DESTINATIONS, distanceMatrix, geocode } from "./googleApi";
import { tripCities, type AwtySettings, type Trip } from "../types";
import type { Booking } from "../bookings/types";
import { parseISO } from "../util/dates";

export interface TravelCache {
  /** Country -> the last advice fetched for it, with when. */
  advice?: Record<string, { colour: string; url: string; fetchedAt: number }>;
  /**
   * legKey -> result. `d: -1` records that Google found no route, so the same
   * dead pair is not paid for again on every look-up. `on` is the departure
   * date the answer was asked for, which matters for transit.
   */
  legs: Record<string, { d: number; t: number; at: number; on?: string }>;
  /** Lowercased address -> "lat,lng". */
  geocode: Record<string, string>;
}

/**
 * How long a "no route" answer is trusted.
 *
 * Element-level failures are indistinguishable from a genuine absence of a
 * route, so a transient one used to become permanent: nothing consulted the
 * timestamp, and the mode stayed dead until the whole cache was cleared.
 */
const NO_ROUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The departure date a lookup was asked about, as YYYY-MM-DD. */
function isoOf(when?: Date): string | undefined {
  if (!when) return undefined;
  return `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, "0")}-${String(when.getUTCDate()).padStart(2, "0")}`;
}

export function emptyTravelCache(): TravelCache {
  return { legs: {}, geocode: {}, advice: {} };
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
    private getSettings: () => AwtySettings,
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
    if (!key) throw new TravelUnavailable("No Google API key set in Are We There Yet? settings.");
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
    if (booking.kind === "flight") {
      // The destination airport is what matters for "airport to hotel", and
      // nothing else will do: the origin is where you started, not where you
      // need a taxi from.
      return booking.to ? `${booking.to} airport` : "";
    }
    // A street address places a pin far better than a venue's name; the venue
    // is the fallback, and the title the last resort. The trip supplies only
    // the parts the address itself did not.
    return geocodeQuery(
      booking.postal,
      booking.to || booking.title,
      trip.city,
      trip.country,
    );
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
    // Every city the trip visits, not just the first: a place in Kotor is no
    // less on this trip than one in Dubrovnik.
    const cities = new Set(tripCities(trip).map((c) => c.trim().toLowerCase()));
    if (cities.size === 0) return [];

    const out: Place[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || fm.type !== "foodspot") continue;
      if (!cities.has(String(fm.city ?? "").trim().toLowerCase())) continue;
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

      // A flight's place is the airport it lands at; labelling it with the
      // whole route read as though AMS⇄DBV were 21 km from the apartment.
      // The airport you land at. A flight with no destination recorded is not
      // an airport transfer to its origin, so it is left out entirely.
      const label = booking.kind === "flight" ? booking.to : booking.title;
      if (!label) continue;

      const place: Place = {
        id: booking.file.path,
        label,
        kind:
          booking.kind === "stay"
            ? "hotel"
            : booking.kind === "flight"
              ? "airport"
              : booking.kind === "transport"
                ? "station"
                : booking.kind === "restaurant"
                  ? "restaurant"
                  : "activity",
        coord,
        file: booking.file,
        // A flight's place is the airport it lands at, so the transfer to the
        // hotel happens on the outbound date, not the return. No time: the
        // booking's own time is the departure from home, and its end is the
        // return arrival on a return ticket — neither is when you land.
        date: booking.date,
        time: booking.kind === "flight" ? "" : booking.time,
      };

      if (place.kind === "hotel") places.hotels.push(place);
      else if (place.kind === "airport") places.airports.push(place);
      else if (place.kind === "restaurant") places.restaurants.push(place);
      else places.activities.push(place);
    }

    // Food Spot's places for the city, minus any already booked here — a table
    // you have reserved should appear once, with its own address and cost.
    const booked = new Set(places.restaurants.map((r) => r.label.trim().toLowerCase()));
    for (const spot of this.restaurantsFor(trip)) {
      if (!booked.has(spot.label.trim().toLowerCase())) places.restaurants.push(spot);
    }
    places.restaurants.sort((a, b) => a.label.localeCompare(b.label));
    return places;
  }

  // ----------------------------------------------------------------- legs

  /**
   * A cached answer, or null when there is none.
   *
   * Returns `known: true, leg: null` for a pair Google has already said it
   * cannot route: that is an answer, and re-asking for it costs money every
   * time the screen is drawn.
   */
  private readCache(
    from: Coord,
    to: Coord,
    mode: TravelMode,
    on?: string,
  ): { known: boolean; leg: TravelLeg | null } {
    const hit = this.cache.legs[legKey(from, to, mode)];
    if (!hit) return { known: false, leg: null };
    // Transit depends on the day it is asked about — a Sunday timetable is not
    // a Tuesday one — so an answer for another date is not an answer for this.
    // An entry without a date predates dates being recorded, so there is no
    // saying which timetable answered it; treat it as a miss for fetching
    // while still showing it. `hit.on &&` here made legacy entries valid for
    // every date forever.
    if (on && mode === "transit" && hit.on !== on) {
      return {
        known: false,
        leg: hit.d < 0 ? null : { mode, distanceMeters: hit.d, durationSeconds: hit.t },
      };
    }
    if (hit.d < 0) {
      const stale = Date.now() - hit.at > NO_ROUTE_TTL_MS;
      return { known: !stale, leg: null };
    }
    return { known: true, leg: { mode, distanceMeters: hit.d, durationSeconds: hit.t } };
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
        // No date here on purpose: the display shows the last known answer
        // rather than blanking because the trip moved. Only fetching cares.
        const { leg } = this.readCache(origin.coord, destination.coord, mode);
        if (leg) legs.push(leg);
      }
      if (legs.length) out.set(destination.id, legs);
    }
    return out;
  }

  /** True when something in this fan-out would need a paid request. */
  needsFetch(origin: Place, destinations: Place[], modes: TravelMode[], when?: Date): boolean {
    const on = isoOf(when);
    return destinations.some((d) =>
      modes.some((mode) => !this.readCache(origin.coord, d.coord, mode, on).known),
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
    /** Ask again for pairs already recorded as having no route. */
    retryDeadEnds = false,
    /** Refetch every pair, cached or not — the Refresh button's meaning. */
    refetch = false,
  ): Promise<Map<string, TravelLeg[]>> {
    const key = this.requireKey();
    const on = isoOf(when);
    let dirty = false;

    for (const mode of modes) {
      const missing = destinations.filter((d) => {
        if (coordKey(d.coord) === coordKey(origin.coord)) return false;
        if (refetch) return true;
        const cached = this.readCache(origin.coord, d.coord, mode, on);
        // A button offering to look something up has to actually look it up.
        if (retryDeadEnds && cached.known && cached.leg === null) return true;
        return !cached.known;
      });

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
          // A missing element is Google saying there is no route. Recording it
          // stops the next look-up paying to be told the same thing.
          this.cache.legs[legKey(origin.coord, batch[index].coord, mode)] = leg
            ? { d: leg.distanceMeters, t: leg.durationSeconds, at: Date.now(), on }
            : { d: -1, t: -1, at: Date.now(), on };
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

  /**
   * Drops everything cached for one trip.
   *
   * Cached routes are keyed by coordinate, not by trip, so this works out which
   * coordinates belonged to it and removes any leg touching them.
   */
  async forgetTrip(trip: Trip): Promise<void> {
    const bookings = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(`${trip.folderPath}/`));

    const keys = new Set<string>();
    for (const file of bookings) {
      const coord = parseLocation(this.app.metadataCache.getFileCache(file)?.frontmatter?.location);
      if (coord) keys.add(coordKey(coord));
    }
    if (keys.size === 0) return;

    for (const key of Object.keys(this.cache.legs)) {
      const [from, to] = key.split("|");
      if (keys.has(from) || keys.has(to)) delete this.cache.legs[key];
    }
    await this.persist();
  }

  /**
   * Checks the key against both APIs the plugin needs.
   *
   * Geocoding and Distance Matrix are enabled separately on a Google Cloud
   * project, and having one without the other is the usual reason travel times
   * fail — so the test says which of the two is missing rather than just
   * "failed". Costs two requests, and is only run from the button.
   */
  async testKey(): Promise<{ ok: boolean; message: string }> {
    const key = this.getSettings().googleApiKey.trim();
    if (!key) return { ok: false, message: "No key to test." };

    let origin: Coord | null;
    try {
      origin = await geocode("Amsterdam Airport Schiphol", key);
    } catch (err) {
      return { ok: false, message: `Geocoding: ${err instanceof Error ? err.message : "failed"}` };
    }
    if (!origin) return { ok: false, message: "Geocoding returned nothing." };

    try {
      // A short, well-known hop: Schiphol to Amsterdam Centraal.
      const [leg] = await distanceMatrix(origin, [{ lat: 52.379, lng: 4.9 }], "driving", key);
      if (!leg) return { ok: false, message: "Distance Matrix returned no route." };
      return {
        ok: true,
        message: `Both APIs answered — Schiphol to Amsterdam in ${Math.round(leg.durationSeconds / 60)} min.`,
      };
    } catch (err) {
      return {
        ok: false,
        message: `Distance Matrix: ${err instanceof Error ? err.message : "failed"}`,
      };
    }
  }

  /** Wipes every cached leg, for the settings button that says so. */
  async clearLegs(): Promise<void> {
    this.cache.legs = {};
    await this.persist();
  }

  /** Wipes cached addresses too — "clear the cache" counted both. */
  async clearAll(): Promise<void> {
    this.cache.legs = {};
    this.cache.geocode = {};
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
