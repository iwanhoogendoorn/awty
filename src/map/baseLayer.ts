import type { LatLng } from "./greatCircle";
import { worldRings } from "../data/worldMap";

/**
 * The bundled world, as rings of latitude and longitude.
 *
 * This used to be the whole map. It is now what sits *under* the tiles: online
 * you barely see it, and offline — on a plane, in a hotel with hostile wifi —
 * it is the difference between arcs over coastlines and arcs over grey squares.
 *
 * The packed data is longitude-first because that is GeoJSON's order; map
 * libraries almost universally want the opposite, and the one place that
 * swap happens is here rather than scattered through the drawing code.
 */
export function worldPolygons(): LatLng[][] {
  return worldRings().map((ring) => {
    const out: LatLng[] = [];
    for (let i = 0; i < ring.points.length; i += 2) {
      out.push({ lat: ring.points[i + 1], lng: ring.points[i] });
    }
    return out;
  });
}
