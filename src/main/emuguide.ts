import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cp from 'node:child_process';
import AdmZip from 'adm-zip';
import * as log from './log';

const WIN = process.platform === 'win32';
const env = (name: string) => process.env[name] || path.join(os.homedir(), 'AppData', 'Roaming');
const docs = () => path.join(os.homedir(), 'Documents');
const isDir = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p: string) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const size = (p: string) => { try { return fs.statSync(p).size; } catch { return 0; } };

export function userDir(emuId: string, exe: string | null): string | null {
    const d = exe ? path.dirname(exe) : null;
    if (['eden', 'citron'].includes(emuId)) {
        if (d && isDir(path.join(d, 'user')))
            return path.join(d, 'user');
        return path.join(env('APPDATA'), emuId);
    }
    if (['pcsx2', 'aethersx2'].includes(emuId))
        return d && fs.existsSync(path.join(d, 'portable.ini')) ? d : path.join(docs(), 'PCSX2');
    if (emuId === 'duckstation')
        return d && fs.existsSync(path.join(d, 'portable.txt')) ? d : path.join(docs(), 'DuckStation');
    if (emuId === 'rpcs3')
        return d;
    if (emuId === 'cemu') {
        if (d && isDir(path.join(d, 'portable')))
            return path.join(d, 'portable');
        return path.join(env('APPDATA'), 'Cemu');
    }
    if (['azahar', 'citra'].includes(emuId)) {
        if (d && isDir(path.join(d, 'user')))
            return path.join(d, 'user');
        return path.join(env('APPDATA'), emuId === 'azahar' ? 'Azahar' : 'Lime3DS');
    }
    if (emuId === 'flycast')
        return d ? path.join(d, 'data') : null;
    if (emuId === 'mednafen')
        return d ? path.join(d, 'firmware') : null;
    if (emuId === 'yabause')
        return d ? path.join(d, 'bios') : null;
    return d;
}

function globRe(g: string) {
    return new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', WIN ? 'i' : '');
}

function has(p: string, globs: string[], minSize = 0): boolean {
    let names: string[];
    try {
        names = fs.readdirSync(p);
    }
    catch {
        return false;
    }
    for (const g of globs) {
        const re = globRe(g);
        for (const n of names) {
            if (!re.test(n))
                continue;
            const f = path.join(p, n);
            if (isFile(f) && size(f) >= minSize)
                return true;
            if (isDir(f) && g.endsWith('.nca'))
                return true;
        }
    }
    return false;
}

