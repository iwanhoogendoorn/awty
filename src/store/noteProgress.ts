import { App, TFile } from "obsidian";
import type { SubNoteId } from "../types";

export type ProgressState = "empty" | "started" | "complete";

export interface NoteProgress {
  state: ProgressState;
  /** Short glanceable summary, e.g. "12/34 packed". */
  detail: string;
  /** 0–1 when there's something meaningful to fill, otherwise null. */
  ratio: number | null;
}

const EMPTY: NoteProgress = { state: "empty", detail: "Not started", ratio: null };

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  return end === -1 ? "" : content.slice(end + 4);
}

/** A line that only exists to tell you where to type. */
function isPlaceholder(line: string): boolean {
  const t = line.trim();
  return t.length === 0 || /^_.*_$/.test(t) || t.startsWith(">");
}

interface Signals {
  tasksTotal: number;
  tasksDone: number;
  tableRows: number;
  dayHeadings: number;
  daysWithContent: number;
  proseWords: number;
  hasFoodSpotBlock: boolean;
}

function scan(body: string): Signals {
  const lines = body.split("\n");
  const s: Signals = {
    tasksTotal: 0,
    tasksDone: 0,
    tableRows: 0,
    dayHeadings: 0,
    daysWithContent: 0,
    proseWords: 0,
    hasFoodSpotBlock: false,
  };

  let inFence = false;
  let currentDayHasContent = false;
  let inDay = false;

  for (const raw of lines) {
    const line = raw.trim();

    if (line.startsWith("```")) {
      if (!inFence && line.toLowerCase().startsWith("```foodspot")) s.hasFoodSpotBlock = true;
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const dayHeading = /^##\s+\d{4}-\d{2}-\d{2}\s*$/.test(line);
    if (dayHeading) {
      if (inDay && currentDayHasContent) s.daysWithContent += 1;
      s.dayHeadings += 1;
      inDay = true;
      currentDayHasContent = false;
      continue;
    }

    const task = /^[-*]\s+\[( |x|X)\]/.exec(line);
    if (task) {
      s.tasksTotal += 1;
      if (task[1].toLowerCase() === "x") s.tasksDone += 1;
      // A ticked box, or one with text typed after it, counts as real content.
      const label = line.replace(/^[-*]\s+\[.\]\s*/, "").trim();
      if (label.length > 0 || task[1].toLowerCase() === "x") currentDayHasContent = true;
      continue;
    }

    if (line.startsWith("|")) {
      const cells = line.slice(1, line.endsWith("|") ? -1 : undefined).split("|");
      const isSeparator = cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
      const isEmpty = cells.every((c) => c.trim().length === 0);
      const isHeader = cells.some((c) => /^\*\*.+\*\*$/.test(c.trim()));
      if (!isSeparator && !isEmpty && !isHeader) {
        s.tableRows += 1;
        currentDayHasContent = true;
      }
      continue;
    }

    if (line.startsWith("#")) continue;
    if (isPlaceholder(line)) continue;

    s.proseWords += line.split(/\s+/).filter(Boolean).length;
    currentDayHasContent = true;
  }

  if (inDay && currentDayHasContent) s.daysWithContent += 1;

  // The first table row is the header, which we counted above.
  if (s.tableRows > 0) s.tableRows -= 1;

  return s;
}

/**
 * Turns a sub-note's content into a glanceable state.
 *
 * The point is answering "what still needs work?" without opening anything, so
 * each note type reports the number that actually matters for it: ticked boxes
 * for a packing list, filled rows for accommodation, planned days for an
 * itinerary.
 */
export function analyseNote(id: SubNoteId | null, content: string): NoteProgress {
  const body = stripFrontmatter(content);
  const s = scan(body);

  if (id === "packing" || (s.tasksTotal > 0 && id !== "itinerary")) {
    if (s.tasksTotal === 0) return EMPTY;
    const ratio = s.tasksDone / s.tasksTotal;
    return {
      state: ratio >= 1 ? "complete" : ratio > 0 ? "started" : "empty",
      detail: `${s.tasksDone}/${s.tasksTotal} packed`,
      ratio,
    };
  }

  if (id === "itinerary") {
    if (s.dayHeadings === 0) {
      return s.proseWords > 0
        ? { state: "started", detail: "No days yet", ratio: null }
        : EMPTY;
    }
    const ratio = s.daysWithContent / s.dayHeadings;
    return {
      state: ratio >= 1 ? "complete" : ratio > 0 ? "started" : "empty",
      detail: `${s.daysWithContent}/${s.dayHeadings} days planned`,
      ratio,
    };
  }

  if (id === "accommodation" || id === "transport" || id === "budget") {
    const noun = id === "budget" ? "line" : id === "transport" ? "leg" : "booking";
    if (s.tableRows <= 0 && s.proseWords === 0) return EMPTY;
    if (s.tableRows <= 0) return { state: "started", detail: "Notes only", ratio: null };
    return {
      state: "started",
      detail: `${s.tableRows} ${noun}${s.tableRows === 1 ? "" : "s"}`,
      ratio: null,
    };
  }

  if (id === "food") {
    if (s.hasFoodSpotBlock && s.tableRows <= 0 && s.proseWords === 0) {
      return { state: "started", detail: "Food Spot embed", ratio: null };
    }
    if (s.tableRows > 0) {
      return { state: "started", detail: `${s.tableRows} booked`, ratio: null };
    }
    return s.proseWords > 0 ? { state: "started", detail: "Notes added", ratio: null } : EMPTY;
  }

  if (s.tableRows > 0 || s.proseWords > 0) {
    return { state: "started", detail: "In progress", ratio: null };
  }
  return EMPTY;
}

/**
 * Caches progress per file, keyed on mtime so an edit invalidates it but a
 * re-render does not re-read the whole vault.
 */
export class ProgressCache {
  private cache = new Map<string, { mtime: number; progress: NoteProgress }>();

  constructor(private app: App) {}

  peek(file: TFile): NoteProgress | null {
    const hit = this.cache.get(file.path);
    return hit && hit.mtime === file.stat.mtime ? hit.progress : null;
  }

  async get(file: TFile, id: SubNoteId | null): Promise<NoteProgress> {
    const hit = this.peek(file);
    if (hit) return hit;
    const content = await this.app.vault.cachedRead(file);
    const progress = analyseNote(id, content);
    this.cache.set(file.path, { mtime: file.stat.mtime, progress });
    return progress;
  }

  clear(): void {
    this.cache.clear();
  }
}
