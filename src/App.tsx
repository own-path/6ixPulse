import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Coffee,
  DollarSign,
  Heart,
  Home,
  Layers,
  LoaderCircle,
  Maximize2,
  MessageCircle,
  Minimize2,
  Route,
  SendHorizontal,
  Shield,
  SlidersHorizontal,
  Sparkles,
  TrainFront,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import MapCanvas from "./components/MapCanvas";
import { DIMENSIONS, type DimensionKey, type LayerKey } from "./data/neighborhoods";
import { runAgentBackend, type AgentBackendRun } from "./lib/agentApi";
import {
  agentDimension,
  cityAgents,
  colorForScore,
  consensus,
  defaultPrompt,
  formatRentRange,
  getAgentFinding,
  getAgentThinking,
  initialAgentStates,
  layerScore,
  parsePrompt,
  queuedAgentStates,
  rankNeighborhoods,
  tagFor,
  type AgentState,
  type ParsedPrompt,
  type RankedNeighborhood,
} from "./lib/scoring";

type NavMode = "overview" | "agents" | "commute" | "affordability" | "lifestyle" | "growth";
type Phase = "done" | "running";
type RunStyle = "cascade" | "radar";
type ResearchTour = {
  runId: number;
  neighborhoodIds: string[];
};
type ResearchFact = NonNullable<NonNullable<AgentBackendRun["webResearch"]>["facts"]>[number];

const initialParsed = parsePrompt(defaultPrompt);
const initialRanked = rankNeighborhoods(initialParsed);

const navItems: Array<{
  id: NavMode;
  label: string;
  icon: typeof Layers;
}> = [
  { id: "overview", label: "Overview", icon: Layers },
  { id: "agents", label: "Agents", icon: Users },
  { id: "commute", label: "Commute", icon: TrainFront },
  { id: "affordability", label: "Affordability", icon: DollarSign },
  { id: "lifestyle", label: "Lifestyle", icon: Coffee },
  { id: "growth", label: "Growth", icon: TrendingUp },
];

const layerLabels: Record<LayerKey, string> = {
  overall: "Match",
  safety: "Safety",
  rent: "Affordability",
  commute: "Commute",
  amenities: "Amenities",
  transit: "Transit",
  lifestyle: "Lifestyle",
  growth: "Growth",
};

const RESEARCH_TOUR_LIMIT = 5;
const RESEARCH_TOUR_OVERVIEW_MS = 0;
// Must match TOUR_DWELL_MS in MapCanvas: the camera dwells on each area while it is researched.
const RESEARCH_TOUR_VISIT_MS = 5400;
const RESEARCH_TOUR_SETTLE_MS = 520;

