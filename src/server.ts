import http from 'http';
import type { Config } from './types.js';
import { CsvLogger } from './logger.js';
import { handleProxy } from './proxy.js';
import { VERSION } from './version.js';

export function createServer(getConfig: () => Config, logger: CsvLogger): http.Server {
  const server = http.createServer(async (req, res) => {
    const requestPath = (req.url ?? '/').split('?')[0];

    if (requestPath === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: VERSION }));
      return;
    }

    if (requestPath.startsWith('/v1/')) {
      try {
        await handleProxy(req, res, getConfig(), logger);
      } catch (err) {
        console.error(`[server] unhandled proxy error: ${(err as Error).message}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'internal proxy error' } }));
        }
      }
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });

  return server;
}
