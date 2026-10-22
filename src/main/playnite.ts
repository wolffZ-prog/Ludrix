import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import * as P from './paths';
import * as log from './log';

export let PROGRESS: ((m: string) => void) | null = null;
export let INCLUDE_HIDDEN = false;
export let EXT_GUESS: ((p: string) => string) | null = null;
export const DROPPED: any[] = [];
const NOT_LAUNCH = new Set(['.pdf', '.txt', '.url', '.html', '.htm', '.doc', '.docx', '.jpg', '.png', '.ini', '.cfg', '.nfo', '.rtf']);

export function setProgress(fn: ((m: string) => void) | null) {
    PROGRESS = fn;
}
export function setIncludeHidden(v: boolean) {
    INCLUDE_HIDDEN = v;
}
export function setExtGuess(fn: ((p: string) => string) | null) {
    EXT_GUESS = fn;
}

export const ROM_EXTS = new Set(['.chd', '.iso', '.cue', '.bin', '.img', '.pbp', '.cso', '.z64', '.n64', '.v64', '.nds', '.gba', '.gb', '.gbc', '.sfc', '.smc',
    '.nes', '.md', '.gen', '.smd', '.gcm', '.rvz', '.wbfs', '.wad', '.gdi', '.cdi', '.xiso', '.xex', '.wua', '.wud', '.wux',
    '.rpx', '.nsp', '.xci', '.3ds', '.cci', '.sms', '.gg', '.pce', '.a26', '.zip', '.7z', '.conf']);

const PLATFORMS: Array<[string, string]> = [
    ['sony_playstation2', 'ps2'], ['playstation 2', 'ps2'], ['ps2', 'ps2'],
    ['sony_playstation3', 'ps3'], ['playstation 3', 'ps3'], ['ps3', 'ps3'],
    ['sony_psp', 'psp'], ['playstation portable', 'psp'], ['psp', 'psp'],
    ['sony_playstation', 'ps1'], ['playstation', 'ps1'], ['psx', 'ps1'],
    ['nintendo_gamecube', 'gc'], ['gamecube', 'gc'],
    ['nintendo_wiiu', 'wiiu'], ['wii u', 'wiiu'],
    ['nintendo_wii', 'wii'], ['wii', 'wii'],
    ['nintendo_switch', 'switch'], ['switch', 'switch'],
    ['nintendo_64', 'n64'], ['nintendo 64', 'n64'], ['n64', 'n64'],
    ['nintendo_gameboyadvance', 'gba'], ['game boy advance', 'gba'], ['gba', 'gba'],
    ['nintendo_gameboycolor', 'gba'], ['game boy color', 'gba'], ['nintendo_gameboy', 'gba'], ['game boy', 'gba'],
    ['nintendo_super_nes', 'snes'], ['super nintendo', 'snes'], ['snes', 'snes'], ['super nes', 'snes'], ['super famicom', 'snes'],
    ['nintendo_nes', 'nes'], ['nintendo entertainment system', 'nes'], ['nes', 'nes'], ['famicom', 'nes'],
    ['nintendo_3ds', '3ds'], ['3ds', '3ds'],
    ['nintendo_ds', 'nds'], ['nintendo ds', 'nds'], ['nds', 'nds'],
    ['sega_genesis', 'genesis'], ['genesis', 'genesis'], ['mega drive', 'genesis'], ['megadrive', 'genesis'],
    ['sega_mastersystem', 'sms'], ['master system', 'sms'], ['sega_gamegear', 'sms'], ['game gear', 'sms'],
    ['sega_dreamcast', 'dc'], ['dreamcast', 'dc'],
    ['sega_saturn', 'saturn'], ['saturn', 'saturn'],
    ['xbox360', 'x360'], ['xbox 360', 'x360'],
    ['xbox', 'xbox'],
    ['pc_dos', 'dos'], ['ms-dos', 'dos'], ['dos', 'dos'],
    ['nec_turbografx_16', 'pce'], ['turbografx', 'pce'], ['pc engine', 'pce'],
    ['atari_2600', 'atari2600'], ['atari 2600', 'atari2600'],
    ['arcade', 'arcade'], ['mame', 'arcade'], ['neo geo', 'arcade'],
    ['pc_windows', 'pc'], ['pc (windows)', 'pc'], ['windows', 'pc'], ['pc', 'pc'],
];

