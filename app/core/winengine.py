from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

from . import paths

log = logging.getLogger("ludrix.win")

HOME = Path.home()
TOOLS = paths.DATA / "tools"
UMU_ZIPAPP = TOOLS / "umu" / "umu-run"
PREFIX_DEFAULT = paths.DATA / "pfx"
PREFIX_OWN = paths.DATA / "pfx-jogos"
PREFIX_WINE = paths.DATA / "pfx-wine"
UMU_HOME = HOME / ".local" / "share" / "umu"
PROTON_INSTALL = HOME / ".local" / "share" / "Steam" / "compatibilitytools.d"
MARK = ".ludrix-baixou"

COMPAT_DIRS = [
    PROTON_INSTALL,
    HOME / ".steam" / "root" / "compatibilitytools.d",
    HOME / ".steam" / "steam" / "compatibilitytools.d",
    Path("/usr/share/steam/compatibilitytools.d"),
    HOME / ".var" / "app" / "com.valvesoftware.Steam" / "data" / "Steam" / "compatibilitytools.d",
    HOME / ".config" / "heroic" / "tools" / "proton",
    HOME / ".local" / "share" / "lutris" / "runners" / "proton",
    HOME / ".local" / "share" / "umu" / "compatibilitytools",
    HOME / ".steam" / "steam" / "steamapps" / "common",
    HOME / ".local" / "share" / "Steam" / "steamapps" / "common",
]

LAYERS_DEFAULT = {"dxvk": True, "vkd3d": True, "fixes": True, "gamemode": False, "mangohud": False}


TRICKS = [
    ("vcrun2022", "Visual C++ 2015–2022 (o mais pedido)"),
    ("vcrun2013", "Visual C++ 2013"),
    ("vcrun2010", "Visual C++ 2010"),
    ("dotnet48", ".NET Framework 4.8"),
    ("dotnetdesktop6", ".NET Desktop Runtime 6"),
    ("d3dcompiler_47", "Compilador de shaders (jogos DX11 antigos)"),
    ("d3dx9", "DirectX 9 (d3dx9_*.dll)"),
    ("xact", "Áudio XACT (jogos XNA / Xbox)"),
    ("mf", "Media Foundation (vídeos que não tocam)"),
    ("corefonts", "Fontes básicas da Microsoft"),
    ("physx", "PhysX (NVIDIA)"),
    ("faudio", "FAudio"),
    ("gdiplus", "GDI+"),
    ("quartz", "DirectShow (cutscenes)"),
]

_size_cache: dict[str, tuple[float, int]] = {}
_lock = threading.Lock()


def _which(name: str) -> str | None:
    return shutil.which(name)


def _ver_tuple(name: str) -> tuple:
    nums = [int(n) for n in re.findall(r"\d+", name)]
    return tuple(nums) if nums else (0,)


def dir_size(p: Path, ttl: float = 120) -> int:
    key = str(p)
    now = time.time()
    with _lock:
        c = _size_cache.get(key)
        if c and now - c[0] < ttl:
            return c[1]
    total = 0
    try:
        if p.is_file():
            total = p.stat().st_size
        elif p.is_dir():
            for root, dirs, files in os.walk(p):
                for f in files:
                    try:
                        st = os.lstat(os.path.join(root, f))
                        total += st.st_size
                    except OSError:
                        pass
    except OSError:
        total = 0
    with _lock:
        _size_cache[key] = (now, total)
    return total


def forget_sizes():
    with _lock:
        _size_cache.clear()


def human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.0f} {unit}" if unit in ("B", "KB") else f"{n:.1f} {unit}".replace(".0 ", " ")
        n /= 1024
    return f"{n:.1f} TB"


def base_env() -> dict:
    env = dict(os.environ)
    if paths.APPIMAGE or "LUDRIX_HOST_LD_LIBRARY_PATH" in os.environ:
        for k in ("LD_LIBRARY_PATH", "PYTHONNOUSERSITE", "PYTHONDONTWRITEBYTECODE", "PYTHONHOME", "PYTHONPATH",
                  "QT_PLUGIN_PATH", "QTWEBENGINE_DISABLE_SANDBOX", "QTWEBENGINE_CHROMIUM_FLAGS", "SSL_CERT_FILE"):
            env.pop(k, None)
        host = os.environ.get("LUDRIX_HOST_LD_LIBRARY_PATH")
        if host:
            env["LD_LIBRARY_PATH"] = host
    return env


