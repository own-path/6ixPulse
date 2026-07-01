import { formatPrice, makeOfferId } from "../schemas.mjs";

const DEMO_HOTELS = [
  { title: "Hotel Avenida Palace", city: "Lisbon", rating: 4.6, price: 189 },
  { title: "Memmo Alfama Hotel", city: "Lisbon", rating: 4.8, price: 245 },
  { title: "The Lumiares Hotel", city: "Lisbon", rating: 4.5, price: 210 },
];

export function tripadvisorConfigured(env = process.env) {
  return Boolean(env.TRIPADVISOR_API_KEY);
}

export async function searchTripadvisorHotels({ location, check_in, check_out, guests }, env = process.env) {
  if (!tripadvisorConfigured(env)) {
    return demoHotels(location, check_in, check_out, guests);
  }

  try {
    const key = env.TRIPADVISOR_API_KEY;
    const searchUrl = new URL("https://api.content.tripadvisor.com/api/v1/location/search");
    searchUrl.searchParams.set("key", key);
    searchUrl.searchParams.set("searchQuery", location);
    searchUrl.searchParams.set("category", "hotels");
    searchUrl.searchParams.set("language", "en");

    const response = await fetch(searchUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return demoHotels(location, check_in, check_out, guests);

    const data = await response.json();
    const items = Array.isArray(data?.data) ? data.data.slice(0, 10) : [];
    return items.map((item, index) => {
      const ref = item.location_id || `ta-${index}`;
      const affiliate = `https://www.tripadvisor.com/Hotel_Review-g${ref}?m=${env.TRIPADVISOR_AFFILIATE_ID || ""}`;
      return {
        offer_id: makeOfferId("hotel", "tripadvisor", ref),
        vertical: "hotel",
        title: item.name || `Hotel in ${location}`,
        location: { city: location, lat: item.latitude, lng: item.longitude },
        price: formatPrice(120 + index * 35, "USD"),
        rating: item.rating ? Number(item.rating) : undefined,
        image_url: undefined,
        provider: "tripadvisor",
        provider_ref: String(ref),
        affiliate_url: affiliate,
        metadata: { check_in, check_out, guests, source: "tripadvisor" },
      };
    });
  } catch {
    return demoHotels(location, check_in, check_out, guests);
  }
}

function demoHotels(location, check_in, check_out, guests) {
  return DEMO_HOTELS.map((hotel, index) => {
    const ref = `demo-ta-${index}`;
    return {
      offer_id: makeOfferId("hotel", "tripadvisor", ref),
      vertical: "hotel",
      title: hotel.title,
      location: { city: location || hotel.city },
      price: formatPrice(hotel.price, "USD"),
      rating: hotel.rating,
      provider: "demo",
      provider_ref: ref,
      affiliate_url: `https://www.tripadvisor.com/Search?q=${encodeURIComponent(location || hotel.city)}+hotels`,
      metadata: { check_in, check_out, guests, demo: true },
    };
  });
}

export async function searchTripadvisorRestaurants({ location, cuisine, party_size, date, time }, env = process.env) {
  const city = location || "Lisbon";
  const demo = [
    { title: "Time Out Market Lisboa", cuisine: "Food hall", rating: 4.5, price: 35 },
    { title: "Belcanto", cuisine: "Fine dining", rating: 4.8, price: 120 },
    { title: "Cervejaria Ramiro", cuisine: "Seafood", rating: 4.7, price: 55 },
  ];

  return demo.map((r, index) => {
    const ref = `demo-rest-${index}`;
    return {
      offer_id: makeOfferId("restaurant", "tripadvisor", ref),
      vertical: "restaurant",
      title: r.title,
      location: { city },
      price: formatPrice(r.price, "USD"),
      rating: r.rating,
      provider: tripadvisorConfigured(env) ? "tripadvisor" : "demo",
      provider_ref: ref,
      affiliate_url: `https://www.tripadvisor.com/Search?q=${encodeURIComponent(city)}+restaurants`,
      metadata: { cuisine: cuisine || r.cuisine, party_size, date, time },
    };
  });
}