const EMULATORS: Record<string, string> = { pcsx2: 'pcsx2', duckstation: 'duckstation', ppsspp: 'ppsspp', dolphin: 'dolphin', flycast: 'flycast', xemu: 'xemu',
    xenia: 'xenia', mgba: 'mgba', snes9x: 'snes9x', melonds: 'melonds', retroarch: 'retroarch', rpcs3: 'rpcs3', cemu: 'cemu',
    eden: 'eden', citron: 'citron', azahar: 'azahar', mesen: 'mesen', ares: 'ares',
    mednafen: 'mednafen', mame: 'mame', stella: 'stella', dosbox: 'dosbox', simple64: 'simple64', redream: 'redream',
    rmg: 'rmg', rosalie: 'rmg', bsnes: 'bsnes', fceux: 'fceux', nestopia: 'nestopia',
    kega: 'kega', blastem: 'blastem', epsxe: 'epsxe', desmume: 'desmume', visualboy: 'vbam', vbam: 'vbam' };

const ABS = /^([A-Za-z]:[\\/]|\\\\|\/)/;
const ACTION_TYPES: Record<string, number> = { file: 0, url: 1, emulator: 2, script: 3, '0': 0, '1': 1, '2': 2, '3': 3 };
const PLUGIN_LAUNCH: Record<string, string> = {
    '00000002-dbd1-46c6-b5d0-b1ba559d10e4': 'com.epicgames.launcher://apps/{id}?action=launch&silent=true',
    'aebe8b7c-6dc3-4a66-af31-e7375c6b5e9e': 'goggalaxy://openGameView/{id}',
    'c2f038e5-8b92-4877-91f1-da9094155fc5': 'uplay://launch/{id}/0',
    '85dd7072-2f20-4e76-a007-41035e390724': 'origin2://game/launch?offerIds={id}',
    'e3c26a3d-d695-4cb7-a769-5ff7612c7edd': 'battlenet://{id}',
    '7e4fbb5e-2ae3-48d4-8ba0-6b30e7a4e287': 'xbox',
    '402674cd-4af6-4886-b6ec-0e695bfa0688': 'amazon-games://play/{id}',
};

function isAbs(p: string): boolean {
    return Boolean(p) && ABS.test(p);
}

function join(base: string, p: string): string {
    if (!p)
        return p;
    if (isAbs(p) || !base)
        return p;
    const sep = base.includes('\\') || /^[A-Za-z]:/.test(base) ? '\\' : path.sep;
    return base.replace(/[\\/]+$/, '') + sep + p.replace(/^[\\/]+/, '');
}

export function sysOf(names: any[]): string {
    for (const n of names || []) {
        const k = String(n || '').trim().toLowerCase();
        if (!k)
            continue;
        for (const [pk, sid] of PLATFORMS)
            if (pk === k)
                return sid;
        const toks = new Set(k.split(/[^a-z0-9]+/));
        for (const [pk, sid] of PLATFORMS) {
            if (pk.length > 3 && k.includes(pk))
                return sid;
            if (toks.has(pk) && pk !== 'pc' && pk !== 'dos')
                return sid;
        }
    }
    return '';
}

function pnVars(v: string, inst: string): string {
    return v.split('{InstallDir}').join(inst).split('{PlayniteDir}').join('').trim();
}

function winpath(p: string): string {
    p = (p || '').trim();
    if (!p)
        return p;
    if (p.startsWith('\\\\'))
        return '\\\\' + p.slice(2).replace(/\\{2,}/g, '\\');
    return p.replace(/\\{2,}/g, '\\');
}

function parentName(p: string): string {
    if (p.includes('\\') || /^[A-Za-z]:/.test(p))
        return path.win32.basename(path.win32.dirname(p));
    return path.basename(path.dirname(p));
}

function stemOf(p: string): string {
    const b = p.includes('\\') ? path.win32.basename(p) : path.basename(p);
    const i = b.lastIndexOf('.');
    return i > 0 ? b.slice(0, i) : b;
}

