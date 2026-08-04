import { setIcon } from "obsidian";
import type { DashboardContext } from "../common";
import { bar, emptyState, readiness, renderToolbar, stateMark, statTiles } from "../common";
import { showTripMenu } from "../tripMenu";
import type { Trip } from "../../../types";
import { kindDef } from "../../../types";
import { formatTotals, sumMoney } from "../../../util/money";
import { daysUntil, formatDateRange, formatDuration } from "../../../util/dates";

/** Totals across every trip, so the Trips tab answers questions on its own. */
function renderAllTripsSummary(
  parent: HTMLElement,
  ctx: DashboardContext,
  trips: Trip[],
): void {
  const { plugin } = ctx;
  const upcoming = trips.filter((t) => t.status === "upcoming");
  const current = trips.filter((t) => t.status === "current");

  const spend = sumMoney(
    trips.flatMap((t) => plugin.bookings.getCostLines(t).filter((l) => l.counted).map((l) => l.money)),
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
      detail: `${upcoming.length} upcoming · ${trips.length - upcoming.length - current.length} past`,
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
  const trips = plugin.store.getTrips();

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

  const grid = parent.createDiv({ cls: "tp-trip-grid" });
  for (const trip of trips) {
    const def = kindDef(trip.kind);
    const card = grid.createDiv({ cls: `tp-card is-${trip.status}` });

    const head = card.createDiv({ cls: "tp-card-head" });
    setIcon(head.createDiv({ cls: "tp-card-icon" }), def.icon);
    const headText = head.createDiv({ cls: "tp-card-head-text" });
    headText.createDiv({ cls: "tp-card-title", text: trip.title });
    headText.createDiv({
      cls: "tp-card-where",
      text: [trip.city, trip.country].filter(Boolean).join(", ") || def.label,
    });

    const until = daysUntil(trip.startDate);
    const badge =
      trip.status === "current"
        ? "Now"
        : trip.status === "past"
          ? "Done"
          : until === null
            ? ""
            : until === 0
              ? "Today"
              : `${until}d`;
    if (badge) card.createDiv({ cls: `tp-card-badge is-${trip.status}`, text: badge });

    const meta = card.createDiv({ cls: "tp-card-meta" });
    meta.createDiv({ text: formatDateRange(trip.startDate, trip.endDate) });
    meta.createDiv({ cls: "tp-card-duration", text: formatDuration(trip.startDate, trip.endDate) });

    const lines = plugin.bookings.getCostLines(trip).filter((l) => l.counted);
    const spent = sumMoney(lines.map((l) => l.money));
    const bookings = plugin.bookings.getBookings(trip);

    const foot = card.createDiv({ cls: "tp-card-foot" });
    foot.createSpan({ cls: "tp-card-stat", text: formatTotals(spent, "No costs") });
    foot.createSpan({ cls: "tp-card-stat", text: `${bookings.length} booking${bookings.length === 1 ? "" : "s"}` });

    const ready = readiness(plugin, trip);
    if (ready.total > 0) {
      const progress = card.createDiv({ cls: "tp-card-progress" });
      progress.createDiv({
        cls: "tp-card-progress-label",
        text: `${Math.round(ready.ratio * 100)}% planned`,
      });
      bar(progress, ready.ratio, ready.ratio >= 1 ? "good" : ready.ratio < 0.34 ? "warn" : "good");
    }

    // A tick or cross per note, so an unfinished trip is obvious from the grid
    // without opening it.
    const marks = card.createDiv({ cls: "tp-card-marks" });
    for (const sub of plugin.store.getSubNotes(trip)) {
      const state = plugin.progress.peek(sub.file)?.state ?? "empty";
      const mark = stateMark(state);
      const el = marks.createDiv({ cls: `tp-mark is-small is-${state}` });
      setIcon(el, mark.icon);
      el.setAttribute("title", `${sub.label}: ${mark.label}`);
      el.setAttribute("aria-label", `${sub.label}: ${mark.label}`);
    }

    const menuBtn = card.createEl("button", {
      cls: "tp-icon-btn tp-card-menu",
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
