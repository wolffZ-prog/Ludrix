from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import struct
from pathlib import Path

from .titles import normalize_title

log = logging.getLogger("ludrix.import")

ROM_EXTS = {".chd", ".iso", ".cue", ".bin", ".img", ".pbp", ".cso", ".z64", ".n64", ".v64", ".nds", ".gba", ".gb", ".gbc", ".sfc", ".smc",
            ".nes", ".md", ".gen", ".smd", ".gcm", ".rvz", ".wbfs", ".wad", ".gdi", ".cdi", ".xiso", ".xex", ".wua", ".wud", ".wux",
            ".rpx", ".nsp", ".xci", ".3ds", ".cci", ".sms", ".gg", ".pce", ".a26", ".zip", ".7z"}


ES_SYSTEMS = {"psx": "ps1", "ps1": "ps1", "ps2": "ps2", "ps3": "ps3", "psp": "psp", "n64": "n64", "gc": "gc", "gamecube": "gc", "wii": "wii",
              "wiiu": "wiiu", "switch": "switch", "3ds": "3ds", "n3ds": "3ds", "nds": "nds", "gba": "gba", "gb": "gba", "gbc": "gba",
              "snes": "snes", "nes": "nes", "megadrive": "genesis", "genesis": "genesis", "mastersystem": "sms", "gamegear": "sms",
              "pcengine": "pce", "tg16": "pce", "atari2600": "atari2600", "dreamcast": "dc", "saturn": "saturn", "xbox": "xbox",
              "xbox360": "x360", "arcade": "arcade", "mame": "arcade", "fbneo": "arcade", "dos": "dos", "pc": "pc", "windows": "pc"}


def _home() -> Path:
    return Path.home()


def _env(name: str, default: str = "") -> Path:
    return Path(os.environ.get(name) or default or _home())


