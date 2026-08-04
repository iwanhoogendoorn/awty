import { App, Modal, Setting, setIcon } from "obsidian";
import { keepOpenOnBackgroundClick } from "../modalUtils";
import type { FlightOffer } from "../../flights/providers";
import { formatMoney } from "../../util/money";
import { formatLayover, totalJourneyMinutes } from "../../bookings/legs";

/**
 * Picks one fare out of a search.
 *
 * The environment is stated on the dialogue itself, because Amadeus's test tier
 * returns sample data — a price you cannot buy is worse than no price, and the
 * only honest fix is to say so where the numbers are read.
 */
export class FlightOfferModal extends Modal {
  constructor(
    app: App,
    private offers: FlightOffer[],
    private environment: "test" | "production",
    private onPick: (offer: FlightOffer) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    keepOpenOnBackgroundClick(this);
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tp-modal");
    this.modalEl.addClass("tp-modal-shell");

    contentEl.createEl("h2", { text: "Flights found", cls: "tp-modal-title" });

    if (this.environment === "test") {
      contentEl.createDiv({
        cls: "tp-settings-note",
        text:
          "These came from the Amadeus test environment, which returns sample data rather than real fares. " +
          "Switch to production in settings before treating a price as real.",
      });
    }

    const list = contentEl.createDiv({ cls: "tp-offer-list" });
    const sorted = [...this.offers].sort((a, b) => a.price - b.price);

    for (const offer of sorted) {
      const row = list.createDiv({ cls: "tp-offer" });

      const body = row.createDiv({ cls: "tp-offer-body" });
      body.createDiv({ cls: "tp-offer-route", text: describe(offer.outbound) });
      if (offer.inbound.length > 0) {
        body.createDiv({ cls: "tp-offer-route", text: describe(offer.inbound) });
      }

      const meta = body.createDiv({ cls: "tp-offer-meta" });
      const stops = offer.outbound.length - 1;
      meta.createSpan({ text: stops === 0 ? "Direct" : `${stops} stop${stops === 1 ? "" : "s"}` });
      const total = totalJourneyMinutes(offer.outbound);
      if (total !== null) meta.createSpan({ text: formatLayover(total) });
      if (offer.outbound[0]?.operator) {
        meta.createSpan({ text: offer.outbound[0].operator });
      }

      const right = row.createDiv({ cls: "tp-offer-right" });
      right.createDiv({
        cls: "tp-offer-price",
        text: formatMoney({ amount: offer.price, currency: offer.currency }),
      });
      const pick = right.createEl("button", { cls: "tp-dash-add is-cta", text: "Use this" });
      pick.addEventListener("click", () => {
        this.onPick(offer);
        this.close();
      });
    }

    contentEl.createDiv({
      cls: "tp-doc-caveat",
      text: "Prices are indicative and are not a booking. Confirm with the airline before paying.",
    });

    new Setting(contentEl).addButton((b) =>
      b.setButtonText("Close").onClick(() => this.close()),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function describe(legs: FlightOffer["outbound"]): string {
  if (legs.length === 0) return "";
  const first = legs[0];
  const last = legs[legs.length - 1];
  const via = legs.slice(0, -1).map((l) => l.to).filter(Boolean);
  const route = via.length > 0 ? `${first.from} → ${last.to} via ${via.join(", ")}` : `${first.from} → ${last.to}`;
  const when = [first.date, first.depTime].filter(Boolean).join(" ");
  return `${route}   ${when}${last.arrTime ? ` → ${last.arrTime}` : ""}`;
}
