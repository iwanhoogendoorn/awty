import { TFile, setIcon } from "obsidian";
import { momentSummary, momentsOn } from "../../../trips/moments";
import type { DashboardContext } from "../common";
import { editItem, emptyState, itemMenu, sectionTitle, noTripState, touchMenuButton } from "../common";
import type { Booking } from "../../../bookings/types";
import type { DayEvent } from "../../../store/dayPlan";
import { BAND, dayEvents, dayNumber, ongoingOn, tripDays } from "../../../store/dayPlan";
import { readLegs, summariseFlight } from "../../../bookings/flightSummary";
import { datesInRange, monthName, parseISO, todayISO } from "../../../util/dates";
import type { Place } from "../../../travel/types";
import {
  TRAVEL_MODES,
  formatDistance,
  formatDuration as formatTravelDuration,
} from "../../../travel/types";
import { RouteModal } from "../../modals/routeModal";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function renderItinerary(parent: HTMLElement, ctx: DashboardContext): void {
  const { trip, plugin } = ctx;
  if (!trip) {
    noTripState(parent, ctx, "calendar-days");
    return;
  }

  // The days this trip actually covers, not the two dates its note claims —
  // a booking that runs past the end has to have somewhere to be shown.
  const live = plugin.bookings.getBookings(trip).filter((b) => b.status !== "cancelled");
  const days = tripDays(trip, live, 90);
  if (days.length === 0) {
    emptyState(parent, "calendar-days", "No dates", "This trip has no valid start date.");
    return;
  }

  const bookings = live;
  const today = todayISO();

  const itineraryNote = plugin.store.getSubNotes(trip).find((s) => s.id === "itinerary");
  sectionTitle(parent, "Day by day", {
    label: "Plan a day",
    icon: "calendar-plus",
    onClick: () => plugin.openAddDayModal(trip),
  });
  if (itineraryNote) {
    const open = parent.createDiv({ cls: "awty-dash-hint awty-timeline-open" });
    const link = open.createEl("a", { text: "Open the itinerary note" });
    link.addEventListener("click", () => ctx.openFile(itineraryNote.file));
  }

  const router = makeRouter(ctx);
  const timeline = parent.createDiv({ cls: "awty-timeline" });

  for (const date of days) {
    const parsed = parseISO(date);
    const events = dayEvents(bookings, date);
    const ongoing = ongoingOn(bookings, date);

    const row = timeline.createDiv({
      cls: `awty-day${date === today ? " is-today" : ""}${date < today ? " is-past" : ""}`,
    });

    const marker = row.createDiv({ cls: "awty-day-marker" });
    marker.createDiv({ cls: "awty-day-num", text: parsed ? String(parsed.getUTCDate()) : "?" });
    marker.createDiv({ cls: "awty-day-dow", text: parsed ? WEEKDAYS[parsed.getUTCDay()] : "" });

    const body = row.createDiv({ cls: "awty-day-body" });
    const head = body.createDiv({ cls: "awty-day-head" });
    // Numbered from the trip's own first day, so a journey logged the evening
    // before does not renumber the holiday. A day before it has no number.
    const number = dayNumber(trip.startDate, date);
    if (number > 0) head.createSpan({ cls: "awty-day-label", text: `Day ${number}` });
    head.createSpan({
      cls: "awty-day-date",
      text: parsed ? `${parsed.getUTCDate()} ${monthName(date)}` : date,
    });
    if (date === today) head.createSpan({ cls: "awty-day-today", text: "Today" });

    // Capture where it happened. Remembering a day and then hunting for the
    // place to write it down is how it stays unwritten.
    const jot = head.createEl("button", { cls: "awty-day-jot" });
    jot.type = "button";
    jot.setAttribute("aria-label", `Add a moment to ${date}`);
    jot.setAttribute("title", "Add a moment to this day");
    setIcon(jot.createSpan(), "sparkles");
    jot.addEventListener("click", (evt) => {
      evt.stopPropagation();
      plugin.openMomentsModal(trip, date);
    });

    // Where you are sleeping, as a quiet one-liner rather than another card.
    for (const stay of ongoing) {
      const rail = body.createDiv({ cls: "awty-day-ongoing" });
      setIcon(rail.createSpan({ cls: "awty-day-ongoing-icon" }), "bed");
      rail.createSpan({ text: `${stay.title} · night ${stay.night} of ${stay.nights}` });
      rail.addEventListener("click", () => ctx.openFile(stay.file));
    }

    // What the day is remembered for, under what was booked for it. Not an
    // event: a memory has no time and nothing to click through to — it is the
    // one line of the day that was never scheduled.
    const remember = (): void => {
      const kept = momentsOn(trip.moments, date);
      if (kept.length === 0) return;
      const box = body.createDiv({ cls: "awty-day-moments" });
      for (const moment of kept) {
        // The day gets the headline, never the essay: one nine-hundred-word
        // memory laid out in full turns the itinerary into a wall of prose and
        // hides the day it happened on. Clicking opens it where it is editable.
        const line = box.createDiv({ cls: "awty-day-moment" });
        setIcon(line.createSpan({ cls: "awty-day-moment-icon" }), "sparkles");
        line.createSpan({ text: momentSummary(moment) });
        line.setAttribute("title", moment.text);
        line.addEventListener("click", () => plugin.openMomentsModal(trip, moment.date));
      }
    };

    if (events.length === 0) {
      if (ongoing.length === 0 && momentsOn(trip.moments, date).length === 0) {
        body.createDiv({ cls: "awty-day-empty", text: "Nothing planned" });
      }
      remember();
      continue;
    }

    const list = body.createDiv({ cls: "awty-day-items" });

    // You wake up where you slept, so the first hop of a day is from the hotel
    // — unless the day starts by arriving at it.
    // Whichever stay covers this night, not simply the first hotel booked.
    const wokeAt = ongoing[0] ? (router?.placeFor(ongoing[0].file) ?? router?.base) : undefined;
    if (router && wokeAt) {
      router.hop(list, wokeAt, router.placeFor(events[0].file), wokeAt.label);
    }

    for (const [position, event] of events.entries()) {
      const item = list.createDiv({ cls: "awty-day-item" });
      item.createDiv({ cls: "awty-day-item-time", text: event.time || "—" });
      setIcon(item.createDiv({ cls: "awty-day-item-icon" }), event.icon);

      const text = item.createDiv({ cls: "awty-day-item-text" });
      text.createDiv({ cls: "awty-day-item-title", text: event.title });
      const detail = [event.detail, flightDetail(event, ctx)].filter(Boolean).join(" · ");
      if (detail) text.createDiv({ cls: "awty-day-item-meta", text: detail });

      // A price, or a note that this leg was paid for on another row. Blank
      // read as a figure somebody had forgotten to type in.
      if (event.cost) item.createDiv({ cls: "awty-day-item-cost", text: event.cost });
      else if (event.covered) {
        item.createDiv({ cls: "awty-day-item-cost is-covered", text: "included" });
      }
      item.addEventListener("click", () => {
        if (!editItem(ctx, event.file)) ctx.openFile(event.file);
      });
      item.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        itemMenu(evt, ctx, event.file, event.title);
      });
      touchMenuButton(item, `Actions for ${event.title}`, (evt) =>
        itemMenu(evt, ctx, event.file, event.title),
      );

      // Drawn between the two items it joins, not stacked below the day: a
      // pile of times at the bottom said nothing about which hop each was.
      const next = events[position + 1];
      if (router && next) {
        router.hop(list, router.placeFor(event.file), router.placeFor(next.file));
      }
    }

    remember();
  }
}