LAUNCHERS = [
    {"id": "playnite", "name": "Playnite", "icon": "P",
     "default": lambda: _playnite_default(),
     "pick": "file", "pick_kind": "archive", "pick_alt": "folder", "alt_label": "Ou apontar a pasta do Playnite…",
     "what": "O arquivo .zip de BACKUP do Playnite. No Playnite: menu ☰ → Arquivo → Backup de dados → marque 'Biblioteca' e 'Arquivos da biblioteca' "
             "(capas) → salva um .zip. São lidos dele: jogos com pasta/executável/ROM, tempo jogado, favoritos, ano, capas e fundos, "
             "emuladores (exe + argumentos) e pastas de ROMs — tudo de uma vez.",
     "tip": "Também dá pra apontar direto a pasta do Playnite (%AppData%\\Playnite ou a pasta portátil) — funciona até com o Playnite aberto. "
            "Não precisa instalar nada no Playnite."},
    {"id": "heroic", "name": "Heroic Games Launcher", "icon": "H",
     "default": lambda: _env("APPDATA") / "heroic",
     "pick": "folder",
     "what": "A pasta de configuração do Heroic (%AppData%\\heroic). São lidos os jogos instalados da Epic/GOG/Amazon e os jogos adicionados manualmente (sideload).",
     "tip": "Se usar a versão da Microsoft Store, a pasta fica em %LocalAppData%\\Packages\\…Heroic…\\LocalCache\\Roaming\\heroic."},
    {"id": "steam", "name": "Steam", "icon": "S",
     "default": lambda: Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Steam",
     "pick": "folder",
     "what": "A pasta de instalação da Steam (ex.: C:\\Program Files (x86)\\Steam). São lidos steamapps\\libraryfolders.vdf e os appmanifest_*.acf de todas as bibliotecas.",
     "tip": "Os jogos ficam com 'Jogar' abrindo via steam://rungameid — a Steam precisa estar aberta. Jogos que não são da Steam (atalhos) não entram."},
    {"id": "epic", "name": "Epic Games Launcher", "icon": "E",
     "default": lambda: _env("ProgramData", r"C:\ProgramData") / "Epic" / "EpicGamesLauncher" / "Data" / "Manifests",
     "pick": "folder",
     "what": "A pasta de manifestos da Epic: C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests (arquivos .item).",
     "tip": "O executável é usado direto (sem passar pela Epic) — alguns jogos exigem a Epic aberta pra login."},
    {"id": "gog", "name": "GOG Galaxy", "icon": "G",
     "default": lambda: _env("ProgramData", r"C:\ProgramData") / "GOG.com" / "Galaxy" / "storage" / "galaxy-2.0.db",
     "pick": "file",
     "what": "O banco de dados do Galaxy: C:\\ProgramData\\GOG.com\\Galaxy\\storage\\galaxy-2.0.db. Pego só os jogos instalados.",
     "tip": "Se der 'banco bloqueado', feche o GOG Galaxy antes de importar."},
    {"id": "esde", "name": "EmulationStation / RetroBat / Batocera", "icon": "R",
     "default": lambda: _home() / "ES-DE",
     "pick": "folder",
     "what": "A pasta de ROMs (a que tem uma subpasta por console: psx, snes, n64…). No RetroBat é <RetroBat>\\roms; no ES-DE é ~\\ROMs.",
     "tip": "Cada subpasta é mapeada pro console certo e adicionada como 'pasta de ROMs' — o gamelist.xml (nome bonito, tempo jogado) é lido quando existir."},
    {"id": "launchbox", "name": "LaunchBox / BigBox", "icon": "L",
     "default": lambda: Path(r"C:\Users\Public\LaunchBox"),
     "pick": "folder",
     "what": "A pasta do LaunchBox (a que tem Data\\Platforms\\*.xml). Importo jogos de Windows (.exe) e ROMs com a plataforma reconhecida.",
     "tip": "Plataformas com nome fora do padrão (ex.: 'Sony PSX') são mapeadas por palavras-chave."},
    {"id": "pegasus", "name": "Pegasus Frontend", "icon": "Pg",
     "default": lambda: _env("LOCALAPPDATA") / "pegasus-frontend" if os.name == "nt" else _home() / ".config" / "pegasus-frontend",
     "pick": "file",
     "what": "Um arquivo metadata.pegasus.txt (ou metadata.txt) de uma coleção.",
     "tip": "Cada 'collection' vira um console se o nome bater (PlayStation, SNES…)."},
    {"id": "xbox", "name": "Xbox / PC Game Pass", "icon": "X",
     "default": lambda: _xbox_default(),
     "pick": "folder",
     "what": "A pasta XboxGames (fica na raiz do disco escolhido no app Xbox, ex.: C:\\XboxGames). Cada jogo tem Content\\MicrosoftGame.config, de onde saem nome e executável.",
     "tip": "Os jogos abrem pelo gamelaunchhelper.exe de cada pasta, que faz a verificação da assinatura Game Pass. Jogos instalados pela Microsoft Store antiga (WindowsApps) não entram."},
    {"id": "ea", "name": "EA app", "icon": "EA",
     "default": lambda: _env("ProgramFiles", r"C:\Program Files") / "EA Games",
     "pick": "folder",
     "what": "A pasta onde o EA app instala os jogos (padrão C:\\Program Files\\EA Games). O nome e o executável vêm de __Installer\\installerdata.xml de cada jogo.",
     "tip": "O executável é aberto direto; o EA app sobe sozinho quando o jogo exige login."},
    {"id": "ubisoft", "name": "Ubisoft Connect", "icon": "U",
     "default": lambda: _env("ProgramFiles(x86)", r"C:\Program Files (x86)") / "Ubisoft" / "Ubisoft Game Launcher" / "games",
     "pick": "folder",
     "what": "A pasta games do Ubisoft Connect (padrão C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\games). O registro do Windows é lido para achar jogos instalados em outros discos.",
     "tip": "Os jogos ficam com 'Jogar' abrindo via uplay://launch — o Ubisoft Connect precisa estar instalado."},
    {"id": "shortcuts", "name": "Atalhos (Área de trabalho / Menu Iniciar)", "icon": "↗",
     "default": lambda: _home() / "Desktop",
     "pick": "folder",
     "what": "Uma pasta com atalhos .lnk (ex.: Área de trabalho). Cada atalho que aponta pra um .exe vira um jogo.",
     "tip": "Ignoro atalhos de programas comuns (navegadores, Office, desinstaladores)."},
]


