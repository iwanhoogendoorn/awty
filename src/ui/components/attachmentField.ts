import { setIcon } from "obsidian";

/**
 * Drop zone plus file picker for tickets, confirmations and receipts.
 *
 * Files are held in memory until the wizard finishes, so cancelling a half-filled
 * form leaves nothing behind in the vault.
 */
export class AttachmentField {
  private files: File[] = [];
  private pasteHandler: ((evt: ClipboardEvent) => void) | null = null;
  private listEl!: HTMLElement;
  private inputEl!: HTMLInputElement;

  constructor(
    private container: HTMLElement,
    private label = "Tickets, confirmations, receipts",
  ) {
    this.render();
  }

  private render(): void {
    const wrap = this.container.createDiv({ cls: "tp-attach" });

    const drop = wrap.createDiv({ cls: "tp-attach-drop" });
    setIcon(drop.createDiv({ cls: "tp-attach-icon" }), "paperclip");
    drop.createDiv({ cls: "tp-attach-label", text: this.label });
    drop.createDiv({ cls: "tp-attach-hint", text: "Drop files here, paste with Cmd+V, or click to choose" });

    this.inputEl = wrap.createEl("input", { cls: "tp-attach-input" });
    this.inputEl.type = "file";
    this.inputEl.multiple = true;
    this.inputEl.addEventListener("change", () => {
      this.add(Array.from(this.inputEl.files ?? []));
      // Reset so picking the same file twice still fires a change event.
      this.inputEl.value = "";
    });

    drop.addEventListener("click", () => this.inputEl.click());

    for (const type of ["dragenter", "dragover"]) {
      drop.addEventListener(type, (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        drop.addClass("is-over");
      });
    }
    for (const type of ["dragleave", "drop"]) {
      drop.addEventListener(type, (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        drop.removeClass("is-over");
      });
    }
    drop.addEventListener("drop", (evt: DragEvent) => {
      this.add(Array.from(evt.dataTransfer?.files ?? []));
    });

    // Paste works anywhere in the modal, so a screenshot copied from a booking
    // confirmation goes straight in with Cmd+V.
    this.pasteHandler = (evt: ClipboardEvent) => {
      const files = Array.from(evt.clipboardData?.files ?? []);
      if (files.length === 0) return;
      evt.preventDefault();
      // Pasted images arrive named "image.png" every time; stamp them so a
      // second paste does not look like a duplicate of the first.
      this.add(
        files.map((file, index) =>
          file.name && file.name !== "image.png"
            ? file
            : new File([file], `pasted-${this.files.length + index + 1}.png`, { type: file.type }),
        ),
      );
    };
    document.addEventListener("paste", this.pasteHandler);

    this.listEl = wrap.createDiv({ cls: "tp-attach-list" });
    this.renderList();
  }

  private add(files: File[]): void {
    for (const file of files) {
      // Same name and size twice in one go is a double-drop, not two documents.
      if (this.files.some((f) => f.name === file.name && f.size === file.size)) continue;
      this.files.push(file);
    }
    this.renderList();
  }

  private renderList(): void {
    this.listEl.empty();
    for (const [index, file] of this.files.entries()) {
      const chip = this.listEl.createDiv({ cls: "tp-attach-chip" });
      setIcon(
        chip.createSpan({ cls: "tp-attach-chip-icon" }),
        /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name) ? "image" : "file-text",
      );
      chip.createSpan({ cls: "tp-attach-chip-name", text: file.name });
      chip.createSpan({ cls: "tp-attach-chip-size", text: formatSize(file.size) });

      const remove = chip.createSpan({ cls: "tp-attach-chip-remove", attr: { "aria-label": "Remove" } });
      setIcon(remove, "x");
      remove.addEventListener("click", (evt) => {
        evt.stopPropagation();
        this.files.splice(index, 1);
        this.renderList();
      });
    }
  }

  getFiles(): File[] {
    return [...this.files];
  }

  /** Modals must call this on close, or the paste listener outlives them. */
  destroy(): void {
    if (this.pasteHandler) document.removeEventListener("paste", this.pasteHandler);
    this.pasteHandler = null;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
