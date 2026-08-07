import { ItemView, Menu, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { BOOKING_KINDS } from "../../bookings/types";
import type AwtyPlugin from "../../main";
import type { Trip } from "../../types";
import { AWTY_DASHBOARD_TYPE } from "../../types";
import { isMobile } from "../../util/platform";
import type { DashboardContext } from "./common";
import { renderOverview } from "./tabs/overview";
import { renderTrips } from "./tabs/trips";
import { renderPlanning } from "./tabs/planning";
import { renderItinerary } from "./tabs/itinerary";
import { renderBookings } from "./tabs/bookings";
import { renderCosts } from "./tabs/costs";
import { renderGallery } from "./tabs/gallery";
import { showTripMenu } from "./tripMenu";

type TabId = "overview" | "planning" | "trips" | "itinerary" | "bookings" | "costs" | "gallery";

/**
 * Trips first, and everything after it is about the one trip you picked there.
 *
 * The dashboard used to open on Overview with a trip chosen for you, which
 * meant the first thing it showed was a trip you had not asked about — and on
 * a vault with several, the one it guessed was as likely to be wrong as right.
 * `tripScoped` is what draws the divider and what decides whether a tab can
 * say anything at all with nothing selected.
 */
const TABS: { id: TabId; label: string; icon: string; tripScoped?: boolean }[] = [
  { id: "trips", label: "Trips", icon: "plane" },
  { id: "overview", label: "Overview", icon: "layout-dashboard", tripScoped: true },
  { id: "planning", label: "Planning", icon: "compass", tripScoped: true },
  { id: "itinerary", label: "Itinerary", icon: "calendar-days", tripScoped: true },
  { id: "bookings", label: "Bookings", icon: "ticket", tripScoped: true },
  { id: "costs", label: "Costs", icon: "wallet", tripScoped: true },
  { id: "gallery", label: "Gallery", icon: "image", tripScoped: true },
];

export class AwtyDashboardView extends ItemView {
  private tab: TabId = "trips";
  private tripPath: string | null = null;
  /**
   * A trip tab clicked while nothing was selected.
   *
   * Held so that picking a trip takes you where you were trying to go. Sending
   * everyone to Overview would mean clicking Costs, choosing a trip, and
   * arriving somewhere else entirely.
   */
  private pendingTab: TabId | null = null;
  private unsubscribe: (() => void) | null = null;
  private hydrating = false;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: AwtyPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return AWTY_DASHBOARD_TYPE;
  }

  getDisplayText(): string {
    return "Travel dashboard";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  async onOpen(): Promise<void> {
    this.unsubscribe = this.plugin.store.onChange(() => this.render());
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Focus a specific trip, e.g. when opened from the sidebar. */
  showTrip(trip: Trip, tab?: TabId): void {
    this.tripPath = trip.file.path;
    this.tab = tab ?? this.pendingTab ?? "overview";
    this.pendingTab = null;
    this.render();
  }

  /** Select a trip by note path, without needing the Trip object. */
  selectByPath(path: string): void {
    this.tripPath = path;
    this.tab = this.pendingTab ?? "overview";
    this.pendingTab = null;
    this.render();
  }

  /** Switches tab from outside, so a control on one tab can open another. */
  selectTab(tab: string): void {
    if (!TABS.some((t) => t.id === tab)) return;
    this.tab = tab as TabId;
    this.render();
  }

  private context(trip: Trip | null = this.currentTrip()): DashboardContext {
    return {
      app: this.app,
      plugin: this.plugin,
      trip,
      refresh: () => {
        this.plugin.bookings.invalidate();
        this.render();
      },
      openFile: (file: TFile, newTab = false) => {
        void this.plugin.openInWorkspace(file, newTab);
      },
    };
  }

  /**
   * The trip being looked at, or null because none has been picked.
   *
   * It no longer guesses. Choosing one for you meant the dashboard opened
   * asserting a trip you had not asked about, and every number on the screen —
   * spend, countdown, what is unfinished — belonged to that guess. Picking a
   * trip is one click; being shown the wrong one silently is not recoverable
   * by clicking, because there is nothing to tell you it happened.
   */
  private currentTrip(): Trip | null {
    if (!this.tripPath) return null;
    return this.plugin.store.getTrips().find((t) => t.file.path === this.tripPath) ?? null;
  }

  render(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("awty-dashboard");

    const trip = this.currentTrip();
    // A trip deleted, or renamed out from under the selection, drops you back
    // to the list rather than leaving a tab that can say nothing.
    if (!trip && this.tripPath) {
      this.tripPath = null;
      this.tab = "trips";
    }
    if (!trip && TABS.find((t) => t.id === this.tab)?.tripScoped) this.tab = "trips";

    this.renderHeader(root, trip);

    const content = root.createDiv({ cls: "awty-dash-content" });
    const ctx = this.context(trip);

    switch (this.tab) {
      case "trips":
        renderTrips(content, ctx, (selected) => this.showTrip(selected));
        break;
      case "planning":
        renderPlanning(content, ctx);
        break;
      case "itinerary":
        renderItinerary(content, ctx);
        break;
      case "bookings":
        renderBookings(content, ctx);
        break;
      case "costs":
        renderCosts(content, ctx);
        break;
      case "gallery":
        renderGallery(content, ctx);
        break;
      default:
        renderOverview(content, ctx);
    }

    void this.hydrate();
  }

  /** Sub-note progress needs file reads; fill it in then paint once more. */
  private async hydrate(): Promise<void> {
    if (this.hydrating) return;
    this.hydrating = true;
    try {
      let changed = false;
      for (const trip of this.plugin.store.getTrips()) {
        for (const sub of this.plugin.store.getSubNotes(trip)) {
          if (this.plugin.progress.peek(sub.file)) continue;
          try {
            await this.plugin.progress.get(sub.file, sub.id);
            changed = true;
          } catch (err) {
            // One unreadable note used to reject out of the loop, leaving
            // every note after it unread and the view quietly stale.
            console.error(`[awty] could not read ${sub.file.path}`, err);
          }
        }
      }
      if (changed) {
        this.hydrating = false;
        this.render();
      }
    } finally {
      this.hydrating = false;
    }
  }

  private renderHeader(root: HTMLElement, trip: Trip | null): void {
    const header = root.createDiv({ cls: "awty-dash-header" });

    const top = header.createDiv({ cls: "awty-dash-top" });
    const trips = this.plugin.store.getTrips();

    if (trips.length > 0) {
      const select = top.createEl("select", { cls: "awty-dash-select dropdown" });
      // The way back out. Without an option for "none" the selector could only
      // ever swap one trip for another, so once you had drilled in there was no
      // route back to the list except the tab.
      const none = select.createEl("option", { text: "All trips…", value: "" });
      if (!trip) none.selected = true;
      for (const t of trips) {
        const option = select.createEl("option", { text: t.title, value: t.file.path });
        if (trip && t.file.path === trip.file.path) option.selected = true;
      }
      select.addEventListener("change", () => {
        this.tripPath = select.value || null;
        if (!this.tripPath) this.tab = "trips";
        this.render();
      });
    }

    // Trip-level actions — edit, delete, open the notes — live next to the
    // selector so they are reachable from every tab.
    if (trip) {
      const menuBtn = top.createEl("button", {
        cls: "awty-icon-btn awty-dash-tripmenu",
        attr: { "aria-label": "Trip actions" },
      });
      setIcon(menuBtn, "more-vertical");
      menuBtn.addEventListener("click", (evt) => showTripMenu(evt, trip, this.context()));
    }

    const actions = top.createDiv({ cls: "awty-dash-quick" });
    if (trip) {
      // One primary action. The individual wizards used to sit up here under
      // names ("Stay", "Expense") that didn't match the note names below
      // ("Accommodation", "Budget"), which read as two competing systems.
      const plan = actions.createEl("button", { cls: "awty-dash-quick-btn is-cta" });
      setIcon(plan.createSpan(), "wand-2");
      plan.createSpan({ text: "Plan trip" });
      plan.addEventListener("click", () => this.plugin.openPlanWizard(trip));

      const add = actions.createEl("button", { cls: "awty-dash-quick-btn" });
      setIcon(add.createSpan(), "plus");
      add.createSpan({ text: "Add" });
      add.addEventListener("click", (evt) => {
        const menu = new Menu();
        for (const def of BOOKING_KINDS) {
          menu.addItem((i) =>
            i
              .setTitle(def.label)
              .setIcon(def.icon)
              .onClick(() => this.plugin.openBookingWizard(trip, def.id)),
          );
        }
        menu.addSeparator();
        menu.addItem((i) =>
          i
            .setTitle("Expense")
            .setIcon("receipt")
            .onClick(() => this.plugin.openExpenseModal(trip)),
        );
        menu.showAtMouseEvent(evt);
      });

      // Exporting is a whole-trip action, so it belongs beside the other
      // whole-trip actions rather than inside the Trip notes card on one tab.
      const exportBtn = actions.createEl("button", { cls: "awty-dash-quick-btn" });
      setIcon(exportBtn.createSpan(), "file-down");
      exportBtn.createSpan({ text: "Export PDF" });
      exportBtn.setAttribute("aria-label", "Export the whole trip to a PDF on disk");
      exportBtn.addEventListener("click", () => this.plugin.exportTrip(trip));
    }

    // Always here, on every tab. Starting a trip is the one action that does
    // not need a trip already selected, and it used to live on the Trips tab
    // alone — so from Costs or Itinerary the only route to it was the sidebar
    // or the command palette. With no trip at all it is the primary action,
    // because there is nothing else worth doing.
    const newTrip = actions.createEl("button", {
      cls: `awty-dash-quick-btn${trip ? "" : " is-cta"}`,
    });
    setIcon(newTrip.createSpan(), "plus");
    newTrip.createSpan({ text: "New trip" });
    newTrip.setAttribute("aria-label", "Create a new trip");
    newTrip.addEventListener("click", () => this.plugin.openNewTripModal());

    const tabs = header.createDiv({ cls: "awty-dash-tabs" });
    let activeTab: HTMLElement | null = null;
    for (const tab of TABS) {
      // With nothing picked, the trip tabs are dimmed rather than hidden: a tab
      // bar that changes length as you click around is disorientating, and the
      // point being made is "these are about a trip", not "these do not exist".
      const locked = Boolean(tab.tripScoped) && !trip;
      const el = tabs.createDiv({
        cls: `awty-dash-tab${tab.id === this.tab ? " is-active" : ""}${locked ? " is-locked" : ""}`,
      });
      // A rule after Trips, so the split between "all trips" and "this trip" is
      // visible rather than something you work out.
      if (tab.tripScoped && !TABS[TABS.indexOf(tab) - 1]?.tripScoped) el.addClass("starts-group");
      if (tab.id === this.tab) activeTab = el;
      setIcon(el.createSpan({ cls: "awty-dash-tab-icon" }), tab.icon);
      el.createSpan({ text: tab.label });
      if (locked) el.setAttribute("title", "Pick a trip first");
      el.addEventListener("click", () => {
        // Clicking a locked tab is a request for that tab, so remember it and
        // land there once a trip is chosen rather than swallowing the click.
        if (locked) {
          this.pendingTab = tab.id;
          this.tab = "trips";
        } else {
          this.tab = tab.id;
        }
        this.render();
      });
    }

    // Six tabs do not fit a phone, so the strip scrolls — but every render
    // rebuilds it scrolled back to the left, which put the last tabs off screen
    // with nothing to suggest they were there. Only the tab strip moves;
    // `block: "nearest"` keeps the page itself where it is.
    if (isMobile() && activeTab) {
      activeTab.scrollIntoView({ inline: "center", block: "nearest" });
    }
  }
}
