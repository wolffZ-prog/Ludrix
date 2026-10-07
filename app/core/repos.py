from __future__ import annotations

import html
import json
import logging
import re
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from urllib.parse import quote, unquote

import requests
from .hosts import Session

from . import paths

log = logging.getLogger("ludrix.repos")

UA = {"User-Agent": "Ludrix/1.0"}
CATALOG_TTL = 12 * 3600
FILES_TTL = 7 * 24 * 3600
ROM_EXT = r"chd|iso|cue|bin|img|pbp|cso|gcz|gz|z64|n64|v64|nds|gba|gb|gbc|sfc|smc|nes|md|gen|smd|gcm|rvz|wbfs|wad|gdi|cdi|xiso|xex|zar|wua|wud|wux|rpx|nsp|xci|3ds|cci|sms|gg|pce|a26|sfc"
ROM_FILE_RE = re.compile(r"\.(" + ROM_EXT + r"|7z|zip|rar|tar)$", re.I)

SYSTEM_HINTS = [
    ("ps2", r"\bps2\b|playstation ?2"), ("ps3", r"\bps3\b|playstation ?3"), ("psp", r"\bpsp\b"),
    ("ps1", r"\bpsx\b|\bps1\b|playstation(?! ?[23])|\bpsone\b"), ("dc", r"dreamcast|\bdc\b(?!o)"), ("gc", r"gamecube|\bgcn?\b"),
    ("wiiu", r"wii ?u"), ("wii", r"\bwii\b(?!ware)"), ("x360", r"xbox ?360|\bx360\b"), ("xbox", r"\bxbox\b"), ("switch", r"switch|\bnsw\b"),
    ("3ds", r"\b3ds\b"), ("nds", r"\bnds\b|nintendo ds"), ("gba", r"\bgba\b|game ?boy"), ("n64", r"\bn64\b|nintendo 64"),
    ("snes", r"\bsnes\b|super nintendo|super famicom"), ("nes", r"\bnes\b|famicom"), ("saturn", r"saturn"),
    ("genesis", r"mega ?drive|genesis|\bmd\b"), ("sms", r"master system|game ?gear"), ("pce", r"pc ?engine|turbografx"),
    ("atari2600", r"atari ?2600"), ("arcade", r"mame|fbneo|arcade|naomi|model ?[23]|atomiswave|hbmame"), ("dos", r"ms-?dos|dosbox"),
    ("pc", r"windows|\bpc\b|teknoparrot"),
]


def guess_system(*texts: str) -> str:
    t = " ".join(x or "" for x in texts).lower()
    for sid, pat in SYSTEM_HINTS:
        if re.search(pat, t):
            return sid
    return ""


EXT_SYSTEM = {"nds": "nds", "gba": "gba", "gb": "gba", "gbc": "gba", "z64": "n64", "n64": "n64", "v64": "n64", "sfc": "snes", "smc": "snes", "nes": "nes",
              "md": "genesis", "gen": "genesis", "smd": "genesis", "rvz": "gc", "gcm": "gc", "gcz": "gc", "ciso": "gc", "wbfs": "wii", "wad": "wii",
              "cso": "psp", "pbp": "psp", "cdi": "dc", "gdi": "dc", "xiso": "xbox", "xex": "x360", "zar": "x360", "nsp": "switch", "xci": "switch", "nro": "switch",
              "3ds": "3ds", "cci": "3ds", "cxi": "3ds", "wua": "wiiu", "wud": "wiiu", "wux": "wiiu", "rpx": "wiiu", "sms": "sms", "gg": "sms", "pce": "pce", "a26": "atari2600"}


def ext_system(*names: str) -> str:
    for n in names:
        ext = (n or "").rsplit("/", 1)[-1].rsplit(".", 1)[-1].lower()
        if ext in EXT_SYSTEM:
            return EXT_SYSTEM[ext]
    return ""


ARCHIVE_RE = re.compile(r"\.(7z|zip|rar|tar|chd|iso|bin|cue|z64|n64|v64|nds|gba|gb|gbc|sfc|smc|nes|md|gen|smd|gcm|rvz|wbfs|pbp|cso|xci|nsp|exe)(\.\d{3})?$", re.I)
IMAGE_RE = re.compile(r"\.(jpe?g|png|webp)$", re.I)


@dataclass
class FileRef:
    name: str
    url: str
    size: int = 0

    @property
    def basename(self) -> str:
        return self.name.rsplit("/", 1)[-1]


@dataclass
class Entry:
    key: str
    repo: str
    id: str
    title: str
    kind: str = "pc"
    system: str = "pc"
    creator: str = ""
    year: str = ""
    size: int = 0
    description: str = ""
    cover: str = ""
    thumb: str = ""
    genres: list = field(default_factory=list)
    tags: list = field(default_factory=list)
    page_url: str = ""
    magnet: str = ""
    torrent_url: str = ""
    files: list = field(default_factory=list)
    files_loaded: bool = False
    extra: dict = field(default_factory=dict)


def _first(v):
    if isinstance(v, list):
        return v[0] if v else ""
    return v or ""


def clean_html(text: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", text or "", flags=re.I)
    text = re.sub(r"</p>", "\n\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


class _Cache:
    def __init__(self, session: requests.Session):
        self.s = session

    def get_json(self, key: str, url: str, ttl: int, params=None):
        p = paths.CACHE_WEB / (re.sub(r"[^a-zA-Z0-9_.-]", "_", key)[:150] + ".json")
        if p.exists() and time.time() - p.stat().st_mtime < ttl:
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                pass
        r = self.s.get(url, params=params, timeout=30)
        r.raise_for_status()
        data = r.json()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data), encoding="utf-8")
        return data

    def _path(self, key: str) -> Path:
        return paths.CACHE_WEB / (re.sub(r"[^a-zA-Z0-9_.-]", "_", key)[:150] + ".json")

    def get_local(self, key: str, ttl: int):
        p = self._path(key)
        if p.exists() and time.time() - p.stat().st_mtime < ttl:
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                return None
        return None

    def put_local(self, key: str, data):
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data), encoding="utf-8")


class Provider:
    def __init__(self, cfg: dict, session: requests.Session, cache: _Cache):
        self.cfg = cfg
        self.id = cfg["id"]
        self.name = cfg.get("name", self.id)
        self.kind = cfg.get("kind", "pc")
        self.system = cfg.get("system", "pc")
        self.s = session
        self.cache = cache

    def catalog(self, force=False) -> list[Entry]:
        raise NotImplementedError

    def files(self, entry: Entry) -> list[FileRef]:
        return [FileRef(**f) for f in entry.files]

    def thumb_url(self, entry: Entry) -> str:
        return entry.thumb or entry.cover


def _excluder(cfg: dict):
    ids = {str(x).lower() for x in (cfg.get("exclude") or []) if x}
    pat = cfg.get("exclude_re")
    try:
        rx = re.compile(pat, re.I) if pat else None
    except re.error:
        rx = None
    return lambda *vals: any(v and (v.lower() in ids or (rx and rx.search(v))) for v in vals)


