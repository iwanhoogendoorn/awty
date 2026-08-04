import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import type { Trip } from "../../types";
import { kindDef } from "../../types";
import { buildPackingPlan } from "../../store/packing";
import { ensureSubNote, subNoteFile } from "../../store/sectionWriter";
import { daysBetween } from "../../util/dates";

interface Row {
  section: string;
  label: string;
  quantity: number | null;
  include: boolean;
  packed: boolean;
}

/**
 * GUI editor for the packing list.
 *
 * Merges the calculated plan with whatever is already in the note, so
 * re-running it never unticks something you have already packed or throws away
 * an item you added yourself.
 */
export class PackingModal extends Modal {
  private rows: Row[] = [];
  /** Defaults to who is actually on the trip. */
  private travellers: number;
  private saveBtn: ButtonComponent | null = null;
  private listEl!: HTMLElement;
  private summaryEl!: HTMLElement;

  constructor(
    app: App,
    private trip: Trip,
    private onSaved: () => void,
  ) {
    super(app);
    this.travellers = Math.min(4, Math.max(1, trip.travellers.length || 1));
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-modal", "tp-packing");
    this.modalEl.addClass("tp-modal-shell");

    contentEl.createEl("h2", { text: "Packing list", cls: "tp-modal-title" });
    const def = kindDef(this.trip.kind);
    const days = def.singleDay ? 1 : daysBetween(this.trip.startDate, this.trip.endDate);
    contentEl.createDiv({
      cls: "tp-wizard-sub",
      text: `${this.trip.title} · ${days} day${days === 1 ? "" : "s"}`,
    });

    await this.buildRows(days);

    new Setting(contentEl)
      .setName("Travelling as")
      .setDesc("Multiplies the clothing counts. Toiletries and gear stay as one each.")
      .addDropdown((dd) => {
        for (const n of [1, 2, 3, 4]) dd.addOption(String(n), n === 1 ? "1 person" : `${n} people`);
        dd.setValue(String(this.travellers));
        dd.onChange((v) => {
          this.travellers = Number(v);
          this.renderList();
        });
      });

    this.summaryEl = contentEl.createDiv({ cls: "tp-packing-summary" });
    this.listEl = contentEl.createDiv({ cls: "tp-packing-list" });
    this.renderList();

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => {
        this.saveBtn = b;
        b.setButtonText("Save list").setCta().onClick(() => void this.save());
      });
  }

  /** Calculated plan, overlaid with what the note already says. */
  private async buildRows(days: number): Promise<void> {
    const plan = buildPackingPlan(days, this.trip.kind);
    const existing = await this.readExisting();

    for (const section of plan.sections) {
      for (const item of section.items) {
        const found = existing.get(item.label.toLowerCase());
        this.rows.push({
          section: section.title,
          label: item.label,
          quantity: item.quantity,
          include: found ? found.present : true,
          packed: found?.packed ?? false,
        });
      }
    }

    // Anything hand-added to the note survives a re-run.
    const known = new Set(this.rows.map((r) => r.label.toLowerCase()));
    for (const [key, value] of existing) {
      if (known.has(key)) continue;
      this.rows.push({
        section: value.section,
        label: value.label,
        quantity: value.quantity,
        include: true,
        packed: value.packed,
      });
    }
  }

  private async readExisting(): Promise<
    Map<string, { label: string; section: string; quantity: number | null; packed: boolean; present: boolean }>
  > {
    const out = new Map<
      string,
      { label: string; section: string; quantity: number | null; packed: boolean; present: boolean }
    >();
    const file = subNoteFile(this.app, this.trip, "packing");
    if (!file) return out;

    const content = await this.app.vault.cachedRead(file);
    let section = "Misc";
    for (const raw of content.split("\n")) {
      const line = raw.trim();
      const headingMatch = /^##\s+(.+)$/.exec(line);
      if (headingMatch) {
        section = headingMatch[1].trim();
        continue;
      }
      const task = /^[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
      if (!task) continue;
      const packed = task[1].toLowerCase() === "x";
      const text = task[2].trim();
      const qtyMatch = /^(.*?)\s*×\s*(\d+)$/.exec(text);
      const label = (qtyMatch ? qtyMatch[1] : text).trim();
      if (!label) continue;
      out.set(label.toLowerCase(), {
        label,
        section,
        quantity: qtyMatch ? Number(qtyMatch[2]) : null,
        packed,
        present: true,
      });
    }
    return out;
  }

  /** Clothing scales with headcount; a tube of toothpaste does not. */
  private quantityFor(row: Row): number | null {
    if (row.quantity === null) return null;
    return row.section === "Clothes" ? row.quantity * this.travellers : row.quantity;
  }

  private renderList(): void {
    this.listEl.empty();

    const included = this.rows.filter((r) => r.include);
    this.summaryEl.setText(
      `${included.length} items · ${included.filter((r) => r.packed).length} already packed`,
    );

    const sections = [...new Set(this.rows.map((r) => r.section))];
    for (const section of sections) {
      const rows = this.rows.filter((r) => r.section === section);
      if (rows.length === 0) continue;

      this.listEl.createDiv({ cls: "tp-packing-section", text: section });
      for (const row of rows) {
        const line = this.listEl.createDiv({
          cls: `tp-packing-row${row.include ? "" : " is-excluded"}`,
        });

        const include = line.createEl("input", { cls: "tp-packing-include" });
        include.type = "checkbox";
        include.checked = row.include;
        include.setAttribute("aria-label", `Include ${row.label}`);
        include.addEventListener("change", () => {
          row.include = include.checked;
          this.renderList();
        });

        line.createSpan({ cls: "tp-packing-label", text: row.label });

        if (row.quantity !== null) {
          const qty = line.createEl("input", { cls: "tp-packing-qty" });
          qty.type = "number";
          qty.min = "1";
          qty.value = String(this.quantityFor(row) ?? 1);
          qty.addEventListener("change", () => {
            const value = Number(qty.value);
            if (Number.isFinite(value) && value > 0) {
              // Store the per-person figure so the multiplier stays meaningful.
              row.quantity = row.section === "Clothes" ? Math.max(1, Math.round(value / this.travellers)) : value;
            }
            this.renderList();
          });
        }

        if (row.packed) line.createSpan({ cls: "tp-packing-packed", text: "packed" });
      }
    }
  }

  private async save(): Promise<void> {
    this.saveBtn?.setDisabled(true).setButtonText("Saving…");
    try {
      const file = await ensureSubNote(this.app, this.trip, "packing");
      const included = this.rows.filter((r) => r.include);

      const out: string[] = [`# Packing List — ${this.trip.title}`, ""];
      if (this.travellers > 1) out.push(`> Quantities for ${this.travellers} people.`, "");

      for (const section of [...new Set(included.map((r) => r.section))]) {
        out.push(`## ${section}`);
        for (const row of included.filter((r) => r.section === section)) {
          const qty = this.quantityFor(row);
          out.push(`- [${row.packed ? "x" : " "}] ${row.label}${qty !== null ? ` ×${qty}` : ""}`);
        }
        out.push("");
      }

      // Frontmatter is preserved; only the body below it is rewritten.
      const content = await this.app.vault.read(file);
      const fmEnd = content.startsWith("---") ? content.indexOf("\n---", 3) : -1;
      const head = fmEnd === -1 ? "" : `${content.slice(0, fmEnd + 4)}\n\n`;
      await this.app.vault.modify(file, head + out.join("\n"));

      new Notice(`Packing list saved — ${included.length} items.`);
      this.onSaved();
      this.close();
    } catch (err) {
      new Notice(err instanceof Error ? err.message : "Could not save the packing list.");
      console.error("[travel-planner]", err);
      this.saveBtn?.setDisabled(false).setButtonText("Save list");
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
