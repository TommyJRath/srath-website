// Static site generator for srath.dk. No dependencies: run with `node src/build.mjs`.
//
//   content/site.json        business details and contact email
//   content/apps.json        one entry per application
//   content/projects.json    other projects on the home page (apps are added automatically)
//   content/partners.json    suppliers and partners, shown on /partners/ and the home page
//   content/games.json       browser games; each game's files live in public/games/<slug>/
//   content/news.json        short news items; the newest recent one is a banner on the home page
//   content/tools.json       free browser tools (in Danish); markup in content/tools/<slug>.html,
//                            scripts in public/tools/<slug>/tool.js
//   content/privacy/*.md     one privacy policy per application (file name = app slug)
//   public/                  copied verbatim to the site root (app-ads.txt, CNAME, images, ...)
//   src/styles.css, main.js  published under /assets/
//
// Output goes to dist/, which is what GitHub Pages serves.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { esc, parseFrontMatter, renderMarkdown } from './markdown.mjs';
import { layout, pageHeader, appGrid, projectGrid, emailLink, playButton, sampleBadge, icons } from './templates.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = path.join(ROOT, 'content');
const PUBLIC = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(CONTENT, file), 'utf8'));

function formatDate(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function paragraphs(text) {
  return String(text).split(/\n\s*\n/).map((p) => `<p>${esc(p.trim())}</p>`).join('\n');
}

// ---------------------------------------------------------------------------
// Load and validate content
// ---------------------------------------------------------------------------

function loadContent() {
  const site = readJson('site.json');
  const apps = readJson('apps.json');
  const projects = fs.existsSync(path.join(CONTENT, 'projects.json')) ? readJson('projects.json') : [];
  const partners = fs.existsSync(path.join(CONTENT, 'partners.json')) ? readJson('partners.json') : [];
  const games = fs.existsSync(path.join(CONTENT, 'games.json')) ? readJson('games.json') : [];
  const news = fs.existsSync(path.join(CONTENT, 'news.json')) ? readJson('news.json') : [];
  const tools = fs.existsSync(path.join(CONTENT, 'tools.json')) ? readJson('tools.json') : [];
  const errors = [];
  const warnings = [];

  if (!/^https:\/\/[^/]+$/.test(site.url)) errors.push('site.json: "url" must look like https://example.com (no trailing slash).');
  if (!site.email) warnings.push('site.json: "email" is empty — contact links show a "not configured" notice.');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(site.email)) errors.push(`site.json: "email" is not a valid address: ${site.email}`);
  if (!site.legal?.cvr) warnings.push('site.json: "legal.cvr" is empty — consider adding your CVR number.');

  if (!Array.isArray(apps)) throw new Error('apps.json must contain an array.');
  const seen = new Set();
  const policies = new Map();

  for (const [i, app] of apps.entries()) {
    const where = `apps.json[${i}]${app.slug ? ` (${app.slug})` : ''}`;
    for (const field of ['slug', 'name', 'tagline', 'description', 'icon']) {
      if (!app[field]) errors.push(`${where}: missing required field "${field}".`);
    }
    if (app.slug && !SLUG.test(app.slug)) errors.push(`${where}: slug must be lowercase letters, digits and hyphens.`);
    if (app.tech && !Array.isArray(app.tech)) errors.push(`${where}: "tech" must be a list of strings.`);
    if (!app.sample && !(app.tech || []).length) warnings.push(`${where}: no "tech" list, so the page has no tech stack section.`);
    if (seen.has(app.slug)) errors.push(`${where}: duplicate slug.`);
    seen.add(app.slug);
    if (app.playStoreUrl && !/^https:\/\/play\.google\.com\//.test(app.playStoreUrl)) {
      errors.push(`${where}: playStoreUrl should start with https://play.google.com/`);
    }
    if (!app.playStoreUrl && !app.sample && !app.status) warnings.push(`${where}: playStoreUrl is empty — shown as "Coming soon to Google Play".`);
    if (app.sample) warnings.push(`${where}: is SAMPLE data — replace or remove before going live.`);
    for (const img of [app.icon, ...(app.screenshots ?? []).map((s) => s.src), app.video?.src, app.video?.poster]) {
      if (img && img.startsWith('/') && !fs.existsSync(path.join(PUBLIC, img))) {
        errors.push(`${where}: image not found: public${img}`);
      }
    }

    const policyFile = path.join(CONTENT, 'privacy', `${app.slug}.md`);
    if (!fs.existsSync(policyFile)) {
      errors.push(`${where}: missing privacy policy content/privacy/${app.slug}.md (copy content/privacy/_TEMPLATE.md).`);
      continue;
    }
    const { data, body } = parseFrontMatter(fs.readFileSync(policyFile, 'utf8'));
    if (!DATE.test(String(data.lastUpdated ?? ''))) {
      errors.push(`content/privacy/${app.slug}.md: front matter "lastUpdated" must be YYYY-MM-DD.`);
    }
    if (data.placeholder !== false) {
      warnings.push(`content/privacy/${app.slug}.md: is a PLACEHOLDER — add the real policy and set "placeholder: false".`);
    }
    policies.set(app.slug, { ...data, placeholder: data.placeholder !== false, body });
  }

  for (const file of fs.readdirSync(path.join(CONTENT, 'privacy'))) {
    if (file.endsWith('.md') && !file.startsWith('_') && !seen.has(file.slice(0, -3))) {
      warnings.push(`content/privacy/${file}: no app with this slug in apps.json — file is ignored.`);
    }
  }

  for (const [i, p] of projects.entries()) {
    for (const field of ['name', 'type', 'description']) {
      if (!p[field]) errors.push(`projects.json[${i}]: missing required field "${field}".`);
    }
    for (const img of [p.icon, p.logo]) {
      if (img && img.startsWith('/') && !fs.existsSync(path.join(PUBLIC, img))) {
        errors.push(`projects.json[${i}]: image not found: public${img}`);
      }
    }
  }

  for (const [i, p] of partners.entries()) {
    for (const field of ['name', 'type']) {
      if (!p[field]) errors.push(`partners.json[${i}]: missing required field "${field}".`);
    }
    if (p.url && !/^https?:\/\//.test(p.url)) errors.push(`partners.json[${i}]: url must start with https://`);
    for (const img of [p.icon, p.logo]) {
      if (img && img.startsWith('/') && !fs.existsSync(path.join(PUBLIC, img))) {
        errors.push(`partners.json[${i}]: image not found: public${img}`);
      }
    }
  }

  for (const [i, g] of games.entries()) {
    for (const field of ['slug', 'name', 'tagline', 'description']) {
      if (!g[field]) errors.push(`games.json[${i}]: missing required field "${field}".`);
    }
    if (g.slug && !SLUG.test(g.slug)) errors.push(`games.json[${i}]: slug must be lowercase letters, digits and hyphens.`);
    if (g.tech && !Array.isArray(g.tech)) errors.push(`games.json[${i}]: "tech" must be a list of strings.`);
    if (!(g.tech || []).length) warnings.push(`games.json[${i}] (${g.slug}): no "tech" list, so the page has no tech stack section.`);
    if (g.slug && !fs.existsSync(path.join(PUBLIC, 'games', g.slug, 'game.js'))) {
      errors.push(`games.json[${i}]: missing public/games/${g.slug}/game.js`);
    }
    if (g.icon && g.icon.startsWith('/') && !fs.existsSync(path.join(PUBLIC, g.icon))) {
      errors.push(`games.json[${i}]: image not found: public${g.icon}`);
    }
  }

  if (!Array.isArray(news)) errors.push('news.json must contain an array.');
  for (const [i, n] of (Array.isArray(news) ? news : []).entries()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(n.date || '')) errors.push(`news.json[${i}]: "date" must be YYYY-MM-DD.`);
    if (!n.text) errors.push(`news.json[${i}]: missing "text".`);
    if (n.url && !/^(\/|https:\/\/)/.test(n.url)) errors.push(`news.json[${i}]: url must start with / or https://`);
  }

  for (const [i, t] of tools.entries()) {
    for (const field of ['slug', 'name', 'tagline', 'description', 'icon']) {
      if (!t[field]) errors.push(`tools.json[${i}]: missing required field "${field}".`);
    }
    if (t.slug && !SLUG.test(t.slug)) errors.push(`tools.json[${i}]: slug must be lowercase letters, digits and hyphens.`);
    if (t.tech && !Array.isArray(t.tech)) errors.push(`tools.json[${i}]: "tech" must be a list of strings.`);
    if (t.slug && !fs.existsSync(path.join(CONTENT, 'tools', `${t.slug}.html`))) {
      errors.push(`tools.json[${i}]: missing content/tools/${t.slug}.html`);
    }
    if (t.slug && !fs.existsSync(path.join(PUBLIC, 'tools', t.slug, 'tool.js'))) {
      errors.push(`tools.json[${i}]: missing public/tools/${t.slug}/tool.js`);
    }
    if (t.icon && t.icon.startsWith('/') && !fs.existsSync(path.join(PUBLIC, t.icon))) {
      errors.push(`tools.json[${i}]: image not found: public${t.icon}`);
    }
  }

  return { site, apps, projects, partners, games, tools, news: Array.isArray(news) ? news : [], policies, errors, warnings };
}

