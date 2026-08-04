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
  if (!travel.isConfigured()) {
    if (!plugin.settings.travelTimesEnabled) return;
    sectionTitle(parent, "Getting around");
    parent.createDiv({
      cls: "tp-dash-hint",
      text: "Add a Google API key in Travel Planner settings to see travel times.",
    });
    return;
  }

  const places = plugin.travelPlaces.get(trip.folderPath);
  if (!places) {
    sectionTitle(parent, "Getting around", {
      label: "Calculate",
      icon: "route",
      onClick: () => void plugin.computeTravelTimes(trip, ctx.refresh),
    });
    parent.createDiv({
      cls: "tp-dash-hint",
      text: "Work out how far the hotel is from the airport, your activities and your restaurants.",
    });
    return;
  }

  const origin = places.hotels[0];
  if (!origin) {
    sectionTitle(parent, "Getting around");
    parent.createDiv({
      cls: "tp-dash-hint",
      text: "Add an accommodation booking — distances are measured from where you're staying.",
    });
    return;
  }

  sectionTitle(parent, `Getting around · from ${origin.label}`, {
    label: "Refresh",
    icon: "refresh-cw",
    onClick: () => void plugin.computeTravelTimes(trip, ctx.refresh, true),
  });

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
    const sorted = [...group.items].sort((a, b) => shortest(legs.get(a.id)) - shortest(legs.get(b.id)));

    for (const place of sorted) {
      const placeLegs = legs.get(place.id);
      if (!placeLegs) continue;
      renderRow(list, place, placeLegs, ctx);
    }
  }

  if (rendered === 0) {
    parent.createDiv({
      cls: "tp-dash-hint",
      text: "No routes found yet. Try Refresh, or check that the addresses on your bookings are specific enough to find.",
    });
  }
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
