from __future__ import annotations

import json
import re
import shutil
import time
import zipfile
from pathlib import Path

from . import paths

DIR = paths.DATA / "custom"
FX_DIR = DIR / "fx"
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
FAMILY = re.compile(r"^family:[A-Za-z0-9][A-Za-z0-9 \-_.]{0,59}$")
COLOR_KEYS = ("bg", "bg2", "panel", "card", "card2", "text", "muted", "line")
FONTS = {
    "system": "",
    "rounded": "\"Segoe UI Variable Display\",\"Nunito\",\"Quicksand\",\"Segoe UI\",system-ui,sans-serif",
    "mono": "\"Cascadia Code\",\"JetBrains Mono\",\"Fira Code\",Consolas,ui-monospace,monospace",
    "serif": "\"Georgia\",\"Cambria\",\"Times New Roman\",serif",
    "condensed": "\"Bahnschrift\",\"Roboto Condensed\",\"Arial Narrow\",\"Segoe UI\",sans-serif",
    "wide": "\"Verdana\",\"Trebuchet MS\",\"Segoe UI\",sans-serif",
}
DEFAULT = {
    "on": False, "colors": {}, "alpha": 100, "blur": 0, "radius": -1, "font": "system",
    "wallpaper": "", "wallpaper_opacity": 35, "wallpaper_blur": 0, "wallpaper_dim": 0,
    "gradient": {"preset": "off", "shape": "mesh", "c1": "#6d28d9", "c2": "#0ea5e9", "angle": 160, "opacity": 55},
    "fx": {"mode": "theme", "icons": [], "count": 10, "speed": 1.0, "size": 56, "opacity": 45, "direction": "up", "pixel": False, "spin": True},
    "nav": {"style": "auto", "shape": "pill", "icon_size": 0, "gap": 0},
    "window": {"titlebar": "normal", "toolbar_style": "auto"},
    "cards": {"shape": "poster", "labels": "below", "shadow": True},
    "splash": "", "icon": "",
}


GRADIENTS = {
    "aurora": ("#6d28d9", "#0ea5e9", "#10b981"),
    "crepusculo": ("#f97316", "#db2777", "#312e81"),
    "oceano": ("#0c4a6e", "#0369a1", "#22d3ee"),
    "brasa": ("#7f1d1d", "#ea580c", "#facc15"),
    "floresta": ("#052e16", "#15803d", "#a3e635"),
    "neblina": ("#1e293b", "#64748b", "#cbd5e1"),
    "uva": ("#3b0764", "#a21caf", "#f472b6"),
    "accent": (),
    "custom": (),
}
GRAD_SHAPES = ("mesh", "linear", "radial")


def _gradient_css(g: dict) -> str:
    preset = g.get("preset") or "off"
    if preset == "off" or preset not in GRADIENTS:
        return ""
    if preset == "accent":
        cols = ("var(--accent)", "color-mix(in srgb,var(--accent) 45%,var(--bg))", "color-mix(in srgb,var(--accent) 20%,var(--bg))")
    elif preset == "custom":
        cols = (g["c1"], g["c2"], f"color-mix(in srgb,{g['c1']} 50%,{g['c2']})")
    else:
        cols = GRADIENTS[preset]
    a, b, c = cols
    shape = g.get("shape") or "mesh"
    if shape == "linear":
        bg = f"linear-gradient({g['angle']}deg,{a} 0%,{b} 55%,{c} 100%)"
    elif shape == "radial":
        bg = f"radial-gradient(120% 90% at 85% 0%,{a} 0%,{b} 45%,transparent 80%),radial-gradient(90% 70% at 0% 100%,{c} 0%,transparent 70%)"
    else:
        bg = (f"radial-gradient(60% 55% at 15% 12%,{a} 0%,transparent 70%),radial-gradient(55% 60% at 85% 25%,{b} 0%,transparent 70%),"
              f"radial-gradient(70% 60% at 50% 100%,{c} 0%,transparent 70%),linear-gradient({g['angle']}deg,{a},{b})")
    return f"body::before{{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background:{bg};opacity:{g['opacity'] / 100:.2f}}}"


def _merge(base: dict, over: dict) -> dict:
    out = json.loads(json.dumps(base))
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def _clamp(v, lo, hi, default):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


