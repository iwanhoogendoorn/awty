import { App, setIcon } from "obsidian";
import type { FlightLeg } from "../../bookings/legs";
import {
  TIGHT_CONNECTION_MINUTES,
  emptyLeg,
  formatLayover,
  layoverMinutes,
} from "../../bookings/legs";
import { AirlineSuggest, AirportSuggest } from "./suggest";
import type { StarKind } from "../modals/bookingWizard";

export interface LegsFieldOptions {
  app: App;
  container: HTMLElement;
  legs: FlightLeg[];
  defaultDate: string;
  stars: {
    isStarred: (kind: StarKind, v: string) => boolean;
    toggle: (kind: StarKind, v: string) => Promise<void>;
  };
  /** Airports here are offered before the rest of the world. */
  nearby: () => { country: string; city: string };
  onChange: () => void;
  /** Whether a flight-number lookup is configured. */
  canLookUp: () => boolean;
  /** Returns the filled-in leg, or null when the look-up failed. */
  lookUp: (number: string, date: string) => Promise<FlightLeg | null>;
  /** Says why a look-up cannot run, rather than doing nothing. */
  explainLookup: (message: string) => void;
}

/**
 * Editor for a flight itinerary of one or more legs.
 *
 * Connections are the normal case for anywhere that isn't a hub, and the number
 * that actually matters when booking is the layover — so it is computed and
 * flagged when it is uncomfortably short, rather than left for you to work out.
 */
export class LegsField {
  private legs: FlightLeg[];

  constructor(private opts: LegsFieldOptions) {
    this.legs = opts.legs.length > 0 ? opts.legs : [emptyLeg(opts.defaultDate)];
    this.render();
  }

  getLegs(): FlightLeg[] {
    return this.legs;
  }

  private render(): void {
    const { container } = this.opts;
    container.empty();
    container.addClass("tp-legs");

    for (const [index, leg] of this.legs.entries()) {
      if (index > 0) this.renderLayover(container, this.legs[index - 1], leg);
      this.renderLeg(container, leg, index);
    }

    const add = container.createEl("button", { cls: "tp-leg-add" });
    add.type = "button";
    setIcon(add.createSpan(), "plus");
    add.createSpan({ text: this.legs.length === 1 ? "Add a connecting flight" : "Add another leg" });
    add.addEventListener("click", () => {
      const previous = this.legs[this.legs.length - 1];
      const next = emptyLeg(previous.arrDate || previous.date);
      // A connection starts where the last leg landed.
      next.from = previous.to;
      this.legs.push(next);
      this.render();
      this.opts.onChange();
    });
  }

  private renderLayover(parent: HTMLElement, previous: FlightLeg, next: FlightLeg): void {
    const minutes = layoverMinutes(previous, next);
    const row = parent.createDiv({ cls: "tp-layover" });
    setIcon(row.createSpan({ cls: "tp-layover-icon" }), "hourglass");

    if (minutes === null) {
      row.createSpan({ cls: "tp-layover-text", text: "Layover — add times to work it out" });
      return;
    }

    const tight = minutes < TIGHT_CONNECTION_MINUTES;
    row.toggleClass("is-tight", tight);
    row.createSpan({
      cls: "tp-layover-text",
      text: `${formatLayover(minutes)} layover${previous.to ? ` in ${previous.to}` : ""}`,
    });
    if (tight) row.createSpan({ cls: "tp-layover-warn", text: "tight connection" });
  }

