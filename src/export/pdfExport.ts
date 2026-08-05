import { App, Notice, TFile, TFolder, arrayBufferToBase64 } from "obsidian";
import type AwtyPlugin from "../main";
import type { Trip } from "../types";
import { SUB_NOTE_LABELS, kindDef } from "../types";
import { joinPlaces, tripCities, tripCountries } from "../types";
import { BOOKING_KINDS } from "../bookings/types";
import { fileFromLink, totalsByCategory } from "../bookings/bookingStore";
import { checkVisa } from "../travel/visa";
import { ADVICE_MEANING } from "../travel/adviceData";
import { entryExtrasChecked, entryExtrasFor } from "../data/entryExtras";
import { DISCLAIMER_FULL } from "../data/disclaimer";
import { formatMoney, formatTotals, sumMoney } from "../util/money";
import {
  datesInRange,
  formatDateRange,
  formatDuration,
  monthName,
  parseISO,
} from "../util/dates";
import {
  renderTripDocument,
  type DocBooking,
  type DocDay,
  type DocNote,
  type DocPlace,
  type DocRestaurant,
  type TripDocument,
} from "./tripDocument";
import { renderMarkdown, stripFrontmatter } from "./markdown";
import {
  htmlFallbackMessage,
  pdfFallbackFor,
  type ExportCapabilities,
  type SaveTextOutcome,
} from "./exportPlan";
import { isMobile } from "../util/platform";
import { BAND, dayEvents, ongoingOn } from "../store/dayPlan";
import { readLegs as readFlightLegs, summariseFlight } from "../bookings/flightSummary";
import { TRAVEL_MODES, formatDistance, formatDuration as formatTravelTime } from "../travel/types";
import type { Place } from "../travel/types";
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

/** "2 h 20 min · direct · lands 12:35" for a set of frontmatter legs. */
function journeyOf(value: unknown): string {
  const legs = readFlightLegs(value);
  if (legs.length === 0) return "";
  const summary = summariseFlight(legs);
  return [summary.label, ...summary.layovers, summary.arrival ? `lands ${summary.arrival}` : ""]
    .filter(Boolean)
    .join(" · ");
}

/** The same, for whichever end of a return ticket this day belongs to. */
function flightJourney(app: App, file: TFile, band: number): string {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!fm?.legs && !fm?.return_legs) return "";
  return journeyOf(band === BAND.Depart ? fm?.return_legs : fm?.legs);
}

