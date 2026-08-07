import { setIcon } from "obsidian";
import type { DashboardContext } from "../common";
import { bar, emptyState, noTripState, renderToolbar, sectionTitle, statTiles } from "../common";
import type { Trip, TripStage } from "../../../types";
import { STAGES, joinPlaces, stageDef, tripCities } from "../../../types";
import { formatDate, formatDateRange, daysUntil } from "../../../util/dates";
import { formatMoney, formatTotals, sumMoney, totalIn } from "../../../util/money";
import type { PriceQuote, PriceTrack } from "../../../planning/priceWatch";
import {
  affordability,
  bestCaseTotals,
  describeTrend,
  estimateTotals,
  trackQuotes,
} from "../../../planning/priceWatch";

/**
 * The tab for a trip that has not happened yet.
 *
 * Two questions live here, and they are the same question at different stages:
 * "is this doable?" while it is still an idea, and "did waiting help?" once
 * prices have been checked more than once. The rest of the dashboard answers
 * what a trip *is*; this one answers whether it should be.
 */
export function renderPlanning(parent: HTMLElement, ctx: DashboardContext): void {
  const { trip, plugin } = ctx;
  if (!trip) {
    noTripState(parent, ctx, "compass");
    return;
  }

  renderStageStrip(parent, ctx, trip);

  const quotes = plugin.readQuotes(trip);
  const tracks = trackQuotes(quotes);

  renderVerdict(parent, ctx, trip, tracks);
  renderProposals(parent, ctx, trip, tracks);

  sectionTitle(parent, "Price watch", {
    label: "Log a price",
    icon: "plus",
    onClick: () => plugin.openPriceQuoteModal(trip),
  });

  if (tracks.length === 0) {
    emptyState(
      parent,
      "line-chart",
      "No prices checked yet",
      "Log what a flight or a hotel costs today, then check it again in a fortnight. One price is a number; the second one tells you which way it is going.",
      [{ label: "Log a price", icon: "plus", onClick: () => plugin.openPriceQuoteModal(trip) }],
    );
    return;
  }

  renderTracks(parent, ctx, trip, tracks);
}

/**
 * The lifecycle as four buttons.
 *
 * A stage change is one click because it happens at the moment you find out —
 * the flights are booked, or the plan fell through — and anything slower gets
 * left for later and then never done, which leaves the vault lying about what
 * is happening.
 */
function renderStageStrip(parent: HTMLElement, ctx: DashboardContext, trip: Trip): void {
  const section = parent.createDiv({ cls: "awty-stage-strip" });
  const head = section.createDiv({ cls: "awty-stage-head" });
  head.createDiv({ cls: "awty-stage-head-title", text: "Where is this trip up to?" });

  // A guess is not an answer, and the difference matters: everything below
  // this reads the stage, so a wrong one quietly misfiles the whole trip.
  if (trip.stageImplied) {
    head.createDiv({
      cls: "awty-stage-head-note",
      text: "Guessed from the dates — this trip was made before stages existed. Pick one to make it certain.",
    });
  }

  const row = section.createDiv({ cls: "awty-stage-row" });
  for (const def of STAGES) {
    const active = trip.stage === def.id;
    const btn = row.createEl("button", { cls: `awty-stage-btn is-${def.id}` });
    btn.type = "button";
    btn.toggleClass("is-active", active);
    setIcon(btn.createSpan({ cls: "awty-stage-icon" }), def.icon);
    const text = btn.createSpan({ cls: "awty-stage-text" });
    text.createSpan({ cls: "awty-stage-label", text: def.label });
    text.createSpan({ cls: "awty-stage-desc", text: def.description });
    btn.addEventListener("click", () => void ctx.plugin.setStage(trip, def.id));
  }

  // "Went" is reached by the calendar, not by a click, so say so rather than
  // leaving a button that appears to do nothing when pressed.
  if (trip.stage === "went" && trip.storedStage === "going") {
    section.createDiv({
      cls: "awty-stage-note",
      text: "Marked as went automatically: this trip was one you were going on, and its last day has passed.",
    });
  }
}

