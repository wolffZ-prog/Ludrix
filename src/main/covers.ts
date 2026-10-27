import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as P from './paths';
import * as http from './http';
import { ratio } from './titles';
import { fetchImage } from './imgfetch';
import * as imgdecode from './imgdecode';
import * as log from './log';

const STEAM_SEARCH = 'https://store.steampowered.com/api/storesearch/';
const STEAM_DETAILS = 'https://store.steampowered.com/api/appdetails';
const STEAM_CDN = 'https://cdn.akamai.steamstatic.com/steam/apps/{aid}/';
const LIBRETRO = 'https://thumbnails.libretro.com/{sys}/Named_Boxarts/';

export const LIBRETRO_SYS: Record<string, string> = {
    ps1: 'Sony - PlayStation', ps2: 'Sony - PlayStation 2', psp: 'Sony - PlayStation Portable', ps3: 'Sony - PlayStation 3',
    n64: 'Nintendo - Nintendo 64', gc: 'Nintendo - GameCube', wii: 'Nintendo - Wii', wiiu: 'Nintendo - Wii U',
    gba: 'Nintendo - Game Boy Advance', snes: 'Nintendo - Super Nintendo Entertainment System', nes: 'Nintendo - Nintendo Entertainment System',
    nds: 'Nintendo - Nintendo DS', '3ds': 'Nintendo - Nintendo 3DS',
    genesis: 'Sega - Mega Drive - Genesis', sms: 'Sega - Master System - Mark III', dc: 'Sega - Dreamcast', saturn: 'Sega - Saturn',
    xbox: 'Microsoft - Xbox', x360: 'Microsoft - Xbox 360', pce: 'NEC - PC Engine - TurboGrafx 16', atari2600: 'Atari - 2600',
    arcade: 'MAME', dos: 'DOS', pc: '', switch: '',
};
const LIBRETRO_ALT: Record<string, string[]> = { gba: ['Nintendo - Game Boy Color', 'Nintendo - Game Boy'], sms: ['Sega - Game Gear'] };
const GOG_CATALOG = 'https://catalog.gog.com/v1/catalog';
const CUSTOM_EXT = ['.png', '.jpg', '.jpeg', '.webp'];

export function norm(t: string): string {
    let s = String(t || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x00-\x7f]/g, '');
    s = s.replace(/\(.*?\)|\[.*?\]/g, '');
    s = s.toLowerCase().replace(/[\u2122\u00ae]|\b(the|a|an|of|and|&|-)\b/g, ' ');
    s = s.replace(/[^a-z0-9 ]+/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
}

export function sim(a: string, b: string): number {
    return ratio(a, b);
}

function quote(s: string): string {
    return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function safeKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120);
}

function nativeImage(): any {
    return require('electron').nativeImage;
}

export class CoverService {
    customDir = path.join(P.DATA, 'covers');
    private lrIndex = new Map<string, [number, Array<[string, string]>]>();
    private inflightSet = new Set<string>();
    private names = new Set<string>();
    private namesT = 0;
    invalidateNames() {
        this.namesT = 0;
    }
    constructor(public s: http.Session, public store: any) { }

    private listing(): Set<string> {
        const now = Date.now() / 1000;
        if (now - this.namesT > 2.0) {
            try {
                this.names = new Set(fs.readdirSync(this.customDir));
            }
            catch {
                this.names = new Set();
            }
            this.namesT = now;
        }
        return this.names;
    }

    customPath(key: string): string | null {
        const names = this.listing();
        if (!names.size)
            return null;
        const base = safeKey(key);
        for (const ext of CUSTOM_EXT)
            if (names.has(base + ext))
                return path.join(this.customDir, base + ext);
        return null;
    }

    setCustom(key: string, src: string, fast = false): any {
        if (!fs.existsSync(src))
            return { error: 'Arquivo não encontrado' };
        const ext = path.extname(src).toLowerCase();
        if (fast && CUSTOM_EXT.includes(ext)) {
            try {
                if (fs.statSync(src).size <= 4 * 1024 * 1024) {
                    this.removeCustom(key);
                    fs.mkdirSync(this.customDir, { recursive: true });
                    const dest = path.join(this.customDir, safeKey(key) + ext);
                    fs.copyFileSync(src, dest);
                    this.namesT = 0;
                    return { ok: true, path: dest };
                }
            }
            catch (ex: any) {
                return { error: String(ex?.message || ex) };
            }
        }
        let img: any;
        try {
            img = nativeImage().createFromPath(src);
            if (img.isEmpty())
                throw new Error('vazio');
        }
        catch {
            return { error: 'Não consegui abrir essa imagem (use PNG, JPG ou WEBP)' };
        }
        this.removeCustom(key);
        fs.mkdirSync(this.customDir, { recursive: true });
        const dest = path.join(this.customDir, safeKey(key) + '.png');
        const { width, height } = img.getSize();
        if (height > 1200)
            img = img.resize({ width: Math.round(width * 1200 / height), height: 1200, quality: 'good' });
        fs.writeFileSync(dest, img.toPNG());
        this.namesT = 0;
        return { ok: true, path: dest };
    }

