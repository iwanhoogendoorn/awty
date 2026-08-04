import { setIcon } from "obsidian";
import type { DashboardContext } from "../common";
import { bar, emptyState, readiness, renderToolbar } from "../common";
import { showTripMenu } from "../tripMenu";
import type { Trip } from "../../../types";
import { kindDef } from "../../../types";
import { formatTotals, sumMoney } from "../../../util/money";
import { daysUntil, formatDateRange, formatDuration } from "../../../util/dates";

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
