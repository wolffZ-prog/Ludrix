from __future__ import annotations

import hashlib
import importlib.util
import json
import marshal
import os
import py_compile
import time
import zipfile
from pathlib import Path

MANIFEST = "integrity.json"
SKIP_DIRS = {"__pycache__", ".git", "node_modules"}
SKIP_EXT = {".pyc", ".pyo", ".log", ".tmp", ".part", ".bak"}
CRITICAL_PREFIX = ("core/", "ui/app.js", "ui/app.css", "ui/index.html", "ui/lang/", "main.py", "updater.py", "lxsign.py", "presets/")
_cache: dict | None = None


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


PYC_RECORD = "pyc.json"


def record_load(app: Path) -> dict:
    try:
        d = json.loads((app / PYC_RECORD).read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def record_save(app: Path, rec: dict):
    try:
        _write_atomic(app / PYC_RECORD, json.dumps(rec, ensure_ascii=False, indent=0).encode("utf-8"))
    except Exception:
        pass


def _pyc_shape_ok(data: bytes) -> bool:
    try:
        if len(data) < 16 or data[:4] != importlib.util.MAGIC_NUMBER:
            return False
        if not int.from_bytes(data[4:8], "little") & 1:
            return False
        marshal.loads(data[16:])
        return True
    except Exception:
        return False


def compile_file(src: Path, app: Path, rec: dict) -> bool:
    rel = src.relative_to(app).as_posix()
    pyc = src.with_suffix(".pyc")
    try:
        data = src.read_bytes()
        py_compile.compile(str(src), cfile=str(pyc), dfile=f"app/{rel}", doraise=True, invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH)
        rec[rel] = {"src": sha256_bytes(data), "pyc": sha256_file(pyc)}
        src.unlink()
        return True
    except Exception:
        return False


def compile_tree(app: Path) -> dict:
    rec = {}
    for src in sorted(app.rglob("*.py")):
        if any(part in SKIP_DIRS for part in src.parts):
            continue
        compile_file(src, app, rec)
    record_save(app, rec)
    return rec


def record_adopt(app: Path, m: dict) -> dict:
    rec = {}
    for rel, e in m.get("files", {}).items():
        if not rel.endswith(".py") or (app / rel).exists():
            continue
        pyc = app / (rel[:-3] + ".pyc")
        try:
            data = pyc.read_bytes()
        except Exception:
            continue
        if _pyc_shape_ok(data):
            rec[rel] = {"src": e.get("sha256", ""), "pyc": sha256_bytes(data)}
    if rec:
        record_save(app, rec)
    return rec


def _entry(rel: str, data: bytes) -> dict:
    e = {"sha256": sha256_bytes(data), "size": len(data)}
    if rel == "version.json":
        e["version_only"] = True
    return e


def build(app: Path, version: str) -> dict:
    files = {}
    for p in sorted(app.rglob("*")):
        if not p.is_file() or any(part in SKIP_DIRS for part in p.parts) or p.suffix in SKIP_EXT:
            continue
        rel = p.relative_to(app).as_posix()
        if rel in (MANIFEST, PYC_RECORD):
            continue
        files[rel] = _entry(rel, p.read_bytes())
    return {"format": 1, "version": version, "built": time.strftime("%Y-%m-%d"), "files": files}


def write(app: Path, version: str) -> Path:
    out = app / MANIFEST
    out.write_text(json.dumps(build(app, version), ensure_ascii=False, indent=0), encoding="utf-8")
    return out


def load(app: Path) -> dict | None:
    p = app / MANIFEST
    if not p.exists():
        return None
    try:
        m = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(m.get("files"), dict) or not m.get("version"):
            return None
        return m
    except Exception:
        return None


def _pyc_ok(path: Path, e: dict, r: dict | None) -> bool:
    try:
        data = path.read_bytes()
        if not _pyc_shape_ok(data):
            return False
        if not r:
            return False
        return r.get("src") == e.get("sha256") and r.get("pyc") == sha256_bytes(data)
    except Exception:
        return False


def _check_one(app: Path, rel: str, e: dict, version: str, rec: dict | None = None) -> str:
    p = app / rel
    if e.get("version_only"):
        try:
            return "" if str(json.loads(p.read_text(encoding="utf-8")).get("version")) == str(version) else "alterado"
        except Exception:
            return "faltando" if not p.exists() else "alterado"
    if rel.endswith(".py") and not p.exists():
        pyc = p.with_suffix(".pyc")
        if pyc.exists():
            return "" if _pyc_ok(pyc, e, (rec or {}).get(rel)) else "alterado"
        return "faltando"
    if not p.exists():
        return "faltando"
    try:
        if p.stat().st_size != e.get("size", p.stat().st_size):
            return "alterado"
        return "" if sha256_file(p) == e["sha256"] else "alterado"
    except Exception:
        return "alterado"


def verify(app: Path) -> dict | None:
    m = load(app)
    if not m:
        return None
    rec = record_load(app)
    if not rec and not (app / PYC_RECORD).exists():
        rec = record_adopt(app, m)
    bad = []
    for rel, e in m["files"].items():
        why = _check_one(app, rel, e, m["version"], rec)
        if why:
            bad.append({"file": rel, "why": why})
    return {"version": m["version"], "ok": not bad, "bad": bad, "checked": len(m["files"]), "critical": is_critical(bad), "at": time.time()}


def is_critical(bad: list[dict]) -> bool:
    return any(b["file"].startswith(CRITICAL_PREFIX) for b in bad)


def seed_dir(root: Path) -> Path:
    return root / "data" / "updates"


def keep_seed(pkg: Path, root: Path, version: str, move: bool) -> Path | None:
    import shutil
    d = seed_dir(root)
    try:
        d.mkdir(parents=True, exist_ok=True)
        dest = d / f"seed-{version}{pkg.suffix.lower()}"
        for old in d.glob("seed-*"):
            if old != dest:
                old.unlink(missing_ok=True)
        if dest.exists():
            dest.unlink()
        if move:
            try:
                os.replace(pkg, dest)
            except OSError:
                shutil.copy2(pkg, dest)
                pkg.unlink(missing_ok=True)
        else:
            shutil.copy2(pkg, dest)
        return dest
    except Exception:
        return None


def _seed_open(path: Path, version: str):
    z = zipfile.ZipFile(path)
    names = z.namelist()
    tail = "app/" + MANIFEST
    prefix = None
    for n in names:
        if n.endswith(tail):
            prefix = n[: -len(tail)]
            break
    if prefix is None:
        z.close()
        return None
    try:
        sm = json.loads(z.read(prefix + tail).decode("utf-8"))
    except Exception:
        z.close()
        return None
    if str(sm.get("version")) != str(version):
        z.close()
        return None
    return z, prefix + "app/", sm


def find_seed(root: Path, version: str) -> Path | None:
    d = seed_dir(root)
    if not d.is_dir():
        return None
    for p in sorted(d.glob("seed-*")):
        try:
            r = _seed_open(p, version)
        except Exception:
            r = None
        if r:
            r[0].close()
            return p
    return None


def _write_atomic(p: Path, data: bytes):
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".new")
    tmp.write_bytes(data)
    os.replace(tmp, p)


