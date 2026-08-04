/**
 * Splitting a note's YAML block from its body.
 *
 * Every parser that walks a note has to skip this first, or the YAML gets
 * treated as prose — and a parser whose output is written back then copies the
 * frontmatter into the body, again on every save.
 */
export function stripFrontmatter(source: string): string {
  if (!source.startsWith("---")) return source;
  const end = source.indexOf("\n---", 3);
  if (end === -1) return source;
  // A note whose closing "---" is the last line has no newline after it.
  const newline = source.indexOf("\n", end + 1);
  return newline === -1 ? "" : source.slice(newline + 1);
}
