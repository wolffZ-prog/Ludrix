import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import * as log from './log';

type Activity = { details: string; state?: string; timestamps?: { start?: number }; assets?: { large_image?: string; large_text?: string }; instance?: boolean };

const RETRY_MS = 45_000;

function ipcPaths(): string[] {
    const out: string[] = [];
    if (process.platform === 'win32') {
        for (let i = 0; i < 10; i++)
            out.push(`\\\\?\\pipe\\discord-ipc-${i}`);
        return out;
    }
    const bases = [process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, process.env.TMP, process.env.TEMP, '/tmp'].filter(Boolean) as string[];
    const subs = ['', 'app/com.discordapp.Discord', 'app/com.discordapp.DiscordCanary', 'snap.discord', 'snap.discord-canary'];
    for (const b of [...new Set(bases)])
        for (const s of subs)
            for (let i = 0; i < 10; i++)
                out.push(path.join(b, s, `discord-ipc-${i}`));
    return out;
}

function frame(op: number, obj: any): Buffer {
    const body = Buffer.from(JSON.stringify(obj), 'utf8');
    const head = Buffer.alloc(8);
    head.writeInt32LE(op, 0);
    head.writeInt32LE(body.length, 4);
    return Buffer.concat([head, body]);
}

export class DiscordPresence {
    private sock: net.Socket | null = null;
    private ready = false;
    private buf = Buffer.alloc(0);
    private lastFail = 0;
    private connecting: Promise<boolean> | null = null;
    private current: Activity | null = null;
    status: { connected: boolean; error: string } = { connected: false, error: '' };

    constructor(private store: any) { }

    private appId(): string {
        return String(this.store.config.discord_app_id || '').trim();
    }
    enabled(): boolean {
        return Boolean(this.store.config.discord_enabled) && /^\d{15,22}$/.test(this.appId());
    }

    private async connect(): Promise<boolean> {
        if (this.ready && this.sock && !this.sock.destroyed)
            return true;
        if (this.connecting)
            return this.connecting;
        if (Date.now() - this.lastFail < RETRY_MS)
            return false;
        this.connecting = (async () => {
            for (const p of ipcPaths()) {
                const ok = await this.tryPath(p);
                if (ok) {
                    this.status = { connected: true, error: '' };
                    log.info('discord: conectado (%s)', path.basename(p));
                    return true;
                }
            }
            this.lastFail = Date.now();
            this.status = { connected: false, error: 'Discord não encontrado. Abra o Discord e tente de novo.' };
            return false;
        })().finally(() => { this.connecting = null; });
        return this.connecting;
    }

    private tryPath(p: string): Promise<boolean> {
        return new Promise((resolve) => {
            let done = false;
            const fin = (ok: boolean) => {
                if (done)
                    return;
                done = true;
                clearTimeout(t);
                if (!ok) {
                    try {
                        s.destroy();
                    }
                    catch { /* nada */ }
                    if (this.sock === s)
                        this.sock = null;
                }
                resolve(ok);
            };
            const s = net.createConnection(p);
            const t = setTimeout(() => fin(false), 2500);
            s.on('error', () => fin(false));
            s.on('connect', () => {
                this.sock = s;
                this.ready = false;
                this.buf = Buffer.alloc(0);
                s.write(frame(0, { v: 1, client_id: this.appId() }));
            });
            s.on('data', (d) => {
                this.buf = Buffer.concat([this.buf, d]);
                while (this.buf.length >= 8) {
                    const op = this.buf.readInt32LE(0), len = this.buf.readInt32LE(4);
                    if (this.buf.length < 8 + len)
                        break;
                    const body = this.buf.subarray(8, 8 + len).toString('utf8');
                    this.buf = this.buf.subarray(8 + len);
                    let msg: any = {};
                    try {
                        msg = JSON.parse(body);
                    }
                    catch { /* nada */ }
                    if (op === 1 && msg.evt === 'READY') {
                        this.ready = true;
                        fin(true);
                    }
                    else if (op === 1 && msg.evt === 'ERROR') {
                        this.status = { connected: false, error: String(msg.data?.message || 'Discord recusou a conexão.') };
                        log.warn('discord: %s', this.status.error);
                        fin(false);
                    }
                    else if (op === 2) {
                        this.status = { connected: false, error: String(msg.message || 'Discord fechou a conexão (ID do aplicativo inválido?).') };
                        fin(false);
                    }
                }
            });
            s.on('close', () => {
                if (this.sock === s) {
                    this.sock = null;
                    this.ready = false;
                    this.status = { connected: false, error: this.status.error };
                }
                fin(false);
            });
        });
    }

    private send(activity: Activity | null) {
        if (!this.sock || !this.ready)
            return;
        try {
            this.sock.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: activity || undefined }, nonce: crypto.randomUUID() }));
        }
        catch (e: any) {
            log.debug('discord: %s', e?.message || e);
        }
    }

    async set(activity: Activity | null) {
        this.current = activity;
        if (!this.enabled()) {
            this.close();
            return;
        }
        if (!activity) {
            this.send(null);
            this.close();
            return;
        }
        if (await this.connect())
            this.send(this.current);
    }

    async playing(title: string, state: string, started: number, image: string) {
        const a: Activity = { details: String(title || 'Jogando').slice(0, 120), state: String(state || '').slice(0, 120) || undefined, timestamps: { start: Math.trunc(started * 1000) }, instance: false };
        if (/^https:\/\//i.test(image) && image.length <= 256)
            a.assets = { large_image: image, large_text: String(title || '').slice(0, 120) };
        await this.set(a);
    }

    async test(): Promise<{ ok: boolean; error: string }> {
        if (!this.enabled())
            return { ok: false, error: /^\d{15,22}$/.test(this.appId()) ? 'Rich Presence desligado.' : 'Informe o ID do aplicativo (15 a 22 dígitos).' };
        this.lastFail = 0;
        const ok = await this.connect();
        if (ok && !this.current)
            this.close();
        return { ok, error: ok ? '' : this.status.error };
    }

    close() {
        const s = this.sock;
        this.sock = null;
        this.ready = false;
        if (s) {
            try {
                s.end();
                s.destroy();
            }
            catch { /* nada */ }
        }
        this.status = { connected: false, error: this.status.error };
    }

    shutdown() {
        if (this.sock && this.ready)
            this.send(null);
        this.close();
    }
}
