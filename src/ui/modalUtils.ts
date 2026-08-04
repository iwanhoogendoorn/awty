import type { Modal } from "obsidian";

/**
 * Stops a click on the dimmed background from closing the modal.
 *
 * Obsidian's default is to close, which loses a half-filled wizard to a stray
 * click. Escape and the X still close it, so there is no way to get stuck.
 *
 * The listener runs in the capture phase on the container, which fires before
 * the background element's own bubble handler and stops it reaching it.
 */
export function keepOpenOnBackgroundClick(modal: Modal): void {
  modal.containerEl.addEventListener(
    "click",
    (evt) => {
      const target = evt.target as HTMLElement | null;
      if (!target) return;
      const onBackground =
        target === modal.containerEl || target.classList.contains("modal-bg");
      if (!onBackground) return;
      evt.preventDefault();
      evt.stopImmediatePropagation();
    },
    true,
  );
}
