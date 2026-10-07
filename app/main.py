from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
import threading
import time
import traceback

from core import paths

APP_NAME = "LudrixHub"
ICON_PNG = paths.UI / "icon.png"
ICON_ICO = paths.ASSETS / "icon.ico"
CUSTOM_ICO = paths.DATA / "custom" / "icon.ico"


_PICK_TYPES = {"exe": ("Executável (*.exe;*.bat;*.lnk)" if sys.platform == "win32" else "Programa (*.exe;*.sh;*.x86_64;*.AppImage;*.bin)", "Todos (*.*)"),
         "json": ("Lista de jogos (*.json)", "Todos (*.*)"),
         "rom": ("ROM / imagem de disco (*.iso;*.chd;*.cue;*.bin;*.img;*.pbp;*.cso;*.gz;*.z64;*.n64;*.v64;*.nds;*.gba;*.gb;*.gbc;*.sfc;*.smc;*.nes;*.md;*.gen;*.smd;*.gcm;*.rvz;*.wbfs;*.wad;*.gdi;*.cdi;*.xiso;*.xex;*.wua;*.wud;*.wux;*.rpx;*.nsp;*.xci;*.3ds;*.cci;*.sms;*.gg;*.pce;*.a26;*.zip;*.7z;*.conf)", "Todos (*.*)"),
         "save": ("Save / pacote (*.zip;*.7z;*.rar;*.sav;*.b;*.dat;*.bin;*.ps2;*.mcd;*.mcr;*.srm;*.gci;*.eep;*.sra;*.fla;*.mpk;*.psu;*.max;*.cbs;*.dsv;*.state*)", "Todos (*.*)"),
         "image": ("Imagem (*.png;*.jpg;*.jpeg;*.webp)", "Todos (*.*)"),
         "archive": ("Arquivo de jogo (*.zip;*.7z;*.rar;*.001;*.iso)", "Todos (*.*)"),
         "theme": ("Tema do Ludrix (*.lxtheme;*.zip;*.json)", "Todos (*.*)"),
         "lxup": ("Atualização do Ludrix (*.lxup)", "Todos (*.*)"),
         "srczip": ("Código-fonte do Ludrix (*.zip;*.lxup)", "Todos (*.*)"),
         "quick": ("Jogo rápido (*.swf;*.zip;*.html)", "Todos (*.*)"),
         "backup": ("Backup do Ludrix (Ludrix-dados-*.zip)", "Todos (*.*)"),
         "any": ("Todos (*.*)",)}

def _icon_png() -> Path:
    try:
        import json
        n = (json.loads((paths.DATA / "config.json").read_text(encoding="utf-8")).get("custom") or {}).get("icon") or ""
        p = paths.DATA / "custom" / n
        if n and "/" not in n and p.is_file():
            return p
    except Exception:
        pass
    return ICON_PNG


def _icon_ico() -> Path:
    return CUSTOM_ICO if CUSTOM_ICO.is_file() else ICON_ICO


def _finish_updater_swap():
    new = paths.ROOT / "updater.exe.new"
    if new.exists():
        try:
            old = paths.ROOT / "updater.exe"
            if old.exists():
                old.unlink()
            new.rename(old)
        except Exception as e:
            logging.warning("updater swap: %s", e)
    for junk in paths.ROOT.glob("*.old"):
        try:
            junk.unlink()
        except Exception:
            pass
    if paths.FROZEN:
        _tidy_legacy_root()


def _tidy_legacy_root():
    import shutil
    mei = Path(getattr(sys, "_MEIPASS", "") or "")
    for name in ("_internal", "runtime"):
        d = paths.ROOT / name
        if d.is_dir() and mei and d.resolve() != mei.resolve():
            shutil.rmtree(d, ignore_errors=True)
    if mei.is_dir() and mei.parent.resolve() == paths.ROOT.resolve():
        try:
            import ctypes
            ctypes.windll.kernel32.SetFileAttributesW(str(mei), 0x02 | 0x04)
        except Exception:
            pass
    for name in ("updater.py", "bootstrap.py", "run.bat", "build.bat", "requirements.txt", "README.md", "CHANGELOG.md",
                 "bin/LEIA-ME.txt", "updates/LEIA-ME.txt", "tools/build.py", "tools/bootstrap.py"):
        try:
            (paths.ROOT / name).unlink(missing_ok=True)
        except Exception:
            pass
    for d in ("bin", "tools"):
        try:
            (paths.ROOT / d).rmdir()
        except Exception:
            pass


def _launch_repair():
    import json
    import subprocess
    exe = paths.ROOT / "updater.exe"
    py = paths.APP / "updater.py"
    if os.name == "nt" and exe.exists():
        cmd = [str(exe)]
    elif paths.FROZEN:
        cmd = [sys.executable, "--run-updater"]
    else:
        cmd = [sys.executable, str(py)]
    launcher = [sys.executable] if paths.FROZEN else [sys.executable, str(paths.APP / "main.py")]
    args = cmd + ["--restore", "--root", str(paths.ROOT), "--wait-pid", str(os.getpid()), "--relaunch", json.dumps(launcher)]
    flags = (0x00000008 | 0x00000200) if os.name == "nt" else 0
    try:
        subprocess.Popen(args, cwd=str(paths.ROOT), creationflags=flags, close_fds=True)
    except Exception as e:
        logging.getLogger("ludrix").error("não foi possível abrir o updater para reparo: %s", e)


