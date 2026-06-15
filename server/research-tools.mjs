import { spawn } from "node:child_process";
import { resolve } from "node:path";

const DEFAULT_SEARCH_URLS = {
  brave: "https://api.search.brave.com/res/v1/web/search",
  serpapi: "https://serpapi.com/search.json",
  tavily: "https://api.tavily.com/search",
  google_cse: "https://customsearch.googleapis.com/customsearch/v1",
};

const TORONTO_OPEN_DATA_API =
  "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action";
const TORONTO_DATASETS = {
  neighbourhoods: {
    title: "City of Toronto Open Data: Neighbourhoods",
    url: "https://open.toronto.ca/dataset/neighbourhoods/",
    resourceId: "5e6095fc-1bef-4776-887c-28d37f722c51",
    category: "official",
    sourceType: "official_geography",
    agentId: "recommendation",
    reliability: "high",
    snippet: "Live 158-neighbourhood boundary dataset used for Toronto social planning geography.",
  },
  crimeRates: {
    title: "Toronto Police / Toronto Open Data: Neighbourhood Crime Rates",
    url: "https://open.toronto.ca/dataset/neighbourhood-crime-rates/",
    resourceId: "d4160604-9f3e-4589-8821-9fd70fa350b3",
    category: "safety",
    sourceType: "official_safety",
    agentId: "safety",
    reliability: "high",
    snippet:
      "Annual reported crime counts and per-100,000 rates by Toronto neighbourhood.",
  },
  activePermits: {
    title: "City of Toronto Open Data: Building Permits - Active Permits",
    url: "https://open.toronto.ca/dataset/building-permits-active-permits/",
    resourceId: "6d0229af-bc54-46de-9c2b-26759b01dd05",
    category: "development",
    sourceType: "official_development",
    agentId: "growth",
    reliability: "high",
    snippet: "Daily active building applications and permits for Toronto development context.",
  },
  clearedPermits: {
    title: "City of Toronto Open Data: Building Permits - Cleared Permits",
    url: "https://open.toronto.ca/dataset/building-permits-cleared-permits/",
    resourceId: "a96c0ba4-3026-402b-b09d-5b1268b8f810",
    category: "development",
    sourceType: "official_development",
    agentId: "growth",
    reliability: "high",
    snippet: "Completed/closed building permits since 2017 for development momentum context.",
  },
  ttcGtfs: {
    title: "Toronto Open Data: Merged GTFS - TTC Routes and Schedules",
    url: "https://open.toronto.ca/dataset/merged-gtfs-ttc-routes-and-schedules/",
    resourceId: "c920e221-7a1c-488b-8c5b-6d8cd4e85eaf",
    category: "transit",
    sourceType: "official_transit",
    agentId: "commute",
    reliability: "high",
    snippet: "TTC route definitions, stops, schedules, and stop locations in GTFS format.",
  },
  statCanWds: {
    title: "Statistics Canada Web Data Service",
    url: "https://www.statcan.gc.ca/en/developers/wds",
    category: "demographics",
    sourceType: "official_demographics",
    agentId: "recommendation",
    reliability: "high",
    snippet:
      "Official Statistics Canada API for census, housing, income, labour, and population indicators.",
  },
  googlePlaces: {
    title: "Google Maps Platform: Places API",
    url: "https://developers.google.com/maps/documentation/places/web-service/overview",
    category: "reviews",
    sourceType: "places_reviews",
    agentId: "lifestyle",
    reliability: "medium",
    snippet:
      "Location, place details, ratings, reviews, photos, and nearby amenity context through Google Places.",
  },
  googleRoutes: {
    title: "Google Maps Platform: Routes API",
    url: "https://developers.google.com/maps/documentation/routes",
    category: "transit",
    sourceType: "routing",
    agentId: "commute",
    reliability: "medium",
    snippet:
      "Route computation for commute time estimates when a Google Maps Platform key is configured.",
  },
  cmhcRentalMarket: {
    title: "CMHC Housing Market Information Portal: Rental Market Data",
    url: "https://www03.cmhc-schl.gc.ca/hmip-pimh/en",
    category: "rent",
    sourceType: "market_rent_report",
    agentId: "affordability",
    reliability: "medium",
    snippet:
      "CMHC rental-market data portal used as official Canadian rental market context before presenting rent claims.",
  },
  rentalsCaRentReport: {
    title: "Rentals.ca National Rent Report",
    url: "https://rentals.ca/national-rent-report",
    category: "rent",
    sourceType: "market_rent_report",
    agentId: "affordability",
    reliability: "medium",
    snippet:
      "Canadian rent report used as market context for current rental conditions and trends.",
  },
};

const officialDataCache = new Map();

