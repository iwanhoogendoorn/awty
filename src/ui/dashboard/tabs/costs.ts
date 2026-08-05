import { setIcon } from "obsidian";
import type { DashboardContext } from "../common";
import { bar, editItem, emptyState, itemMenu, renderToolbar, sectionTitle, statTiles, noTripState, touchMenuButton } from "../common";
import { isMobile } from "../../../util/platform";
import { totalsByCategory } from "../../../bookings/bookingStore";
import { allCategories } from "../../../bookings/types";
import { formatMoney, formatTotals, sumMoney, totalIn } from "../../../util/money";

/**
 * Costs are derived, never re-entered: every line here comes from a booking's
 * own price or from a logged expense.
 */
export function renderCosts(parent: HTMLElement, ctx: DashboardContext): void {
  const { trip, plugin } = ctx;
  if (!trip) {
    noTripState(parent, ctx, "wallet");
    return;
  }

  const lines = plugin.bookings.getCostLines(trip);
  const currency = plugin.bookings.getCurrency(trip);
  const budget = plugin.bookings.getBudget(trip);
  const budgetTotal = plugin.bookings.getBudgetTotal(trip);

  const actions = [
    {
      label: "Log an expense",
      icon: "receipt",
      onClick: () => plugin.openExpenseModal(trip),
    },
    {
      label: budget.size ? "Edit budget" : "Set a budget",
      icon: "sliders-horizontal",
      onClick: () => plugin.openBudgetModal(trip),
    },
  ];

  if (lines.length === 0 && budget.size === 0) {
    emptyState(
      parent,
      "wallet",
      "No costs yet",
      "Prices you enter on a flight or a hotel land here automatically. Anything else, log as an expense.",
      actions,
    );
    return;
  }

  renderToolbar(parent, actions);

  const counted = lines.filter((l) => l.counted);
  const spent = sumMoney(counted.map((l) => l.money));
  const spentPrimary = totalIn(spent, currency);
  const fromBookings = sumMoney(counted.filter((l) => l.source === "booking").map((l) => l.money));
  const fromExpenses = sumMoney(counted.filter((l) => l.source === "expense").map((l) => l.money));

  statTiles(parent, [
    { label: "Total cost", value: formatTotals(spent, formatMoney({ amount: 0, currency })), icon: "wallet" },
    {
      label: "Trip budget",
      value: budgetTotal > 0 ? formatMoney({ amount: budgetTotal, currency }) : "—",
      detail:
        budgetTotal > 0
          ? spentPrimary > budgetTotal
            ? `${formatMoney({ amount: spentPrimary - budgetTotal, currency })} over`
            : `${formatMoney({ amount: budgetTotal - spentPrimary, currency })} left`
          : "Not set",
      icon: "target",
      tone: budgetTotal > 0 && spentPrimary > budgetTotal ? "bad" : "good",
    },
    { label: "From bookings", value: formatTotals(fromBookings, "—"), icon: "ticket" },
    { label: "From expenses", value: formatTotals(fromExpenses, "—"), icon: "receipt" },
  ]);

  // ------------------------------------------------------- by category
  const byCategory = totalsByCategory(lines);
  const categories = allCategories(plugin.settings.customCategories, [
    ...byCategory.keys(),
    ...budget.keys(),
  ]);

  sectionTitle(parent, "Cost by category");
  const catWrap = parent.createDiv({ cls: "awty-budget-list" });
  let anyCategory = false;

  for (const category of categories) {
    const actual = byCategory.get(category)?.get(currency) ?? 0;
    const target = budget.get(category) ?? 0;
    if (actual === 0 && target === 0) continue;
    anyCategory = true;

    const ratio = target === 0 ? (spentPrimary === 0 ? 0 : actual / spentPrimary) : actual / target;
    const row = catWrap.createDiv({ cls: "awty-budget-row" });
    const head = row.createDiv({ cls: "awty-budget-head" });
    head.createSpan({ cls: "awty-budget-cat", text: category });
    head.createSpan({
      cls: `awty-budget-amount${target > 0 && actual > target ? " is-over" : ""}`,
      text:
        target > 0
          ? `cost ${formatMoney({ amount: actual, currency })} · budget ${formatMoney({ amount: target, currency })}`
          : `cost ${formatMoney({ amount: actual, currency })}`,
    });
    bar(row, ratio, target === 0 ? "good" : ratio > 1 ? "bad" : ratio > 0.9 ? "warn" : "good");
  }
  if (!anyCategory) catWrap.createDiv({ cls: "awty-dash-hint", text: "Nothing recorded yet." });

  // ------------------------------------------------------------ lines
  if (lines.length > 0) {
    sectionTitle(parent, "Every line");
    const list = parent.createDiv({ cls: "awty-cost-lines" });
    for (const line of lines) {
      const row = list.createDiv({ cls: `awty-cost-line${line.counted ? "" : " is-excluded"}` });
      setIcon(
        row.createDiv({ cls: "awty-cost-icon" }),
        line.source === "booking" ? "ticket" : "receipt",
      );
      const body = row.createDiv({ cls: "awty-cost-body" });
      body.createDiv({ cls: "awty-cost-desc", text: line.description });
      body.createDiv({
        cls: "awty-cost-meta",
        text: [line.date, line.category, line.counted ? "" : "cancelled"]
          .filter(Boolean)
          .join(" · "),
      });
      row.createDiv({ cls: "awty-cost-amount", text: formatMoney(line.money) });
      row.addEventListener("click", () => {
        if (!editItem(ctx, line.file)) ctx.openFile(line.file);
      });
      // Neither half of that sentence is true on a phone — a title tooltip
      // never renders on touch and there is no right-click. overview.ts:222
      // already branches its equivalent string; this one had been missed.
      row.setAttribute(
        "title",
        isMobile() ? "Tap to edit, or the ⋮ button for more" : "Click to edit, right-click for more",
      );
      row.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        itemMenu(evt, ctx, line.file, line.description);
      });
      touchMenuButton(row, `Actions for ${line.description}`, (evt) =>
        itemMenu(evt, ctx, line.file, line.description),
      );
    }
  }
}
