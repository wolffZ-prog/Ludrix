import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import * as cp from 'node:child_process';
import * as electron from 'electron';
import * as P from './paths';

const WIN = process.platform === 'win32';
let cache: { t: number; v: any } = { t: 0, v: null };

function run(cmd: string, args: string[], timeout = 4000): Promise<string> {
    return new Promise((resolve) => {
        try {
            cp.execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 8 << 20, encoding: 'utf8' }, (err, out) => resolve(err ? '' : String(out || '')));
        }
        catch {
            resolve('');
        }
    });
}

/** `reg query` em um bloco: devolve [{key, values:{name:[type,data]}}]. */
async function regQuery(key: string, recursive = false, valueName?: string): Promise<Array<{ key: string; values: Record<string, [string, string]> }>> {
    if (!WIN)
        return [];
    const args = ['query', key];
    if (recursive)
        args.push('/s');
    if (valueName)
        args.push('/v', valueName);
    const out = await run('reg', args);
    const blocks: Array<{ key: string; values: Record<string, [string, string]> }> = [];
    let cur: { key: string; values: Record<string, [string, string]> } | null = null;
    for (const raw of out.split(/\r?\n/)) {
        if (!raw.trim())
            continue;
        if (!raw.startsWith(' ')) {
            cur = { key: raw.trim(), values: {} };
            blocks.push(cur);
            continue;
        }
        const m = /^\s{2,}(.+?)\s{2,}(REG_[A-Z_]+)\s{2,}(.*)$/.exec(raw) || /^\s{2,}(.+?)\s{2,}(REG_[A-Z_]+)\s*$/.exec(raw);
        if (m && cur)
            cur.values[m[1]] = [m[2], m[3] ?? ''];
    }
    return blocks;
}

function regNum(v?: [string, string]): number {
    if (!v)
        return 0;
    const [t, d] = v;
    if (t === 'REG_DWORD' || t === 'REG_QWORD')
        return Number.parseInt(d, 16) || 0;
    if (t === 'REG_BINARY') {
        const hex = d.replace(/[^0-9a-fA-F]/g, '').slice(0, 16);
        let n = 0;
        for (let i = hex.length - 2; i >= 0; i -= 2)
            n = n * 256 + Number.parseInt(hex.slice(i, i + 2), 16);
        return n;
    }
    return Number(d) || 0;
}

async function cpu() {
    let name = '', mhz = 0;
    if (WIN) {
        const b = await regQuery('HKLM\\HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0');
        const v = b[0]?.values || {};
        name = v['ProcessorNameString']?.[1] || '';
        mhz = regNum(v['~MHz']);
    }
    else {
        try {
            for (const line of fs.readFileSync('/proc/cpuinfo', 'utf8').split('\n')) {
                if (line.toLowerCase().startsWith('model name')) {
                    name = line.split(':').slice(1).join(':').trim();
                    break;
                }
            }
        }
        catch { /* ignore */ }
    }
    const cpus = os.cpus();
    name = (name || cpus[0]?.model || 'CPU').replace(/\(R\)|\(TM\)/g, '').replace(/\s+/g, ' ').trim();
    const logical = cpus.length || os.availableParallelism?.() || 0;
    let physical = 0;
    if (!WIN) {
        try {
            const ids = new Set<string>();
            let cur: Record<string, string> = {};
            for (const line of fs.readFileSync('/proc/cpuinfo', 'utf8').split('\n')) {
                if (line.includes(':')) {
                    const [k, v] = line.split(':', 2).map((x) => x.trim());
                    cur[k] = v;
                }
                else if (!line.trim()) {
                    if ('core id' in cur)
                        ids.add(`${cur['physical id'] || '0'}:${cur['core id']}`);
                    cur = {};
                }
            }
            physical = ids.size;
        }
        catch { /* ignore */ }
    }
    else {
        const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum'], 6000);
        const n = Number(String(out).trim().split(/\s+/).pop() || 0);
        if (n)
            physical = n;
    }
    if (!mhz && cpus[0]?.speed)
        mhz = cpus[0].speed;
    return { name, cores: physical || logical, threads: logical, mhz: Math.round(mhz || 0) };
}

