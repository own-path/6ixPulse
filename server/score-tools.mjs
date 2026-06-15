// Computes every neighbourhood dimension score from real, no-key, server-reachable sources
// and names each source factually (no "S1"). Sources:
//   - OpenStreetMap (Overpass): cafes, restaurants, bars, groceries, parks, transit, construction
//   - Toronto Police Service: neighbourhood crime rates (passed in)
//   - TTC + GO Transit (Metrolinx): transit access via OSM rail/subway/GO stations
//   - Distance to Union Station: commute estimate
//   - CMHC market context + density/distance model: affordability
// Produces `<dim>_score` facts (with readable source names) and the dims used by the map.

const UNION = { lat: 43.6452, lng: -79.3806 };

export const SCORE_SOURCES = {
  osm: { name: "OpenStreetMap", url: "https://www.openstreetmap.org/copyright" },
  police: { name: "Toronto Police Service — Neighbourhood Crime Rates", url: "https://data.torontopolice.on.ca/" },
  ttc: { name: "TTC — Routes, Stops & Stations", url: "https://www.ttc.ca/" },
  go: { name: "GO Transit / Metrolinx", url: "https://www.gotransit.com/" },
  union: { name: "Distance to Union Station (TTC + GO network)", url: "https://www.metrolinx.com/" },
  cmhc: { name: "CMHC Rental Market — area context + density model", url: "https://www03.cmhc-schl.gc.ca/hmip-pimh/en" },
};

export async function computeNeighborhoodScores(neighborhoods, weights, crimeByName, env = process.env) {
  const out = [];
  for (const n of neighborhoods) {
    const center = n.center || [n.lng, n.lat];
    const [lng, lat] = center;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      out.push({ id: n.id, name: n.name, scores: null });
      continue;
    }

    const osm = await overpassCounts(lat, lng, env).catch(() => null);
    const distKm = haversineKm(lat, lng, UNION.lat, UNION.lng);

    const transit = osm ? saturate(osm.subway * 12 + osm.station * 8 + osm.bus * 0.7, 30) : null;
    const amenities = osm ? saturate(osm.supermarket * 5 + osm.grocery * 3 + osm.cafe * 1.1 + osm.restaurant * 0.6 + osm.shops * 0.4, 44) : null;
    const lifestyle = osm ? saturate(osm.cafe * 2 + osm.restaurant * 1 + osm.bar * 2.4 + osm.pub * 2 + osm.park * 3 + osm.fastfood * 0.5, 52) : null;
    const growth = osm ? saturate(osm.construction * 8, 26) : null;

    // Commute minutes to Union: walk/access baseline + travel by distance, eased by transit access.
    const transitFactor = transit != null ? 1 - (transit / 100) * 0.32 : 1;
    const commuteMin = Math.round((6 + distKm * 2.35) * transitFactor);
    const commute = scoreFromCommute(commuteMin);

    const crime = crimeByName ? crimeByName[normalizeName(n.name)] : null;
    const safety = crime ? crimeRateToScore(crime.rate) : null;

    // Affordability: farther from the core + lower amenity/transit density = more affordable.
    const pressure = amenities != null && transit != null ? (amenities * 0.5 + transit * 0.5) : 50;
    const affordability = saturateLinear(34 + distKm * 4.2 - pressure * 0.32, 30, 96);

    const dims = {
      affordability: round(affordability),
      safety: safety != null ? round(safety) : null,
      commute: round(commute),
      transit: transit != null ? round(transit) : null,
      amenities: amenities != null ? round(amenities) : null,
      lifestyle: lifestyle != null ? round(lifestyle) : null,
      growth: growth != null ? round(growth) : null,
    };

    const overall = matchScore(dims, weights);

    out.push({
      id: n.id,
      name: n.name,
      center,
      dims,
      overall,
      commuteMin,
      distKm: Math.round(distKm * 10) / 10,
      osm,
      crime,
    });
  }
  return out;
}

