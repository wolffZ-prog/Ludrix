import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import nodeCrypto from 'node:crypto';
import * as cp from 'node:child_process';

const PROTECTED = ['data', 'cache', 'games', 'emulation', 'downloads', 'themes', 'flash', 'bin', 'tools', 'updates'];
const PUBLIC_KEY = '0271846c4fa9e6b47bd2b2fc89dd282e30531abe9ce1b8d522b44836761a1131';
const SIG_NAME = 'signature.sig';
const WIN = process.platform === 'win32';

/* ------------------------------ zip mínimo ------------------------------ */
type ZEntry = { name: string; method: number; csize: number; usize: number; offset: number; crc: number };

export class Zip {
    fd: number;
    entries: ZEntry[] = [];
    names: Set<string>;
    constructor(public file: string) {
        this.fd = fs.openSync(file, 'r');
        const size = fs.fstatSync(this.fd).size;
        const tailLen = Math.min(size, 65557);
        const tail = Buffer.alloc(tailLen);
        fs.readSync(this.fd, tail, 0, tailLen, size - tailLen);
        let eocd = -1;
        for (let i = tailLen - 22; i >= 0; i--) {
            if (tail.readUInt32LE(i) === 0x06054b50) {
                eocd = i;
                break;
            }
        }
        if (eocd < 0)
            throw new Error('zip inválido (sem diretório central)');
        let count = tail.readUInt16LE(eocd + 10);
        let cdSize = tail.readUInt32LE(eocd + 12);
        let cdOff = tail.readUInt32LE(eocd + 16);
        if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
            const locPos = size - tailLen + eocd - 20;
            const loc = Buffer.alloc(20);
            fs.readSync(this.fd, loc, 0, 20, locPos);
            if (loc.readUInt32LE(0) !== 0x07064b50)
                throw new Error('zip64 inválido');
            const z64pos = Number(loc.readBigUInt64LE(8));
            const z64 = Buffer.alloc(56);
            fs.readSync(this.fd, z64, 0, 56, z64pos);
            count = Number(z64.readBigUInt64LE(32));
            cdSize = Number(z64.readBigUInt64LE(40));
            cdOff = Number(z64.readBigUInt64LE(48));
        }
        const cd = Buffer.alloc(cdSize);
        fs.readSync(this.fd, cd, 0, cdSize, cdOff);
        let p = 0;
        for (let i = 0; i < count; i++) {
            if (cd.readUInt32LE(p) !== 0x02014b50)
                throw new Error('diretório central corrompido');
            const method = cd.readUInt16LE(p + 10);
            const crc = cd.readUInt32LE(p + 16);
            let csize = cd.readUInt32LE(p + 20);
            let usize = cd.readUInt32LE(p + 24);
            const nlen = cd.readUInt16LE(p + 28), elen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32);
            let offset = cd.readUInt32LE(p + 42);
            const name = cd.subarray(p + 46, p + 46 + nlen).toString('utf8');
            if (csize === 0xffffffff || usize === 0xffffffff || offset === 0xffffffff) {
                let q = p + 46 + nlen;
                const end = q + elen;
                while (q + 4 <= end) {
                    const id = cd.readUInt16LE(q), sz = cd.readUInt16LE(q + 2);
                    if (id === 1) {
                        let r = q + 4;
                        if (usize === 0xffffffff) {
                            usize = Number(cd.readBigUInt64LE(r));
                            r += 8;
                        }
                        if (csize === 0xffffffff) {
                            csize = Number(cd.readBigUInt64LE(r));
                            r += 8;
                        }
                        if (offset === 0xffffffff)
                            offset = Number(cd.readBigUInt64LE(r));
                    }
                    q += 4 + sz;
                }
            }
            this.entries.push({ name, method, csize, usize, offset, crc });
            p += 46 + nlen + elen + clen;
        }
        this.names = new Set(this.entries.map((e) => e.name));
    }
    private dataOffset(e: ZEntry) {
        const h = Buffer.alloc(30);
        fs.readSync(this.fd, h, 0, 30, e.offset);
        if (h.readUInt32LE(0) !== 0x04034b50)
            throw new Error(`cabeçalho inválido em ${e.name}`);
        return e.offset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
    }
    read(name: string): Buffer {
        const e = this.entries.find((x) => x.name === name);
        if (!e)
            throw new Error(`não existe no pacote: ${name}`);
        const raw = Buffer.alloc(e.csize);
        if (e.csize)
            fs.readSync(this.fd, raw, 0, e.csize, this.dataOffset(e));
        if (e.method === 0)
            return raw;
        if (e.method === 8)
            return zlib.inflateRawSync(raw);
        throw new Error(`compressão não suportada (${e.method}) em ${name}`);
    }
    extractTo(name: string, target: string) {
        const data = this.read(name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, data);
        return data;
    }
    test(): string {
        for (const e of this.entries) {
            if (e.name.endsWith('/'))
                continue;
            try {
                const d = this.read(e.name);
                if (crc32(d) !== e.crc)
                    return e.name;
            }
            catch {
                return e.name;
            }
        }
        return '';
    }
    close() {
        try {
            fs.closeSync(this.fd);
        }
        catch { /* ignore */ }
    }
}