def list_launchers() -> list[dict]:
    out = []
    for l in LAUNCHERS:
        try:
            d = l["default"]()
            exists = d.exists()
        except Exception:
            d, exists = Path(""), False
        out.append({k: v for k, v in l.items() if k != "default"} | {"default_path": str(d), "detected": exists})
    return out


def _clean(t: str) -> str:
    t = re.sub(r"\s*[\(\[].*?[\)\]]", "", t or "")
    return re.sub(r"\s{2,}", " ", t).strip()


PROGRESS = None
EXT_GUESS = None


def _sys_from_name(name: str) -> str:
    n = (name or "").lower().strip()
    if n in ES_SYSTEMS:
        return ES_SYSTEMS[n]
    if n.replace(" ", "") in ES_SYSTEMS:
        return ES_SYSTEMS[n.replace(" ", "")]
    from .repos import guess_system
    return guess_system(n)


def _sys_from_file(p: str) -> str:
    if EXT_GUESS:
        try:
            return EXT_GUESS(p) or ""
        except Exception:
            return ""
    return ""


def _game(title, exe=None, rom=None, system="pc", playtime=0, last_played=0, source="", extra=None):
    return {"title": normalize_title(title) or _clean(title) or title, "exe": exe, "rom": rom, "system": system or "pc",
            "playtime": float(playtime or 0), "last_played": float(last_played or 0), "source": source, **(extra or {})}


def _playnite_default() -> Path:
    cands = []
    for d in (_home() / "Desktop", _home() / "Downloads", _home() / "Documents", _home() / "Área de Trabalho", _home() / "OneDrive" / "Desktop", _home() / "OneDrive" / "Área de Trabalho"):
        if d.is_dir():
            try:
                cands += [z for z in d.glob("*.zip") if _looks_playnite_backup(z)]
            except Exception:
                pass
    if cands:
        return max(cands, key=lambda z: z.stat().st_mtime)
    live = _env("APPDATA") / "Playnite"
    return live


def _looks_playnite_backup(z: Path) -> bool:
    import zipfile
    try:
        if z.stat().st_size < 100 * 1024:
            return False
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist()[:400]:
                if n.replace("\\", "/").lower().endswith("library/games.db"):
                    return True
    except Exception:
        return False
    return False


def playnite_emu_of(name: str) -> str:
    from . import playnite
    return playnite.emu_of(name)


def playnite_dropped() -> list[dict]:
    from . import playnite
    return list(playnite.DROPPED)


def _playnite(path: Path) -> list[dict]:
    from . import playnite
    playnite.PROGRESS = PROGRESS
    playnite.EXT_GUESS = EXT_GUESS
    playnite.DROPPED.clear()
    if path.suffix.lower() == ".json":
        raise ValueError("A importação por .json foi aposentada. Use o backup do Playnite: no Playnite, Arquivo → Backup de dados → gera um .zip; selecione esse .zip aqui.")
    return playnite.read(path)


