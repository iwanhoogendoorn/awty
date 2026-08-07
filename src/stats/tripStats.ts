import type { Money } from "../bookings/types";
import type { FlightLeg } from "../bookings/legs";
import type { TripStage } from "../types";
import type { Totals } from "../util/money";
import { addTo, sumMoney } from "../util/money";
import { daysBetween, yearOf } from "../util/dates";
import { totalJourneyMinutes } from "../bookings/legs";
import { AIRPORTS } from "../data/airports";

/**
 * Everything the vault can say about travel taken as a whole.
 *
 * Every figure here is derived from notes that already exist — no new field is
 * asked for, and nothing is estimated. Where the data runs out the shape of the
 * answer says so: counts of what could not be worked out travel alongside the
 * totals, so "1,400 km" is never quietly hiding four flights whose airports
 * were unknown.
 *
 * Kept free of Obsidian so every number can be checked against a fixture.
 */

/** The narrow slice of a trip these sums need, so a test can build one. */
export interface StatTrip {
  title: string;
  stage: TripStage;
  startDate: string;
  endDate: string;
  countries: string[];
  cities: string[];
  budgetTotal: number | null;
  /** Counted cost lines: what this trip actually cost. */
  money: Money[];
  /** The same money, tagged, for a cross-trip category split. */
  categories: { category: string; money: Money }[];
  /**
   * Flights as booked, connections already folded together.
   *
   * Groups rather than a flat list, because the store has already worked out
   * which legs are one flight and which are a separate journey — re-deriving
   * that here would be a second opinion on a question already answered, and
   * the two would drift.
   */
  journeys: FlightLeg[][];
}

/**
 * Trips whose money is real.
 *
 * A cancelled trip's bookings were refunded, moved or written off, and none of
 * those is "what travel cost me". An idea's deposit, on the other hand, has
 * left the account.
 */
function spending(trips: StatTrip[]): StatTrip[] {
  return trips.filter((t) => t.stage !== "cancelled");
}

/**
 * Trips that happened, or are happening.
 *
 * "Countries visited" must not count somewhere you thought about going. This
 * is the one place a plan is not evidence.
 */
function travelled(trips: StatTrip[]): StatTrip[] {
  return trips.filter((t) => t.stage === "going" || t.stage === "went");
}

// ------------------------------------------------------------------- money

export interface MoneyStats {
  total: Totals;
  /** Year of departure to what was spent on trips starting in it. */
  byYear: Map<string, Totals>;
  byCategory: Map<string, Totals>;
  /** Null unless every counted line shares one currency — see `perTrip`. */
  currency: string | null;
  /**
   * Averages are single-currency only. A mean across euros and baht is not a
   * number, and dividing a two-entry map by a trip count would produce one
   * that looked like it was.
   */
  perTrip: number | null;
  perDay: number | null;
  /** Trips that set a budget, and how the spend on them compares. */
  budget: { trips: number; budgeted: number; spent: number; ratio: number } | null;
  tripCount: number;
}

export function moneyStats(trips: StatTrip[]): MoneyStats {
  const live = spending(trips);
  const total = sumMoney(live.flatMap((t) => t.money));

  const byYear = new Map<string, Totals>();
  for (const trip of live) {
    const year = yearOf(trip.startDate) || "Undated";
    let bucket = byYear.get(year);
    if (!bucket) byYear.set(year, (bucket = new Map()));
    for (const money of trip.money) addTo(bucket, money);
  }

  const byCategory = new Map<string, Totals>();
  for (const trip of live) {
    for (const line of trip.categories) {
      let bucket = byCategory.get(line.category);
      if (!bucket) byCategory.set(line.category, (bucket = new Map()));
      addTo(bucket, line.money);
    }
  }

  const currency = total.size === 1 ? [...total.keys()][0] : null;
  const spent = currency ? (total.get(currency) ?? 0) : 0;
  const days = live.reduce((sum, t) => sum + daysBetween(t.startDate, t.endDate), 0);

  // Only trips that both set a budget and spent something in the one currency
  // can be compared; a budget with no spend against it says nothing yet.
  const budgeted = live.filter((t) => t.budgetTotal !== null && t.budgetTotal > 0);
  const budgetSpend = currency
    ? sumMoney(budgeted.flatMap((t) => t.money)).get(currency) ?? 0
    : 0;
  const budgetTotal = budgeted.reduce((sum, t) => sum + (t.budgetTotal ?? 0), 0);

  return {
    total,
    byYear,
    byCategory,
    currency,
    perTrip: currency && live.length > 0 ? spent / live.length : null,
    perDay: currency && days > 0 ? spent / days : null,
    budget:
      currency && budgeted.length > 0 && budgetTotal > 0
        ? {
            trips: budgeted.length,
            budgeted: budgetTotal,
            spent: budgetSpend,
            ratio: budgetSpend / budgetTotal,
          }
        : null,
    tripCount: live.length,
  };
}

// ------------------------------------------------------------ where and when

export interface PlaceStats {
  countries: string[];
  cities: string[];
  /** Year of departure to days spent away in it. */
  daysByYear: Map<string, number>;
  totalDays: number;
  longest: { title: string; days: number } | null;
  /** Countries by number of trips, most first. */
  ranking: { name: string; trips: number }[];
  /** Trips counted here: the ones actually taken. */
  tripCount: number;
}