export async function runHousingResearch(localRun, env = process.env) {
  if (env.RESEARCH_ENABLED === "0") {
    return disabledResearch("RESEARCH_ENABLED is disabled", env);
  }

  const official = await runAuthoritativeResearch(localRun, env);
  const provider = configuredSearchProvider(env);
  if (provider === "disabled") {
    const facts = deriveContextualFacts({
      targetNeighborhoods: official.targetNeighborhoods,
      sources: official.sources,
      facts: official.facts,
    });
    return {
      enabled: official.sources.length > 0,
      provider: official.sources.length ? "official-open-data" : "disabled",
      generatedAt: new Date().toISOString(),
      targetNeighborhoods: official.targetNeighborhoods,
      queries: [],
      sources: official.sources,
      facts,
      limitations: [
        ...official.limitations,
        missingSearchProviderMessage(env),
      ],
    };
  }

  const queries = buildHousingResearchQueries(localRun, env);
  const sources = [...official.sources];
  const queryReports = [];
  const seenUrls = new Set(sources.map((source) => source.url));
  const maxSources = positiveInt(env.RESEARCH_MAX_SOURCES, 18);
  const searchStartedAt = Date.now();
  const totalTimeoutMs = positiveInt(env.RESEARCH_TOTAL_TIMEOUT_MS, 45000);
  let timeBudgetExhausted = false;

  for (const query of queries) {
    const elapsedMs = Date.now() - searchStartedAt;
    if (elapsedMs >= totalTimeoutMs) {
      timeBudgetExhausted = true;
      queryReports.push({
        ...query,
        resultCount: 0,
        rawResultCount: 0,
        error: `Research time budget exhausted after ${totalTimeoutMs}ms`,
      });
      break;
    }

    const result = await searchWeb(query.query, provider, env, {
      count: positiveInt(env.RESEARCH_RESULTS_PER_QUERY, 4),
      timeoutMs: Math.max(1000, totalTimeoutMs - elapsedMs),
    });
    const filteredResults = filterResultsForQuery(result.results, query);
    queryReports.push({
      ...query,
      resultCount: filteredResults.length,
      rawResultCount: result.results.length,
      error: result.error || null,
    });

    for (const item of filteredResults) {
      const url = normalizeUrl(item.url);
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);

      sources.push({
        id: `S${sources.length + 1}`,
        title: cleanText(item.title) || domainFromUrl(url),
        url,
        domain: domainFromUrl(url),
        snippet: cleanText(item.snippet),
        category: query.category,
        neighborhood: query.neighborhood,
        sourceType: query.sourceType,
        agentId: query.agentId,
        reliability: reliabilityFor(query.sourceType),
      });

      if (sources.length >= maxSources) break;
    }
    if (sources.length >= maxSources) break;
  }

  const limitations = [...official.limitations, ...researchLimitations(provider)];
  if (timeBudgetExhausted) {
    limitations.unshift(
      `Web research stopped after ${totalTimeoutMs}ms to keep the agent response interactive.`,
    );
  }

  const targetNeighborhoods = localRun.ranked.slice(0, neighborhoodCount(env)).map((row) => row.name);
  const facts = deriveContextualFacts({
    targetNeighborhoods,
    sources,
    facts: official.facts,
  });

  return {
    enabled: true,
    provider,
    generatedAt: new Date().toISOString(),
    targetNeighborhoods,
    queries: queryReports,
    sources,
    facts,
    limitations,
  };
}

function deriveContextualFacts({ targetNeighborhoods, sources, facts }) {
  const output = [...facts];

  for (const neighborhood of targetNeighborhoods) {
    if (!findFact(output, neighborhood, "rent")) {
      const rentSources = sourcesForNeighborhood(sources, neighborhood).filter((source) =>
        ["market_listing", "market_context", "market_rent_report"].includes(source.sourceType) ||
        source.agentId === "affordability",
      );
      if (rentSources.length) {
        output.push(sourceCoverageFact({
          id: `F-rent-coverage-${normalizeName(neighborhood)}`,
          category: "rent",
          neighborhood,
          label: "Rent evidence",
          value: `${rentSources.length} source${rentSources.length === 1 ? "" : "s"}`,
          unit: "checked",
          source: rentSources[0],
          reliability: strongestReliability(rentSources),
          detail:
            "Market/listing sources were found for rental context. Exact rent stays hidden until listing/API values are parsed.",
        }));
      }
    }

    if (!findFact(output, neighborhood, "commute")) {
      const commuteSources = sourcesForNeighborhood(sources, neighborhood).filter((source) =>
        ["routing", "official_transit"].includes(source.sourceType) || source.agentId === "commute",
      );
      if (commuteSources.length) {
        output.push(sourceCoverageFact({
          id: `F-commute-coverage-${normalizeName(neighborhood)}`,
          category: "commute",
          neighborhood,
          label: "Commute evidence",
          value: "Transit source",
          unit: "available",
          source: commuteSources[0],
          reliability: strongestReliability(commuteSources),
          detail:
            "TTC/route data is available for commute research. Exact door-to-door time still needs a routing calculation.",
        }));
      }
    }

    if (!findFact(output, neighborhood, "growth")) {
      const growthSources = sourcesForNeighborhood(sources, neighborhood).filter((source) =>
        ["official_development", "market_context"].includes(source.sourceType) || source.agentId === "growth",
      );
      if (growthSources.length) {
        output.push(sourceCoverageFact({
          id: `F-growth-coverage-${normalizeName(neighborhood)}`,
          category: "growth",
          neighborhood,
          label: "Growth evidence",
          value: `${growthSources.length} source${growthSources.length === 1 ? "" : "s"}`,
          unit: "checked",
          source: growthSources[0],
          reliability: strongestReliability(growthSources),
          detail:
            "Permit/development sources were found for trend context. Numeric rent trend stays hidden until market data is computed.",
        }));
      }
    }
  }

  return output;
}

function sourceCoverageFact({ id, category, neighborhood, label, value, unit, source, reliability, detail }) {
  return {
    id,
    sourceId: source.id,
    category,
    neighborhood,
    label,
    value,
    unit,
    detail,
    reliability,
    generatedFrom: [source.sourceType],
  };
}

function sourcesForNeighborhood(sources, neighborhood) {
  const target = normalizeName(neighborhood);
  return sources.filter((source) => {
    const sourceNeighborhood = normalizeName(source.neighborhood);
    return (
      !sourceNeighborhood ||
      source.neighborhood.includes(",") ||
      sourceNeighborhood.includes(target) ||
      target.includes(sourceNeighborhood)
    );
  });
}

function findFact(facts, neighborhood, category) {
  const target = normalizeName(neighborhood);
  return facts.find((fact) => {
    const factNeighborhood = normalizeName(fact.neighborhood);
    return (
      fact.category === category &&
      (factNeighborhood === target ||
        factNeighborhood.includes(target) ||
        target.includes(factNeighborhood))
    );
  });
}

