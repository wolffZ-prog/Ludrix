from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
sys.path.insert(0, str(APP))
import lxsign
from core import integrity
VERSION_FILE = APP / "version.json"
BUILD = ROOT / "build"
EXE_DIR = BUILD / "exe"


def _rel() -> Path:
    return ROOT / "release" / json.loads(VERSION_FILE.read_text(encoding="utf-8"))["version"]


class _Rel:
    def __truediv__(self, other):
        return _rel() / other

    def mkdir(self, **kw):
        _rel().mkdir(parents=True, exist_ok=True)

    def glob(self, pat):
        return _rel().glob(pat)

    def __str__(self):
        return str(_rel())

    def __fspath__(self):
        return str(_rel())


REL = _Rel()
SKIP_DIRS = {"__pycache__", ".pytest_cache", "node_modules", "cache"}
SKIP_EXT = {".pyc", ".pyo", ".log"}


def version() -> str:
    return json.loads(VERSION_FILE.read_text(encoding="utf-8"))["version"]


def changelog_for(v: str) -> str:
    p = ROOT / "CHANGELOG.md"
    if not p.exists():
        return ""
    txt = p.read_text(encoding="utf-8")
    m = re.search(rf"^## +{re.escape(v)}\b[^\n]*\n(.*?)(?=^## |\Z)", txt, re.S | re.M)
    return (m.group(1).strip() if m else "").strip()


def changelog_all() -> list[dict]:
    p = ROOT / "CHANGELOG.md"
    if not p.exists():
        return []
    out = []
    for m in re.finditer(r"^## +(\d+\.\d+\.\d+)[^\S\n]*(?:[—-]+[^\S\n]*(\d{4}-\d{2}-\d{2}))?[^\S\n]*(?:[—-]+[^\S\n]*([^\n]*))?\n(.*?)(?=^## |\Z)",
                         p.read_text(encoding="utf-8"), re.S | re.M):
        out.append({"version": m.group(1), "date": m.group(2) or "", "title": (m.group(3) or "").strip(), "text": m.group(4).strip()})
    return out


def sha256_of(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def add_tree(z: zipfile.ZipFile, folder: Path, arc_prefix: str, keep_pyc: bool = False):
    skip = SKIP_EXT - ({".pyc"} if keep_pyc else set())
    for p in sorted(folder.rglob("*")):
        if any(part in SKIP_DIRS for part in p.parts) or p.suffix in skip or not p.is_file():
            continue
        if p.relative_to(folder).as_posix() == integrity.MANIFEST:
            continue
        z.write(p, f"{arc_prefix}/{p.relative_to(folder).as_posix()}")


def integrity_json() -> str:
    return json.dumps(integrity.build(APP, version()), ensure_ascii=False, indent=0)


def cmd_integrity():
    out = integrity.write(APP, version())
    n = len(json.loads(out.read_text(encoding="utf-8"))["files"])
    print("integrity:", out, f"({n} arquivos)")
    return out


def clean_pycache():
    for pc in APP.rglob("__pycache__"):
        shutil.rmtree(pc, ignore_errors=True)


def compiled_app(dst: Path):
    import py_compile
    shutil.copytree(APP, dst, ignore=shutil.ignore_patterns(*SKIP_DIRS, "*.pyc", "*.pyo", "*.log", integrity.MANIFEST))
    (dst / integrity.MANIFEST).write_text(integrity_json(), encoding="utf-8")
    integrity.compile_tree(dst)
    left = [p for p in dst.rglob("*.py") if not any(part in SKIP_DIRS for part in p.parts)]
    if left:
        raise RuntimeError("nao compilou: " + ", ".join(str(x.relative_to(dst)) for x in left[:5]))


def sign_file(out: Path, required: bool = True) -> bool:
    seed = lxsign.load_seed()
    if not seed:
        print(f"  AVISO: {out.name} NAO foi assinado - nenhuma chave em", " | ".join(str(x) for x in lxsign.key_paths()))
        if required:
            print("  (o launcher recusa atualizacao sem assinatura; rode 'build.py keygen' ou copie a chave)")
        return False
    if lxsign.public_key(seed).hex() != lxsign.PUBLIC_KEY:
        print(f"  AVISO: a chave encontrada nao bate com a chave publica embutida em app/lxsign.py - {out.name} NAO foi assinado")
        return False
    lxsign.sign_zip(out, seed)
    print(f"  assinado: {out.name}")
    return True


def cmd_keygen():
    import secrets
    dest = Path(os.environ.get("LUDRIX_SIGN_KEY") or (Path.home() / ".ludrix" / "ludrix-sign.key"))
    if dest.exists():
        print("ja existe uma chave em", dest, "- apague-a antes se quiser gerar outra (todas as versoes futuras precisam ser assinadas com a mesma chave)")
        return
    seed = secrets.token_bytes(32)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(seed.hex() + "\n", encoding="utf-8")
    pub = lxsign.public_key(seed).hex()
    src = APP / "lxsign.py"
    txt = src.read_text(encoding="utf-8")
    src.write_text(re.sub(r'PUBLIC_KEY = "[0-9a-f]*"', f'PUBLIC_KEY = "{pub}"', txt, 1), encoding="utf-8")
    print("chave privada:", dest, "(guarde com backup; sem ela nao da pra assinar versoes novas)")
    print("chave publica gravada em app/lxsign.py:", pub)


def cmd_sign(files: list[str]):
    key = None
    if "--key" in files:
        i = files.index("--key")
        key = Path(files[i + 1]) if i + 1 < len(files) else None
        files = files[:i] + files[i + 2:]
    if not files:
        print("uso: build.py sign <arquivo.lxup|.lxtheme|.zip> [...] [--key <chave-antiga>]")
        return
    for f in files:
        p = Path(f)
        if not p.is_file() or not zipfile.is_zipfile(p):
            print("  pulei (nao e zip):", f)
            continue
        if key:
            seed = bytes.fromhex(key.read_text(encoding="utf-8").strip())
            lxsign.sign_zip(p, seed)
            print(f"  assinado com {key.name} (chave publica {lxsign.public_key(seed).hex()[:12]}...): {p.name}")
        else:
            sign_file(p, required=False)
        print("  verificacao com a chave atual:", lxsign.status(p))


def cmd_bump(v: str):
    d = json.loads(VERSION_FILE.read_text(encoding="utf-8"))
    d["version"], d["date"] = v, date.today().isoformat()
    d["changelog"] = changelog_for(v)
    VERSION_FILE.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("versão:", v)


def _ensure_libtorrent() -> bool:
    import importlib.util
    if importlib.util.find_spec("libtorrent"):
        print("libtorrent: ok (embutido no exe)")
        return True
    print("libtorrent: tentando instalar (pip)…")
    r = subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "libtorrent>=2.0"], capture_output=True, text=True)
    if r.returncode == 0 and importlib.util.find_spec("libtorrent"):
        print("libtorrent: instalado e embutido")
        return True
    print(f"libtorrent: sem wheel pro Python {sys.version_info.major}.{sys.version_info.minor} — o exe usa o motor reserva (aria2c) pra torrents")
    return False


