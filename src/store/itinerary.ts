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


/**
 * The prose already written under a day, per slot, excluding the activity
 * links the plugin generates.
 *
 * Loading this back into the editor is what makes replacing a day lossless:
 * anything typed straight into the note is carried through rather than
 * overwritten.
 */
export function readDaySections(
  content: string,
  date: string,
  /**
   * Note names the plugin itself wrote as `- [[link]]` lines under this day.
   * Only those are dropped: shape alone cannot tell a generated activity link
   * from `- [[Personal note]]` typed by hand, and dropping both deleted the
   * hand-written one on every re-plan.
   */
  generatedLinks: ReadonlySet<string> = new Set(),
): { morning: string; afternoon: string; evening: string } {
  const out = { morning: "", afternoon: "", evening: "" };
  const lines = content.split("\n");

  let inDay = false;
  let slot: keyof typeof out | null = null;
  const collected: Record<string, string[]> = { morning: [], afternoon: [], evening: [] };

  for (const raw of lines) {
    const line = raw.trim();

    const dayHeading = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(line);
    if (dayHeading) {
      if (inDay) break;
      inDay = dayHeading[1] === date;
      slot = null;
      continue;
    }
    if (!inDay) continue;
    if (/^#{1,2}\s/.test(line)) break;

    const slotHeading = /^###\s+(Morning|Afternoon|Evening)\s*$/i.exec(line);
    if (slotHeading) {
      slot = slotHeading[1].toLowerCase() as keyof typeof out;
      continue;
    }
    if (!slot) continue;

    // Generated activity links are rebuilt from the bookings, not carried.
    const link = /^-\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s*$/.exec(line);
    if (link && generatedLinks.has(link[1].trim())) continue;

    // Blank lines and indentation are the shape of what someone wrote. They
    // used to be stripped, which collapsed paragraphs and lists into one block.
    collected[slot].push(raw);
  }

  for (const key of Object.keys(out) as (keyof typeof out)[]) {
    out[key] = collected[key].join("\n").trim();
  }
  return out;
}
