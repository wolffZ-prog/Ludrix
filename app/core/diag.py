from __future__ import annotations

import logging
import os
import platform
import shutil
import sys
import time
from pathlib import Path

from . import paths

BOOT_FILE = paths.BOOT_FILE
SAFE_KEYS = ("theme", "face", "accent", "layout", "nav", "custom", "ctx_menu", "animations", "fx_type",
             "fx_intensity", "glass", "ui_scale", "density", "rail_icons", "toolbar", "hero_enabled")
MIN_FREE = 512 * 1024 * 1024


_read_boot = paths._boot_read
_write_boot = paths._boot_write
boot_begin = paths.boot_begin
boot_ok = paths.boot_ok


def enter_safe_mode(store) -> dict:
    from .store import DEFAULT_CONFIG
    d = _read_boot()
    saved = {k: store.config.get(k) for k in SAFE_KEYS if k in store.config}
    d["saved"] = saved
    d["safe_at"] = time.time()
    d["tries"] = 0
    _write_boot(d)
    store.set_config(**{k: DEFAULT_CONFIG[k] for k in SAFE_KEYS if k in DEFAULT_CONFIG})
    return saved


def saved_settings() -> dict:
    return dict(_read_boot().get("saved") or {})


def restore_settings(store) -> bool:
    saved = saved_settings()
    if not saved:
        return False
    store.set_config(**saved)
    d = _read_boot()
    d.pop("saved", None)
    _write_boot(d)
    return True


def free_bytes(p: Path) -> int:
    q = Path(p)
    while not q.exists() and q.parent != q:
        q = q.parent
    try:
        return shutil.disk_usage(q).free
    except OSError:
        return -1


def human(n: float) -> str:
    n = float(n)
    for u in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or u == "TB":
            return f"{n:.1f} {u}" if u not in ("B", "KB") else f"{int(n)} {u}"
        n /= 1024
    return f"{n:.1f} TB"


def ensure_space(target: Path, needed: int, what: str = "baixar"):
    if needed <= 0:
        return
    free = free_bytes(target)
    if free < 0:
        return
    want = int(needed * 1.05) + MIN_FREE
    if free < want:
        anchor = Path(target).anchor or str(target)
        raise RuntimeError(f"Sem espaço para {what}: precisa de {human(want)} livres em {anchor}, tem {human(free)}. Libere {human(want - free)} ou mude a pasta de jogos em Ajustes.")


def writable(p: Path) -> bool:
    try:
        p.mkdir(parents=True, exist_ok=True)
        t = p / f".w{os.getpid()}"
        t.write_text("ok", encoding="utf-8")
        t.unlink()
        return True
    except OSError:
        return False


def webview2_embedded() -> str:
    d = paths.ROOT / "runtime" / "webview2"
    if not (d / "msedgewebview2.exe").exists():
        return ""
    try:
        return (d / "VERSION").read_text(encoding="utf-8").strip() or "embutido"
    except Exception:
        return "embutido"


def webview2_version() -> str:
    if os.name != "nt":
        return ""
    emb = webview2_embedded()
    if emb:
        return emb + " (embutido)"
    try:
        import winreg
    except ImportError:
        return ""
    guid = r"\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    for hive, sub in ((winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node" + guid), (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE" + guid),
                      (winreg.HKEY_CURRENT_USER, r"SOFTWARE" + guid)):
        try:
            with winreg.OpenKey(hive, sub) as k:
                v = str(winreg.QueryValueEx(k, "pv")[0])
                if v and v != "0.0.0.0":
                    return v
        except OSError:
            continue
    return ""


def log_tail(n: int = 30) -> list[str]:
    try:
        lines = paths.LOG_FILE.read_text(encoding="utf-8", errors="replace").splitlines()
        return lines[-n:]
    except OSError:
        return []


def webview2_mode() -> str:
    if os.name != "nt":
        return "GTK/Qt"
    emb = paths.ROOT / "runtime" / "webview2"
    if (emb / "msedgewebview2.exe").exists():
        try:
            v = (emb / "VERSION").read_text(encoding="utf-8").strip()
        except Exception:
            v = ""
        return f"embutido {v}".strip()
    v = webview2_version()
    return f"do sistema {v}" if v else "não encontrado"


UI_ERRORS: list[str] = []


