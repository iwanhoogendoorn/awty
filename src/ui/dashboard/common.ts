import { App, Menu, TFile, setIcon } from "obsidian";
import type AwtyPlugin from "../../main";
import type { Trip } from "../../types";
import type { Totals } from "../../util/money";
import { formatTotals } from "../../util/money";
import { isMobile } from "../../util/platform";

export interface DashboardContext {
  app: App;
  plugin: AwtyPlugin;
  /** Null on the Trips tab, which spans every trip. */
  trip: Trip | null;
  refresh: () => void;
  openFile: (file: TFile, newTab?: boolean) => void;
}

export function sectionTitle(parent: HTMLElement, text: string, action?: { label: string; icon: string; onClick: () => void }): HTMLElement {
  const row = parent.createDiv({ cls: "awty-dash-section-head" });
  row.createDiv({ cls: "awty-dash-section-title", text });
  if (action) {
    const btn = row.createEl("button", { cls: "awty-dash-action" });
    setIcon(btn.createSpan(), action.icon);
    btn.createSpan({ text: action.label });
    btn.addEventListener("click", action.onClick);
  }
  return row;
}

export interface StatSpec {
  label: string;
  value: string;
  detail?: string;
  icon?: string;
  tone?: "default" | "good" | "warn" | "bad";
}

export function statTiles(parent: HTMLElement, stats: StatSpec[]): void {
  const grid = parent.createDiv({ cls: "awty-stat-grid" });
  for (const stat of stats) {
    const tile = grid.createDiv({ cls: `awty-stat is-${stat.tone ?? "default"}` });
    if (stat.icon) setIcon(tile.createDiv({ cls: "awty-stat-icon" }), stat.icon);
    tile.createDiv({ cls: "awty-stat-value", text: stat.value });
    tile.createDiv({ cls: "awty-stat-label", text: stat.label });
    if (stat.detail) tile.createDiv({ cls: "awty-stat-detail", text: stat.detail });
  }
}

/** Horizontal bar; ratio above 1 overflows into a "over budget" tone. */
export function bar(parent: HTMLElement, ratio: number, tone?: "good" | "warn" | "bad"): void {
  const track = parent.createDiv({ cls: "awty-bar-track" });
  const clamped = Math.max(0, Math.min(1, ratio));
  const fill = track.createDiv({ cls: `awty-bar-fill is-${tone ?? "good"}` });
  fill.style.width = `${Math.round(clamped * 100)}%`;
}

export interface EmptyAction {
  label: string;
  icon?: string;
  onClick: () => void;
}

/**
 * The empty state owns the call to action.
 *
 * Callers must not also render their toolbar when this is on screen — two
 * buttons firing the same thing is just noise. `renderToolbar` below is the
 * counterpart, used only once there is content to act on.
 */
export function emptyState(
  parent: HTMLElement,
  icon: string,
  title: string,
  detail: string,
  actions: EmptyAction[] = [],
): void {
  const box = parent.createDiv({ cls: "awty-dash-empty" });
  setIcon(box.createDiv({ cls: "awty-dash-empty-icon" }), icon);
  box.createDiv({ cls: "awty-dash-empty-title", text: title });
  box.createDiv({ cls: "awty-dash-empty-detail", text: detail });

  if (actions.length === 0) return;
  const row = box.createDiv({ cls: "awty-dash-empty-actions" });
  for (const [index, action] of actions.entries()) {
    // First action is the obvious next step, so it gets the accent.
    const btn = row.createEl("button", {
      cls: index === 0 ? "awty-dash-empty-btn is-cta" : "awty-dash-empty-btn",
    });
    if (action.icon) setIcon(btn.createSpan(), action.icon);
    btn.createSpan({ text: action.label });
    btn.addEventListener("click", action.onClick);
  }
}

/**
 * Stand-in for a tab that needs a trip and hasn't got one.
 *
 * There are two different situations here and they need different words: with
 * no trips in the vault at all, telling someone to "pick a trip from the
 * dropdown above" points at a dropdown that isn't rendered.
 */
export function noTripState(parent: HTMLElement, ctx: DashboardContext, icon: string): void {
  const any = ctx.plugin.store.getTrips().length > 0;
  if (any) {
    emptyState(parent, icon, "No trip selected", "Pick a trip from the dropdown above.");
    return;
  }
  emptyState(parent, icon, "No trips yet", "Create your first trip to get started.", [
    { label: "New trip", icon: "plus", onClick: () => ctx.plugin.openNewTripModal() },
  ]);
}

/** Toolbar of add-buttons, for when the tab already has content. */
export function renderToolbar(parent: HTMLElement, actions: EmptyAction[]): void {
  const toolbar = parent.createDiv({ cls: "awty-dash-toolbar" });
  for (const action of actions) {
    const btn = toolbar.createEl("button", { cls: "awty-dash-add" });
    if (action.icon) setIcon(btn.createSpan(), action.icon);
    btn.createSpan({ text: action.label });
    btn.addEventListener("click", action.onClick);
  }
}

