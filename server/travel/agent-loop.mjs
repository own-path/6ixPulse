import { agenticChatWithTools } from "../model-chat.mjs";
import { TRAVEL_TOOLS, TRAVEL_SYSTEM_PROMPT } from "./tool-definitions.mjs";
import { executeTravelTool } from "./tool-executor.mjs";
import { providerStatus } from "./orchestrator.mjs";

export async function runTravelAgent(prompt, env = process.env, opts = {}) {
  const messages = [
    { role: "system", content: TRAVEL_SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  if (opts.confirmation_token && opts.quote_id) {
    messages.push({
      role: "user",
      content: `The user tapped Confirm & book. Use confirm_booking with quote_id="${opts.quote_id}" and confirmation_token="${opts.confirmation_token}".`,
    });
  }

  const chatResult = await agenticChatWithTools(messages, TRAVEL_TOOLS, env, {
    maxRounds: Number(env.TRAVEL_MAX_TOOL_ROUNDS || 8),
    onToolCall: async (name, input) => executeTravelTool(name, input, env),
  });

  if (!chatResult) {
    return {
      ok: false,
      error: "model_unavailable",
      message: "Travel agent model is not configured. Set NVIDIA_API_KEY or HF_TOKEN.",
      providers: providerStatus(env),
    };
  }

  if (chatResult.error) {
    return {
      ok: false,
      error: chatResult.error,
      message: "Travel agent request failed.",
      providers: providerStatus(env),
      trace: chatResult.trace || [],
    };
  }

  return {
    ok: true,
    prompt,
    summary: chatResult.content,
    messages: [
      { role: "user", content: prompt },
      { role: "assistant", content: chatResult.content },
    ],
    offers: dedupeById(chatResult.offers || []),
    quotes: dedupeQuotes(chatResult.quotes || []),
    trace: chatResult.trace || [],
    provider: chatResult.provider,
    model: chatResult.model,
    providers: providerStatus(env),
  };
}

function dedupeById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.offer_id || seen.has(item.offer_id)) return false;
    seen.add(item.offer_id);
    return true;
  });
}

function dedupeQuotes(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.quote_id || seen.has(item.quote_id)) return false;
    seen.add(item.quote_id);
    return true;
  });
}
