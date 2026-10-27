function renderDetail() {
  const d = S.det; if (!d) return; const key = d.key, job = S.jobs[key], m = d.meta || {};
  const isRom = key.startsWith('rom:'), isRecomp = d.kind === 'recomp', isLocal = d.kind === 'local', live = S.sessions && S.sessions[key];
  const genres = (m.genres && m.genres.length ? m.genres : d.genres) || [];
  let acts = '';
  if (job) acts = progHtml(job, key);
  else if (d.repack && d.repack_state !== 'done') {
    acts = `<button class="btn p" onclick="runRepack(${jsq(key)})">${I.dl} ${d.repack_state === 'installing' ? 'Instalador aberto…' : d.disc ? 'Montar o disco e instalar' : 'Abrir instalador (setup)'}</button>
      <span class="pill" style="justify-content:center;text-align:center;white-space:normal;line-height:1.35">Repack baixado. Quando o setup terminar, a pasta é localizada e o jogo entra na biblioteca.</span>
      <div class="row"><button class="btn s sm" onclick="openPath(${jsq(d.dir)},${jsq(key)})">${I.folder} Pasta</button><button class="btn s sm" onclick="chooseExe(${jsq(key)})">${I.cog} Já instalei</button></div>
      <div class="row"><button class="btn s sm" onclick="api.post('/api/finish_repack',{key:${jsq(key)}}).then(()=>openGame(${jsq(key)}))">${I.check} Procurar instalação agora</button><button class="btn d sm" onclick="confirmUninstall(${jsq(key)})" title="Apagar o repack baixado">${I.trash}</button></div>`;
  } else if (d.installed || isRom) {
    acts = `${!d.missing && d.update_version ? `<button class="btn s" onclick="updateFromSource(${jsq(key)})" title="Instalada: ${esc(d.version || '?')} · na fonte: ${esc(d.update_version)}">${I.refresh} Versão ${esc(d.update_version)} na fonte</button>` : ''}${d.missing && d.avail ? `<button class="btn p" onclick="openGame(${jsq(d.avail)})">${I.dl} Baixar da Loja</button><span class="pill" style="justify-content:center;white-space:normal;line-height:1.4;padding:6px 10px">O arquivo sumiu do PC, mas uma das suas fontes tem este jogo.</span>` : ''}${d.crash_count ? `<button class="pill warn crashpill" onclick="crashDialog(${jsq(key)}, ${jsq(d.title)})" title="${esc(d.crash_why || '')}">${I.warn || '!'} Fechou sozinho ${d.crash_count > 1 ? d.crash_count + '× ' : ''}— por quê?</button>` : ''}${d.missing ? `<button class="btn p" onclick="play(${jsq(key)})">${I.folder} Apontar ${isRom ? 'arquivo' : 'pasta'}…</button>` : `<button class="btn g" ${live ? 'disabled' : ''} onclick="play(${jsq(key)})">${I.play} ${live ? 'Jogando…' : 'Jogar'}</button>`}
      <div class="row">${d.dir && !isUri(d.exe) && !d.missing ? `<button class="btn s sm" onclick="openPath(${jsq(d.dir)},${jsq(key)})">${I.folder} Pasta</button>` : ''}
      <button class="btn s sm" onclick="savesPanel(${jsq(key)})" title="Saves">${I.save} Saves</button>
      <button class="btn s sm" onclick="editGame(${jsq(key)})" title="Editar detalhes do jogo (nome, capa, descrição, executável…)">${I.edit} Editar</button><button class="btn d sm" onclick="confirmUninstall(${jsq(key)})" title="${isLocal || isRom ? 'Remover da biblioteca' : 'Desinstalar'}">${I.trash}</button></div>`;
  } else {
    const multi = (d.files || []).length > 1;
    if (d.buy_only) acts = `<span class="pill warn" style="justify-content:center;white-space:normal;line-height:1.4;padding:8px 10px">Este jogo ainda está à venda — o site não distribui o arquivo. Veja em "Origem".</span>`;
    else if (d.browser_only) acts = `<button class="btn p" ${d.files?.length ? '' : 'disabled'} onclick="install(${jsq(key)},false)">${I.ext} Baixar pelo navegador</button><span class="pill" style="justify-content:center;white-space:normal;line-height:1.4;padding:6px 10px">${multi ? 'Escolha o mirror ao lado → ' : ''}O site pede verificação humana, então o download abre no navegador. Depois: Adicionar → Jogo de Windows.</span>${d.steam_url ? `<button class="btn s sm" onclick="api.post('/api/open_url',{url:${jsq(d.steam_url)}})">${I.ext} Página na Steam</button>` : ''}`;
    else if (d.owned) acts = `<button class="btn p" onclick="play(${jsq(d.owned)})">${I.play} Jogar</button><button class="btn s sm" onclick="openGame(${jsq(d.owned)})">${I.info} Ver na biblioteca</button><span class="pill" style="justify-content:center">Já está no PC</span>`;
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

  const srcs = d.sources && d.sources.length > 1 ? `<div class="srcbar"><small>${d.sources.length} fontes têm este jogo</small><div class="srcpick">${d.sources.map(sx => `<button class="srcopt ${sx.me ? 'on' : ''}" ${sx.me ? 'disabled' : `onclick="openGame(${jsq(sx.key)})"`}><b>${esc(sx.repo_name)}</b><span>${[sx.direct ? (sx.files_n > 1 ? `${sx.files_n} arquivos` : 'direto') : '', sx.torrent ? 'torrent' : '', sx.size ? fmt(sx.size) : '', sx.installed ? 'instalado' : ''].filter(Boolean).join(' · ') || '—'}</span>${sx.me ? `<i>${I.check}</i>` : `<i>${I.chev}</i>`}</button>`).join('')}</div></div>` : '';
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
    m.status || m.score ? ['Para você', `${m.status ? `<span class="pill">${esc(statusName(m.status))}</span>` : ''}${scoreHtml(m.score, 'big')} <a href="#" onclick="editGame(${jsq(key)},'avancado');return false" style="color:var(--accent2);margin-left:6px">editar</a>`] : null,
    m.notes ? ['Notas', `<span style="white-space:pre-wrap">${esc(m.notes)}</span> <a href="#" onclick="editGame(${jsq(key)},'avancado');return false" style="color:var(--accent2);margin-left:6px">editar</a>`] : null
  ].filter(x => x && x[1]);
  const lbl = [d.system_name || 'PC', m.developer || d.creator, m.year || d.year].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ') + (live ? ' &nbsp;·&nbsp; <b>Jogando agora</b>' : d.missing ? ' &nbsp;·&nbsp; <b style="color:var(--amber)">Arquivo não encontrado</b>' : d.installed || isRom ? ' &nbsp;·&nbsp; <b>Instalado</b>' : (S.byKey[d.key] || {}).link_dead ? ' &nbsp;·&nbsp; <b style="color:var(--amber)" title="O link direto não respondeu no último teste da fonte">Link fora do ar</b>' : '');
  $('#detail').classList.toggle('art', !!(m.hero || m.hero_url || m.background_file));
  const dimg = !!((S.byKey[key] || {}).hero_ok || m.hero || m.hero_url || m.background_file) && (S.config.detail_art || 'auto') !== 'off';
  $('#dWrap').innerHTML = `
    <div class="dhero${dimg ? ' himg' : ''}" id="dHero"${dimg ? ` style="--dimg:url('/hero/${enc(key)}?v=${(S.byKey[key] || {}).cv || 0}')"` : ''}><div class="dcov"><img src="/cover/${enc(key)}?v=${(S.byKey[key] || {}).cv || m.fetched_at || 0}" alt="${esc((d.title || '?').trim().charAt(0).toUpperCase())}" onload="dbandColor(this)" onerror="dph(this)"><div class="covedit"><button class="btn s xs" onclick="setCover(${jsq(key)})" title="Usar uma imagem minha como capa">${I.image} Trocar capa</button>${d.custom_cover ? `<button class="btn s xs" onclick="resetCover(${jsq(key)})" title="Voltar à capa original">${I.refresh}</button>` : ''}</div></div>
    <div class="dhead"><div class="dlbl">${lbl}</div><h1>${esc(d.title)}</h1>
      <div class="meta">${isLocal ? `<span class="pill">${d.source === 'playnite' ? 'Importado do Playnite' : 'Adicionado manualmente'}</span>` : ''}${d.playtime > 60 ? `<span class="pill">${clock} ${esc(d.playtime_h)}</span>` : ''}${isRecomp ? '<span class="pill ac">Recompilação nativa</span>' : ''}${isRom ? `<span class="pill ac">${esc(d.system_name)}</span>` : ''}
        ${genres.slice(0, 3).map(x => `<span class="pill">${esc(x)}</span>`).join('')}${m.year || d.year ? `<span class="pill">${esc(m.year || d.year)}</span>` : ''}${d.size ? `<span class="pill">${fmt(d.size)}</span>` : ''}${d.meta ? `<span class="pill" title="${esc([].concat(m.source || []).join(', '))}">${I.spark} meta</span>` : ''}</div>
      <div class="acts">${acts}${page}${metaBtn}</div></div></div>
    <div class="dmain">
      ${d.requires_rom ? `<div class="note"><b>Precisa da ROM original.</b> ${esc(d.requires_rom)}. Recompilações não incluem dados do jogo — o launcher só baixa o executável.</div>` : ''}
      ${d.emu && !d.emu.installed ? `<div class="note"><b>${esc(d.emu.emulator_title)} não instalado.</b> <a href="#" onclick="setView('emulation');return false" style="color:var(--accent2)">Instalar na aba Emuladores</a> para jogar.</div>` : ''}
      ${srcs}
      ${dtabsHtml(d, m)}
      <div class="dpane ${(S.dtab || 'about') === 'about' ? 'on' : ''}" data-pane="about">
      <div class="desc" style="margin-top:14px">${esc(m.summary || d.description || 'Sem descrição. Clique em "Buscar metadados".')}</div>
      <div class="dsec"><h3>INFORMAÇÕES</h3><div class="kv">${kv.map(([k, v]) => `<b>${k}</b><span>${['Wikipedia', 'GOG', 'Steam', 'Nome original', 'Capa', 'Link', 'Notas', 'Tamanho', 'Para você'].includes(k) ? v : esc(v)}</span>`).join('')}</div></div>
      </div>
      <div class="dpane ${S.dtab === 'files' ? 'on' : ''}" data-pane="files">${filesHtml(key, d, files)}</div>
      <div class="dpane ${S.dtab === 'mods' ? 'on' : ''}" data-pane="mods"><div class="dsec" id="dMods"><p class="mut">Procurando ferramentas e sites de mods…</p></div></div>
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
  const shots = (m.shots || d.screenshots || []).length, isRom = d.kind === 'rom' || String(d.key || '').startsWith('rom:');
  const hasFiles = Boolean(d.installed || d.missing || (d.files && d.files.length > 1) || (d.patches && d.patches.length));
  const nf = d.installed || d.missing ? 0 : ((d.files || []).length > 1 ? d.files.length : 0) + ((d.patches || []).length);
  const tabs = [['about', 'Sobre'], hasFiles ? ['files', `Arquivos${nf ? ` <span class="n">${nf}</span>` : ''}`] : null, isRom ? null : ['mods', 'Mods'], ['shots', `Screenshots${shots ? ` <span class="n">${shots}</span>` : ''}`], ['reqs', 'Requisitos']].filter(Boolean);
  if (!tabs.some(t => t[0] === (S.dtab || 'about'))) S.dtab = 'about';
  return `<div class="tabs dtabs">${tabs.map(([id, l]) => `<button class="${(S.dtab || 'about') === id ? 'on' : ''}" data-tab="${id}" onclick="dtab('${id}')">${l}</button>`).join('')}</div>`;
}
function dtab(id) { S.dtab = id; document.querySelectorAll('.dtabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === id)); document.querySelectorAll('.dpane').forEach(p => p.classList.toggle('on', p.dataset.pane === id)); if (id === 'files' && S.det && (S.det.installed || S.det.missing)) loadExesFor(S.det.key); }
function filesHtml(key, d, storeFiles) {
  if (!(d.installed || d.missing)) return storeFiles || '<div class="dsec dempty"><p class="mut">Nada para listar.</p></div>';
  const uri = isUri(d.exe || ''), isRom = d.kind === 'rom' || key.startsWith('rom:'), local = /^(local|rom):/.test(key);
  const row = (ic, t, v, acts) => `<div class="frow fr"><div class="l"><b>${ic} ${t}</b><span class="path">${v}</span></div>${acts || ''}</div>`;
  const b = (l, fn, t) => `<button class="btn s xs" onclick="${fn}" ${t ? `title="${esc(t)}"` : ''}>${l}</button>`;
  let h = '<div class="dsec files2">';
  if (d.missing) h += `<div class="note"><b>Arquivo não encontrado.</b> O jogo foi movido ou apagado. Aponte o novo caminho ou remova da biblioteca.</div>`;
  h += row(I.play, uri ? 'Abre por' : isRom ? 'ROM' : 'Executável', esc(uri ? `${uriName(d.exe)} (${d.exe})` : d.exe || '—'), local && !uri ? `<div class="row">${isRom ? '' : b('Trocar…', `chooseExe(${jsq(key)})`, 'Escolher outro .exe desta pasta')}${d.missing ? b('Apontar…', `ctxDo('relocate',${jsq(key)})`) : b('Mostrar', `api.post('/api/open_select',{key:${jsq(key)}})`, 'Abrir a pasta com o arquivo selecionado')}</div>` : '');
  if (d.dir && !uri) h += row(I.folder, 'Pasta', esc(d.dir), `<div class="row">${b('Abrir', `openPath(${jsq(d.dir)},${jsq(key)})`)}${d.size ? '' : b('Tamanho', `calcSize(${jsq(key)},this)`, 'Somar o tamanho da pasta')}</div>`);
  if (d.size) h += row(I.folder, 'Tamanho', fmt(d.size));
  if (d.args) h += row(I.cog, 'Argumentos', esc(d.args), local ? b('Editar', `editGame(${jsq(key)},'avancado')`) : '');
  if (d.workdir) h += row(I.folder, 'Pasta de trabalho', esc(d.workdir));
  if (!isRom && !uri) h += row(I.save, 'Saves', '<span style="font-family:var(--font-text,inherit)">Onde este jogo guarda o progresso, backups e importação</span>', b('Ver saves', `savesPanel(${jsq(key)})`));
  h += '</div>';
  if (!isRom && !uri && local) h += `<div class="dsec" id="dExes"><h3>OUTROS EXECUTÁVEIS NA PASTA</h3><p class="mut">Procurando…</p></div>`;
  return h;
}
async function loadExesFor(key) {
  const el = $('#dExes'); if (!el || el.dataset.done) return; el.dataset.done = '1';
  const exes = await api.get('/api/exes/' + enc(key)).catch(() => []); if (!$('#dExes') || S.current !== key) return;
  const cur = String((S.det || {}).exe || '').toLowerCase(), list = (Array.isArray(exes) ? exes : []).filter(x => String(x).toLowerCase() !== cur);
  if (!list.length) { el.remove(); return; }
  const dir = String((S.det || {}).dir || ''); const short = x => dir && x.toLowerCase().startsWith(dir.toLowerCase()) ? x.slice(dir.length).replace(/^[\\/]/, '') : x;
  el.innerHTML = `<h3>OUTROS EXECUTÁVEIS NA PASTA <span class="n">${list.length}</span></h3><div class="exelist">${list.slice(0, 30).map(x => `<div class="exe"><span title="${esc(x)}">${esc(short(x))}</span><button class="btn s xs" onclick="useExe(${jsq(key)},${jsq(x)})">Usar este</button></div>`).join('')}</div>${list.length > 30 ? `<p class="mut">E mais ${list.length - 30}…</p>` : ''}`;
}
async function useExe(key, exe) { const r = await api.post('/api/set_exe', { key, rel: exe }); if (r.ok) { toast('ok', 'Executável definido', r.exe); openGame(key); } else if (r.error) toast('err', 'Não foi possível trocar', r.error); }
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
  const q = encodeURIComponent(`${d.title || ''} ${S.config.language === 'en' ? 'system requirements pc' : 'requisitos de sistema pc'}`);
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
