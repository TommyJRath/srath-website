// A small, dependency-free Markdown renderer covering the subset used for
// privacy policies: headings, paragraphs, lists, links, emphasis, inline code,
// blockquotes, horizontal rules and raw HTML blocks.

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z#0-9]+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Splits `---` front matter (simple `key: value` lines) from the body. */
export function parseFrontMatter(source) {
  const src = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const match = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { data: {}, body: src };

  const data = {};
  for (const line of match[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (!kv) throw new Error(`Invalid front matter line: "${line}"`);
    let value = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    data[kv[1]] = value;
  }
  return { data, body: src.slice(match[0].length) };
}

function link(href, label) {
  const external = /^https?:\/\//.test(href);
  const attrs = external ? ' rel="noopener noreferrer"' : '';
  return `<a href="${esc(href)}"${attrs}>${label}</a>`;
}

export function inline(text) {
  const slots = [];
  const hold = (html) => `\u0000${slots.push(html) - 1}\u0000`;

  let out = text
    .replace(/`([^`]+)`/g, (_, code) => hold(`<code>${esc(code)}</code>`))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => hold(link(href, inline(label))))
    .replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, (_, href) =>
      hold(link(href, esc(href.replace(/^mailto:/, '')))))
    .replace(/<([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)>/g, (_, email) => hold(link(`mailto:${email}`, esc(email))))
    .replace(/<(\/?(?:a|strong|em|br|span|abbr|sup|sub)\b[^>]*)>/gi, (_, tag) => hold(`<${tag}>`));

  out = esc(out)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<em>$2</em>');

  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

const BLOCK_HTML = /^<\/?(?:div|section|table|thead|tbody|tr|td|th|p|ul|ol|li|h[1-6]|dl|dt|dd|figure|img|details|summary|aside|blockquote|hr|br)\b/i;

/** Renders Markdown to HTML. Returns { html, headings: [{ level, text, id }] }. */
export function renderMarkdown(source) {
  const lines = source.replace(/<!--[\s\S]*?-->/g, '').replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  const headings = [];
  const usedIds = new Set();
  let paragraph = [];
  let list = null; // { type: 'ul' | 'ol', items: string[] }
  let quote = [];

  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) html.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) html.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`);
    quote = [];
  };
  const flushAll = () => { flushParagraph(); flushList(); flushQuote(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { flushAll(); continue; }

    const heading = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const text = heading[2];
      let id = slugify(text) || 'section';
      for (let n = 2; usedIds.has(id); n++) id = `${slugify(text)}-${n}`;
      usedIds.add(id);
      headings.push({ level, text, id });
      html.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flushAll(); html.push('<hr>'); continue; }

    if (BLOCK_HTML.test(trimmed)) {
      flushAll();
      const block = [line];
      while (i + 1 < lines.length && lines[i + 1].trim()) block.push(lines[++i]);
      html.push(block.join('\n'));
      continue;
    }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushParagraph(); flushQuote();
      const type = ul ? 'ul' : 'ol';
      if (list && list.type !== type) flushList();
      list ??= { type, items: [] };
      list.items.push((ul || ol)[1]);
      continue;
    }
    if (list && /^\s+\S/.test(line)) { list.items[list.items.length - 1] += ` ${trimmed}`; continue; }

    const q = line.match(/^>\s?(.*)$/);
    if (q) { flushParagraph(); flushList(); quote.push(q[1]); continue; }

    flushList(); flushQuote();
    paragraph.push(trimmed);
  }
  flushAll();

  return { html: html.join('\n'), headings };
}
