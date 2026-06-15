import { buildModelContext } from "./agent-core.mjs";
import { SYSTEM_PROMPT, parseModelJson } from "./model-prompt.mjs";

const DEFAULT_MODEL = "Qwen/Qwen3-Coder-30B-A3B-Instruct";
const DEFAULT_CHAT_URL = "https://router.huggingface.co/v1/chat/completions";

export async function runHfAgent(localRun, env = process.env) {
  if (env.AGENT_OFFLINE === "1") {
    return {
      status: "skipped",
      reason: "AGENT_OFFLINE is enabled",
      model: configuredModel(env),
      result: null,
    };
  }

  const token = env.HF_TOKEN || env.HUGGINGFACEHUB_API_TOKEN || env.HUGGING_FACE_HUB_TOKEN;
  if (!token) {
    return {
      status: "skipped",
      reason: "HF_TOKEN is not configured",
      model: configuredModel(env),
      result: null,
    };
  }

  const model = configuredModel(env);
  const context = buildModelContext(localRun);
  const basePayload = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify(context),
      },
    ],
    temperature: Number(env.HF_TEMPERATURE ?? 0.2),
    max_tokens: Number(env.HF_MAX_TOKENS ?? 900),
  };

  const richPayload = {
    ...basePayload,
    response_format: { type: "json_object" },
    reasoning_effort: env.HF_REASONING_EFFORT || "medium",
  };

  try {
    const body = await postChat(richPayload, token, env);
    return {
      status: "done",
      reason: null,
      model,
      result: parseModelJson(body, "Hugging Face"),
    };
  } catch (error) {
    if (error instanceof HfRequestError && (error.status === 400 || error.status === 422)) {
      try {
        const body = await postChat(basePayload, token, env);
        return {
          status: "done",
          reason: "Retried without provider-specific JSON/reasoning parameters",
          model,
          result: parseModelJson(body, "Hugging Face"),
        };
      } catch (retryError) {
        return {
          status: "error",
          reason:
            retryError instanceof Error
              ? retryError.message
              : "Hugging Face retry failed with an unknown error",
          model,
          result: null,
        };
      }
    }

    return {
      status: "error",
      reason: error instanceof Error ? error.message : "Unknown Hugging Face error",
      model,
      result: null,
    };
  }
}

export function configuredModel(env = process.env) {
  const suffix = env.HF_MODEL_SUFFIX || "";
  return `${env.HF_MODEL || DEFAULT_MODEL}${suffix}`;
}

export function chatCompletionsUrl(env = process.env) {
  if (env.HF_CHAT_COMPLETIONS_URL) return env.HF_CHAT_COMPLETIONS_URL;
  if (env.HF_ENDPOINT_URL) {
    return `${env.HF_ENDPOINT_URL.replace(/\/$/, "")}/chat/completions`;
  }
  return env.HF_ROUTER_URL || DEFAULT_CHAT_URL;
}

async function postChat(payload, token, env) {
  const timeoutMs = Number(env.HF_TIMEOUT_MS ?? 30000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(chatCompletionsUrl(env), {
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
      throw new HfRequestError(response.status, conciseError(text));
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Hugging Face returned a non-JSON chat response");
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Hugging Face request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function conciseError(text) {
  if (!text) return "empty error body";
  try {
    const parsed = JSON.parse(text);
    return parsed.error?.message || parsed.message || JSON.stringify(parsed).slice(0, 500);
  } catch {
    return text.slice(0, 500);
  }
}

class HfRequestError extends Error {
  constructor(status, message) {
    super(`Hugging Face request failed with HTTP ${status}: ${message}`);
    this.name = "HfRequestError";
    this.status = status;
  }
}
