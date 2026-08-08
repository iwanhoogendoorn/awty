import type { Money } from "../bookings/types";
import type { Totals } from "../util/money";
import { formatMoney, formatTotals, parseAmount, sumMoney, symbolFor, totalIn } from "../util/money";
import { formatDate, formatDateRange } from "../util/dates";
import { SUB_NOTE_LABELS, type Trip } from "../types";

/**
 * Prices you looked up, on the day you looked them up.
 *
 * A trip you are only considering is a question — can we afford this, and is
 * now the moment to book? — and that question is answered by the same price
 * checked more than once. One number tells you nothing; the third one tells you
 * whether it is climbing. So a quote is stamped with the day it was seen and
 * kept alongside the ones before it, screenshot and all, rather than
 * overwriting them.
 *
 * Kept free of Obsidian so the grouping and the arithmetic can be tested.
 */
export interface PriceQuote {
  /** Stable across edits, so a quote can be changed or removed by identity. */
  id: string;
  /** ISO date the price was seen — not the date it is for. */
  checkedOn: string;
  /** One of the cost categories, so an estimate lines up with the budget. */
  category: string;
  /** What exactly was priced: "KL835 AMS→DPS, 17–31 Aug, 2 adults". */
  label: string;
  amount: number;
  currency: string;
  /** Where the price came from: Skyscanner, Booking.com, the airline itself. */
  provider: string;
  url: string;
  note: string;
  /** Vault paths of screenshots taken at the time. */
  screenshots: string[];
  /**
   * The day this price stopped being a question and became a ticket.
   *
   * A watched price is a guess at what a trip will cost; a booking is what it
   * did cost. Once one becomes the other, counting both would bill you twice
   * for the same flight — so the quote records which booking it turned into
   * and drops out of the estimate.
   */
  bookedOn: string;
  /** Vault path of the booking note this quote became. */
  bookedPath: string;
}

const SPARK = "▁▂▃▄▅▆▇█";

function str(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

/**
 * Frontmatter edited by hand will say "1.234,50" as readily as "1234.5", and
 * `Number` reads the first as NaN — which `readQuotes` then drops as a quote
 * with no price. `parseAmount` is the one place that ambiguity is settled.
 */
function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return parseAmount(str(value)) ?? 0;
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(str).filter(Boolean);
  const single = str(value);
  return single ? [single] : [];
}

/**
 * Frontmatter is a loose record, and someone will edit it by hand.
 *
 * A quote without an amount is not a price, so it is dropped rather than
 * counted as zero — a free flight would sink an estimate silently.
 */
export function readQuotes(value: unknown): PriceQuote[] {
  if (!Array.isArray(value)) return [];
  const out: PriceQuote[] = [];
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const amount = num(record.amount);
    if (!(amount > 0)) continue;
    out.push({
      id: str(record.id) || `q${index + 1}`,
      checkedOn: str(record.checked_on) || str(record.checkedOn),
      category: str(record.category) || "Misc",
      label: str(record.label) || str(record.what) || "Unnamed",
      amount,
      currency: (str(record.currency) || "EUR").toUpperCase(),
      provider: str(record.provider),
      url: str(record.url),
      note: str(record.note),
      screenshots: strings(record.screenshots),
      bookedOn: str(record.booked_on) || str(record.bookedOn),
      bookedPath: str(record.booked_path) || str(record.bookedPath),
    });
  }
  return out;
}

/** The frontmatter shape, with empty fields left out rather than written blank. */
export function writeQuotes(quotes: PriceQuote[]): Record<string, unknown>[] {
  return quotes.map((quote) => {
    const record: Record<string, unknown> = {
      id: quote.id,
      checked_on: quote.checkedOn,
      category: quote.category,
      label: quote.label,
      amount: quote.amount,
      currency: quote.currency,
    };
    if (quote.provider) record.provider = quote.provider;
    if (quote.url) record.url = quote.url;
    if (quote.note) record.note = quote.note;
    if (quote.screenshots.length > 0) record.screenshots = quote.screenshots;
    if (quote.bookedOn) record.booked_on = quote.bookedOn;
    if (quote.bookedPath) record.booked_path = quote.bookedPath;
    return record;
  });
}

/**
 * Quotes with their booking stamp removed where the booking is gone.
 *
 * A stamp is a claim about another note, and notes get deleted. Left alone the
 * claim outlives the thing it points at: the watch keeps saying "Booked" with a
 * link to nothing, and — far worse — keeps the price out of the estimate, so
 * the money is on no booking and in no total. It disappears.
 *
 * So the stamp is believed only while the note it names is still there. The
 * check is passed in rather than done here, because whether a path exists is a
 * question for the vault and this file has never needed to know about one.
 */
