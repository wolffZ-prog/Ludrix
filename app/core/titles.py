from __future__ import annotations

import re
from difflib import SequenceMatcher
from pathlib import Path


_SHORTCUT = re.compile(
    r"^(atalho (para|de|do|da)|shortcut to|acceso directo a|lien vers|verkn[üu]pfung mit|play|launch|jogar|iniciar|run|start|abrir|open)\s+"
    r"|\s*[-–—]?\s*(atalho|shortcut|acceso directo|verkn[üu]pfung|lnk)\s*$",
    re.I)

_JUNK = re.compile(
    r"\b(x64|x86|win64|win32|dx1[12]|dx9|vulkan|shipping|launcher|setup|install(er)?|repack|reupload|multi ?\d+|"
    r"fitgirl|dodi|elamigos|goldberg|steamrip|online-fix|"
    r"build\s*\d+|update\s*\d+(\.\d+)*|v\s*\d+(\.\d+)+[a-z]?|\d+\s*dlcs?|all dlcs?|dlcs? included|bonus content|"
    r"pt-?br|dublado|legendado|traduzido|crack(ed)?|iso|torrent|"
    r"rohankar'?s?|recompiled|recomp)\b",
    re.I)

_GROUPS = re.compile(r"\b(CODEX|PLAZA|SKIDROW|RELOADED|CPY|EMPRESS|RUNE|TENOKE|FLT|DODI|GOG|HOODLUM|DARKSiDERS|TiNYiSO|PROPHET|RAZOR1911|P2P|DOGE)\b")
_PAREN = re.compile(r"\s*[\(\[\{].*?[\)\]\}]")
_ROMAN = re.compile(r"^(i{1,3}|iv|v|vi{1,3}|ix|x{1,3}|xi{1,3}|xiv|xv|xvi{1,3}|xix|xx)$", re.I)
_SMALL = {"a", "an", "the", "of", "and", "or", "for", "to", "in", "on", "at", "by", "vs", "de", "do", "da", "dos", "das", "e", "em", "no", "na", "com", "para", "of the"}
_KEEP_UPPER = {"GOTY", "II", "III", "IV", "VI", "VII", "VIII", "IX", "XIII", "XIV", "XV", "XVI", "HD", "3D", "2D", "4K", "VR", "GT", "GTA", "NFS", "PES", "FIFA", "NBA", "NHL", "NFL", "MLB", "UFC", "WWE", "F1", "DOOM", "FEAR", "LEGO", "SSX", "XIII", "DMC", "MGS", "RE", "TES", "USA", "UK", "DC", "CD", "DX", "HL", "TF", "CS", "GO", "DS", "SD", "PSP", "PS", "AI", "FF", "KH", "GB", "GBA"}
_ABBR = {
    "gta": "Grand Theft Auto", "nfs": "Need for Speed", "cod": "Call of Duty", "pes": "Pro Evolution Soccer",
    "mgs": "Metal Gear Solid", "dmc": "Devil May Cry", "tlou": "The Last of Us", "rdr": "Red Dead Redemption",
    "sotc": "Shadow of the Colossus", "botw": "The Legend of Zelda: Breath of the Wild", "totk": "The Legend of Zelda: Tears of the Kingdom",
    "ffvii": "Final Fantasy VII", "ffx": "Final Fantasy X", "re4": "Resident Evil 4", "re2": "Resident Evil 2", "re3": "Resident Evil 3",
    "hl2": "Half-Life 2", "csgo": "Counter-Strike: Global Offensive", "cs2": "Counter-Strike 2", "tf2": "Team Fortress 2",
    "l4d2": "Left 4 Dead 2", "acnh": "Animal Crossing: New Horizons", "smb": "Super Mario Bros.", "smw": "Super Mario World",
    "ssbm": "Super Smash Bros. Melee", "ssbu": "Super Smash Bros. Ultimate", "mk11": "Mortal Kombat 11", "mkx": "Mortal Kombat X",
    "sf6": "Street Fighter 6", "sfv": "Street Fighter V", "kh2": "Kingdom Hearts II", "gow": "God of War", "ac": "Assassin's Creed",
    "bf1": "Battlefield 1", "bf4": "Battlefield 4", "bfv": "Battlefield V", "ds3": "Dark Souls III", "ds2": "Dark Souls II",
    "poe": "Path of Exile", "wow": "World of Warcraft", "lol": "League of Legends", "pubg": "PUBG: Battlegrounds",
}
_DOT = re.compile(r"(?<=[A-Za-z]{2})\.(?=[A-Za-z0-9])|(?<=[A-Za-z0-9])\.(?=[A-Za-z]{2})")
_COMMA_THE = re.compile(r"^(.+?), (The|A|An|La|Le|Les|El|Los|Der|Die|Das)( - |: | )", re.I)


