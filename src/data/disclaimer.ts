/**
 * The one place this is written down.
 *
 * Every screen that shows an entry requirement, and the document people take
 * with them, points at the same words — so the caveat cannot be current in one
 * place and stale in another.
 */

/** The short form, for under a section that shows requirements. */
export const DISCLAIMER_SHORT =
  "Guidance only, not immigration advice. Entry rules change without notice and depend on your passport, route and reason for travelling. Confirm every requirement with the embassy or the official government site before you book and again before you travel.";

/** The line that matters most: silence here is not an all-clear. */
export const DISCLAIMER_COVERAGE =
  "This plugin's checks are partial. A requirement it does not mention may still exist.";

/** The full text, for settings, the exported document and the readme. */
export const DISCLAIMER_FULL = [
  "Are We There Yet? is provided as is, without warranty of any kind, express or implied.",
  "",
  "Visa outcomes, entry requirements, arrival cards, travel advice and travel times are indicative only. They come from open datasets and public sources that may be incomplete, out of date, or wrong for your circumstances, and they are not immigration, legal, medical or financial advice.",
  "",
  "Entry rules change without notice and vary by passport, purpose of travel, route, transit points, length of stay and much else this plugin cannot know. The checks here cover a limited set of countries: if the plugin says nothing about a requirement, that is not confirmation that no requirement exists.",
  "",
  "You alone are responsible for verifying every visa, permit, arrival card, authorisation, passport validity and health requirement with the relevant embassy, consulate, airline or official government source, before booking and again before travelling.",
  "",
  "To the fullest extent permitted by law, the author accepts no liability for any loss, cost, expense, missed travel, denied boarding, denied entry, or other damage arising from use of, or reliance on, this plugin.",
].join("\n");

/** Where to actually check, since a disclaimer without a next step is a shrug. */
export const OFFICIAL_SOURCES: { label: string; url: string }[] = [
  { label: "Netherlands travel advice", url: "https://www.nederlandwereldwijd.nl/reisadvies" },
  { label: "IATA Travel Centre", url: "https://www.iatatravelcentre.com/" },
  { label: "UK travel advice", url: "https://www.gov.uk/foreign-travel-advice" },
];