export function money(totals: Totals): string {
  return formatTotals(totals);
}

/**
 * Tick, half, or cross — whether a note's wizard has been through.
 *
 * Only "done" gets a symbol. A solid disc with a minus in it reads as a no-entry
 * sign — an instruction, not a status — and an X on everything unstarted makes a
 * fresh trip look like a list of failures. Unfinished states are drawn as a
 * hollow ring instead, filled in as they progress.
 */
export function stateMark(state: "empty" | "started" | "complete"): {
  icon: string;
  label: string;
} {
  if (state === "complete") return { icon: "check", label: "Done" };
  if (state === "started") return { icon: "", label: "In progress" };
  return { icon: "", label: "Not started" };
}

/**
 * Opens the right editor for whatever note was clicked.
 *
 * Every list in the dashboard shows a mix of bookings and expenses, and each one
 * used to open the raw note — leaving frontmatter as the only way to change
 * anything. Returns false when the file is neither, so callers can fall back.
 */
export function editItem(ctx: DashboardContext, file: TFile): boolean {
  const { trip, plugin } = ctx;
  if (!trip) return false;

  const booking = plugin.bookings.getBookings(trip).find((b) => b.file.path === file.path);
  if (booking) {
    void plugin.openBookingWizard(trip, booking.kind, booking);
    return true;
  }

  const expense = plugin.bookings.getExpenses(trip).find((e) => e.file.path === file.path);
  if (expense) {
    plugin.openExpenseModal(trip, expense);
    return true;
  }
  return false;
}

/**
 * The right-click menu shared by every list of things on a trip.
 *
 * Removing anything used to live only in the Bookings tab, which is nowhere
 * near where most of them are looked at.
 */
export function itemMenu(evt: MouseEvent, ctx: DashboardContext, file: TFile, label: string): void {
  const { trip, plugin } = ctx;
  const menu = new Menu();
  menu.addItem((i) =>
    i
      .setTitle("Edit…")
      .setIcon("pencil")
      .onClick(() => {
        if (!editItem(ctx, file)) ctx.openFile(file);
      }),
  );
  menu.addItem((i) => i.setTitle("Open note").setIcon("file-text").onClick(() => ctx.openFile(file)));
  if (trip) {
    menu.addSeparator();
    menu.addItem((i) =>
      i
        .setTitle("Delete…")
        .setIcon("trash-2")
        .onClick(() => plugin.deleteItem(trip, file, label)),
    );
  }
  menu.showAtMouseEvent(evt);
}

/**
 * A tappable way into a menu that otherwise only opens on right-click.
 *
 * A touch screen has no right-click, so every action living only behind a
 * `contextmenu` listener is unreachable on a phone — Delete… among them, which
 * had no other route anywhere in the plugin.
 *
 * The guard is here, in one place, rather than in CSS: on the desktop this
 * returns before creating anything, so the desktop keeps exactly the DOM, the
 * listeners and the class lists it had. Hiding an always-created button with
 * CSS would not have that property.
 *
 * `open` is handed the button's own click event. `Menu.showAtMouseEvent` wants a
 * MouseEvent and a click is one, so the same builders the right-click uses take
 * it unchanged — there is one definition of each menu, reached two ways.
 */
export function touchMenuButton(
  parent: HTMLElement,
  label: string,
  open: (evt: MouseEvent) => void,
  cls = "",
): void {
  if (!isMobile()) return;
  const btn = parent.createEl("button", {
    cls: `awty-touch-menu${cls ? ` ${cls}` : ""}`,
    attr: { "aria-label": label },
  });
  setIcon(btn, "more-vertical");
  btn.addEventListener("click", (evt) => {
    // The row around this button opens the item when tapped. Without this the
    // one tap would open the item and the menu both.
    evt.stopPropagation();
    open(evt);
  });
}

/** Readiness: how much of a trip's planning is actually filled in. */
export function readiness(plugin: AwtyPlugin, trip: Trip): { done: number; total: number; ratio: number } {
  const subNotes = plugin.store.getSubNotes(trip);
  let done = 0;
  let total = 0;
  for (const sub of subNotes) {
    // Watching prices is how you decide whether to go, so it stops being work
    // the moment you have decided. Left in, a Price Watch note kept from the
    // planning stage would hold a booked trip permanently short of finished.
    if (sub.id === "prices" && trip.stage !== "planning") continue;
    const progress = plugin.progress.peek(sub.file);
    if (!progress) continue;
    total += 1;
    if (progress.state !== "empty") done += 1;
  }
  // Having at least one confirmed booking counts for as much as a filled note.
  const bookings = plugin.bookings.getBookings(trip);
  if (bookings.length > 0) {
    total += 1;
    if (bookings.some((b) => b.status === "booked")) done += 1;
  }
  return { done, total, ratio: total === 0 ? 0 : done / total };
}
