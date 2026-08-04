import { ItemView, Menu, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type TravelPlannerPlugin from "../main";
import type { Trip, TripStatus } from "../types";
import { TRAVEL_VIEW_TYPE, kindDef } from "../types";
import { daysUntil, formatDateRange, formatDuration } from "../util/dates";

const GROUPS: { status: TripStatus; label: string }[] = [
  { status: "current", label: "Happening now" },
  { status: "upcoming", label: "Upcoming" },
  { status: "past", label: "Past" },
];

export class TravelSidebarView extends ItemView {
  private query = "";
  private unsubscribe: (() => void) | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: TravelPlannerPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return TRAVEL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Travel Planner";
  }

  getIcon(): string {
    return "plane";
  }

  async onOpen(): Promise<void> {
    // Re-render whenever the store notices a vault change, so edits made in the
    // notes themselves show up here without reopening the pane.
    this.unsubscribe = this.plugin.store.onChange(() => this.render());
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("tp-sidebar");

    this.renderHeader(container);

    const all = this.plugin.store.getTrips();
    const trips = this.filter(all);

    if (all.length === 0) {
      this.renderEmpty(container, "No trips yet.", "Create your first one to get started.");
      return;
    }
    if (trips.length === 0) {
      this.renderEmpty(container, "Nothing matches.", `No trip matches “${this.query}”.`);
      return;
    }

    for (const group of GROUPS) {
      if (group.status === "past" && !this.plugin.settings.showPastTrips) continue;
      const items = trips.filter((t) => t.status === group.status);
      if (items.length === 0) continue;

      const heading = container.createDiv({ cls: "tp-group" });
      heading.createSpan({ cls: "tp-group-title", text: group.label });
      heading.createSpan({ cls: "tp-group-count", text: String(items.length) });

      const list = container.createDiv({ cls: "tp-list" });
      for (const trip of items) this.renderTrip(list, trip);
    }
  }

  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: "tp-header" });

    const newBtn = header.createEl("button", { cls: "tp-new-btn" });
    setIcon(newBtn.createSpan({ cls: "tp-new-icon" }), "plus");
    newBtn.createSpan({ text: "New trip" });
    newBtn.addEventListener("click", () => this.plugin.openNewTripModal());

    const search = header.createEl("input", { cls: "tp-search" });
    search.type = "search";
    search.placeholder = "Filter trips…";
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.render();
      // Re-render blows away the input, so put the cursor back where it was.
      const next = this.containerEl.querySelector<HTMLInputElement>(".tp-search");
      next?.focus();
      next?.setSelectionRange(next.value.length, next.value.length);
    });
  }

  private renderEmpty(container: HTMLElement, title: string, detail: string): void {
    const empty = container.createDiv({ cls: "tp-empty" });
    setIcon(empty.createDiv({ cls: "tp-empty-icon" }), "plane");
    empty.createDiv({ cls: "tp-empty-title", text: title });
    empty.createDiv({ cls: "tp-empty-detail", text: detail });
  }

  private filter(trips: Trip[]): Trip[] {
    const q = this.query.trim().toLowerCase();
    if (!q) return trips;
    return trips.filter((t) =>
      [t.title, t.city, t.country, t.venue, t.kind].some((f) => f.toLowerCase().includes(q)),
    );
  }

  private renderTrip(list: HTMLElement, trip: Trip): void {
    const def = kindDef(trip.kind);
    const item = list.createDiv({ cls: `tp-trip is-${trip.status}` });

    const icon = item.createDiv({ cls: "tp-trip-icon" });
    setIcon(icon, def.icon);

    const body = item.createDiv({ cls: "tp-trip-body" });
    body.createDiv({ cls: "tp-trip-title", text: trip.title });

    const meta = body.createDiv({ cls: "tp-trip-meta" });
    meta.createSpan({ cls: "tp-trip-dates", text: formatDateRange(trip.startDate, trip.endDate) });

    const where = [trip.city, trip.country].filter(Boolean).join(", ");
    if (where) meta.createSpan({ cls: "tp-trip-where", text: where });

    const badge = this.countdown(trip);
    if (badge) body.createDiv({ cls: `tp-badge is-${trip.status}`, text: badge });

    const actions = item.createDiv({ cls: "tp-trip-actions" });
    const menuBtn = actions.createEl("button", { cls: "tp-icon-btn", attr: { "aria-label": "Trip actions" } });
    setIcon(menuBtn, "more-vertical");
    menuBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      this.showMenu(evt, trip);
    });

    item.addEventListener("click", () => void this.plugin.openTrip(trip));
    item.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      this.showMenu(evt, trip);
    });

    item.setAttribute("aria-label", `${trip.title} — ${formatDuration(trip.startDate, trip.endDate)}`);
  }

  private countdown(trip: Trip): string | null {
    if (trip.status === "past") return null;
    if (trip.status === "current") return "Now";
    const days = daysUntil(trip.startDate);
    if (days === null) return null;
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    if (days < 0) return null;
    if (days < 7) return `In ${days} days`;
    if (days < 60) return `In ${Math.round(days / 7)} weeks`;
    return `In ${Math.round(days / 30)} months`;
  }

  private showMenu(evt: MouseEvent, trip: Trip): void {
    const menu = new Menu();

    menu.addItem((item) =>
      item
        .setTitle("Open")
        .setIcon("file-text")
        .onClick(() => void this.plugin.openTrip(trip)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Open in new tab")
        .setIcon("plus-square")
        .onClick(() => void this.plugin.openTrip(trip, true)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Add itinerary day")
        .setIcon("calendar-plus")
        .onClick(() => this.plugin.openAddDayModal(trip)),
    );

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Edit trip…")
        .setIcon("pencil")
        .onClick(() => this.plugin.openEditTripModal(trip)),
    );
    menu.addItem((item) =>
      item
        .setTitle("Copy folder path")
        .setIcon("clipboard-copy")
        .onClick(async () => {
          await navigator.clipboard.writeText(trip.folderPath);
          new Notice(`Copied ${trip.folderPath}`);
        }),
    );

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Delete trip…")
        .setIcon("trash-2")
        .onClick(() => this.plugin.deleteTrip(trip)),
    );

    menu.showAtMouseEvent(evt);
  }
}
