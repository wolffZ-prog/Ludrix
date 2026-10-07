from __future__ import annotations

import ctypes
import os
import platform
import re
import shutil
import subprocess
import time
from pathlib import Path

from . import paths

_cache: dict = {"t": 0, "v": None}


def _reg_read(root, subkey: str, name: str):
    try:
        import winreg
        with winreg.OpenKey(root, subkey) as k:
            return winreg.QueryValueEx(k, name)[0]
    except Exception:
        return None


def _cpu() -> dict:
    name, mhz = "", 0
    if os.name == "nt":
        import winreg
        name = _reg_read(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0", "ProcessorNameString") or ""
        mhz = _reg_read(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0", "~MHz") or 0
    else:
        try:
            for line in Path("/proc/cpuinfo").read_text(errors="ignore").splitlines():
                if line.lower().startswith("model name"):
                    name = line.split(":", 1)[1].strip()
                    break
        except Exception:
            pass
    name = re.sub(r"\s+", " ", name or platform.processor() or "CPU").replace("(R)", "").replace("(TM)", "").strip()
    logical = os.cpu_count() or 0
    physical = 0
    if os.name == "nt":
        try:
            class REL(ctypes.Structure):
                _fields_ = [("ProcessorMask", ctypes.c_size_t), ("Relationship", ctypes.c_int), ("Reserved", ctypes.c_ulonglong * 2)]
            n = ctypes.c_ulong(0)
            ctypes.windll.kernel32.GetLogicalProcessorInformation(None, ctypes.byref(n))
            cnt = n.value // ctypes.sizeof(REL)
            buf = (REL * cnt)()
            if ctypes.windll.kernel32.GetLogicalProcessorInformation(buf, ctypes.byref(n)):
                physical = sum(1 for r in buf if r.Relationship == 0)
        except Exception:
            physical = 0
    else:
        try:
            ids = set()
            cur = {}
            for line in Path("/proc/cpuinfo").read_text(errors="ignore").splitlines():
                if ":" in line:
                    k, v = [x.strip() for x in line.split(":", 1)]
                    cur[k] = v
                elif not line.strip():
                    if "core id" in cur:
                        ids.add((cur.get("physical id", "0"), cur["core id"]))
                    cur = {}
            physical = len(ids)
        except Exception:
            physical = 0
    return {"name": name, "cores": physical or logical, "threads": logical, "mhz": int(mhz or 0)}


def _ram() -> dict:
    total = avail = 0
    if os.name == "nt":
        class MS(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong), ("ullTotalPhys", ctypes.c_ulonglong),
                        ("ullAvailPhys", ctypes.c_ulonglong), ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong), ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
        ms = MS()
        ms.dwLength = ctypes.sizeof(MS)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(ms)):
            total, avail = ms.ullTotalPhys, ms.ullAvailPhys
    else:
        try:
            info = {}
            for line in Path("/proc/meminfo").read_text().splitlines():
                k, v = line.split(":", 1)
                info[k] = int(v.strip().split()[0]) * 1024
            total, avail = info.get("MemTotal", 0), info.get("MemAvailable", 0)
        except Exception:
            pass
    return {"total": total, "available": avail}


def _gpus() -> list[dict]:
    out: list[dict] = []
    if os.name == "nt":
        import winreg
        base = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}"
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, base) as k:
                i = 0
                while True:
                    try:
                        sub = winreg.EnumKey(k, i)
                    except OSError:
                        break
                    i += 1
                    if not re.fullmatch(r"\d{4}", sub):
                        continue
                    desc = _reg_read(winreg.HKEY_LOCAL_MACHINE, base + "\\" + sub, "DriverDesc")
                    if not desc:
                        continue
                    vram = _reg_read(winreg.HKEY_LOCAL_MACHINE, base + "\\" + sub, "HardwareInformation.qwMemorySize")
                    if not vram:
                        v = _reg_read(winreg.HKEY_LOCAL_MACHINE, base + "\\" + sub, "HardwareInformation.MemorySize")
                        if isinstance(v, (bytes, bytearray)):
                            v = int.from_bytes(v[:8], "little")
                        vram = v or 0
                    drv = _reg_read(winreg.HKEY_LOCAL_MACHINE, base + "\\" + sub, "DriverVersion") or ""
                    if not any(g["name"] == desc for g in out):
                        out.append({"name": str(desc), "vram": int(vram or 0), "driver": str(drv)})
        except Exception:
            pass
    else:
        lspci = shutil.which("lspci")
        if lspci:
            try:
                txt = subprocess.run([lspci], capture_output=True, text=True, timeout=3).stdout
                for line in txt.splitlines():
                    if re.search(r"VGA|3D controller|Display controller", line):
                        name = line.split(":", 2)[-1].strip()
                        name = re.sub(r"\s*\(rev \w+\)$", "", name)
                        out.append({"name": name, "vram": 0, "driver": ""})
            except Exception:
                pass

        cards = []
        for card in sorted(Path("/sys/class/drm").glob("card[0-9]")):
            try:
                vendor = (card / "device/vendor").read_text().strip()
                dev = (card / "device/device").read_text().strip()
                vram = 0
                for f in ("device/mem_info_vram_total",):
                    if (card / f).exists():
                        vram = int((card / f).read_text().strip() or 0)
                drv = ""
                lnk = card / "device/driver"
                if lnk.exists():
                    drv = os.path.basename(os.path.realpath(lnk))
                cards.append({"name": f"GPU {vendor}:{dev}", "vram": vram, "driver": drv})
            except Exception:
                pass
        if not out:
            out = cards
        else:
            for g, c in zip(out, cards):
                g["vram"] = g["vram"] or c["vram"]
                g["driver"] = g["driver"] or c["driver"]
    return out


