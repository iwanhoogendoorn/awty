import { setIcon } from "obsidian";
import type { DashboardContext } from "../common";
import { bar, emptyState, readiness, renderToolbar, stateMark, statTiles } from "../common";
import { showTripMenu } from "../tripMenu";
import type { Trip } from "../../../types";
import { joinPlaces, kindDef, stageDef, tripCities, tripCountries } from "../../../types";
import { stageBadge } from "./planning";
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

  const next = current[0] ?? upcoming[0];
  const until = next ? daysUntil(next.startDate) : null;

  statTiles(parent, [
    {
      label: "Trips",
      value: String(trips.length),
      detail: `${upcoming.length} booked · ${planning.length} being planned`,
      icon: "plane",
    },
    {
      label: next ? "Next trip" : "Next trip",
      value: !next ? "—" : current.length > 0 ? "Now" : until === null ? "—" : `${until}d`,
      detail: next ? next.title : "Nothing planned",
      icon: "calendar-days",
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

/** Every trip as a card — the one view that spans trips rather than drilling in. */
export function renderTrips(
  parent: HTMLElement,
  ctx: DashboardContext,
  onSelect: (trip: Trip) => void,
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

  renderToolbar(parent, [
    { label: "New trip", icon: "plus", onClick: () => plugin.openNewTripModal() },
  ]);

  renderAllTripsSummary(parent, ctx, trips);

  const grid = parent.createDiv({ cls: "awty-trip-grid" });
  for (const trip of trips) {
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

    // A countdown on a trip that is not booked is a promise the trip has not
    // made. Those get the stage instead, which is the honest answer.
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
    else stageBadge(card, trip.stage).addClass("awty-card-badge");

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