/**
 * "Tech stack" section for an app or game page. Each entry in `tech` is either a plain string, or
 * "Name: what it is used for", which is shown with the name in bold.
 */
function techStack(tech) {
  if (!Array.isArray(tech) || !tech.length) return '';
  const items = tech.map((t) => {
    const i = t.indexOf(': ');
    return i === -1 ? `<li>${esc(t)}</li>` : `<li><strong>${esc(t.slice(0, i))}</strong> ${esc(t.slice(i + 2))}</li>`;
  });
  return `<h3>Tech stack</h3>\n      <ul class="tech-list">${items.join('')}</ul>`;
}

/** Maps a games.json entry to the card shape used by projectGrid. */
function gameCard(g) {
  return { name: g.name, type: 'Browser game', status: 'Play now', description: g.tagline, icon: g.icon, url: `/games/${g.slug}/`, linkLabel: 'Play' };
}

/** Cache-busted URL for a file in public/, e.g. a game's script. */
function versioned(url) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(PUBLIC, url))).digest('hex').slice(0, 10);
  return `${url}?v=${hash}`;
}

function gamesIndexPage({ site, games }) {
  return {
    path: '/games/',
    title: 'Games',
    description: `Free browser games by ${site.name}. No ads, no sign-up.`,
    body: `${pageHeader({
      eyebrow: 'Games',
      title: 'Browser games',
      lead: 'Small games that run right here in your browser. No ads, no account, and nothing to install.',
    })}
<section class="section section-tight">
  <div class="container">
    ${projectGrid(games.map(gameCard))}
  </div>
</section>`,
  };
}

function gamePage({ site }, game) {
  const base = `/games/${game.slug}`;
  const has = (file) => fs.existsSync(path.join(PUBLIC, 'games', game.slug, file));
  const styles = has('game.css') ? [`${base}/game.css`] : [];
  // Games with "rankings": true also get the shared helper for anonymous global ranks (public/games/stats.js).
  const scripts = [...(game.rankings && game.relay ? ['/games/stats.js'] : []), ...(has('words.js') ? [`${base}/words.js`] : []), `${base}/game.js`];
  return {
    path: `${base}/`,
    title: game.name,
    description: game.tagline,
    head: styles.map((href) => `<link rel="stylesheet" href="${versioned(href)}">`).join('\n'),
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'VideoGame',
      name: game.name,
      description: game.description,
      url: `${site.url}${base}/`,
      gamePlatform: 'Web browser',
      applicationCategory: 'Game',
      isAccessibleForFree: true,
      author: { '@type': 'Organization', name: site.name, url: site.url },
    },
    body: `<section class="game-shell">
  <div class="container">
    <a class="back-link" href="/games/">${icons.back}All games</a>
    <h1 class="sr-only">${esc(game.name)}</h1>
    <div id="${game.slug}" class="game-root"${game.relay ? ` data-relay="${esc(game.relay)}"` : ''}>
      <noscript><p class="muted">${esc(game.name)} needs JavaScript to run.</p></noscript>
    </div>
  </div>
</section>
<section class="section section-tight">
  <div class="container narrow prose">
    <h2>About ${esc(game.name)}</h2>
    ${paragraphs(game.description)}
    ${techStack(game.tech)}
  </div>
</section>
${scripts.map((src) => `<script src="${versioned(src)}" defer></script>`).join('\n')}`,
  };
}

