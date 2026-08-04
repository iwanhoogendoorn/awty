import { App, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import { TRAVEL_MODES } from "../travel/types";
import type AwtyPlugin from "../main";
import type { SubNoteId, TripKind } from "../types";
import {
  CREATABLE_SUB_NOTES,
  FOODSPOT_PLUGIN_ID,
  KINDS,
  SUB_NOTE_LABELS,
  kindDef,
} from "../types";
import { AirportSuggest, CitySuggest, CountrySuggest } from "../ui/components/suggest";

type ChipTone = "ok" | "warn" | "pending";

interface GroupHandle {
  content: HTMLElement;
  setChip(text: string, tone: ChipTone): void;
}

/** Column headings; the full names are too wide for a matrix. */
const SHORT_LABELS: Partial<Record<SubNoteId, string>> = {
  packing: "Packing",
  accommodation: "Stay",
  "event-details": "Event",
};

const NAV_SECTIONS: { id: string; label: string; icon: string }[] = [
  { id: "trips", label: "Trips", icon: "plane" },
  { id: "you", label: "You", icon: "user" },
  { id: "notes", label: "Notes", icon: "file-text" },
  { id: "documents", label: "Documents", icon: "shield-check" },
  { id: "distances", label: "Distances", icon: "route" },
  { id: "food", label: "Food Spot", icon: "utensils" },
  { id: "about", label: "About", icon: "info" },
];

/**
 * Settings, laid out as a left nav over grouped panels.
 *
 * A flat list of thirty rows made it impossible to tell what belonged with
 * what, and the things needing setup — keys, passports — read the same as the
 * things that never change. Each panel carries a status chip so its state is
 * legible without opening it.
 */
export class AwtySettingTab extends PluginSettingTab {
  private active = "trips";
  private navEl!: HTMLElement;
  private bodyEl!: HTMLElement;

  constructor(
    app: App,
    private plugin: AwtyPlugin,
  ) {
    super(app, plugin);
  }

  private async save(): Promise<void> {
    await this.plugin.saveSettings();
  }

  /** A titled panel with an icon, a subtitle and an optional status chip. */
  private group(
    parent: HTMLElement,
    o: { icon: string; title: string; subtitle: string; chip?: { text: string; tone: ChipTone } },
  ): GroupHandle {
    const box = parent.createDiv({ cls: "awty-sgroup" });
    const head = box.createDiv({ cls: "awty-sgroup-head" });
    setIcon(head.createDiv({ cls: "awty-sgroup-icon" }), o.icon);

    const titles = head.createDiv({ cls: "awty-sgroup-titles" });
    titles.createDiv({ cls: "awty-sgroup-title", text: o.title });
    titles.createDiv({ cls: "awty-sgroup-sub", text: o.subtitle });

    const chip = head.createSpan({ cls: "awty-chip" });
    chip.hide();
    const setChip = (text: string, tone: ChipTone): void => {
      chip.show();
      chip.setText(text);
      chip.removeClass("awty-chip-ok", "awty-chip-warn", "awty-chip-pending");
      chip.addClass(`awty-chip-${tone}`);
    };
    if (o.chip) setChip(o.chip.text, o.chip.tone);

    return { content: box.createDiv({ cls: "awty-sgroup-body" }), setChip };
  }

  /** A `?` on a row that reveals the longer explanation only when asked. */
  private help(setting: Setting, text: string): void {
    let helpEl: HTMLElement | null = null;
    setting.addExtraButton((b) =>
      b
        .setIcon("help-circle")
        .setTooltip("What does this do?")
        .onClick(() => {
          if (helpEl) {
            helpEl.remove();
            helpEl = null;
            return;
          }
          helpEl = createDiv({ cls: "awty-setting-help", text });
          setting.settingEl.insertAdjacentElement("afterend", helpEl);
        }),
    );
  }

  private note(parent: HTMLElement, text: string): void {
    parent.createDiv({ cls: "awty-setting-note", text });
  }

  // ------------------------------------------------------------------ shell

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("awty-settings");

    this.navEl = containerEl.createDiv({ cls: "awty-settings-nav" });
    this.bodyEl = containerEl.createDiv({ cls: "awty-settings-body" });

    for (const section of NAV_SECTIONS) {
      const btn = this.navEl.createEl("button", { cls: "awty-settings-nav-item" });
      setIcon(btn.createSpan({ cls: "awty-settings-nav-icon" }), section.icon);
      btn.createSpan({ text: section.label });
      btn.toggleClass("is-active", section.id === this.active);
      btn.onclick = () => {
        this.active = section.id;
        this.navEl.findAll(".awty-settings-nav-item").forEach((el) => el.removeClass("is-active"));
        btn.addClass("is-active");
        this.renderBody();
      };
    }

    this.renderBody();
  }

  hide(): void {
    this.containerEl.removeClass("awty-settings");
    super.hide();
  }

  private renderBody(): void {
    const body = this.bodyEl;
    body.empty();
    switch (this.active) {
      case "you":
        this.renderYou(body);
        break;
      case "notes":
        this.renderNotes(body);
        break;
      case "documents":
        this.renderDocuments(body);
        break;
      case "distances":
        this.renderDistances(body);
        break;
      case "food":
        this.renderFoodSpot(body);
        break;
      case "about":
        this.renderAbout(body);
        break;
      default:
        this.renderTrips(body);
    }
  }

  // ------------------------------------------------------------------ trips

  private renderTrips(body: HTMLElement): void {
    const s = this.plugin.settings;

    const where = this.group(body, {
      icon: "folder",
      title: "Where trips live",
      subtitle: "The folder each trip is created in, and how it is named.",
      chip: { text: s.tripsFolder, tone: "ok" },
    });

    new Setting(where.content)
      .setName("Trips folder")
      .setDesc("Root folder holding every trip.")
      .addText((t) =>
        t
          .setPlaceholder("Trips")
          .setValue(s.tripsFolder)
          .onChange(async (v) => {
            s.tripsFolder = v.trim() || "Trips";
            await this.save();
            where.setChip(s.tripsFolder, "ok");
          }),
      );

    const pattern = new Setting(where.content)
      .setName("Folder pattern")
      .setDesc("Folder created per trip, relative to the trips folder.")
      .addText((t) =>
        t
          .setPlaceholder("{year}/{start} {title}")
          .setValue(s.folderPattern)
          .onChange(async (v) => {
            s.folderPattern = v.trim() || "{year}/{start} {title}";
            await this.save();
          }),
      );
    this.help(
      pattern,
      "Placeholders: {year} {month} {start} {end} {title} {city} {country} {kind}. A / makes a subfolder. Grouping by year with a date prefix keeps a second visit to the same city from colliding with the first.",
    );

    const defaults = this.group(body, {
      icon: "sliders-horizontal",
      title: "New trip defaults",
      subtitle: "What a new trip starts out as.",
      chip: { text: kindDef(s.defaultKind).label, tone: "ok" },
    });

    new Setting(defaults.content).setName("Default kind").addDropdown((dd) => {
      for (const def of KINDS) dd.addOption(def.id, def.label);
      dd.setValue(s.defaultKind).onChange(async (v) => {
        s.defaultKind = v as TripKind;
        await this.save();
        defaults.setChip(kindDef(s.defaultKind).label, "ok");
      });
    });

    new Setting(defaults.content)
      .setName("Default country")
      .setDesc("Pre-filled when you create a trip.")
      .addText((t) => {
        t.setValue(s.defaultCountry).onChange(async (v) => {
          s.defaultCountry = v.trim();
          await this.save();
        });
        new CountrySuggest(this.app, t.inputEl, async (value) => {
          s.defaultCountry = value;
          await this.save();
        });
      });

    new Setting(defaults.content)
      .setName("Currency")
      .setDesc("Used when a trip or booking does not name its own.")
      .addText((t) =>
        t
          .setPlaceholder("EUR")
          .setValue(s.defaultCurrency)
          .onChange(async (v) => {
            s.defaultCurrency = v.trim().toUpperCase() || "EUR";
            await this.save();
          }),
      );

    const view = this.group(body, {
      icon: "layout-dashboard",
      title: "Dashboard and sidebar",
      subtitle: "What is shown, and what is confirmed.",
    });

    new Setting(view.content)
      .setName("Show past trips")
      .setDesc("Turn off to keep the list to what is still ahead of you.")
      .addToggle((t) =>
        t.setValue(s.showPastTrips).onChange(async (v) => {
          s.showPastTrips = v;
          await this.save();
          this.plugin.refreshViews();
        }),
      );

    new Setting(view.content)
      .setName("Confirm before deleting")
      .setDesc("Show the dialogue listing exactly which files go.")
      .addToggle((t) =>
        t.setValue(s.confirmDelete).onChange(async (v) => {
          s.confirmDelete = v;
          await this.save();
        }),
      );
  }

  // -------------------------------------------------------------------- you

  private renderYou(body: HTMLElement): void {
    const s = this.plugin.settings;

    const home = this.group(body, {
      icon: "home",
      title: "Home",
      subtitle: "Where you normally travel from.",
      chip: s.homeAirport
        ? { text: s.homeAirport, tone: "ok" }
        : { text: "not set", tone: "pending" },
    });

    new Setting(home.content)
      .setName("Home city")
      .setDesc("Pre-fills the origin of a new trip.")
      .addText((t) => {
        t.setPlaceholder("Rotterdam");
        t.setValue(s.homeCity);
        t.onChange(async (v) => {
          s.homeCity = v.trim();
          await this.save();
        });
        new CitySuggest(
          this.app,
          t.inputEl,
          () => "",
          async (value) => {
            s.homeCity = value;
            await this.save();
          },
          () => s.defaultCountry,
        );
      });

    new Setting(home.content)
      .setName("Home airport")
      .setDesc("Pre-fills the first leg of a flight.")
      .addText((t) => {
        t.setPlaceholder("Amsterdam (AMS)");
        t.setValue(s.homeAirport);
        t.onChange(async (v) => {
          s.homeAirport = v.trim();
          await this.save();
        });
        new AirportSuggest(
          this.app,
          t.inputEl,
          (v) => s.starredAirports.includes(v),
          async (value) => {
            s.homeAirport = value;
            await this.save();
            home.setChip(value, "ok");
          },
          () => ({ country: s.defaultCountry, city: s.homeCity }),
        );
      });

    const people = this.group(body, {
      icon: "users",
      title: "Who travels",
      subtitle: "Seeds the travellers on a new trip, and sizes the packing list.",
      chip:
        s.household.length > 0
          ? { text: `${s.household.length} people`, tone: "ok" }
          : { text: "just you", tone: "pending" },
    });

    new Setting(people.content)
      .then((setting) => setting.settingEl.addClass("awty-setting-stack"))
      .setName("Household")
      .setDesc("Comma-separated. A new trip starts with these names.")
      .addText((t) =>
        t
          .setPlaceholder("Iwan, Gaurav")
          .setValue(s.household.join(", "))
          .onChange(async (v) => {
            s.household = v
              .split(",")
              .map((n) => n.trim())
              .filter(Boolean);
            await this.save();
          }),
      );

    const total = s.starredAirlines.length + s.starredAirports.length;
    const starred = this.group(body, {
      icon: "star",
      title: "Starred",
      subtitle: "Airlines and airports pinned to the top of their pickers.",
      chip: { text: `${total} pinned`, tone: total > 0 ? "ok" : "pending" },
    });

    if (total === 0) {
      this.note(
        starred.content,
        "Nothing starred yet. Use the star beside an airline or airport in the flight wizard; the ones you pick appear here.",
      );
    }

    for (const [label, list, key] of [
      ["Airlines", s.starredAirlines, "starredAirlines"],
      ["Airports", s.starredAirports, "starredAirports"],
    ] as const) {
      if (list.length === 0) continue;
      starred.content.createDiv({ cls: "awty-sgroup-label", text: label });
      const row = starred.content.createDiv({ cls: "awty-pill-row" });
      for (const value of list) {
        const pill = row.createSpan({ cls: "awty-pill" });
        pill.createSpan({ text: value });
        const remove = pill.createSpan({ cls: "awty-pill-x" });
        setIcon(remove, "x");
        remove.addEventListener("click", async () => {
          s[key] = list.filter((v) => v !== value);
          await this.save();
          this.renderBody();
        });
      }
    }
  }

  // ------------------------------------------------------------------ notes

  private renderNotes(body: HTMLElement): void {
    const s = this.plugin.settings;

    const folders = this.group(body, {
      icon: "folder-tree",
      title: "Inside a trip",
      subtitle: "Where bookings and attachments are filed.",
    });

    new Setting(folders.content).setName("Bookings folder").addText((t) =>
      t
        .setPlaceholder("Bookings")
        .setValue(s.bookingsFolder)
        .onChange(async (v) => {
          s.bookingsFolder = v.trim() || "Bookings";
          await this.save();
        }),
    );

    new Setting(folders.content).setName("Attachments folder").addText((t) =>
      t
        .setPlaceholder("Attachments")
        .setValue(s.attachmentsFolder)
        .onChange(async (v) => {
          s.attachmentsFolder = v.trim() || "Attachments";
          await this.save();
        }),
    );

    const templates = this.group(body, {
      icon: "list-checks",
      title: "Notes per kind of trip",
      subtitle: "Which notes a new trip creates. You can still tick and untick per trip.",
    });

    // A grid, not a row per kind: Obsidian's Setting puts the name in a narrow
    // column, which truncated "Holiday" to "Holi…" and wrapped the boxes.
    const grid = templates.content.createDiv({ cls: "awty-matrix" });
    grid.style.setProperty("--awty-matrix-cols", String(CREATABLE_SUB_NOTES.length));

    grid.createDiv({ cls: "awty-matrix-corner" });
    for (const id of CREATABLE_SUB_NOTES) {
      grid.createDiv({ cls: "awty-matrix-col", text: SHORT_LABELS[id] ?? SUB_NOTE_LABELS[id] });
    }
    grid.createDiv({ cls: "awty-matrix-corner" });

    for (const def of KINDS) {
      const name = grid.createDiv({ cls: "awty-matrix-row-head" });
      setIcon(name.createSpan({ cls: "awty-matrix-row-icon" }), def.icon);
      name.createSpan({ text: def.label });

      for (const id of CREATABLE_SUB_NOTES) {
        const cell = grid.createDiv({ cls: "awty-matrix-cell" });
        const box = cell.createEl("input");
        box.type = "checkbox";
        box.checked = (s.subNotesByKind[def.id] ?? []).includes(id);
        box.setAttribute("aria-label", `${SUB_NOTE_LABELS[id]} for ${def.label}`);
        box.addEventListener("change", async () => {
          const current = new Set(s.subNotesByKind[def.id] ?? []);
          if (box.checked) current.add(id);
          else current.delete(id);
          // Keep a stable order rather than insertion order.
          s.subNotesByKind[def.id] = CREATABLE_SUB_NOTES.filter((i) => current.has(i));
          await this.save();
        });
      }

      const reset = grid.createDiv({ cls: "awty-matrix-cell" });
      const btn = reset.createEl("button", {
        cls: "awty-matrix-reset",
        attr: { "aria-label": `Reset ${def.label}` },
      });
      setIcon(btn, "rotate-ccw");
      btn.addEventListener("click", async () => {
        s.subNotesByKind[def.id] = [...kindDef(def.id).subNotes] as SubNoteId[];
        await this.save();
        this.renderBody();
      });
    }
  }

  // -------------------------------------------------------------- documents

  private renderDocuments(body: HTMLElement): void {
    const s = this.plugin.settings;

    const passports = this.group(body, {
      icon: "book-user",
      title: "Passports",
      subtitle: "Checked against every destination for visa requirements.",
      chip:
        s.passportCountries.length > 0
          ? { text: s.passportCountries[0], tone: "ok" }
          : { text: "none set", tone: "warn" },
    });

    if (s.passportCountries.length === 0) {
      this.note(passports.content, "No passports set — no visa check will run.");
    }

    const list = passports.content.createDiv({ cls: "awty-pill-row" });
    for (const [index, passport] of s.passportCountries.entries()) {
      const pill = list.createSpan({ cls: "awty-pill" });
      setIcon(pill.createSpan({ cls: "awty-pill-icon" }), "book-user");
      pill.createSpan({ text: passport });
      if (index === 0) pill.createSpan({ cls: "awty-pill-tag", text: "default" });
      const remove = pill.createSpan({ cls: "awty-pill-x" });
      setIcon(remove, "x");
      remove.addEventListener("click", async () => {
        s.passportCountries = s.passportCountries.filter((p) => p !== passport);
        await this.save();
        this.renderBody();
      });
    }

    let pending = "";
    const add = async (): Promise<void> => {
      const name = pending.trim();
      if (!name) return;
      if (s.passportCountries.includes(name)) {
        new Notice(`${name} is already listed.`);
        return;
      }
      s.passportCountries = [...s.passportCountries, name];
      await this.save();
      this.renderBody();
    };

    new Setting(passports.content)
      .setName("Add a passport")
      .setDesc("The first one listed is the default for a new trip.")
      .addText((t) => {
        t.setPlaceholder("Netherlands");
        t.onChange((v) => (pending = v.trim()));
        new CountrySuggest(this.app, t.inputEl, (value) => {
          pending = value;
          void add();
        });
      })
      .addButton((b) => b.setButtonText("Add").onClick(() => void add()));

    const advice = this.group(body, {
      icon: "shield-check",
      title: "Travel advice",
      subtitle: "The colour code from the Dutch Ministry of Foreign Affairs.",
      chip: s.travelAdviceEnabled ? { text: "on", tone: "ok" } : { text: "off", tone: "pending" },
    });

    new Setting(advice.content)
      .setName("Check travel advice")
      .setDesc("Fetched for the destination, and refreshed when it is a day old.")
      .addToggle((t) =>
        t.setValue(s.travelAdviceEnabled).onChange(async (v) => {
          s.travelAdviceEnabled = v;
          await this.save();
          advice.setChip(v ? "on" : "off", v ? "ok" : "pending");
        }),
      );

    this.note(
      advice.content,
      "Visa data comes from the open passport-index dataset, advice from nederlandwereldwijd.nl. Both are guidance — entry rules change without notice, so confirm with the embassy before booking.",
    );
  }

  // -------------------------------------------------------------- distances

  private renderDistances(body: HTMLElement): void {
    const s = this.plugin.settings;
    const configured = this.plugin.travel.isConfigured();

    const setup = this.group(body, {
      icon: "route",
      title: "Travel times",
      subtitle: "From your accommodation to the airport, activities and restaurants.",
      chip: !s.travelTimesEnabled
        ? { text: "off", tone: "pending" }
        : configured
          ? { text: "ready", tone: "ok" }
          : { text: "needs a key", tone: "warn" },
    });

    new Setting(setup.content).setName("Enable travel times").addToggle((t) =>
      t.setValue(s.travelTimesEnabled).onChange(async (v) => {
        s.travelTimesEnabled = v;
        await this.save();
        this.renderBody();
      }),
    );

    this.note(
      setup.content,
      "Uses the Google Geocoding and Distance Matrix APIs, which bill your own Google Cloud account. Nothing is sent anywhere until you switch this on, and then only when you press Calculate. Results are cached, so each route is paid for once.",
    );

    if (!s.travelTimesEnabled) return;

    const key = this.group(body, {
      icon: "key-round",
      title: "Google API key",
      subtitle: "Needs Geocoding API and Distance Matrix API enabled on the project.",
      chip: s.googleApiKey.trim()
        ? { text: "key set", tone: "ok" }
        : { text: "no key", tone: "warn" },
    });

    const row = key.content.createDiv({ cls: "awty-keyrow" });

    const input = row.createEl("input", {
      cls: "awty-key-input",
      type: "password",
      attr: { placeholder: "AIza…", spellcheck: "false", autocomplete: "off" },
    });
    input.value = s.googleApiKey;

    // Debounced: a 39-character key would otherwise fire dozens of overlapping
    // read-modify-writes against data.json.
    let saveTimer: number | null = null;
    const paint = (): void =>
      key.setChip(s.googleApiKey.trim() ? "key set" : "no key", s.googleApiKey.trim() ? "ok" : "warn");

    input.addEventListener("input", () => {
      s.googleApiKey = input.value.trim();
      paint();
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        saveTimer = null;
        void this.save();
      }, 500);
    });
    input.addEventListener("blur", () => {
      if (saveTimer === null) return;
      window.clearTimeout(saveTimer);
      saveTimer = null;
      void this.save();
    });

    const eye = row.createEl("button", {
      cls: "awty-key-btn",
      attr: { "aria-label": "Show or hide the key" },
    });
    setIcon(eye, "eye");
    eye.onclick = () => {
      const hidden = input.type === "password";
      input.type = hidden ? "text" : "password";
      setIcon(eye, hidden ? "eye-off" : "eye");
    };

    const importBtn = row.createEl("button", {
      cls: "awty-key-btn",
      attr: { "aria-label": "Use the key from Food Spot" },
    });
    setIcon(importBtn, "download");
    importBtn.onclick = async () => {
      const imported = await this.plugin.travel.importFoodSpotKey();
      if (!imported) {
        key.setChip("no key in Food Spot", "warn");
        return;
      }
      s.googleApiKey = imported;
      input.value = imported;
      await this.save();
      key.setChip("imported from Food Spot", "ok");
    };

    const testBtn = row.createEl("button", { text: "Test" });
    testBtn.onclick = async () => {
      if (!s.googleApiKey.trim()) {
        key.setChip("no key to test", "warn");
        return;
      }
      testBtn.disabled = true;
      key.setChip("testing…", "pending");
      try {
        // Save first: the test reads the key from settings, not the field.
        await this.save();
        const result = await this.plugin.travel.testKey();
        key.setChip(result.ok ? "test passed" : "test failed", result.ok ? "ok" : "warn");
        new Notice(result.message, result.ok ? 6000 : 10000);
      } finally {
        testBtn.disabled = false;
      }
    };

    const links = key.content.createDiv({ cls: "awty-key-links" });
    links.createEl("a", {
      text: "Get a key",
      href: "https://console.cloud.google.com/apis/credentials",
    });
    links.createEl("a", {
      text: "Enable Geocoding API",
      href: "https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com",
    });
    links.createEl("a", {
      text: "Enable Distance Matrix API",
      href: "https://console.cloud.google.com/apis/library/distance-matrix-backend.googleapis.com",
    });

    const warn = key.content.createDiv({ cls: "awty-key-warning" });
    setIcon(warn.createSpan({ cls: "awty-key-warning-icon" }), "alert-triangle");
    warn.createSpan({
      text: "The key is stored in plain text in this vault's plugin data.json. Anyone, or anything, with access to your vault files can read it.",
    });

    const modes = this.group(body, {
      icon: "car",
      title: "Modes",
      subtitle: "Each mode is a separate billed request per route.",
      chip: { text: `${s.travelModes.length} of 3`, tone: "ok" },
    });

    const modeRow = modes.content.createDiv({ cls: "awty-settings-subnotes" });
    for (const mode of TRAVEL_MODES) {
      const label = modeRow.createEl("label", { cls: "awty-subnote" });
      const box = label.createEl("input");
      box.type = "checkbox";
      box.checked = s.travelModes.includes(mode.id);
      label.createSpan({ text: mode.label });
      box.addEventListener("change", async () => {
        const current = new Set(s.travelModes);
        if (box.checked) current.add(mode.id);
        else current.delete(mode.id);
        s.travelModes = TRAVEL_MODES.map((m) => m.id).filter((id) => current.has(id));
        await this.save();
        modes.setChip(`${s.travelModes.length} of 3`, "ok");
      });
    }

    const counts = this.plugin.travel.countCached();
    const cache = this.group(body, {
      icon: "database",
      title: "Cached results",
      subtitle: "Each route and address is looked up once and kept.",
      chip: { text: `${counts.legs} routes`, tone: counts.legs > 0 ? "ok" : "pending" },
    });

    new Setting(cache.content)
      .setName("Clear the cache")
      .setDesc(
        `${counts.legs} route${counts.legs === 1 ? "" : "s"} and ${counts.addresses} address${counts.addresses === 1 ? "" : "es"} stored. Clearing means paying to look them up again.`,
      )
      .addButton((btn) =>
        btn
          .setButtonText("Clear")
          .setWarning()
          .onClick(async () => {
            await this.plugin.travel.clearLegs();
            this.plugin.travelPlaces.clear();
            new Notice("Travel time cache cleared.");
            this.renderBody();
          }),
      );
  }

  // ------------------------------------------------------------------- food

  private renderFoodSpot(body: HTMLElement): void {
    const s = this.plugin.settings;
    const installed = this.plugin.isFoodSpotAvailable();

    const group = this.group(body, {
      icon: "utensils",
      title: "Food Spot",
      subtitle: "Restaurants for the trip's city, embedded in its Food note.",
      chip: installed
        ? { text: "plugin found", tone: "ok" }
        : { text: "not enabled", tone: "warn" },
    });

    new Setting(group.content)
      .setName("Add a Food Spot block")
      .setDesc(
        installed
          ? "Each trip's Food note gets a block filtered to the trip's city."
          : `The Food Spot plugin ("${FOODSPOT_PLUGIN_ID}") is not enabled, so the block is written as plain text for later.`,
      )
      .addToggle((t) =>
        t.setValue(s.foodSpotEnabled).onChange(async (v) => {
          s.foodSpotEnabled = v;
          await this.save();
        }),
      );

    new Setting(group.content)
      .setName("View")
      .setDesc("Which layout the generated block asks for.")
      .addDropdown((dd) => {
        dd.addOption("cards", "Cards");
        dd.addOption("list", "List");
        dd.addOption("table", "Table");
        dd.addOption("shortlist", "Shortlist");
        dd.setValue(s.foodSpotView).onChange(async (v) => {
          s.foodSpotView = v as "cards" | "list" | "table" | "shortlist";
          await this.save();
        });
      });

    this.note(
      group.content,
      "Country names are copied from Food Spot so its filters match, and its restaurants already carry coordinates — which is why they cost nothing to place on a map.",
    );
  }

  // ------------------------------------------------------------------ about

  private renderAbout(body: HTMLElement): void {
    const group = this.group(body, {
      icon: "info",
      title: `Are We There Yet? ${this.plugin.manifest.version}`,
      subtitle: "Plan holidays, city breaks, day trips, concerts and events.",
      chip: { text: `loaded ${this.plugin.loadedAt}`, tone: "ok" },
    });

    this.note(
      group.content,
      "Obsidian only re-reads the plugin when it is toggled or the app restarts, so the load time above is how to tell whether a rebuild is actually running.",
    );

    this.note(
      group.content,
      "Flights are filled in from your own booking confirmation — paste it, or drop the calendar invite, anywhere in the flight wizard. Automatic look-up by flight number is not offered: Amadeus retired its self-service portal in July 2026, and nothing else free and self-serve answers it over HTTPS.",
    );

    const facts: [string, string][] = [
      ["Trips", String(this.plugin.store.getTrips().length)],
      ["Cities", "123,891 across 246 countries"],
      ["Airports", "6,071, with coordinates so flights need no geocoding"],
      ["Visa pairs", "39,402 from the open passport-index dataset"],
    ];
    for (const [label, value] of facts) {
      new Setting(group.content).setName(label).setDesc(value);
    }
  }
}
