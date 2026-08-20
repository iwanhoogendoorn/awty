import { setIcon } from "obsidian";
import type { Ride } from "../../bookings/rides";
import { RIDE_SERVICES, emptyRide, ridesTotal } from "../../bookings/rides";
import { formatMoney, parseAmount } from "../../util/money";

export interface RidesFieldOptions {
  container: HTMLElement;
  rides: Ride[];
  /** Where the first row starts, when there is nothing to go on. */
  defaultDate: string;
  currency: () => string;
  onChange: () => void;
}

/**
 * Editor for a trip's taxis, one row each.
 *
 * Built for a person sitting down with a phone full of receipts, not for
 * somebody on a kerb: adding a row keeps the service and the date rather than
 * clearing them, because eleven rides are usually the same app across a few
 * days, and retyping "Uber" eleven times is how the eleventh never gets logged.
 *
 * The total is shown as you type. It is the number that reaches the budget, so
 * seeing it move is the only check that the rows above it are right.
 */
export class RidesField {
  private rides: Ride[];

  constructor(private opts: RidesFieldOptions) {
    this.rides = opts.rides.length > 0 ? opts.rides : [emptyRide(opts.defaultDate)];
    this.render();
  }

  getRides(): Ride[] {
    return this.rides;
  }

  private render(): void {
    const { container } = this.opts;
    container.empty();
    container.addClass("awty-rides");

    for (const [index, ride] of this.rides.entries()) this.renderRide(container, ride, index);

    const row = container.createDiv({ cls: "awty-leg-adds" });
    const add = row.createEl("button", { cls: "awty-leg-add" });
    add.type = "button";
    setIcon(add.createSpan(), "plus");
    add.createSpan({ text: "Add a ride" });
    add.addEventListener("click", () => this.add());

    // The number that reaches the budget, in the place you are typing into.
    const total = container.createDiv({ cls: "awty-rides-total" });
    const priced = this.rides.filter((r) => r.amount !== null && r.amount > 0).length;
    total.createSpan({
      cls: "awty-rides-count",
      text: priced === 0 ? "Nothing priced yet" : `${priced} ride${priced === 1 ? "" : "s"}`,
    });
    total.createSpan({
      cls: "awty-rides-sum",
      text: formatMoney({ amount: ridesTotal(this.rides), currency: this.opts.currency() }),
    });
  }

  /**
   * Another row, carrying the last one's service and day forward.
   *
   * A blank row every time is right for a thing you book once and wrong for a
   * list: the second Uber of a trip is nearly always the same app, often the
   * same day, and starting from the last row means most rides need only their
   * price typed.
   */
  private add(): void {
    const previous = this.rides[this.rides.length - 1];
    const next = emptyRide(previous?.date || this.opts.defaultDate, previous?.service ?? "");
    this.rides.push(next);
    this.render();
    this.opts.onChange();
  }

  private renderRide(parent: HTMLElement, ride: Ride, index: number): void {
    const box = parent.createDiv({ cls: "awty-leg-box" });

    const head = box.createDiv({ cls: "awty-leg-head" });
    head.createSpan({ cls: "awty-leg-title", text: `Ride ${index + 1}` });
    const trip = [ride.from, ride.to].filter(Boolean).join(" → ");
    if (trip) head.createSpan({ cls: "awty-leg-note", text: trip });

    if (this.rides.length > 1) {
      const remove = head.createEl("button", { cls: "awty-icon-btn" });
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ride ${index + 1}`);
      setIcon(remove, "x");
      remove.addEventListener("click", () => {
        this.rides.splice(index, 1);
        this.render();
        this.opts.onChange();
      });
    }

    const grid = box.createDiv({ cls: "awty-leg-grid" });
    const field = (label: string, build: (input: HTMLInputElement) => void): void => {
      const wrap = grid.createDiv({ cls: "awty-leg-field" });
      wrap.createDiv({ cls: "awty-leg-label", text: label });
      build(wrap.createEl("input", { cls: "awty-leg-input" }));
    };

    field("Date", (input) => {
      input.type = "date";
      input.value = ride.date;
      // No min or max. These are logged after the fact, and the last day of a
      // trip is exactly when somebody sits down to do it.
      input.addEventListener("change", () => {
        ride.date = input.value;
        this.opts.onChange();
      });
    });

    field("Service", (input) => {
      input.type = "text";
      input.value = ride.service;
      input.placeholder = "Uber";
      // A short list of the usual apps, and a plain box for the local firm
      // whose name is only on the receipt.
      input.setAttribute("list", "awty-ride-services");
      input.addEventListener("input", () => {
        ride.service = input.value.trim();
        this.opts.onChange();
      });
    });

    field("From", (input) => {
      input.type = "text";
      input.value = ride.from;
      input.placeholder = "Airport";
      input.addEventListener("input", () => {
        ride.from = input.value.trim();
        this.opts.onChange();
      });
    });

    field("To", (input) => {
      input.type = "text";
      input.value = ride.to;
      input.placeholder = "Hotel";
      input.addEventListener("input", () => {
        ride.to = input.value.trim();
        this.opts.onChange();
      });
    });

    field(`Cost (${this.opts.currency()})`, (input) => {
      input.type = "text";
      input.inputMode = "decimal";
      input.value = ride.amount === null ? "" : String(ride.amount);
      input.placeholder = "24,50";
      input.addEventListener("input", () => {
        // Empty is "not filled in yet", not zero: a row worth nothing and a row
        // you have not got to are different, and only one belongs in a total.
        ride.amount = input.value.trim() ? (parseAmount(input.value) ?? null) : null;
        this.repaintTotal();
        this.opts.onChange();
      });
    });

    // One datalist for the whole field, not one per row.
    if (index === 0 && !parent.querySelector("#awty-ride-services")) {
      const list = parent.createEl("datalist");
      list.id = "awty-ride-services";
      for (const service of RIDE_SERVICES) list.createEl("option", { value: service });
    }
  }

  /**
   * The total, without redrawing the rows.
   *
   * A full re-render on every keystroke would take the focus out of the box
   * being typed into, which is unusable — so the one thing that changes is the
   * one thing repainted.
   */
  private repaintTotal(): void {
    const priced = this.rides.filter((r) => r.amount !== null && r.amount > 0).length;
    const count = this.opts.container.querySelector(".awty-rides-count");
    const sum = this.opts.container.querySelector(".awty-rides-sum");
    if (count) {
      count.setText(priced === 0 ? "Nothing priced yet" : `${priced} ride${priced === 1 ? "" : "s"}`);
    }
    if (sum) {
      sum.setText(formatMoney({ amount: ridesTotal(this.rides), currency: this.opts.currency() }));
    }
  }
}
