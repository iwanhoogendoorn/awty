import { App, TFile, TFolder, normalizePath } from "obsidian";
import type { BookingKind, BookingStatus, CostCategory } from "./types";
import { BOOKING_KINDS } from "./types";
import type { AwtySettings, Trip } from "../types";
import { joinPath, sanitizeName } from "../util/paths";
import { airportFromLabel } from "../ui/components/suggest";
import { legsToFrontmatter, layoverMinutes, formatLayover, type FlightLeg } from "./legs";
import { readLegs as legsFromFrontmatter } from "./flightSummary";
import type { Booking } from "./types";
import { fileFromLink } from "./bookingStore";
import { customParts, sectionText, weaveKept } from "./noteSections";
import { bookingBody, expenseBody, isImage } from "./noteBody";

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
  /** Street address of the departure end. A transfer has two of them. */
  fromAddress: string;
  operator: string;
  seat: string;
  notes: string;
  /** Vault paths of files to attach, already inside the vault. */
  attachments: string[];
  /** Flight legs; a direct flight is one, a connection is several. */
  legs: FlightLeg[];
  /** The way home, on the same ticket. Empty for a one-way. */
  returnLegs: FlightLeg[];
  /** "lat,lng" already known, so travel times skip a billed geocode. */
  location?: string;
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

export function bookingsFolderFor(settings: AwtySettings, trip: Trip): string {
  return joinPath(trip.folderPath, settings.bookingsFolder);
}

export function attachmentsFolderFor(settings: AwtySettings, trip: Trip): string {
  return joinPath(trip.folderPath, settings.attachmentsFolder);
}

/**
 * Copies dropped or picked files into the trip's attachments folder and returns
 * their vault paths. Keeping them inside the trip means the whole thing moves,
 * syncs and deletes as one unit.
 */
