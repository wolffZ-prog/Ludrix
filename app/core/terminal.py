from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import shlex
import shutil
import subprocess
import sys
import time
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from . import paths
from .installer import human_size

VERSION = "4.0"


@dataclass
class Cmd:
    name: str
    help: str
    fn: object
    args: list = field(default_factory=list)
    examples: list = field(default_factory=list)
    group: str = "launcher"
    aliases: list = field(default_factory=list)
    danger: bool = False
    hidden: bool = False


COMMANDS: dict[str, Cmd] = {}


def cmd(name, help_, args=None, examples=None, group="launcher", aliases=(), danger=False, hidden=False):
    def deco(fn):
        c = Cmd(name, help_, fn, list(args or []), list(examples or []), group, list(aliases), danger, hidden)
        COMMANDS[name] = c
        for a in aliases:
            COMMANDS[a] = c
        return fn
    return deco


def usage(c: Cmd, problem: str = "") -> dict:
    syn = "/" + c.name + "".join(f" <{a[0]}>" if a[2] else f" [{a[0]}]" for a in c.args)
    lines = []
    if problem:
        lines.append(f"Erro: {problem}")
    lines.append(f"Uso: {syn}")
    lines.append(f"  {c.help}")
    if c.args:
        lines.append("")
        lines.append("Argumentos:")
        w = max(len(a[0]) for a in c.args)
        for a in c.args:
            lines.append(f"  {a[0].ljust(w)}   {a[1]}{'' if a[2] else '  (opcional)'}")
    if c.examples:
        lines.append("")
        lines.append("Exemplos:")
        for e in c.examples:
            lines.append(f"  {e}")
    if c.aliases:
        lines.append("")
        lines.append("Também: " + ", ".join("/" + a for a in c.aliases))
    return {"ok": not problem, "usage": True, "text": "\n".join(lines)}


def _human(n: float) -> str:
    n = float(n or 0)
    for u in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {u}" if u != "B" else f"{int(n)} B"
        n /= 1024
    return f"{n:.1f} PB"


class Terminal:

    def __init__(self, ludrix):
        self.n = ludrix
        self.history: list[str] = []
        self.started = time.time()

    def run(self, line: str, source: str = "terminal") -> dict:
        line = (line or "").strip()
        if not line:
            return {"ok": True, "text": ""}
        if not line.startswith("/"):

            guess = self._closest(line.split()[0])
            return {"ok": False, "text": f"Comandos começam com \"/\". Você quis dizer /{guess}?  ( /help lista tudo )" if guess else "Comandos começam com \"/\".  Ex.: /help"}
        try:
            parts = shlex.split(line[1:], posix=True)
        except ValueError:
            parts = line[1:].split()
        if not parts:
            return {"ok": False, "text": "Digite um comando depois da barra. Ex.: /help"}
        name, args = parts[0].lower(), parts[1:]
        c = COMMANDS.get(name)
        if not c:
            guess = self._closest(name)
            return {"ok": False, "text": f"Comando desconhecido: /{name}" + (f"\nVocê quis dizer: /{guess}" if guess else "") + "\nUse /help pra ver a lista."}
        req = [a for a in c.args if a[2]]
        if len(args) < len(req):
            missing = req[len(args)][0]
            return usage(c, f"faltou o argumento <{missing}>")
        if source != "terminal" and len(self.history) < 500:
            pass
        self.history.append(line)
        self.history = self.history[-200:]
        try:
            r = c.fn(self, args)
        except PermissionError as e:
            return {"ok": False, "text": f"Sem permissão: {e}"}
        except Exception as e:
            return {"ok": False, "text": f"Falhou: {e}"}
        if isinstance(r, str):
            return {"ok": True, "text": r}
        r = dict(r or {})
        r.setdefault("ok", True)
        r.setdefault("text", "")
        return r

    def _closest(self, name: str) -> str:
        import difflib
        m = difflib.get_close_matches(name.lower(), [k for k, c in COMMANDS.items() if not c.hidden], n=1, cutoff=0.6)
        return m[0] if m else ""

    def catalog(self) -> list[dict]:
        seen, out = set(), []
        for k, c in COMMANDS.items():
            if c.name in seen or c.hidden:
                continue
            seen.add(c.name)
            out.append({"name": c.name, "help": c.help, "args": c.args, "examples": c.examples, "group": c.group, "aliases": c.aliases, "danger": c.danger})
        out.sort(key=lambda x: (x["group"], x["name"]))
        return out

    def _game(self, q: str) -> dict | None:
        q = q.strip().lower()
        lib = self.n.store.library
        if q in lib:
            return {"key": q, **lib[q]}
        best = None
        for k, info in lib.items():
            t = (info.get("title") or k).lower()
            if t == q:
                return {"key": k, **info}
            if q in t and (best is None or len(t) < len(best.get("title") or "")):
                best = {"key": k, **info}
        if best:
            return best
        for e in list(self.n.entries.values()):
            if q == e.title.lower() or q in e.title.lower():
                return {"key": e.key, "title": e.title, "installed": False}
        return None

    def _open(self, target: str):
        if os.name == "nt":
            os.startfile(target)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", target])
        else:
            subprocess.Popen(["xdg-open", target])

    def _win_only(self):
        if os.name != "nt":
            raise RuntimeError("esse comando só funciona no Windows")


