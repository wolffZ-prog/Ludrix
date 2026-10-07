from __future__ import annotations

import json
import logging
import os
import subprocess
import re
import shutil
import threading
import time
import zipfile
from pathlib import Path

import requests

from . import paths

log = logging.getLogger("ludrix.emu")
from .titles import normalize_title
from .installer import Progress, Downloader, extract, flatten_single_folder, safe_extractall
from .repos import FileRef

ROM_TITLE_RE = re.compile(r"\s*[\(\[].*?[\)\]]")


LINUX_BIN: dict[str, list[str]] = {
    "duckstation": ["duckstation-qt", "duckstation-nogui", "DuckStation"], "pcsx2": ["pcsx2-qt", "pcsx2", "PCSX2"],
    "ppsspp": ["PPSSPPSDL", "PPSSPPQt", "ppsspp"], "rmg": ["RMG"], "dolphin": ["dolphin-emu", "dolphin-emu-nogui"],
    "flycast": ["flycast"], "xemu": ["xemu"], "xenia": [], "mgba": ["mgba-qt", "mgba"], "snes9x": ["snes9x-gtk", "snes9x"],
    "melonds": ["melonDS", "melonds"], "retroarch": ["retroarch"], "rpcs3": ["rpcs3"], "cemu": ["Cemu", "cemu"],
    "azahar": ["azahar", "azahar-room"], "eden": ["eden"], "mesen": ["Mesen", "mesen"], "ares": ["ares"], "mednafen": ["mednafen"],
    "mame": ["mame"], "stella": ["stella"], "dosbox": ["dosbox-staging", "dosbox"], "simple64": ["simple64-gui"],
    "redream": ["redream"], "desmume": ["desmume"], "bsnes": ["bsnes"], "fceux": ["fceux"], "blastem": ["blastem"],
    "scummvm": ["scummvm"], "dosbox-x": ["dosbox-x"], "bizhawk": [], "citron": ["citron"], "yabause": ["kronos", "yabause"],
    "fbneo": ["fbneo"], "supermodel": ["supermodel"], "vba-m": ["visualboyadvance-m", "vbam"], "play": ["Play"],
}
LINUX_FLATPAK: dict[str, str] = {
    "duckstation": "org.duckstation.DuckStation", "pcsx2": "net.pcsx2.PCSX2", "ppsspp": "org.ppsspp.PPSSPP",
    "rmg": "com.github.Rosalie241.RMG", "dolphin": "org.DolphinEmu.dolphin-emu", "flycast": "org.flycast.Flycast",
    "xemu": "app.xemu.xemu", "mgba": "io.mgba.mGBA", "snes9x": "com.snes9x.Snes9x", "melonds": "net.kuribo64.melonDS",
    "retroarch": "org.libretro.RetroArch", "rpcs3": "net.rpcs3.RPCS3", "cemu": "info.cemu.Cemu", "azahar": "org.azahar_emu.Azahar",
    "mesen": "ca.mesen.Mesen", "ares": "dev.ares.ares", "mame": "org.mamedev.MAME", "stella": "io.github.stella_emu.Stella",
    "dosbox": "io.github.dosbox-staging", "desmume": "org.desmume.DeSmuME", "bsnes": "dev.bsnes.bsnes", "fceux": "org.fceux.FCEUX",
    "scummvm": "org.scummvm.ScummVM", "dosbox-x": "com.dosbox_x.DOSBox-X", "simple64": "io.github.simple64.simple64",
}


def native_emulator(emu_id: str, cfg: dict) -> Path | None:
    for name in LINUX_BIN.get(emu_id, []):
        w = shutil.which(name)
        if w:
            return Path(w)
    fp = LINUX_FLATPAK.get(emu_id)
    if fp and shutil.which("flatpak"):
        try:
            r = subprocess.run(["flatpak", "info", fp], capture_output=True, text=True, timeout=8)
            if r.returncode == 0:
                d = paths.EMU_EMULATORS / emu_id
                d.mkdir(parents=True, exist_ok=True)
                sh = d / f"{emu_id}.sh"
                if not sh.exists():
                    sh.write_text(f'#!/bin/sh\nexec flatpak run {fp} "$@"\n', encoding="utf-8")
                    sh.chmod(0o755)
                return sh
        except Exception:
            pass
    return None


