import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cp from 'node:child_process';
import AdmZip from 'adm-zip';
import * as P from './paths';
import * as log from './log';
import * as http from './http';
import { CancelledError, Progress, Cancel, prog } from './jobs';
import { FileRef, basename } from './repos';

export type ProgressCb = (p: Progress) => void;

export interface DlRef extends FileRef {
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
    decrypt?: ((chunk: Buffer, offset: number) => Buffer) | null;
    _res?: any;
}

export function safeFolderName(title: string): string {
    const name = String(title || '').replace(/[<>:"/\\|?*]+/g, '').replace(/^[ .]+|[ .]+$/g, '');
    return name || 'game';
}

export function humanSize(n: number): string {
    let v = Number(n || 0);
    for (const unit of ['B', 'KB', 'MB', 'GB', 'TB']) {
        if (v < 1024)
            return unit !== 'B' ? `${v.toFixed(1)} ${unit}` : `${Math.trunc(v)} B`;
        v /= 1024;
    }
    return `${v.toFixed(1)} PB`;
}

export const MIN_FREE = 512 * 1024 * 1024;

export function freeBytes(p: string): number {
    let q = path.resolve(p);
    while (!fs.existsSync(q) && path.dirname(q) !== q)
        q = path.dirname(q);
    try {
        const st = (fs as any).statfsSync(q);
        return Number(st.bavail) * Number(st.bsize);
    }
    catch {
        return -1;
    }
}

export function ensureSpace(target: string, needed: number, what = 'baixar') {
    if (needed <= 0)
        return;
    const free = freeBytes(target);
    if (free < 0)
        return;
    const want = Math.trunc(needed * 1.05) + MIN_FREE;
    if (free < want) {
        const anchor = path.parse(path.resolve(target)).root || target;
        throw new Error(`Sem espaço para ${what}: precisa de ${humanSize(want)} livres em ${anchor}, tem ${humanSize(free)}. Libere ${humanSize(want - free)} ou mude a pasta de jogos em Ajustes.`);
    }
}

const SEVENZIP_URL = 'https://www.7-zip.org/a/7zr.exe';
let sevenPromise: Promise<string | null> | null = null;

function which(name: string): string | null {
    const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        for (const ext of exts) {
            const p = path.join(dir, name + ext);
            try {
                if (fs.statSync(p).isFile())
                    return p;
            }
            catch { /* segue */ }
        }
    }
    return null;
}

export function find7z(): string | null {
    const candidates = [path.join(P.BIN, '7za.exe'), path.join(P.BIN, '7z.exe'), path.join(P.BIN, '7zr.exe'),
        'C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe'];
    for (const c of candidates)
        if (fs.existsSync(c))
            return c;
    for (const name of ['7z', '7za', '7zr', '7zz']) {
        const p = which(name);
        if (p)
            return p;
    }
    return null;
}

export async function ensure7z(session: http.Session | null = null): Promise<string | null> {
    const found = find7z();
    if (found || process.platform !== 'win32')
        return found;
    if (!sevenPromise) {
        sevenPromise = (async () => {
            try {
                const s = session || http.shared;
                const r = await s.get(SEVENZIP_URL, { timeout: 60_000 });
                if (r.status >= 400)
                    throw new Error(`HTTP ${r.status}`);
                const buf = Buffer.from(await r.arrayBuffer());
                fs.mkdirSync(P.BIN, { recursive: true });
                const tmp = path.join(P.BIN, '7zr.exe.part');
                fs.writeFileSync(tmp, buf);
                fs.renameSync(tmp, path.join(P.BIN, '7zr.exe'));
                return path.join(P.BIN, '7zr.exe');
            }
            catch {
                return null;
            }
            finally {
                sevenPromise = null;
            }
        })();
    }
    return sevenPromise;
}

export const STATS = { speed: 0 };

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

export class Downloader {
    static CHUNK = 1024 * 512;
    constructor(public session: http.Session = http.shared) { }

    async download(af: DlRef, dest: string, cb: ProgressCb, cancel: Cancel): Promise<string> {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const part = dest + '.part';
        let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
        const baseHeaders: Record<string, string> = { ...(af.headers || {}) };
        const cookies = af.cookies || {};
        if (Object.keys(cookies).length)
            baseHeaders.Cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
        let headers: Record<string, string> = { ...baseHeaders };
        if (have)
            headers.Range = `bytes=${have}-`;
        let checked = false;
        for (let attempt = 1; attempt <= 5; attempt++) {
            try {
                const r = await this.session.get(af.url, { headers, timeout: 60_000, redirect: 'follow' });
                if (r.status === 416)
                    break;
                if ([403, 404, 410].includes(r.status))
                    throw new http.HttpError(`Arquivo indisponível no servidor (HTTP ${r.status})`, r.status);
                if (r.status >= 400)
                    throw new Error(`HTTP ${r.status}`);
                if (r.status !== 206)
                    have = 0;
                let total = have + Number(r.headers.get('content-length') || 0);
                if (!total)
                    total = af.size;
                if (!checked) {
                    checked = true;
                    ensureSpace(path.dirname(dest), total - have, 'baixar');
                }
                const fd = fs.openSync(part, have ? 'a' : 'w');
                let t0 = Date.now();
                let got0 = have;
                let speed = 0;
                try {
                    if (!r.body)
                        throw new Error('Resposta sem corpo');
                    const reader = r.body.getReader();
                    for (;;) {
                        if (cancel.aborted) {
                            try {
                                await reader.cancel();
                            }
                            catch { /* nada */ }
                            throw new CancelledError();
                        }
                        const { value, done } = await reader.read();
                        if (done)
                            break;
                        let chunk = Buffer.from(value);
                        if (af.decrypt)
                            chunk = af.decrypt(chunk, have);
                        fs.writeSync(fd, chunk);
                        have += chunk.length;
                        const dt = (Date.now() - t0) / 1000;
                        if (dt >= 0.5) {
                            speed = (have - got0) / dt;
                            STATS.speed = !STATS.speed ? speed : STATS.speed * 0.7 + speed * 0.3;
                            t0 = Date.now();
                            got0 = have;
                            const eta = speed > 0 ? (total - have) / speed : 0;
                            cb(prog('download', total ? have / total : -1,
                                `${humanSize(have)} / ${humanSize(total)}  •  ${humanSize(speed)}/s  •  ETA ${Math.trunc(eta / 60)}m${String(Math.trunc(eta % 60)).padStart(2, '0')}s`));
                        }
                    }
                }
                finally {
                    fs.closeSync(fd);
                }
                break;
            }
            catch (e: any) {
                if (e instanceof CancelledError)
                    throw e;
                if (e instanceof http.HttpError && [403, 404, 410].includes(Number(e.status)))
                    throw e;
                if (attempt === 5)
                    throw e;
                cb(prog('download', -1, `Conexão caiu (${e?.name || 'erro'}), tentando de novo em ${attempt * 3}s...`));
                for (let i = 0; i < attempt * 3 * 10; i++) {
                    if (cancel.aborted)
                        throw new CancelledError();
                    await sleep(100);
                }
                have = fs.existsSync(part) ? fs.statSync(part).size : 0;
                headers = { ...baseHeaders };
                if (have)
                    headers.Range = `bytes=${have}-`;
            }
        }
        fs.renameSync(part, dest);
        return dest;
    }
}

export function unpackedSize(archive: string): number {
    try {
        if (path.extname(archive).toLowerCase() === '.zip') {
            const z = new AdmZip(archive);
            return z.getEntries().reduce((s, e) => s + Number(e.header.size || 0), 0);
        }
    }
    catch { /* estimativa */ }
    try {
        return Math.trunc(fs.statSync(archive).size * 1.5);
    }
    catch {
        return 0;
    }
}

export async function extract(archive: string, target: string, cb: ProgressCb, cancel: Cancel): Promise<void> {
    fs.mkdirSync(target, { recursive: true });
    ensureSpace(target, unpackedSize(archive), 'extrair');
    const ext = path.extname(archive).toLowerCase();
    const seven = await ensure7z();
    if (seven && (ext !== '.zip' || !seven.toLowerCase().endsWith('7zr.exe')))
        await extractWith7z(seven, archive, target, cb, cancel);
    else if (ext === '.zip')
        await extractZip(archive, target, cb, cancel);
    else if (['.gz', '.xz', '.bz2', '.tgz', '.txz', '.tar', '.zst'].includes(ext) && which('tar'))
        await extractTar(archive, target, cb, cancel);
    else if (ext === '.rar')
        throw new Error('Arquivo .rar precisa do 7-Zip' + (process.platform === 'win32' ? ' (bin/7zr.exe não pôde ser baixado). Instale o 7-Zip e tente de novo.' : '. Instale o pacote p7zip (7z) e tente de novo.'));
    else
        throw new Error(`Sem extrator para ${ext}. ` + (process.platform === 'win32' ? 'Instale o 7-Zip ou coloque 7za.exe na pasta bin/.' : 'Instale o pacote p7zip (7z).'));
}

function runWatched(cmd: string, args: string[], cb: ProgressCb, cancel: Cancel, onLine: (line: string) => void): Promise<number> {
    return new Promise((resolve, reject) => {
        let proc: cp.ChildProcess;
        try {
            proc = cp.spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        }
        catch (e) {
            reject(e);
            return;
        }
        let buf = '';
        const feed = (d: Buffer) => {
            for (const ch of d.toString('utf8')) {
                buf += ch;
                if (ch === '\r' || ch === '\n') {
                    onLine(buf);
                    buf = '';
                }
            }
        };
        proc.stdout?.on('data', feed);
        proc.stderr?.on('data', feed);
        const poll = setInterval(() => {
            if (cancel.aborted) {
                clearInterval(poll);
                try {
                    proc.kill('SIGKILL');
                }
                catch { /* nada */ }
                reject(new CancelledError());
            }
        }, 200);
        proc.on('error', (e) => {
            clearInterval(poll);
            reject(e);
        });
        proc.on('close', (code) => {
            clearInterval(poll);
            if (buf)
                onLine(buf);
            if (cancel.aborted)
                return;
            resolve(code ?? -1);
        });
    });
}

async function extractWith7z(seven: string, archive: string, target: string, cb: ProgressCb, cancel: Cancel) {
    const rc = await runWatched(seven, ['x', archive, `-o${target}`, '-y', '-bsp1', '-bso0', '-bse1'], cb, cancel, (line) => {
        const m = /(\d{1,3})%/.exec(line);
        if (m) {
            const pct = Number(m[1]);
            const name = line.includes('-') ? line.split('-').slice(1).join('-').trim().slice(0, 60) : '';
            cb(prog('extract', pct / 100, `${pct}%  ${name}`));
        }
    });
    if (rc !== 0 && rc !== 1)
        throw new Error(`7-Zip retornou código ${rc}`);
}

async function extractTar(archive: string, target: string, cb: ProgressCb, cancel: Cancel) {
    cb(prog('extract', -1, `Extraindo ${path.basename(archive)}...`));
    let n = 0;
    const rc = await runWatched('tar', ['-xvf', archive, '-C', target, '--no-same-owner'], cb, cancel, (line) => {
        n++;
        if (n % 20 === 0)
            cb(prog('extract', -1, path.basename(line.trim()).slice(0, 60)));
    });
    if (rc !== 0)
        throw new Error(`tar retornou código ${rc}`);
}

export function safeMember(target: string, name: string): string {
    const n = String(name || '').replace(/\\/g, '/');
    if (!n || n.startsWith('/') || n.split('/').includes('..') || /^[a-zA-Z]:/.test(n))
        throw new Error(`Arquivo suspeito no pacote: ${name}`);
    const dest = path.resolve(target, n);
    const root = path.resolve(target);
    if (dest !== root && !dest.startsWith(root + path.sep))
        throw new Error(`Caminho fora da pasta: ${name}`);
    return dest;
}

async function extractZip(archive: string, target: string, cb: ProgressCb, cancel: Cancel) {
    const z = new AdmZip(archive);
    const infos = z.getEntries();
    const total = infos.reduce((s, e) => s + Number(e.header.size || 0), 0) || 1;
    let done = 0;
    let i = 0;
    for (const e of infos) {
        if (cancel.aborted)
            throw new CancelledError();
        const dest = safeMember(target, e.entryName);
        if (e.isDirectory) {
            fs.mkdirSync(dest, { recursive: true });
        }
        else {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, e.getData());
        }
        done += Number(e.header.size || 0);
        cb(prog('extract', done / total, `${Math.trunc(done / total * 100)}%  ${e.entryName.slice(-60)}`));
        if (++i % 50 === 0)
            await sleep(0);
    }
}