  private renderLeg(parent: HTMLElement, leg: FlightLeg, index: number): void {
    const box = parent.createDiv({ cls: "tp-leg-box" });

    const head = box.createDiv({ cls: "tp-leg-head" });
    head.createSpan({ cls: "tp-leg-num", text: `Leg ${index + 1}` });
    if (this.legs.length > 1) {
      const remove = head.createEl("button", { cls: "tp-icon-btn", attr: { "aria-label": "Remove leg" } });
      remove.type = "button";
      setIcon(remove, "trash-2");
      remove.addEventListener("click", () => {
        this.legs.splice(index, 1);
        this.render();
        this.opts.onChange();
      });
    }

    const grid = box.createDiv({ cls: "tp-leg-grid" });

    const field = (label: string, build: (input: HTMLInputElement) => void, cls = "") => {
      const cell = grid.createDiv({ cls: `tp-leg-cell ${cls}` });
      cell.createEl("label", { cls: "tp-leg-label", text: label });
      const input = cell.createEl("input", { cls: "tp-leg-input" });
      build(input);
      return input;
    };

    field("Airline", (input) => {
      input.type = "text";
      input.value = leg.operator;
      input.placeholder = "KLM";
      input.addEventListener("input", () => {
        leg.operator = input.value.trim();
        this.opts.onChange();
      });
      new AirlineSuggest(
        this.opts.app,
        input,
        (v) => this.opts.stars.isStarred("airline", v),
        (v) => {
          leg.operator = v;
          input.value = v;
          this.opts.onChange();
        },
      );
    });

    const flightInput = field("Flight", (input) => {
      input.type = "text";
      input.value = leg.number;
      input.placeholder = "KL1885";
      input.addEventListener("input", () => {
        leg.number = input.value.trim();
        this.opts.onChange();
      });
    });

    // Given a number and a date, everything else is transcription. The button
    // is always here: hiding it when no key is set made the feature look broken
    // rather than unconfigured.
    const lookup = flightInput.parentElement?.createEl("button", {
      cls: `tp-leg-lookup${this.opts.canLookUp() ? "" : " is-unset"}`,
      attr: { "aria-label": "Look this flight up" },
    });
    if (lookup) {
      lookup.type = "button";
      setIcon(lookup, "search");
      lookup.addEventListener("click", async () => {
        if (!leg.number || !leg.date) {
          this.opts.explainLookup("Enter a flight number and a date first.");
          return;
        }
        if (!this.opts.canLookUp()) {
          this.opts.explainLookup(
            "Add a RapidAPI key under Settings → Travel Planner → Flight data to look flights up automatically.",
          );
          return;
        }
        lookup.addClass("is-busy");
        const filled = await this.opts.lookUp(leg.number, leg.date);
        lookup.removeClass("is-busy");
        if (!filled) return;
        Object.assign(leg, filled, { number: leg.number });
        this.render();
        this.opts.onChange();
      });
    }

    const airport = (label: string, key: "from" | "to") =>
      field(label, (input) => {
        input.type = "text";
        input.value = leg[key];
        input.placeholder = key === "from" ? "AMS" : "DBV";
        input.addEventListener("input", () => {
          leg[key] = input.value.trim();
          this.opts.onChange();
        });
        new AirportSuggest(
          this.opts.app,
          input,
          (v) => this.opts.stars.isStarred("airport", v),
          (v) => {
            leg[key] = v;
            input.value = v;
            this.render();
            this.opts.onChange();
          },
          this.opts.nearby,
        );
      });

    airport("From", "from");
    airport("To", "to");

    field("Date", (input) => {
      input.type = "date";
      input.value = leg.date;
      input.addEventListener("change", () => {
        leg.date = input.value;
        // Arrival defaults to the same day until told otherwise.
        if (!leg.arrDate || leg.arrDate < leg.date) leg.arrDate = leg.date;
        this.render();
        this.opts.onChange();
      });
    });

    field("Departs", (input) => {
      input.type = "time";
      input.value = leg.depTime;
      input.addEventListener("change", () => {
        leg.depTime = input.value;
        this.render();
        this.opts.onChange();
      });
    });

    field("Arrives", (input) => {
      input.type = "time";
      input.value = leg.arrTime;
      input.addEventListener("change", () => {
        leg.arrTime = input.value;
        this.render();
        this.opts.onChange();
      });
    });

    field("Arrives on", (input) => {
      input.type = "date";
      input.value = leg.arrDate || leg.date;
      input.min = leg.date;
      input.setAttribute("aria-label", "Arrival date, for overnight flights");
      input.addEventListener("change", () => {
        leg.arrDate = input.value;
        this.render();
        this.opts.onChange();
      });
    });
  }
}