def ui_error(msg: str, src: str = "", line: int = 0):
    txt = f"{msg} ({src.rsplit('/', 1)[-1]}:{line})" if src else msg
    if UI_ERRORS and UI_ERRORS[-1] == txt:
        return
    UI_ERRORS.append(txt)
    del UI_ERRORS[:-30]
    logging.getLogger("ludrix").warning("UI: %s", txt)


def memory_usage() -> dict:
    try:
        import psutil
    except Exception:
        return {}
    try:
        me = psutil.Process()
        mi = me.memory_info()
        own = int(getattr(mi, "private", mi.rss))
        web = other = 0
        for c in me.children(recursive=True):
            try:
                ci = c.memory_info()
                n = int(getattr(ci, "private", ci.rss))
                if "webview2" in c.name().lower() or "msedge" in c.name().lower():
                    web += n
                else:
                    other += n
            except Exception:
                continue
        return {"own": own, "web": web, "other": other, "total": own + web + other}
    except Exception:
        return {}


def report(ludrix, api_ok: bool | None = None) -> dict:
    from .installer import find_7z
    from . import torrent
    store = ludrix.store
    checks: list[dict] = []

    def add(cid, name, ok, detail, warn=False):
        checks.append({"id": cid, "name": name, "ok": bool(ok), "warn": bool(warn), "detail": str(detail)})

    ver = ludrix.updates.status()["current"].get("version", "?")
    add("app", "Ludrix", True, f"{ver}{' (exe)' if paths.FROZEN else ' (código-fonte)'}")
    add("os", "Sistema", True, f"{platform.system()} {platform.release()} · Python {platform.python_version()} · {platform.machine()}")
    add("root", "Pasta do programa", True, str(paths.ROOT))
    low = str(paths.ROOT).lower()
    if os.name == "nt" and ("program files" in low or low.startswith(r"c:\windows")):
        add("root_pf", "Local da pasta", True, "Dentro de Arquivos de Programas — o Windows bloqueia gravações aí. Mova a pasta Ludrix para outro lugar (ex.: C:\\Jogos\\Ludrix).", warn=True)
    fixed = list(getattr(store, "config_fixed", []) or [])
    if fixed:
        add("config", "Ajustes (config.json)", True, f"{len(fixed)} campo(s) com valor inválido foram corrigidos ao abrir: {', '.join(fixed[:8])}", warn=True)
    add("write", "Gravação em data/", writable(paths.DATA), "OK" if writable(paths.DATA) else "Sem permissão de escrita — ajustes e biblioteca não serão salvos")
    gd = store.games_dir()
    add("write_games", "Gravação na pasta de jogos", writable(gd), str(gd))
    for cid, name, p in (("disk_root", "Espaço livre (programa)", paths.ROOT), ("disk_games", "Espaço livre (jogos)", gd)):
        if cid == "disk_games" and Path(p).anchor == paths.ROOT.anchor:
            continue
        fb = free_bytes(p)
        add(cid, name, fb < 0 or fb >= 2 * 1024 ** 3, f"{human(fb)} em {Path(p).anchor or p}" if fb >= 0 else "não deu para medir", warn=0 <= fb < 2 * 1024 ** 3)
    if os.name == "nt":
        wv = webview2_mode()
        add("webview2", "WebView2 Runtime", wv != "não encontrado", wv if wv != "não encontrado" else "Não encontrado — instale o Microsoft Edge WebView2 Runtime (a janela do Ludrix depende dele)")
    else:
        add("webview", "Motor da janela", True, "GTK/Qt (Linux)")
    if api_ok is not None:
        add("api", "Servidor interno", api_ok, "respondendo" if api_ok else "não respondeu")
    mem = memory_usage()
    if mem:
        parts_m = [f"Ludrix {human(mem['own'])}", f"interface (WebView2) {human(mem['web'])}"]
        if mem["other"]:
            parts_m.append(f"outros processos {human(mem['other'])}")
        add("mem", "Memória em uso", mem["total"] < 700 * 1024 ** 2, " · ".join(parts_m) + f" · total {human(mem['total'])}", warn=mem["total"] >= 700 * 1024 ** 2)
    sz = find_7z()
    add("7z", "7-Zip", True, sz or "não encontrado — extração de .7z fica lenta (py7zr)", warn=not sz)
    ar = torrent.aria2_path()
    add("aria2c", "aria2c", True, str(ar) if ar else "não encontrado — baixa automaticamente quando um torrent for necessário", warn=not ar)
    add("libtorrent", "libtorrent", True, "presente" if torrent.lt_present() else "ausente (motor reserva: aria2c)", warn=torrent.lt is None)
    lib = store.library
    missing = 0
    for e in lib.values():
        d, exe = str(e.get("dir") or ""), str(e.get("exe") or "")
        p = Path(exe) if os.path.isabs(exe) else (Path(d) / exe if d and exe else (Path(d) if d else None))
        if p is not None and not p.exists():
            missing += 1
    roms = sum(1 for k in lib if str(k).startswith("rom:"))
    pn = sum(1 for e in lib.values() if e.get("source") == "playnite")
    parts = [f"{len(lib)} jogo" + ("s" if len(lib) != 1 else "")]
    if roms:
        parts.append(f"{len(lib) - roms} PC · {roms} ROM" + ("s" if roms != 1 else ""))
    if pn:
        parts.append(f"{pn} do Playnite")
    if missing:
        parts.append(f"{missing} com arquivo não encontrado")
    add("library", "Biblioteca", missing == 0, " · ".join(parts), warn=missing > 0)
    try:
        bk = sorted((paths.DATA / "backups").glob("library-*.json"), key=lambda f: f.stat().st_mtime)
    except Exception:
        bk = []
    if bk:
        add("backups", "Cópias da biblioteca", True, f"{len(bk)} cópia" + ("s" if len(bk) != 1 else "") + " · última em " + time.strftime("%d/%m/%Y %H:%M", time.localtime(bk[-1].stat().st_mtime)))
    else:
        add("backups", "Cópias da biblioteca", True, "nenhuma cópia ainda — a primeira é feita ao abrir o launcher", warn=bool(lib))
    cfg = store.config
    add("ui", "Interface", not UI_ERRORS, f"tema {cfg.get('theme', 'system')} · navegação {cfg.get('nav_pos', 'left')} · animações {cfg.get('animations', 'full')}" + (f" · {len(UI_ERRORS)} erro(s) de interface nesta sessão" if UI_ERRORS else ""), warn=bool(UI_ERRORS))
    try:
        online = ludrix.online()
    except Exception:
        online = False
    add("online", "Internet", True, "conectado" if online else "sem conexão (o Ludrix funciona offline; Store e capas ficam indisponíveis)", warn=not online)
    add("safe", "Modo seguro", True, "ativo nesta sessão" if getattr(ludrix, "safe_mode", False) else "não", warn=bool(getattr(ludrix, "safe_mode", False)))
    tail = log_tail(30)
    ok = all(c["ok"] for c in checks)
    lines = [f"LudrixHub {ver} — diagnóstico {time.strftime('%Y-%m-%d %H:%M')}"]
    for c in checks:
        mark = "OK " if c["ok"] and not c["warn"] else ("!! " if c["ok"] else "XX ")
        lines.append(f"{mark}{c['name']}: {c['detail']}")
    if UI_ERRORS:
        lines += ["", "--- erros de interface ---", *UI_ERRORS[-10:]]
    if tail:
        lines += ["", "--- últimas linhas do log ---", *tail]
    return {"ok": ok, "checks": checks, "log": tail, "text": "\n".join(lines)}


