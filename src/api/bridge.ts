/**
 * The API's hands: `ApiDeps` built from the live plugin.
 *
 * Every mutation is one the modals already make, followed by the same
 * aftercare they do — stores invalidated, sub-notes regenerated, views
 * repainted — so a booking added over HTTP is indistinguishable from one added
 * with the wizard.
 *
 * Two things only the API needs live here as well. The write log: every vault
 * path a request touched, for the `written` list in its reply. And the
 * revision: a number that moves when a note under the trips folder actually
 * changes, and at no other time, so a client can tell "nothing new" from a
 * header without downloading anything.
 */
import { TAbstractFile, TFile, normalizePath } from "obsidian";
import type { App, Plugin } from "obsidian";
import type { AwtySettings, Trip, TripDraft } from "../types";
import type { Booking } from "../bookings/types";
import type { TripStore } from "../store/tripStore";
import type { BookingStore } from "../bookings/bookingStore";
import type { Moment } from "../trips/moments";
import { createBooking, draftFromBooking, updateBooking, type BookingDraft } from "../bookings/bookingWriter";
import { createTrip, describeDeletion, saveMoments, tripDeletionTargets, updateTrip } from "../store/noteWriter";
import { repointBookings } from "../planning/priceStore";
import { todayISO } from "../util/dates";
import { emptyBookingDraft } from "./input";
import { hash } from "../util/hash";
import type { ApiDeps, WriteResult } from "./routes";

/** What the bridge needs from the plugin, and nothing more. */
export interface ApiHost {
  app: App;
  settings: AwtySettings;
  manifest: { version: string };
  store: TripStore;
  bookings: BookingStore;
  isFoodSpotAvailable(): boolean;
  /** Budget table, Food note and the rest, regenerated from the bookings. */
  syncTripNotes(trip: Trip): Promise<void>;
  /** Deletes a trip the way the confirm dialog does, cached places and all. */
  removeTrip(trip: Trip): Promise<number>;
  /** Everything that has to forget a trip's resolved places after an edit. */
  forgetPlaces(trip: Trip): void;
  /** Sub-note progress and open views, after anything changed. */
  repaint(): void;
}

/** How long a write waits for Obsidian to re-read what it wrote before replying anyway. */
const SETTLE_MS = 2500;

export class ApiBridge {
  /**
   * Starts at the clock rather than at nought, so a client that cached
   * revision 12 before a restart does not mistake the twelfth write after it
   * for nothing having changed.
   */
  private rev = Math.floor(Date.now() / 1000);
  /** Paths the write in progress wrote and deleted; null between writes. */
  private recording: { written: Set<string>; deleted: Set<string> } | null = null;
  /** Markdown files written whose metadata Obsidian has not re-read yet. */
  private pending = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  /**
   * What each note under the trips folder last said, by path, for the notes
   * the revision has seen change.
   *
   * Obsidian fires "modify" for a save that changed nothing, and other plugins
   * do exactly that: Templater, set to run on new files, re-saves every note
   * the API creates a moment after it is made, byte for byte the same. Counting
   * those would move the revision on writes that were not writes.
   */
  private seen = new Map<string, string>();

  constructor(private host: ApiHost) {}

  get revision(): number {
    return this.rev;
  }

  /** Listens for writes. Call once the layout is ready, so the vault's initial load is not counted. */
  register(plugin: Plugin): void {
    const { vault, metadataCache } = this.host.app;
    const touched = (file: TAbstractFile, oldPath?: string): void => {
      if (this.recording) {
        if (oldPath) this.recording.written.add(oldPath);
        if (file instanceof TFile) {
          this.recording.written.add(file.path);
          this.recording.deleted.delete(file.path);
          if (file.extension === "md") this.pending.add(file.path);
        }
        if (oldPath) this.pending.delete(oldPath);
        return;
      }
      if (!this.inTrips(file.path) && !(oldPath !== undefined && this.inTrips(oldPath))) return;
      if (file instanceof TFile && file.extension === "md" && oldPath === undefined) {
        void this.externalWrite(file);
        return;
      }
      if (oldPath !== undefined) {
        const was = this.seen.get(oldPath);
        this.seen.delete(oldPath);
        if (was !== undefined) this.seen.set(file.path, was);
      }
      this.rev += 1;
    };
    plugin.registerEvent(vault.on("create", (f) => touched(f)));
    plugin.registerEvent(vault.on("modify", (f) => touched(f)));
    plugin.registerEvent(vault.on("rename", (f, oldPath) => touched(f, oldPath)));
    plugin.registerEvent(
      vault.on("delete", (f) => {
        this.pending.delete(f.path);
        this.seen.delete(f.path);
        if (this.recording) {
          this.recording.deleted.add(f.path);
          this.recording.written.delete(f.path);
          return;
        }
        touched(f);
      }),
    );
    plugin.registerEvent(metadataCache.on("changed", (f) => this.pending.delete(f.path)));
  }

  /** A note changed by something other than the API: counted only if its content really moved. */
  private async externalWrite(file: TFile): Promise<void> {
    const now = await this.fingerprint(file);
    if (now !== null && this.seen.get(file.path) === now) return;
    if (now !== null) this.seen.set(file.path, now);
    this.rev += 1;
  }

