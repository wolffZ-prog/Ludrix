# Compilar e publicar

Requisitos: Windows 10/11 e Node.js 20+ (`build.bat` instala pelo winget se faltar). Para publicar: [GitHub CLI](https://cli.github.com/) logado (`gh auth login`).

```bat
build.bat                        = npm ci (se precisar) + node tools\build.js folder
build.bat all                    tudo: pasta, zip, patch, full, src, feed
npm start                        abre o Ludrix pelo código (desenvolvimento)
```

## `tools/build.js`
| Comando | Saída |
|---|---|
| `check` | compila o TypeScript e confere json, changelog e executáveis nativos |
| `bump X.Y.Z` | grava a versão em `version.json`, `package.json`, shim e recurso do exe |
| `folder` | `release/<v>/Ludrix/` (app, runtime, Ludrix.exe, LudrixConsole.exe, pastas vazias) |
| `zip` | `Ludrix-<v>.zip` |
| `patch [min]` | `ludrix-<v>-patch.lxup` (só `app/`), assinado |
| `full` | `ludrix-<v>-full.lxup` (`app/` + `runtime/` + executáveis), assinado |
| `src` | `Ludrix-<v>-src.zip` |
| `feed [url-base]` | `ludrix-updates.json` (herda os pacotes anteriores do feed publicado) |
| `all [min]` | check + folder + zip + patch + full + src + feed; apaga `release/stage` e `dist` ao final |
| `publish` | cria a release `v<versão>` no GitHub com os arquivos de `release/<v>/` |

Cache de dependências de produção: `%LOCALAPPDATA%\Ludrix-Dev\cache` (ou `LUDRIX_BUILD_CACHE`). Saída: `release\` (ou `LUDRIX_BUILD_OUT`).

## Fluxo de uma versão
1. `CHANGELOG.md`: seção `## X.Y.Z — data — Nome`.
2. `node tools\build.js bump X.Y.Z`
3. `build.bat all`
4. `node tools\build.js publish` — ou, sem o `gh`: criar a release `vX.Y.Z` em *Releases → New* e anexar os arquivos de `release\X.Y.Z\`.

O feed é gerado depois da assinatura (o hash muda); `all` já faz nessa ordem. Uma tag usada numa release não pode ser reaproveitada — se precisar refazer, suba o último número. A release `v4.0.0` precisa continuar existindo: é dela que o 3.0.x baixa o `full` para migrar.

## Assinatura
Chave Ed25519. A pública vive em `src/main/crypto.ts`; a privada em `%USERPROFILE%\.ludrix\ludrix-sign.key` (ou `LUDRIX_SIGN_KEY`), nunca no repositório. Sem a chave, `patch`/`full` param com erro — nada sai sem assinatura.

## Executáveis nativos
`Ludrix.exe`, `LudrixConsole.exe` e `ludrix-gamepad.exe` são compilados de `tools/native/*.c` com `tools/native/build.sh` (mingw) e ficam em `src/main/assets/bin/`. Só precisam ser refeitos quando o código C muda.
