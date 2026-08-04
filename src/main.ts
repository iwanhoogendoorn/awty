import { App, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import {
  DEFAULT_SETTINGS,
  FOODSPOT_PLUGIN_ID,
  KINDS,
  TRAVEL_DASHBOARD_TYPE,
  TRAVEL_VIEW_TYPE,
  type SubNoteId,
  type TravelPlannerSettings,
  type Trip,
  type TripDraft,
  type TripKind,
} from "./types";
import { TripStore } from "./store/tripStore";
import { ProgressCache } from "./store/noteProgress";
import { BookingStore, totalsByCategory } from "./bookings/bookingStore";
import type { BookingKind } from "./bookings/types";
import {
  createBooking,
  createExpense,
  importAttachments,
  saveBudget,
} from "./bookings/bookingWriter";
import { TravelDashboardView } from "./ui/dashboard/dashboardView";
import { BookingWizard } from "./ui/modals/bookingWizard";
import { ExpenseModal } from "./ui/modals/expenseModal";
import { BudgetModal } from "./ui/modals/budgetModal";
import { PackingModal } from "./ui/modals/packingModal";
import { EventDetailsModal } from "./ui/modals/eventDetailsModal";
import { FoodModal } from "./ui/modals/foodModal";
import { TripPlanWizard } from "./ui/modals/tripPlanWizard";
import { syncBookingNotes } from "./bookings/bookingSync";
import {
  TravelService,
  TravelUnavailable,
  emptyTravelCache,
  type TravelCache,
  type TripPlaces,
} from "./travel/travelService";
import { travelTable } from "./ui/dashboard/gettingAround";
import { replaceSection } from "./store/sectionWriter";
import { createTrip, deleteTrip, notifyError, updateTrip } from "./store/noteWriter";
import { TravelSidebarView } from "./ui/view";
import { TripModal } from "./ui/modals/tripModal";
import { ConfirmDeleteModal } from "./ui/modals/confirmDelete";
import { AddDayModal } from "./ui/modals/addDayModal";
import { TravelPlannerSettingTab } from "./settings/settingsTab";

/**
 * `app.plugins` is real but not part of the public typings, so this is the
 * narrowest shape we need to answer "is Food Spot switched on?".
 */
interface AppWithPlugins {
  plugins?: { enabledPlugins?: Set<string> };
}

export default class TravelPlannerPlugin extends Plugin {
  settings: TravelPlannerSettings = { ...DEFAULT_SETTINGS };
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

    this.registerView(TRAVEL_VIEW_TYPE, (leaf) => new TravelSidebarView(leaf, this));
    this.registerView(TRAVEL_DASHBOARD_TYPE, (leaf) => new TravelDashboardView(leaf, this));

    // One ribbon icon, and it lands on the dashboard. The sidebar is still a
    // registered view — dock it from the command palette if you want it pinned.
    this.addRibbonIcon("plane", "Travel Planner", () => void this.activateDashboard());
    this.addSettingTab(new TravelPlannerSettingTab(this.app, this));

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

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as
      | (Partial<TravelPlannerSettings> & {
          settings?: Partial<TravelPlannerSettings>;
          travelCache?: TravelCache;
        })
      | null;

    // 2.0 stored the settings object at the top level; 2.1 nests it alongside
    // the travel cache. Read either shape.
    const saved = raw?.settings ?? raw ?? {};
    this.settings = { ...DEFAULT_SETTINGS, ...saved };
    // A kind added in a later version would otherwise have no entry at all.
    this.settings.subNotesByKind = {
      ...DEFAULT_SETTINGS.subNotesByKind,
      ...(saved.subNotesByKind ?? {}),
    } as Record<TripKind, SubNoteId[]>;

    this.travelCache = {
      legs: raw?.travelCache?.legs ?? {},
      geocode: raw?.travelCache?.geocode ?? {},
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
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(TRAVEL_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: TRAVEL_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async activateDashboard(trip?: Trip): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(TRAVEL_DASHBOARD_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: TRAVEL_DASHBOARD_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (trip && view instanceof TravelDashboardView) view.showTrip(trip);
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(TRAVEL_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof TravelSidebarView) view.render();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(TRAVEL_DASHBOARD_TYPE)) {
      const view = leaf.view;
      if (view instanceof TravelDashboardView) view.render();
    }
  }

  /** The trip a command should act on: the open note's, else current, else next. */
  contextTrip(): Trip | null {
    const fromNote = this.currentTrip();
    if (fromNote) return fromNote;
    const trips = this.store.getTrips();
    return trips.find((t) => t.status === "current") ?? trips.find((t) => t.status === "upcoming") ?? trips[0] ?? null;
  }

  openBookingWizard(trip: Trip, kind: BookingKind): void {
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
        const paths = await importAttachments(this.app, this.settings, trip, files);
        const file = await createBooking(this.app, this.settings, trip, {
          ...draft,
          attachments: paths,
        });
        this.bookings.invalidate();
        this.store.invalidate();
        await syncBookingNotes(this.app, trip, this.bookings.getBookings(trip));
        new Notice(`Added “${draft.title}”.`);
        void file;
      },
    ).open();
  }

  openExpenseModal(trip: Trip): void {
    new ExpenseModal(this.app, this.settings, trip, this.bookings.getCurrency(trip), async (draft, files) => {
      const paths = await importAttachments(this.app, this.settings, trip, files);
      await createExpense(this.app, this.settings, trip, { ...draft, attachments: paths });
      this.bookings.invalidate();
      this.store.invalidate();
      new Notice(`Logged “${draft.description}”.`);
    }).open();
  }

  openPlanWizard(trip: Trip): void {
    new TripPlanWizard(this.app, this, trip).open();
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
      async (budget, currency) => {
        await saveBudget(this.app, trip, budget, currency);
        this.bookings.invalidate();
        this.store.invalidate();
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
      this.store.invalidate();
    }).open();
  }

  openAddDayModal(trip?: Trip): void {
    new AddDayModal(this.app, this.store, trip ?? null, () => {
      this.store.invalidate();
      this.refreshViews();
    }).open();
  }

  /** Points any open dashboard at a trip, without opening its note. */
  selectTripInDashboard(path: string): void {
    for (const leaf of this.app.workspace.getLeavesOfType(TRAVEL_DASHBOARD_TYPE)) {
      const view = leaf.view;
      if (view instanceof TravelDashboardView) view.selectByPath(path);
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
        new EventDetailsModal(this.app, trip, () => {
          this.store.invalidate();
          this.refreshViews();
        }).open();
        return;
      case "food":
        new FoodModal(this.app, this.settings, trip, () => {
          this.store.invalidate();
          this.refreshViews();
        }).open();
        return;
    }
  }

  deleteTrip(trip: Trip): void {
    const run = async (): Promise<void> => {
      try {
        const count = await deleteTrip(this.app, trip);
        new Notice(`Deleted “${trip.title}” (${count} file${count === 1 ? "" : "s"}).`);
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
      new Notice("Travel Planner: switch on travel times and add a Google API key in settings.");
      return;
    }

    const notice = new Notice("Working out travel times…", 0);
    try {
      if (force) await this.travel.clearLegs();

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

      await this.travel.fetchLegs(
        origin,
        destinations,
        this.settings.travelModes,
        this.travel.departureTimeFor(trip),
      );

      notice.hide();
      new Notice(`Travel times ready for ${destinations.length} places.`);
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
      new Notice(`Travel Planner: ${message}`, 8000);
      console.error("[travel-planner]", err);
    }
  }

  /**
   * Writes the travel tables into the notes themselves — the hotel booking, and
   * the Food note — so they are readable offline and on mobile.
   */
  async writeTravelTimes(trip: Trip): Promise<void> {
    const places = this.travelPlaces.get(trip.folderPath);
    if (!places) {
      await this.computeTravelTimes(trip);
    }
    const resolved = this.travelPlaces.get(trip.folderPath);
    const origin = resolved?.hotels[0];
    if (!resolved || !origin) return;

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
