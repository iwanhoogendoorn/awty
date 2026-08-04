import { setIcon } from "obsidian";
import type { DashboardContext } from "../common";
import { emptyState, sectionTitle } from "../common";
import { BOOKING_KINDS } from "../../../bookings/types";
import { formatMoney } from "../../../util/money";
import { datesInRange, monthName, parseISO, todayISO } from "../../../util/dates";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Day-by-day timeline, with bookings dropped onto the days they happen. */
export function renderItinerary(parent: HTMLElement, ctx: DashboardContext): void {
  const { trip, plugin } = ctx;
  if (!trip) {
    emptyState(parent, "calendar-days", "No trip selected", "Pick a trip from the dropdown above.");
    return;
  }

  const days = datesInRange(trip.startDate, trip.endDate, 90);
  if (days.length === 0) {
    emptyState(parent, "calendar-days", "No dates", "This trip has no valid start date.");
    return;
  }

  const bookings = plugin.bookings.getBookings(trip).filter((b) => b.status !== "cancelled");
  const today = todayISO();

  const itineraryNote = plugin.store
    .getSubNotes(trip)
    .find((s) => s.id === "itinerary");

  sectionTitle(
    parent,
    "Day by day",
    itineraryNote
      ? { label: "Open itinerary", icon: "file-text", onClick: () => ctx.openFile(itineraryNote.file) }
      : undefined,
  );

  const timeline = parent.createDiv({ cls: "tp-timeline" });

  for (const [index, date] of days.entries()) {
    const parsed = parseISO(date);
    const dayBookings = bookings.filter((b) => date >= b.date && date <= (b.endDate || b.date));

    const row = timeline.createDiv({
      cls: `tp-day${date === today ? " is-today" : ""}${date < today ? " is-past" : ""}`,
    });

    const marker = row.createDiv({ cls: "tp-day-marker" });
    marker.createDiv({ cls: "tp-day-num", text: parsed ? String(parsed.getUTCDate()) : "?" });
    marker.createDiv({
      cls: "tp-day-dow",
      text: parsed ? WEEKDAYS[parsed.getUTCDay()] : "",
    });

    const body = row.createDiv({ cls: "tp-day-body" });
    const head = body.createDiv({ cls: "tp-day-head" });
    head.createSpan({ cls: "tp-day-label", text: `Day ${index + 1}` });
    head.createSpan({
      cls: "tp-day-date",
      text: parsed ? `${parsed.getUTCDate()} ${monthName(date)}` : date,
    });
    if (date === today) head.createSpan({ cls: "tp-day-today", text: "Today" });

    if (dayBookings.length === 0) {
      body.createDiv({ cls: "tp-day-empty", text: "Nothing planned" });
      continue;
    }

    const list = body.createDiv({ cls: "tp-day-items" });
    for (const booking of dayBookings) {
      const def = BOOKING_KINDS.find((k) => k.id === booking.kind);
      const item = list.createDiv({ cls: "tp-day-item" });
      setIcon(item.createDiv({ cls: "tp-day-item-icon" }), def?.icon ?? "ticket");

      const text = item.createDiv({ cls: "tp-day-item-text" });
      // A hotel spans nights, so say which part of the stay this day is.
      const multiDay = booking.endDate && booking.endDate !== booking.date;
      const suffix = multiDay
        ? date === booking.date
          ? " · check-in"
          : date === booking.endDate
            ? " · check-out"
            : ""
        : "";
      text.createDiv({ cls: "tp-day-item-title", text: booking.title + suffix });
      const meta = [booking.time, booking.from && booking.to ? `${booking.from} → ${booking.to}` : ""]
        .filter(Boolean)
        .join(" · ");
      if (meta) text.createDiv({ cls: "tp-day-item-meta", text: meta });

      if (booking.cost && date === booking.date) {
        item.createDiv({ cls: "tp-day-item-cost", text: formatMoney(booking.cost) });
      }
      item.addEventListener("click", () => ctx.openFile(booking.file));
    }
  }
}