export const BAD_EXE = /(unins|setup|install|redist|vcredist|dxsetup|dxwebsetup|directx|dotnet|physx|crash|report|handler|launcher_helper|unitycrash|eac|easyanticheat|battleye|updater|updatelauncher|autoupdate|patcher|config|settings|benchmark|editor|server|uploader|7z|winrar|touchup|register|activation|trainer|cheat|keygen)/i;

function isElf(p: string): boolean {
    try {
        const fd = fs.openSync(p, 'r');
        try {
            const b = Buffer.alloc(4);
            fs.readSync(fd, b, 0, 4, 0);
            return b.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
        }
        finally {
            fs.closeSync(fd);
        }
    }
    catch {
        return false;
    }
}

const SFX_MARKS = ['Inno Setup', 'Nullsoft', 'NullsoftInst', '7-Zip SFX', '7zS', 'WinRAR SFX', 'RarSFX', 'InstallShield', 'Wise Installation',
    'Smart Install Maker', 'CreateInstall', 'Setup Factory', 'Advanced Installer', 'InstallAware', 'Actual Installer', 'Clickteam Install'].map((s) => Buffer.from(s, 'latin1'));
const TAG_RE = /[\(\[\{].+?[\)\]\}]/;

export function peInfo(p: string): { installer: boolean; console: boolean; overlay: number } {
    const out = { installer: false, console: false, overlay: 0 };
    let fd: number | null = null;
    try {
        const size = fs.statSync(p).size;
        fd = fs.openSync(p, 'r');
        const readAt = (off: number, len: number) => {
            const b = Buffer.alloc(len);
            const n = fs.readSync(fd!, b, 0, len, off);
            return b.subarray(0, n);
        };
        let head = readAt(0, 4096);
        if (head.length < 0x40 || head[0] !== 0x4d || head[1] !== 0x5a)
            return out;
        const off = head.readUInt32LE(0x3c);
        if (off + 0x100 > head.length)
            head = readAt(0, off + 0x200);
        if (off + 4 > head.length || head.toString('latin1', off, off + 4) !== 'PE\0\0')
            return out;
        const nsec = head.readUInt16LE(off + 6);
        const opt = head.readUInt16LE(off + 20);
        out.console = off + 0x5e <= head.length && head.readUInt16LE(off + 0x5c) === 3;
        const sec = off + 24 + opt;
        let end = 0;
        for (let i = 0; i < Math.min(nsec, 32); i++) {
            const b = sec + i * 40;
            const row = b + 40 > head.length ? readAt(b, 40) : head.subarray(b, b + 40);
            if (row.length < 40)
                break;
            const raw = row.readUInt32LE(16) + row.readUInt32LE(20);
            end = Math.max(end, raw);
        }
        if (end && size > end)
            out.overlay = (size - end) / size;
        let chunk = readAt(0, Math.min(size, 1 << 20));
        if (size > (1 << 20))
            chunk = Buffer.concat([chunk, readAt(Math.max(0, size - (256 << 10)), 256 << 10)]);
        out.installer = SFX_MARKS.some((m) => chunk.includes(m));
    }
    catch { /* nada */ }
    finally {
        if (fd !== null)
            fs.closeSync(fd);
    }
    return out;
}

