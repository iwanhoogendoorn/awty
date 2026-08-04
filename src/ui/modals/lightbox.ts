import { App, Modal, Notice, TFile, setIcon } from "obsidian";

/**
 * Views an attachment without leaving the dashboard.
 *
 * Opening a boarding pass used to take over a workspace tab, which meant losing
 * your place and closing it again afterwards. Images zoom and pan; anything
 * else offers to open properly.
 */
export class Lightbox extends Modal {
  private index: number;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private imgEl: HTMLImageElement | null = null;
  private stageEl!: HTMLElement;
  private captionEl!: HTMLElement;

  constructor(
    app: App,
    private files: TFile[],
    start: TFile,
  ) {
    super(app);
    this.index = Math.max(0, files.findIndex((f) => f.path === start.path));
  }

  private get current(): TFile {
    return this.files[this.index];
  }

  onOpen(): void {
    this.modalEl.addClass("tp-lightbox-shell");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-lightbox");

    const bar = contentEl.createDiv({ cls: "tp-lightbox-bar" });
    this.captionEl = bar.createDiv({ cls: "tp-lightbox-caption" });

    const controls = bar.createDiv({ cls: "tp-lightbox-controls" });
    const button = (icon: string, label: string, onClick: () => void) => {
      const btn = controls.createEl("button", { cls: "tp-icon-btn", attr: { "aria-label": label } });
      setIcon(btn, icon);
      btn.addEventListener("click", onClick);
      return btn;
    };

    button("zoom-out", "Zoom out", () => this.setZoom(this.zoom / 1.25));
    button("zoom-in", "Zoom in", () => this.setZoom(this.zoom * 1.25));
    button("maximize", "Reset zoom", () => this.setZoom(1, true));
    button("file-text", "Open in a tab", () => {
      void this.app.workspace.getLeaf(true).openFile(this.current);
      this.close();
    });

    this.stageEl = contentEl.createDiv({ cls: "tp-lightbox-stage" });

    if (this.files.length > 1) {
      const prev = contentEl.createEl("button", {
        cls: "tp-lightbox-nav is-prev",
        attr: { "aria-label": "Previous" },
      });
      setIcon(prev, "chevron-left");
      prev.addEventListener("click", () => this.step(-1));

      const next = contentEl.createEl("button", {
        cls: "tp-lightbox-nav is-next",
        attr: { "aria-label": "Next" },
      });
      setIcon(next, "chevron-right");
      next.addEventListener("click", () => this.step(1));
    }

    // Arrow keys page through, +/- zoom. Escape still closes.
    this.scope.register([], "ArrowLeft", () => this.step(-1));
    this.scope.register([], "ArrowRight", () => this.step(1));
    this.scope.register([], "=", () => this.setZoom(this.zoom * 1.25));
    this.scope.register([], "-", () => this.setZoom(this.zoom / 1.25));
    this.scope.register([], "0", () => this.setZoom(1, true));

    this.render();
  }

  private step(delta: number): void {
    if (this.files.length < 2) return;
    this.index = (this.index + delta + this.files.length) % this.files.length;
    this.setZoom(1, true);
    this.render();
  }

  private setZoom(zoom: number, resetPan = false): void {
    this.zoom = Math.min(8, Math.max(0.25, zoom));
    if (resetPan) {
      this.panX = 0;
      this.panY = 0;
    }
    this.applyTransform();
  }

  private applyTransform(): void {
    if (!this.imgEl) return;
    this.imgEl.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    this.imgEl.toggleClass("is-zoomed", this.zoom > 1);
  }

  private render(): void {
    const file = this.current;
    this.stageEl.empty();
    this.imgEl = null;

    this.captionEl.setText(
      this.files.length > 1
        ? `${file.name}  ·  ${this.index + 1} of ${this.files.length}`
        : file.name,
    );

    if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name)) {
      const img = this.stageEl.createEl("img", { cls: "tp-lightbox-img" });
      img.src = this.app.vault.getResourcePath(file);
      img.alt = file.name;
      this.imgEl = img;
      this.attachGestures(img);
      this.applyTransform();
      return;
    }

    if (file.extension.toLowerCase() === "pdf") {
      // Electron renders PDFs natively, so this works without a viewer library.
      const frame = this.stageEl.createEl("iframe", { cls: "tp-lightbox-frame" });
      frame.src = this.app.vault.getResourcePath(file);
      return;
    }

    const box = this.stageEl.createDiv({ cls: "tp-lightbox-fallback" });
    setIcon(box.createDiv(), "file");
    box.createDiv({ text: file.name });
    const open = box.createEl("button", { cls: "tp-dash-empty-btn is-cta", text: "Open in a tab" });
    open.addEventListener("click", () => {
      void this.app.workspace.getLeaf(true).openFile(file);
      this.close();
    });
  }

  /** Scroll to zoom, drag to pan, double-click to reset. */
  private attachGestures(img: HTMLImageElement): void {
    this.stageEl.addEventListener(
      "wheel",
      (evt: WheelEvent) => {
        evt.preventDefault();
        this.setZoom(this.zoom * (evt.deltaY < 0 ? 1.12 : 1 / 1.12));
      },
      { passive: false },
    );

    img.addEventListener("dblclick", () => this.setZoom(this.zoom > 1 ? 1 : 2, true));

    let dragging = false;
    let originX = 0;
    let originY = 0;

    img.addEventListener("mousedown", (evt: MouseEvent) => {
      if (this.zoom <= 1) return;
      dragging = true;
      originX = evt.clientX - this.panX;
      originY = evt.clientY - this.panY;
      evt.preventDefault();
    });
    this.stageEl.addEventListener("mousemove", (evt: MouseEvent) => {
      if (!dragging) return;
      this.panX = evt.clientX - originX;
      this.panY = evt.clientY - originY;
      this.applyTransform();
    });
    for (const type of ["mouseup", "mouseleave"]) {
      this.stageEl.addEventListener(type, () => (dragging = false));
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Opens an attachment, falling back to a tab for things we cannot display. */
export function openAttachment(app: App, files: TFile[], file: TFile): void {
  if (files.length === 0) {
    new Notice("Nothing to show.");
    return;
  }
  new Lightbox(app, files, file).open();
}