def _ensure_pyinstaller():
    try:
        import PyInstaller
        ver = tuple(int(x) for x in PyInstaller.__version__.split(".")[:2])
    except Exception:
        ver = (0, 0)
    if ver >= (6, 22):
        print("PyInstaller:", PyInstaller.__version__)
        return
    print("PyInstaller antigo/ausente — instalando >= 6.22 (obrigatório com Python 3.14.7+)…")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-U", "pyinstaller>=6.22"])


def _tcltk_datas() -> list[str]:
    tcl_root = Path(sys.base_prefix) / "tcl"
    if not tcl_root.is_dir():
        return []
    stage = BUILD / "tcltk"
    shutil.rmtree(stage, ignore_errors=True)
    found: dict[str, Path] = {}

    for kind, marker in (("tcl", "init.tcl"), ("tk", "tk.tcl")):
        for d in sorted(tcl_root.glob(f"{kind}[0-9]*")):
            if d.is_dir() and (d / marker).exists():
                found[kind] = d

    for kind, marker in (("tcl", "init.tcl"), ("tk", "tk.tcl")):
        if kind in found:
            continue
        for zp in sorted(tcl_root.glob(f"lib{kind}9*.zip")):
            with zipfile.ZipFile(zp) as z:
                names = z.namelist()
                hit = next((n for n in names if n.endswith("/" + marker) or n == marker), None)
                if not hit:
                    continue
                base = hit[: -len(marker)]
                dst = stage / f"_{kind}_data"
                for n in names:
                    if n.startswith(base) and not n.endswith("/"):
                        rel = n[len(base):]
                        out = dst / rel
                        out.parent.mkdir(parents=True, exist_ok=True)
                        out.write_bytes(z.read(n))
                found[kind] = dst
                break
    args = []
    for kind in ("tcl", "tk"):
        if kind in found:
            os.environ[f"{kind.upper()}_LIBRARY"] = str(found[kind])
            args += ["--add-data", f"{found[kind]}{os.pathsep}_{kind}_data"]
    print("Tcl/Tk:", ", ".join(f"{k} ← {v}" for k, v in found.items()) or "nada encontrado (o PyInstaller decide)")
    return args


