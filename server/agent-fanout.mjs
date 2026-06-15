import { agenticChat, resolveActiveProvider } from "./model-chat.mjs";

// Per-agent multi-model fan-out (the hybrid). Each City Agent is "spawned" as its own
// focused call to the configured agentic model (Nemotron / OpenBMB-on-llama.cpp / HF),
// extracting one evidence-based finding from only that agent's sources. The main model
// then synthesises the recommendation from those findings.
const FANOUT_AGENTS = [
  { id: "affordability", focus: "typical rent / affordability", categories: ["rent", "market"] },
  { id: "commute", focus: "commute time and transit access", categories: ["commute", "transit"] },
  { id: "safety", focus: "neighbourhood safety", categories: ["safety"] },
  { id: "lifestyle", focus: "cafes, parks, amenities and vibe", categories: ["lifestyle", "reviews", "community", "context"] },
  { id: "growth", focus: "development and growth trend", categories: ["growth", "development", "market"] },
];

export async function runAgentFanOut(localRun, env = process.env) {
  if (env.AGENT_FANOUT !== "1") return null;
  const provider = resolveActiveProvider(env);
  if (!provider) return null;

  const selected = localRun.ranked[0];
  const webResearch = localRun.webResearch;
  if (!selected || !webResearch?.sources?.length) return null;

  // Sequential, not parallel: small local servers (and rate-limited cloud models) choke on
  // a burst of concurrent calls, which is why the first fan-out attempt came back empty.
  const findings = [];
  for (const agent of FANOUT_AGENTS) {
    const note = await runOneAgent(agent, selected, webResearch, provider, env);
    if (note) findings.push(note);
  }
  return findings;
}

async function runOneAgent(agent, selected, webResearch, provider, env) {
  const sources = (webResearch.sources || [])
    .filter((s) => s.agentId === agent.id || agent.categories.includes(s.category))
    .slice(0, 5)
    .map((s) => `- ${s.title} (${s.domain}): ${s.snippet || ""}`.slice(0, 220));
  const facts = (webResearch.facts || [])
    .filter((f) => agent.categories.includes(f.category))
    .slice(0, 4)
    .map((f) => `- ${f.neighborhood} ${f.label}: ${f.value} ${f.unit}`);

  if (!sources.length && !facts.length) return null;

  const messages = [
    {
      role: "system",
      content:
        `You are the ${agent.id} agent for ${selected.name}, Toronto. Using ONLY the evidence below, ` +
        `write one concise sentence about ${agent.focus}. Cite a domain in parentheses. ` +
        `If evidence is thin, say so. Return strict JSON: {"finding": "...", "confidence": "low|medium|high"}.`,
    },
    { role: "user", content: `Evidence:\n${[...facts, ...sources].join("\n") || "(none)"}` },
  ];

  const result = await agenticChat(messages, env, {
    provider,
    json: true,
    maxTokens: 200,
    timeoutMs: Number(env.AGENT_FANOUT_TIMEOUT_MS || 45000),
  });
  if (!result) return null;

  const parsed = safeJson(result.content);
  const finding = typeof parsed?.finding === "string" ? parsed.finding.replace(/\s+/g, " ").trim() : "";
  if (!finding) return null;
  return {
    id: agent.id,
    finding,
    confidence: ["low", "medium", "high"].includes(parsed.confidence) ? parsed.confidence : "medium",
    model: result.model,
  };
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
