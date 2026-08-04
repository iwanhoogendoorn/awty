import type { FlightLeg } from "./legs";
import {
  groupJourneys,
  TIGHT_CONNECTION_MINUTES,
  formatLayover,
  layoverMinutes,
  totalJourneyMinutes,
} from "./legs";

/**
 * What a flight actually costs you in time, read from the legs on the booking.
 *
 * Shared by the Getting around list and the timeline: "how long am I in the
 * air" is the same question in both places, and it was answered in only one.
 */
export interface FlightSummary {
  legs: FlightLeg[];
  stops: number;
  /** Total journey including time on the ground, or null when unknowable. */
  totalMinutes: number | null;
  /** "2 h 20 min · direct", or "" when there is nothing to say. */
  label: string;
  /** Layovers, longest description first: "1 h 5 min in VIE (tight)". */
  layovers: string[];
  arrival: string;
}

/** Frontmatter legs are loose records; this is the only place that shape is known. */
export function readLegs(value: unknown): FlightLeg[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const leg = raw as Record<string, string>;
    return {
      operator: leg?.airline ?? "",
      number: leg?.flight ?? "",
      from: leg?.from ?? "",
      to: leg?.to ?? "",
      date: leg?.date ?? "",
      depTime: leg?.departs ?? "",
      arrDate: leg?.arrives_on ?? leg?.date ?? "",
      arrTime: leg?.arrives ?? "",
      separate: String(leg?.separate ?? "") === "true",
      cost: Number(leg?.cost) > 0 ? Number(leg.cost) : undefined,
    };
  });
}

/** One summary per flight on the booking, connections kept together. */
export function summariseJourneys(legs: FlightLeg[]): FlightSummary[] {
  return groupJourneys(legs).map((group) => summariseFlight(group));
}

export function summariseFlight(legs: FlightLeg[]): FlightSummary {
  const stops = Math.max(legs.length - 1, 0);

  // The longest scheduled flight on earth is under 20 hours; anything beyond a
  // day is data being misread, and a wrong number is worse than none.
  const raw = totalJourneyMinutes(legs);
  const totalMinutes = raw !== null && raw > 24 * 60 ? null : raw;

  const layovers: string[] = [];
  for (let i = 1; i < legs.length; i += 1) {
    const gap = layoverMinutes(legs[i - 1], legs[i]);
    if (gap === null) continue;
    layovers.push(
      `${formatLayover(gap)} in ${legs[i - 1].to || "transit"}${gap < TIGHT_CONNECTION_MINUTES ? " (tight)" : ""}`,
    );
  }

  const last = legs[legs.length - 1];
  const arrival = last?.arrTime ?? "";

  const label = [
    totalMinutes === null ? "" : formatLayover(totalMinutes),
    legs.length === 0 ? "" : stops === 0 ? "direct" : `${stops} stop${stops === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return { legs, stops, totalMinutes, label, layovers, arrival };
}
