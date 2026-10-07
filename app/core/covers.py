from __future__ import annotations

import logging
import os
import re
import shutil
import threading
import time
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

import requests

from . import paths

log = logging.getLogger("ludrix.covers")

STEAM_SEARCH = "https://store.steampowered.com/api/storesearch/"
STEAM_DETAILS = "https://store.steampowered.com/api/appdetails"
STEAM_CDN = "https://cdn.akamai.steamstatic.com/steam/apps/{aid}/"
LIBRETRO = "https://thumbnails.libretro.com/{sys}/Named_Boxarts/"


LIBRETRO_SYS = {
    "ps1": "Sony - PlayStation", "ps2": "Sony - PlayStation 2", "psp": "Sony - PlayStation Portable", "ps3": "Sony - PlayStation 3",
    "n64": "Nintendo - Nintendo 64", "gc": "Nintendo - GameCube", "wii": "Nintendo - Wii", "wiiu": "Nintendo - Wii U",
    "gba": "Nintendo - Game Boy Advance", "snes": "Nintendo - Super Nintendo Entertainment System", "nes": "Nintendo - Nintendo Entertainment System",
    "nds": "Nintendo - Nintendo DS", "3ds": "Nintendo - Nintendo 3DS",
    "genesis": "Sega - Mega Drive - Genesis", "sms": "Sega - Master System - Mark III", "dc": "Sega - Dreamcast", "saturn": "Sega - Saturn",
    "xbox": "Microsoft - Xbox", "x360": "Microsoft - Xbox 360", "pce": "NEC - PC Engine - TurboGrafx 16", "atari2600": "Atari - 2600",
    "arcade": "MAME", "dos": "DOS", "pc": "", "switch": "",
}

LIBRETRO_ALT = {"gba": ("Nintendo - Game Boy Color", "Nintendo - Game Boy"), "sms": ("Sega - Game Gear",)}
GOG_CATALOG = "https://catalog.gog.com/v1/catalog"
CUSTOM_EXT = (".png", ".jpg", ".jpeg", ".webp")


