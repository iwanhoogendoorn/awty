import { App, setIcon } from "obsidian";
import type { FlightLeg } from "../../bookings/legs";
import {
  LEG_OPTIONAL_LABELS,
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
  nearby: () => { country: string; cities: string[] };
  /** An idea is a placeholder; its legs are not held to being complete. */
  isIdea?: () => boolean;
  onChange: () => void;
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
    container.addClass("awty-legs");

    for (const [index, leg] of this.legs.entries()) {
      // A layover only exists between legs of the same flight. Between two
      // separate flights there is a stay, and calling it a layover is how a
      // four-day gap ended up read as four days in the air.
      if (index > 0 && !leg.separate) this.renderLayover(container, this.legs[index - 1], leg);
      if (leg.separate) {
        container.createDiv({
          cls: "awty-leg-break",
          text: "Separate flight — not a connection",
        });
      }
      this.renderLeg(container, leg, index);
    }

    const row = container.createDiv({ cls: "awty-leg-adds" });

    const connect = row.createEl("button", { cls: "awty-leg-add" });
    connect.type = "button";
    setIcon(connect.createSpan(), "plus");
    connect.createSpan({ text: "Add a connecting flight" });
    connect.addEventListener("click", () => this.add(false));

    const separate = row.createEl("button", { cls: "awty-leg-add" });
    separate.type = "button";
    setIcon(separate.createSpan(), "plane");
    separate.createSpan({ text: "Add a separate flight" });
    separate.setAttribute(
      "title",
      "Another flight on this booking, days apart — timed on its own rather than as one long journey",
    );
    separate.addEventListener("click", () => this.add(true));
  }

  private add(separate: boolean): void {
    const previous = this.legs[this.legs.length - 1];
    const next = emptyLeg(previous.arrDate || previous.date);
    // Both start where the last one landed. Nothing is guessed for the
    // destination: a leg pre-filled to the airport it departs from is not a
    // flight, and copying the previous leg's destination made exactly that.
    next.from = previous.to;
    next.separate = separate;
    this.legs.push(next);
    this.render();
    this.opts.onChange();
  }

  private renderLayover(parent: HTMLElement, previous: FlightLeg, next: FlightLeg): void {
    const minutes = layoverMinutes(previous, next);
    const row = parent.createDiv({ cls: "awty-layover" });
    setIcon(row.createSpan({ cls: "awty-layover-icon" }), "hourglass");

    if (minutes === null) {
      row.createSpan({ cls: "awty-layover-text", text: "Layover — add times to work it out" });
      return;
    }

    const tight = minutes < TIGHT_CONNECTION_MINUTES;
    row.toggleClass("is-tight", tight);
    row.createSpan({
      cls: "awty-layover-text",
      text: `${formatLayover(minutes)} layover${previous.to ? ` in ${previous.to}` : ""}`,
    });
    if (tight) row.createSpan({ cls: "awty-layover-warn", text: "tight connection" });
  }

  private renderLeg(parent: HTMLElement, leg: FlightLeg, index: number): void {
    const box = parent.createDiv({ cls: "awty-leg-box" });

    const head = box.createDiv({ cls: "awty-leg-head" });
    // Numbered within its own flight: a separate flight starts at Leg 1 again,
    // because that is what it is.
    let within = 1;
    let flight = 1;
    for (let i = 0; i <= index; i += 1) {
      if (i === 0) continue;
      if (this.legs[i].separate) {
        within = 1;
        flight += 1;
      } else {
        within += 1;
      }
    }
    const hasBreaks = this.legs.some((l) => l.separate);
    head.createSpan({
      cls: "awty-leg-num",
      text: hasBreaks ? `Flight ${flight} · leg ${within}` : `Leg ${index + 1}`,
    });
    if (this.legs.length > 1) {
      const remove = head.createEl("button", { cls: "awty-icon-btn", attr: { "aria-label": "Remove leg" } });
      remove.type = "button";
      setIcon(remove, "trash-2");
      remove.addEventListener("click", () => {
        this.legs.splice(index, 1);
        this.render();
        this.opts.onChange();
      });
    }

    const grid = box.createDiv({ cls: "awty-leg-grid" });

    // What identifies the flight and places it: the airline, the number, the
    // airports and the dates. Times are not required — a ticket is often held
    // before its clock is checked. An idea is exempt from all of it.
    const idea = this.opts.isIdea?.() ?? false;
    const field = (label: string, build: (input: HTMLInputElement) => void, cls = "") => {
      const cell = grid.createDiv({ cls: `awty-leg-cell ${cls}` });
      const tag = cell.createEl("label", { cls: "awty-leg-label", text: label });
      if (!idea && !LEG_OPTIONAL_LABELS.includes(label)) {
        tag.createSpan({ cls: "awty-required", text: "*" });
      }
      const input = cell.createEl("input", { cls: "awty-leg-input" });
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

    field("Flight", (input) => {
      input.type = "text";
      input.value = leg.number;
      input.placeholder = "KL1885";
      input.addEventListener("input", () => {
        leg.number = input.value.trim();
        this.opts.onChange();
      });
    });

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
          // The other end of this leg: a flight does not land where it left.
          () => (key === "to" ? leg.from : leg.to),
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
