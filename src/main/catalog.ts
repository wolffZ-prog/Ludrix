import fs from 'node:fs';
import path from 'node:path';
import * as P from './paths';
import * as log from './log';
import * as util from './util';
import * as themes from './themes';
import * as torrentMod from './torrent';
import { RepoRegistry, Entry, FileRef, makeEntry, entryDict, basename, detectSource } from './repos';
import { humanTime } from './sessions';

export class Catalog {
    repos: RepoRegistry;
    entries: Map<string, Entry> = new Map();
    state: { loading: boolean; errors: Record<string, any> } = { loading: true, errors: {} };
    gen = 0;
    categories: any[] = [];
    catCache = new Map<string, string[]>();
    slimCache = new Map<string, { sig: string; d: any }>();
    existsCache = new Map<string, [number, boolean]>();
    romSeen = new Map<string, number>();
    firstPayloadAt = 0;
    t0 = Date.now() / 1000;
    onLoaded: (() => void) | null = null;
    onFirstPayload: (() => void) | null = null;

    constructor(public be: any) {
        this.repos = new RepoRegistry(be.store);
        this.categories = this.loadCategories();
    }

    loadCategories(): any[] {
        const p = path.join(P.ASSETS, 'presets', 'categories.json');
        let cats: any[] = [];
        try {
            cats = JSON.parse(fs.readFileSync(p, 'utf8')).categories || [];
        }
        catch (e) {
            log.warn('categories.json: %s', e);
        }
        for (const c of cats) {
            try {
                c._re = c.match ? new RegExp(String(c.match).toLowerCase()) : null;
            }
            catch {
                c._re = null;
            }
        }
        return cats;
    }

    get store() {
        return this.be.store;
    }

    get favs(): Set<string> {
        return new Set(this.store.config.favorites || []);
    }

    get hidden(): Set<string> {
        return new Set(this.store.config.hidden_games || []);
    }

    catalogError(prov: any, ex: any) {
        let msg = String(ex?.message || ex);
        let missing = false;
        if (ex && (ex.code === 'ENOENT' || ex.code === 'ENOTDIR')) {
            missing = true;
            const src = String(prov.cfg.url || prov.cfg.path || ex.path || '');
            msg = src ? `Arquivo não encontrado: ${src}` : 'Arquivo não encontrado';
        }
        return { name: prov.name, msg, missing };
    }

    reload(force: boolean) {
        this.state = { loading: true, errors: {} };
        const gen = ++this.gen;
        void (async () => {
            const t0 = Date.now();
            const neu = new Map<string, Entry>();
            const errors: Record<string, any> = {};
            const provs = this.repos.enabledProviders();
            for (let i = 0; i < provs.length; i++) {
                const prov = provs[i];
                this.be.act(`Carregando catálogo ${i + 1}/${provs.length}: ${prov.name}`);
                try {
                    for (const e of await prov.catalog(force)) {
                        const old = this.entries.get(e.key);
                        if (old && old.files_loaded && !force) {
                            e.files = old.files;
                            e.files_loaded = true;
                            e.cover = old.cover;
                        }
                        neu.set(e.key, e);
                    }
                }
                catch (ex) {
                    log.error('catalog %s: %s', prov.id, (ex as any)?.stack || ex);
                    errors[prov.id] = this.catalogError(prov, ex);
                }
                if (prov.cfg._drop) {
                    try {
                        this.repos.remove(prov.id);
                    }
                    catch { /* nada */ }
                }
            }
            if (gen !== this.gen)
                return;
            this.entries = neu;
            for (const e of neu.values()) {
                try {
                    this.slim(e);
                }
                catch { /* nada */ }
            }
            this.state = { loading: false, errors };
            log.info('catálogo: %d itens de %d fontes em %ss', neu.size, provs.length, ((Date.now() - t0) / 1000).toFixed(1));
            this.be.act('');
            try {
                this.onLoaded?.();
            }
            catch (e) {
                log.error('pós-catálogo: %s', e);
            }
        })();
    }

    categoryOf(e: Entry, meta: any): string[] {
        const ck = `${e.key}\u0000${(meta || {}).fetched_at || 0}`;
        const hit = this.catCache.get(ck);
        if (hit)
            return hit;
        const out = this.categoryCalc(e, meta);
        if (this.catCache.size > 60000)
            this.catCache.clear();
        this.catCache.set(ck, out);
        return out;
    }

