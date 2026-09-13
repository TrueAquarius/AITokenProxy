# AI Token Proxy — Requirements

> Status: **V0.2.0 (in development).** V0.1.0 (prototype) is released — `src/`
> contains the proxy; `package.json`, `tsconfig.json`, and `Dockerfile` are in
> place.
> Last updated: 2026-09-13

## 1. Problem Statement

The organization runs several AI Agents for different purposes. These agents
access LLMs through an OpenAI-compatible interface, authenticating each call
with an API key. Because multiple agents may share the same API key and the
nature of each request is not visible to the LLM provider, it is impossible to
associate token consumption and token cost with a particular AI Agent or a
particular job. As a result, the organization cannot analyze which agents use
how many tokens for what purpose.

## 2. Solution

The AI Token Proxy sits between the Agent and the LLM. It presents an
OpenAI-compatible interface to the agent and forwards the agent's requests to
the upstream LLM (also OpenAI-compatible). The agent supplies attribution
metadata (example: Agent ID, Job Type) in the HTTP headers of each request.
The proxy reads these headers and stores them together with the actual token
consumption, enabling precise analysis of token usage.

## 3. High-Level Architecture

The full product consists of three logical parts:

1. **The Proxy** — forwards OpenAI-compatible requests and logs attribution +
   token usage.
2. **The Database** — persists the logged data (replaces/augments file logging
   in later versions).
3. **The Web Frontend** — manages the proxy and analyzes token-consumption
   data.

V0.1.0 delivers only part 1, in prototype form.

## 4. Scope

### 4.1 In scope for V0.1.0 (prototype)

- A single proxy service that forwards all `/v1/*` endpoints to one
  OpenAI-compatible upstream endpoint.
- Transparent passthrough: HTTP method, headers, body, and query string are
  forwarded as-is; the upstream response is returned to the agent unchanged.
- Attribution metadata read from request headers, with the **header names
  configurable via a JSON config file** (e.g. which header maps to `agent_id`,
  which to `job_type`).
- Token-consumption logging to a **CSV file**.
- Auth handling: the agent's `Authorization` key is forwarded verbatim; if the
  agent does not provide one, the proxy falls back to an upstream API key
  configured in the JSON config.
- Token counts: read from the upstream response's `usage` object first
  (including the `usage` frame sent at the end of a streamed SSE response); if
  absent, estimate locally with a tokenizer.
- Streaming responses (Server-Sent Events / SSE): streamed upstream responses
  are passed through to the agent frame-by-frame in real time; the proxy tees
  the frames internally to read `usage` (or aggregate `delta.content` for the
  tokenizer fallback) before logging.
- Error handling: upstream non-2xx responses are logged to the CSV (with token
  counts of 0) and the upstream error is passed through to the agent
  unchanged.
- Hot-reload of the JSON config file on change (no restart required).
- A `/health` endpoint returning HTTP 200 with a JSON body containing
  `status: "ok"` and the proxy `version` when the proxy is running.
- Packaged as a Docker container.
- Configuration via a JSON config file.

### 4.2 Out of scope for V0.1.0 (deferred to later versions)

- Multiple LLM providers (V0.1.0 targets a single upstream endpoint).
- Cost / pricing calculation (V0.1.0 logs token counts only; mapping tokens to
  currency is deferred).
- Authenticating or rate-limiting agents (V0.1.0 does not authenticate callers of
  the proxy).
- Automated tests.
- The database (replaces / augments CSV in later versions).
- The web frontend for management and analysis.
- Production hardening (V0.1.0 is a prototype).

## 5. Users & Interfaces

- **Primary users:** AI Agents (non-human) calling an OpenAI-compatible
  endpoint.
- **Operator:** a human who configures the proxy and reads the CSV output.
- **Inbound interface:** OpenAI-compatible HTTP API (all `/v1/*` paths).
- **Outbound interface:** forwards to an OpenAI-compatible upstream endpoint
  (any such endpoint, configured at runtime).
- **Management surface:** JSON config file + `/health` endpoint. No web UI in
  V0.1.0.

## 6. Tech Stack

| Concern        | Choice                                   |
| -------------- | ---------------------------------------- |
| Language       | Node.js + TypeScript                     |
| Packaging      | Docker container                         |
| Config         | JSON file (hot-reloaded on change)       |
| Log output     | CSV file                                  |
| Layout         | Standard Node/TS: `src/`, `package.json`, `tsconfig.json`, `Dockerfile` |

## 7. Data

- **Per request, the proxy records (CSV columns, in order):**
  1. `timestamp`
  2. all configured attribution fields (header-name mapping from config)
  3. `prompt_tokens`
  4. `completion_tokens`
  5. `total_tokens`
- **Token source:** upstream `usage` object first; local tokenizer estimate as
  fallback when upstream usage is missing.
- **Storage:** CSV file at a path defined in the config. (Later versions move
  to a database.)
- **Error rows:** upstream non-2xx responses are logged with token counts of
  0; the upstream error body is passed through to the agent unchanged.

## 8. Non-Functional Requirements

- **HTTP semantics:** transparent passthrough. The proxy does not terminate
  and re-serialize the body beyond what is needed to read `usage`; method,
  headers, body, and query string are forwarded as-is. Streamed (SSE)
  responses are forwarded frame-by-frame in real time; the proxy tees the
  frames internally only to read `usage`.
- **Reliability (prototype level):** errors are logged and passed through;
  the proxy should not crash on a single bad request.
- **Config:** hot-reload on file change.
- **Observability:** `/health` endpoint returning 200 with `status: "ok"` and the
  proxy `version` when up. Console logging
  for startup and errors is acceptable.
- **Deployment:** Docker container.

## 9. Constraints

- **Timeline:** no hard deadline for the prototype.
- **Repo layout:** standard Node/TS layout.
- **Tests:** none in V0.1.0.
- **Production hardening:** explicitly deferred. Later versions must be
  hardened for production.

## 10. Configuration (JSON config file) — intended shape

> Exact field names are to be finalized during implementation; this is the
> intended surface.

- `listen` — host/port the proxy binds to (e.g. `{ "host": "0.0.0.0", "port": 8080 }`).
- `upstream` — base URL of the OpenAI-compatible endpoint to forward to.
- `upstreamApiKey` — fallback API key used when the agent does not provide one.
- `attributionHeaders` — map of logical name → request header name (e.g.
  `{ "agent_id": "X-Agent-Id", "job_type": "X-Job-Type" }`). The CSV columns are
  derived from these keys.
- `log` — CSV log settings (file path, and any rotation/CSV options).
- `tokenizer` — options for the local tokenizer fallback (model/family to
  use for estimation).

## 11. Open Questions / Assumed Defaults

- **Upstream LLM endpoint:** assumed to be "any OpenAI-compatible URL,
  configured at runtime." If a specific provider is required, update
  `upstream` in the config and confirm provider-specific auth behavior.
- **Tokenizer choice:** default to a widely-used OpenAI tokenizer (e.g.
  `tiktoken`) for the local fallback; finalize during implementation.