function ram() {
    return { total: os.totalmem(), available: os.freemem() };
}

async function gpus() {
    const out: Array<{ name: string; vram: number; driver: string }> = [];
    if (WIN) {
        const base = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}';
        const blocks = await regQuery(base, true);
        for (const b of blocks) {
            const sub = b.key.split('\\').pop() || '';
            if (!/^\d{4}$/.test(sub))
                continue;
            const desc = b.values['DriverDesc']?.[1];
            if (!desc)
                continue;
            let vram = regNum(b.values['HardwareInformation.qwMemorySize']);
            if (!vram)
                vram = regNum(b.values['HardwareInformation.MemorySize']);
            const drv = b.values['DriverVersion']?.[1] || '';
            if (!out.some((g) => g.name === desc))
                out.push({ name: desc, vram, driver: drv });
        }
        return out;
    }
    const txt = await run('lspci', [], 3000);
    for (const line of txt.split('\n')) {
        if (/VGA|3D controller|Display controller/.test(line)) {
            let name = line.split(':').slice(2).join(':').trim();
            name = name.replace(/\s*\(rev \w+\)$/, '');
            out.push({ name, vram: 0, driver: '' });
        }
    }
    const cards: Array<{ name: string; vram: number; driver: string }> = [];
    try {
        for (const c of fs.readdirSync('/sys/class/drm').filter((n) => /^card\d$/.test(n)).sort()) {
            const card = path.join('/sys/class/drm', c);
            try {
                const vendor = fs.readFileSync(path.join(card, 'device/vendor'), 'utf8').trim();
                const dev = fs.readFileSync(path.join(card, 'device/device'), 'utf8').trim();
                let vram = 0;
                const vf = path.join(card, 'device/mem_info_vram_total');
                if (fs.existsSync(vf))
                    vram = Number(fs.readFileSync(vf, 'utf8').trim() || 0);
                let drv = '';
                const lnk = path.join(card, 'device/driver');
                if (fs.existsSync(lnk))
                    drv = path.basename(fs.realpathSync(lnk));
                cards.push({ name: `GPU ${vendor}:${dev}`, vram, driver: drv });
            }
            catch { /* ignore */ }
        }
    }
    catch { /* ignore */ }
    if (!out.length)
        return cards;
    cards.forEach((c, i) => {
        if (out[i]) {
            out[i].vram = out[i].vram || c.vram;
            out[i].driver = out[i].driver || c.driver;
        }
    });
    return out;
}

async function osInfo() {
    let name = os.type(), ver = os.release(), build = os.version();
    if (WIN) {
        const b = await regQuery('HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion');
        const v = b[0]?.values || {};
        let prod = v['ProductName']?.[1] || `Windows ${ver}`;
        const disp = v['DisplayVersion']?.[1] || '';
        const bn = v['CurrentBuildNumber']?.[1] || '';
        if (bn && Number(bn) >= 22000 && prod.includes('Windows 10'))
            prod = prod.replace('Windows 10', 'Windows 11');
        name = `${prod} ${disp}`.trim();
        build = String(bn);
    }
    else {
        try {
            for (const line of fs.readFileSync('/etc/os-release', 'utf8').split('\n'))
                if (line.startsWith('PRETTY_NAME='))
                    name = line.split('=').slice(1).join('=').trim().replace(/^"|"$/g, '');
        }
        catch { /* ignore */ }
    }
    return { name, version: ver, build, arch: os.arch() === 'x64' ? 'AMD64' : os.arch(), python: '', node: process.versions.node, electron: process.versions.electron || '' };
}

