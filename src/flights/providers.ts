import { requestUrl } from "obsidian";
import type { FlightLeg } from "../bookings/legs";
import { splitFlightNumber } from "./flightNumber";

export { splitFlightNumber } from "./flightNumber";

export class FlightApiError extends Error {}

/** Both providers are optional and off until you supply your own credentials. */
export interface FlightApiConfig {
  amadeusClientId: string;
  amadeusClientSecret: string;
  /** Amadeus test returns sample data; production returns real fares. */
  amadeusEnvironment: "test" | "production";
}

// ------------------------------------------------- flight-number lookup

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** "2026-08-17T10:15+02:00" and bare "10:15:00" both appear in the wild. */
function splitLocal(value: unknown, fallbackDate = ""): { date: string; time: string } {
  const text = str(value);
  const full = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(text);
  if (full) return { date: full[1], time: full[2] };
  const timeOnly = /^(\d{2}):(\d{2})/.exec(text);
  return timeOnly ? { date: fallbackDate, time: `${timeOnly[1]}:${timeOnly[2]}` } : { date: "", time: "" };
}

interface Timing {
  qualifier?: string;
  value?: string;
}

interface FlightPoint {
  iataCode?: string;
  departure?: { timings?: Timing[] };
  arrival?: { timings?: Timing[] };
}

interface DatedFlight {
  scheduledDepartureDate?: string;
  flightDesignator?: { carrierCode?: string; flightNumber?: number };
  flightPoints?: FlightPoint[];
}

function timingOf(timings: Timing[] | undefined, qualifier: string): string {
  if (!Array.isArray(timings) || timings.length === 0) return "";
  const match = timings.find((t) => str(t.qualifier).toUpperCase() === qualifier);
  return str((match ?? timings[0]).value);
}

/**
 * Looks up a scheduled flight by its number and date.
 *
 * Uses the same Amadeus credentials as the fare search rather than a second
 * account with another provider: one set of keys, and an endpoint whose shape
 * is verified against their published OpenAPI spec.
 */
