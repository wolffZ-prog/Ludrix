<p align="center">
  <img src="docs/img/ludrix-256.png" width="128" alt="LudrixHub">
</p>

<h1 align="center">LudrixHub</h1>

<p align="center">
  Portable game launcher for Windows.<br>
  PC, emulated and quick games in one library · a Store fed by lists you choose · ready-to-use emulators · Console Mode.
</p>

<p align="center">
  <a href="https://github.com/wolffZ-prog/Ludrix/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/wolffZ-prog/Ludrix?label=release&color=ff6a3d"></a>
  <a href="https://github.com/wolffZ-prog/Ludrix/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/wolffZ-prog/Ludrix/total?color=ff6a3d"></a>
  <img alt="Windows 10/11" src="https://img.shields.io/badge/Windows-10%20%7C%2011%20x64-ff6a3d">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/wolffZ-prog/Ludrix?color=ff6a3d"></a>
</p>

<p align="center"><a href="README.md">Português</a></p>

<p align="center">
  <img src="docs/screenshots/01-biblioteca.jpg" width="900" alt="Library">
</p>

## Download

| File | Purpose |
|---|---|
| **`Ludrix-<version>.zip`** | Ready to run. Extract anywhere (USB drive works) and open `Ludrix.exe`. Nothing is installed on the system. |
| `ludrix-<version>-patch.lxup` | Update. Ludrix downloads and applies it from **Settings → System → Check for updates**; dropping the file on the window also works. |
| `ludrix-<version>-full.lxup` | Full update (program + runtime). Only published when the runtime changes — it is the one that moves 3.0.x to 4.0.0. |
| `Ludrix-<version>-src.zip` | Source code of the same version, builds with `build.bat`. |

Requirements: Windows 10 or 11, 64-bit. No account, no login, no WebView2, no installer: the runtime ships inside the folder.

**Coming from 3.0.x:** open the Ludrix you already use → Settings → Check for updates. It downloads 4.0.0, swaps the engine and reopens with the same library, covers, settings and emulators.

## What it does

- **Library**: PC games (`.exe`, shortcuts, whole folders), ROMs and quick games in one place, with covers, categories, combinable filters and prefixed search. Alphabetical grid with letter dividers and quick chips (All / Favorites / Played this week / Never played); the selected game on top (cover, name, last session, playtime) with Play, Details and Folder. One click opens the side panel (Play, playtime, last session, folder, saves, mods, cover); double-click or right-click opens details. Dark and light themes, flat colors only. Imports from Playnite, Steam, Epic, GOG, Ubisoft Connect, EA app, Battle.net, Amazon Games and itch.io. Metadata from Steam, GOG, Wikipedia and Wikidata (no API keys), with a candidate list before applying. Status and 1–10 rating per game; automatic save backups.
- **Store by sources**: no built-in download source. Add `.json` lists, web pages, archive.org collections, GitHub repositories or local folders. Direct links, file hosts or torrent (no DHT/UPnP/NAT-PMP); staged downloads, pause, queue with history. Extracts, runs installers, mounts disc images.
- **Emulators**: 24 systems and 45 emulators catalogued, installed from the official site into the Ludrix folder. Point a ROM folder per console and the games join the Library.
- **Central**: missing runtimes (Visual C++, DirectX, .NET, PhysX…), Game Mode, useful programs through winget and Microsoft Store.
- **Console Mode**: separate TV/controller interface. Couch mode in the regular window as soon as a controller is used.
- **Appearance**: dark and light theme. Rubik font, Tabler icons, adaptive scale, reduced motion option. Portuguese (Brazil) and English.
- **System**: truly portable (`data/`, `games/`, `emulation/`, `downloads/`); system tray; single instance per folder; signed updates (Ed25519) with automatic rollback if the new version fails to open twice; every update replaces the whole program and leaves only your data behind. Export/import the whole library; export to Steam.

## Build

```bat
git clone https://github.com/wolffZ-prog/Ludrix.git
cd Ludrix
build.bat                     :: installs Node if missing, fetches dependencies, produces release\<version>\Ludrix\
node tools\build.js all       :: folder + zip + patch + full + src + feed
```

Needs Windows and Node.js 20+. Details in [docs/COMPILAR.md](docs/COMPILAR.md) (Portuguese).

## Security

Local server on `127.0.0.1` only, random port, per-session token, origin checks and CSP; sandboxed renderer. Signed update packages; the private key is never in the repository. No telemetry, no accounts, no ads. See [SECURITY.md](SECURITY.md).

## Credits

**WOLFFZ — creator and originator of the project.**

Libraries: Electron, TypeScript, webtorrent, adm-zip, electron-log. Icons based on Tabler Icons. Rubik font. [MIT](LICENSE) license. Games, covers and trademarks belong to their owners; Ludrix does not distribute games.
