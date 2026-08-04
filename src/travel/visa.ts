import { COUNTRY_NAME_BY_ISO2, VISA } from "../data/visa";
import { fold } from "../util/search";

export type VisaOutcome =
  | "visa-free"
  | "visa-on-arrival"
  | "e-visa"
  | "eta"
  | "visa-required"
  | "no-admission"
  | "same-country"
  | "unknown";

export interface VisaCheck {
  outcome: VisaOutcome;
  /** Days you may stay without a visa, when the dataset gives a figure. */
  days: number | null;
  passport: string;
  destination: string;
  label: string;
  detail: string;
  /** Whether this needs action before departure. */
  actionNeeded: boolean;
}

const ISO2_BY_NAME = new Map<string, string>();
for (const [iso2, name] of Object.entries(COUNTRY_NAME_BY_ISO2)) {
  ISO2_BY_NAME.set(fold(name), iso2);
}

export function iso2ForCountry(name: string): string | null {
  if (!name) return null;
  return ISO2_BY_NAME.get(fold(name.trim())) ?? null;
}

export function countryNameForIso2(iso2: string): string {
  return COUNTRY_NAME_BY_ISO2[iso2.toUpperCase()] ?? iso2.toUpperCase();
}

/** Every country with a passport in the dataset, for the settings picker. */
export function passportCountries(): string[] {
  return Object.keys(VISA)
    .map((iso2) => countryNameForIso2(iso2))
    .sort((a, b) => a.localeCompare(b));
}

interface OutcomeSpec {
  outcome: VisaOutcome;
  label: string;
  action: boolean;
  /** Written per outcome; one template produced "does not need no visa needed". */
  sentence: (passport: string, destination: string) => string;
}

const OUTCOMES: Record<string, OutcomeSpec> = {
  F: {
    outcome: "visa-free",
    label: "No visa needed",
    action: false,
    sentence: (p, d) => `A ${p} passport needs no visa for ${d}.`,
  },
  A: {
    outcome: "visa-on-arrival",
    label: "Visa on arrival",
    action: true,
    sentence: (p, d) => `A ${p} passport gets a visa on arrival in ${d}.`,
  },
  E: {
    outcome: "e-visa",
    label: "e-Visa required",
    action: true,
    sentence: (p, d) => `A ${p} passport needs an e-Visa for ${d}, arranged before you travel.`,
  },
  T: {
    outcome: "eta",
    label: "Travel authorisation required",
    action: true,
    sentence: (p, d) => `A ${p} passport needs travel authorisation for ${d}, arranged before you fly.`,
  },
  R: {
    outcome: "visa-required",
    label: "Visa required",
    action: true,
    sentence: (p, d) => `A ${p} passport needs a visa for ${d}, arranged before you travel.`,
  },
  N: {
    outcome: "no-admission",
    label: "Entry not permitted",
    action: true,
    sentence: (p, d) => `${d} does not admit holders of a ${p} passport.`,
  },
};

/**
 * Whether a given passport needs a visa for a given destination.
 *
 * The data is the open passport-index dataset, which is maintained but not
 * authoritative — rules change with politics and at no notice. Every result is
 * presented as a prompt to check the official source, never as a guarantee.
 */
export function checkVisa(passportCountry: string, destinationCountry: string): VisaCheck {
  const passport = iso2ForCountry(passportCountry);
  const destination = iso2ForCountry(destinationCountry);

  const base = {
    days: null,
    passport: passportCountry,
    destination: destinationCountry,
    actionNeeded: false,
  };

  if (!passport || !destination) {
    return {
      ...base,
      outcome: "unknown",
      label: "Not known",
      detail: "No visa data for this combination.",
    };
  }
  if (passport === destination) {
    return {
      ...base,
      outcome: "same-country",
      label: "Your own country",
      detail: "No entry requirements to check.",
    };
  }

  const group = VISA[passport];
  if (!group) {
    return {
      ...base,
      outcome: "unknown",
      label: "Not known",
      detail: `No data for a ${passportCountry} passport.`,
    };
  }

  for (const [token, list] of Object.entries(group)) {
    if (!list.split(",").includes(destination)) continue;

    // A numeric token is a visa-free allowance in days.
    if (/^\d+$/.test(token)) {
      const days = Number(token);
      return {
        ...base,
        outcome: "visa-free",
        days,
        label: `No visa needed · ${days} days`,
        detail: `A ${passportCountry} passport allows up to ${days} days in ${destinationCountry} without a visa.`,
      };
    }

    const spec = OUTCOMES[token];
    if (!spec) continue;
    return {
      ...base,
      outcome: spec.outcome,
      label: spec.label,
      actionNeeded: spec.action,
      detail: spec.sentence(passportCountry, destinationCountry),
    };
  }

  return {
    ...base,
    outcome: "unknown",
    label: "Not known",
    detail: `No entry rule recorded for a ${passportCountry} passport in ${destinationCountry}.`,
  };
}

/** How long the trip is, against how long you may stay. */
export function exceedsAllowance(check: VisaCheck, tripDays: number): boolean {
  return check.days !== null && tripDays > check.days;
}