    categoryCalc(e: Entry, meta: any): string[] {
        const out: string[] = [];
        if (e.kind === 'recomp')
            out.push('recomp');
        if (e.kind === 'rom')
            out.push('emu');
        const genres = [...((meta || {}).genres || []), ...e.genres].join(' ').toLowerCase();
        const gmap: Record<string, string[]> = {
            sports: ['esport', 'futebol', 'basquete', 'skate', 'luta livre', 'beisebol'],
            racing: ['corrida'], shooter: ['fps', 'tiro'], action: ['ação', 'aventura', 'plataforma', 'luta', 'terror', 'rpg', 'hack'],
            strategy: ['estratégia', 'simulação', 'god game', 'tower'],
        };
        for (const [cid, words] of Object.entries(gmap))
            if (words.some((w) => genres.includes(w)))
                out.push(cid);
        if (!out.length) {
            const title = e.title.toLowerCase();
            for (const c of this.categories) {
                if (c._re && c._re.test(title)) {
                    out.push(c.id);
                    break;
                }
            }
        }
        return out.length ? out : ['other'];
    }

    customPath(key: string): string | null {
        return this.be.hub.covers.customPath(key);
    }

    hasThumb(key: string): boolean {
        return this.be.hub.images.hasThumb(key);
    }

    cv(key: string, m: any): number {
        const c = this.customPath(key);
        if (c) {
            try {
                return Math.trunc(fs.statSync(c).mtimeMs / 1000);
            }
            catch { /* segue */ }
        }
        return Math.trunc(Number((m || {}).fetched_at || 0));
    }

    slim(e: Entry): any {
        const key = e.key;
        const info = this.store.lib(key);
        const sig = JSON.stringify([this.be.hub.meta.mtime(key), this.favs.has(key), this.be.jobs.has(key), this.hasThumb(key), this.customPath(key) != null,
            info ? [info.playtime, info.last_played, info.installed_at, info.exe, info.dir] : null]);
        const hit = this.slimCache.get(key);
        if (hit && hit.sig === sig && hit.d.__e === e)
            return hit.d;
        const d = this.slimBuild(e);
        Object.defineProperty(d, '__e', { value: e, enumerable: false });
        if (this.slimCache.size > 80000)
            this.slimCache.clear();
        this.slimCache.set(key, { sig, d });
        return d;
    }

    slimBuild(e: Entry): any {
        const m = this.be.hub.meta.get(e.key);
        const genres = (m || {}).genres || e.genres;
        const info = this.store.lib(e.key) || {};
        return {
            key: e.key, repo: e.repo, title: e.title, kind: e.kind, system: e.system,
            creator: (m || {}).developer || e.creator, year: (m || {}).year || e.year,
            size: e.size, genres: genres.slice(0, 3), cats: this.categoryOf(e, m),
            installed: this.store.isInstalled(e.key) || Boolean(e.extra.local_path && this.existsCached(e.extra.local_path)), job: this.be.jobs.has(e.key),
            has_meta: Boolean(m), thumb_ok: this.hasThumb(e.key) || Boolean(this.customPath(e.key)),
            torrent: Boolean(e.magnet || e.torrent_url),
            playtime: info.playtime || 0, status: (m || {}).status || '', score: Math.trunc(Number((m || {}).score || 0)),
            last_played: info.last_played || 0,
            added_at: info.installed_at || e.extra.posted || 0,
            fav: this.favs.has(e.key), cv: this.cv(e.key, m),
        };
    }

    existsCached(p: string): boolean {
        if (!p)
            return false;
        const now = Date.now() / 1000;
        const hit = this.existsCache.get(p);
        if (hit && now - hit[0] < 20)
            return hit[1];
        const ok = fs.existsSync(p);
        if (this.existsCache.size > 5000)
            this.existsCache.clear();
        this.existsCache.set(p, [now, ok]);
        return ok;
    }