export async function importAttachments(
  app: App,
  settings: AwtySettings,
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
  settings: AwtySettings,
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

/**
 * The reverse of `linksFor`: a saved note stores markdown links, but the form
 * works in vault paths. Feeding the links back in unchanged resolved to nothing
 * and quietly dropped every attachment on the first edit.
 */
export function attachmentPaths(app: App, links: string[], sourcePath: string): string[] {
  return links
    .map((link) => fileFromLink(app, link, sourcePath)?.path ?? null)
    .filter((path): path is string => path !== null);
}

function linksFor(app: App, paths: string[], sourcePath: string): string[] {
  return paths
    .map((path) => {
      const file = app.vault.getAbstractFileByPath(path);
      return file instanceof TFile ? app.fileManager.generateMarkdownLink(file, sourcePath) : null;
    })
    .filter((link): link is string => link !== null);
}

/** Frontmatter keys the booking form owns; cleared fields must actually clear. */
const BOOKING_KEYS = [
  "end_date", "time", "end_time", "cost", "currency", "reference", "from", "to",
  "address", "from_address", "operator", "seat", "legs", "return_legs", "attachments", "location",
];

function writeBookingFrontmatter(
  app: App,
  fm: Record<string, unknown>,
  trip: Trip,
  path: string,
  draft: BookingDraft,
  links: string[],
): void {
  for (const key of BOOKING_KEYS) delete fm[key];

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
  // Where it lands, and only that. Falling back to the departure airport put
  // the airport transfer at Amsterdam for a trip to Dubrovnik — 1,919 km from
  // the hotel, stated with total confidence. No destination, no location.
  const airport = airportFromLabel(draft.to);
  if (draft.kind === "flight" && airport) fm.location = `${airport.a},${airport.o}`;
  // A restaurant picked from Food Spot arrives with coordinates already.
  else if (draft.location) fm.location = draft.location;
  if (draft.reference) fm.reference = draft.reference;
  if (draft.from) fm.from = draft.from;
  if (draft.to) fm.to = draft.to;
  if (draft.address) fm.address = draft.address;
  if (draft.fromAddress) fm.from_address = draft.fromAddress;
  if (draft.operator) fm.operator = draft.operator;
  if (draft.seat) fm.seat = draft.seat;
  // Stored even for a direct flight: without it the outbound arrival has to
  // be inferred from the booking's end, which on a return ticket is when you
  // land back home — an outbound "journey" of seven days.
  if (draft.legs.length > 0) fm.legs = legsToFrontmatter(draft.legs);
  if (draft.returnLegs.length > 0) fm.return_legs = legsToFrontmatter(draft.returnLegs);
  if (links.length) fm.attachments = links;
}

/**
 * Saves changes to an existing booking.
 *
 * Editing used to mean opening the note and retyping frontmatter by hand, which
 * is exactly the thing the dashboard exists to avoid.
 */
export async function updateBooking(
  app: App,
  trip: Trip,
  file: TFile,
  draft: BookingDraft,
): Promise<TFile> {
  const links = linksFor(app, draft.attachments, file.path);
  const kept = customParts(await app.vault.read(file));

  await app.fileManager.processFrontMatter(file, (fm) => {
    writeBookingFrontmatter(app, fm, trip, file.path, draft, links);
  });

  const head = await app.vault.read(file);
  const front = head.startsWith("---") ? head.slice(0, head.indexOf("\n---", 3) + 4) : "";
  const body = weaveKept(bookingBody(draft, links), kept);
  await app.vault.modify(file, `${front.trimEnd()}\n\n${body}\n`);

  // A renamed booking keeps its links: renameFile rewrites every reference.
  const wanted = sanitizeName(draft.title || "Booking");
  if (wanted && wanted !== file.basename) {
    const target = uniquePath(app, file.parent?.path ?? "", wanted);
    await app.fileManager.renameFile(file, target);
  }
  return file;
}

/**
 * Turns a saved booking back into a draft the form can edit.
 *
 * Legs come from frontmatter, and the hand-written Notes section from the body,
 * so reopening the form shows exactly what the note says rather than a blank
 * that would overwrite it on save.
 */
export async function draftFromBooking(
  app: App,
  booking: Booking,
): Promise<Partial<BookingDraft>> {
  const fm = app.metadataCache.getFileCache(booking.file)?.frontmatter;
  // The notes live in the body, not in frontmatter. Reopening the form with an
  // empty box would wipe them on save.
  const notes = sectionText(await app.vault.cachedRead(booking.file), "Notes");
  return {
    kind: booking.kind,
    status: booking.status,
    title: booking.title,
    date: booking.date,
    endDate: booking.endDate || booking.date,
    time: booking.time,
    endTime: booking.endTime,
    amount: booking.cost ? booking.cost.amount : null,
    currency: booking.cost?.currency,
    category: booking.category,
    reference: booking.reference,
    from: booking.from,
    to: booking.to,
    address: booking.address,
    fromAddress: booking.fromAddress,
    operator: booking.operator,
    seat: booking.seat,
    notes: booking.notes || notes,
    attachments: attachmentPaths(app, booking.attachments, booking.file.path),
    legs: legsFromFrontmatter(fm?.legs),
    returnLegs: legsFromFrontmatter(fm?.return_legs),
  };
}

export async function createBooking(
  app: App,
  settings: AwtySettings,
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
    writeBookingFrontmatter(app, fm, trip, path, draft, links);
  });

  const head = await app.vault.read(file);
  await app.vault.modify(file, `${head.trimEnd()}\n\n${bookingBody(draft, links)}`);
  return file;
}

export async function createExpense(
  app: App,
  settings: AwtySettings,
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

  const head = await app.vault.read(file);
  await app.vault.modify(file, `${head.trimEnd()}\n\n${expenseBody(draft.description, links)}`);
  return file;
}

/** Saves changes to an existing expense. */
export async function updateExpense(
  app: App,
  trip: Trip,
  file: TFile,
  draft: ExpenseDraft,
): Promise<TFile> {
  const links = linksFor(app, draft.attachments, file.path);
  const kept = customParts(await app.vault.read(file));

  await app.fileManager.processFrontMatter(file, (fm) => {
    for (const key of ["paid_by", "attachments"]) delete fm[key];
    fm.type = "expense";
    fm.description = draft.description;
    fm.trip_folder = trip.folderPath;
    fm.trip = app.fileManager.generateMarkdownLink(trip.file, file.path);
    fm.date = draft.date;
    fm.amount = draft.amount;
    fm.currency = draft.currency;
    fm.category = draft.category;
    if (draft.paidBy) fm.paid_by = draft.paidBy;
    if (links.length) fm.attachments = links;
  });

  const head = await app.vault.read(file);
  const front = head.startsWith("---") ? head.slice(0, head.indexOf("\n---", 3) + 4) : "";
  await app.vault.modify(
    file,
    `${front.trimEnd()}\n\n${weaveKept(expenseBody(draft.description, links), kept)}\n`,
  );

  const wanted = sanitizeName(`${draft.date} ${draft.description}`.trim() || "Expense");
  if (wanted && wanted !== file.basename) {
    await app.fileManager.renameFile(file, uniquePath(app, file.parent?.path ?? "", wanted));
  }
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
