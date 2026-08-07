/**
 * Zoom and pan for the flight map, as arithmetic rather than as a gesture.
 *
 * Kept out of the render so the awkward parts can be checked: that zooming
 * under the pointer leaves the place under the pointer exactly where it was,
 * that panning cannot drag the world off the edge, and that zooming back out
 * always lands on the whole world rather than somewhere near it.
 */

export interface View {
  /** 1 is the whole world; 4 shows a quarter of it across. */
  zoom: number;
  /** Centre of the visible box, in world units. */
  cx: number;
  cy: number;
}

export const MIN_ZOOM = 1;

/**
 * The outlines are quantised to 0.1°, which at this width is about 0.28 world
 * units. By 12× that is roughly three screen pixels, so the coastlines start
 * to show their stair-steps. Zooming further would only magnify the dataset's
 * own resolution and present it as detail, so this is where it stops.
 */
export const MAX_ZOOM = 12;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The visible rectangle in world units. */
export function viewBox(view: View, w: number, h: number): Box {
  const vw = w / view.zoom;
  const vh = h / view.zoom;
  return { x: view.cx - vw / 2, y: view.cy - vh / 2, w: vw, h: vh };
}

export function viewBoxAttr(view: View, w: number, h: number): string {
  const box = viewBox(view, w, h);
  return `${box.x.toFixed(2)} ${box.y.toFixed(2)} ${box.w.toFixed(2)} ${box.h.toFixed(2)}`;
}

/**
 * A view pulled back inside the world.
 *
 * Zoom is clamped first, because the centre that is legal depends on it. Below
 * 1 the visible box is wider than the world, so there is exactly one sensible
 * centre and the axis is pinned there rather than left to drift.
 */
export function clampView(view: View, w: number, h: number): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom));
  const vw = w / zoom;
  const vh = h / zoom;
  const axis = (c: number, span: number, extent: number): number =>
    span >= extent ? extent / 2 : Math.min(extent - span / 2, Math.max(span / 2, c));
  return { zoom, cx: axis(view.cx, vw, w), cy: axis(view.cy, vh, h) };
}

/** The whole world, which is where the map starts and what Reset returns to. */
export function wholeWorld(w: number, h: number): View {
  return { zoom: MIN_ZOOM, cx: w / 2, cy: h / 2 };
}

export function isWholeWorld(view: View): boolean {
  return view.zoom <= MIN_ZOOM + 1e-6;
}

/**
 * Zoom by `factor`, keeping the world point (px, py) under the same pixel.
 *
 * This is the whole trick of a map that does not feel slippery: you point at
 * Reykjavík, you zoom, and Reykjavík has not moved. Zooming about the centre
 * instead makes every zoom a small unrequested pan.
 */
export function zoomAt(
  view: View,
  factor: number,
  px: number,
  py: number,
  w: number,
  h: number,
): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));

  const before = viewBox(view, w, h);
  // Where the anchor sits in the visible box, as a fraction of it.
  const fx = before.w === 0 ? 0.5 : (px - before.x) / before.w;
  const fy = before.h === 0 ? 0.5 : (py - before.y) / before.h;

  const vw = w / zoom;
  const vh = h / zoom;
  return clampView({ zoom, cx: px + vw * (0.5 - fx), cy: py + vh * (0.5 - fy) }, w, h);
}

/** Zoom about the centre — what the +/− buttons and the keyboard do. */
export function zoomBy(view: View, factor: number, w: number, h: number): View {
  return clampView({ ...view, zoom: view.zoom * factor }, w, h);
}

/** Drag, in world units. Pixels are converted by the caller, which knows the scale. */
export function panBy(view: View, dx: number, dy: number, w: number, h: number): View {
  return clampView({ ...view, cx: view.cx + dx, cy: view.cy + dy }, w, h);
}

/** Jump the centre somewhere — what clicking the minimap does. */
export function centreOn(view: View, cx: number, cy: number, w: number, h: number): View {
  return clampView({ ...view, cx, cy }, w, h);
}
