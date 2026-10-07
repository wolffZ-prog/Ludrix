from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path

import requests

from . import paths
from .titles import normalize_title, canonical_ok, canonical_confident, similarity

WIKI_API = "https://en.wikipedia.org/w/api.php"
WIKI_API_PT = "https://pt.wikipedia.org/w/api.php"
SGDB = "https://www.steamgriddb.com/api/v2"
PCGW_API = "https://www.pcgamingwiki.com/w/api.php"
PCGW_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LudrixHub", "Accept": "application/json", "Accept-Language": "en-US,en;q=0.9"}
REQ_PT = {"OS": "SO", "Processor": "Processador", "Memory": "Memória", "Graphics": "Placa de vídeo", "Storage": "Armazenamento", "Hard Drive": "Espaço em disco", "Sound Card": "Placa de som", "Sound": "Som", "Additional Notes": "Observações", "Network": "Rede", "Video Card": "Placa de vídeo"}
PCGW_LABELS = {"OS": "SO", "CPU": "Processador", "RAM": "Memória", "HD": "Espaço em disco", "GPU": "Placa de vídeo", "VRAM": "Memória de vídeo", "DX": "DirectX", "audio": "Som", "other": "Outros", "notes": "Observação"}


SYS_WIKI = {
    "ps1": "PlayStation", "ps2": "PlayStation 2", "ps3": "PlayStation 3", "psp": "PlayStation Portable", "n64": "Nintendo 64",
    "gc": "GameCube", "wii": "Wii", "wiiu": "Wii U", "switch": "Nintendo Switch", "gba": "Game Boy Advance", "snes": "Super Nintendo",
    "nes": "Nintendo Entertainment System", "nds": "Nintendo DS", "3ds": "Nintendo 3DS", "genesis": "Sega Genesis", "sms": "Master System",
    "dc": "Dreamcast", "saturn": "Sega Saturn", "xbox": "Xbox", "x360": "Xbox 360", "pce": "TurboGrafx-16", "atari2600": "Atari 2600",
    "arcade": "arcade", "dos": "MS-DOS", "pc": "Windows",
}

SYS_YEARS = {
    "atari2600": (1977, 1992), "nes": (1983, 1995), "sms": (1985, 1997), "pce": (1987, 1999), "genesis": (1988, 1998), "snes": (1990, 2000),
    "arcade": (1975, 2015), "dos": (1981, 2001), "saturn": (1994, 2000), "ps1": (1994, 2006), "n64": (1996, 2002), "dc": (1998, 2002),
    "gba": (2001, 2008), "ps2": (2000, 2013), "gc": (2001, 2007), "xbox": (2001, 2008), "nds": (2004, 2013), "psp": (2004, 2014),
    "x360": (2005, 2016), "ps3": (2006, 2017), "wii": (2006, 2013), "3ds": (2011, 2020), "wiiu": (2012, 2017), "switch": (2017, 2035),
}
SYS_ALIASES = {
    "ps1": ("playstation", "ps1", "psx", "ps one"), "ps2": ("playstation 2", "ps2"), "ps3": ("playstation 3", "ps3"), "psp": ("playstation portable", "psp"),
    "n64": ("nintendo 64", "n64"), "gc": ("gamecube",), "wii": ("wii",), "wiiu": ("wii u",), "switch": ("nintendo switch", "switch"),
    "gba": ("game boy advance", "gba"), "snes": ("super nintendo", "super nes", "snes", "super famicom"), "nes": ("nintendo entertainment system", "nes", "famicom"),
    "nds": ("nintendo ds",), "3ds": ("nintendo 3ds", "3ds"), "genesis": ("genesis", "mega drive"), "sms": ("master system", "game gear"),
    "dc": ("dreamcast",), "saturn": ("saturn",), "xbox": ("xbox",), "x360": ("xbox 360",), "pce": ("turbografx", "pc engine"),
    "atari2600": ("atari 2600", "2600"), "arcade": ("arcade",), "dos": ("ms-dos", "dos"), "pc": ("windows", "microsoft windows", "pc", "ms-dos", "linux", "macos", "mac os"),
}


