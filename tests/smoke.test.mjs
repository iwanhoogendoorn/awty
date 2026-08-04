/*
 * Bundles the pure modules with esbuild and asserts against them. These modules
 * import Obsidian only as types, so they run fine outside the app.
 *
 * Run with: node tests/smoke.test.mjs
 */
import assert from "node:assert/strict";
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const entry = `
export * from "./src/util/dates.ts";
export * from "./src/util/paths.ts";
export { foodSpotBlock } from "./src/store/templates.ts";
export { analyseNote } from "./src/store/noteProgress.ts";
export { emptyDayDates, readDaySections } from "./src/store/itinerary.ts";
export { routeTitle, layoverMinutes, formatLayover, totalJourneyMinutes, splitJourney } from "./src/bookings/legs.ts";
export { parseConfirmation, parseIcs, parseConfirmationText, parseLooseDate } from "./src/flights/parseConfirmation.ts";
export { splitFlightNumber } from "./src/flights/flightNumber.ts";
export { parseLegTable } from "./src/bookings/legTable.ts";
export { renderTripDocument, escapeHtml } from "./src/export/tripDocument.ts";
export { decodeQuotedPrintable, extractIcsFromEmail } from "./src/flights/parseConfirmation.ts";
export { fold, rankMatches, flattenByRank, flattenGroups, replaceLastToken } from "./src/util/search.ts";
export { checkVisa, iso2ForCountry, exceedsAllowance } from "./src/travel/visa.ts";
export { allCategories, COST_CATEGORIES, BOOKING_KINDS } from "./src/bookings/types.ts";
export { CREATABLE_SUB_NOTES, SUB_NOTE_LABELS, KINDS } from "./src/types.ts";
export { parseAdviceColour, adviceUrlFor, isStale, ADVICE_TTL_MS } from "./src/travel/adviceData.ts";
export { AIRPORTS } from "./src/data/airports.ts";
export { AIRLINES, airlineLabel } from "./src/data/airlines.ts";
export { buildPackingPlan, effectiveDays, renderPackingPlan, readPackingExtras } from "./src/store/packing.ts";
export { parseAmount, formatMoney, sumMoney, formatTotals } from "./src/util/money.ts";
export {
  parseLocation,
  formatLocation,
  coordKey,
  legKey,
  formatDuration as formatTravelDuration,
  formatDistance,
} from "./src/travel/types.ts";
export { COUNTRIES, FOODSPOT_COUNTRIES } from "./src/data/countries.ts";
export { CITIES } from "./src/data/cities.ts";
export { dayEvents, ongoingOn, BAND } from "./src/store/dayPlan.ts";
export { itineraryPairs, groupByOrigin } from "./src/travel/routePlan.ts";
export { readLegs, summariseFlight } from "./src/bookings/flightSummary.ts";
export { renderMarkdown, stripFrontmatter } from "./src/export/markdown.ts";
export { customSections, customParts, weaveKept, sectionText } from "./src/bookings/noteSections.ts";
export { bookingBody, expenseBody } from "./src/bookings/noteBody.ts";
export { budgetPlanTable, budgetLinesTable } from "./src/bookings/budgetTables.ts";
export { readLegacyFoodTable } from "./src/bookings/legacyFood.ts";
export { tripKml, directionsLink, placeLink, MAX_WAYPOINTS } from "./src/export/mapsExport.ts";
export { looksLikeMoreJourneys } from "./src/bookings/legs.ts";
export { zoneForAirport, utcToLocal, localiseLegs } from "./src/flights/localTime.ts";
export { linkTarget } from "./src/bookings/linkTarget.ts";
`;

const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tp-test-")), "bundle.mjs");

await esbuild.build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2020",
  external: ["obsidian"],
  outfile,
  logLevel: "error",
});

const m = await import(outfile);

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

// ------------------------------------------------------------------- dates

test("rejects impossible dates", () => {
  assert.equal(m.isValidISODate("2026-02-31"), false);
  assert.equal(m.isValidISODate("2026-13-01"), false);
  assert.equal(m.isValidISODate("14-08-2026"), false);
  assert.equal(m.isValidISODate(""), false);
  assert.equal(m.isValidISODate("2026-08-14"), true);
  assert.equal(m.isValidISODate("2028-02-29"), true); // leap year
});

