import fs from 'node:fs';
import { validateManifest, sizeOf, reportSummary } from './manifest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as P from './paths';
import * as log from './log';
import * as http from './http';
import * as webcache from './webcache';
import * as util from './util';

export const UA = { 'User-Agent': 'Ludrix/1.0' };
export const CATALOG_TTL = 12 * 3600;
export const FILES_TTL = 7 * 24 * 3600;
export const ROM_EXT = 'chd|iso|cue|bin|img|pbp|cso|gcz|gz|z64|n64|v64|nds|gba|gb|gbc|sfc|smc|nes|md|gen|smd|gcm|rvz|wbfs|wad|gdi|cdi|xiso|xex|zar|wua|wud|wux|rpx|nsp|xci|3ds|cci|sms|gg|pce|a26|sfc';
export const ROM_FILE_RE = new RegExp('\\.(' + ROM_EXT + '|7z|zip|rar|tar)$', 'i');
const ROM_EXT_FULL = new RegExp('^(' + ROM_EXT + ')$', 'i');

const SYSTEM_HINTS: Array<[string, RegExp]> = [
    ['ps2', /\bps2\b|playstation ?2/], ['ps3', /\bps3\b|playstation ?3/], ['psp', /\bpsp\b/],
    ['ps1', /\bpsx\b|\bps1\b|playstation(?! ?[23])|\bpsone\b/], ['dc', /dreamcast|\bdc\b(?!o)/], ['gc', /gamecube|\bgcn?\b/],
    ['wiiu', /wii ?u/], ['wii', /\bwii\b(?!ware)/], ['x360', /xbox ?360|\bx360\b/], ['xbox', /\bxbox\b/], ['switch', /switch|\bnsw\b/],
    ['3ds', /\b3ds\b/], ['nds', /\bnds\b|nintendo ds/], ['gba', /\bgba\b|game ?boy/], ['n64', /\bn64\b|nintendo 64/],
    ['snes', /\bsnes\b|super nintendo|super famicom/], ['nes', /\bnes\b|famicom/], ['saturn', /saturn/],
    ['genesis', /mega ?drive|genesis|\bmd\b/], ['sms', /master system|game ?gear/], ['pce', /pc ?engine|turbografx/],
    ['atari2600', /atari ?2600/], ['arcade', /mame|fbneo|arcade|naomi|model ?[23]|atomiswave|hbmame/], ['dos', /ms-?dos|dosbox/],
    ['pc', /windows|\bpc\b|teknoparrot/],
];

export function guessSystem(...texts: Array<string | undefined | null>): string {
    const t = texts.map((x) => x || '').join(' ').toLowerCase();
    for (const [sid, pat] of SYSTEM_HINTS)
        if (pat.test(t))
            return sid;
    return '';
}

const EXT_SYSTEM: Record<string, string> = {
    nds: 'nds', gba: 'gba', gb: 'gba', gbc: 'gba', z64: 'n64', n64: 'n64', v64: 'n64', sfc: 'snes', smc: 'snes', nes: 'nes',
    md: 'genesis', gen: 'genesis', smd: 'genesis', rvz: 'gc', gcm: 'gc', gcz: 'gc', ciso: 'gc', wbfs: 'wii', wad: 'wii',
    cso: 'psp', pbp: 'psp', cdi: 'dc', gdi: 'dc', xiso: 'xbox', xex: 'x360', zar: 'x360', nsp: 'switch', xci: 'switch', nro: 'switch',
    '3ds': '3ds', cci: '3ds', cxi: '3ds', wua: 'wiiu', wud: 'wiiu', wux: 'wiiu', rpx: 'wiiu', sms: 'sms', gg: 'sms', pce: 'pce', a26: 'atari2600',
};

export function extSystem(...names: string[]): string {
    for (const n of names) {
        const base = (n || '').split('/').pop() || '';
        const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : '';
        if (ext in EXT_SYSTEM)
            return EXT_SYSTEM[ext];
    }
    return '';
}

const ARCHIVE_RE = /\.(7z|zip|rar|tar|chd|iso|bin|cue|z64|n64|v64|nds|gba|gb|gbc|sfc|smc|nes|md|gen|smd|gcm|rvz|wbfs|pbp|cso|xci|nsp|exe)(\.\d{3})?$/i;
const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

export interface FileRef { name: string; url: string; size: number; sha256?: string }

export function fileRef(name: string, url: string, size = 0, sha256 = ''): FileRef {
    const r: FileRef = { name, url, size: Number(size) || 0 };
    if (sha256)
        r.sha256 = sha256;
    return r;
}

export function basename(f: FileRef): string {
    return f.name.split('/').pop() || f.name;
}

export interface Entry {
    key: string; repo: string; id: string; title: string; kind: string; system: string;
    creator: string; year: string; size: number; description: string; cover: string; thumb: string;
    genres: string[]; tags: string[]; page_url: string; magnet: string; torrent_url: string;
    files: FileRef[]; files_loaded: boolean; extra: Record<string, any>;
}

export function makeEntry(e: Partial<Entry> & { key: string; repo: string; id: string; title: string }): Entry {
    return {
        kind: 'pc', system: 'pc', creator: '', year: '', size: 0, description: '', cover: '', thumb: '',
        genres: [], tags: [], page_url: '', magnet: '', torrent_url: '', files: [], files_loaded: false, extra: {},
        ...e,
    };
}

export function entryDict(e: Entry): Record<string, any> {
    const { files, extra, ...rest } = e;
    return { ...rest, files: files.map((f) => ({ ...f })), extra: { ...extra } };
}

function first(v: any): string {
    if (Array.isArray(v))
        return v.length ? String(v[0]) : '';
    return v == null ? '' : String(v);
}

export function cleanHtml(text: string): string {
    let t = String(text || '').replace(/<br\s*\/?>/gi, '\n');
    t = t.replace(/<\/p>/gi, '\n\n');
    t = t.replace(/<[^>]+>/g, '');
    t = http.decodeHtmlEntities(t);
    return t.replace(/\n{3,}/g, '\n\n').trim();
}

function quotePath(n: string): string {
    return n.split('/').map((s) => encodeURIComponent(s).replace(/%2C/g, ',').replace(/%3A/g, ':').replace(/%40/g, '@')).join('/');
}

function unquote(s: string): string {
    try {
        return decodeURIComponent(s);
    }
    catch {
        return s;
    }
}

function withParams(url: string, params?: Record<string, any>): string {
    if (!params)
        return url;
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) {
        if (v == null)
            continue;
        if (Array.isArray(v))
            for (const x of v)
                u.searchParams.append(k, String(x));
        else
            u.searchParams.append(k, String(v));
    }
    return u.toString();
}

function human(n: number): string {
    let v = Number(n || 0);
    for (const u of ['B', 'KB', 'MB', 'GB', 'TB']) {
        if (v < 1024)
            return u === 'B' ? `${v.toFixed(0)} ${u}` : `${v.toFixed(1)} ${u}`;
        v /= 1024;
    }
    return `${v.toFixed(1)} PB`;
}

function strip(s: string, chars: string): string {
    let a = 0, b = s.length;
    while (a < b && chars.includes(s[a])) a++;
    while (b > a && chars.includes(s[b - 1])) b--;
    return s.slice(a, b);
}

async function pmap<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let i = 0;
    const worker = async () => {
        while (i < items.length) {
            const idx = i++;
            out[idx] = await fn(items[idx]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
    return out;
}

export class Cache {
    constructor(public s: http.Session) { }

    file(key: string): string {
        return path.join(P.CACHE_WEB, key.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 150) + '.json');
    }

    async getJson(key: string, url: string, ttl: number, params?: Record<string, any>): Promise<any> {
        const p = this.file(key);
        try {
            if (fs.existsSync(p) && Date.now() / 1000 - fs.statSync(p).mtimeMs / 1000 < ttl)
                return JSON.parse(fs.readFileSync(p, 'utf8'));
        }
        catch { }
        const r = await this.s.get(withParams(url, params), { timeout: 30_000 });
        if (r.status >= 400) {
            let body = '';
            try {
                body = await r.text();
            }
            catch { }
            throw new http.HttpError(`HTTP ${r.status}: ${body.slice(0, 400)}`, r.status);
        }
        const data = await r.json();
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(data), 'utf8');
        return data;
    }

    getLocal(key: string, ttl: number): any {
        const p = this.file(key);
        try {
            if (fs.existsSync(p) && Date.now() / 1000 - fs.statSync(p).mtimeMs / 1000 < ttl)
                return JSON.parse(fs.readFileSync(p, 'utf8'));
        }
        catch {
            return null;
        }
        return null;
    }

    putLocal(key: string, data: any) {
        const p = this.file(key);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(data), 'utf8');
    }

    drop(key: string) {
        try {
            fs.rmSync(this.file(key), { force: true });
        }
        catch { }
    }
}

export class Provider {
    id: string;
    name: string;
    kind: string;
    system: string;
    store: any = null;
    report: any = null;
    constructor(public cfg: Record<string, any>, public s: http.Session, public cache: Cache) {
        this.id = cfg.id;
        this.name = cfg.name || this.id;
        this.kind = cfg.kind || 'pc';
        this.system = cfg.system || 'pc';
    }

    async catalog(_force = false): Promise<Entry[]> {
        throw new Error('not implemented');
    }

    async files(entry: Entry): Promise<FileRef[]> {
        return entry.files.map((f) => ({ ...f }));
    }

    async thumbUrl(entry: Entry): Promise<string> {
        return entry.thumb || entry.cover;
    }
}

