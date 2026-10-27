import fs from 'node:fs';
import path from 'node:path';
import { BAD_EXE, peInfo } from './installer';
import { normalizeTitle, titleFromPath } from './titles';
import { guessSystem } from './repos';

export const SKIP_DIRS = /^(\$recycle\.bin|system volume information|windows|program files( \(x86\))?|programdata|appdata|node_modules|\.git|__pycache__|_commonredist|commonredist|redist|redistributables|directx|vcredist|dotnet|_?support|__installer|steamworks shared|steam controller configs|saves?|savegames?|screenshots?|logs?|crashes|temp|tmp|cache)$/i;
export const INNER_DIRS = /^(bin|binaries|win64|win32|x64|x86|game|engine|data|content|retail|shipping|release|app|exe|_retail_|_ptr_)$/i;
const NOT_GAME = /(^|[\W_])(unins\w*|setup|install\w*|vc_?redist\w*|vcredist\w*|dxsetup|dxwebsetup|directx\w*|dotnet\w*|ndp\d+|physx\w*|oalinst|crash\w*|report\w*|bugsplat|errorreport|unitycrashhandler\w*|ue4prereqsetup\w*|uecrashreporter|easyanticheat\w*|eac_\w*|battleye\w*|beservice|updater|updatelauncher|patcher|autoupdate|launcher_helper|trainer|keygen|7z\w*|winrar|unrar|touchup|register\w*|activat\w*|cleanup|benchmark|editor|server|dedicated\w*|\w*_w32ded|hlds|srcds|sdk\w*|uploader|steamerrorreporter|steam\w*service|gameoverlayui|python\w*|java\w*|node|ffmpeg|dxdiag|cmd|powershell|msiexec|regsvr32|rundll32)([\W_]|$)/i;
const MIN_GAME_EXE = 300 * 1024;
const ROM_EXTS_FALLBACK = new Set(['.iso', '.chd', '.cue', '.bin', '.img', '.pbp', '.cso', '.z64', '.n64', '.v64', '.nds', '.3ds', '.cia', '.gba', '.gb', '.gbc',
    '.sfc', '.smc', '.nes', '.fds', '.md', '.gen', '.smd', '.32x', '.gg', '.sms', '.pce', '.ngp', '.ngc', '.ws', '.wsc',
    '.gcm', '.rvz', '.wbfs', '.wad', '.wua', '.xci', '.nsp', '.xex', '.a26', '.a78', '.lnx', '.vb', '.zip', '.7z', '.rar']);
const ARCH_EXTS = new Set(['.zip', '.7z', '.rar']);
const NATIVE_EXT = ['.sh', '.x86_64', '.x86', '.appimage'];

export type Progress = ((msg: string) => void) | null;

export function normcase(p: string): string {
    const n = path.normalize(p || '');
    return process.platform === 'win32' ? n.toLowerCase() : n;
}

function stem(p: string): string {
    return path.parse(p).name;
}

function isDir(p: string): boolean {
    try {
        return fs.statSync(p).isDirectory();
    }
    catch {
        return false;
    }
}

function isGameFile(p: string): boolean {
    const n = path.basename(p).toLowerCase();
    if (n.endsWith('.exe'))
        return true;
    return process.platform !== 'win32' && NATIVE_EXT.some((e) => n.endsWith(e));
}

function sizeOf(p: string): number {
    try {
        return fs.statSync(p).size;
    }
    catch {
        return 0;
    }
}

function isGeneric(name: string): boolean {
    return INNER_DIRS.test(name) || /^(jogos?|games?|new folder|nova pasta|\d+)$/i.test(name);
}

const SIZE_CACHE = new Map<string, number>();
function sizeCached(p: string): number {
    let v = SIZE_CACHE.get(p);
    if (v === undefined) {
        v = sizeOf(p);
        if (SIZE_CACHE.size > 20000)
            SIZE_CACHE.clear();
        SIZE_CACHE.set(p, v);
    }
    return v;
}

function goodExe(p: string): boolean {
    const n = stem(p);
    if (NOT_GAME.test(n))
        return false;
    const sz = sizeCached(p);
    return !(sz && sz < MIN_GAME_EXE && !/launcher|start|play|game/i.test(n));
}