@cmd("help", "Lista os comandos (ou explica um: /help <comando>)", args=[("comando", "nome do comando pra ver detalhes", False)],
     examples=["/help", "/help play", "/help windows"], group="ajuda", aliases=["?", "h"])
def _help(t: Terminal, a):
    if a:
        q = a[0].lstrip("/").lower()
        c = COMMANDS.get(q)
        if c:
            return usage(c)
        grp = [x for x in t.catalog() if x["group"] == q]
        if grp:
            return "\n".join(f"/{x['name']:<18} {x['help']}" for x in grp)
        return {"ok": False, "text": f"Não conheço /{q}. Grupos: " + ", ".join(sorted({x['group'] for x in t.catalog()}))}
    out = [f"LudrixHub {t.n.updates.status()['current'].get('version', '?')} — terminal. Tudo começa com /. Aspas pra nomes com espaço.", ""]
    cur = None
    for x in t.catalog():
        if x["group"] != cur:
            cur = x["group"]
            out.append(f"[{cur}]")
        out.append(f"  /{x['name']:<18} {x['help']}")
    out += ["", "Dica: /help <comando> mostra argumentos e exemplos.  Setas ↑↓ = histórico · Tab = completar · Ctrl+L = limpar"]
    return "\n".join(out)


@cmd("clear", "Limpa a tela do terminal", group="ajuda", aliases=["cls"])
def _clear(t, a):
    return {"ui": {"clear": True}}


@cmd("version", "Versão do Ludrix, do Python e do sistema", group="ajuda", aliases=["ver", "about"])
def _version(t, a):
    st = t.n.updates.status()
    return (f"LudrixHub {st['current'].get('version', '?')} ({'compilado' if paths.FROZEN else 'código-fonte'})\n"
            f"Python {platform.python_version()} · {platform.system()} {platform.release()} ({platform.machine()})\n"
            f"Pasta: {paths.ROOT}\nAberto há {int(time.time() - t.started) // 60} min")


@cmd("checkupdates", "Procura atualização no feed e na pasta data\\updates", examples=["/checkupdates"], group="launcher", aliases=["update", "checkupdate"])
def _checkupdates(t, a):
    r = t.n.updates_check()
    if r.get("error"):
        return {"ok": False, "text": r["error"]}
    av = r.get("available") or (t.n.updates.available and t.n.updates._pub(t.n.updates.available))
    rem = r.get("remote") or t.n.updates.remote
    cur = t.n.updates.status()["current"].get("version")
    if av:
        return f"Pronta pra instalar: {av.get('title') or av.get('version')} (você está na {cur}).\nInstale com /installupdate ou em Ajustes → Atualizações."
    if rem:
        return f"Nova versão disponível pra baixar: {rem.get('version')} (você está na {cur}). Use /downloadupdate."
    return f"Nenhuma atualização. Você está na {cur}."


@cmd("downloadupdate", "Baixa a atualização encontrada por /checkupdates", group="launcher")
def _dlupdate(t, a):
    r = t.n.updates_download()
    return {"ok": not r.get("error"), "text": r.get("error") or "Baixando… acompanhe em Fila."}


@cmd("installupdate", "Instala a atualização já baixada e reabre o Ludrix", group="launcher", danger=True)
def _installupdate(t, a):
    r = t.n.updates_apply(True)
    return {"ok": not r.get("error"), "text": r.get("error") or "Fechando pra aplicar a atualização…"}


@cmd("changelog", "Mostra as novidades da versão instalada (ou de um pacote .lxup em updates/)", args=[("versão", "número, ex.: 4.0.0", False)],
     examples=["/changelog", "/changelog 1.0.0"], group="launcher")
def _changelog(t, a):
    want = a[0] if a else None
    st = t.n.updates.status()
    cur = st["current"]
    if not want or want == cur.get("version"):
        txt = cur.get("changelog") or ""
        if not txt:
            p = paths.ROOT / "CHANGELOG.md"
            if p.exists():
                m = re.search(rf"^## +{re.escape(cur.get('version', ''))}\b[^\n]*\n(.*?)(?=^## |\Z)", p.read_text(encoding="utf-8"), re.S | re.M)
                txt = m.group(1).strip() if m else ""
        return f"Novidades da {cur.get('version')}:\n\n{txt}" if txt else f"Sem changelog gravado pra {cur.get('version')}."
    for f in sorted(paths.UPDATES.glob("*.lxup")):
        try:
            with zipfile.ZipFile(f) as z:
                m = json.loads(z.read("manifest.json"))
            if m.get("version") == want:
                return f"Novidades da {want} ({f.name}):\n\n{m.get('changelog', '')}"
        except Exception:
            continue
    return {"ok": False, "text": f"Versão {want} não encontrada, nem em updates/."}


@cmd("debuglaunch", "Mostra exatamente como o Ludrix abriria um jogo (comando, pasta, emulador) sem abrir",
     args=[("jogo", "pedaço do nome ou chave", True)], examples=['/debuglaunch "need for speed"', "/debuglaunch rom:ps2:Shadow"], group="launcher")
