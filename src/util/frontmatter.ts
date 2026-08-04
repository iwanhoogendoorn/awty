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
 */
function looksLikeYaml(lines: string[]): boolean {
  return lines.every(
    (raw) =>
      raw.trim() === "" ||
      /^\s*#/.test(raw) ||
      /^\s*-\s/.test(raw) ||
      /^[^\s:][^:]*:(\s|$)/.test(raw),
  );
}

export function stripFrontmatter(source: string): string {
  const lines = source.split("\n");
  if (lines.length === 0 || !isDelimiter(lines[0])) return source;

  // The close has to be a delimiter line of its own. Searching for the string
  // "\n---" matched "---not-a-delimiter" and cut the note in the wrong place.
  const close = lines.findIndex((line, index) => index > 0 && isDelimiter(line));
  if (close === -1) return source;
  if (!looksLikeYaml(lines.slice(1, close))) return source;

  return lines.slice(close + 1).join("\n");
}
