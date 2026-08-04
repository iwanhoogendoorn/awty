import type { TripStatus } from "../types";

/**
 * Dates are handled as ISO YYYY-MM-DD strings and converted through UTC
 * midnight. Using UTC keeps `addDays` honest across DST boundaries — a local
 * Date would make 2026-03-29 + 1 day land back on 2026-03-29 in Amsterdam.
 *
 * The 1.x plugin compared dates with `end < today` string comparison. That
 * happens to work for well-formed ISO strings and silently misclassifies
 * everything else, so every helper here validates first.
 */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidISODate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  // Round-trip guards against 2026-02-31 parsing as 3 March.
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(mo) - 1 &&
    date.getUTCDate() === Number(d)
  );
}

export function parseISO(value: string): Date | null {
  if (!isValidISODate(value)) return null;
  const [y, mo, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d));
}

export function toISO(date: Date): string {
  const y = String(date.getUTCFullYear()).padStart(4, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Today in the user's local timezone, expressed as an ISO date string. */
export function todayISO(): string {
  const now = new Date();
  return toISO(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function addDays(iso: string, days: number): string {
  const date = parseISO(iso);
  if (!date) return iso;
  date.setUTCDate(date.getUTCDate() + days);
  return toISO(date);
}

/** Nights between two dates; 0 if either is unparseable or end precedes start. */
export function nightsBetween(startISO: string, endISO: string): number {
  const start = parseISO(startISO);
  const end = parseISO(endISO);
  if (!start || !end) return 0;
  const ms = end.getTime() - start.getTime();
  return ms <= 0 ? 0 : Math.round(ms / 86_400_000);
}

/** Inclusive day count: a single-day trip is 1 day, not 0. */
export function daysBetween(startISO: string, endISO: string): number {
  if (!isValidISODate(startISO)) return 0;
  if (!isValidISODate(endISO)) return 1;
  return nightsBetween(startISO, endISO) + 1;
}

/** End date for a trip of `days` inclusive days starting on `startISO`. */
export function endDateForDuration(startISO: string, days: number): string {
  return addDays(startISO, Math.max(1, days) - 1);
}

export function tripStatus(startISO: string, endISO: string, today = todayISO()): TripStatus {
  const start = parseISO(startISO);
  const end = parseISO(endISO) ?? start;
  const now = parseISO(today);
  // Undated entries are treated as upcoming rather than silently filed as past.
  if (!start || !now) return "upcoming";
  if (end && end.getTime() < now.getTime()) return "past";
  if (start.getTime() <= now.getTime()) return "current";
  return "upcoming";
}

/** Whole days until a trip starts; negative once it has started. */
export function daysUntil(startISO: string, today = todayISO()): number | null {
  const start = parseISO(startISO);
  const now = parseISO(today);
  if (!start || !now) return null;
  return Math.round((start.getTime() - now.getTime()) / 86_400_000);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Full month name for an ISO date, or "" if it isn't one. */
export function monthName(iso: string): string {
  const date = parseISO(iso);
  return date ? MONTH_NAMES[date.getUTCMonth()] : "";
}

export function yearOf(iso: string): string {
  const date = parseISO(iso);
  return date ? String(date.getUTCFullYear()) : "";
}

function formatShort(iso: string): string {
  const date = parseISO(iso);
  if (!date) return iso;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "14 Aug 2026" for one day, "14 – 21 Aug 2026" when the month is shared. */
export function formatDateRange(startISO: string, endISO: string): string {
  const start = parseISO(startISO);
  const end = parseISO(endISO);
  if (!start) return startISO || "No date";
  if (!end || start.getTime() === end.getTime()) return formatShort(startISO);
  if (start.getUTCFullYear() === end.getUTCFullYear()) {
    if (start.getUTCMonth() === end.getUTCMonth()) {
      return `${start.getUTCDate()} – ${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
    }
    return `${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]} – ${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
  }
  return `${formatShort(startISO)} – ${formatShort(endISO)}`;
}

/** "7 days, 6 nights" / "1 day". */
export function formatDuration(startISO: string, endISO: string): string {
  const days = daysBetween(startISO, endISO);
  if (days <= 1) return "1 day";
  const nights = days - 1;
  return `${days} days, ${nights} night${nights === 1 ? "" : "s"}`;
}

/** Every ISO date from start to end inclusive, capped to keep runaway ranges sane. */
export function datesInRange(startISO: string, endISO: string, cap = 400): string[] {
  const out: string[] = [];
  if (!isValidISODate(startISO)) return out;
  let cursor = startISO;
  const end = isValidISODate(endISO) && endISO >= startISO ? endISO : startISO;
  while (cursor <= end && out.length < cap) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}
