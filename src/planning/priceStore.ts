import { App, TFile } from "obsidian";
import type { AwtySettings, Trip } from "../types";
import { SUB_NOTE_LABELS } from "../types";
import { joinPath } from "../util/paths";
import { PRICE_WATCH_HEADINGS, customParts, weaveKept } from "../bookings/noteSections";
import { splitFrontmatter } from "../util/frontmatter";
import type { PriceQuote } from "./priceWatch";
import { priceWatchBody, readQuotes, writeQuotes } from "./priceWatch";

export { priceWatchBody } from "./priceWatch";

/**
 * The Price Watch note: where quotes live, and how they get back out.
 *
 * The quotes are frontmatter on a note rather than one note each, because a
 * price check is a line in a log, not a document — twelve notes to say a flight
 * went from €612 to €548 would bury the answer. The note's body is generated
 * from that frontmatter so the record is readable without the dashboard.
 */

export function priceWatchPath(trip: Trip): string {
  return joinPath(trip.folderPath, `${SUB_NOTE_LABELS.prices}.md`);
}

export function priceWatchFile(app: App, trip: Trip): TFile | null {
  const file = app.vault.getAbstractFileByPath(priceWatchPath(trip));
  return file instanceof TFile ? file : null;
}

/** Quotes on this trip, or none when the note has never been made. */
export function readTripQuotes(app: App, trip: Trip): PriceQuote[] {
  const file = priceWatchFile(app, trip);
  if (!file) return [];
  return readQuotes(app.metadataCache.getFileCache(file)?.frontmatter?.quotes);
}

/**
 * Creates the note the first time a price is logged.
 *
 * Not created with the trip: most trips are booked before they are watched, and
 * an empty Price Watch note in every folder would be one more thing showing up
 * unfinished in the progress marks.
 */
export async function ensurePriceWatchNote(app: App, trip: Trip): Promise<TFile> {
  const existing = priceWatchFile(app, trip);
  if (existing) return existing;

  const file = await app.vault.create(priceWatchPath(trip), "");
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.type = "price-watch";
    fm.trip = `[[${trip.file.basename}]]`;
    fm.quotes = [];
  });
  return file;
}

/**
 * Writes the quotes and rewrites the body around them.
 *
 * The frontmatter write and the body write are separate calls, and the metadata
 * cache does not catch up in between — so the body is built from the list we
 * just saved rather than read back, which is the bug that made the budget note
 * insist there was no food booked.
 */
async function commit(
  app: App,
  settings: AwtySettings,
  trip: Trip,
  quotes: PriceQuote[],
): Promise<TFile> {
  const file = await ensurePriceWatchNote(app, trip);
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.quotes = writeQuotes(quotes);
  });

  const content = await app.vault.read(file);
  const { frontmatter } = splitFrontmatter(content);
  const kept = customParts(content, PRICE_WATCH_HEADINGS);
  const body = weaveKept(priceWatchBody(settings, trip, quotes), kept);
  await app.vault.modify(file, `${frontmatter ? `${frontmatter}\n\n` : ""}${body}\n`);
  return file;
}

/** Adds a quote, or replaces the one with the same id. */
export async function saveQuote(
  app: App,
  settings: AwtySettings,
  trip: Trip,
  quote: PriceQuote,
): Promise<TFile> {
  const quotes = readTripQuotes(app, trip);
  const at = quotes.findIndex((q) => q.id === quote.id);
  if (at === -1) quotes.push(quote);
  else quotes[at] = quote;
  return commit(app, settings, trip, quotes);
}

/**
 * Re-point or drop the booking stamps on a trip's quotes.
 *
 * One read and one write, rather than a save per quote: two quotes converted
 * into the same booking would otherwise read-modify-write over each other and
 * the second would undo the first.
 *
 * Returns whether anything changed, so a caller reacting to a vault-wide event
 * can do nothing at all for the overwhelming majority of them.
 */
export async function repointBookings(
  app: App,
  settings: AwtySettings,
  trip: Trip,
  from: string,
  to: string | null,
): Promise<boolean> {
  const quotes = readTripQuotes(app, trip);
  if (!quotes.some((q) => q.bookedPath === from)) return false;
  const next = quotes.map((quote) =>
    quote.bookedPath === from
      ? to
        ? { ...quote, bookedPath: to }
        : { ...quote, bookedOn: "", bookedPath: "" }
      : quote,
  );
  await commit(app, settings, trip, next);
  return true;
}

export async function removeQuote(
  app: App,
  settings: AwtySettings,
  trip: Trip,
  id: string,
): Promise<void> {
  const quotes = readTripQuotes(app, trip).filter((q) => q.id !== id);
  await commit(app, settings, trip, quotes);
}
