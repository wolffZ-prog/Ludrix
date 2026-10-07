from __future__ import annotations

import json
import os
import shutil
import threading
import time
from contextlib import contextmanager
from pathlib import Path

from . import paths

DEFAULT_CONFIG = {
    "theme": "system",
    "theme_mode": "",
    "face": "padrao",
    "lights": ["#9ec5ff", "#b48cff", "#7c4dff"],
    "accent": "",
    "games_dir": "",
    "shortcut_ask": True,
    "home_autoplay": True,
    "bootstrap_done": False,
    "pending_delete": [],
    "keep_archive": False,
    "dl_speed": 0,
    "auto_metadata": True,
    "web_covers": True,
    "bg_warmup": False,
    "bg_sites": False,
    "auto_rename": True,
    "title_overrides": {},
    "sgdb_key": "",
    "torrent_enabled": True,
    "torrent_max_down": 0,
    "torrent_max_up": 100,
    "torrent_seed_after": False,
    "concurrent_downloads": 2,
    "disabled_repos": [],
    "known_repos": None,
    "after_launch": "ask",
    "dim_not_installed": True,
    "home_spot": True,
    "tray_enabled": True,
    "close_action": "ask",
    "autostart": False,
    "win_backend": "auto",
    "wine_path": "",
    "proton_path": "",
    "umu_path": "",
    "win_prefix": "",
    "win_layers": {},
    "win_env": "",
    "rom_dirs": {},
    "rom_dest": {},
    "custom_emulators": {},
    "emu_paths": {},
    "system_emulator": {},
    "system_emulators": {},
    "rom_files": [],
    "favorites": [],
    "store_hide_installed": True,
    "card_size": 136,
    "view_mode": "grid",
    "game_backdrop": "",
    "backdrop_blur": 10,
    "backdrop_dim": 42,
    "accent_from_cover": False,
    "theme_schedule": False,
    "theme_light_from": "07:00",
    "theme_light_to": "19:00",
    "text_size": 0,
    "card_ribbons": True,
    "nav_hidden": [],
    "nav_order": [],
    "group_by": "",
    "sort_by": "az",
    "launch_splash": "short",
    "detail_art": "auto",
    "look": 0,
    "card_hover": "lift",
    "reduce_motion": False,
    "parallax": True,
    "high_contrast": False,
    "home_rows": ["favorites"],
    "home_spot_style": "auto",
    "clock": "off",
    "settings_adv": False,
    "filter_panel": False,
    "filter_presets": [],
    "card_playtime": False,
    "warn_missing": True,
    "last_lib_check": 0,
    "last_import": "",
    "import_hidden": False,
    "seen_version": "",
    "fav_first": False,
    "frame_mode": "theme",
    "frame_corners": "",
    "nav_hide_playing": False,
    "cover_slideshow": False,
    "cover_slideshow_secs": 45,
    "flash_stats": {},
    "store_page_size": 25,
    "nav": "bottom",
    "layout": "",
    "game_args": {},
    "repos_default_off": True,
    "repos_initialized": False,
    "game_mode_auto": False,
    "game_mode_ask": True,
    "welcome_done": False,
    "console_theme": "noite",
    "console_sound": True,
    "console_hint": True,
    "console_card_size": "normal",
    "console_clock24": True,
    "console_start_view": "library",
    "console_vibrate": True,
    "console_dim_idle": 0,
    "console_confirm_quit": True,
    "console_sort": "title",
    "console_dl_pill": True,
    "guides": True,
    "guides_done": [],
    "start_done": [],
    "start_hide": False,
    "game_mode_plan": "high",
    "game_mode_quiet": True,
    "game_mode_power": True, "game_mode_priority": True, "game_mode_reopen": True,
    "game_mode_close": [],
    "emu_no_ask": False,
    "ui_scale": 0,
    "density": "normal",
    "glass": True,
    "hero_enabled": True,
    "toolbar": True,
    "toolbar_items": ["search", "cats", "sort", "bell"],
    "language": "pt-BR",
    "popups": True,
    "notify_sound": True,
    "repack_auto_open": False,
    "notifications": [],
    "notif_seen": [],
    "notif_hidden": [],
    "animations": "light",
    "fx_type": "controls",
    "fx_intensity": 10,
    "rail_icons": "solid",
    "status_position": "bottom",
    "ctx_menu": "",
    "gamepad_enabled": True,
    "gamepad_wake": False,
    "mods_dir": "",
    "update_feed": "",
    "update_auto_check": False,
    "pending_restart": [],
    "gamepad_speed": "normal",
    "game_emulator": {},
    "terminal_enabled": False,
    "terminal_settings": {},
    "settings_lock": "",
    "custom": {},
    "minecraft_auto": True,
    "save_auto_backup": True,
}


