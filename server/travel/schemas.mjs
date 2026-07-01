/** @typedef {"hotel" | "flight" | "activity" | "restaurant"} TravelVertical */
/** @typedef {"tripadvisor" | "amadeus" | "viator" | "opentable" | "demo"} TravelProvider */

/**
 * @typedef {object} TravelLocation
 * @property {string} city
 * @property {string} [country]
 * @property {number} [lat]
 * @property {number} [lng]
 */

/**
 * @typedef {object} TravelPrice
 * @property {number} amount
 * @property {string} currency
 * @property {string} display
 */

/**
 * @typedef {object} TravelOffer
 * @property {string} offer_id
 * @property {TravelVertical} vertical
 * @property {string} title
 * @property {TravelLocation} location
 * @property {TravelPrice} price
 * @property {number} [rating]
 * @property {string} [image_url]
 * @property {TravelProvider} provider
 * @property {string} provider_ref
 * @property {string} affiliate_url
 * @property {Record<string, unknown>} metadata
 */

/**
 * @typedef {object} TravelQuoteLine
 * @property {string} label
 * @property {TravelPrice} price
 */

/**
 * @typedef {object} TravelQuote
 * @property {string} quote_id
 * @property {string} offer_id
 * @property {TravelVertical} vertical
 * @property {string} title
 * @property {TravelQuoteLine[]} line_items
 * @property {TravelPrice} total
 * @property {string} expires_at
 * @property {string} affiliate_url
 * @property {TravelProvider} provider
 */

/**
 * @typedef {object} BookingResult
 * @property {boolean} ok
 * @property {string} [booking_id]
 * @property {string} [status]
 * @property {string} [message]
 * @property {string} [affiliate_url]
 */

export function makeOfferId(vertical, provider, ref) {
  const slug = String(ref || "x")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 48);
  return `${vertical}_${provider}_${slug}`;
}

export function formatPrice(amount, currency = "USD") {
  const display = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
  return { amount, currency, display };
}
