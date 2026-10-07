from __future__ import annotations

import logging
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Callable

log = logging.getLogger("sessions")


def _has_psutil() -> bool:
    import importlib.util
    return importlib.util.find_spec("psutil") is not None


def _proc_tree_alive(pid: int) -> bool:
    try:
        import psutil
        try:
            p = psutil.Process(pid)
        except psutil.NoSuchProcess:
            return False
        if p.is_running() and p.status() != psutil.STATUS_ZOMBIE:
            return True
        return False
    except ImportError:
        return False


class _ExtProc:
    def __init__(self, pid: int):
        self.pid = pid
        self.returncode = None

    def poll(self):
        if _proc_tree_alive(self.pid):
            return None
        self.returncode = 0
        return 0

    def terminate(self):
        import psutil
        psutil.Process(self.pid).terminate()

    def kill(self):
        import psutil
        psutil.Process(self.pid).kill()


class SessionManager:
    def __init__(self, store, on_start: Callable | None = None, on_end: Callable | None = None):
        self.store = store
        self.active: dict[str, dict] = {}
        self.on_start = on_start
        self.on_end = on_end
        self.on_boost = None
        self._lock = threading.Lock()
        self.next_after: str | None = None
        self.next_optimize: bool = False
        self._ext_seen: set[int] = set()
        self._ext_thread = None

    def start_external_watch(self):
        if self._ext_thread or not _has_psutil():
            return
        self._ext_thread = threading.Thread(target=self._external_loop, daemon=True)
        self._ext_thread.start()

    def _exe_map(self) -> dict[str, str]:
        m = {}
        for key, info in list(self.store.library.items()):
            if info.get("kind") in ("emulator", "tool", "redist", "optional") or not info.get("installed", True):
                continue
            exe = str(info.get("exe") or "")
            if not exe or "://" in exe or not os.path.isabs(exe) or exe.lower().endswith((".lnk", ".url", ".bat", ".cmd")):
                continue
            m.setdefault(os.path.normcase(os.path.normpath(exe)), key)
        return m

    def _external_loop(self):
        import psutil
        time.sleep(20)
        while True:
            try:
                if self.store.config.get("track_external", True):
                    m = self._exe_map()
                    if m:
                        live = {s["pid"] for s in self.active.values()} | {s["proc"].pid for s in self.active.values()}
                        for p in psutil.process_iter(["pid", "exe", "create_time"]):
                            try:
                                exe = p.info["exe"]
                                if not exe:
                                    continue
                                key = m.get(os.path.normcase(os.path.normpath(exe)))
                                if not key or key in self.active or p.pid in live or p.pid in self._ext_seen:
                                    continue
                                self._adopt(key, p.pid, float(p.info["create_time"] or time.time()))
                            except (psutil.NoSuchProcess, psutil.AccessDenied):
                                pass
                self._ext_seen = {pid for pid in self._ext_seen if psutil.pid_exists(pid)}
            except Exception:
                log.debug("external watch", exc_info=True)
            time.sleep(15)

    def _adopt(self, key: str, pid: int, started: float):
        info = self.store.get(key) or {}
        self._ext_seen.add(pid)
        sess = {"key": key, "title": info.get("title") or key, "pid": pid, "proc": _ExtProc(pid), "started": max(started, time.time() - 120), "after": "none",
                "optimize": False, "external": True}
        with self._lock:
            if key in self.active:
                return
            self.active[key] = sess
        self.store.update(key, last_played=sess["started"])
        threading.Thread(target=self._watch, args=(sess,), daemon=True).start()
        if self.on_start:
            try:
                self.on_start(sess)
            except Exception:
                log.exception("on_start")

    def launch(self, key: str, cmd: list[str], cwd: str | Path, title: str) -> dict:
        try:
            kw = {}
            if os.name == "nt":
                kw["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
            else:
                from . import compat
                cmd, _, _ = compat.wrap(cmd)
            proc = subprocess.Popen(cmd, cwd=str(cwd), **kw)
        except OSError as e:

            if os.name == "nt" and len(cmd) == 1:
                try:
                    os.startfile(cmd[0], cwd=str(cwd))
                    self.store.update(key, last_played=time.time())
                    return {"ok": True, "tracked": False}
                except Exception as e2:
                    return {"error": str(e2)}
            return {"error": str(e)}

        sess = {"key": key, "title": title, "pid": proc.pid, "proc": proc, "started": time.time(), "after": self.next_after,
                "optimize": self.next_optimize}
        self.next_after = None
        self.next_optimize = False
        with self._lock:
            self.active[key] = sess
        self.store.update(key, last_played=sess["started"])
        threading.Thread(target=self._watch, args=(sess,), daemon=True).start()
        if self.on_start:
            try:
                self.on_start(sess)
            except Exception:
                log.exception("on_start")
        return {"ok": True, "tracked": True, "pid": proc.pid}

    def launch_pid(self, key: str, pid: int, title: str) -> dict:
        sess = {"key": key, "title": title, "pid": pid, "proc": _ExtProc(pid), "started": time.time(), "after": self.next_after,
                "optimize": self.next_optimize, "elevated": True}
        self.next_after = None
        self.next_optimize = False
        with self._lock:
            self.active[key] = sess
        self.store.update(key, last_played=sess["started"])
        threading.Thread(target=self._watch, args=(sess,), daemon=True).start()
        if self.on_start:
            try:
                self.on_start(sess)
            except Exception:
                log.exception("on_start")
        return {"ok": True, "tracked": True, "pid": pid}

    def _watch(self, sess: dict):
        proc: subprocess.Popen = sess["proc"]
        key = sess["key"]

        while proc.poll() is None:
            time.sleep(2)
            self._tick(key)

        elapsed = time.time() - sess["started"]
        sess["rc"] = proc.returncode
        if elapsed < 20 and not sess.get("killed") and not sess.get("external") and _has_psutil():
            child = self._find_child(sess)
            if child:
                sess["pid"] = child
                if sess.get("optimize") and self.on_boost:
                    try:
                        self.on_boost(child)
                    except Exception:
                        pass
                while _proc_tree_alive(child):
                    time.sleep(2)
                    self._tick(key)
        self._finish(sess)

    def _find_child(self, sess: dict) -> int | None:
        try:
            import psutil
        except ImportError:
            return None
        info = self.store.get(sess["key"]) or {}
        exe_dir = str(Path(info.get("exe") or "").parent).lower()
        if not exe_dir:
            return None
        best = None
        for _ in range(5):
            for p in psutil.process_iter(["pid", "exe", "create_time"]):
                try:
                    exe = (p.info["exe"] or "").lower()
                    if exe.startswith(exe_dir) and p.info["create_time"] >= sess["started"] - 1 and p.pid != sess["proc"].pid:
                        best = p.pid
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            if best:
                return best
            time.sleep(2)
        return None

    def _tick(self, key: str):
        s = self.active.get(key)
        if not s:
            return
        now = time.time()
        if now - s.get("last_save", s["started"]) >= 30:
            delta = now - s.get("last_save", s["started"])
            s["last_save"] = now
            info = self.store.get(key) or {}
            self.store.update(key, playtime=float(info.get("playtime") or 0) + delta)

    def _finish(self, sess: dict):
        key = sess["key"]
        now = time.time()
        delta = now - sess.get("last_save", sess["started"])
        info = self.store.get(key) or {}
        total = float(info.get("playtime") or 0) + max(0, delta)
        self.store.update(key, playtime=total, last_played=sess["started"], last_session=max(0.0, now - sess["started"]), play_count=int(info.get("play_count") or 0) + 1)
        with self._lock:
            self.active.pop(key, None)

        sess["crashed"] = (not sess.get("external") and now - sess["started"] < 15 and not sess.get("killed") and sess.get("pid") == sess["proc"].pid
                           and (sess.get("rc") not in (0, None) or now - sess["started"] < 4))
        if self.on_end:
            try:
                self.on_end(sess, now - sess["started"])
            except Exception:
                log.exception("on_end")

    def terminate(self, key: str) -> dict:
        s = self.active.get(key)
        if not s:
            return {"error": "Jogo não está aberto"}
        s["killed"] = True
        pids = {int(s["pid"]), int(s["proc"].pid)}
        try:
            import psutil
            for pid in list(pids):
                try:
                    p = psutil.Process(pid)
                    for c in p.children(recursive=True):
                        pids.add(c.pid)
                except Exception:
                    pass
            procs = []
            for pid in pids:
                try:
                    procs.append(psutil.Process(pid))
                except Exception:
                    pass
            for p in procs:
                try:
                    p.terminate()
                except Exception:
                    pass
            _, alive = psutil.wait_procs(procs, timeout=4)
            for p in alive:
                try:
                    p.kill()
                except Exception:
                    pass
            psutil.wait_procs(alive, timeout=3)
        except Exception:
            if os.name == "nt":
                for pid in pids:
                    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, creationflags=0x08000000)
            else:
                try:
                    s["proc"].kill()
                except Exception as e:
                    return {"error": str(e)}
        return {"ok": True, "title": s["title"]}

    def status(self) -> dict:
        return {k: {"title": s["title"], "since": s["started"], "elapsed": time.time() - s["started"], "external": bool(s.get("external"))}
                for k, s in self.active.items()}


def human_time(sec: float) -> str:
    sec = int(sec or 0)
    if sec < 60:
        return "menos de 1 min"
    h, m = divmod(sec // 60, 60)
    if h == 0:
        return f"{m} min"
    return f"{h} h {m:02d} min" if m else f"{h} h"