def _update_guard():
    import json
    import shutil
    import subprocess
    pv = paths.PENDING_VERIFY
    if not pv.exists():
        return
    try:
        info = json.loads(pv.read_text(encoding="utf-8"))
    except Exception:
        pv.unlink(missing_ok=True)
        return
    if paths.boot_tries() < 2:
        return
    backup = Path(str(info.get("backup") or ""))
    log = logging.getLogger("ludrix")
    if not backup.is_dir():
        log.warning("atualização %s não abriu, mas não há backup para voltar", info.get("version"))
        pv.unlink(missing_ok=True)
        return
    log.error("a versão %s não conseguiu abrir duas vezes; voltando para %s", info.get("version"), info.get("from"))
    try:
        for d in info.get("dirs") or []:
            src = backup / d
            if src.is_dir():
                shutil.rmtree(paths.ROOT / d, ignore_errors=True)
                shutil.copytree(src, paths.ROOT / d)
        for f in info.get("files") or []:
            src = backup / f
            if src.is_file():
                shutil.copy2(src, paths.ROOT / f)
    except Exception as e:
        log.error("rollback falhou: %s", e)
        pv.unlink(missing_ok=True)
        return
    pv.unlink(missing_ok=True)
    paths.boot_ok()
    try:
        (paths.UPDATES / "rolled_back.json").write_text(json.dumps({"from": info.get("version"), "to": info.get("from"), "at": time.time()}), encoding="utf-8")
    except OSError:
        pass
    cmd = [sys.executable] if paths.FROZEN else [sys.executable, str(paths.APP / "main.py")]
    try:
        subprocess.Popen(cmd + sys.argv[1:], cwd=str(paths.ROOT), creationflags=0x00000008 if os.name == "nt" else 0, close_fds=True)
    except Exception as e:
        log.error("reabrir após rollback: %s", e)
        return
    os._exit(0)


def _rolled_back_info() -> dict | None:
    import json
    p = paths.UPDATES / "rolled_back.json"
    try:
        info = json.loads(p.read_text(encoding="utf-8"))
        p.unlink(missing_ok=True)
        return info if isinstance(info, dict) else None
    except Exception:
        return None