def _heroic(path: Path) -> list[dict]:
    out = []
    files = [path / "sideload_apps" / "library.json", path / "gog_store" / "installed.json",
             path / "store_cache" / "legendary_library.json", path / "legendaryConfig" / "legendary" / "installed.json",
             path / "store_cache" / "gog_library.json", path / "nile_config" / "nile" / "installed.json"]
    if not any(f.exists() for f in files):
        raise ValueError("Não parece a pasta do Heroic (não achei sideload_apps, gog_store nem legendaryConfig).")

    f = files[0]
    if f.exists():
        for g in json.loads(f.read_text(encoding="utf-8")).get("games", []):
            exe = (g.get("install") or {}).get("executable") or g.get("executable")
            if exe:
                out.append(_game(g.get("title", ""), exe=exe, source="heroic", extra={"dir": (g.get("install") or {}).get("install_path", "")}))

    f = files[3]
    if f.exists():
        for g in json.loads(f.read_text(encoding="utf-8")).values():
            p = g.get("install_path", ""); e = g.get("executable", "")
            if p and e:
                out.append(_game(g.get("title", ""), exe=str(Path(p) / e), source="heroic/epic", extra={"dir": p}))

    f = files[1]
    if f.exists():
        titles = {}
        if files[4].exists():
            try:
                for g in json.loads(files[4].read_text(encoding="utf-8")).get("games", []):
                    titles[str(g.get("app_name"))] = g.get("title")
            except Exception:
                pass
        for g in json.loads(f.read_text(encoding="utf-8")).get("installed", []):
            p = g.get("install_path", "")
            if p:
                out.append(_game(titles.get(str(g.get("appName")), Path(p).name), exe=None, source="heroic/gog", extra={"dir": p}))

    f = files[5]
    if f.exists():
        try:
            for g in json.loads(f.read_text(encoding="utf-8")):
                p = g.get("path", "")
                if p:
                    out.append(_game(Path(p).name, exe=None, source="heroic/amazon", extra={"dir": p}))
        except Exception:
            pass
    return out


def _steam(path: Path) -> list[dict]:
    sa = path / "steamapps"
    if not sa.exists():
        raise ValueError("Pasta steamapps não encontrada aí dentro. Selecione a pasta onde a Steam está instalada.")
    libs = [sa]
    vdf = sa / "libraryfolders.vdf"
    if vdf.exists():
        for m in re.finditer(r'"path"\s+"([^"]+)"', vdf.read_text(encoding="utf-8", errors="replace")):
            p = Path(m.group(1).replace("\\\\", "\\")) / "steamapps"
            if p.exists() and p not in libs:
                libs.append(p)
    out = []
    skip = re.compile(r"redistributable|steamworks common|proton|steam linux runtime|soundtrack|dedicated server|sdk|vr$", re.I)
    for lib in libs:
        for acf in lib.glob("appmanifest_*.acf"):
            t = acf.read_text(encoding="utf-8", errors="replace")
            g = lambda k: (re.search(rf'"{k}"\s+"([^"]*)"', t) or [None, ""])[1]
            name, appid, folder = g("name"), g("appid"), g("installdir")
            if not name or skip.search(name):
                continue
            d = lib / "common" / folder
            lp = g("LastPlayed")
            out.append(_game(name, exe=f"steam://rungameid/{appid}", source="steam", last_played=float(lp or 0), extra={"dir": str(d), "steam_appid": appid}))
    return out


def _epic(path: Path) -> list[dict]:
    items = list(path.glob("*.item")) if path.is_dir() else []
    if not items:
        raise ValueError("Nenhum arquivo .item nessa pasta. Selecione ...\\Epic\\EpicGamesLauncher\\Data\\Manifests.")
    out = []
    for it in items:
        try:
            d = json.loads(it.read_text(encoding="utf-8"))
        except Exception:
            continue
        if d.get("bIsIncompleteInstall") or not d.get("InstallLocation"):
            continue
        exe = str(Path(d["InstallLocation"]) / d.get("LaunchExecutable", "")) if d.get("LaunchExecutable") else None
        out.append(_game(d.get("DisplayName", ""), exe=exe, source="epic", extra={"dir": d["InstallLocation"]}))
    return out


def _gog(path: Path) -> list[dict]:
    db = path if path.is_file() else path / "galaxy-2.0.db"
    if not db.exists():
        raise ValueError("Selecione o arquivo galaxy-2.0.db.")
    import shutil
    import tempfile
    tmp = Path(tempfile.gettempdir()) / "vl_galaxy.db"
    shutil.copy2(db, tmp)
    out = []
    con = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True)
    try:
        rows = con.execute("""SELECT ib.installationPath, p.value
                              FROM InstalledBaseProducts ib
                              JOIN ProductPurchaseDates pp ON pp.gameReleaseKey = 'gog_' || ib.productId
                              LEFT JOIN GamePieces p ON p.releaseKey = 'gog_' || ib.productId
                              AND p.gamePieceTypeId = (SELECT id FROM GamePieceTypes WHERE type='title')""").fetchall()
    except sqlite3.Error:
        rows = []
        try:
            rows = [(r[0], None) for r in con.execute("SELECT installationPath FROM InstalledBaseProducts").fetchall()]
        except sqlite3.Error:
            pass
    con.close()
    for p, tv in rows:
        title = None
        if tv:
            try:
                title = json.loads(tv).get("title")
            except Exception:
                pass
        if p:
            out.append(_game(title or Path(p).name, exe=None, source="gog", extra={"dir": p}))
    return out