    localGames(): any[] {
        const out: any[] = [];
        const ga = this.store.config.game_args || {};
        const favs = this.favs;
        for (const [key, info] of Object.entries(this.store.library as Record<string, any>)) {
            if (!key.startsWith('local:'))
                continue;
            const m = this.be.hub.meta.get(key);
            const exe = String(info.exe || '');
            out.push({
                key, repo: 'local', title: info.title || key, kind: 'local', system: info.system || 'pc',
                creator: (m || {}).developer || info.creator || '', year: (m || {}).year || info.year || '', size: 0,
                genres: ((m || {}).genres || info.genres || []).slice(0, 3),
                installed: this.existsCached(exe) || exe.includes('://') || exe.startsWith('shell:') || exe.startsWith('flatpak:')
                    || Boolean(info.mc === 'java' && !info.exe && info.dir && util.isDir(String(info.dir))),
                job: false,
                mc: info.mc || '', mc_nolauncher: Boolean(info.mc === 'java' && !info.exe),
                has_meta: Boolean(m), thumb_ok: this.hasThumb(key), torrent: false,
                playtime: info.playtime || 0, last_played: info.last_played || 0,
                added_at: info.installed_at || 0, fav: favs.has(key), cv: this.cv(key, m), source: info.source || '',
                store_src: info.store_src || '', play_count: info.play_count || 0, has_args: key in ga,
                status: (m || {}).status || '', score: Math.trunc(Number((m || {}).score || 0)),
            });
        }
        for (const g of out) {
            const fake = makeEntry({ key: g.key, repo: 'local', id: g.key, title: g.title, kind: 'local', genres: g.genres });
            g.cats = this.categoryOf(fake, this.be.hub.meta.get(g.key));
        }
        return out;
    }

