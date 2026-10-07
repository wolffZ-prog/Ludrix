from __future__ import annotations

import base64
import hashlib
import html
import json
import logging
import re
import struct
import ipaddress
import time
from dataclasses import dataclass, field
from urllib.parse import unquote, urlparse, parse_qs

import requests

log = logging.getLogger("ludrix.hosts")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"


class Session(requests.Session):
    timeout = (15, 120)

    def request(self, method, url, **kw):
        kw.setdefault("timeout", self.timeout)
        return super().request(method, url, **kw)


def _is_blocked_host(host: str) -> bool:
    h = (host or "").lower().strip().strip("[]")
    if not h or h in ("localhost", "localhost.localdomain", "0.0.0.0", "::", "::1") or h.endswith((".localhost", ".local", ".internal", ".lan", ".home", ".corp")):
        return True
    try:
        ip = ipaddress.ip_address(h)
        return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified
    except ValueError:
        return False


@dataclass
class Resolved:
    url: str
    name: str
    size: int = 0
    headers: dict = field(default_factory=dict)
    cookies: dict = field(default_factory=dict)
    decrypt: object = None
    host: str = ""
    note: str = ""
    lazy: bool = False


class HostError(RuntimeError):
    pass


def host_of(url: str) -> str:
    m = re.match(r"https?://([^/:?#]+)", url or "", re.I)
    return (m.group(1) if m else "").lower().removeprefix("www.")


def _num_size(s: str) -> int:
    m = re.search(r"([\d.,]+)\s*([KMGT]?)i?B", s or "", re.I)
    if not m:
        return 0
    n = float(m.group(1).replace(",", "."))
    return int(n * {"": 1, "K": 1024, "M": 1024 ** 2, "G": 1024 ** 3, "T": 1024 ** 4}[m.group(2).upper()])


def _name_from_headers(r: requests.Response, fallback: str) -> str:
    cd = r.headers.get("content-disposition", "")
    m = re.search(r"filename\*=(?:UTF-8'')?([^;]+)", cd, re.I) or re.search(r'filename="?([^";]+)"?', cd, re.I)
    if m:
        return unquote(m.group(1).strip().strip('"'))
    p = unquote(urlparse(r.url).path.rsplit("/", 1)[-1])
    return p if "." in p else fallback


GD_ID_RE = re.compile(r"(?:/file/d/|/uc\?[^#]*id=|/open\?[^#]*id=|/d/|[?&]id=)([A-Za-z0-9_-]{20,})")


def _gdrive(url: str, s: requests.Session) -> Resolved:
    m = GD_ID_RE.search(url)
    if not m:
        raise HostError("Link do Google Drive sem id de arquivo (pastas não são suportadas — compartilhe o arquivo)")
    fid = m.group(1)
    r = s.get("https://drive.google.com/uc", params={"export": "download", "id": fid}, timeout=(15, 60), stream=True)
    ct = r.headers.get("content-type", "")
    if "text/html" not in ct:
        name = _name_from_headers(r, fid)
        size = int(r.headers.get("content-length") or 0)
        r.close()
        return Resolved(r.url, name, size, host="Google Drive")
    page = r.text
    r.close()

    form = re.search(r'<form[^>]+action="([^"]+)"(.*?)</form>', page, re.S)
    if form and "download" in form.group(1):
        params = dict(re.findall(r'name="(\w+)" value="([^"]*)"', form.group(2)))
        nm = re.search(r'<span class="uc-name-size"><a[^>]*>([^<]+)</a>\s*\(([^)]+)\)', page)
        r2 = s.get(html.unescape(form.group(1)), params=params, timeout=(15, 60), stream=True)
        if "text/html" in r2.headers.get("content-type", ""):
            r2.close()
            raise HostError("O Google Drive não liberou o arquivo (cota de download excedida ou pede login)")
        name = _name_from_headers(r2, nm.group(1) if nm else fid)
        size = int(r2.headers.get("content-length") or 0) or (_num_size(nm.group(2)) if nm else 0)
        r2.close()
        return Resolved(r2.url, name, size, host="Google Drive")
    if "Quota exceeded" in page or "quota" in page.lower():
        raise HostError("Google Drive: cota de download desse arquivo excedida — tente mais tarde")
    if "accounts.google.com" in page or "Sign in" in page:
        raise HostError("Google Drive: o arquivo não é público (pede login)")
    raise HostError("Google Drive: não achei o link de download nessa página")