def _esde(path: Path) -> list[dict]:
    roms = path / "roms" if (path / "roms").is_dir() else path / "ROMs" if (path / "ROMs").is_dir() else path
    subs = [d for d in roms.iterdir() if d.is_dir()]
    mapped = [(d, ES_SYSTEMS.get(d.name.lower())) for d in subs]
    mapped = [(d, s) for d, s in mapped if s and s != "pc"]
    if not mapped:
        raise ValueError("Nenhuma subpasta de console reconhecida (psx, snes, n64, megadrive…). Selecione a pasta 'roms'.")
    out = []
    for d, sysid in mapped:
        gl = d / "gamelist.xml"
        names = {}
        if gl.exists():
            try:
                import xml.etree.ElementTree as ET
                for g in ET.parse(gl).getroot().iter("game"):
                    p = (g.findtext("path") or "").lstrip("./")
                    names[p.lower()] = (g.findtext("name") or "", float(g.findtext("playtime") or 0), g.findtext("lastplayed") or "")
            except Exception:
                pass
        out.append({"rom_dir": str(d), "system": sysid, "source": "esde", "title": f"{d.name} ({len(list(d.iterdir()))} arquivos)", "names": len(names)})
    return out


def _launchbox(path: Path) -> list[dict]:
    plat = path / "Data" / "Platforms"
    if not plat.is_dir():
        raise ValueError("Data\\Platforms não encontrado. Selecione a pasta raiz do LaunchBox.")
    import xml.etree.ElementTree as ET
    out = []
    for xmlf in plat.glob("*.xml"):
        file_sys = _sys_from_name(xmlf.stem)
        try:
            root = ET.parse(xmlf).getroot()
        except Exception:
            continue
        for g in root.iter("Game"):
            title = g.findtext("Title") or ""
            app = g.findtext("ApplicationPath") or ""
            if not title or not app:
                continue
            p = app if os.path.isabs(app) else str(path / app)
            pt = float(g.findtext("PlayTime") or 0)
            lp = g.findtext("LastPlayedDate") or ""
            sysid = _sys_from_name(g.findtext("Platform") or "") or file_sys or _sys_from_file(p)
            if Path(p).suffix.lower() in (".exe", ".bat", ".lnk") or sysid == "pc":
                out.append(_game(title, exe=p, playtime=pt, source="launchbox", extra={"dir": str(Path(p).parent), "lp_raw": lp}))
            elif sysid:
                out.append(_game(title, rom=p, system=sysid, playtime=pt, source="launchbox"))
    return out


def _pegasus(path: Path) -> list[dict]:
    f = path if path.is_file() else next(iter(list(path.glob("metadata*.txt")) or list(path.glob("*.metadata.pegasus.txt"))), None)
    if not f:
        raise ValueError("Selecione um metadata.pegasus.txt.")
    out = []
    coll_sys = ""
    cur = None
    base = f.parent
    for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        if ":" in line and not line.startswith((" ", "\t")):
            k, v = line.split(":", 1)
            k, v = k.strip().lower(), v.strip()
            if k == "collection":
                coll_sys = _sys_from_name(v)
                cur = None
            elif k == "game":
                cur = _game(v, system=coll_sys or "pc", source="pegasus")
                out.append(cur)
            elif cur is not None and k in ("file", "files"):
                p = str(base / v) if v and not os.path.isabs(v) else v
                if p:
                    if Path(p).suffix.lower() == ".exe":
                        cur["exe"] = p
                    else:
                        cur["rom"] = p
            elif cur is not None and k == "launch" and ".exe" in v.lower():
                m = re.search(r'"?([^"]+\.exe)"?', v, re.I)
                if m:
                    cur["exe"] = m.group(1)
        elif cur is not None and line.startswith((" ", "\t")) and cur.get("rom") is None and cur.get("exe") is None:
            v = line.strip()
            p = str(base / v) if not os.path.isabs(v) else v
            (cur.__setitem__("exe", p) if p.lower().endswith(".exe") else cur.__setitem__("rom", p))
    return [g for g in out if g.get("exe") or g.get("rom")]


