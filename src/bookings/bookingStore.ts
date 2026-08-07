import { App, TFile, normalizePath } from "obsidian";
import type {
  Booking,
  BookingKind,
  BookingStatus,
  CostCategory,
  CostLine,
  Expense,
  FlightJourney,
  Money,
} from "./types";
import { BOOKING_KINDS } from "./types";
import type { AwtySettings, Trip } from "../types";
import { linkTarget } from "./linkTarget";
import { groupJourneys } from "./legs";
import { readLegs } from "./flightSummary";
import { isValidISODate } from "../util/dates";
import { parseAmount } from "../util/money";

/**
 * Every flight a booking holds, in order.
 *
 * Legs that connect are one flight; a leg marked separate starts another. The
 * return leg group is always its own flight. Bookings with no legs recorded
 * fall back to the dates on the booking itself.
 */
function readJourneys(fm: Record<string, unknown>, currency: string): FlightJourney[] {
  const out: FlightJourney[] = [];
  const priceOf = (leg: { cost?: number }): Money | null =>
    typeof leg.cost === "number" && leg.cost > 0 ? { amount: leg.cost, currency } : null;
  const outbound = groupJourneys(readLegs(fm.legs));
  const back = groupJourneys(readLegs(fm.return_legs));

  outbound.forEach((group, index) => {
    const first = group[0];
    const last = group[group.length - 1];
    out.push({
      date: first.date,
      time: first.depTime,
      from: first.from,
      to: last.to,
      label: index === 0 ? "Outbound" : `Flight ${index + 1}`,
      cost: priceOf(first),
    });
  });

  for (const group of back) {
    const first = group[0];
    const last = group[group.length - 1];
    out.push({
      date: first.date,
      time: first.depTime,
      from: first.from,
      to: last.to,
      label: "Return",
      cost: priceOf(first),
    });
  }
  return out;
}

function str(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(str).filter(Boolean);
  const single = str(value);
  return single ? [single] : [];
}

/** First leg of a return journey, if the booking records one. */
function firstReturnLeg(value: unknown): { date: string; time: string } {
  if (!Array.isArray(value) || value.length === 0) return { date: "", time: "" };
  const leg = value[0] as Record<string, unknown>;
  return { date: str(leg?.date), time: str(leg?.departs) };
}

function money(rawAmount: unknown, rawCurrency: unknown, fallback: string): Money | null {
  if (rawAmount === undefined || rawAmount === null || rawAmount === "") return null;
  const amount = typeof rawAmount === "number" ? rawAmount : parseAmount(str(rawAmount));
  if (amount === null || !Number.isFinite(amount)) return null;
  return { amount, currency: (str(rawCurrency) || fallback).toUpperCase() };
}

const KIND_BY_ID = new Map(BOOKING_KINDS.map((k) => [k.id, k]));

function asKind(value: unknown): BookingKind {
  const v = str(value).toLowerCase();
  return KIND_BY_ID.has(v as BookingKind) ? (v as BookingKind) : "activity";
}

function asStatus(value: unknown): BookingStatus {
  const v = str(value).toLowerCase();
  return v === "idea" || v === "reserved" || v === "booked" || v === "cancelled"
    ? v
    : "booked";
}

interface TripEntry {
  bookings: Booking[];
  expenses: Expense[];
}

/**
 * Reads booking and expense notes out of trip folders.
 *
 * Everything comes from frontmatter through the metadata cache, so this is
 * synchronous and cheap enough to call on every render.
 */
export class BookingStore {
  private byFolder = new Map<string, TripEntry>();
  private dirty = true;

  constructor(
    private app: App,
    private getSettings: () => AwtySettings,
  ) {}

  invalidate(): void {
    this.dirty = true;
  }

  private ensure(): void {
    if (!this.dirty) return;
    this.byFolder = this.scan();
    this.dirty = false;
  }

  getBookings(trip: Trip): Booking[] {
    this.ensure();
    return this.byFolder.get(trip.folderPath)?.bookings ?? [];
  }

  getExpenses(trip: Trip): Expense[] {
    this.ensure();
    return this.byFolder.get(trip.folderPath)?.expenses ?? [];
  }

