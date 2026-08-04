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
export { fold, rankMatches } from "./src/util/search.ts";
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

test("a freshly generated packing list reads as untouched", () => {
  const p = m.analyseNote(
    "packing",
    "---\ntype: packing-list\n---\n\n# Packing List\n\n## Documents\n- [ ] Passport / ID\n- [ ] Visa\n",
  );
  assert.equal(p.state, "empty");
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