export default function App() {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [parsed, setParsed] = useState<ParsedPrompt>(initialParsed);
  const [ranked, setRanked] = useState<RankedNeighborhood[]>(initialRanked);
  const [selectedId, setSelectedId] = useState(initialRanked[0].id);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("done");
  const [consensusActive, setConsensusActive] = useState(false);
  const [agents, setAgents] = useState<AgentState[]>(() => initialAgentStates(initialRanked[0]));
  const [runStyle, setRunStyle] = useState<RunStyle>("cascade");
  const [navMode, setNavMode] = useState<NavMode>("overview");
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [signalLayers, setSignalLayers] = useState<Partial<Record<LayerKey, boolean>>>({
    safety: false,
    rent: false,
    commute: false,
    amenities: false,
    transit: false,
  });
  const [bright, setBright] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const [scoreT, setScoreT] = useState(1);
  const [webResearch, setWebResearch] = useState<AgentBackendRun["webResearch"] | null>(null);
  const [recommendation, setRecommendation] = useState<AgentBackendRun["recommendation"] | null>(null);
  const [researchTour, setResearchTour] = useState<ResearchTour | null>(null);
  const [tourFocusId, setTourFocusId] = useState<string | null>(null);
  const [mapFocus, setMapFocus] = useState(false);

  const timersRef = useRef<number[]>([]);
  const frameRef = useRef<number | null>(null);
  const runSeqRef = useRef(0);

  useEffect(() => {
    return () => clearSchedules();
  }, []);

  const selected = useMemo(
    () => ranked.find((neighborhood) => neighborhood.id === selectedId) ?? ranked[0],
    [ranked, selectedId],
  );

  const activeLayer = activeLayerFromNav(navMode);
  const showRail = phase === "running" || agentPanelOpen;
  const tourFocusName = tourFocusId
    ? ranked.find((neighborhood) => neighborhood.id === tourFocusId)?.name
    : null;
  const activeChipLead = phase === "running"
    ? `Researching ${tourFocusName ?? "Toronto"}`
    : "Layer";
  const activeChipDetail = phase === "running"
    ? `${layerLabels[activeLayer]} evidence`
    : `${layerLabels[activeLayer]}${activeLayer === "overall" ? " candidates" : ""}`;

  const runAgents = () => {
    if (phase === "running") return;

    const nextParsed = parsePrompt(prompt);
    const nextRanked = rankNeighborhoods(nextParsed);
    const top = nextRanked[0];
    const runId = runSeqRef.current + 1;
    const tourIds = researchTourIds(nextRanked);
    const tourPromise = waitForResearchTour(tourIds.length);
    runSeqRef.current = runId;
    const backendPromise = runAgentBackend(prompt);

    clearSchedules();
    // The prompt is in flight; reset the composer back to the template so the next ask starts fresh.
    setPrompt(defaultPrompt);
    setParsed(nextParsed);
    setRanked(nextRanked);
    setPhase("running");
    setConsensusActive(false);
    setAgents(queuedAgentStates());
    setScoreT(0);
    setWebResearch(null);
    setRecommendation(null);
    setResearchTour({ runId, neighborhoodIds: tourIds });
    setTourFocusId(null);
    setAgentPanelOpen(true);
    setNavMode("agents");

    const setAgent = (index: number, patch: Partial<AgentState>) => {
      setAgents((current) => {
        const next = current.slice();
        next[index] = { ...next[index], ...patch };
        return next;
      });
    };

    const scoreFor = (agent: AgentState) =>
      agent.id === "recommendation" ? top.overall : top.dims[agentDimension(agent.id)];

    if (runStyle === "cascade") {
      const step = 560;
      cityAgents.forEach((agent, index) => {
        const lines = getAgentThinking(agent.id, nextParsed);
        const offset = index * step;
        schedule(() => setAgent(index, { status: "scanning", lines: [lines[0]] }), offset + 60);
        schedule(() => setAgent(index, { lines: lines.slice(0, 2) }), offset + 250);
        schedule(() => setAgent(index, { status: "scoring", lines }), offset + 380);
        if (agent.id === "recommendation") {
          schedule(() => setConsensusActive(true), offset + 120);
        } else {
          schedule(() => setAgent(index, { status: "done", score: scoreFor({ ...agent, status: "done", lines: [], score: null }) }), offset + 500);
        }
      });
      schedule(() => {
        setAgent(cityAgents.length - 1, {
          status: "done",
          score: top.overall,
          lines: getAgentThinking("recommendation", nextParsed),
        });
        finishRun(backendPromise, tourPromise, runId, nextParsed, nextRanked, top);
      }, cityAgents.length * step + 260);
      return;
    }

    cityAgents.forEach((agent, index) => {
      const lines = getAgentThinking(agent.id, nextParsed);
      schedule(() => setAgent(index, { status: "scanning", lines: [lines[0]] }), 80 + index * 40);
      schedule(() => setAgent(index, { status: "scoring", lines: lines.slice(0, 2) }), 1100 + index * 40);
    });
    schedule(() => setConsensusActive(true), 1850);
    schedule(() => {
      cityAgents.forEach((agent, index) => {
        setAgent(index, {
          status: "done",
          score: agent.id === "recommendation" ? top.overall : top.dims[agentDimension(agent.id)],
          lines: getAgentThinking(agent.id, nextParsed),
        });
      });
    }, 2450);
    schedule(() => finishRun(backendPromise, tourPromise, runId, nextParsed, nextRanked, top), 2700);
  };

  const finishRun = (
    backendPromise: Promise<AgentBackendRun | null>,
    tourPromise: Promise<void>,
    runId: number,
    fallbackParsed: ParsedPrompt,
    fallbackRanked: RankedNeighborhood[],
    fallbackTop: RankedNeighborhood,
  ) => {
    void (async () => {
      const [backend] = await Promise.all([backendPromise, tourPromise]);
      if (runSeqRef.current !== runId) return;

      const nextParsed = isParsedPrompt(backend?.parsed) ? backend.parsed : fallbackParsed;
      const nextRanked = normalizeBackendRanked(backend?.ranked, fallbackRanked);
      const top =
        nextRanked.find((neighborhood) => neighborhood.id === backend?.selectedId) ??
        nextRanked[0] ??
        fallbackTop;

      if (backend?.agents?.length) {
        setAgents(agentStatesFromBackend(backend.agents, top, nextParsed));
      } else {
        setAgents(initialAgentStates(top));
      }
      setWebResearch(backend?.webResearch ?? null);
      setRecommendation(backend?.recommendation ?? null);

      commitRun(nextParsed, nextRanked, top);
    })();
  };

  const commitRun = (
    nextParsed: ParsedPrompt,
    nextRanked: RankedNeighborhood[],
    top: RankedNeighborhood,
  ) => {
    setParsed(nextParsed);
    setRanked(nextRanked);
    setSelectedId(top.id);
    setPhase("done");
    setConsensusActive(false);
    setResearchTour(null);
    setTourFocusId(null);
    setNavMode("overview");
    setAgentPanelOpen(false);
    animateScores();
  };

  const schedule = (fn: () => void, delay: number) => {
    timersRef.current.push(window.setTimeout(fn, delay));
  };

  function clearSchedules() {
    timersRef.current.forEach(window.clearTimeout);
    timersRef.current = [];
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }

  function animateScores() {
    const start = performance.now();
    const duration = 850;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      setScoreT(1 - Math.pow(1 - progress, 3));
      if (progress < 1) frameRef.current = window.requestAnimationFrame(tick);
    };
    frameRef.current = window.requestAnimationFrame(tick);
  }

  function waitForResearchTour(stopCount: number) {
    const duration =
      RESEARCH_TOUR_OVERVIEW_MS +
      Math.max(1, stopCount) * RESEARCH_TOUR_VISIT_MS +
      RESEARCH_TOUR_SETTLE_MS;
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, duration);
    });
  }

  const selectNeighborhood = (id: string) => {
    setSelectedId(id);
    if (phase !== "running") setAgentPanelOpen(false);
  };

  const handleTourStep = useCallback((id: string | null) => {
    setTourFocusId(id);
    if (id) setSelectedId(id);
  }, []);

  const selectNav = (mode: NavMode) => {
    setNavMode(mode);
    setAgentPanelOpen(mode === "agents");
  };

  const toggleSignalLayer = (layer: LayerKey) => {
    setSignalLayers((current) => ({ ...current, [layer]: !current[layer] }));
  };

  const toggleCompare = (id: string) => {
    setCompare((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  return (
    <main className={`app-shell ${mapFocus ? "map-focus" : ""}`}>
      <MapCanvas
        ranked={ranked}
        selectedId={selected.id}
        researchTour={researchTour}
        tourFocusId={tourFocusId}
        activeLayer={activeLayer}
        signalLayers={signalLayers}
        phase={phase}
        runStyle={runStyle}
        bright={bright}
        onSelect={selectNeighborhood}
        onHover={setHoverId}
        onTourStep={handleTourStep}
        onToggleBright={() => setBright((current) => !current)}
      />

      <header className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          <TowerLogo />
        </span>
        <span>
          <strong>6ixPulse</strong>
          <small>Agentic Toronto housing intelligence</small>
        </span>
      </header>

      <section className="command-bar" aria-label="Ask 6ixPulse">
        <div className="composer-label">
          <span className="command-avatar" aria-hidden="true">
            <MessageCircle size={15} />
          </span>
          <span>Ask 6ixPulse</span>
        </div>
        <div className="composer-input-row">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                runAgents();
              }
            }}
            rows={2}
            placeholder="Budget, commute, safety, cafes..."
          />
          <button
            type="button"
            className={`primary-action send-action ${phase === "running" ? "is-running" : ""}`}
            onClick={runAgents}
            disabled={phase === "running"}
            aria-label={phase === "running" ? "6ixPulse is mapping" : "Ask 6ixPulse"}
          >
            {phase === "running" ? <LoaderCircle size={17} /> : <SendHorizontal size={17} />}
            <span className="sr-only">{phase === "running" ? "6ixPulse is mapping" : "Ask 6ixPulse"}</span>
          </button>
        </div>
      </section>

      <div className={`active-layer-chip ${phase === "running" ? "running" : ""}`}>
        <span />
        <small>{activeChipLead}</small>
        <strong>{activeChipDetail}</strong>
      </div>

      <div className="top-actions">
        <button type="button" onClick={() => setMapFocus((current) => !current)}>
          {mapFocus ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
          {mapFocus ? "Panels" : "Map"}
        </button>
        <button type="button">
          <SlidersHorizontal size={16} />
          Filters
        </button>
        <button type="button" onClick={() => setCompareOpen(true)}>
          <Heart size={16} />
          Saved
          <b>{compare.length}</b>
        </button>
      </div>

      {mapFocus ? (
        <button type="button" className="collapsed-panel-tab left" onClick={() => setMapFocus(false)}>
          <Layers size={16} />
          <span>Areas</span>
        </button>
      ) : (
        <aside className="results-panel glass-panel" aria-label="Best neighborhood matches">
          <div className="panel-title">
            <h2>Research Candidates</h2>
            <span>{ranked.length} areas</span>
          </div>
          <ModeSwitcher navMode={navMode} agentPanelOpen={agentPanelOpen} onSelect={selectNav} />
          {phase === "running" ? (
            <div className="loading-stack">
              <span className="loading-line">
                <i />
                Gathering source-backed housing evidence
              </span>
              <span />
              <span />
              <span />
            </div>
          ) : (
            <div className="result-list">
              {ranked.slice(0, 7).map((neighborhood) => (
                <ResultRow
                  key={neighborhood.id}
                  neighborhood={neighborhood}
                  activeLayer={activeLayer}
                  selected={neighborhood.id === selected.id}
                  hovered={neighborhood.id === hoverId}
                  scoreT={scoreT}
                  webResearch={webResearch}
                  onSelect={selectNeighborhood}
                />
              ))}
            </div>
          )}
          <button type="button" className="secondary-action" onClick={() => setCompareOpen(true)}>
            View Full Comparison
          </button>
        </aside>
      )}

      {mapFocus ? (
        <button type="button" className="collapsed-panel-tab right" onClick={() => setMapFocus(false)}>
          {showRail ? <Users size={16} /> : <Shield size={16} />}
          <span>{showRail ? "Agents" : selected.name}</span>
        </button>
      ) : showRail ? (
        <AgentRail
          agents={agents}
          selected={selected}
          parsed={parsed}
          phase={phase}
          consensusActive={consensusActive}
          webResearch={webResearch}
          onClose={() => {
            setAgentPanelOpen(false);
            setNavMode("overview");
          }}
        />
      ) : (
        <DetailPanel
          selected={selected}
          parsed={parsed}
          scoreT={scoreT}
          saved={compare.includes(selected.id)}
          webResearch={webResearch}
          recommendation={recommendation}
          onToggleSaved={() => toggleCompare(selected.id)}
        />
      )}

      {compareOpen && (
        <CompareModal
          ranked={ranked}
          selectedId={selected.id}
          webResearch={webResearch}
          onSelect={(id) => {
            selectNeighborhood(id);
            setCompareOpen(false);
          }}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </main>
  );
}

function researchTourIds(ranked: RankedNeighborhood[]) {
  return ranked.slice(0, RESEARCH_TOUR_LIMIT).map((neighborhood) => neighborhood.id);
}

function normalizeBackendRanked(
  ranked: AgentBackendRun["ranked"] | undefined,
  fallback: RankedNeighborhood[],
): RankedNeighborhood[] {
  if (!Array.isArray(ranked)) return fallback;
  const valid = ranked.filter(isRankedNeighborhood).map((neighborhood, index) => ({
    ...neighborhood,
    rank: Number.isFinite(neighborhood.rank) ? neighborhood.rank : index + 1,
  }));
  return valid.length ? valid : fallback;
}

function agentStatesFromBackend(
  backendAgents: AgentBackendRun["agents"],
  top: RankedNeighborhood,
  parsed: ParsedPrompt,
): AgentState[] {
  return cityAgents.map((agent) => {
    const backend = backendAgents.find((item) => item.id === agent.id);
    const lines = Array.isArray(backend?.lines)
      ? backend.lines.filter((line): line is string => typeof line === "string" && Boolean(line))
      : getAgentThinking(agent.id, parsed);

    return {
      ...agent,
      status: "done",
      lines,
      score: typeof backend?.score === "number" ? backend.score : null,
      finding: typeof backend?.finding === "string" ? backend.finding : undefined,
    };
  });
}

function isParsedPrompt(parsed: AgentBackendRun["parsed"] | undefined): parsed is ParsedPrompt {
  return (
    Boolean(parsed) &&
    typeof parsed?.budget === "number" &&
    typeof parsed?.cap === "number" &&
    Boolean(parsed?.weights) &&
    typeof parsed.weights.affordability === "number" &&
    typeof parsed.weights.safety === "number" &&
    typeof parsed.weights.commute === "number"
  );
}

function isRankedNeighborhood(value: unknown): value is RankedNeighborhood {
  const row = value as RankedNeighborhood;
  return (
    Boolean(row) &&
    typeof row.id === "string" &&
    typeof row.name === "string" &&
    typeof row.overall === "number" &&
    typeof row.rank === "number" &&
    Boolean(row.dims) &&
    typeof row.dims.affordability === "number" &&
    typeof row.dims.safety === "number" &&
    typeof row.rentLo === "number" &&
    typeof row.rentHi === "number" &&
    typeof row.comLo === "number" &&
    typeof row.comHi === "number"
  );
}

function ModeSwitcher({
  navMode,
  agentPanelOpen,
  onSelect,
}: {
  navMode: NavMode;
  agentPanelOpen: boolean;
  onSelect: (mode: NavMode) => void;
}) {
  return (
    <div className="mode-switcher" aria-label="Map views">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = navMode === item.id || (item.id === "agents" && agentPanelOpen);
        return (
          <button
            key={item.id}
            type="button"
            className={active ? "active" : ""}
            onClick={() => onSelect(item.id)}
            aria-label={item.label}
            title={item.label}
          >
            <Icon size={15} />
          </button>
        );
      })}
    </div>
  );
}

