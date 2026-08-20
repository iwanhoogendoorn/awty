import { composeAddress, meaningfulAddress } from "./postalAddress";
/**
 * The generated bodies of booking and expense notes.
 *
 * Free of any Obsidian import on purpose: the note-destroying bugs in this
 * plugin's history all lived in how these bodies were recombined with kept
 * content, and that composition could not be tested while the builders sat in
 * a module that only runs inside the app.
 */
import { groupJourneys, layoverMinutes, formatLayover, type FlightLeg } from "./legs";
import { cruiseShape, portTable } from "./cruise";
import { modeLabel } from "./transportMode";
import { formatMoney } from "../util/money";
import type { BookingDraft } from "./bookingWriter";

export function isImage(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(path);
}

export function bookingBody(draft: BookingDraft, attachmentLinks: string[]): string {
  const rows: string[] = [];
  const add = (label: string, value: string) => {
    if (value) rows.push(`| **${label}** | ${value} |`);
  };

  add("Status", draft.status);
  // Above the ends, because "Ferry" changes how you read "Dubrovnik → Lopud".
  if (draft.kind === "transport") add("Mode", modeLabel(draft.mode));
  add("Date", draft.endDate && draft.endDate !== draft.date ? `${draft.date} → ${draft.endDate}` : draft.date);
  add("Time", draft.endTime ? `${draft.time} → ${draft.endTime}` : draft.time);
  add("From", draft.from);
  // The same test the frontmatter applies. A city and a country prefilled from
  // the trip are not an address, and the body was printing them as one — so a
  // ferry to Lopud claimed a "To address" of Dubrovnik that nothing else in the
  // note agreed with.
  add("From address", composeAddress(meaningfulAddress(draft.fromPostal)));
  add("To", draft.to);
  add(
    draft.kind === "transport" ? "To address" : "Address",
    composeAddress(meaningfulAddress(draft.postal)),
  );
  add(draft.kind === "cruise" ? "Cruise line" : "Operator", draft.operator);
  add(draft.kind === "cruise" ? "Cabin" : "Seat", draft.seat);
  add("Where", draft.where);
  add("Reference", draft.reference);

  const out = [`# ${draft.title}`, ""];
  if (rows.length) out.push("| | |", "|---|---|", ...rows, "");

  const itinerary = (legs: FlightLeg[], heading: string): void => {
    if (legs.length === 0) return;
    out.push(`## ${heading}`, "");
    // Grouped, so a break between two flights is visible in the note as well
    // as in the editor — and each flight's own price sits with it.
    const groups = groupJourneys(legs);
    const priced = groups.some((group) => typeof group[0]?.cost === "number");
    out.push(
      `| Leg | Airline | Flight | From | To | Departs | Arrives |${priced ? " Cost |" : ""}`,
    );
    out.push(`|---|---|---|---|---|---|---|${priced ? "---|" : ""}`);
    groups.forEach((group, groupIndex) => {
      if (groupIndex > 0) {
        out.push(`| | | | | | | |${priced ? " |" : ""}`);
      }
      group.forEach((leg, index) => {
        const arrives = leg.arrDate && leg.arrDate !== leg.date ? `${leg.arrTime} (+1)` : leg.arrTime;
        const label = groups.length > 1 ? `${groupIndex + 1}.${index + 1}` : String(index + 1);
        const cost =
          index === 0 && typeof leg.cost === "number" ? ` ${formatMoney({ amount: leg.cost, currency: draft.currency })} |` : priced ? " |" : "";
        out.push(
          `| ${label} | ${leg.operator} | ${leg.number} | ${leg.from} | ${leg.to} | ${leg.date} ${leg.depTime} | ${arrives} |${cost}`,
        );
      });
    });
    out.push("");
    // Connection times are the thing you actually worry about when booking.
    const layovers: string[] = [];
    for (let i = 1; i < legs.length; i += 1) {
      const gap = layoverMinutes(legs[i - 1], legs[i]);
      if (gap !== null) layovers.push(`- ${formatLayover(gap)} in ${legs[i - 1].to || "transit"}`);
    }
    if (layovers.length) out.push("**Layovers**", "", ...layovers, "");
  };

  // Read defensively: this renders whatever draft it is handed, including ones
  // written by a version that had never heard of a cruise.
  const ports = draft.ports ?? [];
  if (ports.length > 0) {
    const shape = cruiseShape(ports);
    out.push("## Itinerary", "");
    out.push(...portTable(ports), "");
    const summary = [
      `${shape.nights} night${shape.nights === 1 ? "" : "s"}`,
      `${shape.calls} port${shape.calls === 1 ? "" : "s"} of call`,
      shape.seaDays > 0 ? `${shape.seaDays} day${shape.seaDays === 1 ? "" : "s"} at sea` : "",
    ].filter(Boolean);
    out.push(summary.join(" · "), "");
    if (shape.countries.length) out.push(`**Countries** — ${shape.countries.join(", ")}`, "");
  }

  if (draft.legs.length > 1 || draft.returnLegs.length > 0) {
    itinerary(draft.legs, draft.returnLegs.length > 0 ? "Outbound" : "Itinerary");
    itinerary(draft.returnLegs, "Return");
  }
  if (draft.notes.trim()) out.push("## Notes", "", draft.notes.trim(), "");
  if (attachmentLinks.length) {
    out.push("## Attachments", "");
    for (const link of attachmentLinks) {
      // Images embed; PDFs and the rest stay as links so the note stays readable.
      out.push(isImage(link) ? `!${link}` : `- ${link}`);
    }
    out.push("");
  }
  return out.join("\n");
}


/** The generated body of an expense note. */
export function expenseBody(description: string, attachmentLinks: string[]): string {
  const out = [`# ${description}`, ""];
  if (attachmentLinks.length) {
    out.push("## Receipt", "");
    for (const link of attachmentLinks) out.push(isImage(link) ? `!${link}` : `- ${link}`);
    out.push("");
  }
  return out.join("\n");
}
