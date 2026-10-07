from __future__ import annotations

import logging
import os
import re
import shutil
import struct
import tempfile
import zipfile
from pathlib import Path, PureWindowsPath

from . import paths
from .titles import normalize_title

log = logging.getLogger("ludrix.playnite")

PROGRESS = None
INCLUDE_HIDDEN = False
EXT_GUESS = None

ROM_EXTS = {".chd", ".iso", ".cue", ".bin", ".img", ".pbp", ".cso", ".z64", ".n64", ".v64", ".nds", ".gba", ".gb", ".gbc", ".sfc", ".smc",
            ".nes", ".md", ".gen", ".smd", ".gcm", ".rvz", ".wbfs", ".wad", ".gdi", ".cdi", ".xiso", ".xex", ".wua", ".wud", ".wux",
            ".rpx", ".nsp", ".xci", ".3ds", ".cci", ".sms", ".gg", ".pce", ".a26", ".zip", ".7z", ".conf"}


PLATFORMS = [
    ("sony_playstation2", "ps2"), ("playstation 2", "ps2"), ("ps2", "ps2"),
    ("sony_playstation3", "ps3"), ("playstation 3", "ps3"), ("ps3", "ps3"),
    ("sony_psp", "psp"), ("playstation portable", "psp"), ("psp", "psp"),
    ("sony_playstation", "ps1"), ("playstation", "ps1"), ("psx", "ps1"),
    ("nintendo_gamecube", "gc"), ("gamecube", "gc"),
    ("nintendo_wiiu", "wiiu"), ("wii u", "wiiu"),
    ("nintendo_wii", "wii"), ("wii", "wii"),
    ("nintendo_switch", "switch"), ("switch", "switch"),
    ("nintendo_64", "n64"), ("nintendo 64", "n64"), ("n64", "n64"),
    ("nintendo_gameboyadvance", "gba"), ("game boy advance", "gba"), ("gba", "gba"),
    ("nintendo_gameboycolor", "gba"), ("game boy color", "gba"), ("nintendo_gameboy", "gba"), ("game boy", "gba"),
    ("nintendo_super_nes", "snes"), ("super nintendo", "snes"), ("snes", "snes"), ("super nes", "snes"), ("super famicom", "snes"),
    ("nintendo_nes", "nes"), ("nintendo entertainment system", "nes"), ("nes", "nes"), ("famicom", "nes"),
    ("nintendo_3ds", "3ds"), ("3ds", "3ds"),
    ("nintendo_ds", "nds"), ("nintendo ds", "nds"), ("nds", "nds"),
    ("sega_genesis", "genesis"), ("genesis", "genesis"), ("mega drive", "genesis"), ("megadrive", "genesis"),
    ("sega_mastersystem", "sms"), ("master system", "sms"), ("sega_gamegear", "sms"), ("game gear", "sms"),
    ("sega_dreamcast", "dc"), ("dreamcast", "dc"),
    ("sega_saturn", "saturn"), ("saturn", "saturn"),
    ("xbox360", "x360"), ("xbox 360", "x360"),
    ("xbox", "xbox"),
    ("pc_dos", "dos"), ("ms-dos", "dos"), ("dos", "dos"),
    ("nec_turbografx_16", "pce"), ("turbografx", "pce"), ("pc engine", "pce"),
    ("atari_2600", "atari2600"), ("atari 2600", "atari2600"),
    ("arcade", "arcade"), ("mame", "arcade"), ("neo geo", "arcade"),
    ("pc_windows", "pc"), ("pc (windows)", "pc"), ("windows", "pc"), ("pc", "pc"),
]

