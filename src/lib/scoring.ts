import {
  type AgentId,
  type DimensionKey,
  type LayerKey,
  type Neighborhood,
  neighborhoods,
} from "../data/neighborhoods";

export interface ParsedPrompt {
  weights: Record<DimensionKey, number>;
  budget: number;
  cap: number;
}

export interface RankedNeighborhood extends Neighborhood {
  dims: Record<DimensionKey, number>;
  overall: number;
  rank: number;
}

export interface CityAgent {
  id: AgentId;
  name: string;
  color: string;
  tag: string;
}

export interface AgentState extends CityAgent {
  status: "queued" | "scanning" | "scoring" | "done";
  lines: string[];
  score: number | null;
  finding?: string;
}

const palette = {
  ink: "#243a5c",
  deep: "#304b78",
  strong: "#46648d",
  mid: "#5f7faa",
  soft: "#7f99ba",
  mist: "#9fb5ce",
};

export const defaultPrompt =
  "I make $70k, work near Union, want under 45 min commute, safe area, near cafes, max rent $2,200.";

export const cityAgents: CityAgent[] = [
  { id: "affordability", name: "Affordability", color: palette.mid, tag: "Budget" },
  { id: "commute", name: "Commute", color: palette.strong, tag: "Routes" },
  { id: "safety", name: "Safety Signals", color: palette.deep, tag: "Signals" },
  { id: "lifestyle", name: "Lifestyle", color: palette.soft, tag: "Amenities" },
  { id: "growth", name: "Future Growth", color: palette.mist, tag: "Momentum" },
  { id: "recommendation", name: "Recommendation", color: palette.ink, tag: "Consensus" },
];

export function initialAgentStates(top: RankedNeighborhood): AgentState[] {
  return cityAgents.map((agent) => ({
    ...agent,
    status: "done",
    lines: [],
    score: agent.id === "recommendation" ? top.overall : top.dims[agentDimension(agent.id)],
  }));
}

export function queuedAgentStates(): AgentState[] {
  return cityAgents.map((agent) => ({
    ...agent,
    status: "queued",
    lines: [],
    score: null,
  }));
}

export function parsePrompt(prompt: string): ParsedPrompt {
  const source = prompt.toLowerCase();
  const weights: Record<DimensionKey, number> = {
    affordability: 1,
    safety: 1,
    commute: 1,
    transit: 1,
    amenities: 1,
    lifestyle: 1,
    growth: 1,
  };

  if (/safe|safety|secur|crime/.test(source)) weights.safety += 1.5;
  if (/afford|cheap|budget|max rent|under|\brent\b|\$\s?\d/.test(source)) {
    weights.affordability += 1.4;
  }
  if (/union|downtown|commut|\bmin\b|transit|ttc|subway|go train|\bgo\b/.test(source)) {
    weights.commute += 1.2;
    weights.transit += 0.6;
  }
  if (/caf|coffee|park|night|grocer|restaurant|amenit|walk|lifestyle|\bbar\b|food/.test(source)) {
    weights.lifestyle += 1;
    weights.amenities += 0.9;
  }
  if (/growth|invest|future|appreciat|up.?and.?coming|value|momentum|emerging/.test(source)) {
    weights.growth += 1.2;
  }

  let budget: number | null = null;
  const moneyMatches = source.match(/\$\s?([\d,]{3,6})/g);
  if (moneyMatches) {
    const values = moneyMatches
      .map((match) => Number.parseInt(match.replace(/[^\d]/g, ""), 10))
      .filter((value) => value >= 1100 && value <= 6000);
    if (values.length) budget = Math.max(...values);
  }

  const commuteMatch = source.match(/(\d{2,3})\s*min/);

  return {
    weights,
    budget: budget ?? 2200,
    cap: commuteMatch ? Number.parseInt(commuteMatch[1], 10) : 45,
  };
}

