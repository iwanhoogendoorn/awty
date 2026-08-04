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

/**
 * What a budget has to cover before it counts as done.
 *
 * Getting there, sleeping there and eating there: the three every trip spends
 * on. Activities and shopping vary too much between a city break and a week on
 * a beach to be required of anyone.
 */
export const BUDGET_ESSENTIALS = ["Transport", "Accommodation", "Food & drink"] as const;

function shortName(category: string): string {
  return category === "Food & drink" ? "food" : category.toLowerCase();
}

/**
 * Which essentials have a figure against them in the note's own tables.
 *
 * A row counts once any cell after the category holds something — a target, a
 * spend, either. Reading the table means the answer matches what is on screen
 * rather than a second calculation that could disagree with it.
 */
function coveredCategories(body: string): Set<string> {
  const covered = new Set<string>();
  const wanted = new Map(BUDGET_ESSENTIALS.map((c) => [c.toLowerCase(), c]));

  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("|")) continue;
    const cells = line
      .slice(1, line.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((c) => c.replace(/\*\*/g, "").trim());
    if (cells.length < 2) continue;

    const category = wanted.get(cells[0].toLowerCase());
    if (!category) continue;
    if (cells.slice(1).some((c) => /\d/.test(c))) covered.add(category);
  }
  return covered;
}

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

/** The rule under a header row: `|---|:--:|`. */
function isSeparatorRow(line: string): boolean {
  if (!line.startsWith("|")) return false;
  const cells = line.slice(1, line.endsWith("|") ? -1 : undefined).split("|");
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
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

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
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
      // Markdown defines a header as the row above the rule, so headers are
      // recognised where they are rather than by knocking one off the total at
      // the end — which quietly counted a second table's header as a booking.
      if (isSeparatorRow(line)) continue;
      if (isSeparatorRow((lines[i + 1] ?? "").trim())) continue;

      const cells = line.slice(1, line.endsWith("|") ? -1 : undefined).split("|");
      // The generated Budget note ships a row per category with every value
      // blank. Those are prompts, not content: a row counts only once
      // something has been filled in beside its label.
      const isEmpty =
        cells.length > 1
          ? cells.slice(1).every((c) => c.trim().length === 0)
          : cells[0].trim().length === 0;
      const isHeader = cells.some((c) => /^\*\*.+\*\*$/.test(c.trim()));
      if (!isEmpty && !isHeader) {
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
    // Having a list at all is the step being done; ticking things off is a
    // separate activity that happens the night before, not while planning.
    return {
      state: ratio >= 1 ? "complete" : "started",
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

  // These notes hold a list. Once the list has entries the note has done its
  // job, so it reports complete — leaving it permanently amber meant the
  // dashboard could never be finished, however much of the trip was booked.
  // A budget is done when the three things every trip costs money on are
  // accounted for. Any one filled row used to finish it, so a trip with a
  // flight priced and nowhere to sleep read as fully budgeted.
  if (id === "budget") {
    if (s.tableRows <= 0 && s.proseWords === 0) return EMPTY;
    const covered = coveredCategories(body);
    // Budgeting something inessential — shopping, say — is still a start.
    if (covered.size === 0 && s.tableRows <= 0) {
      return s.proseWords > 0
        ? { state: "started", detail: "Notes only", ratio: null }
        : EMPTY;
    }
    const ratio = covered.size / BUDGET_ESSENTIALS.length;
    const missing = BUDGET_ESSENTIALS.filter((c) => !covered.has(c));
    return {
      state: ratio >= 1 ? "complete" : "started",
      detail:
        missing.length === 0
          ? `${s.tableRows} line${s.tableRows === 1 ? "" : "s"}`
          : `no ${missing.map(shortName).join(", no ")} yet`,
      ratio,
    };
  }

  if (id === "accommodation" || id === "transport") {
    const noun = id === "transport" ? "leg" : "booking";
    if (s.tableRows <= 0 && s.proseWords === 0) return EMPTY;
    if (s.tableRows <= 0) return { state: "started", detail: "Notes only", ratio: null };
    return {
      state: "complete",
      detail: `${s.tableRows} ${noun}${s.tableRows === 1 ? "" : "s"}`,
      ratio: null,
    };
  }

  if (id === "food") {
    // The embed is the whole point of the note: it lists the city's restaurants
    // from Food Spot, and there is nothing further to fill in by hand.
    if (s.hasFoodSpotBlock) {
      return {
        state: "complete",
        detail: s.tableRows > 0 ? `Food Spot · ${s.tableRows} booked` : "Food Spot embed",
        ratio: null,
      };
    }
    if (s.tableRows > 0) {
      return { state: "complete", detail: `${s.tableRows} booked`, ratio: null };
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
