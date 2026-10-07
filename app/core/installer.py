from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import requests
from .hosts import Session
from .diag import ensure_space

from . import paths
from .repos import FileRef


class CancelledError(Exception):
    pass


@dataclass
class Progress:
    stage: str
    fraction: float
    detail: str = ""


ProgressCb = Callable[[Progress], None]


def safe_folder_name(title: str) -> str:
    name = re.sub(r'[<>:"/\\|?*]+', "", title).strip(" .")
    return name or "game"


def human_size(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return f"{n:.1f} PB"


SEVENZIP_URL = "https://www.7-zip.org/a/7zr.exe"
_7z_lock = threading.Lock()


def ensure_7z(session=None) -> str | None:
    found = find_7z()
    if found or os.name != "nt":
        return found
    with _7z_lock:
        found = find_7z()
        if found:
            return found
        try:
            s = session or Session()
            r = s.get(SEVENZIP_URL, timeout=60)
            r.raise_for_status()
            paths.BIN.mkdir(parents=True, exist_ok=True)
            tmp = paths.BIN / "7zr.exe.part"
            tmp.write_bytes(r.content)
            tmp.replace(paths.BIN / "7zr.exe")
            return str(paths.BIN / "7zr.exe")
        except Exception:
            return None


def find_7z() -> str | None:
    candidates = [paths.BIN / "7za.exe", paths.BIN / "7z.exe", paths.BIN / "7zr.exe"]
    candidates += [Path(r"C:\Program Files\7-Zip\7z.exe"), Path(r"C:\Program Files (x86)\7-Zip\7z.exe")]
    for c in candidates:
        if c.exists():
            return str(c)
    for name in ("7z", "7za", "7zr"):
        p = shutil.which(name)
        if p:
            return p
    return None


STATS = {"speed": 0.0}


class Downloader:
    CHUNK = 1024 * 512

    def __init__(self, session: requests.Session | None = None):
        self.session = session or Session()
        self.session.headers.update({"User-Agent": "Ludrix/1.0"})

    def download(self, af: FileRef, dest: Path, cb: ProgressCb, cancel: threading.Event) -> Path:
        dest.parent.mkdir(parents=True, exist_ok=True)
        part = dest.with_suffix(dest.suffix + ".part")
        have = part.stat().st_size if part.exists() else 0

        base_headers = dict(getattr(af, "headers", None) or {})
        cookies = dict(getattr(af, "cookies", None) or {})
        decrypt = getattr(af, "decrypt", None)
        headers = dict(base_headers)
        if have:
            headers["Range"] = f"bytes={have}-"
        checked = False

        for attempt in range(1, 6):
            try:
                with self.session.get(af.url, headers=headers, cookies=cookies or None, stream=True, timeout=(15, 60), allow_redirects=True) as r:
                    if r.status_code == 416:
                        break
                    if r.status_code in (403, 404, 410):
                        raise RuntimeError(f"Arquivo indisponível no servidor (HTTP {r.status_code})")
                    r.raise_for_status()
                    if r.status_code != 206:
                        have = 0
                    total = have + int(r.headers.get("Content-Length", 0) or 0)
                    if not total:
                        total = af.size
                    if not checked:
                        checked = True
                        ensure_space(dest.parent, total - have, "baixar")
                    mode = "ab" if have else "wb"
                    t0 = time.time(); got0 = have; speed = 0.0
                    dec = decrypt(have) if decrypt else None
                    with open(part, mode) as fh:
                        for chunk in r.iter_content(self.CHUNK):
                            if cancel.is_set():
                                raise CancelledError()
                            fh.write(dec(chunk) if dec else chunk)
                            have += len(chunk)
                            dt = time.time() - t0
                            if dt >= 0.5:
                                speed = (have - got0) / dt
                                STATS["speed"] = speed if not STATS["speed"] else STATS["speed"] * 0.7 + speed * 0.3
                                t0 = time.time(); got0 = have
                                eta = (total - have) / speed if speed > 0 else 0
                                cb(Progress(
                                    "download", have / total if total else -1,
                                    f"{human_size(have)} / {human_size(total)}  •  "
                                    f"{human_size(speed)}/s  •  ETA {int(eta // 60)}m{int(eta % 60):02d}s",
                                ))
                break
            except CancelledError:
                raise
            except (requests.RequestException, OSError) as e:
                if attempt == 5:
                    raise
                cb(Progress("download", -1, f"Conexão caiu ({e.__class__.__name__}), tentando de novo em {attempt * 3}s..."))
                for _ in range(attempt * 3 * 10):
                    if cancel.is_set():
                        raise CancelledError()
                    time.sleep(0.1)
                have = part.stat().st_size if part.exists() else 0
                headers = dict(base_headers)
                if have:
                    headers["Range"] = f"bytes={have}-"

        part.rename(dest)
        return dest


def unpacked_size(archive: Path) -> int:
    try:
        if archive.suffix.lower() == ".zip":
            with zipfile.ZipFile(archive) as z:
                return sum(i.file_size for i in z.infolist())
        if archive.suffix.lower() == ".7z":
            import py7zr
            with py7zr.SevenZipFile(archive, "r") as z:
                return int(z.archiveinfo().uncompressed or 0)
    except Exception:
        pass
    return int(archive.stat().st_size * 1.5)


def extract(archive: Path, target: Path, cb: ProgressCb, cancel: threading.Event):
    target.mkdir(parents=True, exist_ok=True)
    ensure_space(target, unpacked_size(archive), "extrair")
    ext = archive.suffix.lower()
    seven = ensure_7z()

    if seven and (ext != ".zip" or not seven.lower().endswith("7zr.exe")):
        _extract_with_7z(seven, archive, target, cb, cancel)
    elif ext == ".zip":
        _extract_zip(archive, target, cb, cancel)
    elif ext == ".7z":
        _extract_py7zr(archive, target, cb, cancel)
    elif ext in (".gz", ".xz", ".bz2", ".tgz", ".txz", ".tar", ".zst") and _is_tar(archive):
        _extract_tar(archive, target, cb, cancel)
    elif ext == ".rar":
        raise RuntimeError("Arquivo .rar precisa do 7-Zip" + (" (bin/7zr.exe não pôde ser baixado). Instale o 7-Zip e tente de novo." if os.name == "nt" else ". Instale o pacote p7zip (7z) e tente de novo."))
    else:
        raise RuntimeError(f"Sem extrator para {ext}. " + ("Instale o 7-Zip ou coloque 7za.exe na pasta bin/." if os.name == "nt" else "Instale o pacote p7zip (7z)."))


def _is_tar(archive: Path) -> bool:
    import tarfile
    try:
        return tarfile.is_tarfile(archive)
    except Exception:
        return False


def _extract_tar(archive: Path, target: Path, cb: ProgressCb, cancel: threading.Event):
    import tarfile
    with tarfile.open(archive) as t:
        members = t.getmembers()
        n = max(1, len(members))
        for i, m in enumerate(members):
            if cancel.is_set():
                raise CancelledError()
            name = m.name
            if name.startswith("/") or ".." in Path(name).parts or m.issym() or m.islnk() or m.isdev():
                continue
            t.extract(m, target, filter="data") if hasattr(tarfile, "data_filter") else t.extract(m, target)
            if i % 20 == 0:
                cb(Progress("extract", i / n, f"{int(i / n * 100)}%  {Path(name).name[:60]}"))


def _extract_with_7z(seven: str, archive: Path, target: Path, cb: ProgressCb, cancel: threading.Event):
    cmd = [seven, "x", str(archive), f"-o{target}", "-y", "-bsp1", "-bso0", "-bse1"]
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, errors="replace", bufsize=0, creationflags=flags)
    buf = ""
    while True:
        if cancel.is_set():
            proc.kill()
            raise CancelledError()
        ch = proc.stdout.read(1)
        if not ch:
            break
        buf += ch
        if ch in "\r\n":
            m = re.search(r"(\d{1,3})%", buf)
            if m:
                pct = int(m.group(1))
                name = buf.split("-", 1)[-1].strip()[:60] if "-" in buf else ""
                cb(Progress("extract", pct / 100, f"{pct}%  {name}"))
            buf = ""
    rc = proc.wait()
    if rc not in (0, 1):
        raise RuntimeError(f"7-Zip retornou código {rc}")


