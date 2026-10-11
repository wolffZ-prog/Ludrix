from __future__ import annotations

import logging
import os
import shutil
import subprocess
import zipfile
from pathlib import Path

log = logging.getLogger("ludrix.emuguide")


def _env(name: str) -> Path:
    return Path(os.environ.get(name) or (Path.home() / "AppData" / "Roaming"))


def _docs() -> Path:
    return Path.home() / "Documents"


def user_dir(emu_id: str, exe: Path | None) -> Path | None:
    d = exe.parent if exe else None
    if emu_id in ("eden", "citron"):
        if d and (d / "user").is_dir():
            return d / "user"
        return _env("APPDATA") / emu_id
    if emu_id in ("pcsx2", "aethersx2"):
        return d if d and (d / "portable.ini").exists() else _docs() / "PCSX2"
    if emu_id == "duckstation":
        return d if d and (d / "portable.txt").exists() else _docs() / "DuckStation"
    if emu_id == "rpcs3":
        return d
    if emu_id == "cemu":
        if d and (d / "portable").is_dir():
            return d / "portable"
        return _env("APPDATA") / "Cemu"
    if emu_id in ("azahar", "citra"):
        if d and (d / "user").is_dir():
            return d / "user"
        return _env("APPDATA") / ("Azahar" if emu_id == "azahar" else "Lime3DS")
    if emu_id == "flycast":
        return (d / "data") if d else None
    if emu_id == "mednafen":
        return (d / "firmware") if d else None
    if emu_id == "yabause":
        return (d / "bios") if d else None
    if emu_id == "xemu":
        return d
    return d


def _has(p: Path, *globs: str, min_size: int = 0) -> bool:
    try:
        for g in globs:
            for f in p.glob(g):
                if f.is_file() and f.stat().st_size >= min_size:
                    return True
                if f.is_dir() and g.endswith(".nca"):
                    return True
    except OSError:
        pass
    return False


