/** Characters Obsidian (and the filesystem) refuse in a note or folder name. */
const ILLEGAL = /[\\/:*?"<>|#^[\]]/g;

export function sanitizeName(name: string): string {
  return (
    name
      .replace(ILLEGAL, "-")
      // Collapse the runs of dashes that sanitising tends to produce.
      .replace(/\s+/g, " ")
      .replace(/-{2,}/g, "-")
      .trim()
      // A trailing dot makes a folder unreachable on Windows.
      .replace(/^\.+|[.\s]+$/g, "")
      .slice(0, 120) || "Untitled"
  );
}

export function joinPath(...parts: string[]): string {
  return parts
    .filter((p) => p && p.length > 0)
    .join("/")
    .replace(/\/{2,}/g, "/");
}

export interface FolderPatternVars {
  year: string;
  month: string;
  start: string;
  end: string;
  title: string;
  city: string;
  country: string;
  kind: string;
}

/**
 * Expands {year}/{start} {title} style patterns. Each expanded segment is
 * sanitised individually so a "/" inside the pattern still means "subfolder"
 * while a "/" inside a city name does not.
 */
export function expandFolderPattern(pattern: string, vars: FolderPatternVars): string {
  // Values are sanitised as they go in, so a title of "Japan/Korea 2026" cannot
  // smuggle a folder separator into the path. Only the slashes written in the
  // pattern itself survive to split segments.
  const filled = pattern.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = (vars as unknown as Record<string, string>)[key];
    return value === undefined ? match : sanitizeName(value);
  });
  return filled
    .split("/")
    .map((segment) => sanitizeName(segment))
    .filter((segment) => segment.length > 0)
    .join("/");
}

/**
 * The folders to remove after deleting `path`, nearest first: each ancestor
 * that would be left with nothing in it, stopping below `root`.
 *
 * Pure, so the walk can be checked: `childrenOf` lists a folder's children as
 * they are now, and whatever this walk has already decided to remove counts as
 * gone.
 */
export function foldersToPrune(path: string, root: string, childrenOf: (folder: string) => string[]): string[] {
  const out: string[] = [];
  const parentOf = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const inside = (p: string): boolean => (root === "" || root === "/" ? p !== "" : p.startsWith(`${root}/`));
  let gone = path;
  let folder = parentOf(path);
  while (folder && inside(folder)) {
    if (childrenOf(folder).some((child) => child !== gone)) break;
    out.push(folder);
    gone = folder;
    folder = parentOf(folder);
  }
  return out;
}

/**
 * The trip folder a booking or expense note belongs to.
 *
 * The note records it (`trip_folder`), and that is believed only while the
 * note is actually inside that folder. A trip whose folder was renamed — by
 * hand, or by a version of this plugin that did not update its bookings —
 * leaves the recorded value pointing at a folder that no longer exists, and
 * trusting it filed every booking under a trip nobody could find.
 */
export function owningTripFolder(recorded: string, filePath: string): string {
  if (recorded && filePath.startsWith(`${recorded}/`)) return recorded;
  const parts = filePath.split("/");
  // <trip folder>/<bookings folder>/<note>.md, or the note straight in the trip folder.
  if (parts.length >= 3) return parts.slice(0, -2).join("/");
  return parts.slice(0, -1).join("/");
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Links in one note, pointed at where a trip's notes now are.
 *
 * What Obsidian's own rename does for the whole vault, done for one note:
 * paths under the old folder move to the new one, and links to the renamed
 * note by name follow the new name. Used only on the notes inside the trip, so
 * a rename never reaches into notes elsewhere — a bare `[[Food]]` in some other
 * note happens to resolve to this trip's Food note, and rewriting it would turn
 * an accident into a hard-coded path to a trip it has nothing to do with.
 */
export function retargetLinks(
  text: string,
  move: { fromFolder: string; toFolder: string; fromName?: string; toName?: string },
): string {
  let out = text;
  if (move.fromFolder && move.fromFolder !== move.toFolder) {
    out = out.replace(new RegExp(`${escapeRe(move.fromFolder)}/`, "g"), `${move.toFolder}/`);
    const enc = (s: string): string => encodeURI(s);
    if (enc(move.fromFolder) !== move.fromFolder) {
      out = out.replace(new RegExp(`${escapeRe(enc(move.fromFolder))}/`, "g"), `${enc(move.toFolder)}/`);
    }
  }
  const { fromName, toName } = move;
  if (fromName && toName && fromName !== toName) {
    const name = escapeRe(fromName);
    const folder = escapeRe(move.toFolder);
    // [[Name]], [[Name|alias]], [[Name#heading]], and the same with the folder in front.
    out = out.replace(new RegExp(`\\[\\[((?:${folder}/)?)${name}(?=\\]\\]|\\||#)`, "g"), (_m, pre: string) => `[[${pre}${toName}`);
    // [text](Name.md), [text](folder/Name.md), with spaces as written or encoded.
    for (const [from, to] of [[fromName, toName], [encodeURI(fromName), encodeURI(toName)]] as const) {
      out = out.replace(
        new RegExp(`\\]\\(((?:${escapeRe(encodeURI(move.toFolder))}/|${folder}/)?)${escapeRe(from)}\\.md(?=\\)|#)`, "g"),
        (_m, pre: string) => `](${pre}${to}.md`,
      );
    }
  }
  return out;
}
