import type { FlightLeg } from "../bookings/legs";
import { isValidISODate } from "../util/dates";

/**
 * Reads flight details out of a booking confirmation.
 *
 * You have already booked by the time you open this plugin, so the fastest path
 * is not searching for flights but transcribing the ones you hold — and the
 * confirmation is usually one paste away. Airlines attach a calendar invite to
 * most confirmation emails, which is exact; the plain-text fallback is
 * best-effort over the layouts they actually use.
 */
export interface ParsedConfirmation {
  legs: FlightLeg[];
  reference: string;
  /** Total price, when the confirmation states one. */
  amount: number | null;
  currency: string;
  /** How the details were obtained, so the UI can say how much to trust them. */
  source: "ics" | "text";
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "17 Aug 2026", "Aug 17, 2026", "17/08/2026" and "2026-08-17". */
export function parseLooseDate(raw: string, fallbackYear?: number): string | null {
  const text = raw.trim();

  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return isValidISODate(iso[0]) ? iso[0] : null;

  const dmy = /\b(\d{1,2})[ .\-/]+([A-Za-z]{3,})[ .\-/]+(\d{4})\b/.exec(text);
  if (dmy) {
    const month = MONTHS[dmy[2].slice(0, 3).toLowerCase()];
    if (month) {
      const candidate = `${dmy[3]}-${pad(month)}-${pad(Number(dmy[1]))}`;
      if (isValidISODate(candidate)) return candidate;
    }
  }

  const mdy = /\b([A-Za-z]{3,})[ .\-/]+(\d{1,2}),?[ ]+(\d{4})\b/.exec(text);
  if (mdy) {
    const month = MONTHS[mdy[1].slice(0, 3).toLowerCase()];
    if (month) {
      const candidate = `${mdy[3]}-${pad(month)}-${pad(Number(mdy[2]))}`;
      if (isValidISODate(candidate)) return candidate;
    }
  }

  // Day and month with no year — common in itinerary tables.
  const dm = /\b(\d{1,2})[ .\-/]+([A-Za-z]{3,})\b/.exec(text);
  if (dm && fallbackYear) {
    const month = MONTHS[dm[2].slice(0, 3).toLowerCase()];
    if (month) {
      const candidate = `${fallbackYear}-${pad(month)}-${pad(Number(dm[1]))}`;
      if (isValidISODate(candidate)) return candidate;
    }
  }

  // Numeric, day first: European confirmations far outnumber American ones here.
  const numeric = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/.exec(text);
  if (numeric) {
    const year = numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3];
    const candidate = `${year}-${pad(Number(numeric[2]))}-${pad(Number(numeric[1]))}`;
    if (isValidISODate(candidate)) return candidate;
  }

  return null;
}

function normaliseTime(raw: string): string {
  const ampm = /\b(\d{1,2}):(\d{2})\s*([ap])\.?m\.?/i.exec(raw);
  if (ampm) {
    let hour = Number(ampm[1]) % 12;
    if (ampm[3].toLowerCase() === "p") hour += 12;
    return `${pad(hour)}:${ampm[2]}`;
  }
  const plain = /\b(\d{1,2}):(\d{2})\b/.exec(raw);
  if (!plain) return "";
  const hour = Number(plain[1]);
  return hour <= 23 ? `${pad(hour)}:${plain[2]}` : "";
}

// ------------------------------------------------------------------- iCal

function unfoldIcs(text: string): string[] {
  // RFC 5545 folds long lines by starting the continuation with whitespace.
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length > 0) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

function icsValue(line: string): string {
  const at = line.indexOf(":");
  return at === -1 ? "" : line.slice(at + 1).replace(/\\,/g, ",").replace(/\\n/g, " ").trim();
}

function icsDateTime(line: string): { date: string; time: string } {
  const value = icsValue(line);
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(value);
  if (!m) return { date: "", time: "" };
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    time: m[4] ? `${m[4]}:${m[5]}` : "",
  };
}

const FLIGHT_NUMBER = /\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b/;
const AIRPORT_PAIR = /\b([A-Z]{3})\s*(?:-|–|—|→|>|to)\s*([A-Z]{3})\b/;

export function parseIcs(text: string): ParsedConfirmation | null {
  if (!/BEGIN:VCALENDAR/i.test(text)) return null;

  const legs: FlightLeg[] = [];
  let reference = "";
  let current: Record<string, string> | null = null;

  for (const line of unfoldIcs(text)) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VEVENT")) {
      current = {};
      continue;
    }
    if (upper.startsWith("END:VEVENT")) {
      if (current) {
        const leg = legFromIcsEvent(current);
        if (leg) legs.push(leg);
      }
      current = null;
      continue;
    }
    if (!current) continue;

    if (upper.startsWith("SUMMARY")) current.summary = icsValue(line);
    else if (upper.startsWith("DESCRIPTION")) current.description = icsValue(line);
    else if (upper.startsWith("LOCATION")) current.location = icsValue(line);
    else if (upper.startsWith("DTSTART")) {
      const parsed = icsDateTime(line);
      current.startDate = parsed.date;
      current.startTime = parsed.time;
    } else if (upper.startsWith("DTEND")) {
      const parsed = icsDateTime(line);
      current.endDate = parsed.date;
      current.endTime = parsed.time;
    }
  }

  for (const line of unfoldIcs(text)) {
    const ref = /(?:booking|confirmation|reservation)\s*(?:code|reference|number|ref)?\s*[:#]?\s*([A-Z0-9]{5,8})\b/i.exec(
      line,
    );
    if (ref) {
      reference = ref[1].toUpperCase();
      break;
    }
  }

  if (legs.length === 0) return null;
  legs.sort((a, b) => `${a.date}${a.depTime}`.localeCompare(`${b.date}${b.depTime}`));
  return { legs, reference, amount: null, currency: "", source: "ics" };
}