GUIDES: dict[str, dict] = {
    "switch": {
        "title": "Nintendo Switch — keys e firmware",
        "intro": "O emulador precisa das chaves (prod.keys) e do firmware do console. Os dois saem do seu próprio Switch; o Ludrix não fornece nem baixa esses arquivos.",
        "steps": [
            "No Switch, com o Lockpick_RCM gere o arquivo prod.keys. Com o mesmo Lockpick (opção Dump firmware) ou o TegraExplorer copie o firmware (uma pasta com vários arquivos .nca, normalmente compactada em .zip).",
            "Clique em Instalar prod.keys e escolha o arquivo prod.keys (title.keys é opcional e entra pelo mesmo botão).",
            "Clique em Instalar firmware e escolha o .zip do firmware ou a pasta com os arquivos .nca.",
            "Abra o emulador uma vez pelo botão Abrir para ele reconhecer os arquivos. Depois, os jogos abrem direto pelo Jogar.",
            "Jogos em .nsp/.xci entram pela pasta de ROMs do console. Atualizações e DLC (.nsp) são instaladas no próprio emulador: Arquivo › Instalar arquivos no NAND.",
        ],
        "reqs": [
            {"id": "keys", "label": "prod.keys", "pick": "file", "exts": [".keys"], "sub": "keys", "optional": False},
            {"id": "firmware", "label": "Firmware (arquivos .nca)", "pick": "any", "exts": [".zip"], "sub": "nand/system/Contents/registered", "optional": False},
        ],
    },
    "ps2": {
        "title": "PlayStation 2 — BIOS",
        "intro": "O PCSX2 só abre jogos com a BIOS do console. Ela sai do seu próprio PS2.",
        "steps": [
            "No PS2, com FreeMcBoot e o programa biosdrain, copie a BIOS para um pendrive (arquivos .bin, .rom0, .nvm e outros).",
            "Clique em Instalar BIOS e escolha o arquivo .bin principal (ou o .zip com todos).",
            "Se o PCSX2 reclamar, abra-o pelo botão Abrir e em Configurações › BIOS escolha a BIOS instalada.",
        ],
        "reqs": [{"id": "bios", "label": "BIOS (.bin)", "pick": "file", "exts": [".bin", ".zip"], "sub": "bios", "optional": False}],
    },
    "ps1": {
        "title": "PlayStation — BIOS",
        "intro": "O DuckStation precisa da BIOS do console (scph1001.bin, scph5501.bin, scph7001.bin ou outra da sua região).",
        "steps": [
            "Copie a BIOS do seu PlayStation (ou PS2, que também contém a BIOS do PS1 via biosdrain).",
            "Clique em Instalar BIOS e escolha o arquivo .bin (ou um .zip com vários).",
            "Com mais de uma BIOS, o DuckStation escolhe pela região do jogo.",
        ],
        "reqs": [{"id": "bios", "label": "BIOS (scph*.bin)", "pick": "file", "exts": [".bin", ".zip"], "sub": "bios", "optional": False}],
    },
    "ps3": {
        "title": "PlayStation 3 — firmware",
        "intro": "O RPCS3 precisa do firmware oficial do PS3 (arquivo PS3UPDAT.PUP), distribuído gratuitamente pela Sony.",
        "steps": [
            "Baixe o arquivo PS3UPDAT.PUP na página de atualização de software do PS3 no site da PlayStation.",
            "Clique em Instalar firmware e escolha o PS3UPDAT.PUP. O RPCS3 abre, instala e fecha sozinho (leva alguns minutos).",
            "Jogos ficam em pastas (PS3_GAME/USRDIR/EBOOT.BIN); arquivos .pkg são instalados no próprio RPCS3 em Arquivo › Instalar pacotes.",
        ],
        "reqs": [{"id": "firmware", "label": "Firmware (PS3UPDAT.PUP)", "pick": "file", "exts": [".pup"], "sub": "dev_flash", "optional": False}],
    },
    "wiiu": {
        "title": "Wii U — keys",
        "intro": "O Cemu abre jogos descriptografados (.rpx/.wua) sem nada extra. Para jogos criptografados (pastas com code/content/meta ou .wud/.wux) precisa do arquivo keys.txt com as chaves dos seus títulos.",
        "steps": [
            "Com o seu Wii U e o dumpling (ou outro dumper), extraia os jogos; o keys.txt é gerado junto (ou copie as chaves para o keys.txt do Cemu).",
            "Clique em Instalar keys.txt e escolha o arquivo.",
            "Para a loja/online use a conta do próprio Cemu; o Ludrix só abre os jogos.",
        ],
        "reqs": [{"id": "keys", "label": "keys.txt", "pick": "file", "exts": [".txt"], "sub": "", "optional": True}],
    },
    "3ds": {
        "title": "Nintendo 3DS — chaves (opcional)",
        "intro": "O Azahar abre ROMs descriptografadas (.3ds/.cci decrypted, .cxi) sem nada extra. Para ROMs criptografadas e .cia precisa do aes_keys.txt do seu 3DS.",
        "steps": [
            "No 3DS, com o GodMode9, gere o aes_keys.txt (ou dumpe os jogos já descriptografados, o que dispensa as chaves).",
            "Clique em Instalar aes_keys.txt e escolha o arquivo.",
            "Jogos .cia são instalados no próprio Azahar: Arquivo › Instalar CIA.",
        ],
        "reqs": [{"id": "keys", "label": "aes_keys.txt", "pick": "file", "exts": [".txt"], "sub": "sysdata", "optional": True}],
    },
    "xbox": {
        "title": "Xbox — BIOS e disco",
        "intro": "O xemu precisa de três arquivos: a BIOS (mcpx_1.0.bin e Complex_4627.bin, do seu Xbox) e uma imagem de disco rígido (xbox_hdd.qcow2, distribuída pelo próprio xemu).",
        "steps": [
            "Abra o xemu pelo botão Abrir. Na primeira vez ele mostra um assistente pedindo cada arquivo.",
            "Em MCPX escolha mcpx_1.0.bin; em Flash escolha Complex_4627.bin; em Hard disk escolha xbox_hdd.qcow2 (baixado na página de releases do xemu, arquivo xbox_hdd.qcow2.zip).",
            "O EEPROM é criado sozinho. Depois disso, os jogos (.iso no formato xiso) abrem pelo Jogar.",
        ],
        "reqs": [{"id": "bios", "label": "BIOS e disco configurados no xemu", "pick": "", "exts": [], "sub": "", "optional": False}],
    },
    "dc": {
        "title": "Dreamcast — BIOS (opcional)",
        "intro": "O Flycast funciona sem BIOS na maioria dos jogos. Para o menu original do console e alguns jogos, coloque dc_boot.bin e dc_flash.bin.",
        "steps": [
            "Copie dc_boot.bin e dc_flash.bin do seu Dreamcast.",
            "Clique em Instalar BIOS e escolha os arquivos (um por vez ou um .zip com os dois).",
        ],
        "reqs": [{"id": "bios", "label": "dc_boot.bin e dc_flash.bin", "pick": "file", "exts": [".bin", ".zip"], "sub": "", "optional": True}],
    },
    "saturn": {
        "title": "Sega Saturn — BIOS",
        "intro": "Saturn precisa da BIOS do console (sega_101.bin para o Japão ou mpr-17933.bin para América/Europa).",
        "steps": [
            "Copie a BIOS do seu Saturn.",
            "Clique em Instalar BIOS e escolha o arquivo .bin.",
            "No Kronos, se necessário, aponte a BIOS em Configurações › Geral › BIOS.",
        ],
        "reqs": [{"id": "bios", "label": "BIOS (sega_101.bin / mpr-17933.bin)", "pick": "file", "exts": [".bin", ".zip"], "sub": "", "optional": False}],
    },
    "arcade": {
        "title": "Arcade — conjuntos de ROM",
        "intro": "Arcade não usa BIOS única: cada jogo é um .zip que precisa bater com a versão do emulador. Alguns jogos dependem de um .zip de BIOS do sistema (neogeo.zip, cps2 e outros).",
        "steps": [
            "Use conjuntos de ROM da mesma versão do emulador instalado (MAME ou FBNeo).",
            "Deixe os .zip de BIOS (neogeo.zip, pgm.zip, etc.) na mesma pasta dos jogos; eles não aparecem na biblioteca, só servem de apoio.",
            "Não renomeie os arquivos: o emulador identifica o jogo pelo nome do .zip.",
        ],
        "reqs": [],
    },
}


