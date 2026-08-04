import { App, TFile } from "obsidian";
import type { SubNoteId, Trip } from "../types";
import { SUB_NOTE_LABELS } from "../types";

/**
 * Replaces a `## <heading>` section, or appends it when absent, leaving
 * everything the user wrote around it untouched. A wizard should never flatten
 * notes you have edited by hand.
 */
export async function replaceSection(
  app: App,
  file: TFile,
  heading: string,
  body: string,
): Promise<void> {
  const content = await app.vault.read(file);
  const lines = content.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  const block = `## ${heading}\n\n${body.trimEnd()}\n`;

  if (start === -1) {
    await app.vault.modify(file, `${content.trimEnd()}\n\n${block}`);
    return;
  }

  // Runs to the next heading of the same or higher level.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,2}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const next = [...lines.slice(0, start), block, ...lines.slice(end)].join("\n");
  await app.vault.modify(file, next.replace(/\n{3,}/g, "\n\n"));
}

/** Appends a row to the first markdown table under a heading, creating it if needed. */
export async function appendTableRow(
  app: App,
  file: TFile,
  heading: string,
  header: string[],
  cells: string[],
): Promise<void> {
  const content = await app.vault.read(file);
  const lines = content.split("\n");
  const row = `| ${cells.join(" | ")} |`;

  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) {
    const table = [
      `## ${heading}`,
      "",
      `| ${header.join(" | ")} |`,
      `|${header.map(() => "---").join("|")}|`,
      row,
      "",
    ].join("\n");
    await app.vault.modify(file, `${content.trimEnd()}\n\n${table}`);
    return;
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,2}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }

  // Last table line in the section, so the row lands at the bottom of the table
  // rather than after whatever prose follows it.
  let lastTableLine = -1;
  for (let i = start + 1; i < end; i += 1) {
    if (lines[i].trim().startsWith("|")) lastTableLine = i;
  }

  if (lastTableLine === -1) {
    const table = [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, row];
    lines.splice(start + 1, 0, "", ...table);
  } else {
    // Drop the placeholder row of empty cells the templates ship with.
    const isBlankRow = (line: string) =>
      line.trim().startsWith("|") &&
      line
        .split("|")
        .slice(1, -1)
        .every((c) => c.trim() === "");
    if (isBlankRow(lines[lastTableLine])) lines.splice(lastTableLine, 1, row);
    else lines.splice(lastTableLine + 1, 0, row);
  }

  await app.vault.modify(file, lines.join("\n"));
}

export function subNoteFile(app: App, trip: Trip, id: SubNoteId): TFile | null {
  const path = `${trip.folderPath}/${SUB_NOTE_LABELS[id]}.md`;
  const file = app.vault.getAbstractFileByPath(path);
  return file instanceof TFile ? file : null;
}

/** Creates the sub-note if a wizard is run for one the trip doesn't have. */
export async function ensureSubNote(app: App, trip: Trip, id: SubNoteId): Promise<TFile> {
  const existing = subNoteFile(app, trip, id);
  if (existing) return existing;

  const path = `${trip.folderPath}/${SUB_NOTE_LABELS[id]}.md`;
  const file = await app.vault.create(path, "");
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm.type = id;
    fm.trip = app.fileManager.generateMarkdownLink(trip.file, path);
  });
  const head = await app.vault.read(file);
  await app.vault.modify(file, `${head.trimEnd()}\n\n# ${SUB_NOTE_LABELS[id]} — ${trip.title}\n`);
  return file;
}
