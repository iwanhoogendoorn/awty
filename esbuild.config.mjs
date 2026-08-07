import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import fs from "fs";
import path from "path";

const prod = process.argv[2] === "production";

// The repo root, which is where Obsidian expects a plugin's manifest.json,
// main.js and styles.css to sit — and where BRAT looks when a repo has no
// release yet.
const OUT_DIR = ".";

const banner = `/*
Travel Planner — bundled by esbuild. Source: src/ in this repository.
*/`;

// Leaflet ships its own stylesheet and the map is unusable without it. Read
// from the installed package rather than vendored into styles/, so bumping the
// dependency cannot leave the CSS a version behind the code.
const LEAFLET_CSS = "node_modules/leaflet/dist/leaflet.css";

// Styles live as numbered files in styles/ and are concatenated in name order,
// so 10-base.css always lands before 40-components.css can override it.
// Leaflet goes first of all, so our own rules can override its defaults.
function concatStyles() {
  const dir = "styles";
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".css"))
    .sort();
  const parts = [`/* === leaflet.css (vendored at build time) === */\n` + fs.readFileSync(LEAFLET_CSS, "utf8")];
  for (const f of files) {
    parts.push(`/* === ${f} === */\n` + fs.readFileSync(path.join(dir, f), "utf8"));
  }
  fs.writeFileSync(path.join(OUT_DIR, "styles.css"), parts.join("\n\n"));
  console.log(`styles: leaflet + ${files.length} files -> ${OUT_DIR}/styles.css`);
}

const stylesPlugin = {
  name: "concat-styles",
  setup(build) {
    build.onEnd(() => concatStyles());
  },
};

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: `${OUT_DIR}/main.js`,
  plugins: [stylesPlugin],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