def umu_cmd(config: dict | None = None) -> list[str] | None:
    cfg = config or {}
    u = (cfg.get("umu_path") or "").strip()
    if u and Path(u).exists():
        return [u] if os.access(u, os.X_OK) and not _is_zipapp(Path(u)) else [sys.executable, u]
    w = _which("umu-run")
    if w:
        return [w]
    if UMU_ZIPAPP.exists():
        return [sys.executable, str(UMU_ZIPAPP)]
    return None


def _is_zipapp(p: Path) -> bool:
    try:
        with open(p, "rb") as f:
            head = f.read(4096)
        return b"PK\x03\x04" in head
    except OSError:
        return False


def umu_source(config: dict | None = None) -> str:
    cfg = config or {}
    if (cfg.get("umu_path") or "").strip():
        return "manual"
    if _which("umu-run"):
        return "sistema"
    if UMU_ZIPAPP.exists():
        return "ludrix"
    return ""


def umu_version(config: dict | None = None) -> str:
    cmd = umu_cmd(config)
    if not cmd:
        return ""
    try:
        out = subprocess.run(cmd + ["--version"], capture_output=True, text=True, timeout=20, env=base_env())
        m = re.search(r"(\d+\.\d+(?:\.\d+)?)", (out.stdout or "") + (out.stderr or ""))
        return m.group(1) if m else ""
    except Exception:
        return ""


def list_protons() -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for base in COMPAT_DIRS:
        try:
            if not base.is_dir():
                continue
            for d in sorted(base.iterdir()):
                if not d.is_dir() or not (d / "proton").exists():
                    continue
                rp = str(d.resolve())
                if rp in seen:
                    continue
                seen.add(rp)
                name = d.name
                src = _proton_source(base)
                out.append({"name": name, "path": str(d), "source": src, "ge": name.lower().startswith("ge-proton"),
                            "umu": name.lower().startswith("umu-proton"), "ours": (d / MARK).exists(), "ver": _ver_tuple(name)})
        except OSError:
            continue
    out.sort(key=lambda p: (0 if p["ge"] else 1 if p["umu"] else 2, tuple(-v for v in p["ver"])))
    for p in out:
        p.pop("ver", None)
    return out


def _proton_source(base: Path) -> str:
    s = str(base)
    if "/heroic/" in s:
        return "Heroic"
    if "/lutris/" in s:
        return "Lutris"
    if "/umu/" in s:
        return "umu"
    if s.startswith("/usr/"):
        return "sistema (pacman/AUR)"
    if "steamapps/common" in s:
        return "Steam (oficial)"
    return "Steam (compatibilitytools.d)"


def pick_proton(config: dict | None = None, game: dict | None = None) -> dict | None:
    cfg = config or {}
    want = ((game or {}).get("win") or {}).get("proton") or (cfg.get("proton_path") or "").strip()
    protons = list_protons()
    if want:
        p = Path(want)
        if p.is_file():
            p = p.parent
        if (p / "proton").exists():
            hit = next((x for x in protons if Path(x["path"]).resolve() == p.resolve()), None)
            return hit or {"name": p.name, "path": str(p), "source": "manual", "ge": p.name.lower().startswith("ge-proton"), "umu": False, "ours": False}
        hit = next((x for x in protons if x["name"] == want), None)
        if hit:
            return hit
    return protons[0] if protons else None


def wine_bin(config: dict | None = None) -> str | None:
    cfg = config or {}
    w = (cfg.get("wine_path") or "").strip()
    if w and Path(w).exists():
        return w
    return _which("wine") or _which("wine64")


def runtime_present() -> bool:
    try:
        if not UMU_HOME.is_dir():
            return False
        if (UMU_HOME / "_v2-entry-point").exists():
            return True
        return any(p.is_dir() and (p / "_v2-entry-point").exists() for p in UMU_HOME.iterdir())
    except OSError:
        return False


