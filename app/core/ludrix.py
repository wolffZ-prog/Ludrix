from __future__ import annotations

import colorsys
import heapq
import html
import json
import os
import sys
import logging
import re
import shlex
import shutil
import threading
import time
import zipfile
import urllib.parse
import webbrowser
import concurrent.futures
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from pathlib import Path

import lxsign

from . import paths
from .emulation import EmulationManager
from .images import ImageCache, _safe as _safe_name
from .installer import STATS as installer_stats
from . import disc
from .installer import CancelledError, Downloader, Progress, find_executables, find_setup, human_size, install_game, install_from_archives, is_repack, safe_folder_name
from .metadata import MetadataService
from .mods import GameMods, ModsManager
from .saves import SaveManager
from .covers import CoverService
from .websearch import WebImageSearch
from . import optionals
from .updates import current_version
from .optionals import OptionalsManager
from . import minecraft
from .minecraft import MinecraftManager
from .custom import CustomUX
from .flash import FlashManager
from . import importers, hardware
from .repos import detect_source, Entry, FileRef, RepoRegistry
from .sessions import SessionManager, human_time
from .store import Store, DEFAULT_CONFIG
from .titles import normalize_title, title_from_path
from . import torrent as torrent_mod


_URI_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]+://")
_URI_NAMES = (("steam", "Steam"), ("epicgames", "Epic Games Launcher"), ("legendary", "Legendary"), ("goggalaxy", "GOG Galaxy"), ("gog", "GOG Galaxy"),
              ("uplay", "Ubisoft Connect"), ("ubisoft", "Ubisoft Connect"), ("origin", "EA app"), ("eadesktop", "EA app"), ("battlenet", "Battle.net"),
              ("amazon", "Amazon Games"), ("itch", "itch.io"), ("xbox", "Xbox"), ("ms-windows-store", "Microsoft Store"), ("http", "navegador"))


def uri_name(uri: str) -> str:
    scheme = str(uri or "").split("://", 1)[0].lower()
    for k, v in _URI_NAMES:
        if k in scheme:
            return v
    return scheme or "launcher"

log = logging.getLogger("ludrix")


def local_rom_key(key: str) -> bool:
    return key.startswith("rom:")


def _ps(v: str) -> str:
    return "'" + str(v).replace("'", "''") + "'"


