import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runGoogleSearchProbe, searchProviderStatus } from "../server/research-tools.mjs";

loadDotEnv(resolve(process.cwd(), ".env"));

const query = process.argv.slice(2).join(" ").trim() || "site:realtor.ca Toronto rentals apartment";
const status = searchProviderStatus();

console.log(
  JSON.stringify(
    {
      provider: status.provider,
      requested: status.requested,
      googleConfigured: status.google.configured,
      googleMissing: status.google.missing,
    },
    null,
    2,
  ),
);

const probe = await runGoogleSearchProbe(query);
console.log(
  JSON.stringify(
    {
      ok: probe.ok,
      provider: probe.provider,
      query: probe.query,
      resultCount: probe.results.length,
      error: probe.error,
      results: probe.results.slice(0, 5).map((result) => ({
        title: result.title,
        url: result.url,
        snippet: result.snippet,
      })),
    },
    null,
    2,
  ),
);

if (!probe.ok) process.exitCode = 1;

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = stripQuotes(rawValue.trim());
  }
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
