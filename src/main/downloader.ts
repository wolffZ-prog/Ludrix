import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as P from './paths';
import * as log from './log';
import * as http from './http';
import * as installer_types from './installer-types';
function safeName(name, fallback = 'download') {
    const clean = String(name || '')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
    const base = clean || fallback;
    return base.length > 180 ? base.slice(0, 180) : base;
}
function uniquePath(dir, name) {
    const base = safeName(name);
    let candidate = path.join(dir, base);
    if (!fs.existsSync(candidate))
        return candidate;
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    for (let i = 2; i < 999; i++) {
        candidate = path.join(dir, `${stem} (${i})${ext}`);
        if (!fs.existsSync(candidate))
            return candidate;
    }
    return path.join(dir, `${stem}-${Date.now()}${ext}`);
}
async function downloadFile(req: any, onProgress: (p: any) => any = () => undefined, cancel: any = { aborted: false }, session: any = http.shared) {
    fs.mkdirSync(req.dir, { recursive: true });
    let finalPath = '';
    const probeHeaders = { 'User-Agent': http.UA, ...(req.headers || {}) };
    if (req.cookies) {
        probeHeaders.Cookie = Object.entries(req.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    }
    let target = req.url;
    let name = req.name || '';
    let total = Number(req.size || 0);
    let finalUrl = req.url;
    if (!name || !total) {
        const probe = await fetchWithGuard(target, {
            method: 'GET',
            headers: probeHeaders,
            redirect: 'follow',
        }, cancel);
        finalUrl = probe.url || target;
        if (!name) {
            const cd = probe.headers.get('content-disposition') || '';
            const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
            const plain = /filename="?([^";]+)"?/i.exec(cd);
            const raw = star ? star[1] : plain ? plain[1] : '';
            name = raw ? decodeURIComponent(raw.trim().replace(/^"|"$/g, '')) : '';
            if (!name) {
                try {
                    name = decodeURIComponent(new URL(finalUrl).pathname.split('/').pop() || '');
                }
                catch {
                    name = '';
                }
            }
            if (!name || !name.includes('.'))
                name = 'download';
        }
        total = Number(probe.headers.get('content-length') || 0);
        probe.body?.cancel?.();
    }
    finalPath = uniquePath(req.dir, name);
    const part = finalPath + '.part';
    let start = 0;
    if (fs.existsSync(part))
        start = fs.statSync(part).size;
    const supportsResume = total > 0 && start > 0 && start < total;
    const headers = { ...probeHeaders };
    if (supportsResume)
        headers.Range = `bytes=${start}-`;
    const res = await fetchWithGuard(finalUrl, { method: 'GET', headers, redirect: 'follow' }, cancel);
    if (res.status >= 400)
        throw new Error(`O servidor respondeu HTTP ${res.status}`);
    const serverTotal = Number(res.headers.get('content-length') || 0);
    const resumed = res.status === 206;
    if (!resumed)
        start = 0;
    const grandTotal = resumed && serverTotal ? start + serverTotal : (serverTotal || total || 0);
    if (!res.body)
        throw new Error('Resposta sem corpo');
    const fd = fs.openSync(part, resumed ? 'a' : 'w');
    if (resumed)
        fs.ftruncateSync(fd, start);
    let done = start;
    let last = Date.now();
    let lastDone = done;
    let speed = 0;
    const limit = Number(req.speedLimit || 0);
    const reader = res.body.getReader();
    try {
        for (;;) {
            if (cancel.aborted)
                throw new installer_types.CancelledError();
            const { value, done: finished } = await reader.read();
            if (finished)
                break;
            let chunk = Buffer.from(value);
            if (req.decrypt) {
                chunk = req.decrypt(chunk, done);
            }
            fs.writeSync(fd, chunk);
            done += chunk.length;
            const now = Date.now();
            if (now - last >= 500) {
                speed = ((done - lastDone) * 1000) / Math.max(1, now - last);
                last = now;
                lastDone = done;
                const eta = speed > 0 && grandTotal ? (grandTotal - done) / speed : 0;
                onProgress({
                    done,
                    total: grandTotal,
                    frac: grandTotal ? done / grandTotal : -1,
                    speed,
                    eta,
                    text: `${installer_types.humanSize(done)} / ${installer_types.humanSize(grandTotal)}  •  ↓ ${installer_types.humanSize(speed)}/s` +
                        (eta ? `  •  ETA ${installer_types.humanEta(eta)}` : ''),
                });
            }
            if (limit > 0 && speed > limit) {
                const excess = speed - limit;
                await new Promise((r) => setTimeout(r, Math.min(250, Math.max(10, (excess * 0.5) / limit * 1000))));
            }
        }
    }
    finally {
        try {
            fs.closeSync(fd);
        }
        catch {
        }
        try {
            reader.releaseLock?.();
        }
        catch {
        }
    }
    if (cancel.aborted)
        throw new installer_types.CancelledError();
    if (grandTotal && fs.statSync(part).size < grandTotal && !resumed) {
        throw new Error('Download interrompido antes do fim (o .part fica salvo para continuar)');
    }
    fs.renameSync(part, finalPath);
    onProgress({ done, total: grandTotal, frac: 1, speed, eta: 0, text: 'Concluido' });
    return finalPath;
}
async function fetchWithGuard(url, init, cancel) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 120_000);
    const onAbort = () => ctl.abort();
    if (cancel.aborted)
        ctl.abort();
    const poll = setInterval(() => {
        if (cancel.aborted)
            ctl.abort();
    }, 500);
    try {
        return await fetch(url, { ...init, signal: ctl.signal });
    }
    catch (e) {
        if (cancel.aborted)
            throw new installer_types.CancelledError();
        throw new Error(`Falha de rede: ${e?.message || e}`);
    }
    finally {
        clearTimeout(timer);
        clearInterval(poll);
        void onAbort;
    }
}
class DownloadQueue {
    concurrency;
    items = new Map();
    tasks = new Map();
    cancels = new Map();
    running = new Set();
    history = [];
    constructor(concurrency = 2) {
        this.concurrency = concurrency;
    }
    setConcurrency(n) {
        this.concurrency = Math.max(1, Math.min(8, Number(n) || 1));
        this.pump();
    }
    list() {
        return [...this.items.values()];
    }
    historyList(limit = 40) {
        return this.history.slice(0, limit);
    }
    get(id) {
        return this.items.get(id);
    }
    add(partial, task) {
        const id = partial.id || crypto.randomBytes(6).toString('hex');
        const item = {
            id,
            title: partial.title || 'trabalho',
            kind: partial.kind || 'download',
            status: 'queued',
            frac: -1,
            text: 'Na fila',
            speed: 0,
            eta: 0,
            key: partial.key,
            started: Date.now(),
        };
        this.items.set(id, item);
        this.tasks.set(id, task);
        this.pump();
        return item;
    }
    cancel(id, pause = false) {
        const item = this.items.get(id);
        if (!item)
            return false;
        const c = this.cancels.get(id);
        if (c)
            c.aborted = true;
        if (pause) {
            item.status = 'paused';
            item.text = 'Pausado (da para continuar)';
        }
        else {
            item.status = 'cancelled';
            item.text = 'Cancelado';
        }
        this.running.delete(id);
        this.finish(id, item.status === 'cancelled' ? 'cancelled' : 'paused');
        this.pump();
        return true;
    }
    finish(id, status) {
        const item = this.items.get(id);
        if (!item)
            return;
        item.finished = Date.now();
        if (status === 'done' || status === 'error' || status === 'cancelled') {
            this.history.unshift({ ...item, status });
            this.history = this.history.slice(0, 60);
            this.items.delete(id);
            this.tasks.delete(id);
            this.cancels.delete(id);
        }
    }
    pump() {
        for (const [id, item] of this.items) {
            if (this.running.size >= this.concurrency)
                break;
            if (item.status !== 'queued')
                continue;
            const task = this.tasks.get(id);
            if (!task)
                continue;
            const cancel = { aborted: false };
            this.cancels.set(id, cancel);
            this.running.add(id);
            item.status = 'running';
            item.text = 'Preparando...';
            void task(item, cancel)
                .then((result) => {
                if (cancel.aborted)
                    return;
                item.status = 'done';
                item.frac = 1;
                item.text = 'Pronto';
                if (result && typeof result === 'object') {
                    if (typeof result.file === 'string')
                        item.file = result.file;
                }
                this.finish(id, 'done');
            })
                .catch((e) => {
                if (cancel.aborted || e instanceof installer_types.CancelledError) {
                    item.status = item.status === 'paused' ? 'paused' : 'cancelled';
                    return;
                }
                log.warn('trabalho %s (%s): %s', id, item.title, e);
                item.status = 'error';
                item.error = String(e?.message || e);
                item.text = item.error;
                this.finish(id, 'error');
            })
                .finally(() => {
                this.running.delete(id);
                this.pump();
            });
        }
    }
}
function downloadsDir() {
    return P.DOWNLOADS;
}
function cleanDownloads(keep = new Set()) {
    let removed = 0;
    let freed = 0;
    if (!fs.existsSync(P.DOWNLOADS))
        return { removed, freed };
    for (const child of fs.readdirSync(P.DOWNLOADS)) {
        if (keep.has(child))
            continue;
        const p = path.join(P.DOWNLOADS, child);
        try {
            const st = fs.statSync(p);
            fs.rmSync(p, { recursive: true, force: true });
            removed++;
            if (st.isFile())
                freed += st.size;
        }
        catch {
        }
    }
    return { removed, freed };
}

export { downloadFile, downloadsDir, cleanDownloads, DownloadQueue };
