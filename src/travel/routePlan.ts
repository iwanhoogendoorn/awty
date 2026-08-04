import type { Booking } from "../bookings/types";
import { dayEvents, ongoingOn } from "../store/dayPlan";
import type { Place } from "./types";

export interface RoutePair {
  from: Place;
  to: Place;
}

/**
 * Every hop the timeline will try to draw.
 *
 * Distances used to be measured only outward from the hotel, so the timeline
 * asked the cache for pairs nobody had ever calculated — airport to hotel on
 * arrival day, activity to activity in the afternoon — and silently drew
 * nothing. This walks the same day sequence the timeline does, so the fan-out
 * and the display agree on what is needed.
 */
export function itineraryPairs(
  bookings: Booking[],
  days: string[],
  places: Place[],
  base?: Place,
): RoutePair[] {
  const byPath = new Map(places.filter((p) => p.file).map((p) => [p.file!.path, p]));
  const pairs: RoutePair[] = [];
  const seen = new Set<string>();

  const add = (from: Place | undefined, to: Place | undefined) => {
    if (!from || !to || from.id === to.id) return;
    const key = `${from.id}>${to.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ from, to });
  };

  for (const date of days) {
    const events = dayEvents(bookings, date);
    if (events.length === 0) continue;

    // You wake up where you slept, so a day inside a stay starts at the hotel.
    if (ongoingOn(bookings, date).length > 0) {
      add(base, byPath.get(events[0].file.path));
    }
    for (let i = 0; i < events.length - 1; i += 1) {
      add(byPath.get(events[i].file.path), byPath.get(events[i + 1].file.path));
    }
  }

  return pairs;
}

/** Pairs sharing an origin, so each origin can be fetched in one batched call. */
export function groupByOrigin(pairs: RoutePair[]): { from: Place; to: Place[] }[] {
  const groups = new Map<string, { from: Place; to: Place[] }>();
  for (const pair of pairs) {
    const group = groups.get(pair.from.id) ?? { from: pair.from, to: [] };
    group.to.push(pair.to);
    groups.set(pair.from.id, group);
  }
  return [...groups.values()];
}
