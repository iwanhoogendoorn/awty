import { App } from "obsidian";
import type { Booking, BookingKind } from "./types";
import type { SubNoteId, Trip } from "../types";
import { replaceSection, subNoteFile } from "../store/sectionWriter";
import { formatMoney } from "../util/money";

/**
 * Keeps the sub-notes in step with the bookings.
 *
 * Accommodation and Transport used to hold their own hand-typed tables while
 * bookings lived as separate notes, so the same hotel could be entered twice in
 * two places that never agreed. The bookings are now the single source of
 * truth and these sections are generated from them; anything else in the note
 * is left alone.
 */
const SYNCED: { id: SubNoteId; kinds: BookingKind[]; heading: string }[] = [
  { id: "accommodation", kinds: ["stay"], heading: "Bookings" },
  { id: "transport", kinds: ["flight", "transport"], heading: "Bookings" },
];

function row(booking: Booking): string {
  const when = booking.endDate && booking.endDate !== booking.date
    ? `${booking.date} → ${booking.endDate}`
    : booking.date;
  const times = [booking.time, booking.endTime].filter(Boolean).join(" → ");
  const route = booking.from && booking.to ? `${booking.from} → ${booking.to}` : booking.to || "";
  const cells = [
    when,
    times || "",
    `[[${booking.file.basename}]]`,
    route,
    booking.reference || "",
    booking.cost ? formatMoney(booking.cost) : "",
    booking.status,
  ];
  return `| ${cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`;
}

const HEADER = ["When", "Time", "Booking", "Where", "Reference", "Cost", "Status"];

export async function syncBookingNotes(app: App, trip: Trip, bookings: Booking[]): Promise<void> {
  for (const spec of SYNCED) {
    const file = subNoteFile(app, trip, spec.id);
    if (!file) continue;

    const relevant = bookings.filter((b) => spec.kinds.includes(b.kind));
    const body =
      relevant.length === 0
        ? "_Nothing booked yet. Use the wizard to add one._"
        : [
            "_Generated from your bookings — edit a booking to change a row._",
            "",
            `| ${HEADER.join(" | ")} |`,
            `|${HEADER.map(() => "---").join("|")}|`,
            ...relevant.map(row),
          ].join("\n");

    await replaceSection(app, file, spec.heading, body);
  }
}
