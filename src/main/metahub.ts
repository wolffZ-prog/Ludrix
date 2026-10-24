import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as P from './paths';
import * as http from './http';
import * as log from './log';
import * as dialogs from './dialogs';
import { ImageCache, blurHero } from './images';
import { CoverService } from './covers';
import { WebImageSearch } from './websearch';
import { MetadataService } from './metadata';

export const STATUSES = ['plan', 'playing', 'played', 'beaten', 'completed', 'on_hold', 'abandoned'];
const IMG_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'];
const META_WORKERS = 6;

function safeName(key: string): string {
    return key.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120);
}
function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

export class MetaHub {
    meta: MetadataService;
    covers: CoverService;
    images: ImageCache;
    web: WebImageSearch;
    private mq: Array<[number, number, string]> = [];
    private mqPending = new Set<string>();
    private mqLater = new Set<string>();
    private mqTotal = 0;
    private mqDone = 0;
    private mqN = 0;
    private mqWorkers = 0;
    private mqWake: Array<() => void> = [];

    constructor(public be: any) {
        const s: http.Session = http.shared;
        this.images = new ImageCache(s);
        this.covers = new CoverService(s, be.store);
        this.web = new WebImageSearch(s);
        this.meta = new MetadataService(s, be.store);
        this.meta.covers = this.covers;
        this.meta.web = this.web;
        this.images.onThumb = (k) => this.be.push({ type: 'thumb_ready', key: k });
        setTimeout(() => { void this.fillHeroes(); }, 60_000).unref();
    }

    private async fillHeroes() {
        if (!(this.store.config.auto_metadata ?? true) || !this.covers.once('heroes:fill'))
            return;
        try {
            if (!(await this.be.online()))
                return;
            let keys: string[] = Object.keys(this.store.library);
            try {
                keys = keys.concat(this.be.emu.scanAll().map((r: any) => r.key));
            }
            catch { /* nada */ }
            let n = 0;
            for (const key of new Set(keys)) {
                const m = this.meta.get(key);
                if (!m || m.hero_url || m.background_file || m.hero_checked || (m.system || 'pc') === 'pc')
                    continue;
                while (this.be.quiet)
                    await sleep(30_000);
                const title = String(m.query_title || m.title || '').trim();
                if (!title)
                    continue;
                const probe: any = { libretro_name: m.libretro_name, libretro_sys: m.libretro_sys, source: [] };
                try {
                    await this.covers.consoleHero(probe, title.replace(/\(.*?\)|\[.*?\]/g, '').trim(), m.system, String(m.year || ''));
                }
                catch { /* nada */ }
                const fields: any = { hero_checked: Math.trunc(Date.now() / 1000) };
                if (probe.hero_url) {
                    fields.hero_url = probe.hero_url;
                    fields.hero_src = probe.hero_src || '';
                    n += 1;
                }
                const saved = this.meta.patch(key, fields);
                if (probe.hero_url && saved)
                    this.be.push({ type: 'meta_ready', key, has_cover: Boolean(saved.cover_url), cv: this.cv(key, saved), genres: (saved.genres || []).slice(0, 3), year: saved.year || '', creator: saved.developer || '', found: true, title: saved.title || title, mine: this.mine(key), hero_ok: true });
                await sleep(400);
            }
            if (n)
                log.info('fundos encontrados para %d jogo(s) de console', n);
        }
        catch (ex: any) {
            log.debug('fundos: %s', ex?.message || ex);
        }
        finally {
            this.covers.done('heroes:fill');
        }
    }

    get store() {
        return this.be.store;
    }
    private entry(key: string) {
        return this.be.cat.entry(key);
    }
    private mine(key: string): boolean {
        return key.startsWith('local:') || key.startsWith('rom:') || this.store.isInstalled(key);
    }

    metaCoverUrl(m: any, thumb: boolean): string {
        if (!m)
            return '';
        if (m.cover_src === 'manual' && m.cover_url)
            return m.cover_url;
        if (thumb && m.grid_thumb)
            return m.grid_thumb;
        return m.cover_url || m.grid || m.wiki_image || '';
    }