export const GUIDES: Record<string, any> = {
    switch: {
        title: 'Nintendo Switch — keys e firmware',
        intro: 'O emulador precisa das chaves (prod.keys) e do firmware do console. Os dois saem do seu próprio Switch; o Ludrix não fornece nem baixa esses arquivos.',
        steps: [
            'No Switch, com o Lockpick_RCM gere o arquivo prod.keys. Com o mesmo Lockpick (opção Dump firmware) ou o TegraExplorer copie o firmware (uma pasta com vários arquivos .nca, normalmente compactada em .zip).',
            'Clique em Instalar prod.keys e escolha o arquivo prod.keys (title.keys é opcional e entra pelo mesmo botão).',
            'Clique em Instalar firmware e escolha o .zip do firmware ou a pasta com os arquivos .nca.',
            'Abra o emulador uma vez pelo botão Abrir para ele reconhecer os arquivos. Depois, os jogos abrem direto pelo Jogar.',
            'Jogos em .nsp/.xci entram pela pasta de ROMs do console. Atualizações e DLC (.nsp) são instaladas no próprio emulador: Arquivo › Instalar arquivos no NAND.',
        ],
        reqs: [
            { id: 'keys', label: 'prod.keys', pick: 'file', exts: ['.keys'], sub: 'keys', optional: false },
            { id: 'firmware', label: 'Firmware (arquivos .nca)', pick: 'any', exts: ['.zip'], sub: 'nand/system/Contents/registered', optional: false },
        ],
    },
    ps2: {
        title: 'PlayStation 2 — BIOS',
        intro: 'O PCSX2 só abre jogos com a BIOS do console. Ela sai do seu próprio PS2.',
        steps: [
            'No PS2, com FreeMcBoot e o programa biosdrain, copie a BIOS para um pendrive (arquivos .bin, .rom0, .nvm e outros).',
            'Clique em Instalar BIOS e escolha o arquivo .bin principal (ou o .zip com todos).',
            'Se o PCSX2 reclamar, abra-o pelo botão Abrir e em Configurações › BIOS escolha a BIOS instalada.',
        ],
        reqs: [{ id: 'bios', label: 'BIOS (.bin)', pick: 'file', exts: ['.bin', '.zip'], sub: 'bios', optional: false }],
    },
    ps1: {
        title: 'PlayStation — BIOS',
        intro: 'O DuckStation precisa da BIOS do console (scph1001.bin, scph5501.bin, scph7001.bin ou outra da sua região).',
        steps: [
            'Copie a BIOS do seu PlayStation (ou PS2, que também contém a BIOS do PS1 via biosdrain).',
            'Clique em Instalar BIOS e escolha o arquivo .bin (ou um .zip com vários).',
            'Com mais de uma BIOS, o DuckStation escolhe pela região do jogo.',
        ],
        reqs: [{ id: 'bios', label: 'BIOS (scph*.bin)', pick: 'file', exts: ['.bin', '.zip'], sub: 'bios', optional: false }],
    },
    ps3: {
        title: 'PlayStation 3 — firmware',
        intro: 'O RPCS3 precisa do firmware oficial do PS3 (arquivo PS3UPDAT.PUP), distribuído gratuitamente pela Sony.',
        steps: [
            'Baixe o arquivo PS3UPDAT.PUP na página de atualização de software do PS3 no site da PlayStation.',
            'Clique em Instalar firmware e escolha o PS3UPDAT.PUP. O RPCS3 abre, instala e fecha sozinho (leva alguns minutos).',
            'Jogos ficam em pastas (PS3_GAME/USRDIR/EBOOT.BIN); arquivos .pkg são instalados no próprio RPCS3 em Arquivo › Instalar pacotes.',
        ],
        reqs: [{ id: 'firmware', label: 'Firmware (PS3UPDAT.PUP)', pick: 'file', exts: ['.pup'], sub: 'dev_flash', optional: false }],
    },
    wiiu: {
        title: 'Wii U — keys',
        intro: 'O Cemu abre jogos descriptografados (.rpx/.wua) sem nada extra. Para jogos criptografados (pastas com code/content/meta ou .wud/.wux) precisa do arquivo keys.txt com as chaves dos seus títulos.',
        steps: [
            'Com o seu Wii U e o dumpling (ou outro dumper), extraia os jogos; o keys.txt é gerado junto (ou copie as chaves para o keys.txt do Cemu).',
            'Clique em Instalar keys.txt e escolha o arquivo.',
            'Para a loja/online use a conta do próprio Cemu; o Ludrix só abre os jogos.',
        ],
        reqs: [{ id: 'keys', label: 'keys.txt', pick: 'file', exts: ['.txt'], sub: '', optional: true }],
    },
    '3ds': {
        title: 'Nintendo 3DS — chaves (opcional)',
        intro: 'O Azahar abre ROMs descriptografadas (.3ds/.cci decrypted, .cxi) sem nada extra. Para ROMs criptografadas e .cia precisa do aes_keys.txt do seu 3DS.',
        steps: [
            'No 3DS, com o GodMode9, gere o aes_keys.txt (ou dumpe os jogos já descriptografados, o que dispensa as chaves).',
            'Clique em Instalar aes_keys.txt e escolha o arquivo.',
            'Jogos .cia são instalados no próprio Azahar: Arquivo › Instalar CIA.',
        ],
        reqs: [{ id: 'keys', label: 'aes_keys.txt', pick: 'file', exts: ['.txt'], sub: 'sysdata', optional: true }],
    },
    xbox: {
        title: 'Xbox — BIOS e disco',
        intro: 'O xemu precisa de três arquivos: a BIOS (mcpx_1.0.bin e Complex_4627.bin, do seu Xbox) e uma imagem de disco rígido (xbox_hdd.qcow2, distribuída pelo próprio xemu).',
        steps: [
            'Abra o xemu pelo botão Abrir. Na primeira vez ele mostra um assistente pedindo cada arquivo.',
            'Em MCPX escolha mcpx_1.0.bin; em Flash escolha Complex_4627.bin; em Hard disk escolha xbox_hdd.qcow2 (baixado na página de releases do xemu, arquivo xbox_hdd.qcow2.zip).',
            'O EEPROM é criado sozinho. Depois disso, os jogos (.iso no formato xiso) abrem pelo Jogar.',
        ],
        reqs: [{ id: 'bios', label: 'BIOS e disco configurados no xemu', pick: '', exts: [], sub: '', optional: false }],
    },
    dc: {
        title: 'Dreamcast — BIOS (opcional)',
        intro: 'O Flycast funciona sem BIOS na maioria dos jogos. Para o menu original do console e alguns jogos, coloque dc_boot.bin e dc_flash.bin.',
        steps: [
            'Copie dc_boot.bin e dc_flash.bin do seu Dreamcast.',
            'Clique em Instalar BIOS e escolha os arquivos (um por vez ou um .zip com os dois).',
        ],
        reqs: [{ id: 'bios', label: 'dc_boot.bin e dc_flash.bin', pick: 'file', exts: ['.bin', '.zip'], sub: '', optional: true }],
    },
    saturn: {
        title: 'Sega Saturn — BIOS',
        intro: 'Saturn precisa da BIOS do console (sega_101.bin para o Japão ou mpr-17933.bin para América/Europa).',
        steps: [
            'Copie a BIOS do seu Saturn.',
            'Clique em Instalar BIOS e escolha o arquivo .bin.',
            'No Kronos, se necessário, aponte a BIOS em Configurações › Geral › BIOS.',
        ],
        reqs: [{ id: 'bios', label: 'BIOS (sega_101.bin / mpr-17933.bin)', pick: 'file', exts: ['.bin', '.zip'], sub: '', optional: false }],
    },
    arcade: {
        title: 'Arcade — conjuntos de ROM',
        intro: 'Arcade não usa BIOS única: cada jogo é um .zip que precisa bater com a versão do emulador. Alguns jogos dependem de um .zip de BIOS do sistema (neogeo.zip, cps2 e outros).',
        steps: [
            'Use conjuntos de ROM da mesma versão do emulador instalado (MAME ou FBNeo).',
            'Deixe os .zip de BIOS (neogeo.zip, pgm.zip, etc.) na mesma pasta dos jogos; eles não aparecem na biblioteca, só servem de apoio.',
            'Não renomeie os arquivos: o emulador identifica o jogo pelo nome do .zip.',
        ],
        reqs: [],
    },
};