def repair(app: Path, root: Path, result: dict, seed: Path) -> dict:
    m = load(app) or {}
    r = _seed_open(seed, result["version"])
    if not r:
        return {"fixed": [], "left": list(result["bad"]), "error": "seed inválido"}
    z, base, _ = r
    compiled = (root / "runtime").is_dir()
    fixed, left = [], []
    rec = record_load(app)
    try:
        names = set(z.namelist())
        for b in result["bad"]:
            rel = b["file"]
            e = m.get("files", {}).get(rel) or {}
            ok = False
            try:
                if e.get("version_only"):
                    data = z.read(base + rel)
                    cur = {}
                    try:
                        cur = json.loads((app / rel).read_text(encoding="utf-8"))
                    except Exception:
                        pass
                    seedv = json.loads(data.decode("utf-8"))
                    cur.update(seedv)
                    cur["version"] = result["version"]
                    _write_atomic(app / rel, json.dumps(cur, indent=2, ensure_ascii=False).encode("utf-8"))
                    ok = True
                elif base + rel in names:
                    data = z.read(base + rel)
                    if sha256_bytes(data) == e.get("sha256"):
                        target = app / rel
                        _write_atomic(target, data)
                        if rel.endswith(".py") and compiled:
                            compile_file(target, app, rec)
                        ok = True
                elif rel.endswith(".py") and base + rel[:-3] + ".pyc" in names:
                    data = z.read(base + rel[:-3] + ".pyc")
                    if _pyc_shape_ok(data):
                        _write_atomic(app / (rel[:-3] + ".pyc"), data)
                        rec[rel] = {"src": e.get("sha256", ""), "pyc": sha256_bytes(data)}
                        ok = True
            except Exception:
                ok = False
            (fixed if ok else left).append(b)
        record_save(app, rec)
    finally:
        z.close()
    for pc in app.rglob("__pycache__"):
        try:
            import shutil
            shutil.rmtree(pc, ignore_errors=True)
        except Exception:
            pass
    return {"fixed": fixed, "left": left}


