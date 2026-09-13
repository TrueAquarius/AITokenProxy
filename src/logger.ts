import fs from 'fs';
import path from 'path';
import type { Config, TokenCounts } from './types.js';

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export class CsvLogger {
  private config: Config;
  private stream: fs.WriteStream | null = null;
  private attributionColumns: string[] = [];

  constructor(config: Config) {
    this.config = config;
    this.attributionColumns = Object.keys(config.attributionHeaders);
  }

  private ensureStream(): void {
    if (this.stream && this.stream.writable) return;

    const filePath = this.config.log.filePath;
    const dir = path.dirname(filePath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const isNewFile = !fs.existsSync(filePath) || fs.statSync(filePath).size === 0;
    this.stream = fs.createWriteStream(filePath, { flags: 'a' });

    if (isNewFile) {
      const header = ['timestamp', ...this.attributionColumns, 'prompt_tokens', 'completion_tokens', 'total_tokens']
        .map(csvEscape)
        .join(',');
      this.stream.write(header + '\n');
    }
  }

  log(attribution: Record<string, string>, tokens: TokenCounts): void {
    try {
      this.ensureStream();
      const row = [
        new Date().toISOString(),
        ...this.attributionColumns.map((col) => attribution[col] ?? ''),
        String(tokens.prompt_tokens),
        String(tokens.completion_tokens),
        String(tokens.total_tokens),
      ];
      this.stream?.write(row.map(csvEscape).join(',') + '\n');
    } catch (err) {
      console.error(`[logger] failed to write CSV row: ${(err as Error).message}`);
    }
  }

  reload(config: Config): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
    this.config = config;
    this.attributionColumns = Object.keys(config.attributionHeaders);
  }
}
