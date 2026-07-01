import { searchTripadvisorRestaurants } from "./tripadvisor.mjs";

export function opentableConfigured(env = process.env) {
  return Boolean(env.OPENTABLE_API_KEY);
}

export async function searchOpenTableRestaurants(input, env = process.env) {
  if (!opentableConfigured(env)) {
    const fallback = await searchTripadvisorRestaurants(input, env);
    return fallback.map((offer) => ({
      ...offer,
      metadata: {
        ...offer.metadata,
        opentable_status: "partner_required",
        note: "OpenTable requires a signed partner agreement. Showing Tripadvisor fallback results with reservation link-out.",
      },
      affiliate_url:
        offer.affiliate_url ||
        `https://www.opentable.com/s?covers=${input.party_size || 2}&dateTime=${encodeURIComponent(`${input.date || ""}T${input.time || "19:00"}`)}&term=${encodeURIComponent(input.location || "")}`,
    }));
  }

  // When approved, OpenTable API integration would go here.
  return searchTripadvisorRestaurants(input, env);
}
