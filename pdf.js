'use strict';
/* Generador minimalista de PDF sin dependencias (fuentes estándar Helvetica +
   WinAnsiEncoding). Suficiente para el reporte de movimientos: título, resumen,
   tabla paginada con cabecera repetida en cada página y pie con numeración.
   Todo el contenido se emite en un byte por carácter (latin-1/WinAnsi), así que
   los offsets del xref coinciden con las posiciones de la cadena. */

const PDFMovimientos = (() => {
  const PW = 595.28, PH = 841.89;      // A4 portrait en puntos
  const M = 40;                        // margen
  const FS = 8;                        // cuerpo de la tabla
  const ROW_H = 16, HEAD_H = 18;
  const BOTTOM = 56;

  // unicode → WinAnsi (lo que no tenga equivalente se sustituye)
  function win(s) {
    let out = '';
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      out += c === 0x2014 ? '\x97' : c === 0x2013 ? '\x96' : c === 0x2026 ? '\x85'
        : c === 0x2018 ? '\x91' : c === 0x2019 ? '\x92' : c < 256 ? ch : '?';
    }
    return out;
  }
  const esc = s => win(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const clip = (s, n) => { s = win(s); return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '\x85' : s; };

  function build(o) {
    const usable = PW - 2 * M;
    const totalW = o.columnas.reduce((s, c) => s + c.ancho, 0);
    const cols = o.columnas.map(c => ({ ...c, w: c.ancho * usable / totalW }));
    const xs = []; let acc = M;
    for (const c of cols) { xs.push(acc); acc += c.w; }
    const maxChars = cols.map(c => Math.max(1, Math.floor((c.w - 6) / (FS * 0.5))));
    const cellX = (ci, str) => cols[ci].align === 'right'
      ? xs[ci] + cols[ci].w - str.length * FS * 0.5 - 1
      : xs[ci];

    // paginación: la página 1 reserva espacio para título/resumen
    const pages = []; let cur = []; let y = PH - M - 48 - HEAD_H;
    for (const f of o.filas) {
      if (y - ROW_H < BOTTOM) { pages.push(cur); cur = []; y = PH - M - 8 - HEAD_H; }
      cur.push({ f, rectY: y - ROW_H });
      y -= ROW_H;
    }
    pages.push(cur);
    const np = pages.length;

    const streams = pages.map((rows, pi) => {
      const s = [];
      const text = (x, yy, font, size, rgb, str) =>
        s.push(`BT /${font} ${size} Tf ${rgb} rg ${x.toFixed(2)} ${yy.toFixed(2)} Td (${esc(str)}) Tj ET`);
      const rect = (x, yy, w, h, rgb) =>
        s.push(`${rgb} rg ${x.toFixed(2)} ${yy.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);

      if (pi === 0) {
        text(M, PH - M - 4, 'F2', 13, '0.26 0.19 0.12', o.titulo || '');
        text(M, PH - M - 20, 'F1', 8, '0.45 0.4 0.33', o.sub || '');
        text(M, PH - M - 34, 'F1', 9, '0.26 0.19 0.12', o.resumen || '');
      }
      const headTop = pi === 0 ? PH - M - 48 : PH - M - 8;
      rect(M, headTop - HEAD_H, usable, HEAD_H, '0.95 0.9 0.8');
      cols.forEach((c, ci) => text(cellX(ci, c.t), headTop - HEAD_H + 5.5, 'F2', FS, '0.26 0.19 0.12', c.t));

      rows.forEach((r, ri) => {
        if (ri % 2 === 1) rect(M, r.rectY, usable, ROW_H, '0.98 0.965 0.93');
        r.f.forEach((cell, ci) => {
          const str = clip(typeof cell === 'object' ? cell.t : cell, maxChars[ci]);
          const rgb = cell && cell.rgb ? cell.rgb.join(' ') : '0.13 0.11 0.09';
          text(cellX(ci, str), r.rectY + 5, 'F1', FS, rgb, str);
        });
      });
      if (pi === 0 && !o.filas.length) {
        text(M + 4, headTop - HEAD_H - 20, 'F1', 9, '0.45 0.4 0.33', 'Sin movimientos para este filtro.');
      }

      const pieY = 36;
      text(M, pieY, 'F1', 7.5, '0.5 0.45 0.38', o.pie || '');
      const pg = `Página ${pi + 1} de ${np}`;
      text(PW - M - pg.length * 7.5 * 0.5, pieY, 'F1', 7.5, '0.5 0.45 0.38', pg);
      return s.join('\n');
    });

    // objetos del documento: 1 catálogo, 2 páginas, 3-4 fuentes, luego 2 por página
    const objs = [];
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + 2 * i} 0 R`).join(' ')}] /Count ${np} >>`;
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    streams.forEach((stream, i) => {
      const p = 5 + 2 * i, c = 6 + 2 * i;
      objs[p] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW.toFixed(2)} ${PH.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${c} 0 R >>`;
      objs[c] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    });

    let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [];
    for (let i = 1; i < objs.length; i++) {
      offsets[i] = out.length;
      out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
    }
    const xrefPos = out.length;
    out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objs.length; i++) out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

    return Uint8Array.from(out, ch => ch.charCodeAt(0) & 0xFF);
  }

  const bin = bytes => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return s;
  };

  function download(bytes, filename) {
    let url;
    try { url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); }
    catch { url = 'data:application/pdf;base64,' + btoa(bin(bytes)); }
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    if (url.startsWith('blob:')) setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 5000);
  }

  return { build, download };
})();
