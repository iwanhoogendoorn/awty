import { setIcon } from "obsidian";
import type { DashboardContext } from "../common";
import { bar, emptyState, readiness, sectionTitle, stateMark, statTiles, noTripState } from "../common";
import { renderGettingAround } from "../gettingAround";
import { renderDocuments } from "../documents";
import { BOOKING_KINDS } from "../../../bookings/types";
import { totalsByCategory } from "../../../bookings/bookingStore";
import { formatMoney, formatTotals, sumMoney, totalIn } from "../../../util/money";
import {
  daysUntil,
  formatDateRange,
  formatDuration,
  todayISO,
} from "../../../util/dates";

/**
 * The trip's own notes, openable from the dashboard.
 *
 * Without this the dashboard was a dead end: you could see that the Packing
 * List was empty but had no way to get to it without going back to the sidebar.
 */
function renderTripNotes(parent: HTMLElement, ctx: DashboardContext): void {
  const { trip, plugin } = ctx;
  if (!trip) return;

  const subNotes = plugin.store.getSubNotes(trip);
  const head = sectionTitle(parent, "Trip notes", {
    label: "Open trip note",
    icon: "file-text",
    onClick: () => ctx.openFile(trip.file),
  });
  const exportBtn = head.createEl("button", { cls: "tp-dash-action" });
  setIcon(exportBtn.createSpan(), "file-down");
  exportBtn.createSpan({ text: "Export to PDF" });
  exportBtn.addEventListener("click", () => plugin.exportTrip(trip));

  if (subNotes.length === 0) {
    parent.createDiv({ cls: "tp-dash-hint", text: "This trip has no sub-notes." });
    return;
  }

  const grid = parent.createDiv({ cls: "tp-note-grid" });
  for (const sub of subNotes) {
    const progress = plugin.progress.peek(sub.file);
    const state = progress?.state ?? "empty";
    const mark = stateMark(state);
    const cell = grid.createDiv({ cls: `tp-note-cell is-${state}` });

    const head = cell.createDiv({ cls: "tp-note-head" });
    const markEl = head.createDiv({ cls: "tp-mark" });
    setIcon(markEl, mark.icon);
    markEl.setAttribute("aria-label", mark.label);
    markEl.setAttribute("title", mark.label);
    head.createDiv({ cls: "tp-note-name", text: sub.label });

    cell.createDiv({ cls: "tp-note-detail", text: progress?.detail ?? "Reading…" });
    if (progress?.ratio !== null && progress?.ratio !== undefined) {
      bar(cell, progress.ratio, progress.ratio >= 1 ? "good" : "warn");
    }

    const actions = cell.createDiv({ cls: "tp-note-actions" });

    // The wizard is the primary action; the note itself is the escape hatch.
    if (sub.id) {
      const fill = actions.createEl("button", { cls: "tp-note-btn is-cta" });
      setIcon(fill.createSpan(), "wand-2");
      fill.createSpan({ text: state === "empty" ? "Fill in" : "Add" });
      fill.addEventListener("click", (evt) => {
        evt.stopPropagation();
        plugin.openNoteWizard(trip, sub.id!);
      });
    }

    const open = actions.createEl("button", { cls: "tp-note-btn" });
    setIcon(open.createSpan(), "file-text");
    open.createSpan({ text: "Open" });
    open.addEventListener("click", (evt) => {
      evt.stopPropagation();
      ctx.openFile(sub.file);
    });
  }
}

