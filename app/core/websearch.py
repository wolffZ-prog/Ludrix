from __future__ import annotations

import html
import json
import logging
import re
import unicodedata

import requests
from .hosts import Session

log = logging.getLogger("ludrix.websearch")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0.0.0 Safari/537.36")
HEADERS = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8"}
TIMEOUT = 9
IMG_EXT = re.compile(r"\.(?:jpe?g|png|webp)(?:$|[?#])", re.I)
STOP = {"the", "a", "an", "of", "and", "de", "do", "da", "o", "e", "edition", "remastered", "definitive", "goty", "hd"}

SYS_WORD = {"ps1": "ps1", "ps2": "ps2", "ps3": "ps3", "psp": "psp", "ps4": "ps4", "n64": "n64", "gc": "gamecube",
            "wii": "wii", "wiiu": "wii u", "gba": "gba", "snes": "snes", "nes": "nes", "nds": "nintendo ds", "3ds": "3ds",
            "genesis": "mega drive", "sms": "master system", "dc": "dreamcast", "saturn": "saturn", "xbox": "xbox",
            "x360": "xbox 360", "switch": "switch", "arcade": "arcade", "dos": "dos", "pce": "pc engine"}


MARKETPLACES = ("ebay.", "mercadolivre.", "mercadolibre.", "amazon.", "aliexpress.", "shopee.", "olx.", "enjoei.", "etsy.",
                "americanas.", "magazineluiza.", "magalu.", "casasbahia.", "submarino.", "kabum.", "walmart.", "bestbuy.", "gamestop.",
                "pricecharting.", "rakuten.", "wish.", "leboncoin.", "wallapop.", "vinted.", "tradera.", "allegro.", "cdiscount.", "fnac.",
                "carousell.", "facebook.com/marketplace", "pichau.", "terabyteshop.", "extra.com", "pontofrio.", "shoptime.", "zoom.com.br",
                "buscape.", "shopping.google", "lojasamericanas.", "ebay-kleinanzeigen.", "kleinanzeigen.", "gumtree.", "craigslist.")
PHYSICAL_RX = re.compile(r"\b(usado|usada|seminovo|seminova|lacrado|lacrada|m[ií]dia f[ií]sica|f[ií]sico|f[ií]sica|physical|sealed|used|"
                         r"pre-?owned|loose|cib|complete in box|manual|caixa|case only|disc only|s[oó] o disco|cartucho|cartridge|"
                         r"unboxing|photo|foto|frete|r\$|us\$|\$\s?\d|\d+\s?reais|comprar|compre|venda|vendo|à venda|for sale|buy|"
                         r"pre[çc]o|price|oferta|promo[çc][aã]o|desconto|parcel)\b", re.I)


def _is_product_photo(h: dict) -> bool:
    page = (h.get("page") or "").lower()
    url = (h.get("url") or "").lower()
    if any(m in page or m in url for m in MARKETPLACES):
        return True
    return bool(PHYSICAL_RX.search(h.get("title") or ""))


def _tokens(t: str) -> list[str]:
    t = unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode().lower()
    t = re.sub(r"\(.*?\)|\[.*?\]", " ", t)
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    return [w for w in t.split() if w not in STOP and len(w) > 1]