EMULATORS = {"pcsx2": "pcsx2", "duckstation": "duckstation", "ppsspp": "ppsspp", "dolphin": "dolphin", "flycast": "flycast", "xemu": "xemu",
             "xenia": "xenia", "mgba": "mgba", "snes9x": "snes9x", "melonds": "melonds", "retroarch": "retroarch", "rpcs3": "rpcs3", "cemu": "cemu",
             "ryujinx": "eden", "ryubing": "eden", "yuzu": "eden", "sudachi": "eden", "suyu": "eden", "eden": "eden", "citron": "citron", "citra": "azahar", "azahar": "azahar", "lime3ds": "azahar", "mesen": "mesen", "ares": "ares",
             "mednafen": "mednafen", "mame": "mame", "stella": "stella", "dosbox": "dosbox", "simple64": "simple64", "redream": "redream",
             "project64": "rmg", "mupen64": "rmg", "rmg": "rmg", "rosalie": "rmg", "bsnes": "bsnes", "fceux": "fceux", "nestopia": "nestopia",
             "kega": "kega", "blastem": "blastem", "epsxe": "epsxe", "desmume": "desmume", "visualboy": "vbam", "vbam": "vbam"}

_ABS = re.compile(r"^([A-Za-z]:[\\/]|\\\\|/)")


_ACTION_TYPES = {"file": 0, "url": 1, "emulator": 2, "script": 3, "0": 0, "1": 1, "2": 2, "3": 3}
_PLUGIN_LAUNCH = {"00000002-dbd1-46c6-b5d0-b1ba559d10e4": "com.epicgames.launcher://apps/{id}?action=launch&silent=true",
                  "aebe8b7c-6dc3-4a66-af31-e7375c6b5e9e": "goggalaxy://openGameView/{id}",
                  "c2f038e5-8b92-4877-91f1-da9094155fc5": "uplay://launch/{id}/0",
                  "85dd7072-2f20-4e76-a007-41035e390724": "origin2://game/launch?offerIds={id}",
                  "e3c26a3d-d695-4cb7-a769-5ff7612c7edd": "battlenet://{id}",
                  "7e4fbb5e-2ae3-48d4-8ba0-6b30e7a4e287": "xbox",
                  "402674cd-4af6-4886-b6ec-0e695bfa0688": "amazon-games://play/{id}"}


def _abs(p: str) -> bool:
    return bool(p) and bool(_ABS.match(p))


def _join(base: str, p: str) -> str:
    if not p:
        return p
    if _abs(p) or not base:
        return p
    return os.path.join(base.rstrip("\\/"), p.lstrip("\\/"))


def sys_of(names) -> str:
    for n in names or []:
        k = str(n or "").strip().lower()
        if not k:
            continue
        for pk, sid in PLATFORMS:
            if pk == k:
                return sid
        toks = set(re.split(r"[^a-z0-9]+", k))
        for pk, sid in PLATFORMS:
            if len(pk) > 3 and pk in k:
                return sid
            if pk in toks and pk not in ("pc", "dos"):
                return sid
    return ""


def _pn_vars(v: str, inst: str) -> str:
    return v.replace("{InstallDir}", inst).replace("{PlayniteDir}", "").strip()


def _winpath(p: str) -> str:
    p = (p or "").strip()
    if not p:
        return p
    if p.startswith("\\\\"):
        return "\\\\" + re.sub(r"\\{2,}", r"\\", p[2:])
    return re.sub(r"\\{2,}", r"\\", p)


def _parent_name(p: str) -> str:
    return PureWindowsPath(p).parent.name if "\\" in p or re.match(r"^[A-Za-z]:", p) else Path(p).parent.name


def emu_of(name: str, exe: str = "") -> str:
    n = (name or "").lower()
    for k, v in EMULATORS.items():
        if k in n:
            return v
    e = Path(exe or "").stem.lower()
    for k, v in EMULATORS.items():
        if k in e:
            return v
    return ""


def litedb_docs(data: bytes):
    if len(data) < 4096 or data[4] != 1:
        raise ValueError("Esse arquivo não parece um backup do Playnite (ou está danificado)")
    if b"** This is a LiteDB file **" == data[25:52] and data[52] == 7:
        yield from _litedb4_docs(data)
    elif b"** This is a LiteDB file **" == data[32:59] and data[59] == 8:
        yield from _litedb5_docs(data)
    else:
        raise ValueError("Esse backup está num formato que o Ludrix ainda não conhece. Confira se é o .zip gerado em Playnite → Backup de dados")


