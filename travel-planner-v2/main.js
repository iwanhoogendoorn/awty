/*
Travel Planner — bundled by esbuild. Source: src/ in this repository.
*/
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TravelPlannerPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian9 = require("obsidian");

// src/types.ts
var KINDS = [
  {
    id: "holiday",
    label: "Holiday",
    icon: "palmtree",
    singleDay: false,
    defaultDurationDays: 14,
    subNotes: ["itinerary", "packing", "accommodation", "transport", "budget", "food"],
    hasVenue: false
  },
  {
    id: "city-break",
    label: "City break",
    icon: "building-2",
    singleDay: false,
    defaultDurationDays: 3,
    subNotes: ["itinerary", "accommodation", "transport", "budget", "food"],
    hasVenue: false
  },
  {
    id: "day-trip",
    label: "Day trip",
    icon: "sun",
    singleDay: true,
    defaultDurationDays: 1,
    subNotes: ["itinerary", "food"],
    hasVenue: false
  },
  {
    id: "concert",
    label: "Concert",
    icon: "music",
    singleDay: true,
    defaultDurationDays: 1,
    subNotes: ["event-details", "transport", "food"],
    hasVenue: true
  },
  {
    id: "event",
    label: "Event",
    icon: "ticket",
    singleDay: true,
    defaultDurationDays: 1,
    subNotes: ["event-details", "transport", "food"],
    hasVenue: true
  },
  {
    id: "business",
    label: "Business trip",
    icon: "briefcase",
    singleDay: false,
    defaultDurationDays: 3,
    subNotes: ["itinerary", "accommodation", "transport", "budget", "food"],
    hasVenue: false
  }
];
var KIND_BY_ID = new Map(KINDS.map((k) => [k.id, k]));
function kindDef(id) {
  return KIND_BY_ID.get(id ?? "") ?? KINDS[0];
}
function isTripKind(value) {
  return typeof value === "string" && KIND_BY_ID.has(value);
}
var SUB_NOTE_LABELS = {
  itinerary: "Itinerary",
  packing: "Packing List",
  accommodation: "Accommodation",
  budget: "Budget",
  food: "Food",
  "event-details": "Event Details",
  transport: "Transport"
};
var DEFAULT_SETTINGS = {
  tripsFolder: "Trips",
  folderPattern: "{year}/{start} {title}",
  defaultCountry: "Netherlands",
  defaultKind: "holiday",
  subNotesByKind: KINDS.reduce(
    (acc, k) => {
      acc[k.id] = [...k.subNotes];
      return acc;
    },
    {}
  ),
  foodSpotEnabled: true,
  foodSpotView: "cards",
  confirmDelete: true,
  showPastTrips: true
};
var TRAVEL_VIEW_TYPE = "travel-planner-sidebar";
var FOODSPOT_PLUGIN_ID = "foodspot";

// src/store/tripStore.ts
var import_obsidian = require("obsidian");