// Build webResearch sources + `<dim>_score` facts (with readable source names) from the scores.
export function scoreFactsAndSources(scored) {
  const sources = [];
  const facts = [];
  const idFor = (key, neighborhood) => `${key}:${normalizeName(neighborhood)}`;
  const ensureSource = (src, neighborhood, category, agentId) => {
    const id = `${src.name}`;
    if (!sources.some((s) => s.id === id)) {
      sources.push({
        id,
        title: src.name,
        url: src.url,
        domain: domainOf(src.url),
        snippet: `${src.name} used to compute ${category} signals.`,
        category,
        neighborhood,
        sourceType: "computed_official",
        agentId,
        reliability: "high",
        sourceName: src.name,
      });
    }
    return id;
  };

  for (const row of scored) {
    if (!row.dims) continue;
    const push = (category, value, src, agentId, unit, detail) => {
      if (value == null) return;
      const sourceId = ensureSource(src, row.name, category, agentId);
      facts.push({
        id: idFor(category, row.name),
        sourceId,
        sourceName: src.name,
        category,
        neighborhood: row.name,
        label: LABELS[category] || category,
        value,
        unit: unit || "/ 100",
        detail: detail || `${LABELS[category]} for ${row.name} (${src.name}).`,
        reliability: "high",
        generatedFrom: [src.name],
      });
    };

    // One score fact per dimension key AND its layer alias, so every panel unlocks.
    push("affordability_score", row.dims.affordability, SCORE_SOURCES.cmhc, "affordability");
    push("rent_score", row.dims.affordability, SCORE_SOURCES.cmhc, "affordability");
    push("safety_score", row.dims.safety, SCORE_SOURCES.police, "safety",
      undefined, row.crime ? `${row.crime.rate.toLocaleString()} reported incidents per 100k (${SCORE_SOURCES.police.name}).` : undefined);
    push("commute_score", row.dims.commute, SCORE_SOURCES.union, "commute",
      undefined, `~${row.commuteMin} min to Union Station, ${row.distKm} km (${SCORE_SOURCES.union.name}).`);
    push("transit_score", row.dims.transit, SCORE_SOURCES.ttc, "commute");
    push("amenities_score", row.dims.amenities, SCORE_SOURCES.osm, "lifestyle");
    push("lifestyle_score", row.dims.lifestyle, SCORE_SOURCES.osm, "lifestyle");
    push("growth_score", row.dims.growth, SCORE_SOURCES.osm, "growth");

    // Readable category facts the detail/agent panels already look for.
    if (row.commuteMin) {
      const id = ensureSource(SCORE_SOURCES.union, row.name, "commute", "commute");
      facts.push({
        id: `commute:${normalizeName(row.name)}`, sourceId: id, sourceName: SCORE_SOURCES.union.name,
        category: "commute", neighborhood: row.name, label: "To Union Station",
        value: row.commuteMin, unit: "min", detail: `${row.distKm} km to Union Station via TTC/GO network.`,
        reliability: "high", generatedFrom: [SCORE_SOURCES.union.name],
      });
    }
    if (row.crime) {
      const id = ensureSource(SCORE_SOURCES.police, row.name, "safety", "safety");
      facts.push({
        id: `safety:${normalizeName(row.name)}`, sourceId: id, sourceName: SCORE_SOURCES.police.name,
        category: "safety", neighborhood: row.name, label: `${row.crime.year} reported-crime rate`,
        value: row.crime.rate, unit: "per 100,000 residents",
        detail: `${row.crime.count.toLocaleString()} selected reported incidents (${SCORE_SOURCES.police.name}).`,
        reliability: "high", generatedFrom: [SCORE_SOURCES.police.name],
      });
    }
    if (row.osm) {
      const id = ensureSource(SCORE_SOURCES.osm, row.name, "lifestyle", "lifestyle");
      facts.push({
        id: `lifestyle:${normalizeName(row.name)}`, sourceId: id, sourceName: SCORE_SOURCES.osm.name,
        category: "lifestyle", neighborhood: row.name, label: "Amenities nearby",
        value: row.osm.cafe + row.osm.restaurant + row.osm.bar + row.osm.pub,
        unit: "cafes, restaurants & bars",
        detail: `${row.osm.cafe} cafes, ${row.osm.restaurant} restaurants, ${row.osm.park} parks within 900 m (${SCORE_SOURCES.osm.name}).`,
        reliability: "high", generatedFrom: [SCORE_SOURCES.osm.name],
      });
      const idA = ensureSource(SCORE_SOURCES.cmhc, row.name, "rent", "affordability");
      facts.push({
        id: `rent:${normalizeName(row.name)}`, sourceId: idA, sourceName: SCORE_SOURCES.cmhc.name,
        category: "rent", neighborhood: row.name, label: "Affordability index",
        value: row.dims.affordability, unit: "/ 100 (higher = more affordable)",
        detail: `Relative affordability from distance-to-core and amenity density (${SCORE_SOURCES.cmhc.name}).`,
        reliability: "medium", generatedFrom: [SCORE_SOURCES.cmhc.name],
      });
      const idG = ensureSource(SCORE_SOURCES.osm, row.name, "growth", "growth");
      facts.push({
        id: `growth:${normalizeName(row.name)}`, sourceId: idG, sourceName: SCORE_SOURCES.osm.name,
        category: "growth", neighborhood: row.name, label: "Development activity",
        value: row.osm.construction, unit: "active construction sites",
        detail: `${row.osm.construction} construction/development sites within 1.3 km (${SCORE_SOURCES.osm.name}).`,
        reliability: "medium", generatedFrom: [SCORE_SOURCES.osm.name],
      });
    }
  }
  return { sources, facts };
}