def safe_member(target: Path, name: str) -> Path:
    n = (name or "").replace("\\", "/")
    if not n or n.startswith("/") or ".." in n.split("/") or re.match(r"^[a-zA-Z]:", n):
        raise RuntimeError(f"Arquivo suspeito no pacote: {name}")
    dest = (target / n).resolve()
    root = target.resolve()
    if dest != root and root not in dest.parents:
        raise RuntimeError(f"Caminho fora da pasta: {name}")
    return dest


def safe_extractall(z: zipfile.ZipFile, target: Path):
    for i in z.infolist():
        dest = safe_member(target, i.filename)
        if i.is_dir():
            dest.mkdir(parents=True, exist_ok=True)
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        with z.open(i) as src, open(dest, "wb") as out:
            shutil.copyfileobj(src, out, 1 << 20)


def _extract_zip(archive: Path, target: Path, cb: ProgressCb, cancel: threading.Event):
    with zipfile.ZipFile(archive) as z:
        infos = z.infolist()
        total = sum(i.file_size for i in infos) or 1
        done = 0
        for i in infos:
            if cancel.is_set():
                raise CancelledError()
            dest = safe_member(target, i.filename)
            if i.is_dir():
                dest.mkdir(parents=True, exist_ok=True)
            else:
                dest.parent.mkdir(parents=True, exist_ok=True)
                with z.open(i) as src, open(dest, "wb") as out:
                    shutil.copyfileobj(src, out, 1 << 20)
            done += i.file_size
            cb(Progress("extract", done / total, f"{int(done / total * 100)}%  {i.filename[-60:]}"))


