from __future__ import annotations

import os
import json
import re
import struct
import subprocess
import time
from pathlib import Path

IMAGE_EXT = (".iso", ".cue", ".img", ".bin", ".mdf", ".nrg", ".ccd")
SETUP_NAMES = ("setup.exe", "install.exe", "autorun.exe", "start.exe", "launcher.exe", "setup32.exe", "install32.exe", "setup64.exe")
WINCDEMU_URL = "https://github.com/sysprogs/WinCDEmu/releases/download/v4.1/WinCDEmu-4.1.exe"
_CF = 0x08000000 if os.name == "nt" else 0
INSTALLER_RE = re.compile(r"^(setup|install|autorun|msiexec|unarc|unpack|isbew|idriver|_is|is-|dxsetup|vcredist|vc_redist|dotnet|oalinst|physx|directx|redist)", re.I)


def find_images(folder: Path) -> list[Path]:
    out: list[Path] = []
    try:
        files = [p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_EXT]
    except OSError:
        return out
    cues = {p.with_suffix("").name.lower(): p for p in files if p.suffix.lower() == ".cue"}
    ccds = {p.with_suffix("").name.lower() for p in files if p.suffix.lower() == ".ccd"}
    for p in files:
        s = p.suffix.lower()
        if s == ".ccd":
            continue
        if s in (".bin", ".img") and (p.with_suffix("").name.lower() in cues or p.with_suffix("").name.lower() in ccds):
            continue
        if s == ".img" and (p.with_suffix(".mds").exists() or p.with_suffix(".ccd").exists()):
            continue
        if s != ".cue" and p.stat().st_size < 4 * 1024 * 1024:
            continue
        out.append(p)
    pri = {".iso": 0, ".cue": 1, ".img": 2, ".bin": 3, ".mdf": 4, ".nrg": 5}
    out.sort(key=lambda p: (0 if "disc 1" in p.stem.lower() or "disk 1" in p.stem.lower() or "cd1" in p.stem.lower() else 1, pri.get(p.suffix.lower(), 9), p.stem.lower()))
    return out


def parse_cue(cue: Path) -> list[dict]:
    tracks: list[dict] = []
    cur_file = None
    for line in cue.read_text(errors="ignore").splitlines():
        line = line.strip()
        m = re.match(r'FILE\s+"?(.+?)"?\s+(\w+)$', line, re.I)
        if m:
            cur_file = cue.parent / m.group(1)
            continue
        m = re.match(r"TRACK\s+(\d+)\s+(\S+)", line, re.I)
        if m and cur_file:
            tracks.append({"n": int(m.group(1)), "mode": m.group(2).upper(), "file": cur_file})
    return tracks


def cue_info(cue: Path) -> dict:
    tracks = parse_cue(cue)
    data = [t for t in tracks if t["mode"].startswith("MODE")]
    audio = [t for t in tracks if t["mode"] == "AUDIO"]
    return {"tracks": tracks, "data": data, "audio": audio, "files": sorted({str(t["file"]) for t in tracks})}


def _sector_layout(mode: str) -> tuple[int, int]:
    m = mode.upper()
    if m == "MODE1/2048":
        return 2048, 0
    if m == "MODE1/2352":
        return 2352, 16
    if m == "MODE2/2352":
        return 2352, 24
    if m == "MODE2/2336":
        return 2336, 8
    if m == "MODE2/2048":
        return 2048, 0
    raise ValueError(f"Formato de faixa não suportado: {mode}")


def cue_to_iso(cue: Path, out: Path, cb=None, cancel=None) -> Path:
    info = cue_info(cue)
    if not info["data"]:
        raise ValueError("O .cue não tem faixa de dados")
    t = info["data"][0]
    src = Path(t["file"])
    if not src.exists():
        raise FileNotFoundError(f"Arquivo do disco não encontrado: {src.name}")
    sec, off = _sector_layout(t["mode"])
    total = src.stat().st_size
    tmp = out.with_suffix(".iso.part")
    done = 0
    with src.open("rb") as fi, tmp.open("wb") as fo:
        if sec == 2048:
            while True:
                if cancel is not None and cancel.is_set():
                    raise InterruptedError
                buf = fi.read(1024 * 1024 * 4)
                if not buf:
                    break
                fo.write(buf)
                done += len(buf)
                if cb:
                    cb(done / total)
        else:
            chunk = sec * 2048
            while True:
                if cancel is not None and cancel.is_set():
                    raise InterruptedError
                buf = fi.read(chunk)
                if not buf:
                    break
                n = len(buf) // sec
                fo.write(b"".join(buf[i * sec + off:i * sec + off + 2048] for i in range(n)))
                done += len(buf)
                if cb:
                    cb(done / total)
    tmp.replace(out)
    return out


