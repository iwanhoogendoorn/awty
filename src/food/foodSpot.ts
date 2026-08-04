import { App, TFile, TFolder, normalizePath } from "obsidian";
import { FOODSPOT_PLUGIN_ID } from "../types";
import { sanitizeName, joinPath } from "../util/paths";

/**
 * The Food Spot side of a booked table.
 *
 * A restaurant booked on a trip is the same restaurant Food Spot tracks across
 * every trip, so booking one here should put it in that collection rather than
 * leaving two records that never meet. Food Spot owns the schema; this writes
 * the fields it reads and nothing else.
 */
export interface FoodSpotEntry {
  file: TFile;
  name: string;
  city: string;
  country: string;
  address: string;
  /** "lat,lng", exactly as Food Spot stores it. */
  location: string;
}

/** Where Food Spot keeps its notes, read from its own settings. */
export async function foodSpotFolder(app: App): Promise<string> {
  const path = normalizePath(`${app.vault.configDir}/plugins/${FOODSPOT_PLUGIN_ID}/data.json`);
  try {
    const parsed = JSON.parse(await app.vault.adapter.read(path)) as {
      settings?: { spotsFolder?: string };
      spotsFolder?: string;
    };
    const folder = parsed?.settings?.spotsFolder ?? parsed?.spotsFolder;
    return typeof folder === "string" && folder.trim() ? folder.trim() : "Food Spot";
  } catch {
    return "Food Spot";
  }
}

function entryFrom(app: App, file: TFile): FoodSpotEntry | null {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!fm || fm.type !== "foodspot") return null;
  return {
    file,
    name: String(fm.name ?? file.basename),
    city: String(fm.city ?? ""),
    country: String(fm.country ?? ""),
    address: String(fm.address ?? ""),
    location: String(fm.location ?? ""),
  };
}

/** Every Food Spot entry, or just those in one city. */
export function foodSpots(app: App, city?: string): FoodSpotEntry[] {
  const wanted = city?.trim().toLowerCase();
  const out: FoodSpotEntry[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const entry = entryFrom(app, file);
    if (!entry) continue;
    if (wanted && entry.city.trim().toLowerCase() !== wanted) continue;
    out.push(entry);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** The entry for a name in a city, if Food Spot already knows it. */
export function findFoodSpot(app: App, name: string, city: string): FoodSpotEntry | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  return (
    foodSpots(app, city).find((e) => e.name.trim().toLowerCase() === wanted) ??
    foodSpots(app).find((e) => e.name.trim().toLowerCase() === wanted) ??
    null
  );
}

async function ensureFolder(app: App, path: string): Promise<void> {
  const normalized = normalizePath(path);
  if (!normalized || app.vault.getAbstractFileByPath(normalized) instanceof TFolder) return;
  let cursor = "";
  for (const part of normalized.split("/")) {
    cursor = cursor ? `${cursor}/${part}` : part;
    if (app.vault.getAbstractFileByPath(cursor) instanceof TFolder) continue;
    try {
      await app.vault.createFolder(cursor);
    } catch {
      // Created between the check and the call; nothing to do.
    }
  }
}

/**
 * Adds a restaurant to Food Spot's collection, if it is not there already.
 *
 * Written as "want to try": booking a table is intent, and Food Spot's own
 * flow is what marks a place visited and rates it. Returns the note either
 * way, so the booking can link to it.
 */
export async function ensureFoodSpot(
  app: App,
  spot: { name: string; city: string; country: string; address: string; location: string },
): Promise<TFile | null> {
  const name = spot.name.trim();
  if (!name) return null;

  const existing = findFoodSpot(app, name, spot.city);
  if (existing) return existing.file;

  // Food Spot files its notes by country, named "Place (City)".
  const root = await foodSpotFolder(app);
  const folder = spot.country ? joinPath(root, sanitizeName(spot.country)) : root;
  await ensureFolder(app, folder);

  const base = sanitizeName(spot.city ? `${name} (${spot.city})` : name);
  let path = joinPath(folder, `${base}.md`);
  let n = 2;
  while (app.vault.getAbstractFileByPath(path)) {
    path = joinPath(folder, `${base} ${n}.md`);
    n += 1;
  }

  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    "---",
    "type: foodspot",
    `name: ${name}`,
    "cuisines: []",
    `country: ${spot.country}`,
    `city: ${spot.city}`,
    spot.address ? `address: ${spot.address}` : "",
    spot.location ? `location: ${spot.location}` : "",
    "status: want-to-try",
    "favorite: false",
    "visit_count: 0",
    "tags: []",
    `created: ${today}`,
    `updated: ${today}`,
    "source: awty",
    "---",
    "",
    `# ${name}`,
    "",
    "Added when a table was booked in Are We There Yet?.",
    "",
  ].filter((line) => line !== "");

  return app.vault.create(path, lines.join("\n"));
}