def setup_logging():
    paths.ensure_dirs()
    _finish_updater_swap()
    from logging.handlers import RotatingFileHandler
    h = RotatingFileHandler(paths.LOG_FILE, maxBytes=1_000_000, backupCount=1, encoding="utf-8")
    logging.basicConfig(level=logging.INFO, handlers=[h], format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    log = logging.getLogger("ludrix")

    def _thread_hook(args):
        if args.exc_type is not SystemExit:
            log.error("thread %s: %s", getattr(args.thread, "name", "?"), "".join(traceback.format_exception(args.exc_type, args.exc_value, args.exc_traceback)))
    threading.excepthook = _thread_hook

    def _sys_hook(t, v, tb):
        log.error("erro: %s", "".join(traceback.format_exception(t, v, tb)))
    sys.excepthook = _sys_hook


class Tray:

    def __init__(self, on_show, on_quit):
        self.icon = None
        self.on_show, self.on_quit = on_show, on_quit
        try:
            import pystray
            from PIL import Image
            img = Image.open(_icon_png()).convert("RGBA").resize((64, 64))
            menu = pystray.Menu(
                pystray.MenuItem("Abrir Ludrix", lambda: self.on_show(), default=True),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Sair", lambda: self.on_quit()),
            )
            self.icon = pystray.Icon("ludrix-launcher", img, APP_NAME, menu)
            threading.Thread(target=self.icon.run, daemon=True).start()
            if sys.platform != "win32":

                logging.getLogger("pystray._base").setLevel(logging.CRITICAL)
                threading.Thread(target=self._check_docked, daemon=True).start()
        except Exception as e:
            logging.warning("tray indisponível: %s", e)

    def _check_docked(self):
        time.sleep(2.5)
        ic = self.icon
        if ic is None:
            return
        try:
            docked = getattr(ic, "_systray_manager", True) if type(ic).__module__.endswith("_xorg") else True
            if type(ic).__module__.endswith("_dummy"):
                docked = False
        except Exception:
            docked = True
        if not docked:
            logging.warning("tray indisponível: sem área de notificação (instale libappindicator-gtk3 ou use uma barra com bandeja)")
            self.icon = None
            try:
                ic.stop()
            except Exception:
                pass

    def notify(self, msg: str):
        try:
            if self.icon:
                self.icon.notify(msg, APP_NAME)
        except Exception:
            pass

    def stop(self):
        try:
            if self.icon:
                self.icon.stop()
        except Exception:
            pass


_MUTEX = None


def _single_instance() -> bool:
    global _MUTEX
    if "--web" in sys.argv:
        return True
    if sys.platform == "win32":
        try:
            import ctypes
            k32 = ctypes.windll.kernel32
            from core import instance as _inst
            _MUTEX = k32.CreateMutexW(None, False, _inst.mutex_name("window"))
            if k32.GetLastError() == 183:
                if _inst.wake("window"):
                    return False
                ctypes.windll.user32.MessageBoxW(None, "O Ludrix desta pasta já está aberto.\n\nProcure a janela dele (ou o ícone perto do relógio) — não dá pra abrir dois ao mesmo tempo.",
                                                 "Ludrix já está em execução", 0x10 | 0x40000)
                return False
        except Exception as e:
            logging.getLogger("ludrix").debug("mutex: %s", e)
        return True
    lock = paths.DATA / "ludrix.pid"
    try:
        paths.DATA.mkdir(parents=True, exist_ok=True)
        if lock.exists():
            pid = int(lock.read_text().strip() or 0)
            if pid and pid != os.getpid():
                try:
                    os.kill(pid, 0)
                    print("Ludrix já está aberto (pid %d)." % pid)
                    return False
                except OSError:
                    pass
        lock.write_text(str(os.getpid()))
    except Exception:
        pass
    return True


def _apply_hicon(hwnd, ico):
    if sys.platform != "win32" or not ico.exists():
        return
    import ctypes
    u = ctypes.windll.user32
    big = max(32, u.GetSystemMetrics(11))
    small = max(16, u.GetSystemMetrics(49))
    for size, flag, cls in ((small, 0, -34), (big, 1, -14)):
        h = u.LoadImageW(None, str(ico), 1, size, size, 0x10)
        if h:
            u.SendMessageW(hwnd, 0x80, flag, h)
            try:
                u.SetClassLongPtrW(hwnd, cls, h)
            except Exception:
                u.SetClassLongW(hwnd, cls, h)


def _set_aumid(aumid):
    if sys.platform != "win32":
        return
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(aumid)
    except Exception:
        pass


def main():
    _set_aumid("Ludrix.App")
    if "--run-updater" in sys.argv:
        up = paths.APP / "updater.py"
        if not up.exists():
            up = up.with_suffix(".pyc")
        sys.argv = [str(up)] + sys.argv[sys.argv.index("--run-updater") + 1:]
        import runpy
        runpy.run_path(sys.argv[0], run_name="__main__")
        return
    if "--run-py" in sys.argv:
        i = sys.argv.index("--run-py")
        code, sys.argv = sys.argv[i + 1], [sys.argv[0]] + sys.argv[i + 2:]
        exec(compile(code, "<run-py>", "exec"), {"__name__": "__main__"})
        return
    if "--console" in sys.argv:
        import runpy
        c = paths.APP / "console.py"
        if not c.exists():
            c = c.with_suffix(".pyc")
        sys.argv = [str(c)] + [a for a in sys.argv[1:] if a != "--console"]
        runpy.run_path(str(c), run_name="__main__")
        return
    setup_logging()
    import time as _time
    _t_boot = _time.time()
    window_mode = "--web" not in sys.argv and "--selftest" not in sys.argv
    if window_mode:
        _update_guard()
    if not _single_instance():
        return
    from core import integrity
    try:
        integ = integrity.boot_check(paths.APP, paths.ROOT)
    except Exception as e:
        logging.getLogger("ludrix").warning("verificação de arquivos falhou: %s", e)
        integ = None
    if integ and integ.get("status") == "repaired":
        logging.getLogger("ludrix").warning("arquivos reparados a partir do pacote da versão: %s", [b["file"] for b in integ.get("fixed") or []])
    if integ and integ.get("status") == "damaged":
        logging.getLogger("ludrix").error("arquivos do launcher alterados/faltando: %s", [b["file"] for b in integ.get("bad") or []])
        if window_mode and integ.get("critical"):
            act = integrity.screen(integ, paths.ROOT)
            if act == "restore":
                _launch_repair()
                return
            if act != "continue":
                return
    safe = paths.boot_begin() if window_mode else False
    _fix_desktop_entries()
    from core import instance
    if "--web" not in sys.argv:
        instance.close_other("window")
    from core.server import serve, server_token
    from core.ludrix import Ludrix

    from core import diag
    selftest = "--selftest" in sys.argv
    ludrix = Ludrix()
    logging.getLogger("ludrix").info("núcleo pronto em %.2fs", _time.time() - _t_boot)
    if safe:
        ludrix.safe_mode = True
        ludrix.safe_saved = diag.enter_safe_mode(ludrix.store)
        logging.getLogger("ludrix").warning("modo seguro: duas aberturas seguidas não completaram; aparência voltou ao padrão")
    ludrix.rolled_back = _rolled_back_info() if window_mode else None
    ludrix.integrity_report(integ)
    ludrix.autostart_sync()

    if selftest:
        _, port = serve(ludrix, host="127.0.0.1", port=0)
        ok, text = diag.selftest(ludrix, port, server_token())
        ludrix.shutdown()
        if sys.stdout:
            print(text)
            sys.stdout.flush()
        os._exit(0 if ok else 3)

    if "--web" in sys.argv:
        i = sys.argv.index("--web")
        port = int(sys.argv[i + 1]) if len(sys.argv) > i + 1 else 8000
        _, port = serve(ludrix, host="0.0.0.0" if "--lan" in sys.argv else "127.0.0.1", port=port)
        instance.write("window", port, server_token())
        print(f"{APP_NAME}: http://localhost:{port}")

        def _web_quit():
            instance.clear()
            ludrix.shutdown()
            os._exit(0)
        ludrix.window_hooks = {"quit": lambda: threading.Timer(0.3, _web_quit).start()}
        while True:
            time.sleep(3600)

    os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = "--disable-features=msSmartScreenProtection --disable-background-networking"
    import webview
    _pin_webview2(webview)
    _, port = serve(ludrix, host="127.0.0.1", port=0)
    logging.getLogger("ludrix").info("servidor no ar em %.2fs", _time.time() - _t_boot)
    instance.write("window", port, server_token())

    frameless = bool(ludrix.store.config.get("frameless", True)) and sys.platform == "win32"
    start_hidden = "--minimized" in sys.argv and ludrix.store.config.get("tray_enabled", True)
    window = webview.create_window(APP_NAME, f"http://127.0.0.1:{port}/", width=1380, height=880,
                                   min_size=(1000, 660), background_color="#0b0b0e", text_select=False,
                                   frameless=frameless, easy_drag=False, hidden=start_hidden)

    state = {"hidden": start_hidden, "quitting": False}

    def show():
        try:
            window.show()
            window.restore()
            state["hidden"] = False
            if sys.platform == "win32":
                _bring_to_front()
                _fix_min_box()
        except Exception:
            pass

    def hide(msg: str | None = None):
        if ludrix.store.config.get("tray_enabled", True) and tray.icon:
            try:
                window.hide()
                state["hidden"] = True
                if msg is None:
                    msg = ("Minimizado na bandeja. O tempo de jogo continua sendo contado." if ludrix.sessions.active
                           else "O Ludrix continua na bandeja, perto do relógio. Clique no ícone pra abrir de novo.")
                if not state.get("tray_told"):
                    tray.notify(msg)
                    state["tray_told"] = True
            except Exception:
                pass
        else:
            try:
                window.minimize()
            except Exception:
                pass

    def quit_app():
        if state["quitting"]:
            return
        state["quitting"] = True
        instance.clear()
        ludrix.shutdown()
        if ludrix.gamepad:
            ludrix.gamepad.stop()
        tray.stop()
        try:
            window.destroy()
        except Exception:
            pass

    def win_min():
        window.minimize()

    def _fit_work_area():
        if sys.platform != "win32" or not frameless:
            return
        try:
            form = window.native
            if form is None:
                return
            from System import Func, Type
            from System.Windows.Forms import Screen

            def _apply():
                form.MaximizedBounds = Screen.FromHandle(form.Handle).WorkingArea
            form.Invoke(Func[Type](_apply))
        except Exception as e:
            logging.getLogger("ludrix").debug("MaximizedBounds: %s", e)

    def win_max():

        if state.get("max"):
            window.restore()
            state["max"] = False
        else:
            _fit_work_area()
            window.maximize()
            state["max"] = True
        return {"max": state["max"]}

    def win_close():
        threading.Timer(0.05, lambda: (on_closing() and None)).start()

    def _max_bounds(full: bool):
        if sys.platform != "win32" or not frameless:
            return
        try:
            form = window.native
            if form is None:
                return
            from System import Func, Type
            from System.Windows.Forms import Screen
            from System.Drawing import Rectangle

            def _apply():
                scr = Screen.FromHandle(form.Handle)
                form.MaximizedBounds = Rectangle.Empty if full else scr.WorkingArea
            form.Invoke(Func[Type](_apply))
        except Exception as e:
            logging.getLogger("ludrix").debug("MaximizedBounds(full): %s", e)

    def win_fullscreen(b: dict):
        want = bool((b or {}).get("on", not state.get("fs")))
        if want == bool(state.get("fs")):
            return {"fs": want}
        try:
            if want:
                _max_bounds(True)
                window.toggle_fullscreen()
            else:
                window.toggle_fullscreen()
                _max_bounds(False)
                if state.get("max"):
                    _fit_work_area()
                    window.maximize()
            state["fs"] = want
        except Exception as e:
            logging.getLogger("ludrix").debug("fullscreen: %s", e)
            return {"error": str(e)}
        return {"fs": want}

    def win_resize(b: dict, target=None, maxed: bool = False):
        d = str((b or {}).get("dir") or "")
        if target is None:
            target, maxed = window, bool(state.get("max"))
        if sys.platform != "win32" or not frameless or maxed or not d:
            return {"ok": False}
        try:
            import ctypes
            from System import Func, Type
            from System.Drawing import Rectangle
            from System.Windows.Forms import Cursor
            form = target.native
            box = {}

            def _grab():
                r = form.Bounds
                c = Cursor.Position
                m = form.MinimumSize
                box.update(x=r.X, y=r.Y, w=r.Width, h=r.Height, cx=c.X, cy=c.Y, mw=max(m.Width, 640), mh=max(m.Height, 420))
            form.Invoke(Func[Type](_grab))

            def _loop():
                gak = ctypes.windll.user32.GetAsyncKeyState
                while gak(0x01) & 0x8000:
                    cur = {}

                    def _pos():
                        c = Cursor.Position
                        cur.update(x=c.X, y=c.Y)
                    form.Invoke(Func[Type](_pos))
                    dx, dy = cur["x"] - box["cx"], cur["y"] - box["cy"]
                    x, y, w, h = box["x"], box["y"], box["w"], box["h"]
                    if "e" in d:
                        w = max(box["mw"], box["w"] + dx)
                    if "s" in d:
                        h = max(box["mh"], box["h"] + dy)
                    if "w" in d:
                        w = max(box["mw"], box["w"] - dx)
                        x = box["x"] + box["w"] - w
                    if "n" in d:
                        h = max(box["mh"], box["h"] - dy)
                        y = box["y"] + box["h"] - h

                    def _set():
                        form.Bounds = Rectangle(x, y, w, h)
                    form.Invoke(Func[Type](_set))
                    time.sleep(0.012)
            threading.Thread(target=_loop, daemon=True).start()
            return {"ok": True}
        except Exception as e:
            logging.getLogger("ludrix").debug("resize: %s", e)
            return {"ok": False, "error": str(e)}

    def win_snapshot():
        if sys.platform != "win32":
            return {"data": ""}
        try:
            import base64
            from io import BytesIO
            from PIL import ImageGrab
            form = window.native
            from System import Func, Type

            box = {}

            def _rect():
                r = form.RectangleToScreen(form.ClientRectangle)
                box.update(l=r.Left, t=r.Top, r=r.Right, b=r.Bottom)
            form.Invoke(Func[Type](_rect))
            img = ImageGrab.grab(bbox=(box["l"], box["t"], box["r"], box["b"]), all_screens=True)
            img.thumbnail((960, 600))
            buf = BytesIO()
            img.save(buf, "PNG", optimize=True)
            return {"data": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()}
        except Exception as e:
            logging.getLogger("ludrix").debug("snapshot: %s", e)
            return {"data": ""}

    term = {"win": None}

    def term_open():
        w = term["win"]
        if w is not None:
            try:
                w.show()
                w.restore()
                return {"ok": True}
            except Exception:
                term["win"] = None

        w = webview.create_window("Ludrix — Terminal", f"http://127.0.0.1:{port}/terminal", width=860, height=520,
                                  min_size=(520, 300), background_color="#0b0b0e", text_select=True,
                                  frameless=frameless, easy_drag=False)
        term["win"] = w
        term["max"] = False
        w.events.closed += lambda: term.__setitem__("win", None)
        return {"ok": True}

    def term_resize(b: dict):
        w = term["win"]
        if w is None:
            return {"error": "terminal fechado"}
        return win_resize(b, w, bool(term.get("max")))

    def _term(fn):
        def _f():
            w = term["win"]
            if w is None:
                return {"error": "terminal fechado"}
            getattr(w, fn)()
            return {"ok": True}
        return _f

    def term_max():
        w = term["win"]
        if w is None:
            return {"error": "terminal fechado"}
        if term.get("max"):
            w.restore()
        else:
            if sys.platform == "win32" and frameless:
                try:
                    from System import Func, Type
                    from System.Windows.Forms import Screen
                    form = w.native
                    form.Invoke(Func[Type](lambda: setattr(form, "MaximizedBounds", Screen.FromHandle(form.Handle).WorkingArea)))
                except Exception:
                    pass
            w.maximize()
        term["max"] = not term.get("max")
        return {"ok": True, "max": term["max"]}

    pops = []

    def popup_open(b: dict):
        w = webview.create_window(f"{b.get('title') or APP_NAME} — {APP_NAME}", b["url"], width=max(640, min(int(b.get("w") or 1280), 1920)),
                                  height=max(480, min(int(b.get("h") or 760), 1200)), min_size=(480, 360), background_color="#0b0d12", text_select=False)
        pops.append(w)
        w.events.closed += lambda: pops.remove(w) if w in pops else None
        return {"ok": True}

    def ctx_open(b: dict):
        if sys.platform != "win32" or not frameless:
            return {"ok": False}
        import ctypes
        from ctypes import wintypes
        from System import Func, Type
        u = ctypes.windll.user32
        u.CreatePopupMenu.restype = ctypes.c_void_p
        u.AppendMenuW.argtypes = (ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_wchar_p)
        u.InsertMenuW.argtypes = (ctypes.c_void_p, ctypes.c_uint, ctypes.c_uint, ctypes.c_size_t, ctypes.c_wchar_p)
        u.SetMenuDefaultItem.argtypes = (ctypes.c_void_p, ctypes.c_uint, ctypes.c_uint)
        u.TrackPopupMenuEx.argtypes = (ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)
        u.TrackPopupMenuEx.restype = ctypes.c_int
        u.DestroyMenu.argtypes = (ctypes.c_void_p,)
        u.SetForegroundWindow.argtypes = (ctypes.c_void_p,)
        u.PostMessageW.argtypes = (ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_ssize_t)
        hwnd = int(window.native.Handle.ToInt64())
        ids = {}

        def build(items, pre):
            m = u.CreatePopupMenu()
            for i, it in enumerate(items):
                if it.get("sep"):
                    u.AppendMenuW(m, 0x800, 0, None)
                    continue
                label = str(it.get("label") or "").replace("&", "&&")
                if it.get("hint"):
                    label += "\t" + str(it["hint"])
                if it.get("sub"):
                    u.AppendMenuW(m, 0x10, build(it["sub"], pre + str(i) + "."), label)
                    continue
                n = len(ids) + 1
                ids[n] = pre + str(i)
                u.AppendMenuW(m, 0x1 if it.get("disabled") else 0, n, label)
                if it.get("primary"):
                    u.SetMenuDefaultItem(m, n, 0)
            return m

        try:
            ux = ctypes.WinDLL("uxtheme")
            mode = ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_int)((135, ux))
            flush = ctypes.WINFUNCTYPE(None)((136, ux))
            mode(3 if str(b.get("light")) == "1" else 2)
            flush()
        except Exception:
            pass
        title = str(b.get("title") or "")[:60].replace("&", "&&")
        items = list(b.get("items") or [])
        if str(b.get("at_cursor")) == "1":
            pt = wintypes.POINT()
            u.GetCursorPos(ctypes.byref(pt))
            x, y = pt.x, pt.y
        else:
            try:
                dpi = u.GetDpiForWindow(ctypes.c_void_p(hwnd)) or 96
            except Exception:
                dpi = 96
            x, y = int(round(float(b.get("x") or 0) * dpi / 96)), int(round(float(b.get("y") or 0) * dpi / 96))
        out = {"pick": None}

        def run():
            m = build(items, "")
            if title:
                u.InsertMenuW(m, 0, 0x400 | 0x800, 0, None)
                u.InsertMenuW(m, 0, 0x400 | 0x1, 0, title)
            try:
                u.SetForegroundWindow(hwnd)
                r = u.TrackPopupMenuEx(m, 0x100 | 0x2 | 0x80, x, y, hwnd, None)
                u.PostMessageW(hwnd, 0, 0, 0)
                out["pick"] = ids.get(int(r))
            finally:
                u.DestroyMenu(m)
        try:
            window.native.Invoke(Func[Type](run))
        except Exception as e:
            logging.warning("ctx: %s", e)
            return {"ok": False}
        return {"ok": True, "pick": out["pick"]}

    frame_last = {}

    def win_frame(body):
        if sys.platform != "win32":
            return {}
        hwnd = _hwnd()
        if not hwnd:
            return {}
        import ctypes
        import re as _re
        try:
            dwm = ctypes.windll.dwmapi
        except Exception:
            return {}

        def put(attr, val):
            v = ctypes.c_uint32(val & 0xFFFFFFFF)
            try:
                dwm.DwmSetWindowAttribute(ctypes.c_void_p(hwnd), ctypes.c_uint32(attr), ctypes.byref(v), ctypes.sizeof(v))
            except Exception:
                pass

        def cref(hx):
            m = _re.match(r"^#([0-9a-fA-F]{6})$", str(hx or ""))
            if not m:
                return None
            r, g, b = int(m.group(1)[0:2], 16), int(m.group(1)[2:4], 16), int(m.group(1)[4:6], 16)
            return r | (g << 8) | (b << 16)
        want = {k: body.get(k) for k in ("mode", "bg", "text", "border", "dark", "corners")}
        if want == frame_last:
            return {}
        frame_last.clear()
        frame_last.update(want)
        put(20, 1 if body.get("dark") else 0)
        if (body.get("mode") or "theme") == "windows":
            for attr in (34, 35, 36):
                put(attr, 0xFFFFFFFF)
        else:
            bg, tx, bd = cref(body.get("bg")), cref(body.get("text")), cref(body.get("border") or body.get("bg"))
            if bg is not None:
                put(35, bg)
            if tx is not None:
                put(36, tx)
            if bd is not None:
                put(34, bd)
        put(33, {"round": 2, "small": 3, "square": 1}.get(body.get("corners") or "", 0))
        return {}

    tray = Tray(on_show=show, on_quit=quit_app)
    ludrix.window_hooks = {"frame": win_frame, "hide": hide, "show": show, "quit": quit_app, "minimize": win_min, "maximize": win_max, "close": win_close,
                          "frameless": lambda: {"frameless": frameless}, "snapshot": win_snapshot, "resize": win_resize, "fullscreen": win_fullscreen,
                          "terminal": term_open, "terminal_minimize": _term("minimize"), "terminal_maximize": term_max,
                          "terminal_close": _term("destroy"), "terminal_resize": term_resize, "popup": popup_open, "ctx": ctx_open}

    try:
        from core.gamepad import GamepadWatcher

        def on_wake(why):
            show()
            try:
                window.evaluate_js(f"window.onGamepadWake && onGamepadWake('{why}')")
            except Exception:
                pass
        ludrix.gamepad = GamepadWatcher(ludrix.store, on_wake)
        if ludrix.store.config.get("gamepad_wake"):
            ludrix.gamepad.start()
    except Exception as e:
        logging.warning("gamepad: %s", e)

    def pick_folder(initial_dir=""):
        try:
            r = window.create_file_dialog(webview.FOLDER_DIALOG, directory=initial_dir or "")
        except Exception:
            r = window.create_file_dialog(webview.FOLDER_DIALOG)
        return r[0] if r else None

    def pick_file(initial_dir, kind="exe"):
        r = window.create_file_dialog(webview.OPEN_DIALOG, directory=initial_dir or "", file_types=_PICK_TYPES.get(kind, _PICK_TYPES["exe"]))
        return r[0] if r else None

    def pick_files(initial_dir, kind="theme"):
        r = window.create_file_dialog(webview.OPEN_DIALOG, directory=initial_dir or "", allow_multiple=True, file_types=_PICK_TYPES.get(kind, _PICK_TYPES["any"]))
        return [str(x) for x in r] if r else []

    ludrix.pick_folder, ludrix.pick_file, ludrix.pick_files = pick_folder, pick_file, pick_files

    def on_closing():
        if state["quitting"]:
            return True
        can_tray = bool(ludrix.store.config.get("tray_enabled", True) and tray.icon)
        action = ludrix.store.config.get("close_action", "ask") if can_tray else "quit"
        if action == "quit" and (not ludrix.sessions.active or not can_tray):
            quit_app()
            return True
        if action in ("quit", "tray"):
            hide()
            return False

        def _ask():
            try:
                window.evaluate_js("window.onCloseAsk ? onCloseAsk() : 0")
            except Exception:
                hide()
        threading.Thread(target=_ask, daemon=True).start()
        return False

    window.events.closing += on_closing

    def _hwnd():
        try:
            form = window.native
            if form is not None:
                return int(str(form.Handle))
        except Exception:
            pass
        try:
            import ctypes
            return ctypes.windll.user32.FindWindowW(None, APP_NAME) or 0
        except Exception:
            return 0

    def _fix_min_box():
        if sys.platform != "win32":
            return False
        try:
            import ctypes
            hwnd = _hwnd()
            if not hwnd:
                return False
            u = ctypes.windll.user32
            GWL_STYLE, WS_SYSMENU, WS_MINIMIZEBOX, WS_MAXIMIZEBOX = -16, 0x00080000, 0x00020000, 0x00010000
            want = WS_MINIMIZEBOX | WS_MAXIMIZEBOX | (WS_SYSMENU if frameless else 0)
            style = u.GetWindowLongW(hwnd, GWL_STYLE)
            if (style & want) != want:
                u.SetWindowLongW(hwnd, GWL_STYLE, style | want)
                u.SetWindowPos(hwnd, 0, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0004 | 0x0020)
            return True
        except Exception as e:
            logging.getLogger("ludrix").debug("minimizebox: %s", e)
            return False

    def set_icon():

        if sys.platform != "win32":
            return
        try:
            import ctypes
            hwnd = 0
            for _ in range(40):
                time.sleep(0.25)
                hwnd = _hwnd()
                if hwnd:
                    break
            if hwnd:
                _apply_hicon(hwnd, _icon_ico())
            _fix_min_box()
        except Exception as e:
            logging.warning("ícone: %s", e)

    threading.Thread(target=set_icon, daemon=True).start()

    if sys.platform == "win32":
        try:
            from core import taskbar
            taskbar.watch(ludrix, _hwnd)
        except Exception as e:
            logging.getLogger("ludrix").debug("taskbar: %s", e)

    threading.Timer(2.0, _fit_work_area).start()

    try:
        paths.qt_light_env()
        webview.start(debug="--debug" in sys.argv, private_mode=False, storage_path=str(paths.CACHE / "webview"),
                      icon=_window_icon(), gui=_gui_backend())
    finally:
        quit_app()