export function unbookMissing(
  quotes: PriceQuote[],
  exists: (path: string) => boolean,
): PriceQuote[] {
  return quotes.map((quote) =>
    quote.bookedPath && !exists(quote.bookedPath)
      ? { ...quote, bookedOn: "", bookedPath: "" }
      : quote,
  );
}

/** Quotes pointing at a booking that has moved, re-pointed at where it went. */
export function rebindBooking(quotes: PriceQuote[], from: string, to: string): PriceQuote[] {
  return quotes.map((quote) =>
    quote.bookedPath === from ? { ...quote, bookedPath: to } : quote,
  );
}

/** A quote id nothing else on the note is using. */
export function nextQuoteId(quotes: PriceQuote[]): string {
  let highest = 0;
  for (const quote of quotes) {
    const digits = /^q(\d+)$/.exec(quote.id);
    if (digits) highest = Math.max(highest, Number(digits[1]));
  }
  return `q${highest + 1}`;
}

/**
 * The same thing, priced repeatedly.
 *
 * Two quotes belong together when they describe the same purchase — the label
 * and category are how you said which. Matching on the label alone would put
 * "3 nights, Hotel Kompas" from the flights list next to the hotel's own.
 */
export interface PriceTrack {
  key: string;
  label: string;
  category: string;
  currency: string;
  /** Oldest first, so the last entry is what it costs today. */
  quotes: PriceQuote[];
  first: PriceQuote;
  latest: PriceQuote;
  /** The cheapest it has ever been seen at. */
  best: PriceQuote;
  /** Latest minus first. Negative means it has come down. */
  delta: number;
  /** Latest minus best: what waiting has cost you so far. */
  missed: number;
  direction: "up" | "down" | "flat";
  spark: string;
  /**
   * The quote that became a booking, if one did.
   *
   * Held on the track rather than looked up per quote, because the question
   * anybody asks of a price watch is "have I booked this yet", and that is a
   * fact about the thing being watched rather than about any one check.
   */
  booked: PriceQuote | null;
}

function trackKey(quote: PriceQuote): string {
  return `${quote.category.toLowerCase()}::${quote.label.trim().toLowerCase()}`;
}

/**
 * Quotes grouped into the things they price, dearest first.
 *
 * Dearest first because the expensive line is the one worth watching: if a
 * trip does not fit, the flights are where it stops fitting.
 */
export function trackQuotes(quotes: PriceQuote[]): PriceTrack[] {
  const groups = new Map<string, PriceQuote[]>();
  for (const quote of quotes) {
    const key = trackKey(quote);
    const bucket = groups.get(key);
    if (bucket) bucket.push(quote);
    else groups.set(key, [quote]);
  }

  const tracks: PriceTrack[] = [];
  for (const [key, group] of groups) {
    // A quote typed without a date sorts to the front rather than jumping to
    // the end and pretending to be the current price.
    const ordered = [...group].sort((a, b) => a.checkedOn.localeCompare(b.checkedOn));
    const first = ordered[0];
    const latest = ordered[ordered.length - 1];
    const best = ordered.reduce((low, q) => (q.amount < low.amount ? q : low), ordered[0]);
    const delta = latest.amount - first.amount;

    // The last one taken wins, on the reading that if you booked twice the
    // second one is the booking you kept.
    const booked = [...ordered].reverse().find((q) => Boolean(q.bookedOn)) ?? null;

    tracks.push({
      key,
      booked,
      label: latest.label,
      category: latest.category,
      currency: latest.currency,
      quotes: ordered,
      first,
      latest,
      best,
      delta,
      missed: latest.amount - best.amount,
      direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
      spark: sparkline(ordered.map((q) => q.amount)),
    });
  }

  tracks.sort((a, b) => b.latest.amount - a.latest.amount || a.label.localeCompare(b.label));
  return tracks;
}

/**
 * A price history as eight blocks of height.
 *
 * Two identical prices are drawn flat rather than at the bottom of the range:
 * with no spread, every point is both the highest and the lowest, and scaling
 * would show a made-up cliff.
 */
export function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (high === low) return SPARK[3].repeat(values.length);
  return values
    .map((value) => SPARK[Math.round(((value - low) / (high - low)) * (SPARK.length - 1))])
    .join("");
}

