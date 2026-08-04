import type { CostCategory, CostLine } from "./types";
import type { Money } from "./types";
import { formatMoney } from "../util/money";

/**
 * The Budget note, written from what the plugin actually knows.
 *
 * Setting targets writes `budget:` onto the trip note and every price lives on
 * its own booking, so nothing ever filled the Budget note's own tables. It sat
 * at "Not started" no matter how much of the trip was budgeted and spent —
 * the one note whose card could never be satisfied by using the plugin.
 */
export function budgetPlanTable(
  budget: Map<CostCategory, number>,
  lines: CostLine[],
  currency: string,
): string {
  const categories = [...new Set([...budget.keys(), ...lines.map((l) => l.category)])].sort();
  if (categories.length === 0) {
    return "_No budget set yet, and nothing costed. Use Set targets._";
  }

  const spentIn = (category: CostCategory): number =>
    lines
      .filter((l) => l.counted && l.category === category && l.money.currency === currency)
      .reduce((n, l) => n + l.money.amount, 0);

  const money = (amount: number): string => formatMoney({ amount, currency } as Money);
  const rows = categories.map((category) => {
    const target = budget.get(category) ?? 0;
    const spent = spentIn(category);
    const left = target > 0 ? money(target - spent) : "";
    return `| ${category} | ${target > 0 ? money(target) : ""} | ${spent > 0 ? money(spent) : ""} | ${left} |`;
  });

  const totalTarget = [...budget.values()].reduce((n, v) => n + v, 0);
  const totalSpent = categories.reduce((n, c) => n + spentIn(c), 0);
  rows.push(
    `| **Total** | ${totalTarget > 0 ? `**${money(totalTarget)}**` : ""} | ${
      totalSpent > 0 ? `**${money(totalSpent)}**` : ""
    } | ${totalTarget > 0 ? `**${money(totalTarget - totalSpent)}**` : ""} |`,
  );

  return [
    "_Generated from your targets and your bookings — set targets or edit a booking to change a row._",
    "",
    "| Category | Budget | Spent | Left |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}

/** Every costed thing, so the note reads as a statement rather than a total. */
export function budgetLinesTable(lines: CostLine[]): string {
  if (lines.length === 0) return "_Nothing costed yet._";

  const rows = lines.map((line) => {
    const cells = [
      line.date,
      `[[${line.file.basename}]]`,
      line.description,
      line.category,
      formatMoney(line.money),
      line.counted ? "" : "cancelled",
    ];
    return `| ${cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`;
  });

  return [
    "_Generated from your bookings and expenses._",
    "",
    "| Date | Note | What | Category | Amount | |",
    "|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}
