'use strict';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const TOKEN = (m => { const t = m?.content || ''; m?.remove(); return t; })(document.querySelector('meta[name=ludrix-token]'));
const api = (p, body) => fetch(p, body ? {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Ludrix-Token': TOKEN}, body: JSON.stringify(body)} : {headers: {'X-Ludrix-Token': TOKEN}}).then(r => r.json());
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const LOGO = '<img src="/ui/console/icon.png" alt="">';
const brandHtml = pr => !pr ? LOGO : `<span class="av" style="--c:${esc(pr.color || '#5c6b82')}">${pr.avatar ? `<img src="/api/profiles/avatar/${esc(pr.id)}?v=${pr.avatar}" alt="" onerror="this.remove()">` : ''}<i>${esc((pr.name || '?').trim().charAt(0).toUpperCase())}</i></span><b class="pn">${esc(pr.name || '')}</b>`;
const IC = {
  coll: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><path d="M17 18.781v2.238c-.043.98-.917 1.726-1.902 1.447a1.5 1.5 0 0 1-.48-.235L10.5 19.236l-4.118 2.995c-.296.197-.617.31-.976.286c-.808-.053-1.372-.714-1.406-1.498V8c.046-1.356.866-2.526 2.202-2.893c.347-.095.44-.083.798-.107c.024-.358.012-.451.107-.798C7.474 2.866 8.644 2.046 10 2h7c.933.031 1.796.418 2.375 1.167c.413.535.603 1.163.625 1.833v13.019c-.043.98-.917 1.726-1.902 1.447c-.411-.117-.77-.446-1.098-.685M9 5h5c1.708.057 2.943 1.292 3 3v8.309l1 .727V5a1.04 1.04 0 0 0-.22-.625c-.197-.246-.473-.357-.78-.375h-7c-.615.035-.932.413-1 1"/></g></svg>',
  down: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><path d="M5.5 19.5h13V16c.054-.956.855-1.686 1.834-1.462c.703.16 1.127.767 1.166 1.462v4a2.6 2.6 0 0 1-.659 1.686c-.469.524-1.147.794-1.841.814H5c-.44-.013-.86-.12-1.245-.336c-.782-.438-1.23-1.282-1.255-2.164v-4c.039-.695.463-1.302 1.166-1.462c.979-.224 1.78.506 1.834 1.462Zm5-7.464V3c.047-.83.634-1.5 1.5-1.5s1.453.67 1.5 1.5v9.036l1.682-1.682c.259-.232.542-.391.893-.43c1.239-.14 2.101 1.232 1.438 2.288l-.21.263l-4.242 4.243c-.259.231-.542.39-.893.429c-.47.053-.884-.122-1.229-.429l-4.242-4.243l-.21-.263c-.663-1.056.199-2.428 1.438-2.288c.351.039.634.198.893.43Z"/></g></svg>',
  x: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><path d="m12 9.879l5.303-5.303c.606-.548 1.522-.6 2.122 0s.548 1.515 0 2.121l-5.304 5.304l5.304 5.303c.548.606.6 1.521 0 2.121s-1.516.548-2.122 0L12 14.122l-5.303 5.303c-.607.549-1.522.6-2.122 0s-.548-1.515 0-2.121l5.304-5.303l-5.304-5.304c-.548-.606-.6-1.521 0-2.121s1.515-.548 2.122 0Z"/></g></svg>',
  pause: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><path d="M9.229 3.026c.466.109.745.514.771.974v16c-.033.568-.432.967-1 1H7l-.229-.026C6.305 20.865 6.026 20.46 6 20V4c.033-.568.432-.967 1-1h2Zm8 0c.466.109.745.514.771.974v16c-.033.568-.432.967-1 1h-2l-.229-.026c-.466-.109-.745-.514-.771-.974V4c.033-.568.432-.967 1-1h2Z"/></g></svg>',
  refresh: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><path d="M5.322 15.416c.409.724.856 1.388 1.457 1.971c2.467 2.395 6.294 2.791 9.204.969a7.5 7.5 0 0 0 1.814-1.593l.369-.489c.296-.426.483-.882.972-1.121c1.049-.512 2.292.371 2.148 1.531c-.057.454-.352.855-.598 1.217a10.5 10.5 0 0 1-3.269 3.093c-5.369 3.235-12.376 1.059-14.976-4.642a10.5 10.5 0 0 1-.918-3.586c-.016-.225-.051-.694-.004-.975c.119-.711.73-1.251 1.443-1.312c.373-.032.711.074 1.026.267l2.678 1.805c.232.17.426.36.556.621c.422.848-.055 1.962-.96 2.242c-.319.099-.621.065-.942.002m13.355-6.831c-.408-.724-.856-1.388-1.456-1.971c-2.467-2.395-6.294-2.791-9.204-.968a7.5 7.5 0 0 0-1.814 1.593l-.37.489c-.295.427-.483.882-.971 1.12c-1.049.512-2.292-.372-2.147-1.532c.056-.453.352-.854.598-1.216a10.5 10.5 0 0 1 3.269-3.093C11.951-.228 18.957 1.948 21.556 7.65c.515 1.129.828 2.348.918 3.586c.017.225.052.694.005.975a1.606 1.606 0 0 1-1.444 1.312c-.373.031-.71-.075-1.025-.268l-2.678-1.804c-.232-.17-.427-.36-.556-.621c-.422-.848.055-1.962.96-2.242c.319-.099.62-.064.941-.003"/></g></svg>',
  sort: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><path d="M3.666 20.462c-1.371-.313-1.584-2.203-.317-2.813c.233-.113.396-.135.651-.149h8c.695.039 1.302.463 1.462 1.166c.224.979-.506 1.78-1.462 1.834H4ZM16.5 7.793c-.254.254-.485.501-.833.623c-1.178.412-2.323-.734-1.911-1.911c.085-.244.185-.375.355-.565l2.828-2.829c.259-.231.542-.39.893-.43c.47-.053.884.122 1.229.43l2.828 2.829c.17.19.27.321.355.565c.412 1.177-.733 2.323-1.911 1.911c-.348-.122-.579-.369-.833-.623V19c-.047.83-.634 1.5-1.5 1.5s-1.453-.67-1.5-1.5ZM3.666 13.462c-1.371-.313-1.584-2.203-.317-2.813c.233-.113.396-.135.651-.149h8c.695.039 1.302.463 1.462 1.166c.224.979-.506 1.78-1.462 1.834H4Zm0-7c-1.371-.313-1.584-2.203-.317-2.813c.233-.113.396-.135.651-.149h6c.695.039 1.302.463 1.462 1.166c.224.979-.506 1.78-1.462 1.834H4Z"/></g></svg>',
  check: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><path d="M9.171 15.365L19.424 5.112c.703-.635 1.769-.588 2.314.235c.403.609.281 1.363-.192 1.886L10.232 18.547c-.17.154-.283.243-.496.33c-.574.233-1.178.074-1.625-.33L2.454 12.89c-.474-.524-.595-1.277-.192-1.886c.544-.823 1.611-.87 2.313-.235Z"/></g></svg>',
  play: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><path d="M7.436 3.495c.337.073.668.257.979.397l1.495.701a68 68 0 0 1 8.355 4.823l1.354.945c.544.392 1.131.755 1.205 1.486c.02.195.001.395-.057.583c-.176.567-.686.867-1.141 1.195l-.842.594a68 68 0 0 1-5.43 3.374a65 65 0 0 1-4.508 2.309c-.473.219-1.158.614-1.687.626a1.47 1.47 0 0 1-.766-.196c-.721-.417-.734-1.125-.809-1.864l-.095-1.032a67 67 0 0 1-.047-10.27l.142-1.642c.085-.833.133-1.649 1.05-1.977a1.47 1.47 0 0 1 .802-.052"/></g></svg>',
  stop: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><path d="M18.324 4.026C19.308 4.186 19.961 5.031 20 6v12c-.046 1.146-.854 1.954-2 2H6c-.535-.022-1.03-.202-1.414-.586S4.022 18.535 4 18V6c.046-1.146.854-1.954 2-2h12Z"/></g></svg>',
  star: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><path d="m15.875 7.17l5.428 1.175l.241.077c.807.351.954 1.326.426 1.977l-3.7 4.142l.56 5.525v.253c-.084.876-.965 1.317-1.748 1.016L12 19.096l-5.082 2.239c-.782.301-1.664-.14-1.748-1.016l.001-.253l.559-5.525l-3.7-4.142c-.527-.651-.381-1.626.426-1.977l.241-.077L8.125 7.17l2.795-4.799c.455-.692 1.405-.866 1.996-.224l.164.224Z"/></g></svg>',
  info: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><path d="M12.746 2.027a10 10 0 0 1 4.699 1.584c5.563 3.618 6.124 11.579 1.116 15.936a10 10 0 0 1-2.998 1.8a10.1 10.1 0 0 1-4.309.626a10 10 0 0 1-4.699-1.584C.992 16.771.431 8.81 5.439 4.453a10 10 0 0 1 2.998-1.8a10.1 10.1 0 0 1 4.309-.626M11 12v5c.013.233.071.441.22.625c.197.246.473.357.78.375c.295.017.66.035.94-.102a1.01 1.01 0 0 0 .365-1.491c-.109-.147-.158-.166-.305-.272V11c-.033-.568-.432-.967-1-1h-1a1.04 1.04 0 0 0-.625.22c-.562.45-.462 1.362.185 1.678c.184.09.24.079.44.102m1-5c-1.432.163-1.225 2.001.002 2c1.049-.001 1.382-1.438.44-1.898c-.111-.055-.317-.116-.442-.102"/></g></svg>',
  back: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><path d="m7.965 13.5l3.096 3.096c.553.62.612 1.509 0 2.121a1.5 1.5 0 0 1-1.859.21l-.263-.21l-5.656-5.656c-.308-.345-.483-.759-.43-1.229c.039-.351.198-.634.43-.893l5.656-5.657l.263-.209a1.505 1.505 0 0 1 1.859.209c.612.613.553 1.502 0 2.122L7.965 10.5H20c.83.047 1.5.634 1.5 1.5s-.67 1.453-1.5 1.5Z"/></g></svg>',
  win: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><path d="M15 18v1h1c.233.013.441.071.625.22c.76.609.298 1.727-.625 1.78H8c-.923-.053-1.385-1.171-.625-1.78A1.04 1.04 0 0 1 8 19h1v-1H5c-1.146-.046-1.954-.854-2-2V5c.026-.641.293-1.229.819-1.614C4.17 3.129 4.57 3.017 5 3h14c.245.01.399.024.632.102C20.465 3.378 20.966 4.144 21 5v11c-.046 1.146-.854 1.954-2 2Zm-4 0v1h2v-1Z"/></g></svg>',
  power: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><path d="M17.256 3.026c.437.083.802.386 1.142.648q.575.443 1.085.96a10.58 10.58 0 0 1 2.913 8.852c-1.055 7.454-9.483 11.412-15.897 7.459c-4.733-2.916-6.39-9.1-3.712-13.985a10.55 10.55 0 0 1 2.815-3.286c.432-.332.862-.678 1.431-.674c1.046.007 1.775 1.105 1.377 2.071c-.205.499-.642.715-1.047 1.034q-.477.376-.887.822a7.55 7.55 0 0 0-1.867 6.352c.864 5.038 6.517 7.761 10.999 5.297c3.605-1.981 4.953-6.561 2.974-10.174a7.6 7.6 0 0 0-1.484-1.904l-.461-.393c-.405-.319-.842-.535-1.047-1.034c-.445-1.08.517-2.263 1.666-2.045M12.27 1.524c.728.132 1.198.759 1.23 1.476v10c-.037.816-.655 1.5-1.5 1.5s-1.463-.684-1.5-1.5V3c.042-.933.817-1.648 1.77-1.476"/></g></svg>',
  bolt: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><path d="M14.29 9H20c.869.046 1.289.943.768 1.64l-10 12c-.684.737-1.81.263-1.763-.741L9.711 15H4c-.869-.046-1.289-.943-.768-1.64l10-12c.684-.736 1.811-.262 1.763.742Z"/></g></svg>',
  search: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><path d="M14.133 16.254c-1.197.828-2.683 1.248-4.133 1.248c-5.278 0-8.921-5.349-6.977-10.263A7.5 7.5 0 0 1 4.462 4.94c3.533-3.866 9.867-2.997 12.233 1.673A7.5 7.5 0 0 1 17.502 10c0 1.45-.42 2.936-1.248 4.133l4.807 4.806c.553.62.612 1.509 0 2.122c-.613.612-1.502.553-2.122 0ZM9.565 5.522a4.5 4.5 0 0 0-2.599 1.156c-3.179 2.906-.813 8.208 3.469 7.8a4.5 4.5 0 0 0 2.599-1.156c3.179-2.906.813-8.208-3.469-7.8"/></g></svg>',
  grid: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><path d="M9.324 13.026c.984.16 1.637 1.005 1.676 1.974v4c-.017.43-.129.83-.386 1.181c-.385.526-.973.793-1.614.819H5c-.43-.017-.83-.129-1.181-.386c-.526-.385-.793-.973-.819-1.614v-4c.046-1.146.854-1.954 2-2h4Zm10 0c.984.16 1.637 1.005 1.676 1.974v4c-.017.43-.129.83-.386 1.181c-.385.526-.973.793-1.614.819h-4c-.43-.017-.83-.129-1.181-.386c-.526-.385-.793-.973-.819-1.614v-4c.046-1.146.854-1.954 2-2h4Zm-10-10C10.308 3.186 10.961 4.031 11 5v4c-.017.43-.129.83-.386 1.181c-.385.526-.973.793-1.614.819H5c-.43-.017-.83-.129-1.181-.386C3.293 10.229 3.026 9.641 3 9V5c.046-1.146.854-1.954 2-2h4Zm10 0C20.308 3.186 20.961 4.031 21 5v4c-.017.43-.129.83-.386 1.181c-.385.526-.973.793-1.614.819h-4c-.43-.017-.83-.129-1.181-.386c-.526-.385-.793-.973-.819-1.614V5c.046-1.146.854-1.954 2-2h4Z"/></g></svg>',
  dice: '<svg viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><path d="M13.407 8.027C14.931 8.233 15.95 9.498 16 11v8c-.023.669-.212 1.298-.625 1.833c-.579.749-1.442 1.136-2.375 1.167H5c-.669-.022-1.298-.212-1.833-.625C2.418 20.796 2.031 19.933 2 19v-8c.057-1.708 1.292-2.943 3-3h8ZM6.73 15.524a1.516 1.516 0 0 0-1.206 1.746a1.516 1.516 0 0 0 1.746 1.206a1.516 1.516 0 0 0 1.206-1.746a1.516 1.516 0 0 0-1.746-1.206m4-4a1.516 1.516 0 0 0-1.206 1.746a1.516 1.516 0 0 0 1.746 1.206a1.516 1.516 0 0 0 1.206-1.746a1.516 1.516 0 0 0-1.746-1.206M18 15.899V11c-.06-2.387-1.615-4.413-3.992-4.898A5 5 0 0 0 13 6H8.102l2.777-2.777c.43-.4.917-.691 1.497-.814c1.013-.215 1.999.12 2.745.814l5.657 5.656c1.167 1.256 1.167 2.988 0 4.243Z"/></g></svg>',
};
const S = {data: null, games: [], byKey: {}, view: 'library', sel: 0, sys: '', coll: '', q: '', focus: 'strip', fx: 0, fi: 0, list: [], busy: {}, layer: null, lastPing: 0, more: false, sig: ''};
const ZONES = ['top', 'head', 'acts', 'strip'];
function zoneEls(z) {
  if (z === 'acts') return $$('#sttxt .btn');
  if (z === 'head') return $$('#main .head .tab, #main .head .sys button');
  if (z === 'top') return $$('#chip.on, #dlpill:not([hidden]), #exitBtn').filter(e => e.offsetParent !== null);
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
  if (pad === undefined) pad = !!(S.data && S.data.gamepad && S.data.gamepad.connected > 0);
  const main = S.view === 'store' ? 'Baixar' : S.view === 'queue' || S.view === 'settings' ? 'Escolher' : 'Jogar';
  el.innerHTML = pad
    ? '<span><b class="k a">A</b>' + main + '</span><span><b class="k b">B</b>Voltar</span><span><b class="k x">X</b>Opções</span><span><b class="k y">Y</b>Buscar</span><span><b class="k lb">LB</b><b class="k rb">RB</b>Abas</span><span><b class="k st">≡</b>Menu</span>'
    : '<span><b class="k kb">Enter</b>' + main + '</span><span><b class="k kb">Esc</b>Voltar</span><span><b class="k kb">M</b>Opções</span><span><b class="k kb">F</b>Buscar</span><span><b class="k kb">Tab</b>Abas</span><span><b class="k kb">↑ ↓</b>Botões</span>';
}
const VIEWS = ['library', 'recent', 'favorites', 'store', 'queue', 'settings'];
const VNAME = {library: 'Biblioteca', recent: 'Recentes', favorites: 'Favoritos', store: 'Loja', queue: 'Fila', settings: 'Ajustes'};
const isStore = g => !!(g && g._st);
const fmtSize = b => { b = +b || 0; if (!b) return ''; if (b >= 1073741824) return (b / 1073741824).toFixed(b >= 10737418240 ? 0 : 1) + ' GB'; return Math.round(b / 1048576) + ' MB'; };
const tabsHtml = () => `<div class="tabs">${VIEWS.map(v => `<button class="tab${S.view === v ? ' on' : ''}" data-view="${v}">${VNAME[v]}${v === 'queue' ? '<i class="dot" id="qdot"></i>' : ''}</button>`).join('')}</div>`;
const bindTabs = () => $$('.tab').forEach(t => t.onclick = () => setView(t.dataset.view));
const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const CSYS = { ps1: ['ps1', 'psx', 'psone'], ps2: ['ps2'], ps3: ['ps3'], psp: ['psp'], snes: ['snes', 'supernintendo'], nes: ['nes', 'nintendinho'], n64: ['n64'], gc: ['gc', 'gamecube', 'ngc'], wii: ['wii'], wiiu: ['wiiu'], switch: ['switch'], '3ds': ['3ds'], nds: ['ds', 'nds'], gba: ['gba'], dc: ['dc', 'dreamcast'], saturn: ['saturn'], genesis: ['genesis', 'megadrive', 'md'], sms: ['sms', 'mastersystem'], xbox: ['xbox'], x360: ['x360', 'xbox360'], arcade: ['arcade', 'mame', 'fliperama'], pce: ['pce'], dos: ['dos'], atari2600: ['atari', 'atari2600'], pc: ['pc', 'windows'] };
function smartHit(x, w) {
  if (/^(19[7-9]\d|20[0-4]\d)$/.test(w)) return String(x.year || '') === w;
  for (const id in CSYS) if (CSYS[id].includes(w)) return (x.system || 'pc') === id;
  if (w === 'instalado' || w === 'instalados') return !!x.installed;
  if (w === 'favorito' || w === 'favoritos') return !!x.fav;
  return false;
}
const SYSN = k => (S.data && S.data.systems && S.data.systems[k]) || k || '';

async function load(first) {
  const d = await api('/api/console');
  S.data = d;
  S.byKey = {}; d.games.forEach(g => S.byKey[g.key] = g); if (S.store) S.store.forEach(g => { if (!S.byKey[g.key]) S.byKey[g.key] = g; });
  document.body.dataset.theme = d.theme || 'noite';
  document.body.classList.toggle('nolegend', !d.config.console_hint);
  document.body.classList.toggle('rm', !!d.config.reduce_motion || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches));
  document.body.dataset.cards = d.config.console_card_size || 'normal';
  document.body.dataset.layout = d.config.console_layout === 'cinema' ? 'cinema' : 'console';
  clock(); idleArm();
  const pad = $('#padInd'); pad.classList.toggle('on', d.gamepad.connected > 0); $('#padN').textContent = d.gamepad.connected;
  if (first) {
    if (VIEWS.includes(d.config.console_start_view) && d.config.console_start_view !== 'library') S.view = d.config.console_start_view;
    $('#brand').innerHTML = brandHtml(d.profile);
    $('#brand').onclick = () => confirmQuit();
    legend(d.gamepad.connected > 0);
    render();
  } else if (!S.layer) {
    if (S.view === 'store' && S.store && Date.now() - (S.storeT || 0) > 30000) { S.storeT = Date.now(); loadStore(true).then(() => { if (S.view === 'store' && !S.layer) render(true); }); }
    render(true);
  }
}

async function loadStore(force) {
  if (S.store && !force) return S.store;
  if (S.storeP) return S.storeP;
  S.storeP = api('/api/catalog').then(d => {
    const seen = new Set();
    S.store = (d.games || []).filter(g => g.repo && !g.installed && !g.owned && !g.dup_of && !seen.has(g.key) && seen.add(g.key));
    S.storeLoading = !!d.loading; S.storeRepos = (d.repos || []).length;
    S.store.forEach(g => { g._st = true; S.byKey[g.key] = g; });
    S.storeP = null; return S.store;
  }).catch(() => { S.storeP = null; S.store = S.store || []; return S.store; });
  return S.storeP;
}
function listFor(view) {
  let g = S.data.games;
  if (view === 'store') g = S.store || [];
  if (view === 'recent') g = S.data.recent.map(k => S.byKey[k]).filter(Boolean);
  if (view === 'favorites') g = g.filter(x => x.fav);
  if (S.sys) g = g.filter(x => (x.system || 'pc') === S.sys);
  if (S.coll && view !== 'store') { const c = (S.data.collections || []).find(x => x.id === S.coll); const ks = new Set(c ? c.keys : []); g = g.filter(x => ks.has(x.key)); }
  if (S.q) { const ws = norm(S.q).split(' ').filter(Boolean); g = g.filter(x => { const t = norm(x.title) + ' ' + norm((x.genres || []).join(' ')) + ' ' + (x.year || ''); return ws.every(w => t.includes(w) || smartHit(x, w)); }); }
  const srt = S.data.config.console_sort || 'title';
  if (view !== 'recent' && srt !== 'title') { g = [...g]; if (srt === 'recent') g.sort((a, b) => (b.last_played || 0) - (a.last_played || 0)); else if (srt === 'playtime') g.sort((a, b) => (b.playtime || 0) - (a.playtime || 0)); else if (srt === 'count') g.sort((a, b) => (b.play_count || 0) - (a.play_count || 0) || (b.playtime || 0) - (a.playtime || 0)); else if (srt === 'added') g.sort((a, b) => (b.installed_at || 0) - (a.installed_at || 0)); }
  if (S.data.config.fav_first && view !== 'recent' && view !== 'favorites' && view !== 'store') g = g.filter(x => x.fav).concat(g.filter(x => !x.fav));
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
  if (S.view === 'store' && !S.store) { loadStore().then(() => { if (S.view === 'store') render(keep); }); m.innerHTML = `<div class="empty"><div><b>Carregando a loja…</b></div></div><div class="head">${tabsHtml()}</div><div class="strip" id="strip"></div>`; bindTabs(); return; }
  S.games = listFor(S.view);
  const more = S.view !== 'library' && S.view !== 'store' && S.games.length > 0 && S.data.games.length > S.games.length;
  S.more = more;
  if (!keep) S.sel = 0; else S.sel = Math.min(S.sel, Math.max(0, S.games.length - (more ? 0 : 1)));
  const sig = S.view + '|' + S.games.map(g => g.key + (g.fav ? '*' : '') + (S.data.sessions[g.key] ? '!' : '')).join(',') + (more ? '|+' : '');
  if (keep && sig === S.sig && $('#strip') && $('#sttxt')) { if (S.sel < S.games.length) stage(S.games[S.sel], true); return; }
  S.sig = sig; S.focus = 'strip'; document.body.classList.remove('zoned');
  if (!S.games.length) {
    const msg = S.q ? ['Nada encontrado', 'Tente outro nome ou limpe a busca (Y).'] :
      S.view === 'favorites' ? ['Nenhum favorito', 'Marque um jogo com X › Favoritar e ele aparece aqui.'] :
      S.view === 'recent' ? ['Nada jogado ainda', 'Os últimos jogos abertos ficam nesta aba.'] :
      S.view === 'store' ? (S.storeRepos ? ['Loja vazia', S.storeLoading ? 'As fontes ainda estão carregando. Volte em instantes.' : 'Nada novo para baixar: tudo que as fontes oferecem já está instalado.'] : ['Nenhuma fonte ativa', 'Ative uma fonte pelo Ludrix em janela, em Loja › Fontes.']) :
      ['Biblioteca vazia', 'Instale ou adicione jogos pelo Ludrix em janela; aqui aparecem só os instalados.'];
    m.innerHTML = `<div class="empty"><div><b>${msg[0]}</b>${msg[1]}</div></div><div class="head">${tabsHtml()}</div><div class="strip" id="strip"></div>`;
    bindTabs(); chip(null); stageClear(); S.sig = '';
    return;
  }
  const systems = [...new Set((S.view === 'store' ? S.games : S.data.games).map(g => g.system || 'pc'))];
  const sysBar = systems.length > 1 ? `<div class="sys"><button class="${S.sys ? '' : 'on'}" data-sys="">Todos</button>${systems.map(s => `<button class="${S.sys === s ? 'on' : ''}" data-sys="${esc(s)}">${esc(SYSN(s))}</button>`).join('')}</div>` : '';
  m.innerHTML = `
    <div class="txt" id="sttxt"></div>
    <div class="head">${tabsHtml()}<span class="n">${S.games.length} ${S.games.length === 1 ? 'jogo' : 'jogos'}${S.q ? ` · busca “${esc(S.q)}”` : ''}${S.coll ? ` · coleção “${esc(collName(S.coll))}”` : ''}</span><div class="sp"></div><div class="hr">${sysBar}<div class="sys tools">${S.view === 'store' ? '' : `<button data-tool="sort" title="Ordenar">${IC.sort || ''}${esc(SORTN[S.data.config.console_sort] || 'A–Z')}</button>`}<button data-tool="grid" title="Ver todos em grade">${IC.grid}Grade</button></div></div></div>
    <div class="strip" id="strip">${S.games.map((g, i) => card(g, i)).join('')}${more ? `<div class="card more" data-i="${S.games.length}">${IC.grid}Todos os jogos<small>+${S.data.games.length - S.games.length}</small></div>` : ''}</div>`;
  fitCards();
  if (S.lastView !== S.view) { S.lastView = S.view; const st = $('#strip'); st.classList.add('swap'); st.addEventListener('animationend', () => st.classList.remove('swap'), {once: true}); }
  bindTabs();
  $$('#strip .card').forEach(c => { c.onclick = () => { const i = +c.dataset.i; if (c.classList.contains('more')) return setView('library'); if (S.focus !== 'strip') setFocus('strip', 0); if (i === S.sel) primary(S.games[i]); else select(i); }; c.ondblclick = () => { const i = +c.dataset.i; if (c.classList.contains('more')) return; const g = S.games[i]; if (g && !S.data.sessions[g.key]) primary(g); }; c.oncontextmenu = e => { e.preventDefault(); if (c.classList.contains('more')) return; select(+c.dataset.i); openMenu(); }; });
  $$('.head .sys button[data-sys]').forEach(b => b.onclick = () => { S.sys = b.dataset.sys; render(); });
  $$('.head .tools button').forEach(b => b.onclick = () => b.dataset.tool === 'sort' ? sortMenu() : openGrid());
  select(S.sel, true);
}

function card(g, i) {
  const live = S.data.sessions[g.key];
  const k = encodeURIComponent(g.key);
  return `<div class="card${i === S.sel ? ' sel' : ''}" data-i="${i}" data-key="${esc(g.key)}">
    <img src="/hero/${k}" loading="lazy" alt="" onerror="if(!this.dataset.f){this.dataset.f=1;this.className='cv';this.src='/cover/${k}'}else this.remove()">
    <div class="ph">${esc(g.title)}</div><div class="n">${esc(g.title)}</div>${g.fav ? `<i class="fav">${IC.star}</i>` : ''}${live ? '<i class="live">Jogando</i>' : isStore(g) && g.job ? '<i class="live">Na fila</i>' : isStore(g) && g.size ? `<i class="live sz">${fmtSize(g.size)}</i>` : ''}</div>`;
}

function fitCards() {
  const m = $('#main'); if (!m) return;
  const h = m.clientHeight, w = m.clientWidth;
  const u = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) || 1;
  const cs = document.body.dataset.cards || 'normal', f = cs === 'small' ? 0.78 : cs === 'large' ? 1.3 : 1;
  const sq = document.body.dataset.layout !== 'cinema', ar = sq ? 1 : 1.6;
  let th = Math.round(Math.min(Math.max(h * (sq ? 0.19 : 0.135), 76), sq ? 190 : 150) * Math.max(0.9, Math.min(u, 1.4)) * f);
  let tw = Math.round(th * ar);
  tw = Math.min(tw, Math.floor((w - 80 * u) / (cs === 'small' ? (sq ? 10 : 8) : cs === 'large' ? (sq ? 6 : 4.6) : (sq ? 7.6 : 6.2)))); th = Math.round(tw / ar);
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

let STG = {cur: 0, key: '', txt: '', t: 0};
function stageClear() { ['#stbg', '#stbg2'].forEach(q => { const e = $(q); if (e) e.classList.remove('on'); }); STG.key = ''; }
function stageBg(g) {
  if (STG.key === g.key) return;
  STG.key = g.key;
  clearTimeout(STG.t);
  STG.t = setTimeout(() => stageLoad(g), 90);
}
function stageLoad(g) {
  if (STG.key !== g.key) return;
  const url = `/hero/${encodeURIComponent(g.key)}`;
  const show = src => {
    if (STG.key !== g.key) return;
    const next = STG.cur ? $('#stbg') : $('#stbg2'), prev = STG.cur ? $('#stbg2') : $('#stbg');
    next.style.backgroundImage = `url("${src}")`; next.style.animation = 'none'; void next.offsetWidth; next.style.animation = ''; next.classList.add('on'); prev.classList.remove('on'); STG.cur = STG.cur ? 0 : 1;
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
  const live = S.data.sessions[g.key], st = isStore(g);
  const meta = [g.year, g.creator, SYSN(g.system || 'pc'), (g.genres || []).slice(0, 3).join(', '), st ? fmtSize(g.size) : ''].filter(Boolean);
  txt.innerHTML = `<span class="tag">${st ? (g.job ? 'Na fila' : 'Loja · ' + (g.torrent && !g.direct ? 'torrent' : 'download')) : live ? 'Em andamento' : g.fav ? 'Favorito' : (g.last_played ? 'Jogado ' + ago(g.last_played) : 'Instalado')}</span>
    <h1>${esc(g.title)}</h1>
    <div class="meta">${meta.map(esc).join('<i>·</i>')}</div>
    ${statsHtml(g)}
    <div class="acts">${st ? (g.job ? `<button class="btn" data-act="queue">${IC.grid}Ver fila</button>` : `<button class="btn p" data-act="install">${IC.down}Baixar</button>`) : live ? `<button class="btn d" data-act="stop">${IC.stop}Encerrar</button>` : `<button class="btn p" data-act="play">${IC.play}Jogar</button>`}<button class="btn" data-act="detail">${IC.info}Detalhes</button><button class="btn" data-act="menu">Opções</button></div>`;
  $$('#sttxt .btn').forEach(b => b.onclick = () => act(b.dataset.act));
  if (STG.txt !== g.key) { STG.txt = g.key; txt.classList.remove('in'); void txt.offsetWidth; txt.classList.add('in'); }
  chip(g);
  if (wasActs >= 0) setFocus('acts', wasActs);
}
function statsHtml(g) {
  const st = isStore(g), live = S.data.sessions[g.key];
  const rows = st ? [['Tamanho', fmtSize(g.size) || '—'], ['Fonte', g.repo || '—'], ['Entrega', g.torrent && !g.direct ? 'Torrent' : 'Direto'], g.year ? ['Ano', g.year] : null]
    : [['Tempo jogado', g.playtime ? human(g.playtime) : '—'], ['Última sessão', live ? 'agora' : g.last_played ? ago(g.last_played) : 'nunca'], ['Vezes jogado', g.play_count ? String(g.play_count) : '—'], ['Sistema', SYSN(g.system || 'pc') + (g.year ? ' · ' + g.year : '')]];
  return `<div class="stats">${rows.filter(Boolean).map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
}
function chip(g) {
  const c = $('#chip'); if (!c) return;
  if (!g) { c.classList.remove('on'); return; }
  const live = S.data.sessions[g.key];
  const line1 = isStore(g) ? [g.repo, fmtSize(g.size)].filter(Boolean).join(' · ') : [live ? 'Jogando agora' : 'Instalado', g.playtime ? human(g.playtime) : '', g.play_count ? g.play_count + 'x' : '', g.store_src || ''].filter(Boolean).join(' · ');
  const line2 = isStore(g) ? (g.job ? 'Na fila de downloads' : 'Não instalado') : g.last_played ? 'Última vez ' + ago(g.last_played) : 'Nunca jogado';
  const k = encodeURIComponent(g.key);
  c.innerHTML = `<img src="/thumb/${k}" alt="" onerror="this.outerHTML='<div class=ph>${IC.play.replace(/"/g, '&quot;')}</div>'"><div class="t"><span>${esc(line1)}</span><b>${esc(line2)}</b></div>`;
  c.classList.add('on');
  c.onclick = () => openDetail(g.key);
}

