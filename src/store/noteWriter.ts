import { App, Notice, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import type { SubNoteId, TravelPlannerSettings, Trip, TripDraft } from "../types";
import { kindDef } from "../types";
import { buildSubNote, buildTripBody, type TemplateContext } from "./templates";
import { expandFolderPattern, joinPath, sanitizeName } from "../util/paths";
import { isValidISODate, parseISO } from "../util/dates";
import { emptyDayDates } from "./itinerary";

export { emptyDayDates } from "./itinerary";

export class TripWriteError extends Error {}

async function ensureFolder(app: App, path: string): Promise<void> {
  const normalized = normalizePath(path);
  if (!normalized || normalized === "/") return;
  const existing = app.vault.getAbstractFileByPath(normalized);
  if (existing instanceof TFolder) return;
  if (existing) throw new TripWriteError(`"${normalized}" already exists and is not a folder.`);

  // createFolder only makes the leaf, so walk the ancestors first.
  const parts = normalized.split("/");
  let cursor = "";
  for (const part of parts) {
    cursor = cursor ? `${cursor}/${part}` : part;
    if (app.vault.getAbstractFileByPath(cursor) instanceof TFolder) continue;
    try {
      await app.vault.createFolder(cursor);
    } catch (err) {
      // A concurrent create is fine; anything else is not.
      if (!(app.vault.getAbstractFileByPath(cursor) instanceof TFolder)) throw err;
    }
  }
}

/** Appends " 2", " 3" … until the path is free. */
function uniquePath(app: App, folder: string, base: string, ext = ".md"): string {
  let candidate = joinPath(folder, base + ext);
  let n = 2;
  while (app.vault.getAbstractFileByPath(candidate)) {
    candidate = joinPath(folder, `${base} ${n}${ext}`);
    n += 1;
  }
  return candidate;
}

function uniqueFolder(app: App, path: string): string {
  let candidate = path;
  let n = 2;
  while (app.vault.getAbstractFileByPath(candidate)) {
    candidate = `${path} ${n}`;
    n += 1;
  }
  return candidate;
}

export function tripFolderPath(settings: TravelPlannerSettings, draft: TripDraft): string {
  const start = parseISO(draft.startDate);
  const relative = expandFolderPattern(settings.folderPattern, {
    year: start ? String(start.getUTCFullYear()) : "Undated",
    month: start ? String(start.getUTCMonth() + 1).padStart(2, "0") : "00",
    start: isValidISODate(draft.startDate) ? draft.startDate : "undated",
    end: isValidISODate(draft.endDate) ? draft.endDate : "undated",
    title: draft.title,
    city: draft.city,
    country: draft.country,
    kind: draft.kind,
  });
  return joinPath(normalizePath(settings.tripsFolder), relative);
}

function tripFrontmatter(draft: TripDraft): Record<string, unknown> {
  const def = kindDef(draft.kind);
  const fm: Record<string, unknown> = {
    type: "trip",
    kind: draft.kind,
    title: draft.title,
    start_date: draft.startDate,
    end_date: def.singleDay ? draft.startDate : draft.endDate,
  };
  if (draft.budgetTotal !== null && draft.budgetTotal > 0) fm.budget_total = draft.budgetTotal;
  if (draft.travellers.length > 0) fm.travellers = draft.travellers;
  if (draft.originCity) fm.origin_city = draft.originCity;
  if (draft.originAirport) fm.origin_airport = draft.originAirport;
  if (draft.country) fm.country = draft.country;
  if (draft.city) fm.city = draft.city;
  if (def.hasVenue && draft.venue) fm.venue = draft.venue;
  return fm;
}

/**
 * Writes frontmatter through Obsidian's own serialiser rather than concatenating
 * YAML by hand. The 1.x plugin built lines like `destination: "' + value + '"`,
 * which produced a corrupt file for any destination containing a quote.
 */
async function writeFrontmatter(
  app: App,
  file: TFile,
  fields: Record<string, unknown>,
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    for (const [key, value] of Object.entries(fields)) fm[key] = value;
  });
}

