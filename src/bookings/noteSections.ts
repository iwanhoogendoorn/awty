import { stripFrontmatter } from "../util/frontmatter";

/**
 * Reading and preserving the parts of a booking note.
 *
 * Kept free of Obsidian so it can be tested: saving an edit regenerates the
 * note, and getting this wrong silently destroys what someone typed.
 */

/**
 * Sections the generator owns and will rewrite. Anything else in the note was
 * typed by hand and is carried across an edit untouched — regenerating a note
 * is not a licence to throw away what someone wrote in it.
 */
const OWNED_HEADINGS = [
  "notes",
  "attachments",
  "receipt",
  "outbound",
  "return",
  "itinerary",
  // The rides log's own table. Left off this list it read as somebody's own
  // writing, so re-saving a log wove the previous table back in above the new
  // one — two "## Rides" sections, the stale one still holding a fare that had
  // been removed.
  "rides",
];

/**
 * The Price Watch note is generated the same way a booking note is, from a
 * different set of headings. Passing them in beats a second copy of the fence
 * scanner — getting that wrong is how hand-written prose gets deleted.
 */
export const PRICE_WATCH_HEADINGS = ["estimate", "watching", "history", "screenshots"];

const FENCE = /^\s*(`{3,}|~{3,})/;

/**
 * Walks a note, saying which lines sit inside a code fence.
 *
 * Both parsers below look for `##` at the start of a line, and a fenced block
 * of markdown examples is exactly where `## Attachments` appears without being
 * a heading. Treating one as a section boundary truncated everything after it.
 *
 * Fences pair like markdown says they do: a block opened with four backticks
 * — the standard way to show a three-backtick example — closes only on four
 * or more, and tildes do not close backticks. Treating every ``` as a toggle
 * flipped the state mid-example and everything after read as fenced.
 */
function* scanLines(content: string): Generator<{ line: string; fenced: boolean }> {
  let fence: { char: string; length: number } | null = null;
  // Without stripFrontmatter the YAML block is read as prose above the first
  // heading, and whatever is kept gets written back — growing on every save.
  for (const line of stripFrontmatter(content).split("\n")) {
    const marker = FENCE.exec(line);
    if (marker) {
      const char = marker[1][0];
      const length = marker[1].length;
      if (!fence) {
        fence = { char, length };
        // The fence markers are content in their own right.
        yield { line, fenced: true };
        continue;
      }
      const closes =
        char === fence.char &&
        length >= fence.length &&
        line.trim().split("").every((c) => c === char);
      yield { line, fenced: true };
      if (closes) fence = null;
      continue;
    }
    yield { line, fenced: fence !== null };
  }
}

/** The text under one `## Heading`, up to the next heading. */
export function sectionText(content: string, heading: string): string {
  const wanted = heading.trim().toLowerCase();
  const out: string[] = [];
  let inside = false;

  for (const { line, fenced } of scanLines(content)) {
    if (!fenced) {
      const found = /^##\s+(.+?)\s*$/.exec(line);
      if (found) {
        inside = found[1].trim().toLowerCase() === wanted;
        continue;
      }
      if (/^#\s/.test(line)) {
        inside = false;
        continue;
      }
    }
    if (inside) out.push(line);
  }
  return out.join("\n").trim();
}

/**
 * Everything in a note the generator will not write back.
 *
 * That is every section under a heading it does not own, plus anything typed
 * above the first heading. The generated preamble is only a title and one
 * table, so those two are dropped and the rest of the preamble is kept — a
 * sentence written under the details table is not the plugin's to delete.
 */
/**
 * The generated details table, recognised by its own shape.
 *
 * Every row it writes has a bolded label in the first cell. Treating "the first
 * table in the preamble" as generated destroyed a hand-written table on any
 * note that has no generated one — an expense, for instance, which writes no
 * details table at all.
 */
function isGeneratedTable(rows: string[]): boolean {
  return rows.some((row) => /^\|\s*\*\*[^|]+\*\*\s*\|/.test(row.trim()));
}

export interface KeptParts {
  /** Hand-written text above the first section heading. */
  preamble: string;
  /** Whole sections under headings the generator does not own. */
  sections: string;
}

export function customParts(content: string, owned: readonly string[] = OWNED_HEADINGS): KeptParts {
  const preamble: string[] = [];
  const sections: string[] = [];
  let keeping = false;
  let seenHeading = false;

  for (const { line, fenced } of scanLines(content)) {
    if (!fenced) {
      const heading = /^##\s+(.+?)\s*$/.exec(line);
      if (heading) {
        seenHeading = true;
        keeping = !owned.includes(heading[1].trim().toLowerCase());
        if (keeping) sections.push(line);
        continue;
      }
      // A top-level heading is the note's title. It ends any section, but it
      // does not end the preamble — it is what the preamble starts with.
      if (/^#\s/.test(line)) {
        keeping = false;
        continue;
      }
    }

    if (seenHeading) {
      if (keeping) sections.push(line);
    } else {
      preamble.push(line);
    }
  }

  return {
    preamble: dropGeneratedTable(preamble).join("\n").trim(),
    sections: sections.join("\n").trim(),
  };
}

export function customSections(content: string, owned?: readonly string[]): string {
  const { preamble, sections } = customParts(content, owned);
  return [preamble, sections].filter(Boolean).join("\n\n");
}

/**
 * Rebuilds a note body around what an edit kept.
 *
 * The kept preamble has to go back where it came from — between the generated
 * details and the generated sections. Appending it after them moved a sentence
 * typed under the details table to beneath "## Attachments", where the next
 * edit read it as owned content and deleted it: preserved once, gone twice.
 */
export function weaveKept(generated: string, kept: KeptParts): string {
  let body = generated.trimEnd();
  if (kept.preamble) {
    const at = body.search(/^## /m);
    body =
      at === -1
        ? `${body}\n\n${kept.preamble}`
        : `${body.slice(0, at).trimEnd()}\n\n${kept.preamble}\n\n${body.slice(at)}`;
  }
  if (kept.sections) body = `${body}\n\n${kept.sections}`;
  return body;
}

/** Removes the first table in the preamble, but only if we wrote it. */
function dropGeneratedTable(preamble: string[]): string[] {
  let start = -1;
  let end = -1;
  for (const [index, line] of preamble.entries()) {
    const isRow = line.trimStart().startsWith("|");
    if (isRow && start === -1) start = index;
    if (isRow) end = index;
    else if (start !== -1) break;
  }
  if (start === -1) return preamble;
  if (!isGeneratedTable(preamble.slice(start, end + 1))) return preamble;

  const rest = preamble.slice(end + 1);
  while (rest.length && rest[0].trim() === "") rest.shift();
  return [...preamble.slice(0, start), ...rest];
}
