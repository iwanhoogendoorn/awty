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

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "layout-dashboard" },
  { id: "planning", label: "Planning", icon: "compass" },
  { id: "trips", label: "Trips", icon: "plane" },
  { id: "itinerary", label: "Itinerary", icon: "calendar-days" },
  { id: "bookings", label: "Bookings", icon: "ticket" },
  { id: "costs", label: "Costs", icon: "wallet" },
  { id: "gallery", label: "Gallery", icon: "image" },
];

export class AwtyDashboardView extends ItemView {
  private tab: TabId = "overview";
  private tripPath: string | null = null;
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
  showTrip(trip: Trip, tab: TabId = "overview"): void {
    this.tripPath = trip.file.path;
    this.tab = tab;
    this.render();
  }

  /** Select a trip by note path, without needing the Trip object. */
  selectByPath(path: string): void {
    this.tripPath = path;
    this.tab = "overview";
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

  private currentTrip(): Trip | null {
    const trips = this.plugin.store.getTrips();
    if (trips.length === 0) return null;
    const chosen = trips.find((t) => t.file.path === this.tripPath);
    if (chosen) return chosen;
    // Default to whatever you're on, then whatever is next.
    return trips.find((t) => t.status === "current") ?? trips[0];
  }

  render(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("awty-dashboard");

    const trip = this.currentTrip();
    if (trip) this.tripPath = trip.file.path;

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
      for (const t of trips) {
        const option = select.createEl("option", { text: t.title, value: t.file.path });
        if (trip && t.file.path === trip.file.path) option.selected = true;
      }
      select.addEventListener("change", () => {
        this.tripPath = select.value;
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

    const tabs = header.createDiv({ cls: "awty-dash-tabs" });
    let activeTab: HTMLElement | null = null;
    for (const tab of TABS) {
      const el = tabs.createDiv({
        cls: `awty-dash-tab${tab.id === this.tab ? " is-active" : ""}`,
      });
      if (tab.id === this.tab) activeTab = el;
      setIcon(el.createSpan({ cls: "awty-dash-tab-icon" }), tab.icon);
      el.createSpan({ text: tab.label });
      el.addEventListener("click", () => {
        this.tab = tab.id;
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
