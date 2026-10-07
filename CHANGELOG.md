# Changelog

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
