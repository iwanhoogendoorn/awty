import { requestUrl } from "obsidian";
import type { FlightLeg } from "../bookings/legs";

export class FlightApiError extends Error {}

/** Both providers are optional and off until you supply your own credentials. */
export interface FlightApiConfig {
  /** RapidAPI key for the flight-number lookup. */
  rapidApiKey: string;
  amadeusClientId: string;
  amadeusClientSecret: string;
  /** Amadeus test returns sample data; production returns real fares. */
  amadeusEnvironment: "test" | "production";
}

// ------------------------------------------------- flight-number lookup

const AERODATABOX_HOST = "aerodatabox.p.rapidapi.com";

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** "2026-08-17T10:15+02:00" and friends, split into date and time. */
function splitLocal(value: unknown): { date: string; time: string } {
  const text = str(value);
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(text);
  return m ? { date: m[1], time: m[2] } : { date: "", time: "" };
}

interface AeroEndpoint {
  airport?: { iata?: string; iataCode?: string; name?: string };
  scheduledTime?: { local?: string };
  scheduledTimeLocal?: string;
  terminal?: string;
}

interface AeroFlight {
  number?: string;
  airline?: { name?: string };
  departure?: AeroEndpoint;
  arrival?: AeroEndpoint;
}

function endpointOf(end: AeroEndpoint | undefined): { code: string; date: string; time: string } {
  const code = str(end?.airport?.iata ?? end?.airport?.iataCode);
  const when = splitLocal(end?.scheduledTime?.local ?? end?.scheduledTimeLocal);
  return { code, ...when };
}

/**
 * Looks up a scheduled flight by its number and date.
 *
 * By the time you are using this you have already booked; the flight number is
 * on the confirmation and everything else is transcription. Shapes are read
 * defensively because this is a third-party API that can change under us.
 */
export async function lookupFlight(
  flightNumber: string,
  date: string,
  config: FlightApiConfig,
): Promise<FlightLeg[]> {
  const key = config.rapidApiKey.trim();
  if (!key) throw new FlightApiError("No RapidAPI key set in Travel Planner settings.");

  const number = flightNumber.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9]{2}\d{1,4}$/.test(number)) {
    throw new FlightApiError(`"${flightNumber}" does not look like a flight number.`);
  }

  const url = `https://${AERODATABOX_HOST}/flights/number/${encodeURIComponent(number)}/${encodeURIComponent(date)}`;
  const response = await requestUrl({
    url,
    throw: false,
    headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": AERODATABOX_HOST },
  });

  if (response.status === 204 || response.status === 404) {
    throw new FlightApiError(`No schedule found for ${number} on ${date}.`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new FlightApiError("The RapidAPI key was rejected. Check it, and that you are subscribed to AeroDataBox.");
  }
  if (response.status === 429) {
    throw new FlightApiError("Rate limit reached on your RapidAPI plan.");
  }
  if (response.status !== 200) {
    throw new FlightApiError(`Flight lookup failed with HTTP ${response.status}.`);
  }

  const body = response.json as AeroFlight[] | { flights?: AeroFlight[] };
  const flights = Array.isArray(body) ? body : (body?.flights ?? []);
  if (!Array.isArray(flights) || flights.length === 0) {
    throw new FlightApiError(`No schedule found for ${number} on ${date}.`);
  }

  return flights.map((flight) => {
    const from = endpointOf(flight.departure);
    const to = endpointOf(flight.arrival);
    return {
      operator: str(flight.airline?.name),
      number: str(flight.number).replace(/\s+/g, "") || number,
      from: from.code,
      to: to.code,
      date: from.date || date,
      depTime: from.time,
      arrDate: to.date || from.date || date,
      arrTime: to.time,
    };
  });
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
