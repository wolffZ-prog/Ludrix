import fs from 'node:fs';
import path from 'node:path';
import * as cp from 'node:child_process';
import * as P from './paths';

export type Proc = { pid: number; ppid: number; exe: string; created: number; mem?: number };

const WIN = process.platform === 'win32';
let cache: { at: number; list: Proc[]; mem: boolean } | null = null;

export function alive(pid: number): boolean {
    if (!pid)
        return false;
    try {
        process.kill(pid, 0);
    }
    catch (e: any) {
        if (e?.code === 'EPERM')
            return true;
        return false;
    }
    if (!WIN) {
        try {
            const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
            const state = st.slice(st.lastIndexOf(')') + 2).split(' ')[0];
            if (state === 'Z' || state === 'X')
                return false;
        }
        catch { /* sem procfs */ }
    }
    return true;
}

export function helperExe(): string | null {
    if (!WIN)
        return null;
    const p = path.join(P.ASSETS, 'bin', 'ludrix-procs.exe');
    return fs.existsSync(p) ? p : null;
}

function execText(file: string, args: string[], timeout: number, maxBuffer = 32 * 1024 * 1024): Promise<string> {
    return new Promise((resolve) => {
        try {
            cp.execFile(file, args, { encoding: 'utf8', windowsHide: true, timeout, maxBuffer }, (err, out) => resolve(err && !out ? '' : String(out || '')));
        }
        catch {
            resolve('');
        }
    });
}

function parseHelper(out: string): Proc[] {
    const res: Proc[] = [];
    for (const line of out.split(/\r?\n/)) {
        const c = line.split('\t');
        if (c.length < 5)
            continue;
        const pid = Number(c[0]);
        if (!pid)
            continue;
        res.push({ pid, ppid: Number(c[1]) || 0, created: Number(c[2]) || 0, mem: Number(c[3]) || 0, exe: c.slice(4).join('\t').trim() });
    }
    return res;
}

async function listWin(mem = false): Promise<Proc[]> {
    const h = helperExe();
    if (h) {
        const out = await execText(h, mem ? ['mem'] : [], 15000);
        const res = parseHelper(out);
        if (res.length)
            return res;
    }
    const ps = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate,WorkingSetSize | ConvertTo-Json -Compress';
    const out = await execText('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], 20000);
    try {
        let arr = JSON.parse(out || '[]');
        if (!Array.isArray(arr))
            arr = [arr];
        return arr.map((p: any) => ({
            pid: Number(p.ProcessId || 0), ppid: Number(p.ParentProcessId || 0), exe: String(p.ExecutablePath || ''),
            created: parseCim(p.CreationDate), mem: Number(p.WorkingSetSize || 0),
        })).filter((p: Proc) => p.pid > 0);
    }
    catch {
        return [];
    }
}

function parseCim(v: any): number {
    if (!v)
        return 0;
    if (typeof v === 'object' && v.DateTime)
        v = v.DateTime;
    if (typeof v === 'string') {
        const m = v.match(/\/Date\((\d+)\)\//);
        if (m)
            return Number(m[1]) / 1000;
        const m2 = v.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
        if (m2)
            return new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]), Number(m2[4]), Number(m2[5]), Number(m2[6])).getTime() / 1000;
        const d = Date.parse(v);
        return Number.isFinite(d) ? d / 1000 : 0;
    }
    return 0;
}

let bootAt = 0;
let hz = 100;
function linuxBoot() {
    if (bootAt)
        return bootAt;
    try {
        const m = fs.readFileSync('/proc/stat', 'utf8').match(/^btime\s+(\d+)/m);
        bootAt = m ? Number(m[1]) : Date.now() / 1000;
    }
    catch {
        bootAt = Date.now() / 1000;
    }
    try {
        hz = Number(cp.execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim()) || 100;
    }
    catch { /* padrão */ }
    return bootAt;
}

function listLinux(mem = false): Proc[] {
    const out: Proc[] = [];
    let names: string[] = [];
    try {
        names = fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n));
    }
    catch {
        return out;
    }
    const boot = linuxBoot();
    for (const n of names) {
        const pid = Number(n);
        try {
            const st = fs.readFileSync(`/proc/${n}/stat`, 'utf8');
            const rest = st.slice(st.lastIndexOf(')') + 2).split(' ');
            if (rest[0] === 'Z')
                continue;
            const ppid = Number(rest[1] || 0);
            const start = Number(rest[19] || 0) / hz + boot;
            let exe = '';
            try {
                exe = fs.readlinkSync(`/proc/${n}/exe`).replace(/ \(deleted\)$/, '');
            }
            catch { /* sem permissão */ }
            let rss = 0;
            if (mem) {
                try {
                    rss = Number(fs.readFileSync(`/proc/${n}/statm`, 'utf8').split(' ')[1] || 0) * 4096;
                }
                catch { /* ignore */ }
            }
            out.push({ pid, ppid, exe, created: start, mem: rss });
        }
        catch { /* processo sumiu */ }
    }
    return out;
}

export async function list(maxAge = 0, mem = false): Promise<Proc[]> {
    const now = Date.now();
    if (cache && maxAge > 0 && now - cache.at < maxAge * 1000 && (!mem || cache.mem))
        return cache.list;
    const l = WIN ? await listWin(mem) : listLinux(mem);
    cache = { at: now, list: l, mem };
    return l;
}

export function cached(): Proc[] {
    return cache?.list || [];
}

export function children(pid: number, procs?: Proc[]): number[] {
    const all = procs || cached();
    const out: number[] = [];
    const seen = new Set<number>([pid]);
    const walk = (p: number) => {
        for (const q of all) {
            if (q.ppid === p && !seen.has(q.pid)) {
                seen.add(q.pid);
                out.push(q.pid);
                walk(q.pid);
            }
        }
    };
    walk(pid);
    return out;
}

export function normExe(p: string): string {
    const n = path.normalize(p || '');
    return WIN ? n.toLowerCase() : n;
}

export async function killTree(pids: number[], onDone?: () => void): Promise<void> {
    const all = new Set<number>(pids.filter(Boolean));
    if (!all.size) {
        onDone?.();
        return;
    }
    if (WIN) {
        const h = helperExe();
        if (h)
            await execText(h, ['kill', ...[...all].map(String)], 15000);
        else {
            for (const pid of all)
                await execText('taskkill', ['/PID', String(pid), '/T', '/F'], 8000);
        }
        onDone?.();
        return;
    }
    let procs: Proc[] = [];
    try {
        procs = await list();
    }
    catch { /* ignore */ }
    for (const p of [...all])
        for (const c of children(p, procs))
            all.add(c);
    for (const pid of all) {
        try {
            process.kill(pid, 'SIGTERM');
        }
        catch { /* ignore */ }
    }
    const t = setTimeout(() => {
        for (const pid of all) {
            if (alive(pid)) {
                try {
                    process.kill(pid, 'SIGKILL');
                }
                catch { /* ignore */ }
            }
        }
        onDone?.();
    }, 4000);
    t.unref?.();
}