def _debuglaunch(t, a):
    g = t._game(" ".join(a))
    if not g:
        return {"ok": False, "text": "Jogo não encontrado. Tente um pedaço maior do nome ou /find <termo>."}
    key = g["key"]
    info = t.n.store.get(key) or {}
    out = [f"Jogo: {g.get('title')}  [{key}]"]
    if not info:
        return "\n".join(out + ["Não está instalado — nada pra lançar. (Está no catálogo de uma fonte.)"])
    out.append(f"Tipo: {info.get('kind', 'pc')}   Pasta: {info.get('dir', '')}")
    if info.get("kind") == "rom" and info.get("system"):
        sid = info["system"]
        opts = t.n.emu.installed_options(sid)
        remembered = (t.n.store.config.get("game_emulator") or {}).get(key)
        default = t.n.emu.emulator_for(sid)
        out.append(f"Sistema: {sid}   Emuladores instalados: {', '.join(o['id'] for o in opts) or 'nenhum'}   Padrão: {default}" + (f"   Lembrado pra este jogo: {remembered}" if remembered else ""))
        lr = t.n.emu.launch_rom(info["exe"], sid, remembered)
        if lr.get("error"):
            out.append(f"ERRO: {lr.get('message') or lr['error']}")
        else:
            out.append("Comando: " + subprocess.list2cmdline(lr["cmd"] + t.n._split_args(t.n._game_args(key))))
            out.append(f"Pasta de trabalho: {lr['cwd']}")
            if lr.get("hint"):
                out.append("Aviso: " + lr["hint"])
    else:
        exe = info.get("exe", "")
        out.append(f"Executável: {exe}   existe: {'sim' if exe and Path(exe).exists() else 'NÃO'}")
        out.append("Argumentos extras: " + (t.n._game_args(key) or "(nenhum)"))
        out.append("Comando: " + subprocess.list2cmdline([exe] + t.n._split_args(t.n._game_args(key))))
    out.append(f"Modo Game automático: {'sim' if t.n.store.config.get('game_mode_auto') else 'não'}   Depois de abrir: {t.n.store.config.get('after_launch', 'ask')}")
    return "\n".join(out)


@cmd("play", "Abre um jogo", args=[("jogo", "pedaço do nome ou chave", True), ("emulador", "id do emulador (só ROMs)", False)],
     examples=['/play "gta san andreas"', "/play zelda melonds"], group="launcher", aliases=["run", "launch"])
def _play(t, a):
    g = t._game(a[0]) if len(a) == 1 or COMMANDS.get("play") and a[-1] in t.n.emu.all_emulators() else t._game(" ".join(a))
    emu = a[-1] if len(a) > 1 and a[-1] in t.n.emu.all_emulators() else None
    if not g and len(a) > 1:
        g = t._game(" ".join(a if not emu else a[:-1]))
    if not g:
        return {"ok": False, "text": "Jogo não encontrado. /find <termo> ajuda a achar a chave."}
    r = t.n.play(g["key"], "none", emu, None)
    if r.get("choose_emulator"):
        return f"{g.get('title')} tem mais de um emulador: " + ", ".join(o["id"] for o in r["choose_emulator"]) + f"\nUse: /play \"{g.get('title')}\" <emulador>"
    if r.get("error"):
        return {"ok": False, "text": r.get("message") or r["error"]}
    return f"Abrindo {g.get('title')}…" + (f"  ({r['hint']})" if r.get("hint") else "")


@cmd("stop", "Fecha um jogo aberto pelo Ludrix", args=[("jogo", "pedaço do nome (vazio = todos)", False)], examples=["/stop", '/stop "pes 2013"'], group="launcher", aliases=["kill"])
def _stop(t, a):
    act = t.n.sessions.active
    if not act:
        return "Nenhum jogo aberto pelo Ludrix agora."
    keys = list(act) if not a else [g["key"] for g in [t._game(" ".join(a))] if g and g["key"] in act]
    if not keys:
        return {"ok": False, "text": "Esse jogo não está aberto. Abertos: " + ", ".join(act)}
    for k in keys:
        t.n.stop_game(k)
    return "Fechando: " + ", ".join(keys)


@cmd("find", "Procura jogos na biblioteca e no catálogo", args=[("termo", "pedaço do nome", True)], examples=["/find zelda"], group="launcher", aliases=["search"])
def _find(t, a):
    q = " ".join(a).lower()
    lib = [(k, i) for k, i in t.n.store.library.items() if q in (i.get("title") or k).lower()]
    cat = [e for e in list(t.n.entries.values()) if q in e.title.lower() and e.key not in t.n.store.library]
    out = []
    if lib:
        out.append(f"Na biblioteca ({len(lib)}):")
        out += [f"  {i.get('title') or k:<50} {k}" for k, i in lib[:25]]
    if cat:
        out.append(f"Nas fontes ({len(cat)}):")
        out += [f"  {e.title:<50} {e.key}" for e in cat[:25]]
    return "\n".join(out) or "Nada com esse nome."