def platform_matches(system: str, platforms: list[str]) -> bool | None:
    if not platforms:
        return None
    al = SYS_ALIASES.get(system) or (system,)
    pl = " | ".join(p.lower() for p in platforms)
    if system == "xbox":
        return bool(re.search(r"\bxbox\b(?!\s*(360|one|series))", pl))
    if system == "wii":
        return bool(re.search(r"\bwii\b(?!\s*u)", pl))
    if system == "ps1":
        return bool(re.search(r"\bplaystation\b(?!\s*[2-5])", pl)) or "ps1" in pl or "psx" in pl
    return any(a in pl for a in al)

GENRE_PT = {
    "sports": "Esportes", "racing": "Corrida", "first-person shooter": "FPS", "third-person shooter": "Tiro em 3ª pessoa",
    "shooter": "Tiro", "action-adventure": "Ação/Aventura", "action": "Ação", "adventure": "Aventura",
    "platform": "Plataforma", "fighting": "Luta", "role-playing": "RPG", "strategy": "Estratégia",
    "real-time strategy": "Estratégia (RTS)", "simulation": "Simulação", "stealth": "Furtividade", "survival horror": "Terror",
    "horror": "Terror", "puzzle": "Puzzle", "beat 'em up": "Beat 'em up", "hack and slash": "Hack and slash",
    "open world": "Mundo aberto", "party": "Party", "music": "Música", "rhythm": "Ritmo", "vehicular combat": "Combate veicular",
    "tactical": "Tático", "business simulation": "Simulação", "construction and management simulation": "Simulação",
    "life simulation": "Simulação de vida", "graphic adventure": "Aventura gráfica", "point-and-click": "Point-and-click",
    "interactive drama": "Drama interativo", "kart racing": "Corrida (kart)", "sim racing": "Corrida (simulação)",
    "arcade": "Arcade", "wrestling": "Luta livre", "skateboarding": "Skate", "football": "Futebol", "association football": "Futebol",
    "american football": "Futebol americano", "basketball": "Basquete", "baseball": "Beisebol", "god game": "God game",
    "tower defense": "Tower defense", "run and gun": "Run and gun", "light gun shooter": "Tiro (pistola de luz)",
    "space combat": "Combate espacial", "flight simulation": "Simulação de voo", "combat flight simulation": "Simulação de voo",
    "mmorpg": "MMORPG", "roguelike": "Roguelike", "metroidvania": "Metroidvania", "survival": "Sobrevivência",
}


def _clean_title(t: str) -> str:
    t = re.sub(r"\(.*?\)|\[.*?\]", "", t)
    t = re.sub(r"\b(repack|reupload|rohankar'?s?|complete|gold|ultimate|goty|game of the year|definitive|remastered|steam deck|"
               r"anniversary|edition|collection|the video game|recompiled|recomp|enhanced|classic|signature|special|directors? cut)\b", "", t, flags=re.I)
    t = re.sub(r"[-:–—]\s*$", "", t.strip())
    return re.sub(r"\s{2,}", " ", t).strip(" -:")


def _strip_wiki(v: str) -> list[str]:
    v = re.sub(r"<!--.*?-->", "", v, flags=re.S)
    v = re.sub(r"<ref[^>]*>.*?</ref>|<ref[^>]*/>", "", v, flags=re.S)

    for _ in range(6):
        v2 = re.sub(r"\{\{\s*(cite|citation|sfn|efn|refn|r|cn|citation needed|clarify|when|dubious|which)\b[^{}]*\}\}", "", v, flags=re.I | re.S)
        v2 = re.sub(r"\{\{[^{}|]*\|([^{}]*)\}\}", r"|\1", v2, flags=re.S)
        v2 = re.sub(r"\{\{[^{}|]*\}\}", "", v2, flags=re.S)
        if v2 == v:
            break
        v = v2
    v = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r"\1", v)
    v = re.sub(r"<[^>]+>", "|", v)
    v = v.replace("\'\'\'", "").replace("\'\'", "")
    parts = [p.strip(" *#{}") for p in re.split(r"[|,\n]", v)]
    out = []
    for p in parts:
        if not p or len(p) >= 60 or re.match(r"^(infobox|video game|template)\b", p, re.I):
            continue
        if re.match(r"^(title|expand|frame_style|list_style|hlist|bullets|style|class)\s*=", p, re.I):
            p = p.split("=", 1)[1].strip()
        if not p or "=" in p or p.lower() in ("infobox", "collapsible list", "nobold", "nowrap", "small", "ubl", "plainlist", "unbulleted list", "flatlist", "hlist", "cslist", "vgrelease", "video game release", "start date", "yes", "no", "true"):
            continue
        out.append(p)
    return out