  /**
   * Every cost for a trip, from bookings and standalone expenses alike.
   *
   * A flight's price is entered once, on the flight, and shows up here — there
   * is deliberately no second place to type it.
   */
  getCostLines(trip: Trip): CostLine[] {
    const lines: CostLine[] = [];

    for (const booking of this.getBookings(trip)) {
      if (!booking.cost) continue;
      lines.push({
        source: "booking",
        file: booking.file,
        date: booking.date,
        description: booking.title,
        category: booking.category,
        money: booking.cost,
        counted: booking.status !== "cancelled",
      });
    }

    for (const expense of this.getExpenses(trip)) {
      lines.push({
        source: "expense",
        file: expense.file,
        date: expense.date,
        description: expense.description,
        category: expense.category,
        money: expense.amount,
        counted: true,
      });
    }

    lines.sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description));
    return lines;
  }

  /** Budget targets held on the trip note as a `budget:` frontmatter map. */
  getBudget(trip: Trip): Map<CostCategory, number> {
    const fm = this.app.metadataCache.getFileCache(trip.file)?.frontmatter;
    const out = new Map<CostCategory, number>();
    const raw = fm?.budget;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        const amount = typeof value === "number" ? value : parseAmount(str(value));
        if (amount !== null && Number.isFinite(amount)) out.set(key, amount);
      }
    }
    return out;
  }

  /**
   * The overall budget for the trip.
   *
   * Separate from the per-category ones on purpose: most people know roughly
   * what the whole trip should cost long before they can break it down.
   * Falls back to the sum of the categories when no overall figure is set.
   */
  getBudgetTotal(trip: Trip): number {
    const fm = this.app.metadataCache.getFileCache(trip.file)?.frontmatter;
    const raw = fm?.budget_total;
    const explicit = typeof raw === "number" ? raw : parseAmount(str(raw));
    if (explicit !== null && Number.isFinite(explicit) && explicit > 0) return explicit;
    return [...this.getBudget(trip).values()].reduce((n, v) => n + v, 0);
  }

  /** Whether the overall figure was set by hand, or inferred from categories. */
  hasExplicitBudgetTotal(trip: Trip): boolean {
    const raw = this.app.metadataCache.getFileCache(trip.file)?.frontmatter?.budget_total;
    const value = typeof raw === "number" ? raw : parseAmount(str(raw));
    return value !== null && Number.isFinite(value) && value > 0;
  }

  /** Currency for a trip: its own frontmatter, else the vault default. */
  getCurrency(trip: Trip): string {
    const fm = this.app.metadataCache.getFileCache(trip.file)?.frontmatter;
    return (str(fm?.currency) || this.getSettings().defaultCurrency || "EUR").toUpperCase();
  }

  private scan(): Map<string, TripEntry> {
    const settings = this.getSettings();
    const root = normalizePath(settings.tripsFolder);
    const prefix = root && root !== "/" ? `${root}/` : "";
    const fallbackCurrency = (settings.defaultCurrency || "EUR").toUpperCase();

    const out = new Map<string, TripEntry>();
    const entryFor = (folder: string): TripEntry => {
      let entry = out.get(folder);
      if (!entry) out.set(folder, (entry = { bookings: [], expenses: [] }));
      return entry;
    };

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (prefix && !file.path.startsWith(prefix)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;

      const type = str(fm.type);
      if (type !== "booking" && type !== "expense") continue;

      // Bookings live in a subfolder of the trip, so walk up to the trip folder
      // recorded on the note rather than guessing from the path.
      const tripFolder = str(fm.trip_folder) || file.parent?.parent?.path || file.parent?.path || "";
      if (!tripFolder) continue;

      if (type === "booking") {
        const kind = asKind(fm.booking_kind);
        const date = str(fm.date);
        const back = firstReturnLeg(fm.return_legs);
        const endDate = str(fm.end_date);
        entryFor(tripFolder).bookings.push({
          file,
          tripFolder,
          kind,
          status: asStatus(fm.status),
          title: str(fm.title) || file.basename,
          date,
          endDate: isValidISODate(endDate) ? endDate : date,
          time: str(fm.time),
          slot: (["morning", "afternoon", "evening"].includes(str(fm.slot))
            ? str(fm.slot)
            : "") as Booking["slot"],
          endTime: str(fm.end_time),
          returnDate: isValidISODate(back.date) ? back.date : "",
          returnTime: back.time,
          cost: money(fm.cost, fm.currency, fallbackCurrency),
          category: str(fm.category) || (KIND_BY_ID.get(kind)?.category ?? "Misc"),
          reference: str(fm.reference),
          from: str(fm.from),
          to: str(fm.to),
          address: str(fm.address),
          fromAddress: str(fm.from_address),
          operator: str(fm.operator),
          seat: str(fm.seat),
          notes: str(fm.notes),
          journeys: readJourneys(fm, money(fm.cost, fm.currency, fallbackCurrency)?.currency ?? fallbackCurrency),
          legs: readLegs(fm.legs),
          returnLegs: readLegs(fm.return_legs),
          attachments: list(fm.attachments),
        });
        continue;
      }

      const amount = money(fm.amount, fm.currency, fallbackCurrency);
      if (!amount) continue;
      entryFor(tripFolder).expenses.push({
        file,
        tripFolder,
        date: str(fm.date),
        description: str(fm.description) || file.basename,
        amount,
        category: str(fm.category) || "Misc",
        paidBy: str(fm.paid_by),
        attachments: list(fm.attachments),
      });
    }

    for (const entry of out.values()) {
      entry.bookings.sort(
        (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time),
      );
      entry.expenses.sort((a, b) => a.date.localeCompare(b.date));
    }
    return out;
  }
}

/** Groups cost lines by category, counting only what should count. */
export function totalsByCategory(lines: CostLine[]): Map<CostCategory, Map<string, number>> {
  const out = new Map<CostCategory, Map<string, number>>();
  for (const line of lines) {
    if (!line.counted) continue;
    let byCurrency = out.get(line.category);
    if (!byCurrency) out.set(line.category, (byCurrency = new Map()));
    const key = line.money.currency.toUpperCase();
    byCurrency.set(key, (byCurrency.get(key) ?? 0) + line.money.amount);
  }
  return out;
}

export function fileFromLink(app: App, link: string, sourcePath: string): TFile | null {
  const cleaned = linkTarget(link);
  if (!cleaned) return null;
  return (
    app.metadataCache.getFirstLinkpathDest(cleaned, sourcePath) ??
    // A markdown link holds a path rather than a link name, and the path is
    // vault-absolute when Obsidian is set to "Absolute path in vault".
    (app.vault.getAbstractFileByPath(cleaned) instanceof TFile
      ? (app.vault.getAbstractFileByPath(cleaned) as TFile)
      : null)
  );
}
