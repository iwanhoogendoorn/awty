import type { FlightLeg } from "./legs";

/**
 * Reads back the leg tables the plugin writes into a booking note.
 *
 * Direct flights briefly stored no `legs` in frontmatter, so the outbound
 * arrival lived only in the note body — which meant it could not be read, and
 * the journey had to be inferred from the booking's end. It is our own table,
 * so parsing it is exact rather than guesswork, and it lets those bookings be
 * repaired instead of written off.
 *
 * Columns: Leg | Airline | Flight | From | To | Departs | Arrives
 */
export function parseLegTable(content: string, heading: string): FlightLeg[] {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (start === -1) return [];

  const legs: FlightLeg[] = [];

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (/^#{1,2}\s/.test(line)) break;
    if (!line.startsWith("|")) continue;

    const cells = line
      .slice(1, line.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((c) => c.trim());
    if (cells.length < 7) continue;
    // Skip the header and its separator.
    if (!/^\d+$/.test(cells[0])) continue;

    const [, operator, number, from, to, departs, arrives] = cells;
    const departure = /^(\d{4}-\d{2}-\d{2})?\s*(\d{2}:\d{2})?/.exec(departs) ?? [];
    const date = departure[1] ?? "";

    // "12:35 (+1)" means the next day.
    const overnight = /\(\+1\)/.test(arrives);
    const arrivalTime = /(\d{2}:\d{2})/.exec(arrives)?.[1] ?? "";

    legs.push({
      operator,
      number,
      from,
      to,
      date,
      depTime: departure[2] ?? "",
      arrDate: overnight ? nextDay(date) : date,
      arrTime: arrivalTime,
    });
  }

  return legs;
}

function nextDay(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}
