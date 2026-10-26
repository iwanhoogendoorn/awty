# Changelog

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
