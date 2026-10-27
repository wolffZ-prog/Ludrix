import * as cp from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import * as electron from 'electron';
import * as P from './paths';
import * as log from './log';

export const SCHEME = 'ludrix';
const TTL = 6 * 3600e3;
const nonces = new Map<string, { key: string; act: string; at: number }>();
const WIN = process.platform === 'win32';

type Host = { be: any; show: () => void; openGame: (key: string) => void; play: (key: string) => void };
let host: Host | null = null;
export function attach(h: Host) { host = h; }

function nonce(key: string, act: string) {
    const n = crypto.randomBytes(9).toString('base64url');
    const now = Date.now();
    for (const [k, v] of nonces) if (now - v.at > TTL) nonces.delete(k);
    nonces.set(n, { key, act, at: now });
    return n;
}

export function parseUrl(raw: string): { act: string; key: string; n: string } | null {
    const m = /^ludrix:\/\/(play|open)\/([^?]+)(?:\?n=([A-Za-z0-9_-]+))?/.exec(String(raw || '').trim());
    if (!m) return null;
    let key = '';
    try { key = decodeURIComponent(m[2]); } catch { key = m[2]; }
    return { act: m[1], key, n: m[3] || '' };
}

export function isUrlArg(a: string) { return /^ludrix:\/\//i.test(String(a || '')); }

export function handleUrl(raw: string) {
    const u = parseUrl(raw);
    if (!u || !host) return false;
    const t = nonces.get(u.n);
    const valid = Boolean(t && t.key === u.key && Date.now() - t.at <= TTL);
    if (t) nonces.delete(u.n);
    const exists = Boolean(host.be?.store?.lib?.(u.key));
    log.info('url %s → %s %s (%s)', u.act, u.key, valid ? 'ok' : 'sem nonce', exists ? 'na biblioteca' : 'desconhecido');
    if (!exists) { host.show(); return true; }
    if (u.act === 'play' && valid) host.play(u.key);
    else { host.show(); host.openGame(u.key); }
    return true;
}

const xml = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export type Toast = { title: string; body?: string; key?: string; play?: boolean; image?: string; silent?: boolean };

export function show(t: Toast) {
    try {
        if (!electron.Notification.isSupported()) { log.debug('toast: sem suporte neste sistema'); return false; }
        const key = t.key || '';
        const canProto = WIN && protocolReady();
        if (WIN && canProto) {
            const openN = key ? nonce(key, 'open') : '';
            const playN = key && t.play ? nonce(key, 'play') : '';
            const launch = key ? `${SCHEME}://open/${encodeURIComponent(key)}?n=${openN}` : '';
            const img = t.image ? `<image placement="appLogoOverride" src="${xml(t.image)}"/>` : '';
            const acts = playN ? `<actions><action content="Jogar" arguments="${xml(`${SCHEME}://play/${encodeURIComponent(key)}?n=${playN}`)}" activationType="protocol"/></actions>` : '';
            const toastXml = `<toast${launch ? ` launch="${xml(launch)}" activationType="protocol"` : ''}><visual><binding template="ToastGeneric"><text>${xml(t.title)}</text>${t.body ? `<text>${xml(t.body)}</text>` : ''}${img}</binding></visual>${acts}${t.silent === false ? '' : '<audio silent="true"/>'}</toast>`;
            const n = new electron.Notification({ toastXml } as any);
            n.show();
            log.info('aviso do sistema (toast): %s', t.title);
            return true;
        }
        const n = new electron.Notification({ title: t.title, body: t.body || '', silent: t.silent !== false, icon: t.image || undefined });
        n.on('click', () => { if (!host) return; host.show(); if (key) host.openGame(key); });
        n.show();
        log.info('aviso do sistema: %s', t.title);
        return true;
    }
    catch (e: any) {
        log.warn('toast: %s', e?.message || e);
        return false;
    }
}

function exe() { return WIN && P.FROZEN ? path.join(P.ROOT, 'Ludrix.exe') : ''; }
function cmd() { const e = exe(); return e ? `"${e}" "%1"` : ''; }

let readyCache: { at: number; ok: boolean } | null = null;
export function protocolReady(): boolean {
    if (!cmd()) return false;
    if (readyCache && Date.now() - readyCache.at < 300e3) return readyCache.ok;
    let ok = false;
    try {
        const out = cp.execFileSync('reg', ['query', `HKCU\\Software\\Classes\\${SCHEME}\\shell\\open\\command`, '/ve'], { windowsHide: true, timeout: 8000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const m = /REG_\w+\s+(.*)$/m.exec(out);
        ok = Boolean(m && m[1].trim() === cmd());
    }
    catch { ok = false; }
    readyCache = { at: Date.now(), ok };
    return ok;
}

export function setProtocol(on: boolean): { ok?: boolean; error?: string } {
    const c = cmd();
    if (!c) return { error: 'Só na versão instalada do Windows' };
    const reg = (args: string[]) => cp.execFileSync('reg', args, { windowsHide: true, timeout: 8000, stdio: 'ignore' });
    const base = `HKCU\\Software\\Classes\\${SCHEME}`;
    try {
        if (on) {
            reg(['add', base, '/ve', '/t', 'REG_SZ', '/d', 'URL:LudrixHub', '/f']);
            reg(['add', base, '/v', 'URL Protocol', '/t', 'REG_SZ', '/d', '', '/f']);
            reg(['add', `${base}\\DefaultIcon`, '/ve', '/t', 'REG_SZ', '/d', `"${exe()}",0`, '/f']);
            reg(['add', `${base}\\shell\\open\\command`, '/ve', '/t', 'REG_SZ', '/d', c, '/f']);
        }
        else {
            try { reg(['delete', base, '/f']); } catch { /* já não existia */ }
        }
        readyCache = null;
        return { ok: true };
    }
    catch (e: any) {
        return { error: `Não consegui mexer no registro: ${e?.message || e}` };
    }
}

export function protocolSync(enabled: boolean) {
    try {
        if (!cmd()) return;
        if (enabled && !protocolReady()) setProtocol(true);
        else if (!enabled && protocolReady()) setProtocol(false);
    }
    catch (e) {
        log.debug(`protocol sync: ${e}`);
    }
}
