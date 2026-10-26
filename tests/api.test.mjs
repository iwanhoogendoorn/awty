/*
 * The local API, driven over real HTTP against an in-memory vault.
 *
 * The routes and the server are bundled exactly as they ship; only the deps —
 * the part that touches Obsidian — are a fake, which keeps trips, bookings and
 * moments in plain arrays and logs every path a write would have touched.
 *
 * Run with: node tests/api.test.mjs
 */
import assert from "node:assert/strict";
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const entry = `
export { handle } from "./src/api/routes.ts";
export { startApiServer, sameToken, randomToken } from "./src/api/server.ts";
export { isTailscaleAddress, isLoopbackClient, isAllowedClient, tailscaleAddress, resolveBindHost, apiUrl } from "./src/api/bind.ts";
export { API_BASE, API_VERSION, DEFAULT_API_PORT } from "./src/api/base.ts";
export { tripId, bookingId, momentIds } from "./src/api/json.ts";
export { emptyBookingDraft, newTripDraft, patchTripDraft, newBookingDraft, patchBookingDraft, sameBooking, sameTrip, WRITABLE_KINDS } from "./src/api/input.ts";
export { DEFAULT_SETTINGS } from "./src/types.ts";
`;

const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "awty-api-test-")), "bundle.mjs");
await esbuild.build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts" },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2020",
  external: ["obsidian"],
  outfile,
  logLevel: "error",
  // The server requires node's http at run time; an ESM bundle has no require.
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
const m = await import(outfile);

const TOKEN = "test-token-0123456789";
const TODAY = "2026-10-26";

// ---------------------------------------------------------------- the fake

const file = (p) => ({ path: p, basename: p.split("/").pop().replace(/\.md$/, ""), extension: "md" });

function makeTrip(over = {}) {
  const title = over.title ?? "Lisbon";
  const folder = over.folderPath ?? `Trips/2026/${over.startDate ?? "2026-11-10"} ${title}`;
  return {
    file: file(`${folder}/${title}.md`),
    folderPath: folder,
    title,
    kind: "city-break",
    country: "Portugal",
    city: "Lisbon",
    stops: [{ country: "Portugal", city: "Lisbon" }],
    venue: "",
    startDate: "2026-11-10",
    endDate: "2026-11-13",
    status: "upcoming",
    stage: "planning",
    storedStage: "planning",
    stageImplied: false,
    travellers: ["Iwan"],
    originCity: "Amsterdam",
    originAirport: "AMS",
    budgetTotal: null,
    passports: ["Netherlands"],
    entryDone: [],
    moments: [],
    ...over,
  };
}

const EMPTY_POSTAL = { line1: "", line2: "", postcode: "", city: "", country: "" };

function bookingFromDraft(trip, p, draft) {
  return {
    file: file(p),
    tripFolder: trip.folderPath,
    kind: draft.kind,
    status: draft.status,
    title: draft.title,
    date: draft.date,
    endDate: draft.endDate || draft.date,
    time: draft.time,
    endTime: draft.endTime,
    slot: "",
    returnDate: draft.returnDate,
    returnTime: draft.returnTime,
    returnEndDate: draft.returnEndDate,
    returnEndTime: draft.returnEndTime,
    returnFrom: draft.returnFrom,
    returnTo: draft.returnTo,
    returnOperator: draft.returnOperator,
    returnService: draft.returnService,
    cost: draft.amount === null ? null : { amount: draft.amount, currency: draft.currency },
    category: draft.category,
    reference: draft.reference,
    from: draft.from,
    to: draft.to,
    address: "",
    postal: { ...draft.postal },
    fromAddress: "",
    fromPostal: { ...draft.fromPostal },
    operator: draft.operator,
    seat: draft.seat,
    notes: draft.notes,
    attachments: [],
    journeys: [],
    legs: draft.legs,
    returnLegs: draft.returnLegs,
    ports: [],
    where: "",
    cruise: "",
    mode: draft.mode,
  };
}

