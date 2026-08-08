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
import type { Connection, PlaceKind, TripPlace } from "../../map/tripPlaces";
import {
  MAX_MAP_ZOOM,
  PLACE_KINDS,
  countByKind,
  connectionBetween,
  connectionsOf,
  placeKindDef,
  placeScopes,
  scopeIdOf,
  routeThrough,
  unscheduled,
  zoomForKind,
} from "../../map/tripPlaces";
import { readTripPlaces } from "../../map/placeReader";
import { formatKm } from "../../stats/tripStats";
import { formatDate } from "../../util/dates";
import { TRAVEL_MODES, formatDuration as formatTravelTime } from "../../travel/types";
import { distanceKm } from "../../map/greatCircle";

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
  /** Set below the map, and rewritten whenever the route is. */
  let routeNote: HTMLElement | null = null;
  /**
   * The journeys the route currently makes, as somewhere to jump.
   *
   * Held here and refilled with the route, because which journeys exist depends
   * on which kinds are switched on — a list built once would offer to take you
   * to a leg you had just filtered away.
   */
  let journeys: Connection[] = [];
  /** The pair the From/To pickers are narrowing to, when they are. */
  let pick: { from: string; to: string } = { from: "", to: "" };
  /** Assigned once the dropdown exists; a no-op until then. */
  let fillScopes: () => void = () => {};
  /** Assigned once the map exists, for the same reason. */
  let fitToPane: () => void = () => {};
  /** Rewrites the hint and the minimap; assigned with them. */
  let syncMini: () => void = () => {};
  /** Redraws the kind chips; assigned with them. */
  let paintChips: () => void = () => {};

  /**
   * Kinds that cannot be switched off, because something chosen belongs to them.
   *
   * A place named in the pickers has to be on the map — otherwise the line runs
   * to a spot with nothing on it and the two controls contradict each other.
   */
  const lockedKinds = (): Set<PlaceKind> => {
    const out = new Set<PlaceKind>();
    for (const id of [pick.from, pick.to]) {
      if (!id) continue;
      const place = places.find((p) => scopeIdOf(p) === id);
      if (place) out.add(place.kind);
    }
    return out;
  };

  /** The chosen place that is holding a kind on, for the chip's tooltip. */
  const lockedBy = (kind: PlaceKind): string => {
    for (const id of [pick.from, pick.to]) {
      const place = id ? places.find((p) => scopeIdOf(p) === id) : null;
      if (place && place.kind === kind) return place.label;
    }
    return "your selection";
  };

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
    // A chosen place outranks a switched-off chip: it was asked for by name.
    const held = lockedKinds();
    const visible = new Set(
      PLACE_KINDS.map((k) => k.id).filter((k) => !hidden.has(k) || held.has(k)),
    );

    // Belt and braces: the menus can no longer offer the same place twice, but
    // if the two ever matched, `connectionBetween` returns nothing and what
    // followed showed the whole route with the flights hidden — a state that
    // answers no question anybody asked.
    const pair = Boolean(pick.from && pick.to && pick.from !== pick.to);
    const narrowed = pair ? connectionBetween(places, pick.from, pick.to) : null;
    // Two airports are joined by a flight, and the flight is already drawn as
    // an arc. Asking for that pair must not hide the arc and replace it with a
    // straight line pretending to be a road.
    const flown = Boolean(
      narrowed &&
        narrowed.connection.from.kind === "airport" &&
        narrowed.connection.to.kind === "airport",
    );

    // A flight is an airport pair, so it belongs to the Airports chip. Off
    // means off: the arcs and the markers running along them go together.
    //
    // Narrowing to a pair also puts them away. "Show me the airport and the
    // hotel" means those two and the road between them; leaving every flight
    // on the screen answers a question nobody asked.
    const narrowing = Boolean(narrowed);
    const showFlights = (!trip || visible.has("airport")) && (!narrowing || flown);
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

    // Narrowed to one pair when both pickers are set. Asking to see the airport
    // and the hotel means those two and the road between them, not the whole
    // itinerary with them somewhere in it.
    journeys = narrowed ? (flown ? [] : [narrowed.connection]) : connectionsOf(route);

    journeys.forEach((leg, index) => {
      const ends: L.LatLngTuple[] = [
        [leg.from.lat, leg.from.lng],
        [leg.to.lat, leg.to.lng],
      ];
      // The same renderer as the flights, and that is load-bearing rather than
      // tidiness: a polyline given a pane but no renderer makes Leaflet create
      // a second SVG for that pane, which lands after the first in the document
      // and paints over it. The travelling dots live in the first one, so every
      // ground line was drawn on top of the dot that was supposed to be running
      // along it — the dot disappeared underneath the line.
      L.polyline(ends, {
        pane: ROUTE_PANE,
        renderer: routeRenderer,
        className: "awty-map-leg-casing",
        interactive: false,
      }).addTo(routeLayer);
      const line = L.polyline(ends, {
        pane: ROUTE_PANE,
        renderer: routeRenderer,
        className: "awty-map-leg",
        weight: 2,
      }).addTo(routeLayer);
      line.bindTooltip(
        `${leg.from.label} → ${leg.to.label}<br>${formatKm(distanceKm(leg.from, leg.to))} as the crow flies`,
        { sticky: true, className: "awty-map-tip" },
      );
      const path = line.getElement();
      if (path instanceof SVGElement) {
        path.setAttribute("pathLength", "1");
        path.style.setProperty("--awty-arc-delay", `${(index * 0.12).toFixed(2)}s`);
      }

      if (!hopGroup) return;
      // A dot each way when the trip travels the road both ways, exactly as a
      // return flight gets a plane each way.
      for (const way of leg.bothWays ? ["", "is-return"] : [""]) {
        const hop = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        hop.setAttribute("r", "4");
        // Coloured for where it is going, so the dot says what it is heading to.
        hop.setAttribute("class", `awty-map-hop is-${way ? leg.from.kind : leg.to.kind} ${way}`.trim());
        hop.style.animationDelay = `${(index * 0.12 + 1.2).toFixed(2)}s`;
        hopGroup.appendChild(hop);
        hops.push({ marker: hop, line });
      }
    });

    aimMovers();

    // The route comes from dates and times, and a place with none cannot be
    // put in an order. Saying so beats a dot that never joins up to anything,
    // which reads as the drawing being broken rather than the diary being thin.
    if (routeNote && narrowed) {
      routeNote.empty();
      routeNote.toggleClass("is-empty", false);
      const { from, to } = narrowed.connection;
      routeNote.createSpan({ text: `${from.label} → ${to.label}` });

      // Straight-line distance, which is free and always available. It is not
      // how far you drive, so it says which one it is.
      routeNote.createSpan({
        cls: "awty-map-note-fact",
        text: `${formatKm(distanceKm(from, to))} as the crow flies`,
      });

      // Road distance and time, only if the vault already knows. Working one
      // out is a billed request, and a tab that draws itself must never make
      // one — so this reads the cache and offers the button for the rest.
      const asPlace = (p: TripPlace) => ({
        id: p.id,
        label: p.label,
        kind: "activity" as const,
        coord: { lat: p.lat, lng: p.lng },
      });
      const cached = flown
        ? undefined
        : plugin.travel
            .peekLegs(asPlace(from), [asPlace(to)], plugin.settings.travelModes)
            .get(to.id);

      if (flown) {
        // Nothing to look up: nobody drives it, and asking Google for a car
        // route between two airports across a continent is a bill for nonsense.
      } else if (cached && cached.length > 0) {
        for (const leg of cached) {
          const mode = TRAVEL_MODES.find((m) => m.id === leg.mode);
          routeNote.createSpan({
            cls: "awty-map-note-fact",
            text: `${formatTravelTime(leg.durationSeconds)} by ${(mode?.label ?? leg.mode).toLowerCase()} · ${formatKm(leg.distanceMeters / 1000)} of road`,
          });
        }
      } else {
        const ask = routeNote.createEl("a", {
          cls: "awty-map-caveat-action",
          text: "work out the travel time",
        });
        ask.addEventListener("click", (evt) => {
          evt.preventDefault();
          void plugin.computeTravelTimes(trip!, () => ctx.refresh());
        });
      }

      if (flown) {
        routeNote.createSpan({
          cls: "awty-map-note-caveat",
          text: "flown — the arc is the route, not the straight line",
        });
      } else if (!narrowed.onRoute) {
        routeNote.createSpan({
          cls: "awty-map-note-caveat",
          text: "not a journey this trip makes — drawn as a straight line because you asked for it",
        });
      }
    } else if (routeNote) {
      const loose = unscheduled(places, visible);
      const names = loose.slice(0, 3).map((p) => p.label).join(", ");
      routeNote.empty();
      routeNote.setText(
        loose.length === 0
          ? ""
          : `${names}${loose.length > 3 ? ` and ${loose.length - 3} more` : ""} ` +
            `${loose.length === 1 ? "has" : "have"} no date, so the route does not call ` +
            `${loose.length === 1 ? "there" : "at them"}. Give ${loose.length === 1 ? "it" : "them"} ` +
            `a date — by booking ${loose.length === 1 ? "it" : "them"} on this trip — and the line follows.`,
      );
      routeNote.toggleClass("is-empty", loose.length === 0);
    }

    fillScopes();

    // Narrowed, only the two ends are drawn — everything else is the itinerary
    // you asked to look past.
    const onlyThese = narrowed
      ? new Set([scopeIdOf(narrowed.connection.from), scopeIdOf(narrowed.connection.to)])
      : null;

    // One pin per place, not one per appearance: the airport on the way out and
    // the same airport on the way home is one doorway, and drawing it twice put
    // an identical pin exactly on top of another.
    const pinned = new Set<string>();

    for (const place of places) {
      if (!visible.has(place.kind)) continue;
      const id = scopeIdOf(place);
      if (onlyThese && !onlyThese.has(id)) continue;
      if (pinned.has(id)) continue;
      pinned.add(id);
      const marker = L.marker([place.lat, place.lng], {
        pane: ROUTE_PANE,
        keyboard: false,
        icon: L.divIcon({
          className: "awty-map-pin-wrap",
          // A div rather than a circle, so the colour, the ring and the drop
          // can all be CSS — the same shape Food Spot uses for its spots.
          html: `<div class="awty-map-pin is-${place.kind}"></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
      }).addTo(placeLayer);
      const when = [place.date ? formatDate(place.date) : "not scheduled", place.time]
        .filter(Boolean)
        .join(" ");
      marker.bindTooltip(
        // A tooltip is built when you hover, long after the pass that blurs
        // the figures elsewhere has run. Rather than chase it, the price is
        // simply not offered while amounts are hidden — a privacy switch that
        // misses one surface is worse than none, because you stop checking.
        `<b>${place.label}</b><br>${placeKindDef(place.kind).label} · ${when}${
          place.cost && !plugin.settings.hideAmounts ? ` · ${place.cost}` : ""
        }`,
        { className: "awty-map-tip" },
      );
      if (id === pick.from || id === pick.to) marker.getElement()?.addClass("is-picked");

      marker.on("click", (evt: L.LeafletMouseEvent) => {
        // The note is still one click away, just not the click that picking
        // needs. Opening a booking from the map is the rarer thing to want.
        const mouse = evt.originalEvent;
        if (mouse.metaKey || mouse.ctrlKey) {
          const file = ctx.app.vault.getAbstractFileByPath(place.path);
          if (file instanceof TFile) ctx.openFile(file);
          return;
        }
        // Fills the pickers above rather than acting on its own. Clicking is
        // the quick way to say which places you mean; the button above is still
        // the thing that decides when the map moves.
        const current = pending();
        if (current.from && current.to) setPickers(id, "");
        else if (!current.from) setPickers(id, "");
        else if (id === current.from) setPickers("", "");
        else setPickers(current.from, id);
      });
    }
  
    // The chips carry the lock state, so they are rebuilt with everything else.
    paintChips();
    // The hint says what to click next, so it has to be rewritten when what
    // you have clicked changes — not only when the map moves.
    syncMini();
    // The note under the map grows and shrinks with what is selected, and it
    // lives inside the height the map was measured around. Without re-measuring
    // here, choosing a pair pushed the foot of the component back off the pane.
    fitToPane();
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

  // Clicking the sea puts everything back. A selection you can only escape from
  // with a keyboard is one people get stuck in.
  // Clicking the sea puts everything back, pickers included.
  map.on("click", () => {
    if (!pick.from && !pick.to) {
      setPickers("", "");
      return;
    }
    pick = { from: "", to: "" };
    setPickers("", "");
    paintPlaces();
    home();
  });

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

  syncMini = (): void => {
    miniBox.setBounds(map.getBounds());
    // Zoomed out, the rectangle is drawn around everything, which tells you
    // nothing you cannot already see. It arrives when it has something to say.
    const wide = map.getZoom() <= map.getBoundsZoom(WORLD, true) + 0.5;
    miniEl.classList.toggle("is-hidden", wide);
    // What to do next, rather than a list of gestures. Picking places by
    // clicking them is the one thing here nobody would guess at.
    const picking = trip && places.length > 1;
    const step = !picking
      ? ""
      : pick.from || pick.to
        ? "Esc for the whole trip · "
        : "Pick above, or click a place on the map to fill it in · ⌘-click opens its note · ";
    hint.setText(
      step +
        (wide
          ? "scroll or pinch to zoom, drag to pan"
          : `drag to pan · zoom ${map.getZoom().toFixed(1)}`),
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
    // Escape means "put it back": the pair first, then the framing.
    // Cleared before the pickers are, because they compare themselves against
    // it to decide whether the button has anything left to do.
    const had = Boolean(pick.from || pick.to);
    pick = { from: "", to: "" };
    setPickers("", "");
    if (had) paintPlaces();
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

    /**
     * Rebuilt whenever the selection changes, because a chip's state is not
     * only what you last clicked.
     *
     * Choosing DBV in the picker while the airports were switched off used to
     * draw the line to an airport with no pin on it — the map obeying two
     * controls that disagreed, and showing neither answer. A kind that a chosen
     * place belongs to is switched on and held there for as long as it is
     * chosen, which is the only reading of those two controls that is true.
     */
    paintChips = (): void => {
      row.empty();
      const held = lockedKinds();
      for (const def of PLACE_KINDS) {
        const count = counts.get(def.id) ?? 0;
        // A kind this trip has none of is not offered. Unlike the stage filter,
        // where the empty chips are the vocabulary, these are just what is on
        // the map — an "Airports 0" chip would only be a thing to click at.
        if (count === 0) continue;
        const locked = held.has(def.id);
        const off = hidden.has(def.id) && !locked;
        const chip = row.createEl("button", {
          cls: `awty-map-kind is-${def.id}${off ? " is-off" : ""}${locked ? " is-locked" : ""}`,
        });
        chip.type = "button";
        chip.createSpan({ cls: "awty-map-kind-dot" });
        chip.createSpan({ text: def.label });
        chip.createSpan({ cls: "awty-map-kind-count", text: String(count) });
        chip.setAttribute("aria-pressed", String(!off));
        chip.disabled = locked;
        chip.setAttribute(
          "title",
          locked
            ? `Kept on because ${lockedBy(def.id)} is what you asked to see`
            : `Show or hide the ${def.label.toLowerCase()} on this trip`,
        );
        if (locked) continue;
        chip.addEventListener("click", () => {
          if (hidden.has(def.id)) hidden.delete(def.id);
          else hidden.add(def.id);
          paintPlaces();
        });
      }
    };
    paintChips();
  }

  // ------------------------------------------------------ from here, to here
  //
  // Two pickers rather than a list of the journeys the trip happens to make.
  // "Show me the airport and the hotel" is a question about two places, and a
  // menu of the itinerary's own legs can only answer it when the itinerary
  // already contains that leg.
  // ------------------------------------------------------ from here, to here
  //
  // One control instead of two. "Zoom to" and "Between" were both menus of the
  // same places asking almost the same question, stacked on separate rows above
  // a map that wanted the height — so From on its own now means "take me here",
  // and From with To means "and show me the way between". The second row went.
  let setPickers: (from: string, to: string) => void = () => {};
  /** What the pickers are holding right now, for the map-click shortcut. */
  let pending: () => { from: string; to: string } = () => ({ from: "", to: "" });

  if (trip && places.length > 1) {
    const row = wrap.createDiv({ cls: "awty-map-pair" });
    wrap.insertBefore(row, stageEl);
    row.createSpan({ cls: "awty-map-scope-label", text: "Show" });

    // What the pickers hold, which is not what the map is showing. Nothing
    // moves until the button says so.
    let held = { from: "", to: "" };
    pending = () => held;

    const picker = (which: "from" | "to", blank: string): HTMLSelectElement => {
      const el = row.createEl("select", {
        cls: "dropdown awty-map-pair-select",
        attr: { "aria-label": which === "from" ? "Show this place" : "and the way to this place" },
      });
      el.dataset.blank = blank;
      el.addEventListener("change", () => {
        held = { from: fromPick.value, to: toPick.value };
        // Rebuilt so the other menu drops whatever this one just took.
        fillPair();
        go.disabled = held.from === pick.from && held.to === pick.to;
      });
      return el;
    };

    /**
     * Fill both menus, each without the place the other is holding.
     *
     * A journey from somewhere to itself is not a journey. Offering it produced
     * a state with no meaning — no pair to draw, so the whole route came back,
     * but with the flights switched off because something *had* been chosen.
     * Two controls, one nonsense answer, and nothing on screen saying so.
     *
     * Prevented rather than reported: a menu that cannot express the mistake
     * needs no error message.
     */
    const fillOne = (el: HTMLSelectElement, chosen: string, exclude: string): void => {
      el.replaceChildren();
      el.createEl("option", { value: "", text: el.dataset.blank ?? "" });
      for (const def of PLACE_KINDS) {
        const mine = placeScopes(places).filter((sp) => sp.kind === def.id && sp.id !== exclude);
        if (mine.length === 0) continue;
        const group = el.createEl("optgroup");
        group.label = def.label;
        for (const spot of mine) {
          const option = document.createElement("option");
          option.value = spot.id;
          option.text = spot.label;
          group.appendChild(option);
        }
      }
      el.value = chosen;
      if (el.value !== chosen) el.value = "";
    };

    const fillPair = (): void => {
      fillOne(fromPick, held.from, held.to);
      fillOne(toPick, held.to, held.from);
      held = { from: fromPick.value, to: toPick.value };
      // The arrow means "and the way to". With nothing on its right it is
      // pointing at an invitation, so it steps back until there is a journey.
      arrow.toggleClass("is-idle", !held.to);
    };

    // "Rausion Luxury Apartments → anywhere" reads as a destination, and there
    // is no such place. An empty second box is not somewhere you are going: it
    // is the absence of a second place, so it says so as an invitation rather
    // than pretending to name one.
    const fromPick = picker("from", "the whole trip");
    const arrow = row.createSpan({ cls: "awty-map-pair-arrow", text: "→" });
    const toPick = picker("to", "add a second place…");
    fillPair();

    const go = row.createEl("button", { cls: "awty-dash-action is-primary awty-map-pair-go" });
    go.type = "button";
    setIcon(go.createSpan(), "route");
    go.createSpan({ text: "Go" });
    go.disabled = true;

    // Clicking a place on the map is a shortcut into these, not a rival to
    // them: it fills a picker in, and the button still has the last word, so
    // the map never moves under you.
    setPickers = (from, to) => {
      held = { from, to: to === from ? "" : to };
      fillPair();
      go.disabled = held.from === pick.from && held.to === pick.to;
    };

    go.addEventListener("click", () => {
      pick = { ...held };
      go.disabled = true;
      paintPlaces();
      if (pick.from && pick.to && journeys.length === 1) {
        const [only] = journeys;
        goTo(
          L.latLngBounds([
            [only.from.lat, only.from.lng],
            [only.to.lat, only.to.lng],
          ]).pad(0.4),
          true,
        );
        return;
      }
      // One end only: that is a request to go and look at it, which is exactly
      // what the row this replaced was for.
      const one = pick.from || pick.to;
      const spot = one ? placeScopes(places).find((sp) => sp.id === one) : null;
      if (spot) {
        flying = true;
        map.flyTo([spot.lat, spot.lng], zoomForKind(spot.kind), { duration: 0.7 });
        return;
      }
      home();
    });
  }

  // -------------------------------------------------------------- the scope
  //
  // On a trip, the places themselves. Across every trip, the countries you fly
  // to. Different questions: "take me to the hotel" only means something when
  // there is one hotel in view, and "take me to Croatia" only means something
  // when there is more than one country on the screen.
  const scopes = trip ? [] : scopesFor(set);
  const spots = trip ? placeScopes(places) : [];

  if (!trip && scopes.length > 1) {
    // Above the map, where a control that scopes something belongs — reading it
    // after the thing it scopes is reading the caption before the photograph.
    const scopeRow = wrap.createDiv({ cls: "awty-map-scope" });
    wrap.insertBefore(scopeRow, stageEl);
    scopeRow.createSpan({ cls: "awty-map-scope-label", text: "Zoom to" });
    const select = scopeRow.createEl("select", {
      cls: "dropdown awty-map-scope-select",
      attr: { "aria-label": "Zoom the map somewhere" },
    });
    /**
     * Rebuild the list, keeping where you were if it is still on offer.
     *
     * Rebuilt rather than written once because the journeys depend on which
     * kinds are showing: switch the restaurants off and the trip no longer
     * makes the journey to dinner, so it should stop being offered.
     */
    fillScopes = (): void => {
      const previous = select.value;
      select.replaceChildren();
      // Only reached when no trip is selected; a trip uses the row above.
      select.createEl("option", { value: "", text: "Everywhere you fly" });

      for (const scope of scopes) {
        select.createEl("option", {
          value: `c:${scope.id}`,
          text: `${scope.label} (${scope.points.length} airport${scope.points.length === 1 ? "" : "s"})`,
        });
      }


      // Only if it still exists — a leg you filtered away cannot be the
      // current view's name any more.
      if (previous) {
        select.value = previous;
        // Assigning a value the list no longer has leaves the select blank,
        // which is exactly what should happen — but say so explicitly rather
        // than relying on that.
        if (select.value !== previous) select.value = "";
      }
    };
    fillScopes();

    select.addEventListener("change", () => {
      const value = select.value;
      if (!value) {
        home();
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
  fitToPane = (): void => {
    const pane = wrap.closest<HTMLElement>(".awty-dashboard");
    const content = wrap.closest<HTMLElement>(".awty-dash-content");
    if (!pane) return;

    // Distance from the top of the scrollable content to the top of the map,
    // which is scroll-independent — unlike the raw viewport position.
    const above =
      canvas.getBoundingClientRect().top + pane.scrollTop - pane.getBoundingClientRect().top;
    // The legend, the hint and the credit, which live under the map.
    const below = wrap.getBoundingClientRect().bottom - canvas.getBoundingClientRect().bottom;
    // Whatever is really below, measured rather than assumed. The column's own
    // foot padding is trimmed in the stylesheet for a tab that is all map —
    // capping the number here instead just moved the overflow somewhere the
    // arithmetic could not see it.
    const gutter =
      (content ? parseFloat(getComputedStyle(content).paddingBottom) || 0 : 0) +
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

  // The lines on the ground had no key at all, so the only way to learn what
  // a dashed one meant was to guess.
  if (places.length > 0) {
    const ground = (cls: string, label: string): void => {
      const el = legend.createDiv({ cls: "awty-map-legend-item" });
      el.createSpan({ cls: `awty-map-legend-line ${cls}` });
      el.createSpan({ text: label });
    };
    ground("is-leg", "on the ground");
  }

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

  routeNote = wrap.createDiv({ cls: "awty-map-caveat awty-map-routenote" });

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

  paintPlaces();

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