def _app_imports() -> list[str]:
    import ast
    local = {p.stem for p in APP.glob("*.py")} | {p.name for p in APP.iterdir() if p.is_dir()} | {"core", "ui"}
    mods: set[str] = set()
    for f in APP.rglob("*.py"):
        try:
            tree = ast.parse(f.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        for n in ast.walk(tree):
            if isinstance(n, ast.Import):
                mods.update(a.name for a in n.names)
            elif isinstance(n, ast.ImportFrom) and n.module and not n.level:
                mods.add(n.module)
    skip = local | {"__future__", "System", "clr"}
    return sorted(m for m in mods if m.split(".")[0] not in skip)


def cmd_exe():
    if os.name != "nt":
        print("exe: só no Windows (PyInstaller + WebView2). Pulando.")
        return False
    _ensure_pyinstaller()
    dist = BUILD / "tmp" / "dist"
    shutil.rmtree(BUILD, ignore_errors=True)
    common = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--distpath", str(dist), "--workpath", str(BUILD / "tmp" / "work"),
              "--specpath", str(BUILD)]
    icon = APP / "assets" / "icon.ico"

    extra = _tcltk_datas()
    if _ensure_libtorrent():
        extra += ["--collect-all", "libtorrent"]
    for m in _app_imports():
        extra += ["--hidden-import", m]
    extra += ["--collect-submodules", "PIL"]
    onedir = ["--onedir", "--windowed", "--icon", str(icon), "--contents-directory", "runtime",
              "--collect-all", "py7zr", *extra,
              "--hidden-import", "webview.platforms.edgechromium", "--hidden-import", "clr",
              "--hidden-import", "pystray._win32", "--hidden-import", "PIL.Image", "--hidden-import", "psutil",
              "--hidden-import", "tkinter", "--hidden-import", "Cryptodome.Cipher.AES", "--hidden-import", "Cryptodome.Util.Counter", str(ROOT / "tools" / "bootstrap.py")]
    subprocess.check_call(common + ["--name", "Ludrix"] + onedir)

    cicon = APP / "assets" / "console.ico"
    subprocess.check_call(common + ["--name", "LudrixConsole"] + [str(cicon) if a == str(icon) else a for a in onedir])

    subprocess.check_call(common + ["--onefile", "--noconsole", "--name", "updater", "--icon", str(icon), *_tcltk_datas(), str(APP / "updater.py")])
    for kind in ("tcl", "tk"):
        if not (dist / "Ludrix" / "runtime" / f"_{kind}_data").is_dir():
            print(f"AVISO: runtime\\_{kind}_data não foi gerada — o exe abre, mas a janela do atualizador pode falhar. "
                  "Se acontecer, instale o Python 3.12 ou 3.13 (python.org, sem venv) e rode o build.bat com ele.")
    out = EXE_DIR
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    shutil.copy2(dist / "Ludrix" / "Ludrix.exe", out / "Ludrix.exe")
    shutil.copy2(dist / "LudrixConsole" / "LudrixConsole.exe", out / "LudrixConsole.exe")
    shutil.copytree(dist / "Ludrix" / "runtime", out / "runtime")
    shutil.copy2(dist / "updater.exe", out / "updater.exe")
    if "--sem-webview2" not in sys.argv:
        wv = cmd_webview2()
        if not wv:
            print("BUILD INTERROMPIDO: sem o WebView2 embutido. Para compilar mesmo assim (janela dependendo do WebView2 do sistema), rode com --sem-webview2.")
            raise SystemExit(4)
        shutil.copytree(wv, out / "runtime" / "webview2")
    print("exe pronto em", out)
    return True


WV2_CACHE = ROOT / "tools" / "cache"
WV2_DIR = BUILD / "webview2"


def _wv2_spec() -> dict:
    return json.loads((ROOT / "tools" / "webview2.json").read_text(encoding="utf-8"))


def _download(url: str, dest: Path, size: int) -> bool:
    import urllib.request
    tmp = dest.with_suffix(".part")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Ludrix-build"})
        with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
            done, last = 0, 0
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
                done += len(chunk)
                if size and done - last >= 20 * (1 << 20):
                    last = done
                    print(f"\r  {done * 100 // size}% ({done >> 20} MB)", end="", flush=True)
        print()
        os.replace(tmp, dest)
        return True
    except Exception as e:
        print(f"\n  falhou: {e}")
        tmp.unlink(missing_ok=True)
        return False


def _wv2_cab(spec: dict) -> Path | None:
    WV2_CACHE.mkdir(parents=True, exist_ok=True)
    cab = WV2_CACHE / spec["file"]
    if cab.exists() and cab.stat().st_size == spec["size"] and sha256_of(cab) == spec["sha256"]:
        return cab
    if cab.exists():
        print("webview2: arquivo em cache não confere; baixando de novo")
        cab.unlink()
    for url in spec["urls"]:
        print("webview2: baixando", spec["file"], f"({spec['size'] >> 20} MB)")
        print("  de", url)
        if _download(url, cab, spec["size"]) and cab.stat().st_size == spec["size"] and sha256_of(cab) == spec["sha256"]:
            return cab
        if cab.exists():
            print("  sha256 não confere; descartando")
            cab.unlink()
    return None