def _bring_to_front():
    try:
        import ctypes
        u = ctypes.windll.user32
        hwnd = u.FindWindowW(None, APP_NAME)
        if not hwnd:
            return
        if u.IsIconic(hwnd):
            u.ShowWindow(hwnd, 9)

        fg = u.GetForegroundWindow()
        cur = ctypes.windll.kernel32.GetCurrentThreadId()
        other = u.GetWindowThreadProcessId(fg, None)
        if other and other != cur:
            u.AttachThreadInput(other, cur, True)
        u.SetForegroundWindow(hwnd)
        u.BringWindowToTop(hwnd)
        if other and other != cur:
            u.AttachThreadInput(other, cur, False)
    except Exception:
        pass


def _webview2_folder():
    bases = [os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"), os.environ.get("LOCALAPPDATA")]
    for sub in (r"Microsoft\EdgeWebView\Application", r"Microsoft\Edge\Application"):
        for b in bases:
            if not b:
                continue
            d = Path(b) / sub
            if not d.is_dir():
                continue
            vers = [x for x in d.iterdir() if x.is_dir() and x.name[:1].isdigit() and (x / "msedgewebview2.exe").exists()]
            if vers:
                vers.sort(key=lambda x: [int(n) if n.isdigit() else 0 for n in x.name.split(".")])
                return vers[-1]
    return None


def _webview2_registered() -> bool:
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full") as k:
            if int(winreg.QueryValueEx(k, "Release")[0]) < 394802:
                return False
    except Exception:
        return False
    from core import diag
    return bool(diag.webview2_version())


def _pin_webview2(webview):
    if sys.platform != "win32":
        return
    log = logging.getLogger("ludrix")
    try:
        emb = paths.ROOT / "runtime" / "webview2"
        if (emb / "msedgewebview2.exe").exists():
            webview.settings["WEBVIEW2_RUNTIME_PATH"] = str(emb)
            try:
                ver = (emb / "VERSION").read_text(encoding="utf-8").strip()
            except Exception:
                ver = "?"
            log.info("WebView2 embutido %s", ver)
            return
        if _webview2_registered():
            return
        folder = _webview2_folder()
        if folder:
            webview.settings["WEBVIEW2_RUNTIME_PATH"] = str(folder)
            log.warning("WebView2 não consta no registro; usando %s", folder)
            return
        log.error("WebView2 Runtime não encontrado; a janela vai abrir com o motor antigo do Windows")
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, "O Microsoft Edge WebView2 Runtime não foi encontrado.\n\nInstale em: https://developer.microsoft.com/microsoft-edge/webview2/\n\nSem ele a janela do LudrixHub não funciona.", APP_NAME, 0x30)
        except Exception:
            pass
    except Exception as e:
        log.warning("WebView2: %s", e)


