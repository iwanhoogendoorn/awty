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
  assert.ok(total > 4000, `expected >4000 cities, got ${total}`);
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

console.log(`\n${passed} tests passed`);