def _wv2_extract(cab: Path, dest: Path) -> Path | None:
    shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True)
    if os.name == "nt":
        r = subprocess.run(["expand.exe", "-F:*", str(cab), str(dest)], capture_output=True, text=True)
    else:
        r = subprocess.run(["cabextract", "-q", "-d", str(dest), str(cab)], capture_output=True, text=True)
    if r.returncode != 0:
        print("webview2: extração falhou:", (r.stderr or r.stdout)[-400:])
        return None
    exe = next(dest.rglob("msedgewebview2.exe"), None)
    return exe.parent if exe else None


def _wv2_trim(folder: Path, trim: dict):
    removed, freed = [], 0

    def drop(p: Path):
        nonlocal freed
        if p.is_dir():
            freed += sum(f.stat().st_size for f in p.rglob("*") if f.is_file())
            shutil.rmtree(p, ignore_errors=True)
        elif p.exists():
            freed += p.stat().st_size
            p.unlink()
        else:
            return
        removed.append(p.relative_to(folder).as_posix())

    keep = {k.lower() for k in trim.get("locales_keep") or []}
    loc = folder / "Locales"
    if keep and loc.is_dir():
        for f in loc.glob("*.pak"):
            if f.stem.lower() not in keep:
                drop(f)
    for name in trim.get("remove") or []:
        drop(folder / name)
    (folder / "TRIM.txt").write_text("\n".join(removed) + "\n", encoding="utf-8")
    print(f"webview2: dieta -{freed >> 20} MB ({len(removed)} itens; lista em TRIM.txt)")


def cmd_webview2() -> Path | None:
    spec = _wv2_spec()
    final = WV2_DIR / spec["version"]
    if (final / "msedgewebview2.exe").exists() and (final / "VERSION").exists():
        print("webview2: embutido pronto", spec["version"])
        return final
    cab = _wv2_cab(spec)
    if not cab:
        print("webview2: não foi possível obter o pacote. Baixe manualmente o 'Fixed Version' x64", spec["version"],
              "em https://developer.microsoft.com/microsoft-edge/webview2/ e coloque em", WV2_CACHE)
        return None
    tmp = WV2_DIR / "tmp"
    folder = _wv2_extract(cab, tmp)
    if not folder:
        return None
    shutil.rmtree(final, ignore_errors=True)
    final.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(folder), str(final))
    shutil.rmtree(tmp, ignore_errors=True)
    if "--webview2-completo" not in sys.argv:
        _wv2_trim(final, spec.get("trim") or {})
    (final / "VERSION").write_text(spec["version"] + "\n", encoding="utf-8")
    n = sum(1 for _ in final.rglob("*") if _.is_file())
    mb = sum(f.stat().st_size for f in final.rglob("*") if f.is_file()) >> 20
    print(f"webview2: embutido pronto {spec['version']} ({n} arquivos, {mb} MB)")
    return final


def _runtime_dir() -> Path | None:
    d = EXE_DIR
    return d if (d / "Ludrix.exe").exists() else None


def clean_build_tmp():
    shutil.rmtree(BUILD / "tmp", ignore_errors=True)
    clean_pycache()
    for pc in (ROOT / "tools").rglob("__pycache__"):
        shutil.rmtree(pc, ignore_errors=True)


def cmd_zip():
    v = version()
    clean_pycache()
    REL.mkdir(exist_ok=True)
    rt = _runtime_dir()
    if not rt:
        print("zip: falta o runtime (rode 'exe' no Windows antes). Gerando só o pacote de código-fonte.")
        return cmd_src()
    folder = REL / "Ludrix"
    shutil.rmtree(folder, ignore_errors=True)
    folder.mkdir(parents=True)
    shutil.copy2(rt / "Ludrix.exe", folder / "Ludrix.exe")
    shutil.copy2(rt / "LudrixConsole.exe", folder / "LudrixConsole.exe")
    shutil.copy2(rt / "updater.exe", folder / "updater.exe")
    shutil.copytree(rt / "runtime", folder / "runtime")
    compiled_app(folder / "app")
    out = REL / f"Ludrix-{v}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        add_tree(z, folder, "Ludrix", keep_pyc=True)
    print("pasta pronta:", folder)
    print("zip:", out, f"({out.stat().st_size // 1024} KB)")
    return out


