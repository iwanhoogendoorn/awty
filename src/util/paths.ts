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
