from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

IS_WIN = sys.platform == "win32"


def wrap(cmd: list[str], config: dict | None = None, game: dict | None = None) -> tuple[list[str], dict | None, str]:
    if not IS_WIN and cmd:
        exe = Path(cmd[0])
        try:
            if exe.is_file() and not os.access(exe, os.X_OK):
                exe.chmod(exe.stat().st_mode | 0o111)
        except OSError:
            pass
    return cmd, None, ""


def popen(cmd: list[str], cwd: str | Path | None = None, config: dict | None = None, game: dict | None = None):
    cmd, _, _ = wrap(cmd)
    return subprocess.Popen(cmd, cwd=str(cwd) if cwd else None)
