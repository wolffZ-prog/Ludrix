from __future__ import annotations

import json
import re
import shutil
import threading
import time
import zipfile
from pathlib import Path

import requests

from . import paths
from .images import is_error_image
from .installer import Downloader, Progress, safe_extractall, safe_member
from .repos import FileRef

FLASH = paths.FLASH
RUFFLE = FLASH / "ruffle"
GAMES = FLASH / "games"
HTML = FLASH / "html"
COVERS = FLASH / "covers"
CUSTOM = FLASH / "custom.json"
SWF_MAGIC = (b"FWS", b"CWS", b"ZWS")


def _slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:50]


def _find_entry(d: Path) -> Path | None:
    best = None
    for p in d.rglob("*.htm*"):
        if p.suffix.lower() not in (".html", ".htm"):
            continue
        depth = len(p.relative_to(d).parts)
        score = (depth, 0 if p.stem.lower() == "index" else 1, p.name.lower())
        if best is None or score < best[0]:
            best = (score, p)
    return best[1] if best else None


def _swf_size(p: Path) -> tuple[int, int] | None:
    try:
        import zlib
        raw = p.read_bytes()
        sig = raw[:3]
        body = raw[8:8 + 64]
        if sig == b"CWS":
            body = zlib.decompressobj().decompress(raw[8:8 + 4096])[:64]
        elif sig != b"FWS":
            return None
        nbits = body[0] >> 3
        bits = "".join(f"{b:08b}" for b in body[:32])[5:]
        vals = [int(bits[i * nbits:(i + 1) * nbits], 2) for i in range(4)]
        w, h = (vals[1] - vals[0]) // 20, (vals[3] - vals[2]) // 20
        return (w, h) if 100 < w < 4000 and 100 < h < 4000 else None
    except Exception:
        return None


