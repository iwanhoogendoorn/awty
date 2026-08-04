import { App, TFile, setIcon } from "obsidian";
import type TravelPlannerPlugin from "../../main";
import type { Trip } from "../../types";
import type { Totals } from "../../util/money";
import { formatTotals } from "../../util/money";

export interface DashboardContext {
  app: App;
  plugin: TravelPlannerPlugin;
  /** Null on the Trips tab, which spans every trip. */
  trip: Trip | null;
  refresh: () => void;
  openFile: (file: TFile, newTab?: boolean) => void;
}

export function sectionTitle(parent: HTMLElement, text: string, action?: { label: string; icon: string; onClick: () => void }): HTMLElement {
  const row = parent.createDiv({ cls: "tp-dash-section-head" });
  row.createDiv({ cls: "tp-dash-section-title", text });
  if (action) {
    const btn = row.createEl("button", { cls: "tp-dash-action" });
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
  const grid = parent.createDiv({ cls: "tp-stat-grid" });
  for (const stat of stats) {
    const tile = grid.createDiv({ cls: `tp-stat is-${stat.tone ?? "default"}` });
    if (stat.icon) setIcon(tile.createDiv({ cls: "tp-stat-icon" }), stat.icon);
    tile.createDiv({ cls: "tp-stat-value", text: stat.value });
    tile.createDiv({ cls: "tp-stat-label", text: stat.label });
    if (stat.detail) tile.createDiv({ cls: "tp-stat-detail", text: stat.detail });
  }
}

/** Horizontal bar; ratio above 1 overflows into a "over budget" tone. */
export function bar(parent: HTMLElement, ratio: number, tone?: "good" | "warn" | "bad"): void {
  const track = parent.createDiv({ cls: "tp-bar-track" });
  const clamped = Math.max(0, Math.min(1, ratio));
  const fill = track.createDiv({ cls: `tp-bar-fill is-${tone ?? "good"}` });
  fill.style.width = `${Math.round(clamped * 100)}%`;
}

export function emptyState(parent: HTMLElement, icon: string, title: string, detail: string, action?: { label: string; onClick: () => void }): void {
  const box = parent.createDiv({ cls: "tp-dash-empty" });
  setIcon(box.createDiv({ cls: "tp-dash-empty-icon" }), icon);
  box.createDiv({ cls: "tp-dash-empty-title", text: title });
  box.createDiv({ cls: "tp-dash-empty-detail", text: detail });
  if (action) {
    const btn = box.createEl("button", { cls: "tp-dash-empty-btn", text: action.label });
    btn.addEventListener("click", action.onClick);
  }
}

export function money(totals: Totals): string {
  return formatTotals(totals);
}

/** Readiness: how much of a trip's planning is actually filled in. */
export function readiness(plugin: TravelPlannerPlugin, trip: Trip): { done: number; total: number; ratio: number } {
  const subNotes = plugin.store.getSubNotes(trip);
  let done = 0;
  let total = 0;
  for (const sub of subNotes) {
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
