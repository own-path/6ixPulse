export type DimensionKey =
  | "affordability"
  | "safety"
  | "commute"
  | "transit"
  | "amenities"
  | "lifestyle"
  | "growth";

export type AgentId =
  | "affordability"
  | "commute"
  | "safety"
  | "lifestyle"
  | "growth"
  | "recommendation";

export type LayerKey =
  | "overall"
  | "safety"
  | "rent"
  | "commute"
  | "amenities"
  | "transit"
  | "lifestyle"
  | "growth";

export type LngLat = [number, number];

export interface Neighborhood {
  id: string;
  name: string;
  center: LngLat;
  radiusLng: number;
  radiusLat: number;
  seed: number;
  scores: Record<DimensionKey, number>;
  rentLo: number;
  rentHi: number;
  comLo: number;
  comHi: number;
  comMode: string;
  trend: number;
  growthNote: string;
  lifeHi: string;
  short: string;
  tradeoff: string;
}

export interface NeighborhoodFeatureProperties {
  id: string;
  name: string;
}

export const DIMENSIONS: DimensionKey[] = [
  "affordability",
  "safety",
  "commute",
  "transit",
  "amenities",
  "lifestyle",
  "growth",
];

export const neighborhoods: Neighborhood[] = [
  {
    id: "mimico",
    name: "Mimico",
    center: [-79.5005, 43.6179],
    radiusLng: 0.034,
    radiusLat: 0.017,
    seed: 1,
    scores: {
      affordability: 82,
      safety: 80,
      commute: 78,
      transit: 76,
      amenities: 72,
      lifestyle: 74,
      growth: 84,
    },
    rentLo: 1850,
    rentHi: 2200,
    comLo: 28,
    comHi: 38,
    comMode: "GO",
    trend: 6.2,
    growthNote: "Waterfront density and GO upgrades fuelling demand",
    lifeHi: "Lakefront parks and a quiet cafe strip",
    short: "A calm lakeshore pocket with honest rent and a quick GO hop to Union.",
    tradeoff: "Nightlife is limited, so late venues usually mean heading east.",
  },
  {
    id: "eastyork",
    name: "East York",
    center: [-79.333, 43.6945],
    radiusLng: 0.031,
    radiusLat: 0.024,
    seed: 2,
    scores: {
      affordability: 85,
      safety: 82,
      commute: 74,
      transit: 78,
      amenities: 76,
      lifestyle: 78,
      growth: 75,
    },
    rentLo: 1700,
    rentHi: 2150,
    comLo: 32,
    comHi: 42,
    comMode: "TTC",
    trend: 4.1,
    growthNote: "Steady family-driven demand",
    lifeHi: "Leafy streets with grocers and diners",
    short: "Dependable value with subway reach and low-key neighborhood comfort.",
    tradeoff: "Commute stretches in rush hour on surface routes.",
  },
  {
    id: "scarbjct",
    name: "Scarborough Junction",
    center: [-79.257, 43.716],
    radiusLng: 0.04,
    radiusLat: 0.025,
    seed: 3,
    scores: {
      affordability: 90,
      safety: 68,
      commute: 66,
      transit: 64,
      amenities: 62,
      lifestyle: 60,
      growth: 78,
    },
    rentLo: 1650,
    rentHi: 2100,
    comLo: 35,
    comHi: 45,
    comMode: "GO + TTC",
    trend: 7.4,
    growthNote: "Eglinton East LRT on the horizon",
    lifeHi: "Affordable plazas and community hubs",
    short: "The budget winner with the most space per dollar and a bet on transit to come.",
    tradeoff: "Safety signals are mixed and the commute is transfer-heavy today.",
  },
  {
    id: "weston",
    name: "Weston",
    center: [-79.5158, 43.7003],
    radiusLng: 0.032,
    radiusLat: 0.024,
    seed: 4,
    scores: {
      affordability: 88,
      safety: 66,
      commute: 72,
      transit: 74,
      amenities: 60,
      lifestyle: 58,
      growth: 82,
    },
    rentLo: 1600,
    rentHi: 2000,
    comLo: 40,
    comHi: 50,
    comMode: "UP Express",
    trend: 6.8,
    growthNote: "UP Express access spurring renewal",
    lifeHi: "A revitalising main street",
    short: "Cheap with a surprise express line and early signs of renewal.",
    tradeoff: "Amenities thin out after dark and safety signals are mixed.",
  },
  {
    id: "northyork",
    name: "North York Edges",
    center: [-79.413, 43.7615],
    radiusLng: 0.048,
    radiusLat: 0.031,
    seed: 5,
    scores: {
      affordability: 80,
      safety: 78,
      commute: 70,
      transit: 80,
      amenities: 74,
      lifestyle: 70,
      growth: 74,
    },
    rentLo: 1800,
    rentHi: 2200,
    comLo: 30,
    comHi: 45,
    comMode: "subway",
    trend: 4.6,
    growthNote: "Transit-oriented mid-rise growth",
    lifeHi: "Plaza dining and big parks",
    short: "Subway-anchored balance between price and reach.",
    tradeoff: "Some edges feel car-first and spread out.",
  },
  {
    id: "leslieville",
    name: "Leslieville",
    center: [-79.3345, 43.6628],
    radiusLng: 0.024,
    radiusLat: 0.017,
    seed: 6,
    scores: {
      affordability: 70,
      safety: 80,
      commute: 80,
      transit: 80,
      amenities: 88,
      lifestyle: 90,
      growth: 80,
    },
    rentLo: 1950,
    rentHi: 2400,
    comLo: 22,
    comHi: 30,
    comMode: "streetcar",
    trend: 5.7,
    growthNote: "Maturing east-end momentum",
    lifeHi: "Brunch, breweries and boutiques",
    short: "East-end charm and cafes galore, a short streetcar from the core.",
    tradeoff: "Top-end rent can edge past the cap on newer units.",
  },
  {
    id: "liberty",
    name: "Liberty Village",
    center: [-79.4197, 43.6375],
    radiusLng: 0.021,
    radiusLat: 0.013,
    seed: 7,
    scores: {
      affordability: 55,
      safety: 84,
      commute: 90,
      transit: 82,
      amenities: 90,
      lifestyle: 92,
      growth: 70,
    },
    rentLo: 2200,
    rentHi: 2800,
    comLo: 12,
    comHi: 20,
    comMode: "GO + streetcar",
    trend: 2.4,
    growthNote: "Largely built out with slower upside",
    lifeHi: "Dense gyms, bars and coffee",
    short: "Walk-everywhere energy minutes from Union at a premium.",
    tradeoff: "Rent runs above budget with little room to grow in value.",
  },
  {
    id: "parkdale",
    name: "Parkdale",
    center: [-79.4373, 43.6405],
    radiusLng: 0.025,
    radiusLat: 0.016,
    seed: 8,
    scores: {
      affordability: 76,
      safety: 64,
      commute: 84,
      transit: 82,
      amenities: 80,
      lifestyle: 82,
      growth: 76,
    },
    rentLo: 1750,
    rentHi: 2200,
    comLo: 18,
    comHi: 26,
    comMode: "streetcar",
    trend: 5.1,
    growthNote: "Gentrifying lakeside stretch",
    lifeHi: "Eclectic eats and live music",
    short: "Characterful, well-connected and still within reach on rent.",
    tradeoff: "Safety signals vary block to block, so a local look matters.",
  },
  {
    id: "junction",
    name: "The Junction",
    center: [-79.4695, 43.6655],
    radiusLng: 0.029,
    radiusLat: 0.019,
    seed: 9,
    scores: {
      affordability: 72,
      safety: 74,
      commute: 76,
      transit: 72,
      amenities: 82,
      lifestyle: 84,
      growth: 86,
    },
    rentLo: 1850,
    rentHi: 2300,
    comLo: 28,
    comHi: 36,
    comMode: "UP Express",
    trend: 6.5,
    growthNote: "Strong creative-class influx",
    lifeHi: "Indie cafes, makers and brunch",
    short: "A rising west-end scene with the best growth read on the board.",
    tradeoff: "Transit needs a transfer and rent is climbing fast.",
  },
  {
    id: "yongeeg",
    name: "Yonge & Eglinton",
    center: [-79.3986, 43.7064],
    radiusLng: 0.026,
    radiusLat: 0.018,
    seed: 10,
    scores: {
      affordability: 60,
      safety: 82,
      commute: 80,
      transit: 86,
      amenities: 86,
      lifestyle: 84,
      growth: 88,
    },
    rentLo: 2050,
    rentHi: 2600,
    comLo: 22,
    comHi: 30,
    comMode: "subway + LRT",
    trend: 6.9,
    growthNote: "Crosstown LRT unlocking access",
    lifeHi: "A buzzy midtown core",
    short: "Midtown convenience with the Crosstown about to change the math.",
    tradeoff: "Premium rent pushes past budget for most units.",
  },
  {
    id: "danforth",
    name: "Danforth",
    center: [-79.347, 43.6795],
    radiusLng: 0.032,
    radiusLat: 0.014,
    seed: 11,
    scores: {
      affordability: 74,
      safety: 81,
      commute: 82,
      transit: 88,
      amenities: 86,
      lifestyle: 88,
      growth: 76,
    },
    rentLo: 1900,
    rentHi: 2300,
    comLo: 20,
    comHi: 28,
    comMode: "subway",
    trend: 4.8,
    growthNote: "Steady transit-rich demand",
    lifeHi: "Greektown patios and groceries",
    short: "Subway-on-your-doorstep living with a great food street.",
    tradeoff: "Newer one-beds creep toward the top of the range.",
  },
  {
    id: "regent",
    name: "Regent Park",
    center: [-79.3606, 43.6607],
    radiusLng: 0.018,
    radiusLat: 0.013,
    seed: 12,
    scores: {
      affordability: 78,
      safety: 70,
      commute: 88,
      transit: 84,
      amenities: 76,
      lifestyle: 74,
      growth: 90,
    },
    rentLo: 1800,
    rentHi: 2250,
    comLo: 12,
    comHi: 18,
    comMode: "streetcar",
    trend: 8.1,
    growthNote: "Landmark revitalisation underway",
    lifeHi: "New parks and a community centre",
    short: "A renewed downtown-edge district with the strongest momentum.",
    tradeoff: "Transition is ongoing and safety signals are still settling.",
  },
  {
    id: "etobicoke",
    name: "Etobicoke",
    center: [-79.568, 43.654],
    radiusLng: 0.052,
    radiusLat: 0.03,
    seed: 13,
    scores: {
      affordability: 84,
      safety: 76,
      commute: 64,
      transit: 66,
      amenities: 68,
      lifestyle: 66,
      growth: 72,
    },
    rentLo: 1700,
    rentHi: 2100,
    comLo: 38,
    comHi: 52,
    comMode: "GO + bus",
    trend: 4.3,
    growthNote: "Affordable suburban steadiness",
    lifeHi: "Big-box ease and trails",
    short: "Roomy and affordable if you can accept a longer haul to Union.",
    tradeoff: "Commute and transit access are the clear trade-offs.",
  },
  {
    id: "downtown",
    name: "Downtown Core",
    center: [-79.3832, 43.6532],
    radiusLng: 0.024,
    radiusLat: 0.018,
    seed: 14,
    scores: {
      affordability: 48,
      safety: 72,
      commute: 95,
      transit: 95,
      amenities: 95,
      lifestyle: 90,
      growth: 68,
    },
    rentLo: 2300,
    rentHi: 3000,
    comLo: 5,
    comHi: 15,
    comMode: "subway + walk",
    trend: 2.1,
    growthNote: "Saturated market with thin upside",
    lifeHi: "Everything at your door",
    short: "Unbeatable access and amenities if budget were not the question.",
    tradeoff: "Well over the rent cap; you pay for the convenience.",
  },
];