def prefix_dir(config: dict | None = None, game: dict | None = None) -> Path:
    cfg = config or {}
    w = (game or {}).get("win") or {}
    p = (w.get("prefix") or "").strip()
    if p == "own":
        slug = re.sub(r"[^a-z0-9]+", "-", str((game or {}).get("title") or (game or {}).get("key") or "jogo").lower()).strip("-")[:48] or "jogo"
        return PREFIX_OWN / slug
    if p:
        return Path(p).expanduser()
    shared = (cfg.get("win_prefix") or "").strip()
    return Path(shared).expanduser() if shared else PREFIX_DEFAULT


def wineprefix(prefix: Path) -> Path:
    if (prefix / "drive_c").exists():
        return prefix
    if (prefix / "pfx" / "drive_c").exists():
        return prefix / "pfx"
    return prefix


def prefix_info(prefix: Path) -> dict:
    wp = wineprefix(prefix)
    exists = (wp / "drive_c").exists()
    tricks: list[str] = []
    try:
        logf = wp / "winetricks.log"
        if logf.exists():
            tricks = [ln.strip() for ln in logf.read_text("utf-8", errors="ignore").splitlines() if ln.strip()]
    except OSError:
        pass
    return {"path": str(prefix), "exists": exists, "size": dir_size(prefix) if exists else 0, "tricks": tricks}


def parse_env(text: str) -> dict:
    out = {}
    for ln in (text or "").splitlines():
        ln = ln.strip()
        if not ln or ln.startswith("#") or "=" not in ln:
            continue
        k, v = ln.split("=", 1)
        k = k.strip()
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", k):
            out[k] = v.strip().strip('"')
    return out


def layers(config: dict | None = None, game: dict | None = None) -> dict:
    cfg = config or {}
    out = dict(LAYERS_DEFAULT)
    out.update({k: bool(v) for k, v in (cfg.get("win_layers") or {}).items() if k in out})
    for k, v in (((game or {}).get("win") or {}).get("layers") or {}).items():
        if k in out and v in (True, False):
            out[k] = v
    return out


def mode(config: dict | None = None) -> str:
    cfg = config or {}
    be = cfg.get("win_backend") or "auto"
    has_umu = umu_cmd(cfg) is not None
    has_proton = pick_proton(cfg) is not None
    has_wine = wine_bin(cfg) is not None
    if be == "umu":
        return "umu" if has_umu else ""
    if be == "proton":
        return "proton" if has_proton else ""
    if be == "wine":
        return "wine" if has_wine else ""
    if has_umu and has_proton:
        return "umu"
    if has_proton:
        return "proton"
    if has_wine:
        return "wine"
    if has_umu:
        return "umu"
    return ""


def ready(config: dict | None = None) -> bool:
    cfg = config or {}
    m = mode(cfg)
    if m == "umu":
        return pick_proton(cfg) is not None and runtime_present()
    return bool(m)