def _extract_py7zr(archive: Path, target: Path, cb: ProgressCb, cancel: threading.Event):
    import py7zr

    cb(Progress("extract", -1, "Extraindo (py7zr, modo lento)... instale o 7-Zip pra acelerar"))
    try:
        with py7zr.SevenZipFile(archive, "r") as z:
            z.extractall(path=target)
    except py7zr.exceptions.UnsupportedCompressionMethodError as e:
        if not any(target.rglob("*")):
            raise RuntimeError("Este .7z usa um filtro (BCJ2) que só o 7-Zip real abre. Instale o 7-Zip ou coloque 7zr.exe em bin/.") from e
    cb(Progress("extract", 1.0, "100%"))


_BAD_EXE = re.compile(
    r"(unins|setup|install|redist|vcredist|dxsetup|dxwebsetup|directx|dotnet|physx|"
    r"crash|report|handler|launcher_helper|unitycrash|eac|easyanticheat|battleye|"
    r"updater|patcher|config|settings|benchmark|editor|server|uploader|7z|winrar|touchup|register|activation)",
    re.I,
)


def _is_elf(p: Path) -> bool:
    try:
        with open(p, "rb") as f:
            return f.read(4) == b"\x7fELF"
    except OSError:
        return False


def find_executables(folder: Path, title: str = "") -> list[Path]:
    exes = [p for p in folder.rglob("*.exe")]
    if os.name != "nt":
        for p in folder.rglob("*"):
            if not p.is_file() or p.suffix.lower() == ".exe":
                continue
            if p.suffix.lower() in (".sh", ".x86_64", ".x86", ".appimage") or (p.suffix == "" and os.access(p, os.X_OK) and _is_elf(p)):
                exes.append(p)
    if not exes:
        return []
    words = [w for w in re.findall(r"[a-z0-9]+", title.lower()) if len(w) > 2]

    def score(p: Path) -> tuple:
        n = p.stem.lower()
        s = 0
        if os.name != "nt" and p.suffix.lower() != ".exe":
            s += 40
        if _BAD_EXE.search(n):
            s -= 100
        if any(w in n for w in words):
            s += 30
        if "launcher" in n:
            s += 10
        if "game" in n or "play" in n:
            s += 5
        depth = len(p.relative_to(folder).parts)
        s -= depth * 3
        try:
            size = p.stat().st_size
        except OSError:
            size = 0
        return (-s, -size)

    return sorted(exes, key=score)


_SETUP_RE = re.compile(r"^(setup|install|installer|setup_[^/\\]*|[^/\\]*setup)\.exe$", re.I)


def find_setup(folder: Path) -> Path | None:
    try:
        cands = [p for p in folder.rglob("*.exe") if _SETUP_RE.match(p.name) and len(p.relative_to(folder).parts) <= 2]
    except OSError:
        return None
    if not cands:
        return None

    def score(p: Path) -> tuple:
        sib = list(p.parent.glob("*.bin")) + list(p.parent.glob("*.arc")) + list(p.parent.glob("*.pak"))
        return (-len(sib), len(p.relative_to(folder).parts), -(p.stat().st_size if p.exists() else 0))
    cands.sort(key=score)
    return cands[0]


