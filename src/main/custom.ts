import fs from 'node:fs';
import path from 'node:path';
import * as cp from 'node:child_process';
import * as P from './paths';

const DIR = path.join(P.DATA, 'custom');
const FX_DIR = path.join(DIR, 'fx');
const HEX = /^#[0-9a-fA-F]{6}$/;
const FAMILY = /^family:[A-Za-z0-9][A-Za-z0-9 \-_.]{0,59}$/;
const COLOR_KEYS = ['bg', 'bg2', 'panel', 'card', 'card2', 'text', 'muted', 'line'];
const FONTS: Record<string, string> = {
    system: '',
    rounded: '"Segoe UI Variable Display","Nunito","Quicksand","Segoe UI",system-ui,sans-serif',
    mono: '"Cascadia Code","JetBrains Mono","Fira Code",Consolas,ui-monospace,monospace',
    serif: '"Georgia","Cambria","Times New Roman",serif',
    condensed: '"Bahnschrift","Roboto Condensed","Arial Narrow","Segoe UI",sans-serif',
    wide: '"Verdana","Trebuchet MS","Segoe UI",sans-serif',
};
export const DEFAULT: any = {
    on: false, colors: {}, alpha: 100, blur: 0, radius: -1, font: 'system',
    wallpaper: '', wallpaper_opacity: 35, wallpaper_blur: 0, wallpaper_dim: 0,
    gradient: { preset: 'off', shape: 'mesh', c1: '#6d28d9', c2: '#0ea5e9', angle: 160, opacity: 55 },
    fx: { mode: 'theme', icons: [], count: 10, speed: 1.0, size: 56, opacity: 45, direction: 'up', pixel: false, spin: true },
    nav: { style: 'auto', shape: 'pill', icon_size: 0, gap: 0 },
    window: { toolbar_style: 'auto' },
    cards: { shape: 'poster', labels: 'below', shadow: true },
    splash: '', icon: '',
};
const GRADIENTS: Record<string, string[]> = {
    aurora: ['#6d28d9', '#0ea5e9', '#10b981'],
    crepusculo: ['#f97316', '#db2777', '#312e81'],
    oceano: ['#0c4a6e', '#0369a1', '#22d3ee'],
    brasa: ['#7f1d1d', '#ea580c', '#facc15'],
    floresta: ['#052e16', '#15803d', '#a3e635'],
    neblina: ['#1e293b', '#64748b', '#cbd5e1'],
    uva: ['#3b0764', '#a21caf', '#f472b6'],
    accent: [],
    custom: [],
};
const GRAD_SHAPES = ['mesh', 'linear', 'radial'];

function f2(n: number) {
    return (n / 100).toFixed(2);
}

function gradientCss(g: any) {
    const preset = g.preset || 'off';
    if (preset === 'off' || !(preset in GRADIENTS))
        return '';
    let cols: string[];
    if (preset === 'accent')
        cols = ['var(--accent)', 'color-mix(in srgb,var(--accent) 45%,var(--bg))', 'color-mix(in srgb,var(--accent) 20%,var(--bg))'];
    else if (preset === 'custom')
        cols = [g.c1, g.c2, `color-mix(in srgb,${g.c1} 50%,${g.c2})`];
    else
        cols = GRADIENTS[preset];
    const [a, b, c] = cols;
    const shape = g.shape || 'mesh';
    let bg: string;
    if (shape === 'linear')
        bg = `linear-gradient(${g.angle}deg,${a} 0%,${b} 55%,${c} 100%)`;
    else if (shape === 'radial')
        bg = `radial-gradient(120% 90% at 85% 0%,${a} 0%,${b} 45%,transparent 80%),radial-gradient(90% 70% at 0% 100%,${c} 0%,transparent 70%)`;
    else
        bg = `radial-gradient(60% 55% at 15% 12%,${a} 0%,transparent 70%),radial-gradient(55% 60% at 85% 25%,${b} 0%,transparent 70%),`
            + `radial-gradient(70% 60% at 50% 100%,${c} 0%,transparent 70%),linear-gradient(${g.angle}deg,${a},${b})`;
    return `body::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background:${bg};opacity:${f2(g.opacity)}}`;
}

function merge(base: any, over: any): any {
    const out = JSON.parse(JSON.stringify(base));
    for (const [k, v] of Object.entries(over || {})) {
        if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]))
            out[k] = merge(out[k], v);
        else
            out[k] = v;
    }
    return out;
}

