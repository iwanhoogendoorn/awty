import { App, ButtonComponent, Modal, Notice, Setting, setIcon } from "obsidian";
import { keepOpenOnBackgroundClick } from "../modalUtils";
import type { Trip } from "../../types";
import type { Moment } from "../../trips/moments";
import { emptyMoment, keepMoments, liftTitle, orderMoments } from "../../trips/moments";
import { datesInRange, formatDateRange, formatDayLabel, isValidISODate } from "../../util/dates";

/**
 * What you want to remember about a trip.
 *
 * One box per moment and nothing else to fill in, because this gets written on
 * the evening you get home with the suitcase still in the hall — and a form
 * that asks six questions on that evening is a form that stays empty. The day
 * is a dropdown of the trip's own dates rather than a date picker: you are
 * remembering, not scheduling, and "Thursday" is how anybody thinks of it.
 */
export class MomentsModal extends Modal {
  private moments: Moment[];
  private saveBtn: ButtonComponent | null = null;
  private listEl!: HTMLElement;
  private submitting = false;
  /** How many titles were pulled out of their own text, so it can be said. */
  private lifted = 0;

  constructor(
    app: App,
    private trip: Trip,
    /**
     * A day to land on: the one whose "+" was pressed, or whose memory was
     * clicked. Opening a list of fifteen and leaving somebody to find the right
     * one is the difference between a note that gets written and one that does
     * not.
     */
    private focusDate: string,
    private onSubmit: (moments: Moment[]) => Promise<void>,
    /**
     * The days to offer. Handed in rather than worked out here, because the
     * trip's own two dates are not the days it covers — a booking that runs
     * past the end adds days, and the journey home is worth remembering.
     */
    private tripDays: string[] = [],
  ) {
    super(app);
    // Openings with nothing in them still get a row: an empty panel with an
    // "add" button asks you to do two things before you can type.
    const saved = trip.moments.length > 0 ? orderMoments(trip.moments) : [emptyMoment()];
    // A title typed as the first bold line of the story gets offered in the box
    // it belongs in. On screen, and written only if you press Save.
    this.moments = saved.map((moment) => {
      const lifted = liftTitle(moment);
      if (lifted) this.lifted += 1;
      return lifted ?? { ...moment };
    });
  }

  /**
   * The row to start on, adding one for the day if it has none yet.
   *
   * Coming from a day means you have something to say about that day; the box
   * should be open and empty rather than somewhere in a list to be found.
   */
  private focusIndex(): number {
    if (!this.focusDate) return -1;
    const found = this.moments.findIndex((moment) => moment.date === this.focusDate && !moment.text);
    if (found >= 0) return found;
    const existing = this.moments.findIndex((moment) => moment.date === this.focusDate);
    if (existing >= 0) return existing;
    // Drop the untouched starter row rather than leaving a blank above the one
    // that was actually asked for.
    if (this.moments.length === 1 && !this.moments[0].text && !this.moments[0].date) {
      this.moments = [];
    }
    this.moments.push(emptyMoment(this.focusDate));
    return this.moments.length - 1;
  }

  onOpen(): void {
    keepOpenOnBackgroundClick(this);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("awty-modal", "awty-wizard");
    this.modalEl.addClass("awty-modal-shell");

    const head = contentEl.createDiv({ cls: "awty-wizard-head" });
    setIcon(head.createDiv({ cls: "awty-wizard-icon" }), "sparkles");
    const headText = head.createDiv();
    headText.createDiv({ cls: "awty-modal-title", text: "Moments" });
    headText.createDiv({
      cls: "awty-wizard-sub",
      text: `${this.trip.title} · ${formatDateRange(this.trip.startDate, this.trip.endDate)}`,
    });

    contentEl.createDiv({
      cls: "awty-date-readout",
      text: "The things you would be sorry to forget. A day is optional — some of it belongs to the whole trip. Line breaks and markdown are kept.",
    });
    if (this.lifted > 0) {
      contentEl.createDiv({
        cls: "awty-date-outside",
        text:
          this.lifted === 1
            ? "Took the bold first line as the title. Put it back in the text if that is wrong."
            : `Took the bold first line of ${this.lifted} of these as their titles.`,
      });
    }

    this.listEl = contentEl.createDiv();
    const focus = this.focusIndex();
    this.renderList();
    if (focus >= 0) {
      // Deferred: the modal takes focus for itself as it opens, and a focus
      // set during onOpen is overwritten a tick later — the cursor ended up in
      // the day picker of the wrong row.
      window.setTimeout(() => {
        const box = this.listEl.querySelectorAll<HTMLElement>(".awty-moment-box")[focus];
        box?.scrollIntoView({ block: "center" });
        box?.querySelector<HTMLTextAreaElement>(".awty-moment-text")?.focus();
      }, 0);
    }

    // Written with two hands on the keyboard; reaching for the mouse to finish
    // a paragraph is the wrong ending.
    contentEl.addEventListener("keydown", (evt) => {
      if ((evt.metaKey || evt.ctrlKey) && evt.key === "Enter") {
        evt.preventDefault();
        void this.submit();
      }
    });

    const nav = new Setting(contentEl).setClass("awty-wizard-nav");
    nav
      .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((btn) => {
        this.saveBtn = btn;
        btn
          .setButtonText("Save")
          .setTooltip("⌘↵")
          .setCta()
          .onClick(() => void this.submit());
      });
  }

