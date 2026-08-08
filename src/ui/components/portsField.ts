import { App, setIcon } from "obsidian";
import type { CruisePort } from "../../bookings/cruise";
import {
  emptyPort,
  formatAshore,
  isPortCall,
  minutesAshore,
  weekdayOf,
} from "../../bookings/cruise";
import { CitySuggest, CountrySuggest } from "./suggest";
import { addDays } from "../../util/dates";

export interface PortsFieldOptions {
  app: App;
  container: HTMLElement;
  ports: CruisePort[];
  /** Where the first row starts, when there is nothing to go on. */
  defaultDate: string;
  onChange: () => void;
}

/**
 * Editor for a cruise itinerary: one row per day the ship is somewhere.
 *
 * A cruise confirmation is a table — date, port, in, out — and this is that
 * table, because retyping it into anything else is how a departure time gets
 * lost. The hours ashore are worked out rather than asked for: that is the
 * number an excursion has to fit inside, and nobody wants to do the subtraction
 * on a quay.
 */
export class PortsField {
  private ports: CruisePort[];

  constructor(private opts: PortsFieldOptions) {
    this.ports = opts.ports.length > 0 ? opts.ports : [emptyPort(opts.defaultDate)];
    this.render();
  }

  getPorts(): CruisePort[] {
    return this.ports;
  }

  private render(): void {
    const { container } = this.opts;
    container.empty();
    container.addClass("awty-ports");

    for (const [index, port] of this.ports.entries()) this.renderPort(container, port, index);

    const row = container.createDiv({ cls: "awty-leg-adds" });

    const call = row.createEl("button", { cls: "awty-leg-add" });
    call.type = "button";
    setIcon(call.createSpan(), "anchor");
    call.createSpan({ text: "Add a port" });
    call.addEventListener("click", () => this.add(false));

    const sea = row.createEl("button", { cls: "awty-leg-add" });
    sea.type = "button";
    setIcon(sea.createSpan(), "waves");
    sea.createSpan({ text: "Add a day at sea" });
    sea.setAttribute("title", "A day with no port — nothing to book ashore");
    sea.addEventListener("click", () => this.add(true));
  }

  /**
   * The next day, carrying the country forward.
   *
   * Consecutive calls are usually in the same country and often the same one
   * you were in yesterday, and a cruise itinerary is long enough that retyping
   * "Mexico" down a column is a real cost. The date advances by one because a
   * cruise is a day per row; it is the single most reliable guess here.
   */
  private add(atSea: boolean): void {
    const previous = this.ports[this.ports.length - 1];
    const next = emptyPort(previous?.date ? addDays(previous.date, 1) : this.opts.defaultDate);
    next.atSea = atSea;
    if (!atSea && previous) next.country = previous.country;
    this.ports.push(next);
    this.render();
    this.opts.onChange();
  }

  private renderPort(parent: HTMLElement, port: CruisePort, index: number): void {
    const box = parent.createDiv({ cls: "awty-leg-box" });
    if (port.atSea) box.addClass("is-at-sea");

    const head = box.createDiv({ cls: "awty-leg-head" });
    const day = weekdayOf(port.date);
    head.createSpan({
      cls: "awty-leg-title",
      text: `Day ${index + 1}${day ? ` · ${day}` : ""}${port.atSea ? " · at sea" : ""}`,
    });

    // What this day gives you, said where you are entering it. On a port day
    // that is the window an excursion has to fit into; on a sea day it is the
    // reason there is nothing else to fill in.
    const ashore = minutesAshore(port);
    const note = (): string => {
      if (port.atSea) return "No port — the whole day is on the ship";
      if (!isPortCall(port)) return "";
      if (ashore !== null) return `${formatAshore(ashore)} ashore`;
      // The first and last days genuinely have one time each — you were already
      // in the port you board at, and you do not sail from the one you leave
      // from. Asking for "both times" there is asking for one that cannot exist.
      if (port.departs) return `Sails at ${port.departs}`;
      if (port.arrives) return `Docks at ${port.arrives}`;
      return "Add the times to see how long you have ashore";
    };
    const text = note();
    if (text) head.createSpan({ cls: "awty-leg-note", text });

    if (this.ports.length > 1) {
      const remove = head.createEl("button", { cls: "awty-icon-btn" });
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove day ${index + 1}`);
      setIcon(remove, "x");
      remove.addEventListener("click", () => {
        this.ports.splice(index, 1);
        this.render();
        this.opts.onChange();
      });
    }

    const grid = box.createDiv({ cls: "awty-leg-grid" });
    const field = (label: string, build: (input: HTMLInputElement) => void): HTMLInputElement => {
      const wrap = grid.createDiv({ cls: "awty-leg-field" });
      wrap.createDiv({ cls: "awty-leg-label", text: label });
      const input = wrap.createEl("input", { cls: "awty-leg-input" });
      build(input);
      return input;
    };

    field("Date", (input) => {
      input.type = "date";
      input.value = port.date;
      input.addEventListener("change", () => {
        port.date = input.value;
        this.render();
        this.opts.onChange();
      });
    });

    field(port.atSea ? "Where" : "Port", (input) => {
      input.type = "text";
      input.value = port.port;
      input.placeholder = port.atSea ? "Cruising the Caribbean Sea" : "Progreso";
      input.addEventListener("input", () => {
        port.port = input.value.trim();
        this.opts.onChange();
      });
      // A port is a city, and the same list the rest of the plugin uses knows
      // them. Sea days are not: whatever the line calls that stretch of water
      // is not in any gazetteer, so it stays a plain box.
      if (!port.atSea) {
        new CitySuggest(
          this.opts.app,
          input,
          () => port.country,
          (value, picked) => {
            port.port = value;
            if (!port.country && picked) port.country = picked;
            this.render();
            this.opts.onChange();
          },
        );
      }
    });

    if (!port.atSea) {
      field("Country", (input) => {
        input.type = "text";
        input.value = port.country;
        input.placeholder = "Mexico";
        input.addEventListener("input", () => {
          port.country = input.value.trim();
          this.opts.onChange();
        });
        new CountrySuggest(this.opts.app, input, (value) => {
          port.country = value;
          this.render();
          this.opts.onChange();
        });
      });

      field("Arrives", (input) => {
        input.type = "time";
        input.value = port.arrives;
        input.setAttribute("aria-label", "Time the ship docks. Empty on the day you board.");
        input.addEventListener("change", () => {
          port.arrives = input.value;
          this.render();
          this.opts.onChange();
        });
      });

      field("Departs", (input) => {
        input.type = "time";
        input.value = port.departs;
        input.setAttribute("aria-label", "Time the ship sails. Empty on the day you get off.");
        input.addEventListener("change", () => {
          port.departs = input.value;
          this.render();
          this.opts.onChange();
        });
      });
    }

    // Last, and always present: turning a row into a sea day is how you fix a
    // row you added as the wrong kind, and hunting for the right button to
    // delete and re-add it is worse.
    const toggle = box.createDiv({ cls: "awty-leg-toggle" });
    const check = toggle.createEl("input", { attr: { type: "checkbox" } });
    check.checked = port.atSea;
    check.id = `awty-port-sea-${index}`;
    check.addEventListener("change", () => {
      port.atSea = check.checked;
      if (port.atSea) {
        // Times and a country describe being alongside somewhere. Kept on a sea
        // day they would sit in the note claiming the ship docked.
        port.arrives = "";
        port.departs = "";
        port.country = "";
      }
      this.render();
      this.opts.onChange();
    });
    toggle.createEl("label", { text: "A day at sea", attr: { for: check.id } });
  }
}