function ResultRow({
  neighborhood,
  activeLayer,
  selected,
  hovered,
  scoreT,
  webResearch,
  onSelect,
}: {
  neighborhood: RankedNeighborhood;
  activeLayer: LayerKey;
  selected: boolean;
  hovered: boolean;
  scoreT: number;
  webResearch: AgentBackendRun["webResearch"] | null;
  onSelect: (id: string) => void;
}) {
  const showLayerScore = activeLayer !== "overall";
  const score = layerScore(neighborhood, activeLayer);
  const rentFact = findNeighborhoodFact(webResearch, neighborhood.name, "rent");
  const commuteFact = findNeighborhoodFact(webResearch, neighborhood.name, "commute");
  const hasCompositeEvidence =
    Boolean(rentFact) &&
    Boolean(commuteFact) &&
    Boolean(findNeighborhoodFact(webResearch, neighborhood.name, "safety"));
  const tag = hasCompositeEvidence
    ? tagFor(neighborhood)
    : { label: "Candidate", color: "#5f7faa" };
  const hasLayerEvidence = layerHasEvidence(webResearch, neighborhood.name, activeLayer);

  return (
    <button
      type="button"
      className={`result-row ${selected ? "selected" : ""} ${hovered ? "hovered" : ""}`}
      onClick={() => onSelect(neighborhood.id)}
    >
      <span className="result-main">
        <b>{neighborhood.rank}</b>
        <strong>{neighborhood.name}</strong>
        <TrustBadge sourced={hasCompositeEvidence} />
      </span>
      <span className="result-meta">
        <small>
          <TrainFront size={13} />
          {commuteFact ? formatFactValue(commuteFact) : "Commute source needed"}
        </small>
        <small>
          <Home size={13} />
          {rentFact ? formatFactValue(rentFact) : "Rent source needed"}
        </small>
      </span>
      <span className="result-bottom">
        <em style={{ color: tag.color, borderColor: alpha(tag.color, 0.34), background: alpha(tag.color, 0.12) }}>
          {tag.label}
        </em>
        {showLayerScore && (
          <span className="mini-metric">
            {layerLabels[activeLayer]}
            {hasLayerEvidence ? (
              <i>
                <span style={{ width: `${score}%`, background: colorForScore(score) }} />
              </i>
            ) : (
              <span className="source-needed">pending</span>
            )}
          </span>
        )}
      </span>
    </button>
  );
}

