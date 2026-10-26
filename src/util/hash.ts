/**
 * cyrb53: a 53-bit string hash, as eleven base-36 characters.
 *
 * Not for secrets. It names things — a note, a moment — compactly and the same
 * way every time, which is all an id derived from a path needs.
 */
export function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, "0");
}

/**
 * The id a note has before one is stored on it: its path, hashed.
 *
 * Notes written before ids existed have nothing else to go by. The first time
 * one is about to move, this is written into it, so the move keeps the id.
 */
export function pathId(prefix: string, path: string): string {
  return `${prefix}-${hash(path)}`;
}

/** A new id, for something being created. Never derived from where it lands. */
export function freshId(prefix: string): string {
  return `${prefix}-${hash(`${Date.now()}:${Math.random()}:${Math.random()}`)}`;
}

/** What an id stored in frontmatter has to look like to be believed. */
export function isStoredId(prefix: string, value: unknown): value is string {
  return typeof value === "string" && new RegExp(`^${prefix}-[0-9a-z]{6,32}$`).test(value.trim());
}
