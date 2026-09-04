import { Menu } from "obsidian";
import { TRAVEL_CHOICES, type TravelChoice } from "../bookings/transportMode";

/**
 * Asks how you are travelling before opening a form.
 *
 * The "Getting there" step used to go straight to the flight wizard, which is
 * the right guess for exactly one kind of trip. A menu rather than a step in
 * the form itself, because the answer changes which form you get — a flight
 * has legs, a ferry has a crossing — and being asked for a flight number
 * before you can say "train" is the whole complaint.
 *
 * Rendering is all it does; what to do with the answer is the caller's.
 */
export function chooseTravel(evt: MouseEvent, onPick: (choice: TravelChoice) => void): void {
  const menu = new Menu();
  for (const choice of TRAVEL_CHOICES) {
    // "Other" ends the list of real answers, so it gets a line above it.
    if (choice.mode === "other") menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(choice.label)
        .setIcon(choice.icon)
        .onClick(() => onPick(choice)),
    );
  }
  menu.showAtMouseEvent(evt);
}
