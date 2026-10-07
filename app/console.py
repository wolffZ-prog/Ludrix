from __future__ import annotations

import logging
import os
import sys
import threading
import time
import traceback

from core import paths

APP_NAME = "LudrixHub Console"
WIN_TITLE = "LudrixHub Console"
ICON_PNG = paths.UI / "console" / "icon.png"
ICON_ICO = paths.ASSETS / "console.ico"
_MUTEX = None


def setup_logging():
    paths.DATA.mkdir(parents=True, exist_ok=True)
    from logging.handlers import RotatingFileHandler
    h = RotatingFileHandler(paths.DATA / "ludrix-console.log", maxBytes=1_000_000, backupCount=1, encoding="utf-8")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", handlers=[h, logging.StreamHandler()])


def _single_instance() -> bool:
    global _MUTEX
    if "--web" in sys.argv:
        return True
    if sys.platform == "win32":
        try:
            import ctypes
            k32 = ctypes.windll.kernel32
            _MUTEX = k32.CreateMutexW(None, False, "Local\\LudrixConsole-SingleInstance")
            if k32.GetLastError() == 183:
                ctypes.windll.user32.MessageBoxW(None, "O Modo Console já está aberto.", APP_NAME, 0x10 | 0x40000)
                return False
        except Exception as e:
            logging.getLogger("console").debug("mutex: %s", e)
    return True


def _hwnd(title: str) -> int:
    try:
        import ctypes
        return ctypes.windll.user32.FindWindowW(None, title)
    except Exception:
        return 0


def _real_fullscreen(window):
    try:
        if sys.platform == "win32" and window.native is not None:
            from System import Func, Type
            from System.Windows.Forms import Screen, FormBorderStyle, FormWindowState
            from System.Drawing import Rectangle
            form = window.native

            def _apply():
                form.MaximizedBounds = Rectangle.Empty
                form.FormBorderStyle = FormBorderStyle(0)
                form.Bounds = Screen.FromHandle(form.Handle).Bounds
                form.WindowState = FormWindowState.Maximized
                form.TopMost = False
            form.Invoke(Func[Type](_apply))
        else:
            pass
    except Exception as e:
        logging.getLogger("console").debug("fullscreen: %s", e)
        try:
            window.toggle_fullscreen()
        except Exception:
            pass


def main():
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Ludrix.Console")
        except Exception:
            pass
    setup_logging()
    log = logging.getLogger("console")
    if not _single_instance():
        return
    from core import instance
    from core.server import serve, server_token
    from core.ludrix import Ludrix

    web = "--web" in sys.argv
    if not web:
        instance.close_other("console")

    ludrix = Ludrix()
    port_req = 0
    if web:
        i = sys.argv.index("--web")
        port_req = int(sys.argv[i + 1]) if len(sys.argv) > i + 1 else 8130
    _, port = serve(ludrix, host="0.0.0.0" if web and "--lan" in sys.argv else "127.0.0.1", port=port_req)
    instance.write("console", port, server_token())
    url = f"http://127.0.0.1:{port}/console"
    if web:
        print(f"{APP_NAME}: http://localhost:{port}/console")

        def _web_quit():
            instance.clear()
            ludrix.shutdown()
            os._exit(0)
        ludrix.window_hooks = {"quit": lambda: threading.Timer(0.3, _web_quit).start()}
        try:
            while True:
                time.sleep(3600)
        finally:
            instance.clear()
        return

    os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = "--disable-features=msSmartScreenProtection --disable-background-networking"
    import webview
    window = webview.create_window(WIN_TITLE, url, width=1280, height=720, min_size=(960, 540), background_color="#0c0d10",
                                   text_select=False, frameless=sys.platform == "win32", easy_drag=False,
                                   fullscreen=sys.platform != "win32")
    state = {"quitting": False}

    def quit_app():
        if state["quitting"]:
            return
        state["quitting"] = True
        instance.clear()
        ludrix.shutdown()
        try:
            window.destroy()
        except Exception:
            pass

    def to_window():
        r = instance.launch("window")
        threading.Timer(0.8, quit_app).start()
        return r

    def hide():
        try:
            window.minimize()
        except Exception:
            pass

    def show():
        try:
            window.restore()
            if sys.platform == "win32":
                _real_fullscreen(window)
                hwnd = _hwnd(WIN_TITLE)
                if hwnd:
                    import ctypes
                    ctypes.windll.user32.SetForegroundWindow(hwnd)
        except Exception:
            pass

    ludrix.window_hooks = {"hide": hide, "show": show, "quit": quit_app, "minimize": hide, "to_window": to_window,
                           "fullscreen": lambda b=None: (_real_fullscreen(window), {"fs": True})[1]}

    def on_closing():
        if state["quitting"]:
            return True
        quit_app()
        return True
    window.events.closing += on_closing

    def after_start():

        for _ in range(40):
            time.sleep(0.25)
            if sys.platform != "win32" or _hwnd(WIN_TITLE):
                break
        _real_fullscreen(window)
        if sys.platform == "win32":
            try:
                import ctypes
                hwnd = _hwnd(WIN_TITLE)
                if hwnd and ICON_ICO.exists():
                    u = ctypes.windll.user32
                    big, small = max(32, u.GetSystemMetrics(11)), max(16, u.GetSystemMetrics(49))
                    for size, flag, cls in ((small, 0, -34), (big, 1, -14)):
                        h = u.LoadImageW(None, str(ICON_ICO), 1, size, size, 0x10)
                        if h:
                            u.SendMessageW(hwnd, 0x80, flag, h)
                            try:
                                u.SetClassLongPtrW(hwnd, cls, h)
                            except Exception:
                                u.SetClassLongW(hwnd, cls, h)
            except Exception as e:
                log.debug("ícone: %s", e)

    threading.Thread(target=after_start, daemon=True).start()
    try:
        gui = "edgechromium" if sys.platform == "win32" else None
        if gui is None:
            import importlib.util
            if importlib.util.find_spec("PyQt6") and importlib.util.find_spec("PyQt6.QtWebEngineWidgets"):
                gui = "qt"
        paths.qt_light_env()
        webview.start(debug="--debug" in sys.argv, private_mode=False, storage_path=str(paths.CACHE / "webview-console"),
                      icon=str(ICON_ICO) if sys.platform == "win32" and ICON_ICO.exists() else (str(ICON_PNG) if ICON_PNG.exists() else None),
                      gui=gui)
    finally:
        quit_app()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as e:
        logging.error(traceback.format_exc())
        try:
            from main import _fatal_dialog
            _fatal_dialog(f"{e}\n\nLog: {paths.DATA / 'ludrix-console.log'}")
        except Exception:
            pass
        print(traceback.format_exc(), file=sys.stderr)
        sys.exit(1)
