/**
 * The bits of a trip worth keeping.
 *
 * Everything else this plugin stores is logistics: what it cost, when it left,
 * where it dropped you. None of that is why anybody goes anywhere. A year on,
 * the useful record is not that the ferry was €25.40 — it is that somebody fell
 * asleep on the deck coming back.
 *
 * So: a short line, and the day it happened on. Nothing more, because a form
 * with six boxes is a form nobody fills in on the evening they get home, and an
 * unwritten memory is the one thing here that cannot be reconstructed later
 * from a receipt.
 *
 * Kept free of Obsidian so the ordering and the rendering can be checked.
 */

export interface Moment {
  /**
   * What to call it, when it is a story rather than a line.
   *
   * Optional: "Zaara fell asleep on the deck" needs no headline, and asking for
   * one would turn a note you dash off into a small writing assignment. But a
   * long one needs something to be folded away under, and putting the title in
   * the text itself — which is what people do when there is no box for it —
   * means the list has nothing to show but the first forty words.
   */
  title: string;
  /**
   * ISO date it happened, when it was a day rather than the whole week.
   *
   * Optional on purpose. "The sunsets" belongs to the trip, not to the 21st,
   * and forcing a date on it would mean inventing one.
   */
  date: string;
  text: string;
}

export function emptyMoment(date = ""): Moment {
  return { date, title: "", text: "" };
}

/** Frontmatter moments are loose records; this is the only place that shape is known. */
export function readMoments(value: unknown): Moment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      // A hand-written list of plain strings is a perfectly reasonable thing
      // to find here, and refusing it would lose what somebody typed.
      if (typeof raw === "string") return { date: "", title: "", text: raw.trim() };
      const moment = raw as Record<string, unknown>;
      const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
      return { date: str(moment?.date), title: str(moment?.title), text: str(moment?.text) };
    })
    .filter((moment) => moment.text);
}

/** Rows with something written in them. A blank one is a row you started. */
export function keepMoments(moments: Moment[]): Moment[] {
  return moments.filter((moment) => moment.text.trim());
}

/** Frontmatter-friendly form: the date only when there is one. */
export function momentsToFrontmatter(moments: Moment[]): Record<string, string>[] {
  return keepMoments(moments).map((moment) => {
    const out: Record<string, string> = {};
    if (moment.date) out.date = moment.date;
    if (moment.title) out.title = moment.title;
    out.text = moment.text;
    return out;
  });
}

/**
 * By date, with the undated ones last.
 *
 * They belong to the whole trip rather than to a day in it, and an empty string
 * sorts before every real date — which would put "the sunsets, every night" at
 * the top, above the day you arrived.
 */
export function orderMoments(moments: Moment[]): Moment[] {
  return [...moments].sort((a, b) =>
    a.date ? (b.date ? a.date.localeCompare(b.date) : -1) : b.date ? 1 : 0,
  );
}

/** What happened on one day of the trip. */
export function momentsOn(moments: Moment[], date: string): Moment[] {
  return date ? keepMoments(moments).filter((moment) => moment.date === date) : [];
}

/** The ones that belong to the trip rather than to any single day. */
export function undatedMoments(moments: Moment[]): Moment[] {
  return keepMoments(moments).filter((moment) => !moment.date);
}

/**
 * A moment's text, ready to be rendered as markdown.
 *
 * People paste these in. What they paste has the shape they gave it — a line
 * break where they pressed return — and markdown's rule that a single newline
 * is just a space turned a story with air in it into one unbroken slab. So
 * every break is kept as a break, and runs of blank lines are flattened to one
 * so pasted text does not arrive with holes in it.
 */
export function momentMarkdown(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .split("\n")
    .filter((line, i, all) => line !== "" || (i > 0 && i < all.length - 1))
    .join("\n\n")
    .trim();
}

/**
 * A title written as the first bold line of the text, pulled out into its own.
 *
 * Which is what everybody does when there is no box for it — a bold line, a
 * blank line, then the story. Left there it is not a title as far as anything
 * here is concerned: the list has nothing to fold the rest away under and shows
 * forty words of the opening instead. Offered rather than applied, because a
 * bold opening line is sometimes just an emphatic first sentence.
 */
export function liftTitle(moment: Moment): Moment | null {
  if (moment.title.trim()) return null;
  const text = momentMarkdown(moment.text);
  const [first, ...rest] = text.split("\n\n");
  const bold = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/.exec(first ?? "");
  // A title with nothing under it is the whole memory, and taking it out would
  // leave an entry that is all name and no content.
  if (!bold || rest.length === 0) return null;
  const title = bold[1].trim();
  // A whole paragraph in bold is emphasis, not a heading.
  if (!title || title.length > 80) return null;
  return { ...moment, title, text: rest.join("\n\n") };
}

/** Longer than a glance. The point at which a list needs folding rather than showing. */
export const LONG_MOMENT = 180;

/**
 * The line that stands for a moment in a list.
 *
 * Its title if it has one; otherwise its opening, cut at a sentence where there
 * is one to cut at, because a story sliced mid-clause reads as broken rather
 * than as abridged.
 */
export function momentSummary(moment: Moment, max = 90): string {
  const title = moment.title.trim();
  if (title) return title;
  const text = moment.text.replace(/\s*\n+\s*/g, " ").trim();
  if (text.length <= max) return text;
  const stop = text.slice(0, max).lastIndexOf(". ");
  return stop > max / 2 ? text.slice(0, stop + 1) : `${text.slice(0, max).trimEnd()}…`;
}

/** Whether this one should arrive folded away rather than laid out in full. */
export function isLongMoment(moment: Moment): boolean {
  return Boolean(moment.title.trim()) || moment.text.trim().length > LONG_MOMENT;
}

/**
 * The moments as a markdown list in the note body.
 *
 * Written out so they survive the plugin being uninstalled — which matters more
 * here than anywhere else in this codebase. A booking that outlives its reader
 * is a curiosity; a memory that does not is simply gone.
 */
export function momentList(moments: Moment[], label: (date: string) => string): string[] {
  const out: string[] = [];
  for (const moment of orderMoments(keepMoments(moments))) {
    const when = moment.date ? label(moment.date) : "";
    const title = moment.title.trim();

    // A titled memory is a piece of writing, and a piece of writing crammed
    // into a bullet is unreadable in the note it is supposed to be preserved
    // in. It gets a heading and its own paragraphs; a one-liner stays a bullet,
    // because a heading over six words is a heading pretending to be an essay.
    if (title) {
      if (out.length > 0) out.push("");
      out.push(`### ${title}`);
      if (when) out.push("", `*${when}*`);
      // Each of the writer's own breaks is a paragraph in the note, so what
      // comes out reads the way it was typed.
      const paras = momentMarkdown(moment.text).split("\n\n");
      out.push("", ...paras.flatMap((para, i) => (i ? ["", para] : [para])));
      continue;
    }

    // Newlines inside a bullet would break the list; a memory typed as a small
    // paragraph stays one bullet.
    const text = moment.text.replace(/\s*\n+\s*/g, " ").trim();
    out.push(when ? `- **${when}** — ${text}` : `- ${text}`);
  }
  return out;
}
