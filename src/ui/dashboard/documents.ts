import { setIcon } from "obsidian";
import type { DashboardContext } from "./common";
import { sectionTitle } from "./common";
import { checkVisa, exceedsAllowance } from "../../travel/visa";
import { ADVICE_MEANING, adviceUrlFor, isStale } from "../../travel/advice";
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
  if (!trip || !trip.country) return;

  sectionTitle(parent, "Documents & advice", {
    label: "Check now",
    icon: "shield-check",
    onClick: () => void plugin.refreshAdvice(trip.country, ctx.refresh),
  });

  renderVisa(parent, ctx);
  renderAdvice(parent, ctx);

  parent.createDiv({
    cls: "tp-doc-caveat",
    text: "Guidance only — entry rules change without notice. Always confirm with the embassy or the official advice before you book.",
  });
}

function renderVisa(parent: HTMLElement, ctx: DashboardContext): void {
  const { trip, plugin } = ctx;
  if (!trip) return;

  // The trip's own passports win; settings are the fallback.
  const passports = (trip.passports.length > 0 ? trip.passports : plugin.settings.passportCountries)
    .filter(Boolean);
  if (passports.length === 0) {
    parent.createDiv({
      cls: "tp-dash-hint",
      text: "Set a passport on the trip, or in settings, to see entry requirements.",
    });
    return;
  }

  const tripDays = daysBetween(trip.startDate, trip.endDate);
  const list = parent.createDiv({ cls: "tp-doc-list-rows" });

  for (const passport of passports) {
    const check = checkVisa(passport, trip.country);
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

    const row = list.createDiv({ cls: `tp-doc-item is-${tone}` });
    setIcon(
      row.createDiv({ cls: "tp-doc-item-icon" }),
      tone === "good" ? "check-circle" : tone === "unknown" ? "help-circle" : "alert-triangle",
    );

    const body = row.createDiv({ cls: "tp-doc-item-body" });
    body.createDiv({ cls: "tp-doc-item-title", text: `${passport} passport → ${trip.country}` });
    body.createDiv({ cls: "tp-doc-item-detail", text: check.detail });

    if (tooLong) {
      body.createDiv({
        cls: "tp-doc-item-warn",
        text: `This trip is ${tripDays} days — longer than the ${check.days}-day allowance.`,
      });
    }

    row.createDiv({ cls: `tp-doc-badge is-${tone}`, text: check.label });
  }
}

function renderAdvice(parent: HTMLElement, ctx: DashboardContext): void {
  const { trip, plugin } = ctx;
  if (!trip || !plugin.settings.travelAdviceEnabled) return;

  // Missing or a day old: fetched once, quietly, in the background.
  plugin.ensureAdvice(trip.country, ctx.refresh);

  const url = adviceUrlFor(trip.country);
  const advice = plugin.peekAdvice(trip.country);
  const list = parent.createDiv({ cls: "tp-doc-list-rows" });

  if (!advice) {
    const row = list.createDiv({ cls: "tp-doc-item is-unknown" });
    setIcon(row.createDiv({ cls: "tp-doc-item-icon" }), "help-circle");
    const body = row.createDiv({ cls: "tp-doc-item-body" });
    body.createDiv({ cls: "tp-doc-item-title", text: "Dutch government travel advice" });
    body.createDiv({
      cls: "tp-doc-item-detail",
      text: url
        ? "Not checked yet — use Check now."
        : `No advice page is published for ${trip.country}.`,
    });
    if (url) appendLink(row, url);
    return;
  }

  const meaning = ADVICE_MEANING[advice.colour];
  const row = list.createDiv({ cls: `tp-doc-item is-advice-${advice.colour}` });
  setIcon(
    row.createDiv({ cls: "tp-doc-item-icon" }),
    advice.colour === "groen" ? "check-circle" : advice.colour === "rood" ? "octagon-x" : "alert-triangle",
  );

  const body = row.createDiv({ cls: "tp-doc-item-body" });
  body.createDiv({ cls: "tp-doc-item-title", text: `Travel advice: ${meaning.label}` });
  body.createDiv({ cls: "tp-doc-item-detail", text: meaning.detail });
  if (isStale(advice)) {
    // Advice more than a day old is not something to plan around.
    body.createDiv({ cls: "tp-doc-item-warn", text: "Over a day old — refreshing." });
  }

  row.createDiv({ cls: `tp-doc-badge is-advice-${advice.colour}`, text: meaning.label });
  appendLink(row, advice.url);
}

function appendLink(row: HTMLElement, url: string): void {
  const link = row.createEl("a", { cls: "tp-doc-link", href: url, attr: { target: "_blank" } });
  setIcon(link, "external-link");
  link.setAttribute("aria-label", "Open the official advice");
}