function collectExes(d: string, maxDepth = 4, maxDirs = 40): string[] {
    const out: string[] = [];
    let level: string[] = [d];
    let dirsRead = 0;
    for (let depth = 0; depth < maxDepth && level.length; depth++) {
        const next: string[] = [];
        for (const cur of level) {
            if (dirsRead++ >= maxDirs)
                return out;
            let ents: fs.Dirent[];
            try {
                ents = fs.readdirSync(cur, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const e of ents) {
                if (e.isFile() && isGameFile(e.name))
                    out.push(path.join(cur, e.name));
                else if (e.isDirectory() && !SKIP_DIRS.test(e.name) && !e.name.startsWith('.'))
                    next.push(path.join(cur, e.name));
            }
        }
        if (out.some(goodExe))
            return out;
        next.sort((x, y) => Number(INNER_DIRS.test(path.basename(y))) - Number(INNER_DIRS.test(path.basename(x))));
        level = next.slice(0, 24);
    }
    return out;
}

function rankLight(exes: string[], d: string, title: string): string[] {
    const words = (title.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2);
    const score = (p: string): number => {
        const n = stem(p).toLowerCase();
        let s = 0;
        if (BAD_EXE.test(n))
            s -= 100;
        if (/[\(\[\{].+?[\)\]\}]/.test(n))
            s -= 40;
        if (words.some((w) => n.includes(w)))
            s += 30;
        else if (n.length >= 3 && words.some((w) => w.startsWith(n) || n.startsWith(w)))
            s += 18;
        if (n.includes('launcher'))
            s += 10;
        if (n.includes('game') || n.includes('play'))
            s += 5;
        if (/^(dx|d3d|opengl|vulkan|x86|32bit|win32)/.test(n) || /(_|-)?(x86|32|win32|dx9|dx11|dx12|vulkan|opengl)$/.test(n))
            s -= 6;
        s -= path.relative(d, p).split(path.sep).length * 3;
        return s;
    };
    const scored = exes.map((p) => ({ p, s: score(p), z: sizeCached(p) }));
    scored.sort((a, b) => (b.s - a.s) || (b.z - a.z));
    return scored.map((x) => x.p);
}

function classify(exes: string[], d: string): string[] {
    const good = exes.filter(goodExe);
    if (!good.length)
        return [];
    if (good.length === 1)
        return good;
    const ranked = rankLight(good, isDir(d) ? d : path.dirname(d), normalizeTitle(path.basename(d)));
    if (ranked.length > 1) {
        const top = ranked.slice(0, 3);
        const pen = top.map((p) => {
            const info = peInfo(p);
            return info.installer ? 150 : (info.console ? 20 : 0);
        });
        if (pen.some(Boolean)) {
            const idx = top.map((_, i) => i).sort((i, j) => (pen[i] - pen[j]) || (i - j));
            return idx.map((i) => top[i]).concat(ranked.slice(3));
        }
    }
    return ranked;
}

function entry(title: string, d: string, ranked: string[]): any {
    const exe = ranked[0];
    const conf = ranked.length === 1 || (!BAD_EXE.test(stem(exe)) && ranked.length <= 3) ? 'alta' : 'média';
    return { title: normalizeTitle(title) || title, exe, dir: isDir(d) ? d : path.dirname(d), alt_exes: ranked.slice(1, 8),
        size: sizeCached(exe), confidence: conf, n_exes: ranked.length, kind: 'windows' };
}

export function scanWindows(root: string, progress: Progress = null, limit = 3000, skip: Set<string> | null = null): any[] {
    const out: any[] = [];
    if (!isDir(root))
        throw new Error('Pasta não encontrada');
    const seenDirs = new Set<string>();
    const skipped = (p: string) => Boolean(skip && skip.size) && skip!.has(normcase(p));
    const gameDirs = (): string[] => {
        let ents: fs.Dirent[];
        try {
            ents = fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        }
        catch {
            return [];
        }
        const direct: string[] = [], subs: string[] = [];
        for (const e of ents) {
            const p = path.join(root, e.name);
            if (e.isDirectory()) {
                if (!SKIP_DIRS.test(e.name) && !e.name.startsWith('.') && !skipped(p))
                    subs.push(p);
            }
            else if (isGameFile(p) && !skipped(p))
                direct.push(p);
        }
        if (direct.length && (!subs.length || subs.every((s) => INNER_DIRS.test(path.basename(s)))))
            return [root];
        const res: string[] = [];
        for (const p of subs) {
            if (INNER_DIRS.test(path.basename(p)))
                return [root];
            res.push(p);
        }
        return res.concat(direct);
    };
    let i = 0;
    for (const d of gameDirs()) {
        if (out.length >= limit)
            break;
        if (progress && i++ % 5 === 0)
            progress(`Olhando ${path.basename(d)}…`);
        if (!isDir(d)) {
            const e = classify([d], path.dirname(d));
            if (e.length)
                out.push(entry(stem(d), d, e));
            continue;
        }
        if (seenDirs.has(d))
            continue;
        seenDirs.add(d);
        let exes = collectExes(d);
        if (!exes.length) {
            let inner: string[] = [];
            try {
                inner = fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !SKIP_DIRS.test(e.name)).map((e) => path.join(d, e.name));
            }
            catch {
                inner = [];
            }
            if (inner.length === 1)
                exes = collectExes(inner[0]);
        }
        if (!exes.length)
            continue;
        const ranked = classify(exes, d);
        if (!ranked.length)
            continue;
        out.push(entry(titleFromPath(ranked[0]), d, ranked));
        const t = normalizeTitle(path.basename(d));
        if (t && t.length >= 3 && !isGeneric(path.basename(d)))
            out[out.length - 1].title = t;
    }
    return out;
}

