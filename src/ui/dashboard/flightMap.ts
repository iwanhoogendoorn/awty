import * as L from "leaflet";
import { setIcon } from "obsidian";
import type { DashboardContext } from "./common";
import { emptyState, sectionTitle } from "./common";
import type { Trip, TripStage } from "../../types";
import { groupJourneys } from "../../bookings/legs";
import { renderStageFilter } from "./stageFilter";
import type { Route, RouteInput, RouteKind, RouteSet } from "../../map/flightRoutes";
import { routesFrom } from "../../map/flightRoutes";
import { greatCirclePath } from "../../map/greatCircle";
import { worldPolygons } from "../../map/baseLayer";
import { formatKm } from "../../stats/tripStats";

/**
 * Flights drawn on a real map, along the path an aeroplane actually takes.
 *
 * OpenStreetMap tiles over a bundled vector world. The tiles are the point —
 * an earlier version drew country outlines and nothing else, which meant the
 * zoom control magnified the same information rather than revealing any, and
 * zooming to an airport showed you the same coastline slightly larger.
 *
 * The vectors stay underneath. Trips get planned on planes and in hotels with
 * bad wifi, and when no tile arrives the arcs still have a world to sit on.
 */

const OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Under the tiles, so it is a backstop rather than a second map. */
const BASE_PANE = "awty-base";
/** Over them, so a route is never buried by a city. */
const ROUTE_PANE = "awty-routes";

/**
 * Deep enough to see which terminal, shallow enough to be a decent guest.
 * OSM serves these tiles free and asks that nobody treat it as a bulk source.
 */
const MAX_ZOOM = 14;

/** Enough samples that a long arc reads as a curve rather than a fan of chords. */
const SAMPLES = 96;

/** One world, not an endless ribbon of copies. */
const WORLD = L.latLngBounds([-85, -180], [85, 180]);

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

/**
 * What the map is showing, said in English.
 *
 * Spelled out per stage rather than slotted into a template: the stage ids are
 * nouns, adjectives and a past tense between them, and any one sentence built
 * from all four produces "trips you planning" for at least one of them.
 */
const STAGE_TITLE: Record<TripStage, string> = {
  planning: "Flights on trips you are planning",
  going: "Flights on trips you are going on",
  went: "Flights on trips you went on",
  cancelled: "Flights on trips you called off",
};

const KIND_LABEL: Record<RouteKind, string> = {
  booked: "booked",
  proposed: "proposed",
  cancelled: "cancelled",
};

function ring(points: { lat: number; lng: number }[]): L.LatLngTuple[] {
  return points.map((p) => [p.lat, p.lng] as L.LatLngTuple);
}

export interface FlightMapOptions {
  /** Shared with the Trips grid, so the two tabs never disagree about the set. */
  filter?: { stage: TripStage | null; onChange: (stage: TripStage | null) => void };
}

/**
 * Draws the map and returns the way to take it down again.
 *
 * A Leaflet map registers listeners on the window, so emptying the container —
 * which is how this dashboard repaints — would leave one behind on every
 * render. The caller owns the disposer and is expected to call it.
 */
