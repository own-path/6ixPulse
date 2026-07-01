export const TRAVEL_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_hotels",
      description:
        "Search Meridian's hotel inventory for a location and date range. Read-only and side-effect-free — safe to call as many times as needed while narrowing results. Returns up to 20 ranked offers, each with price, rating, and an offer_id. Does not create a booking. To book, call get_quote with an offer_id, then confirm_booking after the user taps Confirm & book.",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "City or neighborhood, e.g. 'Lisbon' or 'Toronto - King West'" },
          check_in: { type: "string", description: "YYYY-MM-DD" },
          check_out: { type: "string", description: "YYYY-MM-DD" },
          guests: { type: "integer", description: "Number of guests" },
        },
        required: ["location", "check_in", "check_out", "guests"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_flights",
      description:
        "Search flight offers between airports or cities for given travel dates. Read-only — returns ranked flight offers with segments, price, and offer_id. Does not book tickets. Use IATA codes when possible (e.g. YYZ, LIS). For round trips include return_date.",
      parameters: {
        type: "object",
        properties: {
          origin: { type: "string", description: "Origin airport/city code, e.g. YYZ" },
          destination: { type: "string", description: "Destination airport/city code, e.g. LIS" },
          departure_date: { type: "string", description: "YYYY-MM-DD" },
          return_date: { type: "string", description: "YYYY-MM-DD for round trip, omit for one-way" },
          passengers: { type: "integer", description: "Number of adult passengers" },
        },
        required: ["origin", "destination", "departure_date", "passengers"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_activities",
      description:
        "Search tours, attractions, and experiences for a destination. Read-only — returns activities with duration, price, rating, and offer_id. Purchases redirect to Viator affiliate links in Phase 1. Combine category, price range, and date filters when the user specifies them.",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "City or region, e.g. 'Lisbon'" },
          category: { type: "string", description: "Optional category: food, culture, adventure, etc." },
          price_min: { type: "number", description: "Minimum price in USD" },
          price_max: { type: "number", description: "Maximum price in USD" },
          date: { type: "string", description: "YYYY-MM-DD preferred activity date" },
        },
        required: ["location"],
      },
    },
    input_examples: [
      { location: "Lisbon", category: "food", date: "2026-06-12" },
      { location: "Toronto", price_max: 80, category: "culture" },
    ],
  },
  {
    type: "function",
    function: {
      name: "search_restaurants",
      description:
        "Search restaurants for a location with optional cuisine, party size, and reservation time. Read-only — returns restaurants with ratings and reservation_url for link-out booking. OpenTable in-app booking requires partner approval; results may use Tripadvisor fallback.",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "City or neighborhood" },
          cuisine: { type: "string", description: "Optional cuisine type" },
          party_size: { type: "integer", description: "Number of diners" },
          date: { type: "string", description: "YYYY-MM-DD" },
          time: { type: "string", description: "HH:MM 24h format" },
        },
        required: ["location"],
      },
    },
    input_examples: [
      { location: "Lisbon", cuisine: "seafood", party_size: 2, date: "2026-06-11", time: "19:30" },
    ],
  },
  {
    type: "function",
    function: {
      name: "get_quote",
      description:
        "Get a firm price quote for a specific offer_id from a prior search. Read-only — returns quote_id, line items, total, and expiry. Does not create a booking. After presenting the quote to the user, wait for them to tap Confirm & book before calling confirm_booking.",
      parameters: {
        type: "object",
        properties: {
          offer_id: { type: "string", description: "offer_id from search_hotels, search_flights, or search_activities" },
        },
        required: ["offer_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_booking",
      description:
        "Finalizes a real reservation and charges the traveler. Requires confirmation_token, which the Meridian app generates only when the user taps 'Confirm & book' on a quote card in the UI. You cannot produce or guess this token — if you don't have one, show the user the quote and wait.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          quote_id: { type: "string" },
          confirmation_token: { type: "string", description: "Server-issued proof of explicit user consent" },
        },
        required: ["quote_id", "confirmation_token"],
        additionalProperties: false,
      },
    },
  },
];

export const TRAVEL_SYSTEM_PROMPT = `You are Meridian Travel Agent, an expert travel discovery assistant inside the Meridian app.

Help users search hotels, flights, activities, and restaurants. Use the provided tools to find real options.
- Call search tools freely to explore and narrow results.
- Present top recommendations with prices and key details.
- For booking: first call get_quote, show the quote, then ONLY call confirm_booking when you have a confirmation_token from the user's Confirm & book tap.
- Never invent offer_id, quote_id, or confirmation_token values.
- For multi-day trip planning, search across verticals (hotels, activities, restaurants) as needed.
- Be concise and helpful. Group results by vertical when planning trips.`;