def build(cmd: list[str], config: dict | None = None, game: dict | None = None) -> tuple[list[str], dict, str, str]:
    cfg = config or {}
    m = mode(cfg)
    if not m:
        be = cfg.get("win_backend") or "auto"
        return cmd, {}, {"wine": "wine_missing", "proton": "proton_missing", "umu": "umu_missing"}.get(be, "engine_missing"), ""
    lay = layers(cfg, game)
    env: dict = {"WINEDEBUG": "-all"}
    env.update(parse_env(cfg.get("win_env") or ""))
    env.update(parse_env(((game or {}).get("win") or {}).get("env") or ""))
    if not lay["dxvk"]:
        env["PROTON_USE_WINED3D"] = "1"
    if not lay["vkd3d"]:
        env["PROTON_NO_D3D12"] = "1"
    if not lay["fixes"]:
        env["PROTONFIXES_DISABLE"] = "1"
    if lay["mangohud"]:
        env["MANGOHUD"] = "1"
    pre: list[str] = []
    if lay["gamemode"] and _which("gamemoderun"):
        pre = [_which("gamemoderun")]
    prefix = prefix_dir(cfg, game)
    if m == "umu":
        prefix.mkdir(parents=True, exist_ok=True)
        pr = pick_proton(cfg, game)
        env.update({"WINEPREFIX": str(prefix), "PROTONPATH": pr["path"] if pr else "GE-Proton",
                    "GAMEID": (((game or {}).get("win") or {}).get("gameid") or "").strip() or "umu-default", "STORE": "none"})
        ucmd = umu_cmd(cfg)
        if ucmd[0] == sys.executable and os.environ.get("SSL_CERT_FILE"):
            env["SSL_CERT_FILE"] = os.environ["SSL_CERT_FILE"]
        return pre + ucmd + cmd, env, "", "umu"
    if m == "proton":
        pr = pick_proton(cfg, game)
        prefix.mkdir(parents=True, exist_ok=True)
        steam = next((d for d in (HOME / ".steam" / "steam", HOME / ".local" / "share" / "Steam",
                                  HOME / ".var" / "app" / "com.valvesoftware.Steam" / ".local" / "share" / "Steam") if d.exists()), None)
        env.update({"STEAM_COMPAT_DATA_PATH": str(prefix), "STEAM_COMPAT_CLIENT_INSTALL_PATH": str(steam or prefix)})
        return pre + [str(Path(pr["path"]) / "proton"), "run", *cmd], env, "", "proton"
    PREFIX_WINE.mkdir(parents=True, exist_ok=True)
    env["WINEPREFIX"] = str(PREFIX_WINE)
    return pre + [wine_bin(cfg), *cmd], env, "", "wine"


def missing_message(code: str) -> str:
    return {
        "wine_missing": "Este jogo é um programa de Windows (.exe) e o Wine não foi encontrado. Instale o Wine (ex.: `sudo pacman -S wine`) ou mude para Automático em Ajustes › Sistema › Motor Windows.",
        "proton_missing": "Nenhum Proton foi encontrado. Em Ajustes › Sistema › Motor Windows, clique em Preparar (baixa o GE-Proton) ou aponte a pasta de um Proton.",
        "umu_missing": "O umu-launcher não foi encontrado. Em Ajustes › Sistema › Motor Windows, clique em Preparar (o Ludrix baixa, 0,4 MB) ou instale pelo sistema (`sudo pacman -S umu-launcher`).",
        "engine_missing": "O Motor Windows ainda não está pronto (nada de umu, Proton ou Wine nesta máquina). Em Ajustes › Sistema › Motor Windows, clique em Preparar: o Ludrix baixa o que falta (umu + GE-Proton) e deixa tudo pronto.",
    }.get(code, code)


def status(config: dict | None = None, deep: bool = False) -> dict:
    cfg = config or {}
    protons = list_protons()
    pr = pick_proton(cfg)
    prefix = prefix_dir(cfg)
    pinfo = prefix_info(prefix)
    ucmd = umu_cmd(cfg)
    m = mode(cfg)
    ours = [p for p in protons if p["ours"]]
    st = {
        "os": "linux",
        "backend": cfg.get("win_backend") or "auto",
        "mode": m,
        "ready": ready(cfg),
        "umu": {"found": bool(ucmd), "source": umu_source(cfg), "path": (ucmd or [""])[-1], "version": umu_version(cfg) if (deep and ucmd) else ""},
        "proton": pr or {},
        "protons": protons,
        "runtime": {"present": runtime_present(), "path": str(UMU_HOME), "size": dir_size(UMU_HOME) if deep and UMU_HOME.exists() else 0},
        "prefix": pinfo,
        "wine": wine_bin(cfg) or "",
        "gamemode": bool(_which("gamemoderun")), "mangohud": bool(_which("mangohud")),
        "layers": layers(cfg),
        "env": cfg.get("win_env") or "",
        "tricks": [{"verb": v, "desc": d, "installed": v in pinfo["tricks"]} for v, d in TRICKS],
        "sizes": {"prefix": pinfo["size"], "proton_ours": sum(dir_size(Path(p["path"])) for p in ours) if deep else 0,
                  "own_prefixes": dir_size(PREFIX_OWN) if deep and PREFIX_OWN.exists() else 0,
                  "covers": dir_size(paths.CACHE) if deep and paths.CACHE.exists() else 0,
                  "downloads": dir_size(paths.DOWNLOADS) if deep and paths.DOWNLOADS.exists() else 0},
        "install_dir": str(PROTON_INSTALL),
    }
    st["needs"] = needs(cfg)
    return st


