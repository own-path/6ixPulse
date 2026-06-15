const SERVER_INFO = {
  name: "6ixpulse-open-websearch",
  version: "0.1.0",
};

let inputBuffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;
  let newlineIndex = inputBuffer.indexOf("\n");
  while (newlineIndex !== -1) {
    const line = inputBuffer.slice(0, newlineIndex).trim();
    inputBuffer = inputBuffer.slice(newlineIndex + 1);
    if (line) void handleMessage(line);
    newlineIndex = inputBuffer.indexOf("\n");
  }
});

async function handleMessage(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    sendError(null, -32700, "Parse error", error instanceof Error ? error.message : "");
    return;
  }

  if (!message.id && message.method?.startsWith("notifications/")) return;

  try {
    if (message.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: {
            tools: {},
          },
          serverInfo: SERVER_INFO,
        },
      });
      return;
    }

    if (message.method === "tools/list") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: [
            {
              name: "web_search",
              description:
                "No-key web search using public web result pages. Returns title, URL, snippet, and engine.",
              inputSchema: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "Search query.",
                  },
                  count: {
                    type: "number",
                    description: "Maximum result count.",
                  },
                },
                required: ["query"],
              },
            },
          ],
        },
      });
      return;
    }

    if (message.method === "tools/call") {
      const toolName = message.params?.name;
      const args = message.params?.arguments || {};
      if (toolName !== "web_search") {
        sendError(message.id, -32602, `Unknown tool: ${toolName}`);
        return;
      }

      const query = String(args.query || "").trim();
      const count = Math.max(1, Math.min(10, Number.parseInt(args.count, 10) || 6));
      if (!query) {
        sendError(message.id, -32602, "query is required");
        return;
      }

      const results = await multiEngineSearch(query, count);
      const payload = {
        query,
        results,
        note: "No-key public search can be blocked or rate-limited. Verify sources before presenting facts.",
      };

      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(payload),
            },
          ],
          structuredContent: payload,
        },
      });
      return;
    }

    sendError(message.id, -32601, `Method not found: ${message.method}`);
  } catch (error) {
    sendError(message.id, -32000, error instanceof Error ? error.message : "Search failed");
  }
}