class ArchiveProvider(Provider):
    SEARCH = "https://archive.org/advancedsearch.php"
    META = "https://archive.org/metadata/{id}"

    def _query(self) -> str:
        if self.cfg["type"] == "archive_uploader":
            return f"uploader:({self.cfg['uploader']}) AND mediatype:(software)"
        if self.cfg["type"] == "archive_creator":
            return f'creator:("{self.cfg["creator"]}")'
        return self.cfg["query"]

    def catalog(self, force=False) -> list[Entry]:
        params = {"q": self._query(), "fl[]": ["identifier", "title", "creator", "year", "item_size",
                                               "description", "subject"], "rows": 3000, "output": "json"}
        key = f"catalog_{self.id}"
        if force:
            (paths.CACHE_WEB / f"{key}.json").unlink(missing_ok=True)
        data = self.cache.get_json(key, self.SEARCH, CATALOG_TTL, params)
        skip = _excluder(self.cfg)
        out = []
        for d in data["response"]["docs"]:
            ident = d["identifier"]
            subj = d.get("subject") or []
            if isinstance(subj, str):
                subj = [s.strip() for s in subj.split(";")]
            if skip(ident, _first(d.get("title"))):
                continue
            out.append(Entry(
                key=f"{self.id}:{ident}", repo=self.id, id=ident,
                title=_first(d.get("title")) or ident, kind=self.kind, system=self.system,
                creator=_first(d.get("creator")), year=str(_first(d.get("year")) or ""),
                size=int(d.get("item_size") or 0), description=clean_html(_first(d.get("description"))),
                cover=f"https://archive.org/services/img/{ident}",
                thumb=f"https://archive.org/services/img/{ident}",
                tags=[s for s in subj if s and s.lower() != "video games"][:8],
                page_url=f"https://archive.org/details/{ident}",
                torrent_url=f"https://archive.org/download/{ident}/{ident}_archive.torrent" if self.cfg.get("torrent") else "",
            ))
        out.sort(key=lambda e: e.title.lower())
        return out

    def files(self, entry: Entry) -> list[FileRef]:
        if entry.files_loaded:
            return [FileRef(**f) for f in entry.files]
        data = self.cache.get_json(f"files_{entry.id}", self.META.format(id=entry.id), FILES_TTL)
        arcs, covers = [], []
        for f in data.get("files", []):
            if f.get("source") != "original":
                continue
            n = f["name"]
            low = n.lower()
            if ARCHIVE_RE.search(low):
                arcs.append(FileRef(n, f"https://archive.org/download/{entry.id}/{quote(n)}", int(f.get("size") or 0)))
            elif IMAGE_RE.search(low) and not low.startswith("__ia_thumb"):
                covers.append(f"https://archive.org/download/{entry.id}/{quote(n)}")
        arcs.sort(key=lambda a: a.name)
        entry.files = [asdict(a) for a in arcs]
        entry.files_loaded = True
        if covers:
            entry.cover = covers[0]
        return arcs


ROM_TITLE_RE = re.compile(r"\s*[\(\[].*?[\)\]]")


class ArchiveItemProvider(Provider):
    META = "https://archive.org/metadata/{id}"

    def _identifiers(self) -> list[str]:
        ids = self.cfg.get("identifiers") or [self.cfg.get("identifier")]
        return [i for i in ids if i]

    def catalog(self, force=False) -> list[Entry]:
        out = []
        for ident in self._identifiers():
            try:
                out += self._one(ident, force)
            except Exception as e:
                if len(self._identifiers()) == 1:
                    raise
                log.warning("archive item %s: %s", ident, e)
        out.sort(key=lambda e: e.title.lower())
        return out

    def _one(self, ident: str, force: bool) -> list[Entry]:
        key = f"item_{ident}"
        if force:
            (paths.CACHE_WEB / f"{key}.json").unlink(missing_ok=True)
        data = self.cache.get_json(key, self.META.format(id=ident), FILES_TTL)
        md = data.get("metadata", {})
        files = [f for f in data.get("files", []) if f.get("source") == "original"]
        names = {f["name"].lower() for f in files}
        is_pc = self.kind == "pc" or self.system == "pc"
        folder = str(self.cfg.get("folder") or "").strip("/")
        skip = _excluder(self.cfg)
        groups: dict[str, Entry] = {}
        out = []
        for f in files:
            n = f["name"]
            low = n.lower()
            if folder and not low.startswith(folder.lower() + "/"):
                continue
            if not ROM_FILE_RE.search(low) or "/capa" in low or low.startswith("capa") or "cover" in low:
                continue
            if low.endswith(".bin") and low[:-4] + ".cue" in names:
                continue
            if re.search(r"\.\d{3}$", low) and not low.endswith(".001"):
                continue
            base = n.rsplit("/", 1)[-1]
            if skip(base, n):
                continue
            stem = re.sub(r"\.(" + ROM_EXT + r"|7z|zip|rar|tar)(\.001)?$", "", base, flags=re.I)
            stem = re.sub(r"\.(dos|win|pc|nkit|dec)$", "", stem, flags=re.I)
            disc = re.search(r"\s*\((?:disc|disk|cd)\s*\d+\)", stem, flags=re.I)
            gstem = (stem[:disc.start()] + stem[disc.end():]).strip() if disc else stem
            title = (self.cfg.get("rename") or {}).get(base) or ROM_TITLE_RE.sub("", gstem).replace("_", " ").strip() or gstem
            fid = re.sub(r"[^a-zA-Z0-9]+", "-", gstem)[:80]
            size = int(f.get("size") or 0)
            ref = asdict(FileRef(n, f"https://archive.org/download/{ident}/{quote(n)}", size))
            if disc and fid in groups:
                g = groups[fid]
                g.files.append(ref)
                g.files.sort(key=lambda x: x["name"])
                g.size += size
                continue
            e = Entry(
                key=f"{self.id}:{fid}", repo=self.id, id=fid, title=title, kind="pc" if is_pc else "rom", system="pc" if is_pc else self.system,
                creator=_first(md.get("creator")), size=size, page_url=f"https://archive.org/details/{ident}",
                tags=[t for t in re.findall(r"\(([^)]+)\)", gstem)][:4],
                files=[ref], files_loaded=True,
                extra={"rom_file": base, "item": ident},
            )
            if disc:
                groups[fid] = e
            out.append(e)
        return out


def browse_archive(session: requests.Session, q: str, rows: int = 60) -> list[dict]:
    q = q.strip()
    if not q:
        return []
    if re.match(r"https?://", q):
        m = re.search(r"query=([^&]+)", q)
        q = unquote(m.group(1)) if m else q
        m2 = re.search(r"/details/([^/?#]+)", q)
        if m2:
            q = f"identifier:({m2.group(1)})"
    if "@" in q and ":" not in q:
        q = f"uploader:({q})"
    elif ":" not in q:
        q = f'({q}) OR creator:("{q}") OR uploader:({q})'
    if "mediatype" not in q:
        q = f"({q}) AND mediatype:(software)"
    r = session.get("https://archive.org/advancedsearch.php", params={
        "q": q, "fl[]": ["identifier", "title", "creator", "uploader", "item_size", "files_count", "subject", "downloads"],
        "rows": rows, "sort[]": "downloads desc", "output": "json"}, timeout=30)
    r.raise_for_status()
    out = []
    for d in r.json()["response"]["docs"]:
        subj = d.get("subject") or []
        subj = "; ".join(subj) if isinstance(subj, list) else str(subj)
        title = _first(d.get("title")) or d["identifier"]
        fc = int(d.get("files_count") or 0)
        size = int(d.get("item_size") or 0)
        sysid = guess_system(title, subj, d["identifier"])

        pack = fc >= 8 and size / max(fc, 1) > 4_000_000
        out.append({"identifier": d["identifier"], "title": title, "creator": _first(d.get("creator")),
                    "uploader": _first(d.get("uploader")), "size": size, "files": fc, "subject": subj[:120],
                    "downloads": int(d.get("downloads") or 0), "system": sysid or ("pc" if not pack else ""),
                    "suggest": "archive_item" if pack else "archive_game"})
    return out


def resolve_archive_user(session: requests.Session, handle: str) -> dict | None:
    handle = handle.lstrip("@").strip("/")
    if not handle:
        return None
    try:
        r = session.get("https://archive.org/services/search/beta/page_production/",
                        params={"user_query": "", "page_type": "account_details", "page_target": "@" + handle, "hits_per_page": 10,
                                "page": 1, "sort": "downloads:desc", "page_elements": '["uploads"]'}, timeout=25)
        up = r.json()["response"]["body"]["page_elements"]["uploads"]["hits"]
        hits = [h["fields"] for h in up.get("hits", [])]
        total = int(up.get("total") or 0)
    except Exception:
        return None
    if not hits:
        return None
    email = ""
    for h in hits[:3]:
        try:
            md = session.get(f"https://archive.org/metadata/{h['identifier']}/metadata", timeout=20).json().get("result") or {}
            email = md.get("uploader") or ""
            if email:
                break
        except Exception:
            continue
    if not email:
        return None
    return {"uploader": email, "screenname": handle, "total": total, "sample": [h.get("title") or h["identifier"] for h in hits[:5]]}


