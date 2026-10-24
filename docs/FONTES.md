# Fontes da Store

O Ludrix não traz fonte de download embutida. Em **Store → Fontes** você cola um link ou aponta um arquivo; o Ludrix detecta o tipo:

| Tipo | O que aceita |
|---|---|
| Lista `.json` | formato `ludrix-pack/1` (abaixo) ou listas no formato Hydra |
| Página de site | o Ludrix lê a página e extrai jogos e links |
| archive.org | link de coleção ou de item |
| GitHub | `https://github.com/dono/repo` — lê as releases |
| Pasta local | jogos que já estão em outro disco |
| Telegram | canal com bot próprio (Manual → avançado) |

Fontes vêm **desligadas** até você ligar. Cada uma pode ser editada, desligada ou removida sem afetar a biblioteca.

## Formato `ludrix-pack/1`

```json
{
  "name": "Minha lista",
  "format": "ludrix-pack/1",
  "kind": "pc",
  "updated": "2026-10-06",
  "note": "texto livre mostrado na fonte",
  "games": [
    {
      "id": "meu-jogo",
      "title": "Meu Jogo",
      "year": "2019",
      "creator": "Estúdio",
      "genres": ["Ação"],
      "tags": ["USA"],
      "cover": "https://.../capa.jpg",
      "description": "…",
      "page_url": "https://…",
      "size": 123456789,
      "files": [{"name": "MeuJogo.zip", "url": "https://…/MeuJogo.zip", "size": 123456789}],
      "patches": [{"name": "update-1.1.zip", "url": "https://…", "note": "opcional"}],
      "magnet": "magnet:?xt=…",
      "exe": "MeuJogo.exe"
    }
  ]
}
```

- `kind`: `pc` (padrão), `rom` ou `recomp`. Pode ser definido na lista inteira ou por jogo.
- `system`: para ROMs (`n64`, `ps1`, `ps2`, `psp`, `gc`, `wii`, `dc`, `xbox`, `x360`, `gba`, `snes`, `nds`, `genesis`, `nes`, `ps3`, `wiiu`, `switch`, `3ds`, `saturn`, `sms`, `pce`, `atari2600`, `arcade`, `dos`). Sem `system`, o Ludrix deduz pela extensão e pelo nome.
- `files`: vários arquivos = partes do mesmo download. `magnet`/`torrent`: torrent só quando a lista fornece.
- `exe`: executável preferido depois de instalar (opcional).

### Entrada apontando pro GitHub

Em vez de `files` fixos, um jogo pode apontar pra um repositório. O Ludrix busca a release mais recente na hora:

```json
{
  "title": "The Legend of Zelda: Majora's Mask",
  "github": "Zelda64Recomp/Zelda64Recomp",
  "kind": "recomp",
  "asset": "Windows",
  "requires_rom": "ROM de Majora's Mask (N64, US, .z64)",
  "tags": ["Completo", "Nintendo 64"]
}
```

- `asset`: expressão regular aplicada ao nome do arquivo da release. Padrão: `win.*x64|x64.*win|windows|win64`. Arquivos `.sha256`, `.sig`, `provenance.json`, Linux, macOS, Android e símbolos são ignorados sempre; se ainda sobrar mais de um, o Ludrix pega o pacote principal.
- `requires_rom`: aviso mostrado nos detalhes. Recompilações não incluem o jogo.
- Disponível a partir do Ludrix 2.35.0.

## Validação

A Loja lê o arquivo jogo por jogo antes de aceitar. O relatório aparece ao adicionar, em **Store → Fontes** (resumo ao lado de cada fonte, clicável) e no resultado de **Analisar**.

- **Erro** — o item é ignorado: sem `title`; nenhuma forma de download válida (`files`, `magnet`, `torrent` ou `github`); `url` que não começa com `http://` ou `https://`; `magnet` sem `xt=urn:btih:`; `github` fora de `dono/repo`; `id` repetido.
- **Aviso** — entra mesmo assim: campo desconhecido; `size` ilegível; `system` desconhecido (deduzido pela extensão); `year` estranho; `cover` que não é link; título repetido dentro do mesmo arquivo.
- Arquivo que não é JSON (vírgula sobrando, aspas erradas) é recusado com linha e coluna do problema.
- `size` aceita bytes (número) ou texto como `"12.5 GB"`. Sem tamanho, o espaço necessário e o tempo estimado não aparecem antes de baixar.
- `prefer`: `torrent` ou `direct` — qual botão fica em destaque quando o jogo tem os dois.

## O mesmo jogo em várias fontes

Títulos iguais (ignorando edição, região, pontuação e maiúsculas) viram **um** cartão na Loja. Na ficha, a faixa **N fontes têm este jogo** lista cada lugar com tipo (direto, torrent, partes) e tamanho; um clique troca. Prioridade do cartão principal: arquivo direto, depois torrent, depois GitHub.

Jogo da Store que já está instalado no PC mostra **Jogar** em vez de **Baixar**. Jogo da biblioteca cujo arquivo sumiu ganha **Baixar da Loja** quando alguma fonte tem o título.

## Pacotes prontos

Cada release traz `Colecoes.zip`:

| Lista | Conteúdo |
|---|---|
| `PC Collections.json` | jogos de PC de coleções públicas do archive.org, com capas |
| `ROMs Collection.json` | ROMs por console, com capas |
| `Recomps.json` | 91 recompilações e ports nativos com build Windows, direto do GitHub. Status (Completo / Jogável / Experimental), console de origem e o que cada um precisa. Baseado no [Recompendium](https://github.com/Nio03/unricopie) (MIT). <a id="recomps"></a> |

Pra usar: extraia e, em Store → Fontes → Manual, aponte pro `.json`.
