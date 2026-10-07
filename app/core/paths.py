from __future__ import annotations

import os
import sys
from pathlib import Path


def _app_root() -> Path:
    home = os.environ.get("LUDRIX_HOME")
    if home:
        return Path(home).expanduser().resolve()
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent.parent


ROOT = _app_root()
FROZEN = bool(getattr(sys, "frozen", False))
APPIMAGE = os.environ.get("APPIMAGE") or ""

DATA = ROOT / "data"
CACHE = DATA / "cache"
CACHE_WEB = CACHE / "web"
CACHE_THUMBS = CACHE / "thumbs"
CACHE_COVERS = CACHE / "covers"
CACHE_META = CACHE / "meta"
CACHE_SHOTS = CACHE / "shots"
DOWNLOADS = ROOT / "downloads"
GAMES = ROOT / "games"
EMU = ROOT / "emulation"
EMU_EMULATORS = EMU / "emulators"
EMU_GAMES = EMU / "games"
EMU_BIOS = EMU / "bios"
TOOLS = DATA / "tools"
THEMES = ROOT / "themes"
FLASH = GAMES / "rapidos"
REDISTS = DOWNLOADS / "redists"
APP = Path(__file__).resolve().parent.parent
PRESETS = APP / "presets"
UI = APP / "ui"
ASSETS = APP / "assets"
BIN = DATA / "bin"
UPDATES = DATA / "updates"

CONFIG_FILE = DATA / "config.json"
LIBRARY_FILE = DATA / "library.json"
LOG_FILE = DATA / "ludrix.log"


BOOT_FILE = DATA / "boot.json"
PENDING_VERIFY = UPDATES / "pending_verify.json"


def _boot_read() -> dict:
    import json
    try:
        d = json.loads(BOOT_FILE.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _boot_write(d: dict):
    import json
    try:
        BOOT_FILE.parent.mkdir(parents=True, exist_ok=True)
        BOOT_FILE.write_text(json.dumps(d), encoding="utf-8")
    except OSError:
        pass


def boot_tries() -> int:
    return int(_boot_read().get("tries") or 0)


def boot_begin() -> bool:
    import time
    d = _boot_read()
    tries = int(d.get("tries") or 0)
    d["tries"] = tries + 1
    d["at"] = time.time()
    _boot_write(d)
    return tries >= 2


def boot_ok():
    d = _boot_read()
    if d.get("tries"):
        d["tries"] = 0
        _boot_write(d)
    try:
        PENDING_VERIFY.unlink(missing_ok=True)
    except OSError:
        pass


LEGACY_MOVES = (("cache", CACHE), ("updates", UPDATES), ("bin", BIN), ("tools", TOOLS), ("redists", REDISTS), ("flash", FLASH))


def migrate_layout():
    import shutil
    for old, new in LEGACY_MOVES:
        src = ROOT / old
        if not src.is_dir() or src.resolve() == new.resolve():
            continue
        if old == "tools" and ((src / "build.py").exists() or (src / "bootstrap.py").exists()):
            continue
        try:
            if not new.exists():
                new.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(src), str(new))
                continue
            _merge_move(src, new)
        except OSError:
            pass


def _merge_move(src: Path, dst: Path):
    import shutil
    for child in list(src.iterdir()):
        target = dst / child.name
        if not target.exists():
            shutil.move(str(child), str(target))
        elif child.is_dir() and target.is_dir():
            _merge_move(child, target)
    if not any(src.iterdir()):
        src.rmdir()


def ensure_dirs():
    migrate_layout()
    for d in (DATA, CACHE_WEB, CACHE_THUMBS, CACHE_COVERS, CACHE_META, CACHE_SHOTS, DOWNLOADS, GAMES,
              EMU_EMULATORS, EMU_GAMES, EMU_BIOS, THEMES, UPDATES):
        d.mkdir(parents=True, exist_ok=True)
    readme = THEMES / "LEIA-ME.txt"
    if not readme.exists():
        readme.write_text(
            "Seus estilos de aparencia. Cada um e uma pasta com theme.json (+ extra.css, wallpaper, preview.png opcionais).\n"
            "Importe um .lxtheme/.zip em Ajustes > Aparencia > Estilos importados ou crie o seu em Novo estilo.\n", encoding="utf-8")


def dir_size(p: Path) -> int:
    total = 0
    if not p.exists():
        return 0
    for f in p.rglob("*"):
        try:
            if f.is_file():
                total += f.stat().st_size
        except OSError:
            pass
    return total


QT_LIGHT_FLAGS = [
    "--enable-low-end-device-mode",
    "--renderer-process-limit=1",
    "--no-zygote",
    "--disable-features=SpareRendererForSitePerProcess,AudioServiceOutOfProcess,MediaRouter,"
    "OptimizationHints,Translate,BackForwardCache,DialMediaRouteProvider",
    "--disable-gpu-shader-disk-cache",
    "--disable-speech-api",
    "--disable-background-networking",
    "--disable-component-update",
    "--no-pings",
    "--num-raster-threads=1",
]


def qt_light_env() -> bool:
    if sys.platform.startswith("win") or os.environ.get("LUDRIX_QT_FULL") == "1":
        return False
    cur = os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS", "")
    have = {f.split("=", 1)[0] for f in cur.split()}
    extra = " ".join(f for f in QT_LIGHT_FLAGS if f.split("=", 1)[0] not in have)
    if extra:
        os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = (extra + " " + cur).strip()
    return True
