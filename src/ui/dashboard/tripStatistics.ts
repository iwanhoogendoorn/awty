import { setIcon } from "obsidian";
import type { DashboardContext } from "./common";
import { bar, readiness, sectionTitle } from "./common";
import type { Trip } from "../../types";
import { tripCities, tripCountries } from "../../types";
import { formatMoney, formatTotals } from "../../util/money";
import type { StatTrip } from "../../stats/tripStats";
import {
  flightStats,
  formatHours,
  formatKm,
  moneyStats,
  placeStats,
  planningStats,
} from "../../stats/tripStats";
import { groupJourneys } from "../../bookings/legs";

/**
 * Everything the vault knows about travel taken as a whole.
 *
 * Lives under the trip cards rather than above them: the cards are what the
 * tab is for, and a wall of numbers between the filter and the list would push
 * the thing you came to click below the fold. This is the summary you scroll
 * to, not the thing you scroll past.
 */

/** The narrow shape the sums need, assembled from what the stores already hold. */
function toStatTrips(ctx: DashboardContext, trips: Trip[]): StatTrip[] {
  const { plugin } = ctx;
  return trips.map((trip) => {
    const lines = plugin.bookings.getCostLines(trip).filter((l) => l.counted);
    const bookings = plugin.bookings.getBookings(trip);
    return {
      title: trip.title,
      stage: trip.stage,
      startDate: trip.startDate,
      endDate: trip.endDate,
      countries: tripCountries(trip),
      cities: tripCities(trip),
      budgetTotal: trip.budgetTotal,
      money: lines.map((l) => l.money),
      categories: lines.map((l) => ({ category: String(l.category), money: l.money })),
      // Outbound and return grouped separately, exactly as the store does when
      // it builds the timeline — a return leg is always its own flight.
      journeys: bookings
        .filter((b) => b.kind === "flight" && b.status !== "cancelled")
        .flatMap((b) => [...groupJourneys(b.legs), ...groupJourneys(b.returnLegs)]),
    };
  });
}

/** A label, a value, and an optional aside — the shape every row below takes. */
function row(parent: HTMLElement, label: string, value: string, note = ""): HTMLElement {
  const el = parent.createDiv({ cls: "awty-stat-row" });
  el.createDiv({ cls: "awty-stat-row-label", text: label });
  const right = el.createDiv({ cls: "awty-stat-row-value" });
  right.createSpan({ text: value });
  if (note) right.createSpan({ cls: "awty-stat-row-note", text: note });
  return el;
}

/**
 * A bar per year, scaled against the biggest.
 *
 * Scaled against the largest rather than a round number, because the question
 * is "which year cost more", and a bar chart whose tallest column stops halfway
 * up answers it less well.
 */
function bars(
  parent: HTMLElement,
  entries: { label: string; value: number; text: string }[],
): void {
  const peak = Math.max(...entries.map((e) => e.value), 0);
  if (peak <= 0) return;
  const chart = parent.createDiv({ cls: "awty-stat-bars" });
  for (const entry of entries) {
    const line = chart.createDiv({ cls: "awty-stat-bar" });
    line.createDiv({ cls: "awty-stat-bar-label", text: entry.label });
    const track = line.createDiv({ cls: "awty-stat-bar-track" });
    const fill = track.createDiv({ cls: "awty-stat-bar-fill" });
    fill.style.width = `${Math.max(2, Math.round((entry.value / peak) * 100))}%`;
    line.createDiv({ cls: "awty-stat-bar-value", text: entry.text });
  }
}

function group(parent: HTMLElement, icon: string, title: string): HTMLElement {
  const box = parent.createDiv({ cls: "awty-stat-group" });
  const head = box.createDiv({ cls: "awty-stat-group-head" });
  setIcon(head.createSpan({ cls: "awty-stat-group-icon" }), icon);
  head.createSpan({ text: title });
  return box.createDiv({ cls: "awty-stat-group-body" });
}

/**
 * The small print, pushed to the foot of the card.
 *
 * Kept in one block so it sits on the bottom edge of every card rather than
 * wherever that card's rows happened to stop — four notes at four different
 * heights read as four unrelated afterthoughts.
 */
function foot(body: HTMLElement): HTMLElement {
  return body.createDiv({ cls: "awty-stat-foot" });
}

/**
 * Which trips a card counted.
 *
 * These three sets are genuinely different — money leaves out what you called
 * off, "countries visited" leaves out what you only thought about, and the
 * planning card counts everything including both — and a heading saying
 * "across every trip" was quietly speaking for all of them. Each card says
 * which set is its own, in the same words and the same place, so the
 * difference is visible rather than something you deduce from a number that
 * looks wrong.
 */
