/*
 * Moves the plugin's version, in every place that states it.
 *
 * manifest.json and package.json had drifted apart — 2.1.0 against 2.0.0 —
 * because each was edited by hand at a different time. One command now moves
 * both, and `npm run build` refuses to build while they disagree.
 *
 * Usage: npm run bump -- patch|minor|major|<exact version>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "awty", "manifest.json");
const PACKAGE = path.join(ROOT, "package.json");
const VERSIONS = path.join(ROOT, "versions.json");

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

const manifest = read(MANIFEST);
const pkg = read(PACKAGE);

const arg = process.argv[2] ?? "patch";
const parts = manifest.version.split(".").map(Number);
if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
  console.error(`manifest.json has no readable version: ${manifest.version}`);
  process.exit(1);
}

let next;
if (/^\d+\.\d+\.\d+$/.test(arg)) {
  next = arg;
} else if (arg === "major") {
  next = `${parts[0] + 1}.0.0`;
} else if (arg === "minor") {
  next = `${parts[0]}.${parts[1] + 1}.0`;
} else if (arg === "patch") {
  next = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
} else {
  console.error(`Unknown bump "${arg}". Use patch, minor, major, or an exact version.`);
  process.exit(1);
}

manifest.version = next;
pkg.version = next;
write(MANIFEST, manifest);
write(PACKAGE, pkg);

// Obsidian's convention: which plugin version needs which app version.
const versions = fs.existsSync(VERSIONS) ? read(VERSIONS) : {};
versions[next] = manifest.minAppVersion;
write(VERSIONS, versions);

console.log(`version: ${parts.join(".")} -> ${next}`);
console.log(`  awty/manifest.json, package.json, versions.json`);
