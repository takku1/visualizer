/**
 * Optional Laya sidecar.
 *
 * Serves POST /v1/systemone on localhost, backed by Laya - the open-weight
 * System One model - running locally through ONNX Runtime. The extension
 * points at it by setting `proxyUrl`, and nothing else changes: the request
 * and response shapes are the ones the hosted API already uses.
 *
 * This is opt-in and not part of the build. The weights are roughly 1.7 GB as
 * fp32 ONNX, which is three orders of magnitude more than the built-in engine
 * costs, so run it only if you want a learned model in the loop.
 *
 *   npm install @receptron/laya        # not a dependency of this project
 *   node tools/laya-server.mjs
 *   # then, in Spotify's console:
 *   __s1.configure({ proxyUrl: 'http://127.0.0.1:8765' })
 *
 * Binds to 127.0.0.1 only. Do not expose it.
 */

import { createServer } from 'node:http';

const PORT = Number(process.env['LAYA_PORT'] ?? 8765);
const ORIGIN = process.env['LAYA_ORIGIN'] ?? '*';

let laya;
try {
  ({ Laya: laya } = await import('@receptron/laya'));
} catch {
  console.error('@receptron/laya is not installed.\n  npm install @receptron/laya\n');
  process.exit(1);
}

console.log('loading Laya (first run downloads the weights)…');
const model = await laya.load({
  onProgress: (p) => process.stdout.write(`\r  ${Math.round((p?.ratio ?? 0) * 100)}%   `),
});
console.log('\nready.');

const server = createServer(async (req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors).end();
    return;
  }
  if (req.method !== 'POST' || !req.url?.endsWith('/v1/systemone')) {
    res.writeHead(404, cors).end();
    return;
  }

  try {
    const chunks = [];
    let bytes = 0;
    for await (const c of req) {
      bytes += c.length;
      // The extension's payload is a small JSON object; anything larger is a
      // bug or an abuse, and either way is not worth buffering.
      if (bytes > 256 * 1024) {
        res.writeHead(413, cors).end();
        return;
      }
      chunks.push(c);
    }

    const { state, questions } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const started = performance.now();
    const answers = await model.systemOne(state, questions);

    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ model: 'laya-local', answers }));

    console.log(`  ${Math.round(performance.now() - started)}ms  ${Object.keys(questions).length} questions`);
  } catch (err) {
    res.writeHead(500, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  laya sidecar -> http://127.0.0.1:${PORT}/v1/systemone\n`);
});
