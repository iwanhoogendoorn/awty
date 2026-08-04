import { Notice, setIcon } from "obsidian";
import type { DashboardContext } from "./common";
import { sectionTitle } from "./common";
import type { Place, TravelLeg, TravelMode } from "../../travel/types";
import { TRAVEL_MODES, formatDistance, formatDuration } from "../../travel/types";
import type { TripPlaces } from "../../travel/travelService";
import type { FlightLeg } from "../../bookings/legs";
import {
  TIGHT_CONNECTION_MINUTES,
  formatLayover,
  layoverMinutes,
  routeTitle,
  totalJourneyMinutes,
} from "../../bookings/legs";

const MODE_ICON = new Map(TRAVEL_MODES.map((m) => [m.id, m.icon]));

/**
 * Travel times from the trip's hotel outward.
 *
 * Rendering only ever reads the cache; the network is touched from an explicit
 * button, because every uncached pair is a billed Google request and a screen
 * that silently spends money on scroll is not a feature.
 */
export function renderGettingAround(parent: HTMLElement, ctx: DashboardContext): void {
  const { trip, plugin } = ctx;
  if (!trip) return;

  const travel = plugin.travel;
  const places = plugin.travelPlaces.get(trip.folderPath);
  const origin = places?.hotels[0];

  // The section always appears. Rendering nothing when the feature was off left
  // no way to discover it existed at all.
  const configured = travel.isConfigured();
  sectionTitle(
    parent,
    origin ? `Getting around · from ${origin.label}` : "Getting around",
    configured
      ? {
          label: places ? "Refresh" : "Calculate",
          icon: places ? "refresh-cw" : "route",
          onClick: () => void plugin.computeTravelTimes(trip, ctx.refresh, Boolean(places)),
        }
      : { label: "Settings", icon: "settings", onClick: () => plugin.openSettings() },
  );

  if (!plugin.settings.travelTimesEnabled) {
    renderNotice(
      parent,
      "Travel times are switched off.",
      "Turn them on in settings to see how far the hotel is from the airport, your activities and your restaurants. They use the Google Maps APIs and bill your own account.",
    );
    return;
  }
  if (!configured) {
    renderNotice(
      parent,
      "No Google API key set.",
      "Add one under Settings → Travel Planner → Travel times. Geocoding API and Distance Matrix API need enabling on that project.",
    );
    return;
  }

  const stays = plugin.bookings.getBookings(trip).filter((b) => b.kind === "stay");
  if (stays.length === 0) {
    renderNotice(
      parent,
      "Nowhere to measure from yet.",
      "Distances are worked out from your accommodation — add where you are staying first.",
    );
    return;
  }

  if (!places) {
    renderNotice(
      parent,
      "Not calculated yet.",
      "Calculate works out the driving and public transport time from your accommodation to the airport, each activity and every Food Spot restaurant in this city.",
    );
    return;
  }

  if (!origin) {
    renderNotice(
      parent,
      "Could not place your accommodation.",
      "Add a street address to the booking so it can be found on a map, then calculate again.",
    );
    return;
  }

  renderFlights(parent, ctx);

  const modes = plugin.settings.travelModes;
  const groups: { title: string; items: Place[] }[] = [
    // Named as the transfer it is: on arrival you travel airport to hotel.
    { title: `Airport transfer · to ${origin.label}`, items: places.airports },
    { title: `Activities · from ${origin.label}`, items: places.activities },
    { title: `Restaurants · from ${origin.label}`, items: places.restaurants },
  ];

  let rendered = 0;
  for (const group of groups) {
    if (group.items.length === 0) continue;
    const legs = travel.peekLegs(origin, group.items, modes);
    if (legs.size === 0) continue;
    rendered += 1;

    parent.createDiv({ cls: "tp-around-group", text: group.title });
    const list = parent.createDiv({ cls: "tp-around-list" });

    // Nearest first — that is the question being asked.
    const sorted = [...group.items].sort(
      (a, b) => shortest(legs.get(a.id)) - shortest(legs.get(b.id)),
    );
    for (const place of sorted) {
      const placeLegs = legs.get(place.id);
      if (placeLegs) renderRow(list, place, placeLegs, modes, ctx);
    }
  }

  if (rendered === 0) {
    renderNotice(
      parent,
      "No routes found.",
      "Try Refresh, or check that the addresses on your bookings are specific enough to find on a map.",
    );
  }
}

