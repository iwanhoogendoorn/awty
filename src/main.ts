import { App, Notice, Plugin, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import {
  DEFAULT_SETTINGS,
  FOODSPOT_PLUGIN_ID,
  CREATABLE_SUB_NOTES,
  KINDS,
  AWTY_DASHBOARD_TYPE,
  AWTY_SIDEBAR_TYPE,
  type SubNoteId,
  type AwtySettings,
  type Trip,
  type TripDraft,
  type TripKind,
} from "./types";
import { TripStore } from "./store/tripStore";
import { ProgressCache } from "./store/noteProgress";
import { BookingStore, totalsByCategory } from "./bookings/bookingStore";
import type { Booking, BookingKind, Expense } from "./bookings/types";
import {
  attachmentPaths,
  createBooking,
  createExpense,
  draftFromBooking,
  updateBooking,
  updateExpense,
  importAttachments,
  saveBudget,
} from "./bookings/bookingWriter";
import { AwtyDashboardView } from "./ui/dashboard/dashboardView";
import { BookingWizard } from "./ui/modals/bookingWizard";
import { ExpenseModal } from "./ui/modals/expenseModal";
import { BudgetModal } from "./ui/modals/budgetModal";
import { PackingModal } from "./ui/modals/packingModal";
import { EventDetailsModal } from "./ui/modals/eventDetailsModal";
import { TripPlanWizard } from "./ui/modals/tripPlanWizard";
import { backfillFlightLegs, migrateFoodTables, syncBookingNotes } from "./bookings/bookingSync";
import {
  TravelService,
  TravelUnavailable,
  emptyTravelCache,
  type TravelCache,
  type TripPlaces,
} from "./travel/travelService";
import { travelTable } from "./ui/dashboard/gettingAround";
import { groupByOrigin, itineraryPairs } from "./travel/routePlan";
import { ensureFoodSpot } from "./food/foodSpot";
import { MY_MAPS_URL, tripKml, type MapPlace } from "./export/mapsExport";
import { datesInRange, formatDateRange } from "./util/dates";
import { formatMoney } from "./util/money";
import { joinPath, sanitizeName } from "./util/paths";
import {
  ADVICE_MEANING,
  AdviceUnavailable,
  adviceUrlFor,
  fetchAdvice,
  isStale,
  type TravelAdvice,
} from "./travel/advice";
import { replaceSection } from "./store/sectionWriter";
import { exportTrip } from "./export/pdfExport";
import { createTrip, deleteTrip, notifyError, updateTrip } from "./store/noteWriter";
import { AwtySidebarView } from "./ui/view";
import { TripModal } from "./ui/modals/tripModal";
import { ConfirmDeleteModal } from "./ui/modals/confirmDelete";
import { ConfirmModal } from "./ui/modals/confirmModal";
import { AddDayModal } from "./ui/modals/addDayModal";
import { AwtySettingTab } from "./settings/settingsTab";

/**
 * `app.plugins` is real but not part of the public typings, so this is the
 * narrowest shape we need to answer "is Food Spot switched on?".
 */
interface AppWithPlugins {
  plugins?: { enabledPlugins?: Set<string> };
}

export default class AwtyPlugin extends Plugin {
  settings: AwtySettings = { ...DEFAULT_SETTINGS };
  store!: TripStore;
  /** Sub-note completion, keyed on mtime so edits invalidate themselves. */
  progress!: ProgressCache;
  bookings!: BookingStore;
  travel!: TravelService;
  travelCache: TravelCache = emptyTravelCache();
  /** Resolved places per trip folder, populated only after an explicit calculate. */
  travelPlaces = new Map<string, TripPlaces>();
  /** Wall-clock time this build was loaded, shown in settings to spot a stale plugin. */
  loadedAt = "";
  /** Countries already attempted this session, so a failure is not retried on every render. */
  private adviceTried = new Set<string>();

  async onload(): Promise<void> {
    this.loadedAt = new Date().toLocaleTimeString();
    await this.loadSettings();

    this.store = new TripStore(this.app, () => this.settings);
    this.store.register(this);
    this.progress = new ProgressCache(this.app);
    this.bookings = new BookingStore(this.app, () => this.settings);
    this.travel = new TravelService(
      this.app,
      () => this.settings,
      this.travelCache,
      () => this.persist(),
    );
    // Bookings live in the same vault events the trip store already watches.
    this.store.onChange(() => this.bookings.invalidate());

    this.registerView(AWTY_SIDEBAR_TYPE, (leaf) => new AwtySidebarView(leaf, this));
    this.registerView(AWTY_DASHBOARD_TYPE, (leaf) => new AwtyDashboardView(leaf, this));

    // One ribbon icon, and it lands on the dashboard. The sidebar is still a
    // registered view — dock it from the command palette if you want it pinned.
    this.addRibbonIcon("plane", "Are We There Yet?", () => void this.activateDashboard());
    this.addSettingTab(new AwtySettingTab(this.app, this));

    this.addCommand({
      id: "open-sidebar",
      name: "Open trips sidebar",
      callback: () => void this.activateSidebar(),
    });
    this.addCommand({
      id: "new-trip",
      name: "New trip",
      callback: () => this.openNewTripModal(),
    });
    this.addCommand({
      id: "add-itinerary-day",
      name: "Add itinerary day",
      callback: () => this.openAddDayModal(),
    });
    this.addCommand({
      id: "open-dashboard",
      name: "Open travel dashboard",
      callback: () => void this.activateDashboard(),
    });

    // Booking wizards act on whichever trip you're looking at, falling back to
    // the current or next one so they work from anywhere.
    const bookingCommands: { id: BookingKind; name: string }[] = [
      { id: "flight", name: "Add flight" },
      { id: "stay", name: "Add accommodation" },
      { id: "activity", name: "Add activity or ticket" },
      { id: "transport", name: "Add transport" },
    ];
    for (const command of bookingCommands) {
      this.addCommand({
        id: `add-${command.id}`,
        name: command.name,
        checkCallback: (checking) => {
          const trip = this.contextTrip();
          if (!trip) return false;
          if (!checking) this.openBookingWizard(trip, command.id);
          return true;
        },
      });
    }
    this.addCommand({
      id: "calculate-travel-times",
      name: "Calculate travel times for this trip",
      checkCallback: (checking) => {
        const trip = this.contextTrip();
        if (!trip) return false;
        if (!checking) void this.computeTravelTimes(trip);
        return true;
      },
    });
    this.addCommand({
      id: "write-travel-times",
      name: "Write travel times into the trip notes",
      checkCallback: (checking) => {
        const trip = this.contextTrip();
        if (!trip) return false;
        if (!checking) void this.writeTravelTimes(trip);
        return true;
      },
    });
    this.addCommand({
      id: "plan-trip",
      name: "Plan this trip",
      checkCallback: (checking) => {
        const trip = this.contextTrip();
        if (!trip) return false;
        if (!checking) this.openPlanWizard(trip);
        return true;
      },
    });
    this.addCommand({
      id: "check-travel-advice",
      name: "Check travel advice for this trip",
      checkCallback: (checking) => {
        const trip = this.contextTrip();
        if (!trip?.country) return false;
        if (!checking) void this.refreshAdvice(trip.country);
        return true;
      },
    });
    this.addCommand({
      id: "export-trip",
      name: "Export this trip to PDF",
      checkCallback: (checking) => {
        const trip = this.contextTrip();
        if (!trip) return false;
        if (!checking) void exportTrip(this, trip);
        return true;
      },
    });
    this.addCommand({
      id: "log-expense",
      name: "Log an expense",
      checkCallback: (checking) => {
        const trip = this.contextTrip();
        if (!trip) return false;
        if (!checking) this.openExpenseModal(trip);
        return true;
      },
    });
    this.addCommand({
      id: "edit-current-trip",
      name: "Edit the trip for the current note",
      checkCallback: (checking) => {
        const trip = this.currentTrip();
        if (!trip) return false;
        if (!checking) this.openEditTripModal(trip);
        return true;
      },
    });
    this.addCommand({
      id: "delete-current-trip",
      name: "Delete the trip for the current note",
      checkCallback: (checking) => {
        const trip = this.currentTrip();
        if (!trip) return false;
        if (!checking) this.deleteTrip(trip);
        return true;
      },
    });

    // Repairs flights saved before a direct flight stored its legs. Deferred
    // so it never delays opening the vault.
    this.app.workspace.onLayoutReady(() => {
      // Tables typed before restaurants were bookings become bookings, or the
      // first sync of the Food note would generate over the top of them.
      void migrateFoodTables(this.app, this.settings, this.store.getTrips())
        .then((migrated) => {
          if (migrated === 0) return;
          this.bookings.invalidate();
          this.store.invalidate();
          this.progress.clear();
          this.refreshViews();
          console.info(`[awty] moved ${migrated} table booking(s) into bookings`);
          new Notice(
            `AWTY: moved ${migrated} booked table${migrated === 1 ? "" : "s"} into editable bookings.`,
            8000,
          );
        })
        .catch((err) => console.error("[awty] could not migrate table bookings", err));

      void backfillFlightLegs(this.app, this.settings)
        .then((repaired) => {
          if (repaired === 0) return;
          this.bookings.invalidate();
          this.refreshViews();
          console.info(`[awty] filled in legs for ${repaired} flight(s)`);
        })
        // Detached work with no catch is an unhandled rejection at startup and
        // nothing on screen to say the repair never ran.
        .catch((err) => {
          console.error("[awty] could not repair flight legs", err);
          new Notice("AWTY: could not finish repairing flight details — see the console.");
        });
    });

    // One kind per command, so each can carry its own hotkey.
    for (const def of KINDS) {
      this.addCommand({
        id: `new-${def.id}`,
        name: `New ${def.label.toLowerCase()}`,
        callback: () => this.openNewTripModal(def.id),
      });
    }
  }

  onunload(): void {
    // Leaves are detached by Obsidian; the store's listeners came from
    // registerEvent/registerInterval and unwind with the plugin.
  }

  // ---------------------------------------------------------------- settings

  /**
   * Settings left behind by the plugin's former id.
   *
   * Obsidian keys a plugin's data by its folder, so renaming would otherwise
   * have thrown away the Google key, the starred airports and every cached
   * travel time. Read once, when this install has nothing of its own.
   */
  private async inheritOldSettings(): Promise<unknown | null> {
    for (const id of ["travel-planner-v2", "travel-planner"]) {
      const path = normalizePath(`${this.app.vault.configDir}/plugins/${id}/data.json`);
      try {
        const parsed = JSON.parse(await this.app.vault.adapter.read(path)) as unknown;
        if (parsed && typeof parsed === "object") {
          console.info(`[awty] adopted settings from ${id}`);
          return parsed;
        }
      } catch {
        // Not installed, or nothing saved. Try the next one.
      }
    }
    return null;
  }

  async loadSettings(): Promise<void> {
    const raw = ((await this.loadData()) ?? (await this.inheritOldSettings())) as
      | (Partial<AwtySettings> & {
          settings?: Partial<AwtySettings>;
          travelCache?: TravelCache;
        })
      | null;

    // 2.0 stored the settings object at the top level; 2.1 nests it alongside
    // the travel cache. Read either shape.
    const saved = raw?.settings ?? raw ?? {};
    this.settings = { ...DEFAULT_SETTINGS, ...saved };
    // A kind added in a later version would otherwise have no entry at all.
    const merged = {
      ...DEFAULT_SETTINGS.subNotesByKind,
      ...(saved.subNotesByKind ?? {}),
    } as Record<TripKind, SubNoteId[]>;

    // Settings saved before Event Details was folded into activities still ask
    // for it, and saved settings win over defaults — so a new concert would
    // keep getting a note nothing generates any more.
    for (const kind of Object.keys(merged) as TripKind[]) {
      merged[kind] = merged[kind].filter((id) => CREATABLE_SUB_NOTES.includes(id));
    }
    this.settings.subNotesByKind = merged;

    this.travelCache = {
      legs: raw?.travelCache?.legs ?? {},
      geocode: raw?.travelCache?.geocode ?? {},
      advice: raw?.travelCache?.advice ?? {},
    };
  }

  private async persist(): Promise<void> {
    await this.saveData({ settings: this.settings, travelCache: this.travelCache });
  }

  async saveSettings(): Promise<void> {
    await this.persist();
    this.store.invalidate();
  }

  // -------------------------------------------------------------------- view

  async activateSidebar(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(AWTY_SIDEBAR_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: AWTY_SIDEBAR_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  /**
   * A new tab at the end of the tab bar.
   *
   * A new tab is created beside whichever one is active, so opening the
   * dashboard from the middle of a row of notes wedged it into the middle. The
   * last root leaf is made active first, so the new tab lands after it.
   */
  private newTabAtEnd(): WorkspaceLeaf {
    const { workspace } = this.app;
    let last: WorkspaceLeaf | null = null;
    workspace.iterateRootLeaves((leaf) => {
      last = leaf;
    });
    if (last) workspace.setActiveLeaf(last, { focus: false });
    return workspace.getLeaf("tab");
  }

  /**
   * Opens a note without taking over the dashboard's own tab.
   *
   * `getLeaf(false)` hands back whichever leaf is active, which from the
   * dashboard is the dashboard — so clicking Open replaced the thing you were
   * working in and there was no way back but to reopen it.
   */
  async openInWorkspace(file: TFile, _newTab = false): Promise<void> {
    const { workspace } = this.app;

    // Already open somewhere: go to it. Opening a second tab onto the same
    // note is how you end up with four tabs of the same packing list.
    let existing: WorkspaceLeaf | null = null;
    workspace.iterateRootLeaves((leaf) => {
      if (existing) return;
      const view = leaf.view;
      if (view.getViewType() === AWTY_DASHBOARD_TYPE) return;
      if ((view as { file?: TFile }).file?.path === file.path) existing = leaf;
    });
    if (existing) {
      await workspace.revealLeaf(existing);
      return;
    }

    // Otherwise a new tab at the end. Reusing the last tab meant every note
    // opened from the dashboard replaced the one opened before it, so you
    // could never have the itinerary and the packing list side by side.
    await this.newTabAtEnd().openFile(file);
  }

  async activateDashboard(trip?: Trip): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(AWTY_DASHBOARD_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = this.newTabAtEnd();
      await leaf.setViewState({ type: AWTY_DASHBOARD_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (trip && view instanceof AwtyDashboardView) view.showTrip(trip);
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(AWTY_SIDEBAR_TYPE)) {
      const view = leaf.view;
      if (view instanceof AwtySidebarView) view.render();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(AWTY_DASHBOARD_TYPE)) {
      const view = leaf.view;
      if (view instanceof AwtyDashboardView) view.render();
    }
  }

  /** The trip a command should act on: the open note's, else current, else next. */
  contextTrip(): Trip | null {
    const fromNote = this.currentTrip();
    if (fromNote) return fromNote;
    const trips = this.store.getTrips();
    return trips.find((t) => t.status === "current") ?? trips.find((t) => t.status === "upcoming") ?? trips[0] ?? null;
  }

  /**
   * The booking form, for a new booking or an existing one.
   *
   * Changing a booking used to mean opening its note and retyping frontmatter,
   * which is the exact thing the dashboard exists to avoid.
   */
  async openBookingWizard(trip: Trip, kind: BookingKind, existing?: Booking): Promise<void> {
    new BookingWizard(
      this.app,
      this.settings,
      trip,
      kind,
      this.bookings.getCurrency(trip),
      {
        isStarred: (kind, value) =>
          (kind === "airline" ? this.settings.starredAirlines : this.settings.starredAirports).includes(
            value,
          ),
        toggle: async (kind, value) => {
          const list =
            kind === "airline" ? this.settings.starredAirlines : this.settings.starredAirports;
          const starred = new Set(list);
          if (starred.has(value)) starred.delete(value);
          else starred.add(value);
          const next = [...starred].sort();
          if (kind === "airline") this.settings.starredAirlines = next;
          else this.settings.starredAirports = next;
          await this.saveSettings();
        },
      },
      async (draft, files) => {
        // Attachments are copied only once the wizard is actually submitted, so
        // an abandoned form leaves nothing behind.
        const added = await importAttachments(this.app, this.settings, trip, files);
        const attachments = [...draft.attachments, ...added];
        if (existing) {
          await updateBooking(this.app, trip, existing.file, { ...draft, attachments });
        } else {
          await createBooking(this.app, this.settings, trip, { ...draft, attachments });
        }
        // An address, a venue or a date just changed, so the places resolved
        // for this trip are no longer what the notes say. Dropped before the
        // stores notify, or a synchronous listener repaints "distances worked
        // out" from places that no longer exist.
        this.travelPlaces.delete(trip.folderPath);
        this.bookings.invalidate();
        this.store.invalidate();
        await this.syncTripNotes(trip);
        new Notice(existing ? `Updated “${draft.title}”.` : `Added “${draft.title}”.`);
      },
      existing ? await draftFromBooking(this.app, existing) : undefined,
      existing ? () => this.deleteItem(trip, existing.file, existing.title) : undefined,
    ).open();
  }

  /**
   * Removes a booking or an expense, after asking.
   *
   * Only a right-click in the Bookings tab offered this, which is nowhere near
   * where most things are looked at — so in practice there was no way to
   * remove anything without going to the file itself.
   */
  deleteItem(trip: Trip, file: TFile, label: string): void {
    new ConfirmModal(this.app, {
      title: "Delete this?",
      name: label,
      detail: file.path,
      onConfirm: async () => {
        await this.app.fileManager.trashFile(file);
        this.travelPlaces.delete(trip.folderPath);
        this.bookings.invalidate();
        this.store.invalidate();
        this.progress.clear();
        await this.syncTripNotes(trip);
        this.refreshViews();
        new Notice(`Deleted “${label}”.`);
      },
    }).open();
  }

  openExpenseModal(trip: Trip, existing?: Expense): void {
    new ExpenseModal(
      this.app,
      this.settings,
      trip,
      this.bookings.getCurrency(trip),
      async (draft, files) => {
        const added = await importAttachments(this.app, this.settings, trip, files);
        const attachments = [...draft.attachments, ...added];
        if (existing) {
          await updateExpense(this.app, trip, existing.file, { ...draft, attachments });
        } else {
          await createExpense(this.app, this.settings, trip, { ...draft, attachments });
        }
        this.bookings.invalidate();
        this.store.invalidate();
        await this.syncTripNotes(trip);
        new Notice(existing ? `Updated “${draft.description}”.` : `Logged “${draft.description}”.`);
      },
      existing
        ? {
            date: existing.date,
            description: existing.description,
            amount: existing.amount.amount,
            currency: existing.amount.currency,
            category: existing.category,
            paidBy: existing.paidBy,
            attachments: attachmentPaths(this.app, existing.attachments, existing.file.path),
          }
        : undefined,
      existing ? () => this.deleteItem(trip, existing.file, existing.description) : undefined,
    ).open();
  }

  /**
   * Writes the trip's places as a KML file, for Google My Maps.
   *
   * Coordinates come from what is already on the bookings, so this costs no
   * geocoding: anything without them travels as an address for My Maps to
   * resolve on import.
   */
  async exportMap(trip: Trip): Promise<void> {
    const places: MapPlace[] = [];
    const seen = new Set<string>();

    const add = (place: MapPlace): void => {
      const key = `${place.group}|${place.name.toLowerCase()}`;
      if (!place.name || seen.has(key)) return;
      if (!place.location && !place.address) return;
      seen.add(key);
      places.push(place);
    };

    for (const booking of this.bookings.getBookings(trip)) {
      if (booking.status === "cancelled") continue;
      const fm = this.app.metadataCache.getFileCache(booking.file)?.frontmatter;
      const group =
        booking.kind === "stay"
          ? "Stay"
          : booking.kind === "flight"
            ? "Airport"
            : booking.kind === "restaurant"
              ? "Restaurant"
              : booking.kind === "transport"
                ? "Transport"
                : "Activity";
      add({
        name: booking.kind === "flight" ? booking.to || booking.title : booking.title,
        group,
        address: booking.address || (booking.kind === "flight" ? `${booking.to} airport` : ""),
        location: String(fm?.location ?? ""),
        detail: [
          formatDateRange(booking.date, booking.endDate),
          booking.time,
          booking.cost ? formatMoney(booking.cost) : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }

    // Places you have not booked but want to try are worth having on the map.
    for (const spot of this.travel.restaurantsFor(trip)) {
      const fm = spot.file ? this.app.metadataCache.getFileCache(spot.file)?.frontmatter : undefined;
      add({
        name: spot.label,
        group: "Restaurant",
        address: String(fm?.address ?? ""),
        location: `${spot.coord.lat},${spot.coord.lng}`,
        detail: String(fm?.cuisines ?? ""),
      });
    }

    if (places.length === 0) {
      new Notice("Nothing to map yet — add a booking with an address.");
      return;
    }

    const name = `${sanitizeName(trip.title)} map.kml`;
    const path = joinPath(trip.folderPath, name);
    const kml = tripKml(trip.title, places);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await this.app.vault.modify(existing, kml);
    else await this.app.vault.create(path, kml);

    await navigator.clipboard.writeText(MY_MAPS_URL).catch(() => undefined);
    new Notice(
      `${places.length} places written to "${name}". Google has no link that makes a saved ` +
        `list, so: open My Maps (link copied), Create a new map, Import, and choose that file.`,
      15000,
    );
  }

  /** Cached advice for a country, without touching the network. */
  peekAdvice(country: string): TravelAdvice | null {
    const hit = this.travelCache.advice?.[country];
    if (!hit) return null;
    return {
      colour: hit.colour as TravelAdvice["colour"],
      country,
      url: hit.url,
      fetchedAt: hit.fetchedAt,
    };
  }

  /**
   * Refreshes advice that is missing or a day old, once per country per session.
   *
   * The last answer is kept across restarts so the panel is not blank every
   * time Obsidian opens, and re-fetched when it ages out — which is what makes
   * it current rather than merely remembered. Nothing is fetched when the
   * feature is off.
   */
  ensureAdvice(country: string, onDone?: () => void): void {
    if (!country || !this.settings.travelAdviceEnabled) return;
    if (this.adviceTried.has(country)) return;

    const cached = this.peekAdvice(country);
    if (cached && !isStale(cached)) return;
    if (!adviceUrlFor(country)) return;

    this.adviceTried.add(country);
    void this.refreshAdvice(country, onDone, true);
  }

  /**
   * Fetches the Dutch government travel advice for a country.
   *
   * Explicit action only, and cached for a day — this reaches out to
   * nederlandwereldwijd.nl, and safety advice that is a week stale is worse
   * than none.
   */
  async refreshAdvice(country: string, onDone?: () => void, quiet = false): Promise<void> {
    if (!country) {
      new Notice("Set a country on the trip first.");
      return;
    }
    const notice = quiet ? null : new Notice("Checking travel advice…", 0);
    try {
      const advice = await fetchAdvice(country);
      if (!this.travelCache.advice) this.travelCache.advice = {};
      this.travelCache.advice[country] = {
        colour: advice.colour,
        url: advice.url,
        fetchedAt: advice.fetchedAt,
      };
      await this.persist();
      notice?.hide();
      // An automatic refresh should not announce itself.
      if (!quiet) new Notice(`${country}: code ${ADVICE_MEANING[advice.colour].label.toLowerCase()}.`);
      onDone?.();
      this.refreshViews();
    } catch (err) {
      notice?.hide();
      if (quiet) {
        console.error("[awty] advice refresh failed", err);
        return;
      }
      const message =
        err instanceof AdviceUnavailable
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not fetch travel advice.";
      new Notice(`AWTY: ${message}`, 8000);
      console.error("[awty]", err);
    }
  }

  exportTrip(trip: Trip): void {
    void exportTrip(this, trip);
  }

  openPlanWizard(trip: Trip): void {
    new TripPlanWizard(this.app, this, trip).open();
  }

  /** Regenerates the sub-note tables from bookings, expenses and targets. */
  private async syncTripNotes(trip: Trip): Promise<void> {
    await syncBookingNotes(this.app, trip, this.bookings.getBookings(trip), {
      targets: this.bookings.getBudget(trip),
      lines: this.bookings.getCostLines(trip),
      currency: this.bookings.getCurrency(trip),
    });
  }

  openBudgetModal(trip: Trip): void {
    new BudgetModal(
      this.app,
      trip,
      this.bookings.getBudget(trip),
      this.bookings.getCurrency(trip),
      new Map(
        [...totalsByCategory(this.bookings.getCostLines(trip))].map(([category, byCurrency]) => [
          category,
          byCurrency.get(this.bookings.getCurrency(trip)) ?? 0,
        ]),
      ),
      this.bookings.hasExplicitBudgetTotal(trip) ? this.bookings.getBudgetTotal(trip) : null,
      this.settings.customCategories,
      async (name) => {
        // An empty name means a removal; the modal has already updated its copy.
        const next = name
          ? [...new Set([...this.settings.customCategories, name])]
          : this.settings.customCategories;
        this.settings.customCategories = next;
        await this.saveSettings();
      },
      async (budget, currency, total) => {
        await saveBudget(this.app, trip, budget, currency, total);
        this.bookings.invalidate();
        this.store.invalidate();
        // The targets went onto the trip note; the Budget note has to be told.
        await this.syncTripNotes(trip);
        this.progress.clear();
        this.refreshViews();
        new Notice("Budget saved.");
      },
    ).open();
  }

  // ------------------------------------------------------------------ trips

  /** The trip governing the note you're looking at, if any. */
  currentTrip(): Trip | null {
    const file = this.app.workspace.getActiveFile();
    return file ? this.store.getTripForFile(file) : null;
  }

  /**
   * Opens this plugin's settings tab.
   *
   * `app.setting` is real but not in the public typings, so this is
   * feature-detected and degrades to telling you where to look.
   */
  openSettings(): void {
    const setting = (this.app as unknown as {
      setting?: { open?: () => void; openTabById?: (id: string) => void };
    }).setting;

    if (setting?.open && setting.openTabById) {
      setting.open();
      setting.openTabById(this.manifest.id);
      return;
    }
    new Notice("Open Settings → Community plugins → Are We There Yet?");
  }

  isFoodSpotAvailable(): boolean {
    const plugins = (this.app as unknown as AppWithPlugins).plugins;
    return plugins?.enabledPlugins?.has(FOODSPOT_PLUGIN_ID) ?? false;
  }

  openNewTripModal(kind?: TripKind): void {
    const initial: Partial<TripDraft> = kind
      ? { kind, subNotes: [...(this.settings.subNotesByKind[kind] ?? [])] }
      : {};
    new TripModal(this.app, this.settings, "create", initial, async (draft) => {
      const result = await createTrip(this.app, this.settings, draft, this.isFoodSpotAvailable());
      new Notice(
        `Created “${draft.title}” with ${result.subNoteFiles.length} note${
          result.subNoteFiles.length === 1 ? "" : "s"
        }.`,
      );
      this.store.invalidate();
      // Deliberately does not open the note. You stay where you were and click
      // through to a note only when you actually want one.
      this.selectTripInDashboard(result.tripFile.path);
      // Planning continues from here rather than dumping you on a blank note.
      const created = this.store.getTrips().find((t) => t.file.path === result.tripFile.path);
      if (created) this.openPlanWizard(created);
    }).open();
  }

  openEditTripModal(trip: Trip): void {
    TripModal.forEdit(this.app, this.settings, trip, async (draft) => {
      await updateTrip(this.app, this.settings, trip, draft);
      new Notice(`Updated “${draft.title}”.`);
      // The city or the dates may have moved; the resolved places have not.
      // Dropped before the store notifies, so no listener repaints from them.
      this.travelPlaces.delete(trip.folderPath);
      this.store.invalidate();
    }).open();
  }

  openAddDayModal(trip?: Trip, date?: string): void {
    new AddDayModal(
      this.app,
      this,
      trip ?? null,
      () => {
        this.store.invalidate();
        this.refreshViews();
      },
      date,
    ).open();
  }

  /** Points any open dashboard at a trip, without opening its note. */
  selectTripInDashboard(path: string): void {
    for (const leaf of this.app.workspace.getLeavesOfType(AWTY_DASHBOARD_TYPE)) {
      const view = leaf.view;
      if (view instanceof AwtyDashboardView) view.selectByPath(path);
    }
    this.refreshViews();
  }

  /**
   * Opens the right wizard for a sub-note, so every note can be filled in from
   * the GUI rather than by typing markdown.
   */
  openNoteWizard(trip: Trip, id: SubNoteId): void {
    switch (id) {
      case "itinerary":
        this.openAddDayModal(trip);
        return;
      case "accommodation":
        this.openBookingWizard(trip, "stay");
        return;
      case "transport":
        this.openBookingWizard(trip, "transport");
        return;
      case "budget":
        this.openBudgetModal(trip);
        return;
      case "packing":
        new PackingModal(this.app, trip, () => {
          this.store.invalidate();
          this.refreshViews();
        }).open();
        return;
      case "event-details":
        // Kept for notes created before this became an activity.
        new EventDetailsModal(this.app, trip, () => {
          this.store.invalidate();
          this.refreshViews();
        }).open();
        return;
      case "food":
        // A table is a booking: same form, so it is editable, costed, placed
        // on a day and measured from the hotel like everything else.
        void this.openBookingWizard(trip, "restaurant");
        return;
    }
  }

  deleteTrip(trip: Trip): void {
    const run = async (): Promise<void> => {
      try {
        const count = await deleteTrip(this.app, trip);
        // Nothing about the trip should survive it: places, cached routes and
        // the advice fetched for its country all go too.
        this.travelPlaces.delete(trip.folderPath);
        if (trip.country && this.travelCache.advice) delete this.travelCache.advice[trip.country];
        await this.travel.forgetTrip(trip);
        new Notice(`Deleted “${trip.title}” (${count} file${count === 1 ? "" : "s"}).`);
        this.bookings.invalidate();
        this.progress.clear();
        this.store.invalidate();
      } catch (err) {
        notifyError(err, "Could not delete the trip.");
      }
    };

    if (!this.settings.confirmDelete) {
      void run();
      return;
    }
    new ConfirmDeleteModal(this.app, trip, run).open();
  }

  // ------------------------------------------------------------ travel times

  /**
   * Resolves the trip's places and fills in any missing routes.
   *
   * Only ever runs from an explicit action — a button or a command — because
   * each uncached pair is a billed Google request. Cached pairs cost nothing, so
   * re-running is cheap; `force` throws the cache away first.
   */
  async computeTravelTimes(trip: Trip, onDone?: () => void, force = false): Promise<void> {
    if (!this.travel.isConfigured()) {
      new Notice("AWTY: switch on travel times and add a Google API key in settings.");
      return;
    }

    // The settings UI refuses to untick the last mode, but the persisted list
    // can still be empty (hand-edited data.json, older versions). Geocoding
    // for zero modes bills and then announces success over nothing.
    if (this.settings.travelModes.length === 0) {
      new Notice("Pick at least one travel mode in settings first.");
      return;
    }

    const notice = new Notice("Working out travel times…", 0);
    try {
      // Refresh means "fetch these again", not "delete first and hope".
      // Forgetting the trip up front destroyed routes touching any coordinate
      // it shared with other trips — the same airport, the same restaurants —
      // and did it before knowing whether the refresh would even succeed.

      const places = await this.travel.placesFor(trip, this.bookings.getBookings(trip));
      this.travelPlaces.set(trip.folderPath, places);

      const origin = places.hotels[0];
      if (!origin) {
        notice.hide();
        new Notice("Add an accommodation booking first — distances are measured from it.");
        onDone?.();
        return;
      }

      const destinations = [...places.airports, ...places.activities, ...places.restaurants];
      if (destinations.length === 0) {
        notice.hide();
        new Notice("Nothing to measure to yet. Add a flight, an activity, or Food Spot restaurants in this city.");
        onDone?.();
        return;
      }

      const when = this.travel.departureTimeFor(trip);
      await this.travel.fetchLegs(origin, destinations, this.settings.travelModes, when, false, force);

      // And the hops the timeline draws between one event and the next, which
      // rarely start at the hotel: airport to hotel on arrival, activity to
      // activity in the afternoon. Without these the day-by-day view asks the
      // cache for pairs that were never measured, and shows nothing.
      const pairs = itineraryPairs(
        this.bookings.getBookings(trip).filter((b) => b.status !== "cancelled"),
        datesInRange(trip.startDate, trip.endDate, 90),
        [...places.hotels, ...places.airports, ...places.activities, ...places.restaurants],
        origin,
      );
      for (const group of groupByOrigin(pairs)) {
        await this.travel.fetchLegs(group.from, group.to, this.settings.travelModes, when, false, force);
      }

      notice.hide();
      new Notice(
        `Travel times ready for ${destinations.length} places and ${pairs.length} connections.`,
      );
      onDone?.();
      this.refreshViews();
    } catch (err) {
      notice.hide();
      const message =
        err instanceof TravelUnavailable
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not work out travel times.";
      new Notice(`AWTY: ${message}`, 8000);
      console.error("[awty]", err);
    }
  }

  /**
   * Writes the travel tables into the notes themselves — the hotel booking, and
   * the Food note — so they are readable offline and on mobile.
   */
  async writeTravelTimes(trip: Trip): Promise<void> {
    // Writing what is already known must not go to the network. This used to
    // fall through to computeTravelTimes, so a command labelled "write into
    // the notes" could geocode and bill the user's own Google account.
    const resolved = this.travelPlaces.get(trip.folderPath);
    const origin = resolved?.hotels[0];
    if (!resolved || !origin) {
      new Notice("Nothing calculated for this trip yet — press Calculate on Getting around first.");
      return;
    }

    const modes = this.settings.travelModes;
    let written = 0;

    // Hotel note: airport and activities.
    const hotelTargets = [...resolved.airports, ...resolved.activities];
    const hotelTable = travelTable(
      origin,
      hotelTargets,
      this.travel.peekLegs(origin, hotelTargets, modes),
      modes,
    );
    if (hotelTable && origin.file) {
      await replaceSection(this.app, origin.file, "Travel times", hotelTable);
      written += 1;
    }

    // Food note: how walkable each restaurant is from where you're staying.
    const foodNote = this.store.getSubNotes(trip).find((s) => s.id === "food");
    const foodTable = travelTable(
      origin,
      resolved.restaurants,
      this.travel.peekLegs(origin, resolved.restaurants, modes),
      modes,
    );
    if (foodNote && foodTable) {
      await replaceSection(this.app, foodNote.file, "Travel times", foodTable);
      written += 1;
    }

    new Notice(
      written === 0
        ? "Nothing to write yet — calculate travel times first."
        : `Travel times written into ${written} note${written === 1 ? "" : "s"}.`,
    );
  }

  async openTrip(trip: Trip, newTab = false): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(trip.file.path);
    if (!(file instanceof TFile)) {
      new Notice("That trip note no longer exists.");
      this.store.invalidate();
      return;
    }
    await this.app.workspace.getLeaf(newTab).openFile(file);
  }
}
