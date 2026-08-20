import { EMPTY_ADDRESS } from "./postalAddress";
import { App } from "obsidian";
import type { Booking, BookingKind, CostCategory, CostLine } from "./types";
import { budgetLinesTable, budgetPlanTable } from "./budgetTables";
import type { SubNoteId, Trip } from "../types";
import { replaceSection, subNoteFile } from "../store/sectionWriter";
import { formatMoney } from "../util/money";
import { parseLegTable } from "./legTable";
import { inferMissingDestination, legsToFrontmatter } from "./legs";
import { readLegs } from "./flightSummary";
import { airportFromLabel } from "../ui/components/suggest";
import { readLegacyFoodTable } from "./legacyFood";
import { createBooking } from "./bookingWriter";
import type { AwtySettings } from "../types";

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
  { id: "food", kinds: ["restaurant"], heading: "Booked" },
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

export async function syncBookingNotes(
  app: App,
  trip: Trip,
  bookings: Booking[],
  budget?: { targets: Map<CostCategory, number>; lines: CostLine[]; currency: string },
): Promise<void> {
  for (const spec of SYNCED) {
    const file = subNoteFile(app, trip, spec.id);
    if (!file) continue;

    const relevant = bookings.filter((b) => spec.kinds.includes(b.kind));

    // With nothing to write, leave a section alone unless it is already ours.
    // Generating over the top of it destroyed rows typed by hand.
    if (relevant.length === 0) {
      const current = await app.vault.read(file);
      if (readLegacyFoodTable(current).length > 0 && spec.id === "food") continue;
    }

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

  // The Budget note is generated the same way. Targets live on the trip note
  // and prices on the bookings, so left to itself this note stayed empty
  // however much of the trip was budgeted — and its card said "Not started"
  // for ever.
  if (budget) {
    const file = subNoteFile(app, trip, "budget");
    if (file) {
      await replaceSection(
        app,
        file,
        "Planned",
        budgetPlanTable(budget.targets, budget.lines, budget.currency),
      );
      await replaceSection(app, file, "Expenses", budgetLinesTable(budget.lines));
    }
  }
}

/**
 * Turns hand-typed Booked rows into restaurant bookings.
 *
 * The Food note's Booked section is generated now. Anything typed there before
 * restaurants were bookings would be overwritten by the first sync, so it is
 * migrated once, quietly, on load — and then owned by the same machinery as
 * every other booking.
 */
export async function migrateFoodTables(
  app: App,
  settings: AwtySettings,
  trips: Trip[],
): Promise<number> {
  let migrated = 0;

  for (const trip of trips) {
    const file = subNoteFile(app, trip, "food");
    if (!file) continue;

    const rows = readLegacyFoodTable(await app.vault.read(file));
    if (rows.length === 0) continue;

    for (const row of rows) {
      await createBooking(app, settings, trip, {
        kind: "restaurant",
        status: "booked",
        title: row.place,
        date: row.date || trip.startDate,
        endDate: row.date || trip.startDate,
        time: row.time,
        endTime: "",
        amount: null,
        currency: "",
        category: "Food & drink",
        reference: "",
        from: "",
        to: "",
        postal: EMPTY_ADDRESS,
        fromPostal: EMPTY_ADDRESS,
        operator: row.bookedBy,
        seat: "",
        notes: row.notes,
        attachments: [],
        legs: [],
        returnLegs: [],
        ports: [],
        where: "",
        cruise: "",
        mode: "",
        returnDate: "",
        returnTime: "",
        returnEndDate: "",
        returnEndTime: "",
      });
      migrated += 1;
    }
  }
  return migrated;
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

    // An outbound saved without its destination: the return departs from
    // wherever it landed, so the answer is already on the booking.
    const outbound = readLegs(fm.legs);
    const back = readLegs(fm.return_legs);
    const inferred = inferMissingDestination(outbound, back);
    if (inferred) {
      const fixed = [...outbound];
      fixed[fixed.length - 1] = { ...fixed[fixed.length - 1], to: inferred };
      const airport = airportFromLabel(inferred);
      await app.fileManager.processFrontMatter(file, (front) => {
        front.legs = legsToFrontmatter(fixed);
        front.to = inferred;
        // The old location was the departure airport, which is why the
        // transfer read as nineteen hundred kilometres.
        if (airport) front.location = `${airport.a},${airport.o}`;
        else delete front.location;
      });
      repaired += 1;
      continue;
    }

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
