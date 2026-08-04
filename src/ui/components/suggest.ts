import { AbstractInputSuggest, App, setIcon } from "obsidian";
import { COUNTRIES } from "../../data/countries";
import { AIRLINES, airlineLabel } from "../../data/airlines";
import { AIRPORTS, type AirportRecord } from "../../data/airports";
import { CITIES } from "../../data/cities";
import { foodSpots, type FoodSpotEntry } from "../../food/foodSpot";
import { flattenGroups, fold, rankMatches as rank } from "../../util/search";

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
      el.createSpan({ cls: "awty-suggest-hint", text: `${count} cities` });
    }
  }

  selectSuggestion(value: string): void {
    this.setValue(value);
    this.onPick(value);
    this.close();
  }
}

/**
 * Every city, ordered by how prominent it is inside its own country.
 *
 * Each country's list arrives population-descending, so an entry's index is a
 * usable stand-in for importance. Flattening country-by-country instead put the
 * whole of Afghanistan ahead of Amsterdam, which is how searching "a" with no
 * country selected returned Aïbak. Built once, on first use.
 */
/** A city and the country it is actually in, kept together. */
export interface CityHit {
  city: string;
  country: string;
}

let GLOBAL_CITIES: { value: string; group: string }[] | null = null;

function globalCities(): { value: string; group: string }[] {
  return (GLOBAL_CITIES ??= flattenGroups(CITIES));
}

export class CitySuggest extends AbstractInputSuggest<CityHit> {
  constructor(
    app: App,
    input: HTMLInputElement,
    private getCountry: () => string,
    private onPick: (value: string, country: string) => void,
    /** Searched first when no country is set — usually where you live. */
    private preferredCountry?: () => string,
  ) {
    super(app, input);
  }

  protected getSuggestions(query: string): CityHit[] {
    const country = this.getCountry();
    if (country) {
      return rank(CITIES[country] ?? [], query, 50).map((city) => ({ city, country }));
    }

    // No country chosen: offer the country you usually travel from first, then
    // the rest of the world by prominence. Each hit carries its own country,
    // so picking one of fourteen places called Victoria picks the right one.
    const preferred = this.preferredCountry?.() ?? "";
    const local = preferred
      ? rank(CITIES[preferred] ?? [], query, 12).map((city) => ({ city, country: preferred }))
      : [];
    const seen = new Set(local.map((h) => h.city));

    const names = globalCities();
    const byName = new Map<string, string[]>();
    for (const { value, group } of names) {
      const list = byName.get(value);
      if (list) list.push(group);
      else byName.set(value, [group]);
    }
    const global: CityHit[] = [];
    for (const city of rank([...byName.keys()], query, 40)) {
      if (seen.has(city)) continue;
      for (const country of byName.get(city) ?? []) global.push({ city, country });
    }
    return [...local, ...global].slice(0, 40);
  }

  renderSuggestion(hit: CityHit, el: HTMLElement): void {
    el.setText(hit.city);
    if (!this.getCountry()) {
      el.createSpan({ cls: "awty-suggest-hint", text: hit.country });
    }
  }

  selectSuggestion(hit: CityHit): void {
    this.setValue(hit.city);
    this.onPick(hit.city, hit.country);
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
      const star = el.createSpan({ cls: "awty-suggest-star" });
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

    // With nothing typed, narrow to the place in question rather than offering
    // the alphabetical head of a six-thousand-row list. A city with airports
    // wins outright; only when it has none do we widen to its country.
    if (!q) {
      const inCity = AIRPORTS.filter((a) => this.locality(a) === 0);
      if (inCity.length > 0) return starredFirst(inCity).slice(0, 50);
      const inCountry = AIRPORTS.filter((a) => this.locality(a) === 1);
      if (inCountry.length > 0) return starredFirst(inCountry).slice(0, 50);
      return starredFirst(AIRPORTS.slice(0, 60)).slice(0, 50);
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
      setIcon(el.createSpan({ cls: "awty-suggest-star" }), "star");
    }
    el.createSpan({ cls: "awty-suggest-code", text: airport.i });
    el.createSpan({ text: ` ${airport.c}` });
    el.createSpan({ cls: "awty-suggest-hint", text: [airport.n, airport.y].filter(Boolean).join(" · ") });
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

/**
 * Restaurants Food Spot already knows, so a booked table joins that record
 * rather than starting a second one under the same name.
 */
export class FoodSpotSuggest extends AbstractInputSuggest<FoodSpotEntry> {
  constructor(
    app: App,
    input: HTMLInputElement,
    private getCity: () => string,
    private onPick: (entry: FoodSpotEntry) => void,
  ) {
    super(app, input);
  }

  protected getSuggestions(query: string): FoodSpotEntry[] {
    const city = this.getCity();
    const all = foodSpots(this.app, city || undefined);
    const needle = fold(query.trim());
    const matches = needle ? all.filter((e) => fold(e.name).includes(needle)) : all;
    return matches.slice(0, 30);
  }

  renderSuggestion(entry: FoodSpotEntry, el: HTMLElement): void {
    el.setText(entry.name);
    const detail = [entry.address || entry.city].filter(Boolean).join(" · ");
    if (detail) el.createSpan({ cls: "awty-suggest-hint", text: detail });
  }

  selectSuggestion(entry: FoodSpotEntry): void {
    this.setValue(entry.name);
    this.onPick(entry);
    this.close();
  }
}
