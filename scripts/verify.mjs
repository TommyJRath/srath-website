// Post-build checks on dist/. Run after `npm run build`; exits non-zero on failure.
//
//  - app-ads.txt is present, byte-identical to public/app-ads.txt, and contains the AdMob line
//  - required files and every app's pages exist
//  - every internal link and asset reference resolves to a file in dist/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const ADMOB_LINE = 'google.com, pub-4316823278364195, DIRECT, f08c47fec0942fa0';

const failures = [];
const fail = (msg) => failures.push(msg);

if (!fs.existsSync(DIST)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

// app-ads.txt --------------------------------------------------------------
const adsPath = path.join(DIST, 'app-ads.txt');
if (!fs.existsSync(adsPath)) {
  fail('dist/app-ads.txt is missing');
} else {
  const out = fs.readFileSync(adsPath);
  const src = fs.readFileSync(path.join(ROOT, 'public', 'app-ads.txt'));
  const text = out.toString('utf8');
  if (!out.equals(src)) fail('dist/app-ads.txt is not byte-identical to public/app-ads.txt');
  if (text.charCodeAt(0) === 0xfeff) fail('app-ads.txt starts with a UTF-8 BOM');
  if (text.includes('\r')) fail('app-ads.txt contains CR characters (expected LF line endings)');
  if (!text.split('\n').includes(ADMOB_LINE)) fail(`app-ads.txt does not contain the exact line: ${ADMOB_LINE}`);
  if (/<[a-z!]/i.test(text)) fail('app-ads.txt looks like HTML');
}

// Required files ------------------------------------------------------------
const apps = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'apps.json'), 'utf8'));
const required = [
  'index.html', '404.html', 'apps/index.html', 'privacy/index.html', 'contact/index.html',
  'robots.txt', 'sitemap.xml', 'CNAME', '.nojekyll', 'favicon.svg', 'favicon.ico',
  'apple-touch-icon.png', 'og-image.png',
  ...apps.flatMap((a) => [`apps/${a.slug}/index.html`, `privacy/${a.slug}/index.html`]),
];
for (const file of required) {
  if (!fs.existsSync(path.join(DIST, file))) fail(`missing dist/${file}`);
}
const cname = fs.existsSync(path.join(DIST, 'CNAME')) ? fs.readFileSync(path.join(DIST, 'CNAME'), 'utf8').trim() : '';
if (cname !== 'srath.dk') fail(`CNAME should contain "srath.dk", found "${cname}"`);

// Internal links -------------------------------------------------------------
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

function resolves(url) {
  const clean = decodeURIComponent(url.split(/[?#]/)[0]);
  if (!clean || clean === '/') return fs.existsSync(path.join(DIST, 'index.html'));
  const target = path.join(DIST, clean);
  if (clean.endsWith('/')) return fs.existsSync(path.join(target, 'index.html'));
  return fs.existsSync(target) && fs.statSync(target).isFile();
}

const htmlFiles = walk(DIST).filter((f) => f.endsWith('.html'));
let links = 0;
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(DIST, file).replace(/\\/g, '/');
  for (const [, url] of html.matchAll(/\s(?:href|src)="(\/[^"]*)"/g)) {
    if (url.startsWith('//')) continue;
    links++;
    if (!resolves(url)) fail(`${rel}: broken internal link ${url}`);
  }
  if (!/<title>[^<]+<\/title>/.test(html)) fail(`${rel}: missing <title>`);
  if (!/<meta name="description" content="[^"]+">/.test(html)) fail(`${rel}: missing meta description`);
  if ((html.match(/<h1[\s>]/g) || []).length !== 1) fail(`${rel}: expected exactly one <h1>`);
}

if (failures.length) {
  console.error(`Verification failed (${failures.length}):\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`Verified dist/: app-ads.txt OK, ${required.length} required files, ${htmlFiles.length} pages, ${links} internal links.`);
