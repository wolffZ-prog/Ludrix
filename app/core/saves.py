from __future__ import annotations

import json
import os
import re
import shutil
import time
import zipfile
from pathlib import Path

from . import paths

CRACK_DIRS = [
    "{appdata}/Goldberg SteamEmu Saves/{appid}", "{appdata}/Goldberg SteamEmu Saves",
    "{appdata}/GSE Saves/{appid}", "{appdata}/GSE Saves",
    "{public}/Documents/Steam/CODEX/{appid}", "{public}/Documents/Steam/CODEX",
    "{public}/Documents/Steam/RUNE/{appid}", "{public}/Documents/Steam/RUNE",
    "{appdata}/Steam/CODEX/{appid}", "{appdata}/Steam/CODEX", "{appdata}/Steam/RUNE",
    "{appdata}/SmartSteamEmu/{appid}", "{appdata}/SmartSteamEmu", "{docs}/SKIDROW/{appid}", "{docs}/SKIDROW",
    "{appdata}/EMPRESS/{appid}", "{appdata}/EMPRESS", "{public}/Documents/EMPRESS/{appid}",
    "{appdata}/Steam/Player", "{gamedir}/steam_settings", "{gamedir}/Saves", "{gamedir}/save",
    "{appdata}/OnlineFix/{appid}", "{public}/Documents/OnlineFix/{appid}", "{docs}/VALVE/{appid}",
]
SAVE_HINT_RE = re.compile(r"save|profile|slot|\.sav$|\.dat$|\.bin$|\.b$|\.srm|\.mcd|\.ps2|\.gci|\.eep|\.sra|\.fla|\.mpk|memcard|option|edit0", re.I)


def _vars(title: str, gamedir: str = "", emudir: str = "", year: str = "", appid: str = "") -> dict:
    home = Path.home()
    docs = Path(os.environ.get("VL_DOCS") or (home / "Documents"))
    if os.name == "nt":
        try:
            import ctypes
            buf = ctypes.create_unicode_buffer(260)
            if ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf) == 0 and buf.value:
                docs = Path(buf.value)
        except Exception:
            pass
    yr = re.search(r"(19|20)\d{2}", title or "")
    year = year or (yr.group(0) if yr else "")
    n = re.search(r"\b(\d{1,2})\b", title or "")
    return {
        "docs": str(docs), "home": str(home), "userprofile": str(home),
        "appdata": os.environ.get("APPDATA", str(home / "AppData/Roaming")),
        "localappdata": os.environ.get("LOCALAPPDATA", str(home / "AppData/Local")),
        "savedgames": str(home / "Saved Games"), "public": os.environ.get("PUBLIC", r"C:\Users\Public"),
        "gamedir": gamedir or "", "emudir": emudir or "", "title": re.sub(r"[:\\/*?\"<>|]", "", title or "").strip(),
        "year": year, "yy": year[-2:] if year else "", "n": n.group(1) if n else "", "sub": "", "appid": appid or "",
    }


def _expand(tpl: str, v: dict) -> list[Path]:
    try:
        s = tpl.format(**v)
    except (KeyError, IndexError):
        return []
    if ("{gamedir}" in tpl and not v["gamedir"]) or ("{emudir}" in tpl and not v["emudir"]) or ("{appid}" in tpl and not v["appid"]):
        return []
    if "*" in s:
        base = Path(s.split("*")[0]).parent
        pat = Path(s).name
        try:
            return [p for p in base.glob(pat)] if base.exists() else []
        except Exception:
            return []
    return [Path(s)]


