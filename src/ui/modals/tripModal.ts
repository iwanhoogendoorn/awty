import { App, ButtonComponent, Modal, Notice, Setting, setIcon } from "obsidian";
import { keepOpenOnBackgroundClick } from "../modalUtils";
import type { SubNoteId, AwtySettings, Trip, TripDraft, TripKind } from "../../types";
import { CREATABLE_SUB_NOTES, KINDS, SUB_NOTE_LABELS, kindDef } from "../../types";
import { DateRangeField } from "../components/dateRange";
import { AirportSuggest, CitySuggest, CountrySuggest, countryForCity } from "../components/suggest";
import { isValidISODate, monthName, todayISO, yearOf } from "../../util/dates";
import { parseAmount } from "../../util/money";
import { replaceLastToken } from "../../util/search";

export type TripModalMode = "create" | "edit";

export class TripModal extends Modal {
  private draft: TripDraft;
  private dates!: DateRangeField;
  private titleInput!: HTMLInputElement;
  private countryInput!: HTMLInputElement;
  private venueSetting!: Setting;
  private kindButtons = new Map<TripKind, HTMLElement>();
  private subNoteSection!: HTMLElement;
  private submitBtn: ButtonComponent | null = null;
  /**
   * Creating a trip writes up to seven notes, which is slow enough that the
   * button looks dead and invites a second click — which is exactly how a trip
   * got created twice. One guard flag plus a disabled button closes that.
   */
  private submitting = false;
  /** True until the user types a title of their own, so the city can fill it in. */
  private titleIsAuto: boolean;

  constructor(
    app: App,
    private settings: AwtySettings,
    private mode: TripModalMode,
    initial: Partial<TripDraft>,
    private onSubmit: (draft: TripDraft) => Promise<void>,
  ) {
    super(app);
    const kind = initial.kind ?? settings.defaultKind;
    const start = isValidISODate(initial.startDate ?? "") ? initial.startDate! : todayISO();
    this.draft = {
      title: initial.title ?? "",
      kind,
      country: initial.country ?? (mode === "create" ? settings.defaultCountry : ""),
      city: initial.city ?? "",
      venue: initial.venue ?? "",
      startDate: start,
      endDate: initial.endDate ?? start,
      notes: initial.notes ?? "",
      travellers:
        initial.travellers ?? (mode === "create" ? [...settings.household] : []),
      originCity: initial.originCity ?? (mode === "create" ? settings.homeCity : ""),
      originAirport: initial.originAirport ?? (mode === "create" ? settings.homeAirport : ""),
      budgetTotal: initial.budgetTotal ?? null,
      passports:
        initial.passports ?? (mode === "create" ? [...settings.passportCountries] : []),
      subNotes: initial.subNotes ?? [...(settings.subNotesByKind[kind] ?? kindDef(kind).subNotes)],
    };
    this.titleIsAuto = !this.draft.title;
  }