export interface CreatedTrip {
  tripFile: TFile;
  folderPath: string;
  subNoteFiles: TFile[];
}

export async function createTrip(
  app: App,
  settings: TravelPlannerSettings,
  draft: TripDraft,
  foodSpotAvailable: boolean,
): Promise<CreatedTrip> {
  if (!draft.title.trim()) throw new TripWriteError("A trip needs a title.");
  if (!isValidISODate(draft.startDate)) throw new TripWriteError("Start date must be a real date.");

  const def = kindDef(draft.kind);
  const normalized: TripDraft = {
    ...draft,
    title: draft.title.trim(),
    endDate: def.singleDay ? draft.startDate : draft.endDate || draft.startDate,
  };

  const folderPath = uniqueFolder(app, tripFolderPath(settings, normalized));
  await ensureFolder(app, folderPath);

  const tripNotePath = uniquePath(app, folderPath, sanitizeName(normalized.title));
  // Created empty-of-frontmatter first, then stamped, so the YAML is Obsidian's.
  const tripFile = await app.vault.create(tripNotePath, "");
  await writeFrontmatter(app, tripFile, tripFrontmatter(normalized));

  const subNotes = normalized.subNotes;
  const ctx: TemplateContext = {
    draft: normalized,
    settings,
    tripLink: app.fileManager.generateMarkdownLink(tripFile, folderPath),
    foodSpotAvailable,
  };

  // The body is appended after the frontmatter block that processFrontMatter wrote.
  const existing = await app.vault.read(tripFile);
  await app.vault.modify(tripFile, `${existing.trimEnd()}\n\n${buildTripBody(ctx, subNotes)}`);

  const subNoteFiles: TFile[] = [];
  for (const id of subNotes) {
    const spec = buildSubNote(id, ctx);
    const path = uniquePath(app, folderPath, sanitizeName(spec.fileName));
    const file = await app.vault.create(path, "");
    await writeFrontmatter(app, file, spec.frontmatter);
    const head = await app.vault.read(file);
    await app.vault.modify(file, `${head.trimEnd()}\n\n${spec.body}`);
    subNoteFiles.push(file);
  }

  return { tripFile, folderPath, subNoteFiles };
}

/**
 * Applies edits to an existing trip. Frontmatter is rewritten in place; the note
 * and its folder are renamed through FileManager so inbound links follow.
 */
export async function updateTrip(
  app: App,
  settings: TravelPlannerSettings,
  trip: Trip,
  draft: TripDraft,
): Promise<TFile> {
  if (!draft.title.trim()) throw new TripWriteError("A trip needs a title.");
  if (!isValidISODate(draft.startDate)) throw new TripWriteError("Start date must be a real date.");

  const def = kindDef(draft.kind);
  const normalized: TripDraft = {
    ...draft,
    title: draft.title.trim(),
    endDate: def.singleDay ? draft.startDate : draft.endDate || draft.startDate,
  };

  await app.fileManager.processFrontMatter(trip.file, (fm) => {
    for (const [key, value] of Object.entries(tripFrontmatter(normalized))) fm[key] = value;
    // Venue is meaningless once a concert becomes a holiday.
    if (!def.hasVenue) delete fm.venue;
  });

  const desiredFolder = tripFolderPath(settings, normalized);
  let folderPath = trip.folderPath;

  if (desiredFolder !== trip.folderPath) {
    const folder = app.vault.getAbstractFileByPath(trip.folderPath);
    if (folder instanceof TFolder && !app.vault.getAbstractFileByPath(desiredFolder)) {
      await ensureFolder(app, desiredFolder.split("/").slice(0, -1).join("/"));
      await app.fileManager.renameFile(folder, desiredFolder);
      folderPath = desiredFolder;
    }
  }

  const desiredName = sanitizeName(normalized.title);
  if (trip.file.basename !== desiredName) {
    const target = joinPath(folderPath, `${desiredName}.md`);
    if (!app.vault.getAbstractFileByPath(target)) {
      await app.fileManager.renameFile(trip.file, target);
    }
  }

  return trip.file;
}

