import { App, TFile, TFolder, normalizePath } from "obsidian";
import type { BookingKind, BookingStatus, CostCategory } from "./types";
import { BOOKING_KINDS } from "./types";
import type { TravelPlannerSettings, Trip } from "../types";
import { joinPath, sanitizeName } from "../util/paths";
import { airportFromLabel } from "../ui/components/suggest";
import { legsToFrontmatter, layoverMinutes, formatLayover, type FlightLeg } from "./legs";

export interface BookingDraft {
  kind: BookingKind;
  status: BookingStatus;
  title: string;
  date: string;
  endDate: string;
  time: string;
  endTime: string;
  amount: number | null;
  currency: string;
  category: CostCategory;
  reference: string;
  from: string;
  to: string;
  address: string;
  operator: string;
  seat: string;
  notes: string;
  /** Vault paths of files to attach, already inside the vault. */
  attachments: string[];
  /** Flight legs; a direct flight is one, a connection is several. */
  legs: FlightLeg[];
  /** The way home, on the same ticket. Empty for a one-way. */
  returnLegs: FlightLeg[];
}

export interface ExpenseDraft {
  date: string;
  description: string;
  amount: number;
  currency: string;
  category: CostCategory;
  paidBy: string;
  attachments: string[];
}

async function ensureFolder(app: App, path: string): Promise<void> {
  const normalized = normalizePath(path);
  if (!normalized || normalized === "/") return;
  if (app.vault.getAbstractFileByPath(normalized) instanceof TFolder) return;

  let cursor = "";
  for (const part of normalized.split("/")) {
    cursor = cursor ? `${cursor}/${part}` : part;
    if (app.vault.getAbstractFileByPath(cursor) instanceof TFolder) continue;
    try {
      await app.vault.createFolder(cursor);
    } catch {
      if (!(app.vault.getAbstractFileByPath(cursor) instanceof TFolder)) throw new Error(`Could not create ${cursor}`);
    }
  }
}

function uniquePath(app: App, folder: string, base: string, ext = ".md"): string {
  let candidate = joinPath(folder, base + ext);
  let n = 2;
  while (app.vault.getAbstractFileByPath(candidate)) {
    candidate = joinPath(folder, `${base} ${n}${ext}`);
    n += 1;
  }
  return candidate;
}

export function bookingsFolderFor(settings: TravelPlannerSettings, trip: Trip): string {
  return joinPath(trip.folderPath, settings.bookingsFolder);
}

export function attachmentsFolderFor(settings: TravelPlannerSettings, trip: Trip): string {
  return joinPath(trip.folderPath, settings.attachmentsFolder);
}

/**
 * Copies dropped or picked files into the trip's attachments folder and returns
 * their vault paths. Keeping them inside the trip means the whole thing moves,
 * syncs and deletes as one unit.
 */
export async function importAttachments(
  app: App,
  settings: TravelPlannerSettings,
  trip: Trip,
  files: File[],
): Promise<string[]> {
  if (files.length === 0) return [];
  const folder = attachmentsFolderFor(settings, trip);
  await ensureFolder(app, folder);

  const paths: string[] = [];
  for (const file of files) {
    const dot = file.name.lastIndexOf(".");
    const base = sanitizeName(dot > 0 ? file.name.slice(0, dot) : file.name);
    const ext = dot > 0 ? file.name.slice(dot) : "";
    const path = uniquePath(app, folder, base, ext);
    const buffer = await file.arrayBuffer();
    await app.vault.createBinary(path, buffer);
    paths.push(path);
  }
  return paths;
}

/** How many attachments already start with this name, so numbering continues. */
export function countAttachmentsNamed(
  app: App,
  settings: TravelPlannerSettings,
  trip: Trip,
  baseName: string,
): number {
  const folder = app.vault.getAbstractFileByPath(attachmentsFolderFor(settings, trip));
  if (!(folder instanceof TFolder) || !baseName) return 0;
  const prefix = baseName.toLowerCase();
  return folder.children.filter(
    (child) => child instanceof TFile && child.basename.toLowerCase().startsWith(prefix),
  ).length;
}

