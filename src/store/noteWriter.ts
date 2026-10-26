import { App, Notice, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { keepMoments, momentList, momentsToFrontmatter, type Moment } from "../trips/moments";
import { replaceSection } from "./sectionWriter";
import { formatDayLabel } from "../util/dates";
import type { SubNoteId, AwtySettings, Trip, TripDraft, TripStage } from "../types";
import { isCreatableStage, kindDef } from "../types";
import { buildSubNote, buildTripBody, type TemplateContext } from "./templates";
import { expandFolderPattern, joinPath, sanitizeName } from "../util/paths";
import { joinPlaces, tripCities, tripCountries, tripStops } from "../types";
import { isValidISODate, parseISO } from "../util/dates";
import { emptyDayDates } from "./itinerary";
import { freshId, isStoredId, pathId } from "../util/hash";
import { foldersToPrune, retargetLinks } from "../util/paths";

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

export function tripFolderPath(settings: AwtySettings, draft: TripDraft): string {
  const start = parseISO(draft.startDate);
  const relative = expandFolderPattern(settings.folderPattern, {
    year: start ? String(start.getUTCFullYear()) : "Undated",
    month: start ? String(start.getUTCMonth() + 1).padStart(2, "0") : "00",
    start: isValidISODate(draft.startDate) ? draft.startDate : "undated",
    end: isValidISODate(draft.endDate) ? draft.endDate : "undated",
    title: draft.title,
    // The folder names the whole route, not just its first stop: a trip to
    // three countries filed under one of them is filed wrongly.
    city: joinPlaces(tripCities(draft)),
    country: joinPlaces(tripCountries(draft)),
    kind: draft.kind,
  });
  return joinPath(normalizePath(settings.tripsFolder), relative);
}

function tripFrontmatter(draft: TripDraft): Record<string, unknown> {
  const def = kindDef(draft.kind);
  const fm: Record<string, unknown> = {
    type: "trip",
    kind: draft.kind,
    stage: draft.stage,
    title: draft.title,
    start_date: draft.startDate,
    end_date: def.singleDay ? draft.startDate : draft.endDate,
  };
  if (draft.budgetTotal !== null && draft.budgetTotal > 0) fm.budget_total = draft.budgetTotal;
  if (draft.passports.length > 0) fm.passports = draft.passports;
  if (draft.travellers.length > 0) fm.travellers = draft.travellers;
  if (draft.originCity) fm.origin_city = draft.originCity;
  if (draft.originAirport) fm.origin_airport = draft.originAirport;
  if (draft.country) fm.country = draft.country;
  if (draft.city) fm.city = draft.city;
  // Written as "Country / City" lines: readable in frontmatter, and editable
  // by hand without needing to know a shape.
  const stops = tripStops(draft);
  if (stops.length > 1) fm.stops = stops.map((s) => `${s.country} / ${s.city}`.trim());
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
  settings: AwtySettings,
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
    // A trip cannot be born cancelled, and does not need to be born "went" —
    // give it dates in the past and the calendar makes it that. Clamped here as
    // well as in the form, because this is the one door every new trip comes
    // through.
    stage: isCreatableStage(draft.stage) ? draft.stage : "planning",
  };

  const folderPath = uniqueFolder(app, tripFolderPath(settings, normalized));
  await ensureFolder(app, folderPath);

  const tripNotePath = uniquePath(app, folderPath, sanitizeName(normalized.title));
  // Created empty-of-frontmatter first, then stamped, so the YAML is Obsidian's.
  const tripFile = await app.vault.create(tripNotePath, "");
  // Its id is minted here, once, and travels with the note from now on.
  await writeFrontmatter(app, tripFile, { ...tripFrontmatter(normalized), awty_id: freshId("t") });

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
  settings: AwtySettings,
  trip: Trip,
  draft: TripDraft,
  /**
   * Which notes a rename may rewrite links in. `vault` is Obsidian's own
   * rename: every link anywhere that resolves into the trip follows it, which
   * is what the trip form has always done. `trip` touches only the notes in
   * the trip's own folder, for callers — the API — that must never reach into
   * a note they were not asked about.
   */
  links: "vault" | "trip" = "vault",
): Promise<TFile> {
  if (!draft.title.trim()) throw new TripWriteError("A trip needs a title.");
  if (!isValidISODate(draft.startDate)) throw new TripWriteError("Start date must be a real date.");

  const def = kindDef(draft.kind);
  const normalized: TripDraft = {
    ...draft,
    title: draft.title.trim(),
    endDate: def.singleDay ? draft.startDate : draft.endDate || draft.startDate,
  };
  const move = (file: TAbstractFile, to: string): Promise<void> =>
    links === "trip" ? app.vault.rename(file, to) : app.fileManager.renameFile(file, to);
  const fromFolder = trip.folderPath;
  const fromName = trip.file.basename;

  await app.fileManager.processFrontMatter(trip.file, (fm) => {
    for (const [key, value] of Object.entries(tripFrontmatter(normalized))) fm[key] = value;
    // Venue is meaningless once a concert becomes a holiday.
    if (!def.hasVenue) delete fm.venue;
    // A trip from before ids were stored is named by its path. This edit may
    // be about to move it, so the name it has now is written down first.
    if (!isStoredId("t", fm.awty_id)) fm.awty_id = pathId("t", trip.file.path);
  });

  const desiredFolder = tripFolderPath(settings, normalized);
  let folderPath = trip.folderPath;

  if (desiredFolder !== trip.folderPath) {
    const folder = app.vault.getAbstractFileByPath(trip.folderPath);
    if (folder instanceof TFolder && !app.vault.getAbstractFileByPath(desiredFolder)) {
      // Every booking in the folder is about to move with it.
      await stampIdsIn(app, folder);
      await ensureFolder(app, desiredFolder.split("/").slice(0, -1).join("/"));
      await move(folder, desiredFolder);
      folderPath = desiredFolder;
      // The year it moved out of may now hold nothing.
      await pruneEmptyFolders(app, [folder], normalizePath(settings.tripsFolder), fromFolder);
    }
  }

  const desiredName = sanitizeName(normalized.title);
  if (trip.file.basename !== desiredName) {
    const target = joinPath(folderPath, `${desiredName}.md`);
    if (!app.vault.getAbstractFileByPath(target)) {
      await move(trip.file, target);
    }
  }

  if (folderPath !== fromFolder || trip.file.basename !== fromName) {
    await followTripMove(app, folderPath, links === "trip" ? { fromFolder, toFolder: folderPath, fromName, toName: trip.file.basename } : null);
  }
  return trip.file;
}

