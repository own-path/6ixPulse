// Shared "talk to the configured agentic model" helper. Resolves whichever brain is
// active (Nemotron / llama.cpp+OpenBMB / HF) and sends an OpenAI-compatible chat
// request, so the per-agent fan-out reasons with the SAME agentic model as the synthesiser.
import { stripReasoning } from "./model-prompt.mjs";

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
    hf: Boolean(env.HF_TOKEN || env.HUGGINGFACEHUB_API_TOKEN || env.HUGGING_FACE_HUB_TOKEN),
  };
  if (raw !== "auto" && raw !== "") return has[raw] ? raw : firstAvailable(has);
  return firstAvailable(has);
}

function firstAvailable(has) {
  if (has.nvidia) return "nvidia";
  if (has.llamacpp) return "llamacpp";
  if (has.hf) return "hf";
  return null;
}

function availability(env) {
  return {
    nvidia: Boolean(env.NVIDIA_API_KEY || env.NGC_API_KEY),
    llamacpp: env.LLAMACPP_ENABLED === "1",
    hf: Boolean(env.HF_TOKEN || env.HUGGINGFACEHUB_API_TOKEN || env.HUGGING_FACE_HUB_TOKEN),
  };
}

// The MAIN agentic brain that makes decisions. Nemotron (nvidia) is the default; when it is
// not keyed, prefer another capable model (HF) over the tiny local llama.cpp model — that 0.5B
// is the summariser, not a reasoner, so it is only the main brain as a last resort.
export function resolveMainProvider(env = process.env) {
  const has = availability(env);
  const raw = (env.AGENT_MODEL_PROVIDER || env.AGENT_PROVIDER || "auto").toLowerCase();
  if (raw !== "auto" && raw !== "" && has[raw]) return raw;
  if (has.nvidia) return "nvidia";
  if (has.hf) return "hf";
  if (has.llamacpp) return "llamacpp";
  return null;
}

// The lightweight "assistant" model used for summarisation. Defaults to the small local
// OpenBMB/llama.cpp model so it offloads summarising from the main Nemotron brain; falls
// back to the main agentic model if no dedicated summariser is available.
export function resolveSummarizerProvider(env = process.env) {
  const has = availability(env);
  const raw = (env.AGENT_SUMMARIZER_PROVIDER || "llamacpp").toLowerCase();
  if (raw && raw !== "auto" && has[raw]) return raw;
  if (has.llamacpp) return "llamacpp";
  return resolveMainProvider(env);
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
    temperature: Number(opts.temperature ?? (provider === "nvidia" ? 0.6 : 0.2)),
    max_tokens: Number(opts.maxTokens ?? 220),
    stream: false,
  };
  if (opts.json) {
    if (ep.grammar) payload.grammar = JSON_GRAMMAR;
    else payload.response_format = { type: "json_object" };
  }
  // Nemotron reasoning recipe. Thinking is only enabled where the caller asks (the
  // recommendation/decision), so the many lightweight summary calls stay fast.
  if (provider === "nvidia") {
    payload.top_p = Number(env.NVIDIA_TOP_P ?? 0.95);
    const thinking = Boolean(opts.thinking);
    payload.chat_template_kwargs = { enable_thinking: thinking };
    if (thinking) {
      payload.reasoning_budget = Number(env.NVIDIA_REASONING_BUDGET ?? 4096);
      payload.max_tokens = Number(opts.maxTokens ?? 4096) + payload.reasoning_budget;
    }
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
    const content = stripReasoning(data?.choices?.[0]?.message?.content);
    return content
      ? { provider, model: ep.model, content }
      : null;
  } catch {
    return null;
  }
}

function parseToolCalls(message) {
  if (!message) return [];
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    return message.tool_calls.map((call) => ({
      id: call.id,
      name: call.function?.name,
      arguments: call.function?.arguments || "{}",
    }));
  }
  const blocks = Array.isArray(message.content) ? message.content : [];
  return blocks
    .filter((block) => block?.type === "tool_use")
    .map((block) => ({
      id: block.id,
      name: block.name,
      arguments: typeof block.input === "string" ? block.input : JSON.stringify(block.input || {}),
    }));
}