@cmd("library", "Resumo da biblioteca: quantos jogos, tempo total, últimos jogados", group="launcher", aliases=["lib", "stats"])
def _library(t, a):
    lib = t.n.store.library
    total = sum(float(i.get("playtime") or 0) for i in lib.values())
    roms = sum(1 for i in lib.values() if i.get("kind") == "rom")
    recent = sorted(((i.get("last_played") or 0, i.get("title") or k) for k, i in lib.items()), reverse=True)[:5]
    top = sorted(((float(i.get("playtime") or 0), i.get("title") or k) for k, i in lib.items()), reverse=True)[:5]
    out = [f"{len(lib)} jogos ({roms} ROMs, {len(lib) - roms} PC) · {total / 3600:.1f} h jogadas · {len(t.n.entries)} no catálogo das fontes"]
    if recent and recent[0][0]:
        out.append("Últimos: " + ", ".join(n for ts, n in recent if ts))
    if top and top[0][0]:
        out.append("Mais jogados: " + ", ".join(f"{n} ({p / 3600:.1f} h)" for p, n in top if p))
    return "\n".join(out)


@cmd("check", "Verifica a biblioteca: arquivos sumidos, pastas de trabalho e emuladores faltando", group="launcher", aliases=["verify", "verificar"])
def _check(t, a):
    r = t.n.library_check()
    out = [f"{r['total']} jogos conferidos · {len(r['items'])} com problema · {len(r.get('emus') or [])} console(s) sem emulador"]
    for i in r["items"][:40]:
        out.append(f"  !! {i['title']}: {i['problem']} — {i['path']}")
    for e in r.get("emus") or []:
        out.append(f"  !! {e['name']}: {e['count']} ROM(s) na biblioteca, emulador {e.get('emulator') or '?'} não instalado")
    if len(r["items"]) > 40:
        out.append(f"  … e mais {len(r['items']) - 40}")
    if r.get("dupes"):
        out.append(f"  {r['dupes']} grupo(s) com entradas repetidas — /dupes mostra")
    return "\n".join(out)


@cmd("origin", "Jogos por origem (Steam, Epic, GOG, Playnite, ROM, manual)", group="launcher", aliases=["origins", "sources_lib"])
def _origin(t, a):
    lib = t.n.store.library
    cnt: dict[str, int] = {}
    for k, i in lib.items():
        o = i.get("store_src") or ("ROM" if i.get("kind") == "rom" else ("Playnite" if i.get("source") == "playnite" else "Manual"))
        cnt[o] = cnt.get(o, 0) + 1
    if not cnt:
        return "Biblioteca vazia."
    return "\n".join(f"{n:4d}  {o}" for o, n in sorted(cnt.items(), key=lambda x: -x[1]))


@cmd("recent", "Últimas sessões: jogo, quando e quanto tempo", args=[("n", "quantas (padrão 10)", False)], group="launcher", aliases=["sessions"])
def _recent(t, a):
    n = int(a[0]) if a and str(a[0]).isdigit() else 10
    lib = t.n.store.library
    rows = sorted(((i.get("last_played") or 0, i.get("title") or k, i.get("last_session") or 0, i.get("play_count") or 0) for k, i in lib.items() if i.get("last_played")), reverse=True)[:n]
    if not rows:
        return "Nenhuma sessão registrada."
    return "\n".join(f"{time.strftime('%d/%m %H:%M', time.localtime(ts))}  {title}  ({sess / 60:.0f} min na última · {pc}x)" for ts, title, sess, pc in rows)


@cmd("size", "Tamanho da pasta de um jogo", args=[("jogo", "pedaço do nome ou chave", True)], group="launcher", aliases=["tamanho"])
def _size(t, a):
    g = t._game(" ".join(a))
    if not g:
        return "Jogo não encontrado. /find <termo> ajuda a achar a chave."
    r = t.n.folder_size(g["key"])
    if r.get("error"):
        return r["error"]
    mb = (r.get("size") or 0) / 2 ** 20
    size = f"{mb / 1024:.2f} GB" if mb >= 1024 else f"{mb:.1f} MB"
    return f"{g.get('title')}: {size}" + (f" · {r.get('files')} arquivos" if r.get("files") else "") + (" (parcial)" if r.get("partial") else "")


@cmd("played", "Marca um jogo como jogado hoje (ou /played <jogo> off para nunca jogado)", args=[("jogo", "pedaço do nome ou chave", True), ("off", "desmarca", False)], group="launcher", aliases=["jogado"])
def _played(t, a):
    off = bool(a) and a[-1].lower() in ("off", "nao", "não", "false")
    g = t._game(" ".join(a[:-1] if off else a))
    if not g:
        return "Jogo não encontrado. /find <termo> ajuda a achar a chave."
    r = t.n.mark_played(g["key"], not off)
    return (f"{g.get('title')}: marcado como nunca jogado" if off else f"{g.get('title')}: marcado como jogado hoje") if r.get("ok") else r.get("error", "falhou")


@cmd("undo", "Desfaz a última remoção da biblioteca (até 10 minutos)", group="launcher", aliases=["desfazer"])
def _undo(t, a):
    r = t.n.undo_remove()
    return f"{r.get('title') or r.get('key')} de volta à biblioteca" if r.get("ok") else r.get("error", "falhou")


@cmd("fav", "Marca ou desmarca um jogo como favorito", args=[("jogo", "pedaço do nome ou chave", True)], group="launcher", aliases=["favorito", "favorite"])
def _fav(t, a):
    g = t._game(" ".join(a))
    if not g:
        return "Jogo não encontrado. /find <termo> ajuda a achar a chave."
    r = t.n.toggle_favorite(g["key"])
    return f"{g.get('title')}: {'favorito' if r.get('fav') else 'não é mais favorito'}"


