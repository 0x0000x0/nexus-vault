// Injected test helpers for screenshot runs (Grok Bot).
window.T = {
  q: (s) => document.querySelector(s),
  qa: (s) => [...document.querySelectorAll(s)],
  row: (rel) => document.querySelector(`.row[data-rel="${CSS.escape(rel)}"]`),
  click: (el) => { el.click(); return !!el; },
  center: (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
  ctx: (el) => { const c = T.center(el); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: c.x, clientY: c.y, button: 2 })); return true; },
  pd: (el, x, y, opts = {}) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true, ...opts })),
  pm: (x, y) => window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerId: 1 })),
  pu: (x, y) => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerId: 1 })),
  card: (title) => T.qa('.bnode').find((n) => (n.querySelector('.ct,.fhead b')?.textContent ?? '') === title),
  key: (el, key, opts = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts })),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  async drag(el, dx, dy) { const c = T.center(el); T.pd(el, c.x, c.y); await T.sleep(50); T.pm(c.x + dx / 2, c.y + dy / 2); await T.sleep(50); T.pm(c.x + dx, c.y + dy); await T.sleep(50); T.pu(c.x + dx, c.y + dy); await T.sleep(100); },
  async line(a, b) { const h = a.querySelector('.conn'); const ca = T.center(h); const cb = T.center(b); T.pd(h, ca.x, ca.y); await T.sleep(50); T.pm(cb.x, cb.y); await T.sleep(80); T.pu(cb.x, cb.y); await T.sleep(100); },
};
'loaded';