/** What the trip looks like it will cost, from the latest price for each thing. */
/**
 * What is still being watched, as opposed to what has been bought.
 *
 * Everything that adds prices up goes through this. A track you have booked has
 * a real cost on a real note now, counted by the budget like any other booking;
 * leaving it in the estimate as well would charge the trip twice for one flight
 * and quietly inflate every total on the Planning tab.
 */
export function openTracks(tracks: PriceTrack[]): PriceTrack[] {
  return tracks.filter((t) => !t.booked);
}

/** Today's price for everything not yet booked. */
export function estimateTotals(tracks: PriceTrack[]): Totals {
  return sumMoney(
    openTracks(tracks).map((t): Money => ({ amount: t.latest.amount, currency: t.currency })),
  );
}

/** What the quotes you acted on came to — the watch's own share of the spend. */
export function bookedTotals(tracks: PriceTrack[]): Totals {
  return sumMoney(
    tracks
      .filter((t) => t.booked)
      .map((t): Money => ({ amount: t.booked!.amount, currency: t.currency })),
  );
}

/** The same trip at every cheapest price ever seen — the best case, not a forecast. */
export function bestCaseTotals(tracks: PriceTrack[]): Totals {
  return sumMoney(
    openTracks(tracks).map((t): Money => ({ amount: t.best.amount, currency: t.currency })),
  );
}

/** Latest prices, added up per category, for lining an estimate up against a budget. */
export function estimateByCategory(tracks: PriceTrack[]): Map<string, Totals> {
  const out = new Map<string, Totals>();
  for (const track of openTracks(tracks)) {
    const money: Money = { amount: track.latest.amount, currency: track.currency };
    const existing = out.get(track.category);
    if (existing) {
      existing.set(track.currency, (existing.get(track.currency) ?? 0) + money.amount);
    } else {
      out.set(track.category, sumMoney([money]));
    }
  }
  return out;
}

export interface Affordability {
  /** Null when there is no budget, or when the estimate spans currencies. */
  fits: boolean | null;
  /** Estimate as a share of the budget; null under the same conditions. */
  ratio: number | null;
  /** Money left over, negative when over. Null under the same conditions. */
  gap: number | null;
  text: string;
}

/**
 * Whether the trip, as priced so far, is doable.
 *
 * Mixed currencies get no verdict rather than a converted one: the rate on the
 * day you book is not the rate today, and a made-up number here would be a
 * number someone books a holiday on.
 */
export function affordability(
  estimate: Totals,
  budget: number | null,
  currency: string,
): Affordability {
  const none: Affordability = { fits: null, ratio: null, gap: null, text: "" };
  if (estimate.size === 0) return { ...none, text: "Nothing priced yet." };
  if (budget === null || !(budget > 0)) {
    return { ...none, text: `${formatTotals(estimate)} priced so far — no budget set to compare it to.` };
  }
  if (estimate.size > 1) {
    return {
      ...none,
      text: `${formatTotals(estimate)} priced so far. Not compared to the budget: the prices are in more than one currency.`,
    };
  }

  const spent = totalIn(estimate, currency);
  // A single-currency estimate in a currency other than the budget's is still
  // two currencies; comparing them would be the conversion this refuses to do.
  if (spent === 0) {
    return {
      ...none,
      text: `${formatTotals(estimate)} priced so far, and the budget is in ${currency.toUpperCase()}. Not comparable without a rate.`,
    };
  }

  const gap = budget - spent;
  const symbol = symbolFor(currency);
  return {
    fits: gap >= 0,
    ratio: spent / budget,
    gap,
    text:
      gap >= 0
        ? `Fits: ${symbol}${round(gap)} of the ${symbol}${round(budget)} budget still unspent.`
        : `Over by ${symbol}${round(-gap)} — priced at ${symbol}${round(spent)} against a ${symbol}${round(budget)} budget.`,
  };
}

function round(value: number): string {
  return Math.round(value).toLocaleString("en-GB");
}

/** "€64 cheaper than on 3 Jul", or "" when there is only one price to go on. */
export function describeTrend(track: PriceTrack): string {
  if (track.quotes.length < 2) return "";
  const since = formatDate(track.first.checkedOn) || track.first.checkedOn;
  const money = formatMoney({ amount: Math.abs(track.delta), currency: track.currency });
  if (track.direction === "flat") return `Unchanged since ${since}`;
  return track.direction === "down"
    ? `${money} cheaper than on ${since}`
    : `${money} dearer than on ${since}`;
}

/**
 * The generated body of the Price Watch note.
 *
 * The note is the record, not just a rendering of it: the quotes live in its
 * frontmatter, so this is what makes them legible when someone opens the note
 * rather than the dashboard.
 */
