import fs from 'node:fs';
import path from 'node:path';
import * as P from './paths';
import * as crypto from './crypto';

export const MANIFEST = 'integrity.json';
const SKIP_DIRS = new Set(['__pycache__', '.git', 'node_modules']);
const SKIP_EXT = new Set(['.pyc', '.pyo', '.log', '.tmp', '.part', '.bak', '.map']);
const CRITICAL_PREFIX = ['main/', 'ui/app.js', 'ui/app.css', 'ui/index.html', 'ui/lang/', 'assets/presets/', 'package.json'];
let cache: any = null;

const today = () => new Date().toISOString().slice(0, 10);

function walk(root: string, rel = ''): string[] {
    const out: string[] = [];
    let ents: fs.Dirent[];
    try {
        ents = fs.readdirSync(root, { withFileTypes: true });
    }
    catch {
        return out;
    }
    for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
            if (!SKIP_DIRS.has(e.name))
                out.push(...walk(path.join(root, e.name), r));
        }
        else if (e.isFile() && !SKIP_EXT.has(path.extname(e.name).toLowerCase()))
            out.push(r);
    }
    return out;
}

function entry(rel: string, data: Buffer) {
    const e: any = { sha256: crypto.sha256Hex(data), size: data.length };
    if (rel === 'version.json')
        e.version_only = true;
    return e;
}

export function build(app: string, version: string) {
    const files: Record<string, any> = {};
    for (const rel of walk(app)) {
        if (rel === MANIFEST)
            continue;
        files[rel] = entry(rel, fs.readFileSync(path.join(app, rel)));
    }
    return { format: 1, version, built: today(), files };
}

export function write(app: string, version: string) {
    const out = path.join(app, MANIFEST);
    fs.writeFileSync(out, JSON.stringify(build(app, version)), 'utf8');
    return out;
}

export function load(app: string): any | null {
    const p = path.join(app, MANIFEST);
    if (!fs.existsSync(p))
        return null;
    try {
        const m = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (!m || typeof m.files !== 'object' || !m.version)
            return null;
        return m;
    }
    catch {
        return null;
    }
}

function checkOne(app: string, rel: string, e: any, version: string): string {
    const p = path.join(app, rel);
    if (e.version_only) {
        try {
            return String(JSON.parse(fs.readFileSync(p, 'utf8')).version) === String(version) ? '' : 'alterado';
        }
        catch {
            return fs.existsSync(p) ? 'alterado' : 'faltando';
        }
    }
    if (!fs.existsSync(p))
        return 'faltando';
    try {
        const st = fs.statSync(p);
        if (e.size !== undefined && st.size !== e.size)
            return 'alterado';
        return crypto.sha256File(p) === e.sha256 ? '' : 'alterado';
    }
    catch {
        return 'alterado';
    }
}

export function verify(app: string) {
    const m = load(app);
    if (!m)
        return null;
    const bad: any[] = [];
    for (const [rel, e] of Object.entries<any>(m.files)) {
        const why = checkOne(app, rel, e, m.version);
        if (why)
            bad.push({ file: rel, why });
    }
    return { version: String(m.version), ok: !bad.length, bad, checked: Object.keys(m.files).length, critical: isCritical(bad), at: Date.now() / 1000 };
}

export function isCritical(bad: any[]) {
    return bad.some((b) => CRITICAL_PREFIX.some((pre) => String(b.file).startsWith(pre)));
}

export function seedDir(root: string) {
    return path.join(root, 'data', 'updates');
}

export function keepSeed(pkg: string, root: string, version: string, move: boolean): string | null {
    const d = seedDir(root);
    try {
        fs.mkdirSync(d, { recursive: true });
        const dest = path.join(d, `seed-${version}${path.extname(pkg).toLowerCase()}`);
        for (const old of fs.readdirSync(d)) {
            if (old.startsWith('seed-') && path.join(d, old) !== dest)
                fs.rmSync(path.join(d, old), { force: true });
        }
        if (fs.existsSync(dest))
            fs.rmSync(dest, { force: true });
        if (move) {
            try {
                fs.renameSync(pkg, dest);
            }
            catch {
                fs.copyFileSync(pkg, dest);
                fs.rmSync(pkg, { force: true });
            }
        }
        else {
            fs.copyFileSync(pkg, dest);
        }
        return dest;
    }
    catch {
        return null;
    }
}

