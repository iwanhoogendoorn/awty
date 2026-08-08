import type { BookingKind } from "../bookings/types";
import { BOOKING_KINDS } from "../bookings/types";
import type { PriceQuote } from "./priceWatch";
import { formatDate } from "../util/dates";
import { formatMoney } from "../util/money";

/**
 * Turning a price you watched into a booking you made.
 *
 * The end of the planning loop. You check a price, check it again, watch it
 * come down, and then you buy it — and until now that last step meant retyping
 * everything you had already recorded into a booking form.
 *
 * Kept free of Obsidian so the mapping can be checked. Which kind of booking a
 * cost category implies, and what carries across, are questions with right
 * answers; deciding them inside a modal makes them impossible to test.
 */

/**
 * The kinds of booking a cost category could mean.
 *
 * Most categories name exactly one. Transport names two — a flight and a
 * taxi are both transport — and no amount of cleverness tells them apart from
 * the category alone, so the caller asks rather than guesses. A category with
 * no match at all (Shopping, Misc, anything you invented) offers everything,
 * because refusing to convert a quote over its category would be absurd.
 */
export function kindsForCategory(category: string): BookingKind[] {
  const matching = BOOKING_KINDS.filter(
    (k) => k.category.toLowerCase() === category.trim().toLowerCase(),
  ).map((k) => k.id);
  return matching.length > 0 ? matching : BOOKING_KINDS.map((k) => k.id);
}

/**
 * What the booking should say about where its price came from.
 *
 * The provider is where you *saw* the price, which is not the same as who you
 * are flying with — putting "Skyscanner" in the airline field would be a
 * plausible-looking lie, so it goes in the notes with the rest of the trail.
 */
export function bookingNoteFrom(quote: PriceQuote): string {
  const seen = `${formatMoney({ amount: quote.amount, currency: quote.currency })} on ${formatDate(quote.checkedOn)}`;
  const lines = [
    quote.provider ? `Price watched: ${seen} via ${quote.provider}.` : `Price watched: ${seen}.`,
  ];
  if (quote.url) lines.push(quote.url);
  if (quote.note) lines.push("", quote.note);
  return lines.join("\n");
}

/** The fields a quote can fill in on a booking form. Everything else is yours. */
export interface QuoteBooking {
  kind: BookingKind;
  title: string;
  amount: number;
  currency: string;
  category: string;
  notes: string;
  /** The screenshots of the price, kept as evidence on the booking. */
  attachments: string[];
}

/**
 * The booking a quote implies, ready to be corrected.
 *
 * Deliberately not a booking: a price watch knows what something costs and what
 * it is called, and knows nothing about when you fly or what seat you are in.
 * It fills the form and leaves the rest of it empty rather than inventing dates
 * from the day you happened to check a price.
 */
export function bookingFromQuote(quote: PriceQuote, kind: BookingKind): QuoteBooking {
  return {
    kind,
    title: quote.label,
    amount: quote.amount,
    currency: quote.currency,
    // The category you were watching under, so the budget line the estimate sat
    // in is the one the real cost lands in.
    category: quote.category,
    notes: bookingNoteFrom(quote),
    attachments: [...quote.screenshots],
  };
}
