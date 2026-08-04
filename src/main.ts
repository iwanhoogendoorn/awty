import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
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
import { BookingStore } from "./bookings/bookingStore";
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

  async onload(): Promise<void> {
    await this.loadSettings();

    this.store = new TripStore(this.app, () => this.settings);
    this.store.register(this);
    this.progress = new ProgressCache(this.app);
    this.bookings = new BookingStore(this.app, () => this.settings);
    // Bookings live in the same vault events the trip store already watches.
    this.store.onChange(() => this.bookings.invalidate());

    this.registerView(TRAVEL_VIEW_TYPE, (leaf) => new TravelSidebarView(leaf, this));
    this.registerView(TRAVEL_DASHBOARD_TYPE, (leaf) => new TravelDashboardView(leaf, this));

    this.addRibbonIcon("plane", "Travel Planner", () => void this.activateSidebar());
    this.addRibbonIcon("layout-dashboard", "Travel dashboard", () => void this.activateDashboard());
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
    const saved = (await this.loadData()) as Partial<TravelPlannerSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
    // A kind added in a later version would otherwise have no entry at all.
    this.settings.subNotesByKind = {
      ...DEFAULT_SETTINGS.subNotesByKind,
      ...(saved?.subNotesByKind ?? {}),
    } as Record<TripKind, SubNoteId[]>;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
        new Notice(`Added “${draft.title}”.`);
        void file;
      },
    ).open();
  }

  openExpenseModal(trip: Trip): void {
    new ExpenseModal(this.app, trip, this.bookings.getCurrency(trip), async (draft, files) => {
      const paths = await importAttachments(this.app, this.settings, trip, files);
      await createExpense(this.app, this.settings, trip, { ...draft, attachments: paths });
      this.bookings.invalidate();
      this.store.invalidate();
      new Notice(`Logged “${draft.description}”.`);
    }).open();
  }

  openBudgetModal(trip: Trip): void {
    new BudgetModal(
      this.app,
      trip,
      this.bookings.getBudget(trip),
      this.bookings.getCurrency(trip),
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
      await this.app.workspace.getLeaf(false).openFile(result.tripFile);
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
    if (trip) {
      // Opening the trip first makes the modal's inference land on it.
      void this.app.workspace.getLeaf(false).openFile(trip.file);
    }
    new AddDayModal(this.app, this.store, () => this.store.invalidate()).open();
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