def _litedb4_docs(data: bytes):
    PAGE = 4096
    total = len(data) // PAGE
    hdr = struct.Struct("<IBIIHH")

    def page(pid):
        return hdr.unpack_from(data, pid * PAGE)

    def extend_data(pid):
        parts, hops = [], 0
        while pid != 0xFFFFFFFF and pid < total and hops < 65536:
            _, typ, _, nxt, items, _ = page(pid)
            if typ != 5:
                break
            off = pid * PAGE + 25
            parts.append(data[off: off + min(items, PAGE - 25)])
            pid = nxt
            hops += 1
        return b"".join(parts)

    bad = 0
    for pid in range(total):
        if PROGRESS and pid % 8192 == 0:
            PROGRESS(f"Lendo banco… {pid * 100 // max(1, total)}%")
        _, typ, _, _, items, _ = page(pid)
        if typ != 4 or items == 0:
            continue
        pos = pid * PAGE + 25
        end = (pid + 1) * PAGE
        for _ in range(items):
            if pos + 8 > end:
                bad += 1
                break
            _idx, ext, ln = struct.unpack_from("<HIH", data, pos)
            pos += 8
            if pos + ln > end:
                bad += 1
                break
            doc = extend_data(ext) if ext != 0xFFFFFFFF else data[pos: pos + ln]
            pos += ln
            if len(doc) < 5:
                continue
            dl = struct.unpack_from("<i", doc, 0)[0]
            if dl < 5 or dl > len(doc):
                bad += 1
                continue
            try:
                yield bson(doc, 4, dl - 1)
            except Exception as ex:
                bad += 1
                log.debug("bson: %s", ex)
    if bad:
        log.warning("litedb4: %d bloco(s) ignorado(s)", bad)


def _litedb5_docs(data: bytes):
    PAGE = 8192
    n = len(data)
    segs = {}
    bad = 0
    total = n // PAGE
    for pid in range(total):
        off = pid * PAGE
        if PROGRESS and pid % 4096 == 0:
            PROGRESS(f"Lendo banco… {pid * 100 // max(1, total)}%")
        if data[off + 4] != 4:
            continue
        items, highest = data[off + 23], data[off + 30]
        if items == 0 or highest == 255:
            continue
        for idx in range(highest + 1):
            base = off + PAGE - (idx + 1) * 4
            ln, pos = struct.unpack_from("<HH", data, base)
            if pos == 0:
                continue
            if pos < 32 or ln < 7 or pos + ln > PAGE:
                bad += 1
                continue
            seg = data[off + pos: off + pos + ln]
            segs[(pid, idx)] = (bool(seg[0]), (struct.unpack_from("<I", seg, 1)[0], seg[5]), seg[6:])
    for key, (extend, nxt, buf) in segs.items():
        if extend:
            continue
        parts, hops = [buf], 0
        while nxt[0] != 0xFFFFFFFF and nxt in segs and hops < 8192:
            _, nxt2, b2 = segs[nxt]
            parts.append(b2)
            nxt = nxt2
            hops += 1
        doc = b"".join(parts)
        if len(doc) < 5:
            continue
        ln = struct.unpack_from("<i", doc, 0)[0]
        if ln < 5 or ln > len(doc):
            continue
        try:
            yield bson(doc, 4, ln - 1)
        except Exception as ex:
            bad += 1
            log.debug("bson: %s", ex)
            continue
    if bad:
        log.warning("litedb: %d segmento(s) ignorado(s)", bad)