def pack_results(data, src: str) -> dict:
    if not isinstance(data, dict):
        return {"kind": "none", "results": []}
    fallback = src.rstrip("/").split("/")[-1].split("?")[0].replace(".json", "")
    name = str(data.get("name") or fallback)
    results = []
    kinds = set()
    for cfg in data.get("sources") or []:
        if not isinstance(cfg, dict) or cfg.get("type") not in PROVIDERS or cfg.get("type") in ("manifest", "local_folder"):
            continue
        c = {k: v for k, v in cfg.items() if isinstance(k, str)}
        c.setdefault("name", name)
        c.setdefault("kind", data.get("kind", "pc"))
        c.setdefault("system", data.get("system", "pc" if c["kind"] != "rom" else ""))
        kinds.add(c["kind"])
        results.append({"title": c["name"], "detail": str(c.get("note") or c["type"]), "kind": c["kind"],
                        "count_pc": 0, "count_rom": 0, "cfg": c})
    n = 0
    fmt = ""
    if isinstance(data.get("downloads"), list):
        n, fmt = len(data["downloads"]), "hydra"
    elif isinstance(data.get("games"), list):
        n, fmt = len(data["games"]), "manifest"
    if n:
        kind = str(data.get("kind") or "pc")
        kinds.add(kind)
        roms = sum(1 for g in data["games"] if isinstance(g, dict) and g.get("kind", kind) == "rom") if fmt == "manifest" else (n if kind == "rom" else 0)
        results.insert(0, {"title": name, "detail": f"{n} jogo{'' if n == 1 else 's'} · lista {fmt}" + (f" · {n - roms} PC + {roms} ROMs" if 0 < roms < n else ""), "kind": kind, "count_pc": n - roms,
                           "count_rom": roms,
                           "cfg": {"type": "manifest", "url": src, "name": name, "kind": kind, "system": str(data.get("system") or ("pc" if kind != "rom" else ""))}})
    if not results:
        return {"kind": "none", "results": []}
    kind = "mixed" if len(kinds) > 1 else (kinds.pop() if kinds else "pc")
    return {"kind": kind, "results": results, "pack": name}


def detect_source(session: requests.Session, q: str, cache=None) -> dict:
    q = (q or "").strip()
    if not q:
        return {"kind": "none", "results": []}

    mt = re.match(r"^(\d{6,}:[A-Za-z0-9_-]{30,})\s*(.*)$", q)
    if mt:
        token, chat = mt.group(1), mt.group(2).strip()
        try:
            r = session.get(f"https://api.telegram.org/bot{token}/getMe", timeout=20).json()
        except Exception as e:
            return {"kind": "none", "results": [], "error": f"Não consegui falar com o Telegram: {e}"}
        if not r.get("ok"):
            return {"kind": "none", "results": [], "error": f"Token recusado pelo Telegram: {r.get('description', '')}"}
        bot = r["result"].get("username") or "bot"
        name = f"Telegram · {chat.lstrip('@') or bot}"
        return {"kind": "pc", "results": [{"title": name, "detail": f"bot @{bot} — lê os posts novos do canal com .torrent anexado (o bot precisa ser admin do canal)",
                                           "cfg": {"type": "telegram", "name": name, "token": token, "chat": chat, "kind": "pc", "system": "pc"}, "telegram": True}]}
    if re.match(r"^(https?://)?t\.me/", q, re.I):
        return {"kind": "none", "results": [], "error": "Para ler um canal do Telegram é preciso um bot: cole o TOKEN do bot (do @BotFather), um espaço e o link do canal. Ex.: 123456:ABC… https://t.me/+xxxx"}

    try:
        from .hosts import known_host
        hk = known_host(q)
    except Exception:
        hk = ""
    if hk:
        return {"kind": "none", "results": [], "link": q, "host": hk}

    if re.search(r"\.json(\?|$)", q, re.I) or (not re.match(r"https?://", q) and Path(q).suffix.lower() == ".json"):
        try:
            if re.match(r"https?://", q):
                data = session.get(q, timeout=30, headers={"Accept": "application/json"}).json()
            else:
                data = json.loads(Path(q).read_text(encoding="utf-8-sig"))
        except Exception as e:
            msg = str(e)
            if "403" in msg or "Cloudflare" in msg:
                msg = "O site bloqueia apps (Cloudflare). Salve o .json pelo navegador e cole o caminho do arquivo."
            return {"kind": "none", "results": [], "error": f"Não consegui ler esse JSON: {msg}"}
        return pack_results(data, q)

    if not re.match(r"https?://", q) and (re.match(r"^[a-zA-Z]:[\\/]", q) or q.startswith(("/", "\\\\"))) and Path(q).is_dir():
        folder = Path(q)
        roms, pcs, systems = 0, 0, {}
        for f in folder.rglob("*"):
            if not f.is_file():
                continue
            ext = f.suffix.lower().lstrip(".")
            if re.fullmatch(ROM_EXT, ext):
                roms += 1
                sid = guess_system(f.parent.name, f.name)
                if sid:
                    systems[sid] = systems.get(sid, 0) + 1
            elif ext == "exe":
                pcs += 1
        if not roms and not pcs:
            return {"kind": "none", "results": []}
        sid = max(systems, key=systems.get) if systems else ""
        kind = "rom" if roms >= pcs else "pc"
        return {"kind": kind, "results": [{"title": folder.name, "detail": f"{roms} ROMs · {pcs} executáveis", "kind": kind, "count_pc": pcs, "count_rom": roms, "system": sid,
                                           "cfg": {"type": "local_folder", "path": str(folder), "name": folder.name, "kind": kind, "system": sid}}]}

    m = re.match(r"^(?:https?://github\.com/)?([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/?$", q)
    if m and "archive.org" not in q and ("github.com" in q or "/" in q and " " not in q):
        repo = f"{m.group(1)}/{m.group(2)}"
        try:
            rels = session.get(f"https://api.github.com/repos/{repo}/releases?per_page=3", timeout=20).json()
        except Exception:
            rels = []
        if isinstance(rels, list) and rels:
            assets = [a for r in rels for a in r.get("assets", [])]
            win = [a for a in assets if re.search(r"win|x64|\.zip$|\.7z$|\.exe$", a["name"], re.I)]
            if win:
                return {"kind": "pc", "results": [{"title": repo, "detail": f"{len(rels)} releases · {len(win)} arquivos Windows", "kind": "pc", "count_pc": 1, "count_rom": 0,
                                                   "cfg": {"type": "github_release", "name": m.group(2), "kind": "recomp", "items": [{"repo": repo, "title": m.group(2), "asset": "Windows", "kind": "recomp"}]}}]}
        return {"kind": "none", "results": []}

    if re.match(r"https?://", q, re.I) and "archive.org" not in q:
        try:
            a = analyze_page(session, q)
        except Exception as e:
            return {"kind": "none", "results": [], "error": f"Não consegui abrir a página: {e}"}
        n = len(a["games"])
        if not n:
            return {"kind": "none", "results": [], "page": a, "error": "" if not a["hard_count"] else
                    f"A página tem {a['hard_count']} link(s) só de hosts de acesso difícil (captcha, login ou fila) — nada que o Ludrix baixe sozinho."}
        name = _host(q).replace("www.", "")
        title_m = None
        try:
            rr = session.get(q, timeout=15)
            if "charset" not in rr.headers.get("Content-Type", "").lower():
                rr.encoding = rr.apparent_encoding
            title_m = re.search(r"<title[^>]*>(.*?)</title>", rr.text[:200000], re.I | re.S)
        except Exception:
            pass
        if title_m:
            name = clean_html(title_m.group(1))[:60] or name
        kinds = [guess_system(g["title"]) for g in a["games"]]
        roms = sum(1 for k in kinds if k and k != "pc")
        kind = "rom" if roms > n / 2 else "pc"
        return {"kind": kind, "page": {k: a[k] for k in ("direct", "torrent", "hard_count", "pages")}, "games": a["games"][:200],
                "results": [{"title": name, "detail": f"{n} jogos · {a['direct']} links diretos · {a['torrent']} torrents · {a['hard_count']} ignorados (acesso difícil)",
                             "kind": kind, "count_pc": n - roms, "count_rom": roms, "site": False,
                             "cfg": {"type": "webpage", "url": q, "name": name, "kind": kind}}]}

    m = re.search(r"archive\.org/details/@([A-Za-z0-9_.-]+)", q) or re.fullmatch(r"@([A-Za-z0-9_.-]+)", q)
    if m:
        u = resolve_archive_user(session, m.group(1))
        if not u:
            return {"kind": "none", "results": [], "error": f"Nenhum upload no perfil @{m.group(1)} do archive.org."}
        return {"kind": "pc", "results": [{"title": f"Tudo de @{u['screenname']}", "detail": f"{u['total']} itens no archive.org · ex.: {', '.join(u['sample'][:3])}",
                                           "kind": "pc", "count_pc": u["total"], "count_rom": 0, "group": True,
                                           "cfg": {"type": "archive_uploader", "uploader": u["uploader"], "name": u["screenname"], "kind": "pc"}}]}

    try:
        items = browse_archive(session, q, rows=40)
    except Exception as e:
        return {"kind": "none", "results": [], "error": str(e)}
    results = []

    single = re.search(r"/details/([^/?#]+)", q)
    if single and items:
        items = [x for x in items if x["identifier"] == single.group(1)] or items[:1]
    items = items[:24]
    need = [it["identifier"] for it in items if it["suggest"] == "archive_item" or (single and len(items) == 1)]
    inspected = {}
    if need:

        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=8) as ex:
            for ident, res in zip(need, ex.map(lambda i: _inspect_item(session, i, cache), need)):
                inspected[ident] = res
    for it in items:
        r = {"title": it["title"], "identifier": it["identifier"], "creator": it.get("creator") or it.get("uploader") or "", "size": it["size"], "files": it["files"]}
        if it["identifier"] in inspected:
            counts = inspected[it["identifier"]]
            if not counts:
                continue
            r.update(counts)
            if counts["count_rom"] == 0 and counts["count_pc"] == 0:
                continue
            kind = "rom" if counts["count_rom"] >= counts["count_pc"] else "pc"
            sid = counts.get("system") or it.get("system") or ""
            r["kind"], r["system"] = kind, (sid if kind == "rom" else "pc")
            r["detail"] = f"{counts['count_rom']} ROMs · {counts['count_pc']} arquivos de PC · {_human(it['size'])}"
            if counts["count_rom"] + counts["count_pc"] == 1:
                r["cfg"] = {"type": "archive_search", "query": f"identifier:({it['identifier']})", "name": it["title"], "kind": kind, "system": r["system"]}
            else:
                r["cfg"] = {"type": "archive_item", "identifier": it["identifier"], "name": it["title"], "kind": kind, "system": r["system"]}
        else:
            sid = it.get("system") or ""
            kind = "rom" if sid and sid != "pc" else "pc"
            r.update({"kind": kind, "system": sid or "pc", "count_pc": 1 if kind == "pc" else 0, "count_rom": 1 if kind == "rom" else 0,
                      "detail": f"1 jogo · {it['files']} arquivos · {_human(it['size'])}",
                      "cfg": {"type": "archive_search", "query": f"identifier:({it['identifier']})", "name": it["title"], "kind": kind, "system": sid or "pc"}})
        results.append(r)
    if not results:
        return {"kind": "none", "results": []}

    creators = {}
    for it in items:
        c = it.get("creator") or it.get("uploader")
        if c:
            creators[c] = creators.get(c, 0) + 1
    group = None
    if re.fullmatch(r"[^\s@]+@[^\s@]+\.[a-z]+", q, re.I):
        creators = {q: max(len(items), 4)}
    if creators:
        top, cnt = max(creators.items(), key=lambda kv: kv[1])
        if cnt >= 4:
            n_rom = sum(1 for r in results if r["kind"] == "rom")
            n_pc = len(results) - n_rom
            kind = "rom" if n_rom > n_pc else "pc"
            typ = "archive_uploader" if "@" in top else "archive_creator"
            group = {"title": f"Tudo de \"{top}\"", "detail": f"{cnt}+ itens nessa busca · {n_pc} PC · {n_rom} ROM", "kind": kind, "count_pc": n_pc, "count_rom": n_rom, "group": True,
                     "cfg": {"type": typ, ("uploader" if typ == "archive_uploader" else "creator"): top, "name": top.split("@")[0], "kind": kind}}
    n_rom = sum(1 for r in results if r["kind"] == "rom")
    kind = "rom" if n_rom == len(results) else ("pc" if n_rom == 0 else "mixed")
    return {"kind": kind, "results": ([group] if group else []) + results}