_CAMEL_OK = {"bioshock", "starcraft", "warcraft", "dirt", "nier", "wipeout", "rollercoaster", "simcity", "timesplitters", "dmc", "motogp",
             "littlebigplanet", "soulcalibur", "blazblue", "mechwarrior", "goldeneye", "pixeljunk", "rimworld", "towerfall", "trackmania",
             "locoroco", "warioware", "parappa", "ducktales", "earthbound", "starfox", "yoshi", "minecraft", "overwatch", "playerunknown",
             "deathloop", "titanfall", "everquest", "runescape", "hearthstone", "counterstrike", "wolfenstein", "battletoads", "megaman",
             "darksiders", "dishonored", "borderlands", "mafia", "iracing", "supertux", "openttd", "openra", "gtav", "gtaiv", "outrun", "starwars"}


def _camel_split(t: str) -> str:
    out = []
    for w in t.split(" "):
        if re.sub(r"\d+$", "", w).lower() in _CAMEL_OK:
            w = re.sub(r"([A-Za-z]{3,})(\d)", r"\1 \2", w)
            out.append(w)
            continue
        if len(w) >= 5 and re.search(r"[a-z][A-Z]", w) and not w.isupper():
            w = re.sub(r"([a-z])([A-Z])", r"\1 \2", w)
        w = re.sub(r"([A-Za-z]{3,})(\d)", r"\1 \2", w)
        w = re.sub(r"(\d)([A-Z][a-z]{2,})", r"\1 \2", w)
        out.append(w)
    return " ".join(out)


def _title_case(t: str) -> str:
    words = t.split(" ")
    out = []
    for i, w in enumerate(words):
        if not w:
            continue
        up = w.upper()
        if up in _KEEP_UPPER or _ROMAN.match(w):
            out.append(up)
        elif i and w.lower() in _SMALL:
            out.append(w.lower())
        elif w.isupper() and len(w) > 4:
            out.append(w.capitalize())
        elif w.islower():
            out.append(w[:1].upper() + w[1:])
        else:
            out.append(w)
    return " ".join(out)


def normalize_title(raw: str, *, keep_tags: bool = False) -> str:
    t = (raw or "").strip()
    if not t:
        return ""

    if re.search(r"\.(lnk|exe|url|bat|cmd|iso|chd|cue|bin|zip|7z|rar|json)$", t, re.I):
        t = t.rsplit(".", 1)[0]
    t = _SHORTCUT.sub("", t).strip()
    t = _SHORTCUT.sub("", t).strip()
    if not keep_tags:
        t = _PAREN.sub("", t)
    t = t.replace("_", " ")
    t = _DOT.sub(" ", t)
    if " " not in t.strip():
        t = _camel_split(t)
    t = _COMMA_THE.sub(lambda m: f"{m.group(2)} {m.group(1)}{m.group(3)}", t)
    t = t.replace("™", "").replace("®", "").replace("©", "")

    if " " not in t.strip() and t.count("-") >= 1:
        t = t.replace("-", " ")
    t = re.sub(r"\s+-\s*(codex|plaza|skidrow|reloaded|cpy|empress|rune|tenoke|flt|dodi|fitgirl|elamigos|gog)\b.*$", "", t, flags=re.I)
    t = _JUNK.sub(" ", t)
    t = _GROUPS.sub(" ", t)
    t = re.sub(r"\s*[+&]\s*$", "", t)
    t = re.sub(r"\s{2,}", " ", t).strip(" -–—:_.,+")
    if not t:
        t = _PAREN.sub("", raw).strip() or raw.strip()
    low = t.lower()
    plain = t.islower() or t.isupper() or " " not in t
    if low in _ABBR:
        return _ABBR[low]
    m = re.match(r"^([a-z0-9]{2,5})\s+(.+)$", low)
    if m and m.group(1) in _ABBR and m.group(1) not in ("ac",):
        t = _ABBR[m.group(1)] + " " + (_title_case(t[len(m.group(1)) + 1:]) if plain else t[len(m.group(1)) + 1:])
    elif plain:
        t = _title_case(t)
    else:

        t = " ".join(w.upper() if _ROMAN.match(w) else w for w in t.split(" "))
    return t


