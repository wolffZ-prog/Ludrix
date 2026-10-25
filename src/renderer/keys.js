const KEYACTS = [
  ['palette', 'Paleta de comandos', 'Ctrl+K', 'global'], ['search', 'Buscar na aba atual', 'Ctrl+F', 'global'], ['search2', 'Buscar (tecla rápida)', '/', 'quick'],
  ['fullscreen', 'Tela cheia', 'F11', 'global'], ['reload', 'Recarregar a biblioteca', 'F5', 'global'], ['settings', 'Abrir Ajustes', 'Ctrl+,', 'global'],
  ['undo', 'Desfazer remoção', 'Ctrl+Z', 'free'], ['select_all', 'Selecionar todos (Biblioteca)', 'Ctrl+A', 'free'], ['fav_stage', 'Favoritar o jogo em destaque', 'Ctrl+D', 'free'],
  ['add_game', 'Adicionar jogo', 'N', 'plain'], ['help', 'Lista de atalhos', '?', 'plain'],
  ['play', 'Jogar o jogo selecionado', 'Enter', 'game'], ['details', 'Detalhes do selecionado', 'I', 'game'], ['fav', 'Favoritar o selecionado', 'F', 'game'],
  ['edit', 'Editar o selecionado', 'E', 'game'], ['rename', 'Renomear o selecionado', 'F2', 'game'], ['remove', 'Remover o selecionado', 'Delete', 'game'],
];
const KEY_NAMES = { ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc' };
function keyCombo(e) {
  const k = e.key; if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return '';
  const mods = []; if (e.ctrlKey || e.metaKey) mods.push('Ctrl'); if (e.altKey) mods.push('Alt');
  let name = KEY_NAMES[k] || (k.length === 1 ? k.toUpperCase() : k);
  if (e.shiftKey && (k.length !== 1 || /^[a-z]$/i.test(k))) mods.push('Shift');
  return mods.concat(name).join('+');
}
function keyMap() { const m = {}; const custom = S.config.keymap || {}; for (const [id, , def] of KEYACTS) m[id] = Object.prototype.hasOwnProperty.call(custom, id) ? (custom[id] || '') : def; return m; }
function keyAction(combo, ctx) { if (!combo) return ''; const m = keyMap(); for (const [id, , , c] of KEYACTS) if (m[id] === combo && (ctx === 'any' || ctx === c)) return id; return ''; }
function keyLabel(combo) { return combo ? combo.split('+').map(x => `<kbd>${esc(x)}</kbd>`).join('<i>+</i>') : '<em class="dim">nenhum</em>'; }
async function keyCapture(id) {
  const act = KEYACTS.find(a => a[0] === id); if (!act) return;
  const m = keyMap();
  modal({ title: act[1], html: `<p>Pressione a combinação nova. <b>Backspace</b> volta ao padrão (${esc(act[2])}), <b>Esc</b> cancela.</p><div class="keycap" id="keycap">${keyLabel(m[id])}</div>`, noOk: true, cancel: 'Fechar' });
  const box = $('#keycap'); if (!box) return;
  const h = async e => {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { document.removeEventListener('keydown', h, true); $('#modal').classList.remove('on'); return; }
    let combo;
    if (e.key === 'Backspace') combo = act[2]; else { combo = keyCombo(e); if (!combo) return; }
    const other = KEYACTS.find(a => a[0] !== id && m[a[0]] === combo && (a[3] === act[3] || a[3] === 'global' || act[3] === 'global'));
    if (other) { box.innerHTML = keyLabel(combo) + `<small class="warn">já usado por "${esc(other[1])}"</small>`; return; }
    document.removeEventListener('keydown', h, true);
    const km = { ...(S.config.keymap || {}) }; if (combo === act[2]) delete km[id]; else km[id] = combo;
    await setCfg({ keymap: km }); $('#modal').classList.remove('on'); toast('ok', act[1], combo); if (S.view === 'settings') renderSettings(true);
  };
  document.addEventListener('keydown', h, true);
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if ($('#ctx').classList.contains('on')) closeCtx(); else if ($('#modal').classList.contains('on')) $('#modal').classList.remove('on'); else if (S.sel.size && !$('#detail').classList.contains('on')) msClear(); else closeDetail(); }
  const combo = keyCombo(e);
  const KA = keyAction(combo, 'any');
  if (KA === 'fullscreen') { e.preventDefault(); toggleFullscreen(); return; }
  if (KA === 'palette') { e.preventDefault(); palOpen(); return; }
  if (KA === 'search2' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { e.preventDefault(); focusSearch(); return; }
  if (e.key === '"' && S.config.terminal_enabled && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { e.preventDefault(); openTerminal(); }
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable;
  const busy = $('#modal').classList.contains('on') || $('#welcome')?.classList.contains('on') || $('#flashwin')?.classList.contains('on');
  if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[1-9]$/.test(e.key)) { const tabs = navOrder().filter(v => !(S.config.nav_hidden || []).includes(v)).concat(['settings']); const v = tabs[+e.key - 1]; if (v) { e.preventDefault(); closeDetail(); setView(v); } return; }
  if (KA === 'select_all' && S.view === 'home' && !typing && !busy && !$('#detail').classList.contains('on')) { e.preventDefault(); for (const c of document.querySelectorAll('#view .card')) if (/^(local|rom):/.test(c.dataset.key)) S.sel.add(c.dataset.key); document.querySelectorAll('#view .card').forEach(c => c.classList.toggle('msel', S.sel.has(c.dataset.key))); msBar(); return; }
  if (KA === 'settings') { e.preventDefault(); closeDetail(); setView('settings'); return; }
  if (KA === 'search') { e.preventDefault(); focusSearch(); return; }
  if (KA === 'reload') { e.preventDefault(); if (!busy) { S.home = null; S._poolKey = ''; loadCatalog(false); toast('', 'Biblioteca atualizada', ''); } return; }
  if (KA === 'undo' && !typing && !busy) { e.preventDefault(); undoRemove(); return; }
  if (KA === 'fav_stage' && !typing && !busy && S.view === 'home' && S.stageKey && S.byKey[S.stageKey]) { e.preventDefault(); toggleFav(S.stageKey); return; }
  if (typing || busy) return;
  if (KA === 'help') { e.preventDefault(); shortcutsHelp(); return; }
  if (KA === 'add_game' && S.view === 'home' && !$('#detail').classList.contains('on')) { e.preventDefault(); addLocal(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if ((e.key === 'Home' || e.key === 'End') && !$('#modal').classList.contains('on') && !$('#detail').classList.contains('on')) { const v = $('#view'); if (v) { e.preventDefault(); v.scrollTo({ top: e.key === 'Home' ? 0 : v.scrollHeight, behavior: 'smooth' }); } return; }
  if ($('#detail').classList.contains('on')) {
    if (e.key === 'Enter' && S.det) { const b = $('#dWrap .acts > .btn.g, #dWrap .acts > .btn.p'); if (b && !b.disabled) { e.preventDefault(); b.click(); } }
    return;
  }
  if (S.view !== 'home' || !S.stageKey || !S.byKey[S.stageKey]) return;
  const g = S.byKey[S.stageKey];
  const GA = keyAction(combo, 'game');
  if (GA === 'play') { e.preventDefault(); if (g.installed || S.stageKey.startsWith('rom:')) play(S.stageKey); else openGame(S.stageKey); }
  else if (GA === 'details') { e.preventDefault(); openGame(S.stageKey); }
  else if (GA === 'fav') { e.preventDefault(); toggleFav(S.stageKey); }
  else if (GA === 'edit' && /^(local|rom):/.test(S.stageKey)) { e.preventDefault(); editGame(S.stageKey); }
  else if (GA === 'rename' && /^(local|rom):/.test(S.stageKey)) { e.preventDefault(); renameGame(S.stageKey); }
  else if (GA === 'remove' && S.sel.size) { e.preventDefault(); removeMany([...S.sel]); }
  else if (GA === 'remove' && /^(local|rom):/.test(S.stageKey)) { e.preventDefault(); confirmUninstall(S.stageKey); }
});
function shortcutsHelp() {
  const tabs = navOrder().filter(v => !(S.config.nav_hidden || []).includes(v)).concat(['settings']);
  const names = Object.fromEntries(NAV_ITEMS.map(([v, n]) => [v, n])); names.settings = 'Ajustes';
  const km = keyMap();
  const row = (k, d) => `<div class="krow"><span>${(Array.isArray(k) ? k : String(k || '').split('+')).filter(Boolean).map(x => `<kbd>${esc(x)}</kbd>`).join('<i>+</i>') || '<em class="dim">—</em>'}</span><em>${d}</em></div>`;
  const K = id => km[id];
  modal({ title: 'Atalhos do teclado', wide: true, ok: 'Fechar', noCancel: true, buttons: [{ label: 'Personalizar', fn: () => { closeDetail(); setView('settings'); settingsTab('general', 'Teclado'); } }], html: `<div class="kgrid">
    <div class="kcol"><h4>Em qualquer lugar</h4>${row(K('search2'), 'Buscar na aba atual')}${row(K('search'), 'Buscar (alternativa)')}${row(K('palette'), 'Paleta: jogos, ações e ajustes')}${row(K('reload'), 'Recarregar a biblioteca')}${row(['Ctrl', '1…' + tabs.length], tabs.map((v, i) => `${i + 1} ${names[v] || v}`).join(' · '))}${row(K('settings'), 'Abrir Ajustes')}${row(K('fullscreen'), 'Tela cheia')}${row(['Esc'], 'Fechar o que estiver aberto (detalhes, janela, menu)')}${row(K('help'), 'Esta lista')}</div>
    <div class="kcol"><h4>Na Biblioteca, com um jogo selecionado</h4>${row(K('play'), 'Jogar (ou abrir os detalhes se não estiver instalado)')}${row(K('details'), 'Abrir os detalhes')}${row(K('fav'), 'Favoritar / desfavoritar')}${row(K('edit'), 'Editar detalhes (jogos adicionados e ROMs)')}${row(K('rename'), 'Renomear')}${row(K('fav_stage'), 'Favoritar o jogo em destaque')}${row(K('undo'), 'Desfazer a última remoção (até 10 minutos)')}${row(K('add_game'), 'Adicionar jogo')}${row(['Home', 'End'], 'Ir para o começo ou o fim da lista')}${row(K('remove'), 'Remover da biblioteca (jogos adicionados e ROMs; pede confirmação)')}${row(['Ctrl', 'clique'], `Selecionar vários (Shift+clique para um intervalo; ${esc(K('select_all'))} todos da página)`)}<h4>Nos detalhes de um jogo</h4>${row(['Enter'], 'Jogar ou Baixar')}${row(['Esc'], 'Voltar')}${S.config.terminal_enabled ? `<h4>Extras</h4>${row(['"'], 'Terminal do Ludrix')}` : ''}</div></div>` });
}