@cmd("backups", "Cópias da biblioteca: lista, /backups now cria uma agora, /backups restore <arquivo> devolve jogos que sumiram", args=[("acao", "now | restore", False), ("arquivo", "nome do arquivo (restore)", False)], group="launcher", aliases=["backup"])
def _backups(t, a):
    if a and a[0] == "now":
        r = t.n.library_backup_now()
        return f"Cópia criada: {r['file']} ({r['games']} jogos)" if r.get("ok") else r.get("error", "falhou")
    if a and a[0] == "restore":
        if len(a) < 2:
            return "Uso: /backups restore <arquivo>"
        r = t.n.library_restore(a[1])
        return f"{r['added']} jogo(s) devolvido(s) de {r['total']}" if r.get("ok") else r.get("error", "falhou")
    bs = t.n.library_backups()
    if not bs:
        return "Nenhuma cópia ainda. A primeira é feita ao abrir o launcher."
    return "\n".join(f"{time.strftime('%d/%m/%Y %H:%M', time.localtime(b['mtime']))}  {b['games']:4d} jogos  {b['file']}" for b in bs)


@cmd("dupes", "Jogos duplicados na biblioteca (mesmo nome ou mesmo executável)", group="launcher", aliases=["duplicados", "duplicates"])
def _dupes(t, a):
    gs = t.n.library_dupes()
    if not gs:
        return "Nenhum duplicado."
    out = [f"{len(gs)} grupo(s) com duplicados"]
    for g in gs[:30]:
        out.append("  " + g[0]["title"])
        for i in g:
            out.append(f"     {'ok ' if i['exists'] else '!! '}{i['key']}  {i['exe'] or '-'}")
    return "\n".join(out)


@cmd("config", "Lê ou altera uma configuração do Ludrix", args=[("chave", "nome da configuração (vazio = lista todas)", False), ("valor", "novo valor (true/false, número, texto)", False)],
     examples=["/config", "/config density", "/config density compact", "/config card_size 200", "/config theme file:steam"], group="launcher", aliases=["set", "cfg"])
def _config(t, a):
    from .store import DEFAULT_CONFIG
    cfg = t.n.store.config
    hidden = {"sgdb_key", "notifications", "flash_stats", "title_overrides", "game_args"}
    if not a:
        keys = sorted(k for k in DEFAULT_CONFIG if k not in hidden)
        return "\n".join(f"{k:<24} = {json.dumps(cfg.get(k), ensure_ascii=False)[:60]}" for k in keys)
    k = a[0]
    if k not in DEFAULT_CONFIG:
        import difflib
        m = difflib.get_close_matches(k, list(DEFAULT_CONFIG), n=3, cutoff=0.5)
        return {"ok": False, "text": f"Não existe a configuração \"{k}\"." + (f" Parecidas: {', '.join(m)}" if m else "")}
    if len(a) == 1:
        return f"{k} = {json.dumps('***' if k in hidden else cfg.get(k), ensure_ascii=False)}"
    raw = " ".join(a[1:])
    cur = DEFAULT_CONFIG[k]
    try:
        if isinstance(cur, bool):
            val = raw.strip().lower() in ("1", "true", "on", "sim", "yes", "ligado")
        elif isinstance(cur, int) and not isinstance(cur, bool):
            val = int(raw)
        elif isinstance(cur, float):
            val = float(raw)
        elif isinstance(cur, (list, dict)) or cur is None:
            val = json.loads(raw)
        else:
            val = raw
    except Exception:
        return usage(COMMANDS["config"], f"valor inválido pra {k} (esperado {type(cur).__name__})")
    t.n.set_config({k: val})
    need = k in t.n.RESTART_KEYS
    return {"text": f"{k} = {json.dumps(val, ensure_ascii=False)}" + ("   *Requer Reinicialização!" if need else ""), "ui": {"config": True}}


@cmd("theme", "Troca a cara ou o tema (ou lista os disponíveis)", args=[("id", "cara (grafite, aurora, ember, neon, duo, mono), system/dark/light ou file:<pasta>", False)], examples=["/theme", "/theme aurora", "/theme light", "/theme file:steam"], group="launcher")
def _theme(t, a):
    ths = t.n.themes()
    cur_face = t.n.current_face()
    if not a:
        faces = "\n".join(f"{x['id']:<28} {x['name']}" + ("   ← cara atual" if x["id"] == cur_face else "") for x in t.n.faces())
        return faces + "\n" + "\n".join(f"{x['id']:<28} {x['name']}" + ("   ← atual" if x["id"] == t.n.store.config.get("theme") else "") for x in ths)
    tid = a[0].lower()
    if tid in t.n.FACES:
        patch = {"face": tid, "accent": ""}
        if str(t.n.store.config.get("theme") or "").startswith("file:"):
            patch["theme"] = "system"
        t.n.set_config(patch)
        return {"text": f"Cara: {t.n.FACES[tid]['name']}", "ui": {"config": True}}
    if tid in ("system", "dark", "light"):
        t.n.set_config({"theme": tid})
        return {"text": f"Tema: {tid} ({t.n.FACES[cur_face]['name']})", "ui": {"config": True}}
    if not any(x["id"] == tid for x in ths):
        cand = [x for x in ths if tid.lower() in x["id"].lower() or tid.lower() in x["name"].lower()]
        if len(cand) == 1:
            tid = cand[0]["id"]
        else:
            return {"ok": False, "text": "Tema não encontrado." + (" Parecidos: " + ", ".join(x["id"] for x in cand[:6]) if cand else "")}
    t.n.set_config({"theme": tid, "accent": ""})
    return {"text": f"Tema: {tid}", "ui": {"config": True}}


