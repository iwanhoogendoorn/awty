import { setIcon } from "obsidian";
import type { DashboardContext } from "../common";
import { bar, emptyState, readiness, stateMark, statTiles } from "../common";
import { showTripMenu } from "../tripMenu";
import type { Trip, TripStage } from "../../../types";
import { STAGES, joinPlaces, kindDef, stageDef, tripCities, tripCountries } from "../../../types";
import { stageBadge } from "../stageMenu";
import { estimateTotals, trackQuotes } from "../../../planning/priceWatch";
import { formatTotals, sumMoney } from "../../../util/money";
import { daysUntil, formatDateRange, formatDuration } from "../../../util/dates";

/** Totals across every trip, so the Trips tab answers questions on its own. */
function renderAllTripsSummary(
  parent: HTMLElement,
  ctx: DashboardContext,
  trips: Trip[],
): void {
  const { plugin } = ctx;
  // A cancelled trip is a record, not a plan: counting its spend and its
  // unfinished notes would put a holiday you called off in the same tally as
  // the one you are packing for.
  const live = trips.filter((t) => t.stage !== "cancelled");
  const upcoming = live.filter((t) => t.status === "upcoming" && t.stage !== "planning");
  const current = live.filter((t) => t.status === "current");
  const planning = trips.filter((t) => t.stage === "planning");

  const spend = sumMoney(
    live.flatMap((t) => plugin.bookings.getCostLines(t).filter((l) => l.counted).map((l) => l.money)),
  );

  // Trips still ahead of you with something unfinished.
  let unfinished = 0;
  for (const trip of [...current, ...upcoming]) {
    const ready = readiness(plugin, trip);
    if (ready.total > 0 && ready.ratio < 1) unfinished += 1;
  }

  // The next trip is the next one that is actually happening — but an idea for
  // next month is still something in the diary, and reporting "Nothing planned"
  // with a planned trip on the screen below is just wrong. So a confirmed trip
  // wins, and an idea fills in behind it, labelled as the idea it is.
  const confirmed = current[0] ?? upcoming[0];
  const soonestIdea = planning
    .filter((t) => t.status !== "past")
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  const next = confirmed ?? soonestIdea;
  const until = next ? daysUntil(next.startDate) : null;

  statTiles(parent, [
    {
      label: trips.length === 1 ? "Trip" : "Trips",
      value: String(trips.length),
      detail: `${upcoming.length} booked · ${planning.length} being planned`,
      icon: "plane",
    },
    {
      label: "Next trip",
      value: !next ? "—" : confirmed && current.length > 0 ? "Now" : until === null ? "—" : `${until}d`,
      detail: !next
        ? "Nothing planned"
        : confirmed
          ? next.title
          : `${next.title} — not booked yet`,
      icon: "calendar-days",
      tone: !confirmed && next ? "warn" : "default",
    },
    {
      label: "Total spend",
      value: formatTotals(spend, "—"),
      detail: "Across every trip",
      icon: "wallet",
    },
    {
      label: "Ideas on the table",
      value: String(planning.length),
      detail: planning.length === 0 ? "Nothing being weighed up" : "Planned, not booked",
      icon: "compass",
      tone: "default",
    },
    {
      label: "Need attention",
      value: String(unfinished),
      detail: unfinished === 0 ? "All up to date" : "Trips with notes still empty",
      icon: "alert-circle",
      tone: unfinished > 0 ? "warn" : "good",
    },
  ]);
}

/**
 * A chip per stage, always all of them, always shown.
 *
 * This used to draw only the stages that had trips in them, and to skip the
 * row entirely when everything sat in one stage — reasoning that a filter with
 * one option can only be a no-op. That reasoning was about the filter and not
 * about the person looking for it: on a vault with a single trip the row
 * vanished, and a feature that hides itself is indistinguishable from one that
 * was never built.
 *
 * So the whole vocabulary shows, counts and all. It doubles as the answer to
 * "what stages are there?", which is worth more than the few pixels saved, and
 * an empty stage is dimmed and unclickable rather than absent — there is a
 * difference between "no cancelled trips" and "cancelling is not a thing here",
 * and only one of them is true.
 */