export function rankNeighborhoods(
  parsed: ParsedPrompt,
  rows: Neighborhood[] = neighborhoods,
): RankedNeighborhood[] {
  const weightSum = Object.values(parsed.weights).reduce((sum, value) => sum + value, 0);
  const ranked = rows.map((neighborhood) => {
    const dims = neighborhood.scores;
    let base = 0;
    for (const dimension of Object.keys(parsed.weights) as DimensionKey[]) {
      base += dims[dimension] * parsed.weights[dimension];
    }
    base /= weightSum;

    let adjustment = 0;
    if (neighborhood.rentHi <= parsed.budget) adjustment += 4;
    else if (neighborhood.rentLo > parsed.budget) adjustment -= 11;
    else adjustment -= 2;

    const commuteMidpoint = (neighborhood.comLo + neighborhood.comHi) / 2;
    if (commuteMidpoint > parsed.cap) adjustment -= (commuteMidpoint - parsed.cap) * 0.6;

    return {
      ...neighborhood,
      dims,
      overall: clamp(Math.round(base + adjustment), 34, 99),
      rank: 0,
    };
  });

  ranked.sort((a, b) => b.overall - a.overall || b.scores.affordability - a.scores.affordability);
  return ranked.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function agentDimension(id: AgentId): DimensionKey {
  if (id === "recommendation") return "growth";
  if (id === "affordability") return "affordability";
  if (id === "commute") return "commute";
  if (id === "safety") return "safety";
  if (id === "lifestyle") return "lifestyle";
  return "growth";
}

export function layerScore(neighborhood: RankedNeighborhood, layer: LayerKey): number {
  if (layer === "overall") return neighborhood.overall;
  if (layer === "rent") return neighborhood.dims.affordability;
  return neighborhood.dims[layer];
}

export function consensus(overall: number) {
  if (overall >= 88) return { label: "Strong fit", color: palette.ink };
  if (overall >= 80) return { label: "Solid fit", color: palette.deep };
  if (overall >= 72) return { label: "Fair fit", color: palette.strong };
  return { label: "Limited fit", color: palette.soft };
}

export function tagFor(neighborhood: RankedNeighborhood) {
  const scores = Object.values(neighborhood.dims);
  const spread = Math.max(...scores) - Math.min(...scores);

  if (
    neighborhood.dims.growth >= 84 &&
    neighborhood.dims.growth >= neighborhood.dims.affordability
  ) {
    return { label: "Up and coming", color: palette.strong };
  }
  if (neighborhood.dims.affordability >= 84) {
    return {
      label: neighborhood.overall >= 82 ? "Great value" : "Good value",
      color: palette.mid,
    };
  }
  if (spread <= 16) {
    return {
      label: neighborhood.overall >= 82 ? "Great balance" : "Balanced",
      color: palette.deep,
    };
  }
  if (neighborhood.dims.lifestyle >= 86) return { label: "Vibrant", color: palette.soft };
  if (neighborhood.dims.commute >= 86) return { label: "Well connected", color: palette.strong };
  return { label: "Solid pick", color: palette.ink };
}

export function formatRentRange(neighborhood: Neighborhood): string {
  return `$${neighborhood.rentLo.toLocaleString()}-${neighborhood.rentHi.toLocaleString()}`;
}

export function getAgentThinking(id: AgentId, parsed: ParsedPrompt): string[] {
  const budget = parsed.budget.toLocaleString();
  const cap = parsed.cap;
  const lines: Record<AgentId, string[]> = {
    affordability: [
      "Scanning one-bedroom rent across 14 areas",
      `Comparing medians to your $${budget} cap`,
      "Scoring budget fit and flagging overpriced zones",
    ],
    commute: [
      "Routing every area to Union Station",
      `Weighing GO, subway and streetcar vs ${cap} min`,
      "Scoring commute burden and transfers",
    ],
    safety: [
      "Aggregating reported incident density",
      "Normalising by population and time of day",
      "Setting relative safety signals with data limits",
    ],
    lifestyle: [
      "Mapping cafes, parks, groceries and nightlife",
      "Gauging walkability and local character",
      "Scoring lifestyle fit",
    ],
    growth: [
      "Reading rent trajectories and permits",
      "Tracking transit expansion and development",
      "Projecting 12-month momentum",
    ],
    recommendation: [
      "Gathering every agent finding",
      "Weighting by your stated priorities",
      "Forming consensus and ranking neighborhoods",
    ],
  };
  return lines[id];
}

export function getAgentFinding(id: AgentId, neighborhood: RankedNeighborhood, parsed: ParsedPrompt) {
  const tier = (score: number) => {
    if (score >= 85) return "excellent";
    if (score >= 78) return "strong";
    if (score >= 70) return "fair";
    return "limited";
  };
  const commuteMidpoint = Math.round((neighborhood.comLo + neighborhood.comHi) / 2);

  if (id === "affordability") {
    const relation =
      neighborhood.rentHi <= parsed.budget
        ? "fits under"
        : neighborhood.rentLo > parsed.budget
          ? "runs above"
          : "brushes";
    return `One-bed rent ${formatRentRange(neighborhood)} ${relation} your $${parsed.budget.toLocaleString()} cap. Budget fit is ${tier(neighborhood.dims.affordability)}.`;
  }
  if (id === "commute") {
    return `About ${commuteMidpoint} min to Union via ${neighborhood.comMode}; ${
      commuteMidpoint <= parsed.cap ? "under" : "around"
    } your ${parsed.cap}-min target.`;
  }
  if (id === "safety") {
    return `Relative safety signals read ${tier(neighborhood.dims.safety)} here from reported incident density. Confidence is limited by public data quality.`;
  }
  if (id === "lifestyle") {
    return `${neighborhood.lifeHi}. Cafe, park and grocery density is ${tier(neighborhood.dims.amenities)}.`;
  }
  if (id === "growth") {
    return `${neighborhood.growthNote}. Rent is projected ${
      neighborhood.trend > 0 ? "+" : ""
    }${neighborhood.trend}% over the next 12 months.`;
  }
  return `Agents converge on ${neighborhood.name}: ${consensus(neighborhood.overall).label}. ${neighborhood.short}`;
}

export function colorForScore(score: number): string {
  const t = clamp((score - 36) / 63, 0, 1);
  const lightness = 57 - t * 26;
  return `hsl(214 42% ${lightness.toFixed(0)}%)`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