def _iso_root(iso: Path) -> list[tuple[str, bool]]:
    names: list[tuple[str, bool]] = []
    try:
        with iso.open("rb") as f:
            f.seek(16 * 2048)
            pvd = f.read(2048)
            if pvd[1:6] != b"CD001":
                return names
            root = pvd[156:190]
            ext = struct.unpack("<I", root[2:6])[0]
            size = struct.unpack("<I", root[10:14])[0]
            f.seek(ext * 2048)
            d = f.read(min(size, 2048 * 64))
    except OSError:
        return names
    i = 0
    while i < len(d):
        ln = d[i]
        if ln == 0:
            i = (i // 2048 + 1) * 2048
            continue
        nl = d[i + 32]
        nm = d[i + 33:i + 33 + nl].decode("ascii", "ignore").split(";")[0]
        if nm not in ("\x00", "\x01", ""):
            names.append((nm, bool(d[i + 25] & 2)))
        i += ln
    return names


def iso_has_setup(iso: Path) -> bool:
    low = {n.lower() for n, is_dir in _iso_root(iso) if not is_dir}
    return any(n in low for n in SETUP_NAMES) or "autorun.inf" in low


def autorun_target(root: Path) -> Path | None:
    inf = root / "autorun.inf"
    if inf.exists():
        try:
            for line in inf.read_text(errors="ignore").splitlines():
                m = re.match(r"\s*open\s*=\s*(.+)", line, re.I)
                if m:
                    exe = m.group(1).strip().strip('"').split(" ")[0]
                    p = root / exe
                    if p.exists() and p.suffix.lower() == ".exe":
                        return p
        except OSError:
            pass
    for n in SETUP_NAMES:
        p = root / n
        if p.exists():
            return p
    for sub in ("setup", "install", "Setup", "Install", "bin", "Bin"):
        d = root / sub
        if d.is_dir():
            for n in SETUP_NAMES:
                p = d / n
                if p.exists():
                    return p
    exes = sorted(root.glob("*.exe"), key=lambda p: p.stat().st_size)
    return exes[0] if exes else None


def _ps(cmd: str, timeout: int = 90) -> subprocess.CompletedProcess:
    return subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", cmd],
                          capture_output=True, text=True, timeout=timeout, creationflags=_CF)


def mount(iso: Path) -> Path:
    if os.name != "nt":
        raise RuntimeError("Montar disco só funciona no Windows")
    q = "'" + str(iso).replace("'", "''") + "'"
    r = _ps(f"$i=Mount-DiskImage -ImagePath {q} -PassThru -ErrorAction Stop; Start-Sleep -Milliseconds 800; ($i | Get-Volume).DriveLetter")
    letter = (r.stdout or "").strip().splitlines()[-1].strip() if (r.stdout or "").strip() else ""
    if r.returncode != 0 or not re.fullmatch(r"[A-Za-z]", letter):
        for _ in range(6):
            time.sleep(1)
            r2 = _ps(f"(Get-DiskImage -ImagePath {q} | Get-Volume).DriveLetter")
            letter = (r2.stdout or "").strip()
            if re.fullmatch(r"[A-Za-z]", letter):
                break
    if not re.fullmatch(r"[A-Za-z]", letter):
        err = (r.stderr or "").strip().splitlines()
        raise RuntimeError(err[0][:160] if err else "O Windows não conseguiu montar a imagem")
    return Path(f"{letter.upper()}:\\")


def unmount(iso: Path):
    if os.name != "nt":
        return
    q = "'" + str(iso).replace("'", "''") + "'"
    try:
        _ps(f"Dismount-DiskImage -ImagePath {q} -ErrorAction SilentlyContinue", timeout=40)
    except Exception:
        pass


def _procs() -> list[dict]:
    r = _ps("Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CreationDate | ConvertTo-Json -Compress", timeout=60)
    txt = (r.stdout or "").strip()
    if not txt:
        return []
    try:
        data = json.loads(txt)
    except ValueError:
        return []
    return data if isinstance(data, list) else [data]


def _dmtf(v) -> float:
    if isinstance(v, dict):
        v = v.get("value") or v.get("DateTime") or ""
    s = str(v or "")
    m = re.match(r"/Date\((\d+)", s)
    if m:
        return int(m.group(1)) / 1000
    try:
        from datetime import datetime
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        pass
    m = re.match(r"(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.\d*([+-]\d{3})", s)
    if m:
        import calendar
        return calendar.timegm(tuple(int(x) for x in m.groups()[:6]) + (0, 0, 0)) - int(m.group(7)) * 60
    return 0.0


def related_procs(seen: set[int], drive: Path | None, t0: float, procs: list[dict]) -> list[dict]:
    d = (str(drive)[:2].lower() + "\\") if drive else None
    out: list[dict] = []
    grew = True
    while grew:
        grew = False
        for p in procs:
            pid, ppid = int(p.get("ProcessId") or 0), int(p.get("ParentProcessId") or 0)
            if pid in seen:
                continue
            path = str(p.get("ExecutablePath") or "").lower()
            name = str(p.get("Name") or "")
            rel = ppid in seen or (d and path.startswith(d))
            if not rel and INSTALLER_RE.match(name) and _dmtf(p.get("CreationDate")) >= t0 - 5:
                rel = True
            if rel:
                seen.add(pid)
                grew = True
    for p in procs:
        if int(p.get("ProcessId") or 0) in seen:
            out.append(p)
    return out


def wait_install(pid: int, drive: Path | None, t0: float, on_tick=None, max_s: int = 3 * 3600) -> float:
    if os.name != "nt":
        return 0.0
    seen: set[int] = {pid} if pid else set()
    quiet = 0
    deadline = time.time() + max_s
    time.sleep(3)
    while time.time() < deadline:
        alive = related_procs(seen, drive, t0, _procs())
        if alive:
            quiet = 0
            if on_tick:
                on_tick(alive)
        else:
            quiet += 1
            if quiet >= 2:
                break
        time.sleep(4)
    return time.time() - t0


def plan(folder: Path) -> dict | None:
    imgs = find_images(folder)
    if not imgs:
        return None
    first = imgs[0]
    out = {"image": str(first), "images": [str(p) for p in imgs], "kind": first.suffix.lower().lstrip("."), "convert": False, "audio": False, "setup": True}
    if first.suffix.lower() == ".cue":
        info = cue_info(first)
        out["convert"] = True
        out["audio"] = bool(info["audio"])
        out["setup"] = bool(info["data"])
    elif first.suffix.lower() in (".bin", ".img"):
        out["convert"] = True
    elif first.suffix.lower() == ".iso":
        out["setup"] = iso_has_setup(first)
    else:
        out["setup"] = False
    return out