// src/util/dates.ts
var ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function isValidISODate(value) {
  if (typeof value !== "string") return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(mo) - 1 && date.getUTCDate() === Number(d);
}
function parseISO(value) {
  if (!isValidISODate(value)) return null;
  const [y, mo, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d));
}
function toISO(date) {
  const y = String(date.getUTCFullYear()).padStart(4, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function todayISO() {
  const now = /* @__PURE__ */ new Date();
  return toISO(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}
function addDays(iso, days) {
  const date = parseISO(iso);
  if (!date) return iso;
  date.setUTCDate(date.getUTCDate() + days);
  return toISO(date);
}
function nightsBetween(startISO, endISO) {
  const start = parseISO(startISO);
  const end = parseISO(endISO);
  if (!start || !end) return 0;
  const ms = end.getTime() - start.getTime();
  return ms <= 0 ? 0 : Math.round(ms / 864e5);
}
function daysBetween(startISO, endISO) {
  if (!isValidISODate(startISO)) return 0;
  if (!isValidISODate(endISO)) return 1;
  return nightsBetween(startISO, endISO) + 1;
}
function endDateForDuration(startISO, days) {
  return addDays(startISO, Math.max(1, days) - 1);
}
function tripStatus(startISO, endISO, today = todayISO()) {
  const start = parseISO(startISO);
  const end = parseISO(endISO) ?? start;
  const now = parseISO(today);
  if (!start || !now) return "upcoming";
  if (end && end.getTime() < now.getTime()) return "past";
  if (start.getTime() <= now.getTime()) return "current";
  return "upcoming";
}
function daysUntil(startISO, today = todayISO()) {
  const start = parseISO(startISO);
  const now = parseISO(today);
  if (!start || !now) return null;
  return Math.round((start.getTime() - now.getTime()) / 864e5);
}
var MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];
function formatShort(iso) {
  const date = parseISO(iso);
  if (!date) return iso;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
function formatDateRange(startISO, endISO) {
  const start = parseISO(startISO);
  const end = parseISO(endISO);
  if (!start) return startISO || "No date";
  if (!end || start.getTime() === end.getTime()) return formatShort(startISO);
  if (start.getUTCFullYear() === end.getUTCFullYear()) {
    if (start.getUTCMonth() === end.getUTCMonth()) {
      return `${start.getUTCDate()} \u2013 ${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
    }
    return `${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]} \u2013 ${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
  }
  return `${formatShort(startISO)} \u2013 ${formatShort(endISO)}`;
}
function formatDuration(startISO, endISO) {
  const days = daysBetween(startISO, endISO);
  if (days <= 1) return "1 day";
  const nights = days - 1;
  return `${days} days, ${nights} night${nights === 1 ? "" : "s"}`;
}
function datesInRange(startISO, endISO, cap = 400) {
  const out = [];
  if (!isValidISODate(startISO)) return out;
  let cursor = startISO;
  const end = isValidISODate(endISO) && endISO >= startISO ? endISO : startISO;
  while (cursor <= end && out.length < cap) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

// src/store/tripStore.ts
var STATUS_ORDER = { current: 0, upcoming: 1, past: 2 };
function str(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}
var TripStore = class {
  constructor(app, getSettings) {
    this.app = app;
    this.getSettings = getSettings;
    this.trips = [];
    this.listeners = /* @__PURE__ */ new Set();
    this.dirty = true;
    this.day = todayISO();
  }
  /** Subscribes to the vault so the sidebar reflects edits made in the notes. */
  register(plugin) {
    const invalidate = () => this.invalidate();
    plugin.registerEvent(this.app.metadataCache.on("changed", invalidate));
    plugin.registerEvent(this.app.metadataCache.on("deleted", invalidate));
    plugin.registerEvent(this.app.vault.on("create", invalidate));
    plugin.registerEvent(this.app.vault.on("delete", invalidate));
    plugin.registerEvent(this.app.vault.on("rename", invalidate));
    plugin.registerInterval(
      window.setInterval(() => {
        const today = todayISO();
        if (today !== this.day) {
          this.day = today;
          this.invalidate();
        }
      }, 6e4)
    );
  }
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  invalidate() {
    this.dirty = true;
    for (const listener of this.listeners) listener();
  }
  getTrips() {
    if (this.dirty) {
      this.trips = this.scan();
      this.dirty = false;
    }
    return this.trips;
  }
  getTripForFile(file) {
    return this.getTrips().find(
      (t) => t.file.path === file.path || file.path.startsWith(`${t.folderPath}/`)
    ) ?? null;
  }
  /** The trip note governing the folder a given file sits in, if any. */
  findSiblingSubNote(file, name) {
    const trip = this.getTripForFile(file);
    if (!trip) return null;
    const candidate = this.app.vault.getAbstractFileByPath(`${trip.folderPath}/${name}.md`);
    return candidate instanceof import_obsidian.TFile ? candidate : null;
  }
  scan() {
    const settings = this.getSettings();
    const root = (0, import_obsidian.normalizePath)(settings.tripsFolder);
    const prefix = root && root !== "/" ? `${root}/` : "";
    const today = todayISO();
    const trips = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (prefix && !file.path.startsWith(prefix)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || fm.type !== "trip") continue;
      const startDate = str(fm.start_date);
      const rawEnd = str(fm.end_date);
      const endDate = isValidISODate(rawEnd) ? rawEnd : startDate;
      const kind = isTripKind(fm.kind) ? fm.kind : "holiday";
      trips.push({
        file,
        folderPath: file.parent?.path ?? root,
        // `destination` is the 1.x field name; reading it keeps old notes visible.
        title: str(fm.title) || str(fm.destination) || file.basename,
        kind,
        country: str(fm.country),
        city: str(fm.city) || str(fm.destination),
        venue: str(fm.venue),
        startDate,
        endDate,
        status: tripStatus(startDate, endDate, today)
      });
    }
    trips.sort((a, b) => {
      if (STATUS_ORDER[a.status] !== STATUS_ORDER[b.status]) {
        return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      }
      const dir = a.status === "past" ? -1 : 1;
      const cmp = a.startDate.localeCompare(b.startDate) * dir;
      return cmp !== 0 ? cmp : a.title.localeCompare(b.title);
    });
    return trips;
  }
};

// src/store/noteWriter.ts
var import_obsidian2 = require("obsidian");

// src/data/countries.ts
var COUNTRIES = [
  "Afghanistan",
  "Albania",
  "Algeria",
  "Andorra",
  "Angola",
  "Argentina",
  "Armenia",
  "Australia",
  "Austria",
  "Azerbaijan",
  "Bahamas",
  "Bahrain",
  "Bangladesh",
  "Barbados",
  "Belarus",
  "Belgium",
  "Belize",
  "Benin",
  "Bhutan",
  "Bolivia",
  "Bosnia and Herzegovina",
  "Botswana",
  "Brazil",
  "Brunei",
  "Bulgaria",
  "Burkina Faso",
  "Burundi",
  "Cambodia",
  "Cameroon",
  "Canada",
  "Cape Verde",
  "Central African Republic",
  "Chad",
  "Chile",
  "China",
  "Colombia",
  "Comoros",
  "Costa Rica",
  "Croatia",
  "Cuba",
  "Cura\xE7ao",
  "Cyprus",
  "Czechia",
  "Democratic Republic of the Congo",
  "Denmark",
  "Djibouti",
  "Dominica",
  "Dominican Republic",
  "East Timor",
  "Ecuador",
  "Egypt",
  "El Salvador",
  "Equatorial Guinea",
  "Eritrea",
  "Estonia",
  "Eswatini",
  "Ethiopia",
  "Fiji",
  "Finland",
  "France",
  "Gabon",
  "Gambia",
  "Georgia",
  "Germany",
  "Ghana",
  "Greece",
  "Grenada",
  "Guatemala",
  "Guinea",
  "Guinea-Bissau",
  "Guyana",
  "Haiti",
  "Honduras",
  "Hong Kong",
  "Hungary",
  "Iceland",
  "India",
  "Indonesia",
  "Iran",
  "Iraq",
  "Ireland",
  "Israel",
  "Italy",
  "Ivory Coast",
  "Jamaica",
  "Japan",
  "Jordan",
  "Kazakhstan",
  "Kenya",
  "Kosovo",
  "Kuwait",
  "Kyrgyzstan",
  "Laos",
  "Latvia",
  "Lebanon",
  "Lesotho",
  "Liberia",
  "Libya",
  "Liechtenstein",
  "Lithuania",
  "Luxembourg",
  "Macau",
  "Madagascar",
  "Malawi",
  "Malaysia",
  "Maldives",
  "Mali",
  "Malta",
  "Mauritania",
  "Mauritius",
  "Mexico",
  "Moldova",
  "Monaco",
  "Mongolia",
  "Montenegro",
  "Morocco",
  "Mozambique",
  "Myanmar",
  "Namibia",
  "Nepal",
  "Netherlands",
  "New Zealand",
  "Nicaragua",
  "Niger",
  "Nigeria",
  "North Korea",
  "North Macedonia",
  "Norway",
  "Oman",
  "Pakistan",
  "Palestine",
  "Panama",
  "Papua New Guinea",
  "Paraguay",
  "Peru",
  "Philippines",
  "Poland",
  "Portugal",
  "Puerto Rico",
  "Qatar",
  "Republic of the Congo",
  "R\xE9union",
  "Romania",
  "Russia",
  "Rwanda",
  "San Marino",
  "Saudi Arabia",
  "Senegal",
  "Serbia",
  "Seychelles",
  "Sierra Leone",
  "Singapore",
  "Slovakia",
  "Slovenia",
  "Somalia",
  "South Africa",
  "South Korea",
  "South Sudan",
  "Spain",
  "Sri Lanka",
  "Sudan",
  "Suriname",
  "Sweden",
  "Switzerland",
  "Syria",
  "Taiwan",
  "Tajikistan",
  "Tanzania",
  "Thailand",
  "Togo",
  "Trinidad and Tobago",
  "Tunisia",
  "Turkey",
  "Turkmenistan",
  "Uganda",
  "Ukraine",
  "United Arab Emirates",
  "United Kingdom",
  "United States",
  "Uruguay",
  "Uzbekistan",
  "Venezuela",
  "Vietnam",
  "Western Sahara",
  "Yemen",
  "Zambia",
  "Zimbabwe"
];
var FOODSPOT_COUNTRIES = /* @__PURE__ */ new Set([
  "Afghanistan",
  "Albania",
  "Algeria",
  "Andorra",
  "Angola",
  "Argentina",
  "Armenia",
  "Australia",
  "Austria",
  "Azerbaijan",
  "Bahamas",
  "Bahrain",
  "Bangladesh",
  "Barbados",
  "Belarus",
  "Belgium",
  "Belize",
  "Benin",
  "Bhutan",
  "Bolivia",
  "Bosnia and Herzegovina",
  "Botswana",
  "Brazil",
  "Brunei",
  "Bulgaria",
  "Burkina Faso",
  "Burundi",
  "Cambodia",
  "Cameroon",
  "Canada",
  "Cape Verde",
  "Chad",
  "Chile",
  "China",
  "Colombia",
  "Comoros",
  "Costa Rica",
  "Croatia",
  "Cuba",
  "Cura\xE7ao",
  "Cyprus",
  "Czechia",
  "Denmark",
  "Djibouti",
  "Dominica",
  "Dominican Republic",
  "Ecuador",
  "Egypt",
  "El Salvador",
  "Estonia",
  "Eswatini",
  "Ethiopia",
  "Fiji",
  "Finland",
  "France",
  "Gabon",
  "Gambia",
  "Georgia",
  "Germany",
  "Ghana",
  "Greece",
  "Grenada",
  "Guatemala",
  "Guinea",
  "Guyana",
  "Haiti",
  "Honduras",
  "Hong Kong",
  "Hungary",
  "Iceland",
  "India",
  "Indonesia",
  "Iran",
  "Iraq",
  "Ireland",
  "Israel",
  "Italy",
  "Ivory Coast",
  "Jamaica",
  "Japan",
  "Jordan",
  "Kazakhstan",
  "Kenya",
  "Kosovo",
  "Kuwait",
  "Kyrgyzstan",
  "Laos",
  "Latvia",
  "Lebanon",
  "Lesotho",
  "Liberia",
  "Libya",
  "Liechtenstein",
  "Lithuania",
  "Luxembourg",
  "Macau",
  "Madagascar",
  "Malawi",
  "Malaysia",
  "Maldives",
  "Mali",
  "Malta",
  "Mauritania",
  "Mauritius",
  "Mexico",
  "Moldova",
  "Monaco",
  "Mongolia",
  "Montenegro",
  "Morocco",
  "Mozambique",
  "Myanmar",
  "Namibia",
  "Nepal",
  "Netherlands",
  "New Zealand",
  "Nicaragua",
  "Niger",
  "Nigeria",
  "North Macedonia",
  "Norway",
  "Oman",
  "Pakistan",
  "Panama",
  "Papua New Guinea",
  "Paraguay",
  "Peru",
  "Philippines",
  "Poland",
  "Portugal",
  "Qatar",
  "Romania",
  "Russia",
  "Rwanda",
  "San Marino",
  "Saudi Arabia",
  "Senegal",
  "Serbia",
  "Seychelles",
  "Sierra Leone",
  "Singapore",
  "Slovakia",
  "Slovenia",
  "Somalia",
  "South Africa",
  "South Korea",
  "Spain",
  "Sri Lanka",
  "Sudan",
  "Suriname",
  "Sweden",
  "Switzerland",
  "Syria",
  "Taiwan",
  "Tajikistan",
  "Tanzania",
  "Thailand",
  "Togo",
  "Trinidad and Tobago",
  "Tunisia",
  "Turkey",
  "Turkmenistan",
  "Uganda",
  "Ukraine",
  "United Arab Emirates",
  "United Kingdom",
  "United States",
  "Uruguay",
  "Uzbekistan",
  "Venezuela",
  "Vietnam",
  "Yemen",
  "Zambia",
  "Zimbabwe"
]);

// src/store/templates.ts
function lines(...parts) {
  return parts.flat(Infinity).join("\n");
}
function foodSpotBlock(ctx) {
  const { draft, settings } = ctx;
  const body = [`view: ${settings.foodSpotView}`];
  if (draft.country && FOODSPOT_COUNTRIES.has(draft.country)) body.push(`country: ${draft.country}`);
  if (draft.city) body.push(`city: ${draft.city}`);
  body.push("status: want-to-try");
  return lines("```foodspot", body, "```");
}
function foodBody(ctx) {
  const { draft, settings } = ctx;
  const place = draft.city || draft.country || draft.title;
  const head = lines(`# Food \u2014 ${place}`, "", "## Want to try", "");
  if (!settings.foodSpotEnabled) {
    return lines(head, "- [ ] ", "", "## Been there", "", "- [ ] ", "");
  }
  if (!ctx.foodSpotAvailable) {
    return lines(
      head,
      "> [!info] Food Spot is not enabled in this vault.",
      "> Enable the Food Spot plugin and this block will render your shortlist for",
      `> ${place}. Until then it stays here as plain text.`,
      "",
      foodSpotBlock(ctx),
      "",
      "## Notes",
      ""
    );
  }
  return lines(
    head,
    foodSpotBlock(ctx),
    "",
    "## Booked",
    "",
    "| Date | Time | Place | Booked by | Notes |",
    "|------|------|-------|-----------|-------|",
    "|      |      |       |           |       |",
    "",
    "## Notes",
    ""
  );
}
function itineraryBody(ctx) {
  const { draft } = ctx;
  const def = kindDef(draft.kind);
  const days = datesInRange(draft.startDate, def.singleDay ? draft.startDate : draft.endDate, 60);
  const dayBlocks = days.flatMap((date) => [
    `## ${date}`,
    "",
    "### Morning",
    "",
    "### Afternoon",
    "",
    "### Evening",
    ""
  ]);
  return lines(
    `# Itinerary \u2014 ${draft.title}`,
    "",
    `> ${formatDateRange(draft.startDate, draft.endDate)} \xB7 ${formatDuration(draft.startDate, draft.endDate)}`,
    "",
    dayBlocks.length ? dayBlocks : ["_Add days with the \u201CAdd itinerary day\u201D command._", ""]
  );
}
function packingBody(ctx) {
  return lines(
    `# Packing List \u2014 ${ctx.draft.title}`,
    "",
    "## Documents",
    "- [ ] Passport / ID",
    "- [ ] Visa / travel authorisation",
    "- [ ] Travel insurance documents",
    "- [ ] Flight / transport tickets",
    "- [ ] Hotel confirmations",
    "- [ ] Emergency contacts list",
    "",
    "## Clothes",
    "- [ ] Underwear",
    "- [ ] Socks",
    "- [ ] T-shirts / tops",
    "- [ ] Trousers / shorts",
    "- [ ] Sleepwear",
    "- [ ] Jacket / coat",
    "- [ ] Walking shoes",
    "",
    "## Tech",
    "- [ ] Phone + charger",
    "- [ ] Laptop / tablet + charger",
    "- [ ] Power bank",
    "- [ ] Travel adapter",
    "- [ ] Headphones",
    "",
    "## Toiletries",
    "- [ ] Toothbrush + toothpaste",
    "- [ ] Shampoo / body wash",
    "- [ ] Deodorant",
    "- [ ] Sunscreen",
    "- [ ] Medication",
    "",
    "## Misc",
    "- [ ] Travel pillow",
    "- [ ] Eye mask + earplugs",
    "- [ ] Water bottle",
    "- [ ] Luggage locks",
    "- [ ] Local currency / travel card",
    ""
  );
}
function accommodationBody(ctx) {
  return lines(
    `# Accommodation \u2014 ${ctx.draft.title}`,
    "",
    "| Check-in | Check-out | Property | Address | Confirmation | Price |",
    "|----------|-----------|----------|---------|--------------|-------|",
    "|          |           |          |         |              |       |",
    "",
    "## Notes",
    ""
  );
}
function transportBody(ctx) {
  return lines(
    `# Transport \u2014 ${ctx.draft.title}`,
    "",
    "## Outbound",
    "",
    "| Date | Time | From | To | Carrier | Reference | Seat |",
    "|------|------|------|----|---------|-----------|------|",
    "|      |      |      |    |         |           |      |",
    "",
    "## Return",
    "",
    "| Date | Time | From | To | Carrier | Reference | Seat |",
    "|------|------|------|----|---------|-----------|------|",
    "|      |      |      |    |         |           |      |",
    "",
    "## Local transport",
    ""
  );
}
function budgetBody(ctx) {
  return lines(
    `# Budget \u2014 ${ctx.draft.title}`,
    "",
    "## Planned",
    "",
    "| Category | Budgeted | Actual | Notes |",
    "|----------|----------|--------|-------|",
    "| Transport | | | |",
    "| Accommodation | | | |",
    "| Food & drink | | | |",
    "| Activities | | | |",
    "| Shopping | | | |",
    "| Misc | | | |",
    "| **Total** | | | |",
    "",
    "## Expenses",
    "",
    "| Date | Description | Amount | Category |",
    "|------|-------------|--------|----------|",
    "|      |             |        |          |",
    ""
  );
}
function eventDetailsBody(ctx) {
  const { draft } = ctx;
  return lines(
    `# ${draft.title}`,
    "",
    `| | |`,
    `|---|---|`,
    `| **Date** | ${draft.startDate} |`,
    `| **Venue** | ${draft.venue || "_TBC_"} |`,
    `| **City** | ${draft.city || "_TBC_"} |`,
    `| **Doors** | |`,
    `| **Start** | |`,
    `| **Tickets** | |`,
    `| **Booking reference** | |`,
    `| **Seat / standing** | |`,
    "",
    "## Line-up",
    "",
    "## Getting there",
    "",
    "## Notes",
    ""
  );
}
var BUILDERS = {
  itinerary: itineraryBody,
  packing: packingBody,
  accommodation: accommodationBody,
  transport: transportBody,
  budget: budgetBody,
  food: foodBody,
  "event-details": eventDetailsBody
};
var FRONTMATTER_TYPE = {
  itinerary: "itinerary",
  packing: "packing-list",
  accommodation: "accommodation",
  transport: "transport",
  budget: "budget",
  food: "food",
  "event-details": "event-details"
};
function buildSubNote(id, ctx) {
  return {
    id,
    fileName: SUB_NOTE_LABELS[id],
    frontmatter: { type: FRONTMATTER_TYPE[id], trip: ctx.tripLink },
    body: BUILDERS[id](ctx)
  };
}
function buildTripBody(ctx, subNotes) {
  const { draft } = ctx;
  const def = kindDef(draft.kind);
  const where = [draft.city, draft.country].filter(Boolean).join(", ");
  const meta = [`> **When:** ${formatDateRange(draft.startDate, draft.endDate)}`];
  if (!def.singleDay) meta.push(`> **Duration:** ${formatDuration(draft.startDate, draft.endDate)}`);
  if (where) meta.push(`> **Where:** ${where}`);
  if (def.hasVenue && draft.venue) meta.push(`> **Venue:** ${draft.venue}`);
  meta.push(`> **Kind:** ${def.label}`);
  return lines(
    `# ${draft.title}`,
    "",
    meta,
    "",
    "## Overview",
    "",
    draft.notes.trim() || "_Add trip overview here._",
    "",
    subNotes.length ? ["## Planning", "", subNotes.map((id) => `- [[${SUB_NOTE_LABELS[id]}]]`), ""] : []
  );
}

// src/util/paths.ts
var ILLEGAL = /[\\/:*?"<>|#^[\]]/g;
function sanitizeName(name) {
  return name.replace(ILLEGAL, "-").replace(/\s+/g, " ").replace(/-{2,}/g, "-").trim().replace(/^\.+|[.\s]+$/g, "").slice(0, 120) || "Untitled";
}
function joinPath(...parts) {
  return parts.filter((p) => p && p.length > 0).join("/").replace(/\/{2,}/g, "/");
}
function expandFolderPattern(pattern, vars) {
  const filled = pattern.replace(/\{(\w+)\}/g, (match, key) => {
    const value = vars[key];
    return value === void 0 ? match : sanitizeName(value);
  });
  return filled.split("/").map((segment) => sanitizeName(segment)).filter((segment) => segment.length > 0).join("/");
}

// src/store/noteWriter.ts
var TripWriteError = class extends Error {
};
async function ensureFolder(app, path) {
  const normalized = (0, import_obsidian2.normalizePath)(path);
  if (!normalized || normalized === "/") return;
  const existing = app.vault.getAbstractFileByPath(normalized);
  if (existing instanceof import_obsidian2.TFolder) return;
  if (existing) throw new TripWriteError(`"${normalized}" already exists and is not a folder.`);
  const parts = normalized.split("/");
  let cursor = "";
  for (const part of parts) {
    cursor = cursor ? `${cursor}/${part}` : part;
    if (app.vault.getAbstractFileByPath(cursor) instanceof import_obsidian2.TFolder) continue;
    try {
      await app.vault.createFolder(cursor);
    } catch (err) {
      if (!(app.vault.getAbstractFileByPath(cursor) instanceof import_obsidian2.TFolder)) throw err;
    }
  }
}
function uniquePath(app, folder, base, ext = ".md") {
  let candidate = joinPath(folder, base + ext);
  let n = 2;
  while (app.vault.getAbstractFileByPath(candidate)) {
    candidate = joinPath(folder, `${base} ${n}${ext}`);
    n += 1;
  }
  return candidate;
}
function uniqueFolder(app, path) {
  let candidate = path;
  let n = 2;
  while (app.vault.getAbstractFileByPath(candidate)) {
    candidate = `${path} ${n}`;
    n += 1;
  }
  return candidate;
}
function tripFolderPath(settings, draft) {
  const start = parseISO(draft.startDate);
  const relative = expandFolderPattern(settings.folderPattern, {
    year: start ? String(start.getUTCFullYear()) : "Undated",
    month: start ? String(start.getUTCMonth() + 1).padStart(2, "0") : "00",
    start: isValidISODate(draft.startDate) ? draft.startDate : "undated",
    end: isValidISODate(draft.endDate) ? draft.endDate : "undated",
    title: draft.title,
    city: draft.city,
    country: draft.country,
    kind: draft.kind
  });
  return joinPath((0, import_obsidian2.normalizePath)(settings.tripsFolder), relative);
}
function tripFrontmatter(draft) {
  const def = kindDef(draft.kind);
  const fm = {
    type: "trip",
    kind: draft.kind,
    title: draft.title,
    start_date: draft.startDate,
    end_date: def.singleDay ? draft.startDate : draft.endDate
  };
  if (draft.country) fm.country = draft.country;
  if (draft.city) fm.city = draft.city;
  if (def.hasVenue && draft.venue) fm.venue = draft.venue;
  return fm;
}
async function writeFrontmatter(app, file, fields) {
  await app.fileManager.processFrontMatter(file, (fm) => {
    for (const [key, value] of Object.entries(fields)) fm[key] = value;
  });
}
async function createTrip(app, settings, draft, foodSpotAvailable) {
  if (!draft.title.trim()) throw new TripWriteError("A trip needs a title.");
  if (!isValidISODate(draft.startDate)) throw new TripWriteError("Start date must be a real date.");
  const def = kindDef(draft.kind);
  const normalized = {
    ...draft,
    title: draft.title.trim(),
    endDate: def.singleDay ? draft.startDate : draft.endDate || draft.startDate
  };
  const folderPath = uniqueFolder(app, tripFolderPath(settings, normalized));
  await ensureFolder(app, folderPath);
  const tripNotePath = uniquePath(app, folderPath, sanitizeName(normalized.title));
  const tripFile = await app.vault.create(tripNotePath, "");
  await writeFrontmatter(app, tripFile, tripFrontmatter(normalized));
  const subNotes = normalized.subNotes;
  const ctx = {
    draft: normalized,
    settings,
    tripLink: app.fileManager.generateMarkdownLink(tripFile, folderPath),
    foodSpotAvailable
  };
  const existing = await app.vault.read(tripFile);
  await app.vault.modify(tripFile, `${existing.trimEnd()}

${buildTripBody(ctx, subNotes)}`);
  const subNoteFiles = [];
  for (const id of subNotes) {
    const spec = buildSubNote(id, ctx);
    const path = uniquePath(app, folderPath, sanitizeName(spec.fileName));
    const file = await app.vault.create(path, "");
    await writeFrontmatter(app, file, spec.frontmatter);
    const head = await app.vault.read(file);
    await app.vault.modify(file, `${head.trimEnd()}

${spec.body}`);
    subNoteFiles.push(file);
  }
  return { tripFile, folderPath, subNoteFiles };
}
async function updateTrip(app, settings, trip, draft) {
  if (!draft.title.trim()) throw new TripWriteError("A trip needs a title.");
  if (!isValidISODate(draft.startDate)) throw new TripWriteError("Start date must be a real date.");
  const def = kindDef(draft.kind);
  const normalized = {
    ...draft,
    title: draft.title.trim(),
    endDate: def.singleDay ? draft.startDate : draft.endDate || draft.startDate
  };
  await app.fileManager.processFrontMatter(trip.file, (fm) => {
    for (const [key, value] of Object.entries(tripFrontmatter(normalized))) fm[key] = value;
    if (!def.hasVenue) delete fm.venue;
  });
  const desiredFolder = tripFolderPath(settings, normalized);
  let folderPath = trip.folderPath;
  if (desiredFolder !== trip.folderPath) {
    const folder = app.vault.getAbstractFileByPath(trip.folderPath);
    if (folder instanceof import_obsidian2.TFolder && !app.vault.getAbstractFileByPath(desiredFolder)) {
      await ensureFolder(app, desiredFolder.split("/").slice(0, -1).join("/"));
      await app.fileManager.renameFile(folder, desiredFolder);
      folderPath = desiredFolder;
    }
  }
  const desiredName = sanitizeName(normalized.title);
  if (trip.file.basename !== desiredName) {
    const target = joinPath(folderPath, `${desiredName}.md`);
    if (!app.vault.getAbstractFileByPath(target)) {
      await app.fileManager.renameFile(trip.file, target);
    }
  }
  return trip.file;
}
function tripDeletionTargets(app, trip) {
  const folder = app.vault.getAbstractFileByPath(trip.folderPath);
  if (!(folder instanceof import_obsidian2.TFolder)) return [trip.file];
  let tripNotes = 0;
  const walk = (dir) => {
    for (const child of dir.children) {
      if (child instanceof import_obsidian2.TFolder) walk(child);
      else if (child instanceof import_obsidian2.TFile && child.extension === "md") {
        const fm = app.metadataCache.getFileCache(child)?.frontmatter;
        if (fm?.type === "trip") tripNotes += 1;
      }
    }
  };
  walk(folder);
  return tripNotes <= 1 ? [folder] : [trip.file];
}
function describeDeletion(app, targets) {
  const out = [];
  const walk = (item) => {
    if (item instanceof import_obsidian2.TFolder) item.children.forEach(walk);
    else out.push(item.path);
  };
  targets.forEach(walk);
  return out.sort();
}
async function deleteTrip(app, trip) {
  const targets = tripDeletionTargets(app, trip);
  const count = describeDeletion(app, targets).length;
  for (const target of targets) {
    await app.fileManager.trashFile(target);
  }
  return count;
}
async function insertItineraryDay(app, file, date, sections) {
  const content = await app.vault.read(file);
  const heading = `## ${date}`;
  if (new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(content)) {
    return "duplicate";
  }
  const block = [
    heading,
    "",
    "### Morning",
    sections.morning.trim() || "",
    "",
    "### Afternoon",
    sections.afternoon.trim() || "",
    "",
    "### Evening",
    sections.evening.trim() || "",
    ""
  ].join("\n");
  const lines2 = content.split("\n");
  let insertAt = -1;
  for (let i = 0; i < lines2.length; i += 1) {
    const m = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(lines2[i]);
    if (m && isValidISODate(m[1]) && m[1] > date) {
      insertAt = i;
      break;
    }
  }
  const next = insertAt === -1 ? `${content.trimEnd()}

${block}` : `${lines2.slice(0, insertAt).join("\n").trimEnd()}

${block}
${lines2.slice(insertAt).join("\n")}`;
  await app.vault.modify(file, next);
  return "inserted";
}
function notifyError(err, fallback) {
  const message = err instanceof Error ? err.message : fallback;
  new import_obsidian2.Notice(`Travel Planner: ${message}`);
  console.error("[travel-planner]", err);
}

// src/ui/view.ts
var import_obsidian3 = require("obsidian");
var GROUPS = [
  { status: "current", label: "Happening now" },
  { status: "upcoming", label: "Upcoming" },
  { status: "past", label: "Past" }
];
var TravelSidebarView = class extends import_obsidian3.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.query = "";
    this.unsubscribe = null;
  }
  getViewType() {
    return TRAVEL_VIEW_TYPE;
  }
  getDisplayText() {
    return "Travel Planner";
  }
  getIcon() {
    return "plane";
  }
  async onOpen() {
    this.unsubscribe = this.plugin.store.onChange(() => this.render());
    this.render();
  }
  async onClose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
  render() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("tp-sidebar");
    this.renderHeader(container);
    const all = this.plugin.store.getTrips();
    const trips = this.filter(all);
    if (all.length === 0) {
      this.renderEmpty(container, "No trips yet.", "Create your first one to get started.");
      return;
    }
    if (trips.length === 0) {
      this.renderEmpty(container, "Nothing matches.", `No trip matches \u201C${this.query}\u201D.`);
      return;
    }
    for (const group of GROUPS) {
      if (group.status === "past" && !this.plugin.settings.showPastTrips) continue;
      const items = trips.filter((t) => t.status === group.status);
      if (items.length === 0) continue;
      const heading = container.createDiv({ cls: "tp-group" });
      heading.createSpan({ cls: "tp-group-title", text: group.label });
      heading.createSpan({ cls: "tp-group-count", text: String(items.length) });
      const list = container.createDiv({ cls: "tp-list" });
      for (const trip of items) this.renderTrip(list, trip);
    }
  }
  renderHeader(container) {
    const header = container.createDiv({ cls: "tp-header" });
    const newBtn = header.createEl("button", { cls: "tp-new-btn" });
    (0, import_obsidian3.setIcon)(newBtn.createSpan({ cls: "tp-new-icon" }), "plus");
    newBtn.createSpan({ text: "New trip" });
    newBtn.addEventListener("click", () => this.plugin.openNewTripModal());
    const search = header.createEl("input", { cls: "tp-search" });
    search.type = "search";
    search.placeholder = "Filter trips\u2026";
    search.value = this.query;
    search.addEventListener("input", () => {
      this.query = search.value;
      this.render();
      const next = this.containerEl.querySelector(".tp-search");
      next?.focus();
      next?.setSelectionRange(next.value.length, next.value.length);
    });
  }
  renderEmpty(container, title, detail) {
    const empty = container.createDiv({ cls: "tp-empty" });
    (0, import_obsidian3.setIcon)(empty.createDiv({ cls: "tp-empty-icon" }), "plane");
    empty.createDiv({ cls: "tp-empty-title", text: title });
    empty.createDiv({ cls: "tp-empty-detail", text: detail });
  }
  filter(trips) {
    const q = this.query.trim().toLowerCase();
    if (!q) return trips;
    return trips.filter(
      (t) => [t.title, t.city, t.country, t.venue, t.kind].some((f) => f.toLowerCase().includes(q))
    );
  }
  renderTrip(list, trip) {
    const def = kindDef(trip.kind);
    const item = list.createDiv({ cls: `tp-trip is-${trip.status}` });
    const icon = item.createDiv({ cls: "tp-trip-icon" });
    (0, import_obsidian3.setIcon)(icon, def.icon);
    const body = item.createDiv({ cls: "tp-trip-body" });
    body.createDiv({ cls: "tp-trip-title", text: trip.title });
    const meta = body.createDiv({ cls: "tp-trip-meta" });
    meta.createSpan({ cls: "tp-trip-dates", text: formatDateRange(trip.startDate, trip.endDate) });
    const where = [trip.city, trip.country].filter(Boolean).join(", ");
    if (where) meta.createSpan({ cls: "tp-trip-where", text: where });
    const badge = this.countdown(trip);
    if (badge) body.createDiv({ cls: `tp-badge is-${trip.status}`, text: badge });
    const actions = item.createDiv({ cls: "tp-trip-actions" });
    const menuBtn = actions.createEl("button", { cls: "tp-icon-btn", attr: { "aria-label": "Trip actions" } });
    (0, import_obsidian3.setIcon)(menuBtn, "more-vertical");
    menuBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      this.showMenu(evt, trip);
    });
    item.addEventListener("click", () => void this.plugin.openTrip(trip));
    item.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      this.showMenu(evt, trip);
    });
    item.setAttribute("aria-label", `${trip.title} \u2014 ${formatDuration(trip.startDate, trip.endDate)}`);
  }
  countdown(trip) {
    if (trip.status === "past") return null;
    if (trip.status === "current") return "Now";
    const days = daysUntil(trip.startDate);
    if (days === null) return null;
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    if (days < 0) return null;
    if (days < 7) return `In ${days} days`;
    if (days < 60) return `In ${Math.round(days / 7)} weeks`;
    return `In ${Math.round(days / 30)} months`;
  }
  showMenu(evt, trip) {
    const menu = new import_obsidian3.Menu();
    menu.addItem(
      (item) => item.setTitle("Open").setIcon("file-text").onClick(() => void this.plugin.openTrip(trip))
    );
    menu.addItem(
      (item) => item.setTitle("Open in new tab").setIcon("plus-square").onClick(() => void this.plugin.openTrip(trip, true))
    );
    menu.addItem(
      (item) => item.setTitle("Add itinerary day").setIcon("calendar-plus").onClick(() => this.plugin.openAddDayModal(trip))
    );
    menu.addSeparator();
    menu.addItem(
      (item) => item.setTitle("Edit trip\u2026").setIcon("pencil").onClick(() => this.plugin.openEditTripModal(trip))
    );
    menu.addItem(
      (item) => item.setTitle("Copy folder path").setIcon("clipboard-copy").onClick(async () => {
        await navigator.clipboard.writeText(trip.folderPath);
        new import_obsidian3.Notice(`Copied ${trip.folderPath}`);
      })
    );
    menu.addSeparator();
    menu.addItem(
      (item) => item.setTitle("Delete trip\u2026").setIcon("trash-2").onClick(() => this.plugin.deleteTrip(trip))
    );
    menu.showAtMouseEvent(evt);
  }
};

// src/ui/modals/tripModal.ts
var import_obsidian5 = require("obsidian");

