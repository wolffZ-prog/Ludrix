from __future__ import annotations

import logging
import os
import subprocess
import threading

log = logging.getLogger(__name__)


SUGGESTED = ["Discord.exe", "chrome.exe", "msedge.exe", "firefox.exe", "opera.exe", "brave.exe", "Spotify.exe",
             "steam.exe", "EpicGamesLauncher.exe", "GalaxyClient.exe", "Battle.net.exe", "RiotClientServices.exe",
             "OneDrive.exe", "Teams.exe", "ms-teams.exe", "WhatsApp.exe", "Telegram.exe", "Skype.exe",
             "obs64.exe", "NVIDIA Share.exe", "RadeonSoftware.exe", "Overwolf.exe", "wallpaper64.exe", "Rainmeter.exe"]
if os.name != "nt":
    SUGGESTED = ["Discord", "chrome", "chromium", "firefox", "brave", "opera", "spotify", "steam", "heroic", "lutris",
                 "telegram-desktop", "slack", "obs", "vesktop", "electron"]

HIGH_PERF_GUID = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"
ULTIMATE_GUID = "e9a42b02-d5df-448d-aa00-03f14749eb61"
KHORVIE_GUID = "02836485-1111-1111-1111-111111111111"
PLANS = {"high": "Alto desempenho", "ultimate": "Desempenho máximo (Ultimate)", "khorvie": "Khorvie (comunidade)"}