let CRC_TABLE: Uint32Array | null = null;
function crc32(buf: Buffer) {
    if (!CRC_TABLE) {
        CRC_TABLE = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++)
                c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            CRC_TABLE[n] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++)
        crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

/* ------------------------------ assinatura ------------------------------ */
export function sha256Hex(b: Buffer) {
    return nodeCrypto.createHash('sha256').update(b).digest('hex');
}
export function sha256File(p: string) {
    const h = nodeCrypto.createHash('sha256');
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(1 << 20);
    try {
        let n: number;
        while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0)
            h.update(buf.subarray(0, n));
    }
    finally {
        fs.closeSync(fd);
    }
    return h.digest('hex');
}

export function zipSignatureStatus(z: Zip): 'ok' | 'none' | 'bad' {
    if (!z.names.has(SIG_NAME))
        return 'none';
    try {
        const sig = Buffer.from(z.read(SIG_NAME).toString('ascii').trim().replace(/^"|"$/g, ''), 'hex');
        if (sig.length !== 64)
            return 'bad';
        const h = nodeCrypto.createHash('sha256');
        for (const n of [...z.names].sort()) {
            if (n === SIG_NAME || n.endsWith('/'))
                continue;
            h.update(Buffer.from(n, 'utf8'));
            h.update(Buffer.from([0]));
            h.update(nodeCrypto.createHash('sha256').update(z.read(n)).digest());
        }
        const key = nodeCrypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(PUBLIC_KEY, 'hex')]), format: 'der', type: 'spki' });
        return nodeCrypto.verify(null, h.digest(), key, sig) ? 'ok' : 'bad';
    }
    catch {
        return 'bad';
    }
}

