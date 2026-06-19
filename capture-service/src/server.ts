// Minimal HTTP server for the capture container (Node built-ins only).
//   GET  /healthz   -> 200 "ok"            (compute liveness)
//   POST /capture   -> { raw_tokens, screenshot_b64, final_url, title }
//     Auth: Authorization: Bearer <CAPTURE_TOKEN>
//     Body: { "url": "https://..." }
//
// Only the `analyze` edge function calls this, presenting the shared bearer
// token. The container holds NO InsForge credentials by design — it returns
// the screenshot as base64 and `analyze` (which has API_KEY) stores it.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { captureUrl } from './capture.js';

const PORT = Number(process.env.PORT) || 8080;
const CAPTURE_TOKEN = process.env.CAPTURE_TOKEN || '';
const MAX_BODY_BYTES = 16 * 1024; // request bodies are tiny ({url})

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json',
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      data += chunk.toString('utf8');
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function authorized(req: IncomingMessage): boolean {
  // If no token is configured, refuse everything (fail closed).
  if (!CAPTURE_TOKEN) return false;
  const header = req.headers['authorization'] || '';
  return header === `Bearer ${CAPTURE_TOKEN}`;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/healthz') {
      return send(res, 200, 'ok');
    }

    if (req.method === 'POST' && (req.url === '/capture' || req.url?.startsWith('/capture?'))) {
      if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });

      let url: string;
      try {
        const parsed = JSON.parse((await readBody(req)) || '{}');
        url = String(parsed.url || '').trim();
      } catch {
        return send(res, 400, { error: 'bad json' });
      }
      if (!url) return send(res, 400, { error: 'missing url' });

      try {
        const result = await captureUrl(url);
        return send(res, 200, result);
      } catch (err) {
        // Degrade gracefully: 200 with empty tokens so `analyze` falls back.
        const message = err instanceof Error ? err.message : String(err);
        return send(res, 200, {
          raw_tokens: emptyRawTokens(url),
          screenshot_b64: null,
          final_url: url,
          title: '',
          error: message,
        });
      }
    }

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return send(res, 500, { error: message });
  }
});

function emptyRawTokens(url: string) {
  return {
    fonts: [],
    fontSizes: [],
    fontWeights: [],
    colors: [],
    radii: [],
    shadows: [],
    spacing: [],
    button: null,
    fontLinks: [],
    meta: { url, finalUrl: url, title: '', viewport: { width: 1280, height: 800 } },
  };
}

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`capture-service listening on :${PORT}`);
});