function strongestReliability(sources) {
  if (sources.some((source) => source.reliability === "high")) return "high";
  if (sources.some((source) => source.reliability === "medium")) return "medium";
  return "low";
}

export function configuredSearchProvider(env = process.env) {
  const requested = normalizeSearchProvider(env.SEARCH_PROVIDER || "auto");
  if (requested !== "auto") {
    if (requested === "mcp_open_websearch" && mcpOpenWebSearchEnabled(env)) return "mcp_open_websearch";
    if (requested === "brave" && env.BRAVE_SEARCH_API_KEY) return "brave";
    if (requested === "serpapi" && env.SERPAPI_API_KEY) return "serpapi";
    if (requested === "tavily" && env.TAVILY_API_KEY) return "tavily";
    if (requested === "google_cse" && googleSearchConfigured(env)) {
      return "google_cse";
    }
    return "disabled";
  }

  if (mcpOpenWebSearchEnabled(env)) return "mcp_open_websearch";
  if (googleSearchConfigured(env)) return "google_cse";
  if (env.SERPAPI_API_KEY) return "serpapi";
  if (env.BRAVE_SEARCH_API_KEY) return "brave";
  if (env.TAVILY_API_KEY) return "tavily";
  return "disabled";
}

export function searchProviderStatus(env = process.env) {
  const googleApiKeyConfigured = Boolean(googleSearchApiKey(env));
  const googleEngineConfigured = Boolean(googleSearchEngineId(env));
  const provider = configuredSearchProvider(env);

  return {
    provider,
    requested: normalizeSearchProvider(env.SEARCH_PROVIDER || "auto"),
    google: {
      configured: googleApiKeyConfigured && googleEngineConfigured,
      apiKeyConfigured: googleApiKeyConfigured,
      engineConfigured: googleEngineConfigured,
      missing: [
        googleApiKeyConfigured ? null : "GOOGLE_SEARCH_API_KEY",
        googleEngineConfigured ? null : "GOOGLE_SEARCH_CX",
      ].filter(Boolean),
      aliases: {
        apiKey: ["GOOGLE_SEARCH_API_KEY", "GOOGLE_CSE_API_KEY", "GOOGLE_API_KEY"],
        engine: [
          "GOOGLE_SEARCH_CX",
          "GOOGLE_SEARCH_ENGINE_ID",
          "GOOGLE_CSE_ID",
          "GOOGLE_PROGRAMMABLE_SEARCH_ENGINE_ID",
        ],
      },
    },
    providers: {
      mcp_open_websearch: mcpOpenWebSearchEnabled(env),
      google_cse: googleApiKeyConfigured && googleEngineConfigured,
      serpapi: Boolean(env.SERPAPI_API_KEY),
      brave: Boolean(env.BRAVE_SEARCH_API_KEY),
      tavily: Boolean(env.TAVILY_API_KEY),
    },
  };
}

export async function runGoogleSearchProbe(queryText, env = process.env) {
  const status = searchProviderStatus(env);
  const query = String(queryText || "").trim() || "Toronto rental market neighbourhood reviews";
  if (!status.google.configured) {
    return {
      ok: false,
      provider: "google_cse",
      query,
      results: [],
      error: `Google Custom Search is missing ${status.google.missing.join(" and ")}.`,
      status,
    };
  }

  const result = await searchGoogleCse(query, env, {
    count: positiveInt(env.GOOGLE_SEARCH_TEST_RESULTS, 5),
  });

  return {
    ok: !result.error,
    provider: "google_cse",
    query,
    results: result.results,
    error: result.error || null,
    status,
  };
}

function buildHousingResearchQueries(localRun, env) {
  const neighborhoods = localRun.ranked.slice(0, neighborhoodCount(env));
  const budget = localRun.parsed.budget;
  const cap = localRun.parsed.cap;
  const maxQueries = positiveInt(env.RESEARCH_MAX_QUERIES, researchDepth(env) === "deep" ? 18 : 10);
  const context = {
    budget,
    cap,
    context: contextualPromptTerms(localRun.prompt),
    destination: inferDestination(localRun.prompt),
  };
  const prioritizedAgents = prioritizedResearchAgents(localRun.parsed);
  const primaryQueries = [];
  const secondaryQueries = [];

  for (const neighborhood of neighborhoods) {
    for (const agentId of prioritizedAgents) {
      const agentQueries = queriesForAgent(agentId, neighborhood.name, context);
      const [primary, ...secondary] = agentQueries;
      if (primary) primaryQueries.push(primary);
      secondaryQueries.push(...secondary);
    }
  }
  const queries = [...primaryQueries, ...secondaryQueries];

  if (researchDepth(env) !== "deep") {
    return interleaveByNeighborhood(queries).slice(0, maxQueries);
  }
  return interleaveByCategory(queries).slice(0, maxQueries);
}

