import type { Booking } from "./types";

/**
 * The places on a trip you might travel between.
 *
 * A transfer is almost always airport to hotel, or hotel to station — places
 * this trip already knows. Offering only city names meant retyping a hotel's
 * name and never getting an address in, so the transfer had no position and no
 * travel time.
 */
export interface Endpoint {
  /** What goes in the From or To box. */
  label: string;
  /** Street address, when the booking carries one. */
  address: string;
  /** "lat,lng" when already known, so nothing is geocoded twice. */
  location: string;
  kind: "airport" | "stay" | "activity" | "restaurant" | "station";
}

const KIND: Record<string, Endpoint["kind"]> = {
  flight: "airport",
  stay: "stay",
  activity: "activity",
  restaurant: "restaurant",
  transport: "station",
};

/**
 * @param locationOf Reads a booking's stored coordinates, which live in
 *   frontmatter rather than on the booking itself.
 */
export function tripEndpoints(
  bookings: Booking[],
  locationOf: (booking: Booking) => string,
  exclude?: Booking,
): Endpoint[] {
  const out: Endpoint[] = [];
  const seen = new Set<string>();

  for (const booking of bookings) {
    if (booking.status === "cancelled") continue;
    if (exclude && booking.file.path === exclude.file.path) continue;

    const kind = KIND[booking.kind] ?? "activity";
    // A flight's useful endpoint is the airport it lands at, not the route.
    const labels =
      booking.kind === "flight"
        ? [booking.to, booking.from].filter(Boolean)
        : [booking.title].filter(Boolean);

    for (const label of labels) {
      const key = `${kind}|${label.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        label,
        address: booking.kind === "flight" ? "" : booking.address,
        location: booking.kind === "flight" ? "" : locationOf(booking),
        kind,
      });
    }
  }
  return out;
}

/**
 * The transfers worth one click.
 *
 * Only offered when both ends exist, so a shortcut never fills a box with a
 * place this trip has not got.
 */
export function transferShortcuts(
  endpoints: Endpoint[],
): { label: string; from: Endpoint; to: Endpoint }[] {
  const airport = endpoints.find((e) => e.kind === "airport");
  const stay = endpoints.find((e) => e.kind === "stay");
  const out: { label: string; from: Endpoint; to: Endpoint }[] = [];

  if (airport && stay) {
    out.push({ label: "Airport → stay", from: airport, to: stay });
    out.push({ label: "Stay → airport", from: stay, to: airport });
  }
  const station = endpoints.find((e) => e.kind === "station");
  if (stay && station) out.push({ label: "Stay → station", from: stay, to: station });

  return out;
}
