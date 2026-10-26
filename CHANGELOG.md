# Changelog

## 2.36.3 — 2026-10-26

### Fixed

- **Renaming a trip lost its bookings.** Every booking records the folder of
  its trip, and nothing updated that when the folder moved. The bookings were
  filed under a trip that no longer existed, and dropped out of the trip, the
  totals and the API's `/bookings` and `/health`. Moving a trip now updates
  them. Bookings already left behind by an earlier rename are found by the
  folder they are actually in. This affected the trip form as much as the API.
- **A rename through the API rewrote notes outside the trip.** It used
  Obsidian's vault-wide rename, which rewrote an unrelated note's bare
  `[[Food]]` into a hard path to the renamed trip's Food note. API renames now
  move only the trip's own files and update links only in the trip's own
  notes.

### Changed (local API)

- Renames reply with `moved: [{ from, to }]`; old paths are no longer listed in
  `written`.

## 2.36.2 — 2026-10-26

### Changed (local API)

- **Ids are stable.** Trips and bookings carry their id in the note
  (`awty_id`), so renaming one no longer changes it and an id keeps resolving.
  New notes get one when they are made. Older notes get their path-derived id
  written in the first time they are about to move: an edit, or a rename by
  hand. Moments store theirs too, so editing a moment keeps its id.
- **Moments need a date within the trip.** `POST` and `PATCH` return 400 for a
  missing date, or one before the trip starts or after it ends.
- **`DELETE` replies** list removed paths under `deleted`, apart from
  `written`. The id of what was deleted is now `id`.
- **Unsupported methods** on a known route are a 405 with an `Allow` header,
  decided before any id is looked up. A `PUT` from another device is a 405
  too, not a 403.

### Fixed

- Deleting the last trip of a year no longer leaves an empty year folder
  behind, from the delete button or the API.

## 2.36.1 — 2026-10-26

- Version bump only; no changes from 2.36.0.

## 2.36.0 — 2026-10-26

### Added

- **Local API** at `/awty/v1` on port 27131, for scripts, shortcuts, agents and
  your other devices. Off by default. Settings → Local API turns it on, with a
  Bearer token, a choice of *this Mac only* or *Tailscale*, and an **Allow
  writes from other devices** switch (off by default) that limits writes to
  `127.0.0.1` until you say otherwise.
  - Trips: list, detail, create, edit, delete.
  - Bookings: read every kind; create, edit and delete flights, stays and
    transport.
  - Moments (the trip story): list, read, add, edit, delete.
  - `GET /health`.
  - Every write runs through the same code as the forms, waits for Obsidian to
    re-read what it wrote, and replies with `written`, the vault paths it
    touched.
  - `x-awty-revision` on every authenticated response. It changes only when a
    note under the trips folder really changes, so a client can poll cheaply.
  - Every route is in [docs/api.md](docs/api.md).

### Changed

- Settings changed on another device and brought in by Obsidian Sync now take
  effect in the running plugin, instead of being kept stale in memory and
  written back over on the next save. That includes switching the local API on
  or off.

- Deleting a trip from the confirm dialog and from the API now run the same
  code, so neither leaves cached places or travel advice behind that the other
  would have removed.