function DetailPanel({
  selected,
  parsed,
  scoreT,
  saved,
  webResearch,
  recommendation,
  onToggleSaved,
}: {
  selected: RankedNeighborhood;
  parsed: ParsedPrompt;
  scoreT: number;
  saved: boolean;
  webResearch: AgentBackendRun["webResearch"] | null;
  recommendation: AgentBackendRun["recommendation"] | null;
  onToggleSaved: () => void;
}) {
  const fit = consensus(selected.overall);
  const safetyFact = findNeighborhoodFact(webResearch, selected.name, "safety");
  const rentFact = findNeighborhoodFact(webResearch, selected.name, "rent");
  const commuteFact = findNeighborhoodFact(webResearch, selected.name, "commute");
  const growthFact = findNeighborhoodFact(webResearch, selected.name, "growth");
  const sourcedWhy = [
    safetyFact
      ? {
          tone: "good" as const,
          text: `${safetyFact.neighborhood}: ${safetyFact.value.toLocaleString()} ${safetyFact.unit} (${factSource(safetyFact)}).`,
        }
      : null,
    rentFact
      ? {
          tone: "good" as const,
          text: `${rentFact.label}: ${formatFactValue(rentFact)} (${factSource(rentFact)}).`,
        }
      : null,
    commuteFact
      ? {
          tone: "good" as const,
          text: `${commuteFact.label}: ${formatFactValue(commuteFact)} (${factSource(commuteFact)}).`,
        }
      : null,
    growthFact
      ? {
          tone: "good" as const,
          text: `${growthFact.label}: ${formatFactValue(growthFact)} (${factSource(growthFact)}).`,
        }
      : null,
  ].filter((item): item is { tone: "good"; text: string } => Boolean(item));

  return (
    <aside className="detail-stack">
      <section className="glass-panel safety-panel">
        <div className="panel-title compact">
          <h2>Safety Signals</h2>
          <Shield size={16} />
        </div>
        {safetyFact ? (
          <>
            <div className="safety-fact">
              <strong>{safetyFact.value.toLocaleString()}</strong>
              <span>{safetyFact.unit}</span>
            </div>
            <p>
              {safetyFact.detail} Source: {factSource(safetyFact)}.
            </p>
          </>
        ) : (
          <DataGap message="Safety data needs a current Toronto Police/Open Data source match before this app should score it." />
        )}
      </section>

      <ResearchPanel webResearch={webResearch} selected={selected} />

      <section className="glass-panel detail-panel">
        <div className="detail-head">
          <div>
            <h2>{selected.name}</h2>
            <span style={{ color: fit.color, borderColor: alpha(fit.color, 0.34), background: alpha(fit.color, 0.12) }}>
              {sourcedWhy.length ? "Source-backed facts" : "Research pending"}
            </span>
          </div>
          <TrustBadge sourced={Boolean(sourcedWhy.length)} />
        </div>

        <h3>Why it works</h3>
        {sourcedWhy.length ? (
          <div className="why-list">
            {sourcedWhy.map((item) => (
              <span key={item.text} className={item.tone}>
                <Check size={13} />
                {item.text}
              </span>
            ))}
          </div>
        ) : (
          <DataGap message="Run a sourced research pass before showing recommendation reasons." />
        )}

        <div className="detail-split">
          <EvidenceMetric
            label={rentFact?.label ?? "Typical rent"}
            value={rentFact ? formatFactValue(rentFact) : "Needs source"}
            detail={rentFact?.detail ?? "Listings, CMHC, market report, or listing-history data required."}
            sourced={Boolean(rentFact)}
          />
          <EvidenceMetric
            label={commuteFact?.label ?? "To Union"}
            value={commuteFact ? formatFactValue(commuteFact) : "Needs source"}
            detail={commuteFact?.detail ?? "Routing or GTFS calculation required before showing a commute time."}
            sourced={Boolean(commuteFact)}
          />
          <EvidenceMetric
            label={growthFact?.label ?? "Development"}
            value={growthFact ? formatFactValue(growthFact) : "Needs source"}
            detail={growthFact?.detail ?? "Use permits, CMHC/market data, or listing history before showing a trend."}
            sourced={Boolean(growthFact)}
          />
        </div>

        {recommendation?.cautions?.length ? (
          <p className="tradeoff">
            <AlertTriangle size={14} />
            {recommendation.cautions[0]}
          </p>
        ) : null}

        <div className="detail-actions">
          <button
            type="button"
            className="primary-action"
            onClick={() => openListings(selected.name)}
          >
            View Listings
          </button>
          <button type="button" className="secondary-action" onClick={onToggleSaved}>
            <Heart size={15} fill={saved ? "currentColor" : "none"} />
            {saved ? "Saved" : "Save"}
          </button>
        </div>
      </section>
    </aside>
  );
}