def _norm(t: str) -> str:
    t = unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode()
    t = re.sub(r"\(.*?\)|\[.*?\]", "", t)
    t = re.sub(r"[\u2122\u00ae]|\b(the|a|an|of|and|&|-)\b", " ", t.lower())
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def _sim(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


class CoverService:
    def __init__(self, session: requests.Session, store):
        self.s = session
        self.store = store
        self._lr_index: dict[str, tuple[float, list[tuple[str, str]]]] = {}
        self._lr_lock = threading.Lock()
        self._inflight: set[str] = set()
        self._inflight_lock = threading.Lock()
        self.custom_dir = paths.DATA / "covers"
        self._names: set[str] = set()
        self._names_t = 0.0

    def _listing(self) -> set[str]:
        now = time.time()
        if now - self._names_t > 2.0:
            try:
                self._names = set(os.listdir(self.custom_dir))
            except OSError:
                self._names = set()
            self._names_t = now
        return self._names

    def custom_path(self, key: str) -> Path | None:
        names = self._listing()
        if not names:
            return None
        base = re.sub(r"[^a-zA-Z0-9_.-]", "_", key)[:120]
        for ext in CUSTOM_EXT:
            if base + ext in names:
                return self.custom_dir / (base + ext)
        return None

    def set_custom(self, key: str, src: str, fast: bool = False) -> dict:
        from PIL import Image
        p = Path(src)
        if not p.exists():
            return {"error": "Arquivo não encontrado"}
        if fast and p.suffix.lower() in CUSTOM_EXT:

            try:
                if p.stat().st_size <= 4 * 1024 * 1024:
                    self.remove_custom(key)
                    self.custom_dir.mkdir(parents=True, exist_ok=True)
                    dest = self.custom_dir / (re.sub(r"[^a-zA-Z0-9_.-]", "_", key)[:120] + p.suffix.lower())
                    shutil.copyfile(p, dest)
                    self._names_t = 0.0
                    return {"ok": True, "path": str(dest)}
            except OSError as ex:
                return {"error": str(ex)}
        try:
            img = Image.open(p)
            img.load()
        except Exception:
            return {"error": "Não consegui abrir essa imagem (use PNG, JPG ou WEBP)"}
        self.remove_custom(key)
        self.custom_dir.mkdir(parents=True, exist_ok=True)
        base = re.sub(r"[^a-zA-Z0-9_.-]", "_", key)[:120]
        dest = self.custom_dir / (base + ".png")

        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if "transparency" in img.info else "RGB")
        if img.height > 1200:
            img = img.resize((int(img.width * 1200 / img.height), 1200), Image.LANCZOS)
        img.save(dest, "PNG", optimize=True)
        self._names_t = 0.0
        return {"ok": True, "path": str(dest)}

    def remove_custom(self, key: str):
        p = self.custom_path(key)
        if p:
            p.unlink(missing_ok=True)
        self._names_t = 0.0

    def fetch_custom(self, key: str, url: str, kind: str = "cover", referer: str = "") -> dict:
        import io
        import tempfile
        from PIL import Image
        if not url.lower().startswith(("http://", "https://")):
            return {"error": "O link da imagem precisa começar com http"}
        from .websearch import HEADERS
        hdr = dict(HEADERS)
        if referer:
            hdr["Referer"] = referer
        data = b""
        for h in (hdr, {k: v for k, v in hdr.items() if k != "Referer"}, dict(hdr, Referer=url.split("/", 3)[0] + "//" + url.split("/", 3)[2] + "/")):
            try:
                r = self.s.get(url, headers=h, timeout=25, stream=True)
                if r.ok:
                    data = r.raw.read(25 * 1024 * 1024, decode_content=True)
                    if data:
                        break
            except Exception:
                data = b""
        if not data:
            return {"error": "Não consegui baixar essa imagem (o site não deixa). Escolha outra."}
        try:
            img = Image.open(io.BytesIO(data))
            img.load()
        except Exception:
            return {"error": "O link não aponta para uma imagem (PNG, JPG ou WEBP)"}
        if kind == "hero":
            self.custom_dir.mkdir(parents=True, exist_ok=True)
            dest = self.custom_dir / (re.sub(r"[^a-zA-Z0-9_.-]", "_", key)[:120] + "_hero.jpg")
            if img.mode != "RGB":
                img = img.convert("RGB")
            if img.width > 1920:
                img = img.resize((1920, int(img.height * 1920 / img.width)), Image.LANCZOS)
            img.save(dest, "JPEG", quality=88)
            return {"ok": True, "path": str(dest)}
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tf:
            img.save(tf, "PNG")
            tmp = tf.name
        try:
            return self.set_custom(key, tmp)
        finally:
            Path(tmp).unlink(missing_ok=True)

    def resolve(self, meta: dict, title: str, system: str = "pc", year: str = "") -> dict:
        q = re.sub(r"\(.*?\)|\[.*?\]", "", title).strip()
        system = system or "pc"
        if system == "pc":
            for fn in (self._steam, self._gog):
                if meta.get("cover_url"):
                    break
                try:
                    fn(meta, q, year)
                except Exception as e:
                    meta[fn.__name__.strip("_") + "_error"] = str(e)
        else:
            try:
                self._libretro(meta, q, system)
            except Exception as e:
                meta["libretro_error"] = str(e)
            if not meta.get("cover_url") and meta.get("grid"):
                meta["cover_url"], meta["cover_src"] = meta["grid"], "steamgriddb"
            if not meta.get("cover_url") and system in ("switch", "ps3", "x360", "wiiu", "ps4"):

                try:
                    self._steam(meta, q, year, min_score=0.9, text=False)
                except Exception:
                    pass
                if not meta.get("cover_url"):
                    try:
                        self._gog(meta, q, year, min_score=0.9, text=False)
                    except Exception:
                        pass
        return meta

    def _lang(self) -> str:
        return "brazilian" if "pt" in str(self.store.config.get("language") or "pt-BR").lower() else "english"

    def steam_by_appid(self, meta: dict, aid: str, text: bool = True):
        self._steam_fill(meta, str(aid), text)

    def _steam(self, meta: dict, q: str, year: str, min_score: float = 0.82, text: bool = True):
        r = self.s.get(STEAM_SEARCH, params={"term": q, "cc": "br", "l": self._lang()}, timeout=15)
        r.raise_for_status()
        items = (r.json() or {}).get("items") or []
        if not items:
            return
        nq = _norm(q)
        best, best_s = None, 0.0
        for it in items[:8]:
            s = _sim(nq, _norm(it.get("name", "")))
            if year and year in it.get("name", ""):
                s += 0.05
            if s > best_s:
                best, best_s = it, s
        if not best or best_s < min_score:
            return
        aid = best["id"]
        meta["steam_name"] = re.sub(r"[\u2122\u00ae]", "", best.get("name", "")).strip()
        meta["steam_score"] = round(best_s, 3)
        self._steam_fill(meta, aid, text)

    def _steam_fill(self, meta: dict, aid, text: bool):
        cdn = STEAM_CDN.format(aid=aid)
        for name in ("library_600x900_2x.jpg", "library_600x900.jpg"):
            h = self.s.head(cdn + name, timeout=10, allow_redirects=True)
            if h.ok:
                meta["cover_url"] = cdn + name
                meta["cover_src"] = "steam"
                break
        h = self.s.head(cdn + "library_hero.jpg", timeout=10, allow_redirects=True)
        if h.ok:
            meta["hero_url"] = cdn + "library_hero.jpg"
        meta["steam_appid"] = aid
        if not text:
            meta.setdefault("source", []).append("steam")
            return

        try:
            d = self.s.get(STEAM_DETAILS, params={"appids": aid, "l": self._lang(), "cc": "br", "filters": "basic,genres,developers,publishers,release_date,screenshots,pc_requirements"}, timeout=15).json()
            data = (d or {}).get(str(aid), {}).get("data") or {}
            if data:
                self._steam_extras_from(meta, data)
                if data.get("short_description") and (not meta.get("summary") or len(meta["summary"]) < 80):
                    meta["summary"] = re.sub(r"<[^>]+>", "", data["short_description"])
                if not meta.get("genres") and data.get("genres"):
                    meta["genres"] = [g["description"] for g in data["genres"]][:4]
                if not meta.get("developer") and data.get("developers"):
                    meta["developer"] = ", ".join(data["developers"][:2])
                if not meta.get("publisher") and data.get("publishers"):
                    meta["publisher"] = ", ".join(data["publishers"][:2])
                if not meta.get("year"):
                    m = re.search(r"(19|20)\d{2}", (data.get("release_date") or {}).get("date", ""))
                    if m:
                        meta["year"] = m.group(0)
        except Exception:
            pass
        meta.setdefault("source", []).append("steam")

    @staticmethod
    def _req_lines(html: str) -> list[str]:
        if not html:
            return []
        html = re.sub(r"<strong>\s*(M[ií]nimos?|Minimum|Recomendados?|Recommended)\s*:?\s*</strong>", "", html, flags=re.I)
        parts = re.split(r"<li>|<br\s*/?>", html)
        out = []
        for part in parts:
            t = re.sub(r"<[^>]+>", "", part)
            t = re.sub(r"\s+", " ", t).replace(" *:", ":").replace(" :", ":").strip(" :*\u00a0")
            if len(t) > 2 and t not in out:
                out.append(t[:200])
        return out[:12]

    def _steam_extras_from(self, meta: dict, data: dict):
        shots = [x.get("path_thumbnail") or x.get("path_full") for x in (data.get("screenshots") or []) if isinstance(x, dict)]
        shots = [x for x in shots if x][:3]
        if shots:
            meta["shots"] = shots
        pr = data.get("pc_requirements")
        if isinstance(pr, dict):
            reqs = {"min": self._req_lines(pr.get("minimum") or ""), "rec": self._req_lines(pr.get("recommended") or "")}
            if reqs["min"] or reqs["rec"]:
                meta["reqs"] = reqs

    def steam_extras(self, meta: dict, q: str, year: str = ""):
        aid = meta.get("steam_appid")
        if not aid:
            r = self.s.get(STEAM_SEARCH, params={"term": q, "cc": "br", "l": self._lang()}, timeout=15)
            r.raise_for_status()
            items = (r.json() or {}).get("items") or []
            nq = _norm(q)
            best, best_s = None, 0.0
            for it in items[:8]:
                sc = _sim(nq, _norm(it.get("name", "")))
                if year and year in it.get("name", ""):
                    sc += 0.05
                if sc > best_s:
                    best, best_s = it, sc
            if not best or best_s < 0.8:
                return
            aid = best["id"]
            meta["steam_appid"] = aid
            meta["steam_name"] = re.sub(r"[\u2122\u00ae]", "", best.get("name", "")).strip()
            meta["steam_score"] = round(best_s, 3)
        d = self.s.get(STEAM_DETAILS, params={"appids": aid, "l": self._lang(), "cc": "br", "filters": "screenshots,pc_requirements"}, timeout=15).json()
        data = (d or {}).get(str(aid), {}).get("data") or {}
        if data:
            self._steam_extras_from(meta, data)

    def _gog(self, meta: dict, q: str, year: str, min_score: float = 0.82, text: bool = True):
        r = self.s.get(GOG_CATALOG, params={"limit": 8, "query": "like:" + q, "productType": "in:game,pack", "order": "desc:score"}, timeout=15)
        r.raise_for_status()
        prods = (r.json() or {}).get("products") or []
        if not prods:
            return
        nq = _norm(q)
        best, best_s = None, 0.0
        for p in prods:
            s_ = _sim(nq, _norm(p.get("title", "")))
            if year and str(p.get("releaseDate", "")).startswith(year):
                s_ += 0.05
            if s_ > best_s:
                best, best_s = p, s_
        if not best or best_s < min_score:
            return
        meta["gog_id"] = best.get("id")
        meta["gog_name"] = re.sub(r"[\u2122\u00ae]", "", best.get("title", "")).strip()
        meta["gog_score"] = round(best_s, 3)
        if best.get("coverVertical"):
            meta["cover_url"], meta["cover_src"] = best["coverVertical"], "gog"
        if best.get("galaxyBackgroundImage") and not meta.get("hero_url"):
            meta["hero_url"] = best["galaxyBackgroundImage"]
        if best.get("storeLink"):
            meta["gog_url"] = best["storeLink"]
        if text:
            if not meta.get("developer") and best.get("developers"):
                meta["developer"] = ", ".join(best["developers"][:2])
            if not meta.get("publisher") and best.get("publishers"):
                meta["publisher"] = ", ".join(best["publishers"][:2])
            if not meta.get("genres") and best.get("genres"):
                meta["genres"] = [g.get("name", "") for g in best["genres"] if g.get("name")][:4]
            if not meta.get("year"):
                m = re.match(r"(19|20)\d{2}", str(best.get("releaseDate", "")))
                if m:
                    meta["year"] = m.group(0)
        meta.setdefault("source", []).append("gog")

    def _lr_list(self, sysname: str) -> list[tuple[str, str]]:
        with self._lr_lock:
            hit = self._lr_index.get(sysname)
            if hit and time.time() - hit[0] < 7 * 86400:
                return hit[1]
        cache = paths.CACHE_META / ("lr_" + re.sub(r"[^a-zA-Z0-9]", "_", sysname) + ".txt")
        names: list[str] = []
        if cache.exists() and time.time() - cache.stat().st_mtime < 7 * 86400:
            names = cache.read_text(encoding="utf-8").splitlines()
        else:
            r = self.s.get(LIBRETRO.format(sys=requests.utils.quote(sysname)), timeout=40)
            r.raise_for_status()
            names = [requests.utils.unquote(n) for n in re.findall(r'href="([^"]+\.png)"', r.text)]
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text("\n".join(names), encoding="utf-8")
        idx = [(_norm(n[:-4]), n) for n in names]
        with self._lr_lock:
            if len(self._lr_index) > 12:
                self._lr_index.clear()
            self._lr_index[sysname] = (time.time(), idx)
        return idx

    def _libretro(self, meta: dict, q: str, system: str, min_score: float = 0.86):
        main = LIBRETRO_SYS.get(system)
        if not main:
            return
        for sysname in (main,) + LIBRETRO_ALT.get(system, ()):
            self._libretro_one(meta, q, sysname, system, min_score)
            if meta.get("cover_url"):
                return

    def _libretro_one(self, meta: dict, q: str, sysname: str, system: str, min_score: float):
        idx = self._lr_list(sysname)
        if not idx:
            return
        nq = _norm(q)
        if not nq:
            return

        first = nq.split(" ")[0]
        cands = [(n, f) for n, f in idx if n.startswith(first)] or [(n, f) for n, f in idx if first in n]
        best, best_s = None, 0.0
        for n, f in cands[:600]:
            s = _sim(nq, n)
            fl = f.lower()
            if "(usa" in fl or "(world" in fl:
                s += 0.04
            elif "(europe" in fl:
                s += 0.02
            elif "(brazil" in fl:
                s += 0.03
            if "(demo" in fl or "(beta" in fl or "(proto" in fl:
                s -= 0.1
            if s > best_s:
                best, best_s = f, s
        if best and best_s >= min_score:
            meta["cover_url"] = LIBRETRO.format(sys=requests.utils.quote(sysname)) + requests.utils.quote(best)
            meta["cover_src"] = "libretro"
            meta["libretro_name"] = best[:-4]
            meta["libretro_sys"] = system
            meta["libretro_score"] = round(best_s, 3)
            meta.setdefault("source", []).append("libretro")

    def once(self, key: str) -> bool:
        with self._inflight_lock:
            if key in self._inflight:
                return False
            self._inflight.add(key)
            return True

    def inflight(self, prefix: str) -> int:
        with self._inflight_lock:
            return sum(1 for k in self._inflight if k.startswith(prefix))

    def busy(self, key: str) -> bool:
        with self._inflight_lock:
            return key in self._inflight

    def done(self, key: str):
        with self._inflight_lock:
            self._inflight.discard(key)
