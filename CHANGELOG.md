# Changelog

## 4.0.17-hf1 — 2026-10-28
- Abrir detalhes: a página chega pronta numa transição só (capa desliza do card para o lugar final); antes a capa subia sozinha e o resto aparecia depois.
- Névoa de cor: manchas suaves na cor de destaque se movendo devagar atrás do conteúdo. Intensidade em Ajustes › Aparência (zero desliga); segue "Reduzir movimento" e some em alto contraste.

## 4.0.17 — 2026-10-28
- Abertura mais rápida, principalmente em HDD: a biblioteca aparece a partir de um cache único (um arquivo, em vez de centenas de leituras espalhadas pelo disco) e a conferência de cada jogo roda em segundo plano logo depois; a verificação de integridade dos arquivos do launcher saiu do caminho de abertura (só tamanho na hora, hash depois, sem bloquear); a interface, capas e fontes passam a ser reaproveitadas do cache do navegador entre uma abertura e outra.
- Glass: só o fundo da janela e os painéis ficam translúcidos. Cards, menus, janelas, avisos e o cartão de sessão (jogo fechado) agora têm fundo sólido e legível.
- Animações: o Ludrix não desliga mais as transições quando as animações do Windows estão desativadas; "Reduzir movimento" em Ajustes › Aparência continua desligando tudo. Curva de movimento mais suave em telas, painéis, menus, janelas e avisos; troca de aba em Ajustes com transição.
- Botões da janela (minimizar, maximizar, fechar) no padrão do Windows: 46 px de largura, encostados no canto, sem folga à direita.
- Ludrix-HDD.ps1 (fora do app): analisa o disco dos jogos (modelo, SMR, saúde, temperatura, fragmentação, indexação, suspensão do HDD, cache NTFS, Defender) e aplica cada ajuste só com a sua confirmação, com medição antes e depois.

## 4.0.16-hf5 — 2026-10-28
- A janela volta com o mesmo tamanho, posição e estado (maximizada ou não) da última vez. Se o monitor mudou e a posição guardada ficou fora da tela, abre no tamanho padrão.

## 4.0.16-hf4 — 2026-10-27
- Submenus do menu de contexto (Editar, Copiar, Status, Coleções) com fundo sólido: com o Glass ligado ficavam transparentes e ilegíveis.

## 4.0.16-hf3 — 2026-10-27
- Ajustes › Sistema mostrava "WebView2" no motor da janela: nome herdado, sem relação com o que roda. Agora mostra Electron e a versão do Chromium.
- Botão "Exibição" ativo com texto e ícone apagados: corrigido.
- Menu de contexto: o submenu "Editar" (e os demais) abre ao passar o mouse também em janelas baixas, com o item visível; submenus com o mesmo fundo do menu.
- Metadados: o nome do jogo não é mais trocado por páginas de outro assunto ("Bayonetta (character)", "(film)"); o sufixo "(video game)" não entra no nome.
- Remoção de recursos antigos sem uso: fita de luz, fileiras da tela inicial, itens da barra de tarefas, exportar todos os temas e código morto correspondente (limpeza nos dois idiomas).
- Inglês: textos restantes em "Emuladores", "Mods", "Ao abrir um jogo" e "Atualizações" traduzidos.

## 4.0.16-hf2 — 2026-10-27
- Menu de contexto refeito: a janela flutuante usada para o menu foi removida. O menu do Ludrix (dentro da própria janela, com cabeçalho, ícones e submenus) passa a ser o padrão; a opção "Menu nativo do Windows" usa o menu do próprio sistema. Vale para jogos, listas e demais menus.
- Menu da bandeja passa a ser o menu nativo do sistema.
- Menu do Ludrix em janelas baixas: rola e abre submenus em linha, sem cortar itens.
- Interface em inglês completa: textos que ainda apareciam em português (ajustes, Store, emuladores, mods, console, avisos) foram traduzidos. Busca aceita os prefixos year:, sys:, origin: e tag:.
- Limpeza do código-fonte: comentários e anotações removidos de todos os arquivos.

## 4.0.16-hf1 — 2026-10-27
- Menu de contexto (Windows): voltou a abrir em todo lugar — jogos, barra lateral, bandeja. A janela do menu era redimensionável, o que faz janelas transparentes pararem de funcionar no Windows; agora tem tamanho fixo por abertura. Se o menu não aparecer em 1,2 s, o menu interno entra no lugar.
- Ordenar, agrupar, modo (mural/grade/lista), tamanho das capas e filtros ficaram num botão só: "Exibição", no topo da Biblioteca e da Store. O menu "Recentes ▾" e o botão separado de exibição saíram.

## 4.0.16 — 2026-10-27
- Coleções: crie as suas ("Terminar", "Com amigos"…) pelo menu do jogo › Coleções; aparecem na barra lateral, nos filtros e no modo console (menu X › Coleções). Gerenciar: renomear e apagar na própria barra.
- Central › Espaço em disco: quanto cada jogo ocupa, agrupado por disco (barra de uso com a parte dos jogos destacada), ordenado do maior para o menor; "Mover" leva a pasta para outro disco ali mesmo, com sugestão de destino e aviso quando não cabe. Tamanhos ficam em cache e são refeitos a cada 7 dias ou com "Recalcular".
- Notificações do sistema (Windows): quando um download termina, um jogo é atualizado ou fecha sozinho, aparece o aviso do Windows com a capa e o botão "Jogar" — mesmo com o Ludrix recolhido na bandeja. Clicar no aviso abre os detalhes. Nada aparece enquanto a janela está em uso. Liga/desliga em Ajustes › Geral.
- Modo console: Fila com Pausar/Continuar/Cancelar/Tirar da lista por item e "Pausar tudo / Continuar tudo / Limpar concluídos" no Menu; volume dos sons em Ajustes; busca entende plataforma e ano; screenshots nos detalhes.
- Jogo fechou sozinho: o aviso agora oferece "Instalar o que falta" (só os pacotes ausentes: Visual C++, DirectX, .NET), "Ver requisitos" e "Não avisar para este jogo"; tudo em Ajustes › Jogar.
- Busca inteligente: "rpg ps2 2004" filtra gênero, plataforma e ano; "instalados", "favoritos", "nunca", "torrent", "direto", "grandes", "antigos" também valem; abaixo da busca aparece "Entendi: RPG · PlayStation 2 · Ano 2004". Palavras que não forem reconhecidas continuam buscando no título.
- Mover pasta do jogo: cria a pasta de destino quando ela ainda não existe (desde que o disco exista).

## 4.0.15 — 2026-10-26
- Loja com a cara da biblioteca: grade de capas, busca instantânea, filtros (gênero, tamanho, torrent/direto, já instalado), ordenação e agrupamento próprios da Loja; capa do jogo da biblioteca quando a fonte não traz imagem.
- Saúde das fontes: cada JSON mostra se respondeu, quantos itens tem e quando foi atualizado; teste de links marca "Link fora do ar" no catálogo e nos detalhes.
- Downloads: limite de velocidade, "Pausar tudo"/"Continuar tudo" e "Ao terminar a fila: nada / desligar o PC".
- Emuladores: "Varrer pasta de ROMs" reconhece as subpastas por console (snes, psx, Nintendo 64…) e mapeia tudo de uma vez; aviso no cartão do sistema quando falta BIOS ou chaves.
- Biblioteca: agrupar por plataforma, gênero, letra ou recentes; grupos recolhíveis (lembrados por visão), cabeçalho com contagem e tempo jogado; "Recolher/Expandir todos" no menu de visualização; ordenação salva por visão.
- Modo console: aba Loja no controle (A baixa, Y busca, LB/RB troca de aba), detalhes de itens da loja, legenda muda conforme a aba.
- Transições entre telas (Início ↔ Loja) e mola em modais, painéis, filtros e avisos; tudo desliga com "Reduzir movimento".
- Auto-reparo dos dados: JSONs do usuário são validados ao abrir; se corrompidos, o Ludrix restaura do último backup em vez de apagar; arquivo ruim fica guardado como .bad. Ajustes › Sobre › "Diagnóstico" gera um zip com logs, configuração e memória.
- Em espera na bandeja: além de fechar a janela, o servidor solta os caches em memória (catálogo, metadados, capas) e registra no log a memória antes/depois.
- Menu de contexto (Windows): a janela do menu agora tem só o tamanho do menu, em vez de cobrir a tela inteira; vídeos em outras janelas (YouTube, players) não ficam mais brancos enquanto o menu está aberto. Menu perto da borda de baixo não passa mais do limite da tela.
- Pôster do jogo selecionado na biblioteca: na aparência Base é o banner do topo (já existente); não há pôster de página inteira para manter o visual plano.

## 4.0.14-hf2 — 2026-10-26
- Ajustes › Atualizações: espaço entre o cartão de versão, os botões e a lista (a correção 1 não pegava: regra genérica de margem vencia).

## 4.0.14-hf1 — 2026-10-26
- Ajustes › Atualizações: botões com espaço entre o cartão de versão e a lista de opções.

## 4.0.14 — 2026-10-26
- Mesmo conteúdo da 4.0.13 correção 1, com número novo: a 4.0.13 instalada ainda não sabia ler correções na mesma versão. A partir desta, correções rápidas podem repetir o número.

## 4.0.13-hf1 — 2026-10-26
- Correção rápida pode repetir o número da versão: o Ludrix e o Ludrix-Dev entendem "4.0.13 correção 1" como mais nova que a 4.0.13. Release completa continua exigindo número novo.
- Nota da release de correção rápida fala só da correção.

## 4.0.13 — 2026-10-26
- Nota da release de correção rápida fala só da correção; a linha de instalação nova fica para as releases completas.

## 4.0.12 — 2026-10-26
- Menu da bandeja: jogos recentes voltam a aparecer (inclui jogos instalados ou já jogados), título "Jogados recentemente" e sem quadrado vazio quando não há ícone.
- Detalhes: botão Voltar alinhado com a capa, abaixo da faixa de controles.
- Início: filtros rápidos não cortam mais o texto; rolam com fade quando não cabem; botões compactos em janelas estreitas.
- Mods e Store: linhas de chips quebram em várias linhas em vez de cortar.
- Ajustes: espaçamento entre os botões de atualização e a lista de opções; primeira opção da lista com borda e cantos corretos.
- Central: abre na hora. Detecção de dependências e launchers de Minecraft passa a ser assíncrona, em paralelo e com cache (a lista de desinstalação do Windows é lida uma vez, não centenas); "Re-checar" força nova leitura. Textos explicativos removidos; ficam só pacotes, dependências e Minecraft.
- Início: estado vazio da busca redesenhado; aba Favoritos sem favoritos mostra mensagem própria.
- Janela sem moldura: clique direito nas áreas de arrastar não abre mais o menu de sistema do Windows (via evento da janela, sem mexer no estado dela).
- Fila sai da barra lateral: vira um botão redondo flutuante no canto inferior direito, com anel de progresso e contador; aparece quando há download/instalação em andamento e some quando termina. Clique abre a Fila (também pelo menu do logo e pela bandeja).

## 4.0.11 — 2026-10-26

- Destaque do jogo (cabeçalho da biblioteca) mais para baixo: ganhou respiro do topo da janela.
- Botões da janela ganharam uma faixa própria de 28 px no topo da área principal (sem título, sem marca). Com isso nada passa por baixo deles ao rolar a biblioteca, e a faixa inteira arrasta a janela. Na ficha do jogo a faixa continua visível.
- Barra de rolagem da área principal: mais curta (não encosta no topo nem no rodapé), um pouco mais larga e afastada da borda da janela.

## 4.0.10 — 2026-10-26

- Marca: o ícone ficava mais alto que o texto "LudrixHub" (herdava uma margem de baixo de uma regra antiga). Ícone e nome agora ficam centrados na mesma linha, e o nome alinha com os itens do menu.
- Botões da janela (sem moldura): ficavam grudados no canto da janela e metade caía fora do cabeçalho do jogo, por causa da margem e da barra de rolagem. Agora se posicionam pela borda direita do conteúdo — alinhados com o cabeçalho do jogo e com os botões da tela — em janela ou maximizado, em qualquer tamanho; recalculam ao redimensionar.
- Temas com menu embaixo ou só ícones: a barra de busca não perde mais largura por causa dos botões da janela.
- Desenvolvimento: `build.js hotfix <base>` gera `Ludrix-<v>-hotfix.zip` só com o que mudou desde a versão publicada; o Ludrix-Dev aplica sobre o código que já tem (opção 1), sem baixar o código inteiro.

## 4.0.9 — 2026-10-25

- Janela: a barra de título própria sumiu. Com a janela sem moldura, só os três botões (minimizar, maximizar/restaurar, fechar) ficam no canto; eles seguem o layout do tema — na barra do topo quando o menu é no alto, flutuando sobre o canto nos demais. A janela arrasta pela faixa da marca, pelo cabeçalho do jogo e pelo título da tela. O botão do meio mostra o ícone de restaurar quando a janela está maximizada (e acompanha quando se maximiza pelo Windows).
- Marca: um só "LudrixHub" com o ícone alinhado ao texto em todos os layouts e temas (antes o ícone podia ficar colado ou desalinhado, e aparecia duas vezes com a barra de título).
- Windows: atalho `LudrixHub` no Menu Iniciar com o identificador do aplicativo (Ajustes › Geral › "Atalho no Menu Iniciar", ligado por padrão). Com ele a barra de tarefas e as notificações mostram "LudrixHub" e o ícone certo em vez de "Electron". Desligar apaga o atalho.
- Compilação: no Windows, gerar o exe sem o pacote `rcedit` agora é erro (antes seguia em silêncio e o exe ficava com nome e ícone do Electron).
- Atualizações: `version.json` passa a ter `release` (`full` ou `hotfix`). Uma correção rápida publica só o patch, o código e o feed; a release completa continua com zip, full e AppImage. A nota da release de correção aponta o zip da última completa para quem instala do zero. Ludrix-Dev: mostra o tipo antes de lançar, promove para completa se o Electron mudou, e nunca poda a última release completa. A Action do AppImage não roda em correções.
- Temas XP (pacote `Ludrix-Temas-XP`): Luna Prata, Oliva, Energia, Royale Noir e Bliss refeitos em edição 2026 — superfícies planas, cantos arredondados, sombras suaves, sem relevo nem degradê; paleta e layout de cada um mantidos.
- Tema personalizado: a opção de altura da barra de título foi retirada (não há mais barra).

## 4.0.8 — 2026-10-25

- Fontes vivas: o Ludrix relê as fontes da Store sozinho, em segundo plano (Ajustes › Store › "Reler as fontes sozinho": nunca, 6 h, 12 h ou uma vez por dia; padrão 12 h). Só roda sem jogo aberto, sem download em andamento e com internet; o primeiro ciclo espera 2 minutos e meio depois de abrir. O botão Atualizar da Store zera a contagem.
- Jogos novos numa fonte: ao reler, o Ludrix compara com a leitura anterior e avisa no sino ("Fonte X: N jogos novos", com os primeiros títulos); o aviso abre a Store já filtrada. Os jogos ganham a faixa NOVO no cartão e o filtro "Novos nas fontes" (chip "Novos" no topo da Store, também em Filtros); "Marcar como vistos" tira a marca. A marca some sozinha depois de 14 dias. O aviso pode ser desligado em Ajustes › Store; a primeira leitura de uma fonte nunca gera aviso.
- Store › Fontes: cada fonte mostra quando foi lida pela última vez ("lida há 2 h") e quantos jogos novos tem; a barra de status da Store mostra a leitura mais recente. O registro fica em `data/sources_state.json` e é apagado junto com a fonte.
- Controle (gamepad): o D-pad disparava a cada quadro quando segurado ou tocado (a leitura do analógico zerava o estado do botão). Agora botão e analógico são lidos juntos: um toque move uma vez e segurar repete no ritmo escolhido em Ajustes › Controle.

- Barra de navegação (Ajustes › Aparência › Barra de navegação): Como o tema define, Lateral com nomes, Lateral só ícones, No alto ou Embaixo. Vale por cima do tema e fica gravada.
- Ficha do jogo em abas: Sobre, Arquivos, Mods, Screenshots e Requisitos. Arquivos mostra executável (com Trocar, Mostrar e Apontar quando o arquivo sumiu), pasta (Abrir, Tamanho), argumentos, pasta de trabalho, saves e os outros executáveis encontrados na pasta ("Usar este"); para jogos da Store, os arquivos, espelhos e patches da fonte. Mods concentra o atalho para os mods do jogo, as ferramentas e os sites conhecidos.
- Telas vazias com desenho: Biblioteca, Store, Fontes, ROMs, Downloads, Ferramentas, Mods, Rápidos, busca sem resultado e avisos têm cada um um desenho de linha no estilo do tema (cor do texto, detalhe no acento). Com "Reduzir movimento" o detalhe não flutua.
- Cartão: selo de origem embaixo da capa (Steam, Epic, GOG, ROM, Manual…; Ajustes › Biblioteca › Origem embaixo da capa). Na Store, com mais de uma fonte, o cartão mostra de qual fonte veio.
- Downloads na barra de tarefas (Ajustes › Store e downloads › Progresso na barra de tarefas): o ícone do Ludrix no Windows mostra o andamento; pausado fica amarelo, erro fica vermelho.
- Cor de destaque (Ajustes › Aparência › Cor de destaque): Do tema, Do Windows (segue a cor de realce do sistema e acompanha quando ela muda) ou Escolher (seletor de cor). O texto sobre a cor de destaque passa a ser branco ou preto pelo contraste real, não por um corte fixo — faixas NOVO, botões e filtros em temas de acento claro (verde, amarelo, laranja) ficavam ilegíveis.

- Store e Emuladores: a grade carrega em rolagem contínua, como a Biblioteca; some o paginador.
- Store: ordenação "Novos primeiro" (pela data em que o jogo apareceu na fonte) e filtros "Download direto" e "Torrent".
- Store: faixa "ATUALIZAÇÃO" e filtro "Versão nova na fonte" quando a lista publica um `version` diferente do instalado; a ficha ganha "Versão X na fonte", que baixa por cima.
- Fontes .json: arquivos podem trazer `sha256`; o Ludrix confere depois de baixar e, se não bater, apaga e marca o download com erro ("não bate com o sha256 informado pela fonte").
- Store › Fontes › Criar fonte: lê uma pasta sua (cada .zip, .7z, .rar, .iso ou subpasta vira um jogo), calcula o sha256 se quiser, monta as URLs a partir de uma base e grava um `ludrix-pack/1` pronto, já ligado como fonte. Formato documentado em docs/FONTES.md.
- Downloads (Ajustes › Store e downloads): limite de velocidade (512 KB/s a 25 MB/s ou sem limite) e janela de horário ("Só entre" HH:MM e HH:MM; fora dela o download fica aguardando e a fila mostra quando continua). Vale para direto e torrent.
- Pausar downloads enquanto um jogo está aberto (Ajustes › Ao jogar, ligado por padrão): param quando o jogo abre e voltam quando fecha; o que já estava extraindo termina.
- Aviso do Windows com a janela escondida (Ajustes › Geral › Notificações): balão nativo quando um download ou emulador termina e o Ludrix está recolhido na bandeja.
- Paleta de comandos (Ctrl+K): digite para achar jogo (Enter abre, Shift+Enter joga), ação (Checar atualizações, Adicionar jogo, Fazer backup…) ou um ajuste pelo nome, que abre Ajustes já na linha certa. `>` no começo mostra só ações.
- Etiquetas: em Editar › Geral cada jogo aceita etiquetas livres; filtro "Etiqueta" na Biblioteca e busca `tag:nome`.
- Testar controle (Ajustes › Controle): mostra na hora cada botão e analógico que você mexer.
- Atalhos de teclado (Ajustes › Geral › Teclado): cada ação tem a sua tecla e pode ser trocada clicando nela (Backspace volta ao padrão, Esc cancela); conflitos são avisados; "Voltar tudo ao padrão". A lista de atalhos (?) lê o que você definiu e tem o botão Personalizar. Ctrl+1…9 e Esc continuam fixos.
- Abrir .lxtheme e .lxup com o Ludrix (Ajustes › Geral, Windows, ligado por padrão): registra a associação só no seu usuário; duplo clique num tema importa e num pacote de atualização abre a instalação. O Ludrix refaz o registro se a pasta mudar.
- Backup automático semanal (Ajustes › Sistema › Meus dados, ligado por padrão): uma vez por semana, ao abrir, gera Ludrix-dados-<data>.zip (biblioteca, ajustes, fontes, capas, temas) em data\backups\auto ou numa pasta sua; guarda os 4 últimos; botão "Fazer agora". Falha vira aviso em Notificações.
- Vigia da pasta de jogos (Ajustes › Biblioteca › Avisar quando aparecer pasta nova, ligado por padrão): com o Ludrix aberto, uma pasta nova com jogo dentro de games\ ou das pastas acompanhadas gera um aviso em Notificações que adiciona o jogo com um clique. Pastas antigas são ignoradas.
- Limpeza de imagens órfãs (Ajustes › Sistema › Limpeza › Imagens órfãs): capas, fundos e screenshots de jogos que já saíram da biblioteca e das fontes, com mais de 30 dias, são listados e removidos; o Ludrix faz isso sozinho uma vez por semana.

