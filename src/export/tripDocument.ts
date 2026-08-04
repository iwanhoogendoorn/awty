/**
 * Builds a self-contained HTML document for a trip.
 *
 * Kept free of any Obsidian import so it can be tested outside the app, and
 * self-contained so the exported file survives being emailed to whoever is
 * coming with you — no vault, no plugin, no network.
 */

export interface DocLeg {
  operator: string;
  number: string;
  from: string;
  to: string;
  date: string;
  depTime: string;
  arrDate: string;
  arrTime: string;
}

export interface DocBooking {
  kind: string;
  kindLabel: string;
  title: string;
  status: string;
  date: string;
  endDate: string;
  time: string;
  endTime: string;
  from: string;
  to: string;
  address: string;
  reference: string;
  seat: string;
  cost: string;
  notes: string;
  legs: DocLeg[];
  returnLegs: DocLeg[];
}

export interface DocDay {
  date: string;
  label: string;
  weekday: string;
  items: { time: string; title: string; detail: string }[];
  staying: string;
}

export interface DocCostLine {
  date: string;
  description: string;
  category: string;
  amount: string;
}

export interface DocSection {
  heading: string;
  rows: [string, string][];
}

export interface TripDocument {
  title: string;
  dates: string;
  duration: string;
  where: string;
  origin: string;
  travellers: string[];
  facts: [string, string][];
  documents: { label: string; detail: string; tone: "good" | "warn" | "bad" | "unknown" }[];
  bookings: DocBooking[];
  days: DocDay[];
  costs: { lines: DocCostLine[]; total: string; budget: string; byCategory: [string, string][] };
  packing: { section: string; items: { label: string; packed: boolean }[] }[];
  /** Images embedded as data URIs, so the file stands alone. */
  images: { caption: string; dataUri: string }[];
  generatedOn: string;
}

