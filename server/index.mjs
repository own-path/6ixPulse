import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { applyEvidencePolicy, buildLocalAgentRun, mergeModelRecommendation } from "./agent-core.mjs";
import { configuredModel, runHfAgent } from "./hf-client.mjs";
import { configuredNvidiaModel, runNvidiaAgent } from "./nvidia-client.mjs";
import { configuredLlamaCppModel, llamaCppEnabled, runLlamaCppAgent } from "./llamacpp-client.mjs";
import { runAgentFanOut } from "./agent-fanout.mjs";
import { discoverNeighborhoods, buildDiscoveredRows } from "./discover.mjs";
import { computeNeighborhoodScores, scoreFactsAndSources } from "./score-tools.mjs";
import {
  configuredSearchProvider,
  crimeRatesByLocation,
  runGoogleSearchProbe,
  runHousingResearch,
  searchProviderStatus,
} from "./research-tools.mjs";

const envPath = resolve(process.cwd(), ".env");
loadDotEnv(envPath);

const port = Number(process.env.AGENT_PORT || 8787);

const server = createServer(async (request, response) => {
  loadDotEnv(envPath, { override: true });
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);

  if (request.method === "OPTIONS") {
    writeEmpty(response, 204);
    return;
  }

  try {
    if (request.method === "GET" && url.pathname === "/api/agent/health") {
      writeJson(response, 200, {
        ok: true,
        service: "6ixPulse agent backend",
        provider: configuredProvider(),
        model: configuredAgentModel(),
        hfConfigured: Boolean(
          process.env.HF_TOKEN ||
            process.env.HUGGINGFACEHUB_API_TOKEN ||
            process.env.HUGGING_FACE_HUB_TOKEN,
        ),
        nvidiaConfigured: Boolean(process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY),
        llamacppConfigured: llamaCppEnabled(),
        searchProvider: configuredSearchProvider(),
        search: searchProviderStatus(),
        researchEnabled: process.env.RESEARCH_ENABLED !== "0",
        officialDataEnabled: process.env.OFFICIAL_DATA_ENABLED !== "0",
        offline: process.env.AGENT_OFFLINE === "1",
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/agent/model") {
      writeJson(response, 200, {
        provider: configuredProvider(),
        model: configuredAgentModel(),
        mode: process.env.AGENT_OFFLINE === "1" ? "local-fallback" : "agentic",
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/agent/search/health") {
      writeJson(response, 200, {
        ok: true,
        search: searchProviderStatus(),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/agent/search/google") {
      const probe = await runGoogleSearchProbe(url.searchParams.get("q") || "");
      writeJson(response, probe.ok ? 200 : 409, probe);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/agent/run") {
      const body = await readJson(request);
      const prompt = typeof body?.prompt === "string" ? body.prompt : "";

      // Discover first: the agentic model picks which Toronto neighbourhoods fit the prompt
      // and supplies their coordinates — nothing about the candidate set is hardcoded.
      // Falls back to the seed list only if discovery fails, so the app never breaks.
      const discovered = await discoverNeighborhoods(prompt);
      const localRun = buildLocalAgentRun(
        prompt,
        discovered?.length ? buildDiscoveredRows(discovered) : undefined,
      );

      // Plan: lay out intent, target areas, dimensions, and source strategy before any agent
      // does work, so the run is deliberate and the plan is shown to the user.
      const plan = {
        intent: localRun.parsed,
        candidateSource: discovered?.length ? "model-discovered" : "seed-fallback",
        targetNeighborhoods: localRun.ranked.slice(0, 3).map((row) => row.name),
        // A task for every City Agent. Each researches its own dimension from a named source;
        // the Recommendation agent runs last and weighs all of their findings together.
        cityAgents: [
          { agent: "affordability", researches: "typical rent vs the renter budget", source: "CMHC market context + density model" },
          { agent: "commute", researches: "time to Union Station + transit access", source: "TTC + GO Transit (Metrolinx), distance" },
          { agent: "safety", researches: "reported neighbourhood crime rate", source: "Toronto Police Service" },
          { agent: "lifestyle", researches: "cafes, parks, amenities, street life", source: "OpenStreetMap" },
          { agent: "growth", researches: "development activity and trend", source: "OpenStreetMap + building permits" },
          { agent: "recommendation", researches: "synthesis of every agent's findings + sources", source: "all of the above" },
        ],
        strategy:
          "Discover fitting neighbourhoods, run a researcher per City Agent over official Toronto data, then the Recommendation agent decides from all agents' sourced findings.",
      };
      localRun.plan = plan;
      localRun.trace.unshift({
        id: "step_00",
        tool: "plan_research",
        status: "done",
        input: { prompt: prompt || "(default prompt)" },
        output: plan,
      });
      if (discovered?.length) {
        localRun.trace.unshift({
          id: "step_00",
          tool: "discover_neighborhoods",
          status: "done",
          input: { prompt: prompt || "(default prompt)" },
          output: { count: discovered.length, neighbourhoods: discovered.map((d) => d.name) },
        });
      }

      const webResearch = await runHousingResearch(localRun);
      localRun.webResearch = webResearch;
      localRun.trace.push({
        id: `step_${String(localRun.trace.length + 1).padStart(2, "0")}`,
        tool: "housing_web_research",
        status: webResearch.enabled ? "done" : "skipped",
        input: {
          provider: webResearch.provider,
          neighborhoods: webResearch.targetNeighborhoods,
        },
        output: {
          sourceCount: webResearch.sources.length,
          queryCount: webResearch.queries.length,
          limitations: webResearch.limitations,
        },
      });
      // Score every dimension (Afford, Safety, Commute, Transit, Amenity, Lifestyle, Growth,
      // Match) for each candidate from real named sources, and write the scores into the
      // ranked rows so the frontend shows numbers instead of "needs source".
      await applyNeighborhoodScores(localRun, webResearch);

      // Per-agent fan-out: each City Agent reasons over its own evidence on the local
      // OpenBMB/llama.cpp worker before the main model synthesises (the hybrid).
      const fanout = await runAgentFanOut(localRun);
      if (fanout?.length) {
        for (const note of fanout) {
          localRun.trace.push({
            id: `step_${String(localRun.trace.length + 1).padStart(2, "0")}`,
            tool: `agent_${note.id}`,
            status: "done",
            input: { worker: note.model },
            output: { finding: note.finding, confidence: note.confidence, sources: note.sources || [] },
          });
        }
      }

      const modelRun = await runConfiguredModel(localRun);

      localRun.trace.push({
        id: `step_${String(localRun.trace.length + 1).padStart(2, "0")}`,
        tool: `${modelRun.provider}_reasoning`,
        status: modelRun.status === "done" ? "done" : modelRun.status,
        input: {
          model: modelRun.model,
          provider: modelRun.provider,
        },
        output: {
          reason: modelRun.reason,
          usedModel: modelRun.status === "done",
        },
      });

      const rawResult =
        modelRun.status === "done" && modelRun.result
          ? {
              ...mergeModelRecommendation(localRun, modelRun.result, modelRun.model, modelRun.provider),
              provider: modelRun.provider,
            }
          : {
              ...localRun,
              provider: modelRun.provider,
              model: modelRun.model,
              fallbackReason: modelRun.reason,
            };

      const result = applyEvidencePolicy(rawResult);
      // Let the per-agent worker findings take precedence over the generic evidence note.
      if (fanout?.length) {
        result.agents = result.agents.map((agent) => {
          const note = fanout.find((item) => item.id === agent.id);
          return note?.finding ? { ...agent, finding: note.finding } : agent;
        });

        // Give the Recommendation agent its summary plus the sources gathered by EVERY agent.
        const recNote = fanout.find((item) => item.id === "recommendation");
        if (recNote && result.recommendation) {
          if (recNote.finding) result.recommendation.summary = recNote.finding;
          const agentSources = new Set();
          for (const note of fanout) for (const name of note.sources || []) agentSources.add(name);
          const named = [...agentSources].map((name) => ({ sourceId: name, note: "Used by a City Agent" }));
          const existing = result.recommendation.citations || [];
          const seen = new Set(existing.map((c) => c.sourceId));
          result.recommendation.citations = [...existing, ...named.filter((c) => !seen.has(c.sourceId))];
        }
      }
      writeJson(response, 200, result);
      return;
    }

    writeJson(response, 404, { ok: false, error: "Not found" });
  } catch (error) {
    writeJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown server error",
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`6ixPulse agent backend listening on http://127.0.0.1:${port}`);
});

async function applyNeighborhoodScores(localRun, webResearch) {
  const maxScored = Math.min(localRun.ranked.length, Number(process.env.SCORE_MAX_NEIGHBORHOODS || 6));
  const targets = localRun.ranked
    .slice(0, maxScored)
    .map((row) => ({ id: row.id, name: row.name, center: row.center }))
    .filter((row) => Array.isArray(row.center));

  // Look up Toronto Police crime rates by location (point-in-polygon on each area's centre),
  // so Safety resolves for every candidate regardless of the model's chosen name.
  const crimeByName = await crimeRatesByLocation(
    targets.map((t) => ({ name: t.name, center: t.center })),
  ).catch(() => ({}));

  let scored;
  try {
    scored = await computeNeighborhoodScores(targets, localRun.parsed.weights, crimeByName);
  } catch {
    return;
  }

  const { sources, facts } = scoreFactsAndSources(scored);
  // Prepend so the richer computed facts win the frontend's first-match lookup.
  webResearch.facts = [...facts, ...(webResearch.facts || [])];
  const seen = new Set((webResearch.sources || []).map((s) => s.id));
  for (const source of sources) {
    if (!seen.has(source.id)) {
      webResearch.sources.push(source);
      seen.add(source.id);
    }
  }

  const byId = new Map(scored.map((s) => [s.id, s]));
  for (const row of localRun.ranked) {
    const s = byId.get(row.id);
    if (!s || !s.dims) continue;
    for (const key of Object.keys(s.dims)) {
      if (s.dims[key] != null) row.dims[key] = s.dims[key];
    }
    if (typeof s.overall === "number") row.overall = s.overall;
    if (s.commuteMin) {
      row.comLo = Math.max(1, s.commuteMin - 4);
      row.comHi = s.commuteMin + 5;
      row.comMode = "TTC / GO";
    }
  }
  localRun.ranked.sort((a, b) => (b.overall || 0) - (a.overall || 0));
  localRun.ranked.forEach((row, index) => (row.rank = index + 1));
  if (localRun.ranked[0]) localRun.selectedId = localRun.ranked[0].id;

  localRun.trace.push({
    id: `step_${String(localRun.trace.length + 1).padStart(2, "0")}`,
    tool: "score_neighborhoods",
    status: "done",
    input: { neighbourhoods: targets.map((t) => t.name) },
    output: {
      scored: scored
        .filter((s) => s.dims)
        .map((s) => ({ name: s.name, match: s.overall, ...s.dims })),
    },
  });
}

function normName(value) {
  return String(value || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

async function runConfiguredModel(localRun) {
  const provider = configuredProvider();

  if (provider === "llamacpp") {
    return { provider, ...(await runLlamaCppAgent(localRun)) };
  }
  if (provider === "nvidia") {
    return { provider, ...(await runNvidiaAgent(localRun)) };
  }
  if (provider === "hf") {
    return { provider, ...(await runHfAgent(localRun)) };
  }

  // auto: Nemotron (NVIDIA) first when keyed, then a local llama.cpp/OpenBMB GGUF,
  // then the HF model — so the agent always lands on a working brain.
  const nvidia = await runNvidiaAgent(localRun);
  if (nvidia.status === "done") return { provider: "nvidia", ...nvidia };
  const llamacpp = await runLlamaCppAgent(localRun);
  if (llamacpp.status === "done") return { provider: "llamacpp", ...llamacpp };
  const hf = await runHfAgent(localRun);
  if (hf.status === "done") return { provider: "hf", ...hf };

  return {
    provider: "auto",
    status: "error",
    reason: `NVIDIA: ${nvidia.reason}; llama.cpp: ${llamacpp.reason}; Hugging Face: ${hf.reason}`,
    model: configuredAgentModel(),
    result: null,
  };
}

function configuredProvider() {
  const raw = (process.env.AGENT_MODEL_PROVIDER || process.env.AGENT_PROVIDER || "hf").toLowerCase();
  if (["nvidia", "llamacpp", "hf", "auto"].includes(raw)) return raw;
  return "hf";
}

function configuredAgentModel() {
  const provider = configuredProvider();
  if (provider === "nvidia") return configuredNvidiaModel();
  if (provider === "llamacpp") return configuredLlamaCppModel();
  if (provider === "auto") {
    return configuredNvidiaModel() || configuredLlamaCppModel() || configuredModel();
  }
  return configuredModel();
}

function loadDotEnv(filePath, options = {}) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = stripQuotes(rawValue.trim());
    if (!options.override && process.env[key] !== undefined) continue;
    if (options.override && !value && process.env[key]) continue;
    process.env[key] = value;
  }
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("Request body is too large");
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Invalid JSON request body");
  }
}

function writeJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function writeEmpty(response, status) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end();
}