/**
 * Files that deleting this trip would remove.
 *
 * The whole folder goes only when it holds exactly one trip note — otherwise a
 * folder pattern that groups several trips together (say a bare `{year}`) would
 * take the neighbours with it.
 */
export function tripDeletionTargets(app: App, trip: Trip): TAbstractFile[] {
  const folder = app.vault.getAbstractFileByPath(trip.folderPath);
  if (!(folder instanceof TFolder)) return [trip.file];

  let tripNotes = 0;
  const walk = (dir: TFolder): void => {
    for (const child of dir.children) {
      if (child instanceof TFolder) walk(child);
      else if (child instanceof TFile && child.extension === "md") {
        const fm = app.metadataCache.getFileCache(child)?.frontmatter;
        if (fm?.type === "trip") tripNotes += 1;
      }
    }
  };
  walk(folder);

  return tripNotes <= 1 ? [folder] : [trip.file];
}

/** Flattened list of the markdown files a deletion would take, for the confirm modal. */
export function describeDeletion(app: App, targets: TAbstractFile[]): string[] {
  const out: string[] = [];
  const walk = (item: TAbstractFile): void => {
    if (item instanceof TFolder) item.children.forEach(walk);
    else out.push(item.path);
  };
  targets.forEach(walk);
  return out.sort();
}

/**
 * Sends the trip to wherever the user's "Deleted files" setting points — system
 * trash, vault .trash, or permanent. Never bypasses that preference.
 */
export async function deleteTrip(app: App, trip: Trip): Promise<number> {
  const targets = tripDeletionTargets(app, trip);
  const count = describeDeletion(app, targets).length;
  for (const target of targets) {
    await app.fileManager.trashFile(target);
  }
  return count;
}

/**
 * Inserts a day into an itinerary in date order instead of appending blindly to
 * the end of the file the way 1.x did.
 */
/**
 * Writes a day into an itinerary.
 *
 * Trips are created with a heading per day already in place, so refusing when
 * the heading exists made the wizard reject every day of the trip while the
 * progress counter still read 0/8. An existing day with nothing under it gets
 * filled in; only a day that already has content is reported as a duplicate.
 */
export async function insertItineraryDay(
  app: App,
  file: TFile,
  date: string,
  sections: { morning: string; afternoon: string; evening: string },
): Promise<"inserted" | "filled" | "duplicate"> {
  const content = await app.vault.read(file);
  const lines = content.split("\n");

  const body = [
    "",
    "### Morning",
    sections.morning.trim(),
    "",
    "### Afternoon",
    sections.afternoon.trim(),
    "",
    "### Evening",
    sections.evening.trim(),
    "",
  ].join("\n");

  const headingAt = lines.findIndex(
    (line) => /^##\s+(\d{4}-\d{2}-\d{2})\s*$/.test(line.trim()) && line.trim().endsWith(date),
  );

  if (headingAt !== -1) {
    if (!emptyDayDates(content).has(date)) return "duplicate";

    // Replace the empty scaffolding under this heading.
    let end = lines.length;
    for (let i = headingAt + 1; i < lines.length; i += 1) {
      if (/^#{1,2}\s/.test(lines[i])) {
        end = i;
        break;
      }
    }
    const next = [...lines.slice(0, headingAt + 1), body, ...lines.slice(end)].join("\n");
    await app.vault.modify(file, next.replace(/\n{3,}/g, "\n\n"));
    return "filled";
  }

  const block = `## ${date}\n${body}`;

  // Keep days in date order rather than appending blindly.
  let insertAt = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(lines[i].trim());
    if (m && isValidISODate(m[1]) && m[1] > date) {
      insertAt = i;
      break;
    }
  }

  const next =
    insertAt === -1
      ? `${content.trimEnd()}\n\n${block}`
      : `${lines.slice(0, insertAt).join("\n").trimEnd()}\n\n${block}\n${lines.slice(insertAt).join("\n")}`;

  await app.vault.modify(file, next);
  return "inserted";
}

export function notifyError(err: unknown, fallback: string): void {
  const message = err instanceof Error ? err.message : fallback;
  new Notice(`Travel Planner: ${message}`);
  console.error("[travel-planner]", err);
}