    removeCustom(key: string) {
        const p = this.customPath(key);
        if (p)
            fs.rmSync(p, { force: true });
        this.namesT = 0;
    }

    async fetchCustom(key: string, url: string, kind = 'cover', referer = '', thumb = ''): Promise<any> {
        if (!/^https?:\/\//i.test(url))
            return { error: 'O link da imagem precisa começar com http' };
        const got = await fetchImage(this.s, url, { referer, thumb });
        if (!got.data.length)
            return { error: `Não consegui baixar essa imagem (${got.why}). Escolha outra.` };
        const dec = kind === 'hero'
            ? await imgdecode.decode(got.data, { maxW: 1920, fmt: 'jpeg', quality: 88 })
            : await imgdecode.decode(got.data, { maxH: 1200, fmt: 'png' });
        if (!dec) {
            log.warn(`imagem baixada mas não decodificou: ${url.slice(0, 120)} (${got.data.length} bytes, via ${got.via})`);
            return { error: 'O link não aponta para uma imagem (PNG, JPG, WEBP ou GIF)' };
        }
        fs.mkdirSync(this.customDir, { recursive: true });
        if (kind === 'hero') {
            const dest = path.join(this.customDir, safeKey(key) + '_hero.jpg');
            fs.writeFileSync(dest, dec.buf);
            return { ok: true, path: dest };
        }
        this.removeCustom(key);
        const dest = path.join(this.customDir, safeKey(key) + '.png');
        fs.writeFileSync(dest, dec.buf);
        this.namesT = 0;
        return { ok: true, path: dest };
    }

    srcOn(id: string): boolean {
        const m = this.store.config.meta_sources || {};
        return m[id] !== false;
    }

    async resolve(meta: any, title: string, system = 'pc', year = ''): Promise<any> {
        const q = String(title || '').replace(/\(.*?\)|\[.*?\]/g, '').trim();
        system = system || 'pc';
        if (system === 'pc') {
            for (const [name, fn] of [['steam', this.steam], ['gog', this.gog]] as Array<[string, any]>) {
                if (meta.cover_url)
                    break;
                if (!this.srcOn(name))
                    continue;
                try {
                    await fn.call(this, meta, q, year);
                }
                catch (e: any) {
                    meta[name + '_error'] = String(e?.message || e);
                }
            }
        }
        else {
            try {
                if (this.srcOn('libretro'))
                    await this.libretro(meta, q, system);
            }
            catch (e: any) {
                meta.libretro_error = String(e?.message || e);
            }
            if (!meta.cover_url && ['switch', 'ps3', 'x360', 'wiiu', 'ps4'].includes(system)) {
                try {
                    if (this.srcOn('steam'))
                        await this.steam(meta, q, year, 0.9, false);
                }
                catch { }
                if (!meta.cover_url) {
                    try {
                        if (this.srcOn('gog'))
                            await this.gog(meta, q, year, 0.9, false);
                    }
                    catch { }
                }
            }
            if (!meta.hero_url)
                await this.consoleHero(meta, q, system, year);
        }
        return meta;
    }

    async consoleHero(meta: any, q: string, system: string, year: string) {
        const keep = { cover_url: meta.cover_url, cover_src: meta.cover_src, steam_appid: meta.steam_appid, gog_id: meta.gog_id, source: [...(meta.source || [])] };
        const restore = () => {
            if (keep.cover_url) {
                meta.cover_url = keep.cover_url;
                meta.cover_src = keep.cover_src;
            }
            if (!keep.steam_appid)
                delete meta.steam_appid;
            if (!keep.gog_id)
                delete meta.gog_id;
            meta.source = [...keep.source];
        };
        for (const [name, fn] of [['steam', this.steam], ['gog', this.gog]] as Array<[string, any]>) {
            if (meta.hero_url || !this.srcOn(name))
                continue;
            try {
                await fn.call(this, meta, q, year, 0.93, false);
            }
            catch { }
            restore();
            if (meta.hero_url)
                meta.hero_src = name;
        }
        if (meta.hero_url || !meta.libretro_name)
            return;
        const sysname = LIBRETRO_SYS[meta.libretro_sys || system];
        if (!sysname)
            return;
        for (const kind of ['Named_Snaps', 'Named_Titles']) {
            const url = LIBRETRO.replace('{sys}', quote(sysname)).replace('Named_Boxarts', kind) + quote(meta.libretro_name + '.png');
            const h = await this.s.head(url, { timeout: 10_000 }).catch(() => null);
            if (h && h.ok) {
                meta.hero_url = url;
                meta.hero_src = 'libretro';
                return;
            }
        }
    }

    private lang(): string {
        return String(this.store.config.language || 'pt-BR').toLowerCase().includes('pt') ? 'brazilian' : 'english';
    }

    steamByAppid(meta: any, aid: string, text = true) {
        return this.steamFill(meta, String(aid), text);
    }

    async steam(meta: any, q: string, year: string, minScore = 0.82, text = true) {
        const r = await this.s.get(STEAM_SEARCH, { params: { term: q, cc: 'br', l: this.lang() }, timeout: 15_000 });
        if (!r.ok)
            throw new Error(`HTTP ${r.status}`);
        const items: any[] = ((await r.json()) || {}).items || [];
        if (!items.length)
            return;
        const nq = norm(q);
        let best: any = null, bestS = 0;
        for (const it of items.slice(0, 8)) {
            let s = sim(nq, norm(it.name || ''));
            if (year && String(it.name || '').includes(year))
                s += 0.05;
            if (s > bestS) {
                best = it;
                bestS = s;
            }
        }
        if (!best || bestS < minScore)
            return;
        const aid = best.id;
        meta.steam_name = String(best.name || '').replace(/[\u2122\u00ae]/g, '').trim();
        meta.steam_score = Math.round(bestS * 1000) / 1000;
        await this.steamFill(meta, aid, text);
    }

    private async steamFill(meta: any, aid: any, text: boolean) {
        const cdn = STEAM_CDN.replace('{aid}', String(aid));
        for (const name of ['library_600x900_2x.jpg', 'library_600x900.jpg']) {
            const h = await this.s.head(cdn + name, { timeout: 10_000 }).catch(() => null);
            if (h && h.ok) {
                meta.cover_url = cdn + name;
                meta.cover_src = 'steam';
                break;
            }
        }
        const h = await this.s.head(cdn + 'library_hero.jpg', { timeout: 10_000 }).catch(() => null);
        if (h && h.ok)
            meta.hero_url = cdn + 'library_hero.jpg';
        meta.steam_appid = aid;
        if (!text) {
            (meta.source = meta.source || []).push('steam');
            return;
        }
        try {
            const d = await this.s.getJson(STEAM_DETAILS, { params: { appids: aid, l: this.lang(), cc: 'br', filters: 'basic,genres,developers,publishers,release_date,screenshots,pc_requirements' }, timeout: 15_000 });
            const data = ((d || {})[String(aid)] || {}).data || {};
            if (data && Object.keys(data).length) {
                this.steamExtrasFrom(meta, data);
                if (data.short_description && (!meta.summary || meta.summary.length < 80))
                    meta.summary = String(data.short_description).replace(/<[^>]+>/g, '');
                if (!meta.genres && data.genres)
                    meta.genres = data.genres.map((g: any) => g.description).slice(0, 4);
                if (!meta.developer && data.developers)
                    meta.developer = data.developers.slice(0, 2).join(', ');
                if (!meta.publisher && data.publishers)
                    meta.publisher = data.publishers.slice(0, 2).join(', ');
                if (!meta.year) {
                    const m = /(19|20)\d{2}/.exec((data.release_date || {}).date || '');
                    if (m)
                        meta.year = m[0];
                }
            }
        }
        catch { }
        (meta.source = meta.source || []).push('steam');
    }

    static reqLines(html: string): string[] {
        if (!html)
            return [];
        html = html.replace(/<strong>\s*(M[ií]nimos?|Minimum|Recomendados?|Recommended)\s*:?\s*<\/strong>/gi, '');
        const parts = html.split(/<li>|<br\s*\/?>/);
        const out: string[] = [];
        for (const part of parts) {
            let t = part.replace(/<[^>]+>/g, '');
            t = t.replace(/\s+/g, ' ').replace(/ \*:/g, ':').replace(/ :/g, ':').replace(/^[ :*\u00a0]+|[ :*\u00a0]+$/g, '');
            if (t.length > 2 && !out.includes(t))
                out.push(t.slice(0, 200));
        }
        return out.slice(0, 12);
    }

    private steamExtrasFrom(meta: any, data: any) {
        let shots = ((data.screenshots || []) as any[]).filter((x) => x && typeof x === 'object').map((x) => x.path_thumbnail || x.path_full);
        shots = shots.filter(Boolean).slice(0, 3);
        if (shots.length)
            meta.shots = shots;
        const pr = data.pc_requirements;
        if (pr && typeof pr === 'object' && !Array.isArray(pr)) {
            const reqs = { min: CoverService.reqLines(pr.minimum || ''), rec: CoverService.reqLines(pr.recommended || '') };
            if (reqs.min.length || reqs.rec.length)
                meta.reqs = reqs;
        }
    }

    async steamExtras(meta: any, q: string, year = '') {
        let aid = meta.steam_appid;
        if (!aid) {
            const r = await this.s.get(STEAM_SEARCH, { params: { term: q, cc: 'br', l: this.lang() }, timeout: 15_000 });
            if (!r.ok)
                throw new Error(`HTTP ${r.status}`);
            const items: any[] = ((await r.json()) || {}).items || [];
            const nq = norm(q);
            let best: any = null, bestS = 0;
            for (const it of items.slice(0, 8)) {
                let sc = sim(nq, norm(it.name || ''));
                if (year && String(it.name || '').includes(year))
                    sc += 0.05;
                if (sc > bestS) {
                    best = it;
                    bestS = sc;
                }
            }
            if (!best || bestS < 0.8)
                return;
            aid = best.id;
            meta.steam_appid = aid;
            meta.steam_name = String(best.name || '').replace(/[\u2122\u00ae]/g, '').trim();
            meta.steam_score = Math.round(bestS * 1000) / 1000;
        }
        const d = await this.s.getJson(STEAM_DETAILS, { params: { appids: aid, l: this.lang(), cc: 'br', filters: 'screenshots,pc_requirements' }, timeout: 15_000 });
        const data = ((d || {})[String(aid)] || {}).data || {};
        if (data && Object.keys(data).length)
            this.steamExtrasFrom(meta, data);
    }

    async gog(meta: any, q: string, year: string, minScore = 0.82, text = true) {
        const r = await this.s.get(GOG_CATALOG, { params: { limit: 8, query: 'like:' + q, productType: 'in:game,pack', order: 'desc:score' }, timeout: 15_000 });
        if (!r.ok)
            throw new Error(`HTTP ${r.status}`);
        const prods: any[] = ((await r.json()) || {}).products || [];
        if (!prods.length)
            return;
        const nq = norm(q);
        let best: any = null, bestS = 0;
        for (const p of prods) {
            let s = sim(nq, norm(p.title || ''));
            if (year && String(p.releaseDate || '').startsWith(year))
                s += 0.05;
            if (s > bestS) {
                best = p;
                bestS = s;
            }
        }
        if (!best || bestS < minScore)
            return;
        meta.gog_id = best.id;
        meta.gog_name = String(best.title || '').replace(/[\u2122\u00ae]/g, '').trim();
        meta.gog_score = Math.round(bestS * 1000) / 1000;
        if (best.coverVertical) {
            meta.cover_url = best.coverVertical;
            meta.cover_src = 'gog';
        }
        if (best.galaxyBackgroundImage && !meta.hero_url)
            meta.hero_url = best.galaxyBackgroundImage;
        if (best.storeLink)
            meta.gog_url = best.storeLink;
        if (text) {
            if (!meta.developer && best.developers)
                meta.developer = best.developers.slice(0, 2).join(', ');
            if (!meta.publisher && best.publishers)
                meta.publisher = best.publishers.slice(0, 2).join(', ');
            if (!meta.genres && best.genres)
                meta.genres = best.genres.map((g: any) => g.name || '').filter(Boolean).slice(0, 4);
            if (!meta.year) {
                const m = /^(19|20)\d{2}/.exec(String(best.releaseDate || ''));
                if (m)
                    meta.year = m[0];
            }
        }
        (meta.source = meta.source || []).push('gog');
    }

    candCache = new Map<string, any>();
    private remember(k: string, v: any) {
        if (this.candCache.size > 400)
            this.candCache.clear();
        this.candCache.set(k, v);
    }

    async steamCandidates(q: string): Promise<any[]> {
        const r = await this.s.get(STEAM_SEARCH, { params: { term: q, cc: 'br', l: this.lang() }, timeout: 15_000 });
        if (!r.ok)
            throw new Error(`HTTP ${r.status}`);
        const items: any[] = ((await r.json()) || {}).items || [];
        const nq = norm(q);
        return items.slice(0, 20).map((it) => {
            this.remember('steam:' + it.id, it);
            const name = String(it.name || '').replace(/[\u2122\u00ae]/g, '').trim();
            return { id: String(it.id), title: name, sub: 'Steam' + (it.platforms ? ' · ' + Object.entries(it.platforms).filter(([, v]) => v).map(([k]) => k === 'windows' ? 'Windows' : k === 'mac' ? 'Mac' : 'Linux').join(', ') : ''), thumb: it.tiny_image || '', score: sim(nq, norm(name)) };
        });
    }

    async steamById(meta: any, id: string, text = true) {
        const it = this.candCache.get('steam:' + id);
        meta.steam_name = String(it?.name || '').replace(/[\u2122\u00ae]/g, '').trim();
        meta.steam_score = 1;
        await this.steamFill(meta, id, text);
        if (!meta.steam_name) {
            try {
                const d = await this.s.getJson(STEAM_DETAILS, { params: { appids: id, l: this.lang(), cc: 'br', filters: 'basic' }, timeout: 15_000 });
                meta.steam_name = String((((d || {})[String(id)] || {}).data || {}).name || '').replace(/[\u2122\u00ae]/g, '').trim();
            }
            catch { }
        }
    }

    async gogCandidates(q: string): Promise<any[]> {
        const r = await this.s.get(GOG_CATALOG, { params: { limit: 20, query: 'like:' + q, productType: 'in:game,pack', order: 'desc:score' }, timeout: 15_000 });
        if (!r.ok)
            throw new Error(`HTTP ${r.status}`);
        const prods: any[] = ((await r.json()) || {}).products || [];
        const nq = norm(q);
        return prods.map((p) => {
            this.remember('gog:' + p.id, p);
            const title = String(p.title || '').replace(/[\u2122\u00ae]/g, '').trim();
            const y = /^(19|20)\d{2}/.exec(String(p.releaseDate || ''));
            return { id: String(p.id), title, year: y ? y[0] : '', sub: ['GOG', (p.developers || []).slice(0, 2).join(', ')].filter(Boolean).join(' · '), thumb: p.coverVertical || '', score: sim(nq, norm(title)) };
        });
    }

    gogById(meta: any, id: string) {
        const best = this.candCache.get('gog:' + id);
        if (!best)
            throw new Error('Escolha expirou — procure de novo');
        meta.gog_id = best.id;
        meta.gog_name = String(best.title || '').replace(/[\u2122\u00ae]/g, '').trim();
        meta.gog_score = 1;
        if (best.coverVertical) {
            meta.cover_url = best.coverVertical;
            meta.cover_src = 'gog';
        }
        if (best.galaxyBackgroundImage)
            meta.hero_url = best.galaxyBackgroundImage;
        if (best.storeLink)
            meta.gog_url = best.storeLink;
        if (best.developers)
            meta.developer = best.developers.slice(0, 2).join(', ');
        if (best.publishers)
            meta.publisher = best.publishers.slice(0, 2).join(', ');
        if (best.genres)
            meta.genres = best.genres.map((g: any) => g.name || '').filter(Boolean).slice(0, 4);
        const m = /^(19|20)\d{2}/.exec(String(best.releaseDate || ''));
        if (m)
            meta.year = m[0];
        (meta.source = meta.source || []).push('gog');
    }

    async libretroCandidates(q: string, system: string): Promise<any[]> {
        const main = LIBRETRO_SYS[system];
        if (!main)
            return [];
        const nq = norm(q);
        const out: any[] = [];
        for (const sysname of [main, ...(LIBRETRO_ALT[system] || [])]) {
            const idx = await this.lrList(sysname);
            const first = nq.split(' ')[0];
            let cands = idx.filter(([n]) => n.includes(first));
            if (!cands.length)
                cands = idx;
            for (const [n, f] of cands.slice(0, 3000))
                out.push({ id: sysname + '|' + f, title: f.slice(0, -4), sub: sysname, thumb: LIBRETRO.replace('{sys}', quote(sysname)) + quote(f), score: sim(nq, n) });
        }
        out.sort((a, b) => b.score - a.score);
        return out.slice(0, 30);
    }

    libretroById(meta: any, id: string, system: string) {
        const i = id.indexOf('|');
        if (i <= 0)
            throw new Error('Escolha inválida');
        const sysname = id.slice(0, i), f = id.slice(i + 1);
        meta.cover_url = LIBRETRO.replace('{sys}', quote(sysname)) + quote(f);
        meta.cover_src = 'libretro';
        meta.libretro_name = f.replace(/\.png$/i, '');
        meta.libretro_sys = system;
        meta.libretro_score = 1;
        (meta.source = meta.source || []).push('libretro');
    }

    private async lrList(sysname: string): Promise<Array<[string, string]>> {
        const hit = this.lrIndex.get(sysname);
        if (hit && Date.now() / 1000 - hit[0] < 7 * 86400)
            return hit[1];
        const cache = path.join(P.CACHE_META, 'lr_' + sysname.replace(/[^a-zA-Z0-9]/g, '_') + '.txt');
        let names: string[] = [];
        if (fs.existsSync(cache) && Date.now() - fs.statSync(cache).mtimeMs < 7 * 86400 * 1000) {
            names = fs.readFileSync(cache, 'utf8').split('\n');
        }
        else {
            const r = await this.s.get(LIBRETRO.replace('{sys}', quote(sysname)), { timeout: 40_000 });
            if (!r.ok)
                throw new Error(`HTTP ${r.status}`);
            const text = await r.text();
            names = [...text.matchAll(/href="([^"]+\.png)"/g)].map((m) => {
                try {
                    return decodeURIComponent(m[1]);
                }
                catch {
                    return m[1];
                }
            });
            fs.mkdirSync(path.dirname(cache), { recursive: true });
            fs.writeFileSync(cache, names.join('\n'), 'utf8');
        }
        const idx: Array<[string, string]> = names.filter(Boolean).map((n) => [norm(n.slice(0, -4)), n]);
        if (this.lrIndex.size > 12)
            this.lrIndex.clear();
        this.lrIndex.set(sysname, [Date.now() / 1000, idx]);
        return idx;
    }

    async libretro(meta: any, q: string, system: string, minScore = 0.86) {
        const main = LIBRETRO_SYS[system];
        if (!main)
            return;
        for (const sysname of [main, ...(LIBRETRO_ALT[system] || [])]) {
            await this.libretroOne(meta, q, sysname, system, minScore);
            if (meta.cover_url)
                return;
        }
    }

    private async libretroOne(meta: any, q: string, sysname: string, system: string, minScore: number) {
        const idx = await this.lrList(sysname);
        if (!idx.length)
            return;
        const nq = norm(q);
        if (!nq)
            return;
        const first = nq.split(' ')[0];
        let cands = idx.filter(([n]) => n.startsWith(first));
        if (!cands.length)
            cands = idx.filter(([n]) => n.includes(first));
        let best: string | null = null, bestS = 0;
        for (const [n, f] of cands.slice(0, 600)) {
            let s = sim(nq, n);
            const fl = f.toLowerCase();
            if (fl.includes('(usa') || fl.includes('(world'))
                s += 0.04;
            else if (fl.includes('(europe'))
                s += 0.02;
            else if (fl.includes('(brazil'))
                s += 0.03;
            if (fl.includes('(demo') || fl.includes('(beta') || fl.includes('(proto'))
                s -= 0.1;
            if (s > bestS) {
                best = f;
                bestS = s;
            }
        }
        if (best && bestS >= minScore) {
            meta.cover_url = LIBRETRO.replace('{sys}', quote(sysname)) + quote(best);
            meta.cover_src = 'libretro';
            meta.libretro_name = best.slice(0, -4);
            meta.libretro_sys = system;
            meta.libretro_score = Math.round(bestS * 1000) / 1000;
            (meta.source = meta.source || []).push('libretro');
        }
    }

    once(key: string): boolean {
        if (this.inflightSet.has(key))
            return false;
        this.inflightSet.add(key);
        return true;
    }
    inflight(prefix: string): number {
        let n = 0;
        for (const k of this.inflightSet)
            if (k.startsWith(prefix))
                n++;
        return n;
    }
    busy(key: string): boolean {
        return this.inflightSet.has(key);
    }
    done(key: string) {
        this.inflightSet.delete(key);
    }
}