/** A vault in memory, with deps over it. `remoteWrites` and the trip list can be poked by a test. */
function fakeVault() {
  const state = { trips: [], bookings: new Map(), rev: 1000, remoteWrites: false, writes: 0 };
  let log = null;
  const touch = (...paths) => paths.forEach((p) => log?.add(p));

  const lisbon = makeTrip();
  const gig = makeTrip({ title: "Ghent gig", kind: "concert", folderPath: "Trips/2026/2026-12-05 Ghent gig", startDate: "2026-12-05", endDate: "2026-12-05", country: "Belgium", city: "Ghent", stops: [{ country: "Belgium", city: "Ghent" }], stage: "going", storedStage: "going", venue: "Vooruit" });
  const rome = makeTrip({ title: "Rome", folderPath: "Trips/2025/2025-04-01 Rome", startDate: "2025-04-01", endDate: "2025-04-05", status: "past", stage: "went", storedStage: "went", country: "Italy", city: "Rome", stops: [{ country: "Italy", city: "Rome" }],
    moments: [{ date: "2025-04-02", title: "", text: "Gelato twice before noon" }, { date: "", title: "The light", text: "Every evening, gold." }] });
  state.trips.push(lisbon, gig, rome);

  const draft = (kind, over) => ({ ...m.emptyBookingDraft(kind, lisbon, "EUR"), ...over });
  state.bookings.set(lisbon.folderPath, [
    bookingFromDraft(lisbon, `${lisbon.folderPath}/Bookings/KL1691.md`, draft("flight", { title: "KL1691", from: "AMS", to: "LIS", operator: "KLM", legs: [{ operator: "KLM", number: "KL1691", from: "AMS", to: "LIS", date: "2026-11-10", depTime: "07:05", arrDate: "2026-11-10", arrTime: "09:00" }] })),
    bookingFromDraft(lisbon, `${lisbon.folderPath}/Bookings/Hotel Avenida.md`, draft("stay", { title: "Hotel Avenida", amount: 420, currency: "EUR" })),
    bookingFromDraft(lisbon, `${lisbon.folderPath}/Bookings/Fado night.md`, { ...draft("activity", { title: "Fado night" }) }),
  ]);
  state.bookings.set(gig.folderPath, []);
  state.bookings.set(rome.folderPath, []);

  const reid = (trip, newTitle) => {
    const folder = trip.folderPath.replace(/[^/]+$/, `${trip.startDate} ${newTitle}`);
    return { ...trip, title: newTitle, folderPath: folder, file: file(`${folder}/${newTitle}.md`) };
  };
  const swapTrip = (old, next) => {
    state.trips = state.trips.map((t) => (t === old ? next : t));
    const b = state.bookings.get(old.folderPath) ?? [];
    state.bookings.delete(old.folderPath);
    state.bookings.set(next.folderPath, b);
  };

  const deps = {
    version: "9.9.9",
    vaultName: "Test vault",
    today: () => TODAY,
    revision: () => state.rev,
    remoteWrites: () => state.remoteWrites,
    settings: () => ({ ...m.DEFAULT_SETTINGS, household: ["Iwan"], homeCity: "Amsterdam", homeAirport: "AMS" }),
    trips: () => state.trips,
    bookings: (trip) => state.bookings.get(trip.folderPath) ?? [],
    currency: () => "EUR",
    write: async (fn) => {
      log = new Set();
      try {
        const value = await fn();
        state.writes += 1;
        return { value, written: [...log].sort() };
      } finally {
        if (log.size > 0) state.rev += 1;
        log = null;
      }
    },
    createTrip: async (d) => {
      const folder = `Trips/${d.startDate.slice(0, 4)}/${d.startDate} ${d.title}`;
      const trip = makeTrip({ ...d, folderPath: folder, file: file(`${folder}/${d.title}.md`), storedStage: d.stage, moments: [] });
      state.trips.push(trip);
      state.bookings.set(folder, []);
      touch(trip.file.path, ...d.subNotes.map((s) => `${folder}/${s}.md`));
      return trip.file.path;
    },
    updateTrip: async (trip, d) => {
      const next = d.title !== trip.title ? reid(trip, d.title) : { ...trip };
      Object.assign(next, { kind: d.kind, stage: d.stage, storedStage: d.stage, startDate: d.startDate, endDate: d.endDate, stops: d.stops, country: d.country, city: d.city, venue: d.venue, travellers: d.travellers, passports: d.passports, budgetTotal: d.budgetTotal, originCity: d.originCity, originAirport: d.originAirport });
      swapTrip(trip, next);
      touch(trip.file.path, next.file.path);
      return next.file.path;
    },
    deleteTrip: async (trip) => {
      state.trips = state.trips.filter((t) => t !== trip);
      const gone = (state.bookings.get(trip.folderPath) ?? []).map((b) => b.file.path);
      state.bookings.delete(trip.folderPath);
      touch(trip.file.path, ...gone);
    },
    bookingDraft: async (trip, b) => ({
      ...m.emptyBookingDraft(b.kind, trip, "EUR"),
      kind: b.kind, status: b.status, title: b.title, date: b.date, endDate: b.endDate, time: b.time, endTime: b.endTime,
      amount: b.cost ? b.cost.amount : null, currency: b.cost?.currency ?? "EUR", category: b.category, reference: b.reference,
      from: b.from, to: b.to, operator: b.operator, seat: b.seat, notes: b.notes, postal: { ...b.postal }, fromPostal: { ...b.fromPostal },
      legs: b.legs, returnLegs: b.returnLegs, mode: b.mode,
      returnDate: b.returnDate, returnTime: b.returnTime, returnEndDate: b.returnEndDate, returnEndTime: b.returnEndTime,
      returnFrom: b.returnFrom, returnTo: b.returnTo, returnOperator: b.returnOperator, returnService: b.returnService,
    }),
    createBooking: async (trip, d) => {
      const p = `${trip.folderPath}/Bookings/${d.title}.md`;
      state.bookings.get(trip.folderPath).push(bookingFromDraft(trip, p, d));
      touch(p, `${trip.folderPath}/Budget.md`);
      return p;
    },
    updateBooking: async (trip, b, d) => {
      const p = `${trip.folderPath}/Bookings/${d.title}.md`;
      const list = state.bookings.get(trip.folderPath);
      list[list.indexOf(b)] = bookingFromDraft(trip, p, d);
      touch(b.file.path, p);
      return p;
    },
    deleteBooking: async (trip, b) => {
      const list = state.bookings.get(trip.folderPath);
      list.splice(list.indexOf(b), 1);
      touch(b.file.path, `${trip.folderPath}/Budget.md`);
    },
    saveMoments: async (trip, moments) => {
      const next = { ...trip, moments: moments.map((x) => ({ ...x })) };
      swapTrip(trip, next);
      touch(trip.file.path);
    },
  };
  return { state, deps, lisbon, gig, rome };
}

// ------------------------------------------------------------- the harness

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (err) {
    failures.push(name);
    console.error(`FAIL: ${name}\n`, err);
  }
}

