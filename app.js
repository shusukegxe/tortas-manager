'use strict';
/* Tortas · Hechas a Mano — panel del negocio.
   Gestiona los pedidos que llegan desde la página de pedidos (pedidos-express):
   avanza/cancela estados, repone disponibilidad y ve KPIs, clientes y actividad.
   Las estadísticas y devtools viven en tortas-devtools. Comparten el mismo
   Store (localStorage + BroadcastChannel): todo se ve en vivo entre pestañas. */

const app = (() => {
  const viewEl = document.getElementById('view');

  // ---------- iconos ----------
  const P = {
    panel: '<rect x="3" y="3" width="7.5" height="9.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5"/><rect x="13.5" y="12" width="7.5" height="9" rx="1.5"/><rect x="3" y="16" width="7.5" height="5" rx="1.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    package: '<path d="M21 8.5v7a2 2 0 0 1-1 1.73l-6 3.5a2 2 0 0 1-2 0l-6-3.5a2 2 0 0 1-1-1.73v-7a2 2 0 0 1 1-1.73l6-3.5a2 2 0 0 1 2 0l6 3.5a2 2 0 0 1 1 1.73Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 12v9.5"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="3.5"/><path d="M21 21v-2a4 4 0 0 0-3-3.87"/><path d="M15.5 3.6a3.5 3.5 0 0 1 0 6.8"/>',
    bell: '<path d="M6.4 9a5.6 5.6 0 0 1 11.2 0c0 6 2.4 7.5 2.4 7.5H4S6.4 15 6.4 9"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/>',
    receipt: '<path d="M14 2.5H6.5A1.5 1.5 0 0 0 5 4v16a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 20V7.5Z"/><path d="M14 2.5v5h5"/><path d="M9 12.5h6M9 16h6"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10h.01M18 14h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    zap: '<path d="M13 2 3 14h8l-1 8 11-13h-9l1-7Z"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>',
  };
  const icon = (n, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;
  document.querySelectorAll('.nav a[data-icon]').forEach(a => a.insertAdjacentHTML('afterbegin', icon(a.dataset.icon, 17)));

  // ---------- monograma de reserva ----------
  const TILE_COLORS = [
    ['#eef2ff', '#4f46e5'], ['#ecfdf3', '#027a48'], ['#eff8ff', '#175cd3'],
    ['#fffaeb', '#b54708'], ['#f4f3ff', '#6938ef'], ['#f2f4f7', '#475467'],
  ];
  function tile(name, size, fs) {
    const letras = name.split(/\s+/).map(w => (w.match(/[a-záéíóúñü]/i) || [])[0]).filter(Boolean).map(s => s.toUpperCase());
    const ini = letras.length > 1 ? letras.slice(0, 2).join('') : name.replace(/[^a-záéíóúñü]/gi, '').slice(0, 2).toUpperCase();
    const [bg, fg] = TILE_COLORS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % TILE_COLORS.length];
    return `<span class="tile" style="width:${size}px;height:${size}px;font-size:${fs}px;background:${bg};color:${fg}">${ini}</span>`;
  }
  function pimg(p, size) {
    return `<img class="pimg" src="assets/${p.img}" alt="${Store.esc(p.name)}" loading="lazy" style="width:${size}px;height:${size}px" data-mono="${Store.esc(p.name)}" data-size="${size}">`;
  }
  document.addEventListener('error', e => {
    const t = e.target;
    if (t.tagName === 'IMG' && t.dataset.mono) {
      const s = +t.dataset.size;
      const wrap = document.createElement('span');
      wrap.innerHTML = tile(t.dataset.mono, s, Math.round(s * .36));
      t.replaceWith(wrap.firstChild);
    }
  }, true);

  // ---------- estado ----------
  const ui = { filter: 'todos', tab: 'inventario' };

  const META = { nuevo: { badge: 'b-blue' }, preparando: { badge: 'b-violet' }, enviado: { badge: 'b-amber' }, entregado: { badge: 'b-green' }, cancelado: { badge: 'b-red' } };
  const PAY = { aprobado: 'b-green', cobrado: 'b-green', pendiente: 'b-amber', rechazado: 'b-red' };
  const STATUS_LABEL = Store.STATUS_LABEL;
  const TAMLABEL = { P: 'Pequeña', M: 'Mediana', G: 'Grande' };
  const stockDot = n => n <= 0 ? 'var(--red)' : n <= Store.LOW ? 'var(--amber)' : 'var(--green)';

  // ---------- helpers ----------
  function toast(msg, ic = 'bell') {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${icon(ic, 15)}<span>${msg}</span>`;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }
  // avisos del navegador: notificación push sin apps externas (Permission API)
  function avisarNavegador(n) {
    if (!n || !('Notification' in window) || Notification.permission !== 'granted') return;
    const o = Store.db.orders[0];
    const aviso = new Notification('Nuevo pedido en la web', {
      body: o ? `${o.id} — ${o.customer.name} · ${Store.money(o.total)}` : `${n} pedidos nuevos`,
      tag: 'pedidos-web',
    });
    aviso.onclick = () => window.focus();
  }

  const modalRoot = document.getElementById('modal-root');
  function openModal(html) { modalRoot.innerHTML = `<div class="modal">${html}</div>`; modalRoot.style.display = 'flex'; }
  function closeModal() { modalRoot.style.display = 'none'; modalRoot.innerHTML = ''; }
  modalRoot.addEventListener('click', e => { if (e.target === modalRoot) closeModal(); });
  let pendingConfirm = null;
  function confirmDialog({ title, body, ok, onOk }) {
    pendingConfirm = onOk;
    openModal(`
      <h3 style="margin-top:0">${title}</h3>
      <p>${body}</p>
      <div class="btn-row">
        <button class="btn" data-act="modal-close">Cancelar</button>
        <button class="btn primary" data-act="confirm-ok">${ok}</button>
      </div>`);
  }

  // ---------- vista (montaje único) ----------
  viewEl.innerHTML = `
    <div class="view-head">
      <button class="btn sm" id="btn-avisos" hidden title="Te avisa en este dispositivo cuando entre un pedido de la web">Activar avisos</button>
      <div>
        <h1>Panel del negocio</h1>
        <div class="sub">${new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })} — se actualiza en vivo, también con pedidos hechos en otra pestaña.</div>
      </div>
    </div>
    <div class="kpis" id="kpis"></div>
    <div class="panel-grid">
      <section class="card">
        <div class="card-head">
          <h2>Pedidos</h2>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <div class="seg" id="order-filters"></div>
            <button class="btn sm" data-act="export-pdf" title="Descargar el reporte de movimientos en PDF">${icon('download', 14)} Exportar PDF</button>
          </div>
        </div>
        <div style="overflow-x:auto">
          <table class="table">
            <thead><tr><th>Pedido</th><th>Cliente</th><th>Artículos</th><th class="num" style="text-align:right">Total</th><th>Pago</th><th>Estado</th><th></th></tr></thead>
            <tbody id="orders-body"></tbody>
          </table>
        </div>
      </section>
      <section class="card">
        <div class="card-head">
          <h2 id="tab-title">Disponibilidad</h2>
          <div class="seg" id="panel-tabs"></div>
        </div>
        <div class="tab-body" id="tab-body"></div>
      </section>
    </div>`;

  {
    const btnAvisos = document.getElementById('btn-avisos');
    if (btnAvisos && 'Notification' in window && Notification.permission === 'default') {
      btnAvisos.hidden = false;
      btnAvisos.addEventListener('click', () => {
        Notification.requestPermission().then(p => {
          if (p === 'granted') { btnAvisos.hidden = true; toast('Avisos del navegador activados', 'bell'); }
          else toast('Avisos bloqueados: actívalos en los permisos del sitio', 'bell');
        });
      });
    }
  }

  // ---------- renders ----------
  function updateKPIs() {
    const db = Store.db;
    const hoy = new Date().toDateString();
    const todays = db.orders.filter(o => new Date(o.createdAt).toDateString() === hoy);
    const ingresos = db.orders.filter(o => o.payStatus === 'aprobado' || o.payStatus === 'cobrado').reduce((s, o) => s + o.total, 0);
    const validos = db.orders.filter(o => o.status !== 'cancelado').length;
    const pendientes = db.orders.filter(o => ['nuevo', 'preparando', 'enviado'].includes(o.status)).length;
    document.getElementById('kpis').innerHTML = [
      ['receipt', 'gold', 'Pedidos hoy', todays.length],
      ['cash', 'green', 'Ingresos', Store.money(ingresos)],
      ['zap', 'blue', 'Ticket promedio', Store.money(ingresos / Math.max(1, validos))],
      ['clock', 'amber', 'Pendientes', pendientes],
    ].map(([ic, cl, k, v]) => `
      <div class="kpi"><div class="ic ${cl}">${icon(ic, 17)}</div><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
  }

  function filteredOrders() {
    const f = ui.filter;
    return Store.db.orders.filter(o =>
      f === 'todos' ? true :
      f === 'activos' ? ['nuevo', 'preparando', 'enviado'].includes(o.status) :
      f === 'entregados' ? o.status === 'entregado' :
      o.status === 'cancelado');
  }

  function updateFilters() {
    document.getElementById('order-filters').innerHTML = [
      ['todos', 'Todos'], ['activos', 'En curso'], ['entregados', 'Entregados'], ['cancelados', 'Cancelados'],
    ].map(([v, l]) => `<button class="${ui.filter === v ? 'on' : ''}" data-act="filter" data-v="${v}">${l}</button>`).join('');
  }

  function updateOrders() {
    const list = filteredOrders();
    document.getElementById('orders-body').innerHTML = list.map(o => `
      <tr class="${o.status === 'cancelado' ? 'dim-row' : ''}">
        <td><div class="strong mono">${o.id}</div><div class="cell-sub">${Store.hora(o.createdAt)}${o.deliveryDate ? ` · entrega ${Store.fecha(o.deliveryDate)}` : ''}</div></td>
        <td><div>${Store.esc(o.customer.name)}</div><div class="cell-sub">${Store.esc(o.customer.phone)} · ${Store.esc(o.customer.address)}</div></td>
        <td class="items-cell" title="${o.items.map(it => `${it.qty}× ${Store.esc(it.name)}${tamTxt(it)}`).join(', ')}">${o.items.map(it => `${it.qty}× ${Store.esc(it.name)}${tamTxt(it)}`).join(', ')}</td>
        <td class="num">${Store.money(o.total)}</td>
        <td><span class="badge ${PAY[o.payStatus]}"><span class="dot"></span>${o.payStatus}${o.payMethod === 'efectivo' ? ' · efvo.' : ' · transf.'}</span></td>
        <td><span class="badge ${META[o.status].badge}"><span class="dot"></span>${STATUS_LABEL[o.status]}</span></td>
        <td class="row-actions">
          ${Store.NEXT[o.status] ? `<button class="btn sm" data-act="advance" data-id="${o.id}" title="Avanzar a ${STATUS_LABEL[Store.NEXT[o.status]]}">${icon('arrow', 14)} ${STATUS_LABEL[Store.NEXT[o.status]]}</button>` : ''}
          ${!['entregado', 'cancelado'].includes(o.status) ? `<button class="btn sm icon" data-act="ask-cancel" data-id="${o.id}" title="Cancelar pedido">${icon('x', 14)}</button>` : ''}
        </td>
      </tr>`).join('') || '<tr><td colspan="7"><div class="empty">Sin pedidos en este filtro</div></td></tr>';
  }

  function updateTab() {
    const db = Store.db;
    document.getElementById('panel-tabs').innerHTML = [
      ['inventario', 'Disponibilidad'], ['clientes', 'Clientes'], ['actividad', 'Actividad'],
    ].map(([v, l]) => `<button class="${ui.tab === v ? 'on' : ''}" data-act="tab" data-v="${v}">${l}</button>`).join('');

    const body = document.getElementById('tab-body');
    document.getElementById('tab-title').textContent = { inventario: 'Disponibilidad del día', clientes: 'Clientes', actividad: 'Actividad reciente' }[ui.tab];

    if (ui.tab === 'inventario') {
      body.innerHTML = `<table class="table">
        <thead><tr><th>Producto</th><th class="num" style="text-align:right">Precio</th><th>Stock</th><th></th></tr></thead>
        <tbody>${db.products.map(p => `
          <tr>
            <td><div style="display:flex;align-items:center;gap:10px">${pimg(p, 30)}<b>${Store.esc(p.name)}</b></div></td>
            <td class="num">${Store.money(p.price)}</td>
            <td><div class="stockbar"><span class="bar"><i style="width:${Math.min(100, p.stock / 30 * 100)}%;background:${stockDot(p.stock)}"></i></span><span style="font-size:12.5px;color:var(--text-2)">${p.stock} u</span></div></td>
            <td class="row-actions"><button class="btn sm" data-act="restock" data-id="${p.id}" title="Ampliar capacidad del día">+5</button></td>
          </tr>`).join('')}</tbody>
      </table>`;
    } else if (ui.tab === 'clientes') {
      body.innerHTML = `<table class="table">
        <thead><tr><th>Cliente</th><th>Teléfono</th><th class="num" style="text-align:right">Pedidos</th><th class="num" style="text-align:right">Consumo</th></tr></thead>
        <tbody>${db.customers.map(c => `
          <tr><td><b>${Store.esc(c.name)}</b></td><td class="mono">${Store.esc(c.phone)}</td><td class="num">${c.orders}</td><td class="num">${Store.money(c.spent)}</td></tr>`).join('')
          || '<tr><td colspan="4"><div class="empty">Sin clientes aún</div></td></tr>'}</tbody>
      </table>`;
    } else {
      const IC = { order: 'receipt', stock: 'package', pay: 'cash', client: 'users' };
      const CL = { order: 'gold', stock: 'amber', pay: 'green', client: 'blue' };
      body.innerHTML = `<div class="feed">${db.notifications.map(n => `
        <div class="feed-item">
          <span class="ic ${CL[n.kind] || 'gold'}">${icon(IC[n.kind] || 'bell', 15)}</span>
          <div><div class="tx">${Store.esc(n.text)}</div><div class="tm">${n.at}</div></div>
        </div>`).join('') || '<div class="empty">Sin actividad</div>'}</div>`;
    }
  }

  // ---------- exportación de movimientos a PDF ----------
  const EST_RGB = {
    nuevo: [0.18, 0.45, 0.72], preparando: [0.37, 0.26, 0.6], enviado: [0.54, 0.35, 0.06],
    entregado: [0.14, 0.4, 0.23], cancelado: [0.58, 0.22, 0.17],
  };
  const FILTER_LABEL = { todos: 'Todos', activos: 'En curso', entregados: 'Entregados', cancelados: 'Cancelados' };

  function buildExport() {
    const ahora = new Date();
    const p2 = n => String(n).padStart(2, '0');
    const filas = filteredOrders().map(o => {
      const d = new Date(o.createdAt);
      return [
        o.id,
        `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`,
        o.deliveryDate ? Store.fecha(o.deliveryDate) : '',
        o.customer.name,
        o.items.map(it => `${it.qty}× ${it.name}`).join(', '),
        `${o.payStatus}${o.payMethod === 'efectivo' ? ' efvo.' : ' transf.'}`,
        { t: STATUS_LABEL[o.status], rgb: EST_RGB[o.status] },
        Store.money(o.total),
      ];
    });
    const pagados = Store.db.orders.filter(o => o.status !== 'cancelado' && ['aprobado', 'cobrado'].includes(o.payStatus)).reduce((s, o) => s + o.total, 0);
    const pendiente = Store.db.orders.filter(o => o.status !== 'cancelado' && o.payStatus === 'pendiente').reduce((s, o) => s + o.total, 0);
    return {
      titulo: 'Tortas · Hechas a Mano — Reporte de movimientos',
      sub: `Generado el ${ahora.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })} a las ${p2(ahora.getHours())}:${p2(ahora.getMinutes())} · Filtro: ${FILTER_LABEL[ui.filter]}`,
      resumen: `Pedidos: ${filas.length}    ·    Pagados: ${Store.money(pagados)}    ·    Pendiente de cobro: ${Store.money(pendiente)}    ·    Cancelados: ${Store.db.orders.filter(o => o.status === 'cancelado').length}`,
      columnas: [
        { t: 'Pedido', ancho: 52 }, { t: 'Fecha', ancho: 56 }, { t: 'Entrega', ancho: 48 },
        { t: 'Cliente', ancho: 92 }, { t: 'Artículos', ancho: 117 }, { t: 'Pago', ancho: 62 },
        { t: 'Estado', ancho: 48 }, { t: 'Total', ancho: 40, align: 'right' },
      ],
      filas,
      pie: 'Tortas · Hechas a Mano — sistema de pedidos (prototipo)',
    };
  }

  function exportPdf() {
    const payload = buildExport();
    const bytes = PDFMovimientos.build(payload);
    PDFMovimientos.download(bytes, `movimientos-tortas-${new Date().toISOString().slice(0, 10)}.pdf`);
    Store.event('panel', `exportó PDF de movimientos (${payload.filas.length} filas)`);
    toast('Reporte PDF descargado', 'check');
  }

  function updateAll() { updateKPIs(); updateFilters(); updateOrders(); updateTab(); }

  // ---------- eventos ----------
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const { act, id, v } = el.dataset;
    switch (act) {
      case 'advance': Store.advanceOrder(id).catch(err => toast(Store.esc(err.message), 'bell')); break;
      case 'ask-cancel':
        confirmDialog({
          title: `¿Cancelar pedido ${id}?`,
          body: 'El stock reservado volverá a la disponibilidad y el cliente quedará notificado.',
          ok: 'Cancelar pedido',
          onOk: () => Store.cancelOrder(id).catch(err => toast(Store.esc(err.message), 'bell')),
        });
        break;
      case 'confirm-ok': { const cb = pendingConfirm; pendingConfirm = null; closeModal(); cb && cb(); break; }
      case 'modal-close': closeModal(); break;
      case 'restock': Store.restock(id).catch(err => toast(Store.esc(err.message), 'bell')); break;
      case 'filter': ui.filter = v; updateFilters(); updateOrders(); break;
      case 'export-pdf': exportPdf(); break;
      case 'tab': ui.tab = v; updateTab(); break;
    }
  });

  // cualquier cambio (local o de las otras páginas) redibuja el panel
  Store.subscribe(updateAll);

  // pedidos reales entre dispositivos: la web pública hace commit de
  // data/pedidos.json (via Apps Script) y este panel lo lee desde Pages
  const FUENTE_PEDIDOS = 'https://shusukegxe.github.io/venta-tortas-caseras/data/pedidos.json';
  async function sondearRemoto() {
    try {
      const res = await fetch(FUENTE_PEDIDOS, { cache: 'no-store' });
      if (!res.ok) return;
      const ordenes = await res.json();
      const n = Store.mergeRemote(ordenes);
      if (n > 0) { avisarNavegador(n); toast(`${n} pedido${n > 1 ? 's' : ''} nuevo${n > 1 ? 's' : ''} de la web`, 'receipt'); }
    } catch { /* sin conexión o sin archivo: sigue el modo demo */ }
  }
  sondearRemoto();
  setInterval(sondearRemoto, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sondearRemoto(); });

  updateAll();
})();