def _human(n: int) -> str:
    n = float(n or 0)
    for u in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.0f} {u}" if u == "B" else f"{n:.1f} {u}"
        n /= 1024
    return f"{n:.1f} PB"


def _inspect_item(session: requests.Session, identifier: str, cache=None) -> dict | None:
    try:
        if cache:
            md = cache.get_json(f"ia_meta_{identifier}", f"https://archive.org/metadata/{identifier}", FILES_TTL)
        else:
            md = session.get(f"https://archive.org/metadata/{identifier}", timeout=30).json()
    except Exception:
        return None
    files = md.get("files") or []
    rom, pc, systems = 0, 0, {}
    meta = md.get("metadata") or {}
    title = _first(meta.get("title")) or identifier
    subj = meta.get("subject") or ""
    subj = " ".join(subj) if isinstance(subj, list) else str(subj)
    item_sys = guess_system(title, identifier, subj)
    for f in files:
        name = f.get("name", "")
        if f.get("source") == "metadata" or name.startswith("__ia") or f.get("format") in ("Metadata", "Item Tile", "Archive BitTorrent"):
            continue
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        size = int(f.get("size") or 0)
        if re.fullmatch(ROM_EXT, ext) and size > 200_000:
            rom += 1
            sid = guess_system(name, title, identifier)
            if sid:
                systems[sid] = systems.get(sid, 0) + 1
        elif ext in ("7z", "zip", "rar", "exe", "001") and size > 5_000_000:

            sid = guess_system(name) or (item_sys if item_sys != "pc" else "")
            if sid and sid != "pc":
                rom += 1
                systems[sid] = systems.get(sid, 0) + 1
            else:
                pc += 1
    sid = max(systems, key=systems.get) if systems else (guess_system(title, identifier) or "")
    return {"count_rom": rom, "count_pc": pc, "system": sid}