def state_file(root: Path) -> Path:
    return root / "data" / "integrity-state.json"


def boot_check(app: Path, root: Path) -> dict:
    global _cache
    res = verify(app)
    if res is None:
        out = {"status": "skipped", "bad": [], "fixed": [], "critical": False, "version": "", "checked": 0}
        _cache = out
        return out
    out = {"status": "ok", "bad": [], "fixed": [], "critical": False, "version": res["version"], "checked": res["checked"], "seed": ""}
    if not res["ok"]:
        seed = find_seed(root, res["version"])
        out["seed"] = str(seed) if seed else ""
        if seed:
            rep = repair(app, root, res, seed)
            out["fixed"] = rep["fixed"]
            res = verify(app) or res
        out["bad"] = res["bad"]
        out["critical"] = is_critical(res["bad"])
        out["status"] = "damaged" if res["bad"] else "repaired"
    try:
        sf = state_file(root)
        sf.parent.mkdir(parents=True, exist_ok=True)
        sf.write_text(json.dumps({**out, "at": time.time()}, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass
    _cache = out
    return out


def last(root: Path) -> dict | None:
    if _cache is not None:
        return _cache
    try:
        return json.loads(state_file(root).read_text(encoding="utf-8"))
    except Exception:
        return None


def now(app: Path, root: Path) -> dict:
    res = verify(app)
    if res is None:
        return {"status": "skipped", "bad": [], "checked": 0, "version": "", "critical": False, "seed": ""}
    seed = find_seed(root, res["version"]) if not res["ok"] else None
    return {"status": "ok" if res["ok"] else "damaged", "bad": res["bad"], "checked": res["checked"], "version": res["version"],
            "critical": res["critical"], "seed": str(seed) if seed else ""}


def repair_now(app: Path, root: Path) -> dict:
    res = verify(app)
    if res is None or res["ok"]:
        return now(app, root)
    seed = find_seed(root, res["version"])
    if not seed:
        return {**now(app, root), "error": "sem pacote desta versão para reparar"}
    rep = repair(app, root, res, seed)
    out = now(app, root)
    out["fixed"] = rep["fixed"]
    global _cache
    _cache = {**out, "status": out["status"] if out["bad"] else "repaired"}
    return out


def screen(rep: dict, root: Path) -> str:
    try:
        import tkinter as tk
        from tkinter import ttk
    except Exception:
        return "continue"
    BG, PANEL, FG, MUTED, ACC, RED, LINE, BTN = "#232428", "#313237", "#f2f2f4", "#9a9aa3", "#5c6b82", "#e5312b", "#3a3b41", "#2b2c31"
    try:
        pal = json.loads((seed_dir(root) / "theme.json").read_text(encoding="utf-8"))
        BG, PANEL, FG, MUTED = pal.get("bg", BG), pal.get("card", PANEL), pal.get("text", FG), pal.get("muted", MUTED)
        ACC, RED, LINE, BTN = pal.get("accent", ACC), pal.get("red", RED), pal.get("line", LINE), pal.get("bg2", BTN)
        if BTN == BG:
            BTN = PANEL
    except Exception:
        pass
    FONT = "Segoe UI" if os.name == "nt" else "TkDefaultFont"
    choice = {"v": "quit"}
    try:
        win = tk.Tk()
    except Exception:
        return "continue"
    win.title("LudrixHub - Arquivos do launcher")
    win.configure(bg=BG)
    w, h = 680, 470
    sw, sh = win.winfo_screenwidth(), win.winfo_screenheight()
    win.geometry(f"{w}x{h}+{(sw - w) // 2}+{(sh - h) // 2}")
    win.minsize(620, 400)
    try:
        ico = root / "app" / "assets" / "icon.ico"
        if ico.exists() and os.name == "nt":
            win.iconbitmap(str(ico))
    except Exception:
        pass
    bad = rep.get("bad") or []
    ver = rep.get("version") or "?"
    tk.Label(win, text="Arquivos do launcher alterados ou faltando", bg=BG, fg=FG, font=(FONT, 14, "bold"), anchor="w").pack(fill="x", padx=22, pady=(20, 2))
    tk.Label(win, text=f"Versão {ver}  -  {len(bad)} de {rep.get('checked', 0)} arquivos não conferem. Abrir assim pode falhar ou se comportar de forma errada.",
             bg=BG, fg=MUTED, font=(FONT, 10), anchor="w", justify="left", wraplength=630).pack(fill="x", padx=22, pady=(0, 10))
    btns = tk.Frame(win, bg=BG)
    btns.pack(side="bottom", fill="x", padx=22, pady=(0, 18))
    hint_lbl = tk.Label(win, text="", bg=BG, fg=MUTED, font=(FONT, 9), anchor="w", justify="left", wraplength=630)
    hint_lbl.pack(side="bottom", fill="x", padx=22, pady=(10, 8))
    box = tk.Frame(win, bg=PANEL)
    box.pack(fill="both", expand=True, padx=22)
    style = ttk.Style(win)
    try:
        style.theme_use("clam")
    except Exception:
        pass
    style.configure("V.Vertical.TScrollbar", troughcolor=PANEL, background=LINE, bordercolor=PANEL, arrowcolor=MUTED, lightcolor=LINE, darkcolor=LINE)
    txt = tk.Text(box, bg=PANEL, fg=FG, font=("Consolas" if os.name == "nt" else "TkFixedFont", 9), bd=0, wrap="none", padx=12, pady=10, highlightthickness=0, height=8)
    sb = ttk.Scrollbar(box, orient="vertical", command=txt.yview, style="V.Vertical.TScrollbar")
    txt.configure(yscrollcommand=sb.set)
    sb.pack(side="right", fill="y")
    txt.pack(side="left", fill="both", expand=True)
    txt.tag_configure("m", foreground=RED)
    txt.tag_configure("f", foreground=MUTED)
    for b in bad:
        txt.insert("end", f"{b['why']:<9}", "m" if b["why"] == "faltando" else "f")
        txt.insert("end", f"app/{b['file']}\n")
    txt.configure(state="disabled")
    seed = rep.get("seed") or ""
    hint = ("Reparar: escolha o pacote desta mesma versão (Ludrix-" + ver + "-src.zip ou ludrix-" + ver + "-patch.lxup). "
            "Um pacote de outra versão troca o launcher inteiro por aquela versão. Jogos, configurações e temas não são tocados.")
    if seed:
        hint = "O pacote guardado desta versão não conseguiu corrigir tudo. " + hint
    hint_lbl.configure(text=hint)

    def pick(v):
        choice["v"] = v
        win.destroy()

    def open_folder():
        try:
            if os.name == "nt":
                os.startfile(str(root))
            else:
                import subprocess
                subprocess.Popen(["xdg-open", str(root)])
        except Exception:
            pass

    def mk(text, cmd, primary=False, danger=False):
        bg = ACC if primary else (RED if danger else BTN)
        fg = "#ffffff" if (primary or danger) else FG
        return tk.Button(btns, text=text, command=cmd, bd=0, relief="flat", padx=14, pady=6, cursor="hand2", bg=bg, fg=fg,
                         activebackground=bg if (primary or danger) else LINE, activeforeground=fg, font=(FONT, 10, "bold" if primary else "normal"))

    mk("Reparar com um pacote...", lambda: pick("restore"), primary=True).pack(side="left")
    mk("Abrir pasta", open_folder).pack(side="left", padx=(8, 0))
    mk("Sair", lambda: pick("quit"), danger=True).pack(side="right")
    mk("Continuar assim", lambda: pick("continue")).pack(side="right", padx=(0, 8))
    win.protocol("WM_DELETE_WINDOW", lambda: pick("quit"))
    win.mainloop()
    return choice["v"]
