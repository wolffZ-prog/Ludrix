from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
from pathlib import Path
import time

from . import paths
from .installer import CancelledError, Progress
from .redists import _file_exists, _reg_exists

WINGET_ARGS = ["-e", "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"]


def _host_env() -> dict:
    if os.name == "nt":
        return dict(os.environ)
    from . import compat
    return compat.host_env()


def winget_path() -> str | None:
    if os.name != "nt":
        return None
    p = shutil.which("winget")
    if p:
        return p

    cand = os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe")
    return cand if os.path.exists(cand) else None


class OptionalsManager:
    def __init__(self):
        self._presets: dict | None = None
        self._listed: dict[str, str] = {}
        self._listed_at = 0.0
        self._lock = threading.Lock()

    @property
    def presets(self) -> dict:
        if self._presets is None:
            self._presets = json.loads((paths.PRESETS / "optionals.json").read_text(encoding="utf-8"))
        return self._presets

    def items(self) -> list[dict]:
        return self.presets["items"] if os.name == "nt" else self.presets.get("linux_items", [])

    def item(self, iid: str) -> dict | None:
        return next((i for i in self.items() if i["id"] == iid), None)

    def _flatpak_list(self) -> str | None:
        fp = shutil.which("flatpak")
        if not fp:
            return None
        with self._lock:
            if self._listed and time.time() - self._listed_at < 600:
                return self._listed.get("_")
        try:
            r = subprocess.run([fp, "list", "--app", "--columns=application"], capture_output=True, text=True, errors="replace", timeout=30, env=_host_env())
            out = (r.stdout or "").lower()
        except Exception:
            return None
        with self._lock:
            self._listed = {"_": out}
            self._listed_at = time.time()
        return out

    def _detect_linux(self, it: dict) -> str:
        env = _host_env()
        for b in it.get("bin") or []:
            if shutil.which(b, path=env.get("PATH")):
                return "installed"
        fid = (it.get("flatpak") or "").split("//")[0]
        if fid:
            lst = self._flatpak_list()
            if lst is not None and fid.lower() in lst:
                return "installed"
            for base in (Path.home() / ".local/share/flatpak/exports/bin", Path("/var/lib/flatpak/exports/bin")):
                if (base / fid).exists():
                    return "installed"
        return "missing"

    def _winget_ids(self) -> str | None:
        wg = winget_path()
        if not wg:
            return None
        with self._lock:
            if self._listed and time.time() - self._listed_at < 600:
                return self._listed.get("_")
        try:
            r = subprocess.run([wg, "list", "--accept-source-agreements", "--disable-interactivity"], capture_output=True, text=True,
                               errors="replace", timeout=90, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            out = (r.stdout or "").lower()
        except Exception:
            return None
        with self._lock:
            self._listed = {"_": out}
            self._listed_at = time.time()
        return out

    def detect(self, it: dict, use_winget: bool = False) -> str:
        if os.name != "nt":
            return self._detect_linux(it)
        d = it.get("detect") or {}
        r = None
        if "reg" in d:
            r = _reg_exists(d["reg"], d.get("wow", False), d.get("value"), d.get("min"))
        elif "file" in d:
            r = _file_exists(d["file"])
        if r is None and use_winget and it.get("winget"):
            ids = self._winget_ids()
            r = None if ids is None else all(p.lower() in ids for p in it["winget"])
        return "unknown" if r is None else ("installed" if r else "missing")

    def status(self, deep: bool = False) -> dict:
        wg = winget_path()
        if deep and os.name != "nt":
            with self._lock:
                self._listed.clear()
        items = [{**{k: v for k, v in it.items() if k != "detect"}, "state": self.detect(it, use_winget=deep)} for it in self.items()]
        if os.name != "nt":
            return {"groups": self.presets.get("linux_groups", []), "items": items, "winget": False, "windows": False,
                    "flatpak": bool(shutil.which("flatpak")), "store_url": "", "winget_store": ""}
        return {"groups": self.presets["groups"], "items": items, "winget": bool(wg), "windows": os.name == "nt",
                "store_url": "ms-windows-store://pdp/?ProductId=", "winget_store": "ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1"}

    def install(self, iid: str, cb, cancel: threading.Event) -> dict:
        it = self.item(iid)
        if not it:
            raise RuntimeError("Programa desconhecido")
        if os.name != "nt":
            fid = it.get("flatpak")
            if not fid:
                raise RuntimeError(f"Instale pela sua distro: {it.get('pkg') or it['title']}")
            self.install_flatpak(fid, cb, cancel)
            return {"state": self.detect(it), "item": iid}
        pkgs = it.get("winget") or []
        if not pkgs:
            raise RuntimeError("Este item só está disponível pela Microsoft Store")
        self.install_pkgs(pkgs, cb, cancel)
        return {"state": self.detect(it, use_winget=True), "item": iid}

    def install_flatpak(self, fid: str, cb, cancel: threading.Event):
        fp = shutil.which("flatpak")
        if not fp:
            raise RuntimeError("flatpak não encontrado. Instale o Flatpak pela sua distro (flatpak.org/setup) e tente de novo")
        env = _host_env()
        subprocess.run([fp, "remote-add", "--user", "--if-not-exists", "flathub", "https://dl.flathub.org/repo/flathub.flatpakrepo"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120, env=env)
        cb(Progress("install", 0.05, f"flatpak: instalando {fid}…"))
        proc = subprocess.Popen([fp, "install", "--user", "-y", "--noninteractive", "flathub", fid], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, errors="replace", env=env)
        last = ""
        while True:
            line = proc.stdout.readline() if proc.stdout else ""
            if not line and proc.poll() is not None:
                break
            if cancel.is_set():
                proc.kill()
                raise CancelledError()
            line = re.sub(r"[\r\x08\u2588\u2592\u2591\-\\|/]+", " ", line).strip()
            m = re.search(r"(\d{1,3})%", line)
            if line and line != last:
                last = line
                cb(Progress("install", min(0.95, int(m.group(1)) / 100) if m else -1, f"{fid.split('//')[0]}: {line[:90]}"))
        if proc.returncode != 0:
            raise RuntimeError(f"flatpak devolveu código {proc.returncode}. {last}".strip())
        with self._lock:
            self._listed.clear()

    def install_pkgs(self, pkgs: list[str], cb, cancel: threading.Event):
        wg = winget_path()
        if not wg:
            raise RuntimeError("winget não encontrado. Instale o \"Instalador de Aplicativo\" pela Microsoft Store e tente de novo")
        n = len(pkgs)
        for k, pkg in enumerate(pkgs):
            if cancel.is_set():
                raise CancelledError()
            cb(Progress("install", (k + 0.1) / n, f"winget: instalando {pkg}…"))
            proc = subprocess.Popen([wg, "install", "--id", pkg] + WINGET_ARGS, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, errors="replace", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            last = ""
            while True:
                line = proc.stdout.readline() if proc.stdout else ""
                if not line and proc.poll() is not None:
                    break
                if cancel.is_set():
                    proc.kill()
                    raise CancelledError()
                line = re.sub(r"[\r\x08\u2588\u2592\u2591\-\\|/]+", " ", line).strip()
                if line and line != last:
                    last = line
                    cb(Progress("install", (k + 0.5) / n, f"{pkg}: {line[:90]}"))
            rc = proc.returncode

            if rc not in (0, -1978335189, -1978335135, -1978335212):
                raise RuntimeError(f"winget devolveu código {rc} em {pkg}. {last}".strip())
        with self._lock:
            self._listed.clear()
