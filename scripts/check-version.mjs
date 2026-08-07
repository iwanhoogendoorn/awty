/*
 * Fails the build when the version is stated inconsistently.
 *
 * A version that disagrees with itself is worse than no version: it makes
 * "which build is this?" unanswerable from the files.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

const manifest = read("manifest.json");
const pkg = read("package.json");

if (manifest.version !== pkg.version) {
  console.error(
    `version mismatch: manifest.json is ${manifest.version}, package.json is ${pkg.version}.\n` +
      `Run \`npm run bump -- patch\` to move both.`,
  );
  process.exit(1);
}
console.log(`version: ${manifest.version}`);
