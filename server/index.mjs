import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { applyEvidencePolicy, buildLocalAgentRun, mergeModelRecommendation } from "./agent-core.mjs";
import { configuredModel, runHfAgent } from "./hf-client.mjs";
import { configuredNvidiaModel, runNvidiaAgent } from "./nvidia-client.mjs";
import { configuredOllamaModel, runOllamaAgent } from "./ollama-client.mjs";
import { configuredLlamaCppModel, llamaCppEnabled, runLlamaCppAgent } from "./llamacpp-client.mjs";
import { runAgentFanOut } from "./agent-fanout.mjs";
import { discoverNeighborhoods, buildDiscoveredRows } from "./discover.mjs";
import {
  configuredSearchProvider,
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
        ollamaConfigured: Boolean(configuredOllamaModel()),
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
        dimensions: ["affordability", "commute", "safety", "lifestyle", "growth"],
        strategy:
          "Discover fitting neighbourhoods, gather official Toronto Open Data + deep web evidence per area, then synthesise only source-backed claims.",
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
            output: { finding: note.finding, confidence: note.confidence },
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
          return note ? { ...agent, finding: note.finding } : agent;
        });
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

async function runConfiguredModel(localRun) {
  const provider = configuredProvider();

  if (provider === "llamacpp") {
    return { provider, ...(await runLlamaCppAgent(localRun)) };
  }
  if (provider === "ollama") {
    return { provider, ...(await runOllamaAgent(localRun)) };
  }
  if (provider === "nvidia") {
    return { provider, ...(await runNvidiaAgent(localRun)) };
  }
  if (provider === "hf") {
    return { provider, ...(await runHfAgent(localRun)) };
  }

  // auto: Nemotron (NVIDIA) first when keyed, then a local llama.cpp/OpenBMB GGUF,
  // then Ollama, then the HF model — so the agent always lands on a working brain.
  const nvidia = await runNvidiaAgent(localRun);
  if (nvidia.status === "done") return { provider: "nvidia", ...nvidia };
  const llamacpp = await runLlamaCppAgent(localRun);
  if (llamacpp.status === "done") return { provider: "llamacpp", ...llamacpp };
  const ollama = await runOllamaAgent(localRun);
  if (ollama.status === "done") return { provider: "ollama", ...ollama };
  const hf = await runHfAgent(localRun);
  if (hf.status === "done") return { provider: "hf", ...hf };

  return {
    provider: "auto",
    status: "error",
    reason: `NVIDIA: ${nvidia.reason}; llama.cpp: ${llamacpp.reason}; Ollama: ${ollama.reason}; Hugging Face: ${hf.reason}`,
    model: configuredAgentModel(),
    result: null,
  };
}

function configuredProvider() {
  const raw = (process.env.AGENT_MODEL_PROVIDER || process.env.AGENT_PROVIDER || "hf").toLowerCase();
  if (["nvidia", "llamacpp", "ollama", "hf", "auto"].includes(raw)) return raw;
  return "hf";
}

function configuredAgentModel() {
  const provider = configuredProvider();
  if (provider === "nvidia") return configuredNvidiaModel();
  if (provider === "llamacpp") return configuredLlamaCppModel();
  if (provider === "ollama") return configuredOllamaModel();
  if (provider === "auto") {
    return configuredNvidiaModel() || configuredLlamaCppModel() || configuredOllamaModel() || configuredModel();
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
