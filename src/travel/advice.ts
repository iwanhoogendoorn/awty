import { requestUrl } from "obsidian";
import { ADVICE_MEANING, adviceUrlFor, parseAdviceColour, type TravelAdvice } from "./adviceData";

export * from "./adviceData";

export class AdviceUnavailable extends Error {}
/**
 * Fetches the current advice for a country.
 *
 * Only ever called from an explicit action — this reaches out to a government
 * website, and a dashboard that silently phones home on render is not something
 * to ship.
 */
export async function fetchAdvice(country: string): Promise<TravelAdvice> {
  const url = adviceUrlFor(country);
  if (!url) {
    throw new AdviceUnavailable(
      `No Dutch travel advice page is published for ${country}.`,
    );
  }

  const response = await requestUrl({ url, throw: false });
  if (response.status === 404) {
    throw new AdviceUnavailable(`No travel advice found for ${country}.`);
  }
  if (response.status !== 200) {
    throw new AdviceUnavailable(`Travel advice returned HTTP ${response.status}.`);
  }

  const colour = parseAdviceColour(response.text);
  if (!colour) {
    throw new AdviceUnavailable(
      "Could not read the colour code from the page — open it to check.",
    );
  }

  return { colour, country, url, fetchedAt: Date.now() };
}
