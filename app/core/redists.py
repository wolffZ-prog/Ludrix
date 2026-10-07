from __future__ import annotations

import json
import logging
import os
import subprocess
import threading
import zipfile
from pathlib import Path

from . import paths
from .installer import Downloader, FileRef, Progress, safe_member

log = logging.getLogger(__name__)

REDISTS_DIR = paths.REDISTS


def _reg_exists(path: str, wow: bool = False, value: str | None = None, minimum: int | None = None) -> bool | None:
    if os.name != "nt":
        return None
    import winreg
    root_name, _, sub = path.partition("\\")
    root = {"HKLM": winreg.HKEY_LOCAL_MACHINE, "HKCU": winreg.HKEY_CURRENT_USER}.get(root_name, winreg.HKEY_LOCAL_MACHINE)
    views = [winreg.KEY_READ | winreg.KEY_WOW64_64KEY]
    if wow:
        views.append(winreg.KEY_READ | winreg.KEY_WOW64_32KEY)
    for access in views:
        try:
            with winreg.OpenKey(root, sub, 0, access) as k:
                if value is None:
                    if sub.lower().endswith(("\\x86", "\\x64")) or "Runtimes" in sub or "VCRedist" in sub:
                        try:
                            v, _ = winreg.QueryValueEx(k, "Installed")
                            if int(v) != 1:
                                continue
                        except OSError:
                            pass
                    return True
                v, _ = winreg.QueryValueEx(k, value)
                if minimum is not None:
                    return int(v) >= minimum
                return True
        except OSError:
            continue
    return False


def _file_exists(p: str) -> bool | None:
    if os.name != "nt":
        return None
    return Path(os.path.expandvars(p)).exists()


class RedistManager:
    def __init__(self, session):
        self.dl = Downloader(session)
        self._presets = None
        self._lock = threading.Lock()

    @property
    def presets(self) -> dict:
        if self._presets is None:
            f = paths.PRESETS / "redists.json"
            self._presets = json.loads(f.read_text(encoding="utf-8-sig"))
        return self._presets

    def item(self, rid: str) -> dict | None:
        return next((x for x in self.presets["items"] if x["id"] == rid), None)

    def detect(self, it: dict) -> str:
        d = it.get("detect") or {}
        r = None
        if "reg" in d:
            r = _reg_exists(d["reg"], d.get("wow", False), d.get("value"), d.get("min"))
        elif "file" in d:
            r = _file_exists(d["file"])
        if r is False and it.get("detect_alt"):
            a = it["detect_alt"]
            r = _reg_exists(a["reg"], a.get("wow", False)) if "reg" in a else _file_exists(a.get("file", ""))
        return "unknown" if r is None else ("installed" if r else "missing")

    def local_file(self, it: dict) -> Path:
        name = it["url"].rsplit("/", 1)[-1].split("?")[0]
        if not name.lower().endswith((".exe", ".msi", ".zip")):
            name = it["id"] + ".exe"
        return REDISTS_DIR / f"{it['id']}_{name}"

    def status(self) -> dict:
        items = []
        for it in self.presets["items"]:
            lf = self.local_file(it)
            items.append({**{k: v for k, v in it.items() if k not in ("detect", "detect_alt")},
                          "state": self.detect(it), "downloaded": lf.exists(), "local": str(lf)})
        return {"groups": self.presets["groups"], "items": items, "bundles": self.presets["bundles"],
                "dir": str(REDISTS_DIR), "windows": os.name == "nt"}

    def install(self, rid: str, cb, cancel: threading.Event, silent: bool = True) -> dict:
        it = self.item(rid)
        if not it:
            raise RuntimeError("Pacote desconhecido")
        REDISTS_DIR.mkdir(parents=True, exist_ok=True)
        dest = self.local_file(it)
        if not dest.exists():
            cb(Progress("download", 0, f"Baixando {it['title']} ({it['arch']})"))
            self.dl.download(FileRef(name=dest.name, url=it["url"], size=it.get("size", 0)), dest, cb, cancel)
        if os.name != "nt":
            return {"dir": str(REDISTS_DIR), "note": "Instalação só no Windows; arquivo baixado."}
        exe = dest
        if it.get("kind") == "zip_exe":
            with zipfile.ZipFile(dest) as z:
                inner = it.get("inner") or next(n for n in z.namelist() if n.lower().endswith(".exe"))
                exe = safe_member(REDISTS_DIR / it["id"], inner)
                exe.parent.mkdir(parents=True, exist_ok=True)
                exe.write_bytes(z.read(inner))
        cb(Progress("extract", -1, f"Instalando {it['title']} ({it['arch']})…"))
        if it.get("kind") == "dx":

            tmp = REDISTS_DIR / "dx_extract"
            tmp.mkdir(exist_ok=True)
            subprocess.run([str(exe), "/Q", f"/T:{tmp}"], check=False, timeout=900)
            setup = tmp / "DXSETUP.exe"
            if not setup.exists():
                raise RuntimeError("DXSETUP.exe não apareceu após extrair")
            cmd = [str(setup), "/silent"]
        elif it.get("kind") == "msi_in_exe":

            msi = REDISTS_DIR / f"{it['id']}.msi"
            if not msi.exists() or msi.stat().st_size != it["msi_size"]:
                with open(exe, "rb") as f:
                    f.seek(it["msi_offset"])
                    data = f.read(it["msi_size"])
                if not data.startswith(b"\xd0\xcf\x11\xe0"):
                    raise RuntimeError("O pacote baixado não bate com o esperado (sem MSI no lugar certo)")
                msi.write_bytes(data)
            cmd = ["msiexec", "/i", str(msi)] + (it.get("silent") or ["/quiet", "/norestart"])
        elif it.get("kind") == "msi" or exe.suffix.lower() == ".msi":
            cmd = ["msiexec", "/i", str(exe)] + (it.get("silent") or ["/quiet", "/norestart"])
        else:
            cmd = [str(exe)] + (it.get("silent") or [] if silent else [])
        rc = subprocess.run(cmd, check=False, timeout=1800).returncode

        if rc not in (0, 3010, 1638, 5100, 1641):
            state = self.detect(it)
            if state == "installed":
                return {"dir": str(REDISTS_DIR), "rc": rc, "state": state, "restart": False}
            why = {1603: "o Windows recusou a instalação: normalmente já existe uma versão mais nova, ou faltou permissão de administrador", 1602: "instalação cancelada", 1618: "outra instalação está em andamento; espere ela terminar", 1633: "pacote de outra arquitetura", 5: "faltou permissão de administrador"}.get(rc, "")
            raise RuntimeError(f"O instalador devolveu código {rc}" + (f" ({why})" if why else ""))
        state = self.detect(it)
        return {"dir": str(REDISTS_DIR), "rc": rc, "state": state, "restart": rc == 3010}