class GithubProvider(Provider):
    API = "https://api.github.com/repos/{repo}/releases?per_page=5"

    def catalog(self, force=False) -> list[Entry]:

        items = self.cfg.get("items") or [self.cfg]
        out = []
        for it in items:
            repo = it["repo"]
            ident = repo.replace("/", "__")
            out.append(Entry(
                key=f"{self.id}:{ident}", repo=self.id, id=ident, title=it.get("title") or repo.split("/")[1],
                kind=it.get("kind", self.kind), system=it.get("system", self.system),
                creator=it.get("creator") or repo.split("/")[0], year=str(it.get("year", "")),
                description=it.get("description", ""), cover=it.get("cover", ""), thumb=it.get("cover", ""),
                genres=it.get("genres", []), tags=it.get("tags", []), page_url=f"https://github.com/{repo}",
                extra={"repo": repo, "asset": it.get("asset", r"win.*x64|x64.*win|windows|win64"),
                       "needs": it.get("needs", ""), "exe": it.get("exe", ""), "requires_rom": it.get("requires_rom", "")},
            ))
        return out

    def files(self, entry: Entry) -> list[FileRef]:
        if entry.files_loaded:
            return [FileRef(**f) for f in entry.files]
        repo = entry.extra["repo"]
        try:
            rels = self.cache.get_json(f"gh_{repo}", self.API.format(repo=repo), 6 * 3600)
            rels = [r for r in rels if not r.get("draft")] if isinstance(rels, list) else []
            data = next((r for r in rels if not r.get("prerelease")), rels[0] if rels else {"assets": []})
        except Exception:
            data = self._html_release(repo)
        pat = re.compile(entry.extra.get("asset") or ".", re.I)
        assets = [a for a in data.get("assets", []) if pat.search(a["name"])]
        assets = [a for a in assets if not re.search(r"\.(sha\d*|md5|sig|asc|txt|json|yml|yaml)$|provenance", a["name"], re.I)] or assets
        assets = [a for a in assets if not re.search(r"symbols|pdb|dbg|debug|arm64|linux|mac|\.dmg|appimage|source", a["name"], re.I)] or assets
        if len(assets) > 1 and entry.kind == "recomp":
            arch = [a for a in assets if re.search(r"\.(zip|7z|rar)$", a["name"], re.I)]
            assets = [min(arch or assets, key=lambda a: (len(a["name"]), a["name"]))]
        refs = [FileRef(a["name"], a["browser_download_url"], int(a.get("size") or 0)) for a in assets]
        entry.files = [asdict(r) for r in refs]
        entry.files_loaded = True
        entry.year = entry.year or (data.get("published_at") or "")[:4]
        if data.get("tag_name"):
            entry.extra["version"] = data["tag_name"]
        return refs

    def _html_release(self, repo: str) -> dict:
        key = f"gh_html_{repo}"
        cached = self.cache.get_local(key, 6 * 3600)
        if cached:
            return cached
        empty = {"assets": []}
        try:
            r = self.s.head(f"https://github.com/{repo}/releases/latest", timeout=20, allow_redirects=False)
            loc = r.headers.get("Location") or ""
            m = re.search(r"/releases/tag/(.+)$", loc)
            if not m:
                return empty
            tag = unquote(m.group(1))
            page = self.s.get(f"https://github.com/{repo}/releases/expanded_assets/{quote(tag, safe='')}", timeout=25).text
        except Exception:
            return empty
        assets = []
        for block in re.split(r"<li\b", page)[1:]:
            h = re.search(r'href="(/[^"]+/releases/download/[^"]+)"', block)
            if not h:
                continue
            name = unquote(h.group(1).rsplit("/", 1)[-1])
            sz = re.search(r"([\d.,]+)\s*(TB|GB|MB|KB|Bytes|B)\b", block)
            size = _hydra_size(f"{sz.group(1)} {sz.group(2)[0]}B") if sz and sz.group(2) != "Bytes" else (int(float(sz.group(1))) if sz else 0)
            assets.append({"name": name, "browser_download_url": "https://github.com" + h.group(1), "size": size})
        when = re.search(r'datetime="(\d{4}-\d\d-\d\d)', page)
        data = {"tag_name": tag, "published_at": when.group(1) if when else "", "assets": assets}
        if assets:
            self.cache.put_local(key, data)
        return data


HYDRA_SIZE_RE = re.compile(r"([\d.,]+)\s*(TB|GB|MB|KB|B)", re.I)
HYDRA_JUNK_RE = re.compile(r"\s*(free download|\(build \d+\)|\[.*?\]|\(v?[\d.]+[^)]*\)|v\.?\d+(\.\d+)+\S*|\+\s*\d+\s*dlcs?|multi\d+|repack|fitgirl|dodi|elamigos|goldberg|-\s*(codex|rune|tenoke|razor1911|skidrow|plaza|empress|flt)\b)", re.I)


def _hydra_size(s) -> int:
    if isinstance(s, (int, float)):
        return int(s)
    m = HYDRA_SIZE_RE.search(str(s or ""))
    if not m:
        return 0
    try:
        n = float(re.sub(r"[^\d.]", "", m.group(1).replace(",", ".")).strip(".") or 0)
    except ValueError:
        return 0
    return int(n * {"tb": 2**40, "gb": 2**30, "mb": 2**20, "kb": 2**10, "b": 1}[m.group(2).lower()])


class ManifestProvider(Provider):

    def _load(self, force: bool) -> dict:
        src = self.cfg["url"]
        if re.match(r"https?://", src):
            key = f"manifest_{self.id}"
            if force:
                (paths.CACHE_WEB / f"{key}.json").unlink(missing_ok=True)
            try:
                return self.cache.get_json(key, src, CATALOG_TTL)
            except requests.HTTPError as e:
                body = (e.response.text[:400] if e.response is not None else "").lower()
                if e.response is not None and e.response.status_code in (403, 503) and ("just a moment" in body or "cloudflare" in body or "cf-" in body):
                    raise RuntimeError("Esse site bloqueia downloads fora do navegador (proteção Cloudflare). "
                                       "Abra o link no navegador, salve o .json e adicione a fonte apontando pro arquivo salvo "
                                       "(Fontes → Manual → campo URL aceita um caminho local).") from e
                raise
        p = Path(src) if Path(src).is_absolute() else paths.ROOT / src
        return json.loads(p.read_text(encoding="utf-8-sig"))

    def catalog(self, force=False) -> list[Entry]:
        data = self._load(force)
        if isinstance(data, dict) and "downloads" in data and "games" not in data:
            return self._hydra(data)
        out = []
        for g in data.get("games", []):
            ident = g.get("id") or re.sub(r"[^a-z0-9]+", "-", g["title"].lower()).strip("-")
            gh = str(g.get("github") or "").strip().strip("/")
            if gh and re.fullmatch(r"[\w.-]+/[\w.-]+", gh):
                out.append(Entry(
                    key=f"{self.id}:{ident}", repo=self.id, id=ident, title=g["title"],
                    kind=g.get("kind") or data.get("kind") or self.kind, system=g.get("system") or data.get("system") or self.system,
                    creator=g.get("creator") or gh.split("/")[0], year=str(g.get("year", "")),
                    description=g.get("description", ""), cover=g.get("cover", ""), thumb=g.get("thumb") or g.get("cover", ""),
                    genres=g.get("genres", []), tags=g.get("tags", []), page_url=g.get("page_url") or f"https://github.com/{gh}",
                    extra={"repo": gh, "asset": g.get("asset", r"win.*x64|x64.*win|windows|win64"), "needs": g.get("needs", ""),
                           "exe": g.get("exe", ""), "requires_rom": g.get("requires_rom", ""), "patches": [], "hoster": "github.com", "prefer": ""},
                ))
                continue
            files = [asdict(FileRef(f["name"], f["url"], int(f.get("size") or 0))) for f in g.get("files", [])]
            patches = [{"name": str(x.get("name") or x.get("url", "").rsplit("/", 1)[-1]), "url": x["url"], "size": int(x.get("size") or 0),
                        "note": str(x.get("note") or "")} for x in g.get("patches", []) if isinstance(x, dict) and x.get("url")]
            kind = g.get("kind") or data.get("kind") or self.kind
            system = g.get("system") or data.get("system") or self.system
            if kind == "rom" and (not system or system == "pc"):
                system = ext_system(*[f["name"] for f in files]) or guess_system(g["title"], " ".join(g.get("tags") or []), *[f["name"] for f in files]) or "pc"
            out.append(Entry(
                key=f"{self.id}:{ident}", repo=self.id, id=ident, title=g["title"],
                kind=kind, system=system,
                creator=g.get("creator", ""), year=str(g.get("year", "")), size=int(g.get("size") or sum(f["size"] for f in files)),
                description=g.get("description", ""), cover=g.get("cover", ""), thumb=g.get("thumb") or g.get("cover", ""),
                genres=g.get("genres", []), tags=g.get("tags", []), page_url=g.get("page_url", ""),
                magnet=g.get("magnet", ""), torrent_url=g.get("torrent", ""), files=files, files_loaded=True,
                extra={"exe": g.get("exe", ""), "patches": patches, "hoster": str(g.get("host") or ""), "prefer": str(g.get("prefer") or "")},
            ))
        out.sort(key=lambda e: e.title.lower())
        return out

    def files(self, entry: Entry) -> list[FileRef]:
        if entry.files_loaded or not entry.extra.get("repo"):
            return [FileRef(**f) for f in entry.files]
        return GithubProvider.files(self, entry)

    _html_release = GithubProvider._html_release

    def _hydra(self, data: dict) -> list[Entry]:
        out = []
        seen = set()
        for d in data.get("downloads", []):
            if not isinstance(d, dict):
                continue
            raw = str(d.get("title") or "").strip()
            uris = [u for u in (d.get("uris") or []) if isinstance(u, str)]
            if not raw or not uris:
                continue
            title = HYDRA_JUNK_RE.sub("", raw)
            title = re.sub(r"\s{2,}", " ", title).strip(" -–:,")
            if not title:
                title = raw
            ident = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:90]
            if ident in seen:
                continue
            seen.add(ident)
            magnet = next((u for u in uris if u.startswith("magnet:")), "")
            http = [u for u in uris if u.startswith("http")]
            direct = [u for u in http if re.search(r"\.(7z|zip|rar|001|exe|iso)(\?|$)", u, re.I)]
            files = [asdict(FileRef(u.rsplit("/", 1)[-1].split("?")[0] or "download", u, 0)) for u in direct]
            yr = re.search(r"\((19|20)\d{2}\)", raw)
            fsize = d.get("fileSize", "")
            if not isinstance(fsize, (str, int, float)):
                fsize = ""
            out.append(Entry(
                key=f"{self.id}:{ident}", repo=self.id, id=ident, title=title, kind=self.kind if self.kind != "rom" else "pc", system="pc",
                year=yr.group(0)[1:-1] if yr else "", size=_hydra_size(fsize),
                description="", page_url=(http[0] if http and not direct else str(d.get("repackLinkSource") or "")) or "",
                magnet=magnet, files=files, files_loaded=True, tags=[data.get("name", "")] if data.get("name") else [],
                extra={"uploaded": str(d.get("uploadDate") or ""), "hoster": (http[0].split("/")[2] if http and "/" in http[0][8:] else ("torrent" if magnet else "")), "raw_title": raw},
            ))
        out.sort(key=lambda e: e.title.lower())
        return out


