import {
  searchAmadeusFlights,
  searchAmadeusHotels,
  getAmadeusQuote,
  confirmAmadeusBooking,
  amadeusConfigured,
} from "./providers/amadeus.mjs";
import { searchTripadvisorHotels, tripadvisorConfigured } from "./providers/tripadvisor.mjs";
import { searchViatorActivities, getViatorQuote, viatorConfigured } from "./providers/viator.mjs";
import { searchOpenTableRestaurants, opentableConfigured } from "./providers/opentable.mjs";

const offerStore = new Map();
const quoteStore = new Map();
const CACHE_TTL_MS = 20 * 60 * 1000;
const searchCache = new Map();

function cacheKey(vertical, input) {
  return `${vertical}:${JSON.stringify(input)}`;
}

function getCached(key) {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    searchCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value) {
  searchCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function storeOffers(offers) {
  for (const offer of offers) {
    offerStore.set(offer.offer_id, offer);
  }
  return offers;
}

export function getOffer(offerId) {
  return offerStore.get(offerId) || null;
}

export function getQuote(quoteId) {
  return quoteStore.get(quoteId) || null;
}

export function providerStatus(env = process.env) {
  return {
    tripadvisor: tripadvisorConfigured(env) ? "configured" : "demo",
    amadeus: amadeusConfigured(env) ? "configured" : "demo",
    viator: viatorConfigured(env) ? "configured" : "demo",
    opentable: opentableConfigured(env) ? "configured" : "fallback",
    booking_enabled: env.TRAVEL_BOOKING_ENABLED === "1",
  };
}

export async function searchHotels(input, env = process.env) {
  const key = cacheKey("hotel", input);
  const cached = getCached(key);
  if (cached) return cached;

  const [ta, am] = await Promise.all([
    searchTripadvisorHotels(input, env),
    searchAmadeusHotels(input, env),
  ]);
  const merged = dedupeOffers([...ta, ...am]).slice(0, 20);
  storeOffers(merged);
  setCache(key, merged);
  return merged;
}

export async function searchFlights(input, env = process.env) {
  const key = cacheKey("flight", input);
  const cached = getCached(key);
  if (cached) return cached;

  const offers = await searchAmadeusFlights(input, env);
  storeOffers(offers);
  setCache(key, offers);
  return offers;
}

export async function searchActivities(input, env = process.env) {
  const key = cacheKey("activity", input);
  const cached = getCached(key);
  if (cached) return cached;

  const offers = await searchViatorActivities(input, env);
  storeOffers(offers);
  setCache(key, offers);
  return offers;
}

export async function searchRestaurants(input, env = process.env) {
  const key = cacheKey("restaurant", input);
  const cached = getCached(key);
  if (cached) return cached;

  const offers = await searchOpenTableRestaurants(input, env);
  storeOffers(offers);
  setCache(key, offers);
  return offers;
}

export async function createQuote({ offer_id }, env = process.env) {
  const offer = getOffer(offer_id);
  if (!offer) {
    return { error: "offer_not_found", message: `No offer found for offer_id: ${offer_id}` };
  }

  let quote;
  if (offer.vertical === "activity") {
    quote = await getViatorQuote(offer.offer_id, offer.provider_ref, env);
  } else {
    quote = await getAmadeusQuote(offer.offer_id, offer.provider_ref, offer.vertical, env);
  }
  quote.title = offer.title;
  quote.affiliate_url = offer.affiliate_url;
  quoteStore.set(quote.quote_id, quote);
  return quote;
}

export async function confirmBooking({ quote_id, confirmation_token }, verifyToken, env = process.env) {
  const tokenResult = verifyToken(quote_id, confirmation_token);
  if (!tokenResult.ok) {
    return {
      ok: false,
      error: tokenResult.error,
      message: "Booking rejected: valid confirmation_token required from Confirm & book button.",
    };
  }

  const quote = getQuote(quote_id);
  if (!quote) {
    return { ok: false, error: "quote_not_found", message: `No quote found for quote_id: ${quote_id}` };
  }

  if (env.TRAVEL_BOOKING_ENABLED !== "1") {
    return {
      ok: false,
      status: "phase1_link_out",
      message:
        "Your confirmation was accepted, but in-app booking is Phase 2. Complete your reservation via the provider link.",
      affiliate_url: quote.affiliate_url,
      quote_id,
    };
  }

  const offer = getOffer(quote.offer_id);
  if (!offer) {
    return { ok: false, error: "offer_not_found" };
  }

  if (offer.vertical === "hotel" || offer.vertical === "flight") {
    return confirmAmadeusBooking(quote_id, offer.provider_ref, offer.vertical, env);
  }

  return {
    ok: false,
    status: "unsupported_vertical",
    message: `In-app booking for ${offer.vertical} is not yet available.`,
    affiliate_url: quote.affiliate_url,
  };
}

function dedupeOffers(offers) {
  const seen = new Set();
  return offers.filter((o) => {
    const key = `${o.title}:${o.location?.city}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function clearStoresForTests() {
  offerStore.clear();
  quoteStore.clear();
  searchCache.clear();
}
