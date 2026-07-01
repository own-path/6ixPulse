import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const usedTokens = new Set();

function secret(env = process.env) {
  return env.TRAVEL_CONFIRM_SECRET || env.TRAVEL_TOKEN_SECRET || "meridian-travel-dev-secret";
}

function sessionId(env = process.env) {
  return env.TRAVEL_SESSION_ID || "default-session";
}

export function mintConfirmationToken(quoteId, env = process.env, opts = {}) {
  const ttlMs = Number(opts.ttlMs ?? env.TRAVEL_CONFIRM_TTL_MS ?? DEFAULT_TTL_MS);
  const exp = Date.now() + ttlMs;
  const nonce = randomBytes(8).toString("hex");
  const payload = `${quoteId}|${sessionId(env)}|${exp}|${nonce}`;
  const sig = createHmac("sha256", secret(env)).update(payload).digest("hex");
  return {
    confirmation_token: `${Buffer.from(payload).toString("base64url")}.${sig}`,
    expires_at: new Date(exp).toISOString(),
    quote_id: quoteId,
  };
}

export function verifyConfirmationToken(quoteId, token, env = process.env) {
  if (!token || typeof token !== "string") {
    return { ok: false, error: "missing_confirmation_token" };
  }
  if (usedTokens.has(token)) {
    return { ok: false, error: "token_already_used" };
  }

  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, error: "invalid_token_format" };

  let payload;
  try {
    payload = Buffer.from(parts[0], "base64url").toString("utf8");
  } catch {
    return { ok: false, error: "invalid_token_payload" };
  }

  const expectedSig = createHmac("sha256", secret(env)).update(payload).digest("hex");
  const sigBuf = Buffer.from(parts[1], "hex");
  const expBuf = Buffer.from(expectedSig, "hex");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, error: "invalid_token_signature" };
  }

  const [tokenQuoteId, tokenSession, expStr] = payload.split("|");
  if (tokenQuoteId !== quoteId) return { ok: false, error: "quote_id_mismatch" };
  if (tokenSession !== sessionId(env)) return { ok: false, error: "session_mismatch" };

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) {
    return { ok: false, error: "token_expired" };
  }

  usedTokens.add(token);
  return { ok: true };
}

export function clearUsedTokensForTests() {
  usedTokens.clear();
}
