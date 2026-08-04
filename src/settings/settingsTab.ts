import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { TRAVEL_MODES } from "../travel/types";
import type TravelPlannerPlugin from "../main";
import type { SubNoteId, TripKind } from "../types";
import { FOODSPOT_PLUGIN_ID, KINDS, SUB_NOTE_LABELS, kindDef } from "../types";
import { CountrySuggest } from "../ui/components/suggest";

export class TravelPlannerSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: TravelPlannerPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("tp-settings");

    // Obsidian only re-reads main.js when the plugin is toggled or the app
    // restarts, so a rebuilt plugin can sit on disk unused. Showing the running
    // build makes that visible instead of leaving you guessing.
    containerEl.createDiv({
      cls: "tp-settings-version",
      text: `Travel Planner ${this.plugin.manifest.version} — running build loaded ${this.plugin.loadedAt}`,
    });

    new Setting(containerEl).setName("Trips").setHeading();

    new Setting(containerEl)
      .setName("Trips folder")
      .setDesc("Root folder holding every trip.")
      .addText((t) =>
        t
          .setPlaceholder("Trips")
          .setValue(this.plugin.settings.tripsFolder)
          .onChange(async (v) => {
            this.plugin.settings.tripsFolder = v.trim() || "Trips";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Folder pattern")
      .setDesc(
        "Folder created per trip, relative to the trips folder. Placeholders: {year} {month} {start} {end} {title} {city} {country} {kind}. Use / for subfolders.",
      )
      .addText((t) =>
        t
          .setPlaceholder("{year}/{start} {title}")
          .setValue(this.plugin.settings.folderPattern)
          .onChange(async (v) => {
            this.plugin.settings.folderPattern = v.trim() || "{year}/{start} {title}";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Default country")
      .setDesc("Pre-filled when you create a trip.")
      .addText((t) => {
        t.setValue(this.plugin.settings.defaultCountry).onChange(async (v) => {
          this.plugin.settings.defaultCountry = v.trim();
          await this.plugin.saveSettings();
        });
        new CountrySuggest(this.app, t.inputEl, async (value) => {
          this.plugin.settings.defaultCountry = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName("Default kind").addDropdown((dd) => {
      for (const def of KINDS) dd.addOption(def.id, def.label);
      dd.setValue(this.plugin.settings.defaultKind).onChange(async (v) => {
        this.plugin.settings.defaultKind = v as TripKind;
        await this.plugin.saveSettings();
      });
    });

    new Setting(containerEl).setName("Sidebar").setHeading();

    new Setting(containerEl)
      .setName("Show past trips")
      .setDesc("Turn off to keep the sidebar to what's still ahead of you.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showPastTrips).onChange(async (v) => {
          this.plugin.settings.showPastTrips = v;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        }),
      );

    new Setting(containerEl)
      .setName("Confirm before deleting")
      .setDesc("Show the confirmation dialogue listing exactly which files go.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.confirmDelete).onChange(async (v) => {
          this.plugin.settings.confirmDelete = v;
          await this.plugin.saveSettings();
        }),
      );

    this.displayFoodSpot(containerEl);
    this.displayTravel(containerEl);
    this.displayTemplates(containerEl);
  }

  private displayTravel(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Travel times").setHeading();

    containerEl.createDiv({
      cls: "tp-settings-note",
      text:
        "Travel times use the Google Maps Geocoding and Distance Matrix APIs, which bill your Google Cloud account per request. " +
        "Nothing is sent anywhere until you switch this on. Results are cached, so each route is paid for once.",
    });

    new Setting(containerEl)
      .setName("Enable travel times")
      .setDesc("Distances from your accommodation to the airport, activities and restaurants.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.travelTimesEnabled).onChange(async (v) => {
          this.plugin.settings.travelTimesEnabled = v;
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    if (!this.plugin.settings.travelTimesEnabled) return;

    new Setting(containerEl)
      .setName("Google API key")
      .setDesc("Needs Geocoding API and Distance Matrix API enabled on the project.")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("AIza…");
        t.setValue(this.plugin.settings.googleApiKey);
        t.onChange(async (v) => {
          this.plugin.settings.googleApiKey = v.trim();
          await this.plugin.saveSettings();
        });
      })
      .addExtraButton((btn) =>
        btn
          .setIcon("download")
          .setTooltip("Use the key from Food Spot")
          .onClick(async () => {
            const key = await this.plugin.travel.importFoodSpotKey();
            if (!key) {
              new Notice("No Google key found in Food Spot's settings.");
              return;
            }
            this.plugin.settings.googleApiKey = key;
            await this.plugin.saveSettings();
            new Notice("Imported the Google key from Food Spot.");
            this.display();
          }),
      );

    new Setting(containerEl)
      .setName("Modes to look up")
      .setDesc("Each mode is a separate billed request per route.")
      .then((setting) => {
        const row = setting.controlEl.createDiv({ cls: "tp-settings-subnotes" });
        for (const mode of TRAVEL_MODES) {
          const label = row.createEl("label", { cls: "tp-subnote" });
          const box = label.createEl("input");
          box.type = "checkbox";
          box.checked = this.plugin.settings.travelModes.includes(mode.id);
          label.createSpan({ text: mode.label });
          box.addEventListener("change", async () => {
            const current = new Set(this.plugin.settings.travelModes);
            if (box.checked) current.add(mode.id);
            else current.delete(mode.id);
            this.plugin.settings.travelModes = TRAVEL_MODES.map((m) => m.id).filter((id) =>
              current.has(id),
            );
            await this.plugin.saveSettings();
          });
        }
      });

    const counts = this.plugin.travel.countCached();
    new Setting(containerEl)
      .setName("Cached results")
      .setDesc(
        `${counts.legs} route${counts.legs === 1 ? "" : "s"} and ${counts.addresses} address${counts.addresses === 1 ? "" : "es"} stored. Clearing means paying to look them up again.`,
      )
      .addButton((btn) =>
        btn
          .setButtonText("Clear cache")
          .setWarning()
          .onClick(async () => {
            await this.plugin.travel.clearLegs();
            this.plugin.travelPlaces.clear();
            new Notice("Travel time cache cleared.");
            this.display();
          }),
      );
  }

  private displayFoodSpot(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Food Spot").setHeading();

    const installed = this.plugin.isFoodSpotAvailable();
    new Setting(containerEl)
      .setName("Add a Food Spot block")
      .setDesc(
        installed
          ? "Each trip's Food note gets a foodspot block filtered to the trip's city."
          : `The Food Spot plugin ("${FOODSPOT_PLUGIN_ID}") isn't enabled, so the block is written as plain text for later.`,
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.foodSpotEnabled).onChange(async (v) => {
          this.plugin.settings.foodSpotEnabled = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Food Spot view")
      .setDesc("Which layout the generated block asks for.")
      .addDropdown((dd) => {
        dd.addOption("cards", "Cards");
        dd.addOption("list", "List");
        dd.addOption("table", "Table");
        dd.addOption("shortlist", "Shortlist");
        dd.setValue(this.plugin.settings.foodSpotView).onChange(async (v) => {
          this.plugin.settings.foodSpotView = v as "cards" | "list" | "table" | "shortlist";
          await this.plugin.saveSettings();
        });
      });
  }

  private displayTemplates(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Notes per trip kind")
      .setDesc("Which sub-notes get created. These are the defaults; you can still tick and untick per trip.")
      .setHeading();

    const ids = Object.keys(SUB_NOTE_LABELS) as SubNoteId[];

    for (const def of KINDS) {
      const setting = new Setting(containerEl).setName(def.label);
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
          // Keep a stable order rather than insertion order.
          this.plugin.settings.subNotesByKind[def.id] = ids.filter((i) => current.has(i));
          await this.plugin.saveSettings();
        });
      }

      setting.addExtraButton((btn) =>
        btn
          .setIcon("rotate-ccw")
          .setTooltip("Reset to defaults")
          .onClick(async () => {
            this.plugin.settings.subNotesByKind[def.id] = [...kindDef(def.id).subNotes];
            await this.plugin.saveSettings();
            this.display();
          }),
      );
    }
  }
}
