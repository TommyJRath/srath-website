// A small PDF writer for the tools: A4 pages with text, lines and filled boxes, using the PDF standard fonts
// Helvetica and Helvetica-Bold (built into every PDF reader, so no font is embedded). Text is encoded as
// WinAnsi (Windows-1252), which covers Danish æ ø å and the usual punctuation. No libraries.
//
//   var doc = SrathPDF.create();
//   doc.text('Faktura', 50, 60, { size: 24, bold: true });
//   doc.text('1.250,00 kr.', 545, 120, { align: 'right' });
//   doc.line(50, 130, 545, 130);
//   doc.save('Faktura 1.pdf');
//
// Coordinates are points (1/72 inch) from the top-left corner of the page. A4 is 595 x 842 points.
(function () {
  'use strict';

  var W = 595.28, H = 841.89;

  // Character widths in 1/1000 em, from the Adobe metrics for Helvetica and Helvetica-Bold (ASCII 32-126).
  var REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  var BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
  // Characters outside ASCII that the tools use: [WinAnsi byte, regular width, bold width].
  var EXTRA = {
    'æ': [0xE6, 889, 889], 'ø': [0xF8, 611, 611], 'å': [0xE5, 556, 556],
    'Æ': [0xC6, 1000, 1000], 'Ø': [0xD8, 778, 778], 'Å': [0xC5, 667, 722],
    'é': [0xE9, 556, 556], 'è': [0xE8, 556, 556], 'ü': [0xFC, 556, 611], 'ö': [0xF6, 556, 611], 'ä': [0xE4, 556, 556],
    'Ü': [0xDC, 722, 722], 'Ö': [0xD6, 778, 778], 'Ä': [0xC4, 667, 722], 'ß': [0xDF, 611, 611],
    '§': [0xA7, 556, 556], '×': [0xD7, 584, 584], '°': [0xB0, 400, 400], '·': [0xB7, 278, 278], ' ': [0xA0, 278, 278],
    '–': [0x96, 556, 556], '—': [0x97, 1000, 1000], '…': [0x85, 1000, 1000], '•': [0x95, 350, 350], '€': [0x80, 556, 556],
    '‘': [0x91, 222, 278], '’': [0x92, 222, 278], '“': [0x93, 333, 500], '”': [0x94, 333, 500], '«': [0xAB, 556, 556], '»': [0xBB, 556, 556],
  };
  // Characters WinAnsi doesn't have, written as something close.
  var SUBST = { '→': '->', '←': '<-', ' ': ' ', ' ': ' ', '−': '-' };

  /** One character as [byte, width] for the font, falling back to the base letter or a question mark. */
  function glyph(ch, bold) {
    var c = ch.charCodeAt(0);
    if (c >= 32 && c <= 126) return [c, (bold ? BOLD : REG)[c - 32]];
    var e = EXTRA[ch];
    if (e) return [e[0], bold ? e[2] : e[1]];
    var base = ch.normalize ? ch.normalize('NFD').charAt(0) : '';
    if (c >= 0xA0 && c <= 0xFF && base && base.charCodeAt(0) < 127) return [c, glyph(base, bold)[1]]; // Latin-1 accented
    return [63, 556]; // ?
  }
  function clean(s) { return String(s == null ? '' : s).replace(/[→←  −]/g, function (m) { return SUBST[m]; }).replace(/\t/g, ' '); }

  function widthOf(s, size, bold) {
    var w = 0;
    s = clean(s);
    for (var i = 0; i < s.length; i++) w += glyph(s[i], bold)[1];
    return w * size / 1000;
  }
  /** A PDF string literal: escaped, with bytes above 126 as octal escapes. */
  function pdfString(s, bold) {
    s = clean(s);
    var out = '(';
    for (var i = 0; i < s.length; i++) {
      var b = glyph(s[i], bold)[0];
      if (b === 40 || b === 41 || b === 92) out += '\\' + String.fromCharCode(b);
      else if (b < 32 || b > 126) out += '\\' + ('00' + b.toString(8)).slice(-3);
      else out += String.fromCharCode(b);
    }
    return out + ')';
  }
  function rgb(c) { return (c || [0, 0, 0]).map(function (v) { return (v / 255).toFixed(3); }).join(' '); }
  function n(v) { return (Math.round(v * 100) / 100).toString(); }

  /** Splits text into lines that fit maxWidth (by words; a too-long word is kept whole). */
  function wrap(text, maxWidth, size, bold) {
    var out = [];
    clean(text).split('\n').forEach(function (para) {
      if (!maxWidth) { out.push(para); return; }
      var words = para.split(' '), line = '';
      words.forEach(function (w) {
        var tryLine = line ? line + ' ' + w : w;
        if (line && widthOf(tryLine, size, bold) > maxWidth) { out.push(line); line = w; } else line = tryLine;
      });
      out.push(line);
    });
    return out;
  }

  function create() {
    var pages = [[]];
    var page = pages[0];
    var images = [];
    var doc = {
      width: W, height: H,
      /** Writes text; returns the height used. opts: size, bold, color [r,g,b], align left|right|center, maxWidth, lineHeight. */
      text: function (text, x, y, opts) {
        opts = opts || {};
        var size = opts.size || 10, bold = !!opts.bold, lh = (opts.lineHeight || 1.35) * size;
        var lines = wrap(text, opts.maxWidth, size, bold);
        lines.forEach(function (line, i) {
          var w = widthOf(line, size, bold);
          var lx = opts.align === 'right' ? x - w : opts.align === 'center' ? x - w / 2 : x;
          page.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + n(size) + ' Tf ' + rgb(opts.color) + ' rg ' + n(lx) + ' ' + n(H - y - i * lh) + ' Td ' + pdfString(line, bold) + ' Tj ET');
        });
        return lines.length * lh;
      },
      /** Height the text would take, without drawing it. */
      measure: function (text, opts) {
        opts = opts || {};
        var size = opts.size || 10;
        return wrap(text, opts.maxWidth, size, !!opts.bold).length * (opts.lineHeight || 1.35) * size;
      },
      textWidth: function (text, size, bold) { return widthOf(text, size || 10, !!bold); },
      line: function (x1, y1, x2, y2, opts) {
        opts = opts || {};
        page.push(n(opts.width || 0.75) + ' w ' + rgb(opts.color) + ' RG ' + n(x1) + ' ' + n(H - y1) + ' m ' + n(x2) + ' ' + n(H - y2) + ' l S');
      },
      rect: function (x, y, w, h, color) {
        page.push(rgb(color) + ' rg ' + n(x) + ' ' + n(H - y - h) + ' ' + n(w) + ' ' + n(h) + ' re f');
      },
      /** Draws a JPEG image (a data: URL, e.g. from SrathPDF.toJpeg) in the box x, y, w, h. */
      image: function (jpeg, x, y, w, h) {
        if (!jpeg || !jpeg.dataUrl) return;
        var key = images.indexOf(jpeg);
        if (key < 0) { images.push(jpeg); key = images.length - 1; }
        page.push('q ' + n(w) + ' 0 0 ' + n(h) + ' ' + n(x) + ' ' + n(H - y - h) + ' cm /Im' + (key + 1) + ' Do Q');
      },
      addPage: function () { page = []; pages.push(page); },
      pageCount: function () { return pages.length; },

      /** The finished PDF as bytes. */
      bytes: function (title) {
        var objs = [];
        var add = function (s) { objs.push(s); return objs.length; };
        var catalog = add(null), pagesObj = add(null);
        var f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
        var f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
        // Images: the JPEG bytes go in as they are (DCTDecode), so no image decoding is needed here.
        var imgRefs = images.map(function (img, i) {
          var bin = atob(img.dataUrl.split(',')[1]);
          return '/Im' + (i + 1) + ' ' + add('<< /Type /XObject /Subtype /Image /Width ' + img.width + ' /Height ' + img.height +
            ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + bin.length + ' >>\nstream\n' + bin + '\nendstream') + ' 0 R';
        });
        var xobjects = imgRefs.length ? ' /XObject << ' + imgRefs.join(' ') + ' >>' : '';
        var kids = pages.map(function (ops) {
          var stream = ops.join('\n');
          var content = add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
          return add('<< /Type /Page /Parent ' + pagesObj + ' 0 R /MediaBox [0 0 ' + n(W) + ' ' + n(H) + '] /Resources << /Font << /F1 ' + f1 + ' 0 R /F2 ' + f2 + ' 0 R >>' + xobjects + ' >> /Contents ' + content + ' 0 R >>');
        });
        objs[pagesObj - 1] = '<< /Type /Pages /Kids [' + kids.map(function (k) { return k + ' 0 R'; }).join(' ') + '] /Count ' + kids.length + ' >>';
        objs[catalog - 1] = '<< /Type /Catalog /Pages ' + pagesObj + ' 0 R >>';
        var info = add('<< /Title ' + pdfString(title || '') + ' /Producer (srath.dk) >>');
        var out = '%PDF-1.4\n%âãÏÓ\n', offsets = [];
        objs.forEach(function (o, i) { offsets.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
        var xref = out.length;
        out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' +
          offsets.map(function (o) { return ('000000000' + o).slice(-10) + ' 00000 n \n'; }).join('') +
          'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
        // Every character in `out` is one byte (0-255).
        var bytes = new Uint8Array(out.length);
        for (var i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
        return bytes;
      },
      /** Downloads the PDF. */
      save: function (filename) {
        var name = String(filename || 'document').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
        if (!/\.pdf$/i.test(name)) name += '.pdf';
        var blob = new Blob([doc.bytes(name.replace(/\.pdf$/i, ''))], { type: 'application/pdf' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      },
    };
    return doc;
  }

  /**
   * Turns an image file (PNG, JPEG, WebP, SVG …) into a small JPEG on a white background, for the invoice
   * logo: { dataUrl, width, height }. Calls back with null if the file isn't an image the browser can read.
   */
  function toJpeg(file, maxSize, done) {
    if (!file || !/^image\//.test(file.type)) { done(null); return; }
    var reader = new FileReader();
    reader.onerror = function () { done(null); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { done(null); };
      img.onload = function () {
        var w = img.naturalWidth || 300, h = img.naturalHeight || 150;
        var scale = Math.min(1, maxSize / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); // transparent logos sit on white paper
        x.drawImage(img, 0, 0, w, h);
        done({ dataUrl: c.toDataURL('image/jpeg', 0.9), width: w, height: h });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  /**
   * A business document (invoice, quote, payment reminder) laid out like the on-screen preview:
   * {
   *   title, logo,                       // logo: { dataUrl, width, height } from toJpeg, optional
   *   seller: { name, lines },           // lines: text with \n
   *   buyer: { label, name, lines },
   *   meta: [[label, value], ...],       // number, dates
   *   intro: [paragraph, ...],           // optional (reminders)
   *   table: { head: [4 labels], rows: [[description, qty, price, amount], ...] },  // optional
   *   totals: [[label, value, isGrand], ...],
   *   small: 'note under the totals',    // optional
   *   foot: [{ label, text }, ...],
   * }
   */
  function businessDoc(m) {
    var doc = create();
    var INK = [27, 31, 39], GREY = [107, 114, 128], LINE = [229, 231, 235], AMBER = [232, 163, 61];
    var L = 56, R = W - 56, TOP = 56, BOTTOM = H - 60;
    var y = TOP;

    // Head: title left, logo and seller right.
    doc.text(m.title, L, y + 22, { size: 26, bold: true, color: INK });
    doc.rect(L, y + 34, 40, 3, AMBER);
    var ry = y;
    if (m.logo && m.logo.dataUrl) {
      var maxW = 150, maxH = 56;
      var s = Math.min(maxW / m.logo.width, maxH / m.logo.height, 1.5);
      var lw = m.logo.width * s, lh = m.logo.height * s;
      doc.image(m.logo, R - lw, ry, lw, lh);
      ry += lh + 10;
    }
    ry += 10;
    doc.text(m.seller.name, R, ry, { size: 11, bold: true, align: 'right', color: INK });
    ry += 15;
    if (m.seller.lines) ry += doc.text(m.seller.lines, R, ry, { size: 9.5, align: 'right', color: [59, 65, 80], lineHeight: 1.45 });
    y = Math.max(y + 60, ry) + 18;

    // Parties: recipient left, details right.
    var py = y;
    doc.text(m.buyer.label.toUpperCase(), L, py, { size: 7.5, bold: true, color: GREY });
    py += 14;
    doc.text(m.buyer.name, L, py, { size: 11, bold: true, color: INK });
    py += 15;
    if (m.buyer.lines) py += doc.text(m.buyer.lines, L, py, { size: 9.5, color: INK, maxWidth: 250, lineHeight: 1.45 });
    var my = y;
    (m.meta || []).forEach(function (row) {
      doc.text(row[0], R - 190, my, { size: 9.5, color: GREY });
      doc.text(row[1], R, my, { size: 9.5, align: 'right', color: INK });
      my += 14;
    });
    y = Math.max(py, my) + 22;

    function room(need) { if (y + need > BOTTOM) { doc.addPage(); y = TOP; return true; } return false; }

    // Intro (reminders).
    (m.intro || []).forEach(function (p) {
      var h = doc.measure(p, { size: 10, maxWidth: R - L });
      room(h);
      y += doc.text(p, L, y, { size: 10, color: INK, maxWidth: R - L, lineHeight: 1.5 }) + 6;
    });
    if (m.intro && m.intro.length) y += 8;

    // Lines table.
    var COLS = [R - 175, R - 95, R]; // right edges of qty, price, amount
    var DESC_W = COLS[0] - 60 - L;
    function tableHead() {
      doc.text(m.table.head[0].toUpperCase(), L, y, { size: 7.5, bold: true, color: GREY });
      for (var c = 1; c < 4; c++) doc.text(m.table.head[c].toUpperCase(), COLS[c - 1], y, { size: 7.5, bold: true, color: GREY, align: 'right' });
      y += 7;
      doc.line(L, y, R, y, { width: 1.5, color: INK });
      y += 16;
    }
    if (m.table) {
      tableHead();
      m.table.rows.forEach(function (r) {
        var h = doc.measure(r[0], { size: 9.5, maxWidth: DESC_W, lineHeight: 1.4 });
        if (room(h + 12)) tableHead();
        doc.text(r[0], L, y, { size: 9.5, color: INK, maxWidth: DESC_W, lineHeight: 1.4 });
        for (var c = 1; c < 4; c++) doc.text(r[c], COLS[c - 1], y, { size: 9.5, color: INK, align: 'right' });
        y += h - 4;
        doc.line(L, y, R, y, { width: 0.5, color: LINE });
        y += 15;
      });
      y += 4;
    }

    // Totals, right-aligned.
    room((m.totals || []).length * 18 + 30);
    (m.totals || []).forEach(function (t) {
      if (t[2]) {
        y += 4;
        doc.line(R - 230, y - 11, R, y - 11, { width: 1.5, color: INK });
        y += 4;
        doc.text(t[0], R - 230, y, { size: 12, bold: true, color: INK });
        doc.text(t[1], R, y, { size: 12, bold: true, align: 'right', color: INK });
        y += 20;
      } else {
        doc.text(t[0], R - 230, y, { size: 10, color: INK });
        doc.text(t[1], R, y, { size: 10, align: 'right', color: INK });
        y += 16;
      }
    });
    if (m.small) {
      y += 2;
      y += doc.text(m.small, R, y, { size: 8, color: GREY, align: 'right' });
    }

    // Foot.
    if (m.foot && m.foot.length) {
      y += 22;
      var fh = m.foot.reduce(function (s, f) { return s + (f.label ? 13 : 0) + doc.measure(f.text, { size: 9.5, maxWidth: R - L }) + 8; }, 16);
      room(fh);
      doc.line(L, y, R, y, { width: 0.5, color: LINE });
      y += 18;
      m.foot.forEach(function (f) {
        if (f.label) { doc.text(f.label.toUpperCase(), L, y, { size: 7.5, bold: true, color: GREY }); y += 13; }
        y += doc.text(f.text, L, y, { size: 9.5, color: [59, 65, 80], maxWidth: R - L, lineHeight: 1.45 }) + 8;
      });
    }
    return doc;
  }

  window.SrathPDF = { create: create, toJpeg: toJpeg, businessDoc: businessDoc, A4: { width: W, height: H } };
})();