async function runAuthoritativeResearch(localRun, env) {
  if (env.OFFICIAL_DATA_ENABLED === "0") {
    return {
      targetNeighborhoods: [],
      sources: [],
      facts: [],
      limitations: ["OFFICIAL_DATA_ENABLED is disabled."],
    };
  }

  const targetNeighborhoods = localRun.ranked
    .slice(0, neighborhoodCount(env))
    .map((row) => row.name);
  const sources = [
    sourceFromDataset("neighbourhoods", targetNeighborhoods),
    sourceFromDataset("crimeRates", targetNeighborhoods),
    sourceFromDataset("cmhcRentalMarket", targetNeighborhoods),
    sourceFromDataset("rentalsCaRentReport", targetNeighborhoods),
    sourceFromDataset("activePermits", targetNeighborhoods),
    sourceFromDataset("clearedPermits", targetNeighborhoods),
    sourceFromDataset("ttcGtfs", targetNeighborhoods),
    sourceFromDataset("statCanWds", targetNeighborhoods),
  ];

  if (env.GOOGLE_MAPS_API_KEY || env.GOOGLE_PLACES_API_KEY) {
    sources.push(sourceFromDataset("googlePlaces", targetNeighborhoods));
  }
  if (env.GOOGLE_MAPS_API_KEY || env.GOOGLE_ROUTES_API_KEY) {
    sources.push(sourceFromDataset("googleRoutes", targetNeighborhoods));
  }

  sources.forEach((source, index) => {
    source.id = `S${index + 1}`;
  });

  const facts = [];
  const limitations = [];

  try {
    const crimeRows = await fetchCkanRecords(TORONTO_DATASETS.crimeRates.resourceId, env);
    const crimeSource = sources.find((source) => source.sourceType === "official_safety");
    for (const neighborhood of targetNeighborhoods) {
      const row = matchNeighborhoodRecord(neighborhood, crimeRows);
      if (!row || !crimeSource) continue;
      const fact = safetyFactFromCrimeRow(row, neighborhood, crimeSource.id);
      if (fact) facts.push(fact);
    }
  } catch (error) {
    limitations.push(
      `Toronto crime-rate dataset could not be read: ${
        error instanceof Error ? error.message : "Unknown data error"
      }`,
    );
  }

  // Map coordinates only (not shown as a research source): a public metadata lookup of each area's
  // centre so the map can place dynamically-discovered neighbourhoods. The user-facing
  // housing evidence comes from official data + deep web research, not encyclopedia text.
  try {
    facts.push(...(await fetchNeighborhoodGeoFacts(targetNeighborhoods, env)));
  } catch {
    /* coordinates are optional; ignore lookup failures */
  }

  return {
    targetNeighborhoods,
    sources,
    facts,
    limitations,
  };
}

async function fetchNeighborhoodGeoFacts(neighborhoods, env) {
  const facts = [];
  const timeoutMs = positiveInt(env.WIKIPEDIA_TIMEOUT_MS, 8000);
  const summaries = await Promise.all(
    neighborhoods.map((neighborhood) => fetchWikipediaSummary(neighborhood, timeoutMs)),
  );

  summaries.forEach((summary, index) => {
    if (!summary?.coordinates) return;
    facts.push({
      id: `F-geo-${normalizeName(neighborhoods[index])}`,
      sourceId: "",
      category: "geo",
      neighborhood: neighborhoods[index],
      label: "Approximate centre",
      value: `${summary.coordinates.lat.toFixed(4)}, ${summary.coordinates.lon.toFixed(4)}`,
      unit: "lat, lon",
      detail: "Map placement only; not a user-facing housing claim.",
      reliability: "medium",
      generatedFrom: ["geo_lookup"],
      lat: summary.coordinates.lat,
      lon: summary.coordinates.lon,
    });
  });

  return facts;
}

async function fetchWikipediaSummary(neighborhood, timeoutMs) {
  const name = String(neighborhood || "").trim().replace(/\s+/g, " ");
  if (!name) return null;
  // Many Toronto areas (Parkdale, The Junction, Weston...) share names with other places,
  // so try the bare title first, then the disambiguated "<name>, Toronto" form.
  return (
    (await fetchWikipediaSummaryByTitle(name, timeoutMs)) ||
    (await fetchWikipediaSummaryByTitle(`${name}, Toronto`, timeoutMs))
  );
}

async function fetchWikipediaSummaryByTitle(name, timeoutMs) {
  const title = encodeURIComponent(name);
  if (!title) return null;
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${title}`;
  try {
    const response = await fetchWithTimeout(url, {
      timeoutMs,
      headers: { Accept: "application/json", "User-Agent": "6ixPulse/0.1 (housing research agent)" },
    });
    const data = await response.json();
    // Only keep real, Toronto-relevant articles — skip disambiguation pages and off-topic hits.
    if (data.type === "disambiguation" || !data.extract) return null;
    const extract = cleanText(data.extract);
    if (!/toronto|ontario/i.test(extract)) return null;
    return {
      title: data.title || name,
      url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${title}`,
      extract: extract.slice(0, 400),
      coordinates: data.coordinates
        ? { lat: Number(data.coordinates.lat), lon: Number(data.coordinates.lon) }
        : null,
    };
  } catch {
    return null;
  }
}

// Match the Toronto Police neighbourhood crime dataset by LOCATION first: each discovered
// area's centre is tested against every neighbourhood polygon (point-in-polygon), so safety
// resolves even when the model's name doesn't match an official neighbourhood. Falls back to
// fuzzy name matching. `neighborhoods` is [{ name, center:[lng,lat] }].
export async function crimeRatesByLocation(neighborhoods, env = process.env) {
  const out = {};
  if (env.OFFICIAL_DATA_ENABLED === "0" || !Array.isArray(neighborhoods) || !neighborhoods.length) return out;
  try {
    const rows = await fetchCkanRecords(TORONTO_DATASETS.crimeRates.resourceId, env);
    for (const n of neighborhoods) {
      const center = Array.isArray(n.center) ? n.center : null;
      let row = center && Number.isFinite(center[0])
        ? rows.find((r) => pointInGeometry(center, r.geometry))
        : null;
      if (!row) row = matchNeighborhoodRecord(n.name, rows);
      if (!row) continue;
      const fact = safetyFactFromCrimeRow(row, n.name, "police");
      if (!fact) continue;
      const year = (String(fact.label).match(/20\d\d/) || [])[0];
      const countMatch = String(fact.detail).match(/^([\d,]+)/);
      out[normalizeName(n.name)] = {
        rate: Number(fact.value),
        year,
        count: countMatch ? Number(countMatch[1].replace(/,/g, "")) : null,
        areaName: row.AREA_NAME,
      };
    }
  } catch {
    /* official data is optional */
  }
  return out;
}