/** Can we afford it — the whole reason for logging a price. */
function renderVerdict(
  parent: HTMLElement,
  ctx: DashboardContext,
  trip: Trip,
  tracks: PriceTrack[],
): void {
  const { plugin } = ctx;
  const currency = plugin.bookings.getCurrency(trip);
  const estimate = estimateTotals(tracks);
  const best = bestCaseTotals(tracks);
  const verdict = affordability(estimate, trip.budgetTotal, currency);

  // What is already committed counts too: on a trip half-booked, an estimate
  // that ignores the flights you have paid for is not the trip's cost.
  const booked = sumMoney(
    plugin.bookings.getCostLines(trip).filter((l) => l.counted).map((l) => l.money),
  );
  const until = daysUntil(trip.startDate);

  statTiles(parent, [
    {
      label: "Priced so far",
      value: formatTotals(estimate, "—"),
      detail:
        tracks.length === 0
          ? "Nothing checked"
          : `${tracks.length} thing${tracks.length === 1 ? "" : "s"} watched`,
      icon: "receipt",
    },
    {
      label: "Best seen",
      value: formatTotals(best, "—"),
      detail: tracks.length === 0 ? "Nothing checked" : "Every cheapest price, added up",
      icon: "trending-down",
      tone: tracks.length > 0 && formatTotals(best) !== formatTotals(estimate) ? "warn" : "default",
    },
    {
      label: "Already booked",
      value: formatTotals(booked, "—"),
      detail: booked.size === 0 ? "Nothing committed yet" : "Paid for or confirmed",
      icon: "ticket",
    },
    {
      label: "Budget",
      value: trip.budgetTotal ? formatMoney({ amount: trip.budgetTotal, currency }) : "—",
      detail: until !== null && until >= 0 ? `${until} days until it starts` : "Trip has started",
      icon: "wallet",
      tone: verdict.fits === false ? "bad" : verdict.fits === true ? "good" : "default",
    },
  ]);

  if (!verdict.text) return;
  const box = parent.createDiv({
    cls: `awty-verdict is-${verdict.fits === null ? "unknown" : verdict.fits ? "good" : "bad"}`,
  });
  setIcon(
    box.createDiv({ cls: "awty-verdict-icon" }),
    verdict.fits === null ? "help-circle" : verdict.fits ? "check-circle" : "alert-triangle",
  );
  const body = box.createDiv({ cls: "awty-verdict-body" });
  body.createDiv({ cls: "awty-verdict-text", text: verdict.text });
  if (verdict.ratio !== null) {
    bar(body, verdict.ratio, verdict.ratio > 1 ? "bad" : verdict.ratio > 0.85 ? "warn" : "good");
  }
  body.createDiv({
    cls: "awty-verdict-note",
    text: "Prices move, and a quote is not a booking. Check again before you commit.",
  });
}

/**
 * The other things you are considering for the same window.
 *
 * Planning ahead means having more than one idea, and an idea is only doable
 * relative to the alternatives — so the competition is shown next to the
 * numbers rather than one dashboard away.
 */
function renderProposals(
  parent: HTMLElement,
  ctx: DashboardContext,
  trip: Trip,
  tracks: PriceTrack[],
): void {
  const { plugin } = ctx;
  const others = plugin.store
    .getTrips()
    .filter((t) => t.file.path !== trip.file.path && t.stage === "planning");
  if (others.length === 0 || trip.stage !== "planning") return;

  sectionTitle(parent, "Other ideas you are weighing up");
  const grid = parent.createDiv({ cls: "awty-proposal-grid" });

  const rows: { trip: Trip; tracks: PriceTrack[] }[] = [
    { trip, tracks },
    ...others.map((other) => ({ trip: other, tracks: trackQuotes(plugin.readQuotes(other)) })),
  ];

  for (const row of rows) {
    const currency = plugin.bookings.getCurrency(row.trip);
    const estimate = estimateTotals(row.tracks);
    const verdict = affordability(estimate, row.trip.budgetTotal, currency);
    const card = grid.createDiv({ cls: "awty-proposal" });
    card.toggleClass("is-current", row.trip.file.path === trip.file.path);

    card.createDiv({ cls: "awty-proposal-title", text: row.trip.title });
    card.createDiv({
      cls: "awty-proposal-where",
      text:
        [joinPlaces(tripCities(row.trip)), formatDateRange(row.trip.startDate, row.trip.endDate)]
          .filter(Boolean)
          .join(" · ") || "No dates",
    });
    card.createDiv({
      cls: "awty-proposal-cost",
      text: formatTotals(estimate, "Not priced"),
    });
    card.createDiv({
      cls: `awty-proposal-verdict is-${verdict.fits === null ? "unknown" : verdict.fits ? "good" : "bad"}`,
      text:
        verdict.fits === null
          ? row.tracks.length === 0
            ? "No prices logged"
            : "No budget to compare"
          : verdict.fits
            ? "Within budget"
            : "Over budget",
    });

    if (row.trip.file.path !== trip.file.path) {
      card.addEventListener("click", () => plugin.selectTripInDashboard(row.trip.file.path));
      card.addClass("is-clickable");
    }
  }
}

