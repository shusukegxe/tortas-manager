'use strict';
/* Tortas · Hechas a Mano — núcleo: estado + API simulada + sincronización entre pestañas.
   Adaptado del prototipo PedidosExpress usando como referencia el repo venta-tortas-caseras
   (catálogo, precios y estética). El "backend" es un setTimeout y la "base de datos" es
   localStorage, pero la forma de las operaciones es la que tendría una API real. */

const Store = (() => {
  const KEY = 'tortas-pedidos-v1';
  const LOW = 3;

  // ---------- utilidades ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const lat = () => 80 + Math.random() * 140;
  const money = n => '$' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');  // CLP: $18.000
  const fecha = s => s ? new Date(s + 'T12:00:00').toLocaleDateString('es', { day: 'numeric', month: 'short' }) : '';
  const hora = t => new Date(t).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  const ahora = () => new Date().toLocaleTimeString('es', { hour12: false });
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  // ---------- la base de datos ----------
  function seedDb() {
    const t = Date.now();
    const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    return {
      seq: 3,
      products: [
        { id: 'p1', img: 'selva-negra.png',   name: 'Selva Negra', desc: 'Bizcocho de chocolate, crema chantilly, cerezas y virutas.', price: 18000, stock: 7 },
        { id: 'p2', img: 'tres-leches.png',   name: 'Tres Leches', desc: 'Clásica y jugosa, con un toque de canela y crema suave.',     price: 17000, stock: 10 },
        { id: 'p3', img: 'cheesecake.png',    name: 'Cheesecake',  desc: 'Base de galleta, crema de queso y salsa de berries casera.', price: 20000, stock: 6 },
        { id: 'p4', img: 'chantilly.png',     name: 'Torta de Chantilly', desc: 'Suave, esponjosa y decorada con crema y frutas.',      price: 16500, stock: 8 },
        { id: 'p5', img: 'personalizada.png', name: 'Personalizada', desc: 'Cuéntanos tu idea y la hacemos realidad.',                price: 22000, stock: 4 },
      ],
      orders: [
        {
          id: 'O-0001', customer: { name: 'Ana Torres', phone: '555-0101', address: 'Calle 1 #23', note: 'para un cumpleaños' },
          items: [{ pid: 'p3', name: 'Cheesecake', price: 20000, qty: 1 }],
          total: 20000, payMethod: 'transferencia', payStatus: 'aprobado', status: 'entregado',
          deliveryDate: ayer, createdAt: t - 86400000,
          history: [{ status: 'nuevo', at: t - 86400000 }, { status: 'entregado', at: t - 86400000 + 3600000 }],
        },
        {
          id: 'O-0002', customer: { name: 'Luis Pérez', phone: '555-0102', address: 'Av. Central #45', note: 'sin azúcar extra' },
          items: [{ pid: 'p1', name: 'Selva Negra', price: 18000, qty: 1 }],
          total: 18000, payMethod: 'efectivo', payStatus: 'pendiente', status: 'nuevo',
          deliveryDate: manana, createdAt: t - 3600000,
          history: [{ status: 'nuevo', at: t - 3600000 }],
        },
      ],
      customers: [
        { phone: '555-0101', name: 'Ana Torres', orders: 1, spent: 20000 },
        { phone: '555-0102', name: 'Luis Pérez', orders: 1, spent: 18000 },
      ],
      notifications: [
        { kind: 'order', text: 'Sistema iniciado con datos de ejemplo.', at: '09:00:00' },
      ],
      events: [],
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.products)) return d;
      }
    } catch {}
    return null;
  }

  function seedAndWrite() {
    const d = seedDb();
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {}
    return d;
  }

  let db = load() || seedAndWrite();
  const prod = id => db.products.find(p => p.id === id);

  // ---------- sincronización entre pestañas ----------
  const bus = 'BroadcastChannel' in window ? new BroadcastChannel('tortas-pedidos-v1') : null;
  const subs = new Set();
  const emit = () => { for (const fn of subs) { try { fn(); } catch {} } };
  window.addEventListener('storage', e => { if (e.key === KEY || e.key === null) sync(); });
  if (bus) bus.onmessage = () => sync();
  let syncing = false;
  function sync() {
    if (syncing) return;
    syncing = true;
    try {
      const fresh = load();
      if (fresh) { db = fresh; emit(); }
    } finally { syncing = false; }
  }
  function subscribe(fn) { subs.add(fn); }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {}
    try { bus && bus.postMessage(Date.now()); } catch {}
  }

  // ---------- registro de eventos (lo que ve devtools) ----------
  function record(e) {
    db.events.unshift({ at: ahora(), ...e });
    if (db.events.length > 150) db.events.length = 150;
    save();
    emit();
  }
  // evento de dominio (sin http): "bajo stock", "pedido creado"...
  function event(module, label) { record({ kind: 'ev', module, label }); }

  // ---------- API simulada ----------
  async function api(method, path, modules, source, work) {
    const t0 = performance.now();
    await sleep(lat());
    try {
      const res = await work();
      record({ kind: 'http', method, path, modules, source, status: (res && res.status) || 200, ms: Math.round(performance.now() - t0), label: res && res.reason });
      return res;
    } catch (err) {
      record({ kind: 'http', method, path, modules, source, status: err.status || 400, ms: Math.round(performance.now() - t0), label: err.message });
      throw err;
    }
  }

  // ---------- módulo notificaciones ----------
  function notify(kind, text) {
    db.notifications.unshift({ kind, text, at: ahora() });
    if (db.notifications.length > 40) db.notifications.length = 40;
  }

  function checkLow(p) {
    if (p.stock <= LOW && !p.lowWarned) {
      p.lowWarned = true;
      event('inventario', `bajo stock: ${p.name} (${p.stock} u)`);
      notify('stock', `Bajo stock: ${p.name} — quedan ${p.stock} u`);
    } else if (p.stock > LOW) p.lowWarned = false;
  }

  // ---------- operaciones de negocio ----------
  const NEXT = { nuevo: 'preparando', preparando: 'enviado', enviado: 'entregado' };
  const STATUS_LABEL = { nuevo: 'Nuevo', preparando: 'En preparación', enviado: 'En camino', entregado: 'Entregado', cancelado: 'Cancelado' };
  const FLOW = ['nuevo', 'preparando', 'enviado', 'entregado'];

  async function placeOrder(draft) {
    return api('POST', '/pedidos', ['pedidos', 'clientes', 'inventario', 'pagos'], 'cliente', async () => {
      if (!draft.items.length) { const e = new Error('El carrito está vacío'); e.status = 400; throw e; }

      event('clientes', `upsert cliente ${draft.phone}`);
      let cust = db.customers.find(c => c.phone === draft.phone);
      if (!cust) db.customers.push(cust = { phone: draft.phone, name: draft.name, orders: 0, spent: 0 });

      for (const it of draft.items) {
        const p = prod(it.pid);
        if (!p || p.stock < it.qty) { const e = new Error(`Stock insuficiente de ${it.name}`); e.status = 409; throw e; }
      }
      event('inventario', `stock reservado (${draft.items.length} artículos)`);

      let payStatus = 'pendiente';
      if (draft.payMethod === 'transferencia') {
        event('pagos', 'autorizando tarjeta…');
        await sleep(lat());
        payStatus = draft.forceDecline ? 'rechazado' : (Math.random() < 0.9 ? 'aprobado' : 'rechazado');
        event('pagos', `autorización: ${payStatus}`);
      }
      if (payStatus === 'rechazado') {
        notify('pay', `Pago rechazado de ${draft.name}`);
        save();
        return { ok: false, status: 402, reason: 'El pago fue rechazado. Prueba con otro método.' };
      }

      const id = 'O-' + String(db.seq++).padStart(4, '0');
      const order = {
        id,
        customer: { name: draft.name, phone: draft.phone, address: draft.address, note: draft.note },
        items: draft.items.map(it => ({ ...it })),
        total: draft.items.reduce((s, it) => s + it.price * it.qty, 0),
        payMethod: draft.payMethod, payStatus, status: 'nuevo',
        deliveryDate: draft.deliveryDate || '',
        createdAt: Date.now(), history: [{ status: 'nuevo', at: Date.now() }],
      };
      for (const it of order.items) { const p = prod(it.pid); p.stock -= it.qty; checkLow(p); }
      db.orders.unshift(order);
      cust.orders++; cust.spent += order.total;
      event('pedidos', `${id} creado · ${money(order.total)}`);
      notify('order', `Nuevo pedido ${id} de ${draft.name} · ${money(order.total)}`);
      save();
      return { ok: true, order };
    });
  }

  async function advanceOrder(id) {
    return api('PATCH', `/pedidos/${id}`, ['pedidos', 'pagos'], 'panel', async () => {
      const o = db.orders.find(x => x.id === id);
      const next = NEXT[o.status];
      if (!next) { const e = new Error('El pedido ya está en estado final'); e.status = 409; throw e; }
      o.status = next;
      o.history.push({ status: next, at: Date.now() });
      if (next === 'entregado' && o.payMethod === 'efectivo' && o.payStatus === 'pendiente') {
        o.payStatus = 'cobrado';
        event('pagos', `cobro en efectivo registrado (${id})`);
      }
      event('pedidos', `${id} → ${STATUS_LABEL[next].toLowerCase()}`);
      notify('order', `Pedido ${id}: ${STATUS_LABEL[next]}`);
      save();
      return o;
    });
  }

  async function cancelOrder(id) {
    return api('PATCH', `/pedidos/${id}`, ['pedidos', 'inventario'], 'panel', async () => {
      const o = db.orders.find(x => x.id === id);
      if (!o || o.status === 'entregado' || o.status === 'cancelado') { const e = new Error('No cancelable'); e.status = 409; throw e; }
      o.status = 'cancelado';
      o.history.push({ status: 'cancelado', at: Date.now() });
      for (const it of o.items) { const p = prod(it.pid); if (p) { p.stock += it.qty; checkLow(p); } }
      event('inventario', `stock devuelto (${id})`);
      event('pedidos', `${id} cancelado`);
      notify('order', `Pedido ${id} cancelado · stock repuesto`);
      save();
      return o;
    });
  }

  async function restock(pid) {
    return api('POST', `/inventario/${pid}/reposicion`, ['inventario'], 'panel', async () => {
      const p = prod(pid);
      p.stock += 5; p.lowWarned = false;
      event('inventario', `reposición: ${p.name} +5 u (${p.stock} u)`);
      notify('stock', `Reposición: ${p.name} ahora ${p.stock} u`);
      save();
      return p;
    });
  }

  function resetDemo() {
    db = seedAndWrite();
    save();
    emit();
  }

  return {
    get db() { return db; },
    LOW, NEXT, FLOW, STATUS_LABEL,
    money, fecha, hora, ahora, esc,
    subscribe, save, prod, event,
    placeOrder, advanceOrder, cancelOrder, restock, resetDemo,
  };
})();
