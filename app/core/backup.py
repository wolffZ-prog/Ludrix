from __future__ import annotations

import json
import shutil
import time
import zipfile
from pathlib import Path

from . import paths

DATA_FILES = ("config.json", "library.json", "repos.json", "downloads.json")
DATA_DIRS = ("covers", "custom", "save_backups")
MANIFEST = "ludrix-backup.json"
MAX_IMPORT = 4 * 1024 ** 3


def _add(z: zipfile.ZipFile, src: Path, arc: str) -> int:
    n = 0
    if src.is_file():
        z.write(src, arc)
        return 1
    for p in sorted(src.rglob("*")):
        if p.is_file() and "__pycache__" not in p.parts:
            z.write(p, f"{arc}/{p.relative_to(src).as_posix()}")
            n += 1
    return n


def export_data(dest_dir: Path, version: str) -> dict:
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    out = dest_dir / f"Ludrix-dados-{time.strftime('%Y-%m-%d_%H-%M')}.zip"
    count = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for f in DATA_FILES:
            p = paths.DATA / f
            if p.is_file():
                count += _add(z, p, f"data/{f}")
        for d in DATA_DIRS:
            p = paths.DATA / d
            if p.is_dir():
                count += _add(z, p, f"data/{d}")
        if paths.THEMES.is_dir():
            for t in paths.THEMES.iterdir():
                if t.is_dir():
                    count += _add(z, t, f"themes/{t.name}")
        cq = paths.FLASH / "custom.json"
        if cq.is_file():
            count += _add(z, cq, "games/rapidos/custom.json")
        z.writestr(MANIFEST, json.dumps({"app": "LudrixHub", "version": version, "at": time.time(), "files": count, "root": str(paths.ROOT)}, ensure_ascii=False))
    return {"ok": True, "path": str(out), "files": count, "size": out.stat().st_size}


def inspect(path: str) -> dict:
    p = Path(path or "")
    if not p.is_file():
        return {"error": "Arquivo não encontrado"}
    try:
        with zipfile.ZipFile(p) as z:
            names = z.namelist()
            if MANIFEST not in names:
                return {"error": "Esse zip não é um backup do Ludrix (falta ludrix-backup.json)"}
            m = json.loads(z.read(MANIFEST).decode("utf-8"))
            total = sum(i.file_size for i in z.infolist())
            if total > MAX_IMPORT:
                return {"error": "Backup grande demais"}
            bad = [n for n in names if n.startswith("/") or ".." in Path(n).parts or not n.startswith(("data/", "themes/", "games/rapidos/custom.json", MANIFEST))]
            if bad:
                return {"error": f"Backup com caminho suspeito: {bad[0]}"}
            has_lib = "data/library.json" in names
            lib = json.loads(z.read("data/library.json").decode("utf-8")) if has_lib else {}
            themes = sorted({n.split("/")[1] for n in names if n.startswith("themes/") and n.count("/") >= 2})
            return {"ok": True, "version": m.get("version", "?"), "at": m.get("at"), "files": len(names) - 1, "games": len(lib) if isinstance(lib, dict) else 0,
                    "themes": len(themes), "has_config": "data/config.json" in names, "saves": any(n.startswith("data/save_backups/") for n in names), "size": total}
    except zipfile.BadZipFile:
        return {"error": "Zip danificado"}


def import_data(path: str, version: str) -> dict:
    info = inspect(path)
    if info.get("error"):
        return info
    pre = export_data(paths.UPDATES, version)
    for old in sorted(paths.UPDATES.glob("Ludrix-dados-*.zip"))[:-2]:
        old.unlink(missing_ok=True)
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if n != MANIFEST and not n.endswith("/")]
        for d in DATA_DIRS:
            if any(n.startswith(f"data/{d}/") for n in names):
                shutil.rmtree(paths.DATA / d, ignore_errors=True)
        for n in names:
            target = (paths.ROOT / n).resolve()
            if paths.ROOT.resolve() not in target.parents:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(n) as s, open(target, "wb") as o:
                shutil.copyfileobj(s, o, 1 << 20)
    for f in ("config.json", "library.json"):
        (paths.DATA / (f + ".bak")).unlink(missing_ok=True)
    return {"ok": True, "restart": True, "restored": len(names), "previous": pre["path"], **{k: info[k] for k in ("games", "themes", "saves", "has_config")}}
