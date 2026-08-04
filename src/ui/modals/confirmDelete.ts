import { App, Modal, Setting } from "obsidian";
import type { Trip } from "../../types";
import { describeDeletion, tripDeletionTargets } from "../../store/noteWriter";
import { formatDateRange } from "../../util/dates";

/**
 * Deletion confirmation.
 *
 * Names every file that will go, because a trip folder can quietly accumulate
 * notes and photos that were never part of the template. Files go to whatever
 * the vault's "Deleted files" setting points at, so this is recoverable unless
 * the user has chosen permanent deletion themselves.
 */
export class ConfirmDeleteModal extends Modal {
  constructor(
    app: App,
    private trip: Trip,
    private onConfirm: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("awty-modal");

    contentEl.createEl("h2", { text: "Delete this trip?", cls: "awty-modal-title" });

    const summary = contentEl.createDiv({ cls: "awty-delete-summary" });
    summary.createDiv({ cls: "awty-delete-name", text: this.trip.title });
    summary.createDiv({
      cls: "awty-delete-meta",
      text: formatDateRange(this.trip.startDate, this.trip.endDate),
    });

    const targets = tripDeletionTargets(this.app, this.trip);
    const files = describeDeletion(this.app, targets);
    const wholeFolder = targets.length === 1 && targets[0].path === this.trip.folderPath;

    contentEl.createEl("p", {
      cls: "awty-delete-scope",
      text: wholeFolder
        ? `The whole folder "${this.trip.folderPath}" will be removed — ${files.length} file${files.length === 1 ? "" : "s"}:`
        : `Another trip shares this folder, so only the trip note will be removed:`,
    });

    const list = contentEl.createEl("ul", { cls: "awty-delete-list" });
    for (const path of files.slice(0, 25)) list.createEl("li", { text: path });
    if (files.length > 25) {
      list.createEl("li", { cls: "awty-delete-more", text: `…and ${files.length - 25} more` });
    }

    contentEl.createEl("p", {
      cls: "awty-delete-note",
      text: "Files follow your vault's “Deleted files” setting — normally the trash, where you can still get them back.",
    });

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((btn) =>
        btn
          .setButtonText("Delete trip")
          .setWarning()
          .onClick(async () => {
            btn.setDisabled(true);
            await this.onConfirm();
            this.close();
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
