// Minimal local preview server for dist/ (mimics GitHub Pages URL handling).
//
//   node scripts/serve.mjs            serve dist/ on http://localhost:4321
//   node scripts/serve.mjs --watch    rebuild when content/, public/ or src/ change

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../src/build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 4321;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon',
};

// On Windows a file being served can briefly block deleting dist/. A failed rebuild is retried a few times
// before giving up until the next change.
let retries = 0;
function rebuild() {
  try {
    build();
    retries = 0;
  } catch (err) {
    console.error(`\nBuild failed.\n${err.message}\n`);
    if (/EPERM|EBUSY|ENOTEMPTY|ENOENT/.test(err.message) && retries < 5) {
      retries += 1;
      setTimeout(rebuild, 300 * retries);
    }
  }
}

if (process.argv.includes('--watch')) {
  rebuild();
  let timer;
  for (const dir of ['content', 'public', 'src']) {
    fs.watch(path.join(ROOT, dir), { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(rebuild, 150);
    });
  }
}

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = path.join(DIST, urlPath);
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }

  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!urlPath.endsWith('/')) { res.writeHead(301, { Location: `${urlPath}/` }).end(); return; }
    file = path.join(file, 'index.html');
  }
  let status = 200;
  if (!fs.existsSync(file)) { status = 404; file = path.join(DIST, '404.html'); }

  // During a rebuild a file can vanish between the check and the read: answer "try again" instead of crashing.
  const stream = fs.createReadStream(file);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '1' });
    res.end('Rebuilding, reload in a moment.');
  });
  stream.on('open', () => {
    res.writeHead(status, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    stream.pipe(res);
  });
}).listen(PORT, () => console.log(`Serving dist/ at http://localhost:${PORT}`));
