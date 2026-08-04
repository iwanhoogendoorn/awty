/**
 * Putting a trip's places on Google Maps.
 *
 * There is no link that creates a saved list. Google's Maps URLs API can
 * search for one place, or give directions through a handful of waypoints, and
 * that is the whole of it — a URL cannot add several pins to your account.
 *
 * What does work is My Maps, which imports a file. So this writes KML: one
 * pin per place, grouped, with names and addresses. Import it once and the
 * trip is a map you can open on the phone, share, and keep after the trip.
 *
 * Kept free of Obsidian so it can be tested.
 */

export interface MapPlace {
  name: string;
  /** "Airport", "Stay", "Activity", "Restaurant" — becomes the folder in KML. */
  group: string;
  address: string;
  /** "lat,lng", when known. A place with neither this nor an address is skipped. */
  location: string;
  /** Shown under the pin: dates, times, cost. */
  detail: string;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Google's own pin colours, so the groups are told apart at a glance. */
const PIN: Record<string, string> = {
  Airport: "https://maps.google.com/mapfiles/kml/pal2/icon56.png",
  Stay: "https://maps.google.com/mapfiles/kml/pal2/icon10.png",
  Restaurant: "https://maps.google.com/mapfiles/kml/pal2/icon48.png",
  Activity: "https://maps.google.com/mapfiles/kml/pal2/icon6.png",
  Transport: "https://maps.google.com/mapfiles/kml/pal4/icon54.png",
};

function coord(location: string): { lat: number; lng: number } | null {
  const [lat, lng] = location.split(",").map((n) => Number(n.trim()));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * A KML document for My Maps.
 *
 * Places without coordinates still get a pin with their address in it, since
 * My Maps geocodes on import — better than dropping them silently.
 */
export function tripKml(title: string, places: MapPlace[]): string {
  const usable = places.filter((p) => coord(p.location) || p.address.trim());
  const groups = [...new Set(usable.map((p) => p.group))];

  const body = groups.map((group) => {
    const marks = usable
      .filter((p) => p.group === group)
      .map((place) => {
        const point = coord(place.location);
        const description = [place.address, place.detail].filter(Boolean).join("\n");
        return [
          "      <Placemark>",
          `        <name>${esc(place.name)}</name>`,
          description ? `        <description>${esc(description)}</description>` : "",
          `        <styleUrl>#${esc(group.replace(/\W/g, ""))}</styleUrl>`,
          point
            ? `        <Point><coordinates>${point.lng},${point.lat},0</coordinates></Point>`
            : `        <address>${esc(place.address)}</address>`,
          "      </Placemark>",
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n");

    return [`    <Folder>`, `      <name>${esc(group)}</name>`, marks, "    </Folder>"].join("\n");
  });

  const styles = groups.map((group) =>
    [
      `    <Style id="${esc(group.replace(/\W/g, ""))}">`,
      "      <IconStyle>",
      `        <Icon><href>${PIN[group] ?? PIN.Activity}</href></Icon>`,
      "      </IconStyle>",
      "    </Style>",
    ].join("\n"),
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    "  <Document>",
    `    <name>${esc(title)}</name>`,
    ...styles,
    ...body,
    "  </Document>",
    "</kml>",
    "",
  ].join("\n");
}

/**
 * A note of tap-to-open links, one per place.
 *
 * Google's saved lists are built by hand — search a place, open its card, tap
 * Save — and no link or API creates one. What can be removed is the searching:
 * open this note on the phone, tap a place, tap Save. That turns typing each
 * name into two taps, and the list it builds is the shareable kind.
 */
export function tripMapNote(
  title: string,
  places: MapPlace[],
  mapsUrl: string,
  days: { label: string; places: MapPlace[] }[] = [],
): string {
  // The same filter the KML applies, so the note and the map agree on what a
  // place is: a name is not somewhere you can go.
  const usable = places.filter((p) => p.location.trim() || p.address.trim());
  const groups = [...new Set(usable.map((p) => p.group))];
  const out = [
    `# ${title} — places`,
    "",
    "Every link here opens the Google Maps app on a phone. Tap one, then",
    "**Save** to put it in a list — Google builds lists by hand, so this is the",
    "list to work through, two taps each.",
    "",
    "Not on your phone? Use **Copy links** on the dashboard and message the",
    "block to yourself; the links work from any app that makes them tappable.",
    "",
    `Or import \`${title} map.kml\` into [Google My Maps](${mapsUrl}) for the whole`,
    "trip as one map. It shows under **You → Maps** in the Google Maps app, but",
    "as a view of the map, not a list you can navigate from.",
    "",
  ];

  if (days.length > 0) {
    out.push("## Routes by day", "");
    for (const day of days) {
      const link = directionsLink(day.places);
      if (!link) continue;
      const names = day.places.map((p) => p.name).join(" → ");
      out.push(`- [${day.label}](${link}) — ${names}`);
    }
    out.push("");
  }

  for (const group of groups) {
    out.push(`## ${group}`, "");
    for (const place of usable.filter((p) => p.group === group)) {
      const detail = [place.address, place.detail].filter(Boolean).join(" · ");
      out.push(`- [${place.name}](${placeLink(place)})${detail ? ` — ${detail}` : ""}`);
    }
    out.push("");
  }
  return out.join("\n");
}

/** Where My Maps' import lives, for the notice that explains the two clicks. */
export const MY_MAPS_URL = "https://www.google.com/maps/d/";

/** A link that opens one place on Google Maps. */
export function placeLink(place: MapPlace): string {
  const point = coord(place.location);
  const query = point ? `${point.lat},${point.lng}` : place.address || place.name;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Google's cap: an origin, a destination, and this many stops between. */
export const MAX_WAYPOINTS = 9;

/**
 * A directions link through a day's places.
 *
 * This one genuinely is a link you can paste anywhere — unlike a saved list.
 * Returns null below two places, and drops anything past Google's waypoint cap
 * rather than producing a URL it will refuse.
 */
export function directionsLink(places: MapPlace[], mode = "driving"): string | null {
  const points = places
    .map((p) => {
      const point = coord(p.location);
      return point ? `${point.lat},${point.lng}` : p.address || p.name;
    })
    .filter(Boolean);
  if (points.length < 2) return null;

  const capped = points.slice(0, MAX_WAYPOINTS + 2);
  const origin = capped[0];
  const destination = capped[capped.length - 1];
  const waypoints = capped.slice(1, -1);

  const params = [
    "api=1",
    `origin=${encodeURIComponent(origin)}`,
    `destination=${encodeURIComponent(destination)}`,
    waypoints.length ? `waypoints=${waypoints.map(encodeURIComponent).join("%7C")}` : "",
    `travelmode=${mode}`,
  ].filter(Boolean);

  return `https://www.google.com/maps/dir/?${params.join("&")}`;
}

/**
 * The same links as plain text, for messaging to yourself.
 *
 * Obsidian on the phone is the tidy route, but not everyone syncs their vault
 * to it. Pasted into any chat, these become tappable and open the Maps app.
 */
export function tripLinksText(title: string, places: MapPlace[]): string {
  const usable = places.filter((p) => p.location.trim() || p.address.trim());
  const groups = [...new Set(usable.map((p) => p.group))];
  const out = [`${title} — places`, ""];

  for (const group of groups) {
    out.push(`${group}:`);
    for (const place of usable.filter((p) => p.group === group)) {
      out.push(`${place.name} — ${placeLink(place)}`);
    }
    out.push("");
  }
  return out.join("\n").trimEnd();
}
