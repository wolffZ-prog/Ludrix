from __future__ import annotations

import ctypes
import logging
import sys
import threading
import time
from typing import Callable

log = logging.getLogger("gamepad")

XINPUT_GAMEPAD_GUIDE = 0x0400


class _XINPUT_GAMEPAD(ctypes.Structure):
    _fields_ = [("wButtons", ctypes.c_ushort), ("bLeftTrigger", ctypes.c_ubyte), ("bRightTrigger", ctypes.c_ubyte),
                ("sThumbLX", ctypes.c_short), ("sThumbLY", ctypes.c_short), ("sThumbRX", ctypes.c_short), ("sThumbRY", ctypes.c_short)]


class _XINPUT_STATE(ctypes.Structure):
    _fields_ = [("dwPacketNumber", ctypes.c_uint), ("Gamepad", _XINPUT_GAMEPAD)]


def _load_xinput():
    if sys.platform != "win32":
        return None
    for name in ("xinput1_4", "xinput1_3", "xinput9_1_0"):
        try:
            return ctypes.windll.LoadLibrary(name)
        except OSError:
            continue
    return None


def connected_now() -> dict:
    xi = _load_xinput()
    if not xi:
        return {"available": False, "connected": 0}
    try:
        get_state = xi.XInputGetState
        get_state.argtypes = [ctypes.c_uint, ctypes.POINTER(_XINPUT_STATE)]
        get_state.restype = ctypes.c_uint
        st = _XINPUT_STATE()
        n = sum(1 for i in range(4) if get_state(i, ctypes.byref(st)) == 0)
        return {"available": True, "connected": n}
    except Exception as e:
        log.debug("xinput: %s", e)
        return {"available": False, "connected": 0}


class GamepadWatcher:
    def __init__(self, store, on_wake: Callable[[str], None]):
        self.store = store
        self.on_wake = on_wake
        self.connected: dict[int, bool] = {}
        self.names: list[str] = []
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.available = False

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True, name="gamepad")
        self._thread.start()

    def stop(self):
        self._stop.set()
        self.connected = {}

    def status(self) -> dict:
        return {"available": self.available, "connected": sum(1 for v in self.connected.values() if v)}

    def _run(self):
        xi = _load_xinput()
        if not xi:
            log.info("XInput indisponível (não é Windows?) — monitor de controle desligado")
            return

        try:
            get_state = xi[100]
        except (AttributeError, KeyError, OSError):
            get_state = xi.XInputGetState
        get_state.argtypes = [ctypes.c_uint, ctypes.POINTER(_XINPUT_STATE)]
        get_state.restype = ctypes.c_uint
        self.available = True
        state = _XINPUT_STATE()
        guide_since: dict[int, float] = {}
        guide_fired: dict[int, bool] = {}
        first = True
        while not self._stop.is_set():
            enabled = self.store.config.get("gamepad_wake", False)
            for i in range(4):
                ok = get_state(i, ctypes.byref(state)) == 0
                was = self.connected.get(i, False)
                self.connected[i] = ok
                if ok and not was and not first and enabled:
                    log.info("controle %d conectado", i)
                    self._wake("connected")
                if ok and enabled:
                    if state.Gamepad.wButtons & XINPUT_GAMEPAD_GUIDE:
                        guide_since.setdefault(i, time.time())
                        if not guide_fired.get(i) and time.time() - guide_since[i] >= 0.9:
                            guide_fired[i] = True
                            self._wake("guide")
                    else:
                        guide_since.pop(i, None)
                        guide_fired[i] = False
            first = False

            time.sleep(0.25 if any(self.connected.values()) else 1.5)

    def _wake(self, why: str):
        try:
            self.on_wake(why)
        except Exception:
            log.exception("wake")
