import { Menu, setIcon } from "obsidian";
import type { DashboardContext } from "../common";
import { editItem, emptyState, renderToolbar, sectionTitle, noTripState } from "../common";
import type { Booking, BookingKind } from "../../../bookings/types";
import { BOOKING_KINDS, BOOKING_STATUSES } from "../../../bookings/types";
import { formatMoney } from "../../../util/money";
import { formatDateRange } from "../../../util/dates";

export function renderBookings(parent: HTMLElement, ctx: DashboardContext): void {
  const { trip, plugin } = ctx;
  if (!trip) {
    noTripState(parent, ctx, "ticket");
    return;
  }

  const bookings = plugin.bookings.getBookings(trip);

  const addActions = BOOKING_KINDS.map((def) => ({
    label: `Add ${def.label.toLowerCase()}`,
    icon: def.icon,
    onClick: () => plugin.openBookingWizard(trip, def.id),
  }));

  // Empty state carries the same buttons, so only one of the two ever renders.
  if (bookings.length === 0) {
    emptyState(
      parent,
      "ticket",
      "Nothing booked yet",
      "Add a flight, a place to stay, or something to do — costs you enter here feed the Costs tab automatically.",
      addActions,
    );
    return;
  }

  renderToolbar(parent, addActions);

  const byKind = new Map<BookingKind, Booking[]>();
  for (const booking of bookings) {
    const list = byKind.get(booking.kind) ?? [];
    list.push(booking);
    byKind.set(booking.kind, list);
  }

  for (const def of BOOKING_KINDS) {
    const list = byKind.get(def.id);
    if (!list || list.length === 0) continue;

    sectionTitle(parent, def.label, {
      label: "Add",
      icon: "plus",
      onClick: () => plugin.openBookingWizard(trip, def.id),
    });

    const wrap = parent.createDiv({ cls: "awty-booking-list" });
    for (const booking of list) renderRow(wrap, booking, ctx);
  }
}

function renderRow(parent: HTMLElement, booking: Booking, ctx: DashboardContext): void {
  const def = BOOKING_KINDS.find((k) => k.id === booking.kind);
  const status = BOOKING_STATUSES.find((s) => s.id === booking.status);

  const row = parent.createDiv({ cls: `awty-booking is-${booking.status}` });
  setIcon(row.createDiv({ cls: "awty-booking-icon" }), def?.icon ?? "ticket");

  const body = row.createDiv({ cls: "awty-booking-body" });
  body.createDiv({ cls: "awty-booking-title", text: booking.title });

  const meta = body.createDiv({ cls: "awty-booking-meta" });
  meta.createSpan({ text: formatDateRange(booking.date, booking.endDate) });
  const times = [booking.time, booking.endTime].filter(Boolean).join(" → ");
  if (times) meta.createSpan({ text: times });
  if (booking.reference) meta.createSpan({ cls: "awty-mono", text: booking.reference });
  if (booking.seat) meta.createSpan({ text: `Seat ${booking.seat}` });
  if (booking.attachments.length) {
    const attach = meta.createSpan({ cls: "awty-booking-attach" });
    setIcon(attach.createSpan(), "paperclip");
    attach.createSpan({ text: String(booking.attachments.length) });
  }

  const right = row.createDiv({ cls: "awty-booking-right" });
  if (booking.cost) {
    right.createDiv({
      cls: `awty-booking-cost${booking.status === "cancelled" ? " is-struck" : ""}`,
      text: formatMoney(booking.cost),
    });
  }
  const pill = right.createDiv({ cls: `awty-status-pill is-${booking.status}` });
  pill.setText(status?.label ?? booking.status);

  // Clicking a booking opens the form that made it. Opening the raw note was
  // the only route to changing anything, which meant editing frontmatter.
  row.addEventListener("click", () => {
    if (!editItem(ctx, booking.file)) ctx.openFile(booking.file);
  });
  row.addEventListener("contextmenu", (evt) => {
    evt.preventDefault();
    const menu = new Menu();
    menu.addItem((i) =>
      i
        .setTitle("Edit…")
        .setIcon("pencil")
        .onClick(() => ctx.plugin.openBookingWizard(ctx.trip!, booking.kind, booking)),
    );
    menu.addItem((i) =>
      i.setTitle("Open note").setIcon("file-text").onClick(() => ctx.openFile(booking.file)),
    );
    menu.addSeparator();
    menu.addItem((i) =>
      i
        .setTitle("Delete booking")
        .setIcon("trash-2")
        .onClick(async () => {
          await ctx.app.fileManager.trashFile(booking.file);
          ctx.refresh();
        }),
    );
    menu.showAtMouseEvent(evt);
  });
}
