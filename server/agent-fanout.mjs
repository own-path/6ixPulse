import { agenticChat, resolveMainProvider, resolveSummarizerProvider } from "./model-chat.mjs";

// Per-agent multi-model fan-out (the hybrid). The agent first plans a task for every City
// Agent; each dimension agent then researches ONLY its own evidence via the configured
// agentic model and records the sources it used; finally the Recommendation agent runs with
// EVERY other agent's finding + their combined sources and makes the call.
const FANOUT_AGENTS = [
  { id: "affordability", focus: "typical rent / affordability vs the renter's budget", categories: ["rent", "market", "affordability_score"] },
  { id: "commute", focus: "commute time to Union Station and transit access", categories: ["commute", "transit", "commute_score", "transit_score"] },
  { id: "safety", focus: "neighbourhood safety from reported-crime data", categories: ["safety", "safety_score"] },
  { id: "lifestyle", focus: "cafes, parks, amenities and street life", categories: ["lifestyle", "amenities_score", "lifestyle_score", "reviews", "community", "context"] },
  { id: "growth", focus: "development activity and growth trend", categories: ["growth", "development", "market", "growth_score"] },
];

export async function runAgentFanOut(localRun, env = process.env) {
  if (env.AGENT_FANOUT !== "1") return null;
  // Main agentic brain (Nemotron when keyed) makes the decisions; the small local model
  // (OpenBMB/llama.cpp) assists by summarising each agent's evidence into its finding.
  const mainProvider = resolveMainProvider(env);
  const summarizer = resolveSummarizerProvider(env);
  if (!mainProvider && !summarizer) return null;

  const selected = localRun.ranked[0];
  const webResearch = localRun.webResearch;
  if (!selected || !webResearch?.sources?.length) return null;

  // Sequential, not parallel: small local servers (and rate-limited cloud models) choke on
  // a burst of concurrent calls.
  // Summarise on the assistant first, fall back to the main brain if it is unavailable.
  const summarizeChain = [summarizer, mainProvider].filter((p, i, a) => p && a.indexOf(p) === i);
  const decideChain = [mainProvider, summarizer].filter((p, i, a) => p && a.indexOf(p) === i);

  const findings = [];
  for (const agent of FANOUT_AGENTS) {
    const note = await runOneAgent(agent, selected, webResearch, summarizeChain, env);
    if (note) findings.push(note);
  }

  // Recommendation agent runs LAST on the main brain, with every other agent's finding + all
  // their sources.
  if (findings.length) {
    const recommendation = await runRecommendationAgent(findings, selected, decideChain, env);
    if (recommendation) findings.push(recommendation);
  }

  return findings;
}

async function runOneAgent(agent, selected, webResearch, providerChain, env) {
  const usedSources = uniqueSources(
    (webResearch.sources || []).filter(
      (s) => s.agentId === agent.id || agent.categories.includes(s.category),
    ),
  );
  const sourceLines = usedSources
    .slice(0, 5)
    .map((s) => `- ${s.name} (${s.domain})`);
  const factLines = (webResearch.facts || [])
    .filter((f) => agent.categories.includes(f.category))
    .slice(0, 5)
    .map((f) => `- ${f.label}: ${f.value} ${f.unit || ""} [${f.sourceName || f.sourceId}]`);

  if (!sourceLines.length && !factLines.length) return null;

  const messages = [
    {
      role: "system",
      content:
        `You are the ${agent.id} agent for ${selected.name}, Toronto. Using ONLY the evidence below, ` +
        `write one concise sentence about ${agent.focus}, naming a source in parentheses. ` +
        `If evidence is thin, say so plainly. Return strict JSON: {"finding": "...", "confidence": "low|medium|high"}.`,
    },
    { role: "user", content: `Evidence for ${selected.name}:\n${[...factLines, ...sourceLines].join("\n")}` },
  ];

  const finding = await chatFinding(messages, providerChain, env);
  if (!finding) return null;
  return {
    id: agent.id,
    finding: finding.text,
    confidence: finding.confidence,
    model: finding.model,
    sources: usedSources.map((s) => s.name),
  };
}

// Try each provider in the chain until one returns a plausible, parseable finding.
async function chatFinding(messages, providerChain, env) {
  for (const provider of providerChain) {
    const result = await agenticChat(messages, env, {
      provider,
      json: true,
      maxTokens: 220,
      timeoutMs: Number(env.AGENT_FANOUT_TIMEOUT_MS || 45000),
    });
    if (!result) continue;
    const parsed = safeJson(result.content);
    const text = typeof parsed?.finding === "string" ? parsed.finding.replace(/\s+/g, " ").trim() : "";
    if (!isPlausibleFinding(text)) continue;
    return {
      text,
      confidence: ["low", "medium", "high"].includes(parsed.confidence) ? parsed.confidence : "medium",
      model: result.model,
    };
  }
  return null;
}

// Reject junk from weak local models (e.g. "...", "12345") so it never overrides the
// sourced evidence-policy findings: require real words, not digits/punctuation.
function isPlausibleFinding(text) {
  if (typeof text !== "string") return false;
  const t = text.trim();
  const words = t.split(/\s+/).filter((w) => /[a-z]{3,}/i.test(w));
  return t.length >= 18 && words.length >= 4;
}

async function runRecommendationAgent(findings, selected, providerChain, env) {
  const dimNotes = findings.filter((f) => f.id !== "recommendation");
  const allSources = uniqueNames(dimNotes.flatMap((f) => f.sources || []));
  const findingLines = dimNotes.map((f) => `- ${f.id}: ${f.finding}`);

  const messages = [
    {
      role: "system",
      content:
        `You are the Recommendation agent for ${selected.name}, Toronto. The other City Agents have ` +
        `reported below, each backed by real sources. Weigh them together and state, in ONE sentence, ` +
        `whether ${selected.name} fits the renter and the single most important reason. ` +
        `Return strict JSON: {"finding": "...", "confidence": "low|medium|high"}.`,
    },
    {
      role: "user",
      content: `Agent findings:\n${findingLines.join("\n")}\n\nSources gathered across agents: ${allSources.join(", ")}`,
    },
  ];

  const finding = await chatFinding(messages, providerChain, env);
  // Keep the aggregated sources even if the decision text didn't come back cleanly.
  return {
    id: "recommendation",
    finding: finding ? finding.text : null,
    confidence: finding ? finding.confidence : "medium",
    model: finding ? finding.model : null,
    sources: allSources,
  };
}

function uniqueSources(sources) {
  const seen = new Set();
  const out = [];
  for (const s of sources) {
    const name = s.sourceName || s.title || s.id;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, domain: s.domain || "" });
  }
  return out;
}

function uniqueNames(names) {
  return [...new Set(names.filter(Boolean))];
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
