import { TFile, TFolder, setIcon } from "obsidian";
import type { DashboardContext } from "../common";
import { emptyState, sectionTitle, noTripState } from "../common";
import { fileFromLink } from "../../../bookings/bookingStore";
import { BOOKING_KINDS } from "../../../bookings/types";
import { formatMoney } from "../../../util/money";
import { formatDateRange } from "../../../util/dates";
import { openAttachment } from "../../modals/lightbox";

const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;

/** Attachments belonging to one booking, expense, or the folder itself. */
interface Group {
  key: string;
  title: string;
  detail: string;
  icon: string;
  /** The note these belong to, so the group heading can open it. */
  source: TFile | null;
  files: TFile[];
}

/**
 * Every attachment on a trip, grouped by what it belongs to.
 *
 * A flat grid of thumbnails with a truncated caption made it impossible to tell
 * a boarding pass from a hotel confirmation, which is the only question this
 * tab exists to answer.
 */
export function renderGallery(parent: HTMLElement, ctx: DashboardContext): void {
  const { trip, plugin, app } = ctx;
  if (!trip) {
    noTripState(parent, ctx, "image");
    return;
  }

  const seen = new Set<string>();
  const groups: Group[] = [];

  const resolve = (links: string[], sourcePath: string): TFile[] => {
    const out: TFile[] = [];
    for (const link of links) {
      const file = fileFromLink(app, link, sourcePath);
      if (!file || seen.has(file.path)) continue;
      seen.add(file.path);
      out.push(file);
    }
    return out;
  };

  for (const booking of plugin.bookings.getBookings(trip)) {
    const files = resolve(booking.attachments, booking.file.path);
    if (files.length === 0) continue;
    const def = BOOKING_KINDS.find((k) => k.id === booking.kind);
    groups.push({
      key: booking.file.path,
      title: booking.title,
      detail: [def?.label, formatDateRange(booking.date, booking.endDate), booking.reference]
        .filter(Boolean)
        .join(" · "),
      icon: def?.icon ?? "ticket",
      source: booking.file,
      files,
    });
  }

  for (const expense of plugin.bookings.getExpenses(trip)) {
    const files = resolve(expense.attachments, expense.file.path);
    if (files.length === 0) continue;
    groups.push({
      key: expense.file.path,
      title: expense.description,
      detail: [expense.date, formatMoney(expense.amount), expense.category]
        .filter(Boolean)
        .join(" · "),
      icon: "receipt",
      source: expense.file,
      files,
    });
  }

  // Anything dropped straight into the folder belongs to the trip itself.
  const attachFolder = app.vault.getAbstractFileByPath(
    `${trip.folderPath}/${plugin.settings.attachmentsFolder}`,
  );
  if (attachFolder instanceof TFolder) {
    const loose = attachFolder.children.filter(
      (child): child is TFile =>
        child instanceof TFile && child.extension !== "md" && !seen.has(child.path),
    );
    if (loose.length > 0) {
      groups.push({
        key: "__folder",
        title: "Not linked to a booking",
        detail: "Dropped into the trip's attachments folder",
        icon: "folder",
        source: null,
        files: loose,
      });
    }
  }

  if (groups.length === 0) {
    emptyState(
      parent,
      "image",
      "No attachments yet",
      "Boarding passes, hotel confirmations, tickets and receipts you attach to a booking show up here, grouped by what they belong to.",
    );
    return;
  }

  // Every attachment on the trip, so the viewer can page through them all.
  const allFiles = groups.flatMap((g) => g.files);
  const total = allFiles.length;
  sectionTitle(parent, `${total} attachment${total === 1 ? "" : "s"}`);

  for (const group of groups) {
    const box = parent.createDiv({ cls: "awty-gallery-group" });

    const head = box.createDiv({ cls: "awty-gallery-head" });
    setIcon(head.createDiv({ cls: "awty-gallery-head-icon" }), group.icon);
    const headText = head.createDiv({ cls: "awty-gallery-head-text" });
    headText.createDiv({ cls: "awty-gallery-head-title", text: group.title });
    if (group.detail) headText.createDiv({ cls: "awty-gallery-head-detail", text: group.detail });
    head.createDiv({
      cls: "awty-gallery-head-count",
      text: `${group.files.length} file${group.files.length === 1 ? "" : "s"}`,
    });
    if (group.source) {
      head.addClass("is-clickable");
      head.addEventListener("click", () => ctx.openFile(group.source!));
    }

    const grid = box.createDiv({ cls: "awty-gallery" });
    for (const file of group.files) {
      const cell = grid.createDiv({ cls: "awty-gallery-cell" });

      if (IMAGE_RE.test(file.name)) {
        const img = cell.createEl("img", { cls: "awty-gallery-img" });
        img.src = app.vault.getResourcePath(file);
        img.alt = file.name;
        img.loading = "lazy";
      } else {
        const doc = cell.createDiv({ cls: "awty-gallery-doc" });
        setIcon(doc, file.extension === "pdf" ? "file-text" : "file");
        doc.createSpan({ cls: "awty-gallery-doc-ext", text: file.extension.toUpperCase() });
      }

      cell.createDiv({ cls: "awty-gallery-caption", text: file.name });
      cell.setAttribute("title", `${file.name} — ${group.title}`);
      cell.addEventListener("click", () => openAttachment(app, allFiles, file));
    }
  }
}
