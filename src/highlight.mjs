// A small syntax highlighter for the code boxes on /design/, run at build time (no script in the page).
// It knows just enough HTML, CSS and JavaScript to colour comments, strings, tags, properties, keywords and
// numbers. Input is plain source; output is escaped HTML with <span class="tk-...">.

import { esc } from './markdown.mjs';

/** Walks the source with a list of [className, regex] rules; text that matches no rule is escaped as is. */
function tokenize(src, rules) {
  let out = '';
  let i = 0;
  const re = new RegExp(rules.map(([, r]) => `(${r.source})`).join('|'), 'gy');
  while (i < src.length) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (m) {
      const k = m.slice(1).findIndex((g) => g !== undefined);
      const cls = rules[k][0];
      out += cls ? `<span class="tk-${cls}">${esc(m[0])}</span>` : esc(m[0]);
      i = re.lastIndex;
    } else {
      out += esc(src[i]);
      i += 1;
    }
  }
  return out;
}

const JS_KEYWORDS = 'const|let|var|function|return|if|else|for|of|in|new|try|catch|await|async|true|false|null|undefined|this|typeof';

const rules = {
  js: [
    ['com', /\/\/[^\n]*|\/\*[\s\S]*?\*\//],
    ['str', /`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/],
    ['re', /\/(?![*/])(?:\\.|\[[^\]\n]*\]|[^/\\\n[])+\/[gimsuy]*(?=\s*[.,;)\]])/],
    ['kw', new RegExp(`\\b(?:${JS_KEYWORDS})\\b`)],
    ['num', /\b\d+(?:\.\d+)?\b/],
    ['fn', /\b[A-Za-z_$][\w$]*(?=\s*\()/],
    [null, /[A-Za-z_$][\w$]*|\s+|./],
  ],
  css: [
    ['com', /\/\*[\s\S]*?\*\//],
    ['str', /"[^"\n]*"|'[^'\n]*'/],
    ['at', /@[\w-]+/],
    ['prop', /--[\w-]+(?=\s*:)|[a-z-]+(?=\s*:[^:{]*[;}])/],
    ['var', /--[\w-]+/],
    ['num', /-?\b\d*\.?\d+(?:px|rem|em|%|s|ms|vw|ch|deg|fr)?\b|#[0-9a-fA-F]{3,8}\b/],
    ['sel', /[.#][\w-]+|::?[\w-]+/],
    [null, /[\w-]+|\s+|./],
  ],
};

function highlightHtml(src) {
  // Tags with attributes; text between tags is escaped plain text.
  return src.replace(/<!--[\s\S]*?-->|<\/?[\w-]+(?:\s+[^<>]*?)?\/?>|[^<]+|</g, (part) => {
    if (part.startsWith('<!--')) return `<span class="tk-com">${esc(part)}</span>`;
    if (!/^<\/?[\w-]/.test(part)) return esc(part);
    const m = /^(<\/?)([\w-]+)([\s\S]*?)(\/?>)$/.exec(part);
    const attrs = m[3].replace(/([\w:-]+)(\s*=\s*)("[^"]*"|'[^']*')|([^"'\s=]+)|\s+|[\s\S]/g, (a, name, eq, val, bare) => {
      if (name) return `<span class="tk-attr">${esc(name)}</span>${esc(eq)}<span class="tk-str">${esc(val)}</span>`;
      if (bare) return `<span class="tk-attr">${esc(bare)}</span>`;
      return esc(a);
    });
    return `${esc(m[1])}<span class="tk-tag">${esc(m[2])}</span>${attrs}${esc(m[4])}`;
  });
}

export function highlight(src, lang) {
  if (lang === 'html') return highlightHtml(src);
  return tokenize(src, rules[lang] || rules.js);
}
