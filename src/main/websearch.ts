import * as http from './http';
import * as log from './log';

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
export const HEADERS: Record<string, string> = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9,pt-BR;q=0.8' };
const TIMEOUT = 9_000;
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'de', 'do', 'da', 'o', 'e', 'edition', 'remastered', 'definitive', 'goty', 'hd']);

const SYS_WORD: Record<string, string> = {
    ps1: 'ps1', ps2: 'ps2', ps3: 'ps3', psp: 'psp', ps4: 'ps4', n64: 'n64', gc: 'gamecube', wii: 'wii', wiiu: 'wii u', gba: 'gba', snes: 'snes',
    nes: 'nes', nds: 'nintendo ds', '3ds': '3ds', genesis: 'mega drive', sms: 'master system', dc: 'dreamcast', saturn: 'saturn', xbox: 'xbox',
    x360: 'xbox 360', switch: 'switch', arcade: 'arcade', dos: 'dos', pce: 'pc engine',
};

const MARKETPLACES = ['ebay.', 'mercadolivre.', 'mercadolibre.', 'amazon.', 'aliexpress.', 'shopee.', 'olx.', 'enjoei.', 'etsy.',
    'americanas.', 'magazineluiza.', 'magalu.', 'casasbahia.', 'submarino.', 'kabum.', 'walmart.', 'bestbuy.', 'gamestop.',
    'pricecharting.', 'rakuten.', 'wish.', 'leboncoin.', 'wallapop.', 'vinted.', 'tradera.', 'allegro.', 'cdiscount.', 'fnac.',
    'carousell.', 'facebook.com/marketplace', 'pichau.', 'terabyteshop.', 'extra.com', 'pontofrio.', 'shoptime.', 'zoom.com.br',
    'buscape.', 'shopping.google', 'lojasamericanas.', 'ebay-kleinanzeigen.', 'kleinanzeigen.', 'gumtree.', 'craigslist.'];
const PHYSICAL_RX = /\b(usado|usada|seminovo|seminova|lacrado|lacrada|m[ií]dia f[ií]sica|f[ií]sico|f[ií]sica|physical|sealed|used|pre-?owned|loose|cib|complete in box|manual|caixa|case only|disc only|s[oó] o disco|cartucho|cartridge|unboxing|photo|foto|frete|r\$|us\$|\$\s?\d|\d+\s?reais|comprar|compre|venda|vendo|à venda|for sale|buy|pre[çc]o|price|oferta|promo[çc][aã]o|desconto|parcel)\b/i;

export interface Hit {
    url: string;
    thumb: string;
    w: number;
    h: number;
    title: string;
    page: string;
    engine: string;
    rel?: number;
}

function isProductPhoto(h: Hit): boolean {
    const page = (h.page || '').toLowerCase();
    const url = (h.url || '').toLowerCase();
    if (MARKETPLACES.some((m) => page.includes(m) || url.includes(m)))
        return true;
    return PHYSICAL_RX.test(h.title || '');
}

function tokens(t: string): string[] {
    let s = String(t || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x00-\x7f]/g, '').toLowerCase();
    s = s.replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9 ]+/g, ' ');
    return s.split(/\s+/).filter((w) => w && !STOP.has(w) && w.length > 1);
}

function stripBrackets(t: string): string {
    return String(t || '').replace(/\(.*?\)|\[.*?\]/g, '').trim();
}

export class WebImageSearch {
    constructor(public s: http.Session = http.shared) { }

    async search(title: string, system = 'pc', limit = 24, strict = false): Promise<Hit[]> {
        const q = stripBrackets(title);
        if (!q)
            return [];
        const sysw = SYS_WORD[system || 'pc'] || '';
        const query = sysw ? `${q} ${sysw} cover` : `${q} game cover`;
        const toks = tokens(q);
        const out: Hit[] = [];
        const seen = new Set<string>();
        for (const engine of [this.bing, this.duckduckgo, this.yandex]) {
            let hits: Hit[] = [];
            try {
                hits = await engine.call(this, query);
            }
            catch (e: any) {
                log.debug('websearch %s: %s', engine.name, e?.message || e);
            }
            for (const h of hits) {
                const u = h.url || '';
                if (!u.startsWith('http') || seen.has(u))
                    continue;
                if (isProductPhoto(h))
                    continue;
                if (!WebImageSearch.relevant(h, toks, strict))
                    continue;
                seen.add(u);
                out.push(h);
            }
            if (out.length >= 8)
                break;
        }
        out.sort((a, b) => WebImageSearch.score(b) - WebImageSearch.score(a));
        return out.slice(0, limit);
    }

