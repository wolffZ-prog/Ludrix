import fs from 'node:fs';
import path from 'node:path';
import * as cp from 'node:child_process';
import AdmZip from 'adm-zip';
import * as P from './paths';
import * as log from './log';
import * as http from './http';
import * as installer_types from './installer-types';
const ZIP_EXT = new Set(['.zip', '.lxtheme', '.lxup']);
const SEVENZ_EXT = new Set([
    '.7z', '.rar', '.001', '.iso', '.tar', '.gz', '.bz2', '.xz', '.cab', '.exe',
    '.mdf', '.nrg', '.img', '.wim', '.arj', '.lzma', '.z', '.tgz', '.tbz2', '.txz',
]);
const SEVENZ_URL_WIN = 'https://www.7-zip.org/a/7zr.exe'
function sevenZipPath() {
    const local = path.join(P.BIN, process.platform === 'win32' ? '7zr.exe' : '7zz');
    if (fs.existsSync(local))
        return local;
    if (process.platform !== 'win32') {
        for (const c of ['7zz', '7z', '7za', 'p7zip']) {
            try {
                const found = require('node:child_process').execSync(`command -v ${c} 2>/dev/null`, { encoding: 'utf8' }).trim();
                if (found)
                    return found;
            }
            catch {
            }
        }
    }
    for (const p of [
        'C:\\Program Files\\7-Zip\\7z.exe',
        'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    ]) {
        if (fs.existsSync(p))
            return p;
    }
    return null;
}
async function ensureSevenZip(session = http.shared) {
    const found = sevenZipPath();
    if (found)
        return found;
    if (process.platform !== 'win32')
        return null;
    try {
        const r = await session.request(SEVENZ_URL_WIN, { timeout: 120_000 });
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 50_000)
            return null;
        fs.mkdirSync(P.BIN, { recursive: true });
        const dest = path.join(P.BIN, '7zr.exe');
        fs.writeFileSync(dest, buf);
        log.info('7-Zip instalado em %s', dest);
        return dest;
    }
    catch (e) {
        log.warn('7-Zip: %s', e);
        return null;
    }
}
function isArchive(file) {
    const ext = path.extname(file).toLowerCase();
    return ZIP_EXT.has(ext) || SEVENZ_EXT.has(ext);
}
function listZip(file) {
    try {
        const zip = new AdmZip(file);
        return zip.getEntries().map((e) => ({
            name: e.entryName,
            size: e.header?.size || 0,
            dir: e.isDirectory,
        }));
    }
    catch (e) {
        return [];
    }
}
async function extract(file, dest, opts: any = {}) {
    fs.mkdirSync(dest, { recursive: true });
    const ext = path.extname(file).toLowerCase();
    if (ZIP_EXT.has(ext))
        return extractZip(file, dest, opts);
    return extractSevenZip(file, dest, opts);
}
function extractZip(file, dest, opts) {
    const zip = new AdmZip(file);
    const entries = zip.getEntries();
    let i = 0;
    for (const e of entries) {
        if (opts.cancel?.aborted)
            throw new installer_types.CancelledError();
        zip.extractEntryTo(e, dest, true, true, false, opts.password || undefined);
        i++;
        if (opts.onProgress && i % 25 === 0) {
            opts.onProgress(i / entries.length, `Extraindo ${i}/${entries.length}`);
        }
    }
    return normalizeRoot(dest, Boolean(opts.stripRoot));
}
function extractSevenZip(file, dest, opts) {
    return new Promise<any>((resolve, reject) => {
        void ensureSevenZip().then((exe) => {
            if (!exe) {
                reject(new Error('7-Zip indisponivel: instale o 7-Zip ou use um arquivo .zip'));
                return;
            }
            const args = ['x', '-y', `-o${dest}`, '-bsp1'];
            if (opts.password)
                args.push(`-p${opts.password}`);
            args.push(file);
            const proc = cp.spawn(exe, args, { windowsHide: true });
            let out = '';
            const kill = () => {
                try {
                    proc.kill('SIGKILL');
                }
                catch {
                }
            };
            const poll = setInterval(() => {
                if (opts.cancel?.aborted) {
                    clearInterval(poll);
                    kill();
                    reject(new installer_types.CancelledError());
                }
            }, 400);
            proc.stdout?.on('data', (d) => {
                out += d.toString('utf8');
                const m = /(\d+)%/.exec(out.slice(-64));
                if (m && opts.onProgress)
                    opts.onProgress(Number(m[1]) / 100, `Extraindo ${m[1]}%`);
            });
            proc.stderr?.on('data', (d) => {
                out += d.toString('utf8');
            });
            proc.on('error', (e) => {
                clearInterval(poll);
                reject(e);
            });
            proc.on('close', (code) => {
                clearInterval(poll);
                if (opts.cancel?.aborted)
                    return;
                if (code !== 0) {
                    reject(new Error(`7-Zip terminou com erro ${code}: ${out.slice(-200)}`));
                    return;
                }
                try {
                    resolve(normalizeRoot(dest, Boolean(opts.stripRoot)));
                }
                catch (e) {
                    reject(e);
                }
            });
        });
    });
}
function normalizeRoot(dir, force = false) {
    try {
        const entries = fs.readdirSync(dir).filter((f) => !f.startsWith('.'));
        if (entries.length !== 1)
            return dir;
        const only = path.join(dir, entries[0]);
        if (!fs.statSync(only).isDirectory())
            return dir;
        if (!force) {
            const inner = fs.readdirSync(only);
            const hasExe = inner.some((f) => /\.(exe|bat|cmd|lnk|sh)$/i.test(f));
            const hasNested = inner.some((f) => fs.statSync(path.join(only, f)).isDirectory());
            if (!hasExe && !hasNested)
                return dir;
        }
        const tmp = dir + '.unstage';
        fs.renameSync(only, tmp);
        for (const f of fs.readdirSync(tmp)) {
            fs.renameSync(path.join(tmp, f), path.join(dir, f));
        }
        fs.rmdirSync(tmp);
        return dir;
    }
    catch {
        return dir;
    }
}
function zipFolder(srcDir, outFile) {
    const zip = new AdmZip();
    zip.addLocalFolder(srcDir);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    zip.writeZip(outFile);
    return outFile;
}

export { sevenZipPath, ensureSevenZip, isArchive, listZip, extract, normalizeRoot, zipFolder, SEVENZ_URL_WIN };
