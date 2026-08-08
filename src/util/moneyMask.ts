import { COMMON_CURRENCIES, symbolFor } from "./money";

/**
 * Hiding every figure on screen, for when somebody else can see it.
 *
 * A travel planner is mostly money — what a flight cost, what is left of the
 * budget, what the whole thing came to. Perfectly fine on your own screen and
 * nobody else's business on a shared one, and a screenshot of a trip is exactly
 * the sort of thing that gets sent to the people going on it.
 *
 * Done after the fact rather than at each of the seventy-odd places a figure is
 * printed. Those figures arrive inside sentences — "€120 of €3,000 budget" — so
 * marking them at the source would mean breaking every one of those sentences
 * into pieces, and a sentence assembled from five spans is a sentence that will
 * eventually be assembled wrong. Finding them afterwards leaves the rendering
 * code exactly as it reads now.
 */

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * What a formatted amount looks like, built from the same table that formats
 * them.
 *
 * Derived rather than written out, so a currency added to the formatter is
 * hidden by this without anybody remembering to come back here. A bare
 * three-letter code is deliberately *not* matched on its own: airport codes are
 * three letters too, and "MIA 14:35" is a landing, not fourteen Miamis.
 */
export function moneyPattern(extraCurrencies: string[] = []): RegExp {
  const codes = [...COMMON_CURRENCIES, ...extraCurrencies].filter(Boolean);
  const tokens = new Set<string>();
  for (const code of codes) {
    tokens.add(code.toUpperCase());
    tokens.add(symbolFor(code));
  }
  // Longest first, so "A$" is not matched as "$" with an A left behind.
  const alternation = [...tokens]
    .sort((a, b) => b.length - a.length)
    .map(escapeForRegex)
    .join("|");

  // A symbol, an optional space where the formatter puts one, then a number in
  // the shape it writes: grouped thousands and at most two decimals.
  //
  // The lookbehind is not decoration. South African rand is "R", so without it
  // "LHR 2" contained an amount of two rand, and every airport code ending in a
  // currency letter would have been quietly blurred. A symbol has to start a
  // word to be a symbol.
  return new RegExp(`(?<![A-Za-z])(?:${alternation})\\s?-?\\d[\\d,]*(?:\\.\\d{1,2})?`, "g");
}

/** The class each found amount is wrapped in, and the hook the blur hangs off. */
export const MONEY_CLASS = "awty-money";

/**
 * Wrap every amount under `root` so it can be hidden by a stylesheet.
 *
 * Text nodes only, and never inside an input, a `<script>`, or something
 * already wrapped: rewriting the value of a box somebody is typing in would be
 * a good deal worse than showing them their own budget.
 */
export function maskMoney(root: HTMLElement, pattern: RegExp): number {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(`.${MONEY_CLASS}`)) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "INPUT" || tag === "TEXTAREA") {
        return NodeFilter.FILTER_REJECT;
      }
      // An HTML span inside an SVG is not a span, it is a node the renderer
      // ignores — so wrapping a label on the map would delete it rather than
      // blur it. The map draws no figures anyway; its prices live in tooltips,
      // which are plain HTML.
      if (parent.namespaceURI && parent.namespaceURI !== "http://www.w3.org/1999/xhtml") {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const targets: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    pattern.lastIndex = 0;
    if (pattern.test(node.nodeValue ?? "")) targets.push(node as Text);
  }

  let wrapped = 0;
  for (const node of targets) {
    const text = node.nodeValue ?? "";
    const pieces = root.ownerDocument.createDocumentFragment();
    let at = 0;
    pattern.lastIndex = 0;
    for (let hit = pattern.exec(text); hit; hit = pattern.exec(text)) {
      if (hit.index > at) {
        pieces.appendChild(root.ownerDocument.createTextNode(text.slice(at, hit.index)));
      }
      const span = root.ownerDocument.createElement("span");
      span.className = MONEY_CLASS;
      span.textContent = hit[0];
      pieces.appendChild(span);
      at = hit.index + hit[0].length;
      wrapped += 1;
    }
    if (at < text.length) {
      pieces.appendChild(root.ownerDocument.createTextNode(text.slice(at)));
    }
    node.parentNode?.replaceChild(pieces, node);
  }
  return wrapped;
}
