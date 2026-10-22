import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cp from 'node:child_process';

export const TAG = 'Ludrix';
const WIN = process.platform === 'win32';

function readMap(b: Buffer, i: number): [any, number] {
    const out: any = {};
    while (i < b.length) {
        const t = b[i];
        i += 1;
        if (t === 0x08)
            return [out, i];
        let j = b.indexOf(0, i);
        const name = b.subarray(i, j).toString('utf8');
        i = j + 1;
        if (t === 0x00) {
            [out[name], i] = readMap(b, i);
        }
        else if (t === 0x01) {
            j = b.indexOf(0, i);
            out[name] = b.subarray(i, j).toString('utf8');
            i = j + 1;
        }
        else if (t === 0x02) {
            out[name] = b.readInt32LE(i);
            i += 4;
        }
        else if (t === 0x07) {
            out[name] = Number(b.readBigInt64LE(i));
            i += 8;
        }
        else {
            throw new Error(`tipo VDF desconhecido 0x${t.toString(16)}`);
        }
    }
    return [out, i];
}

export function parseShortcuts(b: Buffer): any[] {
    if (!b || !b.length)
        return [];
    const [root] = readMap(b, 0);
    const sc = root.shortcuts || (Object.values(root)[0] as any) || {};
    const keys = Object.keys(sc).sort((a, b2) => (/^\d+$/.test(a) ? Number(a) : 0) - (/^\d+$/.test(b2) ? Number(b2) : 0));
    return keys.map((k) => sc[k]).filter((v) => v && typeof v === 'object');
}

function wMap(name: string, m: any): Buffer {
    const parts: Buffer[] = [Buffer.from([0]), Buffer.from(name, 'utf8'), Buffer.from([0])];
    for (const [k, v] of Object.entries<any>(m)) {
        const kb = Buffer.concat([Buffer.from(k, 'utf8'), Buffer.from([0])]);
        if (v && typeof v === 'object') {
            parts.push(wMap(k, v));
        }
        else if (typeof v === 'boolean') {
            const n = Buffer.alloc(4);
            n.writeInt32LE(v ? 1 : 0);
            parts.push(Buffer.from([2]), kb, n);
        }
        else if (typeof v === 'number') {
            const n = Buffer.alloc(4);
            n.writeInt32LE(v < 2 ** 31 ? v : v - 2 ** 32);
            parts.push(Buffer.from([2]), kb, n);
        }
        else {
            parts.push(Buffer.from([1]), kb, Buffer.from(String(v), 'utf8'), Buffer.from([0]));
        }
    }
    parts.push(Buffer.from([8]));
    return Buffer.concat(parts);
}

export function dumpShortcuts(items: any[]): Buffer {
    const m: any = {};
    items.forEach((it, i) => { m[String(i)] = it; });
    return Buffer.concat([wMap('shortcuts', m), Buffer.from([8])]);
}