/**
 * The secret page a game links to when it is won ("vault": true in games.json), e.g. /games/breach/vault/.
 * It lists SRATH's real projects from the content files, so it never needs updating by hand.
 * Hidden from search engines and the sitemap, and not linked from anywhere else.
 */
function vaultPage({ site, apps, projects, games }, game) {
  const cards = [
    ...projects,
    ...apps.map((app) => ({ name: app.name, type: 'Android app', status: app.status || (app.playStoreUrl ? 'On Google Play' : 'Coming soon'), description: app.tagline, icon: app.icon, url: `/apps/${app.slug}/`, linkLabel: 'App details' })),
    ...games.filter((g) => g.slug !== game.slug).map(gameCard),
  ];
  return {
    path: `/games/${game.slug}/vault/`,
    title: 'Vault',
    description: `You found the access key in ${game.name}.`,
    noindex: true,
    body: `${pageHeader({
      eyebrow: `${esc(game.name)} · Vault`,
      title: 'Access granted',
      lead: `You found the access key and broke into the vault. Behind the door: everything ${esc(site.name)} has built so far.`,
    })}
<section class="section section-tight">
  <div class="container">
    ${projectGrid(cards)}
  </div>
</section>
<section class="section section-tight">
  <div class="container narrow prose">
    <h2>Who built this</h2>
    ${renderMarkdown(site.about || '').html}
    <p>Every project here, including ${esc(game.name)}, is designed and built by ${esc(site.legal.owner || site.name)}. ${site.email ? `Say hello at ${emailLink(site)}.` : ''}</p>
    <p><a class="text-link" href="/games/${game.slug}/">${icons.back} Back to the terminal</a></p>
  </div>
</section>`,
  };
}

/** Maps a partners.json entry to the card shape used by projectGrid. */
/** Maps a tools.json entry to the card shape used by projectGrid, in Danish or English. */
function toolCard(t, lang = 'da') {
  const en = lang === 'en';
  return {
    name: en ? t.name_en || t.name : t.name,
    type: en ? 'Free tool' : 'Gratis værktøj',
    status: en ? 'Use now' : 'Brug nu',
    description: en ? t.tagline_en || t.tagline : t.tagline,
    icon: t.icon,
    url: `/tools/${t.slug}/${en ? '?lang=en' : ''}`,
    linkLabel: en ? 'Open' : 'Åbn',
  };
}

const TOOLS_DISCLAIMER = {
  da: 'Beregningerne er vejledende og erstatter ikke rådgivning fra en revisor eller Skattestyrelsen.',
  en: 'The calculations are a guide and do not replace advice from an accountant or the Danish Tax Agency.',
};

/** Text in both languages: Danish is shown by default, /tools/tools.js swaps to English. */
function bi(da, en, tag = 'span', attrs = '') {
  return `<${tag}${attrs} data-en="${esc(en)}">${esc(da)}</${tag}>`;
}
/** Two versions of a block; /tools/tools.js shows the one for the chosen language. */
function biBlock(da, en, tag = 'div', cls = '') {
  return `<${tag}${cls ? ` class="${cls}"` : ''} data-lang="da" lang="da">${da}</${tag}>\n<${tag}${cls ? ` class="${cls}"` : ''} data-lang="en" lang="en" hidden>${en}</${tag}>`;
}

const FLAG_DK = '<svg class="lang-flag" viewBox="0 0 37 28" aria-hidden="true"><rect width="37" height="28" fill="#c8102e"/><rect x="12" width="4" height="28" fill="#fff"/><rect y="12" width="37" height="4" fill="#fff"/></svg>';
const FLAG_GB = '<svg class="lang-flag" viewBox="0 0 60 30" aria-hidden="true"><clipPath id="gb-c"><path d="M0 0v30h60V0z"/></clipPath><clipPath id="gb-t"><path d="M30 15h30v15zv15H0zH0V0zV0h30z"/></clipPath><g clip-path="url(#gb-c)"><path d="M0 0v30h60V0z" fill="#012169"/><path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0l60 30m0-30L0 30" clip-path="url(#gb-t)" stroke="#c8102e" stroke-width="4"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#c8102e" stroke-width="6"/></g></svg>';

/** The big Dansk / English switch at the top of every tools page. */
function langSwitch(site, titleDa, titleEn) {
  return `<div class="lang-switch" role="group" aria-label="Sprog / Language" data-title-da="${esc(`${titleDa} · ${site.name}`)}" data-title-en="${esc(`${titleEn} · ${site.name}`)}">
      <button type="button" data-set-lang="da" aria-pressed="true" lang="da">${FLAG_DK}<span>Dansk</span></button>
      <button type="button" data-set-lang="en" aria-pressed="false" lang="en">${FLAG_GB}<span>English</span></button>
    </div>`;
}

