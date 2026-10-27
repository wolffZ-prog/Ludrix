'use strict';
const $ = s => document.querySelector(s);
const TOKEN = (m => { const t = m?.content || ''; m?.remove(); return t; })(document.querySelector('meta[name=ludrix-token]'));
const api = (() => {
  const listeners = {};
  const SILENT = new Set(['/api/window', '/api/log/ui', '/api/cancel', '/api/ui_ready']);
  const watchErr = (u, j) => {
    if (!j || typeof j !== 'object' || Array.isArray(j) || typeof j.error !== 'string' || !j.error || /^cancelad[oa]$/i.test(j.error)) return j;
    let seen = false; const msg = j.error;
    Object.defineProperty(j, 'error', { get() { seen = true; return msg; }, set(v) { }, enumerable: true, configurable: true });
    setTimeout(() => { if (!seen && typeof toast === 'function') toast('err', 'Não foi possível concluir', msg); }, 80);
    return j;
  };
  const req = async (u, opt, quiet) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), opt.timeout || 120000);
    try {
      const r = await fetch(u, { ...opt, headers: { 'X-Ludrix-Token': TOKEN, ...(opt.headers || {}) }, signal: ctl.signal });
      const j = await r.json().catch(() => ({ error: 'resposta inválida (' + r.status + ')' }));
      if (j && j.error && !quiet && r.status >= 500) console.warn('api', u, j.error);
      return j;
    } catch (e) { if (!quiet) console.warn('api', u, e); return { error: e.name === 'AbortError' ? 'tempo esgotado' : String(e.message || e) }; }
    finally { clearTimeout(t); }
  };
  const A = {
    get: (u, opt = {}) => req(u, { method: 'GET', ...opt }, opt.quiet),
    post: (u, b, opt = {}) => req(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}), ...opt }, opt.quiet).then(j => opt.quiet || SILENT.has(u) ? j : watchErr(u, j)),
    on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); return () => { listeners[ev] = (listeners[ev] || []).filter(f => f !== fn); }; },
    emit: (ev, data) => { for (const fn of listeners[ev] || []) { try { fn(data); } catch (e) { console.warn('evento', ev, e); } } },
    routes: {
      'config.get': () => Promise.resolve(S.config),
      'config.set': patch => setCfg(patch),
      'catalog.reload': force => loadCatalog(!!force),
      'game.play': key => play(key),
      'game.stop': key => A.post('/api/stop', { key }),
      'game.open': key => openGame(key),
      'game.install': key => A.post('/api/install', { key }),
      'game.uninstall': key => A.post('/api/uninstall', { key }),
      'game.fav': key => A.post('/api/fav', { key }),
      'view.set': v => setView(v),
      'updates.check': () => A.post('/api/updates/check', {}),
      'updates.download': () => A.post('/api/updates/download', {}),
      'updates.apply': () => A.post('/api/updates/apply', {}),
      'app.restart': () => A.post('/api/restart', {}),
      'app.open': path => A.post('/api/open', { path }),
      'app.url': url => A.post('/api/open_url', { url }),
      'window': cmd => winCmd(cmd),
      'theme.set': id => setCfg({ theme: id }),
      'backup.export': () => A.post('/api/backup/export', {}),
      'backup.import': path => A.post('/api/backup/import', { path }),
      'search': q => { S.q = q || ''; const i = $('#q'); if (i) i.value = S.q; if (!['home', 'store'].includes(S.view)) setView('home'); else renderLibrary(); return Promise.resolve({ ok: true, count: visible().length }); },
    },
    call: (name, ...args) => { const fn = A.routes[name]; return fn ? Promise.resolve(fn(...args)) : Promise.resolve({ error: 'chamada desconhecida: ' + name }); },
  };
  return A;
})();
const fmt = n => { if (!n) return ''; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return (i ? n.toFixed(1) : n) + ' ' + u[i]; };
const jsq = s => esc(JSON.stringify(String(s ?? '')));
const jso = o => esc(JSON.stringify(o ?? {}));
const SEP = () => S.config.os === 'windows' ? '\\' : '/';
const STATUS = [['plan', 'Planejo jogar'], ['playing', 'Jogando'], ['played', 'Jogado'], ['beaten', 'Zerado'], ['completed', 'Completado 100%'], ['on_hold', 'Em espera'], ['abandoned', 'Abandonado']];
const statusName = id => (STATUS.find(x => x[0] === id) || [])[1] || '';
const scoreHtml = (n, cls) => n ? `<span class="score ${cls || ''}" title="Sua nota">${'★'}${n}</span>` : '';
async function discordTest() {
  const r = await api.post('/api/discord/test', {});
  if (r && r.ok) toast('ok', 'Discord conectado', 'A atividade aparece quando um jogo abrir.'); else toast('warn', 'Discord', (r && r.error) || 'Não conectou.');
  renderSettings();
}
function hotkeyCapture(e, el) {
  e.preventDefault(); e.stopPropagation();
  const k = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta', 'OS'].includes(k)) return;
  const mods = []; if (e.ctrlKey) mods.push('Ctrl'); if (e.altKey) mods.push('Alt'); if (e.shiftKey) mods.push('Shift'); if (e.metaKey) mods.push('Super');
  if (k === 'Escape' && !mods.length) { el.blur(); return; }
  if (!mods.length) { toast('warn', 'Use um modificador', 'Combine com Ctrl, Alt, Shift ou Win.'); return; }
  const map = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc', Enter: 'Return', '+': 'Plus' };
  let key = map[k] || k;
  if (key.length === 1) key = key.toUpperCase();
  if (!/^([A-Z0-9]|F[1-9]|F1[0-9]|F2[0-4]|Space|Up|Down|Left|Right|Esc|Return|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Plus|[-=,.;'`\\/\[\]])$/.test(key)) { toast('warn', 'Tecla não aceita', 'Use letra, número, F1–F24 ou setas.'); return; }
  const accel = [...mods, key].join('+'); el.value = accel; el.dataset.old = accel; el.blur();
  setCfg({ hotkey: accel }).then(r => { const st = r && r.hotkey_status; if (st && st.error) toast('err', 'Atalho não registrado', st.error); else toast('ok', 'Atalho salvo', accel); renderSettings(); });
}
async function setStatus(key, status) { const r = await api.post('/api/edit/save', { key, data: { status } }); if (r.error) return toast('err', 'Não foi possível salvar', r.error); const g = S.byKey[key]; if (g) { g.status = status; S._poolKey = ''; } if (S.det && S.det.key === key) { S.det.meta = { ...(S.det.meta || {}), status }; renderDetail(); } toast('ok', status ? statusName(status) : 'Sem status', g ? g.title : ''); loadCatalog(); }
const OSN = () => S.config.os === 'windows' ? 'Windows' : S.config.os === 'mac' ? 'macOS' : 'Linux';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = s => encodeURIComponent(s);
const fmtTime = sec => { sec = Math.floor(sec || 0); if (sec < 60) return '0 min'; const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60); return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`; };
const ago = ts => { if (!ts) return ''; const d = (Date.now() / 1000 - ts); if (d < 3600) return 'há ' + Math.max(1, Math.floor(d / 60)) + ' min'; if (d < 86400) return 'há ' + Math.floor(d / 3600) + ' h'; if (d < 172800) return 'ontem'; return 'há ' + Math.floor(d / 86400) + ' dias'; };

const S = { sel: new Set(), games: [], byKey: {}, cats: [], repos: [], systems: {}, config: {}, view: 'home', cat: 'all', q: '', stageKey: '', sort: 'az', flt: { colls: new Set(), cats: new Set(), sys: new Set(), flags: new Set(), repos: new Set(), src: new Set(), genres: new Set(), tags: new Set(), devs: new Set(), years: new Set(), lastp: new Set(), added: new Set(), ptime: new Set(), size: new Set(), status: new Set(), score: new Set() }, _fopen: {}, _fq: {}, _fall: {}, home: null, tab: { store: 'games', mods: 'tools', emulation: 'emulators', central: 'overview' }, mods: null,
            jobs: {}, current: null, hero: [], heroIdx: 0, heroT: null, torrent: false, emu: null, themes: [] };

const FR = [
  ['PES / eFootball', /pro evolution|efootball/i], ['FIFA', /^fifa/i], ['Need for Speed', /need for speed/i],
  ['F1', /^f ?1 (20|race)/i], ['Colin McRae / DiRT', /colin mcrae|dirt/i], ['GRID / ToCA', /grid|toca|race driver/i],
  ['NBA 2K', /nba/i], ['WWE 2K', /wwe/i], ['MLB 2K', /mlb/i], ['Tony Hawk', /tony hawk|rethawed/i],
  ['Transformers', /transformers/i], ['Senhor dos Anéis', /lord of the rings/i], ['Battlefield', /battlefield|bf:/i],
  ['Telltale', /telltale|walking dead|back to the future|jurassic park: the game|poker night/i],
  ['Sonic / SEGA', /sonic|sega|outrun|crazy taxi/i], ['Marvel', /spider|x-men|x2:|marvel|hulk|fantastic four|deadpool|wolverine|punisher/i],
  ['LEGO', /lego/i], ['Star Wars / Trek', /star (wars|trek)/i], ['Tom Clancy', /tom clancy|splinter cell/i],
  ['Project CARS / TDU', /project cars|test drive/i], ['Zelda / Nintendo 64', /zelda|banjo|goemon|dinosaur planet|mario party|star fox/i],
  ['Halo', /halo/i], ['Lost Planet', /lost planet/i], ['Riddick', /riddick/i], ['Dead Island', /dead island/i], ['Godfather', /godfather/i],
  ['Midtown Madness', /midtown/i], ['Juiced', /juiced/i], ['Zoo Tycoon', /zoo tycoon/i], ['Black & White', /black & white/i],
  ['Viva Piñata', /viva pi/i], ['TMNT', /tmnt|ninja turtles/i], ['Colin McRae Rally', /colin mcrae rally/i],
];
const franchiseOf = g => { for (const [n, re] of FR) if (re.test(g.title)) return n; return ''; };

const I = {
  shield: '<svg viewBox="0 0 24 24"><path d="M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06" /><path d="M15 19l2 2l4 -4" /></svg>',
  dice: '<svg viewBox="0 0 24 24"><path d="M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14" /><path d="M8 8.5a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0" fill="currentColor" /><path d="M15 8.5a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0" fill="currentColor" /><path d="M15 15.5a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0" fill="currentColor" /><path d="M8 15.5a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0" fill="currentColor" /><path d="M11.5 12a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0" fill="currentColor" /></svg>',
  tag: '<svg viewBox="0 0 24 24"><path d="M6.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path d="M3 6v5.172a2 2 0 0 0 .586 1.414l7.71 7.71a2.41 2.41 0 0 0 3.408 0l5.592 -5.592a2.41 2.41 0 0 0 0 -3.408l-7.71 -7.71a2 2 0 0 0 -1.414 -.586h-5.172a3 3 0 0 0 -3 3" /></svg>',
  sort: '<svg viewBox="0 0 24 24"><path d="M3 9l4 -4l4 4m-4 -4v14" /><path d="M21 15l-4 4l-4 -4m4 4v-14" /></svg>',
  help: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /><path d="M12 16v.01" /><path d="M12 13a2 2 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483" /></svg>',
  play: '<svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z" /></svg>',
  dl: '<svg viewBox="0 0 24 24"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" /><path d="M7 11l5 5l5 -5" /><path d="M12 4l0 12" /></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2" /></svg>',
  cog: '<svg viewBox="0 0 24 24"><path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065" /><path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7l16 0" /><path d="M10 11l0 6" /><path d="M14 11l0 6" /><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" /><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" /></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" /><path d="M11 13l9 -9" /><path d="M15 4h5v5" /></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6" /></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M9 15l6 -6"/><path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464"/><path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463"/></svg>',
  magnet: '<svg viewBox="0 0 24 24"><path d="M4 13v-8a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v8a2 2 0 0 0 6 0v-8a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v8a8 8 0 0 1 -16 0" /><path d="M4 8l5 0" /><path d="M15 8l4 0" /></svg>',
  chip: '<svg viewBox="0 0 24 24"><path d="M5 6a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1l0 -12" /><path d="M8 10v-2h2m6 6v2h-2m-4 0h-2v-2m8 -4v-2h-2" /><path d="M3 10h2" /><path d="M3 14h2" /><path d="M10 3v2" /><path d="M14 3v2" /><path d="M21 10h-2" /><path d="M21 14h-2" /><path d="M14 21v-2" /><path d="M10 21v-2" /></svg>',
  gamepad: '<svg viewBox="0 0 24 24"><path d="M12 5h3.5a5 5 0 0 1 0 10h-5.5l-4.015 4.227a2.3 2.3 0 0 1 -3.923 -2.035l1.634 -8.173a5 5 0 0 1 4.904 -4.019h3.4" /><path d="M14 15l4.07 4.284a2.3 2.3 0 0 0 3.925 -2.023l-1.6 -8.232" /><path d="M8 9v2" /><path d="M7 10h2" /><path d="M14 10h2" /></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" /></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6l-12 12" /><path d="M6 6l12 12" /></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5l10 -10" /></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 5a5 5 0 0 1 7 0a5 5 0 0 0 7 0v9a5 5 0 0 1 -7 0a5 5 0 0 0 -7 0v-9z" /><path d="M5 21v-7" /></svg>',
  info: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /><path d="M12 9h.01" /><path d="M11 12h1v4h1" /></svg>',
  cal: '<svg viewBox="0 0 24 24"><path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12" /><path d="M16 3v4" /><path d="M8 3v4" /><path d="M4 11h16" /><path d="M11 15h1" /><path d="M12 15v3" /></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11" /></svg>',
  layout: '<svg viewBox="0 0 24 24"><path d="M4 6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v1a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2l0 -1" /><path d="M4 15a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2l0 -3" /><path d="M14 6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2l0 -3" /><path d="M14 17a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v1a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2l0 -1" /></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6l11 0" /><path d="M9 12l11 0" /><path d="M9 18l11 0" /><path d="M5 6l0 .01" /><path d="M5 12l0 .01" /><path d="M5 18l0 .01" /></svg>',
  grid: '<svg viewBox="0 0 24 24"><path d="M4 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4" /><path d="M14 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4" /><path d="M4 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4" /><path d="M14 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4" /></svg>',
  coll: '<svg viewBox="0 0 24 24"><path d="M15 10v11l-5 -3l-5 3v-11a3 3 0 0 1 3 -3h4a3 3 0 0 1 3 3z" /><path d="M11 3h5a3 3 0 0 1 3 3v11" /></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5l0 14" /><path d="M5 12l14 0" /></svg>',
  dots: '<svg viewBox="0 0 24 24"><path d="M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path d="M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /></svg>',
  search: '<svg viewBox="0 0 24 24"><path d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" /><path d="M21 21l-6 -6" /></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" /><path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" /></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873l-6.158 -3.245" /></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" /><path d="M13.5 6.5l4 4" /></svg>',
  copy: '<svg viewBox="0 0 24 24"><path d="M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666" /><path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1" /></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6" /><path d="M9 17v1a3 3 0 0 0 6 0v-1" /></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 9v4" /><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0" /><path d="M12 16h.01" /></svg>',
  wrench: '<svg viewBox="0 0 24 24"><path d="M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5" /></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M5 12l-2 0l9 -9l9 9l-2 0" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7" /><path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6" /></svg>',
  win: '<svg viewBox="0 0 24 24"><path d="M17.8 20l-12 -1.5c-1 -.1 -1.8 -.9 -1.8 -1.9v-9.2c0 -1 .8 -1.8 1.8 -1.9l12 -1.5c1.2 -.1 2.2 .8 2.2 1.9v12.1c0 1.2 -1.1 2.1 -2.2 1.9l0 .1" /><path d="M12 5l0 14" /><path d="M4 12l16 0" /></svg>',
  sliders: '<svg viewBox="0 0 24 24"><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  hdd: '<svg viewBox="0 0 24 24"><path d="M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v3H3zM3 14a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z"/><path d="M7 7h.01M7 17h.01"/></svg>',
  move: '<svg viewBox="0 0 24 24"><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2M10 14h6M13 11l3 3-3 3"/></svg>',
  disc: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" /><path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path d="M7 12a5 5 0 0 1 5 -5" /><path d="M12 17a5 5 0 0 0 5 -5" /></svg>',
  tray: '<svg viewBox="0 0 24 24"><path d="M4 20l16 0" /><path d="M12 14l0 -10" /><path d="M12 14l4 -4" /><path d="M12 14l-4 -4" /></svg>',
  power: '<svg viewBox="0 0 24 24"><path d="M7 6a7.75 7.75 0 1 0 10 0" /><path d="M12 4l0 8" /></svg>',
  filter: '<svg viewBox="0 0 24 24"><path d="M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227" /></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2" /><path d="M10 14a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><path d="M14 4l0 4l-6 0l0 -4" /></svg>',
  cpu: '<svg viewBox="0 0 24 24"><path d="M5 6a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1l0 -12" /><path d="M9 9h6v6h-6l0 -6" /><path d="M3 10h2" /><path d="M3 14h2" /><path d="M10 3v2" /><path d="M14 3v2" /><path d="M21 10h-2" /><path d="M21 14h-2" /><path d="M14 21v-2" /><path d="M10 21v-2" /></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2" /><path d="M9 9l1 0" /><path d="M9 13l6 0" /><path d="M9 17l6 0" /></svg>',
  image: '<svg viewBox="0 0 24 24"><path d="M15 8h.01" /><path d="M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12" /><path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5" /><path d="M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3" /></svg>',
  import: '<svg viewBox="0 0 24 24"><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M5 13v-8a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2h-5.5m-9.5 -2h7m-3 -3l3 3l-3 3" /></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6l6 -6" /></svg>',
};


const mq = window.matchMedia('(prefers-color-scheme: light)');
let currentTheme = 'dark';
const DEFAULT_FACE = 'padrao';
const LIGHTS_DEFAULT = ['#9ec5ff', '#b48cff', '#7c4dff'];
const LIGHT_PRESETS = [['Padrão (azul pastel, lavanda, roxo)', LIGHTS_DEFAULT], ['Oceano', ['#38bdf8', '#2dd4bf', '#818cf8']], ['Fogo', ['#f97316', '#ef4444', '#f59e0b']], ['Aurora', ['#22d3ee', '#a78bfa', '#f472b6']], ['Gelo', ['#e2e8f0', '#94a3b8', '#ffffff']], ['Azul puro', ['#9ec5ff', '#9ec5ff', '#9ec5ff']]];
function applyLights() { const st = document.documentElement.style, l = Array.isArray(S.config.lights) && S.config.lights.length === 3 && S.config.lights.every(c => /^#[0-9a-fA-F]{6}$/.test(c)) ? S.config.lights : LIGHTS_DEFAULT; st.setProperty('--t-c', l[0]); st.setProperty('--t-g', l[1]); st.setProperty('--t-o', l[2]); }
function lightsRow(c) {
  const cur = Array.isArray(c.lights) && c.lights.length === 3 ? c.lights : LIGHTS_DEFAULT;
  const same = a => a.every((x, i) => x.toLowerCase() === cur[i].toLowerCase());
  const presetIdx = LIGHT_PRESETS.findIndex(p => same(p[1]));
  const sw = (i, lbl) => `<label class="lsw" title="${lbl}"><input type="color" value="${esc(cur[i])}" oninput="setLightLive(${i},this.value)" onchange="setLight(${i},this.value)"><span style="background:${esc(cur[i])}"></span></label>`;
  return `<div class="frow" style="margin-top:14px"><div class="l"><b>Fita de luz</b><span>As três cores da fita que desce pela barra, dos contornos acesos e do botão Jogar. Escolha um conjunto pronto ou toque em cada cor</span></div><div class="ta lights" style="gap:8px;align-items:center">
    <span class="lstrip" style="background:linear-gradient(90deg,${esc(cur[0])},${esc(cur[1])} 50%,${esc(cur[2])})"></span>${sw(0, 'Primeira cor (começo da fita)')}${sw(1, 'Cor do meio (contornos, foco)')}${sw(2, 'Última cor (fim da fita)')}
    ${selHtml([...LIGHT_PRESETS.map((p, i) => [i, p[0]]), [-1, 'Personalizado']], presetIdx, 'const i=JSON.parse(this.value);if(i>=0)setCfg({lights:LIGHT_PRESETS[i][1]})')}
    ${presetIdx === 0 ? '' : `<button class="btn s xs" title="Voltar às cores originais" onclick="setCfg({lights:LIGHTS_DEFAULT})">Padrão</button>`}</div></div>`;
}
function setLightLive(i, v) { const l = [...(Array.isArray(S.config.lights) && S.config.lights.length === 3 ? S.config.lights : LIGHTS_DEFAULT)]; l[i] = v; S.config.lights = l; applyLights(); const st = $('.lstrip'); if (st) st.style.background = `linear-gradient(90deg,${l[0]},${l[1]} 50%,${l[2]})`; }
function setLight(i, v) { const l = [...(Array.isArray(S.config.lights) && S.config.lights.length === 3 ? S.config.lights : LIGHTS_DEFAULT)]; l[i] = v; setCfg({ lights: l }); }
function faceInfo(id) { return (S.faces || []).find(f => f.id === id) || { id: id || DEFAULT_FACE, name: 'Ludrix', accent: '', layout: '' }; }
function fileScheme() { const m = S.config.theme_mode || ''; return m === 'system' ? ((S.config.theme_schedule ? inLightWindow() : mq.matches) ? 'light' : 'dark') : m; }
function applyTheme() {
  let t = S.config.theme || 'system';
  if (t === 'system') { t = (S.config.theme_schedule ? inLightWindow() : mq.matches) ? 'light' : 'dark'; S._schedLast = t; }
  const isFile = t.startsWith('file:'), face = isFile ? '' : ((S.faces || []).some(f => f.id === S.config.face) || !(S.faces || []).length ? S.config.face || DEFAULT_FACE : DEFAULT_FACE), fm = isFile ? fileScheme() : '', tid = (face ? face + '-' + t : t) + (fm ? '|' + fm : '');
  if (face) { const f = faceInfo(face); themeAccent = f.accent || ''; }
  applyAccent(); applyLights();
  document.body.classList.add('face');
  document.body.dataset.face = face || DEFAULT_FACE;
  if (!isFile || fm) document.documentElement.dataset.light = (isFile ? fm : t) === 'light' ? '1' : '0';
  if (face) setLayout(faceInfo(face).layout || '');
  if (tid === currentTheme) { applyChrome(); return; }
  currentTheme = tid;
  const old = $('#themeLink'); const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = '/api/theme/' + enc(tid.split('|')[0]) + (fm ? '?s=' + fm : ''); link.id = 'themeLink';
  link.onload = () => { old.remove(); applyAccent(); applyGlass(); };
  old.id = 'themeLinkOld'; old.after(link);
  if (isFile) api.get('/api/theme/' + enc(t) + '/json').then(j => { if (currentTheme !== tid) return; themeAccent = (j && j.accent) || ''; if (!fm) document.documentElement.dataset.light = j && j.scheme === 'light' ? '1' : '0'; S.themeFx = (j && j.fx) || null; S.themeIcons = (j && j.icons) || ''; S.themeMenu = (j && j.menu) || ''; S.themeSearch = (j && j.search) || ''; S.themeNavLabels = !!(j && j.nav_labels); S.themeId = t; if (j && j.pointer) document.body.dataset.ptr = '1'; else delete document.body.dataset.ptr; S.themePlx = j && j.parallax ? (typeof j.parallax === 'number' ? Math.max(.2, Math.min(3, j.parallax)) : 1) : 0; setLayout((j && j.layout) || ''); applyTheme(); applyChrome(); applyAnim(); applyRailIcons(); });
  else { S.themeFx = null; S.themeId = ''; delete document.body.dataset.ptr; S.themePlx = 0; applyPlx(); if (S.themeIcons) { S.themeIcons = ''; applyRailIcons(); } if (S.themeMenu) { S.themeMenu = ''; } if (S.themeSearch || S.themeNavLabels) { S.themeSearch = ''; S.themeNavLabels = false; applyChrome(); } }
}
let themeLayout = '', themeAccent = '';
const LAYOUT_ALIAS = { taskbar: 'bottom', dock: 'bottom' };
function normLayout(l) { return LAYOUT_ALIAS[l] || l || ''; }
function setLayout(l) { if (l === themeLayout) return; themeLayout = l; applyChrome(); }
function themeLay() { const o = S.config.nav_layout; if (['side', 'rail', 'top', 'bottom'].includes(o)) return o; const l = normLayout(themeLayout); return ['top', 'rail', 'bottom'].includes(l) ? l : 'side'; }
mq.addEventListener('change', () => { if ((S.config.theme || 'system') === 'system' || S.config.theme_mode === 'system') applyTheme(); });
function inLightWindow() {
  const [f, t] = [S.config.theme_light_from || '07:00', S.config.theme_light_to || '19:00'].map(x => { const [h, m] = String(x).split(':').map(Number); return (h || 0) * 60 + (m || 0); });
  const d = new Date(), n = d.getHours() * 60 + d.getMinutes();
  return f <= t ? (n >= f && n < t) : (n >= f || n < t);
}
setInterval(() => { if (S.config.theme_schedule && (S.config.theme || 'system') === 'system' && (inLightWindow() ? 'light' : 'dark') !== S._schedLast) applyTheme(); }, 30000);
function applyAccent() {
  const mode = S.config.accent_mode || 'theme';
  if (mode === 'system' && S.sysAccent === undefined) { S.sysAccent = ''; api.post('/api/window', { cmd: 'sys_accent' }).then(r => { S.sysAccent = (r && r.hex) || ''; if (S.sysAccent) applyAccent(); }); }
  const acc = S.dynAccent || (mode === 'system' && S.sysAccent) || (mode === 'custom' && S.config.accent) || themeAccent || (document.documentElement.dataset.light === '1' ? '#2b6be0' : '#4f8df7');
  const st = document.documentElement.style; document.documentElement.classList.remove('mono');
  applyFrame();
  if (!acc) { st.removeProperty('--accent'); st.removeProperty('--accent2'); st.removeProperty('--on-accent'); scheduleContrast(); return; }
  const rgb = hexRgb(acc); if (!rgb) return;
  st.setProperty('--accent', acc);
  st.setProperty('--on-accent', onAccent(rgb));
  const bg = hexRgb(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  const lightBg = bg ? luma(bg) > .5 : currentTheme === 'light';
  st.setProperty('--accent2', lightBg ? shade(rgb, -55) : shade(rgb, 45));
  scheduleContrast();
}
function relLum([r, g, b]) { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); }
function onAccent(rgb) { const L = relLum(rgb); return 1.05 / (L + .05) >= (L + .05) / .0561 ? '#fff' : '#111'; }
let frameT = 0, frameLast = '';
function applyFrame() {
  if (!S.config.native || S.config.os !== 'windows') return;
  clearTimeout(frameT);
  frameT = setTimeout(() => {
    const bg = cssVar('--bg'), text = cssVar('--text'), dark = document.documentElement.dataset.light !== '1', rgb = hexRgb(bg);
    const border = rgb ? rgbToHex(shade(rgb, dark ? 30 : -30)) : bg;
    let colors = null; try { colors = ctxColors(); } catch (e) { colors = null; }
    const body = { cmd: 'frame', mode: S.config.frame_mode || 'theme', corners: S.config.frame_corners || '', bg, text, border, dark, colors };
    const sig = JSON.stringify(body); if (sig === frameLast) return; frameLast = sig;
    api.post('/api/window', body);
  }, 300);
}
const CONTRAST_SEL = '.btn.p,.chip.on,.sw.on,.tag,.tabs button.on,.seg button.on,.pbtns button.on,.rb.on,.badge,.pill.on,.kbd.on';
function cssRgb(v) { let m = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+%?))?\)/.exec(v || ''); if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]]; m = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?:\s*\/\s*([\d.]+%?))?\)/.exec(v || ''); return m ? [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]] : null; }
function fixContrast() {
  for (const el of document.querySelectorAll('[data-cfix]')) if (!el.matches(CONTRAST_SEL)) { el.style.removeProperty('color'); delete el.dataset.cfix; }
  for (const el of document.querySelectorAll(CONTRAST_SEL)) {
    const cs = getComputedStyle(el); let bg = cssRgb(cs.backgroundColor), lb;
    if (/gradient/.test(cs.backgroundImage)) {
      const stops = (cs.backgroundImage.match(/rgba?\([^)]*\)/g) || []).map(cssRgb).filter(c => c && c[3] > .75);
      if (stops.length) lb = stops.reduce((a, c) => a + luma(c), 0) / stops.length;
    } else if (bg && bg[3] >= .75) lb = luma(bg);
    if (lb === undefined) { if (el.dataset.cfix) { el.style.removeProperty('color'); delete el.dataset.cfix; } continue; }
    const fg = cssRgb(cs.color); if (!fg) continue;
    const lf = luma(fg), ratio = (Math.max(lb, lf) + .05) / (Math.min(lb, lf) + .05);
    if (ratio < 3) { el.style.setProperty('color', lb > .4 ? '#111' : '#fff', 'important'); el.dataset.cfix = '1'; }
  }
}
let cfixT = 0;
function scheduleContrast() { clearTimeout(cfixT); cfixT = setTimeout(() => fixContrast(), 60); }
new MutationObserver(ms => { for (const m of ms) if (m.type === 'attributes' || m.addedNodes.length) { scheduleContrast(); return; } })
  .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
function hexRgb(h) { if (!h) return null; h = h.trim(); let m = /^#([0-9a-f]{3,8})$/i.exec(h); if (m) { let x = m[1]; if (x.length < 6) x = x.split('').map(c => c + c).join(''); const n = parseInt(x.slice(0, 6), 16); return [n >> 16, (n >> 8) & 255, n & 255]; } m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(h); return m ? [+m[1], +m[2], +m[3]] : null; }
function luma([r, g, b]) { const f = c => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); }
function shade([r, g, b], d) { const c = v => Math.max(0, Math.min(255, v + d)); return `rgb(${c(r)},${c(g)},${c(b)})`; }

const LOGO_RAW = '<svg class="logo" viewBox="0 0 128 128"><image href="/ui/icon.png" width="128" height="128"/></svg>';
let LOGO_N = 0;
function logoSvg() { return LOGO_RAW.split('LX_').join('lx' + (LOGO_N++) + '_'); }
const SPLASH_T0 = performance.now();
const SPL = { q: [], t: 0, pct: 0, last: 0, done: false };
function splashStep(text, pct) {
  if (SPL.done || !$('#splash')) return;
  SPL.q.push([text, pct]); if (!SPL.t) splashDrain();
}
function splashDrain() {
  const el = $('#splash'); SPL.t = 0; if (!el || !SPL.q.length) return;
  const [text, pct] = SPL.q.shift(), log = $('#slog'), prev = log && log.lastElementChild;
  if (prev) prev.classList.add('ok');
  if (log) { log.insertAdjacentHTML('beforeend', `<div>${esc(text)}</div>`); while (log.children.length > 5) log.firstElementChild.remove(); }
  if (pct > SPL.pct) { SPL.pct = pct; const b = $('#spb'), c = $('#spct'); if (b) b.style.width = pct + '%'; if (c) c.textContent = pct + '%'; }
  SPL.t = setTimeout(splashDrain, document.documentElement.dataset.anim === 'off' ? 0 : 160);
}
function splashOff() {
  const el = $('#splash'); if (!el || SPL.done) return;
  SPL.done = true; SPL.q.push(['pronto', 100]); if (!SPL.t) splashDrain();
  api.post('/api/ui_ready', { ms: Math.round(performance.now()), games: (S.games || []).filter(g => g.installed).length }, { quiet: true });
  const wait = Math.max(0, 900 - (performance.now() - SPLASH_T0), SPL.q.length * 170 + 220);
  setTimeout(() => { const last = $('#slog') && $('#slog').lastElementChild; if (last) last.classList.add('ok'); el.classList.add('off'); setTimeout(() => el.remove(), 550); }, wait);
}
splashStep('carregando interface', 18);
setTimeout(splashOff, 6000);
async function winCmd(cmd) { const r = await api.post('/api/window', { cmd }); winState(r); }
const TOOLBAR_ITEMS = [['search', 'Campo de busca', 'pesquisa em tudo (atalho: /)'], ['cats', 'Categoria', 'lista suspensa com as categorias'], ['sort', 'Ordenação', 'A–Z, ano, tamanho, recentes'], ['bell', 'Notificações', 'histórico de avisos']];
function applyToolbar() {
  const items = new Set(S.config.toolbar_items || ['search', 'cats', 'sort', 'bell']);
  document.body.classList.remove('no-toolbar');
  for (const [id] of TOOLBAR_ITEMS) document.body.classList.toggle('tb-no-' + id, !items.has(id));
}
const NAV_ITEMS = [['home', 'Biblioteca', 'main'], ['store', 'Store', 'main'], ['emulation', 'Emuladores', 'main'], ['mods', 'Mods', 'tools'], ['central', 'Central', 'tools'], ['flash', 'Rápidos', 'tools']];
function navOrder() { const def = NAV_ITEMS.map(x => x[0]), o = (S.config.nav_order || []).filter(v => def.includes(v)); return o.concat(def.filter(v => !o.includes(v))); }
let navDragV = '';
function navDrag(e) { navDragV = e.currentTarget.dataset.v; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', navDragV); } catch (x) { } }
function navOver(e) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(), top = e.clientY < r.top + r.height / 2; e.currentTarget.classList.toggle('dt', top); e.currentTarget.classList.toggle('db', !top); }
function navDrop(e) {
  e.preventDefault(); const tgt = e.currentTarget, before = tgt.classList.contains('dt'); tgt.classList.remove('dt', 'db');
  const from = navDragV || e.dataTransfer.getData('text/plain'), to = tgt.dataset.v; navDragV = ''; if (!from || from === to) return;
  const o = navOrder().filter(v => v !== from); const k = o.indexOf(to); o.splice(before ? k : k + 1, 0, from);
  setCfg({ nav_order: o });
}
function rowToggle(id) { const r = (S.config.home_rows || []).filter(x => x !== id); if (!(S.config.home_rows || []).includes(id)) r.push(id); setCfg({ home_rows: r }); }
function rowDrop(e) {
  e.preventDefault(); const tgt = e.currentTarget, before = tgt.classList.contains('dt'); tgt.classList.remove('dt', 'db');
  const from = navDragV || e.dataTransfer.getData('text/plain'), to = tgt.dataset.v; navDragV = ''; if (!from || from === to) return;
  const all = [...tgt.parentElement.querySelectorAll('.nrow')].map(x => x.dataset.v).filter(v => v !== from); const k = all.indexOf(to); all.splice(before ? k : k + 1, 0, from);
  const on = new Set(S.config.home_rows || []); setCfg({ home_rows: all.filter(v => on.has(v)) });
}
function navToggle(v) { const h = new Set(S.config.nav_hidden || []); if (h.has(v)) h.delete(v); else h.add(v); h.delete('home'); setCfg({ nav_hidden: [...h] }); }
function applyNavItems() {
  const rail = $('#rail'); if (!rail) return;
  const hidden = new Set(S.config.nav_hidden || []); hidden.delete('home');
  const order = navOrder(), custom = order.join() !== NAV_ITEMS.map(x => x[0]).join();
  for (const v of order) {
    const b = rail.querySelector(`.rb[data-view="${v}"]`), it = NAV_ITEMS.find(x => x[0] === v); if (!b || !it) continue;
    b.classList.toggle('nhid', hidden.has(v));
    const g = rail.querySelector(`.rg[data-g="${custom ? 'main' : it[2]}"]`); if (g) g.appendChild(b);
  }
  const groups = [...rail.querySelectorAll('.rg')];
  groups.forEach(g => g.classList.toggle('nhid', ![...g.children].some(b => !b.classList.contains('nhid'))));
  rail.querySelectorAll('.rsep').forEach(sep => { let prev = sep.previousElementSibling, next = sep.nextElementSibling; while (prev && !prev.matches('.rg')) prev = prev.previousElementSibling; while (next && !next.matches('.rg')) next = next.nextElementSibling; sep.classList.toggle('nhid', !prev || !next || prev.classList.contains('nhid') || next.classList.contains('nhid')); });
}
const rmq = window.matchMedia('(prefers-reduced-motion: reduce)');
let clockT = null;
function clockTick() {
  const el = $('#sclock'); if (!el) return; const m = S.config.clock || 'off'; if (m === 'off') { el.textContent = ''; return; }
  const d = new Date(), lang = S.config.language === 'en' ? 'en-US' : 'pt-BR', t = d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  el.textContent = m === 'datetime' ? `${d.toLocaleDateString(lang, { weekday: 'short', day: '2-digit', month: 'short' })} · ${t}` : t;
}
function applyClock() {
  if (clockT) { clearInterval(clockT); clockT = null; }
  let el = $('#sclock'); if (!el) { const r = $('#sright'); if (!r) return; el = document.createElement('span'); el.id = 'sclock'; r.before(el); }
  clockTick(); if ((S.config.clock || 'off') !== 'off') clockT = setInterval(clockTick, 10000);
}
const hcq = window.matchMedia ? window.matchMedia('(prefers-contrast: more)') : null;
if (hcq && hcq.addEventListener) hcq.addEventListener('change', () => applyMotion());
function applyMotion() {
  const rm = !!S.config.reduce_motion || rmq.matches;
  document.body.classList.toggle('rm', rm);
  document.body.classList.toggle('hc', !!S.config.high_contrast || !!(hcq && hcq.matches));
  document.body.classList.toggle('sadv', !!S.config.settings_adv);
  document.body.dataset.hover = rm ? 'none' : (S.config.card_hover || 'lift');
  document.body.dataset.detart = S.config.detail_art || 'auto';
}
rmq.addEventListener('change', applyMotion);
function applyPlx() {
  const on = (S.themePlx || 0) > 0 && S.config.parallax !== false && document.documentElement.dataset.anim !== 'off';
  const h = document.documentElement.style;
  if (on) { document.body.dataset.plx = '1'; h.setProperty('--plx-k', String(S.themePlx)); }
  else { delete document.body.dataset.plx; h.removeProperty('--plx'); h.removeProperty('--ply'); h.removeProperty('--plx-k'); }
}
let plxRaf = 0, plxX = 0, plxY = 0;
document.addEventListener('mousemove', e => {
  const tilt = document.body.dataset.hover === 'tilt', ptr = document.body.dataset.ptr === '1';
  if (document.body.dataset.plx === '1') {
    plxX = e.clientX / window.innerWidth * 2 - 1; plxY = e.clientY / window.innerHeight * 2 - 1;
    if (!plxRaf) plxRaf = requestAnimationFrame(() => { plxRaf = 0; const h = document.documentElement.style; h.setProperty('--plx', plxX.toFixed(3)); h.setProperty('--ply', plxY.toFixed(3)); });
  }
  if (!tilt && !ptr) return;
  if (ptr) { document.body.style.setProperty('--gx', (e.clientX / window.innerWidth * 100).toFixed(1) + '%'); document.body.style.setProperty('--gy', (e.clientY / window.innerHeight * 100).toFixed(1) + '%'); }
  const c = e.target.closest && e.target.closest(ptr ? '.card,.g-banner,.btn,.rb,.dtile,.dcov,.theme,.frow' : '.grid:not(.lst) .card'); if (!c) return;
  const r = c.getBoundingClientRect(); if (!r.width || !r.height) return;
  const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
  if (tilt && c.classList.contains('card') && c.closest('.grid:not(.lst)')) { c.style.setProperty('--ry', (x * 14).toFixed(1) + 'deg'); c.style.setProperty('--rx', (-y * 14).toFixed(1) + 'deg'); }
  if (ptr) { c.style.setProperty('--mx', ((x + .5) * 100).toFixed(1) + '%'); c.style.setProperty('--my', ((y + .5) * 100).toFixed(1) + '%'); c.style.setProperty('--px', (e.clientX - r.left).toFixed(0) + 'px'); c.style.setProperty('--py', (e.clientY - r.top).toFixed(0) + 'px'); }
}, { passive: true });
document.addEventListener('mouseout', e => { const c = e.target.closest && e.target.closest('.card'); if (c && !c.contains(e.relatedTarget)) { c.style.removeProperty('--rx'); c.style.removeProperty('--ry'); } });
const GLASS_VARS = ['bg', 'bg2', 'panel', 'card', 'card2', 'logo-bg'];
function applyGlass() {
  const on = !!S.config.acrylic_on && !S.config.high_contrast, st = document.body.style;
  document.body.classList.toggle('acr', on);
  const light = document.documentElement.dataset.light === '1', want = on && (S.config.theme || 'system') !== 'system' ? light : null;
  if (S._glassLight !== want) { S._glassLight = want; api.post('/api/window', { cmd: 'scheme', light: want }); }
  if (!on) { for (const n of GLASS_VARS) { st.removeProperty('--' + n); st.removeProperty('--' + n + '-solid'); } return; }
  const cs = getComputedStyle(document.documentElement);
  const A = light ? { bg: 60, bg2: 66, panel: 66, card: 74, card2: 80, 'logo-bg': 66 } : { bg: 62, bg2: 68, panel: 68, card: 76, card2: 82, 'logo-bg': 68 };
  for (const n of GLASS_VARS) { const v = cs.getPropertyValue('--' + n).trim(); if (!v) continue; st.setProperty('--' + n + '-solid', v); st.setProperty('--' + n, `color-mix(in srgb, ${v} ${A[n]}%, transparent)`); }
}
function bandMix(c, pct, base) {
  const m = `color-mix(in srgb, ${c} ${pct}%, var(--${base}-solid, var(--${base})))`;
  return document.body.classList.contains('acr') ? `color-mix(in srgb, ${m} 74%, transparent)` : m;
}
function applyChrome() {
  document.body.classList.toggle('frameless', !!S.config.frameless);
  applyGlass();
  applyToolbar(); applyRailIcons(); applyNavItems(); applyMotion(); applyClock();
  document.body.dataset.status = S.config.status_position === 'top' ? 'top' : 'bottom';
  const lay = themeLay(); delete document.body.dataset.layout; document.body.dataset.nav = lay === 'bottom' ? 'bottom' : 'side';
  if (lay === 'top' || lay === 'rail') document.body.dataset.layout = lay;
  const qb = $('#qbox'), sp = lay === 'side' ? 'rail' : 'top'; if (qb) { const host = sp === 'rail' ? $('#rail') : $('#brandBtn').parentElement; if (qb.parentElement !== host) { if (sp === 'rail') $('#rail .brandrow').after(qb); else $('#brandBtn').after(qb); } document.body.dataset.search = sp; } document.body.dataset.navLabels = '1';
  placeWctl(lay);
  const b = $('#brand'); if (b && !b.innerHTML) b.innerHTML = logoSvg(); const hb = $('#brandBtn'); if (hb && !hb.innerHTML) { hb.innerHTML = logoSvg() + '<svg class="car" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>'; hb.onclick = e => { e.stopPropagation(); const r = hb.getBoundingClientRect(); if ($('#ctx').classList.contains('on')) return closeCtx(); appMenu(r.left, r.bottom + 6); }; }
  if (b) { b.onclick = e => { e.stopPropagation(); const r = b.getBoundingClientRect(); if ($('#ctx').classList.contains('on')) return closeCtx(); appMenu(r.right + 6, r.top); }; b.style.cursor = 'pointer'; b.title = 'Menu do Ludrix'; }
}
let rzOn = false; document.querySelectorAll('.rz').forEach(el => el.addEventListener('mousedown', e => { if (e.button !== 0) return; e.preventDefault(); rzOn = true; api.post('/api/window', { cmd: 'resize', dir: el.dataset.rz }); }));
const rzEnd = () => { if (!rzOn) return; rzOn = false; api.post('/api/window', { cmd: 'resize_end' }); };
window.addEventListener('mouseup', rzEnd, true); window.addEventListener('blur', rzEnd); document.addEventListener('visibilitychange', rzEnd); window.addEventListener('pointerup', rzEnd, true); window.addEventListener('mousemove', e => { if (rzOn && !(e.buttons & 1)) rzEnd(); }, true);
function placeWctl(lay) { const w = $('#wctl'); if (!w) return; const host = lay === 'top' ? $('#rail') : document.querySelector('main'); if (!host) return; if (lay === 'top') { if (w.parentElement !== host) host.appendChild(w); } else if (host.firstElementChild !== w) host.prepend(w); }
function winState(ev) { if (ev && ev.max !== undefined) document.body.classList.toggle('maxed', !!ev.max); }
api.post('/api/window', { cmd: 'state' }).then(winState).catch(() => { });
let ONLINE = true;
window.addEventListener('online', () => setOnline(true)); window.addEventListener('offline', () => setOnline(false));
function setOnline(v) { if (v === ONLINE) return; ONLINE = v; document.body.classList.toggle('offline', !v); if (S.view === 'store') renderView(); if (!v) toast('', 'Sem internet', 'Baixar jogos, capas e emuladores fica indisponível até reconectar.'); }

function appMenu(x, y) { showCtx(appMenuItems(), x, y); }
function appMenuItems() {
  const go = (v, tab) => () => { setView(v); if (tab) { S.tab[v] = tab; renderView(); } };
  const set = (tab) => () => { setView('settings'); S.tab.settings = tab; renderSettings(true); };
  const items = [
    { label: 'Biblioteca', icon: 'home', sub: [
      { label: 'Biblioteca', icon: 'home', fn: go('home') }, { label: 'Adicionar jogo instalado…', icon: 'plus', fn: addLocal }, { label: 'Baixar de link…', icon: 'dl', fn: linkDownload }, { label: 'Escanear pastas…', icon: 'search', fn: scanWizard }, { label: 'Importar de outro launcher…', icon: 'import', fn: importWizard },
      { label: 'Me surpreenda', icon: 'spark', fn: () => surprise() }, { sep: true }, { label: 'Atualizar tudo (metadados/capas)', icon: 'refresh', fn: () => api.post('/api/metadata/refetch_all', {}).then(() => toast('ok', 'Atualizando', 'metadados e capas em segundo plano')) }] },
    { label: 'Store', icon: 'dl', sub: [
      { label: 'Baixar novos games', icon: 'dl', fn: go('store', 'games') }, { label: 'Fontes de jogos…', icon: 'cog', fn: go('store', 'sources') }, { label: 'Atualizar catálogo', icon: 'refresh', fn: () => loadCatalog(true) }, { label: 'Fila de downloads', icon: 'dl', fn: go('downloads') }] },
    { label: 'Emuladores', icon: 'gamepad', sub: [
      { label: 'Emuladores e consoles', icon: 'gamepad', fn: go('emulation') }, { label: 'Meu próprio emulador…', icon: 'plus', fn: () => addCustomEmu() }, { label: 'Pasta emulation\\games', icon: 'folder', fn: () => openPath(S.emu?.games_root || 'emulation/games') }, { label: 'Pasta de BIOS', icon: 'folder', fn: () => openPath(S.emu?.bios_dir || 'emulation/bios') }] },
    { label: 'Ferramentas', icon: 'wrench', sub: [
      { label: 'Mods e ferramentas', icon: 'wrench', fn: go('mods') }, { label: 'Central Ludrix', icon: 'chip', fn: go('central') }, { label: 'Jogos Rápidos', icon: 'play', fn: go('flash') }] },
    { label: 'Aparência', icon: 'image', sub: [
      { label: 'Aparência e temas…', icon: 'image', fn: set('appearance') },
      ...(S.config.os === 'windows' ? [{ label: S.config.frameless ? 'Usar moldura do Windows' : 'Janela sem moldura', icon: 'win', fn: () => setCfg({ frameless: !S.config.frameless }) }] : []), { sep: true },
      { label: 'Abrir o Modo Console', icon: 'gamepad', hint: 'fecha esta janela', fn: () => openConsole() }] },
    { label: 'Pastas', icon: 'folder', sub: [
      { label: 'Pasta do launcher', icon: 'folder', fn: () => openPath(S.config.root || '.') }, { label: 'games' + SEP() + ' (jogos instalados)', icon: 'folder', fn: () => openPath(S.config.games_dir || 'games') },
      { label: 'downloads\\', icon: 'folder', fn: () => openPath('downloads') }, { label: 'themes\\', icon: 'folder', fn: () => openPath('themes') }, { label: 'data\\ (config, biblioteca, fontes)', icon: 'folder', fn: () => openPath('data') }, { label: 'Log (ludrix.log)', icon: 'doc', fn: () => openPath('data/ludrix.log') }] },
    { sep: true },
    { label: 'Ajustes', icon: 'cog', fn: set('general') },
    { label: 'Sobre o Ludrix', icon: 'info', fn: () => { S._settingsJump = 'Sobre'; set('system')(); } },
  ];
  if (S.config.native) items.push({ sep: true }, { label: 'Esconder na bandeja', icon: 'tray', fn: () => winCmd('hide') }, { label: 'Sair do launcher', icon: 'power', danger: true, fn: () => winCmd('quit') });
  return items;
}
const PAL = { on: false, idx: 0, rows: [] };
function palActions() {
  const out = [];
  const walk = (items, path) => { for (const it of items) { if (it.sep || !it.label) continue; if (it.sub) walk(it.sub, path.concat(it.label)); else if (it.fn && !it.disabled) out.push({ kind: 'act', label: it.label.replace(/…$/, ''), path: path.join(' › '), icon: it.icon || 'dots', danger: !!it.danger, fn: it.fn }); } };
  walk(appMenuItems(), []);
  for (const [id, name] of (S._settingsTabs || []).map(t => [t[0], t[1]])) out.push({ kind: 'act', label: name, path: 'Ajustes', icon: 'cog', fn: () => { setView('settings'); settingsTab(id); } });
  out.push({ kind: 'act', label: 'Testar controle', path: 'Ajustes › Controle', icon: 'gamepad', fn: () => gpTester() });
  out.push({ kind: 'act', label: S.config.reduce_motion ? 'Ligar animações' : 'Reduzir movimento', path: 'Aparência', icon: 'spark', fn: () => setCfg({ reduce_motion: !S.config.reduce_motion }) });
  out.push({ kind: 'act', label: 'Checar atualizações', path: 'Sistema', icon: 'refresh', fn: () => checkUpdates() });
  return out;
}
function palOpen() {
  if (PAL.on) return palClose();
  const el = $('#pal'); if (!el) return;
  PAL.on = true; PAL.idx = 0; el.classList.add('on'); el.querySelector('input').value = ''; palRender(''); setTimeout(() => el.querySelector('input').focus(), 20);
}
function palClose() { const el = $('#pal'); if (!el) return; PAL.on = false; el.classList.remove('on'); }
function palRender(q) {
  const list = $('#palList'), raw = q.trim(), actOnly = raw.startsWith('>'), nq = qnorm(actOnly ? raw.slice(1) : raw);
  const rows = [];
  if (!actOnly) {
    const pool = S.games.filter(g => !g.hidden && !g.dup_of);
    const hits = nq ? pool.filter(g => g._q && g._q.includes(nq)) : pool.filter(g => g.last_played).sort((a, b) => (b.last_played || 0) - (a.last_played || 0));
    for (const g of hits.slice(0, nq ? 7 : 4)) rows.push({ kind: 'game', g, label: g.title, path: [g.creator || g.fr, g.year, g.installed || g.owned ? 'instalado' : g.repo !== 'local' ? 'na Store' : ''].filter(Boolean).join(' · '), fn: () => openGame(g.key), play: g.installed || g.owned });
  }
  const acts = palActions().filter(a => !nq || qnorm(a.label + ' ' + a.path).includes(nq));
  for (const a of acts.slice(0, nq ? 8 : 6)) rows.push(a);
  PAL.rows = rows; if (PAL.idx >= rows.length) PAL.idx = 0;
  list.innerHTML = rows.length ? rows.map((r, i) => `<div class="palr${i === PAL.idx ? ' on' : ''}${r.danger ? ' dg' : ''}" data-i="${i}" onmousemove="palHover(${i})" onclick="palRun(${i})">${r.kind === 'game' ? `<img class="palc" src="/thumb/${enc(r.g.key)}?v=${r.g.cv || 0}" alt="" onerror="this.style.visibility='hidden'">` : `<span class="pali">${I[r.icon] || I.dots || ''}</span>`}<div class="palt"><b>${esc(r.label)}</b>${r.path ? `<small>${esc(r.path)}</small>` : ''}</div><kbd>${r.kind === 'game' ? (r.play ? 'Enter abre · Shift+Enter joga' : 'Enter') : 'Enter'}</kbd></div>`).join('') : `<div class="palr none">Nada com "${esc(raw)}". Dica: comece com &gt; para ver só ações.</div>`;
}
function palHover(i) { if (PAL.idx === i) return; PAL.idx = i; $('#palList').querySelectorAll('.palr').forEach((e, j) => e.classList.toggle('on', j === i)); }
function palRun(i, shift) { const r = PAL.rows[i]; if (!r) return; palClose(); if (r.kind === 'game' && shift && r.play) play(r.g.key); else r.fn(); }
function palKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); palClose(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = PAL.rows.length; if (!n) return; PAL.idx = (PAL.idx + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; const rows = $('#palList').querySelectorAll('.palr'); rows.forEach((el, j) => el.classList.toggle('on', j === PAL.idx)); rows[PAL.idx]?.scrollIntoView({ block: 'nearest' }); return; }
  if (e.key === 'Enter') { e.preventDefault(); palRun(PAL.idx, e.shiftKey); }
}
function viewMenu(view, x, y) {
  const m = {
    home: [{ label: 'Adicionar jogo instalado…', icon: 'plus', fn: addLocal }, { label: 'Selecionar todos da página', icon: 'check', fn: msAll }, { label: 'Baixar de link…', icon: 'dl', fn: linkDownload }, { label: 'Escanear pastas…', icon: 'search', fn: scanWizard }, { label: 'Importar de outro launcher…', icon: 'import', fn: importWizard }, { sep: true }, { label: 'Tamanho das capas…', icon: 'image', fn: () => { setView('settings'); S.tab.settings = 'appearance'; renderSettings(); } }],
    store: [{ label: 'Fontes de jogos…', icon: 'cog', fn: () => { S.tab.store = 'sources'; renderView(); } }, { label: 'Atualizar catálogo', icon: 'refresh', fn: () => loadCatalog(true) }],
    emulation: [{ label: 'Meu próprio emulador…', icon: 'plus', fn: () => addCustomEmu() }, { label: 'Pasta emulation', icon: 'folder', fn: () => openPath(S.emu?.games_root) }],
    flash: [{ label: 'Adicionar jogo rápido…', icon: 'plus', fn: () => setTimeout(() => addFlashMenu({ clientX: x, clientY: y }), 30) }, { label: 'Baixar mais', icon: 'dl', fn: () => { S.tab.flash = 'more'; S.flashF = 'all'; renderFlash(); } }],
    downloads: [{ label: 'Baixar de link…', icon: 'dl', fn: linkDownload }, { label: 'Abrir pasta downloads', icon: 'folder', fn: () => openPath('downloads') }],
    central: [{ label: 'Abrir pasta redists', icon: 'folder', fn: () => api.post('/api/redist/open', {}) }, { label: 'Re-checar instalados', icon: 'refresh', fn: () => renderCentral() }],
    settings: [{ label: 'Abrir pasta data', icon: 'folder', fn: () => openPath('data') }, { label: 'Abrir log', icon: 'ext', fn: () => openPath('data/ludrix.log') }],
  }[view] || [];
  const base = [{ label: 'Atualizar esta tela', icon: 'refresh', fn: renderView }];
  showCtx(m.length ? [...m, { sep: true }, ...base] : base, x, y);
}
function sysMenu(sid, x, y) {
  const s = S.emu?.systems[sid]; if (!s) return;
  const items = [
    { label: 'Abrir pasta de ROMs', icon: 'folder', fn: () => openPath(s.games_dir) },
    { label: '+ Pasta de ROMs…', icon: 'plus', fn: () => addRomDir(sid) },
    { label: 'Emuladores deste console…', icon: 'cog', fn: () => sysEmus(sid) },
  ];
  if (s.installed) items.push({ label: `Abrir ${s.emulator_title}`, icon: 'play', fn: () => api.post('/api/emulator/open', { id: s.emulator }) });
  else items.push({ label: `Instalar ${s.emulator_title}`, icon: 'dl', fn: () => installEmu(s.emulator) });
  showCtx(items, x, y);
}
async function repoLinksTest(id, name) {
  toast('', 'Testando links', id ? `${name}: amostra de até 25 links diretos` : 'Todas as fontes ligadas (amostra de até 25 links cada)');
  const r = await api.post('/api/repos/links', { id: id || '' }); if (r.error) return toast('err', 'Teste de links', r.error);
  const res = Object.values(r.results || {}); const tested = res.reduce((a, x) => a + (x.tested || 0), 0), dead = res.reduce((a, x) => a + Object.keys(x.dead || {}).length, 0);
  if (!tested) toast('', 'Nada para testar', 'Essa fonte só tem torrents (magnet não dá para testar) ou está vazia');
  else toast(dead ? 'warn' : 'ok', dead ? `${dead} de ${tested} links fora do ar` : `Links ok (${tested} testados)`, dead ? 'Os jogos afetados ganharam o aviso "link fora do ar" na Store' : '');
  if (S.view === 'store') { if (S.tab.store === 'sources') renderSources(); else loadCatalog(false); }
}
function repoMenu(id, x, y) {
  const r = (S.repos || []).find(z => z.id === id) || {};
  showCtx([
    { label: r.enabled ? 'Desligar fonte' : 'Ligar fonte', icon: 'power', fn: () => api.post('/api/repos/toggle', { id, enabled: !r.enabled }).then(() => { renderSources(); loadCatalog(false); }) },
    { label: 'Atualizar', icon: 'refresh', fn: () => loadCatalog(true) },
    { label: 'Testar links', icon: 'link', fn: () => repoLinksTest(id, r.name) },
    ...(r.builtin ? [] : [{ sep: true }, { label: 'Editar…', icon: 'edit', fn: () => editRepo(id) }, { label: 'Remover', icon: 'trash', danger: true, fn: () => removeRepo(id, r.name) }]),
  ], x, y);
}

const L = { on: false, dict: {}, rx: [], cache: new Map() };
async function initLang(lang) {
  if (!lang || lang === 'pt-BR' || L.on) return;
  try { const d = await (await fetch('/ui/lang/' + lang + '.json')).json(); L.dict = d.strings || {}; L.rx = (d.patterns || []).map(([a, b]) => [new RegExp(a, 'g'), b]); } catch (e) { return; }
  L.on = true; document.documentElement.lang = lang;
  const tr = t => {
    const k = t.trim(); if (!k || !/[a-zA-ZÀ-ú]/.test(k)) return t;
    let v = L.cache.get(k);
    if (v === undefined) {
      v = L.dict[k];
      if (v === undefined) { v = k; for (const [r, b] of L.rx) v = v.replace(r, b); }
      if (L.cache.size > 20000) L.cache.clear();
      L.cache.set(k, v);
    }
    return v === k ? t : t.replace(k, v);
  };
  const ATTRS = ['title', 'placeholder', 'data-help', 'aria-label'];
  const one = n => {
    if (n.nodeType === 3) { const p = n.parentNode; if (p && p.tagName !== 'SCRIPT' && p.tagName !== 'STYLE') { const v = tr(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; } }
    else if (n.nodeType === 1) for (const a of ATTRS) if (n.hasAttribute(a)) { const v = tr(n.getAttribute(a)); if (v !== n.getAttribute(a)) n.setAttribute(a, v); }
  };
  const walk = root => { one(root); if (root.nodeType !== 1) return; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT); let n; while ((n = w.nextNode())) one(n); };
  walk(document.body);
  new MutationObserver(ms => { for (const m of ms) { if (m.type === 'childList') m.addedNodes.forEach(walk); else one(m.target); } })
    .observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

const URI_NAMES = [['steam', 'Steam'], ['epicgames', 'Epic Games Launcher'], ['legendary', 'Legendary'], ['gog', 'GOG Galaxy'], ['uplay', 'Ubisoft Connect'], ['ubisoft', 'Ubisoft Connect'], ['origin', 'EA app'], ['eadesktop', 'EA app'], ['battlenet', 'Battle.net'], ['amazon', 'Amazon Games'], ['itch', 'itch.io'], ['xbox', 'Xbox'], ['ms-windows-store', 'Microsoft Store'], ['http', 'navegador']];
const isUri = x => /^[a-z][a-z0-9+.-]+:\/\//i.test(x || '');
function uriName(x) { const sc = String(x || '').split('://')[0].toLowerCase(); for (const [k, v] of URI_NAMES) if (sc.includes(k)) return v; return sc || 'launcher'; }
const SRC_NAMES = { steam: 'Steam', epic: 'Epic', gog: 'GOG', uplay: 'Ubisoft', ubisoft: 'Ubisoft', ea: 'EA', xbox: 'Xbox', scan: 'Pasta', heroic: 'Heroic', shortcuts: 'Atalho', esde: 'EmulationStation', launchbox: 'LaunchBox', pegasus: 'Pegasus', battlenet: 'Battle.net', amazon: 'Amazon', playnite: 'Playnite', url: 'link' };
const originOf = g => g.store_src || (g.source && g.source !== 'playnite' ? SRC_NAMES[g.source] || g.source : g.kind === 'rom' ? 'ROM' : g.repo === 'local' ? 'Manual' : '');
function daysAgo(ts) { const d = Math.floor((Date.now() / 1000 - ts) / 86400); return d <= 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`; }
function hydrate(g) { const fr = franchiseOf(g); g.fr = fr; g._q = qnorm([g.title, g.creator || '', fr || '', (g.genres || []).join(' '), (g.tags || []).join(' '), (S.systems && S.systems[g.system]) || g.system || '', g.year || '', SRC_NAMES[g.source] || g.source || '', g.store_src || '', g.kind === 'rom' ? 'rom emulado' : ''].join('\n')); return g; }
function setGames(list) {
  S.games = list.map(hydrate); S.byKey = Object.fromEntries(S.games.map(g => [g.key, g]));
  S._sorted = null; S._poolKey = '';
  renderRailX();
}
function railSysOn(id) { return S.view === 'home' && S.flt.sys.size === 1 && S.flt.sys.has(id); }
function railSysGo(id) {
  const was = railSysOn(id); clearFlt();
  if (!was) S.flt.sys.add(id);
  S.page = 1; if (S.view !== 'home') setView('home'); else renderLibrary();
  renderRailX();
}
function renderRailX() {
  const rail = $('#rail'); if (!rail) return;
  let box = $('#railx'); if (!box) { box = document.createElement('div'); box.className = 'rx'; box.id = 'railx'; const sp = rail.querySelector('.sp'); if (sp) sp.before(box); else rail.appendChild(box); }
  const lib = S.games.filter(g => g.installed && !g.hidden), m = new Map();
  for (const g of lib) { const id = g.system && g.system !== 'pc' ? g.system : 'pc'; m.set(id, (m.get(id) || 0) + 1); }
  const items = [...m.entries()].map(([id, n]) => [id, id === 'pc' ? 'PC' : (S.systems[id] || id), n]).sort((a, b) => a[0] === 'pc' ? -1 : b[0] === 'pc' ? 1 : b[2] - a[2]);
  const nb = rail.querySelector('.rb[data-view="home"] .n'); if (nb) nb.textContent = lib.length || ''; else { const hb = rail.querySelector('.rb[data-view="home"]'); if (hb) hb.insertAdjacentHTML('beforeend', `<span class="n">${lib.length || ''}</span>`); }
  const h = items.length > 1 ? `<div class="rxh">Plataformas</div>${items.map(([id, l, n]) => `<button class="rb sm${railSysOn(id) ? ' on' : ''}" onclick="railSysGo(${jsq(id)})" title="${esc(l)}"><i class="sw" data-s="${esc(id)}">${sysIcon(id) || sysIcon('pc')}</i><span>${esc(l)}</span><span class="n">${n}</span></button>`).join('')}` : '';
  const cl = colls();
  const hc = cl.length ? `<div class="rxh rxc" onclick="collManage()" title="Gerenciar coleções">Coleções<i>${I.cog}</i></div>${cl.map(c => `<button class="rb sm cl${railCollOn(c.id) ? ' on' : ''}" onclick="railCollGo(${jsq(c.id)})" title="${esc(c.name)}" data-c="${esc(c.id)}"><i class="sw">${I.coll}</i><span>${esc(c.name)}</span><span class="n">${c.keys.filter(k => S.byKey[k] && S.byKey[k].installed).length || ''}</span></button>`).join('')}` : '';
  if (box._h !== h + hc) { box.innerHTML = h + hc; box._h = h + hc; }
  box.querySelectorAll('.rb').forEach(b => b.classList.toggle('on', b.dataset.c ? railCollOn(b.dataset.c) : railSysOn(b.querySelector('.sw').dataset.s)));
}
function colls() { return Array.isArray(S.config.collections) ? S.config.collections : []; }
function collsOf(key) { return colls().filter(c => c.keys.includes(key)).map(c => c.id); }
function railCollOn(id) { return S.view === 'home' && S.flt.colls.size === 1 && S.flt.colls.has(id); }
function railCollGo(id) {
  const was = railCollOn(id); clearFlt();
  if (!was) S.flt.colls.add(id);
  S.page = 1; if (S.view !== 'home') setView('home'); else renderLibrary();
  renderRailX();
}
function collAfter(r, msg) {
  if (!r || r.error) return toast('bad', 'Coleções', (r && r.error) || 'Não deu para salvar.');
  S.config.collections = r.collections || []; renderRailX(); S._poolKey = ''; renderLibrary(); if (S.det) renderDetail();
  if (msg) toast('ok', 'Coleções', msg);
}
async function collToggle(id, key) {
  const c = colls().find(x => x.id === id), g = S.byKey[key] || {};
  const r = await api.post('/api/collections/toggle', { id, key });
  collAfter(r, c ? (r.on ? `${g.title || 'Jogo'} entrou em “${c.name}”.` : `${g.title || 'Jogo'} saiu de “${c.name}”.`) : '');
}
function collNew(key) {
  modal({ title: 'Nova coleção', text: key ? `O jogo ${esc((S.byKey[key] || {}).title || '')} já entra nela.` : 'Um nome curto, do seu jeito: “Terminar”, “Com amigos”, “Clássicos”…', input: '', ok: 'Criar', onOk: async v => {
    const name = String(v || '').trim(); if (!name) return;
    const r = await api.post('/api/collections/save', { id: '', name, keys: key ? [key] : [] });
    collAfter(r, r && !r.error ? `Coleção “${name}” criada.` : '');
  } });
}
function collManage() {
  const cl = colls();
  const rows = cl.map(c => `<div class="crow" data-id="${esc(c.id)}"><i>${I.coll}</i><input value="${esc(c.name)}" maxlength="60" onchange="collRename(${jsq(c.id)}, this.value)"><span>${pl(c.keys.length, 'jogo', 'jogos')}</span><button class="btn s xs" onclick="$('#modal').classList.remove('on');railCollGo(${jsq(c.id)})" title="Ver na biblioteca">${I.eye}</button><button class="btn s xs danger" onclick="collRemove(${jsq(c.id)})" title="Apagar coleção">${I.trash}</button></div>`).join('');
  modal({ title: 'Coleções', html: `<div class="crows">${rows || '<p class="muted">Nenhuma coleção ainda. Crie pelo botão abaixo ou pelo menu de um jogo (Coleções › Nova coleção…).</p>'}</div>`, extra: 'Nova coleção…', onExtra: () => collNew(''), noOk: true, cancel: 'Fechar' });
}
async function collRename(id, name) { const r = await api.post('/api/collections/save', { id, name }); if (r && r.error) { toast('bad', 'Coleções', r.error); return; } S.config.collections = r.collections || []; renderRailX(); }
function collRemove(id) {
  const c = colls().find(x => x.id === id); if (!c) return;
  modal({ title: 'Apagar coleção', text: `Apagar “${esc(c.name)}”? Os jogos continuam na biblioteca.`, ok: 'Apagar', danger: true, onOk: async () => { const r = await api.post('/api/collections/remove', { id }); S.flt.colls.delete(id); collAfter(r, `Coleção “${c.name}” apagada.`); } });
}
async function loadCatalog(refresh) {
  if (!S.loaded && !S._splCfg) { S._splCfg = 1; splashStep('lendo configurações', 36); }
  const d = await api.get('/api/catalog' + (refresh ? '?refresh=1' : ''));
  S.config = d.config || S.config;
  if (!S.loaded) { const v = $('#spv'); if (v && S.config.version) v.textContent = 'v' + S.config.version; if (d.loading) { if (!S._splScan) { S._splScan = 1; splashStep('procurando jogos', 58); } } else splashStep('biblioteca · ' + pl((d.games || []).filter(g => g.installed).length, 'jogo', 'jogos'), 72); } S.torrent = !!d.torrent_available; S.torrentEngine = d.torrent_engine || ''; S.systems = d.systems || {};
  await initLang(S.config.language);
  document.documentElement.style.setProperty('--cw', (S.config.card_size || 136) + 'px'); applyScale();
  S.cats = d.categories || []; S.repos = d.repos || []; S.faces = d.faces || S.faces || []; S.checkedAt = d.checked_at || 0; S.newsCount = d.news_count || 0;
  if (d.custom) S.custom = d.custom;
  applyTheme(); applyAnim(); applyChrome();
  if (!S.loaded && !d.loading) splashStep('aplicando tema', 88);
  if (d.online !== undefined) setOnline(!!d.online);
  S.sessions = d.sessions || {}; gpIndicator(d.gamepad);
  setGames(d.games || []);
  S.games.forEach(g => { if (g.job && !S.jobs[g.key]) S.jobs[g.key] = { stage: 'download', fraction: 0, detail: '' }; });
  if (d.loading) { renderView(); setTimeout(() => loadCatalog(false), 900); return; }
  if (d.roms_pending && !S._romPoll) { S._romPoll = setTimeout(() => { S._romPoll = 0; loadCatalog(false); }, 1500); }
  if (!S._sortInit) { S._sortInit = true; S.sort = sortForView(S.view); renderSortBtn(); }
  S.loaded = true; splashOff(); { const n = S.games.filter(g => g.installed).length; document.title = n ? `LudrixHub — ${pl(n, 'jogo', 'jogos')}` : 'LudrixHub'; applyQPlaceholder(); }
  if (!S.config.welcome_done && !S._welcomed) { S._welcomed = true; setTimeout(firstRun, 400); }
  if (S.config.welcome_done && S.config.version && S.config.seen_version !== S.config.version && !S._verTold) { S._verTold = true; const prev = S.config.seen_version; api.post('/api/config', { seen_version: S.config.version }, { quiet: true }); S.config.seen_version = S.config.version; if (prev) setTimeout(() => toast('ok', `Atualizado para ${S.config.version}`, 'Veja o que mudou nesta versão.', [{ label: 'Ver novidades', fn: whatsNew }, { label: 'Depois', fn: () => {} }]), 1200); }
  if (S.config.safe_mode && !S._safeTold) { S._safeTold = true; setTimeout(safeModeNotice, 1200); }
  if (S.config.rolled_back && !S._rbTold) { S._rbTold = true; const rb = S.config.rolled_back; setTimeout(() => toast('warn', `Voltei para a versão ${rb.to || 'anterior'}`, `A atualização ${rb.from || ''} não conseguiu abrir duas vezes seguidas, então a versão anterior foi restaurada sozinha. Você pode tentar atualizar de novo em Ajustes › Atualizações.`, [{ label: 'Entendi', fn: () => {} }]), 1500); }
  if (!S._updBoot) { S._updBoot = true; setTimeout(() => loadUpdates(false), 2500); }
  if (S.config.welcome_done && S.config.warn_missing !== false && !S._missTold) { S._missTold = true; const nb = S.games.filter(FLAG_TEST.broken).length; if (nb) setTimeout(() => toast('warn', `${pl(nb, 'jogo', 'jogos')} com arquivo não encontrado`, 'O executável ou a ROM não está mais onde estava.', [{ label: 'Ver quais', fn: () => flagOnly('broken') }, { label: 'Verificar jogos', fn: () => libraryCheck() }, { label: 'Depois', fn: () => {} }]), 1800); }
  if (d.sites_loading) { clearTimeout(S._siteT); S._siteT = setTimeout(quietCatalogRefresh, 8000); }
  if (['home'].includes(S.view)) refreshHome();
  if (d.errors && Object.keys(d.errors).length) repoErrors(d.errors);
  renderView(); setupHero();
}

function repoErrors(errs) {
  S._repoErr = S._repoErr || {};
  for (const [id, v] of Object.entries(errs)) {
    const e = typeof v === 'string' ? { name: id, msg: v } : (v || {});
    const sig = id + '|' + (e.msg || '');
    if (S._repoErr[id] === sig) continue;
    S._repoErr[id] = sig;
    const name = e.name || id;
    const acts = [
      { label: 'Remover fonte', fn: () => removeRepoQuiet(id) },
      { label: 'Desativar', fn: () => toggleRepoQuiet(id) },
      { label: 'Ignorar', fn: () => {} }
    ];
    toast(e.missing ? 'warn' : 'err', e.missing ? `Fonte "${name}" sem arquivo` : `Fonte "${name}" não carregou`, e.missing ? `${e.msg}. O arquivo foi movido ou apagado.` : e.msg, acts);
  }
}
async function removeRepoQuiet(id) { const r = await api.post('/api/repos/remove', { id }); if (r.error) return toast('err', 'Não foi possível remover', r.error); delete (S._repoErr || {})[id]; toast('ok', 'Fonte removida', ''); loadCatalog(false); }
async function toggleRepoQuiet(id) { const r = await api.post('/api/repos/toggle', { id, enabled: false }); if (r.error) return toast('err', 'Não foi possível desativar', r.error); delete (S._repoErr || {})[id]; toast('ok', 'Fonte desativada', 'Reative em Fontes quando quiser'); loadCatalog(false); }

async function quietCatalogRefresh() {
  const d = await api.get('/api/catalog'); if (!d || d.loading) return;
  const before = S.games.length;
  if ((d.games || []).length === before && !d.sites_loading) return;
  setGames(d.games || []);
  if (S.games.length !== before && S.view === 'store' && S.tab.store !== 'sources' && !$('#modal').classList.contains('on') && !$('#detail').classList.contains('on') && !S.q) { const st = $('#view').scrollTop; renderLibrary(); $('#view').scrollTop = st; }
  if (S.games.length !== before && S.view === 'emulation' && !$('#modal').classList.contains('on') && !$('#detail').classList.contains('on')) { const st = $('#view').scrollTop; renderEmulation().then(() => { $('#view').scrollTop = st; }); }
  if (d.sites_loading) { clearTimeout(S._siteT); S._siteT = setTimeout(quietCatalogRefresh, 8000); }
}

document.querySelectorAll('.rb').forEach(b => b.onclick = () => setView(b.dataset.view));
function setView(v) {
  if (v === 'redists' || v === 'gamemode') { S.tab.central = 'redists'; v = 'central'; }
  if (v === S.view && !S.current && !$('#modal').classList.contains('on')) { $('#view').scrollTop = 0; return; }
  const vtOk = ['home', 'store'].includes(v) && ['home', 'store', 'mods', 'flash'].includes(S.view) && v !== S.view && !S.current && document.documentElement.dataset.anim !== 'off' && !document.body.classList.contains('rm') && !!document.startViewTransition;
  if (!vtOk) { const vw = $('#view'); vw.classList.remove('vin'); void vw.offsetWidth; vw.classList.add('vin'); clearTimeout(S._vinT); S._vinT = setTimeout(() => vw.classList.remove('vin'), 400); }
  else { const order = gpViews(); const dir = order.indexOf(v) < order.indexOf(S.view) ? 'back' : 'fwd'; document.documentElement.dataset.vdir = dir; S._vtView = true; }
  if (S._metaDirty && ['home', 'store'].includes(v)) { S._metaDirty = false; api.get('/api/catalog').then(d => { if (d && !d.loading) { setGames(d.games || []); if (['home', 'store'].includes(S.view)) renderLibrary(); if (S.view === 'home') refreshHome(); } }); }
  S.page = 1;
  if (v !== 'home') gameFocus(null);
  if (['home', 'store'].includes(v) && v !== S.view) { S.sort = sortForView(v); S.sortRev = false; }
  S.view = v; closeDetail();
  document.querySelectorAll('.rb').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $('#view').scrollTop = 0; S._enter = true; guideDismiss();
  if (S._vtView) { S._vtView = false; vtRun(() => { renderView(); }, 'view').then(() => { delete document.documentElement.dataset.vdir; }); } else renderView();
  zoomVis();
}
function enterFx() { const v = $('#view'); if (S._enter) { S._enter = false; v.classList.add('enter'); clearTimeout(S._enterT); S._enterT = setTimeout(() => v.classList.remove('enter'), 700); } }
let tsvMemo = null;
function topSearchVisible() { if (tsvMemo !== null) return tsvMemo; const el = document.querySelector('.top .search, .rail .search'); let v = false; if (el && el.offsetParent !== null) { const r = el.getBoundingClientRect(); v = r.width > 40 && r.height > 0; } tsvMemo = v; requestAnimationFrame(() => { tsvMemo = null; }); return v; }
function renderView() {
  qfabSync();
  closeCtx(); enterFx();
  const grid = ['home', 'store'].includes(S.view) && !(S.view === 'store' && S.tab.store === 'sources');
  applyQPlaceholder();
  $('#helppop').classList.remove('on');
  if (S.view === 'home') renderLibrary();
  else if (S.view === 'store') { if (S.tab.store === 'sources') renderSources(); else { renderLibrary(); guide('store'); } }
  else if (S.view === 'mods') renderMods();
  else if (S.view === 'emulation') renderEmulation().then(() => guide('emulation'));
  else if (S.view === 'downloads') renderDownloads().then(() => guide('downloads'));
  else if (S.view === 'flash') renderFlash();
  else if (S.view === 'central') renderCentral();
  else if (S.view === 'settings') renderSettings(true).then(() => guide('settings'));
  requestAnimationFrame(fitChips);
}
const QRO = typeof ResizeObserver === 'function' ? new ResizeObserver(es => es.forEach(e => { const q = e.target.classList.contains('qchips') ? e.target : e.target.querySelector('.qchips'); if (q) q.classList.toggle('ov', q.scrollWidth > q.clientWidth + 1); })) : null;
function fitChips() { document.querySelectorAll('.qchips').forEach(q => { q.classList.toggle('ov', q.scrollWidth > q.clientWidth + 1); if (!q._ovw) { q._ovw = true; if (QRO) { QRO.observe(q); if (q.parentElement) QRO.observe(q.parentElement); } q.addEventListener('wheel', e => { if (q.classList.contains('ov') && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { q.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false }); } }); }
window.addEventListener('resize', () => requestAnimationFrame(fitChips));

const isRepoRom = g => g.kind === 'rom' && g.repo !== 'local' && !g.key.startsWith('rom:');
const inStore = g => g.repo !== 'local' && !isRepoRom(g) && !((g.installed || g.owned) && !S.jobs[g.key] && S.config.store_hide_installed !== false);
const inEmu = g => isRepoRom(g) && (!g.installed || S.jobs[g.key]) && (!S.emuSys || g.system === S.emuSys);
const inView = g => g.dup_of ? false : (g.hidden && !S.flt.flags.has('hidden') && !(S.q && S.view === 'home')) ? false : S.view === 'home' ? (g.installed || FLAG_TEST.broken(g)) : S.view === 'store' ? inStore(g) : S.view === 'emulation' ? inEmu(g) : true;
const COLL = new Intl.Collator('pt', { sensitivity: 'base', numeric: true });
function sortedAZ() {
  if (!S._sorted) { S._sorted = [...S.games].sort((a, b) => COLL.compare(a.title, b.title)); S._sorted.forEach((g, i) => g._az = i); }
  return S._sorted;
}
const Q_PREFIX = { year: 'ano', sys: 'sis', origin: 'origem', etiqueta: 'tag' };
function qPrefix(g, k, v) {
  if (k === 'dev') return qnorm(g.creator || '').includes(v);
  if (k === 'ano') return String(g.year || '') === v || (v.endsWith('s') && String(g.year || '').startsWith(v.slice(0, 3)));
  if (k === 'gen') return (g.genres || []).some(x => qnorm(x).includes(v)) || (g.cats || []).some(x => qnorm(x).includes(v));
  if (k === 'tag' || k === 'etiqueta') return (g.tags || []).some(x => qnorm(x).includes(v));
  if (k === 'sis') return qnorm((S.systems && S.systems[g.system]) || g.system || 'pc').includes(v) || qnorm(g.system || 'pc').includes(v);
  return qnorm(originOf(g) + ' ' + (g.store_src || '') + ' ' + (SRC_NAMES[g.source] || g.source || '')).includes(v);
}
function visible() {
  const q = qnorm(S.q), qw0 = q ? q.split(' ') : [], f = S.flt, cat = S.cat, flags = [...f.flags].map(k => FLAG_TEST[k]);
  const qp = [], qw = [], qs = [];
  for (const w of qw0) { const m = w.match(/^(dev|ano|year|gen|sis|sys|origem|origin|src|tag|etiqueta):(.+)$/); if (m) qp.push([Q_PREFIX[m[1]] || m[1], m[2]]); else { const sm = smartOf(w); if (sm) qs.push([w, sm]); else qw.push(w); } }
  S._smart = qs.map(x => x[1]);
  const hasCats = f.cats.size > 0, hasSys = f.sys.size > 0, hasRepos = S.view === 'store' && f.repos.size > 0, hasSrc = f.src.size > 0;
  let list = sortedAZ().filter(g => {
    if (!inView(g)) return false;
    if (qw.length && !qw.every(w => g._q.includes(w))) return false;
    if (qs.length && !qs.every(([w, sm]) => g._q.includes(w) || sm.test(g))) return false;
    if (qp.length && !qp.every(([k, v]) => qPrefix(g, k, v))) return false;
    if (hasSrc && !f.src.has(originOf(g))) return false;
    if (cat !== 'all' && !(g.cats || []).includes(cat)) return false;
    if (hasCats && !(g.cats || []).some(c => f.cats.has(c))) return false;
    if (hasSys && !f.sys.has(g.system || 'pc')) return false;
    if (hasRepos && !f.repos.has(g.repo)) return false;
    if (f.genres.size && !(g.genres || []).some(x => f.genres.has(x))) return false;
    if (f.tags.size && !(g.tags || []).some(x => f.tags.has(x))) return false;
    if (f.colls.size && !collsOf(g.key).some(id => f.colls.has(id))) return false;
    if (f.devs.size && !f.devs.has(g.creator || '')) return false;
    if (f.years.size && !f.years.has(String(g.year || ''))) return false;
    for (const k of BUCKET_KINDS) if (f[k].size && !f[k].has(bucketOf[k](g))) return false;
    for (const t of flags) if (!t(g)) return false;
    return true;
  });
  if (S.view === 'home' && !filtersActive() && !S.q && S.sort === 'az' && !S.sortRev && !muralMode()) { const ho = homeOrder(list); return S.config.fav_first ? ho.filter(g => g.fav).concat(ho.filter(g => !g.fav)) : ho; }
  const az = (a, b) => a._az - b._az;
  if (S.sort === 'recent') list.sort((a, b) => (b.last_played || 0) - (a.last_played || 0) || (b.added_at || 0) - (a.added_at || 0) || az(a, b));
  else if (S.sort === 'most') list.sort((a, b) => (b.playtime || 0) - (a.playtime || 0) || az(a, b));
  else if (S.sort === 'added') list.sort((a, b) => (b.added_at || 0) - (a.added_at || 0) || az(a, b));
  else if (S.sort === 'year') list.sort((a, b) => (+b.year || 0) - (+a.year || 0) || az(a, b));
  else if (S.sort === 'size') list.sort((a, b) => (b.size || 0) - (a.size || 0) || az(a, b));
  else if (S.sort === 'dev') list.sort((a, b) => COLL.compare(a.creator || a.fr || '\uffff', b.creator || b.fr || '\uffff') || az(a, b));
  else if (S.sort === 'count') list.sort((a, b) => (b.play_count || 0) - (a.play_count || 0) || (b.playtime || 0) - (a.playtime || 0) || az(a, b));
  else if (S.sort === 'score') list.sort((a, b) => (b.score || 0) - (a.score || 0) || az(a, b));
  else if (S.sort === 'fresh') list.sort((a, b) => (b.fresh ? 1 : 0) - (a.fresh ? 1 : 0) || (b.added_at || 0) - (a.added_at || 0) || az(a, b));
  if (S.sortRev) list.reverse();
  if (S.config.fav_first && S.view === 'home') { const f = list.filter(g => g.fav), o = list.filter(g => !g.fav); list = f.concat(o); }
  return list;
}
function poolStats() {
  const key = S.view + '|' + S.tab.store + '|' + (S.emuSys || '') + '|' + (S.config.store_hide_installed !== false) + '|' + Object.keys(S.jobs).length;
  if (S._poolKey === key && S._pool) return S._pool;
  const counts = {}, scount = {}, fcount = {}, rcount = {}, ocount = {}, gcount = {}, tcount = {}, dcount = {}, ycount = {}, bcount = { lastp: {}, added: {}, ptime: {}, size: {}, status: {}, score: {} }; let n = 0;
  const flagIds = FLAGS.map(f => f[0]); for (const id of flagIds) fcount[id] = 0;
  const inc = (o, k) => { if (k) o[k] = (o[k] || 0) + 1; };
  for (const g of S.games) {
    if (!inView(g)) continue; n++;
    if (g.cats) for (const c of g.cats) counts[c] = (counts[c] || 0) + 1;
    const sy = g.system || 'pc'; scount[sy] = (scount[sy] || 0) + 1; if (g.repo) rcount[g.repo] = (rcount[g.repo] || 0) + 1; const og = originOf(g); if (og) ocount[og] = (ocount[og] || 0) + 1;
    if (g.genres) for (const x of g.genres) inc(gcount, x);
    if (g.tags) for (const x of g.tags) inc(tcount, x);
    inc(dcount, g.creator || ''); inc(ycount, String(g.year || ''));
    for (const k of BUCKET_KINDS) inc(bcount[k], bucketOf[k](g));
    for (const id of flagIds) if (FLAG_TEST[id](g)) fcount[id]++;
  }
  S._poolKey = key; return S._pool = { n, counts, scount, fcount, rcount, ocount, gcount, tcount, dcount, ycount, bcount };
}
function renderChips() {
  const { n, counts } = poolStats();
  const el = $('#chips');
  if (!n) { el.innerHTML = ''; el._h = ''; return; }
  const cur = S.cat !== 'all' && counts[S.cat] ? S.cats.find(c => c.id === S.cat) : null;
  const label = cur ? cur.name : 'Todas as categorias';
  const h = `<button class="chip dd ${cur ? 'on' : ''}" data-dd="cats" title="Categoria">${I.tag}<span class="lbl">${esc(label)}</span><span class="n">${cur ? counts[S.cat] : n}</span><svg class="car" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button>`;
  if (el._h !== h) { el._h = h; el.innerHTML = h; }
}
function catMenu(btn) {
  const { n, counts } = poolStats();
  const items = [{ label: 'Todas as categorias', hint: String(n), icon: S.cat === 'all' ? 'check' : '', fn: () => { S.cat = 'all'; S.page = 1; renderLibrary(); } }, { sep: true }];
  for (const c of S.cats) { if (!counts[c.id]) continue; items.push({ label: c.name, hint: String(counts[c.id]), icon: S.cat === c.id ? 'check' : '', fn: () => { S.cat = c.id; S.page = 1; renderLibrary(); } }); }
  const r = btn.getBoundingClientRect(); showCtx(items, r.left, r.bottom + 6, 'Categoria');
}
$('#chips').addEventListener('click', e => { const b = e.target.closest('[data-dd]'); if (!b) return; e.stopPropagation(); catMenu(b); });
const QCHIPS = [['', 'Todos'], ['fav', 'Favoritos'], ['recent', 'Jogados esta semana'], ['never', 'Nunca joguei']];
function qchipOn(id) { if (!id) return !filtersActive(); return S.flt.flags.size === 1 && S.flt.flags.has(id) && fltCount() === 1 && S.cat === 'all'; }
const STORE_CHIPS = [['', 'Tudo'], ['fresh', 'Novos'], ['direct', 'Download direto'], ['torrent', 'Torrent']];
function storeChips() {
  const chips = STORE_CHIPS.filter(([id]) => id !== 'fresh' || S.newsCount || S.flt.flags.has('fresh')).map(([id, l]) => `<button class="chip${qchipOn(id) ? ' on' : ''}" onclick="${!id || qchipOn(id) ? 'clearFlt()' : `flagOnly('${id}')`}" ${id === 'fresh' ? 'title="Jogos que apareceram nas fontes desde a leitura anterior"' : ''}>${l}${id === 'fresh' && S.newsCount ? ` <span class="n">${S.newsCount}</span>` : ''}</button>`);
  if (qchipOn('fresh') && S.newsCount) chips.push(`<button class="chip ghost" onclick="newsSeen()" title="Tira a marca NOVO desses jogos">Marcar como vistos</button>`);
  const hid = S.config.store_hide_installed !== false;
  chips.push(`<button class="chip ghost${hid ? '' : ' on'}" onclick="setCfg({store_hide_installed:${hid ? 'false' : 'true'}}).then(()=>{S._poolKey='';renderLibrary()})" title="${hid ? 'Os jogos que já estão no PC ficam escondidos na Store' : 'Mostrando também os jogos que já estão no PC'}">${hid ? 'Já instalados' : 'Com instalados'}</button>`);
  return `<div class="qchips">${chips.join('')}</div>`;
}
async function newsSeen(id) { await api.post('/api/repos/seen', id ? { id } : {}); clearFlt(); await loadCatalog(false); if (S.view === 'store' && S.tab.store === 'sources') renderSources(); }
function quickChips() { return `<div class="qchips">${QCHIPS.map(([id, l]) => `<button class="chip${qchipOn(id) ? ' on' : ''}" onclick="${!id || qchipOn(id) ? 'clearFlt()' : `flagOnly('${id}')`}">${l}</button>`).join('')}</div>`; }
function renderLibrary() {
  requestAnimationFrame(fitChips);
  qfabSync();
  renderChips();
  S._multiSrc = S.view === 'store' && new Set(S.games.filter(inStore).map(g => g.repo)).size > 1;
  const list = visible();
  const fltNames = fltLabels().map(x => x[2]);
  const catName = S.view === 'home' ? 'Biblioteca' : S.cat !== 'all' ? (S.cats.find(c => c.id === S.cat) || {}).name : fltNames.length ? fltNames.slice(0, 3).join(' · ') + (fltNames.length > 3 ? ` +${fltNames.length - 3}` : '') : 'Catálogo';
  let h = '';
  if (S.view === 'store') h += storeTabs();
  if (S.view === 'store' && !filtersActive() && !S.q && S.hero.length && S.config.hero_enabled !== false) h += heroHtml();
  if (S.view === 'home' && !filtersActive() && !S.q) h += homeTop();
  h += `<div class="h1"><h2>${esc(catName)}</h2>${S.view === 'home' ? quickChips() : storeChips()}<span class="cnt">${list.length} ${list.length === 1 ? 'jogo' : 'jogos'}</span><span class="sp"></span>
        ${!topSearchVisible() ? `<div class="qmini ${S.q ? 'on' : ''}"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="qm" placeholder="Buscar…" value="${esc(S.q)}" autocomplete="off" spellcheck="false" oninput="miniSearch(this.value)" onfocus="this.parentElement.classList.add('on')" onblur="if(!this.value)this.parentElement.classList.remove('on')"><kbd>/</kbd></div>` : ''}
${filterBtn()}
        ${S.view === 'home' ? `<button class="btn s xs ic" onclick="surprise()" title="Me surpreenda — escolhe um jogo para você jogar agora">${I.dice}</button><button class="btn p xs addbtn" onclick="addGameMenu()">+ Adicionar</button>` : `<button class="btn s xs" onclick="loadCatalog(true)" title="${S.checkedAt ? 'Última leitura das fontes: ' + new Date(S.checkedAt * 1000).toLocaleString('pt-BR') : 'Fontes ainda não lidas'}">${I.refresh}<span class="lb">Atualizar</span></button>`}</div>`;
  h += activeChips();
  const noSrc = S.view === 'store' && !S.repos.some(r => r.enabled && r.kind !== 'rom');
  if (!S.games.length && !noSrc && !(S.view === 'home' && S.loaded)) h += `<div class="grid">${Array.from({ length: 18 }, () => '<div class="card sk"><div class="cov"></div><h4>&nbsp;</h4></div>').join('')}</div>`;
  else if (!list.length && noSrc && !S.q && !filtersActive()) h += `${emptyHtml('sources', S.repos.length ? 'Nenhuma fonte ligada' : 'Nenhuma fonte adicionada', `A Store mostra o que as suas fontes de jogos de PC oferecem${S.repos.some(r => r.enabled && r.kind === 'rom') ? ' — as fontes de ROM ficam na aba <b>Emuladores</b>' : ''}. ${S.repos.length ? 'Ligue uma em' : 'Adicione uma em'} <b>Fontes</b>: site de download, coleção do archive.org, GitHub ou lista .json.`, [['Abrir Fontes', "S.tab.store='sources';renderView()", 1], ['Adicionar jogo que já tenho', 'addLocal()']])}`;
  else if (!list.length) h += `${S.view === 'home' ? (S.q || filtersActive() ? (S.flt.flags.has('fav') && !S.q && S.flt.flags.size === 1 ? emptyHtml('stars', 'Nenhum favorito ainda', 'Clique na estrela de um jogo para ele aparecer aqui.', [['Ver todos', 'clearFlt()', 1]]) : emptyHtml(I.search, 'Nenhum jogo com esse filtro', /\b(dev|ano|gen|sis|origem|src):/.test(S.q) ? 'Prefixos aceitos: dev: (desenvolvedora), ano: (ano ou década, ex. 2010s), gen: (gênero), sis: (sistema), origem: (Steam, Epic, ROM…).' : 'Tente outro termo ou limpe os filtros.', [['Limpar busca e filtros', 'clearSearch();clearFlt()', 1]])) : emptyHtml(I.home, 'Sua biblioteca está vazia', 'Baixe algo na Store ou adicione um jogo que você já tem — um .exe, um atalho ou uma ROM.', [['Abrir Store', "setView('store')", 1], ['Adicionar jogo', 'addLocal()'], ['Importar de outro launcher', 'importWizard()']])) : emptyHtml(I.search, 'Nenhum resultado', 'Tente outro termo ou categoria.', [['Limpar busca e filtros', 'clearSearch();clearFlt()', 1]])}`;
  if (S.view === 'store' && list.length && q.length >= 3 && S.repos.some(r => r.enabled && /^site-/.test(r.id)) && !S._siteQ) h += `<div class="sitehint">Não achou? <button class="lnk" onclick="siteSearch()">Buscar "${esc(S.q.trim())}" direto nos sites ligados</button></div>`;
  else h += `${listHead()}${azBar(list)}<div class="grid${listMode() ? ' lst' : muralMode() ? ' mural' : ''}" id="grid" style="--lmw:${lmWidth()}px"></div>`;
  const pin = fpOn(), oldP = $('#fpanel'), pst = oldP ? oldP.scrollTop : 0;
  const pk = S.view === 'home' && S.panelKey && S.byKey[S.panelKey] ? S.panelKey : '';
  if (!pk) S.panelKey = '';
  $('#view').innerHTML = pin || pk ? `<div class="libwrap${pk ? ' pw' : ''}${pin && pk ? ' fp' : ''}"><div class="libmain">${h}</div>${pin ? fpanelHtml() : ''}${pk ? gpanelHtml(pk) : ''}</div>` : h;
  if (pk) gpanelFill(pk);
  if (pin && pst) { const np = $('#fpanel'); if (np) np.scrollTop = pst; }
  if (list.length) fillGrid(list);
  if (S.hero.length && $('#hero')) showHero(S.heroIdx);
  if (S.view === 'home' && S._focusKey) gameFocus(null);
  if (S.view === 'home' && S.config.cover_slideshow && !ssT && !(S._focusKey && S.config.game_backdrop)) slideshowStart();
}
let gridGen = 0, gridIO = null, gridMore = null;
const GROUPS = [['', 'Sem grupos'], ['system', 'Plataforma'], ['category', 'Categoria'], ['letter', 'Letra'], ['played', 'Última vez jogada'], ['installed', 'Instalado ou não'], ['origin', 'Origem'], ['status', 'Status'], ['score', 'Sua nota'], ['genre', 'Gênero'], ['year', 'Ano'], ['dev', 'Desenvolvedora']];
const LIST_COLS = [['year', 'Ano'], ['genre', 'Gênero'], ['dev', 'Desenvolvedora'], ['system', 'Plataforma'], ['size', 'Tamanho'], ['playtime', 'Tempo'], ['last', 'Última vez'], ['count', 'Vezes'], ['added', 'Adicionado'], ['status', 'Status'], ['score', 'Nota']];
const LIST_W = { year: 36, genre: 120, dev: 120, system: 70, size: 64, playtime: 60, last: 88, count: 44, added: 84, status: 112, score: 40 };
function lmWidth() { const c = listCols(); return c.reduce((a, id) => a + (LIST_W[id] || 60), 0) + (c.length - 1) * 14; }
const LIST_SORT = { year: 'year', size: 'size', playtime: 'most', last: 'recent', count: 'count', added: 'added', score: 'score', dev: 'dev' };
function listCols() { const c = Array.isArray(S.config.list_cols) ? S.config.list_cols.filter(id => LIST_COLS.some(x => x[0] === id)) : null; return c && c.length ? c : ['year', 'genre', 'size', 'playtime', 'last', 'status']; }
function toggleListCol(id) { const cur = listCols(); const next = cur.includes(id) ? cur.filter(x => x !== id) : LIST_COLS.map(x => x[0]).filter(x => cur.includes(x) || x === id); if (!next.length) return; setCfg({ list_cols: next }).then(() => { renderLibrary(); const f = $('#vpop'); if (f) f.classList.add('on'); }); }
function listCell(g, id) {
  switch (id) {
    case 'year': return esc(g.year || '');
    case 'genre': return esc((g.genres && g.genres[0]) || g.creator || g.fr || '');
    case 'dev': return esc(g.creator || '');
    case 'system': return esc(g.system && g.system !== 'pc' ? (S.systems[g.system] || g.system) : 'PC');
    case 'size': return fmt(g.size);
    case 'playtime': return ptHtml(g.playtime);
    case 'last': return lastPlayedText(g.last_played);
    case 'count': return g.play_count ? String(g.play_count) : '';
    case 'added': return g.added_at ? new Date(g.added_at * 1000).toLocaleDateString() : '';
    case 'status': return esc(statusName(g.status));
    case 'score': return g.score ? '★' + g.score : '';
  }
  return '';
}
function listHead() {
  if (!listMode() || !['home', 'store'].includes(S.view)) return '';
  const cell = id => { const l = (LIST_COLS.find(x => x[0] === id) || [])[1] || id, sk = LIST_SORT[id], on = sk && S.sort === sk; return `<span class="c-${id}${on ? ' on' : ''}" ${sk ? `onclick="${on ? 'S.sortRev=!S.sortRev;S.page=1;renderSortBtn();renderLibrary()' : `setSort('${sk}')`}" title="Ordenar por ${esc(l.toLowerCase())}"` : ''}>${esc(l)}${on ? (S.sortRev ? ' ↑' : ' ↓') : ''}</span>`; };
  return `<div class="lsth" style="--lmw:${lmWidth()}px"><span class="c-cov"></span><span class="c-title${S.sort === 'az' ? ' on' : ''}" onclick="${S.sort === 'az' ? 'S.sortRev=!S.sortRev;S.page=1;renderSortBtn();renderLibrary()' : "setSort('az')"}">Nome${S.sort === 'az' ? (S.sortRev ? ' ↑' : ' ↓') : ''}</span><div class="lm">${listCols().map(cell).join('')}</div><span class="c-acts"></span></div>`;
}
const PLAYED_BUCKETS = ['Jogando hoje', 'Esta semana', 'Este mês', 'Há mais tempo', 'Nunca jogado'];
function groupKey(g, by) {
  if (by === 'system') return g.system && g.system !== 'pc' ? (S.systems[g.system] || g.system) : 'PC';
  if (by === 'category') { const c = (g.cats || [])[0]; return c ? ((S.cats.find(x => x.id === c) || {}).name || c) : 'Sem categoria'; }
  if (by === 'letter') { const ch = (g.title || '?').trim().charAt(0).toUpperCase(); return /[A-Z]/.test(ch) ? ch : /[0-9]/.test(ch) ? '0–9' : '#'; }
  if (by === 'played') { if (!g.last_played) return PLAYED_BUCKETS[4]; const d = (Date.now() / 1000 - g.last_played) / 86400; return d < 1 ? PLAYED_BUCKETS[0] : d < 7 ? PLAYED_BUCKETS[1] : d < 30 ? PLAYED_BUCKETS[2] : PLAYED_BUCKETS[3]; }
  if (by === 'installed') return g.installed ? 'Instalados' : 'Não instalados';
  if (by === 'origin') return originOf(g) || 'Outros';
  if (by === 'status') return statusName(g.status) || 'Sem status';
  if (by === 'score') return g.score ? `Nota ${g.score}` : 'Sem nota';
  if (by === 'genre') return (g.genres && g.genres[0]) || 'Sem gênero';
  if (by === 'year') return String(g.year || 'Sem ano');
  if (by === 'dev') return g.creator || 'Sem desenvolvedora';
  return '';
}
function groupSort(by, a, b) {
  if (by === 'played') return PLAYED_BUCKETS.indexOf(a) - PLAYED_BUCKETS.indexOf(b);
  if (by === 'installed') return a === 'Instalados' ? -1 : 1;
  if (by === 'system') return a === 'PC' ? -1 : b === 'PC' ? 1 : a.localeCompare(b, 'pt');
  if (by === 'category') return a === 'Sem categoria' ? 1 : b === 'Sem categoria' ? -1 : a.localeCompare(b, 'pt');
  if (by === 'status') { const o = ['Sem status', ...STATUS.map(x => x[1])]; const i = o.indexOf(a), j = o.indexOf(b); return (i < 1 ? 99 : i) - (j < 1 ? 99 : j); }
  if (by === 'score') return (b === 'Sem nota' ? -1 : +b.slice(5)) - (a === 'Sem nota' ? -1 : +a.slice(5));
  if (by === 'year') return a.startsWith('Sem') ? 1 : b.startsWith('Sem') ? -1 : +b - +a;
  if (by === 'genre' || by === 'dev') return a.startsWith('Sem ') ? 1 : b.startsWith('Sem ') ? -1 : a.localeCompare(b, 'pt');
  return a.localeCompare(b, 'pt');
}
function groupBy() { return S.view === 'store' ? (S.config.group_store ?? '') : (S.config.group_by ?? 'letter'); }
function setGroupBy(id) { return setCfg(S.view === 'store' ? { group_store: id } : { group_by: id }); }
function gcolKey(k) { return `${S.view}|${k}`; }
function groupsAll(col) { document.querySelectorAll('#view .ggrp').forEach(w => { w.classList.toggle('col', col); if (col) S._gcol.add(gcolKey(w.dataset.g)); else S._gcol.delete(gcolKey(w.dataset.g)); }); try { localStorage.setItem('lx_gcol', JSON.stringify([...S._gcol])); } catch (_) {} }
function groupedList(list) {
  const by = groupBy(); if (!by || !['home', 'store'].includes(S.view)) return null;
  const m = new Map(); for (const g of list) { const k = groupKey(g, by); if (!m.has(k)) m.set(k, []); m.get(k).push(g); }
  return [...m.keys()].sort((a, b) => groupSort(by, a, b)).map(k => [k, m.get(k)]);
}
S._gcol = S._gcol || new Set((() => { try { return JSON.parse(localStorage.getItem('lx_gcol') || '[]'); } catch (_) { return []; } })());
function groupToggle(el) { const w = el.closest('.ggrp'); w.classList.toggle('col'); const k = gcolKey(w.dataset.g); if (w.classList.contains('col')) S._gcol.add(k); else S._gcol.delete(k); try { localStorage.setItem('lx_gcol', JSON.stringify([...S._gcol])); } catch (_) {} }
function groupHead(k, n, pt) { return `<div class="ggh" onclick="groupToggle(this)"><b>${esc(k)}</b><span>${n}${pt >= 3600 ? ` · ${fmtTime(pt)}` : ''}</span><i>${I.chev || '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>'}</i></div>`; }
function fillGrid(list) {
  const gen = ++gridGen, grid = $('#grid'); if (!grid) return;
  if (gridIO) { gridIO.disconnect(); gridIO = null; }
  const CH = 120; let i = 0;
  const groups = groupedList(list); let flat = list, cur = null, curGi = -1; const gidx = [];
  if (groups) { grid.classList.remove('grid', 'lst'); grid.classList.add('ggwrap'); flat = []; groups.forEach(([, gs], k) => gs.forEach(g => { flat.push(g); gidx.push(k); })); }
  const more = () => {
    if (gen !== gridGen || !document.contains(grid)) return false;
    if (!groups) grid.insertAdjacentHTML('beforeend', flat.slice(i, i + CH).map((g, j) => cardHtml(g, i + j)).join(''));
    else {
      let pending = '';
      const flush = () => { if (cur && pending) cur.insertAdjacentHTML('beforeend', pending); pending = ''; };
      for (let j = i; j < Math.min(i + CH, flat.length); j++) {
        if (gidx[j] !== curGi) {
          flush(); curGi = gidx[j]; const [k, gs] = groups[curGi];
          grid.insertAdjacentHTML('beforeend', `<div class="ggrp${S._gcol.has(gcolKey(k)) ? ' col' : ''}" data-g="${esc(k)}">${groupHead(k, gs.length, gs.reduce((a, g) => a + (g.playtime || 0), 0))}<div class="grid${listMode() ? ' lst' : ''}"></div></div>`);
          cur = grid.lastElementChild.lastElementChild;
        }
        pending += cardHtml(flat[j], j);
      }
      flush();
    }
    i += CH; return i < flat.length;
  };
  more(); gridMore = more;
  if (i >= list.length) return;
  const sent = document.createElement('div'); sent.className = 'more'; sent.innerHTML = `<span>mostrando ${i} de ${list.length}</span>`; grid.after(sent);
  gridIO = new IntersectionObserver(es => { if (!es.some(e => e.isIntersecting)) return; const has = more(); sent.querySelector('span').textContent = `mostrando ${Math.min(i, list.length)} de ${list.length}`; if (!has) { gridIO.disconnect(); gridIO = null; sent.remove(); } }, { root: $('#view'), rootMargin: '900px' });
  gridIO.observe(sent);
}
function listMode() { return S.config.view_mode === 'list'; }
function muralMode() { return (S.config.view_mode || 'mural') === 'mural' && S.view === 'home'; }
function setCardSize(v, save) { document.documentElement.style.setProperty('--cw', v + 'px'); S.config.card_size = +v; if (save) api.post('/api/config', { card_size: +v }); }
function selectGame(key) {
  if (!S.byKey[key]) return;
  document.querySelectorAll('#view .card.sel').forEach(c => c.classList.remove('sel'));
  document.querySelectorAll(`#view .card[data-key="${CSS.escape(key)}"]`).forEach(c => c.classList.add('sel'));
  S.nowKey = key;
  S.stageKey = key; gameFocus(key);
  if (muralMode()) panelOpen(key); else nowbarFill();
}
const PANEL = {};
function panelOpen(key) {
  if (S.panelKey === key && $('#gpanel')) return;
  S.panelKey = key;
  const wrap = $('#view .libwrap');
  if (wrap && wrap.classList.contains('pw')) { const old = $('#gpanel'); if (old) old.outerHTML = gpanelHtml(key); gpanelFill(key); nowbarFill(); return; }
  renderLibrary();
}
function panelClose() { S.panelKey = ''; S.nowKey = ''; document.querySelectorAll('#view .card.sel').forEach(c => c.classList.remove('sel')); renderLibrary(); }
function gpanelHtml(key) {
  const g = S.byKey[key]; if (!g) return '';
  const live = S.sessions && S.sessions[key], sys = g.system && g.system !== 'pc' ? (S.systems[g.system] || g.system) : 'PC';
  const tags = [g.missing ? '<span class="tag warn">Não encontrado</span>' : g.installed ? '<span class="tag ok">Instalado</span>' : '', `<span class="tag">${esc(sys)}</span>`, g.genres && g.genres[0] ? `<span class="tag">${esc(g.genres[0])}</span>` : '', g.year ? `<span class="tag">${esc(g.year)}</span>` : ''].join('');
  return `<aside class="gpanel" id="gpanel" data-key="${esc(key)}" data-ctx="game">
    <div class="gband" id="gband"><button class="gclose" onclick="panelClose()" title="Fechar">${I.x}</button></div>
    <div class="ghead"><div class="gcov" onclick="openGame(${jsq(key)})"><img src="/thumb/${enc(key)}?v=${g.cv || 0}" alt="" onload="gbandColor(this)" onerror="this.remove()"><div class="ph">${esc(g.title)}</div></div>
      <div class="gti"><h1 onclick="openGame(${jsq(key)})" title="Abrir detalhes">${esc(g.title)}</h1><div class="gtags">${tags}</div></div></div>
    <div class="gacts"><button class="btn p" onclick="play(${jsq(key)})">${live ? I.x + ' Encerrar' : playLbl(key)}</button><button class="btn s ic ${g.fav ? 'on' : ''}" title="Favorito" onclick="toggleFav(${jsq(key)});this.classList.toggle('on')">${I.star}</button><button class="btn s ic" title="Detalhes" onclick="openGame(${jsq(key)})">${I.info}</button><button class="btn s ic" title="Mais" onclick="ctxMenu(${jsq(key)}, this.getBoundingClientRect().left, this.getBoundingClientRect().bottom + 6)">${I.dots || '⋯'}</button></div>
    <div class="gkpi"><div><small>Tempo</small><b>${g.playtime >= 60 ? fmtTime(g.playtime) : '—'}</b></div><div><small>Última vez</small><b>${g.last_played ? cap(ago(g.last_played)) : 'Nunca'}</b></div><div><small>Sessões</small><b>${g.play_count || '—'}</b></div></div>
    <div class="gkv" id="gkv">${[['Desenvolvedora', g.creator], ['Lançamento', g.year], ['Tamanho', g.size ? fmt(g.size) : ''], ['Origem', originOf(g)]].filter(x => x[1]).map(([k, v]) => `<div><span>${k}</span><b title="${esc(v)}">${esc(v)}</b></div>`).join('')}</div>
    <div id="gpx"></div>
    <div class="glinks"><button onclick="openPath(${jsq(g.dir || '')},${jsq(key)})" title="Abrir pasta do jogo">${I.folder}<span>Pasta</span></button><button onclick="savesPanel(${jsq(key)})">${I.save}<span>Saves</span></button><button onclick="openGame(${jsq(key)});setTimeout(()=>{const m=$('#dMods');if(m)m.scrollIntoView({behavior:'smooth'})},400)">${I.wrench}<span>Mods</span></button><button onclick="setCover(${jsq(key)})">${I.image}<span>Capa</span></button><button onclick="editGame(${jsq(key)})">${I.edit}<span>Editar</span></button></div>
  </aside>`;
}
const BAND = {};
function dbandColor(img) {
  const key = S.det && S.det.key, hero = $('#dHero'); if (!key || !hero) return;
  if (BAND[key] === undefined) { try { BAND[key] = dominantColor(img) || ''; } catch (_) { BAND[key] = ''; } }
  if (BAND[key]) hero.style.setProperty('--dband', bandMix(BAND[key], 55, 'bg2'));
}
function gbandColor(img) {
  const key = img.closest('.gpanel').dataset.key, band = $('#gband'); if (!band) return;
  if (BAND[key] === undefined) { try { BAND[key] = dominantColor(img) || ''; } catch (_) { BAND[key] = ''; } }
  if (BAND[key]) band.style.background = bandMix(BAND[key], 55, 'bg2');
}
async function gpanelFill(key) {
  let d = PANEL[key];
  if (!d) { d = await api.get('/api/game/' + enc(key)); if (!d || d.error) return; PANEL[key] = d; if (!d.meta && S.config.auto_metadata && d.kind !== 'emulator') fetchMeta(key, false, true); }
  if (S.panelKey !== key) return; const box = $('#gpx'), kv = $('#gkv'); if (!box) return; const m = d.meta || {}, v = (S.byKey[key] || {}).cv || 0;
  if (kv && !kv.dataset.full) {
    kv.dataset.full = '1';
    const extra = [['Executável', d.exe && !isUri(d.exe) ? d.exe.split(/[\\/]/).pop() : ''], ['Pasta', d.dir]].filter(x => x[1]);
    kv.insertAdjacentHTML('beforeend', extra.map(([k, v]) => `<div><span>${k}</span><b title="${esc(v)}">${esc(v)}</b></div>`).join(''));
  }
  const shots = (m.shots ? m.shots.map((_, i) => `/shot/${enc(key)}/${i}?v=${v}`) : (d.screenshots || [])).slice(0, 3);
  const genres = [...new Set([...((m.genres && m.genres.length ? m.genres : d.genres) || []), ...((S.byKey[key] || {}).cats || []).map(id => (S.cats.find(c => c.id === id) || {}).name).filter(Boolean)])];
  const desc = short(m.summary || d.summary || d.description || '', 300);
  box.innerHTML = `${desc ? `<div class="pst"><h4>Sobre</h4><p>${esc(desc)}</p></div>` : ''}${genres.length ? `<div class="pst"><h4>Gêneros</h4><div class="gtags">${genres.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div></div>` : ''}${shots.length ? `<div class="pst"><h4>Capturas</h4><div class="gshots">${shots.map(u => `<img src="${esc(u)}" alt="" loading="lazy" onclick="lightbox(${jsq(u)})" onerror="this.remove()">`).join('')}</div></div>` : ''}`;
}
const cap = t => t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
function azBar(list) {
  if (!muralMode() || groupBy() || S.sort !== 'az' || S.sortRev || S.config.fav_first || list.length < 30) return '';
  const have = new Set(list.map(g => { const ch = (g.title || '?').trim().charAt(0).toUpperCase(); return /[A-Z]/.test(ch) ? ch : '#'; }));
  return `<div class="azbar">${['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(l => `<span class="${have.has(l) ? '' : 'off'}" onclick="azGo(${jsq(l)})">${l}</span>`).join('')}</div>`;
}
function azGo(l) {
  const list = visible(), i = list.findIndex(g => { const ch = (g.title || '?').trim().charAt(0).toUpperCase(); return l === '#' ? !/[A-Z]/.test(ch) : ch === l; });
  if (i < 0) return;
  let c = document.querySelector(`#grid .card[data-key="${CSS.escape(list[i].key)}"]`);
  if (!c) { while (!c && typeof gridMore === 'function' && gridMore()) c = document.querySelector(`#grid .card[data-key="${CSS.escape(list[i].key)}"]`); }
  if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'start' }); c.classList.add('sel'); setTimeout(() => c.classList.remove('sel'), 1200); }
}
let bdLayer = 0;
const ACC_CACHE = {};
function gameFocus(key) {
  S._focusKey = key || '';
  const hz = S.view === 'home' && stageOn() && !filtersActive() && !S.q;
  const bd = $('#backdrop'), mode = hz ? 'hero' : (S.config.game_backdrop || '');
  if (bd) {
    bd.classList.toggle('hz', hz);
    if (!key || !mode || S.view !== 'home') { bd.classList.remove('on'); if (S.config.cover_slideshow && S.view === 'home') slideshowStart(); else slideshowStop(); }
    else {
      slideshowStop();
      bd.style.setProperty('--bdblur', hz ? '0px' : (S.config.backdrop_blur ?? 10) + 'px'); bd.style.setProperty('--bddim', hz ? '0' : String((S.config.backdrop_dim ?? 42) / 100));
      const url = (mode === 'hero' ? '/hero/' : '/cover/') + enc(key) + '?v=' + ((S.byKey[key] || {}).cv || 0);
      const img = new Image();
      img.onload = () => { if (S._focusKey !== key) return; const ls = bd.querySelectorAll('.bl'); bdLayer ^= 1; ls[bdLayer].style.backgroundImage = `url("${url}")`; ls[bdLayer].classList.add('on'); ls[bdLayer ^ 1].classList.remove('on'); bd.classList.add('on'); };
      img.src = url;
    }
  }
  dynAccent(key && S.config.accent_from_cover && S.view === 'home' ? key : null);
}
async function setAccentMode(v) {
  if (v === 'system' && !S.sysAccent) { const r = await api.post('/api/window', { cmd: 'sys_accent' }); S.sysAccent = (r && r.hex) || ''; if (!S.sysAccent) { toast('warn', 'Sem cor do sistema', 'Não consegui ler a cor de destaque do Windows.'); return; } }
  const patch = { accent_mode: v }; if (v === 'custom' && !S.config.accent) patch.accent = cssVar('--accent') || '#4f8df7';
  await setCfg(patch); applyAccent(); renderSettings(true);
}
function dynAccent(key) {
  if (!key) { if (S.dynAccent) { S.dynAccent = ''; applyAccent(); } return; }
  const done = hex => { if (S._focusKey !== key) return; if ((hex || '') !== (S.dynAccent || '')) { S.dynAccent = hex || ''; applyAccent(); } };
  if (ACC_CACHE[key] !== undefined) return done(ACC_CACHE[key]);
  const img = new Image(); img.src = `/thumb/${enc(key)}?v=${(S.byKey[key] || {}).cv || 0}`;
  img.onload = () => { ACC_CACHE[key] = dominantColor(img); done(ACC_CACHE[key]); };
  img.onerror = () => { ACC_CACHE[key] = ''; done(''); };
}
function dominantColor(img) {
  try {
    const W = 40, H = 40, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data, bins = {};
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0, v = mx / 255;
      if (sat < .28 || v < .18 || v > .98) continue;
      const k = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5), bn = bins[k] || (bins[k] = { n: 0, r: 0, g: 0, b: 0 }), w = sat * (.4 + v * .6);
      bn.n += w; bn.r += r * w; bn.g += g * w; bn.b += b * w;
    }
    let best = null; for (const k in bins) if (!best || bins[k].n > best.n) best = bins[k];
    if (!best || best.n < 4) return '';
    let c = [best.r / best.n, best.g / best.n, best.b / best.n];
    for (let i = 0; i < 12 && luma(c) < .12; i++) c = c.map(x => x + (255 - x) * .15);
    for (let i = 0; i < 12 && luma(c) > .7; i++) c = c.map(x => x * .85);
    return '#' + c.map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
  } catch (e) { return ''; }
}
function applyPlaying() {
  const on = !!S.config.nav_hide_playing && Object.keys(S.sessions || {}).length > 0;
  document.body.classList.toggle('playing', on); if (!on) document.body.classList.remove('peek');
}
document.addEventListener('mousemove', e => {
  if (!document.body.classList.contains('playing')) return;
  const lay = themeLay(), W = window.innerWidth, H = window.innerHeight; let near, far;
  if (lay === 'top') { near = e.clientY < 12; far = e.clientY > 90; } else if (lay !== 'bottom') { near = e.clientX < 12; far = e.clientX > 140; } else { near = e.clientY > H - 12; far = e.clientY < H - 110; }
  if (near) document.body.classList.add('peek'); else if (far) document.body.classList.remove('peek');
  void W;
});
let ssT = 0, ssIdx = 0;
function slideshowStop() { clearTimeout(ssT); ssT = 0; }
function slideshowStart() {
  slideshowStop();
  if (!S.config.cover_slideshow || S.view !== 'home') return;
  const list = (S.games || []).filter(g => g.installed && !TH.err.has(g.key)); if (!list.length) return;
  const bd = $('#backdrop'); if (!bd) return;
  const show = () => {
    if (!S.config.cover_slideshow || S.view !== 'home' || (S._focusKey && S.config.game_backdrop)) { slideshowStop(); return; }
    if (!document.hidden && document.hasFocus()) {
      const g = list[ssIdx++ % list.length], url = `/cover/${enc(g.key)}?v=${g.cv || 0}`, img = new Image();
      img.onload = () => { if ((S._focusKey && S.config.game_backdrop) || S.view !== 'home') return; bd.style.setProperty('--bdblur', (S.config.backdrop_blur ?? 10) + 'px'); bd.style.setProperty('--bddim', String((S.config.backdrop_dim ?? 42) / 100)); const ls = bd.querySelectorAll('.bl'); bdLayer ^= 1; ls[bdLayer].style.backgroundImage = `url("${url}")`; ls[bdLayer].classList.add('on'); ls[bdLayer ^ 1].classList.remove('on'); bd.classList.add('on'); };
      img.src = url;
    }
    ssT = setTimeout(show, Math.max(10, +S.config.cover_slideshow_secs || 45) * 1000);
  };
  ssIdx = Math.floor(Math.random() * list.length); show();
}
function setViewMode(v) { S.config.view_mode = v; api.post('/api/config', { view_mode: v }); renderLibrary(); }
function lastPlayedText(ts) { if (!ts) return ''; const d = (Date.now() / 1000 - ts) / 86400; return d < 1 ? 'hoje' : d < 2 ? 'ontem' : d < 30 ? `há ${pl(Math.floor(d), 'dia', 'dias')}` : d < 365 ? `há ${Math.floor(d / 30)} meses` : `há ${Math.floor(d / 365)} anos`; }
$('#view').addEventListener('dblclick', e => { const c = e.target.closest('.card'); if (c && !e.target.closest('[data-qp],[data-dl],[data-fav]')) openGame(c.dataset.key); });
function storeGet(key) { openGame(key); }
$('#view').addEventListener('click', e => {
  const fv = e.target.closest('[data-fav]'); if (fv) { e.stopPropagation(); toggleFav(fv.dataset.fav); return; }
  const qp = e.target.closest('[data-qp]'); if (qp) { e.stopPropagation(); if (qp.classList.contains('live')) stopGame(qp.dataset.qp); else play(qp.dataset.qp); return; }
  const dq = e.target.closest('[data-dl]'); if (dq) { e.stopPropagation(); storeGet(dq.dataset.dl); return; }
  const c = e.target.closest('.card'); if (c) { if (S.view === 'home' && (e.ctrlKey || e.metaKey || e.shiftKey || S.sel.size)) { msToggle(c.dataset.key, e.shiftKey); return; } if (S.view === 'home') selectGame(c.dataset.key); else openGame(c.dataset.key); return; }
  const hero = e.target.closest('#hero'); if (hero) { const g = S.hero[S.heroIdx]; if (!g) return; if (e.target.closest('#heroBtn') && g.installed) play(g.key); else openGame(g.key); }
});
function msToggle(key, range) {
  if (!/^(local|rom):/.test(key)) return;
  if (range && S._msLast) { const ks = [...document.querySelectorAll('#view .card')].map(c => c.dataset.key); const a = ks.indexOf(S._msLast), b = ks.indexOf(key); if (a >= 0 && b >= 0) for (const k of ks.slice(Math.min(a, b), Math.max(a, b) + 1)) if (/^(local|rom):/.test(k)) S.sel.add(k); }
  else if (S.sel.has(key)) S.sel.delete(key); else S.sel.add(key);
  S._msLast = key;
  document.querySelectorAll('#view .card').forEach(c => c.classList.toggle('msel', S.sel.has(c.dataset.key)));
  msBar();
}
function msAll() { for (const c of document.querySelectorAll('#view .card')) if (/^(local|rom):/.test(c.dataset.key)) S.sel.add(c.dataset.key); document.querySelectorAll('#view .card').forEach(c => c.classList.toggle('msel', S.sel.has(c.dataset.key))); msBar(); }
function msClear() { S.sel.clear(); S._msLast = ''; document.querySelectorAll('.card.msel').forEach(c => c.classList.remove('msel')); msBar(); }
function msBar() {
  let b = $('#msbar'); if (!S.sel.size) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.id = 'msbar'; b.className = 'msbar'; document.body.appendChild(b); }
  const n = S.sel.size;
  const tot = [...S.sel].reduce((a, k) => a + ((S.byKey[k] || {}).playtime || 0), 0);
  b.innerHTML = `<b>${pl(n, 'jogo selecionado', 'jogos selecionados')}${tot >= 60 ? ` <small class="mut">· ${fmtTime(tot)}</small>` : ''}</b><span class="sp"></span>
    <button class="btn s sm" onclick="msFav()">${I.star} Favoritar</button>
    <button class="btn s sm" onclick="msMeta()">${I.spark} Metadados</button>
    <button class="btn s sm" onclick="msPlayed()">${I.check} Marcar como jogado</button>
    <button class="btn s sm" onclick="exportLibrary('csv', [...S.sel])" title="Planilha só com os selecionados">${I.doc} Exportar CSV</button>
    <button class="btn d sm" onclick="removeMany([...S.sel])">${I.trash} Remover da biblioteca</button>
    <button class="btn s sm" onclick="msClear()">${I.x} Limpar</button>`;
}
async function msFav() { const keys = [...S.sel]; const want = keys.some(k => !(S.byKey[k] || {}).fav); for (const k of keys) { const g = S.byKey[k]; if (g && !!g.fav !== want) await toggleFav(k); } toast('ok', want ? 'Adicionados aos favoritos' : 'Removidos dos favoritos', pl(keys.length, 'jogo', 'jogos')); }
async function msPlayed() { const keys = [...S.sel].filter(k => /^(local|rom):/.test(k)); let n = 0; for (const k of keys) { const r = await api.post('/api/game/played', { key: k, played: true }); if (!r.error) n++; } msClear(); toast('ok', 'Marcados como jogados', pl(n, 'jogo', 'jogos')); loadCatalog(false); }
async function msMeta() { const keys = [...S.sel]; msClear(); toast('', 'Atualizando metadados…', pl(keys.length, 'jogo', 'jogos')); let n = 0; for (const k of keys) { const m = await api.post('/api/metadata', { key: k, force: true }); if (!m.error) n++; } toast('ok', 'Metadados atualizados', `${n} de ${keys.length}`); loadCatalog(false); }
const QFAB_C = 2 * Math.PI * 19;
function qfabSync() {
  const el = $('#qfab'); if (!el) return;
  const jobs = Object.entries(S.jobs || {}).filter(([k]) => k !== 'update');
  const show = jobs.length > 0 && S.view !== 'downloads';
  el.classList.toggle('on', show);
  if (!show) return;
  const fr = jobs.map(([, j]) => j.fraction).filter(f => typeof f === 'number' && f >= 0);
  const f = fr.length ? fr.reduce((a, b) => a + b, 0) / fr.length : -1;
  el.classList.toggle('ind', f < 0);
  const v = el.querySelector('.qr .v'); if (v) { v.style.strokeDasharray = QFAB_C; v.style.strokeDashoffset = f < 0 ? QFAB_C * .75 : QFAB_C * (1 - f); }
  const n = el.querySelector('.qn'); if (n) n.textContent = jobs.length > 1 ? String(jobs.length) : '';
  el.title = `${jobs.length === 1 ? '1 em andamento' : jobs.length + ' em andamento'}${f >= 0 ? ' · ' + Math.round(f * 100) + '%' : ''} — abrir Fila`;
}
function ringSvg(f) { const r = 24, c = 2 * Math.PI * r, off = f < 0 ? c * .75 : c * (1 - f); return `<div class="ring"><svg viewBox="0 0 56 56"><circle class="t" cx="28" cy="28" r="${r}"/><circle class="v" cx="28" cy="28" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${off}"/></svg><span>${f < 0 ? '…' : Math.round(f * 100) + '%'}</span></div>`; }
const clock = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
function storeSub(g) {
  const kind = g.torrent && g.direct ? 'Torrent e direto' : g.torrent ? 'Torrent' : g.direct ? 'Direto' : '';
  const l1 = g.size ? fmt(g.size) : kind;
  const l2 = (g.genres && g.genres[0]) || (g.kind === 'rom' && g.system ? (S.systems[g.system] || g.system) : '') || (g.creator || g.fr || '') || (g.year ? String(g.year) : '');
  return `${l1 ? `<div class="sub ci" title="${esc(kind)}"><span>${g.torrent ? I.magnet : ''}${g.direct ? I.dl : ''}${esc(l1)}</span></div>` : ''}${l2 ? `<div class="sub ci"><span>${I.tag}${esc(l2)}</span></div>` : ''}`;
}
function cardSub(g) {
  if (S.view === 'store' && g.repo !== 'local') return storeSub(g);
  if (S.config.card_playtime === false) { const a = g.genres && g.genres[0] ? g.genres[0] : g.kind === 'rom' && g.system ? (S.systems[g.system] || g.system) : (g.creator || g.fr || ''); return a ? `<div class="sub"><span class="g">${esc(a)}</span></div>` : ''; }
  const t = g.playtime >= 60 ? fmtTime(g.playtime) : 'Não jogado';
  const l2 = g.last_played ? cap(lastPlayedText(g.last_played)) : (g.genres && g.genres[0]) || (g.kind === 'rom' && g.system ? (S.systems[g.system] || g.system) : '') || (g.year ? String(g.year) : '');
  return `<div class="sub ci"><span>${clock}${esc(t)}</span></div>${l2 ? `<div class="sub ci"><span>${g.last_played ? I.flag : I.tag}${esc(l2)}</span></div>` : ''}`;
}
function ptHtml(sec) { if (!sec || sec < 60) return ''; const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60); return `<span class="pt">${clock}${h ? h + ' h' : m + ' min'}</span>`; }
const TH = { ok: new Set(), err: new Set(), tries: {} };
function thumbFail(img, key) {
  const n = TH.tries[key] = (TH.tries[key] || 0) + 1;
  if (n <= 2 && S.config.auto_metadata !== false) { img.classList.remove('err'); setTimeout(() => { if (document.contains(img)) img.src = `/thumb/${enc(key)}?v=${(S.byKey[key] || {}).cv || 0}&r=${n}`; }, 2500 * n); return; }
  img.classList.add('err'); TH.err.add(key);
  const ph = img.parentElement && img.parentElement.querySelector('.ph');
  if (ph && !ph.querySelector('.noimg')) ph.insertAdjacentHTML('beforeend', '<em class="noimg">Game sem Imagem!</em>');
}
function cardHtml(g, i) {
  const job = S.jobs[g.key]; const live = S.sessions && S.sessions[g.key];
  const sys = g.system && g.system !== 'pc' ? `<span class="badge sys">${esc((S.systems[g.system] || g.system).toUpperCase().slice(0, 8))}</span>` : '';
  const dim = S.view === 'store' && !g.installed && !g.owned && !job && S.config.dim_not_installed !== false && !/^(rom|local):/.test(g.key) ? ' dim' : '';
  const lst = listMode() && ['home', 'store'].includes(S.view);
  const now = Date.now() / 1000, rib = S.config.card_ribbons !== false && (g.installed || g.owned || g.fresh) && !live && !g.mc_nolauncher ? (g.owned ? '<span class="rib today">NO PC</span>' : g.fresh && !g.installed ? (S.view === 'store' ? '<span class="rib new" title="Apareceu na fonte recentemente">NOVO</span>' : '') : g.update_version ? `<span class="rib upd" title="Versão ${esc(g.update_version)} disponível na fonte (instalada: ${esc(g.version || '?')})">ATUALIZAÇÃO</span>` : g.last_played && new Date(g.last_played * 1000).toDateString() === new Date().toDateString() ? '<span class="rib today">HOJE</span>' : g.added_at && now - g.added_at < 7 * 86400 && !g.playtime ? `<span class="rib new" title="Adicionado ${daysAgo(g.added_at)} e ainda não aberto">NOVO</span>` : '') : '';
  const ptb = '';
  const prog = job ? `<div class="cprog${job.fraction < 0 ? ' ind' : ''}"><i style="width:${job.fraction >= 0 ? Math.round(job.fraction * 100) : 40}%"></i></div>` : '';
  const favB = `<button class="fav ${g.fav ? 'on' : ''}" data-fav="${esc(g.key)}" title="Favorito">${I.star}</button>`;
  const orig = S.view === 'home' && S.config.card_origin ? originOf(g) : '';
  const srcB = S.view === 'store' && S._multiSrc && g.repo && g.repo !== 'local' ? `<span class="src" title="Fonte: ${esc(repoName(g.repo))}">${esc(repoName(g.repo))}</span>` : orig ? `<span class="src" title="Origem: ${esc(orig)}">${esc(orig)}</span>` : '';
  const qpB = (g.installed || g.owned) && !job ? `<button class="qp ${live ? 'live' : ''}" data-qp="${esc(g.owned || g.key)}" title="${live ? 'Em execução — clique para encerrar' : 'Jogar'}">${live ? I.x : I.play}</button>` : !g.installed && g.avail && !job ? `<button class="qp dl" data-dl="${esc(g.avail)}" title="Não está no PC — baixar pela Loja">${I.dl}</button>` : '';
  if (lst) return `<div class="card${dim}${S.sel.has(g.key) ? ' msel' : ''}" data-key="${esc(g.key)}">
    <div class="cov"><div class="ph">${esc(g.title)}</div><img loading="lazy" decoding="async" class="${TH.ok.has(g.key) ? 'ld inst' : TH.err.has(g.key) ? 'err' : ''}" src="/thumb/${enc(g.key)}?v=${g.cv || 0}" alt="" onload="this.classList.add('ld');TH.ok.add(${jsq(g.key)})" onerror="thumbFail(this,${jsq(g.key)})">${job ? ringSvg(job.fraction) : ''}</div>
    <h4>${esc(g.title)}${live ? '<span class="live">JOGANDO</span>' : ''}${g.mc_nolauncher ? '<span class="badge warn" title="Falta um launcher de Minecraft — clique em Jogar para escolher um">SEM LAUNCHER</span>' : g.repo === 'local' && !g.installed && !job ? '<span class="badge warn" title="O executável ou a ROM não está mais no lugar — clique em Jogar para apontar o novo caminho">NÃO ENCONTRADO</span>' : g.installed && S.view !== 'home' ? '<span class="badge ok">INSTALADO</span>' : g.link_dead ? '<span class="badge warn" title="O link direto não respondeu no último teste da fonte">LINK FORA DO AR</span>' : ''}${sys}${srcB}</h4>
    <div class="lm">${listCols().map(id => `<span class="c-${id}" title="${(LIST_COLS.find(x => x[0] === id) || [])[1] || ''}">${listCell(g, id)}</span>`).join('')}</div>
    <div class="la">${favB}${qpB}</div></div>`;
  return `<div class="card${dim}${S.sel.has(g.key) ? ' msel' : ''}${S.panelKey === g.key && S.view === 'home' ? ' sel' : ''}" data-key="${esc(g.key)}" style="animation-delay:${Math.min(i, 24) * 8}ms">
    <div class="cov" data-t="${esc(g.title)}"><div class="ph">${esc(g.title)}${g.kind === 'rom' && g.key.startsWith('rom:') ? '<small>ROM LOCAL</small>' : g.kind === 'rom' ? '<small>ROM · BAIXAR</small>' : ''}</div>
      <img loading="lazy" decoding="async" class="${TH.ok.has(g.key) ? 'ld inst' : TH.err.has(g.key) ? 'err' : ''}" src="/thumb/${enc(g.key)}?v=${g.cv || 0}" alt="" onload="this.classList.add('ld');TH.ok.add(${jsq(g.key)})" onerror="thumbFail(this,${jsq(g.key)})">
      <div class="sh"></div><div class="info"><span>${esc(g.year || '')}</span><span>${g.score ? '★' + g.score : fmt(g.size)}</span></div>
      ${live ? '<span class="live">JOGANDO</span>' : ''}${g.mc_nolauncher ? '<span class="badge warn" title="Falta um launcher de Minecraft — clique em Jogar para escolher um">SEM LAUNCHER</span>' : g.repo === 'local' && !g.installed && !job ? '<span class="badge warn" title="O executável ou a ROM não está mais no lugar — clique em Jogar para apontar o novo caminho">NÃO ENCONTRADO</span>' : g.installed && S.view !== 'home' ? '<span class="badge ok">INSTALADO</span>' : g.link_dead ? '<span class="badge warn" title="O link direto não respondeu no último teste da fonte">LINK FORA DO AR</span>' : g.kind === 'recomp' ? '<span class="badge rc">RECOMP</span>' : ''}${live || (g.repo === 'local' && !g.installed) ? '' : sys}
      ${favB}${rib}${ptb}
      ${qpB}
      ${job ? ringSvg(job.fraction) + prog : ''}</div>
    <h4 title="${esc([g.title, g.creator || g.fr, g.year, g.playtime >= 60 ? fmtTime(g.playtime) + ' jogados' : ''].filter(Boolean).join(' · '))}">${esc(g.title)}</h4>${cardSub(g)}${srcB ? `<div class="sub">${srcB}</div>` : ''}</div>`;
}
const FILTER_VIEWS = ['settings', 'central', 'emulation', 'mods', 'downloads', 'flash'];
const Q_PLACEHOLDER = { home: 'Buscar em tudo…  (/)', store: 'Buscar na Store…  (/)', settings: 'Buscar nos ajustes…  (/)', central: 'Buscar na Central…  (/)', emulation: 'Buscar emuladores e ROMs…  (/)', mods: 'Buscar em Mods…  (/)', downloads: 'Buscar na fila…  (/)', flash: 'Buscar jogos rápidos…  (/)' };
const Q_LEAF = '.frow, .tile, .theme, .iset, .hw, .item, .site, .mrow, .card, .src, .row, label.mchk1, .checks label, .sec > p, .gmapps > *';
const qnorm = t => (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
function qCount(root, q) {
  root.querySelectorAll('.qhide, .qhit').forEach(e => e.classList.remove('qhide', 'qhit'));
  const old = root.querySelector('.qnone'); if (old) old.remove();
  if (!q) return -1;
  let hits = 0; const has = el => qnorm(el.textContent).includes(q);
  const leaves = [...root.querySelectorAll(Q_LEAF)].filter(el => !el.parentElement.closest(Q_LEAF));
  for (const el of leaves) { if (has(el)) { el.classList.add('qhit'); hits++; } else el.classList.add('qhide'); }
  for (const g of root.querySelectorAll('.sec, .tiles, .gmapps')) {
    const inner = g.querySelector(':scope > h3, :scope > h4'), prev = g.previousElementSibling, gh = prev && prev.matches('.gh') ? prev : null, title = inner || gh;
    if (title && has(title)) { g.querySelectorAll('.qhide').forEach(e => e.classList.remove('qhide')); g.classList.add('qhit'); hits++; continue; }
    if (![...g.querySelectorAll(Q_LEAF)].some(e => !e.closest('.qhide'))) { g.classList.add('qhide'); if (gh) gh.classList.add('qhide'); }
  }
  return hits;
}
function viewFilter() {
  const v = $('#view'); const q = qnorm(S.q); const on = !!q && FILTER_VIEWS.includes(S.view) && !(S.view === 'emulation' && S.tab.emulation === 'roms');
  v.classList.toggle('qf', on);
  const hits = qCount(v, on ? q : '');
  if (on && hits === 0) { const d = document.createElement('div'); d.className = 'qnone'; d.innerHTML = `Nada com <b>${esc(S.q)}</b> nesta aba. <button class="btn s xs" onclick="clearSearch()">Limpar busca</button> <button class="btn s xs" onclick="setView('home')">Buscar nos jogos</button>`; v.appendChild(d); }
  qObs.takeRecords();
  return hits;
}
function clearSearch() { S.q = ''; const i = $('#q'); if (i) i.value = ''; if (FILTER_VIEWS.includes(S.view)) viewFilter(); else renderLibrary(); }
function searchInView() {
  if (S.view === 'settings') {
    const q = qnorm(S.q); const hits = viewFilter();
    if (q && hits > 0) { const h = $('#view .qhit'); if (h) { h.scrollIntoView({ block: 'center' }); h.classList.remove('flash'); void h.offsetWidth; h.classList.add('flash'); } }
    if (q && hits === 0 && S._settingsBody) {
      const cur = S.tab.settings || 'general';
      for (const [id] of (S._settingsTabs || [])) {
        if (id === cur || (id === 'custom' && !S.custom)) continue;
        const t = document.createElement('div'); t.innerHTML = `<div class="settings">${S._settingsBody(id)}</div>`;
        if (qCount(t, q) > 0) { S.tab.settings = id; renderSettings(); return; }
      }
    }
    return;
  }
  viewFilter();
}
function applyQPlaceholder() { const i = $('#q'); if (!i) return; const n = S.view === 'home' ? S.games.filter(g => g.installed).length : 0; i.title = n ? 'Prefixos: dev:, ano:, gen:, sis:, origem:, tag:' : ''; i.placeholder = n ? `Buscar em ${n} jogos…  (/)` : (Q_PLACEHOLDER[S.view] || Q_PLACEHOLDER.home); }
const qObs = new MutationObserver(() => { if (S.q && FILTER_VIEWS.includes(S.view) && !S._qfBusy) { S._qfBusy = true; requestAnimationFrame(() => { S._qfBusy = false; viewFilter(); }); } });
qObs.observe($('#view'), { childList: true, subtree: true });
function renderSortBtn() { }
function focusSearch() { const m = $('#qm'); if (m && m.offsetParent) { m.parentElement.classList.add('on'); m.focus(); return; } if (topSearchVisible()) { $('#q').focus(); return; } if (!['home', 'store'].includes(S.view)) { setView(S.repos.some(r => r.enabled) ? 'store' : 'home'); return setTimeout(focusSearch, 80); } $('#q').focus(); }
let qmt; function miniSearch(v) { S._siteQ = ''; clearTimeout(qmt); qmt = setTimeout(() => { S.q = v; S.page = 1; const i = $('#q'); if (i) i.value = v; renderLibrary(); const m = $('#qm'); if (m) { m.parentElement.classList.add('on'); m.focus(); m.setSelectionRange(v.length, v.length); } }, 160); }
$('#q').addEventListener('keydown', e => { if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.stopPropagation(); clearSearch(); } else if (e.key === 'Escape') e.target.blur(); });
let qt; $('#q').addEventListener('input', e => { S._siteQ = ''; clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value; S.page = 1; if (S.view === 'emulation' && S.tab.emulation === 'roms') renderEmulation(); else if (FILTER_VIEWS.includes(S.view)) searchInView(); else if (!['home', 'store'].includes(S.view)) setView(S.repos.some(r => r.enabled) ? 'store' : 'home'); else renderLibrary(); }, 120); });
async function openTerminal() {
  const r = await api.post('/api/window', { cmd: 'terminal' });
  if (r && r.ok) return;
  let f = $('#termOverlay');
  if (!f) { f = document.createElement('div'); f.id = 'termOverlay'; f.className = 'termov'; f.innerHTML = '<iframe src="/terminal" title="Terminal"></iframe>'; document.body.appendChild(f); }
  f.classList.add('on');
}
function closeTerminal() { const f = $('#termOverlay'); if (f) f.classList.remove('on'); }
window.addEventListener('message', e => { const d = e.data || {}; if (d.ludrix) applyTermUi(d.ludrix); if (d.ludrix && d.ludrix.close) closeTerminal(); });
async function applyTermUi(ui) {
  if (ui.config) { S.config = await api.get('/api/config'); applyTheme(); api.emit('config', {}); if (S.view === 'settings') renderSettings(); }
  if (ui.catalog) loadCatalog(false);
  if (ui.open_game) { const g = S.games.find(x => x.key === ui.open_game); if (g) openGame(g.key); }
  if (ui.view) { const v = ui.view; if (v === 'sources') { S.tab.store = 'sources'; setView('store'); } else if (v === 'themes' || v === 'appearance') { S.tab.settings = 'appearance'; setView('settings'); } else setView(v); }
}

const FS = { on: false };
function setFullscreen(on, hint) {
  if (on === FS.on) return; FS.on = on;
  document.body.classList.toggle('fs', on);
  if (S.config.native) api.post('/api/window', { cmd: 'fullscreen', on });
  else if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  fsHint(on ? (hint || 'Tela cheia · aperte F11 para sair') : (hint || ''));
}
function toggleFullscreen() { setFullscreen(!FS.on); }
let fsHintT; function fsHint(txt) {
  let el = $('#fshint'); if (!el) { el = document.createElement('div'); el.id = 'fshint'; el.className = 'fshint'; document.body.append(el); }
  clearTimeout(fsHintT); if (!txt) { el.classList.remove('on'); return; }
  el.innerHTML = txt.replace(/F11|Esc/g, m => `<kbd>${m}</kbd>`); el.classList.add('on'); fsHintT = setTimeout(() => el.classList.remove('on'), 4200);
}
document.addEventListener('fullscreenchange', () => { if (!S.config.native && !document.fullscreenElement && FS.on) { FS.on = false; document.body.classList.remove('fs'); } });
async function openConsole() {
  const r = await api.post('/api/console/swap', { to: 'console' });
  if (r.error) return toast('err', 'Modo Console', r.error);
  toast('ok', 'Abrindo o Modo Console', 'Esta janela vai fechar.');
}

const HERO_PICK = /pro evolution soccer 2008|need for speed: most wanted|fifa 07|colin mcrae rally 2005|simpsons hit and run|underground 2|halo: combat|midtown madness 2|tony hawk's underground 2|sleeping dogs|majora|sonic unleashed/i;
function setupHero() { const pool = S.games.filter(g => g.repo !== 'local' && !g.installed && !isRepoRom(g)); S.hero = pool.filter(g => HERO_PICK.test(g.title) && g.thumb_ok).slice(0, 8); if (S.hero.length < 3) S.hero = pool.filter(g => HERO_PICK.test(g.title)).slice(0, 8); if (!S.hero.length) S.hero = pool.filter(g => g.thumb_ok).slice(0, 6); if (!S.hero.length) S.hero = pool.slice(0, 6); clearInterval(S.heroT); S.heroT = setInterval(() => { if ($('#hero')) showHero((S.heroIdx + 1) % S.hero.length); }, 7000); renderView(); }
function heroHtml() { return `<div class="hero" id="hero"><div class="bg" id="heroBg"></div><div class="grad"></div><div class="dots" id="heroDots">${S.hero.map((_, i) => `<i class="${i === S.heroIdx ? 'on' : ''}"></i>`).join('')}</div><img class="cov" id="heroCov" alt="" onload="this.classList.add('ld')" onerror="this.classList.remove('ld')"><div class="txt"><span class="tag" id="heroTag">EM DESTAQUE</span><h1 id="heroTitle"></h1><div class="meta" id="heroMeta"></div><button class="btn p" id="heroBtn">Ver detalhes</button></div></div>`; }
function showHero(i) {
  const g = S.hero[i]; if (!g || !$('#hero')) return; S.heroIdx = i;
  $('#heroBg').style.backgroundImage = `url(/hero/${enc(g.key)})`; const hc = $('#heroCov'); hc.classList.remove('ld'); hc.src = `/cover/${enc(g.key)}?v=${g.cv || 0}`;
  $('#heroTitle').textContent = g.title;
  $('#heroMeta').innerHTML = [g.creator, g.year, fmt(g.size), g.genres?.[0]].filter(Boolean).map(esc).join(' · ') + (g.installed ? ' · <span style="color:var(--green2)">Instalado</span>' : '');
  $('#heroTag').textContent = g.installed ? 'NA SUA BIBLIOTECA' : g.kind === 'recomp' ? 'RECOMPILADO' : 'EM DESTAQUE';
  $('#heroBtn').innerHTML = g.installed ? I.play + ' Jogar' : 'Ver detalhes'; $('#heroBtn').className = g.installed ? 'btn g' : 'btn p';
  [...$('#heroDots').children].forEach((d, k) => d.classList.toggle('on', k === i));
  const t = $('#hero .txt'); t.style.animation = 'none'; t.offsetHeight; t.style.animation = '';
}

const BLANK_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
function dph(img) {
  const d = document.createElement('div'); d.className = 'dph'; d.textContent = img.alt || '?'; img.replaceWith(d);
}
function setHero(key, url) {
  const det = $('#detail'); det.classList.remove('nohero'); $('#dBg').style.backgroundImage = `url(${url})`;
  const im = new Image(); im.onerror = () => { if (S.current === key) det.classList.add('nohero'); }; im.src = url;
}
function vtRun(fn, tag) {
  const off = document.documentElement.dataset.anim === 'off' || !document.startViewTransition;
  if (off) { fn(); return Promise.resolve(); }
  document.documentElement.dataset.vt = tag || '';
  let t; try { t = document.startViewTransition(fn); } catch (_) { fn(); return Promise.resolve(); }
  return t.finished.catch(() => undefined).finally(() => { delete document.documentElement.dataset.vt; });
}
function cardImg(key) { return document.querySelector(`.card[data-key="${CSS.escape(key)}"] img, .srow[data-key="${CSS.escape(key)}"] img`); }
async function openGame(key) {
  uiSound('open');
  S.current = key; S.dtab = 'about'; const g = S.byKey[key] || { title: '...' };
  if (S.config.accent_from_cover) { S._focusKey = key; dynAccent(key); }
  setHero(key, `/hero/${enc(key)}`);
  const src = cardImg(key); if (src) src.style.viewTransitionName = 'gcov';
  await vtRun(() => {
    if (src) src.style.viewTransitionName = '';
    $('#dWrap').innerHTML = `<div class="dcov"><img src="/cover/${enc(key)}" alt="${esc((g.title || '?').trim().charAt(0).toUpperCase())}" onerror="dph(this)"></div><div class="dmain"><h1>${esc(g.title)}</h1><div class="meta"><span class="pill">carregando…</span></div></div>`;
    $('#detail').classList.add('on'); $('#detail').scrollTop = 0;
  }, 'open');
  if (S.current !== key) return;
  const d = await api.get('/api/game/' + enc(key));
  if (S.current !== key) return;
  if (d.error) { toast('err', 'Não foi possível concluir', d.error); return; }
  S.det = d; renderDetail(); guide('detail');
  if (!d.meta && S.config.auto_metadata && d.kind !== 'emulator') fetchMeta(key, false, true);
}
function closeDetail() { if (!S.current) return closeDetailNow(); uiSound('back'); const was = S.current; const src = cardImg(was); vtRun(() => { closeDetailNow(); if (src) src.style.viewTransitionName = 'gcov'; }, 'close').then(() => { if (src) src.style.viewTransitionName = ''; }); }
function closeDetailNow() { const was = S.current; S.current = null; $('#detail').classList.remove('on'); $('#detail').classList.remove('bar'); if (S._dObs) { S._dObs.disconnect(); S._dObs = null; } if (was && S.config.accent_from_cover) { if (S.view === 'home' && S.stageKey) gameFocus(S.stageKey); else { S._focusKey = ''; dynAccent(null); } } }
$('#dClose').onclick = closeDetail;
function lightbox(u) { const l = document.createElement('div'); l.className = 'lightbox'; l.innerHTML = `<img src="${esc(u)}"><button class="dclose">${I.x}</button>`; l.onclick = () => l.remove(); document.body.appendChild(l); }
async function fetchMeta(key, force, silent) {
  const b = $('#metaBtn'); if (b) { b.disabled = true; b.innerHTML = I.spark + ' Buscando…'; }
  const m = await api.post('/api/metadata', { key, force });
  if (S.current !== key) return;
  if (m.error) { if (!silent) toast('err', 'Metadados', m.error); }
  else {
    S.det.meta = m; const g = S.byKey[key]; if (g) { g.genres = m.genres || g.genres; g.year = m.year || g.year; g.creator = m.developer || g.creator; g.has_meta = true; }
    renderDetail(); if (!silent) toast('ok', 'Metadados atualizados', [].concat(m.source || []).join(' + ') || 'nada encontrado');
  }
}
function pl(n, one, many) { return `${n} ${n === 1 ? one : many}`; }
const ART = (() => {
  const w = (body) => `<svg viewBox="0 0 160 96" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const A = 'class="a"', F = 'class="f"', D = 'class="d"';
  return {
    library: w(`<path ${D} d="M22 78h116"/><rect ${F} x="30" y="30" width="16" height="48" rx="2"/><rect ${F} x="50" y="22" width="14" height="56" rx="2"/><rect ${A} x="68" y="36" width="18" height="42" rx="2"/><path d="M92 78l10-44 16 4-10 40z"/><path ${D} d="M36 40v26M56 32v8M76 46v4"/><circle ${A} cx="128" cy="30" r="9"/><path ${A} d="M128 25v10M123 30h10"/>`),
    store: w(`<path ${D} d="M20 80h120"/><path ${F} d="M34 40h92l-6 40H40z"/><path d="M34 40l6-14h80l6 14"/><path ${D} d="M60 26v14M100 26v14M80 26v14"/><path ${A} d="M64 58q16-16 32 0"/><circle ${A} cx="64" cy="58" r="2.5"/><circle ${A} cx="96" cy="58" r="2.5"/>`),
    roms: w(`<path ${D} d="M24 82h112"/><rect ${F} x="52" y="18" width="56" height="62" rx="6"/><rect ${A} x="62" y="28" width="36" height="22" rx="3"/><path d="M52 62h56"/><path ${D} d="M66 70h6M74 70h6M82 70h6"/><path d="M40 44q-10 10 0 20M120 44q10 10 0 20"/>`),
    downloads: w(`<path ${D} d="M24 82h112"/><path ${F} d="M40 56v18a4 4 0 004 4h72a4 4 0 004-4V56"/><path ${A} d="M80 16v38M66 42l14 14 14-14"/><path ${D} d="M60 70h40"/>`),
    tools: w(`<path ${D} d="M24 82h112"/><path ${F} d="M48 74l34-34-6-6-34 34a4 4 0 006 6z"/><path d="M80 32a14 14 0 0118-18l-8 8 2 8 8 2 8-8a14 14 0 01-18 18"/><path ${A} d="M106 54l14 14M120 54l-14 14"/><circle ${D} cx="46" cy="71" r="1.5"/>`),
    mods: w(`<path ${D} d="M24 82h112"/><path ${F} d="M50 36h22v-6a8 8 0 0116 0v6h22v22h-6a8 8 0 000 16h6v22H88v-6a8 8 0 00-16 0v6H50V74h6a8 8 0 000-16h-6z" transform="translate(0 -8) scale(.92) translate(7 8)"/><path ${A} d="M118 20l4 8 8 4-8 4-4 8-4-8-8-4 8-4z"/>`),
    flash: w(`<path ${D} d="M24 82h112"/><path ${F} d="M86 14L54 56h22l-6 28 34-44H82z"/><path ${A} d="M116 30l-6 2M118 42l-6-1M40 30l6 2M38 42l6-1"/>`),
    search: w(`<path ${D} d="M24 82h112"/><rect ${F} x="36" y="34" width="20" height="28" rx="2"/><rect ${F} x="62" y="34" width="20" height="28" rx="2"/><rect ${D} x="88" y="34" width="20" height="28" rx="2" stroke-dasharray="3 3"/><circle ${A} cx="102" cy="48" r="17" fill="var(--bg,#0000)" fill-opacity=".85"/><path ${A} d="M114 60l14 14"/><path ${D} d="M96 48h12"/>`),
    stars: w(`<path ${D} d="M24 82h112"/><rect ${F} x="40" y="34" width="20" height="28" rx="2"/><rect ${F} x="66" y="34" width="20" height="28" rx="2"/><rect ${F} x="92" y="34" width="20" height="28" rx="2"/><path ${A} d="M102 18l3.2 6.6 7.2 1-5.2 5.1 1.2 7.2-6.4-3.4-6.4 3.4 1.2-7.2-5.2-5.1 7.2-1z"/>`),
    sources: w(`<path ${D} d="M24 82h112"/><path ${F} d="M58 26h44a4 4 0 014 4v44a4 4 0 01-4 4H58a4 4 0 01-4-4V30a4 4 0 014-4z"/><path d="M66 42h28M66 52h28M66 62h16"/><circle ${A} cx="112" cy="68" r="10"/><path ${A} d="M112 63v10M107 68h10"/>`),
    done: w(`<path ${D} d="M24 82h112"/><circle ${F} cx="80" cy="46" r="26"/><path ${A} d="M66 46l10 10 20-22"/><path ${D} d="M36 28l4 4M124 28l-4 4M30 56h6M124 56h6"/>`),
    warn: w(`<path ${D} d="M24 82h112"/><path ${F} d="M80 18l34 58H46z"/><path ${A} d="M80 38v18M80 64v2"/>`),
  };
})();
function emptyHtml(icon, title, text, actions) {
  const acts = (actions || []).map(([l, fn, p]) => `<button class="btn ${p ? 'p' : 's'} sm" onclick="${esc(fn)}">${l}</button>`).join('');
  const art = typeof icon === 'string' && ART[icon] ? icon : (icon === I.search ? 'search' : icon === I.magnet ? 'store' : icon === I.home ? 'library' : icon === I.gamepad ? 'roms' : icon === I.dl ? 'downloads' : icon === I.wrench ? 'tools' : icon === I.bolt ? 'flash' : icon === I.check ? 'done' : icon === I.warn ? 'warn' : '');
  const pic = art ? `<div class="eart ${art}">${ART[art]}</div>` : icon ? `<div class="eic">${icon}</div>` : '';
  return `<div class="empty ${art ? 'art' : ''}">${pic}<b>${title}</b><p>${text}</p>${acts ? `<div class="eacts">${acts}</div>` : ''}</div>`;
}
function progHtml(j, key) {
  const names = { download: 'Baixando', extract: 'Extraindo', cleanup: 'Limpando', done: 'Concluído', move: 'Movendo', install: 'Instalando' };
  const ind = j.fraction < 0, pct = ind ? 0 : Math.round(j.fraction * 100);
  return `<div class="prog" data-job="${esc(key)}"><div class="h"><b><i></i>${names[j.stage] || j.stage}</b><span>${ind ? '' : pct + '%'}</span></div>
    <div class="track ${ind ? 'ind' : ''} ${j.stage === 'extract' ? 'ex' : ''}"><i style="width:${pct}%"></i></div>
    <div class="d"><span>${esc(j.detail)}</span>${j.kind === 'install' && j.stage === 'download' ? `<button onclick="api.post('/api/cancel',{key:${jsq(key)},pause:true})" title="Guarda o parcial para retomar na Fila">Pausar</button>` : ''}<button onclick="api.post('/api/cancel',{key:${jsq(key)}})">Cancelar</button></div></div>`;
}

function fmtEta(sec) { if (sec < 60) return 'menos de 1 min'; const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`; }
function updateFromSource(key) {
  const d = S.det && S.det.key === key ? S.det : null; if (!d || !d.update_version) return;
  const from = d.update_from || key, g = S.byKey[from] || {};
  modal({ title: `Baixar a versão ${esc(d.update_version)}?`, html: `<p>Instalada agora: <b>${esc(d.version || '?')}</b> · na fonte <b>${esc(repoName(g.repo) || g.repo || '')}</b>: <b>${esc(d.update_version)}</b>.</p><p class="dim">Os arquivos do jogo são substituídos pelos novos. Saves e configurações que ficam em Documentos/AppData não são tocados.</p>`,
    ok: 'Baixar agora', onOk: () => { if (from !== key) openGame(from); else install(key, false); } });
}
async function install(key, torrent) {
  const picked = [...document.querySelectorAll('.files input:checked')].map(i => i.value);
  const d = S.det && S.det.key === key ? S.det : null;
  if ((d && d.browser_only) || (torrent && !S.torrent)) return installNow(key, torrent, picked);
  const p = await api.post('/api/install/preview', { key, files: picked.length ? picked : null, torrent });
  if (!p || p.error) return installNow(key, torrent, picked);
  const g = S.byKey[key] || {}, low = p.free && p.need && p.free < p.need;
  const eta = p.torrent ? 'depende dos seeds do torrent' : p.eta ? `${fmtEta(p.eta)} <small>a ${fmt(p.speed)}/s</small>` : 'aparece depois do primeiro download';
  let where;
  if (p.fixed) where = `<div class="dlwhere"><span>${esc(p.root)}</span></div>`;
  else if (p.rom) {
    const dirs = [...new Set([p.root, ...(p.dirs || [])])];
    where = `<select class="sel" id="dlRoot" onchange="dlPickRom(this,${jsq(key)},${!!torrent})">${dirs.map(d => `<option value="${esc(d)}" ${d === p.root ? 'selected' : ''}>${esc(d)}</option>`).join('')}${p.native ? '<option value="pick">Baixar em outra pasta…</option>' : ''}</select>
      <label class="chk dlrem"><input type="checkbox" id="dlRemember"><span>Usar sempre esta pasta para ${esc(p.system_name || p.system)}</span></label>
      <p class="dlnote">Pasta padrão: <span class="code">${esc(p.dirs && p.dirs[0] || p.root)}</span>${p.remembered ? ` · você escolheu <span class="code">${esc(p.remembered)}</span> como padrão deste console` : ''}. Qualquer pasta escolhida passa a ser lida pelo emulador.</p>`;
  } else where = `<select class="sel" id="dlRoot" onchange="dlPickRoot(this,${jsq(key)},${!!torrent})"><option value="">${esc(p.root)}</option>${p.native ? '<option value="pick">Escolher outra pasta…</option>' : ''}</select>`;
  modal({
    title: 'Baixar jogo', ok: 'Baixar', cancel: 'Agora não',
    html: `<div class="dlbox"><div class="dlhead"><div class="dlth"><span>${esc((p.title || '?').trim().charAt(0).toUpperCase())}</span><img src="/thumb/${enc(key)}?v=${g.cv || 0}" alt="" onerror="this.remove()"></div><b>${esc(p.title)}</b></div>
      <div class="dlrows"><div><span>Precisa de espaço</span><b>${p.need ? fmt(p.need) : '—'}</b></div><div><span>Espaço livre</span><b class="${low ? 'warn' : ''}">${p.free ? fmt(p.free) : '—'}</b></div><div><span>Tempo estimado</span><b>${eta}</b></div></div>
      ${low ? `<p class="dlwarn">${I.warn} Pode faltar espaço. Libere ${fmt(p.need - p.free)} ou escolha outra pasta.</p>` : ''}
      <label class="dllbl">Onde instalar</label>${where}</div>`,
    onOk: () => {
      const sel = $('#dlRoot'), rem = $('#dlRemember');
      const dest = p.rom && sel && sel.value !== 'pick' ? sel.value : '';
      installNow(key, torrent, picked, p.rom ? { dest, remember: !!(rem && rem.checked) } : null);
    }
  });
}
async function dlPickRom(sel, key, torrent) {
  if (sel.value !== 'pick') return;
  const r = await api.post('/api/pick_path', { kind: 'folder', initial: sel.options[0].value });
  if (r && r.path) { const o = document.createElement('option'); o.value = r.path; o.textContent = r.path; sel.insertBefore(o, sel.lastElementChild); sel.value = r.path; }
  else sel.value = sel.options[0].value;
}
async function dlPickRoot(sel, key, torrent) {
  if (sel.value !== 'pick') return;
  sel.value = '';
  const r = await api.post('/api/choose_folder', { what: 'games' });
  if (r && r.folder) { await loadCatalog(false); install(key, torrent); }
}
function dlWindowNote() {
  const c = S.config; if (!c.dl_schedule) return '';
  const mins = x => { const [h, m] = String(x || '').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const f = mins(c.dl_from || '23:00'), t = mins(c.dl_to || '07:00'); if (f === t) return '';
  const d = new Date(), n = d.getHours() * 60 + d.getMinutes(), inside = f < t ? (n >= f && n < t) : (n >= f || n < t);
  return inside ? '' : `Fora do horário de download (${c.dl_from || '23:00'}–${c.dl_to || '07:00'}): fica esperando na Fila. Ajustes › Store e downloads.`;
}
async function installNow(key, torrent, picked, where) {
  picked = picked || [...document.querySelectorAll('.files input:checked')].map(i => i.value);
  const r = await api.post('/api/install', { key, files: picked.length ? picked : null, torrent, dest: where && where.dest || '', remember: !!(where && where.remember) });
  if (r.error) { toast('err', 'Não foi possível concluir', r.error); return; }
  if (r.browser) { toast('ok', 'Abrindo no navegador', 'O download continua no navegador. Quando terminar: Adicionar → Jogo de Windows.'); return; }
  if (r.external) { toast('ok', 'Magnet enviado ao cliente de torrent', 'Quando terminar de baixar: Adicionar → Jogo de Windows (ou arraste o arquivo para Store).'); return; }
  if (r.free && r.need && r.free < r.need) toast('', 'Pouco espaço', `Livre: ${fmt(r.free)} · recomendado ~${fmt(r.need)}. A instalação continua mesmo assim.`);
  const wn = dlWindowNote(); if (wn) toast('warn', 'Na fila, esperando o horário', wn);
  S.jobs[key] = { stage: 'download', fraction: 0, detail: 'Iniciando…' }; qfabSync();
  if (S.det && S.det.key === key) renderDetail(); pollSoon();
}
async function play(key, after, emulator, _unused, force) {
  const mode = S.config.after_launch || 'ask';
  if (!after && mode === 'ask') return askAfter(key);
  S._after = after;
  busyCursor(true); const busyT = setTimeout(() => busyCursor(false), 8000);
  const r = await api.post('/api/play', { key, after: after || undefined, emulator: emulator || undefined, force: force || undefined }).catch(() => ({ error: 'offline' }));
  clearTimeout(busyT); if (r.ok) { setTimeout(() => busyCursor(false), 2500); launchShow(key); } else busyCursor(false);
  if (r.missing) return missingDialog(key, r);
  if (r.running) return toast('warn', 'Já está aberto', (S.byKey[key] || {}).title || '', [{ label: 'Encerrar o jogo', fn: () => stopGame(key) }, { label: 'OK', fn: () => {} }]);
  if (r.need_mc_launcher) return mcNeedLauncher(r); if (r.mc_missing === 'bedrock') return mcNeedBedrock(r);
  if (r.choose_emulator) { return chooseEmulator(key, r.choose_emulator, r.default, r.missing_default); } if (r.error === 'emu_missing') { modal({ title: 'Emulador necessário', text: r.message, ok: 'Ir para Emuladores', cancel: 'Não fazer nada', onOk: () => setView('emulation') }); } else if (r.error === 'needs_setup') { modal({ title: 'Falta configurar o emulador', text: r.message, ok: 'Abrir guia', cancel: 'Não fazer nada', onOk: () => emuGuide(r.system, () => {}), buttons: [{ label: 'Abrir mesmo assim', fn: () => play(key, after, emulator, optimize, true) }] }); } else if (r.error && r.linux_runner) { modal({ title: 'Falta um componente do sistema', text: r.error, ok: 'Ajustes', cancel: 'Fechar', onOk: () => { setView('settings'); S.tab.settings = 'play'; renderSettings(true); } }); } else if (r.error) toast('err', 'Não foi possível abrir', r.error); else if (r.preparing) { toast('info', 'Preparando o Proton', r.hint, [{ label: 'Ver fila', fn: () => setView('queue') }]); } else { toast('ok', 'Jogo aberto', r.hint || (r.tracked ? 'Contando o tempo de jogo…' : '')); S.sessions = S.sessions || {}; S.sessions[key] = { since: Date.now() / 1000 }; applyPlaying(); if (S.det && S.det.key === key) renderDetail(); pollSoon(); } }

async function linuxStatus() {
  const el = $('#lxst'); if (!el) return; const st = await api.get('/api/linux'); if (!st || !st.linux) return;
  const bits = [st.runner === 'wine' ? (st.wine ? 'Wine: ' + st.wine : 'Wine não encontrado') : (st.ready ? 'Proton pronto (' + st.proton + ')' : st.umu ? 'umu baixado; Proton ainda não' : 'Nada baixado ainda — acontece sozinho no primeiro jogo')];
  if (st.error) bits.push(st.error); bits.push('Prefixos em ' + st.prefix_root);
  el.textContent = bits.join(' · ');
}
async function linuxPrepare() {
  const r = await api.post('/api/linux/prepare', {}); if (r && r.error) return toast('err', 'Proton', r.error);
  toast('info', 'Proton', 'Baixando em segundo plano. Acompanhe na Fila.', [{ label: 'Ver fila', fn: () => setView('queue') }]);
}
function missingDialog(key, r) {
  const g = S.byKey[key] || {}; const rom = r.missing === 'rom';
  modal({ title: rom ? 'ROM não encontrada' : 'Executável não encontrado', wide: true,
    html: `<p>${esc(g.title || key)} aponta para um ${rom ? 'arquivo' : 'executável'} que não está mais no lugar.</p><p class="code" style="word-break:break-all;margin:6px 0 2px">${esc(r.path || '')}</p>${r.drive ? `<p><b style="color:var(--amber)">A unidade ${esc(r.drive)} não está conectada.</b> Se o jogo fica num HD externo ou pendrive, conecte e tente de novo — não precisa apontar nada.</p>` : ''}<p>Se o jogo mudou de pasta, aponte o caminho novo. Se foi apagado, remova da biblioteca — os arquivos não são tocados.</p>`,
    ok: rom ? 'Apontar arquivo…' : 'Apontar pasta…', cancel: 'Não fazer nada', buttons: [{ label: 'Remover da biblioteca', fn: () => confirmUninstall(key) }],
    onOk: () => relocateGame(key, null) });
}
let lsT = 0;
function launchShow(key) {
  const mode = S.config.launch_splash || 'short'; if (!mode || mode === 'off') return;
  const g = S.byKey[key] || {}; let el = $('#launch');
  if (!el) { el = document.createElement('div'); el.id = 'launch'; el.innerHTML = '<div class="lbg"></div><div class="lbox"><img alt=""><div class="lt"><small>Abrindo</small><b></b><span class="ldots"><i></i><i></i><i></i></span></div></div>'; document.body.appendChild(el); el.addEventListener('click', launchHide); }
  el.querySelector('.lbg').style.backgroundImage = `url("/cover/${enc(key)}?v=${g.cv || 0}")`;
  el.querySelector('img').src = `/cover/${enc(key)}?v=${g.cv || 0}`; el.querySelector('b').textContent = g.title || '';
  el.classList.add('on'); clearTimeout(lsT); lsT = setTimeout(launchHide, mode === 'long' ? 3800 : 1900);
}
function launchHide() { const el = $('#launch'); if (el) el.classList.remove('on'); clearTimeout(lsT); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') launchHide(); });
async function addLocal() {
  const pk = await api.post('/api/pick_exe', {});
  if (pk.native) {
    if (!pk.file) return;
    const tgt = pk.target && !/:\/\//.test(pk.target) ? `<p style="color:var(--muted);font-size:12px;margin:6px 0 0">Atalho para: ${esc(pk.target)}</p>` : pk.target ? `<p style="color:var(--muted);font-size:12px;margin:6px 0 0">Abre pela loja (${esc(pk.target.split(':')[0])})</p>` : '';
    modal({ title: 'Adicionar jogo instalado', text: pk.file, input: pk.guess || '', ok: 'Adicionar', html: tgt + '<label class="ml">Nome do jogo (usado para buscar capa e metadados)</label>',
      onOk: async v => { const r = await api.post('/api/local/add', { exe: pk.file, title: v }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); toast('ok', 'Adicionado', r.title); await loadCatalog(false); setView('home'); openGame(r.key); } });
  } else {
    modal({ title: 'Adicionar jogo instalado', html: '<label class="ml">' + (S.config.os === 'windows' ? 'Caminho completo do .exe ou atalho (.lnk)' : 'Caminho completo do executável (.exe, .sh, .x86_64, AppImage)') + '</label><input class="mi" id="lxExe" placeholder="' + (S.config.os === 'windows' ? 'C:\\Jogos\\PES2008\\pes2008.exe' : '/home/eu/Jogos/pes2008/pes2008.exe') + '" onchange="api.post(\'/api/local/guess\',{path:this.value}).then(r=>{const t=$(\'#lxTitle\');if(t&&!t.value)t.value=r.guess||\'\'})"><label class="ml">Nome (opcional — detectado pelo arquivo se vazio)</label><input class="mi" id="lxTitle">', ok: 'Adicionar',
      onOk: async () => { const r = await api.post('/api/local/add', { exe: $('#lxExe').value.trim(), title: $('#lxTitle').value.trim() }); if (r.error) { toast('err', 'Não foi possível concluir', r.error); return false; } toast('ok', 'Adicionado', r.title); await loadCatalog(false); setView('home'); openGame(r.key); } });
  }
}
function renameGame(key) { modal({ title: 'Renomear', text: 'O nome é usado para buscar capa e metadados de novo.', input: (S.det && S.det.key === key ? S.det.title : (S.byKey[key] || {}).title) || '', ok: 'Salvar', onOk: async v => { if (!v) return; await api.post('/api/rename', { key, title: v }); await loadCatalog(false); openGame(key); } }); }
const ARG_HINTS = ['-dx12', '-windowed', '-nointro', '-fullscreen', '-skipintro', '-language=pt-BR', '-novid', '-borderless', '-w 1920 -h 1080', '-safe', '-console'];
const ED = { key: null, info: null, form: null, tab: 'geral', probe: null };
const ED_TABS = [['geral', 'Geral'], ['midia', 'Mídia'], ['links', 'Links'], ['instalacao', 'Instalação'], ['acoes', 'Ações'], ['avancado', 'Avançado']];
async function editGame(key, tab) {
  const info = await api.get('/api/edit/' + enc(key));
  if (info.error) return toast('err', 'Editar', info.error);
  if (ED.key !== key) { ED.webThumb = ''; ED.heroThumb = ''; ED.web = null; ED.webKind = ''; }
  ED.key = key; ED.info = info; ED.tab = tab === 'meta' ? 'geral' : (tab || 'geral'); ED.probe = null;
  ED.form = { title: info.title, system: info.system, developer: info.developer, publisher: info.publisher, year: info.year, genres: info.genres.join(', '), tags: (info.tags || []).join(', '), summary: info.summary, series: info.series, modes: info.modes, notes: info.notes, status: info.status || '', score: info.score || 0,
    links: info.links.map(l => ({ ...l })), cover_url: info.cover_url && info.cover_src === 'manual' ? info.cover_url : '', hero_url: info.user.includes('hero_url') ? info.hero_url : '', background_file: info.background_file || '',
    exe: info.exe, dir: info.dir, args: info.args, workdir: info.workdir, version: info.version, emulator: info.emulator, fav: info.fav, unlock_title: false,
    admin: !!info.admin, pre_cmd: info.pre_cmd || '', post_cmd: info.post_cmd || '', pfx: info.pfx || '' };
  modal({ title: 'Editar detalhes do jogo', wide: true, html: `<div class="ged"><div class="tabs" id="edTabs"></div><div class="gedb" id="edBody"></div></div>`, ok: 'Salvar', cancel: 'Cancelar', extra: 'Baixar metadados…',
    onExtra: () => edProbeMenu(), onOk: () => edSave() });
  $('#modalBox').classList.add('ged-box');
  edRender();
}
function edSet(k, v) { ED.form[k] = v; }
async function openPath(path, key) { const r = await api.post('/api/open', { path: path || '', key: key || '' }); if (r && r.error) toast('err', 'Abrir pasta', r.error); return r; }
function edRender() {
  const f = ED.form, i = ED.info;
  $('#edTabs').innerHTML = ED_TABS.filter(([id]) => !(id === 'instalacao' && !i.installed && i.kind !== 'rom')).map(([id, n]) => `<button class="${ED.tab === id ? 'on' : ''}" onclick="ED.tab='${id}';edRender()">${n}</button>`).join('');
  const inp = (k, ph, extra) => `<input class="mi" value="${esc(f[k] || '')}" placeholder="${esc(ph || '')}" oninput="edSet('${k}',this.value)" ${extra || ''}>`;
  const row = (label, html, help) => `<label class="gr"><span>${label}${help ? `<i title="${esc(help)}">?</i>` : ''}</span>${html}</label>`;
  const userTag = k => i.user.includes(k) ? '<em class="gtag" title="Você preencheu este campo; a busca automática não mexe nele. Apague o valor para voltar ao automático.">seu</em>' : '';
  let h = '';
  if (ED.tab === 'geral') {
    const sysOpts = Object.entries(i.systems).map(([id, n]) => `<option value="${id}" ${id === f.system ? 'selected' : ''}>${esc(n)}</option>`).join('');
    h = `<div class="g2">
      ${row('Nome', (i.can_rename ? inp('title', 'Nome do jogo') : `<input class="mi" value="${esc(f.title)}" disabled title="Jogos vindos de uma fonte usam o nome da fonte">`) + (i.title_locked ? `<label class="mchk1 sm"><input type="checkbox" ${f.unlock_title ? 'checked' : ''} onchange="edSet('unlock_title',this.checked)"> deixar as fontes corrigirem o nome de novo</label>` : ''), 'Usado para buscar capa e informações. Ao mudar o nome e salvar, você escolhe se quero buscar tudo de novo.')}
      ${row('Plataforma', i.can_move || i.kind === 'rom' ? `<select class="mi" onchange="edSet('system',this.value)">${sysOpts}</select>` : `<input class="mi" value="${esc(i.systems[f.system] || f.system)}" disabled>`)}
      ${row('Desenvolvedora' + userTag('developer'), inp('developer', 'ex.: Naughty Dog'))}
      ${row('Publicadora' + userTag('publisher'), inp('publisher', 'ex.: Sony'))}
      ${row('Ano' + userTag('year'), inp('year', 'ex.: 2004', 'maxlength="4" style="width:110px"'))}
      ${row('Gêneros' + userTag('genres'), inp('genres', 'Ação, Aventura, RPG… (separe por vírgula)'))}
      ${row('Etiquetas', inp('tags', 'Zerar em 2026, Coop com a galera, Leve… (separe por vírgula)'), 'Suas marcações livres. Viram filtro e busca (tag:leve)')}
      ${row('Série' + userTag('series'), inp('series', 'ex.: Need for Speed'))}
      ${row('Modos' + userTag('modes'), inp('modes', 'Um jogador, Multijogador…'))}
    </div>
    <label class="gr full"><span>Descrição${userTag('summary')}</span><textarea class="mi" rows="7" placeholder="Resumo do jogo. Vazio = o que a Wikipedia/Steam trouxer." oninput="edSet('summary',this.value)">${esc(f.summary || '')}</textarea></label>
    <div class="gsrc">${i.source.length ? `Fontes usadas: ${esc(i.source.join(' + '))}` : 'Sem metadados ainda — preencha aqui ou use "Baixar metadados…".'}${i.copied_from ? ` · copiado de ${esc((i.others.find(o => o.key === i.copied_from) || {}).title || i.copied_from)}` : ''}
      <span class="sp"></span>${i.others.length ? `<button class="btn s xs" onclick="edCopyMenu()" title="Usa nome, descrição, capa e tudo mais de outro jogo da biblioteca — ótimo para mods de conversão total">${I.copy} Copiar de outro jogo…</button>` : ''}
      ${i.user.length || i.copied_from ? `<button class="btn s xs" onclick="edReset()" title="Apaga o que você editou e busca tudo de novo na internet">${I.refresh} Voltar ao automático</button>` : ''}</div>`;
  } else if (ED.tab === 'midia') {
    const cv = i.cv || Date.now();
    h = `<div class="gmedia">
      <div class="gmi"><b>Capa</b><div class="gmimg cov"><img src="${f.cover_url && f.cover_url !== (i.cover_src === 'manual' ? i.cover_url : '') ? esc(f.cover_url) : `/cover/${enc(i.key)}?v=${cv}`}" referrerpolicy="no-referrer" onerror="if(ED.webThumb&&this.src!==ED.webThumb){this.src=ED.webThumb}else{this.style.opacity=.15}"></div>
        <span class="gsub">${i.custom_cover ? 'imagem sua' : i.cover_src ? 'de ' + esc({ steam: 'Steam', gog: 'GOG', wikipedia: 'Wikipedia', libretro: 'boxart', steamgriddb: 'SteamGridDB', manual: 'link seu', web: 'imagens da web' }[i.cover_src] || i.cover_src) : 'sem capa'}</span>
        <div class="row">${i.native ? `<button class="btn s xs" onclick="edPickCover()">${I.image} Escolher imagem…</button>` : ''}<button class="btn s xs" onclick="edWebCovers()" title="Procura imagens com o nome do jogo no Bing, DuckDuckGo e Yandex e deixa você escolher a capa">${I.search} Procurar capa na web…</button>${i.custom_cover ? `<button class="btn s xs" onclick="resetCover(ED.key).then(()=>editGame(ED.key,'midia'))">${I.refresh} Remover a minha</button>` : ''}</div>
        <label class="gr"><span>ou link da imagem</span>${inp('cover_url', 'https://…/capa.jpg')}</label></div>
      <div class="gmi"><b>Fundo (hero)</b><div class="gmimg hero"><img src="${f.hero_url && f.hero_url !== (i.user.includes('hero_url') ? i.hero_url : '') ? esc(f.hero_url) : `/hero/${enc(i.key)}?v=${cv}`}" referrerpolicy="no-referrer" onerror="if(ED.heroThumb&&this.src!==ED.heroThumb){this.src=ED.heroThumb}else{this.style.opacity=.15}"></div>
        <span class="gsub">aparece atrás da página do jogo e no palco</span>
        <div class="row">${i.native ? `<button class="btn s xs" onclick="edPick('image','background_file')">${I.image} Escolher imagem…</button>` : ''}<button class="btn s xs" onclick="edWebCovers('hero')" title="Procura imagens largas (wallpaper, screenshot) com o nome do jogo e deixa você escolher o fundo">${I.search} Procurar fundo na web…</button>${f.background_file || f.hero_url ? `<button class="btn s xs" onclick="edSet('background_file','');edSet('hero_url','');edRender()">${I.x} Tirar</button>` : ''}</div>
        <label class="gr"><span>${f.background_file ? 'arquivo: ' + esc(f.background_file.split(/[\\/]/).pop()) : 'ou link da imagem'}</span>${inp('hero_url', 'https://…/fundo.jpg')}</label></div>
    </div><p class="ghelp">Imagens suas ficam na pasta data${SEP()}covers do Ludrix e nunca são trocadas pela busca automática. Se colar um link, ele é baixado uma vez e guardado.</p>`;
  } else if (ED.tab === 'links') {
    h = `<div class="glinks">${f.links.map((l, n) => `<div class="glk"><input class="mi" value="${esc(l.name)}" placeholder="Nome" oninput="ED.form.links[${n}].name=this.value"><input class="mi" value="${esc(l.url)}" placeholder="https://…" oninput="ED.form.links[${n}].url=this.value"><button class="btn s xs" title="Abrir" onclick="api.post('/api/open_url',{url:ED.form.links[${n}].url})">${I.ext}</button><button class="btn s xs" title="Remover" onclick="ED.form.links.splice(${n},1);edRender()">${I.x}</button></div>`).join('')}
      <button class="btn s sm" onclick="ED.form.links.push({name:'',url:''});edRender()">${I.plus} Adicionar link</button></div>
      ${i.auto_links.length ? `<p class="ghelp">Links que as fontes já trouxeram (aparecem na página do jogo): ${i.auto_links.map(l => `<a href="#" onclick="api.post('/api/open_url',{url:${jsq(l.url)}});return false">${esc(l.name)}</a>`).join(' · ')}</p>` : ''}`;
  } else if (ED.tab === 'instalacao') {
    const isRom = i.kind === 'rom';
    h = `<div class="g1">
      ${row(isRom ? 'Arquivo da ROM' : 'Pasta de instalação', `<div class="grow">${isRom ? `<input class="mi" value="${esc(i.exe)}" disabled>` : inp('dir', 'C:\\Jogos\\MeuJogo') + (i.native ? `<button class="btn s xs" onclick="edPick('folder','dir')" title="Escolher pasta">${I.folder}</button>` : '')}</div>`)}
      ${isRom ? row('Console', `<input class="mi" value="${esc(i.systems[f.system] || f.system)}" disabled>`) : ''}
      ${isRom && i.emu ? row('Emulador deste jogo', `<select class="mi" onchange="edSet('emulator',this.value)"><option value="">padrão do console (${esc(i.emu.emulator_title || '')})</option>${(i.emu.installed_options || []).map(o => `<option value="${o.id}" ${o.id === f.emulator ? 'selected' : ''}>${esc(o.title)}</option>`).join('')}</select>`, 'Só vale para este jogo. O padrão do console muda em Emuladores.') : ''}
      ${row('Versão', inp('version', 'ex.: 1.0.3'))}
      ${i.installed && !isRom && i.can_move ? row('Mover para outra pasta', `<div class="grow"><input class="mi" id="edMoveTo" placeholder="Pasta de destino (ex.: D:\\Jogos)">${i.native ? `<button class="btn s xs" onclick="edPickMove()" title="Escolher pasta">${I.folder}</button>` : ''}<button class="btn s xs" onclick="edMove()">Mover</button></div>`, 'Copia a pasta inteira do jogo para dentro do destino e depois apaga a original. O jogo continua na Biblioteca, com o caminho novo. Feche o jogo antes.') : ''}
      ${i.installed && !isRom ? `<div class="row" style="margin-top:6px"><button class="btn s xs" onclick="openPath(ED.form.dir,ED.key)">${I.folder} Abrir pasta</button>${i.kind === 'pc' || i.kind === 'local' ? `<button class="btn s xs" onclick="api.post('/api/shortcut/desktop',{key:ED.key}).then(r=>toast(r.error?'err':'ok','Atalho',r.error||'Criado na área de trabalho'))">${I.win} Atalho na área de trabalho</button>` : ''}</div>` : ''}
    </div>`;
  } else if (ED.tab === 'acoes') {
    const isRom = i.kind === 'rom'; const ex = ARG_HINTS[(f.title || '').length % ARG_HINTS.length];
    h = `<div class="g1">
      ${isRom ? row('ROM', `<input class="mi" value="${esc(i.exe)}" disabled>`) : row('Executável', `<div class="grow">${inp('exe', 'C:\\Jogos\\MeuJogo\\game.exe')}${i.native ? `<button class="btn s xs" onclick="edPick('exe','exe')" title="Procurar">${I.folder}</button><button class="btn s xs" onclick="openPath((ED.form.exe || '').replace(/[\\\\/][^\\\\/]*$/, ''),ED.key)" title="Abrir a pasta do executável">${I.ext}</button>` : ''}<button class="btn s xs" onclick="edListExes()" title="Listar os .exe da pasta do jogo">${I.search}</button></div>`, 'O arquivo que abre o jogo. Atalhos de loja (steam://…) também valem.')}
      ${row('Argumentos', inp('args', 'ex.: ' + ex), 'O que vai depois do .exe — igual ao campo "Destino" de um atalho do Windows.')}
      <div class="chips">${ARG_HINTS.slice(0, 7).map(a => `<button class="chip" onclick="ED.form.args=((ED.form.args||'')+' ${esc(a)}').trim();edRender()">${esc(a)}</button>`).join('')}</div>
      ${isRom ? '' : row('Pasta de trabalho', `<div class="grow">${inp('workdir', 'vazio = pasta do executável')}${i.native ? `<button class="btn s xs" onclick="edPick('folder','workdir')">${I.folder}</button>` : ''}</div>`, 'Alguns jogos antigos só acham seus arquivos se abertos "de dentro" de uma pasta específica.')}
    </div><p class="ghelp">${isRom ? 'Os argumentos vão para o emulador, depois do caminho da ROM.' : 'Cada jogo aceita coisas diferentes: -dx12 força DirectX 12, -windowed abre em janela, -skipintro pula os logos. Procure "launch options" + nome do jogo.'}</p>
    ${isRom || !i.installed ? '' : `<div class="g1" style="margin-top:12px">
      ${S.config.os === 'linux' ? row('Prefixo do Proton', `<label class="remember" style="margin:0"><input type="checkbox" ${f.pfx === 'own' ? 'checked' : ''} onchange="edSet('pfx',this.checked?'own':'')"> Usar um prefixo só deste jogo</label>`, 'Por padrão todos os jogos de Windows dividem o mesmo prefixo (data/pfx/shared). Um prefixo próprio isola instalações e ajustes deste jogo; é criado na próxima abertura.') : ''}
      ${S.config.os !== 'windows' ? '' : row('Administrador', `<label class="remember" style="margin:0"><input type="checkbox" ${f.admin ? 'checked' : ''} onchange="edSet('admin',this.checked)"> Abrir como administrador (o Windows pede permissão a cada abertura)</label>`, 'Para jogos antigos que só funcionam com permissão de administrador. O tempo de jogo continua sendo contado.')}
      ${row('Antes de abrir', inp('pre_cmd', 'ex.: "C:\\\\Apps\\\\DS4Windows\\\\DS4Windows.exe"'), 'Comando executado antes do jogo, na pasta do jogo. O Ludrix espera até 15 s por ele e abre o jogo em seguida; se o programa ficar aberto, tudo bem.')}
      ${row('Ao fechar', inp('post_cmd', 'ex.: taskkill /IM DS4Windows.exe'), 'Comando executado quando o jogo fecha. Útil para encerrar o que foi aberto antes ou restaurar algo.')}
    </div><p class="ghelp">Os comandos rodam como no Prompt (cmd). Caminhos com espaço vão entre aspas.</p>`}`;
  } else if (ED.tab === 'avancado') {
    h = `<div class="g2">
      ${row('Tempo de jogo (horas)', `<input class="mi" type="number" min="0" step="0.5" value="${i.playtime ? (Math.round(i.playtime / 360) / 10) : 0}" oninput="edSet('playtime_hours',this.value)" title="Edite para corrigir o tempo registrado (ex.: horas jogadas fora do Ludrix)">`)}
      ${row('Vezes jogado', `<input class="mi" type="number" min="0" step="1" value="${i.play_count || 0}" oninput="edSet('play_count',this.value)">`)}
      ${row('Último jogo', `<input class="mi" value="${i.last_played ? esc(ago(i.last_played)) : '—'}" disabled>`)}
      ${row('Adicionado', `<input class="mi" value="${i.added_at ? new Date(i.added_at * 1000).toLocaleDateString() : '—'}" disabled>`)}
      ${row('Origem', `<input class="mi" value="${esc(i.repo === 'local' ? 'adicionado manualmente' : i.repo || '')}" disabled>`)}
      ${row('Identificador', `<input class="mi" value="${esc(i.key)}" disabled>`)}
      ${i.title_orig && i.title_orig !== i.title ? row('Nome original', `<input class="mi" value="${esc(i.title_orig)}" disabled>`) : ''}
    </div>
    <div class="g2" style="margin-top:12px">
      ${row('Status', `<select class="mi" onchange="edSet('status',this.value)"><option value="">—</option>${STATUS.map(([id, nm]) => `<option value="${id}" ${f.status === id ? 'selected' : ''}>${nm}</option>`).join('')}</select>`, 'Como está este jogo para você. Dá para filtrar e ordenar a biblioteca por isso.')}
      ${row('Sua nota', `<select class="mi" onchange="edSet('score',+this.value)"><option value="0">—</option>${[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(n => `<option value="${n}" ${+f.score === n ? 'selected' : ''}>${n}</option>`).join('')}</select>`, 'De 1 a 10. Só sua, não vem de nenhum site.')}
    </div>
    <label class="mchk1"><input type="checkbox" ${f.fav ? 'checked' : ''} onchange="edSet('fav',this.checked)"> Favorito</label>
    <label class="gr full"><span>Notas${userTag('notes')}</span><textarea class="mi" rows="5" placeholder="Anotações suas: senha do zip, onde salvou, mod usado…" oninput="edSet('notes',this.value)">${esc(f.notes || '')}</textarea></label>`;
  }
  $('#edBody').innerHTML = h;
}
async function edPick(kind, field) {
  const r = await api.post('/api/pick_path', { kind, initial: ED.form.dir || '' });
  if (r.path) { ED.form[field] = r.path; if (field === 'exe' && !ED.form.dir) ED.form.dir = r.path.replace(/[\\/][^\\/]*$/, ''); edRender(); }
}
async function edPickCover() {
  const r = await api.post('/api/cover/set', { key: ED.key, path: null });
  if (r.error) return toast('err', 'Capa', r.error);
  if (r.ok) { toast('ok', 'Capa trocada', ''); afterCoverChange(ED.key); editGame(ED.key, 'midia'); }
}
async function edListExes() {
  const exes = await api.get('/api/exes/' + enc(ED.key)); if (!exes.length) return toast('', 'Nenhum .exe', 'Nenhum executável na pasta do jogo.');
  const box = $('#edBody'); box.insertAdjacentHTML('afterbegin', `<div class="mlist" id="edExes">${exes.map(x => `<button onclick="ED.form.exe=(ED.form.dir||'').replace(/[\\\\/]$/,'')+'\\\\'+${jsq(x)};edRender()">${esc(x)}</button>`).join('')}</div>`);
}
async function edSave() {
  const f = ED.form, i = ED.info; const renamed = f.title.trim() && f.title.trim() !== i.title;
  const send = async refetch => {
    const r = await api.post('/api/edit/save', { key: ED.key, data: { ...f, refetch } });
    if (r.error) { toast('err', 'Não foi possível salvar', r.error); return false; }
    toast('ok', 'Salvo', refetch ? 'Buscando capa e informações com o novo nome…' : (f.cover_url || f.hero_url ? 'Imagem baixada e guardada com o jogo.' : ''));
    ED.webThumb = ''; ED.heroThumb = ''; ED.web = null;
    await loadCatalog(false); if (S.det && S.det.key === ED.key) openGame(ED.key);
  };
  if (renamed && !i.copied_from && !i.user.length) {
    setTimeout(() => modal({ title: 'Nome alterado', text: `Buscar capa e informações de novo usando "${f.title.trim()}"?`, ok: 'Sim, buscar de novo', cancel: 'Não, só salvar', onOk: () => send(true), onCancel: () => send(false) }), 50);
    return;
  }
  return send(false);
}
function edProbeMenu() {
  const i = ED.info;
  setTimeout(() => modal({ title: 'Baixar metadados de…', text: `Procuro por "${ED.form.title}" na fonte escolhida e mostro a lista do que achei. Você escolhe o item certo antes de aplicar.`, noOk: true, cancel: 'Voltar',
    html: `<div class="mlist txt">${i.sources.map(s => `<button onclick="edProbeList('${s.id}')">${esc(s.name)}</button>`).join('')}</div>`, onCancel: () => editGame(ED.key, ED.tab) }), 50);
}
const PICK_SRC = new Set(['steam', 'gog', 'wikipedia', 'wikidata', 'libretro']);
async function edProbeList(source, q) {
  if (!PICK_SRC.has(source)) return edProbe(source);
  q = (q === undefined ? ED.form.title : q) || '';
  modal({ title: 'Selecionar item', wide: true, noOk: true, cancel: 'Voltar', onCancel: () => edProbeMenu(),
    html: `<div class="wsbar"><input class="mi" id="pkQ" value="${esc(q)}" placeholder="Nome para procurar…"><button class="btn p sm" onclick="edProbeList('${source}',$('#pkQ').value)">${I.search} Buscar</button></div><div class="pklist" id="pkList"><p class="ghelp">Procurando…</p></div>` });
  $('#modalBox').classList.add('ged-box');
  $('#pkQ').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); edProbeList(source, $('#pkQ').value); } };
  const r = await api.post('/api/edit/candidates', { key: ED.key, source, title: q });
  const L = $('#pkList'); if (!L) return;
  if (r.error) { L.innerHTML = `<p class="ghelp">${esc(r.error)}</p>`; return; }
  ED.pick = r.items;
  L.innerHTML = r.items.map((it, n) => `<button class="pkrow" onclick="edProbePick('${source}',${n})">${it.thumb ? `<img src="${esc(it.thumb)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '<i></i>'}<div><b>${esc(it.title)}${it.year ? ` <small>(${esc(it.year)})</small>` : ''}</b><span>${esc(it.sub || '')}</span></div></button>`).join('');
}
async function edProbePick(source, n) {
  const it = (ED.pick || [])[n]; if (!it) return;
  modal({ title: 'Buscando…', text: `Lendo "${it.title}"…`, noOk: true, noCancel: true });
  const r = await api.post('/api/edit/probe_id', { key: ED.key, source, id: it.id, title: ED.form.title });
  if (r.error) return modal({ title: 'Não deu certo', text: r.error, noOk: true, cancel: 'Voltar', onCancel: () => edProbeList(source) });
  edProbeShow(source, r, () => edProbeList(source));
}
async function edProbe(source) {
  modal({ title: 'Buscando…', text: 'Perguntando à fonte…', noOk: true, noCancel: true });
  const r = await api.post('/api/edit/probe', { key: ED.key, source, title: ED.form.title });
  if (r.error) return modal({ title: 'Nada encontrado', text: r.error, noOk: true, cancel: 'Voltar', onCancel: () => edProbeMenu() });
  edProbeShow(source, r, () => edProbeMenu());
}
function edProbeShow(source, r, back) {
  const name = r.canonical_title || r.wiki_title || r.wikidata_title || r.steam_name || r.gog_name || r.libretro_name || '';
  const fields = [['title', 'Nome', name], ['developer', 'Desenvolvedora', r.developer], ['publisher', 'Publicadora', r.publisher], ['year', 'Ano', r.year], ['genres', 'Gêneros', (r.genres || []).join(', ')], ['series', 'Série', r.series], ['modes', 'Modos', r.modes], ['summary', 'Descrição', r.summary], ['cover', 'Capa', r.cover_url && 'imagem encontrada'], ['hero', 'Fundo', r.hero_url && 'imagem encontrada']].filter(x => x[2]);
  const SRC_NAME = { steam: 'Steam', gog: 'GOG', wikipedia: 'Wikipedia', wikidata: 'Wikidata', libretro: 'boxart de console', web: 'imagens da web' };
  modal({ title: `Encontrado em ${SRC_NAME[source] || source}`, wide: true, ok: 'Aplicar marcados', cancel: 'Voltar', onCancel: back,
    html: `<div class="gprobe">${r.cover_url ? `<img src="${esc(r.cover_url)}" referrerpolicy="no-referrer">` : '<div></div>'}<div class="gpf">${fields.map(([k, l, v]) => `<label><input type="checkbox" data-pf="${k}" checked><b>${l}</b><span>${esc(String(v)).slice(0, 400)}</span></label>`).join('')}</div></div>`,
    onOk: () => {
      const on = new Set([...document.querySelectorAll('[data-pf]:checked')].map(x => x.dataset.pf));
      if (on.has('title')) ED.form.title = name;
      for (const k of ['developer', 'publisher', 'year', 'series', 'modes', 'summary']) if (on.has(k)) ED.form[k] = String(r[k] || '');
      if (on.has('genres')) ED.form.genres = (r.genres || []).join(', ');
      if (on.has('cover')) ED.form.cover_url = r.cover_url;
      if (on.has('hero')) ED.form.hero_url = r.hero_url || '';
      setTimeout(() => { modal({ title: 'Editar detalhes do jogo', wide: true, html: `<div class="ged"><div class="tabs" id="edTabs"></div><div class="gedb" id="edBody"></div></div>`, ok: 'Salvar', cancel: 'Cancelar', extra: 'Baixar metadados…', onExtra: () => edProbeMenu(), onOk: () => edSave() }); $('#modalBox').classList.add('ged-box'); ED.tab = 'geral'; edRender(); toast('ok', 'Prévia aplicada', 'Confira e clique em Salvar.'); }, 50);
    } });
}
function edReopen(tab, msg) {
  setTimeout(() => { modal({ title: 'Editar detalhes do jogo', wide: true, html: `<div class="ged"><div class="tabs" id="edTabs"></div><div class="gedb" id="edBody"></div></div>`, ok: 'Salvar', cancel: 'Cancelar', extra: 'Baixar metadados…', onExtra: () => edProbeMenu(), onOk: () => edSave() }); $('#modalBox').classList.add('ged-box'); ED.tab = tab || ED.tab; edRender(); if (msg) toast('ok', msg, 'Confira e clique em Salvar.'); }, 50);
}
async function edWebCovers(kind) {
  kind = kind === 'hero' ? 'hero' : 'cover';
  const title = (ED.form.title || '').trim();
  ED.ws = { kind, q: kind === 'hero' ? `"${title}" wallpaper` : `"${title}" cover`, engine: 'auto', page: 0, more: false, busy: false, hits: [] };
  ED.web = []; ED.webKind = kind;
  modal({ title: kind === 'hero' ? 'Escolha o fundo' : 'Escolha a capa', wide: true, noOk: true, cancel: 'Voltar', onCancel: () => edReopen('midia'),
    html: `<div class="wsbar"><input class="mi" id="wsQ" value="${esc(ED.ws.q)}" placeholder="O que procurar…"><select class="mi" id="wsE"><option value="auto">Automático</option><option value="bing">Bing</option><option value="duckduckgo">DuckDuckGo</option><option value="yandex">Yandex</option></select><button class="btn p sm" onclick="edWebGo()">${I.search} Buscar</button></div>
      <p class="mut" style="font-size:12px;margin:6px 0 0">Clique na imagem. Ela é baixada ao salvar e fica guardada com o jogo.</p>
      <div class="gweb${kind === 'hero' ? ' wide' : ''}" id="wsGrid"></div><div class="wsfoot" id="wsFoot"></div>` });
  $('#modalBox').classList.add('ged-box');
  $('#wsQ').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); edWebGo(); } };
  const r = await api.post('/api/edit/webcovers', { key: ED.key, title, kind });
  if (!ED.ws || ED.ws.kind !== kind) return;
  if (!r.error && r.hits && r.hits.length) { ED.ws.hits = r.hits; ED.ws.more = true; edWebRender(); }
  else { edWebGo(); }
}
function edWebRender() {
  const g = $('#wsGrid'), f = $('#wsFoot'); if (!g || !ED.ws) return;
  const hits = ED.ws.hits; ED.web = hits;
  g.innerHTML = hits.map((h, n) => `<button class="gwc" onclick="edWebPick(${n})" title="${esc(h.title || '')}${h.w ? ' · ' + h.w + '×' + h.h : ''}"><img src="${esc(h.thumb || h.url)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.style.display='none'"><span>${h.w ? h.w + '×' + h.h : ''}${h.engine ? ` · ${({ bing: 'Bing', duckduckgo: 'DDG', yandex: 'Yandex' })[h.engine] || esc(h.engine)}` : ''}</span></button>`).join('') || `<p class="ghelp">${ED.ws.busy ? 'Procurando…' : 'Nada encontrado. Tente outro nome, em inglês, ou outro buscador.'}</p>`;
  f.innerHTML = ED.ws.busy ? '<span class="mut">Procurando…</span>' : (ED.ws.more ? `<button class="btn s sm" onclick="edWebMore()">Carregar mais</button>` : (hits.length ? '<span class="mut">Fim dos resultados</span>' : ''));
}
async function edWebGo() {
  if (!ED.ws) return;
  ED.ws.q = ($('#wsQ')?.value || '').trim(); ED.ws.engine = $('#wsE')?.value || 'auto'; ED.ws.page = 0; ED.ws.hits = []; ED.ws.more = false;
  if (!ED.ws.q) return;
  await edWebFetch();
}
async function edWebMore() { if (!ED.ws || ED.ws.busy) return; ED.ws.page += 1; await edWebFetch(); }
async function edWebFetch() {
  const ws = ED.ws; ws.busy = true; edWebRender();
  const r = await api.post('/api/edit/websearch', { q: ws.q, engine: ws.engine, page: ws.page, kind: ws.kind });
  if (ED.ws !== ws) return;
  ws.busy = false;
  if (r.error) { toast('err', 'Busca de imagens', r.error); ws.more = false; return edWebRender(); }
  const seen = new Set(ws.hits.map(h => h.url)); let added = 0;
  for (const h of r.hits || []) if (!seen.has(h.url)) { seen.add(h.url); ws.hits.push(h); added++; }
  ws.more = Boolean(r.more) && (added > 0 || ws.page < 2);
  edWebRender();
}
function edWebPick(n) {
  const h = (ED.web || [])[n]; if (!h) return;
  if (ED.webKind === 'hero') { ED.form.hero_url = h.url; ED.form.hero_page = h.page || ''; ED.form.hero_thumb = h.thumb || ''; ED.heroThumb = h.thumb || ''; edReopen('midia', 'Fundo escolhido'); return; }
  ED.form.cover_url = h.url; ED.form.cover_page = h.page || ''; ED.form.cover_thumb = h.thumb || '';
  ED.webThumb = h.thumb || '';
  edReopen('midia', 'Capa escolhida');
}
function edCopyMenu() {
  const i = ED.info; let q = '';
  const list = () => i.others.filter(o => !q || o.title.toLowerCase().includes(q)).slice(0, 60).map(o => `<button onclick="edCopy(${jsq(o.key)})">${esc(o.title)}<small> · ${esc(i.systems[o.system] || o.system)}</small></button>`).join('') || '<p class="ghelp">nada com esse nome</p>';
  modal({ title: 'Copiar metadados de outro jogo', text: 'Nome, descrição, capa e fundo do jogo escolhido passam a valer para este (bom para mods de conversão total, que não têm ficha própria).', noOk: true, cancel: 'Voltar', onCancel: () => editGame(ED.key, 'geral'),
    html: `<input class="mi" placeholder="Filtrar…" id="edCopyQ"><div class="mlist" id="edCopyL">${list()}</div>` });
  $('#edCopyQ').oninput = e => { q = e.target.value.toLowerCase(); $('#edCopyL').innerHTML = list(); };
}
async function edCopy(from) {
  const r = await api.post('/api/edit/copy', { key: ED.key, from });
  if (r.error) return toast('err', 'Copiar', r.error);
  toast('ok', 'Metadados copiados', 'Ajuste o que quiser e salve.'); await loadCatalog(false); editGame(ED.key, 'geral');
}
async function edReset() {
  const r = await api.post('/api/edit/reset', { key: ED.key });
  if (r.error) return toast('err', 'Não foi possível concluir', r.error);
  toast('ok', 'Voltou ao automático', 'Buscando capa e informações de novo…'); $('#modal').classList.remove('on'); await loadCatalog(false);
}
async function editShortcut(key) { return editGame(key, 'acoes'); }
async function chooseExe(key) {
  const exes = await api.get('/api/exes/' + enc(key)); let chosen = null;
  modal({ title: 'Qual executável abre o jogo?', text: exes.length ? 'Ordenei do mais provável ao menos provável.' : 'Nenhum .exe encontrado na pasta.', list: exes, onPick: v => chosen = v, ok: 'Usar este', extra: 'Procurar…',
    onExtra: async () => { const r = await api.post('/api/set_exe', { key, rel: null }); if (r.ok) { toast('ok', 'Executável definido', r.exe); openGame(key); } else if (r.error) toast('err', 'Não foi possível concluir', r.error); },
    onOk: async () => { if (!chosen) return; const r = await api.post('/api/set_exe', { key, rel: chosen }); if (r.ok) { toast('ok', 'Executável definido', r.exe); openGame(key); } } });
}
async function crashDialog(key, title) {
  const d = await api.get('/api/game/' + enc(key)).catch(() => null); const why = d?.crash_why || 'Fechou em poucos segundos — normalmente arquivo corrompido ou instalação incompleta.';
  const n = d?.crash_count || 1, isRom = key.startsWith('rom:') || d?.kind === 'rom', uri = isUri(d?.exe || ''), win = S.config.os === 'windows', rc = d?.last_rc;
  if (S.config.crash_watch === false || (S.config.crash_mute || []).includes(key)) return;
  const rd = win && !isRom ? await api.get('/api/redists').catch(() => null) : null;
  const missing = rd && rd.items ? rd.items.filter(i => i.state === 'missing' && !/^physx/.test(i.id)) : [];
  const again = async (fn, label) => { const r = await fn(); if (r && r.error) return; toast('ok', label, 'Abrindo de novo…'); play(key); };
  const acts = [];
  if (!isRom && !uri && win && !d?.admin) acts.push(['shield', 'Abrir como administrador', rc === 740 ? 'O código do erro indica exatamente isso' : 'Resolve jogos antigos que gravam na própria pasta', () => again(() => api.post('/api/edit/save', { key, data: { admin: true } }), 'Administrador ligado')]);
  if (!isRom && !uri && win && d?.compat !== 'win7') acts.push(['refresh', 'Modo de compatibilidade Windows 7', 'Para jogos de antes de 2015 que fecham na hora', () => again(() => api.post('/api/compat/layer', { key, layer: 'win7' }), 'Compatibilidade aplicada')]);
  if (missing.length) acts.unshift(['dl', `Instalar o que falta (${missing.length})`, missing.slice(0, 4).map(i => i.title).join(', ') + (missing.length > 4 ? '…' : ''), () => { redistBundle('missing'); setView('redists'); }]);
  else acts.push(['dl', 'Instalar dependências', 'Visual C++, DirectX e .NET em um clique (Central)', () => setView('redists')]);
  if (!isRom) acts.push(['info', 'Ver requisitos', 'O que o jogo pede e o que o seu PC tem', () => { openGame(key); setTimeout(() => dtab('reqs'), 350); }]);
  if (isRom) acts.push(['info', 'Guia do console', 'BIOS, keys e firmware que o emulador exige', () => { setView('emulation'); }]);
  else if (!uri) acts.push(['cog', 'Trocar o executável', 'Às vezes o certo é outro .exe da pasta', () => chooseExe(key)]);
  if (d?.dir || d?.exe) acts.push(['folder', 'Abrir a pasta', 'Rodar direto pelo Explorer mostra o erro real', () => openPath(d?.dir || '', key)]);
  if (d?.compat) acts.push(['x', 'Tirar o modo de compatibilidade', 'Volta ao normal', () => api.post('/api/compat/layer', { key, layer: '' })]);
  S._crashActs = acts;
  modal({ title: `${title} fechou sozinho`, wide: true, html: `<p>${esc(why)}</p>${n > 1 ? `<p class="mut" style="font-size:12px">${n}ª vez seguida.</p>` : ''}
    <div class="sgrid">${acts.map((a, i) => `<button class="sact" onclick="$('#modal').classList.remove('on');S._crashActs[${i}][3]()">${I[a[0]] || I.cog}<div><b>${esc(a[1])}</b><small>${esc(a[2])}</small></div></button>`).join('')}</div>
    <p class="mut" style="font-size:12px;margin-top:12px">Se o jogo só abre um launcher próprio e fecha, ignore este aviso.</p>`,
    ok: 'Fechar', noCancel: true, buttons: [{ label: 'Apagar e adicionar de novo', fn: () => confirmUninstall(key) }, { label: 'Não avisar para este jogo', fn: () => { setCfg({ crash_mute: [...new Set([...(S.config.crash_mute || []), key])] }); toast('ok', 'Combinado', `${title} não vai mais gerar este aviso. Dá para voltar em Ajustes › Jogar.`); } }] });
}
function confirmUninstall(key) { const d = (S.det && S.det.key === key) ? S.det : (S.byKey[key] || {}); const local = d.kind === 'local', rom = key.startsWith('rom:'), repoRom = d.kind === 'rom' && !rom; modal({ title: local || rom ? `Remover ${d.title} da biblioteca?` : `Remover ${d.title}?`, text: local || rom ? 'Os arquivos do jogo NÃO serão apagados — só a entrada no launcher (o tempo jogado se perde).' : repoRom ? `A ROM baixada será apagada e o jogo volta a aparecer na Store:\n${d.exe || d.dir || ''}` : `A pasta será apagada e o jogo volta a aparecer na Store:\n${d.dir || ''}`, ok: 'Remover', danger: true, onOk: async () => { await api.post('/api/uninstall', { key }); const g = S.byKey[key]; if (g) g.installed = false; if (local || rom) toast('', 'Removido da biblioteca', d.title, [{ label: 'Desfazer', fn: undoRemove }, { label: 'OK', fn: () => {} }]); else toast('', 'Removido', d.title); closeDetail(); await loadCatalog(false); } }); }
async function calcSize(key, el) { if (el) el.textContent = 'Calculando…'; const r = await api.post('/api/game/size', { key }); if (r.error) { if (el) el.textContent = r.error; return; } const g = S.byKey[key]; if (g) g.size = r.size; if (el) el.outerHTML = esc(fmt(r.size)) + (r.partial ? ' <small style="color:var(--muted)">(parcial — pasta muito grande)</small>' : ` <small style="color:var(--muted)">(${pl(r.files, 'arquivo', 'arquivos')})</small>`); }
function whatsNew() { const txt = S.config.version_changelog || ''; const items = txt.split('\n').map(l => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean); modal({ title: `Novidades da ${S.config.version}`, wide: true, html: items.length ? `<ul class="wnew">${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="mut">Sem registro de mudanças para esta versão.</p>', ok: 'Fechar', noCancel: true, buttons: [{ label: 'Atualizações', fn: () => { closeDetail(); setView('settings'); settingsTab('system', 'Atualizações'); } }] }); }
async function libraryDupes() {
  const gs = await api.post('/api/library/dupes', {});
  if (!Array.isArray(gs) || !gs.length) return toast('ok', 'Nenhum duplicado', 'Nenhum jogo repete nome ou executável.');
  const row = i => `<div class="frow dupr" data-key="${esc(i.key)}"><div class="l"><b>${esc(i.title)}${i.exists ? '' : ' <small class="mut">· não encontrado</small>'}</b><span><code>${esc(i.exe || '—')}</code>${i.playtime ? ' · ' + fmtTime(i.playtime) : ''}${i.play_count ? ' · ' + i.play_count + 'x' : ''}${i.source ? ' · ' + esc(SRC_NAMES[i.source] || i.source) : ''}</span></div><div class="ta"><button class="btn s xs" onclick="openGame(${jsq(i.key)})">Detalhes</button><button class="btn s xs" onclick="dupeMerge(${jsq(i.key)}, this)" title="Mantém esta entrada, soma o tempo e as vezes jogado das outras e remove as repetidas">Manter esta</button><button class="btn d xs" onclick="dupeRemove(${jsq(i.key)}, this)">Remover</button></div></div>`;
  const html = gs.map(g => `<div class="dupg"><h4>${esc(g[0].title)} <small class="mut">${g.length} entradas</small></h4>${g.map(row).join('')}</div>`).join('');
  modal({ title: 'Jogos duplicados', wide: true, text: `${pl(gs.length, 'grupo', 'grupos')} com entradas repetidas. A primeira de cada grupo é a com arquivo existente e mais tempo jogado.`, html: `<div class="diag dupes">${html}</div>`, ok: 'Fechar', noCancel: true });
}
async function dupeMerge(key, btn) {
  const grp = btn && btn.closest('.dupg'); if (!grp) return;
  const drop = [...grp.querySelectorAll('.dupr')].map(r => r.dataset.key).filter(k => k !== key);
  const r = await api.post('/api/library/merge', { keep: key, drop }); if (r && r.error) return toast('err', 'Não foi possível juntar', r.error);
  grp.remove(); if (!document.querySelector('#modal .dupg')) $('#modal').classList.remove('on');
  toast('ok', 'Entradas juntadas', `${pl(r.removed, 'repetida removida', 'repetidas removidas')} · tempo e vezes jogado somados`);
  S.home = null; loadCatalog(false);
}
async function dupeRemove(key, btn) {
  const r = await api.post('/api/uninstall', { key }); if (r && r.error) return toast('err', 'Não foi possível remover', r.error);
  const row = btn && btn.closest('.dupr'); if (row) { const grp = row.parentElement; row.remove(); if (grp && grp.querySelectorAll('.dupr').length < 2) grp.remove(); if (!document.querySelector('#modal .dupg')) $('#modal').classList.remove('on'); }
  toast('ok', 'Removido da biblioteca', (S.byKey[key] || {}).title || '', { label: 'Desfazer', fn: undoRemove });
  S.home = null; loadCatalog(false);
}
async function libraryBackups() {
  const l = await api.post('/api/library/backups', {});
  if (!Array.isArray(l) || !l.length) return modal({ title: 'Cópias da biblioteca', text: 'Nenhuma cópia ainda. A primeira é feita na próxima abertura do Ludrix.', ok: 'Criar cópia agora', onOk: libraryBackupNow });
  const rows = l.map(b => `<div class="frow"><div class="l"><b>${esc(new Date(b.mtime * 1000).toLocaleDateString('pt-BR'))}</b><span>${b.games >= 0 ? pl(b.games, 'jogo', 'jogos') : 'ilegível'} · <code>${esc(b.file)}</code></span></div><div class="ta"><button class="btn s xs" onclick="libraryRestore(${jsq(b.file)})" ${b.games > 0 ? '' : 'disabled'}>Restaurar</button></div></div>`).join('');
  modal({ title: 'Cópias da biblioteca', wide: true, text: 'Restaurar adiciona os jogos que estão na cópia e não estão mais na biblioteca. Nada é removido ou sobrescrito.', html: `<div class="diag">${rows}</div>`, ok: 'Fechar', noCancel: true, extra: 'Criar cópia agora', onExtra: libraryBackupNow, buttons: [{ label: 'Abrir pasta', fn: () => openPath(l[0].path.replace(/[\\/][^\\/]+$/, '')) }] });
}
async function libraryBackupNow() { const r = await api.post('/api/library/backup', {}); if (r.error) return toast('err', 'Não foi possível copiar', r.error); toast('ok', 'Cópia criada', `${r.file} · ${pl(r.games, 'jogo', 'jogos')}`);
}
async function libraryRestore(name) { const r = await api.post('/api/library/restore', { name }); if (r.error) return toast('err', 'Não foi possível restaurar', r.error); $('#modal').classList.remove('on'); toast('ok', 'Biblioteca restaurada', [r.added ? pl(r.added, 'jogo recuperado', 'jogos recuperados') : '', r.fixed ? pl(r.fixed, 'tempo de jogo recuperado', 'tempos de jogo recuperados') : ''].filter(Boolean).join(' · ') || 'Nada faltava — a biblioteca já tinha tudo da cópia'); S.home = null; await loadCatalog(false); }
async function undoRemove() { const r = await api.post('/api/uninstall/undo', {}); if (r.error) return toast('err', 'Não foi possível desfazer', r.error); toast('ok', 'De volta à biblioteca', r.title || ''); S.home = null; await loadCatalog(false); }

const SC = { mode: 'windows', items: [], emus: [], path: '' };
function scanWizard() {
  modal({ title: 'Escanear pastas', text: 'Que tipo de pasta é?', noOk: true, cancel: 'Fechar', html: `<div class="addmenu">
    <button onclick="$('#modal').classList.remove('on');scanPick('windows')">${I.win}<div><b>${S.config.os === 'windows' ? 'Pasta de jogos de Windows' : 'Pasta de jogos de PC'}</b><small>Ex.: ${S.config.os === 'windows' ? 'D:\\Jogos' : '~/Jogos'} — cada subpasta vira um jogo. Separo o .exe do jogo de instaladores, redists e ferramentas e dou nome pela pasta.</small></div></button>
    <button onclick="$('#modal').classList.remove('on');scanPick('roms')">${I.disc}<div><b>Pasta de jogos emulados (ROMs)</b><small>Ex.: D:\\ROMs\\PS2 — cada arquivo vira um jogo. Você escolhe o console e o emulador (para todos ou um a um).</small></div></button></div>` });
}
async function scanPick(mode) {
  SC.mode = mode;
  if (S.config.native) return scanRun(mode, null);
  modal({ title: mode === 'roms' ? 'Pasta de ROMs' : 'Pasta de jogos', html: `<label class="ml">Caminho da pasta (modo navegador)</label><input class="mi" id="scPath" placeholder="${mode === 'roms' ? 'D:\\\\ROMs\\\\PS2' : 'D:\\\\Jogos'}">`, ok: 'Escanear', onOk: () => scanRun(mode, $('#scPath').value.trim()) });
}
async function gameDirAdd() { const r = await api.post('/api/dirs/add', {}); if (r.error) return toast('err', 'Não foi possível adicionar', r.error); if (r.native === false || (!r.ok && !r.dirs)) return modal({ title: 'Outra pasta com jogos', text: 'Digite o caminho completo (modo navegador não tem diálogo nativo).', input: '', ok: 'Adicionar', onOk: async v => { if (!v) return; const x = await api.post('/api/dirs/add', { path: v }); if (x.error) return toast('err', 'Não foi possível adicionar', x.error); S.config.game_dirs = x.dirs; renderSettings(true); if (!x.dup) scanRun('windows', v); } }); if (r.dirs) { S.config.game_dirs = r.dirs; renderSettings(true); if (r.dup) toast('', 'Essa pasta já está na lista', ''); else if (r.dirs.length) scanRun('windows', r.dirs[r.dirs.length - 1]); } }
const META_SRC = [['steam', 'Steam', 'Loja Steam: capa, descrição, gêneros, requisitos e capturas'], ['gog', 'GOG', 'Catálogo GOG: capa, fundo, desenvolvedora e ano'], ['wikipedia', 'Wikipedia', 'Artigo do jogo: descrição, ano, desenvolvedora, série e modos'], ['wikidata', 'Wikidata', 'Base estruturada: desenvolvedora, publicadora, ano, gêneros, plataformas e série; lista grande de candidatos'], ['libretro', 'Boxart de console', 'Capas oficiais por sistema para jogos emulados'], ['web', 'Imagens da web', 'Bing, DuckDuckGo e Yandex quando as outras fontes não têm a capa']];
async function metaSrcToggle(id, on) { const m = { ...(S.config.meta_sources || {}) }; if (on) delete m[id]; else m[id] = false; await setCfg({ meta_sources: m }); renderSettings(true); }
async function gameDirRemove(d) { const r = await api.post('/api/dirs/remove', { path: d }); if (r.dirs) { S.config.game_dirs = r.dirs; renderSettings(true); } }
function newGamesToast(ev) {
  const n = ev.count || (ev.games || []).length; if (!n) return;
  toast('', `${pl(n, 'jogo novo', 'jogos novos')} nas suas pastas`, 'Ainda não estão na biblioteca.', [
    { label: 'Revisar', fn: () => { SC.mode = 'windows'; SC.items = ev.games || []; SC.emus = []; SC.path = (ev.dirs || []).join(' · '); scanReview(); } },
    { label: 'Ignorar estes', fn: () => api.post('/api/dirs/ignore', { exes: (ev.games || []).map(g => g.exe) }).then(() => toast('ok', 'Ignorados', 'Não serão sugeridos de novo.')) },
    { label: 'Depois', fn: () => {} }]);
}
async function scanRun(mode, path) {
  SC.mode = mode;
  modal({ title: 'Escaneando…', html: `<div class="prog"><div class="h"><b><i></i>Lendo</b><span id="impMsg">Abrindo…</span></div><div class="track"><i style="width:40%;animation:indet 1.2s linear infinite"></i></div></div>`, noOk: true, cancel: 'Cancelar', onCancel: () => { IMP.cancel = true; } });
  IMP.cancel = false;
  let r = await api.post('/api/folder/scan', { path, mode });
  if (r.error) return modal({ title: 'Não deu certo', text: r.error, ok: 'OK' });
  if (r.ok === false) return $('#modal').classList.remove('on');
  if (r.async) { while (true) { await new Promise(res => setTimeout(res, 400)); if (IMP.cancel) return; r = await api.get('/api/import/poll'); if (r.done) break; const m = $('#impMsg'); if (m) m.textContent = r.msg || '…'; } }
  if (r.error) return modal({ title: 'Não deu certo', text: r.error, ok: 'OK' });
  SC.items = r.games || []; SC.emus = r.emulators || []; SC.path = r.path || path || '';
  if (!SC.items.length) return modal({ title: 'Nada encontrado', text: mode === 'roms' ? 'Nenhum arquivo de ROM/ISO nessa pasta (nem nas subpastas).' : 'Nenhum .exe que pareça jogo nessa pasta. Se os jogos estão em subpastas mais fundas, aponte a pasta de cima deles.', ok: 'Tentar outra pasta', onOk: () => scanPick(mode) });
  scanReview();
}
function scanReview() {
  const mode = SC.mode, items = SC.items;
  const sysOpts = (sel) => `<option value="">— console —</option>` + Object.entries(S.systems).filter(([k]) => k !== 'pc').sort((a, b) => a[1].localeCompare(b[1])).map(([k, n]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(n)}</option>`).join('');
  const emuOpts = (sel, sid) => `<option value="">emulador padrão do console</option>` + SC.emus.filter(e => !sid || !e.systems || !e.systems.length || e.systems.includes(sid)).map(e => `<option value="${e.id}" ${e.id === sel ? 'selected' : ''}>${esc(e.title)}${e.installed ? '' : ' (não instalado)'}</option>`).join('');
  const row = (g, i) => mode === 'roms'
    ? `<div class="impg scrow ${g.dup ? 'dup' : ''}"><input type="checkbox" data-i="${i}" ${g.dup ? '' : 'checked'}><div class="t"><input class="mi sm" data-t="${i}" value="${esc(g.title)}" title="Nome (edite se quiser)"><small>${esc(g.rom.replace(SC.path, '…'))} · ${fmt(g.size)}</small></div><select class="mi sm" data-s="${i}" title="Console">${sysOpts(g.system)}</select><select class="mi sm" data-e="${i}" title="Emulador">${emuOpts(g.emulator, g.system)}</select>${g.dup ? '<span class="pill warn">já tem</span>' : ''}</div>`
    : `<div class="impg scrow ${g.dup ? 'dup' : ''}"><input type="checkbox" data-i="${i}" ${g.dup ? '' : 'checked'}><div class="t"><input class="mi sm" data-t="${i}" value="${esc(g.title)}" title="Nome (edite se quiser)"><small>${esc(g.exe.replace(SC.path, '…'))} · ${fmt(g.size)}${g.alt_exes.length ? ` · +${g.alt_exes.length} outro(s) .exe` : ''}</small></div>${g.alt_exes.length ? `<select class="mi sm" data-x="${i}" title="Qual .exe abre o jogo">${[g.exe, ...g.alt_exes].map(x => `<option value="${esc(x)}">${esc(x.split(/[\\/]/).pop())}</option>`).join('')}</select>` : ''}<span class="pill ${g.confidence === 'alta' ? 'ok' : ''}" title="Confiança de que este .exe é o jogo">${g.confidence}</span>${g.dup ? '<span class="pill warn">já tem</span>' : ''}<button class="ib" data-ign="${i}" title="Ignorar este .exe: não é jogo, não sugerir de novo" onclick="scanIgnore(${i})">${I.x}</button></div>`;
  const bulk = mode === 'roms' ? `<div class="scbulk"><b>Pra todos de uma vez:</b><select class="mi sm" id="scAllSys" onchange="scanAll('s',this.value)">${sysOpts('')}</select><select class="mi sm" id="scAllEmu" onchange="scanAll('e',this.value)">${emuOpts('', '')}</select><label class="chk"><input type="checkbox" id="scAddDir" checked> Lembrar esta pasta em Emuladores (novas ROMs entram sozinhas)</label></div>` : `<div class="scbulk"><b>Dica:</b> o nome vem da pasta e é refinado pelos metadados depois; se o .exe escolhido estiver errado, troque no menu da linha ou depois em <i>Atalho</i>. O ✕ da linha ignora aquele .exe para sempre.</div><label class="chk" style="margin-top:6px"><input type="checkbox" id="scIgnRest" ${S.config.scan_ignore_rest ? 'checked' : ''} onchange="setCfg({scan_ignore_rest:this.checked})"> Não sugerir de novo os que ficarem desmarcados</label>`;
  const html = `<div class="imphead"><span>${mode === 'roms' ? pl(items.length, 'ROM', 'ROMs') : pl(items.length, 'jogo', 'jogos')} em <span class="code">${esc(SC.path)}</span> · ${items.filter(g => g.dup).length} já na biblioteca</span><span style="flex:1"></span><button class="btn s sm" onclick="document.querySelectorAll('.scrow input[type=checkbox]').forEach(c=>c.checked=true)">Marcar todos</button><button class="btn s sm" onclick="document.querySelectorAll('.scrow input[type=checkbox]').forEach(c=>c.checked=false)">Desmarcar</button></div>${bulk}<div class="impgames">${items.map(row).join('')}</div>`;
  modal({ title: mode === 'roms' ? 'Revisar ROMs encontradas' : 'Revisar jogos encontrados', html, ok: 'Adicionar selecionados', extra: '← Outra pasta', onExtra: () => scanPick(mode), wide: true, onOk: async () => {
    const sel = [];
    document.querySelectorAll('.scrow input[type=checkbox]:checked').forEach(c => { const i = +c.dataset.i, g = { ...items[i] }; const t = document.querySelector(`[data-t="${i}"]`); if (t && t.value.trim()) g.title = t.value.trim();
      if (mode === 'roms') { const sSel = document.querySelector(`[data-s="${i}"]`), eSel = document.querySelector(`[data-e="${i}"]`); g.system = sSel ? sSel.value : g.system; g.emulator = eSel ? eSel.value : ''; }
      else { const x = document.querySelector(`[data-x="${i}"]`); if (x) g.exe = x.value; } sel.push(g); });
    if (mode !== 'roms' && $('#scIgnRest')?.checked) { const rest = []; document.querySelectorAll('.scrow input[type=checkbox]:not(:checked)').forEach(c => { const i = +c.dataset.i, x = document.querySelector(`[data-x="${i}"]`); rest.push(x ? x.value : items[i].exe); }); if (rest.length) api.post('/api/dirs/ignore', { exes: rest }); }
    if (!sel.length) return false;
    if (mode === 'roms' && sel.some(g => !g.system)) { toast('err', 'Falta o console', 'Escolha o console das ROMs marcadas (ou use "para todos de uma vez").'); return false; }
    const opts = mode === 'roms' ? { system: $('#scAllSys').value, emulator: $('#scAllEmu').value, add_dir: $('#scAddDir').checked, path: SC.path } : {};
    const a = await api.post('/api/folder/apply', { games: sel, mode, opts });
    if (a.error) return toast('err', 'Escanear', a.error);
    toast('ok', 'Adicionados', `${pl(a.added, 'jogo', 'jogos')}${a.skipped ? ' · ' + pl(a.skipped, 'ignorado', 'ignorados') : ''} — capas e informações chegam em seguida.`);
    TH.err.clear(); TH.tries = {}; S.home = null;
    S.view = ''; setView(mode === 'roms' ? 'emulation' : 'home'); await loadCatalog(false);
  } });
}
async function scanIgnore(i) {
  const g = SC.items[i]; if (!g) return;
  const x = document.querySelector(`[data-x="${i}"]`), exe = x ? x.value : g.exe;
  const r = await api.post('/api/dirs/ignore', { exes: [exe] }); if (r.error) return toast('err', 'Ignorar', r.error);
  const rest = [g.exe, ...(g.alt_exes || [])].filter(a => a !== exe);
  if (rest.length) { g.exe = rest[0]; g.alt_exes = rest.slice(1); g.confidence = 'média'; toast('ok', 'Ignorado', `${exe.split(/[\\/]/).pop()} não será sugerido de novo. A linha passou para ${rest[0].split(/[\\/]/).pop()}.`); }
  else { SC.items = SC.items.filter((_, k) => k !== i); toast('ok', 'Ignorado', `${exe.split(/[\\/]/).pop()} não será sugerido de novo.`); }
  scanReview();
}
function scanAll(kind, v) { document.querySelectorAll(kind === 's' ? '.scrow select[data-s]' : '.scrow select[data-e]').forEach(sel => { sel.value = v; if (kind === 's') { const i = sel.dataset.s; const e = document.querySelector(`[data-e="${i}"]`); if (e) { const cur = e.value; e.innerHTML = e.innerHTML; e.value = cur; } } }); }

function emuTabs() {
  const n = S.games.reduce((a, g) => a + (isRepoRom(g) && (!g.installed || S.jobs[g.key]) ? 1 : 0), 0);
  return `<div class="tabs"><button class="${S.tab.emulation !== 'roms' ? 'on' : ''}" onclick="S.tab.emulation='emulators';renderEmulation()">Consoles</button><button class="${S.tab.emulation === 'roms' ? 'on' : ''}" onclick="S.tab.emulation='roms';S.page=1;renderEmulation()">Baixar ROMs${n ? ` <span class="n">${n}</span>` : ''}</button></div>`;
}
async function renderEmulation() {
  if (S.tab.emulation === 'roms') return renderRomStore();
  $('#view').innerHTML = `<div class="h1"><h2>Emuladores</h2><span>carregando…</span></div>`;
  const e = await api.get('/api/emulation'); S.emu = e; if (S.view !== 'emulation') return;
  const sys = Object.values(e.systems);
  let h = `<div class="h1"><h2>Emuladores</h2><span>${sys.filter(s => s.installed).length} de ${sys.length} consoles ${sys.filter(s => s.installed).length === 1 ? 'pronto' : 'prontos'}</span><div class="acts">
    <button class="btn s" onclick="romRootScan()" title="Escolha a pasta onde ficam suas ROMs: as subpastas de cada console são reconhecidas de uma vez">${I.search} Varrer pasta de ROMs</button>    <button class="btn s" onclick="openPath(${jsq(e.games_root)})" title="Abrir a pasta de ROMs do Ludrix">${I.folder} ROMs</button>
    <button class="btn p" onclick="addCustomEmu()">${I.plus} Meu próprio emulador</button></div></div>${emuTabs()}
    <div class="hint">Coloque suas ROMs em <span class="code">emulation${SEP()}games${SEP()}&lt;sistema&gt;</span> (ou aponte outra pasta no console) e elas entram na Biblioteca. Emuladores são baixados do site oficial e ficam portáteis em <span class="code">emulation\\emulators</span>.</div>`;
  const POP = ['ps2', 'ps1', 'psp', 'snes', 'gba', 'n64', 'nds', 'gc', 'wii', 'genesis', 'nes', 'switch'];
  const rank = x => { const i = POP.indexOf(x.id); return i < 0 ? 99 : i; };
  const mine = sys.filter(x => x.installed || x.rom_count > 0 || (x.extra_dirs || []).length);
  const rest = sys.filter(x => !mine.includes(x)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  if (!mine.length) h += `<div class="steps"><div><i>1</i><b>Escolha o console</b><span>e instale o emulador com um clique — ou aponte o que você já tem em "Já tenho".</span></div><div><i>2</i><b>Traga as ROMs</b><span>copie para a pasta do console ou use "+ pasta de ROMs" para apontar a sua.</span></div><div><i>3</i><b>Jogue pela Biblioteca</b><span>cada ROM vira um jogo com capa; o console configurado sobe para "Meus consoles".</span></div></div>`;
  const tile = (s, quiet) => {
    const job = S.jobs['emu:' + s.emulator];
    const opts = s.options.map(id => e.emulators[id]).filter(Boolean);
    const em = e.emulators[s.emulator] || {};
    const isCustom = !!em.custom;
    const nInst = (s.installed_options || []).length;
    const dirs = [`games${SEP()}${s.id}`, ...(s.extra_dirs || [])];
    return `<div class="tile ${s.installed ? 'ok' : ''} ${quiet ? 'quiet' : ''}" data-sys="${s.id}"><div class="tt">${sysIcon(s.id)}<b title="${esc(s.name)}">${esc(s.name)}</b>${s.installed ? `<span class="pill ok">pronto${nInst > 1 ? ` · ${nInst}` : ''}</span>` : '<span class="pill">sem emulador</span>'}${em.update ? `<span class="pill warn" title="Versão ${esc(em.update)} disponível">${esc(em.update)}</span>` : ''}${s.guide ? `<button class="pill ${s.installed && !s.setup_ok ? 'warn' : ''}" style="cursor:pointer" title="${s.installed && !s.setup_ok ? 'Falta BIOS/keys/firmware — abrir o guia' : 'Guia de configuração deste console'}" onclick="emuGuide('${s.id}')">${s.installed && !s.setup_ok ? 'falta ' + ((s.setup_missing || []).length === 1 ? esc(s.setup_missing[0].replace(/\s*\(.*$/, '').replace(/ e .*$/, '')) : 'configurar') : 'guia'}</button>` : ''}<button class="ib" title="Emuladores deste console, pasta de ROMs e extensões" onclick="sysEmus('${s.id}')">${I.cog}</button></div>
      <div class="tm">${opts.length > 1 ? `<select onchange="api.post('/api/emulator/select',{system:'${s.id}',id:this.value}).then(renderEmulation)">${opts.map(o => `<option value="${o.id}" ${o.id === s.emulator ? 'selected' : ''}>${esc(o.title)}${o.custom ? ' (meu)' : ''}</option>`).join('')}</select>` : `<span>${esc(s.emulator_title)}</span>`}<span>·</span><span>${s.rom_count} ${s.rom_count === 1 ? 'jogo' : 'jogos'}</span>${(() => { const nb = S.games.filter(g => g.system === s.id && g.kind === 'rom' && g.repo === 'local' && !g.installed).length; return nb ? `<span>·</span><a href="#" style="color:var(--amber)" title="ROMs da biblioteca cujo arquivo não foi encontrado" onclick="closeDetail();setView('home');setTimeout(()=>{clearFlt();S.flt.sys.add('${s.id}');S.flt.flags.add('broken');renderLibrary()},80);return false">${pl(nb, 'não encontrada', 'não encontradas')}</a>` : ''; })()}</div>
      <div class="tm"><span class="mono" title="${esc(dirs.join('\n'))}">${esc(dirs[0])}${dirs.length > 1 ? ` +${dirs.length - 1}` : ''}</span><span class="sp"></span><button class="lnk" style="font-size:11.5px" onclick="addRomDir('${s.id}')">+ pasta de ROMs</button></div>
      <div class="tm"><span title="Para onde vão os downloads de ROM deste console">${I.dl}</span><span class="mono" title="${esc(s.dest || s.games_dir)}">${esc(s.dest ? s.dest.split(/[\\/]/).slice(-2).join(SEP()) : `games${SEP()}${s.id}`)}</span><span class="sp"></span><button class="lnk" style="font-size:11.5px" onclick="romDestMenu(this,'${s.id}')">Baixar em…</button></div>
      ${job ? progHtml(job, 'emu:' + s.emulator) : `<div class="ta">${s.installed ? `${em.update && !isCustom && !em.pointed ? `<button class="btn p" title="Baixa a versão ${esc(em.update)} por cima; configurações e saves do emulador ficam" onclick="updateEmu('${s.emulator}')">${I.dl} Atualizar</button>` : ''}<button class="btn s" title="Abrir o emulador sem jogo, para configurar controles/BIOS" onclick="api.post('/api/emulator/open',{id:'${s.emulator}'})">${I.cog} Abrir</button><button class="btn s ico" title="Pasta do emulador" onclick="openPath(${jsq((em.exe_path || '').replace(/[\\/][^\\/]+$/, ''))})">${I.folder}</button>${isCustom ? `<button class="btn d ico" title="Remover este emulador" onclick="removeCustomEmu('${s.emulator}')">${I.trash}</button>` : em.pointed ? `<button class="btn d ico" title="Esquecer o .exe apontado" onclick="api.post('/api/emulator/exe',{id:'${s.emulator}',exe:null}).then(renderEmulation)">${I.x}</button>` : `<button class="btn d ico" title="Remover" onclick="removeEmu('${s.emulator}')">${I.trash}</button>`}` : isCustom ? `<span class="pill warn">exe não encontrado</span>` : em.source === 'manual' ? `<button class="btn ${quiet ? 's' : 'p'}" onclick="api.post('/api/open_url',{url:${jsq(em.homepage || '')}})">${I.ext} Baixar no site</button><button class="btn s" title="Se você já tem esse emulador, só aponte o .exe" onclick="pointEmuExe('${s.emulator}')">Já tenho</button>` : `<button class="btn ${quiet ? 's' : 'p'}" onclick="installEmu('${s.emulator}')">${I.dl} Instalar ${esc(s.emulator_title)}</button><button class="btn s" title="Se você já tem esse emulador instalado, só aponte o .exe" onclick="pointEmuExe('${s.emulator}')">Já tenho</button>`}
        <button class="btn s ico" title="Abrir a pasta de ROMs" onclick="openPath(${jsq(s.games_dir)})">${I.folder}</button></div>`}</div>`;
  };
  if (mine.length) h += `<div class="gh"><h3>Meus consoles <em>${mine.length}</em></h3><span>com emulador pronto ou ROMs na pasta</span></div><div class="tiles">${mine.map(x => tile(x, false)).join('')}</div>`;
  if (rest.length) h += `<div class="gh"><h3>${mine.length ? 'Outros consoles' : 'Consoles'} <em>${rest.length}</em></h3><span>${mine.length ? 'instale um emulador ou coloque ROMs e ele sobe para Meus consoles' : 'os mais usados primeiro'}</span></div><div class="tiles">${rest.map((x, i) => tile(x, mine.length > 0 || i >= 6)).join('')}</div>`;
  $('#view').innerHTML = h;
}
function emuStoreList() { const q = S.q.trim().toLowerCase(); return sortedAZ().filter(g => inEmu(g) && (!q || g._q.includes(q))); }
async function renderRomStore() {
  const srcs = S.repos.filter(r => r.kind === 'rom' && r.enabled);
  const scount = {}; let n = 0; for (const g of S.games) if (isRepoRom(g) && (!g.installed || S.jobs[g.key])) { n++; scount[g.system] = (scount[g.system] || 0) + 1; }
  const list = emuStoreList();
  const sys = Object.keys(scount).filter(k => k !== 'pc').sort((a, b) => (S.systems[a] || a).localeCompare(S.systems[b] || b));
  let h = `<div class="h1"><h2>Emuladores</h2><span>${srcs.length ? `${list.length} de ${n} ROMs · ${srcs.length} ${srcs.length === 1 ? 'fonte ligada' : 'fontes ligadas'}` : 'nenhuma fonte de ROMs ligada'}</span><div class="acts">`;
  if (!srcs.length) {
    h += `</div></div>${emuTabs()}${emptyHtml(I.gamepad, 'Nenhuma fonte de ROMs ligada', 'Fontes de emulação (acervos de ROMs por console) aparecem aqui quando ligadas em <b>Fontes</b>. Suas próprias ROMs vão direto para a Biblioteca pela aba Emuladores.', [['Abrir Fontes', "S.tab.store='sources';setView('store')", 1], ['Adicionar minha ROM', 'addRom()']])}`;
    $('#view').innerHTML = h; return;
  }
  h += `
      <div class="qmini ${S.q ? 'on' : ''}"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="qm" placeholder="Buscar ROM…" value="${esc(S.q)}" autocomplete="off" spellcheck="false" oninput="emuSearch(this.value)" onfocus="this.parentElement.classList.add('on')" onblur="if(!this.value)this.parentElement.classList.remove('on')"></div>
      <button class="btn s" onclick="S.tab.store='sources';setView('store')">${I.cog} Fontes</button></div></div>${emuTabs()}
    <div class="chips" style="position:static;margin:6px 0 14px;padding:0"><button class="chip dd ${S.emuSys ? 'on' : ''}" onclick="emuSysMenu(this)" title="Console">${I.gamepad}<span class="lbl">${esc(S.emuSys ? (S.systems[S.emuSys] || S.emuSys) : 'Todos os consoles')}</span><span class="n">${S.emuSys ? (scount[S.emuSys] || 0) : n}</span><svg class="car" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button></div>
    ${list.length ? '<div class="grid" id="grid"></div>' : `${S.q ? emptyHtml(I.search, 'Nenhuma ROM com esse nome', 'Tente outro termo ou outro console.', [['Limpar busca', 'clearSearch()', 1]]) : `<div class="empty" style="padding:24px 0"><b>Carregando as fontes…</b>As listas do archive.org chegam em alguns segundos.</div>`}`}`;
  $('#view').innerHTML = h;
  if (list.length) fillGrid(list);
}
function emuSysMenu(btn) {
  const scount = {}; let n = 0; for (const g of S.games) if (isRepoRom(g) && (!g.installed || S.jobs[g.key])) { n++; scount[g.system] = (scount[g.system] || 0) + 1; }
  const sys = Object.keys(scount).filter(k => k !== 'pc').sort((a, b) => (S.systems[a] || a).localeCompare(S.systems[b] || b));
  const pick = k => { S.emuSys = k; S.page = 1; renderEmulation(); };
  const items = [{ label: 'Todos os consoles', hint: String(n), icon: !S.emuSys ? 'check' : '', fn: () => pick('') }, { sep: true }];
  for (const k of sys) items.push({ label: S.systems[k] || k, hint: String(scount[k]), icon: S.emuSys === k ? 'check' : '', fn: () => pick(k) });
  const r = btn.getBoundingClientRect(); showCtx(items, r.left, r.bottom + 6, 'Console');
}
function romDestMenu(btn, sid) {
  const st = (S.emu && S.emu.systems || {})[sid] || {};
  const set = folder => api.post('/api/rom_dest', { system: sid, folder }).then(() => { toast('ok', 'Pasta de download', folder ? `ROMs de ${st.name || sid} vão para ${folder}` : `ROMs de ${st.name || sid} voltam para a pasta padrão`); renderEmulation(); });
  const items = [{ label: `Padrão: games${SEP()}${sid}`, icon: !st.dest ? 'check' : '', fn: () => set('') }];
  for (const d of (st.extra_dirs || [])) items.push({ label: d, icon: st.dest === d ? 'check' : '', fn: () => set(d) });
  if (S.config.native) items.push({ sep: true }, { label: 'Escolher outra pasta…', icon: 'folder', fn: async () => { const r = await api.post('/api/pick_path', { kind: 'folder', initial: st.dest || st.games_dir || '' }); if (r && r.path) set(r.path); } });
  const r = btn.getBoundingClientRect(); showCtx(items, r.left, r.bottom + 6, 'Baixar ROMs em');
}
let emuQt; function emuSearch(v) { clearTimeout(emuQt); emuQt = setTimeout(() => { S.q = v; S.page = 1; const st = $('#view').scrollTop; renderEmulation().then(() => { $('#view').scrollTop = st; const m = $('#qm'); if (m) { m.parentElement.classList.add('on'); m.focus(); m.setSelectionRange(v.length, v.length); } }); }, 160); }
async function emuGuide(sid, after) {
  const g = await api.get('/api/emulator/guide?system=' + enc(sid));
  if (g.error) return toast('info', 'Guia', g.error);
  const act = r => {
    if (!r.pick) return '';
    const btn = (pick, label) => `<button class="btn ${r.ok ? 's' : 'p'} sm" onclick="emuGuideInstall('${sid}','${r.id}','${pick}')">${label}</button>`;
    if (r.pick === 'any') return btn('file', 'Instalar (.zip)…') + ' ' + btn('folder', 'Instalar (pasta)…');
    return btn('file', `Instalar ${esc(r.label.split(' (')[0])}…`);
  };
  const reqs = g.reqs.map(r => `<div class="frow"><div class="l"><b>${r.ok ? '<span style="color:var(--green2)">✓</span>' : `<span style="color:var(--${r.optional ? 'muted' : 'amber'})">${r.optional ? '○' : '✗'}</span>`} ${esc(r.label)}${r.optional ? ' <span class="pill">opcional</span>' : ''}</b><span>${r.ok ? 'instalado' : r.optional ? 'não instalado' : 'falta'}${r.where ? `<br><code>${esc(r.where)}</code>` : ''}</span></div><div class="r">${act(r)}</div></div>`).join('');
  const steps = g.steps.map(t => `<li>${esc(t)}</li>`).join('');
  modal({ title: `Guia — ${esc(g.title)}`, wide: true, html: `<p style="margin:0 0 10px;font-size:12.5px;color:var(--muted)">${esc(g.intro)}${g.installed ? '' : ' <b>Instale ou aponte o emulador primeiro.</b>'}</p>
    ${reqs ? `<div class="diag" style="margin-bottom:10px">${reqs}</div>` : ''}<ol class="steps">${steps}</ol>
    <p class="mut" style="font-size:11.5px;margin:8px 0 0">Emulador: ${esc(g.emulator_title || '—')}${g.user_dir ? ` · pasta de dados: <code>${esc(g.user_dir)}</code>` : ''}</p>`,
    ok: 'Fechar', noCancel: true, onOk: () => { if (after) after(); else renderEmulation(); },
    buttons: [...(g.installed ? [{ label: 'Abrir emulador', fn: () => api.post('/api/emulator/open', { id: g.emulator }) }] : []), ...(g.user_dir ? [{ label: 'Abrir pasta de dados', fn: () => openPath(g.user_dir) }] : [])] });
}
async function emuGuideInstall(sid, what, pick) {
  const r = await api.post('/api/emulator/guide/install', { system: sid, what, pick });
  if (r.cancel) return;
  if (r.error) return toast('err', 'Não foi possível instalar', r.error);
  toast('ok', r.started ? 'Instalando' : 'Instalado', r.message || (r.copied ? pl(r.copied, 'arquivo copiado', 'arquivos copiados') : ''));
  emuGuide(sid);
}
async function sysEmus(sid) {
  const e = await api.get('/api/emulation'); S.emu = e; const s = e.systems[sid]; if (!s) return;
  const all = Object.values(e.emulators);
  const linked = new Set(s.options);
  const row = em => `<label class="impg ${em.id === s.emulator ? 'dup' : ''}" style="cursor:default"><input type="radio" name="sysDef" value="${em.id}" ${em.id === s.emulator ? 'checked' : ''} onchange="api.post('/api/emulator/select',{system:'${sid}',id:this.value})"><div class="t"><b>${esc(em.title)}${em.custom ? ' <span class="pill" style="font-size:10px;padding:1px 6px">meu</span>' : ''}</b><small>${em.installed ? esc(em.exe_path) : 'não instalado'}</small></div>${em.installed ? '<span class="pill ok">instalado</span>' : `${em.source !== 'manual' ? `<button class="btn s xs" onclick="installEmu('${em.id}')">${I.dl} Instalar</button>` : ''}<button class="btn s xs" title="Já tenho: apontar o .exe" onclick="pointEmuExe('${em.id}','${sid}')">${I.folder} .exe</button>`}${!(e.systems[sid].emulator === em.id && !em.custom && (em.systems || []).includes(sid)) && !((em.systems || []).includes(sid)) ? `<button class="btn d xs" title="Desvincular deste console" onclick="api.post('/api/emulator/remove_system',{system:'${sid}',id:'${em.id}'}).then(()=>sysEmus('${sid}'))">${I.x}</button>` : ''}</label>`;
  const others = all.filter(em => !linked.has(em.id));
  modal({ title: `Emuladores — ${s.name}`, wide: true, html: `<p style="color:var(--muted);font-size:12.5px;margin:0 0 8px">O marcado é o <b>padrão</b>. Se mais de um estiver instalado, na hora de jogar o Ludrix pergunta qual usar (é possível desligar isso em Ajustes → Biblioteca).</p>
    <div class="implist" style="max-height:40vh">${s.options.map(id => e.emulators[id]).filter(Boolean).map(row).join('')}</div>
    ${others.length ? `<div class="mrow" style="margin-top:10px"><select class="mi" id="seAdd">${others.map(em => `<option value="${em.id}">${esc(em.title)}${em.installed ? '' : ' (não instalado)'}</option>`).join('')}</select><button class="btn s sm" onclick="api.post('/api/emulator/add_system',{system:'${sid}',id:$('#seAdd').value}).then(()=>sysEmus('${sid}'))">+ Vincular</button><button class="btn s sm" onclick="$('#modal').classList.remove('on');addCustomEmu()">+ Meu .exe</button></div>` : ''}`,
    ok: 'Fechar', noCancel: true, onOk: () => renderEmulation() });
}
function chooseEmulator(key, opts, def, missing) {
  modal({ title: 'Jogar com qual emulador?', text: missing ? `O padrão do console (${missing}) não está instalado nem apontado — em Emuladores, use Instalar ou Apontar executável. Enquanto isso:` : 'Este console tem mais de um emulador instalado.', noOk: true, cancel: 'Cancelar', html: `<div class="askrow">${opts.map(o => `<button onclick="$('#modal').classList.remove('on');if($('#emuRem').checked)api.post('/api/game/emulator',{key:${jsq(key)},emulator:'${o.id}'});play(${jsq(key)}, S._after, '${o.id}')">${I.gamepad}<div><b>${esc(o.title)}</b><small>${o.id === def ? 'padrão deste console' : 'alternativo'}</small></div></button>`).join('')}</div>
    <label class="remember"><input type="checkbox" id="emuRem"> Lembrar só para este jogo (é possível trocar no menu do jogo → "Jogar com…")</label>
    <label class="remember"><input type="checkbox" onchange="setCfg({emu_no_ask:this.checked})"> Nunca perguntar — usar sempre o padrão do console</label>` });
  setTimeout(() => gpFocusFirst('.askrow button'), 50);
}
async function updateEmu(id) { const r = await api.post('/api/emulator/update', { id }); if (r.error) return toast('err', 'Não foi possível atualizar', r.error); S.jobs['emu:' + id] = { stage: 'download', fraction: 0, detail: 'Iniciando…' }; qfabSync(); renderEmulation(); pollSoon(); }
async function installEmu(id) { const r = await api.post('/api/emulator/install', { id }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); S.jobs['emu:' + id] = { stage: 'download', fraction: 0, detail: 'Iniciando…' }; qfabSync(); renderEmulation(); pollSoon(); }
async function romRootScan(folder) {
  if (!folder) {
    const r = await api.post('/api/choose_folder', { what: 'any' });
    if (r.native === false) return modal({ title: 'Varrer pasta de ROMs', text: 'Digite a pasta raiz (ex.: D:\\ROMs). Dentro dela, cada subpasta de console é reconhecida pelo nome ou pelas extensões.', input: '', ok: 'Varrer', onOk: v => { if (v) romRootScan(v); } });
    if (!r.folder) return;
    folder = r.folder;
  }
  const r = await api.post('/api/romroot/scan', { folder }); if (r.error) return toast('err', 'Varredura', r.error);
  const found = r.found || [];
  if (!found.length) return modal({ title: 'Nada reconhecido', text: `Não achei subpastas com ROMs em ${folder}. Dica: uma pasta por console (snes, ps1, gba…) ou arquivos com as extensões do console.`, ok: 'OK', noCancel: true });
  const sysOpts = Object.entries(S.systems).filter(([id]) => id !== 'pc').sort((a, b) => COLL.compare(a[1], b[1]));
  const rows = found.map((f, i) => `<label class="rrow ${f.already ? 'dim' : ''}"><input type="checkbox" data-i="${i}" ${f.already ? '' : 'checked'}><span class="mono" title="${esc(f.dir)}">${esc(f.dir.replace(folder, '').replace(/^[\\/]/, '') || f.dir)}</span><em>${f.count} ${f.count === 1 ? 'arquivo' : 'arquivos'}</em><select data-s="${i}">${sysOpts.map(([id, n]) => `<option value="${id}" ${id === f.system ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>${f.already ? '<i title="Já está na lista deste console">já mapeada</i>' : ''}</label>`).join('');
  modal({ title: `Pastas encontradas em ${folder.split(/[\\/]/).pop()}`, wide: true, html: `<p class="mut">Confira o console de cada pasta. As marcadas entram como pasta de ROMs do console e os jogos aparecem na Biblioteca.</p><div class="rrows">${rows}</div>`, ok: 'Adicionar marcadas', onOk: async () => {
    const box = $('#modalBox'); const items = [...box.querySelectorAll('input[data-i]:checked')].map(c => { const i = +c.dataset.i; return { system: box.querySelector(`select[data-s="${i}"]`).value, dir: found[i].dir }; });
    if (!items.length) return;
    const x = await api.post('/api/romroot/apply', { items }); if (x.error) return toast('err', 'Varredura', x.error);
    toast('ok', 'Pastas adicionadas', pl(x.added, 'pasta de ROMs mapeada', 'pastas de ROMs mapeadas') + ' — os jogos entram na Biblioteca em instantes'); renderEmulation(); setTimeout(() => loadCatalog(false), 1500);
  } });
}
async function addRomDir(sid) {
  const r = await api.post('/api/choose_folder', { what: 'rom_dir', system: sid });
  if (r.native) { if (r.folder) { toast('ok', 'Pasta adicionada', r.folder); renderEmulation(); loadCatalog(false); } return; }
  modal({ title: 'Pasta de ROMs — ' + (S.systems[sid] || sid), input: '', ok: 'Adicionar', onOk: async v => { if (!v) return; await api.post('/api/romdir/add', { system: sid, folder: v }); renderEmulation(); loadCatalog(false); } });
}
async function addCustomEmu(prefill) {
  const e = S.emu || await api.get('/api/emulation');
  const sysList = Object.values(e.systems); const presets = Object.values(e.emulators).filter(x => !x.custom);
  let exe = prefill || '';
  modal({ title: 'Meu próprio emulador', text: 'Use um fork ou build que você já tem. O launcher só precisa saber o .exe, qual console ele roda e como passar a ROM.',
    html: `<label class="ml">Executável</label><div class="mrow"><input class="mi" id="ceExe" value="${esc(exe)}" placeholder="C:\\Emuladores\\pcsx2-fork\\pcsx2-qt.exe"><button class="btn s sm" onclick="pickExeInto('ceExe')">Procurar…</button></div>
      <label class="ml">Nome</label><input class="mi" id="ceTitle" placeholder="PCSX2 Nightly">
      <label class="ml">Baseado em (herda os argumentos de linha de comando)</label><select class="mi" id="ceBase"><option value="">— nenhum / genérico —</option>${presets.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select>
      <label class="ml">Consoles</label><div class="mchk" id="ceSys">${sysList.map(s => `<label><input type="checkbox" value="${s.id}" onchange="this.parentElement.classList.toggle('on',this.checked)">${esc(s.name)}</label>`).join('')}</div>
      <label class="ml">Argumentos (opcional — use {rom} no lugar do arquivo)</label><input class="mi" id="ceArgs" placeholder="-fullscreen {rom}">`,
    ok: 'Aplicar', onOk: async () => {
      const systems = [...document.querySelectorAll('#ceSys input:checked')].map(i => i.value);
      const body = { exe: $('#ceExe').value.trim(), title: $('#ceTitle').value.trim(), based_on: $('#ceBase').value, systems, args: $('#ceArgs').value.trim() };
      if (!body.exe) { toast('err', 'Falta o executável', ''); return false; }
      if (!systems.length) { toast('err', 'Escolha pelo menos um console', ''); return false; }
      const r = await api.post('/api/emulator/custom/add', body); if (r.error) { toast('err', 'Não foi possível concluir', r.error); return false; }
      toast('ok', 'Emulador configurado', r.title + ' → ' + systems.join(', ')); renderEmulation();
    } });
  $('#ceBase').onchange = function () { const p = presets.find(x => x.id === this.value); if (p && !$('#ceTitle').value) $('#ceTitle').value = p.title + ' (meu)'; if (p) { document.querySelectorAll('#ceSys input').forEach(i => { i.checked = p.systems.includes(i.value); i.parentElement.classList.toggle('on', i.checked); }); } };
}
async function pointEmuExe(id, sid) {
  const r = await api.post('/api/pick_exe', {});
  const apply = async exe => { const x = await api.post('/api/emulator/exe', { id, exe }); if (x && x.error) return toast('err', 'Não foi possível concluir', x.error); if (sid) await api.post('/api/emulator/add_system', { system: sid, id }); toast('ok', 'Emulador apontado', exe); sid ? sysEmus(sid) : renderEmulation(); };
  if (r.native) { if (r.file) apply(r.file); return; }
  modal({ title: 'Caminho do .exe do emulador', input: '', ok: 'Usar', onOk: v => { if (v) apply(v); } });
}
async function pickExeInto(id) { const r = await api.post('/api/pick_exe', {}); if (r.native && r.file) $('#' + id).value = r.file; else if (!r.native) toast('', 'Modo navegador', 'Digite o caminho manualmente'); }
function removeCustomEmu(id) { modal({ title: 'Remover este emulador da lista?', text: 'Nada é apagado do disco — só a configuração no launcher.', ok: 'Remover', danger: true, onOk: async () => { await api.post('/api/emulator/custom/remove', { id }); renderEmulation(); } }); }
function removeEmu(id) { modal({ title: 'Remover emulador?', text: 'A pasta do emulador (e suas configurações) será apagada. Suas ROMs ficam intactas.', ok: 'Remover', danger: true, onOk: async () => { await api.post('/api/emulator/remove', { id }); renderEmulation(); } }); }

async function renderDownloads() {
  const q = await api.get('/api/queue').catch(() => ({ items: [], active: 0 })); if (S.view !== 'downloads') return;
  const items = q.items || [], running = items.filter(i => i.status === 'running'), rest = items.filter(i => i.status !== 'running');
  const paused = rest.filter(i => i.status === 'paused'), failed = rest.filter(i => i.status === 'error'), done = rest.filter(i => i.status !== 'paused' && i.status !== 'error');
  const ST = { running: ['Baixando', 'run'], done: ['Concluído', 'ok'], error: ['Falhou', 'err'], cancelled: ['Cancelado', ''], paused: ['Pausado', 'warn'] };
  const KIND = { install: 'Jogo', emulator: 'Emulador', tool: 'Ferramenta', redist: 'Dependência', optional: 'Programa', update: 'Atualização', flash: 'Jogo rápido' };
  const when = t => { if (!t) return ''; const d = new Date(t * 1000), now = new Date(); const hm = d.toTimeString().slice(0, 5); return d.toDateString() === now.toDateString() ? `hoje ${hm}` : `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')} ${hm}`; };
  const row = i => {
    const g = S.byKey[i.key], [lbl, cls] = ST[i.status] || [i.status, ''];
    const acts = i.status === 'running'
      ? `<button class="btn s xs" onclick="qAct('pause',${jsq(i.key)})" title="Para e guarda o parcial para retomar">Pausar</button><button class="btn d xs" onclick="qAct('stop',${jsq(i.key)})" title="Cancela e apaga o parcial">Parar</button>`
      : `${i.can_retry ? `<button class="btn p xs" onclick="qAct('retry',${jsq(i.key)})">${i.status === 'paused' ? 'Retomar' : 'Tentar de novo'}</button>` : ''}${i.dir ? `<button class="btn s xs" onclick="openPath(${jsq(i.dir)})">${I.folder} Pasta</button>` : ''}${g && i.installed ? `<button class="btn s xs" onclick="openGame(${jsq(i.key)})">Abrir</button>` : ''}<button class="btn s xs" onclick="qAct('remove',${jsq(i.key)})" title="Tira da lista">✕</button>`;
    return `<div class="item q ${cls}"><div class="ic">${g ? `<img src="/thumb/${enc(i.key)}" onerror="this.remove()">` : I.dl}</div><div class="tx"><b>${esc(i.title)}</b><span><em class="qst ${cls}">${lbl}</em> · ${KIND[i.kind] || i.kind} · ${when(i.at)}${i.message ? ` · ${esc(i.message)}` : ''}</span>${i.job ? progHtml(i.job, i.key) : ''}</div><div class="qa">${acts}</div></div>`;
  };
  let h = `<div class="h1"><h2>Fila</h2><span>${running.length ? `${running.length} em andamento` : 'nada baixando agora'}${rest.length ? ` · ${rest.length} no histórico` : ''}</span><div class="acts"><button class="btn p xs" onclick="linkDownload()">${I.dl} Baixar de link</button>${running.length ? `<button class="btn s xs" onclick="qAct('pause_all')" title="Pausa tudo guardando o parcial para retomar">Pausar tudo</button><button class="btn s xs" onclick="qAct('clear_all')">Parar tudo</button>` : ''}${paused.length ? `<button class="btn s xs" onclick="qAct('resume_all')">Retomar tudo</button>` : ''}${rest.length ? `<button class="btn s xs" onclick="qAct('clear')">Limpar histórico</button>` : ''}<label class="afterq" title="O que fazer quando todos os downloads terminarem"><span>Ao terminar</span><select onchange="afterQueueSet(this)">${AFTER_Q.map(([v, n]) => `<option value="${v}" ${(S.config.after_queue || 'none') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label><button class="btn s xs ic" onclick="openPath(${jsq(S.config.downloads_dir || 'downloads')})" title="Abrir a pasta downloads">${I.folder}</button></div></div>`;
  const sec = (title, sub, list, extra) => list.length ? `<div class="gh qh"><h3>${title} <em>${list.length}</em></h3><span>${sub}</span>${extra || ''}</div><div class="list">${list.map(row).join('')}</div>` : '';
  if (!items.length) h += emptyHtml(I.dl, 'Nada por aqui', 'Jogos, emuladores, ferramentas e dependências que você baixar aparecem nesta lista, com pausa, retomada e histórico. Tem um link do Google Drive, MEGA, Gofile, MediaFire ou Pixeldrain? <b>Baixar de link</b> traz o arquivo, extrai e adiciona à Biblioteca.', [['Baixar de link', 'linkDownload()', 1], ['Ir para a Store', "setView('store')"]]);
  else h += `<div class="qsecs">${sec('Agora', running.length ? 'em andamento' : 'nada baixando', running)}${sec('Pausados', 'retome quando quiser', paused)}${sec('Precisam de atenção', 'não terminaram — tente de novo ou remova', failed)}${sec('Concluídos', 'histórico do que já passou por aqui', done, `<button class="btn s xs" onclick="qAct('clear_done')">Limpar concluídos</button>`)}</div>`;
  $('#view').innerHTML = h;
}
function linkDownload(preset) {
  const sysOpts = Object.entries(S.systems).filter(([id]) => id !== 'pc').map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('');
  modal({ title: 'Baixar de link', wide: true, ok: 'Baixar', wait: true,
    html: `<p style="margin:0 0 4px">Cole o link do arquivo. Sei ler <b>Google Drive, MEGA (arquivo e pasta), Gofile, MediaFire, Pixeldrain, 1fichier, Dropbox, buzzheavier, qiwi</b> e qualquer link direto. O arquivo vai para <span class="code">downloads${SEP()}</span>, extraio e adiciono na biblioteca.</p>
      <div class="mrow"><input class="mi" id="lkUrl" placeholder="https://…" value="${esc(preset || '')}" spellcheck="false"><button class="btn s sm" id="lkGo" style="margin-top:10px">Ler link</button></div>
      <div id="lkBox"></div>
      <label class="ml">Nome do jogo</label><input class="mi" id="lkTitle" placeholder="detectado ao ler o link">
      <div class="mrow" style="margin-top:10px"><select class="mi" id="lkKind" style="margin:0;flex:1"><option value="pc">Jogo de PC (extrai e procura o .exe)</option><option value="rom">ROM / jogo de console</option></select><select class="mi" id="lkSys" style="margin:0;flex:1;display:none">${sysOpts}</select></div>`,
    onOk: async () => {
      const url = $('#lkUrl').value.trim(), title = $('#lkTitle').value.trim(); if (!url) { $('#lkUrl').focus(); return false; }
      const kind = $('#lkKind').value, system = kind === 'rom' ? $('#lkSys').value : 'pc';
      const picks = [...document.querySelectorAll('#lkBox input[data-i]')].filter(c => !c.checked).length ? [...document.querySelectorAll('#lkBox input[data-i]:checked')].map(c => +c.dataset.i) : null;
      const r = await api.post('/api/link/download', { url, title, kind, system, picks }, { timeout: 60000 });
      if (r.error) { toast('err', 'Não foi possível concluir', r.error); return false; }
      toast('ok', 'Na fila', (title || 'Download') + ' — acompanhe em Fila'); if (S.view === 'downloads') renderDownloads();
    } });
  $('#lkKind').onchange = e => { $('#lkSys').style.display = e.target.value === 'rom' ? '' : 'none'; };
  const read = async () => {
    const url = $('#lkUrl').value.trim(); if (!url) return; const box = $('#lkBox');
    box.innerHTML = '<div class="empty" style="padding:14px 0"><b>Lendo o link…</b>perguntando ao site quais arquivos tem aí</div>';
    const r = await api.post('/api/link/preview', { url }, { timeout: 90000 });
    if (r.error) { box.innerHTML = `<div class="empty" style="padding:14px 0"><b>Não foi possível ler</b>${esc(r.error)}<br><button class="btn s xs" style="margin-top:8px" onclick="api.post('/api/open_url',{url:${jsq(url)}})">${I.ext} Abrir no navegador</button></div>`; return; }
    if (!$('#lkTitle').value) $('#lkTitle').value = r.title || '';
    const many = r.files.length > 1;
    box.innerHTML = `<div class="pgsum" style="margin-top:10px"><span><b>${esc(r.host)}</b></span><span><b>${r.files.length}</b> arquivo${many ? 's' : ''}</span><span><b>${fmt(r.total) || '?'}</b> no total</span>${r.hint ? `<span>${esc(r.hint)}</span>` : ''}</div>
      <div class="pglist" style="max-height:180px">${r.files.map(f => `<label class="pgrow" style="cursor:pointer;justify-content:flex-start"><input type="checkbox" data-i="${f.i}" checked style="margin:0 8px 0 0"><b title="${esc(f.name)}" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</b><span style="color:var(--muted)">${fmt(f.size) || ''}</span></label>`).join('')}</div>`;
  };
  $('#lkGo').onclick = read; $('#lkUrl').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); read(); } };
  $('#lkUrl').onpaste = () => setTimeout(read, 50);
  setTimeout(() => { $('#lkUrl').focus(); if (preset) read(); }, 30);
}
const AFTER_Q = [['none', 'Nada'], ['quit', 'Fechar o Ludrix'], ['sleep', 'Suspender o PC'], ['shutdown', 'Desligar o PC']];
function afterQueueSync(st) {
  const cur = $('#afterq');
  if (!st) { if (cur) cur.remove(); S._afterQ = null; return; }
  if (cur && S._afterQ && S._afterQ.at === st.at) return;
  S._afterQ = st; if (cur) cur.remove();
  const lbl = (AFTER_Q.find(x => x[0] === st.action) || [])[1] || st.action;
  const t = document.createElement('div'); t.className = 'toast warn act'; t.id = 'afterq';
  t.innerHTML = `<div><b>Fila terminou</b><span>${esc(lbl)} em <em id="afterqN">60</em> s</span><div class="ta"><button class="btn p xs">Cancelar</button><button class="btn s xs">Agora</button></div></div>`;
  const [bc, bn] = t.querySelectorAll('button');
  bc.onclick = () => { api.post('/api/queue/action', { action: 'after_cancel' }); t.remove(); S._afterQ = null; toast('', 'Cancelado', 'Nada vai acontecer ao terminar'); };
  bn.onclick = () => { api.post('/api/queue/action', { action: 'after_now' }); t.remove(); };
  $('#toasts').appendChild(t); uiSound('notify');
  const tick = () => { if (!document.contains(t)) return; const left = Math.max(0, Math.round(st.at - Date.now() / 1000)); const n = t.querySelector('#afterqN'); if (n) n.textContent = left; if (left > 0) setTimeout(tick, 1000); };
  tick();
}
function afterQueueSet(sel) { const v = sel.value, lbl = (AFTER_Q.find(x => x[0] === v) || [])[1] || v; setCfg({ after_queue: v }).then(() => { if (v !== 'none') toast('', 'Combinado', `${lbl} quando a fila terminar (dá para cancelar no aviso)`); }); }
async function qAct(action, key) {
  if (action === 'pause_all') { const r = await api.post('/api/queue/action', { action }); toast('', 'Pausado', r.n ? pl(r.n, 'download guardado para retomar', 'downloads guardados para retomar') : 'Nada em andamento'); setTimeout(renderDownloads, 400); return; }
  if (action === 'resume_all') { toast('', 'Retomando', 'Os downloads pausados voltam para a fila'); const r = await api.post('/api/queue/action', { action }); if (r && r.error) toast('err', 'Fila', r.error); setTimeout(renderDownloads, 600); return; }
  if (action === 'clear_all') { modal({ title: 'Parar tudo', text: 'Parar todos os downloads em andamento? Os parciais serão apagados.', ok: 'Parar tudo', danger: true, onOk: () => qAct('_clear_all') }); return; }
  if (action === '_clear_all') action = 'clear_all';
  const r = await api.post('/api/queue/action', { action, key }); if (r && r.error) toast('err', 'Fila', r.error);
  setTimeout(renderDownloads, action === 'retry' ? 500 : 150);
}

const HUE_ORDER = ['Vermelho', 'Laranja', 'Amarelo', 'Verde', 'Ciano', 'Azul', 'Roxo', 'Rosa', 'Neutro'];
function themeHue(t) {
  const m = /^#?([0-9a-f]{6})$/i.exec(t.accent || ''); if (!m) return 'Neutro';
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 0.12 || mx < 0.2) return 'Neutro';
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360;
  return h < 15 || h >= 335 ? 'Vermelho' : h < 42 ? 'Laranja' : h < 70 ? 'Amarelo' : h < 160 ? 'Verde' : h < 200 ? 'Ciano' : h < 255 ? 'Azul' : h < 290 ? 'Roxo' : 'Rosa';
}
const CAT_WORDS = [['Consoles', /console|xbox|playstation|ps5|ps6|nintendo|portatil|handheld/], ['Sistemas', /distro|linux|windows|macos|kde|gnome|sistema/], ['Vidro e brilho', /aero|vidro|glass|brilho|fluent|acrilico/], ['Neon', /neon|cyber|synth|arcade/], ['Retrô', /retro|classico|terminal|pixel|vintage/], ['Natureza', /natureza|floresta|mar|oceano|ceu|montanha|flor|verde|terroso/], ['Minimalistas', /minimal|grade|limpo|flat|mono/]];
function themeCat(t) { if (t.category) return t.category; const txt = ((t.tags || []).join(' ') + ' ' + (t.description || '')).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); for (const [c, re] of CAT_WORDS) if (re.test(txt)) return c; return 'Outros'; }
function themesHtml(c) {
  return `
  <div class="sec"><h3>Tema</h3>
    <div class="frow"><div class="l"><b>Claro ou escuro</b><span><b style="display:inline;font-size:12px">Sistema</b> acompanha o ${OSN()}</span></div>
      ${cfgSel('theme', [['system', 'Sistema'], ['dark', 'Escuro'], ['light', 'Claro']], c.theme || 'system')}</div>
    ${(c.theme || 'system') === 'system' ? `<div class="frow"><div class="l"><b>Quando "Sistema"</b><span>Seguir o ${OSN()} troca junto com o modo claro/escuro dele; por horário usa as horas abaixo</span></div>
      ${cfgSel('theme_schedule', [[false, 'Seguir o ' + OSN()], [true, 'Por horário']], !!c.theme_schedule)}${c.theme_schedule ? `<span class="mut">claro das</span><input class="mi" style="width:70px" value="${esc(c.theme_light_from || '07:00')}" onchange="setCfg({theme_light_from:this.value})"><span class="mut">às</span><input class="mi" style="width:70px" value="${esc(c.theme_light_to || '19:00')}" onchange="setCfg({theme_light_to:this.value})">` : ''}</div>` : ''}
    ${themeListHtml(c)}
  </div>`;
}
function themeListHtml(c) {
  const list = (S.themes || []).filter(t => t.id && t.id.startsWith('file:')), cur = c.theme || 'system', usingFile = cur.startsWith('file:');
  const card = t => { const on = cur === t.id; return `<div class="thcard${on ? ' on' : ''}" data-tid="${esc(t.id)}" oncontextmenu="event.preventDefault();themeMenu(${jsq(t.id)},event.clientX,event.clientY)" onclick="${on ? '' : `pickTheme(${jsq(t.id)})`}" title="${esc(t.description || t.name)}"><i class="thsw" style="${themeSwatch(t)}"></i><div class="tht"><b>${esc(t.name)}</b><small>${t.scheme === 'light' ? 'Claro' : 'Escuro'}${t.author ? ' · ' + esc(t.author) : ''}</small></div>${on ? `<span class="pill ok">Em uso</span>` : ''}<button class="ib" title="Opções" onclick="event.stopPropagation();themeMenu(${jsq(t.id)},this.getBoundingClientRect().left,this.getBoundingClientRect().bottom+4)">${I.dots}</button></div>`; };
  return `<div class="frow" style="align-items:flex-start;flex-direction:column;gap:10px"><div class="l" style="width:100%;display:flex;flex-direction:row;align-items:center;gap:10px"><div style="flex:1;min-width:0"><b>Temas instalados</b><span>Arquivos <b style="display:inline;font-size:12px">.lxtheme</b> ou .zip de tema trazem cores e desenho próprios. Botão direito num tema: exportar ou apagar.</span></div><div style="display:flex;gap:6px;flex:none;align-items:center">${list.length ? `<button class="btn s xs" onclick="themeDeleteAll()">${I.trash}<span>Apagar todos</span></button>` : ''}<button class="btn s xs" onclick="themeImport()">${I.dl}<span>Importar</span></button>${usingFile ? `<button class="btn s xs" onclick="pickTheme('dark')">Voltar ao padrão</button>` : ''}</div></div>
    ${list.length ? `<div class="thlist">${list.map(card).join('')}</div>` : `<div class="mut" style="font-size:12px">Nenhum tema importado. Os temas ficam na pasta <b style="display:inline">themes</b> do Ludrix.</div>`}</div>`;
}
function themeSwatch(t) {
  const v = t.vars || {}, bg = toHex(v.bg) || (t.scheme === 'light' ? '#f4f4f6' : '#141418'), card = toHex(v.card) || toHex(v.bg2) || (t.scheme === 'light' ? '#ffffff' : '#1e1e23'), acc = toHex(v.accent) || toHex(t.accent) || '#4f8df7';
  return `background:linear-gradient(90deg,${bg} 0 50%,${card} 50% 100%);box-shadow:inset 0 0 0 1px rgba(128,128,128,.25);--thacc:${acc}`;
}
function selHtml(opts, cur, on, cls) { return `<select class="sel ${cls || ''}" onchange="${on}">${opts.map(([v, l]) => `<option value="${esc(JSON.stringify(v))}" ${v === cur ? 'selected' : ''}>${esc(String(l))}</option>`).join('')}</select>`; }
function cfgSel(key, opts, cur, after) { return selHtml(opts, cur, `setCfg({${key}:JSON.parse(this.value)})${after || ''}`); }
function settingsTab(id, jump) { S.tab.settings = id; if (jump) S._settingsJump = jump; renderSettings(); }
async function cset(patch) { const r = await api.post('/api/custom/set', patch); if (r.error) return toast('err', 'Personalizar', r.error); S.custom = r; applyCustom(); if (S.view === 'settings' && S.tab.settings === 'custom') renderSettings(); }
async function cpick(what, path) { if (!path && !S.config.native) return modal({ title: 'Imagem', text: 'Caminho completo do arquivo de imagem:', input: '', ok: 'Usar', onOk: v => v && cpick(what, v) }); const r = await api.post(path ? '/api/custom/add' : '/api/custom/pick', path ? { what, path } : { what }); if (r.error) return toast('err', 'Personalizar', r.error); if (r.cancel) return; S.custom = r; applyCustom(); renderSettings(); }
async function cremove(what, name) { const r = await api.post('/api/custom/remove', { what, name }); if (r.error) return toast('err', 'Personalizar', r.error); S.custom = r; applyCustom(); renderSettings(); }
function creset() { modal({ title: 'Redefinir o Personalizar?', text: 'Volta tudo ao que o tema define. Suas imagens de fundo e ícones enviados continuam na pasta data\\custom.', ok: 'Redefinir', danger: true, onOk: async () => { const r = await api.post('/api/custom/reset', {}); S.custom = r; applyCustom(); renderSettings(); } }); }
function cexport() { modal({ title: 'Exportar como tema', text: 'Nome do tema. O arquivo .lxtheme vai para a pasta themes\\exportados e pode ser importado em qualquer Ludrix.', input: 'Meu tema', ok: 'Exportar', onOk: async name => { if (!name) return false; const r = await api.post('/api/custom/export', { name }); if (r.error) return toast('err', 'Exportar', r.error); toast('ok', 'Tema exportado', r.path, [{ label: 'Abrir pasta', fn: () => openPath(r.path.replace(/[\\/][^\\/]*$/, '')) }]); } }); }
let customV = 0;
function applyCustom() {
  const l = $('#customLink'); if (l) l.href = '/api/custom.css?v=' + (++customV);
  applyAnim();
}
const GRAD_PRESETS = [['off', 'Nenhum'], ['accent', 'Da cor de destaque'], ['aurora', 'Aurora'], ['crepusculo', 'Crepúsculo'], ['oceano', 'Oceano'], ['brasa', 'Brasa'], ['floresta', 'Floresta'], ['neblina', 'Neblina'], ['uva', 'Uva'], ['custom', 'Minhas cores']];
const GRAD_COLORS = { aurora: ['#6d28d9', '#0ea5e9', '#10b981'], crepusculo: ['#f97316', '#db2777', '#312e81'], oceano: ['#0c4a6e', '#0369a1', '#22d3ee'], brasa: ['#7f1d1d', '#ea580c', '#facc15'], floresta: ['#052e16', '#15803d', '#a3e635'], neblina: ['#1e293b', '#64748b', '#cbd5e1'], uva: ['#3b0764', '#a21caf', '#f472b6'] };
function gradPreview(gr) {
  const acc = cssVar('--accent'), cols = gr.preset === 'accent' ? [acc, `color-mix(in srgb,${acc} 45%,var(--bg))`, `color-mix(in srgb,${acc} 20%,var(--bg))`] : gr.preset === 'custom' ? [gr.c1, gr.c2, `color-mix(in srgb,${gr.c1} 50%,${gr.c2})`] : GRAD_COLORS[gr.preset] || ['#333', '#666', '#999'];
  const [a, b, c] = cols, ang = gr.angle ?? 160, sh = gr.shape || 'mesh';
  const bg = sh === 'linear' ? `linear-gradient(${ang}deg,${a} 0%,${b} 55%,${c} 100%)` : sh === 'radial' ? `radial-gradient(120% 90% at 85% 0%,${a} 0%,${b} 45%,transparent 80%),radial-gradient(90% 70% at 0% 100%,${c} 0%,transparent 70%)` : `radial-gradient(60% 55% at 15% 12%,${a} 0%,transparent 70%),radial-gradient(55% 60% at 85% 25%,${b} 0%,transparent 70%),radial-gradient(70% 60% at 50% 100%,${c} 0%,transparent 70%),linear-gradient(${ang}deg,${a},${b})`;
  return `background:${bg};opacity:${(gr.opacity ?? 55) / 100}`;
}
function customHtml(k) {
  const on = !!k.on, fx = k.fx || {}, nav = k.nav || {}, win = k.window || {}, cards = k.cards || {}, cols = k.colors || {}, gr = k.gradient || {};
  const dis = on ? '' : 'style="opacity:.45;pointer-events:none"';
  const seg = (path, opts, cur) => { const m = opts.map(([v, l]) => [setPath(path, v), l]), c = m[Math.max(0, opts.findIndex(([v]) => v === cur))][0]; return selHtml(m, c, 'cset(JSON.parse(this.value))'); };
  const range = (path, min, max, step, cur, f) => `<label class="zoom" style="flex:1;max-width:320px"><input type="range" min="${min}" max="${max}" step="${step}" value="${cur}" oninput="this.nextElementSibling.textContent=CFMT.${f || 'n'}(this.value)" onchange="cset(setPath('${path}',+this.value))"><b style="min-width:48px;text-align:right;font-size:12px">${CFMT[f || 'n'](cur)}</b></label>`;
  const color = (key, label, hint) => `<div class="frow"><div class="l"><b>${label}</b><span>${hint}</span></div><div style="display:flex;gap:6px;align-items:center"><input type="color" value="${cols[key] || cssVar('--' + key)}" onchange="cset({colors:{${key}:this.value}})" title="Escolher"><button class="btn s xs" ${cols[key] ? '' : 'disabled'} onclick="cset({colors:{${key}:''}})" title="Voltar à cor do tema">${I.x}</button></div></div>`;
  const icons = (fx.icons || []).map(n => `<div class="fxic"><img src="/api/custom/file/fx/${enc(n)}" alt=""><button onclick="cremove('fx',${jsq(n)})" title="Remover">${I.x}</button></div>`).join('');
  return `
  <div class="sec"><h3>Personalizar</h3><p>Cada detalhe do visual, por cima de qualquer tema ou aparência. O que você não mexer continua vindo do tema. Dá para exportar o resultado como um tema <b>.lxtheme</b> e levar para outro PC.</p>
    <div class="frow"><div class="l"><b>Personalização ativa</b><span>Desligada, o Ludrix mostra só o tema; seus ajustes ficam guardados</span></div><button class="sw ${on ? 'on' : ''}" onclick="cset({on:${!on}})"></button></div>
    <div class="frow"><div class="l"><b>Guardar e compartilhar</b><span>Exporta cores, fundo, ícones da animação e ajustes como um tema</span></div><div class="ta"><button class="btn s sm" onclick="cexport()">${I.dl} Exportar como tema</button><button class="btn d sm" onclick="creset()">${I.trash} Redefinir</button></div></div>
  </div>
  <div ${dis}>
  <div class="sec"><h3>Cores</h3><p>Fundo, painéis, cartões e textos. A cor de destaque (botões e seleção) fica em Aparência, junto dos temas.</p>
    <div class="grid2">${color('bg', 'Fundo', 'A base de tudo')}${color('bg2', 'Painéis', 'Seções e caixas')}${color('panel', 'Barra de navegação', 'Menu principal')}${color('card', 'Cartões', 'Fundo das capas e listas')}${color('text', 'Texto', 'Títulos e textos')}${color('muted', 'Texto secundário', 'Legendas e dicas')}${color('line', 'Linhas', 'Bordas e divisões')}</div>
  </div>
  <div class="sec"><h3>Transparência</h3>
    <div class="frow"><div class="l"><b>Opacidade dos painéis</b><span>Menos = mais transparente; deixa o fundo e a animação aparecerem através das caixas</span></div>${range('alpha', 20, 100, 5, k.alpha ?? 100, 'pct')}</div>
    <div class="frow"><div class="l"><b>Desfoque atrás dos painéis</b><span>Efeito de vidro. 0 usa o padrão</span></div>${range('blur', 0, 30, 1, k.blur ?? 0, 'px')}</div>
  </div>
  <div class="sec"><h3>Fundo</h3>
    <div class="frow"><div class="l"><b>Imagem de fundo</b><span>PNG, JPG ou WEBP. O Ludrix reduz para até 1920 px e guarda em data\\custom</span></div><div class="ta">${k.wallpaper ? `<img src="/api/custom/file/${enc(k.wallpaper)}" style="height:40px;width:70px;object-fit:cover;border-radius:6px;border:1px solid var(--line)">` : ''}<button class="btn s sm" onclick="cpick('wallpaper')">${I.image} Escolher imagem</button>${k.wallpaper ? `<button class="btn s sm" onclick="cremove('wallpaper')">${I.x}</button>` : ''}</div></div>
    ${k.wallpaper ? `<div class="frow"><div class="l"><b>Opacidade</b></div>${range('wallpaper_opacity', 5, 100, 5, k.wallpaper_opacity ?? 35, 'pct')}</div>
    <div class="frow"><div class="l"><b>Desfoque</b></div>${range('wallpaper_blur', 0, 40, 1, k.wallpaper_blur ?? 0, 'px')}</div>
    <div class="frow"><div class="l"><b>Escurecer</b><span>Ajuda a ler o texto sobre fotos claras</span></div>${range('wallpaper_dim', 0, 90, 5, k.wallpaper_dim ?? 0, 'pct')}</div>` : ''}
    <div class="frow"><div class="l"><b>Degradê gerado</b><span>Um fundo de cores suaves criado na hora, sem precisar de imagem. Fica atrás da imagem de fundo, se houver</span></div>${seg('gradient.preset', GRAD_PRESETS, gr.preset || 'off')}</div>
    ${gr.preset && gr.preset !== 'off' ? `<div class="gprev" style="${gradPreview(gr)}"></div>
    <div class="frow"><div class="l"><b>Forma</b><span>Manchas espalha as cores; Linear e Radial seguem uma direção</span></div>${seg('gradient.shape', [['mesh', 'Manchas'], ['linear', 'Linear'], ['radial', 'Radial']], gr.shape || 'mesh')}</div>
    ${gr.preset === 'custom' ? `<div class="frow"><div class="l"><b>Cores</b><span>As duas pontas do degradê</span></div><div style="display:flex;gap:6px;align-items:center"><input type="color" value="${gr.c1 || '#6d28d9'}" onchange="cset({gradient:{c1:this.value}})"><input type="color" value="${gr.c2 || '#0ea5e9'}" onchange="cset({gradient:{c2:this.value}})"></div></div>` : ''}
    ${gr.shape !== 'radial' ? `<div class="frow"><div class="l"><b>Direção</b></div>${range('gradient.angle', 0, 360, 5, gr.angle ?? 160, 'deg')}</div>` : ''}
    <div class="frow"><div class="l"><b>Intensidade</b><span>Menos = mais discreto</span></div>${range('gradient.opacity', 5, 100, 5, gr.opacity ?? 55, 'pct')}</div>` : ''}
  </div>
  <div class="sec"><h3>Animação de fundo</h3><p>Os elementos que flutuam atrás de tudo. Use os do tema, os seus próprios ícones em PNG ou desligue.</p>
    <div class="frow"><div class="l"><b>O que flutua</b></div>${seg('fx.mode', [['theme', 'Do tema'], ['icons', 'Meus ícones'], ['off', 'Desligada']], fx.mode || 'theme')}</div>
    ${fx.mode === 'icons' ? `<div class="frow" style="align-items:flex-start"><div class="l"><b>Meus ícones</b><span>PNG pequenos com fundo transparente, 64×64 é o ideal (o Ludrix reduz até 128 px). Até 24 ícones; eles se revezam na tela</span></div><div class="fxics">${icons}<button class="fxic add" onclick="cpick('fx')" title="Adicionar PNG">${I.plus}</button></div></div>
    <div class="frow"><div class="l"><b>Quantidade</b><span>0 esconde, 24 enche a tela</span></div>${range('fx.count', 0, 24, 1, fx.count ?? 10)}</div>
    <div class="frow"><div class="l"><b>Velocidade</b></div>${range('fx.speed', 0.3, 3, 0.1, fx.speed ?? 1, 'x')}</div>
    <div class="frow"><div class="l"><b>Tamanho</b></div>${range('fx.size', 16, 160, 4, fx.size ?? 56, 'px')}</div>
    <div class="frow"><div class="l"><b>Opacidade</b></div>${range('fx.opacity', 5, 100, 5, fx.opacity ?? 45, 'pct')}</div>
    <div class="frow"><div class="l"><b>Direção</b></div>${seg('fx.direction', [['up', 'Sobem'], ['down', 'Caem'], ['left', 'Para a esquerda'], ['right', 'Para a direita'], ['drift', 'À deriva']], fx.direction || 'up')}</div>
    <div class="frow"><div class="l"><b>Girar</b><span>Os ícones rodam devagar enquanto se movem</span></div><button class="sw ${fx.spin !== false ? 'on' : ''}" onclick="cset({fx:{spin:${fx.spin === false}}})"></button></div>
    <div class="frow"><div class="l"><b>Pixel art</b><span>Mantém os pixels nítidos ao ampliar ícones pequenos</span></div><button class="sw ${fx.pixel ? 'on' : ''}" onclick="cset({fx:{pixel:${!fx.pixel}}})"></button></div>` : fx.mode === 'theme' ? `<p class="mut" style="font-size:12px">Quantidade e tipo das formas do tema ficam em Aparência › Efeitos.</p>` : ''}
  </div>
  <div class="sec"><h3>Splash e ícone</h3><p>A tela de abertura e o ícone da janela e da bandeja. Valem mesmo com a personalização desligada.</p>
    <div class="frow"><div class="l"><b>Imagem do splash</b><span>PNG, JPG ou WEBP; aparece no lugar do logo enquanto o Ludrix abre (até 1024 px, fundo transparente fica bonito)</span></div><div class="ta">${k.splash ? `<img src="/api/custom/file/${enc(k.splash)}" alt="" style="height:44px;border-radius:8px;margin-right:6px"><button class="btn s sm" onclick="cremove('splash')">${I.trash} Remover</button>` : ''}<button class="btn s sm" onclick="cpick('splash')">${I.image} Escolher…</button></div></div>
    <div class="frow"><div class="l"><b>Ícone da janela e da bandeja</b><span>Qualquer imagem quadrada (PNG, JPG, ICO). O Ludrix gera o .ico com todos os tamanhos. Vale após reabrir</span></div><div class="ta">${k.icon ? `<img src="/api/custom/file/${enc(k.icon)}" alt="" style="height:32px;width:32px;border-radius:8px;margin-right:6px"><button class="btn s sm" onclick="cremove('icon')">${I.trash} Remover</button>` : ''}<button class="btn s sm" onclick="cpick('icon')">${I.image} Escolher…</button></div></div>
  </div>
  <div class="sec"><h3>Cantos e fonte</h3>
    <div class="frow"><div class="l"><b>Arredondamento</b><span>Dos cartões, botões e painéis</span></div>${seg('radius', [[-1, 'Do tema'], [0, 'Reto'], [4, 'Leve'], [8, 'Médio'], [14, 'Redondo'], [22, 'Bem redondo']], k.radius ?? -1)}</div>
    <div class="frow"><div class="l"><b>Fonte</b><span>Usa as fontes que já existem no seu Windows; nada é baixado</span></div><select class="sel" style="max-width:280px" onchange="cset({font:this.value})"><optgroup label="Estilos">${[['system', 'Do sistema'], ['rounded', 'Arredondada'], ['condensed', 'Condensada'], ['wide', 'Larga'], ['serif', 'Serifa'], ['mono', 'Mono']].map(([v, l]) => `<option value="${v}" ${(k.font || 'system') === v ? 'selected' : ''}>${l}</option>`).join('')}</optgroup>${(S.fonts || []).length ? `<optgroup label="Instaladas no ${OSN()}">${S.fonts.map(f => `<option value="family:${esc(f)}" style="font-family:'${esc(f)}'" ${k.font === 'family:' + f ? 'selected' : ''}>${esc(f)}</option>`).join('')}</optgroup>` : ''}</select></div>
  </div>
  <div class="sec"><h3>Barra de navegação</h3><p>A posição (ícones à esquerda, lateral, topo ou embaixo) fica em Aparência, junto dos temas.</p>
    <div class="frow"><div class="l"><b>Conteúdo dos botões</b></div>${seg('nav.style', [['auto', 'Do tema'], ['both', 'Ícone e texto'], ['icons', 'Só ícones'], ['text', 'Só texto']], nav.style || 'auto')}</div>
    <div class="frow"><div class="l"><b>Formato do botão ativo</b></div>${seg('nav.shape', [['pill', 'Pílula'], ['round', 'Redondo'], ['flat', 'Traço'], ['square', 'Quadrado']], nav.shape || 'pill')}</div>
    <div class="frow"><div class="l"><b>Tamanho dos ícones</b><span>0 usa o padrão</span></div>${range('nav.icon_size', 0, 34, 1, nav.icon_size ?? 0, 'pxd')}</div>
    <div class="frow"><div class="l"><b>Espaço entre botões</b></div>${range('nav.gap', 0, 16, 1, nav.gap ?? 0, 'pxd')}</div>

  </div>
  <div class="sec"><h3>Janela e barra de tarefas</h3>
    <div class="frow"><div class="l"><b>Barra de tarefas interna</b><span>Busca, categorias, ordenação e sino</span></div>${seg('window.toolbar_style', [['auto', 'Do tema'], ['flat', 'Lisa'], ['outlined', 'Contornada'], ['filled', 'Preenchida']], win.toolbar_style || 'auto')}</div>
  </div>
  <div class="sec"><h3>Cartões de jogo</h3>
    <div class="frow"><div class="l"><b>Formato da capa</b></div>${seg('cards.shape', [['poster', 'Pôster'], ['tall', 'Alto'], ['square', 'Quadrado'], ['wide', 'Largo']], cards.shape || 'poster')}</div>
    <div class="frow"><div class="l"><b>Nome do jogo</b></div>${seg('cards.labels', [['below', 'Abaixo'], ['overlay', 'Sobre a capa'], ['hover', 'Ao passar o mouse'], ['none', 'Escondido']], cards.labels || 'below')}</div>
    <div class="frow"><div class="l"><b>Sombra nas capas</b></div><button class="sw ${cards.shadow !== false ? 'on' : ''}" onclick="cset({cards:{shadow:${cards.shadow === false}}})"></button></div>
  </div>
  </div>`;
}
const CFMT = { n: v => v, pct: v => v + '%', px: v => v + 'px', deg: v => v + '°', x: v => (+v).toFixed(1) + '×', pxd: v => +v === 0 ? 'padrão' : v + 'px' };
function setPath(path, v) { const o = {}; let cur = o; const parts = path.split('.'); parts.forEach((p, i) => { if (i === parts.length - 1) cur[p] = v; else cur = cur[p] = {}; }); return o; }
function cssVar(n) { const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return /^#[0-9a-f]{6}$/i.test(v) ? v : rgbToHex(v) || '#000000'; }
function rgbToHex(v) { const m = v.match(/rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/); return m ? '#' + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join('') : ''; }
function autoScale() { const r = Math.min(window.innerWidth / 1500, window.innerHeight / 860); const s = 1 + (r - 1) * 0.6; return Math.round(Math.min(1.35, Math.max(0.8, s)) * 20) / 20; }
function applyScale() { const s = (S.config.ui_scale || autoScale()) * (document.body.classList.contains('sofa') ? (S.config.sofa_zoom || 1.15) : 1); document.documentElement.style.setProperty('--scale', s); document.documentElement.style.fontSize = ((13 + (S.config.text_size || 0)) * s) + 'px'; document.body.classList.toggle('compact', (S.config.density || 'normal') === 'compact'); document.body.classList.toggle('noglass', S.config.glass === false); }
let rzT = 0; window.addEventListener('resize', () => { if (S.config.ui_scale) return; cancelAnimationFrame(rzT); rzT = requestAnimationFrame(() => { const s = autoScale(); if (String(s) !== document.documentElement.style.getPropertyValue('--scale')) applyScale(); }); });
async function setCfg(patch) { const r = await api.post('/api/config', patch); if (r && !r.error) { S.config = r; api.emit('config', patch); if ('language' in patch) { location.reload(); return r; } applyTheme(); applyAnim(); applyScale(); if ('rail_icons' in patch) applyRailIcons(); if ('cursor' in patch) if ('game_backdrop' in patch || 'accent_from_cover' in patch || 'cover_slideshow' in patch || 'cover_slideshow_secs' in patch) gameFocus(S._focusKey || S.stageKey || null); if ('frame_mode' in patch || 'frame_corners' in patch) { frameLast = ''; applyFrame(); } if ('nav_hide_playing' in patch) applyPlaying(); if ('nav_hidden' in patch || 'nav_order' in patch) applyNavItems(); if ('nav_layout' in patch) { applyChrome(); renderView(); } if ('watch_dirs' in patch) api.post('/api/dirs/watch', {}); if ('card_hover' in patch || 'reduce_motion' in patch || 'detail_art' in patch || 'high_contrast' in patch || 'settings_adv' in patch) applyMotion(); if ('clock' in patch) applyClock(); if ('group_by' in patch && ['home', 'store'].includes(S.view)) renderLibrary(); if (S.view === 'settings') renderSettings(); if (['home', 'store'].includes(S.view) && ('card_size' in patch || 'face' in patch || 'theme' in patch || 'home_spot' in patch || 'home_rows' in patch || 'view_mode' in patch)) renderLibrary(); if ('toolbar' in patch || patch.toolbar_items) { applyToolbar(); if (['home', 'store'].includes(S.view)) renderLibrary(); } } }
async function setStartMenu(on) { const r = await api.post('/api/start_menu', { on }); if (r.error) { if (/versão instalada/.test(r.error)) { await setCfg({ start_menu: on }); return; } return toast('err', 'Menu Iniciar', r.error); } S.config.start_menu = on; renderSettings(true); toast('ok', on ? 'LudrixHub aparece no Menu Iniciar e na barra de tarefas com nome e ícone próprios' : 'Atalho do Menu Iniciar removido'); }
async function setFileAssoc(on) { const r = await api.post('/api/file_assoc', { on }); if (r.error) { if (/versão instalada/.test(r.error)) { await setCfg({ file_assoc: on }); return; } return toast('err', 'Associação de arquivos', r.error); } S.config.file_assoc = on; renderSettings(true); toast('ok', on ? 'Arquivos .lxtheme e .lxup abrem no Ludrix' : 'Associação removida'); }
async function setAutostart(on) { const r = await api.post('/api/autostart', { on }); if (r.error) return toast('err', r.error); S.config.autostart = !!r.enabled; renderSettings(); toast('ok', r.enabled ? 'O Ludrix vai abrir com o Windows' : 'Não abre mais com o Windows'); }
async function chooseFolder() { const r = await api.post('/api/choose_folder', { what: 'games' }); if (r.native) { if (r.folder) { await loadCatalog(false); renderSettings(); scanRun('windows', r.folder); } return; } modal({ title: 'Pasta dos jogos', text: 'Digite o caminho completo (modo navegador não tem diálogo nativo).', input: S.config.games_dir || '', ok: 'Salvar', onOk: v => setCfg({ games_dir: v }) }); }
function factoryReset() {
  modal({ title: 'Resetar o Ludrix de fábrica?', html: `<p style="margin:0 0 10px">Isso apaga <b>permanentemente</b>: configurações, biblioteca, fontes, caches, metadados, temas importados, downloads, a pasta <span class="code">games</span> (jogos baixados) e <span class="code">emulation</span> (emuladores, ROMs, BIOS). O Ludrix fecha e reabre zerado, como na primeira vez.</p>
    <p class="mut" style="margin:0 0 8px">Pra confirmar, escreva <b>APAGAR TUDO</b>:</p><input class="mi" id="frIn" placeholder="APAGAR TUDO" autocomplete="off" spellcheck="false">`,
    ok: 'Apagar tudo e reabrir', cancel: 'Não fazer nada', danger: true, wait: true, onOk: async () => {
      const v = ($('#frIn').value || '').trim().toUpperCase(); if (v !== 'APAGAR TUDO') { toast('err', 'Escreva APAGAR TUDO para confirmar'); return false; }
      const r = await api.post('/api/factory-reset', { confirm: 'APAGAR TUDO' }); if (r.error) { toast('err', 'Redefinição', r.error); return false; }
      toast('ok', 'Fechando para apagar tudo…', 'O Ludrix reabre sozinho zerado.');
    } });
}
async function imgGc(btn) {
  const r = await api.post('/api/cache/images_gc', { apply: false });
  if (!r || r.error) return toast('err', 'Não deu para conferir', (r && r.error) || '');
  if (!r.files) return toast('ok', 'Nada para limpar', 'Nenhuma imagem órfã com mais de 30 dias.');
  modal({ title: 'Limpar imagens órfãs?', text: `${pl(r.files, 'arquivo', 'arquivos')} · ${fmt(r.bytes)}. Se um jogo voltar a aparecer, a imagem é baixada de novo.`, ok: 'Limpar', danger: true, onOk: async () => { const x = await api.post('/api/cache/images_gc', { apply: true }); toast('ok', 'Imagens limpas', `${pl(x.files, 'arquivo', 'arquivos')} · ${fmt(x.bytes)}`); if (S.view === 'settings') renderSettings(true); } });
}
async function autoBackupDir(what) { const r = await api.post('/api/data/auto_backup', { [what]: true }); if (r && !r.error) { S.config = await api.get('/api/config'); renderSettings(true); } }
async function autoBackupNow(btn) { if (btn) btn.disabled = true; const r = await api.post('/api/data/auto_backup', { now: true }); if (btn) btn.disabled = false; if (!r || r.error) return toast('err', 'Backup não feito', (r && r.error) || ''); toast('ok', 'Backup pronto', r.path || '', r.path ? [{ label: 'Abrir pasta', fn: () => openPath(r.path) }] : undefined); S.config = await api.get('/api/config'); renderSettings(true); }
async function clearCache() { const what = [...document.querySelectorAll('#cacheBox input:checked')].map(i => i.value); await api.post('/api/cache/clear', { what }); toast('ok', 'Limpeza concluída', what.join(', ')); renderSettings(true); if (what.includes('web')) loadCatalog(false); }
const REPO_FIELDS = {
  telegram: [['token', 'Token do bot (deixe em branco para manter o atual)', '123456:AAH…', 'password'], ['chat', 'Canal (link t.me/+…, @usuario ou nome)', 'opcional']],
  webpage: [['url', 'Endereço da página', 'https://site.com/jogos'], ['depth', 'Profundidade (1 = só a página, 2 = segue links)', '1']],
  manifest: [['url', 'URL ou arquivo .json', 'https://…/lista.json']],
  archive_uploader: [['uploader', 'E-mail ou usuário do uploader', 'alguem@email.com']],
  archive_creator: [['creator', 'Criador (campo creator do archive.org)', '']],
  archive_search: [['query', 'Busca avançada do archive.org', 'collection:(…) AND title:(…)']],
  archive_item: [['identifier', 'Identificador do item', 'nome-do-item']],
  github_release: [['repo', 'Repositório', 'dono/repo'], ['title', 'Título do jogo', ''], ['asset', 'Palavra que identifica o arquivo (opcional)', 'win64']],
  local_folder: [['path', 'Pasta do PC', 'D:\\Jogos']],
};
async function editRepo(id) {
  const repos = await api.get('/api/repos'); const r = repos.find(x => x.id === id); if (!r) return;
  const fields = REPO_FIELDS[r.type] || (r.url !== undefined ? [['url', 'Endereço', '']] : []);
  const sysOpts = Object.entries(S.systems).filter(([k]) => k !== 'pc').sort((a, b) => a[1].localeCompare(b[1])).map(([k, n]) => `<option value="${k}" ${r.system === k ? 'selected' : ''}>${esc(n)}</option>`).join('');
  modal({ title: `Editar fonte`, wide: true, html: `
    <p class="mut" style="margin:0 0 6px;font-size:12px">Tipo: <b>${esc(r.type)}</b> · id <code>${esc(r.id)}</code> (não muda — os jogos instalados continuam ligados a ela)</p>
    <label class="ml">Nome</label><input class="mi" id="er_name" value="${esc(r.name || '')}">
    ${fields.map(([k, lbl, ph, t]) => `<label class="ml">${lbl}</label><input class="mi" id="er_${k}" type="${t || 'text'}" value="${esc(r[k] ?? '')}" placeholder="${esc(ph || '')}" autocomplete="off">`).join('')}
    <div class="romgrid"><div><label class="ml">Tipo de conteúdo</label><select class="mi" id="er_kind" onchange="$('#er_sysw').style.display=this.value==='rom'?'':'none'"><option value="pc" ${r.kind !== 'rom' && r.kind !== 'recomp' ? 'selected' : ''}>Jogos PC</option><option value="rom" ${r.kind === 'rom' ? 'selected' : ''}>ROMs</option><option value="recomp" ${r.kind === 'recomp' ? 'selected' : ''}>Recompilações</option></select></div>
    <div id="er_sysw" style="${r.kind === 'rom' ? '' : 'display:none'}"><label class="ml">Console padrão (quando o título não diz)</label><select class="mi" id="er_system">${sysOpts}</select></div></div>
    <label class="ml">Anotação (só para você)</label><input class="mi" id="er_note" value="${esc(r.note || '')}" placeholder="ex.: canal do fulano, só jogos de PS2">`,
    ok: 'Salvar', onOk: async () => {
      const patch = { name: $('#er_name').value, kind: $('#er_kind').value, system: $('#er_kind').value === 'rom' ? $('#er_system').value : 'pc', note: $('#er_note').value };
      for (const [k] of fields) { const v = $('#er_' + k).value; if (k === 'token' && !v.trim()) continue; patch[k] = k === 'depth' ? (parseInt(v) || 1) : v; }
      const res = await api.post('/api/repos/update', { id, patch }); if (res.error) { toast('err', 'Não foi possível salvar', res.error); return false; }
      toast('ok', 'Fonte atualizada', patch.name); if (S.view === 'store' && S.tab.store === 'sources') renderSources(); else if (S.view === 'settings') renderSettings(true); loadCatalog(false);
    } });
}
function removeRepo(id, name) { modal({ title: `Remover "${name}"?`, text: 'Os jogos já instalados continuam na biblioteca.', ok: 'Remover', danger: true, onOk: async () => { await api.post('/api/repos/remove', { id }); renderSettings(true); loadCatalog(false); } }); }
function addRepo() {
  modal({ title: 'Novo repositório', html: `
    <label class="ml">Tipo</label><select class="mi" id="rType" onchange="document.querySelectorAll('[data-t]').forEach(x=>x.style.display=(x.dataset.t[0]==='!'?x.dataset.t.slice(1)!==this.value:x.dataset.t===this.value)?'':'none')">
      <option value="webpage">Página da web — links diretos e torrents</option><option value="telegram">Canal do Telegram — bot lê posts com .torrent</option><option value="archive_uploader">archive.org — tudo de quem publicou</option><option value="archive_search">archive.org — busca avançada</option><option value="github_release">GitHub — release (recomp/port)</option><option value="manifest">Lista de jogos .json (link ou arquivo, ex.: do Hydra)</option></select>
    <div data-t="telegram" style="display:none"><p class="mut" style="margin:6px 0 8px">Funciona com um <b>bot</b> seu, <b>administrador do canal</b>: cada post novo com um <code>.torrent</code> anexado vira um jogo (título = primeira linha da legenda; <code>#ps2</code>, <code>#switch</code>… definem o console). Crie o bot no <b>@BotFather</b> (<code>/newbot</code>) e adicione-o como administrador do canal. Só posts feitos <b>depois</b> disso chegam.</p>
      <label class="ml">Token do bot</label><input class="mi" id="tgTok" placeholder="123456789:AAH…" autocomplete="off"><label class="ml">Canal (opcional — link t.me/+…, @usuario ou nome)</label><input class="mi" id="tgChat" placeholder="https://t.me/+xxxxxxxx"></div>
    <div><label class="ml">Nome</label><input class="mi" id="rName" placeholder="Ex.: Coleção do fulano"></div>
    <div data-t="webpage"><label class="ml">Endereço da página</label><input class="mi" id="rPage" placeholder="https://site.com/jogos"></div>
    <div data-t="archive_uploader" style="display:none"><label class="ml">E-mail ou usuário do uploader</label><input class="mi" id="rUploader" placeholder="alguem@email.com"></div>
    <div data-t="archive_search" style="display:none"><label class="ml">Busca avançada do archive.org ${help('A mesma sintaxe da busca avançada do site archive.org. Ex.: collection:(softwarelibrary_msdos_games) AND title:(doom)')}</label><input class="mi" id="rQuery" placeholder='collection:(softwarelibrary_msdos_games) AND title:(doom)'></div>
    <div data-t="github_release" style="display:none"><label class="ml">Repositório</label><input class="mi" id="rRepo" placeholder="dono/repo"><label class="ml">Título</label><input class="mi" id="rTitle" placeholder="Nome do jogo"><label class="ml">Palavra que identifica o arquivo certo (opcional) ${help('Quando o lançamento tem vários arquivos (Windows, Linux, Mac…), escreva um pedaço do nome do arquivo que você quer. Ex.: Windows')}</label><input class="mi" id="rAsset" placeholder="Windows"></div>
    <div data-t="manifest" style="display:none"><label class="ml">URL ou arquivo .json</label><div class="mrow"><input class="mi" id="rUrl" placeholder="https://…/lista.json ou C:\\Downloads\\fitgirl.json">${S.config.native ? `<button class="btn s sm" type="button" title="Escolher um .json do PC" onclick="api.post('/api/pick_exe',{kind:'json',initial:''}).then(r=>{if(r.file){$('#rUrl').value=r.file;if(!$('#rName').value)$('#rName').value=r.file.split(/[\\\\/]/).pop().replace(/\\.json$/i,'')}})">Arquivo…</button>` : ''}</div></div>
    <div><label class="ml">Tipo de conteúdo</label><div class="mrow"><select class="mi" id="rKind" onchange="$('#rSys').style.display=this.value==='rom'?'':'none'"><option value="pc">Jogos PC</option><option value="recomp">Recompilações</option><option value="rom">ROMs</option></select><select class="mi" id="rSys" style="display:none">${Object.entries(S.systems).filter(([id]) => id !== 'pc').map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('')}</select></div></div>`,
    ok: 'Adicionar', wait: true, onOk: async () => {
      const t = $('#rType').value;
      const cfg = { type: t, name: $('#rName').value || 'Repositório', kind: $('#rKind').value };
      if (cfg.kind === 'rom') cfg.system = $('#rSys').value;
      if (t === 'telegram') {
        const token = $('#tgTok').value.trim(), chat = $('#tgChat').value.trim(); if (!token) { toast('err', 'Telegram', 'Cole o token do bot'); return false; }
        const r = await api.get('/api/detect?q=' + enc(token + (chat ? ' ' + chat : '')), { timeout: 60000 });
        if (r.error || !(r.results || []).length) { toast('err', 'Telegram', r.error || 'Não reconheci'); return false; }
        await addSource({ ...r.results[0].cfg, kind: cfg.kind, system: cfg.system || 'pc', name: $('#rName').value || r.results[0].cfg.name });
        toast('ok', 'Canal adicionado', 'Cada post novo com .torrent aparece na Store — use "Atualizar catálogo" (menu do logo) para puxar na hora.'); return;
      }
      if (t === 'webpage') cfg.url = $('#rPage').value.trim();
      if (t === 'archive_uploader') cfg.uploader = $('#rUploader').value.trim();
      if (t === 'archive_search') cfg.query = $('#rQuery').value.trim();
      if (t === 'github_release') cfg.items = [{ repo: $('#rRepo').value.trim(), title: $('#rTitle').value.trim() || $('#rRepo').value.split('/')[1], asset: $('#rAsset').value.trim() || 'Windows', kind: cfg.kind }];
      if (t === 'manifest') {
        cfg.url = $('#rUrl').value.trim();
        const v = await api.post('/api/repos/validate', { url: cfg.url });
        if (v.error) { toast('err', 'JSON não aceito', v.error); return false; }
        if (!v.usable) { modal({ title: 'Nenhum jogo utilizável', wide: true, html: reportHtml(v), noCancel: true, ok: 'Fechar' }); return; }
        if (v.errors.length || v.warnings.length) { modal({ title: `${v.name} — ${v.summary}`, wide: true, html: reportHtml(v), ok: 'Adicionar mesmo assim', onOk: async () => { const r2 = await api.post('/api/repos/add', cfg); if (r2.error) return toast('err', 'Não foi possível concluir', r2.error); toast('ok', 'Repositório adicionado', cfg.name); if (S.view === 'store') renderSources(); loadCatalog(false); } }); return; }
      }
      const r = await api.post('/api/repos/add', cfg); if (r.error) return toast('err', 'Não foi possível concluir', r.error);
      toast('ok', 'Repositório adicionado', cfg.name); if (S.view === 'store') renderSources(); loadCatalog(false);
    } });
}

let pollT = null;
let metaReloadT = 0, metaLastEv = 0;
function metaReloadSoon(again) {
  clearTimeout(metaReloadT);
  if (!again) metaLastEv = Date.now();
  metaReloadT = setTimeout(async () => {
    if (S.metaPending > 0 && Date.now() - metaLastEv < 20000) return metaReloadSoon(true);
    if (!['home', 'store'].includes(S.view) || $('#modal').classList.contains('on') || $('#detail').classList.contains('on')) { S._metaDirty = true; return; }
    const st = $('#view').scrollTop; const d = await api.get('/api/catalog'); if (!d || d.loading) return;
    setGames(d.games || []); renderLibrary(); if (S.view === 'home') refreshHome(); $('#view').scrollTop = st;
  }, 1500);
}
function pollSoon() { clearTimeout(pollT); poll(); }
async function poll() {
  clearTimeout(pollT);
  if (document.hidden) { pollT = setTimeout(poll, 8000); return; }
  try {
    const s = await api.get('/api/status');
    const sb = Object.keys(S.sessions || {}).sort().join(); S.sessions = s.sessions || {}; const sa = Object.keys(S.sessions).sort().join();
    applyPlaying();
    if (sb !== sa) { if (S.view === 'home') refreshHome(); else if (S.view === 'store') renderLibrary(); if (S.det) renderDetail(); applyPlaying(); renderRailX(); }
    const before = Object.keys(S.jobs).sort().join(); S.jobs = s.jobs || {}; const after = Object.keys(S.jobs).sort().join();
    qfabSync();
    for (const [k, j] of Object.entries(S.jobs)) {
      const c = document.querySelector(`.card[data-key="${CSS.escape(k)}"] .cov`);
      if (c) { const ring = c.querySelector('.ring'); const html = ringSvg(j.fraction); if (ring) ring.outerHTML = html; else c.insertAdjacentHTML('beforeend', html); }
      const p = document.querySelector(`.prog[data-job="${CSS.escape(k)}"]`); if (p) p.outerHTML = progHtml(j, k);
    }
    if (S.jobs.update && S.view === 'settings' && S.tab.settings === 'system') { const box = $('#updBox'); if (box) box.outerHTML = updatesHtml(); }
    if (before !== after) { if (S.det && (S.view !== 'downloads')) renderDetail(); if (['downloads', 'emulation'].includes(S.view)) renderView(); else document.querySelectorAll('.ring').forEach(r => { const k = r.closest('.card')?.dataset.key; if (k && !S.jobs[k]) r.remove(); }); }
    if (s.gamepad) gpIndicator(s.gamepad);
    if (s.online !== undefined) setOnline(!!s.online && navigator.onLine !== false);
    S.metaPending = s.meta_pending || 0; statusBar(s.activity, s.loading);
    afterQueueSync(s.after_queue || null);
    for (const ev of (s.events || [])) handleEvent(ev);
  } catch (e) { }
  const busy = Object.keys(S.jobs).length, playing = Object.keys(S.sessions || {}).length;
  pollT = setTimeout(poll, busy ? 1000 : playing ? 3000 : document.hasFocus() ? 5000 : 10000);
}
async function edPickMove() { const r = await api.post('/api/pick_path', { kind: 'folder', initial: ED.form.dir || '' }); if (r && r.path) $('#edMoveTo').value = r.path; }
function edMove() {
  const dest = ($('#edMoveTo').value || '').trim(); if (!dest) return toast('err', 'Informe a pasta de destino', '');
  const key = ED.key, title = ED.info.title;
  $('#modal').classList.remove('on'); $('#modalBox').classList.remove('ged-box');
  setTimeout(() => modal({ title: 'Mover a pasta do jogo?', text: `${title}\n\nA pasta será copiada para dentro de:\n${dest}\n\nDepois de copiar tudo, a pasta original é apagada e a Biblioteca passa a usar o caminho novo. Se algo falhar no meio, nada muda.`, ok: 'Mover', cancel: 'Não fazer nada', onOk: async () => {
    const r = await api.post('/api/game/move', { key, dest }); if (r.error) { toast('err', 'Não foi possível mover', r.error); return false; }
    S.jobs[key] = { stage: 'move', fraction: 0, detail: 'Iniciando…' }; qfabSync(); setView('downloads');
  } }), 220);
}
async function exportSteam(user, keys) {
  const r = await api.post('/api/library/steam', { user: user || undefined, keys: keys && keys.length ? keys : undefined });
  if (r.error) return toast('err', 'Não foi possível enviar para a Steam', r.error);
  if (r.choose) { S._steamKeys = keys; return modal({ title: 'Qual conta da Steam?', text: 'Este PC tem mais de uma conta. Os atalhos entram na conta escolhida.', noOk: true, cancel: 'Não fazer nada', html: `<div class="askrow">${r.choose.map(u => `<button onclick="$('#modal').classList.remove('on');exportSteam(${jsq(u.id)},S._steamKeys)"><b>${esc(u.name)}</b><span>${u.shortcuts ? 'já tem atalhos' : 'sem atalhos'} · ${esc(u.id)}</span></button>`).join('')}</div>` }); }
  toast('ok', 'Atalhos enviados para a Steam', `${pl(r.added, 'novo', 'novos')}, ${r.updated} atualizados${r.skipped ? `, ${r.skipped} pulados` : ''} na conta ${r.user}. Abra a Steam para ver.`);
}
async function exportLibrary(fmt, keys) {
  const r = await api.post('/api/library/export', { format: fmt || 'ludrix', keys: keys && keys.length ? keys : undefined }); if (r.error) return toast('err', 'Não foi possível exportar', r.error);
  toast('ok', 'Biblioteca exportada', `${pl(r.count, 'jogo', 'jogos')} em ${r.dir}`, [{ label: 'Abrir pasta', fn: () => openPath(r.dir) }]);
}
async function handleEvent(ev) {
  if (ev.type === 'flash_cover') { if (S.view === 'flash') { const c = document.querySelector(`.fcard[data-fid="${CSS.escape(ev.id)}"] .fart`); if (c && !c.querySelector('img')) c.insertAdjacentHTML('afterbegin', `<img src="/flash/cover/${esc(ev.id)}?t=${Date.now()}" onload="this.classList.add('ld')" onerror="this.remove()">`); } return; }
  if (ev.type === 'theme_reload') { if (ev.theme) S.config.theme = ev.theme; reloadTheme(true); if (S.view === 'settings') renderSettings(true); return; }
  if (ev.type === 'update_available') { toast('info', 'Tem atualização nova', 'Versão ' + ev.version + (ev.rev ? ' (correção ' + ev.rev + ')' : '') + ' — veja em Ajustes › Sistema › Atualizações', [{ label: 'Abrir', fn: () => { setView('settings'); S.tab.settings = 'system'; S._settingsJump = 'Atualizações'; renderSettings(true); } }]); return; }
  if (ev.type === 'after_queue') { afterQueueSync({ action: ev.action, at: ev.at }); return; }
  if (ev.type === 'done') {
    if (ev.kind === 'update') { toast('ok', 'Atualização baixada', 'Pronta para aplicar', [{ label: 'Ver', fn: () => { setView('settings'); S.tab.settings = 'system'; S._settingsJump = 'Atualizações'; renderSettings(true); } }]); S.upd = null; if (S.view === 'settings' && S.tab.settings === 'system') loadUpdates(false); return; }
    if (ev.kind === 'emulator') { toast('ok', 'Emulador instalado', ev.title); if (S.view === 'emulation') renderEmulation(); return; }
    if (ev.kind === 'tool') { toast('ok', ev.key && ev.key.startsWith('mod:') ? 'Mod instalado' : 'Ferramenta instalada', ev.title); if (S.view === 'mods') renderMods(); return; }
    if (ev.kind === 'source') { toast('ok', 'Fonte criada', `${ev.count || 0} jogo(s)`); sourceMade(ev.out); return; }
    if (ev.kind === 'move') { toast('ok', 'Pasta movida', ev.title + (ev.dir ? ' → ' + ev.dir : '')); loadCatalog(false); if (S.view === 'central' && S.tab.central === 'disk') diskLoad(false); if (S.det && S.det.key === ev.key) { S.det = await api.get('/api/game/' + enc(ev.key)); renderDetail(); } return; }
    if (ev.kind === 'redist' || ev.kind === 'optional') { toast('ok', ev.restart ? 'Instalado — precisa reiniciar o PC' : 'Instalado', ev.title); if (S.view === 'central') renderCentral(); return; }
    if (ev.kind === 'flash') { toast('ok', ev.ruffle ? 'Player Flash pronto' : 'Jogo rápido pronto', ev.title, ev.gid ? [{ label: 'Jogar', fn: () => { if (S.view !== 'flash') setView('flash'); setTimeout(() => playFlash(ev.gid), 400); } }] : undefined); if (S.view === 'flash') renderFlash(); return; }
    const g = S.byKey[ev.key]; if (g) { g.installed = true; S._poolKey = ''; }
    if (S.det && S.det.key === ev.key) { const d = await api.get('/api/game/' + enc(ev.key)); S.det = d; renderDetail(); }
    loadCatalog(false); beep();
    if (ev.disc) { modal({ title: `${ev.title}: disco de instalação`, text: ev.disc.setup === false ? 'Veio como imagem de disco, mas não achei um instalador dentro. Posso montar mesmo assim para você olhar o conteúdo.' : `Veio como imagem de disco (${(ev.disc.kind || 'iso').toUpperCase()}). O disco é montado, o instalador abre e, quando ele terminar, o jogo fica pronto para jogar.${ev.disc.audio ? '\n\nEste disco tem faixas de áudio: o Windows monta só a parte de dados; se o jogo pedir o CD com música, use o WinCDEmu.' : ''}`, ok: 'Instalar agora', onOk: () => runRepack(ev.key), cancel: 'Depois' }); return; }
    if (ev.repack) { if (S.config.repack_auto_open) runRepack(ev.key); else toast('', `${ev.title}: repack baixado`, 'É um instalador (setup). Abra por aqui; quando terminar, o jogo entra na biblioteca.', [{ label: 'Abrir instalador', fn: () => runRepack(ev.key) }, { label: 'Depois', fn: () => { } }]); return; }
    if (ev.kind === 'repack') { modal({ title: `${ev.title} instalado`, text: `Jogo encontrado em:\n${ev.dir}`, ok: 'Jogar agora', onOk: () => play(ev.key), cancel: 'Não fazer nada' }); return; }
    const exes = ev.exes || [];
    if (ev.rom) modal({ title: `${ev.title} está pronto`, text: 'ROM salva na pasta do console.', ok: 'Jogar agora', onOk: () => play(ev.key), cancel: 'Não fazer nada' });
    else if (!exes.length) toast('', 'Extraído, mas sem .exe', `${ev.title}: talvez tenha um instalador/ISO dentro da pasta.`);
    else {
      let scDone = false;
      const sc = () => { if (scDone) return; scDone = true; if (ev.shortcut_offer && $('#mkSc')?.checked) api.post('/api/shortcut/desktop', { key: ev.key }).then(r => r.error ? toast('err', 'Atalho', r.error) : toast('ok', 'Atalho criado', 'Na área de trabalho')); };
      modal({ title: `${ev.title} está pronto`, text: exes.length > 1 ? `${exes.length} executáveis encontrados; será usado:\n${exes[0].split(/[\\/]/).pop()}` : 'Instalado com sucesso.', ok: 'Jogar agora', extra: exes.length > 1 ? 'Escolher outro .exe' : null, onExtra: () => { sc(); chooseExe(ev.key); }, onOk: () => { sc(); play(ev.key); }, cancel: 'Não fazer nada',
        html: ev.shortcut_offer ? `<label class="mchk1"><input type="checkbox" id="mkSc"> Criar atalho na área de trabalho</label>` : '',
        onClose: sc });
    }
  } else if (ev.type === 'session_external') {
    toast('', `${ev.title} aberto fora do Ludrix`, 'O tempo de jogo está sendo contado.'); S.sessions = S.sessions || {}; S.sessions[ev.key] = { since: Date.now() / 1000, external: true }; applyPlaying();
  } else if (ev.type === 'new_games') {
    newGamesToast(ev);
  } else if (ev.type === 'session_end') {
    const g = S.byKey[ev.key]; if (!ev.crashed) { if (g && ev.elapsed >= 60) sessionCard(ev, g); else toast('ok', `${ev.title}`, `Sessão de ${ev.elapsed_h}`); } if (g) { S._poolKey = ''; g.playtime = (g.playtime || 0) + ev.elapsed; g.last_played = Date.now() / 1000; }
    if (ev.crashed) crashDialog(ev.key, ev.title);
    if (S.det && S.det.key === ev.key) { const d = await api.get('/api/game/' + enc(ev.key)); S.det = d; renderDetail(); } loadCatalog(false);
  } else if (ev.type === 'thumb_ready') {
    TH.err.delete(ev.key); TH.tries[ev.key] = 0; const cv = (S.byKey[ev.key] || {}).cv || 0, want = `/thumb/${enc(ev.key)}?`;
    document.querySelectorAll('.card img, .scov img, .gcov img').forEach(im => { if (im.getAttribute('src').startsWith(want)) { im.classList.remove('err'); im.src = `${want}v=${cv}&t=${Date.now() % 1e6}`; } });
  } else if (ev.type === 'meta_batch_done') {
    metaReloadSoon(); if (ev.count > 3) toast('ok', 'Capas e informações atualizadas', pl(ev.count, 'jogo', 'jogos'));
  } else if (ev.type === 'meta_ready') {
    metaReloadSoon();
    const g = S.byKey[ev.key]; if (g) { g.cv = ev.cv; g.has_meta = true; if (ev.genres && ev.genres.length) g.genres = ev.genres; if (ev.year) g.year = ev.year; if (ev.creator) g.creator = ev.creator; if (ev.hero_ok) g.hero_ok = true; }
    if (ev.hero_ok) { const nb = $('#nowbar'); if (nb && nb.dataset.key === ev.key) { nb.dataset.cv = ''; nowbarFill(); } if (S.det && S.det.key === ev.key && $('#detail').classList.contains('on')) { const h = $('#dHero'); if (h && !h.classList.contains('himg')) { const d = await api.get('/api/game/' + enc(ev.key)); S.det = d; renderDetail(); } } }
    if (S.home && S.home.games && S.home.games[ev.key]) S.home.games[ev.key].cv = ev.cv;
    TH.err.delete(ev.key); TH.tries[ev.key] = 0;
    if (ev.found === false && ev.mine && S.config.auto_metadata !== false && !S._askedMeta?.has(ev.key)) {
      (S._askedMeta = S._askedMeta || new Set()).add(ev.key);
      unrecQueue(ev.key, ev.title);
    }
    document.querySelectorAll(`.card[data-key="${CSS.escape(ev.key)}"]`).forEach(c => {
      const im = c.querySelector('img'); if (im) { im.classList.remove('err'); im.src = `/thumb/${enc(ev.key)}?v=${ev.cv}`; }
      if (!g) return;
      const sub = c.querySelector('.sub'); if (sub) sub.innerHTML = `${g.genres && g.genres[0] ? `<span class="g">${esc(g.genres[0])}</span>·` : ''}<span>${esc(g.creator || g.fr || '')}</span>${ptHtml(g.playtime)}`;
      const yr = c.querySelector('.info span'); if (yr) yr.textContent = g.year || '';
    });
    if (S.det && S.det.key === ev.key && !S.det.meta) { const d = await api.get('/api/game/' + enc(ev.key)); if (S.current === ev.key) { S.det = d; renderDetail(); } }
  } else if (ev.type === 'win') { winState(ev);
  } else if (ev.type === 'sys_accent') { S.sysAccent = ev.hex || ''; if ((S.config.accent_mode || 'theme') === 'system') applyAccent();
  } else if (ev.type === 'notify') {
    loadNotifs();
    if (ev.kind === 'repack') toast('', ev.title, ev.text, [{ label: 'Abrir instalador', fn: () => runRepack(ev.key) }, { label: 'Depois', fn: () => { } }]);
    else if (ev.kind === 'error') toast('err', ev.title, ev.text);
    else if (ev.kind === 'info') { toast('ok', ev.title, ev.text); loadCatalog(false); }
    else if (ev.kind === 'warn' && ev.key === 'integrity') toast('warn', ev.title, ev.text, [{ label: 'Ver arquivos', fn: () => integrityCheck() }, { label: 'Depois', fn: () => { } }]);
    else if (ev.kind === 'ok') toast('ok', ev.title, ev.text);
    else if (ev.kind === 'store') { toast('ok', ev.title, ev.text, [{ label: 'Ver na Store', fn: () => notifOpen(ev.id) }, { label: 'Depois', fn: () => { } }]); loadCatalog(false); }
  } else if (ev.type === 'renamed') {
    const g = S.byKey[ev.key]; if (g) g.title = ev.title;
    if (S.home && S.home.games && S.home.games[ev.key]) S.home.games[ev.key].title = ev.title;
    document.querySelectorAll(`.card[data-key="${CSS.escape(ev.key)}"] h4`).forEach(h => { h.textContent = ev.title; h.title = ev.title; });
    if (S.det && S.det.key === ev.key) { S.det.title = ev.title; S.det.title_orig = ev.old; renderDetail(); }
    toast('', 'Nome corrigido', `${ev.old} → ${ev.title}`);
  } else if (ev.type === 'ui') { applyTermUi(ev.ui || {});
  } else if (ev.type === 'closing') { toast('', 'LudrixHub', 'Fechando o launcher…');
  } else if (ev.type === 'cancelled') { toast('', ev.paused ? 'Pausado' : 'Cancelado', ev.paused ? `${ev.title} — retome pela Fila quando quiser.` : `${ev.title} — o parcial fica em downloads\\ até a próxima limpeza.`); renderView(); }
  else if (ev.type === 'error') { toast('err', `Falha em ${ev.title}`, ev.message); loadNotifs(); renderView(); if (S.det && S.det.key === ev.key) renderDetail(); }
}

let modalGen = 0;
function modal(o) {
  guideDismiss();
  const m = $('#modal'), b = $('#modalBox'), gen = ++modalGen;
  b.classList.toggle('wide', !!o.wide); b.classList.remove('ged-box');
  b.innerHTML = `<h3>${esc(o.title)}</h3>${o.text ? `<p>${esc(o.text)}</p>` : ''}${o.html || ''}
    ${o.input !== undefined ? `<input class="mi" id="mIn" value="${esc(o.input)}">` : ''}${o.textarea !== undefined ? `<textarea class="mi" id="mIn">${esc(o.textarea)}</textarea>` : ''}
    ${o.list ? `<div class="mlist">${o.list.map(x => `<button data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}
    <div class="a">${o.extra ? `<button class="btn s sm" id="mEx">${esc(o.extra)}</button>` : ''}${(o.buttons || []).map((x, i) => `<button class="btn s sm" data-mb="${i}">${esc(x.label)}</button>`).join('')}<span style="flex:1"></span>${o.noCancel ? '' : `<button class="btn s sm" id="mNo">${esc(o.cancel || 'Cancelar')}</button>`}${o.noOk ? '' : `<button class="btn ${o.danger ? 'd' : 'p'} sm" id="mOk">${esc(o.ok || 'OK')}</button>`}</div>`;
  const close = () => { if (gen === modalGen) m.classList.remove('on'); if (o.onClose) { const f = o.onClose; o.onClose = null; f(); } };
  const no = b.querySelector('#mNo'); if (no) no.onclick = () => { close(); o.onCancel && o.onCancel(); };
  if (b.querySelector('#mOk')) b.querySelector('#mOk').onclick = async () => { const v = b.querySelector('#mIn')?.value.trim(); if (!o.onOk) return close(); let r = o.onOk(v); if (o.wait && r && typeof r.then === 'function') { const ok = b.querySelector('#mOk'); ok.disabled = true; try { r = await r; } finally { ok.disabled = false; } } if (r !== false) close(); };
  if (o.extra) b.querySelector('#mEx').onclick = () => { close(); o.onExtra && o.onExtra(); };
  b.querySelectorAll('[data-mb]').forEach(x => x.onclick = () => { close(); o.buttons[+x.dataset.mb].fn(); });
  if (o.list) b.querySelectorAll('.mlist button').forEach(x => x.onclick = () => { b.querySelectorAll('.mlist button').forEach(y => y.classList.remove('on')); x.classList.add('on'); o.onPick(x.dataset.v); });
  m.classList.add('on'); const inp = b.querySelector('#mIn'); if (inp) { inp.focus(); inp.onkeydown = e => { if (e.key === 'Enter') b.querySelector('#mOk')?.click(); }; }
}
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) $('#modal').classList.remove('on'); });
(() => {
  let ov = null, t = 0;
  const show = () => { if (!ov) { ov = document.createElement('div'); ov.className = 'dropov'; ov.innerHTML = `<div>${I.plus}<b>Solte para adicionar à biblioteca</b><span>.exe, .lnk, ROMs, .zip/.7z/.rar ou uma pasta de jogos</span></div>`; document.body.appendChild(ov); } clearTimeout(t); t = setTimeout(hide, 1200); };
  const hide = () => { if (ov) { ov.remove(); ov = null; } };
  document.addEventListener('dragover', e => { if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; show(); });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) hide(); });
  document.addEventListener('drop', async e => {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault(); hide();
    const paths = [...e.dataTransfer.files].map(f => (window.lxn && window.lxn.pathFor(f)) || f.path || '').filter(Boolean);
    if (!paths.length) return toast('warn', 'Não deu para ler o caminho do arquivo', 'Use + Adicionar jogo e escolha o arquivo.');
    const r = await api.post('/api/drop/classify', { paths });
    const items = (r && r.items) || [];
    const exes = items.filter(x => x.kind === 'exe'), roms = items.filter(x => x.kind === 'rom'), dirs = items.filter(x => x.kind === 'dir'), arcs = items.filter(x => x.kind === 'archive'), unk = items.filter(x => x.kind === 'unknown' || x.kind === 'missing');
    let ok = 0, last = null;
    for (const x of exes) { const a = await api.post('/api/local/add', { exe: x.path }); if (a && !a.error) { ok++; last = a; } else if (a && a.error) toast('err', 'Não foi possível adicionar', `${x.name}: ${a.error}`); }
    if (ok) { toast('ok', ok === 1 && last && last.title ? last.title : pl(ok, 'jogo adicionado', 'jogos adicionados'), ok === 1 ? 'Adicionado à biblioteca' : '', ok === 1 && last && last.key ? [{ label: 'Detalhes', fn: () => openGame(last.key) }] : undefined); S.home = null; await loadCatalog(false); }
    for (const x of roms) await addRom(x.path, x.system);
    for (const x of arcs) {
      await new Promise(res => modal({ title: x.name, text: x.system ? `Esse arquivo pode ser uma ROM de ${S.systems[x.system] || x.system} ou um jogo de PC compactado. O que é?` : 'Instalar como jogo de PC? O arquivo é extraído para a pasta de jogos e o jogo entra na biblioteca.', ok: x.system ? 'Jogo de PC' : 'Instalar', cancel: x.system ? `ROM de ${S.systems[x.system] || x.system}` : 'Cancelar', onClose: () => res(),
        onOk: async () => { const a = await api.post('/api/local/install_file', { file: x.path }); if (a && a.error) toast('err', 'Não foi possível instalar', a.error); else if (a && a.ok !== false) { S.jobs[a.key] = { stage: 'extract', fraction: 0, detail: 'Iniciando…' }; qfabSync(); toast('ok', 'Instalando', `${a.title} — acompanhe em Downloads.`); pollSoon(); } },
        onCancel: async () => { if (x.system) await addRom(x.path, x.system); } }));
    }
    for (const d of dirs) { SC.mode = d.mode; await scanRun(d.mode, d.path); }
    if (unk.length) toast('warn', unk.length === 1 ? `Não reconheci ${unk[0].name}` : `${unk.length} arquivos não reconhecidos`, 'Aceito: .exe, .lnk, .url, ROMs, .zip/.7z/.rar ou uma pasta.');
  });
})();
function integrityLine(i) {
  if (!i || !i.status || i.status === 'skipped') return 'Confere se cada arquivo da pasta app está igual ao da versão instalada';
  if (i.status === 'ok') return `${i.checked} arquivos conferidos ao abrir, todos iguais à versão instalada`;
  if (i.status === 'repaired') return `${i.fixed} arquivo(s) foram restaurados ao abrir`;
  return `${i.bad} arquivo(s) faltando ou diferente(s) do esperado`;
}
async function integrityCheck() {
  const r = await api.get('/api/integrity');
  if (!r || r.error) return toast('err', 'Não foi possível verificar', (r && r.error) || '');
  if (r.status === 'skipped') return modal({ title: 'Sem lista de conferência', text: 'Esta cópia não tem a lista de arquivos da versão (app/integrity.json). Ela é gerada nos pacotes de instalação e atualização.', ok: 'OK', noCancel: true });
  if (r.status === 'ok') return modal({ title: 'Tudo no lugar', text: `${r.checked} arquivos conferidos: todos iguais à versão ${r.version}.`, ok: 'OK', noCancel: true });
  const rows = r.bad.map(b => `<div class="frow"><div class="l"><b>app/${esc(b.file)}</b><span>${b.why === 'faltando' ? 'Faltando' : 'Diferente do esperado'}</span></div></div>`).join('');
  const bt = [];
  if (r.seed) bt.push({ label: 'Reparar agora', fn: integrityRepair });
  bt.push({ label: 'Reparar com um pacote…', fn: () => restoreVersion(true) });
  modal({ title: `${r.bad.length} de ${r.checked} arquivos não conferem`, wide: true,
    text: r.seed ? `Há um pacote da versão ${r.version} guardado: os arquivos podem ser restaurados agora, sem trocar de versão.` : `Para restaurar, use o pacote da mesma versão (Ludrix-${r.version}-src.zip ou ludrix-${r.version}-patch.lxup). Um pacote de outra versão troca o launcher inteiro por aquela versão.`,
    html: `<div class="diag">${rows}</div>`, buttons: bt, ok: 'Fechar', noCancel: true });
}
async function integrityRepair() {
  const r = await api.post('/api/integrity/repair', {});
  if (!r || r.error) return toast('err', 'Não foi possível reparar', (r && r.error) || '');
  if (!r.bad.length) { modal({ title: 'Arquivos restaurados', text: `${(r.fixed || []).length} arquivo(s) voltaram a ser os da versão ${r.version}. Os arquivos novos valem depois de reabrir o launcher.`, html: '<p class="rq">*Requer Reinicialização!</p>', ok: 'Reiniciar agora', cancel: 'Depois', onOk: async () => { const x = await api.post('/api/restart', {}); if (x && x.error) toast('err', 'Não foi possível reiniciar', x.error); else toast('ok', 'Reabrindo…'); } }); return; }
  modal({ title: `${r.bad.length} arquivo(s) ainda não conferem`, wide: true, text: 'O pacote guardado não cobre esses arquivos. Use o pacote da versão completa.', html: `<div class="diag">${r.bad.map(b => `<div class="frow"><div class="l"><b>app/${esc(b.file)}</b><span>${b.why === 'faltando' ? 'Faltando' : 'Diferente do esperado'}</span></div></div>`).join('')}</div>`, buttons: [{ label: 'Reparar com um pacote…', fn: () => restoreVersion(true) }], ok: 'Fechar', noCancel: true });
}
async function libraryCheck() {
  const r = await api.post('/api/library/check', {});
  if (r.error) return toast('err', 'Não foi possível verificar', r.error);
  S.config.last_lib_check = Date.now() / 1000;
  const emus = (r.emus || []).map(e => `<div class="frow"><div class="l"><b>${esc(e.name)}</b><span>${pl(e.count, 'ROM', 'ROMs')} na biblioteca, mas ${e.emulator ? esc(e.emulator) + ' não está instalado' : 'nenhum emulador está vinculado'}</span></div><div class="ta"><button class="btn p xs" onclick="$('#modal').classList.remove('on');closeDetail();setView('emulation')">Abrir Emuladores</button></div></div>`).join('');
  const dup = r.dupes ? { label: pl(r.dupes, 'grupo duplicado', 'grupos duplicados'), fn: libraryDupes } : null;
  if (!r.items.length && !emus) return modal({ title: 'Tudo no lugar', text: `Conferi ${r.total} ${r.total === 1 ? 'jogo' : 'jogos'}: pastas, executáveis, ROMs e emuladores estão onde deveriam.${r.dupes ? ' Há entradas repetidas na biblioteca.' : ''}`, ok: 'OK', buttons: dup ? [dup] : [] });
  if (!r.items.length) return modal({ title: 'Jogos no lugar, emulador faltando', wide: true, text: `Os ${r.total} jogos estão onde deveriam, mas há consoles sem emulador instalado.`, html: `<div class="diag">${emus}</div>`, ok: 'Fechar', noCancel: true });
  const rows = r.items.map(i => `<div class="frow" data-key="${esc(i.key)}"><div class="l"><b>${esc(i.title)}</b><span>${esc(i.problem)}<br><code>${esc(i.path)}</code></span></div><div class="ta"><button class="btn p xs" onclick="${i.kind === 'workdir' ? `api.post('/api/edit/save',{key:${jsq(i.key)},data:{workdir:''}}).then(()=>{this.closest('.frow').remove();toast('ok','Pasta de trabalho limpa','Volta a usar a pasta do executável')})` : `relocateGame(${jsq(i.key)}, this)`}">${i.kind === 'rom' ? 'Apontar arquivo…' : i.kind === 'workdir' ? 'Limpar' : 'Apontar pasta…'}</button><button class="btn d xs" onclick="confirmUninstall(${jsq(i.key)})">Remover</button></div></div>`).join('');
  modal({ title: `${r.items.length} ${r.items.length === 1 ? 'jogo não encontrado' : 'jogos não encontrados'}`, wide: true, text: 'Se o jogo mudou de lugar, aponte a pasta (ou o arquivo da ROM) nova. Se foi apagado, remova da biblioteca.', html: `<div class="diag">${rows}${emus ? `<h5 style="margin:12px 0 4px">Emuladores</h5>${emus}` : ''}</div>`, ok: 'Fechar', noCancel: true, buttons: r.items.length > 1 ? [{ label: 'Remover todos da biblioteca', fn: () => removeMany(r.items.map(i => i.key)) }] : [] });
}
function removeMany(keys) {
  modal({ title: `Remover ${pl(keys.length, 'jogo', 'jogos')} da biblioteca`, text: 'Só a entrada na biblioteca sai. Nenhum arquivo no disco é apagado. Os jogos podem ser importados ou adicionados de novo depois.', ok: 'Remover', danger: true, cancel: 'Não fazer nada',
    onOk: async () => { let n = 0; for (const k of keys) { const r = await api.post('/api/uninstall', { key: k }); if (!r.error) n++; } msClear(); toast('ok', 'Biblioteca atualizada', pl(n, 'jogo removido', 'jogos removidos')); S.home = null; await loadCatalog(false); } });
}
async function relocateGame(key, btn, path) {
  if (!path && !S.config.native) return modal({ title: 'Nova pasta do jogo', text: 'Caminho completo da pasta (ou do arquivo da ROM):', input: '', ok: 'Usar', onOk: v => v && relocateGame(key, btn, v) });
  const r = await api.post('/api/game/relocate', { key, path: path || '' });
  if (r.cancel) return;
  if (r.error) return toast('err', 'Não foi possível relocalizar', r.error);
  const row = btn && btn.closest('.frow'); if (row) row.remove();
  loadCatalog(false);
  if (r.need_exe) { toast('', 'Pasta atualizada', 'Executável não encontrado dentro dela — escolha qual abre o jogo.'); return chooseExe(key); }
  toast('ok', 'Jogo relocalizado', r.exe || r.dir, [{ label: 'Jogar agora', fn: () => play(key) }, { label: 'OK', fn: () => {} }]);
}
async function dataExport() {
  const r = await api.post('/api/data/export', {});
  if (r.cancel) return;
  if (r.error) return toast('err', 'Não foi possível exportar', r.error);
  toast('ok', 'Backup pronto', `${pl(r.files, 'arquivo', 'arquivos')} · ${fmt(r.size)}`, [{ label: 'Abrir pasta', fn: () => openPath(r.path.replace(/[\\/][^\\/]*$/, '')) }, { label: 'OK', fn: () => {} }]);
}
async function dataImport(path) {
  if (!path && !S.config.native) return modal({ title: 'Importar um backup', text: 'Caminho completo do Ludrix-dados-*.zip:', input: '', ok: 'Continuar', onOk: v => v && dataImport(v) });
  const r = await api.post('/api/data/inspect', { path: path || '' });
  if (r.cancel) return;
  if (r.error) return toast('err', 'Não foi possível ler o backup', r.error);
  const when = r.at ? new Date(r.at * 1000).toLocaleString() : '?';
  const parts = [`${pl(r.games, 'jogo', 'jogos')} na biblioteca`, `${pl(r.themes, 'tema importado', 'temas importados')}`, r.saves ? 'cópias de saves' : null, r.has_config ? 'configurações' : null].filter(Boolean).join(' · ');
  modal({ title: 'Aplicar este backup?', text: `Feito em ${when} com a versão ${r.version}. Contém: ${parts}. O que existe hoje será substituído (uma cópia do estado atual fica em data${SEP()}updates) e o Ludrix reabre em seguida.`, ok: 'Aplicar e reabrir', cancel: 'Não fazer nada', danger: true, onOk: async () => {
    const x = await api.post('/api/data/import', { path: r.path });
    if (x.error) return toast('err', 'Não foi possível importar', x.error);
    toast('ok', 'Backup aplicado', 'Reabrindo o Ludrix…'); setTimeout(() => api.post('/api/restart', {}), 900);
  } });
}
function safeModeNotice() {
  const acts = [{ label: 'Manter o padrão', fn: () => {} }];
  if (S.config.safe_saved) acts.unshift({ label: 'Voltar aos meus ajustes', fn: async () => { const r = await api.post('/api/safe_mode/restore', {}); if (r.ok) location.reload(); } });
  toast('warn', 'Aberto no modo seguro', 'O Ludrix não conseguiu abrir duas vezes seguidas, então tema, efeitos e personalização voltaram ao padrão só por segurança. Se quiser, restaure os seus ajustes — se voltar a travar, o problema está neles.', acts);
}
async function showDiag() {
  const d = await api.get('/api/diag');
  const rows = d.checks.map(c => `<div class="frow"><div class="l"><b>${esc(c.name)}</b><span>${esc(c.detail)}</span></div><span class="tag ${c.ok && !c.warn ? 'ok' : (c.ok ? 'warn' : 'bad')}">${c.ok && !c.warn ? 'OK' : (c.ok ? 'atenção' : 'problema')}</span></div>`).join('');
  modal({ title: 'Diagnóstico', wide: true, html: `<div class="diag">${rows}${d.log.length ? `<details style="margin-top:10px"><summary>Últimas linhas do log</summary><pre class="dlog">${esc(d.log.join('\n'))}</pre></details>` : ''}</div>`, ok: 'Copiar tudo', cancel: 'Fechar', extra: 'Gerar zip', onExtra: async () => { const r = await api.post('/api/diag/zip', {}); if (r.error) return toast('err', 'Não foi possível gerar', r.error); toast('ok', 'Zip de diagnóstico pronto', `${r.path.split(/[\\/]/).pop()} · ${fmt(r.size)} — a pasta foi aberta`); }, onOk: () => { navigator.clipboard.writeText(d.text).then(() => toast('ok', 'Copiado', 'Cole onde quiser (chat, e-mail, bloco de notas).')); } });
}
const _uiErrSeen = new Set();
window.addEventListener('error', e => { const msg = String(e.message || e.error || 'erro'); if (_uiErrSeen.has(msg) || _uiErrSeen.size > 20) return; _uiErrSeen.add(msg); try { api.post('/api/log/ui', { msg, src: e.filename || '', line: e.lineno || 0 }); } catch (_) {} });
window.addEventListener('unhandledrejection', e => { const msg = 'promise: ' + String((e.reason && (e.reason.message || e.reason)) || '?'); if (_uiErrSeen.has(msg) || _uiErrSeen.size > 20) return; _uiErrSeen.add(msg); try { api.post('/api/log/ui', { msg }); } catch (_) {} });
const _toastSeen = new Map();
function unrecQueue(key, title) {
  (S._unrec = S._unrec || []).push({ key, title });
  clearTimeout(S._unrecT);
  S._unrecT = setTimeout(() => {
    const q = S._unrec || []; S._unrec = []; if (!q.length) return;
    if (q.length === 1) return toast('', `Não reconheci "${q[0].title}"`, 'Nenhuma fonte achou esse nome. Você pode corrigir o nome, escolher onde procurar ou preencher à mão.', [{ label: 'Editar detalhes', fn: () => editGame(q[0].key, 'meta') }, { label: 'Depois', fn: () => { } }]);
    toast('', `${q.length} jogos não reconhecidos`, `Nenhuma fonte achou: ${q.slice(0, 3).map(x => x.title).join(', ')}${q.length > 3 ? ` e mais ${q.length - 3}` : ''}. Dá para corrigir o nome, escolher onde procurar ou preencher à mão.`, [{ label: 'Ver lista', fn: () => unrecList(q) }, { label: 'Depois', fn: () => { } }]);
  }, 2500);
}
function unrecList(q) {
  modal({ title: `${q.length} jogos sem informações`, text: 'Clique num jogo para corrigir o nome ou preencher os detalhes à mão.', html: `<div class="mlist">${q.map(x => `<button onclick="editGame(${jsq(x.key)},'meta')">${esc(x.title)}</button>`).join('')}</div>`, noOk: true, cancel: 'Fechar' });
}
function toast(type, title, msg, actions) {
  if (actions && !Array.isArray(actions)) actions = [actions];
  const sig = type + '|' + title + '|' + (msg || ''), now = Date.now();
  if (!actions && _toastSeen.get(sig) > now - 2500) return; _toastSeen.set(sig, now);
  if (S.config.popups === false && type !== 'err') return;
  if (actions) { const t = document.createElement('div'); t.className = 'toast ' + type + ' act'; t.innerHTML = `<div><b>${esc(title)}</b><span>${esc(msg || '')}</span><div class="ta">${actions.map((a, i) => `<button class="btn ${i === 0 ? 'p' : 's'} xs" data-i="${i}">${esc(a.label)}</button>`).join('')}</div></div><button class="x">${I.x}</button>`; t.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { actions[+b.dataset.i].fn(); t.remove(); }); t.querySelector('.x').onclick = () => t.remove(); $('#toasts').appendChild(t); setTimeout(() => t.remove(), 20000); return; }
  return toastPlain(type, title, msg);
}
const SND = { ctx: null, last: 0 };
function uiSound(kind) {
  if (S.config.ui_sounds === false) return;
  const now = performance.now(); if (kind === 'click' && now - SND.last < 70) return; SND.last = now;
  try {
    if (!SND.ctx) SND.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const c = SND.ctx; if (c.state === 'suspended') c.resume();
    const vol = { low: .045, mid: .09, high: .16 }[S.config.ui_sounds_level || 'low'] || .045;
    const tone = (f0, f1, dur, at, type = 'sine', g = 1) => {
      const o = c.createOscillator(), a = c.createGain(), t = c.currentTime + at;
      o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(vol * g, t + .006); a.gain.exponentialRampToValueAtTime(.0001, t + dur);
      o.connect(a).connect(c.destination); o.start(t); o.stop(t + dur + .02);
    };
    if (kind === 'click') tone(1900, 1300, .045, 0, 'sine', .9);
    else if (kind === 'toggle') { tone(1400, 1400, .03, 0, 'square', .35); tone(1900, 1900, .035, .06, 'square', .35); }
    else if (kind === 'open') tone(560, 840, .09, 0, 'sine', 1);
    else if (kind === 'back') tone(840, 560, .09, 0, 'sine', 1);
    else if (kind === 'done') { tone(523, 523, .14, 0, 'triangle', .8); tone(659, 659, .14, .11, 'triangle', .8); tone(784, 784, .22, .22, 'triangle', .8); }
  } catch (_) { }
}
document.addEventListener('pointerdown', e => {
  if (S.config.ui_sounds === false || e.button !== 0) return;
  const t = e.target.closest && e.target.closest('.sw, .btn, .rb, .card, .tabs > *, .seg > *, .chip, .mlist button, .addmenu button, .ctx .it, .thcard, .gwc, select, .frow input[type=checkbox]');
  if (!t || t.disabled) return;
  uiSound(t.classList.contains('sw') ? 'toggle' : 'click');
}, true);
function sessionCard(ev, g) {
  if (S.config.popups === false) return;
  const total = (g.playtime || 0) + ev.elapsed, lang = (S.config.language || 'pt-BR');
  const since = g.added_at ? new Date(g.added_at * 1000).toLocaleDateString(lang, { month: 'short', year: 'numeric' }).replace('.', '') : '';
  const t = document.createElement('div'); t.className = 'toast ok sess'; t.dataset.key = ev.key;
  t.innerHTML = `<img src="/thumb/${enc(ev.key)}?v=${g.cv || 0}" alt="" onerror="this.style.visibility='hidden'"><div><b>${esc(ev.title)}</b><span>Você jogou ${esc(ev.elapsed_h)}</span><small>Total ${fmtTime(total)}${since ? ` · desde ${esc(since)}` : ''}</small></div>`;
  t.onclick = () => { t.remove(); openGame(ev.key); };
  const box = $('#toasts'); box.appendChild(t); while (box.children.length > 5) box.firstElementChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 9000);
  uiSound('done');
}
function toastPlain(type, title, msg) { const t = document.createElement('div'); t.className = 'toast ' + type; t.innerHTML = `<div><b>${esc(title)}</b><span>${esc(msg || '')}</span></div>`; const box = $('#toasts'); box.appendChild(t); while (box.children.length > 5) box.firstElementChild.remove(); let left = 5000, tm, t0 = Date.now(); const go = () => { t0 = Date.now(); tm = setTimeout(() => { t.style.transition = '.3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, left); }; t.onmouseenter = () => { clearTimeout(tm); left = Math.max(1500, left - (Date.now() - t0)); }; t.onmouseleave = go; t.onclick = () => { clearTimeout(tm); t.remove(); }; go(); }

function applyAnim() {
  const mode = (S.config.reduce_motion || rmq.matches) ? 'off' : (S.config.animations || 'full');
  if (document.documentElement.dataset.anim !== mode) document.documentElement.dataset.anim = mode;
  applyPlx();
  const fx = $('#fx'); if (!fx) return;
  const count = Math.max(0, Math.min(16, S.config.fx_intensity ?? 10)), type = S.config.fx_type || 'controls';
  const cf = S.custom && S.custom.on ? S.custom.fx : null;
  let src = null;
  if (cf && cf.mode === 'off') src = { off: true };
  else if (cf && cf.mode === 'icons' && (cf.icons || []).length) src = { ...cf, urls: cf.icons.map(x => '/api/custom/file/fx/' + enc(x)) };
  else if (S.themeFx && (S.themeFx.icons || []).length) src = { ...S.themeFx, urls: S.themeFx.icons.map(x => '/api/theme/' + enc(S.themeId) + '/file/' + x) };
  const key = `${mode}|${count}|${type}|${document.documentElement.classList.contains('mono') ? 'm' : 'c'}|${src ? JSON.stringify(src) : ''}`;
  if (fx.dataset.mode === key) return; fx.dataset.mode = key;
  fx.innerHTML = ''; fx.dataset.dir = src && src.direction || 'up'; fx.dataset.pixel = src && src.pixel ? '1' : '0';
  if (mode === 'off' || (src && src.off)) return;
  if (src) {
    const n = Math.max(0, Math.min(24, mode === 'light' ? Math.min(6, src.count ?? 10) : (src.count ?? 10))), sp = src.speed || 1, sz = src.size || 56, op = (src.opacity ?? 45) / 100;
    let h = '';
    for (let i = 0; i < n; i++) {
      const s = sz * (0.7 + Math.random() * 0.6), d = (24 + Math.random() * 28) / sp, dl = -Math.random() * d;
      h += `<i style="--x:${Math.random() * 100}%;--y:${Math.random() * 100}%;--s:${s.toFixed(0)}px;--d:${d.toFixed(1)}s;--dl:${dl.toFixed(1)}s;--dx:${((Math.random() - .5) * 240).toFixed(0)}px;--r:${src.spin === false ? 0 : ((Math.random() - .5) * 360).toFixed(0)}deg;--o:${(op * (.8 + Math.random() * .4)).toFixed(2)}"><img src="${src.urls[i % src.urls.length]}" alt=""></i>`;
    }
    fx.innerHTML = h; return;
  }
  if (!count) return;
  const n = mode === 'light' ? Math.min(6, count) : count;
  const btn = l => `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><text x="12" y="16" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor" stroke="none">${l}</text></svg>`;
  const SH = {
    A: btn('A'), B: btn('B'), X: btn('X'), Y: btn('Y'),
    plus: '<svg viewBox="0 0 24 24"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></svg>',
    gamepad: '<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="12" rx="4"/><path d="M7 11v4M5 13h4M15 12h.01M18 14h.01"/></svg>',
    star: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 6l1.5 4.5L18 12l-4.5 1.5L12 18l-1.5-4.5L6 12l4.5-1.5z"/></svg>',
    diamond: '<svg viewBox="0 0 24 24"><path d="M12 3l9 9-9 9-9-9z"/></svg>',
    square: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>',
    tri: '<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/></svg>',
    circle: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-4.3-8.5-8.5A5 5 0 0112 7a5 5 0 018.5 5.5C18.5 16.7 12 21 12 21z"/></svg>',
    spark: '<svg viewBox="0 0 24 24"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/><circle cx="18" cy="4" r="2"/><circle cx="5" cy="17" r="1.5"/></svg>',
    dots: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="12" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
  };
  const SETS = {
    controls: [SH.A, SH.B, SH.X, SH.Y, SH.gamepad, SH.plus],
    geometric: [SH.circle, SH.square, SH.tri, SH.diamond, SH.plus, SH.dots],
    gaming: [SH.gamepad, SH.A, SH.B, SH.star, SH.bolt, SH.circle],
    symbols: [SH.star, SH.spark, SH.bolt, SH.heart, SH.circle, SH.plus],
    mix: Object.values(SH),
  };
  const shapes = SETS[type] || SETS.controls;
  const mono = document.documentElement.classList.contains('mono');
  const cols = mono ? ['var(--text)', 'var(--muted)', 'var(--muted2)'] : ['var(--accent2)', 'var(--green2)', '#60a5fa', '#f472b6', '#fbbf24', 'var(--muted)'];
  let h = '';
  for (let i = 0; i < n; i++) {
    const s = 30 + Math.random() * 70, d = 24 + Math.random() * 28, dl = -Math.random() * d;
    h += `<i style="--x:${Math.random() * 100}%;--s:${s}px;--d:${d}s;--dl:${dl}s;--dx:${(Math.random() - .5) * 240}px;--r:${(Math.random() - .5) * 360}deg;--o:${(.22 + Math.random() * .25).toFixed(2)};--c:${cols[i % cols.length]}">${shapes[i % shapes.length]}</i>`;
  }
  fx.innerHTML = h;
}
const ICON_SETS = [['solid', 'Cheio'], ['line', 'Linha'], ['duo', 'Duotom'], ['arcade', 'Arcade'], ['pixel', 'Pixel'], ['color', 'Colorido'], ['neon', 'Neon']];
const ICON_COLORS = {
  color: { home: '#5c6b82', store: '#3b82f6', emulation: '#a855f7', mods: '#f59e0b', redists: '#14b8a6', flash: '#ec4899', downloads: '#22c55e', settings: '#94a3b8' },
  neon: { home: '#ff5e00', store: '#00c8ff', emulation: '#c000ff', mods: '#ffe600', redists: '#00ffc3', flash: '#ff00d4', downloads: '#39ff14', settings: '#9be2ff' }
};
const ICON_BASE = { color: 'solid', neon: 'line' };
function iconSet(id) { if (id && typeof id === 'object') return id.icons ? id : null; if (ICON_COLORS[id]) { const b = iconSet(ICON_BASE[id]); return b ? { ...b, colors: ICON_COLORS[id], glow: id === 'neon' } : null; } return (typeof RAIL_ICON_SETS !== 'undefined' && RAIL_ICON_SETS[id]) || null; }
const RAIL_ALIAS = { central: 'redists' };
function sysIcon(id, cls) { const d = typeof SYS_ICONS !== 'undefined' && SYS_ICONS[id]; return d ? `<span class="sysic ${cls || ''}"><svg viewBox="0 0 48 32">${d}</svg></span>` : ''; }
function busyCursor(on) { document.documentElement.classList.toggle('busy', !!on); }
function applyRailIcons() {
  const p = iconSet(S.config.rail_icons || S.themeIcons || 'solid');
  document.querySelectorAll('.rb[data-view]').forEach(b => {
    const svg = b.querySelector('svg'); if (!svg) return;
    if (!svg.dataset.orig) svg.dataset.orig = svg.innerHTML;
    const d = p && (p.icons[b.dataset.view] || p.icons[RAIL_ALIAS[b.dataset.view]]);
    svg.innerHTML = d || svg.dataset.orig;
    svg.setAttribute('viewBox', d ? p.vb : '0 0 24 24');
    svg.style.strokeWidth = d && !p.fill ? p.sw : '';
    svg.classList.toggle('fill', !!(d && p.fill));
    const col = p && p.colors && (p.colors[b.dataset.view] || p.colors[RAIL_ALIAS[b.dataset.view]]);
    svg.style.setProperty('--ic', col || '');
    b.classList.toggle('colored', !!col); b.classList.toggle('glow', !!(col && p.glow));
  });
}
function iconSetSample(id) {
  const p = iconSet(id); const views = ['home', 'store', 'emulation', 'settings'];
  return views.map(v => { const d = p && p.icons[v]; const orig = document.querySelector(`.rb[data-view=${v}] svg`); const inner = d || (orig && (orig.dataset.orig || orig.innerHTML)) || ''; const col = p && p.colors && p.colors[v]; return `<svg viewBox="${d ? p.vb : '0 0 24 24'}" class="${d && p.fill ? 'fill' : ''}" style="${d && !p.fill ? `stroke-width:${p.sw};` : ''}${col ? `color:${col};${p.glow ? `filter:drop-shadow(0 0 4px ${col})` : ''}` : ''}">${inner}</svg>`; }).join('');
}
let awayT = 0;
function idleState() { const hidden = document.hidden, idle = hidden || !document.hasFocus(); document.body.classList.toggle('idle', idle); const fx = $('#fx'); if (fx) fx.style.display = hidden ? 'none' : ''; clearTimeout(awayT); if (idle) awayT = setTimeout(() => document.body.classList.add('away'), 60000); else document.body.classList.remove('away'); }
document.addEventListener('visibilitychange', idleState); window.addEventListener('blur', () => setTimeout(idleState, 250)); window.addEventListener('focus', idleState);

function homeOrder(list) {
  if (S.sort !== 'az' && S.sort !== 'recent') return list;
  const score = g => { let s = 0; if (g.fav) s += 1e12; if (g.last_played) s += g.last_played; s += (g.added_at || 0) / 10; s += Math.min(g.playtime || 0, 1e6); return s; };
  return [...list].sort((a, b) => score(b) - score(a) || a.title.localeCompare(b.title, 'pt'));
}
async function refreshHome() { if (S.view !== 'home') return; try { S.home = await api.get('/api/home'); } catch (e) { return; } if (S.view === 'home' && !filtersActive() && !S.q) { const el = $('#homeTop'); if (el) el.outerHTML = homeTop(); } }
const SORTS = [['az', 'A–Z'], ['year', 'Ano'], ['size', 'Tamanho'], ['recent', 'Recentes'], ['most', 'Mais jogados'], ['count', 'Vezes jogado'], ['added', 'Adicionados'], ['dev', 'Desenvolvedora'], ['score', 'Sua nota'], ['fresh', 'Novos nas fontes']];
const WEEK = 7 * 86400;
const FLAG_TEST = {
  fresh: g => !!g.fresh, upd: g => !!g.update_version, direct: g => !!g.avail_direct, torrent: g => !!g.avail_torrent, fav: g => !!g.fav, never: g => !g.last_played && !(g.playtime > 0), played: g => !!g.last_played || g.playtime > 0,
  recent: g => (g.last_played || 0) > Date.now() / 1000 - WEEK, added: g => (g.added_at || 0) > Date.now() / 1000 - WEEK,
  installed: g => !!g.installed, notinst: g => !g.installed, hidden: g => !!g.hidden, nometa: g => !g.has_meta, broken: g => g.repo === 'local' && !g.installed && !g.mc_nolauncher, playnite: g => g.source === 'playnite', withargs: g => !!g.has_args, big: g => (g.size || 0) > 10e9, old: g => +(g.year || 0) > 0 && +g.year < 2005,
};
const FLAGS = [['fresh', 'Novos nas fontes'], ['upd', 'Versão nova na fonte'], ['direct', 'Download direto'], ['torrent', 'Torrent'], ['fav', 'Favoritos'], ['recent', 'Jogados esta semana'], ['added', 'Adicionados esta semana'], ['never', 'Nunca joguei'], ['played', 'Já joguei'],
               ['installed', 'Instalados'], ['notinst', 'Não instalados'], ['old', 'Clássicos (antes de 2005)'], ['big', 'Grandes (> 10 GB)'], ['nometa', 'Sem capa / metadados'], ['broken', 'Arquivo não encontrado'], ['playnite', 'Vindos do Playnite'], ['withargs', 'Com argumentos'], ['hidden', 'Ocultos']];
const repoFltN = () => (S.view === 'store' ? S.flt.repos.size : 0) + S.flt.src.size;
const repoName = id => (S.repos.find(r => r.id === id) || {}).name || id || '';
const FLT_KINDS = ['colls', 'cats', 'sys', 'flags', 'repos', 'src', 'genres', 'tags', 'devs', 'years', 'lastp', 'added', 'ptime', 'size', 'status', 'score'];
const BUCKET_KINDS = ['lastp', 'added', 'ptime', 'size', 'status', 'score'];
const BUCKETS = {
  lastp: [['never', 'Nunca'], ['today', 'Hoje'], ['week', 'Últimos 7 dias'], ['month', 'Últimos 30 dias'], ['year', 'Último ano'], ['older', 'Há mais de um ano']],
  added: [['today', 'Hoje'], ['week', 'Últimos 7 dias'], ['month', 'Últimos 30 dias'], ['year', 'Último ano'], ['older', 'Há mais de um ano']],
  ptime: [['none', 'Nunca jogado'], ['lt1', 'Menos de 1 h'], ['h1', '1 a 10 h'], ['h10', '10 a 50 h'], ['h50', 'Mais de 50 h']],
  size: [['lt1', 'Menos de 1 GB'], ['g1', '1 a 10 GB'], ['g10', '10 a 50 GB'], ['g50', 'Mais de 50 GB']],
  status: [['none', 'Sem status'], ...STATUS],
  score: [['none', 'Sem nota'], ['s9', '9 a 10'], ['s7', '7 a 8'], ['s5', '5 a 6'], ['s1', '1 a 4']],
};
const agoB = ts => { const a = Date.now() / 1000 - ts; return a < 86400 ? 'today' : a < 7 * 86400 ? 'week' : a < 30 * 86400 ? 'month' : a < 365 * 86400 ? 'year' : 'older'; };
const bucketOf = {
  lastp: g => g.last_played ? agoB(g.last_played) : 'never',
  added: g => g.added_at ? agoB(g.added_at) : '',
  ptime: g => { const h = (g.playtime || 0) / 3600; return !g.playtime ? 'none' : h < 1 ? 'lt1' : h < 10 ? 'h1' : h < 50 ? 'h10' : 'h50'; },
  size: g => { const gb = (g.size || 0) / 1e9; return !g.size ? '' : gb < 1 ? 'lt1' : gb < 10 ? 'g1' : gb < 50 ? 'g10' : 'g50'; },
  status: g => g.status || 'none',
  score: g => { const n = +g.score || 0; return !n ? 'none' : n >= 9 ? 's9' : n >= 7 ? 's7' : n >= 5 ? 's5' : 's1'; },
};
const FLT_TITLES = { colls: 'Coleção', repos: 'Fonte', src: 'Origem', sys: 'Plataforma', cats: 'Categoria', genres: 'Gênero', tags: 'Etiqueta', years: 'Ano de lançamento', devs: 'Desenvolvedora', lastp: 'Última vez jogado', added: 'Adicionado', ptime: 'Tempo de jogo', size: 'Tamanho', status: 'Status', score: 'Sua nota', flags: 'Situação' };
const QUICK = [['installed', 'Instalados'], ['notinst', 'Não instalados'], ['fav', 'Favoritos'], ['never', 'Nunca joguei']];
const fltCount = () => FLT_KINDS.reduce((a, k) => a + (k === 'repos' && S.view !== 'store' ? 0 : S.flt[k].size), 0);
const filtersActive = () => S.cat !== 'all' || fltCount() > 0;
const fpOn = () => !!S.config.filter_panel && ['home', 'store'].includes(S.view) && !(S.view === 'store' && S.tab.store === 'sources');
function fltLabel(kind, id) {
  if (kind === 'cats') return (S.cats.find(c => c.id === id) || {}).name || id;
  if (kind === 'colls') return (colls().find(c => c.id === id) || {}).name || 'Coleção';
  if (kind === 'sys') return id === 'pc' ? 'PC' : (S.systems[id] || id);
  if (kind === 'flags') return (FLAGS.find(f => f[0] === id) || [])[1] || id;
  if (kind === 'repos') return repoName(id);
  if (BUCKET_KINDS.includes(kind)) return (BUCKETS[kind].find(b => b[0] === id) || [])[1] || id;
  if (kind === 'devs') return id || 'Sem desenvolvedora';
  if (kind === 'years') return id || 'Sem ano';
  return id;
}
function fltLabels() { const out = []; for (const k of FLT_KINDS) { if (k === 'repos' && S.view !== 'store') continue; for (const id of S.flt[k]) out.push([k, id, fltLabel(k, id)]); } return out; }
function fpItems(kind) {
  const P = poolStats();
  const byCount = o => Object.keys(o).sort((a, b) => o[b] - o[a] || COLL.compare(a, b)).map(id => [id, fltLabel(kind, id), o[id]]);
  if (kind === 'repos') return S.view === 'store' ? byCount(P.rcount) : [];
  if (kind === 'colls') return S.view === 'home' ? colls().map(c => [c.id, c.name, c.keys.filter(k => S.byKey[k] && S.byKey[k].installed).length]) : [];
  if (kind === 'src') return S.view === 'home' ? byCount(P.ocount) : [];
  if (kind === 'sys') { const it = byCount(P.scount); return it.length > 1 ? it : []; }
  if (kind === 'cats') return S.cats.filter(c => P.counts[c.id]).map(c => [c.id, c.name, P.counts[c.id]]);
  if (kind === 'genres') return byCount(P.gcount);
  if (kind === 'tags') return byCount(P.tcount);
  if (kind === 'devs') return byCount(P.dcount).filter(x => x[0]);
  if (kind === 'years') return Object.keys(P.ycount).filter(Boolean).sort((a, b) => +b - +a).map(id => [id, id, P.ycount[id]]);
  if (BUCKET_KINDS.includes(kind)) { if (kind === 'size' && S.view === 'home') return []; if (['status', 'score'].includes(kind) && (S.view === 'store' || Object.keys(P.bcount[kind]).every(k => k === 'none'))) return []; return BUCKETS[kind].map(([id, nm]) => [id, nm, P.bcount[kind][id] || 0]).filter(x => x[2]); }
  if (kind === 'flags') return FLAGS.filter(([id]) => !QUICK.some(q => q[0] === id) && (S.view !== 'store' || !['recent', 'played'].includes(id))).map(([id, nm]) => [id, nm, P.fcount[id]]).filter(x => x[2]);
  return [];
}
function fpanelHtml() {
  const f = S.flt, n = fltCount(), P = poolStats();
  const box = (kind, id, nm, c) => `<label class="fbox ${f[kind].has(id) ? 'on' : ''}"><input type="checkbox" ${f[kind].has(id) ? 'checked' : ''} onchange="toggleFlt('${kind}',${jsq(id)})"><span>${esc(nm)}</span><em>${c}</em></label>`;
  const sec = kind => {
    const items = fpItems(kind); if (!items.length) return '';
    const title = FLT_TITLES[kind], act = f[kind].size, open = S._fopen[kind] !== undefined ? S._fopen[kind] : act > 0 || ['sys', 'cats', 'genres'].includes(kind);
    const many = items.length > 8, q = S._fq[kind] || '', qn = qnorm(q);
    const shown = qn ? items.filter(x => qnorm(x[1]).includes(qn)) : items;
    const lim = !qn && many && !S._fall[kind] ? 7 : 1e9;
    return `<div class="fsc${open ? ' open' : ''}"><button class="fsh" onclick="fpToggle('${kind}')"><b>${title}</b>${act ? `<i>${act}</i>` : ''}<svg class="car" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button>
      ${open ? `<div class="fsb">${many ? `<input class="fsq" placeholder="Procurar em ${title.toLowerCase()}…" value="${esc(q)}" oninput="fpSearch('${kind}',this.value)" spellcheck="false">` : ''}
      ${shown.slice(0, lim).map(([id, nm, c]) => box(kind, id, nm, c)).join('')}
      ${shown.length > lim ? `<button class="lnk fsmore" onclick="S._fall['${kind}']=1;fpRender()">Mostrar todos (${shown.length})</button>` : ''}
      ${!shown.length ? '<span class="fnone">Nada com esse nome</span>' : ''}</div>` : ''}</div>`;
  };
  const presets = S.config.filter_presets || [];
  const quick = QUICK.filter(([id]) => S.view !== 'store' || !['installed', 'notinst', 'never'].includes(id)).map(([id, nm]) => `<button class="${f.flags.has(id) ? 'on' : ''}" onclick="toggleFlt('flags',${jsq(id)})">${esc(nm)}${P.fcount[id] ? ` <em>${P.fcount[id]}</em>` : ''}</button>`).join('');
  return `<aside class="fpanel" id="fpanel" onclick="event.stopPropagation()">
    <div class="fph"><b>Exibição e filtros</b>${n ? `<span class="n">${n}</span>` : ''}<span class="sp"></span>${n ? `<button class="lnk" onclick="clearFlt()">Limpar filtros</button>` : ''}<button class="fpx" onclick="fpOpen(false)" title="Fechar painel">${I.x}</button></div>
    ${fpViewHtml()}
    <div class="fpsub"><b>Filtros</b>${n ? `<i>${n}</i>` : ''}</div>
    <div class="fpre"><select onchange="fpApplyPreset(this.value)" title="Filtros salvos"><option value="">${presets.length ? 'Filtros salvos…' : 'Nenhum filtro salvo'}</option>${presets.map((p, i) => `<option value="${i}" ${S._fpreset === i ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      ${S._fpreset !== undefined && presets[S._fpreset] ? `<button class="btn s xs" onclick="fpDelPreset()" title="Excluir este filtro salvo">${I.trash}</button>` : `<button class="btn s xs" onclick="fpSavePreset()" ${n ? '' : 'disabled'} title="Salvar a combinação atual com um nome">Salvar</button>`}</div>
    ${quick ? `<div class="fquick">${quick}</div>` : ''}
    ${['colls', 'repos', 'src', 'sys', 'cats', 'status', 'score', 'genres', 'tags', 'years', 'devs', 'lastp', 'added', 'ptime', 'size', 'flags'].map(sec).join('')}
    <div class="fpfoot">Marque quantos quiser: dentro de um grupo vale qualquer um; entre grupos, todos.</div>
  </aside>`;
}
function fpRender() { const el = $('#fpanel'); if (!el) return renderLibrary(); const st = el.scrollTop; el.outerHTML = fpanelHtml(); const np = $('#fpanel'); if (np) np.scrollTop = st; }
function fpToggle(kind) { const cur = S._fopen[kind] !== undefined ? S._fopen[kind] : (S.flt[kind].size > 0 || ['sys', 'cats', 'genres'].includes(kind)); S._fopen[kind] = !cur; fpRender(); }
function fpSearch(kind, v) { S._fq[kind] = v; const el = $('#fpanel'); const st = el ? el.scrollTop : 0; fpRender(); const inp = $('#fpanel .fsq'); const all = [...document.querySelectorAll('#fpanel .fsq')]; const mine = all.find(i => i.oninput && String(i.getAttribute('oninput')).includes(`'${kind}'`)); if (mine) { mine.focus(); mine.setSelectionRange(v.length, v.length); } if ($('#fpanel')) $('#fpanel').scrollTop = st; }
function fpOpen(on) { if (on === undefined) on = !S.config.filter_panel; S.config.filter_panel = on; api.post('/api/config', { filter_panel: on }, { quiet: true }); renderLibrary(); }
function fpSnapshot() { const o = {}; for (const k of FLT_KINDS) if (S.flt[k].size) o[k] = [...S.flt[k]]; return { flt: o, cat: S.cat, sort: S.sort, rev: !!S.sortRev }; }
function fpSavePreset() {
  modal({ title: 'Salvar filtro', text: 'Dê um nome para esta combinação. Ela fica na lista "Filtros salvos" do painel.', input: fltLabels().slice(0, 3).map(x => x[2]).join(' + '), ok: 'Salvar', onOk: name => {
    if (!name) return; const list = [...(S.config.filter_presets || [])].filter(p => p.name !== name); list.push({ name, ...fpSnapshot() }); S._fpreset = list.length - 1; setCfg({ filter_presets: list }).then(() => { renderLibrary(); toast('ok', 'Filtro salvo', `"${name}" está em Filtros salvos.`); });
  } });
}
function fpApplyPreset(i) {
  if (i === '') { S._fpreset = undefined; fpRender(); return; }
  const p = (S.config.filter_presets || [])[+i]; if (!p) return;
  for (const k of FLT_KINDS) S.flt[k].clear();
  for (const k in (p.flt || {})) if (S.flt[k]) for (const id of p.flt[k]) S.flt[k].add(id);
  S.cat = p.cat || 'all'; S.sort = p.sort || 'az'; S.sortRev = !!p.rev; S._fpreset = +i; S.page = 1; renderSortBtn(); renderLibrary();
}
function fpDelPreset() {
  const list = [...(S.config.filter_presets || [])], p = list[S._fpreset]; if (!p) return;
  modal({ title: 'Excluir filtro salvo', text: `"${p.name}" sai da lista. Os jogos não são afetados.`, ok: 'Excluir', danger: true, onOk: () => { list.splice(S._fpreset, 1); S._fpreset = undefined; setCfg({ filter_presets: list }).then(renderLibrary); } });
}
function viewTweaks() {
  if (!['home', 'store'].includes(S.view)) return 0;
  const defS = S.view === 'store' ? 'fresh' : 'az', defG = S.view === 'store' ? '' : 'letter';
  return (S.sort !== defS || S.sortRev ? 1 : 0) + (groupBy() !== defG ? 1 : 0) + ((S.config.view_mode || 'mural') !== 'mural' ? 1 : 0);
}
function filterBtn() {
  const n = fltCount() + viewTweaks();
  return `<button class="btn s xs ${n || fpOn() ? 'p' : ''}" onclick="fpOpen()" title="Ordem, grupos, modo de exibição e filtros — o painel fica aberto até você fechar">${I.sliders}<span class="lb">Exibição${n ? ` (${n})` : ''}</span></button>`;
}
function fpViewHtml() {
  if (!['home', 'store'].includes(S.view)) return '';
  const g = groupBy(), defS = S.view === 'store' ? 'fresh' : 'az', defG = S.view === 'store' ? '' : 'letter', lm = listMode(), n = viewTweaks();
  const open = S._fopen.view !== undefined ? S._fopen.view : true;
  const seg = (items, cur, fn) => `<div class="seg fsort">${items.map(([id, l]) => `<button class="${cur === id ? 'on' : ''}" onclick="${fn(id)}">${l}</button>`).join('')}</div>`;
  return `<div class="fsc fview${open ? ' open' : ''}"><button class="fsh" onclick="fpToggle('view')"><b>Exibição</b>${n ? `<i>${n}</i>` : ''}<svg class="car" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button>
    ${open ? `<div class="fsb">
      <h6>Ordem</h6>${seg(SORTS.filter(([id]) => id !== 'fresh' || S.view === 'store'), S.sort, id => `setSort('${id}')`)}
      <label class="fbox ${S.sortRev ? 'on' : ''}"><input type="checkbox" ${S.sortRev ? 'checked' : ''} onchange="S.sortRev=!S.sortRev;S.page=1;renderLibrary()"><span>Ordem inversa</span></label>
      ${S.view === 'home' ? `<label class="fbox ${S.config.fav_first ? 'on' : ''}"><input type="checkbox" ${S.config.fav_first ? 'checked' : ''} onchange="setCfg({fav_first:!S.config.fav_first}).then(()=>{S.page=1;renderLibrary()})"><span>Favoritos primeiro</span></label>` : ''}
      <h6>Agrupar</h6>${seg(GROUPS, g, id => `setGroupBy(${jsq(id)})`)}${g ? `<div class="gall"><button class="lnk" onclick="groupsAll(true)">Recolher todos</button><button class="lnk" onclick="groupsAll(false)">Expandir todos</button></div>` : ''}
      <h6>Modo</h6>${seg([['mural', 'Mural'], ['grid', 'Grade'], ['list', 'Lista']], S.config.view_mode || 'mural', id => `setViewMode(${jsq(id)})`)}
      ${lm ? `<h6>Colunas da lista</h6><div class="seg fsort">${LIST_COLS.map(([id, l]) => `<button class="${listCols().includes(id) ? 'on' : ''}" onclick="toggleListCol(${jsq(id)})">${l}</button>`).join('')}</div>` : `<h6>Tamanho das capas</h6><label class="zoom vz"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg><input type="range" min="100" max="300" step="10" value="${S.config.card_size || 136}" oninput="setCardSize(this.value,false)" onchange="setCardSize(this.value,true)"></label>`}
      ${n ? `<button class="lnk fsmore" onclick="S.sortRev=false;setSort(${jsq(defS)});setGroupBy(${jsq(defG)}).then(()=>setCfg({view_mode:'mural'}).then(renderLibrary))">Voltar ao padrão</button>` : ''}
    </div>` : ''}</div>`;
}
const SYS_ALIAS = { ps1: ['ps1', 'psx', 'psone', 'playstation1', 'play1'], ps2: ['ps2', 'playstation2', 'play2'], ps3: ['ps3', 'playstation3', 'play3'], psp: ['psp'], snes: ['snes', 'supernintendo'], nes: ['nes', 'nintendinho', 'famicom'], n64: ['n64', 'nintendo64'], gc: ['gc', 'gamecube', 'ngc'], wii: ['wii'], wiiu: ['wiiu'], switch: ['switch', 'nsw'], '3ds': ['3ds'], nds: ['ds', 'nds'], gba: ['gba'], gbc: ['gbc'], gb: ['gb', 'gameboy'], dc: ['dc', 'dreamcast'], saturn: ['saturn'], genesis: ['genesis', 'megadrive', 'md'], sms: ['sms', 'mastersystem'], xbox: ['xbox'], x360: ['x360', 'xbox360'], arcade: ['arcade', 'mame', 'fliperama'], pce: ['pce', 'pcengine', 'turbografx'], dos: ['dos', 'msdos'], atari2600: ['atari', 'atari2600'], pc: ['pc', 'windows', 'computador'] };
const SMART_WORDS = { instalado: 'installed', instalados: 'installed', instalada: 'installed', instaladas: 'installed', favorito: 'fav', favoritos: 'fav', favorita: 'fav', favoritas: 'fav', nunca: 'never', jogado: 'played', jogados: 'played', recente: 'recent', recentes: 'recent', novo: 'fresh', novos: 'fresh', novidade: 'fresh', novidades: 'fresh', torrent: 'torrent', direto: 'direct', grande: 'big', grandes: 'big', pesado: 'big', pesados: 'big', antigo: 'old', antigos: 'old', leve: 'light', leves: 'light', installed: 'installed', favorite: 'fav', favorites: 'fav', never: 'never', played: 'played', recent: 'recent', new: 'fresh', direct: 'direct', big: 'big', heavy: 'big', old: 'old', light: 'light' };
const SMART_FLAG_NAME = { installed: 'instalados', fav: 'favoritos', never: 'nunca jogados', played: 'já jogados', recent: 'jogados recentemente', fresh: 'novos nas fontes', torrent: 'torrent', direct: 'download direto', hidden: 'escondidos', big: 'grandes', old: 'antigos', light: 'leves' };
function smartOf(w) {
  if (!w || w.length < 2) return null;
  if (/^(19[7-9]\d|20[0-4]\d)$/.test(w)) return { kind: 'year', v: w, label: 'Ano ' + w, test: g => String(g.year || '') === w };
  for (const [id, al] of Object.entries(SYS_ALIAS)) if (al.includes(w) && (id === 'pc' || S.systems[id] || S.games.some(g => g.system === id))) return { kind: 'sys', v: id, label: id === 'pc' ? 'PC' : (S.systems[id] || id), test: g => (g.system || 'pc') === id };
  const fl = SMART_WORDS[w];
  if (fl === 'light') return { kind: 'flag', v: fl, label: SMART_FLAG_NAME[fl], test: g => g.size > 0 && g.size < 1e9 };
  if (fl && FLAG_TEST[fl]) return { kind: 'flag', v: fl, label: SMART_FLAG_NAME[fl] || fl, test: FLAG_TEST[fl] };
  if (w.length >= 3) { const gn = genreIndex().get(w); if (gn) return { kind: 'gen', v: gn, label: gn, test: g => (g.genres || []).includes(gn) }; }
  return null;
}
function genreIndex() {
  if (S._gidx && S._gidxN === S.games.length) return S._gidx;
  const m = new Map(); for (const g of S.games) for (const x of (g.genres || [])) { const k = qnorm(x).replace(/\s+/g, ''); if (k && !m.has(k)) m.set(k, x); if (k.endsWith('s') && !m.has(k.slice(0, -1))) m.set(k.slice(0, -1), x); }
  m.set('rpg', m.get('rpg') || 'RPG'); S._gidx = m; S._gidxN = S.games.length; return m;
}
function smartChips() {
  const sm = S._smart || []; if (!S.q || !sm.length) return '';
  return `<div class="fchips smart"><span class="lbl">${I.search} Entendi:</span>${sm.map(x => `<span class="fchip ro">${esc(x.label)}</span>`).join('')}</div>`;
}
function activeChips() {
  const L = fltLabels(); if (!L.length && S.cat === 'all') return smartChips();
  return smartChips() + `<div class="fchips">${S.cat !== 'all' ? `<button class="fchip" onclick="S.cat='all';S.page=1;renderLibrary()" title="Remover">${esc((S.cats.find(c => c.id === S.cat) || {}).name || S.cat)}${I.x}</button>` : ''}${L.map(([k, id, nm]) => `<button class="fchip" onclick="toggleFlt('${k}',${jsq(id)})" title="Remover">${esc(nm)}${I.x}</button>`).join('')}${L.length + (S.cat !== 'all' ? 1 : 0) > 1 ? `<button class="lnk" onclick="clearFlt()">Limpar tudo</button>` : ''}</div>`;
}
function toggleFilt(force, id) {
  if (!id) return fpOpen(force);
  const f = $('#' + id); if (!f) return; const on = force !== undefined ? force : !f.classList.contains('on');
  if (on) document.querySelectorAll('.filt.on').forEach(x => { if (x !== f) x.classList.remove('on'); });
  f.classList.toggle('on', on); if (!on) return;
  const pop = f.querySelector('.pop'), b = f.querySelector('button').getBoundingClientRect();
  pop.style.maxHeight = ''; const r = pop.getBoundingClientRect(), pad = 8;
  let left = Math.max(pad, Math.min(b.right - r.width, innerWidth - r.width - pad)), top = b.bottom + 6;
  const room = innerHeight - top - pad;
  if (r.height > room) { if (b.top - 6 - pad > room && b.top - 6 - pad >= r.height) top = b.top - 6 - r.height; else pop.style.maxHeight = Math.max(200, room) + 'px'; }
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
}
function toggleFlt(kind, id) { const set = S.flt[kind]; set.has(id) ? set.delete(id) : set.add(id); S._fpreset = undefined; S.page = 1; renderLibrary(); renderRailX(); }
function flagOnly(id) { clearFlt(); S.flt.flags.add(id); S.page = 1; const want = id === 'fresh' ? 'store' : 'home'; if (S.view !== want) setView(want); else renderLibrary(); }
function clearFlt() { for (const k of FLT_KINDS) S.flt[k].clear(); S._fpreset = undefined; S.cat = 'all'; S.sort = 'az'; S.sortRev = false; S.page = 1; renderLibrary(); }
function sortKey() { return S.view === 'store' ? 'sort_store' : 'sort_by'; }
function setSort(id) { S.sort = id; S.page = 1; renderSortBtn(); renderLibrary(); const k = sortKey(); if (S.config[k] !== id) { S.config[k] = id; api.post('/api/config', { [k]: id }, { quiet: true }); } }
function sortForView(v) { const k = v === 'store' ? 'sort_store' : 'sort_by', def = v === 'store' ? 'fresh' : 'az'; const c = S.config[k]; return c && SORTS.some(x => x[0] === c) ? c : def; }
const HOME_ROWS = [['recent', 'Continuar jogando'], ['favorites', 'Favoritos'], ['added', 'Adicionados há pouco'], ['most', 'Mais jogados']];
function homeRows() {
  const hm = S.home, rows = S.config.home_rows || []; if (!hm || !rows.length || listMode()) return '';
  return rows.map(id => {
    const lab = (HOME_ROWS.find(r => r[0] === id) || [])[1]; if (!lab) return '';
    const keys = (hm.sections[id] || []).filter(k => hm.games[k]).slice(0, 14); if (!keys.length) return '';
    if (id === 'recent' && stageStyle() === 'estante') return `<div class="hrow wide" data-row="${id}"><div class="hrh"><h3>${lab}</h3><span>${keys.length}</span></div><div class="wrow">${keys.slice(0, 4).map(k => wideCard(hm.games[k])).join('')}</div></div>`;
    return `<div class="hrow" data-row="${id}"><div class="hrh"><h3>${lab}</h3><span>${keys.length}</span></div><div class="grid hrs">${keys.map((k, i) => cardHtml(hm.games[k], i)).join('')}</div></div>`;
  }).join('');
}
function wideCard(g) {
  const live = S.sessions && S.sessions[g.key], sub = [g.last_played ? cap(lastPlayedText(g.last_played)) : '', g.playtime >= 60 ? fmtTime(g.playtime) : '', g.status ? statusName(g.status) : ''].filter(Boolean).join(' · ');
  return `<div class="card wc${S.panelKey === g.key ? ' sel' : ''}" data-key="${esc(g.key)}"><div class="cov"><div class="ph">${esc(g.title)}</div><img src="/thumb/${enc(g.key)}?v=${g.cv || 0}" alt="" loading="lazy" decoding="async" class="${TH.ok.has(g.key) ? 'ld' : ''}" onload="this.classList.add('ld')" onerror="this.remove()"></div>
    <div class="wt"><b>${esc(g.title)}</b><small>${esc(sub) || '&nbsp;'}</small></div>${g.installed ? `<button class="qp ${live ? 'live' : ''}" data-qp="${esc(g.key)}" title="${live ? 'Em execução — clique para encerrar' : 'Jogar'}">${live ? I.x : I.play}</button>` : ''}</div>`;
}
function homeTop() {
  const hm = S.home;
  let h = `<div id="homeTop">`;
  if (hm && stageOn()) h += stageHtml(hm);
  if (hm) {
    const playing = hm.sections.playing || [];
    h += playing.map(k => { const g = hm.games[k], sess = S.sessions[k] || {}; if (!g) return ''; return `<div class="now"><img src="/thumb/${enc(k)}?v=${g.cv || 0}" onerror="this.remove()"><div style="flex:1"><b>${esc(g.title)}</b><span>Jogando agora · sessão de ${fmtTime(Date.now() / 1000 - (sess.since || Date.now() / 1000))} · total ${fmtTime(g.playtime)}</span></div><button class="btn s sm" onclick="openGame(${jsq(k)})">Detalhes</button><button class="btn d sm" onclick="stopGame(${jsq(k)})">Fechar jogo</button></div>`; }).join('');
  }
  return h + homeRows() + `</div>`;
}
const DESC = {};
const stageOn = () => S.config.home_spot !== false;
const short = (t, n = 220) => { t = (t || '').replace(/\s+/g, ' ').trim(); if (t.length <= n) return t; const cut = t.slice(0, n), i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? ')); return i > 80 ? cut.slice(0, i + 1) : cut.replace(/\s\S*$/, '') + '…'; };
const coverImg = (key, g) => `<div class="ph">${esc(g.title)}</div><img src="/thumb/${enc(key)}?v=${g.cv || 0}" alt="" loading="lazy" decoding="async" class="${TH.ok.has(key) ? 'ld' : ''}" onload="this.classList.add('ld')" onerror="this.remove()">`;
function gotoGrid() { if (S.view !== 'home') { setView('home'); setTimeout(gotoGrid, 350); return; } const g = $('#grid'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function playLbl(key) { const g = S.byKey[key]; return g && g.missing ? `${I.search} Localizar arquivo` : `${I.play} Jogar`; }
function stageHtml(hm) { return stageOn() ? stageBase(hm) : ''; }
function nowKey(hm) {
  hm = hm || S.home;
  const sk = S.panelKey || S.nowKey;
  if (sk && S.byKey[sk]) return [sk, 'Selecionado'];
  const rc = ((hm && hm.sections.recent) || []).find(k => S.byKey[k] && S.byKey[k].installed);
  if (rc) return [rc, 'Último jogado'];
  const any = S.games.find(g => g.installed && !g.hidden);
  return any ? [any.key, 'Da biblioteca'] : ['', ''];
}
function nowbarInner(key, label) {
  const g = S.byKey[key]; if (!g) return '';
  const live = S.sessions && S.sessions[key], sys = g.system && g.system !== 'pc' ? (S.systems[g.system] || g.system) : 'PC';
  const sub = [g.last_played ? cap(lastPlayedText(g.last_played)) : 'Nunca jogado', g.playtime >= 60 ? fmtTime(g.playtime) : '', sys, g.year || ''].filter(Boolean).join(' · ');
  return `<div class="nbcov" onclick="openGame(${jsq(key)})"><div class="ph">${esc(g.title)}</div><img src="/thumb/${enc(key)}?v=${g.cv || 0}" alt="" decoding="async" onload="this.classList.add('ld')" onerror="this.remove()"></div>
    <div class="nbtxt"><small class="nbl">${label}</small><h2 onclick="openGame(${jsq(key)})" title="${esc(g.title)}">${esc(g.title)}</h2><div class="nbsub">${esc(sub)}</div>
      <div class="nbacts">${!g.installed && g.avail ? `<button class="btn p xs" onclick="openGame(${jsq(g.avail)})">${I.dl} Baixar da Loja</button>` : `<button class="btn p xs" onclick="play(${jsq(key)})">${live ? I.x + ' Encerrar' : playLbl(key)}</button>`}<button class="btn s xs" onclick="openGame(${jsq(key)})">${I.info}<span>Detalhes</span></button><button class="btn s xs" onclick="openPath(${jsq(g.dir || '')},${jsq(key)})">${I.folder}<span>Pasta</span></button><button class="btn s xs ic ${g.fav ? 'on' : ''}" title="Favorito" onclick="toggleFav(${jsq(key)});this.classList.toggle('on')">${I.star}</button></div></div>`;
}
function nbHero(key) { const g = S.byKey[key]; return g && g.hero_ok ? `--nbimg:url('/hero/${enc(key)}?v=${g.cv || 0}')` : ''; }
function stageBase(hm) {
  const [key, label] = nowKey(hm); if (!key) return '';
  const h = nbHero(key);
  return `<div class="nowbar${h ? ' hb' : ''}" id="nowbar" data-key="${esc(key)}" data-ctx="game" style="${h}">${nowbarInner(key, label)}</div>`;
}
function nowbarFill() {
  const nb = $('#nowbar'); if (!nb || S.view !== 'home') return;
  const [key, label] = nowKey(); if (!key) return;
  const cvNow = String((S.byKey[key] || {}).cv || 0);
  if (nb.dataset.key === key && nb.dataset.label === label && nb.dataset.cv === cvNow) return;
  nb.dataset.key = key; nb.dataset.label = label; nb.dataset.cv = cvNow;
  const h = nbHero(key); nb.style.cssText = h; nb.classList.toggle('hb', !!h);
  nb.classList.remove('nbsw'); void nb.offsetWidth; nb.classList.add('nbsw');
  nb.innerHTML = nowbarInner(key, label);
}
const W_ART = {
  lib: `<svg viewBox="0 0 320 180"><rect x="18" y="26" width="92" height="128" rx="10" class="f1"/><rect x="26" y="34" width="76" height="92" rx="6" class="f2"/><rect x="34" y="132" width="60" height="12" rx="6" class="acc"/><g class="f1"><rect x="128" y="26" width="52" height="70" rx="6"/><rect x="190" y="26" width="52" height="70" rx="6"/><rect x="252" y="26" width="52" height="70" rx="6"/><rect x="128" y="106" width="52" height="48" rx="6"/><rect x="190" y="106" width="52" height="48" rx="6"/><rect x="252" y="106" width="52" height="48" rx="6"/></g><rect x="190" y="26" width="52" height="70" rx="6" class="sel"/></svg>`,
  store: `<svg viewBox="0 0 320 180"><rect x="18" y="22" width="284" height="60" rx="10" class="f1"/><rect x="30" y="34" width="120" height="10" rx="5" class="f3"/><rect x="30" y="52" width="70" height="8" rx="4" class="f2"/><rect x="230" y="38" width="60" height="26" rx="8" class="acc"/><g class="f1"><rect x="18" y="96" width="62" height="60" rx="6"/><rect x="92" y="96" width="62" height="60" rx="6"/><rect x="166" y="96" width="62" height="60" rx="6"/><rect x="240" y="96" width="62" height="60" rx="6"/></g><path d="M49 118v20m-9-8 9 8 9-8" class="ln"/><path d="M123 118v20m-9-8 9 8 9-8" class="ln"/></svg>`,
  emu: `<svg viewBox="0 0 320 180"><rect x="60" y="50" width="200" height="90" rx="26" class="f1"/><circle cx="108" cy="95" r="22" class="f2"/><rect x="104" y="80" width="8" height="30" rx="3" class="f3"/><rect x="93" y="91" width="30" height="8" rx="3" class="f3"/><circle cx="206" cy="84" r="8" class="acc"/><circle cx="228" cy="100" r="8" class="f3"/><circle cx="184" cy="100" r="8" class="f3"/><circle cx="206" cy="116" r="8" class="f3"/><rect x="146" y="92" width="28" height="6" rx="3" class="f3"/></svg>`,
  mods: `<svg viewBox="0 0 320 180"><path d="M120 40h40v18a12 12 0 0 0 24 0V40h40v40h-18a12 12 0 0 0 0 24h18v40h-40v-18a12 12 0 0 0-24 0v18h-40v-40h18a12 12 0 0 0 0-24h-18z" class="f1"/><path d="M80 40h40v40H80z" class="f2"/><rect x="60" y="130" width="200" height="12" rx="6" class="f2"/><rect x="60" y="130" width="130" height="12" rx="6" class="acc"/></svg>`,
  console: `<svg viewBox="0 0 320 180"><rect x="18" y="18" width="284" height="144" rx="10" class="f1"/><rect x="18" y="18" width="284" height="22" rx="10" class="f2"/><rect x="34" y="52" width="150" height="14" rx="6" class="f3"/><rect x="34" y="74" width="90" height="8" rx="4" class="f2"/><rect x="34" y="92" width="56" height="20" rx="6" class="acc"/><g class="f2"><rect x="34" y="124" width="40" height="28" rx="4"/><rect x="82" y="124" width="40" height="28" rx="4"/><rect x="130" y="124" width="40" height="28" rx="4"/><rect x="178" y="124" width="40" height="28" rx="4"/><rect x="226" y="124" width="40" height="28" rx="4"/></g><rect x="82" y="124" width="40" height="28" rx="4" class="sel"/></svg>`,
  look: `<svg viewBox="0 0 320 180"><g class="f1"><rect x="20" y="30" width="80" height="120" rx="10"/><rect x="120" y="30" width="80" height="120" rx="10"/><rect x="220" y="30" width="80" height="120" rx="10"/></g><rect x="30" y="40" width="60" height="60" rx="6" style="fill:#5c6b82"/><rect x="130" y="40" width="60" height="60" rx="6" style="fill:#22d3ee"/><rect x="230" y="40" width="60" height="60" rx="6" style="fill:#f59e0b"/><g class="f3"><rect x="30" y="112" width="44" height="8" rx="4"/><rect x="130" y="112" width="44" height="8" rx="4"/><rect x="230" y="112" width="44" height="8" rx="4"/></g><g class="f2"><rect x="30" y="128" width="60" height="8" rx="4"/><rect x="130" y="128" width="60" height="8" rx="4"/><rect x="230" y="128" width="60" height="8" rx="4"/></g></svg>`,
  hub: `<svg viewBox="0 0 320 180"><circle cx="160" cy="90" r="46" class="acc"/><path d="M143 66v48l40-24z" style="fill:var(--on-accent,#fff)"/><g class="f2"><circle cx="60" cy="50" r="12"/><circle cx="260" cy="50" r="12"/><circle cx="60" cy="130" r="12"/><circle cx="260" cy="130" r="12"/></g><g class="ln2"><path d="M72 56l44 20M248 56l-44 20M72 124l44-20M248 124l-44-20"/></g></svg>`,
};
const W_STEPS = [
  { art: 'lib', t: 'Biblioteca', d: 'O Ludrix junta num lugar só os jogos que você já tem no PC, os que baixar por aqui e as suas ROMs. Um clique seleciona o jogo e mostra a capa grande com o botão Jogar; botão direito abre os detalhes, favoritos, pasta e mais.' },
  { art: 'store', t: 'Store', d: 'Adicione fontes de jogos (sites, coleções do archive.org, listas .json). A Store mostra o que elas oferecem; baixou, o jogo entra na biblioteca sozinho — com capa e descrição buscadas automaticamente.' },
  { art: 'emu', t: 'Emuladores', d: 'Instale emuladores com um clique e traga suas ROMs. O Ludrix configura o caminho, guarda seus saves e abre cada jogo no emulador certo.' },
  { art: 'mods', t: 'Mods, redists e ferramentas', d: 'Ferramentas de mod e os VC++ e DirectX que os jogos pedem — tudo verificado e instalado daqui.' },
  { art: 'console', t: 'Modo Console e controle', d: 'Um programa à parte para a TV: monitor inteiro, capas numa esteira, temas próprios. Controle, teclado ou mouse. Abra em Ajustes › Ao jogar › Modo Console (ou pelo LudrixConsole.exe).' },
  { art: 'look', pick: true, t: 'Tema', d: 'Cada tema tem cor própria, organização da Biblioteca e versão clara e escura. Clique em um para aplicar na hora; dá para trocar depois em Ajustes › Aparência.' },
  { art: 'hub', t: 'Pronto', d: 'Para começar, adicione um jogo que já está no PC ou ligue uma fonte na Store. Cada botão mostra uma explicação ao passar o mouse; este tour fica em Ajustes › Sistema › Sobre.', last: true },
];
function firstRun() {
  if (S.config.bootstrap_done) return setupWizard();
  let el = $('#boot'); if (!el) { el = document.createElement('div'); el.id = 'boot'; el.className = 'boot'; document.body.append(el); }
  el.innerHTML = `<div class="bbox"><div class="blogo">${logoSvg()}</div><h2>LudrixHub</h2><p>Aguarde, últimos ajustes finais…</p><div class="bbar"><i id="bootBar"></i></div><small id="bootStep">Preparando…</small></div>`;
  requestAnimationFrame(() => el.classList.add('on'));
  const tick = async () => {
    const b = await api.get('/api/bootstrap').catch(() => null);
    if (b) { const pct = b.n ? Math.round(b.i / b.n * 100) : 5; $('#bootBar').style.width = Math.max(5, pct) + '%'; $('#bootStep').textContent = b.step || 'Preparando…'; }
    if (b && b.done) { S.config.bootstrap_done = true; $('#bootBar').style.width = '100%'; setTimeout(() => { el.classList.remove('on'); setTimeout(() => el.remove(), 400); setupWizard(); }, 500); return; }
    setTimeout(tick, 600);
  };
  tick();
}
const SETUP_STEPS = [
  { id: 'hello', t: 'Bem-vindo' }, { id: 'folder', t: 'Pasta dos jogos' }, { id: 'look', t: 'Aparência' }, { id: 'play', t: 'Ao jogar' }, { id: 'done', t: 'Pronto' },
];
let SW_I = 0;
function setupWizard(from = 0) {
  SW_I = from;
  let el = $('#welcome'); if (!el) { el = document.createElement('div'); el.id = 'welcome'; el.className = 'welcome'; document.body.append(el); }
  el.innerHTML = `<div class="setup"><aside class="ssteps" id="swSteps"></aside><section class="sbody"><div class="scontent" id="swBody"></div>
    <div class="snav"><button class="btn s sm" id="swBack" onclick="setupGo(-1)">Voltar</button><span class="sp"></span><button class="btn s sm" id="swSkip" onclick="setupDone()">Pular configuração</button><button class="btn p" id="swNext" onclick="setupGo(1)">Continuar</button></div></section></div>`;
  setupRender(); requestAnimationFrame(() => el.classList.add('on'));
}
function setupRender() {
  const st = SETUP_STEPS[SW_I], c = S.config;
  $('#swSteps').innerHTML = `<div class="slogo">${logoSvg()}<b>LudrixHub</b></div>` + SETUP_STEPS.map((x, i) => `<div class="sstep ${i === SW_I ? 'on' : i < SW_I ? 'ok' : ''}" onclick="SW_I=${i};setupRender()"><i>${i < SW_I ? I.check : i + 1}</i><span>${x.t}</span></div>`).join('') + `<small>Tudo isso pode ser mudado depois em Ajustes.</small>`;
  let h = '';
  if (st.id === 'hello') h = `<div class="shero">${logoSvg()}</div><h2>Bem-vindo ao LudrixHub</h2><p class="lead">Um lugar só para os seus jogos: os que já estão no PC, os que você baixar das suas fontes e os de console emulados — com capa, tempo jogado e tudo organizado.</p>
    <div class="sgrid">${[[I.grid, 'Biblioteca', 'Seus jogos com capa grande, favoritos e tempo jogado.'], [I.dl, 'Store', 'Baixe das fontes que você adicionar; o jogo entra na biblioteca sozinho.'], [I.gamepad, 'Emuladores', 'Consoles antigos com emulador instalado em um clique.'], [I.layout, 'Modo Console', 'Tela cheia para a TV, com controle, teclado ou mouse.']].map(([ic, t, d]) => `<div class="scard2">${ic}<b>${t}</b><span>${d}</span></div>`).join('')}</div>
    <p class="mut">São 4 passos rápidos: onde guardar os jogos, a aparência e o que fazer quando um jogo abre.</p>`;
  else if (st.id === 'folder') h = `<h2>Pasta dos jogos</h2><p class="lead">Os jogos baixados pelo Ludrix são extraídos e instalados nesta pasta. Escolha um disco com espaço — dá para mover depois, jogo por jogo.</p>
    <div class="sfolder"><div class="code" id="swDir">${esc(c.games_dir_effective || c.games_dir || 'games')}</div><button class="btn p sm" onclick="setupPickDir()">${I.folder} Escolher pasta…</button>${c.games_dir ? `<button class="btn s sm" onclick="setCfg({games_dir:''}).then(setupRender)">Usar a padrão</button>` : ''}</div>
    <div class="shint"><b>Dica</b> A pasta padrão fica junto do launcher, em <span class="code">games${SEP()}</span>. Jogos que você já tem instalados não são movidos — eles só entram na biblioteca.</div>`;
  else if (st.id === 'look') h = `<h2>Tema</h2><p class="lead">Cada tema muda cor, formas e a organização da Biblioteca. Clique em um para aplicar na hora.</p>${welcomePicker()}`;
  else if (st.id === 'play') { const cur = c.after_launch || 'ask'; h = `<h2>Ao abrir um jogo</h2><p class="lead">Vale para todo jogo aberto pelo launcher. Dá para trocar em Ajustes › Ao jogar.</p>
    <div class="sopts">${[['ask', I.help, 'Perguntar sempre', 'Antes de abrir, mostra as três opções abaixo (com "lembrar").'], ['minimize', I.tray, 'Minimizar para a bandeja', 'Some da barra de tarefas e volta quando o jogo fechar. Conta o tempo jogado.'], ['none', I.play, 'Só abrir o jogo', 'O launcher continua aberto normalmente.'], ['close', I.power, 'Fechar o launcher', 'Sai da memória por completo; o tempo da sessão não é contado.']].map(([v, ic, t, d]) => `<button class="sopt ${cur === v ? 'on' : ''}" onclick="setCfg({after_launch:'${v}'}).then(setupRender)">${ic}<div><b>${t}</b><span>${d}</span></div></button>`).join('')}</div>`; }
  else h = `<div class="shero">${I.check}</div><h2>Pronto</h2><p class="lead">Três formas de adicionar jogos à biblioteca:</p>
    <div class="sgrid acts">${[['addLocal()', I.plus, 'Adicionar um jogo que já tenho', 'Aponte o .exe ou a pasta; capa e descrição vêm sozinhas.'], ["setView('store')", I.dl, 'Ligar uma fonte na Store', 'Cole o link de um pacote .json ou de uma coleção do archive.org.'], ["setView('emulation')", I.gamepad, 'Instalar um emulador', 'PS1, PS2, GameCube, Wii e mais — com um clique.']].map(([fn, ic, t, d]) => `<button class="scard2" onclick="setupDone();${esc(fn)}">${ic}<b>${t}</b><span>${d}</span></button>`).join('')}</div>
    <p class="mut">Cada botão mostra uma explicação ao passar o mouse; em cada aba há "Precisa de ajuda?". O tour completo fica em Ajustes › Sistema › Sobre.</p>`;
  $('#swBody').innerHTML = h;
  $('#swBack').style.visibility = SW_I ? '' : 'hidden'; $('#swSkip').style.display = st.id === 'done' ? 'none' : '';
  $('#swNext').textContent = st.id === 'done' ? 'Começar a usar' : 'Continuar';
  const b = $('#swBody'); b.style.animation = 'none'; b.offsetHeight; b.style.animation = '';
}
async function setupPickDir() { const r = await api.post('/api/choose_folder', { what: 'games' }); if (r.native) { if (r.folder) { S._tourDir = r.folder; await loadCatalog(false); setupRender(); } return; } modal({ title: 'Pasta dos jogos', text: 'Digite o caminho completo (modo navegador não tem diálogo nativo).', input: S.config.games_dir || '', ok: 'Salvar', onOk: v => setCfg({ games_dir: v }).then(setupRender) }); }
function setupGo(d) { const n = SW_I + d; if (n >= SETUP_STEPS.length) return setupDone(); if (n < 0) return; SW_I = n; setupRender(); }
function setupDone() { welcomeDone(); }
let W_I = 0;
function welcomeTour(from = 0) {
  W_I = from;
  let el = $('#welcome'); if (!el) { el = document.createElement('div'); el.id = 'welcome'; el.className = 'welcome'; document.body.append(el); }
  el.innerHTML = `<div class="wbox"><div class="wart" id="wArt"></div><div class="wbody"><div class="wlogo">${logoSvg()}</div><h2 id="wTitle"></h2><p id="wDesc"></p>
    <div class="wnav"><div class="wdots" id="wDots"></div><span class="sp"></span><button class="btn s sm" id="wSkip" onclick="welcomeDone()">Pular</button><button class="btn s sm" id="wBack" onclick="welcomeGo(-1)">Voltar</button><button class="btn p sm" id="wNext" onclick="welcomeGo(1)">Próximo</button></div></div></div>`;
  welcomeRender(); requestAnimationFrame(() => el.classList.add('on'));
}
function welcomeRender() {
  const st = W_STEPS[W_I], box = $('#welcome .wbox');
  box.classList.toggle('last', !!st.last);
  box.classList.toggle('pick', !!st.pick);
  $('#wArt').innerHTML = st.pick ? welcomePicker() : W_ART[st.art]; $('#wTitle').textContent = st.t; $('#wDesc').textContent = st.d;
  $('#wDots').innerHTML = W_STEPS.map((_, i) => `<i class="${i === W_I ? 'on' : ''}" onclick="W_I=${i};welcomeRender()"></i>`).join('');
  $('#wBack').style.visibility = W_I ? '' : 'hidden'; $('#wSkip').style.display = st.last ? 'none' : '';
  $('#wNext').textContent = st.last ? 'Começar' : 'Próximo';
  const b = $('#welcome .wbody'); b.style.animation = 'none'; b.offsetHeight; b.style.animation = '';
}
function welcomePicker() {
  const c = S.config, cur = c.face || DEFAULT_FACE, th = c.theme || 'system';
  return `<div class="wfaces">${(S.faces || []).map(f => `<div class="wface ${cur === f.id ? 'on' : ''}" onclick="welcomePick(${jsq(f.id)})" title="${esc(f.description || '')}"><img class="pv" src="/api/theme/${enc(f.id)}/preview" alt=""><span>${esc(f.name)}</span></div>`).join('')}</div>
    <div class="seg wscheme">${[['system', 'Sistema'], ['dark', 'Escuro'], ['light', 'Claro']].map(([v, l]) => `<button class="${th === v ? 'on' : ''}" onclick="welcomeScheme('${v}')">${l}</button>`).join('')}</div>`;
}
async function welcomePick(id) { await pickFace(id); if ($('#welcome .wbox.pick')) $('#wArt').innerHTML = welcomePicker(); else if ($('#swBody')) setupRender(); }
async function welcomeScheme(v) { await setCfg({ theme: v }); if ($('#welcome .wbox.pick')) $('#wArt').innerHTML = welcomePicker(); else if ($('#swBody')) setupRender(); }
function welcomeGo(d) { const n = W_I + d; if (n >= W_STEPS.length) return welcomeDone(); if (n < 0) return; W_I = n; welcomeRender(); }
function welcomeDone() { const el = $('#welcome'); if (el) { el.classList.remove('on'); setTimeout(() => el.remove(), 300); } if (!S.config.welcome_done) { S.config.welcome_done = true; api.post('/api/config', { welcome_done: true }); } if (S._tourDir) { const d = S._tourDir; S._tourDir = ''; setTimeout(() => scanRun('windows', d), 400); } }
document.addEventListener('keydown', e => { const w = $('#welcome'); if (!w || !w.classList.contains('on') || $('#swBody')) return; if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); welcomeGo(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); welcomeGo(-1); } else if (e.key === 'Escape') { e.preventDefault(); welcomeDone(); } });
function toggleToolbarItem(id, on) { const cur = new Set(S.config.toolbar_items || ['search', 'cats', 'sort', 'bell']); on ? cur.add(id) : cur.delete(id); setCfg({ toolbar_items: TOOLBAR_ITEMS.map(x => x[0]).filter(x => cur.has(x)) }); }
document.addEventListener('click', e => { if (!e.target.closest('#filt')) $('#filt')?.classList.remove('on'); });
async function toggleHidden(key) { const r = await api.post('/api/hide', { key }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); const g = S.byKey[key]; if (g) { g.hidden = r.hidden; S._poolKey = ''; } if (S.home && S.home.games[key]) S.home.games[key].hidden = r.hidden; toast('ok', r.hidden ? 'Jogo oculto' : 'Jogo visível de novo', r.hidden ? 'Aparece de novo pelo filtro Situação › Ocultos ou pela busca.' : '', r.hidden ? [{ label: 'Desfazer', fn: () => toggleHidden(key) }] : undefined); if (S.view === 'home') { refreshHome(); renderLibrary(); } }
async function toggleFav(key) { const r = await api.post('/api/fav', { key }); const g = S.byKey[key]; if (g) { g.fav = r.fav; S._poolKey = ''; } document.querySelectorAll(`[data-fav="${CSS.escape(key)}"]`).forEach(b => b.classList.toggle('on', r.fav)); if (S.home && S.home.games[key]) S.home.games[key].fav = r.fav; if (S.view === 'home') refreshHome(); }
async function stopGame(key, force) {
  const title = (S.byKey[key] || S.det || {}).title || 'o jogo';
  if (!force) return modal({ title: 'Encerrar ' + title + '?', text: 'O processo é finalizado na hora, mesmo travado. Progresso não salvo dentro do jogo se perde.', ok: 'Encerrar', cancel: 'Não fazer nada', danger: true, onOk: () => stopGame(key, true) });
  const r = await api.post('/api/stop', { key }); if (r.error) toast('err', 'Não foi possível encerrar', r.error); else toast('', 'Encerrando ' + title + '…', ''); pollSoon();
}

async function installFromFile() {
  if (!S.config.native) { modal({ title: 'Instalar de arquivo', html: '<label class="ml">Caminho do arquivo (.zip/.7z/.rar/.iso)</label><input class="mi" id="ifPath"><label class="ml">Título (opcional)</label><input class="mi" id="ifTitle">', ok: 'Instalar', onOk: async () => { const r = await api.post('/api/local/install_file', { file: $('#ifPath').value.trim(), title: $('#ifTitle').value.trim() }); if (r.error) { toast('err', 'Não foi possível concluir', r.error); return false; } S.jobs[r.key] = { stage: 'extract', fraction: 0, detail: 'Iniciando…' }; qfabSync(); setView('downloads'); } }); return; }
  const r = await api.post('/api/local/install_file', {});
  if (r.error) return toast('err', 'Não foi possível concluir', r.error);
  if (r.ok === false) return;
  S.jobs[r.key] = { stage: 'extract', fraction: 0, detail: 'Iniciando…' }; qfabSync();
  toast('ok', 'Instalando', `${r.title} — acompanhe em Downloads.`); pollSoon();
}
function addGameMenu() {
  modal({ title: 'Adicionar jogo', text: 'O que você quer adicionar?', noOk: true, cancel: 'Fechar', html: `<div class="addmenu">
    <button onclick="$('#modal').classList.remove('on');addLocal()">${I.win}<div><b>${S.config.os === 'windows' ? 'Jogo de Windows' : 'Jogo instalado'}</b><small>${S.config.os === 'windows' ? 'Escolha o .exe de um jogo já instalado' : 'Escolha o executável (.exe roda pelo Wine; .sh / AppImage abrem direto)'}</small></div></button>
    <button onclick="$('#modal').classList.remove('on');scanWizard()" class="hl">${I.search}<div><b>Escanear pastas</b><small>Uma pasta com vários jogos (Windows ou ROMs): o que for jogo é separado, nomeado e adicionado de uma vez</small></div></button>
    <button onclick="$('#modal').classList.remove('on');addRom()">${I.disc}<div><b>Jogo emulado</b><small>Uma ROM/ISO avulsa — o console é detectado pela extensão</small></div></button>
    <button onclick="$('#modal').classList.remove('on');installFromFile()">${I.dl}<div><b>Instalar de arquivo baixado</b><small>Um .zip/.7z/.rar/.iso baixado pelo navegador — extraído em games\\ e adicionado</small></div></button>
    <button onclick="$('#modal').classList.remove('on');setView('emulation')">${I.folder}<div><b>Pasta de ROMs</b><small>Adicionar uma pasta inteira em Emuladores</small></div></button>
    <button onclick="$('#modal').classList.remove('on');importWizard()">${I.import}<div><b>Importar de outro launcher</b><small>Playnite, Heroic, Steam, Epic, GOG, RetroBat/ES-DE, LaunchBox, Pegasus, atalhos</small></div></button></div>` });
}
async function addRom(path, system) {
  const pv = await api.post('/api/rom/preview', { path: path || undefined });
  if (pv.cancel) return;
  if (!pv.native) return modal({ title: 'Adicionar ROM', html: '<label class="ml">Caminho completo do arquivo</label><input class="mi" id="rmPath" placeholder="D:\\Roms\\PS2\\jogo.iso">', ok: 'Continuar', onOk: () => addRom($('#rmPath').value.trim()) });
  if (pv.error) return toast('err', 'ROM', pv.error);
  const sysOpts = Object.entries(S.systems).filter(([id]) => id !== 'pc').sort((a, b) => a[1].localeCompare(b[1]));
  const sid = system || pv.system || '';
  const emuSel = s => { const list = (pv.emulators || {})[s] || []; return `<select class="mi" id="rmEmu" ${list.length ? '' : 'disabled'}>${list.length ? `<option value="">Padrão do console (${esc(list[0].title)})</option>` + list.slice(1).map(e => `<option value="${e.id}">${esc(e.title)}</option>`).join('') : '<option value="">Nenhum emulador instalado — configure em Emuladores</option>'}</select>`; };
  modal({ title: 'Adicionar ROM', wide: true, html: `
    <div class="romfile"><span class="ic">${I.disc}</span><div><b>${esc(pv.name)}</b><small>${esc(pv.folder)} · ${fmt(pv.size)}${pv.known ? ' · <em>já está na biblioteca</em>' : ''}</small></div><button class="btn s xs" onclick="$('#modal').classList.remove('on');addRom()">Trocar arquivo</button></div>
    <div class="romgrid">
      <div><label class="ml">Console ${pv.system ? '' : '<em class="warn">(não reconheci pela extensão — escolha)</em>'}</label><select class="mi" id="rmSys" onchange="$('#rmEmuWrap').innerHTML=RM_EMU(this.value)"><option value="" ${sid ? '' : 'selected'} disabled>— escolha —</option>${sysOpts.map(([id, n]) => `<option value="${id}" ${id === sid ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
      <div><label class="ml">Emulador para este jogo</label><span id="rmEmuWrap">${emuSel(sid)}</span></div>
    </div>
    <label class="ml">Nome na biblioteca</label><input class="mi" id="rmTitle" value="${esc(pv.title)}" placeholder="Nome do jogo">
    ${pv.siblings ? `<label class="mchk1"><input type="checkbox" id="rmAll"> Registrar a pasta inteira como pasta de ROMs deste console <small style="color:var(--muted2)">(+${pv.siblings} arquivo${pv.siblings > 1 ? 's' : ''} do mesmo tipo)</small></label>` : ''}
    <p class="mut" style="font-size:12px;margin:10px 0 0">Capa e informações são buscadas sozinhas depois de adicionar. BIOS, keys ou firmware, quando o console precisa, entram pelo guia do console em Emuladores.</p>`,
    ok: 'Adicionar', onOk: async () => {
      const s2 = $('#rmSys').value; if (!s2) { toast('err', 'ROM', 'Escolha o console'); return false; }
      const r = await api.post('/api/rom/add', { path: pv.path, system: s2, title: $('#rmTitle').value.trim(), emulator: $('#rmEmu')?.value || '', add_folder: !!$('#rmAll')?.checked });
      if (r.error) { toast('err', 'Não foi possível concluir', r.error); return false; }
      toast('ok', 'ROM adicionada', `${r.title} · ${S.systems[r.system] || r.system}`); await loadCatalog(false); setView('home'); openGame(r.key);
    } });
  window.RM_EMU = emuSel;
}

function askAfter(key) {
  const g = S.byKey[key] || {};
  modal({ title: `Abrir ${g.title || 'o jogo'}`, text: 'Enquanto o jogo estiver aberto:', noOk: true, cancel: 'Não fazer nada', html: `<div class="askrow">
    <button onclick="askGo(${jsq(key)},'minimize')">${I.tray}<div><b>Minimizar para a bandeja</b><small>Fica no ícone perto do relógio e volta quando o jogo fechar. Conta o tempo jogado.</small></div></button>
    <button onclick="askGo(${jsq(key)},'close')">${I.power}<div><b>Fechar o launcher</b><small>Mata o launcher da memória. O tempo dessa sessão não é contado.</small></div></button>
    <button onclick="askGo(${jsq(key)},'none')">${I.play}<div><b>Só abrir o jogo</b><small>O launcher continua aberto normalmente.</small></div></button></div>
    <label class="remember"><input type="checkbox" id="askRem"> Lembrar minha escolha (é possível mudar em Ajustes)</label>` });
  setTimeout(() => gpFocusFirst('.askrow button'), 50);
}
async function askGo(key, after) { const rem = $('#askRem')?.checked; $('#modal').classList.remove('on'); if (rem) await setCfg({ after_launch: after }); play(key, after); }

window.onCloseAsk = function () {
  if ($('#modal').classList.contains('on') && $('#closeRem')) return;
  modal({ title: 'Fechar o Ludrix?', text: 'O que fazer quando você clicar no X?', noOk: true, cancel: 'Não fazer nada', html: `<div class="askrow">
    <button onclick="closeGo('tray')">${I.tray}<div><b>Esconder na bandeja</b><small>Some da barra de tarefas e fica no ícone perto do relógio. Um clique nele traz o launcher de volta.</small></div></button>
    <button onclick="closeGo('quit')">${I.power}<div><b>Fechar o launcher</b><small>Sai por completo, inclusive da bandeja.</small></div></button></div>
    <label class="remember"><input type="checkbox" id="closeRem" checked> Lembrar minha escolha (é possível mudar em Ajustes)</label>` });
  setTimeout(() => gpFocusFirst('.askrow button'), 50);
};
async function closeGo(what) { const rem = $('#closeRem')?.checked; $('#modal').classList.remove('on'); if (rem) await setCfg({ close_action: what }); winCmd(what === 'tray' ? 'hide' : 'quit'); }

let ctxKey = null;
function ctxGameHead(g, key) {
  const meta = [g.genres && g.genres[0], g.creator || g.fr, g.kind === 'local' ? 'Instalado' : (g.sys || g.system || '')].filter(Boolean).slice(0, 2).join(' · ');
  return `<div class="ghead"><img src="/thumb/${enc(key)}?v=${g.cv || 0}" alt="" onerror="this.style.visibility='hidden'"><div><b>${esc(g.title || key)}</b>${meta ? `<span>${esc(meta)}</span>` : ''}</div></div>`;
}
function ctxItems(key, acts) { return acts.map(a => a.sep ? { sep: true } : { label: a.label, icon: a.icon, primary: a.primary, danger: a.danger, sub: a.sub ? ctxItems(key, a.sub) : undefined, fn: a.sub ? undefined : () => ctxDo(key, a.id) }); }
async function ctxMenu(key, x, y) {
  const g = S.byKey[key] || (S.home && S.home.games[key]) || {};
  if (ctxNativeOk()) {
    const acts = await api.get('/api/actions/' + enc(key));
    const meta = [g.genres && g.genres[0], g.creator || g.fr, g.kind === 'local' ? 'Instalado' : (g.sys || g.system || '')].filter(Boolean).slice(0, 2).join(' · ');
    return showCtx(ctxItems(key, acts), x, y, g.title || key, { key, title: g.title || key, sub: meta, html: ctxGameHead(g, key) });
  }
  ctxKey = key; const m = $('#ctx');
  const gh = ctxGameHead(g, key);
  m.innerHTML = gh + `<button disabled style="color:var(--muted)">carregando…</button>`; m.classList.add('on'); placeCtx(x, y);
  const acts = await api.get('/api/actions/' + enc(key)); if (ctxKey !== key) return;
  showCtxLocal(ctxItems(key, acts), x, y, '', gh); ctxKey = key;
}
function placeCtx(x, y) {
  const m = $('#ctx'); m.style.maxHeight = ''; const r = m.getBoundingClientRect(); const pad = 8, H = innerHeight, W = innerWidth;
  let top = y, left = x;
  if (left + r.width > W - pad) left = Math.max(pad, x - r.width);
  if (top + r.height > H - pad) top = y - r.height >= pad ? y - r.height : Math.max(pad, H - pad - r.height);
  m.classList.toggle('tall', r.height > H - 2 * pad);
  if (r.height > H - 2 * pad) { m.style.maxHeight = (H - 2 * pad) + 'px'; top = pad; }
  m.style.left = left + 'px'; m.style.top = top + 'px';
}
function closeCtx() { $('#ctx').classList.remove('on'); ctxKey = null; }
document.addEventListener('contextmenu', e => {
  if (e.target.closest('input,textarea,[contenteditable]')) return;
  const card = e.target.closest('.card'); if (card) { e.preventDefault(); return ctxMenu(card.dataset.key, e.clientX, e.clientY); }
  const fc = e.target.closest('.fcard'); if (fc) return;
  const sys = e.target.closest('[data-sys]'); if (sys) { e.preventDefault(); return sysMenu(sys.dataset.sys, e.clientX, e.clientY); }
  const repo = e.target.closest('[data-repo]'); if (repo) { e.preventDefault(); return repoMenu(repo.dataset.repo, e.clientX, e.clientY); }
  const rb = e.target.closest('.rb'); if (rb) { e.preventDefault(); return viewMenu(rb.dataset.view, e.clientX, e.clientY); }
  const tc = e.target.closest('.theme[data-theme]'); if (tc) { e.preventDefault(); return themeMenu(tc.dataset.theme, e.clientX, e.clientY); }
  if (e.target.closest('#rail,#brandBtn')) { e.preventDefault(); return appMenu(e.clientX, e.clientY); }
  if (e.target.closest('#detail')) { e.preventDefault(); if (S.det) return ctxMenu(S.det.key, e.clientX, e.clientY); return; }
  if (e.target.closest('#view,.top')) { e.preventDefault(); return viewMenu(S.view, e.clientX, e.clientY); }
});
document.addEventListener('click', e => { if (!e.target.closest('#ctx')) closeCtx(); }, true);
$('#view').addEventListener('scroll', () => { if (ctxKey !== null || $('#ctx').classList.contains('on')) closeCtx(); }, { passive: true });
async function ctxDo(key, id) {
  closeCtx();
  const g = S.byKey[key] || {};
  if (id.startsWith('status:')) return setStatus(key, id.slice(7));
  if (id === 'coll:new') return collNew(key);
  if (id.startsWith('coll:')) return collToggle(id.slice(5), key);
  switch (id) {
    case 'play': return play(key);
    case 'play_opt': return play(key, S.config.after_launch === 'ask' ? undefined : S.config.after_launch, undefined, true);
    case 'play_with': { const d = await api.get('/api/game/' + enc(key)); const opts = d.emu?.installed_options || []; if (opts.length < 2) return toast('', 'Só um emulador', 'Vincule outro em Emuladores → ⚙ do console.'); return chooseEmulator(key, opts, d.emu.emulator); }
    case 'stop': return stopGame(key);
    case 'install': return openGame(key);
    case 'details': return openGame(key);
    case 'fav': return toggleFav(key);
    case 'hide': return toggleHidden(key);
    case 'open_dir': { const d = S.det && S.det.key === key ? S.det : await api.get('/api/game/' + enc(key)); return openPath(d.dir, key); }
    case 'open_select': return api.post('/api/open_select', { key });
    case 'mark_played': { const r = await api.post('/api/game/played', { key, played: !(g.last_played > 0) }); if (!r.error) { toast('ok', g.last_played > 0 ? 'Marcado como nunca jogado' : 'Marcado como jogado', g.title || ''); loadCatalog(false); } return; }
    case 'copy_name': { const tt = (S.byKey[key] || S.det || {}).title || ''; return navigator.clipboard.writeText(tt).then(() => toast('ok', 'Nome copiado', tt)); }
    case 'copy_path': { const d = S.det && S.det.key === key ? S.det : await api.get('/api/game/' + enc(key)); const p = d.exe || d.dir || ''; return navigator.clipboard.writeText(p).then(() => toast('ok', 'Caminho copiado', p)); }
    case 'open_emu_dir': { const d = await api.get('/api/game/' + enc(key)); return openPath(d.emu && d.emu.emu_dir); }
    case 'config_emu': { const d = await api.get('/api/game/' + enc(key)); return api.post('/api/emulator/open', { id: d.emu.emulator }); }
    case 'choose_emu': { const d = await api.get('/api/game/' + enc(key)); const e = await api.get('/api/emulation'); const sys = e.systems[d.system]; const opts = sys.options.map(i => e.emulators[i]).filter(Boolean);
      return modal({ title: `Emulador para ${sys.name}`, text: 'Vale para todos os jogos desse console.', html: `<select class="mi" id="ceSel">${opts.map(o => `<option value="${o.id}" ${o.id === sys.emulator ? 'selected' : ''}>${esc(o.title)}${o.installed ? '' : ' (não instalado)'}</option>`).join('')}</select>`, ok: 'Aplicar', extra: 'Meu próprio emulador…', onExtra: () => addCustomEmu(), onOk: async () => { await api.post('/api/emulator/select', { system: d.system, id: $('#ceSel').value }); toast('ok', 'Emulador trocado', ''); } }); }
    case 'choose_exe': return chooseExe(key);
    case 'relocate': return relocateGame(key, null);
    case 'rename': return renameGame(key);
    case 'edit': return editGame(key);
    case 'metadata': { const m = await api.post('/api/metadata', { key, force: true }); if (!m.error) { toast('ok', 'Metadados atualizados', [].concat(m.source || []).join(' + ') || 'nada novo'); loadCatalog(false); if (S.det && S.det.key === key) openGame(key); } else toast('err', 'Metadados', m.error); return; }
    case 'mods': { await openGame(key); setTimeout(() => $('#dMods')?.scrollIntoView({ behavior: 'smooth' }), 300); return; }
    case 'saves': return savesPanel(key);
    case 'cover': return setCover(key);
    case 'cover_web': return api.post('/api/open_url', { url: 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(`${g.title || ''} ${g.system && g.system !== 'pc' ? (S.systems[g.system] || g.system) : 'pc'} cover art`) });
    case 'edit_notes': return editGame(key, 'avancado');
    case 'score': return editGame(key, 'avancado');
    case 'cover_reset': return resetCover(key);
    case 'page': { const d = await api.get('/api/game/' + enc(key)); return api.post('/api/open_url', { url: d.page_url }); }
    case 'shortcut': { const r = await api.post('/api/shortcut/desktop', { key }); return r && r.error ? toast('err', 'Atalho', r.error) : toast('ok', 'Atalho criado', 'Na área de trabalho'); }
    case 'cover_set': return setCover(key);
    case 'open_folder': { const d = S.det && S.det.key === key ? S.det : await api.get('/api/game/' + enc(key)); return openPath(d.dir, key); }
    case 'set_exe': return chooseExe(key);
    case 'remove': case 'uninstall': return confirmUninstall(key);
    default: toast('warn', 'Ação indisponível', id); return;
  }
}

function storeTabs() { return `<div class="tabs" style="margin-top:10px"><button class="${S.tab.store === 'games' ? 'on' : ''}" onclick="S.tab.store='games';renderView()">Baixar novos games</button><button class="${S.tab.store === 'sources' ? 'on' : ''}" onclick="S.tab.store='sources';renderView()">Fontes (repositórios)</button></div>`; }
async function renderSources() {
  const repos = await api.get('/api/repos'); if (S.view !== 'store') return;
  const kindName = { pc: 'Jogos PC', rom: 'ROMs', recomp: 'Ports / recompilações' };
  const typeName = { telegram: 'canal do Telegram (bot lê posts com .torrent)', webpage: 'página da web (links diretos / torrents)', archive_uploader: 'coleção de um uploader', archive_creator: 'coleção de um criador', archive_item: 'pacote (um arquivo por jogo)', archive_search: 'busca', github_release: 'releases do GitHub', manifest: 'lista .json', local_folder: 'pasta do PC' };
  $('#view').innerHTML = storeTabs() + `
    <div class="h1"><h2>Fontes de jogos</h2><span>${repos.length ? `${repos.filter(r => r.enabled).length} de ${repos.length} ligadas` : 'de onde a Store puxa o catálogo'}</span><div class="acts">${repos.some(r => r.enabled) ? `<button class="btn s" onclick="repoLinksTest('', '')" title="Testa uma amostra dos links diretos de cada fonte ligada">${I.link} Testar links</button>` : ''}<button class="btn s" onclick="sourceMaker()" title="Monta um .json de fonte a partir de uma pasta com os arquivos dos jogos">${I.plus} Criar fonte</button><button class="btn s" onclick="addRepo()">${I.cog} Manual (avançado)</button></div></div>
    <div class="hint">Cole um link ou escolha um arquivo .json com fontes de jogos ${help('Uma fonte é uma lista de jogos que a Store lê: um arquivo .json (local ou por link), uma coleção do archive.org, uma página com downloads, um repositório do GitHub ou uma pasta do PC.')} <a href="#" class="fmtlink" onclick="api.post('/api/open_url',{url:'https://github.com/wolffZ-prog/Ludrix/blob/main/docs/FONTES.md'});return false">formato do .json</a>${ONLINE ? '' : ' <span class="offl">Sem internet — conecte-se para ligar fontes e baixar.</span>'}</div>
    <div class="detbox"><div class="mrow"><input class="mi" id="detq" placeholder="https://…/fontes.json  ·  archive.org/details/@usuario  ·  página com jogos  ·  GitHub  ·  pasta do PC" onkeydown="if(event.key==='Enter')doDetect()"><button class="btn p sm" onclick="doDetect()">${I.search} Analisar</button>${S.config.native ? `<button class="btn s sm" onclick="pickSourceJson()">${I.doc} Arquivo .json</button><button class="btn s sm" title="Pasta do PC com jogos ou ROMs" onclick="api.post('/api/choose_folder',{what:'any'}).then(r=>{if(r.folder){$('#detq').value=r.folder;doDetect()}})">${I.folder} Pasta</button>` : ''}</div>
    </div>
    <div class="browse" id="browse"></div>
    <div class="gh"><h3>Suas fontes</h3><span>botão direito numa fonte mostra mais opções</span></div>
    ${repos.length ? '' : `<div class="empty" style="padding:24px 0 16px"><b>Nenhuma fonte ainda</b>Cole um link acima ou use Manual (avançado).</div>`}
    <div class="srcs">${repos.map(r => `<div class="src ${r.enabled ? 'on' : ''} ${!ONLINE && !r.enabled ? 'off' : ''}" data-repo="${esc(r.id)}" title="${ONLINE ? 'Botão direito: mais opções' : 'Sem internet'}"><div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><b>${esc(r.name)}</b><button class="sw ${r.enabled ? 'on' : ''}" ${!ONLINE && !r.enabled ? 'disabled title="Sem conexão com a internet"' : ''} onclick="event.stopPropagation();if(!ONLINE&&!${r.enabled})return toast('err','Sem internet','Conecte-se para ligar essa fonte.');api.post('/api/repos/toggle',{id:${jsq(r.id)},enabled:${!r.enabled}}).then(()=>{renderSources();loadCatalog(false)})"></button></div><span>${[typeName[r.type] || r.type, kindName[r.kind] || r.kind, r.system && r.system !== 'pc' ? (S.systems[r.system] || r.system) : ''].filter(Boolean).map(esc).join(' · ')}</span><span class="n">${r.error ? `<span class="rep bad" title="${esc(r.error)}">${I.warn} não carregou</span>` : r.report ? `<a href="#" class="rep ${r.report.errors.length ? 'bad' : r.report.warnings.length ? 'warn' : 'ok'}" onclick="event.stopPropagation();repoReport(${jsq(r.id)});return false" title="Ver relatório do JSON">${esc(r.report.summary)}</a>` : r.enabled ? `${r.count} ${r.count === 1 ? 'jogo' : 'jogos'}` : 'desligada'}${r.enabled && r.checked_at ? `<em class="age" title="${esc(new Date(r.checked_at * 1000).toLocaleString('pt-BR'))}${r.fetch_ms ? ` · respondeu em ${r.fetch_ms < 1000 ? r.fetch_ms + ' ms' : (r.fetch_ms / 1000).toFixed(1) + ' s'}` : ''}">lida ${ago(r.checked_at)}${r.fetch_ms ? ` · ${r.fetch_ms < 1000 ? r.fetch_ms + ' ms' : (r.fetch_ms / 1000).toFixed(1) + ' s'}` : ''}</em>` : ''}${r.enabled && r.links ? `<em class="age lk ${r.links.dead ? 'bad' : 'ok'}" title="Links diretos testados ${esc(new Date(r.links.at * 1000).toLocaleString('pt-BR'))}: ${r.links.ok} de ${r.links.tested} responderam">${r.links.dead ? `${r.links.dead} de ${r.links.tested} links fora do ar` : `links ok (${r.links.tested} testados)`}</em>` : ''}${r.new_count ? `<a href="#" class="fresh" title="Ver os jogos novos dessa fonte" onclick="event.stopPropagation();S.tab.store='games';flagOnly('fresh');S.flt.repos.add(${jsq(r.id)});renderLibrary();return false">${r.new_count} ${r.new_count === 1 ? 'novo' : 'novos'}</a>` : ''}${r.builtin ? '' : `<button class="srcedit" title="Editar fonte" onclick="event.stopPropagation();editRepo(${jsq(r.id)})">${I.edit}</button>`}</span>${r.note ? `<span class="u" style="direction:ltr" title="${esc(r.note)}">${esc(r.note)}</span>` : ''}${r.url ? `<span class="u" title="${esc(r.url)}">${esc(r.url.replace(/^https?:\/\/(www\.)?/, '').replace(/^[A-Za-z]:\\/, ''))}</span>` : ''}</div>`).join('')}</div>`;
  setTimeout(() => $('#detq')?.focus(), 50);
}
function reportHtml(rep) {
  const li = (x, cls) => `<li class="${cls}"><span>${esc(x.at)}</span>${esc(x.msg)}</li>`;
  return `<div class="repbox"><p class="repsum">${esc(rep.summary || '')}${rep.format === 'hydra' ? ' · formato Hydra' : ''}</p>
    ${rep.errors.length ? `<h5>Erros — o item é ignorado</h5><ul class="replist">${rep.errors.map(x => li(x, 'bad')).join('')}</ul>` : ''}
    ${rep.warnings.length ? `<h5>Avisos — entra mesmo assim</h5><ul class="replist">${rep.warnings.map(x => li(x, 'warn')).join('')}</ul>` : ''}
    ${!rep.errors.length && !rep.warnings.length ? '<p class="mut">Nenhum problema encontrado.</p>' : ''}
    <p class="mut" style="margin:10px 0 0;font-size:12px">Formato esperado: <a href="#" onclick="api.post('/api/open_url',{url:'https://github.com/wolffZ-prog/Ludrix/blob/main/docs/FONTES.md'});return false">docs/FONTES.md</a></p></div>`;
}
async function repoReport(id) {
  const repos = await api.get('/api/repos'); const r = (repos || []).find(x => x.id === id); if (!r || !r.report) return toast('', 'Sem relatório', 'Essa fonte ainda não foi lida.');
  modal({ title: `Relatório — ${r.name}`, wide: true, html: reportHtml(r.report), noCancel: true, ok: 'Fechar' });
}
async function doDetect() {
  const q = $('#detq').value.trim(); if (!q) return; const box = $('#browse'); box.innerHTML = '<div class="empty" style="padding:30px 0"><b>Analisando…</b>abrindo a página, lendo os links e classificando</div>';
  const r = await api.get('/api/detect?q=' + enc(q), { timeout: 180000 });
  S._det = r.results || [];
  if (r.link) { box.innerHTML = `<div class="empty" style="padding:24px 0"><b>Isso é um arquivo no ${esc(r.host)}</b>Fonte é um lugar com vários jogos; um link de arquivo é <b>baixado direto</b> e instalado como jogo.<br><button class="btn p sm" style="margin-top:10px" onclick="linkDownload(${jsq(r.link)})">${I.dl} Baixar de link</button></div>`; return; }
  if (r.error && !S._det.length) return box.innerHTML = `<div class="empty" style="padding:30px 0"><b>Não foi possível usar</b>${esc(r.error)}</div>`;
  if (!S._det.length) return box.innerHTML = '<div class="empty" style="padding:30px 0"><b>Nada encontrado</b>Nenhum arquivo de jogo (ROMs, .exe, .7z/.zip/.iso), magnet ou .torrent nesse lugar.</div>';
  const sysOpts = Object.entries(S.systems).map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('');
  const kindLabel = k => k === 'rom' ? '<span class="pill rom">ROMs</span>' : k === 'recomp' ? '<span class="pill rc">Ports / recompilações</span>' : '<span class="pill pc">Jogos PC</span>';
  if (r.page) {
    const x = S._det[0], pg = r.page, games = r.games || [];
    const row = g => { const d = (g.files || []).length, t = !!(g.magnet || g.torrent_url); return `<div class="pgrow"><b title="${esc(g.title)}">${esc(g.title)}</b><span>${d ? `<i class="pill ok">${d} direto${d > 1 ? 's' : ''}</i>` : ''}${t ? `<i class="pill">${I.magnet} torrent</i>` : ''}<em>${esc(g.host || '')}</em></span></div>`; };
    box.innerHTML = `<div class="brow grp"><div><b>${esc(x.title)}</b><span>${kindLabel(x.kind)} ${esc(x.detail || '')}</span></div>
        <div class="ac"><select id="dk0" onchange="$('#ds0').style.display=this.value==='rom'?'':'none'"><option value="pc" ${x.kind !== 'rom' ? 'selected' : ''}>Jogos PC</option><option value="rom" ${x.kind === 'rom' ? 'selected' : ''}>ROMs</option></select><select id="ds0" style="${x.kind === 'rom' ? '' : 'display:none'}">${sysOpts}</select><button class="btn p sm" onclick="detectAdd(0)">+ Adicionar fonte</button></div></div>
      <div class="pgsum"><span><b>${pg.direct}</b> links diretos</span><span><b>${pg.torrent}</b> torrents${S.torrent ? '' : ' <small>(abrem no seu cliente de torrent)</small>'}</span><span><b>${pg.hard_count}</b> ignorados <small>(acesso difícil)</small></span><span><b>${pg.pages}</b> página${pg.pages > 1 ? 's lidas' : ' lida'}</span></div>
      <div class="pglist">${games.slice(0, 60).map(row).join('')}${games.length > 60 ? `<div class="pgrow more">… e mais ${games.length - 60}</div>` : ''}</div>`;
    return;
  }
  if (r.pack) {
    const rows = S._det.map((x, i) => `<div class="brow"><div><b>${esc(x.title)}</b><span>${kindLabel(x.kind)} ${esc(x.detail || '')}${x.report && (x.report.errors.length || x.report.warnings.length) ? ` · <a href="#" onclick="modal({title:'Relatório do JSON',wide:true,html:reportHtml(S._det[${i}].report),noCancel:true,ok:'Fechar'});return false" style="color:var(${x.report.errors.length ? '--amber' : '--accent2'})">${x.report.errors.length ? pl(x.report.errors.length, 'erro', 'erros') : pl(x.report.warnings.length, 'aviso', 'avisos')}</a>` : ''}</span></div><div class="ac"><button class="btn p sm" onclick="addSource(S._det[${i}].cfg)">+ Adicionar</button></div></div>`).join('');
    box.innerHTML = (S._det.length > 1 ? `<div class="brow grp"><div><b>${esc(r.pack)}</b><span>${pl(S._det.length, 'fonte', 'fontes')}</span></div><div class="ac"><button class="btn p sm" onclick="addPack()">+ Adicionar tudo</button></div></div>` : '') + rows;
    return;
  }
  const head = r.kind === 'mixed' ? 'PC e ROMs misturados — escolha item por item:' : r.kind === 'rom' ? 'Reconheci como <b>ROMs</b>:' : 'Reconheci como <b>jogos de PC</b>:';
  box.innerHTML = `<p style="color:var(--muted);font-size:12.5px;margin:4px 0 6px">${head}</p>` + S._det.map((x, i) => `<div class="brow ${x.group ? 'grp' : ''}"><div><b title="${esc(x.identifier || '')}">${esc(x.title)}</b><span>${kindLabel(x.kind)} ${esc(x.detail || '')}${x.creator ? ' · ' + esc(x.creator) : ''}</span></div>
    <div class="ac"><select id="dk${i}" onchange="$('#ds${i}').style.display=this.value==='rom'?'':'none'"><option value="pc" ${x.kind !== 'rom' ? 'selected' : ''}>Jogos PC</option><option value="rom" ${x.kind === 'rom' ? 'selected' : ''}>ROMs</option></select><select id="ds${i}" style="${x.kind === 'rom' ? '' : 'display:none'}">${sysOpts}</select><button class="btn p sm" onclick="detectAdd(${i})">+ Adicionar</button>${x.identifier ? `<button class="btn s sm" title="Abrir a página de origem" onclick="api.post('/api/open_url',{url:'https://archive.org/details/${esc(x.identifier)}'})">${I.ext}</button>` : ''}</div></div>`).join('');
  S._det.forEach((x, i) => { const s = $('#ds' + i); if (s && x.system && x.system !== 'pc') s.value = x.system; });
}
async function detectAdd(i) {
  const x = S._det[i]; const kind = $('#dk' + i).value, sys = kind === 'rom' ? $('#ds' + i).value : 'pc';
  const cfg = { ...x.cfg, kind: kind === 'rom' ? 'rom' : (x.cfg.kind === 'recomp' ? 'recomp' : 'pc'), system: sys };
  if (cfg.type === 'archive_search' && kind === 'rom' && (x.count_rom + x.count_pc) > 1) cfg.type = 'archive_item', cfg.identifier = x.identifier;
  await addSource(cfg);
}
async function addPack() { for (const x of S._det) { const r = await api.post('/api/repos/add', x.cfg); if (r.error) toast('err', x.title, r.error); } toast('ok', 'Fontes adicionadas', 'Carregando na Store…'); if (S.tab.store === 'sources') renderSources(); loadCatalog(false); }
async function pickSourceJson() { const r = await api.post('/api/pick_exe', { kind: 'json', initial: '' }); if (r && r.file) { $('#detq').value = r.file; doDetect(); } }
const SG = { dir: '', games: [], name: '', base: '', hash: true };
async function sourceMaker() {
  const body = () => `
    <div class="sgf"><label>Nome da fonte</label><input class="mi" id="sgName" value="${esc(SG.name)}" placeholder="Lista do Fulano" oninput="SG.name=this.value"></div>
    <div class="sgf"><label>Pasta com os arquivos dos jogos</label><div class="mrow"><input class="mi" id="sgDir" value="${esc(SG.dir)}" placeholder="D:\\Jogos\\pacotes" readonly><button class="btn s" onclick="sgPick()">${I.folder} Escolher…</button></div></div>
    <div class="sgf"><label>Onde esses arquivos vão ficar na internet (URL base)</label><input class="mi" id="sgBase" value="${esc(SG.base)}" placeholder="https://meusite.com/jogos/" oninput="SG.base=this.value.trim()"><small class="dim">O nome de cada arquivo é colocado depois dessa URL. Vazio = fica um aviso no lugar do link para preencher depois.</small></div>
    <label class="sgck"><input type="checkbox" ${SG.hash ? 'checked' : ''} onchange="SG.hash=this.checked"><span>Calcular sha256 de cada arquivo <small class="dim">— recomendado: o Ludrix confere o download; demora em arquivos grandes</small></span></label>
    <div id="sgList">${sgListHtml()}</div>`;
  modal({ title: 'Criar fonte (.json)', wide: true, html: body(), ok: 'Gerar .json', onOk: async () => {
    if (!SG.dir || !SG.games.length) { toast('warn', 'Escolha uma pasta com arquivos de jogos'); return false; }
    const games = SG.games.filter(g => g.on && g.title.trim()).map(g => ({ id: g.id, title: g.title.trim(), version: g.version, year: g.year, files: g.files.map(f => f.rel) }));
    if (!games.length) { toast('warn', 'Nenhum jogo marcado'); return false; }
    const r = await api.post('/api/repos/gen/make', { name: SG.name, dir: SG.dir, base_url: SG.base, hash: SG.hash, games });
    if (r && r.cancel) return false;
    if (!r || r.error) { toast('err', 'Não deu para gerar', (r && r.error) || ''); return false; }
    toast('info', 'Gerando a fonte…', SG.hash ? 'Acompanhe na Fila — o sha256 de arquivos grandes leva um tempo.' : 'Quase instantâneo.');
  } });
}
function sgListHtml() {
  if (!SG.dir) return '<div class="empty sg" style="padding:14px 0 4px">Escolha a pasta: cada arquivo (.zip, .7z, .rar, .iso…) ou subpasta vira um jogo. Arquivos em partes (.part1.rar, .001) são agrupados.</div>';
  if (!SG.games.length) return '<div class="empty sg" style="padding:14px 0 4px"><b>Nada encontrado</b>Nenhum arquivo de jogo nessa pasta (procuro na pasta e em 1 nível de subpastas).</div>';
  const n = SG.games.filter(g => g.on).length, tot = SG.games.filter(g => g.on).reduce((a, g) => a + g.size, 0);
  return `<div class="gh" style="margin-top:10px"><h3>${n} jogo${n === 1 ? '' : 's'} · ${fmt(tot)}</h3><span>confira os títulos antes de gerar</span></div>
    <div class="sgrows">${SG.games.map((g, i) => `<div class="sgrow ${g.on ? '' : 'off'}"><input type="checkbox" title="Incluir" ${g.on ? 'checked' : ''} onchange="SG.games[${i}].on=this.checked;$('#sgList').innerHTML=sgListHtml()">
      <input class="mi t" value="${esc(g.title)}" placeholder="Título" oninput="SG.games[${i}].title=this.value">
      <input class="mi v" value="${esc(g.version)}" placeholder="versão" title="Versão (opcional)" oninput="SG.games[${i}].version=this.value.trim()">
      <input class="mi y" value="${esc(g.year)}" placeholder="ano" maxlength="4" title="Ano (opcional)" oninput="SG.games[${i}].year=this.value.trim()">
      <span class="dim" title="${esc(g.files.map(f => f.name).join('\n'))}">${g.files.length} arq. · ${fmt(g.size)}</span></div>`).join('')}</div>`;
}
async function sgPick() {
  const r = await api.post('/api/repos/gen/scan', { dir: '', initial: SG.dir });
  if (!r || r.cancel) return;
  if (r.error) return toast('err', 'Não deu para ler a pasta', r.error);
  SG.dir = r.dir; SG.games = (r.games || []).map(g => ({ ...g, on: true }));
  if (!SG.name) { SG.name = r.dir.split(/[\\/]/).filter(Boolean).pop() || ''; const n = $('#sgName'); if (n) n.value = SG.name; }
  const d = $('#sgDir'); if (d) d.value = SG.dir;
  $('#sgList').innerHTML = sgListHtml();
}
function sourceMade(out) {
  if (!out) return;
  modal({ title: 'Fonte pronta', html: `<p>Arquivo gravado em:</p><p><code>${esc(out)}</code></p><p class="dim">Publique esse .json num link (GitHub, Drive público, seu site) e compartilhe o link — quem colar na Store do Ludrix vê os jogos. Você também pode usar o arquivo local como fonte agora para testar.</p>`,
    ok: 'Usar como fonte agora', extra: 'Abrir pasta', onExtra: () => openPath(out), onOk: async () => { await addSource({ url: out, name: SG.name || 'Minha fonte', kind: 'pc', type: 'manifest' }); S.tab.store = 'sources'; if (S.view === 'store') renderSources(); else setView('store'); } });
}
async function addSource(cfg) { const r = await api.post('/api/repos/add', cfg); if (r.error) return toast('err', 'Não foi possível concluir', r.error); toast('ok', 'Fonte adicionada', cfg.name + ' — carregando na Store…'); if (S.tab.store === 'sources') renderSources(); loadCatalog(false); }

async function renderMods() {
  $('#view').innerHTML = `<div class="h1"><h2>Mods</h2><span>carregando…</span></div>`;
  const m = await api.get('/api/mods'); S.mods = m; if (S.view !== 'mods') return;
  const cats = [...new Set(m.tools.map(t => t.category))];
  let cur = S.tab.mods; if (!['mine', 'tools', 'learn'].includes(cur)) cur = cats.includes(cur) ? (S.modsCat = cur, 'tools') : 'mine'; S.tab.mods = cur;
  const nInst = m.tools.filter(t => t.installed).length, nMods = m.games.reduce((a, g) => a + g.count, 0);
  const sub = cur === 'mine' ? `${nMods ? pl(nMods, 'mod', 'mods') + ' em ' + pl(m.games.length, 'jogo', 'jogos') : 'nenhum mod instalado ainda'}` : cur === 'tools' ? `${nInst} de ${m.tools.length} instaladas` : 'o básico em 2 minutos';
  let h = `<div class="h1"><h2>Mods</h2><span>${sub}</span><div class="acts">${cur === 'tools' ? `<button class="btn s" onclick="openPath(${jsq(m.root)})" title="Pasta onde as ferramentas portáteis ficam">${I.folder} Pasta tools</button>` : ''}</div></div>
    <div class="tabs"><button class="${cur === 'mine' ? 'on' : ''}" onclick="S.tab.mods='mine';renderMods()">Por jogo${m.games.length ? ` <span class="n">${m.games.length}</span>` : ''}</button><button class="${cur === 'tools' ? 'on' : ''}" onclick="S.tab.mods='tools';renderMods()">Ferramentas${nInst ? ` <span class="n">${nInst}</span>` : ''}</button><button class="${cur === 'learn' ? 'on' : ''}" onclick="S.tab.mods='learn';renderMods()">Entenda mods</button></div>`;
  if (cur === 'mine') { $('#view').innerHTML = h + `<div id="myMods"></div>`; return renderMyMods(); }
  if (cur === 'learn') { $('#view').innerHTML = h + modsLearnHtml(); return; }
  const fc = S.modsCat || '';
  const chips = `<div class="chips" style="margin:0 0 14px"><button class="chip ${!fc ? 'on' : ''}" onclick="S.modsCat='';renderMods()">Todas <span class="n">${m.tools.length}</span></button><button class="chip ${fc === '__inst' ? 'on' : ''}" onclick="S.modsCat='__inst';renderMods()">Instaladas <span class="n">${nInst}</span></button>${cats.map(c => `<button class="chip ${fc === c ? 'on' : ''}" onclick="S.modsCat=${jsq(c)};renderMods()">${esc(c)} <span class="n">${m.tools.filter(t => t.category === c).length}</span></button>`).join('')}</div>`;
  const card = t => { const job = S.jobs['tool:' + t.id]; return `<div class="toolc ${t.installed ? 'ok' : ''}"><div class="th"><span class="ic">${t.installed ? I.check : I.wrench}</span><div class="tt"><b>${esc(t.title)}</b><small>${esc(t.category)}</small></div>${t.installed && t.version ? `<span class="pill">${esc(t.version)}</span>` : ''}</div>
    <p>${esc(t.desc)}</p><div class="for"><b>Para:</b> ${esc(t.for)}</div>
    ${job ? progHtml(job, 'tool:' + t.id) : `<div class="ta">${t.installed ? `<button class="btn p sm" onclick="api.post('/api/tools/launch',{id:'${t.id}'})">${I.play} Abrir</button><button class="btn s sm ico" title="Abrir pasta" onclick="openPath(${jsq(t.dir)})">${I.folder}</button><button class="btn s sm ico" title="Remover" onclick="removeTool('${t.id}',${jsq(t.title)})">${I.trash}</button>` : t.type === 'github_release' ? `<button class="btn p sm" onclick="installTool('${t.id}')">${I.dl} Baixar</button><span class="mut">portátil, fica em tools\\</span>` : `<button class="btn s sm" onclick="api.post('/api/open_url',{url:${jsq(t.url || '')}})">${I.ext} Site oficial</button>`}</div>`}</div>`; };
  const list = fc === '__inst' ? m.tools.filter(t => t.installed) : fc ? m.tools.filter(t => t.category === fc) : m.tools;
  h += chips;
  if (!list.length) h += emptyHtml(I.wrench, 'Nenhuma ferramenta instalada', 'As ferramentas do GitHub são baixadas pelo Ludrix e ficam portáteis em tools\\. Escolha uma categoria para ver as disponíveis.', [['Ver todas', "S.modsCat='';renderMods()", 1]]);
  else if (fc) h += `<div class="toolgrid">${list.map(card).join('')}</div>`;
  else h += cats.map(c => `<div class="tsec"><h4>${esc(c)}<span>${m.tools.filter(t => t.category === c).length}</span></h4><div class="toolgrid">${m.tools.filter(t => t.category === c).map(card).join('')}</div></div>`).join('');
  $('#view').innerHTML = h;
}
function modsLearnHtml() {
  const c = (icon, t, b) => `<div class="mlearn"><span class="ic">${icon}</span><div><b>${t}</b><p>${b}</p></div></div>`;
  return `<div class="mlgrid">
    ${c(I.spark, 'O que é um mod', 'Arquivos feitos por jogadores que mudam algo no jogo: roupa, mapa, tradução, correção, conteúdo novo. Vêm quase sempre num .zip baixado de um site.')}
    ${c(I.bolt, 'Carregador (loader)', 'Muitos jogos não leem mods sozinhos. Um carregador (BepInEx, MelonLoader, Script Hook, Frosty) entra na pasta do jogo e faz essa ponte. Quando o jogo precisa de um, o passo a passo mostra — e instala quando dá.')}
    ${c(I.folder, 'Onde os arquivos vão', 'Cada jogo tem a sua pasta de mods (BepInEx/plugins, Data, Content/Paks/~mods, mods/…). O Ludrix detecta a pasta certa pela estrutura do jogo e copia para lá.')}
    ${c(I.shield, 'Antes de instalar', 'Jogos online com anti-cheat podem banir por mod — use só no modo um jogador. Antivírus às vezes acusa carregadores (são injeções de código, por natureza). Baixe só dos sites listados aqui.')}
    ${c(I.save, 'O que o Ludrix guarda', 'Tudo que um mod substitui é copiado antes. Desligar o mod devolve os originais; remover apaga a cópia. Em ROMs, o patch gera um arquivo novo e o original fica intacto.')}
    ${c(I.help, 'Se não funcionar', 'Abra a página do mod: ela diz a versão do jogo e do carregador que ele espera. Mods que mexem na mesma coisa brigam — desligue um por vez para achar o culpado.')}
  </div>`;
}
async function renderMyMods() {
  const el = $('#myMods'); if (!el) return;
  const inst = S.games.filter(g => g.installed && g.kind !== 'emulator').sort((a, b) => COLL.compare(a.title, b.title));
  const withMods = S.mods.games || [], cnt = {}; for (const w of withMods) cnt[w.key] = w.count;
  if (!S.modsGame || !inst.some(g => g.key === S.modsGame)) S.modsGame = (withMods[0] && withMods[0].key) || (inst[0] && inst[0].key) || '';
  if (!inst.length) { el.innerHTML = `${emptyHtml('mods', 'Nenhum jogo instalado', 'Instale ou adicione um jogo na Biblioteca; depois volte aqui para colocar mods nele.', [['Abrir Store', "setView('store')", 1], ['Adicionar jogo', 'addLocal()']])}`; return; }
  const key = S.modsGame; const g = S.byKey[key] || inst.find(x => x.key === key);
  const qn = qnorm(S._modsQ || ''), ordered = inst.filter(x => !qn || qnorm(x.title).includes(qn)).sort((a, b) => (cnt[b.key] || 0) - (cnt[a.key] || 0) || COLL.compare(a.title, b.title));
  el.innerHTML = `<div class="modwrap"><aside class="modgames"><input class="mgq" placeholder="Procurar jogo…" value="${esc(S._modsQ || '')}" oninput="S._modsQ=this.value;renderMyMods();const i=document.querySelector('.modgames .mgq');i.focus();i.setSelectionRange(99,99)">
      <div class="mgl">${ordered.map(x => `<button class="mg ${x.key === key ? 'on' : ''}" onclick="S.modsGame=${jsq(x.key)};renderMyMods()"><img loading="lazy" src="/thumb/${enc(x.key)}?v=${x.cv || 0}" alt="" onerror="this.onerror=null;this.src=BLANK_GIF"><span>${esc(x.title)}</span>${cnt[x.key] ? `<i>${cnt[x.key]}</i>` : ''}</button>`).join('')}</div></aside>
    <div class="modmain" id="mgMain"><div class="hint">lendo a pasta do jogo…</div></div></div>`;
  const r = await api.get('/api/mods/inspect/' + enc(key)); if (S.modsGame !== key || !$('#mgMain')) return;
  if (r.error) { $('#mgMain').innerHTML = emptyHtml(I.warn, 'Não deu para ler', r.error); return; }
  S.modsInsp = r; S.modsTargets = r.targets || []; S.modsSuggest = r.suggest || '';
  $('#mgMain').innerHTML = modGameHtml(r, g);
}
function modGameHtml(r, g) {
  const key = r.key, job = S.jobs['mod:' + key], prof = r.profile || {}, n = (r.mods || []).length, on = (r.mods || []).filter(m => m.enabled).length;
  const openUrl = u => `api.post('/api/open_url',{url:${jsq(u)}})`;
  const siteBtns = (r.sites || []).slice(0, 6).map(s => `<button class="site ${s.specific ? 'sp' : ''}" onclick="${openUrl(s.url)}" title="${esc(s.desc)}">${I.ext} ${esc(s.name)}</button>`).join('');
  const toolBtn = t => t.installed ? `<button class="btn s sm" onclick="api.post('/api/tools/launch',{id:'${t.id}'})">${I.play} Abrir ${esc(t.title)}</button>` : t.type === 'github_release' ? `<button class="btn p sm" onclick="installTool('${t.id}')">${I.dl} Baixar ${esc(t.title)}</button>` : `<button class="btn s sm" onclick="S.tab.mods='tools';S.modsCat='';renderMods()">${I.ext} ${esc(t.title)}</button>`;
  const steps = [];
  const facts = [];
  if (r.rom) {
    facts.push(['Tipo', `ROM · ${esc(S.systems[r.system] || r.system)}`], ['Arquivo', r.romOk ? `<a href="#" onclick="openPath(${jsq(r.dir)});return false">${esc(r.romPath.split(/[\\/]/).pop())}</a>` : 'não encontrado']);
    steps.push({ t: 'Baixe o patch do hack ou da tradução', d: 'Arquivos .ips, .bps ou .ups. A página diz para qual versão da ROM (região/revisão) ele foi feito.', a: `<div class="sites">${siteBtns}</div>` });
    steps.push({ t: 'Aplique o patch', d: 'O Ludrix gera uma cópia modificada ao lado da ROM original e coloca na biblioteca como outro jogo. A original não muda.', a: r.romOk ? `<button class="btn p sm" onclick="modPatchAsk()">${I.bolt} Aplicar patch…</button>` : `<span class="mut">a ROM original não está no lugar</span>` });
    steps.push({ t: 'Jogue a versão nova', d: 'Ela aparece na Biblioteca com o nome do patch depois de um travessão; se der errado, é só apagar esse arquivo.' });
  } else if (!r.dir) {
    steps.push({ t: 'Pasta do jogo desconhecida', d: 'Sem a pasta instalada o Ludrix não tem onde copiar os arquivos. Abra a ficha e confira o executável.', a: `<button class="btn s sm" onclick="editGame(${jsq(key)})">${I.edit} Editar jogo</button>` });
  } else {
    facts.push(['Motor', esc(prof.name || 'não identificado')], ['Pasta', `<a href="#" onclick="openPath(${jsq(r.dir)});return false">${esc(r.dir)}</a>`]);
    if (r.arch) facts.push(['Executável', r.arch === 'x64' ? '64 bits' : r.arch === 'x86' ? '32 bits' : esc(r.arch)]);
    if (r.loader) facts.push([esc(r.loader.name), r.loader.installed ? `<span class="okt">${I.check} instalado</span>` : 'não instalado']);
    if (r.modDir) facts.push(['Mods vão em', `<span class="code">${esc(r.modDir)}</span>${r.create ? ' <small>(ainda não existe — criada no primeiro mod)</small>' : ''}`]);
    if (r.hooks && r.hooks.length) facts.push(['Na pasta', esc(r.hooks.join(' · '))]);
    const L = r.loader;
    if (L && !L.installed && L.id !== 'scriptextender') {
      steps.push({ t: `Instale o ${esc(L.name)}`, d: L.auto ? 'É o carregador que faz o jogo ler mods. O Ludrix baixa a versão certa para o executável deste jogo e coloca na pasta; dá para desligar depois como qualquer mod.' : 'É o carregador que faz o jogo ler mods. Baixe, extraia o conteúdo na pasta do jogo (junto do executável) e abra o jogo uma vez.', a: job ? progHtml(job, 'mod:' + key) : L.auto ? `<button class="btn p sm" onclick="modLoaderInstall(${jsq(key)})">${I.dl} Instalar ${esc(L.name)}</button>` : `<button class="btn p sm" onclick="${openUrl(L.url)}">${I.ext} Baixar ${esc(L.name)}</button><button class="btn s sm" onclick="openPath(${jsq(r.dir)})">${I.folder} Pasta do jogo</button>${prof.alt ? `<button class="btn s sm" onclick="${openUrl(prof.alt.url)}">${I.ext} ou ${esc(prof.alt.name)}</button>` : ''}` });
      steps.push({ t: 'Abra o jogo uma vez e feche', d: 'O carregador cria as pastas de configuração na primeira abertura.', a: `<button class="btn s sm" onclick="play(${jsq(key)})">${I.play} Jogar</button>` });
    }
    if (L && L.id === 'scriptextender') steps.push({ t: L.installed ? `${esc(L.name)} já está na pasta` : 'Se o mod pedir Script Extender', d: L.installed ? 'Abra o jogo pelo executável do extender quando usar mods com script.' : 'Mods com scripts (SKSE, F4SE, OBSE…) exigem o extender do jogo, baixado do site oficial e extraído na pasta do jogo. Mods simples (texturas, armaduras) não precisam.', a: L.installed ? '' : `<button class="btn s sm" onclick="${openUrl('https://www.nexusmods.com/')}">${I.ext} Nexus Mods</button>` });
    const tl = (r.tools || []).find(t => t.id === prof.tool);
    if (tl) steps.push({ t: `Use o ${esc(tl.title)}`, d: 'Ele cuida de instalar, ordenar e ligar/desligar os mods deste jogo; o jogo passa a ser aberto por ele quando houver mods ativos.', a: toolBtn(tl) });
    steps.push({ t: 'Baixe o mod', d: `Sites confiáveis para ${esc(r.title)}. Guarde o .zip em Downloads — não precisa extrair.`, a: `<div class="sites">${siteBtns}</div>` });
    if (!tl || prof.mod_dir) steps.push({ t: 'Aponte o arquivo para o Ludrix', d: `Os arquivos entram em <span class="code">${esc(r.modDir || 'pasta do jogo')}</span>; o que for substituído fica guardado. Mods de Unreal (.pak) e de Unity (.dll) entram direto; se o zip vier com a estrutura inteira do jogo, escolha a raiz.`, a: job && !(L && !L.installed) ? progHtml(job, 'mod:' + key) : `<button class="btn p sm" onclick="modInstallMenu(event)">${I.plus} Instalar mod</button>` });
    steps.push({ t: 'Ligue, desligue ou remova aqui', d: 'A lista abaixo mostra o que está no jogo. Desligar tira os arquivos e devolve os originais, sem apagar o mod.' });
    for (const nt of prof.notes || []) steps.push({ t: 'Atenção', d: esc(nt), w: 1 });
  }
  const modsList = (r.mods || []).length ? `<div class="list">${r.mods.map(m => `<div class="item ${m.enabled ? '' : 'off'}"><div class="ic">${I.wrench}</div><div class="tx"><b>${esc(m.title)}</b><span>${pl((m.files || []).length, 'arquivo', 'arquivos')} em ${esc(m.target || 'pasta do jogo')}${m.replaced && m.replaced.length ? ` · ${pl(m.replaced.length, 'original guardado', 'originais guardados')}` : ''} · ${fmt(m.size || 0)}</span></div>
      <div class="ac"><button class="sw ${m.enabled ? 'on' : ''}" title="${m.enabled ? 'Desligar (tira os arquivos e devolve os originais)' : 'Ligar de novo'}" onclick="modToggle(${jsq(key)},${jsq(m.id)},${m.enabled ? 'false' : 'true'})"></button><button class="btn s sm ico" title="Remover" onclick="modRemove(${jsq(key)},${jsq(m.id)},${jsq(m.title)})">${I.trash}</button></div></div>`).join('')}</div>` : '';
  const status = r.rom ? 'patches geram cópias novas da ROM' : n ? `${pl(n, 'mod', 'mods')} · ${on} ${on === 1 ? 'ligado' : 'ligados'}` : 'nenhum mod ainda';
  return `<div class="mghead"><img src="/thumb/${enc(key)}?v=${(g || {}).cv || 0}" alt="" onerror="this.onerror=null;this.src=BLANK_GIF"><div class="tx"><b>${esc(r.title)}</b><span>${esc(prof.name || '')}${prof.name ? ' · ' : ''}${status}</span></div>
      <div class="ta">${r.rom ? (r.romOk ? `<button class="btn p sm" onclick="modPatchAsk()">${I.bolt} Aplicar patch</button>` : '') : r.dir ? `<button class="btn p sm" onclick="modInstallMenu(event)">${I.plus} Instalar mod</button>` : ''}${r.dir ? `<button class="btn s sm ico" title="Abrir pasta" onclick="openPath(${jsq(r.dir)})">${I.folder}</button>` : ''}<button class="btn s sm ico" title="Ficha do jogo" onclick="openGame(${jsq(key)})">${I.info}</button></div></div>
    <div class="mgrid">
      <section class="mcard"><h4>Passo a passo</h4><ol class="msteps">${steps.map(st => `<li class="${st.w ? 'warn' : ''}"><b>${st.t}</b>${st.d ? `<p>${st.d}</p>` : ''}${st.a ? `<div class="ma">${st.a}</div>` : ''}</li>`).join('')}</ol></section>
      <section class="mcard"><h4>Neste jogo</h4><dl class="mfacts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${prof.why ? `<p class="mwhy">${esc(prof.why)}</p>` : ''}${(r.tools || []).filter(t => t.id !== prof.tool).length ? `<h5>Ferramentas úteis</h5><div class="mtools">${(r.tools || []).filter(t => t.id !== prof.tool).slice(0, 4).map(t => `<div class="mtool"><span><b>${esc(t.title)}</b><small>${esc(t.for)}</small></span>${toolBtn(t)}</div>`).join('')}</div>` : ''}</section>
    </div>
    ${r.rom ? '' : `<section class="mcard" style="margin-top:12px"><h4>Instalados${n ? ` <span>${n}</span>` : ''}</h4>${job && !(r.loader && !r.loader.installed) ? `<div class="item"><div class="ic">${I.wrench}</div><div class="tx"><b>Instalando…</b>${progHtml(job, 'mod:' + key)}</div></div>` : ''}${modsList || `<p class="mut" style="margin:0">Nada instalado por aqui ainda.</p>`}</section>`}`;
}
async function modLoaderInstall(key) {
  const r = await api.post('/api/mods/loader', { key }); if (r.error) return toast('err', 'Não foi possível concluir', r.error);
  S.jobs['mod:' + key] = { stage: 'download', fraction: 0, detail: 'Iniciando…' }; pollSoon(); renderMyMods();
}
function modPatchAsk(force, pathIn) {
  const key = S.modsGame, r = S.modsInsp || {};
  const go = async (p, f) => {
    const res = await api.post('/api/mods/patch', { key, path: p || '', force: !!f });
    if (res.mismatch) return modal({ title: 'A ROM não bate com o patch', text: res.error + ' Aplicar mesmo assim pode gerar um arquivo que não abre.', ok: 'Aplicar assim mesmo', danger: true, onOk: () => go(res.path_in, true) });
    if (res.error) return toast('err', 'Não foi possível aplicar', res.error);
    if (res.ok === false) return;
    toast('ok', 'Patch aplicado', `${res.path.split(/[\\/]/).pop()} · ${fmt(res.size)}${res.added && res.added.title ? ' · já está na biblioteca' : ''}`);
    await loadCatalog(true); renderMyMods();
  };
  if (S.config.native || pathIn) return go(pathIn || '', force);
  modal({ title: 'Aplicar patch', html: `<div class="fedit"><label style="grid-column:1/-1">Caminho do patch (.ips, .bps, .ups)<input class="mi" id="mdP"></label></div><p class="mut" style="font-size:12px;margin-top:8px">ROM original: ${esc(r.romPath || '')}</p>`, ok: 'Aplicar', onOk: () => go($('#mdP').value, false) });
}
function modInstallMenu(ev) {
  showCtx([{ label: 'Arquivo do mod (.zip, .7z, .rar)', icon: 'doc', fn: () => modInstallAsk('file') }, { label: 'Pasta já extraída', icon: 'folder', fn: () => modInstallAsk('dir') }], ev.clientX, ev.clientY, 'Instalar mod');
}
function modInstallAsk(kind) {
  const key = S.modsGame; const tg = S.modsTargets || [{ path: '', label: 'Pasta do jogo (raiz)' }];
  const sel = `<label>Copiar para<select class="mi" id="mdT">${tg.map(t => `<option value="${esc(t.path)}" ${t.path === (S.modsSuggest || '') ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>`;
  modal({ title: 'Instalar mod', wide: true, html: `<div class="fedit">${S.config.native ? '' : `<label style="grid-column:1/-1">${kind === 'dir' ? 'Caminho da pasta do mod' : 'Caminho do arquivo do mod'}<input class="mi" id="mdP"></label>`}<label>Nome (opcional)<input class="mi" id="mdN" placeholder="como vai aparecer na lista"></label>${sel}</div>
    <p style="color:var(--muted);font-size:12px;margin-top:8px">Se o zip já vem com a pasta certa dentro (ex.: <span class="code">mods\\NomeDoMod\\</span>), escolha a raiz do jogo. Se vem só o conteúdo do mod, escolha a pasta de mods.</p>`,
    ok: 'Instalar', onOk: async () => {
      const r = await api.post('/api/mods/game/install', { key, path: $('#mdP') ? $('#mdP').value : '', title: $('#mdN').value, target: $('#mdT').value, kind });
      if (r.error) return toast('err', 'Não foi possível concluir', r.error);
      if (r.ok !== false) { S.jobs['mod:' + key] = { stage: 'extract', fraction: -1, detail: 'Iniciando…' }; pollSoon(); renderMyMods(); }
    } });
}
async function modToggle(key, id, on) { const r = await api.post('/api/mods/game/toggle', { key, id, on }); if (r.error) toast('err', 'Não foi possível concluir', r.error); renderMyMods(); }
function modRemove(key, id, name) { modal({ title: `Remover ${name}?`, text: 'Os arquivos do mod saem do jogo, os originais voltam e a cópia guardada é apagada.', ok: 'Remover', danger: true, onOk: async () => { await api.post('/api/mods/game/remove', { key, id }); renderMyMods(); } }); }
async function installTool(id) { const r = await api.post('/api/tools/install', { id }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); S.jobs['tool:' + id] = { stage: 'download', fraction: 0, detail: 'Iniciando…' }; qfabSync(); renderMods(); pollSoon(); }
function removeTool(id, name) { modal({ title: `Remover ${name}?`, text: 'A pasta da ferramenta será apagada.', ok: 'Remover', danger: true, onOk: async () => { await api.post('/api/tools/remove', { id }); renderMods(); } }); }
async function loadModsFor(key) {
  const r = await api.get('/api/mods/for/' + enc(key)); const el = $('#dMods'); if (!el || S.current !== key) return;
  if (!r.tools.length && !r.sites.length && !(S.byKey[key] || {}).installed) { el.innerHTML = `<p class="mut">Nenhuma ferramenta nem site de mods conhecido para este jogo. Instale o jogo para gerenciar mods por aqui.</p>`; return; }
  el.innerHTML = `<h3>MODS E FERRAMENTAS</h3>${(S.byKey[key] || {}).installed ? `<div class="sites" style="margin-bottom:8px"><button class="site sp" onclick="S.modsGame=${jsq(key)};S.tab.mods='mine';setView('mods')">${I.wrench} Meus mods neste jogo</button></div>` : ''}${r.tools.length ? `<div class="sites" style="margin-bottom:8px">${r.tools.map(t => `<button class="site sp" onclick="S.tab.mods='tools';setView('mods')" title="${esc(t.for)}">${I.wrench} ${esc(t.title)}${t.installed ? ' ✓' : ''}</button>`).join('')}</div>` : ''}
    <div class="sites">${r.sites.map(s => `<button class="site ${s.specific ? 'sp' : ''}" onclick="api.post('/api/open_url',{url:${jsq(s.url)}})" title="${esc(s.desc)}">${I.ext} ${esc(s.name)}</button>`).join('')}</div>`;
}

applyAnim(); loadCatalog(false); poll();

const GB = n => n ? (n / 2 ** 30).toFixed(n > 2 ** 30 * 100 ? 0 : 1) + ' GB' : '—';
const MB = n => !n ? '—' : n >= 2 ** 30 ? (n / 2 ** 30).toFixed(1) + ' GB' : Math.round(n / 2 ** 20) + ' MB';
function hwHtml(hw) {
  if (!hw) return `<div class="sec" id="s-pc"><h3>Seu PC</h3><p>Lendo o hardware…</p></div>`;
  if (hw.error) return `<div class="sec"><h3>Seu PC</h3><p>Não consegui ler o hardware${hw && hw.error ? ': ' + esc(hw.error) : ''}.</p></div>`;
  const t = hw.tier || {}; const lvl = { high: ['ALTO', 'green'], mid: ['MÉDIO', 'amber'], low: ['BÁSICO', 'muted'] }[t.level] || ['?', 'muted'];
  const gpus = hw.gpus && hw.gpus.length ? hw.gpus : [{ name: 'Não identificada', vram: 0 }];
  const ramUse = hw.ram.total ? Math.round((1 - hw.ram.available / hw.ram.total) * 100) : 0;
  const bar = (f, col) => `<div class="hwbar"><i style="width:${Math.max(2, Math.min(100, f))}%;background:var(--${col || 'accent'})"></i></div>`;
  return `<div class="sec"><div class="hwhead"><h3>Seu PC</h3><span class="pill ${lvl[1] === 'green' ? 'ok' : lvl[1] === 'amber' ? 'warn' : ''}">Perfil ${lvl[0]}</span><span style="flex:1"></span><button class="btn s sm" onclick="S.hw=null;renderSettings()">${I.refresh} Atualizar</button></div>
    <p>${esc(t.hint || '')}</p>
    <div class="hwgrid">
      <div class="hw"><span class="k">${I.cpu} Processador</span><b>${esc(hw.cpu.name)}</b><small>${hw.cpu.cores} núcleos · ${hw.cpu.threads} threads${hw.cpu.mhz ? ' · ' + (hw.cpu.mhz / 1000).toFixed(1) + ' GHz' : ''}</small></div>
      ${gpus.map(g => `<div class="hw"><span class="k">${I.chip} Placa de vídeo</span><b>${esc(g.name)}</b><small>${g.vram ? GB(g.vram) + ' VRAM' : 'VRAM não informada'}${g.driver ? ' · driver ' + esc(g.driver) : ''}</small></div>`).join('')}
      <div class="hw"><span class="k">${I.disc} Memória RAM</span><b>${GB(hw.ram.total)}</b><small>${GB(hw.ram.available)} livre agora (${ramUse}% em uso)</small>${bar(ramUse, ramUse > 85 ? 'red' : 'accent')}</div>
      <div class="hw"><span class="k">${I.win} Sistema</span><b>${esc(hw.os.name)}</b><small>${esc(hw.os.arch)}${hw.os.build ? ' · build ' + esc(hw.os.build) : ''}${hw.screen && hw.screen.w ? ' · ' + hw.screen.w + '×' + hw.screen.h + (hw.screen.monitors > 1 ? ' · ' + hw.screen.monitors + ' monitores' : '') : ''}</small></div>
      ${(hw.disks || []).map(d => { const used = d.total ? Math.round((1 - d.free / d.total) * 100) : 0; return `<div class="hw"><span class="k">${I.folder} Disco ${esc(d.mount)}${d.launcher ? ' <em>(launcher aqui)</em>' : ''}</span><b>${GB(d.free)} livres</b><small>de ${GB(d.total)} · ${used}% usado</small>${bar(used, used > 90 ? 'red' : used > 75 ? 'amber' : 'green')}</div>`; }).join('')}
      <div class="hw"><span class="k">${I.gamepad} Controles</span><b>${hw.gamepads ? hw.gamepads + ' conectado' + (hw.gamepads > 1 ? 's' : '') : 'Nenhum'}</b><small>${S.config.os === 'windows' ? 'XInput (Xbox / compatíveis)' : 'Detectados pelo sistema'}</small></div>
    </div></div>`;
}

let NOTIFS = [];
async function loadNotifs() { try { NOTIFS = await api.get('/api/notifications'); } catch (e) { return; } renderBell(); }
function renderBell() {
  const un = NOTIFS.filter(n => !n.read).length; const b = $('#bellN'); b.textContent = un > 9 ? '9+' : un; b.style.display = un ? 'grid' : 'none';
  const ic = { error: I.warn, warn: I.warn, ok: I.check, repack: I.dl, info: I.check, update: I.refresh, store: I.magnet };
  $('#bellList').innerHTML = NOTIFS.length ? NOTIFS.map(n => `<div class="bn ${n.read ? '' : 'un'} ${n.kind}" onclick="notifOpen(${jsq(n.id)})">${ic[n.kind] || I.info}<div><b>${esc(n.title)}</b><span>${esc(n.text || '')}</span><small>${ago(n.at)}</small></div>${n.kind === 'repack' && n.key ? `<button class="btn p xs" onclick="event.stopPropagation();runRepack(${jsq(n.key)})">Instalar</button>` : ''}</div>`).join('') : '<div class="empty" style="padding:30px 10px"><b>Tudo em dia</b>Nenhuma notificação.</div>';
}
const HELP = {
  home: { t: 'Biblioteca', p: 'Todos os seus jogos num lugar só: instalados no PC, baixados pelo Ludrix, importados de outros launchers e ROMs já baixadas.', s: ['Clique numa capa para selecionar; dois cliques ou botão direito abrem os detalhes. Ctrl+clique seleciona vários para favoritar, atualizar metadados ou remover de uma vez.', 'Use a busca (tecla /), a categoria e a ordenação na barra de tarefas. O botão Filtros abre um painel lateral com todos os critérios: situação, origem, categoria, gênero, desenvolvedora, ano, quando jogou, quando adicionou, tempo jogado e tamanho; marque quantos quiser. Uma combinação pode ser salva pelo botão Salvar e reaplicada pela lista "Filtros salvos".', '"Adicionar jogo" aceita um .exe, um atalho ou uma pasta inteira. Jogos com faixa NÃO ENCONTRADO mudaram de lugar: Jogar neles abre a opção de apontar a pasta nova.', 'Busca com prefixo: dev:nintendo (desenvolvedora), ano:2017 ou ano:2010s (ano ou década), gen:rpg (gênero), sis:snes (sistema), origem:steam (origem). Dá para misturar com palavras normais, como "mario sis:gba".', 'Arrastar um .exe, atalho ou ROM para a janela adiciona o jogo à biblioteca.'] },
  store: { t: 'Store', p: 'Catálogo das fontes que você ligou. Nada é baixado sem você pedir.', s: ['Com mais de uma fonte ligada, cada cartão mostra de onde o jogo vem e Filtros ganha a seção "Fonte".', 'Ligue ou desligue fontes em "Fontes de jogos".', 'Baixar um jogo coloca-o na Fila; quando terminar, ele aparece na Biblioteca.', 'A busca e a categoria funcionam aqui também.'] },
  emulation: { t: 'Emuladores', p: 'Instale emuladores por console e traga suas ROMs. A configuração básica é automática.', s: ['Os consoles com emulador pronto ou ROMs na pasta ficam em "Meus consoles"; os outros aparecem abaixo, os mais usados primeiro.', 'Em Consoles, instale o emulador e aponte a pasta das suas ROMs.', 'Em Baixar ROMs aparecem as fontes de ROM que você ligou, com um seletor por console; a ROM só entra na Biblioteca depois de baixada.', 'Ao baixar uma ROM você escolhe a pasta de destino; marque "Usar sempre" para fixar a pasta daquele console — ou use "Baixar em…" no cartão do console.', 'Consoles que precisam de BIOS, keys ou firmware (Switch, PS2, PS3, PS1, Xbox, Saturn) têm o botão "guia" no cartão: mostra o que falta, de onde vem e instala no lugar certo do emulador. Se faltar algo, o Jogar avisa e abre o guia.'] },
  mods: { t: 'Mods e ferramentas', p: 'Meus mods instala mods nos seus jogos a partir do arquivo baixado, com botão pra desligar e religar; as outras abas trazem utilitários e sites de mods.', s: ['Escolha o jogo, Instalar mod, aponte o .zip.', 'Arquivos do jogo substituídos ficam guardados: desligar o mod devolve os originais.', 'Em Ferramentas, os chips no alto filtram por categoria ou mostram só as instaladas; cada cartão diz para quais jogos serve. Portátil = o Ludrix baixa do GitHub para tools\\; Site = abre a página oficial.'] },
  central: { t: 'Central Ludrix', p: 'Dependências que os jogos pedem (Visual C++, DirectX, .NET…) e o Minecraft com os launchers que você já tem.', s: ['Se um jogo fecha na hora ou reclama de .dll, instale as dependências marcadas como faltando; o pacote Clássico cobre quase tudo.', 'Em Minecraft, o Ludrix acha as edições e os launchers instalados e coloca o Minecraft na Biblioteca; Jogar abre o launcher escolhido.'] },
  flash: { t: 'Jogos rápidos', p: 'Jogos leves que abrem dentro do launcher: Flash (pelo Ruffle), HTML5 e jogos de site.', s: ['Meus jogos é o que já está pronto; Baixar mais é o acervo.', 'Clique para jogar; Esc fecha; "Tela cheia" ocupa a janela inteira.', 'Adicionar aceita .swf, .zip ou pasta com index.html e links de sites.'] },
  downloads: { t: 'Fila', p: 'Tudo o que está baixando, extraindo ou já terminou, separado por situação.', s: ['Agora: o que está baixando; Pausados: retome quando quiser; Precisam de atenção: falharam — tente de novo ou remova.', 'Pausar, retomar e cancelar ficam no próprio item.', 'Concluídos ficam no histórico até você limpar.'] },
  settings: { t: 'Ajustes', p: 'Uma aba por assunto: comportamento (Geral), visual (Aparência e Personalizar), exibição dos jogos (Biblioteca), ao jogar (Ao jogar), fontes e downloads (Store e downloads), manutenção (Ferramentas) e máquina (Sistema).', s: ['A lista à esquerda mostra as seções da aba atual; clique para ir direto. A busca no alto acha qualquer opção e pula para ela, mesmo em outra aba.', '"Opções avançadas" mostra o que quase ninguém precisa mexer; "Redefinir esta aba" volta só aquela aba ao padrão.', 'Ajustes marcados com "reiniciar" valem depois de reabrir o Ludrix.'] },
};
function toggleHelp(e) {
  if (e) e.stopPropagation();
  const p = $('#helppop'); const on = !p.classList.contains('on');
  $('#bellpop').classList.remove('on');
  if (!on) { p.classList.remove('on'); return; }
  const h = HELP[S.view] || HELP.home;
  p.innerHTML = `<div class="bh"><b>${I.help}${esc(h.t)}</b><span class="sp"></span><button class="btn s xs" onclick="$('#helppop').classList.remove('on')">Fechar</button></div>
    <div class="hb"><p>${esc(h.p)}</p><ul>${h.s.map(x => `<li>${esc(x)}</li>`).join('')}</ul><div class="hk">Atalhos: <kbd>/</kbd> busca · <kbd>Ctrl</kbd>+<kbd>K</kbd> paleta · <kbd>Ctrl</kbd>+<kbd>1…9</kbd> abas · <kbd>Esc</kbd> fecha · <button class="lnk" onclick="$('#helppop').classList.remove('on');shortcutsHelp()"><kbd>?</kbd> ver todos</button></div></div>`;
  p.classList.add('on');
  setTimeout(() => document.addEventListener('click', helpOut, { once: true }), 0);
}
function helpOut(e) { const p = $('#helppop'); if (!p.contains(e.target) && !$('#helpBtn').contains(e.target)) p.classList.remove('on'); else if (p.classList.contains('on')) setTimeout(() => document.addEventListener('click', helpOut, { once: true }), 0); }
function toggleBell() { $('#helppop').classList.remove('on'); const p = $('#bellpop'); const on = p.classList.toggle('on'); if (on) { loadNotifs(); setTimeout(() => document.addEventListener('click', bellOut, { once: true }), 0); } }
function bellOut(e) { const p = $('#bellpop'); if (!p.contains(e.target) && !$('#bell').contains(e.target)) p.classList.remove('on'); else if (p.classList.contains('on')) setTimeout(() => document.addEventListener('click', bellOut, { once: true }), 0); }
async function notifOpen(id) { const n = NOTIFS.find(x => x.id === id); if (!n) return; await api.post('/api/notifications/ack', { id }); n.read = true; renderBell(); if (n.action && n.action.startsWith('scan-dir:')) { $('#bellpop').classList.remove('on'); scanRun('windows', n.action.slice(9)); return; } if (n.action === 'store-new') { $('#bellpop').classList.remove('on'); S.tab.store = 'games'; flagOnly('fresh'); const rid = String(n.key || '').replace(/^store:/, ''); if (rid && S.repos.some(r => r.id === rid)) { S.flt.repos.add(rid); renderLibrary(); } return; } if (n.key === 'integrity') { $('#bellpop').classList.remove('on'); integrityCheck(); return; } if (n.action === 'updates') { $('#bellpop').classList.remove('on'); checkUpdates(); return; } if (n.action && n.action.startsWith('settings:')) { $('#bellpop').classList.remove('on'); closeDetail(); setView('settings'); settingsTab(n.action.slice(9)); return; } if (n.key && !n.key.startsWith('flash:') && S.byKey[n.key]) { $('#bellpop').classList.remove('on'); openGame(n.key); } }
function discToolAsk(key, r) {
  modal({ title: r.tool_only ? 'Formato de disco não suportado' : 'Disco com faixas de áudio', text: r.message + '\n\nO WinCDEmu é gratuito e de código aberto; instala um driver (pede permissão de administrador uma vez). Depois de montar o disco com ele, abra o instalador e, no fim, use "Procurar instalação agora" nos detalhes do jogo.', ok: 'Baixar WinCDEmu', onOk: async () => { const t = await api.get('/api/disc/tool'); api.post('/api/open_url', { url: t.url }); }, extra: r.tool_only ? null : 'Montar sem o áudio', onExtra: () => api.post('/api/repack/run', { key, force: true }).then(x => x.error ? toast('err', 'Disco', x.error) : toast('', 'Disco montado', 'O instalador vai abrir em seguida.')), cancel: 'Depois' });
}
async function runRepack(key) { const r = await api.post('/api/repack/run', { key }); if (r.error) return toast('err', 'Não abriu o instalador', r.error); if (r.needs_tool) return discToolAsk(key, r); toast('', 'Instalador aberto', 'Quando ele terminar, o jogo entra na biblioteca automaticamente.'); $('#bellpop').classList.remove('on'); }
function beep() { if (S.config.notify_sound === false) return; try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.0001, a.currentTime); g.gain.exponentialRampToValueAtTime(0.12, a.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.35); o.start(); o.stop(a.currentTime + 0.4); } catch (e) { } }

function zoomVis() { const z = $('#szoom'); if (z) z.style.display = ['home', 'store'].includes(S.view) && !listMode() && !(S.view === 'store' && S.tab.store === 'sources') ? '' : 'none'; }
function statusBar(a, loading) {
  const t = $('#stext'), d = $('#sdot'), r = $('#sright'); if (!t) return;
  a = a || {};
  const busy = !!(a.busy || loading);
  d.className = 'sdot' + (busy ? ' busy' : '');
  let txt = a.text || (loading ? 'Carregando catálogo…' : '');
  if (!txt && S.metaPending > 0) txt = `Buscando capas e informações (${S.metaPending} restantes)…`;
  if (!txt) txt = a.sessions ? `${a.sessions} jogo${a.sessions > 1 ? 's' : ''} rodando` : 'Pronto';
  if (a.fraction > 0 && a.fraction < 1 && a.text) txt += ` · ${Math.round(a.fraction * 100)}%`;
  if (t.textContent !== txt) t.textContent = txt;
  const nb = S.games.filter(FLAG_TEST.broken).length;
  const right = [a.jobs ? `${a.jobs} na fila` : '', S.games.length ? `<a href="#" onclick="gotoGrid();return false">${pl(S.games.length, 'jogo', 'jogos')} no catálogo</a>` : '', S.view === 'store' && S.checkedAt ? `<span title="${esc(new Date(S.checkedAt * 1000).toLocaleString('pt-BR'))}">fontes lidas ${ago(S.checkedAt)}</span>` : '', nb ? `<a href="#" onclick="flagOnly('broken');return false" style="color:var(--amber)">${pl(nb, 'não encontrado', 'não encontrados')}</a>` : ''].filter(Boolean).join(' · ');
  if (r.innerHTML !== right) r.innerHTML = right;
  let z = $('#szoom'); if (!z) { z = document.createElement('label'); z.id = 'szoom'; z.className = 'szoom'; z.title = 'Tamanho das capas'; z.innerHTML = `<button type="button" onclick="setCardSize(Math.max(100,(S.config.card_size||136)-10),true);$('#szoom input').value=S.config.card_size">−</button><input type="range" min="100" max="300" step="10" value="${S.config.card_size || 136}" oninput="setCardSize(this.value,false)" onchange="setCardSize(this.value,true)"><button type="button" onclick="setCardSize(Math.min(300,(S.config.card_size||136)+10),true);$('#szoom input').value=S.config.card_size">+</button>`; r.after(z); }
  zoomVis();
  { const ks = Object.keys(S.sessions || {}); const n = S.games.filter(g => g.installed).length; const base = n ? `LudrixHub — ${pl(n, 'jogo', 'jogos')}` : 'LudrixHub'; const want = ks.length ? `${(S.byKey[ks[0]] || {}).title || 'Jogando'} — LudrixHub` : base; if (document.title !== want) document.title = want; }
}

const SUR = { seen: [] };
async function surprise(filt) {
  filt = filt || SUR.filt || 'any'; SUR.filt = filt;
  modal({ title: 'Me surpreenda', text: 'Sorteando…', noOk: true, cancel: 'Fechar' });
  const r = await api.get(`/api/random?f=${filt}&x=${enc(SUR.seen.slice(-8).join(','))}`);
  if (r.error) return modal({ title: 'Me surpreenda', text: r.error, noOk: true, cancel: 'Fechar' });
  const g = r.game; SUR.seen.push(g.key);
  const fl = [['any', 'Qualquer'], ['unplayed', 'Nunca joguei'], ['short', 'Sessão rápida'], ['fav', 'Favoritos'], ['pc', 'PC'], ['emu', 'Emulado']];
  const html = `<div class="sur"><img src="/cover/${enc(g.key)}?v=${g.cv || 0}" onerror="this.style.opacity=.2"><div class="surt"><span class="pill ac">${esc(g.system && g.system !== 'pc' ? (S.systems[g.system] || g.system) : 'PC')}</span>${g.year ? `<span class="pill">${esc(g.year)}</span>` : ''}${g.playtime > 60 ? `<span class="pill">${fmtTime(g.playtime)} jogados</span>` : '<span class="pill">nunca jogado</span>'}<h2>${esc(g.title)}</h2><p>${esc(g.description || (g.genres || []).join(', ') || '')}</p>
    <div class="tips">${(r.tips || []).map(t => `<div class="tip">${I[t.icon] || I.info}<div><b>${esc(t.t)}</b><small>${esc(t.d)}</small></div></div>`).join('')}</div></div></div>
    <div class="seg" style="margin-top:12px;flex-wrap:wrap">${fl.map(([id, n]) => `<button class="${filt === id ? 'on' : ''}" onclick="surprise('${id}')">${n}</button>`).join('')}</div>`;
  modal({ title: 'Sugestão', html, ok: '▶ Jogar agora', extra: 'Sortear outro', wide: true, onExtra: () => surprise(filt), onOk: () => play(g.key) });
  const box = $('#modalBox .a'); if (box) { const b = document.createElement('button'); b.className = 'btn s sm'; b.textContent = 'Ver detalhes'; b.onclick = () => { $('#modal').classList.remove('on'); openGame(g.key); }; box.insertBefore(b, box.querySelector('#mNo')); }
}

const FTYPE = { swf: 'Flash', html5: 'HTML5', web: 'Site' };
async function renderFlash() {
  const st = await api.get('/api/flash'); if (S.view !== 'flash') return;
  S.flash = st; const sub = S.tab.flash === 'more' ? 'more' : 'lib'; const f = S.flashF || 'all';
  const ready = st.games.filter(g => g.installed), more = st.games.filter(g => !g.installed && !g.custom);
  const base = sub === 'lib' ? ready : more;
  const genres = [...new Set(base.map(g => (g.genre || '').split(/\s*[\/·]\s*/)[0]).filter(g => g && g !== 'Meu jogo' && g !== 'Jogo de site'))].sort();
  let list = base.filter(g => S.q ? g.title.toLowerCase().includes(S.q.toLowerCase()) : true);
  if (f === 'fav') list = list.filter(g => g.fav); else if (f === 'mine') list = list.filter(g => g.custom); else if (FTYPE[f]) list = list.filter(g => g.type === f); else if (f !== 'all') list = list.filter(g => (g.genre || '').startsWith(f));
  const kinds = sub === 'lib' ? Object.keys(FTYPE).map(t => [t, FTYPE[t], ready.filter(g => g.type === t).length]).filter(x => x[2]) : [];
  const chips = [['all', 'Todos', base.length], ...(sub === 'lib' ? [['fav', 'Favoritos', ready.filter(g => g.fav).length], ['mine', 'Meus', ready.filter(g => g.custom).length]] : []), ...kinds, ...genres.map(g => [g, g, base.filter(x => (x.genre || '').startsWith(g)).length])].filter(([id, , n]) => n || id === 'all');
  const card = g => { const job = S.jobs['flash:' + g.id]; const tl = g.type === 'web' ? 'Abrir' : 'Jogar'; return `<div class="fcard ${g.installed ? 'ok' : ''}" data-fid="${g.id}" ${g.installed ? `onclick="playFlash('${g.id}')"` : ''} oncontextmenu="event.preventDefault();flashMenu('${g.id}',event.clientX,event.clientY)">
    <div class="fart" style="--h:${(hashStr(g.id) % 360)}">${g.has_cover ? `<img loading="lazy" src="/flash/cover/${g.id}" onload="this.classList.add('ld')" onerror="this.remove()">` : ''}<span>${esc(g.title.slice(0, 2))}</span>${g.installed ? `<i class="fp">${g.type === 'web' ? I.ext : I.play}</i>` : ''}${job ? ringSvg(job.fraction) : ''}<button class="ffav ${g.fav ? 'on' : ''}" onclick="event.stopPropagation();api.post('/api/flash/fav',{id:'${g.id}'}).then(renderFlash)" title="Favorito">${I.star}</button>${g.year && g.year !== '—' ? `<em>${esc(g.year)}</em>` : ''}</div>
    <b>${esc(g.title)}</b><small>${esc(FTYPE[g.type] || 'Flash')} · ${esc(g.genre)}${g.players ? ' · ' + esc(g.players) : ''}${g.time ? ' · ~' + esc(g.time) : ''}${g.dev && g.dev !== '—' ? ' · ' + esc(g.dev) : ''}</small><p>${esc(g.tip || g.desc || '')}</p>
    <div class="fa">${g.controls ? `<span class="pill">${esc(g.controls)}</span>` : ''}${g.plays ? `<span class="pill">${g.plays}×</span>` : ''}<span class="sp"></span>${g.installed ? `<button class="btn s xs" onclick="event.stopPropagation();flashMenu('${g.id}',event.clientX,event.clientY)" title="${tl} e mais opções">${I.dots}</button>` : job ? '' : `<button class="btn p xs" onclick="event.stopPropagation();installFlash('${g.id}')">${I.dl} ${fmt(g.size) || 'Baixar'}</button>`}</div></div>`; };
  const empty = sub === 'lib'
    ? `${f === 'all' ? emptyHtml(I.bolt, 'Nenhum jogo rápido ainda', 'Pegue alguns no acervo ou adicione um .swf, um jogo HTML5 ou o link de um site.', [['Baixar mais', "S.tab.flash='more';S.flashF='all';renderFlash()", 1], ['Adicionar meu jogo', 'addFlashMenu(event)']]) : emptyHtml(I.search, 'Nada nesse filtro', 'Troque o filtro ou baixe mais jogos.', [['Ver todos', "S.flashF='all';renderFlash()", 1], ['Baixar mais', "S.tab.flash='more';S.flashF='all';renderFlash()"]])}`
    : `${more.length ? emptyHtml(I.search, 'Nada nesse filtro', 'Troque o filtro para ver o resto do acervo.', [['Ver todos', "S.flashF='all';renderFlash()", 1]]) : emptyHtml(I.check, 'Você já tem todos', 'Todo o acervo já está baixado.', [['Ver meus jogos', "S.tab.flash='mine';renderFlash()", 1]])}`;
  $('#view').innerHTML = `<div class="h1"><h2>Jogos Rápidos</h2><span>${pl(ready.length, 'pronto', 'prontos')} · Flash, HTML5 e jogos de site, dentro do launcher</span><div class="acts">
      ${st.ruffle ? '' : `<button class="btn s" onclick="installFlash('ruffle')">${I.dl} Instalar o player Flash (10 MB)</button>`}
      <button class="btn s" onclick="addFlashMenu(event)">${I.plus} Adicionar</button>
      ${sub === 'more' && more.length ? `<button class="btn p" onclick="installFlash('all')">${I.dl} Baixar todos (${fmt(more.reduce((a, g) => a + (g.size || 0), 0))})</button>` : ''}</div></div>
    <div class="tabs"><button class="${sub === 'lib' ? 'on' : ''}" onclick="S.tab.flash='lib';S.flashF='all';renderFlash()">Meus jogos${ready.length ? ` <span class="n">${ready.length}</span>` : ''}</button><button class="${sub === 'more' ? 'on' : ''}" onclick="S.tab.flash='more';S.flashF='all';renderFlash()">Baixar mais${more.length ? ` <span class="n">${more.length}</span>` : ''}</button></div>
    <div class="chips" style="margin:0 0 14px">${chips.map(([id, n, c]) => `<button class="chip ${f === id ? 'on' : ''}" onclick="S.flashF=${jsq(id)};renderFlash()">${esc(n)} <span class="n">${c}</span></button>`).join('')}</div>
    <div class="fgrid">${list.map(card).join('') || empty}</div>
    <p style="color:var(--muted2);font-size:12px;max-width:900px;margin:18px 0">${sub === 'lib'
      ? 'Clique num jogo pra abrir. Esc fecha o player; F11 tela cheia. Botão direito: favoritar, capa, editar, remover. Jogos de site abrem numa janela própria do Ludrix e precisam de internet.'
      : 'Os jogos Flash vêm do acervo público do archive.org e ficam em <span class="code">flash\\games\\</span>; jogos HTML5 em <span class="code">flash\\html\\</span>. Depois de baixado, o jogo aparece em Meus jogos e roda sem internet.'}</p>`;
}
function addFlashMenu(ev) {
  showCtx([
    { label: 'Arquivo .swf (Flash)', icon: 'flash', fn: () => addFlash('file', 'Caminho do arquivo .swf') },
    { label: 'Jogo HTML5 em .zip', icon: 'doc', fn: () => addFlash('file', 'Caminho do .zip com o index.html') },
    { label: 'Pasta de um jogo HTML5', icon: 'folder', fn: () => addFlash('dir', 'Caminho da pasta que tem o index.html') },
    { label: 'Link de um jogo de site', icon: 'ext', fn: () => addFlashUrl() },
  ], ev.clientX, ev.clientY, 'Adicionar jogo rápido');
}
function flashMenu(id, x, y) {
  const g = (S.flash?.games || []).find(z => z.id === id); if (!g) return;
  const items = [];
  if (g.installed) items.push({ label: g.type === 'web' ? 'Abrir' : 'Jogar', icon: g.type === 'web' ? 'ext' : 'play', fn: () => playFlash(id) });
  items.push({ label: g.fav ? 'Tirar dos favoritos' : 'Favoritar', icon: 'star', fn: () => api.post('/api/flash/fav', { id }).then(renderFlash) });
  items.push({ label: 'Trocar capa…', icon: 'image', fn: () => api.post('/api/flash/cover', { id }).then(r => { if (r.error) toast('err', 'Não foi possível concluir', r.error); else renderFlash(); }) });
  if (g.custom) items.push({ label: 'Editar informações…', icon: 'edit', fn: () => editFlash(id) });
  if (g.item) items.push({ label: 'Página de origem', icon: 'ext', fn: () => api.post('/api/open_url', { url: 'https://archive.org/details/' + g.item }) });
  else if (g.type === 'web' && g.url) items.push({ label: 'Abrir no navegador', icon: 'ext', fn: () => api.post('/api/open_url', { url: g.url }) });
  if (g.installed && !g.custom && g.type !== 'web') items.push({ label: g.type === 'html5' ? 'Apagar os arquivos' : 'Apagar o .swf', icon: 'trash', danger: true, fn: () => api.post('/api/flash/remove', { id }).then(renderFlash) });
  if (g.custom) items.push({ label: 'Remover meu jogo', icon: 'trash', danger: true, fn: () => modal({ title: `Remover ${g.title}?`, text: g.type === 'web' ? 'Só o atalho sai da lista.' : 'Os arquivos copiados e a capa serão apagados.', ok: 'Remover', danger: true, onOk: () => api.post('/api/flash/remove_custom', { id }).then(renderFlash) }) });
  showCtx(items, x, y);
}
let ctxNative = false, ctxMouse = { x: -99, y: -99 };
document.addEventListener('mousedown', e => { ctxMouse = { x: e.clientX, y: e.clientY }; }, true);
['#qbox', '#wctl'].forEach(sel => { const el = document.querySelector(sel); if (el) el.addEventListener('mousedown', e => e.stopPropagation()); });
document.addEventListener('contextmenu', e => { ctxMouse = { x: e.clientX, y: e.clientY }; }, true);
function ctxMode() { return S.config.ctx_menu || S.themeMenu || 'ludrix'; }
function ctxNativeOk() { return !!(S.config.native && S.config.frameless && ctxMode() === 'windows' && !GP.active && !ctxNative && window.screenX !== undefined); }
const ctxIconCache = new Map();
function ctxWarm() {
  if (!ctxNativeOk()) return;
  const c = ctxColors(); const names = ['play', 'info', 'edit', 'folder', 'star', 'trash', 'copy', 'dl', 'x', 'refresh', 'eye', 'tag', 'disc', 'cog', 'dots', 'doc', 'image', 'spark', 'wrench', 'plus', 'check', 'ext', 'shield', 'save', 'list', 'grid', 'filter', 'sort'];
  const run = async () => { for (const n of names) { if (!I[n]) continue; ctxIcon(n, c.muted); } ctxIcon('play', c.onprimary); ctxIcon('trash', c.danger); };
  (window.requestIdleCallback || (f => setTimeout(f, 50)))(() => { run().catch(() => {}); });
}
window.addEventListener('load', () => setTimeout(ctxWarm, 4000));
function ctxIcon(name, color) {
  const svg = I[name]; if (!svg || !color) return null;
  const k = name + '|' + color;
  if (ctxIconCache.has(k)) return ctxIconCache.get(k);
  const src = svg.replace(/currentColor/g, color).replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" `);
  const v = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
  ctxIconCache.set(k, v); return v;
}
const ctxPngCache = new Map();
function ctxIconPng(name, color) {
  const src = ctxIcon(name, color); if (!src) return Promise.resolve(null);
  const k = name + '|' + color;
  if (ctxPngCache.has(k)) return Promise.resolve(ctxPngCache.get(k));
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => { try { const c = document.createElement('canvas'); c.width = 32; c.height = 32; c.getContext('2d').drawImage(img, 0, 0, 32, 32); const v = c.toDataURL('image/png'); ctxPngCache.set(k, v); res(v); } catch (e) { res(null); } };
    img.onerror = () => res(null);
    img.src = src;
  });
}
async function ctxStrip(list, pre) {
  const out = [];
  const color = matchMedia('(prefers-color-scheme: dark)').matches ? '#c9cdd3' : '#4b5059';
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    out.push({ id: pre + i, sep: !!it.sep, label: it.label || '', hint: it.hint || '', primary: !!it.primary, danger: !!it.danger, disabled: !!it.disabled,
      icon: it.icon && !it.sep ? await ctxIconPng(it.icon, color) : null, sub: it.sub ? await ctxStrip(it.sub, pre + i + '.') : null });
  }
  return out;
}
function varRgb(v) {
  const el = document.createElement('i'); el.style.cssText = `position:absolute;visibility:hidden;color:var(${v})`; document.body.appendChild(el);
  const c = getComputedStyle(el).color; el.remove();
  let m = c.match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+%?))?/); if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]];
  m = c.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?:\s*\/\s*([\d.]+%?))?/); if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]];
  return null;
}
function ctxColors() {
  const hex = a => a ? '#' + a.map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('') : '';
  const mix = (p, q, k) => p && q ? [0, 1, 2].map(i => p[i] * (1 - k) + q[i] * k) : null;
  const bg0 = varRgb('--bg') || [24, 28, 34, 1], bg = mix(bg0, varRgb('--bg2') || bg0, (varRgb('--bg2') || [0, 0, 0, 1])[3]);
  const over = v => { const c = varRgb(v); return c ? mix(bg, c, c[3]) : null; };
  const tx = over('--text'), ac = over('--accent') || over('--green2') || tx;
  return { bg: hex(bg), text: hex(tx), muted: hex(over('--muted2') || over('--muted')), primary: hex(ac), onprimary: hex(over('--on-accent') || (varRgb('--accent') ? [255, 255, 255] : bg)), danger: hex(over('--red')), line: hex(over('--line')), hover: hex(mix(bg, tx, 0.09)), card: hex(over('--card') || mix(bg, tx, 0.05)) };
}
function ctxUi() {
  const cs = getComputedStyle(document.body), r = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--r')) || 12;
  return { r: Math.round(r), font: (cs.fontFamily || '').split(',').slice(0, 2).join(','), rm: document.body.classList.contains('rm') ? '1' : '0', acr: document.body.classList.contains('acr') ? '1' : '0', light: document.documentElement.dataset.light || '0' };
}
async function showCtxNative(items, x, y, title, head) {
  ctxNative = true; ctxKey = null; $('#ctx').classList.remove('on');
  const near = Math.abs(ctxMouse.x - x) < 6 && Math.abs(ctxMouse.y - y) < 6;
  let r = null;
  try {
    const colors = ctxColors();
    const stripped = await ctxStrip(items, '');
    r = await api.post('/api/window', { cmd: 'ctx', items: stripped, title: head ? '' : (title || ''), head: head || null, colors, ui: ctxUi(), at_cursor: near ? '1' : '0', x: Math.round(window.screenX + x), y: Math.round(window.screenY + y), light: document.documentElement.dataset.light || '0' });
  } catch (e) { r = null; }
  ctxNative = false;
  if (r && r.cancelled) return true;
  if (!r || !r.ok) return false;
  if (r.pick != null) {
    const [a, b] = String(r.pick).split('.'); const it = b === undefined ? items[+a] : (items[+a] && items[+a].sub || [])[+b];
    if (it && it.fn) it.fn();
  }
  return true;
}
function showCtx(items, x, y, title, head) {
  if (ctxNativeOk()) { showCtxNative(items, x, y, title, head).then(ok => { if (!ok) showCtxLocal(items, x, y, title, head && head.html); }); return; }
  showCtxLocal(items, x, y, title, head && head.html);
}
function showCtxLocal(items, x, y, title, head) {
  const c = $('#ctx');
  const row = (it, i, pre) => it.sep ? '<hr>' : `<button class="${it.danger ? 'danger' : ''} ${it.primary ? 'primary' : ''} ${it.sub ? 'has-sub' : ''}" data-i="${pre}${i}">${I[it.icon] || ''}<span>${esc(it.label)}</span>${it.hint ? `<em>${esc(it.hint)}</em>` : ''}${it.sub ? '<svg class="car" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>' : ''}</button>`;
  c.innerHTML = (head || '') + (title ? `<h5>${esc(title)}</h5>` : '') + items.map((it, i) => it.sub ? `<div class="subw">${row(it, i, '')}<div class="sub">${it.sub.map((x, k) => row(x, k, i + '.')).join('')}</div></div>` : row(it, i, '')).join('');
  const find = id => { const [a, b] = id.split('.'); return b === undefined ? items[+a] : items[+a].sub[+b]; };
  c.querySelectorAll('button').forEach(b => b.onclick = e => { const it = find(b.dataset.i); if (it.sub) { e.stopPropagation(); if (c.classList.contains('tall')) b.parentElement.classList.toggle('open'); return; } c.classList.remove('on'); it.fn && it.fn(); });
  c.querySelectorAll('.subw').forEach(w => w.addEventListener('mouseenter', () => { if (c.classList.contains('tall')) return; const sub = w.querySelector('.sub'); sub.classList.remove('left'); sub.style.top = ''; sub.style.maxHeight = ''; const wr = w.getBoundingClientRect(); let r = sub.getBoundingClientRect(); if (r.right > innerWidth - 8) sub.classList.add('left'); if (r.height > innerHeight - 16) { sub.style.maxHeight = (innerHeight - 16) + 'px'; sub.style.overflowY = 'auto'; r = sub.getBoundingClientRect(); } const want = Math.max(8, Math.min(wr.top - 6, innerHeight - 8 - r.height)); sub.style.top = (want - wr.top) + 'px'; }));
  c.classList.add('on'); placeCtx(x, y);
  setTimeout(() => document.addEventListener('click', () => c.classList.remove('on'), { once: true }), 0);
}
async function addFlash(kind, hint) {
  const done = r => { if (r.error) return toast('err', 'Não foi possível concluir', r.error); if (r.ok) { toast('ok', 'Jogo adicionado', r.title); S.tab.flash = 'lib'; S.flashF = 'mine'; renderFlash(); editFlash(r.id); } };
  if (S.config.native) return done(await api.post('/api/flash/add', { kind }));
  modal({ title: 'Adicionar jogo rápido', text: hint, input: '', ok: 'Adicionar', onOk: async v => done(await api.post('/api/flash/add', { path: v, kind })) });
}
function addFlashUrl() {
  modal({ title: 'Jogo de site', wide: true, html: `<div class="fedit"><label style="grid-column:1/-1">Endereço do jogo<input class="mi" id="fuU" placeholder="https://…"></label><label style="grid-column:1/-1">Nome<input class="mi" id="fuT" placeholder="Como vai aparecer no cartão"></label></div>
    <p style="color:var(--muted);font-size:12px;margin-top:8px">O jogo abre numa janela própria do Ludrix, com internet. Serve pra qualquer página de jogo (Newgrounds, itch.io, Poki, CrazyGames…).</p>`,
    ok: 'Adicionar', onOk: async () => { const r = await api.post('/api/flash/add', { path: $('#fuU').value, title: $('#fuT').value }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); S.tab.flash = 'lib'; S.flashF = 'mine'; renderFlash(); } });
}
function editFlash(id) {
  const g = (S.flash?.games || []).find(z => z.id === id); if (!g) return;
  modal({ title: 'Editar jogo', wide: true, html: `<div class="fedit">
    <label>Título<input class="mi" id="feT" value="${esc(g.title)}"></label><label>Gênero<input class="mi" id="feG" value="${esc(g.genre)}"></label>
    <label>Controles<input class="mi" id="feC" value="${esc(g.controls)}" placeholder="Setas, Mouse, WASD…"></label><label>Jogadores<input class="mi" id="feP" value="${esc(g.players)}"></label>
    <label style="grid-column:1/-1">Dica / descrição<input class="mi" id="feD" value="${esc(g.tip)}"></label>
    ${g.type === 'web' ? `<label style="grid-column:1/-1">Endereço<input class="mi" id="feU" value="${esc(g.url || '')}"></label>` : ''}
    <label>Largura<input class="mi" id="feW" type="number" value="${g.w}"></label><label>Altura<input class="mi" id="feH" type="number" value="${g.h}"></label></div>
    <p style="color:var(--muted);font-size:12px;margin-top:8px">${g.type === 'web' ? 'Largura/altura definem o tamanho inicial da janela do jogo.' : 'Largura/altura definem a proporção da janela do jogo (li do cabeçalho do .swf; ajuste se ficar cortado).'}</p>`,
    ok: 'Salvar', onOk: async () => { await api.post('/api/flash/update', { id, title: $('#feT').value, genre: $('#feG').value, controls: $('#feC').value, players: $('#feP').value, tip: $('#feD').value, w: +$('#feW').value || g.w, h: +$('#feH').value || g.h, url: $('#feU') ? $('#feU').value : undefined }); renderFlash(); } });
}

const CENTRAL_TABS = [['redists', 'Dependências'], ['minecraft', 'Minecraft'], ['disk', 'Espaço em disco']];
async function renderCentral(force) {
  let tab = S.tab.central || 'redists'; if (!CENTRAL_TABS.some(([id]) => id === tab)) tab = 'redists';
  const cached = S.redists && S.mc;
  if (cached && !force) { centralHtml(tab, S.redists, S.mc); refreshCentral(tab); return; }
  if (!cached) $('#view').innerHTML = `<div class="h1"><h2>Central Ludrix</h2><span>verificando o PC…</span></div>`;
  else { const sp = $('#view .h1>span'); if (sp) sp.textContent = 'verificando o PC…'; }
  const q = force ? '?refresh=1' : '';
  const [r, mc] = await Promise.all([api.get('/api/redists' + q), api.get('/api/minecraft' + q)]);
  if (S.view !== 'central') return;
  S.redists = r; S.mc = mc; S.central = true;
  centralHtml(tab, r, mc);
}
let CENTRAL_BG = null;
function refreshCentral(tab) {
  if (CENTRAL_BG) return;
  const before = JSON.stringify([S.redists, S.mc]);
  CENTRAL_BG = Promise.all([api.get('/api/redists'), api.get('/api/minecraft')]).then(([r, mc]) => {
    CENTRAL_BG = null; if (!r || !mc || r.error || mc.error) return;
    if (JSON.stringify([r, mc]) === before) return;
    S.redists = r; S.mc = mc;
    if (S.view === 'central') centralHtml(S.tab.central || tab, r, mc);
  }).catch(() => { CENTRAL_BG = null; });
}
function centralHtml(tab, r, mc) {
  const missing = r.items.filter(i => i.state === 'missing').length;
  const mcInst = mc.items.filter(i => i.installed).length;
  const body = tab === 'minecraft' ? minecraftHtml(mc) : tab === 'disk' ? diskHtml(S.disk) : redistsHtml(r);
  const badge = { redists: missing && (r.windows || r.prefix_ready) ? `<span class="n">${missing}</span>` : '', minecraft: mcInst ? `<span class="n">${mcInst}</span>` : '', disk: '' };
  const sub = { disk: diskSub(), redists: missing && (r.windows || r.prefix_ready) ? pl(missing, 'dependência faltando — jogos podem fechar na hora', 'dependências faltando — jogos podem fechar na hora') : 'bibliotecas que os jogos pedem (Visual C++, DirectX, .NET…)', minecraft: 'edições e launchers encontrados neste PC' }[tab];
  const acts = { redists: `<button class="btn s" onclick="api.post('/api/redist/open',{})" title="Abrir a pasta redists\\">${I.folder}</button><button class="btn s" onclick="renderCentral(true)">${I.refresh} Re-checar</button>`,
    minecraft: `<button class="btn s" onclick="renderCentral(true)">${I.refresh} Procurar de novo</button>`,
    disk: `<button class="btn s" onclick="diskLoad(true)" ${S.disk && S.disk.pending ? 'disabled' : ''}>${I.refresh} Recalcular</button>` }[tab];
  $('#view').innerHTML = `<div class="h1"><h2>Central Ludrix</h2><span>${sub}</span><div class="acts">${ONLINE ? '' : '<span class="offl">sem conexão</span>'}${acts}</div></div>
    <div class="tabs ctabs">${CENTRAL_TABS.map(([id, n]) => `<button class="${tab === id ? 'on' : ''}" onclick="centralTab('${id}')">${n}${badge[id]}</button>`).join('')}</div>
    <div class="cbody">${body}</div>`;
}
async function centralTab(id) { S.tab.central = id; await renderCentral(); if (id === 'disk') diskLoad(false); }
let DISK_T = 0;
function diskSub() {
  const d = S.disk; if (!d) return 'quanto cada jogo ocupa, por disco';
  const tot = d.games.reduce((a, g) => a + g.size, 0);
  return d.pending ? `calculando… faltam ${d.pending}` : `${pl(d.games.length, 'jogo ocupa', 'jogos ocupam')} ${fmt(tot) || '0 B'} em ${pl(d.disks.filter(k => k.games).length || 1, 'disco', 'discos')}`;
}
async function diskLoad(refresh) {
  clearTimeout(DISK_T);
  const r = await api.post('/api/disk/space', { refresh: !!refresh });
  if (!r || r.error) { if (r && r.error) toast('err', 'Espaço em disco', r.error); return; }
  S.disk = r;
  if (S.view === 'central' && (S.tab.central || 'redists') === 'disk') centralHtml('disk', S.redists || { items: [] }, S.mc || { items: [] });
  if (r.pending) DISK_T = setTimeout(() => { if (S.view === 'central' && S.tab.central === 'disk') diskLoad(false); }, 1500);
}
function diskHtml(d) {
  if (!d) return `<div class="note">Calculando o tamanho das pastas…</div>`;
  if (!d.games.length) return emptyHtml('folder', 'Nenhum jogo em pasta', 'Só jogos instalados em pasta entram aqui. ROMs e jogos abertos por link (Steam, Epic…) não contam.');
  const byDisk = new Map();
  for (const g of d.games) { const k = g.disk || '?'; if (!byDisk.has(k)) byDisk.set(k, []); byDisk.get(k).push(g); }
  const disks = d.disks.filter(k => byDisk.has(k.mount)).concat(byDisk.has('?') ? [{ mount: '?', total: 0, free: 0, games: 0 }] : []);
  disks.sort((a, b) => (byDisk.get(b.mount).reduce((x, g) => x + g.size, 0)) - (byDisk.get(a.mount).reduce((x, g) => x + g.size, 0)));
  const busy = k => { const j = S.jobs[k]; return j && j.stage === 'move'; };
  return disks.map(k => {
    const gs = byDisk.get(k.mount).slice().sort((a, b) => b.size - a.size);
    const gsum = gs.reduce((x, g) => x + g.size, 0);
    const used = k.total ? k.total - k.free : 0, pu = k.total ? Math.min(100, used / k.total * 100) : 0, pg = k.total ? Math.min(pu, gsum / k.total * 100) : 0;
    const name = k.mount === '?' ? 'Outro lugar' : k.mount.replace(/\\$/, '');
    const open = DISK_OPEN.has(k.mount) || disks.length === 1 || DISK_OPEN.size === 0 && k === disks[0];
    return `<div class="dsk ${open ? 'open' : ''}" data-m="${esc(k.mount)}">
      <div class="dskh" onclick="diskToggle(${jsq(k.mount)})">${I.hdd}<b>${esc(name)}</b><span class="dsn">${pl(gs.length, 'jogo', 'jogos')} · ${fmt(gsum) || '0 B'}</span><span class="sp"></span>${k.total ? `<span class="dsf">${fmt(k.free)} livres de ${fmt(k.total)}</span>` : ''}${I.chev}</div>
      ${k.total ? `<div class="dsbar" title="Usado: ${fmt(used)} · jogos do Ludrix: ${fmt(gsum) || '0 B'}"><i style="width:${pu.toFixed(1)}%"></i><em style="width:${pg.toFixed(1)}%"></em></div>` : ''}
      <div class="dskl">${gs.map(g => `<div class="dsg ${busy(g.key) ? 'busy' : ''}"><img src="/cover/${enc(g.key)}?v=${(S.byKey[g.key] || {}).cv || 0}" loading="lazy" onerror="this.style.visibility='hidden'"><div class="dsgt"><b title="${esc(g.title)}" onclick="openGame(${jsq(g.key)})">${esc(g.title)}</b><span title="${esc(g.dir)}">${esc(g.dir)}</span></div><span class="dsz">${g.at ? (fmt(g.size) || '0 B') : '<i>…</i>'}</span>${busy(g.key) ? `<span class="pill">movendo…</span>` : `<button class="btn s xs" onclick="diskMove(${jsq(g.key)})" title="Mover a pasta deste jogo para outro disco">${I.move} Mover</button>`}</div>`).join('')}</div>
    </div>`;
  }).join('');
}
const DISK_OPEN = new Set();
function diskToggle(m) { if (DISK_OPEN.has(m)) DISK_OPEN.delete(m); else DISK_OPEN.add(m); const el = document.querySelector(`.dsk[data-m="${CSS.escape(m)}"]`); if (el) el.classList.toggle('open', DISK_OPEN.has(m)); }
function diskMove(key) {
  const d = S.disk, g = d && d.games.find(x => x.key === key); if (!g) return;
  const others = d.disks.filter(k => k.mount !== g.disk && k.total);
  const sub = (() => { const parts = g.dir.split(/[\\/]/).filter(Boolean); return parts.length >= 2 ? parts.slice(1, -1).join(SEP()) : 'Jogos'; })();
  const dest = m => m.replace(/[\\/]$/, '') + SEP() + sub;
  const suggested = others.length ? dest(others[0].mount) : '';
  const html = others.length ? `<div class="mlist dskp">${others.map(k => `<button data-d="${esc(dest(k.mount))}"><b>${esc(k.mount.replace(/\\$/, ''))}</b><span>${fmt(k.free)} livres de ${fmt(k.total)}</span>${k.free < g.size * 1.05 + 2e8 ? '<em>não cabe</em>' : ''}</button>`).join('')}</div>` : `<div class="note">Nenhum outro disco encontrado. Você ainda pode escolher uma pasta.</div>`;
  modal({ title: `Mover “${g.title}”`, text: `Ocupa ${fmt(g.size) || '?'} em ${g.dir}. Para onde vai a pasta?`, html, input: suggested, ok: 'Mover', extra: 'Escolher pasta…', wait: true,
    onExtra: async () => { const r = await api.post('/api/pick_path', { kind: 'folder', initial: suggested }); if (r && r.path) diskMoveTo(key, g.title, r.path); },
    onOk: v => { if (!v) { toast('err', 'Informe a pasta de destino', ''); return false; } return diskMoveTo(key, g.title, v); } });
  document.querySelectorAll('.dskp button').forEach(b => b.onclick = () => { document.querySelectorAll('.dskp button').forEach(y => y.classList.remove('on')); b.classList.add('on'); const i = $('#mIn'); if (i) i.value = b.dataset.d; });
}
async function diskMoveTo(key, title, dest) {
  const r = await api.post('/api/game/move', { key, dest }); if (r.error) { toast('err', 'Não foi possível mover', r.error); return false; }
  S.jobs[key] = { stage: 'move', fraction: 0, detail: 'Iniciando…' }; qfabSync(); toast('ok', 'Movendo pasta', `${title} → ${dest}`);
  if (S.view === 'central') centralHtml('disk', S.redists || { items: [] }, S.mc || { items: [] });
  return true;
}
function minecraftHtml(m) {
  const tile = i => {
    const j = S.jobs['mc:' + i.id];
    const st = i.installed ? `<span class="pill ok">${i.kind === 'store' ? 'Microsoft Store' : i.kind === 'jar' ? 'instalado (.jar)' : 'instalado'}</span>` : '';
    const lib = i.in_library ? `<span class="pill">na Biblioteca</span>` : '';
    let acts;
    if (j) acts = progHtml(j, 'mc:' + i.id);
    else if (i.installed) acts = `<div class="ta">${i.in_library ? `<button class="btn p" onclick="play(${jsq(i.in_library)})">${I.play} Jogar</button><button class="btn s" onclick="openGame(${jsq(i.in_library)})">${I.info || I.edit} Detalhes</button>` : `<button class="btn p" onclick="mcAdd('${i.id}')">${I.plus} Colocar na Biblioteca</button>`}${i.path && i.kind !== 'store' ? `<span class="pill" title="${esc(i.path)}" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.path.split(/[\\/]/).pop())}</span>` : ''}</div>`;
    else acts = `<div class="ta"><button class="btn p" onclick="api.post('/api/minecraft/open',{id:'${i.id}',where:'site'})">${I.ext} Baixar no site</button><button class="btn s" onclick="mcLocate('${i.id}')" title="Já tenho: apontar o executável">${I.folder} Localizar</button></div>`;
    return `<div class="tile ${i.installed ? 'ok' : ''}"><div class="tt"><b title="${esc(i.title)}">${esc(i.title)}</b>${st}${lib}</div><div class="td">${esc(i.desc)}${i.kind === 'jar' && !m.java ? ' <b style="color:var(--amber)">Java não encontrado.</b>' : ''}</div>${acts}</div>`;
  };
  const eds = (m.editions || []).map(e => {
    const inst = e.installed;
    let info = '', warn = '';
    if (e.edition === 'java') {
      if (inst) info = `<span class="pill" title="${esc(e.dir)}">${esc(e.dir.split(/[\\/]/).slice(-2).join(SEP()))}</span>${e.versions ? `<span class="pill">${e.versions} ${e.versions === 1 ? 'versão' : 'versões'}</span>` : ''}${e.mods ? `<span class="pill">${pl(e.mods, 'mod', 'mods')}</span>` : ''}`;
      if (inst && !e.launcher) warn = `<div class="note warn" style="margin-top:8px">Minecraft Java encontrado, mas <b>nenhum launcher</b> para abri-lo. Sem launcher ele não abre: instale um abaixo (<b>Prism Launcher</b> recomendado, código aberto, ou o oficial da Mojang).</div>`;
      else if (inst || e.launcher) info += `<span class="pill ok">${e.launcher_title ? 'abre pelo ' + esc(e.launcher_title) : ''}</span>`;
    } else if (!m.windows) info = `<span class="pill">só no Windows</span>`;
    const sel = e.edition === 'java' && (m.launchers_installed || []).length > 1 ? `<select class="mi" style="width:auto;max-width:220px" onchange="mcSetLauncher(this.value)" title="Qual launcher abre o Java Edition">${m.launchers_installed.map(l => `<option value="${l.id}" ${l.id === e.launcher ? 'selected' : ''}>${esc(l.title)}</option>`).join('')}</select>` : '';
    let acts;
    if (inst || (e.edition === 'java' && e.launcher)) acts = `<div class="ta">${e.in_library ? `<button class="btn p" onclick="play(${jsq(e.in_library)})">${I.play} Jogar</button><button class="btn s" onclick="openGame(${jsq(e.in_library)})">${I.info || I.edit} Detalhes</button>` : `<button class="btn p" onclick="mcAdd('${e.edition}')">${I.plus} Colocar na Biblioteca</button>`}${sel}</div>`;
    else if (e.edition === 'bedrock' && m.windows) acts = `<div class="ta"><button class="btn s" onclick="api.post('/api/minecraft/open',{id:'bedrock',where:'store'})">${I.ext} Microsoft Store</button></div>`;
    else acts = `<div class="ta"><span class="pill">não encontrado</span></div>`;
    return `<div class="tile ${inst ? 'ok' : ''}"><div class="tt"><b>${esc(e.title)}</b>${inst ? '<span class="pill ok">instalado</span>' : ''}${e.in_library ? '<span class="pill">na Biblioteca</span>' : ''}</div><div class="td">${esc(e.desc)}</div><div class="td" style="display:flex;gap:6px;flex-wrap:wrap">${info}</div>${warn}${acts}</div>`;
  }).join('');
  const show = m.items.filter(i => i.installed || i.suggest);
  return `
    <div class="gh"><h3>No seu PC</h3><span>Edições encontradas neste computador</span></div><div class="tiles">${eds}</div>
    <div class="gh"><h3>Launchers</h3><span>os instalados e dois sugeridos: Prism Launcher (código aberto, modpacks) e SKLauncher (leve e prático)</span></div><div class="tiles">${show.map(tile).join('')}</div>`;
}
async function mcAdd(id) { const r = await api.post('/api/minecraft/add', { id }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); toast('ok', 'Minecraft na Biblioteca', r.launcher || id === 'bedrock' ? 'Clique em Jogar para abrir.' : 'Ao clicar em Jogar, o Ludrix indica um launcher.', r.key ? [{ label: 'Abrir', fn: () => { setView('home'); openGame(r.key); } }] : null); await loadCatalog(); if (S.view === 'central') renderCentral(); }
async function mcLocate(id) { const r = await api.post('/api/minecraft/locate', { id }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); if (r.ok) { toast('ok', 'Minecraft na Biblioteca', 'Launcher apontado com sucesso.'); await loadCatalog(); if (S.view === 'central') renderCentral(); } }
async function mcSetLauncher(id) { const r = await api.post('/api/minecraft/launcher', { id }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); toast('ok', 'Minecraft', 'Java Edition passa a abrir por esse launcher.'); await loadCatalog(); if (S.view === 'central') renderCentral(); }
function mcNeedLauncher(r) {
  const recs = (r.recommend || []).map((x, i) => `<div class="tile ${i === 0 ? 'ok' : ''}"><div class="tt"><b>${esc(x.title)}</b>${i === 0 ? '<span class="pill ok">recomendado</span>' : ''}</div><div class="td">${esc(x.why)} ${esc(x.desc)}</div><div class="ta"><button class="btn p sm" onclick="api.post('/api/minecraft/open',{id:'${x.id}',where:'site'})">${I.ext} Baixar no site</button><button class="btn s sm" onclick="$('#modal').classList.remove('on');mcLocate('${x.id}')">${I.folder} Já tenho</button></div></div>`).join('');
  modal({ title: 'Falta um launcher de Minecraft', html: `<p>O Minecraft Java Edition está no PC, mas nenhum launcher para abri-lo. O launcher cuida da conta, das versões e dos mods; escolha um:</p><div class="tiles" style="margin-top:10px">${recs}</div><p class="mut" style="margin-top:10px">Outros launchers (MultiMC, ATLauncher, Modrinth, CurseForge…) ficam em Central › Minecraft.</p>`, wide: true, ok: 'Não fazer nada', noCancel: true });
}
function mcNeedBedrock(r) {
  modal({ title: 'Minecraft Bedrock não está instalado', text: 'A edição Bedrock vem pela Microsoft Store. Depois de instalar, volte e clique em Jogar.', ok: 'Abrir na Microsoft Store', cancel: 'Não fazer nada', onOk: () => api.post('/api/minecraft/open', { id: 'bedrock', where: 'store' }) });
}
function redistsHtml(r) {
  const st = { installed: ['ok', 'instalado'], missing: ['warn', 'faltando'], unknown: ['', ''] };
  const jobOf = id => S.jobs['redist:' + id];
  const bundleJob = id => S.jobs['redist:bundle:' + id];
  const item = i => { const j = jobOf(i.id); return `<div class="tile ${st[i.state][0]}"><div class="tt"><b title="${esc(i.title)}">${esc(i.title)}</b><span class="pill">${esc(i.arch)}</span>${st[i.state][1] ? `<span class="pill ${st[i.state][0] === 'warn' ? 'warn' : st[i.state][0]}">${st[i.state][1]}</span>` : ''}</div>${i.note ? `<div class="td">${esc(i.note)}</div>` : ''}
    ${j ? progHtml(j, 'redist:' + i.id) : `<div class="ta">${i.state === 'installed' ? `<button class="btn s" onclick="redistInstall('${i.id}')" title="Reinstalar/reparar">${I.refresh} Reparar</button>` : `<button class="btn ${i.state === 'missing' ? 'p' : 's'}" ${ONLINE || i.downloaded ? '' : 'disabled'} onclick="redistInstall('${i.id}')">${I.dl} Instalar${i.downloaded ? '' : ' · ' + fmt(i.size)}</button>`}</div>`}</div>`; };
  return `${!r.windows && !r.prefix_ready ? `<div class="note warn">O prefixo do Proton ainda não existe. Ele é criado na primeira instalação daqui ou ao abrir um jogo de Windows.</div>` : ''}
    <div class="gh"><h3>Pacotes</h3><span>instalam várias de uma vez</span></div>
    <div class="tiles narrow">${r.bundles.map(b => { const j = bundleJob(b.id); const todo = b.items.filter(id => (r.items.find(i => i.id === id) || {}).state !== 'installed').length; return `<div class="tile"><div class="tt"><b>${esc(b.title)}</b></div><div class="td">${esc(b.desc)}</div>${j ? progHtml(j, 'redist:bundle:' + b.id) : `<div class="ta"><button class="btn ${b.id === 'classic' ? 'p' : 's'}" ${todo && ONLINE ? '' : 'disabled'} onclick="redistBundle('${b.id}')">${I.dl} ${todo ? `Instalar ${todo === 1 ? '1 que falta' : todo + ' que faltam'}` : 'Tudo instalado'}</button></div>`}</div>`; }).join('')}</div>
    ${r.groups.map(g => `<div class="gh"><h3>${esc(g.name)}</h3><span>${esc(g.desc)}</span></div><div class="tiles wide">${r.items.filter(i => i.group === g.id).map(item).join('')}</div>`).join('')}`;
}
async function redistInstall(id) { const r = await api.post('/api/redist/install', { id }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); S.jobs['redist:' + id] = { stage: 'download', fraction: 0, detail: 'Iniciando…' }; renderCentral(); pollSoon(); }
async function redistBundle(id) { const r = await api.post('/api/redist/bundle', { id }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); if (r.queued === 0) return toast('ok', 'Já está tudo instalado', ''); S.jobs['redist:bundle:' + id] = { stage: 'download', fraction: 0, detail: 'Iniciando…' }; renderCentral(); pollSoon(); }

const G = { id: null, i: 0, el: null };
function guide() { }
function guideDismiss() { }

function hashStr(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
async function installFlash(id) { const r = await api.post('/api/flash/install', { id }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); S.jobs['flash:' + id] = { stage: 'download', fraction: 0, detail: 'Iniciando…' }; qfabSync(); renderFlash(); pollSoon(); }
async function playFlash(id) {
  const g = (S.flash?.games || []).find(x => x.id === id); if (!g) return;
  if (g.type === 'web') { const r = await api.post('/api/flash/play_web', { id }); if (r.error) toast('err', 'Não foi possível abrir', r.error); else if (r.browser) toast('info', 'Aberto no navegador', g.title); return; }
  if (g.type !== 'html5' && !S.flash.ruffle) return modal({ title: 'Falta o player', text: 'Instala o Ruffle (10 MB, uma vez só) para rodar os jogos Flash.', ok: 'Instalar', cancel: 'Não fazer nada', onOk: () => installFlash('ruffle') });
  $('#ftitle').textContent = g.title; $('#fhint').textContent = `${g.controls} · ${g.tip}`;
  $('#fframe').src = '/flash/play/' + id; $('#flashwin').classList.add('on');
  api.post('/api/flash/played', { id });
}
function closeFlash() { $('#flashwin').classList.remove('on'); $('#fframe').src = 'about:blank'; if (S.view === 'flash') renderFlash(); }
function flashFull() { const f = $('#fframe'); (f.requestFullscreen || f.webkitRequestFullscreen || (() => { })).call(f); }
window.addEventListener('message', e => { if (e.data === 'flash:close') closeFlash(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#flashwin').classList.contains('on')) closeFlash(); });

async function afterCoverChange(key) {
  await loadCatalog(false);
  if (S.det && S.det.key === key) { const d = await api.get('/api/game/' + enc(key)); S.det = d; renderDetail(); setHero(key, `/hero/${enc(key)}?v=${(S.byKey[key] || {}).cv || Date.now()}`); }
}
async function setCover(key, path) {
  if (!path && !S.config.native) return modal({ title: 'Trocar capa', text: 'Caminho completo da imagem (PNG, JPG ou WEBP):', input: '', ok: 'Usar', onOk: v => v && setCover(key, v) });
  const r = await api.post('/api/cover/set', { key, path });
  if (r.error) return toast('err', 'Capa', r.error);
  if (r.ok) { toast('ok', 'Capa trocada', 'Guardada em data\\covers — vale para sempre, mesmo atualizando metadados.'); afterCoverChange(key); }
}
async function resetCover(key) { await api.post('/api/cover/reset', { key }); toast('', 'Capa original restaurada', ''); afterCoverChange(key); }

async function savesPanel(key, deep) {
  modal({ title: 'Saves', text: 'Procurando onde o jogo salva…', noOk: true, cancel: 'Fechar', wide: true });
  const s = await api.get('/api/saves/' + enc(key) + (deep ? '?deep=1' : ''));
  if (s.error) return modal({ title: 'Saves', text: s.error, noOk: true, cancel: 'Fechar' });
  const how = { manual: ['Pasta definida por você', 'ok'], preset: ['Local conhecido deste jogo', 'ok'], emulator: ['Pasta de saves do emulador', 'ok'], crack: ['Save de versão com crack (emulador de Steam)', 'warn'], generic: ['Encontrada em pasta padrão', 'ok'], search: ['Encontrado por busca rápida — confira', 'warn'], none: ['Não encontrada automaticamente', 'warn'] }[s.how] || ['', ''];
  const where = s.dir ? `<div class="savedir"><span class="pill ${how[1]}">${how[0]}</span><code>${esc(s.dir)}</code></div>` : `<div class="note"><b>Pasta de save não encontrada.</b> ${s.candidates && s.candidates.length ? 'Esperava em: ' + esc(s.candidates[0]) + '. ' : ''}Se o jogo é pirata/crackeado, o save pode estar em outro lugar: rode o jogo uma vez, salve, e depois use <b>Procurar mais a fundo</b> ou <b>Escolher pasta manualmente</b>.</div>`;
  const alts = s.alternatives && s.alternatives.length ? `<details class="salt"><summary>Outras pastas parecidas (${s.alternatives.length})</summary>${s.alternatives.map(a => `<button class="btn s sm" onclick="api.post('/api/saves/set_dir',{key:${jsq(key)},folder:${jsq(a)}}).then(()=>savesPanel(${jsq(key)}))">${I.folder} ${esc(a)}</button>`).join('')}</details>` : '';
  const emuNote = s.how === 'manual' ? '' : s.how === 'emulator' ? `<p style="margin:8px 0 0">Emulador: <b>${esc(s.emulator_title || s.emulator || '')}</b>. ${esc(s.note || '')}</p>` : s.note ? `<p style="margin:8px 0 0">${esc(s.note)}</p>` : '';
  const ext = s.ext && s.ext.length ? `<p style="margin:6px 0 0;font-size:12px;color:var(--muted)">Formatos esperados: ${s.ext.map(e => `<span class="code">${esc(e)}</span>`).join(' ')}${s.folder ? ' · o save é uma pasta inteira' : ''}</p>` : '';
  const bks = s.backups && s.backups.length ? `<details class="salt"><summary>Backups automáticos (${s.backups.length}) — feitos antes de cada importação</summary>${s.backups.map(b => `<div class="bk"><span>${esc(b.name)} · ${fmt(b.size)}</span><button class="btn s sm" onclick="api.post('/api/saves/restore',{key:${jsq(key)},backup:${jsq(b.path)},dir:${jsq(s.dir)}}).then(r=>{toast(r.error?'err':'ok','Backup',r.error||'Restaurado');savesPanel(${jsq(key)})})">Restaurar</button></div>`).join('')}</details>` : '';
  const html = `<div class="saves">${where}${emuNote}${ext}${alts}
    <div class="sgrid">
      <button class="sact" ${s.dir ? '' : 'disabled'} onclick="openPath(${jsq(s.dir)})">${I.folder}<div><b>Abrir pasta</b><small>Ver os arquivos de save no Explorer</small></div></button>
      <button class="sact" ${s.dir ? '' : 'disabled'} onclick="savesImport(${jsq(key)},${jsq(s.dir)},false)">${I.import}<div><b>Importar save (arquivo / .zip)</b><small>Um save baixado da internet vai para o lugar certo, com backup do atual</small></div></button>
      <button class="sact" ${s.dir ? '' : 'disabled'} onclick="savesImport(${jsq(key)},${jsq(s.dir)},true)">${I.folder}<div><b>Importar uma pasta</b><small>Quando o save é uma pasta inteira (PPSSPP, RPCS3, perfis)</small></div></button>
      <button class="sact" ${s.dir ? '' : 'disabled'} onclick="api.post('/api/saves/export',{key:${jsq(key)},dir:${jsq(s.dir)}}).then(r=>toast(r.error?'err':'ok','Exportar',r.error||'Zip salvo em Downloads'))">${I.dl}<div><b>Exportar (.zip)</b><small>Copia o save para Downloads para guardar ou compartilhar</small></div></button>
      <button class="sact" onclick="savesPanel(${jsq(key)},true)">${I.refresh}<div><b>Procurar mais a fundo</b><small>Busca mais demorada (até ~12 s) por pastas com o nome do jogo</small></div></button>
      <button class="sact" onclick="savesSetDir(${jsq(key)})">${I.cog}<div><b>Escolher pasta manualmente</b><small>Você aponta onde o jogo salva; fica lembrado</small></div></button>
    </div>${bks}</div>`;
  modal({ title: `Saves — ${s.title || ''}`, html, noOk: true, cancel: 'Fechar', wide: true });
}
async function savesImport(key, dest, folder) {
  if (!S.config.native) return modal({ title: 'Importar save', text: 'No modo navegador, digite o caminho do arquivo/pasta/.zip do save:', input: '', ok: 'Importar', onOk: async v => { const r = await api.post('/api/saves/import', { key, source: v, dest }); toast(r.error ? 'err' : 'ok', 'Save', r.error || `${r.count} arquivo(s) copiado(s)`); savesPanel(key); } });
  const r = await api.post(folder ? '/api/saves/import_folder' : '/api/saves/import', { key, dest });
  if (r.error) return toast('err', 'Save', r.error);
  if (r.ok) { toast('ok', 'Save importado', `${pl(r.count, 'arquivo', 'arquivos')} → ${dest}${r.backup ? ' · backup feito' : ''}`); savesPanel(key); }
}
async function savesSetDir(key) {
  if (!S.config.native) return modal({ title: 'Pasta de save', text: 'Digite o caminho completo da pasta onde o jogo salva:', input: '', ok: 'Salvar', onOk: async v => { const r = await api.post('/api/saves/set_dir', { key, folder: v }); if (r.error) toast('err', 'Não foi possível concluir', r.error); savesPanel(key); } });
  const r = await api.post('/api/saves/set_dir', { key });
  if (r.error) toast('err', 'Não foi possível concluir', r.error); else if (r.ok) toast('ok', 'Pasta de save definida', r.dir);
  savesPanel(key);
}

const IMP = { list: null, cur: null, games: [] };
function impCount() { const ok = $('#mOk'); if (!ok) return; const n = document.querySelectorAll('.impg input:checked').length; ok.textContent = n ? `Importar ${n === 1 ? '1 item' : n + ' itens'}` : 'Importar selecionados'; }
function impSort(by) { const box = $('.impgames'); if (!box) return; const rows = [...box.children]; const key = e => IMP.games[+e.querySelector('input').dataset.i] || {}; rows.sort((a, b) => by === 'play' ? (key(b).playtime || 0) - (key(a).playtime || 0) : by === 'new' ? (key(a).dup ? 1 : 0) - (key(b).dup ? 1 : 0) || COLL.compare(key(a).title || '', key(b).title || '') : COLL.compare(key(a).title || '', key(b).title || '')); rows.forEach(r => box.appendChild(r)); }
function impFilter(v) { const q = qnorm(v); document.querySelectorAll('.impg').forEach(e => { e.style.display = !q || qnorm(e.textContent).includes(q) ? '' : 'none'; }); }
function importSummary(a) {
  const rows = a.skipped_items.map(i => `<div class="frow"><div class="l"><b>${esc(i.title)}</b><span>${esc(i.why)}${i.path ? `<br><code>${esc(i.path)}</code>` : ''}</span></div></div>`).join('');
  modal({ title: 'Importação concluída', wide: true, text: `${pl(a.added, 'item adicionado', 'itens adicionados')} · ${pl(a.skipped, 'ignorado', 'ignorados')}. Os ignorados abaixo não entraram na biblioteca; corrija o caminho no Playnite ou adicione pelo botão + depois.`,
    html: `<div class="diag" style="max-height:46vh;overflow:auto">${rows}</div>`, ok: 'OK', noCancel: true,
    buttons: [{ label: 'Ver adicionados', fn: () => flagOnly('added') }, { label: 'Copiar lista', fn: () => { navigator.clipboard.writeText(a.skipped_items.map(i => `${i.title} — ${i.why}${i.path ? ' — ' + i.path : ''}`).join('\n')).then(() => toast('ok', 'Lista copiada')); importSummary(a); } }] });
}
async function importWizard() {
  modal({ title: 'Importar de outro launcher', text: 'Carregando…', noOk: true, cancel: 'Fechar', wide: true });
  IMP.list = await api.get('/api/import/launchers');
  const last = S.config.last_import || '';
  const html = `<div class="implist">${IMP.list.map(l => `<button class="impl ${l.detected ? 'det' : ''}" onclick="importPick('${l.id}')"><span class="ic">${esc(l.icon)}</span><div><b>${esc(l.name)}${l.id === last ? ' <span class="pill" style="margin-left:6px">último usado</span>' : ''}</b><small>${l.detected ? '<em>detectado</em> · ' + esc(l.default_path) : 'não encontrado no local padrão — é possível apontar a pasta mesmo assim'}</small></div></button>`).join('')}</div>`;
  modal({ title: 'Importar de outro launcher', text: 'De onde você quer trazer os jogos?', html, noOk: true, cancel: 'Fechar', wide: true });
}
function importPick(id) {
  const l = IMP.list.find(x => x.id === id); IMP.cur = l;
  const html = `<div class="impstep"><div class="impwhat"><b>O que selecionar</b><p>${esc(l.what)}</p>${l.tip ? `<p class="tip">${I.info || ''} ${esc(l.tip)}</p>` : ''}${l.detected ? `<p class="tip">O seletor abre em: <span class="code">${esc(l.default_path)}</span></p>` : ''}</div>
    ${id === 'playnite' ? `<label class="mchk" style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12.5px"><input type="checkbox" id="impHidden" ${S.config.import_hidden ? 'checked' : ''}> Incluir jogos marcados como ocultos no Playnite (entram ocultos aqui também)</label>` : ''}
    ${S.config.native ? '' : '<label class="ml">Caminho (modo navegador)</label><input class="mi" id="impPath" placeholder="' + esc(l.default_path) + '">'}</div>`;
  modal({ title: `Importar do ${l.name}`, html, ok: S.config.native ? (l.pick === 'file' ? 'Selecionar arquivo…' : 'Selecionar pasta…') : 'Ler', extra: '← Voltar', onExtra: importWizard, wide: true, onOk: async () => {
    let path;
    IMP.opts = { hidden: !!$('#impHidden')?.checked }; { const patch = {}; if (S.config.last_import !== id) patch.last_import = id; if (id === 'playnite' && !!S.config.import_hidden !== IMP.opts.hidden) patch.import_hidden = IMP.opts.hidden; if (Object.keys(patch).length) setCfg(patch); }
    if (S.config.native) { const r = await api.post('/api/import/pick', { id }); if (!r.path) return; path = r.path; }
    else { path = $('#impPath').value.trim() || l.default_path; }
    importScan(id, path);
  } });
  if (l.pick_alt && S.config.native) { const box = $('#modalBox .a'); const b = document.createElement('button'); b.className = 'btn s sm'; b.textContent = l.alt_label || 'Selecionar arquivo…'; b.onclick = async () => { const r = await api.post('/api/import/pick', { id, mode: l.pick_alt }); if (r.path) importScan(id, r.path); }; box.insertBefore(b, box.querySelector('#mNo')); }
}
async function importScan(id, path) {
  modal({ title: `Lendo ${IMP.cur.name}…`, html: `<p style="color:var(--muted);font-size:12.5px;margin:0 0 8px;word-break:break-all">${esc(path)}</p><div class="prog"><div class="h"><b><i></i>Lendo</b><span id="impMsg">Abrindo…</span></div><div class="track"><i style="width:40%;animation:indet 1.2s linear infinite"></i></div></div>`, noOk: true, cancel: 'Cancelar', wide: true, onCancel: () => { IMP.cancel = true; } });
  IMP.cancel = false;
  let r = await api.post('/api/import/scan', { id, path, opts: IMP.opts || {} });
  if (r.async) { while (true) { await new Promise(res => setTimeout(res, 500)); if (IMP.cancel) return; r = await api.get('/api/import/poll'); if (r.done) break; const m = $('#impMsg'); if (m) m.textContent = r.msg || '…'; } }
  if (r.error) return modal({ title: 'Não deu certo', text: r.error, ok: 'Tentar de novo', extra: '← Voltar', onExtra: importWizard, onOk: () => importPick(id) });
  IMP.games = r.games; IMP.dropped = r.dropped || [];
  if (!r.games.length) return modal({ title: 'Nada encontrado', text: 'Nenhum jogo nesse local. Confira a dica do que selecionar.', ok: 'Tentar de novo', extra: '← Voltar', onExtra: importWizard, onOk: () => importPick(id) });
  const sysPill = g => g.kind === 'emulator' ? `<span class="pill ac">emulador${g.systems && g.systems.length ? ' · ' + g.systems.map(x => S.systems[x] || x).join(', ') : ''}</span>` : `<span class="pill">${g.system && g.system !== 'pc' ? esc(S.systems[g.system] || g.system) : (g.rom_dir ? '<span style="color:var(--amber)">console?</span>' : 'PC')}</span>`;
  const row = (g, i) => `<label class="impg ${g.dup ? 'dup' : ''}"><input type="checkbox" data-i="${i}" ${g.dup ? '' : 'checked'}>${g.cover_file ? `<img class="impcov" src="/api/import/cover?p=${enc(g.cover_file)}" loading="lazy" alt="">` : g.kind === 'emulator' ? `<span class="impcov ic">${I.gamepad}</span>` : g.rom_dir ? `<span class="impcov ic">${I.folder}</span>` : '<span class="impcov ic"></span>'}<div class="t"><b>${esc(g.title)}</b><small>${g.rom_dir ? 'pasta de ROMs · ' + esc(g.rom_dir) : esc(g.exe || g.rom || g.emu_dir || g.dir || '')}${g.emulator && !g.kind ? ` · via ${esc(g.emulator)}` : ''}</small></div>${sysPill(g)}${g.playtime > 60 ? `<span class="pill">${Math.round(g.playtime / 3600) || '<1'} h</span>` : ''}${g.favorite ? '<span class="pill ac">★</span>' : ''}${g.hidden ? '<span class="pill" title="Marcado como oculto no Playnite">oculto</span>' : ''}${g.missing ? '<span class="pill warn" title="O arquivo não foi encontrado neste PC">arquivo ausente</span>' : ''}${g.dup ? '<span class="pill warn">já tem</span>' : ''}</label>`;
  const nE = r.games.filter(g => g.kind === 'emulator').length, nD = r.games.filter(g => g.rom_dir).length, nG = r.games.length - nE - nD;
  const html = `<div class="imphead"><span>${pl(nG, 'jogo', 'jogos')}${nE ? ` · ${pl(nE, 'emulador', 'emuladores')}` : ''}${nD ? ` · ${pl(nD, 'pasta', 'pastas')} de ROMs` : ''} · ${r.games.filter(g => g.dup).length} já ${r.games.filter(g => g.dup).length === 1 ? 'configurado' : 'configurados'}${IMP.dropped.length ? ` · <span title="${esc(IMP.dropped.slice(0, 40).map(i => i.title + ' — ' + i.why).join('\n'))}" style="color:var(--amber)">${IMP.dropped.length} ${IMP.dropped.length === 1 ? 'ficou' : 'ficaram'} de fora (lista no final)</span>` : ''}</span><span style="flex:1"></span><input class="mi" id="impQ" placeholder="Filtrar…" style="width:150px;height:30px;margin:0" oninput="impFilter(this.value)"><select class="mi" style="width:auto;height:30px;margin:0" onchange="impSort(this.value)" title="Ordem da lista"><option value="az">A–Z</option><option value="play">Mais jogados</option><option value="new">Novos primeiro</option></select><button class="btn s sm" onclick="document.querySelectorAll('.impg input').forEach(c=>c.checked=true);impCount()">Marcar todos</button><button class="btn s sm" onclick="document.querySelectorAll('.impg input').forEach(c=>c.checked=!c.closest('.impg').classList.contains('dup'));impCount()" title="Marca só o que ainda não está na biblioteca">Só novos</button><button class="btn s sm" onclick="document.querySelectorAll('.impg input').forEach(c=>c.checked=!c.checked);impCount()" title="Troca marcados por desmarcados">Inverter</button><button class="btn s sm" onclick="document.querySelectorAll('.impg input').forEach(c=>c.checked=false);impCount()">Desmarcar</button></div><div class="impgames" onchange="impCount()">${r.games.map(row).join('')}</div>`;
  setTimeout(impCount, 30);
  modal({ title: `Importar do ${IMP.cur.name}`, html, ok: 'Importar selecionados', extra: '← Voltar', onExtra: () => importPick(id), wide: true, onOk: async () => {
    const sel = [...document.querySelectorAll('.impg input:checked')].map(c => IMP.games[+c.dataset.i]);
    if (!sel.length) { toast('warn', 'Nada marcado', 'Marque ao menos um item para importar.'); return false; }
    if (!sel.length) return false;
    let a = await api.post('/api/import/apply', { games: sel });
    if (a.async) {
      modal({ title: `Importando ${sel.length} ${sel.length === 1 ? 'item' : 'itens'}…`, html: `<div class="prog"><div class="h"><b><i></i>Adicionando</b><span id="impMsg">Preparando…</span></div><div class="track"><i style="width:40%;animation:indet 1.2s linear infinite"></i></div></div><p style="color:var(--muted);font-size:12.5px;margin:10px 0 0">As capas do Playnite entram agora; descrição, ano e gêneros chegam em segundo plano nos próximos minutos.</p>`, noOk: true, noCancel: true });
      while (true) { await new Promise(res => setTimeout(res, 400)); a = await api.get('/api/import/poll'); if (a.done) break; const m = $('#impMsg'); if (m) m.textContent = a.msg || '…'; }
      $('#modal').classList.remove('on');
    }
    if (a.error) return toast('err', 'Importar', a.error);
    if ((IMP.dropped || []).length) { a.skipped_items = [...(a.skipped_items || []), ...IMP.dropped]; a.skipped = (a.skipped || 0) + IMP.dropped.length; }
    if (a.skipped && (a.skipped_items || []).length) importSummary(a); else toast('ok', 'Importação concluída', `${pl(a.added, 'adicionado', 'adicionados')}${a.skipped ? ' · ' + pl(a.skipped, 'ignorado', 'ignorados') : ''}`, [{ label: 'Ver adicionados', fn: () => flagOnly('added') }, { label: 'OK', fn: () => {} }]);
    TH.err.clear(); TH.tries = {}; S.home = null;
    S.view = ''; setView('home'); await loadCatalog(false);
  } });
}
function baseChrome() {
  const rail = $('#rail'); if (!rail || $('#railBot')) return;
  const bot = document.createElement('div'); bot.className = 'rbot'; bot.id = 'railBot';
  for (const el of [$('#helpBtn'), $('#bell')]) if (el) bot.appendChild(el);
  const st = rail.querySelector('.rb[data-view="settings"]');
  if (st) { st.before(bot); bot.appendChild(st); } else rail.appendChild(bot);
}
baseChrome();
