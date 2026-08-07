import { FOODSPOT_COUNTRIES } from "../data/countries";
import type { SubNoteId, AwtySettings, TripDraft } from "../types";
import {
  SUB_NOTE_LABELS,
  joinPlaces,
  kindDef,
  tripCities,
  tripCountries,
  tripStops,
  type TripStop,
} from "../types";
import { datesInRange, daysBetween, formatDateRange, formatDuration } from "../util/dates";
import { buildPackingPlan, renderPackingPlan } from "./packing";

export interface TemplateContext {
  draft: TripDraft;
  settings: AwtySettings;
  /** Wiki link back to the trip note, already formatted. */
  tripLink: string;
  /** Whether the Food Spot plugin is actually enabled in this vault. */
  foodSpotAvailable: boolean;
}

type Lines = string | Lines[];

function lines(...parts: Lines[]): string {
  return parts.flat(Infinity as 1).join("\n");
}

/**
 * Builds the ```foodspot``` block.
 *
 * Food Spot parses `key: value` lines and filters with a lowercased exact-string
 * compare on country and city, so the values here must be the same spellings its
 * own pickers produce — which is why the country dataset is copied from that
 * plugin rather than invented. Countries Food Spot doesn't know about get no
 * `country:` line at all; emitting one could only ever match nothing.
 */
export function foodSpotBlock(ctx: TemplateContext): string {
  const { draft, settings } = ctx;
  const stops = tripStops(draft).filter((stop) => stop.city || stop.country);

  // One block per stop: Food Spot filters on a single city, so a trip through
  // several places needs a shortlist for each rather than one that can only
  // ever show the first.
  const blocks: string[] = (
    stops.length > 0 ? stops : [{ country: draft.country, city: draft.city }]
  ).map((stop: TripStop) => {
    const body: string[] = [`view: ${settings.foodSpotView}`];
    if (stop.country && FOODSPOT_COUNTRIES.has(stop.country)) body.push(`country: ${stop.country}`);
    if (stop.city) body.push(`city: ${stop.city}`);
    body.push("status: want-to-try");
    const block = lines("```foodspot", body, "```");
      return stops.length > 1 && stop.city ? lines(`### ${stop.city}`, "", block) : block;
  });
  return blocks.join("\n\n");
}

function foodBody(ctx: TemplateContext): string {
  const { draft, settings } = ctx;
  const place = joinPlaces(tripCities(draft)) || joinPlaces(tripCountries(draft)) || draft.title;
  const head = lines(`# Food — ${place}`, "", "## Want to try", "");

  if (!settings.foodSpotEnabled) {
    return lines(head, "- [ ] ", "", "## Been there", "", "- [ ] ", "");
  }
  if (!ctx.foodSpotAvailable) {
    return lines(
      head,
      "> [!info] Food Spot is not enabled in this vault.",
      "> Enable the Food Spot plugin and this block will render your shortlist for",
      `> ${place}. Until then it stays here as plain text.`,
      "",
      foodSpotBlock(ctx),
      "",
      "## Notes",
      "",
    );
  }
  return lines(
    head,
    foodSpotBlock(ctx),
    "",
    "## Booked",
    "",
    "_Nothing booked yet. Use Book a table._",
    "",
    "## Notes",
    "",
  );
}

function itineraryBody(ctx: TemplateContext): string {
  const { draft } = ctx;
  const def = kindDef(draft.kind);
  const days = datesInRange(draft.startDate, def.singleDay ? draft.startDate : draft.endDate, 60);
  const dayBlocks = days.flatMap((date) => [
    `## ${date}`,
    "",
    "### Morning",
    "",
    "### Afternoon",
    "",
    "### Evening",
    "",
  ]);
  return lines(
    `# Itinerary — ${draft.title}`,
    "",
    `> ${formatDateRange(draft.startDate, draft.endDate)} · ${formatDuration(draft.startDate, draft.endDate)}`,
    "",
    dayBlocks.length ? dayBlocks : ["_Add days with the “Add itinerary day” command._", ""],
  );
}

function packingBody(ctx: TemplateContext): string {
  const { draft } = ctx;
  const def = kindDef(draft.kind);
  const days = def.singleDay ? 1 : daysBetween(draft.startDate, draft.endDate);
  const plan = buildPackingPlan(days, draft.kind);
  return lines(`# Packing List — ${draft.title}`, "", renderPackingPlan(plan));
}

function accommodationBody(ctx: TemplateContext): string {
  return lines(
    `# Accommodation — ${ctx.draft.title}`,
    "",
    "| Check-in | Check-out | Property | Address | Confirmation | Price |",
    "|----------|-----------|----------|---------|--------------|-------|",
    "|          |           |          |         |              |       |",
    "",
    "## Notes",
    "",
  );
}