async function multiEngineSearch(query, count) {
  const seen = new Set();
  const output = [];
  // Bing's RSS feed was removed: it returned entity/dictionary cards ("East - Wikipedia",
  // "EAST | Merriam-Webster") instead of results — the source of all the junk.
  // When FlareSolverr is configured (FLARESOLVERR_URL), Google is searched first: a headless
  // browser solves the Cloudflare/bot checks that block listing/review sites, giving real
  // person-like deep research with no API key. DuckDuckGo HTML/Lite are the keyless fallback.
  const engines = flareSolverrUrl()
    ? [searchGoogle, searchDuckDuckGoHtml, searchDuckDuckGoLite]
    : [searchDuckDuckGoHtml, searchDuckDuckGoLite];

  for (const engine of engines) {
    try {
      const results = await engine(query, count);
      for (const result of results) {
        const url = normalizeUrl(result.url);
        if (!url || seen.has(url)) continue;
        if (!looksRelevant(result, query)) continue;
        seen.add(url);
        output.push({ ...result, url });
        if (output.length >= count) return output;
      }
    } catch (error) {
      console.error(`${engine.name} failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  return output;
}

// Drop obviously off-topic hits (dictionaries, the compass direction "east", etc.) before
// they ever reach the agent. A result must share a meaningful word with the query.
function looksRelevant(result, query) {
  const hay = `${result.title || ""} ${result.snippet || ""} ${result.url || ""}`.toLowerCase();
  const stop = new Set(["the", "and", "for", "near", "with", "what", "is", "it", "to", "a", "in", "of", "under"]);
  const terms = query.toLowerCase().match(/[a-z]{4,}/g) || [];
  const meaningful = terms.filter((t) => !stop.has(t));
  if (!meaningful.length) return true;
  const hits = meaningful.filter((t) => hay.includes(t)).length;
  return hits >= Math.min(2, meaningful.length);
}

async function searchDuckDuckGoLite(query, count) {
  const url = new URL("https://lite.duckduckgo.com/lite/");
  url.searchParams.set("q", query);
  const html = await fetchText(url);
  const results = [];
  const linkRe = /<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRe.exec(html)) && results.length < count) {
    const href = unwrapDuckDuckGoUrl(decodeHtml(match[1]));
    const title = cleanHtml(match[2]);
    if (title && href) results.push({ title, url: href, snippet: "", engine: "duckduckgo_lite" });
  }
  return results;
}

async function searchDuckDuckGoHtml(query, count) {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const html = await fetchText(url);
  const blocks = html.split(/<div[^>]+class="[^"]*result[^"]*"[^>]*>/i).slice(1);
  const results = [];

  for (const block of blocks) {
    const linkMatch = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const snippetMatch = block.match(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ||
      block.match(/<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const url = unwrapDuckDuckGoUrl(decodeHtml(linkMatch[1]));
    const title = cleanHtml(linkMatch[2]);
    const snippet = snippetMatch ? cleanHtml(snippetMatch[1]) : "";
    if (!title || !url) continue;
    results.push({ title, url, snippet, engine: "duckduckgo_html" });
    if (results.length >= count) break;
  }

  return results;
}

async function searchGoogle(query, count) {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.min(count + 4, 20)));
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "ca");
  const html = await fetchText(url);
  const results = [];
  const seen = new Set();
  // Google wraps each organic result link as <a href="/url?q=<real>&..."> or a direct href.
  const linkRe = /<a href="(\/url\?q=|https?:\/\/)([^"&]+)[^"]*"[^>]*>/gi;
  let match;
  while ((match = linkRe.exec(html)) && results.length < count) {
    const raw = match[1].startsWith("/url") ? decodeURIComponent(match[2]) : `${match[1]}${match[2]}`;
    const link = normalizeUrl(decodeHtml(raw));
    if (!link || seen.has(link)) continue;
    if (/google\.|gstatic\.|youtube\.com\/redirect|\/search\?/.test(link)) continue;
    seen.add(link);
    results.push({ title: domainTitle(link), url: link, snippet: "", engine: "google" });
  }
  return results;
}

function domainTitle(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function flareSolverrUrl() {
  return process.env.FLARESOLVERR_URL || "";
}

async function fetchText(url) {
  const solver = flareSolverrUrl();
  if (solver) return fetchViaFlareSolverr(String(url), solver);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-CA,en;q=0.9",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

// FlareSolverr (https://github.com/FlareSolverr/FlareSolverr) runs a headless browser that
// solves Cloudflare/bot challenges, so listing and review sites that block plain fetches
// become readable — no API key, just a local container:
//   docker run -d -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest
async function fetchViaFlareSolverr(targetUrl, solverBase) {
  const endpoint = `${solverBase.replace(/\/$/, "")}/v1`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.FLARESOLVERR_TIMEOUT_MS || 45000));
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cmd: "request.get",
        url: targetUrl,
        maxTimeout: Number(process.env.FLARESOLVERR_MAX_TIMEOUT_MS || 40000),
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`FlareSolverr HTTP ${response.status}`);
    const data = await response.json();
    const html = data?.solution?.response;
    if (!html) throw new Error("FlareSolverr returned no page content");
    return html;
  } finally {
    clearTimeout(timeout);
  }
}

function unwrapDuckDuckGoUrl(url) {
  try {
    const parsed = new URL(url, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : parsed.toString();
  } catch {
    return url;
  }
}

function normalizeUrl(url) {
  if (!url || typeof url !== "string") return "";
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function cleanHtml(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (_, name) => named[name.toLowerCase()] || `&${name};`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendError(id, code, message, data) {
  send({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      data,
    },
  });
}