def needs(config: dict | None = None) -> list[str]:
    cfg = config or {}
    out = []
    if not umu_cmd(cfg):
        out.append("umu")
    if not pick_proton(cfg):
        out.append("proton")
    if not runtime_present():
        out.append("runtime")
    if not prefix_info(prefix_dir(cfg))["exists"]:
        out.append("prefix")
    return out


def _github_latest(repo: str, session=None) -> dict:
    from .hosts import Session
    s = session or Session()
    r = s.get(f"https://api.github.com/repos/{repo}/releases/latest", timeout=30, headers={"Accept": "application/vnd.github+json", "User-Agent": "LudrixHub"})
    r.raise_for_status()
    return r.json()


def _untar(archive: Path, target: Path, cb, cancel, label: str):
    from .installer import extract
    target.mkdir(parents=True, exist_ok=True)
    tar = _which("tar")
    if tar:
        rc, out = _stream([tar, "-xvf", str(archive), "-C", str(target)], {}, cb, cancel, label, timeout=3600)
        if rc == 0:
            return
        log.warning("tar falhou (%s): %s", rc, out[-300:])
        shutil.rmtree(target, ignore_errors=True)
        target.mkdir(parents=True, exist_ok=True)
    extract(archive, target, cb, cancel)


def download_umu(cb, cancel, session=None) -> Path:
    from .installer import Downloader, FileRef, Progress
    rel = _github_latest("Open-Wine-Components/umu-launcher", session)
    asset = next((a for a in rel.get("assets", []) if a["name"].endswith("-zipapp.tar")), None)
    if not asset:
        raise RuntimeError("Pacote zipapp do umu-launcher não encontrado na página de releases.")
    TOOLS.mkdir(parents=True, exist_ok=True)
    tar = TOOLS / asset["name"]
    cb(Progress("download", 0, "Baixando umu-launcher…"))
    Downloader(session).download(FileRef(asset["name"], asset["browser_download_url"], int(asset.get("size") or 0)), tar, cb, cancel)
    tmp = TOOLS / "_umu_tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    _untar(tar, tmp, cb, cancel, "umu")
    run = next(tmp.rglob("umu-run"), None)
    if not run:
        raise RuntimeError("O pacote do umu-launcher veio sem o umu-run.")
    UMU_ZIPAPP.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(run, UMU_ZIPAPP)
    UMU_ZIPAPP.chmod(0o755)
    (UMU_ZIPAPP.parent / "VERSAO").write_text(rel.get("tag_name", ""), "utf-8")
    shutil.rmtree(tmp, ignore_errors=True)
    tar.unlink(missing_ok=True)
    return UMU_ZIPAPP


def latest_ge(session=None) -> dict:
    rel = _github_latest("GloriousEggroll/proton-ge-custom", session)
    tag = rel.get("tag_name", "")
    asset = next((a for a in rel.get("assets", []) if a["name"].endswith(".tar.gz") and ("x86_64" in a["name"] or "aarch64" not in a["name"])), None)
    if not asset:
        raise RuntimeError("Pacote do GE-Proton não encontrado na página de releases.")
    return {"tag": tag, "name": asset["name"], "url": asset["browser_download_url"], "size": int(asset.get("size") or 0)}


