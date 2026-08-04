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

/** The text under one `## Heading`, up to the next heading. */
export function sectionText(content: string, heading: string): string {
  const lines = content.split("\n");
  const wanted = heading.trim().toLowerCase();
  const out: string[] = [];
  let inside = false;

  for (const line of lines) {
    const found = /^##\s+(.+?)\s*$/.exec(line);
    if (found) {
      inside = found[1].trim().toLowerCase() === wanted;
      continue;
    }
    if (/^#\s/.test(line)) {
      inside = false;
      continue;
    }
    if (inside) out.push(line);
  }
  return out.join("\n").trim();
}

export function customSections(content: string): string {
  const lines = content.split("\n");
  const kept: string[] = [];
  let keeping = false;

  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      keeping = !OWNED_HEADINGS.includes(heading[1].trim().toLowerCase());
      if (keeping) kept.push(line);
      continue;
    }
    // A top-level heading is the note's title; it ends any section.
    if (/^#\s/.test(line)) {
      keeping = false;
      continue;
    }
    if (keeping) kept.push(line);
  }

  return kept.join("\n").trim();
}