    async thumbPath(key: string, wait = true): Promise<string | null> {
        const c = this.covers.customPath(key);
        if (c)
            return await this.images.localThumb(key, c);
        if (!wait) {
            const p = this.images.cachedThumb(key);
            if (p)
                return p;
            this.thumbBg(key);
            return null;
        }
        const e = this.entry(key);
        const m = this.meta.get(key);
        if (e) {
            const prov = this.be.cat.repos.providers[e.repo];
            const manual = m && m.cover_src === 'manual' ? m.cover_url : '';
            const url = manual || (prov ? await prov.thumbUrl(e) : e.thumb) || this.metaCoverUrl(m, true);
            let p = await this.images.thumb(key, url);
            if (!p && m && e.cover && e.cover !== url)
                p = await this.images.thumb(key, e.cover);
            if (!p && !m)
                this.prefetch(key);
            else if (!p)
                this.deepCover(key, e);
            return p;
        }
        const p = m ? await this.images.thumb(key, this.metaCoverUrl(m, true)) : null;
        if (!m)
            this.prefetch(key);
        return p;
    }

    async coverPath(key: string): Promise<string | null> {
        let c = this.covers.customPath(key);
        if (c)
            return c;
        const m = this.meta.get(key);
        const e = this.entry(key);
        if (e) {
            try {
                await this.be.cat.filesFor(e);
            }
            catch { /* nada */ }
            const url = this.metaCoverUrl(m, false) || e.cover;
            c = await this.images.cover(key, url);
            if (c && !this.images.cachedThumb(key))
                this.thumbBg(key);
            return c || this.thumbPath(key);
        }
        const url = this.metaCoverUrl(m, false);
        c = url ? await this.images.cover(key, url) : null;
        if (c && !this.images.cachedThumb(key))
            this.thumbBg(key);
        return c;
    }

    shotPath(key: string, i: number): Promise<string | null> {
        const m = this.meta.get(key) || {};
        const shots: string[] = m.shots || [];
        if (!(i >= 0 && i < shots.length))
            return Promise.resolve(null);
        return this.images.shot(key, i, shots[i]);
    }

    async warmShots(key: string) {
        const m = this.meta.get(key) || {};
        const n = Math.min(3, (m.shots || []).length);
        for (let i = 0; i < n; i++) {
            try {
                await this.shotPath(key, i);
            }
            catch { /* nada */ }
        }
    }

    async heroPath(key: string): Promise<string | null> {
        const m = this.meta.get(key) || {};
        const bgf = m.background_file;
        if (bgf && fs.existsSync(bgf) && fs.statSync(bgf).isFile()) {
            if (IMG_EXT.includes(path.extname(bgf).toLowerCase()))
                return bgf;
            const h = await this.images.localHero(key, bgf);
            if (h)
                return h;
        }
        const url = m.hero || m.hero_url;
        if (url) {
            const h = await this.images.cover('hero:' + key, url);
            if (h)
                return h;
        }
        return this.coverHero(key);
    }

    private async coverHero(key: string): Promise<string | null> {
        const c = await this.coverPath(key);
        if (!c)
            return null;
        const p = path.join(P.CACHE_COVERS, `h_${safeName(key)}.jpg`);
        try {
            if (fs.existsSync(p) && fs.statSync(p).mtimeMs >= fs.statSync(c).mtimeMs)
                return p;
            return blurHero(c, p) ? p : c;
        }
        catch {
            return c;
        }
    }

    private thumbBg(key: string) {
        if (!this.covers.once('thumb:' + key))
            return;
        void this.thumbPath(key, true).catch((ex) => log.debug('thumb bg %s: %s', key, ex?.message || ex)).finally(() => this.covers.done('thumb:' + key));
    }

    private prefetch(key: string) {
        this.queueMeta(key, 1);
    }

