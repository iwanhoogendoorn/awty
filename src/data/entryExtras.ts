/**
 * Entry formalities that are not visas.
 *
 * The visa dataset answers "do I need a visa", and for a growing number of
 * countries that is the wrong question: Thailand wants a digital arrival card
 * from everyone, visa or not, and the UK wants an ETA from almost everyone who
 * is not British or Irish. Nothing in a visa table says so, so a trip could
 * read "no visa needed" and still be refused boarding.
 *
 * Curated by hand and deliberately short. Every entry links to the government
 * site that owns the rule, because these change with little notice and this
 * file is a prompt to check, never the authority.
 */
export interface EntryExtra {
  /** Country as the visa dataset names it. */
  country: string;
  name: string;
  /** What it is, in one sentence. */
  detail: string;
  /** Where it is actually done. */
  url: string;
  /** "before" — arrange ahead; "arrival" — done on the way in. */
  when: "before" | "arrival";
  /** Announced but not yet enforced: worth knowing, not yet worth doing. */
  status: "required" | "announced";
  /** Rough cost, or "Free". */
  cost: string;
}

/** When these entries were last checked against their official sources. */
export const ENTRY_EXTRAS_VERIFIED = "2026-08-05";

export const ENTRY_EXTRAS: EntryExtra[] = [
  {
    country: "Thailand",
    name: "Thailand Digital Arrival Card (TDAC)",
    detail:
      "Required of every non-Thai traveller arriving by air, land or sea, whether or not a visa is needed. Submit within 72 hours before you arrive.",
    url: "https://tdac.immigration.go.th",
    when: "before",
    status: "required",
    cost: "Free",
  },
  {
    country: "United Kingdom",
    name: "Electronic Travel Authorisation (ETA)",
    detail:
      "Needed by visitors without a British or Irish passport and without existing permission to live, work or study in the UK. Airlines must refuse boarding without it.",
    url: "https://www.gov.uk/eta",
    when: "before",
    status: "required",
    cost: "£16",
  },
  {
    country: "United States",
    name: "ESTA",
    detail: "Travel authorisation for Visa Waiver Programme passports, arranged before you fly.",
    url: "https://esta.cbp.dhs.gov",
    when: "before",
    status: "required",
    cost: "US$21",
  },
  {
    country: "Canada",
    name: "eTA",
    detail: "Electronic travel authorisation for visa-exempt travellers arriving by air.",
    url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta.html",
    when: "before",
    status: "required",
    cost: "C$7",
  },
  {
    country: "Australia",
    name: "ETA or eVisitor",
    detail: "Every visitor needs one or the other before travelling; which depends on the passport.",
    url: "https://immi.homeaffairs.gov.au",
    when: "before",
    status: "required",
    cost: "A$20 (ETA), free (eVisitor)",
  },
  {
    country: "New Zealand",
    name: "NZeTA and visitor levy",
    detail: "Request the NZeTA before you travel; the conservation levy is paid with it.",
    url: "https://www.immigration.govt.nz/new-zealand-visas/visas/visa/nzeta",
    when: "before",
    status: "required",
    cost: "NZ$17 + NZ$100 levy",
  },
  {
    country: "South Korea",
    name: "K-ETA",
    detail:
      "Travel authorisation for visa-free visitors. Some nationalities are temporarily exempt — check before assuming.",
    url: "https://www.k-eta.go.kr",
    when: "before",
    status: "required",
    cost: "₩10,000",
  },
  {
    country: "Singapore",
    name: "SG Arrival Card",
    detail: "An arrival card every visitor submits, within three days before arriving.",
    url: "https://eservices.ica.gov.sg/sgarrivalcard",
    when: "before",
    status: "required",
    cost: "Free",
  },
  {
    country: "Sri Lanka",
    name: "ETA",
    detail: "Electronic travel authorisation, arranged before arrival.",
    url: "https://www.eta.gov.lk",
    when: "before",
    status: "required",
    cost: "US$50",
  },
  {
    country: "Japan",
    name: "Visit Japan Web",
    detail:
      "Immigration and customs filled in online beforehand. Not compulsory, but it is the fast lane at the airport.",
    url: "https://services.digital.go.jp/en/visit-japan-web",
    when: "before",
    status: "required",
    cost: "Free",
  },
  {
    country: "Indonesia",
    name: "All Indonesia customs declaration",
    detail: "Customs declaration submitted online, from two days before you arrive.",
    url: "https://allindonesia.beacukai.go.id",
    when: "arrival",
    status: "required",
    cost: "Free",
  },
];

/**
 * Announced but not in force. Kept apart from the rest on purpose: telling
 * someone to arrange something that does not exist yet is its own error.
 */
export const ENTRY_EXTRAS_COMING: EntryExtra[] = [
  {
    country: "Schengen area",
    name: "ETIAS",
    detail:
      "A travel authorisation for visa-free visitors to 30 European countries. Repeatedly delayed and still unscheduled as of August 2026; 2027 is the realistic expectation. Nothing to do yet.",
    url: "https://travel-europe.europa.eu/etias_en",
    when: "before",
    status: "announced",
    cost: "€20",
  },
];

/** Everything extra a country asks for, in force first. */
export function entryExtrasFor(country: string): EntryExtra[] {
  const wanted = country.trim().toLowerCase();
  if (!wanted) return [];
  return [...ENTRY_EXTRAS, ...ENTRY_EXTRAS_COMING].filter(
    (extra) => extra.country.toLowerCase() === wanted,
  );
}
