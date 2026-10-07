from __future__ import annotations

import os
import re
from pathlib import Path

from .installer import _BAD_EXE, find_executables
from .titles import normalize_title, title_from_path


SKIP_DIRS = re.compile(r"^(\$recycle\.bin|system volume information|windows|program files( \(x86\))?|programdata|appdata|node_modules|\.git|__pycache__|"
                       r"_commonredist|commonredist|redist|redistributables|directx|vcredist|dotnet|_?support|__installer|"
                       r"steamworks shared|steam controller configs|saves?|savegames?|screenshots?|logs?|crashes|temp|tmp|cache)$", re.I)

INNER_DIRS = re.compile(r"^(bin|binaries|win64|win32|x64|x86|game|engine|data|content|retail|shipping|release|app|exe|_retail_|_ptr_)$", re.I)

NOT_GAME = re.compile(r"(^|[\W_])(unins\w*|setup|install\w*|vc_?redist\w*|vcredist\w*|dxsetup|dxwebsetup|directx\w*|dotnet\w*|ndp\d+|physx\w*|oalinst|"
                      r"crash\w*|report\w*|bugsplat|errorreport|unitycrashhandler\w*|ue4prereqsetup\w*|uecrashreporter|easyanticheat\w*|eac_\w*|"
                      r"battleye\w*|beservice|updater|patcher|autoupdate|launcher_helper|7z\w*|winrar|unrar|touchup|register\w*|activat\w*|"
                      r"cleanup|benchmark|editor|server|dedicated\w*|uploader|steamerrorreporter|steam\w*service|gameoverlayui|"
                      r"python\w*|java\w*|node|ffmpeg|dxdiag|cmd|powershell|msiexec|regsvr32|rundll32)([\W_]|$)", re.I)
MIN_GAME_EXE = 300 * 1024

ROM_EXTS_FALLBACK = {".iso", ".chd", ".cue", ".bin", ".img", ".pbp", ".cso", ".z64", ".n64", ".v64", ".nds", ".3ds", ".cia", ".gba", ".gb", ".gbc",
                     ".sfc", ".smc", ".nes", ".fds", ".md", ".gen", ".smd", ".32x", ".gg", ".sms", ".pce", ".ngp", ".ngc", ".ws", ".wsc",
                     ".gcm", ".rvz", ".wbfs", ".wad", ".wua", ".xci", ".nsp", ".xex", ".a26", ".a78", ".lnx", ".vb", ".zip", ".7z", ".rar"}
ARCH_EXTS = {".zip", ".7z", ".rar"}


def scan_windows(root: Path, progress=None, limit: int = 3000) -> list[dict]:
    out: list[dict] = []
    root = Path(root)
    if not root.is_dir():
        raise ValueError("Pasta não encontrada")
    seen_dirs: set[str] = set()

    def game_dirs():
        try:
            kids = sorted(root.iterdir(), key=lambda p: p.name.lower())
        except OSError:
            return
        direct = [p for p in kids if p.is_file() and _is_game_file(p)]
        subs = [p for p in kids if p.is_dir() and not SKIP_DIRS.match(p.name) and not p.name.startswith(".")]
        if direct and (not subs or len(direct) >= 1 and all(INNER_DIRS.match(s.name) for s in subs)):
            yield root
            return
        for p in subs:
            if INNER_DIRS.match(p.name):
                yield root
                return
            yield p
        for p in direct:
            yield p

    for i, d in enumerate(game_dirs()):
        if len(out) >= limit:
            break
        if progress and i % 5 == 0:
            progress(f"Olhando {d.name}…")
        if d.is_file():
            e = _classify([d], d.parent)
            if e:
                out.append(_entry(d.stem, d, e))
            continue
        if str(d) in seen_dirs:
            continue
        seen_dirs.add(str(d))
        exes = _collect_exes(d)
        if not exes:

            try:
                inner = [p for p in d.iterdir() if p.is_dir() and not SKIP_DIRS.match(p.name)]
            except OSError:
                inner = []
            if len(inner) == 1:
                exes = _collect_exes(inner[0])
        if not exes:
            continue
        ranked = _classify(exes, d)
        if not ranked:
            continue
        out.append(_entry(title_from_path(ranked[0]) if not _is_generic(d.name) else title_from_path(ranked[0]), d, ranked))

        t = normalize_title(d.name)
        if t and len(t) >= 3 and not _is_generic(d.name):
            out[-1]["title"] = t
    return out