function transportBody(ctx: TemplateContext): string {
  return lines(
    `# Transport — ${ctx.draft.title}`,
    "",
    "## Outbound",
    "",
    "| Date | Time | From | To | Carrier | Reference | Seat |",
    "|------|------|------|----|---------|-----------|------|",
    "|      |      |      |    |         |           |      |",
    "",
    "## Return",
    "",
    "| Date | Time | From | To | Carrier | Reference | Seat |",
    "|------|------|------|----|---------|-----------|------|",
    "|      |      |      |    |         |           |      |",
    "",
    "## Local transport",
    "",
  );
}

function budgetBody(ctx: TemplateContext): string {
  return lines(
    `# Budget — ${ctx.draft.title}`,
    "",
    "## Planned",
    "",
    "| Category | Budgeted | Actual | Notes |",
    "|----------|----------|--------|-------|",
    "| Transport | | | |",
    "| Accommodation | | | |",
    "| Food & drink | | | |",
    "| Activities | | | |",
    "| Shopping | | | |",
    "| Misc | | | |",
    "| **Total** | | | |",
    "",
    "## Expenses",
    "",
    "| Date | Description | Amount | Category |",
    "|------|-------------|--------|----------|",
    "|      |             |        |          |",
    "",
  );
}

function eventDetailsBody(ctx: TemplateContext): string {
  const { draft } = ctx;
  return lines(
    `# ${draft.title}`,
    "",
    `| | |`,
    `|---|---|`,
    `| **Date** | ${draft.startDate} |`,
    `| **Venue** | ${draft.venue || "_TBC_"} |`,
    `| **City** | ${joinPlaces(tripCities(draft)) || "_TBC_"} |`,
    `| **Doors** | |`,
    `| **Start** | |`,
    `| **Tickets** | |`,
    `| **Booking reference** | |`,
    `| **Seat / standing** | |`,
    "",
    "## Line-up",
    "",
    "## Getting there",
    "",
    "## Notes",
    "",
  );
}

/**
 * The empty Price Watch note.
 *
 * Deliberately thin: everything below the heading is generated from the quotes
 * in the frontmatter, so writing a placeholder table here would only be
 * something for the first save to throw away.
 */
function pricesBody(ctx: TemplateContext): string {
  const { draft } = ctx;
  return lines(
    `# ${SUB_NOTE_LABELS.prices} — ${draft.title}`,
    "",
    // A table, not a paragraph: everything above the first heading that is not
    // the title or a generated table is treated as hand-written and preserved,
    // so a generated paragraph here would reappear on every save.
    "| | |",
    "|---|---|",
    `| **Trip** | ${ctx.tripLink} |`,
    `| **When** | ${formatDateRange(draft.startDate, draft.endDate)} |`,
    `| **Watching** | 0 things |`,
    "",
    "## Estimate",
    "",
    "_No prices checked yet._",
    "",
    "## Watching",
    "",
    "_No prices checked yet._",
    "",
  );
}

const BUILDERS: Record<SubNoteId, (ctx: TemplateContext) => string> = {
  itinerary: itineraryBody,
  packing: packingBody,
  accommodation: accommodationBody,
  transport: transportBody,
  budget: budgetBody,
  food: foodBody,
  prices: pricesBody,
  "event-details": eventDetailsBody,
};

/** Frontmatter `type:` value written into each sub-note. */
const FRONTMATTER_TYPE: Record<SubNoteId, string> = {
  itinerary: "itinerary",
  packing: "packing-list",
  accommodation: "accommodation",
  transport: "transport",
  budget: "budget",
  food: "food",
  prices: "price-watch",
  "event-details": "event-details",
};

export interface SubNoteSpec {
  id: SubNoteId;
  /** File name without the .md extension. */
  fileName: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export function buildSubNote(id: SubNoteId, ctx: TemplateContext): SubNoteSpec {
  return {
    id,
    fileName: SUB_NOTE_LABELS[id],
    frontmatter: { type: FRONTMATTER_TYPE[id], trip: ctx.tripLink },
    body: BUILDERS[id](ctx),
  };
}

/** Body of the trip note itself. Frontmatter is written separately. */
export function buildTripBody(ctx: TemplateContext, subNotes: SubNoteId[]): string {
  const { draft } = ctx;
  const def = kindDef(draft.kind);
  const where = [joinPlaces(tripCities(draft)), joinPlaces(tripCountries(draft))]
    .filter(Boolean)
    .join(", ");

  const meta = [`> **When:** ${formatDateRange(draft.startDate, draft.endDate)}`];
  if (!def.singleDay) meta.push(`> **Duration:** ${formatDuration(draft.startDate, draft.endDate)}`);
  if (where) meta.push(`> **Where:** ${where}`);
  if (def.hasVenue && draft.venue) meta.push(`> **Venue:** ${draft.venue}`);
  meta.push(`> **Kind:** ${def.label}`);

  return lines(
    `# ${draft.title}`,
    "",
    meta,
    "",
    "## Overview",
    "",
    draft.notes.trim() || "_Add trip overview here._",
    "",
    subNotes.length ? ["## Planning", "", subNotes.map((id) => `- [[${SUB_NOTE_LABELS[id]}]]`), ""] : [],
  );
}
