import type { TFile } from "obsidian";

export interface Coord {
  lat: number;
  lng: number;
}

/** Google's travel modes we actually offer. */
export type TravelMode = "driving" | "transit" | "walking";

export const TRAVEL_MODES: { id: TravelMode; label: string; icon: string }[] = [
  { id: "driving", label: "Car", icon: "car" },
  { id: "transit", label: "Public transport", icon: "train-front" },
  { id: "walking", label: "Walking", icon: "footprints" },
];

export type PlaceKind = "airport" | "hotel" | "activity" | "restaurant" | "station";

export interface Place {
  /** Stable key: the note path where possible, else the rounded coordinate. */
  id: string;
  label: string;
  kind: PlaceKind;
  coord: Coord;
  file?: TFile;
}

export interface TravelLeg {
  mode: TravelMode;
  distanceMeters: number;
  durationSeconds: number;
}

export interface TravelResult {
  from: Place;
  to: Place;
  legs: TravelLeg[];
}

/** Cache entry keyed by coordinate pair and mode. */
export interface CachedLeg {
  distanceMeters: number;
  durationSeconds: number;
  /** Epoch millis, so stale transit estimates can be refreshed. */
  fetchedAt: number;
}

export function parseLocation(value: unknown): Coord | null {
  if (typeof value !== "string") return null;
  const parts = value.split(",");
  if (parts.length !== 2) return null;
  const lat = Number(parts[0].trim());
  const lng = Number(parts[1].trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** The same "lat,lng" string shape Food Spot writes, so the two stay readable alike. */
export function formatLocation(coord: Coord): string {
  return `${coord.lat},${coord.lng}`;
}

/** Rounded to ~11 m, which is plenty to identify a building and keeps cache keys stable. */
export function coordKey(coord: Coord): string {
  return `${coord.lat.toFixed(4)},${coord.lng.toFixed(4)}`;
}

export function legKey(from: Coord, to: Coord, mode: TravelMode): string {
  return `${coordKey(from)}|${coordKey(to)}|${mode}`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  const km = meters / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}