test("addDays survives the DST boundary", () => {
  // Europe/Amsterdam springs forward on 2026-03-29. A local-time Date would
  // land back on the 29th here.
  assert.equal(m.addDays("2026-03-28", 1), "2026-03-29");
  assert.equal(m.addDays("2026-03-29", 1), "2026-03-30");
  assert.equal(m.addDays("2026-10-24", 1), "2026-10-25");
  assert.equal(m.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(m.addDays("2026-03-01", -1), "2026-02-28");
});

test("duration shortcuts are inclusive", () => {
  assert.equal(m.endDateForDuration("2026-08-14", 1), "2026-08-14");
  assert.equal(m.endDateForDuration("2026-08-14", 7), "2026-08-20");
  assert.equal(m.endDateForDuration("2026-08-14", 14), "2026-08-27");
  assert.equal(m.daysBetween("2026-08-14", "2026-08-20"), 7);
  assert.equal(m.nightsBetween("2026-08-14", "2026-08-20"), 6);
});

test("status classifies against a real date, not a string sort", () => {
  const today = "2026-08-14";
  assert.equal(m.tripStatus("2026-08-01", "2026-08-10", today), "past");
  assert.equal(m.tripStatus("2026-08-10", "2026-08-20", today), "current");
  assert.equal(m.tripStatus("2026-08-14", "2026-08-14", today), "current");
  assert.equal(m.tripStatus("2026-09-01", "2026-09-10", today), "upcoming");
  // A trip with no dates must not be silently filed as past.
  assert.equal(m.tripStatus("", "", today), "upcoming");
  assert.equal(m.tripStatus("not a date", "", today), "upcoming");
});

test("formats ranges compactly", () => {
  assert.equal(m.formatDateRange("2026-08-14", "2026-08-21"), "14 – 21 Aug 2026");
  assert.equal(m.formatDateRange("2026-08-14", "2026-08-14"), "14 Aug 2026");
  assert.equal(m.formatDateRange("2026-12-28", "2027-01-03"), "28 Dec 2026 – 3 Jan 2027");
  assert.equal(m.formatDuration("2026-08-14", "2026-08-20"), "7 days, 6 nights");
  assert.equal(m.formatDuration("2026-08-14", "2026-08-14"), "1 day");
});

test("datesInRange is inclusive and capped", () => {
  assert.deepEqual(m.datesInRange("2026-08-14", "2026-08-16"), [
    "2026-08-14",
    "2026-08-15",
    "2026-08-16",
  ]);
  assert.equal(m.datesInRange("2026-01-01", "2030-01-01").length, 400);
});

// ------------------------------------------------------------------- paths

test("sanitises names that broke 1.x", () => {
  assert.equal(m.sanitizeName('Côte d\'Azur "the nice bit"'), "Côte d'Azur -the nice bit-");
  assert.equal(m.sanitizeName("Tokyo/Kyoto"), "Tokyo-Kyoto");
  assert.equal(m.sanitizeName("  spaced  out  "), "spaced out");
  assert.equal(m.sanitizeName("..."), "Untitled");
  assert.equal(m.sanitizeName(""), "Untitled");
});

test("folder pattern keeps slashes as folders but not inside values", () => {
  const vars = {
    year: "2026",
    month: "08",
    start: "2026-08-14",
    end: "2026-08-21",
    title: "Japan/Korea 2026",
    city: "Tokyo",
    country: "Japan",
    kind: "holiday",
  };
  assert.equal(
    m.expandFolderPattern("{year}/{start} {title}", vars),
    "2026/2026-08-14 Japan-Korea 2026",
  );
  assert.equal(m.expandFolderPattern("{country}/{city}", vars), "Japan/Tokyo");
  // An unknown placeholder is left alone rather than silently blanked.
  assert.match(m.expandFolderPattern("{nope}", vars), /nope/);
});

// ---------------------------------------------------------------- datasets

test("country dataset matches Food Spot's spellings", () => {
  assert.ok(m.FOODSPOT_COUNTRIES.has("Netherlands"));
  assert.ok(m.FOODSPOT_COUNTRIES.has("Turkey"), "Food Spot says Turkey, not Türkiye");
  assert.ok(m.FOODSPOT_COUNTRIES.has("Czechia"), "Food Spot says Czechia");
  assert.ok(m.FOODSPOT_COUNTRIES.has("Cape Verde"), "Food Spot says Cape Verde");
  assert.equal(m.FOODSPOT_COUNTRIES.size, 174);
  // The picker supersets Food Spot so you can still plan a trip it can't file.
  assert.ok(m.COUNTRIES.includes("Puerto Rico"));
  assert.equal(m.FOODSPOT_COUNTRIES.has("Puerto Rico"), false);
});

test("cities are population-ordered and reachable", () => {
  assert.equal(m.CITIES["Netherlands"][0], "Amsterdam");
  assert.equal(m.CITIES["Japan"][0], "Tokyo");
  assert.ok(m.CITIES["Turkey"].includes("Istanbul"));
  assert.ok(m.CITIES["Czechia"].includes("Prague"));
  const total = Object.values(m.CITIES).reduce((n, list) => n + list.length, 0);
  assert.ok(total > 100000, `expected >100000 cities, got ${total}`);
});

test("small tourist towns are selectable", () => {
  // A population floor is the wrong filter for travel: every one of these sits
  // below 30k and a 100k cut-off silently hid the lot.
  const probes = [
    ["Croatia", "Dubrovnik"],
    ["Italy", "Positano"],
    ["Netherlands", "Giethoorn"],
    ["Switzerland", "Zermatt"],
    ["Slovenia", "Bled"],
    ["Portugal", "Sintra"],
    ["Greece", "Oía"],
  ];
  for (const [country, city] of probes) {
    assert.ok(
      (m.CITIES[country] ?? []).includes(city),
      `${city} must be selectable in ${country}`,
    );
  }
  assert.ok(m.CITIES["Croatia"].length > 500, "Croatia should have far more than 3 cities");
});

// -------------------------------------------------------------- food spot

const ctx = (draft) => ({
  draft: { country: "", city: "", ...draft },
  settings: { foodSpotView: "cards" },
});

test("foodspot block emits keys Food Spot actually parses", () => {
  const block = m.foodSpotBlock(ctx({ country: "Japan", city: "Tokyo" }));
  assert.equal(
    block,
    ["```foodspot", "view: cards", "country: Japan", "city: Tokyo", "status: want-to-try", "```"].join(
      "\n",
    ),
  );
});

test("foodspot block omits countries Food Spot cannot match", () => {
  const block = m.foodSpotBlock(ctx({ country: "Puerto Rico", city: "San Juan" }));
  assert.ok(!block.includes("country:"), "unmatched country must not be emitted");
  assert.ok(block.includes("city: San Juan"));
});

test("foodspot block copes with a city but no country", () => {
  const block = m.foodSpotBlock(ctx({ city: "Ghent" }));
  assert.ok(block.includes("city: Ghent"));
  assert.ok(!block.includes("country:"));
});

// --------------------------------------------------------------- search

test("search ignores accents in both directions", () => {
  // GeoNames stores the local spelling; nobody types the accents.
  assert.deepEqual(m.rankMatches(["Oía"], "Oia"), ["Oía"]);
  assert.deepEqual(m.rankMatches(["İzmir"], "izmir"), ["İzmir"]);
  assert.deepEqual(m.rankMatches(["Malmö"], "malmo"), ["Malmö"]);
  assert.deepEqual(m.rankMatches(["Reykjavík"], "reykjavik"), ["Reykjavík"]);
  assert.deepEqual(m.rankMatches(["Łódź"], "lodz"), ["Łódź"]);
  assert.deepEqual(m.rankMatches(["Curaçao"], "curacao"), ["Curaçao"]);
  // And the accented spelling still finds itself.
  assert.deepEqual(m.rankMatches(["Oía"], "Oía"), ["Oía"]);
});

test("search ranks prefix, then word-start, then substring", () => {
  const items = ["New Orleans", "Orlando", "York", "New York"];
  // Orlando starts with it; "New Orleans" has it at a word start; York and
  // "New York" only contain it mid-word.
  assert.deepEqual(m.rankMatches(items, "or"), ["Orlando", "New Orleans", "York", "New York"]);
});

test("the real Greek dataset is reachable by ASCII typing", () => {
  const hits = m.rankMatches(m.CITIES["Greece"], "oia");
  assert.ok(hits.includes("Oía"), `expected Oía in ${JSON.stringify(hits.slice(0, 5))}`);
});

// ------------------------------------------------------------- progress

test("a generated packing list counts as started, and reports nothing packed", () => {
  // Deliberately not "empty": the list existing is the planning step being
  // done. Ticking things off happens the night before you leave.
  const p = m.analyseNote(
    "packing",
    "---\ntype: packing-list\n---\n\n# Packing List\n\n## Documents\n- [ ] Passport / ID\n- [ ] Visa\n",
  );
  assert.equal(p.state, "started");
  assert.equal(p.detail, "0/2 packed");
  assert.equal(p.ratio, 0);
});

test("packing progress counts ticked boxes", () => {
  const p = m.analyseNote("packing", "# P\n\n- [x] Passport\n- [x] Socks\n- [ ] Charger\n");
  assert.equal(p.state, "started");
  assert.equal(p.detail, "2/3 packed");
  const done = m.analyseNote("packing", "# P\n\n- [x] Passport\n- [x] Socks\n");
  assert.equal(done.state, "complete");
});

test("itinerary reports days actually planned", () => {
  const body = [
    "# Itinerary",
    "",
    "## 2026-08-17",
    "",
    "### Morning",
    "Walk the old city walls",
    "",
    "## 2026-08-18",
    "",
    "### Morning",
    "",
    "### Afternoon",
    "",
  ].join("\n");
  const p = m.analyseNote("itinerary", body);
  assert.equal(p.detail, "1/2 days planned");
  assert.equal(p.state, "started");
});

test("empty template tables do not count as content", () => {
  const empty = m.analyseNote(
    "accommodation",
    "# Accommodation\n\n| Check-in | Property |\n|----------|----------|\n|          |          |\n",
  );
  assert.equal(empty.state, "empty");

  const filled = m.analyseNote(
    "accommodation",
    "# Accommodation\n\n| Check-in | Property |\n|----------|----------|\n| 2026-08-17 | Hotel Excelsior |\n",
  );
  assert.equal(filled.state, "complete");
  assert.equal(filled.detail, "1 booking");
});

test("a second table's header is not a booking", () => {
  // The note ships with an empty template table and gains a generated Bookings
  // table underneath. Knocking one header off the grand total left the other
  // one counted, so a single stay reported as two.
  const note = [
    "# Accommodation",
    "",
    "| Check-in | Check-out | Property |",
    "|----------|-----------|----------|",
    "|          |           |          |",
    "",
    "## Bookings",
    "",
    "| When | Booking | Cost |",
    "|---|---|---|",
    "| 2026-08-17 → 2026-08-24 | Rausion Luxury Apartments | €1,456 |",
  ].join("\n");
  const p = m.analyseNote("accommodation", note);
  assert.equal(p.detail, "1 booking");
  assert.equal(p.state, "complete");
});

test("a list note with entries is done, not eternally in progress", () => {
  // Amber forever meant the dashboard could never read as finished, however
  // much of the trip was actually booked.
  const rows = m.analyseNote("transport", "# Transport\n\n| Leg | When |\n|---|---|\n| Ferry | Tue |\n");
  assert.equal(rows.state, "complete");
  assert.equal(rows.detail, "1 leg");

  const prose = m.analyseNote("budget", "# Budget\n\nRough guess: about a thousand each.\n");
  assert.equal(prose.state, "started", "words alone are a start, not a list");
});

test("a foodspot embed is the food note finished, not started", () => {
  const p = m.analyseNote("food", "# Food\n\n```foodspot\nview: cards\ncity: Dubrovnik\n```\n");
  assert.equal(p.state, "complete");
  assert.equal(p.detail, "Food Spot embed");
});

test("blockquote callouts and italic placeholders are not content", () => {
  const p = m.analyseNote(
    "budget",
    "# Budget\n\n> **When:** 17 Aug\n\n_Add trip overview here._\n",
  );
  assert.equal(p.state, "empty");
});

test("a countryless city search surfaces real places, not Afghan villages", () => {
  // Flattening country-by-country put all of Afghanistan ahead of Amsterdam, so
  // typing "a" with no country selected returned Aïbak and Andkhōy.
  const global = m.flattenByRank(m.CITIES);
  const hits = m.rankMatches(global, "amster", 10);
  assert.equal(hits[0], "Amsterdam");

  const a = m.rankMatches(global, "a", 20);
  assert.ok(
    a.some((city) => ["Amsterdam", "Athens", "Ankara", "Auckland", "Atlanta"].includes(city)),
    `expected a major city near the top, got ${JSON.stringify(a.slice(0, 8))}`,
  );
  // Each country's capital-ish first entry outranks the tail of any other.
  const firsts = new Set(Object.values(m.CITIES).map((list) => list[0]));
  assert.ok(firsts.has(global[0]), "the very first entry should be a country's largest city");
});

test("picking a suggestion replaces what was typed, not appends to it", () => {
  // Typing "net" then picking Netherlands produced "net, Netherlands".
  assert.deepEqual(m.replaceLastToken("net", "Netherlands"), ["Netherlands"]);
  assert.deepEqual(m.replaceLastToken("Netherlands, ger", "Germany"), ["Netherlands", "Germany"]);
  assert.deepEqual(m.replaceLastToken("", "Netherlands"), ["Netherlands"]);
  // The same country twice is one passport.
  assert.deepEqual(m.replaceLastToken("Netherlands, neth", "Netherlands"), ["Netherlands"]);
  assert.deepEqual(m.replaceLastToken("netherlands, x", "Netherlands"), ["netherlands"]);
});

// ------------------------------------------------------------------ visa

test("visa rules resolve for a Dutch passport", () => {
  assert.equal(m.iso2ForCountry("Netherlands"), "NL");
  assert.equal(m.iso2ForCountry("Croatia"), "HR");

  const eu = m.checkVisa("Netherlands", "Croatia");
  assert.equal(eu.outcome, "visa-free");
  assert.equal(eu.actionNeeded, false);

  const usa = m.checkVisa("Netherlands", "United States");
  assert.ok(["eta", "visa-required", "e-visa"].includes(usa.outcome), usa.outcome);
  assert.equal(usa.actionNeeded, true, "ESTA is something you must do before flying");

  const home = m.checkVisa("Netherlands", "Netherlands");
  assert.equal(home.outcome, "same-country");
});

test("each outcome reads as a sentence", () => {
  // One template produced "does not need no visa needed for Croatia".
  const free = m.checkVisa("Netherlands", "Croatia");
  assert.equal(/does not need no/.test(free.detail), false, free.detail);
  assert.match(free.detail, /Netherlands passport allows up to \d+ days|needs no visa/);

  for (const destination of ["United States", "India", "China", "Brazil", "Japan"]) {
    const check = m.checkVisa("Netherlands", destination);
    assert.equal(/\bnot need no\b|\bneeds no visa needed\b/.test(check.detail), false, check.detail);
    assert.ok(check.detail.endsWith("."), `not a sentence: ${check.detail}`);
  }
});

test("an unknown combination says so rather than implying it is fine", () => {
  const check = m.checkVisa("Atlantis", "Croatia");
  assert.equal(check.outcome, "unknown");
  assert.equal(check.actionNeeded, false);
  assert.match(check.detail, /No visa data/);
});

test("a trip longer than the visa-free allowance is flagged", () => {
  const allowance = { days: 90, outcome: "visa-free" };
  assert.equal(m.exceedsAllowance(allowance, 30), false);
  assert.equal(m.exceedsAllowance(allowance, 120), true);
  // No stated allowance cannot be exceeded.
  assert.equal(m.exceedsAllowance({ days: null }, 400), false);
});

// ---------------------------------------------------------- travel advice

test("the colour code is read from the ministry's own wording", () => {
  const page = "<p>De kleurcode van het reisadvies voor Kroati\u00eb is groen. U kunt erheen.</p>";
  assert.equal(m.parseAdviceColour(page), "groen");
  assert.equal(
    m.parseAdviceColour("kleurcode van het reisadvies voor Oekra\u00efne is rood."),
    "rood",
  );
  // Unrecognised wording returns null rather than a guess.
  assert.equal(m.parseAdviceColour("<p>Niets aan de hand hier.</p>"), null);
});

test("advice URLs use the Dutch slug, and only where one exists", () => {
  assert.equal(m.adviceUrlFor("Croatia"), "https://www.nederlandwereldwijd.nl/reisadvies/kroatie");
  assert.equal(
    m.adviceUrlFor("United States"),
    "https://www.nederlandwereldwijd.nl/reisadvies/verenigde-staten-van-amerika",
  );
  assert.equal(m.adviceUrlFor("Nowhereland"), null);
});

test("advice older than a day is treated as stale", () => {
  const now = 1_000_000_000_000;
  assert.equal(m.isStale({ fetchedAt: now - 1000 }, now), false);
  assert.equal(m.isStale({ fetchedAt: now - m.ADVICE_TTL_MS - 1 }, now), true);
});

// ------------------------------------------------------------- airports

test("airports carry usable coordinates, so flights need no geocoding", () => {
  const byIata = new Map(m.AIRPORTS.map((a) => [a.i, a]));
  const ams = byIata.get("AMS");
  assert.equal(ams.c, "Amsterdam");
  assert.equal(ams.y, "Netherlands");
  assert.ok(Math.abs(ams.a - 52.3086) < 0.01, `latitude was ${ams.a}`);
  assert.ok(Math.abs(ams.o - 4.7639) < 0.01, `longitude was ${ams.o}`);

  for (const code of ["DBV", "JFK", "NRT", "LHR", "DXB"]) {
    const a = byIata.get(code);
    assert.ok(a, `${code} missing`);
    assert.ok(Math.abs(a.a) <= 90 && Math.abs(a.o) <= 180, `${code} has impossible coordinates`);
  }
  assert.ok(m.AIRPORTS.length > 5000, `expected >5000 airports, got ${m.AIRPORTS.length}`);
});

test("every airport code is a unique three-letter IATA", () => {
  const seen = new Set();
  for (const a of m.AIRPORTS) {
    assert.match(a.i, /^[A-Z]{3}$/, `bad code ${a.i}`);
    assert.ok(!seen.has(a.i), `duplicate code ${a.i}`);
    seen.add(a.i);
  }
});

test("airlines are searchable by name and by code", () => {
  const labels = m.AIRLINES.map(m.airlineLabel);
  assert.ok(labels.includes("KLM (KL)"));
  assert.deepEqual(m.rankMatches(labels, "KLM"), ["KLM (KL)"]);
  assert.ok(m.rankMatches(labels, "transavia").includes("Transavia (HV)"));
});

// --------------------------------------------------------- attachments

test("clipboard names are recognised as generic, real filenames are not", () => {
  // Named exports would need a DOM to test the field itself, so this pins the
  // rule the naming depends on.
  const isGeneric = (name) =>
    !name || /^image\.\w+$/i.test(name) || /^(pasted|screenshot|clipboard)/i.test(name);

  assert.equal(isGeneric("image.png"), true);
  assert.equal(isGeneric(""), true);
  assert.equal(isGeneric("Screenshot 2026-08-04 at 13.22.png"), true);
  assert.equal(isGeneric("pasted-1.png"), true);
  // A real document dragged from Finder keeps its own name.
  assert.equal(isGeneric("KL1885-boarding-pass.pdf"), false);
  assert.equal(isGeneric("Hotel Excelsior confirmation.pdf"), false);
});

// ------------------------------------------------------------- itinerary

test("a generated day with only sub-headings counts as unplanned", () => {
  // Trips ship with a heading per day, which made "add day" reject every date
  // of the trip while the counter still read 0/8.
  const note = [
    "# Itinerary",
    "",
    "## 2026-08-17",
    "",
    "### Morning",
    "",
    "### Afternoon",
    "",
    "## 2026-08-18",
    "",
    "### Morning",
    "Walk the walls",
    "",
  ].join("\n");

  const empty = m.emptyDayDates(note);
  assert.equal(empty.has("2026-08-17"), true, "scaffolding is not a plan");
  assert.equal(empty.has("2026-08-18"), false, "a day with content is planned");
});

test("a day's own prose is read back, but generated links are not", () => {
  // Re-saving a day replaces it, so anything typed straight into the note has
  // to survive the round trip; the activity links are rebuilt from bookings.
  const note = [
    "# Itinerary",
    "",
    "## 2026-08-17",
    "",
    "### Morning",
    "- [[Old town walls walk]]",
    "Breakfast at the apartment",
    "",
    "### Afternoon",
    "- [[Shopping]]",
    "",
    "### Evening",
    "Drinks on the terrace",
    "",
    "## 2026-08-18",
    "",
    "### Morning",
    "Different day, must not leak",
    "",
  ].join("\n");

  // Only links naming a real activity are the plugin's to rebuild.
  const generated = new Set(["Old town walls walk", "Shopping"]);
  const day = m.readDaySections(note, "2026-08-17", generated);
  assert.equal(day.morning, "Breakfast at the apartment");
  assert.equal(day.afternoon, "", "a slot with only generated links has no prose");
  assert.equal(day.evening, "Drinks on the terrace");

  assert.equal(
    m.readDaySections(note, "2026-08-18", generated).morning,
    "Different day, must not leak",
  );
  assert.equal(m.readDaySections(note, "2026-08-19", generated).morning, "", "an absent day is empty");
});

test("re-planning a day keeps its shape and its hand-written links", () => {
  // Every line was trimmed, every blank line dropped, and every standalone
  // "- [[link]]" deleted as though the plugin had written it.
  const note = [
    "## 2026-08-17",
    "",
    "### Morning",
    "Two things to sort:",
    "",
    "  - ferry tickets",
    "  - cash for the cable car",
    "",
    "- [[Personal note]]",
    "- [[Old town walls walk]]",
    "",
  ].join("\n");
  const day = m.readDaySections(note, "2026-08-17", new Set(["Old town walls walk"]));
  assert.match(day.morning, /^Two things to sort:\n\n {2}- ferry tickets/, day.morning);
  assert.match(day.morning, /- \[\[Personal note\]\]/, "a hand-written link is not generated");
  assert.ok(!day.morning.includes("Old town walls walk"), "the activity link is rebuilt");
});

test("packing counts as done once the list exists", () => {
  // A saved list showing 0/38 was reported as empty, so the step stayed red
  // immediately after saving it.
  const list = "# Packing\n\n## Clothes\n- [ ] Socks ×8\n- [ ] Underwear ×8\n";
  const p = m.analyseNote("packing", list);
  assert.equal(p.state, "started");
  assert.equal(p.detail, "0/2 packed");
  // A note with no list at all is still genuinely empty.
  assert.equal(m.analyseNote("packing", "# Packing\n\nnothing here\n").state, "empty");
});

// ------------------------------------------------------- confirmations

test("dates parse in the shapes airlines actually send", () => {
  assert.equal(m.parseLooseDate("2026-08-17"), "2026-08-17");
  assert.equal(m.parseLooseDate("17 Aug 2026"), "2026-08-17");
  assert.equal(m.parseLooseDate("Aug 17, 2026"), "2026-08-17");
  assert.equal(m.parseLooseDate("17/08/2026"), "2026-08-17");
  // Day-first, because European confirmations far outnumber American ones.
  assert.equal(m.parseLooseDate("08/09/2026"), "2026-09-08");
  assert.equal(m.parseLooseDate("17 Aug", 2026), "2026-08-17");
  assert.equal(m.parseLooseDate("nothing here"), null);
  assert.equal(m.parseLooseDate("31 Feb 2026"), null, "impossible dates are rejected");
});

test("an airline calendar invite parses exactly", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "SUMMARY:Flight KL1885 AMS - DBV",
    "DTSTART:20260817T101500",
    "DTEND:20260817T123500",
    "LOCATION:Amsterdam Airport Schiphol",
    "DESCRIPTION:Booking reference: ABC123",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "SUMMARY:Flight KL1886 DBV - AMS",
    "DTSTART:20260824T133000",
    "DTEND:20260824T160500",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const parsed = m.parseConfirmation(ics);
  assert.equal(parsed.source, "ics");
  assert.equal(parsed.legs.length, 2);
  assert.deepEqual(
    { ...parsed.legs[0] },
    {
      operator: "",
      number: "KL1885",
      from: "AMS",
      to: "DBV",
      date: "2026-08-17",
      depTime: "10:15",
      arrDate: "2026-08-17",
      arrTime: "12:35",
    },
  );
  assert.equal(parsed.legs[1].number, "KL1886");
  assert.equal(parsed.reference, "ABC123");
});