def bson(b: bytes, pos: int, end: int, depth: int = 0) -> dict:
    out = {}
    if depth > 32:
        raise ValueError("depth")
    while pos < end:
        t = b[pos]
        pos += 1
        z = b.find(b"\x00", pos, end + 1)
        if z < 0 or z - pos > 512:
            raise ValueError("key")
        k = b[pos:z].decode("utf-8", "replace")
        pos = z + 1
        if t == 0x01:
            v = struct.unpack_from("<d", b, pos)[0]; pos += 8
        elif t == 0x02:
            ln = struct.unpack_from("<i", b, pos)[0]
            if ln < 1 or pos + 4 + ln > end + 1:
                raise ValueError("str")
            v = b[pos + 4:pos + 4 + ln - 1].decode("utf-8", "replace"); pos += 4 + ln
        elif t in (0x03, 0x04):
            ln = struct.unpack_from("<i", b, pos)[0]
            if ln < 5 or pos + ln > end + 1:
                raise ValueError("doc")
            sub = bson(b, pos + 4, pos + ln - 1, depth + 1)
            v = list(sub.values()) if t == 0x04 else sub
            pos += ln
        elif t == 0x05:
            ln = struct.unpack_from("<i", b, pos)[0]
            if ln < 0 or pos + 5 + ln > end + 1:
                raise ValueError("bin")
            sub = b[pos + 5:pos + 5 + ln]
            v = _guid(sub) if ln == 16 and b[pos + 4] == 4 else None
            pos += 5 + ln
        elif t == 0x07:
            v = b[pos:pos + 12].hex(); pos += 12
        elif t == 0x08:
            v = bool(b[pos]); pos += 1
        elif t == 0x09:
            v = struct.unpack_from("<q", b, pos)[0] / 1000; pos += 8
        elif t == 0x0A:
            v = None
        elif t == 0x10:
            v = struct.unpack_from("<i", b, pos)[0]; pos += 4
        elif t == 0x12:
            v = struct.unpack_from("<q", b, pos)[0]; pos += 8
        elif t == 0x13:
            v = None; pos += 16
        elif t == 0x11:
            v = None; pos += 8
        elif t in (0xFF, 0x7F, 0x06):
            v = None
        else:
            break
        out[k] = v
    return out


def _guid(b: bytes) -> str:
    if len(b) != 16:
        return ""
    a = b[3::-1] + b[5:3:-1] + b[7:5:-1] + b[8:]
    h = a.hex()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def _id(v) -> str:
    return str(v or "").lower()


class Source:

    def __init__(self, path: Path):
        self.path = path
        self.zip = None
        self.root = None
        self.tmp = Path(tempfile.mkdtemp(prefix="ludrix-pn-"))
        if path.is_file() and zipfile.is_zipfile(path):
            self.zip = zipfile.ZipFile(path)
            self.names = {n.replace("\\", "/").lower(): n for n in self.zip.namelist() if not n.endswith("/")}
            gdb = next((k for k in self.names if k.endswith("library/games.db")), None)
            if not gdb:
                raise ValueError("Esse .zip não tem library/games.db — use o backup gerado pelo Playnite (Arquivo → Backup de dados).")
            self.prefix = gdb[: -len("library/games.db")]
            self.files_dir = None
        else:
            root = path if path.is_dir() else path.parent
            cands = [root, root / "library", root.parent] if root.name.lower() == "library" else [root, root.parent]
            for c in cands:
                if (c / "library" / "games.db").exists():
                    self.root = c
                    break
                if (c / "games.db").exists():
                    self.root = c.parent
                    break
            if not self.root:
                zips = sorted(path.glob("*.zip"), key=lambda z: -z.stat().st_size) if path.is_dir() else []
                if zips:
                    raise _Redirect(zips[0])
                raise ValueError("library\\games.db não encontrado aqui. Selecione o .zip do backup do Playnite (Arquivo → Backup de dados) "
                                 "ou a pasta do Playnite (%AppData%\\Playnite / pasta portátil).")
            lf = self.root / "libraryfiles"
            self.files_dir = lf if lf.is_dir() else (self.root / "library" / "files")

    def close(self):
        if self.zip:
            self.zip.close()

    def db(self, name: str) -> bytes | None:
        if self.zip:
            k = f"{self.prefix}library/{name}".lower()
            real = self.names.get(k)
            return self.zip.read(real) if real else None
        f = self.root / "library" / name
        if not f.exists():
            return None
        try:
            return f.read_bytes()
        except PermissionError:

            dst = self.tmp / name
            try:
                shutil.copyfile(f, dst)
                return dst.read_bytes()
            except Exception as e:
                raise PermissionError(f"{name} está em uso — feche o Playnite e tente de novo (ou use o backup .zip). {e}")

    def cover(self, rel: str) -> str:
        rel = (rel or "").replace("\\", "/").strip("/")
        if not rel or rel.startswith(("http:", "https:")):
            return ""
        if _abs(rel):
            return rel if Path(rel).is_file() else ""
        if self.zip:
            for base in (f"{self.prefix}libraryfiles/", f"{self.prefix}library/files/"):
                real = self.names.get((base + rel).lower())
                if real:
                    out = paths.CACHE / "playnite_covers" / rel
                    out.parent.mkdir(parents=True, exist_ok=True)
                    if not out.exists():
                        out.write_bytes(self.zip.read(real))
                    return str(out)
            return ""
        p = self.files_dir / rel
        return str(p) if p.is_file() else ""