// src/ui/components/dateRange.ts
var DURATIONS = [1, 2, 3, 4, 5, 7, 10, 14, 21];
var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function weekday(iso) {
  const date = parseISO(iso);
  return date ? WEEKDAYS[date.getUTCDay()] : "";
}
var DateRangeField = class {
  constructor(container, initial, onChange) {
    this.container = container;
    this.onChange = onChange;
    this.chips = /* @__PURE__ */ new Map();
    this.singleDay = false;
    this.startDate = isValidISODate(initial.startDate ?? "") ? initial.startDate : todayISO();
    this.endDate = isValidISODate(initial.endDate ?? "") ? initial.endDate : this.startDate;
    this.render();
  }
  render() {
    const wrap = this.container.createDiv({ cls: "tp-daterange" });
    const startRow = wrap.createDiv({ cls: "tp-date-row" });
    startRow.createEl("label", { text: "Start", cls: "tp-date-label" });
    this.startInput = startRow.createEl("input", { cls: "tp-date-input" });
    this.startInput.type = "date";
    this.startInput.value = this.startDate;
    this.endRow = wrap.createDiv({ cls: "tp-date-row" });
    this.endRow.createEl("label", { text: "End", cls: "tp-date-label" });
    this.endInput = this.endRow.createEl("input", { cls: "tp-date-input" });
    this.endInput.type = "date";
    this.endInput.value = this.endDate;
    this.chipRow = wrap.createDiv({ cls: "tp-chip-row" });
    this.chipRow.createSpan({ cls: "tp-chip-label", text: "Length" });
    for (const days of DURATIONS) {
      const chip = this.chipRow.createEl("button", {
        cls: "tp-chip",
        text: days === 1 ? "1 day" : `${days}d`
      });
      chip.type = "button";
      chip.addEventListener("click", () => this.applyDuration(days));
      this.chips.set(days, chip);
    }
    this.readout = wrap.createDiv({ cls: "tp-date-readout" });
    this.startInput.addEventListener("change", () => {
      const next = this.startInput.value;
      if (!isValidISODate(next)) return;
      const length = daysBetween(this.startDate, this.endDate);
      this.startDate = next;
      this.endDate = this.singleDay ? next : endDateForDuration(next, length);
      this.sync();
    });
    this.endInput.addEventListener("change", () => {
      const next = this.endInput.value;
      if (!isValidISODate(next)) return;
      this.endDate = next < this.startDate ? this.startDate : next;
      this.sync();
    });
    this.sync(false);
  }
  applyDuration(days) {
    this.endDate = endDateForDuration(this.startDate, days);
    this.sync();
  }
  sync(emit = true) {
    if (this.singleDay) this.endDate = this.startDate;
    this.startInput.value = this.startDate;
    this.endInput.value = this.endDate;
    this.endInput.min = this.startDate;
    const length = daysBetween(this.startDate, this.endDate);
    for (const [days, chip] of this.chips) {
      chip.toggleClass("is-active", !this.singleDay && days === length);
    }
    this.readout.empty();
    if (this.singleDay) {
      this.readout.setText(`${weekday(this.startDate)}`);
    } else {
      const start = weekday(this.startDate);
      const end = weekday(this.endDate);
      this.readout.setText(
        `${formatDuration(this.startDate, this.endDate)} \xB7 ${start} \u2192 ${end}`
      );
    }
    if (emit) this.onChange(this.getValue());
  }
  /** Concerts and day trips collapse to a single date. */
  setSingleDay(singleDay) {
    this.singleDay = singleDay;
    this.endRow.toggleClass("is-hidden", singleDay);
    this.chipRow.toggleClass("is-hidden", singleDay);
    this.sync();
  }
  /** Pre-selects a length when the kind changes, without moving the start date. */
  suggestDuration(days) {
    if (this.singleDay) return;
    this.endDate = endDateForDuration(this.startDate, days);
    this.sync();
  }
  getValue() {
    return {
      startDate: this.startDate,
      endDate: this.singleDay ? this.startDate : this.endDate
    };
  }
  setValue(value) {
    if (isValidISODate(value.startDate)) this.startDate = value.startDate;
    if (isValidISODate(value.endDate)) this.endDate = value.endDate;
    if (this.endDate < this.startDate) this.endDate = this.startDate;
    this.sync(false);
  }
  focus() {
    this.startInput.focus();
  }
  /** Shifts the whole range by a number of days. */
  shift(days) {
    this.startDate = addDays(this.startDate, days);
    this.endDate = addDays(this.endDate, days);
    this.sync();
  }
};

// src/ui/components/suggest.ts
var import_obsidian4 = require("obsidian");