def _drives() -> list[Path]:
    if os.name != "nt":
        return [Path("/")]
    import string
    out = []
    for L in string.ascii_uppercase:
        d = Path(f"{L}:\\")
        if d.exists():
            out.append(d)
    return out


def _xbox_default() -> Path:
    for d in _drives():
        if (d / "XboxGames").is_dir():
            return d / "XboxGames"
    return Path(r"C:\XboxGames")


def _xbox(path: Path) -> list[dict]:
    import xml.etree.ElementTree as ET
    roots = [path] if path.is_dir() else []
    if path.name.lower() != "xboxgames":
        roots += [d / "XboxGames" for d in _drives() if (d / "XboxGames").is_dir() and (d / "XboxGames") != path]
    cfgs = []
    for r in roots:
        cfgs += list(r.glob("*/Content/MicrosoftGame.config")) + list(r.glob("*/Content/MicrosoftGame.Config"))
        if r.name.lower() != "xboxgames":
            cfgs += list(r.glob("Content/MicrosoftGame.config"))
    if not cfgs:
        raise ValueError("Nenhum MicrosoftGame.config encontrado. Selecione a pasta XboxGames (ex.: C:\\XboxGames).")
    out, seen = [], set()
    for c in cfgs:
        content = c.parent
        if str(content).lower() in seen:
            continue
        seen.add(str(content).lower())
        title, exe = content.parent.name, ""
        try:
            root = ET.parse(c).getroot()
            sv = root.find(".//ShellVisuals")
            if sv is not None and sv.get("DefaultDisplayName") and not sv.get("DefaultDisplayName", "").startswith("ms-resource"):
                title = sv.get("DefaultDisplayName")
            ex = root.find(".//ExecutableList/Executable")
            if ex is not None and ex.get("Name"):
                exe = str(content / ex.get("Name"))
        except Exception as e:
            log.debug("xbox config %s: %s", c, e)
        helper = content / "gamelaunchhelper.exe"
        if helper.exists():
            exe = str(helper)
        if not exe or not Path(exe).exists():
            continue
        out.append(_game(title, exe=exe, source="xbox", extra={"dir": str(content)}))
    return out


def _ea(path: Path) -> list[dict]:
    import xml.etree.ElementTree as ET
    if not path.is_dir():
        raise ValueError("Selecione a pasta EA Games (ex.: C:\\Program Files\\EA Games).")
    dirs = [path] if (path / "__Installer" / "installerdata.xml").exists() else [d for d in path.iterdir() if d.is_dir()]
    out = []
    for d in dirs:
        xmlp = d / "__Installer" / "installerdata.xml"
        title, exe = d.name, ""
        if xmlp.exists():
            try:
                root = ET.parse(xmlp).getroot()
                names = {t.get("locale", ""): (t.text or "").strip() for t in root.iter("gameTitle")}
                title = names.get("en_US") or names.get("pt_BR") or next((v for v in names.values() if v), title)
                for fp in root.iter("filePath"):
                    v = (fp.text or "").strip()
                    v = re.sub(r"^\[[^\]]*\]", "", v).lstrip("\\/")
                    cand = d / v
                    if v.lower().endswith(".exe") and cand.exists() and not re.search(r"installer|setup|launcher|cleanup|activation|touchup", cand.name, re.I):
                        exe = str(cand)
                        break
            except Exception as e:
                log.debug("ea xml %s: %s", xmlp, e)
        if not exe:
            from .installer import find_executables
            try:
                cands = find_executables(d)
                exe = str(cands[0]) if cands else ""
            except Exception:
                exe = ""
        if not exe:
            continue
        out.append(_game(title, exe=exe, source="ea", extra={"dir": str(d)}))
    if not out:
        raise ValueError("Nenhum jogo da EA encontrado nessa pasta.")
    return out


