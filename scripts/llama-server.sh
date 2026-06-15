#!/usr/bin/env bash
# Run 6ixPulse's agentic brain through the llama.cpp runtime (Llama-Champion badge).
#
# Serves a small GGUF via llama.cpp's OpenAI-compatible server on :8080. Defaults to an
# OpenBMB MiniCPM build (also hackathon-allowed); override with LLAMA_MODEL.
#
#   ./scripts/llama-server.sh                 # default OpenBMB MiniCPM4 8B GGUF
#   LLAMA_MODEL=ggml-org/gemma-3-4b-it-GGUF ./scripts/llama-server.sh
#
# Then point the agent at it (in another shell):
#   LLAMACPP_ENABLED=1 AGENT_MODEL_PROVIDER=llamacpp npm run dev:api
#
# Requires llama.cpp's `llama-server` on PATH:
#   brew install llama.cpp        # macOS
#   # or build from https://github.com/ggml-org/llama.cpp
set -euo pipefail

MODEL="${LLAMA_MODEL:-openbmb/MiniCPM4-8B-GGUF}"
PORT="${LLAMA_PORT:-8080}"
CTX="${LLAMA_CTX:-8192}"

if ! command -v llama-server >/dev/null 2>&1; then
  echo "llama-server not found. Install llama.cpp first: brew install llama.cpp" >&2
  exit 1
fi

echo "Starting llama.cpp server: model=$MODEL port=$PORT ctx=$CTX"
exec llama-server -hf "$MODEL" --port "$PORT" --ctx-size "$CTX" --jinja
