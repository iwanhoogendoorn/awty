import { escapeHtml } from "./tripDocument";
export { stripFrontmatter } from "../util/frontmatter";

/**
 * Just enough Markdown for an exported trip.
 *
 * The notes you write by hand are trip information too, and leaving them out of
 * the PDF meant the export was a summary of the plugin's fields rather than of
 * the trip. This handles what people actually type in a travel note — headings,
 * lists, tick boxes, tables, quotes, links — and deliberately not the rest.
 *
 * Every value is escaped before any markup is added, so a note can never inject
 * HTML into the document.
 */

/** Fenced blocks are plugin views (`foodspot`, `dataview`), not prose. */
const FENCE = /^\s*(```|~~~)/;

function inline(text: string): string {
  // Code spans come out before anything else, from the raw text: escaping
  // first and escaping the body again on the way back gave "&amp;lt;" in the
  // PDF where the note said "<". Nothing inside a span of code should be
  // re-read as markup, and the placeholder survives escapeHtml untouched.
  const code: string[] = [];
  let out = text.replace(/`([^`]+)`/g, (_, body: string) => {
    code.push(body);
    return `\u0000${code.length - 1}\u0000`;
  });
  out = escapeHtml(out);

  // Embeds are attachments; they are collected separately and shown as images.
  out = out.replace(/!\[\[[^\]]+\]\]/g, "");
  // A wikilink's target is meaningless outside the vault — keep the words.
  out = out.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  out = out.replace(/\[\[([^\]]+)\]\]/g, "$1");
  // A real link keeps its address: this file gets read away from the computer.
  out = out.replace(
    /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    (_, label: string, href: string) => `${label} <span class="url">${href}</span>`,
  );
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (_, pre: string, url: string) => {
    // Trailing punctuation belongs to the sentence, and a closing paren only
    // to an address that opened one — wikipedia.org/wiki/Split_(city) keeps
    // its paren, "see https://x.com)." does not.
    let end = url.length;
    while (end > 0) {
      const ch = url[end - 1];
      if (".,;:!?".includes(ch)) end -= 1;
      else if (
        ch === ")" &&
        (url.slice(0, end).match(/\(/g)?.length ?? 0) < (url.slice(0, end).match(/\)/g)?.length ?? 0)
      )
        end -= 1;
      else break;
    }
    return `${pre}<span class="url">${url.slice(0, end)}</span>${url.slice(end)}`;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  out = out.replace(/==([^=]+)==/g, "<mark>$1</mark>");

  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${escapeHtml(code[Number(i)])}</code>`);
}

function tableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

const SEPARATOR = /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/;

/** Renders a Markdown note body as HTML fit for printing. */
export function renderMarkdown(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];

  let listTag: "ul" | "ol" | null = null;
  let paragraph: string[] = [];
  let quote: string[] = [];
  let inFence = false;

  const closeList = () => {
    if (listTag) out.push(`</${listTag}>`);
    listTag = null;
  };
  const closeParagraph = () => {
    if (paragraph.length > 0) out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeQuote = () => {
    if (quote.length > 0) out.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`);
    quote = [];
  };
  const closeAll = () => {
    closeParagraph();
    closeQuote();
    closeList();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();

    if (FENCE.test(raw)) {
      closeAll();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    if (line === "") {
      closeAll();
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      closeAll();
      out.push("<hr>");
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeAll();
      // Note headings sit under the section's own h2, so they start one deeper.
      const level = Math.min(heading[1].length + 2, 6);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (line.startsWith(">")) {
      closeParagraph();
      closeList();
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }

    // A table needs its separator row to be a table at all.
    if (line.startsWith("|") && SEPARATOR.test(lines[i + 1] ?? "")) {
      closeAll();
      const headers = tableRow(line);
      const rows: string[][] = [];
      i += 1;
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith("|")) {
        i += 1;
        rows.push(tableRow(lines[i]));
      }
      out.push(
        "<table><thead><tr>",
        ...headers.map((h) => `<th>${inline(h)}</th>`),
        "</tr></thead><tbody>",
        ...rows.map((row) => `<tr>${row.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`),
        "</tbody></table>",
      );
      continue;
    }

    const task = /^[-*+]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    if (task) {
      closeParagraph();
      closeQuote();
      if (listTag !== "ul") {
        closeList();
        out.push('<ul class="tasks">');
        listTag = "ul";
      }
      out.push(
        `<li><span class="box${task[1].toLowerCase() === "x" ? " on" : ""}"></span>${inline(task[2])}</li>`,
      );
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      closeParagraph();
      closeQuote();
      if (listTag !== "ul") {
        closeList();
        out.push("<ul>");
        listTag = "ul";
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      closeParagraph();
      closeQuote();
      if (listTag !== "ol") {
        closeList();
        out.push("<ol>");
        listTag = "ol";
      }
      out.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }

    closeQuote();
    closeList();
    paragraph.push(line);
  }

  closeAll();
  return out.join("\n");
}
