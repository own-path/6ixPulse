from __future__ import annotations

import atexit
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from fastapi import Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from gradio import Server


ROOT = Path(__file__).resolve().parent
DIST_DIR = ROOT / "dist"
NODE_BACKEND_PORT = int(os.environ.get("AGENT_PORT", "8787"))
NODE_BACKEND_URL = f"http://127.0.0.1:{NODE_BACKEND_PORT}"
DEFAULT_MAPBOX_STYLE = "mapbox://styles/ownpath/cmqe4wg8h005001s4bjx9461m"

node_process: subprocess.Popen[str] | None = None

app = Server(
    title="6ixPulse",
    summary="Agentic Toronto housing intelligence map",
    description="Custom React frontend with Gradio Server APIs for the agentic housing research flow.",
)


def start_node_backend() -> None:
    global node_process
    if backend_is_ready():
        return

    env = os.environ.copy()
    env.setdefault("AGENT_PORT", str(NODE_BACKEND_PORT))
    # auto = Nemotron (NVIDIA, when NVIDIA_API_KEY is set) -> llama.cpp -> Ollama -> HF,
    # so the agent always lands on a working brain instead of silently falling back.
    env.setdefault("AGENT_MODEL_PROVIDER", "auto")
    # Hosted NIM id. The HF repo "...-BF16" has no inference provider and cannot be called.
    env.setdefault("NVIDIA_MODEL", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning")
    env.setdefault("SEARCH_PROVIDER", "disabled")
    env.setdefault("MCP_WEB_SEARCH_ENABLED", "0")
    env.setdefault("MCP_WEB_SEARCH_TIMEOUT_MS", "6000")
    env.setdefault("RESEARCH_ENABLED", "1")
    env.setdefault("RESEARCH_DEPTH", "standard")
    env.setdefault("RESEARCH_MAX_QUERIES", "6")
    env.setdefault("RESEARCH_RESULTS_PER_QUERY", "3")
    env.setdefault("RESEARCH_MAX_SOURCES", "24")
    env.setdefault("RESEARCH_TOTAL_TIMEOUT_MS", "45000")
    env.setdefault("OFFICIAL_DATA_ENABLED", "1")

    node_process = subprocess.Popen(
        ["node", "server/index.mjs"],
        cwd=ROOT,
        env=env,
        text=True,
    )
    atexit.register(stop_node_backend)

    deadline = time.time() + 30
    while time.time() < deadline:
        if backend_is_ready():
            return
        if node_process.poll() is not None:
            raise RuntimeError(f"Node backend exited with code {node_process.returncode}")
        time.sleep(0.4)

    raise RuntimeError("Node backend did not become ready in time")


def stop_node_backend() -> None:
    if node_process and node_process.poll() is None:
        node_process.terminate()
        try:
            node_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            node_process.kill()


def backend_is_ready() -> bool:
    try:
        with urllib.request.urlopen(f"{NODE_BACKEND_URL}/api/agent/health", timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def request_node(method: str, path: str, body: bytes | None = None) -> tuple[int, bytes, str]:
    request = urllib.request.Request(
        f"{NODE_BACKEND_URL}{path}",
        data=body,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=75) as response:
            return response.status, response.read(), response.headers.get("Content-Type", "application/json")
    except urllib.error.HTTPError as error:
        return error.code, error.read(), error.headers.get("Content-Type", "application/json")


def node_json(method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    status, raw, _ = request_node(method, path, body)
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Backend returned non-JSON response with HTTP {status}") from error
    if status >= 400:
        message = parsed.get("error") or parsed.get("message") or f"Backend HTTP {status}"
        raise RuntimeError(message)
    return parsed


def inject_runtime_config(html: str) -> str:
    config = {
        "mapboxToken": os.environ.get("VITE_MAPBOX_TOKEN") or os.environ.get("MAPBOX_TOKEN") or "",
        "mapboxStyleUrl": os.environ.get("VITE_MAPBOX_STYLE_URL") or DEFAULT_MAPBOX_STYLE,
        "spaceRuntime": True,
    }
    script = f"<script>window.__SIXPULSE_CONFIG__ = {json.dumps(config)};</script>"
    return html.replace("</head>", f"{script}</head>")


if (DIST_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")


@app.get("/", response_class=HTMLResponse)
async def homepage() -> str:
    index_path = DIST_DIR / "index.html"
    if not index_path.exists():
        return """
        <main style="font-family: system-ui; max-width: 720px; margin: 60px auto; line-height: 1.5;">
          <h1>6ixPulse build missing</h1>
          <p>Run <code>npm run build</code> before starting the Gradio Server wrapper.</p>
        </main>
        """
    return inject_runtime_config(index_path.read_text(encoding="utf-8"))


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "6ixPulse Gradio Server",
        "nodeBackendReady": backend_is_ready(),
    }


@app.get("/api/agent/health")
async def agent_health() -> Response:
    status, raw, content_type = request_node("GET", "/api/agent/health")
    return Response(content=raw, status_code=status, media_type=content_type)


@app.get("/api/agent/search/health")
async def search_health() -> Response:
    status, raw, content_type = request_node("GET", "/api/agent/search/health")
    return Response(content=raw, status_code=status, media_type=content_type)


@app.post("/api/agent/run")
async def agent_run(request: Request) -> Response:
    status, raw, content_type = request_node("POST", "/api/agent/run", await request.body())
    return Response(content=raw, status_code=status, media_type=content_type)


@app.mcp.tool(name="run_agent")
@app.api(name="run_agent", concurrency_limit=2)
def run_agent(prompt: str) -> dict[str, Any]:
    """Run the 6ixPulse agentic housing research workflow for a renter prompt."""
    return node_json("POST", "/api/agent/run", {"prompt": prompt})


if __name__ == "__main__":
    start_node_backend()
    app.launch(
        server_name="0.0.0.0",
        server_port=int(os.environ.get("PORT", "7860")),
        show_error=True,
        mcp_server=True,
    )
