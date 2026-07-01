import { runTravelAgent } from "./agent-loop.mjs";
import { createQuote, confirmBooking, providerStatus } from "./orchestrator.mjs";
import { mintConfirmationToken, verifyConfirmationToken } from "./confirmation-tokens.mjs";

export async function handleTravelHealth(env = process.env) {
  return {
    ok: true,
    service: "Meridian travel agent",
    providers: providerStatus(env),
  };
}

export async function handleTravelRun(body, env = process.env) {
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt && !body?.quote_id) {
    return { ok: false, error: "missing_prompt", message: "prompt is required" };
  }

  const result = await runTravelAgent(prompt || "Complete the booking.", env, {
    quote_id: body?.quote_id,
    confirmation_token: body?.confirmation_token,
  });

  return result;
}

export async function handleTravelQuote(body, env = process.env) {
  const offer_id = typeof body?.offer_id === "string" ? body.offer_id : "";
  if (!offer_id) return { ok: false, error: "missing_offer_id" };

  const quote = await createQuote({ offer_id }, env);
  if (quote?.error) return { ok: false, error: quote.error, message: quote.message };
  return { ok: true, quote };
}

export async function handleConfirmToken(body, env = process.env) {
  const quote_id = typeof body?.quote_id === "string" ? body.quote_id : "";
  if (!quote_id) return { ok: false, error: "missing_quote_id" };

  const token = mintConfirmationToken(quote_id, env);
  return { ok: true, ...token };
}

export async function handleTravelConfirm(body, env = process.env) {
  const quote_id = typeof body?.quote_id === "string" ? body.quote_id : "";
  const confirmation_token = typeof body?.confirmation_token === "string" ? body.confirmation_token : "";
  if (!quote_id || !confirmation_token) {
    return { ok: false, error: "missing_fields", message: "quote_id and confirmation_token are required" };
  }

  const booking = await confirmBooking(
    { quote_id, confirmation_token },
    (qid, tok) => verifyConfirmationToken(qid, tok, env),
    env,
  );
  return { ok: booking.ok, booking };
}
