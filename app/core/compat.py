from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import sys
import tarfile
import threading
import time
from pathlib import Path

from . import paths

log = logging.getLogger("ludrix.compat")

IS_WIN = sys.platform == "win32"
WIN_EXT = (".exe", ".bat", ".cmd", ".msi", ".lnk")
UMU_VER = "1.4.4"
UMU_URL = f"https://github.com/Open-Wine-Components/umu-launcher/releases/download/{UMU_VER}/umu-launcher-{UMU_VER}-zipapp.tar"
UMU_DIR = paths.TOOLS / "umu"
PFX_ROOT = paths.DATA / "pfx"
SAVED_ENV = ("LD_LIBRARY_PATH", "LD_PRELOAD", "PYTHONHOME", "PYTHONPATH", "PYTHONNOUSERSITE", "QT_PLUGIN_PATH", "QML2_IMPORT_PATH",
             "QT_QPA_PLATFORM_PLUGIN_PATH", "GI_TYPELIB_PATH", "GSETTINGS_SCHEMA_DIR", "XDG_DATA_DIRS", "PATH", "SSL_CERT_FILE", "FONTCONFIG_FILE")
_lock = threading.Lock()


def is_windows_cmd(cmd: list[str]) -> bool:
    return bool(cmd) and str(cmd[0]).lower().endswith(WIN_EXT)


def host_env() -> dict:
    env = dict(os.environ)
    for k in SAVED_ENV:
        saved = os.environ.get("LUDRIX_SAVE_" + k)
        if saved is not None:
            if saved == "":
                env.pop(k, None)
            else:
                env[k] = saved
    for k in list(env):
        if k.startswith("LUDRIX_SAVE_") or k in ("APPDIR", "APPIMAGE", "ARGV0", "OWD"):
            env.pop(k, None)
    return env


def umu_path() -> Path | None:
    local = UMU_DIR / "umu-run"
    if local.is_file():
        return local
    w = shutil.which("umu-run")
    return Path(w) if w else None


def gamemode_path() -> str | None:
    if IS_WIN:
        return None
    return shutil.which("gamemoderun", path=host_env().get("PATH"))


def wine_path() -> Path | None:
    w = shutil.which("wine")
    return Path(w) if w else None


def system_python() -> str | None:
    for n in ("python3", "python"):
        w = shutil.which(n, path=host_env().get("PATH"))
        if w and not str(w).startswith(os.environ.get("APPDIR") or "/nonexistent"):
            return w
    return None


def runner(config: dict) -> str:
    mode = str(config.get("linux_runner") or "auto")
    if mode == "wine":
        return "wine" if wine_path() else "umu"
    return "umu"


def proton_home() -> Path:
    return Path.home() / ".local" / "share" / "Steam" / "compatibilitytools.d"


def proton_choice(config: dict) -> str:
    p = str(config.get("linux_proton") or "").strip()
    return p or "GE-Proton"


def proton_ready(config: dict) -> bool:
    p = proton_choice(config)
    if os.sep in p:
        return (Path(p).expanduser() / "proton").is_file()
    home = proton_home()
    if not home.is_dir():
        return False
    for d in home.iterdir():
        if d.name.startswith(p) and (d / "proton").is_file():
            return True
    return False


def runtime_ready() -> bool:
    base = Path.home() / ".local" / "share" / "umu"
    if not base.is_dir():
        return False
    return (base / "umu").is_file() or any(d.is_dir() and d.name.startswith("steamrt") for d in base.iterdir())


def prefix_for(config: dict, game: dict | None) -> Path:
    g = game or {}
    if g.get("pfx") == "own" and g.get("key"):
        slug = re.sub(r"[^a-z0-9]+", "-", str(g["key"]).lower()).strip("-")[:60]
        return PFX_ROOT / slug
    return PFX_ROOT / "shared"


def env_for(config: dict, game: dict | None) -> dict:
    env = host_env()
    env["WINEPREFIX"] = str(prefix_for(config, game))
    env["GAMEID"] = str((game or {}).get("umu_id") or "0")
    env["STORE"] = "none"
    env["PROTONPATH"] = str(Path(proton_choice(config)).expanduser()) if os.sep in proton_choice(config) else proton_choice(config)
    env.setdefault("PROTON_VERB", "waitforexitandrun")
    if config.get("linux_runtime_updates") is False:
        env["UMU_RUNTIME_UPDATE"] = "0"
    extra = str(config.get("linux_env") or "")
    for part in extra.split():
        if "=" in part:
            k, v = part.split("=", 1)
            env[k.strip()] = v
    return env


def status(config: dict | None = None) -> dict:
    config = config or {}
    if IS_WIN:
        return {"linux": False}
    r = runner(config)
    umu = umu_path()
    wine = wine_path()
    out = {"linux": True, "runner": r, "umu": str(umu) if umu else "", "wine": str(wine) if wine else "",
           "python": system_python() or "", "proton": proton_choice(config), "proton_ready": proton_ready(config),
           "runtime_ready": runtime_ready(), "prefix_root": str(PFX_ROOT), "appimage": bool(paths.APPIMAGE)}
    if r == "wine":
        out["ready"] = bool(wine)
        out["error"] = "" if wine else "Wine não encontrado no sistema"
    else:
        out["ready"] = bool(umu) and out["proton_ready"] and out["runtime_ready"]
        out["error"] = "" if out["python"] else "Python 3 do sistema não encontrado (o umu precisa dele). Instale python3 pela sua distro."
    return out