function act(a) {
  const g = S.games[S.sel]; if (!g) return;
  if (a === 'play') play(g.key); else if (a === 'stop') stop(g.key); else if (a === 'detail') openDetail(g.key); else if (a === 'menu') openMenu(); else if (a === 'install') askInstall(g.key); else if (a === 'queue') setView('queue');
}
function primary(g) {
  if (!g) return;
  if (isStore(g)) return g.job ? setView('queue') : askInstall(g.key);
  if (S.data.sessions[g.key]) openMenu(); else play(g.key);
}
function askInstall(key) {
  const g = S.byKey[key]; if (!g) return;
  const tor = !!(g.torrent && !g.direct);
  layer('menu', `<div class="mbox"><h3>${esc(g.title)}</h3><p>${[fmtSize(g.size), tor ? 'via torrent' : 'download direto', g.repo].filter(Boolean).map(esc).join(' · ')}</p>
    <button class="opt" data-a="go">${IC.down}<span>Baixar agora<small>Entra na fila e começa assim que possível.</small></span></button>
    <button class="opt" data-a="detail">${IC.info}<span>Ver detalhes</span></button>
    <button class="opt" data-a="cancel">${IC.back}<span>Cancelar</span></button></div>`, async a => {
    closeLayer();
    if (a === 'detail') return openDetail(key);
    if (a !== 'go') return;
    try {
      const r = await api('/api/install', {key, torrent: tor});
      if (r && r.error) return toast('Não deu para baixar', r.error, 'bad');
      g.job = true; toast('Na fila', g.title + ' entrou na fila de downloads.');
      rumble(); S.sig = ''; render(true);
    } catch (e) { toast('Não deu para baixar', String(e && e.message || e), 'bad'); }
  });
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
  const items = (q.items || q.history || []).slice(0, 60); S.qitems = items;
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
    opts.push(`<button class="opt" data-a="remove">${IC.x}<span>Tirar da lista</span></button>`);
  }
  if (!opts.length) { toast(h.title || h.key, qstatus(h)); return; }
  layer('dlg', `<div class="mbox"><h3>${esc(h.title || h.key)}</h3><p>${esc(qstatus(h))}</p>${opts.join('')}<button class="opt" data-a="cancel">${IC.back}<span>Não fazer nada</span></button></div>`, async a => {
    closeLayer();
    if (a === 'play') return play(h.key);
    if (a === 'detail') return openDetail(h.key);
    if (a === 'pause' || a === 'stop' || a === 'retry' || a === 'remove') {
      const r = await api('/api/queue/action', {action: a, key: h.key});
      if (r && r.error) toast('Não deu', r.error, 'err'); else toast({pause: 'Pausado', stop: 'Cancelado', retry: 'Retomando', remove: 'Tirado da lista'}[a], h.title || h.key);
      setTimeout(() => { if (S.view === 'queue') renderQueue(); }, 600);
    }
  });
}
function queueAllMenu() {
  const items = S.qitems || [], running = items.filter(h => h.job).length, paused = items.filter(h => h.status === 'paused').length, done = items.filter(h => !h.job && h.status !== 'paused').length;
  layer('dlg', `<div class="mbox"><h3>Fila</h3><p>${[running ? running + ' em andamento' : '', paused ? paused + (paused === 1 ? ' pausado' : ' pausados') : '', done ? done + (done === 1 ? ' concluído' : ' concluídos') : ''].filter(Boolean).join(' · ') || 'Nada na fila.'}</p>
    ${running ? `<button class="opt" data-a="pause_all">${IC.pause}<span>Pausar tudo</span></button>` : ''}
    ${paused ? `<button class="opt" data-a="resume_all">${IC.play}<span>Continuar tudo</span></button>` : ''}
    ${done ? `<button class="opt" data-a="clear_done">${IC.x}<span>Limpar concluídos<small>Tira da lista o que já terminou. Os jogos continuam instalados.</small></span></button>` : ''}
    <button class="opt" data-a="cancel">${IC.back}<span>Fechar</span></button></div>`, async a => {
    closeLayer(); if (a === 'cancel') return;
    const r = await api('/api/queue/action', {action: a});
    if (r && r.error) toast('Não deu', r.error, 'err'); else toast({pause_all: 'Tudo pausado', resume_all: 'Retomando tudo', clear_done: 'Lista limpa'}[a] || 'Feito', '');
    setTimeout(() => { if (S.view === 'queue') renderQueue(); }, 600);
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
  console_volume: [[25, 'Baixo'], [60, 'Médio'], [100, 'Alto']],
  console_start_view: [['library', 'Biblioteca'], ['recent', 'Recentes'], ['favorites', 'Favoritos']],
  console_dim_idle: [[0, 'Nunca'], [5, '5 min'], [15, '15 min'], [30, '30 min']],
  console_sort: [['title', 'A–Z'], ['recent', 'Últimos'], ['playtime', 'Mais jogados'], ['count', 'Mais vezes'], ['added', 'Novos']],
  console_layout: [['console', 'Console'], ['cinema', 'Cinema']],
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
    ${segRow('console_volume', 'Volume dos sons', 'Quão alto são os toques de navegação.')}
    ${swRow('console_hint', 'Legenda dos botões', 'Mostra no rodapé o que cada botão do controle (ou tecla) faz.')}
    <h2>Tela</h2>
    ${segRow('console_layout', 'Disposição da tela', 'Console: abas no alto, capas no meio e o título com as horas jogadas embaixo, como nos consoles atuais. Cinema: capas no rodapé e o título por cima da arte.')}
    ${swRow('console_clock24', 'Relógio em 24 horas', 'Desligado, mostra 12 horas com AM/PM.')}
    ${swRow('console_dl_pill', 'Download no topo', 'Enquanto algo baixa ou instala, a porcentagem aparece ao lado do relógio em qualquer aba. Toque nela para abrir a Fila.')}
    ${segRow('console_dim_idle', 'Escurecer quando parado', 'Sem ninguém mexer por esse tempo, a tela escurece para poupar a TV. Qualquer botão acende de novo.')}
    <h2>Ao jogar</h2>
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
    if (k === 'console_layout') { document.body.dataset.layout = nv === 'cinema' ? 'cinema' : 'console'; S.sig = ''; }
    if (k === 'console_sort') S.sig = '';
    if (k === 'console_dim_idle') idleArm();
    if (k === 'console_volume') { setTimeout(tick, 80); }
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
  const r = await api('/api/play', {key, after: (extra && extra.after) || (c.after_launch === 'ask' ? 'minimize' : c.after_launch), emulator: extra && extra.emulator});
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
  if (isStore(g)) return layer('menu', `<div class="mbox"><h3>${esc(g.title)}</h3><p>${[SYSN(g.system || 'pc'), fmtSize(g.size), g.repo].filter(Boolean).map(esc).join(' · ')}</p>
    ${g.job ? `<button class="opt" data-a="queue">${IC.grid}<span>Ver fila</span></button>` : `<button class="opt" data-a="install">${IC.down}<span>Baixar</span></button>`}
    <button class="opt" data-a="detail">${IC.info}<span>Detalhes</span></button>
    <button class="opt" data-a="grid">${IC.grid}<span>Ver tudo em grade</span></button>
    <button class="opt" data-a="search">${IC.search || IC.info}<span>Buscar</span></button>
    <button class="opt" data-a="refresh">${IC.sort || IC.grid}<span>Atualizar a loja</span></button>
    <button class="opt" data-a="cancel">${IC.back}<span>Fechar</span></button></div>`, a => {
    closeLayer();
    if (a === 'install') askInstall(g.key); else if (a === 'queue') setView('queue'); else if (a === 'detail') openDetail(g.key); else if (a === 'grid') openGrid(); else if (a === 'search') openSearch(); else if (a === 'refresh') { S.store = null; S.sig = ''; render(true); }
  });
  layer('menu', `<div class="mbox"><h3>${esc(g.title)}</h3><p>${esc(SYSN(g.system || 'pc'))}${g.playtime ? ' · ' + human(g.playtime) : ''}</p>
    ${live ? `<button class="opt danger" data-a="stop">${IC.stop}<span>Encerrar jogo</span></button>` : `<button class="opt" data-a="play">${IC.play}<span>Jogar</span></button>`}
    <button class="opt" data-a="detail">${IC.info}<span>Detalhes</span></button>
    <button class="opt" data-a="fav">${IC.star}<span>${g.fav ? 'Tirar dos favoritos' : 'Favoritar'}</span></button>
    ${(S.data.collections || []).length || S.coll ? `<button class="opt" data-a="colls">${IC.coll}<span>Coleções<small>${S.coll ? 'Vendo “' + esc(collName(S.coll)) + '”' : 'Filtrar por uma coleção sua.'}</small></span></button>` : ''}
    <button class="opt" data-a="random">${IC.dice}<span>Me surpreenda<small>Escolhe um jogo ao acaso.</small></span></button>
    <button class="opt" data-a="grid">${IC.grid}<span>Ver todos em grade</span></button>
    <button class="opt" data-a="sort">${IC.sort || IC.grid}<span>Ordenar<small>${SORTN[S.data.config.console_sort] || 'A–Z'}</small></span></button>
    <button class="opt" data-a="search">${IC.search || IC.info}<span>Buscar</span></button>
    <button class="opt" data-a="cancel">${IC.back}<span>Fechar</span></button></div>`, a => {
    closeLayer();
    if (a === 'play') play(g.key); else if (a === 'stop') stop(g.key); else if (a === 'detail') openDetail(g.key); else if (a === 'fav') fav(g.key); else if (a === 'random') surprise(); else if (a === 'grid') openGrid(); else if (a === 'sort') sortMenu(); else if (a === 'search') openSearch(); else if (a === 'colls') collMenu();
  });
}
function collName(id) { const c = (S.data.collections || []).find(x => x.id === id); return c ? c.name : ''; }
function collMenu() {
  const cl = S.data.collections || [];
  layer('menu', `<div class="mbox"><h3>Coleções</h3><p>Listas que você montou no Ludrix em janela.</p>
    <button class="opt${S.coll ? '' : ' on'}" data-a="">${S.coll ? '' : IC.check || ''}<span>Todas</span></button>
    ${cl.map(c => `<button class="opt${S.coll === c.id ? ' on' : ''}" data-a="${esc(c.id)}">${S.coll === c.id ? IC.check || '' : ''}<span>${esc(c.name)}<small>${c.keys.filter(k => S.byKey[k]).length} na biblioteca</small></span></button>`).join('')}
    <button class="opt" data-a="cancel">${IC.back}<span>Fechar</span></button></div>`, a => {
    closeLayer(); if (a === 'cancel') return;
    S.coll = a || ''; S.sig = ''; if (S.view === 'store' || S.view === 'queue' || S.view === 'settings') S.view = 'library'; render();
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
    ['Tamanho', isStore(g) ? fmtSize(d.size || g.size) : ''], ['Fonte', isStore(g) ? g.repo : ''], ['Download', isStore(g) ? (g.torrent && !g.direct ? 'torrent' : 'direto') : ''],
    ['Tempo jogado', d.playtime ? d.playtime_h : ''], ['Vezes jogado', d.play_count ? String(d.play_count) : ''], ['Última vez', d.last_played ? ago(d.last_played) : ''], ['Origem', d.source === 'playnite' ? 'Playnite' + (d.store_src ? ' · ' + d.store_src : '') : d.store_src || ''], ['Emulador', d.emu && d.emu.emulator_title || ''], ['Pasta', d.dir]].filter(x => x[1]);
  layer('detail', `<div class="dbg" style="background-image:url('/hero/${encodeURIComponent(key)}'),url('/cover/${encodeURIComponent(key)}')"></div><div class="dgrad"></div>
    <button class="btn back" data-a="cancel">${IC.back}Voltar</button>
    <div class="dwrap"><div class="dcov"><img src="/cover/${encodeURIComponent(key)}" alt="" onerror="this.remove()"></div>
    <div class="dmain"><h1>${esc(g.title)}</h1><div class="meta">${[d.year, d.creator, SYSN(g.system || 'pc')].filter(Boolean).map(esc).join(' · ')}</div>
      ${d.description ? `<div class="desc">${esc(d.description)}</div>` : `<div class="desc" style="color:var(--muted)">${isStore(g) ? 'Sem descrição nesta fonte.' : 'Sem descrição. Você pode preencher os dados deste jogo pelo Ludrix em janela (Editar).'}</div>`}
      ${(m.shots || []).length ? `<div class="dshots">${m.shots.slice(0, 6).map((_, i) => `<img src="/shot/${encodeURIComponent(key)}/${i}?v=${m.fetched_at || 0}" alt="" loading="lazy" onerror="this.remove()">`).join('')}</div>` : ''}
      <div class="info">${info.map(([k, v]) => `<b>${k}</b><span>${esc(v)}</span>`).join('')}</div>
      <div class="acts">${isStore(g) ? (g.job ? `<button class="btn" data-a="queue">${IC.grid}Ver fila</button>` : `<button class="btn p" data-a="install">${IC.down}Baixar</button>`) : live ? `<button class="btn d" data-a="stop">${IC.stop}Encerrar</button>` : `<button class="btn p" data-a="play">${IC.play}Jogar</button>`}${isStore(g) ? '' : `<button class="btn" data-a="fav">${IC.star}${g.fav ? 'Tirar dos favoritos' : 'Favoritar'}</button>`}</div>
    </div></div>`, a => {
    if (a === 'cancel') return closeLayer();
    if (a === 'install') { closeLayer(); askInstall(key); } else if (a === 'queue') { closeLayer(); setView('queue'); } else if (a === 'play') { closeLayer(); play(key); } else if (a === 'stop') { closeLayer(); stop(key); } else if (a === 'fav') { fav(key); closeLayer(); openDetail(key); }
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
  render(); legend(); tick();
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
  if (dir === 'menu' || dir === 'start') { if (S.view === 'queue') return queueAllMenu(); if (S.view === 'settings') return; return openMenu(); }
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
  else if (dir === 'ok') { if (S.more && S.sel >= S.games.length) return setView('library'); primary(S.games[S.sel]); }
  else if (dir === 'back') { if (S.q) { S.q = ''; render(); } else if (S.coll) { S.coll = ''; S.sig = ''; render(); } else if (S.sys) { S.sys = ''; render(); } else if (S.view !== 'library') setView('library'); else confirmQuit(); }
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
        else if (['left', 'right', 'up', 'down'].includes(k) && now - h.t0 > rep[0] && now - h.t > rep[1] * (now - h.t0 > 1600 ? .55 : 1)) { h.t = now; nav(k); GP.lastAny = now; }
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
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); const o = AC.createOscillator(), g = AC.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.value = .035 * (Math.max(0, Math.min(100, +S.data.config.console_volume || 60)) / 60); o.connect(g); g.connect(AC.destination); o.start(); g.gain.exponentialRampToValueAtTime(.0001, AC.currentTime + d); o.stop(AC.currentTime + d); } catch (e) {}
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
