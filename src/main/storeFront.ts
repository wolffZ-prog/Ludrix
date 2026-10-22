/**
 * storeFront.ts — integra os modulos novos (Store, downloads, torrent,
 * emulacao, importacoes, atualizacoes) com o backend da biblioteca.
 *
 * E a peca que o backend.py do original fazia dentro de ludrix.py: orquestrar
 * fila, provedores e instalacao, avisando a interface a cada etapa.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as P from './paths';
import * as log from './log';
import * as hosts from './hosts';
import * as emulation from './emulation';
import * as importers from './importers';
import * as updates from './updates';
import * as integrity from './integrity';
import * as torrent from './torrent';
import * as downloader from './downloader';
import * as installer from './installer';
import * as http from './http';
import * as installer_types from './installer-types';
import * as util from './util';
function hostOf(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    }
    catch {
        return 'link';
    }
}
import { prog } from './jobs';
import { normalizeTitle, titleFromPath } from './titles';
import { Entry, FileRef, makeEntry, basename } from './repos';

function needsResolve(src: string): boolean {
    return /^(tg|srr):/.test(String(src || ''));
}

function autoPick(files: FileRef[]): FileRef[] {
    const parts = files.filter((f) => /\.\d{3}$/.test(f.name));
    if (parts.length)
        return [...parts].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return files.slice(0, 1);
}
class StoreFront {
    be;
    queue;
    get jobs() {
        return this.be.jobs.jobs;
    }
    session = new http.Session();
    constructor(be) {
        this.be = be;
        this.queue = new downloader.DownloadQueue(Number(be.store.config.concurrent_downloads || 2));
        this.updates = new updates.UpdateManager(be.store, this.session);
    }
    /* ------------------------------- catalogo ------------------------------- */
    repoList() {
        return this.be.repos.list();
    }
    repoErrors() {
        return this.be.cat.state.errors;
    }
    repoAdd(spec) {
        this.be.repos.add(spec || {});
        this.be.reloadCatalog(false);
        return { ok: true };
    }
    repoUpdate(id, patch) {
        this.be.repos.update(String(id || ''), patch || {});
        this.be.reloadCatalog(false);
        return { ok: true };
    }
    repoRemove(id) {
        this.be.repos.remove(String(id || ''));
        this.be.reloadCatalog(false);
        return { ok: true };
    }
    repoToggle(id, enabled) {
        this.be.repos.setEnabled(String(id || ''), Boolean(enabled));
        this.be.reloadCatalog(false);
        return { ok: true };
    }
    siteSearch(q) {
        return this.be.cat.siteSearch(q);
    }
    /* ------------------------------- downloads ------------------------------- */
    /** Mostra o que um link oferece, antes de baixar. */
    async linkPreview(url) {
        url = String(url || '').trim();
        this.be.act('Lendo o link…');
        let files;
        try {
            files = await hosts.resolve(url, this.session);
        }
        catch (e) {
            return { error: String(e?.message || e), host: hosts.knownHost(url) };
        }
        finally {
            this.be.act('');
        }
        const names = files.map((f) => String(f.name || ''));
        let base = names[0] || '';
        if (names.length > 1) {
            let pre = names[0];
            for (const n of names.slice(1)) {
                let i = 0;
                while (i < pre.length && i < n.length && pre[i] === n[i])
                    i++;
                pre = pre.slice(0, i);
            }
            base = pre.replace(/[ ._-]+$/, '') || names[0];
        }
        const title = normalizeTitle(base.replace(/\.(7z|zip|rar|001|iso|exe|part\d+)$/i, '')) || 'Jogo';
        const parts = names.filter((n) => /\.(\d{3}|part\d+\.rar|z\d\d)$/i.test(n)).length;
        return {
            host: files[0]?.host || hosts.knownHost(url) || hostOf(url), title, total: files.reduce((a, f) => a + Number(f.size || 0), 0),
            files: files.map((f, i) => ({ name: f.name, size: Number(f.size || 0), i })),
            hint: parts > 1 ? 'arquivo dividido em partes — baixo todas e junto na extração' : '',
        };
    }
    linkDownload(url, title, kind = 'pc', system = 'pc', picks) {
        url = String(url || '').trim();
        if (!/^(https?:\/\/|magnet:\?)/i.test(url))
            return { error: 'Cole um link http(s) ou magnet' };
        title = normalizeTitle(title || '') || 'Jogo';
        const key = 'local:' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (this.be.jobs.has(key))
            return { error: 'Já em andamento' };
        let root: string;
        if (kind === 'rom' && system !== 'pc')
            root = path.join(P.EMU_GAMES, system);
        else {
            kind = 'pc';
            system = 'pc';
            root = this.be.store.gamesDir();
        }
        fs.mkdirSync(root, { recursive: true });
        const e = makeEntry({ key, repo: 'local', id: title, title, kind, system, page_url: url });
        const keep = Boolean(this.be.store.config.keep_archive);
        const r = this.hostedJob(e, url, root, keep, picks, { m: 'link_download', a: [url, title, kind, system, picks] });
        if (r.ok)
            this.be.notify('info', `${title}: download começou`, `Via ${hosts.knownHost(url) || 'link direto'} — acompanhe na Fila.`, key);
        return r;
    }
    hostedJob(e: Entry, url: string, root: string, keep: boolean, picks: number[] | null | undefined, retry: any) {
        if (this.be.jobs.has(e.key))
            return { error: 'Já em andamento' };
        return this.be.jobs.run(e.key, e.title, 'install', async (cb, cancel) => {
            cb(prog('download', -1, 'Lendo o link...'));
            let files: any[] = await hosts.resolve(url, this.session);
            if (picks && picks.length) {
                const sel = files.filter((_, i) => picks.includes(i));
                files = sel.length ? sel : files;
            }
            const refs: installer.DlRef[] = files.map((f) => ({
                name: f.name, url: f.lazy || !f.url ? 'lazy://' : f.url, size: Number(f.size || 0),
                headers: f.lazy ? {} : (f.headers || {}), cookies: f.cookies || {}, decrypt: f.decrypt || null, _res: f,
            }));
            const resolver: installer.Resolver = async (fr) => {
                if (fr._res.host === 'itch.io') {
                    const fin: any = await hosts.itchFinal(fr._res, this.session);
                    return [fin.url, {}, fin.name, fin.size];
                }
                return [await hosts.megaFolderLink(fr._res, this.session), fr.headers || {}];
            };
            const [gameDir, exes] = await installer.installGame(refs, e.title, root, cb, cancel, keep, this.session, resolver);
            return this.finishInstall(e, gameDir, exes);
        }, retry);
    }
    installRoot(e: Entry, dest: string | null = null): string {
        if (e.kind === 'rom' && e.system !== 'pc') {
            if (dest)
                return dest;
            return this.romDest(e.system);
        }
        if (e.kind === 'recomp')
            return path.join(P.GAMES, '_recomp');
        return this.be.store.gamesDir();
    }
    async installPreview(key, fileNames, viaTorrent = false) {
        const e = this.be.entry(key);
        if (!e)
            return { error: 'Item não encontrado' };
        const root = this.installRoot(e);
        let free: number | null = installer.freeBytes(root);
        if (free < 0)
            free = null;
        let need = 0;
        if (!viaTorrent) {
            try {
                let files = await this.be.cat.filesFor(e);
                if (fileNames && fileNames.length)
                    files = files.filter((f) => fileNames.includes(f.name) || fileNames.includes(basename(f)));
                need = files.reduce((s, f) => s + Number(f.size || 0), 0);
            }
            catch {
                need = 0;
            }
        }
        need = need || Number(e.size || 0);
        const speed = installer.STATS.speed || Number(this.be.store.config.dl_speed || 0);
        const eta = need && speed > 0 && !viaTorrent ? need / speed : null;
        const out: any = { title: e.title, need, free, root, fixed: e.kind === 'recomp', speed, eta, native: true, torrent: viaTorrent };
        if (e.kind === 'rom' && e.system !== 'pc') {
            const dirs = [path.join(P.EMU_GAMES, e.system), ...((this.be.store.config.rom_dirs || {})[e.system] || []).map((x) => path.normalize(String(x)))];
            Object.assign(out, {
                rom: true, system: e.system, system_name: (this.emu.presets.systems[e.system] || {}).name || e.system,
                dirs: dirs.filter((d, i) => dirs.indexOf(d) === i), remembered: (this.be.store.config.rom_dest || {})[e.system] ? root : '',
            });
        }
        return out;
    }
    async install(key, fileNames, viaTorrent = false, dest = null, remember = false) {
        const e = this.be.entry(key);
        if (!e)
            return { error: 'Item não encontrado' };
        if (dest && !(e.kind === 'rom' && e.system !== 'pc'))
            dest = null;
        const root = this.installRoot(e, dest);
        try {
            fs.mkdirSync(root, { recursive: true });
        }
        catch (ex: any) {
            return { error: `Não consegui usar a pasta ${root}: ${ex?.message || ex}` };
        }
        if (dest) {
            if (remember)
                this.setRomDest(e.system, dest);
            else if (path.resolve(root) !== path.resolve(path.join(P.EMU_GAMES, e.system)))
                this.emu.addRomDir(e.system, root);
        }
        let free: number | null = installer.freeBytes(root);
        if (free < 0)
            free = null;
        const keep = Boolean(this.be.store.config.keep_archive);
        const files = await this.be.cat.filesFor(e);
        if ((e.magnet || e.torrent_url) && (viaTorrent || !files.length)) {
            if (!torrent.available()) {
                let src = e.magnet || e.torrent_url;
                if (needsResolve(src)) {
                    try {
                        src = await (this.be.repos.providers[e.repo] as any).resolveTorrent(e);
                    }
                    catch (ex: any) {
                        return { error: String(ex?.message || ex) };
                    }
                    if (src.startsWith('magnet:'))
                        this.be.openUrl(src);
                    else
                        this.be.openPath(src);
                }
                else {
                    this.be.openUrl(src);
                }
                this.be.notify('info', `${e.title}: magnet aberto no cliente de torrent`,
                    'Quando terminar de baixar, use Adicionar → Jogo de Windows (ou arraste o arquivo para a Store) para instalar.', e.key);
                return { ok: true, external: true };
            }
            const r = this.be.jobs.run(key, e.title, 'install', async (cb, cancel) => {
                const tc = torrent.TorrentClient.get(this.be.store.config);
                const tmp = path.join(P.DOWNLOADS, installer.safeFolderName(e.title));
                let src = e.magnet || e.torrent_url;
                if (needsResolve(src)) {
                    cb(prog('download', -1, 'Pegando o link do torrent na fonte...'));
                    src = await (this.be.repos.providers[e.repo] as any).resolveTorrent(e);
                }
                const got: string = await tc.download(src, tmp, (frac, text) => cb(prog('download', frac, text)), cancel, this.session);
                const gameDir = path.join(root, installer.safeFolderName(e.title));
                const isDir = fs.statSync(got).isDirectory();
                const allf = isDir ? installer.walkFiles(got) : [got];
                const arcs = allf.filter((p) => /\.(7z|zip|rar|001|chd|iso|cue|bin|z64|n64|v64|gba|sfc|nes|md)$/i.test(path.basename(p)));
                if (!allf.length)
                    throw new Error('O torrent terminou sem arquivos (sem seeds ou cancelado pelo tracker)');
                let exes: string[];
                if (isDir && (allf.some((p) => path.extname(p).toLowerCase() === '.exe') || arcs.length < Math.floor(allf.length / 2))) {
                    cb(prog('extract', -1, 'Movendo arquivos baixados...'));
                    fs.mkdirSync(gameDir, { recursive: true });
                    for (const p of allf) {
                        const dst = path.join(gameDir, path.relative(got, p));
                        fs.mkdirSync(path.dirname(dst), { recursive: true });
                        try {
                            fs.renameSync(p, dst);
                        }
                        catch {
                            fs.copyFileSync(p, dst);
                            fs.rmSync(p, { force: true });
                        }
                    }
                    exes = installer.findExecutables(gameDir, e.title);
                }
                else {
                    exes = await installer.installFromArchives(arcs.length ? arcs : allf, gameDir, cb, cancel, keep, e.title);
                }
                if (!keep)
                    fs.rmSync(tmp, { recursive: true, force: true });
                return this.finishInstall(e, gameDir, exes);
            }, { m: 'start_install', a: [key, fileNames, true] });
            return { ...r, free, need: e.size * 2.2 };
        }
        if (!files.length) {
            if (e.extra.buy_only)
                return { error: 'Esse jogo ainda está à venda — o site não distribui o arquivo. Use o botão Origem pra ver onde comprar.' };
            return { error: 'Nenhum arquivo pra baixar neste item' };
        }
        let chosen: FileRef[];
        if (fileNames && fileNames.length) {
            chosen = files.filter((f) => fileNames.includes(f.name));
            if (!chosen.length)
                chosen = files.slice(0, 1);
        }
        else {
            chosen = autoPick(files);
        }
        const prov: any = this.be.repos.providers[e.repo];
        if (prov && typeof prov.browserUrl === 'function') {
            let url: string;
            try {
                url = await prov.browserUrl(e, chosen[0]);
            }
            catch (ex: any) {
                return { error: String(ex?.message || ex) };
            }
            this.be.openUrl(url);
            this.be.notify('info', `${e.title}: download aberto no navegador`,
                'O arquivo vai pra pasta Downloads do Windows. Depois use Adicionar → Jogo de Windows (ou arraste o .zip para a Store) para instalar.', e.key);
            return { ok: true, browser: true, url };
        }
        const need = chosen.reduce((s, f) => s + f.size, 0) * 2.2;
        if (e.extra.mirrors) {
            const url = chosen[0].url.split(/:(.*)/s)[1] || chosen[0].url;
            const r: any = this.hostedJob(e, url, root, keep, null, { m: 'start_install', a: [key, [chosen[0].name], false] });
            if (r.ok)
                this.be.notify('info', `${e.title}: download começou`, `Via ${chosen[0].name} — acompanhe na Fila.`, e.key);
            return { ...r, free, need };
        }
        if (chosen.length === 1 && hosts.knownHost(chosen[0].url) && !/\.(zip|7z|rar|exe|iso|bin|001|msi|apk)$/i.test(chosen[0].url.split('?')[0].split('#')[0])) {
            const r: any = this.hostedJob(e, chosen[0].url, root, keep, null, { m: 'start_install', a: [key, [chosen[0].name], false] });
            if (r.ok)
                this.be.notify('info', `${e.title}: download começou`, `Via ${hosts.knownHost(chosen[0].url)} — acompanhe na Fila.`, e.key);
            return { ...r, free, need };
        }
        const resolver: installer.Resolver | null = prov && typeof prov.finalUrl === 'function' ? (fr) => prov.finalUrl(fr) : null;
        const r = this.be.jobs.run(key, e.title, 'install', async (cb, cancel) => {
            const [gameDir, exes] = await installer.installGame(chosen.map((f) => ({ ...f })), e.title, root, cb, cancel, keep, this.session, resolver);
            return this.finishInstall(e, gameDir, exes);
        }, { m: 'start_install', a: [key, fileNames, false] });
        return { ...r, free, need };
    }
    finishInstall(e: Entry, gameDir: string, exes: string[]) {
        const store = this.be.store;
        if (e.kind === 'rom' && e.system !== 'pc') {
            const exts = new Set<string>(((this.emu.presets.systems[e.system] || {}).exts || []).map((x: string) => x.toLowerCase()));
            const sizeOf = (p: string) => {
                try {
                    return fs.statSync(p).size;
                }
                catch {
                    return 0;
                }
            };
            let roms = installer.walkFiles(gameDir).filter((p) => exts.has(path.extname(p).toLowerCase())).sort((a, b) => sizeOf(b) - sizeOf(a));
            const noBin = roms.filter((r) => !(path.extname(r).toLowerCase() === '.bin' && fs.existsSync(r.slice(0, -4) + '.cue')));
            roms = noBin.length ? noBin : roms;
            if (e.system === 'dos' && !roms.length) {
                const cands = installer.walkFiles(gameDir).filter((p) => ['.exe', '.com'].includes(path.extname(p).toLowerCase())
                    && !/(^|[^a-z])(setup|install|inst|config|unins|readme|sound|snd|dos4gw|univbe|vesa)/.test(path.basename(p, path.extname(p)).toLowerCase()));
                const words = (e.title.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2);
                const k = (p: string): [number, number, number] => {
                    const stem = path.basename(p, path.extname(p)).toLowerCase();
                    return [-words.filter((w) => stem.includes(w.slice(0, 4))).length, path.relative(gameDir, p).split(path.sep).length, -sizeOf(p)];
                };
                cands.sort((a, b) => {
                    const ka = k(a), kb = k(b);
                    return (ka[0] - kb[0]) || (ka[1] - kb[1]) || (ka[2] - kb[2]);
                });
                roms = cands.slice(0, 1);
            }
            this.be.setInstalled(e.key, { dir: gameDir, exe: roms.length ? roms[0] : '', title: e.title, kind: 'rom', system: e.system });
            this.emu.invalidateScan(e.system);
            if (store.config.auto_metadata)
                this.be.queueMeta(e.key);
            return { exes: [], dir: gameDir, rom: true };
        }
        const preferred = e.extra.exe;
        if (preferred) {
            const hit = exes.find((x) => path.basename(x).toLowerCase() === String(preferred).toLowerCase());
            if (hit)
                exes = [hit, ...exes.filter((x) => x !== hit)];
        }
        if (e.kind === 'pc' && installer.isRepack(gameDir)) {
            const setup = installer.findSetup(gameDir);
            this.be.setInstalled(e.key, { dir: gameDir, exe: '', title: e.title, kind: e.kind, version: e.extra.version || '', repack: String(setup), repack_state: 'pending' });
            this.be.notify('repack', `${e.title}: repack baixado`, 'Abra o instalador (setup) pelo launcher; quando ele terminar, o jogo entra na biblioteca.', e.key);
            return { exes: [], dir: gameDir, repack: String(setup) };
        }
        if (e.kind === 'pc' && !exes.length) {
            let dp: any = null;
            try {
                dp = require('./disc').plan(gameDir);
            }
            catch {
                dp = null;
            }
            if (dp) {
                this.be.setInstalled(e.key, { dir: gameDir, exe: '', title: e.title, kind: e.kind, version: e.extra.version || '', repack: dp.image, repack_state: 'pending', disc: dp });
                this.be.notify('repack', `${e.title}: disco baixado`, 'É uma imagem de disco (ISO). Pelo launcher o disco é montado, o instalador abre e, quando ele terminar, o jogo entra na biblioteca.', e.key);
                return { exes: [], dir: gameDir, repack: dp.image, disc: dp };
            }
        }
        this.be.setInstalled(e.key, { dir: gameDir, exe: exes.length ? exes[0] : '', title: e.title, kind: e.kind, version: e.extra.version || '' });
        if (store.config.auto_metadata)
            this.be.queueMeta(e.key);
        const offer = exes.length > 0 && e.kind === 'pc' && (store.config.shortcut_ask ?? true) && process.platform === 'win32';
        return { exes: exes.slice(0, 8), dir: gameDir, shortcut_offer: offer };
    }
    async patchDownload(key: string, i: number) {
        const e = this.be.entry(key);
        const patches: any[] = [...((e && e.extra.patches) || [])];
        if (!e || !(i >= 0 && i < patches.length))
            return { error: 'Patch desconhecido' };
        const pt = patches[i];
        const info = this.be.store.lib(key) || {};
        const hasDir = Boolean(info.dir && util.isDir(String(info.dir)));
        const base = hasDir ? String(info.dir) : path.join(P.DOWNLOADS, 'patches', installer.safeFolderName(e.title));
        const destDir = hasDir ? path.join(base, '_patches') : base;
        const jkey = `patch:${key}:${i}`;
        return this.be.jobs.run(jkey, `${e.title} — ${pt.name}`, 'tool', async (cb, cancel) => {
            cb(prog('download', -1, 'Lendo o link...'));
            const files: any[] = await hosts.resolve(pt.url, this.session);
            const dl = new installer.Downloader(this.session);
            for (let f of files) {
                if (f.host === 'itch.io')
                    f = await hosts.itchFinal(f, this.session);
                else if (!f.url)
                    f = { ...f, url: await hosts.megaFolderLink(f, this.session) };
                const fr: installer.DlRef = { name: f.name || pt.name, url: f.url, size: Number(f.size || 0), headers: f.headers || {}, cookies: f.cookies || {}, decrypt: f.decrypt || null };
                const nm = installer.safeFolderName(path.posix.basename(String(f.name || pt.name).replace(/\\/g, '/'))) || 'patch.bin';
                await dl.download(fr, path.join(destDir, nm), cb, cancel);
            }
            this.be.openPath(destDir);
            return { dir: destDir };
        }, { m: 'patch_download', a: [key, i] });
    }
    async installLocalFile(file, title, system = '') {
        let archive = String(file || '');
        if (!archive) {
            const { pickFile } = await import('./dialogs');
            archive = (await pickFile('archive', installer.homeDownloads())) || '';
            if (!archive)
                return { ok: false };
        }
        if (!fs.existsSync(archive) || !fs.statSync(archive).isFile())
            return { error: 'Arquivo não encontrado' };
        title = normalizeTitle(title || '') || titleFromPath(archive);
        if (!title)
            title = path.basename(archive, path.extname(archive));
        let root: string;
        let kind: string;
        if (system && system !== 'pc') {
            root = path.join(P.EMU_GAMES, system);
            kind = 'rom';
        }
        else {
            root = this.be.store.gamesDir();
            kind = 'pc';
            system = 'pc';
        }
        const e = makeEntry({ key: 'local:' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''), repo: 'local', id: title, title, kind, system });
        const r = this.be.jobs.run(e.key, title, 'install', async (cb, cancel) => {
            const gameDir = path.join(root, installer.safeFolderName(title));
            const exes = await installer.installFromArchives([archive], gameDir, cb, cancel, true, title);
            return this.finishInstall(e, gameDir, exes);
        });
        return { ...r, key: e.key, title };
    }
    cancel(key, pause = false) {
        return this.be.jobs.cancel(key, pause);
    }
    queueAction(action, key) {
        return this.be.jobs.queueAction(action, key);
    }
    queuePayload() {
        return this.be.jobs.queuePayload();
    }
    /* --------------------------------- ROMs --------------------------------- */
    get emu() {
        return this.be.emu;
    }
    emulationStatus() {
        return this.emu.status();
    }
    installEmulator(id: string) {
        const cfg = this.emu.presets.emulators[id];
        if (!cfg)
            return { error: 'Emulador desconhecido' };
        return this.be.jobs.run(`emu:${id}`, cfg.title, 'emulator', async (cb, cancel) => ({ dir: await this.emu.installEmulator(id, cb, cancel) }), { m: 'install_emulator', a: [id] });
    }
    updateEmulator(id: string) {
        const cfg = this.emu.presets.emulators[id];
        if (!cfg)
            return { error: 'Emulador desconhecido' };
        return this.be.jobs.run(`emu:${id}`, `${cfg.title} (atualização)`, 'emulator', async (cb, cancel) => ({ dir: await this.emu.installEmulator(id, cb, cancel, true) }), { m: 'update_emulator', a: [id] });
    }
    async checkEmulatorUpdates() {
        return { updates: await this.emu.checkUpdates(true) };
    }
    removeEmulator(id: string) {
        this.emu.removeEmulator(id);
        return { ok: true };
    }
    setEmulatorExe(id: string, exe: string | null) {
        return this.emu.setEmulatorExe(id, exe || null);
    }
    openEmulator(id: string) {
        return this.emu.openEmulatorGui(id);
    }
    addCustomEmulator(spec: any) {
        return this.emu.addCustomEmulator(spec || {});
    }
    removeCustomEmulator(id: string) {
        this.emu.removeCustomEmulator(id);
        return { ok: true };
    }
    setSystemEmulator(system: string, id: string | null) {
        this.emu.setSystemEmulator(system, id || null);
        return { ok: true };
    }
    addSystemEmulator(system: string, id: string) {
        this.emu.addSystemEmulator(system, id);
        return { ok: true };
    }
    removeSystemEmulator(system: string, id: string) {
        this.emu.removeSystemEmulator(system, id);
        return { ok: true };
    }
    addRomDir(system: string, folder: string) {
        this.emu.addRomDir(system, folder);
        return { ok: true };
    }
    removeRomDir(system: string, folder: string) {
        this.emu.removeRomDir(system, folder);
        return { ok: true };
    }
    romDest(system: string) {
        const d = (this.be.store.config.rom_dest || {})[system] || '';
        return d || path.join(P.EMU_GAMES, system);
    }
    setRomDest(system: string, folder: string | null) {
        const rd = { ...(this.be.store.config.rom_dest || {}) };
        if (folder && path.resolve(folder) !== path.resolve(path.join(P.EMU_GAMES, system))) {
            rd[system] = folder;
            this.emu.addRomDir(system, folder);
        }
        else
            delete rd[system];
        this.be.store.setConfig({ rom_dest: rd });
        return { ok: true, dest: this.romDest(system) };
    }
    async romPreview(p: string | null) {
        if (!p) {
            const { pickFile } = await import('./dialogs');
            p = await pickFile('rom');
            if (!p)
                return { cancel: true };
        }
        if (!fs.existsSync(p))
            return { error: 'Arquivo não encontrado' };
        const sid = this.emu.guessSystemForFile(p);
        const stem = path.parse(p).name;
        const title = stem.replace(emulation.ROM_TITLE_RE, '').trim() || stem;
        const exts = new Set<string>(sid ? (this.emu.presets.systems[sid]?.exts || []) : []);
        let siblings = 0;
        try {
            if (exts.size)
                for (const x of fs.readdirSync(path.dirname(p))) {
                    const f = path.join(path.dirname(p), x);
                    if (f !== p && exts.has(path.extname(x).toLowerCase()) && fs.statSync(f).isFile())
                        siblings++;
                }
        }
        catch { /* ignore */ }
        let size = 0;
        try {
            size = fs.statSync(p).size;
        }
        catch { /* ignore */ }
        const known = (this.be.store.config.rom_files || []).some((x: any) => x.path === p);
        const emulators: any = {};
        for (const s of Object.keys(this.emu.presets.systems))
            if (s !== 'pc')
                emulators[s] = this.emu.installedOptions(s).map((o) => ({ id: o.id, title: o.title }));
        return { native: true, path: p, name: path.basename(p), size, system: sid, title, siblings, folder: path.dirname(p), known, emulators };
    }
    async addRomFile(p: string | null, system: string | null, title: string | null = null, emulator: string | null = null, addFolder = false) {
        if (!p) {
            const { pickFile } = await import('./dialogs');
            p = await pickFile('rom');
            if (!p)
                return { ok: false };
        }
        const sid = system || this.emu.guessSystemForFile(p);
        if (!sid)
            return { error: 'Não reconheci o formato. Escolha o console manualmente.', need_system: true, path: p };
        const r: any = this.emu.addRomFile(p, sid);
        this.be.setInstalled(r.key, { dir: path.dirname(p), exe: p, title: r.title, kind: 'rom' });
        if (title && title.trim() && title.trim() !== r.title) {
            this.be.applyTitle(r.key, title.trim(), true);
            r.title = title.trim();
        }
        if (emulator)
            this.be.setGameEmulator(r.key, emulator);
        if (addFolder)
            this.emu.addRomDir(sid, path.dirname(p));
        if (this.be.store.config.auto_metadata)
            this.be.queueMeta(r.key);
        return { ...r, system: sid };
    }
    emulatorGuide(system: string) {
        return this.emu.guide(system);
    }
    async emulatorGuideInstall(system: string, what: string, p: string | null, pick = 'file') {
        if (!p) {
            const { pickFile, pickFolder } = await import('./dialogs');
            p = pick === 'folder' ? await pickFolder() : await pickFile('any');
            if (!p)
                return { cancel: true };
        }
        return this.emu.guideInstall(system, what, p);
    }
    /* ------------------------------ importacoes ------------------------------ */
    /** Aplica a importacao: cria as entradas na biblioteca. */
    /* -------------------------------- extras -------------------------------- */
    async detect(query) {
        this.be.act('Analisando fonte…');
        try {
            return await this.be.cat.detect(String(query || ''));
        }
        finally {
            this.be.act('');
        }
    }
    /* ----------------------------- atualizacoes ----------------------------- */
    updates: updates.UpdateManager;
    updateStatus() {
        return this.updates.status();
    }
    async updateCheck() {
        return this.updates.check(await this.be.online(true));
    }
    updateDownload() {
        if (this.updates.state.busy)
            return { error: 'Já estou baixando' };
        this.be.jobs.run('update', 'Atualização do launcher', 'update', async (cb) => {
            const r = await this.updates.download((f) => cb(prog('download', f, 'Atualização')));
            if (r.error)
                throw new Error(r.error);
            cb(prog('done', 1, ''));
            return r;
        });
        return { ok: true };
    }
    updateApply(relaunch = true, restore: string | null = null) {
        try {
            fs.mkdirSync(P.UPDATES, { recursive: true });
            fs.writeFileSync(path.join(P.UPDATES, 'theme.json'), JSON.stringify(this.be.themePalette()), 'utf8');
        }
        catch { /* ignore */ }
        const r: any = this.updates.apply(relaunch, restore);
        if (r.quit)
            setTimeout(() => (this.be.windowHooks?.quit || (() => process.exit(0)))(), 800);
        return r;
    }
    async updateAddFile() {
        const { pickFile } = await import('./dialogs');
        const f = await pickFile('lxup');
        return f ? this.updates.addFile(f) : { cancel: true };
    }
    async updatePickRestore(allowSame = false) {
        const { pickFile } = await import('./dialogs');
        const f = await pickFile('srczip');
        return f ? updates.UpdateManager.readRestore(f, allowSame) : { cancel: true };
    }
    updateAck() {
        return this.updates.ackResult();
    }
    /* ------------------------------ integridade ------------------------------ */
    integrityStatus() {
        return integrity.now(P.APP_DIR, P.ROOT);
    }
    integrityRepair() {
        const r: any = integrity.repairNow(P.APP_DIR, P.ROOT);
        if (r.fixed?.length && !r.bad?.length)
            this.be.notify('ok', 'Arquivos do launcher reparados', `${r.fixed.length} arquivo(s) restaurado(s) a partir do pacote da versão ${r.version || ''}.`, 'integrity');
        return r;
    }
    /* ------------------------------- utilidades ------------------------------- */
    cleanDownloads() {
        const d = P.DOWNLOADS;
        if (!fs.existsSync(d))
            return { ok: true, freed: 0, freed_h: '0 B', skipped: 0 };
        const jobs = this.be.jobs.all();
        const busy = new Set(Object.values(jobs).map((j: any) => installer.safeFolderName(String(j?.title || ''))));
        const anyJob = Object.keys(jobs).length > 0;
        let freed = 0;
        let skipped = 0;
        for (const name of fs.readdirSync(d)) {
            if (busy.has(name) || name.startsWith('.') || (anyJob && /^(emu_|tool_|redist)/.test(name))) {
                skipped++;
                continue;
            }
            const child = path.join(d, name);
            try {
                const st = fs.statSync(child);
                const size = st.isDirectory() ? P.dirSize(child) : st.size;
                fs.rmSync(child, { recursive: true, force: true });
                if (fs.existsSync(child))
                    skipped++;
                else
                    freed += size;
            }
            catch {
                skipped++;
            }
        }
        return { ok: true, freed, freed_h: installer.humanSize(freed), skipped };
    }
    /* --------------------------------- jobs --------------------------------- */
    setJob(key, title, phase = 'download', frac = -1, text = '', speed = 0, eta = 0) {
        this.be.jobs.set(key, prog(phase, frac, text, speed, eta));
    }
    finishJob() { }
    failJob(key, e) {
        if (!(e instanceof installer_types.CancelledError))
            log.warn('trabalho %s: %s', key, e);
    }
    jobPayload(key) {
        return this.be.jobs.payload(key);
    }
    hasJob(key) {
        return this.be.jobs.has(key);
    }
}

export { StoreFront };


/* ---------------------- capas da pre-visualizacao ---------------------- */