- Menu de contexto: "Remover da biblioteca" não removia (o id da ação não batia com o do menu). O menu foi refeito por completo e agora traz Jogar, Jogar e…, Detalhes, Favoritar, Status (submenu), Marcar como nunca jogado, Esconder da biblioteca, Abrir pasta, Mostrar arquivo, Saves, Mods, Atalho na área de trabalho, Emulador (submenu), Página do jogo, Editar (Notas e nota pessoal, Trocar capa…, Trocar executável…, Voltar à capa original, Procurar capa na web, Atualizar metadados), Copiar (nome, caminho) e Remover. Ação que o Ludrix não conhece mostra "Ação indisponível" em vez de não fazer nada.
- Controle em caixas de diálogo e em Ajustes: o D-pad passa por botões, campos, listas, interruptores, segmentos e as abas de Ajustes; A em um campo de texto entra para digitar e B sai; B também fecha a paleta, o sino de notificações e volta para as abas de Ajustes. Na ficha do jogo, o D-pad alcança as abas, as fontes e os executáveis.
- Janela estreita (até 1140 px): os filtros rápidos da Biblioteca (Todos, Favoritos…) rolam em vez de esmagar a contagem de jogos; abaixo de 1000 px descem para uma segunda linha.
- Temas: auditoria automática dos 70 temas do pacote (contraste de faixa NOVO/ATUALIZAÇÃO, filtros, botões, navegação, menu, avisos, barra de status). Luna Nova tinha Ajuda e Notificações invisíveis, nome da marca duplicado e "Pronto" apagado na barra de status; corrigido no pacote (reimportar o tema).
- Ajustes: "Barra de navegação", "Controle" (Modo sofá) e "Zoom no sofá" não eram gravados — voltavam ao padrão ao reabrir.
- Notificações: clicar num aviso que não é de um jogo não tenta mais abrir uma ficha vazia; avisos do backup abrem Ajustes › Sistema e o de dados mais novos abre a checagem de atualização.
- Log: requisição interrompida pela própria interface (troca de tela no meio de um carregamento) deixa de entrar como erro no ludrix.log.

- Organização: a interface foi dividida em arquivos por área (app.js, keys.js, detail.js, settings.js, gamepad.js, sofa.js, icons.js); todos entram na conferência de integridade do atualizador.
- Organização: `tools/check.js` roda antes de qualquer build e barra o pacote se algo estiver quebrado: TypeScript, sintaxe de cada arquivo da interface, JSONs, ids do menu de contexto sem ação, ícones inexistentes, chaves de ajuste sem default (seriam descartadas ao salvar) e rotas chamadas que não existem no servidor; `--boot` ainda sobe o app numa pasta temporária. Foi ele que achou os três ajustes que não gravavam.
- Organização: `data/schema.json` registra a versão do formato dos dados e do Ludrix que gravou; pasta gravada por uma versão mais nova gera aviso em vez de ser sobrescrita; os JSONs de dados passam a ser gravados em arquivo temporário e renomeados (queda de energia no meio não corrompe config/biblioteca).
- Documentação: docs/TEMAS.md (formato dos temas, variáveis, layout, o que o Ludrix calcula sozinho, conferência) e docs/FONTES.md (version, sha256, mirrors, Criar fonte).

## 4.0.7 — 2026-10-24
- Início único: a Biblioteca é uma tela só — faixa "Continuar" com o jogo selecionado e a grade. Os estilos antigos de destaque (Estante, Painel, Banner, Duplo, Simples) e o rodízio automático do destaque saíram do código; a opção "Estilo do destaque" some de Ajustes.
- Cartões: embaixo do título entram duas linhas, tempo jogado (ou "Não jogado") e a última vez que o jogo foi aberto (ou gênero/plataforma se nunca foi); o selo de horas sobre a capa sai. Ajustes › Biblioteca › "Tempo e status embaixo da capa" volta ao formato só com gênero.
- Tamanho das capas: controle deslizante fixo na barra de status, à direita, com − e +; o mesmo ajuste continua no painel Exibição.

