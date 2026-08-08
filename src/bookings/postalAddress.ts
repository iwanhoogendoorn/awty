/**
 * An address with the parts kept apart.
 *
 * It used to be one free-text line, which is fine to read back and poor at
 * everything else: a postcode and a country are exactly what a geocoder needs
 * to tell one Frana Supila from another, and typing them into a single box
 * means nothing can tell whether they are there. Kept apart, they can be asked
 * for, and joined back together whenever a single line is what is wanted.
 *
 * Free of Obsidian so the joining and the reading can be checked. What a
 * geocoder is handed is decided here, and getting it wrong bills for a lookup
 * that lands in the wrong town.
 */

export interface PostalAddress {
  /** Street and number. Legacy notes have their whole address in here. */
  line1: string;
  /** Flat, floor, building — whatever the first line could not hold. */
  line2: string;
  postcode: string;
  city: string;
  country: string;
}

export const EMPTY_ADDRESS: PostalAddress = {
  line1: "",
  line2: "",
  postcode: "",
  city: "",
  country: "",
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

export function isEmptyAddress(address: PostalAddress): boolean {
  return !composeAddress(address);
}

/**
 * The parts as one line, in the order a postal service reads them.
 *
 * Postcode and city travel together — "20000 Dubrovnik" rather than "20000,
 * Dubrovnik" — because that is how they are written on an envelope and how a
 * geocoder expects to receive them. Empty parts leave no trace: an address with
 * only a street must not come out as ", , ,".
 */
export function composeAddress(address: PostalAddress): string {
  const town = [address.postcode.trim(), address.city.trim()].filter(Boolean).join(" ");
  return [address.line1.trim(), address.line2.trim(), town, address.country.trim()]
    .filter(Boolean)
    .join(", ");
}

/**
 * Read an address out of frontmatter, whichever era wrote it.
 *
 * `address` was a whole address on one line before this existed and is still
 * where the street goes, so a note written by an older version reads back
 * unchanged and composes to exactly what it always said.
 */
export function readAddress(fm: Record<string, unknown> | undefined, prefix = ""): PostalAddress {
  const key = (name: string): string => (prefix ? `${prefix}_${name}` : name);
  const raw = fm ?? {};
  return {
    line1: str(raw[prefix ? `${prefix}_address` : "address"]),
    line2: str(raw[key("address_2")]),
    postcode: str(raw[key("postcode")]),
    city: str(raw[key("address_city")]),
    country: str(raw[key("address_country")]),
  };
}

/**
 * The frontmatter keys for an address, with the empty ones left out.
 *
 * Returns the keys to delete as well as the ones to set, so clearing a field in
 * the form clears it on the note rather than leaving the old value behind.
 */
export function addressFrontmatter(
  address: PostalAddress,
  prefix = "",
): { set: Record<string, string>; unset: string[] } {
  address = meaningfulAddress(address);
  const key = (name: string): string => (prefix ? `${prefix}_${name}` : name);
  const pairs: [string, string][] = [
    [prefix ? `${prefix}_address` : "address", address.line1.trim()],
    [key("address_2"), address.line2.trim()],
    [key("postcode"), address.postcode.trim()],
    [key("address_city"), address.city.trim()],
    [key("address_country"), address.country.trim()],
  ];
  const set: Record<string, string> = {};
  const unset: string[] = [];
  for (const [name, value] of pairs) {
    if (value) set[name] = value;
    else unset.push(name);
  }
  return { set, unset };
}

/**
 * An address, unless all it holds is where the trip already goes.
 *
 * The city and country boxes come pre-filled, which is the point of them — you
 * are going to Miami, so they say Miami. But a form nobody typed an address
 * into must not save one: "Miami, United States" written to a restaurant note
 * is not that restaurant's address, and everything downstream would treat it as
 * one. It would count as a place waiting to be found, and a geocode of it would
 * come back with the middle of Miami and put a pin on it.
 *
 * A street or a postcode is somebody having told us something. Neither, and
 * there is nothing here but the trip repeated back.
 */
export function meaningfulAddress(address: PostalAddress): PostalAddress {
  const told = address.line1.trim() || address.line2.trim() || address.postcode.trim();
  return told ? address : { ...EMPTY_ADDRESS };
}

/**
 * The city and country a booking on this trip is almost certainly in.
 *
 * Only where there is one answer. A trip to Miami fills both in; a trip round
 * Croatia fills in the country and leaves the city, because guessing Dubrovnik
 * for a restaurant in Split would be a wrong answer typed into a box that looks
 * like you typed it.
 */
export function prefilledAddress(cities: string[], countries: string[]): PostalAddress {
  return {
    ...EMPTY_ADDRESS,
    city: cities.length === 1 ? cities[0].trim() : "",
    country: countries.length === 1 ? countries[0].trim() : "",
  };
}

/** Every frontmatter key an address occupies, for the writer's keep-list. */
export function addressKeys(prefix = ""): string[] {
  const key = (name: string): string => (prefix ? `${prefix}_${name}` : name);
  return [
    prefix ? `${prefix}_address` : "address",
    key("address_2"),
    key("postcode"),
    key("address_city"),
    key("address_country"),
  ];
}

/**
 * What to hand a geocoder, with the trip filling in what the address left out.
 *
 * The old version pasted "city, country" on the end unless the address happened
 * to contain the city as a substring — which meant an address that already said
 * Croatia got Croatia again, and one that said "Dubrovnik" inside a street name
 * got no city at all. With the parts kept separate there is nothing to sniff:
 * a missing city is missing, and only what is missing is added.
 */
export function geocodeQuery(
  address: PostalAddress,
  fallback: string,
  tripCity: string,
  tripCountry: string,
): string {
  const line1 = address.line1.trim() || fallback.trim();
  if (!line1) return "";

  // Where the field is filled in there is nothing to guess. Where it is not —
  // a note written before the parts existed, whose whole address is on line one
  // — the only thing to go on is whether the words are already in there, and
  // adding them twice is worse than the occasional street that shares a name
  // with its city. Filling the fields in removes the guess entirely.
  const already = (value: string): boolean =>
    Boolean(value) && line1.toLowerCase().includes(value.trim().toLowerCase());

  const filled: PostalAddress = {
    ...address,
    line1,
    city: address.city.trim() || (already(tripCity) ? "" : tripCity.trim()),
    country: address.country.trim() || (already(tripCountry) ? "" : tripCountry.trim()),
  };
  return composeAddress(filled);
}

/**
 * A one-line address split back into parts, for the form.
 *
 * Only ever used on notes written before the parts existed, and deliberately
 * unclever: the whole thing goes on the first line. Guessing which comma held
 * the postcode would rewrite somebody's address on the strength of a hunch,
 * and they can move the pieces themselves in one edit.
 */
export function splitLegacyAddress(line: string): PostalAddress {
  return { ...EMPTY_ADDRESS, line1: line.trim() };
}

/**
 * Whether a coordinate still describes where a booking is.
 *
 * A coordinate is an answer to an address, so it outlives that address by
 * exactly nothing. Editing a booking clears every field the form owns and
 * rewrites them, and for a long time the coordinate was cleared and never put
 * back — changing a hotel's confirmation number took its pin off the map. Put
 * back unconditionally it is worse: move the hotel and the pin stays on the old
 * doorway, reporting travel times to somewhere you are not staying.
 */
export function keepLocation(location: string, now: PostalAddress, whenOpened: string): string {
  if (!location) return "";
  return composeAddress(now) === whenOpened ? location : "";
}