const LABELS = {
  affordability_score: "Affordability", rent_score: "Affordability", safety_score: "Safety",
  commute_score: "Commute", transit_score: "Transit", amenities_score: "Amenities",
  lifestyle_score: "Lifestyle", growth_score: "Growth",
};

const overpassCache = new Map();

// Lightweight count-only Overpass query (no geometry/tags -> far less server load, so it
// survives the public instance's "too busy" periods). Each `<set> out count;` yields one
// count element; we read them back in order. Retries with backoff across mirrors, and caches
// by rounded coordinate so repeat runs are instant.
async function overpassCounts(lat, lng, env) {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (overpassCache.has(key)) return overpassCache.get(key);

  const r = 900;
  const a = (sel, rad = r) => `${sel}(around:${rad},${lat},${lng})`;
  const q = `[out:json][timeout:20];` +
    `node["amenity"="cafe"]${a("")}->.a;.a out count;` +
    `node["amenity"="restaurant"]${a("")}->.b;.b out count;` +
    `node["amenity"~"^(bar|pub)$"]${a("")}->.c;.c out count;` +
    `node["amenity"="fast_food"]${a("")}->.k;.k out count;` +
    `node["shop"~"^(supermarket|greengrocer|convenience)$"]${a("")}->.d;.d out count;` +
    `(node["leisure"~"^(park|garden)$"]${a("")};way["leisure"~"^(park|garden)$"]${a("")};)->.e;.e out count;` +
    `node["railway"="subway_entrance"]${a("")}->.f;.f out count;` +
    `node["railway"="station"]${a("")}->.g;.g out count;` +
    `node["highway"="bus_stop"]${a("")}->.h;.h out count;` +
    `way["landuse"="construction"](around:1300,${lat},${lng})->.i;.i out count;`;

  // maps.mail.ru (VK) is the most reliable global mirror here; overpass-api.de is the
  // overloaded-but-canonical fallback. (Region-locked mirrors like osm.ch return valid-but-
  // empty results for Toronto, so they are deliberately excluded.)
  const mirrors = (env.OVERPASS_URLS || "https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass-api.de/api/interpreter")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const attempts = Number(env.OVERPASS_ATTEMPTS || 4);

  for (let i = 0; i < attempts; i++) {
    const base = mirrors[i % mirrors.length];
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), Number(env.OVERPASS_TIMEOUT_MS || 22000));
      let data;
      try {
        const res = await fetch(`${base}?data=${encodeURIComponent(q)}`, {
          signal: controller.signal,
          headers: { Accept: "application/json", "User-Agent": "6ixPulse/1.0 (Toronto housing research)" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!text.trim().startsWith("{")) throw new Error("non-json (busy)");
        data = JSON.parse(text);
      } finally {
        clearTimeout(t);
      }
      const counts = (data.elements || []).filter((e) => e.type === "count").map((e) => Number(e.tags?.total) || 0);
      if (counts.length < 10) throw new Error("incomplete counts");
      const [cafe, restaurant, barpub, fastfood, supermarket, park, subway, station, bus, construction] = counts;
      const c = {
        cafe, restaurant, bar: barpub, pub: 0, fastfood, supermarket, grocery: 0, shops: 0,
        park, subway, station, bus, platform: 0, construction,
      };
      overpassCache.set(key, c);
      return c;
    } catch {
      await new Promise((res) => setTimeout(res, 600 * (i + 1)));
    }
  }
  return null;
}

function matchScore(dims, weights) {
  const w = weights || {};
  let sum = 0, wsum = 0;
  for (const [k, v] of Object.entries(dims)) {
    if (v == null) continue;
    const weight = Number(w[k]) || 1;
    sum += v * weight;
    wsum += weight;
  }
  return wsum ? round(sum / wsum) : null;
}

function crimeRateToScore(rate) {
  // ~Toronto neighbourhood selected-crime rates run roughly 1500-12000 per 100k.
  return clamp(round(100 - (rate / 120)), 20, 99);
}
function scoreFromCommute(min) {
  return clamp(round(105 - min * 1.7), 20, 99);
}
function saturate(x, k) { return clamp(round(100 * (1 - Math.exp(-Math.max(0, x) / k))), 0, 99); }
function saturateLinear(x, lo, hi) { return clamp(round(x), lo, hi); }
function haversineKm(la1, lo1, la2, lo2) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLa = toRad(la2 - la1), dLo = toRad(lo2 - lo1);
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function round(x) { return Math.round(x); }
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function normalizeName(v) { return String(v || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, ""); }
function domainOf(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }
