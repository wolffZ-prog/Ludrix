import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import * as cp from 'node:child_process';
import * as P from './paths';
import * as log from './log';

const WIN = process.platform === 'win32';
const SUGGESTED = WIN
    ? ['Discord.exe', 'chrome.exe', 'msedge.exe', 'firefox.exe', 'opera.exe', 'brave.exe', 'Spotify.exe',
        'steam.exe', 'EpicGamesLauncher.exe', 'GalaxyClient.exe', 'Battle.net.exe', 'RiotClientServices.exe',
        'OneDrive.exe', 'Teams.exe', 'ms-teams.exe', 'WhatsApp.exe', 'Telegram.exe', 'Skype.exe',
        'obs64.exe', 'NVIDIA Share.exe', 'RadeonSoftware.exe', 'Overwolf.exe', 'wallpaper64.exe', 'Rainmeter.exe']
    : ['Discord', 'chrome', 'chromium', 'firefox', 'brave', 'opera', 'spotify', 'steam', 'heroic', 'lutris',
        'telegram-desktop', 'slack', 'obs', 'vesktop', 'electron'];
const HIGH_PERF_GUID = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';
const ULTIMATE_GUID = 'e9a42b02-d5df-448d-aa00-03f14749eb61';
const KHORVIE_GUID = '02836485-1111-1111-1111-111111111111';
const PLANS: Record<string, string> = { high: 'Alto desempenho', ultimate: 'Desempenho máximo (Ultimate)', khorvie: 'Khorvie (comunidade)' };

function run(cmd: string, args: string[], timeout = 6000): Promise<string> {
    return new Promise((resolve) => {
        try {
            cp.execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 16 << 20, encoding: 'utf8' }, (err, out) => resolve(err ? String(out || '') : String(out || '')));
        }
        catch {
            resolve('');
        }
    });
}

export type Proc = { pid: number; name: string; mem: number; exe: string };

/** Lista de processos (nome, memória, executável), sem psutil. */
export async function processes(): Promise<Proc[]> {
    const out: Proc[] = [];
    if (WIN) {
        const procsMod = await import('./procs');
        for (const p of await procsMod.list(0, true)) {
            const name = p.exe ? path.basename(p.exe) : '';
            if (name)
                out.push({ pid: p.pid, name, mem: p.mem || 0, exe: p.exe.includes('\\') ? p.exe : '' });
        }
        if (out.length)
            return out;
        const csv = await run('tasklist', ['/FO', 'CSV', '/NH'], 8000);
        for (const line of csv.split(/\r?\n/)) {
            const m = /^"([^"]*)","(\d+)","[^"]*","[^"]*","([^"]*)"/.exec(line);
            if (m)
                out.push({ pid: Number(m[2]), name: m[1], mem: (Number(m[3].replace(/[^\d]/g, '')) || 0) * 1024, exe: '' });
        }
        return out;
    }
    const txt = await run('ps', ['-eo', 'pid=,rss=,comm=,args='], 5000);
    for (const line of txt.split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(line);
        if (!m)
            continue;
        const args = m[4] || '';
        const exe = args.split(' ')[0] || '';
        out.push({ pid: Number(m[1]), name: m[3], mem: Number(m[2]) * 1024, exe });
    }
    return out;
}

function alive(pid: number) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (e: any) {
        return e?.code === 'EPERM';
    }
}

export class GameMode {
    active = false;
    prevPlan: string | null = null;
    closed: string[] = [];
    constructor(private cfg: () => any) { }

    async snapshot() {
        const c = this.cfg();
        const out: any = {
            windows: WIN, active: this.active, ram: {}, running: [], suggested: SUGGESTED, gamemode: this.linuxGamemode(),
            close_list: c.game_mode_close || [], reopen: c.game_mode_reopen !== false,
            power: c.game_mode_power !== false, quiet: c.game_mode_quiet !== false,
            priority: c.game_mode_priority !== false, plan: await this.currentPlanName(),
        };
        try {
            const total = os.totalmem(), avail = os.freemem();
            out.ram = { total, used: total - avail, avail, pct: Math.round(((total - avail) / total) * 1000) / 10 };
            const names = new Set((out.close_list as string[]).map((n) => n.toLowerCase()));
            const sugg = new Set(SUGGESTED.map((n) => n.toLowerCase()));
            const seen: Record<string, any> = {};
            for (const p of await processes()) {
                const key = p.name.toLowerCase();
                if (!names.has(key) && !sugg.has(key))
                    continue;
                if (seen[key]) {
                    seen[key].mem += p.mem;
                    seen[key].count += 1;
                }
                else {
                    seen[key] = { name: p.name, mem: p.mem, count: 1, exe: p.exe || '', listed: names.has(key) };
                }
            }
            out.running = Object.values(seen).sort((a: any, b: any) => b.mem - a.mem);
        }
        catch (e) {
            log.warn('gamemode snapshot: %s', e);
        }
        return out;
    }

