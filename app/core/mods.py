from __future__ import annotations

import json
import re
import shutil
import threading
import time
from pathlib import Path
from urllib.parse import quote_plus

from . import paths
from .installer import Downloader, Progress, extract, find_executables, flatten_single_folder, safe_folder_name
from .repos import FileRef

MOD_DIRS = ("mods", "Mods", "mod", "BepInEx/plugins", "Data", "data", "plugins", "addons", "Addons", "maps", "Maps", "Content/Paks/~mods")
SKIP_NAMES = {"readme.txt", "readme.md", "leia-me.txt", "leiame.txt", "thumbs.db", ".ds_store", "desktop.ini"}


class ModsManager:
    def __init__(self, store, session, cache):
        self.store = store
        self.s = session
        self.cache = cache
        self.presets = self._load()

    def _load(self) -> dict:
        p = paths.PRESETS / "mods.json"
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return {"sites": [], "tools": []}

    def root(self) -> Path:
        d = self.store.config.get("mods_dir")
        p = Path(d) if d else paths.TOOLS
        p.mkdir(parents=True, exist_ok=True)
        return p

    def tool_dir(self, tid: str) -> Path:
        return self.root() / tid

    def tool_exe(self, tid: str) -> Path | None:
        t = next((x for x in self.presets["tools"] if x["id"] == tid), None)
        d = self.tool_dir(tid)
        if not t or not d.exists():
            return None
        if t.get("exe"):
            direct = d / t["exe"]
            if direct.exists():
                return direct
            hits = list(d.rglob(t["exe"]))
            if hits:
                return hits[0]
        exes = find_executables(d, t.get("title", ""))
        return exes[0] if exes else None

    def status(self) -> dict:
        tools = []
        for t in self.presets["tools"]:
            exe = self.tool_exe(t["id"])
            info = self.store.get(f"tool:{t['id']}") or {}
            tools.append({**{k: v for k, v in t.items() if k != "match"}, "installed": bool(exe),
                          "exe_path": str(exe) if exe else "", "dir": str(self.tool_dir(t["id"])), "version": info.get("version", "")})
        return {"tools": tools, "sites": [{k: v for k, v in s.items() if k != "match"} for s in self.presets["sites"]],
                "root": str(self.root())}

    def for_game(self, title: str, system: str = "pc") -> dict:
        low = (title or "").lower()
        tools = []
        for t in self.presets["tools"]:
            pat = t.get("match", ".*")
            if pat == ".*":
                continue
            try:
                if re.search(pat, low, re.I):
                    tools.append({"id": t["id"], "title": t["title"], "for": t.get("for", ""), "installed": bool(self.tool_exe(t["id"])), "type": t.get("type")})
            except re.error:
                pass
        sites = []
        q = quote_plus(re.sub(r"[\(\[].*?[\)\]]", "", title or "").strip())
        for s_ in self.presets["sites"]:
            pat = s_.get("match", ".*")
            generic = pat == ".*"
            try:
                hit = generic or re.search(pat, low, re.I)
            except re.error:
                hit = generic
            if not hit:
                continue
            if system != "pc" and s_["id"] in ("nexus", "moddb", "gamebanana"):
                continue
            if system == "pc" and s_["id"] in ("romhacking", "cdromance"):
                continue
            sites.append({"id": s_["id"], "name": s_["name"], "url": s_["url"].replace("{q}", q), "desc": s_.get("desc", ""), "specific": not generic})
        sites.sort(key=lambda x: not x["specific"])
        return {"tools": tools, "sites": sites}

    def install(self, tid: str, cb, cancel: threading.Event) -> Path:
        t = next((x for x in self.presets["tools"] if x["id"] == tid), None)
        if not t:
            raise RuntimeError("Ferramenta desconhecida")
        if t.get("type") != "github_release":
            raise RuntimeError("Essa ferramenta é só link — abra a página e baixe manualmente.")
        rels = self.cache.get_json(f"gh_{t['repo']}", f"https://api.github.com/repos/{t['repo']}/releases?per_page=5", 6 * 3600)
        rels = [r for r in rels if not r.get("draft")] if isinstance(rels, list) else []
        if not rels:
            raise RuntimeError("Nenhum release encontrado no GitHub")
        rel = next((r for r in rels if not r.get("prerelease")), rels[0])
        pat = re.compile(t.get("asset") or r"win|x64|\.zip$|\.7z$", re.I)
        assets = [a for a in rel["assets"] if pat.search(a["name"]) and not re.search(r"pdb|symbols|src|source|linux|mac|arm64", a["name"], re.I)]
        if not assets:
            raise RuntimeError("Nenhum arquivo Windows encontrado no release")
        a = assets[0]
        dest = self.tool_dir(tid)
        tmp = paths.DOWNLOADS / f"tool_{tid}"
        tmp.mkdir(parents=True, exist_ok=True)
        archive = tmp / a["name"]
        cb(Progress("download", 0, f"Baixando {t['title']}..."))
        Downloader(self.s).download(FileRef(a["name"], a["browser_download_url"], int(a.get("size") or 0)), archive, cb, cancel)
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        dest.mkdir(parents=True, exist_ok=True)
        if re.search(r"\.(zip|7z|rar)$", archive.name, re.I):
            cb(Progress("extract", 0, "Extraindo..."))
            extract(archive, dest, cb, cancel)
            flatten_single_folder(dest)
        else:
            shutil.move(str(archive), str(dest / archive.name))
        shutil.rmtree(tmp, ignore_errors=True)
        self.store.set_installed(f"tool:{tid}", dir=str(dest), title=t["title"], kind="tool", version=rel.get("tag_name", ""))
        cb(Progress("done", 1.0, f"{t['title']} pronto"))
        return dest

    def remove(self, tid: str):
        shutil.rmtree(self.tool_dir(tid), ignore_errors=True)
        self.store.remove(f"tool:{tid}")

    def launch(self, tid: str) -> dict:
        from . import compat
        exe = self.tool_exe(tid)
        if not exe:
            return {"error": "Ferramenta não instalada"}
        try:
            compat.popen([str(exe)], exe.parent, self.store.config)
        except (RuntimeError, OSError) as e:
            return {"error": str(e)}
        return {"ok": True}


