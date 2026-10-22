const SOFA = (() => {
  const SEL = 'button:not([disabled]), a[href], a.lnk, input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), .card, .rb, .chip, .theme, .sact, .tile, .item, .now, .gwc, .sw';
  const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  const st = { on: false, cur: null, lastKey: '', lastRect: null, prev: [], held: {}, loop: 0, bar: null, barT: 0, told: false, mouse: 0, moT: 0, main: null };
  const anim = () => document.documentElement.dataset.anim === 'off' || (S.config && S.config.reduce_motion) ? 'auto' : 'smooth';
  const enabled = () => !S.config || (S.config.gamepad || 'auto') !== 'off';
  const scope = () => {
    const ctx = $('#ctx'), modal = $('#modal'), det = $('#detail'), wel = $('#welcome'), fl = $('#flashwin'), term = $('#term');
    if (ctx && ctx.classList.contains('on')) return ctx;
    if (modal && modal.classList.contains('on')) return $('#modalBox');
    if (wel && wel.classList.contains('on')) return wel;
    if (fl && fl.classList.contains('on')) return fl;
    if (det && det.classList.contains('on')) return det;
    return document.body;
  };
  const visible = el => {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return false;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.pointerEvents === 'none' || +cs.opacity === 0) return false;
    const card = el.closest('.card'); if (card && card !== el) return false;
    const pop = el.closest('.bellpop, .helppop, .toasts, .splash, .sofabar'); if (pop && !pop.classList.contains('on')) return false;
    return true;
  };
  const cands = () => {
    const root = scope(), all = [...root.querySelectorAll(SEL)].filter(visible);
    if (root !== document.body) return all;
    return all.filter(el => !el.closest('#modal, #ctx, #detail, #flashwin, #welcome'));
  };
  const scroller = () => {
    const root = scope();
    if (root === document.body) return $('#view');
    if (root.id === 'detail') return root.querySelector('.dwrap') || root;
    return root;
  };
  const rectOf = el => el.getBoundingClientRect();
  const pick = dir => {
    const list = cands(); if (!list.length) return null;
    if (!st.cur || !st.cur.isConnected || !list.includes(st.cur)) return reacquire(list);
    const a = rectOf(st.cur), ax = (a.left + a.right) / 2, ay = (a.top + a.bottom) / 2;
    let best = null, bs = Infinity;
    for (const el of list) {
      if (el === st.cur) continue;
      const b = rectOf(el), bx = (b.left + b.right) / 2, by = (b.top + b.bottom) / 2;
      let d1, d2;
      if (dir === 'right') { d1 = b.left - a.right; if (bx <= ax + 2) continue; d2 = Math.max(0, a.top - b.bottom, b.top - a.bottom); }
      else if (dir === 'left') { d1 = a.left - b.right; if (bx >= ax - 2) continue; d2 = Math.max(0, a.top - b.bottom, b.top - a.bottom); }
      else if (dir === 'down') { d1 = b.top - a.bottom; if (by <= ay + 2) continue; d2 = Math.max(0, a.left - b.right, b.left - a.right); }
      else { d1 = a.top - b.bottom; if (by >= ay - 2) continue; d2 = Math.max(0, a.left - b.right, b.left - a.right); }
      if (d1 < -Math.min(a.width, a.height) * .6) continue;
      const align = dir === 'left' || dir === 'right' ? Math.abs(by - ay) : Math.abs(bx - ax);
      const s = Math.max(0, d1) + d2 * 3 + align * .4;
      if (s < bs) { bs = s; best = el; }
    }
    return best;
  };
  const reacquire = list => {
    list = list || cands(); if (!list.length) return null;
    if (st.lastKey) { const k = list.find(el => el.dataset && el.dataset.key === st.lastKey); if (k) return k; }
    if (st.lastRect) {
      const cx = (st.lastRect.left + st.lastRect.right) / 2, cy = (st.lastRect.top + st.lastRect.bottom) / 2;
      let best = null, bd = Infinity;
      for (const el of list) { const r = rectOf(el); const d = Math.hypot((r.left + r.right) / 2 - cx, (r.top + r.bottom) / 2 - cy); if (d < bd) { bd = d; best = el; } }
      if (best) return best;
    }
    const sel = list.find(el => el.classList.contains('card') && el.classList.contains('sel')) || list.find(el => el.classList.contains('card')) || list.find(el => el.classList.contains('btn') && (el.classList.contains('p') || el.classList.contains('g')));
    return sel || list[0];
  };
  const setCur = el => {
    if (st.cur && st.cur !== el) st.cur.classList.remove('sf');
    st.cur = el; if (!el) return;
    el.classList.add('sf');
    if (el.dataset && el.dataset.key) st.lastKey = el.dataset.key;
    if (scope() === document.body) st.main = el;
    try { if (el.matches('button, a, input, select, textarea, [tabindex]')) el.focus({ preventScroll: true }); else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); } catch (e) { }
    el.scrollIntoView({ block: el.classList.contains('card') || el.classList.contains('theme') ? 'center' : 'nearest', inline: 'nearest', behavior: anim() });
    st.lastRect = rectOf(el);
  };
  const move = dir => { const el = pick(dir); if (el) setCur(el); else if (st.cur && !st.cur.isConnected) setCur(reacquire()); };
  const cardKey = () => st.cur && st.cur.classList.contains('card') ? st.cur.dataset.key : '';
  const activate = () => {
    if (!st.cur || !st.cur.isConnected) return setCur(reacquire());
    const el = st.cur;
    if (el.tagName === 'SELECT') { el.focus(); return; }
    if (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(el.type)) { el.focus(); return; }
    if (el.classList.contains('card') && S.view === 'home' && typeof selectGame === 'function') { const k = el.dataset.key; if (S.panelKey === k && typeof openGame === 'function') openGame(k); else selectGame(k); return; }
    el.click();
  };
  const back = () => {
    setTimeout(() => { if (!st.on) return; const m = st.main; if (scope() === document.body && m && m.isConnected && visible(m)) setCur(m); else if (!st.cur || !st.cur.isConnected || !cands().includes(st.cur)) setCur(reacquire()); }, 140);
    const ctx = $('#ctx'), modal = $('#modal'), det = $('#detail');
    if (ctx && ctx.classList.contains('on')) return closeCtx();
    if (modal && modal.classList.contains('on')) { const no = $('#mNo'); if (no) no.click(); else modal.classList.remove('on'); return; }
    if ($('#flashwin') && $('#flashwin').classList.contains('on') && typeof closeFlash === 'function') return closeFlash();
    if (det && det.classList.contains('on')) return closeDetail();
    if (S.panelKey && typeof panelClose === 'function') return panelClose();
    if (S.view !== 'home') { setView('home'); return; }
    const q = $('#q'); if (q && q.value && typeof clearSearch === 'function') clearSearch();
  };
  const menu = () => {
    const k = cardKey() || (S.panelKey && scope() === document.body ? S.panelKey : '');
    if (k && typeof ctxMenu === 'function') { const r = st.cur ? rectOf(st.cur) : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 }; ctxMenu(k, r.left + Math.min(r.width, 160), r.top + Math.min(r.height / 2, 120)); }
  };
  const start = () => {
    const k = cardKey(); const g = k && S.byKey ? S.byKey[k] : null;
    if (g && (g.installed || k.startsWith('rom:')) && typeof play === 'function') return play(k);
    const b = $('#gpanel .btn.p, #dWrap .acts > .btn.g, #dWrap .acts > .btn.p, .g-est .eacts .btn.p'); if (b && !b.disabled) b.click();
  };
  const tabs = d => {
    const list = navOrder().filter(v => !(S.config.nav_hidden || []).includes(v)).concat(['settings']);
    const i = Math.max(0, list.indexOf(S.view)); const v = list[(i + d + list.length) % list.length];
    if (typeof closeDetail === 'function') closeDetail(); setView(v);
    setTimeout(() => setCur(reacquire()), 350);
  };
  const scrollBy = (dx, dy) => { const s = scroller(); if (s) s.scrollBy({ left: dx, top: dy, behavior: 'auto' }); };
  const selectStep = d => { const el = st.cur; if (!el || el.tagName !== 'SELECT') return false; const n = el.options.length; if (!n) return true; el.selectedIndex = (el.selectedIndex + d + n) % n; el.dispatchEvent(new Event('change', { bubbles: true })); return true; };
  const act = (b, held) => {
    if (b === BTN.UP) move('up'); else if (b === BTN.DOWN) move('down');
    else if (b === BTN.LEFT) { if (!selectStep(-1)) move('left'); } else if (b === BTN.RIGHT) { if (!selectStep(1)) move('right'); }
    else if (held) return;
    else if (b === BTN.A) activate(); else if (b === BTN.B) back(); else if (b === BTN.X) menu();
    else if (b === BTN.Y) { const k = cardKey(); if (k && typeof toggleFav === 'function') toggleFav(k); }
    else if (b === BTN.START) start(); else if (b === BTN.BACK && typeof focusSearch === 'function') focusSearch();
    else if (b === BTN.LB) tabs(-1); else if (b === BTN.RB) tabs(1);
    else if (b === BTN.LT) scrollBy(0, -innerHeight * .8); else if (b === BTN.RT) scrollBy(0, innerHeight * .8);
  };
  const on = () => {
    if (st.on || !enabled()) return;
    st.on = true; document.body.classList.add('sofa');
    if (typeof applyScale === 'function') applyScale();
    bar(true);
    if (!st.told) { st.told = true; if (typeof toast === 'function') toast('', 'Modo sofá', 'Controle detectado. Mexer o mouse volta ao normal.'); }
    setTimeout(() => setCur(reacquire()), 60);
  };
  const off = () => {
    if (!st.on) return;
    st.on = false; document.body.classList.remove('sofa');
    if (st.cur) st.cur.classList.remove('sf'); st.cur = null;
    if (typeof applyScale === 'function') applyScale();
    bar(false);
  };
  const bar = show => {
    if (!st.bar) {
      st.bar = document.createElement('div'); st.bar.className = 'sofabar';
      st.bar.innerHTML = ['A', 'Selecionar', 'B', 'Voltar', 'X', 'Menu', 'Y', 'Favorito', 'LB RB', 'Abas', '≡', 'Jogar'].map((x, i) => i % 2 ? `<span>${x}</span>` : `<kbd>${x}</kbd>`).join('');
      document.body.appendChild(st.bar);
    }
    clearTimeout(st.barT);
    st.bar.classList.toggle('on', !!show);
    if (show) st.barT = setTimeout(() => st.bar.classList.remove('on'), 4000);
  };
  const poll = () => {
    st.loop = 0;
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    if (!pads.length) return;
    const now = performance.now();
    let any = false;
    for (const p of pads) {
      const pressed = p.buttons.map(b => b.pressed || b.value > .5);
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0, rx = p.axes[2] || 0, ry = p.axes[3] || 0;
      if (Math.abs(ax) > .55) pressed[ax > 0 ? BTN.RIGHT : BTN.LEFT] = true;
      if (Math.abs(ay) > .55) pressed[ay > 0 ? BTN.DOWN : BTN.UP] = true;
      const key = p.index;
      const prev = st.prev[key] || [];
      for (let b = 0; b < pressed.length; b++) {
        const id = key + ':' + b;
        if (pressed[b] && !prev[b]) { any = true; st.held[id] = now + 330; if (!st.on) { on(); if (b >= BTN.UP) continue; } act(b, false); }
        else if (pressed[b] && prev[b] && b >= BTN.UP && now >= (st.held[id] || 0)) { st.held[id] = now + 115; if (st.on) act(b, true); any = true; }
      }
      st.prev[key] = pressed;
      if (st.on && (Math.abs(rx) > .3 || Math.abs(ry) > .3)) { scrollBy(rx * 18, ry * 18); any = true; }
    }
    if (any) { bar(true); st.mouse = 0; }
    st.loop = setTimeout(poll, st.on ? 16 : 100);
  };
  const ensure = () => { if (!st.loop) st.loop = setTimeout(poll, 0); };
  window.addEventListener('gamepadconnected', ensure);
  window.addEventListener('gamepaddisconnected', () => { const pads = [...navigator.getGamepads()].filter(Boolean); if (!pads.length) off(); });
  document.addEventListener('mousemove', e => { if (!st.on) return; st.mouse += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0); if (st.mouse > 40) off(); }, { passive: true });
  document.addEventListener('mousedown', () => off(), { passive: true });
  document.addEventListener('keydown', e => {
    if (!st.on) return;
    const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if (typing && e.key !== 'Escape') return;
    const map = { ArrowUp: BTN.UP, ArrowDown: BTN.DOWN, ArrowLeft: BTN.LEFT, ArrowRight: BTN.RIGHT, Enter: BTN.A, ' ': BTN.A, Backspace: BTN.B };
    if (map[e.key] === undefined) return;
    if (e.key === 'Enter' && document.activeElement && document.activeElement.matches('button, a')) return;
    e.preventDefault(); e.stopPropagation(); act(map[e.key], e.repeat); bar(true);
  }, true);
  const refresh = () => { if (!st.on) return; if (!st.cur || !st.cur.isConnected || !cands().includes(st.cur)) setCur(reacquire()); };
  const mo = new MutationObserver(() => { if (st.on) { clearTimeout(st.moT); st.moT = setTimeout(refresh, 120); } });
  mo.observe(document.body, { childList: true, subtree: true });
  setTimeout(ensure, 1500);
  return { on, off, active: () => st.on, focus: setCur, next: move, reacquire: () => setCur(reacquire()) };
})();
