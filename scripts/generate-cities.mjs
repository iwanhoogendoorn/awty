/*
 * Generates src/data/countries.ts and src/data/cities.ts.
 *
 * The country names are NOT ours to choose. Food Spot filters its `country:` and
 * `city:` code-block params with a lowercased exact-string compare, so a trip
 * that says "Czechia" will silently match nothing if Food Spot's spots say
 * "Czech Republic". scripts/foodspot-countries.json is that plugin's COUNTRIES
 * array, copied verbatim; ALIASES below bridges the ISO region names that
 * Intl.DisplayNames produces onto it.
 *
 * Run with: npm run gen:cities
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import allTheCities from "all-the-cities";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIN_POPULATION = 100_000;

const countries = JSON.parse(
  fs.readFileSync(path.join(ROOT, "scripts", "foodspot-countries.json"), "utf8"),
);
const canonical = new Map(countries.map((c) => [c.toLowerCase(), c]));

// Intl.DisplayNames spelling (left) -> the spelling we store (right). Where Food
// Spot has an opinion its spelling wins, hence "Türkiye" -> "Turkey"; note that
// Food Spot says "Czechia" and "Cape Verde", not "Czech Republic"/"Cabo Verde".
const ALIASES = {
  Türkiye: "Turkey",
  "Myanmar (Burma)": "Myanmar",
  "Côte d’Ivoire": "Ivory Coast",
  "Congo - Kinshasa": "Democratic Republic of the Congo",
  "Congo - Brazzaville": "Republic of the Congo",
  "Bosnia & Herzegovina": "Bosnia and Herzegovina",
  "Trinidad & Tobago": "Trinidad and Tobago",
  "Antigua & Barbuda": "Antigua and Barbuda",
  "St. Kitts & Nevis": "Saint Kitts and Nevis",
  "St. Lucia": "Saint Lucia",
  "St. Vincent & Grenadines": "Saint Vincent and the Grenadines",
  "São Tomé & Príncipe": "Sao Tome and Principe",
  "Timor-Leste": "East Timor",
  "Palestinian Territories": "Palestine",
  "Hong Kong SAR China": "Hong Kong",
  "Macao SAR China": "Macau",
  "Vatican City": "Vatican City",
};

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

function resolveCountry(iso2) {
  let name;
  try {
    name = regionNames.of(iso2);
  } catch {
    return null;
  }
  if (!name || name === iso2) return null;
  const aliased = ALIASES[name] ?? name;
  // Food Spot's spelling is authoritative when it has one; otherwise this is a
  // country Food Spot simply doesn't list and we keep the ISO spelling.
  return canonical.get(aliased.toLowerCase()) ?? aliased;
}

// name -> highest-population entry, so duplicate place names collapse to the
// one a traveller actually meant.
const byCountry = new Map();
const unmapped = new Map();

for (const city of allTheCities) {
  if (city.population < MIN_POPULATION) continue;
  const country = resolveCountry(city.country);
  if (!country) {
    unmapped.set(city.country, (unmapped.get(city.country) ?? 0) + 1);
    continue;
  }
  let cities = byCountry.get(country);
  if (!cities) byCountry.set(country, (cities = new Map()));
  const existing = cities.get(city.name);
  if (!existing || existing < city.population) cities.set(city.name, city.population);
}

// Food Spot lists 174 countries; the world has rather more. Anything with real
// cities that Food Spot omits still belongs in the trip picker — you should be
// able to plan a trip to Puerto Rico. Food Spot embeds for those countries drop
// the `country:` line instead of emitting one that can never match.
const extras = [...byCountry.keys()].filter((c) => !canonical.has(c.toLowerCase())).sort();
const allCountries = [...countries, ...extras].sort((a, b) => a.localeCompare(b));

const out = {};
let total = 0;
for (const country of allCountries) {
  const cities = byCountry.get(country);
  if (!cities) continue;
  // Population descending, so the typeahead offers Amsterdam before Almere.
  const names = [...cities.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
  out[country] = names;
  total += names.length;
}

const header = `// GENERATED FILE — do not edit by hand.\n// Run \`npm run gen:cities\` to regenerate.\n`;

fs.writeFileSync(
  path.join(ROOT, "src", "data", "countries.ts"),
  header +
    `\n/** Every country offered by the trip picker. */\n` +
    `export const COUNTRIES: readonly string[] = ${JSON.stringify(allCountries, null, 2)};\n\n` +
    `/**\n * The subset the Food Spot plugin knows about, copied verbatim from its own\n` +
    ` * COUNTRIES array. Food Spot compares \`country:\` with a lowercased exact-string\n` +
    ` * match, so emitting a country outside this set can only ever match nothing.\n */\n` +
    `export const FOODSPOT_COUNTRIES: ReadonlySet<string> = new Set(${JSON.stringify(countries, null, 2)});\n`,
);

fs.writeFileSync(
  path.join(ROOT, "src", "data", "cities.ts"),
  header +
    `\n/** Cities with population >= ${MIN_POPULATION.toLocaleString("en")}, most populous first. */\n` +
    `export const CITIES: Record<string, readonly string[]> = ${JSON.stringify(out)};\n`,
);

console.log(`countries: ${allCountries.length} (${countries.length} from Food Spot + ${extras.length} extra)`);
console.log(`extra countries: ${extras.join(", ") || "none"}`);
console.log(`countries with cities: ${Object.keys(out).length}`);
console.log(`cities: ${total} written (population >= ${MIN_POPULATION})`);
if (unmapped.size) {
  const rows = [...unmapped.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\nUNMAPPED ISO codes (${rows.length}) — cities dropped:`);
  for (const [iso, n] of rows) console.log(`  ${iso}: ${n}`);
}
