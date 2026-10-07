# Compilar e publicar

Requisitos: Windows 10/11, Python 3.11–3.14, `pip install -r requirements.txt`. Node não é obrigatório (`node --check` é só conferência).

```bat
run.bat                          abre o Ludrix sem compilar (janela nativa)
python app\main.py --web 8000    modo navegador em http://127.0.0.1:8000 (só neste PC; --lan libera a rede)
build.bat                        = python tools\build.py all
publicar.bat                     = python tools\build.py publish
lancar.bat                       build.bat + publicar.bat + git-setup.bat, parando no primeiro erro
```

## `tools/build.py`
| Comando | Saída |
|---|---|
| `check` | confere código, catálogos, interface e sobe o servidor num teste rápido |
| `bump X.Y.Z` | grava a versão em `app/version.json` |
| `exe` | PyInstaller: `Ludrix.exe`, `LudrixConsole.exe`, `updater.exe` → `build/exe`; embute o WebView2 Fixed Version |
| `zip` | `release/<v>/Ludrix/` + `Ludrix-<v>.zip` (programa pronto, `app/` em bytecode) |
| `src` | `Ludrix-<v>-src.zip` |
| `patch [--min X]` | `ludrix-<v>-patch.lxup` |
| `full` | `ludrix-<v>-full.lxup` |
| `feed [url-base]` | `ludrix-updates.json` (padrão: este repositório) |
| `sign <arquivos>` | assina `.lxup` / `.lxtheme` / `.zip` |
| `keygen` | cria `%USERPROFILE%\.ludrix\ludrix-sign.key` e grava a pública em `app/lxsign.py` |
| `publish` | cria a release `v<versão>` no GitHub com `.lxup` + feed (precisa do [GitHub CLI](https://cli.github.com/) logado) |
| `all [--min X]` | check + exe + zip + src + patch + full + feed |

## Fluxo de uma versão
1. `CHANGELOG.md`: seção `## X.Y.Z — data — Nome`.
2. `python tools\build.py bump X.Y.Z`
3. `build.bat`
4. `publicar.bat` — ou, sem o `gh`: criar a release `vX.Y.Z` em *Releases → New* e anexar `ludrix-X.Y.Z-patch.lxup` + `ludrix-updates.json` (+ `Ludrix-X.Y.Z.zip`, `Ludrix-X.Y.Z-src.zip`).

O feed precisa ser gerado **depois** da assinatura final (o hash muda). `publish` já faz isso. Uma tag usada numa release imutável não pode ser reaproveitada — se precisar refazer, suba o último número.

## Assinatura
Chave Ed25519. A pública vive em `app/lxsign.py`; a privada em `%USERPROFILE%\.ludrix\ludrix-sign.key` (ou `LUDRIX_SIGN_KEY`), nunca no repositório (`*.key` e `chave/` estão no `.gitignore`). Sem a chave, `build.py` gera os pacotes sem assinatura e avisa — o launcher não aplica.

## Integridade
`app/integrity.json` (gerado no build) guarda SHA-256 e tamanho de cada arquivo. Na instalação compilada, `app/pyc.json` guarda o hash de cada `.pyc` produzido naquela máquina — por isso a verificação não depende da versão do Python de quem gerou o pacote.
