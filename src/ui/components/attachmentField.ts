import { setIcon } from "obsidian";

/**
 * Drop zone plus file picker for tickets, confirmations and receipts.
 *
 * Files are held in memory until the wizard finishes, so cancelling a half-filled
 * form leaves nothing behind in the vault.
 */
export interface AttachmentFieldOptions {
  label?: string;
  /** Pasted files are named after this, usually the trip. */
  baseName?: string;
  /** How many files already carry that name, so numbering continues. */
  startIndex?: number;
}

export class AttachmentField {
  private files: File[] = [];
  private pasteHandler: ((evt: ClipboardEvent) => void) | null = null;
  private listEl!: HTMLElement;
  private inputEl!: HTMLInputElement;
  private label: string;
  private baseName: string;
  private startIndex: number;
  /** Counts only the pastes made in this session. */
  private pasted = 0;

  constructor(
    private container: HTMLElement,
    options: AttachmentFieldOptions | string = {},
  ) {
    const opts = typeof options === "string" ? { label: options } : options;
    this.label = opts.label ?? "Tickets, confirmations, receipts";
    this.baseName = opts.baseName ?? "";
    this.startIndex = opts.startIndex ?? 0;
    this.render();
  }

  /**
   * A pasted screenshot is always called "image.png", which is useless in a
   * folder and looks like a duplicate of the last one. Named after the trip and
   * numbered on from whatever is already there.
   */
  private nameFor(file: File, offset: number): string {
    const ext = extensionFor(file);
    if (!this.baseName) return `pasted-${this.startIndex + this.pasted + offset + 1}${ext}`;
    return `${this.baseName} ${this.startIndex + this.pasted + offset + 1}${ext}`;
  }

  private render(): void {
    const wrap = this.container.createDiv({ cls: "awty-attach" });

    const drop = wrap.createDiv({ cls: "awty-attach-drop" });
    setIcon(drop.createDiv({ cls: "awty-attach-icon" }), "paperclip");
    drop.createDiv({ cls: "awty-attach-label", text: this.label });
    drop.createDiv({ cls: "awty-attach-hint", text: "Drop files here, paste with Cmd+V, or click to choose" });

    this.inputEl = wrap.createEl("input", { cls: "awty-attach-input" });
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
      const renamed = files.map((file, index) =>
        // A file dragged from Finder has a real name worth keeping; a clipboard
        // image does not.
        isGenericName(file.name)
          ? new File([file], this.nameFor(file, index), { type: file.type })
          : file,
      );
      this.pasted += renamed.length;
      this.add(renamed);
    };
    document.addEventListener("paste", this.pasteHandler);

    this.listEl = wrap.createDiv({ cls: "awty-attach-list" });
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
      const chip = this.listEl.createDiv({ cls: "awty-attach-chip" });
      setIcon(
        chip.createSpan({ cls: "awty-attach-chip-icon" }),
        /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name) ? "image" : "file-text",
      );
      chip.createSpan({ cls: "awty-attach-chip-name", text: file.name });
      chip.createSpan({ cls: "awty-attach-chip-size", text: formatSize(file.size) });

      const remove = chip.createSpan({ cls: "awty-attach-chip-remove", attr: { "aria-label": "Remove" } });
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

const EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
};

function extensionFor(file: File): string {
  const dot = file.name.lastIndexOf(".");
  if (dot > 0) return file.name.slice(dot);
  return EXTENSIONS[file.type] ?? ".png";
}

/** Clipboard images arrive unnamed or as "image.png" on every platform. */
function isGenericName(name: string): boolean {
  return !name || /^image\.\w+$/i.test(name) || /^(pasted|screenshot|clipboard)/i.test(name);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
