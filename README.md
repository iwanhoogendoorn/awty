# Are We There Yet? (AWTY)

An Obsidian plugin for planning trips in plain markdown — holidays, city breaks,
day trips, concerts and events.

- **Plugin id:** `awty` (installs to `.obsidian/plugins/awty`)
- **Path:** `/Users/iwanhoogendoorn/orca/projects/obsidian-travel-planner`
- **Base branch:** `master`

## What it does

- A dashboard with tabs for the trip, its bookings, a day-by-day timeline,
  costs and attachments
- One note per booking or expense, so every figure is typed once and read
  everywhere
- Travel times between the places on a trip, from the Google Maps APIs, only
  ever fetched from a button
- Visa checks by passport, and Dutch government travel advice by country
- Packing lists sized to the length of the trip
- Food Spot restaurant embeds for the destination city
- Full PDF export of a trip to a file on disk

## Working on it

```
npm run build          # typecheck, bundle, concatenate styles into awty/
npm test               # smoke tests over the pure modules
npm run install-local  # copy awty/ into the vault
```

Earlier installs (`travel-planner`, `travel-planner-v2`) are left alone by the
install script. Disable them in Obsidian: two copies reading the same notes will
both register views and both answer the ribbon icon.
