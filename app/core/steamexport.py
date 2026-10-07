from __future__ import annotations

import os
import re
import shutil
import struct
import subprocess
import time
import zlib
from pathlib import Path

TAG = "Ludrix"


def _read_map(b: bytes, i: int) -> tuple[dict, int]:
    out: dict = {}
    while i < len(b):
        t = b[i]
        i += 1
        if t == 0x08:
            return out, i
        j = b.index(b"\x00", i)
        name = b[i:j].decode("utf-8", "replace")
        i = j + 1
        if t == 0x00:
            out[name], i = _read_map(b, i)
        elif t == 0x01:
            j = b.index(b"\x00", i)
            out[name] = b[i:j].decode("utf-8", "replace")
            i = j + 1
        elif t == 0x02:
            out[name] = struct.unpack_from("<i", b, i)[0]
            i += 4
        elif t == 0x07:
            out[name] = struct.unpack_from("<q", b, i)[0]
            i += 8
        else:
            raise ValueError(f"tipo VDF desconhecido {t:#x}")
    return out, i


def parse_shortcuts(b: bytes) -> list[dict]:
    if not b:
        return []
    root, _ = _read_map(b, 0)
    sc = root.get("shortcuts") or next(iter(root.values()), {}) if root else {}
    items = []
    for k in sorted(sc.keys(), key=lambda x: int(x) if str(x).isdigit() else 0):
        v = sc[k]
        if isinstance(v, dict):
            items.append(v)
    return items


def _w_map(name: str, m: dict) -> bytes:
    out = b"\x00" + name.encode("utf-8") + b"\x00"
    for k, v in m.items():
        kb = k.encode("utf-8") + b"\x00"
        if isinstance(v, dict):
            out += _w_map(k, v)
        elif isinstance(v, bool):
            out += b"\x02" + kb + struct.pack("<i", 1 if v else 0)
        elif isinstance(v, int):
            out += b"\x02" + kb + struct.pack("<i", v if v < 2 ** 31 else v - 2 ** 32)
        else:
            out += b"\x01" + kb + str(v).encode("utf-8") + b"\x00"
    return out + b"\x08"


def dump_shortcuts(items: list[dict]) -> bytes:
    return _w_map("shortcuts", {str(i): it for i, it in enumerate(items)}) + b"\x08"


def shortcut_appid(exe_quoted: str, name: str) -> int:
    return (zlib.crc32((exe_quoted + name).encode("utf-8")) & 0xFFFFFFFF) | 0x80000000


def _q(p: str) -> str:
    p = str(p or "")
    return p if p.startswith('"') else f'"{p}"'


def new_entry(name: str, exe: str, start_dir: str, args: str = "", icon: str = "", last_played: int = 0) -> dict:
    exe_q, dir_q = _q(exe), _q(start_dir)
    return {"appid": shortcut_appid(exe_q, name), "AppName": name, "Exe": exe_q, "StartDir": dir_q, "icon": icon or "", "ShortcutPath": "",
            "LaunchOptions": args or "", "IsHidden": 0, "AllowDesktopConfig": 1, "AllowOverlay": 1, "OpenVR": 0, "Devkit": 0, "DevkitGameID": "",
            "DevkitOverrideAppID": 0, "LastPlayTime": int(last_played or 0), "FlatpakAppID": "", "tags": {"0": TAG}}


def steam_root() -> Path | None:
    if os.name == "nt":
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as k:
                p = Path(str(winreg.QueryValueEx(k, "SteamPath")[0]))
                if p.exists():
                    return p
        except Exception:
            pass
        for c in (Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Steam", Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Steam"):
            if (c / "userdata").exists():
                return c
        return None
    for c in (Path.home() / ".steam" / "steam", Path.home() / ".local" / "share" / "Steam", Path.home() / ".var" / "app" / "com.valvesoftware.Steam" / ".local" / "share" / "Steam"):
        if (c / "userdata").exists():
            return c
    return None


def steam_running() -> bool:
    if os.name == "nt":
        try:
            r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq steam.exe", "/NH"], capture_output=True, text=True, timeout=8, creationflags=0x08000000)
            return "steam.exe" in (r.stdout or "").lower()
        except Exception:
            return False
    try:
        r = subprocess.run(["pgrep", "-x", "steam"], capture_output=True, text=True, timeout=5)
        return r.returncode == 0
    except Exception:
        return False