function mtimes(folder: string): number {
    const ts: number[] = [];
    try {
        for (const name of fs.readdirSync(folder)) {
            const p = path.join(folder, name);
            if (!['.dll', '.exe', '.bin', '.dat', '.pak', '.big', '.bik', '.ini'].includes(path.extname(name).toLowerCase()))
                continue;
            try {
                const st = fs.statSync(p);
                if (st.isFile())
                    ts.push(st.mtimeMs / 1000);
            }
            catch { /* segue */ }
            if (ts.length >= 60)
                break;
        }
    }
    catch { /* nada */ }
    ts.sort((a, b) => a - b);
    return ts.length ? ts[Math.floor(ts.length / 2)] : 0;
}

const WALK_SKIP = /^(_commonredist|commonredist|redist|redistributables|directx|vcredist|dotnet|__installer|saves?|savegames?|screenshots?|logs?|crashes|temp|tmp|cache|node_modules|\.git)$/i;
export function walkFiles(folder: string, out: string[] = [], depth = 0, budget = { n: 25000 }): string[] {
    if (depth > 7 || budget.n <= 0)
        return out;
    let ents: fs.Dirent[] = [];
    try {
        ents = fs.readdirSync(folder, { withFileTypes: true });
    }
    catch {
        return out;
    }
    budget.n -= ents.length;
    const dirs: string[] = [];
    for (const e of ents) {
        const p = path.join(folder, e.name);
        if (e.isDirectory()) {
            if (!WALK_SKIP.test(e.name))
                dirs.push(p);
        }
        else if (e.isFile())
            out.push(p);
    }
    for (const p of dirs)
        walkFiles(p, out, depth + 1, budget);
    return out;
}

