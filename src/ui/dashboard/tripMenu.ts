import { Menu, Notice } from "obsidian";
import type { DashboardContext } from "./common";
import type { Trip } from "../../types";
import { BOOKING_KINDS } from "../../bookings/types";

/**
 * Every action you can take on a trip, in one place.
 *
 * Shared by the dashboard header, the trip cards and their right-click menus so
 * the same actions are reachable wherever you happen to be looking at a trip —
 * delete in particular used to exist only on the sidebar, which stopped being
 * the thing the ribbon opened.
 */
export function showTripMenu(evt: MouseEvent, trip: Trip, ctx: DashboardContext): void {
  const { plugin } = ctx;
  const menu = new Menu();

  menu.addItem((item) =>
    item
      .setTitle("Open trip note")
      .setIcon("file-text")
      .onClick(() => ctx.openFile(trip.file)),
  );

  const subNotes = plugin.store.getSubNotes(trip);
  if (subNotes.length > 0) {
    menu.addSeparator();
    for (const sub of subNotes) {
      menu.addItem((item) =>
        item
          .setTitle(sub.label)
          .setIcon("file-text")
          .onClick(() => ctx.openFile(sub.file)),
      );
    }
  }

  menu.addSeparator();
  for (const def of BOOKING_KINDS) {
    menu.addItem((item) =>
      item
        .setTitle(`Add ${def.label.toLowerCase()}`)
        .setIcon(def.icon)
        .onClick(() => plugin.openBookingWizard(trip, def.id)),
    );
  }
  menu.addItem((item) =>
    item
      .setTitle("Log an expense")
      .setIcon("receipt")
      .onClick(() => plugin.openExpenseModal(trip)),
  );
  menu.addItem((item) =>
    item
      .setTitle("Add itinerary day")
      .setIcon("calendar-plus")
      .onClick(() => plugin.openAddDayModal(trip)),
  );

  menu.addSeparator();
  menu.addItem((item) =>
    item
      .setTitle("Edit trip…")
      .setIcon("pencil")
      .onClick(() => plugin.openEditTripModal(trip)),
  );
  menu.addItem((item) =>
    item
      .setTitle("Set budget…")
      .setIcon("sliders-horizontal")
      .onClick(() => plugin.openBudgetModal(trip)),
  );
  if (plugin.travel.isConfigured()) {
    menu.addItem((item) =>
      item
        .setTitle("Calculate travel times")
        .setIcon("route")
        .onClick(() => void plugin.computeTravelTimes(trip, ctx.refresh)),
    );
  }
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
      .onClick(() => plugin.deleteTrip(trip)),
  );

  menu.showAtMouseEvent(evt);
}