function pointInGeometry(point, geometry) {
  let geo = geometry;
  if (typeof geo === "string") {
    try {
      geo = JSON.parse(geo);
    } catch {
      return false;
    }
  }
  if (!geo) return false;
  const polygons = geo.type === "MultiPolygon" ? geo.coordinates : geo.type === "Polygon" ? [geo.coordinates] : [];
  const [x, y] = point;
  for (const polygon of polygons) {
    const ring = polygon?.[0];
    if (Array.isArray(ring) && pointInRing(x, y, ring)) return true;
  }
  return false;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function sourceFromDataset(key, neighborhoods) {
  const dataset = TORONTO_DATASETS[key];
  return {
    id: "",
    title: dataset.title,
    url: dataset.url,
    domain: domainFromUrl(dataset.url),
    snippet: dataset.snippet,
    category: dataset.category,
    neighborhood: neighborhoods.join(", "),
    sourceType: dataset.sourceType,
    agentId: dataset.agentId,
    reliability: dataset.reliability,
  };
}

async function fetchCkanRecords(resourceId, env) {
  const cacheKey = `ckan:${resourceId}`;
  const cached = officialDataCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < positiveInt(env.OFFICIAL_DATA_CACHE_MS, 600000)) {
    return cached.records;
  }

  const url = new URL(`${env.TORONTO_OPEN_DATA_API || TORONTO_OPEN_DATA_API}/datastore_search`);
  url.searchParams.set("resource_id", resourceId);
  url.searchParams.set("limit", String(positiveInt(env.OFFICIAL_DATA_RECORD_LIMIT, 500)));

  const response = await fetchWithTimeout(url, {
    timeoutMs: positiveInt(env.RESEARCH_TIMEOUT_MS, 12000),
  });
  const data = await response.json();
  const records = Array.isArray(data.result?.records) ? data.result.records : [];
  officialDataCache.set(cacheKey, { createdAt: Date.now(), records });
  return records;
}

function matchNeighborhoodRecord(name, records) {
  const target = normalizeName(name);
  return (
    records.find((row) => normalizeName(row.AREA_NAME) === target) ||
    records.find((row) => normalizeName(row.AREA_NAME).includes(target)) ||
    records.find((row) => target.includes(normalizeName(row.AREA_NAME)))
  );
}

