import fs from 'node:fs';
import path from 'node:path';
import * as P from './paths';
import * as log from './log';
import * as util from './util';

export class CancelledError extends Error {
    constructor(msg = 'Cancelado') {
        super(msg);
        this.name = 'CancelledError';
    }
}

export type Progress = { stage: string; fraction: number; detail: string; speed?: number; eta?: number };
export type Cancel = { aborted: boolean; pause: boolean; check: () => void };
export type JobFn = (cb: (p: Progress) => void, cancel: Cancel) => Promise<any> | any;
export type Job = { last: Progress; kind: string; title: string; started: number; retry: any; cancel: Cancel; pause: boolean };

export function prog(stage: string, fraction: number, detail = '', speed?: number, eta?: number): Progress {
    const p: Progress = { stage, fraction, detail };
    if (speed)
        p.speed = speed;
    if (eta)
        p.eta = eta;
    return p;
}

export class Jobs {
    jobs = new Map<string, Job>();
    private hist: any[] | null = null;
    private HIST = path.join(P.DATA, 'downloads.json');
    constructor(private be: any) { }

    run(key: string, title: string, kind: string, fn: JobFn, retry: any = null) {
        if (this.jobs.has(key))
            return { error: 'Já em andamento' };
        const cancel: Cancel = {
            aborted: false, pause: false, check() {
                if (this.aborted)
                    throw new CancelledError();
            },
        };
        const job: Job = { cancel, last: prog('download', 0, 'Iniciando...'), kind, title, started: util.now(), retry, pause: false };
        this.jobs.set(key, job);
        this.histPut(key, title, kind, 'running', { retry });
        const cb = (p: Progress) => {
            job.last = p;
        };
        (async () => {
            try {
                const result = await fn(cb, cancel);
                this.histPut(key, title, kind, 'done', { dir: (result || {}).dir });
                this.be.push({ type: 'done', key, title, kind, ...(result || {}) });
                if (kind === 'install' || kind === 'emulator')
                    this.be.windowHooks?.notify_hidden?.(`${title}: pronto`);
            }
            catch (ex: any) {
                if (ex instanceof CancelledError || ex?.name === 'CancelledError' || (cancel.aborted && /cancel/i.test(String(ex?.message || ex)))) {
                    this.histPut(key, title, kind, job.pause ? 'paused' : 'cancelled');
                    this.be.push({ type: 'cancelled', key, title, kind, paused: job.pause });
                }
                else {
                    log.error('job %s: %s', key, ex?.stack || ex);
                    this.histPut(key, title, kind, 'error', { message: String(ex?.message || ex) });
                    this.be.push({ type: 'error', key, title, kind, message: String(ex?.message || ex) });
                }
            }
            finally {
                this.jobs.delete(key);
            }
        })();
        return { ok: true };
    }

    cancel(key: string, pause = false) {
        const j = this.jobs.get(key);
        if (j) {
            j.pause = pause;
            j.cancel.pause = pause;
            j.cancel.aborted = true;
        }
        return { ok: true };
    }

    has(key: string) {
        return this.jobs.has(key);
    }

    set(key: string, p: Progress) {
        const j = this.jobs.get(key);
        if (j)
            j.last = p;
    }

    payload(key: string) {
        const j = this.jobs.get(key);
        if (!j)
            return null;
        const p = j.last;
        const out: any = { stage: p.stage, fraction: p.fraction, detail: p.detail, kind: j.kind || 'install', title: j.title || '' };
        if (p.speed)
            out.speed = p.speed;
        if (p.eta)
            out.eta = p.eta;
        return out;
    }

    all() {
        const out: Record<string, any> = {};
        for (const k of this.jobs.keys())
            out[k] = this.payload(k);
        return out;
    }

    private histLoad(): any[] {
        if (!this.hist) {
            try {
                this.hist = fs.existsSync(this.HIST) ? JSON.parse(fs.readFileSync(this.HIST, 'utf8')) : [];
                if (!Array.isArray(this.hist))
                    this.hist = [];
            }
            catch {
                this.hist = [];
            }
            for (const h of this.hist)
                if (h.status === 'running')
                    h.status = 'paused';
        }
        return this.hist;
    }

    private histSave() {
        try {
            fs.mkdirSync(path.dirname(this.HIST), { recursive: true });
            fs.writeFileSync(this.HIST, JSON.stringify(this.histLoad().slice(-200)), 'utf8');
        }
        catch { /* ignore */ }
    }

    histPut(key: string, title: string, kind: string, status: string, extra: Record<string, any> = {}) {
        const hist = this.histLoad();
        let h = hist.find((x) => x.key === key);
        if (!h) {
            h = { key, title, kind, created: util.now() };
            hist.push(h);
        }
        h.status = status;
        h.at = util.now();
        for (const [k, v] of Object.entries(extra))
            if (v !== null && v !== undefined)
                h[k] = v;
        if (status === 'running')
            delete h.message;
        this.histSave();
    }

    histFind(key: string) {
        return this.histLoad().find((x) => x.key === key) || null;
    }

    queuePayload() {
        const hist = this.histLoad().map((h) => ({ ...h }));
        for (const h of hist) {
            const j = this.payload(h.key);
            if (j) {
                h.job = j;
                h.status = 'running';
            }
            const g = this.be.store.lib(h.key) || {};
            h.dir = h.dir || g.dir || '';
            h.installed = Boolean(g.exe || g.dir);
            h.can_retry = ['error', 'cancelled', 'paused'].includes(h.status) && Boolean(h.retry);
        }
        hist.sort((a, b) => (Number(a.status !== 'running') - Number(b.status !== 'running')) || ((b.at || 0) - (a.at || 0)));
        return { items: hist, active: this.jobs.size };
    }

    async queueAction(action: string, key?: string) {
        if (action === 'pause')
            return this.cancel(String(key), true);
        if (action === 'stop') {
            this.cancel(String(key));
            const h = this.histFind(String(key));
            if (h) {
                const tmp = path.join(this.be.downloadsDir?.() || P.DOWNLOADS, util.safeFolderName(String(h.title || '')));
                setTimeout(() => {
                    try {
                        if (fs.existsSync(tmp))
                            fs.rmSync(tmp, { recursive: true, force: true });
                    }
                    catch { /* ignore */ }
                }, 2000);
            }
            return { ok: true };
        }
        if (action === 'retry') {
            const h = this.histFind(String(key));
            const r = h?.retry;
            if (!r)
                return { error: 'Esse item não sabe se refazer — baixe de novo pela Store' };
            const m = this.be.retryTarget?.(r.m);
            if (!m)
                return { error: 'Ação de repetição desconhecida' };
            return await m(...(r.a || []));
        }
        const hist = this.histLoad();
        if (action === 'remove')
            hist.splice(0, hist.length, ...hist.filter((x) => x.key !== key));
        else if (action === 'clear')
            hist.splice(0, hist.length, ...hist.filter((x) => this.jobs.has(x.key)));
        else if (action === 'clear_done')
            hist.splice(0, hist.length, ...hist.filter((x) => this.jobs.has(x.key) || ['paused', 'error', 'running'].includes(x.status)));
        else if (action === 'clear_all') {
            for (const k of [...this.jobs.keys()])
                this.cancel(k);
            hist.splice(0, hist.length);
        }
        this.histSave();
        return { ok: true };
    }
}