/**
 * Travel between the places of one day, drawn from the cache only — the
 * timeline never triggers a billed lookup on its own.
 */
interface DayRouter {
  base: Place | undefined;
  placeFor(file: TFile): Place | undefined;
  hop(parent: HTMLElement, from: Place | undefined, to: Place | undefined, fromLabel?: string): void;
}

/**
 * How long the flight itself takes, so the timeline answers the same question
 * the Getting around list does.
 */
function flightDetail(event: DayEvent, ctx: DashboardContext): string {
  if (event.kind !== "flight") return "";

  const fm = ctx.app.metadataCache.getFileCache(event.file)?.frontmatter;
  const legs = readLegs(event.band === BAND.Depart ? fm?.return_legs : fm?.legs);
  if (legs.length === 0) return "";

  const summary = summariseFlight(legs);
  const arrival = summary.arrival ? `lands ${summary.arrival}` : "";
  return [summary.label, ...summary.layovers, arrival].filter(Boolean).join(" · ");
}

function makeRouter(ctx: DashboardContext): DayRouter | null {
  const { trip, plugin } = ctx;
  if (!trip) return null;

  const places = plugin.travelPlaces.get(trip.folderPath);
  if (!places) return null;

  const all = [...places.hotels, ...places.airports, ...places.activities, ...places.restaurants];
  const byPath = new Map(all.filter((p) => p.file).map((p) => [p.file!.path, p]));
  const modes = plugin.settings.travelModes;

  return {
    base: places.hotels[0],
    placeFor: (file) => byPath.get(file.path),
    hop(parent, from, to, fromLabel) {
      if (!from || !to || from.id === to.id) return;

      const legs = plugin.travel.peekLegs(from, [to], modes).get(to.id);
      if (!legs || legs.length === 0) return;

      const reference = legs.find((l) => l.mode === "walking") ?? legs[0];
      const row = parent.createDiv({ cls: "awty-leg is-clickable" });
      row.setAttribute("title", "Measure between two other places");
      row.addEventListener("click", (evt) => {
        evt.stopPropagation();
        new RouteModal(ctx.app, plugin, trip, { from, to }).open();
      });
      setIcon(row.createSpan({ cls: "awty-leg-icon" }), "move-right");
      row.createSpan({
        cls: "awty-leg-text",
        text: [
          fromLabel ? `from ${fromLabel}` : "",
          formatDistance(reference.distanceMeters),
          ...legs.map(
            (leg) =>
              `${TRAVEL_MODES.find((m) => m.id === leg.mode)?.label ?? leg.mode} ${formatTravelDuration(leg.durationSeconds)}`,
          ),
        ]
          .filter(Boolean)
          .join(" · "),
      });
    },
  };
}
