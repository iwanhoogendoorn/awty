import { requestUrl } from "obsidian";
import type { Coord, TravelLeg, TravelMode } from "./types";

/**
 * Thin wrappers over the Google Maps web services.
 *
 * `requestUrl` is Obsidian's own fetch — it goes through the Electron main
 * process, so these calls are not subject to browser CORS.
 *
 * Every one of these costs money on the caller's Google account, so nothing here
 * is called speculatively: the service layer above checks its cache first and
 * batches destinations into as few requests as the API allows.
 */

export class GoogleApiError extends Error {}

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const MATRIX_URL = "https://maps.googleapis.com/maps/api/distancematrix/json";

/** Distance Matrix caps a single request at 25 destinations. */
export const MAX_DESTINATIONS = 25;

interface GeocodeResponse {
  status: string;
  error_message?: string;
  results?: { geometry?: { location?: { lat: number; lng: number } } }[];
}

export async function geocode(address: string, apiKey: string): Promise<Coord | null> {
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(address)}&key=${encodeURIComponent(apiKey)}`;
  const response = await requestUrl({ url, throw: false });

  if (response.status !== 200) {
    throw new GoogleApiError(`Geocoding failed with HTTP ${response.status}.`);
  }
  const body = response.json as GeocodeResponse;

  if (body.status === "ZERO_RESULTS") return null;
  if (body.status !== "OK") {
    throw new GoogleApiError(describe(body.status, body.error_message, "Geocoding"));
  }

  const location = body.results?.[0]?.geometry?.location;
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return null;
  return { lat: location.lat, lng: location.lng };
}

interface MatrixElement {
  status: string;
  distance?: { value: number };
  duration?: { value: number };
}

interface MatrixResponse {
  status: string;
  error_message?: string;
  rows?: { elements?: MatrixElement[] }[];
}

/**
 * One origin, many destinations, one mode — the shape that costs the fewest
 * requests. Returns an array aligned with `destinations`, holding null where
 * Google has no route (a ferry-only island by car, or nowhere with transit).
 */
export async function distanceMatrix(
  origin: Coord,
  destinations: Coord[],
  mode: TravelMode,
  apiKey: string,
  departureTime?: Date,
): Promise<(TravelLeg | null)[]> {
  if (destinations.length === 0) return [];
  if (destinations.length > MAX_DESTINATIONS) {
    throw new GoogleApiError(`Too many destinations in one request (max ${MAX_DESTINATIONS}).`);
  }

  const params = new URLSearchParams({
    origins: `${origin.lat},${origin.lng}`,
    destinations: destinations.map((d) => `${d.lat},${d.lng}`).join("|"),
    mode,
    units: "metric",
    key: apiKey,
  });

  // Transit needs a departure time, and Google rejects one in the past. For a
  // future trip we ask about that trip; otherwise we ask about now.
  if (mode === "transit") {
    const when = departureTime && departureTime.getTime() > Date.now() ? departureTime : new Date();
    params.set("departure_time", String(Math.floor(when.getTime() / 1000)));
  }

  const response = await requestUrl({ url: `${MATRIX_URL}?${params.toString()}`, throw: false });
  if (response.status !== 200) {
    throw new GoogleApiError(`Distance lookup failed with HTTP ${response.status}.`);
  }

  const body = response.json as MatrixResponse;
  if (body.status !== "OK") {
    throw new GoogleApiError(describe(body.status, body.error_message, "Distance lookup"));
  }

  const elements = body.rows?.[0]?.elements ?? [];
  return destinations.map((_, index) => {
    const element = elements[index];
    if (!element || element.status !== "OK") return null;
    const distanceMeters = element.distance?.value;
    const durationSeconds = element.duration?.value;
    if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds)) return null;
    return { mode, distanceMeters: distanceMeters as number, durationSeconds: durationSeconds as number };
  });
}

/** Turns Google's status codes into something worth showing a human. */
function describe(status: string, message: string | undefined, what: string): string {
  switch (status) {
    case "REQUEST_DENIED":
      return `${what} was denied. Check the API key, and that Geocoding and Distance Matrix are enabled on that Google Cloud project.${message ? ` (${message})` : ""}`;
    case "OVER_QUERY_LIMIT":
      return `${what} hit the Google quota or billing limit for this key.`;
    case "INVALID_REQUEST":
      return `${what} was rejected as invalid.${message ? ` (${message})` : ""}`;
    default:
      return `${what} failed: ${status}.${message ? ` ${message}` : ""}`;
  }
}