def _check(sid: str, emu_id: str, exe: Path | None, req: dict) -> dict:
    ud = user_dir(emu_id, exe)
    rid = req["id"]
    ok = False
    where = ""
    if ud:
        if sid == "switch":
            if rid == "keys":
                where = str(ud / "keys" / "prod.keys")
                ok = (ud / "keys" / "prod.keys").is_file()
            else:
                reg = ud / "nand" / "system" / "Contents" / "registered"
                where = str(reg)
                ok = _has(reg, "*.nca")
        elif sid in ("ps2", "ps1"):
            b = ud / "bios"
            where = str(b)
            ok = _has(b, "*.bin", "*.BIN", "*.rom0", "*.rom", min_size=256 * 1024)
        elif sid == "ps3":
            where = str(ud / "dev_flash")
            ok = (ud / "dev_flash" / "vsh" / "module").is_dir()
        elif sid == "wiiu":
            k = ud / "keys.txt"
            where = str(k)
            ok = k.is_file() and k.stat().st_size > 600
        elif sid == "3ds":
            where = str(ud / "sysdata" / "aes_keys.txt")
            ok = (ud / "sysdata" / "aes_keys.txt").is_file()
        elif sid == "dc":
            where = str(ud)
            ok = (ud / "dc_boot.bin").is_file()
        elif sid == "saturn":
            where = str(ud)
            ok = _has(ud, "sega_101.bin", "mpr-17933.bin", "*.bin", min_size=256 * 1024)
        elif sid == "xbox":
            ok, where = _xemu_ok(ud)
    return {**req, "ok": bool(ok), "where": where}


def _xemu_ok(d: Path) -> tuple[bool, str]:
    cands = [d / "xemu.toml", _env("APPDATA") / "xemu" / "xemu" / "xemu.toml", _env("LOCALAPPDATA") / "xemu" / "xemu" / "xemu.toml"]
    for c in cands:
        if c.is_file():
            try:
                txt = c.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            paths_ = {}
            for ln in txt.splitlines():
                ln = ln.strip()
                for k in ("bootrom_path", "flashrom_path", "hdd_path"):
                    if ln.startswith(k):
                        paths_[k] = ln.split("=", 1)[1].strip().strip("'\"")
            if all(paths_.get(k) and Path(paths_[k]).is_file() for k in ("bootrom_path", "flashrom_path", "hdd_path")):
                return True, str(c)
            return False, str(c)
    return False, str(cands[0])


