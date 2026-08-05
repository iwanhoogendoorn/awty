import { ItemView, Menu, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type AwtyPlugin from "../main";
import type { Trip, TripStatus } from "../types";
import { AWTY_SIDEBAR_TYPE, kindDef } from "../types";
import type { SubNote } from "../store/tripStore";
import type { NoteProgress } from "../store/noteProgress";
import { joinPlaces, tripCities, tripCountries } from "../types";
import { daysUntil, formatDateRange, formatDuration } from "../util/dates";

const GROUPS: { status: TripStatus; label: string }[] = [
  { status: "current", label: "Happening now" },
  { status: "upcoming", label: "Upcoming" },
  { status: "past", label: "Past" },
];

const SUB_NOTE_ICONS: Record<string, string> = {
  itinerary: "calendar-days",
  packing: "luggage",
  accommodation: "bed",
  transport: "train-front",
  budget: "wallet",
  food: "utensils",
  "event-details": "ticket",
};

export class AwtySidebarView extends ItemView {
  private query = "";
  private unsubscribe: (() => void) | null = null;
  /** Trip paths whose sub-note list is open. */
  private expanded = new Set<string>();
  private hydrating = false;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: AwtyPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return AWTY_SIDEBAR_TYPE;
  }

  getDisplayText(): string {
    return "Are We There Yet?";
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
    container.addClass("awty-sidebar");

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

      const heading = container.createDiv({ cls: "awty-group" });
      heading.createSpan({ cls: "awty-group-title", text: group.label });
      heading.createSpan({ cls: "awty-group-count", text: String(items.length) });

      const list = container.createDiv({ cls: "awty-list" });
      for (const trip of items) this.renderTrip(list, trip);
    }

    // Progress needs the note contents, which are read asynchronously. Render
    // what we have, then fill the rest in on the next pass.
    void this.hydrate(trips);
  }

  /** Reads any sub-note whose progress isn't cached yet, then re-renders once. */
  private async hydrate(trips: Trip[]): Promise<void> {
    if (this.hydrating) return;
    this.hydrating = true;
    try {
      let changed = false;
      for (const trip of trips) {
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

  private renderHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: "awty-header" });

    const newBtn = header.createEl("button", { cls: "awty-new-btn" });
    setIcon(newBtn.createSpan({ cls: "awty-new-icon" }), "plus");
    newBtn.createSpan({ text: "New trip" });
    newBtn.addEventListener("click", () => this.plugin.openNewTripModal());

    const search = header.createEl("input", { cls: "awty-search" });
    search.type = "search";
    search.placeholder = "Filter trips…";
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.render();
      // Re-render blows away the input, so put the cursor back where it was.
      const next = this.containerEl.querySelector<HTMLInputElement>(".awty-search");
      next?.focus();
      next?.setSelectionRange(next.value.length, next.value.length);
    });
  }

  private renderEmpty(container: HTMLElement, title: string, detail: string): void {
    const empty = container.createDiv({ cls: "awty-empty" });
    setIcon(empty.createDiv({ cls: "awty-empty-icon" }), "plane");
    empty.createDiv({ cls: "awty-empty-title", text: title });
    empty.createDiv({ cls: "awty-empty-detail", text: detail });
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
    const wrapper = list.createDiv({ cls: `awty-trip-wrap is-${trip.status}` });
    const item = wrapper.createDiv({ cls: "awty-trip" });

    const isOpen = this.expanded.has(trip.file.path);
    const twisty = item.createDiv({
      cls: `awty-twisty${isOpen ? " is-open" : ""}`,
      attr: { "aria-label": isOpen ? "Collapse" : "Expand" },
    });
    setIcon(twisty, "chevron-right");
    twisty.addEventListener("click", (evt) => {
      evt.stopPropagation();
      if (isOpen) this.expanded.delete(trip.file.path);
      else this.expanded.add(trip.file.path);
      this.render();
    });

    const icon = item.createDiv({ cls: "awty-trip-icon" });
    setIcon(icon, def.icon);

    const body = item.createDiv({ cls: "awty-trip-body" });
    body.createDiv({ cls: "awty-trip-title", text: trip.title });

    const meta = body.createDiv({ cls: "awty-trip-meta" });
    meta.createSpan({ cls: "awty-trip-dates", text: formatDateRange(trip.startDate, trip.endDate) });

    const where = [joinPlaces(tripCities(trip)), joinPlaces(tripCountries(trip))].filter(Boolean).join(", ");
    if (where) meta.createSpan({ cls: "awty-trip-where", text: where });

    const subNotes = this.plugin.store.getSubNotes(trip);
    this.renderTripSummary(body, trip, subNotes);

    const actions = item.createDiv({ cls: "awty-trip-actions" });
    const menuBtn = actions.createEl("button", {
      cls: "awty-icon-btn",
      attr: { "aria-label": "Trip actions" },
    });
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
    item.setAttribute(
      "aria-label",
      `${trip.title} — ${formatDuration(trip.startDate, trip.endDate)}`,
    );

    if (isOpen) this.renderSubNotes(wrapper, trip, subNotes);
  }

  /** Countdown plus a one-line "how much is still blank" roll-up. */
  private renderTripSummary(body: HTMLElement, trip: Trip, subNotes: SubNote[]): void {
    const row = body.createDiv({ cls: "awty-trip-summary" });

    const badge = this.countdown(trip);
    if (badge) row.createSpan({ cls: `awty-badge is-${trip.status}`, text: badge });

    if (subNotes.length === 0) return;

    let done = 0;
    let known = 0;
    for (const sub of subNotes) {
      const progress = this.plugin.progress.peek(sub.file);
      if (!progress) continue;
      known += 1;
      if (progress.state !== "empty") done += 1;
    }
    if (known === 0) return;

    const outstanding = known - done;
    row.createSpan({
      cls: `awty-progress-pill${outstanding === 0 ? " is-complete" : ""}`,
      text: outstanding === 0 ? "All notes started" : `${outstanding} still empty`,
    });

    const track = body.createDiv({ cls: "awty-progress-track" });
    const fill = track.createDiv({ cls: "awty-progress-fill" });
    fill.style.width = `${Math.round((done / known) * 100)}%`;
  }

  /** The expanded list — every sub-note openable without touching the trip note. */
  private renderSubNotes(wrapper: HTMLElement, trip: Trip, subNotes: SubNote[]): void {
    const list = wrapper.createDiv({ cls: "awty-subnotes" });

    if (subNotes.length === 0) {
      list.createDiv({ cls: "awty-subnote-empty", text: "No notes in this trip folder yet." });
      return;
    }

    for (const sub of subNotes) {
      const progress = this.plugin.progress.peek(sub.file);
      const state = progress?.state ?? "empty";
      const row = list.createDiv({ cls: `awty-subnote-row is-${state}` });

      const dot = row.createDiv({ cls: "awty-dot", attr: { "aria-label": this.stateLabel(state) } });
      dot.setAttribute("title", this.stateLabel(state));

      const iconEl = row.createDiv({ cls: "awty-subnote-icon" });
      setIcon(iconEl, sub.id ? (SUB_NOTE_ICONS[sub.id] ?? "file-text") : "file-text");

      const text = row.createDiv({ cls: "awty-subnote-text" });
      text.createDiv({ cls: "awty-subnote-name", text: sub.label });
      text.createDiv({
        cls: "awty-subnote-detail",
        text: progress?.detail ?? "Reading…",
      });

      if (progress?.ratio !== null && progress?.ratio !== undefined) {
        const ring = row.createDiv({ cls: "awty-mini-track" });
        const fill = ring.createDiv({ cls: "awty-mini-fill" });
        fill.style.width = `${Math.round(progress.ratio * 100)}%`;
      }

      row.addEventListener("click", (evt) => {
        evt.stopPropagation();
        void this.openFile(sub.file, evt.metaKey || evt.ctrlKey);
      });
      row.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        const menu = new Menu();
        menu.addItem((i) =>
          i
            .setTitle("Open")
            .setIcon("file-text")
            .onClick(() => void this.openFile(sub.file, false)),
        );
        menu.addItem((i) =>
          i
            .setTitle("Open in new tab")
            .setIcon("plus-square")
            .onClick(() => void this.openFile(sub.file, true)),
        );
        menu.showAtMouseEvent(evt);
      });
    }
  }

  private stateLabel(state: NoteProgress["state"]): string {
    if (state === "complete") return "Done";
    if (state === "started") return "In progress";
    return "Still needs updating";
  }

  private async openFile(file: TFile, _newTab: boolean): Promise<void> {
    // Same rule as the dashboard: reveal it if open, else a new tab at the end.
    await this.plugin.openInWorkspace(file);
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

    const subNotes = this.plugin.store.getSubNotes(trip);
    if (subNotes.length > 0) {
      menu.addSeparator();
      for (const sub of subNotes) {
        menu.addItem((item) =>
          item
            .setTitle(sub.label)
            .setIcon(sub.id ? (SUB_NOTE_ICONS[sub.id] ?? "file-text") : "file-text")
            .onClick(() => void this.openFile(sub.file, false)),
        );
      }
    }

    menu.addSeparator();

    menu.addItem((item) =>
      item
        .setTitle("Add itinerary day")
        .setIcon("calendar-plus")
        .onClick(() => this.plugin.openAddDayModal(trip)),
    );
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