export function priceWatchTable(tracks: PriceTrack[]): string {
  if (tracks.length === 0) return "_No prices checked yet._";

  const rows = [
    "| What | Category | Latest | Checked | Trend | Best seen |",
    "|---|---|---|---|---|---|",
  ];
  for (const track of tracks) {
    // A booked line says so instead of showing a trend. The trend of a price
    // you already paid is not information, and reading "still climbing" against
    // a ticket in your pocket is actively misleading.
    const trend = track.booked
      ? `**Booked** ${formatDate(track.booked.bookedOn) || track.booked.bookedOn}`
      : [track.spark, describeTrend(track)].filter(Boolean).join(" ");
    rows.push(
      `| ${track.label} | ${track.category} | ${formatMoney({ amount: track.latest.amount, currency: track.currency })} | ${formatDate(track.latest.checkedOn) || track.latest.checkedOn} | ${trend || "—"} | ${formatMoney({ amount: track.best.amount, currency: track.currency })} |`,
    );
  }
  return rows.join("\n");
}

/** Every quote in date order, so the history is readable in the note itself. */
export function priceHistoryTable(quotes: PriceQuote[]): string {
  if (quotes.length === 0) return "";
  const ordered = [...quotes].sort(
    (a, b) => b.checkedOn.localeCompare(a.checkedOn) || a.label.localeCompare(b.label),
  );
  const rows = ["| Checked | What | Price | Where | Note |", "|---|---|---|---|---|"];
  for (const quote of ordered) {
    const where = quote.url ? `[${quote.provider || "link"}](${quote.url})` : quote.provider;
    rows.push(
      `| ${formatDate(quote.checkedOn) || quote.checkedOn} | ${quote.label} | ${formatMoney({ amount: quote.amount, currency: quote.currency })} | ${where || "—"} | ${quote.note || ""} |`,
    );
  }
  return rows.join("\n");
}

/**
 * The caveat that belongs on prices specifically.
 *
 * Not the visa disclaimer: that one is about entry requirements, and pasting
 * "not immigration advice" under a flight price says nothing about the thing
 * it is sitting under. What matters here is that a quote is not a booking.
 */
const PRICE_CAVEAT =
  "Every figure here is a price someone saw on a day, not a price on offer now. Fares and rates change constantly, and a quote is not a booking — check again before you commit to anything.";

/** The generated body: what it costs, what it did cost, and the receipts. */
export function priceWatchBody(
  settings: { defaultCurrency: string },
  trip: Trip,
  quotes: PriceQuote[],
): string {
  const tracks = trackQuotes(quotes);
  const estimate = estimateTotals(tracks);
  const best = bestCaseTotals(tracks);
  const verdict = affordability(estimate, trip.budgetTotal, settings.defaultCurrency);

  // Everything above the first heading is a title and one generated table, and
  // nothing else. `customParts` keeps whatever else it finds there so a note
  // someone has typed in survives a regeneration — which means a generated
  // paragraph up here gets preserved too, and appears again on every save.
  const out: string[] = [
    `# ${SUB_NOTE_LABELS.prices} — ${trip.title}`,
    "",
    "| | |",
    "|---|---|",
    `| **Trip** | [[${trip.file.basename}]] |`,
    `| **When** | ${formatDateRange(trip.startDate, trip.endDate)} |`,
    `| **Watching** | ${tracks.length} thing${tracks.length === 1 ? "" : "s"} |`,
    "",
    "## Estimate",
    "",
    `**${formatTotals(estimate, "Nothing priced yet")}** at the latest prices.`,
  ];

  if (tracks.length > 0 && formatTotals(best) !== formatTotals(estimate)) {
    out.push("", `Best seen across all checks: **${formatTotals(best)}**.`);
  }
  if (verdict.text) out.push("", verdict.text);
  out.push(
    "",
    `_${PRICE_CAVEAT}_`,
    "",
    "## Watching",
    "",
    priceWatchTable(tracks),
  );

  const history = priceHistoryTable(quotes);
  if (history) out.push("", "## History", "", history);

  const shots = quotes.filter((q) => q.screenshots.length > 0);
  if (shots.length > 0) {
    out.push("", "## Screenshots", "");
    for (const quote of shots) {
      out.push(`**${quote.label}** — ${quote.checkedOn}`, "");
      for (const path of quote.screenshots) out.push(`![[${path}]]`);
      out.push("");
    }
  }

  return out.join("\n").trimEnd();
}
