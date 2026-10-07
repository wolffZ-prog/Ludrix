'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const TOKEN = document.querySelector('meta[name=ludrix-token]')?.content || '';
const api = (p, body) => fetch(p, body ? {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Ludrix-Token': TOKEN}, body: JSON.stringify(body)} : {headers: {'X-Ludrix-Token': TOKEN}}).then(r => r.json());
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const LOGO = '<svg viewBox="0 0 128 128"><defs><linearGradient id="vg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff7fae"/><stop offset=".3" stop-color="#ffb37a"/><stop offset=".55" stop-color="#ffe58a"/><stop offset=".78" stop-color="#7fe6c6"/><stop offset="1" stop-color="#6fb6ff"/></linearGradient><linearGradient id="vs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><filter id="vb" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4"/></filter><filter id="vb2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2"/></filter></defs><rect x="2" y="2" width="124" height="124" rx="28" fill="#1a1d22"/><path d="M24 52 Q24 40 36 40 H92 Q104 40 104 52 L109 78 Q110 92 97 92 Q88 92 83 82 L78 72 H50 L45 82 Q40 92 31 92 Q18 92 19 78 Z" fill="none" stroke="url(#vg)" stroke-width="7" opacity=".45" filter="url(#vb)"/><path d="M24 52 Q24 40 36 40 H92 Q104 40 104 52 L109 78 Q110 92 97 92 Q88 92 83 82 L78 72 H50 L45 82 Q40 92 31 92 Q18 92 19 78 Z" fill="#23272e"/><path d="M24 52 Q24 40 36 40 H92 Q104 40 104 52 L109 78 Q110 92 97 92 Q88 92 83 82 L78 72 H50 L45 82 Q40 92 31 92 Q18 92 19 78 Z" fill="url(#vs)"/><path d="M24 52 Q24 40 36 40 H92 Q104 40 104 52 L109 78 Q110 92 97 92 Q88 92 83 82 L78 72 H50 L45 82 Q40 92 31 92 Q18 92 19 78 Z" fill="none" stroke="url(#vg)" stroke-width="3.2" stroke-linejoin="round"/><g filter="url(#vb2)" opacity=".9"><rect x="44.75" y="53.0" width="4.5" height="14" rx="1.5" fill="#ffd27a"/><rect x="40.0" y="57.75" width="14" height="4.5" rx="1.5" fill="#ffd27a"/><circle cx="81" cy="53.5" r="2.8" fill="#8be0c4"/><circle cx="87.5" cy="60" r="2.8" fill="#6fb3f2"/><circle cx="81" cy="66.5" r="2.8" fill="#f3d58a"/><circle cx="74.5" cy="60" r="2.8" fill="#f5a07f"/></g><rect x="44.75" y="53.0" width="4.5" height="14" rx="1.5" fill="#ffd27a"/><rect x="40.0" y="57.75" width="14" height="4.5" rx="1.5" fill="#ffd27a"/><circle cx="81" cy="53.5" r="2.8" fill="#8be0c4"/><circle cx="87.5" cy="60" r="2.8" fill="#6fb3f2"/><circle cx="81" cy="66.5" r="2.8" fill="#f3d58a"/><circle cx="74.5" cy="60" r="2.8" fill="#f5a07f"/></svg>';
const IC = {
  x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>', pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>', refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
  sort: '<svg viewBox="0 0 24 24"><path d="M3 9l4-4 4 4M7 5v14M21 15l-4 4-4-4M17 19V5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>', stop: '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 17.75-6.17 3.25 1.18-6.88L2 9.25l6.9-1L12 2l3.1 6.25 6.9 1-5 4.87 1.18 6.88z"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M5 12h14M5 12l6 6M5 12l6-6"/></svg>',
  win: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/></svg>',
  power: '<svg viewBox="0 0 24 24"><path d="M7 6a7.75 7.75 0 1 0 10 0M12 4v8"/></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 3v7h6l-8 11v-7H5z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>',
  dice: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1"/><circle cx="15.5" cy="15.5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="15.5" cy="8.5" r="1"/><circle cx="8.5" cy="15.5" r="1"/></svg>',
};
const S = {data: null, games: [], byKey: {}, view: 'library', sel: 0, sys: '', q: '', focus: 'strip', fx: 0, fi: 0, list: [], busy: {}, layer: null, lastPing: 0, more: false, sig: ''};
const ZONES = ['top', 'head', 'acts', 'strip'];
function zoneEls(z) {
  if (z === 'acts') return $$('#sttxt .btn');
  if (z === 'head') return $$('#main .head .tab, #main .head .sys button');
  if (z === 'top') return $$('#chip.on, #dlpill:not([hidden]), #exitBtn');
  return [];
}
function setFocus(z, i, step) {
  $$('.gp').forEach(e => { if (!e.closest('.over')) e.classList.remove('gp'); });
  if (z !== 'strip') {
    const els = zoneEls(z);
    if (!els.length) {
      const nz = ZONES[ZONES.indexOf(z) + (step || 1)];
      return setFocus(nz && nz !== 'strip' ? nz : 'strip', 0, step);
    }
    S.fx = ((i % els.length) + els.length) % els.length;
    els[S.fx].classList.add('gp');
  }
  S.focus = z;
  document.body.classList.toggle('zoned', z !== 'strip');
}
function legend(pad) {
  const el = $('#legend'); if (!el) return;
  el.innerHTML = pad
    ? '<span><b class="k a">A</b>Jogar</span><span><b class="k b">B</b>Voltar</span><span><b class="k x">X</b>Opções</span><span><b class="k y">Y</b>Buscar</span><span><b class="k lb">LB</b><b class="k rb">RB</b>Abas</span><span><b class="k st">≡</b>Menu</span>'
    : '<span><b class="k kb">Enter</b>Jogar</span><span><b class="k kb">Esc</b>Voltar</span><span><b class="k kb">M</b>Opções</span><span><b class="k kb">F</b>Buscar</span><span><b class="k kb">Tab</b>Abas</span><span><b class="k kb">↑ ↓</b>Botões</span>';
}
const VIEWS = ['library', 'recent', 'favorites', 'queue', 'settings'];
const VNAME = {library: 'Biblioteca', recent: 'Recentes', favorites: 'Favoritos', queue: 'Fila', settings: 'Ajustes'};
const tabsHtml = () => `<div class="tabs">${VIEWS.map(v => `<button class="tab${S.view === v ? ' on' : ''}" data-view="${v}">${VNAME[v]}${v === 'queue' ? '<i class="dot" id="qdot"></i>' : ''}</button>`).join('')}</div>`;
const bindTabs = () => $$('.tab').forEach(t => t.onclick = () => setView(t.dataset.view));
const SYSN = k => (S.data && S.data.systems && S.data.systems[k]) || k || '';

async function load(first) {
  const d = await api('/api/console');
  S.data = d;
  S.byKey = {}; d.games.forEach(g => S.byKey[g.key] = g);
  document.body.dataset.theme = d.theme || 'noite';
  document.body.classList.toggle('nolegend', !d.config.console_hint);
  document.body.dataset.cards = d.config.console_card_size || 'normal';
  clock(); idleArm();
  const pad = $('#padInd'); pad.classList.toggle('on', d.gamepad.connected > 0); $('#padN').textContent = d.gamepad.connected;
  if (first) {
    if (VIEWS.includes(d.config.console_start_view) && d.config.console_start_view !== 'library') S.view = d.config.console_start_view;
    $('#brand').innerHTML = LOGO;
    $('#brand').onclick = () => confirmQuit();
    legend(d.gamepad.connected > 0);
    render();
  } else if (!S.layer) render(true);
}

function listFor(view) {
  let g = S.data.games;
  if (view === 'recent') g = S.data.recent.map(k => S.byKey[k]).filter(Boolean);
  if (view === 'favorites') g = g.filter(x => x.fav);
  if (S.sys) g = g.filter(x => (x.system || 'pc') === S.sys);
  if (S.q) { const q = S.q.toLowerCase(); g = g.filter(x => (x.title || '').toLowerCase().includes(q)); }
  const srt = S.data.config.console_sort || 'title';
  if (view !== 'recent' && srt !== 'title') { g = [...g]; if (srt === 'recent') g.sort((a, b) => (b.last_played || 0) - (a.last_played || 0)); else if (srt === 'playtime') g.sort((a, b) => (b.playtime || 0) - (a.playtime || 0)); else if (srt === 'count') g.sort((a, b) => (b.play_count || 0) - (a.play_count || 0) || (b.playtime || 0) - (a.playtime || 0)); else if (srt === 'added') g.sort((a, b) => (b.installed_at || 0) - (a.installed_at || 0)); }
  if (S.data.config.fav_first && view !== 'recent' && view !== 'favorites') g = g.filter(x => x.fav).concat(g.filter(x => !x.fav));
  return g;
}
const SORTN = {title: 'A–Z', recent: 'Jogados por último', playtime: 'Mais jogados', count: 'Mais vezes jogados', added: 'Adicionados por último'};

function render(keep) {
  const m = $('#main');
  document.body.classList.toggle('panel', S.view === 'queue' || S.view === 'settings');
  if (S.view === 'queue' || S.view === 'settings') {
    if (!STG.key && S.data.games.length) stageBg(S.data.games[Math.min(S.sel, S.data.games.length - 1)] || S.data.games[0]);
    return S.view === 'queue' ? renderQueue() : renderSettings();
  }
  S.games = listFor(S.view);
  const more = S.view !== 'library' && S.games.length > 0 && S.data.games.length > S.games.length;
  S.more = more;
  if (!keep) S.sel = 0; else S.sel = Math.min(S.sel, Math.max(0, S.games.length - (more ? 0 : 1)));
  const sig = S.view + '|' + S.games.map(g => g.key + (g.fav ? '*' : '') + (S.data.sessions[g.key] ? '!' : '')).join(',') + (more ? '|+' : '');
  if (keep && sig === S.sig && $('#strip') && $('#sttxt')) { if (S.sel < S.games.length) stage(S.games[S.sel], true); return; }
  S.sig = sig; S.focus = 'strip'; document.body.classList.remove('zoned');
  if (!S.games.length) {
    const msg = S.q ? ['Nada encontrado', 'Tente outro nome ou limpe a busca (Y).'] :
      S.view === 'favorites' ? ['Nenhum favorito', 'Marque um jogo com X › Favoritar e ele aparece aqui.'] :
      S.view === 'recent' ? ['Nada jogado ainda', 'Os últimos jogos abertos ficam nesta aba.'] :
      ['Biblioteca vazia', 'Instale ou adicione jogos pelo Ludrix em janela; aqui aparecem só os instalados.'];
    m.innerHTML = `<div class="empty"><div><b>${msg[0]}</b>${msg[1]}</div></div><div class="head">${tabsHtml()}</div><div class="strip" id="strip"></div>`;
    bindTabs(); chip(null); stageClear(); S.sig = '';
    return;
  }
  const systems = [...new Set(S.data.games.map(g => g.system || 'pc'))];
  const sysBar = systems.length > 1 ? `<div class="sys"><button class="${S.sys ? '' : 'on'}" data-sys="">Todos</button>${systems.map(s => `<button class="${S.sys === s ? 'on' : ''}" data-sys="${esc(s)}">${esc(SYSN(s))}</button>`).join('')}</div>` : '';
  m.innerHTML = `
    <div class="txt" id="sttxt"></div>
    <div class="head">${tabsHtml()}<span class="n">${S.games.length} ${S.games.length === 1 ? 'jogo' : 'jogos'}${S.q ? ` · busca “${esc(S.q)}”` : ''}</span><div class="sp"></div>${sysBar}<div class="sys tools"><button data-tool="sort" title="Ordenar">${IC.sort || ''}${esc(SORTN[S.data.config.console_sort] || 'A–Z')}</button><button data-tool="grid" title="Ver todos em grade">${IC.grid}Grade</button></div></div>
    <div class="strip" id="strip">${S.games.map((g, i) => card(g, i)).join('')}${more ? `<div class="card more" data-i="${S.games.length}">${IC.grid}Todos os jogos<small>+${S.data.games.length - S.games.length}</small></div>` : ''}</div>`;
  fitCards();
  bindTabs();
  $$('#strip .card').forEach(c => { c.onclick = () => { const i = +c.dataset.i; if (c.classList.contains('more')) return setView('library'); if (S.focus !== 'strip') setFocus('strip', 0); if (i === S.sel) { const g = S.games[i]; if (S.data.sessions[g.key]) openMenu(); else play(g.key); } else select(i); }; c.ondblclick = () => { const i = +c.dataset.i; if (c.classList.contains('more')) return; const g = S.games[i]; if (g && !S.data.sessions[g.key]) play(g.key); }; c.oncontextmenu = e => { e.preventDefault(); if (c.classList.contains('more')) return; select(+c.dataset.i); openMenu(); }; });
  $$('.head .sys button[data-sys]').forEach(b => b.onclick = () => { S.sys = b.dataset.sys; render(); });
  $$('.head .tools button').forEach(b => b.onclick = () => b.dataset.tool === 'sort' ? sortMenu() : openGrid());
  select(S.sel, true);
}

function card(g, i) {
  const live = S.data.sessions[g.key];
  const k = encodeURIComponent(g.key);
  return `<div class="card${i === S.sel ? ' sel' : ''}" data-i="${i}" data-key="${esc(g.key)}">
    <img src="/hero/${k}" loading="lazy" alt="" onerror="if(!this.dataset.f){this.dataset.f=1;this.className='cv';this.src='/cover/${k}'}else this.remove()">
    <div class="ph">${esc(g.title)}</div><div class="n">${esc(g.title)}</div>${g.fav ? `<i class="fav">${IC.star}</i>` : ''}${live ? '<i class="live">Jogando</i>' : ''}</div>`;
}

function fitCards() {
  const m = $('#main'); if (!m) return;
  const h = m.clientHeight, w = m.clientWidth;
  const u = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) || 1;
  const cs = document.body.dataset.cards || 'normal', f = cs === 'small' ? 0.78 : cs === 'large' ? 1.3 : 1;
  let th = Math.round(Math.min(Math.max(h * 0.135, 76), 150) * Math.max(0.9, Math.min(u, 1.4)) * f);
  let tw = Math.round(th * 1.6);
  tw = Math.min(tw, Math.floor((w - 80 * u) / (cs === 'small' ? 8 : cs === 'large' ? 4.6 : 6.2))); th = Math.round(tw / 1.6);
  document.documentElement.style.setProperty('--tw', tw + 'px');
  document.documentElement.style.setProperty('--th', th + 'px');
}

function select(i, silent) {
  if (!S.games.length) return;
  const max = S.games.length - (S.more ? 0 : 1);
  S.sel = Math.max(0, Math.min(i, max));
  $$('#strip .card').forEach(c => c.classList.toggle('sel', +c.dataset.i === S.sel));
  const el = $(`#strip .card[data-i="${S.sel}"]`);
  if (el) el.scrollIntoView({behavior: silent ? 'auto' : 'smooth', inline: 'center', block: 'nearest'});
  if (S.sel >= S.games.length) { $('#sttxt').innerHTML = `<span class="tag">${esc(VNAME[S.view])}</span><h1>Todos os jogos</h1><div class="meta">${S.data.games.length} instalados · aperte A para abrir a biblioteca</div>`; chip(null); }
  else stage(S.games[S.sel]);
  if (!silent) tick();
}

let STG = {cur: 0, key: ''};
function stageClear() { ['#stbg', '#stbg2'].forEach(q => { const e = $(q); if (e) e.classList.remove('on'); }); STG.key = ''; }
function stageBg(g) {
  if (STG.key === g.key) return;
  STG.key = g.key;
  const url = `/hero/${encodeURIComponent(g.key)}`;
  const show = src => {
    if (STG.key !== g.key) return;
    const next = STG.cur ? $('#stbg') : $('#stbg2'), prev = STG.cur ? $('#stbg2') : $('#stbg');
    next.style.backgroundImage = `url("${src}")`; next.classList.add('on'); prev.classList.remove('on'); STG.cur = STG.cur ? 0 : 1;
  };
  const img = new Image();
  img.onload = () => show(url);
  img.onerror = () => { const c = `/cover/${encodeURIComponent(g.key)}`; const i2 = new Image(); i2.onload = () => show(c); i2.onerror = () => { if (STG.key === g.key) stageClear(); }; i2.src = c; };
  img.src = url;
}
function stage(g, keep) {
  const txt = $('#sttxt'); if (!txt) return;
  const wasActs = keep && S.focus === 'acts' ? S.fx : -1;
  stageBg(g);
  const live = S.data.sessions[g.key];
  const meta = [g.year, g.creator, SYSN(g.system || 'pc'), (g.genres || []).slice(0, 3).join(', ')].filter(Boolean);
  txt.innerHTML = `<span class="tag">${live ? 'Em andamento' : g.fav ? 'Favorito' : (g.last_played ? 'Jogado ' + ago(g.last_played) : 'Instalado')}</span>
    <h1>${esc(g.title)}</h1>
    <div class="meta">${meta.map(esc).join('<i>·</i>')}</div>
    <div class="acts">${live ? `<button class="btn d" data-act="stop">${IC.stop}Encerrar</button>` : `<button class="btn p" data-act="play">${IC.play}Jogar</button>`}<button class="btn" data-act="detail">${IC.info}Detalhes</button><button class="btn" data-act="menu">Opções</button></div>`;
  $$('#sttxt .btn').forEach(b => b.onclick = () => act(b.dataset.act));
  chip(g);
  if (wasActs >= 0) setFocus('acts', wasActs);
}
function chip(g) {
  const c = $('#chip'); if (!c) return;
  if (!g) { c.classList.remove('on'); return; }
  const live = S.data.sessions[g.key];
  const line1 = [live ? 'Jogando agora' : 'Instalado', g.playtime ? human(g.playtime) : '', g.play_count ? g.play_count + 'x' : '', g.store_src || ''].filter(Boolean).join(' · ');
  const line2 = g.last_played ? 'Última vez ' + ago(g.last_played) : 'Nunca jogado';
  const k = encodeURIComponent(g.key);
  c.innerHTML = `<img src="/thumb/${k}" alt="" onerror="this.outerHTML='<div class=ph>${IC.play.replace(/"/g, '&quot;')}</div>'"><div class="t"><span>${esc(line1)}</span><b>${esc(line2)}</b></div>`;
  c.classList.add('on');
  c.onclick = () => openDetail(g.key);
}

function act(a) {
  const g = S.games[S.sel]; if (!g) return;
  if (a === 'play') play(g.key); else if (a === 'stop') stop(g.key); else if (a === 'detail') openDetail(g.key); else if (a === 'menu') openMenu();
}

const STAGEN = {download: 'Baixando', extract: 'Extraindo', install: 'Instalando', verify: 'Conferindo', mount: 'Montando', copy: 'Copiando', move: 'Movendo', setup: 'Instalador aberto'};
const stageName = st => STAGEN[st] || (st ? st[0].toUpperCase() + st.slice(1) : 'Em andamento');
function qstatus(h) {
  if (h.job) { const f = h.job.fraction; return `${stageName(h.job.stage)}${f >= 0 ? ' · ' + Math.round(f * 100) + '%' : ''}${h.job.detail ? ' · ' + h.job.detail : ''}`; }
  return {done: h.installed ? 'Concluído · pronto para jogar' : 'Concluído', error: 'Falhou' + (h.message ? ' · ' + h.message : ''), cancelled: 'Cancelado', paused: 'Pausado', running: 'Em andamento'}[h.status] || (h.status || '');
}
function qhint(h) { const k = S.data && S.data.gamepad && S.data.gamepad.connected > 0 ? 'A' : 'Enter'; if (h.job) return k + ' · opções'; if (h.can_retry) return k + (h.status === 'paused' ? ' · continuar' : ' · tentar de novo'); if (h.status === 'done' && h.installed && S.byKey[h.key]) return k + ' · jogar'; return ''; }
function qitem(h, i) {
  const f = h.job ? h.job.fraction : -2;
  return `<div class="item ${h.job ? 'run' : h.status === 'error' ? 'err' : ''}" data-i="${i}" data-key="${esc(h.key)}"><div class="tx"><b>${esc(h.title || h.key)}</b><span class="st">${esc(qstatus(h))}</span>${h.job ? `<div class="prog"><i style="width:${f >= 0 ? Math.round(f * 100) : 100}%${f < 0 ? ';opacity:.35' : ''}"></i></div>` : ''}</div><span class="act">${qhint(h)}</span></div>`;
}
async function renderQueue(soft) {
  const q = await api('/api/queue');
  if (S.view !== 'queue') return;
  const items = (q.items || q.history || []).slice(0, 60);
  const sig = items.map(h => h.key + ':' + (h.job ? 'run' : h.status) + (h.installed ? '+' : '')).join(',');
  const m = $('#main');
  if (soft && sig === S.qsig && m.querySelector('.list')) {
    S.list = items;
    items.forEach(h => { const el = m.querySelector(`.item[data-key="${CSS.escape(h.key)}"]`); if (!el) return; const st = el.querySelector('.st'); if (st) st.textContent = qstatus(h); const bar = el.querySelector('.prog i'); if (bar && h.job) { const f = h.job.fraction; bar.style.width = (f >= 0 ? Math.round(f * 100) : 100) + '%'; bar.style.opacity = f < 0 ? '.35' : ''; } });
    return;
  }
  S.focus = 'strip'; document.body.classList.remove('zoned');
  S.qsig = sig; S.list = items;
  m.innerHTML = `<div class="list"><div class="head ph">${tabsHtml()}</div><h2>Fila</h2>${items.length ? items.map(qitem).join('')
    : '<div class="empty"><div><b>Nada na fila</b>Downloads e instalações feitos pelo Ludrix em janela aparecem aqui, com o andamento. Enquanto algo baixa, a porcentagem fica no topo da tela em qualquer aba.</div></div>'}</div>`;
  bindTabs();
  m.querySelectorAll('.item').forEach(el => el.onclick = () => queueMenu(items[+el.dataset.i]));
  S.fi = Math.max(0, Math.min(S.fi || 0, items.length - 1)); focusList();
}
function queueMenu(h) {
  if (!h) return;
  const g = S.byKey[h.key];
  const opts = [];
  if (h.job) {
    if (h.job.kind === 'install' && h.job.stage === 'download') opts.push(`<button class="opt" data-a="pause">${IC.pause}<span>Pausar<small>Para o download; depois é só escolher Continuar na Fila.</small></span></button>`);
    opts.push(`<button class="opt danger" data-a="stop">${IC.x}<span>Cancelar<small>Interrompe e apaga o que foi baixado até agora.</small></span></button>`);
  } else {
    if (h.can_retry) opts.push(`<button class="opt" data-a="retry">${h.status === 'paused' ? IC.play : IC.refresh}<span>${h.status === 'paused' ? 'Continuar' : 'Tentar de novo'}</span></button>`);
    if (h.status === 'done' && h.installed && g) opts.push(`<button class="opt" data-a="play">${IC.play}<span>Jogar</span></button>`);
    if (g) opts.push(`<button class="opt" data-a="detail">${IC.info}<span>Detalhes</span></button>`);
  }
  if (!opts.length) { toast(h.title || h.key, qstatus(h)); return; }
  layer('dlg', `<div class="mbox"><h3>${esc(h.title || h.key)}</h3><p>${esc(qstatus(h))}</p>${opts.join('')}<button class="opt" data-a="cancel">${IC.back}<span>Não fazer nada</span></button></div>`, async a => {
    closeLayer();
    if (a === 'play') return play(h.key);
    if (a === 'detail') return openDetail(h.key);
    if (a === 'pause' || a === 'stop' || a === 'retry') {
      const r = await api('/api/queue/action', {action: a, key: h.key});
      if (r && r.error) toast('Não deu', r.error, 'err'); else toast({pause: 'Pausado', stop: 'Cancelado', retry: 'Retomando'}[a], h.title || h.key);
      setTimeout(() => { if (S.view === 'queue') renderQueue(); }, 600);
    }
  });
}
function dlPill(jobs) {
  const el = $('#dlpill'); if (!el) return;
  if (S.focus !== 'top') el.classList.remove('gp');
  const ks = Object.keys(jobs || {}).filter(k => jobs[k] && jobs[k].kind !== 'update');
  if (!ks.length || (S.data && S.data.config.console_dl_pill === false)) { el.hidden = true; el.classList.remove('ind'); return; }
  const k = ks.find(x => jobs[x].kind === 'install') || ks[0], j = jobs[k], f = j.fraction;
  el.hidden = false;
  el.classList.toggle('ind', !(f >= 0));
  $('#dlpct').textContent = f >= 0 ? Math.round(f * 100) + '%' : '…';
  $('#dltxt').textContent = `${stageName(j.stage)} ${j.title || k}${ks.length > 1 ? ` +${ks.length - 1}` : ''}`;
  el.style.setProperty('--p', (f >= 0 ? Math.round(f * 100) : 0) + '%');
  el.title = `${j.title || k}${j.detail ? ' · ' + j.detail : ''}${ks.length > 1 ? ` · ${ks.length} em andamento` : ''} — abrir a fila`;
}

const SEGS = {
  gamepad_speed: [['slow', 'Lenta'], ['normal', 'Normal'], ['fast', 'Rápida']],
  after_launch: [['minimize', 'Minimizar'], ['none', 'Manter'], ['ask', 'Perguntar']],
  console_card_size: [['small', 'Pequenas'], ['normal', 'Normais'], ['large', 'Grandes']],
  console_start_view: [['library', 'Biblioteca'], ['recent', 'Recentes'], ['favorites', 'Favoritos']],
  console_dim_idle: [[0, 'Nunca'], [5, '5 min'], [15, '15 min'], [30, '30 min']],
  console_sort: [['title', 'A–Z'], ['recent', 'Últimos'], ['playtime', 'Mais jogados'], ['count', 'Mais vezes'], ['added', 'Novos']],
  launch_splash: [['off', 'Não'], ['short', 'Curta'], ['long', 'Até abrir']],
};
const cfgKey = k => k === 'gamepad_speed' ? 'console_gamepad_speed' : k;
function segRow(k, t, d) { const c = S.data.config, cur = c[cfgKey(k)]; return `<div class="row" data-k="${k}"><div class="l"><b>${t}</b><span>${d}</span></div><div class="seg">${SEGS[k].map(([v, n]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${n}</button>`).join('')}</div></div>`; }
function swRow(k, t, d) { return `<div class="row" data-k="${k}"><div class="l"><b>${t}</b><span>${d}</span></div><div class="sw ${S.data.config[k] ? 'on' : ''}"></div></div>`; }
function actRow(k, t, d, label, ic, danger) { return `<div class="row" data-k="${k}"><div class="l"><b>${t}</b><span>${d}</span></div><span class="btn${danger ? ' d' : ''}">${ic || ''}${label}</span></div>`; }
function renderSettings() {
  S.focus = 'strip'; document.body.classList.remove('zoned');
  const th = S.data.themes, pad = S.data.gamepad.connected > 0;
  $('#main').innerHTML = `<div class="list"><div class="head ph">${tabsHtml()}</div>
    <h2>Tema do console</h2>
    <div class="themes">${Object.entries(th).map(([id, t]) => `<button class="theme${S.data.theme === id ? ' on' : ''}" data-theme="${id}" style="--t-bg:${t.bg};--t-text:${t.text};--t-accent:${t.accent}"><b>${esc(t.name)}</b><small>${esc(t.desc)}</small></button>`).join('')}</div>
    <h2>Biblioteca</h2>
    ${segRow('console_card_size', 'Tamanho das capas', 'Quantas capas cabem na esteira de uma vez.')}
    ${segRow('console_sort', 'Ordem dos jogos', 'Como a Biblioteca e os Favoritos ficam ordenados.')}
    ${segRow('console_start_view', 'Aba inicial', 'Qual aba abre quando o Modo Console inicia.')}
    ${actRow('check', 'Verificar jogos', 'Confere se cada jogo instalado ainda está na pasta e com o executável no lugar.', 'Verificar', IC.check || '')}
    ${actRow('refetch', 'Atualizar capas e dados', 'Busca de novo capa, descrição e ano de todos os jogos, em segundo plano.', 'Atualizar', IC.info)}
    <h2>Controle e teclado</h2>
    ${segRow('gamepad_speed', 'Velocidade do cursor', 'Quão rápido a seleção anda ao segurar o direcional ou o analógico.')}
    ${swRow('console_vibrate', 'Vibrar ao confirmar', pad ? 'Um toque curto no controle ao abrir um jogo ou menu.' : 'Vale quando houver um controle conectado.')}
    ${swRow('console_sound', 'Sons de navegação', 'Um toque curto ao mover a seleção e confirmar.')}
    ${swRow('console_hint', 'Legenda dos botões', 'Mostra no rodapé o que cada botão do controle (ou tecla) faz.')}
    <h2>Tela</h2>
    ${swRow('console_clock24', 'Relógio em 24 horas', 'Desligado, mostra 12 horas com AM/PM.')}
    ${swRow('console_dl_pill', 'Download no topo', 'Enquanto algo baixa ou instala, a porcentagem aparece ao lado do relógio em qualquer aba. Toque nela para abrir a Fila.')}
    ${segRow('console_dim_idle', 'Escurecer quando parado', 'Sem ninguém mexer por esse tempo, a tela escurece para poupar a TV. Qualquer botão acende de novo.')}
    <h2>Ao jogar</h2>
    ${swRow('game_mode_auto', 'Otimizar antes de jogar', 'Aplica o plano de energia e as prioridades do Ludrix ao abrir um jogo e desfaz ao fechar.')}
    ${segRow('after_launch', 'Enquanto o jogo roda', 'O que fazer com o Modo Console depois que o jogo abre.')}
    ${segRow('launch_splash', 'Tela de abertura', 'A capa do jogo em tela cheia enquanto ele carrega.')}
    ${swRow('save_auto_backup', 'Backup automático dos saves', 'Guarda uma cópia dos saves quando o jogo fecha, para recuperar depois pelo Ludrix em janela.')}
    <h2>Programa</h2>
    ${swRow('console_confirm_quit', 'Confirmar antes de sair', 'Pergunta antes de fechar o Modo Console pelo botão ou pelo ícone.')}
    ${actRow('updates', 'Atualizações', 'Procura uma versão nova do LudrixHub. A instalação é feita pelo Ludrix em janela.', 'Procurar', IC.info)}
    ${actRow('to_window', 'Voltar para a janela', 'Fecha o Modo Console e abre o Ludrix normal, com todas as abas (Loja, Emuladores, Central…).', 'Abrir', IC.win)}
    ${actRow('quit', 'Sair', 'Fecha o Modo Console.', 'Sair', IC.power, true)}
    <div class="about">LudrixHub Console ${esc(S.data.version)} · ${S.data.count} jogos instalados</div>
  </div>`;
  $$('.theme').forEach(b => b.onclick = () => setTheme(b.dataset.theme));
  $$('.row').forEach(r => { r.onclick = e => { const seg = e.target.closest('.seg button'); rowAct(r, seg ? seg.dataset.v : null); }; });
  bindTabs(); S.fi = 0; focusList();
}
async function setTheme(id) {
  document.body.dataset.theme = id; S.data.theme = id;
  $$('.theme').forEach(b => b.classList.toggle('on', b.dataset.theme === id));
  await api('/api/config', {console_theme: id});
}
async function rowAct(r, v) {
  const k = r.dataset.k, c = S.data.config;
  if (k === 'to_window') return toWindow();
  if (k === 'quit') return confirmQuit();
  if (k === 'check') { toast('Verificando jogos…', ''); const x = await api('/api/library/check', {}); const bad = (x.items || []).filter(i => i.status && i.status !== 'ok'); toast(bad.length ? `${bad.length} com problema` : 'Tudo certo', bad.length ? bad.slice(0, 3).map(i => i.title).join(', ') + (bad.length > 3 ? '…' : '') + ' — veja no Ludrix em janela.' : `${x.total || S.data.count} jogos conferidos.`, bad.length ? 'err' : ''); return; }
  if (k === 'refetch') { await api('/api/metadata/refetch_all', {}); toast('Atualizando', 'Capas e dados em segundo plano.'); return; }
  if (k === 'updates') { toast('Procurando atualização…', ''); const x = await api('/api/updates/check', {}); toast(x.available ? `Versão ${x.version || 'nova'} disponível` : x.error ? 'Não deu para verificar' : 'Você já está na versão mais nova', x.available ? 'Instale pelo Ludrix em janela, em Ajustes › Sistema.' : (x.error || `LudrixHub ${S.data.version}`), x.error ? 'err' : ''); return; }
  if (SEGS[k]) {
    const opts = SEGS[k].map(o => o[0]);
    const cur = c[cfgKey(k)];
    let nv = v !== null && v !== undefined ? v : opts[(opts.findIndex(o => String(o) === String(cur)) + 1) % opts.length];
    if (typeof opts[0] === 'number') nv = +nv;
    c[cfgKey(k)] = nv;
    r.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', String(b.dataset.v) === String(nv)));
    await api('/api/config', {[k]: nv});
    if (k === 'gamepad_speed') GP.speed = nv;
    if (k === 'console_card_size') { document.body.dataset.cards = nv; fitCards(); }
    if (k === 'console_sort') S.sig = '';
    if (k === 'console_dim_idle') idleArm();
    return;
  }
  c[k] = !c[k]; r.querySelector('.sw').classList.toggle('on', c[k]);
  if (k === 'console_hint') document.body.classList.toggle('nolegend', !c[k]);
  if (k === 'console_dl_pill') poll();
  if (k === 'console_clock24') clock();
  await api('/api/config', {[k]: c[k]});
}
function focusList() {
  const els = $$('#main .item, #main .row, #main .theme');
  els.forEach((e, i) => e.classList.toggle('gp', i === S.fi && S.focus === 'strip'));
  const el = els[S.fi]; if (el) el.scrollIntoView({block: 'nearest', behavior: 'smooth'});
}

async function play(key, extra) {
  const g = S.byKey[key]; if (!g || S.busy[key]) return;
  const c = S.data.config;
  if (!extra && c.after_launch === 'ask') return askAfter(key);
  S.busy[key] = true;
  const r = await api('/api/play', {key, after: (extra && extra.after) || (c.after_launch === 'ask' ? 'minimize' : c.after_launch), emulator: extra && extra.emulator, optimize: extra && 'optimize' in extra ? extra.optimize : undefined});
  S.busy[key] = false;
  if (r.choose_emulator) return chooseEmu(key, r);
  if (r.error === 'emu_missing') return toast('Emulador não instalado', 'Instale o emulador deste sistema pelo Ludrix em janela (aba Emuladores).', 'err');
  if (r.missing) return toast('Arquivo não encontrado', (r.drive ? 'A unidade ' + r.drive + ' não está conectada. ' : '') + 'Aponte a pasta nova pelo Ludrix em janela (Jogar → Apontar).', 'err');
  if (r.running) return toast('Já está aberto', g.title, 'err');
  if (r.error) return toast('Não abriu', r.error, 'err');
  beep(660, .08);
  toast('Abrindo', g.title, 'ok');
  setTimeout(() => load(), 1500);
}
function askAfter(key) {
  const g = S.byKey[key];
  layer('menu', `<div class="mbox"><h3>${esc(g.title)}</h3><p>Enquanto o jogo roda, o que fazer com o Modo Console?</p>
    <button class="opt" data-a="minimize">${IC.win}<span>Minimizar<small>Volta sozinho quando o jogo fechar.</small></span></button>
    <button class="opt" data-a="none">${IC.play}<span>Manter aberto<small>O console fica atrás do jogo.</small></span></button>
    <button class="opt" data-a="cancel">${IC.back}<span>Não fazer nada</span></button></div>`, a => { closeLayer(); if (a !== 'cancel') play(key, {after: a}); });
}
function chooseEmu(key, r) {
  layer('menu', `<div class="mbox"><h3>Qual emulador?</h3><p>${esc(SYSN(r.system))} tem mais de um emulador instalado.</p>
    ${r.choose_emulator.map(o => `<button class="opt" data-a="${esc(o.id)}">${IC.play}<span>${esc(o.name)}${o.id === r.default ? '<small>Padrão</small>' : ''}</span></button>`).join('')}
    <button class="opt" data-a="cancel">${IC.back}<span>Não fazer nada</span></button></div>`, a => { closeLayer(); if (a !== 'cancel') play(key, {emulator: a}); });
}
async function stop(key) {
  const r = await api('/api/stop', {key});
  if (r.error) toast('Não foi possível encerrar', r.error, 'err'); else toast('Encerrando', S.byKey[key].title);
  setTimeout(() => load(), 1200);
}
async function fav(key) {
  await api('/api/fav', {key});
  const g = S.byKey[key]; g.fav = !g.fav;
  toast(g.fav ? 'Favoritado' : 'Removido dos favoritos', g.title, 'ok');
  render(true);
}

function layer(id, html, onPick) {
  const el = $('#' + id); el.innerHTML = html; el.classList.add('on');
  S.layer = {id, fi: 0, onPick};
  layerFocus(0);
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => onPick(b.dataset.a));
  el.onclick = e => { if (e.target === el) onPick('cancel'); };
}
function closeLayer() { if (!S.layer) return; $('#' + S.layer.id).classList.remove('on'); $('#' + S.layer.id).innerHTML = ''; S.layer = null; }
function layerEls() { return S.layer ? $$(`#${S.layer.id} [data-a]:not(:disabled)`) : []; }
function layerFocus(i) {
  const els = layerEls(); if (!els.length) return;
  S.layer.fi = (i + els.length) % els.length;
  els.forEach((e, j) => e.classList.toggle('gp', j === S.layer.fi));
  els[S.layer.fi].scrollIntoView({block: 'nearest'});
}

