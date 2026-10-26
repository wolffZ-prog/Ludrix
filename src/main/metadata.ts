import fs from 'node:fs';
import path from 'node:path';
import * as P from './paths';
import * as log from './log';
import * as http from './http';
import { normalizeTitle, canonicalOk, canonicalConfident, similarity, cmp } from './titles';
import { CoverService } from './covers';
import { WebImageSearch } from './websearch';

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const WIKI_API_PT = 'https://pt.wikipedia.org/w/api.php';
const PCGW_API = 'https://www.pcgamingwiki.com/w/api.php';
function appVersion(): string {
    try {
        return String(require('./updates').currentVersion().version || '4');
    }
    catch {
        return '4';
    }
}
const PCGW_HEADERS = { 'User-Agent': `LudrixHub/${appVersion()} (https://github.com/wolffZ-prog/Ludrix) Electron`, Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9' };
let pcgwLast = 0;
async function pcgwSlot() {
    const wait = pcgwLast + 1100 - Date.now();
    pcgwLast = Math.max(Date.now(), pcgwLast + 1100);
    if (wait > 0)
        await new Promise((r) => setTimeout(r, wait));
}
const REQ_PT: Record<string, string> = { OS: 'SO', Processor: 'Processador', Memory: 'Memória', Graphics: 'Placa de vídeo', Storage: 'Armazenamento', 'Hard Drive': 'Espaço em disco', 'Sound Card': 'Placa de som', Sound: 'Som', 'Additional Notes': 'Observações', Network: 'Rede', 'Video Card': 'Placa de vídeo' };
const PCGW_LABELS: Record<string, string> = { OS: 'SO', CPU: 'Processador', RAM: 'Memória', HD: 'Espaço em disco', GPU: 'Placa de vídeo', VRAM: 'Memória de vídeo', DX: 'DirectX', audio: 'Som', other: 'Outros', notes: 'Observação' };

export const SYS_WIKI: Record<string, string> = {
    ps1: 'PlayStation', ps2: 'PlayStation 2', ps3: 'PlayStation 3', psp: 'PlayStation Portable', n64: 'Nintendo 64',
    gc: 'GameCube', wii: 'Wii', wiiu: 'Wii U', switch: 'Nintendo Switch', gba: 'Game Boy Advance', snes: 'Super Nintendo',
    nes: 'Nintendo Entertainment System', nds: 'Nintendo DS', '3ds': 'Nintendo 3DS', genesis: 'Sega Genesis', sms: 'Master System',
    dc: 'Dreamcast', saturn: 'Sega Saturn', xbox: 'Xbox', x360: 'Xbox 360', pce: 'TurboGrafx-16', atari2600: 'Atari 2600',
    arcade: 'arcade', dos: 'MS-DOS', pc: 'Windows',
};
const SYS_YEARS: Record<string, [number, number]> = {
    atari2600: [1977, 1992], nes: [1983, 1995], sms: [1985, 1997], pce: [1987, 1999], genesis: [1988, 1998], snes: [1990, 2000],
    arcade: [1975, 2015], dos: [1981, 2001], saturn: [1994, 2000], ps1: [1994, 2006], n64: [1996, 2002], dc: [1998, 2002],
    gba: [2001, 2008], ps2: [2000, 2013], gc: [2001, 2007], xbox: [2001, 2008], nds: [2004, 2013], psp: [2004, 2014],
    x360: [2005, 2016], ps3: [2006, 2017], wii: [2006, 2013], '3ds': [2011, 2020], wiiu: [2012, 2017], switch: [2017, 2035],
};
const SYS_ALIASES: Record<string, string[]> = {
    ps1: ['playstation', 'ps1', 'psx', 'ps one'], ps2: ['playstation 2', 'ps2'], ps3: ['playstation 3', 'ps3'], psp: ['playstation portable', 'psp'],
    n64: ['nintendo 64', 'n64'], gc: ['gamecube'], wii: ['wii'], wiiu: ['wii u'], switch: ['nintendo switch', 'switch'],
    gba: ['game boy advance', 'gba'], snes: ['super nintendo', 'super nes', 'snes', 'super famicom'], nes: ['nintendo entertainment system', 'nes', 'famicom'],
    nds: ['nintendo ds'], '3ds': ['nintendo 3ds', '3ds'], genesis: ['genesis', 'mega drive'], sms: ['master system', 'game gear'],
    dc: ['dreamcast'], saturn: ['saturn'], xbox: ['xbox'], x360: ['xbox 360'], pce: ['turbografx', 'pc engine'],
    atari2600: ['atari 2600', '2600'], arcade: ['arcade'], dos: ['ms-dos', 'dos'], pc: ['windows', 'microsoft windows', 'pc', 'ms-dos', 'linux', 'macos', 'mac os'],
};

export function platformMatches(system: string, platforms: string[]): boolean | null {
    if (!platforms || !platforms.length)
        return null;
    const al = SYS_ALIASES[system] || [system];
    const pl = platforms.map((p) => p.toLowerCase()).join(' | ');
    if (system === 'xbox')
        return /\bxbox\b(?!\s*(360|one|series))/.test(pl);
    if (system === 'wii')
        return /\bwii\b(?!\s*u)/.test(pl);
    if (system === 'ps1')
        return /\bplaystation\b(?!\s*[2-5])/.test(pl) || pl.includes('ps1') || pl.includes('psx');
    return al.some((a) => pl.includes(a));
}

const GENRE_PT: Array<[string, string]> = [
    ['sports', 'Esportes'], ['racing', 'Corrida'], ['first-person shooter', 'FPS'], ['third-person shooter', 'Tiro em 3ª pessoa'],
    ['shooter', 'Tiro'], ['action-adventure', 'Ação/Aventura'], ['action', 'Ação'], ['adventure', 'Aventura'],
    ['platform', 'Plataforma'], ['fighting', 'Luta'], ['role-playing', 'RPG'], ['strategy', 'Estratégia'],
    ['real-time strategy', 'Estratégia (RTS)'], ['simulation', 'Simulação'], ['stealth', 'Furtividade'], ['survival horror', 'Terror'],
    ['horror', 'Terror'], ['puzzle', 'Puzzle'], ["beat 'em up", "Beat 'em up"], ['hack and slash', 'Hack and slash'],
    ['open world', 'Mundo aberto'], ['party', 'Party'], ['music', 'Música'], ['rhythm', 'Ritmo'], ['vehicular combat', 'Combate veicular'],
    ['tactical', 'Tático'], ['business simulation', 'Simulação'], ['construction and management simulation', 'Simulação'],
    ['life simulation', 'Simulação de vida'], ['graphic adventure', 'Aventura gráfica'], ['point-and-click', 'Point-and-click'],
    ['interactive drama', 'Drama interativo'], ['kart racing', 'Corrida (kart)'], ['sim racing', 'Corrida (simulação)'],
    ['arcade', 'Arcade'], ['wrestling', 'Luta livre'], ['skateboarding', 'Skate'], ['football', 'Futebol'], ['association football', 'Futebol'],
    ['american football', 'Futebol americano'], ['basketball', 'Basquete'], ['baseball', 'Beisebol'], ['god game', 'God game'],
    ['tower defense', 'Tower defense'], ['run and gun', 'Run and gun'], ['light gun shooter', 'Tiro (pistola de luz)'],
    ['space combat', 'Combate espacial'], ['flight simulation', 'Simulação de voo'], ['combat flight simulation', 'Simulação de voo'],
    ['mmorpg', 'MMORPG'], ['roguelike', 'Roguelike'], ['metroidvania', 'Metroidvania'], ['survival', 'Sobrevivência'],
];

export function cleanTitle(t: string): string {
    t = t.replace(/\(.*?\)|\[.*?\]/g, '');
    t = t.replace(/\b(repack|reupload|rohankar'?s?|complete|gold|ultimate|goty|game of the year|definitive|remastered|steam deck|anniversary|edition|collection|the video game|recompiled|recomp|enhanced|classic|signature|special|directors? cut)\b/gi, '');
    t = t.trim().replace(/[-:–—]\s*$/, '');
    return t.replace(/\s{2,}/g, ' ').replace(/^[ \-:]+|[ \-:]+$/g, '');
}

function stripWiki(v: string): string[] {
    v = v.replace(/<!--[\s\S]*?-->/g, '');
    v = v.replace(/<ref[^>]*>[\s\S]*?<\/ref>|<ref[^>]*\/>/g, '');
    for (let i = 0; i < 6; i++) {
        let v2 = v.replace(/\{\{\s*(cite|citation|sfn|efn|refn|r|cn|citation needed|clarify|when|dubious|which)\b[^{}]*\}\}/gi, '');
        v2 = v2.replace(/\{\{[^{}|]*\|([^{}]*)\}\}/g, '|$1');
        v2 = v2.replace(/\{\{[^{}|]*\}\}/g, '');
        if (v2 === v)
            break;
        v = v2;
    }
    v = v.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1');
    v = v.replace(/<[^>]+>/g, '|');
    v = v.replace(/'''/g, '').replace(/''/g, '');
    const parts = v.split(/[|,\n]/).map((p) => p.replace(/^[ *#{}]+|[ *#{}]+$/g, ''));
    const out: string[] = [];
    for (let p of parts) {
        if (!p || p.length >= 60 || /^(infobox|video game|template)\b/i.test(p))
            continue;
        if (/^(title|expand|frame_style|list_style|hlist|bullets|style|class)\s*=/i.test(p))
            p = p.split('=').slice(1).join('=').trim();
        if (!p || p.includes('=') || ['infobox', 'collapsible list', 'nobold', 'nowrap', 'small', 'ubl', 'plainlist', 'unbulleted list', 'flatlist', 'hlist', 'cslist', 'vgrelease', 'video game release', 'start date', 'yes', 'no', 'true'].includes(p.toLowerCase()))
            continue;
        out.push(p);
    }
    return out;
}

function infobox(wikitext: string): any {
    const out: any = {};
    for (const key of ['genre', 'developer', 'publisher', 'released', 'modes', 'platforms', 'series', 'engine']) {
        const pat = key === 'platforms' ? 'platforms?' : key + 's?';
        const m = new RegExp('^\\s*\\|\\s*' + pat + '\\s*=\\s*([\\s\\S]+?)(?=^\\s*\\|\\s*\\w+\\s*=|^\\s*\\}\\})', 'm').exec(wikitext);
        if (m)
            out[key] = stripWiki(m[1]);
    }
    const m = /^\s*\|\s*released?\s*=([\s\S]*?)(?=^\s*\|\s*[a-z_ ]+=|^\s*\}\})/im.exec(wikitext);
    if (m) {
        const years = [...m[1].matchAll(/\b(19[89]\d|20[0-3]\d)\b/g)].map((x) => x[1]);
        out.year = years.length ? years.sort()[0] : '';
    }
    return out;
}

function translateGenres(gs: string[]): string[] {
    const out: string[] = [];
    for (const g of gs) {
        const gl = g.toLowerCase().replace(' game', '').replace(' video', '').trim();
        let hit = false;
        for (const [k, v] of GENRE_PT) {
            if (k === gl || gl.includes(k)) {
                if (!out.includes(v))
                    out.push(v);
                hit = true;
                break;
            }
        }
        if (!hit && out.length < 4 && gl && !out.includes(gl))
            out.push(g.trim().replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()));
    }
    return out.slice(0, 4);
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

export class MetadataService {
    static WIKI_MIN_GAP = 0.25;
    static USER_FIELDS = ['tags', 'developer', 'publisher', 'year', 'genres', 'summary', 'series', 'modes', 'links', 'notes',
        'cover_url', 'cover_src', 'hero_url', 'background_file', 'platforms', 'status', 'score'];
    static SOURCES = ['steam', 'gog', 'wikipedia', 'wikidata', 'libretro', 'web'];
    static WIKI_PROPS = { action: 'query', generator: 'search', gsrlimit: 6, gsrprop: 'snippet',
        prop: 'pageimages|extracts|revisions|info|pageprops', ppprop: 'wikibase_item', exintro: 1, explaintext: 1, exlimit: 'max',
        piprop: 'original', pilicense: 'any', rvprop: 'content', rvslots: 'main', rvsection: 0,
        inprop: 'url', format: 'json', formatversion: 2 };

    covers: CoverService | null = null;
    web: WebImageSearch | null = null;
    private wikiLast = 0;
    private wikiChain: Promise<void> = Promise.resolve();
    private mem = new Map<string, [number, any]>();
    private names: Record<string, number> = {};
    private namesT = 0;

    constructor(public s: http.Session, public store: any) { }

    fname(key: string): string {
        return key.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) + '.json';
    }
    path(key: string): string {
        return path.join(P.CACHE_META, this.fname(key));
    }
    private listing(): Record<string, number> {
        const now = Date.now() / 1000;
        if (now - this.namesT > 2.0) {
            const d: Record<string, number> = {};
            try {
                for (const de of fs.readdirSync(P.CACHE_META, { withFileTypes: true })) {
                    try {
                        d[de.name] = fs.statSync(path.join(P.CACHE_META, de.name)).mtimeMs / 1000;
                    }
                    catch { /* segue */ }
                }
            }
            catch { /* vazio */ }
            this.names = d;
            this.namesT = now;
        }
        return this.names;
    }
    touch() {
        this.namesT = 0;
    }
    drop() {
        this.mem.clear();
        this.names = {};
        this.namesT = 0;
    }
    mtime(key: string): number {
        return this.listing()[this.fname(key)] || 0;
    }
    get(key: string): any | null {
        const mtime = this.listing()[this.fname(key)];
        if (mtime === undefined)
            return null;
        const hit = this.mem.get(key);
        if (hit && hit[0] === mtime)
            return hit[1];
        let data: any = null;
        try {
            data = JSON.parse(fs.readFileSync(this.path(key), 'utf8'));
        }
        catch {
            data = null;
        }
        if (this.mem.size > 3000)
            this.mem.clear();
        this.mem.set(key, [mtime, data]);
        return data;
    }
    has(key: string): boolean {
        return this.get(key) !== null;
    }
    clear(key: string) {
        fs.rmSync(this.path(key), { force: true });
        this.mem.delete(key);
        this.touch();
    }

    async fetch(key: string, title: string, year = '', system = 'pc', force = false, steamAppid = ''): Promise<any> {
        if (!force) {
            const cached = this.get(key);
            if (cached)
                return cached;
        }
        system = system || 'pc';
        const prev = this.get(key) || {};
        const meta: any = { key, fetched_at: Date.now() / 1000, source: [], system, query_title: title };
        const clean = normalizeTitle(title);
        const q = cleanTitle(clean) || clean;
        meta.query = q;
        const wmeta: any = { source: [], system };
        const timing: Record<string, number> = {};
        const t0 = Date.now();
        let tPrev = t0;
        const mark = (name: string) => { const n = Date.now(); timing[name] = n - tPrev; tPrev = n; };
        const jobs: Array<[string, () => Promise<any>]> = [];
        if (steamAppid && this.covers)
            jobs.push(['steam_error', () => this.covers!.steamByAppid(meta, steamAppid)]);
        if (this.covers)
            jobs.push(['cover_error', () => this.covers!.resolve(meta, q, system, year)]);
        if (this.srcOn('wikipedia'))
            jobs.push(['wiki_error', () => this.wikipedia(wmeta, q, year, system)]);
        await Promise.all(jobs.map(([errk, fn]) => { const ts = Date.now(); return fn().catch((e: any) => { meta[errk] = String(e?.message || e); }).finally(() => { timing[errk.replace('_error', '')] = Date.now() - ts; }); }));
        tPrev = Date.now();
        if (wmeta.wiki_title) {
            for (const [k, v] of Object.entries(wmeta)) {
                if (k === 'source' || k === 'system')
                    continue;
                if (!meta[k])
                    meta[k] = v;
            }
            meta.source.push('wikipedia');
        }
        if (wmeta.wiki_rejected)
            meta.wiki_rejected = wmeta.wiki_rejected;
        if (String(this.store.config.language || 'pt-BR').toLowerCase().includes('pt')) {
            try {
                await this.wikiPtSummary(meta);
            }
            catch { /* nada */ }
        }
        mark('wiki_pt');
        if (!meta.cover_url && this.web && (this.store.config.web_covers ?? true) && this.srcOn('web')) {
            let hit: any = null;
            try {
                hit = await this.web.bestCover(q, system);
            }
            catch (e: any) {
                meta.web_error = String(e?.message || e);
            }
            if (hit) {
                meta.cover_url = hit.url;
                meta.cover_src = 'web';
                meta.web_page = hit.page || '';
                (meta.source = meta.source || []).push('web');
            }
        }
        mark('web_cover');
        if (!meta.cover_url && meta.wiki_image) {
            meta.cover_url = meta.wiki_image;
            meta.cover_src = 'wikipedia';
        }
        if (system === 'pc' && this.covers && !meta.shots) {
            try {
                await this.covers.steamExtras(meta, q, year);
            }
            catch (e: any) {
                meta.extras_error = String(e?.message || e);
            }
        }
        mark('steam_extras');
        if (system === 'pc' && !meta.steam_appid && meta.wikidata) {
            try {
                await this.wikidataIds(meta);
            }
            catch (e: any) {
                meta.wikidata_error = String(e?.message || e);
            }
        }
        mark('wikidata');
        if (system === 'pc' && (!meta.reqs || !meta.shots)) {
            try {
                await this.pcgw(meta, q, year);
            }
            catch (e: any) {
                meta.pcgw_error = String(e?.message || e);
            }
        }
        if (system === 'pc' && this.covers && !meta.shots && meta.steam_appid && !meta.steam_name) {
            try {
                await this.covers.steamExtras(meta, q, year);
            }
            catch (e: any) {
                meta.extras_error = String(e?.message || e);
            }
        }
        mark('pcgw');
        if (system === 'pc' && meta.steam_appid && (!meta.shots || !meta.reqs)) {
            try {
                await this.steamArchive(meta, String(meta.steam_appid));
            }
            catch (e: any) {
                meta.archive_error = String(e?.message || e);
            }
        }
        mark('archive');
        if (!meta.shots && this.web && (this.store.config.web_covers ?? true)) {
            let shots: string[] = [];
            try {
                shots = await this.web.screenshots(q, system);
            }
            catch (e: any) {
                meta.web_shots_error = String(e?.message || e);
            }
            if (shots.length) {
                meta.shots = shots;
                meta.shots_src = 'web';
            }
        }
        mark('web_shots');
        timing.total = Date.now() - t0;
        if (timing.total > 4000)
            log.info('metadados %s em %ss: %s', key, (timing.total / 1000).toFixed(1), Object.entries(timing).filter(([k, v]) => k !== 'total' && v >= 300).map(([k, v]) => `${k}=${(v / 1000).toFixed(1)}s`).join(' '));
        MetadataService.pickCanonical(meta, clean, system);
        for (const k of ['background_file', 'imported', 'edited_at'])
            if (prev[k])
                meta[k] = prev[k];
        for (const k of ['summary', 'developer', 'genres', 'year', 'publisher', 'shots', 'reqs'])
            if (!meta[k] && prev[k])
                meta[k] = prev[k];
        const latest = this.get(key) || prev;
        for (const k of ['edited_at', 'copied_from'])
            if (latest[k])
                meta[k] = latest[k];
        MetadataService.applyUser(meta, latest.user);
        this.write(key, meta);
        return meta;
    }

    patch(key: string, fields: any): any | null {
        const meta = this.get(key);
        if (!meta)
            return null;
        Object.assign(meta, fields);
        MetadataService.applyUser(meta, meta.user);
        this.write(key, meta);
        return meta;
    }

    private write(key: string, meta: any) {
        fs.mkdirSync(path.dirname(this.path(key)), { recursive: true });
        fs.writeFileSync(this.path(key), JSON.stringify(meta, null, 1), 'utf8');
        this.mem.delete(key);
        this.touch();
    }

    static applyUser(meta: any, user: any) {
        if (!user || !Object.keys(user).length) {
            delete meta.user;
            return;
        }
        meta.user = user;
        for (const [k, v] of Object.entries(user))
            if (!(v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)))
                meta[k] = v;
    }

    setUser(key: string, fields: any, system = 'pc'): any {
        let meta = this.get(key) || { key, fetched_at: Date.now() / 1000, source: ['manual'], system, query_title: '' };
        const user: any = { ...(meta.user || {}) };
        for (const [k, v] of Object.entries<any>(fields)) {
            if (!MetadataService.USER_FIELDS.includes(k))
                continue;
            if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) || (k === 'score' && !v))
                delete user[k];
            else
                user[k] = v;
        }
        const base: any = {};
        for (const [k, v] of Object.entries(meta))
            if (k !== 'user')
                base[k] = v;
        for (const k of MetadataService.USER_FIELDS)
            if (k in (meta.user || {}) && !(k in user))
                delete base[k];
        meta = base;
        meta.edited_at = Date.now() / 1000;
        MetadataService.applyUser(meta, user);
        this.write(key, meta);
        return meta;
    }

    copyFrom(key: string, srcKey: string, system = 'pc'): any | null {
        const src = this.get(srcKey);
        if (!src)
            return null;
        const keep = this.get(key) || {};
        const meta: any = {};
        for (const [k, v] of Object.entries(src))
            if (k !== 'key' && k !== 'user')
                meta[k] = v;
        Object.assign(meta, { key, system, fetched_at: Date.now() / 1000, copied_from: srcKey, edited_at: Date.now() / 1000 });
        (meta.source = meta.source || []).push('copy');
        MetadataService.applyUser(meta, keep.user);
        this.write(key, meta);
        return meta;
    }

    async probe(source: string, title: string, system = 'pc', year = ''): Promise<any> {
        system = system || 'pc';
        const clean = normalizeTitle(title);
        const q = cleanTitle(clean) || clean;
        const meta: any = { source: [], system, query: q };
        if (source === 'wikipedia') {
            await this.wikipedia(meta, q, year, system);
            if (meta.wiki_title && String(this.store.config.language || 'pt-BR').toLowerCase().includes('pt')) {
                try {
                    await this.wikiPtSummary(meta);
                }
                catch { /* nada */ }
            }
            if (meta.wiki_image) {
                meta.cover_url = meta.wiki_image;
                meta.cover_src = 'wikipedia';
            }
        }
        else if (source === 'steam' && this.covers) {
            await this.covers.steam(meta, q, year, 0.6);
        }
        else if (source === 'gog' && this.covers) {
            await this.covers.gog(meta, q, year, 0.6);
        }
        else if (source === 'libretro' && this.covers) {
            await this.covers.libretro(meta, q, system !== 'pc' ? system : 'xbox', 0.7);
        }
        else if (source === 'wikidata') {
            const list = await this.wikidataCandidates(q, system);
            if (list.length && list[0].score >= 0.6)
                await this.wikidataById(meta, list[0].id);
        }
        else if (source === 'web' && this.web) {
            const hit = await this.web.bestCover(q, system);
            if (hit) {
                meta.cover_url = hit.url;
                meta.cover_src = 'web';
                meta.web_page = hit.page || '';
                meta.source.push('web');
            }
        }
        else {
            return { error: 'Fonte desconhecida' };
        }
        if (!meta.source || !meta.source.length)
            return { error: 'Nada encontrado nessa fonte com esse nome' };
        MetadataService.pickCanonical(meta, clean, system);
        const out: any = {};
        for (const [k, v] of Object.entries(meta))
            if (!(v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)))
                out[k] = v;
        return out;
    }

    srcOn(id: string): boolean {
        const m = this.store.config.meta_sources || {};
        return m[id] !== false;
    }

    private wdLang(): string {
        return String(this.store.config.language || 'pt-BR').toLowerCase().includes('pt') ? 'pt-br' : 'en';
    }

    async wikidataCandidates(q: string, system = 'pc'): Promise<any[]> {
        const seen = new Set<string>();
        const out: any[] = [];
        const qc = cmp(q);
        const langs = this.wdLang() === 'en' ? ['en'] : ['en', this.wdLang()];
        const res = await Promise.all(langs.map((lang) => this.wget(WIKIDATA_API, { params: { action: 'wbsearchentities', search: q, language: lang, uselang: this.wdLang(), type: 'item', limit: 20, format: 'json' } }).then((r) => r.ok ? r.json() : null).catch(() => null)));
        if (res.every((r) => !r))
            throw new Error('Wikidata não respondeu');
        for (const d of res) {
            for (const h of ((d || {}).search || []) as any[]) {
                if (seen.has(h.id))
                    continue;
                const desc = String(h.description || '');
                const dl = desc.toLowerCase();
                const isGame = /video ?game|videogame|jogo eletr|jogo de v|jogo de computador|\bgame\b/.test(dl);
                const bad = /soundtrack|series|franchise|film|character|trilha sonora|s\u00e9rie|franquia|personagem|episode|album|expansion|dlc|mod\b|remake of/.test(dl);
                if (!isGame || bad)
                    continue;
                seen.add(h.id);
                const y = /(19|20)\d{2}/.exec(desc);
                let score = similarity(qc, cmp(h.label || ''));
                for (const a of (h.aliases || []))
                    score = Math.max(score, similarity(qc, cmp(a)) - 0.02);
                out.push({ id: h.id, title: String(h.label || ''), year: y ? y[0] : '', sub: desc, thumb: '', score });
            }
        }
        return out;
    }

    async wikidataById(meta: any, qid: string) {
        const lang = this.wdLang();
        const r = await this.wget(WIKIDATA_API, { params: { action: 'wbgetentities', ids: qid, props: 'labels|descriptions|claims|sitelinks', languages: `${lang}|pt|en`, format: 'json' } });
        if (!r.ok)
            throw new Error(`HTTP ${r.status}`);
        const ent = ((((await r.json()) || {}).entities) || {})[qid];
        if (!ent)
            throw new Error('Item não encontrado');
        const lab = (o: any) => o && (o[lang] || o.pt || o.en) ? (o[lang] || o.pt || o.en).value : '';
        const claims = ent.claims || {};
        const ids = (prop: string): string[] => ((claims[prop] || []) as any[]).map((c) => c?.mainsnak?.datavalue?.value?.id).filter(Boolean);
        const strs = (prop: string): string[] => ((claims[prop] || []) as any[]).map((c) => c?.mainsnak?.datavalue?.value).filter((v) => typeof v === 'string');
        const need = [...new Set([...ids('P178'), ...ids('P123'), ...ids('P136'), ...ids('P400'), ...ids('P179'), ...ids('P404')])].slice(0, 40);
        const names: Record<string, string> = {};
        if (need.length) {
            const r2 = await this.wget(WIKIDATA_API, { params: { action: 'wbgetentities', ids: need.join('|'), props: 'labels', languages: `${lang}|pt|en`, format: 'json' } });
            if (r2.ok) {
                const es = (((await r2.json()) || {}).entities) || {};
                for (const [k, v] of Object.entries<any>(es))
                    names[k] = lab(v.labels);
            }
        }
        const nm = (prop: string, n: number) => ids(prop).map((i) => names[i]).filter(Boolean).slice(0, n);
        const MODE: Array<[RegExp, string]> = [[/single|um jogador|solo/i, 'Single-player'], [/co-?op|cooperativ/i, 'Co-op'], [/multi/i, 'Multiplayer']];
        meta.wikidata_id = qid;
        meta.wikidata_title = lab(ent.labels);
        const dev = nm('P178', 2), pub = nm('P123', 2), gen = nm('P136', 4), plat = nm('P400', 8), ser = nm('P179', 1), modes = nm('P404', 3);
        if (dev.length)
            meta.developer = dev.join(', ');
        if (pub.length)
            meta.publisher = pub.join(', ');
        if (gen.length)
            meta.genres = gen.map((g) => g.replace(/\s*(video game|jogo eletr[oô]nico de|jogo de)\s*/gi, ' ').replace(/\s+/g, ' ').trim()).map((g) => g.charAt(0).toUpperCase() + g.slice(1));
        if (plat.length)
            meta.platforms = plat;
        if (ser.length)
            meta.series = ser[0];
        if (modes.length)
            meta.modes = [...new Set(modes.map((m) => (MODE.find(([re]) => re.test(m)) || [null, m])[1]))].join(', ');
        const dates = ((claims.P577 || []) as any[]).map((c) => String(c?.mainsnak?.datavalue?.value?.time || '')).filter(Boolean).sort();
        if (dates.length) {
            const m = /(\d{4})/.exec(dates[0]);
            if (m)
                meta.year = m[1];
        }
        const img = strs('P18')[0];
        if (img) {
            meta.cover_url = 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(img.replace(/ /g, '_')) + '?width=900';
            meta.cover_src = 'wikidata';
        }
        const steam = strs('P1733')[0];
        if (steam && this.covers) {
            meta.steam_appid = steam;
            try {
                const tmp: any = {};
                await this.covers.steamByAppid(tmp, steam, false);
                if (tmp.cover_url) {
                    meta.cover_url = tmp.cover_url;
                    meta.cover_src = 'steam';
                }
                if (tmp.hero_url)
                    meta.hero_url = tmp.hero_url;
            }
            catch { /* nada */ }
        }
        const gog = strs('P2725')[0];
        if (gog)
            meta.gog_id = gog;
        const sl = (ent.sitelinks || {});
        const wk = sl[`${lang === 'pt-br' ? 'pt' : lang}wiki`] || sl.enwiki;
        if (wk && wk.title)
            meta.wiki_url = `https://${wk.site.replace('wiki', '')}.wikipedia.org/wiki/${encodeURIComponent(String(wk.title).replace(/ /g, '_'))}`;
        (meta.source = meta.source || []).push('wikidata');
    }

    candCache = new Map<string, any>();
    async candidates(source: string, title: string, system = 'pc'): Promise<any> {
        system = system || 'pc';
        const clean = normalizeTitle(title);
        const q = cleanTitle(clean) || clean;
        if (!q)
            return { error: 'Digite um nome' };
        let list: any[] = [];
        if (source === 'steam' && this.covers)
            list = await this.covers.steamCandidates(q);
        else if (source === 'gog' && this.covers)
            list = await this.covers.gogCandidates(q);
        else if (source === 'libretro' && this.covers)
            list = await this.covers.libretroCandidates(q, system !== 'pc' ? system : 'xbox');
        else if (source === 'wikidata')
            list = await this.wikidataCandidates(q, system);
        else if (source === 'wikipedia') {
            const hits = await this.wikiSearch(system !== 'pc' ? `${q} ${SYS_WIKI[system] || ''} video game`.replace(/\s+/g, ' ') : `${q} video game`, 14);
            const base = (t: string) => t.replace(/\s*\((\d{4} )?(video game|game|series)\)$/i, '');
            const qc = cmp(q);
            list = hits.map((h) => {
                if (this.candCache.size > 400)
                    this.candCache.clear();
                this.candCache.set('wiki:' + h.title, h);
                const tmp: any = {};
                let box: any = {};
                try {
                    box = this.wikiPage(tmp, h, base(h.title)) || {};
                }
                catch { /* nada */ }
                const sub = [tmp.year || '', (box.platforms || []).slice(0, 4).join(', '), tmp.developer || ''].filter(Boolean).join(' · ');
                return { id: h.title, title: base(h.title), year: tmp.year || '', sub: sub || String(h.snippet || '').replace(/<[^>]+>/g, '').slice(0, 90), thumb: (h.original || {}).source || '', score: similarity(qc, cmp(base(h.title))) };
            });
        }
        else
            return { error: 'Essa fonte não tem lista para escolher' };
        list.sort((a, b) => (b.score || 0) - (a.score || 0));
        if (!list.length)
            return { error: 'Nada encontrado nessa fonte com esse nome' };
        return { items: list.slice(0, 30) };
    }

    async probeById(source: string, id: string, title: string, system = 'pc'): Promise<any> {
        system = system || 'pc';
        const clean = normalizeTitle(title);
        const q = cleanTitle(clean) || clean;
        const meta: any = { source: [], system, query: q };
        if (source === 'steam' && this.covers)
            await this.covers.steamById(meta, id, true);
        else if (source === 'gog' && this.covers)
            this.covers.gogById(meta, id);
        else if (source === 'libretro' && this.covers)
            this.covers.libretroById(meta, id, system);
        else if (source === 'wikidata')
            await this.wikidataById(meta, id);
        else if (source === 'wikipedia') {
            const h = this.candCache.get('wiki:' + id);
            if (!h)
                return { error: 'Escolha expirou — procure de novo' };
            const base = (t: string) => t.replace(/\s*\((\d{4} )?(video game|game|series)\)$/i, '');
            this.wikiPage(meta, h, base(h.title));
            meta.source.push('wikipedia');
            if (String(this.store.config.language || 'pt-BR').toLowerCase().includes('pt')) {
                try {
                    await this.wikiPtSummary(meta);
                }
                catch { /* nada */ }
            }
            if (meta.wiki_image) {
                meta.cover_url = meta.wiki_image;
                meta.cover_src = 'wikipedia';
            }
        }
        else
            return { error: 'Fonte desconhecida' };
        if (!meta.source || !meta.source.length)
            return { error: 'Nada encontrado' };
        MetadataService.pickCanonical(meta, clean, system);
        const out: any = {};
        for (const [k, v] of Object.entries(meta))
            if (!(v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)))
                out[k] = v;
        return out;
    }

    static pickCanonical(meta: any, clean: string, system: string) {
        const cands: Array<[number, number, string]> = [];
        const order: Record<string, number> = { wiki_title: 0, wikidata_title: 1, steam_name: 2, gog_name: 3, libretro_name: 4 };
        if (system === 'pc')
            delete order.libretro_name;
        for (const [field, pri] of Object.entries(order)) {
            let v = String(meta[field] || '');
            if (field === 'libretro_name') {
                v = v.replace(/\s*[\(\[].*?[\)\]]/g, '').trim();
                v = v.replace(/^(.+?), (The|A|An)$/, '$2 $1');
                v = v.replace(/^(.+?), (The|A|An) - /, '$2 $1 - ');
            }
            if (!v || !canonicalOk(clean, v))
                continue;
            cands.push([Math.round(similarity(clean, v) * 100) / 100, -pri, v]);
        }
        if (!cands.length)
            return;
        cands.sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]) || (b[2] < a[2] ? -1 : b[2] > a[2] ? 1 : 0));
        const best = cands[0][2].trim();
        meta.canonical_title = best;
        meta.canonical_confident = canonicalConfident(clean, best);
        meta.title_candidates = cands.map((c) => c[2]).slice(0, 5);
    }

    private async wget(url: string, opts: any = {}): Promise<any> {
        let r: any = null;
        for (const attempt of [0, 1]) {
            const run = this.wikiChain.then(async () => {
                const wait = MetadataService.WIKI_MIN_GAP - (Date.now() / 1000 - this.wikiLast);
                if (wait > 0)
                    await sleep(wait * 1000);
                this.wikiLast = Date.now() / 1000;
            });
            this.wikiChain = run.catch(() => undefined);
            await run;
            r = await this.s.get(url, { timeout: 20_000, ...opts, headers: { 'User-Agent': PCGW_HEADERS['User-Agent'], ...(opts.headers || {}) } });
            if (r.status === 429 && attempt === 0) {
                await sleep(Number(r.headers.get('Retry-After') || 3) * 1000);
                continue;
            }
            return r;
        }
        return r;
    }

    private async wikidataIds(meta: any) {
        const qid = meta.wikidata;
        const r = await this.s.get(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, { headers: { 'User-Agent': PCGW_HEADERS['User-Agent'] }, timeout: 12_000 });
        if (!r.ok)
            throw new Error(`HTTP ${r.status}`);
        const claims = ((((await r.json()).entities || {})[qid] || {}).claims) || {};
        const first = (prop: string) => {
            for (const c of claims[prop] || []) {
                const v = ((c.mainsnak || {}).datavalue || {}).value;
                if (typeof v === 'string' && v.trim())
                    return v.trim();
            }
            return '';
        };
        const aid = first('P1733');
        if (aid && /^\d+$/.test(aid))
            meta.steam_appid = aid;
        const gog = first('P2725');
        if (gog && !meta.gog_id)
            meta.gog_id = gog;
        const pcgw = first('P6337');
        if (pcgw)
            meta.pcgw_page = pcgw.replace(/_/g, ' ');
    }

    private async steamArchive(meta: any, aid: string) {
        const r = await this.s.get('https://archive.org/wayback/available', { params: { url: `store.steampowered.com/app/${aid}` }, timeout: 15_000 });
        if (!r.ok)
            throw new Error(`HTTP ${r.status}`);
        const snap = (((await r.json()).archived_snapshots || {}).closest) || {};
        let url: string = snap.url;
        if (!url || String(snap.status ?? '200') !== '200')
            return;
        url = url.replace(/\/web\/(\d+)\//, '/web/$1id_/');
        const h = await this.s.getText(url, { timeout: 40_000 });
        if (!meta.shots) {
            const ids: string[] = [];
            for (const m of h.matchAll(new RegExp('/steam/apps/' + aid + '/(ss_[0-9a-f]+)\\.', 'g')))
                if (!ids.includes(m[1]))
                    ids.push(m[1]);
            if (ids.length) {
                meta.shots = ids.slice(0, 3).map((i) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${aid}/${i}.600x338.jpg`);
                meta.shots_src = 'steam';
            }
        }
        if (!meta.reqs && this.covers) {
            let i = h.indexOf('data-os="win"');
            if (i < 0)
                i = h.indexOf('game_area_sys_req');
            if (i < 0)
                return;
            const blk = h.slice(i, i + 12000);
            const cols: Record<string, string> = {};
            for (const col of ['leftCol', 'rightCol', 'full']) {
                const m = new RegExp('game_area_sys_req_' + col + '">([\\s\\S]*?)</div>').exec(blk);
                if (m)
                    cols[col] = m[1];
            }
            const mn = cols.leftCol || cols.full || '';
            const rc = cols.rightCol || '';
            const reqs = { min: this.reqPt(CoverService.reqLines(mn)), rec: this.reqPt(CoverService.reqLines(rc)) };
            if (reqs.min.length || reqs.rec.length) {
                meta.reqs = reqs;
                meta.reqs_src = 'steam';
                (meta.source = meta.source || []).push('steam');
            }
        }
    }

    private reqPt(lines: string[]): string[] {
        if (!String(this.store.config.language || 'pt-BR').toLowerCase().includes('pt'))
            return lines;
        return lines.map((ln) => {
            const i = ln.indexOf(':');
            if (i > 0 && i < 30 && REQ_PT[ln.slice(0, i).trim()])
                return REQ_PT[ln.slice(0, i).trim()] + ln.slice(i);
            return ln;
        });
    }

    private async pcgw(meta: any, q: string, year = '') {
        let best = meta.pcgw_page || '';
        if (!best) {
            await pcgwSlot();
            const r = await this.s.get(PCGW_API, { params: { action: 'opensearch', search: q, limit: 6, format: 'json' }, headers: PCGW_HEADERS, timeout: 12_000 });
            if (!r.ok)
                throw new Error(`HTTP ${r.status}`);
            const titles: string[] = ((await r.json()) || [null, []])[1] || [];
            const qc = cmp(q);
            let bestS = 0;
            for (const t of titles) {
                let sc = similarity(qc, cmp(t));
                if (year && t.includes(year))
                    sc += 0.05;
                if (sc > bestS) {
                    best = t;
                    bestS = sc;
                }
            }
            if (!best || bestS < 0.82)
                return;
        }
        await this.pcgwPage(meta, best);
    }

    private async pcgwPage(meta: any, best: string) {
        await pcgwSlot();
        const r = await this.s.get(PCGW_API, { params: { action: 'parse', page: best, prop: 'wikitext', format: 'json', redirects: 1 }, headers: PCGW_HEADERS, timeout: 15_000 });
        if (!r.ok)
            throw new Error(`HTTP ${r.status}`);
        const wt: string = ((((await r.json()) || {}).parse || {}).wikitext || {})['*'] || '';
        if (!wt)
            return;
        meta.pcgw_page = best;
        let m = /\|steam appid\s*=\s*(\d+)/.exec(wt);
        if (m && !meta.steam_appid)
            meta.steam_appid = m[1];
        if (meta.reqs)
            return;
        m = /\{\{System requirements([\s\S]*?)\n\}\}/.exec(wt);
        if (!m)
            return;
        const fields: Record<string, string> = {};
        for (const mm of m[1].matchAll(/\|\s*(\w+)\s*=\s*([^\n|]*)/g)) {
            const v = mm[2].replace(/\{\{[^}]*\}\}|\[\[|\]\]|<[^>]+>/g, '').trim();
            if (v)
                fields[mm[1]] = v;
        }
        const reqs: any = {};
        for (const pre of ['min', 'rec']) {
            const lines: string[] = [];
            for (const [fk, label] of Object.entries(PCGW_LABELS)) {
                const vals = ['', '2', '3', '4'].map((n) => fields[`${pre}${fk}${n}`]).filter(Boolean);
                if (vals.length) {
                    let val = vals.join(' / ');
                    if (fk === 'OS' && !/^(windows|mac|linux)/i.test(val))
                        val = 'Windows ' + val;
                    lines.push(`${label}: ${val.slice(0, 200)}`);
                }
            }
            reqs[pre] = lines.slice(0, 12);
        }
        if ((reqs.min || []).length || (reqs.rec || []).length) {
            meta.reqs = reqs;
            meta.reqs_src = 'pcgamingwiki';
            (meta.source = meta.source || []).push('pcgamingwiki');
        }
    }

    private async wikiSearch(terms: string, limit = 6): Promise<any[]> {
        const r = await this.wget(WIKI_API, { params: { ...MetadataService.WIKI_PROPS, gsrlimit: limit, gsrsearch: terms } });
        if (!r.ok)
            throw new Error(`HTTP ${r.status}`);
        const pages: any[] = (((await r.json()).query || {}).pages) || [];
        return pages.sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
    }

    async wikipedia(meta: any, q: string, year: string, system = 'pc') {
        const plat = SYS_WIKI[system] || '';
        let hits = await this.wikiSearch(system !== 'pc' ? `${q} ${plat} video game` : `${q} video game`);
        if (!hits.length && system !== 'pc')
            hits = await this.wikiSearch(`${q} video game`);
        if (!hits.length)
            return;
        const qc = cmp(q);
        const [lo, hi] = SYS_YEARS[system] || [0, 9999];
        const base = (t: string) => t.replace(/\s*\((\d{4} )?(video game|game|series)\)$/i, '');
        const score = (h: any): number => {
            const t: string = h.title;
            const bc = cmp(base(t));
            let s = similarity(qc, bc) * 10;
            if (bc === qc)
                s += 10;
            else if (bc && (qc.includes(bc) || bc.includes(qc)))
                s += 10 * Math.min(bc.length, qc.length) / Math.max(bc.length, qc.length);
            const tl = t.toLowerCase();
            if (tl.includes('series') || tl.includes('list of') || tl.includes('franchise') || tl.includes('(film)') || tl.includes('soundtrack') || tl.includes('collections'))
                s -= 20;
            if (/\b(is|was) an? (\w+ ){0,3}(series|franchise|media franchise|film|novel|character)\b/i.test(String(h.extract || '').slice(0, 240)))
                s -= 15;
            const m = /\((\d{4}) video game\)/.exec(tl);
            if (m) {
                const y = Number(m[1]);
                if (!(lo <= y && y <= hi))
                    s -= 8;
                if (year && String(y) === year)
                    s += 3;
            }
            if (year && String(h.snippet || '').includes(year))
                s += 1;
            if (plat && String(h.snippet || '').toLowerCase().includes(plat.toLowerCase()))
                s += 1.5;
            return -s;
        };
        const ranked = hits.map((h, i) => ({ h, i, s: score(h) })).sort((a, b) => (a.s - b.s) || (a.i - b.i)).map((x) => x.h);
        let unknown: any = null;
        for (const best of ranked.slice(0, 4)) {
            const page: string = best.title;
            if (!canonicalOk(q, base(page), 0.5))
                continue;
            const tmp: any = {};
            const box = this.wikiPage(tmp, best, base(page));
            const ok = platformMatches(system, box.platforms || []);
            if (ok === false) {
                (meta.wiki_rejected = meta.wiki_rejected || []).push(page);
                continue;
            }
            if (ok === null) {
                if (unknown === null)
                    unknown = tmp;
                continue;
            }
            Object.assign(meta, tmp);
            meta.source.push('wikipedia');
            return;
        }
        if (unknown !== null) {
            Object.assign(meta, unknown);
            meta.source.push('wikipedia');
        }
    }

    private async wikiPtSummary(meta: any) {
        const title = meta.wiki_title;
        if (!title)
            return;
        let ptTitle = '';
        try {
            const r = await this.wget(WIKI_API, { params: { action: 'query', titles: title, prop: 'langlinks', lllang: 'pt', format: 'json', formatversion: 2 } });
            const pages: any[] = (((await r.json()).query || {}).pages) || [];
            const ll = pages.length ? (pages[0].langlinks || []) : [];
            ptTitle = ll.length ? (ll[0].title || '') : '';
        }
        catch { /* nada */ }
        const params: any = { action: 'query', prop: 'extracts', exintro: 1, explaintext: 1, format: 'json', formatversion: 2 };
        if (ptTitle)
            params.titles = ptTitle;
        else
            Object.assign(params, { generator: 'search', gsrlimit: 1, gsrsearch: `${title} jogo eletrônico` });
        const r = await this.wget(WIKI_API_PT, { params });
        const pages: any[] = (((await r.json()).query || {}).pages) || [];
        if (!pages.length)
            return;
        const ext = String(pages[0].extract || '').trim();
        if (!ptTitle && !canonicalOk(title, pages[0].title || '', 0.6))
            return;
        if (ext.length > 80) {
            meta.summary_en = meta.summary || '';
            meta.summary = ext;
            meta.summary_lang = 'pt';
        }
    }

    private wikiPage(meta: any, page: any, title: string): any {
        for (const k of ['summary', 'wiki_url', 'wiki_image', 'genres', 'developer', 'publisher', 'modes', 'platforms', 'series', 'year'])
            delete meta[k];
        meta.wiki_title = title;
        meta.wikidata = (page.pageprops || {}).wikibase_item || '';
        meta.summary = String(page.extract || '').trim();
        meta.wiki_url = page.fullurl || page.canonicalurl || '';
        const img = (page.original || {}).source;
        if (img)
            meta.wiki_image = String(img).split('?')[0];
        let box: any = {};
        try {
            const txt = page.revisions[0].slots.main.content;
            box = infobox(txt);
            meta.genres = translateGenres(box.genre || []);
            meta.developer = (box.developer || []).slice(0, 2).join(', ');
            meta.publisher = (box.publisher || []).slice(0, 2).join(', ');
            meta.modes = (box.modes || []).slice(0, 3).join(', ');
            meta.platforms = (box.platforms || []).slice(0, 12);
            meta.series = (box.series || []).slice(0, 1).join(', ');
            if (box.year)
                meta.year = box.year;
        }
        catch { /* sem infobox */ }
        return box;
    }
}
