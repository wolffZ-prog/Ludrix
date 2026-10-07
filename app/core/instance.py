from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import time
from pathlib import Path

from . import paths

log = logging.getLogger("instance")
FILE = paths.DATA / "instance.json"
MUTEX = {"window": "Local\\LudrixLauncher-SingleInstance", "console": "Local\\LudrixConsole-SingleInstance"}


def write(mode: str, port: int, token: str = ""):
    try:
        paths.DATA.mkdir(parents=True, exist_ok=True)
        FILE.write_text(json.dumps({"mode": mode, "pid": os.getpid(), "port": port, "token": token, "at": time.time()}), encoding="utf-8")
    except Exception as e:
        log.debug("instance write: %s", e)


def clear():
    try:
        cur = read()
        if cur and cur.get("pid") == os.getpid():
            FILE.unlink()
    except Exception:
        pass


def read() -> dict | None:
    try:
        return json.loads(FILE.read_text(encoding="utf-8"))
    except Exception:
        return None


def pid_alive(pid: int) -> bool:
    if not pid or pid == os.getpid():
        return False
    if os.name == "nt":
        try:
            import ctypes
            h = ctypes.windll.kernel32.OpenProcess(0x1000, False, int(pid))
            if not h:
                return False
            code = ctypes.c_ulong()
            ok = ctypes.windll.kernel32.GetExitCodeProcess(h, ctypes.byref(code))
            ctypes.windll.kernel32.CloseHandle(h)
            return bool(ok) and code.value == 259
        except Exception:
            return False
    try:
        os.kill(int(pid), 0)
        return True
    except OSError:
        return False


def _kill(pid: int):
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, creationflags=0x08000000, timeout=15)
        else:
            import signal
            os.kill(int(pid), signal.SIGKILL)
    except Exception as e:
        log.debug("kill %s: %s", pid, e)


def close_other(my_mode: str, timeout: float = 6.0) -> bool:
    cur = read()
    if not cur or not pid_alive(int(cur.get("pid") or 0)):
        return False
    pid, port = int(cur["pid"]), int(cur.get("port") or 0)
    log.info("fechando %s (pid %s) para abrir %s", cur.get("mode"), pid, my_mode)
    if port:
        try:
            import urllib.request
            req = urllib.request.Request(f"http://127.0.0.1:{port}/api/window", data=b'{"cmd":"quit"}', headers={"Content-Type": "application/json", "X-Ludrix-Token": cur.get("token") or ""}, method="POST")
            urllib.request.urlopen(req, timeout=3).read()
        except Exception as e:
            log.debug("quit por http: %s", e)
    t0 = time.time()
    while time.time() - t0 < timeout:
        if not pid_alive(pid):
            return True
        time.sleep(0.2)
    _kill(pid)
    time.sleep(0.5)
    return True


def command_for(mode: str) -> list[str]:
    if paths.FROZEN:
        exe_dir = Path(sys.executable).resolve().parent
        if mode == "console":
            c = exe_dir / "LudrixConsole.exe"
            return [str(c)] if c.exists() else [str(exe_dir / "Ludrix.exe"), "--console"]
        return [str(exe_dir / "Ludrix.exe")]
    if paths.APPIMAGE:
        return [paths.APPIMAGE] + (["--console"] if mode == "console" else [])
    py = sys.executable
    return [py, str(paths.APP / ("console.py" if mode == "console" else "main.py"))]


def launch(mode: str) -> dict:
    cmd = command_for(mode)
    try:
        flags = 0x00000008 | 0x00000200 if os.name == "nt" else 0
        subprocess.Popen(cmd, cwd=str(paths.ROOT), creationflags=flags, close_fds=True)
        return {"ok": True, "cmd": cmd}
    except Exception as e:
        return {"error": f"Não foi possível abrir: {e}"}
