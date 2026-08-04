/**
 * Travel-advice parsing and URL rules, kept free of any Obsidian import so it
 * can be tested outside the app. The fetching itself lives in advice.ts.
 */
import { ADVICE_SLUGS } from "../data/adviceSlugs";
import { iso2ForCountry } from "./visa";

export type AdviceColour = "groen" | "geel" | "oranje" | "rood";

export interface TravelAdvice {
  colour: AdviceColour;
  country: string;
  url: string;
  /** Epoch millis this was fetched. */
  fetchedAt: number;
}

export const ADVICE_BASE = "https://www.nederlandwereldwijd.nl/reisadvies";

/** What each colour means, in the ministry's own terms. */
export const ADVICE_MEANING: Record<AdviceColour, { label: string; detail: string }> = {
  groen: { label: "Green", detail: "No particular safety risks." },
  geel: { label: "Yellow", detail: "Pay attention — there are safety risks." },
  oranje: { label: "Orange", detail: "Only essential travel." },
  rood: { label: "Red", detail: "Do not travel." },
};

export function adviceUrlFor(country: string): string | null {
  const iso2 = iso2ForCountry(country);
  const slug = iso2 ? ADVICE_SLUGS[iso2] : undefined;
  return slug ? `${ADVICE_BASE}/${slug}` : null;
}

/**
 * Reads the colour code out of the ministry's page.
 *
 * The page states it in a sentence — "De kleurcode van het reisadvies voor
 * Kroatië is groen." — which is the only stable handle it offers; there is no
 * API or feed. If the wording ever changes this returns null rather than
 * guessing, and the UI falls back to a link.
 */
export function parseAdviceColour(html: string): AdviceColour | null {
  const patterns = [
    /kleurcode van het reisadvies voor[^.]{0,80}?\bis\s+(groen|geel|oranje|rood)\b/i,
    /reisadvies[^.]{0,80}?\bkleurcode\s+(groen|geel|oranje|rood)\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) return match[1].toLowerCase() as AdviceColour;
  }
  return null;
}

/** Advice can change overnight, so a cached answer is only trusted for a day. */
export const ADVICE_TTL_MS = 24 * 60 * 60 * 1000;

export function isStale(advice: TravelAdvice, now = Date.now()): boolean {
  return now - advice.fetchedAt > ADVICE_TTL_MS;
}