    private deepCover(key: string, e: any) {
        if (!this.covers.once('deep:' + key))
            return;
        void (async () => {
            try {
                await this.be.cat.filesFor(e);
                const url = e.cover || e.thumb;
                if (url && await this.images.thumb(key, url))
                    this.be.push({ type: 'meta_ready', key, has_cover: true, cv: Math.trunc(Date.now() / 1000) });
            }
            catch (ex: any) {
                log.debug('deep cover %s: %s', key, ex?.message || ex);
            }
        })();
    }

    async setCover(key: string, src: string | null): Promise<any> {
        if (!src) {
            src = await dialogs.pickFile('image', path.join(os.homedir(), 'Pictures'));
            if (!src)
                return { ok: false };
        }
        const r = this.covers.setCustom(key, src);
        if (r.ok) {
            this.images.invalidate(key);
            this.images.invalidate('hero:' + key);
        }
        return r;
    }

    resetCover(key: string) {
        this.covers.removeCustom(key);
        this.images.invalidate(key);
        return { ok: true };
    }

    queueMeta(key: string, priority = 5) {
        if (!(this.store.config.auto_metadata ?? true) || !key)
            return;
        if (this.be.quiet && priority > 0) {
            this.mqLater.add(key);
            return;
        }
        if (this.mqPending.has(key)) {
            if (priority > 1)
                return;
        }
        else {
            this.mqPending.add(key);
            this.mqTotal += 1;
        }
        this.mqN += 1;
        this.mq.push([priority, this.mqN, key]);
        this.mq.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
        while (this.mqWorkers < Math.min(META_WORKERS, this.mq.length)) {
            this.mqWorkers += 1;
            void this.metaWorker().finally(() => { this.mqWorkers -= 1; });
        }
        this.wake();
    }

    private wake() {
        const w = this.mqWake.splice(0);
        for (const f of w)
            f();
    }

    private waitWake(ms: number): Promise<void> {
        return new Promise((resolve) => {
            const t = setTimeout(() => {
                this.mqWake = this.mqWake.filter((f) => f !== fin);
                resolve();
            }, ms);
            const fin = () => {
                clearTimeout(t);
                resolve();
            };
            this.mqWake.push(fin);
        });
    }

    resumeQueue() {
        const later = [...this.mqLater];
        this.mqLater = new Set();
        for (const k of later)
            this.queueMeta(k, 9);
        if (this.mq.length && !this.mqWorkers) {
            this.mqWorkers += 1;
            void this.metaWorker().finally(() => { this.mqWorkers -= 1; });
        }
        this.wake();
    }

    get pending(): number {
        return Math.max(0, this.mqTotal - this.mqDone) + this.covers.inflight('fetch:');
    }

    private async metaWorker() {
        let idleSince: number | null = null;
        for (;;) {
            while (!this.mq.length || this.be.quiet) {
                if (!this.mqPending.size && this.mqTotal) {
                    const n = this.mqTotal;
                    this.mqTotal = 0;
                    this.mqDone = 0;
                    this.be.act('');
                    this.be.push({ type: 'meta_batch_done', count: n });
                }
                if (idleSince === null)
                    idleSince = Date.now();
                await this.waitWake(20_000);
                if (!this.mq.length && Date.now() - idleSince > 15_000)
                    return;
            }
            idleSince = null;
            const [, , key] = this.mq.shift()!;
            if (!this.mqPending.has(key))
                continue;
            this.mqPending.delete(key);
            const done = this.mqDone, total = this.mqTotal;
            if (total > 3)
                this.be.act(`Baixando capas e informações (${Math.min(done + 1, total)}/${total})…`);
            try {
                if (this.meta.get(key) === null)
                    await this.fetchMetadata(key, false);
                if (this.mine(key))
                    await this.warmShots(key);
            }
            catch (ex: any) {
                log.debug('meta %s: %s', key, ex?.message || ex);
            }
            this.mqDone += 1;
        }
    }

    async fetchMetadata(key: string, force: boolean): Promise<any> {
        if (!force) {
            const cached = this.meta.get(key);
            if (cached !== null)
                return cached;
        }
        const tag = 'fetch:' + key;
        if (!this.covers.once(tag)) {
            for (let i = 0; i < 160; i++) {
                await sleep(250);
                if (!this.covers.busy(tag))
                    break;
            }
            return this.meta.get(key) || {};
        }
        try {
            return await this.fetchMetadataInner(key, force);
        }
        finally {
            this.covers.done(tag);
        }
    }

