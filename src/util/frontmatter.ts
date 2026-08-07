/**
 * Splitting a note's YAML block from its body.
 *
 * Every parser that walks a note has to skip this first, or the YAML gets
 * treated as prose — and a parser whose output is written back then copies the
 * frontmatter into the body, again on every save.
 */

/** A line that is exactly `---`, allowing a Windows carriage return. */
function isDelimiter(line: string): boolean {
  return line === "---" || line === "---\r";
}

/**
 * Whether a block between two `---` lines is plausibly YAML.
 *
 * A note can open with a horizontal rule, and a paragraph between two rules is
 * not frontmatter — stripping it deleted the paragraph. Frontmatter is keys,
 * list items and blanks; a line of prose is none of those.
 *
 * Keys are matched at any indentation. Requiring column zero meant a nested
 * block — `legs:` with a flight under it, or `quotes:` with a price — failed
 * the check, the frontmatter was left in place as prose, and the next save
 * copied the whole YAML block into the body of the note.
 */
function looksLikeYaml(lines: string[]): boolean {
  return lines.every(
    (raw) =>
      raw.trim() === "" ||
      /^\s*#/.test(raw) ||
      /^\s*-\s/.test(raw) ||
      /^\s*[^\s:][^:]*:(\s|$)/.test(raw),
  );
}

/** Index of the line closing the frontmatter block, or -1 when there is none. */
function frontmatterEnd(lines: string[]): number {
  if (lines.length === 0 || !isDelimiter(lines[0])) return -1;
  // The close has to be a delimiter line of its own. Searching for the string
  // "\n---" matched "---not-a-delimiter" and cut the note in the wrong place.
  const close = lines.findIndex((line, index) => index > 0 && isDelimiter(line));
  if (close === -1) return -1;
  return looksLikeYaml(lines.slice(1, close)) ? close : -1;
}

export function stripFrontmatter(source: string): string {
  const lines = source.split("\n");
  const close = frontmatterEnd(lines);
  return close === -1 ? source : lines.slice(close + 1).join("\n");
}

/**
 * The YAML block and the body, split apart.
 *
 * Rewriting a generated note means replacing the body and putting back exactly
 * the frontmatter Obsidian serialised — re-serialising it here would be a
 * second opinion on someone else's format.
 */
export function splitFrontmatter(source: string): { frontmatter: string; body: string } {
  const lines = source.split("\n");
  const close = frontmatterEnd(lines);
  if (close === -1) return { frontmatter: "", body: source };
  return {
    frontmatter: lines.slice(0, close + 1).join("\n"),
    body: lines.slice(close + 1).join("\n"),
  };
}
