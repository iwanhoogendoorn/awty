import type { TripKind } from "../types";
import { stripFrontmatter } from "../util/frontmatter";

/**
 * Works out how much to pack from the length of the trip.
 *
 * The naive answer — one of everything per day — falls apart past a fortnight:
 * nobody carries 21 pairs of socks. Beyond `LAUNDRY_THRESHOLD` days we assume
 * one wash, so quantities are sized to the longest stretch between washes
 * rather than to the whole trip.
 */
const LAUNDRY_THRESHOLD = 12;

export interface PackingItem {
  label: string;
  /** Null for things you pack one of regardless of length. */
  quantity: number | null;
}

export interface PackingSection {
  title: string;
  items: PackingItem[];
}

export interface PackingPlan {
  days: number;
  assumesLaundry: boolean;
  sections: PackingSection[];
}

/** Days of clothing to actually carry, accounting for a mid-trip wash. */
export function effectiveDays(days: number): number {
  if (days <= LAUNDRY_THRESHOLD) return days;
  return Math.ceil(days / 2) + 2;
}

function times(n: number, min = 1): number {
  return Math.max(min, Math.round(n));
}

export function buildPackingPlan(days: number, kind: TripKind): PackingPlan {
  const length = Math.max(1, days);
  const assumesLaundry = length > LAUNDRY_THRESHOLD;
  const base = effectiveDays(length);

  // A concert or a day out needs a bag, not a suitcase.
  if (kind === "day-trip" || kind === "concert" || kind === "event") {
    return {
      days: length,
      assumesLaundry: false,
      sections: [
        {
          title: "Essentials",
          items: [
            { label: "ID / travel card", quantity: null },
            { label: "Phone + charger", quantity: null },
            { label: "Power bank", quantity: null },
            { label: "Tickets (printed or on phone)", quantity: null },
            { label: "Cash / card", quantity: null },
            { label: "Water bottle", quantity: null },
            { label: "Layer for the evening", quantity: null },
          ],
        },
      ],
    };
  }

  const clothes: PackingItem[] = [
    { label: "Underwear", quantity: base + 1 },
    { label: "Socks", quantity: base + 1 },
    { label: "T-shirts / tops", quantity: base },
    { label: "Trousers / jeans", quantity: times(base / 4) },
    { label: "Sleepwear", quantity: times(base / 5) },
    { label: "Jumper / hoodie", quantity: times(base / 6) },
  ];

  if (length >= 3) clothes.push({ label: "Shorts", quantity: times(base / 4) });
  if (length >= 4) clothes.push({ label: "Smart outfit", quantity: 1 });
  if (kind === "business") {
    clothes.push({ label: "Shirts (work)", quantity: times(base / 1.5) });
    clothes.push({ label: "Blazer", quantity: 1 });
  }
  clothes.push({ label: "Swimwear", quantity: length >= 5 ? 2 : 1 });
  clothes.push({ label: "Jacket / coat", quantity: 1 });
  clothes.push({ label: "Walking shoes", quantity: 1 });
  if (length >= 4) clothes.push({ label: "Sandals / flip-flops", quantity: 1 });

  const sections: PackingSection[] = [
    {
      title: "Documents",
      items: [
        { label: "Passport / ID", quantity: null },
        { label: "Visa / travel authorisation", quantity: null },
        { label: "Travel insurance documents", quantity: null },
        { label: "Tickets / boarding passes", quantity: null },
        { label: "Accommodation confirmations", quantity: null },
        { label: "Driving licence", quantity: null },
        { label: "Emergency contacts", quantity: null },
      ],
    },
    { title: "Clothes", items: clothes },
    {
      title: "Tech",
      items: [
        { label: "Phone + charger", quantity: null },
        { label: "Laptop / tablet + charger", quantity: null },
        { label: "Power bank", quantity: null },
        { label: "Travel adapter", quantity: length >= 7 ? 2 : 1 },
        { label: "Headphones", quantity: null },
        { label: "Camera + memory card", quantity: null },
      ],
    },
    {
      title: "Toiletries",
      items: [
        { label: "Toothbrush + toothpaste", quantity: null },
        { label: "Shampoo / body wash", quantity: null },
        { label: "Deodorant", quantity: null },
        { label: "Sunscreen", quantity: null },
        { label: "Razor / shaving kit", quantity: null },
        { label: "Medication", quantity: null },
        { label: "First aid kit", quantity: null },
      ],
    },
    {
      title: "Misc",
      items: [
        { label: "Travel pillow", quantity: null },
        { label: "Eye mask + earplugs", quantity: null },
        { label: "Water bottle", quantity: null },
        { label: "Luggage locks", quantity: null },
        { label: "Day bag", quantity: null },
        { label: "Local currency", quantity: null },
      ],
    },
  ];

  if (assumesLaundry) {
    sections[sections.length - 1].items.push(
      { label: "Laundry detergent / sheets", quantity: null },
      { label: "Laundry bag", quantity: null },
    );
  }

  return { days: length, assumesLaundry, sections };
}