function disks() {
    const out: Array<{ mount: string; total: number; free: number; launcher: boolean }> = [];
    const usage = (p: string) => {
        const st = fs.statfsSync(p);
        return { total: Number(st.blocks) * Number(st.bsize), free: Number(st.bavail) * Number(st.bsize) };
    };
    if (WIN) {
        for (let i = 0; i < 26; i++) {
            const d = `${String.fromCharCode(65 + i)}:\\`;
            try {
                if (!fs.existsSync(d))
                    continue;
                const u = usage(d);
                if (!u.total)
                    continue;
                out.push({ mount: d, total: u.total, free: u.free, launcher: P.ROOT.toUpperCase().startsWith(d.toUpperCase()) });
            }
            catch { /* unidade sem mídia */ }
        }
        return out;
    }
    const seen = new Set<number>();
    for (const m of ['/', os.homedir(), P.ROOT]) {
        try {
            const dev = fs.statSync(m).dev;
            if (seen.has(dev))
                continue;
            seen.add(dev);
            const u = usage(m);
            out.push({ mount: m, total: u.total, free: u.free, launcher: m === P.ROOT });
        }
        catch { /* ignore */ }
    }
    return out;
}

function screen() {
    try {
        const d = electron.screen.getPrimaryDisplay();
        return { w: Math.round(d.size.width * d.scaleFactor), h: Math.round(d.size.height * d.scaleFactor), monitors: electron.screen.getAllDisplays().length };
    }
    catch {
        return {};
    }
}

function gamepads() {
    if (!WIN) {
        try {
            return fs.readdirSync('/dev/input').filter((n) => /^js\d+$/.test(n)).length;
        }
        catch {
            return 0;
        }
    }
    return 0;
}

export function tier(hw: any) {
    const ramGb = hw.ram.total ? hw.ram.total / 2 ** 30 : 0;
    const gpu = hw.gpus.map((g: any) => g.name).join(' ').toLowerCase();
    const vramGb = Math.max(0, ...hw.gpus.map((g: any) => Number(g.vram) || 0)) / 2 ** 30;
    let score = 0;
    score += ramGb >= 16 ? 2 : ramGb >= 8 ? 1 : 0;
    score += hw.cpu.threads >= 8 ? 2 : hw.cpu.threads >= 4 ? 1 : 0;
    const dedicated = /rtx|gtx|radeon rx|arc a|arc b|geforce|rx \d{3,4}/.test(gpu) && !/vega \d\b|graphics$/.test(gpu);
    score += dedicated && vramGb >= 6 ? 3 : dedicated ? 2 : /iris|vega|radeon|uhd|760m|780m|890m/.test(gpu) ? 1 : 0;
    const level = score >= 6 ? 'high' : score >= 4 ? 'mid' : 'low';
    const hint = {
        high: 'Roda de tudo: PS3/Switch/Wii U/Xbox 360 emulados e jogos de PC recentes.',
        mid: 'Bom pra PC até ~2018, PS2/GameCube/Wii/PSP/3DS sem susto; PS3 e Switch dependem do jogo.',
        low: 'Ideal pra clássicos: PS1, N64, SNES, Mega Drive, GBA, DOS e PC até ~2010. PS2 em resolução nativa.',
    }[level];
    return { level, score, hint };
}

let inflight: Promise<any> | null = null;

export function detect(force = false): Promise<any> {
    const now = Date.now();
    if (!force && cache.v && now - cache.t < 60_000)
        return Promise.resolve(cache.v);
    if (inflight)
        return inflight;
    inflight = (async () => {
        const [c, g, o] = await Promise.all([cpu(), gpus(), osInfo()]);
        const hw: any = { cpu: c, ram: ram(), gpus: g, os: o, disks: disks(), screen: screen(), gamepads: gamepads(), hostname: os.hostname(), portable: true, root: P.ROOT };
        hw.tier = tier(hw);
        cache = { t: Date.now(), v: hw };
        inflight = null;
        return hw;
    })();
    return inflight;
}

/** Última leitura, sem esperar (null se ainda não houve). */
export function last() {
    return cache.v;
}