test("folded calendar lines are rejoined before parsing", () => {
  // RFC 5545 folds long lines; not unfolding them loses the airport pair.
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "SUMMARY:Flight KL1885 AMS",
    " - DBV",
    "DTSTART:20260817T101500",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const parsed = m.parseIcs(ics);
  assert.equal(parsed.legs[0].from, "AMS");
  assert.equal(parsed.legs[0].to, "DBV");
});

test("a pasted confirmation yields legs, reference and total", () => {
  const email = [
    "Your booking is confirmed.",
    "Booking reference: XY7K2Q",
    "",
    "17 Aug 2026   KL1885   AMS - DBV   10:15   12:35",
    "24 Aug 2026   KL1886   DBV - AMS   13:30   16:05",
    "",
    "Total paid: EUR 827,50",
  ].join("\n");

  const parsed = m.parseConfirmation(email);
  assert.equal(parsed.source, "text");
  assert.equal(parsed.legs.length, 2);
  assert.equal(parsed.legs[0].number, "KL1885");
  assert.equal(parsed.legs[0].date, "2026-08-17");
  assert.equal(parsed.legs[0].depTime, "10:15");
  assert.equal(parsed.legs[0].arrTime, "12:35");
  assert.equal(parsed.legs[1].to, "AMS");
  assert.equal(parsed.reference, "XY7K2Q");
  assert.equal(parsed.amount, 827.5);
  assert.equal(parsed.currency, "EUR");
});

test("12-hour times are converted, and prose is not mistaken for a flight", () => {
  const email = "Depart 5 Sep 2026 BA0430 LHR - AMS 7:45 pm to 10:05 pm";
  const parsed = m.parseConfirmationText(email);
  assert.equal(parsed.legs[0].depTime, "19:45");
  assert.equal(parsed.legs[0].arrTime, "22:05");

  // A line has to carry both a flight number and an airport pair.
  assert.equal(m.parseConfirmationText("Thanks for flying with us. See you soon!"), null);
  assert.equal(m.parseConfirmationText("Your reference is ABC123"), null);
});

test("raw email encoding is undone before parsing", () => {
  // Saving an email gives quoted-printable source, where a soft break splits a
  // flight number across two lines and the parser would see nothing.
  const raw = "17 Aug 2026   KL18=\n85   AMS - DBV   10:15   12:35";
  assert.equal(m.decodeQuotedPrintable(raw), "17 Aug 2026   KL1885   AMS - DBV   10:15   12:35");
  assert.equal(m.decodeQuotedPrintable("caf=C3=A9"), "caf=C3=A9", "non-ASCII bytes are left alone");
  assert.equal(m.decodeQuotedPrintable("Total: =E2=82=AC827"), "Total: =E2=82=AC827");
  assert.equal(m.decodeQuotedPrintable("nothing encoded"), "nothing encoded");

  const parsed = m.parseConfirmation(raw);
  assert.equal(parsed.legs.length, 1);
  assert.equal(parsed.legs[0].number, "KL1885");
});

test("a calendar invite attached to an email is decoded out of it", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "SUMMARY:Flight KL1885 AMS - DBV",
    "DTSTART:20260817T101500",
    "DTEND:20260817T123500",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const email = [
    "Subject: Your booking",
    "Content-Type: text/calendar; method=REQUEST",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(ics, "utf8").toString("base64"),
  ].join("\r\n");

  assert.ok(m.extractIcsFromEmail(email).includes("BEGIN:VCALENDAR"));
  const parsed = m.parseConfirmation(email);
  assert.equal(parsed.source, "ics");
  assert.equal(parsed.legs[0].number, "KL1885");
  assert.equal(parsed.legs[0].depTime, "10:15");
});

test("flight numbers split into carrier and number", () => {
  assert.deepEqual(m.splitFlightNumber("KL1885"), { carrier: "KL", number: "1885" });
  assert.deepEqual(m.splitFlightNumber("kl 1885"), { carrier: "KL", number: "1885" });
  // Carriers with a digit in the code are real: U2 is easyJet, 6E is IndiGo.
  assert.deepEqual(m.splitFlightNumber("U21234"), { carrier: "U2", number: "1234" });
  assert.deepEqual(m.splitFlightNumber("6E77"), { carrier: "6E", number: "77" });
  assert.equal(m.splitFlightNumber("nonsense"), null);
  assert.equal(m.splitFlightNumber("1885"), null);
});

// ---------------------------------------------------------------- flights

test("route titles describe the journey, not the first keystroke", () => {
  const leg = (from, to) => ({ operator: "", number: "", from, to, date: "", depTime: "", arrDate: "", arrTime: "" });
  assert.equal(m.routeTitle([leg("AMS", "DBV")]), "AMS → DBV");
  assert.equal(m.routeTitle([leg("AMS", "IST"), leg("IST", "DBV")]), "AMS → DBV via IST");
  assert.equal(m.routeTitle([]), "");
});

test("the outbound arrival is recoverable from the note's own table", () => {
  // Verbatim from a booking saved before direct flights stored their legs: the
  // arrival existed only here, which is why the journey showed a dash.
  const note = [
    "# Amsterdam (AMS) ⇄ Dubrovnik (DBV)",
    "",
    "## Outbound",
    "",
    "| Leg | Airline | Flight | From | To | Departs | Arrives |",
    "|---|---|---|---|---|---|---|",
    "| 1 | KLM (KL) | KL1977 | Amsterdam (AMS) | Dubrovnik (DBV) | 2026-08-17 10:15 | 12:35 |",
    "",
    "## Return",
    "",
    "| Leg | Airline | Flight | From | To | Departs | Arrives |",
    "|---|---|---|---|---|---|---|",
    "| 1 | KLM (KL) | KL1978 | Dubrovnik (DBV) | Amsterdam (AMS) | 2026-08-24 13:25 | 15:55 |",
  ].join("\n");

  const outbound = m.parseLegTable(note, "Outbound");
  assert.equal(outbound.length, 1, "the Return table must not leak in");
  assert.equal(outbound[0].number, "KL1977");
  assert.equal(outbound[0].date, "2026-08-17");
  assert.equal(outbound[0].depTime, "10:15");
  assert.equal(outbound[0].arrTime, "12:35");
  // The whole point: 2 h 20 min, not 173 h.
  assert.equal(m.totalJourneyMinutes(outbound), 140);

  assert.equal(m.parseLegTable(note, "Return")[0].number, "KL1978");
  assert.deepEqual(m.parseLegTable(note, "Nowhere"), []);
});

