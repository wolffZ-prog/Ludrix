from __future__ import annotations

import hashlib
import io
import os
import time
import threading
from pathlib import Path

import requests
from PIL import Image

from . import paths

THUMB_H = 300
COVER_H = 720
SHOT_H = 360
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock(key: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


def _safe(key: str) -> str:
    return hashlib.sha1(key.encode()).hexdigest()[:20]


def is_error_image(img) -> bool:
    try:
        if img.size != (180, 140):
            return False
        r, g, b = img.convert("RGB").getpixel((5, 5))[:3]
        return r > 235 and g < 110 and b < 110
    except Exception:
        return False


def _convert(data: bytes, max_h: int, quality: int) -> bytes | None:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
        if is_error_image(img):
            return None
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")
        if img.height > max_h:
            w = int(img.width * max_h / img.height)
            img = img.resize((w, max_h), Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, "WEBP", quality=quality, method=4)
        return out.getvalue()
    except Exception:
        return None


class _DirSet:
    def __init__(self, folder: Path):
        self.folder = folder
        self.names: set[str] = set()
        self.t = 0.0
        self.lock = threading.Lock()

    def get(self) -> set[str]:
        now = time.time()
        if now - self.t > 2.0:
            with self.lock:
                if now - self.t > 2.0:
                    try:
                        self.names = set(os.listdir(self.folder))
                    except OSError:
                        self.names = set()
                    self.t = now
        return self.names

    def add(self, name: str):
        self.names.add(name)

    def discard(self, name: str):
        self.names.discard(name)


class ImageCache:
    def __init__(self, session: requests.Session):
        self.s = session
        self._thumbs = _DirSet(paths.CACHE_THUMBS)
        self.on_thumb = None

    def _fetch(self, key: str, url: str, folder: Path, max_h: int, quality: int) -> Path | None:
        if not url:
            return None
        p = folder / f"{_safe(key)}.webp"
        if p.exists() and p.stat().st_size > 0:
            return p
        with _lock(key):
            if p.exists() and p.stat().st_size > 0:
                return p
            try:
                r = self.s.get(url, timeout=25)
                if not r.ok or not r.content:
                    return None
                data = _convert(r.content, max_h, quality)
                if not data:
                    return None
                folder.mkdir(parents=True, exist_ok=True)
                tmp = p.with_suffix(".tmp")
                tmp.write_bytes(data)
                tmp.replace(p)
                if folder == paths.CACHE_THUMBS:
                    self._thumbs.add(p.name)
                    if self.on_thumb and key.startswith("t:"):
                        try:
                            self.on_thumb(key[2:])
                        except Exception:
                            pass
                return p
            except requests.RequestException:
                return None

    def thumb(self, key: str, url: str) -> Path | None:
        return self._fetch("t:" + key, url, paths.CACHE_THUMBS, THUMB_H, 78)

    def cover(self, key: str, url: str) -> Path | None:
        return self._fetch("c:" + key, url, paths.CACHE_COVERS, COVER_H, 84)

    def shot(self, key: str, i: int, url: str) -> Path | None:
        return self._fetch(f"s:{key}:{i}", url, paths.CACHE_SHOTS, SHOT_H, 76)

    def local_thumb(self, key: str, src: Path) -> Path | None:
        p = paths.CACHE_THUMBS / f"{_safe('t:' + key)}.webp"
        try:
            if p.exists() and p.stat().st_mtime >= src.stat().st_mtime:
                return p
            data = _convert(src.read_bytes(), THUMB_H, 80)
            if not data:
                return src
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(".tmp")
            tmp.write_bytes(data)
            tmp.replace(p)
            return p
        except OSError:
            return src

    def has_thumb(self, key: str) -> bool:
        return f"{_safe('t:' + key)}.webp" in self._thumbs.get()

    def cached_thumb(self, key: str) -> Path | None:
        p = paths.CACHE_THUMBS / f"{_safe('t:' + key)}.webp"
        return p if self.has_thumb(key) or p.exists() else None

    def invalidate(self, key: str):
        for f in (paths.CACHE_THUMBS / f"{_safe('t:' + key)}.webp", paths.CACHE_COVERS / f"{_safe('c:' + key)}.webp"):
            f.unlink(missing_ok=True)
        self._thumbs.discard(f"{_safe('t:' + key)}.webp")