  private async fingerprint(file: TFile): Promise<string | null> {
    try {
      return hash(await this.host.app.vault.cachedRead(file));
    } catch {
      return null;
    }
  }

  /** Remembers what the API's own writes left behind, so an echo of them is not a change. */
  private async remember(paths: Iterable<string>): Promise<void> {
    for (const path of paths) {
      const file = this.host.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || file.extension !== "md") continue;
      const print = await this.fingerprint(file);
      if (print !== null) this.seen.set(path, print);
    }
  }

  private inTrips(path: string): boolean {
    const root = normalizePath(this.host.settings.tripsFolder);
    return !root || root === "/" || path === root || path.startsWith(`${root}/`);
  }

  /** Until every file written has been re-read by the metadata cache, or SETTLE_MS passes. */
  private async settle(): Promise<void> {
    const until = Date.now() + SETTLE_MS;
    while (this.pending.size > 0 && Date.now() < until) {
      await new Promise((r) => window.setTimeout(r, 25));
    }
    this.pending.clear();
  }

  /** Stores dropped, so the next read sees what the notes now say. */
  private refresh(trip?: Trip): void {
    if (trip) this.host.forgetPlaces(trip);
    this.host.bookings.invalidate();
    this.host.store.invalidate();
  }

  private async write<T>(fn: () => Promise<T>): Promise<WriteResult<T>> {
    // One write at a time: two requests interleaving would share a write log
    // and could each regenerate a budget from half of the other's bookings.
    const run = async (): Promise<WriteResult<T>> => {
      const log = { written: new Set<string>(), deleted: new Set<string>() };
      this.recording = log;
      this.pending.clear();
      let value!: T;
      try {
        value = await fn();
        await this.settle();
        await this.remember(log.written);
      } finally {
        this.recording = null;
        // Counted even when the write failed halfway: what did land is a change.
        if (log.written.size > 0 || log.deleted.size > 0) this.rev += 1;
        this.refresh();
        this.host.repaint();
      }
      const deleted = [...log.deleted].sort();
      return { value, written: [...log.written].filter((p) => !log.deleted.has(p)).sort(), deleted };
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  deps(): ApiDeps {
    const h = this.host;
    const { app } = h;
    return {
      version: h.manifest.version,
      vaultName: app.vault.getName(),
      today: () => todayISO(),
      revision: () => this.rev,
      remoteWrites: () => h.settings.apiRemoteWrites,
      settings: () => h.settings,
      trips: () => h.store.getTrips(),
      bookings: (trip) => h.bookings.getBookings(trip),
      currency: (trip) => h.bookings.getCurrency(trip),
      write: (fn) => this.write(fn),

      createTrip: async (draft: TripDraft) => {
        const created = await createTrip(app, h.settings, draft, h.isFoodSpotAvailable());
        return created.tripFile.path;
      },
      updateTrip: async (trip: Trip, draft: TripDraft) => {
        const file = await updateTrip(app, h.settings, trip, draft);
        h.forgetPlaces(trip);
        return file.path;
      },
      deleteTrip: async (trip: Trip) => {
        // Named before they go: a folder sent to the trash reports itself, not
        // every note that was in it.
        const targets = tripDeletionTargets(app, trip);
        const doomed = [...targets.map((t) => t.path), ...describeDeletion(app, targets)];
        await h.removeTrip(trip);
        for (const path of doomed) {
          this.recording?.deleted.add(path);
          this.recording?.written.delete(path);
        }
      },

      bookingDraft: async (trip: Trip, booking: Booking): Promise<BookingDraft> => {
        const saved = await draftFromBooking(app, booking);
        const base = emptyBookingDraft(booking.kind, trip, h.bookings.getCurrency(trip));
        const merged: BookingDraft = { ...base };
        for (const [key, value] of Object.entries(saved)) {
          if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value;
        }
        return merged;
      },
      createBooking: async (trip: Trip, draft: BookingDraft) => {
        const file = await createBooking(app, h.settings, trip, draft);
        await this.afterBooking(trip);
        return file.path;
      },
      updateBooking: async (trip: Trip, booking: Booking, draft: BookingDraft) => {
        const file = await updateBooking(app, trip, booking.file, draft);
        await this.afterBooking(trip);
        return file.path;
      },
      deleteBooking: async (trip: Trip, booking: Booking) => {
        const gone = booking.file.path;
        await app.fileManager.trashFile(booking.file);
        // As the delete button does: a price check pointing at this booking
        // must not be inherited by the next one to land on the same path.
        await repointBookings(app, h.settings, trip, gone, null);
        this.recording?.deleted.add(gone);
        await this.afterBooking(trip);
      },

      saveMoments: async (trip: Trip, moments: Moment[]) => {
        await saveMoments(app, trip, moments);
      },
    };
  }

  /** The budget table and friends, rebuilt from bookings the cache has already re-read. */
  private async afterBooking(trip: Trip): Promise<void> {
    await this.settle();
    this.refresh(trip);
    await this.host.syncTripNotes(trip);
  }
}
