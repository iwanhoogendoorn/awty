/**
 * Pure itinerary parsing, kept free of any Obsidian import so it can be tested
 * outside the app.
 */
/** A day heading exists but nothing has been written under it. */
export function emptyDayDates(content: string): Set<string> {
  const out = new Set<string>();
  const lines = content.split("\n");
  let current: string | null = null;
  let hasContent = false;

  const flush = () => {
    if (current && !hasContent) out.add(current);
  };

  for (const raw of lines) {
    const line = raw.trim();
    const heading = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(line);
    if (heading) {
      flush();
      current = heading[1];
      hasContent = false;
      continue;
    }
    if (!current) continue;
    if (/^#{1,2}\s/.test(line)) {
      flush();
      current = null;
      continue;
    }
    // Sub-headings are scaffolding; anything else is real content.
    if (line.length === 0 || /^###\s/.test(line) || /^_.*_$/.test(line)) continue;
    hasContent = true;
  }
  flush();
  return out;
}

