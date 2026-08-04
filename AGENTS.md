# obsidian-travel-planner — project layer

Layered on top of `~/AGENTS.md` — stricter only, never relaxes the global rules.

- Keep every change inside this repo. Never touch files outside it.
- Never push. Local commits only, unless explicitly told otherwise.
- Every file-creation task verifies with `ls -la` plus `cat` of the created file,
  with the real output pasted in the same turn.
- Report progress into the sidebar at each checkpoint:
  `orca worktree set --worktree active --comment "<short status>" --json`
- Open the diffs for me BEFORE your final commit — `open-changed` reads `git status`, so
  after committing there is nothing left to show:
  `orca file open-changed --mode diff --worktree active --json`
- Then commit, and set the card:
  `orca worktree set --worktree active --workspace-status in-review --json`
- Commit message style: imperative mood, one line, no trailing period.

## Versioning

The plugin states its version in `awty/manifest.json`, `package.json` and
`versions.json`. They are moved together by one command and nothing else:

```
npm run bump -- patch     # or minor, major, or an exact 1.2.3
```

Bump it as part of any change that ships — a fix, a feature, a dataset
regeneration. `npm run build` refuses to run while the files disagree, because
a version that contradicts itself makes "which build is this?" unanswerable.

patch for a fix, minor for a new capability, major for a change that breaks
existing notes or settings.
