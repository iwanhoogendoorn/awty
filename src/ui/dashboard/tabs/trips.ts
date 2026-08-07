import { setIcon } from "obsidian";
import type { DashboardContext } from "../common";
import { bar, emptyState, readiness, stateMark } from "../common";
import { showTripMenu } from "../tripMenu";
import type { Trip, TripStage } from "../../../types";
import { joinPlaces, kindDef, stageDef, tripCities, tripCountries } from "../../../types";
import { stageBadge } from "../stageMenu";
import { renderStageFilter } from "../stageFilter";
import { estimateTotals, trackQuotes } from "../../../planning/priceWatch";
import { renderTripStatistics } from "../tripStatistics";
import { formatTotals, sumMoney } from "../../../util/money";
import { daysUntil, formatDateRange, formatDuration } from "../../../util/dates";

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
  // No row of tiles either. It reported the trip count, the next trip and its
  // countdown, the total spend and the number of ideas — and every one of those
  // was already on the screen: the countdown is the badge in the corner of the
  // card, the spend is along its foot, and the counts are in the statistics
  // below. Five tiles of things you had already read, above the list you came
  // to click. The one fact only it carried, trips whose notes are still empty,
  // moved down into the planning statistics.
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

  // Under the cards, and computed over every trip rather than the filtered
  // set: "countries visited" does not change because you clicked Planning.
  renderTripStatistics(parent, ctx, trips);
}
