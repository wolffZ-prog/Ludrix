from __future__ import annotations

import glob
import os
import shutil
from pathlib import Path

STORE_AUMID = r"Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft"
STORE_PKG = r"%LOCALAPPDATA%\Packages\Microsoft.4297127D64EC6_8wekyb3d8bbwe"

LAUNCHERS = [
    {"id": "official", "title": "Minecraft Launcher (oficial)", "group": "official", "winget": ["Mojang.MinecraftLauncher"], "store": "9PGW18NPBZV5",
     "site": "https://www.minecraft.net/download",
     "desc": "O launcher da Mojang: Java, Bedrock e Dungeons com a sua conta Microsoft.",
     "win": [r"%ProgramFiles(x86)%\Minecraft Launcher\MinecraftLauncher.exe", r"%ProgramFiles%\Minecraft Launcher\MinecraftLauncher.exe", r"%LOCALAPPDATA%\Programs\Minecraft Launcher\MinecraftLauncher.exe", r"%APPDATA%\.minecraft\MinecraftLauncher.exe"],
     "linux": ["/usr/bin/minecraft-launcher", "/opt/minecraft-launcher/minecraft-launcher", "~/.local/bin/minecraft-launcher", "flatpak:com.mojang.Minecraft"]},
    {"id": "prism", "title": "Prism Launcher", "group": "open", "winget": ["PrismLauncher.PrismLauncher"], "site": "https://prismlauncher.org/download/",
     "desc": "Código aberto. Várias instâncias, modpacks do Modrinth e CurseForge, várias contas.",
     "win": [r"%LOCALAPPDATA%\Programs\PrismLauncher\prismlauncher.exe", r"%ProgramFiles%\PrismLauncher\prismlauncher.exe", r"%USERPROFILE%\scoop\apps\prismlauncher\current\prismlauncher.exe", r"%USERPROFILE%\Desktop\PrismLauncher\prismlauncher.exe"],
     "linux": ["/usr/bin/prismlauncher", "~/.local/bin/prismlauncher", "flatpak:org.prismlauncher.PrismLauncher"]},
    {"id": "multimc", "title": "MultiMC", "group": "open", "winget": ["MultiMC.MultiMC"], "site": "https://multimc.org/",
     "desc": "Código aberto. O clássico gerenciador de instâncias, leve e direto.",
     "win": [r"%USERPROFILE%\MultiMC\MultiMC.exe", r"%USERPROFILE%\Desktop\MultiMC\MultiMC.exe", r"%USERPROFILE%\Downloads\MultiMC\MultiMC.exe", r"%USERPROFILE%\Documents\MultiMC\MultiMC.exe", r"C:\MultiMC\MultiMC.exe", r"C:\Games\MultiMC\MultiMC.exe", r"%LOCALAPPDATA%\Programs\MultiMC\MultiMC.exe"],
     "linux": ["/usr/bin/multimc", "~/MultiMC/MultiMC", "~/.local/bin/multimc"]},
    {"id": "polymc", "title": "PolyMC", "group": "open", "winget": ["PolyMC.PolyMC"], "site": "https://polymc.org/download/",
     "desc": "Código aberto, irmão do Prism e do MultiMC.",
     "win": [r"%LOCALAPPDATA%\Programs\PolyMC\polymc.exe", r"%ProgramFiles%\PolyMC\polymc.exe"],
     "linux": ["/usr/bin/polymc", "flatpak:org.polymc.PolyMC"]},
    {"id": "atlauncher", "title": "ATLauncher", "group": "open", "winget": ["ATLauncher.ATLauncher"], "site": "https://atlauncher.com/downloads",
     "desc": "Código aberto. Foco em modpacks prontos, com servidor embutido.",
     "win": [r"%LOCALAPPDATA%\Programs\ATLauncher\ATLauncher.exe", r"%ProgramFiles%\ATLauncher\ATLauncher.exe", r"%USERPROFILE%\ATLauncher\ATLauncher.exe", r"%USERPROFILE%\Desktop\ATLauncher\ATLauncher.exe", r"%USERPROFILE%\Downloads\ATLauncher.exe"],
     "linux": ["/usr/bin/atlauncher", "flatpak:com.atlauncher.ATLauncher"]},
    {"id": "modrinth", "title": "Modrinth App", "group": "open", "winget": ["Modrinth.ModrinthApp"], "site": "https://modrinth.com/app",
     "desc": "Código aberto. Mods e modpacks do Modrinth em um clique, visual moderno.",
     "win": [r"%LOCALAPPDATA%\Modrinth App\Modrinth App.exe", r"%LOCALAPPDATA%\Programs\Modrinth App\Modrinth App.exe", r"%ProgramFiles%\Modrinth App\Modrinth App.exe"],
     "linux": ["/usr/bin/modrinth-app", "/usr/bin/ModrinthApp", "flatpak:com.modrinth.ModrinthApp"]},
    {"id": "gdlauncher", "title": "GDLauncher", "group": "open", "winget": [], "site": "https://gdlauncher.com/",
     "desc": "Código aberto. Instâncias e modpacks com interface simples.",
     "win": [r"%LOCALAPPDATA%\Programs\gdlauncher\GDLauncher.exe", r"%LOCALAPPDATA%\Programs\GDLauncher Carbon\GDLauncher Carbon.exe", r"%LOCALAPPDATA%\gdlauncher_carbon\GDLauncher Carbon.exe", r"%ProgramFiles%\GDLauncher\GDLauncher.exe"],
     "linux": ["/usr/bin/gdlauncher", "flatpak:io.gdevs.GDLauncher"]},
    {"id": "curseforge", "title": "CurseForge", "group": "other", "winget": ["Overwolf.CurseForge"], "site": "https://www.curseforge.com/download/app",
     "desc": "O app oficial do CurseForge para modpacks e mods. Não é código aberto.",
     "win": [r"%LOCALAPPDATA%\Programs\CurseForge Windows\CurseForge.exe", r"%ProgramFiles%\CurseForge Windows\CurseForge.exe", r"%ProgramFiles%\Overwolf\OverwolfLauncher.exe"],
     "linux": []},
    {"id": "sklauncher", "title": "SKLauncher", "group": "other", "winget": [], "site": "https://skmedix.pl/",
     "desc": "Launcher leve e popular, com skins e versões personalizadas. Precisa do Java. Não é código aberto.",
     "win": [r"%LOCALAPPDATA%\Programs\SKlauncher\SKlauncher.exe", r"%APPDATA%\.minecraft\SKlauncher*.jar", r"%APPDATA%\.minecraft\SKlauncher*.exe", r"%USERPROFILE%\Downloads\SKlauncher*.jar", r"%USERPROFILE%\Downloads\SKlauncher*.exe", r"%USERPROFILE%\Desktop\SKlauncher*.jar", r"%USERPROFILE%\Desktop\SKlauncher*.exe"],
     "linux": ["~/Downloads/SKlauncher*.jar", "~/.minecraft/SKlauncher*.jar"]},
]