STYLE_WORDS = re.compile(r"\s+(Bold|Italic|Light|Semibold|SemiBold|Medium|Black|Thin|Regular|Condensed|Oblique|Heavy|ExtraBold|Extra Bold|Semilight|SemiLight|Narrow|Book|Demi|DemiBold|Ultra|UltraLight|Variable)(\s|$)", re.I)


def _installed_fonts() -> list[str]:
    import os
    import subprocess
    names: set[str] = set()
    if os.name == "nt":
        try:
            import winreg
            for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
                try:
                    k = winreg.OpenKey(hive, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts")
                except OSError:
                    continue
                i = 0
                while True:
                    try:
                        name, _, _ = winreg.EnumValue(k, i)
                    except OSError:
                        break
                    i += 1
                    name = re.sub(r"\s*\((TrueType|OpenType|All res)\)$", "", name).split("&")[0].strip()
                    while STYLE_WORDS.search(" " + name):
                        name = STYLE_WORDS.sub(" ", " " + name).strip()
                    if name and FAMILY.match("family:" + name):
                        names.add(name)
        except Exception:
            pass
    else:
        try:
            out = subprocess.run(["fc-list", ":", "family"], capture_output=True, text=True, timeout=5).stdout
            for line in out.splitlines():
                n = line.split(",")[0].strip()
                if n and FAMILY.match("family:" + n):
                    names.add(n)
        except Exception:
            pass
    return list(names)


class CustomUX:
    def __init__(self, store):
        self._fonts = None
        self.store = store
        self.pick_file = None

    def get(self) -> dict:
        c = _merge(DEFAULT, self.store.config.get("custom") or {})
        c["fx"]["icons"] = [n for n in c["fx"].get("icons") or [] if (FX_DIR / n).exists()]
        if c.get("wallpaper") and not (DIR / c["wallpaper"]).exists():
            c["wallpaper"] = ""
        return c

    def set(self, patch: dict) -> dict:
        if isinstance(patch, str):
            try:
                patch = json.loads(patch)
            except ValueError:
                patch = {}
        if not isinstance(patch, dict):
            patch = {}
        if isinstance(patch.get("patch"), dict) and len(patch) == 1:
            patch = patch["patch"]
        cur = _merge(DEFAULT, self.store.config.get("custom") or {})
        new = _merge(cur, patch or {})
        cols = {k: v for k, v in (new.get("colors") or {}).items() if k in COLOR_KEYS and (v == "" or HEX.match(str(v)))}
        new["colors"] = {k: v for k, v in cols.items() if v}
        new["alpha"] = int(_clamp(new.get("alpha"), 20, 100, 100))
        new["blur"] = int(_clamp(new.get("blur"), 0, 30, 0))
        new["radius"] = int(_clamp(new.get("radius"), -1, 24, -1))
        new["font"] = new.get("font") if (new.get("font") in FONTS or FAMILY.match(str(new.get("font") or ""))) else "system"
        gr = new.get("gradient") if isinstance(new.get("gradient"), dict) else {}
        gd = DEFAULT["gradient"]
        new["gradient"] = {
            "preset": gr.get("preset") if gr.get("preset") in GRADIENTS or gr.get("preset") == "off" else "off",
            "shape": gr.get("shape") if gr.get("shape") in GRAD_SHAPES else "mesh",
            "c1": gr.get("c1") if HEX.match(str(gr.get("c1") or "")) else gd["c1"],
            "c2": gr.get("c2") if HEX.match(str(gr.get("c2") or "")) else gd["c2"],
            "angle": int(_clamp(gr.get("angle"), 0, 360, gd["angle"])),
            "opacity": int(_clamp(gr.get("opacity"), 5, 100, gd["opacity"])),
        }
        for k in ("splash", "icon"):
            v = str(new.get(k) or "")
            new[k] = v if re.match(r"^[a-z]+-\d{1,6}\.png$", v) else ""
        new["wallpaper_opacity"] = int(_clamp(new.get("wallpaper_opacity"), 0, 100, 35))
        new["wallpaper_blur"] = int(_clamp(new.get("wallpaper_blur"), 0, 40, 0))
        new["wallpaper_dim"] = int(_clamp(new.get("wallpaper_dim"), 0, 90, 0))
        fx = new["fx"]
        fx["mode"] = fx.get("mode") if fx.get("mode") in ("theme", "icons", "off") else "theme"
        fx["count"] = int(_clamp(fx.get("count"), 0, 24, 10))
        fx["speed"] = round(_clamp(fx.get("speed"), 0.3, 3, 1.0), 2)
        fx["size"] = int(_clamp(fx.get("size"), 16, 160, 56))
        fx["opacity"] = int(_clamp(fx.get("opacity"), 5, 100, 45))
        fx["direction"] = fx.get("direction") if fx.get("direction") in ("up", "down", "left", "right", "drift") else "up"
        fx["icons"] = [n for n in fx.get("icons") or [] if isinstance(n, str) and "/" not in n and "\\" not in n]
        nav = new["nav"]
        nav["style"] = nav.get("style") if nav.get("style") in ("auto", "both", "icons", "text") else "auto"
        nav["shape"] = nav.get("shape") if nav.get("shape") in ("pill", "round", "flat", "square") else "pill"
        nav["icon_size"] = int(_clamp(nav.get("icon_size"), 0, 34, 0))
        nav["gap"] = int(_clamp(nav.get("gap"), 0, 16, 0))
        win = new["window"]
        win["titlebar"] = win.get("titlebar") if win.get("titlebar") in ("normal", "compact", "tall") else "normal"
        win["toolbar_style"] = win.get("toolbar_style") if win.get("toolbar_style") in ("auto", "flat", "outlined", "filled") else "auto"
        cards = new["cards"]
        cards["shape"] = cards.get("shape") if cards.get("shape") in ("poster", "square", "wide", "tall") else "poster"
        cards["labels"] = cards.get("labels") if cards.get("labels") in ("below", "overlay", "hover", "none") else "below"
        cards["shadow"] = bool(cards.get("shadow", True))
        self.store.set_config(custom=new)
        return self.get()

    def reset(self) -> dict:
        self.store.set_config(custom={})
        return self.get()

    def file(self, rel: str) -> Path | None:
        p = (DIR / rel).resolve()
        if DIR.resolve() not in p.parents or not p.is_file():
            return None
        return p

    def pick(self, what: str) -> dict:
        if not self.pick_file:
            return {"error": "Diálogo nativo indisponível no modo navegador"}
        src = self.pick_file("", "image")
        if not src:
            return {"cancel": True}
        return self.add_file(what, src)

    def splash_path(self) -> Path | None:
        n = self.get().get("splash") or ""
        if n and "/" not in n and (DIR / n).is_file():
            return DIR / n
        return None

    def icon_paths(self) -> tuple[Path | None, Path | None]:
        n = self.get().get("icon") or ""
        if n and "/" not in n and (DIR / n).is_file():
            ico = DIR / "icon.ico"
            return DIR / n, (ico if ico.is_file() else None)
        return None, None

    def add_file(self, what: str, src: str) -> dict:
        from PIL import Image
        p = Path(src)
        if not p.exists():
            return {"error": "Arquivo não encontrado"}
        try:
            img = Image.open(p)
            img.load()
        except Exception:
            return {"error": "Não consegui abrir essa imagem (use PNG, JPG ou WEBP)"}
        stamp = str(int(time.time()))[-6:]
        if what == "fx":
            FX_DIR.mkdir(parents=True, exist_ok=True)
            img = img.convert("RGBA")
            if max(img.size) > 128:
                img.thumbnail((128, 128), Image.LANCZOS)
            name = re.sub(r"[^a-z0-9]+", "-", p.stem.lower()).strip("-")[:24] or "icone"
            out = FX_DIR / f"{name}-{stamp}.png"
            img.save(out, "PNG", optimize=True)
            cur = self.get()
            icons = cur["fx"]["icons"] + [out.name]
            return self.set({"fx": {"icons": icons[-24:], "mode": "icons"}})
        DIR.mkdir(parents=True, exist_ok=True)
        if what == "splash":
            img = img.convert("RGBA")
            if max(img.size) > 1024:
                img.thumbnail((1024, 1024), Image.LANCZOS)
            out = DIR / f"splash-{stamp}.png"
            img.save(out, "PNG", optimize=True)
            old = self.get().get("splash")
            if old and old != out.name:
                (DIR / old).unlink(missing_ok=True)
            return self.set({"splash": out.name})
        if what == "icon":
            img = img.convert("RGBA")
            if img.width != img.height:
                side = min(img.size)
                left, top = (img.width - side) // 2, (img.height - side) // 2
                img = img.crop((left, top, left + side, top + side))
            if img.width != 256:
                img = img.resize((256, 256), Image.LANCZOS)
            out = DIR / f"icon-{stamp}.png"
            img.save(out, "PNG", optimize=True)
            img.save(DIR / "icon.ico", "ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
            old = self.get().get("icon")
            if old and old != out.name:
                (DIR / old).unlink(missing_ok=True)
            return self.set({"icon": out.name})
        img = img.convert("RGB")
        if img.width > 1920:
            img = img.resize((1920, int(img.height * 1920 / img.width)), Image.LANCZOS)
        out = DIR / f"wallpaper-{stamp}.webp"
        img.save(out, "WEBP", quality=80, method=4)
        old = self.get().get("wallpaper")
        if old and old != out.name:
            (DIR / old).unlink(missing_ok=True)
        return self.set({"wallpaper": out.name})

    def remove(self, what: str, name: str = "") -> dict:
        cur = self.get()
        if what == "fx":
            icons = [n for n in cur["fx"]["icons"] if n != name]
            if name and "/" not in name:
                (FX_DIR / name).unlink(missing_ok=True)
            return self.set({"fx": {"icons": icons, "mode": cur["fx"]["mode"] if icons else "theme"}})
        if what in ("splash", "icon"):
            if cur.get(what):
                (DIR / cur[what]).unlink(missing_ok=True)
            if what == "icon":
                (DIR / "icon.ico").unlink(missing_ok=True)
            return self.set({what: ""})
        if cur.get("wallpaper"):
            (DIR / cur["wallpaper"]).unlink(missing_ok=True)
        return self.set({"wallpaper": ""})

    @staticmethod
    def _radius_css(r: int) -> str:
        return (f":root{{--r:{r}px}}.btn,.search input,.chip,.bell,.brandbtn,.dd,.tabs button,.seg button,.frow input,.frow select{{border-radius:{max(2, round(r * .7))}px}}"
                f".card .cov{{border-radius:{max(0, r - 2)}px}}.rb{{border-radius:{max(2, round(r * .9))}px}}.sec,.item,.hero,.spot,.modal .box,.tile,.g-grafite .gfocus,.g-grafite .gside{{border-radius:{r}px}}"
                f".g-grafite .scard,.g-grafite .gcov,.g-grafite .wcard{{border-radius:{max(0, r - 4)}px}}\n")

    def css(self, theme_scope: str = "") -> str:
        c = self.get()
        if not c.get("on"):
            return ""
        out = []
        cols = c["colors"]
        if cols:
            root = "".join(f"--{k}:{v};" for k, v in cols.items())
            if "text" in cols and "muted" not in cols:
                root += "--muted:color-mix(in srgb,var(--text) 62%,transparent);--muted2:color-mix(in srgb,var(--text) 45%,transparent);"
            if "muted" in cols:
                root += "--muted2:color-mix(in srgb,var(--muted) 75%,transparent);"
            if "line" in cols:
                root += "--line2:color-mix(in srgb,var(--line) 60%,var(--text) 15%);"
            if "card" in cols and "card2" not in cols:
                root += "--card2:color-mix(in srgb,var(--card) 85%,var(--text) 6%);"
            if "bg" in cols and "bg2" not in cols:
                root += "--bg2:color-mix(in srgb,var(--bg) 92%,var(--text) 4%);"
            if "bg" in cols and "panel" not in cols:
                root += "--panel:color-mix(in srgb,var(--bg) 90%,var(--text) 3%);"
            out.append(":root{" + root + "}")
        a = c["alpha"]
        if a < 100:
            blur = c["blur"] or (12 if a < 90 else 0)
            bf = f"backdrop-filter:blur({blur}px);" if blur else ""
            out.append(f"main.glass{{--glassbg:color-mix(in srgb,var(--bg) {max(0, a - 30)}%,transparent)}}"
                       f".rail,.top{{background:color-mix(in srgb,var(--panel) {a}%,transparent);{bf}}}"
                       f".sec,.tile,.item,.g-grafite .gfocus,.g-grafite .gside,.modal .box,.hero,.spot,.detail{{background:color-mix(in srgb,var(--bg2) {a}%,transparent);{bf}}}"
                       f".card{{background:color-mix(in srgb,var(--card) {max(10, a - 20)}%,transparent)}}"
                       f".g-grafite .grec,.gstats{{background:color-mix(in srgb,var(--text) 4%,transparent)}}")
        if c["radius"] >= 0:
            out.append(self._radius_css(c["radius"]))
        if FONTS.get(c["font"]):
            out.append(f":root{{--font-text:{FONTS[c['font']]};--font-disp:{FONTS[c['font']]}}}html,body,button,input,select,textarea{{font-family:{FONTS[c['font']]}}}")
        elif FAMILY.match(str(c["font"] or "")):
            fam = f"\"{c['font'][7:]}\",\"Segoe UI\",system-ui,sans-serif"
            out.append(f":root{{--font-text:{fam};--font-disp:{fam}}}html,body,button,input,select,textarea{{font-family:{fam}}}")
        gcss = _gradient_css(c.get("gradient") or DEFAULT["gradient"])
        if gcss:
            out.append(gcss)
        if c.get("wallpaper"):
            dim = c["wallpaper_dim"]
            grad = f"linear-gradient(rgba(0,0,0,{dim / 100:.2f}),rgba(0,0,0,{dim / 100:.2f}))," if dim else ""
            flt = f"filter:blur({c['wallpaper_blur']}px);transform:scale(1.04);" if c["wallpaper_blur"] else ""
            out.append(f"body::after{{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background:{grad}url('/api/custom/file/{c['wallpaper']}') center/cover no-repeat;opacity:{c['wallpaper_opacity'] / 100:.2f};{flt}}}")
        fx = c["fx"]
        if fx["mode"] == "off":
            out.append(".fx{display:none}")
        nav = c["nav"]
        if nav["style"] == "icons":
            out.append(".rb span{display:none}.rb{gap:0}body[data-layout=side] .rb,body[data-layout=top] .rb{padding:0 12px;width:auto;justify-content:center}")
        elif nav["style"] == "text":
            out.append(".rb svg{display:none}.rb span{font-size:12px}body[data-nav=bottom] .rb{height:44px}")
        elif nav["style"] == "both":
            out.append(".rb span{display:block}.rb svg{display:block}")
        shape = nav["shape"]
        if shape == "round":
            out.append(".rb{border-radius:999px}.rb.on::before{display:none}")
        elif shape == "flat":
            out.append(".rb{border-radius:0}.rb.on{background:transparent;box-shadow:none}.rb.on::before{display:none}.rb.on::after{content:'';position:absolute;left:14px;right:14px;bottom:2px;height:2px;border-radius:2px;background:var(--accent)}body[data-nav=side] .rb.on::after,body[data-layout=side] .rb.on::after{left:auto;right:0;top:12px;bottom:12px;width:3px;height:auto}")
        elif shape == "square":
            out.append(".rb{border-radius:4px}")
        if nav["icon_size"]:
            out.append(f".rb svg{{width:{nav['icon_size']}px;height:{nav['icon_size']}px}}")
        if nav["gap"]:
            out.append(f".rail{{gap:{nav['gap']}px}}body[data-nav=bottom] .rail{{gap:{nav['gap']}px}}")
        win = c["window"]
        if win["titlebar"] == "compact":
            out.append("body.frameless{--tb:28px}.titlebar{font-size:11px}.titlebar .wb{width:34px}")
        elif win["titlebar"] == "tall":
            out.append("body.frameless{--tb:44px}")
        ts = win["toolbar_style"]
        if ts == "flat":
            out.append(".top{background:transparent;border-bottom:0;box-shadow:none}.search input,.chip,.bell{background:transparent;border-color:transparent}")
        elif ts == "outlined":
            out.append(".search input,.chip,.bell,.btn.s{background:transparent;border:1px solid var(--line2)}")
        elif ts == "filled":
            out.append(".top{background:var(--panel)}.search input,.chip,.bell{background:color-mix(in srgb,var(--text) 8%,transparent);border-color:transparent}")
        cards = c["cards"]
        ratio = {"poster": "", "square": "1/1", "wide": "16/9", "tall": "2/3"}[cards["shape"]]
        if ratio:
            out.append(f".card .cov{{aspect-ratio:{ratio}}}" + (".grid{grid-template-columns:repeat(auto-fill,minmax(calc(var(--card) * var(--scale) * 1.5),1fr))}" if cards["shape"] == "wide" else ""))
        if cards["labels"] == "overlay":
            out.append(".card .sub{display:none}.card h4{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:26px 10px 9px;color:#fff;text-align:left;background:linear-gradient(0deg,rgba(0,0,0,.88),rgba(0,0,0,.2) 70%,transparent);white-space:normal;font-size:12.5px;line-height:1.2;pointer-events:none;border-radius:0 0 var(--r) var(--r)}")
        elif cards["labels"] == "hover":
            out.append(".card .sub{display:none}.card h4{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:26px 10px 9px;color:#fff;text-align:left;background:linear-gradient(0deg,rgba(0,0,0,.9),transparent);white-space:normal;font-size:12.5px;line-height:1.2;opacity:0;transform:translateY(6px);transition:.22s;pointer-events:none;border-radius:0 0 var(--r) var(--r)}.card:hover h4,.card.gp-focus h4,.card.sel h4{opacity:1;transform:none}")
        elif cards["labels"] == "none":
            out.append(".card .info{display:none}")
        if not cards["shadow"]:
            out.append(".card .cov,.g-grafite .gcov,.g-grafite .scard{box-shadow:none}")
        return "\n".join(out) + "\n"

    def fonts(self) -> dict:
        if self._fonts is None:
            self._fonts = sorted(_installed_fonts(), key=str.lower)
        return {"fonts": self._fonts}

    def export(self, name: str, dest: str = "") -> dict:
        c = self.get()
        slug = re.sub(r"[^a-z0-9]+", "-", (name or "meu-tema").lower()).strip("-")[:40] or "meu-tema"
        theme = (self.store.config.get("theme") or "system")
        scheme = "light" if theme == "light" else "dark"
        tj = {"name": name or "Meu tema", "author": "você", "description": "Tema exportado do Personalizar do LudrixHub", "tags": ["personalizado"],
              "scheme": scheme, "accent": self.store.config.get("accent") or "", "layout": self.store.config.get("layout") or "", "vars": dict(c["colors"])}
        if c.get("wallpaper"):
            tj["wallpaper"] = c["wallpaper"]
            tj["wallpaper_opacity"] = round(c["wallpaper_opacity"] / 100, 2)
        if c["fx"]["mode"] == "icons" and c["fx"]["icons"]:
            tj["fx"] = {**c["fx"], "icons": [f"fx/{n}" for n in c["fx"]["icons"]]}
        css = self.css()
        css = re.sub(r"body::after\{[^}]*\}\n?", "", css)
        css = css.replace("/api/custom/file/", "")
        out_dir = Path(dest) if dest else paths.THEMES / "exportados"
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / f"{slug}.lxtheme"
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr(f"{slug}/theme.json", json.dumps(tj, ensure_ascii=False, indent=1))
            z.writestr(f"{slug}/extra.css", css)
            z.writestr(f"{slug}/LEIA-ME.txt", f"{tj['name']} — tema exportado do LudrixHub.\nImporte em Ajustes > Aparência > Estilos importados.\n")
            if c.get("wallpaper") and (DIR / c["wallpaper"]).exists():
                z.write(DIR / c["wallpaper"], f"{slug}/wallpaper" + (DIR / c["wallpaper"]).suffix)
            for n in tj.get("fx", {}).get("icons", []):
                p = FX_DIR / n[3:]
                if p.exists():
                    z.write(p, f"{slug}/{n}")
        return {"ok": True, "path": str(out)}

    def wipe(self):
        shutil.rmtree(DIR, ignore_errors=True)