  static forEdit(
    app: App,
    settings: AwtySettings,
    trip: Trip,
    onSubmit: (draft: TripDraft) => Promise<void>,
  ): TripModal {
    return new TripModal(
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
        travellers: trip.travellers,
        originCity: trip.originCity,
        originAirport: trip.originAirport,
        budgetTotal: trip.budgetTotal,
        passports: trip.passports,
        subNotes: [],
      },
      onSubmit,
    );
  }

  onOpen(): void {
    keepOpenOnBackgroundClick(this);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("awty-modal");
    this.modalEl.addClass("awty-modal-shell");

    contentEl.createEl("h2", {
      text: this.mode === "create" ? "New trip" : "Edit trip",
      cls: "awty-modal-title",
    });

    this.renderKindPicker(contentEl);
    this.renderPlaceFields(contentEl);

    const dateSection = contentEl.createDiv({ cls: "awty-section" });
    dateSection.createDiv({ cls: "awty-section-label", text: "Dates" });
    this.dates = new DateRangeField(
      dateSection,
      { startDate: this.draft.startDate, endDate: this.draft.endDate },
      (value) => {
        this.draft.startDate = value.startDate;
        this.draft.endDate = value.endDate;
        // Moving the trip to a different month should move the title with it.
        this.applyAutoTitle();
      },
    );
    this.dates.setSingleDay(kindDef(this.draft.kind).singleDay);

    if (this.mode === "create") {
      this.renderSubNotePicker(contentEl);
      new Setting(contentEl).setName("Notes").addTextArea((ta) => {
        ta.setPlaceholder("Anything you already know about this trip…");
        ta.inputEl.rows = 3;
        ta.onChange((v) => (this.draft.notes = v));
      });
    }

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((btn) => {
        this.submitBtn = btn;
        btn
          .setButtonText(this.mode === "create" ? "Create trip" : "Save changes")
          .setCta()
          .onClick(() => void this.submit());
      });

    // Enter submits from any single-line field; Shift+Enter in the notes box does not.
    contentEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && !evt.shiftKey && evt.target instanceof HTMLInputElement) {
        evt.preventDefault();
        void this.submit();
      }
    });

    window.setTimeout(() => this.titleInput?.focus(), 0);
  }

  private renderKindPicker(parent: HTMLElement): void {
    const section = parent.createDiv({ cls: "awty-section" });
    section.createDiv({ cls: "awty-section-label", text: "What kind of trip?" });
    const row = section.createDiv({ cls: "awty-kind-row" });

    for (const def of KINDS) {
      const btn = row.createEl("button", { cls: "awty-kind" });
      btn.type = "button";
      setIcon(btn.createSpan({ cls: "awty-kind-icon" }), def.icon);
      btn.createSpan({ cls: "awty-kind-label", text: def.label });
      btn.addEventListener("click", () => this.setKind(def.id));
      this.kindButtons.set(def.id, btn);
    }
    this.syncKindButtons();
  }

  private syncKindButtons(): void {
    for (const [id, btn] of this.kindButtons) {
      btn.toggleClass("is-active", id === this.draft.kind);
    }
  }

  private setKind(kind: TripKind): void {
    if (this.draft.kind === kind) return;
    const previous = kindDef(this.draft.kind);
    const next = kindDef(kind);
    this.draft.kind = kind;
    this.syncKindButtons();

    this.venueSetting.settingEl.toggleClass("is-hidden", !next.hasVenue);
    this.dates.setSingleDay(next.singleDay);
    // Only re-suggest a length when the kind genuinely implies a different one,
    // so switching Holiday -> Business doesn't quietly discard your dates.
    if (!next.singleDay && previous.defaultDurationDays !== next.defaultDurationDays) {
      this.dates.suggestDuration(next.defaultDurationDays);
    }

    if (this.mode === "create") {
      this.draft.subNotes = [...(this.settings.subNotesByKind[kind] ?? next.subNotes)];
      this.renderSubNoteCheckboxes();
    }
  }

  private renderPlaceFields(parent: HTMLElement): void {
    new Setting(parent).setName("Title").setDesc("Shown in the sidebar and used as the note name.").addText(
      (t) => {
        this.titleInput = t.inputEl;
        t.setPlaceholder("e.g. Japan 2026, or Radiohead at Ziggo Dome");
        t.setValue(this.draft.title);
        t.onChange((v) => {
          this.draft.title = v;
          this.titleIsAuto = v.trim().length === 0;
        });
      },
    );

    new Setting(parent).setName("Country").addText((t) => {
      this.countryInput = t.inputEl;
      t.setPlaceholder("Start typing…");
      t.setValue(this.draft.country);
      t.onChange((v) => (this.draft.country = v.trim()));
      new CountrySuggest(this.app, t.inputEl, (value) => {
        this.draft.country = value;
      });
    });

    new Setting(parent)
      .setName("City")
      .setDesc("Drives the Food Spot embed, so it should match how Food Spot spells it.")
      .addText((t) => {
        t.setPlaceholder("Start typing…");
        t.setValue(this.draft.city);
        t.onChange((v) => this.setCity(v.trim(), false));
        new CitySuggest(
          this.app,
          t.inputEl,
          () => this.draft.country,
          (value) => this.setCity(value, true),
        );
      });

    // A trip has two ends. Only ever recording the destination made "where am
    // I flying from?" unanswerable without opening a booking.
    new Setting(parent)
      .setName("Travelling from")
      .setDesc("Your origin city and home airport, pre-filled from settings.")
      .addText((t) => {
        t.setPlaceholder("City");
        t.setValue(this.draft.originCity);
        t.onChange((v) => (this.draft.originCity = v.trim()));
        new CitySuggest(
          this.app,
          t.inputEl,
          () => "",
          (value) => (this.draft.originCity = value),
          () => this.settings.defaultCountry,
        );
      })
      .addText((t) => {
        t.setPlaceholder("Airport");
        t.setValue(this.draft.originAirport);
        t.onChange((v) => (this.draft.originAirport = v.trim()));
        new AirportSuggest(
          this.app,
          t.inputEl,
          () => false,
          (value) => (this.draft.originAirport = value),
          // Where you are leaving from, not where you are going.
          () => ({ country: this.settings.defaultCountry, city: this.draft.originCity }),
        );
      });

    // The visa check has to know which passport you are travelling on, and
    // settings were the only place it could be said.
    new Setting(parent)
      .setName("Passports")
      .setDesc("Checked against the destination for visa requirements. Separate with commas.")
      .addText((t) => {
        // The suggestion replaces the fragment being typed, not the whole
        // field: picking "Netherlands" after typing "net" must not leave "net"
        // behind as a second passport.
        let raw = this.draft.passports.join(", ");

        const commit = (list: string[]): void => {
          const seen = new Set<string>();
          const unique = list
            .map((name) => name.trim())
            .filter((name) => {
              const key = name.toLowerCase();
              if (!name || seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          this.draft.passports = unique;
          raw = unique.join(", ");
          t.setValue(raw);
        };

        t.setPlaceholder(this.settings.passportCountries.join(", ") || "Netherlands");
        t.setValue(raw);
        t.onChange((v) => {
          raw = v;
          this.draft.passports = v
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean);
        });

        new CountrySuggest(this.app, t.inputEl, (value) => commit(replaceLastToken(raw, value)));
      });

    new Setting(parent)
      .setName("Budget")
      .setDesc("Roughly what you want the whole trip to cost. Used everywhere costs are shown.")
      .addText((t) => {
        t.setPlaceholder("3000");
        t.inputEl.inputMode = "decimal";
        t.setValue(this.draft.budgetTotal !== null ? String(this.draft.budgetTotal) : "");
        t.onChange((v) => {
          const amount = parseAmount(v);
          this.draft.budgetTotal = amount !== null && amount > 0 ? amount : null;
        });
      });

    new Setting(parent)
      .setName("Who's going")
      .setDesc("Separate names with commas. Drives packing quantities and the cost split.")
      .addText((t) => {
        t.setPlaceholder("Iwan, Gaurav");
        t.setValue(this.draft.travellers.join(", "));
        t.onChange((v) => {
          this.draft.travellers = v
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean);
        });
      });

    this.venueSetting = new Setting(parent).setName("Venue").addText((t) => {
      t.setPlaceholder("e.g. Ziggo Dome");
      t.setValue(this.draft.venue);
      t.onChange((v) => {
        this.draft.venue = v.trim();
        this.applyAutoTitle();
      });
    });
    this.venueSetting.settingEl.toggleClass("is-hidden", !kindDef(this.draft.kind).hasVenue);
  }

  private setCity(city: string, fromSuggestion: boolean): void {
    this.draft.city = city;

    // Picking a city fills in the country you haven't chosen yet.
    if (fromSuggestion && !this.draft.country) {
      const owner = countryForCity(city);
      if (owner) {
        this.draft.country = owner;
        this.countryInput.value = owner;
      }
    }
    this.applyAutoTitle();
  }

  /** "Dubrovnik - August - 2026", falling back through city, venue, country. */
  private autoTitle(): string {
    const place = this.draft.city || this.draft.venue || this.draft.country;
    if (!place) return "";
    const month = monthName(this.draft.startDate);
    const year = yearOf(this.draft.startDate);
    return [place, month, year].filter(Boolean).join(" - ");
  }

  /** Rewrites the title only while the user hasn't supplied one of their own. */
  private applyAutoTitle(): void {
    if (!this.titleIsAuto) return;
    const title = this.autoTitle();
    if (!title) return;
    this.draft.title = title;
    if (this.titleInput) this.titleInput.value = title;
  }

  private renderSubNotePicker(parent: HTMLElement): void {
    const section = parent.createDiv({ cls: "awty-section" });
    section.createDiv({ cls: "awty-section-label", text: "Create these notes" });
    this.subNoteSection = section.createDiv({ cls: "awty-subnote-row" });
    this.renderSubNoteCheckboxes();
  }

  private renderSubNoteCheckboxes(): void {
    if (!this.subNoteSection) return;
    this.subNoteSection.empty();
    const ids = CREATABLE_SUB_NOTES;
    for (const id of ids) {
      const label = this.subNoteSection.createEl("label", { cls: "awty-subnote" });
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

  private async submit(): Promise<void> {
    if (this.submitting) return;

    const value = this.dates.getValue();
    this.draft.startDate = value.startDate;
    this.draft.endDate = value.endDate;

    if (!this.draft.title.trim()) {
      // The city is a perfectly good fallback name; only complain if both are empty.
      if (this.draft.city) this.draft.title = this.autoTitle() || this.draft.city;
      else {
        new Notice("Give the trip a title.");
        this.titleInput.focus();
        return;
      }
    }
    if (!isValidISODate(this.draft.startDate)) {
      new Notice("Pick a start date.");
      return;
    }

    this.submitting = true;
    const label = this.mode === "create" ? "Creating…" : "Saving…";
    this.submitBtn?.setDisabled(true).setButtonText(label);

    try {
      await this.onSubmit({ ...this.draft });
      this.close();
    } catch (err) {
      new Notice(err instanceof Error ? err.message : "Could not save the trip.");
      console.error("[awty]", err);
      // Let them fix whatever went wrong and try again.
      this.submitting = false;
      this.submitBtn
        ?.setDisabled(false)
        .setButtonText(this.mode === "create" ? "Create trip" : "Save changes");
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