class LocalFolderProvider(Provider):

    def catalog(self, force=False) -> list[Entry]:
        folder = Path(self.cfg.get("path", ""))
        if not folder.is_dir():
            return []
        out = []
        for f in sorted(folder.rglob("*")):
            if not f.is_file():
                continue
            ext = f.suffix.lower().lstrip(".")
            is_rom = bool(re.fullmatch(ROM_EXT, ext))
            if not is_rom and ext != "exe":
                continue
            if ext == "bin" and f.with_suffix(".cue").exists():
                continue
            if ext == "exe" and re.search(r"unins|setup|redist|vcredist|dxsetup|crash", f.stem, re.I):
                continue
            title = re.sub(r"\s*[\(\[].*?[\)\]]", "", f.stem).replace("_", " ").strip() or f.stem
            fid = re.sub(r"[^a-zA-Z0-9]+", "-", f.stem)[:80]
            sid = guess_system(f.parent.name, f.name) or self.system or ("pc" if not is_rom else "")
            out.append(Entry(key=f"{self.id}:{fid}", repo=self.id, id=fid, title=title, kind="rom" if is_rom else "pc", system=sid if is_rom else "pc",
                             size=f.stat().st_size, files=[asdict(FileRef(f.name, f.as_uri(), f.stat().st_size))], files_loaded=True,
                             extra={"local_path": str(f)}))
        out.sort(key=lambda e: e.title.lower())
        return out


HARD_HOSTS = ("archive.org", "mega.nz", "mega.co.nz", "mediafire.com", "gofile.io", "1fichier.com", "rapidgator.net", "uploaded.net",
              "turbobit.net", "nitroflare.com", "drive.google.com", "docs.google.com", "dropbox.com", "onedrive.live.com", "1drv.ms",
              "pixeldrain.com", "buzzheavier.com", "datanodes.to", "qiwi.gg", "anonfiles.com", "krakenfiles.com", "filecrypt.cc",
              "ouo.io", "linkvertise.com", "shrinkme.io", "torrentgalaxy", "1337x.to", "thepiratebay")
GAME_FILE_RE = re.compile(r"\.(7z|zip|rar|001|iso|exe|msi|chd|rvz|wbfs|nsp|xci|pbp|cso|z64|n64|nds|gba|gb|gbc|sfc|smc|nes|md|gen|gcm|cue|bin|img|3ds|cci)(\?|#|$)", re.I)
TORRENT_RE = re.compile(r"^magnet:\?|\.torrent(\?|#|$)", re.I)
HREF_RE = re.compile(r"<a\b[^>]*?href\s*=\s*[\"']([^\"'#][^\"']*)[\"'][^>]*>(.*?)</a>", re.I | re.S)
PAGE_JUNK_RE = re.compile(r"\b(download|baixar|free|grátis|gratis|torrent|magnet|direct|direto|link|mirror|espelho|clique aqui|click here|aqui|here|parte?\s*\d+|part\s*\d+|google drive|mega|mediafire|servidor \d+|server \d+)\b", re.I)


def _host(u: str) -> str:
    m = re.match(r"https?://([^/:?#]+)", u, re.I)
    return (m.group(1) if m else "").lower()


def is_hard_host(u: str) -> bool:
    h = _host(u)
    return any(h == x or h.endswith("." + x) or x in h for x in HARD_HOSTS)


def _title_from(text: str, url: str, page_title: str = "") -> str:
    t = clean_html(text).strip()
    t = PAGE_JUNK_RE.sub("", t).strip(" -–:|·[]()")
    if len(t) < 3 or re.fullmatch(r"[\W\d_]+", t):
        t = page_title
    if len(t) < 3:
        base = unquote(url.split("?")[0].rstrip("/").rsplit("/", 1)[-1])
        t = re.sub(r"\.(7z|zip|rar|001|iso|exe|msi|torrent)$", "", base, flags=re.I).replace("_", " ").replace(".", " ").replace("-", " ").strip()
    t = HYDRA_JUNK_RE.sub("", t)
    return re.sub(r"\s{2,}", " ", t).strip(" -–:,")[:120]