    private async fetchMetadataInner(key: string, force: boolean): Promise<any> {
        const e = this.entry(key);
        let title: string, year: string, system: string;
        if (e) {
            title = e.title;
            year = e.year;
            system = e.system;
        }
        else if (key.startsWith('local:')) {
            const info = this.store.lib(key);
            if (!info)
                return { error: 'not found' };
            title = info.title || '';
            year = '';
            system = info.system || 'pc';
        }
        else {
            const r = this.be.emu.scanAll().find((x: any) => x.key === key);
            if (!r)
                return { error: 'not found' };
            title = r.title;
            year = '';
            system = r.system;
        }
        const had = this.meta.get(key) !== null;
        const hint = e ? String((e.extra || {}).steam_appid || '') : '';
        const m = await this.meta.fetch(key, title, year, system, force, hint);
        if (force) {
            this.images.invalidate(key);
            this.images.invalidate('hero:' + key);
        }
        if ((!had || force) && m) {
            this.autoRename(key, title, m);
            try {
                await this.thumbPath(key);
            }
            catch { /* nada */ }
            this.be.push({ type: 'meta_ready', key, has_cover: Boolean(m.cover_url || m.grid || m.wiki_image), cv: this.cv(key, m),
                genres: (m.genres || []).slice(0, 3), year: m.year || '', creator: m.developer || '',
                found: (m.source || []).some((x: string) => x !== 'web'), title, mine: this.mine(key) });
        }
        return m;
    }

    cv(key: string, m: any): number {
        const mt = (f: string | null | undefined) => {
            if (!f)
                return 0;
            try {
                return Math.trunc(fs.statSync(f).mtimeMs / 1000);
            }
            catch {
                return 0;
            }
        };
        const mm = m || {};
        return Math.trunc(Math.max(mt(this.covers.customPath(key)), mt(mm.background_file ? String(mm.background_file) : ''), this.meta.mtime(key), Number(mm.fetched_at || 0)));
    }

    private async others(key: string) {
        const out: any[] = [];
        const payload = await this.be.cat.payload();
        for (const g of payload.games || [])
            if (g.key !== key && g.has_meta && (g.installed || g.key.startsWith('local:') || g.key.startsWith('rom:')))
                out.push({ key: g.key, title: g.title, system: g.system || 'pc' });
        out.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
        return out;
    }

