from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Callable

from .hosts import Session

from . import paths

try:
    import libtorrent as lt
except Exception:
    lt = None

from .installer import CancelledError, Progress, human_size

log = logging.getLogger("ludrix.torrent")


ARIA2_URL = "https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip"
_aria_lock = threading.Lock()


def aria2_path() -> Path | None:
    p = paths.BIN / "aria2c.exe"
    if p.exists():
        return p
    w = shutil.which("aria2c")
    return Path(w) if w else None


def ensure_aria2(session=None) -> Path | None:
    found = aria2_path()
    if found or os.name != "nt":
        return found
    with _aria_lock:
        found = aria2_path()
        if found:
            return found
        try:
            import io
            import zipfile
            s = session or Session()
            r = s.get(ARIA2_URL, timeout=120)
            r.raise_for_status()
            with zipfile.ZipFile(io.BytesIO(r.content)) as z:
                name = next(n for n in z.namelist() if n.lower().endswith("aria2c.exe"))
                paths.BIN.mkdir(parents=True, exist_ok=True)
                (paths.BIN / "aria2c.exe").write_bytes(z.read(name))
            return paths.BIN / "aria2c.exe"
        except Exception as e:
            log.warning("aria2c: %s", e)
            return None


def available() -> bool:
    return lt is not None or aria2_path() is not None or os.name == "nt"


def engine() -> str:
    return "libtorrent" if lt is not None else ("aria2" if (aria2_path() or os.name == "nt") else "none")