GOFILE_SALT = "12af056dacea0b"
_gofile_tok: dict = {}


def _gofile_token(s: requests.Session) -> str:
    if _gofile_tok.get("t") and time.time() - _gofile_tok.get("at", 0) < 6 * 3600:
        return _gofile_tok["t"]
    for i in range(3):
        j = s.post("https://api.gofile.io/accounts", timeout=20).json()
        tok = (j.get("data") or {}).get("token")
        if tok:
            _gofile_tok.update(t=tok, at=time.time())
            return tok
        if j.get("status") == "error-rateLimit":
            time.sleep(4 + i * 4)
            continue
        break
    raise HostError("Gofile não deu um token de convidado (limite de tentativas) — tente de novo em 1 minuto")


def _gofile_wt(tok: str, off: int = 0) -> str:
    w = int(time.time() // 14400) + off
    return hashlib.sha256(f"{UA}::en-US::{tok}::{w}::{GOFILE_SALT}".encode()).hexdigest()


def gofile_list(url: str, s: requests.Session) -> list[Resolved]:
    m = re.search(r"gofile\.io/(?:d|f)/([A-Za-z0-9]+)", url)
    if not m:
        raise HostError("Link do Gofile inválido (esperava gofile.io/d/<código>)")
    code = m.group(1)
    tok = _gofile_token(s)
    params = {"contentFilter": "", "page": 1, "pageSize": 1000, "sortField": "createTime", "sortDirection": -1}
    pw = parse_qs(urlparse(url).query).get("password", [""])[0]
    if pw:
        params["password"] = hashlib.sha256(pw.encode()).hexdigest()
    data = None
    for off in (0, -1):
        r = s.get(f"https://api.gofile.io/contents/{code}", params=params, timeout=30,
                  headers={"Authorization": "Bearer " + tok, "X-Website-Token": _gofile_wt(tok, off), "X-BL": "en-US", "User-Agent": UA})
        j = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        st = j.get("status")
        if st == "ok":
            data = j["data"]
            break
        if st == "error-rateLimit":
            time.sleep(5)
            continue
        if st == "error-passwordRequired":
            raise HostError("Essa pasta do Gofile pede senha — adicione ?password=SENHA ao final do link")
        if st in ("error-notFound", "error-notPublic"):
            raise HostError("Gofile: arquivo removido, expirado ou não público")
    if not data:
        raise HostError("Gofile recusou o acesso (o site mudou o token do navegador ou está limitando) — abra no navegador")
    out = []
    items = list((data.get("children") or {}).values()) if data.get("type") == "folder" else [data]
    for it in items:
        if it.get("type") != "file" or not it.get("link"):
            continue
        out.append(Resolved(it["link"], it.get("name") or code, int(it.get("size") or 0), cookies={"accountToken": tok},
                            headers={"User-Agent": UA}, host="Gofile"))
    if not out:
        raise HostError("Gofile: a pasta está vazia (ou só tem subpastas)")
    return out


def _b64d(s: str) -> bytes:
    s = s.replace("-", "+").replace("_", "/")
    return base64.b64decode(s + "=" * (-len(s) % 4))


def _a32(b: bytes) -> list[int]:
    return list(struct.unpack(">%dI" % (len(b) // 4), b[: len(b) // 4 * 4]))


def _mega_api(s: requests.Session, req: dict, **params) -> object:
    q = {"id": int(time.time() * 1000) % 1_000_000, **params}
    for i in range(4):
        r = s.post("https://g.api.mega.co.nz/cs", params=q, json=[req], timeout=30)
        try:
            j = r.json()
        except ValueError:
            j = None
        if isinstance(j, list) and j:
            res = j[0]
            if isinstance(res, int) and res == -3:
                time.sleep(1 + i)
                continue
            return res
        time.sleep(1 + i)
    raise HostError("MEGA não respondeu")


def _mega_keys(key: list[int]) -> tuple[bytes, bytes]:
    if len(key) >= 8:
        k = [key[0] ^ key[4], key[1] ^ key[5], key[2] ^ key[6], key[3] ^ key[7]]
        iv = struct.pack(">2I", key[4], key[5])
    else:
        k, iv = key[:4], b"\0" * 8
    return struct.pack(">4I", *k), iv


def _mega_attr(attr_b64: str, aes_key: bytes) -> dict:
    from Cryptodome.Cipher import AES
    raw = AES.new(aes_key, AES.MODE_CBC, b"\0" * 16).decrypt(_b64d(attr_b64))
    raw = raw.rstrip(b"\0")
    if not raw.startswith(b"MEGA"):
        return {}
    try:
        return json.loads(raw[4:].decode("utf-8", "replace"))
    except ValueError:
        return {}


def _mega_decryptor(aes_key: bytes, iv8: bytes):
    from Cryptodome.Cipher import AES
    from Cryptodome.Util import Counter

    def make(offset: int):
        ctr = Counter.new(64, prefix=iv8, initial_value=offset // 16)
        c = AES.new(aes_key, AES.MODE_CTR, counter=ctr)
        skip = offset % 16
        if skip:
            c.decrypt(b"\0" * skip)
        return c.decrypt
    return make


def mega_list(url: str, s: requests.Session) -> list[Resolved]:
    u = url.replace("#!", "/file/").replace("#F!", "/folder/")
    u = re.sub(r"/file/([^!#/]+)!", r"/file/\1#", u)
    u = re.sub(r"/folder/([^!#/]+)!", r"/folder/\1#", u)
    m = re.search(r"mega(?:\.co)?\.nz/(file|folder)/([A-Za-z0-9_-]+)#([A-Za-z0-9_-]+)(?:/file/([A-Za-z0-9_-]+))?", u)
    if not m:
        raise HostError("Link do MEGA sem a chave (precisa ser o link completo, com a parte depois do #)")
    kind, hid, keyb64, sub = m.groups()
    if kind == "file":
        res = _mega_api(s, {"a": "g", "g": 1, "p": hid})
        if isinstance(res, int):
            raise HostError({-9: "MEGA: arquivo não existe mais", -16: "MEGA: arquivo bloqueado", -18: "MEGA: arquivo temporariamente indisponível"}.get(res, f"MEGA erro {res}"))
        key = _a32(_b64d(keyb64))
        aes, iv = _mega_keys(key)
        at = _mega_attr(res.get("at", ""), aes)
        return [Resolved(res["g"], at.get("n") or hid, int(res.get("s") or 0), decrypt=_mega_decryptor(aes, iv), host="MEGA")]

    from Cryptodome.Cipher import AES
    fkey = struct.pack(">4I", *_a32(_b64d(keyb64))[:4])
    tree = _mega_api(s, {"a": "f", "c": 1, "r": 1, "ca": 1}, n=hid)
    if isinstance(tree, int):
        raise HostError("MEGA: pasta não existe mais ou é privada")
    out = []
    for node in tree.get("f", []):
        if node.get("t") != 0:
            continue
        if sub and node.get("h") != sub:
            continue
        k = node.get("k", "")
        if ":" not in k:
            continue
        enc = _b64d(k.split(":", 1)[1])
        try:
            dec = AES.new(fkey, AES.MODE_ECB).decrypt(enc)
        except Exception:
            continue
        key = _a32(dec)
        aes, iv = _mega_keys(key)
        at = _mega_attr(node.get("a") or node.get("at") or "", aes)
        out.append(Resolved("", at.get("n") or node["h"], int(node.get("s") or 0), decrypt=_mega_decryptor(aes, iv), host="MEGA",
                            note=json.dumps({"n": hid, "h": node["h"]})))
    if not out:
        raise HostError("MEGA: nenhum arquivo nessa pasta")
    return out


def mega_folder_link(res: Resolved, s: requests.Session) -> str:
    info = json.loads(res.note)
    g = _mega_api(s, {"a": "g", "g": 1, "n": info["h"]}, n=info["n"])
    if isinstance(g, int) or not g.get("g"):
        raise HostError("MEGA não liberou o link desse arquivo (cota de transferência?)")
    return g["g"]


def _mediafire(url: str, s: requests.Session) -> Resolved:
    r = s.get(url, timeout=(15, 60))
    t = r.text
    if r.status_code == 404 or "File Removed" in t or "Permission Denied" in t:
        raise HostError("MediaFire: arquivo removido ou privado")
    m = re.search(r'href="(https://download\d+\.mediafire\.com/[^"]+)"', t)
    if not m:
        sc = re.search(r'data-scrambled-url="([^"]+)"', t)
        if sc:
            m = re.match(r"(.*)", base64.b64decode(sc.group(1)).decode("utf-8", "replace"))
    if not m:
        raise HostError("MediaFire: não achei o botão de download (captcha ou página mudou)")
    name = re.search(r'<div class="filename">([^<]+)', t)
    size = re.search(r'\(([\d.,]+\s*[KMGT]?B)\)', t)
    return Resolved(html.unescape(m.group(1)), html.unescape(name.group(1).strip()) if name else "arquivo", _num_size(size.group(1)) if size else 0, host="MediaFire")


def _pixeldrain(url: str, s: requests.Session) -> list[Resolved]:
    m = re.search(r"pixeldrain\.com/(u|l|api/file)/([A-Za-z0-9]+)", url)
    if not m:
        raise HostError("Link do Pixeldrain inválido")
    kind, pid = m.groups()
    if kind == "l":
        j = s.get(f"https://pixeldrain.com/api/list/{pid}", timeout=30).json()
        files = j.get("files") or []
        if not files:
            raise HostError("Pixeldrain: lista vazia ou removida")
        return [Resolved(f"https://pixeldrain.com/api/file/{f['id']}?download", f.get("name") or f["id"], int(f.get("size") or 0), host="Pixeldrain") for f in files]
    j = s.get(f"https://pixeldrain.com/api/file/{pid}/info", timeout=30).json()
    if not j.get("success", True) and j.get("value"):
        raise HostError("Pixeldrain: arquivo não encontrado")
    return [Resolved(f"https://pixeldrain.com/api/file/{pid}?download", j.get("name") or pid, int(j.get("size") or 0), host="Pixeldrain")]


def _1fichier(url: str, s: requests.Session) -> Resolved:
    r = s.get(url, timeout=(15, 60))
    t = r.text
    if "Le fichier demandé n'existe pas" in t or "The requested file could not be found" in t:
        raise HostError("1fichier: arquivo não existe mais")
    adz = re.search(r'name="adz"\s+value="([^"]+)"', t)
    if not adz:
        raise HostError("1fichier: página sem o formulário de download (pede espera/premium) — abra no navegador")
    r2 = s.post(url, data={"submit": "Download", "adz": adz.group(1)}, timeout=(15, 60))
    m = re.search(r'href="(https://[^"]*1fichier\.com/[^"]+)"[^>]*>\s*Click here to download', r2.text) or \
        re.search(r'<a[^>]+href="(https://[a-z0-9-]+\.1fichier\.com/[^"]+)"', r2.text)
    if not m:
        wait = re.search(r"You must wait (\d+) minutes", r2.text)
        raise HostError(f"1fichier pede espera de {wait.group(1)} min entre downloads grátis" if wait else "1fichier não liberou o link (limite grátis) — abra no navegador")
    name = re.search(r'<td class="normal">([^<]+\.\w{2,4})</td>', t)
    size = re.search(r'<td class="normal">([\d.,]+\s*[KMG]B)</td>', t)
    return Resolved(m.group(1), html.unescape(name.group(1).strip()) if name else "arquivo", _num_size(size.group(1)) if size else 0, host="1fichier")


def _dropbox(url: str, s: requests.Session) -> Resolved:
    u = re.sub(r"[?&]dl=\d", "", url)
    u += ("&" if "?" in u else "?") + "dl=1"
    return _direct(u, s, "Dropbox")


def _buzzheavier(url: str, s: requests.Session) -> Resolved:
    m = re.search(r"buzzheavier\.com/([A-Za-z0-9]+)", url)
    if not m:
        raise HostError("Link do buzzheavier inválido")
    r = s.get(f"https://buzzheavier.com/{m.group(1)}/download", headers={"HX-Request": "true", "Referer": url}, timeout=30, allow_redirects=False)
    loc = r.headers.get("HX-Redirect") or r.headers.get("Location")
    if not loc:
        raise HostError("buzzheavier não deu o link")
    if loc.startswith("/"):
        loc = "https://buzzheavier.com" + loc
    return _direct(loc, s, "buzzheavier")


def _qiwi(url: str, s: requests.Session) -> Resolved:
    m = re.search(r"qiwi\.gg/(?:file|folder)/([A-Za-z0-9]+)", url)
    if not m:
        raise HostError("Link do qiwi inválido")
    r = s.get(url, timeout=30)
    name = re.search(r"<title>([^<]+)</title>", r.text)
    ext = re.search(r"\.(\w{2,4})\s*[-|]", name.group(1)) if name else None
    fn = (name.group(1).split(" - ")[0].strip() if name else m.group(1))
    return _direct(f"https://spyderrock.com/{m.group(1)}.{ext.group(1) if ext else 'zip'}", s, "qiwi", fn)


ITCH_RE = re.compile(r"https?://([a-z0-9-]+)\.itch\.io/([a-z0-9-]+)", re.I)


def itch_list(url: str, s: requests.Session) -> list[Resolved]:
    m = ITCH_RE.match(url)
    if not m:
        raise HostError("itch.io: link precisa ser a página do jogo (usuario.itch.io/jogo)")
    base = f"https://{m.group(1)}.itch.io/{m.group(2)}"
    want = re.search(r"(?:[#?&]upload=|#)(\d+)", url)
    plat = (re.search(r"[#?&]os=(windows|mac|linux|android)", url, re.I) or [None, ""])[1].lower()
    r = s.get(base, timeout=(15, 60))
    if r.status_code == 404:
        raise HostError("itch.io: página não encontrada")
    csrf = s.cookies.get("itchio_token", domain=f"{m.group(1)}.itch.io") or s.cookies.get("itchio_token") or ""
    if not csrf:
        raise HostError("itch.io: o site não devolveu o token da página")
    r = s.post(f"{base}/download_url", data={"csrf_token": csrf}, timeout=(15, 60))
    j = r.json() if r.ok else {}
    if not j.get("url"):
        raise HostError("itch.io: esse jogo não libera download gratuito" if r.status_code in (400, 403) else f"itch.io respondeu HTTP {r.status_code}")
    t = s.get(j["url"], timeout=(15, 60)).text
    out = []
    for blk in re.split(r'<div class="upload">', t)[1:]:
        uid = re.search(r'data-upload_id="(\d+)"', blk)
        if not uid:
            continue
        name = re.search(r'<strong title="([^"]*)" class="name"', blk)
        size = re.search(r'class="file_size"><span>([^<]+)', blk)
        icons = re.findall(r"icon-(windows8|apple|tux|android)", blk)
        ver = re.search(r'version_name">([^<]+)', blk)
        osn = {"windows8": "windows", "apple": "mac", "tux": "linux", "android": "android"}
        oses = [osn[i] for i in icons]
        out.append(Resolved(f"{base}/file/{uid.group(1)}?source=game_download", html.unescape(name.group(1)).strip() if name else f"upload {uid.group(1)}",
                            _num_size(size.group(1)) if size else 0, headers={"X-Itch-Csrf": csrf}, host="itch.io", lazy=True, note=" ".join(oses) + ((" · " + ver.group(1).strip()) if ver else "")))
    if not out:
        raise HostError("itch.io: não achei arquivos nessa página")
    if want:
        pick = [o for o in out if o.url.split("/file/")[1].split("?")[0] == want.group(1)]
        if pick:
            return pick
    if plat:
        pick = [o for o in out if plat in o.note]
        if pick:
            return pick
    if len(out) > 1 and not want:
        win = [o for o in out if "windows" in o.note]
        if win:
            return win
    return out


def itch_final(res: Resolved, s: requests.Session) -> Resolved:
    csrf = (res.headers or {}).get("X-Itch-Csrf", "")
    r = s.post(res.url, data={"csrf_token": csrf}, timeout=(15, 60))
    j = r.json() if r.ok else {}
    if not j.get("url"):
        raise HostError(f"itch.io não liberou o arquivo (HTTP {r.status_code})")
    fin = _direct(j["url"], s, host="itch.io", name=res.name)
    fin.note = res.note
    return fin


def _direct(url: str, s: requests.Session, host: str = "", name: str = "") -> Resolved:
    r = s.get(url, stream=True, timeout=(15, 60), allow_redirects=True)
    ct = r.headers.get("content-type", "").split(";")[0].strip().lower()
    if r.status_code >= 400:
        r.close()
        raise HostError(f"O servidor respondeu HTTP {r.status_code}")
    if ct in ("text/html", "application/xhtml+xml"):
        r.close()
        raise HostError("Esse link abre uma página, não um arquivo — o Ludrix não conhece esse site pra achar o botão de download")
    nm = _name_from_headers(r, name or "arquivo")
    size = int(r.headers.get("content-length") or 0)
    r.close()
    return Resolved(r.url, nm, size, host=host or host_of(url))


KNOWN = (
    ("drive.google.com", "Google Drive"), ("docs.google.com", "Google Drive"), ("gofile.io", "Gofile"), ("mega.nz", "MEGA"), ("mega.co.nz", "MEGA"),
    ("mediafire.com", "MediaFire"), ("pixeldrain.com", "Pixeldrain"), ("1fichier.com", "1fichier"), ("dropbox.com", "Dropbox"),
    ("buzzheavier.com", "buzzheavier"), ("qiwi.gg", "qiwi"), ("files.catbox.moe", "catbox"), ("itch.io", "itch.io"),
)


def known_host(url: str) -> str:
    h = host_of(url)
    for dom, name in KNOWN:
        if h == dom or h.endswith("." + dom):
            return name
    return ""


def resolve(url: str, s: requests.Session | None = None) -> list[Resolved]:
    s = s or Session()
    s.headers.setdefault("User-Agent", UA)
    url = (url or "").strip()
    if not re.match(r"https?://", url, re.I):
        raise HostError("Isso não é um link http(s)")
    h = host_of(url)
    if _is_blocked_host(h):
        raise HostError(f"Host bloqueado por segurança: {h}")
    try:
        if h.endswith("google.com"):
            return [_gdrive(url, s)]
        if h.endswith("gofile.io"):
            return gofile_list(url, s)
        if h.endswith("mega.nz") or h.endswith("mega.co.nz"):
            return mega_list(url, s)
        if h.endswith("mediafire.com"):
            return [_mediafire(url, s)]
        if h.endswith("pixeldrain.com"):
            return _pixeldrain(url, s)
        if h.endswith("1fichier.com"):
            return [_1fichier(url, s)]
        if h.endswith("dropbox.com"):
            return [_dropbox(url, s)]
        if h.endswith("buzzheavier.com"):
            return [_buzzheavier(url, s)]
        if h.endswith("qiwi.gg"):
            return [_qiwi(url, s)]
        if h.endswith(".itch.io"):
            return itch_list(url, s)
        return [_direct(url, s)]
    except HostError:
        raise
    except requests.RequestException as e:
        raise HostError(f"Sem resposta de {h} ({e.__class__.__name__})")
    except Exception as e:
        log.exception("hosts.resolve %s", url)
        raise HostError(f"{known_host(url) or h}: o site mudou e não consegui achar o arquivo ({e.__class__.__name__})")