test("an overnight arrival lands on the next day", () => {
  const note = [
    "## Outbound",
    "| Leg | Airline | Flight | From | To | Departs | Arrives |",
    "|---|---|---|---|---|---|---|",
    "| 1 | KL | KL809 | AMS | SIN | 2026-08-17 21:30 | 15:45 (+1) |",
  ].join("\n");
  const [leg] = m.parseLegTable(note, "Outbound");
  assert.equal(leg.arrDate, "2026-08-18");
  assert.equal(leg.arrTime, "15:45");
});

test("a journey is measured leg to leg, not to the end of the ticket", () => {
  const leg = (date, dep, arrDate, arr) => ({
    operator: "", number: "", from: "", to: "", date, depTime: dep, arrDate, arrTime: arr,
  });

  // Outbound only: 17 Aug 10:15 to 12:35 is 2h20, not seven days.
  const outbound = [leg("2026-08-17", "10:15", "2026-08-17", "12:35")];
  assert.equal(m.totalJourneyMinutes(outbound), 140);
  assert.equal(m.formatLayover(140), "2 h 20 min");

  // Reading the return's arrival as the outbound's is what produced 173 h.
  const wrong = [leg("2026-08-17", "10:15", "2026-08-24", "12:55")];
  assert.ok(m.totalJourneyMinutes(wrong) > 24 * 60, "the bad shape is detectable as absurd");

  // A connection counts the ground time between legs.
  const connecting = [
    leg("2026-08-17", "10:15", "2026-08-17", "13:40"),
    leg("2026-08-17", "15:45", "2026-08-17", "17:30"),
  ];
  assert.equal(m.totalJourneyMinutes(connecting), 435);
});

test("layovers are computed, and refuse to guess without times", () => {
  const leg = (date, dep, arrDate, arr) => ({
    operator: "", number: "", from: "", to: "", date, depTime: dep, arrDate, arrTime: arr,
  });
  const first = leg("2026-08-17", "10:15", "2026-08-17", "13:40");
  assert.equal(m.layoverMinutes(first, leg("2026-08-17", "15:45", "", "")), 125);
  assert.equal(m.formatLayover(125), "2 h 5 min");
  // An overnight connection spans the date boundary.
  assert.equal(m.layoverMinutes(first, leg("2026-08-18", "07:00", "", "")), 1040);
  // No times means no number, rather than a made-up one.
  assert.equal(m.layoverMinutes(first, leg("2026-08-17", "", "", "")), null);
});

// -------------------------------------------------------------- packing

function itemsOf(plan, section) {
  return new Map(
    plan.sections.find((s) => s.title === section).items.map((i) => [i.label, i.quantity]),
  );
}

test("packing quantities scale with trip length", () => {
  const short = itemsOf(m.buildPackingPlan(3, "holiday"), "Clothes");
  assert.equal(short.get("Underwear"), 4);
  assert.equal(short.get("Socks"), 4);
  assert.equal(short.get("T-shirts / tops"), 3);

  const week = itemsOf(m.buildPackingPlan(7, "holiday"), "Clothes");
  assert.equal(week.get("Underwear"), 8);
  assert.equal(week.get("T-shirts / tops"), 7);
});

test("long trips assume a laundry run instead of 22 pairs of socks", () => {
  const plan = m.buildPackingPlan(21, "holiday");
  assert.equal(plan.assumesLaundry, true);
  const clothes = itemsOf(plan, "Clothes");
  // 21 days would be absurd to carry; sized to the stretch between washes.
  assert.ok(clothes.get("Underwear") < 15, `got ${clothes.get("Underwear")}`);
  assert.ok(clothes.get("Underwear") > 10, `got ${clothes.get("Underwear")}`);
  assert.equal(m.effectiveDays(21), 13);
  // A fortnight or under is carried in full.
  assert.equal(m.buildPackingPlan(12, "holiday").assumesLaundry, false);
  assert.equal(m.effectiveDays(12), 12);
});

test("a day trip packs a bag, not a suitcase", () => {
  const plan = m.buildPackingPlan(1, "day-trip");
  assert.equal(plan.sections.length, 1);
  assert.equal(plan.sections[0].title, "Essentials");
  const concert = m.buildPackingPlan(1, "concert");
  assert.ok(concert.sections[0].items.some((i) => i.label.includes("Tickets")));
});

test("packing renders as checkboxes with quantities", () => {
  const md = m.renderPackingPlan(m.buildPackingPlan(7, "holiday"));
  assert.match(md, /- \[ \] Underwear ×8/);
  assert.match(md, /- \[ \] Passport \/ ID$/m, "unquantified items carry no ×");
  assert.match(md, /Quantities calculated for 7 days/);
});

test("event-details is readable but never generated", () => {
  // Folded into activities: a concert is a trip with one headline activity.
  assert.equal(m.CREATABLE_SUB_NOTES.includes("event-details"), false);
  // The label survives so notes made by older versions still render.
  assert.ok(m.SUB_NOTE_LABELS["event-details"]);

  for (const kind of m.KINDS) {
    assert.equal(
      kind.subNotes.includes("event-details"),
      false,
      `${kind.id} still defaults to event-details`,
    );
    for (const id of kind.subNotes) {
      assert.ok(m.CREATABLE_SUB_NOTES.includes(id), `${kind.id} wants uncreatable ${id}`);
    }
  }
});

// ----------------------------------------------------------- categories

test("custom categories join the built-in ones without duplicating them", () => {
  const base = m.allCategories([], []);
  assert.deepEqual(base, [...m.COST_CATEGORIES]);

  const withCustom = m.allCategories(["Car hire", "Diving"], []);
  assert.deepEqual(withCustom.slice(0, base.length), base, "built-ins keep their order");
  assert.deepEqual(withCustom.slice(base.length), ["Car hire", "Diving"], "extras sort");

  // A category already recorded on a trip is offered even if never configured.
  assert.ok(m.allCategories([], ["Souvenirs"]).includes("Souvenirs"));
  // Re-adding a built-in must not double it up.
  assert.equal(m.allCategories(["Transport"], ["Transport"]).filter((c) => c === "Transport").length, 1);
  assert.equal(m.allCategories(["Diving"], ["Diving"]).filter((c) => c === "Diving").length, 1);
  // Blank names are not categories.
  assert.deepEqual(m.allCategories(["", "  "], []), base);
});

// ----------------------------------------------------------------- export

const emptyDoc = {
  title: "Dubrovnik - August - 2026",
  dates: "17 – 24 Aug 2026",
  duration: "8 days, 7 nights",
  where: "Dubrovnik, Croatia",
  origin: "",
  travellers: [],
  facts: [["Kind", "Holiday"]],
  documents: [],
  bookings: [],
  days: [],
  costs: { lines: [], total: "", budget: "", byCategory: [] },
  packing: [],
  travel: { origin: "", groups: [] },
  restaurants: [],
  notes: [],
  images: [],
  generatedOn: "4 Aug 2026",
};