def _gui_backend():
    if sys.platform == "win32":
        return "edgechromium"
    try:
        import importlib.util
        if importlib.util.find_spec("PyQt6") and importlib.util.find_spec("PyQt6.QtWebEngineWidgets"):
            return "qt"
    except Exception:
        pass
    return None


def _window_icon():

    if sys.platform == "win32":
        ico = _icon_ico()
        if not ico.exists():
            return None
        try:
            import ctypes
            h = ctypes.windll.user32.LoadImageW(None, str(ico), 1, 0, 0, 0x10)
            if not h:
                return None
            ctypes.windll.user32.DestroyIcon(h)
            return str(ico)
        except Exception:
            return None
    png = _icon_png()
    return str(png) if png.exists() else None


def _fix_desktop_entries():
    if sys.platform == "win32" or paths.APPIMAGE:
        return
    try:
        cfg = Path.home() / ".config/ludrixhub"
        f = cfg / "path"
        if not cfg.exists():
            return
        cur = str(paths.ROOT)
        if not f.exists() or f.read_text(encoding="utf-8").strip() != cur:
            f.write_text(cur + "\n", encoding="utf-8")
            logging.getLogger("ludrix").info("caminho do atalho atualizado: %s", cur)
    except Exception as e:
        logging.getLogger("ludrix").debug("desktop path: %s", e)


