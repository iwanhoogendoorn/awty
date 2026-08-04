import { Notice, setIcon } from "obsidian";
import type { DashboardContext } from "./common";
import { sectionTitle } from "./common";
import type { Place, TravelLeg, TravelMode } from "../../travel/types";
import { TRAVEL_MODES, formatDistance, formatDuration } from "../../travel/types";
import type { TripPlaces } from "../../travel/travelService";

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

  const modes = plugin.settings.travelModes;
  const groups: { title: string; items: Place[] }[] = [
    { title: "Airport", items: places.airports },
    { title: "Activities", items: places.activities },
    { title: "Restaurants", items: places.restaurants },
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
      if (placeLegs) renderRow(list, place, placeLegs, ctx);
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
  for (const leg of legs) {
    const chip = times.createDiv({ cls: `tp-around-chip is-${leg.mode}` });
    setIcon(chip.createSpan({ cls: "tp-around-chip-icon" }), MODE_ICON.get(leg.mode) ?? "route");
    chip.createSpan({ text: formatDuration(leg.durationSeconds) });
    chip.setAttribute(
      "aria-label",
      `${TRAVEL_MODES.find((m) => m.id === leg.mode)?.label ?? leg.mode}: ${formatDistance(leg.distanceMeters)}`,
    );
  }

  if (place.file) {
    row.addClass("is-clickable");
    row.addEventListener("click", () => ctx.openFile(place.file!));
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
