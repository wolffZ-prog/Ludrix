from __future__ import annotations

import hashlib
import json
import os
import py_compile
import re
import shutil
import subprocess
import sys
import threading
import time
import zipfile
from pathlib import Path

import lxsign

PROTECTED = {"data", "cache", "games", "emulation", "downloads", "themes", "flash", "bin", "tools", "updates"}


def updates_dir(root: Path) -> Path:
    d = root / "data" / "updates"
    if not d.exists() and (root / "updates").is_dir():
        return root / "updates"
    return d
APP = "LudrixHub"


def sha256_of(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes
        k32 = ctypes.windll.kernel32
        h = k32.OpenProcess(0x1000, False, pid)
        if not h:
            return False
        code = ctypes.c_ulong()
        ok = k32.GetExitCodeProcess(h, ctypes.byref(code))
        k32.CloseHandle(h)
        return bool(ok) and code.value == 259
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def kill_pid(pid: int):
    if pid <= 0:
        return
    try:
        if os.name == "nt":
            import ctypes
            k32 = ctypes.windll.kernel32
            h = k32.OpenProcess(0x0001, False, pid)
            if h:
                k32.TerminateProcess(h, 1)
                k32.CloseHandle(h)
            else:
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, creationflags=0x08000000)
        else:
            import signal
            os.kill(pid, signal.SIGKILL)
    except Exception:
        pass


def kill_stray_launchers(root: Path):
    me = os.getpid()
    try:
        if os.name == "nt":

            ps = "Get-Process Ludrix,LudrixConsole -ErrorAction SilentlyContinue | ForEach-Object { \"$($_.Id)|$($_.Path)\" }"
            q = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                               capture_output=True, text=True, creationflags=0x08000000, timeout=20)
            if q.returncode != 0 and not q.stdout.strip():
                for exe in ("Ludrix.exe", "LudrixConsole.exe"):
                    subprocess.run(["taskkill", "/IM", exe, "/T", "/F"], capture_output=True, creationflags=0x08000000)
                return
            for line in q.stdout.splitlines():
                pid, _, path = line.strip().partition("|")
                if not pid.isdigit() or int(pid) == me:
                    continue
                try:
                    same = Path(path).resolve().parent == root.resolve() if path else True
                except Exception:
                    same = True
                if same:
                    kill_pid(int(pid))
        else:
            for entry in ("main.py", "console.py"):
                q = subprocess.run(["pgrep", "-f", str(root.resolve() / "app" / entry)], capture_output=True, text=True, timeout=10)
                for pid in q.stdout.split():
                    if pid.isdigit() and int(pid) != me:
                        kill_pid(int(pid))
    except Exception:
        pass


def rmtree_retry(p: Path, tries=8):
    for i in range(tries):
        try:
            if p.exists():
                shutil.rmtree(p)
            return
        except Exception:
            time.sleep(0.4 * (i + 1))
    if p.exists():
        shutil.rmtree(p)