def users(root: Path) -> list[dict]:
    ud = root / "userdata"
    out = []
    if not ud.exists():
        return out
    for d in ud.iterdir():
        if not d.is_dir() or not d.name.isdigit() or d.name == "0":
            continue
        cfg = d / "config"
        name = ""
        lc = cfg / "localconfig.vdf"
        if lc.exists():
            try:
                m = re.search(r'"PersonaName"\s+"([^"]*)"', lc.read_text(encoding="utf-8", errors="replace"))
                name = m.group(1) if m else ""
            except Exception:
                pass
        mt = max([p.stat().st_mtime for p in (lc, cfg / "shortcuts.vdf", cfg) if p.exists()] or [0])
        out.append({"id": d.name, "name": name or d.name, "dir": str(d), "mtime": mt, "shortcuts": int((cfg / "shortcuts.vdf").exists())})
    out.sort(key=lambda u: -u["mtime"])
    return out


def _fit_cover(src: Path, dest: Path, size: tuple[int, int], mode: str) -> bool:
    try:
        from PIL import Image, ImageFilter
        with Image.open(src) as im:
            im = im.convert("RGB")
            W, H = size
            if mode == "portrait":
                r = max(W / im.width, H / im.height)
                im2 = im.resize((max(1, round(im.width * r)), max(1, round(im.height * r))), Image.LANCZOS)
                x, y = (im2.width - W) // 2, (im2.height - H) // 2
                im2.crop((x, y, x + W, y + H)).save(dest, "JPEG", quality=90)
            else:
                bg = im.resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(18))
                r = H / im.height
                fg = im.resize((max(1, round(im.width * r)), H), Image.LANCZOS)
                bg.paste(fg, ((W - fg.width) // 2, 0))
                bg.save(dest, "JPEG", quality=88)
        return True
    except Exception:
        return False


def export(user_dir: Path, games: list[dict]) -> dict:
    cfg = user_dir / "config"
    cfg.mkdir(parents=True, exist_ok=True)
    vdf = cfg / "shortcuts.vdf"
    existing = []
    if vdf.exists():
        try:
            existing = parse_shortcuts(vdf.read_bytes())
        except Exception as e:
            return {"error": f"shortcuts.vdf atual não pôde ser lido ({e}). Nada foi alterado."}
        shutil.copy2(vdf, cfg / f"shortcuts.vdf.ludrix-bak-{time.strftime('%Y%m%d-%H%M%S')}")
        baks = sorted(cfg.glob("shortcuts.vdf.ludrix-bak-*"))
        for old in baks[:-3]:
            try:
                old.unlink()
            except Exception:
                pass

    def is_ours(e: dict) -> bool:
        tags = e.get("tags") or {}
        return TAG in [str(v) for v in tags.values()] if isinstance(tags, dict) else False

    def ident(e: dict) -> str:
        return (str(e.get("Exe") or "").strip('"').lower() + "|" + str(e.get("LaunchOptions") or "").strip().lower())

    keep = [e for e in existing if not is_ours(e)]
    foreign = {ident(e) for e in keep}
    ours_old = {str(e.get("AppName") or "").lower(): e for e in existing if is_ours(e)}
    grid = cfg / "grid"
    added = updated = skipped = 0
    out = list(keep)
    for g in games:
        name, exe = str(g.get("title") or "").strip(), str(g.get("exe") or "")
        if not name or not exe:
            skipped += 1
            continue
        e = new_entry(name, exe, g.get("dir") or str(Path(exe).parent), g.get("args") or "", g.get("icon") or exe, int(g.get("last_played") or 0))
        if ident(e) in foreign:
            skipped += 1
            continue
        old = ours_old.get(name.lower())
        if old:
            e["IsHidden"] = int(old.get("IsHidden") or 0)
            e["LastPlayTime"] = max(int(old.get("LastPlayTime") or 0), e["LastPlayTime"])
            tags = old.get("tags") if isinstance(old.get("tags"), dict) else {}
            extra = [str(v) for v in tags.values() if str(v) != TAG]
            e["tags"] = {str(i): v for i, v in enumerate([TAG] + extra)}
            updated += 1
        else:
            added += 1
        out.append(e)
        cov = g.get("cover")
        if cov and Path(cov).is_file():
            grid.mkdir(exist_ok=True)
            aid = e["appid"]
            _fit_cover(Path(cov), grid / f"{aid}p.jpg", (600, 900), "portrait")
            _fit_cover(Path(cov), grid / f"{aid}.jpg", (920, 430), "landscape")
            hero = g.get("hero")
            if hero and Path(hero).is_file():
                _fit_cover(Path(hero), grid / f"{aid}_hero.jpg", (1920, 620), "landscape")
    vdf.write_bytes(dump_shortcuts(out))
    return {"ok": True, "added": added, "updated": updated, "skipped": skipped, "total": len(out), "file": str(vdf)}