class GameMods:
    def __init__(self, store):
        self.store = store

    def _base(self, key: str) -> Path:
        return paths.DATA / "mods" / safe_folder_name(key.replace(":", "_"))

    def _db(self, key: str) -> Path:
        return self._base(key) / "mods.json"

    def _read(self, key: str) -> list[dict]:
        try:
            return json.loads(self._db(key).read_text(encoding="utf-8"))
        except Exception:
            return []

    def _write(self, key: str, lst: list[dict]):
        self._base(key).mkdir(parents=True, exist_ok=True)
        self._db(key).write_text(json.dumps(lst, ensure_ascii=False, indent=1), encoding="utf-8")

    def game_dir(self, key: str) -> Path | None:
        info = self.store.get(key) or {}
        d = info.get("dir") or (str(Path(info["exe"]).parent) if info.get("exe") else "")
        return Path(d) if d and Path(d).is_dir() else None

    def targets(self, key: str) -> list[dict]:
        root = self.game_dir(key)
        if not root:
            return []
        out = [{"path": "", "label": "Pasta do jogo (raiz)"}]
        for rel in MOD_DIRS:
            if (root / rel).is_dir() and rel not in [o["path"] for o in out]:
                out.append({"path": rel, "label": f"{rel}/"})
        return out

    def suggest_target(self, key: str) -> str:
        t = self.targets(key)
        return next((x["path"] for x in t if x["path"]), "")

    def list(self, key: str) -> dict:
        root = self.game_dir(key)
        mods = self._read(key)
        for m in mods:
            m["size_h"] = m.get("size", 0)
        return {"mods": mods, "targets": self.targets(key), "suggest": self.suggest_target(key), "dir": str(root) if root else ""}

    def check(self, key: str, src: str, target: str) -> tuple[Path, Path, str]:
        root = self.game_dir(key)
        if not root:
            raise RuntimeError("Esse jogo não tem pasta instalada")
        srcp = Path((src or "").strip().strip('"'))
        if not src or not srcp.exists():
            raise RuntimeError("Arquivo do mod não encontrado")
        target = (target or "").strip().strip("/\\").replace("\\", "/")
        if ".." in target.split("/") or target.startswith("/") or ":" in target:
            raise RuntimeError("Pasta de destino inválida")
        return root, srcp, target

    def install(self, key: str, src: str, title: str = "", target: str = "", cb=None, cancel: threading.Event | None = None) -> dict:
        root, srcp, target = self.check(key, src, target)
        dest_root = (root / target) if target else root
        dest_root.mkdir(parents=True, exist_ok=True)
        title = (title or "").strip() or re.sub(r"[_\-]+", " ", srcp.stem).strip()
        mid = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or "mod"
        mods = self._read(key)
        if any(m["id"] == mid for m in mods):
            mid += "-" + str(int(time.time()))[-4:]
        stage = self._base(key) / mid / "files"
        backup = self._base(key) / mid / "backup"
        shutil.rmtree(stage.parent, ignore_errors=True)
        stage.mkdir(parents=True, exist_ok=True)
        cancel = cancel or threading.Event()
        cb = cb or (lambda p: None)
        if srcp.is_dir():
            shutil.copytree(srcp, stage, dirs_exist_ok=True)
        elif re.search(r"\.(zip|7z|rar|tar|gz|xz)$", srcp.name, re.I):
            cb(Progress("extract", 0, "Extraindo o mod…"))
            extract(srcp, stage, cb, cancel)
            if not target:
                flatten_single_folder(stage)
        else:
            shutil.copy2(srcp, stage / srcp.name)
        if target and (stage / target).is_dir() and len([x for x in stage.iterdir() if x.name.lower() not in SKIP_NAMES]) == 1:
            inner = stage / target
            tmp = stage.parent / "_inner"
            shutil.move(str(inner), str(tmp))
            shutil.rmtree(stage, ignore_errors=True)
            shutil.move(str(tmp), str(stage))
        files, replaced, size = [], [], 0
        for f in sorted(p for p in stage.rglob("*") if p.is_file()):
            rel = f.relative_to(stage)
            if rel.name.lower() in SKIP_NAMES and len(rel.parts) == 1:
                continue
            dst = dest_root / rel
            if dst.exists():
                b = backup / rel
                b.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(dst, b)
                replaced.append(rel.as_posix())
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dst)
            files.append(rel.as_posix())
            size += f.stat().st_size
        if not files:
            shutil.rmtree(stage.parent, ignore_errors=True)
            raise RuntimeError("O mod não tinha arquivos pra copiar")
        rec = {"id": mid, "title": title, "target": target, "files": files, "replaced": replaced, "size": size, "enabled": True, "added": time.time(), "source": str(srcp)}
        mods.append(rec)
        self._write(key, mods)
        cb(Progress("done", 1.0, f"{title}: {len(files)} arquivos em {target or 'pasta do jogo'}"))
        return {"ok": True, "mod": rec}

    def set_enabled(self, key: str, mid: str, on: bool) -> dict:
        root = self.game_dir(key)
        mods = self._read(key)
        m = next((x for x in mods if x["id"] == mid), None)
        if not m or not root:
            return {"error": "Mod não encontrado"}
        dest_root = (root / m["target"]) if m.get("target") else root
        stage = self._base(key) / mid / "files"
        backup = self._base(key) / mid / "backup"
        if on and not m.get("enabled"):
            for rel in m["files"]:
                srcf = stage / rel
                if srcf.exists():
                    dst = dest_root / rel
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(srcf, dst)
        elif not on and m.get("enabled"):
            self._pull(dest_root, m, backup)
        m["enabled"] = bool(on)
        self._write(key, mods)
        return {"ok": True, "enabled": m["enabled"]}

    def _pull(self, dest_root: Path, m: dict, backup: Path):
        for rel in m["files"]:
            dst = dest_root / rel
            try:
                dst.unlink(missing_ok=True)
            except OSError:
                pass
            b = backup / rel
            if b.exists():
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(b, dst)
        for rel in sorted({str(Path(r).parent) for r in m["files"]}, key=len, reverse=True):
            d = dest_root / rel
            try:
                if rel not in (".", "") and d.is_dir() and not any(d.iterdir()):
                    d.rmdir()
            except OSError:
                pass

    def remove(self, key: str, mid: str) -> dict:
        r = self.set_enabled(key, mid, False)
        if r.get("error"):
            return r
        mods = [x for x in self._read(key) if x["id"] != mid]
        self._write(key, mods)
        shutil.rmtree(self._base(key) / mid, ignore_errors=True)
        return {"ok": True}

    def summary(self) -> list[dict]:
        out = []
        base = paths.DATA / "mods"
        if not base.is_dir():
            return out
        for info_key, info in list(self.store.library.items()):
            mods = self._read(info_key)
            if mods:
                out.append({"key": info_key, "title": info.get("title", info_key), "count": len(mods), "on": sum(1 for m in mods if m.get("enabled")), "dir": str(self.game_dir(info_key) or "")})
        out.sort(key=lambda x: x["title"].lower())
        return out
