import * as L from "leaflet";
import { TFile, setIcon } from "obsidian";
import type { DashboardContext } from "./common";
import { emptyState, sectionTitle } from "./common";
import type { Trip, TripStage } from "../../types";
import { groupJourneys } from "../../bookings/legs";
import { renderStageFilter } from "./stageFilter";
import type { Route, RouteInput, RouteKind, RouteSet } from "../../map/flightRoutes";
import { routesFrom, scopesFor } from "../../map/flightRoutes";
import { greatCirclePath } from "../../map/greatCircle";
import { worldPolygons } from "../../map/baseLayer";
import type { PlaceKind, TripPlace } from "../../map/tripPlaces";
import {
  MAX_MAP_ZOOM,
  PLACE_KINDS,
  countByKind,
  legsOf,
  placeKindDef,
  placeScopes,
  routeThrough,
  zoomForKind,
} from "../../map/tripPlaces";
import { readTripPlaces } from "../../map/placeReader";
import { formatKm } from "../../stats/tripStats";
import { formatDate } from "../../util/dates";

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

/** Enough samples that a long arc reads as a curve rather than a fan of chords. */
const SAMPLES = 96;

/** Below this a map is not worth drawing, however little room there is. */
const MIN_MAP_HEIGHT = 260;

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

  // A selected trip shows its hotels, tables and days out as well as its
  // flights, so calling the whole thing "Flights on…" stopped being true. The
  // stage views and the all-trips view really are only flights, and say so.
  sectionTitle(
    parent,
    trip ? `Where ${trip.title} takes you` : stage ? STAGE_TITLE[stage] : "Everywhere you fly",
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
    // Leaflet's own wheel zoom, which it debounces and animates.
    //
    // This used to require ⌘ or Ctrl, on the reasoning that a map should not
    // steal the scroll of a pane you are trying to get past. The reasoning was
    // about the pane; the feeling was of a map that ignored the mouse. Every
    // map anybody has used zooms on a plain wheel, and the surrounding page can
    // still be scrolled from beside the map.
    scrollWheelZoom: true,
    // How far a notch of the wheel travels. Measured rather than guessed, since
    // this map has to cross thirteen zoom levels to get from the world to a
    // terminal building:
    //
    //   140 (first attempt)  0.13 per notch   88 notches world to city
    //    60 (Leaflet default) 0.29            38
    //    25 (here)            0.68            17
    //    15                   1.08            11, and it lurches
    //
    // 25 is fractional enough to read as continuous and quick enough that
    // getting somewhere is not an errand.
    wheelPxPerZoomLevel: 25,
    minZoom: 1,
    maxZoom: MAX_MAP_ZOOM,
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
    maxZoom: MAX_MAP_ZOOM,
    // One world. Repeated copies would run past the vectors underneath and
    // leave the fallback map ending in mid-ocean.
    noWrap: true,
    className: "awty-map-tiles",
  }).addTo(map);

  // ------------------------------------------------------------ the routes
  const routeRenderer = L.svg({ pane: ROUTE_PANE });
  // Grouped so the Airports chip can take them off. A chip that says
  // "Airports 4" while four airports' worth of flight lines stay on the screen
  // is a switch wired to nothing.
  const flightLayer = L.layerGroup([]).addTo(map);
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
      }).addTo(flightLayer);
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
      .addTo(flightLayer);
  }

  // ------------------------------------------------------------ the places
  //
  // Only for a selected trip. Across every trip these would be a few hundred
  // dots with no route through them — the answer to a question nobody asked.
  const found = trip
    ? readTripPlaces(ctx.app, trip, plugin.bookings.getBookings(trip))
    : { places: [], unplaced: 0 };
  const places = found.places;
  const hidden = new Set<PlaceKind>();
  const placeLayer = L.layerGroup([], { pane: ROUTE_PANE }).addTo(map);
  const routeLayer = L.layerGroup([], { pane: ROUTE_PANE }).addTo(map);
  /**
   * Dots that travel the ground legs, exactly as the planes travel the arcs.
   *
   * The legs drew themselves in and then sat still, which made the flights look
   * like the only thing on the map that was going anywhere — the walk from the
   * hotel to dinner is a journey too, and the only reason it was not moving is
   * that nobody had written this.
   *
   * Rebuilt with the legs on every filter change, so this list is emptied and
   * refilled rather than appended to.
   */
  let hops: { marker: SVGCircleElement; line: L.Polyline }[] = [];
  /** Filled in once Leaflet's overlay exists, which is after the first layer. */
  let hopGroup: SVGGElement | null = null;

  /**
   * Draw the dots and the line between them.
   *
   * Rebuilt wholesale on every filter change rather than toggling opacity: the
   * route is derived from which places are showing, so hiding the restaurants
   * has to redraw the line through what is left, not leave a line calling at a
   * dot that is no longer there.
   */
  const paintPlaces = (): void => {
    placeLayer.clearLayers();
    routeLayer.clearLayers();
    hopGroup?.replaceChildren();
    hops = [];
    const visible = new Set(PLACE_KINDS.map((k) => k.id).filter((k) => !hidden.has(k)));

    // A flight is an airport pair, so it belongs to the Airports chip. Off
    // means off: the arcs and the markers running along them go together.
    const showFlights = !trip || visible.has("airport");
    if (showFlights && !map.hasLayer(flightLayer)) {
      flightLayer.addTo(map);
      // Leaflet builds fresh path elements on re-add, so the markers have to
      // be re-aimed or they follow the geometry the routes had before.
      aimMovers();
    } else if (!showFlights && map.hasLayer(flightLayer)) {
      map.removeLayer(flightLayer);
    }
    planeGroup.style.display = showFlights ? "" : "none";

    const route = routeThrough(places, visible);
    legsOf(route).forEach((leg, index) => {
      const line = L.polyline(
        [
          [leg.from.lat, leg.from.lng],
          [leg.to.lat, leg.to.lng],
        ],
        {
          pane: ROUTE_PANE,
          // Overnight legs are dashed: the line from the last table on Tuesday
          // to the first thing on Wednesday is you going to bed, not travelling.
          className: `awty-map-leg ${leg.sameDay ? "is-same-day" : "is-overnight"}`,
          weight: 2,
        },
      ).addTo(routeLayer);
      line.bindTooltip(`${leg.from.label} → ${leg.to.label}`, { sticky: true, className: "awty-map-tip" });
      const path = line.getElement();
      if (path instanceof SVGElement) {
        path.setAttribute("pathLength", "1");
        path.style.setProperty("--awty-arc-delay", `${(index * 0.12).toFixed(2)}s`);
      }

      // No dot on an overnight leg. That line is the gap between one day and
      // the next, and a dot creeping along it would be claiming you travelled
      // in your sleep.
      if (!leg.sameDay || !hopGroup) return;
      const hop = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      hop.setAttribute("r", "3");
      // Coloured for where it is going, so the dot says what it is on its way to.
      hop.setAttribute("class", `awty-map-hop is-${leg.to.kind}`);
      hop.style.animationDelay = `${(index * 0.12 + 1.2).toFixed(2)}s`;
      hopGroup.appendChild(hop);
      hops.push({ marker: hop, line });
    });

    aimMovers();

    for (const place of places) {
      if (!visible.has(place.kind)) continue;
      const marker = L.marker([place.lat, place.lng], {
        pane: ROUTE_PANE,
        keyboard: false,
        icon: L.divIcon({
          className: "awty-map-pin-wrap",
          // A div rather than a circle, so the colour, the ring and the drop
          // can all be CSS — the same shape Food Spot uses for its spots.
          html: `<div class="awty-map-pin is-${place.kind}"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
      }).addTo(placeLayer);
      const when = [place.date ? formatDate(place.date) : "not scheduled", place.time]
        .filter(Boolean)
        .join(" ");
      marker.bindTooltip(
        `<b>${place.label}</b><br>${placeKindDef(place.kind).label} · ${when}${place.cost ? ` · ${place.cost}` : ""}`,
        { className: "awty-map-tip" },
      );
      marker.on("click", () => {
        const file = ctx.app.vault.getAbstractFileByPath(place.path);
        if (file instanceof TFile) ctx.openFile(file);
      });
    }
  };

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
  // Their own group, so the Airports chip switches the markers off with the
  // routes they run along rather than leaving dots flying over nothing.
  const planeGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  planeGroup.setAttribute("class", "awty-map-planes");

  if (svgRoot) {
    svgRoot.appendChild(planeGroup);
    hopGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    hopGroup.setAttribute("class", "awty-map-hops");
    svgRoot.appendChild(hopGroup);
    drawn.forEach(({ line, route }, index) => {
      if (route.kind !== "booked") return;
      // One dot per direction actually flown. A return trip that animated one
      // way only showed a plane leaving and never coming home — the line is
      // folded because two arcs would double its weight, but the journey back
      // is a real journey and deserves to be seen.
      const ways = route.bothWays ? ["", "is-return"] : [""];
      for (const way of ways) {
        const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        marker.setAttribute("r", "3.5");
        marker.setAttribute("class", `awty-map-plane ${way}`.trim());
        marker.style.animationDelay = `${(index * 0.18 + 0.9).toFixed(2)}s`;
        planeGroup.appendChild(marker);
        planes.push({ marker, line });
      }
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
  const aimMovers = (): void => {
    for (const { marker, line } of [...planes, ...hops]) {
      const d = line.getElement()?.getAttribute("d");
      if (d) marker.style.offsetPath = `path("${d}")`;
    }
  };
  map.on("moveend zoomend viewreset", aimMovers);

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
        ? "Scroll or pinch to zoom, drag to pan."
        : `Drag to pan · Esc to fit ${trip ? "the whole trip" : "your flights"} · zoom ${map.getZoom().toFixed(1)}`,
    );
  };
  map.on("move zoom", syncMini);

  /**
   * Where the map should be looking, given what is selected.
   *
   * A trip selected means that trip's flights; nothing selected means all of
   * them. Either way it opens framed on your own travel rather than on the
   * whole planet — the Pacific is not the subject of a map of three trips
   * around Europe.
   */
  const flightBounds = (): L.LatLngBounds => {
    // The places count towards the frame as much as the arcs do: a trip whose
    // hotel sits off the edge of the opening view is a map that has hidden the
    // thing you selected the trip to look at.
    const box = L.latLngBounds([]);
    if (bounds.isValid()) box.extend(bounds);
    for (const place of places) box.extend([place.lat, place.lng]);
    return box.isValid() ? box.pad(0.15) : WORLD;
  };

  /** True while the map is moving because we told it to, not because you did. */
  let flying = false;
  map.on("moveend", () => {
    flying = false;
  });

  /**
   * Go somewhere, and glide rather than cut.
   *
   * `flyTo` for a deliberate jump, because being teleported across the world
   * leaves you working out where you have landed; watching the map travel there
   * tells you for free. The opening frame is instant, since there is nowhere to
   * have come from.
   */
  const goTo = (target: L.LatLngBounds, animate: boolean): void => {
    flying = true;
    if (animate) map.flyToBounds(target, { duration: 0.7, easeLinearity: 0.25 });
    else map.fitBounds(target, { animate: false });
  };

  const home = (animate = true): void => goTo(flightBounds(), animate);

  canvas.addEventListener("keydown", (evt) => {
    if (evt.key !== "Escape") return;
    evt.preventDefault();
    home();
  });

  // ------------------------------------------------------- the place filter
  //
  // Only on a selected trip, because only a selected trip has places. Across
  // every trip the map is about routes, and there is nothing here to filter.
  if (places.length > 0) {
    const counts = countByKind(places);
    const row = wrap.createDiv({ cls: "awty-map-kinds" });
    wrap.insertBefore(row, stageEl);
    for (const def of PLACE_KINDS) {
      const count = counts.get(def.id) ?? 0;
      // A kind this trip has none of is not offered. Unlike the stage filter,
      // where the empty chips are the vocabulary, these are just what is on
      // the map — an "Airports 0" chip would only be a thing to click at.
      if (count === 0) continue;
      const chip = row.createEl("button", { cls: `awty-map-kind is-${def.id}` });
      chip.type = "button";
      chip.createSpan({ cls: "awty-map-kind-dot" });
      chip.createSpan({ text: def.label });
      chip.createSpan({ cls: "awty-map-kind-count", text: String(count) });
      chip.setAttribute("aria-pressed", "true");
      chip.setAttribute("title", `Show or hide the ${def.label.toLowerCase()} on this trip`);
      chip.addEventListener("click", () => {
        if (hidden.has(def.id)) hidden.delete(def.id);
        else hidden.add(def.id);
        chip.classList.toggle("is-off", hidden.has(def.id));
        chip.setAttribute("aria-pressed", String(!hidden.has(def.id)));
        paintPlaces();
      });
    }
  }

  // -------------------------------------------------------------- the scope
  //
  // On a trip, the places themselves. Across every trip, the countries you fly
  // to. Different questions: "take me to the hotel" only means something when
  // there is one hotel in view, and "take me to Croatia" only means something
  // when there is more than one country on the screen.
  const scopes = trip ? [] : scopesFor(set);
  const spots = trip ? placeScopes(places) : [];

  if (scopes.length > 1 || spots.length > 0) {
    // Above the map, where a control that scopes something belongs — reading it
    // after the thing it scopes is reading the caption before the photograph.
    const scopeRow = wrap.createDiv({ cls: "awty-map-scope" });
    wrap.insertBefore(scopeRow, stageEl);
    scopeRow.createSpan({ cls: "awty-map-scope-label", text: "Zoom to" });
    const select = scopeRow.createEl("select", {
      cls: "dropdown awty-map-scope-select",
      attr: { "aria-label": "Zoom the map somewhere" },
    });
    select.createEl("option", {
      value: "",
      text: trip ? `All of ${trip.title}` : "Everywhere you fly",
    });

    for (const scope of scopes) {
      select.createEl("option", {
        value: `c:${scope.id}`,
        text: `${scope.label} (${scope.points.length} airport${scope.points.length === 1 ? "" : "s"})`,
      });
    }

    // Grouped by kind, so a trip with a dozen restaurants does not bury the
    // hotel in an alphabetical list of everywhere you have ever eaten.
    for (const def of PLACE_KINDS) {
      const mine = spots.filter((sp) => sp.kind === def.id);
      if (mine.length === 0) continue;
      const group = select.createEl("optgroup");
      group.label = def.label;
      for (const spot of mine) {
        const option = document.createElement("option");
        option.value = `p:${spot.id}`;
        option.text = spot.label;
        group.appendChild(option);
      }
    }

    select.addEventListener("change", () => {
      const value = select.value;
      if (!value) {
        home();
        return;
      }
      if (value.startsWith("p:")) {
        const spot = spots.find((sp) => `p:${sp.id}` === value);
        if (!spot) return;
        flying = true;
        map.flyTo([spot.lat, spot.lng], zoomForKind(spot.kind), { duration: 0.7 });
        return;
      }
      const scope = scopes.find((sc) => `c:${sc.id}` === value);
      if (!scope) return;
      const box = L.latLngBounds(scope.points.map((p) => [p.lat, p.lng] as L.LatLngTuple));
      if (scope.points.length === 1) {
        // One airport has no extent of its own, so it gets a sensible altitude
        // rather than the maximum zoom a zero-sized box implies.
        flying = true;
        map.flyTo([scope.points[0].lat, scope.points[0].lng], 7, { duration: 0.7 });
      } else {
        goTo(box.pad(0.25), true);
      }
    });

    // Moving away by hand means the dropdown no longer describes what you are
    // looking at, and a control that misreports the current state is worse than
    // one that is blank. A drag is always yours; a zoom might be this control's
    // own flight, which is what the flag is for.
    map.on("dragstart", () => {
      select.value = "";
    });
    map.on("zoomstart", () => {
      if (!flying) select.value = "";
    });
  }

  paintPlaces();

  // Open framed on the flights, instantly.
  home(false);
  // After the view has settled, not before — fitting the bounds re-projects
  // every route, so a marker aimed before this points at the old shape.
  aimMovers();
  syncMini();

  /**
   * Give the map whatever height is left in the pane, and no more.
   *
   * It used to be sized by aspect ratio, which on a wide pane made it taller
   * than the window — so the legend, the scale and the bottom of the map itself
   * were below the fold and you had to scroll a page to see the whole of a
   * picture. A map is the one thing on this dashboard that should be as big as
   * the space allows and not one pixel bigger.
   *
   * Measured from the scroll container rather than from the viewport: an
   * Obsidian pane is not the window, and this view is often in a split.
   */
  const fitToPane = (): void => {
    const pane = wrap.closest<HTMLElement>(".awty-dashboard");
    const content = wrap.closest<HTMLElement>(".awty-dash-content");
    if (!pane) return;

    // Distance from the top of the scrollable content to the top of the map,
    // which is scroll-independent — unlike the raw viewport position.
    const above =
      canvas.getBoundingClientRect().top + pane.scrollTop - pane.getBoundingClientRect().top;
    // The legend, the hint and the credit, which live under the map.
    const below = wrap.getBoundingClientRect().bottom - canvas.getBoundingClientRect().bottom;
    const styles = content ? getComputedStyle(content) : null;
    const gutter =
      (styles ? parseFloat(styles.paddingBottom) || 0 : 0) +
      (parseFloat(getComputedStyle(wrap).marginBottom) || 0);

    const room = pane.clientHeight - above - below - gutter;
    const height = Math.max(MIN_MAP_HEIGHT, Math.round(room));
    // A tolerance, because setting the height can move the scrollbar, which
    // resizes the pane, which would call this again for ever.
    if (Math.abs(canvas.getBoundingClientRect().height - height) < 2) return;
    canvas.style.height = `${height}px`;
    map.invalidateSize({ animate: false });
    mini.invalidateSize({ animate: false });
  };

  // A pane Obsidian has not shown yet has no size, and Leaflet measures its
  // container when it is created. Without this the map opens as a grey sliver
  // and stays that way until something else happens to force a repaint.
  //
  // The pane is observed rather than the map, because the map's height is this
  // function's own output — watching it would be watching itself.
  const resize = new ResizeObserver(() => {
    fitToPane();
    map.invalidateSize({ animate: false });
    mini.invalidateSize({ animate: false });
  });
  resize.observe(wrap.closest(".awty-dashboard") ?? canvas);

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

  // An address is not a position, and turning one into the other costs money,
  // so a booking that has only been given a street is waiting rather than
  // missing. Said plainly, with the way to fix it.
  if (found.unplaced > 0 && trip) {
    const note = wrap.createDiv({
      cls: "awty-map-caveat",
      text:
        `${found.unplaced} place${found.unplaced === 1 ? " is" : "s are"} not on the map yet: ` +
        `${found.unplaced === 1 ? "it has" : "they have"} an address but no coordinates. `,
    });
    const go = note.createEl("a", { cls: "awty-map-caveat-action", text: "Work out where they are" });
    go.addEventListener("click", (evt) => {
      evt.preventDefault();
      void plugin.computeTravelTimes(trip, () => ctx.refresh());
    });
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

  // Last, once the legend, the caveat and the credit exist. Measured any
  // earlier it reserves no room for them, and they push the map's own bottom
  // edge off the end of the pane — which is exactly the scrolling this is here
  // to remove.
  fitToPane();

  return () => {
    resize.disconnect();
    map.off();
    map.remove();
    mini.off();
    mini.remove();
  };
}