function safetyFactFromCrimeRow(row, requestedName, sourceId) {
  const years = Object.keys(row)
    .map((key) => key.match(/_RATE_(20\d{2})$/)?.[1])
    .filter(Boolean)
    .map((year) => Number.parseInt(year, 10));
  const year = Math.max(...years);
  if (!Number.isFinite(year)) return null;

  const types = ["ASSAULT", "AUTOTHEFT", "BREAKENTER", "ROBBERY", "SHOOTING", "THEFTFROMMV"];
  const totalRate = types.reduce((sum, type) => {
    const value = Number(row[`${type}_RATE_${year}`]);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
  const totalCount = types.reduce((sum, type) => {
    const value = Number(row[`${type}_${year}`]);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);

  return {
    id: `F-safety-${normalizeName(requestedName)}`,
    sourceId,
    category: "safety",
    neighborhood: row.AREA_NAME || requestedName,
    label: `${year} selected reported-crime rate`,
    value: Math.round(totalRate),
    unit: "reported incidents per 100,000 residents",
    detail: `${totalCount.toLocaleString()} selected reported incidents across assault, auto theft, break and enter, robbery, shootings, and theft from motor vehicle.`,
    reliability: "high",
    generatedFrom: types.flatMap((type) => [`${type}_${year}`, `${type}_RATE_${year}`]),
  };
}

function query(category, sourceType, neighborhood, text, agentId = "recommendation", domains = []) {
  return {
    id: "",
    agentId,
    category,
    sourceType,
    neighborhood,
    query: text,
    domains,
  };
}

function queriesForAgent(agentId, neighborhood, context) {
  // Natural-language queries: keyless MCP engines ignore site: operators and lose relevance,
  // so the domain lists are passed only as a soft ranking preference (see filterResultsForQuery),
  // never baked into the query string. Always anchor on the full neighbourhood + "Toronto".
  const area = `${neighborhood} Toronto`;
  const promptContext = context.context ? ` ${context.context}` : "";
  const budget = context.budget.toLocaleString();
  const destination = context.destination || "Union Station";
  const reddit = ["reddit.com/r/askTO", "reddit.com/r/TorontoRenting", "reddit.com/r/toronto"];

  if (agentId === "affordability") {
    return [
      query("listings", "market_listing", neighborhood, `${area} 1 bedroom apartment for rent under $${budget}${promptContext}`, "affordability", ["rentals.ca", "realtor.ca", "condos.ca", "zumper.com", "apartments.com"]),
      query("market", "market_context", neighborhood, `${area} average rent price one bedroom 2025 rental market report`, "affordability", ["rentals.ca", "zolo.ca", "housesigma.com", "wowa.ca"]),
    ];
  }

  if (agentId === "commute") {
    return [
      query("official", "official_context", neighborhood, `${area} commute to ${destination} how long transit TTC minutes`, "commute", ["ttc.ca", "toronto.ca", "metrolinx.com", "gotransit.com"]),
      query("community", "resident_discussion", neighborhood, `${area} commute to ${destination} reddit how long does it take`, "commute", reddit),
    ];
  }

  if (agentId === "safety") {
    return [
      query("official", "official_context", neighborhood, `${area} neighbourhood crime rate is it safe to live`, "safety", ["toronto.ca", "torontopolice.on.ca", "data.torontopolice.on.ca"]),
      query("community", "resident_discussion", neighborhood, `${area} is it a safe area reddit safety`, "safety", reddit),
    ];
  }

  if (agentId === "lifestyle") {
    return [
      query("reviews", "local_reviews", neighborhood, `${area} best cafes restaurants parks walkability${promptContext}`, "lifestyle", ["blogto.com", "yelp.ca", "tripadvisor.ca", "torontolife.com"]),
      query("community", "resident_discussion", neighborhood, `${area} what is it like to live reddit cafes parks vibe`, "lifestyle", reddit),
    ];
  }

  if (agentId === "growth") {
    return [
      query("market", "market_context", neighborhood, `${area} new condo development construction property value trend`, "growth", ["urbantoronto.ca", "storeys.com", "renx.ca"]),
      query("official", "official_context", neighborhood, `${area} building permits development planning growth`, "growth", ["toronto.ca", "open.toronto.ca"]),
    ];
  }

  return [
    query("community", "resident_discussion", neighborhood, `${area} pros and cons of living there rent commute safety`, "recommendation", reddit),
    query("market", "market_context", neighborhood, `${area} neighbourhood guide what to know before renting`, "recommendation", ["torontolife.com", "blogto.com", "liv.rent"]),
  ];
}

function filterResultsForQuery(results, query) {
  // Every query is about a Toronto neighbourhood, so gate on relevance first: keyless
  // engines happily return "East - Wikipedia" / "EAST | Merriam-Webster" for "East York".
  // Dropping irrelevant hits entirely is better than feeding junk to the model — the
  // evidence policy already shows an honest "needs source" when a category has nothing.
  const relevant = results.filter((item) => mentionsTorontoArea(item, query.neighborhood));
  if (!relevant.length) return [];

  const allowed = Array.isArray(query.domains) ? query.domains : [];
  if (!allowed.length) return relevant;
  // The allowlist is a quality *preference*, not a hard gate (keyless engines ignore site:
  // operators). Surface preferred domains first, then backfill with the rest.
  const preferred = relevant.filter((item) => urlMatchesAllowedDomain(item.url, allowed));
  if (!preferred.length) return relevant;
  const rest = relevant.filter((item) => !urlMatchesAllowedDomain(item.url, allowed));
  return [...preferred, ...rest];
}

function mentionsTorontoArea(item, neighborhood) {
  const hay = `${item.title || ""} ${item.snippet || ""} ${item.url || ""}`.toLowerCase();
  // Must be anchored to Toronto, or mention the *full* neighbourhood phrase. A single
  // short token like "east" (from "East York") is too loose and lets "East - Wikipedia"
  // and "Eastlink" through, which is exactly the junk we are trying to drop.
  if (hay.includes("toronto") || hay.includes("ontario") || hay.includes(" gta")) return true;
  const phrase = String(neighborhood || "").toLowerCase().trim();
  return phrase.length > 4 && hay.includes(phrase);
}

function urlMatchesAllowedDomain(url, allowed) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname.toLowerCase();

  return allowed.some((entry) => {
    const normalized = String(entry || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "");
    if (!normalized) return false;
    const [allowedHost, ...allowedPathParts] = normalized.split("/");
    const allowedPath = allowedPathParts.length ? `/${allowedPathParts.join("/")}` : "";
    const hostMatches = hostname === allowedHost || hostname.endsWith(`.${allowedHost}`);
    if (!hostMatches) return false;
    return !allowedPath || path.startsWith(allowedPath);
  });
}

async function searchWeb(queryText, provider, env, options) {
  try {
    if (provider === "mcp_open_websearch") return await searchMcpOpenWebSearch(queryText, env, options);
    if (provider === "brave") return await searchBrave(queryText, env, options);
    if (provider === "serpapi") return await searchSerpApi(queryText, env, options);
    if (provider === "tavily") return await searchTavily(queryText, env, options);
    if (provider === "google_cse") return await searchGoogleCse(queryText, env, options);
    return { results: [], error: "Search provider is disabled" };
  } catch (error) {
    return {
      results: [],
      error: error instanceof Error ? error.message : "Unknown search error",
    };
  }
}

async function searchMcpOpenWebSearch(queryText, env, options) {
  const result = await callMcpWebSearchTool(queryText, env, options);
  return {
    results: result.results.map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet || `${item.engine || "MCP"} result`,
    })),
  };
}

async function callMcpWebSearchTool(queryText, env, options) {
  const configuredTimeoutMs = positiveInt(env.MCP_WEB_SEARCH_TIMEOUT_MS, 14000);
  const timeoutMs = Math.min(configuredTimeoutMs, positiveInt(options.timeoutMs, configuredTimeoutMs));
  const command = env.MCP_WEB_SEARCH_COMMAND || process.execPath;
  const args = mcpWebSearchArgs(env);
  const toolPreference = env.MCP_WEB_SEARCH_TOOL || "web_search";
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let nextId = 1;
  let outputBuffer = "";
  let stderr = "";
  const pending = new Map();
  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
    for (const { reject } of pending.values()) reject(new Error("MCP web search timed out"));
    pending.clear();
  }, timeoutMs);

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.stdout.on("data", (chunk) => {
    outputBuffer += chunk.toString("utf8");
    let newlineIndex = outputBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = outputBuffer.slice(0, newlineIndex).trim();
      outputBuffer = outputBuffer.slice(newlineIndex + 1);
      if (line) handleMcpLine(line, pending);
      newlineIndex = outputBuffer.indexOf("\n");
    }
  });
  child.on("error", (error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  });

  const request = (method, params = {}) =>
    new Promise((resolveRequest, rejectRequest) => {
      const id = nextId++;
      pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });

  try {
    await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "6ixpulse", version: "0.1.0" },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const toolsResponse = await request("tools/list");
    const tools = Array.isArray(toolsResponse?.tools) ? toolsResponse.tools : [];
    const toolName =
      tools.find((tool) => tool.name === toolPreference)?.name ||
      tools.find((tool) => /search/i.test(tool.name))?.name ||
      toolPreference;
    const callResponse = await request("tools/call", {
      name: toolName,
      arguments: {
        query: queryText,
        count: positiveInt(options.count, 6),
      },
    });
    return parseMcpSearchResult(callResponse);
  } finally {
    clearTimeout(timeout);
    child.stdin.end();
    child.kill("SIGTERM");
    if (stderr && env.MCP_WEB_SEARCH_DEBUG === "1") {
      console.error(stderr.slice(0, 1000));
    }
  }
}

