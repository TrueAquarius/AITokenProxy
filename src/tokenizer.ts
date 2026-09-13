import type { TokenCounts } from './types.js';

type EncodeFn = (text: string) => number[] | Uint8Array;

let encodePromise: Promise<EncodeFn | null> | null = null;

async function getEncoder(): Promise<EncodeFn | null> {
  if (encodePromise) return encodePromise;
  encodePromise = (async () => {
    try {
      const mod = await import('gpt-tokenizer');
      const candidate = (mod as { encode?: EncodeFn }).encode
        ?? (mod as { default?: { encode?: EncodeFn } }).default?.encode
        ?? null;
      if (candidate) return candidate;
      console.error('[tokenizer] gpt-tokenizer loaded but no encode() export found');
      return null;
    } catch (err) {
      console.error(`[tokenizer] failed to load gpt-tokenizer: ${(err as Error).message}`);
      return null;
    }
  })();
  return encodePromise;
}

async function estimateTokens(text: string): Promise<number> {
  if (!text) return 0;
  const encode = await getEncoder();
  if (!encode) return 0;
  try {
    const tokens = encode(text);
    return Array.isArray(tokens) || tokens instanceof Uint8Array ? tokens.length : 0;
  } catch (err) {
    console.error(`[tokenizer] encode() failed: ${(err as Error).message}`);
    return 0;
  }
}

function extractRequestText(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const b = body as Record<string, unknown>;
  const parts: string[] = [];
  if (Array.isArray(b.messages)) {
    for (const m of b.messages) {
      if (m && typeof m === 'object') {
        const content = (m as Record<string, unknown>).content;
        if (typeof content === 'string') parts.push(content);
        else if (Array.isArray(content)) {
          for (const c of content) {
            if (c && typeof c === 'object') {
              const text = (c as Record<string, unknown>).text;
              if (typeof text === 'string') parts.push(text);
            } else if (typeof c === 'string') {
              parts.push(c);
            }
          }
        }
      }
    }
  }
  if (typeof b.prompt === 'string') parts.push(b.prompt);
  else if (Array.isArray(b.prompt)) parts.push(b.prompt.map(String).join('\n'));
  if (typeof b.input === 'string') parts.push(b.input);
  else if (Array.isArray(b.input)) parts.push(b.input.map(String).join('\n'));
  return parts.join('\n');
}

function extractResponseText(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const b = body as Record<string, unknown>;
  const parts: string[] = [];
  if (Array.isArray(b.choices)) {
    for (const ch of b.choices) {
      if (!ch || typeof ch !== 'object') continue;
      const choice = ch as Record<string, unknown>;
      const message = choice.message as Record<string, unknown> | undefined;
      if (message && typeof message.content === 'string') parts.push(message.content);
      else if (message && Array.isArray(message.content)) {
        for (const c of message.content) {
          if (c && typeof c === 'object') {
            const text = (c as Record<string, unknown>).text;
            if (typeof text === 'string') parts.push(text);
          } else if (typeof c === 'string') {
            parts.push(c);
          }
        }
      }
      if (typeof choice.text === 'string') parts.push(choice.text);
    }
  }
  return parts.join('\n');
}

export async function estimateUsage(
  reqBody: unknown,
  resBody: unknown,
): Promise<TokenCounts> {
  const prompt_tokens = await estimateTokens(extractRequestText(reqBody));
  const completion_tokens = await estimateTokens(extractResponseText(resBody));
  return {
    prompt_tokens,
    completion_tokens,
    total_tokens: prompt_tokens + completion_tokens,
  };
}
