/** util.ts — helpers compartilhados (slug, json seguro, formatacao, processos). */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as cp from 'node:child_process';
/** Slug usado nas chaves `local:<slug>` — identico ao regex do Python. */
function slug(input) {
    return String(input || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
function sha1(input) {
    return crypto.createHash('sha1').update(String(input)).digest('hex');
}
function now() {
    return Math.floor(Date.now() / 1000);
}
function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}
/** Le um JSON tolerando BOM/encoding; devolve `fallback` se nao der. */
function readJson(file, fallback) {
    try {
        const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
        const parsed = JSON.parse(raw);
        return (parsed ?? fallback);
    }
    catch {
        return fallback;
    }
}
function writeJson(file, data) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data, null, 1), 'utf8');
    }
    catch (e) {
        // disco cheio / permissao: nunca derruba a interface por causa disso
        void e;
    }
}
function humanSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024)
        return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}
function humanTime(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0)
        return `${h}h ${m}min`;
    if (m > 0)
        return `${m}min`;
    return `${s}s`;
}
/** Abre um caminho/URL com o aplicativo padrao do sistema. */
function openExternal(target) {
    return new Promise<any>((resolve) => {
        try {
            if (process.platform === 'win32') {
                // `start` precisa de um titulo vazio quando o alvo vai entre aspas
                const child = (0, cp.spawn)('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' });
                child.unref();
            }
            else if (process.platform === 'darwin') {
                const child = (0, cp.spawn)('open', [target], { detached: true, stdio: 'ignore' });
                child.unref();
            }
            else {
                const child = (0, cp.spawn)('xdg-open', [target], { detached: true, stdio: 'ignore' });
                child.unref();
            }
        }
        catch {
            /* ignore */
        }
        resolve(undefined);
    });
}
function exists(p) {
    if (!p)
        return false;
    try {
        return fs.existsSync(p);
    }
    catch {
        return false;
    }
}
function isDir(p) {
    if (!p)
        return false;
    try {
        return fs.statSync(p).isDirectory();
    }
    catch {
        return false;
    }
}
function safeJoin(root, rel) {
    const full = path.resolve(root, rel);
    const base = path.resolve(root);
    if (full !== base && !full.startsWith(base + path.sep))
        return null;
    return full;
}

export { slug, sha1, now, clamp, readJson, writeJson, humanSize, humanTime, openExternal, exists, isDir, safeJoin };

export function safeFolderName(title: string) {
    const name = String(title || '').replace(/[<>:"/\\|?*]+/g, '').replace(/^[ .]+|[ .]+$/g, '');
    return name || 'game';
}