/** Every thing being watched, with its history and its screenshots. */
function renderTracks(
  parent: HTMLElement,
  ctx: DashboardContext,
  trip: Trip,
  tracks: PriceTrack[],
): void {
  const { plugin } = ctx;
  const list = parent.createDiv({ cls: "awty-track-list" });

  for (const track of tracks) {
    const card = list.createDiv({ cls: `awty-track is-${track.direction}` });

    const head = card.createDiv({ cls: "awty-track-head" });
    const headText = head.createDiv({ cls: "awty-track-head-text" });
    headText.createDiv({ cls: "awty-track-title", text: track.label });
    headText.createDiv({ cls: "awty-track-category", text: track.category });

    const price = head.createDiv({ cls: "awty-track-price" });
    price.createDiv({
      cls: "awty-track-amount",
      text: formatMoney({ amount: track.latest.amount, currency: track.currency }),
    });
    price.createDiv({
      cls: "awty-track-when",
      text: `checked ${formatDate(track.latest.checkedOn)}`,
    });

    const trend = describeTrend(track);
    if (trend) {
      const row = card.createDiv({ cls: `awty-track-trend is-${track.direction}` });
      setIcon(
        row.createSpan({ cls: "awty-track-trend-icon" }),
        track.direction === "down"
          ? "trending-down"
          : track.direction === "up"
            ? "trending-up"
            : "minus",
      );
      row.createSpan({ cls: "awty-track-spark", text: track.spark });
      row.createSpan({ cls: "awty-track-trend-text", text: trend });
    }

    // Waiting has a cost, and it is invisible unless it is stated: this is the
    // difference between today's price and the best you have ever seen.
    if (track.missed > 0) {
      card.createDiv({
        cls: "awty-track-missed",
        text: `${formatMoney({ amount: track.missed, currency: track.currency })} above the best you saw — ${formatMoney({ amount: track.best.amount, currency: track.currency })} on ${formatDate(track.best.checkedOn)}.`,
      });
    }

    renderHistory(card, ctx, trip, track);

    const foot = card.createDiv({ cls: "awty-track-foot" });
    const again = foot.createEl("button", { cls: "awty-dash-action" });
    setIcon(again.createSpan(), "refresh-cw");
    again.createSpan({ text: "Check again" });
    again.addEventListener("click", () =>
      plugin.openPriceQuoteModal(trip, {
        label: track.label,
        category: track.category,
        currency: track.currency,
      }),
    );
  }
}

/** Each check, oldest first, so the shape of the trend is legible. */
function renderHistory(
  card: HTMLElement,
  ctx: DashboardContext,
  trip: Trip,
  track: PriceTrack,
): void {
  const rows = card.createDiv({ cls: "awty-track-history" });
  let previous: PriceQuote | null = null;

  for (const quote of track.quotes) {
    const row = rows.createDiv({ cls: "awty-quote" });
    row.createSpan({ cls: "awty-quote-date", text: formatDate(quote.checkedOn) });
    row.createSpan({
      cls: "awty-quote-amount",
      text: formatMoney({ amount: quote.amount, currency: quote.currency }),
    });

    // The step since the previous check, which is what you actually watch for.
    const step = previous ? quote.amount - previous.amount : 0;
    if (previous && step !== 0) {
      row.createSpan({
        cls: `awty-quote-step is-${step < 0 ? "down" : "up"}`,
        text: `${step < 0 ? "−" : "+"}${formatMoney({ amount: Math.abs(step), currency: quote.currency })}`,
      });
    }
    if (quote.provider) row.createSpan({ cls: "awty-quote-where", text: quote.provider });
    if (quote.url) {
      const link = row.createEl("a", { cls: "awty-quote-link", href: quote.url, text: "open" });
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener");
    }

    for (const path of quote.screenshots) {
      const shot = row.createSpan({ cls: "awty-quote-shot", attr: { "aria-label": path } });
      setIcon(shot, "image");
      shot.addEventListener("click", () => ctx.plugin.openScreenshot(path));
    }

    const edit = row.createSpan({ cls: "awty-quote-edit", attr: { "aria-label": "Edit this check" } });
    setIcon(edit, "pencil");
    edit.addEventListener("click", () => ctx.plugin.openPriceQuoteModal(trip, quote, quote.id));

    if (quote.note) rows.createDiv({ cls: "awty-quote-note", text: quote.note });
    previous = quote;
  }
}

/** The stage badge, used on cards and in the sidebar. */
export function stageBadge(parent: HTMLElement, stage: TripStage): HTMLElement {
  const def = stageDef(stage);
  const el = parent.createDiv({ cls: `awty-stage-badge is-${def.id}` });
  setIcon(el.createSpan({ cls: "awty-stage-badge-icon" }), def.icon);
  el.createSpan({ text: def.badge });
  el.setAttribute("title", def.description);
  return el;
}