function openMenu() {
  const g = S.games[S.sel]; if (!g) return;
  const live = S.data.sessions[g.key];
  layer('menu', `<div class="mbox"><h3>${esc(g.title)}</h3><p>${esc(SYSN(g.system || 'pc'))}${g.playtime ? ' · ' + human(g.playtime) : ''}</p>
    ${live ? `<button class="opt danger" data-a="stop">${IC.stop}<span>Encerrar jogo</span></button>` : `<button class="opt" data-a="play">${IC.play}<span>Jogar</span></button>`}
    <button class="opt" data-a="detail">${IC.info}<span>Detalhes</span></button>
    <button class="opt" data-a="fav">${IC.star}<span>${g.fav ? 'Tirar dos favoritos' : 'Favoritar'}</span></button>
    <button class="opt" data-a="random">${IC.dice}<span>Me surpreenda<small>Escolhe um jogo ao acaso.</small></span></button>
    <button class="opt" data-a="grid">${IC.grid}<span>Ver todos em grade</span></button>
    <button class="opt" data-a="sort">${IC.sort || IC.grid}<span>Ordenar<small>${SORTN[S.data.config.console_sort] || 'A–Z'}</small></span></button>
    <button class="opt" data-a="search">${IC.search || IC.info}<span>Buscar</span></button>
    <button class="opt" data-a="cancel">${IC.back}<span>Fechar</span></button></div>`, a => {
    closeLayer();
    if (a === 'play') play(g.key); else if (a === 'stop') stop(g.key); else if (a === 'detail') openDetail(g.key); else if (a === 'fav') fav(g.key); else if (a === 'random') surprise(); else if (a === 'grid') openGrid(); else if (a === 'sort') sortMenu(); else if (a === 'search') openSearch();
  });
}
function sortMenu() {
  const cur = S.data.config.console_sort || 'title';
  layer('menu', `<div class="mbox"><h3>Ordenar jogos</h3><p>Vale para Biblioteca e Favoritos.</p>
    ${Object.entries(SORTN).map(([v, n]) => `<button class="opt${cur === v ? ' on' : ''}" data-a="${v}">${cur === v ? IC.check || '' : ''}<span>${n}</span></button>`).join('')}
    <button class="opt" data-a="cancel">${IC.back}<span>Fechar</span></button></div>`, async a => {
    closeLayer(); if (a === 'cancel') return;
    S.data.config.console_sort = a; await api('/api/config', {console_sort: a}); S.sig = ''; render();
  });
}
function openGrid() {
  const list = S.games; if (!list.length) return;
  layer('detail', `<div class="dgrad"></div><button class="btn back" data-a="cancel">${IC.back}Voltar</button>
    <div class="gridwrap"><h2>${VNAME[S.view]} · ${list.length} ${list.length === 1 ? 'jogo' : 'jogos'}</h2><div class="ggrid">${list.map((g, i) => `<button class="gcell${i === S.sel ? ' on' : ''}" data-a="${i}"><img src="/cover/${encodeURIComponent(g.key)}" alt="" loading="lazy" onerror="this.remove()"><span>${esc(g.title)}</span></button>`).join('')}</div></div>`, a => {
    closeLayer(); if (a === 'cancel') return; select(+a); setFocus('strip', 0);
  });
  layerFocus(S.sel + 1);
}
function surprise() {
  if (S.games.length < 2) return;
  let i; do { i = Math.floor(Math.random() * S.games.length); } while (i === S.sel);
  if (S.view !== 'library' && S.games.length < 2) return;
  select(i);
}
async function openDetail(key) {
  const g = S.byKey[key]; if (!g) return;
  const d = await api('/api/game/' + encodeURIComponent(key));
  const m = d.meta || {};
  const live = S.data.sessions[key];
  const info = [['Sistema', SYSN(g.system || 'pc')], ['Desenvolvedor', d.creator || m.developer], ['Publicadora', m.publisher], ['Ano', d.year || m.year], ['Gêneros', (d.genres || []).join(', ')],
    ['Tempo jogado', d.playtime ? d.playtime_h : ''], ['Vezes jogado', d.play_count ? String(d.play_count) : ''], ['Última vez', d.last_played ? ago(d.last_played) : ''], ['Origem', d.source === 'playnite' ? 'Playnite' + (d.store_src ? ' · ' + d.store_src : '') : d.store_src || ''], ['Emulador', d.emu && d.emu.emulator_title || ''], ['Pasta', d.dir]].filter(x => x[1]);
  layer('detail', `<div class="dbg" style="background-image:url('/hero/${encodeURIComponent(key)}'),url('/cover/${encodeURIComponent(key)}')"></div><div class="dgrad"></div>
    <button class="btn back" data-a="cancel">${IC.back}Voltar</button>
    <div class="dwrap"><div class="dcov"><img src="/cover/${encodeURIComponent(key)}" alt="" onerror="this.remove()"></div>
    <div class="dmain"><h1>${esc(g.title)}</h1><div class="meta">${[d.year, d.creator, SYSN(g.system || 'pc')].filter(Boolean).map(esc).join(' · ')}</div>
      ${d.description ? `<div class="desc">${esc(d.description)}</div>` : '<div class="desc" style="color:var(--muted)">Sem descrição. Você pode preencher os dados deste jogo pelo Ludrix em janela (Editar).</div>'}
      <div class="info">${info.map(([k, v]) => `<b>${k}</b><span>${esc(v)}</span>`).join('')}</div>
      <div class="acts">${live ? `<button class="btn d" data-a="stop">${IC.stop}Encerrar</button>` : `<button class="btn p" data-a="play">${IC.play}Jogar</button>`}<button class="btn" data-a="fav">${IC.star}${g.fav ? 'Tirar dos favoritos' : 'Favoritar'}</button></div>
    </div></div>`, a => {
    if (a === 'cancel') return closeLayer();
    if (a === 'play') { closeLayer(); play(key); } else if (a === 'stop') { closeLayer(); stop(key); } else if (a === 'fav') { fav(key); closeLayer(); openDetail(key); }
  });
  layerFocus(1);
}
function confirmQuit() {
  if (S.data && S.data.config.console_confirm_quit === false) return api('/api/window', {cmd: 'quit'});
  layer('dlg', `<div class="mbox"><h3>Sair do Modo Console?</h3><p>Jogos abertos continuam rodando. Para voltar depois, abra o LudrixHub Console de novo.</p>
    <button class="opt" data-a="window">${IC.win}<span>Voltar para a janela<small>Abre o Ludrix normal.</small></span></button>
    <button class="opt danger" data-a="quit">${IC.power}<span>Sair</span></button>
    <button class="opt" data-a="cancel">${IC.back}<span>Não fazer nada</span></button></div>`, a => { closeLayer(); if (a === 'quit') api('/api/window', {cmd: 'quit'}); if (a === 'window') toWindow(); });
}
async function toWindow() {
  toast('Abrindo a janela', 'O Modo Console vai fechar.');
  const r = await api('/api/console/swap', {to: 'window'});
  if (r.error) toast('Não foi possível', r.error, 'err');
}

