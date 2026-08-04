import { Menu, Notice, setIcon } from "obsidian";
import type { DashboardContext } from "../common";
import { bar, editItem, emptyState, readiness, sectionTitle, stateMark, statTiles, noTripState } from "../common";
import { renderGettingAround } from "../gettingAround";
import { renderDocuments } from "../documents";
import { BOOKING_KINDS, type BookingKind } from "../../../bookings/types";
import type { SubNoteId } from "../../../types";
import { joinPlaces, tripCities, tripCountries } from "../../../types";

import { totalsByCategory } from "../../../bookings/bookingStore";
import { formatMoney, formatTotals, sumMoney, totalIn } from "../../../util/money";
import {
  datesInRange,
  daysUntil,
  formatDateRange,
  formatDayLabel,
  formatDuration,
  todayISO,
} from "../../../util/dates";

interface NoteItem {
  label: string;
  icon: string;
  open: () => void;
  remove?: () => void;
}

/**
 * What the primary button on a note card does.
 *
 * Half of these wizards edit the whole note rather than adding to it — a
 * packing list has one list, and "Add" was simply the wrong word for the button
 * that opens it.
 */
function primaryLabel(id: SubNoteId | null, empty: boolean): string {
  if (!id) return "";
  if (id === "itinerary") return "Plan a day";
  if (id === "budget") return "Set targets";
  if (id === "accommodation" || id === "transport") return "Add";
  if (id === "food") return "Book a table";
  return empty ? "Fill in" : "Edit";
}

/**
 * The things a note is a list of, so each one can be opened in the form that
 * made it. A note card knows how many bookings it holds; until now that number
 * was all it would tell you.
 */
