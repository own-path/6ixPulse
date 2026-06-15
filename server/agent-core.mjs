import { DIMENSIONS, cityAgents, neighborhoods } from "./neighborhoods.mjs";

export const defaultPrompt =
  "I make $70k, work near Union, want under 45 min commute, safe area, near cafes, max rent $2,200.";

export function parsePrompt(prompt) {
  const source = String(prompt || "").toLowerCase();
  const weights = {
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

  let budget = null;
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

export function rankNeighborhoods(parsed, rows = neighborhoods) {
  const weightSum = Object.values(parsed.weights).reduce((sum, value) => sum + value, 0);
  const ranked = rows.map((neighborhood) => {
    const dims = neighborhood.scores;
    let base = 0;
    for (const dimension of DIMENSIONS) {
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

export function agentDimension(id) {
  if (id === "recommendation") return "growth";
  if (id === "affordability") return "affordability";
  if (id === "commute") return "commute";
  if (id === "safety") return "safety";
  if (id === "lifestyle") return "lifestyle";
  return "growth";
}

export function initialAgentStates(top) {
  return cityAgents.map((agent) => ({
    ...agent,
    status: "done",
    lines: getAgentThinking(agent.id, parsePrompt(defaultPrompt)),
    score: agent.id === "recommendation" ? top.overall : top.dims[agentDimension(agent.id)],
    finding: getAgentFinding(agent.id, top, parsePrompt(defaultPrompt)),
  }));
}

export function getAgentThinking(id, parsed) {
  const budget = parsed.budget.toLocaleString();
  const cap = parsed.cap;
  const lines = {
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

export function getAgentFinding(id, neighborhood, parsed) {
  const tier = (score) => {
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

export function buildLocalAgentRun(prompt, rows = neighborhoods) {
  const normalizedPrompt = String(prompt || defaultPrompt).trim() || defaultPrompt;
  const trace = [];

  const parsed = traceTool(trace, "parse_renter_intent", { prompt: normalizedPrompt }, () =>
    parsePrompt(normalizedPrompt),
  );
  const ranked = traceTool(trace, "rank_neighborhoods", parsed, () => rankNeighborhoods(parsed, rows));
  const top = ranked[0];

  const dimensionChecks = {
    affordability: evaluateAffordability(top, parsed),
    commute: evaluateCommute(top, parsed),
    safety: evaluateSafety(top),
    lifestyle: evaluateLifestyle(top),
    growth: evaluateGrowth(top),
  };

  for (const [tool, output] of Object.entries(dimensionChecks)) {
    traceTool(trace, `evaluate_${tool}`, { neighborhoodId: top.id }, () => output);
  }

  const agents = cityAgents.map((agent) => ({
    ...agent,
    status: "done",
    lines: getAgentThinking(agent.id, parsed),
    score: agent.id === "recommendation" ? top.overall : top.dims[agentDimension(agent.id)],
    finding: getAgentFinding(agent.id, top, parsed),
  }));

  const recommendation = traceTool(
    trace,
    "recommend_neighborhood",
    { topNeighborhoodId: top.id, rankedIds: ranked.slice(0, 5).map((row) => row.id) },
    () => buildLocalRecommendation(top, ranked, parsed),
  );

  return {
    ok: true,
    mode: "local-fallback",
    model: null,
    prompt: normalizedPrompt,
    parsed,
    ranked,
    selectedId: top.id,
    agents,
    recommendation,
    trace,
  };
}

export function buildModelContext(localRun) {
  return {
    prompt: localRun.prompt,
    parsed: localRun.parsed,
    topMatches: localRun.ranked.slice(0, 7).map(summarizeNeighborhood),
    selected: summarizeNeighborhood(localRun.ranked[0]),
    agentFindings: localRun.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      candidateScore: agent.score,
    })),
    webResearch: localRun.webResearch || null,
    trace: localRun.trace.filter((step) =>
      ["parse_renter_intent", "housing_web_research"].includes(step.tool),
    ),
  };
}

export function mergeModelRecommendation(localRun, modelResult, modelName, mode = "hf") {
  const recommendation = normalizeRecommendation(modelResult, localRun);
  const agents = localRun.agents.map((agent) => {
    const note = recommendation.agentNotes.find((item) => item.id === agent.id);
    return {
      ...agent,
      finding: note?.finding || agent.finding,
    };
  });

  return {
    ...localRun,
    mode,
    model: modelName,
    agents,
    recommendation,
  };
}

export function applyEvidencePolicy(run) {
  const selected = run.ranked.find((row) => row.id === run.selectedId) || run.ranked[0];
  if (!selected) return run;

  const webResearch = run.webResearch || null;
  const evidenceNotes = buildEvidenceAgentNotes(selected, webResearch);
  const recommendation = buildEvidenceRecommendation(run, selected, webResearch, evidenceNotes);

  return {
    ...run,
    agents: run.agents.map((agent) => {
      const evidenceNote = evidenceNotes.find((note) => note.id === agent.id);
      return {
        ...agent,
        score: evidenceNote?.score,
        finding: evidenceNote?.finding || `${agent.name} needs source evidence before showing a finding.`,
      };
    }),
    recommendation,
    trace: sanitizeTrace(run.trace),
    evidencePolicy: {
      mode: "source-backed-or-hidden",
      note: "Candidate heuristics remain internal ranking scaffolding. User-facing claims require computed webResearch.facts.",
    },
  };
}

export function summarizeNeighborhood(row) {
  return {
    id: row.id,
    name: row.name,
    rank: row.rank,
    candidateHeuristics: {
      overall: row.overall,
      dims: row.dims,
      estimatedRent: { low: row.rentLo, high: row.rentHi },
      estimatedCommute: { low: row.comLo, high: row.comHi, mode: row.comMode },
      estimatedTrend: row.trend,
      growthNote: row.growthNote,
      lifestyleNote: row.lifeHi,
      short: row.short,
      tradeoff: row.tradeoff,
    },
  };
}

function buildEvidenceAgentNotes(selected, webResearch) {
  const notes = [];
  const safetyFact = findNeighborhoodFact(webResearch, selected.name, "safety");
  const rentFact = findNeighborhoodFact(webResearch, selected.name, "rent");
  const commuteFact = findNeighborhoodFact(webResearch, selected.name, "commute");
  const lifestyleFact = findNeighborhoodFact(webResearch, selected.name, "lifestyle");
  const growthFact = findNeighborhoodFact(webResearch, selected.name, "growth");

  if (rentFact) {
    notes.push({
      id: "affordability",
      finding: formatFactFinding(rentFact),
      confidence: confidenceFromReliability(rentFact.reliability),
    });
  }
  if (commuteFact) {
    notes.push({
      id: "commute",
      finding: formatFactFinding(commuteFact),
      confidence: confidenceFromReliability(commuteFact.reliability),
    });
  }
  if (safetyFact) {
    notes.push({
      id: "safety",
      finding: formatFactFinding(safetyFact),
      confidence: confidenceFromReliability(safetyFact.reliability),
    });
  }
  if (lifestyleFact) {
    notes.push({
      id: "lifestyle",
      finding: formatFactFinding(lifestyleFact),
      confidence: confidenceFromReliability(lifestyleFact.reliability),
    });
  }
  if (growthFact) {
    notes.push({
      id: "growth",
      finding: formatFactFinding(growthFact),
      confidence: confidenceFromReliability(growthFact.reliability),
    });
  }

  if (rentFact && commuteFact && safetyFact) {
    notes.push({
      id: "recommendation",
      finding: `${selected.name} has source-backed affordability, commute, and safety evidence for this prompt.`,
      confidence: "medium",
    });
  }

  // Attach the computed dimension score to each note so the agent cards show numbers.
  const dimForAgent = {
    affordability: "affordability",
    commute: "commute",
    safety: "safety",
    lifestyle: "lifestyle",
    growth: "growth",
  };
  for (const note of notes) {
    note.score =
      note.id === "recommendation"
        ? selected.overall
        : selected.dims?.[dimForAgent[note.id]] ?? null;
  }

  return notes;
}

function buildEvidenceRecommendation(run, selected, webResearch, evidenceNotes) {
  const safetyFact = findNeighborhoodFact(webResearch, selected.name, "safety");
  const rentFact = findNeighborhoodFact(webResearch, selected.name, "rent");
  const commuteFact = findNeighborhoodFact(webResearch, selected.name, "commute");
  const growthFact = findNeighborhoodFact(webResearch, selected.name, "growth");
  const facts = [safetyFact, rentFact, commuteFact, growthFact].filter(Boolean);
  const factWhy = facts.map(formatFactFinding);
  const gaps = [];

  if (!rentFact) gaps.push("Rent evidence still needs a current listing feed, market report, or licensed rental data source.");
  if (!commuteFact) gaps.push("Commute evidence still needs a route calculation from Google Routes or a GTFS router.");
  if (!safetyFact) gaps.push("Safety evidence still needs a matched Toronto Police/Open Data fact.");
  if (!growthFact) gaps.push("Growth evidence still needs computed permit, CMHC, listing-history, or market-trend facts.");

  const hasCoreRecommendation = Boolean(rentFact && commuteFact && safetyFact);

  return {
    summary: hasCoreRecommendation
      ? `${selected.name} has the required source-backed rent, commute, and safety evidence for this prompt.`
      : `Research found ${webResearch?.sources?.length || 0} sources and ${
          webResearch?.facts?.length || 0
        } computed facts, but core rent, route, and safety evidence is not complete enough for a final recommendation.`,
    selectedId: selected.id,
    rankedIds: hasCoreRecommendation
      ? run.ranked.slice(0, 7).map((row) => row.id)
      : [selected.id],
    why: factWhy,
    cautions: gaps.slice(0, 4),
    nextQuestions: [
      "Should the research prioritize verified listings, commute routing, safety, or resident reviews next?",
      "What property type and bedroom count should the listing search enforce?",
      "Do you want the agent to include Reddit and Google review evidence in the resident-sentiment layer?",
    ],
    agentNotes: evidenceNotes.map(({ score, ...note }) => note),
    citations: buildFactCitations(webResearch, facts),
  };
}

function sanitizeTrace(trace = []) {
  const visibleTools = new Set(["discover_neighborhoods", "plan_research", "parse_renter_intent", "housing_web_research", "score_neighborhoods", "hf_reasoning", "nvidia_reasoning", "llamacpp_reasoning"]);
  return trace
    .filter((step) => visibleTools.has(step.tool) || step.tool.startsWith("agent_"))
    .map((step) => {
      if (step.tool === "parse_renter_intent") return step;
      return {
        ...step,
        output: step.output,
      };
    });
}

function buildFactCitations(webResearch, facts) {
  if (!webResearch?.sources?.length) return [];
  const sourceIds = new Set(facts.map((fact) => fact.sourceId));
  return webResearch.sources
    .filter((source) => sourceIds.has(source.id))
    .map((source) => ({
      sourceId: source.id,
      note: `${source.title} supplied a computed ${source.category} fact.`,
    }));
}

function findNeighborhoodFact(webResearch, neighborhood, category) {
  if (!webResearch?.enabled || !Array.isArray(webResearch.facts)) return null;
  const target = normalizeEvidenceName(neighborhood);
  return (
    webResearch.facts.find((fact) => {
      const factNeighborhood = normalizeEvidenceName(fact.neighborhood);
      return (
        fact.category === category &&
        (factNeighborhood === target ||
          factNeighborhood.includes(target) ||
          target.includes(factNeighborhood))
      );
    }) || null
  );
}

function formatFactFinding(fact) {
  return `${fact.neighborhood}: ${Number.isFinite(Number(fact.value)) ? Number(fact.value).toLocaleString() : fact.value} ${
    fact.unit
  } (${fact.sourceId}). ${fact.detail}`;
}

function confidenceFromReliability(reliability) {
  if (reliability === "high") return "high";
  if (reliability === "medium") return "medium";
  return "low";
}

function normalizeEvidenceName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeRecommendation(modelResult, localRun) {
  const top = localRun.ranked[0];
  const fallback = localRun.recommendation;
  const validIds = new Set(localRun.ranked.map((row) => row.id));
  const rankedIds = listOfStrings(modelResult?.rankedIds)
    .filter((id) => validIds.has(id))
    .slice(0, 7);

  const agentNotes = Array.isArray(modelResult?.agentNotes)
    ? modelResult.agentNotes
        .filter((note) => note && typeof note.id === "string" && typeof note.finding === "string")
        .map((note) => ({
          id: note.id,
          finding: oneLine(note.finding),
          confidence: ["low", "medium", "high"].includes(note.confidence) ? note.confidence : "medium",
        }))
    : [];
  const why = listOfStrings(modelResult?.why).slice(0, 5).map(oneLine);
  const cautions = listOfStrings(modelResult?.cautions).slice(0, 4).map(oneLine);
  const nextQuestions = listOfStrings(modelResult?.nextQuestions).slice(0, 4).map(oneLine);
  const validSourceIds = new Set((localRun.webResearch?.sources || []).map((source) => source.id));
  const citations = Array.isArray(modelResult?.citations)
    ? modelResult.citations
        .filter((citation) => citation && validSourceIds.has(citation.sourceId))
        .map((citation) => ({
          sourceId: citation.sourceId,
          note: typeof citation.note === "string" ? oneLine(citation.note) : "",
        }))
        .slice(0, 8)
    : [];

  return {
    summary:
      typeof modelResult?.summary === "string" && modelResult.summary.trim()
        ? oneLine(modelResult.summary)
        : fallback.summary,
    selectedId: validIds.has(modelResult?.selectedId) ? modelResult.selectedId : top.id,
    rankedIds: rankedIds.length ? rankedIds : fallback.rankedIds,
    why: why.length ? why : fallback.why,
    cautions: cautions.length ? cautions : fallback.cautions,
    nextQuestions: nextQuestions.length ? nextQuestions : fallback.nextQuestions,
    agentNotes: agentNotes.length ? agentNotes : fallback.agentNotes,
    citations,
  };
}

function buildLocalRecommendation(top, ranked, parsed) {
  const commuteMidpoint = Math.round((top.comLo + top.comHi) / 2);
  const cautions = [top.tradeoff];
  if (top.rentHi > parsed.budget) {
    cautions.push(`Top-end rent can exceed your $${parsed.budget.toLocaleString()} cap.`);
  }
  if (commuteMidpoint > parsed.cap) {
    cautions.push(`Average commute is above your ${parsed.cap}-minute target.`);
  }
  if (top.dims.safety < 74) {
    cautions.push("Safety signals are mixed enough to validate block by block.");
  }

  return {
    summary: `${top.name} is the strongest fit across your budget, commute, safety, lifestyle, and growth priorities.`,
    selectedId: top.id,
    rankedIds: ranked.slice(0, 7).map((row) => row.id),
    why: [
      `${formatRentRange(top)} typical one-bedroom rent against a $${parsed.budget.toLocaleString()} cap.`,
      `${top.comLo}-${top.comHi} minutes to Union via ${top.comMode}.`,
      `${top.lifeHi}.`,
      `${top.growthNote}.`,
    ],
    cautions: [...new Set(cautions)].slice(0, 4),
    nextQuestions: [
      "Do you want to optimize for fewer transfers or lower rent first?",
      "Should the agent filter for newer buildings or older rent-controlled stock?",
      "Do you prefer quieter streets or stronger nightlife access?",
    ],
    agentNotes: cityAgents.map((agent) => ({
      id: agent.id,
      finding: getAgentFinding(agent.id, top, parsed),
      confidence: agent.id === "safety" ? "medium" : "high",
    })),
  };
}

function evaluateAffordability(neighborhood, parsed) {
  return {
    rentRange: [neighborhood.rentLo, neighborhood.rentHi],
    budget: parsed.budget,
    fitsBudget: neighborhood.rentHi <= parsed.budget,
    score: neighborhood.dims.affordability,
  };
}

function evaluateCommute(neighborhood, parsed) {
  const midpoint = Math.round((neighborhood.comLo + neighborhood.comHi) / 2);
  return {
    rangeMinutes: [neighborhood.comLo, neighborhood.comHi],
    midpoint,
    targetMinutes: parsed.cap,
    mode: neighborhood.comMode,
    withinTarget: midpoint <= parsed.cap,
    score: neighborhood.dims.commute,
  };
}

function evaluateSafety(neighborhood) {
  return {
    score: neighborhood.dims.safety,
    limitation: "Candidate heuristic only; use current public data and local inspection before presenting safety claims.",
  };
}

function evaluateLifestyle(neighborhood) {
  return {
    amenitiesScore: neighborhood.dims.amenities,
    lifestyleScore: neighborhood.dims.lifestyle,
    highlight: neighborhood.lifeHi,
  };
}

function evaluateGrowth(neighborhood) {
  return {
    score: neighborhood.dims.growth,
    trendPercent: neighborhood.trend,
    note: neighborhood.growthNote,
  };
}

function traceTool(trace, tool, input, fn) {
  const id = `step_${String(trace.length + 1).padStart(2, "0")}`;
  try {
    const output = fn();
    trace.push({
      id,
      tool,
      status: "done",
      input: compact(input),
      output: compact(output),
    });
    return output;
  } catch (error) {
    trace.push({
      id,
      tool,
      status: "error",
      input: compact(input),
      output: { message: error instanceof Error ? error.message : "Unknown tool error" },
    });
    throw error;
  }
}

function compact(value) {
  if (Array.isArray(value)) return value.slice(0, 8).map(compact);
  if (!value || typeof value !== "object") return value;
  if ("overall" in value && "dims" in value) return summarizeNeighborhood(value);

  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "ranked") continue;
    next[key] = Array.isArray(item) ? item.slice(0, 8).map(compact) : compact(item);
  }
  return next;
}

function consensus(overall) {
  if (overall >= 88) return { label: "Strong fit", color: paletteLabel("ink") };
  if (overall >= 80) return { label: "Solid fit", color: paletteLabel("deep") };
  if (overall >= 72) return { label: "Fair fit", color: paletteLabel("strong") };
  return { label: "Limited fit", color: paletteLabel("soft") };
}

function paletteLabel(name) {
  const colors = {
    ink: "#243a5c",
    deep: "#304b78",
    strong: "#46648d",
    soft: "#7f99ba",
  };
  return colors[name];
}

function formatRentRange(neighborhood) {
  return `$${neighborhood.rentLo.toLocaleString()}-${neighborhood.rentHi.toLocaleString()}`;
}

function listOfStrings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];
}

function oneLine(value) {
  return value.replace(/\s+/g, " ").trim();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
