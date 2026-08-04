/*
 * Generates src/data/visa.ts and src/data/adviceSlugs.ts.
 *
 * Visa requirements come from the open passport-index dataset. Travel advice
 * URLs come from nederlandwereldwijd.nl, whose country pages are slugged with
 * the Dutch country name — "kroatie", not "croatia". Most slugs fall straight
 * out of Intl.DisplayNames in Dutch; the rest are probed once here and baked
 * into the plugin so it never has to guess a URL at runtime.
 *
 * Run with: npm run gen:docs        (uses the cached slug table)
 *           npm run gen:docs -- --probe   (re-checks every slug against the site)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROBE = process.argv.includes("--probe");

const VISA_CSV =
  "https://raw.githubusercontent.com/ilyankou/passport-index-dataset/master/passport-index-tidy-iso2.csv";
const ADVICE_BASE = "https://www.nederlandwereldwijd.nl/reisadvies";

const countries = JSON.parse(
  fs.readFileSync(path.join(ROOT, "scripts", "foodspot-countries.json"), "utf8"),
);

// Same alias bridge the city generator uses, so one country has one spelling
// everywhere in the plugin.
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
};

const canonical = new Map(countries.map((c) => [c.toLowerCase(), c]));
const english = new Intl.DisplayNames(["en"], { type: "region" });
const dutch = new Intl.DisplayNames(["nl"], { type: "region" });

/** Every ISO-3166 alpha-2 code. */
const ISO2 = [];
for (let a = 65; a <= 90; a += 1) {
  for (let b = 65; b <= 90; b += 1) {
    const code = String.fromCharCode(a) + String.fromCharCode(b);
    try {
      if (english.of(code) !== code) ISO2.push(code);
    } catch {
      /* not a region */
    }
  }
}

function englishName(code) {
  const name = english.of(code);
  const aliased = ALIASES[name] ?? name;
  return canonical.get(aliased.toLowerCase()) ?? aliased;
}

const NAME_BY_ISO2 = Object.fromEntries(ISO2.map((code) => [code, englishName(code)]));

// --------------------------------------------------------------------- visa

async function buildVisa() {
  const response = await fetch(VISA_CSV);
  if (!response.ok) throw new Error(`Visa dataset returned HTTP ${response.status}`);
  const csv = await response.text();

  // Requirement -> single-letter token, so the bundled table stays small.
  const TOKENS = {
    "visa free": "F",
    "visa on arrival": "A",
    "e-visa": "E",
    eta: "T",
    "visa required": "R",
    "no admission": "N",
  };

  const byPassport = new Map();
  for (const line of csv.split("\n").slice(1)) {
    const [passport, destination, requirement] = line.trim().split(",");
    if (!passport || !destination || !requirement) continue;
    if (requirement === "-1") continue; // your own country

    // A number means visa-free for that many days.
    const token = /^\d+$/.test(requirement) ? requirement : TOKENS[requirement];
    if (!token) continue;

    let group = byPassport.get(passport);
    if (!group) byPassport.set(passport, (group = new Map()));
    let list = group.get(token);
    if (!list) group.set(token, (list = []));
    list.push(destination);
  }

  // Grouping destinations by requirement rather than listing each pair keeps
  // this to a few hundred KB instead of well over a megabyte.
  const out = {};
  for (const [passport, group] of byPassport) {
    out[passport] = Object.fromEntries(
      [...group].map(([token, list]) => [token, list.sort().join(",")]),
    );
  }

  fs.writeFileSync(
    path.join(ROOT, "src", "data", "visa.ts"),
    `// GENERATED FILE — do not edit by hand.\n// Run \`npm run gen:docs\` to regenerate.\n// Source: ${VISA_CSV}\n\n` +
      `/**\n * Passport ISO2 -> requirement token -> comma-separated destination ISO2 codes.\n` +
      ` * Tokens: F visa free, A visa on arrival, E e-visa, T ETA, R visa required,\n` +
      ` * N no admission. A numeric key is a visa-free stay of that many days.\n */\n` +
      `export const VISA: Record<string, Record<string, string>> = ${JSON.stringify(out)};\n\n` +
      `/** English country name for each ISO2 code, matching the plugin's spellings. */\n` +
      `export const COUNTRY_NAME_BY_ISO2: Record<string, string> = ${JSON.stringify(NAME_BY_ISO2, null, 0)};\n`,
  );

  const pairs = [...byPassport.values()].reduce(
    (n, g) => n + [...g.values()].reduce((c, l) => c + l.length, 0),
    0,
  );
  console.log(`visa: ${byPassport.size} passports, ${pairs} pairs`);
}

// ------------------------------------------------------------------ advice

function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Slugs the Dutch name does not produce correctly. */
const SLUG_OVERRIDES = {
  US: "verenigde-staten-van-amerika",
};

/**
 * Whether the site has a page for this slug.
 *
 * Returns null when the question could not be answered — offline, rate
 * limited, HEAD rejected — which is not the same as "no such country" and must
 * not be recorded as one.
 */
async function probe(slug) {
  try {
    const response = await fetch(`${ADVICE_BASE}/${slug}`, { method: "HEAD" });
    if (response.status >= 500 || response.status === 429) return null;
    return response.ok;
  } catch {
    return null;
  }
}

async function buildAdviceSlugs() {
  const cachePath = path.join(ROOT, "scripts", "advice-slugs.json");
  let slugs = {};

  if (!PROBE && fs.existsSync(cachePath)) {
    slugs = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    console.log(`advice: reusing ${Object.keys(slugs).length} cached slugs (--probe to recheck)`);
  } else {
    console.log(`advice: probing ${ISO2.length} slugs against ${ADVICE_BASE} …`);
    // Start from what is already known. A probe that cannot reach the site
    // used to look identical to one that found nothing, and the run then
    // overwrote a good file with an empty one.
    const previous = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf8")) : {};
    slugs = { ...previous };
    let unreachable = 0;

    for (const code of ISO2) {
      const candidates = [SLUG_OVERRIDES[code], slugify(dutch.of(code))].filter(Boolean);
      for (const candidate of candidates) {
        // Sequential and unhurried: this is a government site being scanned
        // once at build time, not a hot path.
        const answer = await probe(candidate);
        if (answer === null) {
          unreachable += 1;
          break;
        }
        if (answer) {
          slugs[code] = candidate;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
    }

    const failed = unreachable / ISO2.length;
    if (failed > 0.1) {
      console.error(
        `advice: ${unreachable} of ${ISO2.length} probes could not reach the site — refusing to ` +
          `overwrite ${Object.keys(previous).length} known slugs. Try again when it is up.`,
      );
      process.exit(1);
    }
    fs.writeFileSync(cachePath, JSON.stringify(slugs, null, 2) + "\n");
    console.log(`advice: ${Object.keys(slugs).length} of ${ISO2.length} countries have advice`);
  }

  fs.writeFileSync(
    path.join(ROOT, "src", "data", "adviceSlugs.ts"),
    `// GENERATED FILE — do not edit by hand.\n// Run \`npm run gen:docs -- --probe\` to re-check against the site.\n\n` +
      `/** ISO2 -> nederlandwereldwijd.nl/reisadvies slug. */\n` +
      `export const ADVICE_SLUGS: Record<string, string> = ${JSON.stringify(slugs)};\n`,
  );
}

await buildVisa();
await buildAdviceSlugs();
