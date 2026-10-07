from __future__ import annotations

import gzip
import json
import logging
import mimetypes
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

from . import diag, paths
from .ludrix import Ludrix

log = logging.getLogger("server")
CTYPES = {".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".mjs": "application/javascript; charset=utf-8", ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
          ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon",
          ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf", ".wasm": "application/wasm", ".swf": "application/x-shockwave-flash", ".mp4": "video/mp4", ".webm": "video/webm",
          ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".map": "application/json"}


def ctype_of(path) -> str:
    ext = Path(str(path)).suffix.lower()
    if ext in CTYPES:
        return CTYPES[ext]
    return mimetypes.guess_type(str(path))[0] or "application/octet-stream"


GZ_TYPES = {"application/json", "text/html", "text/css", "application/javascript", "text/javascript", "application/wasm", "image/svg+xml"}
_GZ: dict = {}
TOKEN = secrets.token_urlsafe(24)
PAGES = {"/": "index.html", "/index.html": "index.html", "/console": "console/console.html", "/console/": "console/console.html", "/terminal": "terminal.html"}
PUBLIC = ("/ui/", "/thumb/", "/cover/", "/hero/", "/shot/", "/api/custom.css", "/api/custom/file/", "/flash/cover/", "/flash/ruffle/", "/flash/games/", "/flash/play/", "/api/import/cover", "/favicon.ico")
MAX_BODY = 32 * 1024 * 1024
LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]", "::1"}
CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https: http:; "
       "img-src 'self' data: blob: https: http:; font-src 'self' data: https: http:; media-src 'self' blob: data:; connect-src 'self'; "
       "worker-src 'self' blob:; frame-src 'self' http://127.0.0.1:* http://localhost:* http:; object-src 'none'; base-uri 'none'; form-action 'none'")


def _host_ok(host: str, lan: bool) -> bool:
    if lan:
        return True
    h = host.strip().lower()
    if h.startswith("["):
        h = h.split("]")[0] + "]"
    else:
        h = h.rsplit(":", 1)[0] if h.count(":") == 1 else h
    return h in LOCAL_HOSTS