    async editInfo(key: string): Promise<any> {
        const d = await this.be.gamePayload(key);
        if (!d)
            return { error: 'not found' };
        const m = d.meta || {};
        const info = this.store.lib(key) || {};
        const user = m.user || {};
        const isRom = key.startsWith('rom:') || d.kind === 'rom' || info.kind === 'rom';
        const exe = d.exe || '';
        const sysid = d.system || info.system || 'pc';
        const others = await this.others(key);
        const systems: Record<string, string> = {};
        for (const [k, v] of Object.entries<any>(this.be.emu.presets.systems))
            systems[k] = v.name;
        const autoLinks = [
            m.steam_appid ? { name: 'Steam', url: `https://store.steampowered.com/app/${m.steam_appid}` } : null,
            m.gog_url ? { name: 'GOG', url: m.gog_url } : null,
            m.wiki_url ? { name: 'Wikipedia', url: m.wiki_url } : null,
            d.page_url ? { name: 'Origem', url: d.page_url } : null,
        ].filter(Boolean);
        const ms = this.store.config.meta_sources || {};
        const sources = [
            { id: 'steam', name: 'Steam' }, { id: 'gog', name: 'GOG' }, { id: 'wikipedia', name: 'Wikipedia' }, { id: 'wikidata', name: 'Wikidata' },
            sysid !== 'pc' ? { id: 'libretro', name: 'Boxart de console (libretro)' } : null,
            { id: 'web', name: 'Imagens da web (Bing, DuckDuckGo, Yandex)' },
        ].filter(Boolean).filter((x: any) => ms[x.id] !== false);
        return {
            key, title: d.title || '', title_orig: d.title_orig || '', title_locked: Boolean(d.title_locked),
            kind: isRom ? 'rom' : (d.kind || 'pc'), system: sysid, systems,
            can_rename: key.startsWith('local:') || key.startsWith('rom:'), can_move: Boolean(Object.keys(info).length) && !isRom && !exe.includes('://'),
            developer: m.developer || '', publisher: m.publisher || '', year: String(m.year || d.year || ''),
            genres: [...(m.genres || d.genres || [])], summary: m.summary || d.description || '',
            series: m.series || '', modes: m.modes || '', notes: m.notes || '', links: [...(m.links || [])],
            status: m.status || '', score: Math.trunc(Number(m.score || 0)),
            auto_links: autoLinks,
            user: Object.keys(user).sort(), source: m.source || [], copied_from: m.copied_from || '',
            cover_src: d.cover_src || '', custom_cover: Boolean(d.custom_cover), cover_url: m.cover_url || '',
            hero_url: m.hero_url || '', background_file: m.background_file || '', cv: this.cv(key, m),
            installed: Boolean(d.installed), dir: d.dir || '', exe, args: d.args || '',
            workdir: info.workdir || '', admin: Boolean(info.admin), pre_cmd: info.pre_cmd || '', post_cmd: info.post_cmd || '', pfx: info.pfx || '',
            emu: d.emu ?? null, emulator: (this.store.config.game_emulator || {})[key] || '',
            fav: this.be.favorites.has(key), playtime_h: d.playtime_h || '', last_played: d.last_played || 0,
            added_at: info.installed_at || 0, version: d.version || '', repo: d.repo || '', playtime: info.playtime || 0, play_count: info.play_count || 0,
            others: others.slice(0, 400), native: true,
            sources,
        };
    }

    async editWebCovers(key: string, title: string, kind = 'cover'): Promise<any> {
        const d = (await this.be.gamePayload(key)) || {};
        let hits: any[];
        try {
            if (kind === 'hero')
                hits = await this.web.searchWide(title || d.title || '', d.system || 'pc', 24);
            else
                hits = await this.web.search(title || d.title || '', d.system || 'pc', 24);
        }
        catch (e: any) {
            return { error: String(e?.message || e) };
        }
        if (!hits.length)
            return { error: 'Nenhuma imagem parecida com esse nome — tente um nome mais simples ou em inglês' };
        return { hits };
    }

    async editWebSearch(q: string, engine = 'auto', page = 0, kind = 'cover'): Promise<any> {
        try {
            const r = await this.web.engineSearch(String(engine || 'auto'), String(q || ''), Math.max(0, Math.min(20, Number(page) || 0)), kind === 'hero' ? 'hero' : 'cover');
            return { hits: r.hits, more: r.more, page: Number(page) || 0 };
        }
        catch (e: any) {
            return { error: String(e?.message || e) };
        }
    }

