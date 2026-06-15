import type { AgentState, ParsedPrompt, RankedNeighborhood } from "./scoring";

export interface AgentBackendRun {
  ok: boolean;
  mode: "hf" | "nvidia" | "ollama" | "llamacpp" | "local-fallback";
  provider?: "nvidia" | "hf" | "ollama" | "llamacpp" | "auto";
  model: string | null;
  prompt: string;
  parsed: ParsedPrompt;
  ranked: RankedNeighborhood[];
  selectedId: string;
  agents: Array<AgentState & { finding?: string }>;
  recommendation?: {
    summary: string;
    selectedId: string;
    rankedIds: string[];
    why: string[];
    cautions: string[];
    nextQuestions: string[];
    citations?: Array<{
      sourceId: string;
      note: string;
    }>;
  };
  webResearch?: {
    enabled: boolean;
    provider: string;
    generatedAt: string;
    targetNeighborhoods: string[];
    queries: Array<{
      id?: string;
      agentId?: string;
      category: string;
      sourceType: string;
      neighborhood: string;
      query: string;
      domains?: string[];
      resultCount?: number;
      rawResultCount?: number;
      error?: string | null;
    }>;
    sources: Array<{
      id: string;
      title: string;
      url: string;
      domain: string;
      snippet: string;
      category: string;
      neighborhood: string;
      sourceType: string;
      agentId?: string;
      reliability: string;
      sourceName?: string;
    }>;
    facts?: Array<{
      id: string;
      sourceId: string;
      sourceName?: string;
      category: string;
      neighborhood: string;
      label: string;
      value: number | string;
      unit: string;
      detail: string;
      reliability: string;
      generatedFrom?: string[];
    }>;
    limitations: string[];
  };
  trace?: Array<{
    id: string;
    tool: string;
    status: "done" | "skipped" | "error";
    input?: unknown;
    output?: unknown;
  }>;
  fallbackReason?: string;
}

export async function runAgentBackend(prompt: string): Promise<AgentBackendRun | null> {
  const controller = new AbortController();
  // Backend budget: research (~40s) + model synthesis + open-data fetch. Keep headroom.
  const timeout = window.setTimeout(() => controller.abort(), 85000);

  try {
    const response = await fetch("/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const data = (await response.json()) as AgentBackendRun;
    if (!data?.ok || !Array.isArray(data.ranked) || !Array.isArray(data.agents)) return null;
    return data;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}