function toolsIndexPage({ site, tools }) {
  const titleDa = 'Gratis værktøjer til freelancere og selvstændige';
  const titleEn = 'Free tools for freelancers and the self-employed';
  return {
    path: '/tools/',
    lang: 'da',
    title: titleDa,
    description: 'Gratis timeprisberegner, faktura- og tilbudsgenerator og CVR-opslag på dansk og engelsk. Ingen login, ingen cookies, og dine tal bliver i din browser.',
    head: `<link rel="stylesheet" href="${versioned('/tools/tools.css')}">`,
    body: `<section class="page-header">
  <div class="container">
    <div class="tool-topbar">
      <a class="back-link" href="/">${icons.back}${bi('Forside', 'Home')}</a>
      ${langSwitch(site, titleDa, titleEn)}
    </div>
    <h1>${bi(titleDa, titleEn)}</h1>
    <p class="lead">${bi(
      'Små værktøjer til dig med enkeltmandsvirksomhed eller freelancearbejde i Danmark. De kører i din browser: ingen login, ingen cookies, og dine tal bliver hos dig.',
      'Small tools for sole traders and freelancers in Denmark. They run in your browser: no sign-up, no cookies, and your numbers stay with you.',
    )}</p>
  </div>
</section>
<section class="section section-tight">
  <div class="container">
    ${biBlock(projectGrid(tools.map((t) => toolCard(t, 'da'))), projectGrid(tools.map((t) => toolCard(t, 'en'))))}
    <p class="muted small tools-disclaimer">${bi(TOOLS_DISCLAIMER.da, TOOLS_DISCLAIMER.en)}</p>
  </div>
</section>
<script src="${versioned('/tools/tools.js')}" defer></script>`,
  };
}

function toolPage({ site, tools }, tool) {
  const base = `/tools/${tool.slug}`;
  const markup = fs.readFileSync(path.join(CONTENT, 'tools', `${tool.slug}.html`), 'utf8');
  const others = tools.filter((t) => t.slug !== tool.slug);
  const nameEn = tool.name_en || tool.name;
  const about = (lang) => {
    const en = lang === 'en';
    return `<h2>${en ? `About the ${esc(nameEn.charAt(0).toLowerCase() + nameEn.slice(1))}` : `Om ${esc(tool.name.toLowerCase())}`}</h2>
    ${paragraphs(en ? tool.description_en || tool.description : tool.description)}
    ${techStack(en ? tool.tech_en || tool.tech : tool.tech).replace('<h3>Tech stack</h3>', en ? '<h3>How it is built</h3>' : '<h3>Sådan er det bygget</h3>')}
    <p class="muted small">${TOOLS_DISCLAIMER[lang]}</p>`;
  };
  return {
    path: `${base}/`,
    lang: 'da',
    title: tool.name,
    description: tool.tagline,
    head: `<link rel="stylesheet" href="${versioned('/tools/tools.css')}">`,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: tool.name,
      alternateName: nameEn,
      description: tool.tagline,
      url: `${site.url}${base}/`,
      inLanguage: ['da', 'en'],
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web browser',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'DKK' },
      author: { '@type': 'Organization', name: site.name, url: site.url },
    },
    body: `<section class="tool-shell">
  <div class="container">
    <div class="tool-topbar">
      <a class="back-link" href="/tools/">${icons.back}${bi('Alle værktøjer', 'All tools')}</a>
      ${langSwitch(site, tool.name, nameEn)}
    </div>
    <h1 class="tool-title">${bi(tool.name, nameEn)}</h1>
    <p class="lead tool-lead">${bi(tool.tagline, tool.tagline_en || tool.tagline)}</p>
    <div id="tool" class="tool-root" data-tool="${esc(tool.slug)}">
${markup.trim()}
    </div>
  </div>
</section>
<section class="section section-tight tool-about">
  <div class="container narrow">
    ${biBlock(about('da'), about('en'), 'div', 'prose')}
  </div>
</section>
${others.length ? `<section class="section section-tight section-alt tool-more">
  <div class="container">
    <h2 class="h3">${bi('Flere gratis værktøjer', 'More free tools')}</h2>
    ${biBlock(projectGrid(others.map((t) => toolCard(t, 'da'))), projectGrid(others.map((t) => toolCard(t, 'en'))))}
  </div>
</section>` : ''}
<script src="${versioned('/tools/tools.js')}" defer></script>
<script src="${versioned(`${base}/tool.js`)}" defer></script>`,
  };
}

function partnerCard(p) {
  return {
    ...p,
    status: p.project,
    linkLabel: p.linkLabel || (p.url ? new URL(p.url).hostname.replace(/^www\./, '') : ''),
  };
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

// The newest news item, as a slim banner above the hero, while it is recent. main.js also hides it
// once it is older than NEWS_DAYS, so it disappears even if the site isn't rebuilt for a while.
const NEWS_DAYS = 30;
function newsBanner(news) {
  const latest = news.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!latest) return '';
  const age = (Date.now() - Date.parse(`${latest.date}T00:00:00Z`)) / 86400000;
  if (age > NEWS_DAYS) return '';
  const inner = `<span class="news-label">New</span>
      <time class="news-date" datetime="${esc(latest.date)}">${esc(formatDate(latest.date))}</time>
      <span class="news-text">${esc(latest.text)}</span>${latest.url ? ` <span class="news-arrow">${icons.arrow}</span>` : ''}`;
  const external = latest.url && latest.url.startsWith('https://') ? ' rel="noopener noreferrer"' : '';
  return `<aside class="news-bar" aria-label="Latest news" data-date="${esc(latest.date)}" data-days="${NEWS_DAYS}">
  <div class="container">
    ${latest.url ? `<a class="news-item" href="${esc(latest.url)}"${external}>${inner}</a>` : `<p class="news-item">${inner}</p>`}
  </div>
</aside>
`;
}