- Mods refeita: a aba vira um guia por jogo. O Ludrix lê a pasta do jogo e identifica o motor (Unity Mono ou IL2CPP, Unreal, Creation/Bethesda, Source, GameMaker, RPG Maker, Ren'Py, Frostbite, ASI/Script Hook), se há carregador instalado (BepInEx, MelonLoader, Script Extender), hooks na pasta (dinput8, ReShade…) e a pasta onde os mods entram — mostrada antes de instalar, criada se não existir. O passo a passo muda conforme o caso: instalar carregador, abrir o jogo uma vez, baixar nos sites certos, apontar o arquivo, ligar/desligar. "Neste jogo" explica em uma frase por que aquele jogo funciona assim.
- BepInEx 5 instalado pelo Ludrix em jogos Unity Mono: baixa do GitHub a versão certa (32 ou 64 bits, lida do executável), coloca na pasta e registra como um mod — dá para desligar e remover. IL2CPP e MelonLoader ficam como link com instrução.
- ROMs: patches .ips, .bps e .ups aplicados direto pelo Ludrix (sem Flips). O resultado é um arquivo novo ao lado da ROM original, já na biblioteca com o nome do patch; a original não muda. Se o CRC não bater com o que o patch espera, avisa e pergunta antes.
- Aba "Entenda mods": seis cartões curtos (o que é, carregador, onde os arquivos vão, cuidados com anti-cheat e antivírus, o que o Ludrix guarda, o que fazer quando não funciona). Thunderstore entra nos sites; UndertaleModTool e MelonLoader nas ferramentas.

- Modo console mais fluido: ao trocar de jogo, selo, título, linha de informações e botões entram em sequência (40 ms entre cada); a arte de fundo tem um zoom lento e contínuo (5% em 26 s) que recomeça a cada troca e para no modo painel; a capa selecionada cresce com um leve excesso e a moldura surge em fade; trocar de aba desliza a fileira; a imagem de fundo só é carregada 90 ms depois de parar na capa, então passar correndo por 30 jogos não baixa 30 artes; segurando a direção no controle por mais de 1,6 s a repetição acelera; caixas de opções abrem com escala. "Reduzir movimento" (do Ludrix ou do sistema) desliga tudo isso de uma vez.
- Menu de contexto refeito e no tema: a janela do menu lê as cores do tema em uso (fundo, texto, linha, acento, perigo, acento da capa quando "Acento pela capa" está ligado), o raio dos cantos, a fonte (Rubik embutida) e "Reduzir movimento". A ação principal (Jogar/Encerrar) vira um botão preenchido com o acento no topo; ao passar o mouse o ícone ganha um quadrado tingido e o texto desliza 2 px; perigo em vermelho do tema; submenus abrem ao lado com a mesma animação; em tema claro a sombra é mais leve. Ícones voltaram a aparecer em todos os itens (eram descartados na versão anterior do popup). Textos "Atalho na área de trabalho" e "Trocar executável" ganham acento; "Parar" vira "Encerrar".
- Menu de contexto abre na hora: a janela do menu passa a ficar pronta em segundo plano desde a abertura do Ludrix e só recebe os itens no clique (antes era criada e carregada a cada clique direito, o que custava algumas centenas de milissegundos). Medido: 2–11 ms do clique ao menu na tela. Os ícones do menu são preparados em tempo ocioso logo após abrir. Em espera na bandeja a janela do menu também é liberada da memória.

- Store, fontes .json: o arquivo é validado jogo por jogo antes de entrar. Erros param o item (sem título, sem nenhuma forma de download, url que não é http, magnet sem hash, github fora de dono/repo, id repetido); avisos deixam passar (campo desconhecido, tamanho ilegível, plataforma desconhecida, ano estranho). JSON quebrado é recusado com a linha e a coluna do problema. O relatório aparece ao adicionar (com "Adicionar mesmo assim" quando parte serve), em Store › Fontes ao lado de cada fonte (resumo clicável) e no resultado de "Analisar". O formato está documentado em docs/FONTES.md, com link na própria tela.
- Store, mesmo jogo em várias fontes: títulos iguais (ignorando edição, região e pontuação) viram um cartão só. Na ficha, a faixa "N fontes têm este jogo" mostra cada lugar com tipo (direto, torrent, partes) e tamanho e troca com um clique. Prioridade: arquivo direto, depois torrent, depois GitHub.
- Biblioteca e Store se conhecem: jogo da Store que já está instalado no PC mostra "Jogar" e "Ver na biblioteca" em vez de "Baixar"; jogo da biblioteca cujo arquivo sumiu ganha "Baixar da Loja" no cartão (botão no canto), na faixa Continuar e na ficha, quando alguma fonte tem o título. Fontes e Biblioteca nunca mostram o mesmo jogo duas vezes.
- Store › Fontes: fonte que não carregou mostra o motivo no lugar da contagem.

## 4.0.6 — 2026-10-24
- Imagens: trocar o fundo (hero) ou a capa pela busca na web passa a valer na hora. A imagem nova era baixada e gravada, mas a interface pedia o arquivo com a mesma versão de antes e o Chromium entregava a cópia em cache (válida por 30 dias); a versão agora acompanha o arquivo do fundo, a capa personalizada e a última edição dos metadados. Se o arquivo do fundo sumir, escolher a mesma imagem de novo baixa outra vez.
- Jogos de console (ROMs): além da capa e dos dados da plataforma, recebem imagem de fundo. Ordem: arte do Steam ou do GOG quando o título é exatamente o mesmo; senão a tela do jogo ou a tela de título do acervo libretro (mesmo arquivo da capa). Os jogos já na biblioteca sem fundo são completados em segundo plano, um minuto depois de abrir o Ludrix, sem repetir a consulta (cada jogo é marcado como verificado).
- Detalhes do jogo: a faixa no alto mostra a imagem de fundo do jogo (com a cor dominante por baixo enquanto carrega); antes só a cor. Vale para os temas importados.
- Início: a faixa "Continuar" e a tela de detalhes atualizam a imagem assim que um fundo é trocado ou encontrado, sem reabrir o jogo.
- Atalho de teclado global (Ajustes › Geral › Abrir e fechar): Ctrl+Shift+L mostra ou esconde o Ludrix de qualquer lugar, inclusive com um jogo aberto; a combinação pode ser trocada clicando no campo e pressionando as teclas. Se outro programa já usa a combinação, o Ludrix avisa.
- Discord (Ajustes › Ao jogar › Discord): com um jogo aberto, o perfil do Discord mostra o nome do jogo, a plataforma, a capa e o tempo de sessão. Fala direto com o Discord aberto no computador (sem internet extra, sem conta no Ludrix); precisa do ID de um aplicativo criado em discord.com/developers — o botão "Criar aplicativo" leva até lá. Desligado por padrão.
- Fontes de metadados: saem o Google Imagens (o endpoint devolvia resultados sem relação com a busca) e o SteamGridDB (única fonte que exigia chave). Busca automática e o seletor de imagens usam Bing, DuckDuckGo e Yandex. PCGamingWiki passa a se identificar como LudrixHub e respeita o limite de 60 consultas por minuto, como o site exige.

- Arrastar e soltar: soltar um .exe, .lnk, ROM, .zip/.7z/.rar ou uma pasta na janela volta a funcionar (o Chromium atual não entrega mais o caminho do arquivo do jeito antigo e a ação sempre falhava com "Não deu para ler o caminho"). Agora o que foi solto é classificado: executável entra na biblioteca; ROM abre a confirmação de plataforma; pasta abre a varredura (ROMs ou jogos de PC, conforme o conteúdo); arquivo compactado é instalado como jogo de PC — um .zip com nome de ROM de arcade pergunta qual dos dois é.
- Fim de sessão: ao fechar um jogo aparece um cartão com a capa, o tempo da sessão, o total jogado e desde quando o jogo está na biblioteca; some sozinho em 9 s e o clique abre os detalhes. Sessões de menos de 1 minuto continuam com o aviso curto.
- Sons da interface (Ajustes › Geral › Notificações): cliques, abrir e fechar com sons curtos gerados na hora (sem arquivos de áudio), com três volumes; o cartão de fim de sessão toca um aviso suave. Ligado por padrão no volume baixo; desliga com um toque.
- Metadados: as consultas à Wikipédia e ao Wikidata se identificam como LudrixHub (a Wikimedia passou a responder "429 — muitas requisições" para pedidos com identificação de navegador, e cada jogo esperava de 30 s a 2 min por página). A busca de um jogo volta a levar 1–2 s.
- Tema por horário: já existia em Ajustes › Aparência › Quando "Sistema" (Por horário, com hora de início e fim do modo claro); confirmado em funcionamento.

- Enxugado: saem o Modo Game (plano de energia, fechar programas, prioridade), a instalação de programas pelo winget e a aba Programas úteis. Otimizar o PC não é papel de um launcher. A Central fica com Dependências e Minecraft (edições e launchers encontrados; "Baixar no site" abre a página oficial). As opções correspondentes somem de Ajustes › Ao jogar e da janela "Como abrir".
- Em espera na bandeja (Ajustes › Geral › Dormir na bandeja, ligado por padrão): recolhido há mais de 25 s, o Ludrix libera a janela inteira da memória e fica só com o ícone e o processo principal. Downloads, tempo de jogo, Discord, atalho global e controle continuam; o ícone, o atalho ou o controle recriam a janela em cerca de 1 s.
- Movimento: abrir um jogo faz a capa voar do cartão para a posição dela na tela de detalhes, e voltar desfaz o caminho (View Transitions do Chromium, sem biblioteca). Capas respondem ao mouse com uma mola curta (sobem e assentam), botão de jogar idem. Tudo desliga com "Reduzir movimento".
- Cor acompanha o jogo (Ajustes › Aparência, ligado por padrão): botões e realces tomam a cor dominante da capa do jogo selecionado ou aberto, com transição suave de cor; a opção existia só no arquivo de configuração, sem controle na interface.
- Orientação: os balões por tela e a lista "Comece por aqui" foram removidos; fica só o tour de boas-vindas da primeira abertura, que pode ser revisto em Ajustes › Geral › Orientação.

## 4.0.5 — 2026-10-22
- Biblioteca: o painel "Exibição" (ordem, grupos, modo, tamanho das capas) abre no centro da tela. Antes era posicionado a partir do botão e, com o vidro fosco ou em temas que desfocam o cabeçalho, ficava cortado na borda direita. Fecha com clique fora ou Esc.
- Vidro fosco: menus, painéis flutuantes e caixas de diálogo desfocam o que está atrás; antes deixavam as capas aparecerem através.
- Linux (AppImage): os dados ficam em ~/.local/share/Ludrix (ou $XDG_DATA_HOME/Ludrix). Antes o Ludrix tentava gravar dentro do próprio AppImage, que é somente leitura.
- Linux (AppImage): o AppImage volta a sair em cada release. O build no GitHub parava porque o electron-builder tentava publicar sozinho sem token; agora só empacota (`--publish never`), com o ícone do Ludrix. Ajustes › Sistema reconhece o AppImage e mostra o botão para baixar a versão nova em vez do atualizador interno.

## 4.0.4 — 2026-10-22
- Temas: um tema importado volta a definir a posição da navegação (lateral, topo, embaixo ou só ícones) e o próprio desenho (cartões, painéis, menus, fontes, papel de parede), não só as cores. As regras do tema passam por cima das do motor, mantendo a estrutura da interface e os controles novos (busca no topo, painel do jogo, Ajustes).
- Temas: cada posição de navegação tem o seu bloco no motor (ícones de plataforma, marca, sino e engrenagem no lugar certo; rótulos visíveis ou escondidos conforme o tema); o tema não precisa mais redesenhar isso.
- Pacote de temas: os 66 temas do WOLFFZ (Clássico e Remaster) foram refeitos para o motor novo, cada um com o seu layout original, mais quatro novos (Jornal, Metrô, Cianotipo, Cabine), todos assinados — 70 no total. Importe pelo Ajustes › Aparência › Importar tema.
- Ajustes › Aparência: botão "Apagar todos" remove de uma vez os temas importados (os temas Escuro e Claro ficam); o bloco de temas tinha os botões empilhados e centralizados, agora ficam ao lado do texto.
- Menu de contexto nos temas importados: por enquanto usa o desenho do motor; o redesenho por tema vem numa atualização futura.

## 4.0.3 — 2026-10-22
- Ajustes abre na hora: a tela esperava quatro consultas (temas, tamanho do cache, fontes, hardware) antes de desenhar qualquer coisa; medir o cache percorria todas as pastas de capas e downloads e ainda prendia o processo principal. Agora a tela aparece de imediato, o tamanho do cache é lido em segundo plano só na aba Ferramentas e o hardware só na aba Sistema.
- Ajustes refeitos: cada opção é uma linha dentro de um bloco, com título e descrição à esquerda e o controle à direita, alinhados e com a mesma altura; seções com título e explicação fora do bloco; opções avançadas no mesmo bloco, com fundo levemente diferente; campos numéricos e de texto com largura fixa; coluna lateral mais enxuta. Vale para as sete abas, no tema escuro e no claro.
- Topo da Biblioteca: usa o fundo (hero) do jogo selecionado como imagem da faixa, com a capa à esquerda; jogo sem fundo fica na cor normal do tema, sem faixa colorida.

## 4.0.2 — 2026-10-22
- Vidro fosco refeito: na 4.0.1 o acrílico deixava Ajustes com blocos pretos, a tela de Detalhes mostrando a biblioteca por trás e temas escuros quebrados. Agora todas as superfícies do tema (fundo, barra lateral, painéis, cartões, menus, caixas) ficam translúcidas na mesma proporção sobre o acrílico do Windows 11, nos temas escuro, claro e importados; cabeçalhos fixos desfocam o que rola por baixo; a tela de Detalhes esconde a biblioteca enquanto está aberta; o tom do acrílico do sistema segue o tema escolhido.
- Topo da Biblioteca: mostra o jogo selecionado em qualquer modo de exibição (antes só no modo mural, nos outros ficava no último jogado) e a capa ocupa a altura inteira da faixa.
- Barra lateral: o ícone de cada plataforma aparecia com a bolinha de um interruptor por cima.

## 4.0.1 — 2026-10-22
- Biblioteca: o topo mostra o jogo selecionado (capa, nome, última vez, tempo, plataforma) com Jogar, Detalhes, Pasta e Favorito; sem seleção, mostra o último jogado. Substitui a faixa "Continuar".
- Capas: o botão de jogar aparece no canto inferior direito da capa, não no centro.
- Barra lateral: cada plataforma tem o ícone do console.
- Temas: Ajustes → Aparência → Tema lista os temas instalados e importa arquivos .lxtheme/.zip (botão direito: exportar, apagar). Um tema importado troca só as cores; o desenho da interface é o mesmo.
- Vidro fosco: no Windows 11 a janela usa o acrílico do sistema (translúcida, com desfoque do que está atrás) nos temas escuro e claro. Ajustes → Aparência → Efeitos liga e desliga; Windows 10 e alto contraste ficam opacos.
- Movimento leve: troca de tela, painel do jogo, menus, caixas de diálogo e avisos entram com uma transição curta; capas sobem um pouco ao passar o mouse. "Reduzir movimento" desliga tudo.
- Ajustes → Aparência: a seção Navegação fechava uma div a mais e empurrava Modo sofá, Escala e Efeitos para a coluna da esquerda, com texto quebrado.
- Motor: Electron 33 → 44 (correções do acrílico em janela sem moldura, Chromium e Node atuais). Por isso esta atualização vem completa (runtime novo), não só o app.
- Atualizações: a conferência do pacote (assinatura e hash) roda fora do processo da interface; antes, um pacote completo guardado em data\updates prendia a janela por alguns segundos a cada verificação. No Linux, os binários do runtime mantêm a permissão de execução depois da troca.
- Build: o nome, a descrição e o ícone do Ludrix passam a ser gravados no executável do runtime antes de empacotar (antes o Gerenciador de Tarefas mostrava "Electron"); se a gravação falhar, o build para em vez de seguir.
- Ludrix-Dev: mostra o resultado de cada ação antes de voltar ao menu; faz login no GitHub quando falta; publica as notas da release por arquivo; no primeiro envio do código busca o histórico do repositório antes de enviar; aceita arquivos baixados com " (1)" no nome; ao importar o git-pack substitui a pasta docs inteira; atualiza descrição e tópicos do repositório.

## 4.0.0 — 2026-10-22 — Novo motor
- Interface nova (Base): barra lateral com busca, seções e plataformas; biblioteca em ordem alfabética com divisórias por letra e atalhos Todos / Favoritos / Jogados esta semana / Nunca joguei; clicar numa capa abre o painel lateral do jogo (Jogar, favorito, tempo, última vez, sessões, executável, pasta, saves, mods, capa, editar); faixa "Continuar" com os três últimos jogados. Tela de detalhes e Ajustes refeitos no mesmo desenho. Dois temas, preto e branco, só cor sólida e linha fina: sem degradê, desfoque ou sombra.
- Janela: redimensionar ou maximizar não deixa mais a janela presa ao mouse (o arrasto termina ao soltar o botão, e por segurança para sozinho depois de 15 s ou quando a janela perde o foco).
- Depois de migrar do 3.0.x, o backup do motor antigo é apagado sozinho quando o 4.0.0 abre bem; cada atualização substitui o programa inteiro e deixa só os dados do usuário.
- Build: pasta temporária e `dist\` apagadas ao final; cache de dependências fora da pasta do código; arquivo de categorias sem duplicata.
- Ludrix inteiro reescrito em TypeScript sobre Electron: a janela não depende mais do WebView2 (nem do Edge) e funciona em qualquer Windows 10/11 x64.
- Distribuído como pasta (Ludrix.exe + runtime\ + app\); nada é gravado fora dela. Quem está no 3.0.x recebe o 4.0.0 pelo "Checar atualizações" sem baixar nem reconfigurar nada.
- Menu de contexto, bandeja, atalhos de controle, atualizador e modo console refeitos com o mesmo comportamento e aparência; configurações, biblioteca, temas e emuladores são lidos como estão.
- Correções: o menu de contexto aparece onde foi clicado; a janela sem borda segue a configuração; prévia de temas; abrir Ajustes não consulta mais o WMI.
- Pastas de jogos: escolher a pasta na configuração inicial ou adicionar uma pasta em Ajustes abre na hora a revisão dos jogos encontrados; a leitura de disco roda fora da interface e não trava em HD lento.
- Leitura de pastas muito mais rápida: cada pasta de jogo é lida só até achar o executável (raiz, depois bin/Binaries), sem varrer os arquivos do jogo inteiro; em 300 pastas caiu de ~27 mil leituras de diretório para ~1 mil.
- Menu de contexto: fechar o menu nativo não abre mais um segundo menu.
- "Baixar metadados…": a fonte escolhida mostra uma lista de candidatos (nome, ano, plataformas, desenvolvedora) para escolher o jogo certo antes de aplicar. Nova fonte Wikidata, sem chave. Ajustes → Biblioteca → Fontes de metadados liga e desliga cada fonte.
- Procurar capa/fundo na web: campo de busca editável, escolha do buscador (Automático, Google, Bing, DuckDuckGo, Yandex), resolução em cada imagem e "Carregar mais" sempre disponível.

## 3.0.3 — 2026-10-13
- Linux: a janela respeita o tamanho da tela (em telas pequenas e máquinas virtuais ela abria presa em tamanho cheio) e o ícone da bandeja passa a usar o Qt, que funciona no KDE e nos demais ambientes com área de notificação. `run.sh` avisa o que está fazendo na primeira vez.
- Linux: rodar pelo código (`git clone` + `bash run.sh`) não deixa mais o repositório sujo; `git pull` atualiza sem erro.

## 3.0.2 — 2026-10-12
- Mural: com ordem A–Z a parede fica alfabética de verdade (antes seguia a ordem inteligente do Início e o índice de letras não batia); o índice só aparece quando a ordem é mesmo alfabética.
- Estante: texto do destaque legível também sobre artes claras.
- Tema claro refeito: fundo cinza-pedra com pouco brilho, barra lateral escura e destaque da Estante sempre escuro sobre a arte.
- Estante: com o painel aberto o destaque encolhe sem sobrepor botões e números.
- Editar → Mídia: a prévia de capa e fundo não mostra mais a imagem escolhida para o jogo editado antes.
- Abrir pasta: quando o caminho guardado não existe, o Ludrix tenta a pasta do executável e a pasta de trabalho; se nada existir, avisa em vez de ficar mudo. Vale para jogos vindos do Playnite, emuladores e ROMs.
- Nenhuma ação fica muda: qualquer botão cuja resposta do launcher seja um erro mostra o aviso na tela (antes dezenas deles falhavam em silêncio).
- Cartão largo e destaque sem arte de fundo usam a capa como fundo; fundos vindos do Playnite em formatos que a tela não abre são convertidos.
- Jogo que fecha sozinho: a janela de socorro agora resolve na hora — abrir como administrador, modo de compatibilidade Windows 7, dependências, trocar executável, abrir a pasta — e reabre o jogo em seguida.
- Modo sofá: com um controle ligado, qualquer botão passa a navegação para ele (direcional move, A seleciona, B volta, X menu, Y favorito, LB/RB abas, Start joga, analógico direito rola). A interface aumenta (ajustável) e o mouse devolve o modo normal. Ajustes → Aparência → Modo sofá.
- Emuladores: botão "ROMs" aparecia duas vezes no cabeçalho.
- Log registra o tempo até a interface ficar pronta, para medir a abertura.
- Procurar atualização ao abrir vinha desligado de fábrica. Agora vem ligado, tenta de novo quando a internet demora a conectar e repete a cada 6 horas com o launcher aberto.

## 3.0.1 — 2026-10-12
- Reenvio assinado da 3.0.0: o pacote anterior saiu sem assinatura e o Ludrix o recusava em Checar atualizações. Nenhuma mudança no programa além do número da versão.

## 3.0.0 — 2026-10-12
- Nova cara da Biblioteca. Início em formato Estante: destaque com a capa em pé, tempo jogado, nota e vezes, com cinco sorteados e o dado para trocar; abaixo, "Continuar jogando" em cartões largos e "Adicionados há pouco". Menu lateral com nomes, bloco Coleções (Favoritos, Jogando, Zerados, Nunca joguei, com contagem) e o último jogo aberto com botão de jogar.
- Todos os jogos em modo Mural: parede de capas mais densa; clicar numa capa abre um painel fixo à direita com arte, Jogar, favorito, editar, detalhes, tempo, última vez, status, nota, capturas, resumo e gêneros. Duplo clique ou botão direito continuam abrindo os detalhes. Com 30 jogos ou mais e ordem A–Z aparece um índice de letras. Grade de capas e Lista seguem em Exibição → Modo.
- Tema Padrão modernizado: texto em caixa normal, cantos arredondados, botões e chips em pílula, item ativo do menu em preto e branco, sem bordas finas nos cartões. Escuro passa a ser o padrão; o claro continua em Ajustes → Aparência.
- Quem já usava: na primeira abertura o layout vai para o menu lateral, a Biblioteca para Mural, o Início para Estante e o tema para escuro. Tudo volta em Ajustes → Aparência e em Exibição.
- Corrigido: a cor de fundo de cartões, painéis e caixas não era aplicada (a variável de cor era sobrescrita pelo tamanho das capas) — agora os temas valem de verdade.
- Segurança (auditoria interna): arquivos SVG/HTML vindos de temas ou da personalização passam a ser servidos isolados (sem script, sem rede); o token da sessão deixa de ficar no HTML depois de lido; "Abrir pasta" só abre pastas e arquivos de texto/imagem (nunca executáveis); restaurar uma cópia de dados só aceita os arquivos que o próprio Ludrix exporta (`data/`, `themes/`, `games/rapidos/custom.json`) — nada pode sobrescrever o programa.
- Status e nota por jogo: em Editar → Avançado (ou pelo botão direito → Status) cada jogo pode ficar como Planejo jogar, Jogando, Jogado, Zerado, Completado 100%, Em espera ou Abandonado, e receber uma nota sua de 1 a 10. Aparecem nos detalhes, na lista e no cartão (a nota no lugar do tamanho); o painel de filtros ganhou "Status" e "Sua nota" e a ordenação ganhou "Sua nota". A importação do Playnite traz o status de conclusão e a nota do usuário; a exportação CSV/JSON inclui os dois.
- Lista com colunas à sua escolha: em Exibição → Colunas da lista dá para ligar/desligar Ano, Gênero, Desenvolvedora, Plataforma, Tamanho, Tempo, Última vez, Vezes, Adicionado, Status e Nota; a lista ganhou um cabeçalho com o nome das colunas e clicar nele ordena (clicar de novo inverte). Agrupar ganhou Status, Sua nota, Gênero, Ano e Desenvolvedora.
- Corrigido: texto da aba ativa (Editar detalhes, Central, Emuladores…) podia ficar invisível em alguns temas — uma função de cor estava sendo sobrescrita por outra de mesmo nome.
- Linux: a Central deixa de mostrar coisas que só existem no Windows e passa a ter equivalentes. Dependências (Visual C++, DirectX, .NET, XNA, OpenAL…) são detectadas e instaladas dentro do prefixo do Proton, com os mesmos instaladores oficiais; Programas úteis vira uma lista própria (Steam, Heroic, Lutris, Bottles, ProtonUp-Qt, Protontricks, GameMode, MangoHud, LACT, CoreCtrl, OBS, 7z, qBittorrent, Discord, Parsec) instalada pelo Flatpak/Flathub, e o que não tem Flatpak mostra o nome do pacote da distro; launchers de Minecraft instalam pelo Flatpak; Otimizar antes de jogar usa o GameMode (Feral) quando instalado. Diagnóstico mostra o estado do Proton/umu e do GameMode. O AppImage só é anexado à release se passar no selftest.

## 2.43.0 — 2026-10-11
- Linux de volta: `LudrixHub-<versão>-x86_64.AppImage` em cada release (Python e Qt WebEngine embutidos; dados em `~/.local/share/Ludrix`). O AppImage é montado e anexado à release pelo GitHub Actions a partir do código publicado.
- Jogos de Windows no Linux abrem pelo Proton sem configurar nada: na primeira abertura o Ludrix baixa o umu-launcher e o GE-Proton (uma vez só, com progresso na Fila) e abre o jogo sozinho em seguida. Prefixo compartilhado em `data/pfx/shared` ou um por jogo (Editar → Instalação). Em Ajustes → Ao jogar: Proton ou Wine do sistema, versão do Proton, variáveis extras, baixar/atualizar agora e pasta dos prefixos. Jogos nativos (`.sh`, `.x86_64`, `.AppImage`, binários) abrem direto; emuladores da distro/Flatpak são usados e os de Windows passam pelo Proton. Links e pastas abrem com o ambiente limpo do sistema (não o do AppImage).
- Revisar jogos encontrados: um executável secundário pode ser ignorado de vez (ou todos os desmarcados, com "Não sugerir de novo os que ficarem desmarcados") — o Ludrix não volta a perguntar por ele nas próximas varreduras.
- `run.sh` para rodar do código no Linux (cria um `.venv` com PyQt6) e `tools/build_appimage.sh` para gerar o AppImage localmente.

## 2.42.1 — 2026-10-11
- Memória: o WebView2 passa a rodar o processo de GPU dentro do principal e com um único renderizador (menos processos, menos memória fixa). Depois de 60 s sem a janela do Ludrix em primeiro plano, a interface entra em modo de pouca memória (o Chromium libera caches) e solta as imagens grandes de fundo (destaque, pano de fundo desfocado, slideshow); ao voltar para a janela tudo retorna na hora. Na bandeja, o WebView2 é suspenso de verdade (TrySuspend) e retomado ao reabrir. O slideshow de capas não roda com a janela sem foco.

## 2.42.0 — 2026-10-11
- Disco: a varredura automática das pastas de jogos na abertura passa a pular as pastas de jogos que já estão na biblioteca — antes ela percorria todas as pastas (e lia os executáveis) a cada abertura, o que em HD mecânico travava o PC por minutos. "Procurar jogos novos" continua varrendo tudo quando você pede.
- Disco: biblioteca e configurações são gravadas em lote (uma gravação por mudança, não dezenas), a cópia de segurança `.bak` é feita por renomeação (sem copiar o arquivo) e no máximo a cada 10 minutos, e configurações iguais não são regravadas. Tempo de jogo é salvo a cada 2 minutos (era 30 s) e sempre ao fechar o jogo e ao sair do Ludrix.
- Disco: a varredura de ROMs usa listagem direta (sem `rglob`), só desce 8 níveis, fica em cache por 15 minutos e o caminho de cada emulador é lembrado por 15 s em vez de ser procurado no disco a cada pedido da interface. Miniaturas são geradas por 2 threads (eram 6) para não disputar o disco.
- Memória: a interface só desenha os cartões visíveis (`content-visibility`), o destaque da Biblioteca troca de jogo a cada 12 s (era 7 s) e o WebView2 entra em modo de pouca memória quando o Ludrix está minimizado ou quando há um jogo aberto e a janela não está em primeiro plano, voltando ao normal ao focar. O WebView2 roda com cache em disco limitado a 64 MB, sem cache de shaders em disco e com no máximo 2 processos de renderização.
- Emuladores: quando um executável errado estava na vaga de um emulador (ex.: Ryujinx no lugar do Eden), ao desvincular o Ludrix agora procura o executável certo nas pastas vizinhas, em AppData\Local e em Arquivos de Programas e religa sozinho. O diálogo "Jogar com qual emulador?" avisa quando o padrão do console está sem executável.

## 2.41.1 — 2026-10-11
- Compilação: o teste automático do exe não é mais interrompido quando o WebView2 Runtime não consta no registro da máquina que compila (o Ludrix instala o runtime sozinho na primeira abertura). A detecção do WebView2 no Diagnóstico passa a procurar também pela pasta de instalação (Program Files › Microsoft › EdgeWebView), não só pelo registro.

## 2.41.0 — 2026-10-11
- Corrigido: ROM de Switch abria o Ryujinx mesmo com o Eden escolhido. O emulador marcado no console é sempre o que abre; um executável apontado que não é da mesma família (ex.: Ryujinx na vaga do Eden) vira "Meu próprio emulador" em vez de tomar o lugar do padrão. Bibliotecas já afetadas são corrigidas na abertura. Importar do Playnite também respeita isso.
- Guia por console em Emuladores: Switch (prod.keys e firmware), PS2, PS1, PS3 (firmware PUP), Wii U (keys.txt), 3DS, Xbox, Dreamcast, Saturn e Arcade. O botão "guia" no cartão mostra o que está instalado e o que falta, explica de onde vem cada arquivo e instala no lugar certo do emulador (arquivo, .zip ou pasta). Se faltar algo obrigatório, o Jogar avisa e abre o guia (ou "Abrir mesmo assim"). A pasta genérica de BIOS deixa de existir; o botão do topo passa a abrir a pasta de ROMs.
- Minecraft: a detecção passa a procurar o executável do launcher (oficial, Microsoft Store, SKlauncher instalado ou solto na Área de Trabalho/Downloads/Documentos, Prism, Modrinth, MultiMC, PolyMC, ATLauncher, GDLauncher, CurseForge). Um `.jar` só é usado se não houver executável e houver Java; sem Java é ignorado. Entradas antigas apontando para `.jar` são refeitas sozinhas.
- Menu da bandeja no modelo do Playnite: os últimos 10 jogos (com capa) direto no topo, submenu Favoritos, "Encerrar" com o tempo da partida, Abrir Ludrix, Ir para, "Lojas e clientes" (Steam, Epic, GOG Galaxy, EA app, Ubisoft Connect, Battle.net, Rockstar, Amazon, itch e Xbox — só os instalados), Fila, Verificar atualizações, Abrir pasta e Sair. O menu de reserva (quando o desenhado não pode abrir) tem os mesmos itens.
- Segurança: o servidor interno só escuta em 127.0.0.1 (a opção de rede local foi removida) com token e checagem de origem; torrents não abrem mais porta no roteador (UPnP, NAT-PMP e descoberta local desligados) e o motor é fechado ao terminar os downloads, liberando a porta. Nenhuma porta fica aberta com o Ludrix parado.

## 2.40.0 — 2026-10-07
- O WebView2 deixa de vir embutido: o Ludrix usa o WebView2 Runtime do Windows (já presente na maioria dos PCs). Se faltar, instala sozinho na primeira abertura, com a tela "Aguarde, últimos ajustes finais..". A pasta do Ludrix fica cerca de 270 MB menor e os pacotes de atualização também. Esta atualização é a completa (troca o runtime inteiro), por isso é maior que as anteriores; a partir dela os pacotes voltam ao tamanho normal.
- Importar do Playnite: jogos diferentes na mesma pasta (coleções, episódios) não são mais pulados como "já está na biblioteca"; só é pulado quem aponta para o mesmo executável de outro jogo. Ação do Playnite que não é executável (manual em PDF, texto) é ignorada e o executável é procurado na pasta. Jogos da Epic/GOG com pasta local existente entram pela pasta, não pelo launcher. Data de adição e contagem de partidas passam a vir do Playnite (ordem "Adicionados" igual à do Playnite). Jogos ocultos no Playnite, quando incluídos, entram ocultos aqui também.
- Importar: o que fica de fora aparece com o motivo — na prévia ("N ficaram de fora") e na lista final, incluindo o que o leitor descartou (oculto, sem caminho, não instalado, repetido). A lista também vai para o `ludrix.log`.
- Depois de importar ROMs, a biblioteca já mostra todas na hora; a lista de ROMs não some mais da grade enquanto o Ludrix revarre as pastas.
- Ícone da bandeja: o menu do botão direito passa a ser desenhado com as cores do tema, com os últimos 10 jogos (com capa) para abrir direto, "Encerrar" do jogo em andamento, Ir para, Fila, Verificar atualizações, Abrir pasta e Sair. "Abrir Ludrix" em destaque.
- Atualizações: o cartão mostra o tamanho do pacote antes de baixar.

## 2.39.2 — 2026-10-07
- Menu do botão direito (nativo): ganhou os ícones do Ludrix, o cabeçalho com a capa, o nome e a origem do jogo, linha "Jogar" em destaque, altura e espaçamento iguais aos do menu interno. Continua saindo da janela e seguindo as cores do tema.
- Diagnóstico: linha "Memória em uso" separando Ludrix, interface (WebView2) e total; avisa acima de 700 MB.
- Ao esconder na bandeja, a interface entra em modo de pouca memória e o Ludrix devolve memória ao sistema; ao reabrir volta ao normal.
- O motor de torrent (libtorrent) só é carregado quando um torrent é usado, não mais na abertura.

## 2.39.1 — 2026-10-07
- Corrigido: jogos que já estavam na biblioteca apareciam no aviso "jogos novos nas suas pastas" e em "Procurar jogos novos", e ao adicionar entravam de novo (duplicados). A comparação passa a considerar o executável, a pasta do jogo e pastas aninhadas; adicionar um jogo que já existe não cria entrada nova. Duplicados já existentes: Ajustes › Ferramentas › Jogos duplicados.
- Menu do botão direito: passa a usar por padrão o menu nativo do Windows, que pode sair da janela como em qualquer programa, desenhado com as cores do tema (fundo, texto, destaque, vermelho, claro/escuro). O menu interno continua disponível em Ajustes › Aparência › opções avançadas › "Menus do botão direito".

## 2.39.0 — 2026-10-07
- Pastas: além da pasta de jogos instalados, a biblioteca aceita outras pastas (outros discos, pastas de outros launchers) em Ajustes › Biblioteca › Pastas. "Procurar jogos novos" varre todas de uma vez; executáveis marcados como "Ignorar" não voltam a aparecer.
- Procurar jogos novos ao abrir (ligado por padrão): alguns segundos depois de abrir, o Ludrix olha as pastas e avisa quando acha jogo fora da biblioteca, com Revisar, Ignorar e Depois. Nada é adicionado sem revisão.
- Ocultar da biblioteca (menu do jogo): o jogo some da grade e das fileiras sem ser removido; o filtro "Ocultos" mostra e devolve.
- Tempo de jogo também quando o jogo é aberto fora do Ludrix (Steam, atalho, .exe direto): o Ludrix reconhece o executável em execução e conta a sessão do mesmo jeito. Ajustes › Ao jogar › "Contar tempo de jogos abertos fora do Ludrix".
- Editar detalhes do jogo › Ações: "Abrir como administrador" e comandos "Antes de abrir" e "Ao fechar" por jogo.
- Emuladores: o Ludrix confere a cada 12 h se há versão nova dos emuladores instalados por ele (GitHub e Gitea) e mostra a tag e o botão "Atualizar" no cartão do console. A atualização substitui só os arquivos do emulador; configurações, BIOS, saves e ROMs ficam onde estão. Emuladores apontados manualmente ou "Meu próprio emulador" não são verificados.
- Importar: novas origens Xbox (Game Pass para PC), EA app e Ubisoft Connect, com os jogos já instalados em cada uma.
- Central Ludrix: Minecraft deixa de ter aba própria e passa a aparecer no fim de "Programas úteis" (edições encontradas no PC e dois launchers sugeridos: Prism Launcher e SKLauncher; os já instalados continuam aparecendo).
- Removidos: camada Wine/Proton (o Ludrix é só Windows), comandos de brincadeira do terminal, bloqueio de Ajustes por PIN (`/locksettings`) e o editor de temas interno (temas são criados e editados no Ludrix Studio; o Ludrix mantém o tema "Padrão" e os temas importados).

## 2.38.0 — 2026-10-07
- Enviar para a Steam (Ajustes › Ferramentas › Exportar biblioteca): cria os atalhos "não-Steam" (`shortcuts.vdf`) de todos os jogos com executável, com capa vertical, capa horizontal e fundo para a Steam e o Big Picture. ROMs entram com o comando do emulador. Exige a Steam fechada; faz backup do arquivo atual, atualiza só os atalhos criados pelo Ludrix e não mexe nos demais. Com mais de uma conta no PC, pergunta qual usar.
- Exportar biblioteca também gera `playnite\LudrixImport.pext`: dois cliques nele e, no Playnite, menu Extensões › Ludrix › Importar biblioteca do Ludrix traz jogos, capas e metadados (atualiza em vez de duplicar).
- Encerrar o jogo: no menu do jogo, no botão do cartão e no ícone da bandeja. Fecha o processo e os filhos mesmo quando o jogo travou ou ficou em tela preta; pede confirmação antes.
- Ícone da bandeja: botão direito mostra o jogo em andamento, os últimos jogos para abrir direto, atalhos para cada tela, a fila, verificar atualizações e abrir a pasta do Ludrix. Um clique abre o Ludrix.
- Ajustes: removido o traço que aparecia antes dos títulos de seção em temas importados.

## 2.37.0 — 2026-10-07
- Biblioteca: painel lateral de filtros (botão Filtros) com o conjunto completo: situação, origem, categoria, gênero, desenvolvedora, ano, última vez que jogou, data em que foi adicionado, tempo jogado e tamanho. Cada grupo mostra a contagem, tem busca própria e aceita várias marcações; os filtros ativos aparecem como chips acima da grade. Combinações podem ser salvas e reaplicadas em "Filtros salvos". O painel vale também para a Store.
- Ajustes: títulos de seção maiores, opções em cartões com nomes em destaque e descrições mais legíveis; abas da lateral maiores.
- "Opções avançadas" virou um cartão próprio na lateral de Ajustes, com descrição; ao ligar, a tela rola até o primeiro bloco avançado da aba (ou avisa quando a aba não tem nenhum).
- Mods e ferramentas refeitos: Meus mods com lista de jogos (os que têm mods primeiro, com busca) e painel do jogo escolhido; Ferramentas em cartões por categoria com chips de filtro (Todas, Instaladas, categoria) e indicação Portátil/Site; Sites de mods em cartões.
- Jogos não reconhecidos pelas fontes de metadados passam a gerar um único aviso agrupado, com lista para corrigir cada um, em vez de um aviso por jogo.

## 2.36.3 — 2026-10-07
- Corrigido de vez o retorno indevido de versão: a abertura passa a ser marcada como boa na primeira requisição da biblioteca (a 2.36.2 marcava num pedido que a interface normalmente não faz na abertura, então fechar cedo ainda contava como falha).
- `lancar.bat`: o código sobe para o GitHub antes da release, assim o "Source code" automático da release corresponde à versão publicada.
- `Ludrix-<v>-src.zip` passa a conter só o código: `app/`, `tools/`, `run.bat`, `build.bat`, `requirements.txt`, README, CHANGELOG e LICENSE. Scripts de publicação, `docs/` e `.github/` ficam fora do pacote (continuam no repositório).
- Build: o pacote `ludrix-<v>-full.lxup` (runtime inteiro) deixa de ser gerado em toda versão; só sai quando o runtime muda (`"needs_full": true` em `app/version.json` ou `build.py all --full`). O patch continua sendo o caminho normal de atualização.

## 2.36.2 — 2026-10-07
- Corrigido: fechar o Ludrix nos primeiros 10 segundos depois de abrir contava como "não conseguiu abrir", e na segunda vez a atualização era desfeita sozinha (a 2.36.1 voltava para a 2.36.0). A abertura passa a ser considerada boa assim que a interface carrega, e uma saída normal nunca conta como falha.

## 2.36.1 — 2026-10-07
- Corrigido: ao sair (pela bandeja ou pelo X) o processo podia continuar em segundo plano, e a próxima abertura mostrava "O Ludrix desta pasta já está aberto". O encerramento agora é garantido: se algo ainda estiver rodando 6 s depois do pedido de saída, o Ludrix fecha mesmo assim e registra no `data/ludrix.log` o que estava segurando.
- `casca/` (esboço em C#) removida do código-fonte e do repositório.

## 2.36.0 — 2026-10-07
- Detecção do executável: regra genérica para qualquer jogo. Executáveis com marca de site/repack, instaladores, desinstaladores, crash handlers e utilitários perdem prioridade para o executável do jogo; quando continua ambíguo, o Ludrix pergunta.
- Capa, fundo e metadados escolhidos pelo usuário não são mais substituídos: a busca automática roda uma única vez por jogo e depois só completa o que estiver vazio.
- Detalhes → Mídia: escolha de capa e de fundo (hero) por busca na web, com pré-visualização em grade e salvamento direto.
- Metadados por plataforma: jogo de PC busca em Steam/GOG; ROM busca na base do console correspondente (Libretro/SteamGridDB). A Wikipédia deixou de ser fonte principal e só entra quando o artigo cita a plataforma certa.
- Abertura mais rápida: a varredura de ROMs não trava mais a biblioteca (roda em segundo plano e a lista é servida assim que estiver pronta; antes a varredura repetia a cada 15 s), verificação de executáveis em cache e tempos de cada etapa registrados em `data/ludrix.log` (núcleo, servidor, catálogo, ROMs, primeira biblioteca). Janela de diálogo com entrada mais suave.
- Duas cópias do Ludrix em pastas diferentes podem ficar abertas ao mesmo tempo (a trava de instância única passa a ser por pasta). Abrir o Ludrix de novo enquanto ele está na bandeja traz a janela de volta em vez de mostrar aviso.
- Atualizações: o launcher considera todos os pacotes listados no endereço de atualizações e instala o mais novo que se aplica à versão instalada (antes só olhava o último; se ele exigisse uma versão intermediária, nada aparecia). O feed gerado herda os pacotes anteriores com endereços fixos por versão.

## 2.35.0 — 2026-10-07
- Diagnóstico: biblioteca sem cópia de segurança ainda aparece como aviso, não como falha (impedia o teste automático do build).
- Endereço de atualizações passa a ser `github.com/wolffZ-prog/Ludrix` (o repositório foi renomeado; o endereço antigo continua redirecionando).
- Tela de abertura: barra de progresso real, versão e os passos do carregamento (interface, configurações, biblioteca, tema). Com "Reduzir movimento" tudo aparece de uma vez.
- Listas `.json` (`ludrix-pack/1`) aceitam `"github": "dono/repositorio"` por jogo: o Ludrix busca a versão mais recente da release na hora, sem endereço fixo. Campos opcionais `asset` (regex do arquivo), `requires_rom`, `exe`.
- Fontes do GitHub: ignora `.sha256`, `.sig`, `provenance.json` e, para recompilações com mais de um arquivo Windows, baixa só o pacote principal.

## 2.34.1 — 2026-10-06
- Corrigido: depois de um patch gerado em outro Python, o launcher acusava "arquivos alterados" em todos os módulos. A verificação de integridade agora registra o hash de cada `.pyc` na própria máquina ao compilar (`app/pyc.json`) em vez de depender de um hash atrelado à versão do Python; instalações já afetadas se recuperam sozinhas na abertura.

## 2.34.0 — 2026-10-06 — Cofre
- Nova chave de assinatura do projeto. A anterior estava embutida no Ludrix Studio 1.0/1.1 e foi descartada; este patch ainda é assinado com ela para o 2.33.0 aceitar, e daqui em diante só a nova vale.
- Temas (`extra.css` e variáveis): `@import`, `url()` para endereços externos, `expression`, `behavior` e similares são removidos ao renderizar. Um tema não consegue mais carregar nada da internet.
- Importação de tema com limites: 80 MB por arquivo, 400 entradas, 40 MB por entrada; caminhos com `..` ignorados.
- Voltar para versão anterior (código-fonte) agora também exige assinatura válida.
- Atualização remota só por `https` e até 600 MB; o endereço de atualizações também precisa ser https.
- Bot do Telegram removido do launcher (o token ficava dentro do programa). Fonte "Canal oficial do Ludrix" sai da lista e é apagada das fontes salvas; canais do Telegram com bot próprio continuam funcionando. Atualizações vêm do endereço do projeto no GitHub (`wolffZ-prog/Ludrix`, já embutido), de um endereço https próprio ou de arquivo `.lxup`.


## 2.33.0 — 2026-10-05 — Ateliê
- Temas embutidos reduzidos ao "Padrão"; quem usava Tinta ou outro volta ao Padrão. Temas prontos passam a vir como pacotes .lxtheme (Ludrix Studio).
- Ajustes › Aparência: a faixa de temas não corta mais o último item nem some em janelas estreitas.
- Página do jogo: "Tamanho" com "Calcular" e "Notas" com "editar" aparecem só uma vez.
- Tema pode ser recarregado por API (`POST /api/theme/reload`) — usado pelo Ludrix Studio para o botão Testar.
- Papel de parede de tema personalizado volta a aparecer (o arquivo existia, mas não era desenhado).

## 2.32.1 — 2026-10-04 — Tinta
- Novo tema embutido "Tinta": preto-tinta, branco e vermelhão, sem brilhos nem desfoque; traços de pincel nos títulos e no sublinhado do destaque, item ativo da barra como carimbo inclinado, cantos quase retos. Versões clara e escura.
- Tema "Sinal" removido; quem o usava volta ao Padrão.

## 2.32.0 — 2026-10-04 — Sinal
- Novo tema embutido "Sinal": verde-lima sobre fundo escuro (ou verde sobre claro), cantos chanfrados nas capas e painéis, barra lateral de ícones; respeita a configuração de animações e tem versões clara e escura.
- Seleção múltipla na Biblioteca: Ctrl+clique, Shift+clique (intervalo), Ctrl+A (todos da página), Esc limpa. Barra inferior com Favoritar, Metadados, Marcar como jogado, Exportar CSV (só os selecionados) e Remover; mostra o tempo jogado somado. "Selecionar" no menu do cartão e "Selecionar todos da página" no clique direito no espaço vazio.
- Remover da biblioteca ganhou "Desfazer" (no aviso, Ctrl+Z ou /undo no terminal) por 10 minutos.
- Cópias de segurança da biblioteca: uma por dia em data\backups (ficam 7 diárias e 10 manuais); Ajustes › Ferramentas › "Cópias da biblioteca" lista, cria agora, abre a pasta e restaura (devolve jogos que sumiram e tempo de jogo zerado, sem apagar nada). Uma cópia extra é feita antes de importar, restaurar ou juntar duplicados.
- Jogos duplicados (Ajustes › Ferramentas): encontra entradas com o mesmo nome no mesmo console ou o mesmo executável; "Manter esta" soma tempo e vezes jogado e remove as repetidas. "Verificar jogos" avisa quando há duplicados.
- Requisitos × meu PC: na aba Requisitos, um quadro compara memória, espaço livre e placa de vídeo dedicada com o que o jogo pede; link "Ver meu PC". Linhas sem rótulo ocupam a largura toda.
- Busca com prefixo: dev:, ano: (ou década, ex. ano:2010s), gen:, sis:, origem:; combinável com palavras normais. A tela vazia explica os prefixos.
- Arrastar um .exe, atalho, ROM ou pasta para a janela adiciona o jogo à biblioteca (aviso com "Detalhes").
- Ordenação: "Vezes jogado", "Ordem inversa", "Favoritos primeiro" (também em Ajustes › Biblioteca e no modo console); a ordem e os grupos recolhidos ficam salvos; o cabeçalho do grupo mostra quantidade e tempo jogado somado.
- Cartões: faixa NOVO com dica "adicionado há N dias"; tamanho da pasta com "Calcular" na página do jogo; "Marcar como jogado"/"nunca jogado", "Copiar nome", "Procurar capa no navegador" e "Mostrar o executável na pasta" no menu do cartão; Notas com link "editar".
- Página do jogo: Jogar vira "Localizar arquivo" quando o arquivo sumiu (também no destaque da Biblioteca); links do Playnite entram nos detalhes e no editor.
- Editor: "Tempo de jogo (horas)" e "Vezes jogado" editáveis; botão para abrir a pasta do executável.
- Importação: contagem ao vivo, ordenação da lista, "Inverter" seleção, aviso de itens sem arquivo; Links do Playnite são importados.
- Novidades após atualizar: aviso "Atualizado para X" com "Ver novidades" (lista do changelog embutida no pacote) e link em Sobre; botão "Atualizações".
- Barra de status: contagem de jogos não encontrados (abre o filtro), link do catálogo rola até a lista; título da janela mostra a quantidade de jogos e o jogo em execução.
- Emuladores: o cartão do console mostra ROMs não encontradas com link para o filtro.
- Avisos: no máximo 5 na tela, pausam ao passar o mouse, clique abre o item relacionado.
- Teclado: E edita, F2 renomeia, Ctrl+D favorita, N adiciona jogo, Home/End rolam a lista, Delete remove a seleção; lista de atalhos (?) atualizada.
- Terminal: /check, /origin, /recent, /backups [now|restore], /dupes, /size, /played, /fav, /undo.
- Modo console: contador de vezes jogado e origem no cartão e nos detalhes; ordenação "Mais vezes"; jogos não encontrados e em execução tratados ao Jogar.
- Diagnóstico mostra as cópias da biblioteca; textos de ajuda e tradução em inglês atualizados; Sobre mostra a data da versão.

## 2.31.0 — 2026-10-04 — Origem
- Página do jogo: linha "Origem" (Playnite · Steam, Epic, GOG…), "Vezes jogado", "Última sessão", "Adicionado", "Pasta de trabalho"; selo "Importado do Playnite" no lugar de "Adicionado manualmente" para jogos importados.
- Contagem de sessões e duração da última sessão passam a ser registradas a cada jogo fechado; o PlayCount do Playnite entra na importação.
- Importação do Playnite: opção "Incluir jogos marcados como ocultos no Playnite"; as notas do Playnite entram em "Notas" na página do jogo; a loja de origem (Steam, Epic, GOG, Ubisoft…) é guardada.
- Lista de revisão da importação: campo "Filtrar…", botão "Só novos" (marca só o que ainda não está na biblioteca), selos "oculto" e "arquivo ausente" por item; "já tem" só é apontado quando o título coincide no mesmo console (um jogo de PC e a ROM homônima não se bloqueiam mais).
- Resumo da importação e aviso de conclusão têm o botão "Ver adicionados" (abre a Biblioteca filtrada em "Adicionados esta semana"). O importador lembra o último launcher usado.
- Filtros da Biblioteca: seção "Origem" (Steam, Epic, GOG, ROM, Manual…), combinável com as demais; em Situação, "Vindos do Playnite" e "Com argumentos".
- Agrupar por "Origem" e ordenar por "Desenvolvedora". A busca também encontra pela loja de origem ("epic", "steam").
- Cartão: a dica ao passar o mouse mostra título completo, desenvolvedor, ano e horas jogadas; ROM sem gênero mostra o console na linha de baixo.
- Teclado: Delete remove da biblioteca o jogo selecionado (com confirmação); Ctrl+F abre a busca; F5 recarrega a biblioteca; Esc na busca limpa o texto. A lista de atalhos (?) foi atualizada.
- Caixa de busca mostra quantos jogos há na Biblioteca; o título da janela também.
- Jogar num jogo que já está aberto avisa e oferece "Fechar o jogo". Depois de apontar a pasta nova de um jogo, o aviso oferece "Jogar agora".
- Página de um jogo com arquivo não encontrado: botão principal vira "Apontar pasta…"/"Apontar arquivo…"; "Pasta" some quando a pasta não existe ou o jogo abre por link; a linha "Executável"/"Arquivo" continua visível para localizar o caminho antigo.
- ROMs com arquivo sumido abrem a página do jogo e o menu de contexto (antes a página ficava vazia); o menu traz "Apontar arquivo da ROM…".
- Menu de contexto: "Copiar caminho" (executável ou pasta) para qualquer jogo da biblioteca.
- Verificar jogos: aponta consoles com ROMs na biblioteca mas sem emulador instalado (botão "Abrir Emuladores"); pasta de trabalho configurada que não existe mais aparece com o botão "Limpar"; a seção mostra quando foi a última verificação.
- Aviso ao abrir sobre jogos com arquivo não encontrado ganhou o botão "Verificar jogos" e pode ser desligado em Ferramentas → Verificar jogos → "Avisar ao abrir".
- Diagnóstico: linha "Biblioteca" detalha PC/ROMs/importados do Playnite; "WebView2 Runtime" diz se o motor é o embutido ou o do sistema (também em Sobre → "Motor da janela"); linha "Interface" com tema, navegação, animações e erros de interface da sessão. Erros de JavaScript passam a ir para o log.
- Exportar biblioteca (CSV): colunas PlayCount, LastActivity, Source e Notes.
- Aviso "Capas e informações atualizadas" ao terminar uma busca em lote de metadados com mais de 3 jogos; avisos repetidos idênticos em menos de 2,5 s são suprimidos; o aviso de fim de sessão mostra o total jogado a partir de 1 h.

## 2.30.0 — 2026-10-04 — Inventário
- Jogos abertos por link de loja: qualquer esquema vale (Ubisoft Connect, EA app, Battle.net, Amazon Games, itch.io…). Antes só Steam, Epic e GOG abriam; os outros davam "Executável não encontrado". A página do jogo mostra "Abre por: Ubisoft Connect" em vez do caminho cru.
- Importação do Playnite traz os argumentos e a pasta de trabalho da ação de jogar (ex.: "-language brazilian" do Half-Life, Balatro via emulador Android). Antes se perdiam.
- Importação termina com um resumo: cada item ignorado aparece com o motivo e o caminho ("Arquivo não existe", "Console não identificado", "Emulador sem executável"), com botão para copiar a lista. Antes era só um número no aviso.
- Jogar num jogo cujo executável ou ROM sumiu abre um diálogo com o caminho e as saídas: apontar a pasta/arquivo novo, remover da biblioteca ou não fazer nada. Antes era um aviso genérico. Apontar o arquivo novo de uma ROM passa a valer de verdade (a lista de ROMs também é atualizada).
- Jogos com arquivo sumido ficam visíveis: faixa "NÃO ENCONTRADO" no cartão, filtro "Arquivo não encontrado" em Situação, contagem na linha da Biblioteca ("· 2 não encontrados", clicável) e um aviso ao abrir o launcher com "Ver quais". ROMs que sumiram continuam listadas (antes desapareciam em silêncio).
- Verificar jogos: botão "Remover todos da biblioteca" quando há mais de um jogo não encontrado, com confirmação. Nenhum arquivo do disco é tocado.
- Busca na Biblioteca ignora acentos e procura também em desenvolvedor, gênero, console, ano e loja de origem ("switch", "nintendo", "corrida", "2016"). Várias palavras = todas precisam bater, em qualquer ordem.
- Depois de uma importação, capas e informações são buscadas primeiro para os jogos mais jogados e jogados há menos tempo.
- Página do jogo indica "Arquivo não encontrado" no lugar de "Instalado" quando o executável sumiu.
- Tema Padrão e temas de arquivo: a caixa de progresso (leitura de importação, fila de downloads) ficava achatada e o botão sobrepunha a barra — a regra de altura mirava um elemento que não existe. A barra fina passa a valer na barra em si; a caixa mantém a altura normal mesmo com temas antigos instalados.

## 2.29.0 — 2026-10-04 — Motor
- Importação do Playnite: bancos recentes gravam o tipo da ação como texto ("File", "Emulator", "URL") e o importador só reconhecia números — todo jogo de PC entrava sem executável e o Ludrix tinha que adivinhar o .exe pela pasta. Agora usa exatamente o executável configurado no Playnite. Caminhos com barra dupla corrigidos; pastas "ROMS - 3DS", "ROMS - SWITCH" etc. identificam o sistema; jogos da Epic, GOG, Ubisoft, EA, Battle.net e Amazon sem executável entram com o atalho de abertura da loja; nomes vêm exatamente como estavam no Playnite (travados contra renomeação automática).
- Capas: o tempo jogado não é mais cortado ("150 h" aparecia como "15C"); em cartões estreitos o desenvolvedor some antes do gênero em vez de os dois virarem "…".
- WebView2 embutido no pacote (Fixed Version, `runtime/webview2/`): a janela não depende mais do WebView2 nem do Edge instalados no Windows. O build baixa, confere (sha256) e enxuga a versão fixada em `tools/webview2.json` (idiomas extras, Widevine, PDF, Copilot, WebGPU removidos; ~420 MB). Diagnóstico mostra a versão embutida.
- Janela: o WebView2 passa a ser localizado pela pasta de instalação quando não consta no registro do Windows; sem isso a janela abria com o motor antigo (MSHTML) e a interface aparecia sem estilo. Se o WebView2 não existir, aviso com o link de instalação.
- Tipos de arquivo da interface (CSS, JS, fontes) fixados no servidor; não dependem mais do registro do Windows.

## 2.28.0 — 2026-10-04 — Vigia

- Clicar numa capa da Biblioteca que não estava entre os cinco sorteados fazia o Destaque piscar e voltar para o jogo sorteado em vez de mostrar o jogo clicado. Agora o Destaque mostra o jogo selecionado; o carrossel dos cinco retoma sozinho depois de 25 segundos.

- "Corrigir nomes automaticamente" ficou mais exigente: só renomeia quando o nome encontrado bate de verdade com o atual (mesmo título, mesma numeração — "Portal 2" nunca vira "Portal", "Eta Seven" nunca vira "ETA"). Em dúvida, mantém o nome e deixa as opções em Editar. Capa, descrição e demais informações continuam sendo buscadas normalmente.

- Formas flutuando ao fundo passam a vir em "Leve" (menos formas, mais lentas). Quem estava em "Completo" sem ter mexido vai para "Leve"; dá para voltar em Aparência › Efeitos.

- Fonte com arquivo sumido (JSON movido ou apagado) avisa uma vez só, com o nome da fonte e o caminho, e já oferece "Remover fonte", "Desativar" ou "Ignorar". Antes o mesmo erro reaparecia a cada carregamento.

- Verificação dos arquivos do launcher. Os pacotes passam a trazer a lista de arquivos da versão (`app/integrity.json`, com hash de cada arquivo). Ao abrir, o launcher confere a pasta `app`: se algo estiver faltando ou diferente, restaura a partir do pacote da própria versão guardado em `data/updates` (o atualizador passa a guardá-lo em vez de apagar) e avisa no sino. Se não houver pacote e o dano for em arquivo essencial, abre uma janela antes de tudo com a lista e as opções "Reparar com um pacote…" (abre o atualizador para escolher o .zip/.lxup da mesma versão), "Abrir pasta", "Continuar assim" e "Sair". Nunca mistura arquivos de outra versão. Em Ajustes › Sistema › Sobre há "Verificar arquivos" para conferir a qualquer momento, com "Reparar agora" quando há pacote guardado e "Reparar com um pacote…" (reinstala a mesma versão por cima).

- Controle na janela normal: LT/RT e o analógico direito rolam a página (lista, ficha do jogo ou diálogo aberto); Back volta à Biblioteca; LB/RB seguem a ordem das abas visíveis (abas ocultas são puladas); em listas suspensas e controles deslizantes, A entra no ajuste (contorno verde) e o direcional muda o valor, A ou B saem; botões de avisos (como "Remover fonte") entram na navegação; a legenda de botões mostra também LT/RT e Start; ao voltar da bandeja ou religar "Navegar com controle" a leitura do controle retoma sozinha.

## 2.27.0 — 2026-10-03 — Tema Padrão

- **Launcher mais leve na cara Temperado.** Capas, botões, chips, busca, painéis de Ajustes, barra lateral e barra de status usavam vidro desfocado (desfoque do que está atrás) — dezenas de desfoques recalculados a cada quadro por cima das formas flutuando, o que engasgava rolagem, troca de aba e até mover a janela. O desfoque ficou só em menus, pop-ups e janelas de diálogo; as superfícies ganharam um pouco mais de corpo pra manter o visual de vidro. Selos e badges das capas também perderam o desfoque. Na medição interna, a rolagem da Biblioteca com 40 jogos foi de 28 para 59 quadros por segundo.

- **Destaque da Biblioteca bem mais baixo.** O banner do jogo em foco ocupava uns 330 px (quase metade de uma janela comum) com título gigante e três linhas de descrição. Agora fica em torno de 160–200 px: título em tamanho de cabeçalho, uma linha de descrição, mesmas etiquetas, botões e bolinhas de troca, arte do jogo preservada ao fundo. A grade de capas aparece sem rolar.

- Nova cara **Padrão**, a que vem de fábrica: painéis sólidos de cantos curtos, verde-água só nos botões e no que está selecionado, títulos em caixa-alta. Sem desfoque e sem nada animando no fundo — roda a 60 fps parado e rolando. Quem usava o Temperado passa para a Padrão automaticamente (o Temperado continua disponível em Aparência).

- Notificações passam a aparecer no canto superior direito, logo abaixo da barra de busca, em qualquer posição de menu.

- Textos da interface revisados: títulos de opções dizem o que elas fazem ("Ao fechar a janela", "Ao abrir um jogo"), sem frases de propaganda nem o launcher falando em primeira pessoa. "Cara" virou "tema" em Aparência e no tour; mensagens de resultado ficaram diretas ("Nenhum executável na pasta do jogo"). Tradução em inglês acompanhada.


## 2.26.0 — 2026-10-02 — Parallax

- **Botões do assistente de boas-vindas sumiam em janela baixa.** Na etapa "Com que cara?" (e em qualquer etapa com conteúdo alto), o passo crescia além da janela e empurrava Voltar / Pular configuração / Continuar para fora da tela, sem barra de rolagem. Agora o conteúdo rola e os botões ficam sempre visíveis embaixo.
- **Ajustes com a cara Temperado: textos colados na borda dos painéis.** Os painéis da Temperado ganharam borda e fundo, mas não o recuo interno — títulos, descrições e linhas divisórias encostavam na moldura (visível em Aparência). Agora todo painel tem respiro interno e espaço entre um e outro.
- **Abas de "Editar detalhes" grudadas.** GERAL, MÍDIA, LINKS, INSTALAÇÃO… ficavam coladas umas nas outras, sem separação. Agora têm o mesmo espaçamento das abas do resto do app e quebram linha em janela estreita.
- **Fundos vivos removidos; entra o Parallax.** O motor de partículas da 2.25.0 (galáxia, lava, lasers, circuito, neve) redesenhava a tela inteira o tempo todo e, somado aos painéis de vidro, deixava o launcher lento — foi retirado por completo. No lugar, um recurso leve: temas podem trazer o fundo em camadas (`parallax` no theme.json), e as camadas deslizam de leve acompanhando o mouse, dando profundidade sem nenhuma animação rodando sozinha. Interruptor em Ajustes › Aparência › Efeitos › Parallax (só aparece com um tema que usa; "Reduzir movimento" também desliga). Temas antigos com `live` continuam funcionando, só sem o fundo animado.
- **Magma, Laser, Circuito e Nevasca refeitos com parallax.** Mesma cara, agora com três camadas de imagem (fundo, meio e frente) em vez de canvas; animações contínuas (botão Jogar, LED da aba, brilho do painel) passaram a acontecer só ao passar o mouse; capas, botões e busca deixaram de usar vidro desfocado. Pack atualizado em `Ludrix-Temas-Parallax.zip` — reimportar substitui os antigos.
- **Ícone na barra de tarefas do Windows.** O Ludrix passa a registrar sua identidade antes de abrir a janela e aplica o ícone Cristal (e o Vidro no Console) também na classe da janela, nos tamanhos que o Windows realmente usa em cada escala de tela. Se um ícone antigo ainda aparecer, é o cache de ícones do Windows ou um atalho fixado antigo — desafixe e fixe de novo.

## 2.25.0 — 2026-10-02 — Fundos vivos

- **Fundos vivos para temas.** Um tema pode pedir um fundo desenhado ao vivo (`"live"` no theme.json) em vez de imagem parada: galáxia de partículas em espiral com núcleo e poeira, rachaduras de lava pulsando com fagulhas, brasas subindo, feixes de laser varrendo, placa de circuito com pulsos de energia correndo pelas trilhas, nevasca com vento que muda de direção, ou as capas da sua própria biblioteca caindo em cascata. O fundo acompanha o mouse (parallax), dá um impulso ao trocar de aba (a galáxia gira, a lava acende, os lasers disparam, o circuito recebe uma descarga, a neve vira rajada), e é leve: no máximo 30 quadros por segundo, pausa sozinho quando a janela perde o foco ou fica escondida, reduz pela metade em Animações "Reduzidas" e vira uma imagem parada em "Desligadas". Temas sem isso não carregam nada.
- **Temas que reagem ao mouse.** Um tema pode pedir (`"pointer": true` no theme.json) para receber a posição do ponteiro em cada capa, botão, aba e destaque (`--mx/--my` em porcentagem e `--px/--py` em pixels, mais `--gx/--gy` com a posição na janela inteira, para fundos que acompanham o mouse). Com isso um tema consegue fazer brilho de foil holográfico que acompanha o mouse, borda que acende só onde o ponteiro está, holofote no destaque — tudo sem JavaScript no tema e sem nada se mexendo sozinho. Quem não usa um tema desses não sente diferença nenhuma.
- **Modo Console mostra o download no topo.** Enquanto algo baixa ou instala, uma pílula ao lado do relógio mostra a porcentagem, o que está acontecendo (Baixando, Extraindo…) e o nome do jogo — em qualquer aba, com a barrinha andando. Dá para chegar nela pelo controle (para cima até o topo) e apertar A para abrir a Fila; quem não quiser, desliga em Ajustes › Tela › "Download no topo".
- **Fila do Modo Console ao vivo e com ações.** A lista atualiza a cada poucos segundos sem perder a seleção, mostra velocidade e tempo restante, e apertar A num item abre as opções: Pausar ou Cancelar o que está em andamento, Continuar o que foi pausado, Tentar de novo o que falhou, e Jogar ou ver Detalhes do que já terminou. Ao concluir, aparece o aviso "Pronto para jogar" com um toque no controle.

- **Temperado é a cara padrão do Ludrix.** O tema do gabinete gamer visto pela lateral de vidro temperado deixou de ser um estilo importado e virou a primeira cara em Ajustes › Aparência — já vem ligada e agora existe em **escuro e em claro** (o claro é vidro branco com a mesma fita de luz). As cores de fábrica são azul pastel, lavanda e roxo sobre o preto — o destaque principal é o azul pastel. Quem estava na Grafite passa para a Temperado; a Grafite continua na lista para quem preferir. Fonte continua a Rubik.
- **Fita de luz com as suas cores.** Em Aparência, logo abaixo das caras, a linha "Fita de luz" deixa trocar as três cores da fita que desce pela barra, dos contornos acesos (ícone ativo, cartão em foco, abas, interruptores) e do botão Jogar: conjuntos prontos (Oceano, Fogo, Aurora, Gelo, Azul puro) ou cada cor à mão, com prévia na hora e botão Padrão para voltar.
- **Minecraft Java sem launcher agora entra na Biblioteca.** Quando existe a pasta `.minecraft` mas nenhum launcher, o jogo passa a aparecer normalmente (antes ficava invisível por não ter executável), com o selo "SEM LAUNCHER" na capa e um aviso no sino explicando que falta um launcher. Ao clicar em Jogar, o Ludrix oferece o Prism ou o oficial. Se um launcher estiver instalado, ele é usado como executável do jogo; se for instalado depois, o Ludrix troca sozinho na próxima abertura e avisa.

## 2.24.0 — 2026-10-02 — Coleções

- **Baixar ROMs com seletor de console.** A fileira de botões por console (que estourava a largura com muitas fontes) virou um menu suspenso, igual ao de categorias da Store: mostra o console escolhido e a contagem, e abre a lista completa com os números de cada um.
- **Escolha onde baixar as ROMs.** Ao clicar em Baixar numa ROM, o diálogo passa a mostrar a pasta de destino e deixa trocar: a pasta padrão do console, qualquer pasta de ROMs que você já apontou ou "Baixar em outra pasta…". Marque "Usar sempre esta pasta para <console>" para fixar o destino daquele console; no cartão do console, "Baixar em…" muda ou volta ao padrão. Qualquer pasta escolhida passa a ser lida pelo emulador.
- **Instalar de disco (ISO/BIN+CUE) esperava errado.** O Ludrix montava a imagem e abria o instalador, mas considerava "fechado" assim que o programa de abertura do disco passava a vez para o instalador de verdade — aí dizia que não achou a instalação e desmontava o disco no meio, derrubando o instalador. Agora ele acompanha o instalador e tudo o que ele abrir (filhos, `msiexec`, descompactadores) e só se mexe quando não sobrar nada rodando. Se o instalador fechar antes de instalar — por conta própria ou porque você fechou —, avisa "instalação não concluída", desmonta a imagem e deixa o botão Instalar para tentar de novo. O mesmo acompanhamento vale para repacks comuns (setup.exe).
- **Duas listas definitivas: PC Collections e ROMs Collection.** O arquivo único misturado foi aposentado. `PC Collections.json` junta os acervos de PC (Rohankar, Danimasteer25, Ykaro, PC Redump, Old Games for Windows) e entra só na Store; `ROMs Collection.json` junta os acervos de emulação (ykaro, Velho bx retrogamer, Ultimate ROM Collection) e entra só em Emuladores › Baixar ROMs, com filtro e contagem por console. Cada jogo traz o próprio console na lista, então o Ludrix sabe o tipo de arquivo, instala em `emulation/games/<console>/` e nunca mistura ROM com a pasta de jogos de PC — se uma lista vier sem o console, ele deduz pela extensão (.chd, .cso, .gcz, .cdi, .nsp…). Jogos em vários discos (CD 1/CD 2) viram um único item com todos os arquivos. Nomes limpos (sem CAIXA ALTA, `_`, ™, "(PC)"), capa oficial quando reconhecida ou a do próprio item do archive.org. Ao adicionar uma lista, a tela de Fontes mostra quantos são de PC e quantos são ROMs, e o destaque da Store só sorteia jogos de PC.
- **"Limpar" nas notificações não limpava.** Quando havia um repack ou disco baixado esperando instalação, o aviso "instalador pendente" voltava sozinho logo depois de limpar (e "Marcar lidas" não tirava o número do sino). Agora Limpar esconde esses avisos e Marcar lidas os marca de verdade; o aviso só volta se o mesmo jogo for baixado de novo.

## 2.23.0 — 2026-10-01 — Boas-vindas

- **Ícone novo: Cristal.** O ícone do launcher passou a ser a gema facetada holográfica com o controle encravado no centro, usada como imagem (sem redesenho). Vale para o exe, a barra de tarefas, a bandeja, o canto da janela, a tela de boas-vindas e o Sobre. O Modo Console continua com o controle de vidro aceso.
- **Primeira abertura no Windows.** Antes das boas-vindas, o Ludrix baixa sozinho o que precisa (7-Zip, aria2) mostrando uma barra "Aguarde, últimos ajustes finais…" por cima de tudo; só depois entra o assistente, refeito em cinco passos curtos: boas-vindas (o que cada aba faz), onde guardar os jogos, com que cara (tema, cor e posição da barra), o que fazer quando um jogo abre e um "Tudo pronto!" com os primeiros passos (adicionar um jogo, ligar uma fonte, instalar um emulador). Setas do teclado passam os passos; dá para pular a qualquer momento.
- **Atalho na área de trabalho.** A caixa "Criar atalho na área de trabalho" que aparece quando um download fica pronto começa desmarcada, e o atalho passa a ser criado na Área de trabalho que o Windows informa (funciona quando ela está no OneDrive ou em outra pasta), com nome limpo e o ícone do próprio jogo.
- **Jogos em ISO e BIN/CUE.** Ao baixar um jogo de PC que vem como imagem de disco, o Ludrix monta a imagem com o próprio Windows (`.cue` vira `.iso` quando preciso), abre o instalador, espera ele terminar, acha a pasta instalada e oferece Jogar — tudo pela mesma janela do repack. Discos com faixas de áudio ou vários "tracks" pedem o WinCDEmu (gratuito, aberto); o Ludrix mostra o aviso, baixa o instalador e, se você preferir, monta só os dados sem ele.
- **Botão Jogar da janela de opções.** "Abrir o jogo" na janela "O que o launcher faz enquanto você joga?" não abria o jogo em alguns casos (ficava só a escolha salva). Corrigido; a janela também ganhou "Não fazer nada".
- **Modo Console: Fila e Ajustes com a cara da Biblioteca.** Os dois painéis viraram uma folha de vidro fosco sobre a arte do jogo em foco (desfocada, mas visível), com as abas fixas no topo. Os Ajustes cresceram: tamanho das capas na esteira, ordem dos jogos (A–Z, últimos jogados, mais jogados, adicionados por último), aba inicial, Verificar jogos e Atualizar capas direto do console, vibração do controle ao confirmar, relógio em 12/24 horas, escurecer a tela quando parado, backup automático dos saves, tela de abertura, confirmar antes de sair e Procurar atualização. A Biblioteca ganhou os botões Ordenar e Grade (todos os jogos em capas grandes) ao lado dos filtros de sistema e no menu de Opções. O console também usa a fonte nova.
- **Fonte Rubik.** Toda a interface trocou a Manrope pela Rubik (geométrica, mais legível em tamanhos pequenos e com acentos corretos); o Outfit segue nos títulos.
- **Início com cinco jogos sorteados.** O destaque da Biblioteca sorteia cinco jogos e passa por eles sozinho a cada 7 segundos; os pontinhos e o dado ao lado de "Me surpreenda" trocam a mão (o dado sorteia outros cinco). Clicar num jogo segura o destaque por um tempo. A opção "Passar os cinco sorteados sozinho" fica em Ajustes › Biblioteca. O desfoque da arte do jogo em destaque ficou mais leve, com a arte reconhecível.
- **Fontes: um só arquivo com todos os jogos.** Novo `Ludrix-Jogos.json` com os 2 326 jogos dos acervos (PC e ROMs) já listados um a um, com capa (arte oficial da Steam/GOG/libretro quando reconhecido, senão a melhor imagem da busca na web) e os arquivos de download — abre na hora, sem o Ludrix precisar varrer o archive.org. Jogos sem imagem nenhuma mostram "Game sem Imagem!" no lugar da capa.
- **Correções miúdas.** Trocar de categoria na Biblioteca ou na Store volta para a página 1; o "+" solto que aparecia no cartão da Fila sumiu; a etiqueta JOGANDO não é mais cortada perto do X vermelho; botões de janelas de confirmação com três opções quebram linha em vez de sair da tela; código repetido (instalação de repack, exportação de temas, regras de estilo duplicadas) foi unificado.

## 2.22.0 — 2026-10-01 — Console para todos

- **Pacotes de fontes com exclusões.** Um pacote `.json` de fontes agora pode dizer o que deixar de fora: `exclude` (lista de itens ou arquivos) e `exclude_re` (padrão) em qualquer fonte do archive.org, e `folder` para ler só uma pasta de um item. Com isso o `Ludrix-Fontes.json` reúne @rohankar, danimasteer25, ykaro, PC Redump e Old Games for Windows já sem jogos adultos, drivers, Windows, DLCs e afins — e um segundo pacote, `Ludrix-Fontes-Emuladores.json`, traz os dumps de console do ykaro para a aba Emuladores (PS1, PS2, PS3, PSP, GameCube, Wii, Wii U, Xbox, Xbox 360). Arquivos `.tar` passaram a contar como jogo.
- **Modo Console sem exigir controle.** O aviso "Nenhum controle conectado" sumiu — o Modo Console abre direto e funciona com controle, teclado ou mouse. Sem controle, a legenda do rodapé mostra as teclas (Enter, Esc, M, F, Tab, setas). A opção "Exigir controle" saiu dos Ajustes.
- **Tudo alcançável no Modo Console.** Seta para cima sai da esteira de capas e passa pelos botões Jogar/Detalhes/Opções, pelas abas e filtros de sistema e pela ficha e o botão de sair no alto; para baixo volta. O mesmo com o direcional do controle. Com o mouse, clique duplo numa capa abre o jogo, e as capas respondem ao passar o mouse.
- **Vários temas de uma vez.** Em Ajustes › Aparência › Importar tema, a janela de arquivos aceita selecionar vários `.lxtheme`/`.zip` ao mesmo tempo; no campo manual, um caminho por linha. O aviso no fim diz quantos entraram e quais arquivos foram ignorados.
- **Letras cortadas.** Títulos de cartões, destaques e banners tinham a parte de baixo das letras (g, j, p, y) comida pela fonte do Windows; o espaçamento de linha foi corrigido nesses pontos e a fonte padrão passou a ser a Segoe UI comum (a variante "Variable" entra só como alternativa).
- **Jogos de vários discos viram um só.** Em fontes de item do archive.org, arquivos "(Disc 1)", "(Disc 2)"… do mesmo jogo aparecem como um único jogo com todos os discos no download, e sufixos como `.nkit`/`.dec` saem do título.

## 2.21.0 — 2026-10-01 — Console novo

- **Ícone novo.** O LudrixHub passou a ser uma medalha perolada com o controle recortado em negativo — d-pad dourado e os quatro botões em menta, azul, dourado e coral — no mesmo quadrado escuro. Em tamanhos pequenos (bandeja, barra de tarefas) o desenho fica mais grosso para continuar nítido. O modo console ganhou ícone próprio: um controle de vidro escuro com o contorno e os botões acesos nas cores da pérola. Programa, janela, bandeja, atalhos, tela de abertura, atualizador, terminal e Sobre usam o novo desenho.
- **Modo console refeito.** A arte do jogo em foco ocupa a tela inteira, com transição suave ao mudar de jogo. No canto superior esquerdo fica uma ficha rápida (capa, horas jogadas, última vez) que abre os detalhes; no direito, relógio, controle conectado e o botão de voltar para a janela. Embaixo, o título grande com ano, estúdio e gênero, os botões Jogar, Detalhes e Opções, as abas em texto discreto e a prateleira de blocos largos com o jogo em foco maior e contornado. Em Recentes e Favoritos, o último bloco leva para todos os jogos. Fila e Ajustes abrem como um painel por cima da arte desfocada. Controle, teclado, busca, menus e temas do console continuam iguais — e a tela deixou de ser redesenhada a cada atualização em segundo plano.
- **Janela "Baixar jogo".** Ao clicar em Baixar na ficha, uma janela mostra o jogo, quanto espaço ele precisa, quanto você tem livre (fica vermelho se faltar), o tempo estimado na sua velocidade (medida nos downloads anteriores) e onde ele vai ser instalado, com a opção de escolher outra pasta — tudo com a ficha do jogo continuando atrás. Não aparece quando o download vai para o navegador ou para um programa de torrent externo.
- **Progresso na barra de tarefas.** Enquanto baixa ou instala, o ícone do Ludrix na barra de tarefas do Windows mostra o andamento (a barrinha verde), como fazem os navegadores; some sozinho quando termina.
- **Temas Lente, Bisel e Cubo na janela sem moldura.** Os três cobriam a barra da janela quando a ficha de um jogo abria — os botões de fechar e minimizar sumiam. Corrigidos nos pacotes de temas (é preciso baixar o pacote de novo e reimportar os três) e, por garantia, a barra da janela agora fica sempre por cima da ficha, da tela de boas-vindas e dos jogos Flash, com qualquer tema.

## 2.20.0 — 2026-10-01 — Cara nova

- **Ícone novo e cor nova.** O LudrixHub ganhou um ícone próprio — um leque de cartas com o play na da frente — e trocou o laranja pelo cinza-azulado em todo canto: ícone do programa e da janela, bandeja, tela de abertura, janela do atualizador, modo console e a cor de destaque padrão (face Grafite e preset Noite). Em tamanhos pequenos, como na bandeja, o ícone usa um desenho simplificado para continuar nítido.
- **Atualizações e temas assinados.** Todo pacote de atualização agora traz a assinatura do Ludrix, e o launcher recusa qualquer pacote sem ela ou que tenha sido alterado — tanto ao baixar quanto ao escolher um arquivo à mão. Ao voltar para uma versão antiga a partir de um zip de código-fonte, o atualizador mostra se ele é assinado ou não e deixa você decidir. Temas `.lxtheme` assinados aparecem com um escudinho verde ao lado do nome (tema oficial); os 42 temas distribuídos já saem assinados.
- **Abre mais rápido.** A tela de abertura sai do caminho assim que o Ludrix está pronto — antes ela ficava quase dois segundos parada mesmo com tudo carregado — e os arquivos da interface passaram a ser entregues já compactados e guardados em memória. Abrir o launcher ficou cerca de 1,4 s mais rápido.
- **Tema só muda no clique.** Passar o mouse sobre um tema ou uma face em Ajustes › Aparência não aplica mais a prévia na tela inteira; o visual só troca quando você clica.

## 2.19.2 — 2026-10-01 — Toque nos cartões

- **Cartões com resposta ao mouse.** Ao passar o mouse sobre um jogo na biblioteca, a borda do cartão ganha um tom da cor de destaque e uma sombra curta por baixo, além do leve movimento que já existia; a busca e os botões passaram a animar só o que muda (borda, fundo, sombra), sem transições genéricas.
- **Canto inferior esquerdo limpo.** Sumiu a pecinha que aparecia no canto inferior esquerdo da janela sem moldura, em qualquer tema — era a alça de redimensionar herdando o visual do interruptor dos Ajustes.
- **Pacotes de temas.** `Ludrix-Temas.lxtheme` passou a trazer 42 temas — os 16 clássicos escolhidos (Aço, Análogo, BIOS Azul, Bloco Verde, Caldeira, Faixa, Fósforo, Geist, Grama, Líquido, Luna Nova, Oficina 2004, Ponto, Telão, Uma UI, Vidraça) e 26 novos (Vitral, Convés, Mica, Baía, Nexo, Lente, Poltrona, Bioma, Prancheta, Bisel, Cubo, Ponte, Camadas, Alma, Cartaz, Abas, Lombada, Linha, Pausa, Temperado, Relevo, Diagonal, Dupla, Orla, Escovado e Moldura). `Ludrix-Temas-Soltos.zip` traz os mesmos 42 como arquivos individuais, com capturas e catálogo.

## 2.19.1 — 2026-09-30 — Menu do botão direito

- **Menu de contexto refeito.** O menu do botão direito sobre um jogo abre com a capa, o nome e a situação do jogo no alto, o botão Jogar em destaque com o ícone num quadrado verde, itens mais espaçados com ícones que ganham a cor de destaque sob o mouse, cantos de 16 px, vidro fosco mais denso e uma animação curta de entrada. O menu do Ludrix passou a ser o padrão em toda parte; "Menu do Windows" continua em Ajustes › Aparência para quem preferir.
- **Fontes dos temas importados.** Ao importar um `.lxtheme`, os arquivos de fonte (.woff2/.woff/.ttf) e imagens soltas que o tema traz passaram a ser copiados junto — antes eram descartados e o tema abria com a fonte padrão.
- **Pacote Ludrix Temas.** Os 40 temas passaram a vir num único arquivo, `Ludrix-Temas.lxtheme` (Máquinas 21, Nítido 8, Lugares 11), e todos foram revisados na tela de detalhes rolada, que em vários deles perdia o fundo e virava um bloco da cor do tema.

## 2.19.0 — 2026-09-30 — Temas que mudam tudo

- **Temas importados no claro ou no escuro.** Em Ajustes › Aparência, "Claro ou escuro" passou a valer também para estilos importados: *Como o tema foi feito*, *Sistema*, *Escuro* ou *Claro*. Um tema feito escuro pode ser usado claro (e vice-versa) — o Ludrix recalcula fundo, texto, linhas e cores de aviso a partir da paleta dele; quem faz temas pode trazer a paleta alternativa pronta (`vars_light`/`vars_dark` no theme.json).
- **Temas com mais poder.** Um tema agora pode pôr a busca dentro do menu lateral ou na barra de título (`search`), mostrar o nome das áreas na barra de baixo (`nav_labels`) e trazer as próprias fontes (.woff2/.woff/.ttf). As regras do menu escritas pelo tema passaram a valer sobre as do launcher, então barras, lâminas, slots e botões redondos aparecem como o tema desenhou.
- **Ícones de uso geral refeitos.** Os quarenta e poucos ícones espalhados pelas telas — abas de Ajustes, botões, menus, avisos, Fila — saíram do desenho antigo e passaram para a mesma família dos ícones da navegação (traço uniforme, nada cortado). A chave inglesa de Ferramentas, o disquete, o relógio e os demais ficaram nítidos em qualquer tamanho.
- **Menu de contexto de vidro fosco.** O menu do botão direito voltou a ser translúcido com desfoque, borda fina, sombra suave e o item sob o mouse tingido com a cor de destaque (verde para Jogar, vermelho para Remover).
- **Pacote Máquinas.** Onze temas novos, cada um refazendo a interface de um jeito próprio — Fósforo, Vidraça, Telão, Luna Nova, Lâminas, Grama, Caldeira, Oficina 2004, Uma UI, Disco Um e Cruz Três — distribuídos à parte, em `Ludrix-Temas-Maquinas.lxtheme`.

## 2.18.0 — 2026-09-29 — Barra enxuta

- **Navegação: cinco jeitos, todos no mesmo desenho.** Em Ajustes › Aparência › Navegação: *Seguir o tema*, *Ícones à esquerda* (a barra fina padrão), *Lateral* (menu largo com nomes), *No topo* (abas) e *Embaixo* — uma barra colada ao rodapé, de altura média, só com ícones e o traço laranja no item ativo. A barra de tarefas flutuante e o dock saíram; quem os usava (ou temas que os pediam) cai na barra embaixo sem precisar mexer em nada.
- **Miniaturas das caras.** Cada cara em Aparência mostra uma miniatura do próprio layout e dos cantos que ela usa; a Mono passou a viver com a barra embaixo.
- **Ícones da navegação refeitos.** Sete conjuntos novos, desenhados na mesma grade: Cheio, Linha, Duotom, Arcade (controle, saco de compras, portátil, quebra-cabeça, chip, fantasma), Pixel (arte de 8 bits) e as versões Colorido e Neon. Os conjuntos antigos foram removidos; temas importados que pediam um deles voltam ao padrão. Um tema também pode trazer os próprios ícones dentro dele.
- **Consoles com cara de console.** Em Emuladores, cada console tem um ícone plano colorido reconhecível — NES, Super Nintendo, Nintendo 64, GameCube, Wii, Wii U, Switch, Game Boy Advance, DS, 3DS, PlayStation 1 a 3, PSP, Mega Drive, Master System, Saturn, Dreamcast, PC Engine, Xbox, Xbox 360, Atari 2600, Arcade, DOS e PC.
- **Ponteiros do mouse removidos.** A opção "Ponteiro do mouse" e os cinco conjuntos de cursores saíram do launcher (menos 1 MB e menos trabalho por clique); o Windows volta a cuidar do ponteiro. Configurações e temas que os citavam são ignorados sem erro.

## 2.17.0 — 2026-09-29 — A cara do Ludrix

- **Identidade visual nova.** O Ludrix ganhou uma cara própria, desenhada de ponta a ponta: fontes Outfit (títulos) e Manrope (texto), cantos retos de 2 px, títulos grandes em caixa alta, botões vazados com um só botão preenchido por tela, abas sublinhadas em vez de pílulas e capas soltas, sem moldura nem cartão atrás. Tudo continua personalizável: caras, temas, estilos importados, cor de destaque, cantos e fonte em Personalizar seguem funcionando por cima.
- **Biblioteca começa pela arte.** O destaque abre em tela cheia no alto da página, com o nome do jogo grande, Jogar e Detalhes; os pontinhos trocam o jogo. Abaixo, "Minha biblioteca" com os contadores e as fileiras. Os cartões da grade ficaram só a capa, título e etiqueta — mais jogos por tela.
- **Detalhes em tela cheia.** A arte do jogo toma a largura toda atrás da capa e do título; quando o jogo só tem capa, o Ludrix gera uma arte desfocada a partir dela (fica guardada no cache, refeita se a capa mudar). Ajustes › Biblioteca › **Arte nos detalhes**: automática, sempre nítida, sempre desfocada ou sem arte.
- **Cara Grafite: menu de ícones à esquerda.** A cara padrão passou a usar a barra fina de ícones (64 px) com uma marca laranja no item ativo, no lugar da barra de tarefas flutuante. Quem preferir a barra embaixo troca em Ajustes › Aparência › Navegação — a escolha continua valendo por cima da cara. A descrição e a miniatura da cara acompanham.
- **Ajustes, Store, Emuladores, Central e Fila no mesmo desenho.** Cabeçalhos com o traço laranja, títulos em caixa alta, abas de Ajustes na coluna esquerda como uma lista com a barra de destaque, seções sem caixa cinza atrás, chips e menus suspensos em caixa alta espaçada, links de mods como botões vazados.

## 2.16.0 — 2026-09-29 — O caminho mais curto

- **Emuladores: os seus consoles primeiro.** Os consoles com emulador pronto ou ROMs na pasta ficam em "Meus consoles", no alto; os outros vêm abaixo em "Outros consoles", com botões discretos — só o que é seu chama atenção. Sem nenhum console configurado, a página abre com três passos curtos (escolher o console, trazer as ROMs, jogar pela Biblioteca) e destaca os consoles mais usados.
- **Store: filtro por fonte.** Com mais de uma fonte ligada, cada cartão mostra de onde o jogo vem (etiqueta pequena, na grade e na lista) e o painel Filtros ganha a seção "Fonte" — dá para ver só o catálogo de uma delas, combinando com categoria e situação. O título da lista acompanha o filtro.
- **Avisos com botão.** Quando algo termina, o aviso já traz o próximo passo: "Na fila" tem Ver Fila; jogos escaneados e pasta de ROMs têm Ver na Biblioteca; emulador, mod, dependência e programa instalados levam à aba certa; fonte adicionada abre a Store; tema exportado abre a pasta; atualização baixada abre Atualizações; Minecraft adicionado abre o jogo. O botão só aparece se você não estiver já na tela em questão.
- **"Comece por aqui" na Biblioteca.** Nas primeiras aberturas, um cartão com quatro passos — ligar uma fonte, trazer o primeiro jogo, escolher a aparência, conferir as dependências — cada um com o botão que leva direto lá. Marca sozinho o que já foi feito, some quando tudo estiver pronto e tem "Não mostrar mais" (volta em Ajustes › Geral › Orientação).
- **Contagens no singular e no plural.** "1 jogo no catálogo", "1 console pronto", "1 arquivo", "1 tema", "1 dia" — em vez de "1 jogos", "jogo(s)" e afins, na barra de status, cabeçalhos, Fila, importação, backup, temas e nos avisos. "Parar tudo" e o pacote de dependências também falam certo ("Instalar 1 que falta").

## 2.15.0 — 2026-09-29 — Cada tela com o seu botão

- **Detalhes do jogo: Jogar/Baixar sempre à mão.** Ao rolar a página até o botão principal sumir (janela baixa ou estreita), uma barra fina fica presa no topo com Voltar, a capa em miniatura, o nome e o mesmo botão — Jogar, Baixar, Abrir instalador ou o andamento do download, sem precisar voltar ao topo. Some sozinha quando o botão original volta a aparecer.
- **Central: Visão geral.** A Central abre num resumo com quatro cartões — Otimizar antes de jogar, Dependências, Programas úteis e Minecraft — cada um dizendo em uma linha o que é, como está agora (ligado/desligado, quantas faltam, quantos instalados, quais launchers achou) e um botão para resolver na hora; "Ver tudo" abre a aba completa. No alto, "Precisa de atenção" lista o que está pendente, ou "Tudo em ordem".
- **Toda tela vazia tem uma saída.** Biblioteca vazia (Abrir Store, Adicionar jogo, Importar de outro launcher), busca sem resultado (Limpar busca e filtros), Store e Emuladores sem fonte (Abrir Fontes, Adicionar jogo/ROM), Fila vazia (Baixar de link, Ir para a Store), Mods sem jogo ou sem mod (Instalar mod, Abrir pasta) e Rápidos (Baixar mais, Adicionar meu jogo) — todas com ícone, uma explicação curta e os botões certos, em vez de só texto.
- **Fila separada por situação.** Agora (baixando), Pausados (retome quando quiser), Precisam de atenção (falharam — tente de novo ou remova) e Concluídos, cada seção com a contagem; "Limpar concluídos" apaga só o histórico do que deu certo, deixando pausados e falhas. "Parar tudo" pergunta numa janela do Ludrix, não mais na caixa do navegador.
- **Atalhos de teclado.** Ctrl+1…9 troca de aba (na ordem da sua barra; Ajustes por último), Ctrl+, abre Ajustes, Ctrl+K busca, ? mostra a lista completa. Na Biblioteca, com um jogo selecionado: Enter joga (ou abre os detalhes se não estiver instalado), I abre os detalhes, F favorita. Nos detalhes, Enter aciona Jogar/Baixar. O balão "Precisa de ajuda?" tem o link "ver todos".

## 2.14.0 — 2026-09-29 — Ajustes arrumados

- **Ajustes reorganizados: uma pergunta por aba.** Geral (como o Ludrix se comporta), Aparência (como se parece), Personalizar, Biblioteca (como os jogos aparecem), **Ao jogar** (o que acontece ao abrir um jogo: saves, otimizar, emulador padrão, controle e Modo Console), **Store e downloads** (fontes, Store, instalação, torrent), **Ferramentas** e Sistema (PC, segundo plano, atualizações, sobre). O que estava fora do lugar mudou de aba — Modo Console e Controle saíram de Aparência/Geral, Fontes de jogos e as opções da Store saíram de Biblioteca, "Efeitos" voltou a ser só efeitos (janela, navegação e listas ganharam seções próprias). Atualizações e Sobre viraram seções de Sistema; o aviso de versão nova continua levando direto até lá.
- **Navegação de Ajustes.** Coluna lateral fixa com as abas e, abaixo, o índice das seções da aba atual — clique para ir direto; o índice acompanha a rolagem. A busca nos ajustes rola até a opção encontrada e a destaca, pulando de aba se preciso. Em janela estreita as abas viram uma faixa horizontal.
- **Menos ruído.** Interruptor "Opções avançadas" (chave SteamGridDB, jogos por página, velocidade do cursor, menus do botão direito, terminal) fica desligado por padrão e some das abas — a busca continua achando tudo. Cada aba tem "Redefinir esta aba", que volta só aquelas opções ao padrão, sem tocar em jogos, fontes, pastas ou temas.
- **Aba Ferramentas.** As ações saíram do meio dos interruptores: verificar jogos que sumiram, importar de outro launcher, exportar biblioteca, atualizar metadados de tudo, backup e restauração dos seus dados, diagnóstico e limpeza, cada uma no seu cartão.
- **Cabeçalho da Biblioteca e da Store enxuto.** Um botão **Exibição** reúne ordem, agrupar, grade ou lista e tamanho das capas; ficam soltos só Filtros, Me surpreenda e Adicionar. O painel de Filtros passa a ser só filtros.

## 2.13.0 — 2026-09-29 — Aparência 4: fundo, contraste e a Biblioteca como você quer

- **Fundo em degradê gerado.** Personalizar › Fundo: um fundo de cores suaves criado na hora, sem imagem — 7 combinações prontas (Aurora, Crepúsculo, Oceano, Brasa, Floresta, Neblina, Uva), "Da cor de destaque" (acompanha a cor escolhida) ou duas cores suas; forma em manchas, linear ou radial, com direção e intensidade. Fica atrás da imagem de fundo, se houver, e vai junto ao exportar como tema.
- **Alto contraste.** Aparência › Efeitos: bordas e textos mais fortes, sem transparência, desfoque, animação de fundo ou fundos decorativos; capa selecionada e foco de teclado bem marcados. Liga sozinho quando o Windows está em modo de alto contraste.
- **Fileiras na Biblioteca.** Ajustes › Biblioteca › Tela inicial: linhas horizontais acima de "Todos os jogos" com Continuar jogando, Favoritos, Adicionados há pouco e Mais jogados — ligue as que quiser e arraste para ordenar. Uma fileira só aparece quando tem jogos. Por padrão só Favoritos.
- **Estilo do Jogo em foco à sua escolha.** O destaque no alto da Biblioteca era fixo por aparência; agora dá para forçar qualquer um deles em qualquer aparência: painel com fileira de capas, banner largo com a arte, duplo (destaque + recentes) ou simples.
- **Relógio na barra de status.** Hora, ou dia e hora, no canto direito — útil com a janela sem moldura ou em tela cheia, quando a barra do Windows some. Desligado por padrão.
- Correção: em Personalizar, os seletores (animação de fundo, direção, estilo e forma da barra, barra de título, formato e rótulos dos cartões) sempre mostravam a primeira opção em vez da escolhida; as escolhas eram salvas, só apareciam erradas.

## 2.12.0 — 2026-09-29 — Aparência 3: a navegação e a Biblioteca do seu jeito

- **Abas da navegação: esconda e reordene.** Em Aparência › Abas da navegação, arraste para mudar a ordem e desligue as abas que você não usa (Mods, Central, Rápidos, Store, Emuladores, Fila). A Biblioteca fica sempre. Vale para todas as posições da barra; o que estiver escondido continua acessível pela busca e pelo menu do logo. "Restaurar padrão" volta tudo.
- **Biblioteca e Store agrupadas.** Agrupe por plataforma, categoria, letra inicial, última vez jogada (hoje, esta semana, este mês, há mais tempo, nunca) ou instalado/não instalado. Cada grupo tem cabeçalho com a contagem e recolhe com um clique; a ordenação escolhida vale dentro de cada grupo e o modo lista continua funcionando. No menu de ordenar e em Aparência › Listas.
- **Apresentação ao abrir um jogo.** Uma tela rápida com a capa, o nome e o fundo na cor da capa enquanto o jogo carrega — curta (2 s), longa (4 s) ou desligada. Clique ou Esc fecham antes. Em Aparência › Efeitos.
- **Efeito das capas ao passar o mouse.** Elevar (padrão), Inclinar em 3D acompanhando o mouse, Brilho na cor de destaque ou nenhum. E um interruptor "Reduzir movimento" que corta transições, formas flutuantes, animação do splash e efeitos das capas de uma vez — liga sozinho quando o Windows está com "Mostrar animações" desativado.
- **Detalhes do jogo.** A arte de fundo do cabeçalho pode ficar desfocada (como antes), nítida ou desligada; e, com "Cor de destaque puxada da capa" ligada, a tela de detalhes também adota a cor da capa do jogo aberto, voltando ao normal ao fechar.

## 2.11.0 — 2026-09-29 — Aparência 2: detalhes que fazem diferença

- **Informações no card.** Fitas "Novo" (instalado há menos de 7 dias e ainda não aberto) e "Hoje" (jogado hoje) nas capas, ligadas por padrão; selo opcional de tempo jogado no canto da capa; e, durante um download, uma barra de progresso fina na base da capa além do anel. Ajustes em Aparência › Listas.
- **Moldura do Windows no tom do tema.** No Windows 11, a barra de título nativa, o texto dela e a borda da janela seguem as cores do tema (e mudam junto quando você troca de tema ou de cor de destaque); dá para escolher os cantos da janela (padrão, arredondados, levemente arredondados ou retos). No Windows 10 só o claro/escuro acompanha. Com a janela sem moldura, vale para a borda fina e os cantos. Ajustes em Aparência › Layout; "Padrão do Windows" desliga.
- **Splash e ícone do seu jeito.** Personalizar › Splash e ícone: uma imagem sua no lugar do logo na tela de abertura e um ícone próprio para a janela e a bandeja (o Ludrix gera o .ico com todos os tamanhos a partir de qualquer imagem quadrada). Valem mesmo com a personalização desligada.
- **Barra de navegação some ao jogar.** Opcional: ao abrir um jogo, a barra se recolhe (funciona em todas as posições — embaixo, lateral, topo, dock e barra de tarefas) e volta quando o jogo fecha; encostar o mouse na borda mostra a barra no meio do jogo.
- **Capas como papel de parede rotativo.** Opcional, em Aparência › Jogo em foco: na Biblioteca, as capas dos jogos instalados passam devagar ao fundo (intervalo de 15 s a 5 min), com o mesmo desfoque e escurecimento do "Fundo acompanha o jogo". Pausa quando a janela não está visível.
- Correção: um interruptor fantasma aparecia acima do logo na tela de abertura (o quadro do splash usava a mesma classe do botão liga/desliga).

## 2.10.0 — 2026-09-29 — Aparência: o launcher com a cara do jogo

- **Modo lista na Biblioteca e na Store.** O botão ao lado do zoom alterna entre a grade de capas e uma lista com uma linha por jogo: capa pequena, nome, ano, gênero, tamanho, tempo jogado e última vez que abriu, com favorito e Jogar na ponta. A escolha fica guardada (também em Ajustes › Aparência › Listas).
- **Fundo acompanha o jogo em foco.** Em Ajustes › Aparência › Jogo em foco, o fundo do launcher passa a mostrar a capa (ou a arte larga, quando existe) do jogo selecionado na Biblioteca, com desfoque e escurecimento ajustáveis. Troca com uma transição suave e desaparece ao sair da Biblioteca. Desligado por padrão.
- **Cor de destaque puxada da capa.** Opcional: botões, seleção e abas mudam para a cor predominante da capa do jogo selecionado — calculada na hora, com brilho corrigido para continuar legível. Fora da Biblioteca volta a cor normal.
- **Fonte à sua escolha e tamanho do texto.** Personalizar › Cantos e fonte lista todas as fontes instaladas no Windows (cada uma mostrada com a própria letra) além dos estilos prontos. Em Aparência › Escala, "Tamanho do texto" tem 5 passos e mexe só nas letras, sem alterar o zoom do resto.
- **Claro/escuro por horário e prévia ao passar o mouse.** Com "Sistema" selecionado, dá para trocar "Seguir o Windows" por "Por horário" e definir das quantas às quantas o claro fica ativo. Nos seletores de cara e de estilos importados, parar o mouse sobre um card já mostra o launcher inteiro com aquele visual; tirar o mouse volta ao seu.

## 2.9.0 — 2026-09-29 — Robustez 2: nada se perde, nada fica preso

- **Atualização que não abre volta sozinha.** Ao aplicar uma atualização, o atualizador guarda a versão anterior e marca a nova como "a confirmar". Se o Ludrix não conseguir completar a abertura duas vezes seguidas logo depois, a terceira tentativa restaura a versão anterior antes mesmo de carregar a interface, reabre e avisa o que aconteceu. Uma abertura normal confirma a atualização e apaga a marca.
- **Verificar jogos e apontar pasta nova.** Em Ajustes › Biblioteca, "Verificar" confere se a pasta, o executável ou a ROM de cada jogo ainda existem e lista só os que sumiram. Para cada um: "Apontar pasta…" (ou "Apontar arquivo…" para ROM) atualiza o caminho sem perder capa, tempo jogado, favoritos e saves — o executável é procurado dentro da pasta nova; se não estiver lá, você escolhe. O menu do jogo também ganha "Apontar pasta nova…" quando a pasta se perdeu.
- **Exportar e importar meus dados.** Ajustes › Sistema › Meus dados gera um `Ludrix-dados-<data>.zip` com configurações, biblioteca, fontes, capas próprias, temas importados, jogos rápidos adicionados e cópias de saves. Importar mostra o conteúdo (data, versão, quantos jogos e temas) antes de aplicar; o estado atual é guardado em `data\updates\` e o Ludrix reabre com tudo restaurado.
- **Cópia dos saves ao fechar o jogo.** Depois de cada sessão (a partir de 45 segundos jogados), a pasta de saves é copiada para `data\save_backups` — só quando algo mudou, até 5 cópias por jogo, pulando pastas acima de 512 MB. Restaure em Saves, no menu do jogo. Desligável em Ajustes › Biblioteca › Saves.
- **config.json com valor errado não derruba mais o launcher.** Cada campo é conferido contra o tipo esperado ao abrir; o que estiver inválido volta ao padrão e o Diagnóstico mostra quais foram corrigidos.

## 2.8.0 — 2026-09-29 — Robustez: o exe se testa, o app se protege

- **O build testa o exe que acabou de compilar.** Depois de montar `release\<versão>\Ludrix\`, o `build.bat` abre `Ludrix.exe --selftest`: o programa precisa subir, servir a interface, responder às rotas principais e passar no diagnóstico. Se falhar, o zip é descartado e o build para com o relatório — nunca sai um exe que não abre. O `check` que roda antes de compilar também ficou mais forte: além da sintaxe, sobe o servidor interno por um instante, bate em todas as rotas principais e confere que a proteção de Host está ativa.
- **Modo seguro.** Se o Ludrix não conseguir completar a abertura duas vezes seguidas, a terceira abre com tema, efeitos, cursor, personalização e barra no padrão e avisa. Um clique em "Voltar aos meus ajustes" restaura tudo como estava — se voltar a travar, você já sabe que a causa está neles. Uma abertura normal (10 segundos com a interface no ar) zera o contador.
- **Diagnóstico em Ajustes › Sobre.** Uma tela confere: versão, pasta (avisa se estiver em Arquivos de Programas), permissão de escrita em `data/` e na pasta de jogos, espaço livre em cada disco, WebView2 Runtime, 7-Zip/aria2c/libtorrent, jogos da biblioteca com executável sumido, internet e modo seguro, mais as últimas 30 linhas do log. "Copiar tudo" põe o relatório na área de transferência para colar num chat ou e-mail.
- **Espaço em disco antes de baixar e antes de extrair.** O download só começa se houver espaço para o arquivo inteiro (mais uma folga) na pasta de downloads; a extração só começa se couber o conteúdo descompactado (tamanho real para .zip/.7z) na pasta de jogos. Em vez de falhar no meio, o aviso diz quanto falta e em qual disco.
- Saída do `--selftest` gravada em `data/selftest.txt` (o exe sem console não tem terminal); `python tools/build.py selftest` roda o teste sozinho.

## 2.7.1 — 2026-09-29 — Correção: menu do jogo acionava o item errado

- **No menu de contexto nativo (Windows), cada item disparava a ação de duas posições abaixo**: "Trocar emulador…" e "Trocar executável…" abriam o "Renomear", "Jogar" abria outra coisa, e assim por diante. O título do jogo e o separador inseridos no topo do menu deslocavam a numeração dos itens. O título agora entra depois de o menu estar montado, sem mexer na numeração — cada item faz exatamente o que diz.

## 2.7.0 — 2026-09-29 — Blindagem

- **Servidor interno mais fechado.** Só aceita pedidos vindos do próprio computador (endereço local); páginas abertas em outro site não conseguem mais falar com o Ludrix, mesmo com truques de redirecionamento de nome (DNS rebinding). Toda página do launcher sai com Política de Segurança de Conteúdo (CSP): nada de script externo, nenhum envio de dados para fora além do próprio Ludrix.
- **Jogos HTML5 dos Rápidos rodam isolados.** Passam a ser servidos de um endereço próprio, separado da interface, com sandbox no quadro do jogo: um jogo baixado da internet não enxerga a interface, os ajustes nem a chave interna do launcher. Progresso salvo pelo jogo (localStorage) continua funcionando.
- **Ajustes e biblioteca não se perdem mais.** Cada gravação de `config.json` e `library.json` é feita em arquivo temporário, forçada ao disco e guarda a versão anterior em `.bak`. Se o arquivo principal aparecer corrompido (queda de energia, disco cheio), o Ludrix abre a cópia anterior e preserva o arquivo estragado com o sufixo `.corrompido`.
- **Rede sem travas.** Todas as conexões do launcher (catálogos, capas, downloads, hospedagens) passam por uma sessão única com tempo-limite padrão: nenhuma requisição fica pendurada para sempre se o servidor do outro lado parar de responder.
- Pedidos com corpo inválido devolvem erro claro (400) em vez de erro interno; erros em threads de fundo vão para `data/ludrix.log` em vez de sumirem. Arquivos `.tar` ignoram links simbólicos e dispositivos ao extrair.
- **`build.py check`.** Novo passo do build (roda sozinho no `build.bat`): confere sintaxe de todo o código Python e JavaScript, valida cada catálogo JSON e a presença dos arquivos essenciais antes de compilar — se algo estiver quebrado, o build para com a lista do que falhou em vez de gerar um exe defeituoso.

## 2.6.2 — 2026-09-28 — Correção: temas com barra própria

- **Luna Moderna (e qualquer tema com barra de cor própria) voltou ao normal.** Na 2.6.1, o estilo de Barra de tarefas que os temas trazem vazava para a posição padrão do tema: a barra azul-royal do Luna Moderna ficava clara, com ícones brancos invisíveis. Corrigido na leitura do `extra.css` — o fundo de cada barra fica na posição a que pertence.
- **Temas agora conseguem mudar de verdade a caixa da Barra de tarefas** (borda, cantos, sombra, fundo): Bloco Verde fica com moldura reta de 3 px, Terminal Fósforo com borda verde quadrada, os de vidro com cantos amplos. Antes só a cor de fundo passava.
- Docas arredondadas (Zênite, Mica, Bolhas…) não mostram mais o fundo quadrado por trás dos cantos.

## 2.6.1 — 2026-09-28 — Barra de tarefas e busca no estilo de cada tema

- **As seis aparências do launcher ganharam a Barra de tarefas com a própria cara.** Grafite e Aurora em vidro arredondado; Ember e Neon em caixa reta com letras espaçadas e brilho; Duo em pílula redonda com a moldura azul pulsando no item ativo; Mono em preto e branco de linha fina. A barra de título integrada e o realce da busca (a marca nos itens encontrados e o aviso de "nada nesta aba") seguem o mesmo desenho em cada uma.
- **Temas importados podem estilizar a Barra de tarefas.** Regras com `body[data-layout=taskbar]` no `extra.css` valem quando a barra está ativa, mesmo que o tema use outra posição por padrão. Os dois packs (Level 1 e Premium) foram atualizados com isso: reimporte o `.lxtheme` para atualizar.

## 2.6.0 — 2026-09-28 — Busca inteligente

- **A busca entende em que aba você está.** O campo do alto muda de função conforme a aba: em **Ajustes** mostra só as seções e linhas que batem com o que você digitou (buscar "efeitos" traz a seção Efeitos inteira; "ícones da navegação" traz só essa linha) e, se não houver nada na aba atual, pula sozinho para a aba de Ajustes que tem o resultado. Em **Emuladores** filtra consoles e emuladores; na **Central**, **Mods**, **Rápidos** e **Fila** filtra os itens da tela. O que bate ganha uma marca na cor do tema; quando não há nada, aparece um aviso com "Limpar busca" e "Buscar nos jogos". Biblioteca, Store e ROMs seguem como antes. O texto de dica do campo muda de acordo com a aba, e a tecla **/** foca a busca onde ela estiver.
- **Barra de tarefas maior.** A pílula flutuante cresceu: ícones e nomes maiores, mais respiro entre os itens e cantos mais amplos — em qualquer aparência ou tema.
- **A busca não arrasta mais a janela.** Na barra de título integrada, o campo de busca, o logo e os botões da janela respondem ao clique sem mover a janela; arrastar continua valendo no restante da faixa.

## 2.5.0 — 2026-09-28 — Barra de tarefas

- **Nova barra "Barra de tarefas".** Uma pílula flutuante centralizada embaixo, com ícone e nome lado a lado, o item ativo destacado na cor do tema, ponto de aviso na Fila quando há download e vidro translúcido sobre o conteúdo. Em janelas estreitas ela mostra só os ícones. Passa a ser a barra padrão da aparência Grafite; as outras quatro (Embaixo, Lateral, No topo, Dock) continuam em Ajustes › Aparência › **Barra de navegação** e no menu do logo.
- **Barra de título integrada** (janela sem moldura + Barra de tarefas): logo, nome e versão à esquerda, busca centralizada, botões da janela à direita — tudo numa faixa só. O logo abre o menu do Ludrix; o botão duplicado que ficava na linha de baixo some nesse layout.
- Temas podem pedir esse layout com `"layout": "taskbar"` no `theme.json`.

## 2.4.0 — 2026-09-28 — Temas mandam no menu e no ponteiro

- **Ponteiros do mouse.** Em Ajustes › Aparência › **Ponteiro do mouse** há cinco conjuntos de código aberto conhecidos — **Bibata**, **Phinger**, **Catppuccin**, **GoogleDot** e **Nordzy** —, no tamanho normal do Windows, nítidos em telas HiDPI, e cada um na versão clara ou escura conforme o fundo do tema. Valem só dentro do launcher; redimensionar, texto e os demais continuam coerentes. **Padrão do Windows** mantém tudo como era. Créditos e licenças em `app/ui/cursors/LICENSES.txt`.
- **Ponteiro de carregamento ao abrir um jogo.** Ao clicar em Jogar, o ponteiro ganha o indicador girando, como nos sistemas operacionais, (animação original de cada conjunto) e volta ao normal assim que o jogo é aberto (ou na hora, se algo impedir). Com o ponteiro do Windows, o indicador é o do próprio sistema.
- **Temas podem escolher o menu do botão direito e o ponteiro.** Um tema pode pedir o Menu do Ludrix (e estilizá-lo por completo pelo `extra.css`, classe `.ctx`) e sugerir um dos cinco ponteiros. Para criadores de temas: chaves `"menu": "ludrix"` e `"cursor": "bibata|phinger|catppuccin|googledot|nordzy"` no `theme.json`. Suas escolhas em Ajustes continuam mandando por cima do tema: as duas opções ganharam **Seguir o tema**, que agora é o padrão.
- **Pack Premium atualizado.** Os 25 temas Premium passam a ter menu de contexto próprio (afiado, neon, terminal, pixel, vidro ou suave, conforme o visual) e ponteiro combinando. Basta importar o `.lxtheme` de novo; os temas já importados são substituídos.

## 2.3.4 — 2026-09-28 — Menu do Windows

- **Menu do botão direito agora é o menu nativo do Windows** — o mesmo do Explorer: abre no shell, sem janela nova, sem ícone na barra de tarefas, instantâneo, e passa da borda do launcher quando precisa. Segue o claro/escuro do tema em uso, tem submenus, atalhos alinhados à direita, item principal em negrito e o nome do jogo no topo. A janelinha própria da 2.3.2/2.3.3 foi removida. Em Ajustes › Aparência › **Menus do botão direito** dá para escolher **Menu do Ludrix** (dentro da janela, com ícones e cores do tema).

## 2.3.3 — 2026-09-28 — Menu que sumia

- **Menu do botão direito piscava e sumia.** A janela do menu era fechada pelo próprio Windows assim que o conteúdo recebia o foco (comportamento do WebView2 dentro de uma janela). Agora o menu só fecha quando o foco vai de fato para outra janela, quando você clica fora, rola, aperta Esc ou escolhe um item. Se mesmo assim o menu fechar sozinho duas vezes seguidas, o Ludrix passa a usar o menu interno pelo resto da sessão e anota no log — sem deixar você sem menu.

## 2.3.2 — 2026-09-28 — Menus fora da janela

- **Menu do botão direito em janela própria.** No Windows, os menus de contexto (jogos, abas, temas, menu do Ludrix) abrem numa janelinha do próprio sistema, por cima de tudo: podem passar da borda do launcher e não ficam espremidos quando a janela está pequena, como nos programas nativos. Submenus abrem no lugar, com botão de voltar; setas, Enter e Esc funcionam; clicar fora, rolar ou trocar de janela fecha. Segue o tema, a cor de destaque e o Personalizar. Em Ajustes › Aparência › **Menus do botão direito** dá para voltar ao menu dentro do launcher; no controle e no modo Game o menu continua interno.

## 2.3.1 — 2026-09-28 — Screenshots na entrada

- **Screenshots baixadas na hora.** Assim que um jogo entra na Biblioteca (adicionado, baixado ou detectado), as três screenshots são guardadas em cache junto com a capa e as informações, sem esperar você abrir a ficha. Jogos só do catálogo continuam leves: para eles as imagens só vêm quando a ficha é aberta.

## 2.3.0 — 2026-09-28 — Ficha completa e temas afinados

- **Screenshots e Requisitos de verdade.** Jogos que saíram da Steam (ou que ela não acha pelo nome) ficavam com as duas abas vazias. Agora o Ludrix descobre o código Steam pelo Wikidata (a partir da página da Wikipedia) e, quando a loja não responde mais, lê a página arquivada no Internet Archive: as screenshots vêm da CDN da própria Steam e os requisitos mínimos/recomendados chegam traduzidos. Como reserva, a **PCGamingWiki** fornece requisitos (e o código Steam) e uma busca de imagens traz três screenshots de gameplay. Abas vazias mostram o que fazer: **Buscar de novo** ou **Procurar na web**.
- **Botões da ficha alinhados em qualquer tema.** As ações do jogo (Jogar, Pasta, Saves, Editar, remover, Origem, Favorito, "…", metadados) viraram uma grade de duas colunas que nunca corta texto nem vaza da coluna da capa, inclusive nos temas com a capa ao lado do título. Sem fundo grande, a ficha começa mais perto do topo.
- **Layout revisado.** Botões dos cartões de emuladores não quebram mais em duas linhas; caixas de texto fora de janelas (Central, editor) com o mesmo visual das demais; setinha em todos os seletores; contorno de foco discreto na cor do tema (sem o oval preto ao clicar em abas e botões); mensagens de lista vazia sem título no meio da frase.
- **Ajustes com seletores.** Tudo que era fileira de botões (ao abrir um jogo, ao fechar a janela, velocidade do controle, barra de navegação, escala, densidade, animações, tipo de ícones flutuantes, barra de status, jogos por página, downloads simultâneos, Modo Game e plano de energia, Personalizar) virou caixa de seleção. Fica mais limpo e cabe em telas menores.
- **Aparência › Estilos importados.** Temas claros e escuros aparecem juntos, em ordem alfabética, com três filtros em caixas de seleção: **claros/escuros**, **cor** (detectada pela cor de destaque) e **estilo** (Consoles, Sistemas, Vidro e brilho, Neon, Retrô, Natureza, Minimalistas). Cada cartão mostra uma bolinha com a cor do tema. "Apagar vários" pode marcar só os filtrados.
- **Ícones coloridos na barra.** Quatro conjuntos novos em Aparência › Ícones da navegação: **Colorido**, **Doce**, **Neon** (com brilho) e **Frutas**, cada aba com a sua cor. Um tema `.lxtheme` pode sugerir o conjunto (`"icons"` no `theme.json`); o que você escolher em Ajustes vale por cima, e há o botão **Seguir o tema** para voltar.
- Temas podem declarar `"category"` no `theme.json` para aparecer no filtro de estilo.

## 2.2.0 — 2026-09-28 — Casa arrumada

- **Pasta do programa organizada.** Ao lado dos executáveis ficam só `app/`, `runtime/` (oculta) e cinco pastas de uso: `data/` (ajustes, biblioteca, log e, dentro dela, cache, atualizações, ferramentas e utilitários), `games/`, `emulation/`, `downloads/` e `themes/`. As antigas `cache/`, `updates/`, `tools/`, `bin/`, `redists/` e `flash/` são movidas sozinhas para o lugar novo na primeira abertura (`data\cache`, `data\updates`, `data\tools`, `data\bin`, `downloads\redists`, `games\rapidos`), sem perder nada. Backups antigos continuam importáveis.
- **Pasta do código-fonte organizada.** O `build.bat` deixa tudo em `release\<versão>\` (pasta `Ludrix\` pronta, zip, código-fonte e pacotes `.lxup`), guarda os executáveis compilados em `build\exe` e apaga os temporários no fim (`--keep-tmp` mantém). Rodar do código não espalha mais `__pycache__`.
- **Minecraft por edição.** A Central descobre o que está no PC: **Java Edition** (pasta `.minecraft`, inclusive em outros discos: versões e mods contados) e **Bedrock Edition** (Microsoft Store). Cada edição entra na Biblioteca com o nome certo. Jogar no Java abre pelo launcher escolhido (seletor quando há mais de um); **sem launcher instalado o Ludrix não tenta abrir: mostra a recomendação** (Prism Launcher, código aberto, ou o oficial da Mojang) com Instalar, Microsoft Store, Site e "Já tenho". Bedrock abre direto; se não estiver instalado, oferece a Store. Entradas da 2.1 viram Java Edition sozinhas.

## 2.1.1 — 2026-09-28 — Correções do Personalizar

- **Personalizar:** todos os botões de escolha (o que flutua, direção, arredondamento, fonte, botões da barra, barra de título, barra de tarefas, formato da capa, nome do jogo) devolviam "'str' object has no attribute 'items'" e não aplicavam nada. Corrigido; o servidor também passou a aceitar o pedido em qualquer formato.
- **Central › Dependências:** o AGEIA PhysX v2.5.2 falhava com código 1603. Agora o instalador da NVIDIA roda em modo silencioso próprio (`/quiet`), e quando o Windows devolve erro mas o pacote já está no lugar, o Ludrix confere e dá como instalado. Códigos comuns (1603, 1618, 1602…) vêm com explicação.
- **Minecraft:** detecção também pelo registro do Windows (Programas instalados), para launchers instalados em pastas fora do padrão.

## 2.1.0 — 2026-09-28 — UX completo

- **Ajustes › Personalizar.** Cada detalhe do visual por cima de qualquer tema ou aparência: cores (fundo, painéis, barra, cartões, texto, linhas), opacidade e desfoque dos painéis, imagem de fundo (com opacidade, desfoque e escurecimento), arredondamento, fonte, conteúdo e formato dos botões da barra de navegação, tamanho e espaçamento dos ícones, barra de título (compacta/alta) e barra de tarefas interna, formato das capas e posição do nome nos cartões. O que não for mexido continua vindo do tema. **Exportar como tema** gera um `.lxtheme` com tudo (inclusive fundo e ícones) em `themes\exportados`.
- **Animação de fundo com os seus ícones.** Em Personalizar › Animação de fundo, escolha **Meus ícones** e adicione PNGs pequenos (64×64 é o ideal; até 24). Quantidade, velocidade, tamanho, opacidade, direção (sobem, caem, esquerda, direita, à deriva), giro e modo pixel art. Temas `.lxtheme` também podem trazer os próprios ícones (`fx/*.png` + bloco `fx` no `theme.json`).
- **Aparência reorganizada:** cor de destaque e posição da barra ficam logo abaixo dos temas, com atalho para o Personalizar.
- **Minecraft na Central Ludrix.** Nova aba lista os launchers do Minecraft (oficial pelo instalador ou Microsoft Store, Prism, MultiMC, PolyMC, ATLauncher, Modrinth, GDLauncher, CurseForge e SKLauncher): o que já está no PC é detectado sozinho ao abrir e o **Minecraft entra na Biblioteca**; Jogar abre o launcher escolhido (conta, versões e mods continuam nele). Instalar pelo winget, abrir a Microsoft Store ou o site, e **Localizar** para apontar um executável ou `.jar` (o Ludrix acha o Java). Desligue a detecção com `minecraft_auto`.
- **Ficha do jogo com abas:** **Sobre**, **Screenshots** (até três imagens, ampliáveis) e **Requisitos** (mínimos e recomendados). Vêm junto com os metadados, pela loja Steam quando o jogo é reconhecido, sem chave nenhuma. Imagens leves: capas em WebP até 720 px, miniaturas 300 px, screenshots 360 px, tudo em cache e contado em Ajustes › Sistema.
- Metadados: requisitos e textos da Steam em português do Brasil quando o idioma é pt-BR.

## 2.0.0 — 2026-09-27 — Aniversário

- **Servidor interno trancado.** Cada abertura gera uma chave nova que só a própria janela do Ludrix conhece; qualquer página ou programa que tente falar com o launcher sem ela recebe "proibido". O servidor passa a ouvir só o próprio PC (`127.0.0.1`); para abrir de outro aparelho da casa, `--web <porta> --lan`. Cabeçalhos de proteção, limite de tamanho no que chega, checagem de origem, caminhos de arquivos sempre dentro das pastas do Ludrix, extração que não segue links para fora, nomes de arquivo higienizados. Instalação que falha no meio não deixa pasta pela metade.
- **itch.io como fonte.** Um JSON pode apontar direto para a página de um jogo gratuito no itch.io (`usuario.itch.io/jogo`, opcionalmente `#upload=ID` ou `?os=windows`); o Ludrix resolve o link assinado na hora do download, com nome e tamanho reais. Capa do archive.org que vem como "Something went wrong" é descartada em vez de virar capa.
- **Rápidos virou biblioteca.** A aba mostra só os seus jogos rápidos prontos, em Meus jogos; o acervo Flash embutido foi para a sub-aba **Baixar mais**. Além de `.swf`, entram jogos **HTML5** (pasta ou `.zip` com `index.html`) e **jogos de site** (um endereço), que abrem numa janela própria do Ludrix com o título do jogo. Filtros por tipo, capa, edição e remoção iguais para todos.
- **Friday Night Funkin':** a versão oficial do Newgrounds já vem na lista de Rápidos (precisa de internet); a de PC, o clássico 0.2.7.1 e os motores Psych Engine e Codename Engine chegam pelo catálogo `Friday Night Funkin.json` (fora do código).
- **Mods › Meus mods.** Escolha um jogo instalado, aponte o `.zip`/`.7z`/`.rar` (ou uma pasta) do mod, e o Ludrix descobre onde ele se encaixa (raiz do jogo, `mods/`, `Data/`, `BepInEx/plugins`…), copia os arquivos e guarda cópia do que substituiu. Cada mod pode ser **desligado** (os originais voltam) e **religado** sem baixar de novo, ou removido de vez. A ficha do jogo mostra os mods dele e atalhos para Nexus, ModDB e GameBanana. Mods para FNF caem sozinhos na pasta `mods/` do Psych Engine.
- **Pacote de temas de aniversário** (arquivo `.lxtheme` à parte, dez estilos: Vitrine, Pulso, Arcádia, Orbital, Noturno, Transmissão, Arena, Neve, Retrô 95 e Bolo) com layouts, cartões e papéis de parede próprios, importável em Ajustes › Aparência › Estilos importados. Miniatura real de cada tema. O launcher em si não muda de cara.
- Inglês completo: todos os textos de ajuda, dicas e explicações das abas e dos Ajustes passam a ter tradução.
- Emulador personalizado: nome obrigatório e caminho conferido antes de salvar. Pequenos ajustes de layout nas abas Mods e Rápidos.

## 1.8.0 — 2026-09-27 — Fontes em JSON

- **O código não traz mais nenhuma fonte de jogos.** Saíram as coleções embutidas (rohankar, PC antigos, COD builds), os consoles do acervo Velho bx, a lista de sites de download e o código secreto que liberava tudo isso. As fontes agora chegam por arquivo `.json`: em Fontes, **Arquivo .json** escolhe um arquivo do PC, ou cole o link do `.json` e Analisar. Um arquivo pode trazer a lista pronta de jogos (com links diretos, torrent, capa, descrição e patches) e/ou fontes que o launcher lê sozinho (coleções e uploaders do archive.org, releases do GitHub, páginas, Telegram). Quando o arquivo traz várias fontes, **Adicionar tudo** entra com todas de uma vez.
- **Torrent só quando a fonte traz torrent.** Itens do archive.org não ganham mais o `.torrent` automaticamente; o botão aparece se o JSON trouxer `torrent`/`magnet` (ou `"torrent": true` na fonte). Jogos em partes podem marcar `prefer: "torrent"` e o torrent vira o botão principal, com "Baixar em partes" ao lado.
- **Patches e extras na ficha do jogo:** a seção lista o que o JSON trouxer (patch, fix, tradução…) e baixa para a pasta do jogo (ou `downloads/patches/`), abrindo a pasta no fim.
- Sobre: só o essencial — o que é o launcher, criador e versão. Fontes: texto mais curto.
- Código sem comentários nem docstrings; o estado técnico do projeto fica nos documentos fora do fonte.
- Catálogos oficiais (fora do código, atualizados à parte): `Rohankar Collection Games.json` (326 jogos, links diretos + torrent + capas), `Clearance Bin PC.json` (jogos de PC da coleção clearancebin_pc do archive.org, torrent preferido nos de partes, patches das descrições) e `recomp.json` (recompilações e ports nativos, sempre a última versão do GitHub).
- Ferramentas de build Linux (AppImage, install-linux.sh, run.sh) saíram do repositório; a versão Linux fica na 1.7.2.

## 1.7.2 — 2026-09-26 — Janela mais leve no Linux

- **Menos memória parada no Linux.** O motor da janela (Chromium do Qt WebEngine) subia com processo reserva, zygotes e serviços que o launcher nunca usa (tradução, roteamento de mídia, áudio em processo separado, atualização de componentes, cache de shaders em disco…). Agora ele abre em modo econômico: 2 processos em vez de 4 e menos memória, sem mudar nada na tela. Quem quiser comparar ou desligar isso: variável de ambiente `LUDRIX_QT_FULL=1`.
- O grosso do que o monitor do sistema mostra continua sendo o próprio Chromium (o servidor do Ludrix em si fica em ~55 MB); numa máquina virtual sem aceleração 3D o desenho por software soma mais uns 50 MB. É o mesmo patamar de outros launchers com interface web.

## 1.7.1 — 2026-09-26 — Rápidos sem travar o resto

- **Abrir Jogos Rápidos não deixa mais as outras abas em branco.** As capas dos jogos Flash eram buscadas no archive.org na hora em que a grade pedia cada imagem; com 54 capas e o archive.org lento, as poucas conexões que o navegador mantém com o launcher ficavam presas nisso e Biblioteca, Store, Ajustes etc. paravam de responder até acabar. Agora a grade recebe na hora só o que já está no disco, as capas que faltam são baixadas em segundo plano (até 3 por vez) e aparecem sozinhas conforme chegam.
- Cartões dos Jogos Rápidos: a linha de controles/tamanho não estoura mais para fora do cartão em telas mais estreitas.

## 1.7.0 — 2026-09-26 — Motor Windows

- **Jogos de Windows no Linux passam a abrir como no Heroic: umu-launcher + GE-Proton, num único prefixo compartilhado.** O umu sobe o Proton dentro do container da Steam (Steam Linux Runtime) e aplica as correções conhecidas por jogo; o Wine do sistema fica só como alternativa. O prefixo padrão é um só (`data/pfx`, "o de sempre") para todos os jogos — nada de uma pasta de 300 MB por jogo. Prefixo próprio só se você ligar na ficha do jogo.
- **Reaproveita o que já existe na máquina.** Antes de baixar qualquer coisa, o Ludrix procura o umu-run (pacman/AUR ou o que já estiver no PATH), o Proton (Steam, `compatibilitytools.d`, Heroic, Lutris, umu) e o runtime da Steam já baixado pelo umu (`~/.local/share/umu`). Só baixa o que faltar: o umu vem como um arquivo de 0,4 MB; o GE-Proton vai para a pasta padrão da Steam, onde Heroic e Lutris também o enxergam. "Atualizar GE-Proton" mantém uma versão só das que o próprio Ludrix baixou — as suas nunca são apagadas.
- **Primeiro Jogar num `.exe` pergunta "Preparar pra jogos de Windows?"** com o que vai baixar e o tamanho; aceita, acompanha na Fila e o jogo abre sozinho no fim. Ou "Usar o Wine do sistema", ou "Não fazer nada". Quando o prefixo ainda não existe, o Ludrix avisa que a primeira abertura demora um pouco.
- **Ajustes › Sistema › Motor Windows:** estado de cada peça (umu, Proton, runtime, prefixo), Preparar, Atualizar GE-Proton, **Instalar componente…** (Visual C++, .NET, DirectX 9, XACT, Media Foundation, fontes… via winetricks, com campo livre), Testar, winecfg, Pasta do prefixo, Limpar temporários e o espaço que cada coisa ocupa. Em Avançado: Automático / Proton direto / Wine, versão do Proton, apontar um prefixo já existente (do Heroic ou Lutris, por exemplo) ou recriar, camadas padrão (DXVK, VKD3D, Protonfixes, GameMode, MangoHud) e variáveis extras.
- **Ficha do jogo › aba Windows** (só no Linux, só pra `.exe`): prefixo (o de sempre / próprio / outra pasta), Proton só deste jogo, cada camada em Padrão / Ligado / Desligado, variáveis, ID no banco do umu, e os mesmos botões de componentes, winecfg e teste — agindo no prefixo daquele jogo.
- Processos de jogos, umu e Proton recebem o ambiente original do sistema (o AppImage não passa mais adiante as bibliotecas e variáveis que só servem ao próprio Ludrix). Extração de Proton com o `tar` do sistema (preserva links e permissões). Nada muda para quem usa Windows.

## 1.6.0 — 2026-09-23 — Linux

- **O Ludrix roda no Linux** (Arch/CachyOS, Fedora, Ubuntu e outros). Mesmo código, mesma biblioteca, mesmos temas: `sh install-linux.sh` prepara tudo numa pasta própria (`runtime/`), testa se o motor da janela carregou e cria os atalhos "LudrixHub" e "LudrixHub — Modo Console" no menu; `sh run.sh` abre. A janela usa o Qt WebEngine (Chromium) com a moldura do próprio sistema. Se algo impedir de abrir pelo menu, aparece uma janelinha com o motivo (e fica em `data/run.log`); mover a pasta não quebra o atalho depois de abrir uma vez pela pasta.
- **Jogos e emuladores em `.exe` abrem pelo Wine** (prefixo próprio em `data/pfx`, separado do resto) ou por um Proton que você aponta. Jogos nativos de Linux (`.sh`, `.x86_64`, AppImage, binário) abrem direto. Sem Wine, o Ludrix avisa na hora de jogar em vez de falhar em silêncio.
- **Ajustes › Sistema › Programas de Windows** (só aparece no Linux): mostra se o Wine foi encontrado, deixa escolher Automático / Wine / Proton e apontar os caminhos.
- **Emuladores no Linux:** se já estão instalados pelo sistema (pacman, AUR, Flatpak) o Ludrix os encontra sozinho e marca o console como pronto. "Instalar" baixa o build de Linux quando o projeto publica um (AppImage / tar.gz); se só há o de Windows, usa esse via Wine.
- Adicionar jogo, escanear pastas e "Qual executável abre o jogo?" reconhecem também executáveis de Linux. Textos, exemplos de caminho e a aba Central se adaptam ao sistema (plano de energia, winget, Store e redistribuíveis continuam só no Windows).
- Placa de vídeo, VRAM e controles conectados passam a ser lidos também no Linux. Bandeja: se a área de trabalho não tem área de notificação, o X fecha o Ludrix em vez de "esconder" numa bandeja que não existe.
- Extração de `.tar.gz` / `.tar.xz` sem depender do 7-Zip. Nada muda para quem usa Windows.
- **AppImage:** `LudrixHub-<v>-x86_64.AppImage` traz Python e o motor da janela dentro de um arquivo só — sem instalar nada
  além do `fuse2`. Jogos, ajustes e temas ficam em `~/.local/share/LudrixHub`; atualizar é trocar o arquivo.

## 1.5.1 — 2026-09-23 — Ajustes finos

- Botões dentro dos cartões (Instalar, Store, Já tenho, Abrir…) ficaram do tamanho do próprio texto, sem esticar pela largura do cartão.
- Em Dependências e Fontes, "Qual instalar?" e "O que o Ludrix faz com o link" viraram um link discreto que abre a explicação ao clicar, em vez da faixa cinza no meio da tela.
- O conjunto de ícones **Sólido** passou a ser o padrão da navegação. Quem já tinha escolhido outro conjunto não é afetado; o antigo padrão continua disponível como "Ludrix".

## 1.5.0 — 2026-09-23 — Tudo no lugar

- **Layout reorganizado em todas as abas, num padrão só.** Cabeçalho compacto (título, resumo e os botões da aba à direita), uma linha de orientação curta e cartões do mesmo tamanho em grade. Menos texto, menos espaço vazio, mais coisa por tela.
- **Central Ludrix:** "Otimizar antes de jogar" ficou em duas colunas (quando ligar / o que ele faz · apps que ele fecha); Dependências e Programas úteis viraram grades de cartões iguais, com Instalar/Store lado a lado. O antigo cartão "Opcionais" do topo saiu — tudo está em Programas úteis.
- **Emuladores:** cada sistema é um cartão com nome, estado (pronto / sem emulador / BIOS), emulador escolhido, pastas de ROMs e ações. Consoles e "Baixar ROMs" em abas.
- **Mods e ferramentas, Fontes, Jogos Rápidos, Ajustes:** mesmo padrão. Em Fontes, a explicação longa virou "O que o Ludrix faz com o link" (abre ao clicar). Em Ajustes, as escolhas de "Depois de abrir um jogo" e "Ao fechar a janela" viraram botões segmentados com descrição.
- **Atualizador novo.** Janela mais leve e no tema do Ludrix (cores da aparência em uso), notas de versão formatadas e **completas** — mostra tudo que mudou entre a versão instalada e a nova, não só a última. Fecha o Ludrix (janela e bandeja) antes de mexer em qualquer arquivo; no programa compilado, o código que chega já é compilado na hora (sem `.py` à vista).
- **Voltar de versão** (Ajustes › Atualizações › Voltar de versão…): escolha o código-fonte de uma versão anterior (`Ludrix-<versão>-src.zip`) e o Ludrix fecha, troca o código por aquela versão e reabre nela. Jogos, configurações, temas e emuladores ficam como estão. O `updater.exe` aberto pela pasta também tem o botão.
- Fila: texto de lista vazia reescrito. Ajustes › Atualizações reorganizado (botões Checar / Instalar / Instalar de arquivo / Voltar de versão, endereço de atualizações e "checar ao abrir" na mesma tela).

## 1.4.0 — 2026-09-22 — Modo Console

- **Modo Console refeito do zero, como programa separado: `LudrixConsole.exe`.** Ocupa o monitor inteiro (tela cheia de verdade, não uma janela maximizada), sem barra de tarefas, moldura ou rolagem. Só mostra os jogos instalados. Abra por Ajustes › Aparência › Modo Console, pelo menu do Ludrix (logo) ou pelo próprio `LudrixConsole.exe`; o terminal aceita `/console`.
- **Um de cada vez.** Ao abrir o Modo Console, a janela do Ludrix fecha; "Voltar para a janela" (Ajustes do console ou o botão no canto) reabre o Ludrix normal e fecha o console. Os dois usam a mesma biblioteca e os mesmos ajustes.
- **Feito para controle.** Sem controle conectado, avisa antes de abrir e oferece o Ludrix em janela (dá para desligar em "Exigir controle"). A: selecionar/jogar · B: voltar · X: opções · Y: buscar · LB/RB: abas · Start: jogar. O controle é reconhecido na hora ao ser ligado. Teclado também funciona (setas, Enter, Esc, Tab, F, M).
- **Interface própria:** barra única no alto (Biblioteca · Recentes · Favoritos · Fila · Ajustes, relógio e indicador do controle), palco com o jogo em foco (fundo, título, informações, Jogar/Detalhes/Opções), esteira de capas com indicador de páginas, legenda dos botões no rodapé. Detalhes em tela cheia, menu de opções (Jogar, Detalhes, Favoritar, Me surpreenda), busca por nome, filtro por sistema quando há ROMs.
- **Cinco temas só do console:** Noite, Gelo, Brasa, Mata e Neve (claro). Independentes da cara escolhida na janela.
- **Ajustes rápidos dentro do console:** tema, exigir controle, velocidade do cursor, sons de navegação, legenda dos botões, otimizar antes de jogar, o que fazer enquanto o jogo roda, voltar para a janela e sair.
- O antigo layout "Console" da janela (esteira dentro do Ludrix normal) saiu: quem o tinha escolhido volta ao layout padrão. F11 continua alternando a tela cheia da janela. O atualizador fecha também o `LudrixConsole.exe` antes de aplicar um pacote.

## 1.3.0 — 2026-09-22 — Central Ludrix

- **Central Ludrix** substitui as abas Redists e Modo Game por uma só, com três partes: **Otimizar antes de jogar** (o antigo Modo Game: plano de energia, prioridade, apps fechados, Ludrix em silêncio), **Dependências dos jogos** (Visual C++, DirectX, .NET/XNA, OpenAL, agora com um guia de "qual .dll pede o quê") e **Programas úteis**.
- **Cartão Opcionais** no alto da Central: launchers das lojas (Steam, Epic, GOG, Ubisoft Connect, EA app, Xbox), bibliotecas atuais (VC++ 2022, .NET 6/8, XNA, DirectX, PhysX, Java), RivaTuner, Afterburner, OBS, GPU-Z, FanControl, 7-Zip, qBittorrent, Discord, Parsec e PowerToys. Cada um tem **Instalar** (winget, silencioso, com progresso na Fila) e **Abrir na Store** (página na Microsoft Store). Sem instaladores embutidos, sem fontes de terceiros.
- **Balões de orientação**: na primeira vez que você abre a Central, os detalhes de um jogo, a Store, Emuladores, a Fila ou os Ajustes, balões curtos apontam o que cada coisa faz, com Próximo/Pular. Somem ao terminar e não voltam. Liga/desliga e "Rever os guias" em Ajustes › Geral.
- Vitrine da Biblioteca (Grafite): cartas maiores e paradas, sem animação ao passar o mouse; a carta do dado tem o mesmo tamanho das outras e é o único botão de sortear. Clique seleciona, duplo clique abre os detalhes.
- O menu do Ludrix, os Ajustes e o terminal (`/gamemode`) continuam levando aos mesmos lugares; links antigos para "Redists" e "Modo Game" abrem a parte certa da Central.

## 1.2.0 — 2026-09-22 — Biblioteca

- **Vitrine sorteada.** O alto da Biblioteca mostra cinco jogos sorteados a cada abertura do launcher, não mais os últimos jogados. Uma sexta carta (o dado) e o botão "Sortear vitrine", ao lado de "Me surpreenda", sorteiam outros cinco na hora. Vale para todas as aparências.
- **Mover a pasta do jogo.** Em Editar detalhes › Instalação: escolha uma pasta de destino (outro HD, por exemplo) e o Ludrix copia tudo com progresso na Fila, troca o caminho na Biblioteca e só então apaga a original. Se algo falhar no meio, nada muda.
- **Exportar biblioteca** (Ajustes › Biblioteca): gera uma pasta em `downloads\` com JSON completo, planilha CSV (Excel; Playnite via extensão de importar CSV), o `library.json` de jogos avulsos do Heroic e as capas.
- **Capas por busca na web mais limpas:** fotos de mídia física (caixa usada, anúncio de loja, jogo lacrado) e resultados de marketplaces são descartados; só arte de capa entra.
- Importação do Playnite (pasta ou backup .zip) e dos demais launchers continua igual.

## 1.1.0 — 2026-09-22 — Cara nova

- **Barra de navegação refeita.** Botões agrupados (Biblioteca · Store · Emuladores | Mods · Redists · Modo Game · Rápidos | Fila) com separadores, aba ativa com ícone na cor de destaque, rótulos que nunca cortam. Vale para todos os layouts (lateral, embaixo, em cima, dock, Console) e todas as caras.
- **Sete estilos de ícones** em Ajustes › Aparência › Ícones da navegação: Ludrix, Técnico, Suave, Fino, Contorno, Sólido e Duotom — com prévia de cada um. Funcionam offline.
- **Barra de tarefas sempre presente** (busca, categoria, ordenação, ajuda e notificações). O interruptor "Mostrar barra de tarefas" saiu; o que aparece nela continua configurável.
- **Categoria e ordenação viraram listas suspensas** na barra de tarefas — ocupam um botão cada, em vez de uma fileira de chips.
- **"Precisa de ajuda?" em todas as abas**: um cartão curto explica o que a aba faz, como usar e os atalhos.
- **Escala automática contínua**: acompanha largura e altura da janela (janela estreita, ultrawide, TV no Console), em passos de 5 %.
- **"Emulação" agora se chama "Emuladores"** em toda a interface; dentro dela, as páginas são **Consoles** e **Baixar ROMs**.
- **Clicar no ícone do Ludrix na barra de tarefas do Windows minimiza a janela** (a janela sem moldura nascia sem o estilo de minimizar; agora ele é aplicado com o handle certo e reaplicado ao voltar da bandeja).
- **Textos revisados** em Ajustes, avisos e menus: linguagem uniforme e direta, sem gírias; erros dizem o que não foi possível fazer.

## 1.0.2 — 2026-09-18 — Grafite em laranja

- **A cor de destaque da cara Grafite agora é laranja** (botão Jogar, item ativo da barra, seleção, brilho de fundo), no escuro e no claro. O ícone e o logo acompanham: controle escuro sobre quadrado laranja.
- Quem escolheu a própria cor em Ajustes → Aparência continua com ela. Vermelho segue reservado pra avisos e ações perigosas.

## 1.0.1 — 2026-09-18 — Ícone novo

- **Ícone e logo novos:** um controle de videogame escuro sobre um quadrado vermelho (a cor da cara Grafite). Vale pro `Ludrix.exe`, bandeja, barra de tarefas, splash, barra lateral, Sobre, terminal e atualizador.
- Nada mais mudou.

## 1.0.0 — 2026-09-17 — LudrixHub

Primeira versão do **LudrixHub**: launcher de jogos portátil pra Windows.

- **Biblioteca** unificada: jogos do PC (adicionar .exe/atalho, escanear pastas, importar de Playnite/Steam/Epic/GOG/Heroic/RetroBat/LaunchBox/Pegasus), ROMs e jogos Flash. Capas grandes, metadados automáticos (Steam, Wikipédia PT/EN, SteamGridDB, libretro, GOG e imagens da web como último recurso), tempo jogado, favoritos. Clique seleciona; botão direito abre detalhes. Editor completo "Editar detalhes do jogo" — o que você preencher vale mais que a internet.
- **Store** ligada às fontes que você escolhe (archive.org, listas, sites, GitHub, manifesto JSON, pasta local, canal do Telegram via bot). Download por link direto, hosts (Drive, MEGA, Gofile, MediaFire, Pixeldrain, 1fichier…) ou torrent; extração e instalação com Fila (pausa, retomada, histórico).
- **Emulação** multi-sistema com vários emuladores por sistema; ROMs entram na Biblioteca depois de baixadas. **Mods e ferramentas**, **Redists**, **Rápidos** (Flash via Ruffle).
- **Modo Game**: plano de energia de desempenho, prioridade pro jogo, fechar/reabrir apps da sua lista e o launcher em silêncio enquanto joga.
- **Modo Console**: tela cheia de verdade, uma barra em cima, palco do jogo + esteira de capas, controle funciona (F11 sai e volta).
- **Aparência**: caras Grafite (padrão), Aurora, Ember, Neon, Duo e Mono, todas com claro e escuro; estilos importáveis `.lxtheme`/`.zip`.
- **Tour de boas-vindas** na primeira abertura; ícone na bandeja; abrir com o Windows; instância única; ao fechar no X pergunta se esconde na bandeja ou fecha (Ajustes → Geral).
- **Atualizações** por arquivo `.lxup` (solte em `updates/` ou Ajustes → Atualizações); o atualizador fecha o launcher, faz backup, troca a pasta e reabre.
- **Terminal** secreto (tecla `"`), `/help` lista os comandos.
- Nada roda em segundo plano sem estar ligado em Ajustes → Geral → Em segundo plano.
- pt-BR e English.
