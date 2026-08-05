/*
 * One place that answers "which kind of device is this?".
 *
 * Obsidian ships `Platform` (see obsidian.d.ts), which is authoritative and
 * cheap. Sniffing the user agent would be a second, worse answer to a question
 * the host already answers, so nothing here looks at navigator.
 *
 * Every mobile branch in the plugin — TS or CSS — hangs off this module, so
 * "what changes on mobile?" has exactly one place to read.
 */
import { Platform } from "obsidian";

/** True in the iOS and Android apps. False everywhere on the desktop app. */
export function isMobile(): boolean {
  return Platform.isMobile;
}

/** True on a phone-sized screen. Tablets get the roomier desktop layouts. */
export function isPhone(): boolean {
  return Platform.isPhone;
}

/** True on a tablet running the mobile app. */
export function isTablet(): boolean {
  return Platform.isTablet;
}

/**
 * True where Electron and node are available — the desktop app.
 *
 * The save dialogue, the temp file and printToPDF all need this. Kept separate
 * from `isMobile()` because "not mobile" and "has Electron" are different
 * claims, and only the second one licenses `require("electron")`.
 */
export function isDesktopApp(): boolean {
  return Platform.isDesktopApp;
}

/**
 * Marks the document so CSS can target mobile without a media query.
 *
 * A media query would also fire for a narrow pane on the desktop, which would
 * change how the plugin looks for desktop users. The body class fires only in
 * the mobile app, so every rule scoped under it is provably invisible on the
 * desktop.
 *
 * Returns the classes it added, so the caller can take them off again.
 */
export function markPlatform(body: HTMLElement): string[] {
  const classes: string[] = [];
  if (Platform.isMobile) classes.push("awty-mobile");
  if (Platform.isPhone) classes.push("awty-phone");
  if (Platform.isTablet) classes.push("awty-tablet");
  for (const cls of classes) body.classList.add(cls);
  return classes;
}