def download_proton(cb, cancel, session=None, remove_old_ours: bool = True) -> Path:
    from .installer import Downloader, FileRef, Progress
    ge = latest_ge(session)
    dest = PROTON_INSTALL / ge["tag"]
    if (dest / "proton").exists():
        cb(Progress("done", 1, f"{ge['tag']} já está instalado"))
        return dest
    PROTON_INSTALL.mkdir(parents=True, exist_ok=True)
    paths.DOWNLOADS.mkdir(parents=True, exist_ok=True)
    tar = paths.DOWNLOADS / ge["name"]
    cb(Progress("download", 0, f"Baixando {ge['tag']} ({human(ge['size'])})…"))
    Downloader(session).download(FileRef(ge["name"], ge["url"], ge["size"]), tar, cb, cancel)
    tmp = PROTON_INSTALL / f".{ge['tag']}.parcial"
    shutil.rmtree(tmp, ignore_errors=True)
    cb(Progress("extract", -1, f"Extraindo {ge['tag']}… (leva uns minutos)"))
    _untar(tar, tmp, cb, cancel, "Extraindo")
    inner = next((d for d in tmp.iterdir() if d.is_dir() and (d / "proton").exists()), None)
    if inner is None and (tmp / "proton").exists():
        inner = tmp
    if inner is None:
        shutil.rmtree(tmp, ignore_errors=True)
        raise RuntimeError("O pacote do GE-Proton veio num formato inesperado.")
    if inner == tmp:
        tmp.rename(dest)
    else:
        inner.rename(dest)
        shutil.rmtree(tmp, ignore_errors=True)
    (dest / MARK).write_text(time.strftime("%Y-%m-%d"), "utf-8")
    tar.unlink(missing_ok=True)
    if remove_old_ours:
        for p in list_protons():
            if p["ours"] and Path(p["path"]).resolve() != dest.resolve():
                shutil.rmtree(p["path"], ignore_errors=True)
                log.info("Proton antigo removido: %s", p["path"])
    forget_sizes()
    return dest


