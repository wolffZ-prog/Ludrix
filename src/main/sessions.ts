import fs from 'node:fs';
import path from 'node:path';
import * as cp from 'node:child_process';
import * as log from './log';
import * as procs from './procs';

const WIN = process.platform === 'win32';
const now = () => Date.now() / 1000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type Session = {
    key: string; title: string; pid: number; rootPid: number; child?: cp.ChildProcess; started: number;
    after: string | null; optimize: boolean; external?: boolean; elevated?: boolean; killed?: boolean;
    rc?: number | null; exited?: boolean; last_save?: number; crashed?: boolean;
};

export class SessionManager {
    active = new Map<string, Session>();
    onStart: ((s: Session) => void) | null = null;
    onEnd: ((s: Session, elapsed: number) => void) | null = null;
    onBoost: ((pid: number) => void) | null = null;
    linuxWrap: ((cmd: string[], key: string) => { cmd: string[]; env?: any }) | null = null;
    nextAfter: string | null = null;
    nextOptimize = false;
    private extSeen = new Set<number>();
    private extTimer: NodeJS.Timeout | null = null;
    constructor(private store: any) { }

    startExternalWatch() {
        if (this.extTimer)
            return;
        const loop = async () => {
            try {
                if (this.store.config.track_external !== false) {
                    const m = this.exeMap();
                    if (m.size) {
                        const live = new Set<number>();
                        for (const s of this.active.values()) {
                            live.add(s.pid);
                            live.add(s.rootPid);
                        }
                        for (const p of await procs.list()) {
                            if (!p.exe)
                                continue;
                            const key = m.get(procs.normExe(p.exe));
                            if (!key || this.active.has(key) || live.has(p.pid) || this.extSeen.has(p.pid))
                                continue;
                            this.adopt(key, p.pid, p.created || now());
                        }
                    }
                }
                this.extSeen = new Set([...this.extSeen].filter((pid) => procs.alive(pid)));
            }
            catch (e) {
                log.debug?.('external watch: %s', e);
            }
            this.extTimer = setTimeout(loop, 15_000);
            this.extTimer.unref?.();
        };
        this.extTimer = setTimeout(loop, 20_000);
        this.extTimer.unref?.();
    }

    private exeMap() {
        const m = new Map<string, string>();
        for (const [key, info] of Object.entries<any>(this.store.library || {})) {
            if (['emulator', 'tool', 'redist', 'optional'].includes(info.kind) || info.installed === false)
                continue;
            const exe = String(info.exe || '');
            if (!exe || exe.includes('://') || !path.isAbsolute(exe) || /\.(lnk|url|bat|cmd)$/i.test(exe))
                continue;
            const k = procs.normExe(exe);
            if (!m.has(k))
                m.set(k, key);
        }
        return m;
    }

    private adopt(key: string, pid: number, started: number) {
        const info = this.store.lib(key) || {};
        this.extSeen.add(pid);
        const sess: Session = { key, title: info.title || key, pid, rootPid: pid, started: Math.max(started, now() - 120), after: 'none', optimize: false, external: true };
        if (this.active.has(key))
            return;
        this.active.set(key, sess);
        this.store.patchLib(key, { last_played: sess.started });
        void this.watch(sess);
        this.fire(sess);
    }

    private fire(sess: Session) {
        if (this.onStart) {
            try {
                this.onStart(sess);
            }
            catch (e) {
                log.error('on_start: %s', e);
            }
        }
    }

    launch(key: string, cmd: string[], cwd: string, title: string) {
        let child: cp.ChildProcess;
        let env: any = undefined;
        try {
            if (!WIN) {
                if (this.linuxWrap) {
                    const w = this.linuxWrap(cmd, key);
                    cmd = w.cmd;
                    env = w.env || undefined;
                }
                if (this.nextOptimize) {
                    const gm = require('./compat').gamemodePath();
                    if (gm)
                        cmd = [gm, ...cmd];
                }
            }
            child = spawnGame(cmd, cwd, env);
            if (!child.pid)
                throw new Error('sem pid');
        }
        catch (e: any) {
            if (WIN && cmd.length === 1) {
                try {
                    const r = require('electron').shell.openPath(cmd[0]);
                    void r;
                    this.store.patchLib(key, { last_played: now() });
                    return { ok: true, tracked: false };
                }
                catch (e2: any) {
                    return { error: String(e2?.message || e2) };
                }
            }
            return { error: String(e?.message || e) };
        }
        const sess: Session = { key, title, pid: child.pid!, rootPid: child.pid!, child, started: now(), after: this.nextAfter, optimize: this.nextOptimize };
        this.nextAfter = null;
        this.nextOptimize = false;
        child.on('exit', (code, sig) => {
            sess.rc = code ?? (sig ? 1 : 0);
            sess.exited = true;
        });
        child.on('error', () => {
            sess.rc = 1;
            sess.exited = true;
        });
        this.active.set(key, sess);
        this.store.patchLib(key, { last_played: sess.started });
        void this.watch(sess);
        this.fire(sess);
        return { ok: true, tracked: true, pid: child.pid };
    }