function clamp(v: any, lo: number, hi: number, dflt: number) {
    const n = Number(v);
    if (v === null || v === undefined || v === '' || Number.isNaN(n))
        return dflt;
    return Math.max(lo, Math.min(hi, n));
}

const STYLE_WORDS = /\s+(Bold|Italic|Light|Semibold|SemiBold|Medium|Black|Thin|Regular|Condensed|Oblique|Heavy|ExtraBold|Extra Bold|Semilight|SemiLight|Narrow|Book|Demi|DemiBold|Ultra|UltraLight|Variable)(\s|$)/i;

function installedFonts(): string[] {
    const names = new Set<string>();
    try {
        if (process.platform === 'win32') {
            for (const hive of ['HKLM', 'HKCU']) {
                let out = '';
                try {
                    out = cp.execFileSync('reg', ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts`], { encoding: 'utf8', timeout: 8000, windowsHide: true });
                }
                catch {
                    continue;
                }
                for (const line of out.split(/\r?\n/)) {
                    const m = /^\s+(.+?)\s+REG_SZ\s+/.exec(line);
                    if (!m)
                        continue;
                    let name = m[1].replace(/\s*\((TrueType|OpenType|All res)\)$/, '').split('&')[0].trim();
                    while (STYLE_WORDS.test(' ' + name))
                        name = (' ' + name).replace(STYLE_WORDS, ' ').trim();
                    if (name && FAMILY.test('family:' + name))
                        names.add(name);
                }
            }
        }
        else {
            const out = cp.execFileSync('fc-list', [':', 'family'], { encoding: 'utf8', timeout: 5000 });
            for (const line of out.split('\n')) {
                const n = line.split(',')[0].trim();
                if (n && FAMILY.test('family:' + n))
                    names.add(n);
            }
        }
    }
    catch { /* sem fontes */ }
    return [...names];
}

function unlink(p: string) {
    try {
        fs.rmSync(p, { force: true });
    }
    catch { /* ignore */ }
}

export class CustomUX {
    private fontsCache: string[] | null = null;
    pickFile: ((initial: string, kind: string) => Promise<string>) | null = null;
    constructor(private store: any) { }

    get(): any {
        const c = merge(DEFAULT, this.store.config.custom || {});
        c.fx.icons = (c.fx.icons || []).filter((n: string) => fs.existsSync(path.join(FX_DIR, n)));
        if (c.wallpaper && !fs.existsSync(path.join(DIR, c.wallpaper)))
            c.wallpaper = '';
        return c;
    }

    set(patch: any): any {
        if (typeof patch === 'string') {
            try {
                patch = JSON.parse(patch);
            }
            catch {
                patch = {};
            }
        }
        if (!patch || typeof patch !== 'object')
            patch = {};
        if (patch.patch && typeof patch.patch === 'object' && Object.keys(patch).length === 1)
            patch = patch.patch;
        const cur = merge(DEFAULT, this.store.config.custom || {});
        const n = merge(cur, patch || {});
        const cols: Record<string, string> = {};
        for (const [k, v] of Object.entries(n.colors || {}))
            if (COLOR_KEYS.includes(k) && (v === '' || HEX.test(String(v))))
                cols[k] = String(v);
        n.colors = Object.fromEntries(Object.entries(cols).filter(([, v]) => v));
        n.alpha = Math.trunc(clamp(n.alpha, 20, 100, 100));
        n.blur = Math.trunc(clamp(n.blur, 0, 30, 0));
        n.radius = Math.trunc(clamp(n.radius, -1, 24, -1));
        n.font = (n.font in FONTS || FAMILY.test(String(n.font || ''))) ? n.font : 'system';
        const gr = n.gradient && typeof n.gradient === 'object' ? n.gradient : {};
        const gd = DEFAULT.gradient;
        n.gradient = {
            preset: (gr.preset in GRADIENTS || gr.preset === 'off') ? gr.preset : 'off',
            shape: GRAD_SHAPES.includes(gr.shape) ? gr.shape : 'mesh',
            c1: HEX.test(String(gr.c1 || '')) ? gr.c1 : gd.c1,
            c2: HEX.test(String(gr.c2 || '')) ? gr.c2 : gd.c2,
            angle: Math.trunc(clamp(gr.angle, 0, 360, gd.angle)),
            opacity: Math.trunc(clamp(gr.opacity, 5, 100, gd.opacity)),
        };
        for (const k of ['splash', 'icon']) {
            const v = String(n[k] || '');
            n[k] = /^[a-z]+-\d{1,6}\.png$/.test(v) ? v : '';
        }
        n.wallpaper_opacity = Math.trunc(clamp(n.wallpaper_opacity, 0, 100, 35));
        n.wallpaper_blur = Math.trunc(clamp(n.wallpaper_blur, 0, 40, 0));
        n.wallpaper_dim = Math.trunc(clamp(n.wallpaper_dim, 0, 90, 0));
        const fx = n.fx;
        fx.mode = ['theme', 'icons', 'off'].includes(fx.mode) ? fx.mode : 'theme';
        fx.count = Math.trunc(clamp(fx.count, 0, 24, 10));
        fx.speed = Math.round(clamp(fx.speed, 0.3, 3, 1.0) * 100) / 100;
        fx.size = Math.trunc(clamp(fx.size, 16, 160, 56));
        fx.opacity = Math.trunc(clamp(fx.opacity, 5, 100, 45));
        fx.direction = ['up', 'down', 'left', 'right', 'drift'].includes(fx.direction) ? fx.direction : 'up';
        fx.icons = (fx.icons || []).filter((x: any) => typeof x === 'string' && !x.includes('/') && !x.includes('\\'));
        const nav = n.nav;
        nav.style = ['auto', 'both', 'icons', 'text'].includes(nav.style) ? nav.style : 'auto';
        nav.shape = ['pill', 'round', 'flat', 'square'].includes(nav.shape) ? nav.shape : 'pill';
        nav.icon_size = Math.trunc(clamp(nav.icon_size, 0, 34, 0));
        nav.gap = Math.trunc(clamp(nav.gap, 0, 16, 0));
        const win = n.window;
        delete win.titlebar;
        win.toolbar_style = ['auto', 'flat', 'outlined', 'filled'].includes(win.toolbar_style) ? win.toolbar_style : 'auto';
        const cards = n.cards;
        cards.shape = ['poster', 'square', 'wide', 'tall'].includes(cards.shape) ? cards.shape : 'poster';
        cards.labels = ['below', 'overlay', 'hover', 'none'].includes(cards.labels) ? cards.labels : 'below';
        cards.shadow = cards.shadow === undefined ? true : Boolean(cards.shadow);
        this.store.setConfig({ custom: n });
        return this.get();
    }

    reset() {
        this.store.setConfig({ custom: {} });
        return this.get();
    }

    file(rel: string): string | null {
        const p = path.resolve(DIR, rel);
        const base = path.resolve(DIR) + path.sep;
        if (!p.startsWith(base))
            return null;
        try {
            return fs.statSync(p).isFile() ? p : null;
        }
        catch {
            return null;
        }
    }

    async pick(what: string) {
        if (!this.pickFile)
            return { error: 'Diálogo nativo indisponível' };
        const src = await this.pickFile('', 'image');
        if (!src)
            return { cancel: true };
        return this.addFile(what, src);
    }

    splashPath(): string | null {
        const n = this.get().splash || '';
        if (n && !n.includes('/') && this.file(n))
            return path.join(DIR, n);
        return null;
    }

    iconPaths(): [string | null, string | null] {
        const n = this.get().icon || '';
        if (n && !n.includes('/') && this.file(n)) {
            const ico = path.join(DIR, 'icon.ico');
            return [path.join(DIR, n), fs.existsSync(ico) ? ico : null];
        }
        return [null, null];
    }

    addFile(what: string, src: string) {
        const { nativeImage } = require('electron');
        if (!src || !fs.existsSync(src))
            return { error: 'Arquivo não encontrado' };
        let img = nativeImage.createFromPath(src);
        if (!img || img.isEmpty())
            return { error: 'Não foi possível abrir essa imagem (use PNG, JPG ou WEBP)' };
        const stamp = String(Math.trunc(Date.now() / 1000)).slice(-6);
        const size = img.getSize();
        const fit = (im: any, max: number) => {
            const s = im.getSize();
            if (Math.max(s.width, s.height) <= max)
                return im;
            const k = max / Math.max(s.width, s.height);
            return im.resize({ width: Math.max(1, Math.round(s.width * k)), height: Math.max(1, Math.round(s.height * k)), quality: 'best' });
        };
        if (what === 'fx') {
            fs.mkdirSync(FX_DIR, { recursive: true });
            img = fit(img, 128);
            const name = path.parse(src).name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'icone';
            const out = path.join(FX_DIR, `${name}-${stamp}.png`);
            fs.writeFileSync(out, img.toPNG());
            const cur = this.get();
            const icons = [...cur.fx.icons, path.basename(out)];
            return this.set({ fx: { icons: icons.slice(-24), mode: 'icons' } });
        }
        fs.mkdirSync(DIR, { recursive: true });
        if (what === 'splash') {
            img = fit(img, 1024);
            const out = path.join(DIR, `splash-${stamp}.png`);
            fs.writeFileSync(out, img.toPNG());
            const old = this.get().splash;
            if (old && old !== path.basename(out))
                unlink(path.join(DIR, old));
            return this.set({ splash: path.basename(out) });
        }
        if (what === 'icon') {
            if (size.width !== size.height) {
                const side = Math.min(size.width, size.height);
                img = img.crop({ x: Math.trunc((size.width - side) / 2), y: Math.trunc((size.height - side) / 2), width: side, height: side });
            }
            if (img.getSize().width !== 256)
                img = img.resize({ width: 256, height: 256, quality: 'best' });
            const out = path.join(DIR, `icon-${stamp}.png`);
            fs.writeFileSync(out, img.toPNG());
            unlink(path.join(DIR, 'icon.ico'));
            const old = this.get().icon;
            if (old && old !== path.basename(out))
                unlink(path.join(DIR, old));
            return this.set({ icon: path.basename(out) });
        }
        if (size.width > 1920)
            img = img.resize({ width: 1920, height: Math.round(size.height * 1920 / size.width), quality: 'best' });
        const out = path.join(DIR, `wallpaper-${stamp}.jpg`);
        fs.writeFileSync(out, img.toJPEG(82));
        const old = this.get().wallpaper;
        if (old && old !== path.basename(out))
            unlink(path.join(DIR, old));
        return this.set({ wallpaper: path.basename(out) });
    }

    remove(what: string, name = '') {
        const cur = this.get();
        if (what === 'fx') {
            const icons = cur.fx.icons.filter((n: string) => n !== name);
            if (name && !name.includes('/') && !name.includes('\\'))
                unlink(path.join(FX_DIR, name));
            return this.set({ fx: { icons, mode: icons.length ? cur.fx.mode : 'theme' } });
        }
        if (what === 'splash' || what === 'icon') {
            if (cur[what])
                unlink(path.join(DIR, cur[what]));
            if (what === 'icon')
                unlink(path.join(DIR, 'icon.ico'));
            return this.set({ [what]: '' });
        }
        if (cur.wallpaper)
            unlink(path.join(DIR, cur.wallpaper));
        return this.set({ wallpaper: '' });
    }

    static radiusCss(r: number) {
        return `:root{--r:${r}px}.btn,.search input,.chip,.bell,.brandbtn,.dd,.tabs button,.seg button,.frow input,.frow select{border-radius:${Math.max(2, Math.round(r * 0.7))}px}`
            + `.card .cov{border-radius:${Math.max(0, r - 2)}px}.rb{border-radius:${Math.max(2, Math.round(r * 0.9))}px}.sec,.item,.hero,.spot,.modal .box,.tile,.g-grafite .gfocus,.g-grafite .gside{border-radius:${r}px}`
            + `.g-grafite .scard,.g-grafite .gcov,.g-grafite .wcard{border-radius:${Math.max(0, r - 4)}px}\n`;
    }

    css(): string {
        const c = this.get();
        if (!c.on)
            return '';
        const out: string[] = [];
        const cols = c.colors || {};
        if (Object.keys(cols).length) {
            let root = Object.entries(cols).map(([k, v]) => `--${k}:${v};`).join('');
            if ('text' in cols && !('muted' in cols))
                root += '--muted:color-mix(in srgb,var(--text) 62%,transparent);--muted2:color-mix(in srgb,var(--text) 45%,transparent);';
            if ('muted' in cols)
                root += '--muted2:color-mix(in srgb,var(--muted) 75%,transparent);';
            if ('line' in cols)
                root += '--line2:color-mix(in srgb,var(--line) 60%,var(--text) 15%);';
            if ('card' in cols && !('card2' in cols))
                root += '--card2:color-mix(in srgb,var(--card) 85%,var(--text) 6%);';
            if ('bg' in cols && !('bg2' in cols))
                root += '--bg2:color-mix(in srgb,var(--bg) 92%,var(--text) 4%);';
            if ('bg' in cols && !('panel' in cols))
                root += '--panel:color-mix(in srgb,var(--bg) 90%,var(--text) 3%);';
            out.push(':root{' + root + '}');
        }
        const a = c.alpha;
        if (a < 100) {
            const blur = c.blur || (a < 90 ? 12 : 0);
            const bf = blur ? `backdrop-filter:blur(${blur}px);` : '';
            out.push(`main.glass{--glassbg:color-mix(in srgb,var(--bg) ${Math.max(0, a - 30)}%,transparent)}`
                + `.rail,.top{background:color-mix(in srgb,var(--panel) ${a}%,transparent);${bf}}`
                + `.sec,.tile,.item,.g-grafite .gfocus,.g-grafite .gside,.modal .box,.hero,.spot,.detail{background:color-mix(in srgb,var(--bg2) ${a}%,transparent);${bf}}`
                + `.card{background:color-mix(in srgb,var(--card) ${Math.max(10, a - 20)}%,transparent)}`
                + `.g-grafite .grec,.gstats{background:color-mix(in srgb,var(--text) 4%,transparent)}`);
        }
        if (c.radius >= 0)
            out.push(CustomUX.radiusCss(c.radius));
        if (FONTS[c.font])
            out.push(`:root{--font-text:${FONTS[c.font]};--font-disp:${FONTS[c.font]}}html,body,button,input,select,textarea{font-family:${FONTS[c.font]}}`);
        else if (FAMILY.test(String(c.font || ''))) {
            const fam = `"${String(c.font).slice(7)}","Segoe UI",system-ui,sans-serif`;
            out.push(`:root{--font-text:${fam};--font-disp:${fam}}html,body,button,input,select,textarea{font-family:${fam}}`);
        }
        const gcss = gradientCss(c.gradient || DEFAULT.gradient);
        if (gcss)
            out.push(gcss);
        if (c.wallpaper) {
            const dim = c.wallpaper_dim;
            const grad = dim ? `linear-gradient(rgba(0,0,0,${f2(dim)}),rgba(0,0,0,${f2(dim)})),` : '';
            const flt = c.wallpaper_blur ? `filter:blur(${c.wallpaper_blur}px);transform:scale(1.04);` : '';
            out.push(`body::after{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background:${grad}url('/api/custom/file/${c.wallpaper}') center/cover no-repeat;opacity:${f2(c.wallpaper_opacity)};${flt}}`);
        }
        if (c.fx.mode === 'off')
            out.push('.fx{display:none}');
        const nav = c.nav;
        if (nav.style === 'icons')
            out.push('.rb span{display:none}.rb{gap:0}body[data-layout=side] .rb,body[data-layout=top] .rb{padding:0 12px;width:auto;justify-content:center}');
        else if (nav.style === 'text')
            out.push('.rb svg{display:none}.rb span{font-size:12px}body[data-nav=bottom] .rb{height:44px}');
        else if (nav.style === 'both')
            out.push('.rb span{display:block}.rb svg{display:block}');
        if (nav.shape === 'round')
            out.push('.rb{border-radius:999px}.rb.on::before{display:none}');
        else if (nav.shape === 'flat')
            out.push(".rb{border-radius:0}.rb.on{background:transparent;box-shadow:none}.rb.on::before{display:none}.rb.on::after{content:'';position:absolute;left:14px;right:14px;bottom:2px;height:2px;border-radius:2px;background:var(--accent)}body[data-nav=side] .rb.on::after,body[data-layout=side] .rb.on::after{left:auto;right:0;top:12px;bottom:12px;width:3px;height:auto}");
        else if (nav.shape === 'square')
            out.push('.rb{border-radius:4px}');
        if (nav.icon_size)
            out.push(`.rb svg{width:${nav.icon_size}px;height:${nav.icon_size}px}`);
        if (nav.gap)
            out.push(`.rail{gap:${nav.gap}px}body[data-nav=bottom] .rail{gap:${nav.gap}px}`);
        const win = c.window;
        if (win.toolbar_style === 'flat')
            out.push('.top{background:transparent;border-bottom:0;box-shadow:none}.search input,.chip,.bell{background:transparent;border-color:transparent}');
        else if (win.toolbar_style === 'outlined')
            out.push('.search input,.chip,.bell,.btn.s{background:transparent;border:1px solid var(--line2)}');
        else if (win.toolbar_style === 'filled')
            out.push('.top{background:var(--panel)}.search input,.chip,.bell{background:color-mix(in srgb,var(--text) 8%,transparent);border-color:transparent}');
        const cards = c.cards;
        const ratio: Record<string, string> = { poster: '', square: '1/1', wide: '16/9', tall: '2/3' };
        if (ratio[cards.shape])
            out.push(`.card .cov{aspect-ratio:${ratio[cards.shape]}}` + (cards.shape === 'wide' ? '.grid{grid-template-columns:repeat(auto-fill,minmax(calc(var(--card) * var(--scale) * 1.5),1fr))}' : ''));
        if (cards.labels === 'overlay')
            out.push('.card .sub{display:none}.card h4{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:26px 10px 9px;color:#fff;text-align:left;background:linear-gradient(0deg,rgba(0,0,0,.88),rgba(0,0,0,.2) 70%,transparent);white-space:normal;font-size:12.5px;line-height:1.2;pointer-events:none;border-radius:0 0 var(--r) var(--r)}');
        else if (cards.labels === 'hover')
            out.push('.card .sub{display:none}.card h4{position:absolute;left:0;right:0;bottom:0;z-index:2;padding:26px 10px 9px;color:#fff;text-align:left;background:linear-gradient(0deg,rgba(0,0,0,.9),transparent);white-space:normal;font-size:12.5px;line-height:1.2;opacity:0;transform:translateY(6px);transition:.22s;pointer-events:none;border-radius:0 0 var(--r) var(--r)}.card:hover h4,.card.gp-focus h4,.card.sel h4{opacity:1;transform:none}');
        else if (cards.labels === 'none')
            out.push('.card .info{display:none}');
        if (!cards.shadow)
            out.push('.card .cov,.g-grafite .gcov,.g-grafite .scard{box-shadow:none}');
        return out.join('\n') + '\n';
    }

    fonts() {
        if (!this.fontsCache)
            this.fontsCache = installedFonts().sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase()));
        return { fonts: this.fontsCache };
    }

    export(name: string, dest = '') {
        const AdmZip = require('adm-zip');
        const c = this.get();
        const slug = (name || 'meu-tema').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'meu-tema';
        const theme = this.store.config.theme || 'system';
        const tj: any = {
            name: name || 'Meu tema', author: 'você', description: 'Tema exportado do Personalizar do LudrixHub', tags: ['personalizado'],
            scheme: theme === 'light' ? 'light' : 'dark', accent: this.store.config.accent || '', layout: this.store.config.layout || '', vars: { ...c.colors },
        };
        if (c.wallpaper) {
            tj.wallpaper = c.wallpaper;
            tj.wallpaper_opacity = Math.round(c.wallpaper_opacity) / 100;
        }
        if (c.fx.mode === 'icons' && c.fx.icons.length)
            tj.fx = { ...c.fx, icons: c.fx.icons.map((n: string) => `fx/${n}`) };
        let css = this.css();
        css = css.replace(/body::after\{[^}]*\}\n?/g, '');
        css = css.split('/api/custom/file/').join('');
        const outDir = dest || path.join(P.THEMES, 'exportados');
        fs.mkdirSync(outDir, { recursive: true });
        const out = path.join(outDir, `${slug}.lxtheme`);
        const z = new AdmZip();
        z.addFile(`${slug}/theme.json`, Buffer.from(JSON.stringify(tj, null, 1), 'utf8'));
        z.addFile(`${slug}/extra.css`, Buffer.from(css, 'utf8'));
        z.addFile(`${slug}/LEIA-ME.txt`, Buffer.from(`${tj.name} — tema exportado do LudrixHub.\nImporte em Ajustes > Aparência > Estilos importados.\n`, 'utf8'));
        if (c.wallpaper && fs.existsSync(path.join(DIR, c.wallpaper)))
            z.addFile(`${slug}/wallpaper${path.extname(c.wallpaper)}`, fs.readFileSync(path.join(DIR, c.wallpaper)));
        for (const n of (tj.fx?.icons || []) as string[]) {
            const p = path.join(FX_DIR, n.slice(3));
            if (fs.existsSync(p))
                z.addFile(`${slug}/${n}`, fs.readFileSync(p));
        }
        z.writeZip(out);
        return { ok: true, path: out };
    }

    wipe() {
        try {
            fs.rmSync(DIR, { recursive: true, force: true });
        }
        catch { /* ignore */ }
    }
}
