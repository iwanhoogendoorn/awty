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
 * Electron's print-to-PDF, reached through the renderer.
 *
 * Not part of Obsidian's public API, so it is feature-detected and every step
 * is optional — a desktop that has moved on, or a phone, falls back to the
 * print dialogue rather than failing.
 */
async function printToPdf(html: string): Promise<ArrayBuffer | null> {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "100%";
  frame.style.width = "210mm";
  frame.style.height = "297mm";
  frame.style.opacity = "0";
  document.body.appendChild(frame);

  try {
    const doc = frame.contentDocument;
    if (!doc) return null;
    doc.open();
    doc.write(html);
    doc.close();

    // Give embedded images a moment to decode, or they print blank.
    await new Promise((resolve) => window.setTimeout(resolve, 350));

    const electron = (window as unknown as { require?: (id: string) => unknown }).require?.(
      "electron",
    ) as
      | {
          remote?: { getCurrentWebContents?: () => unknown };
          webFrame?: unknown;
        }
      | undefined;

    const webContents = electron?.remote?.getCurrentWebContents?.() as
      | { printToPDF?: (opts: Record<string, unknown>) => Promise<Uint8Array> }
      | undefined;

    if (!webContents?.printToPDF) return null;

    // Printing the host page would capture Obsidian's own UI, so this prints
    // the frame by handing its markup to a hidden window instead.
    const buffer = await webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: { marginType: "none" },
    });
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  } catch (err) {
    console.error("[travel-planner] printToPDF unavailable", err);
    return null;
  } finally {
    frame.remove();
  }
}

/** Opens the system print dialogue on the rendered document. */
function printViaDialog(html: string): void {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "100%";
  frame.style.width = "210mm";
  frame.style.height = "297mm";
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
 * Writes a real PDF where Electron allows it, and always writes the HTML
 * alongside — the HTML opens anywhere, needs no plugin, and is what makes this
 * useful when the phone with the tickets on it has a flat battery.
 */
export async function exportTrip(plugin: TravelPlannerPlugin, trip: Trip): Promise<void> {
  const notice = new Notice("Building the document…", 0);
  try {
    const doc = await buildTripDocument(plugin, trip);
    const html = renderTripDocument(doc);

    const folder = joinPath(trip.folderPath, "Export");
    await ensureFolder(plugin.app, folder);
    const base = sanitizeName(trip.title);

    const htmlPath = joinPath(folder, `${base}.html`);
    const existingHtml = plugin.app.vault.getAbstractFileByPath(htmlPath);
    if (existingHtml instanceof TFile) await plugin.app.vault.modify(existingHtml, html);
    else await plugin.app.vault.create(htmlPath, html);

    const pdf = await printToPdf(html);
    notice.hide();

    if (pdf) {
      const pdfPath = joinPath(folder, `${base}.pdf`);
      const existingPdf = plugin.app.vault.getAbstractFileByPath(pdfPath);
      if (existingPdf instanceof TFile) await plugin.app.vault.modifyBinary(existingPdf, pdf);
      else await plugin.app.vault.createBinary(pdfPath, pdf);
      new Notice(`Exported to ${pdfPath}`, 8000);
      return;
    }

    new Notice(
      `Wrote ${htmlPath}. Opening the print dialogue — choose "Save as PDF" to finish.`,
      9000,
    );
    printViaDialog(html);
  } catch (err) {
    notice.hide();
    new Notice(err instanceof Error ? err.message : "Could not export the trip.", 8000);
    console.error("[travel-planner]", err);
  }
}
