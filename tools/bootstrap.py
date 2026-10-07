import runpy
import sys
from pathlib import Path


import base64, concurrent.futures, ctypes, dataclasses, difflib, gzip, hashlib, html, http.server
import importlib, io, json, logging.handlers, mimetypes, platform, random, re, shlex, shutil, socket
import sqlite3, string, struct, subprocess, tempfile, threading, time, traceback, unicodedata, urllib.parse
import webbrowser, xml.etree.ElementTree, zipfile, zlib, runpy as _r
try:
    import tkinter, tkinter.ttk, tkinter.filedialog
except Exception:
    pass
import requests, psutil, py7zr
from PIL import Image, ImageDraw, ImageGrab, ImageOps, ImageFont
import contextlib, heapq, importlib.util, ipaddress, signal, stat, typing, ctypes.wintypes
import webview
try:
    import webview.platforms.edgechromium
    import clr
except Exception:
    pass
try:
    import pystray, pystray._win32
except Exception:
    pass
try:
    import libtorrent
except Exception:
    pass
try:
    import winreg, win32com.client
except Exception:
    pass


ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent
APP = ROOT / "app"


def _compile_app():
    import py_compile
    for src in sorted(APP.rglob("*.py")):
        if "__pycache__" in src.parts:
            continue
        dst = src.with_suffix(".pyc")
        try:
            py_compile.compile(str(src), cfile=str(dst), dfile=src.relative_to(ROOT).as_posix(), doraise=True,
                               invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH)
            src.unlink()
        except Exception:
            pass


if getattr(sys, "frozen", False):
    _compile_app()
_ENTRY = "console" if (Path(sys.executable).stem.lower() == "ludrixconsole" or "--console" in sys.argv[1:]) else "main"
sys.argv = [sys.argv[0]] + [a for a in sys.argv[1:] if a != "--console"]
MAIN = APP / f"{_ENTRY}.pyc" if (APP / f"{_ENTRY}.pyc").exists() and not (APP / f"{_ENTRY}.py").exists() else APP / f"{_ENTRY}.py"


def _die(msg: str):
    try:
        ctypes.windll.user32.MessageBoxW(0, msg, "Ludrix", 0x10)
    except Exception:
        print(msg, file=sys.stderr)
    sys.exit(1)


if not MAIN.exists():
    _die(f"Pasta app\\ não encontrada ao lado do Ludrix.exe.\n\nEsperado: {MAIN}\n\n"
         "Extraia o zip inteiro (não só o .exe) ou reinstale a versão completa.")

sys.path.insert(0, str(APP))
sys.dont_write_bytecode = True
runpy.run_path(str(MAIN), run_name="__main__")
