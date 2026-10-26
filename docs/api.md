# The AWTY local API

Are We There Yet? can serve JSON so scripts, shortcuts, an AI agent or another of
your devices can read and change trips. Every write goes through the plugin
rather than around it. A booking added over HTTP runs the same code as the
booking wizard, so the budget table, the Food note, the Moments section and links
that follow a rename all stay right.

It works the same way as Helm's API (`/helm/v1` on 27125): off by default, a
Bearer token, loopback or Tailscale only.

## Switching it on

Settings → **Are We There Yet?** → **Local API**:

1. Turn on **Serve the API**. A token is generated the first time.
2. Copy the token. Change the port if 27131 is taken.
3. Leave **Reachable from** on *This Mac only* unless another device needs it.

Obsidian has to be running, on the desktop. The mobile app has no HTTP server,
so the setting is ignored there even when it syncs across.

```
Base URL:  http://127.0.0.1:27131/awty/v1
Header:    Authorization: Bearer <token>
```

```bash
export AWTY=http://127.0.0.1:27131/awty/v1
export AWTY_TOKEN=…                # Settings → Local API → Token → Copy
curl -s $AWTY/health -H "Authorization: Bearer $AWTY_TOKEN"
```

## Security

| Setting | Default | What it does |
|---|---|---|
| Serve the API | off | Nothing listens on any port until this is on. |
| Port | 27131 | Applied when you leave the box. |
| Reachable from | This Mac only | `127.0.0.1`, or this Mac's Tailscale address (`100.x.y.z`). There is no "every interface". The API is plain HTTP, and outside a WireGuard tunnel the token would cross the network in clear text. |
| Allow writes from other devices | off | While off, only requests from `127.0.0.1` can `POST`, `PATCH` or `DELETE`. |
| Token | generated | 48 hex characters. **New token** invalidates the old one at once. |

The order of checks for every request:

1. **403** if the caller is not loopback and not on the tailnet (`100.64.0.0/10`).
2. **404** if the path is not under `/awty/v1`.
3. **401** if the token is missing or wrong. Nothing else is revealed, not even the revision.
4. **403** if it is a write, the caller is not `127.0.0.1`, and *Allow writes from
   other devices* is off. The switch is read on every request, so flipping it
   needs no restart.
5. **413** if the body is over 1 MB, **400** if it is not JSON.

A request from this Mac to its *own* Tailscale address arrives from that
address and counts as another device. Use `127.0.0.1` for local scripts.

## Ideas you need

- **Ids are derived, never stored.** A trip's id (`t-…`) and a booking's id
  (`b-…`) are hashes of the note's path. Reading a trip never writes an id into
  your note. The catch is that renaming changes the id. A new title renames the
  note, and its folder too for a trip, so the write that does it replies with
  the new id. Use that one from then on.
- A **moment's** id (`m-…`) is a hash of its date, title and text. Editing a
  moment gives it a new id, and the reply carries it.
- **`written`**: every write replies with the vault paths it created, changed,
  renamed or deleted, sorted. For a rename it lists both the old and the new path.
- **`x-awty-revision`**: on every authenticated response. It is a number that
  changes when a note under the trips folder actually changes, whether through
  the API or because you edited it in Obsidian. Reads, refused writes and
  writes that change nothing (a `PATCH` with the values already there) leave it
  alone, and those replies have `"written": []`. It starts from the clock when
  the plugin loads, so it never repeats across a restart. Poll `/health` and
  only refetch when it moves.
- **Writes are one at a time.** Each one waits for Obsidian to re-read what it
  wrote before replying, so the reply shows what the notes now say.
- **Unknown fields are refused** with a 400. `start_date` instead of
  `startDate` would otherwise be ignored and look like it worked.
- **Dates** are `YYYY-MM-DD` and must exist (`2026-02-31` is a 400). **Times**
  are `HH:MM`, 24-hour. Single-line fields refuse line breaks and control
  characters, because a newline in a title would forge a frontmatter key.
  `notes` and a moment's `text` may contain line breaks.
- **`null` clears** a field in a `PATCH`, where clearing makes sense (`cost`,
  `endDate`, `budgetTotal`, `address`, …).

## Errors

