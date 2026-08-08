import type { LatLng } from "./greatCircle";

/**
 * Everywhere a trip actually puts you, and the order it puts you there.
 *
 * The flight arcs say which countries a trip touches. This is the other half:
 * the airport you land at, the hotel you sleep in, the table you booked and the
 * thing you went to see — and the ground you cover between them.
 *
 * Kept free of Obsidian so the ordering can be checked. What connects to what
 * is the whole feature, and getting it wrong draws a plausible line through a
 * day that never happened.
 */

export type PlaceKind = "airport" | "stay" | "transport" | "activity" | "restaurant";

export interface PlaceKindDef {
  id: PlaceKind;
  label: string;
  icon: string;
}

/**
 * One colour per kind, and the colours are the legend.
 *
 * Deliberately the same five everywhere they appear — pin, chip and line — so
 * that orange means "somewhere you eat" without anybody having to look it up.
 */
export const PLACE_KINDS: readonly PlaceKindDef[] = [
  { id: "airport", label: "Airports", icon: "plane" },
  { id: "stay", label: "Stays", icon: "bed" },
  { id: "transport", label: "Transport", icon: "train-front" },
  { id: "activity", label: "Activities", icon: "ticket" },
  { id: "restaurant", label: "Places to eat", icon: "utensils" },
];

export function placeKindDef(kind: PlaceKind): PlaceKindDef {
  return PLACE_KINDS.find((k) => k.id === kind) ?? PLACE_KINDS[PLACE_KINDS.length - 1];
}

export interface TripPlace extends LatLng {
  /** Stable across renders: the note path, or the coordinate when there is none. */
  id: string;
  label: string;
  kind: PlaceKind;
  /** ISO date this place is visited. Empty for somewhere merely suggested. */
  date: string;
  /** "HH:MM", when the booking records one. */
  time: string;
  /** Vault path of the note behind it, for opening from the map. */
  path: string;
  /** What it cost, already formatted, for the tooltip. Empty when unpriced. */
  cost: string;
}

const KIND_ORDER: Record<PlaceKind, number> = {
  airport: 0,
  transport: 1,
  stay: 2,
  activity: 3,
  restaurant: 4,
};

/**
 * When a place with no clock time sits in the day.
 *
 * Plenty of things carry no time. A flight's own time is when it leaves the
 * airport you started from, so the airport you land at has none; a hotel rarely
 * records check-in. Sorting those to the end of the day put an untimed landing
 * after an eight o'clock dinner, which is a day nobody has ever had.
 *
 * So each kind gets the hour it usually happens at — you land, you check in,
 * you go out, you eat. These are for ordering only and are never shown: nothing
 * here claims your flight was at six.
 */
const NOMINAL_TIME: Record<PlaceKind, string> = {
  airport: "06:00",
  transport: "08:00",
  activity: "11:00",
  stay: "14:00",
  restaurant: "19:30",
};

function whenIn(place: TripPlace): string {
  return place.time || NOMINAL_TIME[place.kind];
}

/**
 * The order a trip happens in.
 *
 * By date, then by the time it happened at, then by kind for anything that
 * lands on the same minute. A place with no date is not in the running: it is
 * somewhere you might go, and threading a route through it invents a journey.
 */
export function orderPlaces(places: TripPlace[]): TripPlace[] {
  return [...places].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      whenIn(a).localeCompare(whenIn(b)) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.label.localeCompare(b.label),
  );
}

/**
 * The places the route can be drawn through: dated, visible, and somewhere new.
 *
 * Consecutive stops at the same spot are collapsed — three days running at one
 * hotel is a place you keep returning to, not a line of length nought drawn
 * three times — but a return to it later in the trip is a real journey back and
 * is kept.
 */
export function routeThrough(places: TripPlace[], visible: Set<PlaceKind>): TripPlace[] {
  const dated = orderPlaces(places).filter((p) => p.date && visible.has(p.kind));
  const out: TripPlace[] = [];
  for (const place of dated) {
    const last = out[out.length - 1];
    if (last && same(last, place)) continue;
    out.push(place);
  }
  return out;
}

/** Within about ten metres, which is the same doorway as far as a map cares. */
function same(a: LatLng, b: LatLng): boolean {
  return Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4;
}

/**
 * As far in as the map will go.
 *
 * Lives next to `zoomForKind` because the two have to agree: asking to be taken
 * somewhere closer than the map allows is silently clamped, and the feature
 * then quietly does less than it says. Deep enough for a street, and still
 * nowhere near treating OpenStreetMap as a bulk source.
 */
export const MAX_MAP_ZOOM = 16;

/**
 * How close you want to be, once you have asked to go somewhere.
 *
 * An airport is a couple of kilometres of tarmac and you want the roads around
 * it; a restaurant is a doorway and you want the street it is on. One number
 * for both would either lose the terminal or drop you three towns from dinner.
 */
export function zoomForKind(kind: PlaceKind): number {
  return kind === "airport" ? 11 : 15;
}

export interface PlaceScope {
  id: string;
  label: string;
  kind: PlaceKind;
  lat: number;
  lng: number;
}

/**
 * Everywhere the map can be told to go on this trip.
 *
 * The dropdown used to offer the countries its airports were in, which on a
 * trip is a strange thing to be asked: you know which country you went to, and
 * what you actually want is the hotel. So a selected trip lists its places —
 * the airport, the hotel, the table, the thing you booked — and the countries
 * are left to the view across every trip, where they are the useful unit.
 *
 * One entry per place, however many days it appears on: an airport you fly into
 * and back out of is one airport.
 */
export function placeScopes(places: TripPlace[]): PlaceScope[] {
  const byPlace = new Map<string, PlaceScope>();
  for (const place of places) {
    const key = `${place.label}@${place.lat.toFixed(4)},${place.lng.toFixed(4)}`;
    if (byPlace.has(key)) continue;
    byPlace.set(key, {
      id: key,
      label: place.label,
      kind: place.kind,
      lat: place.lat,
      lng: place.lng,
    });
  }
  const order = new Map(PLACE_KINDS.map((k, i) => [k.id, i]));
  return [...byPlace.values()].sort(
    (a, b) => (order.get(a.kind) ?? 9) - (order.get(b.kind) ?? 9) || a.label.localeCompare(b.label),
  );
}

/** How many of each kind there are, so a filter chip can say what it hides. */
export function countByKind(places: TripPlace[]): Map<PlaceKind, number> {
  const counts = new Map<PlaceKind, number>();
  for (const place of places) counts.set(place.kind, (counts.get(place.kind) ?? 0) + 1);
  return counts;
}

/**
 * The days the route spans, for labelling each leg.
 *
 * A trip's ground route is not one journey but a sequence of them, and the day
 * is what separates them: the line from the last restaurant on Tuesday to the
 * first thing on Wednesday is you going to bed, not you travelling.
 */
export function legsOf(route: TripPlace[]): { from: TripPlace; to: TripPlace; sameDay: boolean }[] {
  const legs: { from: TripPlace; to: TripPlace; sameDay: boolean }[] = [];
  for (let i = 1; i < route.length; i += 1) {
    legs.push({ from: route[i - 1], to: route[i], sameDay: route[i - 1].date === route[i].date });
  }
  return legs;
}