/** Data for the hero workbench (/bench.js): true facts for the magnifying glass's tiny print. */
function benchData({ site, apps, tools, games }) {
  const notes = [
    ...apps.map((a) => `${a.name}: ${a.tagline}`),
    ...tools.map((t) => `${t.name}: ${t.tagline}`),
    ...games.map((g) => `${g.name}: ${g.tagline}`),
    ...(site.legal.cvr ? [`CVR ${site.legal.cvr}`] : []),
    'Danish VAT: add 25 % to a price, or take 20 % out of a total',
    'Sole proprietorship, registered in Denmark',
    'Built after work, in spare time',
    'This website has no cookies and no tracking',
    'BREACH://: type help to begin',
  ];
  return { notes };
}

/** One row in "What I'm working on". `quiet` greys out the status (not launched yet). */
function workRow({ kind, name, desc, status, url, quiet = false }) {
  const external = /^https?:\/\//.test(url || '');
  const name_ = url
    ? `<a class="work-name" href="${esc(url)}"${external ? ' rel="noopener noreferrer"' : ''}>${esc(name)}</a>`
    : `<span class="work-name">${esc(name)}</span>`;
  return `<li class="work-row">
        <span class="work-kind">${esc(kind)}</span>
        <div>${name_}<p class="work-desc">${esc(desc)}</p></div>
        <span class="work-status${quiet ? ' is-quiet' : ''}">${esc(status)}${url ? (external ? ' ↗' : ' →') : ''}</span>
      </li>`;
}

function homePage({ site, apps, projects, partners, games, tools, news }) {
  const live = apps.filter((a) => a.playStoreUrl);
  const coming = apps.filter((a) => !a.playStoreUrl);
  const appRow = (app) => workRow({
    kind: 'Android app',
    name: app.name,
    desc: app.tagline,
    status: app.playStoreUrl ? 'On Google Play' : app.status || 'Coming soon',
    url: `/apps/${app.slug}/`,
    quiet: !app.playStoreUrl,
  });
  const rows = [
    ...live.map(appRow),
    ...(tools.length ? [workRow({
      kind: 'Free tools',
      name: 'Tools for freelancers in Denmark',
      desc: `${tools.map((t) => t.name_en || t.name).join(', ')}. In Danish and English.`,
      status: 'Use them',
      url: '/tools/',
    })] : []),
    ...coming.map(appRow),
    ...projects.map((p) => workRow({
      kind: p.type,
      name: p.name,
      desc: p.description,
      status: p.status || p.linkLabel || 'Visit',
      url: p.url,
      quiet: Boolean(p.status && /soon|coming/i.test(p.status)),
    })),
    ...(games.length ? [workRow({
      kind: 'Browser games',
      name: games.length === 1 ? 'A browser game' : `${['', '', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'][games.length] || games.length} small browser games`,
      desc: games.map((g) => g.name).join(', '),
      status: 'Play',
      url: '/games/',
    })] : []),
  ];
  const facts = [
    site.legal.owner && ['Owner', esc(site.legal.owner)],
    ['Business type', 'Sole proprietorship'],
    ['Country', esc(site.legal.country)],
    site.legal.cvr && ['CVR', esc(site.legal.cvr)],
  ].filter(Boolean);

  return {
    path: '/',
    title: site.name,
    description: site.description,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: site.name,
      url: site.url,
      ...(site.email && { email: site.email }),
      address: { '@type': 'PostalAddress', addressCountry: 'DK' },
      ...(site.legal.cvr && { vatID: `DK${site.legal.cvr}` }),
      ...(site.legal.owner && {
        founder: { '@type': 'Person', name: site.legal.owner, ...(site.linkedin && { sameAs: [site.linkedin] }) },
      }),
    },
    body: `${newsBanner(news)}<section class="hero" data-bench="${esc(JSON.stringify(benchData({ site, apps, tools, games })))}">
  <div class="container hero-inner">
    <h1 class="hero-title">I build apps and tools after work. <span class="accent">Some of them ship.</span></h1>
    <p class="label hero-byline">${esc(site.legal.owner || site.name)} · software developer · ${esc(site.legal.country)}</p>
    <p class="lead">${esc(site.name)} is my sole proprietorship. It's where my Android apps live, along with free tools for freelancers in Denmark, a few browser games and Baiganyo, a webshop I'm opening.</p>
    <div class="actions">
      <a class="btn btn-primary" href="#projects">See what I've made</a>
      ${site.email ? emailLink(site, { className: 'btn btn-ghost', label: 'Email me' }) : '<a class="btn btn-ghost" href="/contact/">Contact</a>'}
    </div>
  </div>
</section>

<section class="section" id="projects" aria-labelledby="projects-heading">
  <div class="container">
    <h2 id="projects-heading">What I'm working on</h2>
    <ul class="work-list">
      ${rows.join('\n      ')}
    </ul>
  </div>
</section>
${partners.length ? `
<section class="section section-tight" aria-labelledby="partners-heading">
  <div class="container">
    <div class="section-head">
      <h2 id="partners-heading">Suppliers and partners</h2>
      <a class="text-link" href="/partners/">All partners ${icons.arrow}</a>
    </div>
    ${projectGrid(partners.slice(0, 6).map(partnerCard))}
  </div>
</section>
` : ''}
<section class="section section-alt" aria-labelledby="about-heading">
  <div class="container about">
    <div class="prose">
      <h2 id="about-heading">About me</h2>
      ${renderMarkdown(site.about || '').html}
    </div>
    <aside class="card info-card" aria-label="Business details">
      <h3 class="info-title">Business details</h3>
      <dl class="info-list">
        ${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('\n        ')}
      </dl>
      ${site.linkedin ? `<a class="btn btn-ghost about-link" href="${esc(site.linkedin)}" rel="noopener noreferrer me">${icons.linkedin}LinkedIn profile</a>` : ''}
    </aside>
  </div>
</section>

<section class="section" aria-labelledby="contact-heading">
  <div class="container">
    <div class="card cta">
      <div>
        <h2 id="contact-heading">Write to me</h2>
        <p class="muted">A question about an app, the tools or the webshop, or something else entirely? Send me an email.</p>
      </div>
      <div class="cta-actions">
        ${site.email ? emailLink(site, { className: 'btn btn-primary', label: `${icons.mail}${esc(site.email)}` }) : '<a class="btn btn-primary" href="/contact/">Contact</a>'}
      </div>
    </div>
  </div>
</section>
<script src="${versioned('/bench.js')}" defer></script>`,
  };
}

