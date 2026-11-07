// Reusable page layout and components. Every function returns an HTML string.
// All values coming from content files must pass through esc().

import { esc } from './markdown.mjs';

const NAV = [
  { href: '/apps/', label: 'Apps' },
  { href: '/privacy/', label: 'Privacy' },
  { href: '/contact/', label: 'Contact' },
];

export const icons = {
  arrow: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  external: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  mail: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  shield: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v6c0 4.5 3.4 8.4 8 9 4.6-.6 8-4.5 8-9V6l-8-3Z"/></svg>',
  play: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.5v15a.8.8 0 0 0 1.2.7l12.4-7.5a.8.8 0 0 0 0-1.4L7.2 3.8A.8.8 0 0 0 6 4.5Z"/></svg>',
  back: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  code: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 7-5 5 5 5M16 7l5 5-5 5"/></svg>',
  linkedin: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7"/></svg>',
  doc: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
};

const logoMark = (id) => `<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2dd4bf"/><stop offset="1" stop-color="#818cf8"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#${id})"/><path d="M22 10H10v6h12v6H10" fill="none" stroke="#0b0d12" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function layout({ site, assets, path, title, description, body, noindex = false, jsonLd = null }) {
  const fullTitle = path === '/' ? `${site.name} — ${site.tagline}` : `${title} · ${site.name}`;
  const canonical = `${site.url}${path}`;
  const year = new Date().getUTCFullYear();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${noindex ? '<meta name="robots" content="noindex">\n' : ''}<meta name="theme-color" content="#0b0d12">
<meta name="color-scheme" content="dark">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(site.url)}/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="${assets.css}">
<script src="${assets.js}" defer></script>
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>\n` : ''}</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="container header-inner">
    <a class="brand" href="/" aria-label="${esc(site.name)} — home">${logoMark('logo-h')}<span class="brand-name">${esc(site.name)}</span></a>
    <nav aria-label="Main">
      <ul class="nav-list">
        ${NAV.map((n) => `<li><a href="${n.href}"${path.startsWith(n.href) ? ' aria-current="page"' : ''}>${n.label}</a></li>`).join('\n        ')}
      </ul>
    </nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="container footer-inner">
    <div class="footer-brand">
      <a class="brand" href="/">${logoMark('logo-f')}<span class="brand-name">${esc(site.name)}</span></a>
      <p class="muted small">${esc(site.tagline)}</p>
      ${legalLine(site)}
    </div>
    <nav class="footer-nav" aria-label="Footer">
      <div>
        <h2 class="footer-heading">Site</h2>
        <ul>
          <li><a href="/">Home</a></li>
          <li><a href="/#projects">Projects</a></li>
          <li><a href="/apps/">Apps</a></li>
          <li><a href="/contact/">Contact</a></li>
          ${site.linkedin ? `<li><a href="${esc(site.linkedin)}" rel="noopener noreferrer me">LinkedIn</a></li>` : ''}
        </ul>
      </div>
      <div>
        <h2 class="footer-heading">Legal</h2>
        <ul>
          <li><a href="/privacy/">Privacy policies</a></li>
          <li><a href="/privacy/#website">Website privacy</a></li>
          <li><a href="/contact/#business">Business information</a></li>
        </ul>
      </div>
    </nav>
  </div>
  <div class="container footer-bottom">
    <p class="muted small">© ${year} ${esc(site.name)}. Google Play is a trademark of Google LLC.</p>
  </div>
</footer>
</body>
</html>
`;
}

function legalLine(site) {
  const parts = [site.legal.businessType];
  if (site.legal.cvr) parts.push(`CVR ${site.legal.cvr}`);
  return `<p class="muted small">${parts.map(esc).join(' · ')}</p>`;
}

export function emailLink(site, { subject, className = '', label } = {}) {
  if (!site.email) return '<span class="muted">[Contact email not configured — set "email" in content/site.json]</span>';
  const href = `mailto:${site.email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
  return `<a${className ? ` class="${className}"` : ''} href="${esc(href)}">${label ?? esc(site.email)}</a>`;
}

export function pageHeader({ eyebrow, title, lead, extra = '' }) {
  return `<section class="page-header">
  <div class="container">
    ${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}
    <h1>${title}</h1>
    ${lead ? `<p class="lead">${lead}</p>` : ''}
    ${extra}
  </div>
</section>`;
}

export function sampleBadge(app) {
  return app.sample ? '<span class="badge badge-warn" title="Sample data — replace in content/apps.json">Sample</span>' : '';
}

export function playButton(app, className = 'btn btn-primary') {
  if (!app.playStoreUrl) {
    const label = app.sample ? 'Google Play link not set' : 'Coming soon to Google Play';
    return `<span class="${className} is-disabled" aria-disabled="true">${icons.play}${label}</span>`;
  }
  return `<a class="${className}" href="${esc(app.playStoreUrl)}" rel="noopener noreferrer">${icons.play}Get it on Google Play</a>`;
}

export function appCard(app) {
  return `<article class="card app-card reveal">
  <a class="app-card-link" href="/apps/${app.slug}/" aria-label="${esc(app.name)} — details"></a>
  <div class="app-card-head">
    <img class="app-icon" src="${esc(app.icon)}" alt="" width="64" height="64" loading="lazy" decoding="async">
    <div>
      <h3 class="app-card-title">${esc(app.name)} ${sampleBadge(app)}</h3>
      <p class="muted small">${esc(app.category || 'Android app')}</p>
    </div>
  </div>
  <p class="app-card-tagline">${esc(app.tagline)}</p>
  <div class="app-card-links">
    <a href="/apps/${app.slug}/">Details ${icons.arrow}</a>
    ${app.playStoreUrl ? `<a href="${esc(app.playStoreUrl)}" rel="noopener noreferrer">Google Play ${icons.external}</a>` : ''}
    <a href="/privacy/${app.slug}/">Privacy</a>
  </div>
</article>`;
}

export function appGrid(apps) {
  if (!apps.length) return '<p class="muted">No applications have been added yet.</p>';
  return `<div class="grid app-grid">\n${apps.map(appCard).join('\n')}\n</div>`;
}

function projectCard(p) {
  const external = /^https?:\/\//.test(p.url || '');
  const rel = external ? ' rel="noopener noreferrer"' : '';
  const visual = p.icon
    ? `<img class="app-icon" src="${esc(p.icon)}" alt="" width="56" height="56" loading="lazy" decoding="async">`
    : `<span class="app-icon project-monogram" aria-hidden="true">${esc(p.name.charAt(0))}</span>`;
  return `<article class="card app-card project-card reveal">
  ${p.url ? `<a class="app-card-link" href="${esc(p.url)}"${rel} aria-label="${esc(p.name)}"></a>` : ''}
  <div class="app-card-head">
    ${visual}
    <div>
      <h3 class="app-card-title">${esc(p.name)} ${p.sample ? '<span class="badge badge-warn">Sample</span>' : ''}</h3>
      <p class="muted small">${esc(p.type)}${p.status ? ` · <span class="status">${esc(p.status)}</span>` : ''}</p>
    </div>
  </div>
  <p class="app-card-tagline">${esc(p.description)}</p>
  ${p.url ? `<div class="app-card-links"><a href="${esc(p.url)}"${rel}>${esc(p.linkLabel || 'Visit')} ${external ? icons.external : icons.arrow}</a></div>` : ''}
</article>`;
}

export function projectGrid(projects) {
  if (!projects.length) return '<p class="muted">Nothing to show yet.</p>';
  return `<div class="grid app-grid">\n${projects.map(projectCard).join('\n')}\n</div>`;
}