/**
 * Everything in a trip's folder, told where the trip now is.
 *
 * Every booking and expense records the folder of the trip it belongs to, and
 * nothing updated it when the folder moved — so renaming a trip filed all of
 * its bookings under a trip that no longer existed. With `links`, the links in
 * those notes are pointed at the new paths too, in place of Obsidian's
 * vault-wide rewrite.
 */
async function followTripMove(
  app: App,
  folderPath: string,
  links: { fromFolder: string; toFolder: string; fromName: string; toName: string } | null,
): Promise<void> {
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (!(folder instanceof TFolder)) return;
  const notes: TFile[] = [];
  const walk = (dir: TFolder): void => {
    for (const child of dir.children) {
      if (child instanceof TFolder) walk(child);
      else if (child instanceof TFile && child.extension === "md") notes.push(child);
    }
  };
  walk(folder);
  for (const note of notes) {
    if (links) {
      const before = await app.vault.read(note);
      const after = retargetLinks(before, links);
      if (after !== before) await app.vault.modify(note, after);
    }
    const fm = app.metadataCache.getFileCache(note)?.frontmatter;
    if (fm && "trip_folder" in fm && fm.trip_folder !== folderPath) {
      await app.fileManager.processFrontMatter(note, (front) => {
        front.trip_folder = folderPath;
      });
    }
  }
}

/**
 * Moves a trip to another stage, and nothing else.
 *
 * Separate from `updateTrip` because the whole point of the stage buttons is
 * that saying "we're going" is one click. Routing it through the trip editor
 * would rewrite every other field, rename the folder if the pattern moved, and
 * make an answer to one question into a save of everything.
 */
/**
 * Saves the trip's memorable moments.
 *
 * Both at once, on purpose: the frontmatter is what the dashboard and the
 * export read, and the markdown list is what somebody reads in five years with
 * this plugin long uninstalled. Everything else here makes that same bargain —
 * a cruise writes its ports twice too — and it matters most for the one kind of
 * record that cannot be rebuilt from a receipt.
 */