All errors are JSON: `{ "error": "what went wrong" }`.

| Status | When |
|---|---|
| 400 | Bad JSON, a bad field, an unknown field, a booking kind this version does not write |
| 401 | Token missing or wrong |
| 403 | Caller outside loopback/tailnet, or a write from another device with remote writes off |
| 404 | No such route, trip, booking or moment |
| 405 | Route exists, method does not |
| 413 | Body over 1 MB |
| 500 | `{ "error": "Internal error", "requestId": "…" }`. The full error is in Obsidian's console (`[awty/api] request … failed`) |

---

## Routes

### `GET /health`

Also answered at the bare base, `GET /awty/v1`.

```json
{
  "ok": true, "api": 1, "version": "2.36.0", "vault": "IWAN-REMOTE-VAULT",
  "revision": 1761480000, "today": "2026-10-26", "remoteWrites": false,
  "writableKinds": ["flight", "stay", "transport"],
  "counts": { "trips": 41, "bookings": 212 }
}
```

`api` is the contract version. It goes up when a route or a field changes
meaning. `version` is the plugin's.

---

### Trips

A trip as the API describes it:

```json
{
  "id": "t-0k3j9x2m1qa", "path": "Trips/2026/2026-11-10 Lisbon/Lisbon.md",
  "folder": "Trips/2026/2026-11-10 Lisbon",
  "title": "Lisbon", "kind": "city-break",
  "stage": "planning", "storedStage": "planning", "status": "upcoming",
  "startDate": "2026-11-10", "endDate": "2026-11-13",
  "country": "Portugal", "city": "Lisbon",
  "stops": [{ "country": "Portugal", "city": "Lisbon" }],
  "venue": null, "travellers": ["Iwan"], "originCity": "Amsterdam", "originAirport": "AMS",
  "budgetTotal": 1500, "passports": ["Netherlands"],
  "moments": 0, "bookings": 3
}
```

- `kind`: `holiday`, `city-break`, `day-trip`, `concert`, `event`, `business`.
- `stage`: `planning`, `going`, `went`, `cancelled`. `stage` has the calendar
  applied: a trip stored as `going` whose last day has passed reads `went`.
  `storedStage` is what the note says.
- `status`: `current`, `upcoming`, `past`, from the dates alone.
- `country`/`city` are the first stop's.
- In a list, `moments` and `bookings` are counts. In a detail they are the lists.

#### `GET /trips`

| Query | Meaning |
|---|---|
| `stage` | `planning`, `going`, `went`, `cancelled` (400 otherwise) |
| `status` | `current`, `upcoming`, `past` (400 otherwise) |
| `kind` | a trip kind |
| `q` | text in the title, a stop's city or country, or the venue (case-insensitive) |

```bash
curl -s "$AWTY/trips?stage=going" -H "Authorization: Bearer $AWTY_TOKEN"
```

`{ "trips": [ … ], "count": 3 }`, in the order the sidebar uses: current, then
upcoming soonest first, then past most recent first.

#### `GET /trips/:id`

`{ "trip": { …trip, "bookings": [ …booking ], "moments": [ …moment ] } }`

#### `POST /trips`

```json
{
  "title": "Porto", "startDate": "2027-03-01", "endDate": "2027-03-04",
  "kind": "city-break", "stage": "planning",
  "city": "Porto", "country": "Portugal",
  "stops": [{ "country": "Portugal", "city": "Porto" }],
  "venue": "", "travellers": ["Iwan"], "originCity": "Amsterdam", "originAirport": "AMS",
  "budgetTotal": 800, "passports": ["Netherlands"],
  "subNotes": ["itinerary", "accommodation", "budget"]
}
```

Only `title` and `startDate` are required. Anything left out gets the defaults
the **New trip** form uses: kind and stage from settings, the default country,
your household as travellers, your home city and airport as the origin, your
passports, and the sub-notes your settings pick for that kind.

- `stage` may only be `planning` or `going`. A trip cannot be born cancelled,
  and one with past dates reads as `went` by itself.
- `subNotes`: any of `itinerary`, `packing`, `accommodation`, `transport`,
  `budget`, `food`, `prices`.
- Single-day kinds (`day-trip`, `concert`, `event`) end on their start date,
  whatever `endDate` says.