function extOf(p: string): string {
    const b = p.includes('\\') ? path.win32.basename(p) : path.basename(p);
    const i = b.lastIndexOf('.');
    return i > 0 ? b.slice(i).toLowerCase() : '';
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

function isDir(p: string): boolean {
    try {
        return fs.statSync(p).isDirectory();
    }
    catch {
        return false;
    }
}

function isFile(p: string): boolean {
    try {
        return fs.statSync(p).isFile();
    }
    catch {
        return false;
    }
}

export function emuOf(name: string, exe = ''): string {
    const n = (name || '').toLowerCase();
    for (const [k, v] of Object.entries(EMULATORS))
        if (n.includes(k))
            return v;
    const e = stemOf(exe || '').toLowerCase();
    for (const [k, v] of Object.entries(EMULATORS))
        if (e.includes(k))
            return v;
    return '';
}

const LITEDB_MAGIC = Buffer.from('** This is a LiteDB file **', 'latin1');

export function* litedbDocs(data: Buffer): Generator<any> {
    if (data.length < 4096 || data[4] !== 1)
        throw new Error('Esse arquivo não parece um backup do Playnite (ou está danificado)');
    if (data.subarray(25, 52).equals(LITEDB_MAGIC) && data[52] === 7)
        yield* litedb4Docs(data);
    else if (data.subarray(32, 59).equals(LITEDB_MAGIC) && data[59] === 8)
        yield* litedb5Docs(data);
    else
        throw new Error('Esse backup está num formato que o Ludrix ainda não conhece. Confira se é o .zip gerado em Playnite → Backup de dados');
}

function* litedb4Docs(data: Buffer): Generator<any> {
    const PAGE = 4096;
    const total = Math.floor(data.length / PAGE);
    const page = (pid: number) => {
        const o = pid * PAGE;
        return { typ: data[o + 4], nxt: data.readUInt32LE(o + 9), items: data.readUInt16LE(o + 13) };
    };
    const extendData = (pid: number): Buffer => {
        const parts: Buffer[] = [];
        let hops = 0;
        while (pid !== 0xFFFFFFFF && pid < total && hops < 65536) {
            const pg = page(pid);
            if (pg.typ !== 5)
                break;
            const off = pid * PAGE + 25;
            parts.push(data.subarray(off, off + Math.min(pg.items, PAGE - 25)));
            pid = pg.nxt;
            hops++;
        }
        return Buffer.concat(parts);
    };
    let bad = 0;
    for (let pid = 0; pid < total; pid++) {
        if (PROGRESS && pid % 8192 === 0)
            PROGRESS(`Lendo banco… ${Math.floor(pid * 100 / Math.max(1, total))}%`);
        const pg = page(pid);
        if (pg.typ !== 4 || pg.items === 0)
            continue;
        let pos = pid * PAGE + 25;
        const end = (pid + 1) * PAGE;
        for (let k = 0; k < pg.items; k++) {
            if (pos + 8 > end) {
                bad++;
                break;
            }
            const ext = data.readUInt32LE(pos + 2);
            const ln = data.readUInt16LE(pos + 6);
            pos += 8;
            if (pos + ln > end) {
                bad++;
                break;
            }
            const doc = ext !== 0xFFFFFFFF ? extendData(ext) : data.subarray(pos, pos + ln);
            pos += ln;
            if (doc.length < 5)
                continue;
            const dl = doc.readInt32LE(0);
            if (dl < 5 || dl > doc.length) {
                bad++;
                continue;
            }
            try {
                yield bson(doc, 4, dl - 1);
            }
            catch (ex: any) {
                bad++;
                log.debug('bson: %s', ex?.message || ex);
            }
        }
    }
    if (bad)
        log.warn('litedb4: %d bloco(s) ignorado(s)', bad);
}

function* litedb5Docs(data: Buffer): Generator<any> {
    const PAGE = 8192;
    const total = Math.floor(data.length / PAGE);
    const segs = new Map<string, { extend: boolean; nxt: [number, number]; buf: Buffer }>();
    let bad = 0;
    for (let pid = 0; pid < total; pid++) {
        const off = pid * PAGE;
        if (PROGRESS && pid % 4096 === 0)
            PROGRESS(`Lendo banco… ${Math.floor(pid * 100 / Math.max(1, total))}%`);
        if (data[off + 4] !== 4)
            continue;
        const items = data[off + 23], highest = data[off + 30];
        if (items === 0 || highest === 255)
            continue;
        for (let idx = 0; idx <= highest; idx++) {
            const base = off + PAGE - (idx + 1) * 4;
            const ln = data.readUInt16LE(base), pos = data.readUInt16LE(base + 2);
            if (pos === 0)
                continue;
            if (pos < 32 || ln < 7 || pos + ln > PAGE) {
                bad++;
                continue;
            }
            const seg = data.subarray(off + pos, off + pos + ln);
            segs.set(`${pid}:${idx}`, { extend: Boolean(seg[0]), nxt: [seg.readUInt32LE(1), seg[5]], buf: seg.subarray(6) });
        }
    }
    for (const { extend, nxt, buf } of segs.values()) {
        if (extend)
            continue;
        const parts = [buf];
        let n: [number, number] = nxt, hops = 0;
        while (n[0] !== 0xFFFFFFFF && segs.has(`${n[0]}:${n[1]}`) && hops < 8192) {
            const s2 = segs.get(`${n[0]}:${n[1]}`)!;
            parts.push(s2.buf);
            n = s2.nxt;
            hops++;
        }
        const doc = Buffer.concat(parts);
        if (doc.length < 5)
            continue;
        const ln = doc.readInt32LE(0);
        if (ln < 5 || ln > doc.length)
            continue;
        try {
            yield bson(doc, 4, ln - 1);
        }
        catch (ex: any) {
            bad++;
            log.debug('bson: %s', ex?.message || ex);
        }
    }
    if (bad)
        log.warn('litedb: %d segmento(s) ignorado(s)', bad);
}

export function bson(b: Buffer, pos: number, end: number, depth = 0): any {
    const out: any = {};
    if (depth > 32)
        throw new Error('depth');
    while (pos < end) {
        const t = b[pos];
        pos += 1;
        const z = b.indexOf(0, pos);
        if (z < 0 || z > end || z - pos > 512)
            throw new Error('key');
        const k = b.subarray(pos, z).toString('utf8');
        pos = z + 1;
        let v: any;
        if (t === 0x01) {
            v = b.readDoubleLE(pos);
            pos += 8;
        }
        else if (t === 0x02) {
            const ln = b.readInt32LE(pos);
            if (ln < 1 || pos + 4 + ln > end + 1)
                throw new Error('str');
            v = b.subarray(pos + 4, pos + 4 + ln - 1).toString('utf8');
            pos += 4 + ln;
        }
        else if (t === 0x03 || t === 0x04) {
            const ln = b.readInt32LE(pos);
            if (ln < 5 || pos + ln > end + 1)
                throw new Error('doc');
            const sub = bson(b, pos + 4, pos + ln - 1, depth + 1);
            v = t === 0x04 ? Object.values(sub) : sub;
            pos += ln;
        }
        else if (t === 0x05) {
            const ln = b.readInt32LE(pos);
            if (ln < 0 || pos + 5 + ln > end + 1)
                throw new Error('bin');
            const sub = b.subarray(pos + 5, pos + 5 + ln);
            v = ln === 16 && b[pos + 4] === 4 ? guid(sub) : null;
            pos += 5 + ln;
        }
        else if (t === 0x07) {
            v = b.subarray(pos, pos + 12).toString('hex');
            pos += 12;
        }
        else if (t === 0x08) {
            v = Boolean(b[pos]);
            pos += 1;
        }
        else if (t === 0x09) {
            v = Number(b.readBigInt64LE(pos)) / 1000;
            pos += 8;
        }
        else if (t === 0x0A) {
            v = null;
        }
        else if (t === 0x10) {
            v = b.readInt32LE(pos);
            pos += 4;
        }
        else if (t === 0x12) {
            v = Number(b.readBigInt64LE(pos));
            pos += 8;
        }
        else if (t === 0x13) {
            v = null;
            pos += 16;
        }
        else if (t === 0x11) {
            v = null;
            pos += 8;
        }
        else if (t === 0xFF || t === 0x7F || t === 0x06) {
            v = null;
        }
        else {
            break;
        }
        out[k] = v;
    }
    return out;
}

function guid(b: Buffer): string {
    if (b.length !== 16)
        return '';
    const a = Buffer.concat([Buffer.from([b[3], b[2], b[1], b[0], b[5], b[4], b[7], b[6]]), b.subarray(8)]);
    const h = a.toString('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function id(v: any): string {
    return String(v ?? '').toLowerCase();
}

class Redirect extends Error {
    constructor(public path: string) {
        super('redirect');
    }
}

class Source {
    zip: AdmZip | null = null;
    names = new Map<string, string>();
    prefix = '';
    root = '';
    filesDir = '';
    tmp: string;
    constructor(public p: string) {
        this.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ludrix-pn-'));
        let isZip = false;
        if (isFile(p)) {
            try {
                const fd = fs.openSync(p, 'r');
                const hdr = Buffer.alloc(4);
                fs.readSync(fd, hdr, 0, 4, 0);
                fs.closeSync(fd);
                isZip = hdr[0] === 0x50 && hdr[1] === 0x4b;
            }
            catch {
                isZip = false;
            }
        }
        if (isZip) {
            this.zip = new AdmZip(p);
            for (const e of this.zip.getEntries())
                if (!e.isDirectory)
                    this.names.set(e.entryName.replace(/\\/g, '/').toLowerCase(), e.entryName);
            const gdb = [...this.names.keys()].find((k) => k.endsWith('library/games.db'));
            if (!gdb)
                throw new Error('Esse .zip não tem library/games.db — use o backup gerado pelo Playnite (Arquivo → Backup de dados).');
            this.prefix = gdb.slice(0, -'library/games.db'.length);
        }
        else {
            const root = isDir(p) ? p : path.dirname(p);
            const cands = path.basename(root).toLowerCase() === 'library' ? [root, path.join(root, 'library'), path.dirname(root)] : [root, path.dirname(root)];
            for (const c of cands) {
                if (exists(path.join(c, 'library', 'games.db'))) {
                    this.root = c;
                    break;
                }
                if (exists(path.join(c, 'games.db'))) {
                    this.root = path.dirname(c);
                    break;
                }
            }
            if (!this.root) {
                let zips: string[] = [];
                if (isDir(p)) {
                    try {
                        zips = fs.readdirSync(p).filter((n) => n.toLowerCase().endsWith('.zip')).map((n) => path.join(p, n))
                            .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
                    }
                    catch {
                        zips = [];
                    }
                }
                if (zips.length)
                    throw new Redirect(zips[0]);
                throw new Error('library\\games.db não encontrado aqui. Selecione o .zip do backup do Playnite (Arquivo → Backup de dados) ou a pasta do Playnite (%AppData%\\Playnite / pasta portátil).');
            }
            const lf = path.join(this.root, 'libraryfiles');
            this.filesDir = isDir(lf) ? lf : path.join(this.root, 'library', 'files');
        }
    }
    close() {
        try {
            fs.rmSync(this.tmp, { recursive: true, force: true });
        }
        catch { /* nada */ }
    }
    db(name: string): Buffer | null {
        if (this.zip) {
            const real = this.names.get(`${this.prefix}library/${name}`.toLowerCase());
            return real ? this.zip.readFile(real) : null;
        }
        const f = path.join(this.root, 'library', name);
        if (!exists(f))
            return null;
        try {
            return fs.readFileSync(f);
        }
        catch (e: any) {
            const dst = path.join(this.tmp, name);
            try {
                fs.copyFileSync(f, dst);
                return fs.readFileSync(dst);
            }
            catch (e2: any) {
                throw new Error(`${name} está em uso — feche o Playnite e tente de novo (ou use o backup .zip). ${e2?.message || e?.message || e}`);
            }
        }
    }
    cover(rel: string): string {
        rel = (rel || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if (!rel || rel.startsWith('http:') || rel.startsWith('https:'))
            return '';
        if (isAbs(rel))
            return isFile(rel) ? rel : '';
        if (this.zip) {
            for (const base of [`${this.prefix}libraryfiles/`, `${this.prefix}library/files/`]) {
                const real = this.names.get((base + rel).toLowerCase());
                if (real) {
                    const out = path.join(P.CACHE, 'playnite_covers', ...rel.split('/'));
                    fs.mkdirSync(path.dirname(out), { recursive: true });
                    if (!exists(out))
                        fs.writeFileSync(out, this.zip.readFile(real) as Buffer);
                    return out;
                }
            }
            return '';
        }
        const p = path.join(this.filesDir, ...rel.split('/'));
        return isFile(p) ? p : '';
    }
}

const STATUS_WORDS: Array<[string, string[]]> = [['plan', ['plan', 'planej', 'quero', 'backlog']], ['playing', ['playing', 'jogando']], ['completed', ['complet', '100']],
    ['beaten', ['beaten', 'zerad', 'finish', 'termin']], ['abandoned', ['abandon', 'drop', 'desist']], ['on_hold', ['hold', 'espera', 'pausa']],
    ['played', ['played', 'jogad']]];

function statusOf(name: string): string {
    const n = name.toLowerCase();
    if (n.startsWith('not ') || n.startsWith('não ') || n.startsWith('nao '))
        return '';
    for (const [sid, words] of STATUS_WORDS)
        if (words.some((w) => n.includes(w)))
            return sid;
    return '';
}

function scoreOf(v: any): number {
    const n = parseInt(String(v ?? 0), 10);
    if (!Number.isFinite(n))
        return 0;
    return n > 0 ? Math.max(1, Math.min(10, Math.round(n / 10))) : 0;
}

export function read(p: string): any[] {
    let src: Source;
    try {
        src = new Source(p);
    }
    catch (e: any) {
        if (e instanceof Redirect)
            src = new Source(e.path);
        else
            throw e;
    }
    try {
        return readSrc(src);
    }
    finally {
        src.close();
    }
}

function table(src: Source, name: string, what: string): Record<string, any> {
    let raw: Buffer | null;
    try {
        raw = src.db(name);
    }
    catch (e: any) {
        log.warn('%s: %s', name, e?.message || e);
        return {};
    }
    if (!raw)
        return {};
    if (PROGRESS)
        PROGRESS(`Lendo ${what}…`);
    const out: Record<string, any> = {};
    try {
        for (const d of litedbDocs(raw))
            if (d._id !== null && d._id !== undefined)
                out[id(d._id)] = d;
    }
    catch (e: any) {
        log.warn('%s: %s', name, e?.message || e);
    }
    return out;
}

function readSrc(src: Source): any[] {
    const plats: Record<string, [string, string]> = {};
    for (const [k, v] of Object.entries<any>(table(src, 'platforms.db', 'plataformas')))
        plats[k] = [v.Name || '', v.SpecificationId || ''];
    const comps: Record<string, string> = {};
    for (const [k, v] of Object.entries<any>(table(src, 'companies.db', 'empresas')))
        comps[k] = v.Name || '';
    const genres: Record<string, string> = {};
    for (const [k, v] of Object.entries<any>(table(src, 'genres.db', 'gêneros')))
        genres[k] = v.Name || '';
    const sources: Record<string, string> = {};
    for (const [k, v] of Object.entries<any>(table(src, 'sources.db', 'fontes')))
        sources[k] = v.Name || '';
    const cstatus: Record<string, string> = {};
    for (const [k, v] of Object.entries<any>(table(src, 'completionstatuses.db', 'status')))
        cstatus[k] = statusOf(v.Name || '');
    const emus = table(src, 'emulators.db', 'emuladores');
    const scanners = table(src, 'scanners.db', 'pastas de ROMs');

    const platNames = (ids: any[]): string[] => {
        const out: string[] = [];
        for (const i of ids || []) {
            const [n, spec] = plats[id(i)] || ['', ''];
            for (const x of [spec, n])
                if (x)
                    out.push(x);
        }
        return out;
    };

    const items: any[] = [];
    const emuInfo = new Map<string, any>();
    const ek = (eid: string, pid: string) => `${eid}|${pid}`;
    for (const [eid, e] of Object.entries<any>(emus)) {
        const name = e.Name || '';
        const inst = e.InstallDir || '';
        const profiles: any[] = [];
        for (const pr of e.CustomProfiles || []) {
            if (pr && typeof pr === 'object') {
                let exe = String(pr.Executable || '').split('{EmulatorDir}').join(inst);
                exe = exe && !isAbs(exe) ? join(inst, exe) : exe;
                const systems = [...new Set(platNames(pr.Platforms).map((p) => sysOf([p])).filter((s) => s && s !== 'pc'))];
                profiles.push({ pid: id(pr.Id), name: pr.Name || '', exe, args: pr.Arguments || '', systems, kind: 'custom' });
            }
        }
        for (const pr of e.BuiltinProfiles || []) {
            if (pr && typeof pr === 'object')
                profiles.push({ pid: id(pr.Id), name: pr.Name || pr.BuiltInProfileName || '', exe: '', args: '', systems: [], kind: 'builtin', builtin: pr.BuiltInProfileName || '' });
        }
        const vid = emuOf(name, (profiles.find((p) => p.exe) || {}).exe || '');
        let first: any = null;
        for (const pr of profiles) {
            const info = { vid: vid || emuOf(pr.builtin || '', pr.exe), exe: pr.exe, args: pr.args, systems: pr.systems, name, dir: inst };
            emuInfo.set(ek(eid, pr.pid), info);
            first = first || info;
            const title = `Emulador: ${name}` + (pr.name && !['default', 'padrão', name.toLowerCase()].includes(pr.name.toLowerCase()) ? ` (${pr.name})` : '');
            items.push({ kind: 'emulator', title, emulator: info.vid, exe: pr.exe, args: pr.args, systems: pr.systems,
                system: pr.systems[0] || '', emu_dir: inst, source: 'playnite', profile: pr.kind });
        }
        if (first)
            emuInfo.set(ek(eid, ''), first);
        if (!profiles.length && inst) {
            emuInfo.set(ek(eid, ''), { vid, exe: '', args: '', systems: [], name, dir: inst });
            items.push({ kind: 'emulator', title: `Emulador: ${name}`, emulator: vid, exe: '', args: '', systems: [], system: '', emu_dir: inst, source: 'playnite', profile: 'builtin' });
        }
    }

    for (const sc of Object.values<any>(scanners)) {
        const d = sc.Directory || '';
        if (!d)
            continue;
        const info = emuInfo.get(ek(id(sc.EmulatorId), id(sc.EmulatorProfileId))) || emuInfo.get(ek(id(sc.EmulatorId), ''));
        let sid = info && info.systems && info.systems.length ? info.systems[0] : '';
        sid = sid || sysOf([path.win32.basename(d), sc.Name || '']);
        items.push({ kind: 'rom_dir', title: `Pasta de ROMs: ${sc.Name || path.win32.basename(d)}`, rom_dir: d, system: sid || '', source: 'playnite',
            emulator: (info || {}).vid || '' });
    }

    const raw = src.db('games.db');
    if (!raw)
        throw new Error('games.db não encontrado');
    let n = 0;
    const seen = new Set<string>();
    const stats: Record<string, number> = { docs: 0, hidden: 0, no_path: 0, missing: 0, dup: 0 };
    DROPPED.length = 0;
    const drop = (kind: string, title: string, p = '', why = '') => {
        stats[kind] += 1;
        DROPPED.push({ title, why, path: p });
    };
    for (const g of litedbDocs(raw)) {
        stats.docs += 1;
        const name = g.Name;
        if (!name || typeof name !== 'string')
            continue;
        n += 1;
        if (PROGRESS && n % 200 === 0)
            PROGRESS(`Jogos… ${n}`);
        if (g.Hidden && !INCLUDE_HIDDEN) {
            drop('hidden', name, g.InstallDirectory || '', "Oculto no Playnite (marque 'Incluir jogos ocultos' para trazer)");
            continue;
        }
        const inst: string = g.InstallDirectory || '';
        const installed = Boolean(g.IsInstalled);
        const pnames = platNames(g.PlatformIds);
        let sysid = sysOf(pnames) || '';
        const roms: string[] = (g.Roms || []).filter((r: any) => r && typeof r === 'object').map((r: any) => r.Path || '');
        const acts: any[] = (g.GameActions || []).filter((a: any) => a && typeof a === 'object');
        const play = acts.find((a) => a.IsPlayAction) || (acts.length ? acts[0] : null);
        let exe: string | null = null, rom: string | null = null;
        let args = '', workdir = '';
        let emuId = '', emuPid = '';
        if (play) {
            const tk = String(play.Type).trim().toLowerCase();
            const t = tk in ACTION_TYPES ? ACTION_TYPES[tk] : play.Type;
            const p = String(play.Path || '').split('{InstallDir}').join(inst);
            if (t === 2) {
                emuId = id(play.EmulatorId);
                emuPid = id(play.EmulatorProfileId);
                rom = roms.length ? roms[0] : (p || null);
            }
            else if (t === 1 && p) {
                exe = p;
            }
            else if ((t === 0 || t === null || t === undefined) && p) {
                exe = join(inst, p);
            }
            if (t !== 2) {
                args = pnVars(String(play.Arguments || ''), inst);
                workdir = pnVars(String(play.WorkingDir || ''), inst);
                workdir = workdir && !workdir.includes('{') ? winpath(workdir) : '';
                if (args.includes('{'))
                    args = '';
            }
        }
        if (roms.length && !rom && !exe)
            rom = roms[0];
        if (rom) {
            const edir = (emuInfo.get(ek(emuId, emuPid)) || emuInfo.get(ek(emuId, '')) || {}).dir || '';
            rom = rom.split('{InstallDir}').join(inst).split('{EmulatorDir}').join(edir);
            rom = winpath(join(inst, rom));
        }
        if (exe)
            exe = exe.includes('://') ? exe : winpath(exe);
        if (exe && !exe.includes('://') && NOT_LAUNCH.has(extOf(exe)))
            exe = null;
        if (exe && ROM_EXTS.has(extOf(exe)) && sysid && sysid !== 'pc') {
            rom = exe;
            exe = null;
        }
        const info = emuId ? (emuInfo.get(ek(emuId, emuPid)) || emuInfo.get(ek(emuId, ''))) : null;
        if (rom && !sysid && info && info.systems && info.systems.length)
            sysid = info.systems[0];
        if (rom && (!sysid || sysid === 'pc'))
            sysid = sysOf([parentName(rom)]) || (EXT_GUESS ? EXT_GUESS(rom) : '') || sysid;
        if (rom && ['.exe', '.bat', '.lnk'].includes(extOf(rom))) {
            exe = rom;
            rom = null;
        }
        if (!rom)
            sysid = 'pc';
        if (!(exe || rom || inst)) {
            drop('no_path', name, '', 'Sem pasta nem executável no Playnite (só catálogo)');
            continue;
        }
        const isUrl = Boolean(exe) && exe!.includes('://');
        let ex = isUrl || Boolean(rom && exists(rom)) || Boolean(exe && exists(exe)) || Boolean(!exe && !rom && inst && isDir(inst));
        if (!installed && !ex) {
            drop('missing', name, rom || exe || inst, 'Não instalado no Playnite e o caminho não existe');
            continue;
        }
        const key = `${name.toLowerCase()}|${(rom || exe || inst).toLowerCase()}`;
        if (seen.has(key)) {
            drop('dup', name, rom || exe || inst, 'Repetido no Playnite (mesmo nome e caminho)');
            continue;
        }
        seen.add(key);
        let steamAppid = '';
        if ((exe || '').startsWith('steam://')) {
            const m = /(\d+)/.exec(exe!);
            steamAppid = m ? m[1] : '';
        }
        else if (id(g.PluginId) === 'cb91dfc9-b977-43bf-8e70-55f46e410fab' && g.GameId) {
            steamAppid = String(g.GameId);
            exe = exe || `steam://rungameid/${steamAppid}`;
        }
        let alt = '';
        if (!exe && !rom && g.GameId && (PLUGIN_LAUNCH[id(g.PluginId)] ?? 'xbox') !== 'xbox') {
            const url = PLUGIN_LAUNCH[id(g.PluginId)].split('{id}').join(String(g.GameId));
            if (inst && isDir(inst))
                alt = url;
            else
                exe = url;
            ex = true;
        }
        const pt = Number(g.Playtime || 0);
        const lp = g.LastActivity;
        let year = '';
        const rd = g.ReleaseDate;
        if (rd && typeof rd === 'object')
            year = String(rd.Year || rd.year || '').slice(0, 4);
        else if (typeof rd === 'number' && rd > 0)
            year = String(new Date(rd * 1000).getUTCFullYear());
        else if (typeof rd === 'string' && /^\d{4}/.test(rd))
            year = rd.slice(0, 4);
        items.push({
            title: name.replace(/\s{2,}/g, ' ').trim() || name, orig_title: name, exe: rom ? null : exe, rom, system: sysid || 'pc',
            dir: inst, playtime: pt < 1e7 ? pt : pt / 1000, last_played: typeof lp === 'number' ? lp : 0.0,
            source: 'playnite', cover_file: src.cover(g.CoverImage || ''), background_file: src.cover(g.BackgroundImage || ''),
            icon_file: src.cover(g.Icon || ''), year, favorite: Boolean(g.Favorite), steam_appid: steamAppid, args: exe ? args : '', workdir: exe ? workdir : '',
            emulator: (info || {}).vid || '', emu_exe: (info || {}).exe || '', emu_args: (info || {}).args || '',
            platforms: pnames.slice(0, 3), developers: (g.DeveloperIds || []).map((i: any) => comps[id(i)] || '').slice(0, 2),
            genres: (g.GenreIds || []).map((i: any) => genres[id(i)] || '').slice(0, 3), pn_source: sources[id(g.SourceId)] || '',
            description: String(g.Description || '').replace(/<[^>]+>/g, '').slice(0, 1500), missing: !ex,
            links: (g.Links || []).filter((l: any) => l && typeof l === 'object' && String(l.Url || '').startsWith('http'))
                .map((l: any) => ({ name: String(l.Name || '').slice(0, 40), url: String(l.Url || '') })).slice(0, 8),
            notes: String(g.Notes || '').slice(0, 2000), hidden: Boolean(g.Hidden), play_count: Math.trunc(Number(g.PlayCount || 0)),
            status: cstatus[id(g.CompletionStatusId)] || '', score: scoreOf(g.UserScore),
            alt_exe: alt, added: typeof g.Added === 'number' && g.Added > 0 && g.Added < 1e10 ? g.Added : 0.0,
        });
    }
    if (PROGRESS)
        PROGRESS(`Pronto: ${items.length} itens`);
    const gamesOut = items.filter((i) => !i.kind);
    if (!gamesOut.length) {
        if (stats.docs === 0)
            throw new Error('games.db foi aberto mas não consegui ler nenhum registro dele. Isso indica um formato que não reconheço — me mande esse arquivo (library\\games.db do backup) que eu corrijo o leitor.');
        throw new Error(`Li ${stats.docs} jogo(s) no games.db, mas nenhum sobrou pra importar: ${stats.hidden} oculto(s), ${stats.no_path} sem pasta/arquivo (só catálogo), ${stats.missing} não instalado(s) com caminho inexistente, ${stats.dup} repetido(s). Se você tem jogos instalados no Playnite, esse backup não é o da biblioteca atual.`);
    }
    log.info('playnite: %s → %d itens', JSON.stringify(stats), items.length);
    return items;
}
