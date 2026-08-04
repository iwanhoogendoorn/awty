import { App, Notice, TFile, TFolder, arrayBufferToBase64 } from "obsidian";
import type TravelPlannerPlugin from "../main";
import type { Trip } from "../types";
import { SUB_NOTE_LABELS, kindDef } from "../types";
import { BOOKING_KINDS } from "../bookings/types";
import { fileFromLink, totalsByCategory } from "../bookings/bookingStore";
import { checkVisa } from "../travel/visa";
import { ADVICE_MEANING } from "../travel/adviceData";
import { formatMoney, formatTotals, sumMoney } from "../util/money";
import {
  datesInRange,
  formatDateRange,
  formatDuration,
  monthName,
  parseISO,
} from "../util/dates";
import { renderTripDocument, type DocBooking, type DocDay, type TripDocument } from "./tripDocument";
import { joinPath, sanitizeName } from "../util/paths";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i;
/** Images beyond this bloat the file for no benefit at print resolution. */
const MAX_IMAGE_BYTES = 2_000_000;

function mimeFor(extension: string): string {
  const ext = extension.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return `image/${ext}`;
}

/** Gathers everything the plugin knows about a trip into one printable shape. */
export async function buildTripDocument(
  plugin: TravelPlannerPlugin,
  trip: Trip,
): Promise<TripDocument> {
  const app = plugin.app;
  const def = kindDef(trip.kind);
  const currency = plugin.bookings.getCurrency(trip);
  const bookings = plugin.bookings.getBookings(trip);
  const lines = plugin.bookings.getCostLines(trip);
  const counted = lines.filter((l) => l.counted);

  // ------------------------------------------------------------ facts
  const facts: [string, string][] = [["Kind", def.label]];
  if (trip.originCity || trip.originAirport) {
    facts.push(["From", [trip.originCity, trip.originAirport].filter(Boolean).join(" · ")]);
  }
  if (!def.singleDay) facts.push(["Duration", formatDuration(trip.startDate, trip.endDate)]);
  if (trip.travellers.length > 0) facts.push(["Travelling", trip.travellers.join(", ")]);
  if (trip.venue) facts.push(["Venue", trip.venue]);

  // ------------------------------------------------- documents & advice
  const documents: TripDocument["documents"] = [];
  const passports = trip.passports.length > 0 ? trip.passports : plugin.settings.passportCountries;
  for (const passport of passports.filter(Boolean)) {
    const check = checkVisa(passport, trip.country);
    if (check.outcome === "same-country") continue;
    documents.push({
      label: `${passport} passport → ${trip.country}: ${check.label}`,
      detail: check.detail,
      tone:
        check.outcome === "no-admission"
          ? "bad"
          : check.actionNeeded
            ? "warn"
            : check.outcome === "unknown"
              ? "unknown"
              : "good",
    });
  }
  const advice = plugin.peekAdvice(trip.country);
  if (advice) {
    const meaning = ADVICE_MEANING[advice.colour];
    documents.push({
      label: `Travel advice: ${meaning.label}`,
      detail: `${meaning.detail} — ${advice.url}`,
      tone: advice.colour === "groen" ? "good" : advice.colour === "rood" ? "bad" : "warn",
    });
  }

  // --------------------------------------------------------- bookings
  const docBookings: DocBooking[] = bookings.map((booking) => {
    const fm = app.metadataCache.getFileCache(booking.file)?.frontmatter;
    const readLegs = (value: unknown): DocBooking["legs"] =>
      Array.isArray(value)
        ? value.map((raw) => {
            const leg = raw as Record<string, string>;
            return {
              operator: leg?.airline ?? "",
              number: leg?.flight ?? "",
              from: leg?.from ?? "",
              to: leg?.to ?? "",
              date: leg?.date ?? "",
              depTime: leg?.departs ?? "",
              arrDate: leg?.arrives_on ?? leg?.date ?? "",
              arrTime: leg?.arrives ?? "",
            };
          })
        : [];

    return {
      kind: booking.kind,
      kindLabel: BOOKING_KINDS.find((k) => k.id === booking.kind)?.label ?? booking.kind,
      title: booking.title,
      status: booking.status,
      date: booking.date,
      endDate: booking.endDate,
      time: booking.time,
      endTime: booking.endTime,
      from: booking.from,
      to: booking.to,
      reference: booking.reference,
      seat: booking.seat,
      cost: booking.cost ? formatMoney(booking.cost) : "",
      notes: booking.notes,
      legs: readLegs(fm?.legs),
      returnLegs: readLegs(fm?.return_legs),
    };
  });

  // ------------------------------------------------------- day by day
  const days: DocDay[] = datesInRange(trip.startDate, trip.endDate, 90).map((date, index) => {
    const parsed = parseISO(date);
    const items = bookings
      .filter((b) => b.status !== "cancelled")
      .flatMap((booking) => {
        const out: { time: string; title: string; detail: string }[] = [];
        if (booking.kind === "stay") {
          if (date === booking.date) out.push({ time: booking.time, title: booking.title, detail: "Check in" });
          if (booking.endDate !== booking.date && date === booking.endDate) {
            out.push({ time: booking.endTime, title: booking.title, detail: "Check out" });
          }
          return out;
        }
        if (booking.kind === "flight") {
          if (date === booking.date) {
            out.push({
              time: booking.time,
              title: booking.title,
              detail: [booking.from, booking.to].filter(Boolean).join(" → "),
            });
          }
          if (booking.returnDate && date === booking.returnDate) {
            out.push({ time: booking.returnTime, title: booking.title, detail: "Return" });
          }
          return out;
        }
        if (date === booking.date) {
          out.push({ time: booking.time, title: booking.title, detail: booking.slot });
        }
        return out;
      })
      .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));

    const staying = bookings.find(
      (b) => b.kind === "stay" && date > b.date && date < b.endDate,
    );

    return {
      date,
      label: `Day ${index + 1}`,
      weekday: parsed ? `${WEEKDAYS[parsed.getUTCDay()]} ${parsed.getUTCDate()} ${monthName(date)}` : date,
      items,
      staying: staying ? `Staying at ${staying.title}` : "",
    };
  });

  // ------------------------------------------------------------ costs
  const budgetTotal = plugin.bookings.getBudgetTotal(trip);
  const byCategory = totalsByCategory(lines);
  const costs: TripDocument["costs"] = {
    lines: counted.map((line) => ({
      date: line.date,
      description: line.description,
      category: line.category,
      amount: formatMoney(line.money),
    })),
    total: formatTotals(sumMoney(counted.map((l) => l.money)), formatMoney({ amount: 0, currency })),
    budget: budgetTotal > 0 ? formatMoney({ amount: budgetTotal, currency }) : "",
    byCategory: [...byCategory].map(([category, amounts]) => [
      category,
      formatMoney({ amount: amounts.get(currency) ?? 0, currency }),
    ]),
  };

  // ---------------------------------------------------------- packing
  const packing: TripDocument["packing"] = [];
  const packingFile = app.vault.getAbstractFileByPath(
    `${trip.folderPath}/${SUB_NOTE_LABELS.packing}.md`,
  );
  if (packingFile instanceof TFile) {
    let section = "";
    for (const raw of (await app.vault.cachedRead(packingFile)).split("\n")) {
      const line = raw.trim();
      const heading = /^##\s+(.+)$/.exec(line);
      if (heading) {
        section = heading[1];
        packing.push({ section, items: [] });
        continue;
      }
      const task = /^[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
      if (task && packing.length > 0) {
        packing[packing.length - 1].items.push({
          label: task[2].trim(),
          packed: task[1].toLowerCase() === "x",
        });
      }
    }
  }

  // -------------------------------------------------------- attachments
  const images: TripDocument["images"] = [];
  const seen = new Set<string>();
  const collect = async (links: string[], sourcePath: string, caption: string): Promise<void> => {
    for (const link of links) {
      const file = fileFromLink(app, link, sourcePath);
      if (!file || seen.has(file.path) || !IMAGE_RE.test(file.name)) continue;
      seen.add(file.path);
      if (file.stat.size > MAX_IMAGE_BYTES) continue;
      const buffer = await app.vault.readBinary(file);
      images.push({
        caption,
        dataUri: `data:${mimeFor(file.extension)};base64,${arrayBufferToBase64(buffer)}`,
      });
    }
  };
  for (const booking of bookings) await collect(booking.attachments, booking.file.path, booking.title);
  for (const expense of plugin.bookings.getExpenses(trip)) {
    await collect(expense.attachments, expense.file.path, expense.description);
  }

  return {
    title: trip.title,
    dates: formatDateRange(trip.startDate, trip.endDate),
    duration: formatDuration(trip.startDate, trip.endDate),
    where: [trip.city, trip.country].filter(Boolean).join(", "),
    origin: [trip.originCity, trip.originAirport].filter(Boolean).join(" · "),
    travellers: trip.travellers,
    facts,
    documents,
    bookings: docBookings,
    days,
    costs,
    packing,
    images,
    generatedOn: new Date().toLocaleDateString(),
  };
}