function handleMcpLine(line, pending) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (!message.id || !pending.has(message.id)) return;
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) {
    request.reject(new Error(message.error.message || "MCP error"));
  } else {
    request.resolve(message.result);
  }
}

function parseMcpSearchResult(callResponse) {
  if (Array.isArray(callResponse?.structuredContent?.results)) {
    return { results: normalizeMcpResults(callResponse.structuredContent.results) };
  }

  const text = Array.isArray(callResponse?.content)
    ? callResponse.content.map((item) => item?.text).filter(Boolean).join("\n")
    : "";
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed.results)) return { results: normalizeMcpResults(parsed.results) };
    } catch {
      return { results: [] };
    }
  }

  return { results: [] };
}

function normalizeMcpResults(results) {
  return results
    .map((item) => ({
      title: cleanText(item.title),
      url: normalizeUrl(item.url),
      snippet: cleanText(item.snippet),
      engine: cleanText(item.engine),
    }))
    .filter((item) => item.title && item.url);
}

async function searchBrave(queryText, env, options) {
  const url = new URL(env.BRAVE_SEARCH_URL || DEFAULT_SEARCH_URLS.brave);
  url.searchParams.set("q", queryText);
  url.searchParams.set("count", String(options.count));
  url.searchParams.set("country", env.SEARCH_COUNTRY || "CA");
  url.searchParams.set("search_lang", env.SEARCH_LANGUAGE || "en");
  url.searchParams.set("safesearch", "moderate");

  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY,
    },
    timeoutMs: positiveInt(env.RESEARCH_TIMEOUT_MS, 12000),
  });
  const data = await response.json();
  return {
    results: (data.web?.results || []).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.description,
    })),
  };
}

async function searchSerpApi(queryText, env, options) {
  const url = new URL(env.SERPAPI_URL || DEFAULT_SEARCH_URLS.serpapi);
  url.searchParams.set("engine", env.SERPAPI_ENGINE || "google");
  url.searchParams.set("q", queryText);
  url.searchParams.set("api_key", env.SERPAPI_API_KEY);
  url.searchParams.set("num", String(options.count));
  url.searchParams.set("gl", env.SEARCH_COUNTRY?.toLowerCase() || "ca");
  url.searchParams.set("hl", env.SEARCH_LANGUAGE || "en");

  const response = await fetchWithTimeout(url, {
    timeoutMs: positiveInt(env.RESEARCH_TIMEOUT_MS, 12000),
  });
  const data = await response.json();
  return {
    results: (data.organic_results || []).map((item) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
    })),
  };
}

async function searchTavily(queryText, env, options) {
  const response = await fetchWithTimeout(env.TAVILY_URL || DEFAULT_SEARCH_URLS.tavily, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: env.TAVILY_API_KEY,
      query: queryText,
      search_depth: researchDepth(env) === "deep" ? "advanced" : "basic",
      max_results: options.count,
      include_answer: false,
      include_raw_content: false,
    }),
    timeoutMs: positiveInt(env.RESEARCH_TIMEOUT_MS, 12000),
  });
  const data = await response.json();
  return {
    results: (data.results || []).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.content,
    })),
  };
}

async function searchGoogleCse(queryText, env, options) {
  const url = new URL(env.GOOGLE_CSE_URL || DEFAULT_SEARCH_URLS.google_cse);
  url.searchParams.set("key", googleSearchApiKey(env));
  url.searchParams.set("cx", googleSearchEngineId(env));
  url.searchParams.set("q", queryText);
  url.searchParams.set("num", String(Math.min(options.count, 10)));
  url.searchParams.set("gl", env.SEARCH_COUNTRY?.toLowerCase() || "ca");
  url.searchParams.set("hl", env.SEARCH_LANGUAGE || "en");
  url.searchParams.set("lr", env.SEARCH_LANGUAGE_RESTRICT || "lang_en");
  url.searchParams.set("safe", env.SEARCH_SAFE || "active");
  url.searchParams.set("filter", env.SEARCH_DUPLICATE_FILTER || "1");

  const response = await fetchWithTimeout(url, {
    timeoutMs: positiveInt(env.RESEARCH_TIMEOUT_MS, 12000),
  });
  const data = await response.json();
  return {
    results: (data.items || []).map((item) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
    })),
  };
}

function normalizeSearchProvider(value) {
  const provider = String(value || "auto")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
  if (
    [
      "mcp",
      "open_websearch",
      "open_web_search",
      "mcp_websearch",
      "mcp_web_search",
      "mcp_open_websearch",
      "mcp_open_web_search",
    ].includes(provider)
  ) {
    return "mcp_open_websearch";
  }
  if (["google", "google_cse", "google_custom_search", "custom_search"].includes(provider)) {
    return "google_cse";
  }
  if (["serp", "serp_api"].includes(provider)) return "serpapi";
  return provider;
}

function mcpOpenWebSearchEnabled(env) {
  return env.MCP_WEB_SEARCH_ENABLED !== "0";
}

