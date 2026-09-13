# AI Token Proxy

A proxy that sits between AI Agents and LLMs, exposing an OpenAI-compatible
interface, forwarding requests to an upstream OpenAI-compatible LLM, and
logging per-request token consumption with attribution metadata (Agent ID,
Job Type, etc.) so the organization can analyze which agents use how many
tokens for what purpose.

> **Status:** v1 (prototype). The proxy is implemented and logs to a CSV file.
> Requirements are captured in [`docs/requirements.md`](docs/requirements.md).

## Why

The organization runs several AI Agents that share API keys when calling LLMs.
Because the LLM provider only sees the key — not which agent or job made the
request — token consumption cannot be attributed to a specific agent or job.
The AI Token Proxy fixes this by sitting in the middle, reading attribution
headers the agent adds to each request, and recording them alongside the
token usage returned by the upstream LLM.

## Architecture (vision)

The full product has three logical parts:

1. **The Proxy** — forwards OpenAI-compatible requests and logs attribution +
   token usage. *(v1 delivers this.)*
2. **The Database** — persists the logged data. *(later)*
3. **The Web Frontend** — manages the proxy and analyzes token consumption.
   *(later)*

v1 is a prototype of part 1 only: the proxy logs to a CSV file and is
configured via a JSON file. The database and web frontend come in later
versions.

## v1 scope

- Forwards all `/v1/*` endpoints to a single OpenAI-compatible upstream.
- Transparent passthrough (method, headers, body, query string forwarded
  as-is; upstream response returned unchanged).
- Attribution fields read from configurable header names (defined in the JSON
  config).
- Auth: agent's key forwarded verbatim, with fallback to a configured upstream
  key.
- Token counts: upstream `usage` first, local tokenizer estimate as fallback.
- CSV log per request: `timestamp`, configured attribution fields,
  `prompt_tokens`, `completion_tokens`, `total_tokens`.
- `/health` endpoint.
- Hot-reload of JSON config on file change.
- Packaged as a Docker container.

Out of scope for v1: multiple LLM providers, cost calculation, agent
auth/rate-limiting, streaming, tests, the database, and the web frontend.

See [`docs/requirements.md`](docs/requirements.md) for the full specification.

## Tech stack

- Node.js + TypeScript
- Docker
- JSON config file
- CSV log output

## Getting started

### Prerequisites

- Node.js >= 22

### Configure

Copy the example config and point it at your upstream. Secrets are referenced
as `${ENV_VAR}` and resolved from the environment, so the config file itself
stays free of keys:

```bash
cp config.example.json config.json
export OPENAI_API_KEY=sk-...      # referenced by config.json via ${OPENAI_API_KEY}
```

Config fields:

| Field                 | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| `listen`              | `{ host, port }` the proxy binds to.                                     |
| `upstream`            | Base URL of the OpenAI-compatible endpoint to forward to.               |
| `upstreamApiKey`      | Fallback key used only when the agent sends no `Authorization` header. Supports `${ENV_VAR}`. |
| `attributionHeaders`  | Map of logical name -> request header name (e.g. `agent_id -> X-Agent-Id`). CSV columns are derived from these keys. |
| `log.filePath`        | Path to the CSV log file (created if missing, header written on creation). |
| `tokenizer.model`     | Model hint for the local tokenizer fallback (used when upstream omits `usage`). |

The config is hot-reloaded on change (no restart needed). Changing `listen`
requires a restart; everything else (upstream, keys, attribution headers, log
path) is picked up live.

### Run locally

```bash
npm install
npm run dev      # tsx watch (auto-restart on code changes)
# or
npm run build && npm start
```

Point your agents at `http://127.0.0.1:8080` and add the configured
attribution headers (e.g. `X-Agent-Id`, `X-Job-Type`) to each request. The
proxy forwards everything to the upstream and appends one CSV row per request
to `logs/usage.csv`:

```
timestamp,agent_id,job_type,prompt_tokens,completion_tokens,total_tokens
2026-09-13T10:58:38.819Z,agent-42,translate,12,3,15
```

### Check status

The proxy exposes a `/health` endpoint that returns HTTP `200` with a small
JSON body when the server is up. Query it with:

```powershell
Invoke-RestMethod -Uri http://localhost:8080/health -Method Get
```

Example response:

```
status
------
ok
```

A non-2xx response (or a connection error) means the proxy is not running —
check that `npm run dev` / `npm start` is active and that `config.json` binds
`listen.port` to `8080` (or adjust the URL accordingly).

### Quick test

With the proxy running and `config.json` pointed at a working upstream, send a
chat completion with the attribution headers and a model the upstream serves:

```powershell
Invoke-RestMethod -Uri http://localhost:8080/v1/chat/completions -Method Post ` -Headers @{ "X-Agent-Id" = "demo-agent"; "X-Job-Type" = "test"; "Content-Type" = "application/json" } ` -Body '{"model":"gpt-5-mini","messages":[{"role":"user","content":"Say hello in one word."}]}'
```

The proxy forwards the request, returns the upstream response unchanged, and
appends one row to `logs/usage.csv` with the attribution headers and the token
counts from the upstream `usage` object:

```
2026-09-13T11:26:45.636Z,demo-agent,test,12,75,87
```

### Run in Docker

```bash
docker build -t ai-token-proxy .
docker run -p 8080:8080 \
  -v "$PWD/config.json:/app/config.json:ro" \
  -v "$PWD/logs:/app/logs" \
  -e OPENAI_API_KEY=sk-... \
  ai-token-proxy
```

## Project layout

```
.
├── src/
│   ├── index.ts        # entry point: load config, start server, hot-reload
│   ├── server.ts       # HTTP server: /health + /v1/* routing
│   ├── proxy.ts        # transparent forwarding, auth, usage extraction, logging
│   ├── logger.ts       # CSV logger (header on creation, appends rows)
│   ├── tokenizer.ts    # local tokenizer fallback (gpt-tokenizer) for usage estimates
│   ├── config.ts       # JSON config load + env-var substitution + fs.watch hot-reload
│   └── types.ts        # shared config & token-count types
├── docs/
│   └── requirements.md # full requirements specification
├── .agents/
│   └── skills/         # opencode skills (e.g. grill-me)
├── config.example.json # copy to config.json (gitignored)
├── opencode.json       # opencode config
├── package.json
├── tsconfig.json
└── Dockerfile
```

`config.json`, `logs/`, `node_modules/`, and `dist/` are gitignored.
