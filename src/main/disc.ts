import fs from 'node:fs';
import path from 'node:path';
import * as cp from 'node:child_process';
import type { Cancel } from './jobs';

export const IMAGE_EXT = ['.iso', '.cue', '.img', '.bin', '.mdf', '.nrg', '.ccd'];
export const SETUP_NAMES = ['setup.exe', 'install.exe', 'autorun.exe', 'start.exe', 'launcher.exe', 'setup32.exe', 'install32.exe', 'setup64.exe'];
export const WINCDEMU_URL = 'https://github.com/sysprogs/WinCDEmu/releases/download/v4.1/WinCDEmu-4.1.exe';
const WIN = process.platform === 'win32';
export const INSTALLER_RE = /^(setup|install|autorun|msiexec|unarc|unpack|isbew|idriver|_is|is-|dxsetup|vcredist|vc_redist|dotnet|oalinst|physx|directx|redist)/i;

function stem(p: string) {
    return path.parse(p).name;
}
function withSuffix(p: string, ext: string) {
    const pr = path.parse(p);
    return path.join(pr.dir, pr.name + ext);
}
function exists(p: string) {
    try {
        fs.accessSync(p);
        return true;
    }
    catch {
        return false;
    }
}
function rglobFiles(folder: string): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
        let ents: fs.Dirent[];
        try {
            ents = fs.readdirSync(d, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of ents) {
            const p = path.join(d, e.name);
            if (e.isDirectory())
                walk(p);
            else if (e.isFile())
                out.push(p);
        }
    };
    walk(folder);
    return out;
}

export function findImages(folder: string): string[] {
    const out: string[] = [];
    let files: string[];
    try {
        files = rglobFiles(folder).filter((p) => IMAGE_EXT.includes(path.extname(p).toLowerCase()));
    }
    catch {
        return out;
    }
    const cues = new Set(files.filter((p) => path.extname(p).toLowerCase() === '.cue').map((p) => stem(p).toLowerCase()));
    const ccds = new Set(files.filter((p) => path.extname(p).toLowerCase() === '.ccd').map((p) => stem(p).toLowerCase()));
    for (const p of files) {
        const s = path.extname(p).toLowerCase();
        if (s === '.ccd')
            continue;
        const st = stem(p).toLowerCase();
        if ((s === '.bin' || s === '.img') && (cues.has(st) || ccds.has(st)))
            continue;
        if (s === '.img' && (exists(withSuffix(p, '.mds')) || exists(withSuffix(p, '.ccd'))))
            continue;
        if (s !== '.cue') {
            try {
                if (fs.statSync(p).size < 4 * 1024 * 1024)
                    continue;
            }
            catch {
                continue;
            }
        }
        out.push(p);
    }
    const pri: Record<string, number> = { '.iso': 0, '.cue': 1, '.img': 2, '.bin': 3, '.mdf': 4, '.nrg': 5 };
    const k = (p: string): [number, number, string] => {
        const s = stem(p).toLowerCase();
        return [s.includes('disc 1') || s.includes('disk 1') || s.includes('cd1') ? 0 : 1, pri[path.extname(p).toLowerCase()] ?? 9, s];
    };
    out.sort((a, b) => {
        const ka = k(a), kb = k(b);
        return ka[0] - kb[0] || ka[1] - kb[1] || (ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0);
    });
    return out;
}

export interface Track { n: number; mode: string; file: string }

export function parseCue(cue: string): Track[] {
    const tracks: Track[] = [];
    let curFile: string | null = null;
    let text = '';
    try {
        text = fs.readFileSync(cue, 'latin1');
    }
    catch {
        return tracks;
    }
    for (let line of text.split(/\r?\n/)) {
        line = line.trim();
        let m = /^FILE\s+"?(.+?)"?\s+(\w+)$/i.exec(line);
        if (m) {
            curFile = path.join(path.dirname(cue), m[1]);
            continue;
        }
        m = /^TRACK\s+(\d+)\s+(\S+)/i.exec(line);
        if (m && curFile)
            tracks.push({ n: parseInt(m[1], 10), mode: m[2].toUpperCase(), file: curFile });
    }
    return tracks;
}

export function cueInfo(cue: string) {
    const tracks = parseCue(cue);
    const data = tracks.filter((t) => t.mode.startsWith('MODE'));
    const audio = tracks.filter((t) => t.mode === 'AUDIO');
    return { tracks, data, audio, files: Array.from(new Set(tracks.map((t) => t.file))).sort() };
}

function sectorLayout(mode: string): [number, number] {
    const m = mode.toUpperCase();
    if (m === 'MODE1/2048')
        return [2048, 0];
    if (m === 'MODE1/2352')
        return [2352, 16];
    if (m === 'MODE2/2352')
        return [2352, 24];
    if (m === 'MODE2/2336')
        return [2336, 8];
    if (m === 'MODE2/2048')
        return [2048, 0];
    throw new Error(`Formato de faixa não suportado: ${mode}`);
}