function xemuOk(d: string): [boolean, string] {
    const cands = [path.join(d, 'xemu.toml'), path.join(env('APPDATA'), 'xemu', 'xemu', 'xemu.toml'), path.join(env('LOCALAPPDATA'), 'xemu', 'xemu', 'xemu.toml')];
    for (const c of cands) {
        if (!isFile(c))
            continue;
        let txt: string;
        try {
            txt = fs.readFileSync(c, 'utf8');
        }
        catch {
            continue;
        }
        const found: Record<string, string> = {};
        for (let ln of txt.split(/\r?\n/)) {
            ln = ln.trim();
            for (const k of ['bootrom_path', 'flashrom_path', 'hdd_path'])
                if (ln.startsWith(k))
                    found[k] = ln.split('=').slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
        }
        if (['bootrom_path', 'flashrom_path', 'hdd_path'].every((k) => found[k] && isFile(found[k])))
            return [true, c];
        return [false, c];
    }
    return [false, cands[0]];
}

function check(sid: string, emuId: string, exe: string | null, req: any) {
    const ud = userDir(emuId, exe);
    const rid = req.id;
    let ok = false;
    let where = '';
    if (ud) {
        if (sid === 'switch') {
            if (rid === 'keys') {
                where = path.join(ud, 'keys', 'prod.keys');
                ok = isFile(where);
            }
            else {
                const reg = path.join(ud, 'nand', 'system', 'Contents', 'registered');
                where = reg;
                ok = has(reg, ['*.nca']);
            }
        }
        else if (sid === 'ps2' || sid === 'ps1') {
            const b = path.join(ud, 'bios');
            where = b;
            ok = has(b, ['*.bin', '*.BIN', '*.rom0', '*.rom'], 256 * 1024);
        }
        else if (sid === 'ps3') {
            where = path.join(ud, 'dev_flash');
            ok = isDir(path.join(ud, 'dev_flash', 'vsh', 'module'));
        }
        else if (sid === 'wiiu') {
            const k = path.join(ud, 'keys.txt');
            where = k;
            ok = isFile(k) && size(k) > 600;
        }
        else if (sid === '3ds') {
            where = path.join(ud, 'sysdata', 'aes_keys.txt');
            ok = isFile(where);
        }
        else if (sid === 'dc') {
            where = ud;
            ok = isFile(path.join(ud, 'dc_boot.bin'));
        }
        else if (sid === 'saturn') {
            where = ud;
            ok = has(ud, ['sega_101.bin', 'mpr-17933.bin', '*.bin'], 256 * 1024);
        }
        else if (sid === 'xbox') {
            [ok, where] = xemuOk(ud);
        }
    }
    return { ...req, ok: Boolean(ok), where };
}

