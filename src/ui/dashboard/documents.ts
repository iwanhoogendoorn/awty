import { setIcon } from "obsidian";
import type { DashboardContext } from "./common";
import { sectionTitle } from "./common";
import { checkVisa, exceedsAllowance } from "../../travel/visa";
import { ADVICE_MEANING, adviceUrlFor, isStale } from "../../travel/advice";
import { tripCountries } from "../../types";
import { daysBetween } from "../../util/dates";

/**
 * Entry requirements and the current government travel advice.
 *
 * Both are advisory. Visa rules move with politics and advice can change
 * overnight, so every row links to the authority rather than presenting itself
 * as the final word.
 */
export function renderDocuments(parent: HTMLElement, ctx: DashboardContext): void {
  const { trip, plugin } = ctx;
  if (!trip) return;

  // Every country the trip enters needs checking, not just the first: a visa
  // you do not need for Croatia you may well need for the next border.
  const countries = tripCountries(trip);
  if (countries.length === 0) return;

  sectionTitle(parent, "Documents & advice", {
    label: "Check now",
    icon: "shield-check",
    onClick: () => {
      for (const country of countries) void plugin.refreshAdvice(country, ctx.refresh);
    },
  });

  for (const country of countries) {
    if (countries.length > 1) {
      parent.createDiv({ cls: "awty-around-group", text: country });
    }
    renderVisa(parent, ctx, country);
    renderAdvice(parent, ctx, country);
  }

  parent.createDiv({
    cls: "awty-doc-caveat",
    text: "Guidance only — entry rules change without notice. Always confirm with the embassy or the official advice before you book.",
  });
}

function renderVisa(parent: HTMLElement, ctx: DashboardContext, country: string): void {
  const { trip, plugin } = ctx;
  if (!trip) return;

  // The trip's own passports win; settings are the fallback.
  const passports = (trip.passports.length > 0 ? trip.passports : plugin.settings.passportCountries)
    .filter(Boolean);
  if (passports.length === 0) {
    parent.createDiv({
      cls: "awty-dash-hint",
      text: "Set a passport on the trip, or in settings, to see entry requirements.",
    });
    return;
  }

  const tripDays = daysBetween(trip.startDate, trip.endDate);
  const list = parent.createDiv({ cls: "awty-doc-list-rows" });

  for (const passport of passports) {
    const check = checkVisa(passport, country);
    if (check.outcome === "same-country") continue;

    const tooLong = exceedsAllowance(check, tripDays);
    const tone =
      check.outcome === "no-admission"
        ? "bad"
        : check.actionNeeded || tooLong
          ? "warn"
          : check.outcome === "unknown"
            ? "unknown"
            : "good";

    const row = list.createDiv({ cls: `awty-doc-item is-${tone}` });
    setIcon(
      row.createDiv({ cls: "awty-doc-item-icon" }),
      tone === "good" ? "check-circle" : tone === "unknown" ? "help-circle" : "alert-triangle",
    );

    const body = row.createDiv({ cls: "awty-doc-item-body" });
    body.createDiv({ cls: "awty-doc-item-title", text: `${passport} passport → ${country}` });
    body.createDiv({ cls: "awty-doc-item-detail", text: check.detail });

    if (tooLong) {
      body.createDiv({
        cls: "awty-doc-item-warn",
        text: `This trip is ${tripDays} days — longer than the ${check.days}-day allowance.`,
      });
    }

    row.createDiv({ cls: `awty-doc-badge is-${tone}`, text: check.label });
  }
}

function renderAdvice(parent: HTMLElement, ctx: DashboardContext, country: string): void {
  const { trip, plugin } = ctx;
  if (!trip || !plugin.settings.travelAdviceEnabled) return;

  // Missing or a day old: fetched once, quietly, in the background.
  plugin.ensureAdvice(country, ctx.refresh);

  const url = adviceUrlFor(country);
  const advice = plugin.peekAdvice(country);
  const list = parent.createDiv({ cls: "awty-doc-list-rows" });

  if (!advice) {
    const row = list.createDiv({ cls: "awty-doc-item is-unknown" });
    setIcon(row.createDiv({ cls: "awty-doc-item-icon" }), "help-circle");
    const body = row.createDiv({ cls: "awty-doc-item-body" });
    body.createDiv({ cls: "awty-doc-item-title", text: "Dutch government travel advice" });
    body.createDiv({
      cls: "awty-doc-item-detail",
      text: url
        ? "Not checked yet — use Check now."
        : `No advice page is published for ${country}.`,
    });
    if (url) appendLink(row, url);
    return;
  }

  const meaning = ADVICE_MEANING[advice.colour];
  const row = list.createDiv({ cls: `awty-doc-item is-advice-${advice.colour}` });
  setIcon(
    row.createDiv({ cls: "awty-doc-item-icon" }),
    advice.colour === "groen" ? "check-circle" : advice.colour === "rood" ? "octagon-x" : "alert-triangle",
  );

  const body = row.createDiv({ cls: "awty-doc-item-body" });
  body.createDiv({ cls: "awty-doc-item-title", text: `Travel advice: ${meaning.label}` });
  body.createDiv({ cls: "awty-doc-item-detail", text: meaning.detail });
  if (isStale(advice)) {
    // Advice more than a day old is not something to plan around.
    body.createDiv({ cls: "awty-doc-item-warn", text: "Over a day old — refreshing." });
  }

  row.createDiv({ cls: `awty-doc-badge is-advice-${advice.colour}`, text: meaning.label });
  appendLink(row, advice.url);
}

function appendLink(row: HTMLElement, url: string): void {
  const link = row.createEl("a", { cls: "awty-doc-link", href: url, attr: { target: "_blank" } });
  setIcon(link, "external-link");
  link.setAttribute("aria-label", "Open the official advice");
}