export async function saveMoments(app: App, trip: Trip, moments: Moment[]): Promise<void> {
  const kept = keepMoments(moments);
  await app.fileManager.processFrontMatter(trip.file, (fm) => {
    if (kept.length > 0) fm.moments = momentsToFrontmatter(kept);
    // Deleting the last one has to actually empty it, or the note keeps
    // claiming a memory that was taken off the list.
    else delete fm.moments;
  });
  await replaceSection(
    app,
    trip.file,
    "Moments",
    kept.length > 0
      ? momentList(kept, (date) => formatDayLabel(date)).join("\n")
      : "_Nothing written down yet._",
  );
}

export async function setTripStage(app: App, trip: Trip, stage: TripStage): Promise<void> {
  await app.fileManager.processFrontMatter(trip.file, (fm) => {
    fm.stage = stage;
  });
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
export async function deleteTrip(app: App, trip: Trip, tripsRoot?: string): Promise<number> {
  const targets = tripDeletionTargets(app, trip);
  const count = describeDeletion(app, targets).length;
  for (const target of targets) {
    await app.fileManager.trashFile(target);
  }
  if (tripsRoot !== undefined) await pruneEmptyFolders(app, targets, normalizePath(tripsRoot));
  return count;
}

/**
 * Folders a deletion left empty, between it and the trips folder.
 *
 * Deleting the last trip of 2027 otherwise leaves a `2027` folder with nothing
 * in it, and the next person to open the file explorer wonders what is
 * missing from it. Only ever folders that are now truly empty, never the trips
 * folder itself, and through the same trash setting as everything else.
 */
export async function pruneEmptyFolders(app: App, deleted: TAbstractFile[], root: string, wasAt?: string): Promise<string[]> {
  const pruned: string[] = [];
  const childrenOf = (path: string): string[] => {
    const folder = app.vault.getAbstractFileByPath(path);
    return folder instanceof TFolder ? folder.children.map((c) => c.path) : [];
  };
  for (const target of deleted) {
    for (const path of foldersToPrune(wasAt ?? target.path, root, childrenOf)) {
      const folder = app.vault.getAbstractFileByPath(path);
      if (!(folder instanceof TFolder) || folder.children.length > 0) break;
      await app.fileManager.trashFile(folder);
      pruned.push(path);
    }
  }
  return pruned;
}

/** The prefix a note's id carries, by what the note is: trip or booking. */
function idPrefix(fm: Record<string, unknown> | undefined): "t" | "b" | null {
  return fm?.type === "trip" ? "t" : fm?.type === "booking" ? "b" : null;
}

/**
 * Writes a trip's or booking's path-derived id into it, if it has none stored.
 *
 * `fromPath` is where the note was when that id was derived: the old path for a
 * note that has just been moved, so it keeps the id it was known by.
 */
export async function stampId(app: App, file: TFile, fromPath = file.path): Promise<void> {
  const cached = app.metadataCache.getFileCache(file)?.frontmatter;
  const prefix = idPrefix(cached);
  if (!prefix || isStoredId(prefix, cached?.awty_id)) return;
  await app.fileManager.processFrontMatter(file, (fm) => {
    if (!isStoredId(prefix, fm.awty_id)) fm.awty_id = pathId(prefix, fromPath);
  });
}

async function stampIdsIn(app: App, folder: TFolder): Promise<void> {
  for (const child of folder.children) {
    if (child instanceof TFolder) await stampIdsIn(app, child);
    else if (child instanceof TFile && child.extension === "md") await stampId(app, child);
  }
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
  /** Overwrites a day that already has content, for a deliberate re-save. */
  replace = false,
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
    if (!replace && !emptyDayDates(content).has(date)) return "duplicate";

    // Replace the empty scaffolding under this heading.
    let end = lines.length;
    for (let i = headingAt + 1; i < lines.length; i += 1) {
      if (/^#{1,2}\s/.test(lines[i])) {
        end = i;
        break;
      }
    }
    // Tidy only what was written: collapsing blank runs across the whole note
    // reformatted days this edit never touched.
    const cleaned = body.replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
    const next = [...lines.slice(0, headingAt + 1), cleaned, "", ...lines.slice(end)].join("\n");
    await app.vault.modify(file, next.replace(/\n{4,}/g, "\n\n\n").trimEnd() + "\n");
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
  new Notice(`AWTY: ${message}`);
  console.error("[awty]", err);
}
