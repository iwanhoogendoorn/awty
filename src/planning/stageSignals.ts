import type { TripStage } from "../types";

/**
 * Working out, from what is already in the vault, that a trip has changed stage.
 *
 * Asking someone to keep a status field up to date is asking them to tell you
 * something you can already see. The moment a flight is marked booked, the
 * answer to "is this happening?" has been given — so the plugin says what it
 * has noticed and offers the change, rather than waiting to be told a second
 * time and quietly holding the wrong answer until it is.
 *
 * It offers; it never applies. A trip's stage is a claim about the world, and
 * the only person who knows whether a reserved hotel means "we are going" is
 * the one who reserved it.
 *
 * Kept free of Obsidian so the rules can be tested.
 */

/** Only what the signals need, so a test does not have to build a whole note. */
export interface BookingSignal {
  title: string;
  status: string;
  kind: string;
}

export interface StageSuggestion {
  from: TripStage;
  to: TripStage;
  /** A sentence naming the evidence, shown on the button's own banner. */
  reason: string;
  /** The button's words: an answer to the question, not a command. */
  action: string;
}

/**
 * Kinds that commit you. A booked flight or a booked hotel is a trip
 * happening; a booked restaurant table is a Tuesday, and plenty of people
 * pencil one in for a trip they have not decided on.
 */
const COMMITTING = new Set(["flight", "stay", "transport"]);

function describe(bookings: BookingSignal[]): string {
  const first = bookings[0];
  const rest = bookings.length - 1;
  if (rest === 0) return `“${first.title}” is booked`;
  return `“${first.title}” and ${rest} other${rest === 1 ? "" : "s"} are booked`;
}

/**
 * What the vault suggests this trip's stage should be, or null when it has
 * nothing to add.
 *
 * Deliberately one-directional. That a trip has no bookings is not evidence it
 * was cancelled — most trips have none for weeks — and a plugin that demoted a
 * trip on an absence would be wrong far more often than right.
 */
export function suggestStage(
  stage: TripStage,
  bookings: BookingSignal[],
): StageSuggestion | null {
  if (stage !== "planning") return null;

  const committed = bookings.filter(
    (b) => b.status === "booked" && COMMITTING.has(b.kind),
  );
  if (committed.length === 0) return null;

  return {
    from: "planning",
    to: "going",
    reason: `${describe(committed)}, but this trip is still filed as an idea.`,
    action: "Yes, we're going",
  };
}
