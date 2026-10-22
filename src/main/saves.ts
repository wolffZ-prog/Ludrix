import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cp from 'node:child_process';
import AdmZip from 'adm-zip';
import * as P from './paths';
import * as presets from './presets';
import { extract, flattenSingleFolder, safeMember } from './installer';

const WIN = process.platform === 'win32';
export const CRACK_DIRS = [
    '{appdata}/Goldberg SteamEmu Saves/{appid}', '{appdata}/Goldberg SteamEmu Saves',
    '{appdata}/GSE Saves/{appid}', '{appdata}/GSE Saves',
    '{public}/Documents/Steam/CODEX/{appid}', '{public}/Documents/Steam/CODEX',
    '{public}/Documents/Steam/RUNE/{appid}', '{public}/Documents/Steam/RUNE',
    '{appdata}/Steam/CODEX/{appid}', '{appdata}/Steam/CODEX', '{appdata}/Steam/RUNE',
    '{appdata}/SmartSteamEmu/{appid}', '{appdata}/SmartSteamEmu', '{docs}/SKIDROW/{appid}', '{docs}/SKIDROW',
    '{appdata}/EMPRESS/{appid}', '{appdata}/EMPRESS', '{public}/Documents/EMPRESS/{appid}',
    '{appdata}/Steam/Player', '{gamedir}/steam_settings', '{gamedir}/Saves', '{gamedir}/save',
    '{appdata}/OnlineFix/{appid}', '{public}/Documents/OnlineFix/{appid}', '{docs}/VALVE/{appid}',
];
const SAVE_HINT_RE = /save|profile|slot|\.sav$|\.dat$|\.bin$|\.b$|\.srm|\.mcd|\.ps2|\.gci|\.eep|\.sra|\.fla|\.mpk|memcard|option|edit0/i;

let DOCS_CACHE: string | null = null;
function docsDir(): string {
    const home = os.homedir();
    if (process.env.VL_DOCS)
        return process.env.VL_DOCS;
    if (DOCS_CACHE)
        return DOCS_CACHE;
    let d = path.join(home, 'Documents');
    if (WIN) {
        try {
            const r = cp.spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', 'Personal'], { encoding: 'utf8', windowsHide: true, timeout: 4000 });
            const m = /Personal\s+REG_(?:EXPAND_)?SZ\s+(.+)/i.exec(String(r.stdout || ''));
            if (m) {
                const v = m[1].trim().replace(/%([^%]+)%/g, (_a, n) => process.env[n] || process.env[n.toUpperCase()] || '');
                if (v && fs.existsSync(v))
                    d = v;
            }
        }
        catch { /* ignore */ }
    }
    DOCS_CACHE = d;
    return d;
}

