import fs from 'node:fs';
import path from 'node:path';
import * as P from './paths';
import * as log from './log';
import * as util from './util';
import { currentVersion, newer } from './updates';
import { readManifestAsync } from './pkgCheck';

export type Group = 'updates' | 'leftovers' | 'web' | 'meta' | 'legacy';

export interface Found {
    group: Group;
    path: string;
    bytes: number;
    dir?: boolean;
}

export interface Plan {
    items: Found[];
    bytes: number;
    groups: Record<Group, { files: number; bytes: number }>;
}

const OLD_DAYS = 30;
const WEB_DAYS = 14;

const sizeOf = async (p: string, dir: boolean) => dir ? P.dirSizeAsync(p) : (await fs.promises.stat(p)).size;

async function listDir(d: string): Promise<fs.Dirent[]> {
    try {
        return await fs.promises.readdir(d, { withFileTypes: true });
    }
    catch {
        return [];
    }
}

function insideRuntime(p: string) {
    const exe = path.resolve(process.execPath).toLowerCase();
    return exe.startsWith((path.resolve(p) + path.sep).toLowerCase());
}

async function updatesJunk(out: Found[]) {
    const cur = currentVersion();
    const seedKeep = `seed-${cur.version}`;
    for (const e of await listDir(P.UPDATES)) {
        const full = path.join(P.UPDATES, e.name);
        if (e.isDirectory()) {
            if (e.name === 'tmp-runtime' && !insideRuntime(full))
                out.push({ group: 'updates', path: full, bytes: await sizeOf(full, true), dir: true });
            continue;
        }
        const n = e.name.toLowerCase();
        if (/\.(part|tmp|new)$/.test(n)) {
            const st = await fs.promises.stat(full).catch(() => null);
            if (st && Date.now() - st.mtimeMs > 86400_000)
                out.push({ group: 'updates', path: full, bytes: st.size });
            continue;
        }
        if (!n.endsWith('.lxup'))
            continue;
        if (n.startsWith('seed-')) {
            if (!n.startsWith(seedKeep.toLowerCase()))
                out.push({ group: 'updates', path: full, bytes: await sizeOf(full, false) });
            continue;
        }
        let m: any = null;
        try {
            m = await readManifestAsync(full);
        }
        catch { }
        if (!m || !newer(m, cur))
            out.push({ group: 'updates', path: full, bytes: await sizeOf(full, false) });
    }
    const bdir = path.join(P.UPDATES, 'backup');
    const backups: { p: string; t: number }[] = [];
    for (const e of await listDir(bdir)) {
        if (!e.isDirectory() || !e.name.startsWith('antes-de-'))
            continue;
        const full = path.join(bdir, e.name);
        const legacy = ['app/main.py', 'runtime/python.exe', 'runtime/python3.dll'].some((r) => fs.existsSync(path.join(full, r)));
        if (legacy) {
            out.push({ group: 'legacy', path: full, bytes: await sizeOf(full, true), dir: true });
            continue;
        }
        const st = await fs.promises.stat(full).catch(() => null);
        backups.push({ p: full, t: st ? st.mtimeMs : 0 });
    }
    backups.sort((a, b) => b.t - a.t);
    for (const b of backups.slice(2))
        out.push({ group: 'updates', path: b.p, bytes: await sizeOf(b.p, true), dir: true });
}

async function staleFiles(dir: string, out: Found[], depth: number) {
    for (const e of await listDir(dir)) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (depth > 0 && !['data', 'games', 'emulation', 'downloads', 'themes', 'node_modules'].includes(e.name))
                await staleFiles(full, out, depth - 1);
            continue;
        }
        if (!e.isFile())
            continue;
        const n = e.name.toLowerCase();
        if (n.endsWith('.old') || n.endsWith('.new') || n.endsWith('.tmp')) {
            const st = await fs.promises.stat(full).catch(() => null);
            if (st && Date.now() - st.mtimeMs > 3600_000)
                out.push({ group: 'leftovers', path: full, bytes: st.size });
        }
    }
}

