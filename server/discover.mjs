import { agenticChat, resolveActiveProvider } from "./model-chat.mjs";

// No hardcoded neighbourhood list: the agentic model discovers which Toronto areas fit the
// renter's prompt and supplies approximate coordinates, which the map turns into blobs.
// Returns an ordered array of { id, name, center:[lng,lat] } or null if discovery fails
// (callers fall back so the app never breaks).
export async function discoverNeighborhoods(prompt, env = process.env) {
  if (env.AGENT_DISCOVER === "0") return null;

  const messages = [
    {
      role: "system",
      content:
        "You are a Toronto housing expert. Given a renter's prompt, choose the 6 Toronto " +
        "neighbourhoods that best fit it, ordered best-first. For each give its real approximate " +
        "centre as longitude/latitude. Return strict JSON only: " +
        '{"neighbourhoods":[{"name":"East York","lng":-79.33,"lat":43.69}]}. ' +
        "Use only real Toronto neighbourhoods. Longitude near -79, latitude near 43.7.",
    },
    { role: "user", content: String(prompt || "").slice(0, 600) },
  ];

  const opts = { json: true, maxTokens: 400, timeoutMs: Number(env.AGENT_DISCOVER_TIMEOUT_MS || 45000) };
  // Discovery needs world knowledge: try the active brain first, then fall back to a capable
  // model (HF) before ever falling back to the seed list — so "nothing hardcoded" holds even
  // when the active model is a tiny local GGUF that cannot name real neighbourhoods.
  const active = resolveActiveProvider(env);
  let result = await agenticChat(messages, env, opts);
  let discovered = result ? extractDiscovered(safeJson(result.content)) : null;
  if ((!discovered || discovered.length < 3) && active !== "hf" && env.HF_TOKEN) {
    result = await agenticChat(messages, env, { ...opts, provider: "hf" });
    discovered = result ? extractDiscovered(safeJson(result.content)) : discovered;
  }
  return discovered && discovered.length >= 3 ? discovered : null;
}

function extractDiscovered(parsed) {
  const list = Array.isArray(parsed?.neighbourhoods)
    ? parsed.neighbourhoods
    : Array.isArray(parsed?.neighborhoods)
      ? parsed.neighborhoods
      : Array.isArray(parsed)
        ? parsed
        : [];

  const seen = new Set();
  const discovered = [];
  for (const item of list) {
    const name = cleanName(item?.name);
    const lng = Number(item?.lng ?? item?.longitude);
    const lat = Number(item?.lat ?? item?.latitude);
    if (!name || !inToronto(lng, lat)) continue;
    const id = slug(name);
    if (seen.has(id)) continue;
    seen.add(id);
    discovered.push({ id, name, center: [lng, lat] });
    if (discovered.length >= 7) break;
  }

  return discovered.length >= 3 ? discovered : null;
}

// Turn discovered areas into the ranking row shape. No heuristic scores: every numeric
// signal stays neutral/empty and is hidden by the evidence policy until live research backs
// it. Order = the model's best-first ranking. Real coordinates drive the map.
export function buildDiscoveredRows(discovered) {
  const neutralScores = {
    affordability: 50,
    safety: 50,
    commute: 50,
    transit: 50,
    amenities: 50,
    lifestyle: 50,
    growth: 50,
  };
  return discovered.map((area, index) => ({
    id: area.id,
    name: area.name,
    center: area.center,
    radiusLng: 0.026,
    radiusLat: 0.018,
    seed: index + 1,
    scores: { ...neutralScores },
    rentLo: 0,
    rentHi: 0,
    comLo: 0,
    comHi: 0,
    comMode: "transit",
    trend: 0,
    growthNote: "",
    lifeHi: "",
    short: "",
    tradeoff: "",
  }));
}

function inToronto(lng, lat) {
  return (
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= -79.7 &&
    lng <= -79.05 &&
    lat >= 43.55 &&
    lat <= 43.9
  );
}

function cleanName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[^A-Za-z0-9 &'\-.]/g, "")
    .trim()
    .slice(0, 40);
}

function slug(name) {
  return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