/**
 * Direct PDF export, desktop only.
 *
 * `window.print()` only ever hands off to the OS print dialogue. Electron's
 * <webview> exposes printToPDF(), which renders straight to bytes — so the
 * document is loaded into an offscreen webview from a temp file and printed to
 * a buffer. Printing the host page instead would capture Obsidian's own UI.
 *
 * This mirrors the approach already proven in the Food Spot plugin rather than
 * inventing a second one.
 */
interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

interface ElectronBits {
  showSaveDialog(opts: object): Promise<SaveDialogResult>;
  writeFile(path: string, data: Uint8Array): void;
  tmpFile(name: string, content: string): string;
  removeFile(path: string): void;
  openPath?(path: string): void;
}

/** Electron and node handles, or null when this is not the desktop app. */
function electron(): ElectronBits | null {
  const req = (globalThis as unknown as { require?: (m: string) => unknown }).require;
  if (typeof req !== "function") return null;
  try {
    const el = req("electron") as {
      remote?: {
        dialog?: { showSaveDialog(o: object): Promise<SaveDialogResult> };
        shell?: { openPath(p: string): void };
      };
    };
    const fs = req("fs") as {
      writeFileSync(p: string, d: Uint8Array | string): void;
      unlinkSync(p: string): void;
    };
    const os = req("os") as { tmpdir(): string };
    const path = req("path") as { join(...p: string[]): string };

    const dialog = el.remote?.dialog;
    if (!dialog || !fs || !os) return null;

    return {
      showSaveDialog: (o) => dialog.showSaveDialog(o),
      writeFile: (p, d) => fs.writeFileSync(p, d),
      tmpFile: (name, content) => {
        const target = path.join(os.tmpdir(), name);
        fs.writeFileSync(target, content);
        return target;
      },
      removeFile: (p) => fs.unlinkSync(p),
      openPath: el.remote?.shell ? (p: string) => el.remote?.shell?.openPath(p) : undefined,
    };
  } catch {
    return null;
  }
}

