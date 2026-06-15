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
  const engines = [searchDuckDuckGoHtml, searchBingRss];

  for (const engine of engines) {
    try {
      const results = await engine(query, count);
      for (const result of results) {
        const url = normalizeUrl(result.url);
        if (!url || seen.has(url)) continue;
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

async function searchBingRss(query, count) {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "rss");
  const xml = await fetchText(url);
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  return items.slice(0, count).map((item) => ({
    title: cleanHtml(extractTag(item, "title")),
    url: decodeHtml(extractTag(item, "link")),
    snippet: cleanHtml(extractTag(item, "description")),
    engine: "bing_rss",
  })).filter((item) => item.title && item.url);
}

async function fetchText(url) {
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

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1] : "";
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
