import { Menu, setIcon } from "obsidian";
import type AwtyPlugin from "../../main";
import type { Trip, TripStage } from "../../types";
import { STAGES, stageDef } from "../../types";

/**
 * The stage of a trip, as something you click.
 *
 * Every badge showing a stage is also the control that changes it — on a card,
 * in the hero, in the sidebar. Otherwise the answer to "how do I say we're
 * going?" is "open a tab you were not on, and find a picker", which is a long
 * way to travel to change one word that is already on the screen in front of
 * you.
 */
export function showStageMenu(
  evt: MouseEvent,
  plugin: AwtyPlugin,
  trip: Trip,
  after?: () => void,
): void {
  const menu = new Menu();
  for (const def of STAGES) {
    menu.addItem((item) =>
      item
        .setTitle(def.label)
        .setIcon(def.icon)
        .setChecked(def.id === trip.stage)
        .onClick(() => {
          void plugin.setStage(trip, def.id).then(() => after?.());
        }),
    );
  }
  menu.showAtMouseEvent(evt);
}

/**
 * A stage badge that opens the picker when clicked.
 *
 * @param onDone Called after a change, so a view that does not repaint itself
 *   on a store event can.
 */
export function stageBadge(
  parent: HTMLElement,
  plugin: AwtyPlugin,
  trip: Trip,
  onDone?: () => void,
): HTMLElement {
  const def = stageDef(trip.stage);
  const el = parent.createDiv({ cls: `awty-stage-badge is-${def.id} is-clickable` });
  setIcon(el.createSpan({ cls: "awty-stage-badge-icon" }), def.icon);
  el.createSpan({ text: def.badge });
  el.setAttribute("title", `${def.description}\nClick to change.`);
  el.setAttribute("aria-label", `Stage: ${def.label}. Click to change.`);
  el.addEventListener("click", (evt) => {
    // On a card, the badge sits inside a click target that opens the trip.
    evt.stopPropagation();
    showStageMenu(evt, plugin, trip, onDone);
  });
  return el;
}

/**
 * The banner that offers a stage change the vault has already implied.
 *
 * Written as a question with the evidence attached, because it is a guess: the
 * plugin can see a booked flight, not whether you have decided.
 */
export function stageNudge(
  parent: HTMLElement,
  plugin: AwtyPlugin,
  trip: Trip,
  suggestion: { to: TripStage; reason: string; action: string },
  onDone?: () => void,
): void {
  const box = parent.createDiv({ cls: "awty-stage-nudge" });
  setIcon(box.createDiv({ cls: "awty-stage-nudge-icon" }), "sparkles");

  const body = box.createDiv({ cls: "awty-stage-nudge-body" });
  body.createDiv({ cls: "awty-stage-nudge-text", text: suggestion.reason });

  const row = body.createDiv({ cls: "awty-stage-nudge-actions" });
  const yes = row.createEl("button", { cls: "awty-dash-action is-cta" });
  setIcon(yes.createSpan(), stageDef(suggestion.to).icon);
  yes.createSpan({ text: suggestion.action });
  yes.addEventListener("click", () => {
    void plugin.setStage(trip, suggestion.to).then(() => onDone?.());
  });

  // No "dismiss": the banner goes when the thing it is about is dealt with,
  // and a dismissal stored somewhere is a second bit of state to get wrong.
  row.createSpan({
    cls: "awty-stage-nudge-note",
    text: "Or leave it — nothing changes until you say so.",
  });
}