    async editSave(key: string, data: any): Promise<any> {
        data = data || {};
        const info = this.store.lib(key);
        const d = await this.be.gamePayload(key);
        if (!d)
            return { error: 'not found' };
        const sysid = data.system || d.system || 'pc';
        let changedTitle = false;
        const title = String(data.title || '').trim();
        if (title && title !== d.title) {
            this.applyTitle(key, title, true);
            changedTitle = true;
        }
        if (data.unlock_title && (info || key.startsWith('rom:'))) {
            if (info)
                this.store.patchLib(key, { title_locked: false });
            const ov = this.titleOverrides();
            if (ov[key]) {
                ov[key].locked = false;
                this.store.setConfig({ title_overrides: ov });
            }
        }
        if (info && data.system && data.system !== (info.system || 'pc') && ['local', 'rom'].includes(info.kind))
            this.store.patchLib(key, { system: data.system });
        const fields: any = {};
        for (const k of ['developer', 'publisher', 'year', 'summary', 'series', 'modes', 'notes'])
            if (k in data)
                fields[k] = String(data[k] || '').trim();
        if ('status' in data)
            fields.status = STATUSES.includes(String(data.status || '')) ? String(data.status || '') : '';
        if ('score' in data) {
            const n = parseInt(String(data.score || 0), 10);
            fields.score = Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 0;
        }
        if ('genres' in data) {
            let g = data.genres;
            if (typeof g === 'string')
                g = g.split(/[,;/]/).map((x: string) => x.trim()).filter(Boolean);
            fields.genres = [...(g || [])].slice(0, 8);
        }
        if ('links' in data)
            fields.links = (data.links || []).filter((l: any) => String(l.url || '').trim())
                .map((l: any) => ({ name: String(l.name || '').trim().slice(0, 40), url: String(l.url || '').trim() }));
        const prevMeta = this.meta.get(key) || {};
        if ('cover_url' in data) {
            fields.cover_url = String(data.cover_url || '').trim();
            fields.cover_src = fields.cover_url ? 'manual' : '';
            if (fields.cover_url && (fields.cover_url !== (prevMeta.user || {}).cover_url || !this.covers.customPath(key))) {
                const r = await this.covers.fetchCustom(key, fields.cover_url, 'cover', String(data.cover_page || ''), String(data.cover_thumb || ''));
                if (r.error)
                    return { error: r.error };
                this.images.invalidate(key);
            }
        }
        if ('hero_url' in data) {
            fields.hero_url = String(data.hero_url || '').trim();
            if (fields.hero_url && (fields.hero_url !== (prevMeta.user || {}).hero_url || !(prevMeta.background_file && fs.existsSync(String(prevMeta.background_file))))) {
                const r = await this.covers.fetchCustom(key, fields.hero_url, 'hero', String(data.hero_page || ''), String(data.hero_thumb || ''));
                if (r.error)
                    return { error: r.error };
                fields.background_file = r.path;
                this.images.invalidate('hero:' + key);
            }
        }
        if ('background_file' in data && !('background_file' in fields))
            fields.background_file = String(data.background_file || '').trim();
        if (Object.keys(fields).length) {
            const before = this.meta.get(key) || {};
            const m = this.meta.setUser(key, fields, sysid);
            if (before.cover_url !== m.cover_url || before.hero_url !== m.hero_url || before.background_file !== m.background_file) {
                this.images.invalidate(key);
                this.images.invalidate('hero:' + key);
            }
        }
        if (info) {
            const patch: any = {};
            if ('exe' in data && !key.startsWith('rom:') && info.kind !== 'rom') {
                const exe = String(data.exe || '').trim().replace(/^"|"$/g, '');
                if (exe && exe !== info.exe) {
                    if (!exe.includes('://') && !fs.existsSync(exe))
                        return { error: 'Esse executável não existe' };
                    patch.exe = exe;
                    if (!exe.includes('://') && !data.dir)
                        patch.dir = path.dirname(exe);
                }
            }
            if ('dir' in data) {
                const folder = String(data.dir || '').trim().replace(/^"|"$/g, '');
                if (folder && folder !== info.dir) {
                    if (!(fs.existsSync(folder) && fs.statSync(folder).isDirectory()))
                        return { error: 'Essa pasta não existe' };
                    patch.dir = folder;
                }
            }
            if ('playtime_hours' in data && String(data.playtime_hours).trim() !== '') {
                const hrs = parseFloat(String(data.playtime_hours).replace(',', '.'));
                if (Number.isFinite(hrs)) {
                    const h = Math.max(0, hrs);
                    if (Math.abs(h * 3600 - Number(info.playtime || 0)) >= 60)
                        patch.playtime = h * 3600;
                }
            }
            if ('play_count' in data && String(data.play_count).trim() !== '') {
                const f = parseFloat(String(data.play_count));
                if (Number.isFinite(f)) {
                    const pc = Math.max(0, Math.trunc(f));
                    if (pc !== Math.trunc(Number(info.play_count || 0)))
                        patch.play_count = pc;
                }
            }
            if ('workdir' in data) {
                const wd = String(data.workdir || '').trim().replace(/^"|"$/g, '');
                if (wd && !(fs.existsSync(wd) && fs.statSync(wd).isDirectory()))
                    return { error: 'A pasta de trabalho não existe' };
                patch.workdir = wd;
            }
            if ('version' in data)
                patch.version = String(data.version || '').trim();
            if (Object.keys(patch).length)
                this.store.patchLib(key, patch);
        }
        if ('args' in data)
            this.setShortcut(key, null, String(data.args || ''));
        if (info) {
            const launch: any = {};
            if ('admin' in data)
                launch.admin = Boolean(data.admin);
            for (const f of ['pre_cmd', 'post_cmd'])
                if (f in data)
                    launch[f] = String(data[f] || '').trim().slice(0, 2000);
            if ('pfx' in data)
                launch.pfx = data.pfx === 'own' ? 'own' : '';
            if (Object.keys(launch).length)
                this.store.patchLib(key, launch);
        }
        if ('emulator' in data && (key.startsWith('rom:') || (info || {}).kind === 'rom'))
            this.be.setGameEmulator(key, data.emulator || null);
        if ('fav' in data && Boolean(data.fav) !== this.be.favorites.has(key))
            this.be.toggleFavorite(key);
        this.be.cat.slimCache.delete(key);
        const m = this.meta.get(key) || {};
        this.be.push({ type: 'meta_ready', key, has_cover: Boolean(m.cover_url), cv: this.cv(key, m),
            genres: (m.genres || []).slice(0, 3), year: m.year || '', creator: m.developer || '', found: true, mine: true, title: '' });
        if (changedTitle)
            this.be.push({ type: 'renamed', key, title, old: d.title || '' });
        if (changedTitle && data.refetch) {
            this.meta.clear(key);
            this.images.invalidate(key);
            this.images.invalidate('hero:' + key);
            void this.fetchMetadata(key, true).catch(() => undefined);
        }
        return { ok: true, title: title || d.title };
    }

