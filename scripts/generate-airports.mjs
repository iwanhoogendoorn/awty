/*
 * Generates src/data/airports.ts from the OpenFlights airport database.
 *
 * Keeps only entries with a real three-letter IATA code and usable coordinates.
 * The coordinates matter as much as the names: an airport picked from this list
 * needs no geocoding call at all, which is one less billed Google request per
 * flight.
 *
 * Run with: npm run gen:airports
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pkg from "@nwpr/airport-codes";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const raw = Array.isArray(pkg) ? pkg : (pkg.default ?? Object.values(pkg)[0]);

const seen = new Set();
const out = [];

for (const a of raw) {
  const iata = String(a.iata ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(iata)) continue;
  if (a.type && a.type !== "airport") continue;
  if (seen.has(iata)) continue;

  const lat = Number(a.latitude);
  const lng = Number(a.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;

  const city = String(a.city ?? "").trim();
  const name = String(a.name ?? "").trim();
  if (!city && !name) continue;

  seen.add(iata);
  out.push({
    i: iata,
    c: city || name,
    n: name,
    y: String(a.country ?? "").trim(),
    // Six decimals is roughly 10 cm; more is noise and bytes.
    a: Number(lat.toFixed(5)),
    o: Number(lng.toFixed(5)),
  });
}

out.sort((x, y) => x.c.localeCompare(y.c) || x.i.localeCompare(y.i));

const header = `// GENERATED FILE — do not edit by hand.\n// Run \`npm run gen:airports\` to regenerate.\n`;

fs.writeFileSync(
  path.join(ROOT, "src", "data", "airports.ts"),
  header +
    `\n/** Compact keys: i=IATA, c=city, n=name, y=country, a=latitude, o=longitude. */\n` +
    `export interface AirportRecord {\n  i: string;\n  c: string;\n  n: string;\n  y: string;\n  a: number;\n  o: number;\n}\n\n` +
    `export const AIRPORTS: readonly AirportRecord[] = ${JSON.stringify(out)};\n`,
);

console.log(`airports: ${out.length} written`);
for (const probe of ["AMS", "DBV", "JFK", "NRT", "LHR"]) {
  const hit = out.find((x) => x.i === probe);
  console.log(`  ${probe}: ${hit ? `${hit.c}, ${hit.y} (${hit.a}, ${hit.o})` : "MISSING"}`);
}