const SCOPE = {
  spent: "Every trip except the ones you called off.",
  travelled: "Only trips you went on or are going on.",
  all: "Every trip, including the ones you called off.",
} as const;

function scope(body: HTMLElement, text: string): void {
  body.createDiv({ cls: "awty-stat-scope", text });
}

export function renderTripStatistics(
  parent: HTMLElement,
  ctx: DashboardContext,
  trips: Trip[],
): void {
  if (trips.length === 0) return;
  const stats = toStatTrips(ctx, trips);

  const money = moneyStats(stats);
  const places = placeStats(stats);
  const flights = flightStats(stats);
  const planning = planningStats(stats);

  // Not "across every trip": three of these four count different sets, and a
  // heading that says otherwise is the one place the difference is invisible.
  sectionTitle(parent, "Across your trips");
  const grid = parent.createDiv({ cls: "awty-stat-groups" });

  // ------------------------------------------------------------- money
  const spend = group(grid, "wallet", "Money");
  row(spend, "Total spent", formatTotals(money.total, "Nothing yet"),
    money.tripCount === 1 ? "on 1 trip" : `on ${money.tripCount} trips`);
  if (money.perTrip !== null && money.currency) {
    row(spend, "Average trip", formatMoney({ amount: money.perTrip, currency: money.currency }));
  }
  if (money.perDay !== null && money.currency) {
    row(spend, "Per day away", formatMoney({ amount: money.perDay, currency: money.currency }));
  }
  const noAverages = money.currency === null && money.total.size > 1;

  if (money.budget) {
    const { budgeted, spent: used, ratio, trips: n } = money.budget;
    const currency = money.currency ?? "EUR";
    row(
      spend,
      "Against budget",
      `${Math.round(ratio * 100)}% used`,
      `${formatMoney({ amount: used, currency })} of ${formatMoney({ amount: budgeted, currency })} · ${n} trip${n === 1 ? "" : "s"}`,
    );
    bar(spend, ratio, ratio > 1 ? "bad" : ratio > 0.85 ? "warn" : "good");
  }

  const years = [...money.byYear.entries()]
    .filter(([, totals]) => totals.size > 0)
    .sort((a, b) => b[0].localeCompare(a[0]));
  if (years.length > 1 && money.currency) {
    spend.createDiv({ cls: "awty-stat-sub", text: "By year" });
    bars(
      spend,
      years.map(([year, totals]) => ({
        label: year,
        value: totals.get(money.currency!) ?? 0,
        text: formatTotals(totals),
      })),
    );
  }

  const categories = [...money.byCategory.entries()]
    .filter(([, totals]) => totals.size > 0)
    .sort((a, b) => (b[1].get(money.currency ?? "") ?? 0) - (a[1].get(money.currency ?? "") ?? 0));
  if (categories.length > 1 && money.currency) {
    spend.createDiv({ cls: "awty-stat-sub", text: "Where it went" });
    bars(
      spend,
      categories.map(([name, totals]) => ({
        label: name,
        value: totals.get(money.currency!) ?? 0,
        text: formatTotals(totals),
      })),
    );
  }

  // Built last, once every row and bar above it exists — a footer created
  // mid-card sits mid-card, however hard the stylesheet pushes it down.
  const spendFoot = foot(spend);
  if (noAverages) {
    // Said out loud, because the absence of the averages above is otherwise
    // indistinguishable from them being zero.
    spendFoot.createDiv({
      cls: "awty-stat-caveat",
      text: "No averages: the spend is in more than one currency, and converting would invent a rate.",
    });
  }
  scope(spendFoot, SCOPE.spent);

  // -------------------------------------------------------- where and when
  const where = group(grid, "map", "Places and time");
  row(where, "Countries", places.countries.length === 0 ? "—" : String(places.countries.length),
    places.countries.slice(0, 4).join(", ") + (places.countries.length > 4 ? "…" : ""));
  row(where, "Cities", places.cities.length === 0 ? "—" : String(places.cities.length),
    places.cities.slice(0, 4).join(", ") + (places.cities.length > 4 ? "…" : ""));
  row(where, "Days away", places.totalDays === 0 ? "—" : `${places.totalDays} days`,
    places.tripCount === 1 ? "over 1 trip" : `over ${places.tripCount} trips`);
  if (places.longest) {
    row(where, "Longest trip", `${places.longest.days} days`, places.longest.title);
  }
  // Only trips taken count here, so say so — otherwise a vault full of ideas
  // reads as someone who has never been anywhere.
  scope(foot(where), SCOPE.travelled);

  const dayYears = [...places.daysByYear.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  if (dayYears.length > 1) {
    where.createDiv({ cls: "awty-stat-sub", text: "Days away by year" });
    bars(where, dayYears.map(([year, days]) => ({ label: year, value: days, text: `${days} days` })));
  }
  if (places.ranking.length > 1) {
    where.createDiv({ cls: "awty-stat-sub", text: "Most visited" });
    bars(
      where,
      places.ranking.slice(0, 6).map((r) => ({
        label: r.name,
        value: r.trips,
        text: `${r.trips} trip${r.trips === 1 ? "" : "s"}`,
      })),
    );
  }

  // ----------------------------------------------------------------- flights
  const air = group(grid, "plane", "Flights");
  row(air, "Flights taken", flights.journeys === 0 ? "—" : String(flights.journeys),
    flights.legs === flights.journeys ? "" : `${flights.legs} legs`);
  row(air, "In the air", formatHours(flights.minutes),
    flights.minutesUnknown > 0
      ? `${flights.minutesUnknown} without times`
      : "");
  row(air, "Distance", formatKm(flights.km),
    flights.kmUnknown > 0 ? `${flights.kmUnknown} leg${flights.kmUnknown === 1 ? "" : "s"} unmeasured` : "");
  if (flights.airlines.length > 0) {
    row(air, "Airlines", String(flights.airlines.length),
      flights.airlines.slice(0, 3).map((a) => a.name).join(", "));
  }
  if (flights.airports.length > 0) {
    const top = flights.airports[0];
    row(air, "Most-used airport", top.code, `${top.visits} time${top.visits === 1 ? "" : "s"}`);
  }
  // Names only what is actually short. Saying "hours and kilometres are
  // floors" when every kilometre was measured undersells a number that is
  // complete, and a caveat that cries wolf stops being read.
  const short: string[] = [];
  if (flights.minutesUnknown > 0) short.push("hours");
  if (flights.kmUnknown > 0) short.push("kilometres");
  const airFoot = foot(air);
  if (short.length > 0) {
    airFoot.createDiv({
      cls: "awty-stat-caveat",
      // "Hours" and "kilometres" are both plural, so the verb never changes;
      // only the count of things being described does.
      text: `The ${short.join(" and ")} are ${short.length === 1 ? "a floor" : "floors"}, not ${short.length === 1 ? "a total" : "totals"}: a flight with no times, or an airport the dataset does not know, is left out rather than guessed at.`,
    });
  }
  scope(airFoot, SCOPE.spent);

  // ---------------------------------------------------------------- planning
  const habits = group(grid, "compass", "Planning");
  row(habits, "Trips planned", String(planning.total));
  for (const [stage, label] of [
    ["going", "Going"],
    ["planning", "Still ideas"],
    ["went", "Been on"],
    ["cancelled", "Called off"],
  ] as const) {
    const count = planning.byStage.get(stage) ?? 0;
    if (count > 0) row(habits, label, String(count));
  }
  if (planning.cancelledShare !== null && planning.cancelledShare > 0) {
    row(habits, "Cancelled", `${Math.round(planning.cancelledShare * 100)}%`, "of everything planned");
  }

  // The one thing the old tile row said that nothing else on the screen did.
  //
  // Counted over trips that are actually coming — a holiday you called off, or
  // one you got back from, has no notes left to finish, and counting those
  // would turn a to-do into a permanent complaint.
  const ahead = trips.filter(
    (t) =>
      t.stage !== "cancelled" &&
      (t.status === "current" || (t.status === "upcoming" && t.stage !== "planning")),
  );
  const unfinished = ahead.filter((t) => {
    const ready = readiness(ctx.plugin, t);
    return ready.total > 0 && ready.ratio < 1;
  }).length;
  if (unfinished > 0) {
    row(habits, "Notes still empty", String(unfinished), unfinished === 1 ? "on a trip ahead" : "on trips ahead");
  }
  const habitsFoot = foot(habits);
  // The honest gap. Better said than filled with a number from file mtimes,
  // which measure when a file last synced.
  habitsFoot.createDiv({
    cls: "awty-stat-caveat",
    text: "How far ahead you book is not here: a trip records the stage it is in, never the day it changed.",
  });
  scope(habitsFoot, SCOPE.all);
}