test("the exported document is self-contained and complete", () => {
  const html = m.renderTripDocument({
    ...emptyDoc,
    documents: [{ label: "Netherlands passport → Croatia: No visa needed", detail: "90 days", tone: "good" }],
    bookings: [
      {
        kind: "flight", kindLabel: "Flight", title: "AMS ⇄ DBV", status: "booked",
        date: "2026-08-17", endDate: "2026-08-24", time: "10:15", endTime: "16:05",
        from: "AMS", to: "DBV", address: "", reference: "XY7K2Q", seat: "14A", cost: "€827", notes: "",
        legs: [{ operator: "KL", number: "KL1885", from: "AMS", to: "DBV", date: "2026-08-17", depTime: "10:15", arrDate: "2026-08-17", arrTime: "12:35" }],
        returnLegs: [],
        journey: "2 h 20 min · direct · lands 12:35",
        returnJourney: "",
      },
    ],
    days: [{ date: "2026-08-17", label: "Day 1", weekday: "Mon 17 August", items: [{ time: "10:15", title: "AMS ⇄ DBV", detail: "AMS → DBV" }], staying: "" }],
    costs: { lines: [{ date: "2026-08-17", description: "Flight", category: "Transport", amount: "€827" }], total: "€827", budget: "€3,000", byCategory: [["Transport", "€827"]] },
    packing: [{ section: "Documents", items: [{ label: "Passport", packed: true }, { label: "Visa", packed: false }] }],
  });

  assert.match(html, /^<!doctype html>/);
  // No external stylesheet, script or image: it has to survive being emailed.
  assert.equal(/<link\b/i.test(html), false);
  assert.equal(/<script\b/i.test(html), false);
  assert.equal(/src="http/i.test(html), false);

  for (const expected of ["Dubrovnik - August - 2026", "XY7K2Q", "KL1885", "Day 1", "€3,000", "Passport"]) {
    assert.ok(html.includes(expected), `missing ${expected}`);
  }
  assert.ok(html.includes('class="box on"'), "packed items are ticked");
  assert.ok(html.includes("@page"), "carries print styling");
});

test("trip content cannot inject markup into the export", () => {
  assert.equal(m.escapeHtml('<script>alert("x")</script>'), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  const html = m.renderTripDocument({ ...emptyDoc, title: '<img src=x onerror=alert(1)>' });
  assert.equal(html.includes("<img src=x"), false);
  assert.ok(html.includes("&lt;img src=x"));
});

test("empty sections are left out rather than printed blank", () => {
  const html = m.renderTripDocument(emptyDoc);
  for (const heading of ["Bookings", "Day by day", "Costs", "Packing list", "Attachments"]) {
    assert.equal(html.includes(`>${heading}</h2>`), false, `${heading} should be omitted`);
  }
  assert.ok(html.includes("Dubrovnik - August - 2026"));
});

// ---------------------------------------------------------------- money

test("amounts parse in both European and English notation", () => {
  assert.equal(m.parseAmount("1234.56"), 1234.56);
  assert.equal(m.parseAmount("1.234,56"), 1234.56);
  assert.equal(m.parseAmount("1,234.56"), 1234.56);
  assert.equal(m.parseAmount("€1.234,56"), 1234.56);
  assert.equal(m.parseAmount("62,50"), 62.5);
  assert.equal(m.parseAmount("450"), 450);
  // Exactly three trailing digits after a single separator reads as thousands.
  assert.equal(m.parseAmount("1.234"), 1234);
  assert.equal(m.parseAmount(""), null);
  assert.equal(m.parseAmount("abc"), null);
});

test("totals stay per currency rather than inventing a conversion", () => {
  const totals = m.sumMoney([
    { amount: 450, currency: "EUR" },
    { amount: 120, currency: "EUR" },
    { amount: 85, currency: "GBP" },
  ]);
  assert.equal(totals.get("EUR"), 570);
  assert.equal(totals.get("GBP"), 85);
  assert.equal(m.formatTotals(totals), "€570 + £85");
  assert.equal(m.formatMoney({ amount: 62.5, currency: "EUR" }), "€62.50");
});

// --------------------------------------------------------------- travel

test("coordinates round-trip through Food Spot's own format", () => {
  // Verbatim from a Food Spot note, so the two plugins stay mutually readable.
  const coord = m.parseLocation("51.9325142,4.463706999999999");
  assert.equal(coord.lat, 51.9325142);
  assert.equal(coord.lng, 4.463706999999999);
  assert.equal(m.formatLocation({ lat: 1.5, lng: -2.25 }), "1.5,-2.25");
});

test("nonsense coordinates are rejected rather than sent to Google", () => {
  assert.equal(m.parseLocation("not a location"), null);
  assert.equal(m.parseLocation("51.93"), null);
  assert.equal(m.parseLocation(""), null);
  assert.equal(m.parseLocation(undefined), null);
  assert.equal(m.parseLocation("91,0"), null, "latitude beyond the pole");
  assert.equal(m.parseLocation("0,181"), null, "longitude past the date line");
});

test("cache keys round to a building, so trivial jitter is one paid lookup", () => {
  const a = { lat: 51.93251, lng: 4.46370 };
  const b = { lat: 51.93253, lng: 4.46372 };
  assert.equal(m.coordKey(a), m.coordKey(b));
  assert.equal(m.legKey(a, b, "driving"), "51.9325,4.4637|51.9325,4.4637|driving");
  // Mode is part of the key: driving and transit are separate results.
  assert.notEqual(m.legKey(a, b, "driving"), m.legKey(a, b, "transit"));
});

test("durations and distances read like a human wrote them", () => {
  assert.equal(m.formatTravelDuration(540), "9 min");
  assert.equal(m.formatTravelDuration(3600), "1 h");
  assert.equal(m.formatTravelDuration(5400), "1 h 30 min");
  assert.equal(m.formatDistance(850), "850 m");
  assert.equal(m.formatDistance(1250), "1.3 km");
  assert.equal(m.formatDistance(24500), "25 km");
});

// --------------------------------------------------------------- day order

const booking = (over) => ({
  kind: "activity",
  status: "booked",
  title: "",
  date: "",
  time: "",
  endDate: "",
  endTime: "",
  returnDate: "",
  returnTime: "",
  from: "",
  to: "",
  slot: "",
  cost: null,
  file: { path: `${over.title ?? "x"}.md` },
  ...over,
});

const ARRIVAL_DAY = [
  booking({ kind: "activity", title: "Shopping", date: "2026-08-17", slot: "morning" }),
  booking({
    kind: "flight",
    title: "AMS to DBV",
    date: "2026-08-17",
    time: "10:15",
    from: "AMS",
    to: "DBV",
    returnDate: "2026-08-24",
    returnTime: "13:25",
  }),
  booking({
    kind: "stay",
    title: "Rausion",
    date: "2026-08-17",
    endDate: "2026-08-24",
  }),
];

test("a day runs arrive, check in, do things — not whatever has a time on it", () => {
  const order = m.dayEvents(ARRIVAL_DAY, "2026-08-17").map((e) => e.title);
  // Shopping is pencilled in for "morning", but you cannot shop before you land.
  assert.deepEqual(order, ["AMS to DBV", "Rausion", "Shopping"]);
});

test("the last day checks out before it flies home", () => {
  const order = m.dayEvents(ARRIVAL_DAY, "2026-08-24").map((e) => e.detail);
  assert.deepEqual(order, ["Check out", "Return · DBV → AMS"]);
});

test("a stay spans its nights without repeating as an event", () => {
  assert.equal(m.dayEvents(ARRIVAL_DAY, "2026-08-20").length, 0);
  const [night] = m.ongoingOn(ARRIVAL_DAY, "2026-08-20");
  assert.equal(night.night, 3);
  assert.equal(night.nights, 7);
});

// ------------------------------------------------------- routes to measure

const place = (id, kind) => ({ id, label: id, kind, coord: { lat: 1, lng: 1 }, file: { path: id } });

test("the fan-out covers the hops the timeline draws, not just the ones from the hotel", () => {
  const places = [
    place("Rausion.md", "hotel"),
    place("AMS to DBV.md", "airport"),
    place("Shopping.md", "activity"),
  ];
  const pairs = m.itineraryPairs(
    ARRIVAL_DAY,
    ["2026-08-17", "2026-08-18"],
    places,
    places[0],
  );
  const keys = pairs.map((p) => `${p.from.id}>${p.to.id}`);
  // Arrival day: airport to hotel, then hotel out to the shops.
  assert.ok(keys.includes("AMS to DBV.md>Rausion.md"), keys.join(", "));
  assert.ok(keys.includes("Rausion.md>Shopping.md"), keys.join(", "));
});

test("a second hotel is the origin for the nights you spend in it", () => {
  // The base was fixed to hotels[0] for the whole trip, so a day-5 activity
  // measured from the hotel left on day 3.
  const b = (o) => ({
    kind: "activity", status: "booked", title: "", date: "", time: "", endDate: "",
    endTime: "", returnDate: "", returnTime: "", from: "", to: "", slot: "",
    cost: null, file: { path: `${o.title}.md` }, ...o,
  });
  const bookings = [
    b({ kind: "stay", title: "Hotel A", date: "2026-08-17", endDate: "2026-08-20" }),
    b({ kind: "stay", title: "Hotel B", date: "2026-08-20", endDate: "2026-08-24" }),
    b({ title: "Kayaking", date: "2026-08-22", slot: "morning" }),
  ];
  const P = (id, kind) => ({ id, label: id, kind, coord: { lat: 1, lng: 1 }, file: { path: id } });
  const places = [P("Hotel A.md", "hotel"), P("Hotel B.md", "hotel"), P("Kayaking.md", "activity")];
  const keys = m
    .itineraryPairs(bookings, ["2026-08-22"], places, places[0])
    .map((p) => `${p.from.id}>${p.to.id}`);
  assert.deepEqual(keys, ["Hotel B.md>Kayaking.md"], keys.join(", "));
});

test("pairs sharing an origin are batched into one request", () => {
  const a = place("a", "hotel");
  const groups = m.groupByOrigin([
    { from: a, to: place("b", "activity") },
    { from: a, to: place("c", "activity") },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].to.length, 2);
});

// ------------------------------------------------------------- flight time

test("a flight reports its journey, its stops and where it waits", () => {
  const legs = m.readLegs([
    { airline: "KL", flight: "1985", from: "AMS", to: "VIE", date: "2026-08-17", departs: "10:15", arrives: "11:55" },
    { airline: "OS", flight: "737", from: "VIE", to: "DBV", date: "2026-08-17", departs: "12:40", arrives: "13:50" },
  ]);
  const s = m.summariseFlight(legs);
  assert.equal(s.stops, 1);
  assert.equal(s.totalMinutes, 215);
  assert.equal(s.label, "3 h 35 min · 1 stop");
  assert.equal(s.arrival, "13:50");
  assert.deepEqual(s.layovers, ["45 min in VIE (tight)"]);
});

test("a journey longer than a day is misread data, not a flight", () => {
  const legs = m.readLegs([
    { airline: "KL", flight: "1985", from: "AMS", to: "DBV", date: "2026-08-17", departs: "10:15", arrives_on: "2026-08-24", arrives: "13:25" },
  ]);
  assert.equal(m.summariseFlight(legs).totalMinutes, null);
});

test("the export carries the parts of a trip that live outside the plugin's fields", () => {
  const html = m.renderTripDocument({
    ...emptyDoc,
    travel: {
      origin: "Rausion Luxury Apartments",
      groups: [
        {
          heading: "Airport transfer · to Rausion Luxury Apartments",
          places: [
            { name: "Dubrovnik (DBV)", detail: "2026-08-17", distance: "21 km", times: "Car 30 min · Public transport 1 h 8 min" },
          ],
        },
      ],
    },
    restaurants: [
      {
        name: "Nautika", cuisines: "Seafood", price: "€€€€", rating: "4.6 (2100)",
        address: "Brsalje ul. 3", contact: "+385 20 442 526", travel: "1.9 km · Car 7 min",
        status: "favourite",
      },
    ],
    notes: [{ title: "Itinerary", html: "<p>Walls at sunrise.</p>" }],
    days: [
      {
        date: "2026-08-17", label: "Day 1", weekday: "Mon 17 August", staying: "",
        items: [{ time: "10:15", title: "AMS ⇄ DBV", detail: "direct", travel: "21 km · Car 30 min" }],
      },
    ],
  });
  assert.match(html, /Getting around/);
  assert.match(html, /Public transport 1 h 8 min/);
  assert.match(html, /Places to eat/);
  assert.match(html, /Nautika · favourite/);
  assert.match(html, /Walls at sunrise\./);
  assert.match(html, /→ 21 km · Car 30 min/, "the timeline carries its hops into print");
  // Still no way for the file to reach the network.
  assert.ok(!/<script|<link|src="http/.test(html), "the export stays self-contained");
});

// ------------------------------------------------------- notes in the PDF

test("frontmatter is not prose", () => {
  assert.equal(m.stripFrontmatter("---\ntype: trip\n---\nHello"), "Hello");
  assert.equal(m.stripFrontmatter("No frontmatter"), "No frontmatter");
});

test("a hand-written note survives the trip to HTML", () => {
  const html = m.renderMarkdown(
    [
      "## Old Town",
      "Walk the **walls** at *sunrise*.",
      "",
      "- [x] Book tickets",
      "- [ ] Cash for the cable car",
      "",
      "See [the site](https://www.wallsofdubrovnik.com) first.",
    ].join("\n"),
  );
  assert.match(html, /<h4>Old Town<\/h4>/, "note headings sit under the section heading");
  assert.match(html, /<strong>walls<\/strong>/);
  assert.match(html, /<em>sunrise<\/em>/);
  assert.match(html, /<span class="box on"><\/span>Book tickets/);
  assert.match(html, /<span class="box"><\/span>Cash for the cable car/);
  // The address has to be readable on paper, away from the vault.
  assert.match(html, /the site <span class="url">https:\/\/www\.wallsofdubrovnik\.com<\/span>/);
});

test("a note cannot inject HTML into the export", () => {
  const html = m.renderMarkdown('<script>alert("x")</script> **bold**');
  assert.ok(!html.includes("<script>"), html);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<strong>bold<\/strong>/);
});

test("plugin blocks and vault-only links are dropped, their words kept", () => {
  const html = m.renderMarkdown(
    ["```foodspot", "view: cards", "```", "", "Go to [[Dubrovnik Old Town|the walls]]."].join("\n"),
  );
  assert.ok(!html.includes("foodspot"), html);
  assert.match(html, /Go to the walls\./);
});

test("a markdown table becomes a table", () => {
  const html = m.renderMarkdown("| Day | Plan |\n|---|---|\n| Mon | Walls |");
  assert.match(html, /<th>Day<\/th>/);
  assert.match(html, /<td>Walls<\/td>/);
});

test("inline code is not re-read as markup, and numbers survive", () => {
  const html = m.renderMarkdown("Meet in 5 minutes at `**the gate**`");
  assert.match(html, /Meet in 5 minutes/);
  assert.match(html, /<code>\*\*the gate\*\*<\/code>/);
});

test("inline code is escaped exactly once", () => {
  // Escaping the line first and the code body again on the way back printed
  // "&amp;lt;tag&amp;gt;" in the PDF where the note said "<tag>".
  const html = m.renderMarkdown("Use `<tag> & \"quotes\"` here");
  assert.match(html, /<code>&lt;tag&gt; &amp; &quot;quotes&quot;<\/code>/, html);
  assert.ok(!html.includes("&amp;lt;"), "double-escaped");
});

test("frontmatter whose closing delimiter ends the file is still stripped", () => {
  assert.equal(m.stripFrontmatter("---\ntype: trip\n---"), "");
  assert.equal(m.stripFrontmatter("---\ntype: trip\n---\n"), "");
  assert.equal(m.stripFrontmatter("---\ntype: trip\n---\n\nBody"), "\nBody");
});

test("an ambiguous city keeps the country it came from", () => {
  // Flattening to bare strings lost the country, and guessing it back returned
  // the first match by name: every Victoria was saved as Argentina.
  const hits = m.flattenGroups(m.CITIES).filter((h) => h.value === "Victoria");
  assert.ok(hits.length > 1, `expected several Victorias, got ${hits.length}`);
  const countries = new Set(hits.map((h) => h.group));
  assert.ok(countries.size > 1, [...countries].join(", "));
  assert.ok(countries.has("Canada"), [...countries].join(", "));
  // Rank order is preserved, so the prominent ones still come first.
  const flat = m.flattenByRank(m.CITIES);
  assert.deepEqual(m.flattenGroups(m.CITIES).map((h) => h.value), flat);
});

test("a passport resolves to a code the visa data has", () => {
  // The dataset keeps historical codes beside current ones under the same
  // name. Taking the last one resolved France to FX, which has no entry, so a
  // French passport got "Not known" for everywhere on earth.
  for (const country of [
    "France", "United Kingdom", "Russia", "Serbia", "Benin",
    "Burkina Faso", "Democratic Republic of the Congo", "East Timor",
  ]) {
    const check = m.checkVisa(country, "Japan");
    assert.notEqual(check.outcome, "unknown", `${country} → ${m.iso2ForCountry(country)}`);
  }
  assert.equal(m.iso2ForCountry("France"), "FR");
  assert.equal(m.iso2ForCountry("United Kingdom"), "GB");
  assert.equal(m.iso2ForCountry("Russia"), "RU");
});

test("a confirmation total is read in either notation", () => {
  const read = (line) =>
    m.parseConfirmationText(
      ["KL1885 AMS - DBV", "17 Aug 2026 10:15 - 12:35", line].join("\n"),
    );
  // The old rule assumed European punctuation: "1,234.56" normalised to
  // "1.234.56" and was dropped, and "1,234" became 1.234.
  assert.equal(read("Total paid: USD 1,234.56").amount, 1234.56);
  assert.equal(read("Total paid: USD 1,234").amount, 1234);
  assert.equal(read("Totaal: EUR 827,50").amount, 827.5);
  assert.equal(read("Total: EUR 1.234,56").amount, 1234.56);
});

test("a UTC calendar time becomes the airport's wall clock", () => {
  // 08:15Z out of Amsterdam in August is 10:15 at the gate; storing it raw
  // was only ever warned about, because the airports carried no zones.
  assert.equal(m.zoneForAirport("Amsterdam (AMS)"), "Europe/Amsterdam");
  assert.equal(m.zoneForAirport("DBV"), "Europe/Zagreb");
  assert.equal(m.zoneForAirport("Nowhere (XXX)"), null);

  assert.deepEqual(m.utcToLocal("2026-08-17", "08:15", "Europe/Amsterdam"), {
    date: "2026-08-17",
    time: "10:15",
  });
  // Winter is a different offset — the zone database decides, not a constant.
  assert.deepEqual(m.utcToLocal("2026-01-17", "08:15", "Europe/Amsterdam"), {
    date: "2026-01-17",
    time: "09:15",
  });
  // Conversion can cross midnight, which is why it runs before the split.
  assert.deepEqual(m.utcToLocal("2026-08-17", "23:30", "Europe/Amsterdam"), {
    date: "2026-08-18",
    time: "01:30",
  });

  const legs = m.localiseLegs([
    {
      operator: "KL", number: "KL1885", from: "Amsterdam (AMS)", to: "Dubrovnik (DBV)",
      date: "2026-08-17", depTime: "08:15", arrDate: "2026-08-17", arrTime: "10:35",
    },
  ]);
  assert.equal(legs[0].depTime, "10:15", "departure in Amsterdam time");
  assert.equal(legs[0].arrTime, "12:35", "arrival in Dubrovnik time");

  // One unknown airport keeps the whole journey in UTC: all or nothing.
  const mixed = m.localiseLegs([
    {
      operator: "ZZ", number: "1", from: "XXX", to: "Dubrovnik (DBV)",
      date: "2026-08-17", depTime: "08:15", arrDate: "2026-08-17", arrTime: "10:35",
    },
  ]);
  assert.equal(mixed, null);
});

test("a UTC calendar time is flagged rather than passed off as local", () => {
  const ics = [
    "BEGIN:VCALENDAR", "BEGIN:VEVENT",
    "SUMMARY:KL1885 Amsterdam (AMS) to Dubrovnik (DBV)",
    "DTSTART:20260817T081500Z", "DTEND:20260817T103500Z",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\n");
  const parsed = m.parseIcs(ics);
  assert.equal(parsed.utcTimes, true, "a trailing Z is UTC, not local wall time");

  const local = m.parseIcs(ics.replace(/Z$/gm, ""));
  assert.equal(local.utcTimes, false, "a floating or TZID time is already local");
});

test("an attachment resolves whichever link style the vault is set to", () => {
  // Only the wikilink form was unwrapped. With "Use [[Wikilinks]]" off,
  // every attachment resolved to nothing: editing a booking dropped them and
  // the PDF export skipped the images.
  assert.equal(m.linkTarget("[[receipt.pdf]]"), "receipt.pdf");
  assert.equal(m.linkTarget("![[Trips/a b.png]]"), "Trips/a b.png");
  assert.equal(m.linkTarget("[[receipt.pdf|the receipt]]"), "receipt.pdf");
  assert.equal(m.linkTarget("[receipt](Trips/receipt.pdf)"), "Trips/receipt.pdf");
  assert.equal(m.linkTarget("![shot](Trips/a%20b.png)"), "Trips/a b.png", "percent-encoded");
  assert.equal(m.linkTarget("[x](<Trips/a b.pdf>)"), "Trips/a b.pdf", "angle-wrapped");
  assert.equal(m.linkTarget("Trips/plain.pdf"), "Trips/plain.pdf", "a bare path");
  assert.equal(m.linkTarget("[site](https://example.com)"), "", "not a vault file");
});

test("a return ticket is split into out and back, not one long outbound", () => {
  // The pivot looked for the first leg departing from the final destination,
  // which on a return ticket is outbound leg zero. Nothing ever split, and the
  // booking saved as an outbound "AMS → AMS via DBV".
  const leg = (from, to, date, dep, arr) => ({
    operator: "KL", number: "KL1885", from, to, date, depTime: dep, arrDate: date, arrTime: arr,
  });
  const ret = m.splitJourney([
    leg("AMS", "DBV", "2026-08-17", "10:15", "12:35"),
    leg("DBV", "AMS", "2026-08-24", "13:25", "15:55"),
  ]);
  assert.equal(ret.outbound.length, 1);
  assert.equal(ret.back.length, 1);
  assert.equal(ret.back[0].from, "DBV");

  // Connections inside one journey are not a split.
  const connecting = m.splitJourney([
    leg("AMS", "VIE", "2026-08-17", "10:15", "11:55"),
    leg("VIE", "DBV", "2026-08-17", "12:40", "13:50"),
  ]);
  assert.equal(connecting.back.length, 0, "a 45 minute layover is a connection");

  // A one-way with a long stopover does not end where it started.
  const stopover = m.splitJourney([
    leg("AMS", "VIE", "2026-08-17", "10:15", "11:55"),
    leg("VIE", "DBV", "2026-08-18", "09:00", "10:10"),
  ]);
  assert.equal(stopover.back.length, 0, "it never returns to AMS");

  // A day trip is a return trip: it goes out and comes back the same day.
  const sameDay = m.splitJourney([
    leg("AMS", "LHR", "2026-08-17", "08:00", "09:00"),
    leg("LHR", "AMS", "2026-08-17", "17:00", "19:00"),
  ]);
  assert.equal(sameDay.back.length, 1, "an eight-hour stay is still a stay");

  // Legs typed without times still say which day they are on.
  const untimed = m.splitJourney([
    leg("AMS", "DBV", "2026-08-17", "", ""),
    leg("DBV", "AMS", "2026-08-24", "", ""),
  ]);
  assert.equal(untimed.back.length, 1, "a week apart, times or no times");

  // An open jaw does not come back to where it left from.
  const openJaw = m.splitJourney([
    leg("AMS", "JFK", "2026-08-17", "10:00", "13:00"),
    leg("BOS", "RTM", "2026-08-24", "18:00", "06:00"),
  ]);
  assert.equal(openJaw.back.length, 1, "a week between legs is a stay");

  // But an overnight connection on the way out is not a stay.
  const overnight = m.splitJourney([
    leg("AMS", "JFK", "2026-08-17", "18:00", "21:00"),
    leg("JFK", "LAX", "2026-08-18", "08:00", "11:00"),
  ]);
  assert.equal(overnight.back.length, 0, "eleven hours is a connection");

  // Timings cannot tell a stay from a connection, so the route does it: a
  // long connection on the way out no longer reads as the turn for home.
  const longConnection = m.splitJourney([
    leg("AMS", "JFK", "2026-08-17", "18:00", "21:00"),
    leg("JFK", "LAX", "2026-08-18", "08:00", "11:00"),
    leg("LAX", "AMS", "2026-08-18", "17:00", "23:00"),
  ]);
  assert.deepEqual(longConnection.outbound.map((l) => l.to), ["JFK", "LAX"]);
  assert.deepEqual(longConnection.back.map((l) => l.to), ["AMS"]);

  // A 26-hour stopover is still one journey; it never turns back.
  const oneWayStopover = m.splitJourney([
    leg("AMS", "DOH", "2026-08-17", "10:00", "19:00"),
    leg("DOH", "BKK", "2026-08-18", "21:00", "23:00"),
  ]);
  assert.equal(oneWayStopover.back.length, 0, "a stopover is not a return");

  // A double open jaw breaks where one journey ends and another begins.
  const doubleJaw = m.splitJourney([
    leg("AMS", "LHR", "2026-08-17", "08:00", "09:00"),
    leg("LGW", "RTM", "2026-08-17", "19:00", "21:00"),
  ]);
  assert.equal(doubleJaw.back.length, 1, "LGW is not where LHR landed");

  // A connecting return splits at the stay, not at either layover.
  const both = m.splitJourney([
    leg("AMS", "VIE", "2026-08-17", "10:15", "11:55"),
    leg("VIE", "DBV", "2026-08-17", "12:40", "13:50"),
    leg("DBV", "VIE", "2026-08-24", "14:20", "15:30"),
    leg("VIE", "AMS", "2026-08-24", "16:40", "18:20"),
  ]);
  assert.deepEqual(both.outbound.map((l) => l.to), ["VIE", "DBV"]);
  assert.deepEqual(both.back.map((l) => l.to), ["VIE", "AMS"]);
});

test("an untimed morning activity comes before a timed evening one", () => {
  const bk = (o) => ({
    kind: "activity", status: "booked", title: "", date: "2026-08-18", time: "",
    endDate: "", endTime: "", returnDate: "", returnTime: "", from: "", to: "",
    slot: "", cost: null, file: { path: `${o.title}.md` }, ...o,
  });
  const order = m.dayEvents(
    [bk({ title: "Museum", slot: "morning" }), bk({ title: "Concert", time: "20:00", slot: "evening" })],
    "2026-08-18",
  ).map((e) => e.title);
  // Sorting untimed events to "99:99" put the concert first, and built the
  // travel legs between them in that order too.
  assert.deepEqual(order, ["Museum", "Concert"]);
});

test("setting a budget makes the Budget note say so", () => {
  // Targets are written to the trip note and prices to each booking, so the
  // Budget note itself was never filled by anything: its card read "Not
  // started" however much of the trip was budgeted and spent.
  const lines = [
    { source: "booking", file: { basename: "AMS to DBV" }, date: "2026-08-17",
      description: "AMS ⇄ DBV", category: "Transport",
      money: { amount: 827, currency: "EUR" }, counted: true },
    { source: "expense", file: { basename: "Dinner" }, date: "2026-08-19",
      description: "Dinner at Proto", category: "Food & drink",
      money: { amount: 62.5, currency: "EUR" }, counted: true },
  ];
  const targets = new Map([["Transport", 900], ["Food & drink", 400]]);
  const table = m.budgetPlanTable(targets, lines, "EUR");

  assert.match(table, /\| Transport \| €900 \| €827 \| €73 \|/, table);
  assert.match(table, /\*\*Total\*\* \| \*\*€1,300\*\* \| \*\*€889\.50\*\* \| \*\*€410\.50\*\*/, table);

  // Transport and food are covered, but there is nowhere to sleep yet.
  const p = m.analyseNote("budget", `# Budget\n\n## Planned\n\n${table}\n`);
  assert.equal(p.state, "started");
  assert.equal(p.detail, "no accommodation yet");
  assert.equal(p.ratio, 2 / 3);

  // Nothing set and nothing costed stays honestly empty.
  assert.equal(m.analyseNote("budget", `# Budget\n\n## Planned\n\n${m.budgetPlanTable(new Map(), [], "EUR")}\n`).state, "empty");
});

test("a trip's places export as a map file", () => {
  const places = [
    { name: "Dubrovnik (DBV)", group: "Airport", address: "", location: "42.5614,18.2682", detail: "17 Aug" },
    { name: "Rausion", group: "Stay", address: "Kranjčevića 25", location: "42.6501,18.0876", detail: "17 – 24 Aug · €1,456" },
    { name: "Nautika & co", group: "Restaurant", address: "Brsalje ul. 3", location: "", detail: "" },
    { name: "No idea", group: "Activity", address: "", location: "", detail: "dropped" },
  ];
  const kml = m.tripKml("Dubrovnik <2026>", places);

  assert.match(kml, /<name>Dubrovnik &lt;2026&gt;<\/name>/, "the title is escaped");
  assert.match(kml, /<name>Nautika &amp; co<\/name>/);
  assert.match(kml, /<coordinates>18.2682,42.5614,0<\/coordinates>/, "KML is lng,lat");
  // No coordinates but an address: My Maps resolves it on import.
  assert.match(kml, /<address>Brsalje ul. 3<\/address>/);
  assert.ok(!kml.includes("No idea"), "nothing to place is left out");
  assert.match(kml, /<Folder>\s*<name>Airport<\/name>/, "grouped by kind");

  // A link that genuinely works, unlike a saved list.
  const dir = m.directionsLink(places.slice(0, 2));
  assert.match(dir, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1/);
  assert.match(dir, /origin=42\.5614%2C18\.2682/);
  assert.equal(m.directionsLink(places.slice(0, 1)), null, "one place is not a route");

  // Google refuses more than nine stops, so they are dropped, not sent.
  const many = Array.from({ length: 20 }, (_, i) => ({
    name: `p${i}`, group: "Activity", address: "", location: `50.${i},4.${i}`, detail: "",
  }));
  const capped = m.directionsLink(many);
  assert.equal((capped.match(/%7C/g) ?? []).length, m.MAX_WAYPOINTS - 1);

  assert.match(m.placeLink(places[1]), /query=42\.6501%2C18\.0876/);
});

test("a table booked before this change is not thrown away", () => {
  // The Booked section is generated now. A row typed into it by hand would be
  // overwritten by the first sync, so it is read out and made a booking.
  const note = [
    "---", "type: food", "---", "",
    "# Food — Dubrovnik", "",
    "## Want to try", "", "```foodspot", "city: Dubrovnik", "```", "",
    "## Booked", "",
    "| Date       | Time  | Place                       | Booked by | Notes |",
    "| ---------- | ----- | --------------------------- | --------- | ----- |",
    "| 2026-08-19 | 20:00 | Test Rstaurant in Dubrovnik | Iwan      | Window seat |",
    "", "## Notes", "", "not a row",
  ].join("\n");
  const rows = m.readLegacyFoodTable(note);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    date: "2026-08-19", time: "20:00", place: "Test Rstaurant in Dubrovnik",
    bookedBy: "Iwan", notes: "Window seat",
  });

  // A section the plugin generated is already bookings; nothing to migrate.
  const generated = [
    "## Booked", "", "_Generated from your bookings — edit a booking to change a row._", "",
    "| When | Time | Booking | Where | Reference | Cost | Status |",
    "|---|---|---|---|---|---|---|",
    "| 2026-08-19 |  | [[Nautika]] |  |  | €120 | booked |",
  ].join("\n");
  assert.deepEqual(m.readLegacyFoodTable(generated), []);

  // The empty template is not a booking either.
  assert.deepEqual(m.readLegacyFoodTable("## Booked\n\n_Nothing booked yet._"), []);
});

test("a restaurant is a booking like any other", () => {
  // It was a row appended to a table, which is why it had no address, no
  // price, no way to edit it and no place in the timeline or the distances.
  const def = m.BOOKING_KINDS.find((k) => k.id === "restaurant");
  assert.ok(def, "restaurant is a booking kind");
  assert.equal(def.category, "Food & drink", "so its price lands in the food budget");

  // And it takes its place on a day, between the other things you do.
  const bk = (o) => ({
    kind: "activity", status: "booked", title: "", date: "2026-08-19", time: "",
    endDate: "", endTime: "", returnDate: "", returnTime: "", from: "", to: "",
    slot: "", cost: null, file: { path: `${o.title}.md` }, ...o,
  });
  const order = m
    .dayEvents(
      [
        bk({ kind: "restaurant", title: "Nautika", time: "20:00" }),
        bk({ title: "Old town walls", time: "10:00" }),
      ],
      "2026-08-19",
    )
    .map((e) => e.title);
  assert.deepEqual(order, ["Old town walls", "Nautika"]);
});

test("a budget is done once travel, a bed and food are all costed", () => {
  // One priced flight used to finish it, so a trip with nowhere to sleep read
  // as fully budgeted.
  const line = (category, amount, basename) => ({
    source: "booking", file: { basename }, date: "2026-08-17",
    description: basename, category, money: { amount, currency: "EUR" }, counted: true,
  });
  const note = (targets, lines) =>
    `# Budget\n\n## Planned\n\n${m.budgetPlanTable(targets, lines, "EUR")}\n`;

  const flightOnly = m.analyseNote("budget", note(new Map(), [line("Transport", 827, "Flight")]));
  assert.equal(flightOnly.state, "started");
  assert.equal(flightOnly.detail, "no accommodation, no food yet");
  assert.equal(flightOnly.ratio, 1 / 3);

  const all = m.analyseNote(
    "budget",
    note(new Map(), [
      line("Transport", 827, "Flight"),
      line("Accommodation", 1456, "Rausion"),
      line("Food & drink", 300, "Meals"),
    ]),
  );
  assert.equal(all.state, "complete");
  assert.equal(all.detail, "3 lines");
  assert.equal(all.ratio, 1);

  // The note holds two tables: categories planned, and things costed. Adding
  // them together reported a number matching neither — four budgeted
  // categories plus three costed lines read as "7 lines".
  const lines = [
    line("Transport", 827, "Flight"),
    line("Accommodation", 1456, "Rausion"),
    line("Shopping", 200, "Shopping"),
  ];
  const targets = new Map([
    ["Transport", 827], ["Accommodation", 1456], ["Food & drink", 1400], ["Shopping", 200],
  ]);
  const both = [
    "# Budget", "",
    "## Planned", "", m.budgetPlanTable(targets, lines, "EUR"), "",
    "## Expenses", "", m.budgetLinesTable(lines), "",
  ].join("\n");
  const p = m.analyseNote("budget", both);
  assert.equal(p.state, "complete");
  assert.equal(p.detail, "3 lines", "the costed lines, not the categories as well");

  // A target with nothing spent counts: budgeting is the point of the note.
  const targetsOnly = m.analyseNote(
    "budget",
    note(new Map([["Transport", 900], ["Accommodation", 1500], ["Food & drink", 400]]), []),
  );
  assert.equal(targetsOnly.state, "complete");

  // Extra categories do not substitute for a missing essential.
  const shopping = m.analyseNote("budget", note(new Map([["Shopping", 200]]), []));
  assert.equal(shopping.state, "started");
  assert.equal(shopping.detail, "no transport, no accommodation, no food yet");
});

test("an untouched Budget note is not a finished Budget note", () => {
  // The template ships a row per category with every value blank; those are
  // prompts, not content.
  const template = [
    "# Budget", "", "## Planned", "",
    "| Category | Budgeted | Actual | Notes |",
    "|----------|----------|--------|-------|",
    "| Transport | | | |",
    "| Accommodation | | | |",
    "| Food & drink | | | |",
    "| **Total** | | | |",
  ].join("\n");
  assert.equal(m.analyseNote("budget", template).state, "empty");

  // One category filled is a start, not a budget: see the essentials test.
  const filled = template.replace("| Transport | | | |", "| Transport | 400 | 380 | |");
  const p = m.analyseNote("budget", filled);
  assert.equal(p.state, "started");
  assert.equal(p.detail, "no accommodation, no food yet");
});

// --------------------------------------------------------------- editing

const BOOKING_NOTE = [
  "# Rausion Luxury Apartments",
  "",
  "| | |",
  "|---|---|",
  "| **Status** | booked |",
  "",
  "## Notes",
  "",
  "Ask for the top-floor flat.",
  "",
  "## Door code",
  "",
  "4821, then #",
  "",
  "## Attachments",
  "",
  "- [[confirmation.pdf]]",
].join("\n");

test("saving the packing list does not delete the prose around it", () => {
  // Save rebuilt the body from tick boxes alone, so anything else was lost.
  const note = [
    "# Packing List — Dubrovnik",
    "",
    "> Quantities calculated for 8 days.",
    "",
    "Everything goes in the blue case.",
    "",
    "## Documents",
    "",
    "- [x] Passport / ID",
    "",
    "Zaara keeps the EHIC cards.",
    "",
    "## Clothing",
    "",
    "- [ ] T-shirts ×5",
  ].join("\n");
  const extras = m.readPackingExtras(note);
  assert.deepEqual(extras.preamble, ["Everything goes in the blue case."]);
  // Prose remembers which item it was written under, so a save can put it
  // back beside that item instead of dumping it at the section's end.
  assert.deepEqual(extras.bySection.get("Documents"), [
    { anchor: "passport / id", lines: ["Zaara keeps the EHIC cards."] },
  ]);
  assert.deepEqual(extras.bySection.get("Clothing"), []);
  // The generated callout is rewritten every save and must not pile up.
  assert.ok(!extras.preamble.join(" ").includes("Quantities calculated"));

  // Prose above any item anchors to the section top; quantities strip.
  const anchored = m.readPackingExtras(
    ["## Clothing", "Pack light.", "- [ ] T-shirts ×5", "Roll, don't fold.", "- [ ] Socks ×8"].join("\n"),
  );
  assert.deepEqual(anchored.bySection.get("Clothing"), [
    { anchor: null, lines: ["Pack light."] },
    { anchor: "t-shirts", lines: ["Roll, don't fold."] },
  ]);
});

test("a note that opens with a horizontal rule keeps its first paragraph", () => {
  // Frontmatter was detected by prefix, so a rule, a paragraph and a rule read
  // as a YAML block and the paragraph was deleted on the next save.
  const rule = "---\nCall the hotel before arrival.\n---\nKeep this too.";
  assert.equal(m.stripFrontmatter(rule), rule);

  // A close has to be a delimiter line of its own.
  const loose = "---\ntype: trip\n---not-a-delimiter\nBody\n---\nTail";
  assert.equal(m.stripFrontmatter(loose), loose, "unparseable: change nothing");

  assert.equal(m.stripFrontmatter("---\ntype: trip\n---\nA\n\n---\n\nB"), "A\n\n---\n\nB");
  assert.equal(m.stripFrontmatter("---\ntags:\n  - a\n---\nBody"), "Body");
  assert.equal(m.stripFrontmatter("---\r\ntype: trip\r\n---\r\nBody"), "Body", "CRLF");
});

test("a real booking save cycle is lossless and stable", () => {
  // The exact composition updateBooking performs, with the real generated
  // body — not a hand-mocked one. Every note-destroying bug in this plugin's
  // history lived in this loop.
  const draft = {
    kind: "stay", status: "booked", title: "Rausion Luxury Apartments",
    date: "2026-08-17", endDate: "2026-08-24", time: "15:00", endTime: "10:00",
    amount: 1456, currency: "EUR", category: "Accommodation",
    reference: "BK123", from: "", to: "", address: "Kranjčevića 25, Dubrovnik",
    operator: "", seat: "", notes: "Ask for the top floor.",
    attachments: [], legs: [], returnLegs: [],
  };
  const links = ["![[receipt.pdf]]"];
  const save = (note) => m.weaveKept(m.bookingBody(draft, links), m.customParts(note));

  let note = save("");
  // The user now writes in every place available.
  note = note
    .replace("| **Reference** | BK123 |", "| **Reference** | BK123 |\n\nGate code is 4821#.")
    .concat("\n\n## Taxi numbers\n\n- Blue: +385 20 970\n");

  for (let i = 0; i < 3; i += 1) note = save(note);

  assert.match(note, /Gate code is 4821#\./);
  assert.match(note, /## Taxi numbers\n\n- Blue: \+385 20 970/);
  assert.equal(m.sectionText(note, "Notes"), "Ask for the top floor.");
  assert.ok(note.indexOf("Gate code") < note.indexOf("## Notes"), "prose stays above the sections");
  assert.equal(note, save(note), "a fourth save changes nothing");
  assert.equal((note.match(/## Taxi numbers/g) ?? []).length, 1, "sections do not duplicate");

  // The expense cycle too — the note kind that generates no details table.
  // The table goes under the user's own heading: content typed inside an
  // owned section like ## Receipt is regenerated away by contract.
  const esave = (n) => m.weaveKept(m.expenseBody("Dinner at Proto", ["![[bill.jpg]]"]), m.customParts(n));
  let expense = esave("").replace(
    "## Receipt",
    "| Split | Amount |\n|---|---|\n| Iwan | 40 |\n\n## Receipt",
  ) + "\n\n## Who owes what\n\n- Zaara: 20\n";
  for (let i = 0; i < 3; i += 1) expense = esave(expense);
  assert.match(expense, /\| Iwan \| 40 \|/, "a table above the sections survives");
  assert.match(expense, /## Who owes what\n\n- Zaara: 20/);
  assert.equal(expense, esave(expense));
});

test("a ticket with a third journey is called out, two journeys are not", () => {
  const leg = (f, t, d, dep, arr) => ({
    operator: "KL", number: "KL1", from: f, to: t, date: d, depTime: dep, arrDate: d, arrTime: arr,
  });
  assert.equal(
    m.looksLikeMoreJourneys([
      leg("AMS", "LHR", "2026-08-17", "08:00", "09:00"),
      leg("LHR", "AMS", "2026-08-19", "17:00", "19:00"),
      leg("AMS", "DBV", "2026-08-21", "10:00", "12:20"),
      leg("DBV", "AMS", "2026-08-28", "13:00", "15:20"),
    ]),
    true,
    "two returns on one ticket cannot fit one booking",
  );
  assert.equal(
    m.looksLikeMoreJourneys([
      leg("AMS", "VIE", "2026-08-17", "10:15", "11:55"),
      leg("VIE", "DBV", "2026-08-17", "12:40", "13:50"),
      leg("DBV", "VIE", "2026-08-24", "14:20", "15:30"),
      leg("VIE", "AMS", "2026-08-24", "16:40", "18:20"),
    ]),
    false,
    "a connecting return is one out and one back",
  );
  assert.equal(
    m.looksLikeMoreJourneys([
      leg("AMS", "JFK", "2026-08-17", "10:00", "13:00"),
      leg("BOS", "RTM", "2026-08-24", "18:00", "06:00"),
    ]),
    false,
    "an open jaw still fits: one out, one back",
  );
});

test("prose under the details table survives any number of edits", () => {
  // Each edit rebuilds the body as generated + kept. Appending the kept
  // preamble after the generated sections moved it under "## Attachments",
  // where the NEXT edit read it as owned and deleted it: preserved once, gone
  // twice. The weave puts it back between the details and the sections.
  const generated = [
    "# Rausion Luxury Apartments", "",
    "| | |", "|---|---|", "| **Status** | booked |", "",
    "## Notes", "", "Ask for the top floor.", "",
    "## Attachments", "", "- [[receipt.pdf]]",
  ].join("\n");
  const editOnce = (note) => m.weaveKept(generated, m.customParts(note));

  const original = generated.replace(
    "| **Status** | booked |",
    "| **Status** | booked |\n\nCall the hotel the day before.",
  );
  let note = original;
  for (let i = 0; i < 3; i += 1) note = editOnce(note);

  assert.match(note, /Call the hotel the day before\./, "still there after three edits");
  assert.ok(
    note.indexOf("Call the hotel") < note.indexOf("## Notes"),
    "and still above the sections, not relocated under one",
  );
  assert.equal(m.sectionText(note, "Notes"), "Ask for the top floor.", "Notes not contaminated");
  // Stable: the third edit changed nothing.
  assert.equal(note, editOnce(note));

  // A custom section rides along too, after the generated ones.
  const withSection = editOnce(`${original}\n\n## Door code\n\n4821`);
  assert.match(withSection, /## Door code\n\n4821/);
  assert.equal(withSection, editOnce(withSection));
});

test("an attachment link with a fragment still finds its file", () => {
  // "#page=2" addresses a page inside the PDF; the file is what resolves.
  assert.equal(m.linkTarget("[[receipt.pdf#page=2]]"), "receipt.pdf");
  assert.equal(m.linkTarget("![p](Trips/receipt.pdf#page=2)"), "Trips/receipt.pdf");
});

test("a bare URL keeps its balanced paren and sheds its punctuation", () => {
  const wiki = m.renderMarkdown("See https://en.wikipedia.org/wiki/Split_(city) today");
  assert.match(wiki, /Split_\(city\)<\/span> today/, wiki);
  const dot = m.renderMarkdown("Go to https://example.com.");
  assert.match(dot, /example\.com<\/span>\./, dot);
});

test("only a table we generated is treated as generated", () => {
  // An expense writes no details table, so "the first table in the preamble"
  // was the user's own — and editing the expense deleted it.
  const expense = "# Dinner at Proto\n\n| Item | Cost |\n|---|---|\n| Wine | 40 |";
  assert.match(m.customSections(expense), /Wine/);

  // A booking's generated table has a bolded label in every row.
  const booking = [
    "# Rausion", "", "| | |", "|---|---|", "| **Status** | booked |", "",
    "| Room | Price |", "|---|---|", "| Sea view | 210 |",
  ].join("\n");
  const kept = m.customSections(booking);
  assert.ok(!kept.includes("**Status**"), kept);
  assert.match(kept, /Sea view/);
  // Stable: feeding the result back changes nothing.
  assert.equal(m.customSections(`# Rausion\n\n${kept}`), kept);
});

test("a four-backtick fence showing a three-backtick example stays one block", () => {
  // Toggling on every ``` flipped the state inside the example, so the rest
  // of the note read as fenced and its sections were mishandled.
  const note = [
    "# Stay", "",
    "## How to embed", "",
    "````md",
    "```foodspot",
    "view: cards",
    "```",
    "````", "",
    "## Door code", "", "4821",
  ].join("\n");
  const kept = m.customSections(note);
  assert.match(kept, /````md/, kept);
  assert.match(kept, /## Door code/, "the section after the example is still seen");
  assert.match(kept, /4821/);
  assert.equal(m.sectionText(note, "Door code"), "4821");
});

test("a real note's frontmatter never reaches the body", () => {
  // The preservation tests all used notes without frontmatter, so they passed
  // while every actual edit copied the YAML into the body — and again on the
  // next save, and the one after that.
  const note = [
    "---", "type: booking", "status: booked", "---", "",
    "# Rausion Luxury Apartments", "",
    "| | |", "|---|---|", "| **Status** | booked |", "",
    "Call the hotel the day before.", "",
    "## Notes", "", "Ask for the top-floor flat.",
  ].join("\n");
  const kept = m.customSections(note);
  assert.ok(!kept.includes("type: booking"), kept);
  assert.ok(!kept.includes("---"), kept);
  assert.match(kept, /Call the hotel the day before\./);

  // And it is stable: feeding the result back in changes nothing.
  assert.equal(m.customSections(`# X\n\n${kept}`), kept);

  const packing = ["---", "type: packing-list", "---", "", "# Packing List", "",
    "Use the blue case.", "", "## Documents", "- [x] Passport"].join("\n");
  assert.deepEqual(m.readPackingExtras(packing).preamble, ["Use the blue case."]);
});

test("a table you wrote below the generated one is not the generated one", () => {
  const note = [
    "# Stay", "",
    "| | |", "|---|---|", "| **Status** | booked |", "",
    "| Room | Price |", "|---|---|", "| Sea view | 210 |",
  ].join("\n");
  const kept = m.customSections(note);
  assert.match(kept, /Sea view/, "the second table is not part of the first");
  assert.ok(!kept.includes("**Status**"), "the generated one is still dropped");
});

test("prose typed above the first heading survives an edit", () => {
  // The generated preamble is a title and one table; anything else up there was
  // typed by a person. Keeping only text under an unowned "##" threw it away.
  const note = [
    "# Rausion Luxury Apartments",
    "",
    "| | |",
    "|---|---|",
    "| **Status** | booked |",
    "",
    "Call the hotel the day before — they hold the key at the bar.",
    "",
    "## Notes",
    "",
    "Ask for the top-floor flat.",
  ].join("\n");
  const kept = m.customSections(note);
  assert.match(kept, /Call the hotel the day before/);
  assert.ok(!kept.includes("**Status**"), "the generated table is regenerated, not kept");
  assert.ok(!kept.includes("Rausion Luxury Apartments"), "nor the generated title");
  assert.ok(!kept.includes("Ask for the top-floor flat"), "Notes is regenerated");
});

test("a heading inside a code fence is not a section boundary", () => {
  const note = [
    "# Stay",
    "",
    "## Door instructions",
    "",
    "```md",
    "## Attachments",
    "example",
    "```",
    "",
    "Then turn left.",
  ].join("\n");
  const kept = m.customSections(note);
  assert.match(kept, /## Attachments/, "the fenced heading is content, not a boundary");
  assert.match(kept, /example/);
  assert.match(kept, /Then turn left\./);
  // And the same when reading a section back into the form.
  const notes = m.sectionText(
    "## Notes\n\n```md\n## Attachments\n```\n\nkeep me\n\n## Door code\n\n4821",
    "Notes",
  );
  assert.match(notes, /keep me/);
  assert.ok(!notes.includes("4821"), "a real later heading still ends the section");
});

test("editing a booking keeps what you wrote by hand", () => {
  // The form regenerates the sections it owns. Anything else was typed by a
  // person and must survive being saved over.
  const kept = m.customSections(BOOKING_NOTE);
  assert.match(kept, /## Door code/);
  assert.match(kept, /4821, then #/);
  assert.ok(!kept.includes("Ask for the top-floor flat"), "Notes is regenerated, not duplicated");
  assert.ok(!kept.includes("confirmation.pdf"), "Attachments is regenerated, not duplicated");
});

test("reopening the form shows the notes that are in the note", () => {
  // They live in the body, not frontmatter; an empty box would wipe them.
  assert.equal(m.sectionText(BOOKING_NOTE, "Notes"), "Ask for the top-floor flat.");
  assert.equal(m.sectionText(BOOKING_NOTE, "Door code"), "4821, then #");
  assert.equal(m.sectionText(BOOKING_NOTE, "Nothing here"), "");
});

console.log(`\n${passed} tests passed`);
