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
