# Are We There Yet? (AWTY)

An Obsidian plugin for planning trips in plain markdown — holidays, city breaks,
day trips, concerts and events. Every figure is typed once, in one note, and
read everywhere else.

## Install

### With BRAT (recommended)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from the
   community plugins browser.
2. **BRAT → Add a beta plugin**, and paste `iwanhoogendoorn/awty`.
3. Enable **Are We There Yet?** in Settings → Community plugins.

BRAT then keeps it up to date with each release.

### By hand

Download `main.js`, `manifest.json` and `styles.css` from the
[latest release](https://github.com/iwanhoogendoorn/awty/releases/latest) and
drop them in `<vault>/.obsidian/plugins/awty/`.

## What it does

**Trips have a stage, not just dates.** Planning, going, went, cancelled — so a
booked holiday, one of four ideas for October, and one you called off in May are
told apart. A trip you were going on becomes one you went on by itself once its
last day passes; cancelling never reverses, because it was a decision rather
than a date.

**Price watching, for the trips you have not committed to.** Log what a flight
costs today with the day you saw it and a screenshot, check it again in a
fortnight, and the second price tells you which way it is going. The latest
price for each thing adds up to an estimate, which is put against your budget
and against the other ideas competing for the same window. Mixed currencies get
no verdict rather than a converted one.

**It notices when a trip is happening.** Mark a flight as booked and the plugin
offers to move the trip from planning to going — it has seen the answer, so it
does not make you give it twice.

**And the rest:**

- A dashboard: every trip, then one trip's overview, timeline, bookings, costs
  and photos
- One note per booking or expense, with the budget and the sub-notes generated
  from them
- Flights with multiple legs and multiple journeys, priced separately, laid out
  across the days they actually happen on
- Travel times between the places on a trip, from the Google Maps APIs, only
  ever fetched from a button
- Visa checks by passport and Dutch government travel advice, per country, for
  every border a trip crosses — plus the requirements that are not visas, like
  Thailand's arrival card
- Packing lists sized to the length of the trip
- Food Spot restaurant embeds for the destination city
- Full PDF export, and a KML of every place for Google My Maps
- Mobile: the whole thing, at phone width, with real tap targets

## Not travel advice

Visa outcomes, entry requirements, arrival cards, travel advice and travel times
are indicative only. They come from open datasets that may be incomplete or out
of date, and the checks cover a limited set of countries: **if the plugin says
nothing about a requirement, that is not confirmation that no requirement
exists.** Verify everything with the relevant embassy or official government
source before booking and again before travelling. The full disclaimer is in the
plugin's settings, and on every exported document.

## Working on it

```
npm run build          # check the version, typecheck, bundle, concatenate styles
npm test               # smoke tests over the pure modules
npm run install-local  # copy the build into the vault
npm run release -- patch   # or minor / major: bump, commit, push, build, release
npm run release            # release the version already in manifest.json
npm run bump -- patch      # just the version numbers, if you want them separately
```

`release` does the whole thing and refuses to do half of it: it will not tag a
dirty tree, it pushes before it tags so the tag points at something fetchable,
and it always builds from scratch rather than trusting whatever `main.js`
happens to be on disk. The bump level is never guessed — patch, minor and major
are a promise to the people installing this, and a script has no evidence with
which to make it.

`main.js` and `styles.css` are generated and not tracked; they ship as release
assets, which is where BRAT looks for them. `manifest.json` is tracked, because
it is the source of truth for the id and the version — `npm run build` fails if
it disagrees with `package.json`.

Earlier installs (`travel-planner`, `travel-planner-v2`) are left alone by the
install script. Disable them in Obsidian: two copies reading the same notes will
both register views and both answer the ribbon icon.

## Licence

MIT.