/** Everything about one trip that should be true at a glance. */
export function renderOverview(parent: HTMLElement, ctx: DashboardContext): void {
  const { trip, plugin } = ctx;
  if (!trip) {
    noTripState(parent, ctx, "plane");
    return;
  }

  const lines = plugin.bookings.getCostLines(trip);
  const spent = sumMoney(lines.filter((l) => l.counted).map((l) => l.money));
  const budget = plugin.bookings.getBudget(trip);
  const currency = plugin.bookings.getCurrency(trip);
  const budgetTotal = plugin.bookings.getBudgetTotal(trip);
  const spentPrimary = totalIn(spent, currency);
  const ready = readiness(plugin, trip);
  const until = daysUntil(trip.startDate);

  // ------------------------------------------------------------- hero
  const hero = parent.createDiv({ cls: `tp-hero is-${trip.status}` });
  const heroMain = hero.createDiv({ cls: "tp-hero-main" });
  heroMain.createDiv({ cls: "tp-hero-title", text: trip.title });
  const where = [trip.city, trip.country].filter(Boolean).join(", ");
  heroMain.createDiv({
    cls: "tp-hero-sub",
    text: [formatDateRange(trip.startDate, trip.endDate), where].filter(Boolean).join(" · "),
  });

  const countdown = hero.createDiv({ cls: "tp-hero-countdown" });
  if (trip.status === "current") {
    countdown.createDiv({ cls: "tp-hero-big", text: "Now" });
    countdown.createDiv({ cls: "tp-hero-small", text: "You're on this trip" });
  } else if (until !== null && until >= 0) {
    countdown.createDiv({ cls: "tp-hero-big", text: String(until) });
    countdown.createDiv({ cls: "tp-hero-small", text: until === 1 ? "day to go" : "days to go" });
  } else {
    countdown.createDiv({ cls: "tp-hero-big", text: "✓" });
    countdown.createDiv({ cls: "tp-hero-small", text: "Completed" });
  }

  // ------------------------------------------------------------ stats
  const bookings = plugin.bookings.getBookings(trip);
  const confirmed = bookings.filter((b) => b.status === "booked").length;

  statTiles(parent, [
    {
      label: "Duration",
      value: formatDuration(trip.startDate, trip.endDate).split(",")[0],
      detail: formatDateRange(trip.startDate, trip.endDate),
      icon: "calendar-days",
    },
    {
      label: "Cost so far",
      value: formatTotals(spent, formatMoney({ amount: 0, currency })),
      detail:
        budgetTotal > 0
          ? `of ${formatMoney({ amount: budgetTotal, currency })} budget`
          : "No budget set",
      icon: "wallet",
      tone: budgetTotal > 0 && spentPrimary > budgetTotal ? "bad" : "default",
    },
    {
      label: "Bookings",
      value: String(bookings.length),
      detail: `${confirmed} confirmed`,
      icon: "ticket",
      tone: bookings.length === 0 ? "warn" : "default",
    },
    {
      label: "Planning",
      value: ready.total === 0 ? "—" : `${Math.round(ready.ratio * 100)}%`,
      detail: ready.total === 0 ? "Nothing to track yet" : `${ready.done} of ${ready.total} done`,
      icon: "check-circle",
      tone: ready.ratio >= 1 ? "good" : ready.ratio < 0.34 ? "warn" : "default",
    },
  ]);

  // -------------------------------------------------------- next up
  const today = todayISO();
  const upcoming = bookings
    .filter((b) => b.status !== "cancelled" && b.date >= today)
    .slice(0, 4);

  if (upcoming.length > 0) {
    sectionTitle(parent, trip.status === "current" ? "Coming up" : "First up");
    const list = parent.createDiv({ cls: "tp-next-list" });
    for (const booking of upcoming) {
      const row = list.createDiv({ cls: "tp-next-row" });
      const def = BOOKING_KINDS.find((k) => k.id === booking.kind);
      setIcon(row.createDiv({ cls: "tp-next-icon" }), def?.icon ?? "ticket");
      const text = row.createDiv({ cls: "tp-next-text" });
      text.createDiv({ cls: "tp-next-title", text: booking.title });
      text.createDiv({
        cls: "tp-next-meta",
        text: [booking.date, booking.time].filter(Boolean).join(" · "),
      });
      if (booking.cost) {
        row.createDiv({ cls: "tp-next-cost", text: formatMoney(booking.cost) });
      }
      row.addEventListener("click", () => ctx.openFile(booking.file));
    }
  }

  renderDocuments(parent, ctx);
  renderTripNotes(parent, ctx);
  renderGettingAround(parent, ctx);

  // ------------------------------------------------- needs attention
  const attention: { text: string; action?: () => void }[] = [];

  for (const sub of plugin.store.getSubNotes(trip)) {
    const progress = plugin.progress.peek(sub.file);
    if (progress && progress.state === "empty") {
      attention.push({ text: `${sub.label} is still empty`, action: () => ctx.openFile(sub.file) });
    }
  }
  if (bookings.length === 0) {
    attention.push({ text: "Nothing booked yet" });
  } else {
    const unconfirmed = bookings.filter((b) => b.status === "reserved" || b.status === "idea");
    for (const booking of unconfirmed.slice(0, 3)) {
      attention.push({
        text: `${booking.title} is only ${booking.status}`,
        action: () => ctx.openFile(booking.file),
      });
    }
  }
  if (budgetTotal === 0) attention.push({ text: "No budget set for this trip" });

  sectionTitle(parent, "Needs attention");
  if (attention.length === 0) {
    const done = parent.createDiv({ cls: "tp-all-clear" });
    setIcon(done.createSpan(), "check-circle");
    done.createSpan({ text: "Everything's filled in. Have a good trip." });
  } else {
    const list = parent.createDiv({ cls: "tp-attention-list" });
    for (const item of attention) {
      const row = list.createDiv({ cls: `tp-attention-row${item.action ? " is-clickable" : ""}` });
      setIcon(row.createSpan({ cls: "tp-attention-icon" }), "alert-circle");
      row.createSpan({ text: item.text });
      if (item.action) row.addEventListener("click", item.action);
    }
  }

  // ------------------------------------------------------ cost vs budget
  //
  // "Budget" is what you plan to spend; "Cost" is what it actually comes to.
  // Showing a bare "€827 / €827" left it ambiguous which was which.
  const budgetTotalSet = plugin.bookings.getBudgetTotal(trip);
  if (budgetTotalSet > 0 || spentPrimary > 0) {
    sectionTitle(parent, "Cost vs budget", {
      label: budgetTotalSet > 0 ? "Edit budget" : "Set a budget",
      icon: "sliders-horizontal",
      onClick: () => plugin.openBudgetModal(trip),
    });

    const head = parent.createDiv({ cls: "tp-budget-headline" });
    const left = head.createDiv();
    left.createDiv({ cls: "tp-budget-headline-label", text: "Total cost so far" });
    left.createDiv({
      cls: "tp-budget-headline-value",
      text: formatTotals(spent, formatMoney({ amount: 0, currency })),
    });

    if (budgetTotalSet > 0) {
      const over = spentPrimary - budgetTotalSet;
      const right = head.createDiv({ cls: "tp-budget-headline-right" });
      right.createDiv({ cls: "tp-budget-headline-label", text: "Trip budget" });
      right.createDiv({
        cls: "tp-budget-headline-value",
        text: formatMoney({ amount: budgetTotalSet, currency }),
      });
      right.createDiv({
        cls: `tp-budget-headline-delta${over > 0 ? " is-over" : ""}`,
        text:
          over > 0
            ? `${formatMoney({ amount: over, currency })} over budget`
            : `${formatMoney({ amount: -over, currency })} left`,
      });
      bar(
        parent,
        budgetTotalSet === 0 ? 0 : spentPrimary / budgetTotalSet,
        over > 0 ? "bad" : spentPrimary / budgetTotalSet > 0.9 ? "warn" : "good",
      );
    } else {
      head.createDiv({ cls: "tp-dash-hint", text: "No budget set for this trip." });
    }

    if (budget.size > 0) {
      const byCategory = totalsByCategory(lines);
      const wrap = parent.createDiv({ cls: "tp-budget-list" });
      for (const [category, target] of budget) {
        const actual = byCategory.get(category)?.get(currency) ?? 0;
        const ratio = target === 0 ? 0 : actual / target;
        const row = wrap.createDiv({ cls: "tp-budget-row" });
        const rowHead = row.createDiv({ cls: "tp-budget-head" });
        rowHead.createSpan({ cls: "tp-budget-cat", text: category });
        rowHead.createSpan({
          cls: `tp-budget-amount${ratio > 1 ? " is-over" : ""}`,
          text: `cost ${formatMoney({ amount: actual, currency })} · budget ${formatMoney({ amount: target, currency })}`,
        });
        // Exactly on budget is fine, not a warning.
        bar(row, ratio, ratio > 1 ? "bad" : ratio > 0.9 ? "warn" : "good");
      }
    }
  }
}
