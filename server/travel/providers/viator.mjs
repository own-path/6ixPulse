import { formatPrice, makeOfferId } from "../schemas.mjs";

const DEMO_ACTIVITIES = [
  { title: "Lisbon Hop-On Hop-Off Bus Tour", duration: "24 hours", price: 32 },
  { title: "Sintra and Pena Palace Day Trip", duration: "8 hours", price: 89 },
  { title: "Pastel de Nata Baking Class", duration: "3 hours", price: 55 },
];

export function viatorConfigured(env = process.env) {
  return Boolean(env.VIATOR_API_KEY);
}

export async function searchViatorActivities(
  { location, category, price_min, price_max, date },
  env = process.env,
) {
  if (!viatorConfigured(env)) {
    return demoActivities(location, category, price_min, price_max, date, env);
  }

  try {
    const affiliateId = env.VIATOR_AFFILIATE_ID || "";
    const response = await fetch("https://api.viator.com/partner/products/search", {
      method: "POST",
      headers: {
        "Accept-Language": "en-US",
        Accept: "application/json;version=2.0",
        "Content-Type": "application/json",
        "exp-api-key": env.VIATOR_API_KEY,
      },
      body: JSON.stringify({
        filtering: { destination: location },
        pagination: { start: 1, count: 10 },
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return demoActivities(location, category, price_min, price_max, date, env);

    const data = await response.json();
    const products = Array.isArray(data?.products) ? data.products : [];
    return products.map((p, index) => {
      const ref = p.productCode || `vi-${index}`;
      const price = p.pricing?.summary?.fromPrice || 50;
      const affiliate = `https://www.viator.com/tours/${encodeURIComponent(location)}/${ref}?pid=${affiliateId}`;
      return {
        offer_id: makeOfferId("activity", "viator", ref),
        vertical: "activity",
        title: p.title || `Activity in ${location}`,
        location: { city: location },
        price: formatPrice(Number(price), p.pricing?.currency || "USD"),
        rating: p.reviews?.combinedAverageRating,
        image_url: p.images?.[0]?.variants?.[0]?.url,
        provider: "viator",
        provider_ref: String(ref),
        affiliate_url: affiliate,
        metadata: { category, price_min, price_max, date },
      };
    });
  } catch {
    return demoActivities(location, category, price_min, price_max, date, env);
  }
}

function demoActivities(location, category, price_min, price_max, date, env) {
  const affiliateId = env.VIATOR_AFFILIATE_ID || "";
  return DEMO_ACTIVITIES.map((a, index) => {
    const ref = `demo-vi-${index}`;
    const city = location || "Lisbon";
    return {
      offer_id: makeOfferId("activity", "viator", ref),
      vertical: "activity",
      title: a.title,
      location: { city },
      price: formatPrice(a.price, "USD"),
      provider: "demo",
      provider_ref: ref,
      affiliate_url: `https://www.viator.com/searchResults/all?text=${encodeURIComponent(city)}&pid=${affiliateId}`,
      metadata: { duration: a.duration, category, price_min, price_max, date, demo: true },
    };
  });
}

export async function getViatorQuote(offerId, providerRef, env = process.env) {
  const amount = 55;
  return {
    quote_id: `quote_${providerRef}`,
    offer_id: offerId,
    vertical: "activity",
    title: "Activity quote",
    line_items: [{ label: "Activity price", price: formatPrice(amount, "USD") }],
    total: formatPrice(amount, "USD"),
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    affiliate_url: `https://www.viator.com/`,
    provider: viatorConfigured(env) ? "viator" : "demo",
  };
}
