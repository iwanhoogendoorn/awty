import { App, Modal, Notice, Setting, setIcon } from "obsidian";
import type { SubNoteId, TravelPlannerSettings, Trip, TripDraft, TripKind } from "../../types";
import { KINDS, SUB_NOTE_LABELS, kindDef } from "../../types";
import { DateRangeField } from "../components/dateRange";
import { CitySuggest, CountrySuggest, countryForCity } from "../components/suggest";
import { isValidISODate, todayISO } from "../../util/dates";

export type TripModalMode = "create" | "edit";

export class TripModal extends Modal {
  private draft: TripDraft;
  private dates!: DateRangeField;
  private titleInput!: HTMLInputElement;
  private countryInput!: HTMLInputElement;
  private venueSetting!: Setting;
  private kindButtons = new Map<TripKind, HTMLElement>();
  private subNoteSection!: HTMLElement;
  /** True until the user types a title of their own, so the city can fill it in. */
  private titleIsAuto: boolean;

  constructor(
    app: App,
    private settings: TravelPlannerSettings,
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
      subNotes: initial.subNotes ?? [...(settings.subNotesByKind[kind] ?? kindDef(kind).subNotes)],
    };
    this.titleIsAuto = !this.draft.title;
  }

  static forEdit(
    app: App,
    settings: TravelPlannerSettings,
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
        subNotes: [],
      },
      onSubmit,
    );
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-modal");
    this.modalEl.addClass("tp-modal-shell");

    contentEl.createEl("h2", {
      text: this.mode === "create" ? "New trip" : "Edit trip",
      cls: "tp-modal-title",
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
      .addButton((btn) =>
        btn
          .setButtonText(this.mode === "create" ? "Create trip" : "Save changes")
          .setCta()
          .onClick(() => void this.submit()),
      );

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
    const section = parent.createDiv({ cls: "tp-section" });
    section.createDiv({ cls: "tp-section-label", text: "What kind of trip?" });
    const row = section.createDiv({ cls: "tp-kind-row" });

    for (const def of KINDS) {
      const btn = row.createEl("button", { cls: "tp-kind" });
      btn.type = "button";
      setIcon(btn.createSpan({ cls: "tp-kind-icon" }), def.icon);
      btn.createSpan({ cls: "tp-kind-label", text: def.label });
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

    this.venueSetting = new Setting(parent).setName("Venue").addText((t) => {
      t.setPlaceholder("e.g. Ziggo Dome");
      t.setValue(this.draft.venue);
      t.onChange((v) => (this.draft.venue = v.trim()));
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
    if (this.titleIsAuto && city) {
      this.draft.title = city;
      this.titleInput.value = city;
    }
  }

  private renderSubNotePicker(parent: HTMLElement): void {
    const section = parent.createDiv({ cls: "tp-section" });
    section.createDiv({ cls: "tp-section-label", text: "Create these notes" });
    this.subNoteSection = section.createDiv({ cls: "tp-subnote-row" });
    this.renderSubNoteCheckboxes();
  }

  private renderSubNoteCheckboxes(): void {
    if (!this.subNoteSection) return;
    this.subNoteSection.empty();
    const ids = Object.keys(SUB_NOTE_LABELS) as SubNoteId[];
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

  private async submit(): Promise<void> {
    const value = this.dates.getValue();
    this.draft.startDate = value.startDate;
    this.draft.endDate = value.endDate;

    if (!this.draft.title.trim()) {
      // The city is a perfectly good fallback name; only complain if both are empty.
      if (this.draft.city) this.draft.title = this.draft.city;
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

    try {
      await this.onSubmit({ ...this.draft });
      this.close();
    } catch (err) {
      new Notice(err instanceof Error ? err.message : "Could not save the trip.");
      console.error("[travel-planner]", err);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
