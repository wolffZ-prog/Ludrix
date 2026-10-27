import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cp from 'node:child_process';
import * as P from './paths';
import * as log from './log';
import * as presets from './presets';
import * as compat from './compat';
import { CancelledError, prog, type Cancel, type Progress } from './jobs';
import { Downloader, safeMember } from './installer';

const WIN = process.platform === 'win32';
function execText(file: string, args: string[], timeout: number, env?: any): Promise<string | null> {
    return new Promise((resolve) => {
        try {
            cp.execFile(file, args, { encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, env }, (err, out) => resolve(err ? null : String(out || '')));
        }
        catch {
            resolve(null);
        }
    });
}
const REDISTS_DIR = P.REDISTS;
const CACHE_MS = 5 * 60 * 1000;

export function expandVars(p: string): string {
    let s = String(p || '');
    if (s.startsWith('~'))
        s = os.homedir() + s.slice(1);
    return s.replace(/%([^%]+)%/g, (m, k) => {
        const v = process.env[k] ?? process.env[k.toUpperCase()];
        return v === undefined ? m : v;
    });
}
const isFile = (p: string) => {
    try {
        return fs.statSync(p).isFile();
    }
    catch {
        return false;
    }
};
const isDir = (p: string) => {
    try {
        return fs.statSync(p).isDirectory();
    }
    catch {
        return false;
    }
};
const exists = (p: string) => fs.existsSync(p);