class Handler(BaseHTTPRequestHandler):
    ludrix: Ludrix = None
    lan = False
    booted = False
    sandbox_port = 0
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, body: bytes, ctype: str, cache=False, gz=False):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "no-referrer")
        csp = getattr(self, "_csp", "")
        if csp:
            self.send_header("Content-Security-Policy", csp)
            self._csp = ""
        if gz:
            self.send_header("Content-Encoding", "gzip")
        elif len(body) > 4096 and "gzip" in (self.headers.get("Accept-Encoding") or "") and ctype.split(";")[0] in GZ_TYPES:
            body = gzip.compress(body, 4)
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=2592000, immutable" if cache else "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, data, code=200):
        self._send(code, json.dumps(data, ensure_ascii=False, default=str).encode("utf-8"), "application/json; charset=utf-8")

    def _file(self, path: Path | None, cache=False):
        if not path or not path.exists() or not path.is_file():
            return self._send(404, b"", "text/plain")
        ctype = ctype_of(path)
        st = path.stat()
        if st.st_size > 4096 and ctype.split(";")[0] in GZ_TYPES and "gzip" in (self.headers.get("Accept-Encoding") or ""):
            k = (str(path), st.st_mtime_ns, st.st_size)
            gz = _GZ.get(k)
            if gz is None:
                gz = gzip.compress(path.read_bytes(), 6)
                if len(_GZ) > 64:
                    _GZ.clear()
                _GZ[k] = gz
            return self._send(200, gz, ctype, cache, gz=True)
        self._send(200, path.read_bytes(), ctype, cache)

    def _page(self, rel: str):
        f = paths.UI / rel
        if not f.exists():
            return self._send(404, b"", "text/plain")
        html = f.read_text(encoding="utf-8").replace("<head>", f'<head><meta name="ludrix-token" content="{TOKEN}">', 1)
        try:
            sp = self.ludrix.custom.splash_path()
            if sp:
                html = html.replace('<div class="sl">', f'<div class="sl img" style="background-image:url(/api/custom/file/{sp.name})">', 1)
        except Exception:
            pass
        self._csp = CSP
        self._send(200, html.encode("utf-8"), "text/html; charset=utf-8")

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("corpo grande demais")
        if not n:
            return {}
        try:
            d = json.loads(self.rfile.read(n) or b"{}")
        except ValueError as e:
            raise BadRequest(f"JSON inválido: {e}") from None
        if not isinstance(d, dict):
            raise BadRequest("esperava um objeto JSON")
        return d

    def _sandbox_base(self) -> str:
        host = (self.headers.get("Host") or "127.0.0.1").split(",")[0].strip()
        name = host.rsplit(":", 1)[0] if host.count(":") == 1 else (host.split("]")[0] + "]" if host.startswith("[") else host)
        return f"http://{name}:{self.sandbox_port}"

    def _allowed(self, p: str) -> bool:
        host = (self.headers.get("Host") or "").split(",")[0].strip()
        if not _host_ok(host, self.lan):
            return False
        origin = self.headers.get("Origin") or ""
        if origin and urlparse(origin).netloc != host:
            return False
        if (self.headers.get("Sec-Fetch-Site") or "").lower() == "cross-site":
            return False
        if self.command in ("GET", "HEAD"):
            if p in PAGES or p.startswith(PUBLIC):
                return True
            if p.startswith("/api/theme/") and not p.endswith("/json"):
                return True
        return secrets.compare_digest(self.headers.get("X-Ludrix-Token") or "", TOKEN)

    def do_GET(self):
        u = urlparse(self.path)
        p = unquote(u.path)
        q = parse_qs(u.query)
        v = self.ludrix
        try:
            if not self._allowed(p):
                return self._json({"error": "forbidden"}, 403)
            if p in PAGES:
                return self._page(PAGES[p])
            if p.startswith("/ui/"):
                t = (paths.UI / p[4:]).resolve()
                return self._file(t) if paths.UI.resolve() in t.parents else self._send(403, b"", "text/plain")
            if p == "/api/catalog":
                if not Handler.booted:
                    Handler.booted = True
                    v.ui_booted = True
                    diag.boot_ok()
                if q.get("refresh"):
                    v.reload_catalog(force=True)
                    time.sleep(0.3)
                return self._json(v.catalog_payload())
            if p == "/api/site_search":
                return self._json(v.site_search((q.get("q") or [""])[0]))
            if p == "/api/status":
                return self._json({**v.status_payload(), "sessions": v.sessions.status()})
            if p == "/ui/icon.png" or p == "/favicon.ico":
                return self._file(paths.UI / "icon.png", cache=True)
            if p.startswith("/api/game/"):
                d = v.game_payload(unquote(p[10:]))
                return self._json(d) if d else self._json({"error": "not found"}, 404)
            if p.startswith("/api/exes/"):
                return self._json(v.list_exes(unquote(p[10:])))
            if p == "/api/emulation":
                return self._json(v.emu.status())
            if p == "/api/home":
                return self._json(v.home_payload())
            if p == "/api/queue":
                return self._json(v.queue_payload())
            if p == "/api/mods":
                return self._json({**v.mods.status(), "games": v.gmods.summary()})
            if p.startswith("/api/mods/game/"):
                return self._json(v.gmods.list(unquote(p[15:])))
            if p.startswith("/api/mods/for/"):
                g = v.game_payload(unquote(p[14:])) or {}
                return self._json(v.mods.for_game(g.get("title", ""), g.get("system", "pc")))
            if p.startswith("/api/edit/"):
                return self._json(v.edit_info(unquote(p[10:])))
            if p.startswith("/api/actions/"):
                return self._json(v.context_actions(unquote(p[13:])))
            if p == "/api/detect":
                return self._json(v.detect((q.get("q") or [""])[0]))
            if p == "/api/notifications":
                return self._json(v.notifications())
            if p == "/api/fonts":
                return self._json(v.custom.fonts())
            if p == "/api/themes/full":
                return self._json(v.themes())
            if p.startswith("/api/theme/") and p.endswith("/json"):
                return self._json(v.theme_json(unquote(p[11:-5])))
            if p.startswith("/api/theme/") and p.endswith("/wallpaper"):
                return self._file(v.theme_wallpaper(unquote(p[11:-10])))
            if p.startswith("/api/theme/") and p.endswith("/preview"):
                return self._file(v.theme_preview_path(unquote(p[11:-8])))
            if p.startswith("/api/theme/") and "/file/" in p:
                tid, _, rel = unquote(p[11:]).partition("/file/")
                return self._file(v.theme_file(tid, rel), cache=True)
            if p == "/api/custom.css":
                return self._send(200, v.custom.css().encode("utf-8"), "text/css; charset=utf-8")
            if p == "/api/custom":
                return self._json(v.custom.get())
            if p.startswith("/api/custom/file/"):
                return self._file(v.custom.file(unquote(p[17:])), cache=True)
            if p == "/api/repos":
                return self._json(v.repos.list())
            if p == "/api/themes":
                return self._json(v.themes())
            if p.startswith("/api/theme/"):
                return self._send(200, v.theme_css(unquote(p[11:]), (q.get("s") or [""])[0]).encode("utf-8"), "text/css; charset=utf-8")
            if p == "/api/cache":
                return self._json(v.cache_info())
            if p == "/api/flash":
                return self._json(v.flash.status())
            if p.startswith("/flash/cover/"):
                return self._file(v.flash.cover_local(unquote(p[13:])), cache=True)
            if p.startswith("/flash/play/"):
                return self._send(200, v.flash.player_html(unquote(p[12:]), self._sandbox_base()).encode("utf-8"), "text/html; charset=utf-8")
            if p.startswith("/flash/ruffle/") or p.startswith("/flash/games/"):
                from .flash import FLASH
                t = (FLASH / p[7:]).resolve()
                return self._file(t, cache=True) if FLASH.resolve() in t.parents else self._send(403, b"", "text/plain")
            if p == "/api/random":
                return self._json(v.random_pick((q.get("f") or ["any"])[0], (q.get("x") or [""])[0].split(",")))
            if p == "/api/hardware":
                return self._json(v.hardware(bool(q.get("force"))))
            if p == "/api/import/poll":
                return self._json(v.import_poll())
            if p == "/api/redists":
                return self._json(v.redists_status())
            if p == "/api/console":
                return self._json(v.console_payload())
            if p == "/api/disc/tool":
                return self._json(v.disc_tool())
            if p == "/api/bootstrap":
                return self._json(v.bootstrap_status())
            if p == "/api/minecraft":
                return self._json(v.minecraft_status())
            if p.startswith("/api/optionals"):
                return self._json(v.optionals_status(deep="deep=1" in p))
            if p == "/api/gamemode":
                return self._json(v.gamemode.snapshot())
            if p == "/api/updates":
                return self._json(v.updates.status())
            if p == "/api/integrity":
                return self._json(v.integrity_status())
            if p == "/api/config":
                if not Handler.booted:
                    Handler.booted = True
                    v.ui_booted = True
                    diag.boot_ok()
                return self._json(v.public_config())
            if p == "/api/diag":
                return self._json(diag.report(v))
            if p == "/api/terminal/commands":
                return self._json({"commands": v.terminal.catalog(), "history": v.terminal.history[-50:]})
            if p == "/api/import/cover":
                return self._file(v.import_cover_path((q.get("p") or [""])[0]), cache=True)
            if p == "/api/import/launchers":
                return self._json(v.import_launchers())
            if p.startswith("/api/saves/"):
                return self._json(v.saves_info(unquote(p[11:]), deep=bool(q.get("deep"))))
            if p.startswith("/thumb/"):
                return self._file(v.thumb_path(unquote(p[7:]), wait=False), cache=True)
            if p.startswith("/cover/"):
                return self._file(v.cover_path(unquote(p[7:])), cache=True)
            if p.startswith("/hero/"):
                return self._file(v.hero_path(unquote(p[6:])), cache=True)
            if p.startswith("/shot/"):
                k, _, i = unquote(p[6:]).rpartition("/")
                return self._file(v.shot_path(k, int(i or 0)) if i.isdigit() else None, cache=True)
            return self._json({"error": "not found"}, 404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            log.exception("GET %s", p)
            try:
                self._json({"error": str(e)}, 500)
            except Exception:
                pass

    do_HEAD = do_GET

    def do_POST(self):
        p = unquote(urlparse(self.path).path)
        v = self.ludrix
        try:
            if not self._allowed(p):
                return self._json({"error": "forbidden"}, 403)
            b = self._body()
            r = {
                "/api/install": lambda: v.start_install(b["key"], b.get("files"), b.get("torrent", False), b.get("dest") or None, bool(b.get("remember"))),
                "/api/rom_dest": lambda: v.set_rom_dest(b["system"], b.get("folder") or None),
                "/api/install/preview": lambda: v.install_preview(b["key"], b.get("files"), b.get("torrent", False)),
                "/api/cancel": lambda: v.cancel(b["key"], bool(b.get("pause"))),
                "/api/queue/action": lambda: v.queue_action(b["action"], b.get("key")),
                "/api/play": lambda: v.play(b["key"], b.get("after"), b.get("emulator"), b.get("optimize"), bool(b.get("force"))),
                "/api/game/emulator": lambda: v.set_game_emulator(b["key"], b.get("emulator")),
                "/api/stop": lambda: v.stop_game(b["key"]),
                "/api/fav": lambda: v.toggle_favorite(b["key"]),
                "/api/hide": lambda: v.toggle_hidden(b["key"]),
                "/api/rom/add": lambda: v.add_rom_file(b.get("path"), b.get("system"), b.get("title"), b.get("emulator"), bool(b.get("add_folder"))),
                "/api/rom/preview": lambda: v.rom_preview(b.get("path")),
                "/api/emulator/exe": lambda: v.emu.set_emulator_exe(b["id"], b.get("exe")),
                "/api/emulator/open": lambda: v.emu.open_emulator_gui(b["id"]),
                "/api/tools/install": lambda: v.install_tool(b["id"]),
                "/api/tools/remove": lambda: (v.mods.remove(b["id"]), {"ok": True})[1],
                "/api/tools/launch": lambda: v.mods.launch(b["id"]),
                "/api/mods/game/install": lambda: v.mod_install(b["key"], b.get("path"), b.get("title", ""), b.get("target", ""), b.get("kind", "")),
                "/api/mods/game/toggle": lambda: v.gmods.set_enabled(b["key"], b["id"], bool(b.get("on"))),
                "/api/mods/game/remove": lambda: v.gmods.remove(b["key"], b["id"]),
                "/api/shortcut/desktop": lambda: v.desktop_shortcut(b["key"]),
                "/api/downloads/clean": lambda: v.clean_downloads(),
                "/api/open": lambda: v.open_path(b.get("path") or (v.store.get(b["key"]) or {}).get("dir", "")),
                "/api/uninstall": lambda: v.uninstall(b["key"]),
                "/api/uninstall/undo": lambda: v.undo_remove(),
                "/api/library/dupes": lambda: v.library_dupes(),
                "/api/library/backups": lambda: v.library_backups(),
                "/api/library/merge": lambda: v.library_merge(b.get("keep") or "", b.get("drop") or []),
                "/api/library/backup": lambda: v.library_backup_now(),
                "/api/library/restore": lambda: v.library_restore(b["name"]),
                "/api/game/size": lambda: v.folder_size(b["key"]),
                "/api/game/played": lambda: v.mark_played(b["key"], bool(b.get("played", True))),
                "/api/open_select": lambda: v.open_select(b["key"]),
                "/api/set_exe": lambda: v.set_exe(b["key"], b.get("rel")),
                "/api/shortcut": lambda: v.set_shortcut(b["key"], b.get("exe"), b.get("args")),
                "/api/metadata": lambda: v.fetch_metadata(b["key"], b.get("force", False)),
                "/api/config": lambda: v.set_config(b),
                "/api/config/reset": lambda: v.reset_config(b.get("keys")),
                "/api/safe_mode/restore": lambda: v.safe_restore(),
                "/api/data/export": lambda: v.data_export(),
                "/api/data/inspect": lambda: v.data_inspect(b.get("path")),
                "/api/data/import": lambda: v.data_import(b["path"]),
                "/api/choose_folder": lambda: v.choose_folder(b.get("what", "games"), b.get("system"), b.get("initial", "")),
                "/api/open_url": lambda: v.open_url(b["url"]),
                "/api/log/ui": lambda: (diag.ui_error(str(b.get("msg") or "")[:300], str(b.get("src") or "")[:120], int(b.get("line") or 0)), {"ok": True})[1],
                "/api/emulator/install": lambda: v.install_emulator(b["id"]),
                "/api/emulator/update": lambda: v.update_emulator(b["id"]),
                "/api/emulator/check_updates": lambda: v.check_emulator_updates(),
                "/api/emulator/remove": lambda: (v.emu.remove_emulator(b["id"]), {"ok": True})[1],
                "/api/repos/add": lambda: (v.repos.add(b), v.reload_catalog(False), {"ok": True})[2],
                "/api/repos/update": lambda: (v.repos.update(b["id"], b.get("patch") or {}), v.reload_catalog(False), {"ok": True})[2],
                "/api/repos/remove": lambda: (v.repos.remove(b["id"]), v.reload_catalog(False), {"ok": True})[2],
                "/api/repos/toggle": lambda: (v.repos.set_enabled(b["id"], b["enabled"]), v.reload_catalog(False), {"ok": True})[2],
                "/api/cache/clear": lambda: v.clear_cache(b.get("what", [])),
                "/api/local/add": lambda: v.add_local_game(b.get("exe"), b.get("title")),
                "/api/link/preview": lambda: v.link_preview(b.get("url")),
                "/api/patch/download": lambda: v.patch_download(b.get("key") or "", int(b.get("i") or 0)),
                "/api/link/download": lambda: v.link_download(b.get("url"), b.get("title"), b.get("kind") or "pc", b.get("system") or "pc", b.get("picks")),
                "/api/local/install_file": lambda: v.install_from_file(b.get("file"), b.get("title"), b.get("system") or ""),
                "/api/rename": lambda: v.rename_game(b["key"], b["title"]),
                "/api/edit/save": lambda: v.edit_save(b["key"], b.get("data") or {}),
                "/api/game/move": lambda: v.move_game(b["key"], b.get("dest") or ""),
                "/api/game/relocate": lambda: v.relocate_game(b["key"], b.get("path")),
                "/api/library/check": lambda: v.library_check(),
                "/api/library/export": lambda: v.export_metadata(b.get("keys"), b.get("format") or "ludrix"),
                "/api/library/steam": lambda: v.export_steam(b.get("user"), b.get("keys")),
                "/api/edit/probe": lambda: v.edit_probe(b["key"], b.get("source") or "", b.get("title") or ""),
                "/api/edit/webcovers": lambda: v.edit_web_covers(b["key"], b.get("title") or "", b.get("kind") or "cover"),
                "/api/edit/copy": lambda: v.edit_copy(b["key"], b.get("from") or ""),
                "/api/edit/reset": lambda: v.edit_reset(b["key"]),
                "/api/local/guess": lambda: v.local_guess(b.get("path") or ""),
                "/api/pick_path": lambda: v.pick_path(b.get("kind") or "exe", b.get("initial") or ""),
                "/api/metadata/refetch_all": lambda: v.refetch_all_metadata(),
                "/api/pick_exe": lambda: v.pick_exe(b.get("initial", ""), b.get("kind", "exe")),
                "/api/emulator/custom/add": lambda: v.emu.add_custom_emulator(b),
                "/api/emulator/custom/remove": lambda: (v.emu.remove_custom_emulator(b["id"]), {"ok": True})[1],
                "/api/emulator/select": lambda: (v.emu.set_system_emulator(b["system"], b.get("id")), {"ok": True})[1],
                "/api/romdir/add": lambda: (v.emu.add_rom_dir(b["system"], b["folder"]), {"ok": True})[1],
                "/api/romdir/remove": lambda: (v.emu.remove_rom_dir(b["system"], b["folder"]), {"ok": True})[1],
                "/api/notifications/ack": lambda: v.notif_ack(b.get("id"), bool(b.get("clear"))),
                "/api/repack/run": lambda: v.run_repack(b["key"], bool(b.get("force"))),
                "/api/finish_repack": lambda: v.finish_repack(b["key"]),
                "/api/redist/install": lambda: v.redist_install(b["id"]),
                "/api/redist/bundle": lambda: v.redist_bundle(b["id"]),
                "/api/redist/open": lambda: v.open_path(str(paths.REDISTS)),
                "/api/custom/set": lambda: v.custom.set(b),
                "/api/custom/reset": lambda: v.custom.reset(),
                "/api/custom/pick": lambda: v.custom.pick(b.get("what", "wallpaper")),
                "/api/custom/add": lambda: v.custom.add_file(b.get("what", "wallpaper"), b.get("path", "")),
                "/api/custom/remove": lambda: v.custom.remove(b.get("what", "wallpaper"), b.get("name", "")),
                "/api/custom/export": lambda: v.custom.export(b.get("name", ""), b.get("dest", "")),
                "/api/minecraft/add": lambda: v.minecraft_add(b["id"], b.get("path")),
                "/api/minecraft/locate": lambda: v.minecraft_locate(b["id"]),
                "/api/minecraft/launcher": lambda: v.minecraft_set_launcher(b["id"], b.get("path")),
                "/api/minecraft/install": lambda: v.minecraft_install(b["id"]),
                "/api/minecraft/open": lambda: v.minecraft_open(b["id"], b.get("where", "site")),
                "/api/optional/install": lambda: v.optional_install(b["id"]),
                "/api/optional/store": lambda: v.optional_store(b["id"]),
                "/api/console/swap": lambda: v.console_swap(b.get("to", "console"), bool(b.get("force"))),
                "/api/gamemode/run": lambda: v.gamemode_run(),
                "/api/gamemode/restore": lambda: v.gamemode_stop(),
                "/api/emulator/add_system": lambda: (v.emu.add_system_emulator(b["system"], b["id"]), {"ok": True})[1],
                "/api/emulator/remove_system": lambda: (v.emu.remove_system_emulator(b["system"], b["id"]), {"ok": True})[1],
                "/api/window": lambda: v.window_cmd(b.get("cmd") or b.get("action") or "", b),
                "/api/theme/delete": lambda: v.theme_delete(b["id"]),
                "/api/theme/reload": lambda: v.theme_reload(b.get("theme") or ""),
                "/api/theme/export": lambda: v.theme_export(b["id"], b.get("format", "lxtheme")),
                "/api/theme/export_all": lambda: v.theme_export_all(b.get("format", "zip")),
                "/api/theme/import": lambda: v.theme_import(b.get("path")),
                "/api/flash/install": lambda: v.flash_install(b.get("id")),
                "/api/flash/remove": lambda: (v.flash.remove_game(b["id"]), {"ok": True})[1],
                "/api/flash/add": lambda: v.flash_add(b.get("path"), b.get("title", ""), b.get("kind", "")),
                "/api/flash/play_web": lambda: v.flash_play_web(b["id"]),
                "/api/flash/update": lambda: v.flash.update_custom(b["id"], **{k: b.get(k) for k in ("title", "genre", "tip", "controls", "w", "h", "players", "time", "url")}),
                "/api/flash/remove_custom": lambda: v.flash.remove_custom(b["id"]),
                "/api/flash/fav": lambda: v.flash.toggle_fav(b["id"]),
                "/api/flash/cover": lambda: v.flash_cover(b["id"], b.get("path")),
                "/api/flash/played": lambda: (v.flash.mark_play(b["id"]), {"ok": True})[1],
                "/api/cover/set": lambda: v.set_cover(b["key"], b.get("path")),
                "/api/cover/reset": lambda: v.reset_cover(b["key"]),
                "/api/saves/import": lambda: v.saves_import(b["key"], b.get("source"), b.get("dest")),
                "/api/saves/import_folder": lambda: v.saves_import_folder(b["key"], b.get("dest")),
                "/api/saves/set_dir": lambda: v.saves_set_dir(b["key"], b.get("folder")),
                "/api/saves/export": lambda: v.saves_export(b["key"], b["dir"]),
                "/api/saves/restore": lambda: v.saves.restore_backup(b["key"], b["backup"], b["dir"]),
                "/api/import/pick": lambda: v.import_pick(b["id"], b.get("mode", "")),
                "/api/import/scan": lambda: v.import_scan(b["id"], b["path"], b.get("opts") or {}),
                "/api/folder/scan": lambda: v.folder_scan(b.get("path"), b.get("mode", "windows")),
                "/api/dirs/add": lambda: v.game_dir_add(b.get("path")),
                "/api/dirs/remove": lambda: v.game_dir_remove(b.get("path") or ""),
                "/api/dirs/ignore": lambda: v.scan_ignore(b.get("exes") or []),
                "/api/folder/apply": lambda: v.folder_apply(b.get("games") or [], b.get("mode", "windows"), b.get("opts") or {}),
                "/api/import/apply": lambda: v.import_apply(b.get("games", [])),
                "/api/updates/check": lambda: v.updates_check(),
                "/api/updates/download": lambda: v.updates_download(),
                "/api/updates/apply": lambda: v.updates_apply(b.get("relaunch", True), b.get("restore") or None),
                "/api/updates/file": lambda: v.updates_add_file(),
                "/api/updates/restore_pick": lambda: v.updates_pick_restore(bool(b.get("allow_same"))),
                "/api/integrity/repair": lambda: v.integrity_repair(),
                "/api/updates/ack": lambda: v.updates.ack_result(),
                "/api/restart": lambda: v.restart_app(),
                "/api/factory-reset": lambda: v.factory_reset() if b.get("confirm") == "APAGAR TUDO" else {"error": "sem confirmação"},
                "/api/terminal": lambda: v.terminal.run(b.get("line", ""), b.get("source", "terminal")),
                "/api/autostart": lambda: v.set_autostart(b.get("on")),
                "/api/backup/export": lambda: v.backup_export(b.get("dest")),
                "/api/backup/import": lambda: v.backup_import(b.get("path")),
            }.get(p)
            if not r:
                return self._json({"error": "not found"}, 404)
            return self._json(r())
        except KeyError as e:
            self._json({"error": f"faltou o campo {e}"}, 400)
        except BadRequest as e:
            self._json({"error": str(e)}, 400)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            log.exception("POST %s", p)
            self._json({"error": str(e)}, 500)


class BadRequest(ValueError):
    pass


class SandboxHandler(BaseHTTPRequestHandler):
    root: Path = None
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def do_GET(self):
        p = unquote(urlparse(self.path).path)
        try:
            t = (self.root / p.lstrip("/")).resolve()
            if not p.startswith("/html/") or self.root.resolve() not in t.parents or not t.is_file():
                code, body, ctype = 404, b"", "text/plain"
            else:
                code, body, ctype = 200, t.read_bytes(), ctype_of(t)
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            log.exception("sandbox GET %s", p)

    do_HEAD = do_GET


def server_token() -> str:
    return TOKEN


def serve(ludrix: Ludrix, host="127.0.0.1", port=0):
    Handler.ludrix = ludrix
    Handler.lan = host not in ("127.0.0.1", "localhost", "::1")
    SandboxHandler.root = paths.FLASH
    sandbox = ThreadingHTTPServer((host, 0), SandboxHandler)
    sandbox.daemon_threads = True
    threading.Thread(target=sandbox.serve_forever, daemon=True).start()
    Handler.sandbox_port = sandbox.server_address[1]
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]
