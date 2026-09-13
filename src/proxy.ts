import http from 'http';
import type { Config, TokenCounts } from './types.js';
import { CsvLogger } from './logger.js';
import { estimateUsage } from './tokenizer.js';

const HOP_BY_HOP_REQ = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'proxy-authorization',
  'proxy-authenticate',
  'te',
  'trailer',
  'upgrade',
  'expect',
]);

const HOP_BY_HOP_RES = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
]);

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function headerValueToString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(', ');
  return value ?? '';
}

function buildForwardHeaders(req: http.IncomingMessage, config: Config): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP_REQ.has(name)) continue;
    if (value === undefined) continue;
    headers[name] = headerValueToString(value);
  }
  if (!req.headers.authorization && config.upstreamApiKey) {
    headers['authorization'] = `Bearer ${config.upstreamApiKey}`;
  }
  return headers;
}

function buildResponseHeaders(upstreamRes: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of upstreamRes.headers.entries()) {
    if (HOP_BY_HOP_RES.has(name)) continue;
    headers[name] = value;
  }
  return headers;
}

function buildUpstreamUrl(req: http.IncomingMessage, config: Config): URL {
  const base = config.upstream.replace(/\/+$/, '');
  return new URL(base + (req.url ?? ''));
}

function extractAttribution(
  req: http.IncomingMessage,
  config: Config,
): Record<string, string> {
  const attribution: Record<string, string> = {};
  for (const [logicalName, headerName] of Object.entries(config.attributionHeaders)) {
    attribution[logicalName] = headerValueToString(req.headers[headerName.toLowerCase()]);
  }
  return attribution;
}

function usageToTokens(usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }): TokenCounts {
  const prompt_tokens = Number(usage.prompt_tokens) || 0;
  const completion_tokens = Number(usage.completion_tokens) || 0;
  const total_tokens = Number(usage.total_tokens) || prompt_tokens + completion_tokens;
  return { prompt_tokens, completion_tokens, total_tokens };
}

const ZERO_TOKENS: TokenCounts = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

export async function handleProxy(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: Config,
  logger: CsvLogger,
): Promise<void> {
  const attribution = extractAttribution(req, config);

  let reqBuffer: Buffer;
  try {
    reqBuffer = await readBody(req);
  } catch (err) {
    console.error(`[proxy] failed to read request body: ${(err as Error).message}`);
    logger.log(attribution, ZERO_TOKENS);
    if (!res.headersSent) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'failed to read request body' } }));
    }
    return;
  }

  let reqJson: unknown = undefined;
  if (reqBuffer.length > 0) {
    try {
      reqJson = JSON.parse(reqBuffer.toString('utf8'));
    } catch {
      // Non-JSON body (e.g. multipart); keep reqJson undefined for token estimation.
    }
  }

  const url = buildUpstreamUrl(req, config);
  const headers = buildForwardHeaders(req, config);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const init: RequestInit = {
    method: req.method ?? 'GET',
    headers,
    redirect: 'manual',
  };
  if (hasBody && reqBuffer.length > 0) {
    init.body = new Uint8Array(reqBuffer.buffer, reqBuffer.byteOffset, reqBuffer.byteLength) as unknown as BodyInit;
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(url, init);
  } catch (err) {
    const message = (err as Error).message;
    const cause = (err as { cause?: { message?: string } }).cause;
    const detail = cause?.message ? `${message}: ${cause.message}` : message;
    console.error(`[proxy] upstream request failed: ${detail}`);
    logger.log(attribution, ZERO_TOKENS);
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'upstream unreachable', detail: message } }));
    return;
  }

  let resBuffer: Buffer;
  try {
    resBuffer = Buffer.from(await upstreamRes.arrayBuffer());
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[proxy] failed to read upstream response body: ${message}`);
    logger.log(attribution, ZERO_TOKENS);
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'failed to read upstream response', detail: message } }));
    return;
  }

  let tokens: TokenCounts = ZERO_TOKENS;
  if (upstreamRes.ok) {
    let resJson: unknown = undefined;
    if (resBuffer.length > 0) {
      try {
        resJson = JSON.parse(resBuffer.toString('utf8'));
      } catch {
        // Non-JSON response; cannot read usage.
      }
    }
    const usage = (resJson as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } } | undefined)?.usage;
    if (usage) {
      tokens = usageToTokens(usage);
    } else {
      try {
        tokens = await estimateUsage(reqJson, resJson);
      } catch (err) {
        console.error(`[proxy] tokenizer estimate failed: ${(err as Error).message}`);
        tokens = ZERO_TOKENS;
      }
    }
  }

  logger.log(attribution, tokens);

  const resHeaders = buildResponseHeaders(upstreamRes);
  res.writeHead(upstreamRes.status, resHeaders);
  res.end(resBuffer);
}