/* ------------------------------ utilidades ------------------------------ */
export function updatesDir(root: string) {
    return path.join(root, 'data', 'updates');
}
function pidAlive(pid: number) {
    if (!pid)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (e: any) {
        return e?.code === 'EPERM';
    }
}
function killPid(pid: number) {
    try {
        if (WIN)
            cp.spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
        else
            process.kill(pid, 'SIGKILL');
    }
    catch { /* ignore */ }
}
function killStrayLaunchers(root: string) {
    if (!WIN)
        return;
    try {
        const ps = 'Get-Process Ludrix,LudrixConsole,electron -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)|$($_.Path)" }';
        const q = cp.spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 20_000 });
        const me = process.pid;
        const rootLow = root.toLowerCase();
        for (const line of String(q.stdout || '').split(/\r?\n/)) {
            const [pid, , p] = line.trim().split('|');
            if (!/^\d+$/.test(pid || '') || Number(pid) === me)
                continue;
            if (p && p.toLowerCase().startsWith(rootLow))
                killPid(Number(pid));
        }
    }
    catch { /* ignore */ }
}
function sleep(ms: number) {
    const sab = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(sab), 0, 0, ms);
}
function rmtreeRetry(p: string, tries = 8) {
    for (let i = 0; i < tries; i++) {
        try {
            fs.rmSync(p, { recursive: true, force: true });
            if (!fs.existsSync(p))
                return;
        }
        catch { /* tenta de novo */ }
        sleep(400 * (i + 1));
    }
    fs.rmSync(p, { recursive: true, force: true });
}
function copyTree(src: string, dst: string) {
    fs.cpSync(src, dst, { recursive: true, force: true, errorOnExist: false });
}
export function writeResult(root: string, data: any) {
    try {
        fs.mkdirSync(updatesDir(root), { recursive: true });
        fs.writeFileSync(path.join(updatesDir(root), 'last_result.json'), JSON.stringify(data), 'utf8');
    }
    catch { /* ignore */ }
}
export function vtuple(v: any): number[] {
    const nums = (String(v || '0').match(/\d+/g) || []).slice(0, 3).map(Number);
    while (nums.length < 3)
        nums.push(0);
    return nums;
}
export function vcmp(a: any, b: any) {
    const x = vtuple(a), y = vtuple(b);
    for (let i = 0; i < 3; i++)
        if (x[i] !== y[i])
            return x[i] < y[i] ? -1 : 1;
    return 0;
}
export function sectionOf(changelog: string, ver: string) {
    const esc = ver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`^## +${esc}\\b[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(changelog);
    return (m ? m[1] : '').trim();
}
export function notesFor(m: any, fromVer: string) {
    const parts: string[] = [];
    for (const sec of m.changelog_all || []) {
        const v = sec.version;
        if ((vcmp(fromVer, v) < 0 && vcmp(v, m.version) <= 0) || (m.restore && vcmp(v, m.version) === 0)) {
            const head = `${sec.version}` + (sec.title ? `  -  ${sec.title}` : '') + (sec.date ? `  (${sec.date})` : '');
            parts.push('## ' + head + '\n' + String(sec.text || '').trim());
        }
    }
    return parts.length ? parts.join('\n\n') : String(m.changelog || '').trim();
}

/* -------------------------------- Apply -------------------------------- */
export class Apply {
    consume = true;
    manifest: any = {};
    backup = '';
    prefix = '';
    constructor(public pkg: string, public root: string, public log: (s: string) => void, public progress: (f: number, t: string) => void) { }

    members(z: Zip, d: string): [string, string][] {
        const p = this.prefix + d + '/';
        return [...z.names].filter((n) => n.startsWith(p) && !n.endsWith('/')).map((n) => [n, n.slice(this.prefix.length)]);
    }

    read(): any {
        const z = new Zip(this.pkg);
        try {
            const m = JSON.parse(z.read('manifest.json').toString('utf8'));
            for (const d of m.dirs || []) {
                if (PROTECTED.includes(d) || d.includes('/') || d.includes('\\') || d.startsWith('.'))
                    throw new Error(`pacote invalido: pasta protegida ${d}`);
            }
            for (const f of Object.keys(m.files || {})) {
                const top = f.split('/')[0];
                if (PROTECTED.includes(top) || f.includes('..') || f.startsWith('/') || f.startsWith('.'))
                    throw new Error(`pacote invalido: arquivo ${f}`);
            }
            m.signed = zipSignatureStatus(z);
            if (m.signed !== 'ok')
                throw new Error(m.signed === 'none' ? 'esse pacote nao tem a assinatura do Ludrix - por seguranca, nao instalo' : 'a assinatura desse pacote nao confere - o arquivo foi alterado ou nao veio do Ludrix');
            this.manifest = m;
            return m;
        }
        finally {
            z.close();
        }
    }

    run(waitPid: number) {
        const m = Object.keys(this.manifest).length ? this.manifest : this.read();
        const ver = String(m.version);
        const dirs: string[] = [...(m.dirs || [])];
        const files: Record<string, string> = { ...(m.files || {}) };
        this.progress(0, 'Preparando...');
        const total = 5 + dirs.length * 2 + Object.keys(files).length;
        let step = 0;
        const tick = (txt: string) => {
            step++;
            this.progress(Math.min(step / total, 0.99), txt);
        };
        if (waitPid) {
            this.log('Aguardando o launcher fechar...');
            let t0 = Date.now();
            while (pidAlive(waitPid)) {
                sleep(250);
                if (Date.now() - t0 > 6000) {
                    this.log('O launcher nao fechou sozinho - encerrando a forca...');
                    killPid(waitPid);
                    break;
                }
            }
            t0 = Date.now();
            while (pidAlive(waitPid) && Date.now() - t0 < 10_000)
                sleep(250);
            if (pidAlive(waitPid))
                throw new Error(`nao consegui encerrar o launcher (PID ${waitPid}) - feche-o pelo Gerenciador de Tarefas e tente de novo`);
            sleep(600);
        }
        killStrayLaunchers(this.root);
        tick('Launcher fechado');
        this.log('Verificando pacote...');
        const z = new Zip(this.pkg);
        try {
            const bad = z.test();
            if (bad)
                throw new Error(`pacote corrompido em ${bad}`);
            for (const d of dirs)
                if (!this.members(z, d).length)
                    throw new Error(`pacote incompleto: falta ${d}/`);
            for (const f of Object.keys(files))
                if (!z.names.has(this.prefix + f))
                    throw new Error(`pacote incompleto: falta ${f}`);
            tick('Pacote integro');
            let prev = '';
            try {
                prev = JSON.parse(fs.readFileSync(path.join(this.root, 'app', 'version.json'), 'utf8')).version || '';
            }
            catch { /* sem versão anterior */ }
            this.backup = path.join(updatesDir(this.root), 'backup', `antes-de-${ver}`);
            rmtreeRetry(this.backup);
            fs.mkdirSync(this.backup, { recursive: true });
            for (const d of dirs) {
                const src = path.join(this.root, d);
                if (fs.existsSync(src)) {
                    this.log(`Backup de ${d}/`);
                    copyTree(src, path.join(this.backup, d));
                }
                tick(`Backup de ${d}/`);
            }
            for (const f of Object.keys(files)) {
                const src = path.join(this.root, f);
                if (fs.existsSync(src)) {
                    fs.mkdirSync(path.dirname(path.join(this.backup, f)), { recursive: true });
                    fs.copyFileSync(src, path.join(this.backup, f));
                }
            }
            tick('Backup pronto');
            const rootRes = path.resolve(this.root) + path.sep;
            for (const d of dirs) {
                this.log(`Removendo ${d}/ antigo`);
                rmtreeRetry(path.join(this.root, d));
                this.log(`Instalando ${d}/ novo`);
                for (const [n, rel] of this.members(z, d)) {
                    const target = path.resolve(this.root, rel);
                    if (!target.startsWith(rootRes))
                        throw new Error(`caminho suspeito no pacote: ${n}`);
                    z.extractTo(n, target);
                }
                tick(`${d}/ atualizado`);
            }
            for (const [f, digest] of Object.entries(files)) {
                this.log(`Trocando ${f}`);
                const target = path.join(this.root, f);
                const tmp = target + '.new';
                fs.mkdirSync(path.dirname(target), { recursive: true });
                z.extractTo(this.prefix + f, tmp);
                if (digest && sha256File(tmp).toLowerCase() !== String(digest).toLowerCase()) {
                    fs.rmSync(tmp, { force: true });
                    throw new Error(`${f}: sha256 nao confere`);
                }
                let done = false;
                for (let i = 0; i < 8 && !done; i++) {
                    try {
                        fs.renameSync(tmp, target);
                        done = true;
                    }
                    catch (e: any) {
                        if (e?.code === 'EPERM' || e?.code === 'EBUSY' || e?.code === 'EACCES') {
                            try {
                                const old = target + '.old';
                                fs.rmSync(old, { force: true });
                                fs.renameSync(target, old);
                                fs.renameSync(tmp, target);
                                done = true;
                            }
                            catch {
                                sleep(400 * (i + 1));
                            }
                        }
                        else
                            throw e;
                    }
                }
                if (!done)
                    fs.renameSync(tmp, target);
                tick(`${f} ok`);
            }
        }
        finally {
            z.close();
        }
        const vf = path.join(this.root, 'app', 'version.json');
        let cur: any = {};
        try {
            cur = fs.existsSync(vf) ? JSON.parse(fs.readFileSync(vf, 'utf8')) : {};
        }
        catch {
            cur = {};
        }
        cur.version = ver;
        cur.date = m.date || '';
        cur.channel = m.channel || cur.channel || 'stable';
        fs.mkdirSync(path.dirname(vf), { recursive: true });
        fs.writeFileSync(vf, JSON.stringify(cur, null, 2), 'utf8');
        try {
            fs.mkdirSync(updatesDir(this.root), { recursive: true });
            fs.writeFileSync(path.join(updatesDir(this.root), 'pending_verify.json'), JSON.stringify({
                version: ver, from: prevVersion(this.root, this.backup), kind: m.kind || '', backup: this.backup, dirs, files: Object.keys(files), at: Date.now() / 1000,
            }), 'utf8');
            fs.mkdirSync(path.join(this.root, 'data'), { recursive: true });
            fs.writeFileSync(path.join(this.root, 'data', 'boot.json'), JSON.stringify({ tries: 0 }), 'utf8');
        }
        catch { /* ignore */ }
        this.keepSeed(ver);
        const bdir = path.join(updatesDir(this.root), 'backup');
        if (fs.existsSync(bdir)) {
            const all = fs.readdirSync(bdir).map((n) => ({ n, t: fs.statSync(path.join(bdir, n)).mtimeMs })).sort((a, b) => a.t - b.t);
            for (const b of all.slice(0, Math.max(0, all.length - 2)))
                fs.rmSync(path.join(bdir, b.n), { recursive: true, force: true });
        }
        this.progress(1, 'Concluido');
    }

    keepSeed(ver: string) {
        const d = updatesDir(this.root);
        const dest = path.join(d, `seed-${ver}${path.extname(this.pkg).toLowerCase()}`);
        try {
            fs.mkdirSync(d, { recursive: true });
            for (const old of fs.readdirSync(d))
                if (old.startsWith('seed-') && path.join(d, old) !== dest)
                    fs.rmSync(path.join(d, old), { force: true });
            if (fs.existsSync(dest))
                fs.rmSync(dest, { force: true });
            if (this.consume) {
                try {
                    fs.renameSync(this.pkg, dest);
                }
                catch {
                    fs.copyFileSync(this.pkg, dest);
                    fs.rmSync(this.pkg, { force: true });
                }
            }
            else
                fs.copyFileSync(this.pkg, dest);
            this.log('Pacote guardado para reparos futuros');
        }
        catch {
            if (this.consume)
                fs.rmSync(this.pkg, { force: true });
        }
    }

    rollback() {
        if (!this.backup || !fs.existsSync(this.backup))
            return;
        this.log('Restaurando versao anterior...');
        for (const d of this.manifest.dirs || []) {
            const b = path.join(this.backup, d);
            if (fs.existsSync(b)) {
                rmtreeRetry(path.join(this.root, d));
                copyTree(b, path.join(this.root, d));
            }
        }
        for (const f of Object.keys(this.manifest.files || {})) {
            const b = path.join(this.backup, f);
            if (fs.existsSync(b)) {
                try {
                    fs.copyFileSync(b, path.join(this.root, f));
                }
                catch { /* ignore */ }
            }
        }
    }
}

function prevVersion(root: string, backup: string) {
    try {
        return JSON.parse(fs.readFileSync(path.join(backup, 'app', 'version.json'), 'utf8')).version || '';
    }
    catch {
        return '';
    }
}

export class Restore extends Apply {
    consume = false;
    read(): any {
        const z = new Zip(this.pkg);
        try {
            if (z.names.has('manifest.json')) {
                const m = super.read();
                m.restore = true;
                m.kind = 'restore';
                m.title = `Voltar para a versao ${m.version}`;
                return m;
            }
            const vj = [...z.names].find((n) => n.endsWith('app/version.json') && (n.match(/\//g) || []).length <= 2);
            if (!vj)
                throw new Error('esse zip nao e um codigo-fonte do Ludrix (falta app/version.json)');
            this.prefix = vj.slice(0, -'app/version.json'.length);
            let vinfo: any = {};
            try {
                vinfo = JSON.parse(z.read(vj).toString('utf8'));
            }
            catch {
                vinfo = {};
            }
            const ver = String(vinfo.version || '');
            if (!/^\d+\.\d+\.\d+/.test(ver))
                throw new Error('versao ilegivel em app/version.json');
            for (const need of ['app/main/index.js', 'app/ui/index.html', 'app/package.json'])
                if (!z.names.has(this.prefix + need))
                    throw new Error(`codigo-fonte incompleto: falta ${need}`);
            let notes = '';
            if (z.names.has(this.prefix + 'CHANGELOG.md')) {
                try {
                    notes = sectionOf(z.read(this.prefix + 'CHANGELOG.md').toString('utf8'), ver);
                }
                catch {
                    notes = '';
                }
            }
            const signed = zipSignatureStatus(z);
            if (signed !== 'ok')
                throw new Error(signed === 'none' ? 'esse codigo-fonte nao tem a assinatura do Ludrix - por seguranca, nao instalo' : 'a assinatura desse codigo-fonte nao confere - o arquivo foi alterado ou e de outra origem');
            this.manifest = { version: ver, kind: 'restore', restore: true, title: `Voltar para a versao ${ver}`, signed, date: vinfo.date || '', channel: vinfo.channel || 'stable', changelog: notes, dirs: ['app'], files: {} };
            return this.manifest;
        }
        finally {
            z.close();
        }
    }
}

/* --------------------------------- CLI --------------------------------- */
function argvOpt(name: string, dflt: string | null = null) {
    const i = process.argv.indexOf(name);
    if (i >= 0 && i + 1 < process.argv.length)
        return process.argv[i + 1];
    return dflt;
}

function touchesRuntime(m: any) {
    const dirs: string[] = m.dirs || [];
    const files = Object.keys(m.files || {});
    return dirs.includes('runtime') || files.some((f) => /^runtime\//.test(f) || /\.exe$/i.test(f) || /^Ludrix(Console)?$/i.test(f));
}

function relocateAndReexec(root: string): boolean {
    const exe = process.execPath;
    const runtime = path.join(root, 'runtime');
    if (!path.resolve(exe).toLowerCase().startsWith((path.resolve(runtime) + path.sep).toLowerCase()))
        return false;
    const tmp = path.join(updatesDir(root), 'tmp-runtime');
    rmtreeRetry(tmp);
    copyTree(runtime, tmp);
    const script = path.join(tmp, 'updater.js');
    fs.copyFileSync(__filename, script);
    const rel = path.relative(runtime, exe);
    const child = cp.spawn(path.join(tmp, rel), [script, ...process.argv.slice(2), '--relocated'], {
        cwd: root, detached: true, stdio: 'ignore', windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    child.unref();
    return true;
}

export function main() {
    const here = path.resolve(__dirname, '..', '..');
    const root = path.resolve(argvOpt('--root', here) as string);
    const restore = process.argv.includes('--restore');
    let pkg = restore ? argvOpt('--restore') : argvOpt('--apply');
    pkg = pkg && !pkg.startsWith('--') ? path.resolve(pkg) : null;
    const waitPid = Number(argvOpt('--wait-pid', '0') || 0);
    const rl = argvOpt('--relaunch');
    const relaunch: string[] | null = rl ? JSON.parse(rl) : null;
    let fromVer = argvOpt('--from', '') || '';
    if (!fromVer) {
        try {
            fromVer = JSON.parse(fs.readFileSync(path.join(root, 'app', 'version.json'), 'utf8')).version || '';
        }
        catch {
            fromVer = '';
        }
    }
    const logFile = path.join(updatesDir(root), 'updater.log');
    const log = (s: string) => {
        try {
            fs.mkdirSync(updatesDir(root), { recursive: true });
            fs.appendFileSync(logFile, `${new Date().toISOString()} ${s}\n`);
        }
        catch { /* ignore */ }
        try {
            process.stdout.write(s + '\n');
        }
        catch { /* ignore */ }
    };
    if (!pkg) {
        log('uso: updater --apply <pacote.lxup> | --restore <zip> [--root R] [--wait-pid N] [--relaunch JSON]');
        process.exit(2);
    }
    const a = restore ? new Restore(pkg, root, log, () => undefined) : new Apply(pkg, root, log, () => undefined);
    let m: any;
    try {
        m = a.read();
    }
    catch (e: any) {
        log('ERRO: ' + (e?.message || e));
        writeResult(root, { ok: false, version: '', restore, error: String(e?.message || e), at: Date.now() / 1000 });
        process.exit(1);
    }
    if (!process.argv.includes('--relocated') && touchesRuntime(m)) {
        try {
            if (relocateAndReexec(root)) {
                log('runtime sera trocado: continuando a partir de uma copia');
                process.exit(0);
            }
        }
        catch (e: any) {
            log('nao consegui copiar o runtime: ' + (e?.message || e));
        }
    }
    let ok = true, err = '';
    try {
        a.run(waitPid);
    }
    catch (e: any) {
        ok = false;
        err = String(e?.message || e);
        log('ERRO: ' + err);
        try {
            a.rollback();
        }
        catch (e2: any) {
            log('rollback falhou: ' + (e2?.message || e2));
        }
    }
    writeResult(root, { ok, version: m.version, kind: m.kind, restore: Boolean(m.restore), error: err, changelog: notesFor(m, fromVer), at: Date.now() / 1000 });
    if (relaunch && relaunch.length) {
        try {
            const env = { ...process.env };
            delete env.ELECTRON_RUN_AS_NODE;
            const child = cp.spawn(relaunch[0], relaunch.slice(1), { cwd: root, detached: true, stdio: 'ignore', windowsHide: false, env });
            child.unref();
        }
        catch (e: any) {
            log('nao consegui reabrir: ' + (e?.message || e));
        }
    }
    if (process.argv.includes('--relocated')) {
        const tmp = path.join(updatesDir(root), 'tmp-runtime');
        try {
            if (WIN)
                cp.spawn('cmd', ['/c', `ping -n 4 127.0.0.1 >nul & rmdir /s /q "${tmp}"`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
            else
                cp.spawn('sh', ['-c', `sleep 3; rm -rf "${tmp}"`], { detached: true, stdio: 'ignore' }).unref();
        }
        catch { /* ignore */ }
    }
    process.exit(ok ? 0 : 1);
}

if (require.main === module)
    main();