function openSearch() { $('#search').classList.add('on'); const q = $('#q'); q.value = S.q; q.focus(); }
function closeSearch() { $('#search').classList.remove('on'); $('#q').blur(); }
$('#q').oninput = e => { S.q = e.target.value.trim(); render(); };
$('#q').onkeydown = e => { if (e.key === 'Enter' || e.key === 'Escape') { closeSearch(); e.stopPropagation(); } };
$('#search').onclick = e => { if (e.target === $('#search')) closeSearch(); };

function setView(v) {
  if (!VIEWS.includes(v)) return;
  S.view = v; S.focus = 'strip';
  render(); tick();
}
function nav(dir) {
  if (idleT || document.body.classList.contains('dim')) idleArm();
  if ($('#search').classList.contains('on')) { if (dir === 'back') closeSearch(); return; }
  if (S.layer) {
    const els = layerEls();
    if (dir === 'back') return S.layer.onPick('cancel');
    if (dir === 'ok') { const el = els[S.layer.fi]; if (el) el.click(); return; }
    if (dir === 'down' || dir === 'right') layerFocus(S.layer.fi + 1);
    if (dir === 'up' || dir === 'left') layerFocus(S.layer.fi - 1);
    tick(); return;
  }
  if (dir === 'lb' || dir === 'rb') { const i = VIEWS.indexOf(S.view); return setView(VIEWS[(i + (dir === 'rb' ? 1 : VIEWS.length - 1)) % VIEWS.length]); }
  if (dir === 'search' || dir === 'y') return openSearch();
  if (dir === 'menu' || dir === 'start') { if (S.view === 'queue' || S.view === 'settings') return; return openMenu(); }
  const panel = S.view === 'queue' || S.view === 'settings';
  if (S.focus !== 'strip') {
    const zi = ZONES.indexOf(S.focus), els = zoneEls(S.focus);
    if (dir === 'ok') { const el = els[S.fx]; if (el) el.click(); return; }
    if (dir === 'back') { if (panel) { S.fi = 0; setFocus('strip', 0); focusList(); } else setFocus('strip', 0); tick(); return; }
    if (dir === 'left' || dir === 'right') { setFocus(S.focus, S.fx + (dir === 'right' ? 1 : -1)); tick(); return; }
    if (dir === 'up') { if (zi > 0) setFocus(ZONES[zi - 1], 0, -1); tick(); return; }
    if (dir === 'down') {
      if (panel) { S.fi = 0; setFocus('strip', 0); focusList(); }
      else setFocus(ZONES[zi + 1] || 'strip', 0, 1);
      tick(); return;
    }
    return;
  }
  if (panel) {
    const els = $$('#main .item, #main .row, #main .theme');
    if (dir === 'down') { S.fi = Math.min(els.length - 1, S.fi + (els[S.fi] && els[S.fi].classList.contains('theme') ? 5 : 1)); if (S.fi < 0) S.fi = 0; }
    if (dir === 'up') { if (S.fi === 0 || !els.length) { setFocus('head', VIEWS.indexOf(S.view), -1); focusList(); tick(); return; } S.fi = Math.max(0, S.fi - (els[S.fi] && els[S.fi].classList.contains('theme') && S.fi >= 5 ? 5 : 1)); }
    if (dir === 'right' || dir === 'left') {
      const el = els[S.fi];
      if (el && el.classList.contains('theme')) S.fi = Math.max(0, Math.min(els.length - 1, S.fi + (dir === 'right' ? 1 : -1)));
      else if (el && el.querySelector('.seg')) { const bs = [...el.querySelectorAll('.seg button')], cur = bs.findIndex(b => b.classList.contains('on')); const nx = bs[(cur + (dir === 'right' ? 1 : bs.length - 1)) % bs.length]; rowAct(el, nx.dataset.v); }
    }
    if (dir === 'ok') { const el = els[S.fi]; if (el) el.click(); }
    if (dir === 'back') setView('library');
    focusList(); tick(); return;
  }
  if (dir === 'right') select(S.sel + 1);
  else if (dir === 'left') select(S.sel - 1);
  else if (dir === 'up') { setFocus(S.games.length ? 'acts' : 'head', 0, -1); tick(); }
  else if (dir === 'ok') { if (S.more && S.sel >= S.games.length) return setView('library'); const g = S.games[S.sel]; if (g) { if (S.data.sessions[g.key]) openMenu(); else play(g.key); } }
  else if (dir === 'back') { if (S.q) { S.q = ''; render(); } else if (S.sys) { S.sys = ''; render(); } else if (S.view !== 'library') setView('library'); else confirmQuit(); }
}