function mcpWebSearchArgs(env) {
  if (env.MCP_WEB_SEARCH_ARGS) {
    const raw = env.MCP_WEB_SEARCH_ARGS.trim();
    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        return raw.split(/\s+/).filter(Boolean);
      }
    }
    return raw.split(/\s+/).filter(Boolean);
  }
  return [resolve(process.cwd(), "server/open-websearch-mcp.mjs")];
}

function prioritizedResearchAgents(parsed) {
  const weights = {
    affordability: parsed.weights.affordability,
    commute: Math.max(parsed.weights.commute, parsed.weights.transit),
    safety: parsed.weights.safety,
    lifestyle: Math.max(parsed.weights.lifestyle, parsed.weights.amenities),
    growth: parsed.weights.growth,
    recommendation: 0.8,
  };

  return Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .map(([agent]) => agent);
}

function inferDestination(prompt) {
  const source = String(prompt || "");
  if (/union\s+station|near\s+union|\bunion\b/i.test(source)) return "Union Station";
  const workNear = source.match(/work(?:ing)?\s+(?:near|at|in)\s+([A-Za-z0-9 &.'-]{3,42})/i);
  if (workNear) return cleanText(workNear[1]);
  const commuteTo = source.match(/commut\w*\s+(?:to|near)\s+([A-Za-z0-9 &.'-]{3,42})/i);
  if (commuteTo) return cleanText(commuteTo[1]);
  return "Union Station";
}

function contextualPromptTerms(prompt) {
  const source = String(prompt || "").toLowerCase();
  const terms = [];
  if (/studio|bachelor/.test(source)) terms.push("studio bachelor");
  if (/1\s*bed|one bed|one-bedroom|1-bedroom/.test(source)) terms.push("1 bedroom");
  if (/2\s*bed|two bed|two-bedroom|2-bedroom/.test(source)) terms.push("2 bedroom");
  if (/condo/.test(source)) terms.push("condo");
  if (/apartment|rental|rent/.test(source)) terms.push("apartment rental");
  if (/caf|coffee/.test(source)) terms.push("cafes coffee");
  if (/park|trail|green/.test(source)) terms.push("parks green space");
  if (/quiet|family/.test(source)) terms.push("quiet residential");
  if (/night|bar|restaurant|food/.test(source)) terms.push("restaurants nightlife");
  if (/safe|safety|crime/.test(source)) terms.push("safety crime");
  return [...new Set(terms)].join(" ");
}

function googleSearchConfigured(env) {
  return Boolean(googleSearchApiKey(env) && googleSearchEngineId(env));
}

function googleSearchApiKey(env) {
  return env.GOOGLE_SEARCH_API_KEY || env.GOOGLE_CSE_API_KEY || env.GOOGLE_API_KEY || "";
}

function googleSearchEngineId(env) {
  return (
    env.GOOGLE_SEARCH_CX ||
    env.GOOGLE_SEARCH_ENGINE_ID ||
    env.GOOGLE_CSE_ID ||
    env.GOOGLE_PROGRAMMABLE_SEARCH_ENGINE_ID ||
    ""
  );
}

async function fetchWithTimeout(input, options = {}) {
  const timeoutMs = options.timeoutMs || 12000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, {
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 220) || response.statusText}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function disabledResearch(reason, env) {
  return {
    enabled: false,
    provider: configuredSearchProvider(env),
    generatedAt: new Date().toISOString(),
    targetNeighborhoods: [],
    queries: [],
    sources: [],
    facts: [],
    limitations: [reason],
  };
}

function researchLimitations(provider) {
  if (provider === "mcp_open_websearch") {
    return [
      "Open-WebSearch MCP is optional; results can be blocked, rate-limited, incomplete, or stale.",
      "Search snippets are source discovery only. User-facing rent, commute, safety, review, and market claims still require computed facts.",
      "Use official feeds and licensed listing sources for production-grade housing decisions.",
    ];
  }

  return [
    `Search results come from ${provider}; snippets can be incomplete or stale.`,
    "Listing pages, Google reviews, and social posts should be verified directly before making housing decisions.",
    "Use official APIs or licensed feeds for listing, review, and social-source research.",
  ];
}

function missingSearchProviderMessage(env) {
  const status = searchProviderStatus(env);
  if (status.requested === "google_cse" && status.google.missing.length) {
    return `Google Custom Search is selected but missing ${status.google.missing.join(
      " and ",
    )}. Add those values for listings, Reddit, review, and market-source research.`;
  }

  return "No web search provider is configured. Keep SEARCH_PROVIDER=disabled for official-data-only runs, or add GOOGLE_SEARCH_API_KEY + GOOGLE_SEARCH_CX, SERPAPI_API_KEY, BRAVE_SEARCH_API_KEY, or TAVILY_API_KEY.";
}

function reliabilityFor(sourceType) {
  if (sourceType === "official_context") return "high";
  if (sourceType === "market_listing" || sourceType === "market_context") return "medium";
  if (sourceType === "local_reviews") return "medium";
  return "anecdotal";
}

function researchDepth(env) {
  return (env.RESEARCH_DEPTH || "deep").toLowerCase() === "standard" ? "standard" : "deep";
}

function neighborhoodCount(env) {
  return Math.max(1, Math.min(4, positiveInt(env.RESEARCH_NEIGHBORHOODS, researchDepth(env) === "deep" ? 3 : 2)));
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function interleaveByNeighborhood(queries) {
  return queries;
}

function interleaveByCategory(queries) {
  const grouped = new Map();
  for (const item of queries) {
    const key = item.agentId || item.category;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  const output = [];
  while ([...grouped.values()].some((items) => items.length)) {
    for (const items of grouped.values()) {
      const item = items.shift();
      if (item) output.push(item);
    }
  }
  return output;
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

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}
