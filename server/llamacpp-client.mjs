import { buildModelContext } from "./agent-core.mjs";
import { SYSTEM_PROMPT, parseModelJson } from "./model-prompt.mjs";

// llama.cpp ships an OpenAI-compatible server (`llama-server`) that exposes
// /v1/chat/completions. This lets the agent run any small GGUF locally — e.g. an
// OpenBMB MiniCPM build — which is the self-contained, hackathon-compliant path.
//   llama-server -hf openbmb/MiniCPM4-8B-GGUF --port 8080
const DEFAULT_LLAMACPP_URL = "http://127.0.0.1:8080/v1/chat/completions";

// llama.cpp enforces this GBNF grammar during sampling, guaranteeing syntactically valid
// JSON even from tiny local models (small GGUFs ignore the loose `json_object` flag and
// happily return prose). The agent's normaliser fills any missing fields, so a constrained
// object is always parseable end-to-end.
const JSON_GRAMMAR = `root   ::= object
value  ::= object | array | string | number | ("true" | "false" | "null") ws
object ::= "{" ws ( string ":" ws value ("," ws string ":" ws value)* )? "}" ws
array  ::= "[" ws ( value ("," ws value)* )? "]" ws
string ::= "\\"" ( [^"\\\\] | "\\\\" (["\\\\/bfnrt] | "u" [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F]) )* "\\"" ws
number ::= ("-"? ([0-9] | [1-9] [0-9]*)) ("." [0-9]+)? ([eE] [-+]? [0-9]+)? ws
ws ::= [ \\t\\n]*`;

export async function runLlamaCppAgent(localRun, env = process.env) {
  if (env.AGENT_OFFLINE === "1") {
    return {
      status: "skipped",
      reason: "AGENT_OFFLINE is enabled",
      model: configuredLlamaCppModel(env),
      result: null,
    };
  }

  if (!llamaCppEnabled(env)) {
    return {
      status: "skipped",
      reason: "LLAMACPP_ENABLED is disabled",
      model: configuredLlamaCppModel(env),
      result: null,
    };
  }

  const model = configuredLlamaCppModel(env);
  const context = buildModelContext(localRun);
  const basePayload = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(context) },
    ],
    temperature: Number(env.LLAMACPP_TEMPERATURE ?? 0.2),
    max_tokens: Number(env.LLAMACPP_MAX_TOKENS ?? 900),
    stream: false,
  };

  const richPayload = {
    ...basePayload,
    grammar: JSON_GRAMMAR,
  };

  try {
    const body = await postChat(richPayload, env);
    return { status: "done", reason: null, model, result: parseModelJson(body, "llama.cpp") };
  } catch (error) {
    if (isRetryableProviderError(error)) {
      try {
        const body = await postChat(basePayload, env);
        return {
          status: "done",
          reason: "Retried without JSON response_format",
          model,
          result: parseModelJson(body, "llama.cpp"),
        };
      } catch (retryError) {
        return errorResult(retryError, model);
      }
    }
    return errorResult(error, model);
  }
}

export function llamaCppEnabled(env = process.env) {
  // Off by default so `auto` does not stall on a missing local server; turn on
  // with LLAMACPP_ENABLED=1 once `llama-server` is running.
  return env.LLAMACPP_ENABLED === "1";
}

export function configuredLlamaCppModel(env = process.env) {
  return env.LLAMACPP_MODEL || "local-gguf";
}

export function llamaCppChatCompletionsUrl(env = process.env) {
  if (env.LLAMACPP_CHAT_COMPLETIONS_URL) return env.LLAMACPP_CHAT_COMPLETIONS_URL;
  if (env.LLAMACPP_BASE_URL) {
    return `${env.LLAMACPP_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  }
  return DEFAULT_LLAMACPP_URL;
}

async function postChat(payload, env) {
  const timeoutMs = Number(env.LLAMACPP_TIMEOUT_MS ?? 60000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const apiKey = env.LLAMACPP_API_KEY || "";

  try {
    const response = await fetch(llamaCppChatCompletionsUrl(env), {
      method: "POST",
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new LlamaCppRequestError(response.status, conciseError(text));
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error("llama.cpp returned a non-JSON chat response");
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`llama.cpp request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isRetryableProviderError(error) {
  return error instanceof LlamaCppRequestError && (error.status === 400 || error.status === 422);
}

function errorResult(error, model) {
  return {
    status: "error",
    reason: error instanceof Error ? error.message : "Unknown llama.cpp error",
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

class LlamaCppRequestError extends Error {
  constructor(status, message) {
    super(`llama.cpp request failed with HTTP ${status}: ${message}`);
    this.name = "LlamaCppRequestError";
    this.status = status;
  }
}
