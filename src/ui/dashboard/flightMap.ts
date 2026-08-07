import { setIcon } from "obsidian";
import type { DashboardContext } from "./common";
import { emptyState, sectionTitle } from "./common";
import type { Trip } from "../../types";
import { groupJourneys } from "../../bookings/legs";
import type { Route, RouteInput, RouteSet } from "../../map/flightRoutes";
import { routesFrom } from "../../map/flightRoutes";
import { fitToBox } from "../../map/projection";
import { greatCirclePath } from "../../map/greatCircle";
import { worldRings } from "../../data/worldMap";
import { formatKm } from "../../stats/tripStats";

/**
 * Flights drawn on the world, along the path an aeroplane actually takes.
 *
 * SVG rather than tiles: the outlines are bundled, so this works on a plane,
 * needs no key, bills nobody and tells no tile server where you are going. A
 * flight map wants coastlines, not street names.
 *
 * The animation is the point of the feature and not decoration — a route that
 * draws itself from one airport to the other says which way round it goes, and
 * a static arc does not.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_W = 1000;
const VIEW_H = 560;
/** Enough samples that a long arc reads as a curve rather than a fan of chords. */
const SAMPLES = 96;

function svg<K extends keyof SVGElementTagNameMap>(
  parent: Element,
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  parent.appendChild(el);
  return el;
}

/** What the map is drawing: this trip's flights, or every trip's. */
function collect(ctx: DashboardContext, trips: Trip[]): RouteSet {
  const inputs: RouteInput[] = [];
  for (const trip of trips) {
    for (const booking of ctx.plugin.bookings.getBookings(trip)) {
      if (booking.kind !== "flight") continue;
      inputs.push({
        tripTitle: trip.title,
        stage: trip.stage,
        status: booking.status,
        journeys: [...groupJourneys(booking.legs), ...groupJourneys(booking.returnLegs)],
      });
    }
  }
  return routesFrom(inputs);
}

/** The `d` of a path along a great circle, split at the date line. */
function routePaths(route: Route, at: (lng: number, lat: number) => { x: number; y: number }): string[] {
  return greatCirclePath(route.from, route.to, SAMPLES).map((run) =>
    run
      .map((p, index) => {
        const { x, y } = at(p.lng, p.lat);
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" "),
  );
}

export function renderFlightMap(parent: HTMLElement, ctx: DashboardContext): void {
  const { plugin, trip } = ctx;
  const trips = trip ? [trip] : plugin.store.getTrips();
  const set = collect(ctx, trips);

  sectionTitle(parent, trip ? `Flights on ${trip.title}` : "Everywhere you fly");

  if (set.routes.length === 0) {
    emptyState(
      parent,
      "plane",
      "No flights to draw",
      trip
        ? "Add a flight to this trip and its path appears here, over the route an aeroplane would actually take."
        : "No trip has a flight booked or proposed yet. Once one does, every route you fly is drawn here.",
      trip
        ? [{ label: "Add flight", icon: "plane", onClick: () => void plugin.openBookingWizard(trip, "flight") }]
        : [],
    );
    return;
  }

  const wrap = parent.createDiv({ cls: "awty-map" });
  const root = svg(wrap, "svg", {
    viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
    class: "awty-map-svg",
    role: "img",
    "aria-label": `${set.routes.length} flight route${set.routes.length === 1 ? "" : "s"} drawn on a world map`,
  });

  const at = fitToBox(VIEW_W, VIEW_H, 12);

  // ------------------------------------------------------------- the world
  const land = svg(root, "g", { class: "awty-map-land" });
  for (const ring of worldRings()) {
    const parts: string[] = [];
    for (let i = 0; i < ring.points.length; i += 2) {
      const { x, y } = at(ring.points[i], ring.points[i + 1]);
      parts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    svg(land, "path", { d: `${parts.join(" ")} Z` });
  }

  // ------------------------------------------------------------ the routes
  const lines = svg(root, "g", { class: "awty-map-routes" });
  const planes = svg(root, "g", { class: "awty-map-planes" });

  set.routes.forEach((route, index) => {
    const group = svg(lines, "g", {
      class: `awty-map-route ${route.booked ? "is-booked" : "is-proposed"}`,
    });
    svg(group, "title").textContent =
      `${route.from.code} → ${route.to.code} · ${formatKm(route.km)}` +
      `${route.flights > 1 ? ` · ${route.flights} flights` : ""}` +
      `\n${route.trips.join(", ")}${route.booked ? "" : " (not booked)"}`;

    for (const d of routePaths(route, at)) {
      const path = svg(group, "path", { d, class: "awty-map-arc" });
      // Each arc draws itself in, staggered so a map of eight routes reads as
      // eight flights rather than one flash.
      const length = path.getTotalLength?.() ?? 1000;
      path.style.setProperty("--awty-arc-length", String(Math.max(1, length)));
      path.style.setProperty("--awty-arc-delay", `${(index * 0.18).toFixed(2)}s`);
    }

    // A dot that runs the route once it has drawn. Only for booked flights:
    // the proposed ones are dashed and still, which is the difference between
    // a plan and a plane.
    //
    // CSS `offset-path` rather than SVG's own `<animateMotion>`. SMIL inserted
    // into a live document does not reliably start — measured here at nought
    // pixels of movement over a second, with the SVG clock ticking perfectly
    // happily — whereas offset-path is honoured, and being CSS it stops when
    // the reduced-motion rule below says so.
    if (route.booked) {
      const [first] = routePaths(route, at);
      if (first) {
        const marker = svg(planes, "circle", { r: 3.5, class: "awty-map-plane" });
        marker.style.offsetPath = `path("${first}")`;
        marker.style.animationDelay = `${(index * 0.18 + 0.9).toFixed(2)}s`;
      }
    }
  });

  // ----------------------------------------------------------- the airports
  const dots = svg(root, "g", { class: "awty-map-airports" });
  for (const point of set.points) {
    const { x, y } = at(point.lng, point.lat);
    const dot = svg(dots, "circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 3 });
    svg(dot, "title").textContent = `${point.code} — ${point.city}, ${point.country}`;
  }

  // -------------------------------------------------------------- the key
  const legend = wrap.createDiv({ cls: "awty-map-legend" });
  const item = (cls: string, label: string): void => {
    const el = legend.createDiv({ cls: "awty-map-legend-item" });
    el.createSpan({ cls: `awty-map-legend-line ${cls}` });
    el.createSpan({ text: label });
  };
  const booked = set.routes.filter((r) => r.booked).length;
  const proposed = set.routes.length - booked;
  if (booked > 0) item("is-booked", `${booked} booked`);
  if (proposed > 0) item("is-proposed", `${proposed} proposed`);
  legend.createDiv({
    cls: "awty-map-legend-note",
    text: `${formatKm(set.routes.reduce((sum, r) => sum + r.km * r.flights, 0))} flown in total`,
  });

  if (set.unknown > 0) {
    // The map is a floor, like the statistics. Said plainly rather than left
    // as a route that is simply absent.
    wrap.createDiv({
      cls: "awty-map-caveat",
      text: `${set.unknown} leg${set.unknown === 1 ? "" : "s"} could not be drawn: the airport is not in the bundled list.`,
    });
  }

  // A world map with no tiles still needs to say where it came from.
  const credit = wrap.createDiv({ cls: "awty-map-credit" });
  setIcon(credit.createSpan({ cls: "awty-map-credit-icon" }), "globe");
  credit.createSpan({ text: "Outlines from Natural Earth · drawn offline, nothing is fetched" });
}