function appsIndexPage({ site, apps }) {
  return {
    path: '/apps/',
    title: 'Apps',
    description: `Mobile applications developed and published by ${site.name} on Google Play.`,
    body: `${pageHeader({
      eyebrow: 'Applications',
      title: 'Apps',
      lead: `Mobile applications developed and published by ${esc(site.name)}. Each app links to its Google Play listing, privacy policy and support contact.`,
    })}
<section class="section section-tight">
  <div class="container">
    ${appGrid(apps)}
  </div>
</section>`,
  };
}

function appPage({ site }, app, policy) {
  const screenshots = app.screenshots ?? [];
  const features = app.features ?? [];
  const info = [
    ['Developer', esc(site.name)],
    ['Platform', 'Android'],
    app.category && ['Category', esc(app.category)],
    app.packageName && ['Package', `<code>${esc(app.packageName)}</code>`],
    policy && ['Privacy policy', `<a href="/privacy/${app.slug}/">Updated ${esc(formatDate(policy.lastUpdated))}</a>`],
  ].filter(Boolean);

  return {
    path: `/apps/${app.slug}/`,
    title: app.name,
    description: app.tagline,
    noindex: app.sample,
    jsonLd: app.sample ? null : {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: app.name,
      description: app.tagline,
      operatingSystem: 'Android',
      ...(app.category && { applicationCategory: app.category }),
      ...(app.playStoreUrl && { installUrl: app.playStoreUrl }),
      author: { '@type': 'Organization', name: site.name, url: site.url },
    },
    body: `<section class="page-header app-hero">
  <div class="container">
    <a class="back-link" href="/apps/">${icons.back}All apps</a>
    <div class="app-hero-inner">
      <img class="app-icon app-icon-lg" src="${esc(app.icon)}" alt="${esc(app.name)} icon" width="112" height="112">
      <div>
        <h1>${esc(app.name)} ${sampleBadge(app)}</h1>
        <p class="lead">${esc(app.tagline)}</p>
        <div class="actions">
          ${playButton(app)}
          <a class="btn btn-ghost" href="/privacy/${app.slug}/">${icons.shield}Privacy policy</a>
          ${site.email ? emailLink(site, { subject: `Support: ${app.name}`, className: 'btn btn-ghost', label: `${icons.mail}Support` }) : ''}
        </div>
      </div>
    </div>
  </div>
</section>
${screenshots.length || app.video ? `<section class="section section-tight" aria-label="Screenshots">
  <div class="container">
    <div class="screenshots" tabindex="0" aria-label="Screenshots, scrollable">
      ${app.video ? `<video class="screenshot-video" src="${esc(app.video.src)}"${app.video.poster ? ` poster="${esc(app.video.poster)}"` : ''} width="270" height="480" autoplay muted loop playsinline controls preload="metadata" aria-label="${esc(app.video.alt || `${app.name} video`)}"></video>` : ''}
      ${screenshots.map((s) => `<img src="${esc(s.src)}" alt="${esc(s.alt || `${app.name} screenshot`)}" width="240" height="520" loading="lazy" decoding="async">`).join('\n      ')}
    </div>
  </div>
</section>` : ''}
<section class="section section-tight">
  <div class="container app-body">
    <div class="prose">
      <h2>About ${esc(app.name)}</h2>
      ${paragraphs(app.description)}
      ${features.length ? `<h3>Features</h3>\n      <ul class="check-list">${features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      ${techStack(app.tech)}
    </div>
    <aside class="card info-card" aria-label="App information">
      <h2 class="info-title">Information</h2>
      <dl class="info-list">
        ${info.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('\n        ')}
      </dl>
      <h2 class="info-title">Support</h2>
      <p class="small muted">Questions, bug reports or data requests for ${esc(app.name)}:</p>
      <p class="small">${emailLink(site, { subject: `Support: ${app.name}` })}</p>
    </aside>
  </div>
</section>`,
  };
}

function privacyIndexPage({ site, apps, policies, games, tools }) {
  const rows = apps.map((app) => {
    const policy = policies.get(app.slug);
    return `<li class="card policy-row">
      <img class="app-icon" src="${esc(app.icon)}" alt="" width="44" height="44" loading="lazy">
      <div class="policy-row-text">
        <a class="policy-row-link" href="/privacy/${app.slug}/">${esc(app.name)} — Privacy policy</a>
        <span class="small muted">${policy ? `Last updated ${esc(formatDate(policy.lastUpdated))}` : ''}${policy?.placeholder ? ' · <span class="badge badge-warn">Placeholder</span>' : ''}</span>
      </div>
      ${icons.arrow}
    </li>`;
  });

  return {
    path: '/privacy/',
    title: 'Privacy',
    description: `Privacy policies for apps published by ${site.name}, and privacy information for this website.`,
    body: `${pageHeader({
      eyebrow: 'Legal',
      title: 'Privacy',
      lead: 'Every app has its own privacy policy with a permanent address. Select an app to read its policy.',
    })}
<section class="section section-tight" aria-labelledby="app-policies">
  <div class="container narrow">
    <h2 id="app-policies" class="sr-only">App privacy policies</h2>
    ${rows.length ? `<ul class="policy-list">\n    ${rows.join('\n    ')}\n    </ul>` : '<p class="muted">No policies yet.</p>'}
  </div>
</section>
<section class="section section-tight" aria-labelledby="website">
  <div class="container narrow prose">
    <h2 id="website">This website</h2>
    <p>This website does not use cookies, analytics, advertising or other tracking scripts, and it does not load fonts or other resources from third parties${tools.some((t) => t.slug === 'cvr-opslag') ? ' (the one exception is the CVR lookup, described below)' : ''}.</p>
    ${games.length ? '<p>The browser games save your progress and statistics in your own browser (local storage) so you can continue where you left off. You can delete it by clearing the site data for srath.dk in your browser.</p>\n' : ''}    <p>The website is hosted on GitHub Pages, a service provided by GitHub, Inc. When you visit the site, GitHub processes technical information such as your IP address in order to deliver the pages and keep the service secure. See the <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" rel="noopener noreferrer">GitHub General Privacy Statement</a> for details.</p>
    ${games.some((g) => g.relay) ? `<p id="online-games">Some games can be played online with other people. Only when you create or join an online game, your browser connects to a small relay that runs on Cloudflare Workers, a service provided by Cloudflare, Inc. Cloudflare processes technical information such as your IP address in order to deliver the connection and keep the service secure. The relay only passes game messages between the players in the same game: steering, positions, and the name and colour each player chooses in the lobby. It does not store them, and there are no accounts or chat. The name you type is also remembered in your own browser for next time. Other players do not see your IP address. See the <a href="https://www.cloudflare.com/privacypolicy/" rel="noopener noreferrer">Cloudflare Privacy Policy</a> for details.</p>
    <p id="game-rankings">When you finish Gridword or BREACH://, your result is sent to the same Cloudflare service so the game can show how you rank against other players: for Gridword the number of guesses, your solving time and your streak; for BREACH:// your time and number of commands. Only anonymous counts are stored (for example, how many players solved today's Gridword in four guesses), never anything that identifies you: no names, no IP addresses and no device identifiers. Your IP address is processed by Cloudflare to deliver the request and is held briefly in memory to limit abuse. Gridword's daily counts are deleted two days later.</p>
` : ''}${tools.length ? `    <p id="tools">The free tools under <a href="/tools/">/tools/</a> do their calculations in your own browser. Nothing you type is sent to ${esc(site.name)}. The invoice and quote generator can remember your own business details and the next invoice number in your browser (local storage), but only if you tick "Husk mine oplysninger" ("Remember my details"); untick it to delete them.</p>
` : ''}${tools.some((t) => t.slug === 'cvr-opslag') ? `    <p id="cvr-lookup">Only when you search in the CVR lookup, your browser sends the search text directly to CVR API (cvrapi.dk), an independent service that provides data from the Danish Central Business Register. CVR API processes technical information such as your IP address in order to answer the request and to enforce its daily limit on free lookups. ${esc(site.name)} does not receive or store your searches.</p>
` : ''}    <p>If you contact ${esc(site.name)} by email, your message and address are used only to respond to your enquiry. Contact: ${emailLink(site)}.</p>
  </div>
</section>`,
  };
}

function privacyPage({ site }, app, policy) {
  const vars = {
    appName: app.name,
    developerName: site.name,
    contactEmail: site.email ? `<${site.email}>` : '[contact email not configured]',
    lastUpdated: formatDate(policy.lastUpdated),
    websiteUrl: site.url,
  };
  const source = policy.body.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => (key in vars ? vars[key] : m));
  const { html, headings } = renderMarkdown(source);
  const toc = headings.filter((h) => h.level === 2);

  return {
    path: `/privacy/${app.slug}/`,
    title: `Privacy policy — ${app.name}`,
    description: `Privacy policy for the ${app.name} app by ${site.name}.`,
    noindex: policy.placeholder || app.sample,
    body: `<article>
  <header class="page-header">
    <div class="container narrow">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/privacy/">Privacy</a><span aria-hidden="true">/</span><a href="/apps/${app.slug}/">${esc(app.name)}</a></nav>
      <h1>Privacy policy</h1>
      <p class="lead">${esc(app.name)} · ${esc(site.name)}</p>
      <p class="meta"><span>Last updated: <time datetime="${esc(policy.lastUpdated)}">${esc(formatDate(policy.lastUpdated))}</time></span></p>
    </div>
  </header>
  <div class="container narrow">
    ${policy.placeholder ? `<div class="notice notice-warn" role="note"><strong>Placeholder.</strong> This page does not yet contain the actual privacy policy for ${esc(app.name)}.</div>` : ''}
    ${toc.length >= 3 ? `<nav class="toc card" aria-label="Contents"><h2 class="toc-title">Contents</h2><ol>${toc.map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ol></nav>` : ''}
    <div class="prose policy">
${html}
    </div>
    <div class="policy-footer">
      <a class="btn btn-ghost" href="/apps/${app.slug}/">${icons.back}Back to ${esc(app.name)}</a>
      <a class="btn btn-ghost" href="/privacy/">All privacy policies</a>
    </div>
  </div>
</article>`,
  };
}

function partnersPage({ site, partners }) {
  // Group by project (e.g. "Baiganyo"), keeping the order of partners.json.
  const groups = new Map();
  for (const p of partners) {
    const key = p.project || 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const sections = [...groups].map(([name, list], i) => `<section class="section section-tight" aria-labelledby="partners-${i}">
  <div class="container">
    <h2 id="partners-${i}" class="h3">${esc(name)}</h2>
    ${projectGrid(list.map(partnerCard))}
  </div>
</section>`);

  return {
    path: '/partners/',
    title: 'Partners',
    description: `Suppliers and partners that ${site.name} works with.`,
    noindex: !partners.length,
    body: `${pageHeader({
      eyebrow: 'Partners',
      title: 'Suppliers and partners',
      lead: `Companies ${esc(site.name)} works with, including suppliers for the Baiganyo webshop.`,
    })}
${sections.length ? sections.join('\n') : `<section class="section section-tight">
  <div class="container"><p class="muted">Partners will be listed here soon.</p></div>
</section>`}
<section class="section section-tight">
  <div class="container">
    <p class="muted small">Interested in working together? Email ${emailLink(site, { subject: 'Partnership' })}.</p>
  </div>
</section>`,
  };
}

function contactPage({ site, apps }) {
  const legal = [
    ['Business name', esc(site.name)],
    site.legal.owner && ['Owner', esc(site.legal.owner)],
    ['Business type', esc(site.legal.businessType)],
    ['Country', esc(site.legal.country)],
    site.legal.cvr && ['CVR', esc(site.legal.cvr)],
    site.legal.address && ['Address', esc(site.legal.address)],
    ['Email', emailLink(site)],
  ].filter(Boolean);

  return {
    path: '/contact/',
    title: 'Contact',
    description: `Contact ${site.name} for app support, privacy enquiries or business matters.`,
    body: `${pageHeader({
      eyebrow: 'Contact',
      title: 'Get in touch',
      lead: `Email is the best way to reach ${esc(site.name)} for app support, privacy enquiries and business matters.`,
    })}
<section class="section section-tight">
  <div class="container contact-grid">
    <div class="card contact-card">
      <span class="feature-icon">${icons.mail}</span>
      <h2>Email</h2>
      <p class="contact-email">${emailLink(site)}</p>
      <p class="muted small">If your message concerns a specific app, please include the app name and, for bug reports, your device model and Android version.</p>
    </div>
    <div class="card contact-card">
      <span class="feature-icon">${icons.shield}</span>
      <h2>Privacy requests</h2>
      <p class="muted small">To exercise your rights under the GDPR for one of the apps, email the address above with the app name in the subject. Each app's privacy policy describes what applies to it.</p>
      <p class="small"><a class="text-link" href="/privacy/">Privacy policies ${icons.arrow}</a></p>
    </div>
  </div>
</section>
${apps.length ? `<section class="section section-tight" aria-labelledby="app-support">
  <div class="container">
    <h2 id="app-support" class="h3">App support</h2>
    <ul class="chip-list">
      ${apps.map((a) => `<li>${site.email ? emailLink(site, { subject: `Support: ${a.name}`, className: 'chip', label: esc(a.name) }) : `<a class="chip" href="/apps/${a.slug}/">${esc(a.name)}</a>`}</li>`).join('\n      ')}
    </ul>
  </div>
</section>` : ''}
<section class="section section-tight" aria-labelledby="business">
  <div class="container narrow">
    <div class="card">
      <h2 id="business" class="h3">Business information</h2>
      <dl class="info-list">
        ${legal.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('\n        ')}
      </dl>
    </div>
  </div>
</section>`,
  };
}

function notFoundPage() {
  return {
    path: '/404.html',
    title: 'Page not found',
    description: 'The page you were looking for could not be found.',
    noindex: true,
    body: `${pageHeader({
      eyebrow: '404',
      title: 'Page not found',
      lead: 'The page you were looking for does not exist or has moved.',
      extra: `<div class="actions"><a class="btn btn-primary" href="/">Home ${icons.arrow}</a><a class="btn btn-ghost" href="/apps/">Apps</a></div>`,
    })}`,
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function publishAsset(file) {
  const src = fs.readFileSync(path.join(ROOT, 'src', file));
  fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'assets', file), src);
  const hash = crypto.createHash('sha256').update(src).digest('hex').slice(0, 10);
  return `/assets/${file}?v=${hash}`;
}

function writePage(page, ctx) {
  const html = layout({ ...ctx, ...page });
  const out = page.path.endsWith('.html')
    ? path.join(DIST, page.path)
    : path.join(DIST, page.path, 'index.html');
  if (fs.existsSync(out)) throw new Error(`Generated page collides with a file in public/: ${page.path}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
}

function sitemap(site, pages) {
  const urls = pages
    .filter((p) => !p.noindex && !p.path.endsWith('.html'))
    .map((p) => `  <url><loc>${esc(site.url + p.path)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function build({ quiet = false } = {}) {
  const started = Date.now();
  const content = loadContent();
  const log = quiet ? () => {} : console.log;

  if (content.errors.length) {
    const err = new Error(`Content errors:\n  - ${content.errors.join('\n  - ')}`);
    err.contentErrors = content.errors;
    throw err;
  }

  fs.rmSync(DIST, { recursive: true, force: true });
  // public/ is copied byte-for-byte; nothing in it is ever transformed (app-ads.txt depends on this).
  fs.cpSync(PUBLIC, DIST, { recursive: true });

  const assets = { css: publishAsset('styles.css'), js: publishAsset('main.js') };
  const ctx = { site: content.site, assets, hasPartners: content.partners.length > 0, hasGames: content.games.length > 0, hasTools: content.tools.length > 0 };

  const pages = [
    homePage(content),
    appsIndexPage(content),
    ...content.apps.map((app) => appPage(content, app, content.policies.get(app.slug))),
    privacyIndexPage(content),
    ...content.apps.map((app) => privacyPage(content, app, content.policies.get(app.slug))),
    ...(content.games.length ? [gamesIndexPage(content), ...content.games.map((g) => gamePage(content, g))] : []),
    ...content.games.filter((g) => g.vault).map((g) => vaultPage(content, g)),
    ...(content.tools.length ? [toolsIndexPage(content), ...content.tools.map((t) => toolPage(content, t))] : []),
    partnersPage(content),
    contactPage(content),
    notFoundPage(),
  ];
  for (const page of pages) writePage(page, ctx);
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap(content.site, pages));

  // Guard: app-ads.txt in dist must be identical to the source file.
  const adsSrc = fs.readFileSync(path.join(PUBLIC, 'app-ads.txt'));
  const adsOut = fs.readFileSync(path.join(DIST, 'app-ads.txt'));
  if (!adsSrc.equals(adsOut)) throw new Error('dist/app-ads.txt differs from public/app-ads.txt');

  for (const w of content.warnings) log(`  warning: ${w}`);
  log(`Built ${pages.length} pages into dist/ in ${Date.now() - started} ms.`);
  return { pages, warnings: content.warnings };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    build();
  } catch (err) {
    console.error(`\nBuild failed.\n${err.message}\n`);
    process.exit(1);
  }
}