    payload(): any {
        const entries = [...this.entries.values()];
        const repoList = this.repos.list();
        const hiddenRepos = new Set(repoList.filter((r) => r.hidden_in_library).map((r) => r.id));
        const games: any[] = [];
        for (const e of entries)
            if (!hiddenRepos.has(e.repo))
                games.push(this.slim(e));
        const lib = Object.entries(this.store.library as Record<string, any>);
        const owned = new Set(lib.filter(([, i]) => i.kind === 'rom' && i.exe).map(([, i]) => String(i.exe)));
        const ownedKeys = new Set(lib.filter(([k]) => k.startsWith('rom:')).map(([k]) => k));
        const favs = this.favs;
        const roms = (this.be.emu.scanAll(false) as any[]).filter((r) => !owned.has(r.path) || ownedKeys.has(r.key));
        for (const r of roms) {
            const info = this.store.lib(r.key) || {};
            const m = this.be.hub.meta.get(r.key);
            if (!this.romSeen.has(r.key))
                this.romSeen.set(r.key, Date.now() / 1000);
            Object.assign(r, {
                installed: true, job: false, cats: ['emu'], genres: ((m || {}).genres || []).slice(0, 3),
                creator: (m || {}).developer || '', year: (m || {}).year || '',
                repo: 'local', has_meta: Boolean(m), thumb_ok: this.hasThumb(r.key), torrent: false,
                playtime: info.playtime || 0, last_played: info.last_played || 0,
                added_at: info.installed_at || this.romSeen.get(r.key), fav: favs.has(r.key), cv: this.cv(r.key, m),
                source: info.source || '', store_src: info.store_src || '', play_count: info.play_count || 0, status: (m || {}).status || '', score: Math.trunc(Number((m || {}).score || 0)),
            });
        }
        const seenRoms = new Set(roms.map((r) => r.key));
        for (const [k, info] of lib) {
            if (!k.startsWith('rom:') || seenRoms.has(k) || info.kind !== 'rom')
                continue;
            const ex = String(info.exe || '');
            if (!ex || this.existsCached(ex))
                continue;
            const m = this.be.hub.meta.get(k);
            const parts = k.split(':');
            const sid = info.system || (parts.length >= 3 ? parts[1] : '');
            roms.push({
                key: k, repo: 'local', id: k, title: info.title || k.split(':').pop(), kind: 'rom', system: sid, path: ex, size: 0,
                installed: false, missing: true, job: false, cats: ['emu'], genres: ((m || {}).genres || []).slice(0, 3),
                creator: (m || {}).developer || '', year: (m || {}).year || '', has_meta: Boolean(m), thumb_ok: this.hasThumb(k), torrent: false,
                playtime: info.playtime || 0, last_played: info.last_played || 0, added_at: info.installed_at || 0, fav: favs.has(k), cv: this.cv(k, m),
                source: info.source || '', store_src: info.store_src || '', play_count: info.play_count || 0, status: (m || {}).status || '', score: Math.trunc(Number((m || {}).score || 0)),
            });
        }
        const all = games.concat(roms, this.localGames());
        const hid = this.hidden;
        if (hid.size)
            for (const g of all)
                if (hid.has(g.key))
                    g.hidden = true;
        const cats = this.categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon || '' })).concat([{ id: 'other', name: 'Outros', icon: 'dots' }]);
        if (!this.firstPayloadAt) {
            this.firstPayloadAt = Date.now() / 1000;
            try {
                this.onFirstPayload?.();
            }
            catch { /* nada */ }
            log.info('primeira biblioteca servida %ss após abrir (%d itens, roms %s)', (this.firstPayloadAt - this.t0).toFixed(2), all.length, this.be.emu.scanPending() ? 'pendentes' : 'ok');
        }
        const systems: Record<string, string> = {};
        for (const [k, v] of Object.entries(this.be.emu.presets.systems as Record<string, any>))
            systems[k] = v.name;
        return {
            ...this.state, games: all, categories: cats, sites_loading: false, roms_pending: this.be.emu.scanPending(),
            repos: repoList.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled, kind: r.kind || 'pc', hidden: Boolean(r.hidden_in_library) })),
            systems,
            config: this.be.publicConfig(), faces: themes.faces(), custom: this.be.custom(),
            torrent_available: torrentMod.available(), torrent_engine: torrentMod.engine(),
            sessions: this.be.sessions.status(),
            gamepad: this.be.gamepad ? this.be.gamepad.status() : { available: false, connected: 0 },
        };
    }

    entry(key: string): Entry | null {
        return this.entries.get(key) || null;
    }

    async filesFor(e: Entry): Promise<FileRef[]> {
        const prov = this.repos.providers[e.repo];
        return prov ? prov.files(e) : e.files.map((f) => ({ ...f }));
    }

    async siteSearch(q: string) {
        q = String(q || '').trim();
        return { games: [], sources: [] };
    }

    async gamePayload(key: string): Promise<any | null> {
        const d = await this.gamePayloadBase(key);
        if (!d)
            return null;
        d.custom_cover = Boolean(this.customPath(key));
        d.cover_src = d.custom_cover ? 'custom' : ((d.meta || {}).cover_src || '');
        let info = this.store.lib(key) || {};
        if (Object.keys(info).length && !info.repack && !info.exe && (info.kind || 'pc') === 'pc' && info.dir && util.isDir(String(info.dir))) {
            let dp: any = null;
            try {
                dp = require('./disc').plan(String(info.dir));
            }
            catch {
                dp = null;
            }
            if (dp) {
                this.store.patchLib(key, { repack: dp.image, repack_state: 'pending', disc: dp });
                info = this.store.lib(key) || {};
            }
        }
        if (info.repack) {
            d.repack = info.repack;
            d.repack_state = info.repack_state || 'pending';
            if (info.disc)
                d.disc = info.disc;
            if (d.repack_state !== 'done')
                d.installed = false;
        }
        const ex = String(info.exe || '');
        if (ex && !ex.includes('://') && !ex.startsWith('shell:') && !ex.startsWith('flatpak:') && !this.existsCached(ex))
            d.missing = true;
        for (const k of ['store_src', 'play_count', 'last_session', 'workdir', 'source'])
            if (info[k])
                d[k] = info[k];
        if (info.installed_at && !d.added_at)
            d.added_at = info.installed_at;
        if (info.crash_count) {
            d.crash_count = info.crash_count;
            d.crash_why = this.be.diagnoseCrash(key, info, info.last_rc);
            d.last_rc = info.last_rc;
        }
        d.admin = Boolean(info.admin);
        d.compat = info.compat || '';
        return d;
    }

    async gamePayloadBase(key: string): Promise<any | null> {
        const systems = this.be.emu.presets.systems as Record<string, any>;
        if (key.startsWith('rom:')) {
            for (const r of this.be.emu.scanAll(true) as any[]) {
                if (r.key === key) {
                    const m = this.be.hub.meta.get(key);
                    const info = this.store.lib(key) || {};
                    return {
                        ...r, installed: true, files: [], meta: m, creator: (m || {}).developer || '',
                        year: (m || {}).year || '', genres: (m || {}).genres || [],
                        description: (m || {}).summary || '', dir: path.dirname(r.path),
                        exe: r.path, args: this.be.gameArgs(key), system_name: systems[r.system].name, emu: this.be.emu.systemStatus(r.system), job: null,
                        playtime: info.playtime || 0, playtime_h: humanTime(info.playtime || 0),
                        last_played: info.last_played || 0,
                    };
                }
            }
            const info = this.store.lib(key);
            if (!info || !info.exe)
                return null;
            const parts = key.split(':');
            const sid = info.system || (parts.length >= 3 ? parts[1] : '');
            const m = this.be.hub.meta.get(key);
            const sysname = (systems[sid] || {}).name || sid;
            const ok = this.existsCached(info.exe);
            return {
                key, repo: 'local', id: key, title: info.title || key.split(':').pop(), kind: 'rom', system: sid, path: info.exe, size: 0,
                installed: ok, missing: !ok, source: info.source || '', store_src: info.store_src || '', play_count: info.play_count || 0, last_session: info.last_session || 0, added_at: info.installed_at || 0, files: [], meta: m, creator: (m || {}).developer || '',
                year: (m || {}).year || '', genres: (m || {}).genres || [], description: (m || {}).summary || '',
                dir: path.dirname(info.exe), exe: info.exe, args: this.be.gameArgs(key), system_name: sysname,
                emu: sid in systems ? this.be.emu.systemStatus(sid) : {}, job: null,
                playtime: info.playtime || 0, playtime_h: humanTime(info.playtime || 0), last_played: info.last_played || 0,
            };
        }
        if (key.startsWith('local:')) {
            const info = this.store.lib(key);
            if (!info)
                return null;
            const m = this.be.hub.meta.get(key);
            return {
                key, repo: 'local', title: info.title || '', kind: 'local', system: info.system || 'pc', system_name: (systems[info.system || 'pc'] || {}).name || 'PC (Windows)',
                title_orig: info.title_orig || '', title_locked: Boolean(info.title_locked),
                installed: true, dir: info.dir || '', exe: info.exe || '', args: this.be.gameArgs(key), files: [], meta: m, job: null,
                creator: (m || {}).developer || info.creator || '', year: (m || {}).year || info.year || '',
                genres: ((m || {}).genres || []).length ? (m || {}).genres : (info.genres || []), mc: info.mc || '',
                description: (m || {}).summary || info.description || '', size: 0, page_url: info.page_url || '', requires_rom: '', version: '',
                playtime: info.playtime || 0, playtime_h: humanTime(info.playtime || 0), last_played: info.last_played || 0,
            };
        }
        const e = this.entry(key);
        if (!e)
            return null;
        let files: FileRef[] = [];
        try {
            files = await this.filesFor(e);
        }
        catch (ex) {
            log.warn('files %s: %s', key, ex);
            files = [];
        }
        const info = this.store.lib(key) || {};
        const m = this.be.hub.meta.get(key);
        const { files: _f, extra: _x, ...rest } = entryDict(e);
        const prov: any = this.repos.providers[e.repo];
        return {
            ...rest,
            files: files.map((f) => ({ ...f, basename: basename(f) })), mirrors: Boolean(e.extra.mirrors),
            installed: this.store.isInstalled(key), dir: info.dir || '', exe: info.exe || '', args: this.be.gameArgs(key),
            version: info.version || e.extra.version || '',
            requires_rom: e.extra.requires_rom || '',
            meta: m, job: this.be.jobs.payload(key),
            system_name: (systems[e.system] || {}).name || e.system,
            emu: e.kind === 'rom' && e.system !== 'pc' ? this.be.emu.systemStatus(e.system) : null,
            torrent_available: torrentMod.available(), torrent_engine: torrentMod.engine(),
            playtime: info.playtime || 0, playtime_h: humanTime(info.playtime || 0), last_played: info.last_played || 0,
            browser_only: Boolean(prov && typeof prov.browserUrl === 'function'),
            buy_only: e.extra.buy_only || '', steam_url: e.extra.steam_url || '',
            patches: [...(e.extra.patches || [])], prefer: e.extra.prefer || '',
        };
    }

    async detect(q: string) {
        try {
            return await detectSource(this.repos.session, q, this.repos.cache);
        }
        catch (e: any) {
            log.warn('detect: %s', e);
            return { kind: 'none', results: [], error: String(e?.message || e) };
        }
    }
}