def cmd_src():
    v = version()
    clean_pycache()
    REL.mkdir(exist_ok=True)
    out = REL / f"Ludrix-{v}-src.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        add_tree(z, APP, "Ludrix-src/app")
        z.writestr(f"Ludrix-src/app/{integrity.MANIFEST}", integrity_json())
        add_tree(z, ROOT / "tools", "Ludrix-src/tools")
        for d in ("docs", ".github", "casca"):
            if (ROOT / d).is_dir():
                add_tree(z, ROOT / d, f"Ludrix-src/{d}")
        for f in ("run.bat", "build.bat", "publicar.bat", "git-setup.bat", "lancar.bat", "requirements.txt", "README.md", "README.en.md", "CHANGELOG.md", "LICENSE", "SECURITY.md", "CONTRIBUTING.md", ".gitignore"):
            if (ROOT / f).exists():
                zi = zipfile.ZipInfo.from_file(ROOT / f, f"Ludrix-src/{f}")
                zi.compress_type = zipfile.ZIP_DEFLATED
                if f.endswith(".sh"):
                    zi.external_attr = (0o100755 << 16)
                z.writestr(zi, (ROOT / f).read_bytes())
    print("src:", out, f"({out.stat().st_size // 1024} KB)")
    sign_file(out, required=False)
    return out


def _manifest(kind: str, dirs: list[str], files: dict, min_version: str | None) -> dict:
    v = version()
    return {"version": v, "kind": kind, "min_version": min_version or "", "date": date.today().isoformat(),
            "title": ("Patch " if kind == "patch" else "Ludrix ") + v, "changelog": changelog_for(v), "changelog_all": changelog_all(),
            "dirs": dirs, "files": files}


def cmd_patch(min_version: str | None):
    v = version()
    clean_pycache()
    REL.mkdir(exist_ok=True)
    out = REL / f"ludrix-{v}-patch.lxup"
    m = _manifest("patch", ["app"], {}, min_version)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.writestr("manifest.json", json.dumps(m, ensure_ascii=False, indent=1))
        add_tree(z, APP, "app")
        z.writestr(f"app/{integrity.MANIFEST}", integrity_json())
    print("patch:", out, f"({out.stat().st_size // 1024} KB)  min_version={min_version or '-'}")
    sign_file(out)
    return out


def cmd_full():
    v = version()
    clean_pycache()
    REL.mkdir(exist_ok=True)
    rt = _runtime_dir()
    out = REL / f"ludrix-{v}-full.lxup"
    dirs = ["app"] + (["runtime"] if rt else [])
    files = {}
    if rt:
        files["Ludrix.exe"] = sha256_of(rt / "Ludrix.exe")
        files["LudrixConsole.exe"] = sha256_of(rt / "LudrixConsole.exe")
        files["updater.exe"] = sha256_of(rt / "updater.exe")
    m = _manifest("full", dirs, files, None)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.writestr("manifest.json", json.dumps(m, ensure_ascii=False, indent=1))
        if rt:
            tmp = BUILD / "app_pyc"
            shutil.rmtree(tmp, ignore_errors=True)
            compiled_app(tmp)
            add_tree(z, tmp, "app", keep_pyc=True)
            shutil.rmtree(tmp, ignore_errors=True)
            add_tree(z, rt / "runtime", "runtime")
            z.write(rt / "Ludrix.exe", "Ludrix.exe")
            z.write(rt / "LudrixConsole.exe", "LudrixConsole.exe")
            z.write(rt / "updater.exe", "updater.exe")
        else:
            add_tree(z, APP, "app")
            z.writestr(f"app/{integrity.MANIFEST}", integrity_json())
    print("full:", out, f"({out.stat().st_size // 1024} KB)", "com runtime" if rt else "(sem runtime — só código)")
    sign_file(out)
    return out


FEED_REPO = "wolffZ-prog/Ludrix"
FEED_BASE = f"https://github.com/{FEED_REPO}/releases/latest/download"


