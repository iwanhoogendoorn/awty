import type { TransportMode } from "./transportMode";

/**
 * The way back, as a journey in its own right.
 *
 * A flight's return has always been a leg of its own: its own number, its own
 * airports, filled in reversed and then editable. A transfer's return was four
 * dates in a box on another step, and the route home was computed by reading
 * the outbound backwards — which is right until the train home is a different
 * train, or the ferry back leaves from the other harbour.
 *
 * Blank still means "the reverse of the way out", so every booking written
 * before these fields existed keeps saying exactly what it said. Nothing here
 * guesses: an empty return route is answered from the outbound, not invented.
 */

export interface OutboundEnds {
  from: string;
  to: string;
  operator: string;
  title: string;
  returnFrom: string;
  returnTo: string;
  returnOperator: string;
  returnService: string;
}

export interface ReturnLeg {
  from: string;
  to: string;
  operator: string;
  service: string;
}

/** What the journey home actually is: what was typed, or the way out reversed. */
export function returnLeg(booking: OutboundEnds): ReturnLeg {
  return {
    from: booking.returnFrom || booking.to,
    to: booking.returnTo || booking.from,
    operator: booking.returnOperator || booking.operator,
    service: booking.returnService || booking.title,
  };
}

/** "Lopud harbour → Dubrovnik (Gruž port)", or nothing worth printing. */
export function returnRoute(booking: OutboundEnds): string {
  const leg = returnLeg(booking);
  return [leg.from, leg.to].filter(Boolean).join(" → ");
}

/**
 * Modes you are typically back from the same day.
 *
 * A ferry to an island, a taxi to a restaurant and a bike hired for the
 * afternoon all end where they started before dinner. A train to another
 * country does not — that one comes home at the end of the trip. Ticking
 * "coming back" used to offer the same day for all of them, so every long-haul
 * return arrived pre-filled with a date nobody meant.
 */
const SAME_DAY: TransportMode[] = ["ferry", "taxi", "metro", "shuttle", "bike", "walk"];

/**
 * The date to offer for the way home.
 *
 * A guess, and only ever a starting value: it is drawn in an editable box and
 * nothing is written until Save.
 */
export function returnDefaultDate(
  mode: TransportMode | "",
  outboundDate: string,
  tripEndDate: string,
): string {
  if (!mode || SAME_DAY.includes(mode)) return outboundDate;
  // Never before you set off, whatever the trip note claims.
  return tripEndDate && tripEndDate >= outboundDate ? tripEndDate : outboundDate;
}
