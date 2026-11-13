import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import stream from 'node:stream';
import zlib from 'node:zlib';
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

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
function crcUpdate(crc: number, buf: Buffer) {
    let c = crc ^ 0xffffffff;
    for (let i = 0; i < buf.length; i++)
        c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function dosTime(d: Date) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
}
const STORE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.zip', '.7z', '.rar', '.mp4', '.mp3', '.ogg', '.woff', '.woff2']);
const MAX_ENTRY = 2 * 1024 ** 3;
const MAX_ZIP = 4 * 1024 ** 3 - 64 * 1024 ** 2;

class ZipWriter {
    private out: fs.WriteStream;
    private offset = 0;
    private central: Buffer[] = [];
    private centralSize = 0;
    count = 0;
    skipped = 0;
    full = false;
    constructor(public file: string) {
        this.out = fs.createWriteStream(file);
    }
    private write(b: Buffer): Promise<void> {
        this.offset += b.length;
        if (this.out.write(b))
            return Promise.resolve();
        return new Promise((res) => this.out.once('drain', res));
    }
    async addBuffer(arc: string, data: Buffer, mtime = new Date()) {
        await this.entry(arc, mtime, data.length, () => stream.Readable.from([data]));
    }
    async addFile(arc: string, src: string) {
        let st: fs.Stats;
        try {
            st = await fs.promises.stat(src);
        }
        catch {
            return;
        }
        if (!st.isFile())
            return;
        if (st.size > MAX_ENTRY || this.offset + st.size > MAX_ZIP) {
            this.skipped++;
            this.full = this.full || this.offset + st.size > MAX_ZIP;
            return;
        }
        await this.entry(arc, st.mtime, st.size, () => fs.createReadStream(src, { highWaterMark: 1024 * 1024 }));
    }
    private async entry(arc: string, mtime: Date, size: number, open: () => NodeJS.ReadableStream) {
        const name = Buffer.from(arc, 'utf8');
        const deflate = !STORE_EXT.has(path.extname(arc).toLowerCase()) && size > 64;
        const method = deflate ? 8 : 0;
        const { time, date } = dosTime(mtime);
        const local = this.offset;
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0);
        lh.writeUInt16LE(20, 4);
        lh.writeUInt16LE(0x0808, 6);
        lh.writeUInt16LE(method, 8);
        lh.writeUInt16LE(time, 10);
        lh.writeUInt16LE(date, 12);
        lh.writeUInt16LE(name.length, 26);
        await this.write(lh);
        await this.write(name);
        let crc = 0, raw = 0, comp = 0;
        const counter = new stream.Transform({
            transform: (chunk: Buffer, _e, cb) => { crc = crcUpdate(crc, chunk); raw += chunk.length; cb(null, chunk); },
        });
        const sink = new stream.Writable({
            write: (chunk: Buffer, _e, cb) => { comp += chunk.length; this.write(chunk).then(() => cb(), cb); },
        });
        const parts: any[] = [open(), counter];
        if (deflate)
            parts.push(zlib.createDeflateRaw({ level: 6 }));
        parts.push(sink);
        await stream.promises.pipeline(parts as any);
        const dd = Buffer.alloc(16);
        dd.writeUInt32LE(0x08074b50, 0);
        dd.writeUInt32LE(crc, 4);
        dd.writeUInt32LE(comp, 8);
        dd.writeUInt32LE(raw, 12);
        await this.write(dd);
        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0);
        ch.writeUInt16LE(20, 4);
        ch.writeUInt16LE(20, 6);
        ch.writeUInt16LE(0x0808, 8);
        ch.writeUInt16LE(method, 10);
        ch.writeUInt16LE(time, 12);
        ch.writeUInt16LE(date, 14);
        ch.writeUInt32LE(crc, 16);
        ch.writeUInt32LE(comp, 20);
        ch.writeUInt32LE(raw, 24);
        ch.writeUInt16LE(name.length, 28);
        ch.writeUInt32LE(local, 42);
        this.central.push(ch, name);
        this.centralSize += ch.length + name.length;
        this.count++;
    }
    async close() {
        const start = this.offset;
        for (const b of this.central)
            await this.write(b);
        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);
        eocd.writeUInt16LE(this.count, 8);
        eocd.writeUInt16LE(this.count, 10);
        eocd.writeUInt32LE(this.centralSize, 12);
        eocd.writeUInt32LE(start, 16);
        await this.write(eocd);
        await new Promise<void>((res, rej) => this.out.end((e?: Error | null) => e ? rej(e) : res()));
        return this.offset;
    }
}

async function walk(src: string): Promise<string[]> {
    const out: string[] = [];
    const rec = async (d: string) => {
        let ents: fs.Dirent[];
        try {
            ents = await fs.promises.readdir(d, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of ents) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) {
                if (e.name !== '__pycache__')
                    await rec(p);
            }
            else if (e.isFile())
                out.push(p);
        }
    };
    await rec(src);
    return out.sort();
}

async function add(z: ZipWriter, src: string, arc: string) {
    let st: fs.Stats;
    try {
        st = await fs.promises.stat(src);
    }
    catch {
        return;
    }
    if (st.isFile()) {
        await z.addFile(arc, src);
        return;
    }
    for (const p of await walk(src)) {
        const rel = path.relative(src, p).split(path.sep).join('/');
        await z.addFile(`${arc}/${rel}`, p);
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
function isFile(p: string) {
    try {
        return fs.statSync(p).isFile();
    }
    catch {
        return false;
    }
}

export async function exportData(destDir: string, version: string) {
    await fs.promises.mkdir(destDir, { recursive: true });
    const out = path.join(destDir, `Ludrix-dados-${stamp('dash')}.zip`);
    const tmp = out + '.part';
    const z = new ZipWriter(tmp);
    try {
        for (const f of DATA_FILES) {
            const p = path.join(P.DATA, f);
            if (isFile(p))
                await add(z, p, `data/${f}`);
        }
        for (const d of DATA_DIRS) {
            const p = path.join(P.DATA, d);
            if (isDir(p))
                await add(z, p, `data/${d}`);
        }
        if (isDir(P.THEMES)) {
            for (const t of await fs.promises.readdir(P.THEMES)) {
                const tp = path.join(P.THEMES, t);
                if (isDir(tp))
                    await add(z, tp, `themes/${t}`);
            }
        }
        const cq = path.join(P.FLASH, 'custom.json');
        if (isFile(cq))
            await add(z, cq, 'games/rapidos/custom.json');
        await z.addBuffer(MANIFEST, Buffer.from(JSON.stringify({ app: 'LudrixHub', version, at: Date.now() / 1000, files: z.count, root: P.ROOT, skipped: z.skipped }), 'utf8'));
        const size = await z.close();
        await fs.promises.rename(tmp, out);
        return { ok: true, path: out, files: z.count, size, skipped: z.skipped, full: z.full };
    }
    catch (e) {
        await fs.promises.rm(tmp, { force: true }).catch(() => { });
        throw e;
    }
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

export async function importData(file: string, version: string): Promise<any> {
    const info = inspect(file);
    if (info.error)
        return info;
    const pre = await exportData(P.UPDATES, version);
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