def is_repack(folder: Path) -> bool:
    st = find_setup(folder)
    if not st:
        return False
    real = [x for x in find_executables(folder) if not _BAD_EXE.search(x.stem.lower())]
    bins = list(st.parent.glob("*.bin"))
    return bool(bins) or not real


def flatten_single_folder(target: Path):
    entries = [e for e in target.iterdir()]
    if len(entries) == 1 and entries[0].is_dir():
        inner = entries[0]
        tmp = target / (inner.name + "__tmp")
        inner.rename(tmp)
        for e in tmp.iterdir():
            shutil.move(str(e), str(target / e.name))
        tmp.rmdir()


ARCHIVE_EXT = re.compile(r"\.(7z|zip|rar)(\.001)?$", re.I)


def install_from_archives(archives: list[Path], game_dir: Path, cb: ProgressCb, cancel: threading.Event,
                          keep: bool, title: str) -> list[Path]:
    game_dir.mkdir(parents=True, exist_ok=True)
    for a in archives:
        if re.search(r"\.\d{3}$", a.name) and not a.name.lower().endswith(".001"):
            continue
        if ARCHIVE_EXT.search(a.name):
            cb(Progress("extract", 0, f"Extraindo {a.name}..."))
            extract(a, game_dir, cb, cancel)
        elif keep and paths.DOWNLOADS not in a.parents:
            cb(Progress("extract", -1, f"Copiando {a.name}..."))
            shutil.copy2(str(a), str(game_dir / a.name))
        else:
            cb(Progress("extract", -1, f"Movendo {a.name}..."))
            shutil.move(str(a), str(game_dir / a.name))
    flatten_single_folder(game_dir)
    if not keep:
        cb(Progress("cleanup", -1, "Apagando arquivos baixados..."))
        for a in archives:
            try:
                if a.exists():
                    a.unlink()
            except OSError:
                pass
    return find_executables(game_dir, title)


def install_game(
    files: list[FileRef],
    title: str,
    install_root: Path,
    cb: ProgressCb,
    cancel: threading.Event,
    keep_archive: bool = False,
    session: requests.Session | None = None,
    resolver=None,
) -> tuple[Path, list[Path]]:
    game_dir = install_root / safe_folder_name(title)
    tmp_dir = paths.DOWNLOADS / safe_folder_name(title)
    dl = Downloader(session)
    downloaded = []
    n = len(files)
    for i, af in enumerate(files, 1):
        prefix = f"[{i}/{n}] " if n > 1 else ""
        cb(Progress("download", 0, f"{prefix}Conectando..."))
        if resolver and not af.url.startswith("http"):

            cb(Progress("download", 0, f"{prefix}Pedindo o link ao site..."))
            got = resolver(af)
            url, hdrs = got[0], got[1]
            keep_attrs = {k: getattr(af, k) for k in ("cookies", "decrypt") if hasattr(af, k)}
            af = FileRef(got[2] if len(got) > 2 and got[2] else af.name, url, (got[3] if len(got) > 3 and got[3] else 0) or af.size)
            af.headers = hdrs
            for k, v in keep_attrs.items():
                setattr(af, k, v)
        dest = tmp_dir / af.basename
        if dest.exists() and af.size and dest.stat().st_size == af.size:
            cb(Progress("download", 1.0, f"{prefix}{af.basename} já baixado"))
        else:
            wrapped = (lambda p, pre=prefix: cb(Progress(p.stage, p.fraction, pre + p.detail))) if n > 1 else cb
            dl.download(af, dest, wrapped, cancel)
        downloaded.append(dest)

    existed = game_dir.exists()
    try:
        exes = install_from_archives(downloaded, game_dir, cb, cancel, keep_archive, title)
    except BaseException:
        if not existed:
            shutil.rmtree(game_dir, ignore_errors=True)
        raise
    if not keep_archive:
        shutil.rmtree(tmp_dir, ignore_errors=True)
    cb(Progress("done", 1.0, f"Instalado em {game_dir}"))
    return game_dir, exes