GROUPS = [
    {"id": "official", "name": "Oficial", "desc": "O launcher da Mojang, pelo instalador ou pela Microsoft Store"},
    {"id": "open", "name": "Código aberto", "desc": "Launchers livres, mantidos pela comunidade"},
    {"id": "other", "name": "Outros", "desc": "Populares, mas de código fechado"},
]


def _expand(p: str) -> str:
    return os.path.expandvars(os.path.expanduser(p))


def _find(patterns: list[str]) -> str:
    for pat in patterns:
        if pat.startswith("flatpak:"):
            app = pat[8:]
            fp = shutil.which("flatpak")
            if fp:
                base = [Path("/var/lib/flatpak/app") / app, Path.home() / ".local/share/flatpak/app" / app]
                if any(b.exists() for b in base):
                    return pat
            continue
        p = _expand(pat)
        if any(ch in p for ch in "*?["):
            hits = sorted(glob.glob(p), key=lambda x: os.path.getmtime(x), reverse=True)
            if hits:
                return hits[0]
        elif os.path.exists(p):
            return p
    return ""


REG_NAMES = {
    "official": ("minecraft launcher", "MinecraftLauncher.exe"), "prism": ("prism launcher", "prismlauncher.exe"), "multimc": ("multimc", "MultiMC.exe"),
    "polymc": ("polymc", "polymc.exe"), "atlauncher": ("atlauncher", "ATLauncher.exe"), "modrinth": ("modrinth app", "Modrinth App.exe"),
    "gdlauncher": ("gdlauncher", "GDLauncher.exe"), "curseforge": ("curseforge", "CurseForge.exe"), "sklauncher": ("sklauncher", "SKlauncher.exe"),
}