    async searchWide(title: string, system = 'pc', limit = 24): Promise<Hit[]> {
        const q = stripBrackets(title);
        if (!q)
            return [];
        const sysw = SYS_WORD[system || 'pc'] || '';
        const toks = tokens(q);
        const out: Hit[] = [];
        const seen = new Set<string>();
        for (const query of [`${q} ${sysw} wallpaper`.trim(), `${q} ${sysw} screenshot`.trim()]) {
            for (const engine of [this.bing, this.duckduckgo, this.yandex]) {
                let hits: Hit[] = [];
                try {
                    hits = await engine.call(this, query);
                }
                catch (e: any) {
                    log.debug('websearch %s: %s', engine.name, e?.message || e);
                }
                for (const h of hits) {
                    const u = h.url || '';
                    const w = h.w || 0, hh = h.h || 0;
                    if (!u.startsWith('http') || seen.has(u) || !w || !hh)
                        continue;
                    if (!(1.3 <= w / hh && w / hh <= 2.6) || w < 800)
                        continue;
                    if (isProductPhoto(h) || !WebImageSearch.relevant(h, toks, false))
                        continue;
                    seen.add(u);
                    out.push(h);
                }
                if (out.length >= limit)
                    break;
            }
            if (out.length >= 8)
                break;
        }
        out.sort((a, b) => (b.w || 0) * (b.h || 0) - (a.w || 0) * (a.h || 0));
        return out.slice(0, limit);
    }

    async bestCover(title: string, system = 'pc'): Promise<Hit | null> {
        for (const h of await this.search(title, system, 12, true)) {
            const w = h.w || 0, hh = h.h || 0;
            if (w && hh && 1.15 <= hh / w && hh / w <= 1.75 && hh >= 300)
                return h;
        }
        return null;
    }

    async screenshots(title: string, system = 'pc', limit = 3): Promise<string[]> {
        const q = stripBrackets(title);
        if (!q)
            return [];
        const sysw = SYS_WORD[system || 'pc'] || '';
        const query = sysw ? `${q} ${sysw} gameplay screenshot` : `${q} pc gameplay screenshot`;
        const toks = tokens(q);
        const out: string[] = [];
        const hosts = new Set<string>();
        for (const engine of [this.bing, this.duckduckgo, this.yandex]) {
            let hits: Hit[] = [];
            try {
                hits = await engine.call(this, query);
            }
            catch (e: any) {
                log.debug('websearch %s: %s', engine.name, e?.message || e);
            }
            for (const h of hits) {
                const u = h.url || '';
                const w = h.w || 0, hh = h.h || 0;
                if (!u.startsWith('http') || out.includes(u) || !w || !hh)
                    continue;
                if (!(1.3 <= w / hh && w / hh <= 2.4) || w < 600)
                    continue;
                if (!WebImageSearch.relevant(h, toks, true))
                    continue;
                const t = (h.title || '').toLowerCase();
                if (/wallpaper|fan ?art|meme|t-shirt|poster|logo|cover|box ?art|trailer|thumbnail/.test(t))
                    continue;
                const host = u.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
                if (hosts.has(host))
                    continue;
                hosts.add(host);
                out.push(u);
                if (out.length >= limit)
                    return out;
            }
        }
        return out;
    }

    static relevant(h: Hit, toks: string[], strict = false): boolean {
        if (!toks.length)
            return true;
        const words = new Set(tokens(`${h.title || ''} ${h.page || ''} ${h.url || ''}`).map((w) => w.replace(/s$/, '')));
        const hit = toks.filter((t) => words.has(t.replace(/s$/, ''))).length;
        h.rel = hit / toks.length;
        if (strict) {
            const need = toks.length <= 2 ? toks.length : Math.ceil(toks.length * 3 / 5);
            const musts = [toks[0], ...toks.filter((t) => /^\d+$/.test(t) || ['two', 'three', 'ii', 'iii', 'iv'].includes(t))];
            return hit >= need && musts.every((t) => words.has(t.replace(/s$/, '')));
        }
        const need = toks.length <= 2 ? toks.length : Math.max(2, Math.trunc(toks.length * 0.6 + 0.5));
        return hit >= need;
    }

    static score(h: Hit): number {
        const w = h.w || 0, hh = h.h || 0;
        let s = 3.0 * (h.rel || 0);
        if (w && hh) {
            const r = hh / w;
            s += 1.25 <= r && r <= 1.6 ? 3.0 : (1.1 <= r && r <= 1.8 ? 1.5 : -1.0);
            s += Math.min(hh, 1600) / 800;
        }
        const t = (h.title || '').toLowerCase();
        if (/\b(cover|box ?art|boxart|capa|jaquette|caratula|packaging)\b/.test(t))
            s += 1.0;
        if (/wallpaper|fan ?art|screenshot|meme|t-shirt|poster|gif/.test(t))
            s -= 1.5;
        return s;
    }

