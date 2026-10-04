# Tortas · Hechas a Mano — Panel del negocio

Página de gestión para el sistema de pedidos de **Tortas · Hechas a Mano**: aquí el
negocio recibe los pedidos hechos en la página de pedidos y los administra en vivo.

**Demo en vivo:** https://shusukegxe.github.io/tortas-manager/

Las tres aplicaciones del sistema (repos separados, mismo Store compartido vía
`localStorage` + `BroadcastChannel` en `shusukegxe.github.io`):

| Página | Repo | Qué hace |
|---|---|---|
| Hacer pedido | [pedidos-express](https://github.com/shusukegxe/pedidos-express) | Catálogo con fotos, carrito, checkout y WhatsApp. |
| **Panel del negocio** (esta) | [tortas-manager](https://github.com/shusukegxe/tortas-manager) | KPIs, gestión de pedidos, disponibilidad, clientes y actividad. |
| Estadísticas y DevTools | [tortas-devtools](https://github.com/shusukegxe/tortas-devtools) | Ventas por producto, ingresos por día, arquitectura en vivo, registro de la API. |

## Qué puede hacer el negocio aquí

- **Pedidos**: filtros (Todos / En curso / Entregados / Cancelados), avanzar estado con
  un click (`Recibido → En preparación → En camino → Entregado`) y cancelar con
  devolución de stock. La fecha de entrega aparece junto a cada pedido.
- **Disponibilidad del día**: stock de cada torta con barra; "+5" repone capacidad.
  Al bajar de 3 unidades salta alerta de bajo stock.
- **Clientes**: registro por teléfono con número de pedidos y consumo acumulado.
- **Actividad**: feed de notificaciones (pedidos nuevos, cambios de estado, pagos).
- **Exportar PDF**: botón en la cabecera de Pedidos — genera el reporte de
  movimientos (resumen + tabla con estados coloreados, paginado y numerado) con un
  generador de PDF propio, sin dependencias. Respeta el filtro activo.
- Todo se refresca **en vivo**: si entra un pedido desde otra pestaña (o desde la
  página de pedidos), el panel se actualiza solo.

## Técnica

SPA sin framework: `core.js` (Store: datos + API simulada + bus) + `app.js` (vista única)
+ `pdf.js` (generador de PDF propio) + `style.css` (design system kraft del negocio).
Sin build, sin dependencias.

Test funcional: `npm i jsdom && node test/smoke.cjs`.