export const unionStation: LngLat = [-79.3806, 43.6452];

function mockBoundary(
  [lng, lat]: LngLat,
  radiusLng: number,
  radiusLat: number,
  seed: number,
): LngLat[] {
  const points: LngLat[] = [];
  for (let i = 0; i < 18; i += 1) {
    const angle = (Math.PI * 2 * i) / 18;
    const wobble = 1 + Math.sin(seed * 1.7 + i * 0.9) * 0.14;
    points.push([
      Number((lng + Math.cos(angle) * radiusLng * wobble).toFixed(6)),
      Number((lat + Math.sin(angle) * radiusLat * wobble).toFixed(6)),
    ]);
  }
  points.push(points[0]);
  return points;
}

export function buildNeighborhoodGeoJson(rows = neighborhoods) {
  return {
    type: "FeatureCollection",
    features: rows.map((neighborhood) => ({
      type: "Feature",
      properties: {
        id: neighborhood.id,
        name: neighborhood.name,
      } satisfies NeighborhoodFeatureProperties,
      geometry: {
        type: "Polygon",
        coordinates: [
          mockBoundary(
            neighborhood.center,
            neighborhood.radiusLng,
            neighborhood.radiusLat,
            neighborhood.seed,
          ),
        ],
      },
    })),
  };
}
