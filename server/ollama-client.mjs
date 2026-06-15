import { buildModelContext } from "./agent-core.mjs";
import { SYSTEM_PROMPT, parseModelJson } from "./model-prompt.mjs";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434/v1/chat/completions";

export async function runOllamaAgent(localRun, env = process.env) {
  if (env.AGENT_OFFLINE === "1") {
    return {
      status: "skipped",
      reason: "AGENT_OFFLINE is enabled",
      model: configuredOllamaModel(env),
      result: null,
    };
  }

  const model = configuredOllamaModel(env);
  if (!model) {
    return {
      status: "skipped",
      reason: "OLLAMA_MODEL is not configured",
      model: null,
      result: null,
    };
  }

  const context = buildModelContext(localRun);
  const basePayload = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(context) },
    ],
    temperature: Number(env.OLLAMA_TEMPERATURE ?? 0.2),
    max_tokens: Number(env.OLLAMA_MAX_TOKENS ?? 900),
    stream: false,
  };

  const richPayload = {
    ...basePayload,
    response_format: { type: "json_object" },
    reasoning_effort: env.OLLAMA_REASONING_EFFORT || "medium",
  };

  try {
    const body = await postChat(richPayload, env);
    return {
      status: "done",
      reason: null,
      model,
      result: parseModelJson(body, "Ollama"),
    };
  } catch (error) {
    if (isRetryableProviderError(error)) {
      try {
        const body = await postChat(basePayload, env);
        return {
          status: "done",
          reason: "Retried without JSON/reasoning parameters",
          model,
          result: parseModelJson(body, "Ollama"),
        };
      } catch (retryError) {
        return errorResult(retryError, model);
      }
    }

    return errorResult(error, model);
  }
}

export function configuredOllamaModel(env = process.env) {
  return env.OLLAMA_MODEL || env.AGENT_OLLAMA_MODEL || "";
}

export function ollamaChatCompletionsUrl(env = process.env) {
  if (env.OLLAMA_CHAT_COMPLETIONS_URL) return env.OLLAMA_CHAT_COMPLETIONS_URL;
  const host = env.OLLAMA_HOST || "http://127.0.0.1:11434";
  return `${host.replace(/\/$/, "")}/v1/chat/completions`;
}

async function postChat(payload, env) {
  const timeoutMs = Number(env.OLLAMA_TIMEOUT_MS ?? 60000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(ollamaChatCompletionsUrl(env), {
      method: "POST",
      headers: {
        Authorization: "Bearer ollama",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new OllamaRequestError(response.status, conciseError(text));
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Ollama returned a non-JSON chat response");
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Ollama request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isRetryableProviderError(error) {
  return error instanceof OllamaRequestError && (error.status === 400 || error.status === 422);
}

function errorResult(error, model) {
  return {
    status: "error",
    reason: error instanceof Error ? error.message : "Unknown Ollama error",
    model,
    result: null,
  };
}

function conciseError(text) {
  if (!text) return "empty error body";
  try {
    const parsed = JSON.parse(text);
    return parsed.error?.message || parsed.error || parsed.message || JSON.stringify(parsed).slice(0, 500);
  } catch {
    return text.slice(0, 500);
  }
}

class OllamaRequestError extends Error {
  constructor(status, message) {
    super(`Ollama request failed with HTTP ${status}: ${message}`);
    this.name = "OllamaRequestError";
    this.status = status;
  }
}
