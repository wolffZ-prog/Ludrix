# Temas

Um tema é uma pasta (ou um `.lxtheme`, que é essa pasta zipada) com um `theme.json` e, opcionalmente, um `extra.css`, um papel de parede, uma prévia e fontes.

## Onde ficam

| Caminho | O que é |
|---|---|
| `themes/<slug>/` | temas importados (um por pasta) |
| Ajustes → Aparência → **Importar tema** | aceita vários `.lxtheme`/`.zip` de uma vez |
| duplo clique num `.lxtheme` (Windows) | importa direto, se "Abrir .lxtheme e .lxup com o Ludrix" estiver ligado em Ajustes → Geral |
| Ajustes → Aparência → menu do tema → **Exportar** | gera `.lxtheme` (assinado só na máquina do autor do projeto) |

Temas embutidos (Escuro, Claro) não ficam em `themes/` e não podem ser apagados.

## theme.json

```json
{
  "name": "Abas",
  "author": "WOLFFZ / LudrixHub",
  "scheme": "dark",
  "accent": "#8ab4f8",
  "layout": "top",
  "icons": "line",
  "description": "Um parágrafo sobre o visual.",
  "category": "Software",
  "tags": ["escuro", "claro", "navegador"],
  "wallpaper": "",
  "wallpaper_opacity": 0.35,
  "vars": { "bg": "#1f1f22", "text": "#e8eaed" },
  "vars_light": { "bg": "#f8f9fa", "text": "#202124" }
}
```

| Campo | Valores | Observação |
|---|---|---|
| `name` | texto | aparece na lista |
| `scheme` | `dark` · `light` | esquema nativo do tema |
| `accent` | `#rrggbb` | cor de destaque; a cor do texto sobre ela é calculada (branco ou preto, o que contrastar mais) |
| `layout` | `side` · `rail` · `top` · `bottom` | onde fica a navegação. `side` = barra lateral com rótulos, `rail` = só ícones, `top` = faixa em cima, `bottom` = barra embaixo |
| `icons` | `line` · `solid` | estilo dos ícones da navegação |
| `vars` | objeto | variáveis de cor (lista abaixo) |
| `vars_light` / `vars_dark` | objeto | variáveis para o esquema oposto. Sem elas o Ludrix inverte as cores automaticamente quando o usuário força claro/escuro |
| `wallpaper` | `wallpaper.jpg` etc. | arquivo na pasta do tema; `wallpaper_opacity` de 0 a 1 |
| `description`, `category`, `tags` | texto | só para a busca e a ficha do tema |

### Variáveis aceitas em `vars`

`bg` `bg2` `panel` `card` `card2` `line` `line2` `text` `muted` `muted2` `green` `green2` `red` `amber` `shadow` `glow1` `glow2` `glow3` `ph-from` `ph-to` `img-fade`

Qualquer outra chave é ignorada. Valores passam por um filtro: só cores, gradientes simples e sombras.

## extra.css

CSS livre, aplicado depois das variáveis. Regras:

- Seletores recebem prioridade automaticamente (prefixo `html body.bs[data-face]`), então não precisa de `!important` para vencer o padrão.
- Regras de navegação (`.rail`, `.rb`) são limitadas ao `layout` declarado; se o usuário trocar a barra em Ajustes → Aparência, o resto do tema continua valendo.
- `@import`, `expression()`, `behavior` e URLs externas são removidos. Imagens e fontes precisam estar na pasta do tema e são referenciadas pelo nome do arquivo: `url(fundo.png)`, `url(Rubik.woff2)`.
- Arquivos permitidos na pasta: `theme.json`, `extra.css`, `wallpaper.*`, `preview.*`, `thumb.png`, `LEIA-ME.txt`, `README.md` e arquivos `.woff2 .woff .ttf .png .webp .svg`.
- Um bloco entre `/* ---- parte 1: layout ---- */` e `/* ---- parte 2: visual ---- */` é descartado: era o formato dos temas da versão 3 e não vale mais.

### Elementos mais úteis

| Seletor | O que é |
|---|---|
| `.rail` · `.rail .rb` · `.rail .rb.on` | navegação e item ativo |
| `.rail .rbot .bell` | Ajuda e Notificações no fim da navegação |
| `.rail .rxh` | título "Plataformas" |
| `.status` · `.status #stext` | barra de status embaixo |
| `.card` · `.card h4` · `.card .rib` | cartão do jogo, título e faixa (NOVO / ATUALIZAÇÃO) |
| `.chip` · `.chip.on` | filtros rápidos |
| `.btn.p` · `.btn.s` | botão principal e secundário |
| `#ctx` · `#ctx button` · `#ctx h5` | menu de contexto, itens e cabeçalho |
| `#toasts .toast` | avisos no canto |
| `.dhero` · `.dcov` · `.dtabs` | topo da ficha do jogo, capa e abas |
| `.settings .sec` · `.frow` · `.sw` | Ajustes: seção, linha e interruptor |
| `.empty .eart .a` | detalhe colorido dos desenhos de "nada aqui" |

### O que o Ludrix calcula sozinho

- `--on-accent`: branco ou preto sobre `accent`, pelo contraste real. Use `color:var(--on-accent)` em tudo que tem fundo `var(--accent)`.
- `--accent2`: variação do destaque para texto sobre o fundo (mais clara em tema escuro, mais escura em claro).
- Com "Reduzir movimento" ligado, `body.rm` desliga animações; se o tema tiver as próprias, respeite: `body.rm .minha-animacao{animation:none}`.

## Conferência rápida

Antes de distribuir um tema, veja estas telas com ele aplicado: Biblioteca com cartões e faixa NOVO, menu de contexto num jogo, ficha de um jogo, Ajustes → Aparência, e a janela em 1140 px de largura. Texto sobre `accent`, sobre a navegação e na barra de status são os pontos que mais quebram.

## Assinatura

`.lxtheme` assinados pelo projeto aparecem como **oficial**. Um tema sem assinatura funciona igual; só não ganha a marca. Nenhum tema executa código: é só JSON e CSS filtrado.
