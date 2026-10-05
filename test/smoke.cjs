'use strict';
/* Smoke test funcional del panel del negocio (código real sobre jsdom). */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const DIR = __dirname + '/..';
const html = fs.readFileSync(`${DIR}/index.html`, 'utf8')
  .replace('<script src="core.js"></script>', () => `<script>\n${fs.readFileSync(`${DIR}/core.js`, 'utf8')}\n</script>`)
  .replace('<script src="pdf.js"></script>', () => `<script>\n${fs.readFileSync(`${DIR}/pdf.js`, 'utf8')}\n</script>`)
  .replace('<script src="app.js"></script>', () => `<script>\n${fs.readFileSync(`${DIR}/app.js`, 'utf8')}\n</script>`);

const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  OK ' : ' FAIL') + ' ' + msg); if (!cond) fails++; };

(async () => {
  const pedidoRemoto = [{
    id: 'O-0100', customer: { name: 'Cliente Remoto', phone: '999000111', address: 'Av. Web 789', note: '' },
    items: [{ pid: 'p1', name: 'Selva Negra', price: 18000, qty: 1 }],
    total: 18000, payMethod: 'transferencia', payStatus: 'pendiente', status: 'nuevo',
    deliveryDate: '', createdAt: Date.now(), history: [{ status: 'nuevo', at: Date.now() }],
  }];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'http://localhost/', pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = async () => ({ ok: true, json: async () => pedidoRemoto });
    },
  });
  dom.window.onerror = e => { console.log('  ONERROR ' + e); fails++; };
  const d = dom.window.document;
  await sleep(600);

  // 0. pedidos reales de la web pública, leídos entre dispositivos
  ok(d.querySelector('#orders-body').textContent.includes('O-0100'), 'multi-dispositivo: pedido de la web aparece en el panel');
  ok(d.querySelector('#orders-body').textContent.includes('Cliente Remoto'), 'multi-dispositivo: cliente remoto visible');

  // 1. render inicial
  ok(d.querySelectorAll('.kpi').length === 4, 'panel: 4 KPIs');
  ok(d.querySelectorAll('.nav a').length === 0, 'sidebar: sin enlaces a otras apps');
  const uiTxt = d.getElementById('app').textContent;
  ok(uiTxt.indexOf('Hacer pedido') === -1 && uiTxt.indexOf('DevTools') === -1
    && uiTxt.indexOf('tortas-devtools') === -1,
    'página: solo gestión — sin rastro de pedidos o devtools en la UI');
  ok(d.querySelectorAll('#orders-body tr').length === 3, 'panel: 2 de ejemplo + 1 remoto (multi-dispositivo)');
  ok(d.querySelector('#orders-body').textContent.includes('O-0002') && d.querySelector('#orders-body').textContent.includes('Nuevo'), 'panel: O-0002 nuevo');
  ok(d.querySelectorAll('#tab-body .stockbar').length === 5, 'disponibilidad: 5 productos con barra de stock');

  // 2. avanzar pedido O-0002 y ver la notificación en la pestaña de actividad
  d.querySelector('[data-act="advance"][data-id="O-0002"]').click();
  await sleep(1200);
  ok(d.querySelector('#orders-body').textContent.includes('En preparación'), 'panel: O-0002 avanzó a en preparación');
  d.querySelector('[data-act="tab"][data-v="actividad"]').click();
  await sleep(30);
  ok(d.querySelector('#tab-body').textContent.includes('O-0002'), 'actividad: notificación del avance visible');
  d.querySelector('[data-act="tab"][data-v="inventario"]').click();
  await sleep(30);

  // 3. reposición de disponibilidad (Personalizada: 4 -> 9)
  d.querySelector('[data-act="restock"][data-id="p5"]').click();
  await sleep(1000);
  const persisted = JSON.parse(dom.window.localStorage.getItem('tortas-pedidos-v1'));
  ok(persisted.products.find(p => p.id === 'p5').stock === 9, 'disponibilidad: +5 aplicado (4 → 9)');
  ok(persisted.orders.find(o => o.id === 'O-0002').status === 'preparando', 'persistencia: O-0002 en preparación');

  // 4. pestañas secundarias
  d.querySelector('[data-act="tab"][data-v="clientes"]').click();
  await sleep(30);
  ok(d.querySelectorAll('#tab-body tbody tr').length === 2, 'clientes: 2 filas');
  d.querySelector('[data-act="tab"][data-v="inventario"]').click();
  await sleep(30);

  // 5. filtro de pedidos
  d.querySelector('[data-act="filter"][data-v="entregados"]').click();
  await sleep(30);
  ok(!d.querySelector('#orders-body').textContent.includes('O-0002'), 'filtro: entregados oculta O-0002');
  ok(d.querySelector('#orders-body').textContent.includes('O-0001'), 'filtro: entregados muestra O-0001');

  // 6. cancelar con confirmación
  d.querySelector('[data-act="filter"][data-v="todos"]').click();
  await sleep(30);
  d.querySelector('[data-act="ask-cancel"][data-id="O-0002"]').click();
  await sleep(30);
  ok(d.getElementById('modal-root').textContent.includes('¿Cancelar pedido O-0002?'), 'cancelar: diálogo de confirmación');
  d.querySelector('[data-act="confirm-ok"]').click();
  await sleep(1100);
  ok(d.querySelector('#orders-body').textContent.includes('Cancelado'), 'cancelar: O-0002 cancelado');
  const persisted2 = JSON.parse(dom.window.localStorage.getItem('tortas-pedidos-v1'));
  ok(persisted2.products.find(p => p.id === 'p1').stock === 8, 'cancelar: stock de Selva Negra devuelto');

  // 7. exportar movimientos a PDF
  ok(!!d.querySelector('[data-act="export-pdf"]'), 'export: botón Exportar PDF presente');
  let pdfBlob = null;
  dom.window.URL.createObjectURL = b => { pdfBlob = b; return 'blob:test'; };
  dom.window.URL.revokeObjectURL = () => {};
  d.querySelector('[data-act="export-pdf"]').click();
  await sleep(60);
  ok(!!pdfBlob, 'export: se generó un archivo al pulsar el botón');
  const pdf = Buffer.from(await pdfBlob.arrayBuffer()).toString('latin1');
  ok(pdf.startsWith('%PDF-1.4') && pdf.trimEnd().endsWith('%%EOF'), 'export: estructura PDF válida (cabecera y EOF)');
  const sx = parseInt(pdf.match(/startxref\s+(\d+)/)[1], 10);
  ok(pdf.slice(sx, sx + 4) === 'xref', 'export: startxref apunta a la tabla xref');
  const offs = [...pdf.slice(sx).matchAll(/(\d{10}) 00000 n/g)].map(m => parseInt(m[1], 10));
  ok(offs.every((off, k) => pdf.slice(off, off + 12).startsWith(`${k + 1} 0 obj`)),
    `export: los ${offs.length} offsets del xref apuntan a objetos reales`);
  const npag = (pdf.match(/\/Type \/Page[^s]/g) || []).length;
  ok(npag >= 1, `export: ${npag} página(s) en el documento`);
  ok(pdf.includes('Reporte de movimientos'), 'export: título del reporte presente');
  ok(pdf.includes('O-0002') && pdf.includes('O-0001'), 'export: contiene los pedidos');
  ok(pdf.includes('Cancelado') && pdf.includes('S/ 72.00'), 'export: estados y montos en soles presentes');

  console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('EXCEPCIÓN:', e); process.exit(1); });