async function legacyFiles(out: Found[]) {
    const files = [path.join(P.ROOT, 'updater.exe'), path.join(P.ROOT, 'updater.exe.old'), path.join(P.APP_DIR, 'pyc.json')];
    for (const full of files) {
        const st = await fs.promises.stat(full).catch(() => null);
        if (st && st.isFile())
            out.push({ group: 'legacy', path: full, bytes: st.size });
    }
    for (const d of [path.join(P.APP_DIR, '__pycache__'), path.join(P.APP_DIR, 'core', '__pycache__')])
        if (fs.existsSync(d))
            out.push({ group: 'legacy', path: d, bytes: await sizeOf(d, true), dir: true });
    for (const f of await listDir(P.UPDATES))
        if (f.isFile() && (/^seed-[0-3]\./.test(f.name) || /^ludrix-[0-3]\..*\.lxup$/.test(f.name)))
            out.push({ group: 'legacy', path: path.join(P.UPDATES, f.name), bytes: await sizeOf(path.join(P.UPDATES, f.name), false) });
}

async function oldCache(dir: string, group: Group, days: number, keep: (name: string) => boolean, out: Found[]) {
    const limit = Date.now() - days * 86400_000;
    for (const e of await listDir(dir)) {
        if (!e.isFile() || keep(e.name))
            continue;
        const full = path.join(dir, e.name);
        const st = await fs.promises.stat(full).catch(() => null);
        if (st && st.mtimeMs < limit)
            out.push({ group, path: full, bytes: st.size });
    }
}

export async function plan(knownKeys: () => Set<string>, metaName: (key: string) => string): Promise<Plan> {
    const items: Found[] = [];
    await updatesJunk(items);
    await staleFiles(P.ROOT, items, 0);
    await staleFiles(P.APP_DIR, items, 3);
    await staleFiles(path.join(P.ROOT, 'runtime'), items, 2);
    await legacyFiles(items);
    await oldCache(P.CACHE_WEB, 'web', WEB_DAYS, (n) => n.startsWith('tg_') || !n.endsWith('.json'), items);
    const want = new Set<string>();
    for (const k of knownKeys())
        want.add(metaName(k));
    await oldCache(P.CACHE_META, 'meta', OLD_DAYS, (n) => want.has(n) || !n.endsWith('.json'), items);
    const seen = new Set<string>();
    const uniq = items.filter((it) => !seen.has(it.path) && seen.add(it.path));
    items.length = 0;
    items.push(...uniq);
    const groups = { updates: { files: 0, bytes: 0 }, leftovers: { files: 0, bytes: 0 }, web: { files: 0, bytes: 0 }, meta: { files: 0, bytes: 0 }, legacy: { files: 0, bytes: 0 } };
    let bytes = 0;
    for (const it of items) {
        groups[it.group].files++;
        groups[it.group].bytes += it.bytes;
        bytes += it.bytes;
    }
    return { items, bytes, groups };
}

export async function apply(p: Plan, only?: Group[]) {
    let removed = 0, bytes = 0, failed = 0;
    for (const it of p.items) {
        if (only && !only.includes(it.group))
            continue;
        try {
            await fs.promises.rm(it.path, { recursive: Boolean(it.dir), force: true });
            removed++;
            bytes += it.bytes;
        }
        catch (e: any) {
            failed++;
            log.debug('limpeza: %s: %s', it.path, e?.message || e);
        }
    }
    if (removed)
        log.info('limpeza: %d item(ns), %s liberados%s', removed, util.humanSize(bytes), failed ? `, ${failed} em uso` : '');
    return { removed, bytes, failed };
}

export async function auto(store: any, knownKeys: () => Set<string>, metaName: (key: string) => string, busy: () => boolean, after?: () => Promise<unknown>) {
    if (fs.existsSync(P.PENDING_VERIFY) || busy())
        return;
    const cur = currentVersion();
    const tag = `${cur.version}+${cur.rev || 0}`;
    const c = store.config || {};
    if (c.sweep_ver === tag && util.now() - Number(c.sweep_at || 0) < 7 * 86400)
        return;
    try {
        const p = await plan(knownKeys, metaName);
        if (p.items.length)
            await apply(p);
        if (after)
            await after();
        store.setConfig({ sweep_ver: tag, sweep_at: util.now() });
    }
    catch (e: any) {
        log.warn('limpeza automática: %s', e?.message || e);
    }
}
