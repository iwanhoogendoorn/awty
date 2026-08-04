import { TFile, setIcon } from "obsidian";
import type { DashboardContext } from "../common";
import { emptyState, sectionTitle, noTripState } from "../common";
import type { Booking } from "../../../bookings/types";
import { BOOKING_KINDS } from "../../../bookings/types";
import { formatMoney } from "../../../util/money";
import { datesInRange, monthName, parseISO, todayISO } from "../../../util/dates";
import type { Place } from "../../../travel/types";
import {
  TRAVEL_MODES,
  formatDistance,
  formatDuration as formatTravelDuration,
} from "../../../travel/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** One thing that happens at a point in time, as opposed to a stay that lasts. */
interface DayEvent {
  time: string;
  title: string;
  detail: string;
  icon: string;
  cost: string;
  file: TFile;
}

/** A stay in progress on a given day, shown as a rail rather than a row. */
interface Ongoing {
  title: string;
  night: number;
  nights: number;
  file: TFile;
}

/**
 * Events that actually happen on a date.
 *
 * A hotel booked for seven nights is one check-in and one check-out, not seven
 * identical rows; a return flight is two departures, not a thing that happens
 * continuously for a week. Spanning bookings used to be matched with
 * `date >= start && date <= end`, which repeated them on every day between.
 */
function eventsFor(booking: Booking, date: string): DayEvent[] {
  const def = BOOKING_KINDS.find((k) => k.id === booking.kind);
  const icon = def?.icon ?? "ticket";
  const cost = booking.cost ? formatMoney(booking.cost) : "";
  const out: DayEvent[] = [];

  if (booking.kind === "stay") {
    if (date === booking.date) {
      out.push({
        time: booking.time,
        title: booking.title,
        detail: "Check in",
        icon,
        cost,
        file: booking.file,
      });
    }
    if (booking.endDate && date === booking.endDate && booking.endDate !== booking.date) {
      out.push({
        time: booking.endTime,
        title: booking.title,
        detail: "Check out",
        icon,
        // The price belongs to the stay, and it is already shown at check-in.
        cost: "",
        file: booking.file,
      });
    }
    return out;
  }

  if (booking.kind === "flight") {
    if (date === booking.date) {
      out.push({
        time: booking.time,
        title: booking.title,
        detail: [booking.from, booking.to].filter(Boolean).join(" → ") || "Outbound",
        icon,
        cost,
        file: booking.file,
      });
    }
    if (booking.returnDate && date === booking.returnDate) {
      out.push({
        time: booking.returnTime,
        title: booking.title,
        detail: `Return · ${[booking.to, booking.from].filter(Boolean).join(" → ")}`,
        icon,
        cost: "",
        file: booking.file,
      });
    }
    return out;
  }

  if (date !== booking.date) return out;
  out.push({
    time: booking.time,
    title: booking.title,
    detail: booking.slot ? booking.slot : (booking.to ?? ""),
    icon,
    cost,
    file: booking.file,
  });
  return out;
}

/** A stay covering this date, but neither arriving nor leaving on it. */
function ongoingFor(booking: Booking, date: string): Ongoing | null {
  if (booking.kind !== "stay") return null;
  if (!booking.endDate || booking.endDate === booking.date) return null;
  if (date <= booking.date || date >= booking.endDate) return null;

  const nights = datesInRange(booking.date, booking.endDate).length - 1;
  const night = datesInRange(booking.date, date).length - 1;
  return { title: booking.title, night, nights, file: booking.file };
}