// src/data/cities.ts
var CITIES = { "Afghanistan": ["Kabul", "Kandah\u0101r", "Maz\u0101r-e Shar\u012Bf", "Her\u0101t", "Jal\u0101l\u0101b\u0101d", "Kunduz", "Ghazni", "Balkh", "Baghl\u0101n", "Gardez"], "Albania": ["Tirana", "Durr\xEBs", "Elbasan"], "Algeria": ["Algiers", "Boumerdas", "Oran", "T\xE9bessa", "Constantine", "Biskra", "S\xE9tif", "Batna", "Bab Ezzouar", "Annaba", "Sidi Bel Abb\xE8s", "Blida", "Tiaret", "Chlef", "Bordj Bou Arreridj", "Ech Chettia", "Beja\xEFa", "Skikda", "El Achir", "Souk Ahras", "Djelfa", "Mascara", "Jijel", "M\xE9d\xE9a", "Tizi Ouzou", "B\xE9char", "El Oued", "Tlemcen", "Relizane", "Mostaganem", "Ouargla", "El Eulma", "Sa\xEFda", "Guelma", "Bordj el Kiffan", "A\xEFn Oussera", "Khenchela", "Laghouat", "A\xEFn Be\xEFda", "Baraki", "Oum el Bouaghi", "M\u2019Sila"], "Angola": ["Luanda", "N\u2019dalatando", "Huambo", "Lobito", "Benguela", "Cuito", "Lubango"], "Argentina": ["Buenos Aires", "C\xF3rdoba", "Rosario", "Mendoza", "San Miguel de Tucum\xE1n", "La Plata", "Mar del Plata", "Salta", "Santa Fe", "San Juan", "Resistencia", "Santiago del Estero", "Corrientes", "Posadas", "Mor\xF3n", "San Salvador de Jujuy", "Bah\xEDa Blanca", "Paran\xE1", "Merlo", "Neuqu\xE9n", "Jos\xE9 C. Paz", "Quilmes", "Pilar", "Formosa", "San Fernando del Valle de Catamarca", "San Luis", "Berazategui", "La Rioja", "San Miguel", "R\xEDo Cuarto", "Balvanera", "Concordia", "Comodoro Rivadavia", "Belgrano", "San Nicol\xE1s de los Arroyos", "Villa Lugano", "Santa Rosa", "San Rafael", "Tandil"], "Armenia": ["Yerevan", "Gyumri", "Vanadzor"], "Australia": ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Gold Coast", "Canberra", "Newcastle", "Wollongong", "Logan City", "Geelong", "Hobart", "Townsville", "Cairns", "Toowoomba", "Darwin", "Rockingham", "Launceston", "Bendigo"], "Austria": ["Vienna", "Graz", "Linz", "Favoriten", "Donaustadt", "Floridsdorf", "Salzburg", "Innsbruck", "Ottakring", "Simmering"], "Azerbaijan": ["Baku", "Ganja", "Sumqay\u0131t", "Lankaran", "Yevlakh"], "Bahamas": ["Nassau"], "Bahrain": ["Manama"], "Bangladesh": ["Dhaka", "Chittagong", "Khulna", "R\u0101jsh\u0101hi", "Comilla", "Shibganj", "Natore", "Rangpur", "Tungi", "Narsingdi", "Bagerhat", "Cox\u2019s B\u0101z\u0101r", "Jessore", "N\u0101garpur", "Sylhet", "Mymensingh", "N\u0101r\u0101yanganj", "Bogra", "Din\u0101jpur", "Baris\u0101l", "Saidpur", "P\u0101r Naogaon", "P\u0101bna", "Paltan", "T\u0101ng\u0101il", "Jam\u0101lpur", "Puthia", "Naw\u0101bganj", "Kushtia", "Son\u0101rgaon", "S\u0101tkhira", "Sirajganj", "Far\u012Bdpur", "Sherpur", "Bhairab B\u0101z\u0101r", "Sh\u0101hz\u0101dpur"], "Belarus": ["Minsk", "Homyel'", "Mahilyow", "Vitebsk", "Hrodna", "Brest", "Babruysk", "Baranovichi", "Barysaw", "Pinsk", "Orsha", "Mazyr", "Salihorsk", "Maladzyechna", "Navapolatsk"], "Belgium": ["Brussels", "Antwerpen", "Gent", "Charleroi", "Li\xE8ge", "Brugge", "Namur"], "Benin": ["Cotonou", "Abomey-Calavi", "Djougou", "Porto-Novo", "Parakou", "Bohicon", "Kandi"], "Bolivia": ["Santa Cruz de la Sierra", "Cochabamba", "La Paz", "Sucre", "Oruro", "Tarija", "Potos\xED", "Sacaba"], "Bosnia and Herzegovina": ["Sarajevo", "Banja Luka", "Zenica", "Tuzla", "Mostar"], "Botswana": ["Gaborone"], "Brazil": ["S\xE3o Paulo", "Rio de Janeiro", "Salvador", "Fortaleza", "Belo Horizonte", "Bras\xEDlia", "Curitiba", "Manaus", "Recife", "Bel\xE9m", "Porto Alegre", "Goi\xE2nia", "Guarulhos", "Campinas", "Nova Igua\xE7u", "Macei\xF3", "S\xE3o Lu\xEDs", "Duque de Caxias", "Natal", "Teresina", "S\xE3o Bernardo do Campo", "Campo Grande", "Jaboat\xE3o", "Osasco", "Santo Andr\xE9", "Jo\xE3o Pessoa", "Jaboat\xE3o dos Guararapes", "Contagem", "Ribeir\xE3o Preto", "S\xE3o Jos\xE9 dos Campos", "Uberl\xE2ndia", "Sorocaba", "Cuiab\xE1", "Aparecida de Goi\xE2nia", "Aracaju", "Feira de Santana", "Londrina", "Juiz de Fora", "Belford Roxo", "Joinville", "Niter\xF3i", "S\xE3o Jo\xE3o de Meriti", "Ananindeua", "Florian\xF3polis", "Santos", "Ribeir\xE3o das Neves", "Vila Velha", "Serra", "Diadema", "Campos dos Goytacazes", "Mau\xE1", "Betim", "Caxias do Sul", "S\xE3o Jos\xE9 do Rio Preto", "Olinda", "Carapicu\xEDba", "Campina Grande", "Piracicaba", "Macap\xE1", "Itaquaquecetuba", "Bauru", "Montes Claros", "Canoas", "Mogi das Cruzes", "S\xE3o Vicente", "Jundia\xED", "Pelotas", "An\xE1polis", "Vit\xF3ria", "Maring\xE1", "Guaruj\xE1", "Porto Velho", "Franca", "Blumenau", "Foz do Igua\xE7u", "Ponta Grossa", "Paulista", "Limeira", "Viam\xE3o", "Suzano", "Caucaia", "Petr\xF3polis", "Uberaba", "Rio Branco", "Cascavel", "Novo Hamburgo", "Vit\xF3ria da Conquista", "Barueri", "Taubat\xE9", "Governador Valadares", "Praia Grande", "V\xE1rzea Grande", "Volta Redonda", "Santa Maria", "Santa Luzia", "Gravata\xED", "Caruaru", "Boa Vista", "Rio Verde", "Ipatinga", "Sumar\xE9", "Juazeiro do Norte", "Embu", "Imperatriz", "Colombo", "Tabo\xE3o da Serra", "Jacare\xED", "Mar\xEDlia", "Presidente Prudente", "S\xE3o Leopoldo", "Itabuna", "S\xE3o Carlos", "Hortol\xE2ndia", "Mossor\xF3", "Itapevi", "Sete Lagoas", "S\xE3o Jos\xE9", "Palmas", "Parauapebas", "Americana", "Petrolina", "Divin\xF3polis", "Maracana\xFA", "Planaltina", "Santar\xE9m", "Cama\xE7ari", "Santa B\xE1rbara d'Oeste", "Rio Grande", "Cachoeiro de Itapemirim", "Itabora\xED", "Rio Claro", "Indaiatuba", "Passo Fundo", "Cotia", "Francisco Morato", "Ara\xE7atuba", "Araraquara", "Ferraz de Vasconcelos", "Arapiraca", "Lages", "Barra Mansa", "Nossa Senhora do Socorro", "Dourados", "Crici\xFAma", "Chapec\xF3", "Barreiras", "Sobral", "Itaja\xED", "Ilh\xE9us", "Angra dos Reis", "Nova Friburgo", "Rondon\xF3polis", "Itapecerica da Serra", "Guarapuava", "Parnamirim", "Caxias", "Nil\xF3polis", "Po\xE7os de Caldas", "Marab\xE1", "Luzi\xE2nia", "Cabo", "Maca\xE9", "Ibirit\xE9", "Lauro de Freitas", "Paranagu\xE1", "Parna\xEDba", "Itu", "Castanhal", "S\xE3o Caetano do Sul", "Queimados", "Pindamonhangaba", "Sapucaia", "Jaragu\xE1 do Sul", "Mogi Gua\xE7u", "Jequi\xE9", "Itapetininga", "Patos de Minas", "Bragan\xE7a Paulista", "Timon", "S\xE3o Jos\xE9 dos Pinhais", "Teres\xF3polis", "Uruguaiana", "Porto Seguro", "Alagoinhas", "Palho\xE7a", "Barbacena", "Cachoeirinha", "Santa Rita", "Toledo", "Ja\xFA", "Cubat\xE3o", "Pinhais", "Sim\xF5es Filho", "Varginha", "Sinop", "Pouso Alegre", "Eun\xE1polis", "Botucatu", "Jandira", "Ribeir\xE3o Pires", "Conselheiro Lafaiete", "Resende", "Arauc\xE1ria", "Atibaia", "V\xE1rzea Paulista", "Garanhuns", "Araruama", "Catanduva", "Franco da Rocha", "Cabo Frio", "Ji Paran\xE1", "Araras", "Po\xE1", "Vit\xF3ria de Santo Ant\xE3o", "Umuarama", "Apucarana", "Santa Cruz do Sul", "Guaratinguet\xE1", "Linhares", "Aragua\xEDna", "Esmeraldas", "Birigui", "Assis", "Barretos", "Colatina", "Te\xF3filo Otoni", "Gua\xEDba", "Guarapari", "Coronel Fabriciano", "Itagua\xED", "Rio das Ostras"], "Bulgaria": ["Sofia", "Plovdiv", "Varna", "Burgas", "Ruse", "Stara Zagora", "Pleven"], "Burkina Faso": ["Ouagadougou", "Bobo-Dioulasso"], "Burundi": ["Bujumbura"], "Cambodia": ["Phnom Penh", "Takeo", "Sihanoukville", "Battambang", "Siem Reap"], "Cameroon": ["Douala", "Yaound\xE9", "Garoua", "Kouss\xE9ri", "Bamenda", "Maroua", "Bafoussam", "Mokolo", "Ngaound\xE9r\xE9", "Bertoua", "Ed\xE9a", "Loum", "Kumba", "Nkongsamba", "Mbouda"], "Canada": ["Toronto", "Montr\xE9al", "Calgary", "Ottawa", "Edmonton", "Mississauga", "North York", "Winnipeg", "Scarborough", "Vancouver", "Qu\xE9bec", "Hamilton", "Brampton", "Surrey", "Laval", "Halifax", "Etobicoke", "London", "Oshawa", "Okanagan", "Victoria", "Windsor", "Markham", "Gatineau", "Vaughan", "Kitchener", "Longueuil", "Burnaby", "Ladner", "Saskatoon", "Richmond Hill", "Barrie", "Richmond", "Nepean", "Regina", "Oakville", "Burlington", "Greater Sudbury", "Abbotsford", "Saguenay", "Coquitlam", "St. Catharines", "Sherbrooke", "L\xE9vis", "Kelowna", "Cambridge", "Trois-Rivi\xE8res", "Guelph", "East York", "Kingston", "Moncton", "Sydney", "Milton", "Delta", "Dartmouth"], "Cape Verde": ["Praia"], "Central African Republic": ["Bangui", "Bimbo"], "Chad": ["N'Djamena", "Moundou", "Sarh"], "Chile": ["Santiago", "Puente Alto", "Antofagasta", "Vi\xF1a del Mar", "Valpara\xEDso", "Talcahuano", "San Bernardo", "Temuco", "Iquique", "Concepci\xF3n", "Rancagua", "La Pintana", "Talca", "Arica", "Coquimbo", "Puerto Montt", "La Serena", "Chill\xE1n", "Calama", "Osorno", "Valdivia", "Quilpu\xE9", "Copiap\xF3", "Los \xC1ngeles", "Punta Arenas", "Lo Prado", "Curic\xF3"], "China": ["Shanghai", "Beijing", "Tianjin", "Guangzhou", "Shenzhen", "Wuhan", "Dongguan", "Chongqing", "Chengdu", "Nanjing", "Nanchong", "Xi\u2019an", "Shenyang", "Hangzhou", "Harbin", "Tai\u2019an", "Suzhou", "Shantou", "Jinan", "Zhengzhou", "Changchun", "Dalian", "Kunming", "Qingdao", "Foshan", "Puyang", "Wuxi", "Xiamen", "Tianshui", "Ningbo", "Shiyan", "Taiyuan", "Tangshan", "Hefei", "Zibo", "Zhongshan", "Changsha", "\xDCr\xFCmqi", "Shijiazhuang", "Lanzhou", "Yunfu", "Nanchang", "Dadonghai", "Ordos", "Jilin", "Bayan Nur", "Kunshan", "Xinyang", "Fushun", "Luoyang", "Guankou", "Handan", "Baotou", "Xuchang", "Yueyang", "Anshan", "Tongshan", "Fuzhou", "Guiyang", "Lijiang", "Datong", "Changshu City", "Xianyang", "Huainan", "Jieyang", "Zhu Cheng City", "Baoding", "Benxi", "Changzhou", "Huaibei", "Kaifeng", "Pingdingshan", "Qiqihar", "Wenzhou", "Zhabei", "Nanning", "Anyang", "Hohhot", "Shangyu", "Xining", "Qinhuangdao", "Hengyang", "Xinxiang", "Hegang", "Langfang", "Zhumadian", "Yantai", "Zhuzhou", "Changzhi", "Zhangjiakou", "Zigong", "Fuxin", "Huangshi", "Liaoyang", "Xiangtan", "Puyang Chengguanzhen", "Nantong", "Mudanjiang", "Guilin", "Zhanjiang", "Zhenjiang", "Dandong", "Shaoguan", "Yancheng", "Panshan", "Haikou", "Taizhou", "Xingtai", "Jinzhou", "Shuangyashan", "Luancheng", "Yingkou", "Zhangzhou", "Bengbu", "Shihezi", "Siping", "Huai'an", "Jiamusi", "Neijiang", "Yangzhou", "Guli", "Tanggu", "Jiangmen", "Cangzhou", "Changde", "Jiaozuo", "Tonghua", "Wuhu", "Zhuhai", "Shashi", "Wuwei", "Jianshui", "Qionghai", "Yichang", "Yinchuan", "Jiaojiang", "Zunyi", "Jiaxing", "Liaoyuan", "Xiangyang", "Dadukou", "Hengshui", "Jining", "Wenshan City", "Chengde", "Bei\u2019an", "Luqiao", "Chaozhou", "Shaoxing", "Luohe", "Yangquan", "Chaoyang", "Jixi", "Yangjiang", "Weifang", "Xinpu", "Dezhou", "Zhoukou", "Putian", "Zhangjiakou Shi Xuanhua Qu", "Pingxiang", "Fenghuang", "Zhaoqing", "Huocheng", "Anqing", "Anshun", "Chifeng", "Taihecun", "Shiqi", "Aksu", "Tieling", "Jincheng", "Yanji", "Suizhou", "Shangrao", "Baicheng", "Lianshan", "Wusong", "Jingdezhen", "Shengli", "Xinyuan", "Yangshuo", "Xiuying", "Beihai", "Huizhou", "Chuzhou", "Kashgar", "Linyi", "Chengzhong", "Wuzhou", "Hulan Ergi", "Mianyang", "Tongliao", "Aral", "Karamay", "Jiujiang", "Turpan", "Heze", "Laohekou", "Suihua", "Liupanshui", "Nanyang", "Wafangdian", "Rizhao", "Ji\u2019an", "Hebi", "Huayin", "Yibin", "Xiantao", "Yuci", "Linfen", "Liaocheng", "Fendou", "Huanggang", "Jingling", "Tongchuanshi", "Xintai", "Wuxue", "Wuhai", "Guangyuan", "Hailar", "Daliang", "Sanming", "Hangu", "Gaoping", "Daqing", "Yiyang", "Linxia Chengguanzhen", "Yuncheng", "Changji", "Kaiyuan", "Mentougou", "Xinhui", "Ezhou", "Humen", "Haicheng", "Zoucheng", "Wanxian", "Donghai", "Baiyin", "Laizhou", "Zaoyang", "Quanzhou", "Baishan", "Zaozhuang", "Anda", "Shangqiu", "Xianning", "Korla", "Qianjiang", "Chenzhou", "Jingzhou", "Zhenzhou", "Xindi", "Jiutai", "Bozhou", "Licheng", "Weinan", "Nanping", "Dongling", "Fuyang", "Laiyang", "Jingmen", "Fuling", "Gaozhou", "Ulanhot", "Shanwei", "Jiaozhou", "Tongzhou", "Anbu", "Xiaogan", "Qapqal", "Zhicheng", "Huzhou", "Nanpiao", "Yichun", "Lianghu", "Beipiao", "Guangshui", "Leshan", "Zhaodong", "Xinzhou", "Sanshui", "Boshan", "Yangchun", "Linhai", "Dingzhou", "Weihai", "Chenghua", "Deyang", "Longfeng", "Qingyuan", "Gaomi", "Loudi", "Huangyan", "Dunhua", "Yulin", "Chizhou", "Sujiatun", "Honggang", "Qujing", "Hanzhong", "Xinji", "Taishan", "Sanya", "Acheng", "Jinchang", "Meizhou", "Jinhua", "Jieshou", "Gongzhuling", "Shanhaiguan", "Altay", "Huadian", "Fuyu", "Chaohu", "Jieshi", "Jiashan", "Hami", "Shizuishan", "Gejiu", "Jiagedaqi", "Shiqiao", "Dali", "Puqi", "Ankang", "Zhalantun", "Dawukou", "Majie", "Hepo", "Dazhou", "Shuangcheng", "Dongyang", "Jiazi", "Songjiang", "Shangri-La", "Wuda", "Leiyang", "Xuanzhou", "Huaihua", "Jiangyou", "Xichang", "Danshui", "Macheng", "Huicheng", "Xiazhen", "Haimen", "Shahecheng", "Suining", "Yushu", "Lecheng", "Laiwu", "Jiupu", "Baoshan", "Minzhu", "Huangzhou", "Xiulin", "Zhoucun", "Jiayuguan", "Lianhe", "Xilin Hot", "Fengcheng", "Zhaoyuan", "Lhasa", "Puning", "Shunyi", "Longjing", "Qingzhou", "Dasha", "Yakeshi", "Binzhou", "Lengshuijiang", "Tianfu", "Wenchang", "Mingshui", "Yuyao", "Hotan", "Pingshan", "Songyuan", "Maba", "Guangming", "Shaowu", "Beibei", "Dongtai", "Encheng", "Zhuji", "Qingnian", "Mizhou", "Linshui", "Hailun", "Shilong", "Tieli", "Dongxing", "Heihe", "Zhaotong", "Hulan", "Zhongxiang", "Dehui", "Nehe", "Pingliang", "Jiangyin", "Jalai Nur", "Shaping", "Lianran", "Longjiang", "Buhe", "Xinghua", "Anqiu", "Chengtangcun", "Daxing", "Pulandian", "Wuchuan", "Jishu", "Yuxi", "Qianzhou", "Qinzhou", "Lianjiang", "Linxi", "Kangding", "Zhangye"], "Colombia": ["Bogot\xE1", "Cali", "Medell\xEDn", "Barranquilla", "Cartagena", "C\xFAcuta", "Bucaramanga", "Pereira", "Santa Marta", "Ibagu\xE9", "Bello", "Pasto", "Manizales", "Neiva", "Soledad", "Villavicencio", "Armenia", "Soacha", "Valledupar", "Itag\xFC\xED", "Monter\xEDa", "Sincelejo", "Popay\xE1n", "Floridablanca", "Palmira", "Buenaventura", "Barrancabermeja", "Dosquebradas", "Tulu\xE1", "Envigado", "Cartago", "Maicao", "Florencia", "Girardot City", "Sogamoso", "Guadalajara de Buga", "Tunja", "Gir\xF3n", "Malambo", "Magangu\xE9"], "Costa Rica": ["San Jos\xE9"], "Croatia": ["Zagreb", "Split", "Rijeka"], "Cuba": ["Havana", "Santiago de Cuba", "Camag\xFCey", "Holgu\xEDn", "Guant\xE1namo", "Santa Clara", "Diez de Octubre", "Arroyo Naranjo", "Las Tunas", "Bayamo", "Boyeros", "Pinar del R\xEDo", "Cienfuegos", "Ciudad Camilo Cienfuegos", "San Miguel del Padr\xF3n", "Centro Habana", "Matanzas", "Ciego de \xC1vila", "Cerro", "Manzanillo", "Sancti Sp\xEDritus", "Guanabacoa", "Palma Soriano", "Alamar"], "Cura\xE7ao": ["Willemstad"], "Cyprus": ["Nicosia", "Limassol"], "Czechia": ["Prague", "Brno", "Ostrava", "Pilsen", "Olomouc"], "Democratic Republic of the Congo": ["Kinshasa", "Lubumbashi", "Mbuji-Mayi", "Kisangani", "Masina", "Kananga", "Likasi", "Kolwezi", "Tshikapa", "Beni", "Bukavu", "Mwene-Ditu", "Kikwit", "Mbandaka", "Matadi", "Uvira", "Boma", "Butembo", "Gandajika", "Kalemie", "Goma", "Kindu", "Isiro", "Bandundu", "Gemena", "Ilebo"], "Denmark": ["Copenhagen", "\xC5rhus", "Odense", "Aalborg"], "Djibouti": ["Djibouti"], "Dominican Republic": ["Santo Domingo", "Santiago de los Caballeros", "Santo Domingo Oeste", "Santo Domingo Este", "San Pedro de Macor\xEDs", "La Romana", "Bella Vista", "San Crist\xF3bal", "Puerto Plata", "San Francisco de Macor\xEDs", "Salvale\xF3n de Hig\xFCey", "Concepci\xF3n de La Vega", "Punta Cana"], "East Timor": ["Dili"], "Ecuador": ["Guayaquil", "Quito", "Cuenca", "Santo Domingo de los Colorados", "Machala", "Manta", "Portoviejo", "Eloy Alfaro", "Esmeraldas", "Ambato", "Tutamandahostel", "Milagro", "Ibarra", "Riobamba", "Quevedo", "Loja"], "Egypt": ["Cairo", "Alexandria", "Giza", "Port Said", "Suez", "Al Ma\u1E29allah al Kubr\xE1", "Luxor", "Asy\u016B\u0163", "Al Man\u015F\u016Brah", "Tanda", "Al Fayy\u016Bm", "Zagazig", "Ismailia", "Kafr ad Daww\u0101r", "Aswan", "Qin\u0101", "\u1E28alw\u0101n", "Damanh\u016Br", "Al Miny\u0101", "Idk\u016B", "Sohag", "New Cairo", "Ban\u012B Suwayf", "Shib\u012Bn al Kawm", "Banh\u0101", "\u0162alkh\u0101", "Kafr ash Shaykh", "Mallaw\u012B", "Dikirnis", "Idf\u016B", "Bilbays", "Arish", "Jirj\u0101", "Al \u1E28aw\u0101mid\u012Byah", "Bilq\u0101s", "Dis\u016Bq", "Ab\u016B Kab\u012Br", "Qaly\u016Bb"], "El Salvador": ["San Salvador", "Soyapango", "Santa Ana", "San Miguel", "Mejicanos", "Santa Tecla", "Apopa"], "Equatorial Guinea": ["Bata", "Malabo"], "Eritrea": ["Asmara"], "Estonia": ["Tallinn", "Tartu"], "Eswatini": ["Manzini"], "Ethiopia": ["Addis Ababa", "Dire Dawa", "Mek'ele", "Nazr\u0113t", "Bahir Dar", "Gondar", "Des\u0113", "Hawassa", "Jimma", "Bishoftu"], "Finland": ["Helsinki", "Espoo", "Tampere", "Vantaa", "Turku", "Oulu"], "France": ["Paris", "Marseille", "Lyon", "Toulouse", "Nice", "Nantes", "Strasbourg", "Montpellier", "Bordeaux", "Lille", "Rennes", "Reims", "Le Havre", "Cergy-Pontoise", "Saint-\xC9tienne", "Toulon", "Angers", "Grenoble", "Dijon", "N\xEEmes", "Aix-en-Provence", "Saint-Quentin-en-Yvelines", "Brest", "Le Mans", "Amiens", "Tours", "Limoges", "Clermont-Ferrand", "Villeurbanne", "Besan\xE7on", "Orl\xE9ans", "Metz", "Rouen", "Mulhouse", "Perpignan", "Caen", "Boulogne-Billancourt", "Nancy", "Argenteuil"], "Gabon": ["Libreville", "Port-Gentil"], "Gambia": ["Serekunda"], "Georgia": ["Tbilisi", "Kutaisi", "Batumi"], "Germany": ["Berlin", "Hamburg", "Munich", "K\xF6ln", "Frankfurt am Main", "Essen", "Stuttgart", "Dortmund", "D\xFCsseldorf", "Bremen", "Hannover", "Leipzig", "Duisburg", "N\xFCrnberg", "Dresden", "Wandsbek", "Bochum", "Bochum-Hordel", "Wuppertal", "Bielefeld", "Bonn", "Mannheim", "Marienthal", "Karlsruhe", "Hamburg-Nord", "Wiesbaden", "M\xFCnster", "Gelsenkirchen", "Aachen", "M\xF6nchengladbach", "Augsburg", "Eimsb\xFCttel", "Altona", "Chemnitz", "Braunschweig", "Krefeld", "Halle (Saale)", "Hamburg-Mitte", "Kiel", "Magdeburg", "Neue Neustadt", "Oberhausen", "Freiburg", "L\xFCbeck", "Erfurt", "Harburg", "Hagen", "Rostock", "Kassel", "Hamm", "Mainz", "Saarbr\xFCcken", "Herne", "M\xFClheim", "Neuk\xF6lln", "Osnabr\xFCck", "Solingen", "Ludwigshafen am Rhein", "Leverkusen", "Oldenburg", "Neuss", "Prenzlauer Berg", "Kreuzberg", "Potsdam", "Heidelberg", "Paderborn", "Darmstadt", "W\xFCrzburg", "Regensburg", "Wolfsburg", "Recklinghausen", "G\xF6ttingen", "Heilbronn", "Ingolstadt", "Ulm", "Bottrop", "Charlottenburg", "Bergedorf", "Pforzheim", "Offenbach", "Friedrichshain", "Bremerhaven", "Remscheid", "Sch\xF6neberg", "Nippes", "Reutlingen", "F\xFCrth", "Moers", "Koblenz", "Siegen", "Bergisch Gladbach", "Jena", "Gera", "Marzahn", "Hildesheim", "Erlangen", "Witten", "Salzgitter", "Trier"], "Ghana": ["Accra", "Kumasi", "Tamale", "Takoradi", "Atsiaman", "Tema", "Teshi Old Town", "Cape Coast", "Sekondi-Takoradi", "Obuase", "Medina Estates"], "Greece": ["Athens", "Thessalon\xEDki", "P\xE1tra", "Piraeus", "L\xE1risa", "Perist\xE9ri", "Ir\xE1kleion", "Kallith\xE9a"], "Guatemala": ["Guatemala City", "Mixco", "Villa Nueva", "Petapa", "San Juan Sacatep\xE9quez", "Quetzaltenango", "Villa Canales", "Escuintla"], "Guinea": ["Camayenne", "Conakry", "Nz\xE9r\xE9kor\xE9", "Kindia", "Kankan"], "Guinea-Bissau": ["Bissau"], "Guyana": ["Georgetown"], "Haiti": ["Port-au-Prince", "Carrefour", "Delmas 73", "P\xE9tionville", "Port-de-Paix", "Croix-des-Bouquets", "Jacmel", "Okap", "L\xE9og\xE2ne", "Les Cayes", "Tigwav"], "Honduras": ["Tegucigalpa", "San Pedro Sula", "Choloma", "La Ceiba", "El Progreso"], "Hong Kong": ["Hong Kong", "Kowloon", "Tsuen Wan", "Yuen Long Kau Hui"], "Hungary": ["Budapest", "Debrecen", "Miskolc", "Szeged", "P\xE9cs", "Budapest XI. ker\xFClet", "Zugl\xF3", "Gy\u0151r", "Budapest III. ker\xFClet", "Ny\xEDregyh\xE1za", "Budapest XIII. ker\xFClet", "Kecskem\xE9t", "Sz\xE9kesfeh\xE9rv\xE1r"], "Iceland": ["Reykjav\xEDk"], "India": ["Mumbai", "Delhi", "Bengaluru", "Kolkata", "Chennai", "Ahmedabad", "Hyderabad", "Pune", "S\u016Brat", "Kanpur", "Jaipur", "Navi Mumbai", "Lucknow", "Nagpur", "Indore", "Patna", "Bhopal", "Ludhi\u0101na", "Tirunelveli", "Agra", "Vadodara", "Najafgarh", "Gorakhpur", "Nashik", "Pimpri", "Kaly\u0101n", "Th\u0101ne", "Meerut", "Nowrangapur", "Faridabad", "Gh\u0101zi\u0101b\u0101d", "Dombivli", "R\u0101jkot", "Varanasi", "Amritsar", "Allah\u0101b\u0101d", "Visakhapatnam", "Teni", "Jabalpur", "H\u0101ora", "Aurangabad", "Shivaji Nagar", "Sol\u0101pur", "Srinagar", "Chandigarh", "Coimbatore", "Jodhpur", "Madurai", "Guwahati", "Gwalior", "Vijayawada", "Mysore", "Rohini", "Ranchi", "Hubli", "Narela", "Jalandhar", "Thiruvananthapuram", "Salem", "Tiruchirappalli", "Kota", "Bhubaneshwar", "Al\u012Bgarh", "Bareilly", "Mor\u0101d\u0101b\u0101d", "Bhiwandi", "Raipur", "Bhilai", "Jamshedpur", "Borivli", "Cochin", "Amr\u0101vati", "S\u0101ngli", "Cuttack", "B\u012Bkaner", "Warangal", "Bhavnagar", "Nanded", "Raurkela", "Guntur", "Dehra D\u016Bn", "Bhayandar", "Durgapur", "Ajmer", "Ulhasnagar", "Kolh\u0101pur", "Siliguri", "Bilimora", "Karol B\u0101gh", "\u0100sansol", "Jamnagar", "Sah\u0101ranpur", "Gulbarga", "Bh\u0101tp\u0101ra", "Jammu", "Kurnool", "Ujjain", "R\u0101mgundam", "Shyamnagar", "Nangi", "Kozhikode", "M\u0101legaon", "Davangere", "Jalgaon", "Akola", "Belgaum", "Gaya", "Udaipur", "Korba", "Bok\u0101ro", "Mangalore", "Jh\u0101nsi", "Thoothukudi", "Nellore", "Tiruppur", "Kollam", "P\u0101nih\u0101ti", "Ahmadnagar", "Dh\u016Blia", "Bh\u0101galpur", "Pun\u0101sa", "Muzaffarnagar", "Latur", "K\u016Bkatpalli", "Ambatt\u016Br", "Bellary", "Muzaffarpur", "K\u0101m\u0101rh\u0101ti", "Mathura", "Pati\u0101la", "Ch\u0101nda", "Bh\u012Blw\u0101ra", "Thrissur", "Brahmapur", "Sh\u0101hj\u0101npur", "Shimoga", "New Delhi", "Rohtak", "Tumk\u016Br", "F\u012Broz\u0101b\u0101d", "Niz\u0101m\u0101b\u0101d", "Kulti", "R\u0101jahmundry", "Barddham\u0101n", "B\u0101r\u0101sat", "B\u0101li", "Hisar", "R\u0101mpur", "Greater Noida", "Noida", "K\u0101kin\u0101da", "P\u0101n\u012Bpat", "Parbhani", "Darbhanga", "Alwar", "Bil\u0101spur", "Ichalkaranji", "Bijapur", "Aizawl", "J\u0101lna", "Lal Bahadur Nagar", "Dewas", "Baranagar", "Gajuwaka", "Satna", "Et\u0101wah", "Durg", "Naih\u0101ti", "Tirupati", "Son\u012Bpat", "\u0100vadi", "Tiruvottiy\u016Br", "Saugor", "Mau", "Bih\u0101r Shar\u012Bf", "H\u0101pur", "Bathinda", "Farrukh\u0101b\u0101d", "Anantapur", "Ratl\u0101m", "Ramagundam", "Gang\u0101nagar", "Bharatpur", "Kar\u012Bmnagar", "Puducherry", "Shr\u012Br\u0101mpur", "R\u0101ich\u016Br", "Quthbullapur", "Karn\u0101l", "Arrah", "Imphal", "Gos\u0101ba", "Mirz\u0101pur", "Kharagpur", "Dhanb\u0101d", "Tanjore", "Amarn\u0101th", "N\u0101gercoil", "P\u0101li", "Yamun\u0101nagar", "Rewa", "Secunderabad", "B\u012Bdar", "Agartala", "Monghyr", "Burh\u0101npur", "Nadi\u0101d", "Ch\u0101pra", "Dindigul", "Panchkula", "S\u012Bkar", "Bulandshahr", "Purnia", "Hospet", "Gurgaon", "Sambhal", "Gandhinagar", "Murw\u0101ra", "N\u0101ngloi J\u0101t", "Machil\u012Bpatnam", "Katihar", "Bhiw\u0101ni", "Kultali", "Raebareli", "Haridwar", "Singrauli", "J\u016Bn\u0101gadh", "S\u016Bj\u0101ngarh", "Ellore", "Bhus\u0101val", "Khandwa", "Bahraigh", "Sirsa", "Chandannagar", "Baharampur", "Surendranagar", "Vizianagaram", "Proddat\u016Br", "Vellore", "Hugli", "Alappuzha", "Amroha", "Tambaram", "Path\u0101nkot", "Bhind", "Shimla", "Ongole", "Gadag-Betageri", "Navs\u0101ri", "Puri", "Haldia", "Khammam", "R\u0101iganj", "Ingr\u0101j B\u0101z\u0101r", "Jaunpur", "Fatehpur", "G\u0101ndh\u012Bdh\u0101m", "Nandy\u0101l", "Udupi", "Loni", "S\u012Bt\u0101pur", "Shivpuri", "Bhadr\u0101vati", "\u0100doni", "Ver\u0101val", "Sambalpur", "Gadag", "Unn\u0101o", "Budaun", "J\u012Bnd", "Madhyamgram", "J\u0101muria", "Jaigaon", "Cuddalore", "Orai", "Hoshi\u0101rpur", "Pall\u0101varam", "Hanum\u0101ngarh", "Kanchipuram", "Alandur", "Guna", "Bah\u0101durgarh", "Bhar\u016Bch", "Medin\u012Bpur", "Fyz\u0101b\u0101d", "Dinapore", "Silchar", "B\u0101nda", "Morena", "Tonk", "R\u0101j-N\u0101ndgaon", "Serilingampalle", "Vir\u0101r", "Malkajgiri", "Sh\u0101ntipur", "B\u0101r\u0101kpur", "Erode", "Amb\u0101la", "Krishnanagar", "Saharsa", "Bat\u0101la", "Bh\u012Bmavaram", "B\u0101lurgh\u0101t", "Kaithal", "Lakh\u012Bmpur", "Haz\u0101rib\u0101gh", "Vidisha", "Haldwani", "H\u0101bra", "Kumbakonam", "Porbandar", "Chitradurga", "Th\u0101nesar", "Tiruvann\u0101malai", "Anand", "K\u0101nchr\u0101p\u0101ra", "Mahb\u016Bbnagar", "Dim\u0101pur", "Robertsonpet", "Chhindw\u0101ra", "Mandya", "B\u0101nkura", "H\u0101j\u012Bpur", "Gond\u0101 City", "Bhuj", "Hindupur", "Shillong", "P\u0101lgh\u0101t", "Godhra", "Kishangarh", "R\u0101n\u012Bganj", "P\u012Blibh\u012Bt", "Be\u0101war", "Abohar", "Moga", "Dehri", "Deoria", "Hassan", "Khardah", "Yavatm\u0101l", "H\u0101l\u012Bsahar", "Panvel", "Tit\u0101garh", "Cuddapah", "Bettiah", "H\u0101thras", "Lalitpur", "Kol\u0101r", "Mandsaur", "Gondi\u0101", "Rajapalaiyam", "D\u0101rjiling", "Mohali", "P\u0101lanpur", "Dam Dam", "Hardo\u012B", "Puruliya", "Dibrugarh", "Palwal", "Nalgonda", "Bhadreswar", "Vejalpur", "Chikmagal\u016Br", "Raigarh", "Guntakal Junction", "Gang\u0101pur", "Deoli", "Siw\u0101n", "Damoh", "\u0100dil\u0101b\u0101d", "Srikakulam", "Uppal Kalan", "Jetpur", "Morbi", "P\u0101tan", "Khanna", "Bot\u0101d", "Rishra", "Azamgarh", "Yelahanka", "Gudiv\u0101da", "Baidyab\u0101ti", "Bast\u012B", "Balasore", "Dharmavaram", "M\u0101ler Kotla", "Wardha", "Jhunjhun\u016Bn", "Satara", "Chanduasi", "Moth\u012Bh\u0101ri", "Ch\u0101s", "Pudukkottai", "Rew\u0101ri", "Port Blair", "Suri\u0101pet", "Bangaon", "Chhatarpur", "Ashoknagar Kalyangarh", "Achalpur", "Navadw\u012Bp", "B\u0101rsi", "Sult\u0101npur", "Ambur", "Hoshang\u0101b\u0101d", "Saw\u0101i M\u0101dhopur", "Madanapalle", "B\u0101nsb\u0101ria", "T\u0101depalleg\u016Bdem", "Jalp\u0101iguri", "Chittaurgarh", "Gang\u0101wati", "Khurja", "Ponn\u0101ni", "Barn\u0101la", "Badlapur", "Soy\u012Bbug", "Roorkee", "Bagaha", "Hos\u016Br", "Ch\u016Bru", "Nagda", "Kashipur", "Ghaz\u012Bpur", "Begusarai", "Dhaulpur", "Mormugao", "Ferozepore", "Gondal", "Seoni", "Jag\u0101dhri", "Miri\u0101lg\u016Bda", "Udg\u012Br", "Jam\u0101lpur", "Nandurbar", "It\u0101rsi", "Vasco da Gama", "Phagw\u0101ra", "Airoli"], "Indonesia": ["Jakarta", "Surabaya", "Medan", "Bandung", "Bekasi", "Palembang", "Tangerang", "Makassar", "South Tangerang", "Semarang", "Depok", "Batam", "Padang", "Denpasar", "Bandar Lampung", "Bogor", "Malang", "Pekanbaru", "City of Balikpapan", "Yogyakarta", "Situbondo", "Banjarmasin", "Surakarta", "Cimahi", "Pontianak", "Manado", "Balikpapan", "Jambi City", "Ambon", "Samarinda", "Mataram", "Percut", "Bengkulu", "Jember", "Palu", "Kupang", "Sukabumi", "Tasikmalaya", "Pekalongan", "Cirebon", "Banda Aceh", "Tegal", "Kediri", "Binjai", "Purwokerto", "Purwakarta", "Loa Janan", "Pematangsiantar", "Ciputat", "Ciampea", "Cileungsir", "Rengasdengklok", "Sumedang", "Kendari", "Parung", "Tanjung Pinang", "Curug", "Labuan Bajo", "Cibinong", "Madiun", "Pemalang", "Lembang", "Probolinggo", "Pamulang", "Cikupa", "Salatiga", "Plumbon", "Banjaran", "Serang", "Lawang", "Pasuruan", "Sunggal", "Perbaungan", "Pasarkemis", "Soreang", "Purwodadi", "Metro", "Lubuklinggau", "Palangkaraya", "Astanajapura", "Cikampek", "Gorontalo", "Dumai", "Tanjungbalai", "Parepare", "Sidoarjo", "Weru", "Jayapura", "Baturaja", "Adiwerna", "Singaraja", "Blitar", "Martapura", "Kisaran", "Palopo", "Teluknaga", "Ungaran", "Rangkasbitung", "Klaten", "Jombang", "Paseh", "Pangkalpinang", "Sorong", "Padalarang", "Ciamis", "Lumajang", "Indramayu", "Pati", "Payakumbuh", "Bangil", "Sepatan", "Tebingtinggi", "Kedungwuni", "Batang", "Pamanukan", "Sawangan", "Mojokerto", "Cileunyi", "Magelang", "Kresek", "Citeureup", "Banyuwangi", "Cikarang", "Arjawinangun", "Prabumulih", "Rantauprapat", "Belawan", "Singkawang", "Ternate", "Bontang", "Grogol", "Padangsidempuan", "Sumedang Utara"], "Iran": ["Tehran", "Mashhad", "Isfahan", "Karaj", "Tabriz", "Shiraz", "Qom", "Ahvaz", "Pasragad Branch", "Kahr\u012Bz", "Kermanshah", "Rasht", "Kerman", "Or\u016Bm\u012Byeh", "Zahedan", "Hamad\u0101n", "\u0100z\u0101dshahr", "Ar\u0101k", "Yazd", "Ardab\u012Bl", "Abadan", "Zanj\u0101n", "Bandar Abbas", "Sanandaj", "Qazvin", "Khorramshahr", "Khorramabad", "Khomeyn\u012B Shahr", "Sari", "Bor\u016Bjerd", "Qarchak", "Gorg\u0101n", "Sabzevar", "Najaf\u0101b\u0101d", "Neysh\u0101b\u016Br", "Naz\u0327ar\u0101b\u0101d", "B\u016Bk\u0101n", "Sirjan", "B\u0101bol", "\u0100mol", "B\u012Brjand", "Bojn\u016Brd", "Var\u0101m\u012Bn", "Mal\u0101yer", "S\u0101veh", "Khowy", "Bushehr", "Mah\u0101b\u0101d", "Saqqez", "Marvdasht", "Rafsanj\u0101n", "\u012Al\u0101m", "M\u012B\u0101ndo\u0101b", "Shahrud", "Gonbad-e K\u0101v\u016Bs", "Iranshahr", "Shahr-e Kord", "Torbat-e \u1E28eydar\u012Byeh", "Semnan", "Marand", "Z\u0101bol", "Q\u016Bch\u0101n", "Masjed Soleym\u0101n", "Bandar-e Anzal\u012B", "B\u0101neh", "P\u0101rs\u0101b\u0101d", "K\u016Bhdasht"], "Iraq": ["Baghdad", "Basrah", "Al Maw\u015Fil al Jad\u012Bdah", "Al Ba\u015Frah al Qad\u012Bmah", "Mosul", "Erbil", "Ab\u016B Ghurayb", "As Sulaym\u0101n\u012Byah", "Kirkuk", "Najaf", "Karbala", "Nasiriyah", "Al \u2018Am\u0101rah", "Ad D\u012Bw\u0101n\u012Byah", "Al K\u016Bt", "Al \u1E28illah", "Dihok", "Ramadi", "Al Fall\u016Bjah", "S\u0101marr\u0101\u2019", "As Samawah", "Baqubah", "S\u012Bnah", "Soran", "Az Zubayr", "Kufa", "Umm Qa\u015Fr", "Al F\u0101w"], "Ireland": ["Dublin", "Cork"], "Israel": ["Jerusalem", "Tel Aviv", "West Jerusalem", "Haifa", "Ashdod", "Rishon Le\u1E94iyyon", "Peta\u1E96 Tiqwa", "Beersheba", "Netanya", "H\u0331olon", "Bnei Brak", "Re\u1E96ovot", "Bat Yam", "Ramat Gan", "Ashkelon", "Jaffa"], "Italy": ["Rome", "Milan", "Naples", "Turin", "Palermo", "Genoa", "Bologna", "Florence", "Catania", "Bari", "Messina", "Verona", "Padova", "Trieste", "Brescia", "Prato", "Taranto", "Reggio Calabria", "Modena", "Livorno", "Cagliari", "Mestre", "Parma", "Foggia", "Reggio nell'Emilia", "Acilia-Castel Fusano-Ostia Antica", "Salerno", "Perugia", "Monza", "Rimini", "Pescara", "Bergamo", "Vicenza"], "Ivory Coast": ["Abidjan", "Abobo", "Bouak\xE9", "Daloa", "San-P\xE9dro", "Yamoussoukro", "Korhogo", "Man", "Divo", "Gagnoa", "Abengourou", "Anyama"], "Jamaica": ["Kingston", "New Kingston", "Spanish Town", "Portmore"], "Japan": ["Tokyo", "Yokohama", "Osaka", "Nagoya", "Sapporo", "Kobe", "Kyoto", "Fukuoka", "Kawasaki", "Saitama", "Hiroshima", "Yono", "Sendai", "Kitakyushu", "Chiba", "Sakai", "Shizuoka", "Kumamoto", "Okayama", "Hamamatsu", "Hachi\u014Dji", "Honch\u014D", "Kagoshima", "Niigata", "Himeji", "Matsudo", "Nishinomiya-hama", "Kawaguchi", "Kanazawa", "Utsunomiya", "\u014Cita", "Matsuyama", "Amagasaki", "Kurashiki", "Yokosuka", "Nagasaki", "Hirakata", "Machida", "Gifu-shi", "Fujisawa", "Toyonaka", "Fukuyama", "Toyohashi", "Minato", "Nara-shi", "Toyota", "Nagano", "Iwaki", "Asahikawa", "Takatsuki", "Okazaki", "Suita", "Wakayama", "K\u014Driyama", "Kashiwa", "Tokorozawa", "Kawagoe", "Kochi", "Takamatsu", "Toyama", "Akita", "Koshigaya", "Miyazaki", "Naha", "Kasugai", "Aomori", "\u014Ctsu", "Akashi", "Yokkaichi", "Morioka", "Fukushima", "Ichihara", "Maebashi", "Ichinomiya", "Hakodate", "Ibaraki", "Yao", "Kakogawach\u014D-honmachi", "Tokushima", "Hiratsuka", "Yamagata", "Fukui-shi", "Mito", "Shimonoseki", "Takasaki", "Fuji", "Hachinohe", "Neyagawa", "Kurume", "Sasebo", "Chigasaki", "S\u014Dka", "Atsugi", "Minamirinkan", "Takarazuka", "Ageoshimo", "Ch\u014Dfu", "Matsumoto", "Kasukabe", "Kishiwada", "Numazu", "J\u014Detsu", "Odawara", "Kure", "Nagaoka", "Nishi-Tokyo-shi", "Itami", "Uji", "Suzuka", "K\u014Dfu", "Izumi", "Hitachi", "Kushiro", "Sakura", "Kamirenjaku", "Anj\u014D", "Tsukuba", "Hirosaki", "Tomakomai", "Hadano", "Obihiro", "Ube", "Hino", "Takaoka", "Kamakura", "Saga", "Tsu", "Sayama", "Kawanishi", "Oyama", "Ashikaga", "Hitachi-Naka", "Matsue", "Nagareyama", "Katsuta", "Kumagaya", "Tottori", "\u014Cta", "Komaki", "\u014Cgaki", "Higashimurayama", "\u014Cme", "Moriguchi", "Yamaguchi", "Otaru", "Urayasu", "Yonago", "Kuwana", "Kariya", "Musashino", "Zama", "Seto", "Ebetsu", "Tondabayashich\u014D", "Fujieda", "Sandach\u014D", "Kakamigahara", "\u014Cmuta", "Abiko", "Kadoma", "Miyakonoj\u014D", "Matsubara", "Isesaki", "Dait\u014Dch\u014D", "Mino", "Asaka", "Kusatsu", "Ueda", "Okinawa", "Beppu", "Kashihara-shi", "Niihama", "Kisarazu", "Nobeoka", "Fujinomiya", "Noda", "Yaizu", "Toyokawa", "Shimotoda", "Kokubunji", "Ikoma", "Ishinomaki", "H\u014Dfu", "Handa", "Mishima", "Kitami", "Hikone", "Kiry\u016B", "Komatsu", "Iwatsuki", "Tajimi", "Iida", "Fukayach\u014D", "Honmachi", "Iwakuni", "Isehara", "Nishio", "Inazawa", "Tokuyama", "Narita", "Izumisano", "Sakata", "K\u014Dnan", "Chikushino-shi"], "Jordan": ["Amman", "Zarqa", "Irbid", "Russeifa", "W\u0101d\u012B as S\u012Br", "\u2018Ajl\u016Bn"], "Kazakhstan": ["Almaty", "Karagandy", "Shymkent", "Taraz", "Nur-Sultan", "Pavlodar", "Ust-Kamenogorsk", "Kyzylorda", "Semey", "Aktobe", "Kostanay", "Petropavl", "Oral", "Atyrau", "Temirtau", "Aktau", "Kokshetau", "Rudnyy", "Ekibastuz", "Taldykorgan", "Zhezqazghan", "Zhanaozen"], "Kenya": ["Nairobi", "Mombasa", "Nakuru", "Eldoret", "Kisumu", "Thika", "Malindi"], "Kosovo": ["Pristina", "Prizren", "Mitrovic\xEB"], "Kuwait": ["Al A\u1E29mad\u012B", "\u1E28awall\u012B", "As S\u0101lim\u012Byah", "\u015Eab\u0101\u1E29 as S\u0101lim"], "Kyrgyzstan": ["Bishkek", "Osh"], "Laos": ["Vientiane"], "Latvia": ["Riga", "Daugavpils"], "Lebanon": ["Beirut", "Ra\u2019s Bayr\u016Bt", "Tripoli", "Sidon", "Tyre", "Nabat\xEEy\xE9 et Tahta"], "Lesotho": ["Maseru"], "Liberia": ["Monrovia"], "Libya": ["Tripoli", "Benghazi", "Mi\u015Fr\u0101tah", "Tarhuna", "Al Khums", "Az Z\u0101w\u012Byah", "Zawiya", "Ajdabiya", "Al Ajaylat", "Sabh\u0101", "Sirte", "Al Jad\u012Bd", "Tobruk", "Zliten", "\u015Eabr\u0101tah", "Tagiura"], "Lithuania": ["Vilnius", "Kaunas", "Klaip\u0117da", "\u0160iauliai", "Panev\u0117\u017Eys"], "Macau": ["Macau"], "Madagascar": ["Antananarivo", "Toamasina", "Antsirabe", "Fianarantsoa", "Mahajanga", "Toliara"], "Malawi": ["Lilongwe", "Blantyre", "Mzuzu"], "Malaysia": ["Kota Bharu", "Kuala Lumpur", "Klang", "Kampung Baru Subang", "Johor Bahru", "Subang Jaya", "Ipoh", "Kuching", "Petaling Jaya", "Shah Alam", "Kota Kinabalu", "Sandakan", "Seremban", "Kuantan", "Tawau", "George Town", "Kuala Terengganu", "Sungai Petani", "Miri", "Taiping", "Alor Setar", "Bukit Mertajam", "Sepang", "Sibu", "Malacca", "Kulim", "Kluang", "Skudai", "Batu Pahat", "Bintulu", "Kampung Pasir Gudang Baru", "Kampung Sungai Ara", "Tasek Glugor", "Muar", "Ampang", "Rawang", "Butterworth", "Lahad Datu"], "Maldives": ["Male"], "Mali": ["Bamako", "Sikasso", "Mopti"], "Mauritania": ["Nouakchott"], "Mauritius": ["Port Louis", "Beau Bassin-Rose Hill", "Vacoas"], "Mexico": ["Mexico City", "Iztapalapa", "Ecatepec de Morelos", "Guadalajara", "Puebla", "Ju\xE1rez", "Tijuana", "Le\xF3n de los Aldama", "Gustavo Adolfo Madero", "Zapopan", "Monterrey", "Ciudad Nezahualcoyotl", "Chihuahua", "Naucalpan de Ju\xE1rez", "M\xE9rida", "\xC1lvaro Obreg\xF3n", "San Luis Potos\xED", "Aguascalientes", "Hermosillo", "Saltillo", "Mexicali", "Culiac\xE1n", "Guadalupe", "Acapulco de Ju\xE1rez", "Tlalnepantla", "Canc\xFAn", "Santiago de Quer\xE9taro", "Coyoac\xE1n", "Santa Mar\xEDa Chimalhuac\xE1n", "Torre\xF3n", "Morelia", "Reynosa", "Tlaquepaque", "Tlalpan", "Tuxtla", "Cuauht\xE9moc", "Victoria de Durango", "Toluca", "Ciudad L\xF3pez Mateos", "Cuautitl\xE1n Izcalli", "Ciudad Apodaca", "Heroica Matamoros", "San Nicol\xE1s de los Garza", "Venustiano Carranza", "Veracruz", "Xalapa de Enr\xEDquez", "Azcapotzalco", "Tonal\xE1", "Xochimilco", "Benito Ju\xE1rez", "Iztacalco", "Mazatl\xE1n", "Irapuato", "Nuevo Laredo", "Miguel Hidalgo", "Xico", "Benito Juarez", "Villahermosa", "Ciudad General Escobedo", "Celaya", "Cuernavaca", "Tepic", "Ixtapaluca", "Tampico", "Ciudad Victoria", "Tl\xE1huac", "Ciudad Obreg\xF3n", "Nicol\xE1s Romero", "Ensenada", "Coacalco", "Santa Catarina", "Uruapan", "G\xF3mez Palacio", "Los Mochis", "Pachuca de Soto", "Oaxaca", "Soledad de Graciano S\xE1nchez", "Colonia del Valle", "Tehuac\xE1n", "Ojo de Agua", "Magdalena Contreras", "Coatzacoalcos", "Campeche", "Monclova", "La Paz", "Nogales", "Buenavista", "Puerto Vallarta", "Tapachula", "Ciudad Madero", "Chilpancingo", "Poza Rica de Hidalgo", "Chicoloapan", "Ciudad del Carmen", "Chalco", "Jiutepec", "Delegaci\xF3n Cuajimalpa de Morelos", "Salamanca", "San Luis R\xEDo Colorado", "San Crist\xF3bal de las Casas", "San Pablo de las Salinas", "Cuautla", "Ciudad Benito Ju\xE1rez", "Chetumal", "Piedras Negras", "Playa del Carmen", "Zamora", "C\xF3rdoba", "San Juan del R\xEDo", "Colima", "Ciudad Acu\xF1a", "Manzanillo", "Zacatecas", "Huixquilucan", "Ciudad Valles", "San Pedro Garza Garc\xEDa", "San Pedro Garza Garcia", "Fresnillo", "Orizaba", "Miramar", "Iguala de la Independencia", "Ciudad Delicias", "Ciudad de Villa de \xC1lvarez", "Navojoa", "Heroica Guaymas", "Minatitl\xE1n", "Cuautitl\xE1n", "Texcoco de Mora", "Parral", "Tepexpan", "Tulancingo", "Tuxtepec", "Colonia Lindavista"], "Moldova": ["Chisinau", "Tiraspol", "B\u0103l\u0163i", "Bender"], "Mongolia": ["Ulan Bator"], "Montenegro": ["Podgorica"], "Morocco": ["Casablanca", "Rabat", "F\xE8s", "Sale", "Marrakesh", "Agadir", "Tangier", "Mekn\xE8s", "Oujda-Angad", "Al Hoce\xEFma", "Kenitra", "T\xE9touan", "Temara", "Safi", "Sal\xE9 Al Jadida", "Mohammedia", "Khouribga", "Beni Mellal", "F\xE8s al Bali", "El Jadid", "Taza", "Nador", "Settat", "Larache", "Ksar El Kebir", "Khemisset"], "Mozambique": ["Maputo", "Matola", "Beira", "Nampula", "Chimoio", "Nacala", "Quelimane", "Tete", "Xai-Xai", "Maxixe", "Mandimba", "Ressano Garcia", "Lichinga", "Pemba"], "Myanmar": ["Yangon", "Mandalay", "Nay Pyi Taw", "Mawlamyine", "Kyain Seikgyi Township", "Bago", "Pathein", "Monywa", "Sittwe", "Meiktila", "Myeik", "Taunggyi", "Myingyan", "Dawei", "Pyay", "Hinthada", "Lashio", "Pakokku", "Thaton", "Pyin Oo Lwin", "Yenangyaung", "Taungoo"], "Namibia": ["Windhoek"], "Nepal": ["Kathmandu", "Pokhara", "P\u0101tan", "Biratnagar", "Birga\xF1j", "Dhar\u0101n", "Bharatpur"], "Netherlands": ["Amsterdam", "Rotterdam", "The Hague", "Utrecht", "Eindhoven", "Tilburg", "Groningen", "Almere Stad", "Breda", "Nijmegen", "Enschede", "Haarlem", "Arnhem", "Zaanstad", "Amersfoort", "Apeldoorn", "'s-Hertogenbosch", "Hoofddorp", "Maastricht", "Leiden", "Dordrecht", "Zoetermeer", "Zwolle"], "New Zealand": ["Auckland", "Wellington", "Christchurch", "Manukau City", "North Shore", "Hamilton", "Dunedin", "Tauranga", "Lower Hutt"], "Nicaragua": ["Managua", "Le\xF3n", "Masaya", "Chinandega", "Matagalpa"], "Niger": ["Niamey", "Zinder", "Maradi", "Agadez"], "Nigeria": ["Lagos", "Kano", "Ibadan", "Kaduna", "Port Harcourt", "Benin City", "Maiduguri", "Zaria", "Aba", "Jos", "Ilorin", "Oyo", "Enugu", "Abeokuta", "Abuja", "Sokoto", "Onitsha", "Warri", "Ebute Ikorodu", "Okene", "Calabar", "Uyo", "Katsina", "Ado-Ekiti", "Akure", "Lekki", "Bauchi", "Ikeja", "Makurdi", "Minna", "Efon-Alaaye", "Ilesa", "Owo", "Umuahia", "Ondo", "Ikot Ekpene", "Iwo", "Gombe", "Jimeta", "Atani", "Gusau", "Mubi", "Ikire", "Owerri", "Shagamu", "Ijebu-Ode", "Ugep", "Chakwama", "Nnewi", "Ise-Ekiti", "Ila Orangun", "Saki", "Bida", "Awka", "Ijero-Ekiti", "Inisa", "Suleja", "Sapele", "Osogbo", "Kisi", "Gbongan", "Ejigbo", "Funtua", "Igboho", "Buguma", "Ikirun", "Abakaliki", "Okrika", "Amaigbo", "Lafia", "Gashua", "Modakeke", "Bama", "Ilobu", "Jalingo", "Okigwe", "Offa", "Esuk Oron", "Nsukka", "Nguru", "Hadejia", "Ijebu-Igbo", "Uromi", "Birnin Kebbi", "Pindiga", "Azare", "Nkpor", "Ikere-Ekiti", "Lafiagi"], "North Korea": ["Pyongyang", "Hamh\u016Dng", "Namp\u2019o", "Sunch\u2019\u014Fn", "H\u016Dngnam", "Kaes\u014Fng", "W\u014Fnsan", "Chongjin", "Sariw\u014Fn", "Sin\u016Diju", "Haeju", "Kanggye", "Hyesan", "Songnim", "Manp\u2019o", "P\u2019y\u014Fngs\u014Fng"], "North Macedonia": ["Skopje"], "Norway": ["Oslo", "Bergen", "Trondheim", "Stavanger"], "Oman": ["Muscat", "Seeb", "\u015Eal\u0101lah", "Bawshar", "Sohar", "As Suwayq", "\u2018Ibr\u012B"], "Pakistan": ["Karachi", "Lahore", "Faisalabad", "Rawalpindi", "Multan", "Hyderabad", "Gujranwala", "Peshawar", "Rahim Yar Khan", "Quetta", "Muzaffar\u0101b\u0101d", "Battagram", "Kotli", "Islamabad", "Bahawalpur", "Sargodha", "Sialkot", "Sukkur", "Larkana", "Shekhupura", "Bhimbar", "Jhang Sadr", "Gujrat", "Mardan", "Malir Cantonment", "Kasur", "Mingora", "Dera Ghazi Khan", "Sahiwal", "Nawabshah", "Okara", "Mirpur Khas", "Chiniot", "Shahkot", "Kamoke", "Saddiqabad", "B\u016Brew\u0101la", "Jacobabad", "Muzaffargarh", "Muridke", "Shikarpur", "Hafizabad", "Kohat", "Tordher", "Jhelum", "Khanpur", "Khuzdar", "Dadu", "Gojra", "Mandi Bahauddin", "Tando Allahyar", "Daska Kalan", "Pakpattan", "Bahawalnagar", "Tando Adam", "Khairpur Mir\u2019s", "New Mirpur", "Chishtian", "Abbottabad", "Jaranwala", "Ahmadpur East", "Vihari", "Kamalia", "Kot Addu", "Khush\u0101b", "Wazirabad", "Dera Ismail Khan", "Chakwal"], "Palestine": ["East Jerusalem", "Gaza", "Kh\u0101n Y\u016Bnis", "Jab\u0101ly\u0101", "Hebron", "Nablus", "Rafa\u1E29"], "Panama": ["Panam\xE1", "San Miguelito", "Juan D\xEDaz"], "Papua New Guinea": ["Port Moresby"], "Paraguay": ["Asunci\xF3n", "Ciudad del Este", "San Lorenzo", "Capiat\xE1", "Lambar\xE9", "Fernando de la Mora"], "Peru": ["Lima", "Arequipa", "Callao", "Trujillo", "Chiclayo", "Iquitos", "Huancayo", "Piura", "Chimbote", "Cusco", "Pucallpa", "Tacna", "Santiago de Surco", "Ica", "Juliaca", "Sullana", "Chincha Alta", "Hu\xE1nuco", "Ayacucho", "Cajamarca", "Puno", "Tumbes"], "Philippines": ["Quezon City", "Manila", "Caloocan City", "Budta", "Davao", "Malingao", "Cebu City", "General Santos", "Taguig", "Pasig City", "Las Pi\xF1as", "Antipolo", "Makati City", "Zamboanga", "Bacolod City", "Mansilingan", "Cagayan de Oro", "Dasmari\xF1as", "Pasay", "Iloilo", "San Jose del Monte", "Bacoor", "Lapu-Lapu City", "Iligan", "Mandaue City", "Calamba", "Iligan City", "Butuan", "Cabuyao", "Mandaluyong City", "Bi\xF1an", "Angeles City", "Santol", "Cainta", "Baguio", "San Pedro", "Mantampay", "San Fernando", "Libertad", "Navotas", "Tacloban", "Batangas", "Magugpo Poblacion", "Taytay", "Lucena", "Puerto Princesa", "Olongapo", "Cabanatuan City", "Binangonan", "Santa Rosa", "Imus", "Lipa City", "San Pablo", "Malolos", "Ormoc", "Panalanoy", "Mabalacat City", "Pagadian", "Meycauayan", "Tarlac City", "Legaspi", "Cotabato", "Naga", "Dagupan", "Toledo", "Guyong", "Bago City", "Marawi City", "Kabankalan", "Baliuag", "Rodriguez", "San Mateo", "Talisay", "Muricay", "Bulaon", "Cadiz", "Koronadal", "Hagonoy", "San Juan", "Silang", "San Jose", "Digos", "Cavite City", "Tuguegarao", "Dumaguete", "Santiago", "Santa Cruz", "Mati", "Tanza", "Roxas City", "Laoag", "Pulong Santa Cruz", "Urdaneta", "Jolo"], "Poland": ["Warsaw", "\u0141\xF3d\u017A", "Krak\xF3w", "Wroc\u0142aw", "Pozna\u0144", "Gda\u0144sk", "Szczecin", "Bydgoszcz", "Lublin", "Katowice", "Bia\u0142ystok", "Gdynia", "Cz\u0119stochowa", "Sosnowiec", "Radom", "Mokot\xF3w", "Toru\u0144", "Kielce", "Gliwice", "Zabrze", "Bytom", "Praga Po\u0142udnie", "Bielsko-Biala", "Olsztyn", "Rzesz\xF3w", "Ursyn\xF3w", "Ruda \u015Al\u0105ska", "Wola", "Rybnik", "Bielany", "\u015Ar\xF3dmie\u015Bcie", "D\u0105browa G\xF3rnicza", "Tychy", "Opole", "Elbl\u0105g", "P\u0142ock", "Wa\u0142brzych", "Gorz\xF3w Wielkopolski", "Targ\xF3wek", "W\u0142oc\u0142awek", "Zielona G\xF3ra", "Tarn\xF3w", "Chorz\xF3w", "Kalisz", "Koszalin", "Legnica", "Bemowo"], "Portugal": ["Lisbon", "Porto", "Amadora", "Braga", "Set\xFAbal", "Coimbra", "Queluz", "Funchal"], "Puerto Rico": ["San Juan", "Bayam\xF3n", "Carolina", "Ponce"], "Qatar": ["Doha", "Ar Rayy\u0101n"], "Republic of the Congo": ["Brazzaville", "Pointe-Noire", "Dolisie"], "R\xE9union": ["Saint-Denis"], "Romania": ["Bucharest", "Sector 3", "Sector 6", "Sector 2", "Ia\u015Fi", "Cluj-Napoca", "Timi\u015Foara", "Craiova", "Constan\u0163a", "Gala\u0163i", "Sector 4", "Bra\u015Fov", "Sector 5", "Ploie\u015Fti", "Sector 1", "Br\u0103ila", "Oradea", "Bac\u0103u", "Arad", "Pite\u015Fti", "Sibiu", "T\xE2rgu-Mure\u015F", "Baia Mare", "Buz\u0103u", "Boto\u015Fani", "Satu Mare", "R\xE2mnicu V\xE2lcea", "Suceava", "Piatra Neam\u0163", "Drobeta-Turnu Severin"], "Russia": ["Moscow", "Saint Petersburg", "Novosibirsk", "Yekaterinburg", "Nizhniy Novgorod", "Samara", "Omsk", "Kazan", "Rostov-na-Donu", "Chelyabinsk", "Ufa", "Volgograd", "Perm", "Krasnoyarsk", "Saratov", "Voronezh", "Tol\u2019yatti", "Krasnodar", "Ulyanovsk", "Izhevsk", "Yaroslavl", "Barnaul", "Vladivostok", "Irkutsk", "Khabarovsk", "Khabarovsk Vtoroy", "Orenburg", "Novokuznetsk", "Ryazan\u2019", "Tyumen", "Lipetsk", "Penza", "Naberezhnyye Chelny", "Kalininskiy", "Astrakhan", "Makhachkala", "Tomsk", "Kemerovo", "Tula", "Kirov", "Cheboksary", "Kaliningrad", "Bryansk", "Ivanovo", "Magnitogorsk", "Kursk", "Tver", "Nizhny Tagil", "Stavropol\u2019", "Ulan-Ude", "Arkhangel\u2019sk", "Belgorod", "Kurgan", "Kaluga", "Krasnogvargeisky", "Sochi", "Or\xEBl", "Volzhskiy", "Smolensk", "Murmansk", "Vladikavkaz", "Cherepovets", "Vologda", "Vladimir", "Chita", "Saransk", "Surgut", "Tambov", "Yoshkar-Ola", "Taganrog", "Kostroma", "Komsomolsk-on-Amur", "Nal\u2019chik", "Sterlitamak", "Petrozavodsk", "Bratsk", "Orsk", "Nizhnevartovsk", "Angarsk", "Mar\u2019ino", "Novorossiysk", "Khimki", "Yakutsk", "Nizhnekamsk", "Dzerzhinsk", "Syktyvkar", "Staryy Oskol", "Groznyy", "Shakhty", "Blagoveshchensk", "Prokop\u2019yevsk", "Rybinsk", "Vykhino-Zhulebino", "Zelenograd", "Biysk", "Velikiy Novgorod", "Centralniy", "Vasyl'evsky Ostrov", "Pskov", "Severnyy", "Balakovo", "Armavir", "Engel\u2019s", "Severodvinsk", "Zlatoust", "Syzran\u2019", "Petropavlovsk-Kamchatsky", "Kamensk-Ural\u2019skiy", "Yasenevo", "Podolsk", "Yuzhno-Sakhalinsk", "Lyublino", "Berezniki", "Volgodonsk", "Miass", "Abakan", "Novocherkassk", "Nazran\u2019", "Rubtsovsk", "Mytishchi", "Salavat", "Bibirevo", "Khorosh\xEBvo-Mnevniki", "Gol\u2019yanovo", "Admiralteisky", "Ussuriysk", "Lyubertsy", "Kovrov", "Strogino", "Balashikha", "Zhulebino", "Kolomna", "Nakhodka", "Elektrostal\u2019", "Maykop", "Biryul\xEBvo", "Orekhovo-Borisovo", "Kuz\u2019minki", "Novyye Kuz\u2019minki", "Pyatigorsk", "Chertanovo Yuzhnoye", "Zheleznodorozhnyy", "Norilsk", "Al\u2019met\u2019yevsk", "Korolev", "Kolpino", "Odintsovo", "Nevinnomyssk", "Pervoural\u2019sk", "Kislovodsk", "Dimitrovgrad", "Novomoskovsk", "Petrogradka", "Ramenki", "Zyablikovo", "Kamyshin", "Novocheboksarsk", "Serpukhov", "Ivanovskoye", "Orekhovo-Borisovo Severnoye", "Murom", "Khasavyurt", "Neftekamsk", "Tyoply Stan", "Tsaritsyno", "Presnenskiy", "Veshnyaki", "Zyuzino", "Orekhovo-Zuyevo", "Solntsevo", "Tropar\xEBvo", "Achinsk", "Cherkessk", "Taganskiy", "Noginsk", "Yelets", "Novo-Peredelkino", "Ochakovo-Matveyevskoye", "Tobol\u2019sk", "Shchelkovo", "Nefteyugansk", "Novokuybyshevsk", "Noyabrsk", "Bataysk", "Seversk", "Arzamas", "Sergiyev Posad", "Leninsk-Kuznetsky", "Kyzyl", "Oktyabr\u2019skiy", "Obninsk", "Elista", "Cher\xEBmushki", "Novotroitsk", "Derbent", "Izmaylovo", "Kisel\xEBvsk", "Akademicheskoe", "Velikiye Luki", "Bogorodskoye", "Pushkino", "Art\xEBm", "Ukhta", "Brateyevo", "Shchukino", "Kansk", "Mezhdurechensk", "Novyye Cher\xEBmushki", "Ryazanskiy", "Solikamsk", "Glazov", "Ust\u2019-Ilimsk", "Tekstil\u2019shchiki"], "Rwanda": ["Kigali"], "Saudi Arabia": ["Riyadh", "Jeddah", "Mecca", "Medina", "Sul\u0163\u0101nah", "Dammam", "Ta\u2019if", "Tabuk", "Al Kharj", "Buraydah", "Khamis Mushait", "Al Huf\u016Bf", "Al Mubarraz", "Hafar Al-Batin", "Ha'il", "Najr\u0101n", "Al Jubayl", "Abha", "Yanbu", "Khobar", "Arar", "Sakakah", "Jizan", "Qurayyat"], "Senegal": ["Dakar", "Pikine", "Touba", "Thi\xE8s", "Thi\xE8s Nones", "Saint-Louis", "Kaolack", "Ziguinchor", "Ti\xE9bo"], "Serbia": ["Belgrade", "Ni\u0161", "Novi Sad", "Zemun", "Kragujevac", "\u010Ca\u010Dak", "Subotica"], "Sierra Leone": ["Freetown", "Bo", "Kenema"], "Singapore": ["Singapore", "Woodlands"], "Slovakia": ["Bratislava", "Ko\u0161ice"], "Slovenia": ["Ljubljana"], "Somalia": ["Mogadishu", "Hargeysa", "Berbera", "Kismayo", "Marka", "Jamaame", "Baidoa"], "South Africa": ["Cape Town", "Durban", "Johannesburg", "Soweto", "Pretoria", "Port Elizabeth", "Pietermaritzburg", "Benoni", "Tembisa", "East London", "Vereeniging", "Bloemfontein", "Boksburg", "Welkom", "Newcastle", "Krugersdorp", "Diepsloot", "Randburg", "Botshabelo", "Brakpan", "Witbank", "Richards Bay", "Vanderbijlpark", "Centurion", "Uitenhage", "Roodepoort", "Paarl", "Springs", "Carletonville", "Klerksdorp", "Midrand", "Westonaria", "Middelburg", "Vryheid", "Orkney", "Kimberley", "eMbalenhle", "Nigel", "Mpumalanga", "Bhisho", "Randfontein", "Worcester", "Rustenburg", "Polokwane", "Potchefstroom", "Virginia", "Brits", "Alberton", "Nelspruit", "Phalaborwa", "Queenstown", "Kroonstad", "Bethal", "Mokopane"], "South Korea": ["Seoul", "Busan", "Incheon", "Daegu", "Daejeon", "Gwangju", "Suwon", "Goyang-si", "Seongnam-si", "Ulsan", "Bucheon-si", "Jeonju", "Ansan-si", "Cheongju-si", "Anyang-si", "Changwon", "Pohang", "Uijeongbu-si", "Hwaseong-si", "Masan", "Jeju City", "Cheonan", "Kwangmy\u014Fng", "Kimhae", "Chinju", "Yeosu", "Gumi", "Iksan", "Mokpo", "Gunsan", "W\u014Fnju", "Suncheon", "Sejong", "Chuncheon", "Icheon-si", "Guri-si", "Gangneung", "Yangju", "Osan", "Seogwipo", "Gyeongju", "Gimcheon", "Jeongeup", "Hanam", "Gyeongsan-si", "Andong", "Hwado", "Tonghae"], "South Sudan": ["Juba", "Winejok", "Malakal", "Wau"], "Spain": ["Madrid", "Barcelona", "Valencia", "Sevilla", "Zaragoza", "M\xE1laga", "Murcia", "Palma", "Las Palmas de Gran Canaria", "Bilbao", "Alicante", "C\xF3rdoba", "Valladolid", "Vigo", "Gij\xF3n", "Eixample", "L'Hospitalet de Llobregat", "Latina", "Carabanchel", "A Coru\xF1a", "Puente de Vallecas", "Sant Mart\xED", "Gasteiz / Vitoria", "Granada", "Elche", "Ciudad Lineal", "Oviedo", "Santa Cruz de Tenerife", "Fuencarral-El Pardo", "Badalona", "Cartagena", "Terrassa", "Jerez de la Frontera", "Sabadell", "M\xF3stoles", "Alcal\xE1 de Henares", "Pamplona", "Fuenlabrada", "Almer\xEDa", "Legan\xE9s", "Donostia / San Sebasti\xE1n", "Sants-Montju\xEFc", "Santander", "Castell\xF3 de la Plana", "Burgos", "Albacete", "Horta-Guinard\xF3", "Alcorc\xF3n", "Getafe", "Nou Barris", "Hortaleza", "San Blas-Canillejas", "Salamanca", "Tetu\xE1n de las Victorias", "Logro\xF1o", "La Laguna", "City Center", "Huelva", "Arganzuela", "Badajoz", "Sarri\xE0-Sant Gervasi", "Sant Andreu", "Chamber\xED", "Usera", "Tarragona", "Chamart\xEDn", "Lleida", "Marbella", "Le\xF3n", "Villaverde", "Cadiz", "Retiro", "Dos Hermanas", "Matar\xF3", "Gr\xE0cia", "Santa Coloma de Gramenet", "Torrej\xF3n de Ardoz", "Ja\xE9n", "Moncloa-Aravaca", "Algeciras", "Parla", "Delicias", "Ourense", "Alcobendas", "Reus", "Moratalaz", "Ciutat Vella", "Torrevieja", "Telde"], "Sri Lanka": ["Colombo", "Dehiwala-Mount Lavinia", "Moratuwa", "Jaffna", "Negombo", "Pita Kotte", "Sri Jayewardenepura Kotte", "Kandy", "Trincomalee", "Kalmunai"], "Sudan": ["Khartoum", "Omdurman", "Nyala", "Port Sudan", "Kassala", "El Obeid", "Al Qadarif", "Kosti", "Wad Medani", "El Daein", "El Fasher", "Singa", "Ad-Damazin", "Geneina", "Rabak", "Sinnar", "Al Man\u0101qil", "Gereida", "An Nuh\u016Bd", "Atbara", "Ed Damer"], "Suriname": ["Paramaribo"], "Sweden": ["Stockholm", "G\xF6teborg", "Malm\xF6", "Uppsala", "Sollentuna", "S\xF6dermalm", "V\xE4ster\xE5s", "\xD6rebro", "Link\xF6ping", "Helsingborg"], "Switzerland": ["Z\xFCrich", "Gen\xE8ve", "Basel", "Bern", "Lausanne"], "Syria": ["Aleppo", "Damascus", "Homs", "\u1E28am\u0101h", "Latakia", "Deir ez-Zor", "Ar Raqqah", "Al B\u0101b", "Idlib", "Douma"], "Taiwan": ["Taipei", "Kaohsiung", "Taichung", "Tainan", "Banqiao", "Hsinchu", "Taoyuan City", "Keelung", "Hualien City", "Yuanlin", "Taitung City", "Nantou", "Douliu"], "Tajikistan": ["Dushanbe", "Khujand"], "Tanzania": ["Dar es Salaam", "Mwanza", "Zanzibar", "Arusha", "Mbeya", "Morogoro", "Tanga", "Dodoma", "Kigoma", "Moshi", "Tabora", "Songea", "Musoma", "Iringa", "Katumba", "Shinyanga"], "Thailand": ["Bangkok", "Samut Prakan", "Mueang Nonthaburi", "Udon Thani", "Chon Buri", "Nakhon Ratchasima", "Chiang Mai", "Hat Yai", "Pak Kret", "Si Racha", "Phra Pradaeng", "Lampang", "Khon Kaen", "Surat Thani", "Ubon Ratchathani", "Nakhon Si Thammarat", "Khlong Luang", "Nakhon Pathom", "Rayong", "Phitsanulok"], "Togo": ["Lom\xE9", "Sokod\xE9", "Kara"], "Tunisia": ["Tunis", "Sfax", "Sousse", "Kairouan", "Bizerte", "Gab\xE8s"], "Turkey": ["Istanbul", "Ankara", "\u0130zmir", "Bursa", "Adana", "Gaziantep", "Konya", "\xC7ankaya", "Antalya", "Ba\u011Fc\u0131lar", "Diyarbak\u0131r", "Kayseri", "\xDCsk\xFCdar", "Bah\xE7elievler", "Umraniye", "Mersin", "Esenler", "Eski\u015Fehir", "Karaba\u011Flar", "Muratpa\u015Fa", "\u015Eanl\u0131urfa", "Malatya", "Sultangazi", "Maltepe", "Erzurum", "Samsun", "Batman", "Kahramanmara\u015F", "Van", "Ata\u015Fehir", "\u015Ei\u015Fli", "Denizli", "Batikent", "Elaz\u0131\u011F", "Zeytinburnu", "Adapazar\u0131", "Sultanbeyli", "Gebze", "Merkezefendi", "Sivas", "Tarsus", "Trabzon", "Manisa", "Sancaktepe", "Bal\u0131kesir", "Ad\u0131yaman", "Esenyurt", "K\u0131r\u0131kkale", "Antakya", "Osmaniye", "\xC7orlu", "Arnavutk\xF6y", "\u0130zmit", "Ba\u015Fak\u015Fehir", "K\xFCtahya", "\xC7orum", "Siverek", "Isparta", "B\xFCy\xFCk\xE7ekmece", "Ayd\u0131n", "\u0130skenderun", "Viran\u015Fehir", "U\u015Fak", "Aksaray", "K\u0131z\u0131ltepe", "Afyonkarahisar", "\u0130negol", "Tokat", "Edirne", "Derince", "Beylikd\xFCz\xFC", "Tekirda\u011F", "Karaman", "Nazilli", "Ordu", "Siirt", "Erzincan", "Alanya", "Turhal", "Band\u0131rma", "Turgutlu", "Mustafakemalpa\u015Fa", "Zonguldak"], "Turkmenistan": ["Ashgabat", "T\xFCrkmenabat", "Da\u015Foguz", "Mary"], "Uganda": ["Kampala", "Gulu", "Lira"], "Ukraine": ["Kyiv", "Kharkiv", "Dnipro", "Donetsk", "Odessa", "Zaporizhia", "Lviv", "Kryvyi Rih", "Mykolayiv", "Mariupol", "Luhansk", "Sevastopol", "Khmelnytskyi", "Makiyivka", "Vinnytsia", "Simferopol", "Kherson", "Poltava", "Chernihiv", "Cherkasy", "Sumy", "Zhytomyr", "Horlivka", "Rivne", "Kropyvnytskyi", "Kamianske", "Chernivtsi", "Ternopil", "Kremenchuk", "Lutsk", "Ivano-Frankivsk", "Bila Tserkva", "Kramators\u2019k", "Melitopol", "Kerch", "Nikopol", "Syevyerodonets\u2019k", "Sloviansk", "Berdyansk", "Uzhgorod", "Alchevs\u2019k", "Pavlohrad", "Lysychans\u2019k", "Yevpatoriya", "Yenakiyeve", "Oleksandriya", "Kamianets-Podilskyi"], "United Arab Emirates": ["Dubai", "Sharjah", "Abu Dhabi", "Ajman City", "Ras Al Khaimah City", "Musaffah"], "United Kingdom": ["London", "Birmingham", "Liverpool", "Nottingham", "Sheffield", "Bristol", "Glasgow", "Leicester", "Edinburgh", "Leeds", "Cardiff", "Manchester", "Stoke-on-Trent", "Coventry", "Sunderland", "Brent", "Birkenhead", "Islington", "Reading", "Kingston upon Hull", "Preston", "Newport", "Swansea", "Bradford", "Southend-on-Sea", "Belfast", "Derby", "Plymouth", "Luton", "Wolverhampton", "City of Westminster", "Southampton", "Blackpool", "Milton Keynes", "Bexley", "Northampton", "Archway", "Norwich", "Dudley", "Aberdeen", "Portsmouth", "Newcastle upon Tyne", "Sutton", "Swindon", "Crawley", "Ipswich", "Wigan", "Croydon", "Walsall", "Mansfield", "Oxford", "Warrington", "Slough", "Bournemouth", "Peterborough", "Cambridge", "Doncaster", "York", "Poole", "Gloucester", "Burnley", "Huddersfield", "Telford", "Dundee", "Blackburn", "Basildon", "Middlesbrough", "Bolton", "Stockport", "Brighton", "West Bromwich", "Grimsby", "Hastings", "High Wycombe", "Watford", "Saint Peters", "Burton upon Trent", "Colchester", "Eastbourne", "Exeter", "Rotherham", "Cheltenham", "Lincoln", "Chesterfield", "Chelmsford", "Mendip", "Dagenham", "Basingstoke", "Maidstone", "Sutton Coldfield", "Bedford", "Oldham", "Enfield Town", "Woking", "St Helens", "Worcester", "Gillingham", "Becontree"], "United States": ["New York City", "Los Angeles", "Chicago", "Brooklyn", "Houston", "Queens", "Philadelphia", "Phoenix", "Manhattan", "San Antonio", "San Diego", "The Bronx", "Dallas", "San Jose", "Austin", "Jacksonville", "San Francisco", "Columbus", "Fort Worth", "Indianapolis", "Charlotte", "Seattle", "Denver", "El Paso", "Detroit", "Boston", "Memphis", "New South Memphis", "Portland", "Oklahoma City", "Las Vegas", "Baltimore", "Washington, D.C.", "Milwaukee", "South Boston", "Albuquerque", "Tucson", "Nashville", "Fresno", "Sacramento", "Kansas City", "Long Beach", "Mesa", "Staten Island", "Atlanta", "Colorado Springs", "Virginia Beach", "Raleigh", "Omaha", "Miami", "Oakland", "Minneapolis", "Tulsa", "Wichita", "New Orleans", "Arlington", "Cleveland", "Bakersfield", "Honolulu", "Tampa", "Aurora", "Anaheim", "West Raleigh", "Santa Ana", "Corpus Christi", "Riverside", "St. Louis", "Lexington-Fayette", "Stockton", "Pittsburgh", "Anchorage", "Cincinnati", "Ironville", "Meads", "Henderson", "Greensboro", "Saint Paul", "Plano", "Newark", "Toledo", "Lincoln", "Orlando", "Chula Vista", "Jersey City", "Chandler", "Fort Wayne", "Buffalo", "Durham", "St. Petersburg", "Irvine", "Laredo", "Lubbock", "Madison", "Gilbert", "Norfolk", "Louisville", "Reno", "Winston-Salem", "Glendale", "Hialeah", "Garland", "Scottsdale", "Irving", "Chesapeake", "North Las Vegas", "Fremont", "Baton Rouge", "Lexington", "Paradise", "Richmond", "Jamaica", "San Bernardino", "Spokane", "Birmingham", "Modesto", "Des Moines", "Rochester", "Maryvale", "Tacoma", "Fontana", "Oxnard", "Moreno Valley", "Fayetteville", "Huntington Beach", "Yonkers", "Montgomery", "Amarillo", "Little Rock", "Akron", "Shreveport", "Grand Rapids", "Mobile", "Salt Lake City", "Huntsville", "Tallahassee", "Sunrise Manor", "Grand Prairie", "Overland Park", "Knoxville", "Worcester", "Brownsville", "Newport News", "Santa Clarita", "Providence", "Fort Lauderdale", "East Flatbush", "Spring Valley", "Chattanooga", "Tempe", "Oceanside", "Garden Grove", "Rancho Cucamonga", "Cape Coral", "Santa Rosa", "East New York", "Vancouver", "Sioux Falls", "Peoria", "Ontario", "Jackson", "Hollywood", "Elk Grove", "Springfield", "Pembroke Pines", "Deer Valley", "Port Saint Lucie", "Salem", "Corona", "Eugene", "McKinney", "Fort Collins", "Lancaster", "Cary", "Tempe Junction", "Palmdale", "Hayward", "Salinas", "Frisco", "East Chattanooga", "Pasadena", "Alexandria", "Pomona", "Washington Heights", "Lakewood", "Sunnyvale", "Escondido", "Astoria", "Borough Park", "Clarksville", "Torrance", "Valencia", "Rockford", "East Hampton", "Joliet", "Paterson", "Bridgeport", "Naperville", "Boise", "Savannah", "Mesquite", "Syracuse", "Metairie Terrace", "Orange", "Fullerton", "Killeen", "Dayton", "McAllen", "Bellevue", "Metairie", "Miramar", "Hampton", "Van Nuys", "West Valley City", "Olathe", "Warren", "Columbia", "Thornton", "Carrollton", "Midland", "Charleston", "Waco", "Sterling Heights", "Denton", "Cedar Rapids", "New Haven", "Roseville", "Gainesville", "Visalia", "Coral Springs", "Thousand Oaks", "Elizabeth", "Stamford", "Concord", "Surprise", "Alhambra", "Lafayette", "Topeka", "Kent", "Simi Valley", "East Los Angeles", "Santa Clara", "Murfreesboro", "Sunset Park", "Koreatown", "Hartford", "Sheepshead Bay", "Amherst", "Victorville", "Abilene", "Vallejo", "North Stamford", "Berkeley", "Norman", "Allentown", "Evansville", "Odessa", "Fargo", "Beaumont", "Independence", "Ann Arbor", "El Monte", "Athens", "Harlem", "Round Rock", "Wilmington", "East Harlem", "Arvada", "Provo", "Lansing", "Downey", "Carlsbad", "Elmhurst", "Costa Mesa", "Miami Gardens", "Westminster", "North Peoria", "Clearwater", "Fairfield", "Bushwick", "Gravesend", "Elgin", "Temecula", "West Jordan", "Inglewood", "Richardson", "Lowell", "East Independence", "Gresham", "Antioch", "Cambridge", "High Point", "Billings", "Manchester", "Murrieta", "Centennial", "Pueblo", "Pearland", "Waterbury", "West Covina", "Enterprise", "North Charleston", "Everett", "College Station", "Palm Bay", "Pompano Beach", "Boulder", "Norwalk", "West Palm Beach", "Broken Arrow", "Daly City", "Sandy Springs", "Burbank", "Green Bay", "Santa Maria", "Universal City", "Wichita Falls", "Lakeland", "Clovis", "Lewisville", "Tyler", "El Cajon", "San Mateo", "Brandon", "Rialto", "Davenport", "Edison", "Hillsboro", "Las Cruces", "South Bend", "Vista", "Greeley", "Davie", "Chinatown", "San Angelo", "Renton"], "Uruguay": ["Montevideo"], "Uzbekistan": ["Tashkent", "Namangan", "Samarkand", "Andijon", "Bukhara", "Nukus", "Qarshi", "Qo\u2018qon", "Chirchiq", "Fergana", "Jizzax", "Urganch", "Tirmiz", "Marg\u2018ilon", "Navoiy", "Angren", "Olmaliq"], "Venezuela": ["Caracas", "Maracaibo", "Maracay", "Valencia", "Barquisimeto", "Ciudad Guayana", "Barcelona", "Matur\xEDn", "Puerto La Cruz", "Petare", "Barinas", "Turmero", "Ciudad Bol\xEDvar", "M\xE9rida", "Alto Barinas", "Santa Teresa del Tuy", "Cuman\xE1", "San Crist\xF3bal", "Baruta", "Mucumpiz", "Cabimas", "Coro", "Guatire", "C\xFAa", "Guarenas", "Puerto Cabello", "Ocumare del Tuy", "Guacara", "El Tigre", "El Lim\xF3n", "Acarigua", "Los Teques", "Punto Fijo", "Charallave", "Palo Negro", "Cagua", "Anaco", "Calabozo", "Guanare", "Car\xFApano", "Ejido", "Catia La Mar", "Mariara"], "Vietnam": ["Ho Chi Minh City", "Hanoi", "Da Nang", "Haiphong", "Bi\xEAn H\xF2a", "Hu\u1EBF", "Nha Trang", "C\u1EA7n Th\u01A1", "R\u1EA1ch Gi\xE1", "Th\u1ECB X\xE3 Ph\xFA M\u1EF9", "Qui Nhon", "V\u0169ng T\xE0u", "Sa Dec", "\xD0\xE0 L\u1EA1t", "Nam \u0110\u1ECBnh", "Vinh", "\u0110\u01B0c Tr\u1ECDng", "La Gi", "Phan Thi\u1EBFt", "Long Xuy\xEAn", "C\u1EA7n Giu\u1ED9c", "B\u1EA3o L\u1ED9c", "H\u1EA1 Long", "Bu\xF4n Ma Thu\u1ED9t", "Cam Ranh", "C\u1EA9m Ph\u1EA3 Mines", "Th\xE1i Nguy\xEAn", "M\u1EF9 Tho", "S\xF3c Tr\u0103ng", "Pleiku", "Thanh H\xF3a", "C\xE0 Mau", "B\u1EA1c Li\xEAu", "Y\xEAn Vinh", "H\xF2a B\xECnh", "V\u0129nh Long"], "Western Sahara": ["Laayoune"], "Yemen": ["Sanaa", "Al \u1E28udaydah", "Ta\u2018izz", "Aden", "Mukalla", "Ibb", "Dham\u0101r"], "Zambia": ["Lusaka", "Kitwe", "Ndola", "Kabwe", "Chingola", "Mufulira", "Luanshya", "Livingstone"], "Zimbabwe": ["Harare", "Bulawayo", "Chitungwiza", "Mutare", "Gweru", "Epworth"] };

// src/ui/components/suggest.ts
function rank(items, query, limit = 50) {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, limit);
  const prefix = [];
  const wordStart = [];
  const contains = [];
  for (const item of items) {
    const lower = item.toLowerCase();
    const at = lower.indexOf(q);
    if (at === -1) continue;
    if (at === 0) prefix.push(item);
    else if (lower[at - 1] === " " || lower[at - 1] === "-") wordStart.push(item);
    else contains.push(item);
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...wordStart, ...contains].slice(0, limit);
}
var CountrySuggest = class extends import_obsidian4.AbstractInputSuggest {
  constructor(app, input, onPick) {
    super(app, input);
    this.onPick = onPick;
  }
  getSuggestions(query) {
    return rank(COUNTRIES, query);
  }
  renderSuggestion(value, el) {
    el.setText(value);
    const count = CITIES[value]?.length ?? 0;
    if (count) {
      el.createSpan({ cls: "tp-suggest-hint", text: `${count} cities` });
    }
  }
  selectSuggestion(value) {
    this.setValue(value);
    this.onPick(value);
    this.close();
  }
};
var CitySuggest = class extends import_obsidian4.AbstractInputSuggest {
  constructor(app, input, getCountry, onPick) {
    super(app, input);
    this.getCountry = getCountry;
    this.onPick = onPick;
  }
  getSuggestions(query) {
    const country = this.getCountry();
    const pool = country ? CITIES[country] ?? [] : Object.values(CITIES).flat();
    return rank(pool, query, country ? 50 : 30);
  }
  renderSuggestion(value, el) {
    el.setText(value);
    if (!this.getCountry()) {
      const owner = Object.keys(CITIES).find((c) => CITIES[c].includes(value));
      if (owner) el.createSpan({ cls: "tp-suggest-hint", text: owner });
    }
  }
  selectSuggestion(value) {
    this.setValue(value);
    this.onPick(value);
    this.close();
  }
};
function countryForCity(city) {
  const needle = city.trim().toLowerCase();
  if (!needle) return null;
  for (const [country, cities] of Object.entries(CITIES)) {
    if (cities.some((c) => c.toLowerCase() === needle)) return country;
  }
  return null;
}

