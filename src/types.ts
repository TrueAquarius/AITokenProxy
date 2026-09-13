export interface ListenConfig {
  host: string;
  port: number;
}

export interface LogConfig {
  filePath: string;
}

export interface TokenizerConfig {
  model?: string;
}

export interface Config {
  listen: ListenConfig;
  upstream: string;
  upstreamApiKey?: string;
  attributionHeaders: Record<string, string>;
  log: LogConfig;
  tokenizer?: TokenizerConfig;
}

export interface TokenCounts {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