/** A server over a fresh fake vault. `remote: true` makes every client look like another device. */
async function serve({ remote = false, token = TOKEN, allowClient } = {}) {
  const vault = fakeVault();
  const server = await m.startApiServer({
    port: 0,
    host: "127.0.0.1",
    token,
    deps: vault.deps,
    allowRemoteWrites: () => vault.state.remoteWrites,
    ...(remote ? { isLocal: () => false } : {}),
    ...(allowClient ? { allowClient } : {}),
  });
  const base = `http://127.0.0.1:${server.port}${m.API_BASE}`;
  const call = async (method, route, body, opts = {}) => {
    const headers = { ...(opts.auth === false ? {} : { authorization: `Bearer ${opts.token ?? TOKEN}` }) };
    let payload;
    if (opts.raw !== undefined) payload = opts.raw;
    else if (body !== undefined) payload = JSON.stringify(body);
    if (payload !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${opts.base ?? base}${route}`, { method, headers, body: payload });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, revision: res.headers.get("x-awty-revision") };
  };
  return { ...vault, server, call, base, close: () => server.close() };
}

/** Runs a test against a fresh server and always closes it. */
const withServer = (opts, fn) => async () => {
  const s = await serve(opts);
  try {
    await fn(s);
  } finally {
    s.close();
  }
};

// ------------------------------------------------------------ bind & token

await test("Tailscale addresses are 100.64.0.0/10 and nothing else", () => {
  assert.equal(m.isTailscaleAddress("100.99.205.96"), true);
  assert.equal(m.isTailscaleAddress("100.64.0.1"), true);
  assert.equal(m.isTailscaleAddress("100.127.255.255"), true);
  assert.equal(m.isTailscaleAddress("100.128.0.1"), false);
  assert.equal(m.isTailscaleAddress("100.63.0.1"), false);
  assert.equal(m.isTailscaleAddress("192.168.1.10"), false);
  assert.equal(m.isTailscaleAddress("::ffff:100.99.205.96"), true);
});

await test("only loopback counts as this machine", () => {
  assert.equal(m.isLoopbackClient("127.0.0.1"), true);
  assert.equal(m.isLoopbackClient("::1"), true);
  assert.equal(m.isLoopbackClient("::ffff:127.0.0.1"), true);
  assert.equal(m.isLoopbackClient("100.99.205.96"), false, "this Mac's own Tailscale address is another device");
  assert.equal(m.isLoopbackClient(undefined), false);
  assert.equal(m.isAllowedClient("100.70.1.2"), true);
  assert.equal(m.isAllowedClient("192.168.1.10"), false, "the LAN is not on the list");
  assert.equal(m.isAllowedClient("8.8.8.8"), false);
});

await test("a Tailscale bind without Tailscale falls back to loopback and says so", () => {
  const ifaces = {
    lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    en0: [{ address: "192.168.1.20", family: "IPv4", internal: false }],
  };
  assert.deepEqual(m.resolveBindHost("loopback", ifaces), { host: "127.0.0.1" });
  const none = m.resolveBindHost("tailscale", ifaces);
  assert.equal(none.host, "127.0.0.1");
  assert.match(none.fallback, /Tailscale/);
  const up = { ...ifaces, utun4: [{ address: "100.99.205.96", family: "IPv4", internal: false }] };
  assert.deepEqual(m.resolveBindHost("tailscale", up), { host: "100.99.205.96" });
  assert.equal(m.apiUrl("100.99.205.96", 27131), "http://100.99.205.96:27131/awty/v1");
});

await test("defaults: off, port 27131, loopback, no remote writes", () => {
  assert.equal(m.DEFAULT_API_PORT, 27131);
  assert.equal(m.API_BASE, "/awty/v1");
  assert.equal(m.DEFAULT_SETTINGS.apiEnabled, false);
  assert.equal(m.DEFAULT_SETTINGS.apiPort, 27131);
  assert.equal(m.DEFAULT_SETTINGS.apiBind, "loopback");
  assert.equal(m.DEFAULT_SETTINGS.apiRemoteWrites, false);
  assert.equal(m.DEFAULT_SETTINGS.apiToken, "");
});

await test("tokens are compared whole, and new ones are 48 hex characters", () => {
  assert.equal(m.sameToken("abc", "abc"), true);
  assert.equal(m.sameToken("abc", "abcd"), false);
  assert.equal(m.sameToken("", "abc"), false);
  assert.match(m.randomToken(), /^[0-9a-f]{48}$/);
  assert.notEqual(m.randomToken(), m.randomToken());
});

// -------------------------------------------------------------------- auth

await test("401 without a token, with a wrong one, and with an empty server token", withServer({}, async (s) => {
  for (const route of ["/health", "/trips", "/bookings", `/trips/${m.tripId(s.lisbon)}/moments`]) {
    const none = await s.call("GET", route, undefined, { auth: false });
    assert.equal(none.status, 401, route);
    assert.equal(none.revision, null, "the revision is only told to an authenticated caller");
    assert.equal((await s.call("GET", route, undefined, { token: "nope" })).status, 401, route);
  }
  // Writes are refused for the token before anything else is looked at.
  assert.equal((await s.call("POST", "/trips", { title: "X", startDate: "2026-01-01" }, { auth: false })).status, 401);
  assert.equal((await s.call("PATCH", `/trips/${m.tripId(s.lisbon)}`, { title: "X" }, { auth: false })).status, 401);
  assert.equal((await s.call("DELETE", `/bookings/${m.bookingId(s.deps.bookings(s.lisbon)[0])}`, undefined, { auth: false })).status, 401);
  assert.equal(s.state.writes, 0);
  const blank = await serve({ token: "" });
  try {
    assert.equal((await blank.call("GET", "/health", undefined, { token: "" })).status, 401, "an empty token never authenticates");
  } finally {
    blank.close();
  }
}));

await test("a client outside loopback and the tailnet is refused before auth", async () => {
  const s = await serve({ allowClient: () => false });
  try {
    const r = await s.call("GET", "/health");
    assert.equal(r.status, 403);
    assert.equal(r.revision, null);
  } finally {
    s.close();
  }
});

await test("paths outside /awty/v1 are 404, unknown routes are 404, wrong methods are 405", withServer({}, async (s) => {
  const root = s.base.replace(m.API_BASE, "");
  assert.equal((await s.call("GET", "/helm/v1/health", undefined, { base: root })).status, 404);
  assert.equal((await s.call("GET", "/awty/v10/health", undefined, { base: root })).status, 404);
  assert.equal((await s.call("GET", "/nope")).status, 404);
  assert.equal((await s.call("POST", "/health", {})).status, 405);
  assert.equal((await s.call("PUT", "/trips", {})).status, 405);
  assert.equal((await s.call("POST", "/bookings", {})).status, 405);
  assert.equal((await s.call("PUT", `/trips/${m.tripId(s.lisbon)}`, {})).status, 405);
}));

// ------------------------------------------------------------------ health

await test("GET /health", withServer({}, async (s) => {
  const r = await s.call("GET", "/health");
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.api, 1);
  assert.equal(r.body.version, "9.9.9");
  assert.equal(r.body.vault, "Test vault");
  assert.equal(r.body.today, TODAY);
  assert.equal(r.body.revision, 1000);
  assert.equal(r.body.remoteWrites, false);
  assert.deepEqual(r.body.writableKinds, ["flight", "stay", "transport"]);
  assert.deepEqual(r.body.counts, { trips: 3, bookings: 3 });
  assert.equal(r.revision, "1000");
  // The base on its own answers like /health.
  assert.equal((await s.call("GET", "")).body.ok, true);
}));

// ------------------------------------------------------------------- trips

await test("GET /trips lists every trip with ids and counts", withServer({}, async (s) => {
  const r = await s.call("GET", "/trips");
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 3);
  const lisbon = r.body.trips.find((t) => t.title === "Lisbon");
  assert.equal(lisbon.id, m.tripId(s.lisbon));
  assert.match(lisbon.id, /^t-[0-9a-z]{11}$/);
  assert.equal(lisbon.path, s.lisbon.file.path);
  assert.equal(lisbon.bookings, 3);
  assert.equal(lisbon.moments, 0);
  assert.deepEqual(lisbon.stops, [{ country: "Portugal", city: "Lisbon" }]);
  assert.equal(lisbon.venue, null);
}));

await test("GET /trips filters by stage, status, kind and text, and refuses an unknown stage", withServer({}, async (s) => {
  assert.deepEqual((await s.call("GET", "/trips?stage=going")).body.trips.map((t) => t.title), ["Ghent gig"]);
  assert.deepEqual((await s.call("GET", "/trips?status=past")).body.trips.map((t) => t.title), ["Rome"]);
  assert.deepEqual((await s.call("GET", "/trips?kind=concert")).body.trips.map((t) => t.title), ["Ghent gig"]);
  assert.deepEqual((await s.call("GET", "/trips?q=portugal")).body.trips.map((t) => t.title), ["Lisbon"]);
  assert.deepEqual((await s.call("GET", "/trips?q=vooruit")).body.trips.map((t) => t.title), ["Ghent gig"]);
  assert.equal((await s.call("GET", "/trips?stage=booked")).status, 400);
  assert.equal((await s.call("GET", "/trips?status=soon")).status, 400);
}));

await test("GET /trips/:id returns the trip with its bookings and moments; 404 otherwise", withServer({}, async (s) => {
  const r = await s.call("GET", `/trips/${m.tripId(s.rome)}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.trip.title, "Rome");
  assert.deepEqual(r.body.trip.bookings, []);
  assert.deepEqual(r.body.trip.moments.map((x) => x.text), ["Gelato twice before noon", "Every evening, gold."], "dated first, undated last");
  const l = await s.call("GET", `/trips/${m.tripId(s.lisbon)}`);
  assert.equal(l.body.trip.bookings.length, 3);
  assert.equal(l.body.trip.bookings[0].tripId, m.tripId(s.lisbon));
  assert.equal((await s.call("GET", "/trips/t-doesnotexist")).status, 404);
}));

