import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import {
  DEFAULT_SETTINGS,
  FOODSPOT_PLUGIN_ID,
  KINDS,
  TRAVEL_VIEW_TYPE,
  type SubNoteId,
  type TravelPlannerSettings,
  type Trip,
  type TripDraft,
  type TripKind,
} from "./types";
import { TripStore } from "./store/tripStore";
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

  async onload(): Promise<void> {
    await this.loadSettings();

    this.store = new TripStore(this.app, () => this.settings);
    this.store.register(this);

    this.registerView(TRAVEL_VIEW_TYPE, (leaf) => new TravelSidebarView(leaf, this));

    this.addRibbonIcon("plane", "Travel Planner", () => void this.activateSidebar());
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

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(TRAVEL_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof TravelSidebarView) view.render();
    }
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