class FlashManager:
    def __init__(self, store, session: requests.Session, cache):
        self.store = store
        self.s = session
        self.cache = cache
        self.presets = self._load()
        self.on_cover = None
        self._cover_q: list[str] = []
        self._cover_seen: set[str] = set()
        self._cover_lock = threading.Lock()
        self._cover_threads: list[threading.Thread] = []

    def cover_local(self, gid: str) -> Path | None:
        p = COVERS / f"{gid}.jpg"
        if p.exists():
            return p
        g = next((x for x in self.presets["games"] if x["id"] == gid), None)
        if not g or not (g.get("item") or str(g.get("cover", "")).startswith("http")):
            return None
        with self._cover_lock:
            if gid not in self._cover_seen:
                self._cover_seen.add(gid)
                self._cover_q.append(gid)
            self._cover_threads = [t for t in self._cover_threads if t.is_alive()]
            if len(self._cover_threads) < min(3, len(self._cover_q)):
                t = threading.Thread(target=self._cover_worker, daemon=True, name="flash-covers")
                self._cover_threads.append(t)
                t.start()
        return None

    def _cover_worker(self):
        while True:
            with self._cover_lock:
                if not self._cover_q:
                    return
                gid = self._cover_q.pop(0)
            try:
                if self.cover_path(gid) and self.on_cover:
                    self.on_cover(gid)
            except Exception:
                pass
            with self._cover_lock:
                self._cover_seen.discard(gid)

    def _load(self) -> dict:
        p = paths.PRESETS / "flash.json"
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            d = {"games": [], "ruffle_repo": "ruffle-rs/ruffle"}
        for g in d["games"]:
            g["custom"] = False
        d["games"] += self._custom()
        for g in d["games"]:
            g.setdefault("type", "swf")
        return d

    def _custom(self) -> list[dict]:
        try:
            lst = json.loads(CUSTOM.read_text(encoding="utf-8")) if CUSTOM.exists() else []
        except Exception:
            lst = []
        for g in lst:
            g["custom"] = True
        return lst

    def _save_custom(self, lst: list[dict]):
        FLASH.mkdir(parents=True, exist_ok=True)
        CUSTOM.write_text(json.dumps([{k: v for k, v in g.items() if k != "custom"} for g in lst], ensure_ascii=False, indent=1), encoding="utf-8")

    def _new_custom(self, title: str, kind: str, **extra) -> dict:
        lst = self._custom()
        gid = "my-" + (_slug(title) or "jogo")
        if any(g["id"] == gid for g in lst):
            gid += "-" + str(int(time.time()))[-4:]
        g = {"id": gid, "title": title, "type": kind, "item": "", "file": "", "size": 0, "genre": "Meu jogo", "players": "", "time": "",
             "w": 800, "h": 600, "controls": "", "tip": "", "year": "", "dev": "", "cover": "", "desc": "", "url": ""}
        g.update(extra)
        lst.append(g)
        self._save_custom(lst)
        self.presets = self._load()
        return {"ok": True, "id": gid, "title": title, "type": kind}

    def add_custom(self, path: str, title: str = "", genre: str = "", w: int = 800, h: int = 600) -> dict:
        path = (path or "").strip().strip('"')
        title = (title or "").strip()
        if re.match(r"^https?://", path, re.I):
            return self.add_web(path, title)
        src = Path(path)
        if not src.exists():
            return {"error": "Arquivo ou pasta não encontrado"}
        if src.is_dir():
            return self._add_html_dir(src, title)
        ext = src.suffix.lower()
        if ext == ".zip":
            return self._add_html_zip(src, title)
        if ext == ".swf":
            if src.read_bytes()[:3] not in SWF_MAGIC:
                return {"error": "Esse arquivo não é um Flash (.swf) válido"}
            title = title or re.sub(r"[_\-]+", " ", src.stem).strip().title()
            dims = _swf_size(src)
            r = self._new_custom(title, "swf", file=src.name, size=src.stat().st_size, genre=genre or "Meu jogo", w=dims[0] if dims else w, h=dims[1] if dims else h, desc=f"Adicionado de {src}")
            GAMES.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, self.game_path(r["id"]))
            return r
        if ext in (".html", ".htm"):
            return self._add_html_dir(src.parent, title or src.parent.name, entry=src.name)
        return {"error": "Aceito .swf (Flash), .zip ou pasta com index.html (HTML5) e links http(s) de jogos de site"}

    def add_web(self, url: str, title: str = "") -> dict:
        url = (url or "").strip()
        if not re.match(r"^https?://[^\s]+$", url, re.I):
            return {"error": "Cole o endereço completo do jogo (começando com http:// ou https://)"}
        if not title:
            title = re.sub(r"^www\.", "", re.sub(r"^https?://", "", url)).split("/")[0]
        return self._new_custom(title, "web", url=url, genre="Jogo de site", desc=url)

    def _add_html_dir(self, src: Path, title: str, entry: str = "") -> dict:
        ent = (src / entry) if entry else _find_entry(src)
        if not ent or not ent.exists():
            return {"error": "Nenhum index.html nessa pasta"}
        title = title or re.sub(r"[_\-]+", " ", src.name).strip().title()
        r = self._new_custom(title, "html5", desc=f"Adicionado de {src}")
        dst = self.html_dir(r["id"])
        shutil.rmtree(dst, ignore_errors=True)
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns(".git", "__MACOSX", "*.map"))
        lst = self._custom()
        for g in lst:
            if g["id"] == r["id"]:
                g["size"] = sum(p.stat().st_size for p in dst.rglob("*") if p.is_file())
        self._save_custom(lst)
        self.presets = self._load()
        return r

    def _add_html_zip(self, src: Path, title: str) -> dict:
        try:
            z = zipfile.ZipFile(src)
        except zipfile.BadZipFile:
            return {"error": "Esse .zip está danificado"}
        with z:
            if not any(n.lower().endswith((".html", ".htm")) for n in z.namelist()):
                return {"error": "Esse .zip não tem nenhum .html dentro — pra jogos de Windows use a Biblioteca (Adicionar → Jogo de Windows)"}
            title = title or re.sub(r"[_\-]+", " ", src.stem).strip().title()
            r = self._new_custom(title, "html5", size=src.stat().st_size, desc=f"Adicionado de {src}")
            dst = self.html_dir(r["id"])
            shutil.rmtree(dst, ignore_errors=True)
            dst.mkdir(parents=True, exist_ok=True)
            safe_extractall(z, dst)
        return r

    def update_custom(self, gid: str, **fields) -> dict:
        lst = self._custom()
        g = next((x for x in lst if x["id"] == gid), None)
        if not g:
            return {"error": "Jogo não encontrado"}
        for k in ("title", "genre", "tip", "controls", "w", "h", "players", "time", "url"):
            if k in fields and fields[k] is not None:
                g[k] = fields[k]
        self._save_custom(lst)
        self.presets = self._load()
        return {"ok": True}

    def set_cover(self, gid: str, path: str) -> dict:
        from PIL import Image
        COVERS.mkdir(parents=True, exist_ok=True)
        try:
            img = Image.open(path).convert("RGB")
        except Exception as e:
            return {"error": f"Imagem inválida: {e}"}
        img.thumbnail((800, 800))
        img.save(COVERS / f"{gid}.jpg", "JPEG", quality=86)
        return {"ok": True}

    def cover_path(self, gid: str) -> Path | None:
        p = COVERS / f"{gid}.jpg"
        if p.exists():
            return p
        g = next((x for x in self.presets["games"] if x["id"] == gid), None)
        if not g or not (g.get("item") or str(g.get("cover", "")).startswith("http")):
            return None
        COVERS.mkdir(parents=True, exist_ok=True)
        urls = []
        if str(g.get("cover", "")).startswith("http"):
            urls.append(g["cover"])
        elif g.get("cover"):
            urls.append(f"https://archive.org/download/{g['item']}/{requests.utils.quote(g['cover'])}")
        if g.get("item"):
            urls.append(f"https://archive.org/services/img/{g['item']}")
        from PIL import Image
        import io
        for u in urls:
            try:
                r = self.s.get(u, timeout=20)
                if r.status_code != 200 or len(r.content) < 2000:
                    continue
                img = Image.open(io.BytesIO(r.content)).convert("RGB")
                if img.width < 120 or is_error_image(img):
                    continue
                img.thumbnail((800, 800))
                img.save(p, "JPEG", quality=86)
                return p
            except Exception:
                continue
        return None

    def ruffle_ready(self) -> bool:
        return (RUFFLE / "ruffle.js").exists()

    def game_path(self, gid: str) -> Path:
        return GAMES / f"{gid}.swf"

    def html_dir(self, gid: str) -> Path:
        if not re.match(r"^[a-z0-9][a-z0-9-]*$", gid or ""):
            raise ValueError("id inválido")
        return HTML / gid

    def entry_url(self, gid: str) -> str | None:
        d = HTML / gid
        ent = _find_entry(d) if d.is_dir() else None
        return f"/flash/html/{gid}/{ent.relative_to(d).as_posix()}" if ent else None

    def is_installed(self, g: dict, have: set | None = None) -> bool:
        t = g.get("type", "swf")
        if t == "web":
            return bool(g.get("url"))
        if t == "html5":
            return (HTML / g["id"]).is_dir() and _find_entry(HTML / g["id"]) is not None
        return (f"{g['id']}.swf" in have) if have is not None else self.game_path(g["id"]).exists()

    def status(self) -> dict:
        scores = self.store.config.get("flash_stats", {})
        games = []
        have = set()
        try:
            have = {x.name for x in GAMES.iterdir()}
        except OSError:
            pass
        covers = set()
        try:
            covers = {x.stem for x in COVERS.iterdir()}
        except OSError:
            pass
        for g in self.presets["games"]:
            st = scores.get(g["id"], {})
            games.append({**g, "installed": self.is_installed(g, have), "plays": st.get("plays", 0), "last": st.get("last", 0), "fav": st.get("fav", False),
                          "has_cover": g["id"] in covers or bool(g.get("item")) or bool(g.get("cover", "").startswith("http"))})
        return {"ruffle": self.ruffle_ready(), "games": games, "dir": str(FLASH)}

    def remove_custom(self, gid: str) -> dict:
        lst = [g for g in self._custom() if g["id"] != gid]
        self._save_custom(lst)
        self.game_path(gid).unlink(missing_ok=True)
        if re.match(r"^[a-z0-9][a-z0-9-]*$", gid or ""):
            shutil.rmtree(HTML / gid, ignore_errors=True)
        (COVERS / f"{gid}.jpg").unlink(missing_ok=True)
        self.presets = self._load()
        return {"ok": True}

    def toggle_fav(self, gid: str) -> dict:
        st = dict(self.store.config.get("flash_stats", {}))
        cur = dict(st.get(gid, {}))
        cur["fav"] = not cur.get("fav")
        st[gid] = cur
        self.store.set_config(flash_stats=st)
        return {"ok": True, "fav": cur["fav"]}

    def prefetch_covers(self):
        for g in self.presets["games"]:
            if g.get("item") and not (COVERS / f"{g['id']}.jpg").exists():
                try:
                    self.cover_path(g["id"])
                except Exception:
                    pass

    def install_ruffle(self, cb, cancel: threading.Event) -> Path:
        repo = self.presets.get("ruffle_repo", "ruffle-rs/ruffle")
        rels = self.cache.get_json(f"gh_{repo}", f"https://api.github.com/repos/{repo}/releases?per_page=3", 6 * 3600)
        rels = [r for r in rels if not r.get("draft")] if isinstance(rels, list) else []
        asset = None
        for r in rels:
            asset = next((a for a in r.get("assets", []) if a["name"].endswith("web-selfhosted.zip")), None)
            if asset:
                break
        if not asset:
            raise RuntimeError("Pacote não encontrado: 'web-selfhosted' do Ruffle no GitHub")
        tmp = paths.DOWNLOADS / "ruffle.zip"
        tmp.parent.mkdir(parents=True, exist_ok=True)
        cb(Progress("download", 0, "Baixando o Ruffle (player de Flash)…"))
        Downloader(self.s).download(FileRef(asset["name"], asset["browser_download_url"], int(asset.get("size") or 0)), tmp, cb, cancel)
        cb(Progress("extract", 0, "Extraindo…"))
        if RUFFLE.exists():
            shutil.rmtree(RUFFLE, ignore_errors=True)
        RUFFLE.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(tmp) as z:
            for n in z.namelist():
                if not n.endswith(".map") and not n.endswith("/"):
                    d = safe_member(RUFFLE, n)
                    d.parent.mkdir(parents=True, exist_ok=True)
                    d.write_bytes(z.read(n))
        tmp.unlink(missing_ok=True)
        (RUFFLE / "version.txt").write_text(asset["name"], encoding="utf-8")
        return RUFFLE

    def install_game(self, gid: str, cb, cancel: threading.Event) -> Path:
        g = next((x for x in self.presets["games"] if x["id"] == gid), None)
        if not g:
            raise RuntimeError("Jogo desconhecido")
        if g.get("type") == "web":
            return FLASH
        url = g.get("url") if str(g.get("url", "")).startswith("http") else (f"https://archive.org/download/{g['item']}/{requests.utils.quote(g['file'])}" if g.get("item") else "")
        if not url:
            raise RuntimeError("Jogo próprio: o arquivo já deveria estar em flash/")
        cb(Progress("download", 0, f"Baixando {g['title']}…"))
        if g.get("type") == "html5":
            dst = self.html_dir(gid)
            tmp = paths.DOWNLOADS / f"{gid}.zip"
            tmp.parent.mkdir(parents=True, exist_ok=True)
            Downloader(self.s).download(FileRef(g.get("file") or f"{gid}.zip", url, int(g.get("size") or 0)), tmp, cb, cancel)
            cb(Progress("extract", 0, "Extraindo…"))
            shutil.rmtree(dst, ignore_errors=True)
            dst.mkdir(parents=True, exist_ok=True)
            try:
                with zipfile.ZipFile(tmp) as z:
                    safe_extractall(z, dst)
            except zipfile.BadZipFile:
                shutil.rmtree(dst, ignore_errors=True)
                raise RuntimeError("O arquivo baixado não é um .zip válido")
            finally:
                tmp.unlink(missing_ok=True)
            if not _find_entry(dst):
                shutil.rmtree(dst, ignore_errors=True)
                raise RuntimeError("O pacote não tem um index.html")
            return dst
        GAMES.mkdir(parents=True, exist_ok=True)
        dest = self.game_path(gid)
        Downloader(self.s).download(FileRef(g["file"], url, 0), dest, cb, cancel)
        if dest.stat().st_size < 10_000 or dest.read_bytes()[:3] not in SWF_MAGIC:
            dest.unlink(missing_ok=True)
            raise RuntimeError("O arquivo baixado não é um .swf válido")
        return dest

    def install_all_missing(self, cb, cancel: threading.Event) -> dict:
        n = 0
        if not self.ruffle_ready():
            self.install_ruffle(cb, cancel)
        for g in self.presets["games"]:
            if cancel.is_set():
                break
            if g.get("type", "swf") != "web" and not self.is_installed(g):
                try:
                    self.install_game(g["id"], cb, cancel)
                    n += 1
                except Exception:
                    continue
        return {"count": n}

    def remove_game(self, gid: str):
        self.game_path(gid).unlink(missing_ok=True)
        if re.match(r"^[a-z0-9][a-z0-9-]*$", gid or ""):
            shutil.rmtree(HTML / gid, ignore_errors=True)

    def mark_play(self, gid: str):
        st = dict(self.store.config.get("flash_stats", {}))
        cur = dict(st.get(gid, {}))
        cur["plays"] = cur.get("plays", 0) + 1
        cur["last"] = time.time()
        st[gid] = cur
        self.store.set_config(flash_stats=st)

    def player_html(self, gid: str, sandbox_base: str = "") -> str:
        g = next((x for x in self.presets["games"] if x["id"] == gid), None)
        if not g or not self.is_installed(g):
            return "<h2 style='font-family:sans-serif;color:#ccc;background:#111;margin:0;padding:30px'>Jogo não instalado</h2>"
        title = re.sub(r"[<>&]", "", g["title"])
        if g.get("type") == "html5":
            src = sandbox_base + (self.entry_url(gid) or "").removeprefix("/flash")
            return f"""<!doctype html><html><head><meta charset="utf-8"><title>{title}</title>
<style>html,body{{margin:0;height:100%;background:#0b0d12;overflow:hidden}}iframe{{position:absolute;inset:0;width:100%;height:100%;border:0;background:#0b0d12}}</style></head>
<body><iframe src="{src}" sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms" allow="autoplay; fullscreen; gamepad" referrerpolicy="no-referrer"></iframe>
<script>document.addEventListener("keydown",e=>{{if(e.key==="Escape")parent.postMessage("flash:close","*")}});</script></body></html>"""
        return f"""<!doctype html><html><head><meta charset="utf-8"><title>{title}</title>
<style>html,body{{margin:0;height:100%;background:#0b0d12;overflow:hidden}}
#wrap{{position:absolute;inset:0;display:grid;place-items:center}}
ruffle-player{{width:min(100vw,calc(100vh*{g['w']}/{g['h']}));height:min(100vh,calc(100vw*{g['h']}/{g['w']}));display:block;outline:0}}
</style></head><body><div id="wrap"><div id="p"></div></div>
<script src="/flash/ruffle/ruffle.js"></script>
<script>
window.RufflePlayer=window.RufflePlayer||{{}};
window.RufflePlayer.config={{autoplay:"on",unmuteOverlay:"hidden",letterbox:"on",backgroundColor:"#0b0d12",warnOnUnsupportedContent:false,showSwfDownload:false,quality:"high",contextMenu:"off",splashScreen:false,allowScriptAccess:false,logLevel:"error",scale:"showAll",base:"/flash/games/"}};
window.addEventListener("DOMContentLoaded",()=>{{const r=window.RufflePlayer.newest();const p=r.createPlayer();document.getElementById("p").appendChild(p);p.ruffle().load("/flash/games/{gid}.swf").catch(e=>{{document.body.innerHTML="<p style='color:#eee;font-family:sans-serif;padding:20px'>Não carregou: "+e+"</p>"}});
document.addEventListener("keydown",e=>{{if(e.key==="Escape")parent.postMessage("flash:close","*")}});}});
</script></body></html>"""
