import { setIcon } from "obsidian";
import type { Trip, TripStage } from "../../types";
import { STAGES } from "../../types";

/**
 * The row of stage chips — always all of them, always shown.
 *
 * This used to draw only the stages that had trips in them, and to skip the
 * row entirely when everything sat in one stage — reasoning that a filter with
 * one option can only be a no-op. That reasoning was about the filter and not
 * about the person looking for it: on a vault with a single trip the row
 * vanished, and a feature that hides itself is indistinguishable from one that
 * was never built.
 *
 * So the whole vocabulary shows, counts and all. It doubles as the answer to
 * "what stages are there?", and an empty stage is dimmed and unclickable
 * rather than absent — there is a difference between "no cancelled trips" and
 * "cancelling is not a thing here", and only one of them is true.
 *
 * Shared by the Trips grid and the flight map on purpose: two controls that
 * look identical and filter differently is worse than no filter at all, and
 * the dashboard holds one filter value for both, so switching tabs keeps the
 * same set of trips in view.
 */
export function renderStageFilter(
  parent: HTMLElement,
  trips: Trip[],
  active: TripStage | null,
  onChange: (stage: TripStage | null) => void,
): void {
  const counts = new Map<TripStage, number>();
  for (const trip of trips) counts.set(trip.stage, (counts.get(trip.stage) ?? 0) + 1);

  const row = parent.createDiv({ cls: "awty-stage-filter" });

  const chip = (
    label: string,
    count: number,
    stage: TripStage | null,
    icon: string,
    hint: string,
  ): void => {
    const empty = count === 0;
    const el = row.createEl("button", {
      cls: [
        "awty-stage-chip",
        stage ? `is-${stage}` : "",
        active === stage ? "is-active" : "",
        empty ? "is-empty" : "",
      ]
        .filter(Boolean)
        .join(" "),
    });
    el.type = "button";
    el.disabled = empty;
    setIcon(el.createSpan({ cls: "awty-stage-chip-icon" }), icon);
    el.createSpan({ text: label });
    el.createSpan({ cls: "awty-stage-chip-count", text: String(count) });
    el.setAttribute("aria-pressed", String(active === stage));
    // Not "no trips are ${label}": the stage names are not all adjectives, and
    // that template produces "no trips are went".
    el.setAttribute("title", empty ? `Nothing at this stage yet — ${hint}` : hint);
    if (empty) return;
    // Clicking the stage you are already on clears the filter, so the chips
    // are a toggle rather than a trap you need the All chip to escape.
    el.addEventListener("click", () => onChange(active === stage ? null : stage));
  };

  chip("All", trips.length, null, "layers", "Show every trip");
  for (const def of STAGES) {
    chip(def.label, counts.get(def.id) ?? 0, def.id, def.icon, def.description);
  }
}
