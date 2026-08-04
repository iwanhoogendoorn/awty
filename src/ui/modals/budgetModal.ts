import { App, Modal, Notice, Setting } from "obsidian";
import { keepOpenOnBackgroundClick } from "../modalUtils";
import type { CostCategory } from "../../bookings/types";
import { COST_CATEGORIES, allCategories } from "../../bookings/types";
import type { Trip } from "../../types";
import { COMMON_CURRENCIES, formatMoney, parseAmount } from "../../util/money";

/** Budget targets per category, stored on the trip note's frontmatter. */
export class BudgetModal extends Modal {
  private values = new Map<CostCategory, number>();
  private total: number | null = null;
  private totalEl!: HTMLElement;

  constructor(
    app: App,
    private trip: Trip,
    existing: Map<CostCategory, number>,
    private currency: string,
    /** What the bookings and expenses already commit to, per category. */
    private actuals: Map<CostCategory, number>,
    /** Categories beyond the built-in set, and how to persist a new one. */
    /** Overall budget already set by hand, or null if only categories exist. */
    private explicitTotal: number | null,
    private custom: string[],
    private onAddCategory: (name: string) => Promise<void>,
    private onSave: (
      budget: Map<CostCategory, number>,
      currency: string,
      total: number | null,
    ) => Promise<void>,
  ) {
    super(app);
    this.values = new Map(existing);
    this.total = explicitTotal;
  }

  onOpen(): void {
    keepOpenOnBackgroundClick(this);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("awty-modal");
    contentEl.createEl("h2", { text: "Budget", cls: "awty-modal-title" });
    contentEl.createDiv({ cls: "awty-wizard-sub", text: this.trip.title });

    new Setting(contentEl)
      .setName("Budget for the whole trip")
      .setDesc("What you want the trip to cost in total. Leave blank to just add up the categories.")
      .addText((t) => {
        t.setPlaceholder("3000");
        t.setValue(this.total !== null ? String(this.total) : "");
        t.inputEl.inputMode = "decimal";
        t.onChange((v) => {
          const amount = parseAmount(v);
          this.total = amount !== null && amount > 0 ? amount : null;
          this.renderTotal();
        });
      });

    new Setting(contentEl)
      .setName("Currency")
      .setDesc("Used for this trip's budget and totals.")
      .addDropdown((dd) => {
        const options = new Set([this.currency, ...COMMON_CURRENCIES]);
        for (const c of options) dd.addOption(c, c);
        dd.setValue(this.currency);
        dd.onChange((v) => {
          this.currency = v;
          this.renderTotal();
        });
      });

    const categories = allCategories(this.custom, [
      ...this.values.keys(),
      ...this.actuals.keys(),
    ]);
    for (const category of categories) {
      const actual = this.actuals.get(category) ?? 0;
      const setting = new Setting(contentEl).setName(category);
      if (actual > 0) {
        setting.setDesc(
          `${formatMoney({ amount: actual, currency: this.currency })} already booked`,
        );
      }
      // Built-in categories are permanent; your own can be taken away again.
      if (!COST_CATEGORIES.includes(category as (typeof COST_CATEGORIES)[number])) {
        setting.addExtraButton((btn) =>
          btn
            .setIcon("x")
            .setTooltip(`Remove ${category}`)
            .onClick(async () => {
              this.values.delete(category);
              this.custom = this.custom.filter((c) => c !== category);
              await this.onAddCategory("");
              this.onOpen();
            }),
        );
      }

      setting.addText((t) => {
        const current = this.values.get(category);
        t.setPlaceholder(actual > 0 ? String(Math.ceil(actual)) : "0");
        t.setValue(current !== undefined ? String(current) : "");
        t.inputEl.inputMode = "decimal";
        t.onChange((v) => {
          const amount = parseAmount(v);
          if (amount === null || amount <= 0) this.values.delete(category);
          else this.values.set(category, amount);
          this.renderTotal();
        });
      });
    }

    // Starting from zero when the flights and hotel are already booked is
    // just data entry; this seeds each line from what is actually committed.
    if (this.values.size === 0 && this.actuals.size > 0) {
      const seed = contentEl.createEl("button", {
        cls: "awty-dash-add",
        text: "Start from what's already booked",
      });
      seed.addEventListener("click", () => {
        for (const [category, amount] of this.actuals) {
          if (amount > 0) this.values.set(category, Math.ceil(amount));
        }
        this.onOpen();
      });
    }

    // Nothing generated covers every trip; a wedding has categories a city
    // break does not.
    let newCategory = "";
    let newAmount = "";
    const addSetting = new Setting(contentEl).setName("Add a category");
    addSetting.addText((t) => {
      t.setPlaceholder("Car hire");
      t.onChange((v) => (newCategory = v.trim()));
      t.inputEl.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter") {
          evt.preventDefault();
          void addCategory();
        }
      });
    });
    addSetting.addText((t) => {
      t.setPlaceholder("0");
      t.inputEl.inputMode = "decimal";
      t.inputEl.style.width = "6em";
      t.onChange((v) => (newAmount = v));
    });

    const addCategory = async (): Promise<void> => {
      const name = newCategory.trim();
      if (!name) return;
      if (allCategories(this.custom).some((c) => c.toLowerCase() === name.toLowerCase())) {
        new Notice(`"${name}" already exists.`);
        return;
      }
      const amount = parseAmount(newAmount);
      if (amount !== null && amount > 0) this.values.set(name, amount);
      this.custom = [...this.custom, name];
      await this.onAddCategory(name);
      newCategory = "";
      newAmount = "";
      this.onOpen();
    };

    addSetting.addButton((b) => b.setButtonText("Add").onClick(() => void addCategory()));

    this.totalEl = contentEl.createDiv({ cls: "awty-budget-total" });
    this.renderTotal();

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText("Save budget")
          .setCta()
          .onClick(async () => {
            try {
              await this.onSave(new Map(this.values), this.currency, this.total);
              this.close();
            } catch (err) {
              new Notice(err instanceof Error ? err.message : "Could not save the budget.");
              console.error("[awty]", err);
            }
          }),
      );
  }

  private renderTotal(): void {
    const categories = [...this.values.values()].reduce((n, v) => n + v, 0);
    const money = (amount: number) => formatMoney({ amount, currency: this.currency });

    this.totalEl.empty();
    this.totalEl.createDiv({ text: `Categories add up to ${money(categories)}` });

    if (this.total === null) {
      this.totalEl.createDiv({
        cls: "awty-budget-note",
        text: "No overall budget set — the categories are the budget.",
      });
      return;
    }

    this.totalEl.createDiv({ text: `Budget for the trip: ${money(this.total)}` });
    // Categories that overshoot the overall figure are worth saying out loud
    // rather than leaving to be discovered later.
    const difference = categories - this.total;
    if (difference > 0) {
      this.totalEl.createDiv({
        cls: "awty-budget-note is-over",
        text: `Categories exceed the trip budget by ${money(difference)}.`,
      });
    } else if (difference < 0) {
      this.totalEl.createDiv({
        cls: "awty-budget-note",
        text: `${money(-difference)} of the trip budget is not allocated to a category.`,
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