def _coerce(key: str, value, default):
    if default is None:
        return value
    if value is None:
        return default
    if isinstance(default, bool):
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str) and value.strip().lower() in ("true", "false", "1", "0", "sim", "nao", "não", "yes", "no", "on", "off"):
            return value.strip().lower() in ("true", "1", "sim", "yes", "on")
        return default
    if isinstance(default, int):
        if isinstance(value, bool):
            return default
        if isinstance(value, (int, float)):
            return int(value)
        if isinstance(value, str):
            try:
                return int(float(value.strip()))
            except ValueError:
                return default
        return default
    if isinstance(default, str):
        return value if isinstance(value, str) else (str(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else default)
    if isinstance(default, list):
        return list(value) if isinstance(value, (list, tuple)) else default
    if isinstance(default, dict):
        return value if isinstance(value, dict) else default
    return value


def sanitize_config(raw: dict) -> tuple[dict, list[str]]:
    fixed: list[str] = []
    out = dict(raw)
    for k, d in DEFAULT_CONFIG.items():
        if k not in raw:
            continue
        v = _coerce(k, raw[k], d)
        if v is not raw[k] and v != raw[k]:
            fixed.append(k)
        out[k] = v
    return out, fixed


class Store:
    def __init__(self):
        self._lock = threading.RLock()
        raw = self._load(paths.CONFIG_FILE, {})
        raw, self.config_fixed = sanitize_config(raw)
        self.config = {**DEFAULT_CONFIG, **raw}
        if self.config.get("layout") == "console":
            self.config["layout"] = ""
        if not self.config.get("rail_icons"):
            self.config["rail_icons"] = "solid"
        if self.config.get("card_size") == 164:
            self.config["card_size"] = DEFAULT_CONFIG["card_size"]
        if self.config.get("backdrop_blur") == 24 and self.config.get("backdrop_dim") == 55:
            self.config["backdrop_blur"] = DEFAULT_CONFIG["backdrop_blur"]
            self.config["backdrop_dim"] = DEFAULT_CONFIG["backdrop_dim"]
        if int(self.config.get("look") or 0) < 2:
            self.config["look"] = 2
            if self.config.get("detail_art") == "blur":
                self.config["detail_art"] = "auto"
            if self.config.get("home_spot_style") == "painel":
                self.config["home_spot_style"] = "auto"
            self._write(paths.CONFIG_FILE, self.config)
        if int(self.config.get("look") or 0) < 3:
            self.config["look"] = 3
            if self.config.get("nav") in ("taskbar", "dock"):
                self.config["nav"] = "bottom"
            if self.config.get("layout") in ("taskbar", "dock"):
                self.config["layout"] = "bottom"
            self.config.pop("cursor", None)
            self.config.pop("cursor_size", None)
            self.config.pop("cursor_speed", None)
            self._write(paths.CONFIG_FILE, self.config)
        if int(self.config.get("look") or 0) < 4:
            self.config["look"] = 4
            if self.config.get("face") == "grafite":
                self.config["face"] = "temperado"
            self._write(paths.CONFIG_FILE, self.config)
        if int(self.config.get("look") or 0) < 5:
            self.config["look"] = 5
            if [str(c).lower() for c in (self.config.get("lights") or [])] in (["#19d3ff", "#3dff9a", "#ffb02e"], ["#19d3ff", "#ffb02e", "#ff6a3d"]):
                self.config["lights"] = list(DEFAULT_CONFIG["lights"])
            self._write(paths.CONFIG_FILE, self.config)
        if int(self.config.get("look") or 0) < 6:
            self.config["look"] = 6
            if self.config.get("face") == "temperado":
                self.config["face"] = "padrao"
            self._write(paths.CONFIG_FILE, self.config)
        if int(self.config.get("look") or 0) < 7:
            self.config["look"] = 7
            if self.config.get("animations") == "full":
                self.config["animations"] = "light"
            self._write(paths.CONFIG_FILE, self.config)
        self.library: dict[str, dict] = self._load(paths.LIBRARY_FILE, {})
        self._defer = 0
        self._dirty: dict[Path, object] = {}
        self.frozen = False

    @contextmanager
    def batch(self):
        with self._lock:
            self._defer += 1
        try:
            yield
        finally:
            with self._lock:
                self._defer -= 1
                if not self._defer:
                    dirty, self._dirty = self._dirty, {}
                    if not self.frozen:
                        for p, data in dirty.items():
                            self._write(p, data)

    def freeze(self):
        with self._lock:
            self.frozen = True
            self._dirty.clear()

    def _save(self, p: Path, data):
        with self._lock:
            if getattr(self, "frozen", False):
                return
            if self._defer:
                self._dirty[p] = data
                return
        self._write(p, data)

    @staticmethod
    def _load(p: Path, default):
        for f in (p, p.with_suffix(p.suffix + ".bak")):
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
            except FileNotFoundError:
                continue
            except Exception:
                try:
                    shutil.copy2(f, f.with_suffix(f.suffix + ".corrompido"))
                except OSError:
                    pass
                continue
            if type(d) is type(default):
                return d
        return default

    @staticmethod
    def _write(p: Path, data):
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(json.dumps(data, indent=2, ensure_ascii=False))
            f.flush()
            os.fsync(f.fileno())
        if p.exists():
            try:
                shutil.copy2(p, p.with_suffix(p.suffix + ".bak"))
            except OSError:
                pass
        tmp.replace(p)

    def set_config(self, **kw):
        with self._lock:
            for k, v in kw.items():
                if k in DEFAULT_CONFIG:
                    self.config[k] = v
            self._save(paths.CONFIG_FILE, self.config)
            return dict(self.config)

    def games_dir(self) -> Path:
        d = self.config.get("games_dir")
        p = Path(d) if d else paths.GAMES
        p.mkdir(parents=True, exist_ok=True)
        return p

    def get(self, key: str) -> dict | None:
        return self.library.get(key)

    def is_installed(self, key: str) -> bool:
        info = self.library.get(key)
        if not info:
            return False
        if info.get("kind") == "rom":
            return bool(info.get("exe")) and Path(info["exe"]).exists()
        if info.get("repack") and info.get("repack_state") != "done":
            return False
        if str(info.get("exe", "")).startswith(("steam://", "com.epicgames", "goggalaxy")):
            return True
        return bool(info.get("dir")) and Path(info["dir"]).exists()

    def set_installed(self, key: str, **info):
        with self._lock:
            cur = self.library.get(key, {})
            cur.update(info)
            cur.setdefault("installed_at", time.time())
            self.library[key] = cur
            self._save(paths.LIBRARY_FILE, self.library)

    def update(self, key: str, **info):
        with self._lock:
            if key in self.library:
                self.library[key].update(info)
                self._save(paths.LIBRARY_FILE, self.library)

    def remove(self, key: str):
        with self._lock:
            info = self.library.pop(key, None)
            self._save(paths.LIBRARY_FILE, self.library)
            return info