class GameMode:
    def __init__(self, store):
        self.store = store
        self.active = False
        self._prev_plan: str | None = None
        self._closed: list[str] = []
        self._lock = threading.Lock()

    def snapshot(self) -> dict:
        out = {"windows": os.name == "nt", "active": self.active, "ram": {}, "running": [], "suggested": SUGGESTED,
               "close_list": self.store.config.get("game_mode_close") or [], "reopen": bool(self.store.config.get("game_mode_reopen", True)),
               "power": bool(self.store.config.get("game_mode_power", True)), "quiet": bool(self.store.config.get("game_mode_quiet", True)),
               "priority": bool(self.store.config.get("game_mode_priority", True)), "plan": self._current_plan_name()}
        try:
            import psutil
            vm = psutil.virtual_memory()
            out["ram"] = {"total": vm.total, "used": vm.used, "avail": vm.available, "pct": vm.percent}
            names = {n.lower() for n in out["close_list"]}
            sugg = {n.lower() for n in SUGGESTED}
            seen = {}
            for p in psutil.process_iter(["pid", "name", "memory_info", "exe"]):
                n = (p.info["name"] or "")
                if not n:
                    continue
                key = n.lower()
                if key in names or key in sugg:
                    m = (p.info["memory_info"].rss if p.info["memory_info"] else 0)
                    if key in seen:
                        seen[key]["mem"] += m
                        seen[key]["count"] += 1
                    else:
                        seen[key] = {"name": n, "mem": m, "count": 1, "exe": p.info["exe"] or "", "listed": key in names}
            out["running"] = sorted(seen.values(), key=lambda x: -x["mem"])
        except Exception as e:
            log.warning("gamemode snapshot: %s", e)
        return out

    def _current_plan_name(self) -> str:
        if os.name != "nt":
            return ""
        try:
            r = subprocess.run(["powercfg", "/getactivescheme"], capture_output=True, text=True, timeout=5,
                               creationflags=subprocess.CREATE_NO_WINDOW)
            return r.stdout.strip().split("(")[-1].rstrip(")") if "(" in r.stdout else r.stdout.strip()
        except Exception:
            return ""

    def optimize(self) -> dict:
        cfg = self.store.config
        done = {"closed": [], "power": False}
        with self._lock:
            if cfg.get("game_mode_close"):
                done["closed"] = self._close_apps(cfg["game_mode_close"])
            if cfg.get("game_mode_power", True):
                guid = self._plan_guid(cfg.get("game_mode_plan") or "high")
                done["power"] = self._set_power(guid) if guid else False
                done["plan"] = PLANS.get(cfg.get("game_mode_plan") or "high", "")
            self.active = True
        return done

    def restore(self) -> dict:
        out = {"reopened": [], "power": False}
        with self._lock:
            if not self.active:
                return out
            if self._prev_plan:
                out["power"] = self._set_power(self._prev_plan, remember=False)
                self._prev_plan = None
            if self.store.config.get("game_mode_reopen", True):
                for exe in self._closed:
                    try:
                        subprocess.Popen([exe], creationflags=getattr(subprocess, "DETACHED_PROCESS", 0))
                        out["reopened"].append(os.path.basename(exe))
                    except Exception as e:
                        log.info("reabrir %s: %s", exe, e)
            self._closed = []
            self.active = False
        return out

    def boost_pid(self, pid: int):
        if not self.store.config.get("game_mode_priority", True) or not self.active:
            return
        try:
            import psutil
            p = psutil.Process(pid)
            p.nice(psutil.HIGH_PRIORITY_CLASS if os.name == "nt" else -5)
        except Exception as e:
            log.info("prioridade: %s", e)

    def _close_apps(self, names: list[str]) -> list[str]:
        closed = []
        try:
            import psutil
        except Exception:
            return closed
        wanted = {n.lower() for n in names}
        procs = [p for p in psutil.process_iter(["pid", "name", "exe"]) if (p.info["name"] or "").lower() in wanted]
        exes = {}
        for p in procs:
            try:
                if p.info["exe"] and p.info["name"].lower() not in exes:
                    exes[p.info["name"].lower()] = p.info["exe"]
                p.terminate()
            except Exception:
                pass
        _, alive = psutil.wait_procs(procs, timeout=4)
        for p in alive:
            try:
                p.kill()
            except Exception:
                pass
        for n, exe in exes.items():
            closed.append(os.path.basename(exe))
            if exe not in self._closed:
                self._closed.append(exe)
        return closed

    @staticmethod
    def _plans_installed() -> set[str]:
        if os.name != "nt":
            return set()
        try:
            r = subprocess.run(["powercfg", "/list"], capture_output=True, text=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
            return {x.lower() for x in r.stdout.split() if len(x) == 36 and x.count("-") == 4}
        except Exception:
            return set()

    def _plan_guid(self, plan: str) -> str | None:
        if plan == "high" or os.name != "nt":
            return HIGH_PERF_GUID
        have = self._plans_installed()
        flags = subprocess.CREATE_NO_WINDOW
        try:
            if plan == "ultimate":
                if ULTIMATE_GUID in have:
                    return ULTIMATE_GUID
                subprocess.run(["powercfg", "-duplicatescheme", ULTIMATE_GUID, ULTIMATE_GUID], capture_output=True, timeout=8, creationflags=flags)
                return ULTIMATE_GUID if ULTIMATE_GUID in self._plans_installed() else HIGH_PERF_GUID
            if plan == "khorvie":
                if KHORVIE_GUID in have:
                    return KHORVIE_GUID
                from . import paths
                pow_ = paths.PRESETS / "khorvie.pow"
                if not pow_.exists():
                    return HIGH_PERF_GUID
                subprocess.run(["powercfg", "-import", str(pow_), KHORVIE_GUID], capture_output=True, timeout=10, creationflags=flags)
                return KHORVIE_GUID if KHORVIE_GUID in self._plans_installed() else HIGH_PERF_GUID
        except Exception as e:
            log.info("plano %s: %s", plan, e)
        return HIGH_PERF_GUID

    def _set_power(self, guid: str, remember: bool = True) -> bool:
        if os.name != "nt":
            return False
        try:
            if remember:
                r = subprocess.run(["powercfg", "/getactivescheme"], capture_output=True, text=True, timeout=5,
                                   creationflags=subprocess.CREATE_NO_WINDOW)
                parts = r.stdout.split()
                cur = next((x for x in parts if len(x) == 36 and x.count("-") == 4), None)
                if cur and cur.lower() == guid.lower():
                    return True
                self._prev_plan = cur
            subprocess.run(["powercfg", "/setactive", guid], capture_output=True, timeout=5,
                           creationflags=subprocess.CREATE_NO_WINDOW)
            return True
        except Exception as e:
            log.info("powercfg: %s", e)
            return False