def _stream(cmd: list[str], env: dict, cb, cancel, label: str, cwd: Path | None = None, timeout: float = 3600) -> tuple[int, str]:
    from .installer import CancelledError, Progress
    full = {**base_env(), **env}
    proc = subprocess.Popen(cmd, cwd=str(cwd) if cwd else None, env=full, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", bufsize=1)
    tail: list[str] = []
    start = time.time()

    def reader():
        for line in proc.stdout:
            line = line.rstrip()
            if not line:
                continue
            tail.append(line)
            del tail[:-40]
            short = re.sub(r"\x1b\[[0-9;]*m", "", line)[-110:]
            cb(Progress("extract", -1, f"{label}: {short}"))

    t = threading.Thread(target=reader, daemon=True)
    t.start()
    while proc.poll() is None:
        if cancel.is_set():
            proc.kill()
            raise CancelledError()
        if time.time() - start > timeout:
            proc.kill()
            raise RuntimeError(f"{label}: passou de {int(timeout / 60)} min sem terminar.")
        time.sleep(0.5)
    t.join(timeout=2)
    return proc.returncode, "\n".join(tail)


def create_prefix(config: dict, cb, cancel, game: dict | None = None) -> Path:
    from .installer import Progress
    cfg = config or {}
    m = mode(cfg)
    prefix = prefix_dir(cfg, game)
    prefix.mkdir(parents=True, exist_ok=True)
    if m == "umu":
        cmd, env, warn, _ = build([""], cfg, game)
        if warn:
            raise RuntimeError(missing_message(warn))
        cb(Progress("extract", -1, "Preparando prefixo (a 1ª vez baixa o runtime da Steam, ~500 MB)…"))
        rc, out = _stream(cmd, env, cb, cancel, "umu", timeout=5400)
        if not (wineprefix(prefix) / "drive_c").exists():
            raise RuntimeError("O umu não conseguiu criar o prefixo. Última saída:\n" + out[-800:])
    elif m == "proton":
        cmd, env, warn, _ = build(["wineboot", "-u"], cfg, game)
        if warn:
            raise RuntimeError(missing_message(warn))
        cb(Progress("extract", -1, "Preparando prefixo com o Proton…"))
        _stream(cmd, env, cb, cancel, "proton", timeout=1800)
    elif m == "wine":
        cmd, env, warn, _ = build(["wineboot", "-u"], cfg, game)
        if warn:
            raise RuntimeError(missing_message(warn))
        cb(Progress("extract", -1, "Preparando prefixo com o Wine…"))
        _stream(cmd, env, cb, cancel, "wine", timeout=1800)
    else:
        raise RuntimeError(missing_message("engine_missing"))
    forget_sizes()
    return prefix


def prepare(config: dict, cb, cancel, session=None) -> dict:
    from .installer import Progress
    cfg = config or {}
    done = []
    be = cfg.get("win_backend") or "auto"
    if be in ("auto", "umu") and not umu_cmd(cfg):
        download_umu(cb, cancel, session)
        done.append("umu")
    if be in ("auto", "umu", "proton") and not pick_proton(cfg):
        download_proton(cb, cancel, session)
        done.append("proton")
    create_prefix(cfg, cb, cancel)
    done.append("prefix")
    cb(Progress("done", 1, "Motor Windows pronto"))
    return {"done": done, "mode": mode(cfg)}


def install_tricks(verbs: list[str], config: dict, cb, cancel, game: dict | None = None) -> dict:
    from .installer import Progress
    verbs = [v for v in (verbs or []) if re.fullmatch(r"[A-Za-z0-9_+.-]+", v)]
    if not verbs:
        raise RuntimeError("Nenhum componente escolhido.")
    cfg = config or {}
    m = mode(cfg)
    prefix = prefix_dir(cfg, game)
    if not (wineprefix(prefix) / "drive_c").exists():
        create_prefix(cfg, cb, cancel, game)
    cb(Progress("extract", -1, "Instalando " + ", ".join(verbs) + "…"))
    if m == "umu":
        cmd, env, warn, _ = build(["winetricks", *verbs], cfg, game)
        if warn:
            raise RuntimeError(missing_message(warn))
        cmd = [c for c in cmd if c != ""]
        rc, out = _stream(cmd, env, cb, cancel, "winetricks", timeout=5400)
    else:
        wt = _which("winetricks")
        if not wt:
            raise RuntimeError("Instale o winetricks pelo sistema (`sudo pacman -S winetricks`) para adicionar componentes sem o umu.")
        env = {"WINEPREFIX": str(wineprefix(prefix)), "WINEDEBUG": "-all"}
        if m == "proton":
            pr = pick_proton(cfg, game)
            wine = Path(pr["path"]) / "files" / "bin" / "wine"
            if wine.exists():
                env["WINE"] = str(wine)
        rc, out = _stream([wt, "-q", *verbs], env, cb, cancel, "winetricks", timeout=5400)
    if rc not in (0, None):
        raise RuntimeError("winetricks terminou com erro. Última saída:\n" + out[-800:])
    forget_sizes()
    return {"verbs": verbs}


def open_tool(tool: str, config: dict, game: dict | None = None) -> dict:
    cfg = config or {}
    prefix = prefix_dir(cfg, game)
    if tool == "prefix":
        wp = wineprefix(prefix)
        target = wp / "drive_c" if (wp / "drive_c").exists() else prefix
        target.mkdir(parents=True, exist_ok=True)
        subprocess.Popen(["xdg-open", str(target)], env=base_env(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return {"ok": True}
    if tool not in ("winecfg", "regedit", "cmd", "control", "taskmgr"):
        return {"error": "ferramenta desconhecida"}
    cmd, env, warn, m = build([tool], cfg, game)
    if warn:
        return {"error": missing_message(warn)}
    subprocess.Popen(cmd, env={**base_env(), **env}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return {"ok": True, "mode": m}


def test(config: dict, game: dict | None = None) -> dict:
    cfg = config or {}
    m = mode(cfg)
    if not m:
        return {"ok": False, "message": missing_message("engine_missing")}
    if m == "umu" and not runtime_present():
        return {"ok": False, "message": "O runtime da Steam ainda não foi baixado. Clique em Preparar."}
    exe = [""] if m == "umu" else ["wineboot", "-u"]
    cmd, env, warn, _ = build(exe, cfg, game)
    if warn:
        return {"ok": False, "message": missing_message(warn)}
    t0 = time.time()
    try:
        r = subprocess.run(cmd, env={**base_env(), **env}, capture_output=True, text=True, errors="replace", timeout=240)
    except subprocess.TimeoutExpired:
        return {"ok": False, "message": "Passou de 4 minutos sem responder."}
    out = ((r.stdout or "") + (r.stderr or "")).strip().splitlines()
    okp = (wineprefix(prefix_dir(cfg, game)) / "drive_c").exists()
    return {"ok": okp and r.returncode in (0, None), "seconds": round(time.time() - t0, 1), "mode": m, "rc": r.returncode,
            "tail": "\n".join(out[-12:]), "message": "Tudo no lugar." if okp else "O prefixo não foi criado."}


def clean_temp(config: dict) -> dict:
    cfg = config or {}
    freed = 0
    for pref in [prefix_dir(cfg)] + ([p for p in PREFIX_OWN.iterdir() if p.is_dir()] if PREFIX_OWN.exists() else []):
        wp = wineprefix(pref)
        cands = list((wp / "drive_c" / "users").glob("*/Temp")) + list((wp / "drive_c" / "users").glob("*/AppData/Local/Temp")) + [wp / "drive_c" / "windows" / "Temp"]
        for d in cands:
            if d.is_dir():
                freed += dir_size(d, ttl=0)
                for child in d.iterdir():
                    try:
                        shutil.rmtree(child) if child.is_dir() else child.unlink()
                    except OSError:
                        pass
    if paths.DOWNLOADS.exists():
        for f in paths.DOWNLOADS.glob("GE-Proton*.tar.gz*"):
            try:
                freed += f.stat().st_size
                f.unlink()
            except OSError:
                pass
    if PROTON_INSTALL.exists():
        for d in PROTON_INSTALL.glob(".*.parcial"):
            freed += dir_size(d, ttl=0)
            shutil.rmtree(d, ignore_errors=True)
    forget_sizes()
    return {"ok": True, "freed": freed, "freed_h": human(freed)}


def set_prefix(config_setter, path: str) -> dict:
    p = Path((path or "").strip()).expanduser()
    if not path.strip():
        config_setter({"win_prefix": ""})
        forget_sizes()
        return {"ok": True, "path": str(PREFIX_DEFAULT)}
    if not p.is_dir():
        return {"error": "Essa pasta não existe."}
    if not ((p / "drive_c").exists() or (p / "pfx" / "drive_c").exists()):
        return {"error": "Não parece um prefixo: não achei drive_c dentro (nem em pfx/drive_c)."}
    config_setter({"win_prefix": str(p)})
    forget_sizes()
    return {"ok": True, "path": str(p)}


def reset_prefix(config: dict, game: dict | None = None) -> dict:
    prefix = prefix_dir(config, game)
    try:
        prefix.resolve().relative_to(paths.DATA.resolve())
    except ValueError:
        return {"error": "Esse prefixo está fora da pasta do Ludrix; apague manualmente se quiser."}
    shutil.rmtree(prefix, ignore_errors=True)
    forget_sizes()
    return {"ok": True}


def game_summary(config: dict, game: dict | None) -> dict:
    cfg = config or {}
    m = mode(cfg)
    pr = pick_proton(cfg, game)
    prefix = prefix_dir(cfg, game)
    w = (game or {}).get("win") or {}
    return {"mode": m, "proton": (pr or {}).get("name", ""), "proton_source": (pr or {}).get("source", ""), "prefix": str(prefix),
            "prefix_kind": "own" if w.get("prefix") == "own" else ("custom" if w.get("prefix") else "shared"),
            "prefix_exists": (wineprefix(prefix) / "drive_c").exists(), "layers": layers(cfg, game), "defaults": layers(cfg), "ready": ready(cfg),
            "protons": list_protons(), "tricks": [{"verb": v, "desc": d, "installed": v in prefix_info(prefix)["tricks"]} for v, d in TRICKS],
            "gamemode": bool(_which("gamemoderun")), "mangohud": bool(_which("mangohud"))}


def sanitize_game_win(data: dict) -> dict:
    out: dict = {}
    p = str(data.get("prefix") or "").strip()
    if p in ("", "own") or Path(p).expanduser().is_dir():
        out["prefix"] = p
    pr = str(data.get("proton") or "").strip()
    out["proton"] = pr
    lay = {}
    for k in LAYERS_DEFAULT:
        v = (data.get("layers") or {}).get(k)
        if v in (True, False):
            lay[k] = v
    out["layers"] = lay
    out["env"] = "\n".join(f"{k}={v}" for k, v in parse_env(str(data.get("env") or "")).items())
    out["gameid"] = re.sub(r"[^A-Za-z0-9_-]", "", str(data.get("gameid") or ""))[:64]
    return out


def dump() -> str:
    return json.dumps(status(), ensure_ascii=False, indent=1)