def _os() -> dict:
    name = platform.system()
    ver = platform.release()
    build = platform.version()
    if os.name == "nt":
        import winreg
        prod = _reg_read(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion", "ProductName") or f"Windows {ver}"
        disp = _reg_read(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion", "DisplayVersion") or ""
        bn = _reg_read(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion", "CurrentBuildNumber") or ""
        try:
            if bn and int(bn) >= 22000 and "Windows 10" in prod:
                prod = prod.replace("Windows 10", "Windows 11")
        except ValueError:
            pass
        name = f"{prod} {disp}".strip()
        build = str(bn)
    else:
        try:
            for line in Path("/etc/os-release").read_text().splitlines():
                if line.startswith("PRETTY_NAME="):
                    name = line.split("=", 1)[1].strip().strip('"')
        except Exception:
            pass
    return {"name": name, "version": ver, "build": build, "arch": platform.machine(), "python": platform.python_version()}


def _disks() -> list[dict]:
    out = []
    if os.name == "nt":
        mask = ctypes.windll.kernel32.GetLogicalDrives()
        for i in range(26):
            if not mask & (1 << i):
                continue
            d = f"{chr(65 + i)}:\\"
            if ctypes.windll.kernel32.GetDriveTypeW(d) != 3:
                continue
            try:
                u = shutil.disk_usage(d)
                out.append({"mount": d, "total": u.total, "free": u.free, "launcher": str(paths.ROOT).upper().startswith(d.upper())})
            except OSError:
                pass
    else:
        seen = set()
        for m in ["/", str(Path.home()), str(paths.ROOT)]:
            try:
                st = os.stat(m).st_dev
                if st in seen:
                    continue
                seen.add(st)
                u = shutil.disk_usage(m)
                out.append({"mount": m, "total": u.total, "free": u.free, "launcher": m == str(paths.ROOT)})
            except OSError:
                pass
    return out


def _screen() -> dict:
    if os.name == "nt":
        try:
            u = ctypes.windll.user32
            try:
                ctypes.windll.shcore.SetProcessDpiAwareness(1)
            except Exception:
                pass
            return {"w": u.GetSystemMetrics(0), "h": u.GetSystemMetrics(1), "monitors": u.GetSystemMetrics(80)}
        except Exception:
            return {}
    return {}


def _gamepads() -> int:
    if os.name != "nt":
        try:
            return len(list(Path("/dev/input").glob("js*")))
        except Exception:
            return 0
    try:
        from .gamepad import connected_count
        return connected_count()
    except Exception:
        return 0


def tier(hw: dict) -> dict:
    ram_gb = hw["ram"]["total"] / 2**30 if hw["ram"]["total"] else 0
    gpu = " ".join(g["name"] for g in hw["gpus"]).lower()
    vram_gb = max([g["vram"] for g in hw["gpus"]] or [0]) / 2**30
    score = 0
    score += 2 if ram_gb >= 16 else 1 if ram_gb >= 8 else 0
    score += 2 if hw["cpu"]["threads"] >= 8 else 1 if hw["cpu"]["threads"] >= 4 else 0
    dedicated = bool(re.search(r"rtx|gtx|radeon rx|arc a|arc b|geforce|rx \d{3,4}", gpu)) and not re.search(r"vega \d\b|graphics$", gpu)
    score += 3 if (dedicated and vram_gb >= 6) else 2 if dedicated else 1 if re.search(r"iris|vega|radeon|uhd|760m|780m|890m", gpu) else 0
    lvl = "high" if score >= 6 else "mid" if score >= 4 else "low"
    hint = {
        "high": "Roda de tudo: PS3/Switch/Wii U/Xbox 360 emulados e jogos de PC recentes.",
        "mid": "Bom pra PC até ~2018, PS2/GameCube/Wii/PSP/3DS sem susto; PS3 e Switch dependem do jogo.",
        "low": "Ideal pra clássicos: PS1, N64, SNES, Mega Drive, GBA, DOS e PC até ~2010. PS2 em resolução nativa.",
    }[lvl]
    return {"level": lvl, "score": score, "hint": hint}


def detect(force: bool = False) -> dict:
    now = time.time()
    if not force and _cache["v"] and now - _cache["t"] < 60:
        return _cache["v"]
    hw = {"cpu": _cpu(), "ram": _ram(), "gpus": _gpus(), "os": _os(), "disks": _disks(), "screen": _screen(), "gamepads": _gamepads(),
          "hostname": platform.node(), "portable": True, "root": str(paths.ROOT)}
    hw["tier"] = tier(hw)
    _cache.update(t=now, v=hw)
    return hw