export function canExportPdf(): boolean {
  return electron() !== null;
}

/** Electron's <webview> tag, with the printToPDF extension this relies on. */
interface PrintableWebview extends HTMLElement {
  src: string;
  printToPDF(options: object): Promise<Uint8Array>;
}

type PdfOutcome = "saved" | "cancelled" | "failed";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Renders `html` to a PDF wherever the save dialogue points.
 *
 * Never rejects: every failure shows its own notice and resolves "failed", so
 * the caller can offer the print dialogue instead.
 */
async function exportHtmlToPdf(html: string, suggestedName: string): Promise<PdfOutcome> {
  const bits = electron();
  if (!bits) return "failed";

  let chosen: SaveDialogResult;
  try {
    chosen = await bits.showSaveDialog({
      defaultPath: suggestedName,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
  } catch (e) {
    new Notice(`Could not open the save dialogue — ${errorText(e)}`);
    return "failed";
  }
  if (chosen.canceled || !chosen.filePath) return "cancelled";
  const target = chosen.filePath;

  // The document is self-contained, so a temp file loaded over file:// needs
  // no vault and no network.
  let tmpPath: string;
  try {
    tmpPath = bits.tmpFile(`travel-planner-${Date.now()}.html`, html);
  } catch (e) {
    new Notice(`Could not prepare the document for printing — ${errorText(e)}`);
    return "failed";
  }

  const view = document.createElement("webview") as PrintableWebview;
  view.setAttribute("nodeintegration", "false");
  // 794x1123 is A4 at 96dpi, so the CSS layout matches the printed page.
  view.style.cssText =
    "position:fixed;left:-10000px;top:0;width:794px;height:1123px;opacity:0;pointer-events:none;";
  view.src = `file://${tmpPath}`;

  return new Promise<PdfOutcome>((resolve) => {
    let settled = false;
    let timeoutId = 0;

    const cleanup = (): void => {
      window.clearTimeout(timeoutId);
      view.remove();
      try {
        bits.removeFile(tmpPath);
      } catch (e) {
        // The temp file holds the whole trip, so say where it is rather than
        // leaving it lying around quietly.
        new Notice(`Could not remove ${tmpPath} — delete it yourself (${errorText(e)}).`, 10000);
      }
    };

    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      new Notice(message);
      resolve("failed");
    };

    view.addEventListener(
      "did-finish-load",
      () => {
        // A beat after load, so embedded images are painted before capture.
        window.setTimeout(() => {
          void (async () => {
            try {
              const data = await view.printToPDF({
                pageSize: "A4",
                printBackground: true,
                // Margins live in the document's own @page padding.
                margins: { marginType: "none" },
              });
              bits.writeFile(target, data);
              settled = true;
              cleanup();
              new Notice(`PDF saved to ${target}`, 8000);
              bits.openPath?.(target);
              resolve("saved");
            } catch (e) {
              fail(`Could not write the PDF — ${errorText(e)}`);
            }
          })();
        }, 350);
      },
      { once: true },
    );
    view.addEventListener(
      "did-fail-load",
      () => fail("The document could not be rendered for PDF export."),
      { once: true },
    );

    timeoutId = window.setTimeout(() => fail("PDF export timed out."), 20_000);
    document.body.appendChild(view);
  });
}

/** Opens the system print dialogue on the rendered document. */
function printViaDialog(html: string): void {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;height:1123px;";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  window.setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    // Removing it immediately cancels the dialogue on some platforms.
    window.setTimeout(() => frame.remove(), 60_000);
  }, 400);
}

