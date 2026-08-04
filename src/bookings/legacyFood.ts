/**
 * Reading the hand-typed table that booking a table used to write.
 *
 * Before a restaurant was a booking, the Food note's Booked section held rows
 * typed straight into the note. That section is generated now, so those rows
 * have to become bookings or be destroyed by the first sync.
 *
 * Kept free of Obsidian so it can be tested.
 */
export interface LegacyTableBooking {
  date: string;
  time: string;
  place: string;
  bookedBy: string;
  notes: string;
}

/** Rows under `## Booked` that a person typed, not ones the plugin wrote. */
export function readLegacyFoodTable(content: string): LegacyTableBooking[] {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => line.trim().toLowerCase() === "## booked");
  if (start === -1) return [];

  const out: LegacyTableBooking[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (/^#{1,2}\s/.test(line)) break;
    // Anything the plugin generated says so, and is not a person's typing.
    if (line.startsWith("_Generated from")) return [];
    if (!line.startsWith("|")) continue;

    const cells = line
      .slice(1, line.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((c) => c.trim());
    if (cells.length < 3) continue;
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue;
    // The header row names its own columns.
    if (/^date$/i.test(cells[0])) continue;

    const [date, time, place, bookedBy, notes] = cells;
    if (!place) continue;
    out.push({
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
      time: /^\d{2}:\d{2}$/.test(time ?? "") ? time : "",
      place,
      bookedBy: bookedBy ?? "",
      notes: (notes ?? "").replace(/\\\|/g, "|"),
    });
  }
  return out;
}
