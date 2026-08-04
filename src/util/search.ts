/**
 * Accent-insensitive ranked matching for the country and city pickers.
 *
 * GeoNames stores the local spelling — Oía, İzmir, Malmö, Reykjavík — but nobody
 * types the accents. Folding both sides means "Oia" finds "Oía" and "Izmir"
 * finds "İzmir", while the stored value keeps its proper spelling.
 */

const FOLD_CACHE = new Map<string, string>();

export function fold(value: string): string {
  const hit = FOLD_CACHE.get(value);
  if (hit !== undefined) return hit;
  const folded = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    // Turkish dotted capital I folds to "i̇" (i + combining dot) under NFD; the
    // diacritic strip above handles it, but ł/ø/đ carry no combining mark.
    .replace(/[łŁ]/g, "l")
    .replace(/[øØ]/g, "o")
    .replace(/[đĐ]/g, "d")
    .replace(/[æÆ]/g, "ae")
    .replace(/[œŒ]/g, "oe")
    .replace(/[ßẞ]/g, "ss")
    .toLowerCase();
  FOLD_CACHE.set(value, folded);
  return folded;
}

/**
 * Prefix matches first, then word-start matches, then anything containing the
 * query. Inputs arrive population-ordered, so ties keep the bigger place on top.
 */
export function rankMatches(items: readonly string[], query: string, limit = 50): string[] {
  const q = fold(query.trim());
  if (!q) return items.slice(0, limit);

  const prefix: string[] = [];
  const wordStart: string[] = [];
  const contains: string[] = [];

  for (const item of items) {
    const lower = fold(item);
    const at = lower.indexOf(q);
    if (at === -1) continue;
    if (at === 0) prefix.push(item);
    else if (lower[at - 1] === " " || lower[at - 1] === "-" || lower[at - 1] === "'")
      wordStart.push(item);
    else contains.push(item);
    // Once there are enough exact prefix hits, nothing weaker can outrank them.
    if (prefix.length >= limit) break;
  }

  return [...prefix, ...wordStart, ...contains].slice(0, limit);
}

/**
 * Flattens a country-keyed map into one list ordered by each entry's position
 * within its own country, so prominent places come first regardless of which
 * country they belong to.
 */
/**
 * The same, keeping the group each value came from.
 *
 * Flattening to bare strings lost which country a city belonged to, and the
 * lookup that guessed it back returned the first match by name. The generated
 * data has fourteen places called Victoria; the first is in Argentina, so
 * picking Victoria in Canada saved the trip to Argentina.
 */
export function flattenGroups(
  groups: Record<string, readonly string[]>,
): { value: string; group: string }[] {
  const ranked: { value: string; group: string; rank: number }[] = [];
  for (const [group, list] of Object.entries(groups)) {
    for (const [index, value] of list.entries()) ranked.push({ value, group, rank: index });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.map(({ value, group }) => ({ value, group }));
}

export function flattenByRank(groups: Record<string, readonly string[]>): string[] {
  const ranked: { value: string; rank: number }[] = [];
  for (const list of Object.values(groups)) {
    for (const [index, value] of list.entries()) ranked.push({ value, rank: index });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.map((r) => r.value);
}

/**
 * Replaces the fragment currently being typed in a comma-separated field with a
 * chosen value.
 *
 * Picking "Netherlands" after typing "net" must not leave "net" behind as a
 * separate entry — which is exactly what appending did.
 */
export function replaceLastToken(raw: string, chosen: string): string[] {
  const parts = raw.split(",");
  parts.pop();

  const seen = new Set<string>();
  return [...parts, chosen]
    .map((part) => part.trim())
    .filter((part) => {
      const key = part.toLowerCase();
      if (!part || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