/** Escapes text for HTML. Every value below goes through this. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "";
  return [
    "<table>",
    `<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>`,
    "<tbody>",
    ...rows.map(
      (row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`,
    ),
    "</tbody>",
    "</table>",
  ].join("\n");
}

function legRows(legs: DocLeg[]): string[][] {
  return legs.map((leg) => [
    [leg.operator, leg.number].filter(Boolean).join(" "),
    leg.from,
    leg.to,
    [leg.date, leg.depTime].filter(Boolean).join(" "),
    leg.arrDate && leg.arrDate !== leg.date
      ? `${leg.arrTime} (+1)`
      : leg.arrTime,
  ]);
}

function bookingBlock(booking: DocBooking): string {
  const meta: [string, string][] = [
    ["When", booking.endDate && booking.endDate !== booking.date ? `${booking.date} → ${booking.endDate}` : booking.date],
    ["Time", [booking.time, booking.endTime].filter(Boolean).join(" → ")],
    ["From", booking.from],
    ["To", booking.to],
    ["Address", booking.address],
    ["Reference", booking.reference],
    ["Seat", booking.seat],
    ["Cost", booking.cost],
    ["Status", booking.status],
  ].filter(([, value]) => value.length > 0) as [string, string][];

  const parts = [
    `<div class="booking">`,
    `<h3>${escapeHtml(booking.title)} <span class="kind">${escapeHtml(booking.kindLabel)}</span></h3>`,
    table(["", ""], meta.map(([k, v]) => [k, v])),
  ];

  if (booking.legs.length > 0) {
    parts.push(
      `<h4>${booking.returnLegs.length > 0 ? "Outbound" : "Itinerary"}</h4>`,
      table(["Flight", "From", "To", "Departs", "Arrives"], legRows(booking.legs)),
    );
  }
  if (booking.returnLegs.length > 0) {
    parts.push("<h4>Return</h4>", table(["Flight", "From", "To", "Departs", "Arrives"], legRows(booking.returnLegs)));
  }
  if (booking.notes.trim()) {
    parts.push(`<p class="notes">${escapeHtml(booking.notes.trim())}</p>`);
  }
  parts.push("</div>");
  return parts.join("\n");
}

const STYLES = `
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1c1e21; font-size: 10.5pt; line-height: 1.45; margin: 0;
  }
  h1 { font-size: 22pt; margin: 0 0 2mm; }
  h2 {
    font-size: 13pt; margin: 9mm 0 3mm; padding-bottom: 1.5mm;
    border-bottom: 1px solid #d7dbe0; page-break-after: avoid;
  }
  h3 { font-size: 11pt; margin: 5mm 0 2mm; page-break-after: avoid; }
  h4 { font-size: 9.5pt; margin: 3mm 0 1.5mm; color: #55606b; page-break-after: avoid; }
  .cover { border-left: 4px solid #2b6cb0; padding-left: 5mm; margin-bottom: 6mm; }
  .cover .sub { color: #55606b; font-size: 11pt; }
  .facts { display: flex; flex-wrap: wrap; gap: 2mm 8mm; margin-top: 3mm; font-size: 9.5pt; }
  .facts div span { color: #55606b; }
  table { width: 100%; border-collapse: collapse; margin: 2mm 0 3mm; page-break-inside: avoid; }
  th, td {
    text-align: left; padding: 1.4mm 2mm; border-bottom: 1px solid #e4e7eb;
    vertical-align: top; font-size: 9.5pt;
  }
  th { color: #55606b; font-weight: 600; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; }
  thead th:empty { padding: 0; border: none; }
  .booking { page-break-inside: avoid; margin-bottom: 4mm; }
  .kind { font-weight: 400; color: #55606b; font-size: 9pt; }
  .notes { color: #37414a; font-size: 9.5pt; margin: 1mm 0 0; }
  .day { page-break-inside: avoid; margin-bottom: 3.5mm; display: flex; gap: 4mm; }
  .day .marker { width: 16mm; flex: none; color: #55606b; font-size: 9pt; }
  .day .marker strong { display: block; font-size: 13pt; color: #1c1e21; }
  .day .items { flex: 1; }
  .day .item { display: flex; gap: 3mm; padding: .8mm 0; border-bottom: 1px dotted #e4e7eb; }
  .day .item .t { width: 12mm; flex: none; color: #55606b; font-size: 9pt; }
  .day .staying { color: #55606b; font-size: 9pt; font-style: italic; }
  .day .empty { color: #8a939c; font-size: 9pt; }
  .doc { padding: 1.5mm 2.5mm; border-left: 3px solid #8a939c; margin-bottom: 1.5mm; font-size: 9.5pt; }
  .doc.good { border-color: #2f855a; }
  .doc.warn { border-color: #b7791f; }
  .doc.bad { border-color: #c53030; }
  .doc .detail { color: #55606b; font-size: 9pt; }
  .packing { column-count: 2; column-gap: 8mm; }
  .packing section { break-inside: avoid; margin-bottom: 3mm; }
  .packing h4 { margin-top: 0; }
  .packing li { list-style: none; font-size: 9.5pt; }
  .packing ul { margin: 0; padding: 0; }
  .box { display: inline-block; width: 3mm; height: 3mm; border: 1px solid #8a939c; margin-right: 2mm; }
  .box.on { background: #2f855a; border-color: #2f855a; }
  .gallery { display: flex; flex-wrap: wrap; gap: 3mm; }
  .gallery figure { margin: 0; width: 82mm; page-break-inside: avoid; }
  .gallery img { width: 100%; border: 1px solid #d7dbe0; }
  .gallery figcaption { font-size: 8.5pt; color: #55606b; margin-top: 1mm; }
  .totals { display: flex; gap: 10mm; margin: 2mm 0 3mm; }
  .totals div span { display: block; color: #55606b; font-size: 8.5pt; text-transform: uppercase; }
  .totals div strong { font-size: 13pt; }
  footer { margin-top: 8mm; color: #8a939c; font-size: 8.5pt; border-top: 1px solid #e4e7eb; padding-top: 2mm; }
`;

/** Renders the whole trip as one printable document. */
export function renderTripDocument(doc: TripDocument): string {
  const parts: string[] = [];

  parts.push(
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>${escapeHtml(doc.title)}</title>`,
    `<style>${STYLES}</style>`,
    "</head><body>",
  );

  parts.push(
    '<div class="cover">',
    `<h1>${escapeHtml(doc.title)}</h1>`,
    `<div class="sub">${escapeHtml([doc.dates, doc.where].filter(Boolean).join(" · "))}</div>`,
    '<div class="facts">',
    ...doc.facts.map(([k, v]) => `<div><span>${escapeHtml(k)}</span> ${escapeHtml(v)}</div>`),
    "</div></div>",
  );

  if (doc.documents.length > 0) {
    parts.push("<h2>Documents &amp; advice</h2>");
    for (const item of doc.documents) {
      parts.push(
        `<div class="doc ${item.tone}"><strong>${escapeHtml(item.label)}</strong>`,
        `<div class="detail">${escapeHtml(item.detail)}</div></div>`,
      );
    }
  }

  if (doc.bookings.length > 0) {
    parts.push("<h2>Bookings</h2>", ...doc.bookings.map(bookingBlock));
  }

  if (doc.days.length > 0) {
    parts.push("<h2>Day by day</h2>");
    for (const day of doc.days) {
      const items =
        day.items.length > 0
          ? day.items
              .map(
                (item) =>
                  `<div class="item"><div class="t">${escapeHtml(item.time || "")}</div><div><strong>${escapeHtml(item.title)}</strong>${
                    item.detail ? ` <span class="t">${escapeHtml(item.detail)}</span>` : ""
                  }</div></div>`,
              )
              .join("")
          : '<div class="empty">Nothing planned</div>';
      parts.push(
        '<div class="day">',
        `<div class="marker"><strong>${escapeHtml(day.label)}</strong>${escapeHtml(day.weekday)}</div>`,
        `<div class="items">${day.staying ? `<div class="staying">${escapeHtml(day.staying)}</div>` : ""}${items}</div>`,
        "</div>",
      );
    }
  }

  if (doc.costs.lines.length > 0 || doc.costs.budget) {
    parts.push(
      "<h2>Costs</h2>",
      '<div class="totals">',
      `<div><span>Total cost</span><strong>${escapeHtml(doc.costs.total)}</strong></div>`,
      doc.costs.budget ? `<div><span>Trip budget</span><strong>${escapeHtml(doc.costs.budget)}</strong></div>` : "",
      "</div>",
    );
    if (doc.costs.byCategory.length > 0) {
      parts.push(table(["Category", "Cost"], doc.costs.byCategory.map(([k, v]) => [k, v])));
    }
    if (doc.costs.lines.length > 0) {
      parts.push(
        table(
          ["Date", "Description", "Category", "Amount"],
          doc.costs.lines.map((l) => [l.date, l.description, l.category, l.amount]),
        ),
      );
    }
  }

  if (doc.packing.length > 0) {
    parts.push('<h2>Packing list</h2><div class="packing">');
    for (const section of doc.packing) {
      parts.push(
        `<section><h4>${escapeHtml(section.section)}</h4><ul>`,
        ...section.items.map(
          (item) =>
            `<li><span class="box${item.packed ? " on" : ""}"></span>${escapeHtml(item.label)}</li>`,
        ),
        "</ul></section>",
      );
    }
    parts.push("</div>");
  }

  if (doc.images.length > 0) {
    parts.push('<h2>Attachments</h2><div class="gallery">');
    for (const image of doc.images) {
      parts.push(
        `<figure><img src="${image.dataUri}" alt="${escapeHtml(image.caption)}">`,
        `<figcaption>${escapeHtml(image.caption)}</figcaption></figure>`,
      );
    }
    parts.push("</div>");
  }

  parts.push(
    `<footer>${escapeHtml(doc.title)} · exported ${escapeHtml(doc.generatedOn)} from Travel Planner</footer>`,
    "</body></html>",
  );

  return parts.join("\n");
}