/** Renders the plan as markdown checkboxes with quantities. */
export function renderPackingPlan(plan: PackingPlan): string {
  const out: string[] = [];

  out.push(
    plan.assumesLaundry
      ? `> ${plan.days} days — quantities assume one laundry run mid-trip.`
      : `> Quantities calculated for ${plan.days} day${plan.days === 1 ? "" : "s"}.`,
    "",
  );

  for (const section of plan.sections) {
    out.push(`## ${section.title}`);
    for (const item of section.items) {
      out.push(`- [ ] ${item.label}${item.quantity !== null ? ` ×${item.quantity}` : ""}`);
    }
    out.push("");
  }
  return out.join("\n");
}

/**
 * Whatever someone wrote in a packing note that is not a tick box.
 *
 * Saving the list rebuilds the body from the tick boxes alone, so a paragraph
 * of instructions, a quote or a link typed into the note simply vanished. This
 * gathers it back, grouped by the heading it was written under, so the rebuild
 * can put it where it was.
 */
/** A run of hand-written lines, tied to the tick box it was written under. */
export interface AnchoredProse {
  /** Lowercased label of the item above it, or null for the section's top. */
  anchor: string | null;
  lines: string[];
}

export interface PackingExtras {
  /** Lines above the first heading. */
  preamble: string[];
  /** Heading title -> the prose written under it, in order, with anchors. */
  bySection: Map<string, AnchoredProse[]>;
}

/** The generated callout, which is rewritten and must not accumulate. */
const GENERATED_CALLOUT = /^>\s*(\d+ days? —|Quantities )/;

export function readPackingExtras(content: string): PackingExtras {
  const extras: PackingExtras = { preamble: [], bySection: new Map() };
  let section: string | null = null;
  // The tick box a prose line sits under. Re-emitting all prose below all
  // items moved an instruction written beside one item to the section's end.
  let anchor: string | null = null;
  let fence: { char: string; length: number } | null = null;

  // The frontmatter is preserved separately by the writer. Reading it as
  // preamble wrote a second copy into the body, and a third on the next save.
  for (const raw of stripFrontmatter(content).split("\n")) {
    const line = raw.trim();

    // Fences pair by character and length, as in noteSections: a four-backtick
    // block showing a three-backtick example must not flip the state inside.
    const marker = /^(`{3,}|~{3,})/.exec(line);
    if (marker) {
      const char = marker[1][0];
      const length = marker[1].length;
      if (!fence) fence = { char, length };
      else if (char === fence.char && length >= fence.length && line.split("").every((c) => c === char))
        fence = null;
      push(raw);
      continue;
    }
    if (!fence) {
      if (/^#\s/.test(line)) continue;
      const heading = /^##\s+(.+)$/.exec(line);
      if (heading) {
        section = heading[1].trim();
        anchor = null;
        if (!extras.bySection.has(section)) extras.bySection.set(section, []);
        continue;
      }
      const task = /^[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
      if (task) {
        anchor = task[2].replace(/\s*×\s*\d+$/, "").trim().toLowerCase() || anchor;
        continue;
      }
      if (GENERATED_CALLOUT.test(line)) continue;
    }
    push(raw);
  }

  function push(raw: string): void {
    if (section === null) {
      extras.preamble.push(raw);
      return;
    }
    const runs = extras.bySection.get(section)!;
    const last = runs[runs.length - 1];
    if (last && last.anchor === anchor) last.lines.push(raw);
    else runs.push({ anchor, lines: [raw] });
  }

  // Trailing blank lines are formatting, not content.
  trim(extras.preamble);
  for (const runs of extras.bySection.values()) {
    for (const run of runs) trim(run.lines);
    // A run that was only blank lines says nothing.
    for (let i = runs.length - 1; i >= 0; i -= 1) {
      if (runs[i].lines.length === 0) runs.splice(i, 1);
    }
  }
  return extras;
}

function trim(lines: string[]): void {
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
}