function legFromIcsEvent(event: Record<string, string>): FlightLeg | null {
  const haystack = [event.summary, event.description, event.location].filter(Boolean).join(" ");
  if (!/flight|vlucht|\b[A-Z]{2}\s?\d{2,4}\b/i.test(haystack)) return null;

  const number = FLIGHT_NUMBER.exec(haystack.toUpperCase());
  const pair = AIRPORT_PAIR.exec(haystack.toUpperCase());
  if (!number && !pair) return null;

  return {
    operator: "",
    number: number ? `${number[1]}${number[2]}` : "",
    from: pair?.[1] ?? "",
    to: pair?.[2] ?? "",
    date: event.startDate ?? "",
    depTime: event.startTime ?? "",
    arrDate: event.endDate || event.startDate || "",
    arrTime: event.endTime ?? "",
  };
}

// ------------------------------------------------------------------- text

/**
 * Best-effort parse of a pasted confirmation.
 *
 * Deliberately conservative: a line has to carry a flight number and an airport
 * pair before it is treated as a leg, because half-guessed times are worse than
 * an empty field you were going to fill in anyway.
 */
export function parseConfirmationText(text: string): ParsedConfirmation | null {
  const lines = text.split(/\r?\n/);
  const legs: FlightLeg[] = [];
  const yearMatch = /\b(20\d{2})\b/.exec(text);
  const fallbackYear = yearMatch ? Number(yearMatch[1]) : undefined;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length < 6) continue;

    const upper = line.toUpperCase();
    const number = FLIGHT_NUMBER.exec(upper);
    const pair = AIRPORT_PAIR.exec(upper);
    if (!number || !pair) continue;

    const times = [...line.matchAll(/\b\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?/gi)].map((m) =>
      normaliseTime(m[0]),
    );
    const date = parseLooseDate(line, fallbackYear);

    legs.push({
      operator: "",
      number: `${number[1]}${number[2]}`,
      from: pair[1],
      to: pair[2],
      date: date ?? "",
      depTime: times[0] ?? "",
      arrDate: date ?? "",
      arrTime: times[1] ?? "",
    });
  }

  if (legs.length === 0) return null;

  const refMatch =
    /(?:booking|confirmation|reservation|pnr)\s*(?:code|reference|number|ref)?\s*[:#]?\s*([A-Z0-9]{5,8})\b/i.exec(
      text,
    );
  const priceMatch = /(?:total|totaal|amount)\D{0,20}?([€$£]|EUR|USD|GBP)\s?([\d.,]+)/i.exec(text);

  let amount: number | null = null;
  let currency = "";
  if (priceMatch) {
    const symbols: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP" };
    currency = symbols[priceMatch[1]] ?? priceMatch[1].toUpperCase();
    const cleaned = priceMatch[2].replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
    const value = Number(cleaned);
    if (Number.isFinite(value)) amount = value;
  }

  return {
    legs,
    reference: refMatch ? refMatch[1].toUpperCase() : "",
    amount,
    currency,
    source: "text",
  };
}

/**
 * Undoes quoted-printable encoding.
 *
 * Saving an email to a file gives you the raw source, where a soft line break
 * is "=" at end of line and every non-ASCII byte is "=XX". Left alone, that
 * splits flight numbers across lines and the parser sees nothing.
 */
export function decodeQuotedPrintable(text: string): string {
  if (!/=\r?\n|=[0-9A-F]{2}/i.test(text)) return text;
  return text
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (whole, hex: string) => {
      const code = parseInt(hex, 16);
      // Only decode printable bytes; anything else is likely not encoded text.
      return code >= 32 && code < 127 ? String.fromCharCode(code) : whole;
    });
}

/**
 * Pulls a calendar attachment out of an email.
 *
 * Airlines attach the invite as a base64 part, so the useful data is not in the
 * text at all until it is decoded.
 */
export function extractIcsFromEmail(text: string): string | null {
  if (/BEGIN:VCALENDAR/i.test(text)) return text;

  const part = /Content-Type:\s*text\/calendar[\s\S]*?\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/i.exec(text);
  if (!part) return null;

  try {
    const decoded = atob(part[1].replace(/\s+/g, ""));
    return /BEGIN:VCALENDAR/i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/** Tries the calendar format first, since it is exact rather than inferred. */
export function parseConfirmation(raw: string): ParsedConfirmation | null {
  const embedded = extractIcsFromEmail(raw);
  if (embedded) {
    const parsed = parseIcs(embedded);
    if (parsed) return parsed;
  }
  const text = decodeQuotedPrintable(raw);
  return parseIcs(text) ?? parseConfirmationText(text);
}
