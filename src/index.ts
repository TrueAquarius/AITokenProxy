import path from 'path';
import type { Config } from './types.js';
import { loadConfig, watchConfig } from './config.js';
import { createServer } from './server.js';
import { CsvLogger } from './logger.js';

const configPath = process.env.CONFIG_PATH
  ? path.resolve(process.env.CONFIG_PATH)
  : path.resolve('config.json');

let config: Config;
try {
  config = loadConfig(configPath);
} catch (err) {
  console.error(`[startup] ${err instanceof Error ? err.message : String(err)}`);
  console.error('[startup] Set CONFIG_PATH or create config.json (see config.example.json).');
  process.exit(1);
}

const logger = new CsvLogger(config);
const getConfig = () => config;

const server = createServer(getConfig, logger);

server.on('error', (err) => {
  console.error(`[startup] server error: ${err.message}`);
  process.exit(1);
});

server.listen(config.listen.port, config.listen.host, () => {
  console.log(`[ai-token-proxy] listening on http://${config.listen.host}:${config.listen.port}`);
  console.log(`[ai-token-proxy] upstream: ${config.upstream}`);
  console.log(`[ai-token-proxy] log: ${config.log.filePath}`);
  console.log(`[ai-token-proxy] config: ${configPath}`);
});

watchConfig(configPath, (next) => {
  config = next;
  logger.reload(next);
  console.log(`[ai-token-proxy] upstream: ${config.upstream}`);
  console.log(`[ai-token-proxy] log: ${config.log.filePath}`);
});
