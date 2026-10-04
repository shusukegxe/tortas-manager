'use strict';
/* Smoke test funcional del panel del negocio (código real sobre jsdom). */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const DIR = __dirname + '/..';
const html = fs.readFileSync(`${DIR}/index.html`, 'utf8')
  .replace('<script src="core.js"></script>', () => `<script>\n${fs.readFileSync(`${DIR}/core.js`, 'utf8')}\n</script>`)
  .replace('<script src="app.js"></script>', () => `<script>\n${fs.readFileSync(`${DIR}/app.js`, 'utf8')}\n</script>`);

const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  OK ' : ' FAIL') + ' ' + msg); if (!cond) fails++; };

(async () => {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/', pretendToBeVisual: true });
  dom.window.onerror = e => { console.log('  ONERROR ' + e); fails++; };
  const d = dom.window.document;
  await sleep(300);

  // 1. render inicial
  ok(d.querySelectorAll('.kpi').length === 4, 'panel: 4 KPIs');
  ok(d.querySelectorAll('#orders-body tr').length === 2, 'panel: 2 pedidos de ejemplo');
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

  console.log(fails ? `\n${fails} FALLOS` : '\nTODO OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('EXCEPCIÓN:', e); process.exit(1); });
