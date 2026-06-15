FROM node:22-bookworm-slim

ENV PYTHONUNBUFFERED=1
ENV PORT=7860
ENV AGENT_PORT=8787
ENV AGENT_MODEL_PROVIDER=nvidia
ENV NVIDIA_MODEL=nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16
ENV SEARCH_PROVIDER=mcp_open_websearch
ENV MCP_WEB_SEARCH_ENABLED=1
ENV RESEARCH_ENABLED=1
ENV OFFICIAL_DATA_ENABLED=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json requirements.txt ./

RUN npm ci

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN npm run build

EXPOSE 7860

CMD ["python", "app.py"]
