/*
 * Generates src/data/worldMap.ts from Natural Earth's 1:110m country outlines.
 *
 * Bundled rather than fetched, and drawn as vectors rather than tiles, for the
 * reason the rest of this plugin avoids the network: a trip gets planned on a
 * plane, in a hotel with hostile wifi, or by someone who would rather a note
 * about their holiday did not call out to a tile server. A flight map wants
 * coastlines and borders, not street names, so tiles buy nothing here anyway.
 *
 * Natural Earth is public domain. https://www.naturalearthdata.com
 *
 * Coordinates are quantised to 0.1 degrees — about 11 km, which is a quarter
 * of a pixel on a 900px world map — then delta-encoded, which takes the whole
 * world from 839 KB of GeoJSON to about 54 KB.
 *
 * Run with: npm run gen:worldmap
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";

/** Tenths of a degree: the unit everything below is stored in. */
const PRECISION = 10;

const response = await fetch(SOURCE);
if (!response.ok) {
  console.error(`worldmap: could not fetch Natural Earth (${response.status})`);
  process.exit(1);
}
const geo = await response.json();

const rings = [];
for (const feature of geo.features) {
  const polygons =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;

  for (const polygon of polygons) {
    for (const ring of polygon) {
      const points = [];
      let last = null;
      for (const [lng, lat] of ring) {
        const x = Math.round(lng * PRECISION);
        const y = Math.round(lat * PRECISION);
        // Quantising turns neighbouring points into the same point; keeping
        // both would double the size of every coastline for no visible gain.
        if (last && x === last[0] && y === last[1]) continue;
        points.push([x, y]);
        last = [x, y];
      }
      // Fewer than four points cannot enclose anything once it is drawn.
      if (points.length >= 4) rings.push(points);
    }
  }
}

const encoded = rings
  .map((ring) => {
    let px = 0;
    let py = 0;
    const parts = [];
    for (const [x, y] of ring) {
      parts.push(x - px, y - py);
      px = x;
      py = y;
    }
    return parts.join(",");
  })
  .join(";");

const body = `// GENERATED FILE — do not edit by hand.
// Run \`npm run gen:worldmap\` to regenerate.
//
// Country outlines from Natural Earth 1:110m (public domain).
// https://www.naturalearthdata.com

/**
 * The world, delta-encoded in tenths of a degree.
 *
 * Rings are separated by ";" and each is a flat run of longitude/latitude
 * deltas from the previous point, the first being from (0, 0). Stored as one
 * string rather than nested arrays because the parsed form costs about twice
 * as much to ship and is only needed once, at first draw.
 */
const PACKED = ${JSON.stringify(encoded)};

/** Tenths of a degree. */
const PRECISION = ${PRECISION};

export interface Ring {
  /** Longitude, latitude pairs in degrees, flat: [lng, lat, lng, lat, …]. */
  points: number[];
}

let cache: Ring[] | null = null;

/** The outlines, decoded once and kept. */
export function worldRings(): Ring[] {
  if (cache) return cache;
  const out: Ring[] = [];
  for (const chunk of PACKED.split(";")) {
    const deltas = chunk.split(",");
    const points: number[] = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i < deltas.length; i += 2) {
      x += Number(deltas[i]);
      y += Number(deltas[i + 1]);
      points.push(x / PRECISION, y / PRECISION);
    }
    out.push({ points });
  }
  cache = out;
  return out;
}

/** Rings in the file, for a test that the data survived generation. */
export const RING_COUNT = ${rings.length};
`;

fs.writeFileSync(path.join(ROOT, "src", "data", "worldMap.ts"), body);

const points = rings.reduce((sum, r) => sum + r.length, 0);
console.log(`worldmap: ${rings.length} rings, ${points} points`);
console.log(`  packed: ${(encoded.length / 1024).toFixed(0)} KB (from ${(JSON.stringify(geo).length / 1024).toFixed(0)} KB of GeoJSON)`);
