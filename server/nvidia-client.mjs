import { buildModelContext } from "./agent-core.mjs";
import { SYSTEM_PROMPT, parseModelJson } from "./model-prompt.mjs";

const DEFAULT_MODEL = "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4";
const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";

export async function runNvidiaAgent(localRun, env = process.env) {
  if (env.AGENT_OFFLINE === "1") {
    return {
      status: "skipped",
      reason: "AGENT_OFFLINE is enabled",
      model: configuredNvidiaModel(env),
      result: null,
    };
  }

  const token = env.NVIDIA_API_KEY || env.NGC_API_KEY;
  if (!token) {
    return {
      status: "skipped",
      reason: "NVIDIA_API_KEY is not configured",
      model: configuredNvidiaModel(env),
      result: null,
    };
  }

  const model = configuredNvidiaModel(env);
  const context = buildModelContext(localRun);
  const basePayload = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(context) },
    ],
    temperature: Number(env.NVIDIA_TEMPERATURE ?? 0.2),
    top_p: Number(env.NVIDIA_TOP_P ?? 0.95),
    max_tokens: Number(env.NVIDIA_MAX_TOKENS ?? 1200),
    stream: false,
    top_k: Number(env.NVIDIA_TOP_K ?? 1),
    chat_template_kwargs: {
      enable_thinking: env.NVIDIA_ENABLE_THINKING === "1",
    },
  };

  const richPayload = {
    ...basePayload,
    response_format: { type: "json_object" },
  };

  try {
    const body = await postChat(richPayload, token, env);
    return {
      status: "done",
      reason: null,
      model,
      result: parseModelJson(body, "NVIDIA NIM"),
    };
  } catch (error) {
    if (isRetryableProviderError(error)) {
      try {
        const body = await postChat(basePayload, token, env);
        return {
          status: "done",
          reason: "Retried without JSON response_format",
          model,
          result: parseModelJson(body, "NVIDIA NIM"),
        };
      } catch (retryError) {
        return errorResult(retryError, model);
      }
    }

    return errorResult(error, model);
  }
}

export function configuredNvidiaModel(env = process.env) {
  return env.NVIDIA_MODEL || DEFAULT_MODEL;
}

export function nvidiaChatCompletionsUrl(env = process.env) {
  if (env.NVIDIA_CHAT_COMPLETIONS_URL) return env.NVIDIA_CHAT_COMPLETIONS_URL;
  const baseUrl = env.NVIDIA_BASE_URL || DEFAULT_BASE_URL;
  return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
}

async function postChat(payload, token, env) {
  const timeoutMs = Number(env.NVIDIA_TIMEOUT_MS ?? 60000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(nvidiaChatCompletionsUrl(env), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new NvidiaRequestError(response.status, conciseError(text));
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error("NVIDIA NIM returned a non-JSON chat response");
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`NVIDIA NIM request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isRetryableProviderError(error) {
  return error instanceof NvidiaRequestError && (error.status === 400 || error.status === 422);
}

function errorResult(error, model) {
  return {
    status: "error",
    reason: error instanceof Error ? error.message : "Unknown NVIDIA NIM error",
    model,
    result: null,
  };
}

function conciseError(text) {
  if (!text) return "empty error body";
  try {
    const parsed = JSON.parse(text);
    return parsed.error?.message || parsed.detail || parsed.message || JSON.stringify(parsed).slice(0, 500);
  } catch {
    return text.slice(0, 500);
  }
}

class NvidiaRequestError extends Error {
  constructor(status, message) {
    super(`NVIDIA NIM request failed with HTTP ${status}: ${message}`);
    this.name = "NvidiaRequestError";
    this.status = status;
  }
}