function excluder(cfg: Record<string, any>) {
    const ids = new Set((cfg.exclude || []).filter(Boolean).map((x: any) => String(x).toLowerCase()));
    let rx: RegExp | null = null;
    if (cfg.exclude_re) {
        try {
            rx = new RegExp(cfg.exclude_re, 'i');
        }
        catch {
            rx = null;
        }
    }
    return (...vals: string[]) => vals.some((v) => v && (ids.has(v.toLowerCase()) || (rx && rx.test(v))));
}

function sortTitle(out: Entry[]) {
    out.sort((a, b) => (a.title.toLowerCase() < b.title.toLowerCase() ? -1 : a.title.toLowerCase() > b.title.toLowerCase() ? 1 : 0));
    return out;
}

export class ArchiveProvider extends Provider {
    static SEARCH = 'https://archive.org/advancedsearch.php';
    static META = 'https://archive.org/metadata/{id}';

    query(): string {
        if (this.cfg.type === 'archive_uploader')
            return `uploader:(${this.cfg.uploader}) AND mediatype:(software)`;
        if (this.cfg.type === 'archive_creator')
            return `creator:("${this.cfg.creator}")`;
        return this.cfg.query;
    }

    async catalog(force = false): Promise<Entry[]> {
        const params = { q: this.query(), 'fl[]': ['identifier', 'title', 'creator', 'year', 'item_size', 'description', 'subject'], rows: 3000, output: 'json' };
        const key = `catalog_${this.id}`;
        if (force)
            this.cache.drop(key);
        const data = await this.cache.getJson(key, ArchiveProvider.SEARCH, CATALOG_TTL, params);
        const skip = excluder(this.cfg);
        const out: Entry[] = [];
        for (const d of data.response.docs) {
            const ident = d.identifier;
            let subj = d.subject || [];
            if (typeof subj === 'string')
                subj = subj.split(';').map((s: string) => s.trim());
            if (skip(ident, first(d.title)))
                continue;
            out.push(makeEntry({
                key: `${this.id}:${ident}`, repo: this.id, id: ident,
                title: first(d.title) || ident, kind: this.kind, system: this.system,
                creator: first(d.creator), year: String(first(d.year) || ''),
                size: Number(d.item_size || 0), description: cleanHtml(first(d.description)),
                cover: `https://archive.org/services/img/${ident}`,
                thumb: `https://archive.org/services/img/${ident}`,
                tags: subj.filter((s: string) => s && s.toLowerCase() !== 'video games').slice(0, 8),
                page_url: `https://archive.org/details/${ident}`,
                torrent_url: this.cfg.torrent ? `https://archive.org/download/${ident}/${ident}_archive.torrent` : '',
            }));
        }
        return sortTitle(out);
    }

    async files(entry: Entry): Promise<FileRef[]> {
        if (entry.files_loaded)
            return entry.files.map((f) => ({ ...f }));
        const data = await this.cache.getJson(`files_${entry.id}`, ArchiveProvider.META.replace('{id}', entry.id), FILES_TTL);
        const arcs: FileRef[] = [];
        const covers: string[] = [];
        for (const f of data.files || []) {
            if (f.source !== 'original')
                continue;
            const n = f.name;
            const low = n.toLowerCase();
            if (ARCHIVE_RE.test(low))
                arcs.push(fileRef(n, `https://archive.org/download/${entry.id}/${quotePath(n)}`, Number(f.size || 0)));
            else if (IMAGE_RE.test(low) && !low.startsWith('__ia_thumb'))
                covers.push(`https://archive.org/download/${entry.id}/${quotePath(n)}`);
        }
        arcs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        entry.files = arcs.map((a) => ({ ...a }));
        entry.files_loaded = true;
        if (covers.length)
            entry.cover = covers[0];
        return arcs;
    }
}

export const ROM_TITLE_RE = /\s*[\(\[].*?[\)\]]/g;

export class ArchiveItemProvider extends Provider {
    static META = 'https://archive.org/metadata/{id}';

    identifiers(): string[] {
        const ids = this.cfg.identifiers || [this.cfg.identifier];
        return ids.filter(Boolean);
    }

    async catalog(force = false): Promise<Entry[]> {
        let out: Entry[] = [];
        const ids = this.identifiers();
        for (const ident of ids) {
            try {
                out = out.concat(await this.one(ident, force));
            }
            catch (e) {
                if (ids.length === 1)
                    throw e;
                log.warn('archive item %s: %s', ident, e);
            }
        }
        return sortTitle(out);
    }

    async one(ident: string, force: boolean): Promise<Entry[]> {
        const key = `item_${ident}`;
        if (force)
            this.cache.drop(key);
        const data = await this.cache.getJson(key, ArchiveItemProvider.META.replace('{id}', ident), FILES_TTL);
        const md = data.metadata || {};
        const files = (data.files || []).filter((f: any) => f.source === 'original');
        const names = new Set(files.map((f: any) => String(f.name).toLowerCase()));
        const isPc = this.kind === 'pc' || this.system === 'pc';
        const folder = strip(String(this.cfg.folder || ''), '/');
        const skip = excluder(this.cfg);
        const groups: Record<string, Entry> = {};
        const out: Entry[] = [];
        const stemRe = new RegExp('\\.(' + ROM_EXT + '|7z|zip|rar|tar)(\\.001)?$', 'i');
        for (const f of files) {
            const n = String(f.name);
            const low = n.toLowerCase();
            if (folder && !low.startsWith(folder.toLowerCase() + '/'))
                continue;
            if (!ROM_FILE_RE.test(low) || low.includes('/capa') || low.startsWith('capa') || low.includes('cover'))
                continue;
            if (low.endsWith('.bin') && names.has(low.slice(0, -4) + '.cue'))
                continue;
            if (/\.\d{3}$/.test(low) && !low.endsWith('.001'))
                continue;
            const base = n.split('/').pop()!;
            if (skip(base, n))
                continue;
            let stem = base.replace(stemRe, '');
            stem = stem.replace(/\.(dos|win|pc|nkit|dec)$/i, '');
            const disc = /\s*\((?:disc|disk|cd)\s*\d+\)/i.exec(stem);
            const gstem = disc ? (stem.slice(0, disc.index) + stem.slice(disc.index + disc[0].length)).trim() : stem;
            const title = (this.cfg.rename || {})[base] || gstem.replace(ROM_TITLE_RE, '').replace(/_/g, ' ').trim() || gstem;
            const fid = gstem.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 80);
            const size = Number(f.size || 0);
            const ref = fileRef(n, `https://archive.org/download/${ident}/${quotePath(n)}`, size);
            if (disc && fid in groups) {
                const g = groups[fid];
                g.files.push(ref);
                g.files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
                g.size += size;
                continue;
            }
            const tags: string[] = [];
            for (const m of gstem.matchAll(/\(([^)]+)\)/g))
                tags.push(m[1]);
            const e = makeEntry({
                key: `${this.id}:${fid}`, repo: this.id, id: fid, title, kind: isPc ? 'pc' : 'rom', system: isPc ? 'pc' : this.system,
                creator: first(md.creator), size, page_url: `https://archive.org/details/${ident}`,
                tags: tags.slice(0, 4), files: [ref], files_loaded: true,
                extra: { rom_file: base, item: ident },
            });
            if (disc)
                groups[fid] = e;
            out.push(e);
        }
        return out;
    }
}

