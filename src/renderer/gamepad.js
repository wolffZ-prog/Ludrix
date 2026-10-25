const GP = { idx: -1, last: {}, focus: null, hint: null, t: null, active: false, edit: null, scr: null, scrAt: 0 };
function gpIndicator(st) { const el = $('#gpInd'); if (!el) return; const n = (st && st.connected) || [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean).length; el.classList.toggle('on', n > 0); }
window.addEventListener('gamepadconnected', e => { gpIndicator(); toast('ok', 'Controle conectado', e.gamepad.id.slice(0, 40)); gpLoop(); });
window.addEventListener('gamepaddisconnected', () => { gpIndicator(); gpClear(); });
window.onGamepadWake = why => { if (why === 'connected') toast('ok', 'Controle conectado', 'Use o D-pad para navegar · A abre · B volta'); gpLoop(); };
const GP_ANY = 'button:not([disabled]), a[href], input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea, .sw, .theme, .swatch, .radio label, .file, .site, .card, .src, .sf, .keyrow, .bn, .palr';
function gpVisible(els) { return els.filter(el => el.offsetParent !== null && !el.closest('[hidden], .off, [aria-hidden="true"]')); }
function gpFocusables() {
  if ($('#ctx').classList.contains('on')) return [...document.querySelectorAll('#ctx button:not([disabled])')];
  if ($('#pal') && $('#pal').classList.contains('on')) return gpVisible([...document.querySelectorAll('#pal .palr, #pal button')]);
  if ($('#modal').classList.contains('on')) return gpVisible([...document.querySelectorAll('#modalBox ' + GP_ANY.split(', ').join(', #modalBox '))]);
  if ($('#bellpop') && $('#bellpop').classList.contains('on')) return gpVisible([...document.querySelectorAll('#bellpop button, #bellpop .bn')]);
  if ($('#detail').classList.contains('on')) return gpVisible([...document.querySelectorAll('#detail .btn:not([disabled]), #detail .site, #detail .file, #detail .dtabs button, #detail .srcopt:not([disabled]), #detail .exelist button, #detail .shots img, #detail .kv a')]);
  if (S.view === 'settings') return gpVisible([...document.querySelectorAll('#toasts .toast.act button, #view .stabs button, #view .stoc a, #view .stoc button, #view .setfoot button, #view .setfoot .sw, #setBody ' + GP_ANY.split(', ').join(', #setBody '))]);
  return gpVisible([...document.querySelectorAll('#toasts .toast.act button, #view .card, #view .sf, #view .btn, #view .chip, #view select, #view input[type=range], #view input[type=checkbox], #view .src, #view .site, #view .tool .btn, #view .brow .btn, #view .radio label, #view .sw, #view .theme, #view .swatch, #view .seg button, #view .tabs button, #view button.lnk')]);
}
function gpSet(el) { if (GP.focus) GP.focus.classList.remove('gp-focus'); GP.focus = el; if (el) { el.classList.add('gp-focus'); el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); if (el.dataset.sk && el.dataset.sk !== S.stageKey) stageSet(el.dataset.sk); } }
function gpFocusFirst(sel) { const el = document.querySelector(sel); if (el) gpSet(el); }
function gpClear() { gpEdit(null); gpSet(null); $('.gphint')?.classList.remove('on'); GP.active = false; }
function gpEdit(el) { if (GP.edit) { GP.edit.classList.remove('gp-edit'); if (GP.edit.tagName === 'SELECT') GP.edit.blur(); } GP.edit = el; if (el) el.classList.add('gp-edit'); gpHint(); }
function gpStep(el, d) {
  if (el.tagName === 'SELECT') { const i = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + d)); if (i === el.selectedIndex) return; el.selectedIndex = i; el.dispatchEvent(new Event('change', { bubbles: true })); return; }
  if (el.type === 'range') { const v = +el.value; d > 0 ? el.stepUp() : el.stepDown(); if (+el.value === v) return; el.dispatchEvent(new Event('input', { bubbles: true })); clearTimeout(GP.rangeT); GP.rangeT = setTimeout(() => el.dispatchEvent(new Event('change', { bubbles: true })), 500); }
}
function gpHint() {
  const h = $('.gphint') || (document.body.insertAdjacentHTML('beforeend', '<div class="gphint on"></div>'), $('.gphint'));
  const edit = GP.edit ? '<span><b class="d">◂▸</b>ajustar</span><span><b class="a">A</b>pronto</span><span><b class="b">B</b>sair</span>' : '';
  const key = edit ? 'edit' : 'nav';
  if (h.dataset.k !== key) { h.dataset.k = key; h.innerHTML = edit || '<span><b class="a">A</b>selecionar / abrir</span><span><b class="b">B</b>voltar</span><span><b class="x">X</b>opções</span><span><b class="y">Y</b>buscar</span><span>LB/RB abas</span><span>LT/RT rolar</span><span>Start jogar</span>'; }
  h.classList.add('on');
}
function gpScroller() {
  const now = performance.now(); if (GP.scr && now - GP.scrAt < 600 && document.contains(GP.scr)) return GP.scr;
  const roots = $('#modal').classList.contains('on') ? ['#modalBox'] : $('#detail').classList.contains('on') ? ['#detail'] : ['#view', 'main'];
  let found = document.scrollingElement;
  outer: for (const sel of roots) { const r = document.querySelector(sel); if (!r) continue; for (const el of [r, ...r.querySelectorAll('*')]) { if (el.scrollHeight > el.clientHeight + 4) { const o = getComputedStyle(el).overflowY; if (o === 'auto' || o === 'scroll') { found = el; break outer; } } } }
  GP.scr = found; GP.scrAt = now; return found;
}
function gpScroll(dy, smooth) { const el = gpScroller(); if (!el) return; el.scrollBy({ top: dy, behavior: smooth ? 'smooth' : 'auto' }); }
function gpViews() { const vs = [...document.querySelectorAll('#rail .rb[data-view]')].filter(b => !b.classList.contains('nhid') && b.offsetParent !== null).map(b => b.dataset.view); return vs.length ? vs : ['home', 'store', 'emulation', 'downloads', 'settings']; }
function gpMove(dx, dy) {
  const els = gpFocusables(); if (!els.length) return;
  if (!GP.focus || !els.includes(GP.focus)) return gpSet(els[0]);
  const r = GP.focus.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best = null, bd = Infinity;
  for (const el of els) { if (el === GP.focus) continue; const b = el.getBoundingClientRect(); const ex = b.left + b.width / 2 - cx, ey = b.top + b.height / 2 - cy;
    const along = dx * ex + dy * ey; if (along <= 4) continue; const cross = Math.abs(dx ? ey : ex); const d = along + cross * 2.2; if (d < bd) { bd = d; best = el; } }
  if (best) gpSet(best);
}
function gpPress(btn) {
  GP.active = true; gpHint();
  const views = gpViews();
  if (GP.edit) {
    if (!document.contains(GP.edit)) gpEdit(null);
    else if (btn === 'a' || btn === 'b') return gpEdit(null);
    else if (btn === 'left' || btn === 'up') return gpStep(GP.edit, -1);
    else if (btn === 'right' || btn === 'down') return gpStep(GP.edit, 1);
    else return;
  }
  if (btn === 'lt') return gpScroll(-innerHeight * .7, true);
  if (btn === 'rt') return gpScroll(innerHeight * .7, true);
  if (btn === 'back') { if (S.view !== 'home') { setView('home'); setTimeout(() => gpFocusFirst('#view .card, #view .btn'), 250); } return; }
  switch (btn) {
    case 'a': { const f = GP.focus; if (!f) return gpMove(1, 0); if (f.classList.contains('card')) { if ($('#modal').classList.contains('on')) return; if (S.view === 'home' && !f.classList.contains('sel')) return selectGame(f.dataset.key); openGame(f.dataset.key); setTimeout(() => gpFocusFirst('#detail .btn.g, #detail .btn.p, #detail .btn'), 400); } else if (f.tagName === 'SELECT' || (f.tagName === 'INPUT' && f.type === 'range')) return gpEdit(f); else if (f.tagName === 'INPUT' && f.type === 'checkbox') f.click(); else if (f.tagName === 'TEXTAREA' || (f.tagName === 'INPUT' && ['text', 'search', 'number', 'url', 'password'].includes(f.type || 'text'))) { GP.typing = f; f.focus(); if (f.select) f.select(); } else if (f.classList.contains('palr')) { const i = [...$('#palList').querySelectorAll('.palr')].indexOf(f); if (i >= 0) palRun(i, false); } else f.click(); setTimeout(() => { const els = gpFocusables(); if (!els.includes(GP.focus)) gpSet(els[0]); }, 200); return; }
    case 'b': { if (GP.typing) { const t = GP.typing; GP.typing = null; if (document.activeElement === t) { t.blur(); return; } } if ($('#ctx').classList.contains('on')) return closeCtx(); if ($('#pal') && $('#pal').classList.contains('on')) return palClose(); if ($('#bellpop') && $('#bellpop').classList.contains('on')) return toggleBell(); if ($('#modal').classList.contains('on')) return $('#modal').classList.remove('on'); if (S.view === 'settings' && GP.focus && !GP.focus.closest('.stabs')) return gpFocusFirst('#view .stabs button.on, #view .stabs button'); if ($('#detail').classList.contains('on')) { closeDetail(); return setTimeout(() => gpFocusFirst('#view .card'), 200); } if (S.q) { S.q = ''; $('#q').value = ''; renderLibrary(); } return; }
    case 'x': { const f = GP.focus; if (f && f.classList.contains('card')) { const r = f.getBoundingClientRect(); ctxMenu(f.dataset.key, r.left + 20, r.top + 40); setTimeout(() => gpFocusFirst('#ctx button'), 250); } else if (S.det) { ctxMenu(S.det.key, innerWidth / 2 - 120, 120); setTimeout(() => gpFocusFirst('#ctx button'), 250); } return; }
    case 'y': focusSearch(); return;
    case 'lb': case 'rb': { const i = views.indexOf(S.view); setView(views[(i + (btn === 'rb' ? 1 : views.length - 1)) % views.length]); setTimeout(() => gpFocusFirst('#view .card, #view .btn'), 250); return; }
    case 'start': { if (GP.focus && GP.focus.classList.contains('card')) play(GP.focus.dataset.key); else if (S.det && S.det.installed) play(S.det.key); return; }
    case 'up': return gpMove(0, -1); case 'down': return gpMove(0, 1); case 'left': return gpMove(-1, 0); case 'right': return gpMove(1, 0);
  }
}
const DIRS = ['up', 'down', 'left', 'right'], GP_SPEED = { slow: [650, 260], normal: [520, 180], fast: [380, 110] };
function gpLoop() {
  if (GP.t) return; GP.t = true;
  const map = { 0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb', 6: 'lt', 7: 'rt', 8: 'back', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };
  let idle = 0;
  const tick = () => {
    if (S.config.gamepad_enabled === false || document.hidden) { if (GP.active) gpClear(); setTimeout(tick, 700); return; }
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    if (!pads.length) { GP.t = null; gpClear(); return; }
    const now = performance.now(); let any = false;
    for (const p of pads) {
      const st = GP.last[p.index] || (GP.last[p.index] = {});
      const [delay, rep] = GP_SPEED[S.config.gamepad_speed || 'normal'] || GP_SPEED.normal;
      const press = (name, down) => { const was = st[name] || 0; const dir = DIRS.includes(name);
        if (down && (!was || (dir && now - was > delay && now - (st[name + '_r'] || 0) > rep))) { if (!was) st[name] = now; st[name + '_r'] = now; gpPress(name); any = true; }
        if (!down) st[name] = 0; };
      const down = {};
      p.buttons.forEach((b, i) => { if (map[i] && b.pressed) down[map[i]] = true; });
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0, th = .7, rel = .45;
      const axis = (neg, pos, v) => { if (v < -th || (st[neg] && v < -rel)) down[neg] = true; if (v > th || (st[pos] && v > rel)) down[pos] = true; };
      axis('left', 'right', ax); axis('up', 'down', ay);
      for (const name of Object.values(map)) press(name, !!down[name]);
      const ry = p.axes[3] || 0; if (Math.abs(ry) > .3) { gpScroll(ry * 22, false); any = true; }
    }
    idle = any ? 0 : idle + 1;
    setTimeout(() => requestAnimationFrame(tick), idle > 30 ? 120 : 0);
  };
  requestAnimationFrame(tick);
}
function gpTester() {
  const B = [[12, 'up', '▲'], [13, 'down', '▼'], [14, 'left', '◀'], [15, 'right', '▶'], [0, 'a', 'A'], [1, 'b', 'B'], [2, 'x', 'X'], [3, 'y', 'Y'], [4, 'lb', 'LB'], [5, 'rb', 'RB'], [6, 'lt', 'LT'], [7, 'rt', 'RT'], [8, 'back', 'Back'], [9, 'start', 'Start'], [10, 'ls', 'L3'], [11, 'rs', 'R3'], [16, 'guide', 'Guide']];
  const cell = (id, l) => `<div class="gpt-b" data-b="${id}"><b>${l}</b><i></i></div>`;
  const html = `<div class="gpt"><div class="gpt-name" id="gptName">Nenhum controle detectado — aperte um botão</div>
    <div class="gpt-row"><div class="gpt-grp"><small>Direcional</small><div class="gpt-pad">${B.slice(0, 4).map(([i, id, l]) => cell(id, l)).join('')}</div></div>
      <div class="gpt-grp"><small>Botões</small><div class="gpt-pad">${B.slice(4, 8).map(([i, id, l]) => cell(id, l)).join('')}</div></div>
      <div class="gpt-grp"><small>Analógicos</small><div class="gpt-sticks"><div class="gpt-st" id="gptL"><span></span></div><div class="gpt-st" id="gptR"><span></span></div></div></div></div>
    <div class="gpt-line">${B.slice(8).map(([i, id, l]) => cell(id, l)).join('')}</div>
    <p class="mut" id="gptHint">Cada botão acende quando é apertado; gatilhos enchem conforme a força. O Ludrix lê o controle pelo padrão do navegador (mapa Xbox): se algum botão não acender, o Windows não está entregando ele.</p></div>`;
  let raf = 0, seen = new Set();
  const tick = () => {
    const box = $('#modal .gpt'); if (!box) { cancelAnimationFrame(raf); return; }
    const p = (navigator.getGamepads ? [...navigator.getGamepads()] : []).find(Boolean);
    const nm = $('#gptName');
    if (!p) { nm.textContent = 'Nenhum controle detectado — aperte um botão'; raf = requestAnimationFrame(tick); return; }
    nm.textContent = `${p.id.replace(/\(.*?\)/g, '').trim().slice(0, 60)} · ${p.mapping === 'standard' ? 'mapa padrão' : 'mapa não padrão'} · ${p.buttons.length} botões, ${p.axes.length} eixos`;
    for (const [i, id] of B) { const el = box.querySelector(`.gpt-b[data-b="${id}"]`); if (!el) continue; const b = p.buttons[i]; const v = b ? (b.value || (b.pressed ? 1 : 0)) : 0; el.classList.toggle('on', v > .05); el.querySelector('i').style.height = Math.round(v * 100) + '%'; if (v > .05) seen.add(id); }
    const st = (el, x, y) => { const dot = el.querySelector('span'); dot.style.transform = `translate(${Math.round(x * 22)}px,${Math.round(y * 22)}px)`; el.classList.toggle('on', Math.hypot(x, y) > .15); };
    st($('#gptL'), p.axes[0] || 0, p.axes[1] || 0); st($('#gptR'), p.axes[2] || 0, p.axes[3] || 0);
    const h = $('#gptHint'); if (seen.size >= 4 && h && !h.dataset.ok) { h.dataset.ok = 1; h.textContent = `${seen.size} botões já lidos. Tudo certo por aqui.`; }
    raf = requestAnimationFrame(tick);
  };
  modal({ title: 'Testar controle', html, noOk: true, cancel: 'Fechar', onClose: () => cancelAnimationFrame(raf) });
  raf = requestAnimationFrame(tick);
}
document.addEventListener('mousemove', () => { if (GP.active) { gpClear(); } }, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden && navigator.getGamepads && [...navigator.getGamepads()].some(Boolean)) gpLoop(); });
if (navigator.getGamepads && [...navigator.getGamepads()].some(Boolean)) gpLoop();