def status(sid: str, emu_id: str, exe: Path | None) -> dict | None:
    g = GUIDES.get(sid)
    if not g:
        return None
    reqs = [_check(sid, emu_id, exe, r) for r in g["reqs"]]
    return {"system": sid, "emulator": emu_id, "title": g["title"], "intro": g["intro"], "steps": g["steps"], "reqs": reqs,
            "user_dir": str(user_dir(emu_id, exe) or ""), "ready": all(r["ok"] or r["optional"] for r in reqs), "has_guide": True}


def missing_required(sid: str, emu_id: str, exe: Path | None) -> list[str]:
    st = status(sid, emu_id, exe)
    if not st:
        return []
    return [r["label"] for r in st["reqs"] if not r["ok"] and not r["optional"]]


def _copy_into(src: Path, dest: Path, exts: tuple[str, ...], rename: str | None = None) -> int:
    dest.mkdir(parents=True, exist_ok=True)
    n = 0
    if src.is_dir():
        for f in src.rglob("*"):
            if f.is_file() and (not exts or f.suffix.lower() in exts):
                shutil.copy2(f, dest / f.name)
                n += 1
        return n
    if src.suffix.lower() == ".zip":
        with zipfile.ZipFile(src) as z:
            for m in z.infolist():
                if m.is_dir():
                    continue
                name = Path(m.filename).name
                if not name or (exts and Path(name).suffix.lower() not in exts):
                    continue
                target = (dest / name).resolve()
                if dest.resolve() not in target.parents:
                    continue
                with z.open(m) as s, open(target, "wb") as o:
                    shutil.copyfileobj(s, o)
                n += 1
        return n
    shutil.copy2(src, dest / (rename or src.name))
    return 1


def install(sid: str, emu_id: str, exe: Path | None, what: str, path: str) -> dict:
    g = GUIDES.get(sid)
    if not g:
        return {"error": "Este console não tem guia"}
    src = Path(path)
    if not src.exists():
        return {"error": "Arquivo não encontrado"}
    ud = user_dir(emu_id, exe)
    if not ud:
        return {"error": "Emulador não instalado. Instale ou aponte o executável primeiro."}
    try:
        if sid == "switch" and what == "keys":
            name = src.name.lower()
            if name not in ("prod.keys", "title.keys") and src.suffix.lower() != ".zip":
                name = "prod.keys"
            n = _copy_into(src, ud / "keys", (".keys",), rename=None if src.suffix.lower() == ".zip" else name)
        elif sid == "switch" and what == "firmware":
            reg = ud / "nand" / "system" / "Contents" / "registered"
            n = _copy_into(src, reg, (".nca",))
            if n == 0:
                return {"error": "Nenhum arquivo .nca encontrado nesse firmware"}
        elif sid in ("ps2", "ps1") and what == "bios":
            n = _copy_into(src, ud / "bios", (".bin", ".rom0", ".rom1", ".rom2", ".erom", ".nvm", ".mec"))
        elif sid == "ps3" and what == "firmware":
            if not exe or not exe.exists():
                return {"error": "RPCS3 não encontrado"}
            flags = 0x08000000 if os.name == "nt" else 0
            subprocess.Popen([str(exe), "--installfw", str(src)], cwd=str(exe.parent), creationflags=flags)
            return {"ok": True, "started": True, "message": "O RPCS3 abriu para instalar o firmware. Quando terminar, feche-o e volte aqui."}
        elif sid == "wiiu" and what == "keys":
            n = _copy_into(src, ud, (".txt",), rename="keys.txt")
        elif sid == "3ds" and what == "keys":
            n = _copy_into(src, ud / "sysdata", (".txt",), rename="aes_keys.txt")
        elif sid == "dc" and what == "bios":
            n = _copy_into(src, ud, (".bin",))
        elif sid == "saturn" and what == "bios":
            n = _copy_into(src, ud, (".bin",))
        else:
            return {"error": "Esse item não tem instalação automática; siga os passos do guia."}
    except (OSError, zipfile.BadZipFile) as e:
        return {"error": f"Não consegui copiar: {e}"}
    log.info("guia %s/%s: %d arquivo(s) de %s", sid, what, n, src)
    return {"ok": True, "copied": n}