def _fatal_dialog(msg: str):
    try:
        if sys.platform == "win32":
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, msg, APP_NAME, 0x10)
            return
        import shutil
        import subprocess
        if shutil.which("kdialog"):
            subprocess.run(["kdialog", "--title", APP_NAME, "--error", msg], timeout=120)
        elif shutil.which("zenity"):
            subprocess.run(["zenity", "--error", "--title", APP_NAME, "--width", "520", "--text", msg], timeout=120)
        elif shutil.which("notify-send"):
            subprocess.run(["notify-send", f"{APP_NAME} não abriu", msg[:200]], timeout=10)
    except Exception:
        pass


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as e:
        logging.error(traceback.format_exc())
        msg = str(e)
        if sys.platform != "win32" and ("QT or GTK" in msg or "webview" in msg.lower()):
            msg = ("Falta o motor da janela (Qt WebEngine).\n\nRode de novo, dentro da pasta do Ludrix:\n    sh install-linux.sh\n\n"
                   "Se o aviso continuar, instale pelo sistema:\n    Arch/CachyOS: sudo pacman -S python-pyqt6-webengine\n\n" + msg)
        _fatal_dialog(f"{msg}\n\nLog: {paths.LOG_FILE}")
        print(traceback.format_exc(), file=sys.stderr)
        sys.exit(1)