def argv_opt(name: str, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


class Apply:
    consume = True

    def __init__(self, pkg: Path, root: Path, log, progress):
        self.pkg, self.root, self.log, self.progress = pkg, root, log, progress
        self.manifest: dict = {}
        self.backup: Path | None = None

    def _members(self, z: zipfile.ZipFile, d: str) -> list[tuple[str, str]]:
        return [(n, n) for n in z.namelist() if n.startswith(d + "/") and not n.endswith("/")]

    def read(self) -> dict:
        with zipfile.ZipFile(self.pkg) as z:
            m = json.loads(z.read("manifest.json").decode("utf-8"))
        for d in m.get("dirs") or []:
            if d in PROTECTED or "/" in d or "\\" in d or d.startswith("."):
                raise RuntimeError(f"pacote invalido: pasta protegida {d}")
        for f in m.get("files") or {}:
            top = f.split("/")[0]
            if top in PROTECTED or ".." in f or f.startswith("/") or f.startswith("."):
                raise RuntimeError(f"pacote invalido: arquivo {f}")
        m["signed"] = lxsign.status(self.pkg)
        if self.consume and m["signed"] != "ok":
            raise RuntimeError("esse pacote nao tem a assinatura do Ludrix - por seguranca, nao instalo" if m["signed"] == "none" else "a assinatura desse pacote nao confere - o arquivo foi alterado ou nao veio do Ludrix")
        self.manifest = m
        return m

    def run(self, wait_pid: int):
        m = self.manifest or self.read()
        ver = m["version"]
        dirs = list(m.get("dirs") or [])
        self.progress(0.0, "Preparando...")
        files = dict(m.get("files") or {})
        total = 5 + len(dirs) * 2 + len(files)
        step = [0]

        def tick(txt):
            step[0] += 1
            self.progress(min(step[0] / total, 0.99), txt)

        if wait_pid:
            self.log("Aguardando o launcher fechar...")
            t0 = time.time()
            while pid_alive(wait_pid):
                time.sleep(0.25)
                if time.time() - t0 > 6:
                    self.log("O launcher nao fechou sozinho - encerrando a forca...")
                    kill_pid(wait_pid)
                    break
            t0 = time.time()
            while pid_alive(wait_pid) and time.time() - t0 < 10:
                time.sleep(0.25)
            if pid_alive(wait_pid):
                raise RuntimeError("nao consegui encerrar o launcher (PID %d) - feche-o pelo Gerenciador de Tarefas e tente de novo" % wait_pid)
            time.sleep(0.6)
        kill_stray_launchers(self.root)
        tick("Launcher fechado")

        self.log("Verificando pacote...")
        with zipfile.ZipFile(self.pkg) as z:
            bad = z.testzip()
            if bad:
                raise RuntimeError(f"pacote corrompido em {bad}")
            names = set(z.namelist())
            for d in dirs:
                if not self._members(z, d):
                    raise RuntimeError(f"pacote incompleto: falta {d}/")
            for f, digest in files.items():
                if f not in names:
                    raise RuntimeError(f"pacote incompleto: falta {f}")
        tick("Pacote integro")

        try:
            prev = json.loads((self.root / "app" / "version.json").read_text(encoding="utf-8")).get("version", "")
        except Exception:
            prev = ""
        self.backup = updates_dir(self.root) / "backup" / f"antes-de-{ver}"
        rmtree_retry(self.backup)
        self.backup.mkdir(parents=True, exist_ok=True)
        for d in dirs:
            src = self.root / d
            if src.exists():
                self.log(f"Backup de {d}/")
                shutil.copytree(src, self.backup / d)
            tick(f"Backup de {d}/")
        for f in files:
            src = self.root / f
            if src.exists():
                dst = self.backup / f
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
        tick("Backup pronto")

        with zipfile.ZipFile(self.pkg) as z:
            for d in dirs:
                self.log(f"Removendo {d}/ antigo")
                rmtree_retry(self.root / d)
                self.log(f"Instalando {d}/ novo")
                for n, rel in self._members(z, d):
                    target = (self.root / rel).resolve()
                    if self.root.resolve() not in target.parents:
                        raise RuntimeError(f"caminho suspeito no pacote: {n}")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with z.open(n) as s, open(target, "wb") as o:
                        shutil.copyfileobj(s, o, 1 << 20)
                tick(f"{d}/ atualizado")

            for f, digest in files.items():
                self.log(f"Trocando {f}")
                target = self.root / f
                tmp = target.with_name(target.name + ".new")
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(f) as s, open(tmp, "wb") as o:
                    shutil.copyfileobj(s, o, 1 << 20)
                if digest and sha256_of(tmp).lower() != str(digest).lower():
                    tmp.unlink(missing_ok=True)
                    raise RuntimeError(f"{f}: sha256 nao confere")
                me = Path(sys.executable).resolve() if getattr(sys, "frozen", False) else None
                if me and target.resolve() == me:

                    old = target.with_name(target.name + ".old")
                    old.unlink(missing_ok=True)
                    try:
                        os.replace(target, old)
                        os.replace(tmp, target)
                    except Exception:
                        pass
                else:
                    for i in range(8):
                        try:
                            os.replace(tmp, target)
                            break
                        except PermissionError:
                            time.sleep(0.4 * (i + 1))
                    else:
                        os.replace(tmp, target)
                tick(f"{f} ok")

        for pc in (self.root / "app").rglob("__pycache__"):
            shutil.rmtree(pc, ignore_errors=True)
        if (self.root / "runtime").is_dir():
            self.log("Compilando...")
            compile_app(self.root / "app")
        vf = self.root / "app" / "version.json"
        try:
            cur = json.loads(vf.read_text(encoding="utf-8")) if vf.exists() else {}
        except Exception:
            cur = {}
        cur.update(version=ver, date=m.get("date", ""), channel=m.get("channel", cur.get("channel", "stable")))
        vf.parent.mkdir(parents=True, exist_ok=True)
        vf.write_text(json.dumps(cur, indent=2, ensure_ascii=False), encoding="utf-8")
        try:
            (updates_dir(self.root) / "pending_verify.json").write_text(json.dumps({
                "version": ver, "from": prev, "kind": m.get("kind", ""), "backup": str(self.backup), "dirs": dirs, "files": list(files), "at": time.time()}), encoding="utf-8")
            (self.root / "data" / "boot.json").write_text(json.dumps({"tries": 0}), encoding="utf-8")
        except Exception:
            pass

        self._keep_seed(ver)
        bdir = updates_dir(self.root) / "backup"
        for b in sorted(bdir.iterdir(), key=lambda p: p.stat().st_mtime)[:-2] if bdir.exists() else []:
            shutil.rmtree(b, ignore_errors=True)
        self.progress(1.0, "Concluido")

    def _keep_seed(self, ver: str):
        d = updates_dir(self.root)
        dest = d / f"seed-{ver}{self.pkg.suffix.lower()}"
        try:
            d.mkdir(parents=True, exist_ok=True)
            for old in d.glob("seed-*"):
                if old != dest:
                    old.unlink(missing_ok=True)
            if dest.exists():
                dest.unlink()
            if self.consume:
                try:
                    os.replace(self.pkg, dest)
                except OSError:
                    shutil.copy2(self.pkg, dest)
                    self.pkg.unlink(missing_ok=True)
            else:
                shutil.copy2(self.pkg, dest)
            self.log("Pacote guardado para reparos futuros")
        except Exception:
            if self.consume:
                try:
                    self.pkg.unlink()
                except Exception:
                    pass

    def rollback(self):
        if not self.backup or not self.backup.exists():
            return
        self.log("Restaurando versao anterior...")
        for d in (self.manifest.get("dirs") or []):
            b = self.backup / d
            if b.exists():
                rmtree_retry(self.root / d)
                shutil.copytree(b, self.root / d)
        for f in (self.manifest.get("files") or {}):
            b = self.backup / f
            if b.exists():
                try:
                    shutil.copy2(b, self.root / f)
                except Exception:
                    pass


class Restore(Apply):
    consume = False

    def __init__(self, pkg: Path, root: Path, log, progress):
        super().__init__(pkg, root, log, progress)
        self.prefix = ""

    def read(self) -> dict:
        with zipfile.ZipFile(self.pkg) as z:
            names = z.namelist()
            if "manifest.json" in names:
                m = super().read()
                m["restore"] = True
                m["kind"] = "restore"
                m["title"] = f"Voltar para a versao {m['version']}"
                return m
            vj = next((n for n in names if n.endswith("app/version.json") and n.count("/") <= 2), None)
            if not vj:
                raise RuntimeError("esse zip nao e um codigo-fonte do Ludrix (falta app/version.json)")
            self.prefix = vj[: -len("app/version.json")]
            try:
                vinfo = json.loads(z.read(vj).decode("utf-8"))
            except Exception:
                vinfo = {}
            ver = vinfo.get("version") or ""
            if not re.match(r"^\d+\.\d+\.\d+", ver):
                raise RuntimeError("versao ilegivel em app/version.json")
            for need in ("app/main.py", "app/core/ludrix.py", "app/ui/index.html"):
                if self.prefix + need not in names:
                    raise RuntimeError(f"codigo-fonte incompleto: falta {need}")
            notes = ""
            cl = self.prefix + "CHANGELOG.md"
            if cl in names:
                try:
                    notes = section_of(z.read(cl).decode("utf-8", "replace"), ver)
                except Exception:
                    notes = ""
            signed = lxsign.status(self.pkg)
            if signed != "ok":
                raise RuntimeError("esse codigo-fonte nao tem a assinatura do Ludrix - por seguranca, nao instalo" if signed == "none" else "a assinatura desse codigo-fonte nao confere - o arquivo foi alterado ou e de outra origem")
            self.manifest = {"version": ver, "kind": "restore", "restore": True, "title": f"Voltar para a versao {ver}", "signed": signed,
                             "date": vinfo.get("date", ""), "channel": vinfo.get("channel", "stable"), "changelog": notes, "dirs": ["app"], "files": {}}
            return self.manifest

    def _members(self, z, d):
        p = self.prefix + d + "/"
        return [(n, n[len(self.prefix):]) for n in z.namelist() if n.startswith(p) and not n.endswith("/")]


def compile_app(app: Path):
    rec = {}
    for src in sorted(app.rglob("*.py")):
        if "__pycache__" in src.parts:
            continue
        try:
            rel = src.relative_to(app).as_posix()
            data = src.read_bytes()
            pyc = src.with_suffix(".pyc")
            py_compile.compile(str(src), cfile=str(pyc), dfile=f"app/{rel}", doraise=True, invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH)
            rec[rel] = {"src": hashlib.sha256(data).hexdigest(), "pyc": sha256_of(pyc)}
            src.unlink()
        except Exception:
            pass
    try:
        (app / "pyc.json").write_text(json.dumps(rec, ensure_ascii=False, indent=0), encoding="utf-8")
    except Exception:
        pass


def vtuple(v) -> tuple:
    nums = [int(x) for x in re.findall(r"\d+", str(v or "0"))[:3]]
    return tuple(nums + [0] * (3 - len(nums)))


def section_of(changelog: str, ver: str) -> str:
    m = re.search(rf"^## +{re.escape(ver)}\b[^\n]*\n(.*?)(?=^## |\Z)", changelog, re.S | re.M)
    return (m.group(1).strip() if m else "").strip()


def notes_for(m: dict, from_ver: str) -> str:
    allv = m.get("changelog_all") or []
    cur = vtuple(from_ver)
    top = vtuple(m.get("version"))
    parts = []
    for sec in allv:
        v = vtuple(sec.get("version"))
        if cur < v <= top or (m.get("restore") and v == top):
            head = f"{sec.get('version')}" + (f"  -  {sec['title']}" if sec.get("title") else "") + (f"  ({sec['date']})" if sec.get("date") else "")
            parts.append("## " + head + "\n" + (sec.get("text") or "").strip())
    if parts:
        return "\n\n".join(parts)
    return (m.get("changelog") or "").strip()


def plain_md(text: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for line in (text or "").splitlines():
        if line.startswith("## "):
            out.append((line[3:].strip() + "\n", "h"))
            continue
        if line.startswith("### "):
            out.append((line[4:].strip() + "\n", "b"))
            continue
        ln = line
        if re.match(r"^\s*[-*] ", ln):
            ln = re.sub(r"^\s*[-*] ", "  \u2022 ", ln)
        ln = ln.replace("`", "")
        pos = 0
        for mm in re.finditer(r"\*\*(.+?)\*\*", ln):
            out.append((ln[pos:mm.start()], ""))
            out.append((mm.group(1), "b"))
            pos = mm.end()
        out.append((ln[pos:] + "\n", ""))
    return out


def write_result(root: Path, data: dict):
    try:
        updates_dir(root).mkdir(parents=True, exist_ok=True)
        (updates_dir(root) / "last_result.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def _lum(hexcolor: str) -> float:
    try:
        h = hexcolor.lstrip("#")
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    except Exception:
        return 0.0


def gui(pkg: Path | None, root: Path, wait_pid: int, relaunch: list[str] | None, from_ver: str, restore: bool = False):
    import tkinter as tk
    from tkinter import ttk, filedialog

    BG, PANEL, FG, MUTED, ACC, RED, OK, LINE, BTN = "#232428", "#313237", "#f2f2f4", "#9a9aa3", "#5c6b82", "#e5312b", "#22c55e", "#3a3b41", "#2b2c31"
    try:
        pal = json.loads((updates_dir(root) / "theme.json").read_text(encoding="utf-8"))
        BG, PANEL, FG, MUTED = pal.get("bg", BG), pal.get("card", PANEL), pal.get("text", FG), pal.get("muted", MUTED)
        ACC, RED, OK, LINE, BTN = pal.get("accent", ACC), pal.get("red", RED), pal.get("green", OK), pal.get("line", LINE), pal.get("bg2", BTN)
        if BTN == BG:
            BTN = PANEL
    except Exception:
        pass
    ACC_FG = "#1c1d21" if _lum(ACC) > 0.45 else "#ffffff"
    INK = "#1c1d21"
    FONT = "Segoe UI" if os.name == "nt" else "TkDefaultFont"

    win = tk.Tk()
    win.title(f"{APP} - Atualizador")
    win.configure(bg=BG)
    win.minsize(560, 440)
    w, h = 620, 520
    sw, sh = win.winfo_screenwidth(), win.winfo_screenheight()
    win.geometry(f"{w}x{h}+{(sw - w) // 2}+{(sh - h) // 2}")
    try:
        ico = root / "app" / "assets" / "icon.ico"
        if ico.exists() and os.name == "nt":
            win.iconbitmap(str(ico))
    except Exception:
        pass
    style = ttk.Style(win)
    try:
        style.theme_use("clam")
    except Exception:
        pass
    style.configure("V.Horizontal.TProgressbar", troughcolor=PANEL, background=ACC, bordercolor=PANEL, lightcolor=ACC, darkcolor=ACC, thickness=8)
    style.configure("V.Vertical.TScrollbar", troughcolor=PANEL, background=LINE, bordercolor=PANEL, arrowcolor=MUTED, lightcolor=LINE, darkcolor=LINE)

    head = tk.Frame(win, bg=BG)
    head.pack(fill="x", padx=20, pady=(18, 4))
    cv = tk.Canvas(head, width=40, height=40, bg=BG, highlightthickness=0)
    cv.create_rectangle(1, 1, 39, 39, fill=INK, outline=INK)
    cv.create_oval(4, 4, 36, 36, fill="#f5a888", outline="#ffd9c8")
    cv.create_arc(4, 4, 36, 36, start=200, extent=140, style="chord", fill="#7fc9ec", outline="")
    cv.create_arc(4, 4, 36, 36, start=20, extent=90, style="chord", fill="#ffd27a", outline="")
    cv.create_oval(10, 8, 20, 14, fill="#ffffff", outline="")
    cv.create_polygon(11, 16, 29, 16, 31, 25, 27, 27, 24, 23, 16, 23, 13, 27, 9, 25, fill=INK, outline=INK, smooth=True)
    cv.create_rectangle(14, 18, 16, 23, fill="#ffd27a", outline="")
    cv.create_rectangle(12, 20, 18, 22, fill="#ffd27a", outline="")
    cv.create_oval(23, 18, 26, 21, fill="#8be0c4", outline="")
    cv.create_oval(26, 20, 29, 23, fill="#6fb3f2", outline="")
    cv.pack(side="left")
    tbox = tk.Frame(head, bg=BG)
    tbox.pack(side="left", padx=12, fill="x", expand=True)
    title = tk.Label(tbox, text=APP, bg=BG, fg=FG, font=(FONT, 14, "bold"), anchor="w")
    title.pack(anchor="w")
    sub = tk.Label(tbox, text="Voltar de versao" if restore else "Atualizador", bg=BG, fg=MUTED, font=(FONT, 10), anchor="w")
    sub.pack(anchor="w")
    vers = tk.Label(head, text="", bg=BG, fg=MUTED, font=(FONT, 10), justify="right")
    vers.pack(side="right", anchor="n", pady=2)

    info = tk.Label(win, text="", bg=BG, fg=FG, font=(FONT, 10, "bold"), anchor="w", justify="left")
    info.pack(fill="x", padx=20, pady=(8, 0))
    kind_lbl = tk.Label(win, text="", bg=BG, fg=MUTED, font=(FONT, 9), anchor="w")
    kind_lbl.pack(fill="x", padx=20)

    btns = tk.Frame(win, bg=BG)
    btns.pack(side="bottom", fill="x", padx=20, pady=(0, 16))
    bar = ttk.Progressbar(win, style="V.Horizontal.TProgressbar", mode="determinate", maximum=1000)
    bar.pack(side="bottom", fill="x", padx=20, pady=(2, 10))
    status = tk.Label(win, text="", bg=BG, fg=MUTED, font=(FONT, 9), anchor="w")
    status.pack(side="bottom", fill="x", padx=20)

    box = tk.Frame(win, bg=PANEL, bd=0, highlightthickness=1, highlightbackground=LINE)
    box.pack(fill="both", expand=True, padx=20, pady=(10, 8))
    sb = ttk.Scrollbar(box, orient="vertical", style="V.Vertical.TScrollbar")
    txt = tk.Text(box, bg=PANEL, fg=FG, font=(FONT, 9), bd=0, wrap="word", state="disabled", padx=12, pady=10,
                  highlightthickness=0, insertbackground=FG, height=6, yscrollcommand=sb.set, spacing1=1, spacing3=2, cursor="arrow")
    sb.configure(command=txt.yview)
    sb.pack(side="right", fill="y")
    txt.pack(fill="both", expand=True)
    txt.tag_configure("h", font=(FONT, 10, "bold"), foreground=ACC, spacing1=8, spacing3=3)
    txt.tag_configure("b", font=(FONT, 9, "bold"))
    txt.tag_configure("mut", foreground=MUTED)
    txt.tag_configure("err", foreground=RED)
    txt.tag_configure("ok", foreground=OK)

    def set_notes(md: str):
        txt.configure(state="normal")
        txt.delete("1.0", "end")
        for chunk, tag in plain_md(md):
            txt.insert("end", chunk, tag)
        txt.configure(state="disabled")
        txt.yview_moveto(0)

    def set_text(s, tag=""):
        txt.configure(state="normal")
        txt.delete("1.0", "end")
        txt.insert("end", s, tag)
        txt.configure(state="disabled")

    def append(s, tag="mut"):
        txt.configure(state="normal")
        txt.insert("end", s + "\n", tag)
        txt.see("end")
        txt.configure(state="disabled")

    def mkbtn(text, cmd, primary=False, danger=False):
        bg = ACC if primary else (RED if danger else BTN)
        fg = ACC_FG if primary else ("#ffffff" if danger else FG)
        return tk.Button(btns, text=text, command=cmd, bd=0, relief="flat", padx=14, pady=6, cursor="hand2",
                         bg=bg, fg=fg, activebackground=bg if (primary or danger) else LINE, activeforeground=fg,
                         disabledforeground=MUTED, font=(FONT, 10, "bold" if primary else "normal"))

    state = {"pkg": pkg, "manifest": None, "running": False, "restore": restore}

    def opener(p: Path):
        return Restore(p, root, lambda s: None, lambda f, t: None) if state["restore"] else Apply(p, root, lambda s: None, lambda f, t: None)

    def load(p: Path):
        try:
            m = opener(p).read()
        except Exception as e:
            info.configure(text="Pacote invalido", fg=RED)
            kind_lbl.configure(text=str(e))
            set_text("")
            b_apply.configure(state="disabled")
            return
        state.update(pkg=p, manifest=m)
        kind = {"full": "Nova versao do launcher", "patch": "Atualizacao", "restore": "Voltar de versao"}.get(m.get("kind"), "Atualizacao")
        info.configure(text=m.get("title") or kind, fg=FG)
        signed = {"ok": "assinado pelo Ludrix", "none": "SEM ASSINATURA - so continue se confia na origem", "bad": "ASSINATURA NAO CONFERE - arquivo alterado"}.get(m.get("signed"), "")
        kind_lbl.configure(text="  -  ".join(x for x in (kind, m.get("date", ""), p.name, signed) if x), fg=OK if m.get("signed") == "ok" else RED if m.get("signed") == "bad" else MUTED)
        vers.configure(text=f"instalada  v{from_ver or '?'}\n{'volta para' if m.get('restore') else 'nova'}  v{m.get('version')}")
        notes = notes_for(m, from_ver)
        set_notes(notes if notes else "Sem notas de versao.")
        b_apply.configure(state="normal", text="Voltar para essa versao" if m.get("restore") else "Aplicar atualizacao")
        status.configure(text="Pronto. O Ludrix precisa estar fechado - se estiver aberto, ele e fechado sozinho.", fg=MUTED)

    def choose():
        ft = [("Codigo-fonte do Ludrix (*.zip)", "*.zip"), ("Atualizacao do Ludrix (*.lxup)", "*.lxup"), ("Todos", "*.*")] if state["restore"] \
            else [("Atualizacao do Ludrix (*.lxup)", "*.lxup"), ("Todos", "*.*")]
        f = filedialog.askopenfilename(title="Escolher versao" if state["restore"] else "Escolher atualizacao", filetypes=ft, initialdir=str(updates_dir(root)))
        if f:
            load(Path(f))

    def start_launcher():
        if not relaunch:
            return
        flags = 0x00000008 if os.name == "nt" else 0
        try:
            subprocess.Popen(relaunch, cwd=str(root), creationflags=flags, close_fds=True)
        except Exception as e:
            append(f"nao consegui reabrir: {e}", "err")

    def finish(ok: bool, err: str = ""):
        m = state["manifest"] or {}
        write_result(root, {"ok": ok, "version": m.get("version"), "kind": m.get("kind"), "restore": bool(m.get("restore")), "error": err,
                            "changelog": notes_for(m, from_ver), "at": time.time()})
        for b in (b_apply, b_pick, b_close):
            b.pack_forget()
        bar["value"] = 1000 if ok else 0
        if ok:
            status.configure(text=("Versao restaurada." if m.get("restore") else "Atualizacao instalada.") + f"  Agora o Ludrix esta na v{m.get('version')}.", fg=OK)
            append("")
            append("Pronto. Quer abrir o Ludrix agora?", "ok")
            if relaunch:
                mkbtn("Abrir o Ludrix", lambda: (start_launcher(), win.destroy()), primary=True).pack(side="right")
            mkbtn("Fechar", win.destroy).pack(side="right", padx=(0, 8))
        else:
            status.configure(text="Falhou - a versao anterior foi restaurada.", fg=RED)
            append("")
            append("ERRO: " + err, "err")
            if relaunch:
                mkbtn("Abrir o Ludrix", lambda: (start_launcher(), win.destroy()), primary=True).pack(side="right")
            mkbtn("Fechar", win.destroy).pack(side="right", padx=(0, 8))

    def do_apply():
        if state["running"] or not state["pkg"]:
            return
        state["running"] = True
        for b in (b_apply, b_pick, b_close):
            b.configure(state="disabled")
        set_text("")

        def log(s):
            win.after(0, append, s)

        def prog(f, t):
            def _():
                bar["value"] = int(f * 1000)
                status.configure(text=t, fg=MUTED)
            win.after(0, _)

        def work():
            a = Restore(state["pkg"], root, log, prog) if state["restore"] else Apply(state["pkg"], root, log, prog)
            try:
                a.read()
                a.run(wait_pid)
                win.after(0, finish, True, "")
            except Exception as e:
                try:
                    a.rollback()
                except Exception as e2:
                    log(f"rollback falhou: {e2}")
                win.after(0, finish, False, str(e))
        threading.Thread(target=work, daemon=True).start()

    b_apply = mkbtn("Aplicar atualizacao", do_apply, primary=True)
    b_apply.pack(side="right")
    b_close = mkbtn("Cancelar", win.destroy)
    b_close.pack(side="right", padx=(0, 8))
    b_pick = mkbtn("Escolher arquivo...", choose)
    b_pick.pack(side="left")

    def to_restore():
        state["restore"] = not state["restore"]
        sub.configure(text="Voltar de versao" if state["restore"] else "Atualizador")
        b_mode.configure(text="Atualizar..." if state["restore"] else "Voltar de versao...")
        choose()

    if not pkg:
        b_mode = mkbtn("Voltar de versao...", to_restore)
        b_mode.pack(side="left", padx=(8, 0))

    if pkg:
        load(pkg)
        if wait_pid and not restore:
            win.after(400, do_apply)
    else:
        if restore:
            info.configure(text="Escolha o codigo-fonte da versao que quer usar", fg=FG)
            set_text("Um arquivo Ludrix-<versao>-src.zip (ou um .lxup antigo). So a pasta app/ e trocada: jogos, "
                     "configuracoes, temas e emuladores ficam como estao.\n", "mut")
        else:
            info.configure(text="Escolha um arquivo .lxup pra atualizar", fg=FG)
            set_text("Tambem da pra soltar o pacote na pasta data\\updates e usar 'Checar atualizacoes' dentro do Ludrix.\n", "mut")
        b_apply.configure(state="disabled")
    win.mainloop()


def main():

    here = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent
    root = Path(argv_opt("--root", str(here))).resolve()
    restore = "--restore" in sys.argv
    pkg = argv_opt("--restore") if restore else argv_opt("--apply")
    pkg = Path(pkg).resolve() if pkg and not pkg.startswith("--") else None
    wait_pid = int(argv_opt("--wait-pid", "0") or 0)
    rl = argv_opt("--relaunch")
    relaunch = json.loads(rl) if rl else None
    from_ver = argv_opt("--from", "")
    if not from_ver:
        try:
            from_ver = json.loads((root / "app" / "version.json").read_text(encoding="utf-8")).get("version", "")
        except Exception:
            from_ver = ""
    if "--silent" in sys.argv and pkg:
        a = (Restore if restore else Apply)(pkg, root, print, lambda f, t: None)
        try:
            a.read()
            a.run(wait_pid)
            write_result(root, {"ok": True, "version": a.manifest.get("version"), "at": time.time()})
        except Exception as e:
            a.rollback()
            write_result(root, {"ok": False, "error": str(e), "at": time.time()})
            sys.exit(1)
        return
    gui(pkg, root, wait_pid, relaunch, from_ver, restore)


if __name__ == "__main__":
    main()
