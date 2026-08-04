import { App } from "obsidian";
import type { Booking, BookingKind } from "./types";
import type { SubNoteId, Trip } from "../types";
import { replaceSection, subNoteFile } from "../store/sectionWriter";
import { formatMoney } from "../util/money";
import { parseLegTable } from "./legTable";
import { legsToFrontmatter } from "./legs";

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
  const route =
    booking.from && booking.to ? `${booking.from} → ${booking.to}` : booking.address || booking.to || "";
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

/**
 * Fills in `legs` for flights that never stored them.
 *
 * Direct flights briefly wrote no legs to frontmatter, so their outbound
 * arrival existed only in the note body. Rather than leave those bookings
 * showing a dash for ever, the table is read back and the frontmatter
 * repaired — once, quietly, on load.
 */
export async function backfillFlightLegs(app: App, settings: { tripsFolder: string }): Promise<number> {
  const prefix = settings.tripsFolder ? `${settings.tripsFolder}/` : "";
  let repaired = 0;

  for (const file of app.vault.getMarkdownFiles()) {
    if (prefix && !file.path.startsWith(prefix)) continue;
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || fm.type !== "booking" || fm.booking_kind !== "flight") continue;
    if (Array.isArray(fm.legs) && fm.legs.length > 0) continue;

    const legs = parseLegTable(await app.vault.cachedRead(file), "Outbound");
    if (legs.length === 0) continue;

    await app.fileManager.processFrontMatter(file, (front) => {
      front.legs = legsToFrontmatter(legs);
    });
    repaired += 1;
  }

  return repaired;
}