def ensure_umu(cb=None) -> Path:
    with _lock:
        p = UMU_DIR / "umu-run"
        if p.is_file():
            return p
        import requests
        UMU_DIR.mkdir(parents=True, exist_ok=True)
        tmp = UMU_DIR / "umu.tar"
        if cb:
            cb("Baixando umu-launcher…", 0.02)
        with requests.get(UMU_URL, stream=True, timeout=60, headers={"User-Agent": "Ludrix"}) as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(1 << 16):
                    f.write(chunk)
        with tarfile.open(tmp) as t:
            for m in t.getmembers():
                if m.isfile() and Path(m.name).name in ("umu-run", "umu_run.py"):
                    data = t.extractfile(m).read()
                    (UMU_DIR / Path(m.name).name).write_bytes(data)
        tmp.unlink(missing_ok=True)
        if not p.is_file():
            raise RuntimeError("pacote do umu sem umu-run")
        p.chmod(0o755)
        return p


def umu_cmd(umu: Path) -> list[str]:
    py = system_python()
    return [py, str(umu)] if py else [str(umu)]


_PCT = re.compile(r"(\d{1,3})\s*%")
_TAG = re.compile(r"^\[[^\]]*\]\s*[A-Z]+:\s*")


def prepare(config: dict, cb, cancel: threading.Event, game: dict | None = None) -> dict:
    def step(text, frac):
        if cb:
            cb(text, frac)
    if runner(config) == "wine":
        pfx = prefix_for(config, game)
        pfx.mkdir(parents=True, exist_ok=True)
        step("Criando prefixo do Wine…", 0.3)
        env = env_for(config, game)
        subprocess.run(["wineboot", "-u"], env=env, cwd=str(pfx), timeout=600, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return {"ok": True}
    umu = ensure_umu(step)
    pfx = prefix_for(config, game)
    pfx.mkdir(parents=True, exist_ok=True)
    env = env_for(config, game)
    env["UMU_LOG"] = "1"
    step("Baixando o Proton e o runtime (uma vez só)…", 0.05)
    p = subprocess.Popen(umu_cmd(umu) + [""], env=env, cwd=str(pfx), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace")
    last = ""
    t0 = time.time()
    try:
        for line in p.stdout:
            line = line.strip()
            if not line:
                continue
            line = _TAG.sub("", line)
            last = line
            m = _PCT.search(line)
            frac = min(0.95, 0.05 + int(m.group(1)) / 100 * 0.9) if m else -1
            low = line.lower()
            if "download" in low or "fetch" in low:
                step(f"Baixando {line.split('Downloading ')[-1].split(',')[0].rstrip('.')}", frac)
            elif "extract" in low or "unpack" in low:
                step(f"Extraindo {Path(line.split(' -> ')[0]).name}", -1)
            elif "prefix" in low or "wineboot" in low:
                step("Criando o prefixo do Proton…", -1)
            if cancel.is_set():
                p.kill()
                return {"error": "cancelado"}
            if time.time() - t0 > 3600:
                p.kill()
                return {"error": "demorou demais (1 h)"}
    finally:
        p.wait()
    if p.returncode not in (0, None):
        log.warning("umu prepare rc=%s: %s", p.returncode, last)
    st = status(config)
    if not st["ready"]:
        return {"error": f"O Proton não ficou pronto ({last[-160:] or 'sem detalhes'}). Veja o ludrix.log."}
    return {"ok": True}


def wrap(cmd: list[str], config: dict | None = None, game: dict | None = None) -> tuple[list[str], dict | None, str]:
    config = config or {}
    if IS_WIN or not cmd:
        return cmd, None, ""
    exe = Path(cmd[0])
    if is_windows_cmd(cmd):
        if runner(config) == "wine" and wine_path():
            return [str(wine_path())] + cmd, env_for(config, game), "Wine"
        umu = umu_path()
        if not umu:
            return cmd, None, ""
        return umu_cmd(umu) + cmd, env_for(config, game), "Proton"
    try:
        if exe.is_file() and not os.access(exe, os.X_OK):
            exe.chmod(exe.stat().st_mode | 0o111)
    except OSError:
        pass
    return cmd, host_env(), ""


def popen(cmd: list[str], cwd: str | Path | None = None, config: dict | None = None, game: dict | None = None):
    cmd, env, _ = wrap(cmd, config, game)
    return subprocess.Popen(cmd, cwd=str(cwd) if cwd else None, env=env)


def xdg_open(target: str) -> bool:
    if IS_WIN or not shutil.which("xdg-open"):
        return False
    try:
        subprocess.Popen(["xdg-open", target], env=host_env(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        return True
    except OSError:
        return False


def remove_prefix(config: dict, game: dict | None = None) -> dict:
    pfx = prefix_for(config, game)
    if pfx.is_dir() and PFX_ROOT in pfx.parents:
        shutil.rmtree(pfx, ignore_errors=True)
    return {"ok": True}