def cmd_publish():
    v = version()
    rel = _rel()
    files = [rel / f"ludrix-{v}-patch.lxup", rel / f"ludrix-{v}-full.lxup", rel / "ludrix-updates.json", rel / f"Ludrix-{v}.zip", rel / f"Ludrix-{v}-src.zip"]
    files = [f for f in files if f.exists()]
    if not (rel / f"Ludrix-{v}.zip").exists():
        print(f"AVISO: Ludrix-{v}.zip (programa pronto) nao existe em {rel} - quem baixar da release so vai achar o patch. Rode build.bat antes.")
    if not any(f.suffix == ".lxup" for f in files):
        print("publish: gere o patch antes (build.py patch)")
        raise SystemExit(5)
    cmd_feed(FEED_BASE)
    if (rel / "ludrix-updates.json") not in files:
        files.append(rel / "ludrix-updates.json")
    gh = shutil.which("gh")
    notes = changelog_for(v) or f"Ludrix {v}"
    if not gh:
        print("gh (GitHub CLI) nao encontrado. Publique a mao:")
        print(f"  1. https://github.com/{FEED_REPO}/releases/new")
        print(f"  2. Tag: v{v}   Titulo: Ludrix {v}")
        print("  3. Arraste estes arquivos:")
        for f in files:
            print("     ", f)
        print("  4. Publish release. Pronto: o Ludrix de todo mundo acha sozinho.")
        print("  (anexe tambem Colecoes.zip se mudou)")
        return
    cmd = [gh, "release", "create", f"v{v}", *[str(f) for f in files], "--repo", FEED_REPO, "--title", f"Ludrix {v}", "--notes", notes, "--latest"]
    print(" ".join(cmd[:4]), "...")
    r = subprocess.run(cmd)
    print("publicado" if r.returncode == 0 else f"gh terminou com erro {r.returncode} (ja existe a tag? use 'gh release upload v{v} <arquivos> --clobber')")
    if r.returncode:
        raise SystemExit(5)


def _feed_url(base_url: str, ver: str, name: str) -> str:
    if base_url.rstrip("/") == FEED_BASE:
        return f"https://github.com/{FEED_REPO}/releases/download/v{ver}/{name}"
    return base_url.rstrip("/") + "/" + name