export async function browseArchive(session: http.Session, q: string, rows = 60): Promise<any[]> {
    q = q.trim();
    if (!q)
        return [];
    if (/^https?:\/\//.test(q)) {
        const m = /query=([^&]+)/.exec(q);
        q = m ? unquote(m[1]) : q;
        const m2 = /\/details\/([^/?#]+)/.exec(q);
        if (m2)
            q = `identifier:(${m2[1]})`;
    }
    if (q.includes('@') && !q.includes(':'))
        q = `uploader:(${q})`;
    else if (!q.includes(':'))
        q = `(${q}) OR creator:("${q}") OR uploader:(${q})`;
    if (!q.includes('mediatype'))
        q = `(${q}) AND mediatype:(software)`;
    const r = await session.get(withParams('https://archive.org/advancedsearch.php', {
        q, 'fl[]': ['identifier', 'title', 'creator', 'uploader', 'item_size', 'files_count', 'subject', 'downloads'],
        rows, 'sort[]': 'downloads desc', output: 'json',
    }), { timeout: 30_000 });
    if (r.status >= 400)
        throw new http.HttpError(`HTTP ${r.status}`, r.status);
    const data = await r.json();
    const out: any[] = [];
    for (const d of data.response.docs) {
        let subj = d.subject || [];
        subj = Array.isArray(subj) ? subj.join('; ') : String(subj);
        const title = first(d.title) || d.identifier;
        const fc = Number(d.files_count || 0);
        const size = Number(d.item_size || 0);
        const sysid = guessSystem(title, subj, d.identifier);
        const pack = fc >= 8 && size / Math.max(fc, 1) > 4_000_000;
        out.push({
            identifier: d.identifier, title, creator: first(d.creator), uploader: first(d.uploader), size, files: fc, subject: subj.slice(0, 120),
            downloads: Number(d.downloads || 0), system: sysid || (!pack ? 'pc' : ''), suggest: pack ? 'archive_item' : 'archive_game',
        });
    }
    return out;
}

export async function resolveArchiveUser(session: http.Session, handle: string): Promise<any | null> {
    handle = strip(handle.replace(/^@+/, ''), '/');
    if (!handle)
        return null;
    let hits: any[] = [];
    let total = 0;
    try {
        const r = await session.get(withParams('https://archive.org/services/search/beta/page_production/', {
            user_query: '', page_type: 'account_details', page_target: '@' + handle, hits_per_page: 10, page: 1,
            sort: 'downloads:desc', page_elements: '["uploads"]',
        }), { timeout: 25_000 });
        const up = (await r.json()).response.body.page_elements.uploads.hits;
        hits = (up.hits || []).map((h: any) => h.fields);
        total = Number(up.total || 0);
    }
    catch {
        return null;
    }
    if (!hits.length)
        return null;
    let email = '';
    for (const h of hits.slice(0, 3)) {
        try {
            const md = (await session.getJson(`https://archive.org/metadata/${h.identifier}/metadata`, { timeout: 20_000 })).result || {};
            email = md.uploader || '';
            if (email)
                break;
        }
        catch {
            continue;
        }
    }
    if (!email)
        return null;
    return { uploader: email, screenname: handle, total, sample: hits.slice(0, 5).map((h: any) => h.title || h.identifier) };
}

async function inspectItem(session: http.Session, identifier: string, cache?: Cache | null): Promise<any | null> {
    let md: any;
    try {
        md = cache ? await cache.getJson(`ia_meta_${identifier}`, `https://archive.org/metadata/${identifier}`, FILES_TTL)
            : await session.getJson(`https://archive.org/metadata/${identifier}`, { timeout: 30_000 });
    }
    catch {
        return null;
    }
    const files = md.files || [];
    let rom = 0, pc = 0;
    const systems: Record<string, number> = {};
    const meta = md.metadata || {};
    const title = first(meta.title) || identifier;
    let subj = meta.subject || '';
    subj = Array.isArray(subj) ? subj.join(' ') : String(subj);
    const itemSys = guessSystem(title, identifier, subj);
    for (const f of files) {
        const name = String(f.name || '');
        if (f.source === 'metadata' || name.startsWith('__ia') || ['Metadata', 'Item Tile', 'Archive BitTorrent'].includes(f.format))
            continue;
        const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
        const size = Number(f.size || 0);
        if (ROM_EXT_FULL.test(ext) && size > 200_000) {
            rom++;
            const sid = guessSystem(name, title, identifier);
            if (sid)
                systems[sid] = (systems[sid] || 0) + 1;
        }
        else if (['7z', 'zip', 'rar', 'exe', '001'].includes(ext) && size > 5_000_000) {
            const sid = guessSystem(name) || (itemSys !== 'pc' ? itemSys : '');
            if (sid && sid !== 'pc') {
                rom++;
                systems[sid] = (systems[sid] || 0) + 1;
            }
            else {
                pc++;
            }
        }
    }
    const keys = Object.keys(systems);
    const sid = keys.length ? keys.reduce((a, b) => (systems[a] >= systems[b] ? a : b)) : (guessSystem(title, identifier) || '');
    return { count_rom: rom, count_pc: pc, system: sid };
}

export const HYDRA_SIZE_RE = /([\d.,]+)\s*(TB|GB|MB|KB|B)/i;
export const HYDRA_JUNK_RE = /\s*(free download|\(build \d+\)|\[.*?\]|\(v?[\d.]+[^)]*\)|v\.?\d+(\.\d+)+\S*|\+\s*\d+\s*dlcs?|multi\d+|repack|fitgirl|dodi|elamigos|goldberg|-\s*(codex|rune|tenoke|razor1911|skidrow|plaza|empress|flt)\b)/gi;

export function hydraSize(s: any): number {
    if (typeof s === 'number')
        return Math.trunc(s);
    const m = HYDRA_SIZE_RE.exec(String(s || ''));
    if (!m)
        return 0;
    const n = parseFloat(strip(m[1].replace(/,/g, '.').replace(/[^\d.]/g, ''), '.') || '0');
    if (!Number.isFinite(n))
        return 0;
    const mult: Record<string, number> = { tb: 2 ** 40, gb: 2 ** 30, mb: 2 ** 20, kb: 2 ** 10, b: 1 };
    return Math.trunc(n * mult[m[2].toLowerCase()]);
}

async function htmlRelease(self: Provider, repo: string): Promise<any> {
    const key = `gh_html_${repo}`;
    const cached = self.cache.getLocal(key, 6 * 3600);
    if (cached)
        return cached;
    const empty = { assets: [] };
    let tag = '';
    let page = '';
    try {
        const r = await self.s.request(`https://github.com/${repo}/releases/latest`, { method: 'HEAD', timeout: 20_000, redirect: 'manual' });
        const loc = r.headers.get('location') || '';
        const m = /\/releases\/tag\/(.+)$/.exec(loc);
        if (!m)
            return empty;
        tag = unquote(m[1]);
        page = await self.s.getText(`https://github.com/${repo}/releases/expanded_assets/${encodeURIComponent(tag)}`, { timeout: 25_000 });
    }
    catch {
        return empty;
    }
    const assets: any[] = [];
    for (const block of page.split(/<li\b/).slice(1)) {
        const h = /href="(\/[^"]+\/releases\/download\/[^"]+)"/.exec(block);
        if (!h)
            continue;
        const name = unquote(h[1].split('/').pop()!);
        const sz = /([\d.,]+)\s*(TB|GB|MB|KB|Bytes|B)\b/.exec(block);
        const size = sz && sz[2] !== 'Bytes' ? hydraSize(`${sz[1]} ${sz[2][0]}B`) : (sz ? Math.trunc(parseFloat(sz[1])) : 0);
        assets.push({ name, browser_download_url: 'https://github.com' + h[1], size });
    }
    const when = /datetime="(\d{4}-\d\d-\d\d)/.exec(page);
    const data = { tag_name: tag, published_at: when ? when[1] : '', assets };
    if (assets.length)
        self.cache.putLocal(key, data);
    return data;
}

async function githubFiles(self: Provider, entry: Entry): Promise<FileRef[]> {
    if (entry.files_loaded)
        return entry.files.map((f) => ({ ...f }));
    const repo = entry.extra.repo;
    let data: any;
    try {
        let rels = await self.cache.getJson(`gh_${repo}`, GithubProvider.API.replace('{repo}', repo), 6 * 3600);
        rels = Array.isArray(rels) ? rels.filter((r: any) => !r.draft) : [];
        data = rels.find((r: any) => !r.prerelease) || (rels.length ? rels[0] : { assets: [] });
    }
    catch {
        data = await htmlRelease(self, repo);
    }
    let pat: RegExp;
    try {
        pat = new RegExp(entry.extra.asset || '.', 'i');
    }
    catch {
        pat = /./;
    }
    let assets: any[] = (data.assets || []).filter((a: any) => pat.test(a.name));
    assets = assets.filter((a: any) => !/\.(sha\d*|md5|sig|asc|txt|json|yml|yaml)$|provenance/i.test(a.name)).length
        ? assets.filter((a: any) => !/\.(sha\d*|md5|sig|asc|txt|json|yml|yaml)$|provenance/i.test(a.name)) : assets;
    const noJunk = assets.filter((a: any) => !/symbols|pdb|dbg|debug|arm64|linux|mac|\.dmg|appimage|source/i.test(a.name));
    assets = noJunk.length ? noJunk : assets;
    if (assets.length > 1 && entry.kind === 'recomp') {
        const arch = assets.filter((a: any) => /\.(zip|7z|rar)$/i.test(a.name));
        const pool = arch.length ? arch : assets;
        assets = [pool.reduce((best: any, a: any) => (a.name.length < best.name.length || (a.name.length === best.name.length && a.name < best.name) ? a : best))];
    }
    const refs = assets.map((a: any) => fileRef(a.name, a.browser_download_url, Number(a.size || 0)));
    entry.files = refs.map((r) => ({ ...r }));
    entry.files_loaded = true;
    entry.year = entry.year || String(data.published_at || '').slice(0, 4);
    if (data.tag_name)
        entry.extra.version = data.tag_name;
    return refs;
}

export class GithubProvider extends Provider {
    static API = 'https://api.github.com/repos/{repo}/releases?per_page=5';

    async catalog(_force = false): Promise<Entry[]> {
        const items: any[] = this.cfg.items || [this.cfg];
        const out: Entry[] = [];
        for (const it of items) {
            const repo = String(it.repo);
            const ident = repo.replace(/\//g, '__');
            out.push(makeEntry({
                key: `${this.id}:${ident}`, repo: this.id, id: ident, title: it.title || repo.split('/')[1],
                kind: it.kind ?? this.kind, system: it.system ?? this.system,
                creator: it.creator || repo.split('/')[0], year: String(it.year ?? ''),
                description: it.description || '', cover: it.cover || '', thumb: it.cover || '',
                genres: it.genres || [], tags: it.tags || [], page_url: `https://github.com/${repo}`,
                extra: { repo, asset: it.asset ?? 'win.*x64|x64.*win|windows|win64', needs: it.needs || '', exe: it.exe || '', requires_rom: it.requires_rom || '' },
            }));
        }
        return out;
    }

    async files(entry: Entry): Promise<FileRef[]> {
        return githubFiles(this, entry);
    }
}

export class ManifestProvider extends Provider {
    async load(force: boolean): Promise<any> {
        const src = String(this.cfg.url);
        if (/^https?:\/\//.test(src)) {
            const key = `manifest_${this.id}`;
            if (force)
                this.cache.drop(key);
            try {
                return await this.cache.getJson(key, src, CATALOG_TTL);
            }
            catch (e: any) {
                const st = Number(e?.status || 0);
                const body = String(e?.message || '').toLowerCase();
                if ((st === 403 || st === 503) && (body.includes('just a moment') || body.includes('cloudflare') || body.includes('cf-')))
                    throw new Error('Esse site bloqueia downloads fora do navegador (proteção Cloudflare). '
                        + 'Abra o link no navegador, salve o .json e adicione a fonte apontando pro arquivo salvo '
                        + '(Fontes → Manual → campo URL aceita um caminho local).');
                throw e;
            }
        }
        const p = path.isAbsolute(src) ? src : path.join(P.ROOT, src);
        if (!fs.existsSync(p)) {
            const err: any = new Error(`Arquivo não encontrado: ${p}`);
            err.code = 'ENOENT';
            err.path = p;
            throw err;
        }
        return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
    }

    async catalog(force = false): Promise<Entry[]> {
        const data = await this.load(force);
        const systems = (() => { try { return require('./presets').systems(); } catch { return {}; } })();
        const rep = validateManifest(data, systems);
        this.report = { ...rep, summary: reportSummary(rep), at: Date.now() / 1000 };
        if (rep.format === 'unknown')
            throw new Error(rep.errors.map((x) => `${x.at}: ${x.msg}`).join('; ') || 'JSON sem lista de jogos');
        if (data && typeof data === 'object' && 'downloads' in data && !('games' in data))
            return this.hydra(data);
        const skip = new Set(rep.skipped);
        const out: Entry[] = [];
        for (let gi = 0; gi < (data.games || []).length; gi++) {
            const g = data.games[gi];
            if (skip.has(gi))
                continue;
            const ident = (typeof g.id === 'string' && g.id.trim()) || strip(String(g.title).toLowerCase().replace(/[^a-z0-9]+/g, '-'), '-');
            const gh = strip(String(g.github || '').trim(), '/');
            if (gh && /^[\w.-]+\/[\w.-]+$/.test(gh)) {
                out.push(makeEntry({
                    key: `${this.id}:${ident}`, repo: this.id, id: ident, title: g.title,
                    kind: g.kind || data.kind || this.kind, system: g.system || data.system || this.system,
                    creator: g.creator || gh.split('/')[0], year: String(g.year ?? ''),
                    description: g.description || '', cover: g.cover || '', thumb: g.thumb || g.cover || '',
                    genres: g.genres || [], tags: g.tags || [], page_url: g.page_url || `https://github.com/${gh}`,
                    extra: { repo: gh, asset: g.asset ?? 'win.*x64|x64.*win|windows|win64', needs: g.needs || '',
                        exe: g.exe || '', requires_rom: g.requires_rom || '', patches: [], hoster: 'github.com', prefer: '' },
                }));
                continue;
            }
            const files = (Array.isArray(g.files) ? g.files : []).filter((f: any) => f && typeof f === 'object' && typeof f.url === 'string').map((f: any) => fileRef(typeof f.name === 'string' && f.name.trim() ? f.name : String(f.url).split('/').pop()!.split('?')[0] || 'download', f.url, Math.max(0, sizeOf(f.size)), typeof f.sha256 === 'string' && /^[0-9a-fA-F]{64}$/.test(f.sha256) ? f.sha256.toLowerCase() : ''));
            const patches = (Array.isArray(g.patches) ? g.patches : []).filter((x: any) => x && typeof x === 'object' && x.url).map((x: any) => ({
                name: String(x.name || String(x.url || '').split('/').pop()), url: x.url, size: Number(x.size || 0), note: String(x.note || ''),
            }));
            const kind = g.kind || data.kind || this.kind;
            let system = g.system || data.system || this.system;
            if (kind === 'rom' && (!system || system === 'pc'))
                system = extSystem(...files.map((f: FileRef) => f.name)) || guessSystem(g.title, (g.tags || []).join(' '), ...files.map((f: FileRef) => f.name)) || 'pc';
            out.push(makeEntry({
                key: `${this.id}:${ident}`, repo: this.id, id: ident, title: g.title, kind, system,
                creator: g.creator || g.developer || '', year: String(g.year ?? ''), size: Math.max(0, sizeOf(g.size)) || files.reduce((s: number, f: FileRef) => s + f.size, 0),
                description: g.description || '', cover: g.cover || '', thumb: g.thumb || g.cover || '',
                genres: g.genres || [], tags: g.tags || [], page_url: g.page_url || '',
                magnet: typeof g.magnet === 'string' ? g.magnet : '', torrent_url: typeof g.torrent === 'string' ? g.torrent : '', files, files_loaded: true,
                extra: { exe: g.exe || '', patches, hoster: String(g.host || ''), prefer: String(g.prefer || ''), hero: typeof g.hero === 'string' ? g.hero : '', version: typeof g.version === 'string' || typeof g.version === 'number' ? String(g.version).trim() : '' },
            }));
        }
        return sortTitle(out);
    }

    async files(entry: Entry): Promise<FileRef[]> {
        if (entry.files_loaded || !entry.extra.repo)
            return entry.files.map((f) => ({ ...f }));
        return githubFiles(this, entry);
    }

    hydra(data: any): Entry[] {
        const out: Entry[] = [];
        const seen = new Set<string>();
        for (const d of data.downloads || []) {
            if (!d || typeof d !== 'object')
                continue;
            const raw = String(d.title || '').trim();
            const uris: string[] = (d.uris || []).filter((u: any) => typeof u === 'string');
            if (!raw || !uris.length)
                continue;
            let title = raw.replace(HYDRA_JUNK_RE, '');
            title = strip(title.replace(/\s{2,}/g, ' '), ' -–:,');
            if (!title)
                title = raw;
            const ident = strip(title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), '-').slice(0, 90);
            if (seen.has(ident))
                continue;
            seen.add(ident);
            const magnet = uris.find((u) => u.startsWith('magnet:')) || '';
            const httpU = uris.filter((u) => u.startsWith('http'));
            const direct = httpU.filter((u) => /\.(7z|zip|rar|001|exe|iso)(\?|$)/i.test(u));
            const files = direct.map((u) => fileRef(u.split('/').pop()!.split('?')[0] || 'download', u, 0));
            const yr = /\((19|20)\d{2}\)/.exec(raw);
            let fsize = d.fileSize ?? '';
            if (!(typeof fsize === 'string' || typeof fsize === 'number'))
                fsize = '';
            out.push(makeEntry({
                key: `${this.id}:${ident}`, repo: this.id, id: ident, title, kind: this.kind !== 'rom' ? this.kind : 'pc', system: 'pc',
                year: yr ? yr[0].slice(1, -1) : '', size: hydraSize(fsize),
                description: '', page_url: (httpU.length && !direct.length ? httpU[0] : String(d.repackLinkSource || '')) || '',
                magnet, files, files_loaded: true, tags: data.name ? [data.name] : [],
                extra: { uploaded: String(d.uploadDate || ''), hoster: httpU.length && httpU[0].slice(8).includes('/') ? httpU[0].split('/')[2] : (magnet ? 'torrent' : ''), raw_title: raw },
            }));
        }
        return sortTitle(out);
    }
}

function walk(dir: string, out: string[] = []): string[] {
    let ents: fs.Dirent[] = [];
    try {
        ents = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return out;
    }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory())
            walk(p, out);
        else if (e.isFile())
            out.push(p);
    }
    return out;
}

