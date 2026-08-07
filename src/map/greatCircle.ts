/**
 * The path an aeroplane actually takes between two airports.
 *
 * A straight line on a flat map is not the route: Amsterdam to Tokyo goes over
 * the Arctic, and drawn straight it would cross Kazakhstan instead. The shortest
 * path on a sphere is a great circle, and projecting one gives the curve people
 * recognise from the back of an in-flight magazine.
 *
 * Kept free of both Obsidian and the DOM, so the curve can be checked against
 * known routes rather than eyeballed.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/** Angular distance between two points, in radians. */
export function angularDistance(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A point some fraction of the way along the great circle from `a` to `b`.
 *
 * Spherical interpolation. The degenerate case — two points at the same place,
 * or antipodal ones where every route is equally short — falls back to `a`
 * rather than dividing by a sine of zero.
 */
export function interpolate(a: LatLng, b: LatLng, t: number): LatLng {
  const d = angularDistance(a, b);
  if (d < 1e-9) return { ...a };

  const sinD = Math.sin(d);
  const A = Math.sin((1 - t) * d) / sinD;
  const B = Math.sin(t * d) / sinD;

  const x =
    A * Math.cos(rad(a.lat)) * Math.cos(rad(a.lng)) +
    B * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng));
  const y =
    A * Math.cos(rad(a.lat)) * Math.sin(rad(a.lng)) +
    B * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng));
  const z = A * Math.sin(rad(a.lat)) + B * Math.sin(rad(b.lat));

  return {
    lat: deg(Math.atan2(z, Math.sqrt(x * x + y * y))),
    lng: deg(Math.atan2(y, x)),
  };
}

/**
 * The route as a run of points, split where it crosses the date line.
 *
 * Split rather than continuous because a projected path that runs from +179°
 * to −179° draws a line straight back across the entire map. Each returned run
 * is one unbroken stroke; a flight over the Pacific comes back as two.
 */
export function greatCirclePath(a: LatLng, b: LatLng, samples = 64): LatLng[][] {
  const points: LatLng[] = [];
  for (let i = 0; i <= samples; i += 1) points.push(interpolate(a, b, i / samples));

  const runs: LatLng[][] = [[]];
  for (const [index, point] of points.entries()) {
    const previous = points[index - 1];
    if (previous && Math.abs(point.lng - previous.lng) > 180) {
      // Carry the crossing to the edge of the map and pick it up on the other
      // side, so the stroke reaches the border instead of stopping short of it.
      const edge = previous.lng > 0 ? 180 : -180;
      const t = (edge - previous.lng) / (point.lng - previous.lng + (point.lng > previous.lng ? -360 : 360));
      const lat = previous.lat + (point.lat - previous.lat) * Math.max(0, Math.min(1, t));
      runs[runs.length - 1].push({ lat, lng: edge });
      runs.push([{ lat, lng: -edge }]);
    }
    runs[runs.length - 1].push(point);
  }

  return runs.filter((run) => run.length > 1);
}

/** Kilometres along the great circle, for labelling a route. */
export function distanceKm(a: LatLng, b: LatLng): number {
  return 6371 * angularDistance(a, b);
}