/** Says what is missing and what to do about it, rather than showing nothing. */
function renderNotice(parent: HTMLElement, title: string, detail: string): void {
  const box = parent.createDiv({ cls: "tp-around-notice" });
  setIcon(box.createDiv({ cls: "tp-around-notice-icon" }), "route");
  const text = box.createDiv();
  text.createDiv({ cls: "tp-around-notice-title", text: title });
  text.createDiv({ cls: "tp-around-notice-detail", text: detail });
}

function shortest(legs: TravelLeg[] | undefined): number {
  if (!legs || legs.length === 0) return Number.MAX_SAFE_INTEGER;
  return Math.min(...legs.map((l) => l.durationSeconds));
}

function renderRow(
  parent: HTMLElement,
  place: Place,
  legs: TravelLeg[],
  modes: TravelMode[],
  ctx: DashboardContext,
): void {
  const row = parent.createDiv({ cls: "tp-around-row" });

  const text = row.createDiv({ cls: "tp-around-text" });
  text.createDiv({ cls: "tp-around-name", text: place.label });

  const walking = legs.find((l) => l.mode === "walking");
  const driving = legs.find((l) => l.mode === "driving");
  const reference = walking ?? driving ?? legs[0];
  if (reference) {
    text.createDiv({ cls: "tp-around-dist", text: formatDistance(reference.distanceMeters) });
  }

  const times = row.createDiv({ cls: "tp-around-times" });
  for (const mode of modes) {
    const leg = legs.find((l) => l.mode === mode);
    const label = TRAVEL_MODES.find((m) => m.id === mode)?.label ?? mode;

    // A mode with no route gets a struck-through chip rather than vanishing:
    // "no bus goes there" and "the plugin forgot" look identical otherwise.
    const chip = times.createDiv({ cls: `tp-around-chip is-${mode}${leg ? "" : " is-none"}` });
    setIcon(chip.createSpan({ cls: "tp-around-chip-icon" }), MODE_ICON.get(mode) ?? "route");
    chip.createSpan({ text: leg ? formatDuration(leg.durationSeconds) : "none" });
    chip.setAttribute(
      "aria-label",
      leg
        ? `${label}: ${formatDistance(leg.distanceMeters)}`
        : `${label}: no route found`,
    );
    chip.setAttribute("title", leg ? `${label} · ${formatDistance(leg.distanceMeters)}` : `No ${label.toLowerCase()} route found`);
  }

  if (place.file) {
    row.addClass("is-clickable");
    row.addEventListener("click", () => ctx.openFile(place.file!));
  }
}

/**
 * The flights themselves — total journey, stops and layovers.
 *
 * Read from the legs already on the booking, so this needs no API at all. The
 * ground transfer to the airport is only half of "how long does getting there
 * take"; the flight is the other half.
 */