// src/ui/modals/tripModal.ts
var TripModal = class _TripModal extends import_obsidian5.Modal {
  constructor(app, settings, mode, initial, onSubmit) {
    super(app);
    this.settings = settings;
    this.mode = mode;
    this.onSubmit = onSubmit;
    this.kindButtons = /* @__PURE__ */ new Map();
    const kind = initial.kind ?? settings.defaultKind;
    const start = isValidISODate(initial.startDate ?? "") ? initial.startDate : todayISO();
    this.draft = {
      title: initial.title ?? "",
      kind,
      country: initial.country ?? (mode === "create" ? settings.defaultCountry : ""),
      city: initial.city ?? "",
      venue: initial.venue ?? "",
      startDate: start,
      endDate: initial.endDate ?? start,
      notes: initial.notes ?? "",
      subNotes: initial.subNotes ?? [...settings.subNotesByKind[kind] ?? kindDef(kind).subNotes]
    };
    this.titleIsAuto = !this.draft.title;
  }
  static forEdit(app, settings, trip, onSubmit) {
    return new _TripModal(
      app,
      settings,
      "edit",
      {
        title: trip.title,
        kind: trip.kind,
        country: trip.country,
        city: trip.city,
        venue: trip.venue,
        startDate: trip.startDate,
        endDate: trip.endDate,
        subNotes: []
      },
      onSubmit
    );
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-modal");
    this.modalEl.addClass("tp-modal-shell");
    contentEl.createEl("h2", {
      text: this.mode === "create" ? "New trip" : "Edit trip",
      cls: "tp-modal-title"
    });
    this.renderKindPicker(contentEl);
    this.renderPlaceFields(contentEl);
    const dateSection = contentEl.createDiv({ cls: "tp-section" });
    dateSection.createDiv({ cls: "tp-section-label", text: "Dates" });
    this.dates = new DateRangeField(
      dateSection,
      { startDate: this.draft.startDate, endDate: this.draft.endDate },
      (value) => {
        this.draft.startDate = value.startDate;
        this.draft.endDate = value.endDate;
      }
    );
    this.dates.setSingleDay(kindDef(this.draft.kind).singleDay);
    if (this.mode === "create") {
      this.renderSubNotePicker(contentEl);
      new import_obsidian5.Setting(contentEl).setName("Notes").addTextArea((ta) => {
        ta.setPlaceholder("Anything you already know about this trip\u2026");
        ta.inputEl.rows = 3;
        ta.onChange((v) => this.draft.notes = v);
      });
    }
    new import_obsidian5.Setting(contentEl).addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close())).addButton(
      (btn) => btn.setButtonText(this.mode === "create" ? "Create trip" : "Save changes").setCta().onClick(() => void this.submit())
    );
    contentEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && !evt.shiftKey && evt.target instanceof HTMLInputElement) {
        evt.preventDefault();
        void this.submit();
      }
    });
    window.setTimeout(() => this.titleInput?.focus(), 0);
  }
  renderKindPicker(parent) {
    const section = parent.createDiv({ cls: "tp-section" });
    section.createDiv({ cls: "tp-section-label", text: "What kind of trip?" });
    const row = section.createDiv({ cls: "tp-kind-row" });
    for (const def of KINDS) {
      const btn = row.createEl("button", { cls: "tp-kind" });
      btn.type = "button";
      (0, import_obsidian5.setIcon)(btn.createSpan({ cls: "tp-kind-icon" }), def.icon);
      btn.createSpan({ cls: "tp-kind-label", text: def.label });
      btn.addEventListener("click", () => this.setKind(def.id));
      this.kindButtons.set(def.id, btn);
    }
    this.syncKindButtons();
  }
  syncKindButtons() {
    for (const [id, btn] of this.kindButtons) {
      btn.toggleClass("is-active", id === this.draft.kind);
    }
  }
  setKind(kind) {
    if (this.draft.kind === kind) return;
    const previous = kindDef(this.draft.kind);
    const next = kindDef(kind);
    this.draft.kind = kind;
    this.syncKindButtons();
    this.venueSetting.settingEl.toggleClass("is-hidden", !next.hasVenue);
    this.dates.setSingleDay(next.singleDay);
    if (!next.singleDay && previous.defaultDurationDays !== next.defaultDurationDays) {
      this.dates.suggestDuration(next.defaultDurationDays);
    }
    if (this.mode === "create") {
      this.draft.subNotes = [...this.settings.subNotesByKind[kind] ?? next.subNotes];
      this.renderSubNoteCheckboxes();
    }
  }
  renderPlaceFields(parent) {
    new import_obsidian5.Setting(parent).setName("Title").setDesc("Shown in the sidebar and used as the note name.").addText(
      (t) => {
        this.titleInput = t.inputEl;
        t.setPlaceholder("e.g. Japan 2026, or Radiohead at Ziggo Dome");
        t.setValue(this.draft.title);
        t.onChange((v) => {
          this.draft.title = v;
          this.titleIsAuto = v.trim().length === 0;
        });
      }
    );
    new import_obsidian5.Setting(parent).setName("Country").addText((t) => {
      this.countryInput = t.inputEl;
      t.setPlaceholder("Start typing\u2026");
      t.setValue(this.draft.country);
      t.onChange((v) => this.draft.country = v.trim());
      new CountrySuggest(this.app, t.inputEl, (value) => {
        this.draft.country = value;
      });
    });
    new import_obsidian5.Setting(parent).setName("City").setDesc("Drives the Food Spot embed, so it should match how Food Spot spells it.").addText((t) => {
      t.setPlaceholder("Start typing\u2026");
      t.setValue(this.draft.city);
      t.onChange((v) => this.setCity(v.trim(), false));
      new CitySuggest(
        this.app,
        t.inputEl,
        () => this.draft.country,
        (value) => this.setCity(value, true)
      );
    });
    this.venueSetting = new import_obsidian5.Setting(parent).setName("Venue").addText((t) => {
      t.setPlaceholder("e.g. Ziggo Dome");
      t.setValue(this.draft.venue);
      t.onChange((v) => this.draft.venue = v.trim());
    });
    this.venueSetting.settingEl.toggleClass("is-hidden", !kindDef(this.draft.kind).hasVenue);
  }
  setCity(city, fromSuggestion) {
    this.draft.city = city;
    if (fromSuggestion && !this.draft.country) {
      const owner = countryForCity(city);
      if (owner) {
        this.draft.country = owner;
        this.countryInput.value = owner;
      }
    }
    if (this.titleIsAuto && city) {
      this.draft.title = city;
      this.titleInput.value = city;
    }
  }
  renderSubNotePicker(parent) {
    const section = parent.createDiv({ cls: "tp-section" });
    section.createDiv({ cls: "tp-section-label", text: "Create these notes" });
    this.subNoteSection = section.createDiv({ cls: "tp-subnote-row" });
    this.renderSubNoteCheckboxes();
  }
  renderSubNoteCheckboxes() {
    if (!this.subNoteSection) return;
    this.subNoteSection.empty();
    const ids = Object.keys(SUB_NOTE_LABELS);
    for (const id of ids) {
      const label = this.subNoteSection.createEl("label", { cls: "tp-subnote" });
      const box = label.createEl("input");
      box.type = "checkbox";
      box.checked = this.draft.subNotes.includes(id);
      label.createSpan({ text: SUB_NOTE_LABELS[id] });
      box.addEventListener("change", () => {
        if (box.checked) {
          if (!this.draft.subNotes.includes(id)) this.draft.subNotes.push(id);
        } else {
          this.draft.subNotes = this.draft.subNotes.filter((s) => s !== id);
        }
      });
    }
  }
  async submit() {
    const value = this.dates.getValue();
    this.draft.startDate = value.startDate;
    this.draft.endDate = value.endDate;
    if (!this.draft.title.trim()) {
      if (this.draft.city) this.draft.title = this.draft.city;
      else {
        new import_obsidian5.Notice("Give the trip a title.");
        this.titleInput.focus();
        return;
      }
    }
    if (!isValidISODate(this.draft.startDate)) {
      new import_obsidian5.Notice("Pick a start date.");
      return;
    }
    try {
      await this.onSubmit({ ...this.draft });
      this.close();
    } catch (err) {
      new import_obsidian5.Notice(err instanceof Error ? err.message : "Could not save the trip.");
      console.error("[travel-planner]", err);
    }
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/ui/modals/confirmDelete.ts
var import_obsidian6 = require("obsidian");
var ConfirmDeleteModal = class extends import_obsidian6.Modal {
  constructor(app, trip, onConfirm) {
    super(app);
    this.trip = trip;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-modal");
    contentEl.createEl("h2", { text: "Delete this trip?", cls: "tp-modal-title" });
    const summary = contentEl.createDiv({ cls: "tp-delete-summary" });
    summary.createDiv({ cls: "tp-delete-name", text: this.trip.title });
    summary.createDiv({
      cls: "tp-delete-meta",
      text: formatDateRange(this.trip.startDate, this.trip.endDate)
    });
    const targets = tripDeletionTargets(this.app, this.trip);
    const files = describeDeletion(this.app, targets);
    const wholeFolder = targets.length === 1 && targets[0].path === this.trip.folderPath;
    contentEl.createEl("p", {
      cls: "tp-delete-scope",
      text: wholeFolder ? `The whole folder "${this.trip.folderPath}" will be removed \u2014 ${files.length} file${files.length === 1 ? "" : "s"}:` : `Another trip shares this folder, so only the trip note will be removed:`
    });
    const list = contentEl.createEl("ul", { cls: "tp-delete-list" });
    for (const path of files.slice(0, 25)) list.createEl("li", { text: path });
    if (files.length > 25) {
      list.createEl("li", { cls: "tp-delete-more", text: `\u2026and ${files.length - 25} more` });
    }
    contentEl.createEl("p", {
      cls: "tp-delete-note",
      text: "Files follow your vault's \u201CDeleted files\u201D setting \u2014 normally the trash, where you can still get them back."
    });
    new import_obsidian6.Setting(contentEl).addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close())).addButton(
      (btn) => btn.setButtonText("Delete trip").setWarning().onClick(async () => {
        btn.setDisabled(true);
        await this.onConfirm();
        this.close();
      })
    );
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/ui/modals/addDayModal.ts
var import_obsidian7 = require("obsidian");
var AddDayModal = class extends import_obsidian7.Modal {
  constructor(app, store, onDone) {
    super(app);
    this.store = store;
    this.onDone = onDone;
    this.morning = "";
    this.afternoon = "";
    this.evening = "";
    this.trip = this.inferTrip();
    this.date = this.defaultDate();
  }
  inferTrip() {
    const active = this.app.workspace.getActiveFile();
    if (active) {
      const fromActive = this.store.getTripForFile(active);
      if (fromActive) return fromActive;
    }
    const trips = this.store.getTrips();
    return trips.find((t) => t.status === "current") ?? trips.find((t) => t.status === "upcoming") ?? null;
  }
  defaultDate() {
    const today = todayISO();
    if (!this.trip) return today;
    if (today >= this.trip.startDate && today <= this.trip.endDate) return today;
    return isValidISODate(this.trip.startDate) ? this.trip.startDate : today;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-modal");
    contentEl.createEl("h2", { text: "Add itinerary day", cls: "tp-modal-title" });
    const trips = this.store.getTrips();
    if (trips.length === 0) {
      contentEl.createEl("p", { text: "No trips yet. Create one first." });
      new import_obsidian7.Setting(contentEl).addButton((b) => b.setButtonText("Close").onClick(() => this.close()));
      return;
    }
    new import_obsidian7.Setting(contentEl).setName("Trip").addDropdown((dd) => {
      for (const trip of trips) {
        dd.addOption(trip.file.path, `${trip.title} (${trip.startDate})`);
      }
      dd.setValue(this.trip?.file.path ?? trips[0].file.path);
      if (!this.trip) this.trip = trips[0];
      dd.onChange((path) => {
        this.trip = trips.find((t) => t.file.path === path) ?? null;
        this.date = this.defaultDate();
        this.dateInput.value = this.date;
        this.applyDateBounds();
      });
    });
    const dateSetting = new import_obsidian7.Setting(contentEl).setName("Date");
    this.dateInput = dateSetting.controlEl.createEl("input", { cls: "tp-date-input" });
    this.dateInput.type = "date";
    this.dateInput.value = this.date;
    this.dateInput.addEventListener("change", () => {
      if (isValidISODate(this.dateInput.value)) this.date = this.dateInput.value;
    });
    this.applyDateBounds();
    const field = (name, onChange) => new import_obsidian7.Setting(contentEl).setName(name).addTextArea((ta) => {
      ta.inputEl.rows = 3;
      ta.setPlaceholder(`${name} plans\u2026`);
      ta.onChange(onChange);
    });
    field("Morning", (v) => this.morning = v);
    field("Afternoon", (v) => this.afternoon = v);
    field("Evening", (v) => this.evening = v);
    new import_obsidian7.Setting(contentEl).addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close())).addButton((btn) => btn.setButtonText("Add day").setCta().onClick(() => void this.addDay()));
  }
  /** Constrain the picker to the trip's own dates — a nudge, not a hard block. */
  applyDateBounds() {
    if (!this.trip) return;
    if (isValidISODate(this.trip.startDate)) this.dateInput.min = this.trip.startDate;
    if (isValidISODate(this.trip.endDate)) this.dateInput.max = this.trip.endDate;
  }
  async addDay() {
    if (!this.trip) {
      new import_obsidian7.Notice("Pick a trip first.");
      return;
    }
    if (!isValidISODate(this.date)) {
      new import_obsidian7.Notice("Pick a valid date.");
      return;
    }
    const path = `${this.trip.folderPath}/${SUB_NOTE_LABELS.itinerary}.md`;
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian7.TFile)) {
      file = await this.app.vault.create(
        path,
        `---
type: itinerary
---

# Itinerary \u2014 ${this.trip.title}
`
      );
    }
    const result = await insertItineraryDay(this.app, file, this.date, {
      morning: this.morning,
      afternoon: this.afternoon,
      evening: this.evening
    });
    if (result === "duplicate") {
      new import_obsidian7.Notice(`${this.date} is already in this itinerary.`);
      return;
    }
    new import_obsidian7.Notice(`Added ${this.date} to ${this.trip.title}.`);
    await this.app.workspace.getLeaf(false).openFile(file);
    this.onDone();
    this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/settings/settingsTab.ts
