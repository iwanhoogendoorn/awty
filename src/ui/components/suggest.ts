import { AbstractInputSuggest, App } from "obsidian";
import { COUNTRIES } from "../../data/countries";
import { CITIES } from "../../data/cities";

/**
 * Ranked filter shared by the country and city pickers: prefix matches first,
 * then word-start matches, then anything containing the query. The datasets are
 * already population-ordered, so ties keep the bigger place on top.
 */
function rank(items: readonly string[], query: string, limit = 50): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, limit);

  const prefix: string[] = [];
  const wordStart: string[] = [];
  const contains: string[] = [];

  for (const item of items) {
    const lower = item.toLowerCase();
    const at = lower.indexOf(q);
    if (at === -1) continue;
    if (at === 0) prefix.push(item);
    else if (lower[at - 1] === " " || lower[at - 1] === "-") wordStart.push(item);
    else contains.push(item);
    if (prefix.length >= limit) break;
  }

  return [...prefix, ...wordStart, ...contains].slice(0, limit);
}

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

/** The country a city belongs to, used to auto-fill the country field. */
export function countryForCity(city: string): string | null {
  const needle = city.trim().toLowerCase();
  if (!needle) return null;
  for (const [country, cities] of Object.entries(CITIES)) {
    if (cities.some((c) => c.toLowerCase() === needle)) return country;
  }
  return null;
}