function linksFor(app: App, paths: string[], sourcePath: string): string[] {
  return paths
    .map((path) => {
      const file = app.vault.getAbstractFileByPath(path);
      return file instanceof TFile ? app.fileManager.generateMarkdownLink(file, sourcePath) : null;
    })
    .filter((link): link is string => link !== null);
}

function isImage(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(path);
}

function bookingBody(draft: BookingDraft, attachmentLinks: string[]): string {
  const rows: string[] = [];
  const add = (label: string, value: string) => {
    if (value) rows.push(`| **${label}** | ${value} |`);
  };

  add("Status", draft.status);
  add("Date", draft.endDate && draft.endDate !== draft.date ? `${draft.date} → ${draft.endDate}` : draft.date);
  add("Time", draft.endTime ? `${draft.time} → ${draft.endTime}` : draft.time);
  add("From", draft.from);
  add("To", draft.to);
  add("Address", draft.address);
  add("Operator", draft.operator);
  add("Seat", draft.seat);
  add("Reference", draft.reference);

  const out = [`# ${draft.title}`, ""];
  if (rows.length) out.push("| | |", "|---|---|", ...rows, "");

  const itinerary = (legs: FlightLeg[], heading: string): void => {
    if (legs.length === 0) return;
    out.push(`## ${heading}`, "");
    out.push("| Leg | Airline | Flight | From | To | Departs | Arrives |");
    out.push("|---|---|---|---|---|---|---|");
    legs.forEach((leg, index) => {
      const arrives = leg.arrDate && leg.arrDate !== leg.date ? `${leg.arrTime} (+1)` : leg.arrTime;
      out.push(
        `| ${index + 1} | ${leg.operator} | ${leg.number} | ${leg.from} | ${leg.to} | ${leg.date} ${leg.depTime} | ${arrives} |`,
      );
    });
    out.push("");
    // Connection times are the thing you actually worry about when booking.
    const layovers: string[] = [];
    for (let i = 1; i < legs.length; i += 1) {
      const gap = layoverMinutes(legs[i - 1], legs[i]);
      if (gap !== null) layovers.push(`- ${formatLayover(gap)} in ${legs[i - 1].to || "transit"}`);
    }
    if (layovers.length) out.push("**Layovers**", "", ...layovers, "");
  };

  if (draft.legs.length > 1 || draft.returnLegs.length > 0) {
    itinerary(draft.legs, draft.returnLegs.length > 0 ? "Outbound" : "Itinerary");
    itinerary(draft.returnLegs, "Return");
  }
  if (draft.notes.trim()) out.push("## Notes", "", draft.notes.trim(), "");
  if (attachmentLinks.length) {
    out.push("## Attachments", "");
    for (const link of attachmentLinks) {
      // Images embed; PDFs and the rest stay as links so the note stays readable.
      out.push(isImage(link) ? `!${link}` : `- ${link}`);
    }
    out.push("");
  }
  return out.join("\n");
}