def analyze_page(session: requests.Session, url: str, depth: int = 1, limit_pages: int = 40) -> dict:
    from urllib.parse import urljoin
    seen_pages, games, hard, titles = set(), {}, [], {}
    stats = {"direct": 0, "torrent": 0, "pages": 0}

    def grab(page_url: str) -> list[tuple[str, str]]:
        if page_url in seen_pages or len(seen_pages) > limit_pages:
            return []
        seen_pages.add(page_url)
        r = session.get(page_url, timeout=25, headers={"Accept": "text/html,*/*"})
        r.raise_for_status()
        ct = r.headers.get("Content-Type", "")
        if "html" not in ct and "text" not in ct:
            return []
        if "charset" not in ct.lower():
            r.encoding = r.apparent_encoding
        stats["pages"] += 1
        body = r.text[:3_000_000]
        m = re.search(r"<h1[^>]*>(.*?)</h1>", body, re.I | re.S) or re.search(r"<title[^>]*>(.*?)</title>", body, re.I | re.S)
        if m:
            titles[page_url] = HYDRA_JUNK_RE.sub("", PAGE_JUNK_RE.sub("", clean_html(m.group(1)).split(" | ")[0].split(" – ")[0].split(" - ")[0])).strip(" -–:,")[:120]
        out = []
        for href, text in HREF_RE.findall(body):
            href = html.unescape(href.strip())
            if href.startswith(("javascript:", "mailto:")):
                continue
            out.append((href if href.startswith("magnet:") else urljoin(page_url, href), text))
        return out

    def add(title: str, url: str, page_url: str):
        key = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or _host(url)
        g = games.setdefault(key, {"title": title, "files": [], "magnet": "", "torrent_url": "", "page_url": page_url, "host": _host(url)})
        if url.startswith("magnet:"):
            g["magnet"] = g["magnet"] or url
            stats["torrent"] += 1
        elif TORRENT_RE.search(url):
            g["torrent_url"] = g["torrent_url"] or url
            stats["torrent"] += 1
        else:
            if any(f["url"] == url for f in g["files"]):
                return
            g["files"].append(asdict(FileRef(unquote(url.split("?")[0].rsplit("/", 1)[-1]) or "download", url, 0)))
            stats["direct"] += 1

    def scan(page_url: str, links: list[tuple[str, str]]) -> list[str]:
        subs = []
        base_host = _host(page_url)
        for href, text in links:
            if TORRENT_RE.search(href) or GAME_FILE_RE.search(href):
                if not href.startswith("magnet:") and is_hard_host(href):
                    hard.append(href)
                    continue
                add(_title_from(text, href, titles.get(page_url, "") if page_url != url else ""), href, page_url)
            elif depth and _host(href) == base_host and href != page_url and not re.search(r"\.(css|js|png|jpe?g|gif|webp|svg|ico|xml|rss)(\?|$)", href, re.I):
                t = clean_html(text).strip()
                if 4 <= len(t) <= 90 and not re.search(r"^(home|início|inicio|login|entrar|contato|sobre|about|next|prev|anterior|próxim|\d+)$", t, re.I):
                    subs.append(href)
        return subs

    links = grab(url)
    subs = scan(url, links)
    if depth and len(games) < 3 and subs:

        from concurrent.futures import ThreadPoolExecutor
        uniq = list(dict.fromkeys(subs))[:limit_pages]
        with ThreadPoolExecutor(max_workers=8) as ex:
            def safe(u):
                try:
                    return grab(u)
                except Exception:
                    return []
            for sub, got in zip(uniq, ex.map(safe, uniq)):
                scan(sub, got)
    out = [g for g in games.values() if g["files"] or g["magnet"] or g["torrent_url"]]
    out.sort(key=lambda g: g["title"].lower())
    return {"games": out, "hard": hard[:50], "hard_count": len(hard), **stats}


class WebPageProvider(Provider):

    def catalog(self, force=False) -> list[Entry]:
        key = f"webpage_{self.id}"
        cache_file = paths.CACHE_WEB / f"{key}.json"
        data = None
        if not force and cache_file.exists() and time.time() - cache_file.stat().st_mtime < CATALOG_TTL:
            try:
                data = json.loads(cache_file.read_text(encoding="utf-8"))
            except Exception:
                data = None
        if data is None:
            data = analyze_page(self.s, self.cfg["url"], depth=int(self.cfg.get("depth", 1)))
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        out = []
        for g in data.get("games", []):
            ident = re.sub(r"[^a-z0-9]+", "-", g["title"].lower()).strip("-")[:90] or "jogo"
            sid = guess_system(g["title"]) if self.kind == "rom" else "pc"
            yr = re.search(r"\b(19[89]\d|20[0-3]\d)\b", g["title"])
            out.append(Entry(key=f"{self.id}:{ident}", repo=self.id, id=ident, title=g["title"], kind=self.kind, system=sid or self.system,
                             year=yr.group(1) if yr else "", page_url=g.get("page_url", ""), magnet=g.get("magnet", ""), torrent_url=g.get("torrent_url", ""),
                             files=g.get("files", []), files_loaded=True, extra={"hoster": g.get("host", "")}))
        return out


class TelegramProvider(Provider):

    API = "https://api.telegram.org/bot{token}/{method}"
    TORRENT_DIR = paths.CACHE_WEB / "torrents"

    def _call(self, method: str, **params):
        r = self.s.get(self.API.format(token=self.cfg["token"], method=method), params=params, timeout=40)
        data = r.json()
        if not data.get("ok"):
            raise RuntimeError(f"Telegram: {data.get('description') or r.status_code}")
        return data["result"]

    def _state_file(self) -> Path:
        return paths.CACHE_WEB / f"tg_{re.sub(r'[^a-z0-9_-]', '_', self.id)}.json"

    def _load(self) -> dict:
        f = self._state_file()
        try:
            return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {"offset": 0, "posts": {}, "chat_id": None, "title": ""}
        except Exception:
            return {"offset": 0, "posts": {}, "chat_id": None, "title": ""}

    def _save(self, st: dict):
        f = self._state_file()
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(st, ensure_ascii=False), encoding="utf-8")

    def _matches_chat(self, chat: dict) -> bool:
        want = str(self.cfg.get("chat") or "").strip()
        if not want or want.startswith(("https://t.me/+", "t.me/+", "+")):
            return True
        want = want.lstrip("@").lower()
        return str(chat.get("id")) == want or (chat.get("username") or "").lower() == want or (chat.get("title") or "").lower() == want

    def _pull(self, st: dict) -> bool:
        changed = False
        for _ in range(20):
            ups = self._call("getUpdates", offset=st["offset"] or None, limit=100, timeout=0,
                             allowed_updates=json.dumps(["channel_post", "edited_channel_post"]))
            if not ups:
                break
            for u in ups:
                st["offset"] = u["update_id"] + 1
                msg = u.get("channel_post") or u.get("edited_channel_post")
                if not msg or not self._matches_chat(msg.get("chat") or {}):
                    continue
                st["chat_id"] = msg["chat"]["id"]
                st["title"] = msg["chat"].get("title") or st.get("title", "")
                doc = msg.get("document") or {}
                name = doc.get("file_name") or ""
                if not name.lower().endswith(".torrent"):
                    continue
                cap = (msg.get("caption") or "").strip()
                first = next((ln.strip() for ln in cap.splitlines() if ln.strip()), "") or re.sub(r"\.torrent$", "", name, flags=re.I)
                title = re.sub(r"\s*#\w+", "", first).strip() or name
                tags = re.findall(r"#(\w+)", cap)
                photo = (msg.get("photo") or [])
                st["posts"][str(msg["message_id"])] = {
                    "title": title, "caption": cap, "file_id": doc.get("file_id"), "file_name": name, "size": doc.get("file_size") or 0,
                    "date": msg.get("date") or 0, "tags": tags, "photo": photo[-1]["file_id"] if photo else "",
                    "link": f"https://t.me/c/{str(msg['chat']['id']).replace('-100', '')}/{msg['message_id']}",
                }
                changed = True
            if len(ups) < 100:
                break
        return changed

    def _file_url(self, file_id: str) -> str:
        info = self._call("getFile", file_id=file_id)
        return f"https://api.telegram.org/file/bot{self.cfg['token']}/{info['file_path']}"

    def _torrent_path(self, mid: str, post: dict) -> str:
        self.TORRENT_DIR.mkdir(parents=True, exist_ok=True)
        p = self.TORRENT_DIR / f"{re.sub(r'[^a-z0-9_-]', '_', self.id)}_{mid}.torrent"
        if not p.exists() or p.stat().st_size == 0:
            r = self.s.get(self._file_url(post["file_id"]), timeout=60)
            r.raise_for_status()
            if not r.content.startswith(b"d"):
                raise RuntimeError("O arquivo do post não é um .torrent válido")
            p.write_bytes(r.content)
        return str(p)

    def catalog(self, force=False) -> list[Entry]:
        st = self._load()
        try:
            self._pull(st)
            self._save(st)
        except Exception as e:
            if not st["posts"]:
                raise
            log.warning("telegram %s: %s (usando cache)", self.id, e)
        out = []
        for mid, p in sorted(st["posts"].items(), key=lambda kv: -(kv[1].get("date") or 0)):
            sid = "pc"
            if self.kind == "rom":
                sid = next((t.lower() for t in p.get("tags", []) if t.lower() in SYSTEM_IDS), "") or guess_system(p["title"], p.get("caption", "")) or self.system
            yr = re.search(r"\b(19[89]\d|20[0-3]\d)\b", p.get("caption", ""))
            out.append(Entry(key=f"{self.id}:{mid}", repo=self.id, id=mid, title=p["title"], kind=self.kind, system=sid,
                             year=yr.group(1) if yr else "", size=int(p.get("size") or 0), description=p.get("caption", ""),
                             page_url=p.get("link", ""), torrent_url=f"tg:{mid}", files=[], files_loaded=True,
                             tags=p.get("tags", []), extra={"telegram": True, "photo": p.get("photo", ""), "posted": int(p.get("date") or 0)}))
        return out

    def resolve_torrent(self, entry: Entry) -> str:
        st = self._load()
        p = st["posts"].get(entry.id)
        if not p:
            raise RuntimeError("Post não encontrado no cache do canal")
        return self._torrent_path(entry.id, p)

    def thumb_url(self, entry: Entry) -> str:
        fid = (entry.extra or {}).get("photo")
        if not fid:
            return ""
        try:
            return self._file_url(fid)
        except Exception:
            return ""

    def test(self) -> dict:
        me = self._call("getMe")
        st = self._load()
        self._pull(st)
        self._save(st)
        return {"bot": me.get("username"), "posts": len(st["posts"]), "chat": st.get("title") or ""}