const CRC_T = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
export function crc32(b: Buffer): number {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++)
        c = CRC_T[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
export function shortcutAppid(exeQuoted: string, name: string): number {
    return (crc32(Buffer.from(exeQuoted + name, 'utf8')) | 0x80000000) >>> 0;
}

function q(p: string): string {
    p = String(p || '');
    return p.startsWith('"') ? p : `"${p}"`;
}

export function newEntry(name: string, exe: string, startDir: string, args = '', icon = '', lastPlayed = 0): any {
    const exeQ = q(exe), dirQ = q(startDir);
    return { appid: shortcutAppid(exeQ, name), AppName: name, Exe: exeQ, StartDir: dirQ, icon: icon || '', ShortcutPath: '',
        LaunchOptions: args || '', IsHidden: 0, AllowDesktopConfig: 1, AllowOverlay: 1, OpenVR: 0, Devkit: 0, DevkitGameID: '',
        DevkitOverrideAppID: 0, LastPlayTime: Math.trunc(lastPlayed || 0), FlatpakAppID: '', tags: { '0': TAG } };
}

function exists(p: string): boolean {
    try {
        fs.statSync(p);
        return true;
    }
    catch {
        return false;
    }
}

export function steamRoot(): string | null {
    if (WIN) {
        try {
            const out = cp.execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true, timeout: 8000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            const m = /SteamPath\s+REG_\w+\s+(.+)$/im.exec(out);
            if (m && exists(m[1].trim()))
                return path.normalize(m[1].trim());
        }
        catch { /* nada */ }
        for (const c of [path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam')])
            if (exists(path.join(c, 'userdata')))
                return c;
        return null;
    }
    const h = os.homedir();
    for (const c of [path.join(h, '.steam', 'steam'), path.join(h, '.local', 'share', 'Steam'), path.join(h, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam')])
        if (exists(path.join(c, 'userdata')))
            return c;
    return null;
}

export function steamRunning(): boolean {
    if (WIN) {
        try {
            const out = cp.execFileSync('tasklist', ['/FI', 'IMAGENAME eq steam.exe', '/NH'], { windowsHide: true, timeout: 8000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            return out.toLowerCase().includes('steam.exe');
        }
        catch {
            return false;
        }
    }
    try {
        cp.execFileSync('pgrep', ['-x', 'steam'], { timeout: 5000, stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}

export function users(root: string): any[] {
    const ud = path.join(root, 'userdata');
    const out: any[] = [];
    if (!exists(ud))
        return out;
    for (const n of fs.readdirSync(ud)) {
        const d = path.join(ud, n);
        if (!/^\d+$/.test(n) || n === '0' || !fs.statSync(d).isDirectory())
            continue;
        const cfg = path.join(d, 'config');
        let name = '';
        const lc = path.join(cfg, 'localconfig.vdf');
        if (exists(lc)) {
            try {
                const m = /"PersonaName"\s+"([^"]*)"/.exec(fs.readFileSync(lc, 'utf8'));
                name = m ? m[1] : '';
            }
            catch { /* nada */ }
        }
        const mts = [lc, path.join(cfg, 'shortcuts.vdf'), cfg].filter(exists).map((p) => fs.statSync(p).mtimeMs / 1000);
        out.push({ id: n, name: name || n, dir: d, mtime: mts.length ? Math.max(...mts) : 0, shortcuts: exists(path.join(cfg, 'shortcuts.vdf')) ? 1 : 0 });
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
}

function fitCover(src: string, dest: string, size: [number, number], mode: string): boolean {
    try {
        const { nativeImage } = require('electron');
        let im = nativeImage.createFromPath(src);
        if (im.isEmpty())
            return false;
        const [W, H] = size;
        const sz = im.getSize();
        if (mode === 'portrait') {
            const r = Math.max(W / sz.width, H / sz.height);
            const im2 = im.resize({ width: Math.max(1, Math.round(sz.width * r)), height: Math.max(1, Math.round(sz.height * r)), quality: 'best' });
            const s2 = im2.getSize();
            const x = Math.floor((s2.width - W) / 2), y = Math.floor((s2.height - H) / 2);
            fs.writeFileSync(dest, im2.crop({ x, y, width: W, height: H }).toJPEG(90));
        }
        else {
            const r = H / sz.height;
            const fw = Math.max(1, Math.round(sz.width * r));
            if (fw >= W) {
                const fg = im.resize({ width: fw, height: H, quality: 'best' });
                fs.writeFileSync(dest, fg.crop({ x: Math.floor((fw - W) / 2), y: 0, width: W, height: H }).toJPEG(88));
            }
            else {
                const bg = im.resize({ width: 24, height: 12, quality: 'best' }).resize({ width: W, height: H, quality: 'best' });
                fs.writeFileSync(dest, bg.toJPEG(88));
            }
        }
        return true;
    }
    catch {
        return false;
    }
}

export function exportShortcuts(userDir: string, games: any[]): any {
    const cfg = path.join(userDir, 'config');
    fs.mkdirSync(cfg, { recursive: true });
    const vdf = path.join(cfg, 'shortcuts.vdf');
    let existing: any[] = [];
    if (exists(vdf)) {
        try {
            existing = parseShortcuts(fs.readFileSync(vdf));
        }
        catch (e: any) {
            return { error: `shortcuts.vdf atual não pôde ser lido (${e?.message || e}). Nada foi alterado.` };
        }
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
        fs.copyFileSync(vdf, path.join(cfg, `shortcuts.vdf.ludrix-bak-${stamp}`));
        const baks = fs.readdirSync(cfg).filter((n) => n.startsWith('shortcuts.vdf.ludrix-bak-')).sort();
        for (const old of baks.slice(0, -3)) {
            try {
                fs.unlinkSync(path.join(cfg, old));
            }
            catch { /* nada */ }
        }
    }
    const isOurs = (e: any) => {
        const tags = e.tags || {};
        return tags && typeof tags === 'object' ? Object.values(tags).map(String).includes(TAG) : false;
    };
    const ident = (e: any) => String(e.Exe || '').replace(/^"|"$/g, '').toLowerCase() + '|' + String(e.LaunchOptions || '').trim().toLowerCase();
    const keep = existing.filter((e) => !isOurs(e));
    const foreign = new Set(keep.map(ident));
    const oursOld: Record<string, any> = {};
    for (const e of existing)
        if (isOurs(e))
            oursOld[String(e.AppName || '').toLowerCase()] = e;
    const grid = path.join(cfg, 'grid');
    let added = 0, updated = 0, skipped = 0;
    const out = [...keep];
    for (const g of games) {
        const name = String(g.title || '').trim(), exe = String(g.exe || '');
        if (!name || !exe) {
            skipped++;
            continue;
        }
        const e = newEntry(name, exe, g.dir || path.dirname(exe), g.args || '', g.icon || exe, Math.trunc(Number(g.last_played || 0)));
        if (foreign.has(ident(e))) {
            skipped++;
            continue;
        }
        const old = oursOld[name.toLowerCase()];
        if (old) {
            e.IsHidden = Math.trunc(Number(old.IsHidden || 0));
            e.LastPlayTime = Math.max(Math.trunc(Number(old.LastPlayTime || 0)), e.LastPlayTime);
            const tags = old.tags && typeof old.tags === 'object' ? old.tags : {};
            const extra = Object.values(tags).map(String).filter((v) => v !== TAG);
            const nt: any = {};
            [TAG, ...extra].forEach((v, i) => { nt[String(i)] = v; });
            e.tags = nt;
            updated++;
        }
        else {
            added++;
        }
        out.push(e);
        const cov = g.cover;
        if (cov && exists(cov) && fs.statSync(cov).isFile()) {
            fs.mkdirSync(grid, { recursive: true });
            const aid = e.appid;
            fitCover(cov, path.join(grid, `${aid}p.jpg`), [600, 900], 'portrait');
            fitCover(cov, path.join(grid, `${aid}.jpg`), [920, 430], 'landscape');
            const hero = g.hero;
            if (hero && exists(hero) && fs.statSync(hero).isFile())
                fitCover(hero, path.join(grid, `${aid}_hero.jpg`), [1920, 620], 'landscape');
        }
    }
    fs.writeFileSync(vdf, dumpShortcuts(out));
    return { ok: true, added, updated, skipped, total: out.length, file: vdf };
}