export class LocalFolderProvider extends Provider {
    async catalog(_force = false): Promise<Entry[]> {
        const folder = String(this.cfg.path || '');
        let st: fs.Stats;
        try {
            st = fs.statSync(folder);
        }
        catch {
            return [];
        }
        if (!st.isDirectory())
            return [];
        const out: Entry[] = [];
        for (const f of walk(folder)) {
            const ext = path.extname(f).toLowerCase().replace(/^\./, '');
            const isRom = ROM_EXT_FULL.test(ext);
            if (!isRom && ext !== 'exe')
                continue;
            const stem = path.basename(f, path.extname(f));
            if (ext === 'bin' && fs.existsSync(f.slice(0, -path.extname(f).length) + '.cue'))
                continue;
            if (ext === 'exe' && /unins|setup|redist|vcredist|dxsetup|crash/i.test(stem))
                continue;
            const title = stem.replace(/\s*[\(\[].*?[\)\]]/g, '').replace(/_/g, ' ').trim() || stem;
            const fid = stem.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 80);
            const sid = guessSystem(path.basename(path.dirname(f)), path.basename(f)) || this.system || (!isRom ? 'pc' : '');
            const size = fs.statSync(f).size;
            out.push(makeEntry({
                key: `${this.id}:${fid}`, repo: this.id, id: fid, title, kind: isRom ? 'rom' : 'pc', system: isRom ? sid : 'pc',
                size, files: [fileRef(path.basename(f), pathToFileURL(f).href, size)], files_loaded: true,
                extra: { local_path: f },
            }));
        }
        return sortTitle(out);
    }
}

const HARD_HOSTS = ['archive.org', 'mega.nz', 'mega.co.nz', 'mediafire.com', 'gofile.io', '1fichier.com', 'rapidgator.net', 'uploaded.net',
    'turbobit.net', 'nitroflare.com', 'drive.google.com', 'docs.google.com', 'dropbox.com', 'onedrive.live.com', '1drv.ms',
    'pixeldrain.com', 'buzzheavier.com', 'datanodes.to', 'qiwi.gg', 'anonfiles.com', 'krakenfiles.com', 'filecrypt.cc',
    'ouo.io', 'linkvertise.com', 'shrinkme.io', 'torrentgalaxy', '1337x.to', 'thepiratebay'];
