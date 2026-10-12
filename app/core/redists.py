from __future__ import annotations

import json
import logging
import os
import subprocess
import threading
import time
import zipfile
from pathlib import Path

from . import paths
from .installer import CancelledError, Downloader, FileRef, Progress, safe_member

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


class WinePrefix:
    def __init__(self, pfx: Path):
        self.pfx = pfx
        self._reg = None

    def exists(self) -> bool:
        return (self.pfx / "system.reg").is_file()

    def _keys(self) -> dict:
        if self._reg is None:
            reg, cur = {}, None
            try:
                for line in (self.pfx / "system.reg").read_text(encoding="utf-8", errors="replace").splitlines():
                    if line.startswith("["):
                        cur = line[1:line.rfind("]")].replace("\\\\", "\\").lower()
                        reg[cur] = {}
                    elif cur and line.startswith('"') and "=" in line:
                        k, _, v = line.partition("=")
                        reg[cur][k.strip('"').lower()] = v.strip()
            except OSError:
                pass
            self._reg = reg
        return self._reg

    def reg_exists(self, path: str, wow: bool = False, value: str | None = None, minimum: int | None = None) -> bool | None:
        if not self.exists():
            return None
        root, _, sub = path.partition("\\")
        if root != "HKLM":
            return None
        sub = sub.lower()
        if sub.startswith("software\\wow6432node\\"):
            cands = [sub, "software\\" + sub[21:]]
        elif sub.startswith("software\\"):
            cands = [sub, "software\\wow6432node\\" + sub[9:]]
        else:
            cands = [sub]
        keys = self._keys()
        for c in cands:
            vals = keys.get(c)
            if vals is None:
                continue
            if value is None:
                if ("runtimes" in c or "vcredist" in c) and vals.get("installed", "dword:00000001") != "dword:00000001":
                    continue
                return True
            v = vals.get(value.lower())
            if v is None:
                continue
            if minimum is not None:
                try:
                    return int(v.split(":")[1], 16) >= minimum if v.startswith("dword:") else int(v.strip('"')) >= minimum
                except ValueError:
                    return False
            return True
        return False

    def path(self, p: str) -> Path:
        p = p.replace("%WINDIR%", "C:\\windows").replace("%PROGRAMFILES(X86)%", "C:\\Program Files (x86)").replace("%PROGRAMFILES%", "C:\\Program Files")
        parts = [x for x in p.replace("/", "\\").split("\\") if x]
        cur = self.pfx / "drive_c"
        for part in parts[1:] if parts and parts[0].upper() == "C:" else parts:
            nxt = cur / part
            if not nxt.exists():
                try:
                    nxt = next((e for e in cur.iterdir() if e.name.lower() == part.lower()), nxt)
                except OSError:
                    pass
            cur = nxt
        return cur

    def file_exists(self, p: str) -> bool | None:
        if not self.exists():
            return None
        return self.path(p).exists()


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

    def detect(self, it: dict, pfx: WinePrefix | None = None) -> str:
        d = it.get("detect") or {}
        reg = pfx.reg_exists if pfx else _reg_exists
        fil = pfx.file_exists if pfx else _file_exists
        r = None
        if "reg" in d:
            r = reg(d["reg"], d.get("wow", False), d.get("value"), d.get("min"))
        elif "file" in d:
            r = fil(d["file"])
        if r is False and it.get("detect_alt"):
            a = it["detect_alt"]
            r = reg(a["reg"], a.get("wow", False)) if "reg" in a else fil(a.get("file", ""))
        return "unknown" if r is None else ("installed" if r else "missing")

    def prefix(self, config: dict | None) -> WinePrefix | None:
        if os.name == "nt":
            return None
        from . import compat
        return WinePrefix(compat.prefix_for(config or {}, None))

    def local_file(self, it: dict) -> Path:
        name = it["url"].rsplit("/", 1)[-1].split("?")[0]
        if not name.lower().endswith((".exe", ".msi", ".zip")):
            name = it["id"] + ".exe"
        return REDISTS_DIR / f"{it['id']}_{name}"

    def status(self, config: dict | None = None) -> dict:
        pfx = self.prefix(config)
        items = []
        for it in self.presets["items"]:
            lf = self.local_file(it)
            items.append({**{k: v for k, v in it.items() if k not in ("detect", "detect_alt")},
                          "state": self.detect(it, pfx), "downloaded": lf.exists(), "local": str(lf)})
        out = {"groups": self.presets["groups"], "items": items, "bundles": self.presets["bundles"],
               "dir": str(REDISTS_DIR), "windows": os.name == "nt"}
        if pfx is not None:
            out["prefix"] = str(pfx.pfx)
            out["prefix_ready"] = pfx.exists()
        return out

    def install(self, rid: str, cb, cancel: threading.Event, silent: bool = True, config: dict | None = None) -> dict:
        it = self.item(rid)
        if not it:
            raise RuntimeError("Pacote desconhecido")
        REDISTS_DIR.mkdir(parents=True, exist_ok=True)
        dest = self.local_file(it)
        if not dest.exists():
            cb(Progress("download", 0, f"Baixando {it['title']} ({it['arch']})"))
            self.dl.download(FileRef(name=dest.name, url=it["url"], size=it.get("size", 0)), dest, cb, cancel)
        if os.name != "nt":
            return self._install_wine(it, dest, cb, cancel, config or {})
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

    def _install_wine(self, it: dict, dest: Path, cb, cancel: threading.Event, config: dict) -> dict:
        from . import compat
        st = compat.status(config)
        if st.get("error"):
            raise RuntimeError(st["error"])
        if not st.get("ready"):
            r = compat.prepare(config, lambda t, f: cb(Progress("download", f, t)), cancel)
            if r.get("error"):
                raise RuntimeError(r["error"])
        pfx = self.prefix(config)
        exe = dest
        if it.get("kind") == "zip_exe":
            with zipfile.ZipFile(dest) as z:
                inner = it.get("inner") or next(n for n in z.namelist() if n.lower().endswith(".exe"))
                exe = safe_member(REDISTS_DIR / it["id"], inner)
                exe.parent.mkdir(parents=True, exist_ok=True)
                exe.write_bytes(z.read(inner))
        cb(Progress("extract", -1, f"Instalando {it['title']} ({it['arch']}) no prefixo do Proton…"))

        def run(cmd: list[str], timeout: int = 1800) -> int:
            wrapped, env, _ = compat.wrap(cmd, config, None)
            p = subprocess.Popen(wrapped, env=env, cwd=str(REDISTS_DIR), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            t0 = time.time()
            while p.poll() is None:
                if cancel.is_set():
                    p.kill()
                    raise CancelledError()
                if time.time() - t0 > timeout:
                    p.kill()
                    raise RuntimeError("o instalador não terminou a tempo")
                time.sleep(1)
            return p.returncode

        if it.get("kind") == "dx":
            tmp = REDISTS_DIR / "dx_extract"
            tmp.mkdir(exist_ok=True)
            run([str(exe), "/Q", f"/T:Z:{str(tmp).replace('/', chr(92))}"], 900)
            setup = tmp / "DXSETUP.exe"
            if not setup.exists():
                raise RuntimeError("DXSETUP.exe não apareceu após extrair")
            rc = run([str(setup), "/silent"])
        elif it.get("kind") == "msi_in_exe":
            msi = REDISTS_DIR / f"{it['id']}.msi"
            if not msi.exists() or msi.stat().st_size != it["msi_size"]:
                with open(exe, "rb") as f:
                    f.seek(it["msi_offset"])
                    msi.write_bytes(f.read(it["msi_size"]))
            rc = run(["msiexec.exe", "/i", str(msi)] + (it.get("silent") or ["/quiet", "/norestart"]))
        elif it.get("kind") == "msi" or exe.suffix.lower() == ".msi":
            rc = run(["msiexec.exe", "/i", str(exe)] + (it.get("silent") or ["/quiet", "/norestart"]))
        else:
            rc = run([str(exe)] + (it.get("silent") or []))
        pfx._reg = None
        state = self.detect(it, pfx)
        if rc not in (0, 3010, 1638, 5100, 1641) and state != "installed":
            raise RuntimeError(f"O instalador devolveu código {rc} dentro do Proton")
        return {"dir": str(REDISTS_DIR), "rc": rc, "state": state, "restart": False}
