import type { LatLng } from "./greatCircle";
import { distanceKm } from "./greatCircle";

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
  /**
   * For an airport, which end of a leg this appearance is.
   *
   * The same terminal is a departure in the morning and an arrival in the
   * evening, and the difference decides what can be true around it: you cannot
   * be at your hotel before the flight that brought you has landed.
   */
  role?: "departure" | "arrival";
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

/** Close enough that one is the way you reach the other. */
const NEAR_KM = 150;

function oneMinuteAfter(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const total = Math.min(h * 60 + m + 1, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * When each place happens, with guessed times kept behind the known ones.
 *
 * A nominal time is a stand-in, and a stand-in must never overrule a fact. A
 * hotel records no check-in, so it sat at two o'clock — half an hour before the
 * flight that brought you to the city actually landed. The day then read
 * "leave London, arrive at the hotel, go to Miami airport", and the map drew
 * the middle of that as a seven-thousand-kilometre drive.
 *
 * So an untimed place is held until you have arrived somewhere near it. Only
 * arrivals count, and only nearby ones: a landing at JFK says nothing about
 * when you had lunch in Miami, and neither does a departure.
 */
function timesOf(places: TripPlace[]): Map<TripPlace, string> {
  const arrivals = places.filter((p) => p.role === "arrival" && p.time);
  // Keyed by the place itself, not by its id: an id names a place, and one
  // place appears on several days. Keying by id let the last appearance of an
  // airport hand its time to the first, which reordered the outward journey to
  // match the way home.
  const out = new Map<TripPlace, string>();
  for (const place of places) {
    let when = whenIn(place);
    if (!place.time) {
      for (const landing of arrivals) {
        if (landing.date !== place.date) continue;
        if (landing.time < when) continue;
        if (distanceKm(landing, place) > NEAR_KM) continue;
        when = oneMinuteAfter(landing.time);
      }
    }
    out.set(place, when);
  }
  return out;
}

/**
 * The order a trip happens in.
 *
 * By date, then by the time it happened at, then by kind for anything that
 * lands on the same minute. A place with no date is not in the running: it is
 * somewhere you might go, and threading a route through it invents a journey.
 */
export function orderPlaces(places: TripPlace[]): TripPlace[] {
  const when = timesOf(places);
  const at = (p: TripPlace): string => when.get(p) ?? whenIn(p);
  return [...places].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      at(a).localeCompare(at(b)) ||
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
/**
 * The id a place is known by once it is offered in a menu.
 *
 * Not `TripPlace.id`, which is per-appearance — an airport you fly into and
 * back out of has two of those, and a menu wants one entry. Exported because
 * anything that resolves a choice back to a place has to compute it the same
 * way; when only the menu knew how, every picker silently matched nothing.
 */
export function scopeIdOf(place: TripPlace): string {
  return `${place.label}@${place.lat.toFixed(4)},${place.lng.toFixed(4)}`;
}

export function placeScopes(places: TripPlace[]): PlaceScope[] {
  const byPlace = new Map<string, PlaceScope>();
  for (const place of places) {
    const key = scopeIdOf(place);
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

/**
 * Visible places the route cannot reach, because nothing says when you go.
 *
 * The route is built from dates and times on your bookings — there is nowhere
 * to wire one place to another by hand, and there should not be. But a place
 * with no date silently vanishing from the route is a rule nobody can see and
 * nobody can act on, so these come back to be named on screen.
 */
export function unscheduled(places: TripPlace[], visible: Set<PlaceKind>): TripPlace[] {
  return orderPlaces(places).filter((p) => !p.date && visible.has(p.kind));
}

/**
 * How many of each kind there are, counting places rather than appearances.
 *
 * An airport you fly into and back out of is one airport on two days. Counting
 * the appearances made the chip say "Airports 4" over two pins, and drew the
 * second of each pair exactly on top of the first.
 */
export function countByKind(places: TripPlace[]): Map<PlaceKind, number> {
  const counts = new Map<PlaceKind, number>();
  const seen = new Set<string>();
  for (const place of places) {
    const id = scopeIdOf(place);
    if (seen.has(id)) continue;
    seen.add(id);
    counts.set(place.kind, (counts.get(place.kind) ?? 0) + 1);
  }
  return counts;
}

/**
 * The furthest an airport transfer can plausibly be.
 *
 * Generous on purpose: the airport is sometimes a different city, and a train
 * onward from it can be most of a country. Airlines fly people from Bangkok to
 * Chiang Mai, and people take the train instead. What does not fit is an ocean
 * — the shortest transatlantic hop is over three times this.
 *
 * Only applied when one end is an airport. Two hotels a long way apart are a
 * journey somebody made by some means, and it is not this function's business
 * to decide it was impossible.
 */
export const MAX_AIRPORT_TRANSFER_KM = 1500;

export interface Connection {
  from: TripPlace;
  to: TripPlace;
  /** Travelled in both directions, so it earns a dot going each way. */
  bothWays: boolean;
}

function pairKey(a: TripPlace, b: TripPlace): string {
  const one = `${a.lat.toFixed(4)},${a.lng.toFixed(4)}`;
  const two = `${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;
  return one < two ? `${one}|${two}` : `${two}|${one}`;
}

/**
 * The roads a trip travels, each drawn once.
 *
 * Consecutive places make a journey; a pair travelled both ways — out to the
 * hotel and back to the airport a week later — is one road, not two lines on
 * top of each other. Drawing both put two dots on what looked like one line,
 * moving at different speeds in opposite directions, which reads as the
 * animation being broken rather than as a return trip.
 *
 * There is deliberately no "overnight" here any more. It marked a leg whose
 * ends fell on different dates, which sounded like the gap between two days
 * but in practice caught the run to the airport on the last morning — a real
 * journey, drawn as though you had slept through it. A hotel is dated once, at
 * check-in, so almost everything after it crossed a date and was mislabelled.
 */
export function connectionsOf(route: TripPlace[]): Connection[] {
  const byPair = new Map<string, Connection>();
  const headings = new Map<string, Set<string>>();

  for (let i = 1; i < route.length; i += 1) {
    const from = route[i - 1];
    const to = route[i];
    // Two airports in a row is a flight, and the flight is already on the map
    // as a great circle. Drawing it again as a ground connection put a thick
    // straight road from Amsterdam to Dubrovnik alongside the arc — a drive
    // nobody made, running parallel to the flight that actually happened.
    if (from.kind === "airport" && to.kind === "airport") continue;
    // Nor is anything else next to an airport, past a certain distance. However
    // the day is ordered, you did not drive from Heathrow to a hotel in Miami:
    // you flew, and the arc is already drawn. Ordering is fixed elsewhere, but
    // a road across an ocean should not be drawable at all.
    if (
      (from.kind === "airport" || to.kind === "airport") &&
      distanceKm(from, to) > MAX_AIRPORT_TRANSFER_KM
    ) {
      continue;
    }
    const key = pairKey(from, to);
    const seen = headings.get(key) ?? new Set<string>();
    seen.add(`${from.id}>${to.id}`);
    headings.set(key, seen);
    if (!byPair.has(key)) byPair.set(key, { from, to, bothWays: false });
  }

  for (const [key, connection] of byPair) {
    connection.bothWays = (headings.get(key)?.size ?? 0) > 1;
  }
  return [...byPair.values()];
}

/**
 * One connection between any two places, whether or not the trip makes it.
 *
 * For asking "show me the hotel and the airport and nothing else". A pair the
 * route does not travel is still drawn — you asked for it — but the caller is
 * expected to say so rather than let it pass as an itinerary.
 */
export function connectionBetween(
  places: TripPlace[],
  fromId: string,
  toId: string,
): { connection: Connection; onRoute: boolean } | null {
  const from = places.find((p) => scopeIdOf(p) === fromId);
  const to = places.find((p) => scopeIdOf(p) === toId);
  if (!from || !to || pairKey(from, to) === pairKey(from, from)) return null;

  const travelled = connectionsOf(orderPlaces(places).filter((p) => p.date)).some(
    (c) => pairKey(c.from, c.to) === pairKey(from, to),
  );
  return { connection: { from, to, bothWays: false }, onRoute: travelled };
}