export function placeStats(trips: StatTrip[]): PlaceStats {
  const real = travelled(trips);
  const countries: string[] = [];
  const cities: string[] = [];
  const visits = new Map<string, number>();
  const daysByYear = new Map<string, number>();
  let longest: { title: string; days: number } | null = null;
  let totalDays = 0;

  for (const trip of real) {
    for (const country of trip.countries) {
      if (!countries.includes(country)) countries.push(country);
      visits.set(country, (visits.get(country) ?? 0) + 1);
    }
    for (const city of trip.cities) if (!cities.includes(city)) cities.push(city);

    const days = daysBetween(trip.startDate, trip.endDate);
    totalDays += days;
    const year = yearOf(trip.startDate) || "Undated";
    daysByYear.set(year, (daysByYear.get(year) ?? 0) + days);
    if (!longest || days > longest.days) longest = { title: trip.title, days };
  }

  countries.sort((a, b) => a.localeCompare(b));
  cities.sort((a, b) => a.localeCompare(b));

  return {
    countries,
    cities,
    daysByYear,
    totalDays,
    longest,
    ranking: [...visits.entries()]
      .map(([name, count]) => ({ name, trips: count }))
      .sort((a, b) => b.trips - a.trips || a.name.localeCompare(b.name)),
    tripCount: real.length,
  };
}

// ----------------------------------------------------------------- flights

const BY_IATA = new Map(AIRPORTS.map((a) => [a.i, a]));
const EARTH_KM = 6371;

/** The IATA code inside "Amsterdam (AMS)" or a bare "AMS". */
export function iataOf(label: string): string | null {
  const bracketed = /\(([A-Z]{3})\)/.exec(label)?.[1];
  if (bracketed) return bracketed;
  const bare = /^\s*([A-Z]{3})\s*$/.exec(label)?.[1];
  return bare ?? null;
}

/** Great-circle kilometres between two airports, or null if either is unknown. */
export function legDistanceKm(from: string, to: string): number | null {
  const a = BY_IATA.get(iataOf(from) ?? "");
  const b = BY_IATA.get(iataOf(to) ?? "");
  if (!a || !b) return null;

  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.a - a.a);
  const dLng = rad(b.o - a.o);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.a)) * Math.cos(rad(b.a)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface FlightStats {
  /** Journeys, not legs: a connection is one flight taken, in two hops. */
  journeys: number;
  legs: number;
  km: number;
  /** Legs whose airports the dataset does not know, so km understates. */
  kmUnknown: number;
  minutes: number;
  /** Journeys with no times on them, so hours understates. */
  minutesUnknown: number;
  airlines: { name: string; flights: number }[];
  airports: { code: string; visits: number }[];
}

export function flightStats(trips: StatTrip[]): FlightStats {
  const journeys = spending(trips).flatMap((t) => t.journeys);
  const legs = journeys.flat();
  const airlines = new Map<string, number>();
  const airports = new Map<string, number>();
  let km = 0;
  let kmUnknown = 0;

  for (const leg of legs) {
    const distance = legDistanceKm(leg.from, leg.to);
    if (distance === null) kmUnknown += 1;
    else km += distance;

    if (leg.operator) airlines.set(leg.operator, (airlines.get(leg.operator) ?? 0) + 1);
    for (const end of [leg.from, leg.to]) {
      const code = iataOf(end);
      if (code) airports.set(code, (airports.get(code) ?? 0) + 1);
    }
  }

  let minutes = 0;
  let minutesUnknown = 0;
  for (const journey of journeys) {
    const flown = totalJourneyMinutes(journey);
    // Over a day in the air is a misread date, not a flight. The same guard the
    // Getting around list uses, for the same reason.
    if (flown === null || flown > 24 * 60) minutesUnknown += 1;
    else minutes += flown;
  }

  const rank = (map: Map<string, number>) =>
    [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return {
    journeys: journeys.length,
    legs: legs.length,
    km,
    kmUnknown,
    minutes,
    minutesUnknown,
    airlines: rank(airlines).map(([name, flights]) => ({ name, flights })),
    airports: rank(airports).map(([code, visits]) => ({ code, visits })),
  };
}

// -------------------------------------------------------- planning habits

export interface PlanningStats {
  byStage: Map<TripStage, number>;
  total: number;
  /** Cancelled as a share of every trip ever planned. Null with no trips. */
  cancelledShare: number | null;
  /** Of the trips that were not cancelled, how many are still only ideas. */
  stillIdeas: number;
  /**
   * How far ahead the trips you committed to were planned is NOT here, and
   * cannot be: a trip records the stage it is in, never the day it changed.
   * Deriving it from file timestamps would be measuring when a file was last
   * synced. The UI says this rather than showing a number it cannot stand up.
   */
  lookaheadKnown: false;
}

export function planningStats(trips: StatTrip[]): PlanningStats {
  const byStage = new Map<TripStage, number>();
  for (const trip of trips) byStage.set(trip.stage, (byStage.get(trip.stage) ?? 0) + 1);
  const cancelled = byStage.get("cancelled") ?? 0;

  return {
    byStage,
    total: trips.length,
    cancelledShare: trips.length > 0 ? cancelled / trips.length : null,
    stillIdeas: byStage.get("planning") ?? 0,
    lookaheadKnown: false,
  };
}

/** "2 h 20 min", from minutes. Hours only once it runs past a day. */
export function formatHours(minutes: number): string {
  if (minutes <= 0) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "12,400 km", or "—" when nothing could be measured. */
export function formatKm(km: number): string {
  if (km <= 0) return "—";
  return `${Math.round(km).toLocaleString("en-GB")} km`;
}
