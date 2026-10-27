import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as cp from 'node:child_process';
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
const GUARDED = /^(config|library|repos|sources_state|downloads)\.json$/;
const recoveredList: { file: string; from: string; at: number; detail: string }[] = [];
function recovered() {
    return recoveredList;
}
function parseFile(file) {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object')
        throw new Error('json sem objeto');
    return parsed;
}
function looksJson(file) {
    try {
        const st = fs.statSync(file);
        if (st.size < 2)
            return false;
        const fd = fs.openSync(file, 'r');
        try {
            const head = Buffer.alloc(4), tail = Buffer.alloc(4);
            fs.readSync(fd, head, 0, 4, 0);
            fs.readSync(fd, tail, 0, 4, Math.max(0, st.size - 4));
            const h = head.toString('utf8').replace(/^\uFEFF/, '').trim()[0], t = tail.toString('utf8').trim().slice(-1);
            return (h === '{' && t === '}') || (h === '[' && t === ']');
        }
        finally {
            fs.closeSync(fd);
        }
    }
    catch {
        return false;
    }
}
function restoreFromZip(file) {
    const name = path.basename(file), dir = path.join(path.dirname(file), 'backups');
    const good = (data) => data && typeof data === 'object' && !Array.isArray(data);
    if (name === 'library.json') {
        let daily = [];
        try {
            daily = fs.readdirSync(dir).filter((f) => /^library-\d+\.json$/.test(f)).sort().reverse();
        }
        catch { }
        for (const f of daily) {
            try {
                const data = parseFile(path.join(dir, f));
                if (good(data) && Object.keys(data).length)
                    return { data, from: `backups/${f}` };
            }
            catch { }
        }
    }
    let zips = [];
    for (const d of [path.join(dir, 'auto'), dir]) {
        try {
            zips.push(...fs.readdirSync(d).filter((f) => /^Ludrix-dados-.*\.zip$/i.test(f)).map((f) => path.join(d, f)));
        }
        catch { }
    }
    zips.sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
    for (const z of zips) {
        try {
            const AdmZip = require('adm-zip');
            const e = new AdmZip(z).getEntries().find((x) => !x.isDirectory && path.basename(x.entryName) === name);
            if (!e)
                continue;
            const data = JSON.parse(e.getData().toString('utf8').replace(/^\uFEFF/, ''));
            if (good(data))
                return { data, from: path.basename(z) };
        }
        catch { }
    }
    return null;
}
function recover(file, why) {
    const bad = `${file}.bad`;
    try {
        fs.copyFileSync(file, bad);
    }
    catch { }
    const bak = `${file}.bak`;
    let got = null;
    if (fs.existsSync(bak)) {
        try {
            got = { data: parseFile(bak), from: 'cópia anterior (.bak)' };
        }
        catch { }
    }
    if (!got)
        got = restoreFromZip(file);
    if (got) {
        try {
            fs.writeFileSync(file, JSON.stringify(got.data, null, 1), 'utf8');
        }
        catch { }
    }
    recoveredList.push({ file: path.basename(file), from: got ? got.from : '', at: Math.floor(Date.now() / 1000), detail: why });
    return got ? got.data : undefined;
}
function readJson(file, fallback) {
    let parsed;
    try {
        parsed = parseFile(file);
    }
    catch (e) {
        if (GUARDED.test(path.basename(file)) && fs.existsSync(file)) {
            const r = recover(file, String(e?.message || e));
            return (r ?? fallback);
        }
        return fallback;
    }
    return (parsed ?? fallback);
}
function writeJson(file, data) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (GUARDED.test(path.basename(file)) && looksJson(file)) {
            try {
                fs.copyFileSync(file, `${file}.bak`);
            }
            catch { }
        }
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data, null, 1), 'utf8');
        try {
            fs.renameSync(tmp, file);
        }
        catch {
            fs.copyFileSync(tmp, file);
            fs.rmSync(tmp, { force: true });
        }
    }
    catch (e) {
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
function openExternal(target) {
    return new Promise<any>((resolve) => {
        try {
            if (process.platform === 'win32') {
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

export { slug, sha1, now, clamp, readJson, writeJson, recovered, humanSize, humanTime, openExternal, exists, isDir, safeJoin };

export function safeFolderName(title: string) {
    const name = String(title || '').replace(/[<>:"/\\|?*]+/g, '').replace(/^[ .]+|[ .]+$/g, '');
    return name || 'game';
}
