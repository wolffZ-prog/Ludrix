import fs from 'node:fs';
import path from 'node:path';
import * as cp from 'node:child_process';
import * as P from './paths';
import * as log from './log';
import * as crypto from './crypto';
import * as util from './util';
import { Zip, Restore, vcmp, sha256File } from './updater';

export const PROTECTED = ['data', 'cache', 'games', 'emulation', 'downloads', 'themes', 'flash', 'bin', 'tools', 'updates'];
export const MAX_UPDATE_BYTES = 600 * 1024 * 1024;
export const DEFAULT_FEED = 'https://github.com/wolffZ-prog/Ludrix/releases/latest/download/ludrix-updates.json';
const VERSION_FILE = path.join(P.APP_DIR, 'version.json');

export function parseVersion(v: any): number[] {
    const nums = (String(v || '0').match(/\d+/g) || []).slice(0, 4).map(Number);
    while (nums.length < 3)
        nums.push(0);
    return nums;
}
const gt = (a: any, b: any) => vcmp(a, b) > 0;

export function currentVersion(): any {
    try {
        return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
    }
    catch {
        return { version: '0.0.0', channel: 'stable' };
    }
}

export function readManifest(pkg: string): any {
    if (!fs.existsSync(pkg))
        throw new Error('Arquivo não encontrado');
    let z: Zip;
    try {
        z = new Zip(pkg);
    }
    catch {
        throw new Error('O arquivo está danificado — baixe de novo');
    }
    try {
        if (!z.names.has('manifest.json'))
            throw new Error('Esse arquivo não é uma atualização do Ludrix');
        let m: any;
        try {
            m = JSON.parse(z.read('manifest.json').toString('utf8'));
        }
        catch {
            throw new Error('O arquivo está danificado — baixe de novo');
        }
        if (!m.version || !['patch', 'full'].includes(m.kind))
            throw new Error('Pacote de atualização inválido — baixe de novo');
        for (const d of m.dirs || []) {
            if (PROTECTED.includes(d) || String(d).includes('/') || String(d).startsWith('.'))
                throw new Error(`Pacote tenta mexer numa pasta protegida: ${d}`);
            if (![...z.names].some((n) => n.startsWith(d + '/')))
                throw new Error(`Pacote incompleto: falta a pasta ${d}/`);
        }
        for (const f of Object.keys(m.files || {}))
            if (!z.names.has(f))
                throw new Error(`Pacote incompleto: falta ${f}`);
        if (m.kind === 'patch' && !(m.dirs || []).includes('app'))
            throw new Error('Patch sem a pasta app/');
        const signed = crypto.zipStatus(pkg);
        if (signed === 'none')
            throw new Error('Esse pacote não tem a assinatura do Ludrix — por segurança, não instalo');
        if (signed !== 'ok')
            throw new Error('A assinatura desse pacote não confere — o arquivo foi alterado ou não veio do Ludrix');
        m._path = pkg;
        m._size = fs.statSync(pkg).size;
        return m;
    }
    finally {
        z.close();
    }
}

export class UpdateManager {
    available: any = null;
    remote: any = null;
    state: any = { busy: false, text: '', error: '', checked_at: 0 };
    constructor(private store: any, private http: any) { }

    status() {
        return {
            current: currentVersion(), available: this.pub(this.available), remote: this.remote, state: { ...this.state },
            feed: this.store.config.update_feed || '', default_feed: DEFAULT_FEED, last_result: this.lastResult(),
            updater_present: Boolean(this.updaterCmd()), frozen: P.FROZEN,
        };
    }

    pub(m: any) {
        if (!m)
            return null;
        const out: any = {};
        for (const [k, v] of Object.entries(m))
            if (!k.startsWith('_'))
                out[k] = v;
        out.path = m._path;
        out.size = m._size;
        return out;
    }

    lastResult() {
        try {
            const r = JSON.parse(fs.readFileSync(path.join(P.UPDATES, 'last_result.json'), 'utf8'));
            return r.shown ? null : r;
        }
        catch {
            return null;
        }
    }

    ackResult() {
        const p = path.join(P.UPDATES, 'last_result.json');
        try {
            const r = JSON.parse(fs.readFileSync(p, 'utf8'));
            r.shown = true;
            fs.writeFileSync(p, JSON.stringify(r), 'utf8');
        }
        catch { /* ignore */ }
        return { ok: true };
    }

