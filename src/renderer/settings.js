function settingsData(fresh) {
  if (fresh) { S._setOk = false; S._cache = null; }
  if (!S._setOk && !S._setReq) {
    S._setReq = Promise.all([api.get('/api/themes/full'), api.get('/api/repos')]).then(([t, r]) => {
      S._setReq = null; S._setOk = true;
      const nt = Array.isArray(t) ? t : [], nr = Array.isArray(r) ? r : [];
      const changed = JSON.stringify(nt) !== JSON.stringify(S.themes || []) || JSON.stringify(nr) !== JSON.stringify(S.repos || []);
      S.themes = nt; S.repos = nr;
      if (changed && S.view === 'settings') renderSettings();
    }).catch(() => { S._setReq = null; });
  }
  const tab = S.tab.settings || 'general';
  if (tab === 'tools' && !S._cache && !S._cacheReq) S._cacheReq = api.get('/api/cache').then(d => { S._cacheReq = null; S._cache = d || {}; settingsCacheFill(); }).catch(() => { S._cacheReq = null; });
  if (tab === 'system' && !S.hw && !S._hwReq) S._hwReq = api.get('/api/hardware').then(d => { S._hwReq = null; S.hw = d || { error: 'sem resposta' }; if (S.view === 'settings' && (S.tab.settings || 'general') === 'system') renderSettings(); }).catch(() => { S._hwReq = null; });
  return { themes: S.themes || [], repos: S.repos || [], cache: S._cache || null, hw: S.hw || null };
}
function settingsCacheFill() {
  const box = $('#cacheBox'); if (!box || !S._cache) return;
  box.querySelectorAll('input[value]').forEach(i => { const sp = i.parentElement.querySelector('span'); if (sp) sp.textContent = fmt(S._cache[i.value]) || '0 B'; });
}
async function renderSettings(fresh) {
  const { themes, cache, repos, hw } = settingsData(fresh);
  if (S.view !== 'settings') return;
  if ((S.tab.settings || 'general') === 'custom' && !S.custom) S.custom = await api.get('/api/custom');
  if ((S.tab.settings || 'general') === 'custom' && !S.fonts) S.fonts = ((await api.get('/api/fonts')) || {}).fonts || [];
  if (S.view !== 'settings') return;
  const keepScroll = $('#view').scrollTop;
  const c = S.config; const tab = S.tab.settings || 'general';
  const sw = (k, label, desc) => `<div class="frow"><div class="l"><b>${label}${restartTag(k)}</b><span>${desc}</span></div><button class="sw ${c[k] ? 'on' : ''}" onclick="setCfg({${k}:!S.config.${k}})"></button></div>`;
  const TABS = [
    ['general', 'Geral', 'cog', ['idioma', 'janela_geral', 'notificacoes', 'teclado', 'orientacao']],
    ['appearance', 'Aparência', 'image', ['tema', 'janela', 'navegacao', 'sofa', 'escala', 'efeitos']],
    ['library', 'Biblioteca', 'home', ['cartoes', 'capas', 'pastas']],
    ['play', 'Ao jogar', 'play', ['ao_abrir', 'discord', 'linux', 'saves', 'emuladores', 'controle', 'console']],
    ['store', 'Store e downloads', 'dl', ['fontes', 'store', 'instalacao', 'torrent']],
    ['tools', 'Ferramentas', 'wrench', ['verificar', 'importar', 'exportar', 'metadados', 'dados', 'diagnostico', 'limpeza']],
    ['system', 'Sistema', 'cpu', ['pc', 'segundo_plano', 'atualizacoes', 'perigo', 'sobre']],
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
    ${c.os === 'windows' ? `<div class="frow"><div class="l"><b>Atalho no Menu Iniciar</b><span>Registra o LudrixHub no Windows: nome e ícone certos na barra de tarefas e nas notificações. Só na sua conta</span></div><button class="sw ${c.start_menu !== false ? 'on' : ''}" onclick="setStartMenu(${c.start_menu === false})"></button></div>` : ''}
    ${c.os === 'windows' ? `<div class="frow"><div class="l"><b>Abrir .lxtheme e .lxup com o Ludrix</b><span>Duplo clique num tema ou numa atualização baixada já importa. Só mexe no registro do seu usuário</span></div><button class="sw ${c.file_assoc !== false ? 'on' : ''}" onclick="setFileAssoc(${c.file_assoc === false})"></button></div>` : ''}
    ${sw('win_notify', 'Notificações do sistema', `Aviso do ${c.os === 'windows' ? 'Windows' : 'sistema'} quando um download termina, um jogo é atualizado ou fecha sozinho — com botão Jogar, mesmo com o Ludrix recolhido na bandeja. Nada aparece enquanto a janela está em uso.`)}
    ${sw('tray_enabled', 'Ícone na bandeja', 'Mantém o launcher acessível ao lado do relógio quando recolhido. Botão direito no ícone: jogar um dos últimos jogos, ir direto a uma tela, ver a fila, verificar atualizações ou sair. Desligado, ele apenas minimiza para a barra de tarefas')}
    ${c.tray_enabled !== false ? sw('tray_sleep', 'Dormir na bandeja', 'Recolhido há mais de 25 s, o Ludrix libera a janela da memória e fica só com o ícone (uns 50 MB em vez de centenas). Downloads, tempo de jogo, Discord e atalho continuam; a janela volta em 1 s') : ''}
    <div class="frow"><div class="l"><b>Ao fechar a janela</b><span>${{ ask: 'Mostra as opções ao clicar no X e memoriza a escolha.', tray: 'Sai da barra de tarefas e fica no ícone ao lado do relógio.', quit: 'Fecha por completo, inclusive o ícone da bandeja.' }[c.close_action || 'ask']} Com um jogo aberto e a bandeja ligada, o Ludrix apenas se recolhe para continuar contando o tempo.</span></div>${cfgSel('close_action', [['ask', 'Perguntar'], ['tray', 'Bandeja'], ['quit', 'Encerrar']], c.close_action || 'ask')}</div>
    ${c.tray_enabled === false ? '<p>Sem o ícone na bandeja, o X sempre encerra o launcher.</p>' : ''}
    ${sw('hotkey_enabled', 'Atalho de teclado global', 'Mostra ou esconde o Ludrix de qualquer lugar, mesmo com um jogo aberto')}
    ${c.hotkey_enabled !== false ? `<div class="frow"><div class="l"><b>Tecla do atalho</b><span>${c.hotkey_status && c.hotkey_status.error ? `<span style="color:var(--amber)">${esc(c.hotkey_status.error)}</span>` : 'Clique no campo e pressione a combinação (precisa de Ctrl, Alt, Shift ou Win).'}</span></div><input class="mi" readonly value="${esc(c.hotkey || '')}" placeholder="pressione as teclas" style="width:170px;text-align:center;cursor:pointer" onkeydown="hotkeyCapture(event,this)" onfocus="this.dataset.old=this.value;this.value='…'" onblur="if(this.value==='…')this.value=this.dataset.old||''"></div>` : ''}`]),
    notificacoes: () => sec('notificacoes', 'Notificações', [`
    ${sw('popups', 'Avisos dentro do app', 'Download concluído, erros e pendências aparecem como cartão no canto; o sino guarda o histórico')}
    ${sw('notify_sound', 'Som ao concluir download', 'Um aviso sonoro curto quando um jogo termina de instalar')}
    ${sw('ui_sounds', 'Sons da interface', 'Cliques, abrir e fechar com sons curtos e suaves, estilo console')}
    ${c.ui_sounds !== false ? `<div class="frow"><div class="l"><b>Volume dos sons</b><span>Toca uma amostra ao escolher.</span></div>${cfgSel('ui_sounds_level', [['low', 'Baixo'], ['mid', 'Médio'], ['high', 'Alto']], c.ui_sounds_level || 'low', ";setTimeout(()=>uiSound('done'),300)")}</div>` : ''}`]),
    teclado: () => { const km = keyMap(), custom = c.keymap || {}; return sec('teclado', 'Teclado', [`
    <div class="keyrows">${KEYACTS.map(([id, label, def]) => `<button class="keyrow ${custom[id] !== undefined ? 'custom' : ''}" onclick="keyCapture('${id}')" title="Clique para trocar"><span>${esc(label)}</span><b>${keyLabel(km[id])}</b></button>`).join('')}</div>
    <div class="frow" style="border:0;padding-top:4px"><div class="l"><span>Clique num atalho para trocar. Ctrl+1…9 troca de aba e Esc fecha, fixos.</span></div>${Object.keys(custom).length ? `<button class="btn s sm" onclick="setCfg({keymap:{}})">Voltar tudo ao padrão</button>` : ''}</div>`]); },
    orientacao: () => sec('orientacao', 'Orientação', [`
    <div class="frow"><div class="l"><b>Tour de boas-vindas</b><span>As telas da primeira abertura</span></div><button class="btn s sm" onclick="welcomeTour()">Ver de novo</button></div>`]),
    tema: () => themesHtml(c),
    janela: () => sec('janela', 'Janela', [`
    ${S.config.os === 'windows' ? sw('frameless', 'Janela sem moldura do Windows', 'A barra de título segue o tema, com os botões de minimizar, maximizar e fechar desenhados pelo launcher. Vale após reabrir.') : ''}
    ${S.config.os === 'windows' && c.native ? `<div class="frow"><div class="l"><b>Moldura do Windows</b><span>${c.frameless ? 'Com a janela sem moldura, vale para a borda fina e os cantos' : 'Barra de título, texto e borda da janela'} no tom do tema. No Windows 10 só o claro/escuro acompanha</span></div>${cfgSel('frame_mode', [['theme', 'No tom do tema'], ['windows', 'Padrão do Windows']], c.frame_mode || 'theme')}</div>
    <div class="frow"><div class="l"><b>Cantos da janela</b><span>Windows 11. "Padrão" deixa o sistema decidir</span></div>${cfgSel('frame_corners', [['', 'Padrão'], ['round', 'Arredondados'], ['small', 'Levemente arredondados'], ['square', 'Retos']], c.frame_corners || '')}</div>` : ''}
    <div class="frow"><div class="l"><b>Barra de navegação</b><span>Onde ficam Biblioteca, Store, Emuladores… "Só ícones" libera espaço em janela pequena; "solta" separa a barra do conteúdo, com botões quadrados</span></div>${cfgSel('nav_layout', [['', 'Como o tema define'], ['side', 'Lateral com nomes'], ['rail', 'Lateral só ícones'], ['sfloat', 'Lateral solta, com nomes'], ['float', 'Lateral solta, em quadrados'], ['top', 'No alto'], ['bottom', 'Embaixo']], c.nav_layout || '')}</div>
    <div class="frow"><div class="l"><b>Relógio na barra de status</b><span>Útil com a janela sem moldura ou em tela cheia, quando a barra do Windows some</span></div>${cfgSel('clock', [['off', 'Desligado'], ['time', 'Hora'], ['datetime', 'Dia e hora']], c.clock || 'off')}</div>
    `], { adv: [`
    ${c.native && c.frameless ? `<div class="frow"><div class="l"><b>Menus do botão direito</b><span>O menu do Ludrix fica dentro da janela, com cabeçalho, ícones e submenus; o nativo é o menu padrão do Windows, sem as cores do tema${S.themeMenu ? ` · o tema atual pede <b style="display:inline">${S.themeMenu === 'ludrix' ? 'Menu do Ludrix' : 'Menu nativo do Windows'}</b>` : ''}</span></div>
      ${cfgSel('ctx_menu', [['', 'Seguir o tema (padrão: Ludrix)'], ['ludrix', 'Menu do Ludrix'], ['windows', 'Menu nativo do Windows']], c.ctx_menu || '')}</div>` : ''}`] }),
    navegacao: () => sec('navegacao', 'Navegação', [`
        <div class="frow" style="align-items:flex-start;flex-direction:column;gap:8px"><div class="l"><b>Abas</b><span>Arraste para mudar a ordem e desligue o que você não usa. O que estiver desligado continua acessível pela busca e pelo menu do logo.</span></div>
    <div class="navedit" id="navEdit">${navOrder().map(v => { const it = NAV_ITEMS.find(x => x[0] === v), hid = (c.nav_hidden || []).includes(v), svg = ($('#rail .rb[data-view="' + v + '"] svg') || {}).outerHTML || ''; return `<div class="nrow${hid ? ' off' : ''}" draggable="true" data-v="${v}" ondragstart="navDrag(event)" ondragover="navOver(event)" ondragleave="this.classList.remove('dt','db')" ondrop="navDrop(event)"><i class="grip">${I.dots}</i><span class="ic">${svg}</span><b>${esc(it[1])}</b>${v === 'home' ? '<small>sempre visível</small>' : `<button class="sw ${hid ? '' : 'on'}" onclick="navToggle(${jsq(v)})"></button>`}</div>`; }).join('')}</div>
    ${(c.nav_order || []).length || (c.nav_hidden || []).length ? `<button class="btn s xs" style="margin-top:10px" onclick="setCfg({nav_order:[],nav_hidden:[]})">Restaurar padrão</button>` : ''}</div>`]),
    sofa: () => sec('sofa', 'Modo sofá', [`
    <div class="frow"><div class="l"><b>Controle</b><span>Com um controle ligado, qualquer botão passa a navegação para ele: direcional move, A seleciona, B volta, X abre o menu, Y favorita, LB/RB trocam de aba, Start joga. Mexer o mouse volta ao normal</span></div>
      ${cfgSel('gamepad', [['auto', 'Ligar quando um controle for usado'], ['off', 'Desligado']], c.gamepad || 'auto')}</div>
    <div class="frow"><div class="l"><b>Zoom no sofá</b><span>Aumenta a interface enquanto o controle está no comando, para ler de longe</span></div>
      ${cfgSel('sofa_zoom', [[1, 'Igual'], [1.15, '115%'], [1.3, '130%'], [1.5, '150%']], c.sofa_zoom || 1.15)}</div>`]),
    escala: () => sec('escala', 'Escala da interface', [`
    <div class="frow"><div class="l"><b>Zoom</b><span id="uiScaleLbl">${c.ui_scale ? Math.round(c.ui_scale * 100) + '%' : 'Auto (' + Math.round(autoScale() * 100) + '%)'}</span></div>
      ${cfgSel('ui_scale', [[0, 'Automático'], ...[0.8, 0.9, 1, 1.1, 1.25, 1.5].map(v => [v, Math.round(v * 100) + '%'])], c.ui_scale || 0)}</div>
    <div class="frow"><div class="l"><b>Tamanho do texto</b><span>Só as letras, sem mexer no resto. Bom para ler de longe sem aumentar tudo</span></div>${cfgSel('text_size', [[-2, 'Bem menor'], [-1, 'Menor'], [0, 'Normal'], [1, 'Maior'], [2, 'Bem maior']], c.text_size || 0)}</div>
    <div class="frow"><div class="l"><b>Tamanho das capas</b><span>O mesmo controle disponível ao lado das listas</span></div><label class="zoom"><input type="range" min="100" max="300" step="10" value="${c.card_size || 136}" oninput="setCardSize(this.value,false)" onchange="setCardSize(this.value,true)"></label></div>
    <div class="frow"><div class="l"><b>Densidade</b><span>Compacto aproxima os cartões e reduz espaçamentos; útil em telas pequenas</span></div>${cfgSel('density', [['normal', 'Normal'], ['compact', 'Compacto']], c.density || 'normal')}</div>`], { p: 'Ajusta o tamanho de textos, botões e capas para qualquer tela, de um notebook 1366×768 a uma TV 4K. <b>Auto</b> acompanha o tamanho da janela.' }),
    efeitos: () => sec('efeitos', 'Efeitos', [`
    ${c.os === 'windows' ? `<div class="frow"><div class="l"><b>Vidro fosco${restartTag('acrylic')}</b><span>Janela translúcida com desfoque do Windows 11 (acrílico), por trás de toda a interface. Em Windows 10 ou com alto contraste fica opaco</span></div><button class="sw ${c.acrylic !== false ? 'on' : ''}" onclick="setCfg({acrylic:!(S.config.acrylic!==false)})"></button></div>` : ''}
    <div class="frow"><div class="l"><b>Cor de destaque</b><span>Botões, seleção e realces. "Do tema" usa a cor que o tema define${c.os === 'windows' ? '; "Do Windows" acompanha a cor de destaque em Configurações › Personalização' : ''}</span></div>
      <div style="display:flex;gap:6px;align-items:center"><div class="seg">${[['theme', 'Do tema'], c.os === 'windows' ? ['system', 'Do Windows'] : null, ['custom', 'Escolher']].filter(Boolean).map(([v, l]) => `<button class="${(c.accent_mode || 'theme') === v ? 'on' : ''}" onclick="setAccentMode('${v}')">${l}</button>`).join('')}</div>
      ${(c.accent_mode || 'theme') === 'custom' ? `<label class="lsw" title="Escolher cor"><input type="color" value="${esc(c.accent || cssVar('--accent') || '#4f8df7')}" oninput="S.config.accent=this.value;applyAccent()" onchange="setCfg({accent:this.value})"><span style="background:${esc(c.accent || cssVar('--accent'))}"></span></label>` : ''}</div></div>
    ${sw('accent_from_cover', 'Cor acompanha o jogo', 'Botões e realces tomam a cor dominante da capa do jogo selecionado ou aberto, com transição suave; volta à cor do tema ao sair')}
    ${sw('reduce_motion', 'Reduzir movimento', 'Corta transições e animações de uma vez, independente da configuração de animações do sistema')}
    <div class="frow"><div class="l"><b>Névoa de cor</b><span>Névoa na cor de destaque, deslizando devagar atrás do conteúdo. Zero desliga</span></div><label class="zoom"><input type="range" min="0" max="100" step="5" value="${c.fog ?? 30}" oninput="S.config.fog=+this.value;applyFog()" onchange="setCfg({fog:+this.value})"></label></div>
    ${sw('high_contrast', 'Alto contraste', 'Bordas e textos mais fortes, sem transparência nem desfoque, foco bem marcado. Liga sozinho quando o Windows está em modo de alto contraste')}`]),
    cartoes: () => sec('cartoes', 'Cartões e listas', [`
    <div class="frow"><div class="l"><b>Biblioteca e Store</b><span>Com painel, clicar numa capa abre o jogo ao lado; grade mostra só as capas; lista mostra uma linha por jogo com ano, gênero, tamanho e tempo jogado</span></div>${cfgSel('view_mode', [['mural', 'Capas com painel lateral'], ['grid', 'Grade de capas'], ['list', 'Lista']], c.view_mode || 'mural')}</div>
    <div class="frow"><div class="l"><b>Agrupar por</b><span>Cabeçalhos recolhíveis na Biblioteca; a ordenação vale dentro de cada grupo. A Store tem o próprio agrupamento no menu Exibição</span></div>${cfgSel('group_by', GROUPS, c.group_by ?? 'letter')}</div>
    ${sw('fav_first', 'Favoritos primeiro', 'Mantém os favoritos no topo da lista em qualquer ordenação')}
    ${sw('card_ribbons', 'Fitas "Novo" e "Hoje" nas capas', '"Novo" marca jogos instalados há menos de 7 dias que você ainda não abriu; "Hoje" marca os que você jogou hoje')}
    ${sw('card_origin', 'Origem embaixo da capa', 'Selo pequeno com de onde o jogo veio: Steam, Epic, GOG, ROM, Manual…')}
    ${sw('card_playtime', 'Tempo e status embaixo da capa', 'Duas linhas sob o título: tempo jogado (ou "Não jogado") e quando foi a última vez; sem isso aparece só o gênero ou a plataforma')}
`]),
    capas: () => sec('capas', 'Capas e informações', [`
    ${sw('auto_metadata', 'Buscar capas e metadados automaticamente', 'Procura capa, descrição, ano e gêneros na Steam, GOG e Wikipedia. Para consoles, usa as capas oficiais de cada sistema e a imagem de fundo do jogo. Roda em segundo plano e não repete buscas')}
    ${sw('web_covers', 'Capa por busca de imagens na web', 'Quando Steam, GOG, Wikipedia e as capas de console não têm o jogo, procura no Bing, DuckDuckGo e Yandex e usa a melhor imagem vertical. Útil para mods e jogos raros; pode errar, e a capa pode ser trocada na edição do jogo')}
    <div class="frow"><div class="l"><b>Fontes de metadados</b><span>De onde vêm capa, descrição, ano e gêneros — na busca automática e em "Baixar metadados…". Nenhuma precisa de chave.</span><div class="mchk">${META_SRC.map(([id, n, d]) => `<label class="${(c.meta_sources || {})[id] !== false ? 'on' : ''}" title="${d}"><input type="checkbox" ${(c.meta_sources || {})[id] !== false ? 'checked' : ''} onchange="metaSrcToggle('${id}',this.checked)">${n}</label>`).join('')}</div></div></div>
    ${sw('auto_rename', 'Corrigir nomes automaticamente', 'Ao encontrar o jogo nas fontes, substitui nomes como "Atalho para Sleeping Dogs" ou "SleepingDogs_x64" pelo nome oficial. Só renomeia quando o nome encontrado bate com segurança (mesmo título e mesma numeração); em dúvida, mantém o atual. Nomes digitados por você nunca são alterados')}`]),
    pastas: () => sec('pastas', 'Pastas', [`
    <div class="frow"><div class="l"><b>Pasta de jogos instalados</b><span>Destino definitivo dos jogos baixados e extraídos. Atual: ${esc(c.games_dir_effective)}</span></div><button class="btn s sm" onclick="openPath(${jsq(c.games_dir_effective)})">${I.folder} Abrir</button><button class="btn s sm" onclick="chooseFolder()">Alterar</button>${c.games_dir ? `<button class="btn s sm" onclick="setCfg({games_dir:''})">Padrão</button>` : ''}</div>
    <div class="frow"><div class="l"><b>Outras pastas com jogos</b><span>Pastas de outros discos ou de outros launchers. O Ludrix procura jogos novos nelas (e na pasta de instalados) ao abrir e no botão abaixo.${(c.game_dirs || []).length ? '' : ' Nenhuma adicionada.'}</span>${(c.game_dirs || []).length ? `<div class="dirlist">${c.game_dirs.map(d => `<div><code>${esc(d)}</code><button class="btn s xs" onclick="openPath(${jsq(d)})">${I.folder}</button><button class="btn s xs" onclick="gameDirRemove(${jsq(d)})">${I.x}</button></div>`).join('')}</div>` : ''}</div><button class="btn s sm" onclick="gameDirAdd()">${I.plus} Adicionar pasta</button><button class="btn s sm" onclick="scanRun('windows','*')">${I.search} Procurar jogos novos</button></div>
    ${sw('watch_dirs', 'Avisar quando aparecer pasta nova', 'Fica de olho na pasta de instalados e nas pastas acima enquanto o Ludrix está aberto. Caiu uma pasta nova com um jogo dentro, chega um aviso em Notificações para adicionar com um clique. Quase nenhum custo: o sistema avisa, o Ludrix não varre nada')}
    ${sw('auto_scan_dirs', 'Procurar jogos novos ao abrir', 'Alguns segundos depois de abrir, o Ludrix olha as pastas acima e avisa se achou jogo que ainda não está na biblioteca. Nada é adicionado sem revisão')}
    <div class="frow"><div class="l"><b>Pasta de downloads (temporária)</b><span>Os arquivos chegam em <code>downloads${SEP()}</code>, são extraídos ou instalados e essa pasta é limpa sozinha. O que sobrar de downloads cancelados é apagado quando o Ludrix abre.</span></div><button class="btn s sm" onclick="openPath(${jsq(c.downloads_dir || 'downloads')})">${I.folder} Abrir</button><button class="btn s sm" onclick="api.post('/api/downloads/clean',{}).then(r=>toast('ok','Pasta limpa',(r.freed_h||'')+(r.skipped?' · '+r.skipped+' em uso':'')))">Limpar agora</button></div>`]),
    ao_abrir: () => sec('ao_abrir', 'Ao abrir um jogo', [`
    <div class="frow"><div class="l"><b>Ao abrir um jogo</b><span>${{ ask: 'Pergunta antes de abrir (com opção de lembrar).', none: 'Continua visível normalmente.', minimize: 'Sai da barra de tarefas e volta quando o jogo fechar.', close: 'Fecha por completo; o tempo de jogo desta sessão não é contado.' }[c.after_launch || 'ask']} O tempo de jogo é contado enquanto o processo do jogo estiver em execução.</span></div>${cfgSel('after_launch', [['ask', 'Perguntar'], ['none', 'Manter'], ['minimize', 'Bandeja'], ['close', 'Fechar']], c.after_launch || 'ask')}</div>
    <div class="frow"><div class="l"><b>Apresentação ao abrir um jogo</b><span>Uma tela rápida com a capa e o nome enquanto o jogo carrega. Clique ou Esc fecham antes</span></div>${cfgSel('launch_splash', [['off', 'Desligada'], ['short', 'Curta'], ['long', 'Longa']], c.launch_splash || 'short')}</div>
    ${sw('track_external', 'Contar tempo de jogos abertos fora do Ludrix', 'Quando um jogo da biblioteca é aberto pela Steam, por um atalho ou direto pelo .exe, o Ludrix percebe e conta o tempo do mesmo jeito. Checa os processos a cada 15 s; não interfere no jogo')}
    ${sw('pause_downloads_playing', 'Pausar downloads enquanto um jogo está aberto', 'Downloads em andamento param quando o jogo abre e voltam sozinhos quando ele fecha; o que já estava extraindo termina')}
    ${sw('nav_hide_playing', 'Esconder a barra de navegação enquanto um jogo está aberto', 'A barra se recolhe quando você abre um jogo e volta quando ele fecha. Para vê-la no meio do jogo, encoste o mouse na borda onde ela fica')}`]),
    linux: () => c.os !== 'linux' ? '' : sec('linux', 'Jogos de Windows no Linux', [`
    <div class="frow"><div class="l"><b>Como abrir .exe</b><span>Proton via umu baixa o GE-Proton e o runtime da Steam sozinho na primeira vez que um jogo de Windows for aberto (~1 GB, uma vez só). Wine usa o que já estiver instalado na distro.</span></div>${cfgSel('linux_runner', [['auto', 'Proton (umu)'], ['wine', 'Wine do sistema']], c.linux_runner || 'auto')}</div>
    <div class="frow"><div class="l"><b>Versão do Proton</b><span>Vazio = GE-Proton mais recente. Aceita o nome de uma pasta em ~/.local/share/Steam/compatibilitytools.d ou um caminho completo.</span></div><input class="mi" style="width:240px" value="${esc(c.linux_proton || '')}" placeholder="GE-Proton" onchange="setCfg({linux_proton:this.value.trim()})"></div>
    <div class="frow"><div class="l"><b>Variáveis extras</b><span>Separadas por espaço, ex.: <span class="code">DXVK_HUD=fps MANGOHUD=1</span>. Valem para todos os jogos.</span></div><input class="mi" style="width:240px" value="${esc(c.linux_env || '')}" onchange="setCfg({linux_env:this.value.trim()})"></div>
    ${sw('linux_runtime_updates', 'Manter o runtime do Proton atualizado', 'O umu confere e baixa atualizações do runtime da Steam ao abrir um jogo. Desligue se a conexão for lenta')}
    <div class="frow"><div class="l"><b>Proton e prefixo</b><span id="lxst">Verificando…</span></div><div style="display:flex;gap:6px"><button class="btn s sm" onclick="linuxPrepare()">${I.dl} Baixar/atualizar agora</button><button class="btn s sm" onclick="openPath(S.config.root+'/data/pfx')">${I.folder} Prefixos</button></div></div>`]),
    saves: () => sec('saves', 'Saves', [`
    ${sw('crash_watch', 'Avisar quando um jogo fechar sozinho', `Se o jogo morrer nos primeiros segundos, mostra o motivo provável e oferece instalar o que falta (Visual C++, DirectX, .NET).`)}
    ${(c.crash_mute || []).length ? `<div class="frow"><div class="l"><b>Jogos sem esse aviso</b><span>${esc((c.crash_mute || []).map(k => (S.byKey[k] || {}).title || k).join(', '))}</span></div><button class="btn s sm" onclick="setCfg({crash_mute:[]}).then(()=>settingsTab('play'))">Voltar a avisar</button></div>` : ''}
    ${sw('save_auto_backup', 'Guardar cópia dos saves ao fechar o jogo', `Depois de cada sessão, copia a pasta de saves do jogo para data${SEP()}save_backups (até 5 cópias por jogo, só quando algo mudou; pastas acima de 512 MB são puladas). Restaure em Saves, no menu do jogo`)}`]),
    emuladores: () => sec('emuladores', 'Emuladores', [`
    ${sw('emu_no_ask', 'Não perguntar qual emulador', 'Em consoles com mais de um emulador instalado, usa sempre o padrão em vez de perguntar ao jogar')}`]),
    discord: () => sec('discord', 'Discord', [`
    ${sw('discord_enabled', 'Mostrar o jogo no Discord', 'Enquanto um jogo estiver aberto, seu perfil do Discord mostra o nome do jogo, a plataforma, a capa e há quanto tempo você está jogando. Usa o Discord aberto no computador; nada é enviado para fora')}
    ${c.discord_enabled ? `<div class="frow"><div class="l"><b>ID do aplicativo</b><span>${help('O Discord exige um "aplicativo" para mostrar a atividade. É grátis e leva um minuto: entre em discord.com/developers/applications, clique em New Application, dê o nome LudrixHub e copie o Application ID. O nome do aplicativo é o que aparece em "Jogando".')} ${c.discord_status && c.discord_status.connected ? '<span style="color:var(--green2)">conectado ao Discord</span>' : c.discord_status && c.discord_status.error ? `<span style="color:var(--amber)">${esc(c.discord_status.error)}</span>` : 'Cole o Application ID (só números).'}</span></div><input class="mi" value="${esc(c.discord_app_id || '')}" placeholder="ex.: 1234567890123456789" inputmode="numeric" style="width:220px" onchange="setCfg({discord_app_id:this.value.replace(/\\D/g,'')}).then(()=>discordTest())"><button class="btn s sm" onclick="discordTest()">Testar</button><button class="btn s sm" onclick="api.post('/api/open_url',{url:'https://discord.com/developers/applications'})">${I.ext} Criar aplicativo</button></div>` : ''}`]),
    controle: () => sec('controle', 'Controle', [`
    ${sw('gamepad_enabled', 'Navegar com controle', 'Direcional ou analógico move, A abre, B volta, X abre o menu de opções, Y busca, LB/RB trocam de aba, LT/RT ou analógico direito rolam a página, Start joga o jogo em foco, Back volta à Biblioteca. Em listas e controles deslizantes, A entra no ajuste e o direcional muda o valor')}
    ${sw('gamepad_wake', 'Controle chama o launcher', 'Ao conectar um controle, ou segurar o botão Guide/Xbox por 1 s, o launcher sai da bandeja e vem para a frente. Mantém um monitor leve do controle enquanto o Ludrix estiver aberto')}
    <div class="frow"><div class="l"><b>Testar controle</b><span>Mostra na hora cada botão e analógico que você mexer; serve para conferir se o controle está sendo lido</span></div><button class="btn s sm" onclick="gpTester()">${I.gamepad} Testar</button></div>`], { adv: [`
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
    ${sw('dim_not_installed', 'Escurecer jogos não baixados', 'Na Store, os jogos dos repositórios que você ainda não instalou aparecem apagados')}
    <div class="frow"><div class="l"><b>Reler as fontes sozinho</b><span>Em segundo plano, sem jogo aberto e sem download em andamento. O botão Atualizar da Store continua funcionando</span></div>${cfgSel('store_auto_refresh', [[0, 'Nunca'], [6, 'A cada 6 horas'], [12, 'A cada 12 horas'], [24, 'Uma vez por dia']], Number(c.store_auto_refresh ?? 12))}</div>
    ${sw('store_notify_new', 'Avisar quando uma fonte ganhar jogos', 'Aviso no sino com o nome da fonte e os primeiros títulos; os jogos ficam marcados como NOVO na Store')}`], {}),
    instalacao: () => sec('instalacao', 'Instalação', [`
    ${sw('taskbar_progress', 'Progresso na barra de tarefas', 'O ícone do Ludrix na barra do Windows mostra o andamento dos downloads')}
    ${sw('keep_archive', 'Manter arquivo compactado', 'Guarda o arquivo baixado (.zip/.7z) na pasta downloads depois de instalar. Ocupa espaço, mas evita um novo download')}
    <div class="frow"><div class="l"><b>Downloads simultâneos</b></div>${cfgSel('concurrent_downloads', [1, 2, 3, 4].map(v => [v, String(v)]), c.concurrent_downloads || 2)}</div>
    <div class="frow"><div class="l"><b>Velocidade máxima</b><span>Limite somado de todos os downloads diretos, para sobrar banda para o resto da casa. Torrent tem o limite próprio abaixo</span></div>${cfgSel('dl_max_down', [[0, 'Sem limite'], [512, '512 KB/s'], [1024, '1 MB/s'], [2048, '2 MB/s'], [5120, '5 MB/s'], [10240, '10 MB/s'], [25600, '25 MB/s']], Number(c.dl_max_down || 0))}</div>
    <div class="frow"><div class="l"><b>Horário para baixar</b><span>Fora da janela os downloads ficam esperando na Fila e continuam sozinhos quando ela abre${c.dl_schedule ? '' : '. Útil para baixar de madrugada'}</span></div><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
      ${cfgSel('dl_schedule', [[false, 'Sempre'], [true, 'Só entre']], !!c.dl_schedule)}${c.dl_schedule ? `<input class="mi" style="width:70px" value="${esc(c.dl_from || '23:00')}" onchange="setCfg({dl_from:this.value})"><span class="mut">e</span><input class="mi" style="width:70px" value="${esc(c.dl_to || '07:00')}" onchange="setCfg({dl_to:this.value})">` : ''}</div></div>
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
    ${sw('auto_backup', 'Backup automático semanal', `Uma vez por semana, ao abrir, gera o Ludrix-dados-&lt;data&gt;.zip sozinho (biblioteca, ajustes, fontes, capas, temas). Guarda os 4 últimos.${c.auto_backup_at ? ' Último: ' + ago(c.auto_backup_at) : ''}`)}
    ${c.auto_backup !== false ? `<div class="frow"><div class="l"><b>Pasta dos backups automáticos</b><span><code>${esc(c.auto_backup_dir || 'data\\backups\\auto')}</code>${c.auto_backup_dir ? '' : ' — o padrão fica dentro do Ludrix; para sobreviver a um disco morto, aponte outro disco ou uma pasta sincronizada'}</span></div><div class="ta"><button class="btn s sm" onclick="autoBackupDir('pick')">${I.folder} Escolher…</button>${c.auto_backup_dir ? `<button class="btn s sm" onclick="autoBackupDir('reset')">Padrão</button>` : ''}<button class="btn s sm" onclick="autoBackupNow(this)">Fazer agora</button></div></div>` : ''}
    <div class="frow"><div class="l"><b>Importar um backup</b><span>Escolha um Ludrix-dados-*.zip. O conteúdo é listado antes de aplicar</span></div><button class="btn s sm" onclick="dataImport()">${I.folder} Importar…</button></div>`], { help: 'O backup é um zip com configurações, biblioteca (com tempo jogado e favoritos), capas personalizadas, fontes, temas importados, cópias de saves e jogos rápidos adicionados por você. Não inclui os jogos em si nem caches. Importar substitui o que existe hoje pelo que está no zip e reabre o Ludrix — antes disso, o estado atual é guardado em data/updates.' }),
    diagnostico: () => sec('diagnostico', 'Diagnóstico', [`
    <div class="frow"><div class="l"><b>Diagnóstico</b><span>Confere pasta, espaço em disco, ferramentas e mostra o fim do log — copie e cole quando algo der errado</span></div><button class="btn s sm" onclick="showDiag()">Ver diagnóstico</button></div>`]),
    limpeza: () => sec('limpeza', 'Limpeza', [`
    <div class="cache" id="cacheBox">${[['web', 'Listas das fontes'], ['thumbs', 'Miniaturas'], ['covers', 'Capas grandes'], ['meta', 'Informações dos jogos'], ['downloads', 'Downloads incompletos'], ['log', 'Registro de erros']].map(([k, n]) => `<label><input type="checkbox" value="${k}"><div><b>${n}</b><span>${cache ? (fmt(cache[k]) || '0 B') : '…'}</span></div></label>`).join('')}</div>
    <div class="frow" style="margin-top:10px"><div class="l"><b>Imagens órfãs</b><span>Capas e miniaturas de jogos que não estão mais em nenhuma fonte nem na biblioteca (com mais de 30 dias). O Ludrix faz essa limpeza sozinho uma vez por semana</span></div><button class="btn s sm" onclick="imgGc(this)">${I.trash} Conferir</button></div>
    <div style="margin-top:12px;display:flex;gap:8px"><button class="btn d sm" onclick="clearCache()">${I.trash} Limpar selecionados</button><button class="btn s sm" onclick="openPath(${jsq(c.root)})">${I.folder} Abrir pasta do app</button></div>`], { cls: 'wide', help: 'Tudo o que o launcher guarda aqui (capas, listas, informações) serve apenas para abrir mais rápido. Pode apagar sem receio: é baixado de novo quando necessário. Seus jogos e configurações não são afetados.', p: 'Tudo o que o launcher cria fica dentro da própria pasta. Selecione o que apagar:' }),
    pc: () => hwHtml(hw),
    segundo_plano: () => sec('segundo_plano', 'Em segundo plano', [`
    ${sw('bg_warmup', 'Completar capas e informações ao abrir', 'Ao abrir, busca em lote as capas e descrições que faltam na biblioteca e no início da Store. Desligado, cada jogo é buscado apenas quando aparece na tela')}
    ${sw('bg_sites', 'Continuar varrendo fontes do tipo site', 'Fontes com muitas páginas continuam carregando as próximas em segundo plano. Desligado, entram apenas as primeiras páginas, e mais quando você atualiza a fonte')}
    ${sw('update_auto_check', 'Procurar atualização ao abrir', 'Consulta o canal de atualizações uma vez ao abrir, se houver internet. Desligado, use Ajustes › Sistema › Atualizações › Verificar')}`], { help: 'Tudo aqui vem desligado. Sem nada ligado, o Ludrix parado não faz nada: nenhuma busca, nenhum acesso à internet, nenhuma tarefa em execução. Ele só responde ao que você pede.', p: 'O que o Ludrix pode fazer sozinho enquanto está aberto. Desligado, ele só trabalha quando você solicita.' }),
    atualizacoes: () => updatesHtml(),
    perigo: () => sec('perigo', 'Zona de perigo', [`
    <p>Resetar o launcher apaga <b>tudo</b> que ele criou — jogos baixados, ROMs, emuladores, fontes, temas, configurações — e reabre como se fosse a primeira vez. Não tem volta.</p>
    <button class="btn d sm" onclick="factoryReset()">${I.trash} Resetar o Ludrix de fábrica…</button>`], { cls: 'danger', help: 'Volta o Ludrix ao estado de primeira execução. Apaga permanentemente: configurações, biblioteca, fontes, caches, metadados, temas importados, downloads e as pastas games/ e emulation/ (jogos baixados e ROMs). O que estiver fora da pasta do Ludrix não é tocado.' }),
    sobre: () => `
  <div class="sec about" id="s-sobre" data-sec="Sobre"><div class="abt"><div class="abtlogo">${logoSvg()}</div><div><h3>LudrixHub</h3><p>Criado e idealizado por <b>WOLFFZ</b></p></div></div>
    <p>Um lugar só para os seus jogos: os de PC, os emulados, os atalhos e os Flash, com capa, tempo jogado e favoritos. Portátil — a pasta inteira vai com você.</p>
    <p>O launcher não hospeda nem distribui jogos. Ele organiza o que você tem e lê as fontes que você adiciona.</p>
    <div class="kv" style="margin-top:14px"><b>Versão</b><span>${esc(c.version || '')}${c.version_date ? ` <small style="color:var(--muted)">(${esc(c.version_date)})</small>` : ''} ${c.version_changelog ? `<a href="#" onclick="whatsNew();return false" style="color:var(--accent2);margin-left:8px">novidades</a>` : ''}</span><b>Pasta</b><span>${esc(c.root)}</span><b>Motor da janela</b><span>${esc(c.engine || '')}</span></div>
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
      ${(TAB_KEYS[tab] || []).length ? `<button class="lnk" onclick="settingsReset('${tab}')">Redefinir esta aba</button>` : ''}<button class="lnk" onclick="openPath('data')" title="Pasta data (config, biblioteca, log)">Abrir pasta data</button></div></aside>
    <div class="settings" id="setBody" data-tab="${tab}">${body}</div></div>`;
  settingsToc();
  if (S._settingsJump) { const j = S._settingsJump; S._settingsJump = ''; requestAnimationFrame(() => settingsGo(j, false)); } else $('#view').scrollTop = keepScroll;
  viewFilter();
  if (tab === 'system' && !S.upd) loadUpdates();
  if (tab === 'play' && c.os === 'linux') linuxStatus();
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
  general: ['start_menu', 'file_assoc', 'win_notify', 'tray_enabled', 'tray_sleep', 'close_action', 'hotkey_enabled', 'popups', 'notify_sound', 'ui_sounds', 'ui_sounds_level', 'keymap'],
  appearance: ['accent_from_cover', 'gamepad', 'sofa_zoom', 'theme', 'theme_mode', 'face', 'accent', 'theme_schedule', 'theme_light_from', 'theme_light_to', 'frameless', 'frame_mode', 'frame_corners', 'status_position', 'nav_layout', 'clock', 'ctx_menu', 'layout', 'nav', 'nav_hidden', 'nav_order', 'rail_icons', 'ui_scale', 'text_size', 'card_size', 'density', 'acrylic', 'animations', 'fog', 'fx_type', 'fx_intensity', 'glass', 'card_hover', 'reduce_motion', 'parallax', 'high_contrast'],
  library: ['home_spot', 'fav_first', 'game_backdrop', 'backdrop_blur', 'backdrop_dim', 'cover_slideshow', 'cover_slideshow_secs', 'view_mode', 'group_by', 'card_ribbons', 'card_origin', 'card_playtime', 'detail_art', 'auto_metadata', 'web_covers', 'auto_rename'],
  play: ['discord_enabled', 'after_launch', 'launch_splash', 'pause_downloads_playing', 'nav_hide_playing', 'crash_watch', 'crash_mute', 'save_auto_backup', 'emu_no_ask', 'gamepad_enabled', 'gamepad_speed', 'gamepad_wake'],
  store: ['hero_enabled', 'store_hide_installed', 'dim_not_installed', 'store_auto_refresh', 'store_notify_new', 'taskbar_progress', 'keep_archive', 'concurrent_downloads', 'dl_max_down', 'dl_schedule', 'dl_from', 'dl_to', 'shortcut_ask', 'repack_auto_open', 'torrent_max_down', 'torrent_max_up', 'torrent_seed_after'],
  system: ['bg_warmup', 'bg_sites', 'update_auto_check', 'auto_backup', 'auto_backup_dir'],
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
  if (S.config.appimage) return `<div class="sec"><h3>Atualizações</h3><p>Esta é a versão <b>${esc(S.config.version || '')}</b> em AppImage. Para atualizar, baixe o AppImage novo e substitua o arquivo — jogos, ajustes e temas ficam em <span class="code">${esc(S.config.root || '')}</span> e não são tocados.</p><div class="row" style="margin-top:8px"><button class="btn s sm" onclick="api.post('/api/open_url',{url:'https://github.com/wolffZ-prog/Ludrix/releases/latest'})">${I.dl} Baixar a versão mais recente</button></div></div>`;
  const u = S.upd, cur = (u && u.current) || {}; const av = u && u.available, rem = u && u.remote, st = (u && u.state) || {};
  const job = S.jobs.update;
  const ready = !!av, remote = !ready && !!rem;
  const kind = k => k === 'full' ? 'Nova versão do launcher' : 'Atualização';
  const when = st.checked_at ? new Date(st.checked_at * 1000).toLocaleTimeString(S.config.language === 'en' ? 'en-US' : 'pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  let card = '';
  if (!u) card = `<p class="mut">Consultando…</p>`;
  else if (ready) card = `<div class="updcard on"><div class="l"><b>v${esc(av.version)}${av.rev ? ' · correção ' + av.rev : ''}${av.title && !/^(patch|ludrix) /i.test(av.title) ? ' · ' + esc(av.title) : ''}</b><span>${kind(av.kind)}${av.date ? ' · ' + esc(av.date) : ''}${av.size ? ' · ' + fmt(av.size) : ''} · verificada, pronta para instalar</span></div>${chlogHtml(notesBetween(av, cur.version))}</div>`;
  else if (remote) card = `<div class="updcard on"><div class="l"><b>v${esc(rem.version)}${rem.rev ? ' · correção ' + rem.rev : ''}</b><span>${kind(rem.kind)}${rem.date ? ' · ' + esc(rem.date) : ''}${rem.size ? ' · ' + fmt(rem.size) : ''} · ${job ? 'baixando… ' + Math.round((job.fraction || 0) * 100) + '%' : 'disponível para download'}</span></div>${rem.changelog ? chlogHtml(notesBetween(rem, cur.version)) : ''}${job ? progHtml(job, 'update') : ''}</div>`;
  else card = `<div class="updcard"><div class="l"><b>Você está na versão mais recente</b><span>${st.error ? esc(st.error) : 'Nenhuma novidade por enquanto'}${when ? ' · checado às ' + when : ''}</span></div></div>`;
  const applyLabel = remote ? 'Baixar' : 'Instalar';
  const canApply = ready || (remote && !job);
  return `<div id="updBox">
  <div class="sec"><h3>Atualizações <span class="ver">v${esc(cur.version || '?')}${cur.rev ? ' · correção ' + cur.rev : ''}</span> ${help('O Ludrix confere o endereço de atualizações (https) ao abrir e ao clicar em Checar. Um arquivo .lxup recebido por fora entra por "Instalar de arquivo". Só pacotes assinados pelo projeto são instalados. Jogos, configurações, temas e emuladores nunca são tocados numa atualização.')}</h3>
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
function pickFace(id) { const prev = faceInfo(S.config.face || DEFAULT_FACE), patch = { face: id }; if ((S.config.theme || '').startsWith('file:')) patch.theme = 'system'; if (S.config.accent && S.config.accent === prev.accent) patch.accent = ''; setCfg(patch); }
async function pickTheme(id) { if (!(S.themes || []).length) S.themes = await api.get('/api/themes/full'); const t = (S.themes || []).find(x => x.id === id), prev = (S.themes || []).find(x => x.id === (S.config.theme || 'system')); const patch = { theme: id }; if (prev && prev.accent && S.config.accent === prev.accent) patch.accent = ''; setCfg(patch); }
const toHex = v => { v = (v || '').trim(); if (/^#([0-9a-f]{6})$/i.test(v)) return v; const m = v.match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i); if (m) return '#' + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join(''); return ''; };
function reloadTheme() { currentTheme = null; applyTheme(); }
async function themeExport(id, fmt) { const r = await api.post('/api/theme/export', { id, format: fmt || 'lxtheme' }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); toast('ok', 'Tema exportado', r.path, [{ label: 'Abrir pasta', fn: () => openPath(r.path.replace(/[\\/][^\\/]*$/, '')) }]); }
function themeMenu(id, x, y) {
  const t = (S.themes || []).find(t => t.id === id) || {}; const items = [{ label: 'Aplicar', icon: 'check', fn: () => pickTheme(id) }];
  if (id.startsWith('file:')) items.push({ sep: true },
    { label: 'Exportar', icon: 'ext', sub: [{ label: '.lxtheme', hint: 'oficial', fn: () => themeExport(id, 'lxtheme') }, { label: '.zip', hint: 'mesmo esqueleto', fn: () => themeExport(id, 'zip') }] },
    { sep: true }, { label: 'Apagar', icon: 'trash', danger: true, fn: () => themeDelete(id, t.name || id) });
  showCtx(items, x, y);
}
async function themeImport() {
  if (S.config.native) { const r = await api.post('/api/theme/import', {}); if (r.error) return toast('err', 'Não foi possível concluir', r.error); if (r.ok) { toast('ok', r.count > 1 ? 'Temas importados' : 'Tema importado', r.name || ''); renderSettings(true); } return; }
  modal({ title: 'Importar temas', text: 'Caminho do .lxtheme, .zip (um ou vários estilos) ou theme.json. Para vários arquivos, um por linha.', textarea: '', ok: 'Importar', onOk: async v => { const r = await api.post('/api/theme/import', { path: v }); if (r.error) return toast('err', 'Não foi possível concluir', r.error); if (r.ok) toast('ok', r.count > 1 ? 'Temas importados' : 'Tema importado', r.name || ''); renderSettings(true); } });
}
function themeDeleteAll() {
  const ids = (S.themes || []).filter(t => t.id && t.id.startsWith('file:')).map(t => t.id); if (!ids.length) return;
  modal({ title: `Apagar os ${ids.length} temas importados?`, text: 'As pastas deles em themes serão removidas. Os temas Escuro e Claro continuam. É possível importar de novo depois.', ok: 'Apagar todos', danger: true, onOk: async () => {
    for (const id of ids) await api.post('/api/theme/delete', { id });
    if (ids.includes(S.config.theme)) { S.config.theme = 'dark'; await setCfg({ theme: 'dark' }); }
    S.themes = await api.get('/api/themes/full'); reloadTheme(true); renderSettings(true); toast('ok', 'Temas apagados', pl(ids.length, 'tema', 'temas'));
  } });
}
function themeDelete(id, name) { modal({ title: `Apagar o estilo "${name}"?`, text: 'A pasta dele em themes será removida. É possível importar de novo depois.', ok: 'Apagar', danger: true, onOk: async () => { await api.post('/api/theme/delete', { id }); if (S.config.theme === id) S.config.theme = 'system'; reloadTheme(true); renderSettings(true); } }); }
