from __future__ import annotations

import os
import sys
from pathlib import Path

IS_WIN = sys.platform == "win32"
IS_LINUX = sys.platform.startswith("linux")
IS_MAC = sys.platform == "darwin"

WIN_EXTS = {".exe", ".bat", ".cmd", ".msi", ".com"}
NATIVE_EXTS = {"", ".sh", ".appimage", ".x86_64", ".x86", ".bin", ".run", ".py"}


def is_windows_binary(p: Path) -> bool:
    return p.suffix.lower() in WIN_EXTS


def base_env() -> dict:
    if IS_WIN:
        return dict(os.environ)
    from . import winengine
    return winengine.base_env()


def status(config: dict | None = None, deep: bool = False) -> dict:
    if IS_WIN:
        return {"windows": True}
    from . import winengine
    st = winengine.status(config, deep)
    st["windows"] = False
    return st


def wrap(cmd: list[str], config: dict | None = None, game: dict | None = None) -> tuple[list[str], dict | None, str]:
    if IS_WIN or not cmd:
        return cmd, None, ""
    exe = Path(cmd[0])
    if not is_windows_binary(exe):
        try:
            if exe.is_file() and not os.access(exe, os.X_OK):
                exe.chmod(exe.stat().st_mode | 0o111)
        except OSError:
            pass
        return cmd, None, ""
    from . import winengine
    final, env, warn, _mode = winengine.build(cmd, config, game)
    return final, (env or None), warn


def missing_message(code: str) -> str:
    from . import winengine
    return winengine.missing_message(code)


def popen(cmd: list[str], cwd: str | Path | None = None, config: dict | None = None, game: dict | None = None):
    import subprocess
    cmd, env, warn = wrap(cmd, config, game)
    if warn:
        raise RuntimeError(missing_message(warn))
    kw = {}
    if not IS_WIN:
        kw["env"] = {**base_env(), **(env or {})}
    return subprocess.Popen(cmd, cwd=str(cwd) if cwd else None, **kw)