function messageHasText(message) {
  if (!message) return false;
  if (typeof message.content === "string" && message.content.trim()) return true;
  if (Array.isArray(message.content)) {
    return message.content.some(
      (block) => block?.type === "text" && typeof block.text === "string" && block.text.trim(),
    );
  }
  return false;
}

function extractTextContent(message) {
  if (!message) return "";
  if (typeof message.content === "string") return stripReasoning(message.content);
  if (Array.isArray(message.content)) {
    const text = message.content
      .filter((block) => block?.type === "text")
      .map((block) => block.text || "")
      .join("\n")
      .trim();
    return stripReasoning(text);
  }
  return "";
}

// Multi-turn tool-calling loop for travel agent. Returns final assistant text plus trace.
export async function agenticChatWithTools(messages, tools, env = process.env, opts = {}) {
  const provider = opts.provider || resolveMainProvider(env);
  if (!provider) return null;
  const ep = endpointFor(provider, env);
  if (!ep.url) return null;

  const maxRounds = Number(opts.maxRounds ?? env.TRAVEL_MAX_TOOL_ROUNDS ?? 8);
  const conversation = [...messages];
  const trace = [];
  const collectedOffers = [];
  const collectedQuotes = [];

  for (let round = 0; round < maxRounds; round += 1) {
    const payload = {
      model: ep.model,
      messages: conversation,
      tools,
      tool_choice: "auto",
      temperature: Number(opts.temperature ?? (provider === "nvidia" ? 0.4 : 0.2)),
      max_tokens: Number(opts.maxTokens ?? 1024),
      stream: false,
    };
    if (provider === "nvidia") {
      payload.top_p = Number(env.NVIDIA_TOP_P ?? 0.95);
      payload.chat_template_kwargs = { enable_thinking: false };
    }

    let data;
    try {
      const response = await fetch(ep.url, {
        method: "POST",
        headers: {
          ...(ep.auth ? { Authorization: `Bearer ${ep.auth}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(Number(opts.timeoutMs ?? env.TRAVEL_CHAT_TIMEOUT_MS ?? 90000)),
      });
      if (!response.ok) {
        return { provider, model: ep.model, error: `HTTP ${response.status}`, trace, offers: collectedOffers, quotes: collectedQuotes };
      }
      data = await response.json();
    } catch (error) {
      return {
        provider,
        model: ep.model,
        error: error instanceof Error ? error.message : "request_failed",
        trace,
        offers: collectedOffers,
        quotes: collectedQuotes,
      };
    }

    const message = data?.choices?.[0]?.message;
    const toolCalls = parseToolCalls(message);

    if (!toolCalls.length) {
      const text = extractTextContent(message);
      if (text || round === 0) {
        return {
          provider,
          model: ep.model,
          content: text || "I could not complete that travel search. Please try again.",
          trace,
          offers: collectedOffers,
          quotes: collectedQuotes,
        };
      }
      break;
    }

    conversation.push(message);

    for (const call of toolCalls) {
      let parsedInput = {};
      try {
        parsedInput = JSON.parse(call.arguments || "{}");
      } catch {
        parsedInput = {};
      }

      const toolResult = opts.onToolCall
        ? await opts.onToolCall(call.name, parsedInput, call.id)
        : { ok: false, message: "No tool executor configured" };

      trace.push({
        id: call.id || `tool_${trace.length + 1}`,
        tool: call.name,
        status: toolResult.ok ? "done" : "error",
        input: parsedInput,
        output: toolResult.result || { error: toolResult.message || toolResult.error },
      });

      if (toolResult.result?.offers) collectedOffers.push(...toolResult.result.offers);
      if (toolResult.result?.quote) collectedQuotes.push(toolResult.result.quote);

      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(toolResult.result || { error: toolResult.message || toolResult.error }),
      });
    }

    if (messageHasText(message)) {
      const text = extractTextContent(message);
      if (text) {
        return { provider, model: ep.model, content: text, trace, offers: collectedOffers, quotes: collectedQuotes };
      }
    }
  }

  return {
    provider,
    model: ep.model,
    content: "I reached the tool limit for this request. Here is what I found so far — ask me to narrow down or continue.",
    trace,
    offers: collectedOffers,
    quotes: collectedQuotes,
  };
}
