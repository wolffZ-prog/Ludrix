import * as http from './http';
import * as log from './log';
import { HEADERS as WEB_HEADERS } from './websearch';

export type Got = { data: Buffer; why: string; via: string };

const MAX = 25 * 1024 * 1024;
const T = 25_000;

function short(e: any): string {
    const m = String(e?.message || e || '').replace(/\s+/g, ' ').trim();
    if (/Tempo esgotado/i.test(m))
        return 'tempo esgotado';
    if (/ENOTFOUND|resolver/i.test(m))
        return 'site não encontrado';
    if (/ECONNREFUSED|ECONNRESET|interrompida/i.test(m))
        return 'conexão recusada';
    if (/certificate|CERT_|SSL|TLS/i.test(m))
        return 'certificado inválido';
    return m.slice(0, 60) || 'erro';
}

function hostOf(u: string): string {
    try {
        return new URL(u).hostname;
    }
    catch {
        return u.slice(0, 40);
    }
}

async function viaSession(s: http.Session, url: string, headers: Record<string, string>): Promise<{ data?: Buffer; why: string }> {
    try {
        const r = await s.get(url, { headers, timeout: T });
        if (!r.ok)
            return { why: `HTTP ${r.status}` };
        const ct = String(r.headers.get('content-type') || '').toLowerCase();
        if (/text\/html/.test(ct))
            return { why: 'o site devolveu uma página, não a imagem' };
        const buf = Buffer.from(await r.arrayBuffer());
        if (!buf.length)
            return { why: 'resposta vazia' };
        return { data: buf.subarray(0, MAX), why: '' };
    }
    catch (e) {
        return { why: short(e) };
    }
}

async function viaChromium(url: string, referer: string): Promise<{ data?: Buffer; why: string }> {
    let net: any;
    try {
        net = require('electron').net;
    }
    catch {
        return { why: 'sem net' };
    }
    if (!net || typeof net.fetch !== 'function')
        return { why: 'sem net' };
    try {
        await http.assertPublicHost(hostOf(url));
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), T);
        try {
            const r = await net.fetch(url, {
                method: 'GET', signal: ctl.signal, credentials: 'omit', redirect: 'follow',
                headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', 'Accept-Language': WEB_HEADERS['Accept-Language'] || 'pt-BR,pt;q=0.9,en;q=0.8', ...(referer ? { Referer: referer } : {}) },
            } as any);
            if (!r.ok)
                return { why: `HTTP ${r.status}` };
            const ct = String(r.headers.get('content-type') || '').toLowerCase();
            if (/text\/html/.test(ct))
                return { why: 'o site devolveu uma página, não a imagem' };
            const buf = Buffer.from(await r.arrayBuffer());
            if (!buf.length)
                return { why: 'resposta vazia' };
            return { data: buf.subarray(0, MAX), why: '' };
        }
        finally {
            clearTimeout(t);
        }
    }
    catch (e) {
        return { why: short(e) };
    }
}

export async function fetchImage(s: http.Session, url: string, opts: { referer?: string; thumb?: string; quick?: boolean } = {}): Promise<Got> {
    const referer = opts.referer || '';
    const base: Record<string, string> = { ...WEB_HEADERS, Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' };
    delete base.Referer;
    let origin = '';
    try {
        origin = new URL(url).origin + '/';
    }
    catch { }
    const tries: Array<[string, Record<string, string>]> = [];
    if (referer)
        tries.push(['referer', { ...base, Referer: referer }]);
    tries.push(['direto', base]);
    if (!opts.quick && origin)
        tries.push(['origem', { ...base, Referer: origin }]);
    const whys: string[] = [];
    let last = '';
    for (const [via, h] of tries) {
        const r = await viaSession(s, url, h);
        if (r.data)
            return { data: r.data, why: '', via };
        last = r.why;
        whys.push(`${via}: ${r.why}`);
        if (/tempo esgotado|site não encontrado/.test(r.why))
            break;
    }
    if (!opts.quick) {
        const r = await viaChromium(url, referer || origin);
        if (r.data)
            return { data: r.data, why: '', via: 'chromium' };
        last = r.why;
        whys.push(`chromium: ${r.why}`);
    }
    if (opts.thumb && /^https?:\/\//i.test(opts.thumb) && opts.thumb !== url) {
        const r = await viaSession(s, opts.thumb, base);
        if (r.data) {
            log.info(`imagem: ${hostOf(url)} recusou (${last}); usando miniatura ${hostOf(opts.thumb)}`);
            return { data: r.data, why: '', via: 'miniatura' };
        }
        whys.push(`miniatura: ${r.why}`);
    }
    log.warn(`imagem não baixou ${url.slice(0, 120)} — ${whys.join(' | ')}`);
    return { data: Buffer.alloc(0), why: last || 'erro', via: '' };
}