function seedOpen(file: string, version: string): { zip: any; base: string; manifest: any } | null {
    const AdmZip = require('adm-zip');
    let zip: any;
    try {
        zip = new AdmZip(file);
    }
    catch {
        return null;
    }
    const tail = 'app/' + MANIFEST;
    const hit = zip.getEntries().find((e: any) => String(e.entryName).endsWith(tail));
    if (!hit)
        return null;
    const prefix = String(hit.entryName).slice(0, -tail.length);
    let sm: any;
    try {
        sm = JSON.parse(zip.readAsText(hit, 'utf8'));
    }
    catch {
        return null;
    }
    if (String(sm.version) !== String(version))
        return null;
    return { zip, base: prefix + 'app/', manifest: sm };
}

export function findSeed(root: string, version: string): string | null {
    const d = seedDir(root);
    if (!fs.existsSync(d))
        return null;
    for (const n of fs.readdirSync(d).filter((x) => x.startsWith('seed-')).sort()) {
        const p = path.join(d, n);
        try {
            if (seedOpen(p, version))
                return p;
        }
        catch { /* próximo */ }
    }
    return null;
}

function writeAtomic(p: string, data: Buffer) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = p + '.new';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, p);
}

export function repair(app: string, root: string, result: any, seed: string) {
    const m = load(app) || { files: {} };
    const r = seedOpen(seed, result.version);
    if (!r)
        return { fixed: [], left: [...result.bad], error: 'seed inválido' };
    const fixed: any[] = [], left: any[] = [];
    const names = new Set(r.zip.getEntries().map((e: any) => String(e.entryName)));
    for (const b of result.bad) {
        const rel = String(b.file);
        const e = (m.files || {})[rel] || {};
        let ok = false;
        try {
            if (e.version_only && names.has(r.base + rel)) {
                let cur: any = {};
                try {
                    cur = JSON.parse(fs.readFileSync(path.join(app, rel), 'utf8'));
                }
                catch { /* vazio */ }
                const seedv = JSON.parse(r.zip.readAsText(r.base + rel, 'utf8'));
                Object.assign(cur, seedv);
                cur.version = result.version;
                writeAtomic(path.join(app, rel), Buffer.from(JSON.stringify(cur, null, 2), 'utf8'));
                ok = true;
            }
            else if (names.has(r.base + rel)) {
                const data: Buffer = r.zip.readFile(r.base + rel);
                if (crypto.sha256Hex(data) === e.sha256) {
                    writeAtomic(path.join(app, rel), data);
                    ok = true;
                }
            }
        }
        catch {
            ok = false;
        }
        (ok ? fixed : left).push(b);
    }
    return { fixed, left };
}

export function stateFile(root: string) {
    return path.join(root, 'data', 'integrity-state.json');
}

export function bootCheck(app: string, root: string) {
    let res = verify(app);
    if (!res) {
        cache = { status: 'skipped', bad: [], fixed: [], critical: false, version: '', checked: 0 };
        return cache;
    }
    const out: any = { status: 'ok', bad: [], fixed: [], critical: false, version: res.version, checked: res.checked, seed: '' };
    if (!res.ok) {
        const seed = findSeed(root, res.version);
        out.seed = seed || '';
        if (seed) {
            const rep = repair(app, root, res, seed);
            out.fixed = rep.fixed;
            res = verify(app) || res;
        }
        out.bad = res.bad;
        out.critical = isCritical(res.bad);
        out.status = res.bad.length ? 'damaged' : 'repaired';
    }
    try {
        const sf = stateFile(root);
        fs.mkdirSync(path.dirname(sf), { recursive: true });
        fs.writeFileSync(sf, JSON.stringify({ ...out, at: Date.now() / 1000 }), 'utf8');
    }
    catch { /* ignore */ }
    cache = out;
    return out;
}

export function last(root: string) {
    if (cache)
        return cache;
    try {
        return JSON.parse(fs.readFileSync(stateFile(root), 'utf8'));
    }
    catch {
        return null;
    }
}

export function now(app: string, root: string) {
    const res = verify(app);
    if (!res)
        return { status: 'skipped', bad: [], checked: 0, version: '', critical: false, seed: '' };
    const seed = res.ok ? null : findSeed(root, res.version);
    return { status: res.ok ? 'ok' : 'damaged', bad: res.bad, checked: res.checked, version: res.version, critical: res.critical, seed: seed || '' };
}

export function repairNow(app: string, root: string) {
    const res = verify(app);
    if (!res || res.ok)
        return now(app, root);
    const seed = findSeed(root, res.version);
    if (!seed)
        return { ...now(app, root), error: 'sem pacote desta versão para reparar' };
    const rep = repair(app, root, res, seed);
    const out: any = now(app, root);
    out.fixed = rep.fixed;
    cache = { ...out, status: out.bad.length ? out.status : 'repaired' };
    return out;
}

export function appDirForIntegrity() {
    return P.APP_DIR;
}