function itemsFor(id: SubNoteId | null, ctx: DashboardContext): NoteItem[] {
  const { trip, plugin } = ctx;
  if (!trip || !id) return [];

  const bookingsOfKind = (kinds: BookingKind[]): NoteItem[] =>
    plugin.bookings
      .getBookings(trip)
      .filter((b) => kinds.includes(b.kind))
      .map((booking) => ({
        label: [booking.date, booking.title].filter(Boolean).join(" · "),
        icon: BOOKING_KINDS.find((k) => k.id === booking.kind)?.icon ?? "ticket",
        open: () => void plugin.openBookingWizard(trip, booking.kind, booking),
        remove: () => plugin.deleteItem(trip, booking.file, booking.title),
      }));

  if (id === "accommodation") return bookingsOfKind(["stay"]);
  if (id === "food") return bookingsOfKind(["restaurant"]);
  if (id === "transport") return bookingsOfKind(["flight", "transport"]);

  // Every line in the Budget note, whichever kind of note it came from. Most of
  // them are booking prices, so listing only expenses left the button hidden on
  // a note that plainly said "6 lines".
  if (id === "budget") {
    return plugin.bookings.getCostLines(trip).map((line) => ({
      label: [line.date, line.description].filter(Boolean).join(" · "),
      icon: line.source === "expense" ? "receipt" : "ticket",
      open: () => {
        if (!editItem(ctx, line.file)) ctx.openFile(line.file);
      },
    }));
  }

  // Every day of the trip, so a day already planned can be reopened rather than
  // only added to. Which of them have content is a read of the itinerary note,
  // and the planner shows that anyway once it opens.
  if (id === "itinerary") {
    return datesInRange(trip.startDate, trip.endDate, 90).map((date, index) => ({
      label: `Day ${index + 1} · ${formatDayLabel(date)}`,
      icon: "calendar-days",
      open: () => plugin.openAddDayModal(trip, date),
    }));
  }
  return [];
}

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
  sectionTitle(parent, "Trip notes", {
    label: "Open trip note",
    icon: "file-text",
    onClick: () => ctx.openFile(trip.file),
  });

  if (subNotes.length === 0) {
    parent.createDiv({ cls: "awty-dash-hint", text: "This trip has no sub-notes." });
    return;
  }

  const grid = parent.createDiv({ cls: "awty-note-grid" });
  for (const sub of subNotes) {
    const progress = plugin.progress.peek(sub.file);
    const state = progress?.state ?? "empty";
    const mark = stateMark(state);
    const cell = grid.createDiv({ cls: `awty-note-cell is-${state}` });

    const head = cell.createDiv({ cls: "awty-note-head" });
    const markEl = head.createDiv({ cls: "awty-mark" });
    if (mark.icon) setIcon(markEl, mark.icon);
    markEl.setAttribute("aria-label", mark.label);
    markEl.setAttribute("title", mark.label);
    head.createDiv({ cls: "awty-note-name", text: sub.label });

    cell.createDiv({ cls: "awty-note-detail", text: progress?.detail ?? "Reading…" });
    if (progress?.ratio !== null && progress?.ratio !== undefined) {
      bar(cell, progress.ratio, progress.ratio >= 1 ? "good" : "warn");
    }

    const actions = cell.createDiv({ cls: "awty-note-actions" });

    // The wizard is the primary action; the note itself is the escape hatch.
    if (sub.id) {
      const fill = actions.createEl("button", { cls: "awty-note-btn is-cta" });
      setIcon(fill.createSpan(), "wand-2");
      fill.createSpan({ text: primaryLabel(sub.id, state === "empty") });
      fill.addEventListener("click", (evt) => {
        evt.stopPropagation();
        plugin.openNoteWizard(trip, sub.id!);
      });
    }

    // What is already in the note, editable without going through frontmatter.
    // "Add" and "Open" alone left no way to change what was already there.
    const existing = itemsFor(sub.id, ctx);
    if (existing.length > 0) {
      const edit = actions.createEl("button", { cls: "awty-note-btn" });
      setIcon(edit.createSpan(), "pencil");
      edit.createSpan({ text: "Edit" });
      edit.addEventListener("click", (evt) => {
        evt.stopPropagation();
        // Opening an entry is the common case; its form carries the Delete.
        const menu = new Menu();
        for (const item of existing) {
          menu.addItem((i) =>
            i.setTitle(item.label).setIcon(item.icon).onClick(() => item.open()),
          );
        }
        menu.showAtMouseEvent(evt);
      });
    }

    const open = actions.createEl("button", { cls: "awty-note-btn" });
    setIcon(open.createSpan(), "file-text");
    open.createSpan({ text: "Open" });
    open.addEventListener("click", (evt) => {
      evt.stopPropagation();
      ctx.openFile(sub.file);
    });

    // A trip can end up with a note it has no use for — Event Details on a
    // holiday, say, or one left behind by an older version.
    cell.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      const menu = new Menu();
      menu.addItem((i) =>
        i.setTitle("Open").setIcon("file-text").onClick(() => ctx.openFile(sub.file)),
      );
      if (sub.id) {
        menu.addItem((i) =>
          i
            .setTitle("Fill in…")
            .setIcon("wand-2")
            .onClick(() => plugin.openNoteWizard(trip, sub.id!)),
        );
      }
      menu.addSeparator();
      menu.addItem((i) =>
        i
          .setTitle("Remove this note")
          .setIcon("trash-2")
          .onClick(async () => {
            // Goes to the vault's trash, so it is recoverable.
            await ctx.app.fileManager.trashFile(sub.file);
            new Notice(`Removed ${sub.label}.`);
            plugin.store.invalidate();
            ctx.refresh();
          }),
      );
      menu.showAtMouseEvent(evt);
    });
    cell.setAttribute("aria-label", `${sub.label} — right-click for more`);
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
  const hero = parent.createDiv({ cls: `awty-hero is-${trip.status}` });
  const heroMain = hero.createDiv({ cls: "awty-hero-main" });
  heroMain.createDiv({ cls: "awty-hero-title", text: trip.title });
  const where = [joinPlaces(tripCities(trip)), joinPlaces(tripCountries(trip))].filter(Boolean).join(", ");
  heroMain.createDiv({
    cls: "awty-hero-sub",
    text: [formatDateRange(trip.startDate, trip.endDate), where].filter(Boolean).join(" · "),
  });

  const countdown = hero.createDiv({ cls: "awty-hero-countdown" });
  if (trip.status === "current") {
    countdown.createDiv({ cls: "awty-hero-big", text: "Now" });
    countdown.createDiv({ cls: "awty-hero-small", text: "You're on this trip" });
  } else if (until !== null && until >= 0) {
    countdown.createDiv({ cls: "awty-hero-big", text: String(until) });
    countdown.createDiv({ cls: "awty-hero-small", text: until === 1 ? "day to go" : "days to go" });
  } else {
    countdown.createDiv({ cls: "awty-hero-big", text: "✓" });
    countdown.createDiv({ cls: "awty-hero-small", text: "Completed" });
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
    const list = parent.createDiv({ cls: "awty-next-list" });
    for (const booking of upcoming) {
      const row = list.createDiv({ cls: "awty-next-row" });
      const def = BOOKING_KINDS.find((k) => k.id === booking.kind);
      setIcon(row.createDiv({ cls: "awty-next-icon" }), def?.icon ?? "ticket");
      const text = row.createDiv({ cls: "awty-next-text" });
      text.createDiv({ cls: "awty-next-title", text: booking.title });
      text.createDiv({
        cls: "awty-next-meta",
        text: [booking.date, booking.time].filter(Boolean).join(" · "),
      });
      if (booking.cost) {
        row.createDiv({ cls: "awty-next-cost", text: formatMoney(booking.cost) });
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
    const done = parent.createDiv({ cls: "awty-all-clear" });
    setIcon(done.createSpan(), "check-circle");
    done.createSpan({ text: "Everything's filled in. Have a good trip." });
  } else {
    const list = parent.createDiv({ cls: "awty-attention-list" });
    for (const item of attention) {
      const row = list.createDiv({ cls: `awty-attention-row${item.action ? " is-clickable" : ""}` });
      setIcon(row.createSpan({ cls: "awty-attention-icon" }), "alert-circle");
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

    const head = parent.createDiv({ cls: "awty-budget-headline" });
    const left = head.createDiv();
    left.createDiv({ cls: "awty-budget-headline-label", text: "Total cost so far" });
    left.createDiv({
      cls: "awty-budget-headline-value",
      text: formatTotals(spent, formatMoney({ amount: 0, currency })),
    });

    if (budgetTotalSet > 0) {
      const over = spentPrimary - budgetTotalSet;
      const right = head.createDiv({ cls: "awty-budget-headline-right" });
      right.createDiv({ cls: "awty-budget-headline-label", text: "Trip budget" });
      right.createDiv({
        cls: "awty-budget-headline-value",
        text: formatMoney({ amount: budgetTotalSet, currency }),
      });
      right.createDiv({
        cls: `awty-budget-headline-delta${over > 0 ? " is-over" : ""}`,
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
      head.createDiv({ cls: "awty-dash-hint", text: "No budget set for this trip." });
    }

    if (budget.size > 0) {
      const byCategory = totalsByCategory(lines);
      const wrap = parent.createDiv({ cls: "awty-budget-list" });
      for (const [category, target] of budget) {
        const actual = byCategory.get(category)?.get(currency) ?? 0;
        const ratio = target === 0 ? 0 : actual / target;
        const row = wrap.createDiv({ cls: "awty-budget-row" });
        const rowHead = row.createDiv({ cls: "awty-budget-head" });
        rowHead.createSpan({ cls: "awty-budget-cat", text: category });
        rowHead.createSpan({
          cls: `awty-budget-amount${ratio > 1 ? " is-over" : ""}`,
          text: `cost ${formatMoney({ amount: actual, currency })} · budget ${formatMoney({ amount: target, currency })}`,
        });
        // Exactly on budget is fine, not a warning.
        bar(row, ratio, ratio > 1 ? "bad" : ratio > 0.9 ? "warn" : "good");
      }
    }
  }
}