    launchPid(key: string, pid: number, title: string) {
        const sess: Session = { key, title, pid, rootPid: pid, started: now(), after: this.nextAfter, optimize: this.nextOptimize, elevated: true };
        this.nextAfter = null;
        this.nextOptimize = false;
        this.active.set(key, sess);
        this.store.patchLib(key, { last_played: sess.started });
        void this.watch(sess);
        this.fire(sess);
        return { ok: true, tracked: true, pid };
    }

    private rootAlive(sess: Session) {
        if (sess.child)
            return !sess.exited;
        return procs.alive(sess.rootPid);
    }

    private async watch(sess: Session) {
        const key = sess.key;
        while (this.rootAlive(sess)) {
            await sleep(2000);
            this.tick(key);
        }
        if (sess.rc === undefined)
            sess.rc = 0;
        const elapsed = now() - sess.started;
        if (elapsed < 20 && !sess.killed && !sess.external) {
            const child = await this.findChild(sess);
            if (child) {
                sess.pid = child;
                if (sess.optimize && this.onBoost) {
                    try {
                        this.onBoost(child);
                    }
                    catch { /* ignore */ }
                }
                while (procs.alive(child)) {
                    await sleep(2000);
                    this.tick(key);
                }
            }
        }
        this.finish(sess);
    }

    private async findChild(sess: Session): Promise<number | null> {
        const info = this.store.lib(sess.key) || {};
        const exe = String(info.exe || '');
        if (!exe || exe.includes('://'))
            return null;
        const exeDir = procs.normExe(path.dirname(exe));
        if (!exeDir)
            return null;
        for (let i = 0; i < 5; i++) {
            let best: number | null = null;
            for (const p of await procs.list()) {
                if (!p.exe)
                    continue;
                if (procs.normExe(p.exe).startsWith(exeDir) && p.created >= sess.started - 1 && p.pid !== sess.rootPid)
                    best = p.pid;
            }
            if (best)
                return best;
            await sleep(2000);
        }
        return null;
    }

    private tick(key: string) {
        const s = this.active.get(key);
        if (!s)
            return;
        const t = now();
        const last = s.last_save ?? s.started;
        if (t - last >= 120) {
            s.last_save = t;
            const info = this.store.lib(key) || {};
            this.store.patchLib(key, { playtime: Number(info.playtime || 0) + (t - last) });
        }
    }

    private finish(sess: Session) {
        const key = sess.key;
        const t = now();
        const delta = t - (sess.last_save ?? sess.started);
        const info = this.store.lib(key) || {};
        const total = Number(info.playtime || 0) + Math.max(0, delta);
        this.store.patchLib(key, { playtime: total, last_played: sess.started, last_session: Math.max(0, t - sess.started), play_count: Number(info.play_count || 0) + 1 });
        this.active.delete(key);
        sess.crashed = Boolean(!sess.external && t - sess.started < 15 && !sess.killed && sess.pid === sess.rootPid
            && ((sess.rc !== 0 && sess.rc !== null && sess.rc !== undefined) || t - sess.started < 4));
        if (this.onEnd) {
            try {
                this.onEnd(sess, t - sess.started);
            }
            catch (e) {
                log.error('on_end: %s', e);
            }
        }
    }

    terminate(key: string) {
        const s = this.active.get(key);
        if (!s)
            return { error: 'Jogo não está aberto' };
        s.killed = true;
        try {
            void procs.killTree([s.pid, s.rootPid]).catch((e) => log.warn('encerrar %s: %s', key, e));
        }
        catch (e: any) {
            return { error: String(e?.message || e) };
        }
        return { ok: true, title: s.title };
    }

    status() {
        const out: any = {};
        for (const [k, s] of this.active)
            out[k] = { title: s.title, since: s.started, elapsed: now() - s.started, external: Boolean(s.external) };
        return out;
    }

    keys() {
        return [...this.active.keys()];
    }

    has(key: string) {
        return this.active.has(key);
    }
}

function spawnGame(cmd: string[], cwd: string, env?: any): cp.ChildProcess {
    const [exe, ...args] = cmd;
    const opts: cp.SpawnOptions = { cwd, stdio: 'ignore', detached: true, windowsHide: false, env: env || process.env };
    let child: cp.ChildProcess;
    if (WIN && /\.(bat|cmd)$/i.test(exe)) {
        const q = (a: string) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
        child = cp.spawn('cmd.exe', ['/d', '/s', '/c', `"${[exe, ...args].map(q).join(' ')}"`], { ...opts, windowsVerbatimArguments: true });
    }
    else if (WIN && /\.(lnk|url)$/i.test(exe)) {
        throw new Error('atalho');
    }
    else {
        child = cp.spawn(exe, args, opts);
    }
    child.on('error', () => undefined);
    child.unref();
    return child;
}

export function which(name: string): string {
    const exts = WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
        for (const ext of exts) {
            const p = path.join(dir, name + ext);
            try {
                if (fs.statSync(p).isFile())
                    return p;
            }
            catch { /* próximo */ }
        }
    }
    return '';
}

export function humanTime(sec: number): string {
    sec = Math.trunc(sec || 0);
    if (sec < 60)
        return 'menos de 1 min';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h === 0)
        return `${m} min`;
    return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`;
}