  private renderList(): void {
    this.listEl.empty();
    this.listEl.addClass("awty-moments");

    for (const [index, moment] of this.moments.entries()) this.renderMoment(moment, index);

    const row = this.listEl.createDiv({ cls: "awty-leg-adds" });
    const add = row.createEl("button", { cls: "awty-leg-add" });
    add.type = "button";
    setIcon(add.createSpan(), "plus");
    add.createSpan({ text: "Add a moment" });
    add.addEventListener("click", () => {
      this.moments.push(emptyMoment());
      this.renderList();
      // Straight into the new box, because the only reason you pressed that
      // button was to type.
      const boxes = this.listEl.querySelectorAll("textarea");
      (boxes[boxes.length - 1] as HTMLTextAreaElement | undefined)?.focus();
    });
  }

  private renderMoment(moment: Moment, index: number): void {
    const box = this.listEl.createDiv({ cls: "awty-moment-box" });

    const head = box.createDiv({ cls: "awty-leg-head" });
    const day = box.createDiv();

    const picker = head.createEl("select", { cls: "awty-moment-day" });
    picker.createEl("option", { value: "", text: "The whole trip" });
    // The trip's own days, named. Nothing outside them: a moment on a date the
    // trip does not cover is a moment on somebody else's holiday.
    const days =
      this.tripDays.length > 0
        ? this.tripDays
        : isValidISODate(this.trip.startDate) && isValidISODate(this.trip.endDate)
          ? datesInRange(this.trip.startDate, this.trip.endDate)
          : [];
    for (const date of days) picker.createEl("option", { value: date, text: formatDayLabel(date) });
    // A date written before the trip's own dates moved still has to be
    // offerable, or reopening the form would silently reassign it.
    if (moment.date && !days.includes(moment.date)) {
      picker.createEl("option", { value: moment.date, text: formatDayLabel(moment.date) });
    }
    picker.value = moment.date;
    picker.addEventListener("change", () => (moment.date = picker.value));

    if (this.moments.length > 1) {
      const remove = head.createEl("button", { cls: "awty-icon-btn" });
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove moment ${index + 1}`);
      setIcon(remove, "x");
      remove.addEventListener("click", () => {
        this.moments.splice(index, 1);
        this.renderList();
      });
    }

    // Above the story, because that is the order you think of them in — and
    // because without a box for it the title ends up as the first bold line of
    // the text, where nothing can pick it out to fold the rest away under.
    const title = day.createEl("input", { cls: "awty-moment-title" });
    title.type = "text";
    title.value = moment.title;
    title.placeholder = "Title — optional, but it is what the list shows";
    title.addEventListener("input", () => (moment.title = title.value.trim()));

    const text = day.createEl("textarea", { cls: "awty-moment-text" });
    text.value = moment.text;
    // Room to write, and room to see what you pasted. A two-line box says "one
    // line please", and the whole point of a title is that some of these are
    // not one line — one of them ran to nine hundred words.
    text.rows = moment.text.length > 600 ? 16 : moment.text.length > 200 ? 10 : 4;
    text.placeholder =
      "Zaara fell asleep on the deck coming back from Lopud.\n\nWrite as much as you like — line breaks and **markdown** are kept.";
    text.addEventListener("input", () => (moment.text = text.value));
  }

  private async submit(): Promise<void> {
    if (this.submitting) return;
    const kept = keepMoments(this.moments);
    // Saving nothing is allowed — it is how you clear the last one — but doing
    // it by accident should not pass without a word.
    if (kept.length === 0 && this.trip.moments.length > 0) {
      new Notice("That empties the list. Press Save again if you meant it.", 6000);
      this.trip.moments = [];
      return;
    }

    this.submitting = true;
    this.saveBtn?.setDisabled(true).setButtonText("Saving…");
    try {
      await this.onSubmit(orderMoments(kept));
      this.close();
    } catch (err) {
      new Notice(err instanceof Error ? err.message : "Could not save the moments.");
      console.error("[awty]", err);
      this.submitting = false;
      this.saveBtn?.setDisabled(false).setButtonText("Save");
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
