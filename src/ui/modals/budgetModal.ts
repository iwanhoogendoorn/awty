import { App, Modal, Notice, Setting } from "obsidian";
import type { CostCategory } from "../../bookings/types";
import { COST_CATEGORIES } from "../../bookings/types";
import type { Trip } from "../../types";
import { COMMON_CURRENCIES, formatMoney, parseAmount } from "../../util/money";

/** Budget targets per category, stored on the trip note's frontmatter. */
export class BudgetModal extends Modal {
  private values = new Map<CostCategory, number>();
  private totalEl!: HTMLElement;

  constructor(
    app: App,
    private trip: Trip,
    existing: Map<CostCategory, number>,
    private currency: string,
    private onSave: (budget: Map<CostCategory, number>, currency: string) => Promise<void>,
  ) {
    super(app);
    this.values = new Map(existing);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-modal");
    contentEl.createEl("h2", { text: "Budget", cls: "tp-modal-title" });
    contentEl.createDiv({ cls: "tp-wizard-sub", text: this.trip.title });

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

    const categories = new Set<string>([...COST_CATEGORIES, ...this.values.keys()]);
    for (const category of categories) {
      new Setting(contentEl).setName(category).addText((t) => {
        const current = this.values.get(category);
        t.setPlaceholder("0");
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

    this.totalEl = contentEl.createDiv({ cls: "tp-budget-total" });
    this.renderTotal();

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText("Save budget")
          .setCta()
          .onClick(async () => {
            try {
              await this.onSave(new Map(this.values), this.currency);
              this.close();
            } catch (err) {
              new Notice(err instanceof Error ? err.message : "Could not save the budget.");
              console.error("[travel-planner]", err);
            }
          }),
      );
  }

  private renderTotal(): void {
    const total = [...this.values.values()].reduce((n, v) => n + v, 0);
    this.totalEl.setText(`Total budget: ${formatMoney({ amount: total, currency: this.currency })}`);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