SYSTEM_IDS = {"ps1", "ps2", "ps3", "psp", "psvita", "n64", "gc", "wii", "wiiu", "switch", "nds", "3ds", "gba", "gb", "gbc", "snes", "nes", "md",
              "saturn", "dc", "xbox", "x360", "dos", "arcade", "pc"}


PROVIDERS = {
    "telegram": TelegramProvider,
    "webpage": WebPageProvider,
    "local_folder": LocalFolderProvider,
    "archive_uploader": ArchiveProvider,
    "archive_creator": ArchiveProvider,
    "archive_search": ArchiveProvider,
    "archive_item": ArchiveItemProvider,
    "github_release": GithubProvider,
    "manifest": ManifestProvider,
}


class RepoRegistry:

    def __init__(self, store):
        self.store = store
        self.session = Session()
        self.session.headers.update(UA)

        for pre in ("https://", "http://"):
            self.session.mount(pre, requests.adapters.HTTPAdapter(pool_connections=16, pool_maxsize=32))
        self.cache = _Cache(self.session)
        self.providers: dict[str, Provider] = {}
        self._user_added: set[str] = set()
        self.reload()

    LEGACY_BUILTIN = {"rohankar", "recomps", "emulators", "fitgirl-arquivo", "site-abandonwaregames", "site-myabandonware-dos",
                      "site-myabandonware-win", "site-ankergames", "site-cracked-games"}

    @property
    def file(self) -> Path:
        return paths.DATA / "repos.json"

    def _read(self) -> list[dict]:
        if not self.file.exists():
            self._migrate_legacy()
        try:
            repos = json.loads(self.file.read_text(encoding="utf-8"))["repos"]
        except Exception:
            return []
        keep = [r for r in repos if isinstance(r, dict) and not r.get("official") and r.get("id") != "ludrix-oficial"]
        if len(keep) != len(repos):
            try:
                self.file.write_text(json.dumps({"repos": keep}, ensure_ascii=False, indent=1), encoding="utf-8")
            except Exception:
                pass
        return keep

    def _migrate_legacy(self):
        old = paths.PRESETS / "repos.json"
        mine = []
        try:
            if old.exists():
                mine = [r for r in json.loads(old.read_text(encoding="utf-8")).get("repos", []) if r.get("id") not in self.LEGACY_BUILTIN]
        except Exception:
            mine = []
        try:
            self.file.parent.mkdir(parents=True, exist_ok=True)
            self._write(mine)
        except Exception as e:
            log.warning("repos.json: %s", e)

    def _write(self, repos: list[dict]):
        self.file.write_text(json.dumps({"repos": repos}, indent=2, ensure_ascii=False), encoding="utf-8")

    def reload(self):
        self.providers.clear()
        self._heal()
        for cfg in self._read():
            cls = PROVIDERS.get(cfg.get("type"))
            if cls:
                prov = cls(cfg, self.session, self.cache)
                prov.store = self.store
                self.providers[cfg["id"]] = prov

    def _heal(self):
        repos = self._read()
        changed = False
        if any(c.get("type") not in PROVIDERS for c in repos):
            repos = [c for c in repos if c.get("type") in PROVIDERS]
            changed = True
        for cfg in repos:
            url = cfg.get("url") or ""
            m = re.search(r"archive\.org/details/@([A-Za-z0-9_.-]+)", url)
            if cfg.get("type") == "webpage" and m:
                u = resolve_archive_user(self.session, m.group(1))
                if u:
                    cfg.update({"type": "archive_uploader", "uploader": u["uploader"], "kind": cfg.get("kind") or "pc"})
                    cfg.pop("url", None)
                    changed = True
        if changed:
            self._write(repos)

    def list(self) -> list[dict]:
        disabled = set(self._disabled())
        out = []
        for c in self._read():
            d = {**c, "enabled": c["id"] not in disabled}
            if d.get("token"):
                d["token"] = ""
                d["token_set"] = True
            out.append(d)
        return out

    def add(self, cfg: dict) -> dict:
        cfg = dict(cfg)
        cfg.setdefault("id", re.sub(r"[^a-z0-9]+", "-", str(cfg.get("name") or "repo").lower()).strip("-") or f"repo{int(time.time())}")
        if cfg["type"] not in PROVIDERS:
            raise ValueError("tipo inválido")
        repos = [r for r in self._read() if r["id"] != cfg["id"]] + [cfg]
        self._user_added.add(cfg["id"])
        self._write(repos)
        self.reload()
        return cfg

    def update(self, repo_id: str, patch: dict) -> dict:
        repos = self._read()
        cur = next((r for r in repos if r["id"] == repo_id), None)
        if not cur:
            raise ValueError("Fonte não encontrada")
        allowed = {"name", "kind", "system", "url", "token", "chat", "uploader", "creator", "query", "identifier", "repo", "title",
                   "asset", "path", "platform", "depth", "note"}
        for k, v in patch.items():
            if k not in allowed:
                continue
            if isinstance(v, str):
                v = v.strip()
            if v in ("", None):
                cur.pop(k, None)
            else:
                cur[k] = v
        if not cur.get("name"):
            cur["name"] = repo_id
        if cur.get("kind") != "rom":
            cur["system"] = "pc"
        self._write(repos)

        if any(k in patch for k in ("url", "token", "chat", "uploader", "creator", "query", "identifier", "repo", "path", "platform", "depth")):
            for f in paths.CACHE_WEB.glob("*"):
                if repo_id in f.name:
                    try:
                        f.unlink()
                    except OSError:
                        pass
        self.reload()
        return cur

    def remove(self, repo_id: str):
        self._write([r for r in self._read() if r["id"] != repo_id])
        self.reload()

    def set_enabled(self, repo_id: str, enabled: bool):
        d = self._disabled()
        (d.discard if enabled else d.add)(repo_id)
        self.store.set_config(disabled_repos=sorted(d))

    def _disabled(self) -> set[str]:
        cfg = self.store.config
        ids = [r["id"] for r in self._read()]
        if not cfg.get("repos_initialized"):

            self.store.set_config(repos_initialized=True, known_repos=ids,
                                  disabled_repos=ids if cfg.get("repos_default_off", True) else [])
            cfg = self.store.config

        known = set(cfg.get("known_repos") or ids)
        fresh = [i for i in ids if i not in known and i not in self._user_added]
        if fresh and cfg.get("repos_default_off", True):
            self.store.set_config(known_repos=sorted(known | set(ids)),
                                  disabled_repos=sorted(set(cfg.get("disabled_repos") or []) | set(fresh)))
            cfg = self.store.config
        elif set(ids) - known:
            self.store.set_config(known_repos=sorted(known | set(ids)))
        return set(cfg.get("disabled_repos") or [])

    def enabled_providers(self) -> list[Provider]:
        d = self._disabled()
        return [p for pid, p in self.providers.items() if pid not in d]
