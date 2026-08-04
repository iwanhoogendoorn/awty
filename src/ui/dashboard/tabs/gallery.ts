import { TFile, TFolder, setIcon } from "obsidian";
import type { DashboardContext } from "../common";
import { emptyState, sectionTitle, noTripState } from "../common";
import { fileFromLink } from "../../../bookings/bookingStore";

const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;

/** Everything attached to a trip: tickets, confirmations, receipts, photos. */
export function renderGallery(parent: HTMLElement, ctx: DashboardContext): void {
  const { trip, plugin, app } = ctx;
  if (!trip) {
    noTripState(parent, ctx, "image");
    return;
  }

  const seen = new Set<string>();
  const files: { file: TFile; source: string }[] = [];

  const collect = (links: string[], sourcePath: string, source: string) => {
    for (const link of links) {
      const file = fileFromLink(app, link, sourcePath);
      if (!file || seen.has(file.path)) continue;
      seen.add(file.path);
      files.push({ file, source });
    }
  };

  for (const booking of plugin.bookings.getBookings(trip)) {
    collect(booking.attachments, booking.file.path, booking.title);
  }
  for (const expense of plugin.bookings.getExpenses(trip)) {
    collect(expense.attachments, expense.file.path, expense.description);
  }

  // Anything dropped straight into the attachments folder counts too.
  const attachFolder = app.vault.getAbstractFileByPath(
    `${trip.folderPath}/${plugin.settings.attachmentsFolder}`,
  );
  if (attachFolder instanceof TFolder) {
    for (const child of attachFolder.children) {
      if (child instanceof TFile && child.extension !== "md" && !seen.has(child.path)) {
        seen.add(child.path);
        files.push({ file: child, source: "Trip folder" });
      }
    }
  }

  if (files.length === 0) {
    emptyState(
      parent,
      "image",
      "No attachments yet",
      "Boarding passes, hotel confirmations, tickets and receipts you attach to a booking show up here.",
    );
    return;
  }

  const images = files.filter((f) => IMAGE_RE.test(f.file.name));
  const documents = files.filter((f) => !IMAGE_RE.test(f.file.name));

  if (images.length > 0) {
    sectionTitle(parent, `Images (${images.length})`);
    const grid = parent.createDiv({ cls: "tp-gallery" });
    for (const { file, source } of images) {
      const cell = grid.createDiv({ cls: "tp-gallery-cell" });
      const img = cell.createEl("img", { cls: "tp-gallery-img" });
      img.src = app.vault.getResourcePath(file);
      img.alt = file.name;
      img.loading = "lazy";
      cell.createDiv({ cls: "tp-gallery-caption", text: source });
      cell.addEventListener("click", () => ctx.openFile(file));
    }
  }

  if (documents.length > 0) {
    sectionTitle(parent, `Documents (${documents.length})`);
    const list = parent.createDiv({ cls: "tp-doc-list" });
    for (const { file, source } of documents) {
      const row = list.createDiv({ cls: "tp-doc-row" });
      setIcon(row.createDiv({ cls: "tp-doc-icon" }), "file-text");
      const text = row.createDiv({ cls: "tp-doc-text" });
      text.createDiv({ cls: "tp-doc-name", text: file.name });
      text.createDiv({ cls: "tp-doc-source", text: source });
      row.addEventListener("click", () => ctx.openFile(file));
    }
  }
}