class _Redirect(Exception):
    def __init__(self, path: Path):
        self.path = path


def read(path: Path) -> list[dict]:
    try:
        src = Source(path)
    except _Redirect as r:
        src = Source(r.path)
    try:
        return _read(src)
    finally:
        src.close()


def _table(src: Source, name: str, what: str) -> dict:
    try:
        raw = src.db(name)
    except PermissionError as e:
        log.warning("%s: %s", name, e)
        return {}
    if not raw:
        return {}
    if PROGRESS:
        PROGRESS(f"Lendo {what}…")
    out = {}
    try:
        for d in litedb_docs(raw):
            if d.get("_id") is not None:
                out[_id(d["_id"])] = d
    except ValueError as e:
        log.warning("%s: %s", name, e)
    return out


def _read(src: Source) -> list[dict]:
    plats = {k: (v.get("Name") or "", v.get("SpecificationId") or "") for k, v in _table(src, "platforms.db", "plataformas").items()}
    comps = {k: v.get("Name") or "" for k, v in _table(src, "companies.db", "empresas").items()}
    genres = {k: v.get("Name") or "" for k, v in _table(src, "genres.db", "gêneros").items()}
    sources = {k: v.get("Name") or "" for k, v in _table(src, "sources.db", "fontes").items()}
    emus = _table(src, "emulators.db", "emuladores")
    scanners = _table(src, "scanners.db", "pastas de ROMs")

    def plat_names(ids) -> list[str]:
        out = []
        for i in ids or []:
            n, spec = plats.get(_id(i), ("", ""))
            out.extend([x for x in (spec, n) if x])
        return out

    items: list[dict] = []

    emu_info = {}
    for eid, e in emus.items():
        name = e.get("Name") or ""
        inst = e.get("InstallDir") or ""
        profiles = []
        for pr in e.get("CustomProfiles") or []:
            if isinstance(pr, dict):
                exe = (pr.get("Executable") or "").replace("{EmulatorDir}", inst)
                exe = _join(inst, exe) if exe and not _abs(exe) else exe
                profiles.append({"pid": _id(pr.get("Id")), "name": pr.get("Name") or "", "exe": exe, "args": pr.get("Arguments") or "",
                                 "systems": list(dict.fromkeys(s for s in (sys_of([p]) for p in plat_names(pr.get("Platforms"))) if s and s != "pc")), "kind": "custom"})
        for pr in e.get("BuiltinProfiles") or []:
            if isinstance(pr, dict):
                profiles.append({"pid": _id(pr.get("Id")), "name": pr.get("Name") or pr.get("BuiltInProfileName") or "", "exe": "", "args": "",
                                 "systems": [], "kind": "builtin", "builtin": pr.get("BuiltInProfileName") or ""})
        vid = emu_of(name, next((p["exe"] for p in profiles if p["exe"]), ""))
        first = None
        for pr in profiles:
            info = {"vid": vid or emu_of(pr.get("builtin", ""), pr["exe"]), "exe": pr["exe"], "args": pr["args"], "systems": pr["systems"], "name": name, "dir": inst}
            emu_info[(eid, pr["pid"])] = info
            first = first or info
            title = f"Emulador: {name}" + (f" ({pr['name']})" if pr["name"] and pr["name"].lower() not in ("default", "padrão", name.lower()) else "")
            items.append({"kind": "emulator", "title": title, "emulator": info["vid"], "exe": pr["exe"], "args": pr["args"], "systems": pr["systems"],
                          "system": pr["systems"][0] if pr["systems"] else "", "emu_dir": inst, "source": "playnite", "profile": pr["kind"]})
        if first:
            emu_info[(eid, "")] = first
        if not profiles and inst:
            emu_info[(eid, "")] = {"vid": vid, "exe": "", "args": "", "systems": [], "name": name, "dir": inst}
            items.append({"kind": "emulator", "title": f"Emulador: {name}", "emulator": vid, "exe": "", "args": "", "systems": [], "system": "", "emu_dir": inst, "source": "playnite", "profile": "builtin"})

    for sc in scanners.values():
        d = sc.get("Directory") or ""
        if not d:
            continue
        info = emu_info.get((_id(sc.get("EmulatorId")), _id(sc.get("EmulatorProfileId")))) or emu_info.get((_id(sc.get("EmulatorId")), ""))
        sid = (info or {}).get("systems", [None])[0] if info and info.get("systems") else ""
        sid = sid or sys_of([Path(d).name, sc.get("Name") or ""])
        items.append({"kind": "rom_dir", "title": f"Pasta de ROMs: {sc.get('Name') or Path(d).name}", "rom_dir": d, "system": sid or "", "source": "playnite",
                      "emulator": (info or {}).get("vid", "")})

    raw = src.db("games.db")
    if not raw:
        raise ValueError("games.db não encontrado")
    n = 0
    seen = set()
    stats = {"docs": 0, "hidden": 0, "no_path": 0, "missing": 0, "dup": 0}
    for g in litedb_docs(raw):
        stats["docs"] += 1
        name = g.get("Name")
        if not name or not isinstance(name, str):
            continue
        n += 1
        if PROGRESS and n % 200 == 0:
            PROGRESS(f"Jogos… {n}")
        if g.get("Hidden") and not INCLUDE_HIDDEN:
            stats["hidden"] += 1
            continue
        inst = g.get("InstallDirectory") or ""
        installed = bool(g.get("IsInstalled"))
        pnames = plat_names(g.get("PlatformIds"))
        sysid = sys_of(pnames) or ""
        roms = [(r.get("Path") or "") for r in (g.get("Roms") or []) if isinstance(r, dict)]
        acts = [a for a in (g.get("GameActions") or []) if isinstance(a, dict)]
        play = next((a for a in acts if a.get("IsPlayAction")), None) or (acts[0] if acts else None)
        exe = rom = None
        args = workdir = ""
        emu_id = emu_pid = ""
        if play:
            t = _ACTION_TYPES.get(str(play.get("Type")).strip().lower(), play.get("Type"))
            p = (play.get("Path") or "").replace("{InstallDir}", inst)
            if t == 2:
                emu_id, emu_pid = _id(play.get("EmulatorId")), _id(play.get("EmulatorProfileId"))
                rom = roms[0] if roms else (p or None)
            elif t == 1 and p:
                exe = p
            elif t in (0, None) and p:
                exe = _join(inst, p)
            if t != 2:
                args = _pn_vars(str(play.get("Arguments") or ""), inst)
                workdir = _pn_vars(str(play.get("WorkingDir") or ""), inst)
                workdir = _winpath(workdir) if workdir and "{" not in workdir else ""
                if "{" in args:
                    args = ""
        if roms and not rom and not exe:
            rom = roms[0]
        if rom:
            rom = rom.replace("{InstallDir}", inst).replace("{EmulatorDir}", (emu_info.get((emu_id, emu_pid)) or emu_info.get((emu_id, "")) or {}).get("dir", ""))
            rom = _winpath(_join(inst, rom))
        if exe:
            exe = _winpath(exe) if "://" not in exe else exe
        if exe and Path(exe).suffix.lower() in ROM_EXTS and (sysid and sysid != "pc"):
            rom, exe = exe, None
        info = emu_info.get((emu_id, emu_pid)) or emu_info.get((emu_id, "")) if emu_id else None
        if rom and not sysid and info and info.get("systems"):
            sysid = info["systems"][0]
        if rom and (not sysid or sysid == "pc"):
            sysid = sys_of([_parent_name(rom)]) or (EXT_GUESS(rom) if EXT_GUESS else "") or sysid
        if rom and Path(rom).suffix.lower() in (".exe", ".bat", ".lnk"):
            exe, rom = rom, None
        if not rom:
            sysid = "pc"
        if not (exe or rom or inst):
            stats["no_path"] += 1
            continue
        is_url = bool(exe) and "://" in exe
        exists = is_url or bool(rom and Path(rom).exists()) or bool(exe and Path(exe).exists()) or bool(not exe and not rom and inst and Path(inst).is_dir())
        if not installed and not exists:
            stats["missing"] += 1
            continue
        key = (name.lower(), (rom or exe or inst).lower())
        if key in seen:
            stats["dup"] += 1
            continue
        seen.add(key)
        steam_appid = ""
        if (exe or "").startswith("steam://"):
            m = re.search(r"(\d+)", exe)
            steam_appid = m.group(1) if m else ""
        elif _id(g.get("PluginId")) == "cb91dfc9-b977-43bf-8e70-55f46e410fab" and g.get("GameId"):
            steam_appid = str(g["GameId"])
            exe = exe or f"steam://rungameid/{steam_appid}"
        elif not exe and not rom and g.get("GameId") and _PLUGIN_LAUNCH.get(_id(g.get("PluginId")), "xbox") != "xbox":
            exe = _PLUGIN_LAUNCH[_id(g.get("PluginId"))].format(id=g["GameId"])
            exists = True
        pt = g.get("Playtime") or 0
        lp = g.get("LastActivity")
        year = ""
        rd = g.get("ReleaseDate")
        if isinstance(rd, dict):
            year = str(rd.get("Year") or rd.get("year") or "")[:4]
        elif isinstance(rd, (int, float)) and rd > 0:
            year = str(__import__("datetime").datetime.utcfromtimestamp(rd).year)
        elif isinstance(rd, str) and re.match(r"^\d{4}", rd):
            year = rd[:4]
        items.append({
            "title": re.sub(r"\s{2,}", " ", name).strip() or name, "orig_title": name, "exe": exe if not rom else None, "rom": rom, "system": sysid or "pc",
            "dir": inst, "playtime": float(pt if pt < 10**7 else pt / 1000), "last_played": float(lp) if isinstance(lp, (int, float)) else 0.0,
            "source": "playnite", "cover_file": src.cover(g.get("CoverImage") or ""), "background_file": src.cover(g.get("BackgroundImage") or ""),
            "icon_file": src.cover(g.get("Icon") or ""), "year": year, "favorite": bool(g.get("Favorite")), "steam_appid": steam_appid, "args": args if exe else "", "workdir": workdir if exe else "",
            "emulator": (info or {}).get("vid", ""), "emu_exe": (info or {}).get("exe", ""), "emu_args": (info or {}).get("args", ""),
            "platforms": pnames[:3], "developers": [comps.get(_id(i), "") for i in (g.get("DeveloperIds") or [])][:2],
            "genres": [genres.get(_id(i), "") for i in (g.get("GenreIds") or [])][:3], "pn_source": sources.get(_id(g.get("SourceId")), ""),
            "description": re.sub(r"<[^>]+>", "", g.get("Description") or "")[:1500], "missing": not exists,
            "links": [{"name": str(l.get("Name") or "")[:40], "url": str(l.get("Url") or "")} for l in (g.get("Links") or []) if isinstance(l, dict) and str(l.get("Url") or "").startswith("http")][:8],
            "notes": str(g.get("Notes") or "")[:2000], "hidden": bool(g.get("Hidden")), "play_count": int(g.get("PlayCount") or 0),
        })
    if PROGRESS:
        PROGRESS(f"Pronto: {len(items)} itens")
    games_out = [i for i in items if not i.get("kind")]
    if not games_out:
        if stats["docs"] == 0:
            raise ValueError("games.db foi aberto mas não consegui ler nenhum registro dele. Isso indica um formato que não reconheço — "
                             "me mande esse arquivo (library\\games.db do backup) que eu corrijo o leitor.")
        raise ValueError(f"Li {stats['docs']} jogo(s) no games.db, mas nenhum sobrou pra importar: {stats['hidden']} oculto(s), "
                         f"{stats['no_path']} sem pasta/arquivo (só catálogo), {stats['missing']} não instalado(s) com caminho inexistente, "
                         f"{stats['dup']} repetido(s). Se você tem jogos instalados no Playnite, esse backup não é o da biblioteca atual.")
    log.info("playnite: %s → %d itens", stats, len(items))
    return items
