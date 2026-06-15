// Shared "talk to the configured agentic model" helper. Resolves whichever brain is
// active (Nemotron / llama.cpp+OpenBMB / Ollama / HF) and sends an OpenAI-compatible chat
// request, so the per-agent fan-out reasons with the SAME agentic model as the synthesiser.

const JSON_GRAMMAR = `root ::= "{" ws members? "}" ws
members ::= pair ("," ws pair)*
pair ::= string ws ":" ws value
value ::= object | array | string | number | "true" | "false" | "null"
object ::= "{" ws members? "}" ws
array ::= "[" ws (value ("," ws value)*)? "]" ws
string ::= "\\"" ( [^"\\\\] | "\\\\" ["\\\\/bfnrt] )* "\\"" ws
number ::= "-"? ([0-9] | [1-9] [0-9]*) ("." [0-9]+)? ws
ws ::= [ \\t\\n]*`;

export function resolveActiveProvider(env = process.env) {
  const raw = (env.AGENT_MODEL_PROVIDER || env.AGENT_PROVIDER || "auto").toLowerCase();
  const has = {
    nvidia: Boolean(env.NVIDIA_API_KEY || env.NGC_API_KEY),
    llamacpp: env.LLAMACPP_ENABLED === "1",
    ollama: Boolean(env.OLLAMA_MODEL || env.AGENT_OLLAMA_MODEL),
    hf: Boolean(env.HF_TOKEN || env.HUGGINGFACEHUB_API_TOKEN || env.HUGGING_FACE_HUB_TOKEN),
  };
  if (raw !== "auto" && raw !== "") return has[raw] ? raw : firstAvailable(has);
  return firstAvailable(has);
}

function firstAvailable(has) {
  if (has.nvidia) return "nvidia";
  if (has.llamacpp) return "llamacpp";
  if (has.ollama) return "ollama";
  if (has.hf) return "hf";
  return null;
}

function endpointFor(provider, env) {
  if (provider === "nvidia") {
    const base = env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
    return {
      url: env.NVIDIA_CHAT_COMPLETIONS_URL || `${base.replace(/\/$/, "")}/chat/completions`,
      model: env.NVIDIA_MODEL || "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      auth: env.NVIDIA_API_KEY || env.NGC_API_KEY,
    };
  }
  if (provider === "llamacpp") {
    const base = env.LLAMACPP_BASE_URL || "http://127.0.0.1:8080/v1";
    return {
      url: env.LLAMACPP_CHAT_COMPLETIONS_URL || `${base.replace(/\/$/, "")}/chat/completions`,
      model: env.LLAMACPP_MODEL || "local-gguf",
      auth: env.LLAMACPP_API_KEY || "",
      grammar: true,
    };
  }
  if (provider === "ollama") {
    const host = env.OLLAMA_HOST || "http://127.0.0.1:11434";
    return {
      url: env.OLLAMA_CHAT_COMPLETIONS_URL || `${host.replace(/\/$/, "")}/v1/chat/completions`,
      model: env.OLLAMA_MODEL || env.AGENT_OLLAMA_MODEL,
      auth: "ollama",
    };
  }
  return {
    url: env.HF_CHAT_COMPLETIONS_URL || "https://router.huggingface.co/v1/chat/completions",
    model: env.HF_MODEL || "Qwen/Qwen3-Coder-30B-A3B-Instruct",
    auth: env.HF_TOKEN || env.HUGGINGFACEHUB_API_TOKEN || env.HUGGING_FACE_HUB_TOKEN,
  };
}

// Returns { provider, model, content } or null. `json` constrains output to valid JSON
// (grammar for llama.cpp, response_format elsewhere).
export async function agenticChat(messages, env = process.env, opts = {}) {
  const provider = opts.provider || resolveActiveProvider(env);
  if (!provider) return null;
  const ep = endpointFor(provider, env);
  if (!ep.url) return null;

  const payload = {
    model: ep.model,
    messages,
    temperature: Number(opts.temperature ?? 0.2),
    max_tokens: Number(opts.maxTokens ?? 220),
    stream: false,
  };
  if (opts.json) {
    if (ep.grammar) payload.grammar = JSON_GRAMMAR;
    else payload.response_format = { type: "json_object" };
  }

  try {
    const response = await fetch(ep.url, {
      method: "POST",
      headers: {
        ...(ep.auth ? { Authorization: `Bearer ${ep.auth}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(Number(opts.timeoutMs ?? env.AGENT_CHAT_TIMEOUT_MS ?? 60000)),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === "string" && content.trim()
      ? { provider, model: ep.model, content: content.trim() }
      : null;
  } catch {
    return null;
  }
}