    applies(m: any) {
        if (m.kind === 'full')
            return true;
        const mv = m.min_version;
        return !mv || vcmp(mv, currentVersion().version) <= 0;
    }

    async check(online = true) {
        const cur = currentVersion().version;
        this.state.error = '';
        this.state.text = 'Procurando…';
        let best: any = null;
        try {
            fs.mkdirSync(P.UPDATES, { recursive: true });
            for (const n of fs.readdirSync(P.UPDATES).filter((x) => x.endsWith('.lxup')).sort()) {
                const f = path.join(P.UPDATES, n);
                let m: any;
                try {
                    m = readManifest(f);
                }
                catch (e: any) {
                    log.info('ignorando %s: %s', n, e?.message || e);
                    continue;
                }
                if (gt(m.version, cur) && this.applies(m) && (!best || gt(m.version, best.version)))
                    best = m;
            }
        }
        catch (e) {
            log.warn('updates dir: %s', e);
        }
        this.available = best;
        this.remote = null;
        let feed = String(this.store.config.update_feed || '').trim() || DEFAULT_FEED;
        if (feed && online && !feed.toLowerCase().startsWith('https://')) {
            this.state.error = 'O endereço de atualizações precisa começar com https://';
            feed = '';
        }
        if (feed && online) {
            try {
                const r = await this.http.request(feed, { timeout: 12_000, headers: { 'Cache-Control': 'no-cache' } });
                if (r.status >= 400)
                    throw new Error(`HTTP ${r.status}`);
                const data = (await r.json()) || {};
                let pick: any = null;
                for (const it of [data.latest || {}, ...(Array.isArray(data.all) ? data.all : [])]) {
                    if (!it || typeof it !== 'object' || !it.url)
                        continue;
                    if (vcmp(it.version, cur) <= 0 || (pick && vcmp(it.version, pick.version) <= 0))
                        continue;
                    if (it.min_version && gt(it.min_version, cur) && it.kind !== 'full')
                        continue;
                    pick = it;
                }
                if (pick && (!best || gt(pick.version, best.version)))
                    this.remote = pick;
            }
            catch (e: any) {
                this.state.error = `Não consegui consultar o endereço de atualizações (${e?.message || e})`;
                log.warn('feed: %s', e?.message || e);
            }
        }
        this.state.text = '';
        this.state.checked_at = util.now();
        return this.status();
    }