function renderStageFilter(
  parent: HTMLElement,
  trips: Trip[],
  active: TripStage | null,
  onChange: (stage: TripStage | null) => void,
): void {
  const counts = new Map<TripStage, number>();
  for (const trip of trips) counts.set(trip.stage, (counts.get(trip.stage) ?? 0) + 1);

  const row = parent.createDiv({ cls: "awty-stage-filter" });

  const chip = (
    label: string,
    count: number,
    stage: TripStage | null,
    icon: string,
    hint: string,
  ): void => {
    const empty = count === 0;
    const el = row.createEl("button", {
      cls: [
        "awty-stage-chip",
        stage ? `is-${stage}` : "",
        active === stage ? "is-active" : "",
        empty ? "is-empty" : "",
      ]
        .filter(Boolean)
        .join(" "),
    });
    el.type = "button";
    el.disabled = empty;
    setIcon(el.createSpan({ cls: "awty-stage-chip-icon" }), icon);
    el.createSpan({ text: label });
    el.createSpan({ cls: "awty-stage-chip-count", text: String(count) });
    el.setAttribute("aria-pressed", String(active === stage));
    // Not "no trips are ${label}": the stage names are not all adjectives, and
    // that template produces "no trips are went".
    el.setAttribute("title", empty ? `Nothing at this stage yet — ${hint}` : hint);
    if (empty) return;
    // Clicking the stage you are already on clears the filter, so the chips
    // are a toggle rather than a trap you need the All chip to escape.
    el.addEventListener("click", () => onChange(active === stage ? null : stage));
  };

  chip("All", trips.length, null, "layers", "Show every trip");
  for (const def of STAGES) {
    chip(def.label, counts.get(def.id) ?? 0, def.id, def.icon, def.description);
  }
}

