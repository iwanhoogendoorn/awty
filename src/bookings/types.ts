import type { TFile } from "obsidian";

/**
 * Bookings and expenses are stored one-per-note with typed frontmatter, the way
 * Food Spot stores restaurants. That is what makes the dashboard possible: the
 * metadata cache hands back frontmatter synchronously, so totals and charts need
 * no table parsing and nothing can silently break when a separator row is edited.
 */
export type BookingKind = "flight" | "stay" | "activity" | "transport" | "restaurant";

export type BookingStatus = "idea" | "reserved" | "booked" | "cancelled";

export type DaySlot = "morning" | "afternoon" | "evening";

export const DAY_SLOTS: { id: DaySlot; label: string }[] = [
  { id: "morning", label: "Morning" },
  { id: "afternoon", label: "Afternoon" },
  { id: "evening", label: "Evening" },
];

export const BOOKING_KINDS: {
  id: BookingKind;
  label: string;
  icon: string;
  /** Cost category these roll into, unless overridden on the note. */
  category: string;
  folder: string;
}[] = [
  { id: "flight", label: "Flight", icon: "plane", category: "Transport", folder: "Bookings" },
  { id: "stay", label: "Accommodation", icon: "bed", category: "Accommodation", folder: "Bookings" },
  { id: "activity", label: "Activity", icon: "ticket", category: "Activities", folder: "Bookings" },
  {
    id: "transport",
    label: "Transport",
    icon: "train-front",
    category: "Transport",
    folder: "Bookings",
  },
  {
    id: "restaurant",
    label: "Restaurant",
    icon: "utensils",
    category: "Food & drink",
    folder: "Bookings",
  },
];

export const BOOKING_STATUSES: { id: BookingStatus; label: string; color: string }[] = [
  { id: "idea", label: "Idea", color: "var(--text-faint)" },
  { id: "reserved", label: "Reserved", color: "var(--color-orange)" },
  { id: "booked", label: "Booked", color: "var(--color-green)" },
  { id: "cancelled", label: "Cancelled", color: "var(--color-red)" },
];

/** Cost categories the Budget note and the Costs tab share. */
export const COST_CATEGORIES = [
  "Transport",
  "Accommodation",
  "Food & drink",
  "Activities",
  "Shopping",
  "Misc",
] as const;

export type CostCategory = (typeof COST_CATEGORIES)[number] | string;

/**
 * Every category that should appear in a picker: the built-in set, whatever you
 * have added yourself, and anything already recorded on this trip — so a
 * category can never be budgeted for without being spendable against.
 */
export function allCategories(custom: readonly string[], used: Iterable<string> = []): string[] {
  const seen = new Set<string>(COST_CATEGORIES);
  const extra: string[] = [];
  for (const name of [...custom, ...used]) {
    const clean = name.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    extra.push(clean);
  }
  return [...COST_CATEGORIES, ...extra.sort((a, b) => a.localeCompare(b))];
}

export interface Money {
  amount: number;
  currency: string;
}

export interface Booking {
  file: TFile;
  tripFolder: string;
  kind: BookingKind;
  status: BookingStatus;
  title: string;
  /** ISO date the booking starts (departure, check-in, event date). */
  date: string;
  /** ISO date it ends; equal to `date` for a point-in-time booking. */
  endDate: string;
  time: string;
  endTime: string;
  /** Which part of the day the itinerary put this in, if any. */
  slot: DaySlot | "";
  /** Departure date of the return journey, for a return ticket. */
  returnDate: string;
  returnTime: string;
  cost: Money | null;
  category: CostCategory;
  reference: string;
  /** Free-form location: airport pair, or the venue's name. */
  from: string;
  to: string;
  /** Street address, used to place this on a map for travel times. */
  address: string;
  operator: string;
  seat: string;
  notes: string;
  attachments: string[];
}

export interface Expense {
  file: TFile;
  tripFolder: string;
  date: string;
  description: string;
  amount: Money;
  category: CostCategory;
  paidBy: string;
  attachments: string[];
}

/** A cost line in the Costs tab, whether it came from a booking or an expense. */
export interface CostLine {
  source: "booking" | "expense";
  file: TFile;
  date: string;
  description: string;
  category: CostCategory;
  money: Money;
  /** Cancelled bookings are listed but excluded from totals. */
  counted: boolean;
}
