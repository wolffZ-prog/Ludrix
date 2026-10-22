/**
 * http.ts — camada de rede. Substitui `requests.Session` do hosts.py.
 *
 * Traz: user-agent de navegador, cookie jar por origem, timeouts separados de
 * conexao e leitura, redirecoes controladas. O bloqueio de hosts privados fica
 * em hosts.resolve (links colados pelo usuário), como no original.
 */
import net from 'node:net';
import dns from 'node:dns';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const CONNECT_TIMEOUT = 15_000;
const READ_TIMEOUT = 120_000;
class HttpError extends Error {
    status;
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
/** Exige que o host resolva para um endereco publico (defesa contra SSRF). */
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
/** Cookie jar simples: um Map por origem, como o requests.Session. */
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
    async request(url, opts: any = {}) {
        if (opts.params) {
            const u = new URL(url);
            for (const [k, v] of Object.entries(opts.params))
                if (v !== undefined && v !== null)
                    u.searchParams.set(k, String(v));
            url = u.toString();
        }
        const parsed = new URL(url);
        const ctl = new AbortController();
        const onAbort = () => ctl.abort();
        if (opts.signal) {
            if (opts.signal.aborted)
                ctl.abort();
            else
                opts.signal.addEventListener('abort', onAbort, { once: true });
        }
        const timer = setTimeout(() => ctl.abort(), opts.timeout ?? READ_TIMEOUT);
        const connectTimer = setTimeout(() => ctl.abort(), CONNECT_TIMEOUT);
        const headers = {
            'User-Agent': UA,
            Accept: '*/*',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            ...(opts.headers || {}),
        };
        const cookie = this.cookieHeader(url);
        if (cookie)
            headers.Cookie = cookie;
        try {
            const res = await fetch(url, {
                method: opts.method || 'GET',
                headers,
                body: opts.body,
                redirect: opts.redirect ?? 'follow',
                signal: ctl.signal,
            });
            clearTimeout(connectTimer);
            clearTimeout(timer);
            try {
                this.setCookies(url, res.headers.getSetCookie?.() ?? res.headers.get('set-cookie'));
            }
            catch {
                /* ignorado: some runtimes nao expoem set-cookie */
            }
            // Depois dos cabecalhos, o tempo limite vale por "silencio" (como o
            // requests): reinicia a cada pedaco recebido, nunca pelo total.
            const idleMs = opts.timeout ?? READ_TIMEOUT;
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
            let body: any = res.body;
            if (body && typeof body.pipeThrough === 'function') {
                arm();
                body = body.pipeThrough(new TransformStream({
                    transform(chunk, controller) {
                        arm();
                        controller.enqueue(chunk);
                    },
                    flush() {
                        disarm();
                    },
                }));
            }
            const readAll = async () => {
                try {
                    const chunks: Uint8Array[] = [];
                    const reader = body.getReader();
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done)
                            break;
                        chunks.push(value);
                    }
                    return Buffer.concat(chunks);
                }
                catch (e: any) {
                    if (ctl.signal.aborted)
                        throw new HttpError(`Tempo esgotado falando com ${parsed.hostname}`);
                    throw new HttpError(`Conexao interrompida com ${parsed.hostname} (${e?.message || e})`);
                }
                finally {
                    disarm();
                }
            };
            return {
                status: res.status,
                url: res.url || url,
                headers: res.headers,
                ok: res.ok,
                body,
                async text() {
                    return body ? (await readAll()).toString('utf8') : '';
                },
                async json() {
                    return JSON.parse(body ? (await readAll()).toString('utf8') : 'null');
                },
                async arrayBuffer() {
                    const b = body ? await readAll() : Buffer.alloc(0);
                    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
                },
            };
        }
        catch (e) {
            if (ctl.signal.aborted)
                throw new HttpError(`Tempo esgotado falando com ${parsed.hostname}`);
            throw new HttpError(`Sem resposta de ${parsed.hostname} (${e?.message || e})`);
        }
        finally {
            clearTimeout(timer);
            clearTimeout(connectTimer);
            if (opts.signal)
                opts.signal.removeEventListener('abort', onAbort);
        }
    }
    get(url, opts: any = {}) {
        return this.request(url, { ...opts, method: 'GET' });
    }
    head(url, opts: any = {}) {
        return this.request(url, { ...opts, method: 'HEAD' });
    }
    async getText(url, opts: any = {}) {
        const r = await this.get(url, opts);
        return r.text();
    }
    async getJson(url, opts: any = {}) {
        const r = await this.get(url, opts);
        return r.json();
    }
    post(url, body, opts: any = {}) {
        const headers = { ...(opts.headers || {}) };
        if (typeof body === 'string' && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        return this.request(url, { ...opts, method: 'POST', body, headers });
    }
    async postForm(url, data, opts: any = {}) {
        const body = new URLSearchParams(data);
        const r = await this.post(url, body, opts);
        return r.json();
    }
}
/** Sessao compartilhada (equivalente ao `Session()` global do hosts.py). */
const shared = new Session()
function hostOf(url) {
    const m = /^https?:\/\/([^/:?#]+)/i.exec(url || '');
    return (m?.[1] || '').toLowerCase().replace(/^www\./, '');
}
/** Converte "1.4 MiB"/"350 KB" em bytes — usado pelos resolvedores. */
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

export { assertPublicHost, hostOf, numSize, fileNameFromHeaders, decodeHtmlEntities, UA, HttpError, Session, shared };
