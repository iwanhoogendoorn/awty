/**
 * Splitting a flight designator, kept free of any Obsidian import so it can be
 * tested outside the app.
 */
/** "KL1885" -> carrier KL, number 1885. */
export function splitFlightNumber(raw: string): { carrier: string; number: string } | null {
  const cleaned = raw.replace(/\s+/g, "").toUpperCase();
  const m = /^([A-Z0-9]{2,3}?)(\d{1,4})$/.exec(cleaned);
  if (!m) return null;
  // A carrier code is two or three characters, at most one of them a digit.
  if (!/^[A-Z]{2,3}$|^[A-Z]\d$|^\d[A-Z]$/.test(m[1])) return null;
  return { carrier: m[1], number: m[2] };
}