@cmd("restart", "Reabre o Ludrix", group="launcher", danger=True, aliases=["reboot"])
def _restart(t, a):
    r = t.n.restart_app()
    return {"ok": not r.get("error"), "text": r.get("error") or "Reabrindo…"}


@cmd("quit", "Fecha o Ludrix", group="launcher", danger=True, aliases=["exit"])
def _quit(t, a):
    import threading
    threading.Timer(0.5, lambda: t.n.window_hooks.get("quit", lambda: os._exit(0))()).start()
    return "Até mais."


@cmd("log", "Mostra as últimas linhas do ludrix.log", args=[("linhas", "quantas (padrão 40)", False), ("filtro", "só linhas com esse texto", False)],
     examples=["/log", "/log 100", "/log 200 ERROR"], group="launcher", aliases=["tail"])
def _log(t, a):
    n = int(a[0]) if a and a[0].isdigit() else 40
    flt = " ".join(a[1:]) if len(a) > 1 else ""
    try:
        lines = paths.LOG_FILE.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        return "Sem log ainda."
    if flt:
        lines = [x for x in lines if flt.lower() in x.lower()]
    return "\n".join(lines[-n:]) or "(vazio)"


@cmd("openfolder", "Abre uma pasta do Ludrix no Explorer", args=[("qual", "root | data | games | downloads | emulation | themes | updates | cache | log", True)],
     examples=["/openfolder data", "/openfolder log"], group="launcher", aliases=["folder"])
def _openfolder(t, a):
    m = {"root": paths.ROOT, "data": paths.DATA, "games": t.n.store.games_dir(), "downloads": paths.DOWNLOADS, "emulation": paths.EMU, "themes": paths.THEMES,
         "updates": paths.UPDATES, "cache": paths.CACHE, "log": paths.LOG_FILE, "tools": paths.TOOLS, "bios": paths.EMU_BIOS}
    p = m.get(a[0].lower())
    if not p:
        return usage(COMMANDS["openfolder"], f"não conheço \"{a[0]}\"")
    if not p.exists():
        return {"ok": False, "text": f"Não existe ainda: {p}"}
    t._open(str(p))
    return f"Abrindo {p}"


@cmd("cache", "Mostra o tamanho do cache (ou limpa: /cache clear)", args=[("clear", "escreva clear pra limpar miniaturas/web", False)], examples=["/cache", "/cache clear"], group="launcher")
def _cache(t, a):
    if a and a[0].lower() == "clear":
        r = t.n.clear_cache(["web", "thumbs"])
        return "Cache limpo. " + json.dumps(r, ensure_ascii=False)
    info = t.n.cache_info()
    return "\n".join(f"{k:<12} {_human(v) if isinstance(v, (int, float)) else v}" for k, v in info.items())


@cmd("sources", "Lista as fontes da Store (e liga/desliga: /sources on|off <id>)", args=[("ação", "on | off | reload", False), ("id", "id da fonte", False)],
     examples=["/sources", "/sources off site-ankergames", "/sources reload"], group="launcher", aliases=["repos"])
def _sources(t, a):
    if not a:
        rs = t.n.repos.list()
        return "\n".join(f"{'●' if r['enabled'] else '○'} {r['id']:<28} {r.get('name', '')}  [{r.get('type')}]" for r in rs) or "Nenhuma fonte. Cole um link em Store → Fontes."
    act = a[0].lower()
    if act == "reload":
        t.n.reload_catalog(True)
        return "Recarregando catálogo…"
    if act in ("on", "off") and len(a) > 1:
        t.n.repos.set_enabled(a[1], act == "on")
        t.n.reload_catalog(False)
        return f"Fonte {a[1]}: {'ligada' if act == 'on' else 'desligada'}"
    return usage(COMMANDS["sources"], "ação inválida")


@cmd("unlockludrixpro", "", args=[("código", "", True)], group="launcher", hidden=True, aliases=["unlock"])
def _unlock(t, a):
    code = " ".join(a).strip().lower()
    if hashlib.sha256(code.encode()).hexdigest() != "230ceb43cdbcd0ed5e87395a9701bc4134ef7346ff9d8839120ca5c2d90783b1":
        return {"ok": False, "text": "Código inválido."}
    return {"text": "\n".join(["", "      ___", "     /   \\", "    |  o  |    A lanterna negra está acesa.", "     \\___/", "      | |", "      |_|", ""])}


@cmd("factoryreset", "Apaga TUDO que o Ludrix criou (config, biblioteca, caches, fontes, temas, downloads, pastas de jogos/emulação) e reabre como na primeira vez",
     args=[("confirmar", "escreva APAGAR TUDO pra executar", True)], examples=["/factoryreset APAGAR TUDO"], group="launcher", danger=True, aliases=["reset", "wipe"])