export function vars(title: string, gamedir = '', emudir = '', year = '', appid = ''): Record<string, string> {
    const home = os.homedir();
    const docs = docsDir();
    const yr = /(19|20)\d{2}/.exec(title || '');
    year = year || (yr ? yr[0] : '');
    const n = /\b(\d{1,2})\b/.exec(title || '');
    return {
        docs, home, userprofile: home,
        appdata: process.env.APPDATA || path.join(home, 'AppData/Roaming'),
        localappdata: process.env.LOCALAPPDATA || path.join(home, 'AppData/Local'),
        savedgames: path.join(home, 'Saved Games'), public: process.env.PUBLIC || 'C:\\Users\\Public',
        gamedir: gamedir || '', emudir: emudir || '', title: String(title || '').replace(/[:\\/*?"<>|]/g, '').trim(),
        year, yy: year ? year.slice(-2) : '', n: n ? n[1] : '', sub: '', appid: appid || '',
    };
}

function globSimple(base: string, pat: string): string[] {
    const re = new RegExp('^' + pat.split('*').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', WIN ? 'i' : '');
    try {
        return fs.readdirSync(base).filter((n) => re.test(n)).map((n) => path.join(base, n));
    }
    catch {
        return [];
    }
}

export function expand(tpl: string, v: Record<string, string>): string[] {
    let missing = false;
    const s = tpl.replace(/\{([a-z_]+)\}/g, (_m, k) => {
        if (!(k in v)) {
            missing = true;
            return '';
        }
        return v[k];
    });
    if (missing)
        return [];
    if ((tpl.includes('{gamedir}') && !v.gamedir) || (tpl.includes('{emudir}') && !v.emudir) || (tpl.includes('{appid}') && !v.appid))
        return [];
    if (s.includes('*')) {
        const base = path.dirname(s.split('*')[0]);
        const pat = path.basename(s);
        return fs.existsSync(base) ? globSimple(base, pat) : [];
    }
    return [s];
}

function exists(p: string) {
    try {
        fs.accessSync(p);
        return true;
    }
    catch {
        return false;
    }
}
function isDir(p: string) {
    try {
        return fs.statSync(p).isDirectory();
    }
    catch {
        return false;
    }
}
function nonEmptyDir(p: string) {
    try {
        return fs.statSync(p).isDirectory() && fs.readdirSync(p).length > 0;
    }
    catch {
        return false;
    }
}
function rglobFiles(root: string): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
        let ents: fs.Dirent[];
        try {
            ents = fs.readdirSync(d, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of ents) {
            const p = path.join(d, e.name);
            if (e.isDirectory())
                walk(p);
            else if (e.isFile())
                out.push(p);
        }
    };
    walk(root);
    return out;
}
function copyTree(src: string, dst: string) {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, e.name), d = path.join(dst, e.name);
        if (e.isDirectory())
            copyTree(s, d);
        else if (e.isFile()) {
            fs.copyFileSync(s, d);
            try {
                const st = fs.statSync(s);
                fs.utimesSync(d, st.atime, st.mtime);
            }
            catch { /* ignore */ }
        }
    }
}
function stamp() {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export class SaveManager {
    presets: any;
    AUTO_MAX = 512 * 1024 * 1024;
    constructor(private store: any, private emu: any) {
        this.presets = this.load();
    }
    load(): any {
        try {
            const p = presets.saves();
            return p && typeof p === 'object' ? { emulators: p.emulators || {}, games: p.games || [], generic_pc: p.generic_pc || [] } : { emulators: {}, games: [], generic_pc: [] };
        }
        catch {
            return { emulators: {}, games: [], generic_pc: [] };
        }
    }

    locate(key: string, game: any, deep = false): any {
        const info = this.store.lib(key) || {};
        if (info.save_dir && exists(String(info.save_dir)))
            return { dir: info.save_dir, how: 'manual', note: 'Pasta definida por você.', candidates: [], ext: [], folder: true };
        const title = String(game.title || '');
        const gamedir = String(game.dir || '');
        const system = String(game.system || 'pc');
        const t0 = Date.now();
        const elapsed = () => Math.round((Date.now() - t0) / 10) / 100;

        if (system !== 'pc' && (game.emu || key.startsWith('rom:') || info.kind === 'rom')) {
            const emuId = this.emu.emulatorFor(system);
            const exe = emuId ? this.emu.emuExe(emuId) : null;
            const ec = this.presets.emulators[emuId || ''] || {};
            const v = vars(title, game.exe ? path.dirname(String(game.exe)) : gamedir, exe ? path.dirname(exe) : '');
            const cands: string[] = [];
            for (const tpl of ec.paths || [])
                cands.push(...expand(tpl, v));
            const hit = cands.find((c) => exists(c)) || null;
            const all = this.emu.allEmulators();
            return { dir: hit || '', how: 'emulator', emulator: emuId, emulator_title: (all[emuId || ''] || {}).title || emuId,
                note: ec.note || '', candidates: cands, ext: ec.ext || [], folder: Boolean(ec.folder), manual: hit === null, elapsed: elapsed() };
        }

        const v = vars(title, gamedir, '', '', String(info.steam_appid || ''));
        const low = title.toLowerCase();
        let cands: string[] = [], note = '', ext: any[] = [], folder = true;
        for (const g of this.presets.games) {
            let re: RegExp;
            try {
                re = new RegExp(g.match, 'i');
            }
            catch {
                continue;
            }
            if (re.test(low)) {
                for (const tpl of g.paths || [])
                    cands.push(...expand(tpl, v));
                note = g.note || '';
                ext = g.ext || [];
                folder = Boolean(g.folder !== undefined ? g.folder : !(g.ext && g.ext.length));
                break;
            }
        }
        const known = cands.filter((c) => exists(c));
        if (known.length)
            return { dir: known[0], how: 'preset', note, candidates: cands, ext, folder, elapsed: elapsed() };

        const gen: string[] = [];
        for (const tpl of this.presets.generic_pc || [])
            gen.push(...expand(tpl, v));
        const words = low.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
        for (const tpl of CRACK_DIRS) {
            for (const c of expand(tpl, v)) {
                if (tpl.includes('{appid}') || tpl.includes('{gamedir}'))
                    gen.push(c);
                else if (isDir(c)) {
                    try {
                        for (const e of fs.readdirSync(c, { withFileTypes: true })) {
                            if (!e.isDirectory() || !words.length)
                                continue;
                            const n = e.name.toLowerCase();
                            if (words.filter((w) => n.includes(w)).length >= Math.max(1, Math.floor(words.length / 2)))
                                gen.push(path.join(c, e.name));
                        }
                    }
                    catch { /* ignore */ }
                }
            }
        }
        const hit = gen.find((c) => nonEmptyDir(c)) || null;
        if (hit) {
            const how = ['Goldberg', 'CODEX', 'RUNE', 'SKIDROW', 'EMPRESS', 'SmartSteamEmu', 'GSE', 'OnlineFix'].some((k) => hit.includes(k)) ? 'crack' : 'generic';
            return { dir: hit, how, note: note || (how === 'crack' ? 'Save de versão com crack (emulador de Steam).' : ''), candidates: cands, ext, folder, elapsed: elapsed() };
        }

        const found = this.quickSearch(title, gamedir, v, deep ? 12000 : 4000);
        if (found.length)
            return { dir: found[0], how: 'search', note: 'Encontrada por busca rápida — confira se é a pasta certa.', alternatives: found.slice(1, 6), candidates: cands, ext, folder, elapsed: elapsed() };
        return { dir: '', how: 'none', note, candidates: cands, ext, folder, manual: true, elapsed: elapsed() };
    }

    quickSearch(title: string, gamedir: string, v: Record<string, string>, budgetMs: number): string[] {
        const words = title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['the', 'and', 'for', 'edition', 'game', 'remastered'].includes(w));
        if (!words.length)
            return [];
        const acr = words.length > 1 ? words.map((w) => w[0]).join('') : '';
        const roots = [v.docs, path.join(v.docs, 'My Games'), v.savedgames, v.appdata, v.localappdata, path.join(v.localappdata, 'Packages'), path.join(v.public, 'Documents')];
        if (gamedir)
            roots.unshift(gamedir);
        const t0 = Date.now();
        const hits: Array<[number, string]> = [];
        const seen = new Set<string>();
        const score = (name: string) => {
            const n = name.toLowerCase();
            let s = words.filter((w) => n.includes(w)).length * 2;
            if (acr && acr.length >= 3 && n.includes(acr))
                s += 3;
            if (SAVE_HINT_RE.test(n))
                s += 1;
            return s;
        };
        const SKIP = new Set(['windows', 'program files', 'program files (x86)', 'node_modules', 'cache', 'temp', 'tmp']);
        for (const root of roots) {
            if (!exists(root))
                continue;
            const stack: Array<[string, number]> = [[root, 0]];
            while (stack.length) {
                const [d, depth] = stack.pop() as [string, number];
                if (Date.now() - t0 > budgetMs)
                    break;
                let ents: fs.Dirent[];
                try {
                    ents = fs.readdirSync(d, { withFileTypes: true });
                }
                catch {
                    continue;
                }
                for (const e of ents) {
                    if (!e.isDirectory())
                        continue;
                    if (e.name.startsWith('.') || e.name.startsWith('$') || SKIP.has(e.name.toLowerCase()))
                        continue;
                    const sc = score(e.name);
                    const p = path.join(d, e.name);
                    if (sc >= 2 && !seen.has(p)) {
                        seen.add(p);
                        hits.push([sc + (root === (gamedir || '/nonexistent') ? 2 : 0), p]);
                    }
                    if (depth < 3)
                        stack.push([p, depth + 1]);
                }
            }
        }
        hits.sort((a, b) => b[0] - a[0]);
        return hits.slice(0, 8).map(([, p]) => p);
    }

    setManual(key: string, folder: string) {
        if (!isDir(folder))
            return { error: 'Pasta não existe' };
        this.store.patchLib(key, { save_dir: folder });
        return { ok: true, dir: folder };
    }

    backupDir(key: string) {
        const d = path.join(P.DATA, 'save_backups', key.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80));
        fs.mkdirSync(d, { recursive: true });
        return d;
    }

    autoBackup(key: string, game: any): string | null {
        let loc: any;
        try {
            loc = this.locate(key, game);
        }
        catch {
            return null;
        }
        const d = String(loc.dir || '');
        if (!d || !exists(d))
            return null;
        const size = isDir(d) ? P.dirSize(d) : fs.statSync(d).size;
        if (size > this.AUTO_MAX)
            return null;
        const last = this.listBackups(key);
        if (last.length && P.dirSize(last[0].path) - size === 0 && this.sameTree(last[0].path, d))
            return null;
        return this.backup(key, d);
    }

    sameTree(a: string, b: string): boolean {
        try {
            const sig = (root: string, f: string) => `${path.relative(root, f).split(path.sep).join('/')}|${fs.statSync(f).size}|${Math.floor(fs.statSync(f).mtimeMs / 1000)}`;
            const fa = rglobFiles(a).map((f) => sig(a, f)).sort();
            const fb = isDir(b) ? rglobFiles(b).map((f) => sig(b, f)).sort() : [`${path.basename(b)}|${fs.statSync(b).size}|${Math.floor(fs.statSync(b).mtimeMs / 1000)}`];
            return fa.length === fb.length && fa.every((x, i) => x === fb[i]);
        }
        catch {
            return false;
        }
    }

    backup(key: string, saveDir: string): string | null {
        const src = saveDir;
        if (!exists(src))
            return null;
        let dst = path.join(this.backupDir(key), stamp());
        for (let i = 1; exists(dst); i++)
            dst = path.join(this.backupDir(key), `${stamp()}-${i}`);
        try {
            if (isDir(src))
                copyTree(src, dst);
            else {
                fs.mkdirSync(dst, { recursive: true });
                fs.copyFileSync(src, path.join(dst, path.basename(src)));
            }
        }
        catch {
            return null;
        }
        const olds = fs.readdirSync(this.backupDir(key)).sort();
        for (const o of olds.slice(0, Math.max(0, olds.length - 5)))
            fs.rmSync(path.join(this.backupDir(key), o), { recursive: true, force: true });
        return dst;
    }

    async importSave(key: string, source: string, destDir: string, doBackup = true) {
        const src = source, dst = destDir;
        if (!exists(src))
            return { error: 'Arquivo/pasta de origem não existe' };
        fs.mkdirSync(dst, { recursive: true });
        const bk = doBackup ? this.backup(key, destDir) : null;
        const copied: string[] = [];
        const copyFrom = (base: string) => {
            for (const p of rglobFiles(base)) {
                const rel = path.relative(base, p);
                fs.mkdirSync(path.dirname(path.join(dst, rel)), { recursive: true });
                fs.copyFileSync(p, path.join(dst, rel));
                copied.push(rel);
            }
        };
        const ext = path.extname(src).toLowerCase();
        if (isDir(src))
            copyFrom(src);
        else if (['.zip', '.7z', '.rar'].includes(ext)) {
            const tmp = path.join(P.DOWNLOADS, `save_${Math.floor(Date.now() / 1000)}`);
            fs.mkdirSync(tmp, { recursive: true });
            try {
                if (ext === '.zip') {
                    const z = new AdmZip(src);
                    for (const e of z.getEntries()) {
                        if (e.isDirectory)
                            continue;
                        const d = safeMember(tmp, e.entryName);
                        fs.mkdirSync(path.dirname(d), { recursive: true });
                        fs.writeFileSync(d, e.getData());
                    }
                }
                else
                    await extract(src, tmp, () => undefined, { aborted: false, pause: false, check: () => undefined });
                flattenSingleFolder(tmp);
                const same = fs.readdirSync(tmp).find((n) => isDir(path.join(tmp, n)) && n.toLowerCase() === path.basename(dst).toLowerCase());
                copyFrom(same ? path.join(tmp, same) : tmp);
            }
            finally {
                fs.rmSync(tmp, { recursive: true, force: true });
            }
        }
        else {
            fs.copyFileSync(src, path.join(dst, path.basename(src)));
            copied.push(path.basename(src));
        }
        this.store.patchLib(key, { save_dir: dst, last_save_import: Date.now() / 1000 });
        return { ok: true, copied: copied.slice(0, 50), count: copied.length, backup: bk, dir: dst };
    }

    exportSave(_key: string, saveDir: string, destZip: string) {
        const src = saveDir;
        if (!exists(src))
            return { error: 'Pasta de save não existe' };
        fs.mkdirSync(path.dirname(destZip), { recursive: true });
        const z = new AdmZip();
        if (isDir(src)) {
            for (const p of rglobFiles(src))
                z.addFile(path.basename(src) + '/' + path.relative(src, p).split(path.sep).join('/'), fs.readFileSync(p));
        }
        else
            z.addFile(path.basename(src), fs.readFileSync(src));
        z.writeZip(destZip);
        return { ok: true, file: destZip };
    }

    listBackups(key: string) {
        const d = path.join(P.DATA, 'save_backups', key.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80));
        if (!exists(d))
            return [];
        return fs.readdirSync(d).sort().reverse().map((b) => ({ name: b, path: path.join(d, b), size: P.dirSize(path.join(d, b)) }));
    }

    restoreBackup(key: string, backupPath: string, destDir: string) {
        return this.importSave(key, backupPath, destDir, true);
    }
}
