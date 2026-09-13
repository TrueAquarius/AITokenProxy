import fs from 'fs';
import path from 'path';
import type { Config } from './types.js';

const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function substituteEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(ENV_VAR_PATTERN, (match, name: string) => {
      return process.env[name] ?? match;
    });
  }
  if (Array.isArray(value)) {
    return value.map(substituteEnvVars);
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = substituteEnvVars(v);
    }
    return result;
  }
  return value;
}

function validateConfig(raw: unknown): Config {
  if (!raw || typeof raw !== 'object') {
    throw new Error('config: expected a JSON object');
  }
  const cfg = raw as Record<string, unknown>;

  const listen = cfg.listen as Config['listen'] | undefined;
  if (!listen || typeof listen.host !== 'string' || typeof listen.port !== 'number') {
    throw new Error('config: "listen" must be { host: string, port: number }');
  }

  const upstream = cfg.upstream;
  if (typeof upstream !== 'string' || upstream.length === 0) {
    throw new Error('config: "upstream" must be a non-empty string URL');
  }

  const attributionHeaders = cfg.attributionHeaders;
  if (!attributionHeaders || typeof attributionHeaders !== 'object') {
    throw new Error('config: "attributionHeaders" must be an object mapping logical name -> header name');
  }

  const log = cfg.log as Config['log'] | undefined;
  if (!log || typeof log.filePath !== 'string' || log.filePath.length === 0) {
    throw new Error('config: "log.filePath" must be a non-empty string');
  }

  return {
    listen,
    upstream,
    upstreamApiKey: cfg.upstreamApiKey as string | undefined,
    attributionHeaders: attributionHeaders as Record<string, string>,
    log,
    tokenizer: cfg.tokenizer as Config['tokenizer'] | undefined,
  };
}

export function loadConfig(configPath: string): Config {
  const absPath = path.resolve(configPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`config file not found: ${absPath}`);
  }
  const text = fs.readFileSync(absPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`config: failed to parse JSON: ${(err as Error).message}`);
  }
  const substituted = substituteEnvVars(parsed);
  return validateConfig(substituted);
}

export function watchConfig(configPath: string, onChange: (config: Config) => void): fs.FSWatcher {
  const absPath = path.resolve(configPath);
  let debounce: NodeJS.Timeout | null = null;

  const watcher = fs.watch(absPath, { persistent: false }, (eventType) => {
    if (eventType !== 'change' && eventType !== 'rename') return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      try {
        const next = loadConfig(absPath);
        onChange(next);
        console.log(`[config] reloaded ${absPath}`);
      } catch (err) {
        console.error(`[config] reload failed, keeping previous config: ${(err as Error).message}`);
      }
    }, 300);
  });

  watcher.on('error', (err) => {
    console.error(`[config] watcher error: ${err.message}`);
  });

  return watcher;
}
