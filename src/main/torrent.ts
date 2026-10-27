import fs from 'node:fs';
import path from 'node:path';
import * as cp from 'node:child_process';
import AdmZip from 'adm-zip';
import * as P from './paths';
import * as log from './log';
import * as http from './http';
import * as installer_types from './installer-types';
const nativeImport = new Function('spec', 'return import(spec);');
let WtModule;
async function loadWebTorrent() {
    if (WtModule !== undefined)
        return WtModule;
    try {
        const mod = await nativeImport('webtorrent');
        WtModule = mod.default || mod;
    }
    catch (e) {
        log.warn('webtorrent indisponivel: %s', e);
        WtModule = null;
    }
    return WtModule;
}
let QUIET = false;
let HOLD = false;
export function setHold(on: boolean) {
    if (HOLD === Boolean(on))
        return;
    HOLD = Boolean(on);
    const c = TorrentClient.instance;
    if (c && c.client)
        for (const t of c.client.torrents || []) {
            try {
                c.applyLimits(t);
            }
            catch { }
        }
}
export function setQuiet(on: boolean) {
    QUIET = Boolean(on);
    const c = TorrentClient.instance;
    if (c && c.client) {
        for (const t of c.client.torrents || []) {
            try {
                c.applyLimits(t);
            }
            catch { }
        }
    }
}
class TorrentClient {
    cfg;
    static instance = null;
    client = null;
    constructor(cfg) {
        this.cfg = cfg;
    }
    static get(cfg) {
        if (!TorrentClient.instance)
            TorrentClient.instance = new TorrentClient(cfg);
        TorrentClient.instance.cfg = cfg;
        return TorrentClient.instance;
    }
    limits() {
        const quiet = QUIET;
        let down = Number(this.cfg.torrent_max_down || 0) * 1024;
        let up = Number(this.cfg.torrent_max_up || 0) * 1024;
        if (quiet) {
            down = Math.min(down || 512 * 1024, 512 * 1024);
            up = Math.min(up || 64 * 1024, 64 * 1024);
        }
        if (HOLD) {
            down = 1024;
            up = 1024;
        }
        return { down, up, quiet };
    }
    async ensureClient() {
        if (this.client)
            return this.client;
        const WT = await loadWebTorrent();
        if (!WT)
            return null;
        this.client = new WT({
            dht: false,
            lsd: false,
            natUpnp: false,
            natPmp: false,
        });
        return this.client;
    }
    applyLimits(t) {
        const { down, up } = this.limits();
        try {
            t?.client?.throttleDownload?.(down);
            t?.client?.throttleUpload?.(up);
        }
        catch {
        }
    }
    maybeClose() {
        try {
            if (this.client && !this.client.torrents?.length) {
                this.client.destroy(() => undefined);
                this.client = null;
            }
        }
        catch {
        }
    }
    async download(source, destDir, cb, cancel, session) {
        fs.mkdirSync(destDir, { recursive: true });
        const client = await this.ensureClient();
        if (!client)
            throw new Error('Motor de torrent indisponivel: o webtorrent nao carregou');
        const before = new Set(fs.existsSync(destDir) ? fs.readdirSync(destDir) : []);
        cb(-1, 'Procurando peers...');
        const torrent = await new Promise<any>((resolve, reject) => {
            let t;
            try {
                t = client.add(source, { path: destDir }, (tt) => resolve(tt));
            }
            catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)));
                return;
            }
            t.on('error', (e) => reject(e));
        });
        this.applyLimits(torrent);
        const seedAfter = Boolean(this.cfg.torrent_seed_after);
        try {
            await new Promise<any>((resolve, reject) => {
                const tick = setInterval(() => {
                    if (cancel.aborted) {
                        clearInterval(tick);
                        reject(new installer_types.CancelledError());
                        return;
                    }
                    const total = torrent.length || 0;
                    const done = torrent.downloaded || 0;
                    if (total > 0 && done >= total) {
                        clearInterval(tick);
                        resolve(undefined);
                        return;
                    }
                    if (torrent.progress >= 1 && total > 0) {
                        clearInterval(tick);
                        resolve(undefined);
                        return;
                    }
                    const eta = torrent.downloadSpeed > 0 ? (total - done) / torrent.downloadSpeed : 0;
                    const frac = total ? done / total : -1;
                    cb(frac, `${(0, installer_types.humanSize)(done)} / ${(0, installer_types.humanSize)(total)}  •  ↓ ${(0, installer_types.humanSize)(torrent.downloadSpeed)}/s  ` +
                        `↑ ${(0, installer_types.humanSize)(torrent.uploadSpeed)}/s  •  ${torrent.numPeers} peers  •  ` +
                        `ETA ${Math.floor(eta / 60)}m${String(Math.floor(eta % 60)).padStart(2, '0')}s`);
                }, 700);
                torrent.on('error', (e) => {
                    clearInterval(tick);
                    reject(e);
                });
            });
        }
        finally {
            try {
                client.remove(torrent, { destroyStore: false }, () => undefined);
            }
            catch {
            }
            this.maybeClose();
        }
        void seedAfter;
        const after = fs.existsSync(destDir) ? fs.readdirSync(destDir) : [];
        const fresh = after.filter((f) => !before.has(f) && !f.endsWith('.torrent'));
        if (fresh.length === 1) {
            const p = path.join(destDir, fresh[0]);
            if (fs.existsSync(p))
                return p;
        }
        const named = path.join(destDir, torrent.name || '');
        return fs.existsSync(named) ? named : destDir;
    }

}
function available() {
    return WtModule !== null;
}
function engine() {
    return WtModule !== null ? 'webtorrent' : 'none';
}

export { available, engine, TorrentClient };
