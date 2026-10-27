import fs from 'node:fs';
import path from 'node:path';
import * as cp from 'node:child_process';
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

const AFTER_LABEL: Record<string, string> = { shutdown: 'desligar o PC', sleep: 'suspender o PC', quit: 'fechar o Ludrix' };
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
        const wasInstalled = kind === 'install' && Boolean((this.be.store.lib(key) || {}).installed);
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
                if (kind === 'install' && !(result || {}).external)
                    void this.be.osToast({ title: wasInstalled ? `${title} atualizado` : `${title} pronto`, body: wasInstalled ? 'A nova versão já está instalada.' : 'Download e instalação concluídos.', key, play: true });
                else if (kind === 'emulator')
                    void this.be.osToast({ title: `${title} pronto`, body: 'Emulador instalado.' });
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
                if (kind !== 'update')
                    this.batch.add(key);
                if (![...this.jobs.values()].some((j) => j.kind !== 'update'))
                    this.idle();
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
        catch { }
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

    batch: Set<string> = new Set();
    after: { action: string; at: number; timer: any } | null = null;
    idle() {
        const act = String(this.be.store.config.after_queue || 'none');
        const n = this.batch.size;
        this.batch.clear();
        if (!n || act === 'none' || this.after)
            return;
        const hist = this.histLoad();
        if (!hist.some((h) => ['done', 'error'].includes(h.status) && h.kind !== 'update'))
            return;
        const at = util.now() + 60;
        const timer = setTimeout(() => this.afterRun(act), 60_000);
        timer.unref?.();
        this.after = { action: act, at, timer };
        this.be.push({ type: 'after_queue', action: act, at });
        void this.be.osToast({ title: 'Fila terminou', body: `${AFTER_LABEL[act] || act} em 1 minuto.` });
    }
    afterRun(act: string) {
        this.after = null;
        this.be.store.setConfig({ after_queue: 'none' });
        log.info('fila terminou: %s', act);
        const win = process.platform === 'win32';
        try {
            if (act === 'quit')
                this.be.windowHooks?.quit?.();
            else if (act === 'shutdown')
                cp.spawn(win ? 'shutdown' : 'systemctl', win ? ['/s', '/t', '5'] : ['poweroff'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
            else if (act === 'sleep')
                cp.spawn(win ? 'rundll32.exe' : 'systemctl', win ? ['powrprof.dll,SetSuspendState', '0,1,0'] : ['suspend'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        }
        catch (e) {
            log.warn('após a fila: %s', e);
        }
    }
    afterCancel() {
        if (this.after)
            clearTimeout(this.after.timer);
        this.after = null;
        return { ok: true };
    }
    afterState() {
        return this.after ? { action: this.after.action, at: this.after.at } : null;
    }
    async queueAction(action: string, key?: string) {
        if (action === 'pause')
            return this.cancel(String(key), true);
        if (action === 'after_cancel')
            return this.afterCancel();
        if (action === 'after_now') {
            const act = this.after?.action || String(this.be.store.config.after_queue || 'none');
            this.afterCancel();
            if (act !== 'none')
                this.afterRun(act);
            return { ok: true };
        }
        if (action === 'pause_all') {
            let n = 0;
            for (const [k, j] of this.jobs)
                if (j.kind !== 'update') {
                    this.cancel(k, true);
                    n++;
                }
            return { ok: true, n };
        }
        if (action === 'resume_all') {
            let n = 0;
            for (const h of this.histLoad().filter((x) => x.status === 'paused' && x.retry)) {
                const m = this.be.retryTarget?.(h.retry.m);
                if (!m)
                    continue;
                try {
                    await m(...(h.retry.a || []));
                    n++;
                }
                catch (e) {
                    log.warn('retomar %s: %s', h.key, e);
                }
            }
            return { ok: true, n };
        }
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
                    catch { }
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