class TorrentClient:
    _instance = None
    _guard = threading.Lock()

    def __init__(self, store):
        self.store = store
        self.session = None
        if lt:
            self.session = lt.session({
                "listen_interfaces": "0.0.0.0:6881,[::]:6881",
                "enable_dht": True, "enable_lsd": True, "enable_upnp": True, "enable_natpmp": True,
                "user_agent": "Ludrix/1.0",
                "download_rate_limit": int(store.config.get("torrent_max_down") or 0) * 1024,
                "upload_rate_limit": int(store.config.get("torrent_max_up") or 0) * 1024,
            })
            for router in (("router.bittorrent.com", 6881), ("router.utorrent.com", 6881), ("dht.transmissionbt.com", 6881)):
                self.session.add_dht_router(*router)

    @classmethod
    def get(cls, store) -> "TorrentClient":
        with cls._guard:
            if cls._instance is None:
                cls._instance = cls(store)
            return cls._instance

    quiet = False

    def apply_limits(self):
        if self.session:
            s = self.session.get_settings()
            down = int(self.store.config.get("torrent_max_down") or 0) * 1024
            up = int(self.store.config.get("torrent_max_up") or 0) * 1024
            if self.quiet:
                down = min(down or 512 * 1024, 512 * 1024)
                up = min(up or 64 * 1024, 64 * 1024)
            s["download_rate_limit"] = down
            s["upload_rate_limit"] = up
            self.session.apply_settings(s)

    def download(self, source: str, dest_dir: Path, cb: Callable[[Progress], None],
                 cancel: threading.Event, http_session=None) -> Path:
        dest_dir.mkdir(parents=True, exist_ok=True)
        if not lt:
            return self._download_aria2(source, dest_dir, cb, cancel, http_session)
        params = lt.add_torrent_params()
        if source.startswith("magnet:"):
            params = lt.parse_magnet_uri(source)
        elif not re.match(r"^https?://", source) and Path(source).is_file():
            params.ti = lt.torrent_info(lt.bdecode(Path(source).read_bytes()))
        else:
            cb(Progress("download", -1, "Baixando .torrent..."))
            r = http_session.get(source, timeout=30) if http_session else __import__("requests").get(source, timeout=30)
            r.raise_for_status()
            params.ti = lt.torrent_info(lt.bdecode(r.content))
        params.save_path = str(dest_dir)
        params.flags |= lt.torrent_flags.sequential_download
        h = self.session.add_torrent(params)

        cb(Progress("download", -1, "Procurando peers..."))
        last = time.time()
        try:
            while True:
                if cancel.is_set():
                    raise CancelledError()
                st = h.status()
                if not st.has_metadata:
                    time.sleep(0.5)
                    if time.time() - last > 120:
                        raise RuntimeError("Nenhum peer respondeu em 2 minutos (torrent sem seeds?)")
                    continue
                if st.state in (lt.torrent_status.seeding, lt.torrent_status.finished) or st.progress >= 1.0:
                    break
                total = st.total_wanted
                done = st.total_wanted_done
                eta = (total - done) / st.download_rate if st.download_rate > 0 else 0
                cb(Progress("download", done / total if total else -1,
                            f"{human_size(done)} / {human_size(total)}  •  ↓ {human_size(st.download_rate)}/s  "
                            f"↑ {human_size(st.upload_rate)}/s  •  {st.num_peers} peers  •  ETA {int(eta // 60)}m{int(eta % 60):02d}s"))
                time.sleep(0.7)
        finally:
            if cancel.is_set() or not self.store.config.get("torrent_seed_after"):
                try:
                    self.session.remove_torrent(h)
                except Exception:
                    pass
        ti = h.torrent_file()
        name = ti.name() if ti else ""
        p = dest_dir / name
        return p if p.exists() else dest_dir

    _ARIA_RX = re.compile(r"\[#\w+\s+(?P<done>[\d.]+\s*[KMGT]?i?B)(?:/(?P<total>[\d.]+\s*[KMGT]?i?B)\((?P<pct>\d+)%\))?")
    _ARIA_F = {k: re.compile(k + r":(\w+)") for k in ("CN", "SD", "DL", "ETA")}

    def _download_aria2(self, source: str, dest_dir: Path, cb, cancel: threading.Event, http_session=None) -> Path:
        cb(Progress("download", -1, "Preparando o motor de torrent..."))
        exe = ensure_aria2(http_session)
        if not exe:
            raise RuntimeError("Torrent indisponível: nem libtorrent nem aria2c (sem internet pra baixar o motor?)")
        before = {p.name for p in dest_dir.iterdir()}
        down = int(self.store.config.get("torrent_max_down") or 0)
        up = int(self.store.config.get("torrent_max_up") or 0)
        args = [str(exe), "--dir", str(dest_dir), "--seed-time=0", "--bt-stop-timeout=180", "--summary-interval=1",
                "--console-log-level=warn", "--enable-dht=true", "--enable-dht6=false", "--bt-enable-lpd=true", "--enable-peer-exchange=true",
                "--follow-torrent=mem", "--bt-save-metadata=false", "--file-allocation=none", "--allow-overwrite=true",
                "--auto-file-renaming=false", "--continue=true", "--human-readable=true", "--check-certificate=false",
                "--dht-entry-point=router.bittorrent.com:6881", "--dht-entry-point=dht.transmissionbt.com:6881",
                "--max-download-limit=%dK" % down if down else "--max-download-limit=0",
                "--max-upload-limit=%dK" % up if up else "--max-upload-limit=0", source]
        flags = 0x08000000 if os.name == "nt" else 0
        proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace",
                                creationflags=flags, cwd=str(dest_dir))
        cb(Progress("download", -1, "Procurando peers..."))
        tail: list[str] = []
        try:
            for line in proc.stdout:
                if cancel.is_set():
                    proc.kill()
                    raise CancelledError()
                line = line.strip()
                if not line:
                    continue
                tail.append(line)
                tail[:] = tail[-15:]
                m = self._ARIA_RX.search(line)
                if not m:
                    continue
                pct = m.group("pct")
                f = {k: (rx.search(line).group(1) if rx.search(line) else "") for k, rx in self._ARIA_F.items()}
                frac = int(pct) / 100 if pct else -1
                txt = f"{m.group('done')} / {m.group('total') or '?'}  •  ↓ {f['DL'] or '0B'}/s  •  {f['CN'] or 0} peers ({f['SD'] or 0} seeds)"
                if f["ETA"]:
                    txt += f"  •  ETA {f['ETA']}"
                cb(Progress("download", frac, txt))
            proc.wait()
        finally:
            if proc.poll() is None:
                proc.kill()
        if proc.returncode not in (0, 13):
            hint = next((t for t in reversed(tail) if "error" in t.lower() or "ERR" in t), tail[-1] if tail else "")
            raise RuntimeError(f"aria2c terminou com erro {proc.returncode}: {hint[:200]}")
        new = [p for p in dest_dir.iterdir() if p.name not in before and not p.name.endswith((".aria2", ".torrent"))]
        for junk in dest_dir.glob("*.aria2"):
            junk.unlink(missing_ok=True)
        if len(new) == 1:
            return new[0]
        return dest_dir