    async editProbe(key: string, source: string, title: string): Promise<any> {
        const d = (await this.be.gamePayload(key)) || {};
        try {
            return await this.meta.probe(source, title || d.title || '', d.system || 'pc', String(d.year || ''));
        }
        catch (e: any) {
            return { error: String(e?.message || e) };
        }
    }

    async editCandidates(key: string, source: string, title: string): Promise<any> {
        const d = (await this.be.gamePayload(key)) || {};
        try {
            return await this.meta.candidates(source, title || d.title || '', d.system || 'pc');
        }
        catch (e: any) {
            return { error: String(e?.message || e) };
        }
    }

    async editProbeId(key: string, source: string, id: string, title: string): Promise<any> {
        const d = (await this.be.gamePayload(key)) || {};
        try {
            return await this.meta.probeById(source, String(id || ''), title || d.title || '', d.system || 'pc');
        }
        catch (e: any) {
            return { error: String(e?.message || e) };
        }
    }

    async editCopy(key: string, srcKey: string): Promise<any> {
        const d = (await this.be.gamePayload(key)) || {};
        const m = this.meta.copyFrom(key, srcKey, d.system || 'pc');
        if (!m)
            return { error: 'O jogo de origem não tem metadados' };
        this.images.invalidate(key);
        this.images.invalidate('hero:' + key);
        const c = this.covers.customPath(srcKey);
        if (c && !this.covers.customPath(key))
            this.covers.setCustom(key, c, true);
        this.be.cat.slimCache.delete(key);
        this.be.push({ type: 'meta_ready', key, has_cover: Boolean(m.cover_url), cv: this.cv(key, m),
            genres: (m.genres || []).slice(0, 3), year: m.year || '', creator: m.developer || '', found: true, mine: true, title: '' });
        return { ok: true };
    }

    editReset(key: string) {
        this.meta.clear(key);
        this.images.invalidate(key);
        this.images.invalidate('hero:' + key);
        this.be.cat.slimCache.delete(key);
        if (this.store.config.auto_metadata ?? true)
            void this.fetchMetadata(key, true).catch(() => undefined);
        return { ok: true };
    }