export async function cueToIso(cue: string, out: string, cb?: ((f: number) => void) | null, cancel?: Cancel | null): Promise<string> {
    const info = cueInfo(cue);
    if (!info.data.length)
        throw new Error('O .cue não tem faixa de dados');
    const t = info.data[0];
    const src = t.file;
    if (!exists(src))
        throw new Error(`Arquivo do disco não encontrado: ${path.basename(src)}`);
    const [sec, off] = sectorLayout(t.mode);
    const total = (await fs.promises.stat(src)).size;
    const tmp = out + '.part';
    let done = 0;
    const fi = await fs.promises.open(src, 'r');
    const fo = await fs.promises.open(tmp, 'w');
    try {
        if (sec === 2048) {
            const buf = Buffer.alloc(1024 * 1024 * 4);
            for (;;) {
                if (cancel && cancel.aborted)
                    throw new Error('cancelado');
                const { bytesRead: n } = await fi.read(buf, 0, buf.length, null);
                if (!n)
                    break;
                await fo.write(buf, 0, n);
                done += n;
                if (cb)
                    cb(done / total);
            }
        }
        else {
            const chunk = sec * 2048;
            const buf = Buffer.alloc(chunk);
            for (;;) {
                if (cancel && cancel.aborted)
                    throw new Error('cancelado');
                const { bytesRead: got } = await fi.read(buf, 0, chunk, null);
                if (!got)
                    break;
                const n = Math.floor(got / sec);
                const parts: Buffer[] = [];
                for (let i = 0; i < n; i++)
                    parts.push(buf.subarray(i * sec + off, i * sec + off + 2048));
                await fo.write(Buffer.concat(parts));
                done += got;
                if (cb)
                    cb(done / total);
            }
        }
    }
    finally {
        await fi.close();
        await fo.close();
    }
    await fs.promises.rename(tmp, out);
    return out;
}

function isoRoot(iso: string): Array<[string, boolean]> {
    const names: Array<[string, boolean]> = [];
    let d: Buffer;
    try {
        const fd = fs.openSync(iso, 'r');
        try {
            const pvd = Buffer.alloc(2048);
            fs.readSync(fd, pvd, 0, 2048, 16 * 2048);
            if (pvd.subarray(1, 6).toString('latin1') !== 'CD001')
                return names;
            const root = pvd.subarray(156, 190);
            const ext = root.readUInt32LE(2);
            const size = root.readUInt32LE(10);
            d = Buffer.alloc(Math.min(size, 2048 * 64));
            const n = fs.readSync(fd, d, 0, d.length, ext * 2048);
            d = d.subarray(0, n);
        }
        finally {
            fs.closeSync(fd);
        }
    }
    catch {
        return names;
    }
    let i = 0;
    while (i < d.length) {
        const ln = d[i];
        if (ln === 0) {
            i = (Math.floor(i / 2048) + 1) * 2048;
            continue;
        }
        const nl = d[i + 32];
        const nm = d.subarray(i + 33, i + 33 + nl).toString('ascii').replace(/[^\x00-\x7f]/g, '').split(';')[0];
        if (nm !== '\x00' && nm !== '\x01' && nm !== '')
            names.push([nm, Boolean(d[i + 25] & 2)]);
        i += ln;
    }
    return names;
}

export function isoHasSetup(iso: string): boolean {
    const low = new Set(isoRoot(iso).filter(([, isDir]) => !isDir).map(([n]) => n.toLowerCase()));
    return SETUP_NAMES.some((n) => low.has(n)) || low.has('autorun.inf');
}

export function autorunTarget(root: string): string | null {
    const inf = path.join(root, 'autorun.inf');
    if (exists(inf)) {
        try {
            for (const line of fs.readFileSync(inf, 'latin1').split(/\r?\n/)) {
                const m = /^\s*open\s*=\s*(.+)/i.exec(line);
                if (m) {
                    const exe = m[1].trim().replace(/^"|"$/g, '').split(' ')[0];
                    const p = path.join(root, exe);
                    if (exists(p) && path.extname(p).toLowerCase() === '.exe')
                        return p;
                }
            }
        }
        catch { }
    }
    for (const n of SETUP_NAMES) {
        const p = path.join(root, n);
        if (exists(p))
            return p;
    }
    for (const sub of ['setup', 'install', 'Setup', 'Install', 'bin', 'Bin']) {
        const d = path.join(root, sub);
        let isDir = false;
        try {
            isDir = fs.statSync(d).isDirectory();
        }
        catch { }
        if (isDir) {
            for (const n of SETUP_NAMES) {
                const p = path.join(d, n);
                if (exists(p))
                    return p;
            }
        }
    }
    let exes: string[] = [];
    try {
        exes = fs.readdirSync(root).filter((n) => n.toLowerCase().endsWith('.exe')).map((n) => path.join(root, n));
    }
    catch { }
    exes.sort((a, b) => {
        const sa = fs.statSync(a).size, sb = fs.statSync(b).size;
        return sa - sb;
    });
    return exes.length ? exes[0] : null;
}

