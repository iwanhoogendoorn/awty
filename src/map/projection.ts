/**
 * Turning a latitude and longitude into a point on a flat map.
 *
 * Robinson, which is the projection most people picture when they picture a
 * world map — Greenland is a plausible size, the poles are lines rather than
 * points, and nothing looks obviously wrong. It is a compromise that is neither
 * equal-area nor conformal, which is exactly right for a map whose job is to
 * show that a flight went from here to there.
 *
 * Mercator would have been fewer lines of code and would have made Scandinavia
 * the size of Africa.
 */

/**
 * Robinson's table: for each parallel, how long it is relative to the equator
 * (`x`) and how far from the equator it sits (`y`). The projection is defined
 * by these nineteen rows and interpolation between them — there is no closed
 * form, which is why the table is here rather than a formula.
 */
const TABLE: { x: number; y: number }[] = [
  { x: 1.0, y: 0.0 },
  { x: 0.9986, y: 0.062 },
  { x: 0.9954, y: 0.124 },
  { x: 0.99, y: 0.186 },
  { x: 0.9822, y: 0.248 },
  { x: 0.973, y: 0.31 },
  { x: 0.96, y: 0.372 },
  { x: 0.9427, y: 0.434 },
  { x: 0.9216, y: 0.4958 },
  { x: 0.8962, y: 0.5571 },
  { x: 0.8679, y: 0.6176 },
  { x: 0.835, y: 0.6769 },
  { x: 0.7986, y: 0.7346 },
  { x: 0.7597, y: 0.7903 },
  { x: 0.7186, y: 0.8435 },
  { x: 0.6732, y: 0.8936 },
  { x: 0.6213, y: 0.9394 },
  { x: 0.5722, y: 0.9761 },
  { x: 0.5322, y: 1.0 },
];

/** Rows are five degrees apart. */
const STEP = 5;
const X_SCALE = 0.8487;
const Y_SCALE = 1.3523;

/** The projected half-width and half-height of the whole world, in the same units. */
export const WORLD_HALF_WIDTH = X_SCALE * Math.PI;
export const WORLD_HALF_HEIGHT = Y_SCALE;

function interpolate(latitude: number): { x: number; y: number } {
  const abs = Math.min(Math.abs(latitude), 90);
  const index = Math.min(Math.floor(abs / STEP), TABLE.length - 2);
  const t = (abs - index * STEP) / STEP;
  const low = TABLE[index];
  const high = TABLE[index + 1];
  return {
    x: low.x + (high.x - low.x) * t,
    y: low.y + (high.y - low.y) * t,
  };
}

export interface Point {
  x: number;
  y: number;
}

/** Projected coordinates, centred on (0, 0), y increasing downwards. */
export function project(lng: number, lat: number): Point {
  const { x, y } = interpolate(lat);
  return {
    x: (X_SCALE * x * lng * Math.PI) / 180,
    // The table is for the northern hemisphere, so the sign comes from the
    // latitude — and `Math.sign(0)` being 0 puts the equator on the centre
    // line without a special case. Negated because screen coordinates run
    // down the page while latitude runs up the globe.
    y: -Y_SCALE * y * Math.sign(lat),
  };
}

/**
 * A projection fitted to a box, ready to hand to an SVG.
 *
 * Returned as a function rather than applied in place so the same fit can
 * project outlines, flight paths and the marker at the end of one, without
 * three copies of the arithmetic drifting apart.
 */
export function fitToBox(width: number, height: number, padding = 0): (lng: number, lat: number) => Point {
  const usableW = Math.max(1, width - padding * 2);
  const usableH = Math.max(1, height - padding * 2);
  const scale = Math.min(usableW / (WORLD_HALF_WIDTH * 2), usableH / (WORLD_HALF_HEIGHT * 2));
  const cx = width / 2;
  const cy = height / 2;
  return (lng: number, lat: number) => {
    const p = project(lng, lat);
    return { x: cx + p.x * scale, y: cy + p.y * scale };
  };
}
