/**
 * Names people search for that are not cities.
 *
 * The city dataset holds cities, and holidays are sold by island, region and
 * resort. Someone going to Bali types "Bali", gets Balikpapan — a different
 * island thirteen hundred kilometres away — and the trip is wrong from that
 * moment: wrong Food Spot filter, wrong restaurants, wrong airport on every
 * suggested flight. Nothing warns them, because Balikpapan is a real city.
 *
 * Each alias resolves to a city that exists in the dataset, checked at the
 * time of writing. Kept short and obvious rather than exhaustive.
 */
export interface PlaceAlias {
  /** What people type. */
  alias: string;
  /** The city the datasets know. */
  city: string;
  country: string;
}

export const PLACE_ALIASES: PlaceAlias[] = [
  { alias: "Bali", city: "Denpasar", country: "Indonesia" },
  { alias: "Java", city: "Jakarta", country: "Indonesia" },
  { alias: "Lombok", city: "Mataram", country: "Indonesia" },
  { alias: "Mallorca", city: "Palma", country: "Spain" },
  { alias: "Majorca", city: "Palma", country: "Spain" },
  { alias: "Tenerife", city: "Santa Cruz de Tenerife", country: "Spain" },
  { alias: "Gran Canaria", city: "Las Palmas de Gran Canaria", country: "Spain" },
  { alias: "Lanzarote", city: "Arrecife", country: "Spain" },
  { alias: "Fuerteventura", city: "Puerto del Rosario", country: "Spain" },
  { alias: "Madeira", city: "Funchal", country: "Portugal" },
  { alias: "Algarve", city: "Faro", country: "Portugal" },
  { alias: "Azores", city: "Ponta Delgada", country: "Portugal" },
  { alias: "Sicily", city: "Palermo", country: "Italy" },
  { alias: "Sardinia", city: "Cagliari", country: "Italy" },
  { alias: "Corsica", city: "Ajaccio", country: "France" },
  { alias: "Zanzibar", city: "Zanzibar", country: "Tanzania" },
  { alias: "Maui", city: "Kahului", country: "United States" },
  { alias: "Oahu", city: "Honolulu", country: "United States" },
  { alias: "Bora Bora", city: "Papeete", country: "French Polynesia" },
  { alias: "Cape Cod", city: "Barnstable", country: "United States" },
];

/** Aliases matching what has been typed, so a picker can offer them. */
export function aliasMatches(query: string): PlaceAlias[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return PLACE_ALIASES.filter((entry) => entry.alias.toLowerCase().startsWith(needle));
}