export function renderItinerary(parent: HTMLElement, ctx: DashboardContext): void {
  const { trip, plugin } = ctx;
  if (!trip) {
    noTripState(parent, ctx, "calendar-days");
    return;
  }

  const days = datesInRange(trip.startDate, trip.endDate, 90);
  if (days.length === 0) {
    emptyState(parent, "calendar-days", "No dates", "This trip has no valid start date.");
    return;
  }

  const bookings = plugin.bookings.getBookings(trip).filter((b) => b.status !== "cancelled");
  const today = todayISO();

  const itineraryNote = plugin.store.getSubNotes(trip).find((s) => s.id === "itinerary");
  sectionTitle(parent, "Day by day", {
    label: "Plan a day",
    icon: "calendar-plus",
    onClick: () => plugin.openAddDayModal(trip),
  });
  if (itineraryNote) {
    const open = parent.createDiv({ cls: "tp-dash-hint tp-timeline-open" });
    const link = open.createEl("a", { text: "Open the itinerary note" });
    link.addEventListener("click", () => ctx.openFile(itineraryNote.file));
  }

  const router = makeRouter(ctx);
  const timeline = parent.createDiv({ cls: "tp-timeline" });

  for (const [index, date] of days.entries()) {
    const parsed = parseISO(date);
    const events = bookings
      .flatMap((b) => eventsFor(b, date))
      .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
    const ongoing = bookings
      .map((b) => ongoingFor(b, date))
      .filter((o): o is Ongoing => o !== null);

    const row = timeline.createDiv({
      cls: `tp-day${date === today ? " is-today" : ""}${date < today ? " is-past" : ""}`,
    });

    const marker = row.createDiv({ cls: "tp-day-marker" });
    marker.createDiv({ cls: "tp-day-num", text: parsed ? String(parsed.getUTCDate()) : "?" });
    marker.createDiv({ cls: "tp-day-dow", text: parsed ? WEEKDAYS[parsed.getUTCDay()] : "" });

    const body = row.createDiv({ cls: "tp-day-body" });
    const head = body.createDiv({ cls: "tp-day-head" });
    head.createSpan({ cls: "tp-day-label", text: `Day ${index + 1}` });
    head.createSpan({
      cls: "tp-day-date",
      text: parsed ? `${parsed.getUTCDate()} ${monthName(date)}` : date,
    });
    if (date === today) head.createSpan({ cls: "tp-day-today", text: "Today" });

    // Where you are sleeping, as a quiet one-liner rather than another card.
    for (const stay of ongoing) {
      const rail = body.createDiv({ cls: "tp-day-ongoing" });
      setIcon(rail.createSpan({ cls: "tp-day-ongoing-icon" }), "bed");
      rail.createSpan({ text: `${stay.title} · night ${stay.night} of ${stay.nights}` });
      rail.addEventListener("click", () => ctx.openFile(stay.file));
    }

    if (events.length === 0) {
      if (ongoing.length === 0) body.createDiv({ cls: "tp-day-empty", text: "Nothing planned" });
      continue;
    }

    const list = body.createDiv({ cls: "tp-day-items" });

    // You wake up where you slept, so the first hop of a day is from the hotel
    // — unless the day starts by arriving at it.
    if (router && ongoing.length > 0) {
      router.hop(list, router.base, router.placeFor(events[0].file), router.base?.label);
    }

    for (const [position, event] of events.entries()) {
      const item = list.createDiv({ cls: "tp-day-item" });
      item.createDiv({ cls: "tp-day-item-time", text: event.time || "—" });
      setIcon(item.createDiv({ cls: "tp-day-item-icon" }), event.icon);

      const text = item.createDiv({ cls: "tp-day-item-text" });
      text.createDiv({ cls: "tp-day-item-title", text: event.title });
      if (event.detail) text.createDiv({ cls: "tp-day-item-meta", text: event.detail });

      if (event.cost) item.createDiv({ cls: "tp-day-item-cost", text: event.cost });
      item.addEventListener("click", () => ctx.openFile(event.file));

      // Drawn between the two items it joins, not stacked below the day: a
      // pile of times at the bottom said nothing about which hop each was.
      const next = events[position + 1];
      if (router && next) {
        router.hop(list, router.placeFor(event.file), router.placeFor(next.file));
      }
    }
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
      const row = parent.createDiv({ cls: "tp-leg" });
      setIcon(row.createSpan({ cls: "tp-leg-icon" }), "move-right");
      row.createSpan({
        cls: "tp-leg-text",
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
