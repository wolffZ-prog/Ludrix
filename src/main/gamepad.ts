import fs from 'node:fs';
import path from 'node:path';
import * as cp from 'node:child_process';
import * as P from './paths';
import * as log from './log';

const EXE = path.join(P.ASSETS, 'bin', 'ludrix-gamepad.exe');
let cached = { available: false, connected: 0 };
let cachedAt = 0;
let probing = false;

export function connectedNow() {
    if (watcher?.running)
        return watcher.status();
    if (process.platform !== 'win32' || !fs.existsSync(EXE))
        return { available: false, connected: 0 };
    if (!probing && Date.now() - cachedAt > 10_000) {
        probing = true;
        cp.execFile(EXE, ['--once'], { windowsHide: true, timeout: 4000 }, (err, out) => {
            probing = false;
            cachedAt = Date.now();
            if (err) {
                cached = { available: false, connected: 0 };
                return;
            }
            const m = /state (\d+)/.exec(String(out || ''));
            cached = m ? { available: true, connected: Number(m[1]) } : { available: false, connected: 0 };
        });
    }
    return cached;
}

export class GamepadWatcher {
    available = false;
    connected = 0;
    running = false;
    private child: cp.ChildProcess | null = null;
    constructor(private store: any, private onWake: (why: string) => void) { }

    start() {
        if (this.child || process.platform !== 'win32')
            return;
        if (!fs.existsSync(EXE)) {
            log.info('monitor de controle indisponível (sem ludrix-gamepad.exe)');
            return;
        }
        try {
            this.child = cp.spawn(EXE, [], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        }
        catch (e: any) {
            log.warn('gamepad: %s', e?.message || e);
            this.child = null;
            return;
        }
        this.running = true;
        let buf = '';
        this.child.stdout?.on('data', (d) => {
            buf += String(d);
            let i: number;
            while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i).trim();
                buf = buf.slice(i + 1);
                this.line(line);
            }
        });
        this.child.on('exit', () => {
            this.child = null;
            this.running = false;
            this.connected = 0;
        });
    }

    private line(line: string) {
        if (line === 'unavailable') {
            this.available = false;
            return;
        }
        this.available = true;
        const [ev, n] = line.split(' ');
        if (ev === 'state')
            this.connected = Number(n) || 0;
        else if ((ev === 'connected' || ev === 'guide') && this.store.config.gamepad_wake) {
            if (ev === 'connected')
                log.info('controle %s conectado', n);
            try {
                this.onWake(ev);
            }
            catch (e: any) {
                log.warn('wake: %s', e?.message || e);
            }
        }
    }

    stop() {
        if (this.child) {
            try {
                this.child.kill();
            }
            catch { }
        }
        this.child = null;
        this.running = false;
        this.connected = 0;
    }

    status() {
        return { available: this.available, connected: this.connected };
    }
}
let watcher: GamepadWatcher | null = null;
export function setWatcher(w: GamepadWatcher | null) {
    watcher = w;
}
