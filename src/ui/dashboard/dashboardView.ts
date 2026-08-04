import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type TravelPlannerPlugin from "../../main";
import type { Trip } from "../../types";
import { TRAVEL_DASHBOARD_TYPE } from "../../types";
import type { DashboardContext } from "./common";
import { renderOverview } from "./tabs/overview";
import { renderTrips } from "./tabs/trips";
import { renderItinerary } from "./tabs/itinerary";
import { renderBookings } from "./tabs/bookings";
import { renderCosts } from "./tabs/costs";
import { renderGallery } from "./tabs/gallery";
import { showTripMenu } from "./tripMenu";

type TabId = "overview" | "trips" | "itinerary" | "bookings" | "costs" | "gallery";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "layout-dashboard" },
  { id: "trips", label: "Trips", icon: "plane" },
  { id: "itinerary", label: "Itinerary", icon: "calendar-days" },
  { id: "bookings", label: "Bookings", icon: "ticket" },
  { id: "costs", label: "Costs", icon: "wallet" },
  { id: "gallery", label: "Gallery", icon: "image" },
];

export class TravelDashboardView extends ItemView {
  private tab: TabId = "overview";
  private tripPath: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private hydrating = false;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: TravelPlannerPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return TRAVEL_DASHBOARD_TYPE;
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
        void this.app.workspace.getLeaf(newTab).openFile(file);
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
    root.addClass("tp-dashboard");

    const trip = this.currentTrip();
    if (trip) this.tripPath = trip.file.path;

    this.renderHeader(root, trip);

    const content = root.createDiv({ cls: "tp-dash-content" });
    const ctx = this.context(trip);

    switch (this.tab) {
      case "trips":
        renderTrips(content, ctx, (selected) => this.showTrip(selected));
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
          await this.plugin.progress.get(sub.file, sub.id);
          changed = true;
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
    const header = root.createDiv({ cls: "tp-dash-header" });

    const top = header.createDiv({ cls: "tp-dash-top" });
    const trips = this.plugin.store.getTrips();

    if (trips.length > 0) {
      const select = top.createEl("select", { cls: "tp-dash-select dropdown" });
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
        cls: "tp-icon-btn tp-dash-tripmenu",
        attr: { "aria-label": "Trip actions" },
      });
      setIcon(menuBtn, "more-vertical");
      menuBtn.addEventListener("click", (evt) => showTripMenu(evt, trip, this.context()));
    }

    const actions = top.createDiv({ cls: "tp-dash-quick" });
    if (trip) {
      const quick: { label: string; icon: string; onClick: () => void }[] = [
        { label: "Flight", icon: "plane", onClick: () => this.plugin.openBookingWizard(trip, "flight") },
        { label: "Stay", icon: "bed", onClick: () => this.plugin.openBookingWizard(trip, "stay") },
        { label: "Activity", icon: "ticket", onClick: () => this.plugin.openBookingWizard(trip, "activity") },
        { label: "Expense", icon: "receipt", onClick: () => this.plugin.openExpenseModal(trip) },
      ];
      for (const item of quick) {
        const btn = actions.createEl("button", {
          cls: "tp-dash-quick-btn",
          attr: { "aria-label": `Add ${item.label.toLowerCase()}` },
        });
        setIcon(btn.createSpan(), item.icon);
        btn.createSpan({ text: item.label });
        btn.addEventListener("click", item.onClick);
      }
    }

    const tabs = header.createDiv({ cls: "tp-dash-tabs" });
    for (const tab of TABS) {
      const el = tabs.createDiv({
        cls: `tp-dash-tab${tab.id === this.tab ? " is-active" : ""}`,
      });
      setIcon(el.createSpan({ cls: "tp-dash-tab-icon" }), tab.icon);
      el.createSpan({ text: tab.label });
      el.addEventListener("click", () => {
        this.tab = tab.id;
        this.render();
      });
    }
  }
}
