import { formatPrice, makeOfferId } from "../schemas.mjs";

let tokenCache = { token: null, expiresAt: 0 };

export function amadeusConfigured(env = process.env) {
  return Boolean(env.AMADEUS_CLIENT_ID && env.AMADEUS_CLIENT_SECRET);
}

function baseUrl(env = process.env) {
  return env.AMADEUS_ENV === "production"
    ? "https://api.amadeus.com"
    : "https://test.api.amadeus.com";
}

async function getAccessToken(env = process.env) {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 30_000) {
    return tokenCache.token;
  }
  const response = await fetch(`${baseUrl(env)}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.AMADEUS_CLIENT_ID,
      client_secret: env.AMADEUS_CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Amadeus auth failed");
  const data = await response.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 1800) * 1000,
  };
  return tokenCache.token;
}

async function amadeusFetch(path, params, env) {
  const token = await getAccessToken(env);
  const url = new URL(`${baseUrl(env)}${path}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Amadeus ${path} failed: ${response.status}`);
  return response.json();
}

export async function searchAmadeusHotels({ location, check_in, check_out, guests }, env = process.env) {
  if (!amadeusConfigured(env)) return demoHotels(location, check_in, check_out, guests);

  try {
    const cityCode = await resolveCityCode(location, env);
    const data = await amadeusFetch(
      "/v3/shopping/hotel-offers",
      {
        cityCode,
        checkInDate: check_in,
        checkOutDate: check_out,
        adults: guests || 2,
        roomQuantity: 1,
      },
      env,
    );
    const offers = Array.isArray(data?.data) ? data.data.slice(0, 10) : [];
    return offers.map((item, index) => {
      const hotel = item.hotel || {};
      const offer = item.offers?.[0] || {};
      const price = offer.price || {};
      const ref = offer.id || hotel.hotelId || `am-${index}`;
      const amount = Number(price.total || price.base || 150);
      return {
        offer_id: makeOfferId("hotel", "amadeus", ref),
        vertical: "hotel",
        title: hotel.name || `Hotel in ${location}`,
        location: { city: location },
        price: formatPrice(amount, price.currency || "USD"),
        rating: undefined,
        provider: "amadeus",
        provider_ref: String(ref),
        affiliate_url: `https://www.amadeus.com/`,
        metadata: { check_in, check_out, guests, amadeus_offer: offer },
      };
    });
  } catch {
    return demoHotels(location, check_in, check_out, guests);
  }
}

export async function searchAmadeusFlights(
  { origin, destination, departure_date, return_date, passengers },
  env = process.env,
) {
  if (!amadeusConfigured(env)) return demoFlights(origin, destination, departure_date, return_date, passengers);

  try {
    const params = {
      originLocationCode: origin,
      destinationLocationCode: destination,
      departureDate: departure_date,
      adults: passengers || 1,
      max: 10,
      currencyCode: "USD",
    };
    if (return_date) params.returnDate = return_date;

    const data = await amadeusFetch("/v2/shopping/flight-offers", params, env);
    const offers = Array.isArray(data?.data) ? data.data.slice(0, 10) : [];
    return offers.map((item, index) => {
      const ref = item.id || `fl-${index}`;
      const seg = item.itineraries?.[0]?.segments?.[0] || {};
      const price = item.price || {};
      const amount = Number(price.total || price.grandTotal || 400);
      return {
        offer_id: makeOfferId("flight", "amadeus", ref),
        vertical: "flight",
        title: `${seg.carrierCode || "Flight"} ${seg.number || ""} · ${origin} → ${destination}`.trim(),
        location: { city: destination },
        price: formatPrice(amount, price.currency || "USD"),
        provider: "amadeus",
        provider_ref: String(ref),
        affiliate_url: `https://www.amadeus.com/`,
        metadata: {
          origin,
          destination,
          departure_date,
          return_date,
          passengers,
          segments: item.itineraries,
          amadeus_offer: item,
        },
      };
    });
  } catch {
    return demoFlights(origin, destination, departure_date, return_date, passengers);
  }
}

export async function getAmadeusQuote(offerId, providerRef, vertical, env = process.env) {
  const amount = vertical === "flight" ? 420 : 195;
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  return {
    quote_id: `quote_${providerRef}`,
    offer_id: offerId,
    vertical,
    title: vertical === "flight" ? "Flight quote" : "Hotel quote",
    line_items: [
      { label: "Base fare", price: formatPrice(amount * 0.85, "USD") },
      { label: "Taxes & fees", price: formatPrice(amount * 0.15, "USD") },
    ],
    total: formatPrice(amount, "USD"),
    expires_at: expires,
    affiliate_url: `https://www.amadeus.com/`,
    provider: amadeusConfigured(env) ? "amadeus" : "demo",
    metadata: { provider_ref: providerRef },
  };
}

export async function confirmAmadeusBooking(quoteId, providerRef, vertical, env = process.env) {
  if (env.TRAVEL_BOOKING_ENABLED !== "1") {
    return {
      ok: false,
      status: "booking_disabled",
      message: "In-app booking is not enabled yet. Use the affiliate link to complete your reservation.",
      affiliate_url: `https://www.amadeus.com/`,
    };
  }

  // Phase 2 stub: real Amadeus order creation would go here.
  return {
    ok: true,
    booking_id: `amd_${quoteId}`,
    status: "confirmed",
    message: "Booking confirmed via Amadeus (test environment).",
  };
}

async function resolveCityCode(location, env) {
  const data = await amadeusFetch(
    "/v1/reference-data/locations",
    { keyword: location, subType: "CITY", max: 1 },
    env,
  );
  const code = data?.data?.[0]?.iataCode;
  if (!code) throw new Error(`No city code for ${location}`);
  return code;
}

function demoHotels(location, check_in, check_out, guests) {
  return [
    { title: "Bairro Alto Hotel", price: 175, rating: 4.7 },
    { title: "Corinthia Lisbon", price: 220, rating: 4.6 },
  ].map((h, i) => {
    const ref = `demo-am-h-${i}`;
    return {
      offer_id: makeOfferId("hotel", "amadeus", ref),
      vertical: "hotel",
      title: h.title,
      location: { city: location || "Lisbon" },
      price: formatPrice(h.price, "USD"),
      rating: h.rating,
      provider: "demo",
      provider_ref: ref,
      affiliate_url: `https://www.amadeus.com/`,
      metadata: { check_in, check_out, guests, demo: true },
    };
  });
}

function demoFlights(origin, destination, departure_date, return_date, passengers) {
  const ref = "demo-fl-0";
  return [
    {
      offer_id: makeOfferId("flight", "amadeus", ref),
      vertical: "flight",
      title: `${origin || "YYZ"} → ${destination || "LIS"} · Round trip`,
      location: { city: destination || "Lisbon" },
      price: formatPrice(680, "USD"),
      provider: "demo",
      provider_ref: ref,
      affiliate_url: `https://www.amadeus.com/`,
      metadata: { origin, destination, departure_date, return_date, passengers, demo: true },
    },
  ];
}