document.addEventListener('keydown', e => {
  if (e.target === $('#q')) return;
  const map = {ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'ok', ' ': 'ok', Escape: 'back', Backspace: 'back', f: 'search', F: 'search', '/': 'search', m: 'menu', M: 'menu', ContextMenu: 'menu', PageUp: 'lb', PageDown: 'rb', Tab: e.shiftKey ? 'lb' : 'rb', F11: null, p: 'start', P: 'start'};
  if (!(e.key in map)) return;
  e.preventDefault();
  if (e.key === 'F11') return api('/api/window', {cmd: 'fullscreen'});
  if (e.altKey && e.key === 'F4') return;
  nav(map[e.key]);
});
$('#exitBtn').onclick = () => confirmQuit();
$('#dlpill').onclick = () => setView('queue');
function scale() { const u = Math.max(0.85, Math.min(1.6, window.innerHeight / 900)); document.documentElement.style.setProperty('--u', u.toFixed(3)); }
scale();
window.addEventListener('resize', () => { scale(); fitCards(); });

const GP = {speed: 'normal', held: {}, lastAny: 0, idx: null};
const BTN = {0: 'ok', 1: 'back', 2: 'menu', 3: 'y', 4: 'lb', 5: 'rb', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right'};
function gpLoop() {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const n = pads.length;
  const ind = $('#padInd');
  if ((n > 0) !== ind.classList.contains('on')) { ind.classList.toggle('on', n > 0); $('#padN').textContent = n; legend(n > 0); if (n) toast('Controle conectado', pads[0].id.slice(0, 40), 'ok'); }
  const rep = {slow: [520, 160], normal: [380, 110], fast: [260, 70]}[GP.speed] || [380, 110];
  const now = performance.now();
  for (const p of pads) {
    const pressed = {};
    p.buttons.forEach((b, i) => { if (b.pressed && BTN[i]) pressed[BTN[i]] = true; });
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    if (ax < -.55) pressed.left = true; if (ax > .55) pressed.right = true; if (ay < -.55) pressed.up = true; if (ay > .55) pressed.down = true;
    for (const k of Object.keys(BTN).map(i => BTN[i])) {
      const h = GP.held[k];
      if (pressed[k]) {
        if (!h) { GP.held[k] = {t0: now, t: now}; if (k === 'ok') rumble(); nav(k); GP.lastAny = now; }
        else if (['left', 'right', 'up', 'down'].includes(k) && now - h.t0 > rep[0] && now - h.t > rep[1]) { h.t = now; nav(k); GP.lastAny = now; }
      } else if (h) delete GP.held[k];
    }
  }
  document.body.classList.toggle('idle', now - GP.lastAny > 90000 && now - S.lastPing > 90000);
  requestAnimationFrame(gpLoop);
}
window.addEventListener('gamepadconnected', () => { const n = [...navigator.getGamepads()].filter(Boolean).length; $('#padInd').classList.toggle('on', n > 0); $('#padN').textContent = n; legend(n > 0); });
window.addEventListener('gamepaddisconnected', () => { const n = [...navigator.getGamepads()].filter(Boolean).length; $('#padInd').classList.toggle('on', n > 0); $('#padN').textContent = n; legend(n > 0); if (!n) toast('Controle desconectado', 'Teclado e mouse continuam funcionando.'); });
document.addEventListener('mousemove', () => { S.lastPing = performance.now(); }, {passive: true});

let AC = null;
function beep(f, d) {
  if (!S.data || !S.data.config.console_sound) return;
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); const o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.value = .035; o.connect(g); g.connect(AC.destination); o.start(); g.gain.exponentialRampToValueAtTime(.0001, AC.currentTime + d); o.stop(AC.currentTime + d); } catch (e) {}
}
function tick() { beep(880, .04); }
function toast(t, s, k) {
  const el = document.createElement('div'); el.className = 'toast ' + (k || ''); el.innerHTML = `<b>${esc(t)}</b>${s ? `<span>${esc(s)}</span>` : ''}`;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), 3800);
}
function clock() { const d = new Date(), h24 = !S.data || S.data.config.console_clock24 !== false; $('#clock').textContent = h24 ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : d.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'}); }
let idleT = 0;
function idleArm() {
  clearTimeout(idleT); document.body.classList.remove('dim');
  const m = S.data ? +S.data.config.console_dim_idle || 0 : 0;
  if (m > 0) idleT = setTimeout(() => document.body.classList.add('dim'), m * 60000);
}
['keydown', 'mousemove', 'mousedown', 'wheel'].forEach(ev => window.addEventListener(ev, () => { if (idleT || document.body.classList.contains('dim')) idleArm(); }, {passive: true}));
function rumble() {
  if (!S.data || !S.data.config.console_vibrate) return;
  try { const gp = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find(Boolean); const a = gp && gp.vibrationActuator; if (a && a.playEffect) a.playEffect('dual-rumble', {duration: 60, strongMagnitude: .5, weakMagnitude: .3}); } catch (e) { }
}
function human(sec) { sec = +sec || 0; if (sec < 60) return 'menos de 1 min'; if (sec < 3600) return Math.round(sec / 60) + ' min'; const h = sec / 3600; return (h < 10 ? h.toFixed(1) : Math.round(h)) + ' h jogadas'; }
function ago(ts) { const d = (Date.now() / 1000 - ts); if (d < 3600) return 'há pouco'; if (d < 86400) return 'hoje'; if (d < 172800) return 'ontem'; if (d < 2592000) return `há ${Math.round(d / 86400)} dias`; return new Date(ts * 1000).toLocaleDateString(); }

async function poll() {
  try {
    const st = await api('/api/status');
    const qd = $('#qdot'); if (qd) qd.classList.toggle('on', Object.keys(st.jobs || {}).length > 0);
    dlPill(st.jobs);
    (st.events || []).forEach(ev => {
      if (['session_end', 'done', 'moved', 'renamed', 'meta_ready', 'thumb_ready'].includes(ev.type)) load();
      if (ev.type === 'done' && ['install', 'repack', 'rom', 'emulator'].includes(ev.kind) && ev.title) { toast(ev.kind === 'emulator' ? 'Emulador instalado' : 'Pronto para jogar', ev.title); rumble(); }
      if (ev.type === 'cancelled' && ev.title) toast(ev.paused ? 'Download pausado' : 'Cancelado', ev.title);
      if (ev.type === 'notify' && (ev.text || ev.msg)) toast(ev.title || 'Ludrix', ev.text || ev.msg);
      if (ev.type === 'error' && (ev.text || ev.msg)) toast('Falhou', ev.text || ev.msg, 'err');
    });
    if (S.view === 'queue' && !S.layer && (Object.keys(st.jobs || {}).length || S.qsig && S.qsig.includes(':run'))) renderQueue(true);
  } catch (e) {}
}

load(true).then(() => { GP.speed = S.data.config.console_gamepad_speed || 'normal'; gpLoop(); });
clock(); setInterval(clock, 15000); setInterval(poll, 2500); setInterval(() => { if (!S.layer && !$('#search').classList.contains('on')) load(); }, 30000);