async function ensureFolder(app: App, path: string): Promise<void> {
  if (app.vault.getAbstractFileByPath(path) instanceof TFolder) return;
  try {
    await app.vault.createFolder(path);
  } catch {
    /* already there */
  }
}

/**
 * Exports a trip.
 *
 * The PDF goes wherever you point the save dialogue — anywhere on disk, not
 * only inside the vault. A copy of the self-contained HTML is kept in the trip
 * folder, since it opens anywhere and needs no plugin.
 */
export async function exportTrip(plugin: TravelPlannerPlugin, trip: Trip): Promise<void> {
  const notice = new Notice("Building the document…", 0);
  let html: string;

  try {
    html = renderTripDocument(await buildTripDocument(plugin, trip));

    const folder = joinPath(trip.folderPath, "Export");
    await ensureFolder(plugin.app, folder);
    const htmlPath = joinPath(folder, `${sanitizeName(trip.title)}.html`);
    const existing = plugin.app.vault.getAbstractFileByPath(htmlPath);
    if (existing instanceof TFile) await plugin.app.vault.modify(existing, html);
    else await plugin.app.vault.create(htmlPath, html);
  } catch (err) {
    notice.hide();
    new Notice(err instanceof Error ? err.message : "Could not build the document.", 8000);
    console.error("[travel-planner]", err);
    return;
  }
  notice.hide();

  if (!canExportPdf()) {
    new Notice("Direct PDF export needs the desktop app — opening the print dialogue instead.");
    printViaDialog(html);
    return;
  }

  const outcome = await exportHtmlToPdf(html, `${sanitizeName(trip.title)}.pdf`);
  if (outcome === "failed") printViaDialog(html);
}
