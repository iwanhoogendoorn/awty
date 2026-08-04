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
const OWNED_HEADINGS = ["notes", "attachments", "receipt", "outbound", "return", "itinerary"];

const FENCE = /^\s*(```|~~~)/;

/**
 * Walks a note, saying which lines sit inside a code fence.
 *
 * Both parsers below look for `##` at the start of a line, and a fenced block
 * of markdown examples is exactly where `## Attachments` appears without being
 * a heading. Treating one as a section boundary truncated everything after it.
 */
function* scanLines(content: string): Generator<{ line: string; fenced: boolean }> {
  let fenced = false;
  // Without this the YAML block is read as prose above the first heading, and
  // whatever is kept gets written back into the body — growing on every save.
  for (const line of stripFrontmatter(content).split("\n")) {
    if (FENCE.test(line)) {
      // The fence markers are content in their own right.
      yield { line, fenced: true };
      fenced = !fenced;
      continue;
    }
    yield { line, fenced };
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
export function customSections(content: string): string {
  const kept: string[] = [];
  let keeping = false;
  let seenHeading = false;
  let inPreambleTable = false;
  let preambleTableStarted = false;
  let preambleTableDone = false;

  for (const { line, fenced } of scanLines(content)) {
    if (!fenced) {
      const heading = /^##\s+(.+?)\s*$/.exec(line);
      if (heading) {
        seenHeading = true;
        keeping = !OWNED_HEADINGS.includes(heading[1].trim().toLowerCase());
        if (keeping) kept.push(line);
        continue;
      }
      // A top-level heading is the note's title. It ends any section, but it
      // does not end the preamble — it is what the preamble starts with.
      if (/^#\s/.test(line)) {
        keeping = false;
        continue;
      }

      // The generated details table is the first run of table rows, and it
      // ends at the blank line after it. Skipping blank lines without ending
      // it swallowed a second, hand-written table further down as well.
      if (!seenHeading && !preambleTableDone) {
        if (line.trimStart().startsWith("|")) {
          if (!inPreambleTable && !preambleTableStarted) {
            inPreambleTable = true;
            preambleTableStarted = true;
          }
          if (inPreambleTable) continue;
        } else if (inPreambleTable) {
          inPreambleTable = false;
          preambleTableDone = true;
          if (line.trim() === "") continue;
        }
      }
    }

    if (keeping || !seenHeading) kept.push(line);
  }

  return kept.join("\n").trim();
}
