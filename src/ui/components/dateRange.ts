import {
  addDays,
  daysBetween,
  endDateForDuration,
  formatDuration,
  isValidISODate,
  parseISO,
  todayISO,
} from "../../util/dates";

/** Shortcut lengths offered under the date fields, in inclusive days. */
const DURATIONS = [1, 2, 3, 4, 5, 7, 10, 14, 21];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekday(iso: string): string {
  const date = parseISO(iso);
  return date ? WEEKDAYS[date.getUTCDay()] : "";
}

export interface DateRangeValue {
  startDate: string;
  endDate: string;
}

/**
 * Start/end pickers plus duration shortcuts.
 *
 * Uses native `<input type="date">`, which Obsidian renders with the platform
 * calendar widget — 1.x asked you to type "YYYY-MM-DD" into a plain text box and
 * silently accepted whatever you typed.
 */
export class DateRangeField {
  private startInput!: HTMLInputElement;
  private endInput!: HTMLInputElement;
  private endRow!: HTMLElement;
  private chipRow!: HTMLElement;
  private readout!: HTMLElement;
  private chips = new Map<number, HTMLElement>();
  private singleDay = false;

  private startDate: string;
  private endDate: string;

  constructor(
    private container: HTMLElement,
    initial: Partial<DateRangeValue>,
    private onChange: (value: DateRangeValue) => void,
  ) {
    this.startDate = isValidISODate(initial.startDate ?? "") ? initial.startDate! : todayISO();
    this.endDate = isValidISODate(initial.endDate ?? "") ? initial.endDate! : this.startDate;
    this.render();
  }

  private render(): void {
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
        text: days === 1 ? "1 day" : `${days}d`,
      });
      chip.type = "button";
      chip.addEventListener("click", () => this.applyDuration(days));
      this.chips.set(days, chip);
    }

    this.readout = wrap.createDiv({ cls: "tp-date-readout" });

    this.startInput.addEventListener("change", () => {
      const next = this.startInput.value;
      if (!isValidISODate(next)) return;
      // Moving the start date drags the trip along rather than resizing it.
      const length = daysBetween(this.startDate, this.endDate);
      this.startDate = next;
      this.endDate = this.singleDay ? next : endDateForDuration(next, length);
      this.sync();
    });

    this.endInput.addEventListener("change", () => {
      const next = this.endInput.value;
      if (!isValidISODate(next)) return;
      // An end before the start is a typo, not an intent; nudge it to the start.
      this.endDate = next < this.startDate ? this.startDate : next;
      this.sync();
    });

    this.sync(false);
  }

  private applyDuration(days: number): void {
    this.endDate = endDateForDuration(this.startDate, days);
    this.sync();
  }

  private sync(emit = true): void {
    if (this.singleDay) this.endDate = this.startDate;
    this.startInput.value = this.startDate;
    this.endInput.value = this.endDate;
    // Never let the picker offer an end before the start.
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
        `${formatDuration(this.startDate, this.endDate)} · ${start} → ${end}`,
      );
    }

    if (emit) this.onChange(this.getValue());
  }

  /** Concerts and day trips collapse to a single date. */
  setSingleDay(singleDay: boolean): void {
    this.singleDay = singleDay;
    this.endRow.toggleClass("is-hidden", singleDay);
    this.chipRow.toggleClass("is-hidden", singleDay);
    this.sync();
  }

  /** Pre-selects a length when the kind changes, without moving the start date. */
  suggestDuration(days: number): void {
    if (this.singleDay) return;
    this.endDate = endDateForDuration(this.startDate, days);
    this.sync();
  }

  getValue(): DateRangeValue {
    return {
      startDate: this.startDate,
      endDate: this.singleDay ? this.startDate : this.endDate,
    };
  }

  setValue(value: DateRangeValue): void {
    if (isValidISODate(value.startDate)) this.startDate = value.startDate;
    if (isValidISODate(value.endDate)) this.endDate = value.endDate;
    if (this.endDate < this.startDate) this.endDate = this.startDate;
    this.sync(false);
  }

  focus(): void {
    this.startInput.focus();
  }

  /** Shifts the whole range by a number of days. */
  shift(days: number): void {
    this.startDate = addDays(this.startDate, days);
    this.endDate = addDays(this.endDate, days);
    this.sync();
  }
}
