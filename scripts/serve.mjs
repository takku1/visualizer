import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const root = join(process.cwd(), 'dist', 'dev');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json', '.css': 'text/css' };

createServer(async (req, res) => {
  const path = join(root, (req.url ?? '/').split('?')[0] === '/' ? 'index.html' : (req.url ?? '/').split('?')[0]);
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(5174, '127.0.0.1', () => console.log('serving dist/dev on http://127.0.0.1:5174'));
