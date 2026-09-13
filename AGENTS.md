# AGENTS.md

Guidance for AI agents (and humans) working in this repository.

## Project

**AI Token Proxy** — a proxy between AI Agents and LLMs that logs per-request
token consumption with attribution metadata. v1 is a prototype: the proxy
forwards OpenAI-compatible requests to an upstream LLM, reads attribution
headers, and logs token usage to a CSV file. The database and web frontend are
deferred to later versions.

Read [`docs/requirements.md`](docs/requirements.md) before making changes — it
is the source of truth for scope and behavior. Update it (and the README) when
requirements change.

## Current state

- The v1 proxy is **implemented** in `src/` (Node.js + TypeScript) with a
  `package.json`, `tsconfig.json`, and `Dockerfile`.
- Requirements are captured in `docs/requirements.md`.
- opencode is configured via `opencode.json`; skills live under
  `.agents/skills/`.

## Tech stack (planned)

- Node.js + TypeScript
- Docker
- JSON config (hot-reloaded)
- CSV log output

## When implementing v1

- Use standard Node/TS layout: `src/`, `package.json`, `tsconfig.json`,
  `Dockerfile`.
- Do not add tests in v1 (explicitly out of scope). Add them in a later
  version.
- Do not add a database, web frontend, streaming, multi-provider support, or
  cost calculation — these are explicitly out of scope for v1. Keep the
  prototype focused.
- Transparent passthrough: forward method, headers, body, and query string
  as-is; return the upstream response unchanged. Only read `usage` from the
  response body for logging.
- Attribution header names come from the JSON config, not hardcoded.
- Auth: forward the agent's key verbatim; fall back to the configured upstream
  key only if the agent did not provide one.
- Token counts: prefer the upstream `usage` object; fall back to a local
  tokenizer estimate when upstream usage is missing.
- Errors: log to the CSV with token counts of 0 and pass the upstream error
  through unchanged.
- Hot-reload the JSON config on file change.
- Provide a `/health` endpoint returning 200.

## Conventions

- Match the style of neighboring files when editing.
- Do not commit secrets or API keys. The config file should reference keys via
  environment variables or a separate, gitignored file.
- Keep README.md and docs/requirements.md in sync with the implementation.

## Useful commands

- `npm install` — install dependencies.
- `npm run dev` — run via `tsx watch` (auto-restart on code changes). Reads
  `config.json` (or `CONFIG_PATH`).
- `npm run build` — compile TypeScript to `dist/`.
- `npm start` — run the compiled proxy (`node dist/index.js`).
- `docker build -t ai-token-proxy .` — build the container image.
- `docker run -p 8080:8080 -v $PWD/config.json:/app/config.json:ro ai-token-proxy`
  — run the container.

Config is loaded from `config.json` by default, or from the path in
`CONFIG_PATH`. Secrets are referenced as `${ENV_VAR}` in the config and
resolved from the environment. The config is hot-reloaded on file change.

## opencode

- Config: `opencode.json`
- Skills: `.agents/skills/` (e.g. `grill-me` — used to gather these
  requirements). Restart opencode after changing config or skills.