class SaveManager:
    def __init__(self, store, emu):
        self.store = store
        self.emu = emu
        self.presets = self._load()

    def _load(self) -> dict:
        p = paths.PRESETS / "saves.json"
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return {"emulators": {}, "games": [], "generic_pc": []}

    def locate(self, key: str, game: dict, deep: bool = False) -> dict:
        info = self.store.get(key) or {}
        if info.get("save_dir") and Path(info["save_dir"]).exists():
            return {"dir": info["save_dir"], "how": "manual", "note": "Pasta definida por você.", "candidates": [], "ext": [], "folder": True}
        title = game.get("title", "")
        gamedir = game.get("dir", "")
        system = game.get("system", "pc")
        t0 = time.time()

        if system != "pc" and (game.get("emu") or key.startswith("rom:") or info.get("kind") == "rom"):
            emu_id = self.emu.emulator_for(system)
            exe = self.emu.emu_exe(emu_id) if emu_id else None
            ec = self.presets["emulators"].get(emu_id or "", {})
            v = _vars(title, gamedir=str(Path(game.get("exe", gamedir)).parent) if game.get("exe") else gamedir, emudir=str(exe.parent) if exe else "")
            cands = []
            for tpl in ec.get("paths", []):
                cands += _expand(tpl, v)
            hit = next((c for c in cands if c.exists()), None)
            return {"dir": str(hit) if hit else "", "how": "emulator", "emulator": emu_id, "emulator_title": self.emu.all_emulators().get(emu_id, {}).get("title", emu_id),
                    "note": ec.get("note", ""), "candidates": [str(c) for c in cands], "ext": ec.get("ext", []), "folder": bool(ec.get("folder")),
                    "manual": hit is None, "elapsed": round(time.time() - t0, 2)}

        v = _vars(title, gamedir=gamedir, appid=str(info.get("steam_appid") or ""))
        low = title.lower()
        cands, note, ext, folder = [], "", [], True
        for g in self.presets["games"]:
            try:
                if re.search(g["match"], low, re.I):
                    for tpl in g["paths"]:
                        cands += _expand(tpl, v)
                    note, ext, folder = g.get("note", ""), g.get("ext", []), bool(g.get("folder", not g.get("ext")))
                    break
            except re.error:
                continue
        known = [c for c in cands if c.exists()]
        if known:
            return {"dir": str(known[0]), "how": "preset", "note": note, "candidates": [str(c) for c in cands], "ext": ext, "folder": folder, "elapsed": round(time.time() - t0, 2)}

        gen = []
        for tpl in self.presets.get("generic_pc", []):
            gen += _expand(tpl, v)
        words = [w for w in re.split(r"[^a-z0-9]+", low) if len(w) > 2]
        for tpl in CRACK_DIRS:
            for c in _expand(tpl, v):
                if "{appid}" in tpl or "{gamedir}" in tpl:
                    gen.append(c)
                elif c.is_dir():

                    try:
                        gen += [d for d in c.iterdir() if d.is_dir() and words and sum(w in d.name.lower() for w in words) >= max(1, len(words) // 2)]
                    except OSError:
                        pass
        hit = next((c for c in gen if c.exists() and c.is_dir() and any(True for _ in c.iterdir())), None)
        if hit:
            how = "crack" if any(k in str(hit) for k in ("Goldberg", "CODEX", "RUNE", "SKIDROW", "EMPRESS", "SmartSteamEmu", "GSE", "OnlineFix")) else "generic"
            return {"dir": str(hit), "how": how, "note": note or ("Save de versão com crack (emulador de Steam)." if how == "crack" else ""),
                    "candidates": [str(c) for c in cands], "ext": ext, "folder": folder, "elapsed": round(time.time() - t0, 2)}

        found = self._quick_search(title, gamedir, v, budget=4.0 if not deep else 12.0)
        if found:
            return {"dir": str(found[0]), "how": "search", "note": "Encontrada por busca rápida — confira se é a pasta certa.", "alternatives": [str(f) for f in found[1:6]],
                    "candidates": [str(c) for c in cands], "ext": ext, "folder": folder, "elapsed": round(time.time() - t0, 2)}
        return {"dir": "", "how": "none", "note": note, "candidates": [str(c) for c in cands], "ext": ext, "folder": folder, "manual": True, "elapsed": round(time.time() - t0, 2)}

    def _quick_search(self, title: str, gamedir: str, v: dict, budget: float) -> list[Path]:
        words = [w for w in re.split(r"[^a-z0-9]+", title.lower()) if len(w) > 2 and w not in ("the", "and", "for", "edition", "game", "remastered")]
        if not words:
            return []
        acr = "".join(w[0] for w in words) if len(words) > 1 else ""
        roots = [Path(v["docs"]), Path(v["docs"]) / "My Games", Path(v["savedgames"]), Path(v["appdata"]), Path(v["localappdata"]),
                 Path(v["localappdata"]) / "Packages", Path(v["public"]) / "Documents"]
        if gamedir:
            roots.insert(0, Path(gamedir))
        t0 = time.time()
        hits: list[tuple[int, Path]] = []
        seen = set()

        def score(name: str) -> int:
            n = name.lower()
            s = sum(2 for w in words if w in n)
            if acr and len(acr) >= 3 and acr in n:
                s += 3
            if SAVE_HINT_RE.search(n):
                s += 1
            return s

        for root in roots:
            if not root.exists():
                continue
            stack = [(root, 0)]
            while stack:
                d, depth = stack.pop()
                if time.time() - t0 > budget:
                    break
                try:
                    with os.scandir(d) as it:
                        for e in it:
                            if not e.is_dir(follow_symlinks=False):
                                continue
                            if e.name.startswith((".", "$")) or e.name.lower() in ("windows", "program files", "program files (x86)", "node_modules", "cache", "temp", "tmp"):
                                continue
                            sc = score(e.name)
                            p = Path(e.path)
                            if sc >= 2 and p not in seen:
                                seen.add(p)
                                hits.append((sc + (2 if root == Path(gamedir or "/nonexistent") else 0), p))
                            if depth < 3:
                                stack.append((p, depth + 1))
                except (PermissionError, OSError):
                    continue
        hits.sort(key=lambda x: -x[0])
        return [p for _, p in hits[:8]]

    def set_manual(self, key: str, folder: str) -> dict:
        if not Path(folder).is_dir():
            return {"error": "Pasta não existe"}
        self.store.update(key, save_dir=folder)
        return {"ok": True, "dir": folder}

    def backup_dir(self, key: str) -> Path:
        d = paths.DATA / "save_backups" / re.sub(r"[^a-zA-Z0-9_.-]", "_", key)[:80]
        d.mkdir(parents=True, exist_ok=True)
        return d

    AUTO_MAX = 512 * 1024 * 1024

    def auto_backup(self, key: str, game: dict) -> str | None:
        try:
            loc = self.locate(key, game)
        except Exception:
            return None
        d = loc.get("dir") or ""
        if not d or not Path(d).exists():
            return None
        size = paths.dir_size(Path(d)) if Path(d).is_dir() else Path(d).stat().st_size
        if size > self.AUTO_MAX:
            return None
        last = self.list_backups(key)
        if last and abs(paths.dir_size(Path(last[0]["path"])) - size) == 0 and self._same_tree(Path(last[0]["path"]), Path(d)):
            return None
        return self.backup(key, d)

    @staticmethod
    def _same_tree(a: Path, b: Path) -> bool:
        try:
            fa = sorted((p.relative_to(a).as_posix(), p.stat().st_size, int(p.stat().st_mtime)) for p in a.rglob("*") if p.is_file())
            if b.is_dir():
                fb = sorted((p.relative_to(b).as_posix(), p.stat().st_size, int(p.stat().st_mtime)) for p in b.rglob("*") if p.is_file())
            else:
                fb = [(b.name, b.stat().st_size, int(b.stat().st_mtime))]
            return fa == fb
        except OSError:
            return False

    def backup(self, key: str, save_dir: str) -> str | None:
        src = Path(save_dir)
        if not src.exists():
            return None
        dst = self.backup_dir(key) / time.strftime("%Y-%m-%d_%H-%M-%S")
        try:
            if src.is_dir():
                shutil.copytree(src, dst, dirs_exist_ok=True)
            else:
                dst.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst / src.name)
        except Exception:
            return None

        olds = sorted(self.backup_dir(key).iterdir())
        for o in olds[:-5]:
            shutil.rmtree(o, ignore_errors=True)
        return str(dst)

    def import_save(self, key: str, source: str, dest_dir: str, do_backup: bool = True) -> dict:
        src = Path(source)
        dst = Path(dest_dir)
        if not src.exists():
            return {"error": "Arquivo/pasta de origem não existe"}
        dst.mkdir(parents=True, exist_ok=True)
        bk = self.backup(key, dest_dir) if do_backup else None
        copied = []
        if src.is_dir():
            for p in src.rglob("*"):
                if p.is_file():
                    rel = p.relative_to(src)
                    (dst / rel).parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(p, dst / rel)
                    copied.append(str(rel))
        elif src.suffix.lower() in (".zip", ".7z", ".rar"):
            tmp = paths.DOWNLOADS / f"save_{int(time.time())}"
            tmp.mkdir(parents=True, exist_ok=True)
            try:
                if src.suffix.lower() == ".zip":
                    from .installer import safe_extractall
                    safe_extractall(zipfile.ZipFile(src), tmp)
                else:
                    from .installer import extract
                    import threading
                    extract(src, tmp, lambda p: None, threading.Event())
                from .installer import flatten_single_folder
                flatten_single_folder(tmp)

                same = next((d for d in tmp.iterdir() if d.is_dir() and d.name.lower() == dst.name.lower()), None)
                base = same or tmp
                for p in base.rglob("*"):
                    if p.is_file():
                        rel = p.relative_to(base)
                        (dst / rel).parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(p, dst / rel)
                        copied.append(str(rel))
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
        else:
            shutil.copy2(src, dst / src.name)
            copied.append(src.name)
        self.store.update(key, save_dir=str(dst), last_save_import=time.time())
        return {"ok": True, "copied": copied[:50], "count": len(copied), "backup": bk, "dir": str(dst)}

    def export_save(self, key: str, save_dir: str, dest_zip: str) -> dict:
        src = Path(save_dir)
        if not src.exists():
            return {"error": "Pasta de save não existe"}
        dest = Path(dest_zip)
        dest.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
            if src.is_dir():
                for p in src.rglob("*"):
                    if p.is_file():
                        z.write(p, src.name + "/" + str(p.relative_to(src)))
            else:
                z.write(src, src.name)
        return {"ok": True, "file": str(dest)}

    def list_backups(self, key: str) -> list[dict]:
        d = paths.DATA / "save_backups" / re.sub(r"[^a-zA-Z0-9_.-]", "_", key)[:80]
        if not d.exists():
            return []
        return [{"name": b.name, "path": str(b), "size": paths.dir_size(b)} for b in sorted(d.iterdir(), reverse=True)]

    def restore_backup(self, key: str, backup_path: str, dest_dir: str) -> dict:
        return self.import_save(key, backup_path, dest_dir, do_backup=True)