def _infobox(wikitext: str) -> dict:
    out = {}
    for key in ("genre", "developer", "publisher", "released", "modes", "platforms", "series", "engine"):
        pat = r"platforms?" if key == "platforms" else key + r"s?"
        m = re.search(r"^\s*\|\s*" + pat + r"\s*=\s*(.+?)(?=^\s*\|\s*\w+\s*=|^\s*\}\})", wikitext, re.M | re.S)
        if m:
            out[key] = _strip_wiki(m.group(1))
    m = re.search(r"^\s*\|\s*released?\s*=(.*?)(?=^\s*\|\s*[a-z_ ]+=|^\s*\}\})", wikitext, re.M | re.S | re.I)
    if m:
        years = re.findall(r"\b(19[89]\d|20[0-3]\d)\b", m.group(1))
        out["year"] = min(years) if years else ""
    return out


def _translate_genres(gs: list[str]) -> list[str]:
    out = []
    for g in gs:
        gl = g.lower().replace(" game", "").replace(" video", "").strip()
        for k, v in GENRE_PT.items():
            if k == gl or k in gl:
                if v not in out:
                    out.append(v)
                break
        else:
            if len(out) < 4 and gl and gl not in out:
                out.append(g.strip().title())
    return out[:4]


class MetadataService:
    WIKI_MIN_GAP = 0.25

    def __init__(self, session: requests.Session, store):
        self.s = session
        self.store = store
        self._wiki_lock = threading.Lock()
        self._wiki_last = 0.0
        self.covers = None
        self.web = None
        self._mem: dict[str, tuple[float, dict | None]] = {}
        self._mem_lock = threading.Lock()
        self._names: dict[str, float] = {}
        self._names_t = 0.0

    def fname(self, key: str) -> str:
        return re.sub(r"[^a-zA-Z0-9_.-]", "_", key)[:120] + ".json"

    def path(self, key: str) -> Path:
        return paths.CACHE_META / self.fname(key)

    def _listing(self) -> dict[str, float]:
        now = time.time()
        if now - self._names_t > 2.0:
            d = {}
            try:
                with os.scandir(paths.CACHE_META) as it:
                    for de in it:
                        try:
                            d[de.name] = de.stat().st_mtime
                        except OSError:
                            pass
            except OSError:
                pass
            self._names, self._names_t = d, now
        return self._names

    def touch(self):
        self._names_t = 0.0

    def mtime(self, key: str) -> float:
        return self._listing().get(self.fname(key)) or 0.0

    def get(self, key: str) -> dict | None:
        mtime = self._listing().get(self.fname(key))
        if mtime is None:
            return None
        p = self.path(key)
        with self._mem_lock:
            hit = self._mem.get(key)
            if hit and hit[0] == mtime:
                return hit[1]
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            data = None
        with self._mem_lock:
            if len(self._mem) > 3000:
                self._mem.clear()
            self._mem[key] = (mtime, data)
        return data

    def clear(self, key: str):
        self.path(key).unlink(missing_ok=True)
        with self._mem_lock:
            self._mem.pop(key, None)

    USER_FIELDS = ("developer", "publisher", "year", "genres", "summary", "series", "modes", "links", "notes",
                   "cover_url", "cover_src", "hero_url", "background_file", "platforms")

    def fetch(self, key: str, title: str, year: str = "", system: str = "pc", force=False, steam_appid: str = "") -> dict:
        if not force:
            cached = self.get(key)
            if cached:
                return cached
        system = system or "pc"
        prev = self.get(key) or {}
        meta = {"key": key, "fetched_at": time.time(), "source": [], "system": system, "query_title": title}
        clean = normalize_title(title)
        q = _clean_title(clean) or clean
        meta["query"] = q

        sgdb_key = (self.store.config.get("sgdb_key") or "").strip()
        wmeta: dict = {"source": [], "system": system}
        jobs = []
        if steam_appid and self.covers:
            jobs.append(("steam_error", lambda: self.covers.steam_by_appid(meta, steam_appid)))
        if self.covers:
            jobs.append(("cover_error", lambda: self.covers.resolve(meta, q, system, year)))
        jobs.append(("wiki_error", lambda: self._wikipedia(wmeta, q, year, system)))
        if sgdb_key:
            jobs.append(("sgdb_error", lambda: self._sgdb(meta, q, sgdb_key)))
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=len(jobs)) as ex:
            for (errk, _), fut in [(j, ex.submit(j[1])) for j in jobs]:
                try:
                    fut.result()
                except Exception as e:
                    meta[errk] = str(e)
        if meta.get("grid") and system == "pc" and meta.get("cover_src") not in ("steam", "gog"):
            meta["cover_url"], meta["cover_src"] = meta["grid"], "steamgriddb"
        if wmeta.get("wiki_title"):
            for k, v in wmeta.items():
                if k in ("source", "system"):
                    continue
                if not meta.get(k):
                    meta[k] = v
            meta["source"].append("wikipedia")
        if wmeta.get("wiki_rejected"):
            meta["wiki_rejected"] = wmeta["wiki_rejected"]
        if "pt" in (self.store.config.get("language") or "pt-BR").lower():
            try:
                self._wiki_pt_summary(meta)
            except Exception:
                pass
        if not meta.get("cover_url") and self.web and self.store.config.get("web_covers", True):

            try:
                hit = self.web.best_cover(q, system)
            except Exception as e:
                hit = None
                meta["web_error"] = str(e)
            if hit:
                meta["cover_url"], meta["cover_src"] = hit["url"], "web"
                meta["web_page"] = hit.get("page", "")
                meta.setdefault("source", []).append("web")
        if not meta.get("cover_url") and meta.get("wiki_image"):
            meta["cover_url"], meta["cover_src"] = meta["wiki_image"], "wikipedia"
        if system == "pc" and self.covers and not meta.get("shots"):
            try:
                self.covers.steam_extras(meta, q, year)
            except Exception as e:
                meta["extras_error"] = str(e)
        if system == "pc" and not meta.get("steam_appid") and meta.get("wikidata"):
            try:
                self._wikidata_ids(meta)
            except Exception as e:
                meta["wikidata_error"] = str(e)
        if system == "pc" and (not meta.get("reqs") or not meta.get("shots")):
            try:
                self._pcgw(meta, q, year)
            except Exception as e:
                meta["pcgw_error"] = str(e)
        if system == "pc" and self.covers and not meta.get("shots") and meta.get("steam_appid") and not meta.get("steam_name"):
            try:
                self.covers.steam_extras(meta, q, year)
            except Exception as e:
                meta["extras_error"] = str(e)
        if system == "pc" and meta.get("steam_appid") and (not meta.get("shots") or not meta.get("reqs")):
            try:
                self._steam_archive(meta, str(meta["steam_appid"]))
            except Exception as e:
                meta["archive_error"] = str(e)
        if not meta.get("shots") and self.web and self.store.config.get("web_covers", True):
            try:
                shots = self.web.screenshots(q, system)
            except Exception as e:
                shots = []
                meta["web_shots_error"] = str(e)
            if shots:
                meta["shots"], meta["shots_src"] = shots, "web"
        self._pick_canonical(meta, clean, system)

        for k in ("background_file", "imported", "edited_at"):
            if prev.get(k):
                meta[k] = prev[k]
        for k in ("summary", "developer", "genres", "year", "publisher", "shots", "reqs"):
            if not meta.get(k) and prev.get(k):
                meta[k] = prev[k]

        latest = self.get(key) or prev
        for k in ("edited_at", "copied_from"):
            if latest.get(k):
                meta[k] = latest[k]
        self._apply_user(meta, latest.get("user"))
        self._write(key, meta)
        return meta

    def _write(self, key: str, meta: dict):
        self.path(key).parent.mkdir(parents=True, exist_ok=True)
        self.path(key).write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
        with self._mem_lock:
            self._mem.pop(key, None)
        self.touch()

    @staticmethod
    def _apply_user(meta: dict, user: dict | None):
        if not user:
            meta.pop("user", None)
            return
        meta["user"] = user
        for k, v in user.items():
            if v not in (None, "", []):
                meta[k] = v

    def set_user(self, key: str, fields: dict, system: str = "pc") -> dict:
        meta = self.get(key) or {"key": key, "fetched_at": time.time(), "source": ["manual"], "system": system, "query_title": ""}
        user = dict(meta.get("user") or {})
        for k, v in fields.items():
            if k not in self.USER_FIELDS:
                continue
            if v in (None, "", []):
                user.pop(k, None)
            else:
                user[k] = v

        base = {k: v for k, v in meta.items() if k != "user"}
        for k in self.USER_FIELDS:
            if k in (meta.get("user") or {}) and k not in user:
                base.pop(k, None)
        meta = base
        meta["edited_at"] = time.time()
        self._apply_user(meta, user)
        self._write(key, meta)
        return meta

    def copy_from(self, key: str, src_key: str, system: str = "pc") -> dict | None:
        src = self.get(src_key)
        if not src:
            return None
        keep = self.get(key) or {}
        meta = {k: v for k, v in src.items() if k not in ("key", "user")}
        meta.update({"key": key, "system": system, "fetched_at": time.time(), "copied_from": src_key, "edited_at": time.time()})
        meta.setdefault("source", []).append("copy")
        self._apply_user(meta, keep.get("user"))
        self._write(key, meta)
        return meta

    SOURCES = ("steam", "gog", "wikipedia", "steamgriddb", "libretro", "web")

    def probe(self, source: str, title: str, system: str = "pc", year: str = "") -> dict:
        system = system or "pc"
        clean = normalize_title(title)
        q = _clean_title(clean) or clean
        meta = {"source": [], "system": system, "query": q}
        if source == "wikipedia":
            self._wikipedia(meta, q, year, system)
            if meta.get("wiki_title") and "pt" in (self.store.config.get("language") or "pt-BR").lower():
                try:
                    self._wiki_pt_summary(meta)
                except Exception:
                    pass
            if meta.get("wiki_image"):
                meta["cover_url"], meta["cover_src"] = meta["wiki_image"], "wikipedia"
        elif source == "steam" and self.covers:
            self.covers._steam(meta, q, year, min_score=0.6)
        elif source == "gog" and self.covers:
            self.covers._gog(meta, q, year, min_score=0.6)
        elif source == "steamgriddb":
            sgdb_key = (self.store.config.get("sgdb_key") or "").strip()
            if not sgdb_key:
                return {"error": "Informe a chave do SteamGridDB em Ajustes → Biblioteca"}
            self._sgdb(meta, q, sgdb_key)
            if meta.get("grid"):
                meta["cover_url"], meta["cover_src"] = meta["grid"], "steamgriddb"
        elif source == "libretro" and self.covers:
            self.covers._libretro(meta, q, system if system != "pc" else "xbox", min_score=0.7)
        elif source == "web" and self.web:
            hit = self.web.best_cover(q, system)
            if hit:
                meta["cover_url"], meta["cover_src"] = hit["url"], "web"
                meta["web_page"] = hit.get("page", "")
                meta["source"].append("web")
        else:
            return {"error": "Fonte desconhecida"}
        if not meta.get("source"):
            return {"error": "Nada encontrado nessa fonte com esse nome"}
        self._pick_canonical(meta, clean, system)
        return {k: v for k, v in meta.items() if v not in (None, "", [])}

    @staticmethod
    def _pick_canonical(meta: dict, clean: str, system: str):
        cands: list[tuple[float, int, str]] = []

        order = {"wiki_title": 0, "steam_name": 1, "gog_name": 2, "sgdb_name": 3, "libretro_name": 4}
        if system == "pc":
            order.pop("libretro_name")
        for field, pri in order.items():
            v = meta.get(field) or ""
            if field == "libretro_name":
                v = re.sub(r"\s*[\(\[].*?[\)\]]", "", v).strip()
                v = re.sub(r"^(.+?), (The|A|An)$", r"\2 \1", v)
                v = re.sub(r"^(.+?), (The|A|An) - ", r"\2 \1 - ", v)
            if not v or not canonical_ok(clean, v):
                continue
            cands.append((round(similarity(clean, v), 2), -pri, v))
        if not cands:
            return
        cands.sort(reverse=True)
        best = cands[0][2].strip()
        meta["canonical_title"] = best
        meta["canonical_confident"] = canonical_confident(clean, best)
        meta["title_candidates"] = [c[2] for c in cands][:5]

    def _wget(self, url: str, **kw) -> requests.Response:
        for attempt in (0, 1):
            with self._wiki_lock:
                wait = self.WIKI_MIN_GAP - (time.time() - self._wiki_last)
                if wait > 0:
                    time.sleep(wait)
                self._wiki_last = time.time()
            r = self.s.get(url, timeout=20, **kw)
            if r.status_code == 429 and attempt == 0:
                time.sleep(float(r.headers.get("Retry-After") or 3))
                continue
            return r
        return r

    WIKI_PROPS = {"action": "query", "generator": "search", "gsrlimit": 6, "gsrprop": "snippet",
                  "prop": "pageimages|extracts|revisions|info|pageprops", "ppprop": "wikibase_item", "exintro": 1, "explaintext": 1, "exlimit": "max",
                  "piprop": "original", "pilicense": "any", "rvprop": "content", "rvslots": "main", "rvsection": 0,
                  "inprop": "url", "format": "json", "formatversion": 2}

    def _wikidata_ids(self, meta: dict):
        qid = meta.get("wikidata")
        r = self.s.get(f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json", headers={"User-Agent": PCGW_HEADERS["User-Agent"]}, timeout=12)
        r.raise_for_status()
        claims = ((r.json().get("entities") or {}).get(qid) or {}).get("claims") or {}

        def first(prop):
            for c in claims.get(prop) or []:
                v = (c.get("mainsnak") or {}).get("datavalue", {}).get("value")
                if isinstance(v, str) and v.strip():
                    return v.strip()
            return ""
        aid = first("P1733")
        if aid and aid.isdigit():
            meta["steam_appid"] = aid
        gog = first("P2725")
        if gog and not meta.get("gog_id"):
            meta["gog_id"] = gog
        pcgw = first("P6337")
        if pcgw:
            meta["pcgw_page"] = pcgw.replace("_", " ")

    def _steam_archive(self, meta: dict, aid: str):
        r = self.s.get("https://archive.org/wayback/available", params={"url": f"store.steampowered.com/app/{aid}"}, timeout=15)
        r.raise_for_status()
        snap = ((r.json().get("archived_snapshots") or {}).get("closest") or {})
        url = snap.get("url")
        if not url or str(snap.get("status", "200")) != "200":
            return
        url = re.sub(r"/web/(\d+)/", r"/web/\1id_/", url, count=1)
        h = self.s.get(url, timeout=40).text
        if not meta.get("shots"):
            ids = []
            for m in re.finditer(r"/steam/apps/" + aid + r"/(ss_[0-9a-f]+)\.", h):
                if m.group(1) not in ids:
                    ids.append(m.group(1))
            if ids:
                meta["shots"] = [f"https://cdn.cloudflare.steamstatic.com/steam/apps/{aid}/{i}.600x338.jpg" for i in ids[:3]]
                meta["shots_src"] = "steam"
        if not meta.get("reqs") and self.covers:
            i = h.find('data-os="win"')
            if i < 0:
                i = h.find("game_area_sys_req")
            if i < 0:
                return
            blk = h[i:i + 12000]
            cols = {}
            for col in ("leftCol", "rightCol", "full"):
                m = re.search(r'game_area_sys_req_' + col + r'">(.*?)</div>', blk, flags=re.S)
                if m:
                    cols[col] = m.group(1)
            mn = cols.get("leftCol") or cols.get("full") or ""
            rc = cols.get("rightCol") or ""
            reqs = {"min": self._req_pt(self.covers._req_lines(mn)), "rec": self._req_pt(self.covers._req_lines(rc))}
            if reqs["min"] or reqs["rec"]:
                meta["reqs"] = reqs
                meta["reqs_src"] = "steam"
                meta.setdefault("source", []).append("steam")

    def _req_pt(self, lines: list[str]) -> list[str]:
        if "pt" not in (self.store.config.get("language") or "pt-BR").lower():
            return lines
        out = []
        for ln in lines:
            i = ln.find(":")
            if 0 < i < 30 and ln[:i].strip() in REQ_PT:
                ln = REQ_PT[ln[:i].strip()] + ln[i:]
            out.append(ln)
        return out

    def _pcgw(self, meta: dict, q: str, year: str = ""):
        best = meta.get("pcgw_page") or ""
        if not best:
            r = self.s.get(PCGW_API, params={"action": "opensearch", "search": q, "limit": 6, "format": "json"}, headers=PCGW_HEADERS, timeout=12)
            r.raise_for_status()
            titles = (r.json() or [None, []])[1] or []
            from .titles import _cmp
            qc = _cmp(q)
            best_s = 0.0
            for t in titles:
                sc = similarity(qc, _cmp(t))
                if year and year in t:
                    sc += 0.05
                if sc > best_s:
                    best, best_s = t, sc
            if not best or best_s < 0.82:
                return
        self._pcgw_page(meta, best)

    def _pcgw_page(self, meta: dict, best: str):
        r = self.s.get(PCGW_API, params={"action": "parse", "page": best, "prop": "wikitext", "format": "json", "redirects": 1}, headers=PCGW_HEADERS, timeout=15)
        r.raise_for_status()
        wt = (((r.json() or {}).get("parse") or {}).get("wikitext") or {}).get("*") or ""
        if not wt:
            return
        meta["pcgw_page"] = best
        m = re.search(r"\|steam appid\s*=\s*(\d+)", wt)
        if m and not meta.get("steam_appid"):
            meta["steam_appid"] = m.group(1)
        if meta.get("reqs"):
            return
        m = re.search(r"\{\{System requirements(.*?)\n\}\}", wt, flags=re.S)
        if not m:
            return
        fields = {}
        for k, v in re.findall(r"\|\s*(\w+)\s*=\s*([^\n|]*)", m.group(1)):
            v = re.sub(r"\{\{[^}]*\}\}|\[\[|\]\]|<[^>]+>", "", v).strip()
            if v:
                fields[k] = v
        reqs = {}
        for pre, key in (("min", "min"), ("rec", "rec")):
            lines = []
            for fk, label in PCGW_LABELS.items():
                vals = [fields.get(f"{pre}{fk}{n}") for n in ("", "2", "3", "4")]
                vals = [v for v in vals if v]
                if vals:
                    val = " / ".join(vals)
                    if fk == "OS" and not re.match(r"(?i)windows|mac|linux", val):
                        val = "Windows " + val
                    lines.append(f"{label}: {val[:200]}")
            reqs[key] = lines[:12]
        if reqs.get("min") or reqs.get("rec"):
            meta["reqs"] = reqs
            meta["reqs_src"] = "pcgamingwiki"
            meta.setdefault("source", []).append("pcgamingwiki")

    def _wiki_search(self, terms: str) -> list[dict]:
        r = self._wget(WIKI_API, params={**self.WIKI_PROPS, "gsrsearch": terms})
        r.raise_for_status()
        pages = ((r.json().get("query") or {}).get("pages") or [])
        return sorted(pages, key=lambda p: p.get("index", 99))

    def _wikipedia(self, meta: dict, q: str, year: str, system: str = "pc"):
        plat = SYS_WIKI.get(system, "")
        hits = self._wiki_search(f"{q} {plat} video game" if system != "pc" else f"{q} video game")
        if not hits and system != "pc":
            hits = self._wiki_search(f"{q} video game")
        if not hits:
            return
        from .titles import _cmp
        qc = _cmp(q)
        lo, hi = SYS_YEARS.get(system, (0, 9999))

        def base(t: str) -> str:
            return re.sub(r"\s*\((\d{4} )?(video game|game|series)\)$", "", t, flags=re.I)

        def score(h):
            t = h["title"]
            bc = _cmp(base(t))
            s = similarity(qc, bc) * 10
            if bc == qc:
                s += 10
            elif bc and (bc in qc or qc in bc):
                s += 10 * min(len(bc), len(qc)) / max(len(bc), len(qc))
            tl = t.lower()
            if "series" in tl or "list of" in tl or "franchise" in tl or "(film)" in tl or "soundtrack" in tl or "collections" in tl:
                s -= 20

            if re.search(r"\b(is|was) an? (\w+ ){0,3}(series|franchise|media franchise|film|novel|character)\b", (h.get("extract") or "")[:240], re.I):
                s -= 15
            m = re.search(r"\((\d{4}) video game\)", tl)
            if m:
                y = int(m.group(1))
                if not (lo <= y <= hi):
                    s -= 8
                if year and str(y) == year:
                    s += 3
            if year and year in h.get("snippet", ""):
                s += 1
            if plat and plat.lower() in (h.get("snippet", "") or "").lower():
                s += 1.5
            return -s
        ranked = sorted(hits, key=score)
        unknown = None
        for best in ranked[:4]:
            page = best["title"]
            if not canonical_ok(q, base(page), 0.5):
                continue
            tmp: dict = {}
            box = self._wiki_page(tmp, best, base(page))
            ok = platform_matches(system, box.get("platforms", []))
            if ok is False:
                meta.setdefault("wiki_rejected", []).append(page)
                continue
            if ok is None:
                if unknown is None:
                    unknown = tmp
                continue
            meta.update(tmp)
            meta["source"].append("wikipedia")
            return
        if unknown is not None:
            meta.update(unknown)
            meta["source"].append("wikipedia")

    def _wiki_pt_summary(self, meta: dict):
        title = meta.get("wiki_title")
        if not title:
            return
        pt_title = ""
        try:
            r = self._wget(WIKI_API, params={"action": "query", "titles": title, "prop": "langlinks", "lllang": "pt",
                                             "format": "json", "formatversion": 2})
            pages = (r.json().get("query") or {}).get("pages") or []
            ll = (pages[0].get("langlinks") or []) if pages else []
            pt_title = ll[0].get("title", "") if ll else ""
        except Exception:
            pass
        params = {"action": "query", "prop": "extracts", "exintro": 1, "explaintext": 1, "format": "json", "formatversion": 2}
        if pt_title:
            params["titles"] = pt_title
        else:
            params.update({"generator": "search", "gsrlimit": 1, "gsrsearch": f"{title} jogo eletrônico"})
        r = self._wget(WIKI_API_PT, params=params)
        pages = (r.json().get("query") or {}).get("pages") or []
        if not pages:
            return
        ext = (pages[0].get("extract") or "").strip()
        if not pt_title:
            if not canonical_ok(title, pages[0].get("title", ""), 0.6):
                return
        if len(ext) > 80:
            meta["summary_en"] = meta.get("summary", "")
            meta["summary"] = ext
            meta["summary_lang"] = "pt"

    def _wiki_page(self, meta: dict, page: dict, title: str) -> dict:
        for k in ("summary", "wiki_url", "wiki_image", "genres", "developer", "publisher", "modes", "platforms", "series", "year"):
            meta.pop(k, None)
        meta["wiki_title"] = title
        meta["wikidata"] = (page.get("pageprops") or {}).get("wikibase_item") or ""
        meta["summary"] = (page.get("extract") or "").strip()
        meta["wiki_url"] = page.get("fullurl") or page.get("canonicalurl") or ""
        img = (page.get("original") or {}).get("source")
        if img:
            meta["wiki_image"] = img.split("?")[0]
        box = {}
        try:
            txt = page["revisions"][0]["slots"]["main"]["content"]
            box = _infobox(txt)
            meta["genres"] = _translate_genres(box.get("genre", []))
            meta["developer"] = ", ".join(box.get("developer", [])[:2])
            meta["publisher"] = ", ".join(box.get("publisher", [])[:2])
            meta["modes"] = ", ".join(box.get("modes", [])[:3])
            meta["platforms"] = box.get("platforms", [])[:12]
            meta["series"] = ", ".join(box.get("series", [])[:1])
            if box.get("year"):
                meta["year"] = box["year"]
        except (KeyError, IndexError, TypeError):
            pass
        return box

    def _sgdb(self, meta: dict, q: str, key: str):
        h = {"Authorization": f"Bearer {key}"}
        r = self.s.get(f"{SGDB}/search/autocomplete/{requests.utils.quote(q)}", headers=h, timeout=20)
        r.raise_for_status()
        data = r.json().get("data") or []
        if not data:
            return
        gid = data[0]["id"]
        meta["sgdb_id"] = gid
        meta["sgdb_name"] = data[0]["name"]
        def one(kind, params, field):
            rr = self.s.get(f"{SGDB}/{kind}/game/{gid}", headers=h, params=params, timeout=20)
            items = (rr.json().get("data") or []) if rr.ok else []
            if items:
                meta[field] = items[0]["url"]
                meta[field + "_thumb"] = items[0].get("thumb", items[0]["url"])
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=3) as ex:
            list(ex.map(lambda a: one(*a), (
                ("grids", {"dimensions": "600x900", "types": "static", "nsfw": "false"}, "grid"),
                ("heroes", {"types": "static", "nsfw": "false"}, "hero"),
                ("logos", {"types": "static", "nsfw": "false"}, "logo"))))
        meta["source"].append("steamgriddb")
