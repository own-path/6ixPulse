import { useEffect, useMemo, useRef, useState } from "react";
import { TextLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { Box, LocateFixed, Sun, ZoomIn, ZoomOut } from "lucide-react";
import mapboxgl from "mapbox-gl";
import { type LayerKey } from "../data/neighborhoods";
import { type RankedNeighborhood } from "../lib/scoring";

declare global {
  interface Window {
    __SIXPULSE_CONFIG__?: {
      mapboxToken?: string;
      mapboxStyleUrl?: string;
      spaceRuntime?: boolean;
    };
  }
}

const runtimeConfig = typeof window !== "undefined" ? window.__SIXPULSE_CONFIG__ : undefined;
const mapboxToken =
  runtimeConfig?.mapboxToken || (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined);
const mapboxStyleUrl =
  runtimeConfig?.mapboxStyleUrl ||
  (import.meta.env.VITE_MAPBOX_STYLE_URL as string | undefined) ||
  "mapbox://styles/ownpath/cmqe4wg8h005001s4bjx9461m";
const hasMapboxToken = Boolean(mapboxToken?.trim());
const basemapConfig = {
  theme: "monochrome",
  lightPreset: "dawn",
  showPointOfInterestLabels: false,
  showPlaceLabels: true,
  showRoadLabels: true,
  showTransitLabels: true,
  showPedestrianRoads: false,
  showAdminBoundaries: false,
  show3dObjects: true,
  show3dBuildings: true,
  show3dTrees: false,
  show3dLandmarks: false,
  colorLand: "#e8eef6",
  colorWater: "#b9cce3",
  colorGreenspace: "#d8e4f1",
  colorRoads: "#c8d5e4",
  colorMotorways: "#9fb5ce",
  colorTrunks: "#afc1d6",
  colorBuildings: "#d6dee9",
  colorPlaceLabels: "#253852",
  colorRoadLabels: "#5f718a",
  colorTransitLabels: "#465f83",
};

// How long the camera stays on each neighbourhood (flight + settled dwell) before the
// zoom-out/zoom-in transition to the next.
const TOUR_DWELL_MS = 5400;

type SignalLayerState = Partial<Record<LayerKey, boolean>>;
type ResearchTour = {
  runId: number;
  neighborhoodIds: string[];
};

interface MapCanvasProps {
  ranked: RankedNeighborhood[];
  selectedId: string;
  researchTour: ResearchTour | null;
  tourFocusId: string | null;
  activeLayer: LayerKey;
  signalLayers: SignalLayerState;
  phase: "done" | "running";
  runStyle: "cascade" | "radar";
  bright: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onTourStep: (id: string | null) => void;
  onToggleBright: () => void;
}

export default function MapCanvas({
  ranked,
  selectedId,
  researchTour,
  tourFocusId,
  phase,
  runStyle,
  bright,
  onSelect,
  onHover,
  onTourStep,
  onToggleBright,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const lastSelectedIdRef = useRef(selectedId);
  const tourTimersRef = useRef<number[]>([]);
  const tourActiveRef = useRef(false);
  const onTourStepRef = useRef(onTourStep);
  const [pitched, setPitched] = useState(true);

  useEffect(() => {
    onTourStepRef.current = onTourStep;
  }, [onTourStep]);

  useEffect(() => {
    return () => clearTourTimers();
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!hasMapboxToken) return;

    mapboxgl.accessToken = mapboxToken!;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: mapboxStyleUrl,
      config: { basemap: basemapConfig },
      center: [-79.3832, 43.6532],
      zoom: 14.55,
      minZoom: 10.2,
      maxZoom: 17.2,
      pitch: 67,
      bearing: -24,
      antialias: true,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");
    map.touchZoomRotate.enableRotation();

    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    map.addControl(overlay);

    map.on("style.load", () => {
      Object.entries(basemapConfig).forEach(([key, value]) => {
        try {
          map.setConfigProperty("basemap", key, value);
        } catch {
          // Custom styles without the Standard import simply ignore these runtime options.
        }
      });

      map.setFog({
        color: "rgb(235, 242, 250)",
        "high-color": "rgb(202, 217, 235)",
        "horizon-blend": 0.15,
      });

      const labelLayerId = map.getStyle().layers?.find(
        (layer) => layer.type === "symbol" && layer.layout?.["text-field"],
      )?.id;

      if (map.getSource("composite") && !map.getLayer("6ixpulse-3d-buildings")) {
        map.addLayer(
          {
            id: "6ixpulse-3d-buildings",
            source: "composite",
            "source-layer": "building",
            filter: ["==", "extrude", "true"],
            type: "fill-extrusion",
            minzoom: 11,
            paint: {
              "fill-extrusion-color": [
                "interpolate",
                ["linear"],
                ["get", "height"],
                0,
                "#e4ebf4",
                80,
                "#d4deeb",
                180,
                "#c5d1e0",
              ],
              "fill-extrusion-height": [
                "interpolate",
                ["linear"],
                ["zoom"],
                11,
                0,
                13,
                ["coalesce", ["get", "height"], 16],
              ],
              "fill-extrusion-base": [
                "interpolate",
                ["linear"],
                ["zoom"],
                11,
                0,
                13,
                ["coalesce", ["get", "min_height"], 0],
              ],
              "fill-extrusion-opacity": 0.68,
              "fill-extrusion-ambient-occlusion-intensity": 0.35,
            },
          },
          labelLayerId,
        );
      }
    });

    mapRef.current = map;
    overlayRef.current = overlay;

    return () => {
      overlay.finalize();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  const rankedById = useMemo(() => new Map(ranked.map((row) => [row.id, row])), [ranked]);

  const layers = useMemo(() => {
    return [
      new TextLayer<RankedNeighborhood>({
        id: "neighborhood-labels",
        data: ranked.filter((neighborhood) => neighborhood.rank <= 4 || neighborhood.id === selectedId),
        pickable: true,
        getPosition: (neighborhood) => neighborhood.center,
        getText: (neighborhood) => neighborhood.name,
        getSize: (neighborhood) => (neighborhood.id === selectedId ? 14 : 11),
        getColor: (neighborhood) =>
          neighborhood.id === selectedId ? [255, 255, 255, 255] : [255, 255, 255, 238],
        getAngle: 0,
        getPixelOffset: [0, -30],
        fontFamily: "Space Grotesk, Inter, system-ui, sans-serif",
        background: true,
        getBackgroundColor: (neighborhood) =>
          neighborhood.id === selectedId ? [38, 56, 84, 238] : [68, 91, 124, 212],
        backgroundPadding: [9, 5],
        billboard: true,
        onClick: (info: any) => {
          if (info.object?.id) onSelect(info.object.id);
        },
        onHover: (info: any) => onHover(info.object?.id ?? null),
      }),
    ];
  }, [
    onHover,
    onSelect,
    ranked,
    selectedId,
  ]);

  useEffect(() => {
    overlayRef.current?.setProps({ layers });
  }, [layers]);

  useEffect(() => {
    const selected = rankedById.get(selectedId);
    if (!selected || !mapRef.current) return;
    if (tourActiveRef.current) return;
    if (selectedId === lastSelectedIdRef.current) {
      return;
    }
    lastSelectedIdRef.current = selectedId;

    mapRef.current.easeTo({
      center: selected.center,
      zoom: Math.max(mapRef.current.getZoom(), 13.85),
      pitch: pitched ? 67 : 0,
      bearing: pitched ? -24 : 0,
      duration: 780,
      essential: true,
    });
  }, [pitched, rankedById, selectedId]);

  useEffect(() => {
    if (!researchTour || !mapRef.current) return;

    const stops = researchTour.neighborhoodIds
      .map((id) => rankedById.get(id))
      .filter((neighborhood): neighborhood is RankedNeighborhood => Boolean(neighborhood));
    if (!stops.length) return;

    const map = mapRef.current;
    const runId = researchTour.runId;
    tourActiveRef.current = true;
    clearTourTimers();
    map.stop();
    onTourStepRef.current(null);

    // Zoom into each neighbourhood and STAY while its agents research it, then fly out-and-in
    // to the next: flyTo arcs the camera up (zoom-out) then back down (zoom-in) for a smooth
    // transition. The camera rests on the last area until the run resolves.
    const DWELL_MS = TOUR_DWELL_MS;

    stops.forEach((neighborhood, index) => {
      scheduleTour(() => {
        if (!researchTour || researchTour.runId !== runId || !mapRef.current) return;
        tourActiveRef.current = true;
        lastSelectedIdRef.current = neighborhood.id;
        onTourStepRef.current(neighborhood.id);

        mapRef.current.flyTo({
          center: neighborhood.center,
          zoom: 14.2,
          pitch: pitched ? 66 : 0,
          bearing: pitched ? -22 + (index % 2 === 0 ? 5 : -5) : 0,
          curve: 1.9, // higher arc => the camera lifts (zooms out) more between areas
          speed: 1.5, // unhurried, smooth flight so most of the dwell is spent settled in
          essential: true,
        });
      }, index * DWELL_MS);
    });

    scheduleTour(() => {
      if (!researchTour || researchTour.runId !== runId) return;
      tourActiveRef.current = false;
    }, stops.length * DWELL_MS + 160);

    return () => {
      tourActiveRef.current = false;
      clearTourTimers();
    };
  }, [pitched, rankedById, researchTour]);

  const zoom = (delta: number) => {
    if (!mapRef.current) return;
    if (delta > 0) mapRef.current.zoomIn({ duration: 320 });
    else mapRef.current.zoomOut({ duration: 320 });
  };

  const resetCamera = () => {
    mapRef.current?.easeTo({
      center: [-79.3832, 43.6532],
      zoom: 14.55,
      pitch: pitched ? 67 : 0,
      bearing: pitched ? -24 : 0,
      duration: 680,
      essential: true,
    });
  };

  const togglePitch = () => {
    const next = !pitched;
    setPitched(next);
    mapRef.current?.easeTo({
      pitch: next ? 67 : 0,
      bearing: next ? -24 : 0,
      duration: 520,
      essential: true,
    });
  };

  return (
    <section className={`map-canvas ${bright ? "is-bright" : ""}`} aria-label="Toronto housing intelligence map">
      <div ref={containerRef} className="mapbox-host" />
      {!hasMapboxToken && (
        <div className="map-token-missing">
          <strong>Mapbox token required</strong>
          <span>Add `VITE_MAPBOX_TOKEN` to `.env`, then restart `npm run dev`.</span>
        </div>
      )}
      {phase === "running" && (
        <div className={`map-scan-fx ${runStyle}`} aria-hidden="true">
          <span />
          <i />
        </div>
      )}
      <div className="map-token-note">
        Mapbox 3D + deck.gl
      </div>
      <div className="map-controls" aria-label="Map controls">
        <button type="button" onClick={onToggleBright} aria-label="Toggle brighter map">
          <Sun size={18} />
        </button>
        <button type="button" onClick={togglePitch} aria-label="Toggle 3D map">
          <Box size={18} />
        </button>
        <button type="button" onClick={() => zoom(1)} aria-label="Zoom in">
          <ZoomIn size={18} />
        </button>
        <button type="button" onClick={() => zoom(-1)} aria-label="Zoom out">
          <ZoomOut size={18} />
        </button>
        <button type="button" onClick={resetCamera} aria-label="Reset map camera">
          <LocateFixed size={18} />
        </button>
      </div>
    </section>
  );

  function scheduleTour(fn: () => void, delay: number) {
    tourTimersRef.current.push(window.setTimeout(fn, delay));
  }

  function clearTourTimers() {
    tourTimersRef.current.forEach(window.clearTimeout);
    tourTimersRef.current = [];
  }
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
