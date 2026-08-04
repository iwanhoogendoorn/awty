import { App, Modal, Notice, Setting, setIcon } from "obsidian";
import type AwtyPlugin from "../../main";
import type { Place, TravelLeg } from "../../travel/types";
import { TRAVEL_MODES, formatDistance, formatDuration } from "../../travel/types";
import type { TripPlaces } from "../../travel/travelService";
import { TravelUnavailable } from "../../travel/travelService";
import type { Trip } from "../../types";
import { keepOpenOnBackgroundClick } from "../modalUtils";

const KIND_LABEL: Record<string, string> = {
  hotel: "Stay",
  airport: "Airport",
  activity: "Activity",
  restaurant: "Restaurant",
  station: "Transport",
};

/**
 * Travel time between any two places on a trip.
 *
 * The dashboard measures everything from the hotel, which answers most
 * questions but not all of them — "airport to the old town", "restaurant to the
 * concert". Both ends are pickable here, pre-filled with whatever was clicked,
 * and the lookup stays behind a button because an uncached pair is billed.
 */
export class RouteModal extends Modal {
  private from: Place | undefined;
  private to: Place | undefined;
  private places: Place[] = [];
  private body!: HTMLElement;

  constructor(
    app: App,
    private plugin: AwtyPlugin,
    private trip: Trip,
    defaults: { from?: Place; to?: Place } = {},
  ) {
    super(app);
    const known: TripPlaces | undefined = plugin.travelPlaces.get(trip.folderPath);
    this.places = known
      ? [...known.hotels, ...known.airports, ...known.activities, ...known.restaurants]
      : [];

    // Defaults that make the common case a single click: from where you are
    // staying, to the first place that is not it.
    this.from = defaults.from ?? known?.hotels[0] ?? this.places[0];
    this.to = defaults.to ?? this.places.find((p) => p.id !== this.from?.id);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("awty-modal");
    keepOpenOnBackgroundClick(this);
    contentEl.createEl("h2", { text: "Travel time" });

    if (this.places.length < 2) {
      contentEl.createDiv({
        cls: "awty-dash-hint",
        text: "Calculate travel times for this trip first — there are not two placed bookings to measure between yet.",
      });
      return;
    }

    const pick = (label: string, get: () => Place | undefined, set: (p: Place) => void) => {
      new Setting(contentEl).setName(label).addDropdown((dd) => {
        for (const place of this.places) {
          dd.addOption(place.id, `${KIND_LABEL[place.kind] ?? "Place"} · ${place.label}`);
        }
        dd.setValue(get()?.id ?? "");
        dd.onChange((value) => {
          const found = this.places.find((p) => p.id === value);
          if (found) set(found);
          this.renderResult();
        });
      });
    };

    pick(
      "From",
      () => this.from,
      (p) => {
        this.from = p;
      },
    );

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Swap")
        .setTooltip("Measure the other way — a one-way street or an uphill walk is not symmetric")
        .onClick(() => {
          [this.from, this.to] = [this.to, this.from];
          this.close();
          new RouteModal(this.app, this.plugin, this.trip, {
            from: this.from,
            to: this.to,
          }).open();
        }),
    );

    pick(
      "To",
      () => this.to,
      (p) => {
        this.to = p;
      },
    );

    this.body = contentEl.createDiv({ cls: "awty-route-result" });
    this.renderResult();
  }

  private renderResult(): void {
    const { body } = this;
    body.empty();

    if (!this.from || !this.to) return;
    if (this.from.id === this.to.id) {
      body.createDiv({ cls: "awty-dash-hint", text: "Pick two different places." });
      return;
    }

    const modes = this.plugin.settings.travelModes;
    const legs = this.plugin.travel.peekLegs(this.from, [this.to], modes).get(this.to.id) ?? [];

    if (legs.length === 0) {
      body.createDiv({
        cls: "awty-dash-hint",
        text: "This pair has not been measured yet. Looking it up makes one billed Google request per mode.",
      });
      this.renderLookup(body);
      return;
    }

    const reference = legs.find((l) => l.mode === "walking") ?? legs[0];
    body.createDiv({
      cls: "awty-route-dist",
      text: `${formatDistance(reference.distanceMeters)} · ${this.from.label} → ${this.to.label}`,
    });

    const list = body.createDiv({ cls: "awty-route-modes" });
    for (const mode of modes) {
      const leg = legs.find((l: TravelLeg) => l.mode === mode);
      const def = TRAVEL_MODES.find((m) => m.id === mode);
      const row = list.createDiv({ cls: `awty-route-mode${leg ? "" : " is-none"}` });
      setIcon(row.createSpan({ cls: "awty-route-mode-icon" }), def?.icon ?? "route");
      row.createSpan({ cls: "awty-route-mode-label", text: def?.label ?? mode });
      row.createSpan({
        cls: "awty-route-mode-time",
        text: leg ? formatDuration(leg.durationSeconds) : "no route",
      });
    }

    // Modes with no cached answer might simply never have been asked for.
    if (legs.length < modes.length) this.renderLookup(body);
  }

  private renderLookup(parent: HTMLElement): void {
    new Setting(parent).addButton((b) =>
      b
        .setButtonText("Look it up")
        .setCta()
        .onClick(async () => {
          if (!this.from || !this.to) return;
          b.setDisabled(true).setButtonText("Looking up…");
          try {
            await this.plugin.travel.fetchLegs(
              this.from,
              [this.to],
              this.plugin.settings.travelModes,
              this.plugin.travel.departureTimeFor(this.trip),
              // This button exists because a mode is missing, and a mode
              // recorded as unroutable is exactly what it is being asked about.
              true,
            );
            this.renderResult();
            this.plugin.refreshViews();
          } catch (err) {
            b.setDisabled(false).setButtonText("Look it up");
            new Notice(
              err instanceof TravelUnavailable
                ? err.message
                : `AWTY: ${err instanceof Error ? err.message : "lookup failed"}`,
            );
          }
        }),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