def _factoryreset(t, a):
    if " ".join(a).strip().upper() != "APAGAR TUDO":
        return {"ok": False, "text": "Isso apaga permanentemente configurações, biblioteca, caches, fontes, temas, downloads e as pastas games/ e emulation/.\n"
                                     "Não tem volta. Se tem certeza: /factoryreset APAGAR TUDO"}
    r = t.n.factory_reset()
    return {"ok": not r.get("error"), "text": r.get("error") or "Fechando pra apagar tudo e reabrir zerado…"}


@cmd("console", "Abre o Modo Console (programa separado; esta janela fecha)", examples=["/console"], group="launcher")
def _console(t, a):
    r = t.n.console_swap("console", force=True)
    return "Abrindo o Modo Console…" if r.get("ok") else f"Não abriu: {r.get('error')}"


@cmd("analyze", "Analisa um link como a aba Fontes faz (direto / torrent / ignorados)", args=[("url", "endereço da página", True)], examples=["/analyze https://site.com/jogos"], group="launcher")
def _analyze(t, a):
    r = t.n.detect(a[0])
    if r.get("error") and not r.get("results"):
        return {"ok": False, "text": r["error"]}
    if not r.get("results"):
        return "Nada aproveitável nesse link."
    x = r["results"][0]
    out = [f"{x['title']}: {x.get('detail', '')}"]
    for g in (r.get("games") or [])[:30]:
        out.append(f"  {g['title']:<48} {'direto ' if g.get('files') else ''}{'torrent' if g.get('magnet') or g.get('torrent_url') else ''}")
    return "\n".join(out)


@cmd("emulators", "Emuladores por console (instalados e padrão)", args=[("console", "id do sistema, ex.: nds", False)], examples=["/emulators", "/emulators nds"], group="launcher", aliases=["emu"])
def _emulators(t, a):
    st = t.n.emu.status()
    rows = []
    for sid, s in st["systems"].items():
        if a and sid != a[0]:
            continue
        inst = [o["id"] + ("*" if o["default"] else "") for o in s.get("installed_options", [])]
        rows.append(f"{sid:<10} {s['name']:<22} {', '.join(inst) or '— nenhum instalado'}   ({s.get('rom_count', 0)} jogos)")
    return "\n".join(rows) + "\n(* = padrão do console. Pra vários emuladores no mesmo console: Emular → ⚙ do console.)"


@cmd("gamemode", "Modo Game: /gamemode on liga agora (plano de energia, apps da lista, Ludrix quieto), /gamemode off desliga", args=[("on|off|status", "ação", False)], examples=["/gamemode on", "/gamemode status"], group="launcher")
def _gamemode(t, a):
    act = (a[0] if a else "status").lower()
    if act == "on":
        return json.dumps(t.n.gamemode_run(), ensure_ascii=False)
    if act == "off":
        return json.dumps(t.n.gamemode_stop(), ensure_ascii=False)
    return f"Modo Game {'ATIVO' if t.n.gamemode.active else 'inativo'}. " + json.dumps(t.n.gamemode.snapshot(), ensure_ascii=False)[:600]


@cmd("hardware", "Resumo do PC (CPU, RAM, GPU, discos)", group="windows", aliases=["hw", "specs"])
def _hardware(t, a):
    hw = t.n.hardware()
    if hw.get("error"):
        return {"ok": False, "text": hw["error"]}
    gp = ", ".join(g.get("name", "") for g in hw.get("gpus", [])) or "?"
    ram = hw.get("ram") or {}
    return (f"CPU: {hw.get('cpu', {}).get('name', '?')} ({hw.get('cpu', {}).get('cores', '?')} núcleos)\nRAM: {ram.get('total_gb', '?')} GB\nGPU: {gp}\n"
            f"SO: {hw.get('os', {}).get('name', '?')}\nTela: {hw.get('screen', {}).get('w', '?')}×{hw.get('screen', {}).get('h', '?')}\nNível: {(hw.get('tier') or {}).get('level', '?')} — {(hw.get('tier') or {}).get('hint', '')}")


@cmd("forcebackup", "Faz um backup completo agora (config, biblioteca, fontes, temas, capas) num .zip", args=[("destino", "pasta ou arquivo .zip (padrão: updates/backup)", False)],
     examples=["/forcebackup", "/forcebackup D:\\backups"], group="backup", aliases=["backup"])
def _forcebackup(t, a):
    r = t.n.backup_export(a[0] if a else None)
    return {"ok": not r.get("error"), "text": r.get("error") or f"Backup salvo: {r['path']} ({_human(r['size'])}, {r['files']} arquivos)", "path": r.get("path")}


@cmd("exportbackup", "Igual a /forcebackup, mas abre a pasta ao terminar", args=[("destino", "pasta ou .zip", False)], group="backup")
def _exportbackup(t, a):
    r = t.n.backup_export(a[0] if a else None)
    if r.get("error"):
        return {"ok": False, "text": r["error"]}
    t._open(str(Path(r["path"]).parent))
    return f"Backup salvo: {r['path']}"


@cmd("importbackup", "Restaura um backup .zip do Ludrix (pede confirmação; reabre no fim)", args=[("arquivo", "caminho do .zip (vazio = escolher)", False)],
     examples=["/importbackup", '/importbackup "D:\\backups\\ludrix-backup-2026-09-06.zip"'], group="backup", danger=True)
