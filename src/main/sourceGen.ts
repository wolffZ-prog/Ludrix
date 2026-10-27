import fs from 'node:fs';
import path from 'node:path';
import { prog, Cancel, Progress } from './jobs';
import { normalizeTitle } from './titles';
import { sha256File } from './installer';

const ARCHIVE = /\.(zip|7z|rar|iso|exe|bin|tar|gz|xz|zst|wim|\d{3}|z\d\d|part\d+\.rar)$/i;
const SKIP = /^(\.|_|desktop\.ini$|thumbs\.db$)/i;

export interface GenFile { name: string; rel: string; size: number }
export interface GenGame { id: string; title: string; version: string; year: string; files: GenFile[]; size: number }

function stem(name: string): string {
    let s = name;
    if (/\.part\d+\.rar$/i.test(s))
        s = s.replace(/\.part\d+\.rar$/i, '');
    else if (/\.(7z|zip|rar)\.\d{3}$/i.test(s))
        s = s.replace(/\.(7z|zip|rar)\.\d{3}$/i, '');
    else if (/\.(\d{3}|z\d\d)$/i.test(s))
        s = s.replace(/\.(\d{3}|z\d\d)$/i, '');
    else
        s = s.replace(/\.[a-z0-9]{1,4}$/i, '');
    return s;
}

function versionOf(s: string): string {
    const m = s.match(/(?:^|[\s._\-(\[])v?(\d+(?:\.\d+){1,3}[a-z]?)(?=$|[\s._\-)\]])/i);
    return m ? m[1] : '';
}

function yearOf(s: string): string {
    const m = s.match(/(?:^|[\s._\-(\[])((?:19|20)\d{2})(?=$|[\s._\-)\]])/);
    return m ? m[1] : '';
}

function slug(s: string): string {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'jogo';
}

function listFiles(dir: string): { rel: string; size: number }[] {
    const out: { rel: string; size: number }[] = [];
    let top: fs.Dirent[] = [];
    try {
        top = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return out;
    }
    for (const d of top) {
        if (SKIP.test(d.name))
            continue;
        const full = path.join(dir, d.name);
        if (d.isFile()) {
            if (ARCHIVE.test(d.name))
                out.push({ rel: d.name, size: safeSize(full) });
        }
        else if (d.isDirectory()) {
            let inner: fs.Dirent[] = [];
            try {
                inner = fs.readdirSync(full, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const f of inner)
                if (f.isFile() && ARCHIVE.test(f.name) && !SKIP.test(f.name))
                    out.push({ rel: d.name + '/' + f.name, size: safeSize(path.join(full, f.name)) });
        }
    }
    return out;
}

function safeSize(p: string): number {
    try {
        return fs.statSync(p).size;
    }
    catch {
        return 0;
    }
}

export function scanFolder(dir: string): { error?: string; dir?: string; games?: GenGame[]; ignored?: number } {
    dir = String(dir || '').trim();
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
        return { error: 'Pasta não encontrada' };
    const files = listFiles(dir);
    const groups = new Map<string, GenGame>();
    for (const f of files) {
        const base = path.basename(f.rel);
        const sub = f.rel.includes('/') ? f.rel.split('/')[0] : '';
        const key = sub ? 'd:' + sub.toLowerCase() : 's:' + stem(base).toLowerCase();
        let g = groups.get(key);
        if (!g) {
            const raw = sub || stem(base);
            const title = normalizeTitle(raw) || raw;
            g = { id: slug(title), title, version: versionOf(raw), year: yearOf(raw), files: [], size: 0 };
            groups.set(key, g);
        }
        g.files.push({ name: base, rel: f.rel, size: f.size });
        g.size += f.size;
    }
    const games = [...groups.values()].filter((g) => g.files.length);
    const seen = new Map<string, number>();
    for (const g of games) {
        g.files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        const n = (seen.get(g.id) || 0) + 1;
        seen.set(g.id, n);
        if (n > 1)
            g.id = `${g.id}-${n}`;
    }
    games.sort((a, b) => a.title.localeCompare(b.title));
    return { dir, games, ignored: 0 };
}

export interface GenRequest { name: string; dir: string; base_url: string; out: string; hash: boolean; games: { id: string; title: string; version?: string; year?: string; files: string[] }[] }

function joinUrl(base: string, rel: string): string {
    const enc = rel.split('/').map((s) => encodeURIComponent(s)).join('/');
    if (!base)
        return 'COLE-O-LINK-DO-ARQUIVO-AQUI/' + enc;
    return base.replace(/\/+$/, '') + '/' + enc;
}

export async function generate(req: GenRequest, cb: (p: Progress) => void, cancel: Cancel): Promise<{ out: string; count: number; files: number }> {
    const dir = String(req.dir || '');
    const out = String(req.out || '');
    if (!out)
        throw new Error('Escolha onde salvar o .json');
    const base = String(req.base_url || '').trim();
    if (base && !/^https?:\/\//i.test(base))
        throw new Error('A URL base precisa começar com http:// ou https://');
    const games = Array.isArray(req.games) ? req.games : [];
    if (!games.length)
        throw new Error('Nenhum jogo na lista');
    const total = games.reduce((a, g) => a + g.files.reduce((b, rel) => b + safeSize(path.join(dir, rel)), 0), 0) || 1;
    let done = 0, nfiles = 0;
    const outGames: any[] = [];
    for (const g of games) {
        cancel.check();
        const title = String(g.title || '').trim();
        if (!title || !Array.isArray(g.files) || !g.files.length)
            continue;
        const files: any[] = [];
        for (const rel of g.files) {
            cancel.check();
            const full = path.join(dir, String(rel));
            const size = safeSize(full);
            const f: any = { name: path.basename(String(rel)), url: joinUrl(base, String(rel)), size };
            if (req.hash && size > 0) {
                const before = done;
                cb(prog('download', before / total, `sha256 de ${f.name}`));
                f.sha256 = await sha256File(full, (fr) => cb(prog('download', (before + fr * size) / total, `sha256 de ${f.name}`)), cancel);
            }
            done += size;
            nfiles++;
            files.push(f);
        }
        const entry: any = { id: slug(String(g.id || title)), title, files };
        if (g.version)
            entry.version = String(g.version).trim();
        if (g.year && /^\d{4}$/.test(String(g.year)))
            entry.year = Number(g.year);
        outGames.push(entry);
    }
    if (!outGames.length)
        throw new Error('Nenhum jogo com título e arquivos');
    const doc: any = { format: 'ludrix-pack/1', name: String(req.name || '').trim() || 'Minha fonte', kind: 'pc', games: outGames };
    cb(prog('extract', 1, 'Gravando .json'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n', 'utf8');
    return { out, count: outGames.length, files: nfiles };
}