class EmulationManager:
    def __init__(self, store, session: requests.Session, cache):
        self.store = store
        self.s = session
        self.cache = cache
        self._upd: list[dict] = []
        self._upd_at = 0.0
        self.presets = self._load_presets()
        self._migrate_removed()
        self._scan_cache: dict[str, tuple[float, list]] = {}
        self._scan_lock = threading.Lock()
        self._scan_running: set[str] = set()
        self.SCAN_TTL = 120.0

    REMOVED = {"ryujinx": "eden", "sudachi": "eden"}

    def _migrate_removed(self):
        cfg = self.store.config
        ch = {}
        se = dict(cfg.get("system_emulator") or {})
        for sid, eid in list(se.items()):
            if eid in self.REMOVED:
                se[sid] = self.REMOVED[eid]
                ch["system_emulator"] = se
        ses = {k: [self.REMOVED.get(x, x) for x in v] for k, v in (cfg.get("system_emulators") or {}).items()}
        if ses != (cfg.get("system_emulators") or {}):
            ch["system_emulators"] = ses
        ge = {k: self.REMOVED.get(v, v) for k, v in (cfg.get("game_emulator") or {}).items()}
        if ge != (cfg.get("game_emulator") or {}):
            ch["game_emulator"] = ge
        ep = {k: v for k, v in (cfg.get("emu_paths") or {}).items() if k not in self.REMOVED}
        if len(ep) != len(cfg.get("emu_paths") or {}):
            ch["emu_paths"] = ep
        if ch:
            self.store.set_config(**ch)
        for old in self.REMOVED:
            d = paths.EMU_EMULATORS / old
            if d.exists():
                shutil.rmtree(d, ignore_errors=True)

    def invalidate_scan(self, sid: str | None = None):
        with self._scan_lock:
            if sid:
                self._scan_cache.pop(sid, None)
            else:
                self._scan_cache.clear()

    def _load_presets(self) -> dict:
        p = paths.PRESETS / "emulators.json"
        d = json.loads(p.read_text(encoding="utf-8"))
        if os.name != "nt" and "pc" in d.get("systems", {}):
            d["systems"]["pc"]["name"] = "PC"
        return d

    def emu_dir(self, emu_id: str) -> Path:
        return paths.EMU_EMULATORS / emu_id

    def all_emulators(self) -> dict:
        out = dict(self.presets["emulators"])
        for eid, c in (self.store.config.get("custom_emulators") or {}).items():
            out[eid] = {**c, "custom": True, "source": "custom"}
        return out

    def emulator_for(self, sid: str) -> str | None:
        pref = (self.store.config.get("system_emulator") or {}).get(sid)
        if pref and pref in self.all_emulators():
            return pref
        return self.presets["systems"].get(sid, {}).get("emulator")

    def installed_options(self, sid: str) -> list[dict]:
        allemu = self.all_emulators()
        sc = self.presets["systems"].get(sid, {})
        default = self.emulator_for(sid)
        ids = [eid for eid, ec in allemu.items() if sid in (ec.get("systems") or []) or sc.get("emulator") == eid]
        extra = (self.store.config.get("system_emulators") or {}).get(sid) or []
        for e in extra:
            if e in allemu and e not in ids:
                ids.append(e)
        out = [{"id": eid, "title": allemu[eid].get("title", eid), "default": eid == default} for eid in ids if self.emu_exe(eid)]
        out.sort(key=lambda x: (not x["default"], x["title"].lower()))
        return out

    def add_system_emulator(self, sid: str, eid: str):
        se = dict(self.store.config.get("system_emulators") or {})
        lst = list(se.get(sid) or [])
        if eid not in lst:
            lst.append(eid)
        se[sid] = lst
        self.store.set_config(system_emulators=se)

    def remove_system_emulator(self, sid: str, eid: str):
        se = dict(self.store.config.get("system_emulators") or {})
        se[sid] = [x for x in (se.get(sid) or []) if x != eid]
        self.store.set_config(system_emulators=se)

    def emu_exe(self, emu_id: str) -> Path | None:
        cfg = self.all_emulators().get(emu_id)
        if not cfg:
            return None
        if cfg.get("custom"):
            p = Path(cfg.get("exe") or "")
            return p if p.exists() else None
        d = self.emu_dir(emu_id)
        override = (self.store.config.get("emu_paths") or {}).get(emu_id)
        if override and Path(override).exists():
            return Path(override)
        if d.exists():
            direct = d / cfg["exe"]
            if direct.exists():
                return direct
            hits = list(d.rglob(cfg["exe"]))
            if hits:
                return hits[0]
            if os.name != "nt":
                for pat in LINUX_BIN.get(emu_id, []) + [cfg["exe"][:-4] if cfg["exe"].lower().endswith(".exe") else cfg["exe"]]:
                    if "*" in pat or "/" in pat:
                        continue
                    for h in d.rglob(pat):
                        if h.is_file():
                            return h
                for h in d.rglob("*.AppImage"):
                    return h
        if os.name != "nt":
            return native_emulator(emu_id, cfg)
        return None

    def system_status(self, sid: str, allemu: dict | None = None) -> dict | None:
        sc = self.presets["systems"].get(sid)
        if not sc or sid == "pc":
            return None
        allemu = allemu or self.all_emulators()
        emu = self.emulator_for(sid)
        exe = self.emu_exe(emu) if emu else None
        return {
            **sc, "id": sid, "emulator": emu,
            "emulator_title": allemu.get(emu, {}).get("title", emu),
            "installed": bool(exe),
            "games_dir": str(paths.EMU_GAMES / sid),
            "extra_dirs": (self.store.config.get("rom_dirs") or {}).get(sid, []),
            "dest": (self.store.config.get("rom_dest") or {}).get(sid, ""),
            "rom_count": len(self.scan_system(sid)),
            "options": sorted({eid for eid, ec in allemu.items() if sid in (ec.get("systems") or []) or sc.get("emulator") == eid}
                              | set((self.store.config.get("system_emulators") or {}).get(sid) or []),
                              key=lambda x: (x != sc.get("emulator"), x)),
            "installed_options": self.installed_options(sid),
            "emu_dir": str(exe.parent) if exe else "",
        }

    def status(self) -> dict:
        systems = {}
        allemu = self.all_emulators()
        for sid in self.presets["systems"]:
            st = self.system_status(sid, allemu)
            if st:
                systems[sid] = st
        emus = {}
        for eid, ec in allemu.items():
            exe = self.emu_exe(eid)
            emus[eid] = {**ec, "id": eid, "installed": bool(exe), "exe_path": str(exe) if exe else "",
                         "pointed": bool((self.store.config.get("emu_paths") or {}).get(eid)),
                         "systems": ec.get("systems") or [s for s, sc in self.presets["systems"].items() if sc.get("emulator") == eid]}
        if any(e["installed"] for e in emus.values()) and (not self._upd_at or time.time() - self._upd_at > 12 * 3600):
            if not getattr(self, "_upd_thread", None) or not self._upd_thread.is_alive():
                self._upd_thread = threading.Thread(target=self.check_updates, daemon=True)
                self._upd_thread.start()
        for u in self._upd:
            if u["id"] in emus:
                emus[u["id"]]["update"] = u["latest"]
        return {"systems": systems, "emulators": emus, "bios_dir": str(paths.EMU_BIOS),
                "games_root": str(paths.EMU_GAMES), "updates": self._upd}

    def add_custom_emulator(self, data: dict) -> dict:
        exe = Path(data.get("exe") or "")
        if not str(data.get("exe") or "").strip() or not exe.is_file():
            raise ValueError("Executável não encontrado")
        eid = re.sub(r"[^a-z0-9]+", "-", str(data.get("id") or data.get("title") or exe.stem).lower()).strip("-")
        if not eid:
            raise ValueError("Dê um nome ao emulador")
        args = data.get("args")
        if isinstance(args, str):
            args = [a for a in args.split() if a]
        systems = [s for s in (data.get("systems") or []) if s in self.presets["systems"]]
        base = data.get("based_on")
        if not args:
            if base and base in self.presets["emulators"]:
                args = self._args_for(base, systems[0] if systems else "")
            if not args:
                args = ["{rom}"]
        custom = dict(self.store.config.get("custom_emulators") or {})
        custom[eid] = {"title": data.get("title") or exe.stem, "exe": str(exe), "args": args, "systems": systems,
                       "based_on": base or ""}
        se = dict(self.store.config.get("system_emulator") or {})
        for sid in systems:
            se[sid] = eid
        self.store.set_config(custom_emulators=custom, system_emulator=se)
        return {"id": eid, **custom[eid]}

    def set_emulator_exe(self, eid: str, exe: str | None):
        ep = dict(self.store.config.get("emu_paths") or {})
        if exe:
            if not Path(exe).exists():
                raise ValueError("Executável não encontrado")
            ep[eid] = exe
        else:
            ep.pop(eid, None)
        self.store.set_config(emu_paths=ep)
        return {"ok": True, "exe": exe or ""}

    def remove_custom_emulator(self, eid: str):
        custom = dict(self.store.config.get("custom_emulators") or {})
        custom.pop(eid, None)
        se = {k: v for k, v in (self.store.config.get("system_emulator") or {}).items() if v != eid}
        self.store.set_config(custom_emulators=custom, system_emulator=se)

    def set_system_emulator(self, sid: str, eid: str | None):
        se = dict(self.store.config.get("system_emulator") or {})
        if eid:
            se[sid] = eid
        else:
            se.pop(sid, None)
        self.store.set_config(system_emulator=se)

    def add_rom_dir(self, sid: str, folder: str):
        rd = {k: list(v) for k, v in (self.store.config.get("rom_dirs") or {}).items()}
        lst = rd.setdefault(sid, [])
        if folder not in lst:
            lst.append(folder)
        self.store.set_config(rom_dirs=rd)
        self.invalidate_scan(sid)

    def remove_rom_dir(self, sid: str, folder: str):
        rd = {k: [x for x in v if x != folder] for k, v in (self.store.config.get("rom_dirs") or {}).items()}
        self.store.set_config(rom_dirs=rd)
        self.invalidate_scan(sid)

    def guess_system_for_file(self, path: str) -> str:
        ext = Path(path).suffix.lower()
        cands = [sid for sid, sc in self.presets["systems"].items() if ext in sc.get("exts", [])]
        if not cands:
            return ""
        if len(cands) == 1:
            return cands[0]

        from .repos import guess_system
        g = guess_system(str(path))
        return g if g in cands else cands[0]

    def add_rom_file(self, path: str, sid: str) -> dict:
        p = Path(path)
        if not p.exists():
            raise ValueError("Arquivo não encontrado")
        if sid not in self.presets["systems"] or sid == "pc":
            raise ValueError("Sistema inválido")
        lst = [x for x in (self.store.config.get("rom_files") or []) if x.get("path") != str(p)]
        lst.append({"path": str(p), "system": sid})
        self.store.set_config(rom_files=lst)
        self.invalidate_scan(sid)
        return {"ok": True, "key": f"rom:{sid}:{p.stem}", "title": ROM_TITLE_RE.sub("", p.stem).strip()}

    def remove_rom_file(self, path: str):
        lst = [x for x in (self.store.config.get("rom_files") or []) if x.get("path") != path]
        self.store.set_config(rom_files=lst)
        self.invalidate_scan()

    def scan_system(self, sid: str, wait: bool = True) -> list[dict]:
        with self._scan_lock:
            hit = self._scan_cache.get(sid)
            if hit and time.time() - hit[0] < self.SCAN_TTL:
                return hit[1]
            if not wait:
                if sid not in self._scan_running:
                    self._scan_running.add(sid)
                    threading.Thread(target=self._scan_bg, args=(sid,), daemon=True, name="romscan").start()
                return hit[1] if hit else []
            self._scan_running.add(sid)
        try:
            t0 = time.time()
            out = self._scan_system_uncached(sid)
            if time.time() - t0 > 0.5:
                log.info("roms %s: %d em %.1fs", sid, len(out), time.time() - t0)
        finally:
            with self._scan_lock:
                self._scan_running.discard(sid)
        with self._scan_lock:
            self._scan_cache[sid] = (time.time(), out)
        return out

    def _scan_bg(self, sid: str):
        try:
            t0 = time.time()
            out = self._scan_system_uncached(sid)
            if time.time() - t0 > 0.5:
                log.info("roms %s: %d em %.1fs", sid, len(out), time.time() - t0)
            with self._scan_lock:
                self._scan_cache[sid] = (time.time(), out)
        except Exception as e:
            log.debug("romscan %s: %s", sid, e)
        finally:
            with self._scan_lock:
                self._scan_running.discard(sid)

    def scan_pending(self) -> bool:
        with self._scan_lock:
            return bool(self._scan_running)

    def _scan_system_uncached(self, sid: str) -> list[dict]:
        sc = self.presets["systems"].get(sid)
        if not sc:
            return []
        dirs = [paths.EMU_GAMES / sid] + [Path(x) for x in (self.store.config.get("rom_dirs") or {}).get(sid, [])]
        exts = set(sc["exts"])
        out = []
        seen = set()
        files = []
        for d in dirs:
            if d.exists():
                try:
                    files += list(d.rglob("*"))
                except OSError:
                    pass

        for rf in (self.store.config.get("rom_files") or []):
            if rf.get("system") == sid:
                files.append(Path(rf["path"]))
        marker = sc.get("marker")
        overrides = self.store.config.get("title_overrides") or {}
        for f in sorted(files):
            if not f.is_file() or f.suffix.lower() not in exts:
                continue
            if marker and not str(f).replace("\\", "/").endswith(marker):
                continue

            if f.suffix.lower() == ".bin" and f.with_suffix(".cue").exists():
                continue
            if marker:
                game_root = f.parents[sc.get("title_up", 1) - 1]
                stem, title = game_root.name, ROM_TITLE_RE.sub("", game_root.name).strip()
            else:
                stem, title = f.stem, ROM_TITLE_RE.sub("", f.stem).strip()
            if title.lower() in seen:
                continue
            seen.add(title.lower())
            key = f"rom:{sid}:{stem}"
            ov = overrides.get(key)
            shown = (ov.get("title") if isinstance(ov, dict) else ov) or normalize_title(title) or title
            out.append({"key": key, "title": shown, "path": str(f), "system": sid,
                        "size": f.stat().st_size, "kind": "rom"})
        return out

    def scan_all(self, wait: bool = True) -> list[dict]:
        out = []
        for sid in self.presets["systems"]:
            if sid != "pc":
                out += self.scan_system(sid, wait)
        return out

    def ensure_game_dirs(self):
        for sid in self.presets["systems"]:
            if sid != "pc":
                (paths.EMU_GAMES / sid).mkdir(parents=True, exist_ok=True)

    def _latest_release(self, cfg: dict, ttl: int = 6 * 3600) -> dict | None:
        if cfg.get("source") not in ("github", "gitea"):
            return None
        api = f"{cfg['api'].rstrip('/')}/api/v1/repos/{cfg['repo']}/releases?limit=5" if cfg["source"] == "gitea" else f"https://api.github.com/repos/{cfg['repo']}/releases?per_page=5"
        rels = self.cache.get_json(f"gh_{cfg['repo']}", api, ttl)
        rels = [r for r in (rels or []) if not r.get("draft")]
        if not rels:
            return None
        return next((r for r in rels if not r.get("prerelease")), rels[0])

    @staticmethod
    def _norm_ver(v: str) -> str:
        return re.sub(r"^[vV]|[^0-9a-zA-Z.\-]", "", str(v or "")).strip().lower()

    @staticmethod
    def _rel_stamp(rel: dict) -> str:
        stamps = [a.get("updated_at") or a.get("created_at") or "" for a in rel.get("assets") or []]
        stamps.append(rel.get("published_at") or "")
        return max(stamps) if stamps else ""

    def check_updates(self, force: bool = False) -> list[dict]:
        now = time.time()
        if not force and self._upd_at and now - self._upd_at < 12 * 3600:
            return self._upd
        out = []
        for eid, cfg in self.presets["emulators"].items():
            info = self.store.get(f"emu:{eid}") or {}
            cur = info.get("version") or ""
            if not cur or not info.get("dir") or not self.emu_exe(eid) or (self.store.config.get("emu_paths") or {}).get(eid):
                continue
            try:
                rel = self._latest_release(cfg, 6 * 3600 if not force else 60)
            except Exception as e:
                log.debug("update check %s: %s", eid, e)
                continue
            if not rel:
                continue
            latest = rel.get("tag_name") or ""
            if not latest:
                continue
            if re.search(r"\d", latest) and self._norm_ver(latest) != self._norm_ver(cur):
                out.append({"id": eid, "title": cfg.get("title", eid), "current": cur, "latest": latest, "url": rel.get("html_url", "")})
            elif not re.search(r"\d", latest):
                have, new = info.get("release_at") or "", self._rel_stamp(rel)
                if have and new and new > have:
                    out.append({"id": eid, "title": cfg.get("title", eid), "current": have[:10], "latest": new[:10], "url": rel.get("html_url", "")})
        self._upd, self._upd_at = out, now
        return out

    def install_emulator(self, emu_id: str, cb, cancel: threading.Event, keep: bool = False):
        cfg = self.presets["emulators"][emu_id]
        dest = self.emu_dir(emu_id)
        tmp = paths.DOWNLOADS / f"emu_{emu_id}"
        tmp.mkdir(parents=True, exist_ok=True)

        if cfg["source"] == "manual":
            raise RuntimeError(f"{cfg['title']} não tem download automático. Baixe em {cfg.get('homepage', '')} e use 'Apontar .exe'.")
        if cfg["source"] in ("github", "gitea"):

            rel = self._latest_release(cfg, 60 if keep else 6 * 3600)
            if not rel:
                raise RuntimeError(f"Nenhuma versão publicada encontrada em {cfg['repo']}")
            assets = []
            if os.name != "nt":

                lpat = re.compile(cfg.get("asset_linux") or r"appimage|linux.*(x64|x86_64|64)|(x64|x86_64).*linux", re.I)
                assets = [a for a in rel["assets"] if lpat.search(a["name"]) and not re.search(r"arm64|aarch64|\.sha|\.sig|\.zsync|source|dbg|symbols|flatpak", a["name"], re.I)]
                assets.sort(key=lambda a: 0 if a["name"].lower().endswith(".appimage") else 1)
            if not assets:
                pat = re.compile(cfg.get("asset") or r"win.*(x64|64)|(x64|64).*win|windows", re.I)
                assets = [a for a in rel["assets"] if pat.search(a["name"]) and not re.search(r"installer|setup|symbols|pdb|dbg|arm64|linux|macos|\.dmg|appimage|source|\.sha|\.sig", a["name"], re.I)]
            if not assets:
                raise RuntimeError(f"Nenhum build {'de Linux ou ' if os.name != 'nt' else ''}Windows encontrado em {cfg['repo']}")
            a = assets[0]
            ref = FileRef(a["name"], a["browser_download_url"], int(a.get("size") or 0))
            version = rel.get("tag_name", "")
            release_at = self._rel_stamp(rel)
        else:
            url = cfg["url"]
            ref = FileRef(url.rsplit("/", 1)[-1], url, 0)
            version = re.search(r"(\d+\.\d+(\.\d+)?|\d{4}[a-z]?)", url)
            version = version.group(1) if version else ""
            release_at = ""

        archive = tmp / ref.basename
        cb(Progress("download", 0, f"Baixando {cfg['title']}..."))
        Downloader(self.s).download(ref, archive, cb, cancel)
        final_dest = dest
        if keep and dest.exists():
            dest = tmp / "new"
            shutil.rmtree(dest, ignore_errors=True)
        elif dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        cb(Progress("extract", 0, "Extraindo..."))
        if archive.name.lower().endswith(".appimage"):
            dest.mkdir(parents=True, exist_ok=True)
            final = dest / archive.name
            shutil.move(str(archive), str(final))
            final.chmod(0o755)
        elif archive.suffix.lower() == ".exe" and not zipfile.is_zipfile(archive):

            try:
                extract(archive, dest, cb, cancel)
            except Exception:
                dest.mkdir(parents=True, exist_ok=True)
                shutil.move(str(archive), str(dest / cfg["exe"]))
        else:
            extract(archive, dest, cb, cancel)
        flatten_single_folder(dest)
        if dest != final_dest:
            cb(Progress("extract", 0.9, "Atualizando arquivos (configurações e saves ficam)..."))
            shutil.copytree(dest, final_dest, dirs_exist_ok=True)
            dest = final_dest
        shutil.rmtree(tmp, ignore_errors=True)
        self._upd_at = 0

        flag = cfg.get("portable_flag")
        if flag:
            p = dest / flag
            if flag.endswith("/"):
                p.mkdir(parents=True, exist_ok=True)
            else:
                p.touch()
        if emu_id == "retroarch":
            self._retroarch_cores(dest, cb, cancel)

        self.store.set_installed(f"emu:{emu_id}", dir=str(dest), title=cfg["title"], kind="emulator", version=version, release_at=release_at)
        cb(Progress("done", 1.0, f"{cfg['title']} {version} instalado"))
        return dest

    def _retroarch_cores(self, dest: Path, cb, cancel):
        cores_url = self.presets["emulators"]["retroarch"]["cores_url"]
        cores_dir = dest / "cores"
        cores_dir.mkdir(exist_ok=True)
        cores = self.presets["emulators"]["retroarch"].get("cores", {})
        needed = {sc.get("core") or cores.get(sid) for sid, sc in self.presets["systems"].items()
                  if self.emulator_for(sid) == "retroarch" and (sc.get("core") or cores.get(sid))}
        for core in needed:
            if cancel.is_set():
                return
            cb(Progress("extract", -1, f"Baixando core {core}..."))
            try:
                r = self.s.get(cores_url.format(core=core), timeout=60)
                r.raise_for_status()
                safe_extractall(zipfile.ZipFile(__import__("io").BytesIO(r.content)), cores_dir)
            except Exception:
                pass

    def ensure_core(self, core: str) -> Path | None:
        dest = self.emu_dir("retroarch") / "cores" / f"{core}_libretro.dll"
        if dest.exists():
            return dest
        try:
            url = self.presets["emulators"]["retroarch"]["cores_url"].format(core=core)
            r = self.s.get(url, timeout=120)
            r.raise_for_status()
            dest.parent.mkdir(parents=True, exist_ok=True)
            safe_extractall(zipfile.ZipFile(__import__("io").BytesIO(r.content)), dest.parent)
        except Exception:
            return None
        return dest if dest.exists() else None

    def remove_emulator(self, emu_id: str):
        shutil.rmtree(self.emu_dir(emu_id), ignore_errors=True)
        self.store.remove(f"emu:{emu_id}")

    def launch_rom(self, rom_path: str, sid: str, emu_override: str | None = None) -> dict:
        sc = self.presets["systems"].get(sid)
        if not sc:
            return {"error": f"Sistema desconhecido: {sid}"}
        emu_id = emu_override if emu_override and emu_override in self.all_emulators() else self.emulator_for(sid)
        exe = self.emu_exe(emu_id) if emu_id else None
        if not exe:
            title = self.all_emulators().get(emu_id, {}).get("title", emu_id)
            return {"error": "emu_missing", "emulator": emu_id, "message": f"{title} não está instalado."}
        if sc.get("bios") and not any(paths.EMU_BIOS.iterdir()):
            hint = f"Este sistema precisa de BIOS/keys em {paths.EMU_BIOS}"
        else:
            hint = ""
        if emu_id == "retroarch":
            core_name = sc.get("core") or self.presets["emulators"]["retroarch"].get("cores", {}).get(sid)
            core = self.ensure_core(core_name) if core_name else None
            if not core:
                return {"error": "emu_missing", "emulator": emu_id, "message": f"Core do RetroArch pra {sc['name']} não encontrado."}
            args = ["-L", str(core), "-f", "{rom}"]
        else:
            args = self._args_for(emu_id, sid)
        rp = Path(rom_path)
        sub = {"{rom}": rom_path, "{romdir}": str(rp.parent), "{stem}": rp.stem}
        cmd = [str(exe)] + [self._sub(a, sub) for a in args]
        if not any(k in " ".join(args) for k in sub):
            cmd.append(rom_path)
        return {"cmd": cmd, "cwd": str(exe.parent), "hint": hint}

    @staticmethod
    def _sub(a: str, sub: dict) -> str:
        for k, v in sub.items():
            a = a.replace(k, v)
        return a

    def _args_for(self, emu_id: str, sid: str) -> list[str]:
        ec = self.all_emulators().get(emu_id, {})
        if ec.get("custom"):
            return ec.get("args") or ["{rom}"]
        ea = ec.get("args")
        if isinstance(ea, dict):
            return ea.get(sid) or ea.get("*") or ["{rom}"]
        if isinstance(ea, list):
            return ea
        sc = self.presets["systems"].get(sid, {})
        if sc.get("emulator") == emu_id and sc.get("args"):
            return sc["args"]
        return ["{rom}"]

    def open_emulator_gui(self, emu_id: str) -> dict:
        from . import compat
        exe = self.emu_exe(emu_id)
        if not exe:
            return {"error": "emu_missing", "emulator": emu_id, "message": "Emulador não instalado."}
        try:
            compat.popen([str(exe)], exe.parent, self.store.config)
        except (RuntimeError, OSError) as e:
            return {"error": str(e)}
        return {"ok": True}