const GAME_FILE_RE = /\.(7z|zip|rar|001|iso|exe|msi|chd|rvz|wbfs|nsp|xci|pbp|cso|z64|n64|nds|gba|gb|gbc|sfc|smc|nes|md|gen|gcm|cue|bin|img|3ds|cci)(\?|#|$)/i;
const TORRENT_RE = /^magnet:\?|\.torrent(\?|#|$)/i;
const HREF_RE = /<a\b[^>]*?href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
const PAGE_JUNK_RE = /\b(download|baixar|free|grátis|gratis|torrent|magnet|direct|direto|link|mirror|espelho|clique aqui|click here|aqui|here|parte?\s*\d+|part\s*\d+|google drive|mega|mediafire|servidor \d+|server \d+)\b/gi;

function hostOf(u: string): string {
    const m = /^https?:\/\/([^/:?#]+)/i.exec(u);
    return (m ? m[1] : '').toLowerCase();
}

export function isHardHost(u: string): boolean {
    const h = hostOf(u);
    return HARD_HOSTS.some((x) => h === x || h.endsWith('.' + x) || h.includes(x));
}

function titleFrom(text: string, url: string, pageTitle = ''): string {
    let t = cleanHtml(text).trim();
    t = strip(t.replace(PAGE_JUNK_RE, ''), ' -–:|·[]()');
    if (t.length < 3 || /^[\W\d_]+$/.test(t))
        t = pageTitle;
    if (t.length < 3) {
        const base = unquote(strip(url.split('?')[0], '/').split('/').pop() || '');
        t = base.replace(/\.(7z|zip|rar|001|iso|exe|msi|torrent)$/i, '').replace(/_/g, ' ').replace(/\./g, ' ').replace(/-/g, ' ').trim();
    }
    t = t.replace(HYDRA_JUNK_RE, '');
    return strip(t.replace(/\s{2,}/g, ' '), ' -–:,').slice(0, 120);
}

export async function analyzePage(session: http.Session, url: string, depth = 1, limitPages = 40): Promise<any> {
    const seenPages = new Set<string>();
    const games: Record<string, any> = {};
    const hard: string[] = [];
    const titles: Record<string, string> = {};
    const stats = { direct: 0, torrent: 0, pages: 0 };

    const grab = async (pageUrl: string): Promise<Array<[string, string]>> => {
        if (seenPages.has(pageUrl) || seenPages.size > limitPages)
            return [];
        seenPages.add(pageUrl);
        const r = await session.get(pageUrl, { timeout: 25_000, headers: { Accept: 'text/html,*/*' } });
        if (r.status >= 400)
            throw new http.HttpError(`HTTP ${r.status}`, r.status);
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('html') && !ct.includes('text'))
            return [];
        stats.pages++;
        const body = (await r.text()).slice(0, 3_000_000);
        const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(body) || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
        if (m)
            titles[pageUrl] = strip(cleanHtml(m[1]).split(' | ')[0].split(' – ')[0].split(' - ')[0].replace(PAGE_JUNK_RE, '').replace(HYDRA_JUNK_RE, ''), ' -–:,').slice(0, 120);
        const out: Array<[string, string]> = [];
        for (const mm of body.matchAll(HREF_RE)) {
            const href = http.decodeHtmlEntities(mm[1].trim());
            if (href.startsWith('javascript:') || href.startsWith('mailto:'))
                continue;
            let abs = href;
            if (!href.startsWith('magnet:')) {
                try {
                    abs = new URL(href, pageUrl).toString();
                }
                catch {
                    continue;
                }
            }
            out.push([abs, mm[2]]);
        }
        return out;
    };

    const add = (title: string, u: string, pageUrl: string) => {
        const key = strip(title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), '-') || hostOf(u);
        const g = games[key] ||= { title, files: [], magnet: '', torrent_url: '', page_url: pageUrl, host: hostOf(u) };
        if (u.startsWith('magnet:')) {
            g.magnet = g.magnet || u;
            stats.torrent++;
        }
        else if (TORRENT_RE.test(u)) {
            g.torrent_url = g.torrent_url || u;
            stats.torrent++;
        }
        else {
            if (g.files.some((f: FileRef) => f.url === u))
                return;
            g.files.push(fileRef(unquote(u.split('?')[0].split('/').pop() || '') || 'download', u, 0));
            stats.direct++;
        }
    };

    const scan = (pageUrl: string, links: Array<[string, string]>): string[] => {
        const subs: string[] = [];
        const baseHost = hostOf(pageUrl);
        for (const [href, text] of links) {
            if (TORRENT_RE.test(href) || GAME_FILE_RE.test(href)) {
                if (!href.startsWith('magnet:') && isHardHost(href)) {
                    hard.push(href);
                    continue;
                }
                add(titleFrom(text, href, pageUrl !== url ? (titles[pageUrl] || '') : ''), href, pageUrl);
            }
            else if (depth && hostOf(href) === baseHost && href !== pageUrl && !/\.(css|js|png|jpe?g|gif|webp|svg|ico|xml|rss)(\?|$)/i.test(href)) {
                const t = cleanHtml(text).trim();
                if (t.length >= 4 && t.length <= 90 && !/^(home|início|inicio|login|entrar|contato|sobre|about|next|prev|anterior|próxim|\d+)$/i.test(t))
                    subs.push(href);
            }
        }
        return subs;
    };

    const links = await grab(url);
    const subs = scan(url, links);
    if (depth && Object.keys(games).length < 3 && subs.length) {
        const uniq = [...new Set(subs)].slice(0, limitPages);
        const got = await pmap(uniq, 8, async (u) => {
            try {
                return await grab(u);
            }
            catch {
                return [] as Array<[string, string]>;
            }
        });
        uniq.forEach((sub, i) => scan(sub, got[i]));
    }
    const out = Object.values(games).filter((g: any) => g.files.length || g.magnet || g.torrent_url);
    out.sort((a: any, b: any) => (a.title.toLowerCase() < b.title.toLowerCase() ? -1 : a.title.toLowerCase() > b.title.toLowerCase() ? 1 : 0));
    return { games: out, hard: hard.slice(0, 50), hard_count: hard.length, ...stats };
}

export class WebPageProvider extends Provider {
    async catalog(force = false): Promise<Entry[]> {
        const key = `webpage_${this.id}`;
        const cacheFile = path.join(P.CACHE_WEB, `${key}.json`);
        let data: any = null;
        if (!force && fs.existsSync(cacheFile) && Date.now() / 1000 - fs.statSync(cacheFile).mtimeMs / 1000 < CATALOG_TTL) {
            try {
                data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            }
            catch {
                data = null;
            }
        }
        if (data == null) {
            data = await analyzePage(this.s, String(this.cfg.url), Number(this.cfg.depth ?? 1));
            fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
            fs.writeFileSync(cacheFile, JSON.stringify(data), 'utf8');
        }
        const out: Entry[] = [];
        for (const g of data.games || []) {
            const ident = strip(String(g.title).toLowerCase().replace(/[^a-z0-9]+/g, '-'), '-').slice(0, 90) || 'jogo';
            const sid = this.kind === 'rom' ? guessSystem(g.title) : 'pc';
            const yr = /\b(19[89]\d|20[0-3]\d)\b/.exec(g.title);
            out.push(makeEntry({
                key: `${this.id}:${ident}`, repo: this.id, id: ident, title: g.title, kind: this.kind, system: sid || this.system,
                year: yr ? yr[1] : '', page_url: g.page_url || '', magnet: g.magnet || '', torrent_url: g.torrent_url || '',
                files: (g.files || []).map((f: any) => fileRef(f.name, f.url, f.size)), files_loaded: true, extra: { hoster: g.host || '' },
            }));
        }
        return out;
    }
}

export const SYSTEM_IDS = new Set(['ps1', 'ps2', 'ps3', 'psp', 'psvita', 'n64', 'gc', 'wii', 'wiiu', 'switch', 'nds', '3ds', 'gba', 'gb', 'gbc', 'snes', 'nes', 'md',
    'saturn', 'dc', 'xbox', 'x360', 'dos', 'arcade', 'pc']);

export class TelegramProvider extends Provider {
    static API = 'https://api.telegram.org/bot{token}/{method}';
    static TORRENT_DIR = () => path.join(P.CACHE_WEB, 'torrents');

    async call(method: string, params: Record<string, any> = {}): Promise<any> {
        const r = await this.s.get(withParams(TelegramProvider.API.replace('{token}', this.cfg.token).replace('{method}', method), params), { timeout: 40_000 });
        const data = await r.json();
        if (!data.ok)
            throw new Error(`Telegram: ${data.description || r.status}`);
        return data.result;
    }

    stateFile(): string {
        return path.join(P.CACHE_WEB, `tg_${this.id.replace(/[^a-z0-9_-]/g, '_')}.json`);
    }

    load(): any {
        const f = this.stateFile();
        try {
            return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { offset: 0, posts: {}, chat_id: null, title: '' };
        }
        catch {
            return { offset: 0, posts: {}, chat_id: null, title: '' };
        }
    }

    save(st: any) {
        const f = this.stateFile();
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, JSON.stringify(st), 'utf8');
    }

    matchesChat(chat: any): boolean {
        let want = String(this.cfg.chat || '').trim();
        if (!want || want.startsWith('https://t.me/+') || want.startsWith('t.me/+') || want.startsWith('+'))
            return true;
        want = want.replace(/^@+/, '').toLowerCase();
        return String(chat.id) === want || String(chat.username || '').toLowerCase() === want || String(chat.title || '').toLowerCase() === want;
    }

    async pull(st: any): Promise<boolean> {
        let changed = false;
        for (let i = 0; i < 20; i++) {
            const ups = await this.call('getUpdates', { offset: st.offset || undefined, limit: 100, timeout: 0, allowed_updates: JSON.stringify(['channel_post', 'edited_channel_post']) });
            if (!ups || !ups.length)
                break;
            for (const u of ups) {
                st.offset = u.update_id + 1;
                const msg = u.channel_post || u.edited_channel_post;
                if (!msg || !this.matchesChat(msg.chat || {}))
                    continue;
                st.chat_id = msg.chat.id;
                st.title = msg.chat.title || st.title || '';
                const doc = msg.document || {};
                const name = doc.file_name || '';
                if (!name.toLowerCase().endsWith('.torrent'))
                    continue;
                const cap = String(msg.caption || '').trim();
                const firstLine = cap.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || name.replace(/\.torrent$/i, '');
                const title = firstLine.replace(/\s*#\w+/g, '').trim() || name;
                const tags = [...cap.matchAll(/#(\w+)/g)].map((m) => m[1]);
                const photo = msg.photo || [];
                st.posts[String(msg.message_id)] = {
                    title, caption: cap, file_id: doc.file_id, file_name: name, size: doc.file_size || 0,
                    date: msg.date || 0, tags, photo: photo.length ? photo[photo.length - 1].file_id : '',
                    link: `https://t.me/c/${String(msg.chat.id).replace('-100', '')}/${msg.message_id}`,
                };
                changed = true;
            }
            if (ups.length < 100)
                break;
        }
        return changed;
    }

    async fileUrl(fileId: string): Promise<string> {
        const info = await this.call('getFile', { file_id: fileId });
        return `https://api.telegram.org/file/bot${this.cfg.token}/${info.file_path}`;
    }

    async torrentPath(mid: string, post: any): Promise<string> {
        const dir = TelegramProvider.TORRENT_DIR();
        fs.mkdirSync(dir, { recursive: true });
        const p = path.join(dir, `${this.id.replace(/[^a-z0-9_-]/g, '_')}_${mid}.torrent`);
        if (!fs.existsSync(p) || fs.statSync(p).size === 0) {
            const r = await this.s.get(await this.fileUrl(post.file_id), { timeout: 60_000 });
            if (r.status >= 400)
                throw new http.HttpError(`HTTP ${r.status}`, r.status);
            const buf = Buffer.from(await r.arrayBuffer());
            if (buf[0] !== 0x64)
                throw new Error('O arquivo do post não é um .torrent válido');
            fs.writeFileSync(p, buf);
        }
        return p;
    }

    async catalog(_force = false): Promise<Entry[]> {
        const st = this.load();
        try {
            await this.pull(st);
            this.save(st);
        }
        catch (e) {
            if (!Object.keys(st.posts).length)
                throw e;
            log.warn('telegram %s: %s (usando cache)', this.id, e);
        }
        const out: Entry[] = [];
        const posts = Object.entries(st.posts as Record<string, any>).sort((a, b) => (Number(b[1].date || 0) - Number(a[1].date || 0)));
        for (const [mid, p] of posts) {
            let sid = 'pc';
            if (this.kind === 'rom')
                sid = (p.tags || []).map((t: string) => t.toLowerCase()).find((t: string) => SYSTEM_IDS.has(t)) || guessSystem(p.title, p.caption || '') || this.system;
            const yr = /\b(19[89]\d|20[0-3]\d)\b/.exec(p.caption || '');
            out.push(makeEntry({
                key: `${this.id}:${mid}`, repo: this.id, id: mid, title: p.title, kind: this.kind, system: sid,
                year: yr ? yr[1] : '', size: Number(p.size || 0), description: p.caption || '',
                page_url: p.link || '', torrent_url: `tg:${mid}`, files: [], files_loaded: true,
                tags: p.tags || [], extra: { telegram: true, photo: p.photo || '', posted: Number(p.date || 0) },
            }));
        }
        return out;
    }

    async resolveTorrent(entry: Entry): Promise<string> {
        const st = this.load();
        const p = st.posts[entry.id];
        if (!p)
            throw new Error('Post não encontrado no cache do canal');
        return this.torrentPath(entry.id, p);
    }

    async thumbUrl(entry: Entry): Promise<string> {
        const fid = (entry.extra || {}).photo;
        if (!fid)
            return '';
        try {
            return await this.fileUrl(fid);
        }
        catch {
            return '';
        }
    }

    async test(): Promise<any> {
        const me = await this.call('getMe');
        const st = this.load();
        await this.pull(st);
        this.save(st);
        return { bot: me.username, posts: Object.keys(st.posts).length, chat: st.title || '' };
    }
}

export const PROVIDERS: Record<string, new (cfg: any, s: http.Session, c: Cache) => Provider> = {
    telegram: TelegramProvider,
    webpage: WebPageProvider,
    local_folder: LocalFolderProvider,
    archive_uploader: ArchiveProvider,
    archive_creator: ArchiveProvider,
    archive_search: ArchiveProvider,
    archive_item: ArchiveItemProvider,
    github_release: GithubProvider,
    manifest: ManifestProvider,
};

export function packResults(data: any, src: string): any {
    if (!data || typeof data !== 'object' || Array.isArray(data))
        return { kind: 'none', results: [] };
    const fallback = strip(src, '/').split('/').pop()!.split('?')[0].replace('.json', '');
    const name = String(data.name || fallback);
    const results: any[] = [];
    const kinds = new Set<string>();
    for (const cfg of data.sources || []) {
        if (!cfg || typeof cfg !== 'object' || !(cfg.type in PROVIDERS) || cfg.type === 'manifest' || cfg.type === 'local_folder')
            continue;
        const c: any = { ...cfg };
        c.name ??= name;
        c.kind ??= data.kind ?? 'pc';
        c.system ??= data.system ?? (c.kind !== 'rom' ? 'pc' : '');
        kinds.add(c.kind);
        results.push({ title: c.name, detail: String(c.note || c.type), kind: c.kind, count_pc: 0, count_rom: 0, cfg: c });
    }
    let n = 0;
    let fmt = '';
    if (Array.isArray(data.downloads)) {
        n = data.downloads.length;
        fmt = 'hydra';
    }
    else if (Array.isArray(data.games)) {
        n = data.games.length;
        fmt = 'manifest';
    }
    if (n) {
        const kind = String(data.kind || 'pc');
        kinds.add(kind);
        const roms = fmt === 'manifest' ? data.games.filter((g: any) => g && typeof g === 'object' && (g.kind ?? kind) === 'rom').length : (kind === 'rom' ? n : 0);
        let systems: any = {};
        try {
            systems = require('./presets').systems();
        }
        catch { }
        const rep = validateManifest(data, systems);
        results.unshift({
            title: name, detail: `${rep.usable} de ${n} jogo${n === 1 ? '' : 's'} ok · lista ${fmt}` + (roms > 0 && roms < n ? ` · ${n - roms} PC + ${roms} ROMs` : ''), kind, count_pc: n - roms, count_rom: roms,
            report: { ...rep, summary: reportSummary(rep) },
            cfg: { type: 'manifest', url: src, name, kind, system: String(data.system || (kind !== 'rom' ? 'pc' : '')) },
        });
    }
    if (!results.length)
        return { kind: 'none', results: [] };
    const kind = kinds.size > 1 ? 'mixed' : (kinds.size ? [...kinds][0] : 'pc');
    return { kind, results, pack: name };
}

export async function detectSource(session: http.Session, q: string, cache?: Cache | null): Promise<any> {
    q = String(q || '').trim();
    if (!q)
        return { kind: 'none', results: [] };

    const mt = /^(\d{6,}:[A-Za-z0-9_-]{30,})\s*(.*)$/.exec(q);
    if (mt) {
        const token = mt[1];
        const chat = mt[2].trim();
        let r: any;
        try {
            r = await session.getJson(`https://api.telegram.org/bot${token}/getMe`, { timeout: 20_000 });
        }
        catch (e: any) {
            return { kind: 'none', results: [], error: `Não consegui falar com o Telegram: ${e?.message || e}` };
        }
        if (!r.ok)
            return { kind: 'none', results: [], error: `Token recusado pelo Telegram: ${r.description || ''}` };
        const bot = r.result.username || 'bot';
        const name = `Telegram · ${chat.replace(/^@+/, '') || bot}`;
        return { kind: 'pc', results: [{ title: name, detail: `bot @${bot} — lê os posts novos do canal com .torrent anexado (o bot precisa ser admin do canal)`,
            cfg: { type: 'telegram', name, token, chat, kind: 'pc', system: 'pc' }, telegram: true }] };
    }
    if (/^(https?:\/\/)?t\.me\//i.test(q))
        return { kind: 'none', results: [], error: 'Para ler um canal do Telegram é preciso um bot: cole o TOKEN do bot (do @BotFather), um espaço e o link do canal. Ex.: 123456:ABC… https://t.me/+xxxx' };

    let hk = '';
    try {
        hk = require('./hosts').knownHost(q) || '';
    }
    catch {
        hk = '';
    }
    if (hk)
        return { kind: 'none', results: [], link: q, host: hk };

    const isUrl = /^https?:\/\//.test(q);
    if (/\.json(\?|$)/i.test(q) || (!isUrl && path.extname(q).toLowerCase() === '.json')) {
        let data: any;
        try {
            if (isUrl)
                data = await session.getJson(q, { timeout: 30_000, headers: { Accept: 'application/json' } });
            else
                data = JSON.parse(fs.readFileSync(q, 'utf8').replace(/^\uFEFF/, ''));
        }
        catch (e: any) {
            let msg = String(e?.message || e);
            if (msg.includes('403') || msg.includes('Cloudflare'))
                msg = 'O site bloqueia apps (Cloudflare). Salve o .json pelo navegador e cole o caminho do arquivo.';
            return { kind: 'none', results: [], error: `Não consegui ler esse JSON: ${msg}` };
        }
        return packResults(data, q);
    }

    if (!isUrl && (/^[a-zA-Z]:[\\/]/.test(q) || q.startsWith('/') || q.startsWith('\\\\')) && fs.existsSync(q) && fs.statSync(q).isDirectory()) {
        let roms = 0, pcs = 0;
        const systems: Record<string, number> = {};
        for (const f of walk(q)) {
            const ext = path.extname(f).toLowerCase().replace(/^\./, '');
            if (ROM_EXT_FULL.test(ext)) {
                roms++;
                const sid = guessSystem(path.basename(path.dirname(f)), path.basename(f));
                if (sid)
                    systems[sid] = (systems[sid] || 0) + 1;
            }
            else if (ext === 'exe') {
                pcs++;
            }
        }
        if (!roms && !pcs)
            return { kind: 'none', results: [] };
        const keys = Object.keys(systems);
        const sid = keys.length ? keys.reduce((a, b) => (systems[a] >= systems[b] ? a : b)) : '';
        const kind = roms >= pcs ? 'rom' : 'pc';
        const name = path.basename(q);
        return { kind, results: [{ title: name, detail: `${roms} ROMs · ${pcs} executáveis`, kind, count_pc: pcs, count_rom: roms, system: sid,
            cfg: { type: 'local_folder', path: q, name, kind, system: sid } }] };
    }

    const m = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/.exec(q);
    if (m && !q.includes('archive.org') && (q.includes('github.com') || (q.includes('/') && !q.includes(' ')))) {
        const repo = `${m[1]}/${m[2]}`;
        let rels: any = [];
        try {
            rels = await session.getJson(`https://api.github.com/repos/${repo}/releases?per_page=3`, { timeout: 20_000 });
        }
        catch {
            rels = [];
        }
        if (Array.isArray(rels) && rels.length) {
            const assets = rels.flatMap((r: any) => r.assets || []);
            const win = assets.filter((a: any) => /win|x64|\.zip$|\.7z$|\.exe$/i.test(a.name));
            if (win.length)
                return { kind: 'pc', results: [{ title: repo, detail: `${rels.length} releases · ${win.length} arquivos Windows`, kind: 'pc', count_pc: 1, count_rom: 0,
                    cfg: { type: 'github_release', name: m[2], kind: 'recomp', items: [{ repo, title: m[2], asset: 'Windows', kind: 'recomp' }] } }] };
        }
        return { kind: 'none', results: [] };
    }

    if (isUrl && !q.includes('archive.org')) {
        let a: any;
        try {
            a = await analyzePage(session, q);
        }
        catch (e: any) {
            return { kind: 'none', results: [], error: `Não consegui abrir a página: ${e?.message || e}` };
        }
        const n = a.games.length;
        if (!n)
            return { kind: 'none', results: [], page: a, error: !a.hard_count ? '' :
                `A página tem ${a.hard_count} link(s) só de hosts de acesso difícil (captcha, login ou fila) — nada que o Ludrix baixe sozinho.` };
        let name = hostOf(q).replace('www.', '');
        let titleM: RegExpExecArray | null = null;
        try {
            const txt = await session.getText(q, { timeout: 15_000 });
            titleM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(txt.slice(0, 200000));
        }
        catch { }
        if (titleM)
            name = cleanHtml(titleM[1]).slice(0, 60) || name;
        const kinds = a.games.map((g: any) => guessSystem(g.title));
        const roms = kinds.filter((k: string) => k && k !== 'pc').length;
        const kind = roms > n / 2 ? 'rom' : 'pc';
        return { kind, page: { direct: a.direct, torrent: a.torrent, hard_count: a.hard_count, pages: a.pages }, games: a.games.slice(0, 200),
            results: [{ title: name, detail: `${n} jogos · ${a.direct} links diretos · ${a.torrent} torrents · ${a.hard_count} ignorados (acesso difícil)`,
                kind, count_pc: n - roms, count_rom: roms, site: false, cfg: { type: 'webpage', url: q, name, kind } }] };
    }

    const mu = /archive\.org\/details\/@([A-Za-z0-9_.-]+)/.exec(q) || /^@([A-Za-z0-9_.-]+)$/.exec(q);
    if (mu) {
        const u = await resolveArchiveUser(session, mu[1]);
        if (!u)
            return { kind: 'none', results: [], error: `Nenhum upload no perfil @${mu[1]} do archive.org.` };
        return { kind: 'pc', results: [{ title: `Tudo de @${u.screenname}`, detail: `${u.total} itens no archive.org · ex.: ${u.sample.slice(0, 3).join(', ')}`,
            kind: 'pc', count_pc: u.total, count_rom: 0, group: true,
            cfg: { type: 'archive_uploader', uploader: u.uploader, name: u.screenname, kind: 'pc' } }] };
    }

    let items: any[];
    try {
        items = await browseArchive(session, q, 40);
    }
    catch (e: any) {
        return { kind: 'none', results: [], error: String(e?.message || e) };
    }
    const results: any[] = [];
    const single = /\/details\/([^/?#]+)/.exec(q);
    if (single && items.length)
        items = items.filter((x) => x.identifier === single[1]).length ? items.filter((x) => x.identifier === single[1]) : items.slice(0, 1);
    items = items.slice(0, 24);
    const need = items.filter((it) => it.suggest === 'archive_item' || (single && items.length === 1)).map((it) => it.identifier);
    const inspected: Record<string, any> = {};
    if (need.length) {
        const res = await pmap(need, 8, (i) => inspectItem(session, i, cache));
        need.forEach((ident, i) => { inspected[ident] = res[i]; });
    }
    for (const it of items) {
        const r: any = { title: it.title, identifier: it.identifier, creator: it.creator || it.uploader || '', size: it.size, files: it.files };
        if (it.identifier in inspected) {
            const counts = inspected[it.identifier];
            if (!counts)
                continue;
            Object.assign(r, counts);
            if (counts.count_rom === 0 && counts.count_pc === 0)
                continue;
            const kind = counts.count_rom >= counts.count_pc ? 'rom' : 'pc';
            const sid = counts.system || it.system || '';
            r.kind = kind;
            r.system = kind === 'rom' ? sid : 'pc';
            r.detail = `${counts.count_rom} ROMs · ${counts.count_pc} arquivos de PC · ${human(it.size)}`;
            if (counts.count_rom + counts.count_pc === 1)
                r.cfg = { type: 'archive_search', query: `identifier:(${it.identifier})`, name: it.title, kind, system: r.system };
            else
                r.cfg = { type: 'archive_item', identifier: it.identifier, name: it.title, kind, system: r.system };
        }
        else {
            const sid = it.system || '';
            const kind = sid && sid !== 'pc' ? 'rom' : 'pc';
            Object.assign(r, { kind, system: sid || 'pc', count_pc: kind === 'pc' ? 1 : 0, count_rom: kind === 'rom' ? 1 : 0,
                detail: `1 jogo · ${it.files} arquivos · ${human(it.size)}`,
                cfg: { type: 'archive_search', query: `identifier:(${it.identifier})`, name: it.title, kind, system: sid || 'pc' } });
        }
        results.push(r);
    }
    if (!results.length)
        return { kind: 'none', results: [] };

    let creators: Record<string, number> = {};
    for (const it of items) {
        const c = it.creator || it.uploader;
        if (c)
            creators[c] = (creators[c] || 0) + 1;
    }
    let group: any = null;
    if (/^[^\s@]+@[^\s@]+\.[a-z]+$/i.test(q))
        creators = { [q]: Math.max(items.length, 4) };
    const ck = Object.keys(creators);
    if (ck.length) {
        const top = ck.reduce((a, b) => (creators[a] >= creators[b] ? a : b));
        const cnt = creators[top];
        if (cnt >= 4) {
            const nRom = results.filter((r) => r.kind === 'rom').length;
            const nPc = results.length - nRom;
            const kind = nRom > nPc ? 'rom' : 'pc';
            const typ = top.includes('@') ? 'archive_uploader' : 'archive_creator';
            group = { title: `Tudo de "${top}"`, detail: `${cnt}+ itens nessa busca · ${nPc} PC · ${nRom} ROM`, kind, count_pc: nPc, count_rom: nRom, group: true,
                cfg: { type: typ, [typ === 'archive_uploader' ? 'uploader' : 'creator']: top, name: top.split('@')[0], kind } };
        }
    }
    const nRom = results.filter((r) => r.kind === 'rom').length;
    const kind = nRom === results.length ? 'rom' : (nRom === 0 ? 'pc' : 'mixed');
    return { kind, results: (group ? [group] : []).concat(results) };
}

export class RepoRegistry {
    session: http.Session;
    cache: Cache;
    providers: Record<string, Provider> = {};
    userAdded = new Set<string>();
    static LEGACY_BUILTIN = new Set(['rohankar', 'recomps', 'emulators', 'fitgirl-arquivo', 'site-abandonwaregames', 'site-myabandonware-dos',
        'site-myabandonware-win', 'site-ankergames', 'site-cracked-games']);

    constructor(public store: any) {
        this.session = http.shared;
        this.cache = new Cache(this.session);
        this.reload();
    }

    get file(): string {
        return path.join(P.DATA, 'repos.json');
    }

    get stateFile(): string {
        return path.join(P.DATA, 'sources_state.json');
    }

    private state_: Record<string, any> | null = null;

    get state(): Record<string, any> {
        if (!this.state_) {
            this.state_ = util.readJson(this.stateFile, {});
            if (!this.state_ || typeof this.state_ !== 'object' || Array.isArray(this.state_))
                this.state_ = {};
        }
        return this.state_!;
    }

    saveState() {
        try {
            util.writeJson(this.stateFile, this.state);
        }
        catch (e) {
            log.warn('sources_state: %s', e);
        }
    }

    stateOf(id: string): any {
        return this.state[id] || null;
    }

    touch(id: string, keys: string[], titles: Record<string, string>, fromSource: boolean): string[] {
        const now = Math.floor(Date.now() / 1000);
        const prev = this.state[id];
        const seen = new Set<string>(prev?.keys || []);
        const fresh = prev && prev.keys ? keys.filter((k) => !seen.has(k)) : [];
        const oldNews: string[] = (prev?.news || []).filter((k: string) => keys.includes(k));
        const news = [...new Set([...oldNews, ...fresh])].slice(0, 500);
        const newsAt = fresh.length ? now : Number(prev?.news_at || 0);
        const entry: any = {
            checked_at: fromSource || !prev?.checked_at ? now : prev.checked_at,
            count: keys.length,
            keys: keys.slice(0, 20000),
            news: newsAt && now - newsAt > 14 * 86400 ? [] : news,
            news_at: newsAt,
            news_titles: Object.fromEntries(news.slice(0, 500).map((k) => [k, titles[k] || prev?.news_titles?.[k] || ''])),
        };
        for (const k of ['links', 'fetch_ms', 'fetch_n', 'fetch_at'])
            if (prev && prev[k] !== undefined)
                entry[k] = prev[k];
        this.state[id] = entry;
        return fresh;
    }

    clearNews(id?: string) {
        for (const k of Object.keys(this.state)) {
            if ((id && k !== id) || k.startsWith('__') || !this.state[k] || typeof this.state[k] !== 'object')
                continue;
            this.state[k].news = [];
            this.state[k].news_titles = {};
        }
        this.saveState();
    }

    newsSet(): Set<string> {
        const out = new Set<string>();
        for (const [id, st] of Object.entries(this.state)) {
            if (id.startsWith('__') || !st || typeof st !== 'object')
                continue;
            for (const k of st.news || [])
                out.add(`${id}:${k}`);
        }
        return out;
    }

    forget(id: string) {
        if (this.state[id]) {
            delete this.state[id];
            this.saveState();
        }
    }

    read(): any[] {
        if (!fs.existsSync(this.file))
            this.migrateLegacy();
        const repos: any[] = (util.readJson(this.file, {}) as any).repos;
        if (!Array.isArray(repos))
            return [];
        const keep = repos.filter((r) => r && typeof r === 'object' && !r.official && r.id !== 'ludrix-oficial');
        if (keep.length !== repos.length) {
            try {
                util.writeJson(this.file, { repos: keep });
            }
            catch { }
        }
        return keep;
    }

    migrateLegacy() {
        const old = path.join(P.ASSETS, 'presets', 'repos.json');
        let mine: any[] = [];
        try {
            if (fs.existsSync(old))
                mine = (JSON.parse(fs.readFileSync(old, 'utf8')).repos || []).filter((r: any) => !RepoRegistry.LEGACY_BUILTIN.has(r.id));
        }
        catch {
            mine = [];
        }
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            this.write(mine);
        }
        catch (e) {
            log.warn('repos.json: %s', e);
        }
    }

    write(repos: any[]) {
        util.writeJson(this.file, { repos });
    }

    reload() {
        this.providers = {};
        this.heal();
        for (const cfg of this.read()) {
            const cls = PROVIDERS[cfg.type];
            if (cls) {
                const prov = new cls(cfg, this.session, this.cache);
                prov.store = this.store;
                this.providers[cfg.id] = prov;
            }
        }
    }

    heal() {
        let repos = this.read();
        let changed = false;
        if (repos.some((c) => !(c.type in PROVIDERS))) {
            repos = repos.filter((c) => c.type in PROVIDERS);
            changed = true;
        }
        for (const cfg of repos) {
            const url = cfg.url || '';
            const m = /archive\.org\/details\/@([A-Za-z0-9_.-]+)/.exec(url);
            if (cfg.type === 'webpage' && m) {
                void resolveArchiveUser(this.session, m[1]).then((u) => {
                    if (!u)
                        return;
                    const cur = this.read();
                    const c = cur.find((x) => x.id === cfg.id);
                    if (!c)
                        return;
                    Object.assign(c, { type: 'archive_uploader', uploader: u.uploader, kind: c.kind || 'pc' });
                    delete c.url;
                    this.write(cur);
                    this.reload();
                }).catch(() => undefined);
            }
        }
        if (changed)
            this.write(repos);
    }

    noteFetch(id: string, ms: number, n: number, fresh: boolean) {
        const st = (this.state[id] = this.state[id] || {});
        if (fresh || !st.fetch_ms)
            st.fetch_ms = Math.max(1, ms);
        st.fetch_n = n;
        st.fetch_at = Math.floor(Date.now() / 1000);
    }
    linkDead(repo: string, key: string): boolean {
        const l = this.state[repo]?.links;
        return Boolean(l && l.dead && l.dead[key]);
    }
    async checkLinks(id: string, entries: any[], onProgress?: (done: number, total: number) => void) {
        const cand = entries.filter((e) => e.repo === id && e.files && e.files.some((f: any) => /^https?:/i.test(String(f.url || ''))));
        const step = Math.max(1, Math.floor(cand.length / 25));
        const sample = cand.filter((_, i) => i % step === 0).slice(0, 25);
        const dead: Record<string, string> = {};
        let ok = 0, done = 0;
        const one = async (e: any) => {
            const url = String(e.files.find((f: any) => /^https?:/i.test(String(f.url || ''))).url);
            let status = 0, why = '';
            try {
                const r = await this.session.head(url, { timeout: 8000, redirect: 'follow' });
                status = Number(r.status || 0);
                if (status === 405 || status === 403 || status === 501) {
                    const r2 = await this.session.get(url, { timeout: 8000, headers: { Range: 'bytes=0-0' } });
                    status = Number(r2.status || 0);
                    try { r2.body?.cancel?.(); } catch { }
                }
            }
            catch (err: any) {
                status = Number(err?.status || 0);
                why = String(err?.message || err).slice(0, 80);
            }
            if (status >= 200 && status < 400)
                ok++;
            else
                dead[e.key] = status ? `HTTP ${status}` : (why || 'sem resposta');
            done++;
            onProgress?.(done, sample.length);
        };
        const queue = [...sample];
        await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await one(queue.shift()); }));
        const st = (this.state[id] = this.state[id] || {});
        st.links = { at: Math.floor(Date.now() / 1000), tested: sample.length, total: cand.length, ok, dead };
        this.saveState();
        return st.links;
    }
    list(): any[] {
        const disabled = this.disabled();
        const out: any[] = [];
        for (const c of this.read()) {
            const d: any = { ...c, enabled: !disabled.has(c.id) };
            const st = this.state[c.id];
            if (st) {
                d.checked_at = Number(st.checked_at || 0);
                d.new_count = (st.news || []).length;
                d.fetch_ms = Number(st.fetch_ms || 0);
                if (st.links)
                    d.links = { at: st.links.at, tested: st.links.tested, total: st.links.total, ok: st.links.ok, dead: Object.keys(st.links.dead || {}).length };
            }
            if (d.token) {
                d.token = '';
                d.token_set = true;
            }
            out.push(d);
        }
        return out;
    }

    add(cfg: Record<string, any>): Record<string, any> {
        cfg = { ...cfg };
        cfg.id ??= strip(String(cfg.name || 'repo').toLowerCase().replace(/[^a-z0-9]+/g, '-'), '-') || `repo${Math.floor(Date.now() / 1000)}`;
        if (!(cfg.type in PROVIDERS))
            throw new Error('tipo inválido');
        const repos = this.read().filter((r) => r.id !== cfg.id).concat([cfg]);
        this.userAdded.add(cfg.id);
        this.write(repos);
        this.reload();
        return cfg;
    }

    update(repoId: string, patch: Record<string, any>): Record<string, any> {
        const repos = this.read();
        const cur = repos.find((r) => r.id === repoId);
        if (!cur)
            throw new Error('Fonte não encontrada');
        const allowed = new Set(['name', 'kind', 'system', 'url', 'token', 'chat', 'uploader', 'creator', 'query', 'identifier', 'repo', 'title',
            'asset', 'path', 'platform', 'depth', 'note']);
        for (const [k, v0] of Object.entries(patch || {})) {
            if (!allowed.has(k))
                continue;
            let v: any = v0;
            if (typeof v === 'string')
                v = v.trim();
            if (v === '' || v == null)
                delete cur[k];
            else
                cur[k] = v;
        }
        if (!cur.name)
            cur.name = repoId;
        if (cur.kind !== 'rom')
            cur.system = 'pc';
        this.write(repos);
        if (['url', 'token', 'chat', 'uploader', 'creator', 'query', 'identifier', 'repo', 'path', 'platform', 'depth'].some((k) => k in (patch || {}))) {
            try {
                for (const f of fs.readdirSync(P.CACHE_WEB))
                    if (f.includes(repoId))
                        fs.rmSync(path.join(P.CACHE_WEB, f), { force: true, recursive: true });
            }
            catch { }
        }
        this.reload();
        return cur;
    }

    remove(repoId: string) {
        this.write(this.read().filter((r) => r.id !== repoId));
        this.forget(repoId);
        this.reload();
    }

    setEnabled(repoId: string, enabled: boolean) {
        const d = this.disabled();
        if (enabled)
            d.delete(repoId);
        else
            d.add(repoId);
        this.store.setConfig({ disabled_repos: [...d].sort() });
    }

    disabled(): Set<string> {
        let cfg = this.store.config;
        const ids = this.read().map((r) => r.id);
        if (!cfg.repos_initialized) {
            this.store.setConfig({ repos_initialized: true, known_repos: ids, disabled_repos: cfg.repos_default_off ?? true ? ids : [] });
            cfg = this.store.config;
        }
        const known = new Set<string>(cfg.known_repos || ids);
        const fresh = ids.filter((i) => !known.has(i) && !this.userAdded.has(i));
        if (fresh.length && (cfg.repos_default_off ?? true)) {
            this.store.setConfig({ known_repos: [...new Set([...known, ...ids])].sort(), disabled_repos: [...new Set([...(cfg.disabled_repos || []), ...fresh])].sort() });
            cfg = this.store.config;
        }
        else if (ids.some((i) => !known.has(i))) {
            this.store.setConfig({ known_repos: [...new Set([...known, ...ids])].sort() });
        }
        return new Set<string>(cfg.disabled_repos || []);
    }

    enabledProviders(): Provider[] {
        const d = this.disabled();
        return Object.entries(this.providers).filter(([pid]) => !d.has(pid)).map(([, p]) => p);
    }
}
