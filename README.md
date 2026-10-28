<p align="center">
  <img src="docs/img/ludrix-256.png" width="128" alt="LudrixHub">
</p>

<h1 align="center">LudrixHub</h1>

<p align="center">
  Launcher de jogos portátil para Windows.<br>
  Biblioteca, emuladores e Store num lugar só — sem conta, sem instalador, sem nada rodando escondido.
</p>

<p align="center">
  <a href="https://github.com/wolffZ-prog/Ludrix/releases/latest"><img alt="Versão" src="https://img.shields.io/github/v/release/wolffZ-prog/Ludrix?label=vers%C3%A3o&color=5c6b82"></a>
  <a href="https://github.com/wolffZ-prog/Ludrix/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/wolffZ-prog/Ludrix/total?color=5c6b82"></a>
  <img alt="Windows 10/11" src="https://img.shields.io/badge/Windows-10%20%7C%2011%20x64-5c6b82">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-44-5c6b82">
  <a href="LICENSE"><img alt="Licença" src="https://img.shields.io/github/license/wolffZ-prog/Ludrix?color=5c6b82"></a>
</p>

<p align="center">
  <a href="#download">Download</a> ·
  <a href="#como-o-ludrix-está-hoje">Como está hoje</a> ·
  <a href="#capturas">Capturas</a> ·
  <a href="#temas">Temas</a> ·
  <a href="#fontes-de-jogos">Fontes</a> ·
  <a href="#compilar">Compilar</a> ·
  <a href="docs/">Documentação</a> ·
  <a href="README.en.md">English</a>
</p>

<p align="center">
  <img src="docs/screenshots/01-biblioteca.jpg" width="900" alt="Biblioteca">
</p>

---

## Download

| Arquivo | Para quem |
|---|---|
| **`Ludrix-<versão>.zip`** | Programa pronto. Extrai em qualquer pasta (pode ser pendrive ou HD externo) e abre `Ludrix.exe`. Nada é instalado no sistema. |
| `ludrix-<versão>-patch.lxup` | Atualização. O Ludrix baixa e aplica sozinho em **Ajustes → Sistema → Checar atualizações**; também pode ser arrastado para a janela. |
| `ludrix-<versão>-full.lxup` | Atualização completa (programa + runtime). Só aparece quando o runtime muda. |
| `Ludrix-<versão>-src.zip` | Código-fonte desta mesma versão, para compilar com `build.bat`. |
| `LudrixHub-<versão>-x86_64.AppImage` | Linux (experimental). Dados em `~/.local/share/Ludrix`. |

