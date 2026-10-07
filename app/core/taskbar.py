from __future__ import annotations

import ctypes
import logging
import sys
import threading
import time
from ctypes import POINTER, Structure, c_ubyte, c_ulong, c_ulonglong, c_ushort, c_void_p

log = logging.getLogger("ludrix")

NOPROGRESS, INDETERMINATE, NORMAL, ERROR, PAUSED = 0, 1, 2, 4, 8


class _GUID(Structure):
    _fields_ = [("d1", c_ulong), ("d2", c_ushort), ("d3", c_ushort), ("d4", c_ubyte * 8)]

    @classmethod
    def of(cls, s: str) -> "_GUID":
        s = s.strip("{}")
        p = s.split("-")
        g = cls()
        g.d1 = int(p[0], 16)
        g.d2 = int(p[1], 16)
        g.d3 = int(p[2], 16)
        tail = bytes.fromhex(p[3] + p[4])
        for i, b in enumerate(tail):
            g.d4[i] = b
        return g


class TaskbarProgress:
    def __init__(self):
        self._p = None
        self._ok = False
        self._last = None

    def _init(self) -> bool:
        if sys.platform != "win32":
            return False
        try:
            ole = ctypes.windll.ole32
            ole.CoInitialize(None)
            clsid = _GUID.of("{56FDF344-FD6D-11d0-958A-006097C9A090}")
            iid = _GUID.of("{EA1AFB91-9E28-4B86-90E9-9E9F8A5EEFAF}")
            p = c_void_p()
            hr = ole.CoCreateInstance(ctypes.byref(clsid), None, 1, ctypes.byref(iid), ctypes.byref(p))
            if hr != 0 or not p.value:
                return False
            self._p = p
            self._vt = ctypes.cast(ctypes.cast(p, POINTER(c_void_p))[0], POINTER(c_void_p))
            hr_init = ctypes.WINFUNCTYPE(ctypes.c_long, c_void_p)(self._vt[3])
            if hr_init(p) != 0:
                return False
            self._set_value = ctypes.WINFUNCTYPE(ctypes.c_long, c_void_p, c_void_p, c_ulonglong, c_ulonglong)(self._vt[9])
            self._set_state = ctypes.WINFUNCTYPE(ctypes.c_long, c_void_p, c_void_p, ctypes.c_int)(self._vt[10])
            self._ok = True
            return True
        except Exception as e:
            log.debug("taskbar: %s", e)
            return False

    def set(self, hwnd: int, state: int, fraction: float = 0.0):
        if not self._ok or not hwnd:
            return
        key = (hwnd, state, round(max(0.0, min(1.0, fraction)), 3))
        if key == self._last:
            return
        self._last = key
        try:
            self._set_state(self._p, c_void_p(hwnd), state)
            if state in (NORMAL, ERROR, PAUSED):
                self._set_value(self._p, c_void_p(hwnd), int(key[2] * 1000), 1000)
        except Exception as e:
            log.debug("taskbar set: %s", e)

    def clear(self, hwnd: int):
        self.set(hwnd, NOPROGRESS)


def _summary(ludrix) -> tuple[int, float]:
    jobs = list(ludrix.jobs.values())
    if not jobs:
        return NOPROGRESS, 0.0
    fr, n, unknown = 0.0, 0, False
    for j in jobs:
        p = j.get("last")
        f = getattr(p, "fraction", -1.0) if p is not None else -1.0
        if f is None or f < 0:
            unknown = True
            continue
        fr += f
        n += 1
    if n == 0:
        return INDETERMINATE, 0.0
    return NORMAL, fr / n if not unknown else (fr / n) * 0.9


def watch(ludrix, hwnd_fn, stop: threading.Event | None = None):
    if sys.platform != "win32":
        return None
    tb = TaskbarProgress()
    stop = stop or threading.Event()

    def _run():
        if not tb._init():
            return
        hwnd = 0
        while not stop.is_set():
            try:
                if not hwnd:
                    hwnd = hwnd_fn() or 0
                if hwnd:
                    state, frac = _summary(ludrix)
                    tb.set(hwnd, state, frac)
            except Exception as e:
                log.debug("taskbar loop: %s", e)
            stop.wait(0.8)
        try:
            if hwnd:
                tb.clear(hwnd)
        except Exception:
            pass

    threading.Thread(target=_run, daemon=True, name="taskbar").start()
    return stop