export async function lookupFlight(
  flightNumber: string,
  date: string,
  config: FlightApiConfig,
): Promise<FlightLeg[]> {
  const parts = splitFlightNumber(flightNumber);
  if (!parts) throw new FlightApiError(`"${flightNumber}" does not look like a flight number.`);

  const token = await amadeusToken(config);
  const params = new URLSearchParams({
    carrierCode: parts.carrier,
    flightNumber: parts.number,
    scheduledDepartureDate: date,
  });

  const response = await requestUrl({
    url: `https://${amadeusHost(config)}/v2/schedule/flights?${params.toString()}`,
    throw: false,
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) {
    cachedToken = null;
    throw new FlightApiError("Amadeus rejected the token. Try again.");
  }
  if (response.status === 404) {
    throw new FlightApiError(`No schedule found for ${parts.carrier}${parts.number} on ${date}.`);
  }
  if (response.status !== 200) {
    const detail = (response.json as { errors?: { detail?: string }[] })?.errors?.[0]?.detail;
    throw new FlightApiError(detail ?? `Flight lookup failed with HTTP ${response.status}.`);
  }

  const body = response.json as { data?: DatedFlight[] };
  const flights = body.data ?? [];
  if (flights.length === 0) {
    throw new FlightApiError(`No schedule found for ${parts.carrier}${parts.number} on ${date}.`);
  }

  return flights
    .map((flight) => {
      const points = flight.flightPoints ?? [];
      const origin = points.find((p) => p.departure) ?? points[0];
      const destination = [...points].reverse().find((p) => p.arrival) ?? points[points.length - 1];
      if (!origin || !destination) return null;

      const scheduled = str(flight.scheduledDepartureDate) || date;
      const out = splitLocal(timingOf(origin.departure?.timings, "STD"), scheduled);
      const arrive = splitLocal(timingOf(destination.arrival?.timings, "STA"), scheduled);

      return {
        operator: str(flight.flightDesignator?.carrierCode) || parts.carrier,
        number: `${parts.carrier}${parts.number}`,
        from: str(origin.iataCode),
        to: str(destination.iataCode),
        date: out.date || scheduled,
        depTime: out.time,
        arrDate: arrive.date || out.date || scheduled,
        arrTime: arrive.time,
      };
    })
    .filter((leg): leg is FlightLeg => leg !== null);
}

// ---------------------------------------------------------- fare search

export interface FlightOffer {
  id: string;
  price: number;
  currency: string;
  /** Outbound legs, then the return legs if the search asked for a return. */
  outbound: FlightLeg[];
  inbound: FlightLeg[];
  stops: number;
}

interface AmadeusSegment {
  departure?: { iataCode?: string; at?: string };
  arrival?: { iataCode?: string; at?: string };
  carrierCode?: string;
  number?: string;
}

function legOf(segment: AmadeusSegment): FlightLeg {
  const from = splitLocal(segment.departure?.at);
  const to = splitLocal(segment.arrival?.at);
  return {
    operator: str(segment.carrierCode),
    number: `${str(segment.carrierCode)}${str(segment.number)}`,
    from: str(segment.departure?.iataCode),
    to: str(segment.arrival?.iataCode),
    date: from.date,
    depTime: from.time,
    arrDate: to.date || from.date,
    arrTime: to.time,
  };
}

function amadeusHost(config: FlightApiConfig): string {
  return config.amadeusEnvironment === "production" ? "api.amadeus.com" : "test.api.amadeus.com";
}

/** Tokens last half an hour; cached so a search does not re-authenticate. */
let cachedToken: { host: string; token: string; expiresAt: number } | null = null;

async function amadeusToken(config: FlightApiConfig): Promise<string> {
  const host = amadeusHost(config);
  if (cachedToken && cachedToken.host === host && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }

  const id = config.amadeusClientId.trim();
  const secret = config.amadeusClientSecret.trim();
  if (!id || !secret) throw new FlightApiError("No Amadeus API key and secret set in settings.");

  const response = await requestUrl({
    url: `https://${host}/v1/security/oauth2/token`,
    method: "POST",
    throw: false,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=client_credentials&client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}`,
  });

  if (response.status !== 200) {
    throw new FlightApiError(
      response.status === 401
        ? "Amadeus rejected the key and secret."
        : `Amadeus authentication failed with HTTP ${response.status}.`,
    );
  }

  const body = response.json as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new FlightApiError("Amadeus returned no access token.");

  cachedToken = {
    host,
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 1799) * 1000,
  };
  return body.access_token;
}

export interface FlightSearch {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  adults: number;
  currency: string;
  nonStop?: boolean;
  max?: number;
}

/**
 * Searches for bookable fares.
 *
 * The test environment returns sample data rather than live fares, which is why
 * the environment is a setting and the UI says which one produced a result — a
 * price you cannot actually buy is worse than no price.
 */
export async function searchFlights(
  search: FlightSearch,
  config: FlightApiConfig,
): Promise<FlightOffer[]> {
  const token = await amadeusToken(config);
  const params = new URLSearchParams({
    originLocationCode: search.origin.toUpperCase(),
    destinationLocationCode: search.destination.toUpperCase(),
    departureDate: search.departureDate,
    adults: String(Math.max(1, search.adults)),
    currencyCode: search.currency.toUpperCase(),
    max: String(search.max ?? 12),
  });
  if (search.returnDate) params.set("returnDate", search.returnDate);
  if (search.nonStop) params.set("nonStop", "true");

  const response = await requestUrl({
    url: `https://${amadeusHost(config)}/v2/shopping/flight-offers?${params.toString()}`,
    throw: false,
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) {
    cachedToken = null;
    throw new FlightApiError("Amadeus rejected the token. Try again.");
  }
  if (response.status !== 200) {
    const detail = (response.json as { errors?: { detail?: string }[] })?.errors?.[0]?.detail;
    throw new FlightApiError(detail ?? `Flight search failed with HTTP ${response.status}.`);
  }

  const body = response.json as {
    data?: {
      id?: string;
      price?: { total?: string; currency?: string };
      itineraries?: { segments?: AmadeusSegment[] }[];
    }[];
  };

  return (body.data ?? []).map((offer, index) => {
    const itineraries = offer.itineraries ?? [];
    const outbound = (itineraries[0]?.segments ?? []).map(legOf);
    const inbound = (itineraries[1]?.segments ?? []).map(legOf);
    return {
      id: str(offer.id) || String(index),
      price: Number(offer.price?.total ?? 0),
      currency: str(offer.price?.currency) || search.currency,
      outbound,
      inbound,
      stops: Math.max(0, outbound.length - 1),
    };
  });
}