export async function createBooking(
  app: App,
  settings: TravelPlannerSettings,
  trip: Trip,
  draft: BookingDraft,
): Promise<TFile> {
  const folder = bookingsFolderFor(settings, trip);
  await ensureFolder(app, folder);

  const kindDef = BOOKING_KINDS.find((k) => k.id === draft.kind);
  const base = sanitizeName(draft.title || kindDef?.label || "Booking");
  const path = uniquePath(app, folder, base);
  const file = await app.vault.create(path, "");

  const links = linksFor(app, draft.attachments, path);

  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.type = "booking";
    fm.booking_kind = draft.kind;
    fm.status = draft.status;
    fm.title = draft.title;
    // Recorded explicitly so the store never has to guess the owning trip from
    // the folder depth.
    fm.trip_folder = trip.folderPath;
    fm.trip = app.fileManager.generateMarkdownLink(trip.file, path);
    fm.date = draft.date;
    if (draft.endDate && draft.endDate !== draft.date) fm.end_date = draft.endDate;
    if (draft.time) fm.time = draft.time;
    if (draft.endTime) fm.end_time = draft.endTime;
    if (draft.amount !== null) {
      fm.cost = draft.amount;
      fm.currency = draft.currency;
    }
    fm.category = draft.category;
    // An airport picked from the list already knows where it is, so travel
    // times can skip the billed geocoding call entirely.
    const airport = airportFromLabel(draft.to) ?? airportFromLabel(draft.from);
    if (draft.kind === "flight" && airport) fm.location = `${airport.a},${airport.o}`;
    if (draft.reference) fm.reference = draft.reference;
    if (draft.from) fm.from = draft.from;
    if (draft.to) fm.to = draft.to;
    if (draft.address) fm.address = draft.address;
    if (draft.operator) fm.operator = draft.operator;
    if (draft.seat) fm.seat = draft.seat;
    if (draft.legs.length > 1) fm.legs = legsToFrontmatter(draft.legs);
    if (draft.returnLegs.length > 0) fm.return_legs = legsToFrontmatter(draft.returnLegs);
    if (links.length) fm.attachments = links;
  });

  const head = await app.vault.read(file);
  await app.vault.modify(file, `${head.trimEnd()}\n\n${bookingBody(draft, links)}`);
  return file;
}

export async function createExpense(
  app: App,
  settings: TravelPlannerSettings,
  trip: Trip,
  draft: ExpenseDraft,
): Promise<TFile> {
  const folder = bookingsFolderFor(settings, trip);
  await ensureFolder(app, folder);

  const base = sanitizeName(`${draft.date} ${draft.description}`.trim() || "Expense");
  const path = uniquePath(app, folder, base);
  const file = await app.vault.create(path, "");
  const links = linksFor(app, draft.attachments, path);

  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.type = "expense";
    fm.description = draft.description;
    fm.trip_folder = trip.folderPath;
    fm.trip = app.fileManager.generateMarkdownLink(trip.file, path);
    fm.date = draft.date;
    fm.amount = draft.amount;
    fm.currency = draft.currency;
    fm.category = draft.category;
    if (draft.paidBy) fm.paid_by = draft.paidBy;
    if (links.length) fm.attachments = links;
  });

  const body = [`# ${draft.description}`, ""];
  if (links.length) {
    body.push("## Receipt", "");
    for (const link of links) body.push(isImage(link) ? `!${link}` : `- ${link}`);
    body.push("");
  }

  const head = await app.vault.read(file);
  await app.vault.modify(file, `${head.trimEnd()}\n\n${body.join("\n")}`);
  return file;
}

/**
 * Places an activity on a day.
 *
 * The itinerary and the activity list used to be two disconnected records of
 * the same plan; this is the link between them, so the timeline, the day-by-day
 * note and the booking all agree.
 */
export async function assignBookingToDay(
  app: App,
  file: TFile,
  date: string,
  slot: string | null,
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.date = date;
    if (slot) fm.slot = slot;
    else delete fm.slot;
  });
}

/** Writes budget targets onto the trip note as a `budget:` map. */
export async function saveBudget(
  app: App,
  trip: Trip,
  budget: Map<CostCategory, number>,
  currency: string,
  total: number | null,
): Promise<void> {
  await app.fileManager.processFrontMatter(trip.file, (fm) => {
    if (total !== null && total > 0) fm.budget_total = total;
    else delete fm.budget_total;
    const out: Record<string, number> = {};
    for (const [category, amount] of budget) {
      if (Number.isFinite(amount) && amount > 0) out[category] = amount;
    }
    if (Object.keys(out).length) fm.budget = out;
    else delete fm.budget;
    fm.currency = currency;
  });
}