function ResearchPanel({
  webResearch,
  selected,
}: {
  webResearch: AgentBackendRun["webResearch"] | null;
  selected: RankedNeighborhood;
}) {
  if (!webResearch?.enabled || !webResearch.sources.length) return null;

  const sources = webResearch.sources.slice(0, 5);
  const facts = factsForNeighborhood(webResearch, selected.name).slice(0, 4);
  const totalFacts = webResearch.facts?.length ?? 0;

  return (
    <section className="glass-panel research-panel">
      <div className="panel-title compact">
        <h2>Research Brief</h2>
        <span>{webResearch.sources.length} sources · {totalFacts} facts</span>
      </div>
      <div className="research-meta">
        <span>{webResearch.provider}</span>
        <span>{webResearch.targetNeighborhoods.slice(0, 3).join(", ")}</span>
      </div>
      {facts.length > 0 && (
        <div className="fact-list">
          {facts.map((fact) => (
            <span key={fact.id}>
              <strong>{fact.neighborhood}</strong>
              <b>{fact.value.toLocaleString()}</b>
              <small>{fact.label} · {factSource(fact)}</small>
            </span>
          ))}
        </div>
      )}
      <div className="research-source-list">
        {sources.map((source, index) => (
          <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
            <b>{index + 1}</b>
            <span>
              <strong>{source.sourceName || source.title}</strong>
              <small>
                {source.domain} · {source.category} · {source.reliability}
              </small>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

function AgentRail({
  agents,
  selected,
  parsed,
  phase,
  consensusActive,
  webResearch,
  onClose,
}: {
  agents: AgentState[];
  selected: RankedNeighborhood;
  parsed: ParsedPrompt;
  phase: Phase;
  consensusActive: boolean;
  webResearch: AgentBackendRun["webResearch"] | null;
  onClose: () => void;
}) {
  return (
    <aside className="agent-rail glass-panel">
      <div className="agent-head">
        <div>
          <h2>
            <span className={phase === "running" ? "pulse-dot active" : "pulse-dot"} />
            City Agents
          </h2>
          <p>
            {phase === "running"
              ? consensusActive
                ? "Forming consensus"
                : "Scanning Toronto"
              : `Breakdown for ${selected.name}`}
          </p>
        </div>
        {phase !== "running" && (
          <button type="button" onClick={onClose} aria-label="Close agent panel">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="agent-list">
        {agents.map((agent) => {
          const sourceCount = agentSourceCount(webResearch, selected.name, agent.id);
          return (
            <article key={agent.id} className="agent-card">
              <div className="agent-row">
                <span style={{ color: agent.color, borderColor: alpha(agent.color, 0.32), background: alpha(agent.color, 0.12) }}>
                  {agentIcon(agent.id)}
                </span>
                <strong>{agent.name}</strong>
                <em className={agent.status}>{statusLabel(agent.status)}</em>
                <b style={{ color: agent.color }}>
                  {agentHasScoreEvidence(webResearch, selected.name, agent.id) ? agent.score ?? "--" : "--"}
                </b>
              </div>
              <span className="agent-source-count">
                {sourceCount ? `${sourceCount} contextual sources` : "Awaiting contextual sources"}
              </span>
              {phase === "running" ? (
                <div className="agent-lines">
                  {agent.lines.map((line) => (
                    <small key={line}>{line}</small>
                  ))}
                </div>
              ) : (
                <p>
                  {agentHasFindingEvidence(webResearch, selected.name, agent.id)
                    ? agent.finding || getAgentFinding(agent.id, selected, parsed)
                    : `${agent.name} needs source evidence before showing a finding.`}
                </p>
              )}
              <i className="agent-progress">
                <span
                  style={{
                    width: `${progressFor(agent.status)}%`,
                    background: agent.color,
                  }}
                />
              </i>
            </article>
          );
        })}
      </div>

      <div className="priority-block">
        <small>Optimising for</small>
        <div>{priorityChips(parsed)}</div>
        <p>
          {webResearch?.enabled && webResearch.sources.length
            ? `${webResearch.sources.length} sources and ${webResearch.facts?.length ?? 0} computed facts included. Unsupported categories remain hidden.`
            : "Research sources are required before the app should show housing, safety, commute, or market claims."}
        </p>
      </div>
    </aside>
  );
}

function CompareModal({
  ranked,
  selectedId,
  webResearch,
  onSelect,
  onClose,
}: {
  ranked: RankedNeighborhood[];
  selectedId: string;
  webResearch: AgentBackendRun["webResearch"] | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="compare-modal glass-panel" onClick={(event) => event.stopPropagation()}>
        <div className="compare-head">
          <div>
            <h2>Full Neighborhood Comparison</h2>
            <p>Ranked for the current prompt across every agent dimension.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close comparison">
            <X size={18} />
          </button>
        </div>
        <div className="compare-grid compare-header">
          <span>Neighborhood</span>
          {DIMENSIONS.map((dimension) => (
            <span key={dimension}>{shortDimension(dimension)}</span>
          ))}
          <span>Match</span>
        </div>
        <div className="compare-rows">
          {ranked.map((neighborhood) => (
            <button
              key={neighborhood.id}
              type="button"
              className={`compare-grid ${neighborhood.id === selectedId ? "selected" : ""}`}
              onClick={() => onSelect(neighborhood.id)}
            >
              <span className="compare-name">
                <b>{neighborhood.rank}</b>
                {neighborhood.name}
              </span>
              {DIMENSIONS.map((dimension) => {
                const hasEvidence = dimensionHasEvidence(webResearch, neighborhood.name, dimension);
                return (
                  <span key={dimension} className="compare-bar">
                    {hasEvidence ? (
                      <>
                        <i>
                          <span
                            style={{
                              width: `${neighborhood.dims[dimension]}%`,
                              background: colorForScore(neighborhood.dims[dimension]),
                            }}
                          />
                        </i>
                        <small>{neighborhood.dims[dimension]}</small>
                      </>
                    ) : (
                      <small className="source-needed">Needed</small>
                    )}
                  </span>
                );
              })}
              {dimensionHasEvidence(webResearch, neighborhood.name, "affordability") ? (
                <span className="compare-bar">
                  <i>
                    <span
                      style={{
                        width: `${neighborhood.overall}%`,
                        background: colorForScore(neighborhood.overall),
                      }}
                    />
                  </i>
                  <small>{neighborhood.overall}</small>
                </span>
              ) : (
                <span className="compare-bar">
                  <small className="source-needed">Needed</small>
                </span>
              )}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <span className="score-badge" style={{ background: colorForScore(score || 1) }}>
      {score}
    </span>
  );
}

function TrustBadge({ sourced }: { sourced: boolean }) {
  return <span className={`trust-badge ${sourced ? "sourced" : "pending"}`}>{sourced ? "Sourced" : "Needs source"}</span>;
}

function DataGap({ message }: { message: string }) {
  return (
    <div className="data-gap">
      <AlertTriangle size={13} />
      <span>{message}</span>
    </div>
  );
}

function EvidenceMetric({
  label,
  value,
  detail,
  sourced,
  graphic,
}: {
  label: string;
  value: string;
  detail: string;
  sourced: boolean;
  graphic?: ReactNode;
}) {
  return (
    <article className={`evidence-metric ${sourced ? "sourced" : "pending"}`}>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
      <p>{detail}</p>
      {graphic && <div className="metric-graphic">{graphic}</div>}
    </article>
  );
}

function formatFactValue(fact: ResearchFact) {
  const rawValue =
    typeof fact.value === "number" ? fact.value.toLocaleString() : String(fact.value || "");
  return fact.unit ? `${rawValue} ${fact.unit}` : rawValue;
}

function factSource(fact: ResearchFact) {
  return fact.sourceName || fact.sourceId;
}

// Opens the neighbourhood's listings on a real rentals site (no budget/commute filters from
// the prompt) in a new tab. Listing sites block server scraping but load fine in a real
// browser, so the user gets live listings without the agent scraping blocked pages.
function openListings(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  window.open(`https://rentals.ca/toronto/${slug}`, "_blank", "noopener,noreferrer");
}

function TowerLogo() {
  return (
    <svg className="tower-logo heartbeat-logo" viewBox="0 0 96 64">
      <path
        className="heartbeat-wing heartbeat-wing-left"
        d="M5 37H16L21 30L27 45L33 23L39 37H44"
      />
      <path
        className="heartbeat-wing heartbeat-wing-right"
        d="M52 37H57L62 25L68 45L74 32L80 37H91"
      />
      <path className="heartbeat-tower-stem" d="M48 7V55" />
      <path className="heartbeat-tower-side heartbeat-tower-side-left" d="M48 24C45.4 33 44.2 43.7 43.7 55" />
      <path className="heartbeat-tower-side heartbeat-tower-side-right" d="M48 24C50.6 33 51.8 43.7 52.3 55" />
      <path className="heartbeat-tower-deck" d="M37 26H59M39.5 31H56.5" />
      <path className="heartbeat-tower-pod" d="M40.3 24.6C42 20.2 54 20.2 55.7 24.6L59 31.2H37L40.3 24.6Z" />
      <path className="heartbeat-tower-base" d="M41 55H55" />
    </svg>
  );
}

function Sparkline({ selected }: { selected: RankedNeighborhood }) {
  const { path, area } = useMemo(() => {
    const count = 26;
    const width = 240;
    const height = 56;
    const pad = 5;
    const values = Array.from({ length: count }, (_, index) => {
      return (
        10 +
        (selected.trend / 12) * index * 1.15 +
        Math.sin(index * 1.3 + selected.name.length) * 3 +
        Math.cos(index * 0.7 + selected.seed) * 2
      );
    });
    const min = Math.min(...values);
    const max = Math.max(...values);
    const x = (index: number) => (index / (count - 1)) * (width - pad * 2) + pad;
    const y = (value: number) =>
      height - pad - ((value - min) / ((max - min) || 1)) * (height - pad * 2);
    const line = values
      .map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`)
      .join(" ");
    return {
      path: line,
      area: `${line} L ${x(count - 1).toFixed(1)} ${height} L ${x(0).toFixed(1)} ${height} Z`,
    };
  }, [selected]);

  return (
    <svg viewBox="0 0 240 56" preserveAspectRatio="none" aria-hidden="true">
      <path d={area} fill="rgba(95, 127, 170, 0.16)" />
      <path d={path} fill="none" stroke="#46648d" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function buildWhy(neighborhood: RankedNeighborhood) {
  const rows: Array<{ tone: "good" | "warn"; text: string }> = [];
  const candidates: Array<[DimensionKey, string]> = [
    ["commute", `${neighborhood.comLo}-${neighborhood.comHi} min to Union via ${neighborhood.comMode}`],
    ["affordability", "Lower rent pressure than the downtown core"],
    ["amenities", "Strong grocery, cafe and service access"],
    ["lifestyle", neighborhood.lifeHi],
    ["transit", "Strong transit access"],
    ["safety", "Relatively strong safety signals"],
    ["growth", neighborhood.growthNote],
  ];

  candidates.forEach(([dimension, text]) => {
    if (rows.length < 4 && neighborhood.dims[dimension] >= 75) rows.push({ tone: "good", text });
  });

  if (rows.length < 3) {
    candidates.forEach(([, text]) => {
      if (rows.length < 4 && !rows.some((row) => row.text === text)) rows.push({ tone: "good", text });
    });
  }

  const weakest = candidates.reduce((low, current) =>
    neighborhood.dims[current[0]] < neighborhood.dims[low[0]] ? current : low,
  );
  const warnings: Record<DimensionKey, string> = {
    affordability: "Pricey at the very top end",
    safety: "Mixed safety signals, verify locally",
    commute: "Longer commute on some routes",
    transit: "Transit can need a transfer",
    amenities: "Fewer late-night options",
    lifestyle: "Quieter after dark",
    growth: "Slower projected upside",
  };
  rows.push({ tone: "warn", text: warnings[weakest[0]] });
  return rows;
}

function priorityChips(parsed: ParsedPrompt) {
  const meta: Record<DimensionKey, [string, string]> = {
    affordability: ["Affordability", "#5f7faa"],
    safety: ["Safety", "#304b78"],
    commute: ["Commute", "#46648d"],
    transit: ["Transit", "#6f8faf"],
    amenities: ["Amenities", "#7f99ba"],
    lifestyle: ["Lifestyle", "#8fa6c0"],
    growth: ["Growth", "#243a5c"],
  };
  const entries = Object.entries(parsed.weights)
    .filter(([, value]) => value > 1.05)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5) as Array<[DimensionKey, number]>;

  if (!entries.length) return <span className="empty-priority">Balanced across all signals</span>;

  return entries.map(([dimension]) => {
    const [label, color] = meta[dimension];
    return (
      <span
        key={dimension}
        style={{ color, borderColor: alpha(color, 0.34), background: alpha(color, 0.12) }}
      >
        {label}
      </span>
    );
  });
}

function agentIcon(id: AgentState["id"]) {
  if (id === "affordability") return <DollarSign size={17} />;
  if (id === "commute") return <Route size={17} />;
  if (id === "safety") return <Shield size={17} />;
  if (id === "lifestyle") return <Coffee size={17} />;
  if (id === "growth") return <TrendingUp size={17} />;
  return <Sparkles size={17} />;
}

function activeLayerFromNav(mode: NavMode): LayerKey {
  if (mode === "commute") return "commute";
  if (mode === "affordability") return "rent";
  if (mode === "lifestyle") return "lifestyle";
  if (mode === "growth") return "growth";
  return "overall";
}

function progressFor(status: AgentState["status"]) {
  if (status === "queued") return 8;
  if (status === "scanning") return 46;
  if (status === "scoring") return 78;
  return 100;
}

function statusLabel(status: AgentState["status"]) {
  if (status === "queued") return "Queued";
  if (status === "scanning") return "Scanning";
  if (status === "scoring") return "Scoring";
  return "Done";
}

function shortDimension(dimension: DimensionKey) {
  if (dimension === "affordability") return "Afford";
  if (dimension === "amenities") return "Amenity";
  return dimension[0].toUpperCase() + dimension.slice(1);
}

function alpha(hex: string, value: number) {
  const clean = hex.replace("#", "");
  const parsed = Number.parseInt(clean, 16);
  const red = (parsed >> 16) & 255;
  const green = (parsed >> 8) & 255;
  const blue = parsed & 255;
  return `rgba(${red},${green},${blue},${value})`;
}

function hasNeighborhoodSource(
  webResearch: AgentBackendRun["webResearch"] | null,
  neighborhood: string,
  sourceTypes: string[],
) {
  if (!webResearch?.enabled) return false;
  const target = normalizeEvidenceName(neighborhood);
  return webResearch.sources.some((source) => {
    const sourceNeighborhood = normalizeEvidenceName(source.neighborhood);
    const sourceTypeMatch = sourceTypes.includes(source.sourceType);
    const neighborhoodMatch =
      !sourceNeighborhood ||
      sourceNeighborhood.includes(target) ||
      target.includes(sourceNeighborhood) ||
      source.neighborhood.includes(", ");
    return sourceTypeMatch && neighborhoodMatch;
  });
}

function findNeighborhoodFact(
  webResearch: AgentBackendRun["webResearch"] | null,
  neighborhood: string,
  category: string,
) {
  if (!webResearch?.enabled) return null;
  const target = normalizeEvidenceName(neighborhood);
  return (
    webResearch.facts?.find((fact) => {
      const factNeighborhood = normalizeEvidenceName(fact.neighborhood);
      return (
        fact.category === category &&
        (factNeighborhood === target ||
          factNeighborhood.includes(target) ||
          target.includes(factNeighborhood))
      );
    }) ?? null
  );
}

function factsForNeighborhood(
  webResearch: AgentBackendRun["webResearch"] | null,
  neighborhood: string,
) {
  if (!webResearch?.enabled || !Array.isArray(webResearch.facts)) return [];
  const target = normalizeEvidenceName(neighborhood);
  const order = ["safety", "rent", "commute", "growth", "lifestyle"];
  return webResearch.facts
    .filter((fact) => {
      const factNeighborhood = normalizeEvidenceName(fact.neighborhood);
      return (
        factNeighborhood === target ||
        factNeighborhood.includes(target) ||
        target.includes(factNeighborhood)
      );
    })
    .sort((a, b) => {
      const aIndex = order.indexOf(a.category);
      const bIndex = order.indexOf(b.category);
      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    });
}

function layerHasEvidence(
  webResearch: AgentBackendRun["webResearch"] | null,
  neighborhood: string,
  layer: LayerKey,
) {
  return Boolean(findNeighborhoodFact(webResearch, neighborhood, `${layer}_score`));
}

function dimensionHasEvidence(
  webResearch: AgentBackendRun["webResearch"] | null,
  neighborhood: string,
  dimension: DimensionKey,
) {
  return Boolean(findNeighborhoodFact(webResearch, neighborhood, `${dimension}_score`));
}

function agentHasFindingEvidence(
  webResearch: AgentBackendRun["webResearch"] | null,
  neighborhood: string,
  agentId: AgentState["id"],
) {
  if (agentId === "affordability") {
    return Boolean(findNeighborhoodFact(webResearch, neighborhood, "rent"));
  }
  if (agentId === "commute") return Boolean(findNeighborhoodFact(webResearch, neighborhood, "commute"));
  if (agentId === "safety") return Boolean(findNeighborhoodFact(webResearch, neighborhood, "safety"));
  if (agentId === "lifestyle") return Boolean(findNeighborhoodFact(webResearch, neighborhood, "lifestyle"));
  if (agentId === "growth") return Boolean(findNeighborhoodFact(webResearch, neighborhood, "growth"));
  return (
    Boolean(findNeighborhoodFact(webResearch, neighborhood, "rent")) &&
    Boolean(findNeighborhoodFact(webResearch, neighborhood, "commute")) &&
    Boolean(findNeighborhoodFact(webResearch, neighborhood, "safety"))
  );
}

function agentHasScoreEvidence(
  webResearch: AgentBackendRun["webResearch"] | null,
  neighborhood: string,
  agentId: AgentState["id"],
) {
  if (agentId === "affordability") return dimensionHasEvidence(webResearch, neighborhood, "affordability");
  if (agentId === "commute") return dimensionHasEvidence(webResearch, neighborhood, "commute");
  if (agentId === "safety") return dimensionHasEvidence(webResearch, neighborhood, "safety");
  if (agentId === "lifestyle") return dimensionHasEvidence(webResearch, neighborhood, "lifestyle");
  if (agentId === "growth") return dimensionHasEvidence(webResearch, neighborhood, "growth");
  return (
    dimensionHasEvidence(webResearch, neighborhood, "affordability") &&
    dimensionHasEvidence(webResearch, neighborhood, "commute") &&
    dimensionHasEvidence(webResearch, neighborhood, "safety")
  );
}

function agentSourceCount(
  webResearch: AgentBackendRun["webResearch"] | null,
  neighborhood: string,
  agentId: AgentState["id"],
) {
  if (!webResearch?.enabled) return 0;
  const target = normalizeEvidenceName(neighborhood);
  return webResearch.sources.filter((source) => {
    if (source.agentId !== agentId) return false;
    const sourceNeighborhood = normalizeEvidenceName(source.neighborhood);
    const neighborhoodMatch =
      !sourceNeighborhood ||
      sourceNeighborhood.includes(target) ||
      target.includes(sourceNeighborhood) ||
      source.neighborhood.includes(", ");
    return neighborhoodMatch;
  }).length;
}

function normalizeEvidenceName(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}
