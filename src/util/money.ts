import type { Money } from "../bookings/types";

/**
 * Totals are kept per currency and never converted.
 *
 * Converting would need live rates and would quietly invent numbers — a trip
 * booked partly in EUR and partly in HRK should show both, not a made-up single
 * figure. Most trips use one currency and collapse to a single line anyway.
 */
export type Totals = Map<string, number>;

const SYMBOLS: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  JPY: "¥",
  CHF: "CHF",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
  PLN: "zł",
  CZK: "Kč",
  HUF: "Ft",
  TRY: "₺",
  AUD: "A$",
  CAD: "C$",
  NZD: "NZ$",
  THB: "฿",
  ZAR: "R",
};

export const COMMON_CURRENCIES = Object.keys(SYMBOLS);

export function symbolFor(currency: string): string {
  return SYMBOLS[currency.toUpperCase()] ?? currency.toUpperCase();
}

/**
 * Accepts "1234.56", "1.234,56", "€1,234.56" and friends.
 *
 * The ambiguity is real: "1.234" is one thousand two hundred in Amsterdam and
 * one-point-two-three-four in London. The last separator wins — if a string has
 * both, the rightmost is the decimal point; with only one, it is treated as a
 * thousands separator when it groups exactly three digits.
 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,-]/g, "").trim();
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  let normalised: string;
  if (lastComma !== -1 && lastDot !== -1) {
    const decimalAt = Math.max(lastComma, lastDot);
    normalised =
      cleaned.slice(0, decimalAt).replace(/[.,]/g, "") + "." + cleaned.slice(decimalAt + 1);
  } else if (lastComma !== -1 || lastDot !== -1) {
    const at = lastComma !== -1 ? lastComma : lastDot;
    const decimals = cleaned.length - at - 1;
    normalised =
      decimals === 3
        ? cleaned.replace(/[.,]/g, "")
        : cleaned.slice(0, at).replace(/[.,]/g, "") + "." + cleaned.slice(at + 1);
  } else {
    normalised = cleaned;
  }

  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}

export function formatMoney(money: Money): string {
  const symbol = symbolFor(money.currency);
  const rounded = Math.round(money.amount * 100) / 100;
  const formatted = rounded.toLocaleString("en-GB", {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  // Symbols that are really currency codes read better with a space.
  return symbol.length > 1 && /[A-Za-z]/.test(symbol)
    ? `${symbol} ${formatted}`
    : `${symbol}${formatted}`;
}

export function addTo(totals: Totals, money: Money | null): void {
  if (!money || !Number.isFinite(money.amount)) return;
  const key = money.currency.toUpperCase();
  totals.set(key, (totals.get(key) ?? 0) + money.amount);
}

export function sumMoney(items: (Money | null)[]): Totals {
  const totals: Totals = new Map();
  for (const money of items) addTo(totals, money);
  return totals;
}

/** "€1,240 + £85", largest first. */
export function formatTotals(totals: Totals, empty = "—"): string {
  const parts = [...totals.entries()]
    .filter(([, amount]) => amount !== 0)
    .sort((a, b) => b[1] - a[1])
    .map(([currency, amount]) => formatMoney({ amount, currency }));
  return parts.length ? parts.join(" + ") : empty;
}

export function totalIn(totals: Totals, currency: string): number {
  return totals.get(currency.toUpperCase()) ?? 0;
}
