/*
 * Copies the built plugin into the vault as `awty`.
 *
 * Deliberately a copy into a NEW folder, not a symlink over an old one: every
 * earlier install (`travel-planner`, `travel-planner-v2`) stays exactly where
 * it is. Disable them in Obsidian — two copies of this plugin reading the same
 * notes will both register views and both answer the ribbon.
 *
 * Usage: npm run install-local [-- /path/to/vault]
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = ROOT;
const PLUGIN_ID = "awty";
const FILES = ["main.js", "manifest.json", "styles.css"];

const vault = process.argv[2] ?? path.join(os.homedir(), "Documents", "IWAN-REMOTE-VAULT");
const target = path.join(vault, ".obsidian", "plugins", PLUGIN_ID);

if (!fs.existsSync(path.join(vault, ".obsidian"))) {
  console.error(`Not a vault (no .obsidian folder): ${vault}`);
  process.exit(1);
}
for (const file of FILES) {
  if (!fs.existsSync(path.join(OUT_DIR, file))) {
    console.error(`Missing ${file} — run \`npm run build\` first.`);
    process.exit(1);
  }
}

fs.mkdirSync(target, { recursive: true });
for (const file of FILES) {
  fs.copyFileSync(path.join(OUT_DIR, file), path.join(target, file));
  const { size } = fs.statSync(path.join(target, file));
  console.log(`  ${file.padEnd(14)} ${String(size).padStart(7)} bytes`);
}
console.log(`\nInstalled ${PLUGIN_ID} -> ${target}`);
console.log("Enable it in Obsidian: Settings -> Community plugins.");
