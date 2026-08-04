import { AbstractInputSuggest, App, setIcon } from "obsidian";
import { COUNTRIES } from "../../data/countries";
import { AIRLINES, airlineLabel } from "../../data/airlines";
import { AIRPORTS, type AirportRecord } from "../../data/airports";
import { CITIES } from "../../data/cities";
import { fold, rankMatches as rank } from "../../util/search";

export class CountrySuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    input: HTMLInputElement,
    private onPick: (value: string) => void,
  ) {
    super(app, input);
  }

  protected getSuggestions(query: string): string[] {
    return rank(COUNTRIES, query);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
    const count = CITIES[value]?.length ?? 0;
    if (count) {
      el.createSpan({ cls: "tp-suggest-hint", text: `${count} cities` });
    }
  }

  selectSuggestion(value: string): void {
    this.setValue(value);
    this.onPick(value);
    this.close();
  }
}

export class CitySuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    input: HTMLInputElement,
    private getCountry: () => string,
    private onPick: (value: string) => void,
  ) {
    super(app, input);
  }

  protected getSuggestions(query: string): string[] {
    const country = this.getCountry();
    // With no country chosen yet, search every city so the picker is still
    // usable — you may well know the city before you think about the country.
    const pool = country ? (CITIES[country] ?? []) : Object.values(CITIES).flat();
    return rank(pool, query, country ? 50 : 30);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
    if (!this.getCountry()) {
      const owner = Object.keys(CITIES).find((c) => CITIES[c].includes(value));
      if (owner) el.createSpan({ cls: "tp-suggest-hint", text: owner });
    }
  }

  selectSuggestion(value: string): void {
    this.setValue(value);
    this.onPick(value);
    this.close();
  }
}

/**
 * Airline picker with starred airlines pinned to the top.
 *
 * You fly the same handful of carriers over and over, so the ones you star sit
 * above the alphabet regardless of what you have typed.
 */
export class AirlineSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    input: HTMLInputElement,
    private isStarred: (value: string) => boolean,
    private onPick: (value: string) => void,
  ) {
    super(app, input);
  }

  protected getSuggestions(query: string): string[] {
    const labels = AIRLINES.map(airlineLabel);
    const matches = rank(labels, query, 40);
    const starred = matches.filter((m) => this.isStarred(m));
    const rest = matches.filter((m) => !this.isStarred(m));
    return [...starred, ...rest];
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    if (this.isStarred(value)) {
      const star = el.createSpan({ cls: "tp-suggest-star" });
      setIcon(star, "star");
    }
    el.createSpan({ text: value });
  }

  selectSuggestion(value: string): void {
    this.setValue(value);
    this.onPick(value);
    this.close();
  }
}

/** "Amsterdam (AMS)" — what the picker shows and what gets stored. */
export function airportLabel(a: AirportRecord): string {
  return `${a.c} (${a.i})`;
}

const AIRPORT_BY_IATA = new Map(AIRPORTS.map((a) => [a.i, a]));

/** Pulls the IATA code back out of a stored "City (XXX)" value. */
export function airportFromLabel(value: string): AirportRecord | null {
  const match = /\(([A-Za-z]{3})\)\s*$/.exec(value.trim());
  if (match) return AIRPORT_BY_IATA.get(match[1].toUpperCase()) ?? null;
  const bare = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(bare) ? (AIRPORT_BY_IATA.get(bare) ?? null) : null;
}

/**
 * Airport picker.
 *
 * Searches the code, the city and the airport's own name, because people reach
 * for whichever they remember — "AMS", "Amsterdam" and "Schiphol" all land on
 * the same row. Starred airports sit on top; you fly from the same one most
 * of the time.
 */
export class AirportSuggest extends AbstractInputSuggest<AirportRecord> {
  constructor(
    app: App,
    input: HTMLInputElement,
    private isStarred: (value: string) => boolean,
    private onPick: (value: string, airport: AirportRecord) => void,
    /** Where the trip is, so local airports come first instead of Aalborg. */
    private nearby?: () => { country: string; city: string },
  ) {
    super(app, input);
  }

  /** Trip city first, then trip country, then everywhere else. */
  private locality(a: AirportRecord): number {
    const near = this.nearby?.();
    if (!near) return 2;
    if (near.city && fold(a.c) === fold(near.city)) return 0;
    if (near.country && fold(a.y) === fold(near.country)) return 1;
    return 2;
  }

  protected getSuggestions(query: string): AirportRecord[] {
    const q = fold(query.trim());
    const starredFirst = (list: AirportRecord[]) => {
      const starred = list.filter((a) => this.isStarred(airportLabel(a)));
      const rest = list.filter((a) => !this.isStarred(airportLabel(a)));
      return [...starred, ...rest];
    };

    // With nothing typed, offer what is plausibly relevant rather than the
    // alphabetical head of a six-thousand-row list.
    if (!q) {
      const local = AIRPORTS.filter((a) => this.locality(a) < 2);
      const pool = local.length > 0 ? local : AIRPORTS.slice(0, 60);
      return starredFirst(pool).slice(0, 50);
    }

    // An exact code wins outright — "AMS" should never be buried under cities
    // that merely contain those letters.
    const exact = AIRPORT_BY_IATA.get(q.toUpperCase());
    const codePrefix: AirportRecord[] = [];
    const cityPrefix: AirportRecord[] = [];
    const cityContains: AirportRecord[] = [];
    const nameContains: AirportRecord[] = [];

    for (const a of AIRPORTS) {
      if (exact && a.i === exact.i) continue;
      const code = a.i.toLowerCase();
      const city = fold(a.c);
      if (code.startsWith(q)) codePrefix.push(a);
      else if (city.startsWith(q)) cityPrefix.push(a);
      else if (city.includes(q)) cityContains.push(a);
      else if (fold(a.n).includes(q)) nameContains.push(a);
      if (codePrefix.length + cityPrefix.length > 60) break;
    }

    const byLocality = (list: AirportRecord[]) =>
      [...list].sort((x, y) => this.locality(x) - this.locality(y));

    const ordered = [
      ...(exact ? [exact] : []),
      ...starredFirst(byLocality(cityPrefix)),
      ...byLocality(codePrefix),
      ...byLocality(cityContains),
      ...byLocality(nameContains),
    ];
    return ordered.slice(0, 50);
  }

  renderSuggestion(airport: AirportRecord, el: HTMLElement): void {
    if (this.isStarred(airportLabel(airport))) {
      setIcon(el.createSpan({ cls: "tp-suggest-star" }), "star");
    }
    el.createSpan({ cls: "tp-suggest-code", text: airport.i });
    el.createSpan({ text: ` ${airport.c}` });
    el.createSpan({ cls: "tp-suggest-hint", text: [airport.n, airport.y].filter(Boolean).join(" · ") });
  }

  selectSuggestion(airport: AirportRecord): void {
    const label = airportLabel(airport);
    this.setValue(label);
    this.onPick(label, airport);
    this.close();
  }
}

/** The country a city belongs to, used to auto-fill the country field. */
export function countryForCity(city: string): string | null {
  const needle = fold(city.trim());
  if (!needle) return null;
  for (const [country, cities] of Object.entries(CITIES)) {
    if (cities.some((c) => fold(c) === needle)) return country;
  }
  return null;
}