def _feed_previous(base_url: str) -> list[dict]:
    if base_url.rstrip("/") != FEED_BASE:
        return []
    try:
        import urllib.request
        req = urllib.request.Request(FEED_BASE + "/ludrix-updates.json", headers={"User-Agent": "ludrix-build", "Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        print("feed: sem feed anterior pra herdar (" + str(e)[:60] + ")")
        return []
    out = []
    for it in list(data.get("all") or []):
        if not isinstance(it, dict) or not it.get("version") or not it.get("url"):
            continue
        name = str(it["url"]).rsplit("/", 1)[-1]
        it["url"] = _feed_url(base_url, it["version"], name)
        out.append(it)
    return out


def cmd_feed(base_url: str):
    v = version()
    items = []
    for kind in ("patch", "full"):
        p = REL / f"ludrix-{v}-{kind}.lxup"
        if p.exists():
            with zipfile.ZipFile(p) as z:
                m = json.loads(z.read("manifest.json"))
            items.append({"version": v, "kind": kind, "url": _feed_url(base_url, v, p.name), "sha256": sha256_of(p),
                          "size": p.stat().st_size, "min_version": m.get("min_version", ""), "title": m.get("title"),
                          "changelog": m.get("changelog", ""), "date": m.get("date")})
    if not items:
        print("feed: nenhum .lxup em", _rel(), "pra listar")
        return
    latest = next((i for i in items if i["kind"] == "patch"), items[0])
    seen = {(i["version"], i["kind"]) for i in items}
    older = [i for i in _feed_previous(base_url) if (i["version"], i.get("kind")) not in seen and _vt(i["version"]) < _vt(v)]
    older.sort(key=lambda i: _vt(i["version"]), reverse=True)
    items += older[:12]
    out = REL / "ludrix-updates.json"
    out.write_text(json.dumps({"latest": latest, "all": items}, ensure_ascii=False, indent=1), encoding="utf-8")
    print("feed:", out, f"({len(items)} pacote(s) listados)")


def _vt(v: str):
    return tuple(int(x) for x in re.findall(r"\d+", str(v or "0"))[:3]) or (0,)


def cmd_check():
    import ast
    problems = []
    for f in sorted(APP.rglob("*.py")) + [Path(__file__)]:
        try:
            ast.parse(f.read_text(encoding="utf-8"), filename=str(f))
        except SyntaxError as e:
            problems.append(f"{f.relative_to(ROOT)}:{e.lineno}: {e.msg}")
    for f in sorted((APP / "presets").glob("*.json")) + [VERSION_FILE] + sorted((APP / "ui").rglob("*.json")):
        try:
            json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:
            problems.append(f"{f.relative_to(ROOT)}: JSON inválido ({e})")
    for rel in ("ui/index.html", "ui/app.js", "ui/app.css", "ui/console/console.html", "ui/terminal.html", "assets/icon.ico", "assets/console.ico", "main.py", "console.py", "updater.py"):
        if not (APP / rel).is_file():
            problems.append(f"app/{rel}: arquivo obrigatório ausente")
    node = shutil.which("node")
    if node:
        for f in (APP / "ui" / "app.js", APP / "ui" / "console" / "console.js"):
            r = subprocess.run([node, "--check", str(f)], capture_output=True, text=True)
            if r.returncode:
                problems.append(f"{f.relative_to(ROOT)}: {(r.stderr or r.stdout).strip().splitlines()[-1]}")
    v = version()
    if not re.fullmatch(r"\d+\.\d+\.\d+", v):
        problems.append(f"app/version.json: versão estranha {v!r}")
    if not problems:
        problems += _smoke_api()
    if problems:
        print("verificação falhou:")
        for x in problems:
            print("  -", x)
        raise SystemExit(2)
    print(f"verificação ok: código, catálogos, interface e servidor interno (versão {v})")


SMOKE_ROUTES = ("/", "/api/config", "/api/emulation", "/api/flash", "/api/repos", "/api/updates", "/api/diag", "/api/custom.css", "/ui/app.js", "/ui/app.css")


def _smoke_api() -> list[str]:
    import time
    import urllib.request
    data = APP.parent / "data"
    had_data = data.exists()
    inst = data / "instance.json"
    keep = inst.read_bytes() if inst.exists() else None
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8")
    proc = subprocess.Popen([sys.executable, "-u", str(APP / "main.py"), "--web", "0"], cwd=str(ROOT), env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    out: list[str] = []
    found = {"port": 0}

    def reader():
        for line in proc.stdout:
            out.append(line.rstrip())
            m = re.search(r"http://localhost:(\d+)", line)
            if m and not found["port"]:
                found["port"] = int(m.group(1))
    import threading
    threading.Thread(target=reader, daemon=True).start()
    problems: list[str] = []
    try:
        deadline = time.time() + 40
        while time.time() < deadline and proc.poll() is None and not found["port"]:
            time.sleep(0.1)
        port = found["port"]
        if not port:
            return ["servidor interno não subiu em 40s: " + (" | ".join(out[-5:]) or f"saída vazia (código {proc.poll()})")]
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=10) as r:
            html = r.read().decode("utf-8", "replace")
        m = re.search(r'name="ludrix-token" content="([^"]+)"', html)
        if not m:
            return ["página inicial sem token — server.py/_page quebrado"]
        tok = m.group(1)
        for route in SMOKE_ROUTES:
            try:
                req = urllib.request.Request(f"http://127.0.0.1:{port}{route}", headers={"X-Ludrix-Token": tok})
                with urllib.request.urlopen(req, timeout=15) as r:
                    body = r.read()
                    if r.status != 200:
                        problems.append(f"{route}: HTTP {r.status}")
                    elif route.startswith("/api/") and not route.endswith(".css"):
                        json.loads(body.decode("utf-8"))
            except Exception as e:
                problems.append(f"{route}: {e}")
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{port}/api/config", headers={"Host": "evil.example"})
            with urllib.request.urlopen(req, timeout=10):
                problems.append("servidor aceitou Host externo — proteção contra DNS rebinding quebrada")
        except urllib.error.HTTPError as e:
            if e.code != 403:
                problems.append(f"Host externo devolveu {e.code} em vez de 403")
        except Exception as e:
            problems.append(f"teste de Host: {e}")
    finally:
        if proc.poll() is None:
            proc.kill()
            try:
                proc.wait(10)
            except Exception:
                pass
        if keep is not None:
            inst.write_bytes(keep)
        elif inst.exists():
            inst.unlink(missing_ok=True)
        if not had_data:
            shutil.rmtree(data, ignore_errors=True)
    return problems


def cmd_selftest(folder: Path | None = None):
    folder = folder or (REL / "Ludrix")
    exe = folder / "Ludrix.exe"
    if not exe.exists():
        print("selftest: não achei", exe)
        return False
    print("selftest: abrindo", exe, "--selftest ...")
    try:
        r = subprocess.run([str(exe), "--selftest"], cwd=str(folder), timeout=180)
        code = r.returncode
    except subprocess.TimeoutExpired:
        code = -1
    rep = folder / "data" / "selftest.txt"
    text = rep.read_text(encoding="utf-8", errors="replace") if rep.exists() else ""
    shutil.rmtree(folder / "data", ignore_errors=True)
    if code == 0:
        print("selftest: o exe abriu, serviu a interface e passou no diagnóstico")
        return True
    print("selftest FALHOU (código", code, ")")
    print(text or "  (sem relatório — o exe nem chegou a gravar data/selftest.txt)")
    return False


USAGE = "Ferramenta de build/empacotamento do Ludrix.\n\n  python tools/build.py version               imprime a versão de app/version.json\n  python tools/build.py check                 confere código, catálogos, interface e sobe o servidor interno num teste rápido\n  python tools/build.py selftest              roda release/<v>/Ludrix/Ludrix.exe --selftest (o exe abre, serve a interface e passa no diagnóstico)\n  python tools/build.py bump 1.0.0            grava a versão em app/version.json\n  python tools/build.py exe                   PyInstaller: Ludrix.exe + LudrixConsole.exe (runtime) + updater.exe → build/exe; embute o WebView2   [Windows]\n  python tools/build.py webview2              baixa e prepara o WebView2 Fixed Version (tools/webview2.json) → build/webview2/<v>; --webview2-completo pula a dieta\n  python tools/build.py zip                   release/<v>/Ludrix/ + release/<v>/Ludrix-<v>.zip  (programa pronto)\n  python tools/build.py src                   release/<v>/Ludrix-<v>-src.zip  (código-fonte pra compilar com build.bat)\n  python tools/build.py patch [--min 1.0.0]   release/<v>/ludrix-<v>-patch.lxup   (só app/ — patch de funções)\n  python tools/build.py full                  release/<v>/ludrix-<v>-full.lxup    (app/ + runtime + exes — nova versão)\n  python tools/build.py feed [url-base]       release/<v>/ludrix-updates.json     (feed pro \"Checar atualizações\"; padrão = GitHub wolffZ-prog/Ludrix)\n  python tools/build.py publish               cria a release v<v> no GitHub com o .lxup + feed (usa o gh; sem ele, imprime o passo a passo)\n  python tools/build.py keygen                cria a chave de assinatura (%USERPROFILE%\\.ludrix\\ludrix-sign.key) e grava a pública em app/lxsign.py\n  python tools/build.py sign <arquivo...>     assina .lxup/.lxtheme/.zip com a chave (src/patch/full já saem assinados)\n  python tools/build.py all [--min X] [url] [--keep-tmp]   check + exe (se Windows) + zip + selftest do exe + src + patch + full + feed; apaga build/tmp no fim\n\nPastas do código-fonte:\n  app/ (programa)  tools/ (este build)  build/ (temporários e exes compilados)  release/<versão>/ (o que sai do build)\n\nPasta final do programa (release/<v>/Ludrix/):\n  Ludrix.exe  LudrixConsole.exe  updater.exe  runtime/ (Python + bibliotecas + webview2/ embutido)  app/ (código, interface, catálogos)\n  Ao abrir, o programa cria só: data/ (ajustes, biblioteca, cache, atualizações, ferramentas)  games/  emulation/  downloads/  themes/\n\nO changelog de cada versão vem do CHANGELOG.md (seção \"## <versão>\")."


def main(argv: list[str]):
    if not argv or argv[0] in ("-h", "--help"):
        print(USAGE)
        return
    cmd, rest = argv[0], argv[1:]
    opt = lambda name: rest[rest.index(name) + 1] if name in rest and rest.index(name) + 1 < len(rest) else None
    if cmd == "version":
        print(version())
    elif cmd == "check":
        cmd_check()
    elif cmd == "bump":
        cmd_bump(rest[0])
    elif cmd == "exe":
        cmd_exe()
    elif cmd == "zip":
        cmd_zip()
    elif cmd == "src":
        cmd_src()
    elif cmd == "integrity":
        cmd_integrity()
    elif cmd == "webview2":
        cmd_webview2()
    elif cmd == "patch":
        cmd_patch(opt("--min"))
    elif cmd == "full":
        cmd_full()
    elif cmd == "feed":
        cmd_feed(rest[0] if rest else FEED_BASE)
    elif cmd == "publish":
        cmd_publish()
    elif cmd == "selftest":
        raise SystemExit(0 if cmd_selftest() else 3)
    elif cmd == "keygen":
        cmd_keygen()
    elif cmd == "sign":
        cmd_sign(rest)
    elif cmd == "all":
        cmd_check()
        cmd_exe()
        cmd_zip()
        if sys.platform == "win32" and _runtime_dir() and not cmd_selftest():
            (REL / f"Ludrix-{version()}.zip").unlink(missing_ok=True)
            print("\nBUILD INTERROMPIDO: o exe compilado não passou no teste. Nada foi empacotado para distribuir.")
            raise SystemExit(3)
        cmd_src()
        cmd_patch(opt("--min"))
        cmd_full()
        url = next((a for a in rest if a.startswith("http")), None)
        cmd_feed(url or FEED_BASE)
        if "--keep-tmp" not in rest:
            clean_build_tmp()
        print("\npronto:", _rel())
        print("  Ludrix\\            programa final (copie essa pasta)")
        print("  Ludrix-<v>.zip     mesma pasta zipada")
        print("  Ludrix-<v>-src.zip codigo-fonte;  ludrix-<v>-patch.lxup / -full.lxup  pacotes de atualizacao")
        print("build\\exe guarda os executaveis compilados (apague se quiser recompilar do zero).")
    else:
        print("comando desconhecido:", cmd)
        print(USAGE)


if __name__ == "__main__":
    main(sys.argv[1:])
