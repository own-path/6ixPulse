// Capture one agentic run and write a shareable trace artifact for the Hub.
//
//   node scripts/share-trace.mjs "I make $65k, work near Union, safe, under 40 min, near cafes, max rent $2100"
//
// Produces artifacts/agent-trace.json containing the tool trace, the model/provider
// that ran, the live web-research sources/facts, and the final recommendation —
// ready to upload to a Hugging Face dataset or Space (the "Open trace" badge).

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const PORT = Number(process.env.AGENT_PORT || 8787);
const BASE = process.env.AGENT_BASE_URL || `http://127.0.0.1:${PORT}`;
const prompt =
  process.argv.slice(2).join(" ").trim() ||
  "I make $65k, work near Union, want under 40 min commute, safe area, near cafes, max rent $2,100.";

async function main() {
  const started = Date.now();
  const response = await fetch(`${BASE}/api/agent/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    throw new Error(`Agent backend returned HTTP ${response.status}. Is it running? (npm run dev:api)`);
  }

  const run = await response.json();
  const elapsedMs = Date.now() - started;

  const artifact = {
    app: "6ixPulse",
    description: "Agentic Toronto housing research trace — model planning + live web research + evidence-gated synthesis.",
    generatedAt: new Date().toISOString(),
    elapsedMs,
    prompt,
    model: { provider: run.provider, id: run.model, mode: run.mode, fallbackReason: run.fallbackReason ?? null },
    trace: run.trace ?? [],
    webResearch: {
      provider: run.webResearch?.provider ?? null,
      sourceCount: run.webResearch?.sources?.length ?? 0,
      factCount: run.webResearch?.facts?.length ?? 0,
      sources: run.webResearch?.sources ?? [],
      facts: run.webResearch?.facts ?? [],
      limitations: run.webResearch?.limitations ?? [],
    },
    recommendation: run.recommendation ?? null,
  };

  const outDir = resolve(process.cwd(), "artifacts");
  const outPath = resolve(outDir, "agent-trace.json");
  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  console.log(`Wrote ${outPath}`);
  console.log(
    `  provider=${artifact.model.provider} model=${artifact.model.id} mode=${artifact.model.mode}`,
  );
  console.log(
    `  trace steps=${artifact.trace.length} sources=${artifact.webResearch.sourceCount} facts=${artifact.webResearch.factCount}`,
  );
  console.log("\nShare it (Open-trace badge):");
  console.log("  huggingface-cli upload <your-username>/6ixpulse-traces artifacts/agent-trace.json");
}

main().catch((error) => {
  console.error(`share-trace failed: ${error.message}`);
  process.exit(1);
});