function renderFlights(parent: HTMLElement, ctx: DashboardContext): void {
  const { trip, plugin, app } = ctx;
  if (!trip) return;

  const flights = plugin.bookings
    .getBookings(trip)
    .filter((b) => b.kind === "flight" && b.status !== "cancelled");
  if (flights.length === 0) return;

  const readLegs = (value: unknown): FlightLeg[] =>
    Array.isArray(value)
      ? value.map((raw) => {
          const leg = raw as Record<string, string>;
          return {
            operator: leg?.airline ?? "",
            number: leg?.flight ?? "",
            from: leg?.from ?? "",
            to: leg?.to ?? "",
            date: leg?.date ?? "",
            depTime: leg?.departs ?? "",
            arrDate: leg?.arrives_on ?? leg?.date ?? "",
            arrTime: leg?.arrives ?? "",
          };
        })
      : [];

  parent.createDiv({ cls: "tp-around-group", text: "Flights" });
  const list = parent.createDiv({ cls: "tp-around-list" });

  for (const flight of flights) {
    const fm = app.metadataCache.getFileCache(flight.file)?.frontmatter;
    const outbound = readLegs(fm?.legs);
    const inbound = readLegs(fm?.return_legs);

    const directions: { label: string; legs: FlightLeg[]; fallbackTime: string }[] = [
      { label: "Outbound", legs: outbound, fallbackTime: flight.time },
      { label: "Return", legs: inbound, fallbackTime: flight.returnTime },
    ];

    for (const direction of directions) {
      // A direct flight has no legs recorded; fall back to the booking itself.
      // Bookings saved before legs were stored for direct flights have no legs
      // at all. The booking's own end is the outbound arrival only on a
      // one-way; on a return ticket it is when you land back home, so the
      // arrival is left unknown rather than reported as seven days.
      const oneWay = !flight.returnDate;
      const legs =
        direction.legs.length > 0
          ? direction.legs
          : direction.label === "Outbound"
            ? [
                {
                  operator: flight.operator,
                  number: flight.title,
                  from: flight.from,
                  to: flight.to,
                  date: flight.date,
                  depTime: flight.time,
                  arrDate: oneWay ? flight.endDate : "",
                  arrTime: oneWay ? flight.endTime : "",
                },
              ]
            : [];
      if (legs.length === 0) continue;

      const row = list.createDiv({ cls: "tp-around-row is-clickable" });
      const text = row.createDiv({ cls: "tp-around-text" });
      text.createDiv({
        cls: "tp-around-name",
        text: `${direction.label} · ${routeTitle(legs) || flight.title}`,
      });

      const stops = legs.length - 1;
      const bits: string[] = [
        legs[0].date && legs[0].depTime ? `${legs[0].date} ${legs[0].depTime}` : legs[0].date,
        stops === 0 ? "direct" : `${stops} stop${stops === 1 ? "" : "s"}`,
      ].filter(Boolean);

      for (let i = 1; i < legs.length; i += 1) {
        const gap = layoverMinutes(legs[i - 1], legs[i]);
        if (gap === null) continue;
        bits.push(
          `${formatLayover(gap)} in ${legs[i - 1].to || "transit"}${gap < TIGHT_CONNECTION_MINUTES ? " (tight)" : ""}`,
        );
      }
      text.createDiv({ cls: "tp-around-dist", text: bits.join(" · ") });

      // The longest scheduled flight on earth is under 20 hours; anything
      // beyond a day is data being misread, and a number is worse than none.
      const raw = totalJourneyMinutes(legs);
      const total = raw !== null && raw > 24 * 60 ? null : raw;
      const times = row.createDiv({ cls: "tp-around-times" });
      const chip = times.createDiv({ cls: "tp-around-chip is-flight" });
      setIcon(chip.createSpan({ cls: "tp-around-chip-icon" }), "plane");
      chip.createSpan({ text: total === null ? "—" : formatLayover(total) });
      chip.setAttribute(
        "title",
        total === null
          ? "Arrival time not recorded — re-save the flight to fill it in"
          : "Total journey, including time on the ground",
      );

      row.addEventListener("click", () => ctx.openFile(flight.file));
    }
  }
}

/** Markdown for writing travel times into a note. */
export function travelTable(
  origin: Place,
  destinations: Place[],
  legs: Map<string, TravelLeg[]>,
  modes: TravelMode[],
): string {
  const usable = destinations.filter((d) => legs.has(d.id));
  if (usable.length === 0) return "";

  const header = ["| Destination | Distance |", "|---|---|"];
  const columns = modes.filter((mode) =>
    usable.some((d) => legs.get(d.id)?.some((l) => l.mode === mode)),
  );
  for (const mode of columns) {
    const label = TRAVEL_MODES.find((m) => m.id === mode)?.label ?? mode;
    header[0] += ` ${label} |`;
    header[1] += "---|";
  }

  const rows = usable
    .sort((a, b) => shortest(legs.get(a.id)) - shortest(legs.get(b.id)))
    .map((place) => {
      const placeLegs = legs.get(place.id) ?? [];
      const reference = placeLegs.find((l) => l.mode === "walking") ?? placeLegs[0];
      let row = `| ${place.label} | ${reference ? formatDistance(reference.distanceMeters) : "—"} |`;
      for (const mode of columns) {
        const leg = placeLegs.find((l) => l.mode === mode);
        row += ` ${leg ? formatDuration(leg.durationSeconds) : "—"} |`;
      }
      return row;
    });

  return [`### From ${origin.label}`, "", ...header, ...rows, ""].join("\n");
}
