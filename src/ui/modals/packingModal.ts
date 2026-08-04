import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
import { keepOpenOnBackgroundClick } from "../modalUtils";
import type { Trip } from "../../types";
import { kindDef } from "../../types";
import { readPackingExtras, buildPackingPlan, type AnchoredProse } from "../../store/packing";
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
  /** Names selected to pack for; empty means just you. */
  private packFor: Set<string>;
  /** Generated items deliberately unticked, remembered on the note. */
  private excluded = new Set<string>();
  private saveBtn: ButtonComponent | null = null;
  private listEl!: HTMLElement;
  private summaryEl!: HTMLElement;

  constructor(
    app: App,
    private trip: Trip,
    private onSaved: () => void,
  ) {
    super(app);
    this.packFor = new Set(trip.travellers);
  }

  async onOpen(): Promise<void> {
    keepOpenOnBackgroundClick(this);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("awty-modal", "awty-packing");
    this.modalEl.addClass("awty-modal-shell");

    contentEl.createEl("h2", { text: "Packing list", cls: "awty-modal-title" });
    const def = kindDef(this.trip.kind);
    const days = def.singleDay ? 1 : daysBetween(this.trip.startDate, this.trip.endDate);
    contentEl.createDiv({
      cls: "awty-wizard-sub",
      text: `${this.trip.title} · ${days} day${days === 1 ? "" : "s"}`,
    });

    await this.buildRows(days);

    this.renderPackFor(contentEl);
    this.renderAddItem(contentEl);

    this.summaryEl = contentEl.createDiv({ cls: "awty-packing-summary" });
    this.listEl = contentEl.createDiv({ cls: "awty-packing-list" });
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
    const file = subNoteFile(this.app, this.trip, "packing");
    const fm = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
    this.excluded = new Set(
      (Array.isArray(fm?.packing_excluded) ? fm.packing_excluded : []).map((v: unknown) =>
        String(v).toLowerCase(),
      ),
    );
    const existing = await this.readExisting();

    for (const section of plan.sections) {
      for (const item of section.items) {
        const found = existing.get(item.label.toLowerCase());
        this.rows.push({
          section: section.title,
          label: item.label,
          quantity: item.quantity,
          // An item you unticked is absent from the note, which used to look
          // identical to one this trip had never generated — so it came back
          // ticked every time the modal was reopened. The exclusions are
          // recorded on the note instead.
          include: found ? found.present : !this.excluded.has(item.label.toLowerCase()),
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

  private get headcount(): number {
    return Math.max(1, this.packFor.size);
  }

  /** Who the list covers. Packing for yourself is not packing for the family. */
  private renderPackFor(parent: HTMLElement): void {
    const people = this.trip.travellers;
    if (people.length <= 1) return;

    const setting = new Setting(parent)
      .setName("Packing for")
      .setDesc("Clothing counts scale with who you tick. Toiletries and gear stay as one each.");
    setting.settingEl.addClass("awty-setting-stack");

    const row = setting.controlEl.createDiv({ cls: "awty-settings-subnotes" });
    for (const person of people) {
      const label = row.createEl("label", { cls: "awty-subnote" });
      const box = label.createEl("input");
      box.type = "checkbox";
      box.checked = this.packFor.has(person);
      label.createSpan({ text: person });
      box.addEventListener("change", () => {
        if (box.checked) this.packFor.add(person);
        else this.packFor.delete(person);
        this.renderList();
      });
    }
  }

  /** Nothing generated covers everything; this is the escape hatch. */
  private renderAddItem(parent: HTMLElement): void {
    const setting = new Setting(parent).setName("Add an item");
    let name = "";
    let section = "Misc";
    let quantity = "";

    setting.addText((t) => {
      t.setPlaceholder("Snorkel");
      t.onChange((v) => (name = v.trim()));
      t.inputEl.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter") {
          evt.preventDefault();
          add();
          t.setValue("");
        }
      });
    });
    setting.addDropdown((dd) => {
      for (const s of [...new Set(this.rows.map((r) => r.section))]) dd.addOption(s, s);
      dd.setValue(section);
      dd.onChange((v) => (section = v));
    });
    setting.addText((t) => {
      t.setPlaceholder("Qty");
      t.inputEl.type = "number";
      t.inputEl.min = "1";
      t.inputEl.style.width = "4.5em";
      t.onChange((v) => (quantity = v));
    });

    const add = () => {
      if (!name) return;
      const qty = Number(quantity);
      this.rows.push({
        section,
        label: name,
        quantity: Number.isFinite(qty) && qty > 0 ? qty : null,
        include: true,
        packed: false,
      });
      name = "";
      quantity = "";
      this.renderList();
    };

    setting.addButton((b) => b.setButtonText("Add").onClick(add));
  }

  /** Clothing scales with headcount; a tube of toothpaste does not. */
  private quantityFor(row: Row): number | null {
    if (row.quantity === null) return null;
    return row.section === "Clothes" ? row.quantity * this.headcount : row.quantity;
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

      this.listEl.createDiv({ cls: "awty-packing-section", text: section });
      for (const row of rows) {
        const line = this.listEl.createDiv({
          cls: `awty-packing-row${row.include ? "" : " is-excluded"}`,
        });

        const include = line.createEl("input", { cls: "awty-packing-include" });
        include.type = "checkbox";
        include.checked = row.include;
        include.setAttribute("aria-label", `Include ${row.label}`);
        include.addEventListener("change", () => {
          row.include = include.checked;
          this.renderList();
        });

        line.createSpan({ cls: "awty-packing-label", text: row.label });

        if (row.quantity !== null) {
          const qty = line.createEl("input", { cls: "awty-packing-qty" });
          qty.type = "number";
          qty.min = "1";
          qty.value = String(this.quantityFor(row) ?? 1);
          qty.addEventListener("change", () => {
            const value = Number(qty.value);
            if (Number.isFinite(value) && value > 0) {
              // Store the per-person figure so the multiplier stays meaningful.
              row.quantity = row.section === "Clothes" ? Math.max(1, Math.round(value / this.headcount)) : value;
            }
            this.renderList();
          });
        }

        if (row.packed) line.createSpan({ cls: "awty-packing-packed", text: "packed" });
      }
    }
  }

  private async save(): Promise<void> {
    this.saveBtn?.setDisabled(true).setButtonText("Saving…");
    try {
      const file = await ensureSubNote(this.app, this.trip, "packing");
      const included = this.rows.filter((r) => r.include);

      // The body is rebuilt from the tick boxes, so anything else written in
      // the note has to be carried over or it is destroyed on save.
      const content = await this.app.vault.read(file);
      const extras = readPackingExtras(content);

      const out: string[] = [`# Packing List — ${this.trip.title}`, ""];
      if (this.packFor.size > 1) {
        out.push(`> Quantities for ${[...this.packFor].join(", ")}.`, "");
      }
      if (extras.preamble.length) out.push(...extras.preamble, "");

      const sections = [...new Set(included.map((r) => r.section))];
      for (const section of sections) {
        out.push(`## ${section}`);
        const runs = extras.bySection.get(section) ?? [];
        const emitted = new Set<AnchoredProse>();
        const emit = (run: AnchoredProse) => {
          out.push("", ...run.lines, "");
          emitted.add(run);
        };

        // Prose written at the section's top goes back at the top.
        for (const run of runs) if (run.anchor === null) emit(run);

        // Each item, followed by whatever was written directly under it —
        // gathering all prose at the section's end moved an instruction away
        // from the item it was about.
        for (const row of included.filter((r) => r.section === section)) {
          const qty = this.quantityFor(row);
          out.push(`- [${row.packed ? "x" : " "}] ${row.label}${qty !== null ? ` ×${qty}` : ""}`);
          const key = row.label.trim().toLowerCase();
          for (const run of runs) if (run.anchor === key) emit(run);
        }

        // Prose anchored to an item that is gone still belongs to the section.
        for (const run of runs) if (!emitted.has(run)) emit(run);
        out.push("");
      }

      // A hand-written heading keeps its place even with every item unticked
      // or no items at all — vanishing headings read as lost notes.
      for (const [section, runs] of extras.bySection) {
        if (sections.includes(section)) continue;
        out.push(`## ${section}`, "");
        for (const run of runs) out.push(...run.lines, "");
      }

      // Frontmatter is preserved; only the body below it is rewritten.
      const fmEnd = content.startsWith("---") ? content.indexOf("\n---", 3) : -1;
      const head = fmEnd === -1 ? "" : `${content.slice(0, fmEnd + 4)}\n\n`;
      await this.app.vault.modify(file, head + out.join("\n"));

      const excluded = this.rows.filter((r) => !r.include).map((r) => r.label);
      await this.app.fileManager.processFrontMatter(file, (front) => {
        if (excluded.length) front.packing_excluded = excluded;
        else delete front.packing_excluded;
      });

      new Notice(`Packing list saved — ${included.length} items.`);
      this.onSaved();
      this.close();
    } catch (err) {
      new Notice(err instanceof Error ? err.message : "Could not save the packing list.");
      console.error("[awty]", err);
      this.saveBtn?.setDisabled(false).setButtonText("Save list");
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