function regQueryRaw(key: string, view: '64' | '32', value?: string): string | null {
    try {
        const args = ['query', key, ...(value !== undefined ? ['/v', value] : []), `/reg:${view}`];
        return cp.execFileSync('reg', args, { windowsHide: true, timeout: 8000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    }
    catch {
        return null;
    }
}
function regValues(out: string): Record<string, string> {
    const vals: Record<string, string> = {};
    for (const line of out.split(/\r?\n/)) {
        const m = /^\s{2,}(\S.*?)\s{2,}(REG_\w+)\s+(.*)$/.exec(line) || /^\s{2,}(\S.*?)\s{2,}(REG_\w+)\s*$/.exec(line);
        if (m)
            vals[m[1].toLowerCase()] = (m[3] || '').trim();
    }
    return vals;
}
function regInt(v: string): number {
    const s = v.trim();
    return s.toLowerCase().startsWith('0x') ? parseInt(s, 16) : parseInt(s, 10);
}

function regQueryA(key: string, view: '64' | '32', value?: string, recursive = false): Promise<string | null> {
    return execText('reg', ['query', key, ...(value !== undefined ? ['/v', value] : []), ...(recursive ? ['/s'] : []), `/reg:${view}`], 20000);
}
function regSplit(p: string): [string, string] {
    const i = p.indexOf('\\');
    const rootName = i >= 0 ? p.slice(0, i) : p;
    const sub = i >= 0 ? p.slice(i + 1) : '';
    const root = ({ HKLM: 'HKLM', HKCU: 'HKCU' } as any)[rootName];
    return root ? [root, sub] : ['HKLM', p];
}
function regJudge(out: string, sub: string, value: string | null, minimum: number | null): boolean | null {
    const vals = regValues(out);
    if (value === null) {
        const low = sub.toLowerCase();
        if (low.endsWith('\\x86') || low.endsWith('\\x64') || sub.includes('Runtimes') || sub.includes('VCRedist')) {
            if (vals.installed !== undefined && regInt(vals.installed) !== 1)
                return null;
        }
        return true;
    }
    const v = vals[value.toLowerCase()];
    if (v === undefined)
        return null;
    return minimum !== null ? regInt(v) >= minimum : true;
}
export async function regExistsA(p: string, wow = false, value: string | null = null, minimum: number | null = null): Promise<boolean | null> {
    if (!WIN)
        return null;
    const [root, sub] = regSplit(p);
    const views: Array<'64' | '32'> = wow ? ['64', '32'] : ['64'];
    const outs = await Promise.all(views.map((v) => regQueryA(`${root}\\${sub}`, v)));
    for (const out of outs) {
        if (out === null)
            continue;
        const r = regJudge(out, sub, value, minimum);
        if (r !== null)
            return r;
    }
    return false;
}
type UninstEntry = { name: string; loc: string; icon: string };
let UNINST: { t: number; data: UninstEntry[] } | null = null;
const UNINST_ROOTS = ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'];
export async function uninstallIndex(force = false): Promise<UninstEntry[]> {
    if (!WIN)
        return [];
    if (!force && UNINST && Date.now() - UNINST.t < CACHE_MS)
        return UNINST.data;
    const outs = await Promise.all(UNINST_ROOTS.map((r) => regQueryA(r, '64', undefined, true)));
    const data: UninstEntry[] = [];
    for (const out of outs) {
        if (!out)
            continue;
        let cur: UninstEntry | null = null;
        for (const line of out.split(/\r?\n/)) {
            if (/^HK/i.test(line)) {
                cur = { name: '', loc: '', icon: '' };
                data.push(cur);
                continue;
            }
            const m = cur && /^\s{2,}(\S.*?)\s{2,}REG_\w+\s*(.*)$/.exec(line);
            if (!m)
                continue;
            const k = m[1].toLowerCase(), v = (m[2] || '').trim();
            if (k === 'displayname')
                cur!.name = v.toLowerCase();
            else if (k === 'installlocation')
                cur!.loc = v;
            else if (k === 'displayicon')
                cur!.icon = v;
        }
    }
    UNINST = { t: Date.now(), data };
    return data;
}
export function regExists(p: string, wow = false, value: string | null = null, minimum: number | null = null): boolean | null {
    if (!WIN)
        return null;
    const i = p.indexOf('\\');
    const rootName = i >= 0 ? p.slice(0, i) : p;
    let sub = i >= 0 ? p.slice(i + 1) : '';
    let root = ({ HKLM: 'HKLM', HKCU: 'HKCU' } as any)[rootName];
    if (!root) {
        root = 'HKLM';
        sub = p;
    }
    const views: Array<'64' | '32'> = wow ? ['64', '32'] : ['64'];
    for (const view of views) {
        const out = regQueryRaw(`${root}\\${sub}`, view);
        if (out === null)
            continue;
        const vals = regValues(out);
        if (value === null) {
            const low = sub.toLowerCase();
            if (low.endsWith('\\x86') || low.endsWith('\\x64') || sub.includes('Runtimes') || sub.includes('VCRedist')) {
                if (vals.installed !== undefined && regInt(vals.installed) !== 1)
                    continue;
            }
            return true;
        }
        const v = vals[value.toLowerCase()];
        if (v === undefined)
            continue;
        if (minimum !== null)
            return regInt(v) >= minimum;
        return true;
    }
    return false;
}

export function fileExists(p: string): boolean | null {
    if (!WIN)
        return null;
    return exists(expandVars(p));
}

export class WinePrefix {
    private reg: Record<string, Record<string, string>> | null = null;
    constructor(public pfx: string) { }
    exists(): boolean {
        return isFile(path.join(this.pfx, 'system.reg'));
    }
    invalidate() {
        this.reg = null;
    }
    private keys() {
        if (this.reg === null) {
            const reg: Record<string, Record<string, string>> = {};
            let cur: string | null = null;
            try {
                for (const line of fs.readFileSync(path.join(this.pfx, 'system.reg'), 'utf8').split(/\r?\n/)) {
                    if (line.startsWith('[')) {
                        cur = line.slice(1, line.lastIndexOf(']')).replace(/\\\\/g, '\\').toLowerCase();
                        reg[cur] = {};
                    }
                    else if (cur && line.startsWith('"') && line.includes('=')) {
                        const i = line.indexOf('=');
                        reg[cur][line.slice(0, i).replace(/^"|"$/g, '').toLowerCase()] = line.slice(i + 1).trim();
                    }
                }
            }
            catch { }
            this.reg = reg;
        }
        return this.reg;
    }
    regExists(p: string, wow = false, value: string | null = null, minimum: number | null = null): boolean | null {
        if (!this.exists())
            return null;
        const i = p.indexOf('\\');
        const root = i >= 0 ? p.slice(0, i) : p;
        if (root !== 'HKLM')
            return null;
        const sub = p.slice(i + 1).toLowerCase();
        let cands: string[];
        if (sub.startsWith('software\\wow6432node\\'))
            cands = [sub, 'software\\' + sub.slice(21)];
        else if (sub.startsWith('software\\'))
            cands = [sub, 'software\\wow6432node\\' + sub.slice(9)];
        else
            cands = [sub];
        const keys = this.keys();
        for (const c of cands) {
            const vals = keys[c];
            if (vals === undefined)
                continue;
            if (value === null) {
                if ((c.includes('runtimes') || c.includes('vcredist')) && (vals.installed ?? 'dword:00000001') !== 'dword:00000001')
                    continue;
                return true;
            }
            const v = vals[value.toLowerCase()];
            if (v === undefined)
                continue;
            if (minimum !== null) {
                const n = v.startsWith('dword:') ? parseInt(v.split(':')[1], 16) : parseInt(v.replace(/^"|"$/g, ''), 10);
                return Number.isNaN(n) ? false : n >= minimum;
            }
            return true;
        }
        return false;
    }
    path(p: string): string {
        p = p.replace(/%WINDIR%/g, 'C:\\windows').replace(/%PROGRAMFILES\(X86\)%/g, 'C:\\Program Files (x86)').replace(/%PROGRAMFILES%/g, 'C:\\Program Files');
        const parts = p.replace(/\//g, '\\').split('\\').filter(Boolean);
        let cur = path.join(this.pfx, 'drive_c');
        const rest = parts.length && parts[0].toUpperCase() === 'C:' ? parts.slice(1) : parts;
        for (const part of rest) {
            let nxt = path.join(cur, part);
            if (!exists(nxt)) {
                try {
                    const hit = fs.readdirSync(cur).find((e) => e.toLowerCase() === part.toLowerCase());
                    if (hit)
                        nxt = path.join(cur, hit);
                }
                catch { }
            }
            cur = nxt;
        }
        return cur;
    }
    fileExists(p: string): boolean | null {
        if (!this.exists())
            return null;
        return exists(this.path(p));
    }
}

function runProc(cmd: string[], opts: { env?: any; cwd?: string; timeout: number; cancel?: Cancel | null }): Promise<number> {
    return new Promise((resolve, reject) => {
        let pr: cp.ChildProcess;
        try {
            pr = cp.spawn(cmd[0], cmd.slice(1), { env: opts.env || undefined, cwd: opts.cwd, stdio: 'ignore', windowsHide: true });
        }
        catch (e) {
            reject(e);
            return;
        }
        const t0 = Date.now();
        let done = false;
        const iv = setInterval(() => {
            if (opts.cancel && opts.cancel.aborted) {
                pr.kill();
                finish(() => reject(new CancelledError()));
            }
            else if (Date.now() - t0 > opts.timeout * 1000) {
                pr.kill();
                finish(() => reject(new Error('o instalador não terminou a tempo')));
            }
        }, 1000);
        const finish = (f: () => void) => {
            if (done)
                return;
            done = true;
            clearInterval(iv);
            f();
        };
        pr.on('error', (e) => finish(() => reject(e)));
        pr.on('exit', (code) => finish(() => resolve(code ?? -1)));
    });
}

function readZipInner(dest: string, it: any): string {
    const AdmZip = require('adm-zip');
    const z = new AdmZip(dest);
    const names: string[] = z.getEntries().map((e: any) => e.entryName);
    const inner = it.inner || names.find((n) => n.toLowerCase().endsWith('.exe'));
    if (!inner)
        throw new Error('pacote sem .exe');
    const exe = safeMember(path.join(REDISTS_DIR, it.id), inner);
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, z.readFile(inner));
    return exe;
}

const OK_RC = [0, 3010, 1638, 5100, 1641];

export class RedistManager {
    dl = new Downloader();
    private presetsCache: any = null;
    get presets(): any {
        if (!this.presetsCache)
            this.presetsCache = presets.redists();
        return this.presetsCache;
    }
    item(rid: string): any | null {
        return this.presets.items.find((x: any) => x.id === rid) || null;
    }
    async detect(it: any, pfx: WinePrefix | null = null): Promise<string> {
        const d = it.detect || {};
        const reg = pfx ? async (a: string, b?: boolean, c?: string | null, m?: number | null) => pfx.regExists(a, b, c, m) : regExistsA;
        const fil = pfx ? pfx.fileExists.bind(pfx) : fileExists;
        let r: boolean | null = null;
        if ('reg' in d)
            r = await reg(d.reg, Boolean(d.wow), d.value ?? null, d.min ?? null);
        else if ('file' in d)
            r = fil(d.file);
        if (r === false && it.detect_alt) {
            const a = it.detect_alt;
            r = 'reg' in a ? await reg(a.reg, Boolean(a.wow)) : fil(a.file || '');
        }
        return r === null ? 'unknown' : r ? 'installed' : 'missing';
    }
    private cache: { t: number; pfx: string; data: any } | null = null;
    private pending: Promise<any> | null = null;
    invalidate() {
        this.cache = null;
    }
    prefix(config: any): WinePrefix | null {
        if (WIN)
            return null;
        return new WinePrefix(compat.prefixFor(config || {}, null));
    }
    localFile(it: any): string {
        let name = String(it.url).split('/').pop()!.split('?')[0];
        if (!/\.(exe|msi|zip)$/i.test(name))
            name = it.id + '.exe';
        return path.join(REDISTS_DIR, `${it.id}_${name}`);
    }
    async status(config: any = null, force = false): Promise<any> {
        const pfx = this.prefix(config);
        const pk = pfx ? pfx.pfx : '';
        if (!force && this.cache && this.cache.pfx === pk && Date.now() - this.cache.t < CACHE_MS)
            return this.cache.data;
        if (this.pending)
            return this.pending;
        this.pending = (async () => {
            const items = await Promise.all(this.presets.items.map(async (it: any) => {
                const lf = this.localFile(it);
                const o: any = {};
                for (const [k, v] of Object.entries(it))
                    if (k !== 'detect' && k !== 'detect_alt')
                        o[k] = v;
                return { ...o, state: await this.detect(it, pfx), downloaded: exists(lf), local: lf };
            }));
            const out: any = { groups: this.presets.groups, items, bundles: this.presets.bundles, dir: REDISTS_DIR, windows: WIN };
            if (pfx) {
                out.prefix = pfx.pfx;
                out.prefix_ready = pfx.exists();
            }
            this.cache = { t: Date.now(), pfx: pk, data: out };
            return out;
        })().finally(() => { this.pending = null; });
        return this.pending;
    }
    async install(rid: string, cb: (p: Progress) => void, cancel: Cancel, silent = true, config: any = null): Promise<any> {
        const it = this.item(rid);
        if (!it)
            throw new Error('Pacote desconhecido');
        fs.mkdirSync(REDISTS_DIR, { recursive: true });
        const dest = this.localFile(it);
        if (!exists(dest)) {
            cb(prog('download', 0, `Baixando ${it.title} (${it.arch})`));
            await this.dl.download({ name: path.basename(dest), url: it.url, size: Number(it.size || 0) }, dest, cb, cancel);
        }
        if (!WIN)
            return this.installWine(it, dest, cb, cancel, config || {});
        let exe = dest;
        if (it.kind === 'zip_exe')
            exe = readZipInner(dest, it);
        cb(prog('extract', -1, `Instalando ${it.title} (${it.arch})…`));
        let cmd: string[];
        if (it.kind === 'dx') {
            const tmp = path.join(REDISTS_DIR, 'dx_extract');
            fs.mkdirSync(tmp, { recursive: true });
            await runProc([exe, '/Q', `/T:${tmp}`], { timeout: 900, cancel });
            const setup = path.join(tmp, 'DXSETUP.exe');
            if (!exists(setup))
                throw new Error('DXSETUP.exe não apareceu após extrair');
            cmd = [setup, '/silent'];
        }
        else if (it.kind === 'msi_in_exe') {
            const msi = path.join(REDISTS_DIR, `${it.id}.msi`);
            if (!exists(msi) || fs.statSync(msi).size !== it.msi_size) {
                const fd = fs.openSync(exe, 'r');
                const data = Buffer.alloc(it.msi_size);
                fs.readSync(fd, data, 0, it.msi_size, it.msi_offset);
                fs.closeSync(fd);
                if (!(data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0))
                    throw new Error('O pacote baixado não bate com o esperado (sem MSI no lugar certo)');
                fs.writeFileSync(msi, data);
            }
            cmd = ['msiexec', '/i', msi, ...(it.silent || ['/quiet', '/norestart'])];
        }
        else if (it.kind === 'msi' || exe.toLowerCase().endsWith('.msi')) {
            cmd = ['msiexec', '/i', exe, ...(it.silent || ['/quiet', '/norestart'])];
        }
        else {
            cmd = [exe, ...(silent ? (it.silent || []) : [])];
        }
        const rc = await runProc(cmd, { timeout: 1800, cancel });
        this.invalidate();
        if (!OK_RC.includes(rc)) {
            const state = await this.detect(it);
            if (state === 'installed')
                return { dir: REDISTS_DIR, rc, state, restart: false };
            const why = ({ 1603: 'o Windows recusou a instalação: normalmente já existe uma versão mais nova, ou faltou permissão de administrador', 1602: 'instalação cancelada',
                1618: 'outra instalação está em andamento; espere ela terminar', 1633: 'pacote de outra arquitetura', 5: 'faltou permissão de administrador' } as Record<number, string>)[rc] || '';
            throw new Error(`O instalador devolveu código ${rc}` + (why ? ` (${why})` : ''));
        }
        const state = await this.detect(it);
        return { dir: REDISTS_DIR, rc, state, restart: rc === 3010 };
    }
    private async installWine(it: any, dest: string, cb: (p: Progress) => void, cancel: Cancel, config: any): Promise<any> {
        const st = compat.status(config);
        if (st.error)
            throw new Error(st.error);
        if (!st.ready) {
            const r = await compat.prepare(config, (t, f) => cb(prog('download', f, t)), cancel);
            if (r.error)
                throw new Error(r.error);
        }
        const pfx = this.prefix(config)!;
        let exe = dest;
        if (it.kind === 'zip_exe')
            exe = readZipInner(dest, it);
        cb(prog('extract', -1, `Instalando ${it.title} (${it.arch}) no prefixo do Proton…`));
        const run = async (cmd: string[], timeout = 1800) => {
            const [wrapped, env] = compat.wrap(cmd, config, null);
            return runProc(wrapped, { env, cwd: REDISTS_DIR, timeout, cancel });
        };
        let rc: number;
        if (it.kind === 'dx') {
            const tmp = path.join(REDISTS_DIR, 'dx_extract');
            fs.mkdirSync(tmp, { recursive: true });
            await run([exe, '/Q', `/T:Z:${tmp.replace(/\//g, '\\')}`], 900);
            const setup = path.join(tmp, 'DXSETUP.exe');
            if (!exists(setup))
                throw new Error('DXSETUP.exe não apareceu após extrair');
            rc = await run([setup, '/silent']);
        }
        else if (it.kind === 'msi_in_exe') {
            const msi = path.join(REDISTS_DIR, `${it.id}.msi`);
            if (!exists(msi) || fs.statSync(msi).size !== it.msi_size) {
                const fd = fs.openSync(exe, 'r');
                const data = Buffer.alloc(it.msi_size);
                fs.readSync(fd, data, 0, it.msi_size, it.msi_offset);
                fs.closeSync(fd);
                fs.writeFileSync(msi, data);
            }
            rc = await run(['msiexec.exe', '/i', msi, ...(it.silent || ['/quiet', '/norestart'])]);
        }
        else if (it.kind === 'msi' || exe.toLowerCase().endsWith('.msi')) {
            rc = await run(['msiexec.exe', '/i', exe, ...(it.silent || ['/quiet', '/norestart'])]);
        }
        else {
            rc = await run([exe, ...(it.silent || [])]);
        }
        pfx.invalidate();
        this.invalidate();
        const state = await this.detect(it, pfx);
        if (!OK_RC.includes(rc) && state !== 'installed')
            throw new Error(`O instalador devolveu código ${rc} dentro do Proton`);
        return { dir: REDISTS_DIR, rc, state, restart: false };
    }
}

export const STORE_AUMID = 'Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft';
export const STORE_PKG = '%LOCALAPPDATA%\\Packages\\Microsoft.4297127D64EC6_8wekyb3d8bbwe';

export const MC_LAUNCHERS: any[] = [
    { id: 'official', title: 'Minecraft Launcher (oficial)', group: 'official', winget: ['Mojang.MinecraftLauncher'], store: '9PGW18NPBZV5',
        site: 'https://www.minecraft.net/download',
        desc: 'O launcher da Mojang: Java, Bedrock e Dungeons com a sua conta Microsoft.',
        win: ['%ProgramFiles(x86)%\\Minecraft Launcher\\MinecraftLauncher.exe', '%ProgramFiles%\\Minecraft Launcher\\MinecraftLauncher.exe', '%LOCALAPPDATA%\\Programs\\Minecraft Launcher\\MinecraftLauncher.exe', '%APPDATA%\\.minecraft\\MinecraftLauncher.exe'],
        linux: ['/usr/bin/minecraft-launcher', '/opt/minecraft-launcher/minecraft-launcher', '~/.local/bin/minecraft-launcher', 'flatpak:com.mojang.Minecraft'] },
    { id: 'prism', title: 'Prism Launcher', group: 'open', winget: ['PrismLauncher.PrismLauncher'], site: 'https://prismlauncher.org/download/',
        desc: 'Código aberto. Várias instâncias, modpacks do Modrinth e CurseForge, várias contas.',
        win: ['%LOCALAPPDATA%\\Programs\\PrismLauncher\\prismlauncher.exe', '%ProgramFiles%\\PrismLauncher\\prismlauncher.exe', '%USERPROFILE%\\scoop\\apps\\prismlauncher\\current\\prismlauncher.exe', '%USERPROFILE%\\Desktop\\PrismLauncher\\prismlauncher.exe'],
        linux: ['/usr/bin/prismlauncher', '~/.local/bin/prismlauncher', 'flatpak:org.prismlauncher.PrismLauncher'] },
    { id: 'multimc', title: 'MultiMC', group: 'open', winget: ['MultiMC.MultiMC'], site: 'https://multimc.org/',
        desc: 'Código aberto. O clássico gerenciador de instâncias, leve e direto.',
        win: ['%USERPROFILE%\\MultiMC\\MultiMC.exe', '%USERPROFILE%\\Desktop\\MultiMC\\MultiMC.exe', '%USERPROFILE%\\Downloads\\MultiMC\\MultiMC.exe', '%USERPROFILE%\\Documents\\MultiMC\\MultiMC.exe', 'C:\\MultiMC\\MultiMC.exe', 'C:\\Games\\MultiMC\\MultiMC.exe', '%LOCALAPPDATA%\\Programs\\MultiMC\\MultiMC.exe'],
        linux: ['/usr/bin/multimc', '~/MultiMC/MultiMC', '~/.local/bin/multimc'] },
    { id: 'polymc', title: 'PolyMC', group: 'open', winget: ['PolyMC.PolyMC'], site: 'https://polymc.org/download/',
        desc: 'Código aberto, irmão do Prism e do MultiMC.',
        win: ['%LOCALAPPDATA%\\Programs\\PolyMC\\polymc.exe', '%ProgramFiles%\\PolyMC\\polymc.exe'],
        linux: ['/usr/bin/polymc', 'flatpak:org.polymc.PolyMC'] },
    { id: 'atlauncher', title: 'ATLauncher', group: 'open', winget: ['ATLauncher.ATLauncher'], site: 'https://atlauncher.com/downloads',
        desc: 'Código aberto. Foco em modpacks prontos, com servidor embutido.',
        win: ['%LOCALAPPDATA%\\Programs\\ATLauncher\\ATLauncher.exe', '%ProgramFiles%\\ATLauncher\\ATLauncher.exe', '%USERPROFILE%\\ATLauncher\\ATLauncher.exe', '%USERPROFILE%\\Desktop\\ATLauncher\\ATLauncher.exe', '%USERPROFILE%\\Downloads\\ATLauncher.exe'],
        linux: ['/usr/bin/atlauncher', 'flatpak:com.atlauncher.ATLauncher'] },
    { id: 'modrinth', title: 'Modrinth App', group: 'open', winget: ['Modrinth.ModrinthApp'], site: 'https://modrinth.com/app',
        desc: 'Código aberto. Mods e modpacks do Modrinth em um clique, visual moderno.',
        win: ['%LOCALAPPDATA%\\Modrinth App\\Modrinth App.exe', '%LOCALAPPDATA%\\Programs\\Modrinth App\\Modrinth App.exe', '%ProgramFiles%\\Modrinth App\\Modrinth App.exe'],
        linux: ['/usr/bin/modrinth-app', '/usr/bin/ModrinthApp', 'flatpak:com.modrinth.ModrinthApp'] },
    { id: 'gdlauncher', title: 'GDLauncher', group: 'open', winget: [], site: 'https://gdlauncher.com/',
        desc: 'Código aberto. Instâncias e modpacks com interface simples.',
        win: ['%LOCALAPPDATA%\\Programs\\gdlauncher\\GDLauncher.exe', '%LOCALAPPDATA%\\Programs\\GDLauncher Carbon\\GDLauncher Carbon.exe', '%LOCALAPPDATA%\\gdlauncher_carbon\\GDLauncher Carbon.exe', '%ProgramFiles%\\GDLauncher\\GDLauncher.exe'],
        linux: ['/usr/bin/gdlauncher', 'flatpak:io.gdevs.GDLauncher'] },
    { id: 'curseforge', title: 'CurseForge', group: 'other', winget: ['Overwolf.CurseForge'], site: 'https://www.curseforge.com/download/app',
        desc: 'O app oficial do CurseForge para modpacks e mods. Não é código aberto.',
        win: ['%LOCALAPPDATA%\\Programs\\CurseForge Windows\\CurseForge.exe', '%ProgramFiles%\\CurseForge Windows\\CurseForge.exe', '%ProgramFiles%\\Overwolf\\OverwolfLauncher.exe'],
        linux: [] },
    { id: 'sklauncher', title: 'SKLauncher', group: 'other', winget: [], site: 'https://skmedix.pl/',
        desc: 'Launcher leve e popular, com skins e versões personalizadas. Precisa do Java. Não é código aberto.',
        win: ['%LOCALAPPDATA%\\Programs\\SKlauncher\\SKlauncher.exe', '%LOCALAPPDATA%\\SKlauncher\\SKlauncher.exe', '%ProgramFiles%\\SKlauncher\\SKlauncher.exe',
            '%APPDATA%\\.minecraft\\SKlauncher*.exe', '%USERPROFILE%\\Desktop\\SKlauncher*.exe', '%USERPROFILE%\\Desktop\\*\\SKlauncher*.exe', '%USERPROFILE%\\OneDrive\\Desktop\\SKlauncher*.exe',
            '%USERPROFILE%\\OneDrive\\Desktop\\*\\SKlauncher*.exe', '%USERPROFILE%\\OneDrive\\Área de Trabalho\\SKlauncher*.exe', '%USERPROFILE%\\OneDrive\\Área de Trabalho\\*\\SKlauncher*.exe',
            '%USERPROFILE%\\Downloads\\SKlauncher*.exe', '%USERPROFILE%\\Downloads\\*\\SKlauncher*.exe', '%USERPROFILE%\\Documents\\SKlauncher*.exe', '%USERPROFILE%\\Documents\\*\\SKlauncher*.exe',
            '%APPDATA%\\.minecraft\\SKlauncher*.jar', '%USERPROFILE%\\Downloads\\SKlauncher*.jar', '%USERPROFILE%\\Desktop\\SKlauncher*.jar', '%USERPROFILE%\\Desktop\\*\\SKlauncher*.jar'],
        linux: ['~/Downloads/SKlauncher*.jar', '~/.minecraft/SKlauncher*.jar'] },
];

export const MC_GROUPS = [
    { id: 'official', name: 'Oficial', desc: 'O launcher da Mojang, pelo instalador ou pela Microsoft Store' },
    { id: 'open', name: 'Código aberto', desc: 'Launchers livres, mantidos pela comunidade' },
    { id: 'other', name: 'Outros', desc: 'Populares, mas de código fechado' },
];

function globPattern(seg: string): RegExp {
    const re = seg.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${re}$`, WIN ? 'i' : '');
}

export function glob(pattern: string, recursive = false): string[] {
    const norm = pattern.replace(/\\/g, path.sep).replace(/\//g, path.sep);
    const parts = norm.split(path.sep);
    let bases = [parts[0] === '' ? path.sep : (WIN && /^[A-Za-z]:$/.test(parts[0]) ? parts[0] + path.sep : parts[0])];
    for (const seg of parts.slice(1)) {
        if (!seg)
            continue;
        const next: string[] = [];
        for (const b of bases) {
            if (seg === '**' && recursive) {
                const stack = [b];
                while (stack.length) {
                    const d = stack.pop()!;
                    next.push(d);
                    try {
                        for (const e of fs.readdirSync(d, { withFileTypes: true }))
                            if (e.isDirectory())
                                stack.push(path.join(d, e.name));
                    }
                    catch { }
                }
            }
            else if (/[*?[]/.test(seg)) {
                const re = globPattern(seg);
                try {
                    for (const e of fs.readdirSync(b))
                        if (re.test(e))
                            next.push(path.join(b, e));
                }
                catch { }
            }
            else {
                const p = path.join(b, seg);
                if (exists(p))
                    next.push(p);
            }
        }
        bases = next;
        if (!bases.length)
            break;
    }
    return bases;
}

let JAVA: { t: number; p: string } | null = null;
export function javaPath(): string {
    if (JAVA && Date.now() - JAVA.t < CACHE_MS)
        return JAVA.p;
    const p = javaPathNow();
    JAVA = { t: Date.now(), p };
    return p;
}
function javaPathNow(): string {
    for (const name of ['javaw', 'java']) {
        const p = compat.which(name);
        if (p)
            return p;
    }
    if (WIN) {
        for (const pat of ['%ProgramFiles%\\Java\\*\\bin\\javaw.exe', '%ProgramFiles%\\Eclipse Adoptium\\*\\bin\\javaw.exe', '%ProgramFiles%\\Microsoft\\jdk-*\\bin\\javaw.exe',
            '%ProgramFiles(x86)%\\Java\\*\\bin\\javaw.exe', '%ProgramFiles(x86)%\\Minecraft Launcher\\runtime\\*\\windows-x64\\*\\bin\\javaw.exe',
            '%APPDATA%\\.minecraft\\runtime\\*\\windows-x64\\*\\bin\\javaw.exe']) {
            const hits = glob(expandVars(pat));
            if (hits.length)
                return hits[0];
        }
    }
    return '';
}

function rank(p: string): number {
    const low = p.toLowerCase();
    if (low.endsWith('.jar'))
        return javaPath() ? 2 : 3;
    return low.endsWith('.exe') ? 0 : 1;
}

function findLauncher(patterns: string[]): string {
    const found: string[] = [];
    for (const pat of patterns) {
        if (pat.startsWith('flatpak:')) {
            const app = pat.slice(8);
            if (compat.which('flatpak')) {
                const bases = [path.join('/var/lib/flatpak/app', app), path.join(os.homedir(), '.local/share/flatpak/app', app)];
                if (bases.some(exists))
                    found.push(pat);
            }
            continue;
        }
        const p = expandVars(pat);
        if (/[*?[]/.test(p)) {
            const hits = glob(p).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
            if (hits.length)
                found.push(hits[0]);
            continue;
        }
        if (isFile(p))
            found.push(p);
    }
    if (!found.length)
        return '';
    let best = found[0];
    for (const f of found)
        if (rank(f) < rank(best))
            best = f;
    return rank(best) < 3 ? best : '';
}

const REG_NAMES: Record<string, [string, string]> = {
    official: ['minecraft launcher', 'MinecraftLauncher.exe'], prism: ['prism launcher', 'prismlauncher.exe'], multimc: ['multimc', 'MultiMC.exe'],
    polymc: ['polymc', 'polymc.exe'], atlauncher: ['atlauncher', 'ATLauncher.exe'], modrinth: ['modrinth app', 'Modrinth App.exe'],
    gdlauncher: ['gdlauncher', 'GDLauncher.exe'], curseforge: ['curseforge', 'CurseForge.exe'], sklauncher: ['sklauncher', 'SKlauncher.exe'],
};

function regFind(lid: string, idx: UninstEntry[]): string {
    if (!WIN || !REG_NAMES[lid])
        return '';
    const [needle, exe] = REG_NAMES[lid];
    for (const e of idx) {
        if (!e.name.includes(needle))
            continue;
        for (const raw of [e.loc, e.icon]) {
            const v = raw.replace(/^"|"$/g, '').split(',')[0].trim();
            if (!v)
                continue;
            if (v.toLowerCase().endsWith('.exe') && isFile(v))
                return v;
            const cand = path.join(v, exe);
            if (isFile(cand))
                return cand;
            const hits = glob(path.join(v, '**', exe), true);
            if (hits.length)
                return hits[0];
        }
    }
    return '';
}

export class MinecraftManager {
    item(lid: string): any | null {
        return MC_LAUNCHERS.find((x) => x.id === lid) || null;
    }
    private memo = new Map<string, string>();
    private memoT = 0;
    private pending: Promise<void> | null = null;
    private fresh(): boolean {
        return Date.now() - this.memoT < CACHE_MS;
    }
    private detectNow(it: any, idx: UninstEntry[]): string {
        const pats = WIN ? it.win : (it.linux || []);
        let p = findLauncher(pats) || regFind(it.id, idx);
        if (!p && it.id === 'official' && WIN && isDir(expandVars(STORE_PKG)))
            p = 'shell:AppsFolder\\' + STORE_AUMID;
        return p;
    }
    detect(it: any): string {
        if (this.fresh() && this.memo.has(it.id))
            return this.memo.get(it.id)!;
        const p = this.detectNow(it, UNINST ? UNINST.data : []);
        this.memo.set(it.id, p);
        if (!this.memoT)
            this.memoT = Date.now();
        return p;
    }
    invalidate() {
        this.memo.clear();
        this.memoT = 0;
    }
    async refresh(force = false): Promise<void> {
        if (!force && this.fresh() && this.memo.size >= MC_LAUNCHERS.length)
            return;
        if (this.pending)
            return this.pending;
        this.pending = (async () => {
            const idx = await uninstallIndex(force);
            if (force)
                JAVA = null;
            const next = new Map<string, string>();
            for (const it of MC_LAUNCHERS)
                next.set(it.id, this.detectNow(it, idx));
            this.memo = next;
            this.memoT = Date.now();
        })().finally(() => { this.pending = null; });
        return this.pending;
    }
    async status(libraryKeys: Record<string, string>, force = false): Promise<any> {
        await this.refresh(force);
        const items = MC_LAUNCHERS.map((it) => {
            const p = this.detect(it);
            const fp = ((it.linux || []).find((x: string) => x.startsWith('flatpak:')) || '').slice(8);
            return { id: it.id, title: it.title, desc: it.desc, group: it.group, winget: it.winget || [], flatpak: fp, site: it.site, store: it.store ?? null, path: p, installed: Boolean(p),
                kind: p.startsWith('shell:') ? 'store' : p.toLowerCase().endsWith('.jar') ? 'jar' : p.startsWith('flatpak:') ? 'flatpak' : 'exe',
                in_library: libraryKeys[it.id] || '', suggest: ['prism', 'sklauncher'].includes(it.id) };
        });
        return { groups: MC_GROUPS, items, windows: WIN, java: Boolean(javaPath()) };
    }
    launchSpec(p: string): any {
        if (p.startsWith('shell:'))
            return { shell: p };
        if (p.startsWith('flatpak:'))
            return { cmd: ['flatpak', 'run', p.slice(8)], cwd: os.homedir() };
        if (p.toLowerCase().endsWith('.jar')) {
            const j = javaPath();
            if (!j)
                return { error: 'O Java não foi encontrado. Instale o Java (Adoptium Temurin ou Microsoft OpenJDK) para abrir este launcher.' };
            return { cmd: [j, '-jar', p], cwd: path.dirname(p) };
        }
        return { cmd: [p], cwd: path.dirname(p) };
    }
}

export const BEDROCK_PKG = '%LOCALAPPDATA%\\Packages\\Microsoft.MinecraftUWP_8wekyb3d8bbwe';
export const BEDROCK_AUMID = 'Microsoft.MinecraftUWP_8wekyb3d8bbwe!App';
export const BEDROCK_STORE = '9NBLGGH2JHXJ';
export const JAVA_STORE = '9PGW18NPBZV5';
const LAUNCH_ORDER = ['official', 'prism', 'modrinth', 'multimc', 'polymc', 'atlauncher', 'gdlauncher', 'curseforge', 'sklauncher'];
const RECOMMEND = ['prism', 'official'];
export const EDITIONS: Record<string, any> = {
    java: { title: 'Minecraft: Java Edition', desc: 'A versão original para PC, com mods, shaders e servidores próprios. Abre por um launcher.' },
    bedrock: { title: 'Minecraft: Bedrock Edition', desc: 'A versão da Microsoft Store (Windows 10/11), com multijogador entre plataformas e Marketplace.' },
};

function drives(): string[] {
    if (!WIN)
        return [];
    const out: string[] = [];
    for (const c of 'CDEFGHIJKLMNOPQRSTUVWXYZ')
        if (isDir(`${c}:\\`))
            out.push(`${c}:\\`);
    return out;
}

export function javaDirs(): string[] {
    let pats = WIN ? ['%APPDATA%\\.minecraft'] : ['~/.minecraft', '~/.var/app/com.mojang.Minecraft/.minecraft'];
    for (const d of drives())
        pats = pats.concat([d + '.minecraft', d + 'Minecraft\\.minecraft', d + 'Games\\Minecraft\\.minecraft', d + 'Games\\.minecraft', d + 'Jogos\\Minecraft\\.minecraft']);
    const out: string[] = [];
    for (const pat of pats) {
        const p = expandVars(pat);
        if (isDir(p) && (isDir(path.join(p, 'versions')) || isFile(path.join(p, 'launcher_profiles.json'))))
            out.push(p);
    }
    return out;
}

export function javaInfo(d: string): any {
    let vers = 0, mods = 0;
    try {
        vers = fs.readdirSync(path.join(d, 'versions'), { withFileTypes: true }).filter((x) => x.isDirectory()).length;
    }
    catch { }
    try {
        mods = fs.readdirSync(path.join(d, 'mods'), { withFileTypes: true }).filter((x) => x.isFile() && x.name.toLowerCase().endsWith('.jar')).length;
    }
    catch { }
    return { dir: d, versions: vers, mods };
}

export function bedrockInstalled(): boolean {
    return WIN && isDir(expandVars(BEDROCK_PKG));
}

export class MinecraftEditions {
    constructor(public mgr: MinecraftManager) { }
    javaLauncher(preferred = ''): [any | null, string] {
        const order = (preferred ? [preferred] : []).concat(LAUNCH_ORDER.filter((x) => x !== preferred));
        for (const lid of order) {
            const it = this.mgr.item(lid);
            if (!it)
                continue;
            const p = this.mgr.detect(it);
            if (p)
                return [it, p];
        }
        return [null, ''];
    }
    installedLaunchers(): any[] {
        const out: any[] = [];
        for (const lid of LAUNCH_ORDER) {
            const it = this.mgr.item(lid);
            const p = it ? this.mgr.detect(it) : '';
            if (p)
                out.push({ id: lid, title: it.title, path: p });
        }
        return out;
    }
    list(libraryKeys: Record<string, string>, launcherPref: Record<string, string>): any[] {
        const dirs = javaDirs();
        const info = dirs.length ? javaInfo(dirs[0]) : { dir: '', versions: 0, mods: 0 };
        const [it, p] = this.javaLauncher(launcherPref.java || '');
        const java = { edition: 'java', ...EDITIONS.java, installed: dirs.length > 0, ...info, dirs, launcher: it ? it.id : '', launcher_title: it ? it.title : '', launcher_path: p,
            in_library: libraryKeys.java || '', store: JAVA_STORE };
        const bi = bedrockInstalled();
        const bed = { edition: 'bedrock', ...EDITIONS.bedrock, installed: bi, dir: bi ? expandVars(BEDROCK_PKG) : '', in_library: libraryKeys.bedrock || '', store: BEDROCK_STORE, windows_only: true };
        return [java, bed];
    }
    recommend(): any[] {
        const out: any[] = [];
        for (const lid of RECOMMEND) {
            const it = this.mgr.item(lid);
            if (it)
                out.push({ id: lid, title: it.title, desc: it.desc, winget: it.winget || [], site: it.site, store: it.store ?? null,
                    why: lid === 'prism' ? 'Recomendado: código aberto, leve, várias contas e modpacks em um clique.' : 'O launcher da Mojang, o mais simples para quem só quer jogar.' });
        }
        return out;
    }
}

function openExternal(url: string) {
    try {
        require('electron').shell.openExternal(url);
    }
    catch (e: any) {
        log.debug('openExternal %s: %s', url, e?.message || e);
    }
}

export class CentralFront {
    redists = new RedistManager();
    mc = new MinecraftManager();
    mced = new MinecraftEditions(this.mc);
    constructor(public be: any) { }
    get store() {
        return this.be.store;
    }
    private jobKeys(prefix: string): string[] {
        return [...this.be.jobs.jobs.keys()].filter((k: string) => k.startsWith(prefix)).map((k: string) => k.slice(prefix.length));
    }

    async redistsStatus(force = false): Promise<any> {
        const st = { ...(await this.redists.status(this.store.config, force)) };
        st.jobs = this.jobKeys('redist:');
        return st;
    }
    async redistInstall(rid: string): Promise<any> {
        const it = this.redists.item(rid);
        if (!it)
            return { error: 'Pacote desconhecido' };
        if (!(await this.be.online()))
            return { error: 'Sem conexão com a internet' };
        return this.be.jobs.run(`redist:${rid}`, `${it.title} (${it.arch})`, 'redist', (cb: any, cancel: Cancel) => this.redists.install(rid, cb, cancel, true, this.store.config), { m: 'redist_install', a: [rid] });
    }
    async redistBundle(bid: string): Promise<any> {
        const b = bid === 'missing'
            ? { id: 'missing', title: 'O que falta', items: this.redists.presets.items.filter((i: any) => !/^physx/.test(String(i.id))).map((i: any) => i.id) }
            : (this.redists.presets.bundles || []).find((x: any) => x.id === bid);
        if (!b)
            return { error: 'Kit desconhecido' };
        if (!(await this.be.online()))
            return { error: 'Sem conexão com a internet' };
        const st: Record<string, any> = {};
        for (const i of (await this.redists.status(this.store.config)).items)
            st[i.id] = i;
        const todo: string[] = b.items.filter((i: string) => bid === 'missing' ? (st[i] || {}).state === 'missing' : (st[i] || {}).state !== 'installed');
        if (!todo.length)
            return { ok: true, queued: 0 };
        const run = async (cb: (p: Progress) => void, cancel: Cancel) => {
            const n = todo.length;
            for (let k = 0; k < n; k++) {
                const rid = todo[k];
                if (cancel.aborted)
                    throw new CancelledError();
                const sub = (p: Progress) => {
                    const frac = p.fraction >= 0 ? (k + Math.max(0, p.fraction)) / n : (k + 0.5) / n;
                    cb(prog(p.stage, frac, `[${k + 1}/${n}] ${p.detail}`));
                };
                try {
                    await this.redists.install(rid, sub, cancel, true, this.store.config);
                }
                catch (e: any) {
                    if (e instanceof CancelledError || e?.name === 'CancelledError')
                        throw e;
                    log.warn('redist %s: %s', rid, e?.message || e);
                    this.be.notify('error', `Redist ${rid} falhou`, String(e?.message || e));
                }
            }
            return { count: n };
        };
        return this.be.jobs.run(`redist:bundle:${bid}`, b.title, 'redist', run);
    }

    mcKeys(): Record<string, string> {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries<any>(this.store.library))
            if (v.mc)
                out[v.mc] = k;
        return out;
    }
    private mcMigrate() {
        const ids = new Set(MC_LAUNCHERS.map((x) => x.id));
        for (const [key, v] of Object.entries<any>(this.store.library))
            if (ids.has(v.mc))
                this.store.patchLib(key, { mc: 'java', mc_launcher: v.mc, title: 'Minecraft: Java Edition', creator: 'Mojang Studios' });
    }
    private mcPref(): Record<string, string> {
        const out: Record<string, string> = {};
        for (const [ed, key] of Object.entries(this.mcKeys())) {
            const v = this.store.lib(key) || {};
            if (v.mc_launcher)
                out[ed] = v.mc_launcher;
        }
        return out;
    }
    async minecraftStatus(force = false): Promise<any> {
        const keys = this.mcKeys();
        const st = await this.mc.status(keys, force);
        st.editions = this.mced.list(keys, this.mcPref());
        st.launchers_installed = this.mced.installedLaunchers();
        st.recommend = this.mced.recommend();
        st.jobs = this.jobKeys('mc:');
        return st;
    }
    minecraftAdd(what: string, p: string | null = null): any {
        if (MC_LAUNCHERS.some((x) => x.id === what))
            return this.minecraftAddEdition('java', what, p);
        if (what === 'java' || what === 'bedrock')
            return this.minecraftAddEdition(what, null, p);
        return { error: 'Edição desconhecida' };
    }
    minecraftAddEdition(ed: string, lid: string | null = null, p: string | null = null): any {
        const key = this.mcKeys()[ed] || `local:minecraft-${ed}`;
        const title = EDITIONS[ed].title, desc = EDITIONS[ed].desc;
        if (ed === 'bedrock') {
            if (!bedrockInstalled())
                return { error: 'O Minecraft Bedrock não está instalado. Instale pela Microsoft Store e volte aqui.' };
            this.be.setInstalled(key, { dir: expandVars(BEDROCK_PKG), exe: 'shell:AppsFolder\\' + BEDROCK_AUMID, title, kind: 'local', title_locked: true, mc: 'bedrock',
                creator: 'Mojang Studios', year: '2011', genres: ['Sandbox', 'Sobrevivência'], description: desc, page_url: 'https://www.minecraft.net/' });
        }
        else {
            const dirs = javaDirs();
            let it: any = null, lpath = '';
            if (lid) {
                it = this.mc.item(lid);
                lpath = p || (it ? this.mc.detect(it) : '');
                if (it && lpath && !lpath.startsWith('shell:') && !lpath.startsWith('flatpak:') && !exists(lpath))
                    return { error: 'Arquivo não encontrado' };
            }
            if (!lpath)
                [it, lpath] = this.mced.javaLauncher(lid || '');
            if (!dirs.length && !lpath)
                return { error: 'Minecraft Java não encontrado neste PC (nem a pasta .minecraft, nem um launcher). Instale um launcher abaixo e abra-o uma vez.' };
            const folder = dirs.length ? dirs[0] : (lpath.startsWith('shell:') || lpath.startsWith('flatpak:') ? '' : path.dirname(lpath));
            this.be.setInstalled(key, { dir: folder, exe: lpath || '', title, kind: 'local', title_locked: true, mc: 'java', mc_launcher: it ? it.id : '',
                creator: 'Mojang Studios', year: '2011', genres: ['Sandbox', 'Sobrevivência'],
                description: desc + (it ? ` Abre pelo ${it.title}.` : ' Ainda sem launcher: ao clicar em Jogar o Ludrix indica um.'), page_url: 'https://www.minecraft.net/' });
            if (!lpath)
                this.be.notify('warn', 'Minecraft Java entrou na biblioteca, mas sem launcher',
                    'Pasta .minecraft encontrada, mas nenhum launcher para abrir o jogo. Instale um em Central › Minecraft (Prism ou o oficial); ao clicar em Jogar eu também indico.', key);
        }
        if (this.store.config.auto_metadata !== false)
            this.be.queueMeta(key);
        return { ok: true, key, launcher: (this.store.lib(key) || {}).mc_launcher || '' };
    }
    minecraftSetLauncher(lid: string, p: string | null = null): any {
        const it = this.mc.item(lid);
        if (!it)
            return { error: 'Launcher desconhecido' };
        const lp = p || this.mc.detect(it);
        if (!lp)
            return { error: 'Esse launcher não está instalado. Instale ou use "Localizar".' };
        const key = this.mcKeys().java;
        if (!key)
            return this.minecraftAddEdition('java', lid, lp);
        this.store.patchLib(key, { exe: lp, mc_launcher: lid, description: EDITIONS.java.desc + ` Abre pelo ${it.title}.` });
        return { ok: true, key, launcher: lid };
    }
    async minecraftLocate(lid: string): Promise<any> {
        const dialogs = await import('./dialogs');
        const p = await dialogs.pickFile('any', '');
        if (!p)
            return { cancel: true };
        return this.minecraftSetLauncher(lid, p);
    }
    minecraftAutoadd() {
        this.mcMigrate();
        if (this.store.config.minecraft_auto === false)
            return;
        const have = this.mcKeys();
        try {
            if (have.java) {
                const info = this.store.lib(have.java) || {};
                const cur = String(info.exe || '');
                const weak = !cur || cur.toLowerCase().endsWith('.jar') || (!cur.startsWith('shell:') && !cur.startsWith('flatpak:') && !exists(cur));
                if (weak) {
                    const [it, fresh] = this.mced.javaLauncher(info.mc_launcher || '');
                    if (fresh && it && fresh !== cur && (!cur || !fresh.toLowerCase().endsWith('.jar'))) {
                        this.store.patchLib(have.java, { exe: fresh, mc_launcher: it.id, description: EDITIONS.java.desc + ` Abre pelo ${it.title}.` });
                        this.be.notify('info', `Minecraft Java agora abre pelo ${it.title}`, 'Launcher encontrado; o jogo está pronto para Jogar.', have.java);
                    }
                }
            }
            if (!have.java && (javaDirs().length || this.mced.javaLauncher()[1]))
                this.minecraftAddEdition('java');
            if (!have.bedrock && bedrockInstalled())
                this.minecraftAddEdition('bedrock');
        }
        catch (e: any) {
            log.warn('minecraft autoadd: %s', e?.message || e);
        }
    }
    minecraftOpen(lid: string, where: string): any {
        if (lid === 'java' || lid === 'bedrock') {
            const pid = lid === 'java' ? JAVA_STORE : BEDROCK_STORE;
            if (WIN) {
                openExternal(`ms-windows-store://pdp/?ProductId=${pid}`);
                return { ok: true };
            }
            return this.be.openUrl(`https://apps.microsoft.com/detail/${pid}`);
        }
        const it = this.mc.item(lid);
        if (!it)
            return { error: 'Launcher desconhecido' };
        if (where === 'store' && it.store && WIN) {
            openExternal(`ms-windows-store://pdp/?ProductId=${it.store}`);
            return { ok: true };
        }
        return this.be.openUrl(it.site);
    }
}