    linuxGamemode() {
        if (WIN)
            return false;
        for (const d of String(process.env.PATH || '').split(':'))
            if (d && fs.existsSync(path.join(d, 'gamemoderun')))
                return true;
        return false;
    }

    async currentPlanName() {
        if (!WIN)
            return '';
        const out = await run('powercfg', ['/getactivescheme'], 5000);
        const t = out.trim();
        return t.includes('(') ? t.split('(').pop()!.replace(/\)\s*$/, '') : t;
    }

    async optimize() {
        const c = this.cfg();
        const done: any = { closed: [], power: false };
        if (Array.isArray(c.game_mode_close) && c.game_mode_close.length)
            done.closed = await this.closeApps(c.game_mode_close);
        if (c.game_mode_power !== false) {
            const guid = await this.planGuid(c.game_mode_plan || 'high');
            done.power = guid ? await this.setPower(guid, true) : false;
            done.plan = PLANS[c.game_mode_plan || 'high'] || '';
        }
        this.active = true;
        return done;
    }

    async restore() {
        const out: any = { reopened: [], power: false };
        if (!this.active)
            return out;
        if (this.prevPlan) {
            out.power = await this.setPower(this.prevPlan, false);
            this.prevPlan = null;
        }
        if (this.cfg().game_mode_reopen !== false) {
            for (const exe of this.closed) {
                try {
                    cp.spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
                    out.reopened.push(path.basename(exe));
                }
                catch (e) {
                    log.info('reabrir %s: %s', exe, e);
                }
            }
        }
        this.closed = [];
        this.active = false;
        return out;
    }

    boostPid(pid: number) {
        if (this.cfg().game_mode_priority === false || !this.active || !pid)
            return;
        try {
            if (WIN)
                os.setPriority(pid, -5);
            else
                os.setPriority(pid, -5);
        }
        catch (e) {
            log.info('prioridade: %s', e);
        }
    }

    async closeApps(names: string[]) {
        const wanted = new Set(names.map((n) => n.toLowerCase()));
        const procs = (await processes()).filter((p) => wanted.has(p.name.toLowerCase()));
        const exes: Record<string, string> = {};
        for (const p of procs) {
            if (p.exe && !exes[p.name.toLowerCase()])
                exes[p.name.toLowerCase()] = p.exe;
            try {
                process.kill(p.pid, 'SIGTERM');
            }
            catch { /* ignore */ }
        }
        const t0 = Date.now();
        while (Date.now() - t0 < 4000 && procs.some((p) => alive(p.pid)))
            await new Promise((r) => setTimeout(r, 200));
        for (const p of procs) {
            if (alive(p.pid)) {
                try {
                    process.kill(p.pid, 'SIGKILL');
                }
                catch { /* ignore */ }
            }
        }
        const closed: string[] = [];
        for (const [, exe] of Object.entries(exes)) {
            closed.push(path.basename(exe));
            if (!this.closed.includes(exe))
                this.closed.push(exe);
        }
        return closed;
    }

    async plansInstalled() {
        if (!WIN)
            return new Set<string>();
        const out = await run('powercfg', ['/list'], 5000);
        return new Set(out.split(/\s+/).filter((x) => x.length === 36 && x.split('-').length === 5).map((x) => x.toLowerCase()));
    }

    async planGuid(plan: string) {
        if (plan === 'high' || !WIN)
            return HIGH_PERF_GUID;
        const have = await this.plansInstalled();
        try {
            if (plan === 'ultimate') {
                if (have.has(ULTIMATE_GUID))
                    return ULTIMATE_GUID;
                await run('powercfg', ['-duplicatescheme', ULTIMATE_GUID, ULTIMATE_GUID], 8000);
                return (await this.plansInstalled()).has(ULTIMATE_GUID) ? ULTIMATE_GUID : HIGH_PERF_GUID;
            }
            if (plan === 'khorvie') {
                if (have.has(KHORVIE_GUID))
                    return KHORVIE_GUID;
                const pow = path.join(P.ASSETS, 'presets', 'khorvie.pow');
                if (!fs.existsSync(pow))
                    return HIGH_PERF_GUID;
                await run('powercfg', ['-import', pow, KHORVIE_GUID], 10_000);
                return (await this.plansInstalled()).has(KHORVIE_GUID) ? KHORVIE_GUID : HIGH_PERF_GUID;
            }
        }
        catch (e) {
            log.info('plano %s: %s', plan, e);
        }
        return HIGH_PERF_GUID;
    }

    async setPower(guid: string, remember: boolean) {
        if (!WIN)
            return false;
        try {
            if (remember) {
                const out = await run('powercfg', ['/getactivescheme'], 5000);
                const cur = out.split(/\s+/).find((x) => x.length === 36 && x.split('-').length === 5) || null;
                if (cur && cur.toLowerCase() === guid.toLowerCase())
                    return true;
                this.prevPlan = cur;
            }
            await run('powercfg', ['/setactive', guid], 5000);
            return true;
        }
        catch (e) {
            log.info('powercfg: %s', e);
            return false;
        }
    }
}
