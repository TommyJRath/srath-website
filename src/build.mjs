// Static site generator for srath.dk. No dependencies: run with `node src/build.mjs`.
//
//   content/site.json        business details and contact email
//   content/apps.json        one entry per application
//   content/projects.json    other projects on the home page (apps are added automatically)
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
    if (seen.has(app.slug)) errors.push(`${where}: duplicate slug.`);
    seen.add(app.slug);
    if (app.playStoreUrl && !/^https:\/\/play\.google\.com\//.test(app.playStoreUrl)) {
      errors.push(`${where}: playStoreUrl should start with https://play.google.com/`);
    }
    if (!app.playStoreUrl && !app.sample) warnings.push(`${where}: playStoreUrl is empty — shown as "Coming soon to Google Play".`);
    if (app.sample) warnings.push(`${where}: is SAMPLE data — replace or remove before going live.`);
    for (const img of [app.icon, ...(app.screenshots ?? []).map((s) => s.src)]) {
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

  return { site, apps, projects, policies, errors, warnings };
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function homePage({ site, apps, projects }) {
  const cards = [
    ...projects,
    ...apps.map((app) => ({
      name: app.name,
      type: 'Android app',
      status: app.playStoreUrl ? 'On Google Play' : 'Coming soon',
      description: app.tagline,
      icon: app.icon,
      url: `/apps/${app.slug}/`,
      linkLabel: 'App details',
      sample: app.sample,
    })),
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
    body: `<section class="hero">
  <div class="hero-bg" aria-hidden="true"></div>
  <div class="hero-spot" aria-hidden="true"></div>
  <div class="container hero-inner">
    <p class="eyebrow enter">${esc(site.name)} · ${esc(site.legal.country)}</p>
    <h1 class="hero-title enter">A small business for <span class="gradient-text">independent projects</span>.</h1>
    <p class="lead enter">${esc(site.name)} is the Danish sole proprietorship of ${esc(site.legal.owner || site.name)}: the home of the upcoming webshop Baiganyo and of Android apps built in spare time.</p>
    <div class="actions enter">
      <a class="btn btn-primary" href="#projects">See projects ${icons.arrow}</a>
      <a class="btn btn-ghost" href="/contact/">Get in touch</a>
    </div>
  </div>
</section>

<section class="section" id="projects" aria-labelledby="projects-heading">
  <div class="container">
    <div class="section-head">
      <div>
        <p class="eyebrow">Projects</p>
        <h2 id="projects-heading">What ${esc(site.name)} is working on</h2>
      </div>
    </div>
    ${projectGrid(cards)}
  </div>
</section>

<section class="section section-alt" aria-labelledby="about-heading">
  <div class="container about">
    <div class="prose">
      <p class="eyebrow">About</p>
      <h2 id="about-heading">The person behind ${esc(site.name)}</h2>
      ${renderMarkdown(site.about || '').html}
    </div>
    <aside class="card info-card reveal" aria-label="Business details">
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
    <div class="card cta reveal">
      <div>
        <h2 id="contact-heading">Get in touch</h2>
        <p class="muted">Questions about the webshop, an app or anything else? Send an email.</p>
      </div>
      <div class="cta-actions">
        ${site.email ? emailLink(site, { className: 'btn btn-primary', label: `${icons.mail}${esc(site.email)}` }) : '<a class="btn btn-primary" href="/contact/">Contact</a>'}
      </div>
    </div>
  </div>
</section>`,
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
${screenshots.length ? `<section class="section section-tight" aria-label="Screenshots">
  <div class="container">
    <div class="screenshots" tabindex="0" aria-label="Screenshots, scrollable">
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

function privacyIndexPage({ site, apps, policies }) {
  const rows = apps.map((app) => {
    const policy = policies.get(app.slug);
    return `<li class="card policy-row reveal">
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
    <p>This website does not use cookies, analytics, advertising or other tracking scripts, and it does not load fonts or other resources from third parties.</p>
    <p>The website is hosted on GitHub Pages, a service provided by GitHub, Inc. When you visit the site, GitHub processes technical information such as your IP address in order to deliver the pages and keep the service secure. See the <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" rel="noopener noreferrer">GitHub General Privacy Statement</a> for details.</p>
    <p>If you contact ${esc(site.name)} by email, your message and address are used only to respond to your enquiry. Contact: ${emailLink(site)}.</p>
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
    <div class="card contact-card reveal">
      <span class="feature-icon">${icons.mail}</span>
      <h2>Email</h2>
      <p class="contact-email">${emailLink(site)}</p>
      <p class="muted small">If your message concerns a specific app, please include the app name and, for bug reports, your device model and Android version.</p>
    </div>
    <div class="card contact-card reveal">
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
  const ctx = { site: content.site, assets };

  const pages = [
    homePage(content),
    appsIndexPage(content),
    ...content.apps.map((app) => appPage(content, app, content.policies.get(app.slug))),
    privacyIndexPage(content),
    ...content.apps.map((app) => privacyPage(content, app, content.policies.get(app.slug))),
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
