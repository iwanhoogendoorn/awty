import { App, Plugin, TFile, TFolder, normalizePath } from "obsidian";
import type { SubNoteId, AwtySettings, Trip, TripStatus, TripStop } from "../types";
import { SUB_NOTE_LABELS, isTripKind } from "../types";

export interface SubNote {
  /** Null for a note the user added that isn't one of ours. */
  id: SubNoteId | null;
  file: TFile;
  label: string;
}
import { isValidISODate, todayISO, tripStatus } from "../util/dates";

type Listener = () => void;

const STATUS_ORDER: Record<TripStatus, number> = { current: 0, upcoming: 1, past: 2 };

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => str(v)).filter(Boolean);
  const single = str(value);
  return single ? single.split(",").map((v) => v.trim()).filter(Boolean) : [];
}

/**
 * The trip's stops, in order.
 *
 * Written as a list of "Country / City" strings, which stays readable in
 * frontmatter and survives being edited by hand. A trip saved before stops
 * existed has only country and city, and reads as a single stop.
 */
function readStops(fm: Record<string, unknown>): TripStop[] {
  const raw = Array.isArray(fm.stops) ? fm.stops : [];
  const stops: TripStop[] = [];

  for (const entry of raw) {
    if (typeof entry === "string") {
      const [country, city] = entry.split("/").map((part) => part.trim());
      if (country || city) stops.push({ country: country ?? "", city: city ?? "" });
      continue;
    }
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const country = str(record.country);
      const city = str(record.city);
      if (country || city) stops.push({ country, city });
    }
  }

  if (stops.length > 0) return stops;
  const country = str(fm.country);
  const city = str(fm.city) || str(fm.destination);
  return country || city ? [{ country, city }] : [];
}

function str(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

/**
 * Reads trips out of the vault and keeps them fresh.
 *
 * The 1.x sidebar re-scanned only when you created a trip or reopened the pane,
 * so editing a trip's dates in the note left the sidebar showing stale data
 * indefinitely. This subscribes to the metadata and vault events instead.
 */
export class TripStore {
  private trips: Trip[] = [];
  private listeners = new Set<Listener>();
  private dirty = true;
  private day = todayISO();

  constructor(
    private app: App,
    private getSettings: () => AwtySettings,
  ) {}

  /** Subscribes to the vault so the sidebar reflects edits made in the notes. */
  register(plugin: Plugin): void {
    const invalidate = () => this.invalidate();

    plugin.registerEvent(this.app.metadataCache.on("changed", invalidate));
    plugin.registerEvent(this.app.metadataCache.on("deleted", invalidate));
    plugin.registerEvent(this.app.vault.on("create", invalidate));
    plugin.registerEvent(this.app.vault.on("delete", invalidate));
    plugin.registerEvent(this.app.vault.on("rename", invalidate));

    // A trip that ends today becomes "past" at midnight; without this the badge
    // would stay wrong until something else happened to invalidate the cache.
    plugin.registerInterval(
      window.setInterval(() => {
        const today = todayISO();
        if (today !== this.day) {
          this.day = today;
          this.invalidate();
        }
      }, 60_000),
    );
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  invalidate(): void {
    this.dirty = true;
    for (const listener of this.listeners) listener();
  }

  getTrips(): Trip[] {
    if (this.dirty) {
      this.trips = this.scan();
      this.dirty = false;
    }
    return this.trips;
  }

  getTripForFile(file: TFile): Trip | null {
    return (
      this.getTrips().find(
        (t) => t.file.path === file.path || file.path.startsWith(`${t.folderPath}/`),
      ) ?? null
    );
  }

  /**
   * The notes sitting alongside a trip note, in template order, with anything
   * the user added by hand tacked on the end.
   */
  getSubNotes(trip: Trip): SubNote[] {
    const folder = this.app.vault.getAbstractFileByPath(trip.folderPath);
    if (!(folder instanceof TFolder)) return [];

    const order = Object.keys(SUB_NOTE_LABELS) as SubNoteId[];
    const byLabel = new Map<string, SubNoteId>(
      order.map((id) => [SUB_NOTE_LABELS[id].toLowerCase(), id]),
    );

    const out: SubNote[] = [];
    for (const child of folder.children) {
      if (!(child instanceof TFile) || child.extension !== "md") continue;
      if (child.path === trip.file.path) continue;
      const id = byLabel.get(child.basename.toLowerCase()) ?? null;
      out.push({ id, file: child, label: id ? SUB_NOTE_LABELS[id] : child.basename });
    }

    out.sort((a, b) => {
      const ai = a.id ? order.indexOf(a.id) : Number.MAX_SAFE_INTEGER;
      const bi = b.id ? order.indexOf(b.id) : Number.MAX_SAFE_INTEGER;
      return ai !== bi ? ai - bi : a.label.localeCompare(b.label);
    });
    return out;
  }

  /** The trip note governing the folder a given file sits in, if any. */
  findSiblingSubNote(file: TFile, name: string): TFile | null {
    const trip = this.getTripForFile(file);
    if (!trip) return null;
    const candidate = this.app.vault.getAbstractFileByPath(`${trip.folderPath}/${name}.md`);
    return candidate instanceof TFile ? candidate : null;
  }

  private scan(): Trip[] {
    const settings = this.getSettings();
    const root = normalizePath(settings.tripsFolder);
    const prefix = root && root !== "/" ? `${root}/` : "";
    const today = todayISO();

    const trips: Trip[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (prefix && !file.path.startsWith(prefix)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || fm.type !== "trip") continue;

      const startDate = str(fm.start_date);
      const rawEnd = str(fm.end_date);
      const endDate = isValidISODate(rawEnd) ? rawEnd : startDate;
      const kind = isTripKind(fm.kind) ? fm.kind : "holiday";

      trips.push({
        file,
        folderPath: file.parent?.path ?? root,
        // `destination` is the 1.x field name; reading it keeps old notes visible.
        title: str(fm.title) || str(fm.destination) || file.basename,
        kind,
        country: str(fm.country),
        city: str(fm.city) || str(fm.destination),
        stops: readStops(fm),
        venue: str(fm.venue),
        startDate,
        endDate,
        status: tripStatus(startDate, endDate, today),
        travellers: list(fm.travellers),
        originCity: str(fm.origin_city),
        originAirport: str(fm.origin_airport),
        budgetTotal: (() => {
          const raw = fm.budget_total;
          const value = typeof raw === "number" ? raw : Number(str(raw).replace(",", "."));
          return Number.isFinite(value) && value > 0 ? value : null;
        })(),
        passports: list(fm.passports),
      });
    }

    trips.sort((a, b) => {
      if (STATUS_ORDER[a.status] !== STATUS_ORDER[b.status]) {
        return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      }
      // Upcoming: soonest first. Past: most recent first.
      const dir = a.status === "past" ? -1 : 1;
      const cmp = a.startDate.localeCompare(b.startDate) * dir;
      return cmp !== 0 ? cmp : a.title.localeCompare(b.title);
    });

    return trips;
  }
}
