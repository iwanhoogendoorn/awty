/**
 * The target inside a link, whichever form Obsidian was configured to write.
 *
 * `generateMarkdownLink()` honours the vault's "Use [[Wikilinks]]" setting and
 * emits `[label](path)` when it is off. Only the wikilink form was ever
 * unwrapped, so with that setting off every attachment resolved to nothing:
 * editing a booking dropped them, and the PDF export skipped the images.
 *
 * Kept free of Obsidian so it can be tested.
 */
export function linkTarget(link: string): string {
  const raw = link.trim();

  // ![[target|alias]] or [[target|alias]]. The #fragment addresses a heading
  // or page inside the file; the file itself is the part that resolves.
  const wiki = /^!?\[\[([^\]]+)\]\]$/.exec(raw);
  if (wiki) return decodeURI(wiki[1].split("|")[0].split("#")[0].trim());

  // ![label](target) or [label](target), with the target possibly <angled>
  const md = /^!?\[[^\]]*\]\(\s*<?([^)>]+?)>?\s*(?:"[^"]*")?\)$/.exec(raw);
  if (md) {
    const target = md[1].trim();
    // An external address is not a vault file.
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return "";
    return decodeURI(target.split("#")[0]);
  }

  // A bare path, which is what the writer stores before links are generated.
  return raw;
}
