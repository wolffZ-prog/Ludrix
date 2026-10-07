from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import subprocess
import sys
import threading
import time
import zipfile

from pathlib import Path

import lxsign

from . import paths

log = logging.getLogger("updates")

PROTECTED = ("data", "cache", "games", "emulation", "downloads", "themes", "flash", "bin", "tools", "updates")
VERSION_FILE = paths.APP / "version.json"


def parse_version(v: str) -> tuple:
    nums = [int(x) for x in re.findall(r"\d+", str(v or "0"))[:4]]
    return tuple(nums + [0] * (3 - len(nums)))


def current_version() -> dict:
    try:
        return json.loads(VERSION_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"version": "0.0.0", "channel": "stable"}


def sha256_of(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_manifest(pkg: Path) -> dict:
    if not pkg.exists():
        raise ValueError("Arquivo não encontrado")
    try:
        with zipfile.ZipFile(pkg) as z:
            names = set(z.namelist())
            if "manifest.json" not in names:
                raise ValueError("Esse arquivo não é uma atualização do Ludrix")
            m = json.loads(z.read("manifest.json").decode("utf-8"))
            if not m.get("version") or m.get("kind") not in ("patch", "full"):
                raise ValueError("Pacote de atualização inválido — baixe de novo")
            for d in m.get("dirs") or []:
                if d in PROTECTED or "/" in d or d.startswith("."):
                    raise ValueError(f"Pacote tenta mexer numa pasta protegida: {d}")
                if not any(n.startswith(d + "/") for n in names):
                    raise ValueError(f"Pacote incompleto: falta a pasta {d}/")
            for f in (m.get("files") or {}):
                if f not in names:
                    raise ValueError(f"Pacote incompleto: falta {f}")
            if (m.get("kind") == "patch") and "app" not in (m.get("dirs") or []):
                raise ValueError("Patch sem a pasta app/")
            signed = lxsign.status(pkg)
            if signed == "none":
                raise ValueError("Esse pacote não tem a assinatura do Ludrix — por segurança, não instalo")
            if signed != "ok":
                raise ValueError("A assinatura desse pacote não confere — o arquivo foi alterado ou não veio do Ludrix")
            m["_path"] = str(pkg)
            m["_size"] = pkg.stat().st_size
            return m
    except zipfile.BadZipFile:
        raise ValueError("O arquivo está danificado — baixe de novo")


MAX_UPDATE_BYTES = 600 * 1024 * 1024
DEFAULT_FEED = "https://github.com/wolffZ-prog/Ludrix/releases/latest/download/ludrix-updates.json"

class UpdateManager:
    def __init__(self, store, session):
        self.store = store
        self.session = session
        self.available: dict | None = None
        self.remote: dict | None = None
        self.state = {"busy": False, "text": "", "error": "", "checked_at": 0.0}
        self._lock = threading.Lock()

    def status(self) -> dict:
        cur = current_version()
        last = self._last_result()
        return {"current": cur, "available": self._pub(self.available), "remote": self.remote, "state": dict(self.state),
                "feed": self.store.config.get("update_feed", ""), "default_feed": DEFAULT_FEED, "last_result": last,
                "updater_present": bool(self._updater_cmd()), "frozen": paths.FROZEN}

    @staticmethod
    def _pub(m: dict | None):
        if not m:
            return None
        return {k: v for k, v in m.items() if not k.startswith("_")} | {"path": m.get("_path"), "size": m.get("_size")}

    def _last_result(self):
        p = paths.UPDATES / "last_result.json"
        try:
            r = json.loads(p.read_text(encoding="utf-8"))
            if r.get("shown"):
                return None
            return r
        except Exception:
            return None

    def ack_result(self):
        p = paths.UPDATES / "last_result.json"
        try:
            r = json.loads(p.read_text(encoding="utf-8"))
            r["shown"] = True
            p.write_text(json.dumps(r), encoding="utf-8")
        except Exception:
            pass
        return {"ok": True}

    def check(self, online: bool = True) -> dict:
        cur = parse_version(current_version().get("version"))
        self.state.update(error="", text="Procurando…")
        best = None
        for f in sorted(paths.UPDATES.glob("*.lxup")):
            try:
                m = read_manifest(f)
            except ValueError as e:
                log.info("ignorando %s: %s", f.name, e)
                continue
            v = parse_version(m["version"])
            if v > cur and self._applies(m) and (not best or v > parse_version(best["version"])):
                best = m
        self.available = best
        self.remote = None
        feed = (self.store.config.get("update_feed") or "").strip() or DEFAULT_FEED
        if feed and online and not feed.lower().startswith("https://"):
            self.state["error"] = "O endereço de atualizações precisa começar com https://"
            feed = ""
        if feed and online:
            try:
                r = self.session.get(feed, timeout=12, headers={"Cache-Control": "no-cache"})
                r.raise_for_status()
                data = r.json() or {}
                pick = None
                for it in [data.get("latest") or {}] + list(data.get("all") or []):
                    if not isinstance(it, dict) or not it.get("url"):
                        continue
                    v = parse_version(it.get("version"))
                    if v <= cur or (pick and v <= parse_version(pick["version"])):
                        continue
                    if it.get("min_version") and parse_version(it["min_version"]) > cur and it.get("kind") != "full":
                        continue
                    pick = it
                if pick and (not best or parse_version(pick["version"]) > parse_version(best["version"])):
                    self.remote = pick
            except Exception as e:
                self.state["error"] = f"Não consegui consultar o endereço de atualizações ({e})"
                log.warning("feed: %s", e)
        self.state.update(text="", checked_at=time.time())
        return self.status()

    def _applies(self, m: dict) -> bool:
        if m.get("kind") == "full":
            return True
        mv = m.get("min_version")
        return not mv or parse_version(mv) <= parse_version(current_version().get("version"))

    def download(self, progress_cb=None) -> dict:
        rem = self.remote
        if not rem:
            return {"error": "Nenhuma atualização remota"}
        dest = paths.UPDATES / f"ludrix-{rem['version']}-{rem.get('kind', 'patch')}.lxup"
        tmp = dest.with_suffix(".part")
        self.state.update(busy=True, text="Baixando atualização…", error="")
        try:
            url = str(rem.get("url") or "")
            if not url.lower().startswith("https://"):
                raise ValueError("Atualização recusada: o endereço não usa https")
            with self.session.get(url, stream=True, timeout=60) as r:
                r.raise_for_status()
                total = int(r.headers.get("Content-Length") or 0)
                if total > MAX_UPDATE_BYTES:
                    raise ValueError("Atualização recusada: arquivo grande demais")
                got = 0
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1 << 16):
                        f.write(chunk)
                        got += len(chunk)
                        if got > MAX_UPDATE_BYTES:
                            raise ValueError("Atualização recusada: arquivo grande demais")
                        if progress_cb and total:
                            progress_cb(got / total)
            if rem.get("sha256") and sha256_of(tmp).lower() != rem["sha256"].lower():
                tmp.unlink(missing_ok=True)
                raise ValueError("O arquivo baixado veio diferente do esperado e foi descartado por segurança — tente de novo")
            tmp.replace(dest)
            self.available = read_manifest(dest)
            self.remote = None
            return {"ok": True, "available": self._pub(self.available)}
        except Exception as e:
            self.state["error"] = str(e)
            return {"error": str(e)}
        finally:
            self.state.update(busy=False, text="")

    def add_file(self, path: str | None) -> dict:
        if not path:
            return {"error": "Nenhum arquivo"}
        src = Path(path)
        try:
            m = read_manifest(src)
        except ValueError as e:
            return {"error": str(e)}
        cur = parse_version(current_version().get("version"))
        if parse_version(m["version"]) <= cur:
            return {"error": f"Esse pacote é da versão {m['version']} — você já está na {current_version().get('version')}"}
        if not self._applies(m):
            return {"error": f"Esse patch precisa da versão {m.get('min_version')} instalada antes"}
        dest = paths.UPDATES / src.name
        if src.resolve() != dest.resolve():
            import shutil
            shutil.copy2(src, dest)
        self.available = read_manifest(dest)
        return {"ok": True, "available": self._pub(self.available)}

    def _updater_cmd(self) -> list[str] | None:
        exe = paths.ROOT / "updater.exe"
        py = paths.APP / "updater.py"
        if os.name == "nt" and exe.exists():
            return [str(exe)]
        if py.exists() or py.with_suffix(".pyc").exists():
            if paths.FROZEN:
                return [sys.executable, "--run-updater"]
            return [sys.executable, str(py)]
        return None

    @staticmethod
    def read_restore(path: str | None, allow_same: bool = False) -> dict:
        if not path:
            return {"error": "Nenhum arquivo"}
        p = Path(path)
        if not p.exists():
            return {"error": "Arquivo não encontrado"}
        try:
            import importlib
            up = importlib.import_module("updater")
            m = up.Restore(p, paths.ROOT, lambda s: None, lambda f, t: None).read()
        except zipfile.BadZipFile:
            return {"error": "O arquivo está danificado"}
        except Exception as e:
            return {"error": str(e)}
        cur = current_version().get("version", "")
        same = parse_version(m["version"]) == parse_version(cur)
        if same and not allow_same:
            return {"error": f"Essa já é a versão instalada ({cur})"}
        return {"ok": True, "version": m["version"], "current": cur, "same": same, "newer": parse_version(m["version"]) > parse_version(cur),
                "changelog": m.get("changelog", ""), "path": str(p)}

    def apply(self, relaunch: bool = True, restore: str | None = None) -> dict:
        if paths.APPIMAGE:
            return {"error": "No AppImage a atualização é trocar o arquivo .AppImage pelo novo."}
        if restore:
            r = self.read_restore(restore)
            if r.get("error"):
                return r
            path = restore
        else:
            m = self.available
            if not m:
                return {"error": "Nenhuma atualização pronta pra aplicar"}
            path = m["_path"]
        cmd = self._updater_cmd()
        if not cmd:
            return {"error": "O atualizador (updater) não está na pasta do launcher — extraia o pacote completo de novo por cima"}
        launcher = [sys.executable] if paths.FROZEN else [sys.executable, str(paths.APP / "main.py")]
        args = cmd + ["--restore" if restore else "--apply", path, "--root", str(paths.ROOT), "--wait-pid", str(os.getpid()),
                      "--from", current_version().get("version", "?")]
        if relaunch:
            args += ["--relaunch", json.dumps(launcher)]
        flags = 0
        if os.name == "nt":
            flags = 0x00000008 | 0x00000200
        try:
            subprocess.Popen(args, cwd=str(paths.ROOT), creationflags=flags, close_fds=True)
        except Exception as e:
            return {"error": f"Não consegui abrir o updater: {e}"}

        threading.Timer(6.0, lambda: os._exit(0)).start()
        return {"ok": True, "quit": True}