def _importbackup(t, a):
    r = t.n.backup_import(a[0] if a else None)
    return {"ok": not r.get("error"), "text": r.get("error") or ("Cancelado." if r.get("cancel") else f"Restaurado: {r['files']} arquivos. Reabrindo o Ludrix…")}


@cmd("listbackups", "Lista os backups em updates/backup", group="backup")
def _listbackups(t, a):
    d = paths.UPDATES / "backup"
    fs = sorted(d.glob("ludrix-backup-*.zip"), reverse=True) if d.exists() else []
    return "\n".join(f"{f.name:<40} {_human(f.stat().st_size)}" for f in fs) or "Nenhum backup ainda. /forcebackup cria um."


@cmd("terminalsettings", "Abre as configurações do terminal (fonte, tamanho, opacidade, cor)", group="ajuda", aliases=["tsettings"])
def _terminalsettings(t, a):
    return {"ui": {"terminal_settings": True}, "text": ""}


@cmd("download", "Baixa um link de hospedagem (Drive, MEGA, Gofile, MediaFire, Pixeldrain, 1fichier…) e instala como jogo",
     args=[("link", "URL do arquivo ou pasta", True), ("nome", "nome do jogo (opcional)", False)],
     examples=['/download https://gofile.io/d/abc123', '/download https://mega.nz/file/xxx#yyy "Meu Jogo"'], group="launcher", aliases=["dl", "fetch"])
def _download(t, a):
    if not a:
        return "Uso: /download <link> [nome]"
    url, name = a[0], " ".join(a[1:]).strip() or None
    p = t.n.link_preview(url)
    if p.get("error"):
        return f"Não deu: {p['error']}"
    r = t.n.link_download(url, name or p.get("title"), "pc", "pc", None)
    if r.get("error"):
        return f"Não deu: {r['error']}"
    files = "\n".join(f"  {f['name']}  {human_size(f['size']) if f['size'] else ''}" for f in p["files"][:12])
    return f"{p['host']} → {name or p['title']}\n{files}\nBaixando pra downloads\\ — acompanhe na Fila."


@cmd("open", "Abre um programa do Windows, uma pasta do Ludrix ou um site", args=[("alvo", "ex.: notepad, calc, games, downloads, https://…", True)],
     examples=["/open notepad", "/open https://archive.org", "/open downloads"], group="windows", aliases=["start"])
def _openx(t, a):
    target = " ".join(a).strip()
    if re.search(r"[&|;`$<>]", target):
        return {"ok": False, "text": "Caracteres não permitidos."}
    if re.match(r"^https?://", target, re.I):
        r = t.n.open_url(target)
        return f"Abrindo {target}" if r.get("ok") else {"ok": False, "text": r.get("error", "Não abriu")}
    alias = {"games": t.n.store.games_dir() or paths.GAMES, "jogos": t.n.store.games_dir() or paths.GAMES, "downloads": paths.DOWNLOADS,
             "roms": paths.EMU_GAMES, "emulation": paths.EMU, "themes": paths.THEMES, "temas": paths.THEMES, "root": paths.ROOT, "ludrix": paths.ROOT}
    p = Path(alias.get(target.lower(), target))
    if p.exists():
        r = t.n.open_path(str(p if p.is_dir() else p.parent))
        return f"Abrindo {p}" if r.get("ok") else {"ok": False, "text": r.get("error", "Não abriu")}
    t._win_only()
    name = target.lower().removesuffix(".exe")
    allowed = {"notepad", "calc", "mspaint", "explorer", "cmd", "powershell", "taskmgr", "control", "snippingtool", "wordpad", "charmap", "msinfo32", "dxdiag", "regedit", "devmgmt.msc", "ms-settings:"}
    exe = shutil.which(name) or shutil.which(name + ".exe")
    if name in allowed or (exe and Path(exe).resolve().parts[:3] == Path(os.environ.get("SystemRoot", r"C:\Windows")).resolve().parts[:3]):
        subprocess.Popen(["explorer.exe", target] if target.endswith((".msc", ":")) else [exe or name], creationflags=0x08000000)
        return f"Abrindo {target}"
    return {"ok": False, "text": "Só abro programas do Windows, pastas do Ludrix ou sites. Use o caminho completo de uma pasta do Ludrix."}


@cmd("random", "Sorteia um jogo da biblioteca pra você jogar agora", args=[("filtro", "installed | rom | pc | never (nunca jogados)", False)], examples=["/random", "/random never"], group="diversão", aliases=["roll", "dice"])
def _random(t, a):
    import random
    lib = list(t.n.store.library.items())
    f = (a[0] if a else "").lower()
    if f == "rom":
        lib = [x for x in lib if x[1].get("kind") == "rom"]
    elif f == "pc":
        lib = [x for x in lib if x[1].get("kind") != "rom"]
    elif f == "never":
        lib = [x for x in lib if not x[1].get("last_played")]
    if not lib:
        return "Nada pra sortear com esse filtro."
    k, i = random.choice(lib)
    return {"text": f"🎲 {i.get('title') or k}   ( /play \"{i.get('title') or k}\" pra abrir )".replace("🎲", ">>"), "ui": {"open_game": k}}


@cmd("history", "Mostra os últimos comandos digitados", group="ajuda")
def _history(t, a):
    return "\n".join(f"{i + 1:>3}  {x}" for i, x in enumerate(t.history[-30:])) or "(vazio)"