def _ubisoft(path: Path) -> list[dict]:
    out, seen = [], set()
    if os.name == "nt":
        try:
            import winreg
            for hive, sub in ((winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs"), (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Ubisoft\Launcher\Installs")):
                try:
                    k = winreg.OpenKey(hive, sub)
                except OSError:
                    continue
                i = 0
                while True:
                    try:
                        gid = winreg.EnumKey(k, i)
                    except OSError:
                        break
                    i += 1
                    try:
                        with winreg.OpenKey(k, gid) as gk:
                            d = str(winreg.QueryValueEx(gk, "InstallDir")[0]).replace("/", "\\").rstrip("\\")
                    except OSError:
                        continue
                    if not d or not Path(d).is_dir() or d.lower() in seen:
                        continue
                    seen.add(d.lower())
                    out.append(_game(Path(d).name, exe=f"uplay://launch/{gid}/0", source="ubisoft", extra={"dir": d, "ubisoft_id": gid}))
        except Exception as e:
            log.debug("ubisoft reg: %s", e)
    if path.is_dir():
        from .installer import find_executables
        for d in sorted(path.iterdir()):
            if not d.is_dir() or str(d).lower() in seen:
                continue
            try:
                cands = find_executables(d)
            except Exception:
                cands = []
            if cands:
                seen.add(str(d).lower())
                out.append(_game(d.name, exe=str(cands[0]), source="ubisoft", extra={"dir": str(d)}))
    if not out:
        raise ValueError("Nenhum jogo da Ubisoft encontrado (registro vazio e pasta sem jogos).")
    return out


def _shortcuts(path: Path) -> list[dict]:
    out = []
    skip = re.compile(r"uninstall|desinstal|readme|manual|chrome|firefox|edge|word|excel|discord|spotify|steam\.exe|epicgames|setup|config|launcher\.exe$|update", re.I)
    for lnk in path.rglob("*.lnk"):
        target = _lnk_target(lnk)
        if not target or not target.lower().endswith(".exe") or skip.search(target) or skip.search(lnk.stem):
            continue
        if re.search(r"\\windows\\|\\system32\\", target, re.I):
            continue
        out.append(_game(lnk.stem, exe=target, source="shortcut", extra={"dir": str(Path(target).parent)}))
    return out


def _lnk_target(p: Path) -> str | None:
    try:
        b = p.read_bytes()
        if b[:4] != b"L\x00\x00\x00":
            return None
        flags = struct.unpack_from("<I", b, 20)[0]
        pos = 76
        if flags & 1:
            ln = struct.unpack_from("<H", b, pos)[0]
            pos += 2 + ln
        if flags & 2:
            _, _, li_flags, _, lbp_off = struct.unpack_from("<IIIII", b, pos)[:5]
            if li_flags & 1:
                start = pos + lbp_off
                end = b.index(b"\x00", start)
                return b[start:end].decode("mbcs" if os.name == "nt" else "latin-1", "replace")
    except Exception:
        pass
    try:
        import win32com.client
        return win32com.client.Dispatch("WScript.Shell").CreateShortCut(str(p)).Targetpath or None
    except Exception:
        return None


READERS = {"playnite": _playnite, "heroic": _heroic, "steam": _steam, "epic": _epic, "gog": _gog, "esde": _esde,
           "launchbox": _launchbox, "pegasus": _pegasus, "shortcuts": _shortcuts, "xbox": _xbox, "ea": _ea, "ubisoft": _ubisoft}


def scan(launcher_id: str, path: str, opts: dict | None = None) -> list[dict]:
    from . import playnite
    playnite.INCLUDE_HIDDEN = bool((opts or {}).get("hidden"))
    fn = READERS.get(launcher_id)
    if not fn:
        raise ValueError("Launcher desconhecido")
    p = Path(path)
    if not p.exists():
        raise ValueError("Caminho não existe")
    return fn(p)
