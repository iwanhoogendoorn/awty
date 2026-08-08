import type { TFile } from "obsidian";
import type { FlightLeg } from "./legs";
import type { PostalAddress } from "./postalAddress";

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

/** Whether a frontmatter string is one of the four, for notes edited by hand. */
export function isBookingStatus(value: string): value is BookingStatus {
  return BOOKING_STATUSES.some((s) => s.id === value);
}

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
  /**
   * The address as one line, composed from the parts below.
   *
   * Everything that wants an address — the geocoder, the map, the exports —
   * wants a single string, so this stays the thing they read.
   */
  address: string;
  /** The same address with its parts kept apart, for editing. */
  postal: PostalAddress;
  /** Where a transfer starts, when that is somewhere with an address. */
  fromAddress: string;
  fromPostal: PostalAddress;
  operator: string;
  seat: string;
  notes: string;
  attachments: string[];
  /**
   * Each flight on this booking, connections folded in.
   *
   * A ticket can hold flights days apart. The timeline needs one entry per
   * flight, on its own day — not one entry spanning the gap between them.
   */
  journeys: FlightJourney[];
  /**
   * The raw legs, outbound and return kept apart.
   *
   * `journeys` above has already folded connections together, which is what
   * the timeline wants. Anything measuring the flying itself — hours in the
   * air, kilometres, which airlines — needs the legs as booked.
   */
  legs: FlightLeg[];
  returnLegs: FlightLeg[];
}

export interface FlightJourney {
  date: string;
  time: string;
  from: string;
  to: string;
  /** "Outbound", "Return", or "Flight 2" for anything in between. */
  label: string;
  /** What this flight cost, when the flights were priced one by one. */
  cost: Money | null;
}

export interface Expense {
  file: TFile;
  tripFolder: string;
  date: string;
  description: string;
  /**
   * The same four words a booking uses.
   *
   * An expense was always counted, which is right for a receipt and wrong for
   * everything else somebody logs there — a deposit being considered, a
   * refunded ticket. Cancelled ones now drop out of the totals exactly as a
   * cancelled booking does.
   */
  status: BookingStatus;
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
