'use strict';
const $ = s => document.querySelector(s);
const TOKEN = document.querySelector('meta[name=ludrix-token]')?.content || '';
const api = (() => {
  const listeners = {};
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
    post: (u, b, opt = {}) => req(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}), ...opt }, opt.quiet),
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
      'gamemode.run': () => A.post('/api/gamemode/run', {}),
      'gamemode.restore': () => A.post('/api/gamemode/restore', {}),
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
const OSN = () => S.config.os === 'windows' ? 'Windows' : S.config.os === 'mac' ? 'macOS' : 'Linux';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = s => encodeURIComponent(s);
const fmtTime = sec => { sec = Math.floor(sec || 0); if (sec < 60) return '0 min'; const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60); return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`; };
const ago = ts => { if (!ts) return ''; const d = (Date.now() / 1000 - ts); if (d < 3600) return 'há ' + Math.max(1, Math.floor(d / 60)) + ' min'; if (d < 86400) return 'há ' + Math.floor(d / 3600) + ' h'; if (d < 172800) return 'ontem'; return 'há ' + Math.floor(d / 86400) + ' dias'; };

const S = { sel: new Set(), games: [], byKey: {}, cats: [], repos: [], systems: {}, config: {}, view: 'home', cat: 'all', q: '', stageKey: '', sort: 'az', flt: { cats: new Set(), sys: new Set(), flags: new Set(), repos: new Set(), src: new Set(), genres: new Set(), devs: new Set(), years: new Set(), lastp: new Set(), added: new Set(), ptime: new Set(), size: new Set() }, _fopen: {}, _fq: {}, _fall: {}, home: null, tab: { store: 'games', mods: 'tools', emulation: 'emulators', central: 'overview' }, mods: null,
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
  magnet: '<svg viewBox="0 0 24 24"><path d="M4 13v-8a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v8a2 2 0 0 0 6 0v-8a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v8a8 8 0 0 1 -16 0" /><path d="M4 8l5 0" /><path d="M15 8l4 0" /></svg>',
  chip: '<svg viewBox="0 0 24 24"><path d="M5 6a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1l0 -12" /><path d="M8 10v-2h2m6 6v2h-2m-4 0h-2v-2m8 -4v-2h-2" /><path d="M3 10h2" /><path d="M3 14h2" /><path d="M10 3v2" /><path d="M14 3v2" /><path d="M21 10h-2" /><path d="M21 14h-2" /><path d="M14 21v-2" /><path d="M10 21v-2" /></svg>',
  gamepad: '<svg viewBox="0 0 24 24"><path d="M12 5h3.5a5 5 0 0 1 0 10h-5.5l-4.015 4.227a2.3 2.3 0 0 1 -3.923 -2.035l1.634 -8.173a5 5 0 0 1 4.904 -4.019h3.4" /><path d="M14 15l4.07 4.284a2.3 2.3 0 0 0 3.925 -2.023l-1.6 -8.232" /><path d="M8 9v2" /><path d="M7 10h2" /><path d="M14 10h2" /></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" /></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6l-12 12" /><path d="M6 6l12 12" /></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5l10 -10" /></svg>',
  info: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /><path d="M12 9h.01" /><path d="M11 12h1v4h1" /></svg>',
  cal: '<svg viewBox="0 0 24 24"><path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12" /><path d="M16 3v4" /><path d="M8 3v4" /><path d="M4 11h16" /><path d="M11 15h1" /><path d="M12 15v3" /></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11" /></svg>',
  layout: '<svg viewBox="0 0 24 24"><path d="M4 6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v1a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2l0 -1" /><path d="M4 15a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2l0 -3" /><path d="M14 6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2l0 -3" /><path d="M14 17a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v1a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2l0 -1" /></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6l11 0" /><path d="M9 12l11 0" /><path d="M9 18l11 0" /><path d="M5 6l0 .01" /><path d="M5 12l0 .01" /><path d="M5 18l0 .01" /></svg>',
  grid: '<svg viewBox="0 0 24 24"><path d="M4 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4" /><path d="M14 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4" /><path d="M4 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4" /><path d="M14 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4" /></svg>',
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
  document.body.classList.toggle('face', !isFile);
  if (face) document.body.dataset.face = face; else delete document.body.dataset.face;
  if (!isFile || fm) document.documentElement.dataset.light = (isFile ? fm : t) === 'light' ? '1' : '0';
  if (face) setLayout(faceInfo(face).layout || '');
  if (tid === currentTheme) { applyChrome(); return; }
  currentTheme = tid;
  const old = $('#themeLink'); const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = '/api/theme/' + enc(tid.split('|')[0]) + (fm ? '?s=' + fm : ''); link.id = 'themeLink';
  link.onload = () => { old.remove(); applyAccent(); };
  old.id = 'themeLinkOld'; old.after(link);
  if (isFile) api.get('/api/theme/' + enc(t) + '/json').then(j => { if (currentTheme !== tid) return; themeAccent = (j && j.accent) || ''; if (!fm) document.documentElement.dataset.light = j && j.scheme === 'light' ? '1' : '0'; S.themeFx = (j && j.fx) || null; S.themeIcons = (j && j.icons) || ''; S.themeMenu = (j && j.menu) || ''; S.themeSearch = (j && j.search) || ''; S.themeNavLabels = !!(j && j.nav_labels); S.themeId = t; if (j && j.pointer) document.body.dataset.ptr = '1'; else delete document.body.dataset.ptr; S.themePlx = j && j.parallax ? (typeof j.parallax === 'number' ? Math.max(.2, Math.min(3, j.parallax)) : 1) : 0; setLayout((j && j.layout) || ''); applyTheme(); applyChrome(); applyAnim(); applyRailIcons(); });
  else { S.themeFx = null; S.themeId = ''; delete document.body.dataset.ptr; S.themePlx = 0; applyPlx(); if (S.themeIcons) { S.themeIcons = ''; applyRailIcons(); } if (S.themeMenu) { S.themeMenu = ''; } if (S.themeSearch || S.themeNavLabels) { S.themeSearch = ''; S.themeNavLabels = false; applyChrome(); } }
}
let themeLayout = '', themeAccent = '';
const LAYOUTS = [['', 'Seguir o tema', 'padrão'], ['rail', 'Ícones à esquerda', 'barra fina'], ['side', 'Lateral', 'menu à esquerda, com nomes'], ['top', 'No topo', 'abas'], ['bottom', 'Embaixo', 'ícones, barra colada']];
const LAYOUT_BASE = { top: 'side', side: 'side', dock: 'bottom', taskbar: 'bottom', rail: 'side', bottom: 'bottom' };
const LAYOUT_ALIAS = { taskbar: 'bottom', dock: 'bottom' };
function normLayout(l) { return LAYOUT_ALIAS[l] || l || ''; }
const BASE_ONLY = { rail: 'side', bottom: 'bottom' };
function setLayout(l) { if (l === themeLayout && document.body.dataset.layout === effLayout()) return; themeLayout = l; applyChrome(); }
function effLayout() { const u = normLayout(S.config.layout); if (u) return (u === 'bottom' || u === 'rail') ? '' : u; const l = normLayout(themeLayout); if (l) return BASE_ONLY[l] ? '' : l; return ''; }
function effNav() { const u = normLayout(S.config.layout); if (u === 'bottom' || u === 'side' || u === 'rail') return u === 'rail' ? 'side' : u; const l = u || normLayout(themeLayout); if (l) return LAYOUT_BASE[l] || 'side'; const n = S.config.nav || 'bottom'; return n === 'side' ? 'side' : 'bottom'; }
mq.addEventListener('change', () => { if ((S.config.theme || 'system') === 'system' || S.config.theme_mode === 'system') applyTheme(); });
function inLightWindow() {
  const [f, t] = [S.config.theme_light_from || '07:00', S.config.theme_light_to || '19:00'].map(x => { const [h, m] = String(x).split(':').map(Number); return (h || 0) * 60 + (m || 0); });
  const d = new Date(), n = d.getHours() * 60 + d.getMinutes();
  return f <= t ? (n >= f && n < t) : (n >= f || n < t);
}
setInterval(() => { if (S.config.theme_schedule && (S.config.theme || 'system') === 'system' && (inLightWindow() ? 'light' : 'dark') !== S._schedLast) applyTheme(); }, 30000);
function applyAccent() {
  const acc = S.dynAccent || S.config.accent || themeAccent || '';
  const st = document.documentElement.style; document.documentElement.classList.toggle('mono', !acc);
  applyFrame();
  if (!acc) { st.removeProperty('--accent'); st.removeProperty('--accent2'); st.removeProperty('--on-accent'); scheduleContrast(); return; }
  const rgb = hexRgb(acc); if (!rgb) return;
  st.setProperty('--accent', acc);
  st.setProperty('--on-accent', luma(rgb) > .55 ? '#111' : '#fff');
  const bg = hexRgb(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  const lightBg = bg ? luma(bg) > .5 : currentTheme === 'light';
  st.setProperty('--accent2', lightBg ? shade(rgb, -55) : shade(rgb, 45));
  scheduleContrast();
}
let frameT = 0, frameLast = '';
function applyFrame() {
  if (!S.config.native || S.config.os !== 'windows') return;
  clearTimeout(frameT);
  frameT = setTimeout(() => {
    const bg = cssVar('--bg'), text = cssVar('--text'), dark = document.documentElement.dataset.light !== '1', rgb = hexRgb(bg);
    const border = rgb ? rgbToHex(shade(rgb, dark ? 30 : -30)) : bg;
    const body = { cmd: 'frame', mode: S.config.frame_mode || 'theme', corners: S.config.frame_corners || '', bg, text, border, dark };
    const sig = JSON.stringify(body); if (sig === frameLast) return; frameLast = sig;
    api.post('/api/window', body);
  }, 300);
}
const CONTRAST_SEL = '.btn.p,.chip.on,.sw.on,.tag,.tabs button.on,.seg button.on,.pbtns button.on,.rb.on,.badge,.pill.on,.kbd.on';
function cssRgb(v) { const m = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+))?\)/.exec(v || ''); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; }
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
  const wait = Math.max(0, 900 - (performance.now() - SPLASH_T0), SPL.q.length * 170 + 220);
  setTimeout(() => { const last = $('#slog') && $('#slog').lastElementChild; if (last) last.classList.add('ok'); el.classList.add('off'); setTimeout(() => el.remove(), 550); }, wait);
}
splashStep('carregando interface', 18);
setTimeout(splashOff, 6000);
async function winCmd(cmd) { const r = await api.post('/api/window', { cmd }); if (r && r.max !== undefined) document.body.classList.toggle('maxed', !!r.max); }
const TOOLBAR_ITEMS = [['search', 'Campo de busca', 'pesquisa em tudo (atalho: /)'], ['cats', 'Categoria', 'lista suspensa com as categorias'], ['sort', 'Ordenação', 'A–Z, ano, tamanho, recentes'], ['bell', 'Notificações', 'histórico de avisos']];
function applyToolbar() {
  const items = new Set(S.config.toolbar_items || ['search', 'cats', 'sort', 'bell']);
  document.body.classList.remove('no-toolbar');
  for (const [id] of TOOLBAR_ITEMS) document.body.classList.toggle('tb-no-' + id, !items.has(id));
}
const NAV_ITEMS = [['home', 'Biblioteca', 'main'], ['store', 'Store', 'main'], ['emulation', 'Emuladores', 'main'], ['mods', 'Mods', 'tools'], ['central', 'Central', 'tools'], ['flash', 'Rápidos', 'tools'], ['downloads', 'Fila', 'sys']];
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
function applyChrome() {
  document.body.classList.toggle('frameless', !!S.config.frameless);
  applyToolbar(); applyRailIcons(); applyNavItems(); applyMotion(); applyClock();
  document.body.dataset.status = S.config.status_position === 'top' ? 'top' : 'bottom';
  const L = effLayout(); if (L) document.body.dataset.layout = L; else delete document.body.dataset.layout;
  document.body.dataset.nav = effNav();
  const qb = $('#qbox'), sp = S.themeSearch === 'titlebar' && !!S.config.frameless ? 'titlebar' : S.themeSearch === 'rail' ? 'rail' : 'top'; if (qb) { const host = sp === 'titlebar' ? $('#titlebar') : sp === 'rail' ? $('#rail') : $('#brandBtn').parentElement; if (qb.parentElement !== host) { if (sp === 'titlebar') $('#tbStatus').after(qb); else if (sp === 'rail') $('#rail .brand').after(qb); else $('#brandBtn').after(qb); } document.body.dataset.search = sp; } if (S.themeNavLabels) document.body.dataset.navLabels = '1'; else delete document.body.dataset.navLabels; const tv = $('#tbVer'); if (tv) tv.textContent = S.config.version || '';
  const b = $('#brand'); if (b && !b.innerHTML) b.innerHTML = logoSvg(); const t = $('#tbBrand'); if (t && !t.innerHTML) { t.innerHTML = logoSvg(); t.onclick = e => { e.stopPropagation(); const r = t.getBoundingClientRect(); if ($('#ctx').classList.contains('on')) return closeCtx(); appMenu(r.left, r.bottom + 6); }; } const hb = $('#brandBtn'); if (hb && !hb.innerHTML) { hb.innerHTML = logoSvg() + '<svg class="car" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>'; hb.onclick = e => { e.stopPropagation(); const r = hb.getBoundingClientRect(); if ($('#ctx').classList.contains('on')) return closeCtx(); appMenu(r.left, r.bottom + 6); }; }
  if (b) { b.onclick = e => { e.stopPropagation(); const r = b.getBoundingClientRect(); if ($('#ctx').classList.contains('on')) return closeCtx(); appMenu(r.right + 6, r.top); }; b.style.cursor = 'pointer'; b.title = 'Menu do Ludrix'; }
}
document.querySelectorAll('.rz').forEach(el => el.addEventListener('mousedown', e => { if (e.button !== 0) return; e.preventDefault(); api.post('/api/window', { cmd: 'resize', dir: el.dataset.rz }); }));
$('#titlebar').addEventListener('dblclick', e => { if (!e.target.closest('button')) winCmd('maximize'); });
let ONLINE = true;
window.addEventListener('online', () => setOnline(true)); window.addEventListener('offline', () => setOnline(false));
function setOnline(v) { if (v === ONLINE) return; ONLINE = v; document.body.classList.toggle('offline', !v); if (S.view === 'store') renderView(); if (!v) toast('', 'Sem internet', 'Baixar jogos, capas e emuladores fica indisponível até reconectar.'); }

function appMenu(x, y) {
  const go = (v, tab) => () => { setView(v); if (tab) { S.tab[v] = tab; renderView(); } };
  const set = (tab) => () => { setView('settings'); S.tab.settings = tab; renderSettings(true); };
  const items = [
    { label: 'Biblioteca', icon: 'home', sub: [
      { label: 'Biblioteca', icon: 'home', fn: go('home') }, { label: 'Adicionar jogo instalado…', icon: 'plus', fn: addLocal }, { label: 'Baixar de link…', icon: 'dl', fn: linkDownload }, { label: 'Escanear pastas…', icon: 'search', fn: scanWizard }, { label: 'Importar de outro launcher…', icon: 'import', fn: importWizard },
      { label: 'Me surpreenda', icon: 'spark', fn: () => surprise() }, { sep: true }, { label: 'Atualizar tudo (metadados/capas)', icon: 'refresh', fn: () => api.post('/api/metadata/refetch_all', {}).then(() => toast('ok', 'Atualizando', 'metadados e capas em segundo plano')) }] },
    { label: 'Store', icon: 'dl', sub: [
      { label: 'Baixar novos games', icon: 'dl', fn: go('store', 'games') }, { label: 'Fontes de jogos…', icon: 'cog', fn: go('store', 'sources') }, { label: 'Atualizar catálogo', icon: 'refresh', fn: () => loadCatalog(true) }, { label: 'Fila de downloads', icon: 'dl', fn: go('downloads') }] },
    { label: 'Emuladores', icon: 'gamepad', sub: [
      { label: 'Emuladores e consoles', icon: 'gamepad', fn: go('emulation') }, { label: 'Meu próprio emulador…', icon: 'plus', fn: () => addCustomEmu() }, { label: 'Pasta emulation\\games', icon: 'folder', fn: () => api.post('/api/open', { path: S.emu?.games_root || 'emulation/games' }) }, { label: 'Pasta de BIOS', icon: 'folder', fn: () => api.post('/api/open', { path: S.emu?.bios_dir || 'emulation/bios' }) }] },
    { label: 'Ferramentas', icon: 'wrench', sub: [
      { label: 'Mods e ferramentas', icon: 'wrench', fn: go('mods') }, { label: 'Central Ludrix', icon: 'chip', fn: go('central') }, { label: 'Otimizar agora', icon: 'bolt', fn: gamemodeRun }, { label: 'Jogos Rápidos', icon: 'play', fn: go('flash') }] },
    { label: 'Aparência', icon: 'image', sub: [
      { label: 'Aparência e temas…', icon: 'image', fn: set('appearance') },
      { label: 'Layout da barra', icon: 'layout', sub: LAYOUTS.map(([v, l, h]) => ({ label: l, hint: (S.config.layout || '') === v ? '✓' : h, fn: () => setCfg({ layout: v }) })) },
      ...(S.config.os === 'windows' ? [{ label: S.config.frameless ? 'Usar moldura do Windows' : 'Janela sem moldura', icon: 'win', fn: () => setCfg({ frameless: !S.config.frameless }) }] : []), { sep: true },
      { label: 'Abrir o Modo Console', icon: 'gamepad', hint: 'fecha esta janela', fn: () => openConsole() }] },
    { label: 'Pastas', icon: 'folder', sub: [
      { label: 'Pasta do launcher', icon: 'folder', fn: () => api.post('/api/open', { path: S.config.root || '.' }) }, { label: 'games' + SEP() + ' (jogos instalados)', icon: 'folder', fn: () => api.post('/api/open', { path: S.config.games_dir || 'games' }) },
      { label: 'downloads\\', icon: 'folder', fn: () => api.post('/api/open', { path: 'downloads' }) }, { label: 'themes\\', icon: 'folder', fn: () => api.post('/api/open', { path: 'themes' }) }, { label: 'data\\ (config, biblioteca, fontes)', icon: 'folder', fn: () => api.post('/api/open', { path: 'data' }) }, { label: 'Log (ludrix.log)', icon: 'doc', fn: () => api.post('/api/open', { path: 'data/ludrix.log' }) }] },
    { sep: true },
    { label: 'Ajustes', icon: 'cog', fn: set('general') },
    { label: 'Sobre o Ludrix', icon: 'info', fn: () => { S._settingsJump = 'Sobre'; set('system')(); } },
  ];
  if (S.config.native) items.push({ sep: true }, { label: 'Esconder na bandeja', icon: 'tray', fn: () => winCmd('hide') }, { label: 'Sair do launcher', icon: 'power', danger: true, fn: () => winCmd('quit') });
  showCtx(items, x, y);
}
function viewMenu(view, x, y) {
  const m = {
    home: [{ label: 'Adicionar jogo instalado…', icon: 'plus', fn: addLocal }, { label: 'Selecionar todos da página', icon: 'check', fn: msAll }, { label: 'Baixar de link…', icon: 'dl', fn: linkDownload }, { label: 'Escanear pastas…', icon: 'search', fn: scanWizard }, { label: 'Importar de outro launcher…', icon: 'import', fn: importWizard }, { sep: true }, { label: 'Tamanho das capas…', icon: 'image', fn: () => { setView('settings'); S.tab.settings = 'appearance'; renderSettings(); } }],
    store: [{ label: 'Fontes de jogos…', icon: 'cog', fn: () => { S.tab.store = 'sources'; renderView(); } }, { label: 'Atualizar catálogo', icon: 'refresh', fn: () => loadCatalog(true) }],
    emulation: [{ label: 'Meu próprio emulador…', icon: 'plus', fn: () => addCustomEmu() }, { label: 'Pasta de BIOS', icon: 'folder', fn: () => api.post('/api/open', { path: S.emu?.bios_dir }) }],
    flash: [{ label: 'Adicionar jogo rápido…', icon: 'plus', fn: () => setTimeout(() => addFlashMenu({ clientX: x, clientY: y }), 30) }, { label: 'Baixar mais', icon: 'dl', fn: () => { S.tab.flash = 'more'; S.flashF = 'all'; renderFlash(); } }],
    downloads: [{ label: 'Baixar de link…', icon: 'dl', fn: linkDownload }, { label: 'Abrir pasta downloads', icon: 'folder', fn: () => api.post('/api/open', { path: 'downloads' }) }],
    central: [{ label: 'Otimizar agora', icon: 'bolt', fn: gamemodeRun }, { label: 'Abrir pasta redists', icon: 'folder', fn: () => api.post('/api/redist/open', {}) }, { label: 'Re-checar instalados', icon: 'refresh', fn: () => { S.opt = null; renderCentral(); } }],
    settings: [{ label: 'Abrir pasta data', icon: 'folder', fn: () => api.post('/api/open', { path: 'data' }) }, { label: 'Abrir log', icon: 'ext', fn: () => api.post('/api/open', { path: 'data/ludrix.log' }) }],
  }[view] || [];
  const base = [{ label: 'Atualizar esta tela', icon: 'refresh', fn: renderView }];
  showCtx(m.length ? [...m, { sep: true }, ...base] : base, x, y);
}
function sysMenu(sid, x, y) {
  const s = S.emu?.systems[sid]; if (!s) return;
  const items = [
    { label: 'Abrir pasta de ROMs', icon: 'folder', fn: () => api.post('/api/open', { path: s.games_dir }) },
    { label: '+ Pasta de ROMs…', icon: 'plus', fn: () => addRomDir(sid) },
    { label: 'Emuladores deste console…', icon: 'cog', fn: () => sysEmus(sid) },
  ];
  if (s.installed) items.push({ label: `Abrir ${s.emulator_title}`, icon: 'play', fn: () => api.post('/api/emulator/open', { id: s.emulator }) });
  else items.push({ label: `Instalar ${s.emulator_title}`, icon: 'dl', fn: () => installEmu(s.emulator) });
  showCtx(items, x, y);
}
function repoMenu(id, x, y) {
  const r = (S.repos || []).find(z => z.id === id) || {};
  showCtx([
    { label: r.enabled ? 'Desligar fonte' : 'Ligar fonte', icon: 'power', fn: () => api.post('/api/repos/toggle', { id, enabled: !r.enabled }).then(() => { renderSources(); loadCatalog(false); }) },
    { label: 'Atualizar', icon: 'refresh', fn: () => loadCatalog(true) },
    ...(r.builtin ? [] : [{ sep: true }, { label: 'Editar…', icon: 'edit', fn: () => editRepo(id) }, { label: 'Remover', icon: 'trash', danger: true, fn: () => removeRepo(id, r.name) }]),
  ], x, y);
}

const L = { on: false, dict: {}, rx: [] };
async function initLang(lang) {
  if (!lang || lang === 'pt-BR' || L.on) return;
  try { const d = await (await fetch('/ui/lang/' + lang + '.json')).json(); L.dict = d.strings || {}; L.rx = (d.patterns || []).map(([a, b]) => [new RegExp(a, 'g'), b]); } catch (e) { return; }
  L.on = true; document.documentElement.lang = lang;
  const tr = t => {
    const k = t.trim(); if (!k || !/[a-zA-ZÀ-ú]/.test(k)) return t;
    let v = L.dict[k]; if (v === undefined) { v = k; for (const [r, b] of L.rx) v = v.replace(r, b); }
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
function hydrate(g) { const fr = franchiseOf(g); g.fr = fr; g._q = qnorm([g.title, g.creator || '', fr || '', (g.genres || []).join(' '), (S.systems && S.systems[g.system]) || g.system || '', g.year || '', SRC_NAMES[g.source] || g.source || '', g.store_src || '', g.kind === 'rom' ? 'rom emulado' : ''].join('\n')); return g; }
function setGames(list) {
  S.games = list.map(hydrate); S.byKey = Object.fromEntries(S.games.map(g => [g.key, g]));
  S._sorted = null; S._poolKey = '';
}
async function loadCatalog(refresh) {
  if (!S.loaded && !S._splCfg) { S._splCfg = 1; splashStep('lendo configurações', 36); }
  const d = await api.get('/api/catalog' + (refresh ? '?refresh=1' : ''));
  S.config = d.config || S.config;
  if (!S.loaded) { const v = $('#spv'); if (v && S.config.version) v.textContent = 'v' + S.config.version; if (d.loading) { if (!S._splScan) { S._splScan = 1; splashStep('procurando jogos', 58); } } else splashStep('biblioteca · ' + pl((d.games || []).filter(g => g.installed).length, 'jogo', 'jogos'), 72); } S.torrent = !!d.torrent_available; S.torrentEngine = d.torrent_engine || ''; S.systems = d.systems || {};
  await initLang(S.config.language);
  document.documentElement.style.setProperty('--card', (S.config.card_size || 136) + 'px'); applyScale();
  S.cats = d.categories || []; S.repos = d.repos || []; S.faces = d.faces || S.faces || [];
  if (d.custom) S.custom = d.custom;
  applyTheme(); applyAnim(); applyChrome();
  if (!S.loaded && !d.loading) splashStep('aplicando tema', 88);
  if (d.online !== undefined) setOnline(!!d.online);
  S.sessions = d.sessions || {}; gpIndicator(d.gamepad);
  setGames(d.games || []);
  S.games.forEach(g => { if (g.job && !S.jobs[g.key]) S.jobs[g.key] = { stage: 'download', fraction: 0, detail: '' }; });
  if (d.loading) { renderView(); setTimeout(() => loadCatalog(false), 900); return; }
  if (d.roms_pending && !S._romPoll) { S._romPoll = setTimeout(() => { S._romPoll = 0; loadCatalog(false); }, 1500); }
  if (!S._sortInit) { S._sortInit = true; if (S.config.sort_by && SORTS.some(x => x[0] === S.config.sort_by)) { S.sort = S.config.sort_by; renderSortBtn(); } }
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
  if (v === 'redists' || v === 'gamemode') { S.tab.central = v === 'redists' ? 'redists' : 'optimize'; v = 'central'; }
  if (v === 'central' && S.config.welcome_done && !(S.config.start_done || []).includes('central')) startGo('central');
  if (v === S.view && !S.current && !$('#modal').classList.contains('on')) { $('#view').scrollTop = 0; return; }
  if (S._metaDirty && ['home', 'store'].includes(v)) { S._metaDirty = false; api.get('/api/catalog').then(d => { if (d && !d.loading) { setGames(d.games || []); if (['home', 'store'].includes(S.view)) renderLibrary(); if (S.view === 'home') refreshHome(); } }); }
  S.page = 1;
  if (v !== 'home') gameFocus(null);
  S.view = v; closeDetail();
  document.querySelectorAll('.rb').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $('#view').scrollTop = 0; S._enter = true; guideDismiss(); renderView();
}
function enterFx() { const v = $('#view'); if (S._enter) { S._enter = false; v.classList.add('enter'); clearTimeout(S._enterT); S._enterT = setTimeout(() => v.classList.remove('enter'), 700); } }
let tsvMemo = null;
function topSearchVisible() { if (tsvMemo !== null) return tsvMemo; const el = document.querySelector('.top .search, .titlebar .search'); let v = false; if (el && el.offsetParent !== null) { const r = el.getBoundingClientRect(); v = r.width > 40 && r.height > 0; } tsvMemo = v; requestAnimationFrame(() => { tsvMemo = null; }); return v; }
function renderView() {
  closeCtx(); enterFx();
  const grid = ['home', 'store'].includes(S.view) && !(S.view === 'store' && S.tab.store === 'sources');
  $('.top').style.display = ''; $('#chips').style.display = grid ? '' : 'none'; $('#sort').style.display = grid ? '' : 'none';
  if (grid) renderSortBtn(); applyQPlaceholder();
  $('#helppop').classList.remove('on');
  if (S.view === 'home') renderLibrary();
  else if (S.view === 'store') { if (S.tab.store === 'sources') renderSources(); else { renderLibrary(); guide('store'); } }
  else if (S.view === 'mods') renderMods();
  else if (S.view === 'emulation') renderEmulation().then(() => guide('emulation'));
  else if (S.view === 'downloads') renderDownloads().then(() => guide('downloads'));
  else if (S.view === 'flash') renderFlash();
  else if (S.view === 'central') renderCentral();
  else if (S.view === 'settings') renderSettings(true).then(() => guide('settings'));
}

const isRepoRom = g => g.kind === 'rom' && g.repo !== 'local' && !g.key.startsWith('rom:');
const inStore = g => g.repo !== 'local' && !isRepoRom(g) && !(g.installed && !S.jobs[g.key] && S.config.store_hide_installed !== false);
const inEmu = g => isRepoRom(g) && (!g.installed || S.jobs[g.key]) && (!S.emuSys || g.system === S.emuSys);
const inView = g => (g.hidden && !S.flt.flags.has('hidden') && !(S.q && S.view === 'home')) ? false : S.view === 'home' ? (g.installed || FLAG_TEST.broken(g)) : S.view === 'store' ? inStore(g) : S.view === 'emulation' ? inEmu(g) : true;
const COLL = new Intl.Collator('pt', { sensitivity: 'base', numeric: true });
function sortedAZ() {
  if (!S._sorted) { S._sorted = [...S.games].sort((a, b) => COLL.compare(a.title, b.title)); S._sorted.forEach((g, i) => g._az = i); }
  return S._sorted;
}
function qPrefix(g, k, v) {
  if (k === 'dev') return qnorm(g.creator || '').includes(v);
  if (k === 'ano') return String(g.year || '') === v || (v.endsWith('s') && String(g.year || '').startsWith(v.slice(0, 3)));
  if (k === 'gen') return (g.genres || []).some(x => qnorm(x).includes(v)) || (g.cats || []).some(x => qnorm(x).includes(v));
  if (k === 'sis') return qnorm((S.systems && S.systems[g.system]) || g.system || 'pc').includes(v) || qnorm(g.system || 'pc').includes(v);
  return qnorm(originOf(g) + ' ' + (g.store_src || '') + ' ' + (SRC_NAMES[g.source] || g.source || '')).includes(v);
}
function visible() {
  const q = qnorm(S.q), qw0 = q ? q.split(' ') : [], f = S.flt, cat = S.cat, flags = [...f.flags].map(k => FLAG_TEST[k]);
  const qp = [], qw = [];
  for (const w of qw0) { const m = w.match(/^(dev|ano|gen|sis|origem|src):(.+)$/); if (m) qp.push([m[1], m[2]]); else qw.push(w); }
  const hasCats = f.cats.size > 0, hasSys = f.sys.size > 0, hasRepos = S.view === 'store' && f.repos.size > 0, hasSrc = f.src.size > 0;
  let list = sortedAZ().filter(g => {
    if (!inView(g)) return false;
    if (qw.length && !qw.every(w => g._q.includes(w))) return false;
    if (qp.length && !qp.every(([k, v]) => qPrefix(g, k, v))) return false;
    if (hasSrc && !f.src.has(originOf(g))) return false;
    if (cat !== 'all' && !(g.cats || []).includes(cat)) return false;
    if (hasCats && !(g.cats || []).some(c => f.cats.has(c))) return false;
    if (hasSys && !f.sys.has(g.system || 'pc')) return false;
    if (hasRepos && !f.repos.has(g.repo)) return false;
    if (f.genres.size && !(g.genres || []).some(x => f.genres.has(x))) return false;
    if (f.devs.size && !f.devs.has(g.creator || '')) return false;
    if (f.years.size && !f.years.has(String(g.year || ''))) return false;
    for (const k of BUCKET_KINDS) if (f[k].size && !f[k].has(bucketOf[k](g))) return false;
    for (const t of flags) if (!t(g)) return false;
    return true;
  });
  if (S.view === 'home' && !filtersActive() && !S.q && S.sort === 'az' && !S.sortRev) { const ho = homeOrder(list); return S.config.fav_first ? ho.filter(g => g.fav).concat(ho.filter(g => !g.fav)) : ho; }
  const az = (a, b) => a._az - b._az;
  if (S.sort === 'recent') list.sort((a, b) => (b.last_played || 0) - (a.last_played || 0) || (b.added_at || 0) - (a.added_at || 0) || az(a, b));
  else if (S.sort === 'most') list.sort((a, b) => (b.playtime || 0) - (a.playtime || 0) || az(a, b));
  else if (S.sort === 'added') list.sort((a, b) => (b.added_at || 0) - (a.added_at || 0) || az(a, b));
  else if (S.sort === 'year') list.sort((a, b) => (+b.year || 0) - (+a.year || 0) || az(a, b));
  else if (S.sort === 'size') list.sort((a, b) => (b.size || 0) - (a.size || 0) || az(a, b));
  else if (S.sort === 'dev') list.sort((a, b) => COLL.compare(a.creator || a.fr || '\uffff', b.creator || b.fr || '\uffff') || az(a, b));
  else if (S.sort === 'count') list.sort((a, b) => (b.play_count || 0) - (a.play_count || 0) || (b.playtime || 0) - (a.playtime || 0) || az(a, b));
  if (S.sortRev) list.reverse();
  if (S.config.fav_first && S.view === 'home') { const f = list.filter(g => g.fav), o = list.filter(g => !g.fav); list = f.concat(o); }
  return list;
}
function poolStats() {
  const key = S.view + '|' + S.tab.store + '|' + (S.emuSys || '') + '|' + (S.config.store_hide_installed !== false) + '|' + Object.keys(S.jobs).length;
  if (S._poolKey === key && S._pool) return S._pool;
  const counts = {}, scount = {}, fcount = {}, rcount = {}, ocount = {}, gcount = {}, dcount = {}, ycount = {}, bcount = { lastp: {}, added: {}, ptime: {}, size: {} }; let n = 0;
  const flagIds = FLAGS.map(f => f[0]); for (const id of flagIds) fcount[id] = 0;
  const inc = (o, k) => { if (k) o[k] = (o[k] || 0) + 1; };
  for (const g of S.games) {
    if (!inView(g)) continue; n++;
    if (g.cats) for (const c of g.cats) counts[c] = (counts[c] || 0) + 1;
    const sy = g.system || 'pc'; scount[sy] = (scount[sy] || 0) + 1; if (g.repo) rcount[g.repo] = (rcount[g.repo] || 0) + 1; const og = originOf(g); if (og) ocount[og] = (ocount[og] || 0) + 1;
    if (g.genres) for (const x of g.genres) inc(gcount, x);
    inc(dcount, g.creator || ''); inc(ycount, String(g.year || ''));
    for (const k of BUCKET_KINDS) inc(bcount[k], bucketOf[k](g));
    for (const id of flagIds) if (FLAG_TEST[id](g)) fcount[id]++;
  }
  S._poolKey = key; return S._pool = { n, counts, scount, fcount, rcount, ocount, gcount, dcount, ycount, bcount };
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
function renderLibrary() {
  renderChips();
  S._multiSrc = S.view === 'store' && new Set(S.games.filter(inStore).map(g => g.repo)).size > 1;
  const list = visible();
  const fltNames = fltLabels().map(x => x[2]);
  const catName = S.cat !== 'all' ? (S.cats.find(c => c.id === S.cat) || {}).name : fltNames.length ? fltNames.slice(0, 3).join(' · ') + (fltNames.length > 3 ? ` +${fltNames.length - 3}` : '') : (S.view === 'home' ? (stageOn() ? 'Todos os jogos' : 'Minha biblioteca') : 'Disponíveis para baixar');
  let h = '';
  if (S.view === 'store') h += storeTabs();
  if (S.view === 'store' && !filtersActive() && !S.q && S.hero.length && S.config.hero_enabled !== false) h += heroHtml();
  if (S.view === 'home' && !filtersActive() && !S.q) h += homeTop();
  h += `<div class="h1${S.view === 'home' && !stageOn() ? ' big' : ''}"><h2>${esc(catName)}</h2><span>${list.length} ${list.length === 1 ? 'jogo' : 'jogos'}</span><span class="sp"></span>
        ${!topSearchVisible() ? `<div class="qmini ${S.q ? 'on' : ''}"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="qm" placeholder="Buscar…" value="${esc(S.q)}" autocomplete="off" spellcheck="false" oninput="miniSearch(this.value)" onfocus="this.parentElement.classList.add('on')" onblur="if(!this.value)this.parentElement.classList.remove('on')"><kbd>/</kbd></div>` : ''}
        ${['home', 'store'].includes(S.view) ? viewBtn() : ''}
        ${S.view === 'home' && !stageOn() ? `<button class="btn s xs" onclick="surprise()" title="Escolhe um jogo da sua biblioteca para você jogar agora">${I.spark} Me surpreenda</button>` : ''}${!(S.view === 'home' && !filtersActive() && !S.q && stageOn()) ? filterBtn() : ''}${S.view === 'home' ? `<button class="btn p xs addbtn" onclick="addGameMenu()">+ Adicionar jogo</button>` : `<button class="btn s xs" onclick="loadCatalog(true)">${I.refresh} Atualizar</button>`}</div>`;
  h += activeChips();
  const noSrc = S.view === 'store' && !S.repos.some(r => r.enabled && r.kind !== 'rom');
  if (!S.games.length && !noSrc && !(S.view === 'home' && S.loaded)) h += `<div class="grid">${Array.from({ length: 18 }, () => '<div class="card sk"><div class="cov"></div><h4>&nbsp;</h4></div>').join('')}</div>`;
  else if (!list.length && noSrc && !S.q && !filtersActive()) h += `${emptyHtml(I.magnet, S.repos.length ? 'Nenhuma fonte ligada' : 'Nenhuma fonte adicionada', `A Store mostra o que as suas fontes de jogos de PC oferecem${S.repos.some(r => r.enabled && r.kind === 'rom') ? ' — as fontes de ROM ficam na aba <b>Emuladores</b>' : ''}. ${S.repos.length ? 'Ligue uma em' : 'Adicione uma em'} <b>Fontes</b>: site de download, coleção do archive.org, GitHub ou lista .json.`, [['Abrir Fontes', "S.tab.store='sources';renderView()", 1], ['Adicionar jogo que já tenho', 'addLocal()']])}`;
  else if (!list.length) h += `${S.view === 'home' ? (S.q || filtersActive() ? emptyHtml(I.search, 'Nenhum jogo com esse filtro', /\b(dev|ano|gen|sis|origem|src):/.test(S.q) ? 'Prefixos aceitos: dev: (desenvolvedora), ano: (ano ou década, ex. 2010s), gen: (gênero), sis: (sistema), origem: (Steam, Epic, ROM…).' : 'Tente outro termo ou limpe os filtros.', [['Limpar busca e filtros', 'clearSearch();clearFlt()', 1]]) : emptyHtml(I.home, 'Sua biblioteca está vazia', 'Baixe algo na Store ou adicione um jogo que você já tem — um .exe, um atalho ou uma ROM.', [['Abrir Store', "setView('store')", 1], ['Adicionar jogo', 'addLocal()'], ['Importar de outro launcher', 'importWizard()']])) : emptyHtml(I.search, 'Nenhum resultado', 'Tente outro termo ou categoria.', [['Limpar busca e filtros', 'clearSearch();clearFlt()', 1]])}`;
  if (S.view === 'store' && list.length && q.length >= 3 && S.repos.some(r => r.enabled && /^site-/.test(r.id)) && !S._siteQ) h += `<div class="sitehint">Não achou? <button class="lnk" onclick="siteSearch()">Buscar "${esc(S.q.trim())}" direto nos sites ligados</button></div>`;
  else h += `<div class="grid${listMode() ? ' lst' : ''}" id="grid"></div><div class="pager" id="pager"></div>`;
  const pin = fpOn(), oldP = $('#fpanel'), pst = oldP ? oldP.scrollTop : 0;
  $('#view').innerHTML = pin ? `<div class="libwrap"><div class="libmain">${h}</div>${fpanelHtml()}</div>` : h;
  if (pin && pst) { const np = $('#fpanel'); if (np) np.scrollTop = pst; }
  if (list.length) { if (S.view === 'store') fillPaged(list); else fillGrid(list); }
  if (S.hero.length && $('#hero')) showHero(S.heroIdx);
  if (S.view === 'home' && S.config.cover_slideshow && !ssT && !(S._focusKey && S.config.game_backdrop)) slideshowStart();
}
let gridGen = 0, gridIO = null;
const GROUPS = [['', 'Sem grupos'], ['system', 'Plataforma'], ['category', 'Categoria'], ['letter', 'Letra'], ['played', 'Última vez jogada'], ['installed', 'Instalado ou não'], ['origin', 'Origem']];
const PLAYED_BUCKETS = ['Jogando hoje', 'Esta semana', 'Este mês', 'Há mais tempo', 'Nunca jogado'];
function groupKey(g, by) {
  if (by === 'system') return g.system && g.system !== 'pc' ? (S.systems[g.system] || g.system) : 'PC';
  if (by === 'category') { const c = (g.cats || [])[0]; return c ? ((S.cats.find(x => x.id === c) || {}).name || c) : 'Sem categoria'; }
  if (by === 'letter') { const ch = (g.title || '?').trim().charAt(0).toUpperCase(); return /[A-Z]/.test(ch) ? ch : /[0-9]/.test(ch) ? '0–9' : '#'; }
  if (by === 'played') { if (!g.last_played) return PLAYED_BUCKETS[4]; const d = (Date.now() / 1000 - g.last_played) / 86400; return d < 1 ? PLAYED_BUCKETS[0] : d < 7 ? PLAYED_BUCKETS[1] : d < 30 ? PLAYED_BUCKETS[2] : PLAYED_BUCKETS[3]; }
  if (by === 'installed') return g.installed ? 'Instalados' : 'Não instalados';
  if (by === 'origin') return originOf(g) || 'Outros';
  return '';
}
function groupSort(by, a, b) {
  if (by === 'played') return PLAYED_BUCKETS.indexOf(a) - PLAYED_BUCKETS.indexOf(b);
  if (by === 'installed') return a === 'Instalados' ? -1 : 1;
  if (by === 'system') return a === 'PC' ? -1 : b === 'PC' ? 1 : a.localeCompare(b, 'pt');
  if (by === 'category') return a === 'Sem categoria' ? 1 : b === 'Sem categoria' ? -1 : a.localeCompare(b, 'pt');
  return a.localeCompare(b, 'pt');
}
function groupedList(list) {
  const by = S.config.group_by || ''; if (!by || !['home', 'store'].includes(S.view)) return null;
  const m = new Map(); for (const g of list) { const k = groupKey(g, by); if (!m.has(k)) m.set(k, []); m.get(k).push(g); }
  return [...m.keys()].sort((a, b) => groupSort(by, a, b)).map(k => [k, m.get(k)]);
}
S._gcol = S._gcol || new Set((() => { try { return JSON.parse(localStorage.getItem('lx_gcol') || '[]'); } catch (_) { return []; } })());
function groupToggle(el) { const w = el.closest('.ggrp'); w.classList.toggle('col'); const k = w.dataset.g; if (w.classList.contains('col')) S._gcol.add(k); else S._gcol.delete(k); try { localStorage.setItem('lx_gcol', JSON.stringify([...S._gcol])); } catch (_) {} }
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
          grid.insertAdjacentHTML('beforeend', `<div class="ggrp${S._gcol.has(k) ? ' col' : ''}" data-g="${esc(k)}">${groupHead(k, gs.length, gs.reduce((a, g) => a + (g.playtime || 0), 0))}<div class="grid${listMode() ? ' lst' : ''}"></div></div>`);
          cur = grid.lastElementChild.lastElementChild;
        }
        pending += cardHtml(flat[j], j);
      }
      flush();
    }
    i += CH; return i < flat.length;
  };
  more();
  if (i >= list.length) return;
  const sent = document.createElement('div'); sent.className = 'more'; sent.innerHTML = `<span>mostrando ${i} de ${list.length}</span>`; grid.after(sent);
  gridIO = new IntersectionObserver(es => { if (!es.some(e => e.isIntersecting)) return; const has = more(); sent.querySelector('span').textContent = `mostrando ${Math.min(i, list.length)} de ${list.length}`; if (!has) { gridIO.disconnect(); gridIO = null; sent.remove(); } }, { root: $('#view'), rootMargin: '900px' });
  gridIO.observe(sent);
}
function fillPaged(list) {
  const per = S.config.store_page_size || 25, pages = Math.max(1, Math.ceil(list.length / per));
  if (S.page > pages) S.page = pages; if (!S.page || S.page < 1) S.page = 1;
  const grid = $('#grid'); gridGen++; const page = list.slice((S.page - 1) * per, S.page * per), groups = groupedList(page);
  if (groups) { grid.classList.remove('grid', 'lst'); grid.classList.add('ggwrap'); grid.innerHTML = groups.map(([k, gs]) => `<div class="ggrp${S._gcol.has(k) ? ' col' : ''}" data-g="${esc(k)}">${groupHead(k, gs.length, gs.reduce((a, g) => a + (g.playtime || 0), 0))}<div class="grid${listMode() ? ' lst' : ''}">${gs.map((g, i) => cardHtml(g, i)).join('')}</div></div>`).join(''); }
  else grid.innerHTML = page.map((g, i) => cardHtml(g, i)).join('');
  const pg = $('#pager'); if (!pg) return;
  if (pages <= 1) { pg.innerHTML = ''; return; }
  const btn = (n, l, on) => `<button class="${on ? 'on' : ''}" ${n < 1 || n > pages ? 'disabled' : ''} onclick="S.page=${n};(S.view==='emulation'?renderEmulation():renderLibrary());$('#view').scrollTo({top:$('#grid').offsetTop-90,behavior:'smooth'})">${l}</button>`;
  const nums = []; const win = 2; for (let i = 1; i <= pages; i++) { if (i === 1 || i === pages || Math.abs(i - S.page) <= win) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…'); }
  pg.innerHTML = `<span>${pl(list.length, 'jogo', 'jogos')} · página ${S.page} de ${pages}</span><div class="pbtns">${btn(S.page - 1, '‹')}${nums.map(n => n === '…' ? '<i>…</i>' : btn(n, n, n === S.page)).join('')}${btn(S.page + 1, '›')}</div>`;
}
function listMode() { return S.config.view_mode === 'list'; }
function setCardSize(v, save) { document.documentElement.style.setProperty('--card', v + 'px'); S.config.card_size = +v; if (save) api.post('/api/config', { card_size: +v }); }
function selectGame(key) {
  if (!S.byKey[key]) return;
  document.querySelectorAll('#grid .card.sel').forEach(c => c.classList.remove('sel'));
  document.querySelector(`#grid .card[data-key="${CSS.escape(key)}"]`)?.classList.add('sel');
  if ($('#stage')) stageSet(key); else { S.stageKey = key; gameFocus(key); }
}
let bdLayer = 0;
const ACC_CACHE = {};
function gameFocus(key) {
  S._focusKey = key || '';
  const bd = $('#backdrop'), mode = S.config.game_backdrop || '';
  if (bd) {
    if (!key || !mode || S.view !== 'home') { bd.classList.remove('on'); if (S.config.cover_slideshow && S.view === 'home') slideshowStart(); else slideshowStop(); }
    else {
      slideshowStop();
      bd.style.setProperty('--bdblur', (S.config.backdrop_blur ?? 10) + 'px'); bd.style.setProperty('--bddim', String((S.config.backdrop_dim ?? 42) / 100));
      const url = (mode === 'hero' ? '/hero/' : '/cover/') + enc(key) + '?v=' + ((S.byKey[key] || {}).cv || 0);
      const img = new Image();
      img.onload = () => { if (S._focusKey !== key) return; const ls = bd.querySelectorAll('.bl'); bdLayer ^= 1; ls[bdLayer].style.backgroundImage = `url("${url}")`; ls[bdLayer].classList.add('on'); ls[bdLayer ^ 1].classList.remove('on'); bd.classList.add('on'); };
      img.src = url;
    }
  }
  dynAccent(key && S.config.accent_from_cover && S.view === 'home' ? key : null);
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
  const nav = effNav(), lay = effLayout(), W = window.innerWidth, H = window.innerHeight; let near, far;
  if (lay === 'top') { near = e.clientY < 12; far = e.clientY > 90; } else if (nav === 'side') { near = e.clientX < 12; far = e.clientX > 140; } else { near = e.clientY > H - 12; far = e.clientY < H - 110; }
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
    if (!document.hidden) {
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
$('#view').addEventListener('dblclick', e => { const c = e.target.closest('.card'); if (c && !e.target.closest('[data-qp],[data-fav]')) openGame(c.dataset.key); });
$('#view').addEventListener('click', e => {
  const fv = e.target.closest('[data-fav]'); if (fv) { e.stopPropagation(); toggleFav(fv.dataset.fav); return; }
  const qp = e.target.closest('[data-qp]'); if (qp) { e.stopPropagation(); if (qp.classList.contains('live')) stopGame(qp.dataset.qp); else play(qp.dataset.qp); return; }
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
function ringSvg(f) { const r = 24, c = 2 * Math.PI * r, off = f < 0 ? c * .75 : c * (1 - f); return `<div class="ring"><svg viewBox="0 0 56 56"><circle class="t" cx="28" cy="28" r="${r}"/><circle class="v" cx="28" cy="28" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${off}"/></svg><span>${f < 0 ? '…' : Math.round(f * 100) + '%'}</span></div>`; }
const clock = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
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
  const dim = S.view === 'store' && !g.installed && !job && S.config.dim_not_installed !== false && !/^(rom|local):/.test(g.key) ? ' dim' : '';
  const lst = listMode() && ['home', 'store'].includes(S.view);
  const now = Date.now() / 1000, rib = S.config.card_ribbons !== false && g.installed && !live && !g.mc_nolauncher ? (g.last_played && new Date(g.last_played * 1000).toDateString() === new Date().toDateString() ? '<span class="rib today">HOJE</span>' : g.added_at && now - g.added_at < 7 * 86400 && !g.playtime ? `<span class="rib new" title="Adicionado ${daysAgo(g.added_at)} e ainda não aberto">NOVO</span>` : '') : '';
  const ptb = S.config.card_playtime && g.playtime >= 60 ? `<span class="ptb">${clock}${g.playtime >= 3600 ? Math.floor(g.playtime / 3600) + ' h' : Math.floor(g.playtime / 60) + ' min'}</span>` : '';
  const prog = job ? `<div class="cprog${job.fraction < 0 ? ' ind' : ''}"><i style="width:${job.fraction >= 0 ? Math.round(job.fraction * 100) : 40}%"></i></div>` : '';
  const favB = `<button class="fav ${g.fav ? 'on' : ''}" data-fav="${esc(g.key)}" title="Favorito">${I.star}</button>`;
  const srcB = S.view === 'store' && S._multiSrc && g.repo && g.repo !== 'local' ? `<span class="src" title="Fonte: ${esc(repoName(g.repo))}">${esc(repoName(g.repo))}</span>` : '';
  const qpB = g.installed && !job ? `<button class="qp ${live ? 'live' : ''}" data-qp="${esc(g.key)}" title="${live ? 'Em execução — clique para encerrar' : 'Jogar'}">${live ? I.x : I.play}</button>` : '';
  if (lst) return `<div class="card${dim}${S.sel.has(g.key) ? ' msel' : ''}" data-key="${esc(g.key)}">
    <div class="cov"><div class="ph">${esc(g.title)}</div><img loading="lazy" decoding="async" class="${TH.ok.has(g.key) ? 'ld inst' : TH.err.has(g.key) ? 'err' : ''}" src="/thumb/${enc(g.key)}?v=${g.cv || 0}" alt="" onload="this.classList.add('ld');TH.ok.add(${jsq(g.key)})" onerror="thumbFail(this,${jsq(g.key)})">${job ? ringSvg(job.fraction) : ''}</div>
    <h4>${esc(g.title)}${live ? '<span class="live">JOGANDO</span>' : ''}${g.mc_nolauncher ? '<span class="badge warn" title="Falta um launcher de Minecraft — clique em Jogar para escolher um">SEM LAUNCHER</span>' : g.repo === 'local' && !g.installed && !job ? '<span class="badge warn" title="O executável ou a ROM não está mais no lugar — clique em Jogar para apontar o novo caminho">NÃO ENCONTRADO</span>' : g.installed && S.view !== 'home' ? '<span class="badge ok">INSTALADO</span>' : ''}${sys}${srcB}</h4>
    <div class="lm"><span title="Ano">${esc(g.year || '')}</span><span title="Gênero">${esc((g.genres && g.genres[0]) || g.creator || g.fr || '')}</span><span title="Tamanho">${fmt(g.size)}</span><span title="Tempo jogado">${ptHtml(g.playtime)}</span><span title="Última vez">${lastPlayedText(g.last_played)}</span></div>
    <div class="la">${favB}${qpB}</div></div>`;
  return `<div class="card${dim}${S.sel.has(g.key) ? ' msel' : ''}" data-key="${esc(g.key)}" style="animation-delay:${Math.min(i, 24) * 8}ms">
    <div class="cov"><div class="ph">${esc(g.title)}${g.kind === 'rom' && g.key.startsWith('rom:') ? '<small>ROM LOCAL</small>' : g.kind === 'rom' ? '<small>ROM · BAIXAR</small>' : ''}</div>
      <img loading="lazy" decoding="async" class="${TH.ok.has(g.key) ? 'ld inst' : TH.err.has(g.key) ? 'err' : ''}" src="/thumb/${enc(g.key)}?v=${g.cv || 0}" alt="" onload="this.classList.add('ld');TH.ok.add(${jsq(g.key)})" onerror="thumbFail(this,${jsq(g.key)})">
      <div class="sh"></div><div class="info"><span>${esc(g.year || '')}</span><span>${fmt(g.size)}</span></div>
      ${live ? '<span class="live">JOGANDO</span>' : ''}${g.mc_nolauncher ? '<span class="badge warn" title="Falta um launcher de Minecraft — clique em Jogar para escolher um">SEM LAUNCHER</span>' : g.repo === 'local' && !g.installed && !job ? '<span class="badge warn" title="O executável ou a ROM não está mais no lugar — clique em Jogar para apontar o novo caminho">NÃO ENCONTRADO</span>' : g.installed && S.view !== 'home' ? '<span class="badge ok">INSTALADO</span>' : g.kind === 'recomp' ? '<span class="badge rc">RECOMP</span>' : ''}${live || (g.repo === 'local' && !g.installed) ? '' : sys}
      ${favB}${rib}${ptb}
      ${qpB}
      ${job ? ringSvg(job.fraction) + prog : ''}</div>
    <h4 title="${esc([g.title, g.creator || g.fr, g.year, g.playtime >= 60 ? fmtTime(g.playtime) + ' jogados' : ''].filter(Boolean).join(' · '))}">${esc(g.title)}</h4><div class="sub">${g.genres && g.genres[0] ? `<span class="g">${esc(g.genres[0])}</span>` : g.kind === 'rom' && g.system ? `<span class="g">${esc(S.systems[g.system] || g.system)}</span>` : ''}${(g.creator || g.fr) ? `<span class="d">${esc(g.creator || g.fr)}</span>` : ''}${ptHtml(g.playtime)}${srcB}</div></div>`;
}
$('#sort').addEventListener('click', e => { e.stopPropagation(); sortMenu($('#sort')); });
function sortMenu(btn) {
  const items = SORTS.map(([id, l]) => ({ label: l, icon: S.sort === id ? 'check' : '', fn: () => setSort(id) }));
  items.push({ label: 'Ordem inversa', icon: S.sortRev ? 'check' : '', fn: () => { S.sortRev = !S.sortRev; S.page = 1; renderSortBtn(); renderLibrary(); } });
  if (S.view === 'home') items.push({ label: 'Favoritos primeiro', icon: S.config.fav_first ? 'check' : '', fn: () => setCfg({ fav_first: !S.config.fav_first }).then(() => { S.page = 1; renderLibrary(); }) });
  if (['home', 'store'].includes(S.view)) { items.push({ sep: true }); for (const [id, l] of GROUPS) items.push({ label: id ? 'Agrupar: ' + l : 'Sem grupos', icon: (S.config.group_by || '') === id ? 'check' : '', fn: () => setCfg({ group_by: id }) }); }
  const r = btn.getBoundingClientRect(); showCtx(items, r.right - 230, r.bottom + 6, 'Ordenar e agrupar');
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
function applyQPlaceholder() { const i = $('#q'); if (!i) return; const n = S.view === 'home' ? S.games.filter(g => g.installed).length : 0; i.title = n ? 'Prefixos: dev:, ano:, gen:, sis:, origem:' : ''; i.placeholder = n ? `Buscar em ${n} jogos…  (/)` : (Q_PLACEHOLDER[S.view] || Q_PLACEHOLDER.home); }
const qObs = new MutationObserver(() => { if (S.q && FILTER_VIEWS.includes(S.view) && !S._qfBusy) { S._qfBusy = true; requestAnimationFrame(() => { S._qfBusy = false; viewFilter(); }); } });
qObs.observe($('#view'), { childList: true, subtree: true });
function renderSortBtn() { const b = $('#sort'); if (!b) return; const cur = SORTS.find(x => x[0] === S.sort) || SORTS[0]; b.innerHTML = `${I.sort}<span class="lbl">${esc(cur[1])}</span><svg class="car" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>`; b.classList.toggle('on', S.sort !== 'az' || !!S.sortRev); if (S.sortRev) b.querySelector('.lbl').textContent += ' ↓'; }
function focusSearch() { const m = $('#qm'); if (m && m.offsetParent) { m.parentElement.classList.add('on'); m.focus(); return; } if (topSearchVisible()) { $('#q').focus(); return; } if (!['home', 'store'].includes(S.view)) { setView(S.repos.some(r => r.enabled) ? 'store' : 'home'); return setTimeout(focusSearch, 80); } $('#q').focus(); }
let qmt; function miniSearch(v) { S._siteQ = ''; clearTimeout(qmt); qmt = setTimeout(() => { S.q = v; S.page = 1; const i = $('#q'); if (i) i.value = v; renderLibrary(); const m = $('#qm'); if (m) { m.parentElement.classList.add('on'); m.focus(); m.setSelectionRange(v.length, v.length); } }, 160); }
$('#q').addEventListener('keydown', e => { if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.stopPropagation(); clearSearch(); } else if (e.key === 'Escape') e.target.blur(); });
let qt; $('#q').addEventListener('input', e => { S._siteQ = ''; clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value; S.page = 1; if (S.view === 'emulation' && S.tab.emulation === 'roms') renderEmulation(); else if (FILTER_VIEWS.includes(S.view)) searchInView(); else if (!['home', 'store'].includes(S.view)) setView(S.repos.some(r => r.enabled) ? 'store' : 'home'); else renderLibrary(); }, 120); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if ($('#ctx').classList.contains('on')) closeCtx(); else if ($('#modal').classList.contains('on')) $('#modal').classList.remove('on'); else if (S.sel.size && !$('#detail').classList.contains('on')) msClear(); else closeDetail(); }
  if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); }
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { e.preventDefault(); focusSearch(); }
  if (e.key === '"' && S.config.terminal_enabled && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { e.preventDefault(); openTerminal(); }
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable;
  const busy = $('#modal').classList.contains('on') || $('#welcome')?.classList.contains('on') || $('#flashwin')?.classList.contains('on');
  if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[1-9]$/.test(e.key)) { const tabs = navOrder().filter(v => !(S.config.nav_hidden || []).includes(v)).concat(['settings']); const v = tabs[+e.key - 1]; if (v) { e.preventDefault(); closeDetail(); setView(v); } return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A') && S.view === 'home' && !typing && !busy && !$('#detail').classList.contains('on')) { e.preventDefault(); for (const c of document.querySelectorAll('#view .card')) if (/^(local|rom):/.test(c.dataset.key)) S.sel.add(c.dataset.key); document.querySelectorAll('#view .card').forEach(c => c.classList.toggle('msel', S.sel.has(c.dataset.key))); msBar(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); closeDetail(); setView('settings'); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.key === 'f' || e.key === 'F')) { e.preventDefault(); focusSearch(); return; }
  if (e.key === 'F5') { e.preventDefault(); if (!busy) { S.home = null; S._poolKey = ''; loadCatalog(false); toast('', 'Biblioteca atualizada', ''); } return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !typing && !busy) { e.preventDefault(); undoRemove(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D') && !typing && !busy && S.view === 'home' && S.stageKey && S.byKey[S.stageKey]) { e.preventDefault(); toggleFav(S.stageKey); return; }
  if (typing || busy || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '?') { e.preventDefault(); shortcutsHelp(); return; }
  if ((e.key === 'n' || e.key === 'N') && S.view === 'home' && !$('#detail').classList.contains('on')) { e.preventDefault(); addLocal(); return; }
  if ((e.key === 'Home' || e.key === 'End') && !$('#modal').classList.contains('on') && !$('#detail').classList.contains('on')) { const v = $('#view'); if (v) { e.preventDefault(); v.scrollTo({ top: e.key === 'Home' ? 0 : v.scrollHeight, behavior: 'smooth' }); } return; }
  if ($('#detail').classList.contains('on')) {
    if (e.key === 'Enter' && S.det) { const b = $('#dWrap .acts > .btn.g, #dWrap .acts > .btn.p'); if (b && !b.disabled) { e.preventDefault(); b.click(); } }
    return;
  }
  if (S.view !== 'home' || !S.stageKey || !S.byKey[S.stageKey]) return;
  const g = S.byKey[S.stageKey];
  if (e.key === 'Enter') { e.preventDefault(); if (g.installed || S.stageKey.startsWith('rom:')) play(S.stageKey); else openGame(S.stageKey); }
  else if (e.key === 'i' || e.key === 'I') { e.preventDefault(); openGame(S.stageKey); }
  else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFav(S.stageKey); }
  else if ((e.key === 'e' || e.key === 'E') && /^(local|rom):/.test(S.stageKey)) { e.preventDefault(); editGame(S.stageKey); }
  else if (e.key === 'F2' && /^(local|rom):/.test(S.stageKey)) { e.preventDefault(); renameGame(S.stageKey); }
  else if (e.key === 'Delete' && S.sel.size) { e.preventDefault(); removeMany([...S.sel]); }
  else if (e.key === 'Delete' && /^(local|rom):/.test(S.stageKey)) { e.preventDefault(); confirmUninstall(S.stageKey); }
});
function shortcutsHelp() {
  const tabs = navOrder().filter(v => !(S.config.nav_hidden || []).includes(v)).concat(['settings']);
  const names = Object.fromEntries(NAV_ITEMS.map(([v, n]) => [v, n])); names.settings = 'Ajustes';
  const row = (k, d) => `<div class="krow"><span>${k.map(x => `<kbd>${x}</kbd>`).join('<i>+</i>')}</span><em>${d}</em></div>`;
  modal({ title: 'Atalhos do teclado', wide: true, ok: 'Fechar', noCancel: true, html: `<div class="kgrid">
    <div class="kcol"><h4>Em qualquer lugar</h4>${row(['/'], 'Buscar na aba atual')}${row(['Ctrl', 'K'], 'Buscar (alternativa; Ctrl+F também)')}${row(['F5'], 'Recarregar a biblioteca')}${row(['Ctrl', '1…' + tabs.length], tabs.map((v, i) => `${i + 1} ${names[v] || v}`).join(' · '))}${row(['Ctrl', ','], 'Abrir Ajustes')}${row(['F11'], 'Tela cheia')}${row(['Esc'], 'Fechar o que estiver aberto (detalhes, janela, menu)')}${row(['?'], 'Esta lista')}</div>
    <div class="kcol"><h4>Na Biblioteca, com um jogo selecionado</h4>${row(['Enter'], 'Jogar (ou abrir os detalhes se não estiver instalado)')}${row(['I'], 'Abrir os detalhes')}${row(['F'], 'Favoritar / desfavoritar')}${row(['E'], 'Editar detalhes (jogos adicionados e ROMs)')}${row(['F2'], 'Renomear')}${row(['Ctrl', 'D'], 'Favoritar / desfavoritar')}${row(['Ctrl', 'Z'], 'Desfazer a última remoção (até 10 minutos)')}${row(['N'], 'Adicionar jogo')}${row(['Home', 'End'], 'Ir para o começo ou o fim da lista')}${row(['Delete'], 'Remover da biblioteca (jogos adicionados e ROMs; pede confirmação)')}${row(['Ctrl', 'clique'], 'Selecionar vários (Shift+clique para um intervalo; Ctrl+A todos da página)')}<h4>Nos detalhes de um jogo</h4>${row(['Enter'], 'Jogar ou Baixar')}${row(['Esc'], 'Voltar')}${S.config.terminal_enabled ? `<h4>Extras</h4>${row(['"'], 'Terminal do Ludrix')}` : ''}</div></div>` });
}
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
function setupHero() { const pool = S.games.filter(g => g.repo !== 'local' && !g.installed && !isRepoRom(g)); S.hero = pool.filter(g => HERO_PICK.test(g.title)).slice(0, 8); if (!S.hero.length) S.hero = pool.filter(g => g.thumb_ok).slice(0, 6); if (!S.hero.length) S.hero = pool.slice(0, 6); clearInterval(S.heroT); S.heroT = setInterval(() => { if ($('#hero')) showHero((S.heroIdx + 1) % S.hero.length); }, 7000); renderView(); }
function heroHtml() { return `<div class="hero" id="hero"><div class="bg" id="heroBg"></div><div class="grad"></div><div class="dots" id="heroDots">${S.hero.map((_, i) => `<i class="${i === S.heroIdx ? 'on' : ''}"></i>`).join('')}</div><img class="cov" id="heroCov" alt=""><div class="txt"><span class="tag" id="heroTag">EM DESTAQUE</span><h1 id="heroTitle"></h1><div class="meta" id="heroMeta"></div><button class="btn p" id="heroBtn">Ver detalhes</button></div></div>`; }
function showHero(i) {
  const g = S.hero[i]; if (!g || !$('#hero')) return; S.heroIdx = i;
  $('#heroBg').style.backgroundImage = `url(/hero/${enc(g.key)})`; $('#heroCov').src = `/cover/${enc(g.key)}`;
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
async function openGame(key) {
  S.current = key; S.dtab = 'about'; const g = S.byKey[key] || { title: '...' };
  if (S.config.accent_from_cover) { S._focusKey = key; dynAccent(key); }
  setHero(key, `/hero/${enc(key)}`);
  $('#dWrap').innerHTML = `<div class="dcov"><img src="/cover/${enc(key)}" alt="${esc((g.title || '?').trim().charAt(0).toUpperCase())}" onerror="dph(this)"></div><div class="dmain"><h1>${esc(g.title)}</h1><div class="meta"><span class="pill">carregando…</span></div></div>`;
  $('#detail').classList.add('on'); $('#detail').scrollTop = 0;
  const d = await api.get('/api/game/' + enc(key));
  if (S.current !== key) return;
  if (d.error) { toast('err', 'Não foi possível concluir', d.error); return; }
  S.det = d; renderDetail(); guide('detail');
  if (!d.meta && S.config.auto_metadata && d.kind !== 'emulator') fetchMeta(key, false, true);
}
function closeDetail() { const was = S.current; S.current = null; $('#detail').classList.remove('on'); $('#detail').classList.remove('bar'); if (S._dObs) { S._dObs.disconnect(); S._dObs = null; } if (G.id === 'detail') guideDismiss(); if (was && S.config.accent_from_cover) { if (S.view === 'home' && S.stageKey) gameFocus(S.stageKey); else { S._focusKey = ''; dynAccent(null); } } }
$('#dClose').onclick = closeDetail;
function renderDetail() {
  const d = S.det; if (!d) return; const key = d.key, job = S.jobs[key], m = d.meta || {};
  const isRom = key.startsWith('rom:'), isRecomp = d.kind === 'recomp', isLocal = d.kind === 'local', live = S.sessions && S.sessions[key];
  const genres = (m.genres && m.genres.length ? m.genres : d.genres) || [];
  let acts = '';
  if (job) acts = progHtml(job, key);
  else if (d.repack && d.repack_state !== 'done') {
    acts = `<button class="btn p" onclick="runRepack(${jsq(key)})">${I.dl} ${d.repack_state === 'installing' ? 'Instalador aberto…' : d.disc ? 'Montar o disco e instalar' : 'Abrir instalador (setup)'}</button>
      <span class="pill" style="justify-content:center;text-align:center;white-space:normal;line-height:1.35">Repack baixado. Quando o setup terminar, a pasta é localizada e o jogo entra na biblioteca.</span>
      <div class="row"><button class="btn s sm" onclick="api.post('/api/open',{path:${jsq(d.dir)}})">${I.folder} Pasta</button><button class="btn s sm" onclick="chooseExe(${jsq(key)})">${I.cog} Já instalei</button></div>
      <div class="row"><button class="btn s sm" onclick="api.post('/api/finish_repack',{key:${jsq(key)}}).then(()=>openGame(${jsq(key)}))">${I.check} Procurar instalação agora</button><button class="btn d sm" onclick="confirmUninstall(${jsq(key)})" title="Apagar o repack baixado">${I.trash}</button></div>`;
  } else if (d.installed || isRom) {
    acts = `${d.crash_count ? `<button class="pill warn crashpill" onclick="crashDialog(${jsq(key)}, ${jsq(d.title)})" title="${esc(d.crash_why || '')}">${I.warn || '!'} Fechou sozinho ${d.crash_count > 1 ? d.crash_count + '× ' : ''}— por quê?</button>` : ''}${d.missing ? `<button class="btn p" onclick="play(${jsq(key)})">${I.folder} Apontar ${isRom ? 'arquivo' : 'pasta'}…</button>` : `<button class="btn g" ${live ? 'disabled' : ''} onclick="play(${jsq(key)})">${I.play} ${live ? 'Jogando…' : 'Jogar'}</button>`}
      <div class="row">${d.dir && !isUri(d.exe) && !d.missing ? `<button class="btn s sm" onclick="api.post('/api/open',{path:${jsq(d.dir)}})">${I.folder} Pasta</button>` : ''}
      <button class="btn s sm" onclick="savesPanel(${jsq(key)})" title="Saves">${I.save} Saves</button>
      <button class="btn s sm" onclick="editGame(${jsq(key)})" title="Editar detalhes do jogo (nome, capa, descrição, executável…)">${I.edit} Editar</button><button class="btn d sm" onclick="confirmUninstall(${jsq(key)})" title="${isLocal || isRom ? 'Remover da biblioteca' : 'Desinstalar'}">${I.trash}</button></div>`;
  } else {
    const multi = (d.files || []).length > 1;
    if (d.buy_only) acts = `<span class="pill warn" style="justify-content:center;white-space:normal;line-height:1.4;padding:8px 10px">Este jogo ainda está à venda — o site não distribui o arquivo. Veja em "Origem".</span>`;
    else if (d.browser_only) acts = `<button class="btn p" ${d.files?.length ? '' : 'disabled'} onclick="install(${jsq(key)},false)">${I.ext} Baixar pelo navegador</button><span class="pill" style="justify-content:center;white-space:normal;line-height:1.4;padding:6px 10px">${multi ? 'Escolha o mirror ao lado → ' : ''}O site pede verificação humana, então o download abre no navegador. Depois: Adicionar → Jogo de Windows.</span>${d.steam_url ? `<button class="btn s sm" onclick="api.post('/api/open_url',{url:${jsq(d.steam_url)}})">${I.ext} Página na Steam</button>` : ''}`;
    else {
      const hasT = !!(d.magnet || d.torrent_url), hasF = !!(d.files && d.files.length);
      if (hasT && hasF && d.prefer === 'torrent') acts = `<button class="btn p" onclick="install(${jsq(key)},true)">${I.magnet} ${S.torrent ? 'Baixar via torrent' : 'Abrir no cliente de torrent'}</button>
        <button class="btn s sm" onclick="install(${jsq(key)},false)">${I.dl} Baixar em partes</button>${multi ? `<span class="pill" style="justify-content:center">Em partes: escolha os arquivos ao lado →</span>` : ''}`;
      else if (hasT && !hasF) acts = `<button class="btn p" onclick="install(${jsq(key)},true)">${I.magnet} ${S.torrent ? 'Baixar via torrent' : 'Abrir no cliente de torrent'}</button>
        <span class="pill" style="justify-content:center;white-space:normal;line-height:1.4;padding:6px 10px">${S.torrent ? `Baixa e instala aqui mesmo (motor ${esc(S.torrentEngine || 'torrent')}).${d.repack_hint ? ' Repack: o setup abre no fim.' : ''}` : 'Sem motor de torrent no launcher — o magnet abre no seu cliente (qBittorrent etc.). Depois: Adicionar → Jogo de Windows.'}</span>`;
      else acts = `<button class="btn p" ${hasF ? '' : 'disabled'} onclick="install(${jsq(key)},false)">${I.dl} ${isRecomp ? 'Baixar recomp' : d.kind === 'rom' ? 'Baixar ROM' : 'Baixar e instalar'}</button>
      ${hasT ? `<button class="btn s sm" onclick="install(${jsq(key)},true)">${I.magnet} ${S.torrent ? 'Baixar via torrent' : 'Abrir magnet no cliente de torrent'}</button>` : ''}
      ${multi ? `<span class="pill" style="justify-content:center">Escolha os arquivos ao lado →</span>` : ''}`;
    }
  }
  const page = `<div class="row">${d.page_url ? `<button class="btn s sm" onclick="api.post('/api/open_url',{url:${jsq(d.page_url)}})">${I.ext} Origem</button>` : ''}<button class="btn s sm ${d.fav || (S.byKey[key] || {}).fav ? 'favon' : ''}" onclick="toggleFav(${jsq(key)});this.classList.toggle('favon')">${I.star} Favorito</button><button class="btn s sm" onclick="ctxMenu(${jsq(key)}, this.getBoundingClientRect().left, this.getBoundingClientRect().bottom + 6)">⋯</button></div>`;
  const metaBtn = d.kind !== 'emulator' ? `<button class="btn s sm" id="metaBtn" onclick="fetchMeta(${jsq(key)},true)">${I.spark} ${d.meta ? 'Atualizar metadados' : 'Buscar metadados'}</button>` : '';

  let files = '';
  if (!d.installed && !isRom && d.files && d.files.length > 1) {
    const mirrors = d.mirrors;
    files = `<div class="dsec"><h3>${mirrors ? 'ESPELHOS — ESCOLHA UM' : 'ARQUIVOS DISPONÍVEIS'}</h3>${mirrors ? '<p class="mut" style="margin:0 0 8px">O mesmo build em hospedagens diferentes; o downloader embutido baixa o escolhido. Google Drive limita arquivos gigantes — prefira Gofile/buzzheavier.</p>' : ''}<div class="files">${d.files.map((f, i) => `<label class="file ${i === 0 ? 'on' : ''}"><input type="${/\.\d{3}$/.test(f.name) ? 'checkbox' : 'radio'}" name="f" value="${esc(f.name)}" ${i === 0 || /\.\d{3}$/.test(f.name) ? 'checked' : ''} onchange="this.closest('.files').querySelectorAll('.file').forEach(x=>x.classList.toggle('on',x.querySelector('input').checked))"><span class="n">${esc(f.basename)}</span><span class="s">${f.size ? fmt(f.size) : ''}</span></label>`).join('')}</div></div>`;
  }
  if (d.patches && d.patches.length) files += `<div class="dsec"><h3>PATCHES E EXTRAS</h3><div class="files">${d.patches.map((f, i) => `<div class="file" style="display:flex;align-items:center;gap:8px"><span style="flex:1;min-width:0"><b>${esc(f.name)}</b>${f.note ? `<br><small class="mut">${esc(f.note)}</small>` : ''}</span>${f.size ? `<small class="mut">${fmt(f.size)}</small>` : ''}<button class="btn s xs" onclick="api.post('/api/patch/download',{key:${jsq(key)},i:${i}}).then(r=>toast(r.error?'err':'ok',${jsq(f.name)},r.error||'Baixando — acompanhe na Fila.'))">${I.dl} Baixar</button></div>`).join('')}</div></div>`;
  const kv = [
    d.playtime ? ['Tempo jogado', d.playtime_h] : null, d.last_played ? ['Último jogo', ago(d.last_played)] : null, d.play_count ? ['Vezes jogado', String(d.play_count)] : null, d.last_session ? ['Última sessão', fmtTime(d.last_session)] : null, d.added_at && (d.installed || d.missing) ? ['Adicionado', new Date(d.added_at * 1000).toLocaleDateString('pt-BR')] : null,
    ['Desenvolvedora', m.developer || d.creator], ['Publicadora', m.publisher], ['Ano', m.year || d.year], ['Gêneros', genres.join(', ')],
    ['Modos', m.modes], ['Série', m.series], ['Sistema', d.system_name], d.emu && d.emu.emulator_title ? ['Emulador', d.emu.installed ? d.emu.emulator_title : d.emu.emulator_title + ' (não instalado)'] : null, ['Versão', d.version], d.size ? ['Tamanho', fmt(d.size)] : isLocal && d.dir && !d.missing ? ['Tamanho', `<a href="#" onclick="calcSize(${jsq(key)},this);return false" style="color:var(--accent2)">Calcular</a>`] : null,
    ['Repositório', (S.repos.find(r => r.id === d.repo) || {}).name || d.repo], d.installed && !d.missing && !isUri(d.exe) ? ['Pasta', d.dir] : null, d.installed || d.missing ? [isUri(d.exe) ? 'Abre por' : isRom ? 'Arquivo' : 'Executável', isUri(d.exe) ? `${uriName(d.exe)} (${d.exe})` : d.exe] : null, d.args ? ['Argumentos', d.args] : null, d.workdir ? ['Pasta de trabalho', d.workdir] : null, d.source === 'playnite' ? ['Origem', 'Playnite' + (d.store_src ? ' · ' + d.store_src : '')] : d.store_src ? ['Origem', d.store_src] : null,
    m.wiki_url ? ['Wikipedia', `<a href="#" onclick="api.post('/api/open_url',{url:${jsq(m.wiki_url)}});return false" style="color:var(--accent2)">${esc(m.wiki_url.replace(/^https?:\/\//, ''))}</a>`] : null,
    m.gog_url ? ['GOG', `<a href="#" onclick="api.post('/api/open_url',{url:${jsq(m.gog_url)}});return false" style="color:var(--accent2)">${esc(m.gog_name || 'página na GOG')}</a>`] : null,
    m.steam_appid ? ['Steam', `<a href="#" onclick="api.post('/api/open_url',{url:'https://store.steampowered.com/app/${esc(String(m.steam_appid))}'});return false" style="color:var(--accent2)">${esc(m.steam_name || 'página na Steam')}</a>`] : null,
    d.title_orig && d.title_orig !== d.title ? ['Nome original', `${esc(d.title_orig)} <small style="color:var(--muted)">(${d.title_locked ? 'renomeado por você' : 'corrigido pelos metadados'})</small>`] : null,
    m.cover_src ? ['Capa', { steam: 'Steam', gog: 'GOG', libretro: 'boxart oficial (' + esc(S.systems[m.libretro_sys] || m.libretro_sys || d.system_name || '') + ')', wikipedia: 'Wikipedia', steamgriddb: 'SteamGridDB', manual: 'link seu' }[m.cover_src] || esc(m.cover_src)] : null,
    ...(m.links || []).map(l => ['Link', `<a href="#" onclick="api.post('/api/open_url',{url:${jsq(l.url)}});return false" style="color:var(--accent2)">${esc(l.name || l.url.replace(/^https?:\/\//, ''))}</a>`]),
    m.notes ? ['Notas', `<span style="white-space:pre-wrap">${esc(m.notes)}</span> <a href="#" onclick="editGame(${jsq(key)},'avancado');return false" style="color:var(--accent2);margin-left:6px">editar</a>`] : null
  ].filter(x => x && x[1]);
  const lbl = [d.system_name || 'PC', m.developer || d.creator, m.year || d.year].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ') + (live ? ' &nbsp;·&nbsp; <b>Jogando agora</b>' : d.missing ? ' &nbsp;·&nbsp; <b style="color:var(--amber)">Arquivo não encontrado</b>' : d.installed || isRom ? ' &nbsp;·&nbsp; <b>Instalado</b>' : '');
  $('#detail').classList.toggle('art', !!(m.hero || m.hero_url || m.background_file));
  $('#dWrap').innerHTML = `
    <div class="dhero"><div class="dcov"><img src="/cover/${enc(key)}?v=${(S.byKey[key] || {}).cv || m.fetched_at || 0}" alt="${esc((d.title || '?').trim().charAt(0).toUpperCase())}" onerror="dph(this)"><div class="covedit"><button class="btn s xs" onclick="setCover(${jsq(key)})" title="Usar uma imagem minha como capa">${I.image} Trocar capa</button>${d.custom_cover ? `<button class="btn s xs" onclick="resetCover(${jsq(key)})" title="Voltar à capa original">${I.refresh}</button>` : ''}</div></div>
    <div class="dhead"><div class="dlbl">${lbl}</div><h1>${esc(d.title)}</h1>
      <div class="meta">${isLocal ? `<span class="pill">${d.source === 'playnite' ? 'Importado do Playnite' : 'Adicionado manualmente'}</span>` : ''}${d.playtime > 60 ? `<span class="pill">${clock} ${esc(d.playtime_h)}</span>` : ''}${isRecomp ? '<span class="pill ac">Recompilação nativa</span>' : ''}${isRom ? `<span class="pill ac">${esc(d.system_name)}</span>` : ''}
        ${genres.slice(0, 3).map(x => `<span class="pill">${esc(x)}</span>`).join('')}${m.year || d.year ? `<span class="pill">${esc(m.year || d.year)}</span>` : ''}${d.size ? `<span class="pill">${fmt(d.size)}</span>` : ''}${d.meta ? `<span class="pill" title="${esc([].concat(m.source || []).join(', '))}">${I.spark} meta</span>` : ''}</div>
      <div class="acts">${acts}${page}${metaBtn}</div></div></div>
    <div class="dmain">
      ${d.requires_rom ? `<div class="note"><b>Precisa da ROM original.</b> ${esc(d.requires_rom)}. Recompilações não incluem dados do jogo — o launcher só baixa o executável.</div>` : ''}
      ${d.emu && !d.emu.installed ? `<div class="note"><b>${esc(d.emu.emulator_title)} não instalado.</b> <a href="#" onclick="setView('emulation');return false" style="color:var(--accent2)">Instalar na aba Emuladores</a> para jogar.</div>` : ''}
      ${dtabsHtml(d, m)}
      <div class="dpane ${(S.dtab || 'about') === 'about' ? 'on' : ''}" data-pane="about">
      <div class="desc" style="margin-top:14px">${esc(m.summary || d.description || 'Sem descrição. Clique em "Buscar metadados".')}</div>
      ${files}
      <div class="dsec" id="dMods"></div>
      <div class="dsec"><h3>INFORMAÇÕES</h3><div class="kv">${kv.map(([k, v]) => `<b>${k}</b><span>${['Wikipedia', 'GOG', 'Steam', 'Nome original', 'Capa', 'Link', 'Notas', 'Tamanho'].includes(k) ? v : esc(v)}</span>`).join('')}</div></div>
      </div>
      <div class="dpane ${S.dtab === 'shots' ? 'on' : ''}" data-pane="shots">${shotsHtml(key, d, m)}</div>
      <div class="dpane ${S.dtab === 'reqs' ? 'on' : ''}" data-pane="reqs">${reqsHtml(d, m)}</div>
    </div>`;
  loadModsFor(key);
  detailBar();
}
function detailBar() {
  const d = S.det, bar = $('#dBar'), det = $('#detail'); if (!d || !bar) return;
  if (S._dObs) { S._dObs.disconnect(); S._dObs = null; }
  det.classList.remove('bar');
  const prim = $('#dWrap .acts > .btn.g, #dWrap .acts > .btn.p') || $('#dWrap .acts .prog');
  $('#dBarTitle').textContent = d.title || '';
  const img = $('#dBarImg'); img.onerror = () => { img.style.display = 'none'; }; img.style.display = ''; img.src = `/thumb/${enc(d.key)}`;
  const act = $('#dBarAct'); act.innerHTML = '';
  if (prim && prim.classList.contains('btn')) { const c = prim.cloneNode(true); c.classList.remove('g', 'p'); c.classList.add(prim.classList.contains('g') ? 'g' : 'p', 'sm'); act.appendChild(c); }
  else if (prim) { const j = S.jobs[d.key]; act.innerHTML = `<span class="pill ac">${j && j.fraction >= 0 ? Math.round(j.fraction * 100) + '%' : '…'} <button class="lnk" onclick="api.post('/api/cancel',{key:${jsq(d.key)}})">Cancelar</button></span>`; }
  const target = prim || $('#dWrap .dcov');
  if (!target) return;
  S._dObs = new IntersectionObserver(es => { es.forEach(e => det.classList.toggle('bar', !e.isIntersecting && det.classList.contains('on'))); }, { root: det, threshold: 0 });
  S._dObs.observe(target);
}
function dtabsHtml(d, m) {
  if (d.kind === 'emulator') return '';
  const shots = (m.shots || d.screenshots || []).length;
  const tabs = [['about', 'Sobre'], ['shots', `Screenshots${shots ? ` <span class="n">${shots}</span>` : ''}`], ['reqs', 'Requisitos']];
  return `<div class="tabs dtabs">${tabs.map(([id, l]) => `<button class="${(S.dtab || 'about') === id ? 'on' : ''}" onclick="dtab('${id}')">${l}</button>`).join('')}</div>`;
}
function dtab(id) { S.dtab = id; document.querySelectorAll('.dtabs button').forEach((b, i) => b.classList.toggle('on', ['about', 'shots', 'reqs'][i] === id)); document.querySelectorAll('.dpane').forEach(p => p.classList.toggle('on', p.dataset.pane === id)); }
function shotsHtml(key, d, m) {
  const v = m.fetched_at || 0;
  const list = m.shots ? m.shots.map((_, i) => `/shot/${enc(key)}/${i}?v=${v}`) : (d.screenshots || []).slice(0, 3);
  const q = encodeURIComponent(`${d.title || ''} gameplay screenshot`);
  if (!list.length) return `<div class="dsec dempty"><p class="mut">${d.meta ? 'Nenhuma screenshot encontrada nas fontes disponíveis para este jogo.' : 'As screenshots chegam junto com os metadados.'}</p><div class="row">${d.meta ? `<button class="btn s" onclick="fetchMeta(${jsq(key)}, true)">${I.refresh} Buscar de novo</button>` : `<button class="btn p" onclick="fetchMeta(${jsq(key)}, true)">${I.refresh} Buscar metadados</button>`}<button class="btn s" onclick="api.post('/api/open_url', {url: 'https://www.bing.com/images/search?q=${q}'})">${I.ext} Ver imagens na web</button></div></div>`;
  const src = m.shots_src === 'web' ? 'web' : (m.steam_appid ? 'Steam' : '');
  return `<div class="shots">${list.map((u, i) => `<img src="${esc(u)}" alt="" loading="lazy" onclick="lightbox(${jsq(u)})" onerror="this.closest('.shots').removeChild(this)">`).join('')}</div><p class="mut" style="margin-top:8px;font-size:12px">Toque numa imagem para ampliar. Imagens leves, guardadas em cache${src ? ' · fonte: ' + src : ''}.</p>`;
}
function reqsHtml(d, m) {
  const r = m.reqs || d.requirements;
  const q = encodeURIComponent(`${d.title || ''} requisitos de sistema pc`);
  if (!r || (!(r.min || []).length && !(r.rec || []).length)) return `<div class="dsec dempty"><p class="mut">${d.system && d.system !== 'pc' ? 'Jogo emulado: o que pesa é o emulador, não o jogo. Veja os requisitos na aba Emuladores.' : d.meta ? 'Nenhuma fonte disponível publicou os requisitos deste jogo.' : 'Os requisitos chegam junto com os metadados.'}</p><div class="row">${d.meta ? `<button class="btn s" onclick="fetchMeta(${jsq(d.key)}, true)">${I.refresh} Buscar de novo</button>` : `<button class="btn p" onclick="fetchMeta(${jsq(d.key)}, true)">${I.refresh} Buscar metadados</button>`}${d.system && d.system !== 'pc' ? '' : `<button class="btn s" onclick="api.post('/api/open_url', {url: 'https://www.bing.com/search?q=${q}'})">${I.ext} Procurar na web</button>`}</div></div>`;
  const col = (t, ls) => ls && ls.length ? `<div class="reqcol"><h3>${t}</h3><ul>${ls.map(x => { const i = x.indexOf(':'); return i > 0 && i < 30 ? `<li><b>${esc(x.slice(0, i))}</b><span>${esc(x.slice(i + 1).trim())}</span></li>` : `<li><span>${esc(x)}</span></li>`; }).join('')}</ul></div>` : '';
  return `${reqCompare(r, d)}<div class="reqs">${col('MÍNIMOS', r.min)}${col('RECOMENDADOS', r.rec)}</div>${m.reqs_src === 'pcgamingwiki' ? '<p class="mut" style="margin-top:8px;font-size:12px">Fonte: PCGamingWiki.</p>' : ''}`;
}
function reqCompare(r, d) {
  if (d.system && d.system !== 'pc') return '';
  if (!S.hw) { if (!S._hwReq) { S._hwReq = true; api.get('/api/hardware').then(h => { if (h && !h.error) { S.hw = h; const pane = document.querySelector('.dpane[data-pane="reqs"]'), det = S.det; if (pane && det && !pane.querySelector('.reqcmp')) { const html = reqCompare(r, det); if (html) pane.insertAdjacentHTML('afterbegin', html); } } }); } return ''; }
  const hw = S.hw, lines = (r.min || []).concat(r.rec || []).join('\n');
  const gb = re => { const mm = lines.match(re); return mm ? parseFloat(mm[1].replace(',', '.')) * (/mb/i.test(mm[2] || '') ? 1 / 1024 : 1) : 0; };
  const needRam = gb(/(?:mem[oó]ria|ram)[^\n]*?(\d+(?:[.,]\d+)?)\s*(gb|mb)/i) || gb(/(\d+(?:[.,]\d+)?)\s*(gb|mb)\s*(?:de\s*)?ram/i);
  const needDisk = gb(/(\d+(?:[.,]\d+)?)\s*(gb|mb)\s*(?:de\s*)?(?:espa[çc]o|dispon[íi]ve|livre|available|free)/i) || gb(/\b(?:armazenamento|storage|disco r[íi]gido|hard drive|espa[çc]o em disco)\b[^\n]*?(\d+(?:[.,]\d+)?)\s*(gb|mb)/i);
  const wantsGpu = /gtx|rtx|radeon|geforce|rx\s?\d{3,4}|arc a/i.test((r.min || []).join(' '));
  const haveRam = (hw.ram && hw.ram.total ? hw.ram.total / 2 ** 30 : 0), free = Math.max(0, ...(hw.disks || []).map(x => x.free || 0)) / 2 ** 30;
  const gpu = (hw.gpus || []).map(g => g.name).join(' ').toLowerCase(), dedicated = /rtx|gtx|radeon rx|arc a|arc b|geforce|rx \d{3,4}/.test(gpu) && !/vega \d\b|graphics$/.test(gpu);
  const items = [];
  if (needRam && haveRam) items.push([haveRam >= needRam, `Memória: ${Math.round(haveRam)} GB (pede ${needRam} GB)`]);
  if (needDisk && free) items.push([free >= needDisk, `Espaço livre: ${Math.round(free)} GB (pede ${needDisk} GB)`]);
  if (wantsGpu && gpu) items.push([dedicated, dedicated ? 'Placa de vídeo dedicada' : 'Sem placa de vídeo dedicada (o jogo pede uma)']);
  if (!items.length) return '';
  const bad = items.filter(x => !x[0]).length;
  return `<div class="reqcmp ${bad ? 'warn' : 'ok'}"><b>${bad ? (bad === 1 ? '1 item abaixo do mínimo' : bad + ' itens abaixo do mínimo') : 'Seu PC atende ao mínimo'}</b>${items.map(([ok, t]) => `<span class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✕'} ${esc(t)}</span>`).join('')}<a href="#" class="more" onclick="closeDetail();setView('settings');settingsTab('system','Seu PC');return false">Ver meu PC</a></div>`;
}
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
function emptyHtml(icon, title, text, actions) {
  const acts = (actions || []).map(([l, fn, p]) => `<button class="btn ${p ? 'p' : 's'} sm" onclick="${esc(fn)}">${l}</button>`).join('');
  return `<div class="empty">${icon ? `<div class="eic">${icon}</div>` : ''}<b>${title}</b><p>${text}</p>${acts ? `<div class="eacts">${acts}</div>` : ''}</div>`;
}
function progHtml(j, key) {
  const names = { download: 'Baixando', extract: 'Extraindo', cleanup: 'Limpando', done: 'Concluído', move: 'Movendo', install: 'Instalando' };
  const ind = j.fraction < 0, pct = ind ? 0 : Math.round(j.fraction * 100);
  return `<div class="prog" data-job="${esc(key)}"><div class="h"><b><i></i>${names[j.stage] || j.stage}</b><span>${ind ? '' : pct + '%'}</span></div>
    <div class="track ${ind ? 'ind' : ''} ${j.stage === 'extract' ? 'ex' : ''}"><i style="width:${pct}%"></i></div>
    <div class="d"><span>${esc(j.detail)}</span>${j.kind === 'install' && j.stage === 'download' ? `<button onclick="api.post('/api/cancel',{key:${jsq(key)},pause:true})" title="Guarda o parcial para retomar na Fila">Pausar</button>` : ''}<button onclick="api.post('/api/cancel',{key:${jsq(key)}})">Cancelar</button></div></div>`;
}

function fmtEta(sec) { if (sec < 60) return 'menos de 1 min'; const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`; }
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
async function installNow(key, torrent, picked, where) {
  picked = picked || [...document.querySelectorAll('.files input:checked')].map(i => i.value);
  const r = await api.post('/api/install', { key, files: picked.length ? picked : null, torrent, dest: where && where.dest || '', remember: !!(where && where.remember) });
  if (r.error) { toast('err', 'Não foi possível concluir', r.error); return; }
  if (r.browser) { toast('ok', 'Abrindo no navegador', 'O download continua no navegador. Quando terminar: Adicionar → Jogo de Windows.'); return; }
  if (r.external) { toast('ok', 'Magnet enviado ao cliente de torrent', 'Quando terminar de baixar: Adicionar → Jogo de Windows (ou arraste o arquivo para Store).'); return; }
  if (r.free && r.need && r.free < r.need) toast('', 'Pouco espaço', `Livre: ${fmt(r.free)} · recomendado ~${fmt(r.need)}. A instalação continua mesmo assim.`);
  S.jobs[key] = { stage: 'download', fraction: 0, detail: 'Iniciando…' }; $('#dlDot').classList.add('on');
  if (S.det && S.det.key === key) renderDetail(); pollSoon();
}
async function play(key, after, emulator, optimize, force) {
  const mode = S.config.after_launch || 'ask';
  if (!after && mode === 'ask') return askAfter(key);
  S._after = after;
  if (optimize === undefined) optimize = S._optimize; S._optimize = undefined;
  busyCursor(true); const busyT = setTimeout(() => busyCursor(false), 8000);
  const r = await api.post('/api/play', { key, after: after || undefined, emulator: emulator || undefined, optimize, force: force || undefined }).catch(() => ({ error: 'offline' }));
  clearTimeout(busyT); if (r.ok) { setTimeout(() => busyCursor(false), 2500); launchShow(key); } else busyCursor(false);
  if (r.missing) return missingDialog(key, r);
  if (r.running) return toast('warn', 'Já está aberto', (S.byKey[key] || {}).title || '', [{ label: 'Encerrar o jogo', fn: () => stopGame(key) }, { label: 'OK', fn: () => {} }]);
  if (r.need_mc_launcher) return mcNeedLauncher(r); if (r.mc_missing === 'bedrock') return mcNeedBedrock(r);
  if (r.choose_emulator) { S._optimize = optimize; return chooseEmulator(key, r.choose_emulator, r.default); } if (r.error === 'emu_missing') { modal({ title: 'Emulador necessário', text: r.message, ok: 'Ir para Emuladores', cancel: 'Não fazer nada', onOk: () => setView('emulation') }); } else if (r.error) toast('err', 'Não foi possível abrir', r.error); else { toast('ok', 'Jogo aberto', r.hint || (r.tracked ? 'Contando o tempo de jogo…' : '')); S.sessions = S.sessions || {}; S.sessions[key] = { since: Date.now() / 1000 }; applyPlaying(); if (S.det && S.det.key === key) renderDetail(); pollSoon(); } }

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
  ED.key = key; ED.info = info; ED.tab = tab === 'meta' ? 'geral' : (tab || 'geral'); ED.probe = null;
  ED.form = { title: info.title, system: info.system, developer: info.developer, publisher: info.publisher, year: info.year, genres: info.genres.join(', '), summary: info.summary, series: info.series, modes: info.modes, notes: info.notes,
    links: info.links.map(l => ({ ...l })), cover_url: info.cover_url && info.cover_src === 'manual' ? info.cover_url : '', hero_url: info.user.includes('hero_url') ? info.hero_url : '', background_file: info.background_file || '',
    exe: info.exe, dir: info.dir, args: info.args, workdir: info.workdir, version: info.version, emulator: info.emulator, fav: info.fav, unlock_title: false,
    admin: !!info.admin, pre_cmd: info.pre_cmd || '', post_cmd: info.post_cmd || '' };
  modal({ title: 'Editar detalhes do jogo', wide: true, html: `<div class="ged"><div class="tabs" id="edTabs"></div><div class="gedb" id="edBody"></div></div>`, ok: 'Salvar', cancel: 'Cancelar', extra: 'Baixar metadados…',
    onExtra: () => edProbeMenu(), onOk: () => edSave() });
  $('#modalBox').classList.add('ged-box');
  edRender();
}
function edSet(k, v) { ED.form[k] = v; }
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
        <div class="row">${i.native ? `<button class="btn s xs" onclick="edPickCover()">${I.image} Escolher imagem…</button>` : ''}<button class="btn s xs" onclick="edWebCovers()" title="Procura imagens com o nome do jogo no Google Imagens, Bing e Yandex e deixa você escolher a capa">${I.search} Procurar capa na web…</button>${i.custom_cover ? `<button class="btn s xs" onclick="resetCover(ED.key).then(()=>editGame(ED.key,'midia'))">${I.refresh} Remover a minha</button>` : ''}</div>
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
      ${i.installed && !isRom ? `<div class="row" style="margin-top:6px"><button class="btn s xs" onclick="api.post('/api/open',{path:ED.form.dir})">${I.folder} Abrir pasta</button>${i.kind === 'pc' || i.kind === 'local' ? `<button class="btn s xs" onclick="api.post('/api/shortcut/desktop',{key:ED.key}).then(r=>toast(r.error?'err':'ok','Atalho',r.error||'Criado na área de trabalho'))">${I.win} Atalho na área de trabalho</button>` : ''}</div>` : ''}
    </div>`;
  } else if (ED.tab === 'acoes') {
    const isRom = i.kind === 'rom'; const ex = ARG_HINTS[(f.title || '').length % ARG_HINTS.length];
    h = `<div class="g1">
      ${isRom ? row('ROM', `<input class="mi" value="${esc(i.exe)}" disabled>`) : row('Executável', `<div class="grow">${inp('exe', 'C:\\Jogos\\MeuJogo\\game.exe')}${i.native ? `<button class="btn s xs" onclick="edPick('exe','exe')" title="Procurar">${I.folder}</button><button class="btn s xs" onclick="api.post('/api/open', {path: (ED.form.exe || '').replace(/[\\\\/][^\\\\/]*$/, '')})" title="Abrir a pasta do executável">${I.ext}</button>` : ''}<button class="btn s xs" onclick="edListExes()" title="Listar os .exe da pasta do jogo">${I.search}</button></div>`, 'O arquivo que abre o jogo. Atalhos de loja (steam://…) também valem.')}
      ${row('Argumentos', inp('args', 'ex.: ' + ex), 'O que vai depois do .exe — igual ao campo "Destino" de um atalho do Windows.')}
      <div class="chips">${ARG_HINTS.slice(0, 7).map(a => `<button class="chip" onclick="ED.form.args=((ED.form.args||'')+' ${esc(a)}').trim();edRender()">${esc(a)}</button>`).join('')}</div>
      ${isRom ? '' : row('Pasta de trabalho', `<div class="grow">${inp('workdir', 'vazio = pasta do executável')}${i.native ? `<button class="btn s xs" onclick="edPick('folder','workdir')">${I.folder}</button>` : ''}</div>`, 'Alguns jogos antigos só acham seus arquivos se abertos "de dentro" de uma pasta específica.')}
    </div><p class="ghelp">${isRom ? 'Os argumentos vão para o emulador, depois do caminho da ROM.' : 'Cada jogo aceita coisas diferentes: -dx12 força DirectX 12, -windowed abre em janela, -skipintro pula os logos. Procure "launch options" + nome do jogo.'}</p>
    ${isRom || !i.installed ? '' : `<div class="g1" style="margin-top:12px">
      ${row('Administrador', `<label class="remember" style="margin:0"><input type="checkbox" ${f.admin ? 'checked' : ''} onchange="edSet('admin',this.checked)"> Abrir como administrador (o Windows pede permissão a cada abertura)</label>`, 'Para jogos antigos que só funcionam com permissão de administrador. O tempo de jogo continua sendo contado.')}
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
  setTimeout(() => modal({ title: 'Baixar metadados de…', text: `Procuro por "${ED.form.title}" em uma fonte só e mostro o que achei antes de aplicar.`, noOk: true, cancel: 'Voltar',
    html: `<div class="mlist">${i.sources.map(s => `<button onclick="edProbe('${s.id}')">${esc(s.name)}</button>`).join('')}</div>`, onCancel: () => editGame(ED.key, ED.tab) }), 50);
}
async function edProbe(source) {
  modal({ title: 'Buscando…', text: 'Perguntando à fonte…', noOk: true, noCancel: true });
  const r = await api.post('/api/edit/probe', { key: ED.key, source, title: ED.form.title });
  if (r.error) return modal({ title: 'Nada encontrado', text: r.error, noOk: true, cancel: 'Voltar', onCancel: () => edProbeMenu() });
  const name = r.canonical_title || r.wiki_title || r.steam_name || r.gog_name || r.sgdb_name || r.libretro_name || '';
  const fields = [['title', 'Nome', name], ['developer', 'Desenvolvedora', r.developer], ['publisher', 'Publicadora', r.publisher], ['year', 'Ano', r.year], ['genres', 'Gêneros', (r.genres || []).join(', ')], ['series', 'Série', r.series], ['modes', 'Modos', r.modes], ['summary', 'Descrição', r.summary], ['cover', 'Capa', r.cover_url && 'imagem encontrada'], ['hero', 'Fundo', r.hero_url && 'imagem encontrada']].filter(x => x[2]);
  const SRC_NAME = { steam: 'Steam', gog: 'GOG', wikipedia: 'Wikipedia', steamgriddb: 'SteamGridDB', libretro: 'boxart de console', web: 'imagens da web' };
  modal({ title: `Encontrado em ${SRC_NAME[source] || source}`, wide: true, ok: 'Aplicar marcados', cancel: 'Voltar', onCancel: () => edProbeMenu(),
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
  modal({ title: 'Procurando na web…', text: `${kind === 'hero' ? 'Imagens largas' : 'Capas'} para "${ED.form.title}" no Google Imagens, Bing e Yandex.`, noOk: true, noCancel: true });
  const r = await api.post('/api/edit/webcovers', { key: ED.key, title: ED.form.title, kind });
  if (r.error) return modal({ title: 'Nada encontrado', text: r.error, noOk: true, cancel: 'Voltar', onCancel: () => edReopen('midia') });
  ED.web = r.hits; ED.webKind = kind; ED.webThumb = '';
  modal({ title: kind === 'hero' ? 'Escolha o fundo' : 'Escolha a capa', text: `Clique na imagem. Ela é baixada ao salvar e fica guardada com o jogo${kind === 'hero' ? ' (fundo da página do jogo e do palco)' : ''}.`, wide: true, noOk: true, cancel: 'Voltar', onCancel: () => edReopen('midia'),
    html: `<div class="gweb${kind === 'hero' ? ' wide' : ''}">${r.hits.map((h, n) => `<button class="gwc" onclick="edWebPick(${n})" title="${esc(h.title || '')}${h.w ? ' · ' + h.w + '×' + h.h : ''}"><img src="${esc(h.thumb || h.url)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.style.display='none'"><span>${h.w ? h.w + '×' + h.h : ''}</span></button>`).join('')}</div>` });
  $('#modalBox').classList.add('ged-box');
}
function edWebPick(n) {
  const h = (ED.web || [])[n]; if (!h) return;
  if (ED.webKind === 'hero') { ED.form.hero_url = h.url; ED.form.hero_page = h.page || ''; ED.heroThumb = h.thumb || ''; edReopen('midia', 'Fundo escolhido'); return; }
  ED.form.cover_url = h.url; ED.form.cover_page = h.page || '';
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
  const n = d?.crash_count || 1, isRom = key.startsWith('rom:') || d?.kind === 'rom';
  modal({ title: `${title} não abriu`, wide: true, html: `<p>${esc(why)}</p><p class="mut" style="font-size:12px">${n > 1 ? `Já é a ${n}ª vez seguida. ` : ''}O que costuma resolver, nesta ordem:</p>
    <ol class="steps"><li>Instalar os <b>Redists</b> (Visual C++, DirectX, .NET) na aba Ferramentas.</li><li>${isRom ? 'Conferir BIOS/keys do emulador e abrir a ROM direto nele.' : 'Abrir a pasta e rodar o executável direto — se pedir algo, o erro aparece lá.'}</li><li><b>Apagar e adicionar de novo</b>: remove a entrada${isRom || d?.kind === 'local' ? '' : ' e a pasta'} e baixa/importa de novo, limpo.</li></ol>`,
    ok: 'Apagar e adicionar de novo', danger: true, onOk: () => confirmUninstall(key),
    cancel: 'Não fazer nada', buttons: [{ label: 'Abrir pasta', fn: () => api.post('/api/open', { path: d?.dir || '' }) }, { label: 'Redists', fn: () => setView('mods') }] });
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
  modal({ title: 'Cópias da biblioteca', wide: true, text: 'Restaurar adiciona os jogos que estão na cópia e não estão mais na biblioteca. Nada é removido ou sobrescrito.', html: `<div class="diag">${rows}</div>`, ok: 'Fechar', noCancel: true, extra: 'Criar cópia agora', onExtra: libraryBackupNow, buttons: [{ label: 'Abrir pasta', fn: () => api.post('/api/open', { path: l[0].path.replace(/[\\/][^\\/]+$/, '') }) }] });
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
async function gameDirAdd() { const r = await api.post('/api/dirs/add', {}); if (r.error) return toast('err', 'Não foi possível adicionar', r.error); if (r.native === false || (!r.ok && !r.dirs)) return modal({ title: 'Outra pasta com jogos', text: 'Digite o caminho completo (modo navegador não tem diálogo nativo).', input: '', ok: 'Adicionar', onOk: async v => { if (!v) return; const x = await api.post('/api/dirs/add', { path: v }); if (x.error) return toast('err', 'Não foi possível adicionar', x.error); S.config.game_dirs = x.dirs; renderSettings(true); } }); if (r.dirs) { S.config.game_dirs = r.dirs; renderSettings(true); if (r.dup) toast('', 'Essa pasta já está na lista', ''); } }
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
    : `<div class="impg scrow ${g.dup ? 'dup' : ''}"><input type="checkbox" data-i="${i}" ${g.dup ? '' : 'checked'}><div class="t"><input class="mi sm" data-t="${i}" value="${esc(g.title)}" title="Nome (edite se quiser)"><small>${esc(g.exe.replace(SC.path, '…'))} · ${fmt(g.size)}${g.alt_exes.length ? ` · +${g.alt_exes.length} outro(s) .exe` : ''}</small></div>${g.alt_exes.length ? `<select class="mi sm" data-x="${i}" title="Qual .exe abre o jogo">${[g.exe, ...g.alt_exes].map(x => `<option value="${esc(x)}">${esc(x.split(/[\\/]/).pop())}</option>`).join('')}</select>` : ''}<span class="pill ${g.confidence === 'alta' ? 'ok' : ''}" title="Confiança de que este .exe é o jogo">${g.confidence}</span>${g.dup ? '<span class="pill warn">já tem</span>' : ''}</div>`;
  const bulk = mode === 'roms' ? `<div class="scbulk"><b>Pra todos de uma vez:</b><select class="mi sm" id="scAllSys" onchange="scanAll('s',this.value)">${sysOpts('')}</select><select class="mi sm" id="scAllEmu" onchange="scanAll('e',this.value)">${emuOpts('', '')}</select><label class="chk"><input type="checkbox" id="scAddDir" checked> Lembrar esta pasta em Emuladores (novas ROMs entram sozinhas)</label></div>` : `<div class="scbulk"><b>Dica:</b> o nome vem da pasta e é refinado pelos metadados depois; se o .exe escolhido estiver errado, troque no menu da linha ou depois em <i>Atalho</i>.</div>`;
  const html = `<div class="imphead"><span>${mode === 'roms' ? pl(items.length, 'ROM', 'ROMs') : pl(items.length, 'jogo', 'jogos')} em <span class="code">${esc(SC.path)}</span> · ${items.filter(g => g.dup).length} já na biblioteca</span><span style="flex:1"></span><button class="btn s sm" onclick="document.querySelectorAll('.scrow input[type=checkbox]').forEach(c=>c.checked=true)">Marcar todos</button><button class="btn s sm" onclick="document.querySelectorAll('.scrow input[type=checkbox]').forEach(c=>c.checked=false)">Desmarcar</button></div>${bulk}<div class="impgames">${items.map(row).join('')}</div>`;
  modal({ title: mode === 'roms' ? 'Revisar ROMs encontradas' : 'Revisar jogos encontrados', html, ok: 'Adicionar selecionados', extra: '← Outra pasta', onExtra: () => scanPick(mode), wide: true, onOk: async () => {
    const sel = [];
    document.querySelectorAll('.scrow input[type=checkbox]:checked').forEach(c => { const i = +c.dataset.i, g = { ...items[i] }; const t = document.querySelector(`[data-t="${i}"]`); if (t && t.value.trim()) g.title = t.value.trim();
      if (mode === 'roms') { const sSel = document.querySelector(`[data-s="${i}"]`), eSel = document.querySelector(`[data-e="${i}"]`); g.system = sSel ? sSel.value : g.system; g.emulator = eSel ? eSel.value : ''; }
      else { const x = document.querySelector(`[data-x="${i}"]`); if (x) g.exe = x.value; } sel.push(g); });
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
    <button class="btn s" onclick="api.post('/api/open',{path:${jsq(e.games_root)}})" title="Abrir emulation${SEP()}games">${I.folder} ROMs</button>
    <button class="btn s" onclick="api.post('/api/open',{path:${jsq(e.bios_dir)}})" title="Abrir a pasta de BIOS">${I.folder} BIOS</button>
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
    return `<div class="tile ${s.installed ? 'ok' : ''} ${quiet ? 'quiet' : ''}" data-sys="${s.id}"><div class="tt">${sysIcon(s.id)}<b title="${esc(s.name)}">${esc(s.name)}</b>${s.installed ? `<span class="pill ok">pronto${nInst > 1 ? ` · ${nInst}` : ''}</span>` : '<span class="pill">sem emulador</span>'}${em.update ? `<span class="pill warn" title="Versão ${esc(em.update)} disponível">${esc(em.update)}</span>` : ''}${s.bios ? '<span class="pill warn" title="Este sistema precisa de BIOS na pasta BIOS">BIOS</span>' : ''}<button class="ib" title="Emuladores deste console, pasta de ROMs e extensões" onclick="sysEmus('${s.id}')">${I.cog}</button></div>
      <div class="tm">${opts.length > 1 ? `<select onchange="api.post('/api/emulator/select',{system:'${s.id}',id:this.value}).then(renderEmulation)">${opts.map(o => `<option value="${o.id}" ${o.id === s.emulator ? 'selected' : ''}>${esc(o.title)}${o.custom ? ' (meu)' : ''}</option>`).join('')}</select>` : `<span>${esc(s.emulator_title)}</span>`}<span>·</span><span>${s.rom_count} ${s.rom_count === 1 ? 'jogo' : 'jogos'}</span>${(() => { const nb = S.games.filter(g => g.system === s.id && g.kind === 'rom' && g.repo === 'local' && !g.installed).length; return nb ? `<span>·</span><a href="#" style="color:var(--amber)" title="ROMs da biblioteca cujo arquivo não foi encontrado" onclick="closeDetail();setView('home');setTimeout(()=>{clearFlt();S.flt.sys.add('${s.id}');S.flt.flags.add('broken');renderLibrary()},80);return false">${pl(nb, 'não encontrada', 'não encontradas')}</a>` : ''; })()}</div>
      <div class="tm"><span class="mono" title="${esc(dirs.join('\n'))}">${esc(dirs[0])}${dirs.length > 1 ? ` +${dirs.length - 1}` : ''}</span><span class="sp"></span><button class="lnk" style="font-size:11.5px" onclick="addRomDir('${s.id}')">+ pasta de ROMs</button></div>
      <div class="tm"><span title="Para onde vão os downloads de ROM deste console">${I.dl}</span><span class="mono" title="${esc(s.dest || s.games_dir)}">${esc(s.dest ? s.dest.split(/[\\/]/).slice(-2).join(SEP()) : `games${SEP()}${s.id}`)}</span><span class="sp"></span><button class="lnk" style="font-size:11.5px" onclick="romDestMenu(this,'${s.id}')">Baixar em…</button></div>
      ${job ? progHtml(job, 'emu:' + s.emulator) : `<div class="ta">${s.installed ? `${em.update && !isCustom && !em.pointed ? `<button class="btn p" title="Baixa a versão ${esc(em.update)} por cima; configurações e saves do emulador ficam" onclick="updateEmu('${s.emulator}')">${I.dl} Atualizar</button>` : ''}<button class="btn s" title="Abrir o emulador sem jogo, para configurar controles/BIOS" onclick="api.post('/api/emulator/open',{id:'${s.emulator}'})">${I.cog} Abrir</button><button class="btn s ico" title="Pasta do emulador" onclick="api.post('/api/open',{path:${jsq((em.exe_path || '').replace(/[\\/][^\\/]+$/, ''))}})">${I.folder}</button>${isCustom ? `<button class="btn d ico" title="Remover este emulador" onclick="removeCustomEmu('${s.emulator}')">${I.trash}</button>` : em.pointed ? `<button class="btn d ico" title="Esquecer o .exe apontado" onclick="api.post('/api/emulator/exe',{id:'${s.emulator}',exe:null}).then(renderEmulation)">${I.x}</button>` : `<button class="btn d ico" title="Remover" onclick="removeEmu('${s.emulator}')">${I.trash}</button>`}` : isCustom ? `<span class="pill warn">exe não encontrado</span>` : em.source === 'manual' ? `<button class="btn ${quiet ? 's' : 'p'}" onclick="api.post('/api/open_url',{url:${jsq(em.homepage || '')}})">${I.ext} Baixar no site</button><button class="btn s" title="Se você já tem esse emulador, só aponte o .exe" onclick="pointEmuExe('${s.emulator}')">Já tenho</button>` : `<button class="btn ${quiet ? 's' : 'p'}" onclick="installEmu('${s.emulator}')">${I.dl} Instalar ${esc(s.emulator_title)}</button><button class="btn s" title="Se você já tem esse emulador instalado, só aponte o .exe" onclick="pointEmuExe('${s.emulator}')">Já tenho</button>`}
        <button class="btn s ico" title="Abrir a pasta de ROMs" onclick="api.post('/api/open',{path:${jsq(s.games_dir)}})">${I.folder}</button></div>`}</div>`;
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
    ${list.length ? '<div class="grid" id="grid"></div><div class="pager" id="pager"></div>' : `${S.q ? emptyHtml(I.search, 'Nenhuma ROM com esse nome', 'Tente outro termo ou outro console.', [['Limpar busca', 'clearSearch()', 1]]) : `<div class="empty" style="padding:24px 0"><b>Carregando as fontes…</b>As listas do archive.org chegam em alguns segundos.</div>`}`}`;
  $('#view').innerHTML = h;
  if (list.length) fillPaged(list);
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
function chooseEmulator(key, opts, def) {
  modal({ title: 'Jogar com qual emulador?', text: 'Este console tem mais de um emulador instalado.', noOk: true, cancel: 'Cancelar', html: `<div class="askrow">${opts.map(o => `<button onclick="$('#modal').classList.remove('on');if($('#emuRem').checked)api.post('/api/game/emulator',{key:${jsq(key)},emulator:'${o.id}'});play(${jsq(key)}, S._after, '${o.id}')">${I.gamepad}<div><b>${esc(o.title)}</b><small>${o.id === def ? 'padrão deste console' : 'alternativo'}</small></div></button>`).join('')}</div>
    <label class="remember"><input type="checkbox" id="emuRem"> Lembrar só para este jogo (é possível trocar no menu do jogo → "Jogar com…")</label>
    <label class="remember"><input type="checkbox" onchange="setCfg({emu_no_ask:this.checked})"> Nunca perguntar — usar sempre o padrão do console</label>` });
  setTimeout(() => gpFocusFirst('.askrow button'), 50);
}
async function updateEmu(id) { const r = await api.post('/api/emulator/update', { id }); if (r.error) return toast('err', 'Não foi possível atualizar', r.error); S.jobs['emu:' + id] = { stage: 'download', fraction: 0, detail: 'Iniciando…' }; $('#dlDot').classList.add('on'); renderEmulation(); pollSoon(); }
async function installEmu(id) { const r = await api.post('/api/emulator/install', { id }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); S.jobs['emu:' + id] = { stage: 'download', fraction: 0, detail: 'Iniciando…' }; $('#dlDot').classList.add('on'); renderEmulation(); pollSoon(); }
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
      : `${i.can_retry ? `<button class="btn p xs" onclick="qAct('retry',${jsq(i.key)})">${i.status === 'paused' ? 'Retomar' : 'Tentar de novo'}</button>` : ''}${i.dir ? `<button class="btn s xs" onclick="api.post('/api/open',{path:${jsq(i.dir)}})">${I.folder} Pasta</button>` : ''}${g && i.installed ? `<button class="btn s xs" onclick="openGame(${jsq(i.key)})">Abrir</button>` : ''}<button class="btn s xs" onclick="qAct('remove',${jsq(i.key)})" title="Tira da lista">✕</button>`;
    return `<div class="item q ${cls}"><div class="ic">${g ? `<img src="/thumb/${enc(i.key)}" onerror="this.remove()">` : I.dl}</div><div class="tx"><b>${esc(i.title)}</b><span><em class="qst ${cls}">${lbl}</em> · ${KIND[i.kind] || i.kind} · ${when(i.at)}${i.message ? ` · ${esc(i.message)}` : ''}</span>${i.job ? progHtml(i.job, i.key) : ''}</div><div class="qa">${acts}</div></div>`;
  };
  let h = `<div class="h1"><h2>Fila</h2><span>${running.length ? `${running.length} em andamento` : 'nada baixando agora'}${rest.length ? ` · ${rest.length} no histórico` : ''}</span><div class="acts"><button class="btn p xs" onclick="linkDownload()">${I.dl} Baixar de link</button>${running.length ? `<button class="btn s xs" onclick="qAct('clear_all')">Parar tudo</button>` : ''}${rest.length ? `<button class="btn s xs" onclick="qAct('clear')">Limpar histórico</button>` : ''}<button class="btn s xs" onclick="api.post('/api/open',{path:${jsq(S.config.downloads_dir || 'downloads')}})">${I.folder} downloads\\</button></div></div>`;
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
async function qAct(action, key) {
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
function themesHtml(c, themes) {
    const cur = c.theme || 'system';
    const tv = t => `${t.id}:${(t.builtin ? c.accent : '') || ''}`;
    S._tsel = S._tsel || new Set(); const selMode = S._tselMode;
    const card = t => `<div class="theme ${cur === t.id ? 'on' : ''} ${selMode && S._tsel.has(t.id) ? 'sel' : ''} ${selMode && t.builtin ? 'nosel' : ''}" onclick="${selMode ? `themeSel(${jsq(t.id)},${!!t.builtin})` : `pickTheme(${jsq(t.id)})`}" title="${esc(t.description || (t.author ? 'por ' + t.author : ''))}" data-theme="${esc(t.id)}">
        <div class="prev img" style="background-image:url('/api/theme/${enc(t.id)}/preview?v=${enc(tv(t))}')"></div>
        <div class="tn">${t.builtin ? '' : `<i class="tdot" style="background:${esc(t.accent || 'var(--muted2)')}" title="${t.scheme === 'light' ? 'Tema claro' : 'Tema escuro'} · ${esc(themeHue(t))}"></i>`}${esc(t.name)}${t.official ? `<i class="toff" title="Tema oficial do Ludrix (assinado)">${I.shield}</i>` : ''}</div>${t.layout ? `<small>${esc(LAYOUT_NAMES[t.layout] || t.layout)}</small>` : t.builtin ? '' : '<small>&nbsp;</small>'}
        ${t.builtin ? '' : `<div class="tacts"><button title="Exportar (.lxtheme ou .zip)" onclick="event.stopPropagation();themeExportMenu(${jsq(t.id)},event)">${I.ext}</button><button title="Apagar" class="dng" onclick="event.stopPropagation();themeDelete(${jsq(t.id)},${jsq(t.name)})">${I.trash}</button></div>`}</div>`;
    const user = themes.filter(t => !t.builtin), onFace = !cur.startsWith('file:'), curFace = c.face || DEFAULT_FACE;
    const faceCard = f => `<div class="theme ${onFace && curFace === f.id ? 'on' : ''}" onclick="pickFace(${jsq(f.id)})" title="${esc(f.description || '')}" data-face="${esc(f.id)}">
        <div class="prev img" style="background-image:url('/api/theme/${enc(f.id)}/preview?v=${enc(c.accent || '')}')"></div>
        <div class="tn">${esc(f.name)}</div><small>${esc(LAYOUT_NAMES[f.layout] || 'barra onde você escolher')}</small></div>`;
    const tf = S._tf = S._tf || { scheme: '', color: '', cat: '' };
    const cats = [...new Set(user.map(themeCat))].sort((a, b) => a.localeCompare(b, 'pt'));
    const cols = [...new Set(user.map(themeHue))].sort((a, b) => HUE_ORDER.indexOf(a) - HUE_ORDER.indexOf(b));
    const shown = user.filter(t => (!tf.scheme || (t.scheme === 'light' ? 'light' : 'dark') === tf.scheme) && (!tf.color || themeHue(t) === tf.color) && (!tf.cat || themeCat(t) === tf.cat)).sort((a, b) => a.name.localeCompare(b.name, 'pt'));
    const tsel = (k, opts, ph) => selHtml([['', ph], ...opts.map(o => Array.isArray(o) ? o : [o, o])], tf[k], `S._tf.${k}=JSON.parse(this.value);renderSettings()`);
    const filt = user.length ? `<div class="tfilt">${tsel('scheme', [['dark', 'Escuros'], ['light', 'Claros']], 'Claros e escuros')}${tsel('color', cols, 'Todas as cores')}${cats.length > 1 ? tsel('cat', cats, 'Todos os estilos') : ''}<span class="mut">${shown.length} de ${user.length}</span></div>` : '';
    const grp = list => list.length ? `<div class="themes">${list.map(card).join('')}</div>` : `<p class="mut" style="margin:10px 0">Nenhum tema com esses filtros.</p>`;
    const selBar = user.length ? `<div class="tselbar">${selMode ? `<b>${S._tsel.size} selecionado${S._tsel.size === 1 ? '' : 's'}</b><button class="btn s xs" onclick="themeSelGroup(${jsq(shown.map(t => t.id).join('|'))})">marcar os filtrados</button><button class="btn d sm" ${S._tsel.size ? '' : 'disabled'} onclick="themeDeleteSel()">${I.trash} Apagar selecionados</button><button class="btn s sm" onclick="S._tselMode=false;S._tsel.clear();renderSettings()">Cancelar</button>` : `<button class="btn s sm" onclick="S._tselMode=true;renderSettings()">${I.trash} Apagar vários…</button>`}</div>` : '';
    return `
  <div class="sec"><h3>Tema ${help('Cada tema define cores, formas, capas e a posição da barra. Todos têm versão clara e escura. A barra de navegação segue o tema; a opção em Layout › Barra de navegação vale por cima.')}</h3><p>Clique para aplicar. A miniatura mostra a versão escura e a clara lado a lado.</p>
    <div class="themes">${(S.faces || []).map(faceCard).join('')}</div>
    <div class="frow" style="margin-top:14px"><div class="l"><b>Claro ou escuro</b><span><b style="display:inline;font-size:12px">Sistema</b> acompanha o ${OSN()}${onFace ? '' : '. Um estilo importado feito escuro pode ser usado claro, e vice-versa: o Ludrix recalcula as cores'}</span></div>
      ${onFace ? cfgSel('theme', [['system', 'Sistema'], ['dark', 'Escuro'], ['light', 'Claro']], c.theme || 'system') : cfgSel('theme_mode', [['', 'Como o tema foi feito'], ['system', 'Sistema'], ['dark', 'Escuro'], ['light', 'Claro']], c.theme_mode || '')}</div>
    ${onFace && (c.theme || 'system') === 'system' ? `<div class="frow"><div class="l"><b>Quando "Sistema"</b><span>Seguir o ${OSN()} troca junto com o modo claro/escuro dele; por horário, você define quando o claro entra e sai</span></div><div class="ta" style="gap:6px;align-items:center">
      ${cfgSel('theme_schedule', [[false, 'Seguir o ' + OSN()], [true, 'Por horário']], !!c.theme_schedule)}${c.theme_schedule ? `<span class="mut">claro das</span><input class="mi" type="time" value="${esc(c.theme_light_from || '07:00')}" style="width:auto" onchange="setCfg({theme_light_from:this.value}).then(applyTheme)"><span class="mut">às</span><input class="mi" type="time" value="${esc(c.theme_light_to || '19:00')}" style="width:auto" onchange="setCfg({theme_light_to:this.value}).then(applyTheme)">` : ''}</div></div>` : ''}
  </div>
  <div class="sec"><h3>Estilos importados ${help('Um estilo importado substitui o tema inteiro (cores e, às vezes, barra, menu do botão direito e ponteiro). Importe um .lxtheme ou .zip, crie o seu ou exporte para enviar a alguém.')}</h3><p>Clique para aplicar; para voltar, escolha uma aparência acima.</p>
    ${filt}${selBar}${grp(shown)}
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn p sm" onclick="themeImport()">${I.import} Importar .lxtheme / .zip / .json</button><button class="btn s sm" onclick="themeDuplicate(S.config.theme||'dark')">${I.copy} Criar a partir do tema atual</button>${user.length ? `<button class="btn s sm" onclick="themeExportAll()">${I.ext} Exportar todos (.zip)</button>` : ''}<button class="btn s sm" onclick="api.post('/api/open',{path:'themes'})">${I.folder} Abrir pasta themes</button></div>
  </div>`;
}
function selHtml(opts, cur, on, cls) { return `<select class="sel ${cls || ''}" onchange="${on}">${opts.map(([v, l]) => `<option value="${esc(JSON.stringify(v))}" ${v === cur ? 'selected' : ''}>${esc(String(l))}</option>`).join('')}</select>`; }
function cfgSel(key, opts, cur, after) { return selHtml(opts, cur, `setCfg({${key}:JSON.parse(this.value)})${after || ''}`); }
function gmWhen(v) { v = JSON.parse(v); setCfg({ game_mode_auto: v === 'auto', game_mode_ask: v !== 'off' }).then(renderCentral); }
function settingsTab(id, jump) { S.tab.settings = id; if (jump) S._settingsJump = jump; if (id === 'appearance' && !(S.config.start_done || []).includes('look')) startGo('look'); renderSettings(); }
async function cset(patch) { const r = await api.post('/api/custom/set', patch); if (r.error) return toast('err', 'Personalizar', r.error); S.custom = r; applyCustom(); if (S.view === 'settings' && S.tab.settings === 'custom') renderSettings(); }
async function cpick(what, path) { if (!path && !S.config.native) return modal({ title: 'Imagem', text: 'Caminho completo do arquivo de imagem:', input: '', ok: 'Usar', onOk: v => v && cpick(what, v) }); const r = await api.post(path ? '/api/custom/add' : '/api/custom/pick', path ? { what, path } : { what }); if (r.error) return toast('err', 'Personalizar', r.error); if (r.cancel) return; S.custom = r; applyCustom(); renderSettings(); }
async function cremove(what, name) { const r = await api.post('/api/custom/remove', { what, name }); if (r.error) return toast('err', 'Personalizar', r.error); S.custom = r; applyCustom(); renderSettings(); }
function creset() { modal({ title: 'Redefinir o Personalizar?', text: 'Volta tudo ao que o tema define. Suas imagens de fundo e ícones enviados continuam na pasta data\\custom.', ok: 'Redefinir', danger: true, onOk: async () => { const r = await api.post('/api/custom/reset', {}); S.custom = r; applyCustom(); renderSettings(); } }); }
function cexport() { modal({ title: 'Exportar como tema', text: 'Nome do tema. O arquivo .lxtheme vai para a pasta themes\\exportados e pode ser importado em qualquer Ludrix.', input: 'Meu tema', ok: 'Exportar', onOk: async name => { if (!name) return false; const r = await api.post('/api/custom/export', { name }); if (r.error) return toast('err', 'Exportar', r.error); toast('ok', 'Tema exportado', r.path, [{ label: 'Abrir pasta', fn: () => api.post('/api/open', { path: r.path.replace(/[\\/][^\\/]*$/, '') }) }]); } }); }
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
    <div class="frow"><div class="l"><b>Estilo dos ícones</b><span>Os conjuntos de ícones ficam em Aparência › Navegação</span></div><button class="btn s xs" onclick="settingsTab('appearance','Navegação')">Abrir</button></div>
  </div>
  <div class="sec"><h3>Janela e barra de tarefas</h3>
    ${S.config.os === 'windows' ? `<div class="frow"><div class="l"><b>Barra de título</b><span>Vale com "Janela sem moldura do Windows" ligada (Aparência)</span></div>${seg('window.titlebar', [['normal', 'Normal'], ['compact', 'Compacta'], ['tall', 'Alta']], win.titlebar || 'normal')}</div>` : ''}
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
async function renderSettings(fresh) {
  if (fresh || !S._set) S._set = await Promise.all([api.get('/api/themes/full'), api.get('/api/cache'), api.get('/api/repos'), S.hw ? Promise.resolve(S.hw) : api.get('/api/hardware')]);
  const [themes, cache, repos, hw] = S._set;
  S.themes = themes; S.hw = hw; if (S.view !== 'settings') return;
  if ((S.tab.settings || 'general') === 'custom' && !S.custom) S.custom = await api.get('/api/custom');
  if ((S.tab.settings || 'general') === 'custom' && !S.fonts) S.fonts = ((await api.get('/api/fonts')) || {}).fonts || [];
  const keepScroll = $('#view').scrollTop;
  const c = S.config; const tab = S.tab.settings || 'general';
  const sw = (k, label, desc) => `<div class="frow"><div class="l"><b>${label}${restartTag(k)}</b><span>${desc}</span></div><button class="sw ${c[k] ? 'on' : ''}" onclick="setCfg({${k}:!S.config.${k}})"></button></div>`;
  const TABS = [
    ['general', 'Geral', 'cog', ['idioma', 'janela_geral', 'notificacoes', 'orientacao']],
    ['appearance', 'Aparência', 'image', ['tema', 'janela', 'navegacao', 'escala', 'efeitos', 'personalizar_link']],
    ['custom', 'Personalizar', 'edit', []],
    ['library', 'Biblioteca', 'home', ['tela_inicial', 'cartoes', 'capas', 'pastas']],
    ['play', 'Ao jogar', 'play', ['ao_abrir', 'saves', 'otimizar', 'emuladores', 'controle', 'console']],
    ['store', 'Store e downloads', 'dl', ['fontes', 'store', 'instalacao', 'torrent']],
    ['tools', 'Ferramentas', 'wrench', ['verificar', 'importar', 'exportar', 'metadados', 'dados', 'diagnostico', 'limpeza']],
    ['system', 'Sistema', 'cpu', ['pc', 'segundo_plano', 'atualizacoes', 'avancado', 'perigo', 'sobre']],
  ];
  S._settingsTabs = TABS;
  const TAB_MAP = { updates: 'system', about: 'system', downloads: 'store' }; if (TAB_MAP[S.tab.settings]) { S._settingsJump = S._settingsJump || (S.tab.settings === 'updates' ? 'Atualizações' : S.tab.settings === 'about' ? 'Sobre' : ''); S.tab.settings = TAB_MAP[S.tab.settings]; }
  const sec = (id, title, rows, o = {}) => { const main = rows.filter(Boolean).join(''), adv = (o.adv || []).filter(Boolean).join(''); if (!main && !adv) return ''; return `<div class="sec${o.cls ? ' ' + o.cls : ''}${!main ? ' advonly' : ''}" id="s-${id}" data-sec="${esc(title)}"><h3>${title}${o.help ? ' ' + help(o.help) : ''}</h3>${o.p ? `<p>${o.p}</p>` : ''}${main}${adv ? `<div class="adv">${adv}</div>` : ''}</div>`; };
  const accents = ['#2f80ed', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#eab308', '#f97316', '#8b5cf6'];
  const SEC = {
    idioma: () => sec('idioma', 'Idioma', [`
    <div class="frow"><div class="l"><b>Idioma do launcher${restartTag('language')}</b><span>Idioma dos textos da interface: Português (Brasil) ou English.</span></div>
      <select class="mi" style="width:auto;min-width:200px" onchange="setCfg({language:this.value})">${[['pt-BR', 'Português (Brasil)'], ['en', 'English']].map(([v, l]) => `<option value="${v}" ${(c.language || 'pt-BR') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`]),
    janela_geral: () => sec('janela_geral', 'Abrir e fechar', [`
    <div class="frow"><div class="l"><b>Abrir com o ${OSN()}</b><span>Inicia junto com o sistema, recolhido na bandeja</span></div><button class="sw ${c.autostart ? 'on' : ''}" onclick="setAutostart(!S.config.autostart)"></button></div>
    ${sw('tray_enabled', 'Ícone na bandeja', 'Mantém o launcher acessível ao lado do relógio quando recolhido. Botão direito no ícone: jogar um dos últimos jogos, ir direto a uma tela, ver a fila, verificar atualizações ou sair. Desligado, ele apenas minimiza para a barra de tarefas')}
    <div class="frow"><div class="l"><b>Ao fechar a janela</b><span>${{ ask: 'Mostra as opções ao clicar no X e memoriza a escolha.', tray: 'Sai da barra de tarefas e fica no ícone ao lado do relógio.', quit: 'Fecha por completo, inclusive o ícone da bandeja.' }[c.close_action || 'ask']} Com um jogo aberto e a bandeja ligada, o Ludrix apenas se recolhe para continuar contando o tempo.</span></div>${cfgSel('close_action', [['ask', 'Perguntar'], ['tray', 'Bandeja'], ['quit', 'Encerrar']], c.close_action || 'ask')}</div>
    ${c.tray_enabled === false ? '<p>Sem o ícone na bandeja, o X sempre encerra o launcher.</p>' : ''}`]),
    notificacoes: () => sec('notificacoes', 'Notificações', [`
    ${sw('popups', 'Avisos dentro do app', 'Download concluído, erros e pendências aparecem como cartão no canto; o sino guarda o histórico')}
    ${sw('notify_sound', 'Som ao concluir download', 'Um aviso sonoro curto quando um jogo termina de instalar')}`]),
    orientacao: () => sec('orientacao', 'Orientação', [`
    ${sw('guides', 'Balões de orientação', 'Na primeira vez que você usa cada parte do Ludrix, balões curtos explicam cada parte. Somem ao terminar e não repetem')}
    <div class="frow"><div class="l"><b>"Comece por aqui" na Biblioteca</b><span>Lista curta dos primeiros passos (fonte, jogo, aparência, dependências); some sozinha quando tudo estiver feito</span></div><button class="sw ${!c.start_hide ? 'on' : ''}" onclick="setCfg({start_hide:!S.config.start_hide})"></button></div>
    <div class="frow"><div class="l"><b>Rever os guias</b><span>Volta a mostrar os balões de todas as telas, como no primeiro uso${(c.guides_done || []).length ? ` · ${(c.guides_done || []).length} já vistos` : ''}</span></div><button class="btn s sm" onclick="guidesReset()">${I.refresh} Rever</button></div>
    <div class="frow" style="margin-top:12px"><div class="l"><b>Tour de boas-vindas</b><span>As telas da primeira abertura</span></div><button class="btn s sm" onclick="welcomeTour()">Ver de novo</button></div>`]),
    tema: () => themesHtml(c, themes) + sec('accent', 'Cor de destaque', [`
    <div class="frow"><div class="swatches"><div class="swatch mono ${!c.accent ? 'on' : ''}" title="Cor do tema (padrão)" style="${themeAccent ? `background:${themeAccent}` : ''}" onclick="setCfg({accent:''})"></div>${accents.map(a => `<div class="swatch ${c.accent === a ? 'on' : ''}" style="background:${a}" onclick="setCfg({accent:'${a}'})"></div>`).join('')}<label class="swatch custom" title="Cor personalizada" style="background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red)"><input type="color" value="${c.accent || '#7c5cff'}" onchange="setCfg({accent:this.value})"></label></div></div>`], { p: 'Cada aparência tem a sua cor para botões, seleção e abas. Escolha outra aqui para prevalecer sobre a aparência e sobre qualquer tema.' }),
    janela: () => sec('janela', 'Janela', [`
    ${S.config.os === 'windows' ? sw('frameless', 'Janela sem moldura do Windows', 'A barra de título segue o tema, com os botões de minimizar, maximizar e fechar desenhados pelo launcher. Vale após reabrir.') : ''}
    ${S.config.os === 'windows' && c.native ? `<div class="frow"><div class="l"><b>Moldura do Windows</b><span>${c.frameless ? 'Com a janela sem moldura, vale para a borda fina e os cantos' : 'Barra de título, texto e borda da janela'} no tom do tema. No Windows 10 só o claro/escuro acompanha</span></div>${cfgSel('frame_mode', [['theme', 'No tom do tema'], ['windows', 'Padrão do Windows']], c.frame_mode || 'theme')}</div>
    <div class="frow"><div class="l"><b>Cantos da janela</b><span>Windows 11. "Padrão" deixa o sistema decidir</span></div>${cfgSel('frame_corners', [['', 'Padrão'], ['round', 'Arredondados'], ['small', 'Levemente arredondados'], ['square', 'Retos']], c.frame_corners || '')}</div>` : ''}
    <div class="frow"><div class="l"><b>Barra de status</b><span>A linha com o estado atual e a contagem de jogos</span></div>
      ${cfgSel('status_position', [['bottom', 'No rodapé'], ['top', 'Abaixo das categorias']], c.status_position || 'bottom')}</div>
    <div class="frow"><div class="l"><b>Relógio na barra de status</b><span>Útil com a janela sem moldura ou em tela cheia, quando a barra do Windows some</span></div>${cfgSel('clock', [['off', 'Desligado'], ['time', 'Hora'], ['datetime', 'Dia e hora']], c.clock || 'off')}</div>
    `], { adv: [`
    ${c.native && c.frameless ? `<div class="frow"><div class="l"><b>Menus do botão direito</b><span>O menu do Windows passa da borda da janela (como em qualquer programa) e é desenhado com as cores do tema, sem ícones; o do Ludrix fica dentro da janela, com ícones${S.themeMenu ? ` · o tema atual pede <b style="display:inline">${S.themeMenu === 'ludrix' ? 'Menu do Ludrix' : 'Menu do Windows'}</b>` : ''}</span></div>
      ${cfgSel('ctx_menu', [['', 'Seguir o tema (padrão: Windows)'], ['windows', 'Menu do Windows'], ['ludrix', 'Menu do Ludrix']], c.ctx_menu || '')}</div>` : ''}`] }),
    navegacao: () => sec('navegacao', 'Navegação', [`
    <div class="frow"><div class="l"><b>Barra de navegação</b><span>Posição do menu principal. <b style="display:inline;font-size:12px">Seguir o tema</b> deixa o tema decidir${themeLayout ? ` (o atual pede: ${esc(LAYOUT_NAMES[themeLayout] || themeLayout)})` : ''}; qualquer outra escolha prevalece sobre o tema.</span></div>${cfgSel('layout', LAYOUTS, c.layout || '')}</div>
    <div class="frow" style="align-items:flex-start;flex-direction:column;gap:8px"><div class="l"><b>Abas</b><span>Arraste para mudar a ordem e desligue o que você não usa. O que estiver desligado continua acessível pela busca e pelo menu do logo.</span></div>
    <div class="navedit" id="navEdit">${navOrder().map(v => { const it = NAV_ITEMS.find(x => x[0] === v), hid = (c.nav_hidden || []).includes(v), svg = ($('#rail .rb[data-view="' + v + '"] svg') || {}).outerHTML || ''; return `<div class="nrow${hid ? ' off' : ''}" draggable="true" data-v="${v}" ondragstart="navDrag(event)" ondragover="navOver(event)" ondragleave="this.classList.remove('dt','db')" ondrop="navDrop(event)"><i class="grip">${I.dots}</i><span class="ic">${svg}</span><b>${esc(it[1])}</b>${v === 'home' ? '<small>sempre visível</small>' : `<button class="sw ${hid ? '' : 'on'}" onclick="navToggle(${jsq(v)})"></button>`}</div>`; }).join('')}</div>
    ${(c.nav_order || []).length || (c.nav_hidden || []).length ? `<button class="btn s xs" style="margin-top:10px" onclick="setCfg({nav_order:[],nav_hidden:[]})">Restaurar padrão</button>` : ''}</div>
    <div class="frow" style="align-items:flex-start;flex-direction:column;gap:8px"><div class="l"><b>Ícones da navegação</b><span>Estilo dos ícones de Biblioteca, Store, Emuladores e das demais abas. Os dois últimos são coloridos${S.themeIcons ? ` · o tema atual ${typeof S.themeIcons === 'object' ? 'traz ícones próprios' : `sugere <b style="display:inline">${esc((ICON_SETS.find(x => x[0] === S.themeIcons) || [])[1] || S.themeIcons)}</b>`}` : ''}</span></div>
      <div class="iconsets">${ICON_SETS.map(([v, l]) => `<button class="iset ${(c.rail_icons || S.themeIcons || 'solid') === v ? 'on' : ''}" onclick="setCfg({rail_icons:'${v}'})"><div class="ico">${iconSetSample(v)}</div><b>${l}</b></button>`).join('')}${c.rail_icons && S.themeIcons && c.rail_icons !== S.themeIcons ? `<button class="iset" onclick="setCfg({rail_icons:''})"><div class="ico" style="font-size:20px">↺</div><b>Seguir o tema</b></button>` : ''}</div></div>
    <div class="frow" style="align-items:flex-start"><div class="l"><b>Barra de tarefas</b><span>A faixa no alto com busca, categoria, ordenação e notificações. O que for desmarcado continua acessível pelo botão Filtros e pela tecla /</span></div><div class="checks">${TOOLBAR_ITEMS.map(([id, l, d]) => `<label><input type="checkbox" ${(c.toolbar_items || ['search', 'cats', 'sort', 'bell']).includes(id) ? 'checked' : ''} onchange="toggleToolbarItem('${id}',this.checked)"><div>${l}<small>${d}</small></div></label>`).join('')}</div></div>`]),
    escala: () => sec('escala', 'Escala da interface', [`
    <div class="frow"><div class="l"><b>Zoom</b><span id="uiScaleLbl">${c.ui_scale ? Math.round(c.ui_scale * 100) + '%' : 'Auto (' + Math.round(autoScale() * 100) + '%)'}</span></div>
      ${cfgSel('ui_scale', [[0, 'Automático'], ...[0.8, 0.9, 1, 1.1, 1.25, 1.5].map(v => [v, Math.round(v * 100) + '%'])], c.ui_scale || 0)}</div>
    <div class="frow"><div class="l"><b>Tamanho do texto</b><span>Só as letras, sem mexer no resto. Bom para ler de longe sem aumentar tudo</span></div>${cfgSel('text_size', [[-2, 'Bem menor'], [-1, 'Menor'], [0, 'Normal'], [1, 'Maior'], [2, 'Bem maior']], c.text_size || 0)}</div>
    <div class="frow"><div class="l"><b>Tamanho das capas</b><span>O mesmo controle disponível ao lado das listas</span></div><label class="zoom"><input type="range" min="100" max="300" step="10" value="${c.card_size || 136}" oninput="setCardSize(this.value,false)" onchange="setCardSize(this.value,true)"></label></div>
    <div class="frow"><div class="l"><b>Densidade</b><span>Compacto aproxima os cartões e reduz espaçamentos; útil em telas pequenas</span></div>${cfgSel('density', [['normal', 'Normal'], ['compact', 'Compacto']], c.density || 'normal')}</div>`], { p: 'Ajusta o tamanho de textos, botões e capas para qualquer tela, de um notebook 1366×768 a uma TV 4K. <b>Auto</b> acompanha o tamanho da janela.' }),
    efeitos: () => sec('efeitos', 'Efeitos', [`
    <div class="frow"><div class="l"><b>Formas flutuando ao fundo</b><span>Não pesa no PC. "Leve" mostra menos; "Desligado" remove tudo</span></div>
      ${cfgSel('animations', [['full', 'Completo'], ['light', 'Leve'], ['off', 'Desligado']], c.animations || 'full')}</div>
    ${(c.animations || 'full') !== 'off' ? `<div class="frow"><div class="l"><b>O que flutua</b></div>
      ${cfgSel('fx_type', [['controls', 'Botões A/B/X/Y'], ['geometric', 'Formas'], ['gaming', 'Gaming'], ['symbols', 'Símbolos'], ['mix', 'Tudo']], c.fx_type || 'controls')}</div>
    <div class="frow"><div class="l"><b>Quantidade</b><span><span id="fxLbl">${c.fx_intensity ?? 10}</span> — 0 esconde, 16 enche a tela</span></div><label class="zoom" style="flex:1;max-width:320px"><input type="range" min="0" max="16" step="1" value="${c.fx_intensity ?? 10}" oninput="$('#fxLbl').textContent=this.value;S.config.fx_intensity=+this.value;applyAnim()" onchange="setCfg({fx_intensity:+this.value})"></label></div>` : ''}
    ${sw('glass', 'Efeito de vidro', 'Painéis translúcidos com brilhos suaves ao fundo. Desligue para um fundo liso')}
    ${S.themePlx ? `<div class="frow"><div class="l"><b>Parallax</b><span>O fundo deste tema desliza de leve acompanhando o mouse, dando profundidade. Quase não pesa; desligue se preferir o fundo parado</span></div><button class="sw ${c.parallax !== false ? 'on' : ''}" onclick="setCfg({parallax:!(S.config.parallax!==false)})"></button></div>` : ''}
    <div class="frow"><div class="l"><b>Capas ao passar o mouse</b><span>Elevar é o padrão; Inclinar acompanha o mouse em 3D; Brilho acende a borda na cor de destaque</span></div>${cfgSel('card_hover', [['lift', 'Elevar'], ['tilt', 'Inclinar'], ['glow', 'Brilho'], ['none', 'Nenhum']], c.card_hover || 'lift')}</div>
    ${sw('reduce_motion', 'Reduzir movimento', 'Corta transições, formas flutuantes, animação do splash e efeitos das capas de uma vez. Liga sozinho quando o sistema pede menos movimento')}
    ${sw('high_contrast', 'Alto contraste', 'Bordas e textos mais fortes, sem transparência nem desfoque, foco bem marcado. Liga sozinho quando o Windows está em modo de alto contraste')}`]),
    personalizar_link: () => sec('personalizar_link', 'Personalizar tudo', [`
    <button class="btn p sm" onclick="settingsTab('custom')">${I.edit} Abrir o Personalizar</button>`], { p: 'Cores, transparência, fundo, animação com seus próprios ícones, cantos, fonte, barra e cartões: cada detalhe do visual, por cima de qualquer tema.' }),
    tela_inicial: () => sec('tela_inicial', 'Tela inicial', [`
    ${sw('home_spot', 'Jogo em foco no alto da Biblioteca', 'Destaca acima das capas o último jogo aberto ou o mais recente; cada tema tem o próprio estilo de destaque. Desligado, a Biblioteca mostra apenas a grade de capas')}
    ${c.home_spot !== false ? sw('home_autoplay', 'Passar os cinco sorteados sozinho', 'A cada 7 segundos o destaque muda para o próximo dos cinco jogos sorteados, como um slide. Clicar numa capa segura por um tempo; o dado sorteia outros cinco.') : ''}
    ${c.home_spot !== false ? `<div class="frow"><div class="l"><b>Estilo do destaque</b><span>Cada tema tem o seu; um estilo escolhido aqui vale para todos</span></div>${cfgSel('home_spot_style', STAGE_STYLES, c.home_spot_style || 'auto')}</div>` : ''}
    <div class="frow"><div class="l"><b>Fileiras acima de "Todos os jogos"</b><span>Linhas horizontais com as capas de cada grupo. Uma fileira só aparece quando tem jogos; arraste para mudar a ordem</span></div></div>
    <div class="navedit" id="rowEdit">${HOME_ROWS.map(([id, l]) => [id, l, (c.home_rows || []).indexOf(id)]).sort((a, b) => (a[2] < 0 ? 99 : a[2]) - (b[2] < 0 ? 99 : b[2])).map(([id, l, k]) => `<div class="nrow${k < 0 ? ' off' : ''}" draggable="true" data-v="${id}" ondragstart="navDrag(event)" ondragover="navOver(event)" ondragleave="this.classList.remove('dt','db')" ondrop="rowDrop(event)"><i class="grip">${I.dots}</i><b>${l}</b><button class="sw ${k < 0 ? '' : 'on'}" onclick="rowToggle(${jsq(id)})"></button></div>`).join('')}</div>
    <div class="frow"><div class="l"><b>Fundo acompanha o jogo</b><span>Mostra a capa (ou a arte larga, quando o jogo tem) atrás de tudo, desfocada e escurecida como você preferir</span></div>${cfgSel('game_backdrop', [['', 'Desligado'], ['cover', 'Capa do jogo'], ['hero', 'Arte larga do jogo']], c.game_backdrop || '')}</div>
    ${c.game_backdrop ? `<div class="frow"><div class="l"><b>Desfoque</b><span id="bdbLbl">${c.backdrop_blur ?? 10}px</span></div><label class="zoom" style="flex:1;max-width:320px"><input type="range" min="0" max="60" step="2" value="${c.backdrop_blur ?? 10}" oninput="$('#bdbLbl').textContent=this.value+'px';S.config.backdrop_blur=+this.value;gameFocus(S._focusKey||S.stageKey)" onchange="setCfg({backdrop_blur:+this.value})"></label></div>
    <div class="frow"><div class="l"><b>Escurecer</b><span id="bddLbl">${c.backdrop_dim ?? 42}%</span></div><label class="zoom" style="flex:1;max-width:320px"><input type="range" min="0" max="95" step="5" value="${c.backdrop_dim ?? 42}" oninput="$('#bddLbl').textContent=this.value+'%';S.config.backdrop_dim=+this.value;gameFocus(S._focusKey||S.stageKey)" onchange="setCfg({backdrop_dim:+this.value})"></label></div>` : ''}
    ${sw('accent_from_cover', 'Cor de destaque puxada da capa', 'Botões, seleção e abas mudam para a cor predominante da capa do jogo selecionado. Ao sair da Biblioteca, volta a cor de destaque normal')}
    ${sw('cover_slideshow', 'Capas como papel de parede rotativo', 'Na Biblioteca, as capas dos seus jogos instalados passam devagar ao fundo, com o mesmo desfoque e escurecimento acima. Se "Fundo acompanha o jogo" estiver ligado, o rotativo entra só quando nenhum jogo está selecionado')}
    ${c.cover_slideshow ? `<div class="frow"><div class="l"><b>Troca a cada</b></div>${cfgSel('cover_slideshow_secs', [[15, '15 segundos'], [30, '30 segundos'], [45, '45 segundos'], [60, '1 minuto'], [120, '2 minutos'], [300, '5 minutos']], c.cover_slideshow_secs || 45)}</div>` : ''}`], { p: 'O alto da Biblioteca e o que acontece ao selecionar um jogo. Fundo e cor pela capa vêm desligados para não gastar placa de vídeo.' }),
    cartoes: () => sec('cartoes', 'Cartões e listas', [`
    <div class="frow"><div class="l"><b>Biblioteca e Store</b><span>Grade mostra as capas; lista mostra uma linha por jogo com ano, gênero, tamanho, tempo jogado e última vez. O botão ao lado do zoom alterna também</span></div>${cfgSel('view_mode', [['grid', 'Grade de capas'], ['list', 'Lista']], c.view_mode || 'grid')}</div>
    <div class="frow"><div class="l"><b>Agrupar por</b><span>Cabeçalhos recolhíveis na Biblioteca e na Store; a ordenação vale dentro de cada grupo. Também no menu de ordenar</span></div>${cfgSel('group_by', GROUPS, c.group_by || '')}</div>
    ${sw('fav_first', 'Favoritos primeiro', 'Mantém os favoritos no topo da lista em qualquer ordenação')}
    ${sw('card_ribbons', 'Fitas "Novo" e "Hoje" nas capas', '"Novo" marca jogos instalados há menos de 7 dias que você ainda não abriu; "Hoje" marca os que você jogou hoje')}
    ${sw('card_playtime', 'Tempo jogado sobre a capa', 'Um selo discreto no canto da capa com as horas (ou minutos) que você já jogou')}
    <div class="frow"><div class="l"><b>Arte de fundo nos detalhes</b><span>A imagem larga do jogo atrás do cabeçalho da tela de detalhes</span></div>${cfgSel('detail_art', [['auto', 'Automática — nítida quando o jogo tem arte, desfocada quando só tem capa'], ['sharp', 'Sempre nítida'], ['blur', 'Sempre desfocada'], ['off', 'Desligada']], c.detail_art || 'auto')}</div>`]),
    capas: () => sec('capas', 'Capas e informações', [`
    ${sw('auto_metadata', 'Buscar capas e metadados automaticamente', 'Procura capa, descrição, ano e gêneros na Steam, GOG e Wikipedia (e no SteamGridDB, se houver chave). Para consoles, usa as capas oficiais de cada sistema. Roda em segundo plano e não repete buscas')}
    ${sw('web_covers', 'Capa por busca de imagens na web', 'Quando Steam, GOG, Wikipedia e as capas de console não têm o jogo, procura no Google Imagens, Bing e Yandex e usa a melhor imagem vertical. Útil para mods e jogos raros; pode errar, e a capa pode ser trocada na edição do jogo')}
    ${sw('auto_rename', 'Corrigir nomes automaticamente', 'Ao encontrar o jogo nas fontes, substitui nomes como "Atalho para Sleeping Dogs" ou "SleepingDogs_x64" pelo nome oficial. Só renomeia quando o nome encontrado bate com segurança (mesmo título e mesma numeração); em dúvida, mantém o atual. Nomes digitados por você nunca são alterados')}`], { adv: [`
    <div class="frow"><div class="l"><b>Chave SteamGridDB ${help('SteamGridDB é um site com capas e artes em alta resolução feitas pela comunidade. Pra usar, crie uma conta grátis lá, vá em Perfil → Preferences → API e copie a chave que aparece.')}</b><span>Opcional. Capas e artes em alta resolução ${c.sgdb_key_set ? '· <span style="color:var(--green2)">configurada</span>' : ''}</span></div><input type="password" placeholder="cole a chave" onchange="setCfg({sgdb_key:this.value})" style="min-width:220px"></div>`] }),
    pastas: () => sec('pastas', 'Pastas', [`
    <div class="frow"><div class="l"><b>Pasta de jogos instalados</b><span>Destino definitivo dos jogos baixados e extraídos. Atual: ${esc(c.games_dir_effective)}</span></div><button class="btn s sm" onclick="api.post('/api/open',{path:${jsq(c.games_dir_effective)}})">${I.folder} Abrir</button><button class="btn s sm" onclick="chooseFolder()">Alterar</button>${c.games_dir ? `<button class="btn s sm" onclick="setCfg({games_dir:''})">Padrão</button>` : ''}</div>
    <div class="frow"><div class="l"><b>Outras pastas com jogos</b><span>Pastas de outros discos ou de outros launchers. O Ludrix procura jogos novos nelas (e na pasta de instalados) ao abrir e no botão abaixo.${(c.game_dirs || []).length ? '' : ' Nenhuma adicionada.'}</span>${(c.game_dirs || []).length ? `<div class="dirlist">${c.game_dirs.map(d => `<div><code>${esc(d)}</code><button class="btn s xs" onclick="api.post('/api/open',{path:${jsq(d)}})">${I.folder}</button><button class="btn s xs" onclick="gameDirRemove(${jsq(d)})">${I.x}</button></div>`).join('')}</div>` : ''}</div><button class="btn s sm" onclick="gameDirAdd()">${I.plus} Adicionar pasta</button><button class="btn s sm" onclick="scanRun('windows','*')">${I.search} Procurar jogos novos</button></div>
    ${sw('auto_scan_dirs', 'Procurar jogos novos ao abrir', 'Alguns segundos depois de abrir, o Ludrix olha as pastas acima e avisa se achou jogo que ainda não está na biblioteca. Nada é adicionado sem revisão')}
    <div class="frow"><div class="l"><b>Pasta de downloads (temporária)</b><span>Os arquivos chegam em <code>downloads${SEP()}</code>, são extraídos ou instalados e essa pasta é limpa sozinha. O que sobrar de downloads cancelados é apagado quando o Ludrix abre.</span></div><button class="btn s sm" onclick="api.post('/api/open',{path:${jsq(c.downloads_dir || 'downloads')}})">${I.folder} Abrir</button><button class="btn s sm" onclick="api.post('/api/downloads/clean',{}).then(r=>toast('ok','Pasta limpa',(r.freed_h||'')+(r.skipped?' · '+r.skipped+' em uso':'')))">Limpar agora</button></div>`]),
    ao_abrir: () => sec('ao_abrir', 'Ao abrir um jogo', [`
    <div class="frow"><div class="l"><b>Ao abrir um jogo</b><span>${{ ask: 'Pergunta antes de abrir (com opção de lembrar).', none: 'Continua visível normalmente.', minimize: 'Sai da barra de tarefas e volta quando o jogo fechar.', close: 'Fecha por completo; o tempo de jogo desta sessão não é contado.' }[c.after_launch || 'ask']} O tempo de jogo é contado enquanto o processo do jogo estiver em execução.</span></div>${cfgSel('after_launch', [['ask', 'Perguntar'], ['none', 'Manter'], ['minimize', 'Bandeja'], ['close', 'Fechar']], c.after_launch || 'ask')}</div>
    <div class="frow"><div class="l"><b>Apresentação ao abrir um jogo</b><span>Uma tela rápida com a capa e o nome enquanto o jogo carrega. Clique ou Esc fecham antes</span></div>${cfgSel('launch_splash', [['off', 'Desligada'], ['short', 'Curta'], ['long', 'Longa']], c.launch_splash || 'short')}</div>
    ${sw('track_external', 'Contar tempo de jogos abertos fora do Ludrix', 'Quando um jogo da biblioteca é aberto pela Steam, por um atalho ou direto pelo .exe, o Ludrix percebe e conta o tempo do mesmo jeito. Checa os processos a cada 15 s; não interfere no jogo')}
    ${sw('nav_hide_playing', 'Esconder a barra de navegação enquanto um jogo está aberto', 'A barra se recolhe quando você abre um jogo e volta quando ele fecha. Para vê-la no meio do jogo, encoste o mouse na borda onde ela fica')}`]),
    saves: () => sec('saves', 'Saves', [`
    ${sw('save_auto_backup', 'Guardar cópia dos saves ao fechar o jogo', `Depois de cada sessão, copia a pasta de saves do jogo para data${SEP()}save_backups (até 5 cópias por jogo, só quando algo mudou; pastas acima de 512 MB são puladas). Restaure em Saves, no menu do jogo`)}`]),
    otimizar: () => sec('otimizar', 'Otimizar antes de jogar', [`
    ${sw('game_mode_auto', 'Ativar em todo jogo', 'Plano de energia de desempenho, prioridade alta para o jogo e o Ludrix em silêncio, sem perguntar')}
    ${sw('game_mode_ask', 'Oferecer "Otimizar e abrir" no menu do jogo', 'Aparece no menu do botão direito do jogo, para ativar apenas quando quiser')}
    <div class="frow"><div class="l"><b>Ações e programas fechados</b><span>Configure na Central Ludrix, em "Otimizar antes de jogar"</span></div><button class="btn s sm" onclick="setView('gamemode')">${I.bolt} Abrir</button></div>`]),
    emuladores: () => sec('emuladores', 'Emuladores', [`
    ${sw('emu_no_ask', 'Não perguntar qual emulador', 'Em consoles com mais de um emulador instalado, usa sempre o padrão em vez de perguntar ao jogar')}`]),
    controle: () => sec('controle', 'Controle', [`
    ${sw('gamepad_enabled', 'Navegar com controle', 'Direcional ou analógico move, A abre, B volta, X abre o menu de opções, Y busca, LB/RB trocam de aba, LT/RT ou analógico direito rolam a página, Start joga o jogo em foco, Back volta à Biblioteca. Em listas e controles deslizantes, A entra no ajuste e o direcional muda o valor')}
    ${sw('gamepad_wake', 'Controle chama o launcher', 'Ao conectar um controle, ou segurar o botão Guide/Xbox por 1 s, o launcher sai da bandeja e vem para a frente. Mantém um monitor leve do controle enquanto o Ludrix estiver aberto')}`], { adv: [`
    <div class="frow"><div class="l"><b>Velocidade do cursor</b><span>Ritmo de repetição ao segurar o direcional. "Lento" é o mais preciso</span></div>
      ${cfgSel('gamepad_speed', [['slow', 'Lento'], ['normal', 'Normal'], ['fast', 'Rápido']], c.gamepad_speed || 'normal')}</div>`] }),
    console: () => sec('console', 'Modo Console', [`
    <div class="frow"><div class="l"><b>Tela cheia da janela</b><span>F11 alterna a tela cheia desta janela, sem sair dela</span></div><button class="btn s sm" onclick="toggleFullscreen()">${FS.on ? 'Sair da tela cheia' : 'Tela cheia agora'}</button></div>
    <button class="btn p sm" onclick="openConsole()">${I.gamepad} Abrir o Modo Console</button>`], { p: 'Um programa à parte, pensado para a TV: ocupa o monitor inteiro, mostra só os jogos instalados numa esteira de capas e tem temas próprios. Funciona com controle, teclado ou mouse. Ao abrir, esta janela fecha; lá dentro, "Voltar para a janela" reabre o Ludrix normal.' }),
    fontes: () => sec('fontes', 'Fontes de jogos', [`
    <button class="btn s sm" onclick="S.tab.store='sources';setView('store')">Abrir Store → Fontes</button>`], { p: `${repos.length} fontes configuradas (${repos.filter(r => r.enabled).length} ativas). Adicionar, ativar e remover fica na <b>Store → Fontes</b>.` }),
    store: () => sec('store', 'Store', [`
    ${sw('hero_enabled', 'Destaque rotativo na Store', 'O banner com um jogo em destaque no topo da Store')}
    ${sw('store_hide_installed', 'Store só mostra o que falta baixar', 'Jogo baixado some da Store e fica só na Biblioteca. Se você remover pelo launcher, ele volta para Store')}
    ${sw('dim_not_installed', 'Escurecer jogos não baixados', 'Na Store, os jogos dos repositórios que você ainda não instalou aparecem apagados')}`], { adv: [`
    <div class="frow"><div class="l"><b>Jogos por página na Store</b><span>Menos por página = mais leve. Você navega com os botões no fim da lista</span></div>${cfgSel('store_page_size', [25, 50, 100, 200].map(v => [v, v + ' jogos']), c.store_page_size || 25)}</div>`] }),
    instalacao: () => sec('instalacao', 'Instalação', [`
    ${sw('keep_archive', 'Manter arquivo compactado', 'Guarda o arquivo baixado (.zip/.7z) na pasta downloads depois de instalar. Ocupa espaço, mas evita um novo download')}
    <div class="frow"><div class="l"><b>Downloads simultâneos</b></div>${cfgSel('concurrent_downloads', [1, 2, 3, 4].map(v => [v, String(v)]), c.concurrent_downloads || 2)}</div>
    ${sw('shortcut_ask', 'Oferecer atalho na área de trabalho', 'Quando um jogo baixado termina de extrair e está pronto para jogar, pergunta se deseja um atalho. Não se aplica a instaladores (repack), importados nem ROMs')}
    ${sw('repack_auto_open', 'Abrir o instalador de repacks automaticamente', 'Quando um repack (FitGirl, DODI, ElAmigos…) termina de baixar, o instalador abre em seguida. Desligado, fica como pendência nas notificações')}`]),
    torrent: () => `
  ${S.torrent ? `<div class="sec"><h3>Torrent</h3><p>Usado quando o item oferece magnet ou .torrent. Limites em KB/s (0 = sem limite).</p>
    <div class="frow"><div class="l"><b>Download máx.</b></div><input type="number" value="${c.torrent_max_down || 0}" onchange="setCfg({torrent_max_down:+this.value})" style="min-width:110px"></div>
    <div class="frow"><div class="l"><b>Upload máx.</b></div><input type="number" value="${c.torrent_max_up || 0}" onchange="setCfg({torrent_max_up:+this.value})" style="min-width:110px"></div>
    ${sw('torrent_seed_after', 'Continuar semeando', 'Mantém o torrent ativo depois do download, enquanto o launcher estiver aberto')}</div>` : `<div class="sec"><h3>Torrent</h3><p>Esta versão não inclui download por torrent. Links magnet abrem no seu cliente de torrent (qBittorrent e similares).</p></div>`}`,
    verificar: () => sec('verificar', 'Verificar jogos', [`
    <div class="frow"><div class="l"><b>Procurar jogos que sumiram</b><span>Confere se a pasta, o executável ou a ROM de cada jogo ainda existem. Para os que mudaram de lugar, dá para apontar a pasta nova sem perder capa, tempo jogado e saves${S.config.last_lib_check ? ` · última verificação ${ago(S.config.last_lib_check)}` : ''}</span></div><button class="btn s sm" onclick="libraryCheck()">${I.search} Verificar</button></div>
    <div class="frow"><div class="l"><b>Jogos duplicados</b><span>Procura entradas com o mesmo nome ou o mesmo executável, comum depois de importar de dois lugares. A remoção não apaga arquivos do disco</span></div><button class="btn s sm" onclick="libraryDupes()">${I.search} Procurar</button></div>
    <div class="frow"><div class="l"><b>Cópias da biblioteca</b><span>A lista de jogos (library.json) é copiada uma vez por dia em <span class="code">data${SEP()}backups</span>; ficam as últimas 7 diárias e as 10 últimas feitas à mão. Restaurar traz de volta o que sumiu e recupera tempo de jogo zerado, sem apagar o que existe hoje</span></div><button class="btn s sm" onclick="libraryBackups()">${I.doc} Ver cópias</button></div>
    <div class="frow"><div class="l"><b>Avisar ao abrir</b><span>Mostra um aviso ao iniciar quando algum jogo da biblioteca está com arquivo não encontrado</span></div><button class="sw ${S.config.warn_missing !== false ? 'on' : ''}" onclick="setCfg({warn_missing:!(S.config.warn_missing!==false)})"></button></div>`]),
    importar: () => sec('importar', 'Importar de outro launcher', [`
    <button class="btn p sm" onclick="importWizard()">${I.import} Importar biblioteca…</button>`], { p: 'Traz sua biblioteca do Playnite (pasta ou backup .zip), Heroic, Steam, Epic, GOG Galaxy, RetroBat / EmulationStation, LaunchBox, Pegasus ou atalhos da área de trabalho. Você confere a lista antes de adicionar.' }),
    exportar: () => sec('exportar', 'Exportar biblioteca', [`
    <button class="btn s sm" onclick="exportLibrary()">${I.doc} Exportar agora</button>
    <div class="frow"><div class="l"><b>Enviar para a Steam</b><span>Cria os atalhos "não-Steam" com capa; os jogos aparecem na Steam e no Big Picture. A Steam precisa estar fechada. Rodar de novo atualiza os atalhos do Ludrix e não mexe nos outros</span></div><button class="btn s sm" onclick="exportSteam()">${I.ext} Enviar…</button></div>`], { p: 'Gera uma pasta em <span class="code">downloads\\</span> com a lista de jogos, metadados e capas em quatro formatos: pacote para o Playnite (<span class="code">playnite\\LudrixImport.pext</span>: dois cliques nele, depois menu Extensões › Ludrix › Importar), JSON completo do Ludrix, planilha CSV (Excel) e o <span class="code">library.json</span> de jogos avulsos do Heroic Games Launcher.', help: 'Para voltar a biblioteca inteira num Ludrix novo, use "Meus dados › Exportar meus dados" (zip com tudo). "Exportar biblioteca" serve para levar os jogos a outro programa: o pacote do Playnite leva nome, capa, pasta, executável, tempo jogado, favoritos, gênero, ano e desenvolvedora; jogos já importados são atualizados, não duplicados. ROMs entram com o arquivo preenchido e o emulador é escolhido no Playnite. Playnite 11 em diante não aceita o pacote (sem PowerShell): aí vale o CSV.' }),
    metadados: () => sec('metadados', 'Capas e informações', [`
    <div class="frow"><div class="l"><b>Atualizar metadados de tudo</b><span>Refaz capa, nome e informações de toda a biblioteca. Roda em segundo plano; a barra de status mostra o andamento</span></div><button class="btn s sm" onclick="api.post('/api/metadata/refetch_all',{}).then(r=>toast(r.ok?'ok':'err', r.ok?'Atualizando…':'Não foi possível concluir', r.ok?'Acompanhe pela barra de status. Você será avisado ao terminar.':r.error))">${I.refresh} Atualizar tudo</button></div>`]),
    dados: () => sec('dados', 'Meus dados', [`
    <div class="frow"><div class="l"><b>Exportar meus dados</b><span>Gera Ludrix-dados-&lt;data&gt;.zip. Guarde antes de formatar, trocar de PC ou mexer em algo delicado</span></div><button class="btn s sm" onclick="dataExport()">${I.dl} Exportar…</button></div>
    <div class="frow"><div class="l"><b>Importar um backup</b><span>Escolha um Ludrix-dados-*.zip. O conteúdo é listado antes de aplicar</span></div><button class="btn s sm" onclick="dataImport()">${I.folder} Importar…</button></div>`], { help: 'O backup é um zip com configurações, biblioteca (com tempo jogado e favoritos), capas personalizadas, fontes, temas importados, cópias de saves e jogos rápidos adicionados por você. Não inclui os jogos em si nem caches. Importar substitui o que existe hoje pelo que está no zip e reabre o Ludrix — antes disso, o estado atual é guardado em data/updates.' }),
    diagnostico: () => sec('diagnostico', 'Diagnóstico', [`
    <div class="frow"><div class="l"><b>Diagnóstico</b><span>Confere pasta, espaço em disco, WebView2, ferramentas e mostra o fim do log — copie e cole quando algo der errado</span></div><button class="btn s sm" onclick="showDiag()">Ver diagnóstico</button></div>`]),
    limpeza: () => sec('limpeza', 'Limpeza', [`
    <div class="cache" id="cacheBox">${[['web', 'Listas das fontes'], ['thumbs', 'Miniaturas'], ['covers', 'Capas grandes'], ['meta', 'Informações dos jogos'], ['downloads', 'Downloads incompletos'], ['log', 'Registro de erros']].map(([k, n]) => `<label><input type="checkbox" value="${k}"><div><b>${n}</b><span>${fmt(cache[k]) || '0 B'}</span></div></label>`).join('')}</div>
    <div style="margin-top:12px;display:flex;gap:8px"><button class="btn d sm" onclick="clearCache()">${I.trash} Limpar selecionados</button><button class="btn s sm" onclick="api.post('/api/open',{path:${jsq(c.root)}})">${I.folder} Abrir pasta do app</button></div>`], { cls: 'wide', help: 'Tudo o que o launcher guarda aqui (capas, listas, informações) serve apenas para abrir mais rápido. Pode apagar sem receio: é baixado de novo quando necessário. Seus jogos e configurações não são afetados.', p: 'Tudo o que o launcher cria fica dentro da própria pasta. Selecione o que apagar:' }),
    pc: () => hwHtml(hw),
    segundo_plano: () => sec('segundo_plano', 'Em segundo plano', [`
    ${sw('bg_warmup', 'Completar capas e informações ao abrir', 'Ao abrir, busca em lote as capas e descrições que faltam na biblioteca e no início da Store. Desligado, cada jogo é buscado apenas quando aparece na tela')}
    ${sw('bg_sites', 'Continuar varrendo fontes do tipo site', 'Fontes com muitas páginas continuam carregando as próximas em segundo plano. Desligado, entram apenas as primeiras páginas, e mais quando você atualiza a fonte')}
    ${sw('update_auto_check', 'Procurar atualização ao abrir', 'Consulta o canal de atualizações uma vez ao abrir, se houver internet. Desligado, use Ajustes › Sistema › Atualizações › Verificar')}`], { help: 'Tudo aqui vem desligado. Sem nada ligado, o Ludrix parado não faz nada: nenhuma busca, nenhum acesso à internet, nenhuma tarefa em execução. Ele só responde ao que você pede.', p: 'O que o Ludrix pode fazer sozinho enquanto está aberto. Desligado, ele só trabalha quando você solicita.' }),
    atualizacoes: () => updatesHtml(),
    avancado: () => sec('avancado', 'Avançado', [], { adv: [`
    ${sw('terminal_enabled', 'Habilitar o terminal', 'A tecla " (aspas) abre uma janela de comandos do Ludrix; /help lista todos. Recomendado apenas para usuários avançados')}`] }),
    perigo: () => sec('perigo', 'Zona de perigo', [`
    <p>Resetar o launcher apaga <b>tudo</b> que ele criou — jogos baixados, ROMs, emuladores, fontes, temas, configurações — e reabre como se fosse a primeira vez. Não tem volta.</p>
    <button class="btn d sm" onclick="factoryReset()">${I.trash} Resetar o Ludrix de fábrica…</button>`], { cls: 'danger', help: 'Volta o Ludrix ao estado de primeira execução. Apaga permanentemente: configurações, biblioteca, fontes, caches, metadados, temas importados, downloads e as pastas games/ e emulation/ (jogos baixados e ROMs). O que estiver fora da pasta do Ludrix não é tocado.' }),
    sobre: () => `
  <div class="sec about" id="s-sobre" data-sec="Sobre"><div class="abt"><div class="abtlogo">${logoSvg()}</div><div><h3>LudrixHub</h3><p>Criado e idealizado por <b>WOLFFZ</b></p></div></div>
    <p>Um lugar só para os seus jogos: os de PC, os emulados, os atalhos e os Flash, com capa, tempo jogado e favoritos. Portátil — a pasta inteira vai com você.</p>
    <p>O launcher não hospeda nem distribui jogos. Ele organiza o que você tem e lê as fontes que você adiciona.</p>
    <div class="kv" style="margin-top:14px"><b>Versão</b><span>${esc(c.version || '')}${c.version_date ? ` <small style="color:var(--muted)">(${esc(c.version_date)})</small>` : ''} ${c.version_changelog ? `<a href="#" onclick="whatsNew();return false" style="color:var(--accent2);margin-left:8px">novidades</a>` : ''}</span><b>Pasta</b><span>${esc(c.root)}</span><b>Motor da janela</b><span>${esc(c.webview2 ? (/^GTK/.test(c.webview2) ? c.webview2 : 'WebView2 ' + c.webview2) : '')}</span></div>
    <div class="frow" style="margin-top:12px"><div class="l"><b>Arquivos do launcher</b><span>${integrityLine(c.integrity)}</span></div><div class="ta"><button class="btn s sm" onclick="integrityCheck()">${I.check} Verificar arquivos</button></div></div>
    <p class="mut" style="margin-top:12px;font-size:11.5px">Ícones: Tabler, Phosphor e Pixelarticons (licença MIT). Fontes: Outfit e Manrope (SIL Open Font License).</p>
  </div>`,
  };
  const buildBody = tab => tab === 'custom' ? customHtml(S.custom || {}) : ((TABS.find(t => t[0] === tab) || TABS[0])[3] || []).map(id => SEC[id] ? SEC[id]() : '').join('');
  S._settingsBody = buildBody;
  const body = buildBody(tab);
  const tabBtn = ([id, n, ic]) => `<button class="${tab === id ? 'on' : ''}" data-tab="${id}" onclick="settingsTab('${id}')">${I[ic] || ''}<span>${n}</span></button>`;
  $('#view').innerHTML = `<div class="h1 seth"><h2>Ajustes</h2><span title="${esc(c.root)}">${esc(c.root)}</span></div>
    ${restartBanner()}<div class="setwrap"><aside class="setnav"><div class="stabs">${TABS.map(tabBtn).join('')}</div><div class="stoc" id="stoc"></div>
      <div class="setfoot"><div class="sadvbox ${c.settings_adv ? 'on' : ''}"><div class="l"><b>Opções avançadas</b><span id="sadvN">${c.settings_adv ? 'Visíveis em todas as abas' : 'Ocultas — mostra as opções marcadas como avançado'}</span></div><button class="sw ${c.settings_adv ? 'on' : ''}" onclick="toggleAdv()" title="${c.settings_adv ? 'Ocultar opções avançadas' : 'Mostrar opções avançadas'}"></button></div>
      ${(TAB_KEYS[tab] || []).length ? `<button class="lnk" onclick="settingsReset('${tab}')">Redefinir esta aba</button>` : ''}<button class="lnk" onclick="api.post('/api/open',{path:'data'})" title="Pasta data (config, biblioteca, log)">Abrir pasta data</button></div></aside>
    <div class="settings" id="setBody" data-tab="${tab}">${body}</div></div>`;
  settingsToc();
  if (S._settingsJump) { const j = S._settingsJump; S._settingsJump = ''; requestAnimationFrame(() => settingsGo(j, false)); } else $('#view').scrollTop = keepScroll;
  viewFilter();
  if (tab === 'system' && !S.upd) loadUpdates();
}
function toggleAdv() {
  const on = !S.config.settings_adv;
  setCfg({ settings_adv: on }).then(() => {
    const n = document.querySelectorAll('#setBody .adv .frow, #setBody .sec.advonly .frow, #setBody .adv .tiles, #setBody .adv .seg').length;
    if (!on) return;
    if (!n) toast('info', 'Opções avançadas ligadas', 'Esta aba não tem opções avançadas. Elas aparecem com a marca AVANÇADO nas abas que têm.');
    else { const first = document.querySelector('#setBody .adv, #setBody .sec.advonly'); if (first) { first.scrollIntoView({ block: 'center', behavior: 'smooth' }); first.classList.add('flash'); setTimeout(() => first.classList.remove('flash'), 1600); } }
  });
}
const TAB_KEYS = {
  general: ['tray_enabled', 'close_action', 'popups', 'notify_sound', 'guides'],
  appearance: ['theme', 'theme_mode', 'face', 'accent', 'theme_schedule', 'theme_light_from', 'theme_light_to', 'frameless', 'frame_mode', 'frame_corners', 'status_position', 'clock', 'ctx_menu', 'layout', 'nav', 'nav_hidden', 'nav_order', 'rail_icons', 'toolbar', 'toolbar_items', 'ui_scale', 'text_size', 'card_size', 'density', 'animations', 'fx_type', 'fx_intensity', 'glass', 'card_hover', 'reduce_motion', 'parallax', 'high_contrast'],
  library: ['home_spot', 'home_autoplay', 'fav_first', 'home_spot_style', 'home_rows', 'game_backdrop', 'backdrop_blur', 'backdrop_dim', 'accent_from_cover', 'cover_slideshow', 'cover_slideshow_secs', 'view_mode', 'group_by', 'card_ribbons', 'card_playtime', 'detail_art', 'auto_metadata', 'web_covers', 'auto_rename'],
  play: ['after_launch', 'launch_splash', 'nav_hide_playing', 'save_auto_backup', 'game_mode_auto', 'game_mode_ask', 'emu_no_ask', 'gamepad_enabled', 'gamepad_speed', 'gamepad_wake'],
  store: ['hero_enabled', 'store_hide_installed', 'dim_not_installed', 'store_page_size', 'keep_archive', 'concurrent_downloads', 'shortcut_ask', 'repack_auto_open', 'torrent_max_down', 'torrent_max_up', 'torrent_seed_after'],
  system: ['bg_warmup', 'bg_sites', 'update_auto_check', 'terminal_enabled'],
};
function settingsReset(tab) {
  const name = ((S._settingsTabs || []).find(t => t[0] === tab) || [])[1] || tab;
  modal({ title: `Redefinir "${name}"?`, text: 'Todas as opções desta aba voltam ao padrão do Ludrix. Jogos, fontes, pastas e temas importados não são tocados.', ok: 'Redefinir', cancel: 'Não fazer nada', danger: true, onOk: async () => {
    const r = await api.post('/api/config/reset', { keys: TAB_KEYS[tab] || [] }); if (!r || r.error) return toast('err', 'Não foi possível redefinir', (r || {}).error || '');
    S.config = r; applyTheme(); applyAccent(); applyAnim(); applyScale(); applyChrome(); applyRailIcons(); frameLast = ''; applyFrame(); if (S.view === 'settings') renderSettings(); toast('ok', 'Aba redefinida', `${name} voltou ao padrão`);
  } });
}
function settingsToc() {
  const box = $('#stoc'), body = $('#setBody'); if (!box || !body) return;
  const secs = [...body.querySelectorAll('.sec')].filter(s => !s.closest('.sec .sec') && getComputedStyle(s).display !== 'none'); let n = 0;
  const items = secs.map(s => { const h = s.querySelector(':scope > h3') || s.querySelector('h3'); if (!h) return ''; if (!s.id) s.id = 's-auto' + (n++); const t = s.dataset.sec || [...h.childNodes].filter(x => x.nodeType === 3).map(x => x.textContent).join('').trim() || h.textContent.replace(/\?$/, '').trim(); return `<a data-for="${s.id}" onclick="settingsGo(${jsq(s.id)})">${esc(t)}</a>`; }).filter(Boolean);
  box.innerHTML = items.length > 1 ? items.join('') : '';
  const v = $('#view'); if (S._tocScroll) v.removeEventListener('scroll', S._tocScroll);
  S._tocScroll = () => { const as = box.querySelectorAll('a'); if (!as.length) return; const top = v.getBoundingClientRect().top + 80; let cur = as[0]; for (const a of as) { const s = document.getElementById(a.dataset.for); if (s && getComputedStyle(s).display !== 'none' && s.getBoundingClientRect().top <= top) cur = a; } if (v.scrollTop + v.clientHeight >= v.scrollHeight - 4) cur = as[as.length - 1]; as.forEach(a => a.classList.toggle('on', a === cur)); };
  v.addEventListener('scroll', S._tocScroll, { passive: true }); S._tocScroll();
}
function settingsGo(id, smooth = true) {
  let el = document.getElementById(id); if (!el) el = [...document.querySelectorAll('#setBody .sec')].find(s => (s.dataset.sec || (s.querySelector('h3') || {}).textContent || '').trim().startsWith(id)); if (!el) return;
  const v = $('#view'), inst = !smooth || S.config.reduce_motion; if (inst) v.style.scrollBehavior = 'auto';
  el.scrollIntoView({ behavior: inst ? 'auto' : 'smooth', block: 'start' }); if (inst) setTimeout(() => { v.style.scrollBehavior = ''; }, 50); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}
const help = (txt) => `<span class="help" tabindex="0" data-help="${esc(txt)}">?</span>`;
function restartTag(k) { const need = (S.config.restart_labels || {})[k] !== undefined; return need ? ` <em class="rq">*Requer Reinicialização!</em>` : ''; }
function restartBanner() {
  const p = S.config.pending_restart || []; if (!p.length) return '';
  const names = p.map(k => (S.config.restart_labels || {})[k] || k).join(', ');
  return `<div class="rqbar"><div><b>Requer reinicialização</b><span>Alterado: ${esc(names)}. Vale depois de reabrir o launcher.</span></div><button class="btn p sm" onclick="restartApp()">${I.refresh} Reiniciar agora</button></div>`;
}
function restartApp() { modal({ title: 'Reiniciar o Ludrix?', text: 'Downloads em andamento continuam de onde pararam; jogos abertos não são afetados.', ok: 'Reiniciar', cancel: 'Não fazer nada', onOk: async () => { const r = await api.post('/api/restart', {}); if (r && r.error) toast('err', 'Não foi possível reiniciar', r.error); else toast('ok', 'Reabrindo…'); } }); }
async function loadUpdates(check) {
  S.upd = check ? await api.post('/api/updates/check', {}) : await api.get('/api/updates');
  if (S.view === 'settings' && S.tab.settings === 'system') { const box = $('#updBox'); if (box) box.outerHTML = updatesHtml(); }
  if (S.upd && S.upd.last_result) { const r = S.upd.last_result; api.post('/api/updates/ack', {}); modal({ title: r.ok ? (r.restore ? 'Versão restaurada' : 'Atualização instalada') : 'A atualização não foi aplicada', text: r.ok ? `Agora você está na versão ${r.version}.` : (r.error || 'O atualizador restaurou a versão anterior.'), html: r.changelog ? chlogHtml(r.changelog) : '', ok: 'Entendi', wide: !!r.changelog }); S.upd.last_result = null; }
  return S.upd;
}
function chlogHtml(md) {
  const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  let out = '', ul = false;
  for (const raw of (md || '').split('\n')) {
    const l = raw.trimEnd();
    if (/^\s*[-*] /.test(l)) { if (!ul) { out += '<ul>'; ul = true; } out += `<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`; continue; }
    if (ul) { out += '</ul>'; ul = false; }
    if (!l.trim()) continue;
    if (l.startsWith('## ')) { const [v, d, t] = l.slice(3).split(/\s+[—-]+\s+/); out += `<h5><span class="v">${esc(v)}</span>${t ? esc(t) : ''}${d ? `<small>${esc(d)}</small>` : ''}</h5>`; continue; }
    if (l.startsWith('### ')) { out += `<h6>${inline(l.slice(4))}</h6>`; continue; }
    out += `<p>${inline(l)}</p>`;
  }
  if (ul) out += '</ul>';
  return `<div class="chlog">${out}</div>`;
}
function notesBetween(m, cur) {
  const vt = v => (String(v || '0').match(/\d+/g) || []).slice(0, 3).map(Number).concat([0, 0, 0]).slice(0, 3);
  const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
  const all = m.changelog_all || [], c = vt(cur), top = vt(m.version);
  const secs = all.filter(x => cmp(vt(x.version), c) > 0 && cmp(vt(x.version), top) <= 0);
  if (!secs.length) return m.changelog || '';
  return secs.map(x => `## ${x.version}${x.date ? ' — ' + x.date : ''}${x.title ? ' — ' + x.title : ''}\n${x.text || ''}`).join('\n\n');
}
function updatesHtml() {
  if (S.config.appimage) return `<div class="sec"><h3>Atualizações</h3><p>Esta é a versão <b>${esc(S.config.version || '')}</b> em AppImage. Para atualizar, baixe o AppImage novo e substitua o arquivo — seus jogos, ajustes e temas ficam em <span class="code">${esc(S.config.root || '')}</span> e não são tocados.</p></div>`;
  const u = S.upd, cur = (u && u.current) || {}; const av = u && u.available, rem = u && u.remote, st = (u && u.state) || {};
  const job = S.jobs.update;
  const ready = !!av, remote = !ready && !!rem;
  const kind = k => k === 'full' ? 'Nova versão do launcher' : 'Atualização';
  const when = st.checked_at ? new Date(st.checked_at * 1000).toLocaleTimeString().slice(0, 5) : '';
  let card = '';
  if (!u) card = `<p class="mut">Consultando…</p>`;
  else if (ready) card = `<div class="updcard on"><div class="l"><b>v${esc(av.version)}${av.title && !/^(patch|ludrix) /i.test(av.title) ? ' · ' + esc(av.title) : ''}</b><span>${kind(av.kind)}${av.date ? ' · ' + esc(av.date) : ''}${av.size ? ' · ' + fmt(av.size) : ''} · verificada, pronta para instalar</span></div>${chlogHtml(notesBetween(av, cur.version))}</div>`;
  else if (remote) card = `<div class="updcard on"><div class="l"><b>v${esc(rem.version)}</b><span>${kind(rem.kind)}${rem.date ? ' · ' + esc(rem.date) : ''} · ${job ? 'baixando… ' + Math.round((job.fraction || 0) * 100) + '%' : 'disponível para download'}</span></div>${rem.changelog ? chlogHtml(notesBetween(rem, cur.version)) : ''}${job ? progHtml(job, 'update') : ''}</div>`;
  else card = `<div class="updcard"><div class="l"><b>Você está na versão mais recente</b><span>${st.error ? esc(st.error) : 'Nenhuma novidade por enquanto'}${when ? ' · checado às ' + when : ''}</span></div></div>`;
  const applyLabel = remote ? 'Baixar' : 'Instalar';
  const canApply = ready || (remote && !job);
  return `<div id="updBox">
  <div class="sec"><h3>Atualizações <span class="ver">v${esc(cur.version || '?')}</span> ${help('O Ludrix confere o endereço de atualizações (https) ao abrir e ao clicar em Checar. Um arquivo .lxup recebido por fora entra por "Instalar de arquivo". Só pacotes assinados pelo projeto são instalados. Jogos, configurações, temas e emuladores nunca são tocados numa atualização.')}</h3>
    ${card}
    <div class="updbtns"><button class="btn s sm" onclick="checkUpdates()" ${st.busy ? 'disabled' : ''}>${I.refresh} Checar</button>
    <button class="btn p sm" onclick="${remote ? 'downloadUpdate()' : 'applyUpdate()'}" ${canApply ? '' : 'disabled'} title="${canApply ? '' : 'Fica ativo quando houver uma atualização'}">${I.dl} ${applyLabel}</button>
    <button class="btn s sm" onclick="updateFromFile()" title="Escolher um arquivo .lxup que você recebeu">Instalar de arquivo…</button>
    <button class="btn s sm" onclick="restoreVersion()" title="Voltar para uma versão anterior a partir do código-fonte dela (Ludrix-<versão>-src.zip)">${I.import} Voltar de versão…</button></div>
    ${u && !u.updater_present ? `<p class="mut warn">O atualizador (updater) não está na pasta do launcher, então a atualização não consegue se instalar sozinha. Extraia o pacote completo de novo por cima.</p>` : ''}
    <div class="frow"><div class="l"><b>Checar ao abrir</b><span>Procura novidades quando o launcher inicia (só se tiver internet)</span></div><button class="sw ${S.config.update_auto_check !== false ? 'on' : ''}" onclick="setCfg({update_auto_check:!(S.config.update_auto_check!==false)})"></button></div>
    <div class="frow"><div class="l"><b>Endereço de atualizações</b><span>Em branco usa o endereço do projeto (GitHub). Preencha só para testar outro feed https.</span></div><input class="mi" id="updFeed" value="${esc(S.config.update_feed || '')}" placeholder="github.com/wolffZ-prog/Ludrix" style="width:260px"><button class="btn s sm" onclick="setCfg({update_feed:$('#updFeed').value.trim()}).then(()=>toast('ok','Endereço salvo'))">Salvar</button></div>
  </div></div>`;
}
async function checkUpdates() { toast('info', 'Procurando atualizações…'); const u = await loadUpdates(true); if (u && (u.available || u.remote)) toast('ok', 'Atualização encontrada', 'v' + (u.available || u.remote).version, [{ label: 'Ver', fn: () => { setView('settings'); S.tab.settings = 'system'; S._settingsJump = 'Atualizações'; renderSettings(true); } }]); else if (u && u.state && u.state.error) toast('err', 'Não foi possível verificar', u.state.error); else toast('ok', 'Tudo em dia', 'Você já está na versão mais recente'); }
async function downloadUpdate() { const r = await api.post('/api/updates/download', {}); if (r && r.error) toast('err', 'Download', r.error); }
function applyUpdate() {
  const av = S.upd && S.upd.available; if (!av) return;
  modal({ title: `Instalar a versão ${av.version}?`, html: `<p>O Ludrix fecha por completo (inclusive da bandeja) e o atualizador instala a versão nova mostrando o progresso. No fim ele pergunta se quer reabrir.</p><p class="rq">*Requer Reinicialização!</p>`, ok: 'Fechar e atualizar', cancel: 'Não fazer nada', onOk: async () => { const r = await api.post('/api/updates/apply', { relaunch: true }); if (r && r.error) toast('err', 'Atualização', r.error); else toast('ok', 'Fechando para atualizar…'); } });
}
async function updateFromFile() { const r = await api.post('/api/updates/file', {}); if (!r) return; if (r.native === false) return modal({ title: 'Instalar de arquivo', text: 'Nesse modo não é possível abrir a janela de escolher arquivo. Copie o .lxup para pasta updates, dentro da pasta do launcher, e clique em "Checar".', ok: 'Ok' }); if (r.error) return toast('err', 'Arquivo inválido', r.error); if (r.ok) { toast('ok', 'Atualização pronta para instalar', 'Versão ' + r.available.version); loadUpdates(false); } }
async function restoreVersion(repair) {
  const r = await api.post('/api/updates/restore_pick', { allow_same: !!repair }); if (!r || r.cancel) return;
  if (r.native === false) return modal({ title: 'Voltar de versão', text: 'Nesse modo não é possível abrir a janela de escolher arquivo. Abra o updater pela pasta do Ludrix e use "Escolher arquivo".', ok: 'Ok' });
  if (r.error) return modal({ title: 'Voltar de versão', text: r.error, ok: 'Ok' });
  modal({ title: r.same ? `Reinstalar a versão ${r.version}?` : `${r.newer ? 'Instalar' : 'Voltar para'} a versão ${r.version}?`, wide: true,
    html: `<p>Você está na <b>${esc(r.current)}</b>. O Ludrix fecha por completo, o atualizador ${r.same ? 'regrava todos os arquivos da versão' : 'troca o código pela versão'} <b>${esc(r.version)}</b> e reabre nela. Jogos, configurações, temas e emuladores ficam como estão.</p>${r.changelog ? `<p class="mut" style="margin:8px 0 4px">O que essa versão tinha:</p>${chlogHtml(r.changelog)}` : ''}<p class="rq">*Requer Reinicialização!</p>`,
    ok: r.same ? 'Fechar e reinstalar' : r.newer ? 'Fechar e instalar' : 'Fechar e voltar', cancel: 'Não fazer nada',
    onOk: async () => { const x = await api.post('/api/updates/apply', { relaunch: true, restore: r.path }); if (x && x.error) toast('err', 'Voltar de versão', x.error); else toast('ok', 'Fechando para trocar de versão…'); } });
}
const LAYOUT_NAMES = { top: 'navegação no topo', side: 'menu lateral largo', dock: 'barra embaixo', taskbar: 'barra embaixo', rail: 'ícones à esquerda', bottom: 'barra embaixo' };
function pickFace(id) { const prev = faceInfo(S.config.face || DEFAULT_FACE), patch = { face: id }; if ((S.config.theme || '').startsWith('file:')) patch.theme = 'system'; if (S.config.accent && S.config.accent === prev.accent) patch.accent = ''; setCfg(patch); }
async function pickTheme(id) { if (!(S.themes || []).length) S.themes = await api.get('/api/themes/full'); const t = (S.themes || []).find(x => x.id === id), prev = (S.themes || []).find(x => x.id === (S.config.theme || 'system')); const patch = { theme: id }; if (prev && prev.accent && S.config.accent === prev.accent) patch.accent = ''; setCfg(patch); }
const toHex = v => { v = (v || '').trim(); if (/^#([0-9a-f]{6})$/i.test(v)) return v; const m = v.match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i); if (m) return '#' + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join(''); return ''; };
function reloadTheme() { currentTheme = null; applyTheme(); }
async function themeExport(id, fmt) { const r = await api.post('/api/theme/export', { id, format: fmt || 'lxtheme' }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); toast('ok', 'Tema exportado', r.path, [{ label: 'Abrir pasta', fn: () => api.post('/api/open', { path: r.path.replace(/[\\/][^\\/]*$/, '') }) }]); }
function themeMenu(id, x, y) {
  const t = (S.themes || []).find(t => t.id === id) || {}; const items = [{ label: 'Aplicar', icon: 'check', fn: () => pickTheme(id) }];
  if (id.startsWith('file:')) items.push({ sep: true },
    { label: 'Exportar', icon: 'ext', sub: [{ label: '.lxtheme', hint: 'oficial', fn: () => themeExport(id, 'lxtheme') }, { label: '.zip', hint: 'mesmo esqueleto', fn: () => themeExport(id, 'zip') }] },
    { sep: true }, { label: 'Apagar', icon: 'trash', danger: true, fn: () => themeDelete(id, t.name || id) });
  showCtx(items, x, y);
}
function themeExportMenu(id, e) { showCtx([{ label: 'Exportar .lxtheme', hint: 'oficial', icon: 'ext', fn: () => themeExport(id, 'lxtheme') }, { label: 'Exportar .zip', hint: 'mesmo esqueleto', icon: 'ext', fn: () => themeExport(id, 'zip') }], e.clientX, e.clientY); }
async function themeExportAll() { const r = await api.post('/api/theme/export_all', { format: 'zip' }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); toast('ok', `Arquivo com ${pl(r.count, 'tema', 'temas')}`, r.path, [{ label: 'Abrir pasta', fn: () => api.post('/api/open', { path: r.path.replace(/[\\/][^\\/]*$/, '') }) }]); }
async function themeImport() {
  if (S.config.native) { const r = await api.post('/api/theme/import', {}); if (r.error) return toast('err', 'Não foi possível concluir', r.error); if (r.ok) { toast('ok', r.count > 1 ? 'Temas importados' : 'Tema importado', r.name || ''); renderSettings(true); } return; }
  modal({ title: 'Importar temas', text: 'Caminho do .lxtheme, .zip (um ou vários estilos) ou theme.json. Para vários arquivos, um por linha.', textarea: '', ok: 'Importar', onOk: async v => { const r = await api.post('/api/theme/import', { path: v }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); if (r.ok) toast('ok', r.count > 1 ? 'Temas importados' : 'Tema importado', r.name || ''); renderSettings(true); } });
}
function themeSel(id, builtin) { if (builtin) return; S._tsel.has(id) ? S._tsel.delete(id) : S._tsel.add(id); renderSettings(); }
function themeSelGroup(ids) { const list = ids.split('|'); const all = list.every(i => S._tsel.has(i)); list.forEach(i => all ? S._tsel.delete(i) : S._tsel.add(i)); renderSettings(); }
function themeDeleteSel() {
  const ids = [...S._tsel]; if (!ids.length) return;
  modal({ title: `Apagar ${ids.length} estilo${ids.length > 1 ? 's' : ''}?`, text: 'As pastas deles em themes serão removidas. É possível importar de novo depois.', ok: 'Apagar', danger: true, onOk: async () => {
    for (const id of ids) await api.post('/api/theme/delete', { id });
    if (ids.includes(S.config.theme)) S.config.theme = 'system';
    S._tsel.clear(); S._tselMode = false; reloadTheme(true); renderSettings(true); toast('ok', 'Apagados', `${ids.length} estilo${ids.length > 1 ? 's' : ''}`);
  } });
}
function themeDelete(id, name) { modal({ title: `Apagar o estilo "${name}"?`, text: 'A pasta dele em themes será removida. É possível importar de novo depois.', ok: 'Apagar', danger: true, onOk: async () => { await api.post('/api/theme/delete', { id }); if (S.config.theme === id) S.config.theme = 'system'; reloadTheme(true); renderSettings(true); } }); }
function autoScale() { const r = Math.min(window.innerWidth / 1500, window.innerHeight / 860); const s = 1 + (r - 1) * 0.6; return Math.round(Math.min(1.35, Math.max(0.8, s)) * 20) / 20; }
function applyScale() { const s = S.config.ui_scale || autoScale(); document.documentElement.style.setProperty('--scale', s); document.documentElement.style.fontSize = ((13 + (S.config.text_size || 0)) * s) + 'px'; document.body.classList.toggle('compact', (S.config.density || 'normal') === 'compact'); document.body.classList.toggle('noglass', S.config.glass === false); }
let rzT = 0; window.addEventListener('resize', () => { if (S.config.ui_scale) return; cancelAnimationFrame(rzT); rzT = requestAnimationFrame(() => { const s = autoScale(); if (String(s) !== document.documentElement.style.getPropertyValue('--scale')) applyScale(); }); });
async function setCfg(patch) { const r = await api.post('/api/config', patch); if (r && !r.error) { S.config = r; api.emit('config', patch); if ('language' in patch) { location.reload(); return r; } applyTheme(); applyAnim(); applyScale(); if ('rail_icons' in patch) applyRailIcons(); if ('cursor' in patch) if ('game_backdrop' in patch || 'accent_from_cover' in patch || 'cover_slideshow' in patch || 'cover_slideshow_secs' in patch) gameFocus(S._focusKey || S.stageKey || null); if ('frame_mode' in patch || 'frame_corners' in patch) { frameLast = ''; applyFrame(); } if ('nav_hide_playing' in patch) applyPlaying(); if ('nav_hidden' in patch || 'nav_order' in patch) applyNavItems(); if ('card_hover' in patch || 'reduce_motion' in patch || 'detail_art' in patch || 'high_contrast' in patch || 'settings_adv' in patch) applyMotion(); if ('clock' in patch) applyClock(); if ('group_by' in patch && ['home', 'store'].includes(S.view)) renderLibrary(); if (S.view === 'settings') renderSettings(); if (['home', 'store'].includes(S.view) && ('card_size' in patch || 'face' in patch || 'theme' in patch || 'home_spot' in patch || 'home_spot_style' in patch || 'home_rows' in patch || 'view_mode' in patch)) renderLibrary(); if ('toolbar' in patch || patch.toolbar_items) { applyToolbar(); if (['home', 'store'].includes(S.view)) renderLibrary(); } } }
async function setAutostart(on) { const r = await api.post('/api/autostart', { on }); if (r.error) return toast('err', r.error); S.config.autostart = !!r.enabled; renderSettings(); toast('ok', r.enabled ? 'O Ludrix vai abrir com o Windows' : 'Não abre mais com o Windows'); }
async function chooseFolder() { const r = await api.post('/api/choose_folder', { what: 'games' }); if (r.native) { if (r.folder) { await loadCatalog(false); renderSettings(); } return; } modal({ title: 'Pasta dos jogos', text: 'Digite o caminho completo (modo navegador não tem diálogo nativo).', input: S.config.games_dir || '', ok: 'Salvar', onOk: v => setCfg({ games_dir: v }) }); }
function factoryReset() {
  modal({ title: 'Resetar o Ludrix de fábrica?', html: `<p style="margin:0 0 10px">Isso apaga <b>permanentemente</b>: configurações, biblioteca, fontes, caches, metadados, temas importados, downloads, a pasta <span class="code">games</span> (jogos baixados) e <span class="code">emulation</span> (emuladores, ROMs, BIOS). O Ludrix fecha e reabre zerado, como na primeira vez.</p>
    <p class="mut" style="margin:0 0 8px">Pra confirmar, escreva <b>APAGAR TUDO</b>:</p><input class="mi" id="frIn" placeholder="APAGAR TUDO" autocomplete="off" spellcheck="false">`,
    ok: 'Apagar tudo e reabrir', cancel: 'Não fazer nada', danger: true, wait: true, onOk: async () => {
      const v = ($('#frIn').value || '').trim().toUpperCase(); if (v !== 'APAGAR TUDO') { toast('err', 'Escreva APAGAR TUDO para confirmar'); return false; }
      const r = await api.post('/api/factory-reset', { confirm: 'APAGAR TUDO' }); if (r.error) { toast('err', 'Redefinição', r.error); return false; }
      toast('ok', 'Fechando para apagar tudo…', 'O Ludrix reabre sozinho zerado.');
    } });
}
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
      if (t === 'manifest') cfg.url = $('#rUrl').value.trim();
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
    if (sb !== sa) { if (S.view === 'home') refreshHome(); else if (S.view === 'store') renderLibrary(); if (S.det) renderDetail(); applyPlaying(); }
    const before = Object.keys(S.jobs).sort().join(); S.jobs = s.jobs || {}; const after = Object.keys(S.jobs).sort().join();
    $('#dlDot').classList.toggle('on', after.length > 0);
    for (const [k, j] of Object.entries(S.jobs)) {
      const c = document.querySelector(`.card[data-key="${CSS.escape(k)}"] .cov`);
      if (c) { const ring = c.querySelector('.ring'); const html = ringSvg(j.fraction); if (ring) ring.outerHTML = html; else c.insertAdjacentHTML('beforeend', html); }
      const p = document.querySelector(`.prog[data-job="${CSS.escape(k)}"]`); if (p) p.outerHTML = progHtml(j, k);
    }
    if (S.jobs.update && S.view === 'settings' && S.tab.settings === 'system') { const box = $('#updBox'); if (box) box.outerHTML = updatesHtml(); }
    if (before !== after) { if (S.det && (S.view !== 'downloads')) renderDetail(); if (['downloads', 'emulation'].includes(S.view)) renderView(); else document.querySelectorAll('.ring').forEach(r => { const k = r.closest('.card')?.dataset.key; if (k && !S.jobs[k]) r.remove(); }); }
    if (s.gamepad) gpIndicator(s.gamepad);
    if (s.online !== undefined) setOnline(!!s.online && navigator.onLine !== false);
    document.body.classList.toggle('gm', !!s.gamemode);
    S.metaPending = s.meta_pending || 0; statusBar(s.activity, s.loading);
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
    S.jobs[key] = { stage: 'move', fraction: 0, detail: 'Iniciando…' }; $('#dlDot').classList.add('on'); setView('downloads');
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
  toast('ok', 'Biblioteca exportada', `${pl(r.count, 'jogo', 'jogos')} em ${r.dir}`, [{ label: 'Abrir pasta', fn: () => api.post('/api/open', { path: r.dir }) }]);
}
async function handleEvent(ev) {
  if (ev.type === 'flash_cover') { if (S.view === 'flash') { const c = document.querySelector(`.fcard[data-fid="${CSS.escape(ev.id)}"] .fart`); if (c && !c.querySelector('img')) c.insertAdjacentHTML('afterbegin', `<img src="/flash/cover/${esc(ev.id)}?t=${Date.now()}" onload="this.classList.add('ld')" onerror="this.remove()">`); } return; }
  if (ev.type === 'theme_reload') { if (ev.theme) S.config.theme = ev.theme; reloadTheme(true); if (S.view === 'settings') renderSettings(true); return; }
  if (ev.type === 'update_available') { toast('info', 'Tem atualização nova', 'Versão ' + ev.version + ' — veja em Ajustes › Sistema › Atualizações', [{ label: 'Abrir', fn: () => { setView('settings'); S.tab.settings = 'system'; S._settingsJump = 'Atualizações'; renderSettings(true); } }]); return; }
  if (ev.type === 'done') {
    if (ev.kind === 'update') { toast('ok', 'Atualização baixada', 'Pronta para aplicar', [{ label: 'Ver', fn: () => { setView('settings'); S.tab.settings = 'system'; S._settingsJump = 'Atualizações'; renderSettings(true); } }]); S.upd = null; if (S.view === 'settings' && S.tab.settings === 'system') loadUpdates(false); return; }
    if (ev.kind === 'emulator') { toast('ok', 'Emulador instalado', ev.title); if (S.view === 'emulation') renderEmulation(); return; }
    if (ev.kind === 'tool') { toast('ok', ev.key && ev.key.startsWith('mod:') ? 'Mod instalado' : 'Ferramenta instalada', ev.title); if (S.view === 'mods') renderMods(); return; }
    if (ev.kind === 'move') { toast('ok', 'Pasta movida', ev.title + (ev.dir ? ' → ' + ev.dir : '')); loadCatalog(false); if (S.det && S.det.key === ev.key) { S.det = await api.get('/api/game/' + enc(ev.key)); renderDetail(); } return; }
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
    const g = S.byKey[ev.key]; if (!ev.crashed) toast('ok', `${ev.title}`, `Sessão de ${ev.elapsed_h}` + (g && (g.playtime || 0) + ev.elapsed >= 3600 ? ` · total ${fmtTime((g.playtime || 0) + ev.elapsed)}` : '')); if (g) { S._poolKey = ''; g.playtime = (g.playtime || 0) + ev.elapsed; g.last_played = Date.now() / 1000; }
    if (ev.crashed) crashDialog(ev.key, ev.title);
    if (S.det && S.det.key === ev.key) { const d = await api.get('/api/game/' + enc(ev.key)); S.det = d; renderDetail(); } loadCatalog(false);
  } else if (ev.type === 'thumb_ready') {
    TH.err.delete(ev.key); TH.tries[ev.key] = 0; const cv = (S.byKey[ev.key] || {}).cv || 0, want = `/thumb/${enc(ev.key)}?`;
    document.querySelectorAll('.card img, .scov img, .gcov img').forEach(im => { if (im.getAttribute('src').startsWith(want)) { im.classList.remove('err'); im.src = `${want}v=${cv}&t=${Date.now() % 1e6}`; } });
  } else if (ev.type === 'meta_batch_done') {
    metaReloadSoon(); if (ev.count > 3) toast('ok', 'Capas e informações atualizadas', pl(ev.count, 'jogo', 'jogos'));
  } else if (ev.type === 'meta_ready') {
    metaReloadSoon();
    const g = S.byKey[ev.key]; if (g) { g.cv = ev.cv; g.has_meta = true; if (ev.genres && ev.genres.length) g.genres = ev.genres; if (ev.year) g.year = ev.year; if (ev.creator) g.creator = ev.creator; }
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
  } else if (ev.type === 'gamemode') {
    if (ev.on) toast('ok', 'Modo Game ligado', gmSummary(ev));
    else toast('', 'Modo Game desligado', [ev.reopened?.length ? `reabri ${ev.reopened.join(', ')}` : '', ev.power ? 'plano de energia restaurado' : ''].filter(Boolean).join(' · ') || 'tudo de volta ao normal');
    if (S.view === 'central') renderCentral();
  } else if (ev.type === 'notify') {
    loadNotifs();
    if (ev.kind === 'repack') toast('', ev.title, ev.text, [{ label: 'Abrir instalador', fn: () => runRepack(ev.key) }, { label: 'Depois', fn: () => { } }]);
    else if (ev.kind === 'error') toast('err', ev.title, ev.text);
    else if (ev.kind === 'info') { toast('ok', ev.title, ev.text); loadCatalog(false); }
    else if (ev.kind === 'warn' && ev.key === 'integrity') toast('warn', ev.title, ev.text, [{ label: 'Ver arquivos', fn: () => integrityCheck() }, { label: 'Depois', fn: () => { } }]);
    else if (ev.kind === 'ok') toast('ok', ev.title, ev.text);
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
  const show = () => { if (!ov) { ov = document.createElement('div'); ov.className = 'dropov'; ov.innerHTML = `<div>${I.plus}<b>Solte para adicionar à biblioteca</b><span>.exe, .lnk, .url, ROMs ou uma pasta de jogo</span></div>`; document.body.appendChild(ov); } clearTimeout(t); t = setTimeout(hide, 1200); };
  const hide = () => { if (ov) { ov.remove(); ov = null; } };
  document.addEventListener('dragover', e => { if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; show(); });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) hide(); });
  document.addEventListener('drop', async e => {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault(); hide();
    const paths = [...e.dataTransfer.files].map(f => f.pywebviewFullPath || f.path || '').filter(Boolean);
    if (!paths.length) return toast('warn', 'Não deu para ler o caminho do arquivo', 'Use + Adicionar jogo e escolha o arquivo.');
    let ok = 0, last = null;
    for (const p of paths) { const r = await api.post('/api/local/add', { exe: p }); if (r && !r.error) { ok++; last = r; } else if (r && r.error && paths.length === 1) toast('err', 'Não foi possível adicionar', r.error); }
    if (ok) { toast('ok', ok === 1 && last && last.title ? last.title : pl(ok, 'jogo adicionado', 'jogos adicionados'), ok === 1 ? 'Adicionado à biblioteca' : '', ok === 1 && last && last.key ? [{ label: 'Detalhes', fn: () => openGame(last.key) }] : undefined); S.home = null; await loadCatalog(false); }
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
  toast('ok', 'Backup pronto', `${pl(r.files, 'arquivo', 'arquivos')} · ${fmt(r.size)}`, [{ label: 'Abrir pasta', fn: () => api.post('/api/open', { path: r.path.replace(/[\\/][^\\/]*$/, '') }) }, { label: 'OK', fn: () => {} }]);
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
  modal({ title: 'Diagnóstico', wide: true, html: `<div class="diag">${rows}${d.log.length ? `<details style="margin-top:10px"><summary>Últimas linhas do log</summary><pre class="dlog">${esc(d.log.join('\n'))}</pre></details>` : ''}</div>`, ok: 'Copiar tudo', cancel: 'Fechar', onOk: () => { navigator.clipboard.writeText(d.text).then(() => toast('ok', 'Copiado', 'Cole onde quiser (chat, e-mail, bloco de notas).')); } });
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
  color: { home: '#5c6b82', store: '#3b82f6', emulation: '#a855f7', mods: '#f59e0b', redists: '#14b8a6', gamemode: '#14b8a6', flash: '#ec4899', downloads: '#22c55e', settings: '#94a3b8' },
  neon: { home: '#ff5e00', store: '#00c8ff', emulation: '#c000ff', mods: '#ffe600', redists: '#00ffc3', gamemode: '#00ffc3', flash: '#ff00d4', downloads: '#39ff14', settings: '#9be2ff' }
};
const ICON_BASE = { color: 'solid', neon: 'line' };
function iconSet(id) { if (id && typeof id === 'object') return id.icons ? id : null; if (ICON_COLORS[id]) { const b = iconSet(ICON_BASE[id]); return b ? { ...b, colors: ICON_COLORS[id], glow: id === 'neon' } : null; } return (typeof RAIL_ICON_SETS !== 'undefined' && RAIL_ICON_SETS[id]) || null; }
const RAIL_ALIAS = { central: 'gamemode' };
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
function idleState() { const hidden = document.hidden, idle = hidden || !document.hasFocus(); document.body.classList.toggle('idle', idle); const fx = $('#fx'); if (fx) fx.style.display = hidden ? 'none' : ''; }
document.addEventListener('visibilitychange', idleState); window.addEventListener('blur', () => setTimeout(idleState, 250)); window.addEventListener('focus', idleState);

function homeOrder(list) {
  if (S.sort !== 'az' && S.sort !== 'recent') return list;
  const score = g => { let s = 0; if (g.fav) s += 1e12; if (g.last_played) s += g.last_played; s += (g.added_at || 0) / 10; s += Math.min(g.playtime || 0, 1e6); return s; };
  return [...list].sort((a, b) => score(b) - score(a) || a.title.localeCompare(b.title, 'pt'));
}
async function refreshHome() { if (S.view !== 'home') return; try { S.home = await api.get('/api/home'); } catch (e) { return; } if (S.view === 'home' && !filtersActive() && !S.q) { const el = $('#homeTop'); if (el) el.outerHTML = homeTop(); } }
const SORTS = [['az', 'A–Z'], ['year', 'Ano'], ['size', 'Tamanho'], ['recent', 'Recentes'], ['most', 'Mais jogados'], ['count', 'Vezes jogado'], ['added', 'Adicionados'], ['dev', 'Desenvolvedora']];
const WEEK = 7 * 86400;
const FLAG_TEST = {
  fav: g => !!g.fav, never: g => !g.last_played && !(g.playtime > 0), played: g => !!g.last_played || g.playtime > 0,
  recent: g => (g.last_played || 0) > Date.now() / 1000 - WEEK, added: g => (g.added_at || 0) > Date.now() / 1000 - WEEK,
  installed: g => !!g.installed, notinst: g => !g.installed, hidden: g => !!g.hidden, nometa: g => !g.has_meta, broken: g => g.repo === 'local' && !g.installed && !g.mc_nolauncher, playnite: g => g.source === 'playnite', withargs: g => !!g.has_args, big: g => (g.size || 0) > 10e9, old: g => +(g.year || 0) > 0 && +g.year < 2005,
};
const FLAGS = [['fav', 'Favoritos'], ['recent', 'Jogados esta semana'], ['added', 'Adicionados esta semana'], ['never', 'Nunca joguei'], ['played', 'Já joguei'],
               ['installed', 'Instalados'], ['notinst', 'Não instalados'], ['old', 'Clássicos (antes de 2005)'], ['big', 'Grandes (> 10 GB)'], ['nometa', 'Sem capa / metadados'], ['broken', 'Arquivo não encontrado'], ['playnite', 'Vindos do Playnite'], ['withargs', 'Com argumentos'], ['hidden', 'Ocultos']];
const repoFltN = () => (S.view === 'store' ? S.flt.repos.size : 0) + S.flt.src.size;
const repoName = id => (S.repos.find(r => r.id === id) || {}).name || id || '';
const FLT_KINDS = ['cats', 'sys', 'flags', 'repos', 'src', 'genres', 'devs', 'years', 'lastp', 'added', 'ptime', 'size'];
const BUCKET_KINDS = ['lastp', 'added', 'ptime', 'size'];
const BUCKETS = {
  lastp: [['never', 'Nunca'], ['today', 'Hoje'], ['week', 'Últimos 7 dias'], ['month', 'Últimos 30 dias'], ['year', 'Último ano'], ['older', 'Há mais de um ano']],
  added: [['today', 'Hoje'], ['week', 'Últimos 7 dias'], ['month', 'Últimos 30 dias'], ['year', 'Último ano'], ['older', 'Há mais de um ano']],
  ptime: [['none', 'Nunca jogado'], ['lt1', 'Menos de 1 h'], ['h1', '1 a 10 h'], ['h10', '10 a 50 h'], ['h50', 'Mais de 50 h']],
  size: [['lt1', 'Menos de 1 GB'], ['g1', '1 a 10 GB'], ['g10', '10 a 50 GB'], ['g50', 'Mais de 50 GB']],
};
const agoB = ts => { const a = Date.now() / 1000 - ts; return a < 86400 ? 'today' : a < 7 * 86400 ? 'week' : a < 30 * 86400 ? 'month' : a < 365 * 86400 ? 'year' : 'older'; };
const bucketOf = {
  lastp: g => g.last_played ? agoB(g.last_played) : 'never',
  added: g => g.added_at ? agoB(g.added_at) : '',
  ptime: g => { const h = (g.playtime || 0) / 3600; return !g.playtime ? 'none' : h < 1 ? 'lt1' : h < 10 ? 'h1' : h < 50 ? 'h10' : 'h50'; },
  size: g => { const gb = (g.size || 0) / 1e9; return !g.size ? '' : gb < 1 ? 'lt1' : gb < 10 ? 'g1' : gb < 50 ? 'g10' : 'g50'; },
};
const FLT_TITLES = { repos: 'Fonte', src: 'Origem', sys: 'Plataforma', cats: 'Categoria', genres: 'Gênero', years: 'Ano de lançamento', devs: 'Desenvolvedora', lastp: 'Última vez jogado', added: 'Adicionado', ptime: 'Tempo de jogo', size: 'Tamanho', flags: 'Situação' };
const QUICK = [['installed', 'Instalados'], ['notinst', 'Não instalados'], ['fav', 'Favoritos'], ['never', 'Nunca joguei']];
const fltCount = () => FLT_KINDS.reduce((a, k) => a + (k === 'repos' && S.view !== 'store' ? 0 : S.flt[k].size), 0);
const filtersActive = () => S.cat !== 'all' || fltCount() > 0;
const fpOn = () => !!S.config.filter_panel && ['home', 'store'].includes(S.view) && !(S.view === 'store' && S.tab.store === 'sources');
function fltLabel(kind, id) {
  if (kind === 'cats') return (S.cats.find(c => c.id === id) || {}).name || id;
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
  if (kind === 'src') return S.view === 'home' ? byCount(P.ocount) : [];
  if (kind === 'sys') { const it = byCount(P.scount); return it.length > 1 ? it : []; }
  if (kind === 'cats') return S.cats.filter(c => P.counts[c.id]).map(c => [c.id, c.name, P.counts[c.id]]);
  if (kind === 'genres') return byCount(P.gcount);
  if (kind === 'devs') return byCount(P.dcount).filter(x => x[0]);
  if (kind === 'years') return Object.keys(P.ycount).filter(Boolean).sort((a, b) => +b - +a).map(id => [id, id, P.ycount[id]]);
  if (BUCKET_KINDS.includes(kind)) { if (kind === 'size' && S.view === 'home') return []; return BUCKETS[kind].map(([id, nm]) => [id, nm, P.bcount[kind][id] || 0]).filter(x => x[2]); }
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
    <div class="fph"><b>Filtros</b>${n ? `<span class="n">${n}</span>` : ''}<span class="sp"></span>${n ? `<button class="lnk" onclick="clearFlt()">Limpar</button>` : ''}<button class="fpx" onclick="fpOpen(false)" title="Fechar painel">${I.x}</button></div>
    <div class="fpre"><select onchange="fpApplyPreset(this.value)" title="Filtros salvos"><option value="">${presets.length ? 'Filtros salvos…' : 'Nenhum filtro salvo'}</option>${presets.map((p, i) => `<option value="${i}" ${S._fpreset === i ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      ${S._fpreset !== undefined && presets[S._fpreset] ? `<button class="btn s xs" onclick="fpDelPreset()" title="Excluir este filtro salvo">${I.trash}</button>` : `<button class="btn s xs" onclick="fpSavePreset()" ${n ? '' : 'disabled'} title="Salvar a combinação atual com um nome">Salvar</button>`}</div>
    ${quick ? `<div class="fquick">${quick}</div>` : ''}
    ${['repos', 'src', 'sys', 'cats', 'genres', 'years', 'devs', 'lastp', 'added', 'ptime', 'size', 'flags'].map(sec).join('')}
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
function filterBtn() {
  const n = fltCount();
  return `<button class="btn s xs ${n || fpOn() ? 'p' : ''}" onclick="fpOpen()" title="Abre ou fecha o painel de filtros (fica aberto até você fechar)">${I.filter} Filtros${n ? ` (${n})` : ''}</button>`;
}
function activeChips() {
  const L = fltLabels(); if (!L.length && S.cat === 'all') return '';
  return `<div class="fchips">${S.cat !== 'all' ? `<button class="fchip" onclick="S.cat='all';S.page=1;renderLibrary()" title="Remover">${esc((S.cats.find(c => c.id === S.cat) || {}).name || S.cat)}${I.x}</button>` : ''}${L.map(([k, id, nm]) => `<button class="fchip" onclick="toggleFlt('${k}',${jsq(id)})" title="Remover">${esc(nm)}${I.x}</button>`).join('')}${L.length + (S.cat !== 'all' ? 1 : 0) > 1 ? `<button class="lnk" onclick="clearFlt()">Limpar tudo</button>` : ''}</div>`;
}
function viewBtn() {
  const g = S.config.group_by || '', lm = listMode(), n = (S.sort !== 'az' ? 1 : 0) + (g ? 1 : 0) + (lm ? 1 : 0);
  return `<div class="filt" id="vpop"><button class="btn s xs ${n ? 'p' : ''}" onclick="toggleFilt(undefined,'vpop')" title="Ordem, grupos, grade ou lista e tamanho das capas">${I.layout} Exibição</button>
    <div class="pop wide" onclick="event.stopPropagation()">
      <div class="fhead"><b>Exibição</b><span>como os jogos aparecem nesta tela</span>${n ? `<button class="btn s xs" onclick="S.sort='az';setCfg({group_by:'',view_mode:'grid'});renderSortBtn()">Padrão</button>` : ''}</div>
      <div class="fsec"><h5>Ordem</h5><div class="seg fsort">${SORTS.map(([id, l]) => `<button class="${S.sort === id ? 'on' : ''}" onclick="setSort('${id}');toggleFilt(true,'vpop')">${l}</button>`).join('')}</div></div>
      <div class="fsec"><h5>Agrupar</h5><div class="seg fsort">${GROUPS.map(([id, l]) => `<button class="${g === id ? 'on' : ''}" onclick="setCfg({group_by:${jsq(id)}}).then(()=>toggleFilt(true,'vpop'))">${l}</button>`).join('')}</div></div>
      <div class="fsec"><h5>Modo</h5><div class="seg fsort">${[['grid', 'Grade de capas'], ['list', 'Lista']].map(([id, l]) => `<button class="${(lm ? 'list' : 'grid') === id ? 'on' : ''}" onclick="setViewMode(${jsq(id)});requestAnimationFrame(()=>toggleFilt(true,'vpop'))">${l}</button>`).join('')}</div></div>
      ${lm ? '' : `<div class="fsec"><h5>Tamanho das capas</h5><label class="zoom vz"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg><input type="range" min="100" max="300" step="10" value="${S.config.card_size || 136}" oninput="setCardSize(this.value,false)" onchange="setCardSize(this.value,true)"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/></svg></label></div>`}
    </div></div>`;
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
function toggleFlt(kind, id) { const set = S.flt[kind]; set.has(id) ? set.delete(id) : set.add(id); S._fpreset = undefined; S.page = 1; renderLibrary(); }
function flagOnly(id) { clearFlt(); S.flt.flags.add(id); S.page = 1; if (S.view !== 'home') setView('home'); else renderLibrary(); }
function clearFlt() { for (const k of FLT_KINDS) S.flt[k].clear(); S._fpreset = undefined; S.cat = 'all'; S.sort = 'az'; S.sortRev = false; S.page = 1; renderLibrary(); }
function setSort(id) { S.sort = id; S.page = 1; renderSortBtn(); renderLibrary(); if (S.config.sort_by !== id) { S.config.sort_by = id; api.post('/api/config', { sort_by: id }, { quiet: true }); } }
const HOME_ROWS = [['recent', 'Continuar jogando'], ['favorites', 'Favoritos'], ['added', 'Adicionados há pouco'], ['most', 'Mais jogados']];
function homeRows() {
  const hm = S.home, rows = S.config.home_rows || []; if (!hm || !rows.length || listMode()) return '';
  return rows.map(id => {
    const lab = (HOME_ROWS.find(r => r[0] === id) || [])[1]; if (!lab) return '';
    const keys = (hm.sections[id] || []).filter(k => hm.games[k]).slice(0, 14); if (!keys.length) return '';
    return `<div class="hrow" data-row="${id}"><div class="hrh"><h3>${lab}</h3><span>${keys.length}</span></div><div class="grid hrs">${keys.map((k, i) => cardHtml(hm.games[k], i)).join('')}</div></div>`;
  }).join('');
}
function homeTop() {
  const hm = S.home;
  let h = `<div id="homeTop">`;
  if (hm && stageOn()) {
    const st = hm.stats, stg = stageHtml(hm);
    const head = `<div class="h1" style="margin-top:6px"><h2>Minha biblioteca</h2><span>${pl(st.count, 'jogo', 'jogos')} · ${st.pc} PC · ${pl(st.roms, 'emulado', 'emulados')} · ${fmtTime(st.playtime)} jogados${st.missing ? ` · <a href="#" class="miss" onclick="flagOnly('broken');return false" title="Mostrar só os jogos cujo arquivo não está mais no lugar">${st.missing} não ${st.missing === 1 ? 'encontrado' : 'encontrados'}</a>` : ''}</span><span class="sp"></span>
      <button class="btn s xs" onclick="surprise()" title="Escolhe um jogo da sua biblioteca para você jogar agora">${I.spark} Me surpreenda</button>
      ${filterBtn()}</div>`;
    h += stageStyle() === 'banner' ? stg + head : head + stg;
  }
  if (hm) {
    const playing = hm.sections.playing || [];
    h += playing.map(k => { const g = hm.games[k], sess = S.sessions[k] || {}; if (!g) return ''; return `<div class="now"><img src="/thumb/${enc(k)}?v=${g.cv || 0}" onerror="this.remove()"><div style="flex:1"><b>${esc(g.title)}</b><span>Jogando agora · sessão de ${fmtTime(Date.now() / 1000 - (sess.since || Date.now() / 1000))} · total ${fmtTime(g.playtime)}</span></div><button class="btn s sm" onclick="openGame(${jsq(k)})">Detalhes</button><button class="btn d sm" onclick="stopGame(${jsq(k)})">Fechar jogo</button></div>`; }).join('');
  }
  return h + startHtml() + homeRows() + `</div>`;
}
function startSteps() {
  const c = S.config, done = new Set(c.start_done || []);
  const theme = (c.theme && c.theme !== 'system') || c.accent || (c.face && c.face !== 'grafite');
  return [
    ['source', 'Ligue uma fonte de jogos', 'A Store lê listas de jogos (sites, archive.org, GitHub, .json). Sem fonte ela fica vazia.', S.repos.some(r => r.enabled), 'Abrir Fontes', "S.tab.store='sources';setView('store')"],
    ['game', 'Traga o primeiro jogo', 'Baixe pela Store ou adicione um que você já tem: .exe, atalho, ROM ou uma pasta inteira. Arrastar o arquivo para a janela também funciona.', S.games.some(g => g.installed || g.repo === 'local'), 'Adicionar jogo', 'addLocal()'],
    ['look', 'Ajuste a aparência', 'Tema, cor de destaque, posição da barra, ícones — tudo em Aparência.', !!theme || done.has('look'), 'Abrir Aparência', "settingsTab('appearance');if(S.view!=='settings')setView('settings')"],
    ['central', 'Confira as dependências', 'Visual C++, DirectX e .NET evitam jogo que fecha na hora. A Central mostra o que falta.', done.has('central'), 'Abrir Central', "setView('central')"],
  ];
}
function startHtml() {
  const c = S.config; if (c.start_hide || !c.welcome_done) return '';
  const steps = startSteps(), left = steps.filter(x => !x[3]);
  if (!left.length) return '';
  const n = steps.length - left.length;
  return `<div class="start" id="start"><div class="sh"><b>Comece por aqui</b><span>${n} de ${steps.length} ${n === 1 ? 'feito' : 'feitos'}</span><i class="bar"><i style="width:${Math.round(n / steps.length * 100)}%"></i></i><span class="sp"></span><button class="btn s xs" onclick="startHide()" title="Some daqui; volta em Ajustes › Geral">Não mostrar mais</button></div>
    <div class="sl">${steps.map(([id, t, d, ok, lbl, fn]) => `<div class="si ${ok ? 'ok' : ''}"><i>${ok ? I.check : ''}</i><div><b>${t}</b><span>${d}</span></div>${ok ? '' : `<button class="btn p xs" onclick="startGo(${jsq(id)});${esc(fn)}">${lbl}</button>`}</div>`).join('')}</div></div>`;
}
function startGo(id) { const d = new Set(S.config.start_done || []); if (id === 'central' || id === 'look') { d.add(id); S.config.start_done = [...d]; api.post('/api/config', { start_done: [...d] }); } }
function startHide() { setCfg({ start_hide: true }).then(() => { const el = $('#start'); if (el) el.remove(); }); }
const DESC = {};
const STAGE_STYLES = [['auto', 'Como a aparência manda'], ['painel', 'Painel com fileira de capas'], ['banner', 'Banner largo com a arte'], ['duplo', 'Duplo: destaque e recentes'], ['simples', 'Simples']];
const stageStyle = face => { const s = S.config.home_spot_style || 'auto'; if (s !== 'auto') return s; face = face || document.body.dataset.face || 'grafite'; return face === 'padrao' || face === 'grafite' || face === 'temperado' || face === 'aurora' || face === 'neon' || face === 'tinta' ? 'banner' : face === 'duo' ? 'duplo' : face === 'ember' ? '' : 'simples'; };
const stageOn = () => S.config.home_spot !== false && !!stageStyle();
const short = (t, n = 220) => { t = (t || '').replace(/\s+/g, ' ').trim(); if (t.length <= n) return t; const cut = t.slice(0, n), i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? ')); return i > 80 ? cut.slice(0, i + 1) : cut.replace(/\s\S*$/, '') + '…'; };
const coverImg = (key, g) => `<div class="ph">${esc(g.title)}</div><img src="/thumb/${enc(key)}?v=${g.cv || 0}" alt="" loading="lazy" decoding="async" class="${TH.ok.has(key) ? 'ld' : ''}" onload="this.classList.add('ld')" onerror="this.remove()">`;
const metaLine = g => [g.creator, g.year, fmt(g.size), g.genres && g.genres[0]].filter(Boolean).map(esc).join(' · ');
function stagePool(hm) {
  const playing = hm.sections.playing || [];
  const all = Object.keys(hm.games).filter(k => hm.games[k] && !playing.includes(k));
  if (!all.length) return [];
  const keep = (S.showPick || []).filter(k => all.includes(k));
  if (keep.length < Math.min(5, all.length)) S.showPick = shuffle(all).slice(0, 5); else S.showPick = keep;
  return S.showPick;
}
function shuffle(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function rerollShowcase() {
  const hm = S.home; if (!hm) return;
  const playing = hm.sections.playing || [], all = Object.keys(hm.games).filter(k => hm.games[k] && !playing.includes(k));
  const prev = new Set(S.showPick || []);
  const fresh = shuffle(all.filter(k => !prev.has(k)));
  S.showPick = (fresh.length >= 5 ? fresh : [...fresh, ...shuffle([...prev])]).slice(0, 5);
  S.stageKey = S.showPick[0];
  const st = $('#stage'); if (st) st.outerHTML = stageHtml(hm);
}
const diceCard = () => `<div class="scard dice sf" title="Sortear outros cinco jogos" onclick="rerollShowcase()"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01"/></svg><span>Sortear</span></div>`;
function gotoGrid() { if (S.view !== 'home') { setView('home'); setTimeout(gotoGrid, 350); return; } const g = $('#grid'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function playLbl(key) { const g = S.byKey[key]; return g && g.missing ? `${I.search} Localizar arquivo` : `${I.play} Jogar`; }
function stageHtml(hm) {
  const face = document.body.dataset.face || 'grafite', pool = stagePool(hm);
  if (!pool.length || !stageOn()) return '';
  if (!S.stageKey || !hm.games[S.stageKey]) S.stageKey = pool[0];
  const key = S.stageKey, g = hm.games[key];
  const st = stageStyle(face);
  if (st === 'painel') return stageGrafite(hm, pool, key, g);
  if (st === 'banner') return stageBanner(hm, pool, key, g);
  if (st === 'duplo') return stageDuo(hm, pool, key, g);
  return stageSpot(key, g);
}
function stageSpot(key, g) {
  return `<div class="stage spot" id="stage"><div class="sbg" style="background-image:url('/hero/${enc(key)}')"></div><div class="sgrad"></div>
    <div class="scov" onclick="openGame(${jsq(key)})">${coverImg(key, g)}</div>
    <div class="sinfo"><div class="stag">${g.last_played ? 'Continuar jogando' : 'Da sua biblioteca'}</div><h3 onclick="openGame(${jsq(key)})">${esc(g.title)}</h3>
      <div class="smeta">${g.playtime ? `<div><b>Tempo</b><span>${fmtTime(g.playtime)}</span></div>` : ''}${g.last_played ? `<div><b>Última vez</b><span>${ago(g.last_played)}</span></div>` : ''}${g.genres && g.genres[0] ? `<div><b>Gênero</b><span>${esc(g.genres[0])}</span></div>` : ''}</div>
      <div class="sacts"><button class="btn p" onclick="play(${jsq(key)})">${playLbl(key)}</button><button class="btn s" onclick="openGame(${jsq(key)})">Detalhes</button><button class="btn s" onclick="rerollShowcase()" title="Sortear outro">${I.dice}</button></div></div></div>`;
}
function gfocusHtml(key, g) {
  return `<div class="gcov sf" onclick="openGame(${jsq(key)})">${coverImg(key, g)}</div><h3 onclick="openGame(${jsq(key)})">${esc(g.title)}</h3>
    <button class="btn p gplay" onclick="play(${jsq(key)})">${playLbl(key)}</button>
    <div class="gstats"><div>${clock}<div><b>Tempo</b><span>${g.playtime ? fmtTime(g.playtime) : '—'}</span></div></div><div>${I.cal}<div><b>Última vez</b><span>${g.last_played ? ago(g.last_played) : 'nunca'}</span></div></div></div>`;
}
function stageGrafite(hm, pool, key, g) {
  const strip = pool.slice(0, 12), rec = (hm.sections.recent || []).slice(0, 8);
  return `<div class="stage g-grafite" id="stage"><div class="gfocus" id="gfocus">${gfocusHtml(key, g)}</div>
    <div class="gside${rec.length ? '' : ' solo'}"><div class="gstrip">${strip.map(k => `<div class="scard sf ${k === key ? 'sel' : ''}" data-sk="${esc(k)}" onclick="stageSet(${jsq(k)})" ondblclick="openGame(${jsq(k)})">${coverImg(k, hm.games[k])}</div>`).join('')}${diceCard()}</div>
      <div class="gdots">${strip.map(k => `<i class="${k === key ? 'sel' : ''}" data-sk="${esc(k)}" onclick="stageSet(${jsq(k)})"></i>`).join('')}</div>
      ${rec.length ? `<div class="grec"><h3>Recentes</h3><div class="grow">${rec.map(k => { const r = hm.games[k]; return `<div class="wcard sf" onclick="openGame(${jsq(k)})" style="background-image:url('/hero/${enc(k)}')"><span>${esc(r.title)}</span><small>${clock}${r.playtime ? fmtTime(r.playtime) : ago(r.last_played)}</small></div>`; }).join('')}</div></div>` : ''}</div></div>`;
}
function stageBanner(hm, pool, key, g) {
  const cats = (g.cats || []).map(id => (S.cats.find(c => c.id === id) || {}).name).filter(Boolean);
  const tags = [...new Set([...(g.genres || []).slice(0, 3), ...cats.slice(0, 2), g.system && g.system !== 'pc' ? (S.systems[g.system] || g.system) : 'PC'])].slice(0, 5);
  if (DESC[key] === undefined) stageDesc(key);
  return `<div class="stage g-banner" id="stage"><div class="bbg" style="background-image:url('/hero/${enc(key)}')"></div><div class="bgrad"></div>
    <div class="btxt"><span class="btag">${g.last_played ? 'Continuar jogando' : 'Destaque'}</span><h1 onclick="openGame(${jsq(key)})">${esc(g.title)}</h1>
      <div class="bmeta">${metaLine(g)}</div><p class="bdesc" data-desc="${esc(key)}">${esc(DESC[key] || '')}</p>
      <div class="btags">${tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>
      <div class="bacts"><button class="btn p" onclick="play(${jsq(key)})">${playLbl(key)}</button><button class="btn s" onclick="openGame(${jsq(key)})">${I.info} Detalhes</button></div></div>
    <div class="bdots">${pool.slice(0, 5).map(k => `<i class="${k === key ? 'sel' : ''}" data-sk="${esc(k)}" onclick="stageSet(${jsq(k)})"></i>`).join('')}<button class="bdice" title="Sortear outros cinco" onclick="rerollShowcase()"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01"/></svg></button></div></div>`;
}
function stageDuo(hm, pool, key, g) {
  return `<div class="stage g-duo" id="stage"><div class="dhead"><span class="dtag">${g.last_played ? 'Continuar jogando' : 'Em destaque'}</span><h3 id="dtitle" onclick="openGame(${jsq(key)})">${esc(g.title)}</h3><span class="sp"></span><button class="btn p sm" id="dplay" onclick="play(${jsq(key)})">${playLbl(key)}</button></div>
    <div class="dtiles">${pool.slice(0, 10).map(k => `<div class="dtile sf ${k === key ? 'sel' : ''}" data-sk="${esc(k)}" onclick="stageSet(${jsq(k)})" ondblclick="openGame(${jsq(k)})">${coverImg(k, hm.games[k])}</div>`).join('')}<div class="dtile dice sf" title="Sortear outros cinco" onclick="rerollShowcase()"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01"/></svg><span>Sortear</span></div></div></div>`;
}
async function stageDesc(key) {
  DESC[key] = '';
  try { const d = await api.get('/api/game/' + enc(key)); DESC[key] = short(d.description || ''); } catch (e) { return; }
  document.querySelectorAll(`[data-desc="${CSS.escape(key)}"]`).forEach(el => el.textContent = DESC[key]);
}
let stageHold = 0;
setInterval(() => {
  if (S.view !== 'home' || document.hidden || !document.hasFocus() || S.config.reduce_motion || S.config.home_autoplay === false) return;
  if (!$('#stage') || !S.showPick || S.showPick.length < 2 || Date.now() < stageHold) return;
  if ($('#modal').classList.contains('on') || $('#detail').classList.contains('on') || $('#ctx')?.classList.contains('on')) return;
  const i = S.showPick.indexOf(S.stageKey), next = S.showPick[(i + 1) % S.showPick.length];
  if (next && next !== S.stageKey) stageSet(next, true);
}, 7000);
function stageSet(key, auto) {
  const hm = S.home, st = $('#stage'); if (!hm || !hm.games[key] || !st) return; S.stageKey = key;
  if (!auto) stageHold = Date.now() + 25000;
  document.querySelectorAll('#grid .card.sel').forEach(c => c.classList.remove('sel')); document.querySelector(`#grid .card[data-key="${CSS.escape(key)}"]`)?.classList.add('sel');
  if (st.classList.contains('g-banner')) { st.outerHTML = stageHtml(hm); return; }
  st.querySelectorAll('[data-sk]').forEach(el => el.classList.toggle('sel', el.dataset.sk === key));
  const f = $('#gfocus'); if (f) f.innerHTML = gfocusHtml(key, hm.games[key]);
  gameFocus(key);
  const t = $('#dtitle'); if (t) { t.textContent = hm.games[key].title; t.onclick = () => openGame(key); $('#dplay').onclick = () => play(key); }
  st.querySelector('.scard.sel, .dtile.sel')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
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
  { art: 'mods', t: 'Mods, redists e ferramentas', d: 'Ferramentas de mod, os VC++ e DirectX que os jogos pedem, e o Modo Game — que deixa o PC (e o próprio Ludrix) focado no jogo enquanto você joga.' },
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
    <div class="sgrid">${[[I.library || I.grid, 'Biblioteca', 'Seus jogos com capa grande, favoritos e tempo jogado.'], [I.dl, 'Store', 'Baixe das fontes que você adicionar; o jogo entra na biblioteca sozinho.'], [I.gamepad, 'Emuladores', 'Consoles antigos com emulador instalado em um clique.'], [I.layout, 'Modo Console', 'Tela cheia para a TV, com controle, teclado ou mouse.']].map(([ic, t, d]) => `<div class="scard2">${ic}<b>${t}</b><span>${d}</span></div>`).join('')}</div>
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
async function setupPickDir() { const r = await api.post('/api/choose_folder', { what: 'games' }); if (r.native) { if (r.folder) { await loadCatalog(false); setupRender(); } return; } modal({ title: 'Pasta dos jogos', text: 'Digite o caminho completo (modo navegador não tem diálogo nativo).', input: S.config.games_dir || '', ok: 'Salvar', onOk: v => setCfg({ games_dir: v }).then(setupRender) }); }
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
function welcomeDone() { const el = $('#welcome'); if (el) { el.classList.remove('on'); setTimeout(() => el.remove(), 300); } if (!S.config.welcome_done) { S.config.welcome_done = true; api.post('/api/config', { welcome_done: true }); } }
document.addEventListener('keydown', e => { const w = $('#welcome'); if (!w || !w.classList.contains('on') || $('#swBody')) return; if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); welcomeGo(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); welcomeGo(-1); } else if (e.key === 'Escape') { e.preventDefault(); welcomeDone(); } });
function toggleToolbarItem(id, on) { const cur = new Set(S.config.toolbar_items || ['search', 'cats', 'sort', 'bell']); on ? cur.add(id) : cur.delete(id); setCfg({ toolbar_items: TOOLBAR_ITEMS.map(x => x[0]).filter(x => cur.has(x)) }); }
document.addEventListener('click', e => { if (!e.target.closest('#filt')) $('#filt')?.classList.remove('on'); if (!e.target.closest('#vpop')) $('#vpop')?.classList.remove('on'); });
async function toggleHidden(key) { const r = await api.post('/api/hide', { key }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); const g = S.byKey[key]; if (g) { g.hidden = r.hidden; S._poolKey = ''; } if (S.home && S.home.games[key]) S.home.games[key].hidden = r.hidden; toast('ok', r.hidden ? 'Jogo oculto' : 'Jogo visível de novo', r.hidden ? 'Aparece de novo pelo filtro Situação › Ocultos ou pela busca.' : '', r.hidden ? [{ label: 'Desfazer', fn: () => toggleHidden(key) }] : undefined); if (S.view === 'home') { refreshHome(); renderLibrary(); } }
async function toggleFav(key) { const r = await api.post('/api/fav', { key }); const g = S.byKey[key]; if (g) { g.fav = r.fav; S._poolKey = ''; } document.querySelectorAll(`[data-fav="${CSS.escape(key)}"]`).forEach(b => b.classList.toggle('on', r.fav)); if (S.home && S.home.games[key]) S.home.games[key].fav = r.fav; if (S.view === 'home') refreshHome(); }
async function stopGame(key, force) {
  const title = (S.byKey[key] || S.det || {}).title || 'o jogo';
  if (!force) return modal({ title: 'Encerrar ' + title + '?', text: 'O processo é finalizado na hora, mesmo travado. Progresso não salvo dentro do jogo se perde.', ok: 'Encerrar', cancel: 'Não fazer nada', danger: true, onOk: () => stopGame(key, true) });
  const r = await api.post('/api/stop', { key }); if (r.error) toast('err', 'Não foi possível encerrar', r.error); else toast('', 'Encerrando ' + title + '…', ''); pollSoon();
}

async function installFromFile() {
  if (!S.config.native) { modal({ title: 'Instalar de arquivo', html: '<label class="ml">Caminho do arquivo (.zip/.7z/.rar/.iso)</label><input class="mi" id="ifPath"><label class="ml">Título (opcional)</label><input class="mi" id="ifTitle">', ok: 'Instalar', onOk: async () => { const r = await api.post('/api/local/install_file', { file: $('#ifPath').value.trim(), title: $('#ifTitle').value.trim() }); if (r.error) { toast('err', 'Não foi possível concluir', r.error); return false; } S.jobs[r.key] = { stage: 'extract', fraction: 0, detail: 'Iniciando…' }; $('#dlDot').classList.add('on'); setView('downloads'); } }); return; }
  const r = await api.post('/api/local/install_file', {});
  if (r.error) return toast('err', 'Não foi possível concluir', r.error);
  if (r.ok === false) return;
  S.jobs[r.key] = { stage: 'extract', fraction: 0, detail: 'Iniciando…' }; $('#dlDot').classList.add('on');
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
    <p class="mut" style="font-size:12px;margin:10px 0 0">Capa e informações são buscadas sozinhas depois de adicionar. BIOS/keys, quando o console precisa, ficam na pasta indicada em Emuladores.</p>`,
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
    ${S.config.game_mode_ask !== false ? `<label class="remember gmopt"><input type="checkbox" id="askGm" ${S.config.game_mode_auto ? 'checked' : ''}> ${I.bolt} <span><b>Otimizar e abrir</b> — Modo Game: plano de energia de desempenho, prioridade alta e Ludrix em silêncio${(S.config.game_mode_close || []).length ? `, fechando ${S.config.game_mode_close.length} app(s)` : ''}</span></label>` : ''}
    <label class="remember"><input type="checkbox" id="askRem"> Lembrar minha escolha (é possível mudar em Ajustes)</label>` });
  setTimeout(() => gpFocusFirst('.askrow button'), 50);
}
async function askGo(key, after) { const rem = $('#askRem')?.checked; const gm = $('#askGm')?.checked; $('#modal').classList.remove('on'); if (rem) await setCfg({ after_launch: after, game_mode_auto: !!gm }); play(key, after, undefined, !!gm); }

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
function ctxItems(key, acts) { return acts.map(a => a.sep ? { sep: true } : { label: a.label, icon: a.icon, primary: a.primary, danger: a.danger, fn: () => ctxDo(key, a.id) }); }
async function ctxMenu(key, x, y) {
  const g = S.byKey[key] || (S.home && S.home.games[key]) || {};
  if (ctxNativeOk()) {
    const acts = await api.get('/api/actions/' + enc(key));
    return showCtx(ctxItems(key, acts), x, y, g.title || key);
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
  if (e.target.closest('#rail,#titlebar,#brandBtn')) { e.preventDefault(); return appMenu(e.clientX, e.clientY); }
  if (e.target.closest('#detail')) { e.preventDefault(); if (S.det) return ctxMenu(S.det.key, e.clientX, e.clientY); return; }
  if (e.target.closest('#view,.top')) { e.preventDefault(); return viewMenu(S.view, e.clientX, e.clientY); }
});
document.addEventListener('click', e => { if (!e.target.closest('#ctx')) closeCtx(); }, true);
$('#view').addEventListener('scroll', () => { if (ctxKey !== null || $('#ctx').classList.contains('on')) closeCtx(); }, { passive: true });
async function ctxDo(key, id) {
  closeCtx();
  const g = S.byKey[key] || {};
  switch (id) {
    case 'play': return play(key);
    case 'play_opt': return play(key, S.config.after_launch === 'ask' ? undefined : S.config.after_launch, undefined, true);
    case 'play_with': { const d = await api.get('/api/game/' + enc(key)); const opts = d.emu?.installed_options || []; if (opts.length < 2) return toast('', 'Só um emulador', 'Vincule outro em Emuladores → ⚙ do console.'); return chooseEmulator(key, opts, d.emu.emulator); }
    case 'stop': return stopGame(key);
    case 'install': return openGame(key);
    case 'details': return openGame(key);
    case 'fav': return toggleFav(key);
    case 'hide': return toggleHidden(key);
    case 'open_dir': { const d = S.det && S.det.key === key ? S.det : await api.get('/api/game/' + enc(key)); return api.post('/api/open', { path: d.dir }); }
    case 'open_select': return api.post('/api/open_select', { key });
    case 'mark_played': { const r = await api.post('/api/game/played', { key, played: !(g.last_played > 0) }); if (!r.error) { toast('ok', g.last_played > 0 ? 'Marcado como nunca jogado' : 'Marcado como jogado', g.title || ''); loadCatalog(false); } return; }
    case 'copy_name': { const tt = (S.byKey[key] || S.det || {}).title || ''; return navigator.clipboard.writeText(tt).then(() => toast('ok', 'Nome copiado', tt)); }
    case 'copy_path': { const d = S.det && S.det.key === key ? S.det : await api.get('/api/game/' + enc(key)); const p = d.exe || d.dir || ''; return navigator.clipboard.writeText(p).then(() => toast('ok', 'Caminho copiado', p)); }
    case 'open_emu_dir': { const d = await api.get('/api/game/' + enc(key)); return api.post('/api/open', { path: d.emu && d.emu.emu_dir }); }
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
    case 'cover_reset': return resetCover(key);
    case 'page': { const d = await api.get('/api/game/' + enc(key)); return api.post('/api/open_url', { url: d.page_url }); }
    case 'remove': return confirmUninstall(key);
  }
}

function storeTabs() { return `<div class="tabs" style="margin-top:10px"><button class="${S.tab.store === 'games' ? 'on' : ''}" onclick="S.tab.store='games';renderView()">Baixar novos games</button><button class="${S.tab.store === 'sources' ? 'on' : ''}" onclick="S.tab.store='sources';renderView()">Fontes (repositórios)</button></div>`; }
async function renderSources() {
  const repos = await api.get('/api/repos'); if (S.view !== 'store') return;
  const kindName = { pc: 'Jogos PC', rom: 'ROMs', recomp: 'Ports / recompilações' };
  const typeName = { telegram: 'canal do Telegram (bot lê posts com .torrent)', webpage: 'página da web (links diretos / torrents)', archive_uploader: 'coleção de um uploader', archive_creator: 'coleção de um criador', archive_item: 'pacote (um arquivo por jogo)', archive_search: 'busca', github_release: 'releases do GitHub', manifest: 'lista .json', local_folder: 'pasta do PC' };
  $('#view').innerHTML = storeTabs() + `
    <div class="h1"><h2>Fontes de jogos</h2><span>${repos.length ? `${repos.filter(r => r.enabled).length} de ${repos.length} ligadas` : 'de onde a Store puxa o catálogo'}</span><div class="acts"><button class="btn s" onclick="addRepo()">${I.cog} Manual (avançado)</button></div></div>
    <div class="hint">Cole um link ou escolha um arquivo .json com fontes de jogos ${help('Uma fonte é uma lista de jogos que a Store lê: um arquivo .json (local ou por link), uma coleção do archive.org, uma página com downloads, um repositório do GitHub ou uma pasta do PC.')}${ONLINE ? '' : ' <span class="offl">Sem internet — conecte-se para ligar fontes e baixar.</span>'}</div>
    <div class="detbox"><div class="mrow"><input class="mi" id="detq" placeholder="https://…/fontes.json  ·  archive.org/details/@usuario  ·  página com jogos  ·  GitHub  ·  pasta do PC" onkeydown="if(event.key==='Enter')doDetect()"><button class="btn p sm" onclick="doDetect()">${I.search} Analisar</button>${S.config.native ? `<button class="btn s sm" onclick="pickSourceJson()">${I.doc} Arquivo .json</button><button class="btn s sm" title="Pasta do PC com jogos ou ROMs" onclick="api.post('/api/choose_folder',{what:'any'}).then(r=>{if(r.folder){$('#detq').value=r.folder;doDetect()}})">${I.folder} Pasta</button>` : ''}</div>
    </div>
    <div class="browse" id="browse"></div>
    <div class="gh"><h3>Suas fontes</h3><span>botão direito numa fonte mostra mais opções</span></div>
    ${repos.length ? '' : `<div class="empty" style="padding:24px 0 16px"><b>Nenhuma fonte ainda</b>Cole um link acima ou use Manual (avançado).</div>`}
    <div class="srcs">${repos.map(r => `<div class="src ${r.enabled ? 'on' : ''} ${!ONLINE && !r.enabled ? 'off' : ''}" data-repo="${esc(r.id)}" title="${ONLINE ? 'Botão direito: mais opções' : 'Sem internet'}"><div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><b>${esc(r.name)}</b><button class="sw ${r.enabled ? 'on' : ''}" ${!ONLINE && !r.enabled ? 'disabled title="Sem conexão com a internet"' : ''} onclick="event.stopPropagation();if(!ONLINE&&!${r.enabled})return toast('err','Sem internet','Conecte-se para ligar essa fonte.');api.post('/api/repos/toggle',{id:${jsq(r.id)},enabled:${!r.enabled}}).then(()=>{renderSources();loadCatalog(false)})"></button></div><span>${esc(typeName[r.type] || r.type)} · ${esc(kindName[r.kind] || r.kind)}${r.system && r.system !== 'pc' ? ' · ' + esc(S.systems[r.system] || r.system) : ''}</span><span class="n">${r.count !== undefined ? `${r.count} ${r.count === 1 ? 'jogo' : 'jogos'}` : '—'}${r.builtin ? '' : `<button class="srcedit" title="Editar fonte" onclick="event.stopPropagation();editRepo(${jsq(r.id)})">${I.edit}</button>`}</span>${r.note ? `<span class="u" style="direction:ltr" title="${esc(r.note)}">${esc(r.note)}</span>` : ''}${r.url ? `<span class="u" title="${esc(r.url)}">${esc(r.url.replace(/^https?:\/\/(www\.)?/, '').replace(/^[A-Za-z]:\\/, ''))}</span>` : ''}</div>`).join('')}</div>`;
  setTimeout(() => $('#detq')?.focus(), 50);
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
    const rows = S._det.map((x, i) => `<div class="brow"><div><b>${esc(x.title)}</b><span>${kindLabel(x.kind)} ${esc(x.detail || '')}</span></div><div class="ac"><button class="btn p sm" onclick="addSource(S._det[${i}].cfg)">+ Adicionar</button></div></div>`).join('');
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
async function addSource(cfg) { const r = await api.post('/api/repos/add', cfg); if (r.error) return toast('err', 'Não foi possível concluir', r.error); toast('ok', 'Fonte adicionada', cfg.name + ' — carregando na Store…'); if (S.tab.store === 'sources') renderSources(); loadCatalog(false); }

async function renderMods() {
  $('#view').innerHTML = `<div class="h1"><h2>Mods e ferramentas</h2><span>carregando…</span></div>`;
  const m = await api.get('/api/mods'); S.mods = m; if (S.view !== 'mods') return;
  const cats = [...new Set(m.tools.map(t => t.category))];
  let cur = S.tab.mods; if (!['mine', 'tools', 'sites'].includes(cur)) cur = cats.includes(cur) ? (S.modsCat = cur, 'tools') : 'mine'; S.tab.mods = cur;
  const nInst = m.tools.filter(t => t.installed).length, nMods = m.games.reduce((a, g) => a + g.count, 0);
  const sub = cur === 'mine' ? `${nMods ? pl(nMods, 'mod', 'mods') + ' em ' + pl(m.games.length, 'jogo', 'jogos') : 'nenhum mod instalado ainda'}` : cur === 'tools' ? `${nInst} de ${m.tools.length} instaladas` : `${m.sites.length} sites`;
  let h = `<div class="h1"><h2>Mods e ferramentas</h2><span>${sub}</span><div class="acts">${cur === 'tools' ? `<button class="btn s" onclick="api.post('/api/open',{path:${jsq(m.root)}})" title="Pasta onde as ferramentas portáteis ficam">${I.folder} Pasta tools</button>` : cur === 'mine' ? `<button class="btn p" onclick="modInstallMenu(event)">${I.plus} Instalar mod</button>` : ''}</div></div>
    <div class="tabs"><button class="${cur === 'mine' ? 'on' : ''}" onclick="S.tab.mods='mine';renderMods()">Meus mods${m.games.length ? ` <span class="n">${m.games.length}</span>` : ''}</button><button class="${cur === 'tools' ? 'on' : ''}" onclick="S.tab.mods='tools';renderMods()">Ferramentas${nInst ? ` <span class="n">${nInst}</span>` : ''}</button><button class="${cur === 'sites' ? 'on' : ''}" onclick="S.tab.mods='sites';renderMods()">Sites de mods</button></div>`;
  if (cur === 'mine') { $('#view').innerHTML = h + `<div id="myMods"></div>`; return renderMyMods(); }
  if (cur === 'sites') {
    h += `<div class="hint">Sites conhecidos para baixar mods. O arquivo baixado entra pelo botão "Instalar mod" em Meus mods.</div><div class="sitegrid">${m.sites.map(s => `<button class="sitecard" onclick="api.post('/api/open_url',{url:${jsq(s.url.replace('{q}', ''))}})"><span class="ic">${I.ext}</span><b>${esc(s.name)}</b><small>${esc(s.desc)}</small></button>`).join('')}</div>`;
    $('#view').innerHTML = h; return;
  }
  const fc = S.modsCat || '';
  const chips = `<div class="chips" style="margin:0 0 14px"><button class="chip ${!fc ? 'on' : ''}" onclick="S.modsCat='';renderMods()">Todas <span class="n">${m.tools.length}</span></button><button class="chip ${fc === '__inst' ? 'on' : ''}" onclick="S.modsCat='__inst';renderMods()">Instaladas <span class="n">${nInst}</span></button>${cats.map(c => `<button class="chip ${fc === c ? 'on' : ''}" onclick="S.modsCat=${jsq(c)};renderMods()">${esc(c)} <span class="n">${m.tools.filter(t => t.category === c).length}</span></button>`).join('')}</div>`;
  const card = t => { const job = S.jobs['tool:' + t.id]; return `<div class="toolc ${t.installed ? 'ok' : ''}"><div class="th"><span class="ic">${t.installed ? I.check : I.wrench}</span><div class="tt"><b>${esc(t.title)}</b><small>${esc(t.category)}</small></div>${t.installed ? `<span class="pill ok">Instalada${t.version ? ' · ' + esc(t.version) : ''}</span>` : t.type === 'github_release' ? `<span class="pill">Portátil</span>` : `<span class="pill">Site</span>`}</div>
    <p>${esc(t.desc)}</p><div class="for"><b>Para:</b> ${esc(t.for)}</div>
    ${job ? progHtml(job, 'tool:' + t.id) : `<div class="ta">${t.installed ? `<button class="btn p sm" onclick="api.post('/api/tools/launch',{id:'${t.id}'})">${I.play} Abrir</button><button class="btn s sm ico" title="Abrir pasta" onclick="api.post('/api/open',{path:${jsq(t.dir)}})">${I.folder}</button><button class="btn d sm ico" title="Remover" onclick="removeTool('${t.id}',${jsq(t.title)})">${I.trash}</button>` : t.type === 'github_release' ? `<button class="btn p sm" onclick="installTool('${t.id}')">${I.dl} Instalar</button><small class="mut">baixa do GitHub para tools\\</small>` : `<button class="btn s sm" onclick="api.post('/api/open_url',{url:${jsq(t.url || '')}})">${I.ext} Site oficial</button>`}</div>`}</div>`; };
  const list = fc === '__inst' ? m.tools.filter(t => t.installed) : fc ? m.tools.filter(t => t.category === fc) : m.tools;
  h += chips;
  if (!list.length) h += emptyHtml(I.wrench, 'Nenhuma ferramenta instalada', 'As ferramentas do GitHub são baixadas pelo Ludrix e ficam portáteis em tools\\. Escolha uma categoria para ver as disponíveis.', [['Ver todas', "S.modsCat='';renderMods()", 1]]);
  else if (fc) h += `<div class="toolgrid">${list.map(card).join('')}</div>`;
  else h += cats.map(c => `<div class="tsec"><h4>${esc(c)}<span>${m.tools.filter(t => t.category === c).length}</span></h4><div class="toolgrid">${m.tools.filter(t => t.category === c).map(card).join('')}</div></div>`).join('');
  $('#view').innerHTML = h;
}
async function renderMyMods() {
  const el = $('#myMods'); if (!el) return;
  const inst = S.games.filter(g => g.installed && g.kind !== 'emulator').sort((a, b) => COLL.compare(a.title, b.title));
  const withMods = S.mods.games || [], cnt = {}; for (const w of withMods) cnt[w.key] = w.count;
  if (!S.modsGame || !inst.some(g => g.key === S.modsGame)) S.modsGame = (withMods[0] && withMods[0].key) || (inst[0] && inst[0].key) || '';
  if (!inst.length) { el.innerHTML = `${emptyHtml(I.wrench, 'Nenhum jogo instalado', 'Instale ou adicione um jogo na Biblioteca; depois volte aqui para colocar mods nele.', [['Abrir Store', "setView('store')", 1], ['Adicionar jogo', 'addLocal()']])}`; return; }
  const key = S.modsGame; const g = S.byKey[key] || inst.find(x => x.key === key);
  const qn = qnorm(S._modsQ || ''), ordered = inst.filter(x => !qn || qnorm(x.title).includes(qn)).sort((a, b) => (cnt[b.key] || 0) - (cnt[a.key] || 0) || COLL.compare(a.title, b.title));
  el.innerHTML = `<div class="modwrap"><aside class="modgames"><input class="mgq" placeholder="Procurar jogo…" value="${esc(S._modsQ || '')}" oninput="S._modsQ=this.value;renderMyMods();const i=document.querySelector('.modgames .mgq');i.focus();i.setSelectionRange(i.value.length,i.value.length)" spellcheck="false">
      <div class="mgl">${ordered.map(x => `<button class="mg ${x.key === key ? 'on' : ''}" onclick="S.modsGame=${jsq(x.key)};renderMyMods()"><img loading="lazy" src="/thumb/${enc(x.key)}?v=${x.cv || 0}" alt="" onerror="this.onerror=null;this.src=BLANK_GIF"><span>${esc(x.title)}</span>${cnt[x.key] ? `<i>${cnt[x.key]}</i>` : ''}</button>`).join('') || '<span class="fnone">Nenhum jogo com esse nome</span>'}</div></aside>
    <div class="modmain"><div class="mghead"><img src="/thumb/${enc(key)}?v=${(g || {}).cv || 0}" alt="" onerror="this.onerror=null;this.src=BLANK_GIF"><div class="tx"><b>${esc(g ? g.title : key)}</b><span id="mgSub">${cnt[key] ? pl(cnt[key], 'mod instalado', 'mods instalados') : 'Sem mods'}</span></div>
      <div class="ta"><button class="btn p sm" onclick="modInstallMenu(event)">${I.plus} Instalar mod</button><button class="btn s sm" onclick="openGame(${jsq(key)})">${I.info} Ficha</button></div></div>
      <div id="mgList"><div class="hint">carregando…</div></div>
      <p class="mgnote">Aponte o <b>.zip</b> (ou .7z/.rar ou pasta) do mod e o Ludrix copia os arquivos para a pasta certa. O que for substituído fica guardado: um mod pode ser desligado sem perder nada e religado depois. Friday Night Funkin' aceita mods soltos na pasta <span class="code">mods\\</span> do Psych Engine.</p></div></div>`;
  const r = await api.get('/api/mods/game/' + enc(key)); if (S.modsGame !== key || !$('#mgList')) return;
  S.modsTargets = r.targets || []; S.modsSuggest = r.suggest || '';
  const job = S.jobs['mod:' + key];
  if (!r.dir) { $('#mgList').innerHTML = `<div class="empty"><b>Sem pasta</b>${esc(g ? g.title : key)} não tem uma pasta instalada conhecida — o Ludrix precisa dela para copiar os arquivos do mod.</div>`; return; }
  $('#mgList').innerHTML = (job ? `<div class="item"><div class="ic">${I.wrench}</div><div class="tx"><b>Instalando mod…</b>${progHtml(job, 'mod:' + key)}</div></div>` : '') + (r.mods.length ? `<div class="list">${r.mods.map(m => `<div class="item ${m.enabled ? '' : 'off'}"><div class="ic">${I.wrench}</div><div class="tx"><b>${esc(m.title)}</b><span>${pl(m.files.length, 'arquivo', 'arquivos')} · ${fmt(m.size)} · em ${esc(m.target ? m.target + '\\' : 'pasta do jogo')}${m.replaced.length ? ` · substituiu ${m.replaced.length} do jogo (guardados)` : ''}${m.enabled ? '' : ' · desligado'}</span></div>
      <div class="ac"><button class="sw ${m.enabled ? 'on' : ''}" title="${m.enabled ? 'Desligar (tira os arquivos e devolve os originais)' : 'Ligar de novo'}" onclick="modToggle(${jsq(key)},${jsq(m.id)},${m.enabled ? 'false' : 'true'})"></button><button class="btn d ico" title="Remover de vez" onclick="modRemove(${jsq(key)},${jsq(m.id)},${jsq(m.title)})">${I.trash}</button></div></div>`).join('')}</div>`
    : `${emptyHtml(I.wrench, `Nenhum mod em ${esc(g ? g.title : key)}`, 'Baixe o mod no site de sua preferência e aponte o arquivo aqui.', [['Instalar mod', `modInstallMenu(event)`, 1], ['Abrir pasta do jogo', `api.post('/api/open',{path:${jsq(r.dir)}})`]])}`)
    + `<p style="color:var(--muted2);font-size:12px;margin:14px 0 0">Pasta do jogo: <a href="#" onclick="api.post('/api/open',{path:${jsq(r.dir)}});return false">${esc(r.dir)}</a>${r.targets.length > 1 ? ` · pastas de mods encontradas: ${r.targets.filter(t => t.path).map(t => `<span class="code">${esc(t.path)}</span>`).join(' ')}` : ''}</p>`;
}
function modInstallMenu(ev) {
  showCtx([{ label: 'Arquivo do mod (.zip, .7z, .rar)', icon: 'doc', fn: () => modInstallAsk('file') }, { label: 'Pasta já extraída', icon: 'folder', fn: () => modInstallAsk('dir') }], ev.clientX, ev.clientY, 'Instalar mod');
}
function modInstallAsk(kind) {
  const key = S.modsGame; const tg = S.modsTargets || [{ path: '', label: 'Pasta do jogo (raiz)' }];
  const sel = `<label>Copiar para<select class="mi" id="mdT">${tg.map(t => `<option value="${esc(t.path)}" ${t.path === (S.modsSuggest || '') ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>`;
  modal({ title: 'Instalar mod', wide: true, html: `<div class="fedit">${S.config.native ? '' : `<label style="grid-column:1/-1">${kind === 'dir' ? 'Caminho da pasta do mod' : 'Caminho do arquivo do mod'}<input class="mi" id="mdP"></label>`}<label>Nome (opcional)<input class="mi" id="mdN" placeholder="Como vai aparecer na lista"></label>${sel}</div>
    <p style="color:var(--muted);font-size:12px;margin-top:8px">Se o zip já vem com a pasta certa dentro (ex.: <span class="code">mods\\NomeDoMod\\</span>), escolha a raiz do jogo. Se vem só o conteúdo do mod, escolha a pasta de mods.</p>`,
    ok: 'Instalar', onOk: async () => {
      const r = await api.post('/api/mods/game/install', { key, path: $('#mdP') ? $('#mdP').value : '', title: $('#mdN').value, target: $('#mdT').value, kind });
      if (r.error) return toast('err', 'Não foi possível concluir', r.error);
      if (r.ok !== false) { S.jobs['mod:' + key] = { stage: 'extract', fraction: -1, detail: 'Iniciando…' }; pollSoon(); renderMyMods(); }
    } });
}
async function modToggle(key, id, on) { const r = await api.post('/api/mods/game/toggle', { key, id, on }); if (r.error) toast('err', 'Não foi possível concluir', r.error); renderMyMods(); }
function modRemove(key, id, name) { modal({ title: `Remover ${name}?`, text: 'Os arquivos do mod saem do jogo, os originais voltam e a cópia guardada é apagada.', ok: 'Remover', danger: true, onOk: async () => { await api.post('/api/mods/game/remove', { key, id }); renderMyMods(); } }); }
async function installTool(id) { const r = await api.post('/api/tools/install', { id }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); S.jobs['tool:' + id] = { stage: 'download', fraction: 0, detail: 'Iniciando…' }; $('#dlDot').classList.add('on'); renderMods(); pollSoon(); }
function removeTool(id, name) { modal({ title: `Remover ${name}?`, text: 'A pasta da ferramenta será apagada.', ok: 'Remover', danger: true, onOk: async () => { await api.post('/api/tools/remove', { id }); renderMods(); } }); }
async function loadModsFor(key) {
  const r = await api.get('/api/mods/for/' + enc(key)); const el = $('#dMods'); if (!el || S.current !== key) return;
  if (!r.tools.length && !r.sites.length && !(S.byKey[key] || {}).installed) { el.remove(); return; }
  el.innerHTML = `<h3>MODS E FERRAMENTAS</h3>${(S.byKey[key] || {}).installed ? `<div class="sites" style="margin-bottom:8px"><button class="site sp" onclick="S.modsGame=${jsq(key)};S.tab.mods='mine';setView('mods')">${I.wrench} Meus mods neste jogo</button></div>` : ''}${r.tools.length ? `<div class="sites" style="margin-bottom:8px">${r.tools.map(t => `<button class="site sp" onclick="S.tab.mods='tools';setView('mods')" title="${esc(t.for)}">${I.wrench} ${esc(t.title)}${t.installed ? ' ✓' : ''}</button>`).join('')}</div>` : ''}
    <div class="sites">${r.sites.map(s => `<button class="site ${s.specific ? 'sp' : ''}" onclick="api.post('/api/open_url',{url:${jsq(s.url)}})" title="${esc(s.desc)}">${I.ext} ${esc(s.name)}</button>`).join('')}</div>`;
}

const GP = { idx: -1, last: {}, focus: null, hint: null, t: null, active: false, edit: null, scr: null, scrAt: 0 };
function gpIndicator(st) { const el = $('#gpInd'); if (!el) return; const n = (st && st.connected) || [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean).length; el.classList.toggle('on', n > 0); }
window.addEventListener('gamepadconnected', e => { gpIndicator(); toast('ok', 'Controle conectado', e.gamepad.id.slice(0, 40)); gpLoop(); });
window.addEventListener('gamepaddisconnected', () => { gpIndicator(); gpClear(); });
window.onGamepadWake = why => { if (why === 'connected') toast('ok', 'Controle conectado', 'Use o D-pad para navegar · A abre · B volta'); gpLoop(); };
function gpFocusables() {
  if ($('#ctx').classList.contains('on')) return [...document.querySelectorAll('#ctx button:not([disabled])')];
  if ($('#modal').classList.contains('on')) return [...document.querySelectorAll('#modalBox button, #modalBox input, #modalBox select, #modalBox label.on, #modalBox .file')];
  if ($('#detail').classList.contains('on')) return [...document.querySelectorAll('#detail .btn:not([disabled]), #detail .site, #detail .file')];
  return [...document.querySelectorAll('#toasts .toast.act button, #view .card, #view .sf, #view .btn, #view .chip, #view select, #view input[type=range], #view .src, #view .site, #view .tool .btn, #view .brow .btn, #view .radio label, #view .sw, #view .theme, #view .swatch')].filter(el => el.offsetParent !== null);
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
    case 'a': { const f = GP.focus; if (!f) return gpMove(1, 0); if (f.classList.contains('card')) { if ($('#modal').classList.contains('on')) return; if (S.view === 'home' && !f.classList.contains('sel')) return selectGame(f.dataset.key); openGame(f.dataset.key); setTimeout(() => gpFocusFirst('#detail .btn.g, #detail .btn.p, #detail .btn'), 400); } else if (f.tagName === 'SELECT' || (f.tagName === 'INPUT' && f.type === 'range')) return gpEdit(f); else if (f.tagName === 'INPUT' && f.type === 'checkbox') f.click(); else f.click(); setTimeout(() => { const els = gpFocusables(); if (!els.includes(GP.focus)) gpSet(els[0]); }, 200); return; }
    case 'b': { if ($('#ctx').classList.contains('on')) return closeCtx(); if ($('#modal').classList.contains('on')) return $('#modal').classList.remove('on'); if ($('#detail').classList.contains('on')) { closeDetail(); return setTimeout(() => gpFocusFirst('#view .card'), 200); } if (S.q) { S.q = ''; $('#q').value = ''; renderLibrary(); } return; }
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
      p.buttons.forEach((b, i) => { if (map[i]) press(map[i], b.pressed); });
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0, th = .7, rel = .45;
      const axis = (neg, pos, v) => { press(neg, v < -th || (st[neg] && v < -rel)); press(pos, v > th || (st[pos] && v > rel)); };
      axis('left', 'right', ax); axis('up', 'down', ay);
      const ry = p.axes[3] || 0; if (Math.abs(ry) > .3) { gpScroll(ry * 22, false); any = true; }
    }
    idle = any ? 0 : idle + 1;
    setTimeout(() => requestAnimationFrame(tick), idle > 30 ? 120 : 0);
  };
  requestAnimationFrame(tick);
}
document.addEventListener('mousemove', () => { if (GP.active) { gpClear(); } }, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden && navigator.getGamepads && [...navigator.getGamepads()].some(Boolean)) gpLoop(); });
if (navigator.getGamepads && [...navigator.getGamepads()].some(Boolean)) gpLoop();

applyAnim(); loadCatalog(false); poll();

const GB = n => n ? (n / 2 ** 30).toFixed(n > 2 ** 30 * 100 ? 0 : 1) + ' GB' : '—';
const MB = n => !n ? '—' : n >= 2 ** 30 ? (n / 2 ** 30).toFixed(1) + ' GB' : Math.round(n / 2 ** 20) + ' MB';
function hwHtml(hw) {
  if (!hw || hw.error) return `<div class="sec"><h3>Seu PC</h3><p>Não consegui ler o hardware${hw && hw.error ? ': ' + esc(hw.error) : ''}.</p></div>`;
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
  const ic = { error: I.warn, warn: I.warn, ok: I.check, repack: I.dl, info: I.check, update: I.refresh };
  $('#bellList').innerHTML = NOTIFS.length ? NOTIFS.map(n => `<div class="bn ${n.read ? '' : 'un'} ${n.kind}" onclick="notifOpen(${jsq(n.id)})">${ic[n.kind] || I.info}<div><b>${esc(n.title)}</b><span>${esc(n.text || '')}</span><small>${ago(n.at)}</small></div>${n.kind === 'repack' && n.key ? `<button class="btn p xs" onclick="event.stopPropagation();runRepack(${jsq(n.key)})">Instalar</button>` : ''}</div>`).join('') : '<div class="empty" style="padding:30px 10px"><b>Tudo em dia</b>Nenhuma notificação.</div>';
}
const HELP = {
  home: { t: 'Biblioteca', p: 'Todos os seus jogos num lugar só: instalados no PC, baixados pelo Ludrix, importados de outros launchers e ROMs já baixadas.', s: ['Clique numa capa para selecionar; dois cliques ou botão direito abrem os detalhes. Ctrl+clique seleciona vários para favoritar, atualizar metadados ou remover de uma vez.', 'Use a busca (tecla /), a categoria e a ordenação na barra de tarefas. O botão Filtros abre um painel lateral com todos os critérios: situação, origem, categoria, gênero, desenvolvedora, ano, quando jogou, quando adicionou, tempo jogado e tamanho; marque quantos quiser. Uma combinação pode ser salva pelo botão Salvar e reaplicada pela lista "Filtros salvos".', '"Adicionar jogo" aceita um .exe, um atalho ou uma pasta inteira. Jogos com faixa NÃO ENCONTRADO mudaram de lugar: Jogar neles abre a opção de apontar a pasta nova.', 'Busca com prefixo: dev:nintendo (desenvolvedora), ano:2017 ou ano:2010s (ano ou década), gen:rpg (gênero), sis:snes (sistema), origem:steam (origem). Dá para misturar com palavras normais, como "mario sis:gba".', 'Arrastar um .exe, atalho ou ROM para a janela adiciona o jogo à biblioteca.'] },
  store: { t: 'Store', p: 'Catálogo das fontes que você ligou. Nada é baixado sem você pedir.', s: ['Com mais de uma fonte ligada, cada cartão mostra de onde o jogo vem e Filtros ganha a seção "Fonte".', 'Ligue ou desligue fontes em "Fontes de jogos".', 'Baixar um jogo coloca-o na Fila; quando terminar, ele aparece na Biblioteca.', 'A busca e a categoria funcionam aqui também.'] },
  emulation: { t: 'Emuladores', p: 'Instale emuladores por console e traga suas ROMs. A configuração básica é automática.', s: ['Os consoles com emulador pronto ou ROMs na pasta ficam em "Meus consoles"; os outros aparecem abaixo, os mais usados primeiro.', 'Em Consoles, instale o emulador e aponte a pasta das suas ROMs.', 'Em Baixar ROMs aparecem as fontes de ROM que você ligou, com um seletor por console; a ROM só entra na Biblioteca depois de baixada.', 'Ao baixar uma ROM você escolhe a pasta de destino; marque "Usar sempre" para fixar a pasta daquele console — ou use "Baixar em…" no cartão do console.', 'BIOS e chaves, quando necessários, são indicados no próprio console.'] },
  mods: { t: 'Mods e ferramentas', p: 'Meus mods instala mods nos seus jogos a partir do arquivo baixado, com botão pra desligar e religar; as outras abas trazem utilitários e sites de mods.', s: ['Escolha o jogo, Instalar mod, aponte o .zip.', 'Arquivos do jogo substituídos ficam guardados: desligar o mod devolve os originais.', 'Em Ferramentas, os chips no alto filtram por categoria ou mostram só as instaladas; cada cartão diz para quais jogos serve. Portátil = o Ludrix baixa do GitHub para tools\\; Site = abre a página oficial.'] },
  central: { t: 'Central Ludrix', p: 'Preparação do PC para jogar: otimização durante o jogo, dependências que os jogos pedem e programas úteis (incluindo launchers de Minecraft).', s: ['A Visão geral resume tudo: o que precisa de atenção e um botão para resolver; "Ver tudo" abre a aba completa.', 'Em Programas úteis, a parte de Minecraft acha os launchers que você já tem e coloca o Minecraft na Biblioteca; Jogar abre o launcher escolhido.', '"Otimizar antes de jogar" troca o plano de energia e dá prioridade ao jogo; tudo volta ao normal quando ele fecha.', 'Se um jogo fecha na hora ou reclama de .dll, instale as dependências marcadas como faltando.', 'O cartão Opcionais instala launchers e utilitários pelo winget ou abre a página na Microsoft Store.'] },
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
    <div class="hb"><p>${esc(h.p)}</p><ul>${h.s.map(x => `<li>${esc(x)}</li>`).join('')}</ul><div class="hk">Atalhos: <kbd>/</kbd> busca · <kbd>Ctrl</kbd>+<kbd>1…9</kbd> abas · <kbd>Esc</kbd> fecha · <button class="lnk" onclick="$('#helppop').classList.remove('on');shortcutsHelp()"><kbd>?</kbd> ver todos</button></div></div>`;
  p.classList.add('on');
  setTimeout(() => document.addEventListener('click', helpOut, { once: true }), 0);
}
function helpOut(e) { const p = $('#helppop'); if (!p.contains(e.target) && !$('#helpBtn').contains(e.target)) p.classList.remove('on'); else if (p.classList.contains('on')) setTimeout(() => document.addEventListener('click', helpOut, { once: true }), 0); }
function toggleBell() { $('#helppop').classList.remove('on'); const p = $('#bellpop'); const on = p.classList.toggle('on'); if (on) { loadNotifs(); setTimeout(() => document.addEventListener('click', bellOut, { once: true }), 0); } }
function bellOut(e) { const p = $('#bellpop'); if (!p.contains(e.target) && !$('#bell').contains(e.target)) p.classList.remove('on'); else if (p.classList.contains('on')) setTimeout(() => document.addEventListener('click', bellOut, { once: true }), 0); }
async function notifOpen(id) { const n = NOTIFS.find(x => x.id === id); if (!n) return; await api.post('/api/notifications/ack', { id }); n.read = true; renderBell(); if (n.key === 'integrity') { $('#bellpop').classList.remove('on'); integrityCheck(); return; } if (n.key && !n.key.startsWith('flash:')) { $('#bellpop').classList.remove('on'); openGame(n.key); } }
function discToolAsk(key, r) {
  modal({ title: r.tool_only ? 'Formato de disco não suportado' : 'Disco com faixas de áudio', text: r.message + '\n\nO WinCDEmu é gratuito e de código aberto; instala um driver (pede permissão de administrador uma vez). Depois de montar o disco com ele, abra o instalador e, no fim, use "Procurar instalação agora" nos detalhes do jogo.', ok: 'Baixar WinCDEmu', onOk: async () => { const t = await api.get('/api/disc/tool'); api.post('/api/open_url', { url: t.url }); }, extra: r.tool_only ? null : 'Montar sem o áudio', onExtra: () => api.post('/api/repack/run', { key, force: true }).then(x => x.error ? toast('err', 'Disco', x.error) : toast('', 'Disco montado', 'O instalador vai abrir em seguida.')), cancel: 'Depois' });
}
async function runRepack(key) { const r = await api.post('/api/repack/run', { key }); if (r.error) return toast('err', 'Não abriu o instalador', r.error); if (r.needs_tool) return discToolAsk(key, r); toast('', 'Instalador aberto', 'Quando ele terminar, o jogo entra na biblioteca automaticamente.'); $('#bellpop').classList.remove('on'); }
function beep() { if (S.config.notify_sound === false) return; try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.0001, a.currentTime); g.gain.exponentialRampToValueAtTime(0.12, a.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.35); o.start(); o.stop(a.currentTime + 0.4); } catch (e) { } }

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
  const right = [a.jobs ? `${a.jobs} na fila` : '', S.games.length ? `<a href="#" onclick="gotoGrid();return false">${pl(S.games.length, 'jogo', 'jogos')} no catálogo</a>` : '', nb ? `<a href="#" onclick="flagOnly('broken');return false" style="color:var(--amber)">${pl(nb, 'não encontrado', 'não encontrados')}</a>` : ''].filter(Boolean).join(' · ');
  if (r.innerHTML !== right) r.innerHTML = right;
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
['#qbox', '#tbBrand', '.tb-btns'].forEach(sel => { const el = document.querySelector(sel); if (el) el.addEventListener('mousedown', e => e.stopPropagation()); });
document.addEventListener('contextmenu', e => { ctxMouse = { x: e.clientX, y: e.clientY }; }, true);
function ctxMode() { return S.config.ctx_menu || S.themeMenu || 'windows'; }
function ctxNativeOk() { return !!(S.config.native && S.config.frameless && ctxMode() === 'windows' && !GP.active && !ctxNative && window.screenX !== undefined); }
function ctxStrip(list, pre) { return list.map((it, i) => ({ id: pre + i, sep: !!it.sep, label: it.label || '', hint: it.hint || '', primary: !!it.primary, danger: !!it.danger, disabled: !!it.disabled, sub: it.sub ? ctxStrip(it.sub, pre + i + '.') : null })); }
function cssRgb(v) {
  const el = document.createElement('i'); el.style.cssText = `position:absolute;visibility:hidden;color:var(${v})`; document.body.appendChild(el);
  const c = getComputedStyle(el).color; el.remove();
  let m = c.match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+%?))?/); if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]];
  m = c.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?:\s*\/\s*([\d.]+%?))?/); if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]];
  return null;
}
function ctxColors() {
  const hex = a => a ? '#' + a.map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('') : '';
  const mix = (p, q, k) => p && q ? [0, 1, 2].map(i => p[i] * (1 - k) + q[i] * k) : null;
  const bg0 = cssRgb('--bg') || [24, 28, 34, 1], bg = mix(bg0, cssRgb('--bg2') || bg0, (cssRgb('--bg2') || [0, 0, 0, 1])[3]);
  const over = v => { const c = cssRgb(v); return c ? mix(bg, c, c[3]) : null; };
  const tx = over('--text');
  return { bg: hex(bg), text: hex(tx), muted: hex(over('--muted2') || over('--muted')), primary: hex(over('--green2')), danger: hex(over('--red')), line: hex(over('--line')), hover: hex(mix(bg, tx, 0.09)) };
}
async function showCtxNative(items, x, y, title) {
  ctxNative = true; ctxKey = null; $('#ctx').classList.remove('on');
  const near = Math.abs(ctxMouse.x - x) < 6 && Math.abs(ctxMouse.y - y) < 6;
  let r = null;
  try {
    r = await api.post('/api/window', { cmd: 'ctx', items: ctxStrip(items, ''), title: title || '', colors: ctxColors(), at_cursor: near ? '1' : '0', x: Math.round(window.screenX + x), y: Math.round(window.screenY + y), light: document.documentElement.dataset.light || '0' });
  } catch (e) { r = null; }
  ctxNative = false;
  if (!r || !r.ok) return false;
  if (r.pick != null) {
    const [a, b] = String(r.pick).split('.'); const it = b === undefined ? items[+a] : (items[+a] && items[+a].sub || [])[+b];
    if (it && it.fn) it.fn();
  }
  return true;
}
function showCtx(items, x, y, title) {
  if (ctxNativeOk()) { showCtxNative(items, x, y, title).then(ok => { if (!ok) showCtxLocal(items, x, y, title); }); return; }
  showCtxLocal(items, x, y, title);
}
function showCtxLocal(items, x, y, title, head) {
  const c = $('#ctx');
  const row = (it, i, pre) => it.sep ? '<hr>' : `<button class="${it.danger ? 'danger' : ''} ${it.primary ? 'primary' : ''} ${it.sub ? 'has-sub' : ''}" data-i="${pre}${i}">${I[it.icon] || ''}<span>${esc(it.label)}</span>${it.hint ? `<em>${esc(it.hint)}</em>` : ''}${it.sub ? '<svg class="car" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>' : ''}</button>`;
  c.innerHTML = (head || '') + (title ? `<h5>${esc(title)}</h5>` : '') + items.map((it, i) => it.sub ? `<div class="subw">${row(it, i, '')}<div class="sub">${it.sub.map((x, k) => row(x, k, i + '.')).join('')}</div></div>` : row(it, i, '')).join('');
  const find = id => { const [a, b] = id.split('.'); return b === undefined ? items[+a] : items[+a].sub[+b]; };
  c.querySelectorAll('button').forEach(b => b.onclick = e => { const it = find(b.dataset.i); if (it.sub) { e.stopPropagation(); return; } c.classList.remove('on'); it.fn && it.fn(); });
  c.querySelectorAll('.subw').forEach(w => w.addEventListener('mouseenter', () => { const sub = w.querySelector('.sub'); sub.classList.remove('left'); sub.style.top = ''; sub.style.maxHeight = ''; const wr = w.getBoundingClientRect(); let r = sub.getBoundingClientRect(); if (r.right > innerWidth - 8) sub.classList.add('left'); if (r.height > innerHeight - 16) { sub.style.maxHeight = (innerHeight - 16) + 'px'; sub.style.overflowY = 'auto'; r = sub.getBoundingClientRect(); } const want = Math.max(8, Math.min(wr.top - 6, innerHeight - 8 - r.height)); sub.style.top = (want - wr.top) + 'px'; }));
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

const CENTRAL_TABS = [['overview', 'Visão geral'], ['optimize', 'Otimizar antes de jogar'], ['redists', 'Dependências'], ['optionals', 'Programas úteis']];
async function renderCentral() {
  const tab = S.tab.central || 'overview';
  if (!S.central) $('#view').innerHTML = `<div class="h1"><h2>Central Ludrix</h2><span>verificando o PC…</span></div>`;
  const [g, r, o, mc] = await Promise.all([api.get('/api/gamemode'), api.get('/api/redists'), api.get('/api/optionals'), api.get('/api/minecraft')]);
  if (S.view !== 'central') return;
  S.gm = g; S.redists = r; S.opt = o; S.mc = mc; S.central = true;
  const missing = r.items.filter(i => i.state === 'missing').length;
  const optInst = o.items.filter(i => i.state === 'installed').length;
  const body = tab === 'redists' ? redistsHtml(r) : tab === 'optionals' ? optionalsHtml(o) + minecraftHtml(mc) : tab === 'optimize' ? gamemodeHtml(g) : overviewHtml(g, r, o, mc);
  const mcInst = mc.items.filter(i => i.installed).length;
  const badge = { overview: '', optimize: g.active ? '<span class="n on">ligado</span>' : '', redists: missing && r.windows ? `<span class="n">${missing}</span>` : '', optionals: optInst ? `<span class="n">${optInst}</span>` : '' };
  const sub = { overview: 'tudo que deixa o PC pronto para jogar, num lugar só', optimize: g.active ? 'otimização ligada agora' : (g.windows ? 'plano de energia, prioridade e silêncio enquanto um jogo roda' : 'prioridade e silêncio enquanto um jogo roda'), redists: r.windows ? `${pl(r.items.filter(i => i.state === 'installed').length, 'instalada', 'instaladas')} · ${missing} faltando` : 'detecção só no Windows', optionals: o.windows ? `${optInst} de ${o.items.length} instalados` : 'instalação só no Windows' }[tab];
  const acts = { overview: `<button class="btn s" onclick="renderCentral()" title="Verificar de novo o que está instalado">${I.refresh} Verificar de novo</button>`, optimize: g.active ? `<button class="btn d" onclick="gamemodeStop()">${I.x} Desligar</button>` : `<button class="btn p" onclick="gamemodeRun()">${I.bolt} Otimizar agora</button>`,
    redists: `<button class="btn s" onclick="api.post('/api/redist/open',{})" title="Abrir a pasta redists\\">${I.folder}</button><button class="btn s" onclick="renderCentral()">${I.refresh} Re-checar</button>`,
    optionals: `<button class="btn s" onclick="optDeep()" title="Pergunta ao winget o que já está instalado (leva alguns segundos)">${I.refresh} Conferir instalados</button>` }[tab];
  $('#view').innerHTML = `<div class="h1"><h2>Central Ludrix</h2><span>${sub}</span><div class="acts">${ONLINE ? '' : '<span class="offl">sem conexão</span>'}${acts}</div></div>
    <div class="tabs ctabs">${CENTRAL_TABS.map(([id, n]) => `<button class="${tab === id ? 'on' : ''}" onclick="centralTab('${id}')">${n}${badge[id]}</button>`).join('')}</div>
    <div class="cbody">${body}</div>`;
  guide('central');
}
async function centralTab(id) { S.tab.central = id; await renderCentral(); }
function overviewHtml(g, r, o, mc) {
  const win = g.windows;
  const missing = r.items.filter(i => i.state === 'missing'), inst = r.items.filter(i => i.state === 'installed').length;
  const classic = (r.bundles || []).find(b => b.id === 'classic');
  const classicTodo = classic ? classic.items.filter(id => (r.items.find(i => i.id === id) || {}).state !== 'installed').length : 0;
  const optInst = o.items.filter(i => i.state === 'installed').length;
  const mcInst = mc.items.filter(i => i.installed), mcLib = mc.items.filter(i => i.in_library).length;
  const card = (id, icon, title, what, status, cls, acts) => `<div class="ccard ${cls || ''}"><div class="ch"><span class="ci">${icon}</span><div><b>${title}</b><small>${what}</small></div></div><div class="cs">${status}</div><div class="ca">${acts}<button class="btn s sm" onclick="centralTab('${id}')">Ver tudo ${I.ext}</button></div></div>`;
  const attention = [];
  if (r.windows && missing.length) attention.push(`<b>${missing.length}</b> ${missing.length > 1 ? 'dependências faltando' : 'dependência faltando'} — jogos podem fechar na hora`);
  if (o.windows && !o.winget) attention.push('winget não encontrado — os programas úteis só abrem pela Store');
  if (mcInst.length && !mcLib) attention.push('Minecraft instalado, mas ainda fora da Biblioteca');
  const gmStatus = g.active ? `<span class="pill ok">● ligada agora</span> <span>o PC está no modo de jogo até você desligar ou o jogo fechar</span>` : `<span class="pill">desligada</span> <span>${S.config.game_mode_auto ? 'liga sozinha ao abrir um jogo' : S.config.game_mode_ask !== false ? 'pergunto ao abrir um jogo' : 'fica no botão direito de cada jogo'}</span>`;
  return `${attention.length ? `<div class="note warn catt"><b>Precisa de atenção</b><ul>${attention.map(a => `<li>${a}</li>`).join('')}</ul></div>` : `<div class="note ok catt"><b>Tudo em ordem</b> — nada pendente por aqui — o PC está pronto para jogar.</div>`}
    <div class="cgrid">
    ${card('optimize', I.bolt, 'Otimizar antes de jogar', win ? 'Plano de energia, prioridade alta e silêncio enquanto o jogo roda; volta tudo ao normal depois.' : 'Prioridade alta e silêncio do launcher enquanto o jogo roda.', gmStatus, g.active ? 'on' : '', g.active ? `<button class="btn d sm" onclick="gamemodeStop()">${I.x} Desligar</button>` : `<button class="btn p sm" onclick="gamemodeRun()">${I.bolt} Otimizar agora</button>`)}
    ${card('redists', I.chip, 'Dependências', 'Bibliotecas que quase todo jogo exige (Visual C++, DirectX, .NET…). Sem elas o jogo fecha na hora ou reclama de .dll.', r.windows ? `<span class="pill ${missing.length ? 'warn' : 'ok'}">${missing.length ? missing.length + ' faltando' : 'todas instaladas'}</span> <span>${inst} de ${r.items.length} instaladas${missing.length ? ': ' + esc(missing.slice(0, 3).map(i => i.title).join(', ')) + (missing.length > 3 ? '…' : '') : ''}</span>` : '<span class="pill">só no Windows</span> <span>a detecção automática precisa do Windows</span>', missing.length ? 'warn' : '', r.windows && classic && classicTodo ? `<button class="btn p sm" ${ONLINE ? '' : 'disabled'} onclick="redistBundle('classic')">${I.dl} Instalar pacote Clássico</button>` : '')}
    ${card('optionals', I.win, 'Programas úteis', 'Lojas, launchers, runtimes, ferramentas e launchers de Minecraft. Nada é obrigatório; instala pelo winget ou pela Microsoft Store.', o.windows ? `<span class="pill">${optInst} de ${o.items.length}</span> <span>instalados no PC${o.winget ? '' : ' · winget não encontrado'}</span>` : '<span class="pill">só no Windows</span> <span>a instalação silenciosa precisa do winget</span>', '', o.windows ? `<button class="btn s sm" onclick="optDeep()">${I.refresh} Conferir instalados</button>` : '')}
    </div>`;
}
function optRow(i, o) {
  const j = S.jobs['optional:' + i.id];
  const st = i.state === 'installed' ? '<span class="pill ok">instalado</span>' : '';
  const canWg = o.windows && o.winget && (i.winget || []).length;
  const btns = j ? progHtml(j, 'optional:' + i.id) : `<div class="ta">${(i.winget || []).length ? `<button class="btn ${i.state === 'installed' ? 's' : 'p'}" ${canWg && ONLINE ? '' : 'disabled'} title="${canWg ? 'winget install ' + esc(i.winget.join(' + ')) : 'precisa do winget (Windows 10/11)'}" onclick="optInstall('${i.id}')">${I.dl} ${i.state === 'installed' ? 'Reinstalar' : 'Instalar'}</button>` : ''}<button class="btn s" onclick="optStore('${i.id}')" title="${i.store ? 'Abrir a página na Microsoft Store' : 'Procurar na Microsoft Store'}">${I.ext} Store</button></div>`;
  return `<div class="tile ${i.state === 'installed' ? 'ok' : ''}"><div class="tt"><b title="${esc(i.title)}">${esc(i.title)}</b>${st}</div><div class="td">${esc(i.desc)}</div>${btns}</div>`;
}
function optionalsHtml(o) {
  return `<div class="hint">Nada aqui é obrigatório. <b>Instalar</b> usa o winget (gerenciador de pacotes do próprio Windows) em silêncio, com andamento na Fila; <b>Store</b> abre a página na Microsoft Store. O Ludrix não guarda instaladores.</div>
    ${o.windows && !o.winget ? `<div class="note warn">O winget não foi encontrado. Ele vem com o "Instalador de Aplicativo" da Microsoft Store. <button class="lnk" onclick="optStore('winget')">Abrir na Store</button></div>` : ''}
    ${o.groups.map(g => `<div class="gh"><h3>${esc(g.name)}</h3><span>${esc(g.desc)}</span></div><div class="tiles">${o.items.filter(i => i.group === g.id).map(i => optRow(i, o)).join('')}</div>`).join('')}`;
}
function minecraftHtml(m) {
  const tile = i => {
    const j = S.jobs['mc:' + i.id];
    const st = i.installed ? `<span class="pill ok">${i.kind === 'store' ? 'Microsoft Store' : i.kind === 'jar' ? 'instalado (.jar)' : 'instalado'}</span>` : '';
    const lib = i.in_library ? `<span class="pill">na Biblioteca</span>` : '';
    let acts;
    if (j) acts = progHtml(j, 'mc:' + i.id);
    else if (i.installed) acts = `<div class="ta">${i.in_library ? `<button class="btn p" onclick="play(${jsq(i.in_library)})">${I.play} Jogar</button><button class="btn s" onclick="openGame(${jsq(i.in_library)})">${I.info || I.edit} Detalhes</button>` : `<button class="btn p" onclick="mcAdd('${i.id}')">${I.plus} Colocar na Biblioteca</button>`}${i.path && i.kind !== 'store' ? `<span class="pill" title="${esc(i.path)}" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.path.split(/[\\/]/).pop())}</span>` : ''}</div>`;
    else acts = `<div class="ta">${i.winget.length && m.windows ? `<button class="btn p" ${ONLINE ? '' : 'disabled'} title="winget install ${esc(i.winget.join(' '))}" onclick="mcInstall('${i.id}')">${I.dl} Instalar</button>` : ''}${i.store && m.windows ? `<button class="btn s" onclick="api.post('/api/minecraft/open',{id:'${i.id}',where:'store'})">${I.ext} Microsoft Store</button>` : ''}<button class="btn s" onclick="api.post('/api/minecraft/open',{id:'${i.id}',where:'site'})">${I.ext} Site</button><button class="btn s" onclick="mcLocate('${i.id}')" title="Já tenho: apontar o executável">${I.folder} Localizar</button></div>`;
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
  return `<div class="gh" style="margin-top:22px"><h3>Minecraft</h3><span>edições encontradas e launchers sugeridos</span></div><div class="hint">O Ludrix não substitui o launcher do Minecraft: ele descobre qual edição está no PC (Java e Bedrock), coloca na Biblioteca e, ao clicar em Jogar, abre pelo launcher certo (conta, versões e mods continuam lá). Se não houver launcher para o Java, o Ludrix indica um. <b>Instalar</b> usa o winget em silêncio, com andamento na Fila; se você instalou em outra pasta, use <b>Localizar</b>.</div>
    <div class="gh"><h3>No seu PC</h3><span>Edições encontradas neste computador</span></div><div class="tiles">${eds}</div>
    ${m.windows && !S.opt.winget ? `<div class="note warn">O winget não foi encontrado. Ele vem com o "Instalador de Aplicativo" da Microsoft Store. <button class="lnk" onclick="optStore('winget')">Abrir na Store</button></div>` : ''}
    <div class="gh"><h3>Launchers</h3><span>os instalados e dois sugeridos: Prism Launcher (código aberto, modpacks) e SKLauncher (leve e prático)</span></div><div class="tiles">${show.map(tile).join('')}</div>`;
}
async function mcAdd(id) { const r = await api.post('/api/minecraft/add', { id }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); toast('ok', 'Minecraft na Biblioteca', r.launcher || id === 'bedrock' ? 'Clique em Jogar para abrir.' : 'Ao clicar em Jogar, o Ludrix indica um launcher.', r.key ? [{ label: 'Abrir', fn: () => { setView('home'); openGame(r.key); } }] : null); await loadCatalog(); if (S.view === 'central') renderCentral(); }
async function mcLocate(id) { const r = await api.post('/api/minecraft/locate', { id }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); if (r.ok) { toast('ok', 'Minecraft na Biblioteca', 'Launcher apontado com sucesso.'); await loadCatalog(); if (S.view === 'central') renderCentral(); } }
async function mcSetLauncher(id) { const r = await api.post('/api/minecraft/launcher', { id }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); toast('ok', 'Minecraft', 'Java Edition passa a abrir por esse launcher.'); await loadCatalog(); if (S.view === 'central') renderCentral(); }
function mcNeedLauncher(r) {
  const recs = (r.recommend || []).map((x, i) => `<div class="tile ${i === 0 ? 'ok' : ''}"><div class="tt"><b>${esc(x.title)}</b>${i === 0 ? '<span class="pill ok">recomendado</span>' : ''}</div><div class="td">${esc(x.why)} ${esc(x.desc)}</div><div class="ta">${x.winget.length && r.winget ? `<button class="btn p sm" ${ONLINE ? '' : 'disabled'} onclick="$('#modal').classList.remove('on');mcInstall('${x.id}');setView('central');centralTab('optionals')">${I.dl} Instalar</button>` : ''}${x.store ? `<button class="btn s sm" onclick="api.post('/api/minecraft/open',{id:'${x.id}',where:'store'})">${I.ext} Microsoft Store</button>` : ''}<button class="btn s sm" onclick="api.post('/api/minecraft/open',{id:'${x.id}',where:'site'})">${I.ext} Site</button><button class="btn s sm" onclick="$('#modal').classList.remove('on');mcLocate('${x.id}')">${I.folder} Já tenho</button></div></div>`).join('');
  modal({ title: 'Falta um launcher de Minecraft', html: `<p>O Minecraft Java Edition está no PC, mas nenhum launcher para abri-lo. O launcher cuida da conta, das versões e dos mods; escolha um:</p><div class="tiles" style="margin-top:10px">${recs}</div><p class="mut" style="margin-top:10px">Outros launchers (MultiMC, ATLauncher, Modrinth, CurseForge…) ficam em Central › Minecraft.</p>`, wide: true, ok: 'Não fazer nada', noCancel: true });
}
function mcNeedBedrock(r) {
  modal({ title: 'Minecraft Bedrock não está instalado', text: 'A edição Bedrock vem pela Microsoft Store. Depois de instalar, volte e clique em Jogar.', ok: 'Abrir na Microsoft Store', cancel: 'Não fazer nada', onOk: () => api.post('/api/minecraft/open', { id: 'bedrock', where: 'store' }) });
}
async function mcInstall(id) { const r = await api.post('/api/minecraft/install', { id }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); S.jobs['mc:' + id] = { stage: 'install', fraction: 0, detail: 'Iniciando…' }; $('#dlDot').classList.add('on'); renderCentral(); }
async function optInstall(id) { const r = await api.post('/api/optional/install', { id }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); S.jobs['optional:' + id] = { stage: 'install', fraction: 0, detail: 'Iniciando…' }; $('#dlDot').classList.add('on'); renderCentral(); pollSoon(); }
async function optStore(id) { const r = await api.post('/api/optional/store', { id }); if (r.error) toast('err', 'Não foi possível concluir', r.error); }
async function optDeep() { toast('', 'Conferindo com o winget…', 'Leva alguns segundos.'); const o = await api.get('/api/optionals?deep=1'); if (S.view !== 'central') return; S.opt = o; renderCentral(); }

function redistsHtml(r) {
  const st = { installed: ['ok', 'instalado'], missing: ['warn', 'faltando'], unknown: ['', ''] };
  const jobOf = id => S.jobs['redist:' + id];
  const bundleJob = id => S.jobs['redist:bundle:' + id];
  const item = i => { const j = jobOf(i.id); return `<div class="tile ${st[i.state][0]}"><div class="tt"><b title="${esc(i.title)}">${esc(i.title)}</b><span class="pill">${esc(i.arch)}</span>${st[i.state][1] ? `<span class="pill ${st[i.state][0] === 'warn' ? 'warn' : st[i.state][0]}">${st[i.state][1]}</span>` : ''}</div>${i.note ? `<div class="td">${esc(i.note)}</div>` : ''}
    ${j ? progHtml(j, 'redist:' + i.id) : `<div class="ta">${i.state === 'installed' ? `<button class="btn s" onclick="redistInstall('${i.id}')" title="Reinstalar/reparar">${I.refresh} Reparar</button>` : `<button class="btn ${i.state === 'missing' ? 'p' : 's'}" ${ONLINE || i.downloaded ? '' : 'disabled'} onclick="redistInstall('${i.id}')">${I.dl} Instalar${i.downloaded ? '' : ' · ' + fmt(i.size)}</button>`}</div>`}</div>`; };
  return `<div class="hint">Jogo que fecha na hora ou reclama de <span class="code">.dll</span> faltando quase sempre pede uma destas bibliotecas. Instaladores oficiais (Microsoft/OpenAL), silenciosos, guardados em <span class="code">redists\\</span>.</div>
    <details class="exp"><summary>Qual instalar?</summary><div>Sem saber qual, use o pacote <b>Clássico</b> (cobre quase tudo). Se um jogo reclamar de uma <span class="code">.dll</span> específica: <span class="code">msvcp/vcruntime</span> → Visual C++ do ano indicado · <span class="code">d3dx9/d3dx10/d3dx11/xinput1_3</span> → DirectX · <span class="code">xna</span> → XNA · <span class="code">openal32</span> → OpenAL · <span class="code">.NET Framework</span> → .NET. Cada jogo carrega a versão para a qual foi feito, por isso é normal ter várias instaladas.</div></details>
    <div class="gh"><h3>Pacotes</h3><span>instalam várias de uma vez</span></div>
    <div class="tiles narrow">${r.bundles.map(b => { const j = bundleJob(b.id); const todo = b.items.filter(id => (r.items.find(i => i.id === id) || {}).state !== 'installed').length; return `<div class="tile"><div class="tt"><b>${esc(b.title)}</b></div><div class="td">${esc(b.desc)}</div>${j ? progHtml(j, 'redist:bundle:' + b.id) : `<div class="ta"><button class="btn ${b.id === 'classic' ? 'p' : 's'}" ${todo && ONLINE ? '' : 'disabled'} onclick="redistBundle('${b.id}')">${I.dl} ${todo ? `Instalar ${todo === 1 ? '1 que falta' : todo + ' que faltam'}` : 'Tudo instalado'}</button></div>`}</div>`; }).join('')}</div>
    ${r.groups.map(g => `<div class="gh"><h3>${esc(g.name)}</h3><span>${esc(g.desc)}</span></div><div class="tiles wide">${r.items.filter(i => i.group === g.id).map(item).join('')}</div>`).join('')}`;
}
async function redistInstall(id) { const r = await api.post('/api/redist/install', { id }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); S.jobs['redist:' + id] = { stage: 'download', fraction: 0, detail: 'Iniciando…' }; renderCentral(); pollSoon(); }
async function redistBundle(id) { const r = await api.post('/api/redist/bundle', { id }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); if (r.queued === 0) return toast('ok', 'Já está tudo instalado', ''); S.jobs['redist:bundle:' + id] = { stage: 'download', fraction: 0, detail: 'Iniciando…' }; renderCentral(); pollSoon(); }

function gamemodeHtml(g) {
  const c = S.config; const sw = (k, label, desc) => `<div class="frow"><div class="l"><b>${label}</b><span>${desc}</span></div><button class="sw ${c[k] !== false ? 'on' : ''}" onclick="setCfg({${k}:!(S.config.${k}!==false)}).then(renderCentral)"></button></div>`;
  const list = c.game_mode_close || [];
  const when = c.game_mode_auto ? 'auto' : c.game_mode_ask !== false ? 'ask' : 'off';
  const PLANS = { high: ['Alto desempenho', 'O plano "Alto desempenho" do próprio Windows: a CPU não baixa o clock enquanto você joga.'], ultimate: ['Desempenho máximo', 'Modelo "Ultimate Performance" do Windows: sem estados de economia, latência mínima. É criado na primeira vez.'], khorvie: ['Khorvie (comunidade)', 'Plano da comunidade com ajustes agressivos de CPU/USB/PCIe para jogos competitivos. É importado na primeira vez.'] };
  const plan = c.game_mode_plan || 'high';
  return `<div class="gstate ${g.active ? 'on' : ''}"><div class="dot"></div><div class="tx"><b>${g.active ? 'Ligado agora' : 'Desligado'}</b><span>${g.active ? `O PC está no modo de jogo${g.plan ? ` · plano de energia: ${esc(g.plan)}` : ''}. Ao fechar o jogo tudo volta como estava.` : !g.windows ? 'Plano de energia e prioridade só funcionam no Windows.' : 'Enquanto um jogo roda: plano de energia de desempenho, prioridade alta para o jogo, apps da sua lista fechados e o Ludrix em silêncio. Nada de "limpar RAM" ou mexer em serviços.'}</span></div></div>
    <div class="gmwrap">
      <div class="sec"><h3>Quando ligar</h3>
        <div class="frow"><div class="l"><b>Ao abrir um jogo</b><span>${{ auto: 'Liga em todo jogo, sem perguntar', ask: 'Aparece como "Otimizar e abrir" no botão direito do jogo', off: 'Só quando você clicar em "Ligar agora"' }[when]}</span></div>${selHtml([['auto', 'Sempre'], ['ask', 'No menu do jogo'], ['off', 'Nunca']], when, "gmWhen(this.value)")}</div>
        <h4>O que ele faz</h4>
        ${g.windows ? sw('game_mode_power', 'Plano de energia de desempenho', 'Troca enquanto joga e restaura o plano anterior quando o jogo fecha') : ''}
        ${g.windows && c.game_mode_power !== false ? `<div class="frow"><div class="l"><b>Qual plano</b><span>${PLANS[plan][1]}</span></div>${cfgSel('game_mode_plan', Object.entries(PLANS).map(([v, [l]]) => [v, l]), plan, '.then(renderCentral)')}</div>` : ''}
        ${sw('game_mode_priority', 'Prioridade alta para o jogo', g.windows ? 'O processo do jogo recebe prioridade Alta no Windows (o launcher e o resto cedem CPU)' : 'O processo do jogo recebe prioridade maior (o launcher e o resto cedem CPU)')}
        ${sw('game_mode_quiet', 'Ludrix em silêncio', 'Pausa a busca de capas e informações e deixa os torrents em marcha lenta enquanto o jogo roda; retoma depois')}
        ${sw('game_mode_reopen', 'Reabrir os apps fechados', 'Quando o jogo terminar, abre de novo o que foi fechado')}
      </div>
      <div class="sec"><h3>Apps que ele fecha</h3><p>Só o que estiver nesta lista é fechado (Discord, navegador, Spotify…). Nada de serviços do ${g.windows ? 'Windows' : 'sistema'}.</p>
        <div class="gmapps">${list.length ? list.map(n => { const run = g.running.find(r => r.name.toLowerCase() === n.toLowerCase()); return `<span class="gmapp on"><b>${esc(n)}</b>${run ? `<small>${fmt(run.mem)}</small>` : '<small>fechado</small>'}<button onclick="gmToggle(${jsq(n)})" title="Tirar da lista">${I.x}</button></span>`; }).join('') : '<span style="color:var(--muted2);font-size:12.5px">Nenhum. Clique num app abaixo para adicionar.</span>'}</div>
        <h4>Rodando agora (sugestões)</h4>
        <div class="gmapps">${g.running.filter(r => !list.some(n => n.toLowerCase() === r.name.toLowerCase())).map(r => `<span class="gmapp" onclick="gmToggle(${jsq(r.name)})"><b>${esc(r.name)}</b><small>${fmt(r.mem)}</small><i>+</i></span>`).join('') || '<span style="color:var(--muted2);font-size:12.5px">Nenhum dos apps comuns está aberto.</span>'}</div>
        <div class="mrow" style="margin-top:10px"><input class="mi" id="gmAdd" placeholder="${g.windows ? 'outro .exe (ex.: Wallpaper32.exe)' : 'outro programa (ex.: discord)'}" onkeydown="if(event.key==='Enter')gmToggle(this.value)"><button class="btn s sm" onclick="gmToggle($('#gmAdd').value)">Adicionar</button></div>
      </div>
    </div>`;
}
async function gmToggle(name) { name = (name || '').trim(); if (!name) return; const list = [...(S.config.game_mode_close || [])]; const i = list.findIndex(n => n.toLowerCase() === name.toLowerCase()); if (i >= 0) list.splice(i, 1); else list.push(name); await setCfg({ game_mode_close: list }); renderCentral(); }
const gmSummary = r => [r.power ? 'plano ' + (r.plan || 'Alto desempenho') : '', r.closed?.length ? `fechei ${r.closed.join(', ')}` : '', r.quiet ? 'Ludrix em silêncio' : ''].filter(Boolean).join(' · ') || 'nada a fazer';
async function gamemodeRun() { const r = await api.post('/api/gamemode/run', {}); if (r.error) return toast('err', 'Não foi possível concluir', r.error); toast('ok', 'Modo Game ligado', gmSummary(r)); if (S.view === 'central') renderCentral(); }
async function gamemodeStop() { const r = await api.post('/api/gamemode/restore', {}); if (r.error) return toast('err', 'Não foi possível concluir', r.error); toast('', 'Modo Game desligado', [r.reopened?.length ? `reabri ${r.reopened.join(', ')}` : '', r.power ? 'plano de energia restaurado' : ''].filter(Boolean).join(' · ') || 'tudo de volta ao normal'); if (S.view === 'central') renderCentral(); }

const GUIDES = {
  central: [
    { at: '.ctabs', t: 'Três partes', d: '"Otimizar antes de jogar" prepara o PC enquanto o jogo roda; "Dependências" resolve jogo que não abre; "Programas úteis" é a lista completa dos opcionais.', pos: 'bottom' },
    { at: '.h1 .btn.p, .h1 .btn.d', t: 'Otimizar agora', d: 'Liga a otimização na hora, sem abrir jogo nenhum. Ao desligar, tudo volta como estava.', pos: 'left' },
  ],
  detail: [
    { at: '#dWrap .btn.g, #dWrap .btn.p', t: 'Jogar ou baixar', d: 'O botão principal abre o jogo (ou baixa, se ele ainda não está no PC). Botão direito na capa mostra mais ações.', pos: 'right' },
    { at: '#dWrap .row .btn', t: 'Pasta, saves e edição', d: 'Abra a pasta do jogo, cuide dos saves ou edite nome, capa e executável em "Editar".', pos: 'top' },
    { at: '#metaBtn', t: 'Capa e informações', d: 'Se a capa ou a descrição vierem erradas, busque de novo escolhendo a fonte que preferir.', pos: 'left' },
  ],
  store: [
    { at: '.h1 .btn[onclick*="sources"], .top .search, .titlebar .search', t: 'Fontes de jogos', d: 'A Store mostra o catálogo das fontes ligadas. Nada é baixado sem você pedir; ligue ou desligue fontes em "Fontes de jogos".', pos: 'bottom' },
    { at: '#chips', t: 'Categorias', d: 'Filtre por categoria aqui; a busca (tecla /) e a ordenação ficam na barra de tarefas.', pos: 'bottom' },
  ],
  emulation: [
    { at: '.tabs button:first-child', t: 'Consoles', d: 'Cada console mostra os emuladores disponíveis. Instale um e aponte a pasta das suas ROMs.', pos: 'bottom' },
    { at: '.tabs button:last-child', t: 'Baixar ROMs', d: 'Fontes de ROM que você ligou. A ROM só entra na Biblioteca depois de baixada.', pos: 'bottom' },
  ],
  downloads: [
    { at: '.item.q', t: 'Fila', d: 'Cada download mostra andamento e ações (pausar, cancelar, tentar de novo). O histórico fica aqui até você limpar.', pos: 'bottom' },
  ],
  settings: [
    { at: '.stabs', t: 'Ajustes por assunto', d: 'Uma aba por assunto: comportamento, aparência, exibição dos jogos, ao jogar. A busca no alto acha qualquer opção.', pos: 'right' },
    { at: '.sec:first-of-type', t: 'Aplicação imediata', d: 'Quase tudo aplica na hora. O que precisa reabrir o Ludrix está marcado com "reiniciar".', pos: 'top' },
  ],
};
const G = { id: null, i: 0, el: null };
function guide(id, delay = 450) {
  if (S.config.guides === false || !S.config.welcome_done || !GUIDES[id]) return;
  if (G.id === id) { const st = GUIDES[id][G.i], el = st && document.querySelector(st.at); if (el && el.offsetParent !== null) guideShow(st, el); else guideNext(); return; }
  if ((S.config.guides_done || []).includes(id) || G.id) return;
  if ($('#modal').classList.contains('on') || $('#welcome')) return;
  G.id = id; G.i = -1;
  setTimeout(() => guideNext(), delay);
}
function guideNext() {
  if (!G.id) return;
  const steps = GUIDES[G.id];
  for (G.i++; G.i < steps.length; G.i++) { const el = document.querySelector(steps[G.i].at); if (el && el.offsetParent !== null) return guideShow(steps[G.i], el); }
  guideEnd(true);
}
function guideShow(st, target) {
  if (!G.el) { G.el = document.createElement('div'); G.el.className = 'guide'; document.body.append(G.el); }
  const steps = GUIDES[G.id], n = steps.length, last = G.i >= n - 1;
  G.el.innerHTML = `<div class="gbody"><b>${esc(st.t)}</b><p>${esc(st.d)}</p><div class="gact"><span class="gdots">${steps.map((_, k) => `<i class="${k === G.i ? 'on' : ''}"></i>`).join('')}</span><span class="sp"></span><button class="btn s xs" onclick="guideEnd(false)">Pular</button><button class="btn p xs" onclick="guideNext()">${last ? 'Entendi' : 'Próximo'}</button></div></div><i class="garrow"></i>`;
  target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  document.querySelectorAll('.gtarget').forEach(e => e.classList.remove('gtarget')); target.classList.add('gtarget');
  G.el.className = 'guide ' + (st.pos || 'bottom'); G.el.style.visibility = 'hidden'; G.el.style.display = 'block';
  requestAnimationFrame(() => {
    const r = target.getBoundingClientRect(), w = G.el.offsetWidth, h = G.el.offsetHeight, m = 12;
    let x, y, pos = st.pos || 'bottom';
    if (pos === 'bottom' && r.bottom + h + m > innerHeight) pos = 'top'; if (pos === 'top' && r.top - h - m < 0) pos = 'bottom';
    if (pos === 'left' && r.left - w - m < 0) pos = 'bottom'; if (pos === 'right' && r.right + w + m > innerWidth) pos = 'bottom';
    if (pos === 'bottom') { x = r.left + r.width / 2 - w / 2; y = r.bottom + m; } else if (pos === 'top') { x = r.left + r.width / 2 - w / 2; y = r.top - h - m; }
    else if (pos === 'left') { x = r.left - w - m; y = r.top + r.height / 2 - h / 2; } else { x = r.right + m; y = r.top + r.height / 2 - h / 2; }
    x = Math.max(8, Math.min(innerWidth - w - 8, x)); y = Math.max(8, Math.min(innerHeight - h - 8, y));
    G.el.className = 'guide on ' + pos; G.el.style.left = x + 'px'; G.el.style.top = y + 'px'; G.el.style.visibility = '';
    const ar = G.el.querySelector('.garrow'); if (ar) { if (pos === 'bottom' || pos === 'top') ar.style.left = Math.max(14, Math.min(w - 14, r.left + r.width / 2 - x)) + 'px'; else ar.style.top = Math.max(14, Math.min(h - 14, r.top + r.height / 2 - y)) + 'px'; }
  });
}
function guideEnd(done) {
  const id = G.id; if (!id) return;
  G.id = null; G.i = 0;
  document.querySelectorAll('.gtarget').forEach(e => e.classList.remove('gtarget'));
  if (G.el) { G.el.classList.remove('on'); G.el.style.display = 'none'; }
  const list = [...(S.config.guides_done || [])]; if (!list.includes(id)) { list.push(id); S.config.guides_done = list; api.post('/api/config', { guides_done: list }); }
  void done;
}
function guidesReset() { setCfg({ guides: true, guides_done: [] }).then(() => toast('ok', 'Guias reativados', 'Os balões voltam a aparecer na primeira vez que você usar cada parte do Ludrix.')); }
function guideDismiss() { if (!G.id) return; G.id = null; document.querySelectorAll('.gtarget').forEach(e => e.classList.remove('gtarget')); if (G.el) { G.el.classList.remove('on'); G.el.style.display = 'none'; } }

function hashStr(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
async function installFlash(id) { const r = await api.post('/api/flash/install', { id }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); S.jobs['flash:' + id] = { stage: 'download', fraction: 0, detail: 'Iniciando…' }; $('#dlDot').classList.add('on'); renderFlash(); pollSoon(); }
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
      <button class="sact" ${s.dir ? '' : 'disabled'} onclick="api.post('/api/open',{path:${jsq(s.dir)}})">${I.folder}<div><b>Abrir pasta</b><small>Ver os arquivos de save no Explorer</small></div></button>
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
    ${id === 'playnite' ? `<label class="mchk" style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12.5px"><input type="checkbox" id="impHidden" ${S.config.import_hidden ? 'checked' : ''}> Incluir jogos marcados como ocultos no Playnite</label>` : ''}
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
  IMP.games = r.games;
  if (!r.games.length) return modal({ title: 'Nada encontrado', text: 'Nenhum jogo nesse local. Confira a dica do que selecionar.', ok: 'Tentar de novo', extra: '← Voltar', onExtra: importWizard, onOk: () => importPick(id) });
  const sysPill = g => g.kind === 'emulator' ? `<span class="pill ac">emulador${g.systems && g.systems.length ? ' · ' + g.systems.map(x => S.systems[x] || x).join(', ') : ''}</span>` : `<span class="pill">${g.system && g.system !== 'pc' ? esc(S.systems[g.system] || g.system) : (g.rom_dir ? '<span style="color:var(--amber)">console?</span>' : 'PC')}</span>`;
  const row = (g, i) => `<label class="impg ${g.dup ? 'dup' : ''}"><input type="checkbox" data-i="${i}" ${g.dup ? '' : 'checked'}>${g.cover_file ? `<img class="impcov" src="/api/import/cover?p=${enc(g.cover_file)}" loading="lazy" alt="">` : g.kind === 'emulator' ? `<span class="impcov ic">${I.gamepad}</span>` : g.rom_dir ? `<span class="impcov ic">${I.folder}</span>` : '<span class="impcov ic"></span>'}<div class="t"><b>${esc(g.title)}</b><small>${g.rom_dir ? 'pasta de ROMs · ' + esc(g.rom_dir) : esc(g.exe || g.rom || g.emu_dir || g.dir || '')}${g.emulator && !g.kind ? ` · via ${esc(g.emulator)}` : ''}</small></div>${sysPill(g)}${g.playtime > 60 ? `<span class="pill">${Math.round(g.playtime / 3600) || '<1'} h</span>` : ''}${g.favorite ? '<span class="pill ac">★</span>' : ''}${g.hidden ? '<span class="pill" title="Marcado como oculto no Playnite">oculto</span>' : ''}${g.missing ? '<span class="pill warn" title="O arquivo não foi encontrado neste PC">arquivo ausente</span>' : ''}${g.dup ? '<span class="pill warn">já tem</span>' : ''}</label>`;
  const nE = r.games.filter(g => g.kind === 'emulator').length, nD = r.games.filter(g => g.rom_dir).length, nG = r.games.length - nE - nD;
  const html = `<div class="imphead"><span>${pl(nG, 'jogo', 'jogos')}${nE ? ` · ${pl(nE, 'emulador', 'emuladores')}` : ''}${nD ? ` · ${pl(nD, 'pasta', 'pastas')} de ROMs` : ''} · ${r.games.filter(g => g.dup).length} já ${r.games.filter(g => g.dup).length === 1 ? 'configurado' : 'configurados'}</span><span style="flex:1"></span><input class="mi" id="impQ" placeholder="Filtrar…" style="width:150px;height:30px;margin:0" oninput="impFilter(this.value)"><select class="mi" style="width:auto;height:30px;margin:0" onchange="impSort(this.value)" title="Ordem da lista"><option value="az">A–Z</option><option value="play">Mais jogados</option><option value="new">Novos primeiro</option></select><button class="btn s sm" onclick="document.querySelectorAll('.impg input').forEach(c=>c.checked=true);impCount()">Marcar todos</button><button class="btn s sm" onclick="document.querySelectorAll('.impg input').forEach(c=>c.checked=!c.closest('.impg').classList.contains('dup'));impCount()" title="Marca só o que ainda não está na biblioteca">Só novos</button><button class="btn s sm" onclick="document.querySelectorAll('.impg input').forEach(c=>c.checked=!c.checked);impCount()" title="Troca marcados por desmarcados">Inverter</button><button class="btn s sm" onclick="document.querySelectorAll('.impg input').forEach(c=>c.checked=false);impCount()">Desmarcar</button></div><div class="impgames" onchange="impCount()">${r.games.map(row).join('')}</div>`;
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
    if (a.skipped && (a.skipped_items || []).length) importSummary(a); else toast('ok', 'Importação concluída', `${pl(a.added, 'adicionado', 'adicionados')}${a.skipped ? ' · ' + pl(a.skipped, 'ignorado', 'ignorados') : ''}`, [{ label: 'Ver adicionados', fn: () => flagOnly('added') }, { label: 'OK', fn: () => {} }]);
    TH.err.clear(); TH.tries = {}; S.home = null;
    S.view = ''; setView('home'); await loadCatalog(false);
  } });
}