Última versão: **[Releases](https://github.com/wolffZ-prog/Ludrix/releases/latest)**. Histórico completo em [CHANGELOG.md](CHANGELOG.md). Só as duas releases mais recentes ficam publicadas; versões antigas são removidas.

Requisitos: Windows 10 ou 11, 64 bits. Sem conta, login, WebView2 ou instalação — o runtime vem dentro da pasta.

## Como o Ludrix está hoje

A série 4.0 trocou o motor antigo (Python) por Electron + TypeScript, mantendo a mesma pasta de dados. A versão atual é a **4.0.18**, e o estado do projeto é este:

- **Uma biblioteca só.** Jogos de PC, ROMs e jogos rápidos (Flash/HTML5) aparecem juntos, em grade alfabética com divisórias por letra, capas, categorias e filtros combináveis. O jogo selecionado fica em destaque no topo, com a arte de fundo dele, botão Jogar, Detalhes e Pasta.
- **Store alimentada por fontes.** Nenhum catálogo vem embutido. A Store só mostra o que as listas `.json`, páginas, coleções do archive.org, repositórios do GitHub ou pastas locais adicionadas pelo usuário oferecem. Download direto, hospedeiros e torrent (sem DHT, UPnP ou NAT-PMP).
- **Emuladores prontos.** 25 sistemas e 45 emuladores catalogados, instalados do site oficial com um clique e guardados dentro da pasta do Ludrix. As ROMs entram na Biblioteca com capa e são abertas pelo emulador escolhido para aquele sistema.
- **Aparência "Base".** Interface flat, cor sólida e linha fina, 13 px de base, fonte Rubik e ícones Tabler. Dois temas embutidos (Escuro e Claro, preto e branco de verdade) e suporte a temas externos `.lxtheme`. Glass (acrílico do Windows 11) opcional, com cartões e popups sempre sólidos por cima.
- **Movimento leve.** As animações são curtas e independentes das configurações de animação do Windows; "Reduzir movimento" desliga tudo. Trocar de página é instantâneo, sem piscar nem deslocar o conteúdo.
- **Névoa de cor.** Manchas suaves na cor de destaque atravessam o fundo da janela lentamente, como nuvens — inclusive atrás da barra lateral. Intensidade de 0 a 100 em Ajustes › Aparência.
- **Barra de navegação a gosto.** Lateral com nomes, lateral só ícones, no alto, embaixo, ou **solta**: separada do conteúdo, com cantos arredondados — com nomes ou em quadrados só com ícone.
- **Rápido em HDD.** A biblioteca abre de um cache frio enquanto o disco acorda; a verificação de integridade roda depois, sem segurar a tela. Um script opcional (`Ludrix-HDD.ps1`) ajusta o Windows para HDs mecânicos sem tocar nos dados.
- **Portátil e previsível.** Tudo fica na pasta (`data/`, `games/`, `emulation/`, `downloads/`). Nada é gravado fora dela, nada roda depois de Sair, e cada atualização substitui o programa inteiro mantendo só os dados do usuário.
- **Em português do Brasil e inglês**, com tudo que é adicionado chegando nos dois idiomas ao mesmo tempo.

## O que ele faz

**Biblioteca**
- Importa de Playnite, Steam, Epic, GOG, Ubisoft Connect, EA app, Battle.net, Amazon Games, itch.io, Heroic, ES-DE, LaunchBox, Pegasus e atalhos do Windows. Nomes digitados pelo usuário nunca são alterados.
- Capas, arte de fundo, descrição, ano, desenvolvedora, screenshots e requisitos buscados automaticamente (Steam, GOG, Wikipedia, Wikidata — sem chave de API), com lista de candidatos para escolher o jogo certo. Tudo editável; a imagem escolhida substitui a anterior.
- Status (planejo, jogando, zerado, 100 %, em espera, abandonado), nota de 1 a 10, favoritos, etiquetas (`tag:` na busca), coleções e grupos. Busca com prefixos: `dev:`, `ano:`, `gen:`, `sis:`, `origem:`, `tag:`.
- Botão direito em qualquer jogo: jogar, abrir pasta, trocar capa, mods, saves, atalho na área de trabalho, verificar arquivos, mover pasta do jogo, Requisitos × PC.
- Duplicatas detectadas e nunca mostradas duas vezes. Backup automático de saves. Exportar/importar a biblioteca inteira em um arquivo; exportar para a Steam.
- Navegação por controle (modo sofá), dado para sortear um jogo, slideshow de capas, atalhos de teclado configuráveis, Discord Rich Presence opcional.

**Store por fontes**
- Fontes aceitas em **Store → Fontes**: lista `.json` (`ludrix-pack/1`), página de site, coleção ou item do archive.org, repositório do GitHub, pasta local, listas no formato Hydra.
- Downloads em etapas, pausa, agendamento, fila com histórico. Extrai `.zip`/`.7z`/`.rar`, roda instaladores, monta imagens de disco e pergunta antes de criar atalhos.
- Recompilações e ports nativos (N64, Xbox 360, PS1…) vêm direto do GitHub, sempre na versão mais recente. Lista pronta: [`Recomps.json`](docs/FONTES.md#recomps).

**Emuladores**
- PCSX2, DuckStation, PPSSPP, Dolphin, melonDS, Xenia, mGBA, Snes9x, Rosalie's Mupen GUI, Eden e outros. Vários emuladores por sistema, BIOS detectada, varredura rasa de pastas de ROMs (nunca trava a interface).

**Central**
- Dependências que quase todo jogo exige (Visual C++, DirectX, .NET, PhysX…): detecta o que falta e instala em lote. Minecraft: detecta o launcher oficial e as alternativas. Espaço em disco por pasta.

**Modo Console**
- Executável separado (`LudrixConsole.exe`) para TV e controle: capas grandes, navegação por analógico/D-pad, mesmas abas do launcher.

**Sistema**
- Bandeja do sistema no estilo Playnite, iniciar com o Windows (opcional), instância única por pasta, memória do tamanho e posição da janela, zip de diagnóstico, vigilância de travamentos.
- Atualizações assinadas (Ed25519). Pacote sem assinatura válida não é aplicado. Se uma atualização não abrir duas vezes seguidas, o Ludrix volta sozinho para a versão anterior.

## Capturas

<table>
  <tr>
    <td><img src="docs/screenshots/02-detalhes.jpg" alt="Detalhes do jogo"><br><sub>Detalhes: arte de fundo, descrição, metadados, screenshots, requisitos</sub></td>
    <td><img src="docs/screenshots/03-barra-solta.jpg" alt="Barra solta"><br><sub>Barra de navegação solta, em quadrados</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/04-claro.jpg" alt="Tema claro"><br><sub>Tema Claro embutido, com névoa de cor</sub></td>
    <td><img src="docs/screenshots/05-store.jpg" alt="Store"><br><sub>Store: vazia até que uma fonte seja adicionada</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/06-emuladores.jpg" alt="Emuladores"><br><sub>Emuladores: instala, aponta ROMs, escolhe o núcleo</sub></td>
    <td><img src="docs/screenshots/07-central.jpg" alt="Central"><br><sub>Central: dependências, Minecraft, espaço em disco</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/09-menu.jpg" alt="Menu de contexto"><br><sub>Menu do botão direito, nas cores do tema</sub></td>
    <td><img src="docs/screenshots/08-ajustes.jpg" alt="Ajustes"><br><sub>Ajustes: abas organizadas, efeito imediato</sub></td>
  </tr>
</table>

## Temas

Um tema é uma pasta com `theme.json` (cores, destaque, layout da barra, ícones) e, se quiser, um `extra.css`, papéis de parede e fontes — ou essa pasta zipada como `.lxtheme`. Importa-se em **Ajustes › Aparência › Importar tema**; tema do sistema e agenda claro/escuro também estão lá. Formato completo em [docs/TEMAS.md](docs/TEMAS.md).

Além dos dois embutidos, existe um pacote de **temas experimentais**, feitos para testar até onde o formato vai: fundos em camadas com parallax, barras no alto ou embaixo, tipografia própria, releituras do Windows XP. Alguns deles:

<table>
  <tr>
    <td><img src="docs/screenshots/temas/magma.jpg" alt="Magma"><br><sub><b>Magma</b> — rocha vulcânica e lava em camadas com parallax</sub></td>
    <td><img src="docs/screenshots/temas/nevasca.jpg" alt="Nevasca"><br><sub><b>Nevasca</b> — neve em profundidade, barra lateral translúcida</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/temas/circuito.jpg" alt="Circuito"><br><sub><b>Circuito</b> — placa de circuito, barra inferior de pinos</sub></td>
    <td><img src="docs/screenshots/temas/laser.jpg" alt="Laser"><br><sub><b>Laser</b> — preto e branco absoluto, feixes em parallax</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/temas/prisma.jpg" alt="Prisma"><br><sub><b>Prisma</b> — gradiente escuro e destaque magenta</sub></td>
    <td><img src="docs/screenshots/temas/bliss.jpg" alt="Bliss"><br><sub><b>Bliss</b> — releitura clara do Windows XP, barra verde embaixo</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/temas/luna-nova.jpg" alt="Luna Nova"><br><sub><b>Luna Nova</b> — azul Luna, barra lateral clássica</sub></td>
    <td><img src="docs/screenshots/temas/royale-noir.jpg" alt="Royale Noir"><br><sub><b>Royale Noir</b> — o Royale escuro, com botão Iniciar</sub></td>
  </tr>
</table>

Temas experimentais podem mudar ou sair entre versões; os dois embutidos são o padrão de referência.

## Fontes de jogos

A Store só mostra o que as fontes trazem. Tipos aceitos em **Store → Fontes**:

| Tipo | Exemplo |
|---|---|
| Lista `.json` (`ludrix-pack/1`) | arquivo local ou link; formato em [docs/FONTES.md](docs/FONTES.md) |
| Página de site | o Ludrix lê a página e lista os jogos que encontrar |
| Coleção ou item do archive.org | link da coleção |
| Repositório do GitHub | releases com build Windows |
| Pasta local | jogos que já existem em outro disco |
| Listas no formato Hydra | compatível |

Pacotes prontos acompanham as releases: `Colecoes.zip` com **PC Collections**, **ROMs Collection** e **Recomps** (recompilações/ports com build Windows, baseado no [Recompendium](https://github.com/Nio03/unricopie)).

## Compilar

```bat
git clone https://github.com/wolffZ-prog/Ludrix.git
cd Ludrix
build.bat                     :: instala o Node se faltar, baixa as dependências e gera release\<versão>\Ludrix\
node tools\build.js all       :: pasta + zip + patch + full + src + feed (assinados, se a chave existir)
```

Precisa de Windows e Node.js 20+ (`build.bat` instala pelo winget se não tiver). `node tools\check.js` roda tsc, confere sintaxe do renderer, JSONs, tradução, rotas e chaves de configuração — é o portão antes de qualquer release. Detalhes em [docs/COMPILAR.md](docs/COMPILAR.md).

Estrutura:

```
src/main/        processo principal (TypeScript): servidor local, biblioteca, Store, emuladores, atualizador, bandeja
src/main/assets/ catálogos (emuladores, dependências, categorias), ícones, executáveis nativos
src/renderer/    interface (HTML/CSS/JS), aparência Base, modo console, traduções
tools/build.js   build, empacotamento, assinatura, feed de atualização, publicação
tools/check.js   verificações de integridade do código
tools/native/    Ludrix.exe, LudrixConsole.exe e ludrix-gamepad.exe (C, mingw)
docs/            documentação e capturas
```

## Atualizações

O Ludrix consulta este repositório (`releases/latest/download/ludrix-updates.json`). Quando sai versão nova, avisa; aceita-se, ele baixa, confere a assinatura, aplica e reabre. Correções rápidas (`-hfN`) chegam pelo mesmo caminho e trocam só os arquivos alterados. Também é possível apontar um endereço `https` próprio ou aplicar um `.lxup` manualmente. Mais em [docs/ATUALIZACOES.md](docs/ATUALIZACOES.md).

## Segurança

- Servidor local só em `127.0.0.1`, porta estável por pasta, token por sessão, checagem de origem, lista de caminhos permitidos e CSP; renderer em sandbox.
- Pacotes de atualização assinados com Ed25519; a chave privada nunca está no código.
- Torrent sem DHT, UPnP, NAT-PMP ou descoberta local.
- Sem telemetria, sem conta, sem anúncios, sem plugins, sem IA.

Achou um problema? Veja [SECURITY.md](SECURITY.md).

## Contribuir

Issues e pull requests são bem-vindos — leia [CONTRIBUTING.md](CONTRIBUTING.md) antes. Regras curtas: código sem comentários nem docstrings, interface direta e sem narração, tudo em pt-BR e inglês ao mesmo tempo, nada roda em segundo plano sem o usuário ligar.

## Créditos

**WOLFFZ — criador e idealizador do projeto.**

Bibliotecas: [Electron](https://www.electronjs.org/), [TypeScript](https://www.typescriptlang.org/), [webtorrent](https://webtorrent.io/), [adm-zip](https://github.com/cthackers/adm-zip), [electron-log](https://github.com/megahertz/electron-log). Ícones baseados em [Tabler Icons](https://tabler.io/icons). Fonte [Rubik](https://fonts.google.com/specimen/Rubik).

Licença [MIT](LICENSE). Os jogos, capas e marcas pertencem aos seus donos; o Ludrix não distribui jogos.