class Ludrix:
    def __init__(self):
        paths.ensure_dirs()
        self.store = Store()
        self._backup_library()
        if self.store.config_fixed:
            log.warning("config.json: campos corrigidos ao carregar: %s", ", ".join(self.store.config_fixed))
        self.repos = RepoRegistry(self.store)
        self.images = ImageCache(self.repos.session)
        self.meta = MetadataService(self.repos.session, self.store)
        self.covers = CoverService(self.repos.session, self.store)
        self.meta.covers = self.covers
        self.meta.web = WebImageSearch(self.repos.session)
        self.emu = EmulationManager(self.store, self.repos.session, self.repos.cache)
        self.emu.ensure_game_dirs()
        self.mods = ModsManager(self.store, self.repos.session, self.repos.cache)
        self.gmods = GameMods(self.store)
        from .redists import RedistManager
        from .gamemode import GameMode
        self.redists = RedistManager(self.repos.session)
        self.optionals = OptionalsManager()
        self.mc = MinecraftManager()
        self.mced = minecraft.MinecraftEditions(self.mc)
        self.custom = CustomUX(self.store)
        self.custom.pick_file = lambda *a: self.pick_file(*a) if self.pick_file else None
        self.gamemode = GameMode(self.store)
        self._online: bool | None = None
        self._online_at = 0.0
        self.saves = SaveManager(self.store, self.emu)
        self.flash = FlashManager(self.store, self.repos.session, self.repos.cache)
        self.flash.on_cover = lambda gid: self._push({"type": "flash_cover", "id": gid})
        self.activity = {"text": "", "since": 0.0, "busy": False}
        self._cat_cache: dict[tuple, list[str]] = {}
        self._slim_cache: dict[str, tuple] = {}
        self._act_lock = threading.Lock()
        importers.EXT_GUESS = self.emu.guess_system_for_file
        self.pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="ludrix")

        self._mq: list[tuple[int, int, str]] = []
        self._mq_pending: set[str] = set()
        self._mq_lock = threading.Lock()
        self._mq_cv = threading.Condition(self._mq_lock)
        self._quiet = False
        self._mq_later: set[str] = set()
        self._mq_n = 0
        self._mq_total = 0
        self._mq_done = 0
        self._mq_workers: list[threading.Thread] = []
        self._thumb_pool = ThreadPoolExecutor(max_workers=6, thread_name_prefix="thumb")

        self.images.on_thumb = lambda k: self._push({"type": "thumb_ready", "key": k})
        self.gamepad = None
        self._rom_seen: dict[str, float] = {}
        self.entries: dict[str, Entry] = {}
        self.categories = self._load_categories()
        self.jobs: dict[str, dict] = {}
        self._events: list[dict] = []
        self._lock = threading.Lock()
        self._hist_lock = threading.RLock()
        self.catalog_state = {"loading": True, "errors": {}}
        self.pick_folder = None
        self.pick_file = None
        self.pick_files = None
        self.window_hooks = {}
        self.integrity = {}
        self.sessions = SessionManager(self.store, on_start=self._on_game_start, on_end=self._on_game_end)
        self.sessions.on_boost = lambda pid: self.gamemode.boost_pid(pid)
        from .updates import UpdateManager
        self.updates = UpdateManager(self.store, self.repos.session)
        from .terminal import Terminal
        self.terminal = Terminal(self)
        self.store.set_config(pending_restart=[])
        self.pool.submit(self._flush_pending_delete)
        if not self.store.config.get("keep_archive"):
            self.pool.submit(self.clean_downloads)
        self._boot = {"done": False, "i": 0, "n": 0, "step": "", "errors": [], "started": False}
        self._t0 = time.time()
        self._first_payload_at = 0.0
        self._exists_cache: dict[str, tuple[float, bool]] = {}
        self.pool.submit(self.bootstrap_run)
        self.pool.submit(lambda: self.emu.scan_all(True))
        self.reload_catalog(force=False)
        if self.store.config.get("update_auto_check"):
            self.pool.submit(self._auto_check_updates)

    RESTART_KEYS = {"frameless": "Janela sem moldura", "tray_enabled": "Ícone na bandeja", "torrent_enabled": "Suporte a torrent"}

    def _auto_check_updates(self):
        try:
            self.updates.check(online=self.online())
            if self.updates.available or self.updates.remote:
                v = (self.updates.available or self.updates.remote).get("version")
                self._push({"type": "update_available", "version": v})
        except Exception as e:
            log.warning("update check: %s", e)

    def updates_check(self) -> dict:
        return self.updates.check(online=self.online(True))

    def updates_download(self) -> dict:
        if self.updates.state.get("busy"):
            return {"error": "Já estou baixando"}

        def fn(cb, cancel):
            r = self.updates.download(lambda f: cb(Progress("download", f, "Atualização")))
            if r.get("error"):
                raise RuntimeError(r["error"])
            cb(Progress("done", 1, ""))
            return r
        self._run_job("update", "Atualização do launcher", "update", fn)
        return {"ok": True}

    def theme_palette(self) -> dict:
        tid = self.store.config.get("theme") or "system"
        if tid == "system":
            tid = "dark"
        css = self.theme_css(tid) or self.theme_css("dark")
        vals = {}
        for m in re.finditer(r"--([a-z0-9-]+)\s*:\s*([^;}]+)", css):
            vals[m.group(1)] = m.group(2).strip()

        def hexc(v, base="#0b0b0e"):
            v = (v or "").strip()
            m = re.match(r"#([0-9a-f]{3,8})$", v, re.I)
            if m:
                h = m.group(1)
                if len(h) in (3, 4):
                    h = "".join(c * 2 for c in h[:3])
                return "#" + h[:6].lower()
            m = re.match(r"rgba?\(([^)]+)\)", v)
            if m:
                parts = [p.strip() for p in m.group(1).replace("/", ",").split(",")]
                try:
                    r, g, b = (int(float(x)) for x in parts[:3])
                    a = float(parts[3]) if len(parts) > 3 else 1.0
                    if a > 1:
                        a /= 100
                    br, bg_, bb = int(base[1:3], 16), int(base[3:5], 16), int(base[5:7], 16)
                    return "#%02x%02x%02x" % (round(r * a + br * (1 - a)), round(g * a + bg_ * (1 - a)), round(b * a + bb * (1 - a)))
                except Exception:
                    return None
            return None
        scheme = "light" if "color-scheme:light" in css.replace(" ", "") else "dark"
        bg = hexc(vals.get("bg")) or ("#f4f4f5" if scheme == "light" else "#0b0b0e")
        text = hexc(vals.get("text"), bg) or ("#151517" if scheme == "light" else "#f2f2f4")
        tacc = ""
        if tid.startswith("file:"):
            try:
                tacc = json.loads((self._theme_dir(tid[5:]) / "theme.json").read_text(encoding="utf-8-sig")).get("accent") or ""
            except Exception:
                tacc = ""
        else:
            tacc = self.FACES[self.current_face()]["accent"]
        accent = hexc(self.store.config.get("accent") or tacc or vals.get("accent") or "", bg) or text
        return {"scheme": scheme, "bg": bg, "bg2": hexc(vals.get("bg2"), bg) or bg, "card": hexc(vals.get("card"), bg) or bg,
                "line": hexc(vals.get("line2") or vals.get("line"), bg) or text, "text": text,
                "muted": hexc(vals.get("muted"), bg) or text, "accent": accent, "red": hexc(vals.get("red"), bg) or "#ef4444",
                "green": hexc(vals.get("green2") or vals.get("green"), bg) or "#22c55e", "theme": tid}

    def updates_apply(self, relaunch: bool = True, restore: str | None = None) -> dict:
        try:
            paths.UPDATES.mkdir(parents=True, exist_ok=True)
            (paths.UPDATES / "theme.json").write_text(json.dumps(self.theme_palette()), encoding="utf-8")
        except Exception:
            pass
        r = self.updates.apply(relaunch, restore)
        if r.get("quit"):
            threading.Timer(0.8, lambda: self.window_hooks.get("quit", lambda: os._exit(0))()).start()
        return r

    @staticmethod
    def _safe_del_target(p: Path) -> bool:
        try:
            r = p.resolve()
            root = paths.ROOT.resolve()
        except Exception:
            return False
        home = Path.home().resolve()
        if r == root or r in root.parents or r == home or r == home.parent or r.parent == r:
            return False
        if root in r.parents:
            return True
        if len(r.parts) < 4 or r == home:
            return False
        return r.parts[1] not in ("usr", "etc", "bin", "lib", "tmp", "var", "opt", "Windows", "Program Files", "Program Files (x86)", "Users")

    def factory_reset(self) -> dict:
        import subprocess
        import sys
        targets = [paths.DATA, paths.CACHE, paths.DOWNLOADS, paths.GAMES, paths.EMU, paths.THEMES, paths.UPDATES, paths.TOOLS, paths.BIN, paths.FLASH, paths.REDISTS]
        gd = self.store.games_dir()
        if gd and gd != paths.GAMES:
            targets.append(gd)
        targets = [t for t in targets if self._safe_del_target(t)]

        script = (
            "import os,sys,time,shutil,subprocess\n"
            "pid=int(sys.argv[1]);tg=sys.argv[2].split('|');cmd=sys.argv[3:]\n"
            "for _ in range(200):\n"
            "  try:os.kill(pid,0)\n"
            "  except OSError:break\n"
            "  time.sleep(0.1)\n"
            "time.sleep(0.5)\n"
            "for t in tg:\n"
            "  if t and os.path.isdir(t):\n"
            "    for _ in range(5):\n"
            "      shutil.rmtree(t,ignore_errors=True)\n"
            "      if not os.path.exists(t):break\n"
            "      time.sleep(0.5)\n"
            "subprocess.Popen(cmd,close_fds=True)\n")
        launcher = ([sys.executable] if paths.FROZEN else [sys.executable, str(paths.APP / "main.py")]) + sys.argv[1:]
        args = [sys.executable, "-c", script, str(os.getpid()), "|".join(str(t) for t in targets)] + launcher
        if paths.FROZEN:
            args = [sys.executable, "--run-py", script, str(os.getpid()), "|".join(str(t) for t in targets)] + launcher
        flags = 0x00000008 | 0x00000200 if os.name == "nt" else 0
        try:
            for j in list(self.jobs):
                try:
                    self.cancel(j)
                except Exception:
                    pass
            subprocess.Popen(args, cwd=str(paths.ROOT), creationflags=flags, close_fds=True)
        except Exception as e:
            return {"error": str(e)}
        threading.Timer(0.8, lambda: self.window_hooks.get("quit", lambda: os._exit(0))()).start()
        threading.Timer(6.0, lambda: os._exit(0)).start()
        return {"ok": True, "quit": True}

    def updates_add_file(self) -> dict:
        if not self.pick_file:
            return {"native": False}
        f = self.pick_file("", "lxup")
        return self.updates.add_file(f) if f else {"cancel": True}

    def updates_pick_restore(self, allow_same: bool = False) -> dict:
        if not self.pick_file:
            return {"native": False}
        f = self.pick_file("", "srczip")
        return self.updates.read_restore(f, allow_same) if f else {"cancel": True}

    def integrity_status(self) -> dict:
        from . import integrity
        return integrity.now(paths.APP, paths.ROOT)

    def integrity_repair(self) -> dict:
        from . import integrity
        r = integrity.repair_now(paths.APP, paths.ROOT)
        if r.get("fixed") and not r.get("bad"):
            self.notify("ok", "Arquivos do launcher reparados", f"{len(r['fixed'])} arquivo(s) restaurado(s) a partir do pacote da versão {r.get('version') or ''}.", key="integrity")
        return r

    def integrity_report(self, rep: dict | None):
        self.integrity = rep or {}
        if not rep:
            return
        if rep.get("status") == "repaired":
            self.notify("ok", "Arquivos do launcher reparados", f"{len(rep.get('fixed') or [])} arquivo(s) estavam alterados ou faltando e foram restaurados a partir do pacote da versão {rep.get('version') or ''}.", key="integrity")
        elif rep.get("status") == "damaged":
            n = len(rep.get("bad") or [])
            self.notify("warn", "Arquivos do launcher alterados", f"{n} arquivo(s) faltando ou diferente(s) do esperado. Ajustes › Sistema › Sobre › Verificar arquivos.", key="integrity", action="integrity")

    def _on_game_start(self, sess):
        if sess.get("optimize"):
            try:
                done = self.gamemode.optimize()
                self.gamemode.boost_pid(sess["pid"])
                if self.store.config.get("game_mode_quiet", True):
                    self.set_quiet(True)
                    done["quiet"] = True
                self._push({"type": "gamemode", "on": True, "title": sess["title"], **done})
            except Exception as e:
                log.warning("gamemode: %s", e)
        mode = sess.get("after") or self.store.config.get("after_launch", "ask")
        if mode == "ask":
            return
        if mode == "close":
            self._push({"type": "closing", "title": sess["title"]})
            threading.Timer(1.5, lambda: self.window_hooks.get("quit", lambda: None)()).start()
        elif mode == "minimize" and self.store.config.get("tray_enabled", True):
            threading.Timer(1.0, lambda: self.window_hooks.get("hide", lambda: None)()).start()

    def _on_game_end(self, sess, elapsed):
        self._push({"type": "session_end", "key": sess["key"], "title": sess["title"], "elapsed": elapsed,
                    "elapsed_h": human_time(elapsed), "crashed": bool(sess.get("crashed")), "rc": sess.get("rc")})
        if not sess.get("crashed") and elapsed > 60 and (self.store.get(sess["key"]) or {}).get("crash_count"):
            self.store.update(sess["key"], crash_count=0)
        if sess.get("crashed"):
            info = self.store.get(sess["key"]) or {}
            n = int(info.get("crash_count") or 0) + 1
            self.store.update(sess["key"], crash_count=n, last_crash=time.time(), last_rc=sess.get("rc"))
            why = self._diagnose_crash(sess["key"], info, sess.get("rc"))
            self.notify("error", f"{sess['title']} fechou sozinho", why, key=sess["key"])
        if sess.get("optimize") and self.gamemode.active:
            try:
                r = self.gamemode.restore()
                self._push({"type": "gamemode", "on": False, "title": sess["title"], **r})
            except Exception as e:
                log.warning("gamemode restore: %s", e)
        if self._quiet and not self.sessions.active:
            self.set_quiet(False)
        if self.store.config.get("save_auto_backup", True) and elapsed > 45 and not sess.get("crashed"):
            threading.Thread(target=self._auto_save_backup, args=(sess["key"],), daemon=True).start()

        if sess.get("after", self.store.config.get("after_launch")) != "close":
            self.window_hooks.get("show", lambda: None)()

    def _auto_save_backup(self, key: str):
        try:
            g = self.game_payload(key)
            if not g:
                return
            out = self.saves.auto_backup(key, g)
            if out:
                log.info("save backup %s -> %s", key, out)
        except Exception as e:
            log.warning("save backup %s: %s", key, e)

    def _diagnose_crash(self, key: str, info: dict, rc) -> str:
        exe = Path(info.get("exe") or "")
        if info.get("mc"):
            it = self.mc.item(info.get("mc_launcher") or "")
            name = it["title"] if it else "launcher"
            return (f"O {name} fechou logo ao abrir. Abra-o direto uma vez para ver o que ele pede (Java, conta, atualização); "
                    "se não abrir, reinstale-o ou escolha outro launcher em Central › Minecraft.")
        if info.get("kind") == "rom":
            rom = exe
            if not rom.exists():
                return f"A ROM sumiu de {rom.parent}. Apague o jogo da biblioteca e adicione de novo apontando o arquivo certo."
            try:
                if rom.stat().st_size < 1024:
                    return "A ROM tem menos de 1 KB — arquivo corrompido ou download incompleto. Apague e baixe de novo."
            except OSError:
                pass
            return ("O emulador fechou na hora. Causas comuns: ROM corrompida, BIOS/keys faltando ou emulador desatualizado. "
                    "Teste abrir a ROM direto no emulador; se também falhar, apague o jogo e adicione de novo.")
        if not exe.exists():
            return f"O executável não existe mais ({exe}). A pasta foi movida ou apagada — remova o jogo e adicione de novo."
        try:
            if exe.stat().st_size < 4096:
                return "O executável tem menos de 4 KB: arquivo corrompido. Desinstale e baixe/instale de novo."
        except OSError:
            pass
        code = f" (código {rc})" if rc not in (None, 0) else ""
        if rc in (0xC0000135, 3221225781, -1073741515):
            return f"Falta uma DLL{code}: instale os pacotes da aba Redists (Visual C++, DirectX) e tente de novo."
        if rc in (0xC0000005, 3221225477, -1073741819):
            return f"Falha de acesso à memória{code}: arquivo do jogo corrompido ou incompatível. Verifique a instalação; se persistir, desinstale e instale de novo."
        if rc in (740, 0x2E4):
            return "O jogo exige permissão de administrador. Use 'Trocar executável' e marque 'Executar como administrador' no arquivo."
        return (f"Fechou em poucos segundos{code}. Normalmente é instalação incompleta ou arquivo corrompido: "
                "verifique os Redists, ou desinstale e adicione o jogo de novo. Se ele só abre um launcher próprio, ignore este aviso.")

    def _load_categories(self):
        p = paths.PRESETS / "categories.json"
        cats = json.loads(p.read_text(encoding="utf-8"))["categories"]
        for c in cats:

            c["_re"] = re.compile(c["match"].lower()) if c.get("match") else None
        return cats

    def _catalog_error(self, prov, ex) -> dict:
        msg = str(ex)
        missing = False
        if isinstance(ex, (FileNotFoundError, NotADirectoryError)):
            missing = True
            src = str(prov.cfg.get("url") or prov.cfg.get("path") or getattr(ex, "filename", "") or "")
            msg = f"Arquivo não encontrado: {src}" if src else "Arquivo não encontrado"
        return {"name": prov.name, "msg": msg, "missing": missing}

    def reload_catalog(self, force: bool):
        self.catalog_state = {"loading": True, "errors": {}}
        gen = self._catalog_gen = getattr(self, "_catalog_gen", 0) + 1

        def work():
            t0 = time.time()
            new: dict[str, Entry] = {}
            errors = {}
            provs = self.repos.enabled_providers()
            for i, prov in enumerate(provs):
                self.act(f"Carregando catálogo {i + 1}/{len(provs)}: {prov.name}")
                try:
                    for e in prov.catalog(force=force):
                        old = self.entries.get(e.key)
                        if old and old.files_loaded and not force:
                            e.files, e.files_loaded, e.cover = old.files, True, old.cover
                        new[e.key] = e
                except Exception as ex:
                    log.exception("catalog %s", prov.id)
                    errors[prov.id] = self._catalog_error(prov, ex)
                if prov.cfg.get("_drop"):
                    try:
                        self.repos.remove(prov.id)
                    except Exception:
                        pass
            if gen != self._catalog_gen:
                return
            with self._lock:
                self.entries = new

            for e in list(new.values()):
                try:
                    self._slim(e)
                except Exception:
                    pass
            self.catalog_state = {"loading": False, "errors": errors}
            log.info("catálogo: %d itens de %d fontes em %.1fs", len(new), len(provs), time.time() - t0)
            self.act("")
            try:
                self.minecraft_autoadd()
            except Exception:
                log.exception("minecraft")
            if self.store.config.get("bg_warmup"):
                try:
                    self.pool.submit(self._warm_up)
                except RuntimeError:
                    pass

        threading.Thread(target=work, daemon=True).start()

    def _absorb_site_entries(self):
        if self.catalog_state["loading"]:
            return
        disabled = self.repos._disabled()
        for prov in self.repos.providers.values():
            if prov.id in disabled or not hasattr(prov, "drain_new"):
                continue
            new = prov.drain_new()
            if new:
                with self._lock:
                    for e in new:
                        self.entries.setdefault(e.key, e)

    def sites_loading(self) -> bool:
        return any(getattr(p, "loading", False) for p in self.repos.providers.values())

    def _category_of(self, e: Entry, meta: dict | None) -> list[str]:
        ck = (e.key, (meta or {}).get("fetched_at", 0))
        hit = self._cat_cache.get(ck)
        if hit is not None:
            return hit
        out = self._category_calc(e, meta)
        if len(self._cat_cache) > 60000:
            self._cat_cache.clear()
        self._cat_cache[ck] = out
        return out

    def _category_calc(self, e: Entry, meta: dict | None) -> list[str]:
        out = []
        if e.kind == "recomp":
            out.append("recomp")
        if e.kind == "rom":
            out.append("emu")

        genres = " ".join((meta or {}).get("genres", []) + e.genres).lower()
        gmap = {"sports": ("esport", "futebol", "basquete", "skate", "luta livre", "beisebol"),
                "racing": ("corrida",), "shooter": ("fps", "tiro"), "action": ("ação", "aventura", "plataforma", "luta", "terror", "rpg", "hack"),
                "strategy": ("estratégia", "simulação", "god game", "tower")}
        for cid, words in gmap.items():
            if any(w in genres for w in words):
                out.append(cid)
        if not out:
            title = e.title.lower()
            for c in self.categories:
                if c.get("_re") and c["_re"].search(title):
                    out.append(c["id"])
                    break
        return out or ["other"]

    def _slim(self, e: Entry) -> dict:
        key = e.key
        info = self.store.library.get(key)
        sig = (id(e), self.meta.mtime(key), key in self._favs, key in self.jobs, self.images.has_thumb(key), self.covers.custom_path(key) is not None,
               (info.get("playtime"), info.get("last_played"), info.get("installed_at"), info.get("exe"), info.get("dir")) if info else None)
        hit = self._slim_cache.get(key)
        if hit is not None and hit[0] == sig:
            return hit[1]
        d = self._slim_build(e)
        if len(self._slim_cache) > 80000:
            self._slim_cache.clear()
        self._slim_cache[key] = (sig, d)
        return d

    def _slim_build(self, e: Entry) -> dict:
        m = self.meta.get(e.key)
        genres = (m or {}).get("genres") or e.genres
        return {
            "key": e.key, "repo": e.repo, "title": e.title, "kind": e.kind, "system": e.system,
            "creator": (m or {}).get("developer") or e.creator, "year": (m or {}).get("year") or e.year,
            "size": e.size, "genres": genres[:3], "cats": self._category_of(e, m),
            "installed": self.store.is_installed(e.key) or bool(e.extra.get("local_path") and Path(e.extra["local_path"]).exists()), "job": e.key in self.jobs,
            "has_meta": bool(m), "thumb_ok": self.images.has_thumb(e.key) or bool(self.covers.custom_path(e.key)),
            "torrent": bool(e.magnet or e.torrent_url),
            "playtime": (self.store.get(e.key) or {}).get("playtime", 0),
            "last_played": (self.store.get(e.key) or {}).get("last_played", 0),
            "added_at": (self.store.get(e.key) or {}).get("installed_at", 0) or e.extra.get("posted", 0),
            "fav": e.key in self._favs, "cv": self._cv(e.key, m),
        }

    def _local_games(self) -> list[dict]:
        out = []
        ga = self.store.config.get("game_args") or {}
        for key, info in list(self.store.library.items()):
            if not key.startswith("local:"):
                continue
            m = self.meta.get(key)
            out.append({
                "key": key, "repo": "local", "title": info.get("title", key), "kind": "local", "system": info.get("system") or "pc",
                "creator": (m or {}).get("developer") or info.get("creator", ""), "year": (m or {}).get("year") or info.get("year", ""), "size": 0,
                "genres": ((m or {}).get("genres") or info.get("genres") or [])[:3], "installed": self._exists_cached(info.get("exe", "")) or "://" in str(info.get("exe", "")) or str(info.get("exe", "")).startswith(("shell:", "flatpak:")) or bool(info.get("mc") == "java" and not info.get("exe") and info.get("dir") and Path(info["dir"]).is_dir()), "job": False,
                "mc": info.get("mc", ""), "mc_nolauncher": bool(info.get("mc") == "java" and not info.get("exe")),
                "has_meta": bool(m), "thumb_ok": self.images.has_thumb(key), "torrent": False,
                "playtime": info.get("playtime", 0), "last_played": info.get("last_played", 0),
                "added_at": info.get("installed_at", 0), "fav": key in self._favs, "cv": self._cv(key, m), "source": info.get("source", ""),
                "store_src": info.get("store_src", ""), "play_count": info.get("play_count", 0), "has_args": key in ga,
            })
        for g in out:
            fake = Entry(key=g["key"], repo="local", id=g["key"], title=g["title"], kind="local", genres=g["genres"])
            g["cats"] = self._category_of(fake, self.meta.get(g["key"]))
        return out

    def _exists_cached(self, path: str) -> bool:
        if not path:
            return False
        now = time.time()
        hit = self._exists_cache.get(path)
        if hit and now - hit[0] < 20:
            return hit[1]
        ok = Path(path).exists()
        if len(self._exists_cache) > 5000:
            self._exists_cache.clear()
        self._exists_cache[path] = (now, ok)
        return ok

    @property
    def _favs(self) -> set:
        return set(self.store.config.get("favorites") or [])

    def toggle_favorite(self, key: str) -> dict:
        favs = self._favs
        (favs.discard if key in favs else favs.add)(key)
        self.store.set_config(favorites=sorted(favs))
        return {"ok": True, "fav": key in favs}

    def catalog_payload(self) -> dict:
        self._absorb_site_entries()
        with self._lock:
            entries = list(self.entries.values())
        hidden = {r["id"] for r in self.repos.list() if r.get("hidden_in_library")}
        games = [self._slim(e) for e in entries if e.repo not in hidden]
        lib = list(self.store.library.items())
        owned = {str(i.get("exe")) for _, i in lib if i.get("kind") == "rom" and i.get("exe")}
        owned_keys = {k for k, _ in lib if k.startswith("rom:")}

        roms = [r for r in self.emu.scan_all(wait=False) if r["path"] not in owned or r["key"] in owned_keys]
        for r in roms:
            info = self.store.get(r["key"]) or {}
            m = self.meta.get(r["key"])
            r.update({"installed": True, "job": False, "cats": ["emu"], "genres": ((m or {}).get("genres") or [])[:3],
                      "creator": (m or {}).get("developer", ""), "year": (m or {}).get("year", ""),
                      "repo": "local", "has_meta": bool(m), "thumb_ok": self.images.has_thumb(r["key"]), "torrent": False,
                      "playtime": info.get("playtime", 0), "last_played": info.get("last_played", 0),
                      "added_at": info.get("installed_at", 0) or (self._rom_seen.setdefault(r["key"], time.time())), "fav": r["key"] in self._favs, "cv": self._cv(r["key"], m),
                      "source": info.get("source", ""), "store_src": info.get("store_src", ""), "play_count": info.get("play_count", 0)})
        seen_roms = {r["key"] for r in roms}
        for k, info in lib:
            if not k.startswith("rom:") or k in seen_roms or info.get("kind") != "rom":
                continue
            ex = str(info.get("exe") or "")
            if not ex or Path(ex).exists():
                continue
            m = self.meta.get(k)
            sid = info.get("system") or (k.split(":", 2)[1] if k.count(":") >= 2 else "")
            roms.append({"key": k, "repo": "local", "id": k, "title": info.get("title") or k.rsplit(":", 1)[-1], "kind": "rom", "system": sid, "path": ex, "size": 0,
                         "installed": False, "missing": True, "job": False, "cats": ["emu"], "genres": ((m or {}).get("genres") or [])[:3],
                         "creator": (m or {}).get("developer", ""), "year": (m or {}).get("year", ""), "has_meta": bool(m), "thumb_ok": self.images.has_thumb(k), "torrent": False,
                         "playtime": info.get("playtime", 0), "last_played": info.get("last_played", 0), "added_at": info.get("installed_at", 0), "fav": k in self._favs, "cv": self._cv(k, m),
                         "source": info.get("source", ""), "store_src": info.get("store_src", ""), "play_count": info.get("play_count", 0)})
        games += roms + self._local_games()
        cats = [{"id": c["id"], "name": c["name"], "icon": c.get("icon", "")} for c in self.categories] + \
               [{"id": "other", "name": "Outros", "icon": "dots"}]
        if not self._first_payload_at:
            self._first_payload_at = time.time()
            log.info("primeira biblioteca servida %.2fs após abrir (%d itens, roms %s)", self._first_payload_at - self._t0, len(games), "pendentes" if self.emu.scan_pending() else "ok")
        return {
            **self.catalog_state, "games": games, "categories": cats, "sites_loading": self.sites_loading(), "roms_pending": self.emu.scan_pending(),
            "repos": [{"id": r["id"], "name": r["name"], "enabled": r["enabled"], "kind": r.get("kind", "pc"),
                       "hidden": bool(r.get("hidden_in_library"))} for r in self.repos.list()],
            "systems": {k: v["name"] for k, v in self.emu.presets["systems"].items()},
            "config": self.public_config(), "faces": self.faces(), "custom": self.custom.get(),
            "torrent_available": torrent_mod.available(), "torrent_engine": torrent_mod.engine(),
            "sessions": self.sessions.status(),
            "gamepad": self.gamepad.status() if self.gamepad else {"available": False, "connected": 0},
        }

    def data_export(self) -> dict:
        from . import backup
        dest = None
        if self.pick_folder:
            dest = self.pick_folder(str(paths.ROOT))
            if not dest:
                return {"cancel": True}
        return backup.export_data(Path(dest) if dest else paths.ROOT, self.updates.status()["current"].get("version", "?"))

    def data_inspect(self, path: str | None) -> dict:
        from . import backup
        if not path:
            if not self.pick_file:
                return {"error": "Informe o caminho do zip"}
            path = self.pick_file(str(paths.ROOT), "backup")
            if not path:
                return {"cancel": True}
        r = backup.inspect(path)
        r["path"] = path
        return r

    def data_import(self, path: str) -> dict:
        from . import backup
        r = backup.import_data(path, self.updates.status()["current"].get("version", "?"))
        if r.get("ok"):
            self.store.freeze()
        return r

    def safe_restore(self) -> dict:
        from . import diag
        ok = diag.restore_settings(self.store)
        self.safe_saved = None
        return {"ok": ok, "config": self.public_config()}

    def public_config(self) -> dict:
        c = dict(self.store.config)
        c["sgdb_key_set"] = bool(c.get("sgdb_key"))
        c["sgdb_key"] = ""
        c["games_dir_effective"] = str(self.store.games_dir())
        c["downloads_dir"] = str(paths.DOWNLOADS)
        c["root"] = str(paths.ROOT)
        from . import diag
        c["webview2"] = diag.webview2_mode()
        c["integrity"] = {"status": self.integrity.get("status", ""), "bad": len(self.integrity.get("bad") or []), "fixed": len(self.integrity.get("fixed") or []), "checked": self.integrity.get("checked", 0)}
        c["native"] = bool(self.pick_folder)
        c["os"] = "windows" if os.name == "nt" else ("mac" if sys.platform == "darwin" else "linux")
        c["appimage"] = bool(paths.APPIMAGE)
        c["frameless"] = bool(self.window_hooks.get("minimize")) and bool(self.store.config.get("frameless", True)) and os.name == "nt"
        cur = self.updates.status()["current"]
        c["version"] = cur.get("version", "?")
        c["version_changelog"] = cur.get("changelog", "")
        c["version_date"] = cur.get("date", "")
        c["restart_labels"] = self.RESTART_KEYS
        c["safe_mode"] = bool(getattr(self, "safe_mode", False))
        c["safe_saved"] = bool(getattr(self, "safe_saved", None))
        c["rolled_back"] = getattr(self, "rolled_back", None)
        c["settings_locked"] = bool(c.get("settings_lock"))
        c["settings_lock"] = ""
        return c

    def entry(self, key: str) -> Entry | None:
        return self.entries.get(key)

    def site_search(self, q: str) -> dict:
        q = (q or "").strip()
        if len(q) < 3:
            return {"games": [], "sources": []}
        provs = [p for p in self.repos.enabled_providers() if hasattr(p, "search_remote")]
        found, srcs = [], []
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
            futs = {ex.submit(p.search, q): p for p in provs}
            for f in concurrent.futures.as_completed(futs, timeout=40):
                p = futs[f]
                try:
                    items = f.result()
                except Exception as e:
                    log.warning("site search %s: %s", p.id, e)
                    continue
                srcs.append({"id": p.id, "name": p.name, "count": len(items)})
                with self._lock:
                    for e in items:
                        self.entries.setdefault(e.key, e)
                found += items
        return {"games": [self._slim(e) for e in found], "sources": srcs}

    @staticmethod
    def _needs_resolve(src: str) -> bool:
        return bool(re.match(r"^(tg|srr):", src or ""))

    def files_for(self, e: Entry) -> list[FileRef]:
        prov = self.repos.providers.get(e.repo)
        return prov.files(e) if prov else [FileRef(**f) for f in e.files]

    def game_payload(self, key: str) -> dict | None:
        d = self._game_payload(key)
        if d:
            d["custom_cover"] = bool(self.covers.custom_path(key))
            d["cover_src"] = "custom" if d["custom_cover"] else ((d.get("meta") or {}).get("cover_src") or "")
            info = self.store.get(key) or {}
            if info and not info.get("repack") and not info.get("exe") and info.get("kind", "pc") == "pc" and info.get("dir") and Path(info["dir"]).is_dir():
                dp = disc.plan(Path(info["dir"]))
                if dp:
                    self.store.update(key, repack=dp["image"], repack_state="pending", disc=dp)
                    info = self.store.get(key) or {}
            if info.get("repack"):
                d["repack"], d["repack_state"] = info["repack"], info.get("repack_state", "pending")
                if info.get("disc"):
                    d["disc"] = info["disc"]
                if d["repack_state"] != "done":
                    d["installed"] = False
            ex = str(info.get("exe") or "")
            if ex and "://" not in ex and not ex.startswith(("shell:", "flatpak:")) and not Path(ex).exists():
                d["missing"] = True
            for k in ("store_src", "play_count", "last_session", "workdir", "source"):
                if info.get(k):
                    d[k] = info[k]
            if info.get("installed_at") and not d.get("added_at"):
                d["added_at"] = info["installed_at"]
            if info.get("crash_count"):
                d["crash_count"] = info["crash_count"]
                d["crash_why"] = self._diagnose_crash(key, info, info.get("last_rc"))
        return d

    def _game_payload(self, key: str) -> dict | None:
        if key.startswith("rom:"):
            for r in self.emu.scan_all():
                if r["key"] == key:
                    m = self.meta.get(key)
                    sysname = self.emu.presets["systems"][r["system"]]["name"]
                    return {**r, "installed": True, "files": [], "meta": m, "creator": (m or {}).get("developer", ""),
                            "year": (m or {}).get("year", ""), "genres": (m or {}).get("genres", []),
                            "description": (m or {}).get("summary", ""), "dir": str(Path(r["path"]).parent),
                            "exe": r["path"], "args": self._game_args(key), "system_name": sysname, "emu": self.emu.system_status(r["system"]), "job": None,
                            "playtime": (self.store.get(key) or {}).get("playtime", 0), "playtime_h": human_time((self.store.get(key) or {}).get("playtime", 0)),
                            "last_played": (self.store.get(key) or {}).get("last_played", 0)}
            info = self.store.get(key)
            if not info or not info.get("exe"):
                return None
            sid = info.get("system") or (key.split(":", 2)[1] if key.count(":") >= 2 else "")
            m = self.meta.get(key)
            sysname = (self.emu.presets["systems"].get(sid) or {}).get("name", sid)
            ok = Path(info["exe"]).exists()
            return {"key": key, "repo": "local", "id": key, "title": info.get("title") or key.rsplit(":", 1)[-1], "kind": "rom", "system": sid, "path": info["exe"], "size": 0,
                    "installed": ok, "missing": not ok, "source": info.get("source", ""), "store_src": info.get("store_src", ""), "play_count": info.get("play_count", 0), "last_session": info.get("last_session", 0), "added_at": info.get("installed_at", 0), "files": [], "meta": m, "creator": (m or {}).get("developer", ""),
                    "year": (m or {}).get("year", ""), "genres": (m or {}).get("genres", []), "description": (m or {}).get("summary", ""),
                    "dir": str(Path(info["exe"]).parent), "exe": info["exe"], "args": self._game_args(key), "system_name": sysname,
                    "emu": self.emu.system_status(sid) if sid in self.emu.presets["systems"] else {}, "job": None,
                    "playtime": info.get("playtime", 0), "playtime_h": human_time(info.get("playtime", 0)), "last_played": info.get("last_played", 0)}
        if key.startswith("local:"):
            info = self.store.get(key)
            if not info:
                return None
            m = self.meta.get(key)
            return {"key": key, "repo": "local", "title": info.get("title", ""), "kind": "local", "system": info.get("system") or "pc", "system_name": self.emu.presets["systems"].get(info.get("system") or "pc", {}).get("name", "PC (Windows)"),
                    "title_orig": info.get("title_orig", ""), "title_locked": bool(info.get("title_locked")),
                    "installed": True, "dir": info.get("dir", ""), "exe": info.get("exe", ""), "args": self._game_args(key), "files": [], "meta": m, "job": None,
                    "creator": (m or {}).get("developer", "") or info.get("creator", ""), "year": (m or {}).get("year", "") or info.get("year", ""),
                    "genres": (m or {}).get("genres", []) or info.get("genres", []), "mc": info.get("mc", ""),
                    "description": (m or {}).get("summary", "") or info.get("description", ""), "size": 0, "page_url": info.get("page_url", ""), "requires_rom": "", "version": "",
                    "playtime": info.get("playtime", 0), "playtime_h": human_time(info.get("playtime", 0)), "last_played": info.get("last_played", 0)}
        e = self.entry(key)
        if not e:
            return None
        try:
            files = self.files_for(e)
        except Exception as ex:
            log.warning("files %s: %s", key, ex)
            files = []
        info = self.store.get(key) or {}
        m = self.meta.get(key)
        return {
            **{k: v for k, v in asdict(e).items() if k not in ("files", "extra")},
            "files": [asdict(f) | {"basename": f.basename} for f in files], "mirrors": bool(e.extra.get("mirrors")),
            "installed": self.store.is_installed(key), "dir": info.get("dir", ""), "exe": info.get("exe", ""), "args": self._game_args(key),
            "version": info.get("version") or e.extra.get("version", ""),
            "requires_rom": e.extra.get("requires_rom", ""),
            "meta": m, "job": self.job_payload(key),
            "system_name": self.emu.presets["systems"].get(e.system, {}).get("name", e.system),
            "emu": self.emu.system_status(e.system) if e.kind == "rom" and e.system != "pc" else None,
            "torrent_available": torrent_mod.available(), "torrent_engine": torrent_mod.engine(),
            "playtime": info.get("playtime", 0), "playtime_h": human_time(info.get("playtime", 0)), "last_played": info.get("last_played", 0),
            "browser_only": bool(hasattr(self.repos.providers.get(e.repo), "browser_url")),
            "buy_only": e.extra.get("buy_only", ""), "steam_url": e.extra.get("steam_url", ""),
            "patches": list(e.extra.get("patches") or []), "prefer": e.extra.get("prefer", ""),
        }

    def _meta_cover_url(self, m: dict | None, thumb: bool) -> str:
        if not m:
            return ""
        if m.get("cover_src") == "manual" and m.get("cover_url"):
            return m["cover_url"]
        if thumb and m.get("grid_thumb"):
            return m["grid_thumb"]
        return m.get("cover_url") or m.get("grid") or m.get("wiki_image", "")

    def thumb_path(self, key: str, wait: bool = True) -> Path | None:
        c = self.covers.custom_path(key)
        if c:
            return self.images.local_thumb(key, c)
        if not wait:

            p = self.images.cached_thumb(key)
            if p:
                return p
            self._thumb_bg(key)
            return None
        e = self.entry(key)
        m = self.meta.get(key)
        if e:
            prov = self.repos.providers.get(e.repo)
            manual = m.get("cover_url") if m and m.get("cover_src") == "manual" else ""
            url = manual or (prov.thumb_url(e) if prov else e.thumb) or self._meta_cover_url(m, True)
            p = self.images.thumb(key, url)
            if not p and m and e.cover and e.cover != url:
                p = self.images.thumb(key, e.cover)
            if not p and not m:
                self._prefetch(key)
            elif not p:
                self._deep_cover(key, e)
            return p
        p = self.images.thumb(key, self._meta_cover_url(m, True)) if m else None
        if not m:
            self._prefetch(key)
        return p

    def cover_path(self, key: str) -> Path | None:
        c = self.covers.custom_path(key)
        if c:
            return c
        m = self.meta.get(key)
        e = self.entry(key)
        if e:
            try:
                self.files_for(e)
            except Exception:
                pass
            url = self._meta_cover_url(m, False) or e.cover
            c = self.images.cover(key, url)
            if c and not self.images.cached_thumb(key):
                self._thumb_bg(key)
            return c or self.thumb_path(key)
        url = self._meta_cover_url(m, False)
        c = self.images.cover(key, url) if url else None
        if c and not self.images.cached_thumb(key):
            self._thumb_bg(key)
        return c

    def shot_path(self, key: str, i: int) -> Path | None:
        m = self.meta.get(key) or {}
        shots = m.get("shots") or []
        if not 0 <= i < len(shots):
            return None
        return self.images.shot(key, i, shots[i])

    def warm_shots(self, key: str):
        m = self.meta.get(key) or {}
        for i in range(min(3, len(m.get("shots") or []))):
            try:
                self.shot_path(key, i)
            except Exception:
                pass

    def hero_path(self, key: str) -> Path | None:
        m = self.meta.get(key)
        bgf = (m or {}).get("background_file")
        if bgf and Path(bgf).is_file():
            return Path(bgf)
        url = (m or {}).get("hero") or (m or {}).get("hero_url")
        if url:
            h = self.images.cover("hero:" + key, url)
            if h:
                return h
        return self._cover_hero(key)

    def _cover_hero(self, key: str) -> Path | None:
        c = self.cover_path(key)
        if not c:
            return None
        p = paths.CACHE_COVERS / f"h_{_safe_name(key)}.jpg"
        try:
            if p.exists() and p.stat().st_mtime >= c.stat().st_mtime:
                return p
            from PIL import Image, ImageEnhance, ImageFilter
            im = Image.open(c).convert("RGB")
            w, h = 1280, 720
            k = max(w / im.width, h / im.height)
            im = im.resize((max(w, int(im.width * k)), max(h, int(im.height * k))), Image.LANCZOS)
            x, y = (im.width - w) // 2, max(0, (im.height - h) // 3)
            im = im.crop((x, y, x + w, y + h)).filter(ImageFilter.GaussianBlur(26))
            im = ImageEnhance.Color(im).enhance(1.5)
            im = ImageEnhance.Brightness(im).enhance(0.92)
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(".tmp")
            im.save(tmp, "JPEG", quality=80)
            tmp.replace(p)
            return p
        except Exception:
            return c

    def _thumb_bg(self, key: str):
        if not self.covers.once("thumb:" + key):
            return

        def work():
            try:
                self.thumb_path(key, wait=True)
            except Exception as ex:
                log.debug("thumb bg %s: %s", key, ex)
            finally:
                self.covers.done("thumb:" + key)
        self._thumb_pool.submit(work)

    def _prefetch(self, key: str):
        self.queue_meta(key, 1)

    def _deep_cover(self, key: str, e: Entry):
        if not self.covers.once("deep:" + key):
            return

        def work():
            try:
                self.files_for(e)
                url = e.cover or e.thumb
                if url and self.images.thumb(key, url):
                    self._push({"type": "meta_ready", "key": key, "has_cover": True, "cv": int(time.time())})
            except Exception as ex:
                log.debug("deep cover %s: %s", key, ex)
        self.pool.submit(work)

    def set_cover(self, key: str, src: str | None) -> dict:
        if not src:
            if not self.pick_file:
                return {"error": "Diálogo nativo indisponível — informe o caminho da imagem"}
            src = self.pick_file(str(Path.home() / "Pictures"), "image")
            if not src:
                return {"ok": False}
        r = self.covers.set_custom(key, src)
        if r.get("ok"):
            self.images.invalidate(key)
            self.images.invalidate("hero:" + key)
        return r

    def reset_cover(self, key: str) -> dict:
        self.covers.remove_custom(key)
        self.images.invalidate(key)
        return {"ok": True}

    META_WORKERS = 6

    def queue_meta(self, key: str, priority: int = 5):
        if not self.store.config.get("auto_metadata", True) or not key:
            return
        if self._quiet and priority > 0:
            self._mq_later.add(key)
            return
        with self._mq_cv:
            if key in self._mq_pending:
                if priority > 1:
                    return

            else:
                self._mq_pending.add(key)
                self._mq_total += 1
            self._mq_n += 1
            heapq.heappush(self._mq, (priority, self._mq_n, key))
            alive = [t for t in self._mq_workers if t.is_alive()]
            if len(alive) < min(self.META_WORKERS, len(self._mq)):
                t = threading.Thread(target=self._meta_worker, daemon=True, name="meta")
                alive.append(t)
                t.start()
            self._mq_workers = alive
            self._mq_cv.notify()

    def set_quiet(self, on: bool):
        if on == self._quiet:
            return
        self._quiet = on
        if torrent_mod.available() and torrent_mod.TorrentClient._instance:
            torrent_mod.TorrentClient._instance.quiet = on
            try:
                torrent_mod.TorrentClient._instance.apply_limits()
            except Exception as e:
                log.debug("quiet torrents: %s", e)
        if not on:
            later, self._mq_later = list(self._mq_later), set()
            for k in later:
                self.queue_meta(k, 9)
            with self._mq_cv:
                if self._mq and not any(t.is_alive() for t in self._mq_workers):
                    t = threading.Thread(target=self._meta_worker, daemon=True, name="meta")
                    self._mq_workers = [t]
                    t.start()
                self._mq_cv.notify_all()

    def _meta_worker(self):
        idle_since = None
        while True:
            with self._mq_cv:
                while not self._mq or self._quiet:
                    if not self._mq_pending and self._mq_total:
                        n, self._mq_total, self._mq_done = self._mq_total, 0, 0
                        self.act("")
                        self._push({"type": "meta_batch_done", "count": n})
                    if idle_since is None:
                        idle_since = time.time()
                    self._mq_cv.wait(timeout=20)
                    if not self._mq and time.time() - idle_since > 15:
                        return
                idle_since = None
                _, _, key = heapq.heappop(self._mq)
                if key not in self._mq_pending:
                    continue
                self._mq_pending.discard(key)
                done, total = self._mq_done, self._mq_total
            if total > 3:
                self.act(f"Baixando capas e informações ({min(done + 1, total)}/{total})…")
            try:
                if self.meta.get(key) is None:
                    self.fetch_metadata(key, False)
                if key.startswith(("local:", "rom:")) or self.store.is_installed(key):
                    self.warm_shots(key)
            except Exception as ex:
                log.debug("meta %s: %s", key, ex)
            with self._mq_cv:
                self._mq_done += 1

    def fetch_metadata(self, key: str, force: bool) -> dict:
        if not force:
            cached = self.meta.get(key)
            if cached is not None:
                return cached
        tag = "fetch:" + key
        if not self.covers.once(tag):

            for _ in range(160):
                time.sleep(0.25)
                if not self.covers.busy(tag):
                    break
            return self.meta.get(key) or {}
        try:
            return self._fetch_metadata(key, force)
        finally:
            self.covers.done(tag)

    def _fetch_metadata(self, key: str, force: bool) -> dict:
        e = self.entry(key)
        if e:
            title, year, system = e.title, e.year, e.system
        elif key.startswith("local:"):
            info = self.store.get(key)
            if not info:
                return {"error": "not found"}
            title, year, system = info.get("title", ""), "", info.get("system") or "pc"
        else:
            r = next((x for x in self.emu.scan_all() if x["key"] == key), None)
            if not r:
                return {"error": "not found"}
            title, year, system = r["title"], "", r["system"]
        had = self.meta.get(key) is not None
        hint = ""
        if e and e.kind == "pc" and not e.extra.get("steam_appid") and hasattr(self.repos.providers.get(e.repo), "post_info"):
            try:
                self.repos.providers[e.repo].post_info(e)
            except Exception:
                pass
        if e:
            hint = str(e.extra.get("steam_appid") or "")
        m = self.meta.fetch(key, title, year, system, force=force, steam_appid=hint)
        if force:
            self.images.invalidate(key)
            self.images.invalidate("hero:" + key)
        if (not had or force) and m:
            self._auto_rename(key, title, m)
            try:
                self.thumb_path(key)
            except Exception:
                pass
            self._push({"type": "meta_ready", "key": key, "has_cover": bool(m.get("cover_url") or m.get("grid") or m.get("wiki_image")), "cv": self._cv(key, m),
                        "genres": (m.get("genres") or [])[:3], "year": m.get("year", ""), "creator": m.get("developer", ""),
                        "found": bool([x for x in (m.get("source") or []) if x != "web"]), "title": title, "mine": key.startswith(("local:", "rom:")) or self.store.is_installed(key)})
        return m

    def _cv(self, key: str, m: dict | None) -> int:
        c = self.covers.custom_path(key)
        if c:
            try:
                return int(c.stat().st_mtime)
            except OSError:
                pass
        return int((m or {}).get("fetched_at") or 0)

    def job_payload(self, key: str):
        j = self.jobs.get(key)
        if not j:
            return None
        p: Progress = j["last"]
        return {"stage": p.stage, "fraction": p.fraction, "detail": p.detail, "kind": j.get("kind", "install"), "title": j.get("title", "")}

    def status_payload(self):
        with self._lock:
            evs, self._events = self._events, []
        return {"jobs": {k: self.job_payload(k) for k in list(self.jobs)}, "events": evs, "online": self._online if self._online is not None else True, "gamemode": self.gamemode.active,
                "loading": self.catalog_state["loading"], "activity": self._activity_payload(),
                "meta_pending": max(0, self._mq_total - self._mq_done) + self.covers.inflight("fetch:")}

    def _push(self, ev: dict):
        with self._lock:
            self._events.append(ev)

    def act(self, text: str = "", busy: bool | None = None):
        with self._act_lock:
            self.activity = {"text": text, "since": time.time() if text else 0.0, "busy": bool(busy) if busy is not None else bool(text)}

    def _activity_payload(self) -> dict:
        with self._act_lock:
            a = dict(self.activity)
        if a["busy"] and time.time() - a["since"] > 120 and not self.jobs and not self.catalog_state["loading"]:
            a = {"text": "", "since": 0.0, "busy": False}
        jobs = list(self.jobs.items())
        if jobs and not a["text"]:
            k, j = jobs[0]
            p = j["last"]
            a = {"text": f"{j.get('title', k)}: {p.detail or p.stage}", "since": time.time(), "busy": True, "fraction": p.fraction}
        a["jobs"] = len(jobs)
        a["sessions"] = len(self.sessions.active)
        return a

    def _run_job(self, key: str, title: str, kind: str, fn, retry: dict | None = None):
        if key in self.jobs:
            return {"error": "Já em andamento"}
        cancel = threading.Event()
        job = {"cancel": cancel, "last": Progress("download", 0, "Iniciando..."), "kind": kind, "title": title, "started": time.time(), "retry": retry}
        self.jobs[key] = job
        self._hist_put(key, title, kind, "running", retry=retry)

        def cb(p: Progress):
            job["last"] = p

        def work():
            try:
                result = fn(cb, cancel)
                self._hist_put(key, title, kind, "done", dir=(result or {}).get("dir"))
                if kind == "install" and installer_stats["speed"] > 0:
                    self.store.set_config(dl_speed=int(installer_stats["speed"]))
                self._push({"type": "done", "key": key, "title": title, "kind": kind, **(result or {})})
            except CancelledError:
                self._hist_put(key, title, kind, "paused" if job.get("pause") else "cancelled")
                self._push({"type": "cancelled", "key": key, "title": title, "kind": kind, "paused": bool(job.get("pause"))})
            except Exception as ex:
                log.exception("job %s", key)
                self._hist_put(key, title, kind, "error", message=str(ex))
                self._push({"type": "error", "key": key, "title": title, "kind": kind, "message": str(ex)})
            finally:
                self.jobs.pop(key, None)

        threading.Thread(target=work, daemon=True).start()
        return {"ok": True}

    def cancel(self, key: str, pause: bool = False):
        j = self.jobs.get(key)
        if j:
            j["pause"] = pause
            j["cancel"].set()
        return {"ok": True}

    _HIST = paths.DATA / "downloads.json"

    def _hist_load(self) -> list[dict]:
        if not hasattr(self, "_hist"):
            try:
                self._hist = json.loads(self._HIST.read_text("utf-8")) if self._HIST.exists() else []
            except Exception:
                self._hist = []

            for h in self._hist:
                if h.get("status") == "running":
                    h["status"] = "paused"
        return self._hist

    def _hist_save(self):
        try:
            self._HIST.parent.mkdir(parents=True, exist_ok=True)
            self._HIST.write_text(json.dumps(self._hist_load()[-200:], ensure_ascii=False), "utf-8")
        except Exception:
            pass

    def _hist_put(self, key: str, title: str, kind: str, status: str, **extra):
        with self._hist_lock:
            hist = self._hist_load()
            h = next((x for x in hist if x["key"] == key), None)
            if not h:
                h = {"key": key, "title": title, "kind": kind, "created": time.time()}
                hist.append(h)
            h.update(status=status, at=time.time(), **{k: v for k, v in extra.items() if v is not None})
            if status == "running":
                h.pop("message", None)
            self._hist_save()

    def queue_payload(self) -> dict:
        hist = [dict(h) for h in self._hist_load()]
        for h in hist:
            j = self.job_payload(h["key"])
            if j:
                h["job"] = j
                h["status"] = "running"
            g = self.store.get(h["key"]) or {}
            h["dir"] = h.get("dir") or g.get("dir") or ""
            h["installed"] = bool(g.get("exe") or g.get("dir"))
            h["can_retry"] = h["status"] in ("error", "cancelled", "paused") and bool(h.get("retry"))
        hist.sort(key=lambda h: (h["status"] != "running", -(h.get("at") or 0)))
        return {"items": hist, "active": len(self.jobs)}

    def queue_action(self, action: str, key: str | None = None) -> dict:
        if action == "pause":
            return self.cancel(key, pause=True)
        if action == "stop":
            self.cancel(key)

            h = next((x for x in self._hist_load() if x["key"] == key), None)
            if h:
                tmp = paths.DOWNLOADS / safe_folder_name(h.get("title") or "")
                threading.Timer(2.0, lambda: tmp.exists() and self._rmtree_force(str(tmp))).start()
            return {"ok": True}
        if action == "retry":
            h = next((x for x in self._hist_load() if x["key"] == key), None)
            r = (h or {}).get("retry")
            if not r:
                return {"error": "Esse item não sabe se refazer — baixe de novo pela Store"}
            m = getattr(self, r.get("m", ""), None)
            if not m:
                return {"error": "Ação de repetição desconhecida"}
            return m(*r.get("a", []))
        with self._hist_lock:
            hist = self._hist_load()
            if action == "remove":
                hist[:] = [x for x in hist if x["key"] != key]
            elif action == "clear":
                hist[:] = [x for x in hist if x["key"] in self.jobs]
            elif action == "clear_done":
                hist[:] = [x for x in hist if x["key"] in self.jobs or x.get("status") in ("paused", "error", "running")]
            elif action == "clear_all":
                for k in list(self.jobs):
                    self.cancel(k)
                hist[:] = []
            self._hist_save()
        return {"ok": True}

    def rom_dest(self, system: str) -> Path:
        d = (self.store.config.get("rom_dest") or {}).get(system) or ""
        return Path(d) if d else paths.EMU_GAMES / system

    def set_rom_dest(self, system: str, folder: str | None):
        rd = dict(self.store.config.get("rom_dest") or {})
        if folder and Path(folder).resolve() != (paths.EMU_GAMES / system).resolve():
            rd[system] = folder
            self.emu.add_rom_dir(system, folder)
        else:
            rd.pop(system, None)
        self.store.set_config(rom_dest=rd)
        return {"ok": True, "dest": str(self.rom_dest(system))}

    def _install_root(self, e, dest: str | None = None) -> Path:
        if e.kind == "rom" and e.system != "pc":
            if dest:
                return Path(dest)
            return self.rom_dest(e.system)
        if e.kind == "recomp":
            return paths.GAMES / "_recomp"
        return self.store.games_dir()

    def install_preview(self, key: str, file_names: list[str] | None, via_torrent: bool = False) -> dict:
        e = self.entry(key)
        if not e:
            return {"error": "Item não encontrado"}
        root = self._install_root(e)
        try:
            free = shutil.disk_usage(root if root.exists() else root.parent if root.parent.exists() else paths.ROOT).free
        except Exception:
            free = None
        need = 0
        if not via_torrent:
            try:
                files = self.files_for(e)
                if file_names:
                    files = [f for f in files if f.name in file_names or f.basename in file_names]
                need = sum(int(f.size or 0) for f in files)
            except Exception:
                need = 0
        need = need or int(e.size or 0)
        speed = installer_stats["speed"] or float(self.store.config.get("dl_speed") or 0)
        eta = (need / speed) if need and speed > 0 and not via_torrent else None
        out = {"title": e.title, "need": need, "free": free, "root": str(root), "fixed": e.kind == "recomp",
               "speed": speed, "eta": eta, "native": bool(self.pick_folder), "torrent": via_torrent}
        if e.kind == "rom" and e.system != "pc":
            dirs = [str(paths.EMU_GAMES / e.system)] + [str(Path(x)) for x in (self.store.config.get("rom_dirs") or {}).get(e.system, [])]
            out.update(rom=True, system=e.system, system_name=self.emu.presets["systems"].get(e.system, {}).get("name", e.system),
                       dirs=[d for i, d in enumerate(dirs) if d not in dirs[:i]], remembered=str(root) if (self.store.config.get("rom_dest") or {}).get(e.system) else "")
        return out

    def start_install(self, key: str, file_names: list[str] | None, via_torrent: bool = False, dest: str | None = None, remember: bool = False):
        e = self.entry(key)
        if not e:
            return {"error": "Item não encontrado"}
        if dest and not (e.kind == "rom" and e.system != "pc"):
            dest = None
        root = self._install_root(e, dest)
        try:
            root.mkdir(parents=True, exist_ok=True)
        except Exception as ex:
            return {"error": f"Não consegui usar a pasta {root}: {ex}"}
        if dest:
            if remember:
                self.set_rom_dest(e.system, dest)
            elif root.resolve() != (paths.EMU_GAMES / e.system).resolve():
                self.emu.add_rom_dir(e.system, str(root))
        try:
            free = shutil.disk_usage(root).free
        except Exception:
            free = None
        keep = bool(self.store.config.get("keep_archive"))

        files = self.files_for(e)
        if (e.magnet or e.torrent_url) and (via_torrent or not files):
            if not torrent_mod.available():

                src = e.magnet or e.torrent_url
                if self._needs_resolve(src):
                    try:
                        src = self.repos.providers[e.repo].resolve_torrent(e)
                    except Exception as ex:
                        return {"error": str(ex)}
                    if src.startswith("magnet:"):
                        self.open_url(src)
                    else:
                        self.open_path(src)
                else:
                    self.open_url(src)
                self.notify("info", f"{e.title}: magnet aberto no cliente de torrent",
                            "Quando terminar de baixar, use Adicionar → Jogo de Windows (ou arraste o arquivo para a Store) para instalar.", key=e.key)
                return {"ok": True, "external": True}

            def fn(cb, cancel):
                tc = torrent_mod.TorrentClient.get(self.store)
                tmp = paths.DOWNLOADS / safe_folder_name(e.title)
                src = e.magnet or e.torrent_url
                if self._needs_resolve(src):
                    cb(Progress("download", -1, "Pegando o link do torrent na fonte..."))
                    src = self.repos.providers[e.repo].resolve_torrent(e)
                got = tc.download(src, tmp, cb, cancel, self.repos.session)
                game_dir = root / safe_folder_name(e.title)
                allf = [p for p in (got.rglob("*") if got.is_dir() else [got]) if p.is_file()]
                arcs = [p for p in allf if re.search(r"\.(7z|zip|rar|001|chd|iso|cue|bin|z64|n64|v64|gba|sfc|nes|md)$", p.name, re.I)]
                if not allf:
                    raise RuntimeError("O torrent terminou sem arquivos (sem seeds ou cancelado pelo tracker)")
                if got.is_dir() and (any(p.suffix.lower() == ".exe" for p in allf) or len(arcs) < len(allf) // 2):

                    cb(Progress("extract", -1, "Movendo arquivos baixados..."))
                    game_dir.mkdir(parents=True, exist_ok=True)
                    for p in allf:
                        dst = game_dir / p.relative_to(got)
                        dst.parent.mkdir(parents=True, exist_ok=True)
                        shutil.move(str(p), str(dst))
                    exes = find_executables(game_dir, e.title)
                else:
                    exes = install_from_archives(arcs or allf, game_dir, cb, cancel, keep, e.title)
                if not keep:
                    shutil.rmtree(tmp, ignore_errors=True)
                return self._finish_install(e, game_dir, exes)
            return {**self._run_job(key, e.title, "install", fn, retry={"m": "start_install", "a": [key, file_names, True]}), "free": free, "need": e.size * 2.2}

        if not files:
            if e.extra.get("buy_only"):
                return {"error": "Esse jogo ainda está à venda — o site não distribui o arquivo. Use o botão Origem pra ver onde comprar."}
            return {"error": "Nenhum arquivo pra baixar neste item"}
        if file_names:
            chosen = [f for f in files if f.name in file_names] or files[:1]
        else:
            chosen = self._auto_pick(files)
        prov = self.repos.providers.get(e.repo)

        if prov and hasattr(prov, "browser_url"):
            try:
                url = prov.browser_url(e, chosen[0])
            except Exception as ex:
                return {"error": str(ex)}
            self.open_url(url)
            self.notify("info", f"{e.title}: download aberto no navegador",
                        "O arquivo vai pra pasta Downloads do Windows. Depois use Adicionar → Jogo de Windows (ou arraste o .zip para a Store) para instalar.", key=e.key)
            return {"ok": True, "browser": True, "url": url}
        need = sum(f.size for f in chosen) * 2.2
        if e.extra.get("mirrors"):

            url = chosen[0].url.split(":", 1)[1]
            r = self._hosted_job(e, url, root, keep, None, retry={"m": "start_install", "a": [key, [chosen[0].name], False]})
            if r.get("ok"):
                self.notify("info", f"{e.title}: download começou", f"Via {chosen[0].name} — acompanhe na Fila.", key=e.key)
            return {**r, "free": free, "need": need}
        from . import hosts
        if len(chosen) == 1 and hosts.known_host(chosen[0].url) and not re.search(r"\.(zip|7z|rar|exe|iso|bin|001|msi|apk)$", chosen[0].url.split("?")[0].split("#")[0], re.I):
            r = self._hosted_job(e, chosen[0].url, root, keep, None, retry={"m": "start_install", "a": [key, [chosen[0].name], False]})
            if r.get("ok"):
                self.notify("info", f"{e.title}: download começou", f"Via {hosts.known_host(chosen[0].url)} — acompanhe na Fila.", key=e.key)
            return {**r, "free": free, "need": need}
        resolver = getattr(prov, "final_url", None)

        def fn(cb, cancel):
            game_dir, exes = install_game(chosen, e.title, root, cb, cancel, keep, self.repos.session, resolver=resolver)
            return self._finish_install(e, game_dir, exes)
        return {**self._run_job(key, e.title, "install", fn, retry={"m": "start_install", "a": [key, file_names, False]}), "free": free, "need": need}

    @staticmethod
    def _auto_pick(files: list[FileRef]) -> list[FileRef]:
        parts = [f for f in files if re.search(r"\.\d{3}$", f.name)]
        if parts:
            return sorted(parts, key=lambda f: f.name)
        return files[:1]

    def _finish_install(self, e: Entry, game_dir: Path, exes: list[Path]) -> dict:
        if e.kind == "rom" and e.system != "pc":
            exts = set(self.emu.presets["systems"].get(e.system, {}).get("exts", []))
            roms = sorted([p for p in game_dir.rglob("*") if p.is_file() and p.suffix.lower() in exts], key=lambda p: -p.stat().st_size)
            roms = [r for r in roms if not (r.suffix.lower() == ".bin" and r.with_suffix(".cue").exists())] or roms
            if e.system == "dos" and not roms:

                cands = [p for p in game_dir.rglob("*") if p.is_file() and p.suffix.lower() in (".exe", ".com")
                         and not re.search(r"(^|[^a-z])(setup|install|inst|config|unins|readme|sound|snd|dos4gw|univbe|vesa)", p.stem.lower())]
                words = [w for w in re.findall(r"[a-z0-9]+", e.title.lower()) if len(w) > 2]
                cands.sort(key=lambda p: (-sum(w[:4] in p.stem.lower() for w in words), len(p.relative_to(game_dir).parts), -p.stat().st_size))
                roms = cands[:1]
            self.store.set_installed(e.key, dir=str(game_dir), exe=str(roms[0]) if roms else "", title=e.title, kind="rom", system=e.system)
            self.emu.invalidate_scan(e.system)
            if self.store.config.get("auto_metadata"):
                self.queue_meta(e.key)
            return {"exes": [], "dir": str(game_dir), "rom": True}
        preferred = e.extra.get("exe")
        if preferred:
            hit = next((x for x in exes if x.name.lower() == preferred.lower()), None)
            if hit:
                exes = [hit] + [x for x in exes if x != hit]

        if e.kind == "pc" and is_repack(game_dir):
            setup = find_setup(game_dir)
            self.store.set_installed(e.key, dir=str(game_dir), exe="", title=e.title, kind=e.kind, version=e.extra.get("version", ""),
                                     repack=str(setup), repack_state="pending")
            self.notify("repack", f"{e.title}: repack baixado", "Abra o instalador (setup) pelo launcher; quando ele terminar, o jogo entra na biblioteca.", key=e.key)
            return {"exes": [], "dir": str(game_dir), "repack": str(setup)}
        if e.kind == "pc" and not exes:
            dp = disc.plan(game_dir)
            if dp:
                self.store.set_installed(e.key, dir=str(game_dir), exe="", title=e.title, kind=e.kind, version=e.extra.get("version", ""),
                                         repack=dp["image"], repack_state="pending", disc=dp)
                self.notify("repack", f"{e.title}: disco baixado", "É uma imagem de disco (ISO). Pelo launcher o disco é montado, o instalador abre e, quando ele terminar, o jogo entra na biblioteca.", key=e.key)
                return {"exes": [], "dir": str(game_dir), "repack": dp["image"], "disc": dp}
        self.store.set_installed(e.key, dir=str(game_dir), exe=str(exes[0]) if exes else "", title=e.title,
                                 kind=e.kind, version=e.extra.get("version", ""))
        if self.store.config.get("auto_metadata"):
            self.queue_meta(e.key)

        offer = bool(exes) and e.kind == "pc" and self.store.config.get("shortcut_ask", True) and os.name == "nt"
        return {"exes": [str(x) for x in exes[:8]], "dir": str(game_dir), "shortcut_offer": offer}

    def desktop_shortcut(self, key: str) -> dict:
        info = self.store.get(key) or {}
        exe = Path(info.get("exe") or "")
        if not exe.exists():
            return {"error": "O jogo não tem executável definido"}
        if os.name != "nt":
            return {"error": "Só no Windows"}
        title = re.sub(r'[<>:"/\\|?*]+', "", info.get("title") or exe.stem).strip() or exe.stem
        desk = Path(os.path.expandvars(r"%USERPROFILE%")) / "Desktop"
        try:
            import ctypes
            buf = ctypes.create_unicode_buffer(260)
            if ctypes.windll.shell32.SHGetFolderPathW(None, 0x0010, None, 0, buf) == 0 and buf.value:
                desk = Path(buf.value)
        except Exception:
            pass
        lnk = desk / f"{title}.lnk"
        args = self._game_args(key)
        import subprocess
        ps = (f"$s=(New-Object -ComObject WScript.Shell).CreateShortcut({_ps(str(lnk))});$s.TargetPath={_ps(str(exe))};"
              f"$s.Arguments={_ps(args)};$s.WorkingDirectory={_ps(str(exe.parent))};$s.IconLocation={_ps(str(exe) + ',0')};$s.Description={_ps('Ludrix - ' + title)};$s.Save()")
        try:
            r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps],
                               capture_output=True, text=True, timeout=30, creationflags=0x08000000)
            if r.returncode != 0 or not lnk.exists():
                return {"error": (r.stderr or "não consegui criar o .lnk").strip()[:200]}
        except Exception as ex:
            return {"error": str(ex)}
        return {"ok": True, "path": str(lnk)}

    def clean_downloads(self) -> dict:
        d = paths.DOWNLOADS
        if not d.exists():
            return {"ok": True, "freed": 0, "freed_h": "0 B", "skipped": 0}
        busy = {safe_folder_name(j.get("title") or "") for j in self.jobs.values()}
        any_job = bool(self.jobs)
        freed, skipped = 0, 0
        for child in list(d.iterdir()):

            if child.name in busy or child.name.startswith(".") or (any_job and child.name.startswith(("emu_", "tool_", "redist"))):
                skipped += 1
                continue
            try:
                size = sum(f.stat().st_size for f in child.rglob("*") if f.is_file()) if child.is_dir() else child.stat().st_size
                if child.is_dir():
                    ok = self._rmtree_force(str(child))
                else:
                    child.unlink()
                    ok = True
                if ok:
                    freed += size
                else:
                    skipped += 1
            except Exception:
                skipped += 1
        return {"ok": True, "freed": freed, "freed_h": human_size(freed), "skipped": skipped}

    def play(self, key: str, after: str | None = None, emulator: str | None = None, optimize: bool | None = None, force: bool = False):
        if key in self.sessions.active:
            return {"error": "Este jogo já está aberto", "running": True, "key": key}
        self.sessions.next_after = after if after in ("none", "minimize", "close") else None
        if optimize is None:
            optimize = bool(self.store.config.get("game_mode_auto"))
        self.sessions.next_optimize = bool(optimize)
        if key.startswith("rom:"):
            r = next((x for x in self.emu.scan_all() if x["key"] == key), None)
            kept = self.store.get(key) or {}
            if not r and not (kept.get("exe") and kept.get("system") and Path(kept["exe"]).exists()):
                return {"error": "ROM não encontrada", "missing": "rom", "path": kept.get("exe", ""), "key": key}
            if r:
                if not kept:
                    self.store.set_installed(key, dir=str(Path(r["path"]).parent), exe=r["path"], title=r["title"], kind="rom")
                emulator = self._pick_emulator(key, r["system"], emulator)
                if isinstance(emulator, dict):
                    return emulator
                lr = self.emu.launch_rom(r["path"], r["system"], emulator)
                if lr.get("error"):
                    return lr
                res = self.sessions.launch(key, lr["cmd"] + self._split_args(self._game_args(key)), lr["cwd"], r["title"])
                res["hint"] = lr.get("hint", "")
                return res
        info = self.store.get(key)
        if not info:
            e = self.entry(key)
            lp = (e.extra.get("local_path") if e else None)
            if lp and Path(lp).exists():

                self.store.set_installed(key, dir=str(Path(lp).parent), exe=lp, title=e.title, kind=e.kind, system=e.system)
                info = self.store.get(key)
                if self.store.config.get("auto_metadata"):
                    self.queue_meta(key)
            else:
                return {"error": "Não instalado"}
        if info.get("kind") == "rom" and info.get("system"):
            if info.get("exe") and not Path(info["exe"]).exists():
                return {"error": "ROM não encontrada", "missing": "rom", "path": info["exe"], "key": key, "drive": self._drive_missing(info["exe"])}
            emulator = self._pick_emulator(key, info["system"], emulator)
            if isinstance(emulator, dict):
                return emulator
            lr = self.emu.launch_rom(info["exe"], info["system"], emulator)
            if lr.get("error"):
                return lr
            res = self.sessions.launch(key, lr["cmd"] + self._split_args(self._game_args(key)), lr["cwd"], info.get("title", key))
            res["hint"] = lr.get("hint", "")
            return res
        if _URI_RE.match(str(info.get("exe", ""))):
            uri = str(info["exe"])
            try:
                if os.name == "nt":
                    os.startfile(uri)
                else:
                    webbrowser.open(uri)
            except OSError as e:
                return {"error": f"{uri_name(uri)} não respondeu: {e}", "uri": uri}
            self.store.update(key, last_played=time.time())
            return {"ok": True, "tracked": False, "hint": f"Aberto pelo {uri_name(uri)} (o tempo de jogo não é contado)."}
        if info.get("mc"):
            ed = info["mc"]
            if ed == "bedrock":
                if not minecraft.bedrock_installed():
                    return {"error": "O Minecraft Bedrock não está instalado neste PC.", "mc_missing": "bedrock", "store": minecraft.BEDROCK_STORE}
                os.startfile("shell:AppsFolder\\" + minecraft.BEDROCK_AUMID)
                self.store.update(key, last_played=time.time())
                return {"ok": True, "tracked": False, "hint": "Aberto pela Microsoft Store (o tempo de jogo não é contado)."}
            exe = str(info.get("exe") or "")
            lid = info.get("mc_launcher") or ""
            spec = self.mc.launch_spec(exe) if exe else {"error": "sem launcher"}
            if spec.get("error") or (spec.get("cmd") and not (Path(spec["cmd"][-1]).exists() or spec["cmd"][0] == "flatpak")):
                it, fresh = self.mced.java_launcher(lid)
                if not fresh:
                    return {"error": "Nenhum launcher de Minecraft encontrado. O Java Edition precisa de um launcher para abrir.",
                            "need_mc_launcher": True, "recommend": self.mced.recommend(), "winget": bool(optionals.winget_path()), "store": minecraft.JAVA_STORE}
                if fresh != exe or (it and it["id"] != lid):
                    self.store.update(key, exe=fresh, mc_launcher=it["id"])
                spec = self.mc.launch_spec(fresh)
            if spec.get("error"):
                return {"error": spec["error"]}
            if spec.get("shell"):
                if os.name == "nt":
                    os.startfile(spec["shell"])
                self.store.update(key, last_played=time.time())
                return {"ok": True, "tracked": False, "hint": "Aberto pela Microsoft Store (o tempo de jogo não é contado)."}
            res = self.sessions.launch(key, spec["cmd"] + self._split_args(self._game_args(key)), spec["cwd"], info.get("title", "Minecraft"))
            return res
        exe = Path(info.get("exe") or "")
        if not exe.exists():
            exes = find_executables(Path(info.get("dir", "")), info.get("title", "")) if info.get("dir") else []
            if not exes:
                return {"error": "Executável não encontrado", "missing": "exe", "path": str(exe) if str(exe) != "." else info.get("dir", ""), "key": key, "drive": self._drive_missing(str(exe) if str(exe) != "." else info.get("dir", ""))}
            exe = exes[0]
            self.store.update(key, exe=str(exe))
        cmd = [str(exe)] + self._split_args(self._game_args(key))
        cwd = Path(info["workdir"]) if info.get("workdir") and Path(info["workdir"]).is_dir() else exe.parent
        hint = ""
        if os.name != "nt":
            from . import compat, winengine
            if compat.is_windows_binary(exe):
                cfg = self.store.config
                if not force and not winengine.ready(cfg) and (cfg.get("win_backend") or "auto") in ("auto", "umu"):
                    return {"need_prepare": True, "key": key, "title": info.get("title", exe.stem), "needs": winengine.needs(cfg), "mode": winengine.mode(cfg)}
                game = dict(info)
                game["key"] = key
                if not winengine.prefix_info(winengine.prefix_dir(cfg, game))["exists"]:
                    hint = "Primeira abertura: o Proton prepara o prefixo antes do jogo aparecer (pode levar um minuto)."
        res = self.sessions.launch(key, cmd, cwd, info.get("title", exe.stem))
        if hint and res.get("ok"):
            res["hint"] = hint
        return res

    def _pick_emulator(self, key: str, sid: str, emulator: str | None):
        if emulator:
            return emulator
        remembered = (self.store.config.get("game_emulator") or {}).get(key)
        opts = self.emu.installed_options(sid)
        ids = {o["id"] for o in opts}
        if remembered in ids:
            return remembered
        if len(opts) > 1 and not self.store.config.get("emu_no_ask"):
            return {"choose_emulator": opts, "system": sid, "default": self.emu.emulator_for(sid), "key": key}
        return None

    def set_game_emulator(self, key: str, emulator: str | None) -> dict:
        ge = dict(self.store.config.get("game_emulator") or {})
        if emulator:
            ge[key] = emulator
        else:
            ge.pop(key, None)
        self.store.set_config(game_emulator=ge)
        return {"ok": True}

    def _game_args(self, key: str) -> str:
        return str((self.store.config.get("game_args") or {}).get(key) or "")

    @staticmethod
    def _split_args(a: str) -> list[str]:
        if not a.strip():
            return []
        try:
            return shlex.split(a, posix=False) if os.name == "nt" else shlex.split(a)
        except ValueError:
            return a.split()

    def set_shortcut(self, key: str, exe: str | None = None, args: str | None = None) -> dict:
        info = self.store.get(key)
        if info is None and not key.startswith("rom:"):
            return {"error": "Não instalado"}
        if exe is not None and info is not None:
            exe = exe.strip().strip('"')
            if exe and not Path(exe).exists() and "://" not in exe:
                return {"error": "Esse executável não existe"}
            if exe:
                self.store.update(key, exe=exe, dir=str(Path(exe).parent) if "://" not in exe else info.get("dir", ""))
        if args is not None:
            ga = dict(self.store.config.get("game_args") or {})
            if args.strip():
                ga[key] = args.strip()
            else:
                ga.pop(key, None)
            self.store.set_config(game_args=ga)
        return {"ok": True, "exe": (self.store.get(key) or {}).get("exe", ""), "args": self._game_args(key)}

    def install_from_file(self, archive: str | None, title: str | None = None, system: str = "") -> dict:
        if not archive:
            if not self.pick_file:
                return {"error": "Diálogo nativo indisponível no modo navegador — informe o caminho do arquivo"}
            archive = self.pick_file(str(Path.home() / "Downloads"), "archive")
            if not archive:
                return {"ok": False}
        src = Path(archive)
        if not src.is_file():
            return {"error": "Arquivo não encontrado"}
        title = normalize_title(title or "") or title_from_path(src)
        if not title:
            title = src.stem
        if system and system != "pc":
            root = paths.EMU_GAMES / system
            kind = "rom"
        else:
            root, kind, system = self.store.games_dir(), "pc", "pc"
        e = Entry(key="local:" + re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-"), repo="local", id=title, title=title, kind=kind, system=system)

        def fn(cb, cancel):
            game_dir = root / safe_folder_name(title)

            exes = install_from_archives([src], game_dir, cb, cancel, True, title)
            return self._finish_install(e, game_dir, exes)
        r = self._run_job(e.key, title, "install", fn)
        return {**r, "key": e.key, "title": title}

    def add_local_game(self, exe_path: str | None, title: str | None = None) -> dict:
        if not exe_path:
            if not self.pick_file:
                return {"error": "Diálogo nativo indisponível no modo navegador — informe o caminho do .exe"}
            exe_path = self.pick_file("")
            if not exe_path:
                return {"ok": False}
        exe = Path(exe_path)
        if not exe.exists():
            return {"error": "Arquivo não encontrado"}
        title = normalize_title(title or "") or self.local_guess(str(exe))["guess"]
        key = "local:" + re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
        if self.store.get(key):
            key += "-" + str(int(time.time()))[-4:]

        target = self._shortcut_target(exe)
        run, folder = str(exe), str(exe.parent)
        if target and "://" in target:
            run, folder = target, ""
        elif target and Path(target).exists():
            run, folder = target, str(Path(target).parent)
        self.store.set_installed(key, dir=folder, exe=run, title=title, kind="local")
        if self.store.config.get("auto_metadata"):
            self.queue_meta(key)
        return {"ok": True, "key": key, "title": title}

    def rom_preview(self, path: str | None) -> dict:
        if not path:
            if not self.pick_file:
                return {"native": False}
            path = self.pick_file("", "rom")
            if not path:
                return {"cancel": True}
        p = Path(path)
        if not p.exists():
            return {"error": "Arquivo não encontrado"}
        sid = self.emu.guess_system_for_file(path)
        from .emulation import ROM_TITLE_RE
        title = ROM_TITLE_RE.sub("", p.stem).strip() or p.stem
        exts = set(self.emu.presets["systems"].get(sid, {}).get("exts", [])) if sid else set()
        try:
            siblings = sum(1 for x in p.parent.iterdir() if x.is_file() and x != p and x.suffix.lower() in exts) if exts else 0
        except OSError:
            siblings = 0
        try:
            size = p.stat().st_size
        except OSError:
            size = 0
        known = any(x.get("path") == str(p) for x in (self.store.config.get("rom_files") or []))
        return {"native": True, "path": str(p), "name": p.name, "size": size, "system": sid, "title": title, "siblings": siblings,
                "folder": str(p.parent), "known": known,
                "emulators": {s: [{"id": o["id"], "title": o["title"]} for o in self.emu.installed_options(s)] for s in self.emu.presets["systems"] if s != "pc"}}

    def add_rom_file(self, path: str | None, system: str | None, title: str | None = None, emulator: str | None = None, add_folder: bool = False) -> dict:
        if not path:
            if not self.pick_file:
                return {"error": "Diálogo nativo indisponível no modo navegador — informe o caminho"}
            path = self.pick_file("", "rom")
            if not path:
                return {"ok": False}
        sid = system or self.emu.guess_system_for_file(path)
        if not sid:
            return {"error": "Não reconheci o formato. Escolha o console manualmente.", "need_system": True, "path": path}
        r = self.emu.add_rom_file(path, sid)
        self.store.set_installed(r["key"], dir=str(Path(path).parent), exe=path, title=r["title"], kind="rom")
        if title and title.strip() and title.strip() != r["title"]:
            self._apply_title(r["key"], title.strip(), locked=True)
            r["title"] = title.strip()
        if emulator:
            self.set_game_emulator(r["key"], emulator)
        if add_folder:
            self.emu.add_rom_dir(sid, str(Path(path).parent))
        if self.store.config.get("auto_metadata"):
            self.queue_meta(r["key"])
        return {**r, "system": sid}

    @staticmethod
    def _guess_title(exe: Path) -> str:
        t = title_from_path(exe)
        if exe.suffix.lower() == ".lnk" and (len(t) < 3 or re.match(r"^(play|jogar|start|launch|game|run)$", t, re.I)):
            try:
                target = importers._lnk_target(exe)
                if target:
                    t = title_from_path(Path(target)) or t
            except Exception:
                pass
        return t or exe.stem

    def edit_info(self, key: str) -> dict:
        d = self.game_payload(key)
        if not d:
            return {"error": "not found"}
        m = d.get("meta") or {}
        info = self.store.get(key) or {}
        user = m.get("user") or {}
        is_rom = key.startswith("rom:") or d.get("kind") == "rom" or info.get("kind") == "rom"
        exe = d.get("exe") or ""
        sysid = d.get("system") or info.get("system") or "pc"
        others = []
        for g in self.catalog_payload().get("games", []):
            if g["key"] != key and g.get("has_meta") and (g.get("installed") or g["key"].startswith(("local:", "rom:"))):
                others.append({"key": g["key"], "title": g["title"], "system": g.get("system") or "pc"})
        others.sort(key=lambda x: x["title"].lower())
        return {
            "key": key, "title": d.get("title", ""), "title_orig": d.get("title_orig", ""), "title_locked": bool(d.get("title_locked")),
            "kind": "rom" if is_rom else d.get("kind") or "pc", "system": sysid, "systems": {k: v["name"] for k, v in self.emu.presets["systems"].items()},
            "can_rename": key.startswith(("local:", "rom:")), "can_move": bool(info) and not is_rom and "://" not in exe,
            "developer": m.get("developer", ""), "publisher": m.get("publisher", ""), "year": str(m.get("year") or d.get("year") or ""),
            "genres": list(m.get("genres") or d.get("genres") or []), "summary": m.get("summary") or d.get("description") or "",
            "series": m.get("series", ""), "modes": m.get("modes", ""), "notes": m.get("notes", ""), "links": list(m.get("links") or []),
            "auto_links": [x for x in (
                {"name": "Steam", "url": f"https://store.steampowered.com/app/{m['steam_appid']}"} if m.get("steam_appid") else None,
                {"name": "GOG", "url": m.get("gog_url")} if m.get("gog_url") else None,
                {"name": "Wikipedia", "url": m.get("wiki_url")} if m.get("wiki_url") else None,
                {"name": "Origem", "url": d.get("page_url")} if d.get("page_url") else None) if x],
            "user": sorted(user.keys()), "source": m.get("source") or [], "copied_from": m.get("copied_from", ""),
            "cover_src": d.get("cover_src", ""), "custom_cover": bool(d.get("custom_cover")), "cover_url": m.get("cover_url", ""),
            "hero_url": m.get("hero_url", ""), "background_file": m.get("background_file", ""), "cv": self._cv(key, m),
            "installed": bool(d.get("installed")), "dir": d.get("dir", ""), "exe": exe, "args": d.get("args", ""),
            "workdir": info.get("workdir", ""),
            "emu": d.get("emu"), "emulator": (self.store.config.get("game_emulator") or {}).get(key, ""),
            "fav": key in self._favs, "playtime": d.get("playtime", 0), "playtime_h": d.get("playtime_h", ""), "last_played": d.get("last_played", 0),
            "added_at": info.get("installed_at", 0), "version": d.get("version", ""), "repo": d.get("repo", ""), "playtime": info.get("playtime", 0), "play_count": info.get("play_count", 0),
            "others": others[:400], "native": bool(self.pick_file),
            "win": self._edit_win(key, info, exe, is_rom),
            "sources": [x for x in (
                {"id": "steam", "name": "Steam"}, {"id": "gog", "name": "GOG"}, {"id": "wikipedia", "name": "Wikipedia"},
                {"id": "steamgriddb", "name": "SteamGridDB" + ("" if (self.store.config.get("sgdb_key") or "").strip() else " (precisa de chave)")},
                {"id": "libretro", "name": "Boxart de console (libretro)"} if sysid != "pc" else None,
                {"id": "web", "name": "Imagens da web (Google, Bing…)"}) if x],
        }

    def _edit_win(self, key: str, info: dict, exe: str, is_rom: bool) -> dict | None:
        if os.name == "nt" or is_rom or not exe or "://" in exe:
            return None
        from . import compat, winengine
        if not compat.is_windows_binary(Path(exe)):
            return None
        game = dict(info)
        game["key"] = key
        return {"settings": dict(info.get("win") or {}), **winengine.game_summary(self.store.config, game)}

    def edit_web_covers(self, key: str, title: str, kind: str = "cover") -> dict:
        d = self.game_payload(key) or {}
        try:
            if kind == "hero":
                hits = self.meta.web.search_wide(title or d.get("title", ""), d.get("system") or "pc", limit=24)
            else:
                hits = self.meta.web.search(title or d.get("title", ""), d.get("system") or "pc", limit=24)
        except Exception as e:
            return {"error": str(e)}
        if not hits:
            return {"error": "Nenhuma imagem parecida com esse nome — tente um nome mais simples ou em inglês"}
        return {"hits": hits}

    def edit_save(self, key: str, data: dict) -> dict:
        info = self.store.get(key)
        d = self.game_payload(key)
        if not d:
            return {"error": "not found"}
        sysid = data.get("system") or d.get("system") or "pc"
        changed_title = False

        title = (data.get("title") or "").strip()
        if title and title != d.get("title"):
            self._apply_title(key, title, locked=True)
            changed_title = True
        if data.get("unlock_title") and (info is not None or key.startswith("rom:")):
            if info is not None:
                self.store.update(key, title_locked=False)
            ov = self._title_overrides()
            if key in ov:
                ov[key]["locked"] = False
                self.store.set_config(title_overrides=ov)

        if info is not None and data.get("system") and data["system"] != info.get("system", "pc") and info.get("kind") in ("local", "rom"):
            self.store.update(key, system=data["system"])

        fields = {}
        for k in ("developer", "publisher", "year", "summary", "series", "modes", "notes"):
            if k in data:
                fields[k] = str(data[k] or "").strip()
        if "genres" in data:
            g = data["genres"]
            if isinstance(g, str):
                g = [x.strip() for x in re.split(r"[,;/]", g) if x.strip()]
            fields["genres"] = list(g or [])[:8]
        if "links" in data:
            fields["links"] = [{"name": str(l.get("name") or "").strip()[:40], "url": str(l.get("url") or "").strip()} for l in (data["links"] or []) if str(l.get("url") or "").strip()]
        prev_meta = self.meta.get(key) or {}
        if "cover_url" in data:
            fields["cover_url"] = str(data["cover_url"] or "").strip()
            fields["cover_src"] = "manual" if fields["cover_url"] else ""
            if fields["cover_url"] and (fields["cover_url"] != (prev_meta.get("user") or {}).get("cover_url") or not self.covers.custom_path(key)):
                r = self.covers.fetch_custom(key, fields["cover_url"], "cover", str(data.get("cover_page") or ""))
                if r.get("error"):
                    return {"error": r["error"]}
                self.images.invalidate(key)
        if "hero_url" in data:
            fields["hero_url"] = str(data["hero_url"] or "").strip()
            if fields["hero_url"] and fields["hero_url"] != (prev_meta.get("user") or {}).get("hero_url"):
                r = self.covers.fetch_custom(key, fields["hero_url"], "hero", str(data.get("hero_page") or ""))
                if r.get("error"):
                    return {"error": r["error"]}
                fields["background_file"] = r["path"]
                self.images.invalidate("hero:" + key)
        if "background_file" in data and "background_file" not in fields:
            fields["background_file"] = str(data["background_file"] or "").strip()
        if fields:
            before = self.meta.get(key) or {}
            m = self.meta.set_user(key, fields, sysid)
            if before.get("cover_url") != m.get("cover_url") or before.get("hero_url") != m.get("hero_url") or before.get("background_file") != m.get("background_file"):
                self.images.invalidate(key)
                self.images.invalidate("hero:" + key)

        if info is not None:
            patch = {}
            if "exe" in data and not key.startswith("rom:") and info.get("kind") != "rom":
                exe = str(data["exe"] or "").strip().strip('"')
                if exe and exe != info.get("exe"):
                    if "://" not in exe and not Path(exe).exists():
                        return {"error": "Esse executável não existe"}
                    patch["exe"] = exe
                    if "://" not in exe and not data.get("dir"):
                        patch["dir"] = str(Path(exe).parent)
            if "dir" in data:
                folder = str(data["dir"] or "").strip().strip('"')
                if folder and folder != info.get("dir"):
                    if not Path(folder).is_dir():
                        return {"error": "Essa pasta não existe"}
                    patch["dir"] = folder
            if "playtime_hours" in data and str(data["playtime_hours"]).strip() != "":
                try:
                    hrs = max(0.0, float(str(data["playtime_hours"]).replace(",", ".")))
                    if abs(hrs * 3600 - float(info.get("playtime") or 0)) >= 60:
                        patch["playtime"] = hrs * 3600
                except ValueError:
                    pass
            if "play_count" in data and str(data["play_count"]).strip() != "":
                try:
                    pc = max(0, int(float(str(data["play_count"]))))
                    if pc != int(info.get("play_count") or 0):
                        patch["play_count"] = pc
                except ValueError:
                    pass
            if "workdir" in data:
                wd = str(data["workdir"] or "").strip().strip('"')
                if wd and not Path(wd).is_dir():
                    return {"error": "A pasta de trabalho não existe"}
                patch["workdir"] = wd
            if "version" in data:
                patch["version"] = str(data["version"] or "").strip()
            if patch:
                self.store.update(key, **patch)
        if "args" in data:
            self.set_shortcut(key, None, str(data["args"] or ""))
        if isinstance(data.get("win"), dict) and info and os.name != "nt":
            from . import winengine
            self.store.update(key, win=winengine.sanitize_game_win(data["win"]))
        if "emulator" in data and (key.startswith("rom:") or (info or {}).get("kind") == "rom"):
            self.set_game_emulator(key, data["emulator"] or None)
        if "fav" in data and bool(data["fav"]) != (key in self._favs):
            self.toggle_favorite(key)
        self._slim_cache.pop(key, None)
        m = self.meta.get(key) or {}
        self._push({"type": "meta_ready", "key": key, "has_cover": bool(m.get("cover_url")), "cv": self._cv(key, m),
                    "genres": (m.get("genres") or [])[:3], "year": m.get("year", ""), "creator": m.get("developer", ""), "found": True, "mine": True, "title": ""})
        if changed_title:
            self._push({"type": "renamed", "key": key, "title": title, "old": d.get("title", "")})
        if changed_title and data.get("refetch"):
            self.meta.clear(key)
            self.images.invalidate(key)
            self.images.invalidate("hero:" + key)
            self.pool.submit(self.fetch_metadata, key, True)
        return {"ok": True, "title": title or d.get("title")}

    def edit_probe(self, key: str, source: str, title: str) -> dict:
        d = self.game_payload(key) or {}
        try:
            return self.meta.probe(source, title or d.get("title", ""), d.get("system") or "pc", str(d.get("year") or ""))
        except Exception as e:
            return {"error": str(e)}

    def edit_copy(self, key: str, src_key: str) -> dict:
        d = self.game_payload(key) or {}
        m = self.meta.copy_from(key, src_key, d.get("system") or "pc")
        if not m:
            return {"error": "O jogo de origem não tem metadados"}
        self.images.invalidate(key)
        self.images.invalidate("hero:" + key)
        c = self.covers.custom_path(src_key)
        if c and not self.covers.custom_path(key):
            self.covers.set_custom(key, str(c), fast=True)
        self._slim_cache.pop(key, None)
        self._push({"type": "meta_ready", "key": key, "has_cover": bool(m.get("cover_url")), "cv": self._cv(key, m),
                    "genres": (m.get("genres") or [])[:3], "year": m.get("year", ""), "creator": m.get("developer", ""), "found": True, "mine": True, "title": ""})
        return {"ok": True}

    def edit_reset(self, key: str) -> dict:
        self.meta.clear(key)
        self.images.invalidate(key)
        self.images.invalidate("hero:" + key)
        self._slim_cache.pop(key, None)
        if self.store.config.get("auto_metadata", True):
            self.pool.submit(self.fetch_metadata, key, True)
        return {"ok": True}

    def pick_path(self, kind: str, initial: str = "") -> dict:
        if kind == "folder":
            if not self.pick_folder:
                return {"native": False}
            return {"native": True, "path": self.pick_folder(initial or "")}
        if not self.pick_file:
            return {"native": False}
        return {"native": True, "path": self.pick_file(initial or "", kind)}

    def _title_overrides(self) -> dict:
        return dict(self.store.config.get("title_overrides") or {})

    def _apply_title(self, key: str, title: str, locked: bool):
        title = title.strip()
        info = self.store.get(key)
        if info is not None:
            self.store.update(key, title=title, title_locked=locked, title_orig=info.get("title_orig") or info.get("title", ""))
        if key.startswith("rom:") or info is None:
            ov = self._title_overrides()
            ov[key] = {"title": title, "locked": locked}
            self.store.set_config(title_overrides=ov)
            self.emu.invalidate_scan()

    def _title_locked(self, key: str) -> bool:
        info = self.store.get(key) or {}
        if info.get("title_locked"):
            return True
        return bool((self._title_overrides().get(key) or {}).get("locked"))

    def _auto_rename(self, key: str, current: str, m: dict) -> str | None:
        if not self.store.config.get("auto_rename", True) or self._title_locked(key):
            return None
        new = (m or {}).get("canonical_title") or ""
        if not new or new == current or not (m or {}).get("canonical_confident"):
            return None
        if key.startswith(("local:", "rom:")):
            self._apply_title(key, new, locked=False)
            self._push({"type": "renamed", "key": key, "title": new, "old": current})
            return new
        return None

    def rename_game(self, key: str, title: str):
        title = (title or "").strip()
        if not title:
            return {"error": "Nome vazio"}
        if self.store.get(key) is None and not key.startswith("rom:"):
            return {"error": "not found"}
        self._apply_title(key, title, locked=True)
        self.meta.clear(key)
        self.images.invalidate(key)
        self.images.invalidate("hero:" + key)
        if self.store.config.get("auto_metadata", True):
            self.pool.submit(self.fetch_metadata, key, True)
        return {"ok": True, "title": title}

    def refetch_all_metadata(self) -> dict:
        if not self.covers.once("refetch:all"):
            return {"ok": False, "error": "Já está atualizando."}

        def work():
            keys = list(self.store.library)
            try:
                keys += [r["key"] for r in self.emu.scan_all()]
            except Exception:
                pass
            keys = list(dict.fromkeys(keys))
            n = 0
            try:
                for i, k in enumerate(keys):
                    try:
                        self.act(f"Atualizando metadados ({i + 1}/{len(keys)})…", True)
                        self.fetch_metadata(k, True)
                        n += 1
                        time.sleep(0.3)
                    except Exception as ex:
                        log.debug("refetch %s: %s", k, ex)
            finally:
                self.act("")
                self.covers.done("refetch:all")
                self.notify("info", "Metadados atualizados", (f"{n} jogos revisados" if n != 1 else "1 jogo revisado") + " (capas, nomes e informações).")
        self.pool.submit(work)
        return {"ok": True, "count": len(self.store.library)}

    def _path_allowed(self, p: Path) -> bool:
        try:
            r = p.resolve()
        except Exception:
            return False
        roots = [paths.ROOT, self.store.games_dir() or paths.GAMES, Path.home() / "Downloads", Path.home() / "Pictures"]
        for v in (self.store.config.get("rom_dirs") or {}).values():
            roots += [Path(x) for x in (v if isinstance(v, list) else [v]) if x]
        for info in list(self.store.library.values()):
            d = info.get("dir") or (Path(info["exe"]).parent if info.get("exe") else None)
            if d:
                roots.append(Path(d))
        for b in roots:
            try:
                b = Path(b).resolve()
            except Exception:
                continue
            if r == b or b in r.parents:
                return True
        return False

    def open_path(self, p: str):
        import os, subprocess, sys
        if not p or not Path(p).exists():
            return {"error": "Pasta não existe"}
        if not self._path_allowed(Path(p)):
            return {"error": "Essa pasta não é do Ludrix"}
        if os.name == "nt":
            os.startfile(p)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", p])
        else:
            subprocess.Popen(["xdg-open", p])
        return {"ok": True}

    def list_exes(self, key: str):
        info = self.store.get(key)
        if not info:
            return []
        root = Path(info["dir"])
        return [str(p.relative_to(root)) for p in find_executables(root, info.get("title", ""))[:40]]

    def set_exe(self, key: str, rel: str | None):
        info = self.store.get(key)
        if not info:
            return {"error": "Não instalado"}
        if rel is None:
            if not self.pick_file:
                return {"error": "Diálogo nativo indisponível no modo navegador"}
            chosen = self.pick_file(info["dir"])
            if not chosen:
                return {"ok": False}
            self.store.update(key, exe=chosen)
        else:
            self.store.update(key, exe=str(Path(info["dir"]) / rel))
        return {"ok": True, "exe": self.store.get(key)["exe"]}

    def uninstall(self, key: str, force: bool = True):
        if key in self.sessions.active:
            try:
                self.sessions.terminate(key)
                time.sleep(1.0)
            except Exception:
                pass
        info = self.store.remove(key)
        if info and key.startswith(("rom:", "local:")):
            self._last_removed = {"key": key, "info": dict(info), "fav": key in self._favs, "args": (self.store.config.get("game_args") or {}).get(key, ""), "at": time.time()}
        d = info.get("dir") if info else None
        if d and not key.startswith(("rom:", "local:")):
            self._kill_procs_in(d)
            if not self._rmtree_force(d):
                pend = list(self.store.config.get("pending_delete") or [])
                if d not in pend:
                    pend.append(d)
                    self.store.set_config(pending_delete=pend)
                self.notify("warn", "Pasta em uso", f"Alguns arquivos de {Path(d).name} ainda estão abertos por outro programa. O restante é apagado na próxima abertura do Ludrix.")
        if info and info.get("kind") == "rom" and info.get("exe"):
            self.emu.remove_rom_file(info["exe"])
            if not key.startswith("rom:"):

                try:
                    fp = Path(info["exe"])
                    if paths.EMU_GAMES.resolve() in fp.resolve().parents:
                        fp.unlink(missing_ok=True)
                except OSError:
                    pass
            self.emu.invalidate_scan()
        self.act("")
        favs = self._favs
        if key in favs:
            favs.discard(key)
            self.store.set_config(favorites=sorted(favs))
        return {"ok": True}

    def _backup_library(self):
        try:
            src = paths.LIBRARY_FILE
            if not src.exists() or src.stat().st_size < 3:
                return
            bdir = paths.DATA / "backups"
            bdir.mkdir(parents=True, exist_ok=True)
            dst = bdir / time.strftime("library-%Y%m%d.json")
            if not dst.exists():
                shutil.copy2(src, dst)
            olds = sorted(f for f in bdir.glob("library-????????.json") if len(f.name) == len("library-YYYYMMDD.json"))
            for f in olds[:-7]:
                f.unlink(missing_ok=True)
            manual = sorted(f for f in bdir.glob("library-????????-??????.json"))
            for f in manual[:-10]:
                f.unlink(missing_ok=True)
        except Exception as e:
            log.debug("backup library: %s", e)

    def library_backup_now(self) -> dict:
        try:
            src = paths.LIBRARY_FILE
            if not src.exists():
                return {"error": "Biblioteca vazia"}
            bdir = paths.DATA / "backups"
            bdir.mkdir(parents=True, exist_ok=True)
            dst = bdir / time.strftime("library-%Y%m%d-%H%M%S.json")
            shutil.copy2(src, dst)
            return {"ok": True, "file": dst.name, "games": len(self.store.library)}
        except Exception as e:
            return {"error": str(e)}

    def library_dupes(self) -> list[list[dict]]:
        lib = self.store.library
        by_title: dict[str, list[str]] = {}
        by_exe: dict[str, list[str]] = {}
        for k, i in lib.items():
            t = normalize_title(i.get("title") or k)
            if t:
                by_title.setdefault(t + "|" + str(i.get("system") or ("rom" if i.get("kind") == "rom" else "pc")).lower(), []).append(k)
            e = str(i.get("exe") or "").strip().lower().replace("\\", "/")
            if e:
                by_exe.setdefault(e, []).append(k)
        seen: set[str] = set()
        groups = []
        for keys in list(by_exe.values()) + list(by_title.values()):
            if len(keys) < 2:
                continue
            fresh = [k for k in keys if k not in seen]
            if len(fresh) < 2:
                continue
            seen.update(fresh)
            items = []
            for k in fresh:
                i = lib[k]
                exe = str(i.get("exe") or "")
                items.append({"key": k, "title": i.get("title") or k, "exe": exe, "exists": bool(exe) and Path(exe).exists(), "playtime": i.get("playtime") or 0, "play_count": i.get("play_count") or 0, "source": i.get("store_src") or i.get("source") or "", "kind": i.get("kind") or "local"})
            items.sort(key=lambda x: (-int(x["exists"]), -x["playtime"], -x["play_count"]))
            groups.append(items)
        return groups

    def library_merge(self, keep: str, drop: list[str]) -> dict:
        lib = self.store.library
        if keep not in lib:
            return {"error": "Entrada principal não encontrada"}
        drop = [k for k in (drop or []) if k in lib and k != keep and k.startswith(("local:", "rom:"))]
        if not drop:
            return {"error": "Nada para juntar"}
        self.library_backup_now()
        base = dict(lib[keep])
        patch: dict = {}
        pt = float(base.get("playtime") or 0)
        pc = int(base.get("play_count") or 0)
        lp = float(base.get("last_played") or 0)
        ia = float(base.get("installed_at") or 0)
        notes = str(base.get("notes") or "")
        for k in drop:
            i = lib[k]
            pt += float(i.get("playtime") or 0)
            pc += int(i.get("play_count") or 0)
            lp = max(lp, float(i.get("last_played") or 0))
            if float(i.get("installed_at") or 0) and (not ia or float(i["installed_at"]) < ia):
                ia = float(i["installed_at"])
            n2 = str(i.get("notes") or "").strip()
            if n2 and n2 not in notes:
                notes = (notes + "\n" + n2).strip()
            for f in ("cover_url", "store_src", "steam_appid", "workdir", "args", "store_id"):
                if not base.get(f) and i.get(f):
                    patch[f] = i[f]
        patch.update({"playtime": pt, "play_count": pc, "notes": notes})
        if lp:
            patch["last_played"] = lp
        if ia:
            patch["installed_at"] = ia
        self.store.set_installed(keep, **patch)
        favs = self._favs
        if any(k in favs for k in drop) and keep not in favs:
            favs.add(keep)
            self.store.set_config(favorites=sorted(favs))
        for k in drop:
            self.store.remove(k)
            favs.discard(k)
        self.store.set_config(favorites=sorted(favs))
        self.emu.invalidate_scan()
        self.act("")
        return {"ok": True, "kept": keep, "removed": len(drop)}

    def library_backups(self) -> list[dict]:
        bdir = paths.DATA / "backups"
        out = []
        for f in sorted(bdir.glob("library-*.json"), reverse=True) if bdir.exists() else []:
            try:
                n = len(json.loads(f.read_text(encoding="utf-8")))
            except Exception:
                n = -1
            out.append({"file": f.name, "path": str(f), "games": n, "mtime": f.stat().st_mtime})
        return out

    def library_restore(self, name: str) -> dict:
        f = paths.DATA / "backups" / Path(name).name
        if not f.exists():
            return {"error": "Backup não encontrado"}
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:
            return {"error": f"Backup ilegível: {e}"}
        if not isinstance(data, dict):
            return {"error": "Backup inválido"}
        if self.store.library:
            self.library_backup_now()
        cur = dict(self.store.library)
        added = 0
        fixed = 0
        for k, v in data.items():
            if not isinstance(v, dict):
                continue
            if k not in cur:
                self.store.set_installed(k, **v)
                added += 1
                continue
            patch = {}
            for f in ("playtime", "play_count"):
                try:
                    if float(v.get(f) or 0) > float(cur[k].get(f) or 0):
                        patch[f] = v[f]
                except (TypeError, ValueError):
                    pass
            if patch:
                self.store.set_installed(k, **patch)
                fixed += 1
        self.emu.invalidate_scan()
        self.act("")
        return {"ok": True, "added": added, "fixed": fixed, "total": len(data)}

    def undo_remove(self) -> dict:
        lr = getattr(self, "_last_removed", None)
        if not lr or time.time() - lr["at"] > 600:
            return {"error": "Nada para desfazer"}
        key, info = lr["key"], lr["info"]
        if key in self.store.library:
            return {"error": "O jogo já está na biblioteca"}
        self.store.set_installed(key, **info)
        if lr.get("fav"):
            self.store.set_config(favorites=sorted(self._favs | {key}))
        if lr.get("args"):
            ga = dict(self.store.config.get("game_args") or {})
            ga[key] = lr["args"]
            self.store.set_config(game_args=ga)
        if info.get("kind") == "rom" and info.get("exe") and info.get("system"):
            try:
                self.emu.add_rom_file(info["exe"], info["system"])
            except Exception:
                pass
        self._last_removed = None
        self.act("")
        return {"ok": True, "key": key, "title": info.get("title", "")}

    @staticmethod
    def _drive_missing(p: str) -> str:
        if os.name != "nt" or not re.match(r"^[A-Za-z]:[\\/]", p or ""):
            return ""
        root = p[:3]
        return root.upper() if not Path(root).exists() else ""

    def folder_size(self, key: str) -> dict:
        info = self.store.get(key) or {}
        d = info.get("dir") or (str(Path(info["exe"]).parent) if info.get("exe") and "://" not in str(info["exe"]) else "")
        if not d or not Path(d).is_dir():
            return {"error": "Pasta não encontrada"}
        total, files, t0 = 0, 0, time.time()
        for root, _dirs, fnames in os.walk(d):
            for fn in fnames:
                try:
                    total += os.path.getsize(os.path.join(root, fn))
                    files += 1
                except OSError:
                    pass
            if time.time() - t0 > 20:
                return {"size": total, "files": files, "partial": True}
        self.store.update(key, size=total)
        return {"size": total, "files": files, "partial": False}

    def mark_played(self, key: str, played: bool) -> dict:
        if key not in self.store.library:
            return {"error": "Jogo não encontrado"}
        self.store.update(key, last_played=time.time() if played else 0)
        self.act("")
        return {"ok": True}

    def open_select(self, key: str) -> dict:
        info = self.store.get(key) or {}
        exe = str(info.get("exe") or "")
        if os.name == "nt" and exe and "://" not in exe and Path(exe).exists():
            import subprocess
            subprocess.Popen(["explorer", "/select,", exe])
            return {"ok": True}
        return self.open_path(info.get("dir") or (str(Path(exe).parent) if exe and "://" not in exe else ""))

    @staticmethod
    def _rmtree_force(d: str) -> bool:
        import stat

        def onerr(fn, path, exc):
            try:
                os.chmod(path, stat.S_IWRITE)
                fn(path)
            except Exception:
                pass
        for _ in range(3):
            shutil.rmtree(d, onerror=onerr)
            if not Path(d).exists():
                return True
            time.sleep(0.7)
        return not Path(d).exists()

    @staticmethod
    def _kill_procs_in(d: str):
        try:
            import psutil
        except ImportError:
            return
        root = str(Path(d).resolve()).lower().rstrip("\\/") + os.sep
        for p in psutil.process_iter(["pid", "exe"]):
            try:
                exe = (p.info.get("exe") or "").lower()
                if exe.startswith(root) and p.pid != os.getpid():
                    p.kill()
            except Exception:
                pass

    def _flush_pending_delete(self):
        pend = list(self.store.config.get("pending_delete") or [])
        if not pend:
            return
        left = [d for d in pend if Path(d).exists() and not self._rmtree_force(d)]
        if left != pend:
            self.store.set_config(pending_delete=left)

    def context_actions(self, key: str) -> list[dict]:
        g = self.game_payload(key)
        if not g:
            return []
        live = key in self.sessions.active
        kind = g.get("kind")
        installed = bool(g.get("installed")) and not g.get("missing")
        acts = []
        if installed and not live:
            acts.append({"id": "play", "label": "Jogar", "icon": "play", "primary": True})
            if self.store.config.get("game_mode_ask", True):
                acts.append({"id": "play_opt", "label": "Otimizar e abrir (Modo Game)", "icon": "bolt"})
            sysid = (g.get("system") or (g.get("emu") or {}).get("id") or "")
            if (kind == "rom" or local_rom_key(key)) and sysid and len(self.emu.installed_options(sysid)) > 1:
                acts.append({"id": "play_with", "label": "Jogar com…", "icon": "gamepad"})
        if live:
            acts.append({"id": "stop", "label": "Fechar o jogo", "icon": "x", "danger": True})
        local_rom = local_rom_key(key)
        if not installed and kind != "local" and not local_rom:
            only_t = bool(g.get("magnet") or g.get("torrent_url")) and not g.get("files")
            acts.append({"id": "install", "label": "Baixar via torrent" if only_t else "Baixar ROM" if kind == "rom" else "Baixar e instalar", "icon": "magnet" if only_t else "dl", "primary": True})
        acts.append({"id": "details", "label": "Detalhes", "icon": "info"})
        acts.append({"id": "fav", "label": "Remover dos favoritos" if key in self._favs else "Adicionar aos favoritos", "icon": "star"})
        acts.append({"sep": True})
        if installed and g.get("dir"):
            acts.append({"id": "open_dir", "label": "Abrir pasta do jogo", "icon": "folder"})
        if g.get("exe") or g.get("dir"):
            acts.append({"id": "copy_path", "label": "Copiar caminho", "icon": "doc"})
        acts.append({"id": "copy_name", "label": "Copiar nome", "icon": "doc"})
        if os.name == "nt" and installed and g.get("exe") and "://" not in str(g.get("exe")):
            acts.append({"id": "open_select", "label": "Mostrar o executável na pasta", "icon": "folder"})
        if (kind == "local" or local_rom or key.startswith("rom:")) and installed:
            acts.append({"id": "mark_played", "label": "Marcar como nunca jogado" if g.get("last_played") else "Marcar como jogado", "icon": "check"})
        if g.get("emu"):
            emu = g["emu"]
            if emu.get("installed"):
                acts.append({"id": "open_emu_dir", "label": f"Abrir pasta do {emu.get('emulator_title')}", "icon": "folder"})
                acts.append({"id": "config_emu", "label": f"Abrir {emu.get('emulator_title')} (configurar)", "icon": "cog"})
            acts.append({"id": "choose_emu", "label": "Trocar emulador…", "icon": "chip"})
        if installed and kind not in ("rom",) and not g.get("emu"):
            acts.append({"id": "choose_exe", "label": "Trocar executável…", "icon": "cog"})
        info = self.store.get(key) or {}
        lost = (info.get("kind") == "rom" and info.get("exe") and not Path(info["exe"]).exists()) or (info.get("kind") != "rom" and info.get("dir") and not Path(info["dir"]).exists()) or bool(g.get("missing"))
        if info and not installed and lost and "://" not in str(info.get("exe") or ""):
            acts.append({"id": "relocate", "label": "Apontar arquivo da ROM…" if info.get("kind") == "rom" else "Apontar pasta nova…", "icon": "folder", "primary": True})
        acts.append({"id": "edit", "label": "Editar detalhes do jogo…", "icon": "edit"})
        if kind == "local" or local_rom:
            acts.append({"id": "rename", "label": "Renomear…", "icon": "edit"})
        acts.append({"id": "metadata", "label": "Atualizar capa e metadados", "icon": "spark"})
        acts.append({"id": "cover", "label": "Trocar capa (imagem minha)…", "icon": "image"})
        acts.append({"id": "cover_web", "label": "Procurar capa no navegador", "icon": "ext"})
        if self.covers.custom_path(key):
            acts.append({"id": "cover_reset", "label": "Voltar à capa original", "icon": "refresh"})
        acts.append({"id": "mods", "label": "Mods e ferramentas", "icon": "wrench"})
        if installed:
            acts.append({"id": "saves", "label": "Saves (importar / abrir pasta)", "icon": "save"})
        if g.get("page_url"):
            acts.append({"id": "page", "label": "Página de origem", "icon": "ext"})
        acts.append({"sep": True})
        if kind == "local":
            acts.append({"id": "remove", "label": "Remover da biblioteca", "icon": "trash", "danger": True})
        elif local_rom:
            acts.append({"id": "remove", "label": "Ocultar da biblioteca", "icon": "trash", "danger": True})
        elif installed:
            acts.append({"id": "remove", "label": "Desinstalar (apaga a pasta)", "icon": "trash", "danger": True})
        return acts

    def stop_game(self, key: str) -> dict:
        return self.sessions.terminate(key)

    def home_payload(self) -> dict:
        cat = self.catalog_payload()
        games = [g for g in cat["games"] if g.get("installed")]
        broken = sum(1 for g in cat["games"] if g.get("repo") == "local" and not g.get("installed") and not g.get("mc_nolauncher"))
        live = set(self.sessions.status())
        by_key = {g["key"]: g for g in games}
        secs = {
            "playing": [k for k in live if k in by_key],
            "recent": [g["key"] for g in sorted([g for g in games if g.get("last_played")], key=lambda g: -g["last_played"])[:12]],
            "added": [g["key"] for g in sorted([g for g in games if g.get("added_at")], key=lambda g: -g["added_at"])[:12]],
            "favorites": [g["key"] for g in games if g.get("fav")],
            "most": [g["key"] for g in sorted([g for g in games if g.get("playtime", 0) >= 60], key=lambda g: -g["playtime"])[:12]],
        }
        total = sum(g.get("playtime", 0) for g in games)
        return {"sections": secs, "games": by_key, "stats": {"count": len(games), "playtime": total, "playtime_h": human_time(total),
                                                             "pc": sum(1 for g in games if g["kind"] in ("pc", "local", "recomp")),
                                                             "roms": sum(1 for g in games if g["kind"] == "rom"),
                                                             "missing": broken}}

    def install_emulator(self, emu_id: str):
        cfg = self.emu.presets["emulators"].get(emu_id)
        if not cfg:
            return {"error": "Emulador desconhecido"}
        return self._run_job(f"emu:{emu_id}", cfg["title"], "emulator",
                             lambda cb, cancel: {"dir": str(self.emu.install_emulator(emu_id, cb, cancel))}, retry={"m": "install_emulator", "a": [emu_id]})

    def library_check(self) -> dict:
        items = []
        for key, info in list(self.store.library.items()):
            exe = str(info.get("exe") or "")
            d = str(info.get("dir") or "")
            title = info.get("title") or self._title_of(key) or key
            if info.get("kind") == "rom":
                if exe and not Path(exe).exists():
                    items.append({"key": key, "title": title, "kind": "rom", "path": exe, "problem": "A ROM não está mais em " + str(Path(exe).parent)})
                continue
            if "://" in exe or not d:
                continue
            if not Path(d).exists():
                items.append({"key": key, "title": title, "kind": "dir", "path": d, "problem": "A pasta do jogo não existe mais"})
            else:
                ep = (Path(exe) if os.path.isabs(exe) else Path(d) / exe) if exe else None
                if ep is not None and not ep.exists():
                    items.append({"key": key, "title": title, "kind": "exe", "path": str(ep), "problem": "A pasta existe, mas o executável sumiu"})
            wd = str(info.get("workdir") or "")
            if wd and not Path(wd).exists():
                items.append({"key": key, "title": title, "kind": "workdir", "path": wd, "problem": "A pasta de trabalho configurada não existe mais"})
        emus = []
        used = {}
        for key, info in self.store.library.items():
            if info.get("kind") == "rom":
                sid = info.get("system") or (key.split(":", 2)[1] if key.count(":") >= 2 else "")
                if sid:
                    used[sid] = used.get(sid, 0) + 1
        for sid, n in sorted(used.items()):
            st = self.emu.system_status(sid)
            if st and not st.get("installed"):
                emus.append({"system": sid, "name": st.get("name", sid), "count": n, "emulator": st.get("emulator_title") or st.get("emulator") or ""})
        self.store.set_config(last_lib_check=time.time())
        return {"total": len(self.store.library), "items": items, "emus": emus, "dupes": len(self.library_dupes())}

    def relocate_game(self, key: str, new_path: str | None) -> dict:
        info = self.store.get(key)
        if not info:
            return {"error": "Jogo não encontrado"}
        is_rom = info.get("kind") == "rom"
        if not new_path:
            if is_rom:
                new_path = self.pick_file(str(Path(info.get("exe") or "").parent) if info.get("exe") else "", "rom") if self.pick_file else None
            else:
                new_path = self.pick_folder(str(Path(info.get("dir") or "").parent) if info.get("dir") else "") if self.pick_folder else None
            if not new_path:
                return {"cancel": True} if (self.pick_file or self.pick_folder) else {"error": "Informe o novo caminho"}
        new = Path(str(new_path).strip().strip('"'))
        if is_rom:
            if not new.is_file():
                return {"error": "Arquivo não encontrado"}
            old = str(info.get("exe") or "")
            sid = info.get("system") or ""
            lst = list(self.store.config.get("rom_files") or [])
            for x in lst:
                if x.get("path") == old:
                    x["path"] = str(new)
                    sid = sid or x.get("system") or ""
            if old and sid and not any(x.get("path") == str(new) for x in lst):
                lst.append({"path": str(new), "system": sid})
            self.store.set_config(rom_files=lst)
            self.emu.invalidate_scan()
            self.store.update(key, exe=str(new), dir=str(new.parent), **({"system": sid} if sid else {}))
            self._slim_cache.pop(key, None)
            return {"ok": True, "exe": str(new)}
        if not new.is_dir():
            return {"error": "Pasta não encontrada"}
        old_dir = Path(info.get("dir") or "")
        patch = {"dir": str(new)}
        exe = str(info.get("exe") or "")
        if exe:
            rel = None
            try:
                rel = Path(exe).relative_to(old_dir) if os.path.isabs(exe) else Path(exe)
            except ValueError:
                rel = Path(Path(exe).name)
            cand = new / rel
            if not cand.is_file():
                hits = [p for p in new.rglob(rel.name)] if rel.name else []
                cand = hits[0] if hits else None
            if cand is not None:
                patch["exe"] = str(cand) if os.path.isabs(exe) else str(cand.relative_to(new))
            else:
                patch["exe"] = ""
        wd = str(info.get("workdir") or "")
        if wd:
            try:
                patch["workdir"] = str(new / Path(wd).relative_to(old_dir))
            except ValueError:
                patch["workdir"] = ""
        sd = str(info.get("save_dir") or "")
        if sd and old_dir and str(sd).startswith(str(old_dir)):
            try:
                patch["save_dir"] = str(new / Path(sd).relative_to(old_dir))
            except ValueError:
                pass
        self.store.update(key, **patch)
        self._slim_cache.pop(key, None)
        return {"ok": True, "dir": str(new), "exe": patch.get("exe", exe), "need_exe": bool(exe) and not patch.get("exe")}

    def move_game(self, key: str, dest_parent: str) -> dict:
        info = self.store.get(key)
        if not info:
            return {"error": "Jogo não encontrado"}
        if info.get("kind") == "rom" or "://" in str(info.get("exe") or ""):
            return {"error": "Só jogos instalados em pasta podem ser movidos"}
        src = Path(info.get("dir") or "")
        if not src.is_dir():
            return {"error": "A pasta atual do jogo não existe"}
        parent = Path(str(dest_parent or "").strip().strip('"'))
        if not parent.is_dir():
            return {"error": "A pasta de destino não existe"}
        dst = parent / src.name
        if dst.resolve() == src.resolve():
            return {"error": "O jogo já está nessa pasta"}
        if dst.exists():
            return {"error": f"Já existe uma pasta \"{src.name}\" no destino"}
        if str(parent.resolve()).startswith(str(src.resolve()) + os.sep):
            return {"error": "O destino fica dentro da própria pasta do jogo"}
        if key in self.sessions.status():
            return {"error": "Feche o jogo antes de mover"}
        title = info.get("title") or self._title_of(key) or key

        def work(cb, cancel):
            files = [f for f in src.rglob("*") if f.is_file()]
            total = sum(f.stat().st_size for f in files) or 1
            done = 0
            try:
                free = shutil.disk_usage(parent).free
            except Exception:
                free = None
            if free is not None and free < total + 64 * 1024 * 1024:
                raise RuntimeError(f"Espaço insuficiente no destino ({human_size(free)} livres, precisa de {human_size(total)})")
            try:
                for f in files:
                    if cancel.is_set():
                        raise CancelledError()
                    rel = f.relative_to(src)
                    (dst / rel).parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(f, dst / rel)
                    done += f.stat().st_size
                    cb(Progress("move", done / total, f"Movendo {rel.name}"))
            except BaseException:
                shutil.rmtree(dst, ignore_errors=True)
                raise
            patch = {"dir": str(dst)}
            exe = str(info.get("exe") or "")
            if exe:
                try:
                    patch["exe"] = str(dst / Path(exe).relative_to(src))
                except ValueError:
                    pass
            wd = str(info.get("workdir") or "")
            if wd:
                try:
                    patch["workdir"] = str(dst / Path(wd).relative_to(src))
                except ValueError:
                    pass
            self.store.update(key, **patch)
            self._slim_cache.pop(key, None)
            shutil.rmtree(src, ignore_errors=True)
            self._push({"type": "moved", "key": key, "dir": str(dst)})
            return {"dir": str(dst)}
        return self._run_job(key, title, "move", work)

    def _title_of(self, key: str) -> str:
        g = self._slim_cache.get(key)
        return (g or {}).get("title", "") if isinstance(g, dict) else ""

    def export_metadata(self, keys: list[str] | None = None, fmt: str = "ludrix") -> dict:
        import csv
        import datetime
        cat = self.catalog_payload().get("games", [])
        sel = set(keys or [])
        games = [g for g in cat if (g["key"] in sel if sel else g.get("installed") or g["key"].startswith(("local:", "rom:")))]
        if not games:
            return {"error": "Nenhum jogo para exportar"}
        stamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M")
        out = paths.DOWNLOADS / f"ludrix-export-{stamp}"
        covers = out / "covers"
        out.mkdir(parents=True, exist_ok=True)
        covers.mkdir(exist_ok=True)
        rows, heroic = [], []
        for g in games:
            key = g["key"]
            m = self.meta.get(key) or {}
            info = self.store.get(key) or {}
            cover_file = ""
            src_cover = self.covers.custom_path(key) if self.covers else None
            if not src_cover:
                for cand in (paths.CACHE_COVERS / f"{_safe_name('c:' + key)}.webp",):
                    if cand.exists():
                        src_cover = cand
                        break
            if src_cover and src_cover.exists():
                cover_file = safe_folder_name(g["title"])[:80] + src_cover.suffix
                try:
                    shutil.copy2(src_cover, covers / cover_file)
                except Exception:
                    cover_file = ""
            row = {"key": key, "title": g["title"], "kind": g.get("kind"), "system": g.get("system") or "pc",
                   "developer": m.get("developer", ""), "publisher": m.get("publisher", ""), "year": str(m.get("year") or g.get("year") or ""),
                   "genres": list(m.get("genres") or g.get("genres") or []), "summary": m.get("summary", ""), "series": m.get("series", ""),
                   "playtime_seconds": int(g.get("playtime") or 0), "last_played": int(g.get("last_played") or 0), "favorite": bool(g.get("fav")),
                   "exe": info.get("exe", ""), "dir": info.get("dir", ""), "args": self._game_args(key), "cover": ("covers/" + cover_file) if cover_file else "",
                   "cover_url": m.get("cover_url", ""), "hero_url": m.get("hero_url", ""), "links": list(m.get("links") or []),
                   "steam_appid": m.get("steam_appid", ""), "wiki_url": m.get("wiki_url", ""),
                   "play_count": int(info.get("play_count") or 0), "source": info.get("source", ""), "store": info.get("store_src", ""), "notes": m.get("notes", ""),
                   "workdir": info.get("workdir", "")}
            rows.append(row)
            if info.get("exe") and "://" not in str(info.get("exe")):
                art = str((covers / cover_file).resolve()) if cover_file else ""
                heroic.append({"app_name": re.sub(r"[^a-z0-9]+", "-", g["title"].lower()).strip("-")[:60] or key, "title": g["title"],
                               "runner": "sideload", "is_installed": True, "canRunOffline": True, "launchFullScreen": False, "browserUrl": "",
                               "art_cover": ("file:///" + art.replace("\\", "/")) if art else "", "art_square": ("file:///" + art.replace("\\", "/")) if art else "",
                               "folder_name": info.get("dir", ""),
                               "install": {"executable": info.get("exe", ""), "platform": "Windows", "is_dlc": False},
                               "description": m.get("summary", "")})
        (out / "ludrix-library.json").write_text(json.dumps({"format": "ludrix-export", "version": 1, "exported_at": time.time(), "games": rows},
                                                            ensure_ascii=False, indent=2), encoding="utf-8")
        with (out / "ludrix-library.csv").open("w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f, delimiter=";")
            w.writerow(["Name", "Platform", "Developer", "Publisher", "ReleaseYear", "Genres", "Description", "InstallDirectory", "Path", "Arguments", "Playtime (min)", "Favorite", "Cover", "PlayCount", "LastActivity", "Source", "Notes"])
            for r in rows:
                w.writerow([r["title"], "PC" if r["system"] == "pc" else r["system"], r["developer"], r["publisher"], r["year"], ", ".join(r["genres"]),
                            r["summary"].replace("\n", " "), r["dir"], r["exe"], r["args"], r["playtime_seconds"] // 60, "1" if r["favorite"] else "0", r["cover"],
                            r["play_count"], time.strftime("%Y-%m-%d", time.localtime(r["last_played"])) if r["last_played"] else "", r["store"] or r["source"], r["notes"].replace("\n", " ")])
        if heroic:
            hd = out / "heroic" / "sideload_apps"
            hd.mkdir(parents=True, exist_ok=True)
            (hd / "library.json").write_text(json.dumps({"games": heroic}, ensure_ascii=False, indent=2), encoding="utf-8")
        (out / "LEIA-ME.txt").write_text(
            "Exportação do LudrixHub\n\n"
            "ludrix-library.json  — tudo (nomes, metadados, caminhos, tempo jogado, capas em covers/). Formato aberto, legível.\n"
            "ludrix-library.csv   — planilha (separador ;). Abre no Excel/LibreOffice; no Playnite use uma extensão de importar CSV.\n"
            "heroic/sideload_apps/library.json — jogos com executável no formato de 'sideload' do Heroic Games Launcher: copie por cima\n"
            "                       do arquivo homônimo na pasta de configuração do Heroic (com ele fechado) ou mescle a lista 'games'.\n"
            "covers/              — capas dos jogos (quando havia).\n", encoding="utf-8")
        return {"ok": True, "dir": str(out), "count": len(rows), "heroic": len(heroic)}

    def set_config(self, data: dict):
        allowed = {k: v for k, v in data.items() if k not in ("settings_lock", "settings_locked")}
        before = dict(self.store.config)
        cfg = self.store.set_config(**allowed)
        hot = [k for k in self.RESTART_KEYS if k in data and data[k] != before.get(k)]
        if hot:
            pend = list(self.store.config.get("pending_restart") or [])
            for k in hot:
                if k in pend:
                    pend.remove(k)
                else:
                    pend.append(k)
            self.store.set_config(pending_restart=pend)
            cfg = self.store.config
        if any(k.startswith("torrent_") for k in data) and torrent_mod.available() and torrent_mod.TorrentClient._instance:
            torrent_mod.TorrentClient._instance.apply_limits()
        if "gamepad_wake" in data and self.gamepad:
            (self.gamepad.start if cfg.get("gamepad_wake") else self.gamepad.stop)()
        if data.get("bg_warmup") and not before.get("bg_warmup"):
            self.pool.submit(self._warm_up)
        return self.public_config() if cfg else {}

    def reset_config(self, keys) -> dict:
        keys = [k for k in (keys or []) if isinstance(k, str) and k in DEFAULT_CONFIG and k not in ("settings_lock", "settings_locked", "language", "welcome_done")]
        if not keys:
            return {"error": "Nada para redefinir."}
        return self.set_config({k: json.loads(json.dumps(DEFAULT_CONFIG[k])) for k in keys})

    def choose_folder(self, what: str = "games", system: str | None = None, initial: str = ""):
        if not self.pick_folder:
            return {"native": False}
        try:
            d = self.pick_folder(initial or "")
        except TypeError:
            d = self.pick_folder()
        if d and what == "games":
            self.store.set_config(games_dir=d)
        if d and what == "rom_dir" and system:
            self.emu.add_rom_dir(system, d)
        return {"native": True, "folder": d}

    def pick_exe(self, initial: str = "", kind: str = "exe") -> dict:
        if not self.pick_file:
            return {"native": False}
        f = self.pick_file(initial, kind)
        out = {"native": True, "file": f}
        if f and kind == "exe":
            out.update(self.local_guess(f))
        return out

    def local_guess(self, path: str) -> dict:
        p = Path(path or "")
        if not p.name:
            return {"guess": ""}
        target = self._shortcut_target(p)
        guess = self._guess_title(p)
        if target and (len(guess) < 3 or guess.lower() == p.parent.name.lower()):
            guess = self._guess_title(Path(target)) if "://" not in target else guess
        return {"guess": guess or p.stem, "target": target or ""}

    @staticmethod
    def _shortcut_target(p: Path) -> str | None:
        suf = p.suffix.lower()
        if suf == ".lnk":
            try:
                return importers._lnk_target(p)
            except Exception:
                return None
        if suf == ".url":
            try:
                for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
                    if line.lower().startswith("url="):
                        return line[4:].strip()
            except OSError:
                pass
        return None

    def detect(self, q: str) -> dict:
        self.act("Analisando fonte…")
        try:
            return detect_source(self.repos.session, q, self.repos.cache)
        except Exception as e:
            return {"kind": "none", "results": [], "error": str(e)}
        finally:
            self.act("")

    def link_preview(self, url: str) -> dict:
        from . import hosts
        url = (url or "").strip()
        self.act("Lendo o link…")
        try:
            files = hosts.resolve(url, self.repos.session)
        except hosts.HostError as e:
            return {"error": str(e), "host": hosts.known_host(url)}
        finally:
            self.act("")
        names = [f.name for f in files]
        base = names[0] if len(names) == 1 else os.path.commonprefix(names).rstrip(" ._-") or names[0]
        title = normalize_title(re.sub(r"\.(7z|zip|rar|001|iso|exe|part\d+)$", "", base, flags=re.I)) or "Jogo"
        parts = sum(1 for n in names if re.search(r"\.(\d{3}|part\d+\.rar|z\d\d)$", n, re.I))
        return {"host": files[0].host or hosts.known_host(url), "title": title, "total": sum(f.size for f in files),
                "files": [{"name": f.name, "size": f.size, "i": i} for i, f in enumerate(files)],
                "hint": "arquivo dividido em partes — baixo todas e junto na extração" if parts > 1 else ""}

    def link_download(self, url: str, title: str | None, kind: str = "pc", system: str = "pc", picks: list[int] | None = None) -> dict:
        from . import hosts
        url = (url or "").strip()
        if not re.match(r"^(https?://|magnet:\?)", url, re.I):
            return {"error": "Cole um link http(s) ou magnet"}
        title = normalize_title(title or "") or "Jogo"
        key = "local:" + re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
        if key in self.jobs:
            return {"error": "Já em andamento"}
        if kind == "rom" and system != "pc":
            root = paths.EMU_GAMES / system
        else:
            kind, system = "pc", "pc"
            root = self.store.games_dir()
        root.mkdir(parents=True, exist_ok=True)
        e = Entry(key=key, repo="local", id=title, title=title, kind=kind, system=system, page_url=url)
        keep = bool(self.store.config.get("keep_archive"))
        r = self._hosted_job(e, url, root, keep, picks, retry={"m": "link_download", "a": [url, title, kind, system, picks]})
        if r.get("ok"):
            self.notify("info", f"{title}: download começou", f"Via {hosts.known_host(url) or 'link direto'} — acompanhe na Fila.", key=key)
        return r

    def _hosted_job(self, e: Entry, url: str, root: Path, keep: bool, picks: list[int] | None, retry: dict) -> dict:
        from . import hosts
        if e.key in self.jobs:
            return {"error": "Já em andamento"}

        def fn(cb, cancel):
            cb(Progress("download", -1, "Lendo o link..."))
            files = hosts.resolve(url, self.repos.session)
            if picks:
                files = [f for i, f in enumerate(files) if i in picks] or files
            refs = []
            for f in files:
                fr = FileRef(f.name, "lazy://" if f.lazy or not f.url else f.url, f.size)
                fr.headers, fr.cookies, fr.decrypt = ({} if f.lazy else f.headers), f.cookies, f.decrypt
                fr._res = f
                refs.append(fr)

            def resolver(fr):
                if fr._res.host == "itch.io":
                    fin = hosts.itch_final(fr._res, self.repos.session)
                    return fin.url, {}, fin.name, fin.size
                return hosts.mega_folder_link(fr._res, self.repos.session), fr.headers
            game_dir, exes = install_game(refs, e.title, root, cb, cancel, keep, self.repos.session, resolver=resolver)
            return self._finish_install(e, game_dir, exes)
        return self._run_job(e.key, e.title, "install", fn, retry=retry)

    def patch_download(self, key: str, i: int) -> dict:
        from . import hosts
        e = self.entries.get(key)
        patches = list((e.extra.get("patches") if e else None) or [])
        if not e or not 0 <= i < len(patches):
            return {"error": "Patch desconhecido"}
        pt = patches[i]
        info = self.store.get(key) or {}
        base = Path(info["dir"]) if info.get("dir") and Path(info["dir"]).is_dir() else paths.DOWNLOADS / "patches" / safe_folder_name(e.title)
        dest_dir = base / "_patches" if info.get("dir") and Path(info["dir"]).is_dir() else base
        jkey = f"patch:{key}:{i}"

        def fn(cb, cancel):
            cb(Progress("download", -1, "Lendo o link..."))
            files = hosts.resolve(pt["url"], self.repos.session)
            dl = Downloader(self.repos.session)
            for f in files:
                if f.host == "itch.io":
                    f = hosts.itch_final(f, self.repos.session)
                elif not f.url:
                    f.url = hosts.mega_folder_link(f, self.repos.session)
                fr = FileRef(f.name or pt["name"], f.url, f.size)
                fr.headers, fr.cookies, fr.decrypt = f.headers, f.cookies, f.decrypt
                dl.download(fr, dest_dir / (safe_folder_name(Path(str(f.name or pt["name"]).replace("\\", "/")).name) or "patch.bin"), cb, cancel)
            self.open_path(str(dest_dir))
            return {"dir": str(dest_dir)}
        return self._run_job(jkey, f"{e.title} — {pt['name']}", "tool", fn, retry={"m": "patch_download", "a": [key, i]})

    def mod_install(self, key: str, path: str | None, title: str = "", target: str = "", kind: str = "") -> dict:
        info = self.store.get(key)
        if not info:
            return {"error": "Jogo não instalado"}
        if not path:
            if kind == "dir":
                if not self.pick_folder:
                    return {"error": "Informe o caminho da pasta do mod"}
                path = self.pick_folder(str(Path.home() / "Downloads"))
            else:
                if not self.pick_file:
                    return {"error": "Informe o caminho do arquivo do mod (.zip, .7z, .rar)"}
                path = self.pick_file(str(Path.home() / "Downloads"), "archive")
            if not path:
                return {"ok": False}
        try:
            self.gmods.check(key, path, target)
        except RuntimeError as e:
            return {"error": str(e)}
        jkey = f"mod:{key}"
        if jkey in self.jobs:
            return {"error": "Já estou instalando um mod nesse jogo"}
        return self._run_job(jkey, f"{info.get('title', key)} — mod", "tool", lambda cb, cancel: self.gmods.install(key, path, title, target, cb, cancel))

    def install_tool(self, tid: str):
        t = next((x for x in self.mods.presets["tools"] if x["id"] == tid), None)
        if not t:
            return {"error": "Ferramenta desconhecida"}
        return self._run_job(f"tool:{tid}", t["title"], "tool", lambda cb, cancel: {"dir": str(self.mods.install(tid, cb, cancel))}, retry={"m": "install_tool", "a": [tid]})

    def online(self, force: bool = False) -> bool:
        now = time.time()
        if not force and self._online is not None and now - self._online_at < 60:
            return self._online
        import socket
        ok = False
        for host in ("archive.org", "1.1.1.1", "8.8.8.8"):
            try:
                socket.create_connection((host, 443), timeout=2.5).close()
                ok = True
                break
            except OSError:
                continue
        self._online, self._online_at = ok, now
        return ok

    def redists_status(self) -> dict:
        st = self.redists.status()
        st["jobs"] = [k[7:] for k in self.jobs if k.startswith("redist:")]
        return st

    def redist_install(self, rid: str):
        it = self.redists.item(rid)
        if not it:
            return {"error": "Pacote desconhecido"}
        if not self.online():
            return {"error": "Sem conexão com a internet"}
        return self._run_job(f"redist:{rid}", f"{it['title']} ({it['arch']})", "redist",
                             lambda cb, cancel: self.redists.install(rid, cb, cancel), retry={"m": "redist_install", "a": [rid]})

    def optionals_status(self, deep: bool = False) -> dict:
        st = self.optionals.status(deep)
        st["jobs"] = [k[9:] for k in self.jobs if k.startswith("optional:")]
        return st

    def optional_install(self, iid: str) -> dict:
        it = self.optionals.item(iid)
        if not it:
            return {"error": "Programa desconhecido"}
        if not self.online():
            return {"error": "Sem conexão com a internet"}
        if not it.get("winget"):
            return {"error": "Este programa só é distribuído pela Microsoft Store. Use \"Abrir na Store\""}
        if not optionals.winget_path():
            return {"error": "winget não encontrado (Windows 10/11 com o \"Instalador de Aplicativo\" da Microsoft Store)"}
        return self._run_job(f"optional:{iid}", it["title"], "optional",
                             lambda cb, cancel: self.optionals.install(iid, cb, cancel), retry={"m": "optional_install", "a": [iid]})

    def _mc_keys(self) -> dict[str, str]:
        return {v.get("mc"): k for k, v in self.store.library.items() if v.get("mc")}

    def _mc_migrate(self):
        ids = {x["id"] for x in minecraft.LAUNCHERS}
        for key, v in list(self.store.library.items()):
            if v.get("mc") in ids:
                self.store.update(key, mc="java", mc_launcher=v["mc"], title="Minecraft: Java Edition", creator="Mojang Studios")

    def _mc_pref(self) -> dict[str, str]:
        out = {}
        for ed, key in self._mc_keys().items():
            v = self.store.get(key) or {}
            if v.get("mc_launcher"):
                out[ed] = v["mc_launcher"]
        return out

    def minecraft_status(self) -> dict:
        keys = self._mc_keys()
        st = self.mc.status(keys)
        st["editions"] = self.mced.list(keys, self._mc_pref())
        st["launchers_installed"] = self.mced.installed_launchers()
        st["recommend"] = self.mced.recommend()
        st["jobs"] = [k[3:] for k in self.jobs if k.startswith("mc:")]
        return st

    def minecraft_add(self, what: str, path: str | None = None) -> dict:
        ids = {x["id"] for x in minecraft.LAUNCHERS}
        if what in ids:
            return self.minecraft_add_edition("java", what, path)
        if what in ("java", "bedrock"):
            return self.minecraft_add_edition(what, None, path)
        return {"error": "Edição desconhecida"}

    def minecraft_add_edition(self, ed: str, lid: str | None = None, path: str | None = None) -> dict:
        key = self._mc_keys().get(ed) or f"local:minecraft-{ed}"
        title = minecraft.EDITIONS[ed]["title"]
        desc = minecraft.EDITIONS[ed]["desc"]
        if ed == "bedrock":
            if not minecraft.bedrock_installed():
                return {"error": "O Minecraft Bedrock não está instalado. Instale pela Microsoft Store e volte aqui."}
            self.store.set_installed(key, dir=minecraft._expand(minecraft.BEDROCK_PKG), exe="shell:AppsFolder\\" + minecraft.BEDROCK_AUMID, title=title, kind="local", title_locked=True,
                                     mc="bedrock", creator="Mojang Studios", year="2011", genres=["Sandbox", "Sobrevivência"], description=desc, page_url="https://www.minecraft.net/")
        else:
            dirs = minecraft.java_dirs()
            it, lpath = (None, "")
            if lid:
                it = self.mc.item(lid)
                lpath = path or (self.mc.detect(it) if it else "")
                if it and lpath and not lpath.startswith(("shell:", "flatpak:")) and not Path(lpath).exists():
                    return {"error": "Arquivo não encontrado"}
            if not lpath:
                it, lpath = self.mced.java_launcher(lid or "")
            if not dirs and not lpath:
                return {"error": "Minecraft Java não encontrado neste PC (nem a pasta .minecraft, nem um launcher). Instale um launcher abaixo e abra-o uma vez."}
            folder = dirs[0] if dirs else ("" if lpath.startswith(("shell:", "flatpak:")) else str(Path(lpath).parent))
            self.store.set_installed(key, dir=folder, exe=lpath or "", title=title, kind="local", title_locked=True, mc="java", mc_launcher=it["id"] if it else "",
                                     creator="Mojang Studios", year="2011", genres=["Sandbox", "Sobrevivência"],
                                     description=desc + (f" Abre pelo {it['title']}." if it else " Ainda sem launcher: ao clicar em Jogar o Ludrix indica um."), page_url="https://www.minecraft.net/")
            if not lpath:
                self.notify("warn", "Minecraft Java entrou na biblioteca, mas sem launcher",
                            "Pasta .minecraft encontrada, mas nenhum launcher para abrir o jogo. Instale um em Central › Minecraft (Prism ou o oficial); ao clicar em Jogar eu também indico.", key=key)
        if self.store.config.get("auto_metadata", True):
            self.queue_meta(key)
        return {"ok": True, "key": key, "launcher": (self.store.get(key) or {}).get("mc_launcher", "")}

    def minecraft_set_launcher(self, lid: str, path: str | None = None) -> dict:
        it = self.mc.item(lid)
        if not it:
            return {"error": "Launcher desconhecido"}
        p = path or self.mc.detect(it)
        if not p:
            return {"error": "Esse launcher não está instalado. Instale ou use \"Localizar\"."}
        key = self._mc_keys().get("java")
        if not key:
            return self.minecraft_add_edition("java", lid, p)
        self.store.update(key, exe=p, mc_launcher=lid, description=minecraft.EDITIONS["java"]["desc"] + f" Abre pelo {it['title']}.")
        return {"ok": True, "key": key, "launcher": lid}

    def minecraft_locate(self, lid: str) -> dict:
        if not self.pick_file:
            return {"error": "Diálogo nativo indisponível no modo navegador"}
        p = self.pick_file("")
        if not p:
            return {"cancel": True}
        return self.minecraft_set_launcher(lid, p)

    def minecraft_autoadd(self):
        self._mc_migrate()
        if not self.store.config.get("minecraft_auto", True):
            return
        have = self._mc_keys()
        try:
            if "java" in have:
                info = self.store.get(have["java"]) or {}
                if not info.get("exe"):
                    it, fresh = self.mced.java_launcher(info.get("mc_launcher") or "")
                    if fresh and it:
                        self.store.update(have["java"], exe=fresh, mc_launcher=it["id"], description=minecraft.EDITIONS["java"]["desc"] + f" Abre pelo {it['title']}.")
                        self.notify("info", f"Minecraft Java agora abre pelo {it['title']}", "Launcher encontrado; o jogo está pronto para Jogar.", key=have["java"])
            if "java" not in have and (minecraft.java_dirs() or self.mced.java_launcher()[1]):
                self.minecraft_add_edition("java")
            if "bedrock" not in have and minecraft.bedrock_installed():
                self.minecraft_add_edition("bedrock")
        except Exception as e:
            log.warning("minecraft autoadd: %s", e)

    def minecraft_install(self, lid: str) -> dict:
        it = self.mc.item(lid)
        if not it:
            return {"error": "Launcher desconhecido"}
        if not self.online():
            return {"error": "Sem conexão com a internet"}
        if not it.get("winget"):
            return {"error": "Este launcher não está no winget. Use \"Site\" para baixar no navegador e depois \"Localizar\"."}
        if not optionals.winget_path():
            return {"error": "winget não encontrado (Windows 10/11 com o \"Instalador de Aplicativo\" da Microsoft Store)"}

        def run(cb, cancel):
            self.optionals.install_pkgs(it["winget"], cb, cancel)
            path = self.mc.detect(it)
            if path:
                self.minecraft_set_launcher(lid, path)
            return {"item": lid, "installed": bool(path)}
        return self._run_job(f"mc:{lid}", it["title"], "optional", run, retry={"m": "minecraft_install", "a": [lid]})

    def minecraft_open(self, lid: str, where: str) -> dict:
        if lid in ("java", "bedrock"):
            pid = minecraft.JAVA_STORE if lid == "java" else minecraft.BEDROCK_STORE
            if os.name == "nt":
                os.startfile(f"ms-windows-store://pdp/?ProductId={pid}")
                return {"ok": True}
            return self.open_url(f"https://apps.microsoft.com/detail/{pid}")
        it = self.mc.item(lid)
        if not it:
            return {"error": "Launcher desconhecido"}
        if where == "store" and it.get("store") and os.name == "nt":
            os.startfile(f"ms-windows-store://pdp/?ProductId={it['store']}")
            return {"ok": True}
        return self.open_url(it["site"])

    def optional_store(self, iid: str) -> dict:
        it = {"title": "App Installer", "store": "9NBLGGH4NNS1"} if iid == "winget" else self.optionals.item(iid)
        if not it:
            return {"error": "Programa desconhecido"}
        pid = it.get("store")
        if os.name == "nt":
            url = f"ms-windows-store://pdp/?ProductId={pid}" if pid else "ms-windows-store://search/?query=" + urllib.parse.quote(it["title"])
            os.startfile(url)
        else:
            url = f"https://apps.microsoft.com/detail/{pid}" if pid else "https://apps.microsoft.com/search?query=" + urllib.parse.quote(it["title"])
            webbrowser.open(url)
        return {"ok": True, "url": url}

    CONSOLE_THEMES = {
        "noite": {"name": "Noite", "desc": "Preto profundo, cinza-azulado do Ludrix", "bg": "#0c0d10", "bg2": "#15161b", "card": "#1d1e24", "text": "#f2f2f4", "muted": "#8f929c", "accent": "#5c6b82"},
        "gelo": {"name": "Gelo", "desc": "Azul-noite e ciano", "bg": "#071018", "bg2": "#0d1a26", "card": "#12283a", "text": "#e9f4fb", "muted": "#7f9ab0", "accent": "#35c6f0"},
        "brasa": {"name": "Brasa", "desc": "Vinho escuro e âmbar", "bg": "#130a0b", "bg2": "#1e0f12", "card": "#2a161a", "text": "#fbeeea", "muted": "#a98a86", "accent": "#ffa63d"},
        "mata": {"name": "Mata", "desc": "Verde-musgo e lima", "bg": "#090f0a", "bg2": "#0f1a11", "card": "#152418", "text": "#eef6ec", "muted": "#8aa08c", "accent": "#a6e05a"},
        "neve": {"name": "Neve", "desc": "Claro, cinza-gelo e azul", "bg": "#eef0f3", "bg2": "#ffffff", "card": "#f7f8fa", "text": "#1b1d24", "muted": "#6a7080", "accent": "#2f6df6", "light": True},
    }

    def console_payload(self) -> dict:
        from .gamepad import connected_now
        cat = self.catalog_payload()
        games = [g for g in cat["games"] if g.get("installed")]
        games.sort(key=lambda g: (g.get("title") or "").lower())
        by_key = {g["key"]: g for g in games}
        recent = [g["key"] for g in sorted([g for g in games if g.get("last_played")], key=lambda g: -g["last_played"])[:14]]
        c = self.store.config
        return {"games": games, "recent": recent, "favorites": [g["key"] for g in games if g.get("fav")],
                "systems": cat["systems"], "sessions": self.sessions.status(), "gamepad": connected_now(),
                "theme": c.get("console_theme", "noite"), "themes": self.CONSOLE_THEMES, "language": c.get("language", "pt-BR"),
                "config": {"console_gamepad_speed": c.get("gamepad_speed", "normal"),
                           "console_sound": c.get("console_sound", True), "game_mode_auto": bool(c.get("game_mode_auto")), "after_launch": c.get("after_launch", "ask"),
                           "console_hint": c.get("console_hint", True), "console_card_size": c.get("console_card_size", "normal"),
                           "console_clock24": c.get("console_clock24", True), "console_start_view": c.get("console_start_view", "library"),
                           "console_vibrate": c.get("console_vibrate", True), "console_dim_idle": int(c.get("console_dim_idle") or 0),
                           "console_confirm_quit": c.get("console_confirm_quit", True), "console_sort": c.get("console_sort", "title"), "fav_first": bool(c.get("fav_first")), "console_dl_pill": c.get("console_dl_pill", True),
                           "save_auto_backup": bool(c.get("save_auto_backup")), "launch_splash": c.get("launch_splash", "short")},
                "playing": bool(self.sessions.active), "version": current_version().get("version", ""), "count": len(by_key)}

    def console_swap(self, to: str, force: bool = False) -> dict:
        from . import instance
        if to not in ("window", "console"):
            return {"error": "modo desconhecido"}
        r = instance.launch(to)
        if r.get("error"):
            return r
        threading.Timer(1.2, lambda: self.window_hooks.get("quit", lambda: os._exit(0))()).start()
        return {"ok": True}

    def redist_bundle(self, bid: str) -> dict:
        b = next((x for x in self.redists.presets["bundles"] if x["id"] == bid), None)
        if not b:
            return {"error": "Kit desconhecido"}
        if not self.online():
            return {"error": "Sem conexão com a internet"}
        st = {i["id"]: i for i in self.redists.status()["items"]}
        todo = [i for i in b["items"] if st.get(i, {}).get("state") != "installed"]
        if not todo:
            return {"ok": True, "queued": 0}

        def run(cb, cancel):
            n = len(todo)
            for k, rid in enumerate(todo):
                if cancel.is_set():
                    raise CancelledError()

                def sub(p, k=k):
                    frac = (k + max(0.0, p.fraction)) / n if p.fraction >= 0 else (k + 0.5) / n
                    cb(Progress(p.stage, frac, f"[{k + 1}/{n}] {p.detail}"))
                try:
                    self.redists.install(rid, sub, cancel)
                except CancelledError:
                    raise
                except Exception as e:
                    log.warning("redist %s: %s", rid, e)
                    self.notify("error", f"Redist {rid} falhou", str(e))
            return {"count": n}
        return self._run_job(f"redist:bundle:{bid}", b["title"], "redist", run)

    def window_cmd(self, cmd: str, body: dict | None = None) -> dict:
        body = body or {}
        if cmd == "notify_ui":
            self._push({"type": "ui", "ui": body.get("ui") or {}})
            return {"ok": True}
        if body.get("target") == "terminal":
            cmd = "terminal_" + cmd
        fn = self.window_hooks.get(cmd)
        if not fn:
            return {"error": "indisponível", "native": bool(self.window_hooks)}
        try:
            r = fn(body) if cmd.endswith("resize") or cmd in ("fullscreen", "frame") or cmd.startswith("ctx") else fn()
            return {"ok": True, **(r if isinstance(r, dict) else {})}
        except Exception as e:
            return {"error": str(e)}

    BACKUP_DIRS = ("data", "themes")
    BACKUP_EXTRA = ("data/cache/covers", "data/cache/meta")
    BACKUP_SKIP = ("data/cache/", "data/tools/", "data/bin/", "data/updates/", "data/pfx/")

    def backup_export(self, dest: str | None = None) -> dict:
        stamp = time.strftime("%Y-%m-%d_%H%M")
        if dest:
            d = Path(dest)
            out = d if d.suffix.lower() == ".zip" else d / f"ludrix-backup-{stamp}.zip"
        else:
            out = paths.UPDATES / "backup" / f"ludrix-backup-{stamp}.zip"
        out.parent.mkdir(parents=True, exist_ok=True)
        n = 0
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            for rel in self.BACKUP_DIRS + self.BACKUP_EXTRA:
                base = paths.ROOT / rel
                if not base.exists():
                    continue
                for f in base.rglob("*"):
                    relp = f.relative_to(paths.ROOT).as_posix()
                    if not f.is_file() or f.suffix in (".tmp", ".log") or "webview" in f.parts:
                        continue
                    if rel == "data" and relp.startswith(self.BACKUP_SKIP):
                        continue
                    z.write(f, relp)
                    n += 1
            z.writestr("ludrix-backup.json", json.dumps({"version": self.updates.status()["current"].get("version"), "at": time.time(), "files": n}, ensure_ascii=False))
        return {"ok": True, "path": str(out), "size": out.stat().st_size, "files": n}

    def backup_import(self, path: str | None = None) -> dict:
        if not path:
            if not self.pick_file:
                return {"error": "Informe o caminho do .zip"}
            path = self.pick_file(str(paths.UPDATES / "backup"), "archive")
            if not path:
                return {"cancel": True}
        p = Path(path)
        if not p.exists() or not zipfile.is_zipfile(p):
            return {"error": "Isso não é um .zip válido"}
        with zipfile.ZipFile(p) as z:
            names = z.namelist()
            if "ludrix-backup.json" not in names and not any(x.startswith("data/") for x in names):
                return {"error": "Esse .zip não parece um backup do Ludrix (não tem data/ nem ludrix-backup.json)"}
            ok_roots = tuple(self.BACKUP_DIRS + self.BACKUP_EXTRA + ("cache/covers", "cache/meta"))
            n = 0
            for name in names:
                if name.endswith("/") or name == "ludrix-backup.json" or not name.startswith(ok_roots) or ".." in name:
                    continue
                dest_name = "data/" + name if name.startswith("cache/") else name
                target = (paths.ROOT / dest_name).resolve()
                if paths.ROOT.resolve() not in target.parents:
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(z.read(name))
                n += 1
        self.store.set_config(pending_restart=[])
        threading.Timer(1.2, lambda: self.restart_app()).start()
        return {"ok": True, "files": n, "restart": True}

    def restart_app(self) -> dict:
        import subprocess
        import sys
        cmd = [sys.executable] if paths.FROZEN else [sys.executable, str(paths.APP / "main.py")]
        flags = 0x00000008 if os.name == "nt" else 0
        try:
            subprocess.Popen(cmd, cwd=str(paths.ROOT), creationflags=flags, close_fds=True)
        except Exception as e:
            return {"error": str(e)}
        threading.Timer(0.6, lambda: self.window_hooks.get("quit", lambda: os._exit(0))()).start()
        return {"ok": True}

    def gamemode_run(self) -> dict:
        return self.gamemode.optimize()

    def gamemode_stop(self) -> dict:
        r = self.gamemode.restore()
        if self._quiet and not self.sessions.active:
            self.set_quiet(False)
        return r

    def notify(self, kind: str, title: str, text: str = "", key: str = "", action: str = ""):
        n = {"id": f"{int(time.time() * 1000)}-{kind}", "kind": kind, "title": title, "text": text, "key": key, "action": action,
             "at": time.time(), "read": False}
        lst = [x for x in (self.store.config.get("notifications") or []) if not (x.get("key") and x.get("key") == key and x.get("kind") == kind)]
        lst.append(n)
        extra = {}
        if key and kind == "repack":
            extra = {"notif_seen": [k for k in self.store.config.get("notif_seen") or [] if k != key],
                     "notif_hidden": [k for k in self.store.config.get("notif_hidden") or [] if k != key]}
        self.store.set_config(notifications=lst[-60:], **extra)
        self._push({"type": "notify", **n})
        return n

    def notifications(self) -> list[dict]:
        out = list(self.store.config.get("notifications") or [])
        seen = set(self.store.config.get("notif_seen") or [])
        hidden = set(self.store.config.get("notif_hidden") or [])
        for k, info in list(self.store.library.items()):
            if info.get("repack_state") == "pending" and k not in hidden and not any(x.get("key") == k and x.get("kind") == "repack" for x in out):
                out.append({"id": "repack-" + k, "kind": "repack", "title": f"{info.get('title')}: instalador pendente", "text": "Repack baixado — abra o setup pelo launcher.", "key": k, "at": info.get("installed_at", 0), "read": k in seen})
        out.sort(key=lambda x: -x.get("at", 0))
        return out

    def notif_ack(self, nid: str | None, clear: bool = False) -> dict:
        lst = list(self.store.config.get("notifications") or [])
        pend = [k for k, info in self.store.library.items() if info.get("repack_state") == "pending"]
        seen = list(self.store.config.get("notif_seen") or [])
        hidden = list(self.store.config.get("notif_hidden") or [])
        if clear:
            lst = []
            hidden = sorted(set(hidden) | set(pend))
        else:
            for x in lst:
                if nid is None or x.get("id") == nid:
                    x["read"] = True
            keys = pend if nid is None else [k for k in pend if nid in ("repack-" + k,)]
            seen = sorted(set(seen) | set(keys))
        self.store.set_config(notifications=lst, notif_seen=seen, notif_hidden=hidden)
        return {"ok": True}

    def run_repack(self, key: str, force: bool = False) -> dict:
        info = self.store.get(key)
        if not info or not info.get("repack"):
            return {"error": "Esse item não é um repack pendente"}
        if info.get("disc"):
            return self._run_disc(key, info, force)
        setup = Path(info["repack"])
        if not setup.exists():
            return {"error": f"Instalador não encontrado: {setup}"}

        waiter = self._launch_elevated(setup)
        if isinstance(waiter, dict):

            self.open_path(str(setup.parent))
            return {"error": waiter["error"] + " — abri a pasta; rode o setup por lá e depois clique em 'Procurar instalação agora'."}
        self.store.update(key, repack_state="installing")
        self.act(f"Instalando {info.get('title')} (setup aberto)…")

        def watch():
            t0 = time.time()
            before = self._snapshot_program_dirs()
            elapsed = self._wait_setup(waiter, None, t0, info.get("title", ""))
            self.act("")
            found = self._find_repack_install(info, before, t0)
            if found:
                real = self._repack_found(key, info, found)
                self._push({"type": "done", "key": key, "title": info.get("title", ""), "kind": "repack", "exes": [str(x) for x in real[:8]], "dir": str(found)})
                self.notify("info", f"{info.get('title')} instalado", f"Encontrado em {found}", key=key)
            elif elapsed < 90:
                self.store.update(key, repack_state="pending")
                self.notify("repack", f"{info.get('title')}: instalação não concluída", "O instalador fechou antes de terminar. Clique em Instalar para tentar de novo.", key=key)
            else:
                self.store.update(key, repack_state="pending")
                self.notify("repack", f"{info.get('title')}: não achei a pasta instalada", "O setup fechou mas não encontrei o jogo. Use 'Trocar executável…' pra apontar o .exe.", key=key)
        threading.Thread(target=watch, daemon=True).start()
        return {"ok": True}

    def _run_disc(self, key: str, info: dict, force: bool = False) -> dict:
        if os.name != "nt":
            return {"error": "Montar disco só funciona no Windows"}
        if info.get("repack_state") == "installing":
            return {"error": "O instalador desse disco já está aberto"}
        dp = info.get("disc") or {}
        img = Path(dp.get("image") or info.get("repack") or "")
        if not img.exists():
            return {"error": f"Imagem do disco não encontrada: {img}"}
        if img.suffix.lower() in (".mdf", ".nrg", ".ccd"):
            return {"needs_tool": True, "tool_only": True, "image": str(img), "message": f"Imagem {img.suffix.upper().lstrip('.')}: o Windows não monta esse formato sozinho. O WinCDEmu monta — depois abra o instalador pelo disco montado."}
        if dp.get("audio") and not force:
            return {"needs_tool": True, "image": str(img), "message": "Este disco tem faixas de áudio além dos dados. O Windows só monta a parte de dados; se o jogo pedir o CD com música, use o WinCDEmu."}
        title = info.get("title", "")
        self.store.update(key, repack_state="installing")

        def work():
            iso = img
            mounted: Path | None = None
            try:
                if dp.get("convert") or img.suffix.lower() != ".iso":
                    iso = img.with_suffix(".ludrix.iso")
                    if not iso.exists():
                        self.act(f"Convertendo disco de {title}…")
                        if img.suffix.lower() == ".cue":
                            disc.cue_to_iso(img, iso, lambda f: self.act(f"Convertendo disco de {title}… {int(f * 100)}%"))
                        else:
                            cue = img.with_suffix(".cue")
                            if cue.exists():
                                disc.cue_to_iso(cue, iso, lambda f: self.act(f"Convertendo disco de {title}… {int(f * 100)}%"))
                            else:
                                raise ValueError("Esse .bin não tem .cue junto; não sei o formato das faixas")
                self.act(f"Montando disco de {title}…")
                mounted = disc.mount(iso)
                setup = disc.autorun_target(mounted)
                if not setup:
                    raise RuntimeError(f"Nenhum instalador no disco ({mounted})")
                before = self._snapshot_program_dirs()
                t0 = time.time()
                waiter = self._launch_elevated(setup)
                if isinstance(waiter, dict):
                    raise RuntimeError(waiter["error"])
                self.act(f"Instalando {title} (instalador aberto)…")
                elapsed = self._wait_setup(waiter, mounted, t0, title)
                time.sleep(2)
                self.act("")
                found = self._find_repack_install(info, before, t0)
                if found:
                    real = self._repack_found(key, info, found)
                    self._push({"type": "done", "key": key, "title": title, "kind": "repack", "exes": [str(x) for x in real[:8]], "dir": str(found)})
                    self.notify("info", f"{title} instalado", f"Encontrado em {found}", key=key)
                else:
                    self.store.update(key, repack_state="pending")
                    if elapsed < 90:
                        self.notify("repack", f"{title}: instalação não concluída", "O instalador fechou antes de terminar (ou foi fechado). O disco foi desmontado; clique em Instalar para tentar de novo.", key=key)
                    else:
                        self.notify("repack", f"{title}: não achei a pasta instalada", "O instalador fechou mas não encontrei o jogo. Se ele instalou, use 'Já instalei' e aponte o .exe; senão clique em Instalar para tentar de novo.", key=key)
            except Exception as ex:
                self.act("")
                self.store.update(key, repack_state="pending")
                self.notify("error", f"{title}: disco", str(ex)[:200], key=key)
                self._push({"type": "error", "key": key, "title": title, "message": str(ex)[:200]})
            finally:
                if mounted is not None:
                    disc.unmount(iso)
        threading.Thread(target=work, daemon=True).start()
        return {"ok": True, "disc": True}

    def bootstrap_status(self) -> dict:
        return dict(self._boot)

    def bootstrap_run(self):
        if self._boot.get("started"):
            return
        self._boot["started"] = True
        steps = [("Preparando as pastas", self._boot_dirs)]
        if os.name == "nt":
            steps += [("Baixando o descompactador (7-Zip)", self._boot_7z), ("Baixando o motor de torrent", self._boot_aria2),
                      ("Conferindo Visual C++ e DirectX", self._boot_redists), ("Procurando controles", self._boot_pad)]
        steps += [("Lendo a biblioteca", self._boot_library)]
        self._boot.update(n=len(steps), i=0)
        for i, (label, fn) in enumerate(steps):
            self._boot.update(i=i, step=label)
            try:
                fn()
            except Exception as ex:
                log.warning("bootstrap %s: %s", label, ex)
                self._boot["errors"].append(f"{label}: {str(ex)[:120]}")
        self._boot.update(i=len(steps), step="Pronto", done=True)
        if not self.store.config.get("bootstrap_done"):
            self.store.set_config(bootstrap_done=True)

    def _boot_dirs(self):
        paths.ensure_dirs()
        time.sleep(0.3)

    def _boot_7z(self):
        from .installer import ensure_7z
        if not ensure_7z(self.repos.session):
            raise RuntimeError("não consegui baixar o 7-Zip; tento de novo quando precisar")

    def _boot_aria2(self):
        try:
            import libtorrent  # noqa: F401
            return
        except Exception:
            pass
        from .torrent import ensure_aria2
        if not ensure_aria2(self.repos.session):
            raise RuntimeError("não consegui baixar o motor de torrent; tento de novo quando precisar")

    def _boot_redists(self):
        try:
            self.redists_status()
        except Exception:
            pass

    def _boot_pad(self):
        try:
            from . import gamepad
            gamepad.connected_now()
        except Exception:
            pass

    def _boot_library(self):
        for _ in range(60):
            if not self.catalog_state.get("loading"):
                break
            time.sleep(0.25)

    def disc_tool(self) -> dict:
        return {"url": disc.WINCDEMU_URL, "name": "WinCDEmu"}

    @staticmethod
    def _launch_elevated(exe: Path):
        if os.name != "nt":
            from . import compat
            try:
                proc = compat.popen([str(exe)], exe.parent)
            except (RuntimeError, OSError) as e:
                return {"error": str(e)}
            return proc.wait
        import ctypes
        from ctypes import wintypes

        class SEI(ctypes.Structure):
            _fields_ = [("cbSize", wintypes.DWORD), ("fMask", ctypes.c_ulong), ("hwnd", wintypes.HWND), ("lpVerb", wintypes.LPCWSTR),
                        ("lpFile", wintypes.LPCWSTR), ("lpParameters", wintypes.LPCWSTR), ("lpDirectory", wintypes.LPCWSTR), ("nShow", ctypes.c_int),
                        ("hInstApp", wintypes.HINSTANCE), ("lpIDList", ctypes.c_void_p), ("lpClass", wintypes.LPCWSTR), ("hkeyClass", wintypes.HKEY),
                        ("dwHotKey", wintypes.DWORD), ("hIcon", wintypes.HANDLE), ("hProcess", wintypes.HANDLE)]
        sei = SEI()
        sei.cbSize = ctypes.sizeof(SEI)
        sei.fMask = 0x00000040 | 0x00000100
        sei.lpVerb, sei.lpFile, sei.lpDirectory, sei.nShow = "runas", str(exe), str(exe.parent), 1
        if not ctypes.windll.shell32.ShellExecuteExW(ctypes.byref(sei)):
            err = ctypes.GetLastError()
            return {"error": "Você cancelou a permissão de administrador" if err == 1223 else f"Não consegui abrir o instalador (erro {err})"}
        h = sei.hProcess
        if not h:
            w = lambda: time.sleep(30)
            w.pid = 0
            return w

        def wait():
            ctypes.windll.kernel32.WaitForSingleObject(h, 0xFFFFFFFF)
            ctypes.windll.kernel32.CloseHandle(h)
        wait.pid = int(ctypes.windll.kernel32.GetProcessId(h) or 0)
        return wait

    def _wait_setup(self, waiter, drive: Path | None, t0: float, title: str) -> float:
        waiter()
        pid = getattr(waiter, "pid", 0)
        if os.name != "nt":
            return time.time() - t0

        def tick(alive):
            names = sorted({str(p.get("Name") or "") for p in alive})[:2]
            self.act(f"Instalando {title}… ({', '.join(names)})" if names else f"Instalando {title}…")
        return disc.wait_install(pid, drive, t0, tick)

    def finish_repack(self, key: str) -> dict:
        info = self.store.get(key)
        if not info or not info.get("repack"):
            return {"error": "Esse item não é um repack pendente"}
        found = self._find_repack_install(info, {}, 0)
        if not found:
            return {"error": "Pasta instalada não encontrada. Use 'Já instalei' e aponte o .exe."}
        self._repack_found(key, info, found)
        return {"ok": True, "dir": str(found)}

    def _repack_found(self, key: str, info: dict, found: Path) -> list:
        exes = find_executables(found, info.get("title", ""))
        real = [x for x in exes if "unins" not in x.name.lower()]
        self.store.update(key, dir=str(found), exe=str(real[0]) if real else "", repack_state="done")
        if self.store.config.get("auto_metadata"):
            self.queue_meta(key)
        return real

    def _snapshot_program_dirs(self) -> dict[str, float]:
        roots = self._repack_roots()
        out = {}
        for r in roots:
            try:
                for d in r.iterdir():
                    if d.is_dir():
                        out[str(d)] = d.stat().st_mtime
            except OSError:
                pass
        return out

    def _repack_roots(self) -> list[Path]:
        roots = [paths.GAMES]
        gd = self.store.config.get("games_dir")
        if gd:
            roots.append(Path(gd))
        if os.name == "nt":
            for env in ("ProgramFiles", "ProgramFiles(x86)"):
                v = os.environ.get(env)
                if v:
                    roots.append(Path(v))
            import string
            for letter in string.ascii_uppercase:
                for sub in ("Games", "Jogos", "Program Files", "Program Files (x86)", ""):
                    p = Path(f"{letter}:/") / sub if sub else Path(f"{letter}:/")
                    if p.exists() and sub:
                        roots.append(p)
        return list(dict.fromkeys(roots))

    def _find_repack_install(self, info: dict, before: dict[str, float], t0: float) -> Path | None:
        title = info.get("title", "")
        words = [w for w in re.findall(r"[a-z0-9]+", title.lower()) if len(w) > 2]
        best, best_score = None, 0
        for r in self._repack_roots():
            try:
                subs = [d for d in r.iterdir() if d.is_dir()]
            except OSError:
                continue
            for d in subs:
                try:
                    st = d.stat()
                except OSError:
                    continue
                new = str(d) not in before or st.st_mtime >= t0 - 5
                if not new:
                    continue
                if d.resolve() == Path(info.get("dir", "")).resolve():
                    continue
                n = d.name.lower()
                hits = sum(1 for w in words if w in n)
                if not hits:
                    continue
                if not any(d.rglob("*.exe")):
                    continue
                score = hits * 10 + (5 if str(d) not in before else 0)
                if score > best_score:
                    best, best_score = d, score
        return best

    THEME_VARS = ["bg", "bg2", "panel", "card", "card2", "line", "line2", "text", "muted", "muted2", "green", "green2", "red", "amber",
                  "shadow", "glow1", "glow2", "glow3", "ph-from", "ph-to", "img-fade"]

    FACES = {
        "padrao": {"name": "Padrão", "description": "Fundo grafite sólido, blocos retos de cantos curtos, verde-água só no Jogar, nos selos e no contorno do que está selecionado, títulos em caixa-alta espaçada. Nada desfoca, nada pisca: só cor sólida e linha, por isso é a mais leve de todas. Em claro vira branco-gelo. A cor você troca no acento.", "accent": "#22c7a9", "layout": "rail"},
    }
    DEFAULT_FACE = "padrao"

    def faces(self) -> list[dict]:
        return [{"id": k, **v} for k, v in self.FACES.items()]

    def current_face(self) -> str:
        f = self.store.config.get("face") or self.DEFAULT_FACE
        return f if f in self.FACES else self.DEFAULT_FACE

    def _face_of(self, theme_id: str):
        if theme_id in ("dark", "light", "system"):
            return self.current_face(), {"dark": "dark", "light": "light"}.get(theme_id)
        if theme_id in self.FACES:
            return theme_id, None
        m = re.match(r"^([a-z]+)-(dark|light)$", theme_id or "")
        if m and m.group(1) in self.FACES:
            return m.group(1), m.group(2)
        return None

    @staticmethod
    def _face_vars_css(face: str, scheme: str) -> str:
        f = paths.UI / "themes" / face / f"{scheme}.css"
        return f.read_text(encoding="utf-8") if f.exists() else ""

    _SLUG = re.compile(r"^[a-z0-9][a-z0-9._-]{0,60}$")

    def _theme_dir(self, slug: str) -> Path:
        if not self._SLUG.match(slug or "") or ".." in slug:
            raise ValueError("tema inválido")
        return paths.THEMES / slug

    def themes(self) -> list[dict]:
        out: list[dict] = []
        self._migrate_theme_files()
        user = {d.name for d in paths.THEMES.iterdir() if (d / "theme.json").exists()} if paths.THEMES.exists() else set()
        for slug in sorted(user):
            d = self._theme_dir(slug)
            try:
                t = json.loads((d / "theme.json").read_text(encoding="utf-8-sig"))
            except Exception:
                continue
            out.append({"id": "file:" + slug, "name": t.get("name") or slug, "author": t.get("author", ""), "scheme": t.get("scheme", "dark"),
                        "accent": t.get("accent", ""), "layout": t.get("layout", ""), "vars": t.get("vars", {}), "css": bool((d / "extra.css").exists()), "dir": str(d), "builtin": False,
                        "preview": bool(self.theme_preview(d)), "description": t.get("description", ""), "tags": t.get("tags", ""), "category": t.get("category", ""), "icons": t.get("icons", ""), "official": bool(t.get("official"))})
        return out

    def _migrate_theme_files(self):
        for f in list(paths.THEMES.glob("*.css")) if paths.THEMES.exists() else []:
            d = paths.THEMES / f.stem
            d.mkdir(exist_ok=True)
            css = f.read_text(encoding="utf-8", errors="replace")
            vars_ = dict(re.findall(r"--([a-z0-9-]+)\s*:\s*([^;]+);", css))
            scheme = "light" if "color-scheme:light" in css.replace(" ", "") else "dark"
            (d / "theme.json").write_text(json.dumps({"name": f.stem.replace("-", " ").title(), "author": "", "scheme": scheme, "accent": "", "vars": {k: v.strip() for k, v in vars_.items() if k in self.THEME_VARS}}, ensure_ascii=False, indent=1), encoding="utf-8")
            f.unlink()

    @staticmethod
    def _flip_color(c: str, dark_to_light: bool, kind: str) -> str:
        c = (c or "").strip()
        m = re.match(r"^#([0-9a-fA-F]{6})$", c)
        if m:
            r, g, b = (int(m.group(1)[i:i + 2], 16) / 255 for i in (0, 2, 4))
            h, l, s = colorsys.rgb_to_hls(r, g, b)
            if kind == "surface":
                l = 1 - l * 0.32 if dark_to_light else (1 - l) * 0.22
                s = min(s, 0.25)
            elif kind == "ink":
                l = 1 - l
            elif kind == "accent":
                l = max(0.28, l * 0.82) if dark_to_light else min(0.72, l * 1.12 + 0.05)
            r, g, b = colorsys.hls_to_rgb(h, max(0, min(1, l)), s)
            return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))
        m = re.match(r"^rgba?\(([^)]+)\)$", c)
        if m and kind == "line":
            parts = [x.strip() for x in m.group(1).split(",")]
            a = parts[3] if len(parts) > 3 else "1"
            return f"rgba({'20,26,36' if dark_to_light else '235,240,245'},{a})"
        return c

    def _flip_vars(self, v: dict, scheme: str, to: str) -> dict:
        d2l = scheme != "light" and to == "light"
        out = dict(v)
        for k in ("bg", "bg2", "panel", "card", "card2", "ph-from", "ph-to"):
            if v.get(k):
                out[k] = self._flip_color(v[k], d2l, "surface")
        for k in ("text", "muted", "muted2"):
            if v.get(k):
                out[k] = self._flip_color(v[k], d2l, "ink")
        for k in ("line", "line2"):
            if v.get(k):
                out[k] = self._flip_color(v[k], d2l, "line")
        for k in ("green", "green2", "red", "amber"):
            if v.get(k):
                out[k] = self._flip_color(v[k], d2l, "accent")
        if v.get("img-fade") and v.get("bg") and out.get("bg"):
            out["img-fade"] = v["img-fade"].replace(v["bg"], out["bg"])
        if v.get("shadow"):
            out["shadow"] = re.sub(r"rgba\(0,\s*0,\s*0,\s*([\d.]+)\)", lambda m: f"rgba(20,30,50,{min(float(m.group(1)), 0.45) if d2l else float(m.group(1))})", v["shadow"])
        return out

    def theme_css(self, theme_id: str, scheme: str = "") -> str:
        if theme_id.startswith("file:"):
            d = self._theme_dir(theme_id[5:])
            tj = d / "theme.json"
            if not tj.exists():
                return ""
            try:
                t = json.loads(tj.read_text(encoding="utf-8-sig"))
            except Exception:
                return ""
            own = "light" if t.get("scheme") == "light" else "dark"
            eff = scheme if scheme in ("light", "dark") else own
            base = self._face_vars_css("padrao", eff)
            v = t.get("vars", {})
            if eff != own:
                v = t.get("vars_" + eff) or self._flip_vars(v, own, eff)
            css = base + "\n:root{" + "".join(f"--{k}:{self._safe_var(v[k])};" for k in self.THEME_VARS if v.get(k) and self._safe_var(v[k])) + f"color-scheme:{eff};" + "}\n"
            if t.get("wallpaper") or self.theme_wallpaper(theme_id) is not None:
                css += f"body::after{{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background:url('/api/theme/{theme_id}/wallpaper') center/cover no-repeat;opacity:{t.get('wallpaper_opacity', 0.35)}}}\n"
            extra = d / "extra.css"
            if extra.exists():
                x = extra.read_text(encoding="utf-8", errors="replace")

                a, b = x.find("/* ---- parte 1: layout ---- */"), x.find("/* ---- parte 2: visual ---- */")
                if 0 <= a < b:
                    x = x[:a] + x[b:]
                css += self._scope_nav_css(self._glass_compat(self._safe_css(x)), t.get("layout") or "")
            return css
        fs = self._face_of(theme_id)
        if not fs:
            return ""
        face, scheme = fs
        css = self._face_vars_css(face, scheme or "dark")
        fc = paths.UI / "themes" / face / "face.css"
        return css + ("\n" + fc.read_text(encoding="utf-8") if fc.exists() else "")

    @staticmethod
    def _safe_css(css: str) -> str:
        css = css.replace("\x00", "")
        css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
        css = re.sub(r"@import[^;{]*(;|\{[^}]*\})?", "", css, flags=re.I)
        css = re.sub(r"@(namespace|charset|document|-moz-document)[^;{]*(;|\{[^}]*\})?", "", css, flags=re.I)
        css = re.sub(r"(expression|-moz-binding|behavior)\s*[:(][^;}]*", "", css, flags=re.I)

        def url_ok(m):
            raw = m.group(1).strip().strip("'\"").strip()
            low = raw.lower()
            if low.startswith("data:image/") or low.startswith("data:font/") or low.startswith("data:application/font") or low.startswith("data:application/x-font"):
                return m.group(0)
            if re.match(r"^/api/theme/[A-Za-z0-9:_-]+/(wallpaper|file/[A-Za-z0-9_.-]+)$", raw) or re.match(r"^(\./)?(fx/)?[A-Za-z0-9_-]+\.(png|jpe?g|webp|gif|svg|woff2?|ttf)$", raw):
                return m.group(0)
            if raw.startswith("#"):
                return m.group(0)
            return "none"
        css = re.sub(r"url\(\s*([^)]*)\)", url_ok, css, flags=re.I)
        css = re.sub(r"(?<![\w-])(src|image-set|-webkit-image-set)\s*:\s*(https?:|//|file:|ftp:|javascript:)[^;}]*", "", css, flags=re.I)
        return css

    @staticmethod
    def _safe_var(v) -> str:
        v = str(v or "").strip()
        if len(v) > 200 or re.search(r"[;{}<>]|url\s*\(|expression|@import|\\\\", v, re.I):
            return ""
        return v

    @staticmethod
    def _glass_compat(css: str) -> str:
        def dup(m):
            sel, body = m.group(1), m.group(2)
            keep = ";".join(d for d in body.split(";") if re.match(r"\s*(background|backdrop-filter|-webkit-backdrop-filter)\s*:", d))
            if not keep:
                return m.group(0)
            sels = [x.strip() for x in sel.split(",")]
            if not sels or not all(re.search(r"(^|\s)(main\.glass|\.rail(\.glass)?|nav\.rail)$", x) for x in sels):
                return m.group(0)
            layer = ",".join(x + "::before" for x in sels)
            return m.group(0) + layer + "{" + keep + "}" + ",".join(sels) + "{background:transparent!important;backdrop-filter:none!important}"
        return re.sub(r"(?<![\w-])([^@{}]*?)\{([^{}]*)\}", dup, css)

    @staticmethod
    def _scope_nav_css(css: str, layout: str) -> str:
        attr = {"top": '[data-layout=top]', "side": '[data-layout=side]', "bottom": '[data-nav=bottom]', "rail": ':not([data-layout])[data-nav=side]', "": ':not([data-layout])'}.get({"dock": "bottom", "taskbar": "bottom"}.get(layout or "", layout or ""))
        if not attr:
            return css

        def fix(m):
            sels = [x.strip() for x in m.group(1).split(",")]
            out = []
            for sel in sels:
                if "[data-layout" in sel:
                    out.append(sel)
                elif re.search(r"(^|[\s>+~,(])(\.rail|\.rb|\.gpind)(?![\w-])", sel) or re.search(r"body\[data-nav\]", sel):
                    sel = re.sub(r"^html\s+body\[data-nav\]\s*", "", sel)
                    sel = re.sub(r"^body\b", "", sel).strip()
                    out.append((f"body{attr} {sel}" if ".gpind" in sel else f"html body{attr}>#app {sel}").strip())
                else:
                    out.append(sel)
            return ",".join(out) + "{"

        css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
        return re.sub(r"(?<![\w-])([^@{}]*?)\{", lambda m: fix(m) if m.group(1).strip() else m.group(0), css)

    def theme_json(self, tid: str) -> dict:
        if not tid.startswith("file:"):
            return {}
        d = self._theme_dir(tid[5:])
        try:
            t = json.loads((d / "theme.json").read_text(encoding="utf-8-sig"))
        except Exception:
            return {}
        t["extra_css"] = (d / "extra.css").read_text(encoding="utf-8", errors="replace") if (d / "extra.css").exists() else ""
        t["has_wallpaper"] = self.theme_wallpaper(tid) is not None
        return t

    @staticmethod
    def theme_preview(d: Path) -> Path | None:
        for n in ("preview.png", "preview.jpg", "preview.webp", "thumb.png"):
            if (d / n).exists():
                return d / n
        return None

    def theme_preview_path(self, theme_id: str) -> Path | None:
        if theme_id.startswith("file:"):
            p = self.theme_preview(self._theme_dir(theme_id[5:]))
            if p:
                return p
        try:
            return self._theme_mock_preview(theme_id)
        except Exception as e:
            log.debug("mock preview %s: %s", theme_id, e)
            return None

    def theme_snapshot(self, tid: str, data: str) -> dict:
        import base64
        if not data.startswith("data:image"):
            return {"error": "imagem inválida"}
        return self._theme_preview_write(tid, base64.b64decode(data.split(",", 1)[1]))

    def _theme_mock_preview(self, theme_id: str) -> Path | None:
        from PIL import Image, ImageDraw
        base_dark = {"bg": "#000000", "bg2": "#0a0a0a", "card": "#161616", "card2": "#222222", "text": "#ffffff", "muted": "#8a8a8a", "line2": "#2a2a2a"}
        base_light = {"bg": "#ffffff", "bg2": "#f5f5f5", "card": "#e9e9e9", "card2": "#dcdcdc", "text": "#000000", "muted": "#707070", "line2": "#d0d0d0"}
        scheme, accent, layout, v, stamp, vs = "dark", self.store.config.get("accent") or "", "", {}, "builtin", {}
        fs = self._face_of(theme_id)
        if fs:
            face, sch = fs
            info = self.FACES[face]
            accent, layout, scheme = accent or info["accent"], {"rail": "side", "bottom": ""}.get(info["layout"], info["layout"]), sch or "split"
            for s_ in ("dark", "light"):
                css = self._face_vars_css(face, s_)
                vs[s_] = {k: val.strip() for k, val in re.findall(r"--([a-z0-9-]+)\s*:\s*([^;]+);", css) if k in self.THEME_VARS}
            stamp = face + "-" + "-".join(str(int((paths.UI / "themes" / face / n).stat().st_mtime)) for n in ("dark.css", "light.css", "face.css") if (paths.UI / "themes" / face / n).exists())
            if scheme != "split":
                v = dict(vs[scheme])
        elif theme_id.startswith("file:"):
            d = self._theme_dir(theme_id[5:])
            tj = d / "theme.json"
            if not tj.exists():
                return None
            t = json.loads(tj.read_text(encoding="utf-8-sig"))
            scheme, accent, layout, v = t.get("scheme", "dark"), t.get("accent") or accent, t.get("layout", ""), t.get("vars") or {}
            stamp = str(int(tj.stat().st_mtime))
        out = paths.CACHE / "theme_prev" / f"{re.sub(r'[^a-z0-9]+', '-', theme_id.lower())}-{stamp}-{accent.strip('#')}.png"
        if out.exists():
            return out
        out.parent.mkdir(parents=True, exist_ok=True)

        def col(name, base):
            raw = v.get(name) or base[name]
            m = re.match(r"rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)", raw)
            if m:
                return tuple(int(x) for x in m.groups())
            raw = raw.strip()
            if re.match(r"^#[0-9a-fA-F]{6}$", raw):
                return tuple(int(raw[i:i + 2], 16) for i in (1, 3, 5))
            return tuple(int(base[name][i:i + 2], 16) for i in (1, 3, 5))

        def draw_half(img, dr, x0, W, H, sch):
            base = base_light if sch == "light" else base_dark
            if vs:
                v.clear()
                v.update(vs["light" if sch == "light" else "dark"])
            bg, bg2, card, text, muted = col("bg", base), col("bg2", base), col("card", base), col("text", base), col("muted", base)
            ac = tuple(int(accent[i:i + 2], 16) for i in (1, 3, 5)) if re.match(r"^#[0-9a-fA-F]{6}$", accent) else text
            dr.rectangle([x0, 0, x0 + W, H], fill=bg)
            line = col("line2", base)
            cx, cy, cw, ch = x0 + 14, 14, W - 28, H - 28
            if layout == "side":
                dr.rectangle([x0, 0, x0 + 26, H], fill=bg2)
                dr.line([x0 + 26, 0, x0 + 26, H], fill=line)
                dr.rectangle([x0 + 8, 8, x0 + 18, 18], fill=ac)
                for i in range(6):
                    dr.rectangle([x0 + 9, 32 + i * 16, x0 + 17, 40 + i * 16], fill=text if i == 1 else muted)
                dr.rectangle([x0, 30 + 16, x0 + 2, 42 + 16], fill=ac)
                cx, cw, cy = x0 + 34, W - 40, 10
            elif layout == "dock":
                dr.rounded_rectangle([x0 + W // 2 - 60, H - 22, x0 + W // 2 + 60, H - 6], 4, fill=bg2, outline=line)
                for i in range(7):
                    dr.rectangle([x0 + W // 2 - 52 + i * 16, H - 18, x0 + W // 2 - 44 + i * 16, H - 10], fill=ac if i == 1 else muted)
                ch = H - 38
            elif layout == "top":
                dr.rectangle([x0, 0, x0 + W, 18], fill=bg2)
                dr.line([x0, 18, x0 + W, 18], fill=line)
                dr.rectangle([x0 + 8, 5, x0 + 16, 13], fill=ac)
                for i in range(5):
                    dr.rectangle([x0 + 26 + i * 22, 7, x0 + 40 + i * 22, 10], fill=text if i == 0 else muted)
                dr.rectangle([x0 + 26, 16, x0 + 40, 18], fill=ac)
                cy, ch = 26, H - 40
            else:
                dr.rectangle([x0, H - 18, x0 + W, H], fill=bg2)
                dr.line([x0, H - 18, x0 + W, H - 18], fill=line)
                for i in range(7):
                    dr.rectangle([x0 + W // 2 - 60 + i * 18, H - 13, x0 + W // 2 - 52 + i * 18, H - 5], fill=ac if i == 1 else muted)
                dr.rectangle([x0 + W // 2 - 42, H - 18, x0 + W // 2 - 34, H - 16], fill=ac)
                ch = H - 32
            bh = int(ch * 0.44)
            for yy in range(bh):
                k = yy / max(1, bh - 1)
                cc = tuple(int(col("card2", base)[i] * (1 - k) + bg[i] * k) for i in range(3))
                dr.line([cx - 14 if layout != "side" else cx - 8, cy - 14 + yy, x0 + W, cy - 14 + yy], fill=cc)
            dr.rectangle([cx, cy + bh - 40, cx + 14, cy + bh - 38], fill=ac)
            dr.rectangle([cx, cy + bh - 32, cx + cw * 0.42, cy + bh - 20], fill=text)
            dr.rectangle([cx, cy + bh - 14, cx + 22, cy + bh - 7], fill=ac)
            dr.rectangle([cx + 26, cy + bh - 14, cx + 48, cy + bh - 7], outline=line)
            top = cy + bh + 6
            dr.rectangle([cx, top + 2, cx + 8, top + 3], fill=ac)
            dr.rectangle([cx + 12, top, cx + 12 + cw * 0.3, top + 5], fill=text)
            top += 12
            n = 6
            gap = 5
            cw_ = (cw - gap * (n - 1)) / n
            hh = min(ch - (top - cy) - 2, cw_ * 1.45)
            for i in range(n):
                x = cx + i * (cw_ + gap)
                dr.rectangle([x, top, x + cw_, top + hh], fill=card if i % 2 else col("card2", base))
                dr.rectangle([x, top + hh + 3, x + cw_ * 0.7, top + hh + 5], fill=muted)

        W, H = 320, 200
        img = Image.new("RGB", (W, H))
        dr = ImageDraw.Draw(img)
        if scheme == "split":
            draw_half(img, dr, 0, W // 2, H, "dark")
            draw_half(img, dr, W // 2, W // 2, H, "light")
        else:
            draw_half(img, dr, 0, W, H, scheme)
        img.save(out, optimize=True)
        return out

    def theme_preview_set(self, tid: str, path: str | None) -> dict:
        if not tid.startswith("file:"):
            return {"error": "Só temas personalizados"}
        if not path:
            if not self.pick_file:
                return {"error": "Informe o caminho da imagem"}
            path = self.pick_file(str(Path.home() / "Pictures"), "image")
            if not path:
                return {"ok": False}
        return self._theme_preview_write(tid, Path(path).read_bytes())

    def _theme_preview_write(self, tid: str, raw: bytes) -> dict:
        from io import BytesIO
        from PIL import Image
        d = self._theme_dir(tid[5:])
        if not d.is_dir():
            return {"error": "Tema não encontrado"}
        try:
            img = Image.open(BytesIO(raw))
            img.load()
            img = img.convert("RGB")
            img.thumbnail((640, 400))
            for old in ("preview.jpg", "preview.webp", "thumb.png"):
                (d / old).unlink(missing_ok=True)
            img.save(d / "preview.png", optimize=True)
        except Exception as e:
            return {"error": f"Imagem inválida: {e}"}
        return {"ok": True}

    def theme_file(self, theme_id: str, rel: str) -> Path | None:
        d = self._theme_dir(theme_id[5:]).resolve()
        p = (d / rel).resolve()
        if d not in p.parents or not p.is_file() or p.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".woff2", ".woff", ".ttf"):
            return None
        return p

    def theme_wallpaper(self, theme_id: str) -> Path | None:
        d = self._theme_dir(theme_id[5:])
        for ext in (".jpg", ".jpeg", ".png", ".webp"):
            p = d / ("wallpaper" + ext)
            if p.exists():
                return p
        return None

    def theme_save(self, data: dict) -> dict:
        name = (data.get("name") or "Meu tema").strip()
        tid = data.get("id", "")
        slug = tid[5:] if tid.startswith("file:") else re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "tema"
        d = self._theme_dir(slug)
        d.mkdir(parents=True, exist_ok=True)
        cur = {}
        if (d / "theme.json").exists():
            try:
                cur = json.loads((d / "theme.json").read_text(encoding="utf-8-sig"))
            except Exception:
                cur = {}
        cur.update({"name": name, "author": data.get("author", cur.get("author", "")), "scheme": data.get("scheme", cur.get("scheme", "dark")),
                    "accent": data.get("accent", cur.get("accent", "")), "vars": {k: v for k, v in (data.get("vars") or cur.get("vars") or {}).items() if k in self.THEME_VARS and v}})
        if "wallpaper_opacity" in data:
            cur["wallpaper_opacity"] = float(data["wallpaper_opacity"])
        if "layout" in data:
            cur["layout"] = {"dock": "bottom", "taskbar": "bottom"}.get(data["layout"], data["layout"]) if data["layout"] in ("top", "side", "dock", "taskbar", "bottom", "rail") else ""
        (d / "theme.json").write_text(json.dumps(cur, ensure_ascii=False, indent=1), encoding="utf-8")
        if "extra_css" in data:
            if data["extra_css"].strip():
                (d / "extra.css").write_text(data["extra_css"], encoding="utf-8")
            else:
                (d / "extra.css").unlink(missing_ok=True)
        return {"ok": True, "id": "file:" + slug}

    def theme_reload(self, tid: str = "") -> dict:
        if tid:
            if tid.startswith("file:") and not (self._theme_dir(tid[5:]) / "theme.json").exists():
                return {"error": "Tema não encontrado"}
            self.store.set_config(theme=tid)
        self._push({"type": "theme_reload", "theme": tid})
        return {"ok": True}

    def theme_delete(self, tid: str) -> dict:
        if not tid.startswith("file:"):
            return {"error": "Temas embutidos não podem ser apagados"}
        d = self._theme_dir(tid[5:])
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
        if self.store.config.get("theme") == tid:
            self.store.set_config(theme="system")
        return {"ok": True}

    THEME_FILES = re.compile(r"^(theme\.json|extra\.css|wallpaper\.(jpg|jpeg|png|webp)|preview\.(png|jpg|jpeg|webp)|thumb\.png|LEIA-?ME\.txt|README\.(txt|md)|[A-Za-z0-9_.-]+\.(woff2|woff|ttf|png|webp|svg))$", re.I)

    def theme_export(self, tid: str, fmt: str = "lxtheme") -> dict:
        if not tid.startswith("file:"):
            return {"error": "Só temas personalizados"}
        d = self._theme_dir(tid[5:])
        if not d.is_dir():
            return {"error": "Tema não encontrado"}
        fmt = "zip" if fmt == "zip" else "lxtheme"
        dest = Path.home() / "Downloads" if (Path.home() / "Downloads").exists() else paths.ROOT
        out = dest / f"{d.name}.{fmt}"
        self._zip_themes(out, [d])
        return {"ok": True, "path": str(out)}

    def _zip_themes(self, out: Path, dirs: list) -> None:
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            for d in dirs:
                for f in sorted(d.iterdir()):
                    if f.is_file() and self.THEME_FILES.match(f.name):
                        z.write(f, f"{d.name}/{f.name}")

    def theme_export_all(self, fmt: str = "zip") -> dict:
        dirs = [d for d in sorted(paths.THEMES.iterdir()) if d.is_dir() and (d / "theme.json").exists()]
        if not dirs:
            return {"error": "Nenhum tema personalizado pra exportar"}
        dest = Path.home() / "Downloads" if (Path.home() / "Downloads").exists() else paths.ROOT
        out = dest / f"ludrix-temas.{'lxtheme' if fmt == 'lxtheme' else 'zip'}"
        self._zip_themes(out, dirs)
        return {"ok": True, "path": str(out), "count": len(dirs)}

    def theme_import(self, path: str | list | None) -> dict:
        files = [str(x).strip() for x in path] if isinstance(path, list) else [x.strip() for x in re.split(r"[\r\n;|]+", str(path or "")) if x.strip()]
        if not files:
            if not self.pick_file:
                return {"error": "Informe o caminho do .lxtheme/.zip"}
            picked = self.pick_files(str(Path.home() / "Downloads"), "theme") if self.pick_files else None
            if picked is None:
                picked = [self.pick_file(str(Path.home() / "Downloads"), "theme")]
            files = [str(x) for x in picked if x]
            if not files:
                return {"ok": False}
        if len(files) == 1:
            return self._theme_import_one(files[0])
        imported, errors = [], []
        for f in files:
            r = self._theme_import_one(f)
            if r.get("error"):
                errors.append(f"{Path(f).name}: {r['error']}")
            else:
                imported += r.get("themes") or []
        if not imported:
            return {"error": "; ".join(errors) or "Nenhum tema válido"}
        name = f"{len(imported)} temas ({', '.join(x['name'] for x in imported[:4])}{'…' if len(imported) > 4 else ''})"
        if errors:
            name += f" · {len(errors)} arquivo{'s' if len(errors) > 1 else ''} ignorado{'s' if len(errors) > 1 else ''}"
        return {"ok": True, "id": imported[0]["id"], "name": name, "count": len(imported), "themes": imported, "errors": errors}

    def _theme_import_one(self, path: str) -> dict:
        p = Path(path)
        if not p.exists():
            return {"error": "Arquivo não encontrado"}
        if p.suffix.lower() == ".json":
            t = json.loads(p.read_text(encoding="utf-8-sig"))
            r = self.theme_save({"name": t.get("name", p.stem), "scheme": t.get("scheme", "dark"), "accent": t.get("accent", ""), "layout": t.get("layout", ""), "vars": t.get("vars", {})})
            return {**r, "name": t.get("name", p.stem), "count": 1, "themes": [{"id": r.get("id", ""), "name": t.get("name", p.stem)}]}
        if not zipfile.is_zipfile(p):
            return {"error": "Isso não é um .lxtheme/.zip válido"}
        imported = []
        if p.stat().st_size > 80 * 1024 * 1024:
            return {"error": "Arquivo de tema grande demais (máximo 80 MB)"}
        official = lxsign.is_signed(p)
        with zipfile.ZipFile(p) as z:
            infos = [i for i in z.infolist() if not i.is_dir()]
            if len(infos) > 400 or sum(i.file_size for i in infos) > 160 * 1024 * 1024 or any(i.file_size > 40 * 1024 * 1024 for i in infos):
                return {"error": "Arquivo de tema fora do limite (muitos arquivos ou grande demais)"}
            names = [i.filename for i in infos if ".." not in i.filename and not i.filename.startswith(("/", "\\"))]
            tjs = [n for n in names if n.rsplit("/", 1)[-1].lower() == "theme.json"]
            if not tjs:
                return {"error": "Esse arquivo não tem theme.json (esqueleto: <pasta-do-tema>/theme.json + extra.css + preview.png…)"}
            for tj in tjs:
                folder = tj[:-len("theme.json")]
                try:
                    t = json.loads(z.read(tj).decode("utf-8-sig"))
                except Exception:
                    continue
                slug = re.sub(r"[^a-z0-9]+", "-", (folder.strip("/").rsplit("/", 1)[-1] or t.get("name") or p.stem).lower()).strip("-") or p.stem
                d = paths.THEMES / slug
                d.mkdir(parents=True, exist_ok=True)
                for n in names:
                    if not n.startswith(folder):
                        continue
                    base = n[len(folder):]
                    if "/" in base:
                        if base.startswith("fx/") and re.match(r"^fx/[A-Za-z0-9_.-]+\.(png|webp|gif|svg)$", base, re.I) and base.count("/") == 1:
                            (d / "fx").mkdir(exist_ok=True)
                            (d / base).write_bytes(z.read(n))
                        continue
                    if base and self.THEME_FILES.match(base):
                        (d / base).write_bytes(z.read(n))
                self._theme_mark_official(d, official)
                imported.append({"id": "file:" + slug, "name": t.get("name", slug)})
        if not imported:
            return {"error": "Nenhum tema válido dentro do arquivo"}
        first = imported[0]
        return {"ok": True, "id": first["id"], "name": first["name"] if len(imported) == 1 else f"{len(imported)} temas ({', '.join(x['name'] for x in imported[:4])}{'…' if len(imported) > 4 else ''})", "count": len(imported), "themes": imported}

    @staticmethod
    def _theme_mark_official(d: Path, official: bool):
        tj = d / "theme.json"
        try:
            t = json.loads(tj.read_text(encoding="utf-8-sig"))
        except Exception:
            return
        if bool(t.get("official")) == official:
            return
        if official:
            t["official"] = True
        else:
            t.pop("official", None)
        tj.write_text(json.dumps(t, ensure_ascii=False, indent=1), encoding="utf-8")

    def theme_wallpaper_set(self, tid: str, path: str | None) -> dict:
        if not tid.startswith("file:"):
            return {"error": "Crie um tema personalizado primeiro"}
        if not path:
            if not self.pick_file:
                return {"error": "Informe o caminho da imagem"}
            path = self.pick_file(str(Path.home() / "Pictures"), "image")
            if not path:
                return {"ok": False}
        d = self._theme_dir(tid[5:])
        d.mkdir(parents=True, exist_ok=True)
        for ext in (".jpg", ".jpeg", ".png", ".webp"):
            (d / ("wallpaper" + ext)).unlink(missing_ok=True)
        from PIL import Image
        img = Image.open(path).convert("RGB")
        img.thumbnail((2560, 1600))
        img.save(d / "wallpaper.jpg", "JPEG", quality=82)
        return {"ok": True}

    def cache_info(self) -> dict:
        return {
            "web": paths.dir_size(paths.CACHE_WEB), "thumbs": paths.dir_size(paths.CACHE_THUMBS),
            "covers": paths.dir_size(paths.CACHE_COVERS) + paths.dir_size(paths.CACHE_SHOTS), "meta": paths.dir_size(paths.CACHE_META),
            "downloads": paths.dir_size(paths.DOWNLOADS), "log": paths.LOG_FILE.stat().st_size if paths.LOG_FILE.exists() else 0,
        }

    def clear_cache(self, what: list[str]) -> dict:
        m = {"web": paths.CACHE_WEB, "thumbs": paths.CACHE_THUMBS, "covers": paths.CACHE_COVERS,
             "meta": paths.CACHE_META, "downloads": paths.DOWNLOADS}
        for w in what + (["shots"] if "covers" in what else []):
            d = m.get(w) or (paths.CACHE_SHOTS if w == "shots" else None)
            if d and d.exists():
                busy = {safe_folder_name(j["title"]) for j in self.jobs.values()} if w == "downloads" else set()
                for child in d.iterdir():
                    if child.name in busy:
                        continue
                    shutil.rmtree(child, ignore_errors=True) if child.is_dir() else child.unlink(missing_ok=True)
            if w == "log" and paths.LOG_FILE.exists():
                try:
                    paths.LOG_FILE.write_text("", encoding="utf-8")
                except OSError:
                    pass
        if "web" in what or "meta" in what:
            self.reload_catalog(force="web" in what)
        return self.cache_info()

    def open_url(self, url: str):
        url = (url or "").strip()
        if not re.match(r"^(https?://|magnet:\?)", url, re.I):
            return {"error": "Só links http(s) ou magnet"}
        if url.startswith("magnet:") and os.name == "nt":
            os.startfile(url)
        else:
            webbrowser.open(url)
        return {"ok": True}

    _RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"

    def _autostart_cmd(self) -> str:
        import sys
        if paths.FROZEN:
            return f'"{Path(sys.executable)}" --minimized'
        if paths.APPIMAGE:
            return f'"{paths.APPIMAGE}" --minimized'
        return f'"{Path(sys.executable)}" "{paths.APP / "main.py"}" --minimized'

    def autostart_status(self) -> dict:
        import sys
        enabled, path = False, ""
        try:
            if os.name == "nt":
                import winreg
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, self._RUN_KEY) as k:
                    path, _ = winreg.QueryValueEx(k, "Ludrix")
                    enabled = bool(path)
            else:
                p = Path.home() / ".config" / "autostart" / "ludrix.desktop"
                enabled, path = p.exists(), str(p)
        except Exception:
            pass
        return {"supported": os.name == "nt" or sys.platform.startswith("linux"), "enabled": enabled, "path": path}

    def autostart_sync(self):
        if not self.store.config.get("autostart"):
            return
        try:
            st = self.autostart_status()
            if st["supported"] and (not st["enabled"] or (os.name == "nt" and st["path"] != self._autostart_cmd())):
                self.set_autostart(True)
        except Exception as e:
            log.debug("autostart sync: %s", e)

    def set_autostart(self, enable: bool) -> dict:
        import sys
        enable = bool(enable)
        try:
            if os.name == "nt":
                import winreg
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, self._RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
                    if enable:
                        winreg.SetValueEx(k, "Ludrix", 0, winreg.REG_SZ, self._autostart_cmd())
                    else:
                        try:
                            winreg.DeleteValue(k, "Ludrix")
                        except FileNotFoundError:
                            pass
            elif sys.platform.startswith("linux"):
                p = Path.home() / ".config" / "autostart" / "ludrix.desktop"
                if enable:
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_text(f"[Desktop Entry]\nType=Application\nName=Ludrix\nExec={self._autostart_cmd()}\nX-GNOME-Autostart-enabled=true\n", encoding="utf-8")
                else:
                    p.unlink(missing_ok=True)
            else:
                return {"error": "Só no Windows e Linux"}
        except Exception as e:
            return {"error": f"Não consegui configurar: {e}"}
        self.store.set_config(autostart=enable)
        return {"ok": True, **self.autostart_status()}

    def saves_info(self, key: str, deep: bool = False) -> dict:
        g = self.game_payload(key)
        if not g:
            return {"error": "Jogo não encontrado"}
        loc = self.saves.locate(key, g, deep=deep)
        loc["key"] = key
        loc["title"] = g.get("title", "")
        loc["backups"] = self.saves.list_backups(key)
        loc["native"] = bool(self.pick_file)
        return loc

    def saves_import(self, key: str, source: str | None, dest: str | None) -> dict:
        g = self.game_payload(key)
        if not g:
            return {"error": "Jogo não encontrado"}
        if not dest:
            dest = self.saves.locate(key, g).get("dir")
        if not dest:
            return {"error": "Ainda não sei onde esse jogo salva — use 'Escolher pasta manualmente' primeiro."}
        if not source:
            if not self.pick_file:
                return {"error": "Diálogo nativo indisponível — informe o caminho do save"}
            source = self.pick_file(str(Path.home() / "Downloads"), "save")
            if not source:
                return {"ok": False}
        return self.saves.import_save(key, source, dest)

    def saves_import_folder(self, key: str, dest: str | None) -> dict:
        if not self.pick_folder:
            return {"error": "Diálogo nativo indisponível"}
        try:
            src = self.pick_folder(str(Path.home() / "Downloads"))
        except TypeError:
            src = self.pick_folder()
        if not src:
            return {"ok": False}
        return self.saves_import(key, src, dest)

    def saves_set_dir(self, key: str, folder: str | None) -> dict:
        if not folder:
            if not self.pick_folder:
                return {"error": "Diálogo nativo indisponível — informe o caminho"}
            try:
                folder = self.pick_folder("")
            except TypeError:
                folder = self.pick_folder()
            if not folder:
                return {"ok": False}
        return self.saves.set_manual(key, folder)

    def saves_export(self, key: str, save_dir: str) -> dict:
        g = self.game_payload(key) or {}
        name = safe_folder_name(g.get("title", key)) + "_save_" + time.strftime("%Y%m%d-%H%M") + ".zip"
        dest = Path.home() / "Downloads" / name
        r = self.saves.export_save(key, save_dir, str(dest))
        if r.get("ok"):
            self.open_path(str(dest.parent))
        return r

    def import_cover_path(self, p: str) -> Path | None:
        st = getattr(self, "_import_state", None) or {}
        ok = {g.get("cover_file") for g in ((st.get("result") or {}).get("games") or [])}
        return Path(p) if p and p in ok and Path(p).is_file() else None

    def import_launchers(self) -> list[dict]:
        return importers.list_launchers()

    def import_pick(self, launcher_id: str, mode: str = "") -> dict:
        l = next((x for x in importers.list_launchers() if x["id"] == launcher_id), None)
        if not l:
            return {"error": "Launcher desconhecido"}
        init = l["default_path"] if l["detected"] else ""
        if (mode or l["pick"]) == "file":
            if not self.pick_file:
                return {"native": False}
            init_dir = str(Path(init).parent) if init and not Path(init).is_dir() else init
            return {"native": True, "path": self.pick_file(init_dir, l.get("pick_kind") or "any")}
        if not self.pick_folder:
            return {"native": False}
        try:
            return {"native": True, "path": self.pick_folder(init)}
        except TypeError:
            return {"native": True, "path": self.pick_folder()}

    def import_scan(self, launcher_id: str, path: str, opts: dict | None = None) -> dict:
        st = self._import_state = {"done": False, "msg": "Abrindo…", "result": None}
        importers.PROGRESS = lambda m: st.__setitem__("msg", m)

        def work():
            try:
                st["result"] = self._import_scan_sync(launcher_id, path, opts or {})
            except Exception as e:
                log.exception("import")
                st["result"] = {"error": str(e)}
            finally:
                st["done"] = True
                importers.PROGRESS = None
        threading.Thread(target=work, daemon=True).start()
        return {"async": True}

    def folder_scan(self, path: str | None, mode: str) -> dict:
        if not path:
            if not self.pick_folder:
                return {"error": "Informe o caminho da pasta"}
            try:
                path = self.pick_folder(str(paths.GAMES if mode == "windows" else paths.EMU_GAMES))
            except TypeError:
                path = self.pick_folder()
            if not path:
                return {"ok": False}
        if not Path(path).is_dir():
            return {"error": "Pasta não encontrada"}
        st = self._import_state = {"done": False, "msg": "Abrindo…", "result": None}
        from . import scanner

        def work():
            try:
                prog = lambda m: st.__setitem__("msg", m)
                if mode == "roms":
                    items = scanner.scan_roms(Path(path), self.emu.presets["systems"], prog)
                    have = {x.get("path") for x in (self.store.config.get("rom_files") or [])}
                    dirs = {d for v in (self.store.config.get("rom_dirs") or {}).values() for d in v}
                    for it in items:
                        it["dup"] = it["rom"] in have or any(it["rom"].startswith(d.rstrip("\\/") + os.sep) for d in dirs)
                else:
                    items = scanner.scan_windows(Path(path), prog)
                    have = {str(v.get("exe", "")).lower() for v in list(self.store.library.values())}
                    for it in items:
                        it["dup"] = it["exe"].lower() in have
                emus = self.emu.all_emulators()
                st["result"] = {"games": items, "count": len(items), "path": path, "mode": mode,
                                "emulators": [{"id": k, "title": v.get("title", k), "systems": v.get("systems", []), "installed": bool(self.emu.emu_exe(k))} for k, v in emus.items()]}
            except Exception as e:
                log.exception("folder_scan")
                st["result"] = {"error": str(e)}
            finally:
                st["done"] = True
        threading.Thread(target=work, daemon=True).start()
        return {"async": True, "path": path}

    def folder_apply(self, games: list[dict], mode: str, opts: dict | None = None) -> dict:
        opts = opts or {}
        added = skipped = 0
        keys = []
        for g in games:
            try:
                if mode == "roms":
                    rom = g.get("rom") or ""
                    sid = g.get("system") or opts.get("system") or ""
                    if not rom or not Path(rom).exists() or sid not in self.emu.presets["systems"] or sid == "pc":
                        skipped += 1
                        continue
                    r = self.emu.add_rom_file(rom, sid)
                    self.store.set_installed(r["key"], dir=str(Path(rom).parent), exe=rom, title=r["title"], kind="rom", source="scan")
                    if g.get("title") and g["title"] != r["title"]:
                        self._apply_title(r["key"], g["title"], locked=False)
                    emu = g.get("emulator") or opts.get("emulator")
                    if emu:
                        self._import_prefer_emulator(sid, emu)
                    keys.append(r["key"])
                else:
                    exe = g.get("exe") or ""
                    if not exe or not Path(exe).exists():
                        skipped += 1
                        continue
                    r = self.add_local_game(exe, g.get("title") or None)
                    if not r.get("key"):
                        skipped += 1
                        continue
                    self.store.update(r["key"], source="scan")
                    if g.get("args"):
                        self.set_shortcut(r["key"], None, g["args"])
                    keys.append(r["key"])
                added += 1
            except Exception as ex:
                log.debug("folder_apply %s: %s", g.get("title"), ex)
                skipped += 1
        if mode == "roms" and opts.get("add_dir") and opts.get("path"):
            if opts.get("system"):
                self.emu.add_rom_dir(opts["system"], opts["path"])
            else:

                by_dir: dict[tuple[str, str], int] = {}
                for g in games:
                    if g.get("rom") and g.get("system"):
                        by_dir[(g["system"], str(Path(g["rom"]).parent))] = by_dir.get((g["system"], str(Path(g["rom"]).parent)), 0) + 1
                for (sid, d), n in by_dir.items():
                    if n >= 2 or len(by_dir) == 1:
                        self.emu.add_rom_dir(sid, d)
        if keys and self.store.config.get("auto_metadata"):
            for k in keys:
                self.queue_meta(k)
        self.emu.invalidate_scan()
        return {"ok": True, "added": added, "skipped": skipped}

    def import_poll(self) -> dict:
        st = getattr(self, "_import_state", None) or {"done": True, "result": {"error": "Nada em andamento"}}
        if st["done"]:
            return {"done": True, **(st["result"] or {})}
        return {"done": False, "msg": st["msg"]}

    def _import_scan_sync(self, launcher_id: str, path: str, opts: dict | None = None) -> dict:
        try:
            games = importers.scan(launcher_id, path, opts)
        except Exception as e:
            return {"error": str(e)}
        lib = list(self.store.library.items())
        known_exes = {str(i.get("exe", "")).lower() for _, i in lib}
        known_titles: dict[str, set] = {}
        for k, i in lib:
            sid = i.get("system") or (k.split(":", 2)[1] if k.startswith("rom:") and k.count(":") >= 2 else "pc")
            known_titles.setdefault(str(i.get("title", "")).lower(), set()).add(sid)
        for g in games:
            g["dup"] = bool((g.get("exe") or g.get("rom") or "").lower() in known_exes or (g.get("system") or "pc") in known_titles.get(g["title"].lower(), set()))
            if g.get("rom_dir"):
                g["dup"] = g["rom_dir"] in (self.store.config.get("rom_dirs") or {}).get(g.get("system") or "", [])
            if g.get("kind") == "emulator":
                vid = g.get("emulator") or ""
                ep = self.store.config.get("emu_paths") or {}
                g["dup"] = bool(vid and (ep.get(vid) or self.emu.emu_exe(vid)))
        return {"games": games, "count": len(games)}

    def import_apply(self, games: list[dict]) -> dict:
        st = self._import_state = {"done": False, "msg": "Preparando…", "result": None}
        if self.store.library:
            self.library_backup_now()

        def work():
            try:
                st["result"] = self._import_apply_sync(games, lambda m: st.__setitem__("msg", m))
            except Exception as e:
                log.exception("import apply")
                st["result"] = {"error": str(e)}
            finally:
                st["done"] = True
        threading.Thread(target=work, daemon=True).start()
        return {"async": True}

    def _import_apply_sync(self, games: list[dict], prog=lambda m: None) -> dict:
        added, skipped = 0, 0
        self._imp_skipped = []
        games = sorted(games, key=lambda g: (0 if g.get("kind") == "emulator" else 1 if g.get("rom_dir") else 2, -float(g.get("last_played") or 0), -float(g.get("playtime") or 0)))
        with self.store.batch():
            for i, g in enumerate(games):
                added, skipped = self._import_one(g, added, skipped, prog, i, len(games))
        self.emu.invalidate_scan()
        self.images._thumbs.t = 0.0
        self.covers._names_t = 0.0
        self.meta.touch()
        return {"ok": True, "added": added, "skipped": skipped, "skipped_items": self._imp_skipped[:200]}

    def _import_one(self, g: dict, added: int, skipped: int, prog, i: int, n: int) -> tuple[int, int]:
        if i % 5 == 0:
            prog(f"Adicionando {i + 1} de {n}: {g.get('title', '')}")
        try:
            if g.get("kind") == "emulator":
                if self._import_emulator(g):
                    added += 1
                else:
                    skipped = self._imp_skip(g, skipped, "Emulador sem executável válido" if not g.get("exe") or not Path(g["exe"]).exists() else "Emulador não reconhecido")
            elif g.get("rom_dir"):
                if not g.get("system") or not Path(g["rom_dir"]).is_dir():
                    skipped = self._imp_skip(g, skipped, "Console não identificado" if not g.get("system") else "Pasta não existe", g["rom_dir"])
                    return added, skipped
                self.emu.add_rom_dir(g["system"], g["rom_dir"])
                added += 1
            elif g.get("rom"):
                if not Path(g["rom"]).exists():
                    skipped = self._imp_skip(g, skipped, "Arquivo não existe", g["rom"])
                    return added, skipped
                r = self.add_rom_file(g["rom"], g.get("system"))
                if r.get("error"):
                    skipped = self._imp_skip(g, skipped, r["error"], g["rom"])
                    return added, skipped
                upd = {k: g[k] for k in ("playtime", "last_played") if g.get(k)}
                upd["source"] = g.get("source", "")
                if g.get("year"):
                    upd["year"] = g["year"]
                self.store.update(r["key"], **upd)
                if g.get("title") and (g["title"] != r.get("title") or g.get("source") == "playnite"):
                    self._apply_title(r["key"], g["title"], locked=g.get("source") == "playnite")
                if g.get("favorite"):
                    self._import_fav(r["key"])
                if g.get("emulator") and g.get("system"):
                    self._import_prefer_emulator(g["system"], g["emulator"])
                self._import_cover(r["key"], g)
                added += 1
            elif not g.get("exe") and g.get("dir") and Path(g["dir"]).is_dir():
                exes = find_executables(Path(g["dir"]), g["title"])
                if not exes:
                    skipped = self._imp_skip(g, skipped, "Nenhum executável na pasta", g["dir"])
                    return added, skipped
                r = self.add_local_game(str(exes[0]), g["title"])
                if r.get("key"):
                    self.store.update(r["key"], playtime=g.get("playtime", 0), last_played=g.get("last_played", 0), source=g.get("source", ""), **({"year": g["year"]} if g.get("year") else {}))
                    if g.get("source") == "playnite":
                        self._apply_title(r["key"], g["title"], locked=True)
                    self._import_cover(r["key"], g)
                    if g.get("favorite"):
                        self._import_fav(r["key"])
                added += 1
            elif g.get("exe"):
                exe = g["exe"]
                if "://" not in exe and not Path(exe).exists():

                    if g.get("dir") and Path(g["dir"]).is_dir():
                        exes = find_executables(Path(g["dir"]), g["title"])
                        if exes:
                            exe = str(exes[0])
                    if not Path(exe).exists():
                        skipped = self._imp_skip(g, skipped, "Arquivo não existe", exe)
                        return added, skipped
                if "://" in exe:
                    title = g["title"]
                    key = "local:" + re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
                    scheme = exe.split("://", 1)[0].lower()
                    src = "steam" if scheme == "steam" else "epic" if "epicgames" in scheme else "gog" if "gog" in scheme else "uplay" if scheme == "uplay" else "ea" if scheme.startswith("origin") else "battlenet" if scheme == "battlenet" else "amazon" if "amazon" in scheme else "url"
                    self.store.set_installed(key, dir=g.get("dir", ""), exe=exe, title=title, kind="local", source=src, steam_appid=g.get("steam_appid", ""))
                    if self.store.config.get("auto_metadata"):
                        self.queue_meta(key)
                    r = {"key": key}
                else:
                    r = self.add_local_game(exe, g["title"])
                if r.get("key"):
                    self.store.update(r["key"], playtime=g.get("playtime", 0), last_played=g.get("last_played", 0), source=g.get("source", ""), **({"year": g["year"]} if g.get("year") else {}))
                    if g.get("source") == "playnite":
                        self._apply_title(r["key"], g["title"], locked=True)
                    if g.get("args") and "://" not in exe:
                        self.set_shortcut(r["key"], None, str(g["args"]))
                    wd = str(g.get("workdir") or "").rstrip("\\/")
                    if wd and "://" not in exe and Path(wd).is_dir() and os.path.normcase(wd) != os.path.normcase(str(Path(exe).parent)):
                        self.store.update(r["key"], workdir=wd)
                    self._import_cover(r["key"], g)
                    added += 1
                else:
                    skipped = self._imp_skip(g, skipped, r.get("error") or "Não foi possível adicionar", exe)
            else:
                skipped = self._imp_skip(g, skipped, "Sem executável, ROM ou pasta")
        except Exception as e:
            log.warning("import %s: %s", g.get("title"), e)
            skipped = self._imp_skip(g, skipped, str(e))
        return added, skipped

    def _imp_skip(self, g: dict, skipped: int, why: str, path: str = "") -> int:
        if not hasattr(self, "_imp_skipped"):
            self._imp_skipped = []
        self._imp_skipped.append({"title": g.get("title") or "?", "why": why, "path": path or g.get("exe") or g.get("rom") or g.get("dir") or ""})
        return skipped + 1

    def _import_fav(self, key: str):
        try:
            favs = list(self.store.config.get("favorites") or [])
            if key not in favs:
                favs.append(key)
                self.store.set_config(favorites=favs)
        except Exception as ex:
            log.debug("import fav %s: %s", key, ex)

    def _import_cover(self, key: str, g: dict):
        cf = g.get("cover_file") or ""
        if cf and Path(cf).is_file() and not self.covers.custom_path(key):
            try:
                self.covers.set_custom(key, cf, fast=True)
                self.images.invalidate(key)
            except Exception as ex:
                log.debug("import cover %s: %s", key, ex)
        meta = {}
        bg = g.get("background_file") or ""
        if bg and Path(bg).is_file():
            try:
                dst = paths.CACHE / "backgrounds" / (re.sub(r"[^a-zA-Z0-9_.-]", "_", key)[:120] + Path(bg).suffix.lower())
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(bg, dst)
                meta["background_file"] = str(dst)
            except Exception as ex:
                log.debug("import bg %s: %s", key, ex)
        if g.get("description"):
            txt = re.sub(r"<br\s*/?>|</p>", "\n", g["description"])
            txt = html.unescape(re.sub(r"<[^>]+>", "", txt))
            meta["summary"] = re.sub(r"\n{3,}", "\n\n", txt).strip()[:4000]
        if g.get("developers"):
            meta["developer"] = ", ".join(g["developers"])
        if g.get("genres"):
            meta["genres"] = list(g["genres"])
        if g.get("year"):
            meta["year"] = str(g["year"])
        if g.get("notes"):
            meta["notes"] = str(g["notes"]).strip()[:2000]
        if g.get("links"):
            meta["links"] = [l for l in g["links"] if isinstance(l, dict) and l.get("url")][:8]
        if meta:
            meta["imported"] = g.get("source") or "playnite"
        extra = {}
        if g.get("pn_source"):
            extra["store_src"] = str(g["pn_source"])[:40]
        if g.get("play_count"):
            extra["play_count"] = int(g["play_count"])
        if extra:
            self.store.update(key, **extra)
        if meta:
            try:
                cur = self.meta.get(key) or {}
                merged = {**cur, **{k: v for k, v in meta.items() if not cur.get(k)}}
                merged.setdefault("source", ["playnite"])
                p = self.meta.path(key)
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(json.dumps(merged, ensure_ascii=False, indent=1), encoding="utf-8")
                self.meta.touch()
            except Exception as ex:
                log.debug("import meta %s: %s", key, ex)
        if g.get("favorite"):
            favs = self._favs
            favs.add(key)
            self.store.set_config(favorites=sorted(favs))

    def _import_prefer_emulator(self, sid: str, vid: str):
        try:
            if vid in self.emu.presets["emulators"] and (self.emu.emu_exe(vid) or (self.store.config.get("emu_paths") or {}).get(vid)):
                se = dict(self.store.config.get("system_emulators") or {})
                if se.get(sid) != vid:
                    se[sid] = vid
                    self.store.set_config(system_emulators=se)
        except Exception as ex:
            log.debug("prefer emu %s/%s: %s", sid, vid, ex)

    def _import_emulator(self, g: dict) -> bool:
        vid = g.get("emulator") or ""
        exe = g.get("exe") or ""
        if (not exe or not Path(exe).exists()) and g.get("emu_dir") and Path(g["emu_dir"]).is_dir():
            want = self.emu.presets["emulators"].get(vid, {}).get("exe", "") if vid else ""
            exes = [p for p in Path(g["emu_dir"]).rglob("*.exe") if not re.search(r"unins|setup|updater|crash|vc_redist|dxsetup", p.name, re.I)]
            hits = [p for p in exes if want and p.name.lower() == want.lower()]
            if not hits and vid:
                hits = [p for p in exes if vid.split("-")[0] in p.stem.lower()]
            if not hits and len(exes) == 1:
                hits = exes
            exe = str(hits[0]) if hits else exe
        if not exe or not Path(exe).exists():
            return False
        if not vid:
            vid = importers.playnite_emu_of(Path(exe).stem) if hasattr(importers, "playnite_emu_of") else ""
        if vid in self.emu.presets["emulators"]:
            self.emu.set_emulator_exe(vid, exe)
            for sid in g.get("systems") or []:
                if sid in self.emu.presets["systems"] and sid not in (self.emu.presets["emulators"][vid].get("systems") or []):
                    self.emu.add_system_emulator(sid, vid)
            return True
        systems = [s for s in (g.get("systems") or []) if s]
        if not systems:
            return False
        title = re.sub(r"^Emulador:\s*", "", g.get("title") or Path(exe).stem)
        args = (g.get("args") or "").replace("{ImagePath}", "{rom}").replace("{ImageName}", "{rom}").replace("{ImageNameNoExt}", "{rom}")
        self.emu.add_custom_emulator({"title": title, "exe": exe, "args": args or "{rom}", "systems": systems})
        return True

    def _warm_up(self):
        if not self.store.config.get("auto_metadata", True) or not self.store.config.get("bg_warmup"):
            return
        keys = [k for k in list(self.store.library) if not self.meta.get(k)]
        try:
            keys += [r["key"] for r in self.emu.scan_all() if not self.meta.get(r["key"])]
        except Exception:
            pass
        for k in dict.fromkeys(keys):
            self.queue_meta(k, 9)
        try:
            self.flash.prefetch_covers()
        except Exception:
            pass

        with self._lock:
            entries = sorted(self.entries.values(), key=lambda e: e.title.lower())[:120]
        missing = [e for e in entries if not self.images.has_thumb(e.key)]
        for i, e in enumerate(missing):
            try:
                if i % 10 == 0:
                    self.act(f"Pré-carregando miniaturas da Store ({i + 1}/{len(missing)})…")
                self.thumb_path(e.key)
            except Exception:
                pass
        self.act("")

    TIPS_CONTROLLER = re.compile(r"racing|corrida|fighting|luta|platform|plataforma|sports|esportes|futebol|football|soccer|skate|hack and slash|beat 'em up|kart|arcade|action-adventure|ação/aventura|ação e aventura|wrestling|3ª pessoa|third-person|terceira pessoa|survival|terror|horror|souls|metroidvania|stealth|furtividade", re.I)
    TIPS_KBM = re.compile(r"fps|first-person|1ª pessoa|primeira pessoa|strategy|estratégia|rts|simulation|simulação|point-and-click|aventura gráfica|mmorpg|tower defense|management|gerenciamento|city|moba|isométrico|crpg", re.I)
    TIPS_HEADSET = re.compile(r"terror|horror|survival|stealth|furtividade|drama|rhythm|ritmo|música|music|narrative|história", re.I)

    def tips_for(self, g: dict) -> list[dict]:
        text = " ".join([g.get("title", ""), " ".join(g.get("genres") or []), " ".join(((g.get("meta") or {}).get("genres") or []))]).lower()
        sysid = g.get("system", "pc")
        out = []
        if sysid != "pc":
            out.append({"icon": "gamepad", "t": "Melhor com controle", "d": "Jogo de console: o emulador já mapeia o controle. Teclado funciona, mas é sofrido."})
        elif self.TIPS_CONTROLLER.search(text):
            out.append({"icon": "gamepad", "t": "Melhor com controle", "d": "Corrida, luta, esporte e plataforma pedem analógico. Um controle de Xbox liga e vai."})
        elif self.TIPS_KBM.search(text):
            out.append({"icon": "win", "t": "Teclado e mouse", "d": "Tiro em primeira pessoa e estratégia são mais precisos no mouse."})
        else:
            out.append({"icon": "gamepad", "t": "Tanto faz", "d": "Funciona bem dos dois jeitos — vai no que estiver mais perto."})
        if self.TIPS_HEADSET.search(text):
            out.append({"icon": "spark", "t": "Coloca o fone", "d": "Terror, furtividade ou jogo de história: o som faz metade do clima. Luz apagada, fone no ouvido."})
        elif re.search(r"racing|corrida|sports|esportes|arcade|party|kart", text):
            out.append({"icon": "spark", "t": "Sem fone, som alto", "d": "Jogo de sessão rápida: bom pra jogar com gente em volta, caixinha de som ligada."})
        else:
            out.append({"icon": "spark", "t": "Fone opcional", "d": "Sem exigência de imersão — coloca uma playlist de fundo se quiser."})
        pt = g.get("playtime", 0)
        if pt and pt < 1800:
            out.append({"icon": "clock", "t": "Você mal começou", "d": f"Só {human_time(pt)} até agora — dá a chance que ele merece."})
        elif not pt:
            out.append({"icon": "clock", "t": "Nunca jogado", "d": "Zero horas. Hoje é o dia."})
        hw = self.hardware()
        if not hw.get("error") and hw["tier"]["level"] == "low" and sysid in ("ps3", "x360", "switch", "wiiu"):
            out.append({"icon": "cpu", "t": "Pode pesar", "d": "Seu PC é básico e esse console é pesado de emular — talvez rode com engasgos."})
        return out

    def random_pick(self, filt: str = "any", exclude: list[str] | None = None) -> dict:
        import random
        cat = self.catalog_payload()
        games = [g for g in cat["games"] if g.get("installed")]
        if filt == "unplayed":
            games = [g for g in games if not g.get("playtime")]
        elif filt == "short":
            games = [g for g in games if g.get("system") != "pc" or any(k in " ".join(g.get("genres") or []).lower() for k in ("arcade", "corrida", "esporte", "luta", "plataforma", "puzzle"))]
        elif filt == "fav":
            games = [g for g in games if g.get("fav")]
        elif filt == "pc":
            games = [g for g in games if g.get("system", "pc") == "pc"]
        elif filt == "emu":
            games = [g for g in games if g.get("system", "pc") != "pc"]
        ex = set(exclude or [])
        pool = [g for g in games if g["key"] not in ex] or games
        if not pool:
            return {"error": "Nenhum jogo instalado bate com esse filtro."}

        weights = [1.0 / (1.0 + (g.get("playtime", 0) / 3600.0)) for g in pool]
        g = random.choices(pool, weights=weights, k=1)[0]
        full = self.game_payload(g["key"]) or g
        return {"game": {**g, "description": (full.get("description") or "")[:260]}, "tips": self.tips_for(full), "pool": len(pool)}

    def flash_add(self, path: str | None, title: str = "", kind: str = "") -> dict:
        if not path:
            if kind == "dir":
                if not self.pick_folder:
                    return {"error": "Informe o caminho da pasta do jogo (a que tem o index.html)"}
                path = self.pick_folder("")
            else:
                if not self.pick_file:
                    return {"error": "Informe o caminho do arquivo (.swf ou .zip)"}
                path = self.pick_file("", "quick")
            if not path:
                return {"ok": False}
        return self.flash.add_custom(path, title)

    def flash_play_web(self, gid: str) -> dict:
        g = next((x for x in self.flash.presets["games"] if x["id"] == gid), None)
        if not g or not str(g.get("url", "")).startswith("http"):
            return {"error": "Esse jogo não tem endereço de site"}
        self.flash.mark_play(gid)
        pop = self.window_hooks.get("popup")
        if pop:
            try:
                pop({"title": g["title"], "url": g["url"], "w": int(g.get("w") or 1280), "h": int(g.get("h") or 760)})
                return {"ok": True, "window": True}
            except Exception as e:
                log.warning("popup: %s", e)
        self.open_url(g["url"])
        return {"ok": True, "browser": True}

    def flash_cover(self, gid: str, path: str | None) -> dict:
        if not path:
            if not self.pick_file:
                return {"error": "Informe o caminho da imagem"}
            path = self.pick_file(str(Path.home() / "Pictures"), "image")
            if not path:
                return {"ok": False}
        return self.flash.set_cover(gid, path)

    def flash_install(self, gid: str | None):
        if gid == "ruffle":
            return self._run_job("flash:ruffle", "Ruffle (player Flash)", "flash", lambda cb, cancel: {"ruffle": True, "path": str(self.flash.install_ruffle(cb, cancel))})
        if gid == "all":
            return self._run_job("flash:all", "Jogos Rápidos", "flash", lambda cb, cancel: self.flash.install_all_missing(cb, cancel))
        g = next((x for x in self.flash.presets["games"] if x["id"] == gid), None)
        if not g:
            return {"error": "Jogo desconhecido"}

        def fn(cb, cancel):
            if not self.flash.ruffle_ready():
                self.flash.install_ruffle(cb, cancel)
            self.flash.install_game(gid, cb, cancel)
            return {"flash": True, "gid": gid}
        return self._run_job("flash:" + gid, g["title"], "flash", fn)

    def hardware(self, force: bool = False) -> dict:
        try:
            hw = hardware.detect(force)
        except Exception as e:
            log.warning("hardware: %s", e)
            return {"error": str(e)}
        from . import compat
        hw = dict(hw)
        hw["compat"] = compat.status(self.store.config)
        return hw

    def _win_game(self, key: str | None) -> dict | None:
        if not key:
            return None
        info = self.store.get(key)
        if not info:
            return None
        g = dict(info)
        g["key"] = key
        return g

    def win_status(self, deep: bool = False) -> dict:
        from . import compat
        return compat.status(self.store.config, deep)

    def win_prepare(self, then_play: str | None = None) -> dict:
        if os.name == "nt":
            return {"error": "Só no Linux"}
        from . import winengine

        def work(cb, cancel):
            r = winengine.prepare(self.store.config, cb, cancel, self.repos.session)
            if then_play:
                r["play"] = then_play
            return r
        return self._run_job("win:prepare", "Motor Windows", "win", work, retry={"m": "win_prepare", "a": [then_play]})

    def win_update_proton(self) -> dict:
        from . import winengine
        return self._run_job("win:proton", "GE-Proton (atualizar)", "win",
                             lambda cb, cancel: {"dir": str(winengine.download_proton(cb, cancel, self.repos.session))}, retry={"m": "win_update_proton", "a": []})

    def win_tricks(self, verbs: list, key: str | None = None) -> dict:
        from . import winengine
        verbs = [str(v).strip() for v in (verbs or []) if str(v).strip()]
        if not verbs:
            return {"error": "Escolha pelo menos um componente"}
        game = self._win_game(key)
        title = "Componentes: " + ", ".join(verbs[:3]) + ("…" if len(verbs) > 3 else "")
        return self._run_job("win:tricks", title, "win", lambda cb, cancel: winengine.install_tricks(verbs, self.store.config, cb, cancel, game),
                             retry={"m": "win_tricks", "a": [verbs, key]})

    def win_tool(self, tool: str, key: str | None = None) -> dict:
        from . import winengine
        try:
            return winengine.open_tool(tool, self.store.config, self._win_game(key))
        except Exception as e:
            return {"error": str(e)}

    def win_test(self, key: str | None = None) -> dict:
        from . import winengine
        try:
            return winengine.test(self.store.config, self._win_game(key))
        except Exception as e:
            return {"ok": False, "message": str(e)}

    def win_clean(self) -> dict:
        from . import winengine
        return winengine.clean_temp(self.store.config)

    def win_prefix(self, action: str, path: str = "", key: str | None = None) -> dict:
        from . import winengine
        if action == "set":
            return winengine.set_prefix(lambda d: self.store.set_config(**d), path or "")
        if action == "reset":
            if any(k.startswith("win:") for k in self.jobs) or self.sessions.active:
                return {"error": "Feche os jogos e espere a Fila terminar antes de apagar o prefixo."}
            return winengine.reset_prefix(self.store.config, self._win_game(key))
        return {"error": "ação desconhecida"}

    def shutdown(self):
        for j in self.jobs.values():
            j["cancel"].set()
        self.pool.shutdown(wait=False, cancel_futures=True)
        self._thumb_pool.shutdown(wait=False, cancel_futures=True)
        try:
            self.repos.session.close()
        except Exception:
            pass