await test("POST /trips creates a trip with the new-trip defaults and lists what it wrote", withServer({}, async (s) => {
  const before = (await s.call("GET", "/health")).revision;
  const r = await s.call("POST", "/trips", { title: "AWTY-API-TEST Porto", startDate: "2027-03-01", endDate: "2027-03-04", city: "Porto", country: "Portugal" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.trip.title, "AWTY-API-TEST Porto");
  assert.equal(r.body.trip.stage, "planning", "the default stage");
  assert.equal(r.body.trip.kind, "holiday", "the default kind");
  assert.deepEqual(r.body.trip.travellers, ["Iwan"], "the household comes along");
  assert.equal(r.body.trip.originAirport, "AMS");
  assert.deepEqual(r.body.trip.stops, [{ country: "Portugal", city: "Porto" }]);
  assert.ok(r.body.written.includes(r.body.trip.path));
  assert.ok(r.body.written.length > 1, "the sub-notes are listed too");
  assert.equal(Number(r.revision), Number(before) + 1);
  // A single-day kind ends the day it starts, whatever was sent.
  const gig = await s.call("POST", "/trips", { title: "AWTY-API-TEST Gig", kind: "concert", startDate: "2027-05-05", endDate: "2027-05-09", venue: "AB", subNotes: ["itinerary"], stage: "going" });
  assert.equal(gig.status, 201);
  assert.equal(gig.body.trip.endDate, "2027-05-05");
  assert.equal(gig.body.trip.stage, "going");
  assert.equal(gig.body.written.length, 2);
  // Multiple stops, the first mirrored into country and city.
  const route = await s.call("POST", "/trips", { title: "AWTY-API-TEST Balkans", startDate: "2027-06-01", endDate: "2027-06-10", stops: [{ country: "Croatia", city: "Dubrovnik" }, { country: "Montenegro", city: "Kotor" }] });
  assert.equal(route.body.trip.country, "Croatia");
  assert.equal(route.body.trip.stops.length, 2);
}));

await test("POST /trips: 400 for every kind of bad input, and nothing is written", withServer({}, async (s) => {
  const cases = [
    [{}, /title is required/],
    [{ title: "X" }, /startDate is required/],
    [{ title: "", startDate: "2027-01-01" }, /title must not be empty/],
    [{ title: "X", startDate: "2027-02-31" }, /real date/],
    [{ title: "X", startDate: "01-02-2027" }, /real date/],
    [{ title: "X", startDate: "2027-01-05", endDate: "2027-01-01" }, /before startDate/],
    [{ title: "X", startDate: "2027-01-01", kind: "cruise" }, /kind must be/],
    [{ title: "X", startDate: "2027-01-01", stage: "cancelled" }, /planning or going/],
    [{ title: "X", startDate: "2027-01-01", stage: "went" }, /planning or going/],
    [{ title: "X\nstage: cancelled", startDate: "2027-01-01" }, /line breaks/],
    [{ title: "X", start_date: "2027-01-01" }, /Unknown field: start_date/],
    [{ title: "X", startDate: "2027-01-01", budgetTotal: -5 }, /budgetTotal/],
    [{ title: "X", startDate: "2027-01-01", budgetTotal: "lots" }, /budgetTotal/],
    [{ title: "X", startDate: "2027-01-01", travellers: "Iwan" }, /travellers must be a list/],
    [{ title: "X", startDate: "2027-01-01", stops: [{ country: "PT", town: "Porto" }] }, /Unknown field: town/],
    [{ title: "X", startDate: "2027-01-01", subNotes: ["event-details"] }, /subNotes/],
    [{ title: 42, startDate: "2027-01-01" }, /title must be a string/],
  ];
  for (const [body, message] of cases) {
    const r = await s.call("POST", "/trips", body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.error, message, JSON.stringify(body));
  }
  assert.equal((await s.call("POST", "/trips", [1, 2])).status, 400, "an array is not an object");
  assert.equal((await s.call("POST", "/trips", undefined, { raw: "{not json" })).status, 400);
  assert.equal(s.state.writes, 0);
  assert.equal(s.state.rev, 1000, "a refused write is no write");
}));

await test("PATCH /trips/:id changes only what it names, and follows a rename to the new id", withServer({}, async (s) => {
  const id = m.tripId(s.lisbon);
  const r = await s.call("PATCH", `/trips/${id}`, { budgetTotal: 1500, travellers: ["Iwan", "Zaara"] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.trip.budgetTotal, 1500);
  assert.deepEqual(r.body.trip.travellers, ["Iwan", "Zaara"]);
  assert.equal(r.body.trip.title, "Lisbon", "untouched");
  assert.equal(r.body.trip.startDate, "2026-11-10", "untouched");
  assert.deepEqual(r.body.written, [s.lisbon.file.path]);

  const renamed = await s.call("PATCH", `/trips/${id}`, { title: "Lisbon & Sintra", stage: "going" });
  assert.equal(renamed.status, 200);
  assert.notEqual(renamed.body.trip.id, id, "a new title is a new path, and the id follows the path");
  assert.equal(renamed.body.trip.stage, "going");
  assert.equal((await s.call("GET", `/trips/${renamed.body.trip.id}`)).status, 200);
  assert.equal((await s.call("GET", `/trips/${id}`)).status, 404);

  // An existing trip may be cancelled; a new one may not.
  const cancelled = await s.call("PATCH", `/trips/${renamed.body.trip.id}`, { stage: "cancelled" });
  assert.equal(cancelled.body.trip.stage, "cancelled");
}));

await test("PATCH /trips/:id with nothing new writes nothing and leaves the revision alone", withServer({}, async (s) => {
  const id = m.tripId(s.lisbon);
  const r = await s.call("PATCH", `/trips/${id}`, { title: "Lisbon", city: "Lisbon", startDate: "2026-11-10" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.written, []);
  assert.equal(r.revision, "1000");
  assert.equal(s.state.writes, 0);
  const empty = await s.call("PATCH", `/trips/${id}`, {});
  assert.deepEqual(empty.body.written, []);
  assert.equal(empty.revision, "1000");
}));

await test("PATCH /trips/:id: 400 on bad input, 404 on an unknown trip", withServer({}, async (s) => {
  const id = m.tripId(s.lisbon);
  for (const body of [{ kind: "spa" }, { stage: "booked" }, { endDate: "2026-11-01" }, { startDate: null }, { title: "" }, { colour: "red" }, { venue: "A\u0000B" }]) {
    assert.equal((await s.call("PATCH", `/trips/${id}`, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await s.call("PATCH", "/trips/t-nope", { title: "X" })).status, 404);
  assert.equal(s.state.writes, 0);
}));

await test("DELETE /trips/:id removes the trip and lists its files; 404 after", withServer({}, async (s) => {
  const id = m.tripId(s.lisbon);
  const r = await s.call("DELETE", `/trips/${id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted, id);
  assert.ok(r.body.written.includes(s.lisbon.file.path));
  assert.ok(r.body.written.some((p) => p.endsWith("KL1691.md")), "its bookings went with it");
  assert.equal(Number(r.revision), 1001);
  assert.equal((await s.call("GET", `/trips/${id}`)).status, 404);
  assert.equal((await s.call("DELETE", `/trips/${id}`)).status, 404);
  assert.equal((await s.call("GET", "/trips")).body.count, 2);
}));

// ---------------------------------------------------------------- bookings

await test("GET /bookings lists every booking, filterable by trip, kind and status", withServer({}, async (s) => {
  const all = await s.call("GET", "/bookings");
  assert.equal(all.status, 200);
  assert.equal(all.body.count, 3);
  const flight = all.body.bookings.find((b) => b.kind === "flight");
  assert.match(flight.id, /^b-[0-9a-z]{11}$/);
  assert.equal(flight.legs[0].flight, "KL1691");
  assert.equal(flight.legs[0].departs, "07:05");
  assert.equal((await s.call("GET", "/bookings?kind=stay")).body.count, 1);
  assert.equal((await s.call("GET", "/bookings?status=cancelled")).body.count, 0);
  assert.equal((await s.call("GET", `/bookings?trip=${m.tripId(s.gig)}`)).body.count, 0);
  assert.equal((await s.call("GET", `/bookings?trip=${m.tripId(s.lisbon)}`)).body.count, 3);
  assert.equal((await s.call("GET", "/bookings?trip=t-nope")).status, 404);
  assert.equal((await s.call("GET", "/bookings?kind=spaceship")).status, 400);
}));

await test("GET /trips/:id/bookings and GET /bookings/:id", withServer({}, async (s) => {
  const list = await s.call("GET", `/trips/${m.tripId(s.lisbon)}/bookings?kind=flight`);
  assert.equal(list.status, 200);
  assert.equal(list.body.count, 1);
  const id = list.body.bookings[0].id;
  const one = await s.call("GET", `/bookings/${id}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.booking.title, "KL1691");
  assert.equal(one.body.booking.path, `${s.lisbon.folderPath}/Bookings/KL1691.md`);
  assert.equal((await s.call("GET", "/bookings/b-nope")).status, 404);
  assert.equal((await s.call("GET", "/trips/t-nope/bookings")).status, 404);
}));

await test("POST /trips/:id/bookings creates a flight, a stay and a transfer", withServer({}, async (s) => {
  const trip = m.tripId(s.lisbon);
  const flight = await s.call("POST", `/trips/${trip}/bookings`, {
    kind: "flight", title: "AWTY-API-TEST TP669", cost: 189.5, currency: "eur", reference: "ABC123",
    legs: [{ airline: "TAP", flight: "TP669", from: "LIS", to: "AMS", date: "2026-11-13", departs: "18:10", arrives: "22:05" }],
  });
  assert.equal(flight.status, 201, JSON.stringify(flight.body));
  assert.equal(flight.body.booking.date, "2026-11-13", "a flight leaves when its first leg does");
  assert.equal(flight.body.booking.from, "LIS");
  assert.equal(flight.body.booking.to, "AMS");
  assert.equal(flight.body.booking.cost, 189.5);
  assert.equal(flight.body.booking.currency, "EUR");
  assert.equal(flight.body.booking.status, "booked");
  assert.equal(flight.body.booking.category, "Transport");
  assert.ok(flight.body.written.includes(flight.body.booking.path));

  // A flight sent as a route and a date gets the one leg that says so.
  const simple = await s.call("POST", `/trips/${trip}/bookings`, { kind: "flight", title: "AWTY-API-TEST simple", from: "AMS", to: "OPO", date: "2026-11-10", time: "06:30" });
  assert.equal(simple.status, 201);
  assert.equal(simple.body.booking.legs.length, 1);
  assert.equal(simple.body.booking.legs[0].departs, "06:30");

  const stay = await s.call("POST", `/trips/${trip}/bookings`, { kind: "stay", title: "AWTY-API-TEST Hotel", status: "reserved", address: { line1: "Rua Augusta 1", city: "Lisbon", country: "Portugal" } });
  assert.equal(stay.status, 201);
  assert.equal(stay.body.booking.date, "2026-11-10", "a stay starts with the trip");
  assert.equal(stay.body.booking.endDate, "2026-11-13", "and ends with it");
  assert.equal(stay.body.booking.status, "reserved");
  assert.equal(stay.body.booking.address.line1, "Rua Augusta 1");
  assert.equal(stay.body.booking.category, "Accommodation");

  const train = await s.call("POST", `/trips/${trip}/bookings`, { kind: "transport", title: "AWTY-API-TEST Sintra train", mode: "train", date: "2026-11-11", time: "09:00", from: "Rossio", to: "Sintra", returnDate: "2026-11-11", returnTime: "17:30" });
  assert.equal(train.status, 201, JSON.stringify(train.body));
  assert.equal(train.body.booking.mode, "train");
  assert.equal(train.body.booking.returnTime, "17:30");
  assert.equal((await s.call("GET", `/bookings?trip=${trip}`)).body.count, 7);
}));

await test("POST /trips/:id/bookings: 400 on bad input, 404 on an unknown trip", withServer({}, async (s) => {
  const trip = m.tripId(s.lisbon);
  const cases = [
    [{ title: "X" }, /kind must be one of flight, stay, transport/],
    [{ kind: "activity", title: "X" }, /kind must be one of/],
    [{ kind: "stay" }, /title is required/],
    [{ kind: "stay", title: "X", legs: [] }, /legs cannot be set on a stay/],
    [{ kind: "flight", title: "X", returnDate: "2026-11-13" }, /returnDate cannot be set on a flight/],
    [{ kind: "stay", title: "X", mode: "train" }, /mode cannot be set on a stay/],
    [{ kind: "transport", title: "X", mode: "teleport" }, /mode must be one of/],
    [{ kind: "transport", title: "X", time: "25:00" }, /HH:MM/],
    [{ kind: "stay", title: "X", date: "2026-11-12", endDate: "2026-11-11" }, /endDate must not be before date/],
    [{ kind: "stay", title: "X", cost: "100" }, /cost must be a number/],
    [{ kind: "stay", title: "X", cost: 10, currency: "euro" }, /currency/],
    [{ kind: "stay", title: "X", status: "maybe" }, /status must be one of/],
    [{ kind: "stay", title: "X", address: { street: "x" } }, /Unknown field: street/],
    [{ kind: "flight", title: "X", legs: [{ from: "AMS", to: "LIS" }] }, /legs\[0\]\.date is required/],
    [{ kind: "flight", title: "X", legs: [{ date: "2026-11-10", arrivesOn: "2026-11-09" }] }, /arrivesOn/],
    [{ kind: "transport", title: "X", returnTime: "18:00" }, /returnDate is required/],
    [{ kind: "stay", title: "X", seat: "1A\n2B" }, /line breaks/],
    [{ kind: "stay", title: "X", price: 10 }, /Unknown field: price/],
  ];
  for (const [body, message] of cases) {
    const r = await s.call("POST", `/trips/${trip}/bookings`, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.error, message, JSON.stringify(body));
  }
  assert.equal((await s.call("POST", "/trips/t-nope/bookings", { kind: "stay", title: "X" })).status, 404);
  assert.equal(s.state.writes, 0);
}));

await test("PATCH /bookings/:id changes what it names; a no-op writes nothing", withServer({}, async (s) => {
  const stay = s.deps.bookings(s.lisbon).find((b) => b.kind === "stay");
  const id = m.bookingId(stay);
  const r = await s.call("PATCH", `/bookings/${id}`, { status: "cancelled", notes: "Overbooked.\nMoved to the Avenida Palace." });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.booking.status, "cancelled");
  assert.equal(r.body.booking.cost, 420, "untouched");
  assert.equal(r.body.booking.id, id, "same title, same path, same id");
  assert.ok(r.body.written.length > 0);
  const rev = r.revision;

  const same = await s.call("PATCH", `/bookings/${id}`, { status: "cancelled" });
  assert.equal(same.status, 200);
  assert.deepEqual(same.body.written, []);
  assert.equal(same.revision, rev, "nothing changed, so the revision did not");

  const renamed = await s.call("PATCH", `/bookings/${id}`, { title: "Avenida Palace", cost: null });
  assert.notEqual(renamed.body.booking.id, id);
  assert.equal(renamed.body.booking.cost, null, "null clears");

  const flight = s.deps.bookings(s.lisbon).find((b) => b.kind === "flight");
  const moved = await s.call("PATCH", `/bookings/${m.bookingId(flight)}`, { legs: [{ airline: "KLM", flight: "KL1693", from: "AMS", to: "LIS", date: "2026-11-11", departs: "12:00" }] });
  assert.equal(moved.body.booking.date, "2026-11-11");
}));

await test("PATCH /bookings/:id: 400 on bad input or an unwritable kind, 404 on unknown", withServer({}, async (s) => {
  const [flight, stay, activity] = s.deps.bookings(s.lisbon);
  assert.equal((await s.call("PATCH", `/bookings/${m.bookingId(stay)}`, { kind: "flight" })).status, 400);
  assert.match((await s.call("PATCH", `/bookings/${m.bookingId(stay)}`, { kind: "flight" })).body.error, /kind cannot change/);
  assert.equal((await s.call("PATCH", `/bookings/${m.bookingId(stay)}`, { endDate: "2026-01-01" })).status, 400);
  assert.equal((await s.call("PATCH", `/bookings/${m.bookingId(stay)}`, { title: null })).status, 400);
  assert.match((await s.call("PATCH", `/bookings/${m.bookingId(flight)}`, { date: "2026-12-01" })).body.error, /send legs/);
  const fado = await s.call("PATCH", `/bookings/${m.bookingId(activity)}`, { status: "idea" });
  assert.equal(fado.status, 400);
  assert.match(fado.body.error, /can be read but not written/);
  assert.equal((await s.call("DELETE", `/bookings/${m.bookingId(activity)}`)).status, 400);
  assert.equal((await s.call("PATCH", "/bookings/b-nope", { status: "idea" })).status, 404);
  assert.equal(s.state.writes, 0);
}));

await test("DELETE /bookings/:id removes it; 404 after", withServer({}, async (s) => {
  const stay = s.deps.bookings(s.lisbon).find((b) => b.kind === "stay");
  const id = m.bookingId(stay);
  const r = await s.call("DELETE", `/bookings/${id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted, id);
  assert.ok(r.body.written.includes(stay.file.path));
  assert.equal((await s.call("GET", `/bookings/${id}`)).status, 404);
  assert.equal((await s.call("DELETE", `/bookings/${id}`)).status, 404);
}));

// ----------------------------------------------------------------- moments

await test("GET /trips/:id/moments and GET /trips/:id/moments/:mid", withServer({}, async (s) => {
  const trip = m.tripId(s.rome);
  const r = await s.call("GET", `/trips/${trip}/moments`);
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 2);
  const [gelato, light] = r.body.moments;
  assert.match(gelato.id, /^m-[0-9a-z]{11}$/);
  assert.equal(gelato.date, "2025-04-02");
  assert.equal(gelato.title, null);
  assert.equal(light.date, null);
  assert.equal(light.title, "The light");
  const one = await s.call("GET", `/trips/${trip}/moments/${light.id}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.moment.text, "Every evening, gold.");
  assert.equal((await s.call("GET", `/trips/${trip}/moments/m-nope`)).status, 404);
  assert.equal((await s.call("GET", "/trips/t-nope/moments")).status, 404);
}));

await test("identical moments get ids of their own", () => {
  const ids = m.momentIds([{ date: "", title: "", text: "Again" }, { date: "", title: "", text: "Again" }]);
  assert.notEqual(ids[0], ids[1]);
  assert.equal(ids[1], `${ids[0]}-2`);
});

await test("POST /trips/:id/moments adds one, keeping line breaks", withServer({}, async (s) => {
  const trip = m.tripId(s.rome);
  const r = await s.call("POST", `/trips/${trip}/moments`, { date: "2025-04-03", title: "AWTY-API-TEST", text: "Line one.\n\nLine two." });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.moment.text, "Line one.\n\nLine two.");
  assert.deepEqual(r.body.written, [s.rome.file.path]);
  const list = await s.call("GET", `/trips/${trip}/moments`);
  assert.equal(list.body.count, 3);
  assert.ok(list.body.moments.some((x) => x.id === r.body.moment.id), "the reply's id finds it");
}));

await test("POST /trips/:id/moments: 400 on bad input", withServer({}, async (s) => {
  const trip = m.tripId(s.rome);
  for (const [body, message] of [
    [{}, /text is required/],
    [{ text: "   " }, /text must not be empty/],
    [{ text: "x", date: "yesterday" }, /real date/],
    [{ text: "x", title: "a\nb" }, /line breaks/],
    [{ text: "x\u0007" }, /control characters/],
    [{ text: "x", mood: "happy" }, /Unknown field: mood/],
  ]) {
    const r = await s.call("POST", `/trips/${trip}/moments`, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.error, message, JSON.stringify(body));
  }
  assert.equal(s.state.writes, 0);
}));

await test("PATCH /trips/:id/moments/:mid edits one; a no-op writes nothing; 400 and 404", withServer({}, async (s) => {
  const trip = m.tripId(s.rome);
  const [gelato] = (await s.call("GET", `/trips/${trip}/moments`)).body.moments;
  const r = await s.call("PATCH", `/trips/${trip}/moments/${gelato.id}`, { text: "Gelato three times before noon" });
  assert.equal(r.status, 200);
  assert.equal(r.body.moment.text, "Gelato three times before noon");
  assert.equal(r.body.moment.date, "2025-04-02", "untouched");
  assert.notEqual(r.body.moment.id, gelato.id, "the id is the content");
  assert.equal((await s.call("GET", `/trips/${trip}/moments/${r.body.moment.id}`)).status, 200);

  const same = await s.call("PATCH", `/trips/${trip}/moments/${r.body.moment.id}`, { date: "2025-04-02" });
  assert.deepEqual(same.body.written, []);
  assert.equal(same.revision, r.revision);

  assert.equal((await s.call("PATCH", `/trips/${trip}/moments/${r.body.moment.id}`, { text: "" })).status, 400);
  assert.equal((await s.call("PATCH", `/trips/${trip}/moments/${r.body.moment.id}`, { date: "2025-13-01" })).status, 400);
  assert.equal((await s.call("PATCH", `/trips/${trip}/moments/${gelato.id}`, { text: "x" })).status, 404, "the old id is gone");
}));

await test("DELETE /trips/:id/moments/:mid removes one; 404 after", withServer({}, async (s) => {
  const trip = m.tripId(s.rome);
  const [, light] = (await s.call("GET", `/trips/${trip}/moments`)).body.moments;
  const r = await s.call("DELETE", `/trips/${trip}/moments/${light.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted, light.id);
  assert.equal((await s.call("GET", `/trips/${trip}/moments`)).body.count, 1);
  assert.equal((await s.call("DELETE", `/trips/${trip}/moments/${light.id}`)).status, 404);
  assert.equal((await s.call("PUT", `/trips/${trip}/moments`, {})).status, 405);
}));

// ----------------------------------------------------- writes from elsewhere

await test("403 on every write from another device while remote writes are off; reads still work", withServer({ remote: true }, async (s) => {
  const trip = m.tripId(s.lisbon);
  const booking = m.bookingId(s.deps.bookings(s.lisbon)[1]);
  const moment = (await s.call("GET", `/trips/${m.tripId(s.rome)}/moments`)).body.moments[0].id;
  const writes = [
    ["POST", "/trips", { title: "AWTY-API-TEST", startDate: "2027-01-01" }],
    ["PATCH", `/trips/${trip}`, { title: "X" }],
    ["DELETE", `/trips/${trip}`],
    ["POST", `/trips/${trip}/bookings`, { kind: "stay", title: "X" }],
    ["PATCH", `/bookings/${booking}`, { status: "idea" }],
    ["DELETE", `/bookings/${booking}`],
    ["POST", `/trips/${m.tripId(s.rome)}/moments`, { text: "x" }],
    ["PATCH", `/trips/${m.tripId(s.rome)}/moments/${moment}`, { text: "x" }],
    ["DELETE", `/trips/${m.tripId(s.rome)}/moments/${moment}`],
  ];
  for (const [method, route, body] of writes) {
    const r = await s.call(method, route, body);
    assert.equal(r.status, 403, `${method} ${route}`);
    assert.match(r.body.error, /Allow writes from other devices/);
  }
  // Even an invalid write is refused for where it came from, not for what it said.
  assert.equal((await s.call("POST", "/trips", { nonsense: true })).status, 403);
  assert.equal(s.state.writes, 0);
  for (const route of ["/health", "/trips", `/trips/${trip}`, "/bookings", `/bookings/${booking}`, `/trips/${trip}/moments`]) {
    assert.equal((await s.call("GET", route)).status, 200, route);
  }
  // Still 401 first: a device without the token learns nothing about the switch.
  assert.equal((await s.call("POST", "/trips", {}, { auth: false })).status, 401);
}));

await test("with remote writes on, another device can write — read per request, no restart", withServer({ remote: true }, async (s) => {
  assert.equal((await s.call("POST", `/trips/${m.tripId(s.rome)}/moments`, { text: "AWTY-API-TEST" })).status, 403);
  s.state.remoteWrites = true;
  assert.equal((await s.call("GET", "/health")).body.remoteWrites, true);
  assert.equal((await s.call("POST", `/trips/${m.tripId(s.rome)}/moments`, { text: "AWTY-API-TEST" })).status, 201);
  s.state.remoteWrites = false;
  assert.equal((await s.call("POST", `/trips/${m.tripId(s.rome)}/moments`, { text: "AWTY-API-TEST 2" })).status, 403);
}));

// ---------------------------------------------------------------- the wire

await test("x-awty-revision moves only on real writes", withServer({}, async (s) => {
  const rev = async () => Number((await s.call("GET", "/health")).revision);
  const start = await rev();
  await s.call("GET", "/trips");
  await s.call("GET", "/bookings");
  await s.call("POST", "/trips", { title: "" });
  await s.call("PATCH", `/trips/${m.tripId(s.lisbon)}`, { title: "Lisbon" });
  assert.equal(await rev(), start, "reads, refusals and no-ops leave it");
  await s.call("POST", `/trips/${m.tripId(s.rome)}/moments`, { text: "AWTY-API-TEST" });
  assert.equal(await rev(), start + 1);
}));

await test("413 for a body over the cap", withServer({}, async (s) => {
  const r = await s.call("POST", `/trips/${m.tripId(s.rome)}/moments`, undefined, { raw: JSON.stringify({ text: "x".repeat(1_100_000) }) });
  assert.equal(r.status, 413);
  assert.equal(s.state.writes, 0);
}));

await test("a crash in a handler is a 500 with a request id, not a dropped connection", async () => {
  const vault = fakeVault();
  const logs = [];
  const server = await m.startApiServer({
    port: 0, host: "127.0.0.1", token: TOKEN, allowRemoteWrites: () => false, log: (x) => logs.push(x),
    deps: { ...vault.deps, trips: () => { throw new Error("boom"); } },
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/awty/v1/trips`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, "Internal error");
    assert.match(body.requestId, /^[0-9a-z]+$/);
    assert.ok(logs.some((l) => l.includes(body.requestId) && l.includes("boom")));
  } finally {
    server.close();
  }
});

console.log(`\n${passed} API tests passed${failures.length ? `, ${failures.length} failed` : ""}`);
if (failures.length) process.exit(1);
