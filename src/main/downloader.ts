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
const STALL_MS = 90_000;      // sem nenhum byte por 90 s = conexão travada → corta e retoma
const MAX_ATTEMPTS = 6;        // retomadas automáticas (Range) antes de desistir
function cancelSignal(cancel: any): { signal: AbortSignal; stop: () => void } {
    const ctl = new AbortController();
    if (cancel?.aborted)
        ctl.abort();
    const poll = setInterval(() => {
        if (cancel?.aborted)
            ctl.abort();
    }, 300);
    return { signal: ctl.signal, stop: () => clearInterval(poll) };
}
/**
 * Baixa `req.url` para `req.dir`, gravando em `.part` e renomeando no fim.
 * Passa pela camada http da casa (anti-SSRF, redirecionamentos verificados, fila por host) e:
 *  - detecta conexão travada (90 s sem dados) em vez de esperar para sempre — e o Cancelar responde mesmo durante o travamento;
 *  - retoma sozinho com `Range` até 6 vezes quando a rede cai no meio (o usuário só vê a barra continuar);
 *  - respeita `req.speedLimit` (bytes/s) e `req.decrypt(chunk, offset)` quando existirem.
 */
async function downloadFile(req: any, onProgress: (p: any) => any = () => undefined, cancel: any = { aborted: false }, session: any = http.shared) {
    fs.mkdirSync(req.dir, { recursive: true });
    const baseHeaders: any = { ...(req.headers || {}) };
    if (req.cookies)
        baseHeaders.Cookie = Object.entries(req.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    const { signal, stop } = cancelSignal(cancel);
    const cancelled = () => Boolean(cancel?.aborted);
    try {
        let name = req.name || '';
        let total = Number(req.size || 0);
        let finalUrl = req.url;
        if (!name || !total) {
            const probe = await session.request(req.url, { method: 'GET', headers: baseHeaders, timeout: 30_000, signal, retries: 2 });
            finalUrl = probe.url || req.url;
            if (!name) {
                name = http.fileNameFromHeaders(probe.headers.get('content-disposition') || '', finalUrl, '');
                if (!name || !name.includes('.'))
                    name = 'download';
            }
            total = Number(probe.headers.get('content-length') || 0);
            try {
                await probe.body?.cancel?.();
            }
            catch { }
        }
        const finalPath = uniquePath(req.dir, name);
        const part = finalPath + '.part';
        let grandTotal = total;
        let speed = 0, done = 0;
        let lastErr: any = null;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            if (cancelled())
                throw new installer_types.CancelledError();
            let start = 0;
            try {
                start = fs.existsSync(part) ? fs.statSync(part).size : 0;
            }
            catch {
                start = 0;
            }
            if (grandTotal && start >= grandTotal && start > 0)
                break; // já temos tudo (ex.: queda bem no último byte)
            const wantResume = start > 0 && (!grandTotal || start < grandTotal);
            const headers = { ...baseHeaders };
            if (wantResume)
                headers.Range = `bytes=${start}-`;
            let res: any;
            try {
                res = await session.request(finalUrl, { method: 'GET', headers, timeout: STALL_MS, signal, retries: 1 });
            }
            catch (e: any) {
                if (cancelled())
                    throw new installer_types.CancelledError();
                lastErr = e;
                if (attempt + 1 < MAX_ATTEMPTS) {
                    onProgress({ done: start, total: grandTotal, frac: grandTotal ? start / grandTotal : -1, speed: 0, eta: 0, text: `Sem resposta — tentando de novo (${attempt + 2}/${MAX_ATTEMPTS})…` });
                    await new Promise((r) => setTimeout(r, Math.min(20_000, 1500 * 2 ** attempt)));
                    continue;
                }
                throw new Error(`Falha de rede: ${e?.message || e}`);
            }
            if (res.status === 416 && wantResume && grandTotal && start >= grandTotal)
                break; // servidor diz que não há mais nada depois do que já temos
            if (res.status >= 400)
                throw new Error(`O servidor respondeu HTTP ${res.status}`);
            const serverTotal = Number(res.headers.get('content-length') || 0);
            const resumed = wantResume && res.status === 206;
            if (!resumed)
                start = 0;
            grandTotal = resumed && serverTotal ? start + serverTotal : (serverTotal || grandTotal || 0);
            if (!res.body)
                throw new Error('Resposta sem corpo');
            const fd = fs.openSync(part, resumed ? 'a' : 'w');
            if (resumed)
                fs.ftruncateSync(fd, start);
            done = start;
            let last = Date.now();
            let lastDone = done;
            const limit = Number(req.speedLimit || 0);
            const reader = res.body.getReader();
            let broke: any = null;
            try {
                for (;;) {
                    if (cancelled())
                        throw new installer_types.CancelledError();
                    const { value, done: finished } = await reader.read();
                    if (finished)
                        break;
                    let chunk = Buffer.from(value);
                    if (req.decrypt)
                        chunk = req.decrypt(chunk, done);
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
            catch (e: any) {
                broke = e;
            }
            finally {
                try {
                    fs.closeSync(fd);
                }
                catch { }
                try {
                    reader.releaseLock?.();
                }
                catch { }
            }
            if (broke instanceof installer_types.CancelledError || cancelled())
                throw new installer_types.CancelledError();
            const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
            const complete = grandTotal ? have >= grandTotal : !broke;
            if (complete)
                break;
            lastErr = broke || new Error('conexão encerrada antes do fim');
            if (attempt + 1 >= MAX_ATTEMPTS)
                break;
            onProgress({ done: have, total: grandTotal, frac: grandTotal ? have / grandTotal : -1, speed: 0, eta: 0, text: `Conexão caiu em ${installer_types.humanSize(have)} — retomando (${attempt + 2}/${MAX_ATTEMPTS})…` });
            log.warn('download %s: %s em %d bytes — retomando (%d/%d)', name, lastErr?.message || lastErr, have, attempt + 2, MAX_ATTEMPTS);
            await new Promise((r) => setTimeout(r, Math.min(20_000, 1500 * 2 ** attempt)));
        }
        if (cancelled())
            throw new installer_types.CancelledError();
        const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
        if (grandTotal && have < grandTotal)
            throw new Error(`Download interrompido antes do fim${lastErr ? ` (${lastErr?.message || lastErr})` : ''} — o .part fica salvo para continuar`);
        if (!have)
            throw new Error(`Falha de rede: ${lastErr?.message || lastErr || 'resposta vazia'}`);
        fs.renameSync(part, finalPath);
        onProgress({ done: have, total: grandTotal || have, frac: 1, speed, eta: 0, text: 'Concluido' });
        return finalPath;
    }
    finally {
        stop();
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
    list() {
        return [...this.items.values()];
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
