import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import * as P from './paths';

export const DATA_FILES = ['config.json', 'library.json', 'repos.json', 'downloads.json'];
export const DATA_DIRS = ['covers', 'custom', 'save_backups'];
export const MANIFEST = 'ludrix-backup.json';
const MAX_IMPORT = 4 * 1024 ** 3;
const BAD_EXT = ['.exe', '.dll', '.bat', '.cmd', '.ps1', '.sh', '.py', '.js', '.html', '.htm'];

function stamp(fmt: 'dash' | 'compact') {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    return fmt === 'dash' ? `${date}_${p(d.getHours())}-${p(d.getMinutes())}` : `${date}_${p(d.getHours())}${p(d.getMinutes())}`;
}
export { stamp };

function restorable(n: string): boolean {
    if (n.includes('\\') || n.startsWith('/') || n.split('/').some((part) => part === '..' || part === ''))
        return false;
    if (DATA_FILES.some((f) => n === `data/${f}`) || n === 'games/rapidos/custom.json')
        return true;
    if (DATA_DIRS.some((d) => n.startsWith(`data/${d}/`)))
        return true;
    const low = n.toLowerCase();
    return n.startsWith('themes/') && (n.split('/').length - 1) >= 2 && !BAD_EXT.some((e) => low.endsWith(e));
}

function walk(src: string): string[] {
    const out: string[] = [];
    const rec = (d: string) => {
        let ents: fs.Dirent[];
        try {
            ents = fs.readdirSync(d, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of ents) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) {
                if (e.name !== '__pycache__')
                    rec(p);
            }
            else if (e.isFile())
                out.push(p);
        }
    };
    rec(src);
    return out.sort();
}

function add(z: AdmZip, src: string, arc: string): number {
    let st: fs.Stats;
    try {
        st = fs.statSync(src);
    }
    catch {
        return 0;
    }
    if (st.isFile()) {
        z.addFile(arc, fs.readFileSync(src));
        return 1;
    }
    let n = 0;
    for (const p of walk(src)) {
        const rel = path.relative(src, p).split(path.sep).join('/');
        z.addFile(`${arc}/${rel}`, fs.readFileSync(p));
        n += 1;
    }
    return n;
}

function isDir(p: string) {
    try {
        return fs.statSync(p).isDirectory();
    }
    catch {
        return false;
    }
}
function isFile(p: string) {
    try {
        return fs.statSync(p).isFile();
    }
    catch {
        return false;
    }
}

export function exportData(destDir: string, version: string) {
    fs.mkdirSync(destDir, { recursive: true });
    const out = path.join(destDir, `Ludrix-dados-${stamp('dash')}.zip`);
    let count = 0;
    const z = new AdmZip();
    for (const f of DATA_FILES) {
        const p = path.join(P.DATA, f);
        if (isFile(p))
            count += add(z, p, `data/${f}`);
    }
    for (const d of DATA_DIRS) {
        const p = path.join(P.DATA, d);
        if (isDir(p))
            count += add(z, p, `data/${d}`);
    }
    if (isDir(P.THEMES)) {
        for (const t of fs.readdirSync(P.THEMES)) {
            const tp = path.join(P.THEMES, t);
            if (isDir(tp))
                count += add(z, tp, `themes/${t}`);
        }
    }
    const cq = path.join(P.FLASH, 'custom.json');
    if (isFile(cq))
        count += add(z, cq, 'games/rapidos/custom.json');
    z.addFile(MANIFEST, Buffer.from(JSON.stringify({ app: 'LudrixHub', version, at: Date.now() / 1000, files: count, root: P.ROOT }), 'utf8'));
    z.writeZip(out);
    return { ok: true, path: out, files: count, size: fs.statSync(out).size };
}

export function inspect(file: string): any {
    const p = String(file || '');
    if (!isFile(p))
        return { error: 'Arquivo não encontrado' };
    let z: AdmZip;
    try {
        z = new AdmZip(p);
    }
    catch {
        return { error: 'Zip danificado' };
    }
    try {
        const entries = z.getEntries();
        const names = entries.map((e) => e.entryName);
        if (!names.includes(MANIFEST))
            return { error: 'Esse zip não é um backup do Ludrix (falta ludrix-backup.json)' };
        const m = JSON.parse(z.readAsText(MANIFEST));
        const total = entries.reduce((a, e) => a + (e.header.size || 0), 0);
        if (total > MAX_IMPORT)
            return { error: 'Backup grande demais' };
        const bad = names.filter((n) => n.startsWith('/') || n.split('/').includes('..') || !(n.startsWith('data/') || n.startsWith('themes/') || n.startsWith('games/rapidos/custom.json') || n.startsWith(MANIFEST)));
        if (bad.length)
            return { error: `Backup com caminho suspeito: ${bad[0]}` };
        const hasLib = names.includes('data/library.json');
        let lib: any = {};
        if (hasLib) {
            try {
                lib = JSON.parse(z.readAsText('data/library.json'));
            }
            catch {
                lib = {};
            }
        }
        const themes = new Set(names.filter((n) => n.startsWith('themes/') && (n.split('/').length - 1) >= 2).map((n) => n.split('/')[1]));
        return {
            ok: true, version: m.version || '?', at: m.at, files: names.length - 1,
            games: lib && typeof lib === 'object' && !Array.isArray(lib) ? Object.keys(lib).length : 0,
            themes: themes.size, has_config: names.includes('data/config.json'),
            saves: names.some((n) => n.startsWith('data/save_backups/')), size: total,
        };
    }
    catch {
        return { error: 'Zip danificado' };
    }
}

export function importData(file: string, version: string): any {
    const info = inspect(file);
    if (info.error)
        return info;
    const pre = exportData(P.UPDATES, version);
    let olds: string[] = [];
    try {
        olds = fs.readdirSync(P.UPDATES).filter((n) => /^Ludrix-dados-.*\.zip$/.test(n)).sort();
    }
    catch { }
    for (const old of olds.slice(0, Math.max(0, olds.length - 2)))
        fs.rmSync(path.join(P.UPDATES, old), { force: true });
    const z = new AdmZip(file);
    const entries = z.getEntries().filter((e) => e.entryName !== MANIFEST && !e.entryName.endsWith('/'));
    const names = entries.map((e) => e.entryName);
    for (const d of DATA_DIRS)
        if (names.some((n) => n.startsWith(`data/${d}/`)))
            fs.rmSync(path.join(P.DATA, d), { recursive: true, force: true });
    const root = path.resolve(P.ROOT);
    for (const e of entries) {
        const n = e.entryName;
        if (!restorable(n))
            continue;
        const target = path.resolve(P.ROOT, n);
        if (!target.startsWith(root + path.sep))
            continue;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, e.getData());
    }
    for (const f of ['config.json', 'library.json'])
        fs.rmSync(path.join(P.DATA, f + '.bak'), { force: true });
    return { ok: true, restart: true, restored: names.length, previous: pre.path, games: info.games, themes: info.themes, saves: info.saves, has_config: info.has_config };
}