/** Gathers everything the plugin knows about a trip into one printable shape. */
export async function buildTripDocument(
  plugin: AwtyPlugin,
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
  // A visa and an advice line for every border the trip crosses.
  for (const country of tripCountries(trip)) {
    for (const passport of passports.filter(Boolean)) {
      const check = checkVisa(passport, country);
      if (check.outcome === "same-country") continue;
      documents.push({
        label: `${passport} passport → ${country}: ${check.label}`,
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

    // Arrival cards and authorisations are not visas, and a document you take
    // with you is exactly where "no visa needed, but do this" belongs.
    const extras = entryExtrasFor(country);
    if (extras.length === 0 && !entryExtrasChecked(country)) {
      documents.push({
        label: `${country} · arrival formalities not checked`,
        detail:
          "Many countries want an arrival card or an authorisation even without a visa. This one has not been checked — read the official travel advice before you fly.",
        tone: "unknown",
      });
    }
    for (const extra of extras) {
      const coming = extra.status === "announced";
      documents.push({
        label: `${country} · ${extra.name}${coming ? " (announced, not yet in force)" : ""}`,
        detail: [extra.detail, extra.cost, extra.url].filter(Boolean).join(" — "),
        tone: coming ? "unknown" : "warn",
      });
    }

    const advice = plugin.peekAdvice(country);
    if (!advice) continue;
    const meaning = ADVICE_MEANING[advice.colour];
    documents.push({
      label: `Travel advice · ${country}: ${meaning.label}`,
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
      address: booking.address,
      reference: booking.reference,
      seat: booking.seat,
      cost: booking.cost ? formatMoney(booking.cost) : "",
      notes: booking.notes,
      legs: readLegs(fm?.legs),
      returnLegs: readLegs(fm?.return_legs),
      journey: journeyOf(fm?.legs),
      returnJourney: journeyOf(fm?.return_legs),
    };
  });

  // ------------------------------------------------------- day by day
  const places = plugin.travelPlaces.get(trip.folderPath);
  const origin = places?.hotels[0];
  const allPlaces: Place[] = places
    ? [...places.hotels, ...places.airports, ...places.activities, ...places.restaurants]
    : [];
  const placeByPath = new Map(allPlaces.filter((p) => p.file).map((p) => [p.file!.path, p]));
  const modes = plugin.settings.travelModes;

  /** Cached travel time between two places, or "" when it was never measured. */
  const hopText = (from: Place | undefined, to: Place | undefined): string => {
    if (!from || !to || from.id === to.id) return "";
    const legs = plugin.travel.peekLegs(from, [to], modes).get(to.id);
    if (!legs || legs.length === 0) return "";
    const reference = legs.find((l) => l.mode === "walking") ?? legs[0];
    return [
      formatDistance(reference.distanceMeters),
      ...legs.map(
        (leg) =>
          `${TRAVEL_MODES.find((m) => m.id === leg.mode)?.label ?? leg.mode} ${formatTravelTime(leg.durationSeconds)}`,
      ),
    ].join(" · ");
  };

  const live = bookings.filter((b) => b.status !== "cancelled");
  const days: DocDay[] = datesInRange(trip.startDate, trip.endDate, 90).map((date, index) => {
    const parsed = parseISO(date);
    const events = dayEvents(live, date);
    const staying = ongoingOn(live, date)[0];

    const items = events.map((event, position) => {
      const previous =
        position === 0
          ? staying
            ? (placeByPath.get(staying.file.path) ?? origin)
            : undefined
          : placeByPath.get(events[position - 1].file.path);
      return {
        time: event.time,
        title: event.title,
        detail: [event.detail, flightJourney(app, event.file, event.band)]
          .filter(Boolean)
          .join(" · "),
        travel: hopText(previous, placeByPath.get(event.file.path)),
      };
    });

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

  // ---------------------------------------------------- getting around
  const travel: TripDocument["travel"] = { origin: origin?.label ?? "", groups: [] };
  if (origin && places) {
    const groups: { heading: string; items: Place[] }[] = [
      { heading: `Airport transfer · to ${origin.label}`, items: places.airports },
      { heading: `Activities · from ${origin.label}`, items: places.activities },
      { heading: `Restaurants · from ${origin.label}`, items: places.restaurants },
    ];
    for (const group of groups) {
      const rows: DocPlace[] = [];
      for (const place of group.items) {
        const legs = plugin.travel.peekLegs(origin, [place], modes).get(place.id);
        if (!legs || legs.length === 0) continue;
        const reference = legs.find((l) => l.mode === "walking") ?? legs[0];
        rows.push({
          name: place.label,
          detail: [place.date, place.time].filter(Boolean).join(" "),
          distance: formatDistance(reference.distanceMeters),
          times: modes
            .map((mode) => {
              const leg = legs.find((l) => l.mode === mode);
              const label = TRAVEL_MODES.find((m) => m.id === mode)?.label ?? mode;
              return `${label} ${leg ? formatTravelTime(leg.durationSeconds) : "no route"}`;
            })
            .join(" · "),
        });
      }
      if (rows.length > 0) travel.groups.push({ heading: group.heading, places: rows });
    }
  }

  // --------------------------------------------------------- restaurants
  const restaurants: DocRestaurant[] = [];
  for (const place of plugin.travel.restaurantsFor(trip)) {
    const fm = place.file ? app.metadataCache.getFileCache(place.file)?.frontmatter : undefined;
    if (!fm) continue;
    const price = Number(fm.price);
    const legs = origin ? plugin.travel.peekLegs(origin, [place], modes).get(place.id) : undefined;
    const reference = legs?.find((l) => l.mode === "walking") ?? legs?.[0];
    restaurants.push({
      name: String(fm.name ?? place.label),
      cuisines: Array.isArray(fm.cuisines) ? fm.cuisines.join(", ") : String(fm.cuisines ?? ""),
      price: Number.isFinite(price) && price > 0 ? "\u20ac".repeat(Math.min(price, 4)) : "",
      rating: fm.google_rating
        ? `${fm.google_rating}${fm.google_rating_count ? ` (${fm.google_rating_count})` : ""}`
        : "",
      address: String(fm.address ?? ""),
      contact: [fm.phone, fm.url].filter(Boolean).map(String).join(" · "),
      travel:
        legs && reference
          ? `${formatDistance(reference.distanceMeters)} · ${legs
              .map(
                (leg) =>
                  `${TRAVEL_MODES.find((m) => m.id === leg.mode)?.label ?? leg.mode} ${formatTravelTime(leg.durationSeconds)}`,
              )
              .join(" · ")}`
          : "",
      status: [fm.favorite ? "favourite" : "", fm.status === "visited" ? "visited" : ""]
        .filter(Boolean)
        .join(" · "),
    });
  }
  restaurants.sort((a, b) => a.name.localeCompare(b.name));

  // --------------------------------------------------------------- notes
  // What you wrote by hand is trip information too. The packing list has its
  // own section already, and Budget is the Costs table in prose form.
  const notes: DocNote[] = [];
  const skip = new Set<string>(["packing", "budget"]);
  const tripBody = renderMarkdown(stripFrontmatter(await app.vault.cachedRead(trip.file)));
  if (tripBody.trim()) notes.push({ title: "Trip note", html: tripBody });
  for (const sub of plugin.store.getSubNotes(trip)) {
    if (sub.id && skip.has(sub.id)) continue;
    const html = renderMarkdown(stripFrontmatter(await app.vault.cachedRead(sub.file)));
    if (html.trim()) notes.push({ title: sub.label, html });
  }

  return {
    title: trip.title,
    dates: formatDateRange(trip.startDate, trip.endDate),
    duration: formatDuration(trip.startDate, trip.endDate),
    where: [joinPlaces(tripCities(trip)), joinPlaces(tripCountries(trip))].filter(Boolean).join(", "),
    origin: [trip.originCity, trip.originAirport].filter(Boolean).join(" · "),
    travellers: trip.travellers,
    facts,
    documents,
    bookings: docBookings,
    days,
    costs,
    packing,
    disclaimer: DISCLAIMER_FULL,
    travel,
    restaurants,
    notes,
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

/**
 * Saves text to a file the user picks, using the desktop save dialogue.
 *
 * Shares the Electron bridge the PDF export already proved, rather than
 * standing up a second one. Answers with the path written, "cancelled" when the
 * dialogue was dismissed, or "unsupported" when there is no dialogue to open —
 * a phone can only be told something useful if those last two are told apart.
 */
export async function saveTextFile(
  defaultName: string,
  contents: string,
  filters: { name: string; extensions: string[] }[],
): Promise<SaveTextOutcome> {
  const bits = electron();
  if (!bits) return { status: "unsupported" };

  const result = await bits.showSaveDialog({ defaultPath: defaultName, filters });
  if (result.canceled || !result.filePath) return { status: "cancelled" };

  bits.writeFile(result.filePath, new TextEncoder().encode(contents));
  return { status: "saved", path: result.filePath };
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
    tmpPath = bits.tmpFile(`awty-${Date.now()}.html`, html);
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
              // The timeout may have fired while this was printing. It has
              // already cleaned up and reported failure; writing the file and
              // announcing success now would resolve the same promise twice.
              if (settled) return;
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

/**
 * The mobile answer to "make me a PDF".
 *
 * There is no printToPDF and no print dialogue in the mobile app, but the
 * self-contained HTML has already been written into the trip folder — so name
 * the path and open the file, which is the most the typed API offers. Obsidian
 * has no share-sheet method in obsidian.d.ts, so nothing here pretends there is
 * one; from the opened file the OS share and print menus are one tap away.
 */
async function openExportedHtml(plugin: AwtyPlugin, htmlPath: string): Promise<void> {
  const file = plugin.app.vault.getAbstractFileByPath(htmlPath);
  let opened = false;
  if (file instanceof TFile) {
    try {
      await plugin.openInWorkspace(file);
      opened = true;
    } catch (e) {
      // Not every build has a view for .html. The path in the notice still
      // gets the user there, so this is a downgrade, not a failure.
      console.error("[awty]", e);
    }
  }
  new Notice(htmlFallbackMessage(htmlPath, opened), 15000);
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
export async function exportTrip(plugin: AwtyPlugin, trip: Trip): Promise<void> {
  const notice = new Notice("Building the document…", 0);
  let html: string;
  let htmlPath: string;

  try {
    html = renderTripDocument(await buildTripDocument(plugin, trip));

    const folder = joinPath(trip.folderPath, "Export");
    await ensureFolder(plugin.app, folder);
    htmlPath = joinPath(folder, `${sanitizeName(trip.title)}.html`);
    const existing = plugin.app.vault.getAbstractFileByPath(htmlPath);
    if (existing instanceof TFile) await plugin.app.vault.modify(existing, html);
    else await plugin.app.vault.create(htmlPath, html);
  } catch (err) {
    notice.hide();
    new Notice(err instanceof Error ? err.message : "Could not build the document.", 8000);
    console.error("[awty]", err);
    return;
  }
  notice.hide();

  const caps: ExportCapabilities = { canExportPdf: canExportPdf(), isMobile: isMobile() };
  const fallback = pdfFallbackFor(caps);

  if (!caps.canExportPdf) {
    if (fallback === "openHtmlInVault") {
      await openExportedHtml(plugin, htmlPath);
      return;
    }
    new Notice("Direct PDF export needs the desktop app — opening the print dialogue instead.");
    printViaDialog(html);
    return;
  }

  const outcome = await exportHtmlToPdf(html, `${sanitizeName(trip.title)}.pdf`);
  if (outcome !== "failed") return;
  if (fallback === "openHtmlInVault") await openExportedHtml(plugin, htmlPath);
  else printViaDialog(html);
}