- Either `stops`, or `country` + `city` for a single stop.

Replies `201 { "trip": { …detail }, "written": [ "…/Porto.md", "…/Itinerary.md", … ] }`.

#### `PATCH /trips/:id`

Send only what changes. Same fields as `POST`, except `subNotes`. `stage` may be
any of the four here, so a trip can be cancelled.

```bash
curl -s -X PATCH "$AWTY/trips/t-0k3j9x2m1qa" -H "Authorization: Bearer $AWTY_TOKEN" \
  -H 'content-type: application/json' -d '{"stage":"going","budgetTotal":1500}'
```

A new `title` or new dates can move the note and its folder (your folder
pattern decides), and the reply's `trip.id` is then the new id. Links to the
trip are rewritten by Obsidian, as with an edit in the trip form.

`200 { "trip": { …detail }, "written": [ … ] }`. `written` is `[]` when nothing changed.

#### `DELETE /trips/:id`

Sends the trip to wherever your **Deleted files** setting points (system trash,
`.trash`, or gone), exactly as the delete button does. It skips the confirmation
dialog. The whole folder goes when it holds just this trip. If your folder
pattern puts several trips in one folder, only the trip note goes.

`200 { "deleted": "t-…", "written": [ every file that went ] }`

---

### Bookings

Every booking kind can be **read**: `flight`, `stay`, `activity`, `transport`,
`restaurant`, `cruise`, `excursion`. This version **writes** `flight`, `stay`
and `transport`. A `PATCH` or `DELETE` on any other kind is a 400. `/health`
lists the writable kinds.

```json
{
  "id": "b-1x9c0v8n2lp", "tripId": "t-0k3j9x2m1qa",
  "path": "Trips/2026/2026-11-10 Lisbon/Bookings/KL1691.md",
  "kind": "flight", "status": "booked", "title": "KL1691",
  "date": "2026-11-10", "endDate": "2026-11-10", "time": null, "endTime": null,
  "cost": 189.5, "currency": "EUR", "category": "Transport",
  "reference": "ABC123", "from": "AMS", "to": "LIS", "operator": "KLM", "seat": "14A",
  "mode": null, "address": null, "fromAddress": null,
  "returnDate": null, "returnTime": null, "returnEndDate": null, "returnEndTime": null,
  "returnFrom": null, "returnTo": null, "returnOperator": null, "returnService": null,
  "legs": [{ "airline": "KLM", "flight": "KL1691", "from": "AMS", "to": "LIS",
             "date": "2026-11-10", "departs": "07:05", "arrivesOn": "2026-11-10",
             "arrives": "09:00", "separate": false, "cost": null }],
  "returnLegs": [],
  "attachments": []
}
```

- `status`: `idea`, `reserved`, `booked`, `cancelled`. Cancelled ones stay
  listed and drop out of the budget.
- `address` / `fromAddress`: `{ "line1", "line2", "postcode", "city", "country" }`, or `null`.
- `mode` (transport only): `train`, `bus`, `ferry`, `car`, `camper`, `metro`,
  `taxi`, `shuttle`, `bike`, `walk`, `other`.
- `notes` is accepted on writes and lands in the note's **Notes** section. It
  is not echoed in the booking JSON.

#### `GET /bookings`

| Query | Meaning |
|---|---|
| `trip` | a trip id (404 if there is no such trip) |
| `kind` | a booking kind (400 otherwise) |
| `status` | a booking status |

`{ "bookings": [ … ], "count": 12 }`

#### `GET /trips/:id/bookings`

The same as `GET /bookings?trip=:id`, and takes `kind` and `status` too.

#### `GET /bookings/:id`

`{ "booking": { … } }`

#### `POST /trips/:id/bookings`

`kind` and `title` are required. Everything else is optional and defaults the
way the booking wizard does: status `booked`, the kind's own cost category,
the trip's currency, and the trip's start date (a stay also takes the trip's
end date as its check-out).

**Flight.** Send `legs`. The booking's `date` becomes the first leg's, and
`from`/`to` default to the first departure and the last arrival. A flight sent
with only `from`, `to` and `date` (and optionally `time`) gets the one leg
those describe, so it still shows on the timeline and the map.