def selftest(ludrix, port: int, token: str) -> tuple[bool, str]:
    import urllib.request
    ok = True
    notes = []
    for route in ("/", "/api/config", "/api/emulation", "/api/flash", "/api/repos", "/api/updates"):
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{port}{route}", headers={"X-Ludrix-Token": token})
            with urllib.request.urlopen(req, timeout=10) as r:
                if r.status != 200:
                    ok = False
                    notes.append(f"{route}: HTTP {r.status}")
        except Exception as e:
            ok = False
            notes.append(f"{route}: {e}")
    try:
        import importlib
        importlib.import_module("webview")
    except Exception as e:
        ok = False
        notes.append(f"webview: {e}")
    if os.name == "nt" and not webview2_version():
        ok = False
        notes.append("WebView2 Runtime não encontrado")
    elif sys.platform != "win32":
        try:
            importlib.import_module("webview.guilib").initialize(None)
        except Exception as e:
            ok = False
            notes.append(f"janela: {e}")
    rep = report(ludrix, api_ok=not any(n.startswith("/") for n in notes))
    text = rep["text"] + ("\n\n--- selftest ---\n" + "\n".join(notes) if notes else "\n\n--- selftest --- OK")
    try:
        paths.DATA.mkdir(parents=True, exist_ok=True)
        (paths.DATA / "selftest.txt").write_text(text, encoding="utf-8")
    except OSError:
        pass
    return ok and rep["ok"], text
