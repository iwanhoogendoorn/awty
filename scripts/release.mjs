/*
 * Cuts a GitHub release for the current version.
 *
 * BRAT installs a plugin by reading the latest release and downloading
 * main.js, manifest.json and styles.css from its assets. That is the whole
 * distribution mechanism, so it has to be one command rather than a checklist:
 * a release whose assets are a build older than its manifest ships a stale
 * plugin under a current version number, and nobody finds out until someone
 * reports a bug that was fixed weeks ago.
 *
 * So this builds first, every time, and refuses to publish anything it did not
 * just make.
 *
 * Usage: npm run release
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = ["main.js", "manifest.json", "styles.css"];

/**
 * Runs a command and returns its output.
 *
 * `execFileSync` returns null rather than a string when stdio is inherited —
 * which is what the build and the release call want, so that their progress
 * is visible — so the empty string stands in for "nothing captured".
 */
function run(cmd, args, opts = {}) {
  return (execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", ...opts }) ?? "").trim();
}

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const version = manifest.version;
const tag = version;

// A release built from uncommitted work is a release nobody can reproduce.
if (run("git", ["status", "--porcelain"])) {
  fail("working tree is dirty — commit first, so the tag points at the code that shipped.");
}

const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
const ahead = run("git", ["log", "--oneline", `origin/${branch}..HEAD`]);
if (ahead) fail(`${ahead.split("\n").length} commit(s) not pushed — push first, or the tag will dangle.`);

let existing = "";
try {
  existing = run("git", ["ls-remote", "--tags", "origin", tag]);
} catch {
  // No remote tags yet; that is the normal case for a first release.
}
if (existing) fail(`tag ${tag} already exists on the remote. Bump the version first.`);

console.log(`release: building ${version} from scratch`);
run("npm", ["run", "build"], { stdio: "inherit" });

for (const asset of ASSETS) {
  const file = path.join(ROOT, asset);
  if (!fs.existsSync(file)) fail(`build did not produce ${asset}`);
}

// The check that matters: the manifest inside the release has to be the one
// the bundle was built alongside.
const built = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
if (built.version !== version) fail(`manifest changed mid-build (${version} -> ${built.version})`);

const notes = [
  `Install with [BRAT](https://github.com/TfTHacker/obsidian42-brat): add \`${run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])}\`.`,
  "",
  "Or copy `main.js`, `manifest.json` and `styles.css` from the assets below into",
  `\`<vault>/.obsidian/plugins/${manifest.id}/\`.`,
  "",
  "### Changes",
  "",
  run("git", ["log", "--pretty=- %s", `${lastTag()}..HEAD`]) || "- First release.",
].join("\n");

function lastTag() {
  try {
    return run("git", ["describe", "--tags", "--abbrev=0"]);
  } catch {
    // No previous tag: the log range below becomes the whole history, which is
    // why the first release just says so instead.
    return run("git", ["rev-list", "--max-parents=0", "HEAD"]);
  }
}

run("gh", ["release", "create", tag, ...ASSETS, "--title", `${manifest.name} ${version}`, "--notes", notes], {
  stdio: "inherit",
});

console.log(`release: published ${tag} with ${ASSETS.join(", ")}`);
