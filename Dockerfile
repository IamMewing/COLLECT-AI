# CollectAI — single-service deploy image.
# Combines Node (Express server + built React client) and Python (Strands
# agent, invoked as a subprocess by agentService.js) in one container, since
# most free/simple hosts run one process per service, not two.

FROM node:20-slim

# ── Python runtime ────────────────────────────────────────────────────────
# Debian's node:20-slim has no Python by default. python3-pip's system
# install is "externally managed" (PEP 668), hence --break-system-packages.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Python deps (agent/) ───────────────────────────────────────────────────
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# ── Copy the whole repo, preserving the exact relative layout the code
# already relies on locally (agent/, server/, client/ as siblings) ─────────
COPY . .

# ── Server deps ─────────────────────────────────────────────────────────────
WORKDIR /app/server
RUN npm install --omit=dev

# ── Build the client (Vite) — server.js serves this static build ──────────
WORKDIR /app/client
RUN npm install && npm run build

# ── Runtime ──────────────────────────────────────────────────────────────
WORKDIR /app/server
# agentService.js defaults PYTHON_CMD to 'python', which doesn't exist on
# Debian — only 'python3' does. Point it at the right binary explicitly.
ENV PYTHON_PATH=python3
# Most hosts (Render, Railway) inject PORT automatically; server.js already
# reads process.env.PORT, so nothing else to configure here.

CMD ["node", "server.js"]