def title_from_path(p: str | Path) -> str:
    p = Path(p)
    bad = re.compile(r"^(bin\s*\d*|binaries|win\s*\d+|x\s*\d+|x86|game|games?|jogos?|release|retail|shipping|system|exe|app|launcher|start|play|program files.*|steamapps|common|desktop|área de trabalho|area de trabalho|users?|[a-z])$", re.I)
    def folder_title():
        q = p.parent
        while q.parent != q and (bad.match(q.name) or len(q.name) < 3):
            q = q.parent
        return normalize_title(q.name) if q.parent != q else ""
    cand = normalize_title(p.name)
    if p.suffix.lower() in (".exe", ".bat", ".cmd"):

        f = folder_title()
        if f and not bad.match(f) and len(f) >= 3:
            return f
    if not cand or len(cand) < 3 or bad.match(cand):
        cand = folder_title() or cand
    return cand


def similarity(a: str, b: str) -> float:
    na, nb = _cmp(a), _cmp(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    return SequenceMatcher(None, na, nb).ratio()


def _cmp(t: str) -> str:
    import unicodedata
    t = unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode().lower()
    t = re.sub(r"\(.*?\)|\[.*?\]", "", t)
    t = re.sub(r"\b(the|a|an|of|and|&|edition|remastered|definitive|hd|goty|complete|video game)\b", " ", t)
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


_ROMAN_VAL = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8, "ix": 9, "x": 10, "xi": 11, "xii": 12, "xiii": 13, "xiv": 14, "xv": 15}


def _nums(t: str) -> set[str]:
    out = set()
    for tok in t.split():
        if tok.isdigit():
            out.add(str(int(tok)))
        elif tok in _ROMAN_VAL:
            out.add(str(_ROMAN_VAL[tok]))
    return out


def same_numbering(query: str, canonical: str) -> bool:
    return _nums(_cmp(query)) == _nums(_cmp(canonical))


def canonical_ok(query: str, canonical: str, min_sim: float = 0.55) -> bool:
    if not canonical:
        return False
    q, c = _cmp(query), _cmp(canonical)
    if not q or not c:
        return False
    if _nums(q) != _nums(c):
        return False
    if q == c or q.replace(" ", "") == c.replace(" ", ""):
        return True
    if q in c or c in q:
        short, long_ = sorted((q, c), key=len)
        if len(short) >= 4 and len(short) / len(long_) >= 0.4:
            return True
    return SequenceMatcher(None, q, c).ratio() >= min_sim


def canonical_confident(query: str, canonical: str) -> bool:
    q, c = _cmp(query), _cmp(canonical)
    if not q or not c or _nums(q) != _nums(c):
        return False
    if q == c or q.replace(" ", "") == c.replace(" ", ""):
        return True
    if q in c or c in q:
        short, long_ = sorted((q, c), key=len)
        return len(short) >= 4 and len(short) / len(long_) >= 0.6
    return SequenceMatcher(None, q, c).ratio() >= 0.85