    async bing(query: string, page = 0): Promise<Hit[]> {
        const r = await this.s.get('https://www.bing.com/images/async', { headers: HEADERS, timeout: TIMEOUT,
            params: { q: query, first: page * 35, count: 35, mmasync: 1, adlt: 'strict' } });
        if (!r.ok)
            return [];
        const text = await r.text();
        const out: Hit[] = [];
        for (const m of text.matchAll(/m="(\{[^"]*\})"/g)) {
            let d: any;
            try {
                d = JSON.parse(http.decodeHtmlEntities(m[1]));
            }
            catch {
                continue;
            }
            if (!d.murl)
                continue;
            out.push({ url: d.murl, thumb: d.turl || d.murl, w: 0, h: 0, title: d.t || '', page: d.purl || '', engine: 'bing' });
        }
        const sizes = [...text.matchAll(/class="nowrap">(\d+)\s*(?:&#215;|×|x)\s*(\d+)</g)];
        for (let i = 0; i < Math.min(out.length, sizes.length); i++) {
            out[i].w = Number(sizes[i][1]);
            out[i].h = Number(sizes[i][2]);
        }
        return out;
    }

    async yandex(query: string, page = 0): Promise<Hit[]> {
        const r = await this.s.get('https://yandex.com/images/search', { headers: HEADERS, timeout: TIMEOUT, params: { text: query, ...(page ? { p: page } : {}) } });
        if (!r.ok)
            return [];
        const t = http.decodeHtmlEntities(await r.text());
        const out: Hit[] = [];
        for (const m of t.matchAll(/"origUrl":"(https?:\/\/[^"]+)"/g)) {
            const start = m.index || 0;
            const seg = t.slice(Math.max(0, start - 1500), start + m[0].length + 900);
            const g = (k: string) => {
                const mm = new RegExp(`"${k}":"?([^",}]*)`).exec(seg);
                return mm ? mm[1] : '';
            };
            const url = m[1].replace(/\\\//g, '/');
            let thumb = g('image');
            if (thumb.startsWith('//'))
                thumb = 'https:' + thumb;
            const w = Number(g('origWidth') || 0) || 0, h = Number(g('origHeight') || 0) || 0;
            out.push({ url, thumb: thumb || url, w, h, title: g('alt'), page: g('domain'), engine: 'yandex' });
        }
        const seen = new Set<string>();
        return out.filter((h) => {
            if (seen.has(h.url))
                return false;
            seen.add(h.url);
            return true;
        });
    }

    private ddgVqd = new Map<string, string>();
    async duckduckgo(query: string, page = 0): Promise<Hit[]> {
        let vqd = this.ddgVqd.get(query) || '';
        if (!vqd) {
            const r0 = await this.s.get('https://duckduckgo.com/', { headers: HEADERS, timeout: TIMEOUT, params: { q: query, iax: 'images', ia: 'images' } });
            if (!r0.ok)
                return [];
            const t0 = await r0.text();
            const m = /vqd=["']?([\d-]+)["']?/.exec(t0) || /vqd=([\d-]+)/.exec(t0);
            vqd = m ? m[1] : '';
            if (!vqd)
                return [];
            if (this.ddgVqd.size > 200)
                this.ddgVqd.clear();
            this.ddgVqd.set(query, vqd);
        }
        const r = await this.s.get('https://duckduckgo.com/i.js', { headers: { ...HEADERS, Referer: 'https://duckduckgo.com/', Accept: 'application/json' }, timeout: TIMEOUT,
            params: { l: 'us-en', o: 'json', q: query, vqd, f: ',,,,,', p: '1', s: page * 100 } });
        if (!r.ok) {
            this.ddgVqd.delete(query);
            return [];
        }
        let data: any;
        try {
            data = await r.json();
        }
        catch {
            return [];
        }
        const out: Hit[] = [];
        for (const it of data?.results || []) {
            if (!it?.image)
                continue;
            out.push({ url: String(it.image), thumb: String(it.thumbnail || it.image), w: Number(it.width || 0) || 0, h: Number(it.height || 0) || 0, title: String(it.title || ''), page: String(it.url || ''), engine: 'duckduckgo' });
        }
        return out;
    }

    async engineSearch(engine: string, query: string, page = 0, kind = 'cover'): Promise<{ hits: Hit[]; more: boolean }> {
        const q = String(query || '').trim();
        if (!q)
            return { hits: [], more: false };
        const engines = engine === 'bing' ? [this.bing] : engine === 'duckduckgo' ? [this.duckduckgo] : engine === 'yandex' ? [this.yandex] : [this.bing, this.duckduckgo, this.yandex];
        const out: Hit[] = [];
        const seen = new Set<string>();
        let got = 0;
        const results = await Promise.all(engines.map(async (fn) => {
            try {
                return await fn.call(this, q, page);
            }
            catch (e: any) {
                log.debug('websearch %s: %s', fn.name, e?.message || e);
                return [] as Hit[];
            }
        }));
        for (const hits of results) {
            got += hits.length;
            for (const h of hits) {
                const u = h.url || '';
                if (!u.startsWith('http') || seen.has(u))
                    continue;
                if (isProductPhoto(h))
                    continue;
                if (kind === 'hero' && h.w && h.h && h.w / h.h < 1.1)
                    continue;
                if (kind === 'cover' && h.w && h.h && h.h / h.w < 0.6)
                    continue;
                seen.add(u);
                out.push(h);
            }
        }
        return { hits: out, more: got >= 20 };
    }
}