function stemOf(p: string): string {
    return path.basename(p, path.extname(p));
}

function isExecutable(p: string): boolean {
    try {
        fs.accessSync(p, fs.constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}

export function findExecutables(folder: string, title = ''): string[] {
    const all = walkFiles(folder);
    const exes = all.filter((p) => path.extname(p).toLowerCase() === '.exe');
    if (process.platform !== 'win32') {
        for (const p of all) {
            const ext = path.extname(p).toLowerCase();
            if (ext === '.exe')
                continue;
            if (['.sh', '.x86_64', '.x86', '.appimage'].includes(ext) || (ext === '' && isExecutable(p) && isElf(p)))
                exes.push(p);
        }
    }
    if (!exes.length)
        return [];
    const words = (title.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2);
    const median = new Map<string, number>();
    const score = (p: string): [number, number] => {
        const stem = stemOf(p);
        const n = stem.toLowerCase();
        let s = 0;
        if (process.platform !== 'win32' && path.extname(p).toLowerCase() !== '.exe')
            s += 40;
        if (BAD_EXE.test(n))
            s -= 100;
        if (TAG_RE.test(stem))
            s -= 40;
        if (words.some((w) => n.includes(w)))
            s += 30;
        else if (n.length >= 3 && words.some((w) => w.startsWith(n) || n.startsWith(w)))
            s += 18;
        if (n.includes('launcher'))
            s += 10;
        if (n.includes('game') || n.includes('play'))
            s += 5;
        const depth = path.relative(folder, p).split(path.sep).length;
        s -= depth * 3;
        let size = 0;
        try {
            const st = fs.statSync(p);
            size = st.size;
            const dir = path.dirname(p);
            if (!median.has(dir))
                median.set(dir, mtimes(dir));
            const med = median.get(dir)!;
            if (med && st.mtimeMs / 1000 - med > 400 * 86400)
                s -= 25;
        }
        catch {
            size = 0;
        }
        return [-s, -size];
    };
    const scored = exes.map((p) => ({ p, k: score(p) }));
    scored.sort((a, b) => (a.k[0] - b.k[0]) || (a.k[1] - b.k[1]));
    let ranked = scored.map((x) => x.p);
    if (ranked.length && path.extname(ranked[0]).toLowerCase() === '.exe') {
        let top = ranked.slice(0, 10);
        const adj: Array<[number, string]> = [];
        for (const p of top) {
            const info = peInfo(p);
            let pen = 0;
            if (info.installer)
                pen += 150;
            else if (info.overlay > 0.5 && TAG_RE.test(stemOf(p)))
                pen += 40;
            if (info.console)
                pen += 20;
            adj.push([pen, p]);
        }
        if (adj.some(([pen]) => pen)) {
            const base = new Map(top.map((p, i) => [p, i]));
            adj.sort((a, b) => (a[0] - b[0]) || (base.get(a[1])! - base.get(b[1])!));
            top = adj.map(([, p]) => p);
            ranked = top.concat(ranked.slice(10));
        }
    }
    return ranked;
}

const SETUP_RE = /^(setup|install|installer|setup_[^/\\]*|[^/\\]*setup)\.exe$/i;

export function findSetup(folder: string): string | null {
    let cands: string[];
    try {
        cands = walkFiles(folder).filter((p) => path.extname(p).toLowerCase() === '.exe' && SETUP_RE.test(path.basename(p)) && path.relative(folder, p).split(path.sep).length <= 2);
    }
    catch {
        return null;
    }
    if (!cands.length)
        return null;
    const siblings = (p: string) => {
        try {
            return fs.readdirSync(path.dirname(p)).filter((n) => /\.(bin|arc|pak)$/i.test(n)).length;
        }
        catch {
            return 0;
        }
    };
    const key = (p: string): [number, number, number] => {
        let size = 0;
        try {
            size = fs.statSync(p).size;
        }
        catch { /* 0 */ }
        return [-siblings(p), path.relative(folder, p).split(path.sep).length, -size];
    };
    cands.sort((a, b) => {
        const ka = key(a), kb = key(b);
        return (ka[0] - kb[0]) || (ka[1] - kb[1]) || (ka[2] - kb[2]);
    });
    return cands[0];
}

export function isRepack(folder: string): boolean {
    const st = findSetup(folder);
    if (!st)
        return false;
    const real = findExecutables(folder).filter((x) => !BAD_EXE.test(stemOf(x).toLowerCase()));
    let bins: string[] = [];
    try {
        bins = fs.readdirSync(path.dirname(st)).filter((n) => /\.bin$/i.test(n));
    }
    catch { /* nada */ }
    return bins.length > 0 || !real.length;
}

export function flattenSingleFolder(target: string) {
    const entries = fs.readdirSync(target);
    if (entries.length === 1 && fs.statSync(path.join(target, entries[0])).isDirectory()) {
        const inner = path.join(target, entries[0]);
        const tmp = path.join(target, entries[0] + '__tmp');
        fs.renameSync(inner, tmp);
        for (const e of fs.readdirSync(tmp))
            fs.renameSync(path.join(tmp, e), path.join(target, e));
        fs.rmdirSync(tmp);
    }
}

export const ARCHIVE_EXT = /\.(7z|zip|rar)(\.001)?$/i;

function isUnder(parent: string, p: string): boolean {
    const rel = path.relative(path.resolve(parent), path.resolve(p));
    return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function moveFile(src: string, dst: string) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    try {
        fs.renameSync(src, dst);
    }
    catch {
        fs.copyFileSync(src, dst);
        fs.rmSync(src, { force: true });
    }
}

export async function installFromArchives(archives: string[], gameDir: string, cb: ProgressCb, cancel: Cancel, keep: boolean, title: string): Promise<string[]> {
    fs.mkdirSync(gameDir, { recursive: true });
    for (const a of archives) {
        const name = path.basename(a);
        if (/\.\d{3}$/.test(name) && !name.toLowerCase().endsWith('.001'))
            continue;
        if (ARCHIVE_EXT.test(name)) {
            cb(prog('extract', 0, `Extraindo ${name}...`));
            await extract(a, gameDir, cb, cancel);
        }
        else if (keep && !isUnder(P.DOWNLOADS, a)) {
            cb(prog('extract', -1, `Copiando ${name}...`));
            fs.copyFileSync(a, path.join(gameDir, name));
        }
        else {
            cb(prog('extract', -1, `Movendo ${name}...`));
            moveFile(a, path.join(gameDir, name));
        }
    }
    flattenSingleFolder(gameDir);
    if (!keep) {
        cb(prog('cleanup', -1, 'Apagando arquivos baixados...'));
        for (const a of archives) {
            try {
                fs.rmSync(a, { force: true });
            }
            catch { /* nada */ }
        }
    }
    return findExecutables(gameDir, title);
}

export type Resolver = (af: DlRef) => Promise<[string, Record<string, string>, string?, number?]>;

export async function installGame(files: DlRef[], title: string, installRoot: string, cb: ProgressCb, cancel: Cancel, keepArchive = false,
    session: http.Session = http.shared, resolver: Resolver | null = null): Promise<[string, string[]]> {
    const gameDir = path.join(installRoot, safeFolderName(title));
    const tmpDir = path.join(P.DOWNLOADS, safeFolderName(title));
    const dl = new Downloader(session);
    const downloaded: string[] = [];
    const n = files.length;
    for (let i = 0; i < n; i++) {
        let af = files[i];
        const prefix = n > 1 ? `[${i + 1}/${n}] ` : '';
        cb(prog('download', 0, `${prefix}Conectando...`));
        if (resolver && !af.url.startsWith('http')) {
            cb(prog('download', 0, `${prefix}Pedindo o link ao site...`));
            const got = await resolver(af);
            af = { name: got[2] || af.name, url: got[0], size: got[3] || af.size, headers: got[1], cookies: af.cookies, decrypt: af.decrypt, _res: af._res };
        }
        const dest = path.join(tmpDir, basename(af));
        if (fs.existsSync(dest) && af.size && fs.statSync(dest).size === af.size) {
            cb(prog('download', 1, `${prefix}${basename(af)} já baixado`));
        }
        else {
            const wrapped: ProgressCb = n > 1 ? (p) => cb(prog(p.stage, p.fraction, prefix + p.detail)) : cb;
            await dl.download(af, dest, wrapped, cancel);
        }
        downloaded.push(dest);
    }
    const existed = fs.existsSync(gameDir);
    let exes: string[];
    try {
        exes = await installFromArchives(downloaded, gameDir, cb, cancel, keepArchive, title);
    }
    catch (e) {
        if (!existed)
            fs.rmSync(gameDir, { recursive: true, force: true });
        throw e;
    }
    if (!keepArchive)
        fs.rmSync(tmpDir, { recursive: true, force: true });
    cb(prog('done', 1, `Instalado em ${gameDir}`));
    return [gameDir, exes];
}

export function findMainExe(dir: string, title = ''): string | null {
    return findExecutables(dir, title)[0] || null;
}

export function runInstaller(exe: string, opts: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
        const cancel = opts.cancel || { aborted: false };
        const args: string[] = opts.args && opts.args.length ? opts.args : [];
        let proc: cp.ChildProcess;
        try {
            proc = cp.spawn(exe, args, { cwd: opts.cwd || path.dirname(exe), detached: false, stdio: 'ignore', windowsHide: false });
        }
        catch (e) {
            reject(e);
            return;
        }
        const poll = setInterval(() => {
            if (cancel.aborted) {
                clearInterval(poll);
                try {
                    proc.kill('SIGKILL');
                }
                catch { /* nada */ }
                reject(new CancelledError());
            }
        }, 500);
        proc.on('error', (e) => {
            clearInterval(poll);
            reject(e);
        });
        proc.on('close', (code) => {
            clearInterval(poll);
            if (cancel.aborted)
                return;
            resolve({ ok: code === 0 || code === null, code });
        });
    });
}

export function homeDownloads(): string {
    return path.join(os.homedir(), 'Downloads');
}

void log;