def _is_generic(name: str) -> bool:
    return bool(INNER_DIRS.match(name) or re.match(r"^(jogos?|games?|new folder|nova pasta|\d+)$", name, re.I))


NATIVE_EXT = (".sh", ".x86_64", ".x86", ".appimage")


def _is_game_file(p: Path) -> bool:
    n = p.name.lower()
    if n.endswith(".exe"):
        return True
    return os.name != "nt" and n.endswith(NATIVE_EXT)


def _collect_exes(d: Path, max_depth: int = 4, max_files: int = 400) -> list[Path]:
    out = []
    base = len(d.parts)
    for cur, dirs, files in os.walk(d):
        depth = len(Path(cur).parts) - base
        dirs[:] = [x for x in dirs if not SKIP_DIRS.match(x) and depth < max_depth]
        for f in files:
            if _is_game_file(Path(cur) / f):
                out.append(Path(cur) / f)
                if len(out) >= max_files:
                    return out
    return out


def _classify(exes: list[Path], d: Path) -> list[Path]:
    good = []
    for p in exes:
        n = p.stem
        if NOT_GAME.search(n):
            continue
        try:
            sz = p.stat().st_size
        except OSError:
            sz = 0
        if sz and sz < MIN_GAME_EXE and not re.search(r"launcher|start|play|game", n, re.I):
            continue
        good.append(p)
    if not good:
        return []
    ranked = find_executables(d, normalize_title(d.name)) if d.is_dir() else good
    ranked = [p for p in ranked if p in set(good)] or good
    return ranked


def _entry(title: str, d: Path, ranked: list[Path]) -> dict:
    exe = ranked[0]
    try:
        size = sum(p.stat().st_size for p in ranked[:1])
    except OSError:
        size = 0
    n_bad = 0
    conf = "alta" if len(ranked) == 1 or _BAD_EXE.search(exe.stem) is None and len(ranked) <= 3 else "média"
    return {"title": normalize_title(title) or title, "exe": str(exe), "dir": str(d if d.is_dir() else d.parent), "alt_exes": [str(p) for p in ranked[1:8]],
            "size": size, "confidence": conf, "n_exes": len(ranked) + n_bad, "kind": "windows"}


def scan_roms(root: Path, systems: dict, progress=None, limit: int = 5000) -> list[dict]:
    root = Path(root)
    if not root.is_dir():
        raise ValueError("Pasta não encontrada")
    ext_map: dict[str, list[str]] = {}
    for sid, sc in systems.items():
        if sid == "pc":
            continue
        for e in sc.get("exts", []):
            ext_map.setdefault(e.lower(), []).append(sid)
    from .repos import guess_system
    out = []
    n = 0
    for cur, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if not SKIP_DIRS.match(x)]

        lower = {f.lower() for f in files}
        for f in sorted(files):
            ext = Path(f).suffix.lower()
            if ext == ".bin" and any(x.endswith(".cue") for x in lower):
                continue
            if ext not in ext_map and ext not in ROM_EXTS_FALLBACK:
                continue
            if ext in ARCH_EXTS and not ext_map.get(ext):
                continue
            p = Path(cur) / f
            n += 1
            if progress and n % 50 == 0:
                progress(f"{n} arquivos…")
            cands = ext_map.get(ext, [])
            g = guess_system(str(p.relative_to(root))) or guess_system(str(root))
            sid = g if g in cands or (g and not cands) else (cands[0] if len(cands) == 1 else "")
            if not sid and cands:
                sid = cands[0]
            out.append({"title": normalize_title(p.stem) or p.stem, "rom": str(p), "dir": cur, "system": sid or "", "ambiguous": len(cands) > 1 and g not in cands,
                        "kind": "rom", "size": _size(p)})
            if len(out) >= limit:
                return out
    return out


def _size(p: Path) -> int:
    try:
        return p.stat().st_size
    except OSError:
        return 0
