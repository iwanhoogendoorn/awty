/*
 * Which export route a device can actually take, as a pure decision.
 *
 * The export code is full of things only Electron can do — a save dialogue, a
 * temp file, printToPDF, an offscreen webview that prints. Deciding *which* of
 * those to attempt is separate from doing it, and the deciding half is where
 * the mobile behaviour lives. Keeping it here means the branch can be tested
 * without an app around it, and means "what changes on mobile?" is answerable
 * by reading one file.
 *
 * Nothing in here imports obsidian at runtime, so it bundles into the smoke
 * tests. The capability booleans come from `util/platform.ts` at the call site.
 */

/** What the host device can do, as far as exporting is concerned. */
export interface ExportCapabilities {
  /** Electron's save dialogue, temp files and printToPDF are reachable. */
  canExportPdf: boolean;
  /** This is the iOS or Android app. */
  isMobile: boolean;
}

/** How a PDF export should be attempted on this device. */
export type PdfPlan = "printToPdf" | "printDialog" | "openHtmlInVault";

/** What to do once printToPDF is off the table — either unavailable or failed. */
export type PdfFallback = "printDialog" | "openHtmlInVault";

/**
 * The fallback when there is no printToPDF.
 *
 * Only `isMobile` decides. A desktop app with a blocked `require` — rare, but
 * that is exactly what `canExportPdf: false` means on the desktop — keeps the
 * print dialogue it has always had. The offscreen iframe and its
 * `contentWindow.print()` are the thing that does nothing in the mobile app, so
 * mobile is the only case that changes.
 */
export function pdfFallbackFor(caps: ExportCapabilities): PdfFallback {
  return caps.isMobile ? "openHtmlInVault" : "printDialog";
}

/** The first thing to try. printToPDF when it exists, otherwise the fallback. */
export function pdfPlanFor(caps: ExportCapabilities): PdfPlan {
  return caps.canExportPdf ? "printToPdf" : pdfFallbackFor(caps);
}

/** Where the KML from "Save map file" should go. */
export type MapSavePlan = "saveDialog" | "vaultFile";

/**
 * Where to put a saved map file.
 *
 * The save dialogue is the desktop answer and stays the desktop answer. On
 * mobile there is no dialogue at all, so the trip folder — which is where
 * `exportMap` already writes — is the only place the file can land.
 */
export function mapSavePlanFor(caps: ExportCapabilities): MapSavePlan {
  return caps.isMobile ? "vaultFile" : "saveDialog";
}

/**
 * The result of asking for a file to be written somewhere outside the vault.
 *
 * "You cancelled" and "this device cannot do that" both used to come back as
 * `null`, which left the caller guessing and the user reading a notice about a
 * desktop app they were not using. They are different answers, so they are
 * different shapes.
 */
export type SaveTextOutcome =
  | { status: "saved"; path: string }
  | { status: "cancelled" }
  | { status: "unsupported" };

/** Notice text once the trip document is sitting in the vault. */
export function htmlFallbackMessage(path: string, opened: boolean): string {
  const where = `The full trip document is in your vault at ${path}.`;
  return opened
    ? `PDF export needs the desktop app. ${where} Opening it now — use your device's share or print menu from there.`
    : `PDF export needs the desktop app. ${where} Open it from the file list and use your device's share or print menu.`;
}

/** Notice text for a map file that landed in the trip folder rather than on disk. */
export function mapSavedInVaultMessage(count: number, path: string): string {
  return `${count} places saved to ${path} in your vault. Share it from there to open it in a maps app.`;
}