export function status(sid: string, emuId: string, exe: string | null): any | null {
    const g = GUIDES[sid];
    if (!g)
        return null;
    const reqs = g.reqs.map((r: any) => check(sid, emuId, exe, r));
    return { system: sid, emulator: emuId, title: g.title, intro: g.intro, steps: g.steps, reqs,
        user_dir: userDir(emuId, exe) || '', ready: reqs.every((r: any) => r.ok || r.optional), has_guide: true };
}

export function missingRequired(sid: string, emuId: string, exe: string | null): string[] {
    const st = status(sid, emuId, exe);
    if (!st)
        return [];
    return st.reqs.filter((r: any) => !r.ok && !r.optional).map((r: any) => r.label);
}

function walk(dir: string, out: string[] = []) {
    for (const n of fs.readdirSync(dir)) {
        const f = path.join(dir, n);
        if (isDir(f))
            walk(f, out);
        else if (isFile(f))
            out.push(f);
    }
    return out;
}

function copyInto(src: string, dest: string, exts: string[], rename: string | null = null): number {
    fs.mkdirSync(dest, { recursive: true });
    let n = 0;
    if (isDir(src)) {
        for (const f of walk(src)) {
            if (!exts.length || exts.includes(path.extname(f).toLowerCase())) {
                fs.copyFileSync(f, path.join(dest, path.basename(f)));
                n++;
            }
        }
        return n;
    }
    if (path.extname(src).toLowerCase() === '.zip') {
        const z = new AdmZip(src);
        const root = path.resolve(dest);
        for (const e of z.getEntries()) {
            if (e.isDirectory)
                continue;
            const name = path.basename(e.entryName.replace(/\\/g, '/'));
            if (!name || (exts.length && !exts.includes(path.extname(name).toLowerCase())))
                continue;
            const target = path.resolve(dest, name);
            if (!target.startsWith(root + path.sep))
                continue;
            fs.writeFileSync(target, e.getData());
            n++;
        }
        return n;
    }
    fs.copyFileSync(src, path.join(dest, rename || path.basename(src)));
    return 1;
}

export function install(sid: string, emuId: string, exe: string | null, what: string, p: string) {
    const g = GUIDES[sid];
    if (!g)
        return { error: 'Este console não tem guia' };
    if (!p || !fs.existsSync(p))
        return { error: 'Arquivo não encontrado' };
    const ud = userDir(emuId, exe);
    if (!ud)
        return { error: 'Emulador não instalado. Instale ou aponte o executável primeiro.' };
    const ext = path.extname(p).toLowerCase();
    let n = 0;
    try {
        if (sid === 'switch' && what === 'keys') {
            let name = path.basename(p).toLowerCase();
            if (!['prod.keys', 'title.keys'].includes(name) && ext !== '.zip')
                name = 'prod.keys';
            n = copyInto(p, path.join(ud, 'keys'), ['.keys'], ext === '.zip' ? null : name);
        }
        else if (sid === 'switch' && what === 'firmware') {
            n = copyInto(p, path.join(ud, 'nand', 'system', 'Contents', 'registered'), ['.nca']);
            if (n === 0)
                return { error: 'Nenhum arquivo .nca encontrado nesse firmware' };
        }
        else if ((sid === 'ps2' || sid === 'ps1') && what === 'bios')
            n = copyInto(p, path.join(ud, 'bios'), ['.bin', '.rom0', '.rom1', '.rom2', '.erom', '.nvm', '.mec']);
        else if (sid === 'ps3' && what === 'firmware') {
            if (!exe || !fs.existsSync(exe))
                return { error: 'RPCS3 não encontrado' };
            const c = cp.spawn(exe, ['--installfw', p], { cwd: path.dirname(exe), detached: true, stdio: 'ignore', windowsHide: true });
            c.on('error', () => undefined);
            c.unref();
            return { ok: true, started: true, message: 'O RPCS3 abriu para instalar o firmware. Quando terminar, feche-o e volte aqui.' };
        }
        else if (sid === 'wiiu' && what === 'keys')
            n = copyInto(p, ud, ['.txt'], 'keys.txt');
        else if (sid === '3ds' && what === 'keys')
            n = copyInto(p, path.join(ud, 'sysdata'), ['.txt'], 'aes_keys.txt');
        else if (sid === 'dc' && what === 'bios')
            n = copyInto(p, ud, ['.bin']);
        else if (sid === 'saturn' && what === 'bios')
            n = copyInto(p, ud, ['.bin']);
        else
            return { error: 'Esse item não tem instalação automática; siga os passos do guia.' };
    }
    catch (e: any) {
        return { error: `Não consegui copiar: ${e?.message || e}` };
    }
    log.info('guia %s/%s: %d arquivo(s) de %s', sid, what, n, p);
    return { ok: true, copied: n };
}