```json
{ "kind": "flight", "title": "TP669", "cost": 189.5, "currency": "EUR", "reference": "ABC123",
  "legs": [{ "airline": "TAP", "flight": "TP669", "from": "LIS", "to": "AMS",
             "date": "2026-11-13", "departs": "18:10", "arrives": "22:05" }],
  "returnLegs": [] }
```

Leg fields: `airline`, `flight`, `from`, `to`, `date` (required), `departs`,
`arrivesOn` (when it lands on a later day), `arrives`, `separate` (true when
this leg starts a new flight rather than continuing a connection), `cost`.

**Stay.**

```json
{ "kind": "stay", "title": "Hotel Avenida", "status": "reserved",
  "date": "2026-11-10", "endDate": "2026-11-13", "time": "15:00", "endTime": "11:00",
  "cost": 420, "address": { "line1": "Rua Augusta 1", "city": "Lisbon", "country": "Portugal" } }
```

**Transport.** A way back on the same booking is `returnDate` plus, optionally,
`returnTime`, `returnEndDate`, `returnEndTime`, `returnFrom`, `returnTo`,
`returnOperator`, `returnService`. Any of those without `returnDate` is a 400.

```json
{ "kind": "transport", "title": "Sintra train", "mode": "train",
  "date": "2026-11-11", "time": "09:00", "from": "Rossio", "to": "Sintra",
  "operator": "CP", "returnDate": "2026-11-11", "returnTime": "17:30" }
```

Fields that belong to another kind are refused rather than ignored: `legs` on a
stay, `mode` on a flight, `returnDate` on a flight (a flight's way home is its
`returnLegs`).

`201 { "booking": { … }, "written": [ the booking note, the Budget note, … ] }`

#### `PATCH /bookings/:id`

Send only what changes. `kind` cannot change; delete the booking and create
another. Moving a flight means sending its `legs`, because a flight leaves
when its first leg does, so `date` on its own is a 400. A new `title` renames
the note and gives the booking a new id.

`200 { "booking": { … }, "written": [ … ] }`. `written` is `[]` when nothing changed.

#### `DELETE /bookings/:id`

Trashes the note (per your **Deleted files** setting), unhooks any price check
that pointed at it, and regenerates the trip's budget table.

`200 { "deleted": "b-…", "written": [ … ] }`

---

### Moments (the trip story)

What you want to remember about a trip, kept on the trip note. It lives in
the frontmatter for the dashboard and in the note's **Moments** section for
whoever reads it in five years.

```json
{ "id": "m-3n8b1k0c7zq", "date": "2025-04-02", "title": null, "text": "Gelato twice before noon" }
```

`date` is optional, because some moments belong to the whole trip, and so is
`title`. `text` is required and may contain line breaks. Lists come in the order
the trip shows them: by date, undated ones last.

#### `GET /trips/:id/moments`

`{ "moments": [ … ], "count": 2 }`

#### `GET /trips/:id/moments/:mid`

`{ "moment": { … } }`

#### `POST /trips/:id/moments`

```json
{ "date": "2025-04-03", "title": "The long way round", "text": "The plan was simple.\n\nIt was not." }
```

`201 { "moment": { … }, "written": [ "…/Rome.md" ] }`

#### `PATCH /trips/:id/moments/:mid`

Any of `date`, `title`, `text`. `null` or `""` clears `date` and `title`. The
reply carries the moment's new id.

`200 { "moment": { … }, "written": [ … ] }`. `written` is `[]` when nothing changed.

#### `DELETE /trips/:id/moments/:mid`

`200 { "deleted": "m-…", "written": [ "…/Rome.md" ] }`

---

## From another device (Tailscale)

1. Settings → Local API → **Reachable from** → *Tailscale*. The base URL changes
   to `http://100.x.y.z:27131/awty/v1`. If Tailscale is not running, the API
   says so and stays on `127.0.0.1`.
2. Reads work straight away with the token.
3. Writes from the other device get a 403 until **Allow writes from other
   devices** is on.

```bash
# from the phone, a Shortcut, or another Mac on the tailnet
curl -s http://100.99.205.96:27131/awty/v1/trips?stage=going -H "Authorization: Bearer $AWTY_TOKEN"
```