var import_obsidian8 = require("obsidian");
var TravelPlannerSettingTab = class extends import_obsidian8.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("tp-settings");
    new import_obsidian8.Setting(containerEl).setName("Trips").setHeading();
    new import_obsidian8.Setting(containerEl).setName("Trips folder").setDesc("Root folder holding every trip.").addText(
      (t) => t.setPlaceholder("Trips").setValue(this.plugin.settings.tripsFolder).onChange(async (v) => {
        this.plugin.settings.tripsFolder = v.trim() || "Trips";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("Folder pattern").setDesc(
      "Folder created per trip, relative to the trips folder. Placeholders: {year} {month} {start} {end} {title} {city} {country} {kind}. Use / for subfolders."
    ).addText(
      (t) => t.setPlaceholder("{year}/{start} {title}").setValue(this.plugin.settings.folderPattern).onChange(async (v) => {
        this.plugin.settings.folderPattern = v.trim() || "{year}/{start} {title}";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("Default country").setDesc("Pre-filled when you create a trip.").addText((t) => {
      t.setValue(this.plugin.settings.defaultCountry).onChange(async (v) => {
        this.plugin.settings.defaultCountry = v.trim();
        await this.plugin.saveSettings();
      });
      new CountrySuggest(this.app, t.inputEl, async (value) => {
        this.plugin.settings.defaultCountry = value;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian8.Setting(containerEl).setName("Default kind").addDropdown((dd) => {
      for (const def of KINDS) dd.addOption(def.id, def.label);
      dd.setValue(this.plugin.settings.defaultKind).onChange(async (v) => {
        this.plugin.settings.defaultKind = v;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian8.Setting(containerEl).setName("Sidebar").setHeading();
    new import_obsidian8.Setting(containerEl).setName("Show past trips").setDesc("Turn off to keep the sidebar to what's still ahead of you.").addToggle(
      (t) => t.setValue(this.plugin.settings.showPastTrips).onChange(async (v) => {
        this.plugin.settings.showPastTrips = v;
        await this.plugin.saveSettings();
        this.plugin.refreshViews();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("Confirm before deleting").setDesc("Show the confirmation dialogue listing exactly which files go.").addToggle(
      (t) => t.setValue(this.plugin.settings.confirmDelete).onChange(async (v) => {
        this.plugin.settings.confirmDelete = v;
        await this.plugin.saveSettings();
      })
    );
    this.displayFoodSpot(containerEl);
    this.displayTemplates(containerEl);
  }
  displayFoodSpot(containerEl) {
    new import_obsidian8.Setting(containerEl).setName("Food Spot").setHeading();
    const installed = this.plugin.isFoodSpotAvailable();
    new import_obsidian8.Setting(containerEl).setName("Add a Food Spot block").setDesc(
      installed ? "Each trip's Food note gets a foodspot block filtered to the trip's city." : `The Food Spot plugin ("${FOODSPOT_PLUGIN_ID}") isn't enabled, so the block is written as plain text for later.`
    ).addToggle(
      (t) => t.setValue(this.plugin.settings.foodSpotEnabled).onChange(async (v) => {
        this.plugin.settings.foodSpotEnabled = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("Food Spot view").setDesc("Which layout the generated block asks for.").addDropdown((dd) => {
      dd.addOption("cards", "Cards");
      dd.addOption("list", "List");
      dd.addOption("table", "Table");
      dd.addOption("shortlist", "Shortlist");
      dd.setValue(this.plugin.settings.foodSpotView).onChange(async (v) => {
        this.plugin.settings.foodSpotView = v;
        await this.plugin.saveSettings();
      });
    });
  }
  displayTemplates(containerEl) {
    new import_obsidian8.Setting(containerEl).setName("Notes per trip kind").setDesc("Which sub-notes get created. These are the defaults; you can still tick and untick per trip.").setHeading();
    const ids = Object.keys(SUB_NOTE_LABELS);
    for (const def of KINDS) {
      const setting = new import_obsidian8.Setting(containerEl).setName(def.label);
      const row = setting.controlEl.createDiv({ cls: "tp-settings-subnotes" });
      for (const id of ids) {
        const label = row.createEl("label", { cls: "tp-subnote" });
        const box = label.createEl("input");
        box.type = "checkbox";
        box.checked = (this.plugin.settings.subNotesByKind[def.id] ?? []).includes(id);
        label.createSpan({ text: SUB_NOTE_LABELS[id] });
        box.addEventListener("change", async () => {
          const current = new Set(this.plugin.settings.subNotesByKind[def.id] ?? []);
          if (box.checked) current.add(id);
          else current.delete(id);
          this.plugin.settings.subNotesByKind[def.id] = ids.filter((i) => current.has(i));
          await this.plugin.saveSettings();
        });
      }
      setting.addExtraButton(
        (btn) => btn.setIcon("rotate-ccw").setTooltip("Reset to defaults").onClick(async () => {
          this.plugin.settings.subNotesByKind[def.id] = [...kindDef(def.id).subNotes];
          await this.plugin.saveSettings();
          this.display();
        })
      );
    }
  }
};

// src/main.ts
var TravelPlannerPlugin = class extends import_obsidian9.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
  }
  async onload() {
    await this.loadSettings();
    this.store = new TripStore(this.app, () => this.settings);
    this.store.register(this);
    this.registerView(TRAVEL_VIEW_TYPE, (leaf) => new TravelSidebarView(leaf, this));
    this.addRibbonIcon("plane", "Travel Planner", () => void this.activateSidebar());
    this.addSettingTab(new TravelPlannerSettingTab(this.app, this));
    this.addCommand({
      id: "open-sidebar",
      name: "Open trips sidebar",
      callback: () => void this.activateSidebar()
    });
    this.addCommand({
      id: "new-trip",
      name: "New trip",
      callback: () => this.openNewTripModal()
    });
    this.addCommand({
      id: "add-itinerary-day",
      name: "Add itinerary day",
      callback: () => this.openAddDayModal()
    });
    this.addCommand({
      id: "edit-current-trip",
      name: "Edit the trip for the current note",
      checkCallback: (checking) => {
        const trip = this.currentTrip();
        if (!trip) return false;
        if (!checking) this.openEditTripModal(trip);
        return true;
      }
    });
    this.addCommand({
      id: "delete-current-trip",
      name: "Delete the trip for the current note",
      checkCallback: (checking) => {
        const trip = this.currentTrip();
        if (!trip) return false;
        if (!checking) this.deleteTrip(trip);
        return true;
      }
    });
    for (const def of KINDS) {
      this.addCommand({
        id: `new-${def.id}`,
        name: `New ${def.label.toLowerCase()}`,
        callback: () => this.openNewTripModal(def.id)
      });
    }
  }
  onunload() {
  }
  // ---------------------------------------------------------------- settings
  async loadSettings() {
    const saved = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...saved ?? {} };
    this.settings.subNotesByKind = {
      ...DEFAULT_SETTINGS.subNotesByKind,
      ...saved?.subNotesByKind ?? {}
    };
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.store.invalidate();
  }
  // -------------------------------------------------------------------- view
  async activateSidebar() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(TRAVEL_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: TRAVEL_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }
  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(TRAVEL_VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof TravelSidebarView) view.render();
    }
  }
  // ------------------------------------------------------------------ trips
  /** The trip governing the note you're looking at, if any. */
  currentTrip() {
    const file = this.app.workspace.getActiveFile();
    return file ? this.store.getTripForFile(file) : null;
  }
  isFoodSpotAvailable() {
    const plugins = this.app.plugins;
    return plugins?.enabledPlugins?.has(FOODSPOT_PLUGIN_ID) ?? false;
  }
  openNewTripModal(kind) {
    const initial = kind ? { kind, subNotes: [...this.settings.subNotesByKind[kind] ?? []] } : {};
    new TripModal(this.app, this.settings, "create", initial, async (draft) => {
      const result = await createTrip(this.app, this.settings, draft, this.isFoodSpotAvailable());
      new import_obsidian9.Notice(
        `Created \u201C${draft.title}\u201D with ${result.subNoteFiles.length} note${result.subNoteFiles.length === 1 ? "" : "s"}.`
      );
      this.store.invalidate();
      await this.app.workspace.getLeaf(false).openFile(result.tripFile);
    }).open();
  }
  openEditTripModal(trip) {
    TripModal.forEdit(this.app, this.settings, trip, async (draft) => {
      await updateTrip(this.app, this.settings, trip, draft);
      new import_obsidian9.Notice(`Updated \u201C${draft.title}\u201D.`);
      this.store.invalidate();
    }).open();
  }
  openAddDayModal(trip) {
    if (trip) {
      void this.app.workspace.getLeaf(false).openFile(trip.file);
    }
    new AddDayModal(this.app, this.store, () => this.store.invalidate()).open();
  }
  deleteTrip(trip) {
    const run = async () => {
      try {
        const count = await deleteTrip(this.app, trip);
        new import_obsidian9.Notice(`Deleted \u201C${trip.title}\u201D (${count} file${count === 1 ? "" : "s"}).`);
        this.store.invalidate();
      } catch (err) {
        notifyError(err, "Could not delete the trip.");
      }
    };
    if (!this.settings.confirmDelete) {
      void run();
      return;
    }
    new ConfirmDeleteModal(this.app, trip, run).open();
  }
  async openTrip(trip, newTab = false) {
    const file = this.app.vault.getAbstractFileByPath(trip.file.path);
    if (!(file instanceof import_obsidian9.TFile)) {
      new import_obsidian9.Notice("That trip note no longer exists.");
      this.store.invalidate();
      return;
    }
    await this.app.workspace.getLeaf(newTab).openFile(file);
  }
};