class WebImageSearch:
    def __init__(self, session: requests.Session | None = None):
        self.s = session or Session()

    def search(self, title: str, system: str = "pc", limit: int = 24, strict: bool = False) -> list[dict]:
        q = re.sub(r"\(.*?\)|\[.*?\]", "", title or "").strip()
        if not q:
            return []
        sysw = SYS_WORD.get(system or "pc", "")
        query = f"{q} {sysw} cover".strip() if sysw else f"{q} game cover"
        toks = _tokens(q)
        out: list[dict] = []
        seen: set[str] = set()
        for engine in (self._google, self._bing, self._yandex):
            try:
                hits = engine(query)
            except Exception as e:
                log.debug("websearch %s: %s", engine.__name__, e)
                hits = []
            good = 0
            for h in hits:
                u = h.get("url") or ""
                if not u.startswith("http") or u in seen:
                    continue
                if _is_product_photo(h):
                    continue
                if not self._relevant(h, toks, strict):
                    continue
                seen.add(u)
                out.append(h)
                good += 1
            if len(out) >= 8:
                break
        out.sort(key=self._score, reverse=True)
        return out[:limit]

    def search_wide(self, title: str, system: str = "pc", limit: int = 24) -> list[dict]:
        q = re.sub(r"\(.*?\)|\[.*?\]", "", title or "").strip()
        if not q:
            return []
        sysw = SYS_WORD.get(system or "pc", "")
        toks = _tokens(q)
        out: list[dict] = []
        seen: set[str] = set()
        for query in (f"{q} {sysw} wallpaper".strip(), f"{q} {sysw} screenshot".strip()):
            for engine in (self._google, self._bing, self._yandex):
                try:
                    hits = engine(query)
                except Exception as e:
                    log.debug("websearch %s: %s", engine.__name__, e)
                    hits = []
                for h in hits:
                    u = h.get("url") or ""
                    w, hh = h.get("w") or 0, h.get("h") or 0
                    if not u.startswith("http") or u in seen or not w or not hh:
                        continue
                    if not (1.3 <= w / hh <= 2.6) or w < 800:
                        continue
                    if _is_product_photo(h) or not self._relevant(h, toks, False):
                        continue
                    seen.add(u)
                    out.append(h)
                if len(out) >= limit:
                    break
            if len(out) >= 8:
                break
        out.sort(key=lambda h: (h.get("w") or 0) * (h.get("h") or 0), reverse=True)
        return out[:limit]

    def best_cover(self, title: str, system: str = "pc") -> dict | None:
        for h in self.search(title, system, limit=12, strict=True):
            w, hh = h.get("w") or 0, h.get("h") or 0
            if w and hh and 1.15 <= hh / w <= 1.75 and hh >= 300:
                return h
        return None

    def screenshots(self, title: str, system: str = "pc", limit: int = 3) -> list[str]:
        q = re.sub(r"\(.*?\)|\[.*?\]", "", title or "").strip()
        if not q:
            return []
        sysw = SYS_WORD.get(system or "pc", "")
        query = f"{q} {sysw} gameplay screenshot".strip() if sysw else f"{q} pc gameplay screenshot"
        toks = _tokens(q)
        out: list[str] = []
        hosts: set[str] = set()
        for engine in (self._bing, self._google, self._yandex):
            try:
                hits = engine(query)
            except Exception as e:
                log.debug("websearch %s: %s", engine.__name__, e)
                hits = []
            for h in hits:
                u = h.get("url") or ""
                w, hh = h.get("w") or 0, h.get("h") or 0
                if not u.startswith("http") or u in out or not w or not hh:
                    continue
                if not (1.3 <= w / hh <= 2.4) or w < 600:
                    continue
                if not self._relevant(h, toks, True):
                    continue
                t = (h.get("title") or "").lower()
                if re.search(r"wallpaper|fan ?art|meme|t-shirt|poster|logo|cover|box ?art|trailer|thumbnail", t):
                    continue
                host = re.sub(r"^https?://(www\.)?", "", u).split("/")[0]
                if host in hosts:
                    continue
                hosts.add(host)
                out.append(u)
                if len(out) >= limit:
                    return out
        return out

    @staticmethod
    def _relevant(h: dict, toks: list[str], strict: bool = False) -> bool:
        if not toks:
            return True

        words = {w.rstrip("s") for w in _tokens(f"{h.get('title', '')} {h.get('page', '')} {h.get('url', '')}")}
        hit = sum(1 for t in toks if t.rstrip("s") in words)
        h["rel"] = hit / len(toks)
        if strict:

            need = len(toks) if len(toks) <= 2 else -(-len(toks) * 3 // 5)
            musts = [toks[0]] + [t for t in toks if t.isdigit() or t in ("two", "three", "ii", "iii", "iv")]
            return hit >= need and all(t.rstrip("s") in words for t in musts)
        need = len(toks) if len(toks) <= 2 else max(2, int(len(toks) * 0.6 + 0.5))
        return hit >= need

    @staticmethod
    def _score(h: dict) -> float:
        w, hh = h.get("w") or 0, h.get("h") or 0
        s = 3.0 * h.get("rel", 0)
        if w and hh:
            r = hh / w
            s += 3.0 if 1.25 <= r <= 1.6 else (1.5 if 1.1 <= r <= 1.8 else -1.0)
            s += min(hh, 1600) / 800
        t = (h.get("title") or "").lower()
        if re.search(r"\b(cover|box ?art|boxart|capa|jaquette|caratula|packaging)\b", t):
            s += 1.0
        if re.search(r"wallpaper|fan ?art|screenshot|meme|t-shirt|poster|gif", t):
            s -= 1.5
        return s

    def _google(self, query: str) -> list[dict]:
        r = self.s.get("https://www.google.com/search", headers=HEADERS, timeout=TIMEOUT,
                       params={"q": query, "tbm": "isch", "asearch": "isch", "async": "_fmt:json,p:1,ijn:0", "hl": "en"})
        if not r.ok:
            return []
        txt = r.text
        i = txt.find("{")
        data = json.loads(txt[i:]) if i >= 0 else {}
        out = []
        for m in (data.get("ischj") or {}).get("metadata") or []:
            oi = m.get("original_image") or {}
            res = m.get("result") or {}
            th = m.get("thumbnail") or {}
            if not oi.get("url"):
                continue
            title = res.get("page_title") or ""
            try:
                title = title.encode("latin-1", "ignore").decode("unicode_escape").encode("latin-1", "ignore").decode("utf-8", "ignore")
            except Exception:
                pass
            out.append({"url": oi["url"], "thumb": th.get("url") or oi["url"], "w": oi.get("width") or 0, "h": oi.get("height") or 0,
                        "title": title, "page": res.get("referrer_url") or "", "engine": "google"})
        return out

    def _bing(self, query: str) -> list[dict]:
        r = self.s.get("https://www.bing.com/images/async", headers=HEADERS, timeout=TIMEOUT,
                       params={"q": query, "first": 0, "count": 35, "mmasync": 1, "adlt": "strict"})
        if not r.ok:
            return []
        out = []
        for raw in re.findall(r'm="(\{[^"]*\})"', r.text):
            try:
                d = json.loads(html.unescape(raw))
            except Exception:
                continue
            if not d.get("murl"):
                continue
            out.append({"url": d["murl"], "thumb": d.get("turl") or d["murl"], "w": 0, "h": 0,
                        "title": d.get("t") or "", "page": d.get("purl") or "", "engine": "bing"})

        sizes = re.findall(r'class="nowrap">(\d+)\s*(?:&#215;|×|x)\s*(\d+)<', r.text)
        for h, wh in zip(out, sizes):
            h["w"], h["h"] = int(wh[0]), int(wh[1])
        return out

    def _yandex(self, query: str) -> list[dict]:
        r = self.s.get("https://yandex.com/images/search", headers=HEADERS, timeout=TIMEOUT,
                       params={"text": query, "iorient": "vertical"})
        if not r.ok:
            return []
        t = html.unescape(r.text)
        out = []
        for m in re.finditer(r'"origUrl":"(https?://[^"]+)"', t):
            seg = t[max(0, m.start() - 1500):m.end() + 900]

            def g(k, s=seg):
                mm = re.search(r'"%s":"?([^",}]*)' % k, s)
                return mm.group(1) if mm else ""
            url = m.group(1).replace("\\/", "/")
            thumb = g("image")
            if thumb.startswith("//"):
                thumb = "https:" + thumb
            try:
                w, h = int(g("origWidth") or 0), int(g("origHeight") or 0)
            except ValueError:
                w = h = 0
            out.append({"url": url, "thumb": thumb or url, "w": w, "h": h, "title": g("alt"), "page": g("domain"), "engine": "yandex"})
        seen: set[str] = set()
        uniq = []
        for h in out:
            if h["url"] in seen:
                continue
            seen.add(h["url"])
            uniq.append(h)
        return uniq