    async download(progressCb?: (f: number) => void) {
        const rem = this.remote;
        if (!rem)
            return { error: 'Nenhuma atualização remota' };
        const dest = path.join(P.UPDATES, `ludrix-${rem.version}-${rem.kind || 'patch'}.lxup`);
        const tmp = dest.replace(/\.lxup$/, '.part');
        this.state.busy = true;
        this.state.text = 'Baixando atualização…';
        this.state.error = '';
        try {
            const url = String(rem.url || '');
            if (!url.toLowerCase().startsWith('https://'))
                throw new Error('Atualização recusada: o endereço não usa https');
            fs.mkdirSync(P.UPDATES, { recursive: true });
            const r = await this.http.request(url, { timeout: 60_000 });
            if (r.status >= 400)
                throw new Error(`HTTP ${r.status}`);
            const total = Number(r.headers.get('content-length') || 0);
            if (total > MAX_UPDATE_BYTES)
                throw new Error('Atualização recusada: arquivo grande demais');
            const body = r.body as ReadableStream<Uint8Array> | null;
            if (!body)
                throw new Error('resposta vazia');
            const out = fs.createWriteStream(tmp);
            let got = 0;
            const reader = body.getReader();
            try {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    got += value.byteLength;
                    if (got > MAX_UPDATE_BYTES)
                        throw new Error('Atualização recusada: arquivo grande demais');
                    if (!out.write(Buffer.from(value)))
                        await new Promise<void>((res) => out.once('drain', () => res()));
                    if (progressCb && total)
                        progressCb(got / total);
                }
            }
            finally {
                await new Promise<void>((res) => out.end(() => res()));
            }
            if (rem.sha256 && sha256File(tmp).toLowerCase() !== String(rem.sha256).toLowerCase()) {
                fs.rmSync(tmp, { force: true });
                throw new Error('O arquivo baixado veio diferente do esperado e foi descartado por segurança — tente de novo');
            }
            fs.renameSync(tmp, dest);
            this.available = readManifest(dest);
            this.remote = null;
            return { ok: true, available: this.pub(this.available) };
        }
        catch (e: any) {
            try {
                fs.rmSync(tmp, { force: true });
            }
            catch { /* ignore */ }
            this.state.error = String(e?.message || e);
            return { error: String(e?.message || e) };
        }
        finally {
            this.state.busy = false;
            this.state.text = '';
        }
    }

    addFile(p: string | null | undefined) {
        if (!p)
            return { error: 'Nenhum arquivo' };
        let m: any;
        try {
            m = readManifest(p);
        }
        catch (e: any) {
            return { error: String(e?.message || e) };
        }
        const cur = currentVersion().version;
        if (vcmp(m.version, cur) <= 0)
            return { error: `Esse pacote é da versão ${m.version} — você já está na ${cur}` };
        if (!this.applies(m))
            return { error: `Esse patch precisa da versão ${m.min_version} instalada antes` };
        fs.mkdirSync(P.UPDATES, { recursive: true });
        const dest = path.join(P.UPDATES, path.basename(p));
        if (path.resolve(p) !== path.resolve(dest))
            fs.copyFileSync(p, dest);
        this.available = readManifest(dest);
        return { ok: true, available: this.pub(this.available) };
    }

    updaterCmd(): string[] | null {
        const gui = path.join(__dirname, 'updaterGui.js');
        const work = path.join(__dirname, 'updaterWork.js');
        if (!fs.existsSync(gui) || !fs.existsSync(work))
            return null;
        const app = (() => { try { return require('electron').app; } catch { return null; } })();
        return [process.execPath, ...(app && process.defaultApp ? [app.getAppPath()] : []), '--updater'];
    }

    launcherCmd(): string[] {
        const stub = path.join(P.ROOT, process.platform === 'win32' ? 'Ludrix.exe' : 'Ludrix');
        if (P.FROZEN && fs.existsSync(stub))
            return [stub];
        if (P.FROZEN && !process.defaultApp)
            return [process.execPath];
        return [process.execPath, P.APP_DIR];
    }

    static readRestore(p: string | null | undefined, allowSame = false) {
        if (!p)
            return { error: 'Nenhum arquivo' };
        if (!fs.existsSync(p))
            return { error: 'Arquivo não encontrado' };
        let m: any;
        try {
            m = new Restore(p, P.ROOT, () => undefined, () => undefined).read();
        }
        catch (e: any) {
            const msg = String(e?.message || e);
            return { error: /zip inválido|diretório central/i.test(msg) ? 'O arquivo está danificado' : msg };
        }
        const cur = currentVersion().version || '';
        const same = vcmp(m.version, cur) === 0;
        if (same && !allowSame)
            return { error: `Essa já é a versão instalada (${cur})` };
        return { ok: true, version: m.version, current: cur, same, newer: gt(m.version, cur), changelog: m.changelog || '', path: p };
    }

    apply(relaunch = true, restore: string | null = null) {
        if (process.env.APPIMAGE)
            return { error: 'No AppImage a atualização é trocar o arquivo .AppImage pelo novo.' };
        let pkg: string;
        if (restore) {
            const r: any = UpdateManager.readRestore(restore);
            if (r.error)
                return r;
            pkg = restore;
        }
        else {
            if (!this.available)
                return { error: 'Nenhuma atualização pronta pra aplicar' };
            pkg = this.available._path;
        }
        const cmd = this.updaterCmd();
        if (!cmd)
            return { error: 'O atualizador (updater) não está na pasta do launcher — extraia o pacote completo de novo por cima' };
        const args = [...cmd.slice(1), restore ? '--restore' : '--apply', pkg, '--root', P.ROOT, '--wait-pid', String(process.pid), '--from', String(currentVersion().version || '?')];
        if (relaunch)
            args.push('--relaunch', JSON.stringify(this.launcherCmd()));
        try {
            const env = { ...process.env };
            delete env.ELECTRON_RUN_AS_NODE;
            const child = cp.spawn(cmd[0], args, { cwd: P.ROOT, detached: true, stdio: 'ignore', windowsHide: false, env });
            child.unref();
        }
        catch (e: any) {
            return { error: `Não consegui abrir o updater: ${e?.message || e}` };
        }
        setTimeout(() => {
            try {
                require('electron').app.exit(0);
            }
            catch {
                process.exit(0);
            }
        }, 6000).unref?.();
        return { ok: true, quit: true };
    }
}
