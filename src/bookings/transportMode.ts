/**
 * How a transfer actually moves you.
 *
 * "Transport" covered a taxi to the airport and a train across a country with
 * the same train icon and the same "FlixBus" placeholder, which is fine right
 * up until the thing you booked is a ferry. Islands are reached by boat, and a
 * boat is not a bus that is running late — the times are fixed, the crossing is
 * over water, and the note should say so.
 *
 * Deliberately a property of the booking rather than a booking kind of its own:
 * a ferry and a coach are the same shape of fact — a carrier, a service, two
 * ends and a seat — and splitting them into kinds would have multiplied the
 * forms without adding a single field.
 *
 * Kept free of Obsidian so the labels and the fallbacks can be checked.
 */

export type TransportMode =
  | "train"
  | "bus"
  | "ferry"
  | "car"
  | "camper"
  | "metro"
  | "taxi"
  | "shuttle"
  | "bike"
  | "walk"
  | "other";

export interface TransportModeDef {
  id: TransportMode;
  label: string;
  icon: string;
  /** Placeholders, because "FlixBus" is no help at all when you took a boat. */
  carrier: string;
  service: string;
  from: string;
  to: string;
}

export const TRANSPORT_MODES: TransportModeDef[] = [
  {
    id: "train",
    label: "Train",
    icon: "train-front",
    carrier: "Deutsche Bahn",
    service: "ICE 122",
    from: "Amsterdam Centraal",
    to: "Berlin Hauptbahnhof",
  },
  {
    id: "bus",
    label: "Bus",
    icon: "bus",
    carrier: "FlixBus",
    service: "Bus 402",
    from: "Dubrovnik bus station",
    to: "Rausion Luxury Apartments",
  },
  {
    id: "ferry",
    label: "Ferry",
    icon: "ship",
    carrier: "Jadrolinija",
    service: "Ferry to Lopud",
    from: "Dubrovnik (Gruž port)",
    to: "Lopud harbour",
  },
  {
    id: "taxi",
    label: "Taxi",
    icon: "car-taxi-front",
    carrier: "Uber",
    service: "Airport transfer",
    from: "Dubrovnik Airport (DBV)",
    to: "Rausion Luxury Apartments",
  },
  {
    id: "car",
    label: "Car",
    icon: "car-front",
    carrier: "Sixt, or your own",
    service: "Compact, five days",
    from: "Pick-up desk",
    to: "Drop-off desk",
  },
  {
    id: "camper",
    label: "Campervan",
    icon: "caravan",
    carrier: "McRent",
    service: "Four-berth, two weeks",
    from: "Depot",
    to: "Depot",
  },
  {
    id: "metro",
    label: "Metro or tram",
    icon: "tram-front",
    carrier: "BVG",
    service: "U2",
    from: "Alexanderplatz",
    to: "Zoologischer Garten",
  },
  {
    id: "shuttle",
    label: "Shuttle",
    icon: "bus-front",
    carrier: "Hotel shuttle",
    service: "Airport shuttle",
    from: "Dubrovnik Airport (DBV)",
    to: "Hotel Excelsior",
  },
  {
    id: "bike",
    label: "Bike",
    icon: "bike",
    carrier: "Swapfiets",
    service: "City bike, three days",
    from: "The apartment",
    to: "The old town",
  },
  {
    id: "walk",
    label: "On foot",
    icon: "footprints",
    carrier: "Just you",
    service: "The walk down to the harbour",
    from: "The apartment",
    to: "Gruž port",
  },
  {
    id: "other",
    label: "Other",
    icon: "route",
    carrier: "Who runs it",
    service: "What it is",
    from: "Where it picks you up",
    to: "Where it leaves you",
  },
];

const BY_ID = new Map(TRANSPORT_MODES.map((m) => [m.id, m]));

/**
 * The mode a note claims, or none.
 *
 * Empty is a real answer and the one every booking written before this existed
 * gives. Guessing "train" for them would have put a train icon on a taxi and
 * called it recorded fact.
 */
export function readMode(value: unknown): TransportMode | "" {
  const clean = typeof value === "string" ? value.trim().toLowerCase() : "";
  return BY_ID.has(clean as TransportMode) ? (clean as TransportMode) : "";
}

export function modeDef(mode: TransportMode | ""): TransportModeDef | null {
  return mode ? (BY_ID.get(mode) ?? null) : null;
}

/** "Ferry", or "" when the booking never said. */
export function modeLabel(mode: TransportMode | ""): string {
  return modeDef(mode)?.label ?? "";
}

/** The icon for a transfer: its own, or the generic one it had before. */
export function modeIcon(mode: TransportMode | "", fallback: string): string {
  return modeDef(mode)?.icon ?? fallback;
}

/**
 * How you are getting there, offered as one list.
 *
 * "Getting there" only ever opened the flight form, so a trip taken by train
 * had to be filed as a flight or found somewhere else entirely — the step said
 * "Flights, trains, buses" and then handed you a box asking for a flight
 * number. A plane is a booking kind and a train is a mode of another kind,
 * which is a distinction the code needs and nobody planning a trip does.
 *
 * So this flattens the two into the one question actually being asked, and
 * lives here — free of Obsidian — so the list can be checked rather than
 * eyeballed in a menu.
 */
export interface TravelChoice {
  /** Which booking form opens. */
  kind: "flight" | "transport";
  /** The mode to start that form on, when it is a transfer. */
  mode: TransportMode | "";
  label: string;
  icon: string;
}

export const TRAVEL_CHOICES: TravelChoice[] = [
  { kind: "flight", mode: "", label: "Flight", icon: "plane" },
  ...TRANSPORT_MODES.map((mode) => ({
    kind: "transport" as const,
    mode: mode.id,
    label: mode.label,
    icon: mode.icon,
  })),
];
