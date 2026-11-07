// Checks that a deployed app-ads.txt is served as raw text with the expected content.
//
//   node scripts/check-live.mjs [url] [--retries N]
//
// Defaults to https://srath.dk/app-ads.txt. Compares against public/app-ads.txt.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const retriesAt = args.indexOf('--retries');
const retries = retriesAt >= 0 ? Number(args.splice(retriesAt, 2)[1]) : 0;
const url = args[0] || 'https://srath.dk/app-ads.txt';
const expected = fs.readFileSync(path.join(ROOT, 'public', 'app-ads.txt'), 'utf8');

async function check() {
  const res = await fetch(url, { redirect: 'follow', headers: { 'cache-control': 'no-cache' } });
  const body = await res.text();
  const type = res.headers.get('content-type') || '';
  const problems = [];
  if (res.status !== 200) problems.push(`HTTP status ${res.status}`);
  if (!type.startsWith('text/plain')) problems.push(`content-type is "${type}", expected text/plain`);
  if (new URL(res.url).host !== new URL(url).host) problems.push(`redirected to another host: ${res.url}`);
  if (body !== expected) problems.push(`content differs from public/app-ads.txt:\n---\n${body.slice(0, 500)}\n---`);
  return { res, type, problems };
}

for (let attempt = 0; ; attempt++) {
  try {
    const { res, type, problems } = await check();
    if (!problems.length) {
      console.log(`OK  ${url}\n    status ${res.status}, ${type}, ${expected.length} bytes, content matches.`);
      process.exit(0);
    }
    console.error(`Attempt ${attempt + 1}: ${url}\n  - ${problems.join('\n  - ')}`);
  } catch (err) {
    console.error(`Attempt ${attempt + 1}: ${url} — ${err.cause?.code || err.message}`);
  }
  if (attempt >= retries) process.exit(1);
  await new Promise((r) => setTimeout(r, 15000));
}