function ps(cmd: string, timeout = 90): Promise<{ status: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        try {
            cp.execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { encoding: 'utf8', timeout: timeout * 1000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err: any, stdout: any, stderr: any) => {
                resolve({ status: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
            });
        }
        catch (e: any) {
            resolve({ status: 1, stdout: '', stderr: String(e?.message || e) });
        }
    });
}

export async function mount(iso: string): Promise<string> {
    if (!WIN)
        throw new Error('Montar disco só funciona no Windows');
    const q = "'" + iso.replace(/'/g, "''") + "'";
    const r = await ps(`$i=Mount-DiskImage -ImagePath ${q} -PassThru -ErrorAction Stop; Start-Sleep -Milliseconds 800; ($i | Get-Volume).DriveLetter`);
    const outTxt = String(r.stdout || '').trim();
    let letter = outTxt ? (outTxt.split(/\r?\n/).pop() || '').trim() : '';
    if (r.status !== 0 || !/^[A-Za-z]$/.test(letter)) {
        for (let i = 0; i < 6; i++) {
            await sleep(1000);
            const r2 = await ps(`(Get-DiskImage -ImagePath ${q} | Get-Volume).DriveLetter`);
            letter = String(r2.stdout || '').trim();
            if (/^[A-Za-z]$/.test(letter))
                break;
        }
    }
    if (!/^[A-Za-z]$/.test(letter)) {
        const err = String(r.stderr || '').trim().split(/\r?\n/).filter(Boolean);
        throw new Error(err.length ? err[0].slice(0, 160) : 'O Windows não conseguiu montar a imagem');
    }
    return `${letter.toUpperCase()}:\\`;
}

export async function unmount(iso: string): Promise<void> {
    if (!WIN)
        return;
    const q = "'" + iso.replace(/'/g, "''") + "'";
    try {
        await ps(`Dismount-DiskImage -ImagePath ${q} -ErrorAction SilentlyContinue`, 40);
    }
    catch { }
}

async function procs(): Promise<any[]> {
    const procsMod = await import('./procs');
    const list = await procsMod.list();
    return list.map((p) => ({ ProcessId: p.pid, ParentProcessId: p.ppid, ExecutablePath: p.exe, Name: p.exe ? path.basename(p.exe) : '', CreationDate: p.created }));
}

export function relatedProcs(seen: Set<number>, drive: string | null, t0: number, list: any[]): any[] {
    const d = drive ? drive.slice(0, 2).toLowerCase() + '\\' : null;
    const out: any[] = [];
    let grew = true;
    while (grew) {
        grew = false;
        for (const p of list) {
            const pid = Number(p.ProcessId || 0), ppid = Number(p.ParentProcessId || 0);
            if (seen.has(pid))
                continue;
            const pth = String(p.ExecutablePath || '').toLowerCase();
            const name = String(p.Name || '');
            let rel = seen.has(ppid) || Boolean(d && pth.startsWith(d));
            if (!rel && INSTALLER_RE.test(name) && Number(p.CreationDate || 0) >= t0 - 5)
                rel = true;
            if (rel) {
                seen.add(pid);
                grew = true;
            }
        }
    }
    for (const p of list)
        if (seen.has(Number(p.ProcessId || 0)))
            out.push(p);
    return out;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function waitInstall(pid: number, drive: string | null, t0: number, onTick?: ((alive: any[]) => void) | null, maxS = 3 * 3600): Promise<number> {
    if (!WIN)
        return 0;
    const seen = new Set<number>(pid ? [pid] : []);
    let quiet = 0;
    const deadline = Date.now() / 1000 + maxS;
    await sleep(3000);
    while (Date.now() / 1000 < deadline) {
        const alive = relatedProcs(seen, drive, t0, await procs());
        if (alive.length) {
            quiet = 0;
            if (onTick)
                onTick(alive);
        }
        else {
            quiet += 1;
            if (quiet >= 2)
                break;
        }
        await sleep(4000);
    }
    return Date.now() / 1000 - t0;
}

export interface DiscPlan { image: string; images: string[]; kind: string; convert: boolean; audio: boolean; setup: boolean }

export function plan(folder: string): DiscPlan | null {
    const imgs = findImages(folder);
    if (!imgs.length)
        return null;
    const first = imgs[0];
    const ext = path.extname(first).toLowerCase();
    const out: DiscPlan = { image: first, images: imgs, kind: ext.replace(/^\./, ''), convert: false, audio: false, setup: true };
    if (ext === '.cue') {
        const info = cueInfo(first);
        out.convert = true;
        out.audio = info.audio.length > 0;
        out.setup = info.data.length > 0;
    }
    else if (ext === '.bin' || ext === '.img')
        out.convert = true;
    else if (ext === '.iso')
        out.setup = isoHasSetup(first);
    else
        out.setup = false;
    return out;
}
