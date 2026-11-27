import net from 'node:net';
import dns from 'node:dns';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const CONNECT_TIMEOUT = 15_000;
const READ_TIMEOUT = 120_000;
class HttpError extends Error {
    status;
    retryAfter = 0;
    response: any = null;
    constructor(message, status = 0) {
        super(message);
        this.status = status;
        this.name = 'HttpError';
    }
}
function blockedByText(host) {
    const h = host.toLowerCase().trim().replace(/^\[|\]$/g, '');
    if (!h)
        return true;
    if (['localhost', 'localhost.localdomain', '0.0.0.0', '::', '::1'].includes(h))
        return true;
    if (['.localhost', '.local', '.internal', '.lan', '.home', '.corp'].some((s) => h.endsWith(s)))
        return true;
    if (net.isIP(h))
        return isPrivateIp(h);
    return false;
}
function isPrivateIp(ip) {
    if (net.isIPv4(ip)) {
        const p = ip.split('.').map(Number);
        if (p[0] === 10)
            return true;
        if (p[0] === 127)
            return true;
        if (p[0] === 0)
            return true;
        if (p[0] === 169 && p[1] === 254)
            return true;
        if (p[0] === 192 && p[1] === 168)
            return true;
        if (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
            return true;
        if (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
            return true;
        if (p[0] >= 224)
            return true;
        return false;
    }
    if (net.isIPv6(ip)) {
        const v = ip.toLowerCase();
        if (v === '::1' || v === '::')
            return true;
        if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd'))
            return true;
        if (v.startsWith('::ffff:'))
            return isPrivateIp(v.slice(7));
        return false;
    }
    return false;
}
const DNS_CACHE = new Map<string, { at: number; ok: boolean }>();
async function assertPublicHost(host) {
    if (blockedByText(host))
        throw new HttpError(`Host bloqueado por seguranca: ${host}`);
    if (net.isIP(host))
        return;
    const hit = DNS_CACHE.get(host);
    if (hit && Date.now() - hit.at < 300_000) {
        if (!hit.ok)
            throw new HttpError(`Host bloqueado por seguranca: ${host}`);
        return;
    }
    let addrs = [];
    try {
        addrs = await dns.promises.lookup(host, { all: true });
    }
    catch (e) {
        throw new HttpError(`Nao foi possivel resolver ${host}`);
    }
    const bad = addrs.some((a) => isPrivateIp(a.address));
    if (DNS_CACHE.size > 500)
        DNS_CACHE.clear();
    DNS_CACHE.set(host, { at: Date.now(), ok: !bad });
    for (const a of addrs) {
        if (isPrivateIp(a.address))
            throw new HttpError(`Host bloqueado por seguranca: ${host}`);
    }
}
if (process.env.LUDRIX_ALLOW_PRIVATE_HTTP === '1')
    process.env.LUDRIX_ALLOW_PRIVATE_HTTP_FORCED = '1'; // veio da linha de comando/ambiente: a config não desliga
const MAX_BODY = 1024 * 1024 * 1024; // corpo lido inteiro na memória (emuladores/cores chegam a centenas de MB); texto/JSON usam MAX_TEXT
const MAX_TEXT = 32 * 1024 * 1024;
const MAX_HOPS = 10;
const HOST_PAR = Math.max(1, Number(process.env.LUDRIX_HTTP_HOST_PAR || 4));
const GLOBAL_PAR = Math.max(HOST_PAR, Number(process.env.LUDRIX_HTTP_GLOBAL_PAR || 24));
type HostStat = { n: number; errors: number; retried: number; ms: number };
const STATS = { requests: 0, retries: 0, blocked: 0, bytes: 0, since: Date.now(), hosts: new Map<string, HostStat>() };
function bump(host: string): HostStat {
    let h = STATS.hosts.get(host);
    if (!h) {
        if (STATS.hosts.size > 200)
            STATS.hosts.clear();
        h = { n: 0, errors: 0, retried: 0, ms: 0 };
        STATS.hosts.set(host, h);
    }
    return h;
}
/** Resumo para o diagnóstico: pedidos, repetições, bloqueios e os hosts mais usados/com mais erro. */
function stats() {
    const hosts = [...STATS.hosts.entries()].map(([host, h]) => ({ host, requests: h.n, errors: h.errors, retried: h.retried, avg_ms: h.n ? Math.round(h.ms / h.n) : 0 }))
        .sort((a, b) => b.requests - a.requests).slice(0, 25);
    const active = [...LANES.values()].reduce((n, l) => n + l.active, 0);
    const waiting = [...LANES.values()].reduce((n, l) => n + l.queue.length, 0);
    return { requests: STATS.requests, retries: STATS.retries, blocked: STATS.blocked, mb: Math.round(STATS.bytes / 1048576 * 10) / 10, since: STATS.since, active, waiting, host_par: HOST_PAR, global_par: GLOBAL_PAR, hosts };
}
function retryAfterMs(v: string | null): number {
    if (!v)
        return 0;
    const n = Number(v);
    if (Number.isFinite(n))
        return Math.max(0, n * 1000);
    const t = Date.parse(v);
    return Number.isFinite(t) ? Math.max(0, t - Date.now()) : 0;
}
function retryable(e: any, totalMs: number): boolean {
    const m = String(e?.message || '');
    if (/bloqueado por seguranca|Protocolo não permitido|Redirecionamentos demais|grande demais/.test(m))
        return false;
    if (/Tempo esgotado/.test(m))
        return totalMs <= 30_000; // só vale repetir quando o limite é curto; timeouts longos já custaram demais
    const st = Number(e?.status || 0);
    if (st)
        return st === 429 || (st >= 500 && st <= 504);
    return e instanceof HttpError; // falha de rede (ECONNRESET, ENOTFOUND momentâneo, TLS…)
}
const LANES = new Map<string, { active: number; queue: Array<() => void> }>();
let globalActive = 0;
const globalQueue: Array<() => void> = [];
function acquire(host: string): Promise<() => void> {
    let lane = LANES.get(host);
    if (!lane) {
        lane = { active: 0, queue: [] };
        LANES.set(host, lane);
    }
    const l = lane;
    return new Promise((resolve) => {
        const grant = () => {
            l.active += 1;
            globalActive += 1;
            let done = false;
            resolve(() => {
                if (done)
                    return;
                done = true;
                l.active -= 1;
                globalActive -= 1;
                if (!l.active && !l.queue.length && LANES.size > 300)
                    LANES.delete(host);
                pump();
            });
        };
        if (l.active < HOST_PAR && globalActive < GLOBAL_PAR)
            grant();
        else
            (l.active >= HOST_PAR ? l.queue : globalQueue).push(grant);
    });
}
function pump() {
    for (const [, l] of LANES)
        while (l.queue.length && l.active < HOST_PAR && globalActive < GLOBAL_PAR)
            l.queue.shift()!();
    while (globalQueue.length && globalActive < GLOBAL_PAR)
        globalQueue.shift()!();
}
class Session {
    cookies = new Map();
    jarFor(url) {
        let origin;
        try {
            origin = new URL(url).origin;
        }
        catch {
            origin = url;
        }
        let jar = this.cookies.get(origin);
        if (!jar) {
            jar = new Map();
            this.cookies.set(origin, jar);
        }
        return jar;
    }
    cookieHeader(url) {
        const jar = this.jarFor(url);
        return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    setCookies(url, raw) {
        if (!raw)
            return;
        const list = Array.isArray(raw) ? raw : [raw];
        const jar = this.jarFor(url);
        for (const line of list) {
            const pair = String(line).split(';')[0];
            const idx = pair.indexOf('=');
            if (idx <= 0)
                continue;
            const k = pair.slice(0, idx).trim();
            const v = pair.slice(idx + 1).trim();
            if (v === '' || /expires=/i.test(v))
                continue;
            jar.set(k, v);
        }
    }
    getCookie(url, name) {
        return this.jarFor(url).get(name) || '';
    }
    setCookie(url, name, value) {
        this.jarFor(url).set(name, value);
    }
    /**
     * Pedido HTTP com as proteções da casa, válidas para todo o backend:
     *  - SSRF: o host (e cada salto de redirecionamento) precisa ser público — nada de 127.0.0.1, 10.x, 192.168.x, .local… (`allowPrivate` desliga);
     *  - redirecionamentos seguidos à mão (máx. 10), com cookies por salto e verificação de host;
     *  - fila por host (máx. HOST_PAR em paralelo) e global (GLOBAL_PAR), para não tomar 429 da Wikipedia/Steam quando 6 jobs rodam juntos;
     *  - repetição com recuo exponencial (GET/HEAD): falhas de rede, 429 e 5xx, respeitando Retry-After (`retries` ajusta; 0 desliga);
     *  - teto de tamanho ao ler o corpo inteiro (`maxBytes`: 1 GB bruto, 32 MB em getText/getJson, 25 MB em imagens) — streams (instalador, updater) continuam sem limite;
     *  - contadores para o diagnóstico (`stats()`).
     */
    async request(url, opts: any = {}) {
        if (opts.params) {
            const u = new URL(url);
            for (const [k, v] of Object.entries(opts.params))
                if (v !== undefined && v !== null)
                    u.searchParams.set(k, String(v));
            url = u.toString();
        }
        const method = String(opts.method || 'GET').toUpperCase();
        const idempotent = method === 'GET' || method === 'HEAD';
        const retries = Math.max(0, Number(opts.retries ?? (idempotent ? 2 : 0)));
        const totalMs = opts.timeout ?? READ_TIMEOUT;
        let attempt = 0;
        for (;;) {
            try {
                return await this.once(url, method, opts, attempt);
            }
            catch (e: any) {
                const again = attempt < retries && !opts.signal?.aborted && retryable(e, totalMs);
                if (!again)
                    throw e;
                const wait = Math.min(15_000, Math.max(e?.retryAfter || 0, 400 * 2 ** attempt + Math.floor(Math.random() * 250)));
                STATS.retries += 1;
                attempt += 1;
                await new Promise((r) => setTimeout(r, wait));
            }
        }
    }
    private async once(url, method, opts: any, attempt: number) {
        const ctl = new AbortController();
        const onAbort = () => ctl.abort();
        // o sinal do chamador precisa valer durante o corpo inteiro (cancelar um download travado), não só até os cabeçalhos
        const unhook = () => { if (opts.signal) opts.signal.removeEventListener('abort', onAbort); };
        if (opts.signal) {
            if (opts.signal.aborted)
                ctl.abort();
            else
                opts.signal.addEventListener('abort', onAbort, { once: true });
        }
        const idleMs = opts.timeout ?? READ_TIMEOUT;
        const timer = setTimeout(() => ctl.abort(), idleMs);
        let connectTimer: any = null;
        const allowPrivate = Boolean(opts.allowPrivate) || process.env.LUDRIX_ALLOW_PRIVATE_HTTP === '1';
        const manual = opts.redirect === 'manual';
        const maxBytes = Number(opts.maxBytes ?? MAX_BODY);
        let cur = url, curMethod = method, body = opts.body, hops = 0;
        let release: null | (() => void) = null;
        const t0 = Date.now();
        let hostKey = '';
        try {
            for (;;) {
                const parsed = new URL(cur);
                if (!/^https?:$/.test(parsed.protocol))
                    throw new HttpError(`Protocolo não permitido: ${parsed.protocol}`);
                if (!allowPrivate) {
                    try {
                        await assertPublicHost(parsed.hostname);
                    }
                    catch (e) {
                        STATS.blocked += 1;
                        throw e;
                    }
                }
                if (!release) {
                    hostKey = parsed.hostname.toLowerCase();
                    release = await acquire(hostKey);
                    STATS.requests += 1;
                    bump(hostKey).n += 1;
                    if (attempt)
                        bump(hostKey).retried += 1;
                    connectTimer = setTimeout(() => ctl.abort(), CONNECT_TIMEOUT);
                }
                const headers = {
                    'User-Agent': UA,
                    Accept: '*/*',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
                    ...(opts.headers || {}),
                };
                const cookie = this.cookieHeader(cur);
                if (cookie)
                    headers.Cookie = cookie;
                let res: Response;
                try {
                    res = await fetch(cur, { method: curMethod, headers, body, redirect: 'manual', signal: ctl.signal });
                }
                catch (e: any) {
                    bump(hostKey).errors += 1;
                    if (ctl.signal.aborted)
                        throw new HttpError(`Tempo esgotado falando com ${parsed.hostname}`);
                    throw new HttpError(`Sem resposta de ${parsed.hostname} (${e?.message || e})`);
                }
                if (connectTimer) {
                    clearTimeout(connectTimer);
                    connectTimer = null;
                }
                try {
                    this.setCookies(cur, res.headers.getSetCookie?.() ?? res.headers.get('set-cookie'));
                }
                catch {
                }
                const loc = res.headers.get('location');
                if (!manual && res.status >= 300 && res.status < 400 && loc) {
                    try {
                        await res.body?.cancel?.();
                    }
                    catch { }
                    if (++hops > MAX_HOPS)
                        throw new HttpError(`Redirecionamentos demais a partir de ${parsed.hostname}`);
                    cur = new URL(loc, cur).toString();
                    if (res.status === 303 || ((res.status === 301 || res.status === 302) && curMethod === 'POST')) {
                        curMethod = 'GET';
                        body = undefined;
                    }
                    continue;
                }
                if (res.status === 429 || (res.status >= 500 && res.status <= 504)) {
                    bump(hostKey).errors += 1;
                    const err = new HttpError(`HTTP ${res.status} de ${parsed.hostname}`, res.status);
                    err.retryAfter = retryAfterMs(res.headers.get('retry-after'));
                    err.response = res;
                    if (opts.retries !== 0 && (curMethod === 'GET' || curMethod === 'HEAD') && attempt < Number(opts.retries ?? 2)) {
                        try {
                            await res.body?.cancel?.();
                        }
                        catch { }
                        throw err;
                    }
                }
                clearTimeout(timer);
                const declared = Number(res.headers.get('content-length') || 0);
                let idle: any = null;
                const arm = () => {
                    if (idle)
                        clearTimeout(idle);
                    idle = setTimeout(() => ctl.abort(), idleMs);
                };
                const disarm = () => {
                    if (idle)
                        clearTimeout(idle);
                    idle = null;
                };
                let stream: any = res.body;
                if (stream && typeof stream.pipeThrough === 'function') {
                    arm();
                    stream = stream.pipeThrough(new TransformStream({
                        transform(chunk, controller) {
                            arm();
                            STATS.bytes += chunk?.byteLength || 0;
                            controller.enqueue(chunk);
                        },
                        flush() {
                            disarm();
                            unhook();
                        },
                    }));
                }
                else
                    unhook();
                const host = parsed.hostname;
                // a vaga do host cobre conexão + espera pelos cabeçalhos (é aí que os sites limitam); o corpo pode escoar em paralelo
                bump(hostKey).ms += Date.now() - t0;
                if (release) {
                    release();
                    release = null;
                }
                const readAll = async () => {
                    if (declared && declared > maxBytes)
                        throw new HttpError(`Resposta grande demais de ${host} (${Math.round(declared / 1048576)} MB)`);
                    try {
                        const chunks: Uint8Array[] = [];
                        let total = 0;
                        const reader = stream.getReader();
                        for (;;) {
                            const { done, value } = await reader.read();
                            if (done)
                                break;
                            total += value.byteLength;
                            if (total > maxBytes) {
                                try {
                                    await reader.cancel();
                                }
                                catch { }
                                throw new HttpError(`Resposta grande demais de ${host} (> ${Math.round(maxBytes / 1048576)} MB)`);
                            }
                            chunks.push(value);
                        }
                        return Buffer.concat(chunks);
                    }
                    catch (e: any) {
                        if (e instanceof HttpError)
                            throw e;
                        if (ctl.signal.aborted)
                            throw new HttpError(`Tempo esgotado falando com ${host}`);
                        throw new HttpError(`Conexao interrompida com ${host} (${e?.message || e})`);
                    }
                    finally {
                        disarm();
                        unhook();
                    }
                };
                return {
                    status: res.status,
                    url: res.url || cur,
                    headers: res.headers,
                    ok: res.ok,
                    body: stream,
                    async text() {
                        return stream ? (await readAll()).toString('utf8') : '';
                    },
                    async json() {
                        return JSON.parse(stream ? (await readAll()).toString('utf8') : 'null');
                    },
                    async arrayBuffer() {
                        const b = stream ? await readAll() : Buffer.alloc(0);
                        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
                    },
                };
            }
        }
        catch (e) {
            unhook();
            if (release) {
                release();
                release = null;
            }
            if (e instanceof HttpError)
                throw e;
            if (ctl.signal.aborted)
                throw new HttpError(`Tempo esgotado falando com ${hostOf(cur) || cur}`);
            throw new HttpError(`Sem resposta de ${hostOf(cur) || cur} (${(e as any)?.message || e})`);
        }
        finally {
            clearTimeout(timer);
            if (connectTimer)
                clearTimeout(connectTimer);
        }
    }
    get(url, opts: any = {}) {
        return this.request(url, { ...opts, method: 'GET' });
    }
    head(url, opts: any = {}) {
        return this.request(url, { ...opts, method: 'HEAD' });
    }
    async getText(url, opts: any = {}) {
        const r = await this.get(url, { maxBytes: MAX_TEXT, ...opts });
        return r.text();
    }
    async getJson(url, opts: any = {}) {
        const r = await this.get(url, { maxBytes: MAX_TEXT, ...opts });
        return r.json();
    }
    post(url, body, opts: any = {}) {
        const headers = { ...(opts.headers || {}) };
        if (typeof body === 'string' && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        return this.request(url, { ...opts, method: 'POST', body, headers });
    }
}
const shared = new Session()
function hostOf(url) {
    const m = /^https?:\/\/([^/:?#]+)/i.exec(url || '');
    return (m?.[1] || '').toLowerCase().replace(/^www\./, '');
}
function numSize(text) {
    const m = /([\d.,]+)\s*([KMGT]?)i?B/i.exec(text || '');
    if (!m)
        return 0;
    const n = Number.parseFloat(m[1].replace(',', '.'));
    if (!Number.isFinite(n))
        return 0;
    const mult = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
    return Math.round(n * (mult[m[2].toUpperCase()] ?? 1));
}
function fileNameFromHeaders(disposition, url, fallback) {
    const cd = disposition || '';
    const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
    if (star)
        return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    const plain = /filename="?([^";]+)"?/i.exec(cd);
    if (plain)
        return decodeURIComponent(plain[1].trim());
    let p = '';
    try {
        p = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    }
    catch {
        p = '';
    }
    return p && p.includes('.') ? p : fallback;
}
function decodeHtmlEntities(s) {
    return String(s || '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)));
}

export { assertPublicHost, hostOf, numSize, fileNameFromHeaders, decodeHtmlEntities, UA, HttpError, Session, shared, stats };