/** Every trip as a card — the one view that spans trips rather than drilling in. */
export function renderTrips(
  parent: HTMLElement,
  ctx: DashboardContext,
  onSelect: (trip: Trip) => void,
  filter?: { stage: TripStage | null; onChange: (stage: TripStage | null) => void },
): void {
  const { plugin } = ctx;
  const all = plugin.store.getTrips();
  const trips = plugin.settings.showCancelledTrips
    ? all
    : all.filter((t) => t.stage !== "cancelled");

  // The empty state carries its own button, so the toolbar would only ever be a
  // second copy of it.
  if (trips.length === 0) {
    emptyState(parent, "plane", "No trips yet", "Create your first trip to get started.", [
      { label: "New trip", icon: "plus", onClick: () => plugin.openNewTripModal() },
    ]);
    return;
  }

  // No toolbar: "New trip" moved into the dashboard header, where it is on
  // every tab. Leaving it here too would be the same button twice on one
  // screen, a row apart.
  //
  // The summary counts every trip even while the grid is filtered: it is the
  // answer to "how am I doing overall", and recomputing it against the filter
  // would make "1 trip" mean something different depending on a chip.
  renderAllTripsSummary(parent, ctx, trips);

  const stage = filter?.stage ?? null;
  if (filter) renderStageFilter(parent, trips, stage, filter.onChange);

  const shown = stage ? trips.filter((t) => t.stage === stage) : trips;
  if (shown.length === 0) {
    emptyState(
      parent,
      stageDef(stage ?? undefined).icon,
      `Nothing ${stageDef(stage ?? undefined).label.toLowerCase()}`,
      "No trip is at this stage. The others are still there — clear the filter to see them.",
      [{ label: "Show all trips", icon: "layers", onClick: () => filter?.onChange(null) }],
    );
    return;
  }

  const grid = parent.createDiv({ cls: "awty-trip-grid" });
  for (const trip of shown) {
    const def = kindDef(trip.kind);
    const card = grid.createDiv({
      cls: `awty-card is-${trip.status} is-stage-${trip.stage}`,
    });

    const head = card.createDiv({ cls: "awty-card-head" });
    setIcon(head.createDiv({ cls: "awty-card-icon" }), def.icon);
    const headText = head.createDiv({ cls: "awty-card-head-text" });
    headText.createDiv({ cls: "awty-card-title", text: trip.title });
    headText.createDiv({
      cls: "awty-card-where",
      text: [joinPlaces(tripCities(trip)), joinPlaces(tripCountries(trip))].filter(Boolean).join(", ") || def.label,
    });

    // The stage always shows, under the destination. It used to take the
    // corner badge only when there was no countdown to put there, which meant
    // it disappeared the moment a trip was booked — exactly when knowing a
    // trip is going rather than merely soon starts to matter.
    stageBadge(headText, plugin, trip, ctx.refresh).addClass("awty-card-stage");

    // A countdown on a trip that is not happening is a promise the trip has
    // not made, so those get no corner badge at all.
    const until = daysUntil(trip.startDate);
    const badge =
      trip.stage === "cancelled" || trip.stage === "planning"
        ? ""
        : trip.status === "current"
          ? "Now"
          : trip.status === "past"
            ? "Done"
            : until === null
              ? ""
              : until === 0
                ? "Today"
                : `${until}d`;
    if (badge) card.createDiv({ cls: `awty-card-badge is-${trip.status}`, text: badge });

    const meta = card.createDiv({ cls: "awty-card-meta" });
    meta.createDiv({ text: formatDateRange(trip.startDate, trip.endDate) });
    meta.createDiv({ cls: "awty-card-duration", text: formatDuration(trip.startDate, trip.endDate) });

    const lines = plugin.bookings.getCostLines(trip).filter((l) => l.counted);
    const spent = sumMoney(lines.map((l) => l.money));
    const bookings = plugin.bookings.getBookings(trip);

    const foot = card.createDiv({ cls: "awty-card-foot" });
    foot.createSpan({ cls: "awty-card-stat", text: formatTotals(spent, "No costs") });
    foot.createSpan({ cls: "awty-card-stat", text: `${bookings.length} booking${bookings.length === 1 ? "" : "s"}` });

    // What it looks like it will cost, for a trip whose costs are all still
    // quotes. Without this a proposal reads as free until the day it is booked.
    if (trip.stage === "planning") {
      const estimate = estimateTotals(trackQuotes(plugin.readQuotes(trip)));
      foot.createSpan({
        cls: "awty-card-stat is-estimate",
        text: estimate.size === 0 ? "Not priced" : `${formatTotals(estimate)} priced`,
      });
    }

    const ready = readiness(plugin, trip);
    if (ready.total > 0) {
      const progress = card.createDiv({ cls: "awty-card-progress" });
      progress.createDiv({
        cls: "awty-card-progress-label",
        text: `${Math.round(ready.ratio * 100)}% planned`,
      });
      bar(progress, ready.ratio, ready.ratio >= 1 ? "good" : ready.ratio < 0.34 ? "warn" : "good");
    }

    // One dot per note, filled in as it gets done, so an unfinished trip is
    // obvious from the grid without opening it.
    const marks = card.createDiv({ cls: "awty-card-marks" });
    for (const sub of plugin.store.getSubNotes(trip)) {
      const state = plugin.progress.peek(sub.file)?.state ?? "empty";
      const mark = stateMark(state);
      const el = marks.createDiv({ cls: `awty-mark is-small is-${state}` });
      if (mark.icon) setIcon(el, mark.icon);
      el.setAttribute("title", `${sub.label}: ${mark.label}`);
      el.setAttribute("aria-label", `${sub.label}: ${mark.label}`);
    }

    const menuBtn = card.createEl("button", {
      cls: "awty-icon-btn awty-card-menu",
      attr: { "aria-label": "Trip actions" },
    });
    setIcon(menuBtn, "more-vertical");
    menuBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      showTripMenu(evt, trip, ctx);
    });

    card.addEventListener("click", () => onSelect(trip));
    card.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      showTripMenu(evt, trip, ctx);
    });
  }
}