export function renderFlightMap(
  parent: HTMLElement,
  ctx: DashboardContext,
  options: FlightMapOptions = {},
): (() => void) | void {
  const { plugin, trip } = ctx;
  const stage = trip ? null : (options.filter?.stage ?? null);

  // Selecting a trip is itself the narrowest possible filter, so the chips step
  // aside rather than offering to filter a set of one.
  const all = plugin.store.getTrips();
  const selectable = plugin.settings.showCancelledTrips
    ? all
    : all.filter((t) => t.stage !== "cancelled");
  const trips = trip ? [trip] : stage ? selectable.filter((t) => t.stage === stage) : selectable;

  sectionTitle(
    parent,
    trip ? `Flights on ${trip.title}` : stage ? STAGE_TITLE[stage] : "Everywhere you fly",
  );

  if (!trip && options.filter) {
    renderStageFilter(parent, selectable, stage, options.filter.onChange);
  }

  const set = collect(ctx, trips);

  if (set.routes.length === 0) {
    emptyState(
      parent,
      "plane",
      "No flights to draw",
      trip
        ? "Add a flight to this trip and its path appears here, over the route an aeroplane would actually take."
        : stage
          ? "These trips have no flight on them yet. Clear the filter to see the routes on the others."
          : "No trip has a flight booked or proposed yet. Once one does, every route you fly is drawn here.",
      trip
        ? [{ label: "Add flight", icon: "plane", onClick: () => void plugin.openBookingWizard(trip, "flight") }]
        : stage && options.filter
          ? [{ label: "Show all trips", icon: "layers", onClick: () => options.filter?.onChange(null) }]
          : [],
    );
    return;
  }

  const wrap = parent.createDiv({ cls: "awty-map" });
  const stageEl = wrap.createDiv({ cls: "awty-map-stage" });
  const canvas = stageEl.createDiv({ cls: "awty-map-canvas" });

  const map = L.map(canvas, {
    // A view up front, before a single layer is added.
    //
    // Leaflet defers `onAdd` through `whenReady` until the map has a centre and
    // a zoom, so on a view-less map every `addTo` returns before the SVG path
    // behind it exists. Fitting the bounds afterwards then quietly skipped
    // everything that reaches for those elements — the draw-in normalisation
    // and every plane marker — with no error to show for it.
    center: [20, 0],
    zoom: 1,
    zoomControl: true,
    attributionControl: true,
    // Plain scroll keeps scrolling the pane; a modifier zooms. That is also
    // exactly what a trackpad pinch sends, so the gesture people already make
    // works and the one they make to get past the map is not stolen from them.
    scrollWheelZoom: false,
    minZoom: 1,
    maxZoom: MAX_ZOOM,
    // Fractional zoom, because a trackpad pinch arrives as a stream of tiny
    // deltas. Leaflet's default snaps every zoom to a whole number, which
    // rounds each of those back to where it started — so pinching did nothing
    // at all, silently, while the mouse wheel worked fine.
    zoomSnap: 0,
    maxBounds: WORLD,
    maxBoundsViscosity: 1,
    worldCopyJump: false,
  });

  // ------------------------------------------------------- the world, twice
  map.createPane(BASE_PANE).style.zIndex = "190";
  map.createPane(ROUTE_PANE).style.zIndex = "410";

  L.polygon(worldPolygons().map(ring), {
    pane: BASE_PANE,
    renderer: L.svg({ pane: BASE_PANE }),
    className: "awty-map-base",
    interactive: false,
  }).addTo(map);

  L.tileLayer(OSM_URL, {
    attribution: OSM_ATTRIBUTION,
    maxZoom: MAX_ZOOM,
    // One world. Repeated copies would run past the vectors underneath and
    // leave the fallback map ending in mid-ocean.
    noWrap: true,
    className: "awty-map-tiles",
  }).addTo(map);

  // ------------------------------------------------------------ the routes
  const routeRenderer = L.svg({ pane: ROUTE_PANE });
  const drawn: { line: L.Polyline; route: Route }[] = [];
  const bounds = L.latLngBounds([]);

  set.routes.forEach((route, index) => {
    const label =
      `${route.from.code} → ${route.to.code} · ${formatKm(route.km)}` +
      `${route.flights > 1 ? ` · ${route.flights} flights` : ""}` +
      `<br>${route.trips.join(", ")}${route.kind === "booked" ? "" : ` (${KIND_LABEL[route.kind]})`}`;

    for (const run of greatCirclePath(route.from, route.to, SAMPLES)) {
      const line = L.polyline(ring(run), {
        pane: ROUTE_PANE,
        renderer: routeRenderer,
        className: `awty-map-route is-${route.kind}`,
        // Weight here, colour and dashes in the stylesheet; Leaflet's own
        // default would otherwise paint every route the same blue.
        weight: route.kind === "booked" ? 2.5 : 2,
      }).addTo(map);
      line.bindTooltip(label, { sticky: true, className: "awty-map-tip" });
      bounds.extend(line.getBounds());

      const path = line.getElement();
      if (path instanceof SVGElement) {
        // pathLength normalises the dash units to the path's own length, so the
        // draw-in behaves identically at every zoom. Only booked routes get it:
        // it would also rescale the dash pattern that makes a proposal look
        // like a proposal, and one dash would then span the whole flight.
        if (route.kind === "booked") path.setAttribute("pathLength", "1");
        // Staggered, so a map of eight routes reads as eight flights rather
        // than one flash.
        path.style.setProperty("--awty-arc-delay", `${(index * 0.18).toFixed(2)}s`);
      }
      drawn.push({ line, route });
    }
  });

  // ----------------------------------------------------------- the airports
  for (const point of set.points) {
    L.circleMarker([point.lat, point.lng], {
      pane: ROUTE_PANE,
      renderer: routeRenderer,
      radius: 4,
      className: "awty-map-airport",
    })
      .bindTooltip(`${point.code} — ${point.city}, ${point.country}`, { className: "awty-map-tip" })
      .addTo(map);
  }

  // ------------------------------------------------------------- the planes
  //
  // A dot that runs each booked route once it has drawn, so the direction is
  // unmistakable. Only booked ones: the proposals are dashed and still, which
  // is the difference between a plan and a plane.
  //
  // Appended to Leaflet's own SVG rather than added as layers, because
  // `offset-path` wants a route's path data and no Leaflet layer follows one.
  // Panning moves the whole overlay by transform so the markers come with it;
  // only a zoom rewrites the geometry, hence the hook below.
  const svgRoot = map.getPane(ROUTE_PANE)?.querySelector("svg");
  const planes: { marker: SVGCircleElement; line: L.Polyline }[] = [];

  if (svgRoot) {
    drawn.forEach(({ line, route }, index) => {
      if (route.kind !== "booked") return;
      const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      marker.setAttribute("r", "3.5");
      marker.setAttribute("class", "awty-map-plane");
      marker.style.animationDelay = `${(index * 0.18 + 0.9).toFixed(2)}s`;
      svgRoot.appendChild(marker);
      planes.push({ marker, line });
    });
  }

  /**
   * Point each marker at its route's current geometry.
   *
   * Leaflet rewrites every path's `d` whenever the renderer re-projects, which
   * is on a pan and on a view reset as well as on a zoom. Hooking only the zoom
   * left the markers flying along the shape the route had at some earlier
   * moment — measured at up to 235px away from the line they belonged to, which
   * is most of a country.
   *
   * Registered after Leaflet's own renderer, so by the time this runs the new
   * geometry is already in the DOM.
   */
  const followRoutes = (): void => {
    for (const { marker, line } of planes) {
      const d = line.getElement()?.getAttribute("d");
      if (d) marker.style.offsetPath = `path("${d}")`;
    }
  };
  map.on("moveend zoomend viewreset", followRoutes);

  // ------------------------------------------------------------ the minimap
  //
  // The bundled world again, with no tiles on it: it costs no requests, works
  // with the wifi off, and says where in the world the main map is looking.
  const miniEl = stageEl.createDiv({ cls: "awty-map-mini" });
  const mini = L.map(miniEl, {
    center: [20, 0],
    zoom: 0,
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    touchZoom: false,
    zoomSnap: 0,
  });
  L.polygon(worldPolygons().map(ring), { className: "awty-map-base", interactive: false }).addTo(mini);
  mini.fitBounds(WORLD, { animate: false });
  const miniBox = L.rectangle(WORLD, { className: "awty-map-mini-box", interactive: false }).addTo(mini);

  // A picture you can only look at is a waste of a corner.
  miniEl.addEventListener("click", (evt) => map.panTo(mini.mouseEventToLatLng(evt)));

  const hint = wrap.createDiv({ cls: "awty-map-hint" });

  const syncMini = (): void => {
    miniBox.setBounds(map.getBounds());
    // Zoomed out, the rectangle is drawn around everything, which tells you
    // nothing you cannot already see. It arrives when it has something to say.
    const wide = map.getZoom() <= map.getBoundsZoom(WORLD, true) + 0.5;
    miniEl.classList.toggle("is-hidden", wide);
    hint.setText(
      wide
        ? "Pinch or ⌘/Ctrl-scroll to zoom, drag to pan. Plain scrolling still scrolls the page."
        : `Drag to pan · Esc to fit your flights · zoom ${map.getZoom().toFixed(1)}`,
    );
  };
  map.on("move zoom", syncMini);

  // ------------------------------------------------------ zoom, courteously
  const wheel = (evt: WheelEvent): void => {
    if (!evt.ctrlKey && !evt.metaKey) return;
    evt.preventDefault();
    // A pinch sends a stream of deltas around one; a mouse notch sends a single
    // one of about a hundred and twenty — or of three, if the browser reports
    // lines. Normalised and capped, or one notch crosses the whole zoom range.
    const raw = evt.deltaMode === 0 ? evt.deltaY : evt.deltaY * 16;
    const step = Math.max(-50, Math.min(50, raw)) / -50;
    map.setZoomAround(map.mouseEventToContainerPoint(evt), map.getZoom() + step);
  };
  canvas.addEventListener("wheel", wheel, { passive: false });

  const home = (): void => {
    map.fitBounds(bounds.isValid() ? bounds.pad(0.15) : WORLD, { animate: false });
  };
  canvas.addEventListener("keydown", (evt) => {
    if (evt.key !== "Escape") return;
    evt.preventDefault();
    home();
  });

  // Open looking at your own flights rather than at the whole planet: the
  // Pacific is not the subject of a map of three trips around Europe.
  home();
  // After the view has settled, not before — fitting the bounds re-projects
  // every route, so a marker aimed before this points at the old shape.
  followRoutes();
  syncMini();

  // A pane Obsidian has not shown yet has no size, and Leaflet measures its
  // container when it is created. Without this the map opens as a grey sliver
  // and stays that way until something else happens to force a repaint.
  const resize = new ResizeObserver(() => {
    map.invalidateSize({ animate: false });
    mini.invalidateSize({ animate: false });
  });
  resize.observe(canvas);

  // --------------------------------------------------------------- the key
  const legend = wrap.createDiv({ cls: "awty-map-legend" });
  const item = (kind: RouteKind, count: number): void => {
    if (count === 0) return;
    const el = legend.createDiv({ cls: "awty-map-legend-item" });
    el.createSpan({ cls: `awty-map-legend-line is-${kind}` });
    el.createSpan({ text: `${count} ${KIND_LABEL[kind]}` });
  };
  const count = (kind: RouteKind): number => set.routes.filter((r) => r.kind === kind).length;
  const km = (kind: RouteKind): number =>
    set.routes.filter((r) => r.kind === kind).reduce((sum, r) => sum + r.km * r.flights, 0);

  item("booked", count("booked"));
  item("proposed", count("proposed"));
  item("cancelled", count("cancelled"));

  // Distances by kind rather than one total: adding a proposal to a ticket
  // gives a number that is true of nothing, and adding a cancellation gives one
  // that is true of a trip that did not happen.
  const totals = [
    km("booked") > 0 ? `${formatKm(km("booked"))} booked` : "",
    km("proposed") > 0 ? `${formatKm(km("proposed"))} proposed` : "",
  ].filter(Boolean);
  if (totals.length > 0) {
    legend.createDiv({ cls: "awty-map-legend-note", text: totals.join(" · ") });
  }

  if (set.unknown > 0) {
    // The map is a floor, like the statistics. Said plainly rather than left
    // as a route that is simply absent.
    wrap.createDiv({
      cls: "awty-map-caveat",
      text: `${set.unknown} leg${set.unknown === 1 ? "" : "s"} could not be drawn: the airport is not in the bundled list.`,
    });
  }

  // Tiles come off somebody else's servers and the fallback world off somebody
  // else's survey. Both get credited — and so does the fact that this fetches.
  const credit = wrap.createDiv({ cls: "awty-map-credit" });
  setIcon(credit.createSpan({ cls: "awty-map-credit-icon" }), "globe");
  credit.createSpan({
    text: "Tiles from OpenStreetMap, fetched as you pan · offline outlines from Natural Earth",
  });

  return () => {
    resize.disconnect();
    canvas.removeEventListener("wheel", wheel);
    map.off();
    map.remove();
    mini.off();
    mini.remove();
  };
}
