import { App, Modal, Setting } from "obsidian";

/**
 * A yes-or-no before something irreversible.
 *
 * The trip deletion dialogue lists every file that will go, which is right for
 * a whole folder and far too much for one booking. This is the small version:
 * what it is, where it goes, and one button that does it.
 */
export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private spec: {
      title: string;
      name: string;
      detail?: string;
      confirmText?: string;
      onConfirm: () => Promise<void>;
    },
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("awty-modal");

    contentEl.createEl("h2", { text: this.spec.title, cls: "awty-modal-title" });
    const summary = contentEl.createDiv({ cls: "awty-delete-summary" });
    summary.createDiv({ cls: "awty-delete-name", text: this.spec.name });
    if (this.spec.detail) {
      summary.createDiv({ cls: "awty-delete-meta", text: this.spec.detail });
    }
    contentEl.createEl("p", {
      cls: "awty-delete-note",
      text: "The note follows your vault's “Deleted files” setting — normally the trash, where you can still get it back.",
    });

    new Setting(contentEl)
      .addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((btn) =>
        btn
          .setButtonText(this.spec.confirmText ?? "Delete")
          .setWarning()
          .onClick(async () => {
            btn.setDisabled(true);
            await this.spec.onConfirm();
            this.close();
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