    titleOverrides(): Record<string, any> {
        return { ...(this.store.config.title_overrides || {}) };
    }

    applyTitle(key: string, title: string, locked: boolean) {
        title = title.trim();
        const info = this.store.lib(key);
        if (info)
            this.store.patchLib(key, { title, title_locked: locked, title_orig: info.title_orig || info.title || '' });
        if (key.startsWith('rom:') || !info) {
            const ov = this.titleOverrides();
            ov[key] = { title, locked };
            this.store.setConfig({ title_overrides: ov });
            this.be.emu.invalidateScan();
        }
    }

    titleLocked(key: string): boolean {
        const info = this.store.lib(key) || {};
        if (info.title_locked)
            return true;
        return Boolean((this.titleOverrides()[key] || {}).locked);
    }

    autoRename(key: string, current: string, m: any): string | null {
        if (!(this.store.config.auto_rename ?? true) || this.titleLocked(key))
            return null;
        const neu = (m || {}).canonical_title || '';
        if (!neu || neu === current || !(m || {}).canonical_confident)
            return null;
        if (key.startsWith('local:') || key.startsWith('rom:')) {
            this.applyTitle(key, neu, false);
            this.be.push({ type: 'renamed', key, title: neu, old: current });
            return neu;
        }
        return null;
    }

    renameGame(key: string, title: string) {
        title = String(title || '').trim();
        if (!title)
            return { error: 'Nome vazio' };
        if (!this.store.lib(key) && !key.startsWith('rom:'))
            return { error: 'not found' };
        this.applyTitle(key, title, true);
        this.meta.clear(key);
        this.images.invalidate(key);
        this.images.invalidate('hero:' + key);
        if (this.store.config.auto_metadata ?? true)
            void this.fetchMetadata(key, true).catch(() => undefined);
        return { ok: true, title };
    }

    setShortcut(key: string, exe: string | null = null, args: string | null = null) {
        const info = this.store.lib(key);
        if (!info && !key.startsWith('rom:'))
            return { error: 'Não instalado' };
        if (exe !== null && info) {
            exe = exe.trim().replace(/^"|"$/g, '');
            if (exe && !fs.existsSync(exe) && !exe.includes('://'))
                return { error: 'Esse executável não existe' };
            if (exe)
                this.store.patchLib(key, { exe, dir: exe.includes('://') ? (info.dir || '') : path.dirname(exe) });
        }
        if (args !== null) {
            const ga = { ...(this.store.config.game_args || {}) };
            if (args.trim())
                ga[key] = args.trim();
            else
                delete ga[key];
            this.store.setConfig({ game_args: ga });
        }
        return { ok: true, exe: (this.store.lib(key) || {}).exe || '', args: this.be.gameArgs(key) };
    }

    refetchAllMetadata() {
        if (!this.covers.once('refetch:all'))
            return { ok: false, error: 'Já está atualizando.' };
        void (async () => {
            let keys: string[] = Object.keys(this.store.library);
            try {
                keys = keys.concat(this.be.emu.scanAll().map((r: any) => r.key));
            }
            catch { /* nada */ }
            keys = [...new Set(keys)];
            let n = 0;
            try {
                for (let i = 0; i < keys.length; i++) {
                    try {
                        this.be.act(`Atualizando metadados (${i + 1}/${keys.length})…`, true);
                        await this.fetchMetadata(keys[i], true);
                        n += 1;
                        await sleep(300);
                    }
                    catch (ex: any) {
                        log.debug('refetch %s: %s', keys[i], ex?.message || ex);
                    }
                }
            }
            finally {
                this.be.act('');
                this.covers.done('refetch:all');
                this.be.notify('info', 'Metadados atualizados', (n !== 1 ? `${n} jogos revisados` : '1 jogo revisado') + ' (capas, nomes e informações).');
            }
        })();
        return { ok: true, count: Object.keys(this.store.library).length };
    }
}
