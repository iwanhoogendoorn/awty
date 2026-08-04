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
export { routeTitle, layoverMinutes, formatLayover, totalJourneyMinutes } from "./src/bookings/legs.ts";
export { parseConfirmation, parseIcs, parseConfirmationText, parseLooseDate } from "./src/flights/parseConfirmation.ts";
export { splitFlightNumber } from "./src/flights/flightNumber.ts";
export { renderTripDocument, escapeHtml } from "./src/export/tripDocument.ts";
export { decodeQuotedPrintable, extractIcsFromEmail } from "./src/flights/parseConfirmation.ts";
export { fold, rankMatches, flattenByRank, replaceLastToken } from "./src/util/search.ts";
export { checkVisa, iso2ForCountry, exceedsAllowance } from "./src/travel/visa.ts";
export { allCategories, COST_CATEGORIES } from "./src/bookings/types.ts";
export { CREATABLE_SUB_NOTES, SUB_NOTE_LABELS, KINDS } from "./src/types.ts";
export { parseAdviceColour, adviceUrlFor, isStale, ADVICE_TTL_MS } from "./src/travel/adviceData.ts";
export { AIRPORTS } from "./src/data/airports.ts";
export { AIRLINES, airlineLabel } from "./src/data/airlines.ts";
export { buildPackingPlan, effectiveDays, renderPackingPlan } from "./src/store/packing.ts";
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
  assert.equal(filled.state, "started");
  assert.equal(filled.detail, "1 booking");
});

test("a bare foodspot embed reads as started, not empty", () => {
  const p = m.analyseNote("food", "# Food\n\n```foodspot\nview: cards\ncity: Dubrovnik\n```\n");
  assert.equal(p.state, "started");
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

  const day = m.readDaySections(note, "2026-08-17");
  assert.equal(day.morning, "Breakfast at the apartment");
  assert.equal(day.afternoon, "", "a slot with only links has no prose");
  assert.equal(day.evening, "Drinks on the terrace");

  assert.equal(m.readDaySections(note, "2026-08-18").morning, "Different day, must not leak");
  assert.equal(m.readDaySections(note, "2026-08-19").morning, "", "an absent day is empty");
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

console.log(`\n${passed} tests passed`);
