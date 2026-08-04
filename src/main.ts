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
import { FoodModal } from "./ui/modals/foodModal";
import { TripPlanWizard } from "./ui/modals/tripPlanWizard";
import { backfillFlightLegs, syncBookingNotes } from "./bookings/bookingSync";
import {
  TravelService,
  TravelUnavailable,
  emptyTravelCache,
  type TravelCache,
  type TripPlaces,
} from "./travel/travelService";
import { travelTable } from "./ui/dashboard/gettingAround";
import { groupByOrigin, itineraryPairs } from "./travel/routePlan";
import { datesInRange } from "./util/dates";
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
      void backfillFlightLegs(this.app, this.settings).then((repaired) => {
        if (repaired === 0) return;
        this.bookings.invalidate();
        this.refreshViews();
        console.info(`[awty] filled in legs for ${repaired} flight(s)`);
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
  async openInWorkspace(file: TFile, newTab = false): Promise<void> {
    const { workspace } = this.app;
    if (newTab) {
      await this.newTabAtEnd().openFile(file);
      return;
    }

    const active = workspace.getMostRecentLeaf();
    if (active && active.view.getViewType() !== AWTY_DASHBOARD_TYPE) {
      await active.openFile(file);
      return;
    }

    const others: WorkspaceLeaf[] = [];
    workspace.iterateRootLeaves((leaf) => {
      if (leaf.view.getViewType() !== AWTY_DASHBOARD_TYPE) others.push(leaf);
    });
    await (others[others.length - 1] ?? this.newTabAtEnd()).openFile(file);
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
        this.bookings.invalidate();
        this.store.invalidate();
        await syncBookingNotes(this.app, trip, this.bookings.getBookings(trip));
        new Notice(existing ? `Updated “${draft.title}”.` : `Added “${draft.title}”.`);
      },
      existing ? await draftFromBooking(this.app, existing) : undefined,
    ).open();
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
    ).open();
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

      const when = this.travel.departureTimeFor(trip);
      await this.travel.fetchLegs(origin, destinations, this.settings.travelModes, when);

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
        await this.travel.fetchLegs(group.from, group.to, this.settings.travelModes, when);
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