def _reg_find(lid: str) -> str:
    if os.name != "nt" or lid not in REG_NAMES:
        return ""
    needle, exe = REG_NAMES[lid]
    try:
        import winreg
    except ImportError:
        return ""
    roots = [(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
             (winreg.HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
             (winreg.HKEY_LOCAL_MACHINE, r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall")]
    for root, sub in roots:
        try:
            k = winreg.OpenKey(root, sub)
        except OSError:
            continue
        try:
            n = winreg.QueryInfoKey(k)[0]
            for i in range(n):
                try:
                    name = winreg.EnumKey(k, i)
                    sk = winreg.OpenKey(k, name)
                except OSError:
                    continue
                try:
                    disp = str(winreg.QueryValueEx(sk, "DisplayName")[0]).lower()
                except OSError:
                    continue
                if needle not in disp:
                    continue
                for val in ("InstallLocation", "DisplayIcon"):
                    try:
                        v = str(winreg.QueryValueEx(sk, val)[0]).strip('"').split(",")[0].strip()
                    except OSError:
                        continue
                    if not v:
                        continue
                    if v.lower().endswith(".exe") and os.path.isfile(v):
                        return v
                    cand = os.path.join(v, exe)
                    if os.path.isfile(cand):
                        return cand
                    hits = glob.glob(os.path.join(v, "**", exe), recursive=True)
                    if hits:
                        return hits[0]
        finally:
            winreg.CloseKey(k)
    return ""


def java_path() -> str:
    for name in ("javaw", "java"):
        p = shutil.which(name)
        if p:
            return p
    if os.name == "nt":
        for pat in (r"%ProgramFiles%\Java\*\bin\javaw.exe", r"%ProgramFiles%\Eclipse Adoptium\*\bin\javaw.exe", r"%ProgramFiles%\Microsoft\jdk-*\bin\javaw.exe",
                    r"%ProgramFiles(x86)%\Java\*\bin\javaw.exe", r"%ProgramFiles(x86)%\Minecraft Launcher\runtime\*\windows-x64\*\bin\javaw.exe",
                    r"%APPDATA%\.minecraft\runtime\*\windows-x64\*\bin\javaw.exe"):
            hits = glob.glob(_expand(pat))
            if hits:
                return hits[0]
    return ""


class MinecraftManager:
    def __init__(self):
        self._cache: dict[str, str] = {}

    def item(self, lid: str) -> dict | None:
        return next((x for x in LAUNCHERS if x["id"] == lid), None)

    def detect(self, it: dict) -> str:
        pats = it["win"] if os.name == "nt" else it.get("linux", [])
        p = _find(pats) or _reg_find(it["id"])
        if not p and it["id"] == "official" and os.name == "nt" and os.path.isdir(_expand(STORE_PKG)):
            p = "shell:AppsFolder\\" + STORE_AUMID
        return p

    def status(self, library_keys: dict[str, str]) -> dict:
        items = []
        for it in LAUNCHERS:
            path = self.detect(it)
            items.append({"id": it["id"], "title": it["title"], "desc": it["desc"], "group": it["group"], "winget": it.get("winget") or [],
                          "site": it["site"], "store": it.get("store"), "path": path, "installed": bool(path),
                          "kind": "store" if path.startswith("shell:") else ("jar" if path.lower().endswith(".jar") else ("flatpak" if path.startswith("flatpak:") else "exe")),
                          "in_library": library_keys.get(it["id"], ""), "suggest": it["id"] in ("prism", "sklauncher")})
        return {"groups": GROUPS, "items": items, "windows": os.name == "nt", "java": bool(java_path())}

    def launch_spec(self, path: str) -> dict:
        if path.startswith("shell:"):
            return {"shell": path}
        if path.startswith("flatpak:"):
            return {"cmd": ["flatpak", "run", path[8:]], "cwd": str(Path.home())}
        if path.lower().endswith(".jar"):
            j = java_path()
            if not j:
                return {"error": "O Java não foi encontrado. Instale o Java (Adoptium Temurin ou Microsoft OpenJDK) para abrir este launcher."}
            return {"cmd": [j, "-jar", path], "cwd": str(Path(path).parent)}
        return {"cmd": [path], "cwd": str(Path(path).parent)}


BEDROCK_PKG = r"%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe"
BEDROCK_AUMID = "Microsoft.MinecraftUWP_8wekyb3d8bbwe!App"
BEDROCK_STORE = "9NBLGGH2JHXJ"
JAVA_STORE = "9PGW18NPBZV5"
LAUNCH_ORDER = ["official", "prism", "modrinth", "multimc", "polymc", "atlauncher", "gdlauncher", "curseforge", "sklauncher"]
RECOMMEND = ["prism", "official"]
EDITIONS = {
    "java": {"title": "Minecraft: Java Edition", "desc": "A versão original para PC, com mods, shaders e servidores próprios. Abre por um launcher."},
    "bedrock": {"title": "Minecraft: Bedrock Edition", "desc": "A versão da Microsoft Store (Windows 10/11), com multijogador entre plataformas e Marketplace."},
}


def _drives() -> list[str]:
    if os.name != "nt":
        return []
    out = []
    for c in "CDEFGHIJKLMNOPQRSTUVWXYZ":
        if os.path.isdir(f"{c}:\\"):
            out.append(f"{c}:\\")
    return out


def java_dirs() -> list[str]:
    pats = [r"%APPDATA%\.minecraft"] if os.name == "nt" else ["~/.minecraft", "~/.var/app/com.mojang.Minecraft/.minecraft"]
    for d in _drives():
        pats += [d + ".minecraft", d + r"Minecraft\.minecraft", d + r"Games\Minecraft\.minecraft", d + r"Games\.minecraft", d + r"Jogos\Minecraft\.minecraft"]
    out = []
    for pat in pats:
        p = _expand(pat)
        if os.path.isdir(p) and (os.path.isdir(os.path.join(p, "versions")) or os.path.isfile(os.path.join(p, "launcher_profiles.json"))):
            out.append(p)
    return out


def java_info(d: str) -> dict:
    vers = 0
    try:
        vers = sum(1 for x in os.scandir(os.path.join(d, "versions")) if x.is_dir())
    except OSError:
        pass
    mods = 0
    try:
        mods = sum(1 for x in os.scandir(os.path.join(d, "mods")) if x.is_file() and x.name.lower().endswith(".jar"))
    except OSError:
        pass
    return {"dir": d, "versions": vers, "mods": mods}


def bedrock_installed() -> bool:
    return os.name == "nt" and os.path.isdir(_expand(BEDROCK_PKG))


class MinecraftEditions:
    def __init__(self, mgr: MinecraftManager):
        self.mgr = mgr

    def java_launcher(self, preferred: str = "") -> tuple[dict | None, str]:
        order = ([preferred] if preferred else []) + [x for x in LAUNCH_ORDER if x != preferred]
        for lid in order:
            it = self.mgr.item(lid)
            if not it:
                continue
            p = self.mgr.detect(it)
            if p:
                return it, p
        return None, ""

    def installed_launchers(self) -> list[dict]:
        out = []
        for lid in LAUNCH_ORDER:
            it = self.mgr.item(lid)
            p = self.mgr.detect(it) if it else ""
            if p:
                out.append({"id": lid, "title": it["title"], "path": p})
        return out

    def list(self, library_keys: dict[str, str], launcher_pref: dict[str, str]) -> list[dict]:
        dirs = java_dirs()
        info = java_info(dirs[0]) if dirs else {"dir": "", "versions": 0, "mods": 0}
        it, path = self.java_launcher(launcher_pref.get("java", ""))
        java = {"edition": "java", **EDITIONS["java"], "installed": bool(dirs), **info, "dirs": dirs,
                "launcher": it["id"] if it else "", "launcher_title": it["title"] if it else "", "launcher_path": path,
                "in_library": library_keys.get("java", ""), "store": JAVA_STORE}
        bed = {"edition": "bedrock", **EDITIONS["bedrock"], "installed": bedrock_installed(), "dir": _expand(BEDROCK_PKG) if bedrock_installed() else "",
               "in_library": library_keys.get("bedrock", ""), "store": BEDROCK_STORE, "windows_only": True}
        return [java, bed]

    def recommend(self) -> list[dict]:
        out = []
        for lid in RECOMMEND:
            it = self.mgr.item(lid)
            if it:
                out.append({"id": lid, "title": it["title"], "desc": it["desc"], "winget": it.get("winget") or [], "site": it["site"], "store": it.get("store"),
                            "why": "Recomendado: código aberto, leve, várias contas e modpacks em um clique." if lid == "prism" else "O launcher da Mojang, o mais simples para quem só quer jogar."})
        return out
