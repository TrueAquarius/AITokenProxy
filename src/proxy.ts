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

function writeWithBackpressure(res: http.ServerResponse, buf: Buffer): Promise<void> {
  return new Promise((resolve) => {
    if (res.writableEnded || res.destroyed) return resolve();
    if (res.write(buf)) resolve();
    else res.once('drain', () => resolve());
  });
}

function parseSseChunks(buffer: Buffer): unknown[] {
  const payloads: unknown[] = [];
  for (const line of buffer.toString('utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (data === '' || data === '[DONE]') continue;
    try {
      payloads.push(JSON.parse(data));
    } catch {
      // ignore malformed line
    }
  }
  return payloads;
}

function extractStreamingUsage(buffer: Buffer): TokenCounts | null {
  for (const chunk of parseSseChunks(buffer)) {
    const usage = (chunk as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage;
    if (usage && (usage.prompt_tokens || usage.completion_tokens || usage.total_tokens)) {
      return usageToTokens(usage);
    }
  }
  return null;
}

function extractStreamingCompletionText(buffer: Buffer): string {
  const parts: string[] = [];
  for (const chunk of parseSseChunks(buffer)) {
    const choices = (chunk as { choices?: Array<{ delta?: { content?: string } }> }).choices;
    if (!Array.isArray(choices)) continue;
    for (const choice of choices) {
      const content = choice?.delta?.content;
      if (typeof content === 'string') parts.push(content);
    }
  }
  return parts.join('');
}

async function handleStreamingResponse(
  res: http.ServerResponse,
  upstreamRes: Response,
  reqJson: unknown,
  attribution: Record<string, string>,
  logger: CsvLogger,
): Promise<void> {
  const resHeaders = buildResponseHeaders(upstreamRes);
  res.writeHead(upstreamRes.status, resHeaders);

  const chunks: Buffer[] = [];
  const body = upstreamRes.body;
  if (!body) {
    if (!res.writableEnded) res.end();
    logger.log(attribution, ZERO_TOKENS);
    return;
  }
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const buf = Buffer.from(value);
      chunks.push(buf);
      await writeWithBackpressure(res, buf);
    }
  } catch (err) {
    console.error(`[proxy] streaming read failed: ${(err as Error).message}`);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
  if (!res.writableEnded) res.end();

  const fullBuffer = Buffer.concat(chunks);
  let tokens: TokenCounts = ZERO_TOKENS;
  if (upstreamRes.ok && fullBuffer.length > 0) {
    const streamedUsage = extractStreamingUsage(fullBuffer);
    if (streamedUsage) {
      tokens = streamedUsage;
    } else {
      try {
        const completionText = extractStreamingCompletionText(fullBuffer);
        const pseudoRes = { choices: [{ message: { content: completionText } }] };
        tokens = await estimateUsage(reqJson, pseudoRes);
      } catch (err) {
        console.error(`[proxy] tokenizer estimate failed: ${(err as Error).message}`);
      }
    }
  }
  logger.log(attribution, tokens);
}

function buildUpstreamUrl(req: http.IncomingMessage, config: Config): URL {
  const base = config.upstream.replace(/\/+$/, '');
  const stripped = (req.url ?? '').replace(/^\/v1(?=\/|$)/, '');
  return new URL(base + stripped);
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

  const contentType = upstreamRes.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream') && upstreamRes.body) {
    await handleStreamingResponse(res, upstreamRes, reqJson, attribution, logger);
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