export function scanRoms(root: string, systems: Record<string, any>, progress: Progress = null, limit = 5000): any[] {
    if (!isDir(root))
        throw new Error('Pasta não encontrada');
    const extMap = new Map<string, string[]>();
    for (const [sid, sc] of Object.entries<any>(systems)) {
        if (sid === 'pc')
            continue;
        for (const e of sc.exts || []) {
            const k = String(e).toLowerCase();
            if (!extMap.has(k))
                extMap.set(k, []);
            extMap.get(k)!.push(sid);
        }
    }
    const out: any[] = [];
    let n = 0;
    const walk = (cur: string): boolean => {
        let ents: fs.Dirent[];
        try {
            ents = fs.readdirSync(cur, { withFileTypes: true });
        }
        catch {
            return true;
        }
        const files = ents.filter((e) => e.isFile()).map((e) => e.name).sort();
        const lower = new Set(files.map((f) => f.toLowerCase()));
        const hasCue = [...lower].some((x) => x.endsWith('.cue'));
        for (const f of files) {
            const ext = path.extname(f).toLowerCase();
            if (ext === '.bin' && hasCue)
                continue;
            if (!extMap.has(ext) && !ROM_EXTS_FALLBACK.has(ext))
                continue;
            if (ARCH_EXTS.has(ext) && !(extMap.get(ext) || []).length)
                continue;
            const p = path.join(cur, f);
            n += 1;
            if (progress && n % 50 === 0)
                progress(`${n} arquivos…`);
            const cands = extMap.get(ext) || [];
            const g = guessSystem(path.relative(root, p)) || guessSystem(root);
            let sid = (g && cands.includes(g)) || (g && !cands.length) ? g : (cands.length === 1 ? cands[0] : '');
            if (!sid && cands.length)
                sid = cands[0];
            out.push({ title: normalizeTitle(stem(f)) || stem(f), rom: p, dir: cur, system: sid || '', ambiguous: cands.length > 1 && !cands.includes(g),
                kind: 'rom', size: sizeOf(p) });
            if (out.length >= limit)
                return false;
        }
        for (const e of ents)
            if (e.isDirectory() && !SKIP_DIRS.test(e.name))
                if (!walk(path.join(cur, e.name)))
                    return false;
        return true;
    };
    walk(root);
    return out;
}

export function scanAsync(mode: 'windows' | 'roms' | 'walk', root: string, opts: { progress?: Progress; limit?: number; skip?: Set<string> | null; systems?: Record<string, any>; dirs?: string[]; maxDepth?: number; exts?: string[] } = {}): Promise<any[]> {
    return new Promise((resolve, reject) => {
        let Worker: any;
        try {
            Worker = require('node:worker_threads').Worker;
        }
        catch (e) {
            return reject(e);
        }
        const file = path.join(__dirname, 'scanWorker.js');
        if (!fs.existsSync(file))
            return reject(new Error('scanWorker.js ausente'));
        let w: any;
        try {
            w = new Worker(file, { workerData: { mode, root, limit: opts.limit, skip: opts.skip ? [...opts.skip] : null, systems: opts.systems || null, dirs: opts.dirs || null, maxDepth: opts.maxDepth, exts: opts.exts || null } });
        }
        catch (e) {
            return reject(e);
        }
        let settled = false;
        const finish = (fn: () => void) => {
            if (settled)
                return;
            settled = true;
            fn();
        };
        w.on('message', (m: any) => {
            if (!m)
                return;
            if (m.type === 'progress') {
                try {
                    opts.progress?.(String(m.msg || ''));
                }
                catch { }
            }
            else if (m.type === 'done')
                finish(() => resolve(Array.isArray(m.items) ? m.items : []));
            else if (m.type === 'error')
                finish(() => reject(new Error(m.error || 'falha na varredura')));
        });
        w.on('error', (e: any) => finish(() => reject(e)));
        w.on('exit', (code: number) => finish(() => reject(new Error(code ? `worker saiu com código ${code}` : 'a varredura terminou sem resposta'))));
    });
}

export async function scanWindowsAsync(root: string, progress: Progress = null, limit = 3000, skip: Set<string> | null = null): Promise<any[]> {
    try {
        return await scanAsync('windows', root, { progress, limit, skip });
    }
    catch {
        return scanWindows(root, progress, limit, skip);
    }
}

export async function scanRomsAsync(root: string, systems: Record<string, any>, progress: Progress = null, limit = 5000): Promise<any[]> {
    try {
        return await scanAsync('roms', root, { progress, limit, systems });
    }
    catch {
        return scanRoms(root, systems, progress, limit);
    }
}

export function walkFilesAsync(dirs: string[], maxDepth: number, exts: string[], progress: Progress = null): Promise<Array<{ path: string; size: number }>> {
    return scanAsync('walk', '', { dirs, maxDepth, exts, progress });
}
