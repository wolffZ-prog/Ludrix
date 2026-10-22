import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';
import * as P from './paths';
import * as sign from './crypto';
import * as log from './log';

export const THEME_VARS = ['bg', 'bg2', 'panel', 'card', 'card2', 'line', 'line2', 'text', 'muted', 'muted2', 'green', 'green2', 'red', 'amber',
    'shadow', 'glow1', 'glow2', 'glow3', 'ph-from', 'ph-to', 'img-fade'];

export const FACES: Record<string, { name: string; description: string; accent: string; layout: string }> = {
    padrao: { name: 'Padrão', description: 'Fundo preto ou branco, cor sólida e linha fina; azul só no Jogar e no que está selecionado.', accent: '', layout: 'side' },
};
export const DEFAULT_FACE = 'padrao';
const SLUG = /^[a-z0-9][a-z0-9._-]{0,60}$/;
const THEME_FILES = /^(theme\.json|extra\.css|wallpaper\.(jpg|jpeg|png|webp)|preview\.(png|jpg|jpeg|webp)|thumb\.png|LEIA-?ME\.txt|README\.(txt|md)|[A-Za-z0-9_.-]+\.(woff2|woff|ttf|png|webp|svg))$/i;

type Cfg = Record<string, any>;

function readJsonBom(file: string): any {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
function writeJsonPy(file: string, data: any) {
    fs.writeFileSync(file, JSON.stringify(data, null, 1), 'utf8');
}
function isFile(p: string) { try { return fs.statSync(p).isFile(); } catch { return false; } }
function isDir(p: string) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function exists(p: string) { return fs.existsSync(p); }

export function faces() {
    return Object.entries(FACES).map(([id, v]) => ({ id, ...v }));
}
export function currentFace(cfg: Cfg) {
    const f = String(cfg.face || '') || DEFAULT_FACE;
    return f in FACES ? f : DEFAULT_FACE;
}
export function faceOf(themeId: string, cfg: Cfg): [string, string | null] | null {
    if (['dark', 'light', 'system'].includes(themeId))
        return [currentFace(cfg), themeId === 'dark' ? 'dark' : themeId === 'light' ? 'light' : null];
    if (themeId in FACES)
        return [themeId, null];
    const m = /^([a-z]+)-(dark|light)$/.exec(themeId || '');
    if (m && m[1] in FACES)
        return [m[1], m[2]];
    return null;
}
export function faceVarsCss(face: string, scheme: string) {
    const f = path.join(P.UI, 'themes', face, `${scheme}.css`);
    return exists(f) ? fs.readFileSync(f, 'utf8') : '';
}
export function themeDir(slug: string) {
    if (!SLUG.test(slug || '') || slug.includes('..'))
        throw new Error('tema inválido');
    return path.join(P.THEMES, slug);
}

function migrateThemeFiles() {
    if (!exists(P.THEMES))
        return;
    for (const f of fs.readdirSync(P.THEMES)) {
        if (!f.endsWith('.css') || !isFile(path.join(P.THEMES, f)))
            continue;
        const src = path.join(P.THEMES, f);
        const stem = f.slice(0, -4);
        const d = path.join(P.THEMES, stem);
        fs.mkdirSync(d, { recursive: true });
        const css = fs.readFileSync(src, 'utf8');
        const vars: Record<string, string> = {};
        for (const m of css.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g))
            if (THEME_VARS.includes(m[1]))
                vars[m[1]] = m[2].trim();
        const scheme = css.replace(/ /g, '').includes('color-scheme:light') ? 'light' : 'dark';
        writeJsonPy(path.join(d, 'theme.json'), { name: stem.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), author: '', scheme, accent: '', vars });
        fs.rmSync(src, { force: true });
    }
}

export function themes() {
    const out: any[] = [];
    migrateThemeFiles();
    const user = exists(P.THEMES) ? fs.readdirSync(P.THEMES).filter((n) => exists(path.join(P.THEMES, n, 'theme.json'))) : [];
    for (const slug of user.sort()) {
        let d: string;
        try { d = themeDir(slug); } catch { continue; }
        let t: any;
        try { t = readJsonBom(path.join(d, 'theme.json')); } catch { continue; }
        if (!t || typeof t !== 'object') continue;
        out.push({ id: 'file:' + slug, name: t.name || slug, author: t.author ?? '', scheme: t.scheme ?? 'dark',
            accent: t.accent ?? '', layout: t.layout ?? '', vars: t.vars ?? {}, css: exists(path.join(d, 'extra.css')), dir: d, builtin: false,
            preview: Boolean(previewIn(d)), description: t.description ?? '', tags: t.tags ?? '', category: t.category ?? '', icons: t.icons ?? '', official: Boolean(t.official) });
    }
    return out;
}

function rgbToHls(r: number, g: number, b: number): [number, number, number] {
    const maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
    const l = (minc + maxc) / 2;
    if (minc === maxc) return [0, l, 0];
    const d = maxc - minc;
    const s = l <= 0.5 ? d / (maxc + minc) : d / (2 - maxc - minc);
    const rc = (maxc - r) / d, gc = (maxc - g) / d, bc = (maxc - b) / d;
    let h: number;
    if (r === maxc) h = bc - gc;
    else if (g === maxc) h = 2 + rc - bc;
    else h = 4 + gc - rc;
    h = (h / 6) % 1;
    if (h < 0) h += 1;
    return [h, l, s];
}
function hlsToRgb(h: number, l: number, s: number): [number, number, number] {
    if (s === 0) return [l, l, l];
    const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s;
    const m1 = 2 * l - m2;
    const v = (hue: number) => {
        hue = hue % 1; if (hue < 0) hue += 1;
        if (hue < 1 / 6) return m1 + (m2 - m1) * hue * 6;
        if (hue < 0.5) return m2;
        if (hue < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - hue) * 6;
        return m1;
    };
    return [v(h + 1 / 3), v(h), v(h - 1 / 3)];
}
function hex2(n: number) { return Math.round(n).toString(16).padStart(2, '0'); }

function flipColor(c: string, d2l: boolean, kind: string) {
    c = (c || '').trim();
    let m = /^#([0-9a-fA-F]{6})$/.exec(c);
    if (m) {
        const [r0, g0, b0] = [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16) / 255);
        let [h, l, s] = rgbToHls(r0, g0, b0);
        if (kind === 'surface') {
            l = d2l ? 1 - l * 0.32 : (1 - l) * 0.22;
            s = Math.min(s, 0.25);
        } else if (kind === 'ink') {
            l = 1 - l;
        } else if (kind === 'accent') {
            l = d2l ? Math.max(0.28, l * 0.82) : Math.min(0.72, l * 1.12 + 0.05);
        }
        const [r, g, b] = hlsToRgb(h, Math.max(0, Math.min(1, l)), s);
        return '#' + hex2(r * 255) + hex2(g * 255) + hex2(b * 255);
    }
    m = /^rgba?\(([^)]+)\)$/.exec(c);
    if (m && kind === 'line') {
        const parts = m[1].split(',').map((x) => x.trim());
        const a = parts.length > 3 ? parts[3] : '1';
        return `rgba(${d2l ? '20,26,36' : '235,240,245'},${a})`;
    }
    return c;
}
function flipVars(v: Record<string, any>, scheme: string, to: string) {
    const d2l = scheme !== 'light' && to === 'light';
    const out: Record<string, any> = { ...v };
    for (const k of ['bg', 'bg2', 'panel', 'card', 'card2', 'ph-from', 'ph-to'])
        if (v[k]) out[k] = flipColor(v[k], d2l, 'surface');
    for (const k of ['text', 'muted', 'muted2'])
        if (v[k]) out[k] = flipColor(v[k], d2l, 'ink');
    for (const k of ['line', 'line2'])
        if (v[k]) out[k] = flipColor(v[k], d2l, 'line');
    for (const k of ['green', 'green2', 'red', 'amber'])
        if (v[k]) out[k] = flipColor(v[k], d2l, 'accent');
    if (v['img-fade'] && v.bg && out.bg)
        out['img-fade'] = String(v['img-fade']).split(v.bg).join(out.bg);
    if (v.shadow)
        out.shadow = String(v.shadow).replace(/rgba\(0,\s*0,\s*0,\s*([\d.]+)\)/g, (_m, a) => `rgba(20,30,50,${d2l ? Math.min(parseFloat(a), 0.45) : parseFloat(a)})`);
    return out;
}

function safeVar(v: any) {
    const s = String(v ?? '').trim();
    if (s.length > 200 || /[;{}<>]|url\s*\(|expression|@import|\\\\/i.test(s))
        return '';
    return s;
}
function safeCss(css: string) {
    css = css.replace(/\x00/g, '');
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    css = css.replace(/@import[^;{]*(;|\{[^}]*\})?/gi, '');
    css = css.replace(/@(namespace|charset|document|-moz-document)[^;{]*(;|\{[^}]*\})?/gi, '');
    css = css.replace(/(expression|-moz-binding|behavior)\s*[:(][^;}]*/gi, '');
    css = css.replace(/url\(\s*([^)]*)\)/gi, (m0, inner) => {
        const raw = String(inner).trim().replace(/^['"]+|['"]+$/g, '').trim();
        const low = raw.toLowerCase();
        if (low.startsWith('data:image/') || low.startsWith('data:font/') || low.startsWith('data:application/font') || low.startsWith('data:application/x-font'))
            return m0;
        if (/^\/api\/theme\/[A-Za-z0-9:_-]+\/(wallpaper|file\/[A-Za-z0-9_.-]+)$/.test(raw) || /^(\.\/)?(fx\/)?[A-Za-z0-9_-]+\.(png|jpe?g|webp|gif|svg|woff2?|ttf)$/.test(raw))
            return m0;
        if (raw.startsWith('#'))
            return m0;
        return 'none';
    });
    css = css.replace(/(?<![\w-])(src|image-set|-webkit-image-set)\s*:\s*(https?:|\/\/|file:|ftp:|javascript:)[^;}]*/gi, '');
    return css;
}
function glassCompat(css: string) {
    return css.replace(/(?<![\w-])([^@{}]*?)\{([^{}]*)\}/g, (m0, sel: string, body: string) => {
        const keep = body.split(';').filter((d) => /^\s*(background|backdrop-filter|-webkit-backdrop-filter)\s*:/.test(d)).join(';');
        if (!keep) return m0;
        const sels = sel.split(',').map((x) => x.trim());
        if (!sels.length || !sels.every((x) => /(^|\s)(main\.glass|\.rail(\.glass)?|nav\.rail)$/.test(x)))
            return m0;
        const layer = sels.map((x) => x + '::before').join(',');
        return m0 + layer + '{' + keep + '}' + sels.join(',') + '{background:transparent!important;backdrop-filter:none!important}';
    });
}
function scopeNavCss(css: string, layout: string) {
    const lay = ({ dock: 'bottom', taskbar: 'bottom' } as any)[layout || ''] ?? (layout || '');
    const attr = ({ top: '[data-layout=top]', side: '[data-layout=side]', bottom: '[data-nav=bottom]', rail: ':not([data-layout])[data-nav=side]', '': ':not([data-layout])' } as any)[lay];
    if (!attr) return css;
    const fix = (g1: string) => {
        const out: string[] = [];
        for (let sel of g1.split(',').map((x) => x.trim())) {
            if (sel.includes('[data-layout'))
                out.push(sel);
            else if (/(^|[\s>+~,(])(\.rail|\.rb|\.gpind)(?![\w-])/.test(sel) || /body\[data-nav\]/.test(sel)) {
                sel = sel.replace(/^html\s+body\[data-nav\]\s*/, '');
                sel = sel.replace(/^body\b/, '').trim();
                out.push((sel.includes('.gpind') ? `body${attr} ${sel}` : `html body${attr}>#app ${sel}`).trim());
            } else
                out.push(sel);
        }
        return out.join(',') + '{';
    };
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    return css.replace(/(?<![\w-])([^@{}]*?)\{/g, (m0, g1: string) => (g1.trim() ? fix(g1) : m0));
}

export function themeCss(themeId: string, scheme: string, cfg: Cfg) {
    if (themeId.startsWith('file:')) {
        const d = themeDir(themeId.slice(5));
        const tj = path.join(d, 'theme.json');
        if (!exists(tj)) return '';
        let t: any;
        try { t = readJsonBom(tj); } catch { return ''; }
        const own = t.scheme === 'light' ? 'light' : 'dark';
        const eff = scheme === 'light' || scheme === 'dark' ? scheme : own;
        const base = faceVarsCss('padrao', eff);
        let v: Record<string, any> = t.vars || {};
        if (eff !== own)
            v = t['vars_' + eff] || flipVars(v, own, eff);
        let css = base + '\n:root{' + THEME_VARS.filter((k) => v[k] && safeVar(v[k])).map((k) => `--${k}:${safeVar(v[k])};`).join('') + `color-scheme:${eff};` + '}\n';
        if (t.wallpaper || themeWallpaper(themeId) !== null)
            css += `body::after{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background:url('/api/theme/${themeId}/wallpaper') center/cover no-repeat;opacity:${t.wallpaper_opacity ?? 0.35}}\n`;
        const extra = path.join(d, 'extra.css');
        if (exists(extra)) {
            let x = fs.readFileSync(extra, 'utf8');
            const a = x.indexOf('/* ---- parte 1: layout ---- */'), b = x.indexOf('/* ---- parte 2: visual ---- */');
            if (a >= 0 && a < b)
                x = x.slice(0, a) + x.slice(b);
            css += scopeNavCss(glassCompat(safeCss(x)), t.layout || '');
        }
        return css;
    }
    const fsc = faceOf(themeId, cfg);
    if (!fsc) return '';
    const [face, sch] = fsc;
    const css = faceVarsCss(face, sch || 'dark');
    const fc = path.join(P.UI, 'themes', face, 'face.css');
    return css + (exists(fc) ? '\n' + fs.readFileSync(fc, 'utf8') : '');
}

export function themeJson(tid: string) {
    if (!tid.startsWith('file:')) return {};
    const d = themeDir(tid.slice(5));
    let t: any;
    try { t = readJsonBom(path.join(d, 'theme.json')); } catch { return {}; }
    if (!t || typeof t !== 'object') return {};
    t.extra_css = exists(path.join(d, 'extra.css')) ? fs.readFileSync(path.join(d, 'extra.css'), 'utf8') : '';
    t.has_wallpaper = themeWallpaper(tid) !== null;
    return t;
}

function previewIn(d: string) {
    for (const n of ['preview.png', 'preview.jpg', 'preview.webp', 'thumb.png'])
        if (exists(path.join(d, n))) return path.join(d, n);
    return null;
}
export function themePreview(themeId: string) {
    if (themeId.startsWith('file:')) {
        try { return previewIn(themeDir(themeId.slice(5))); } catch { return null; }
    }
    return null;
}
export function themeFile(themeId: string, rel: string) {
    if (!themeId.startsWith('file:')) return null;
    let d: string;
    try { d = fs.realpathSync(themeDir(themeId.slice(5))); } catch { return null; }
    let p: string;
    try { p = fs.realpathSync(path.join(d, rel)); } catch { return null; }
    if (!p.startsWith(d + path.sep) || !isFile(p) || !['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.woff2', '.woff', '.ttf'].includes(path.extname(p).toLowerCase()))
        return null;
    return p;
}
export function themeWallpaper(themeId: string) {
    if (!themeId.startsWith('file:')) return null;
    let d: string;
    try { d = themeDir(themeId.slice(5)); } catch { return null; }
    for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
        const p = path.join(d, 'wallpaper' + ext);
        if (exists(p)) return p;
    }
    return null;
}

export function themeSave(data: Record<string, any>) {
    const name = String(data.name || 'Meu tema').trim();
    const tid = String(data.id || '');
    const slug = tid.startsWith('file:') ? tid.slice(5) : (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tema');
    const d = themeDir(slug);
    fs.mkdirSync(d, { recursive: true });
    let cur: any = {};
    if (exists(path.join(d, 'theme.json'))) {
        try { cur = readJsonBom(path.join(d, 'theme.json')); } catch { cur = {}; }
        if (!cur || typeof cur !== 'object') cur = {};
    }
    const srcVars = data.vars || cur.vars || {};
    const vars: Record<string, any> = {};
    for (const [k, v] of Object.entries(srcVars))
        if (THEME_VARS.includes(k) && v) vars[k] = v;
    Object.assign(cur, { name, author: data.author ?? cur.author ?? '', scheme: data.scheme ?? cur.scheme ?? 'dark', accent: data.accent ?? cur.accent ?? '', vars });
    if ('wallpaper_opacity' in data)
        cur.wallpaper_opacity = Number(data.wallpaper_opacity);
    if ('layout' in data)
        cur.layout = ['top', 'side', 'dock', 'taskbar', 'bottom', 'rail'].includes(data.layout) ? (({ dock: 'bottom', taskbar: 'bottom' } as any)[data.layout] ?? data.layout) : '';
    writeJsonPy(path.join(d, 'theme.json'), cur);
    if ('extra_css' in data) {
        if (String(data.extra_css).trim())
            fs.writeFileSync(path.join(d, 'extra.css'), String(data.extra_css), 'utf8');
        else
            fs.rmSync(path.join(d, 'extra.css'), { force: true });
    }
    return { ok: true, id: 'file:' + slug };
}

export function themeDelete(tid: string, cfg: Cfg, setConfig: (patch: Record<string, any>) => void) {
    if (!tid.startsWith('file:'))
        return { error: 'Temas embutidos não podem ser apagados' };
    const d = themeDir(tid.slice(5));
    if (exists(d))
        fs.rmSync(d, { recursive: true, force: true });
    if (cfg.theme === tid)
        setConfig({ theme: 'system' });
    return { ok: true };
}

function zipThemes(out: string, dirs: string[]) {
    const z = new AdmZip();
    for (const d of dirs)
        for (const f of fs.readdirSync(d).sort())
            if (isFile(path.join(d, f)) && THEME_FILES.test(f))
                z.addFile(`${path.basename(d)}/${f}`, fs.readFileSync(path.join(d, f)));
    z.writeZip(out);
}
function exportDest() {
    const dl = path.join(os.homedir(), 'Downloads');
    return exists(dl) ? dl : P.ROOT;
}
export function themeExport(tid: string, fmt = 'lxtheme') {
    if (!tid.startsWith('file:'))
        return { error: 'Só temas personalizados' };
    const d = themeDir(tid.slice(5));
    if (!isDir(d))
        return { error: 'Tema não encontrado' };
    fmt = fmt === 'zip' ? 'zip' : 'lxtheme';
    const out = path.join(exportDest(), `${path.basename(d)}.${fmt}`);
    zipThemes(out, [d]);
    return { ok: true, path: out };
}
export function themeExportAll(fmt = 'zip') {
    const dirs = exists(P.THEMES) ? fs.readdirSync(P.THEMES).sort().map((n) => path.join(P.THEMES, n)).filter((d) => isDir(d) && exists(path.join(d, 'theme.json'))) : [];
    if (!dirs.length)
        return { error: 'Nenhum tema personalizado pra exportar' };
    const out = path.join(exportDest(), `ludrix-temas.${fmt === 'lxtheme' ? 'lxtheme' : 'zip'}`);
    zipThemes(out, dirs);
    return { ok: true, path: out, count: dirs.length };
}

function markOfficial(d: string, official: boolean) {
    const tj = path.join(d, 'theme.json');
    let t: any;
    try { t = readJsonBom(tj); } catch { return; }
    if (!t || typeof t !== 'object') return;
    if (Boolean(t.official) === official) return;
    if (official) t.official = true;
    else delete t.official;
    writeJsonPy(tj, t);
}
function isZip(p: string) {
    try {
        const fd = fs.openSync(p, 'r');
        const b = Buffer.alloc(4);
        fs.readSync(fd, b, 0, 4, 0);
        fs.closeSync(fd);
        return b[0] === 0x50 && b[1] === 0x4b && [0x0304, 0x0506, 0x0708].includes(b.readUInt16BE(2));
    } catch { return false; }
}
export function themeImportOne(file: string) {
    if (!exists(file))
        return { error: 'Arquivo não encontrado' };
    const stem = path.basename(file, path.extname(file));
    if (path.extname(file).toLowerCase() === '.json') {
        const t = readJsonBom(file);
        const r = themeSave({ name: t.name ?? stem, scheme: t.scheme ?? 'dark', accent: t.accent ?? '', layout: t.layout ?? '', vars: t.vars ?? {} });
        return { ...r, name: t.name ?? stem, count: 1, themes: [{ id: r.id || '', name: t.name ?? stem }] };
    }
    if (!isZip(file))
        return { error: 'Isso não é um .lxtheme/.zip válido' };
    const imported: { id: string; name: string }[] = [];
    if (fs.statSync(file).size > 80 * 1024 * 1024)
        return { error: 'Arquivo de tema grande demais (máximo 80 MB)' };
    const official = sign.isSigned(file);
    let z: AdmZip;
    try { z = new AdmZip(file); } catch { return { error: 'Isso não é um .lxtheme/.zip válido' }; }
    const infos = z.getEntries().filter((e) => !e.isDirectory);
    const sizes = infos.map((e) => e.header.size);
    if (infos.length > 400 || sizes.reduce((a, b) => a + b, 0) > 160 * 1024 * 1024 || sizes.some((s) => s > 40 * 1024 * 1024))
        return { error: 'Arquivo de tema fora do limite (muitos arquivos ou grande demais)' };
    const names = infos.map((e) => e.entryName).filter((n) => !n.includes('..') && !n.startsWith('/') && !n.startsWith('\\'));
    const read = (n: string) => z.getEntry(n)!.getData();
    const tjs = names.filter((n) => n.split('/').pop()!.toLowerCase() === 'theme.json');
    if (!tjs.length)
        return { error: 'Esse arquivo não tem theme.json (esqueleto: <pasta-do-tema>/theme.json + extra.css + preview.png…)' };
    for (const tj of tjs) {
        const folder = tj.slice(0, -'theme.json'.length);
        let t: any;
        try { t = JSON.parse(read(tj).toString('utf8').replace(/^\uFEFF/, '')); } catch { continue; }
        if (!t || typeof t !== 'object') continue;
        const last = folder.replace(/^\/+|\/+$/g, '').split('/').pop() || t.name || stem;
        const slug = String(last).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || stem;
        const d = path.join(P.THEMES, slug);
        fs.mkdirSync(d, { recursive: true });
        for (const n of names) {
            if (!n.startsWith(folder)) continue;
            const base = n.slice(folder.length);
            if (base.includes('/')) {
                if (base.startsWith('fx/') && /^fx\/[A-Za-z0-9_.-]+\.(png|webp|gif|svg)$/i.test(base) && base.split('/').length === 2) {
                    fs.mkdirSync(path.join(d, 'fx'), { recursive: true });
                    fs.writeFileSync(path.join(d, base), read(n));
                }
                continue;
            }
            if (base && THEME_FILES.test(base))
                fs.writeFileSync(path.join(d, base), read(n));
        }
        markOfficial(d, official);
        imported.push({ id: 'file:' + slug, name: t.name ?? slug });
    }
    if (!imported.length)
        return { error: 'Nenhum tema válido dentro do arquivo' };
    const first = imported[0];
    const name = imported.length === 1 ? first.name : `${imported.length} temas (${imported.slice(0, 4).map((x) => x.name).join(', ')}${imported.length > 4 ? '…' : ''})`;
    return { ok: true, id: first.id, name, count: imported.length, themes: imported };
}
export function themeImportMany(files: string[]) {
    if (files.length === 1)
        return themeImportOne(files[0]);
    const imported: { id: string; name: string }[] = [];
    const errors: string[] = [];
    for (const f of files) {
        let r: any;
        try { r = themeImportOne(f); } catch (e: any) { r = { error: String(e?.message || e) }; }
        if (r.error) errors.push(`${path.basename(f)}: ${r.error}`);
        else imported.push(...(r.themes || []));
    }
    if (!imported.length)
        return { error: errors.join('; ') || 'Nenhum tema válido' };
    let name = `${imported.length} temas (${imported.slice(0, 4).map((x) => x.name).join(', ')}${imported.length > 4 ? '…' : ''})`;
    if (errors.length)
        name += ` · ${errors.length} arquivo${errors.length > 1 ? 's' : ''} ignorado${errors.length > 1 ? 's' : ''}`;
    return { ok: true, id: imported[0].id, name, count: imported.length, themes: imported, errors };
}

export function themePalette(cfg: Cfg) {
    let tid = String(cfg.theme || 'system');
    if (tid === 'system') tid = 'dark';
    let css = '';
    try { css = themeCss(tid, '', cfg); } catch { css = ''; }
    if (!css) css = themeCss('dark', '', cfg);
    const vals: Record<string, string> = {};
    for (const m of css.matchAll(/--([a-z0-9-]+)\s*:\s*([^;}]+)/g))
        vals[m[1]] = m[2].trim();
    const hexc = (v: any, base = '#0b0b0e'): string | null => {
        v = String(v || '').trim();
        let m = /^#([0-9a-f]{3,8})$/i.exec(v);
        if (m) {
            let h = m[1];
            if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
            return '#' + h.slice(0, 6).toLowerCase();
        }
        m = /rgba?\(([^)]+)\)/.exec(v);
        if (m) {
            const parts = m[1].replace(/\//g, ',').split(',').map((p) => p.trim());
            try {
                const [r, g, b] = parts.slice(0, 3).map((x) => { const n = parseFloat(x); if (isNaN(n)) throw 0; return Math.trunc(n); });
                let a = parts.length > 3 ? parseFloat(parts[3]) : 1.0;
                if (isNaN(a)) throw 0;
                if (a > 1) a /= 100;
                const br = parseInt(base.slice(1, 3), 16), bg_ = parseInt(base.slice(3, 5), 16), bb = parseInt(base.slice(5, 7), 16);
                return '#' + hex2(r * a + br * (1 - a)) + hex2(g * a + bg_ * (1 - a)) + hex2(b * a + bb * (1 - a));
            } catch { return null; }
        }
        return null;
    };
    const scheme = css.replace(/ /g, '').includes('color-scheme:light') ? 'light' : 'dark';
    const bg = hexc(vals.bg) || (scheme === 'light' ? '#f4f4f5' : '#0b0b0e');
    const text = hexc(vals.text, bg) || (scheme === 'light' ? '#151517' : '#f2f2f4');
    let tacc = '';
    if (tid.startsWith('file:')) {
        try { tacc = readJsonBom(path.join(themeDir(tid.slice(5)), 'theme.json')).accent || ''; } catch { tacc = ''; }
    } else
        tacc = FACES[currentFace(cfg)].accent;
    const accent = hexc(cfg.accent || tacc || vals.accent || '', bg) || (scheme === 'light' ? '#2b6be0' : '#4f8df7');
    return { scheme, bg, bg2: hexc(vals.bg2, bg) || bg, card: hexc(vals.card, bg) || bg,
        line: hexc(vals.line2 || vals.line, bg) || text, text,
        muted: hexc(vals.muted, bg) || text, accent, red: hexc(vals.red, bg) || '#ef4444',
        green: hexc(vals.green2 || vals.green, bg) || '#22c55e', theme: tid };
}

export function previewStamp(themeId: string, cfg: Cfg) {
    try {
        const fsc = faceOf(themeId, cfg);
        if (fsc) {
            const face = fsc[0];
            return face + '-' + ['dark.css', 'light.css', 'face.css'].filter((n) => exists(path.join(P.UI, 'themes', face, n))).map((n) => String(Math.trunc(fs.statSync(path.join(P.UI, 'themes', face, n)).mtimeMs / 1000))).join('-');
        }
        if (themeId.startsWith('file:'))
            return String(Math.trunc(fs.statSync(path.join(themeDir(themeId.slice(5)), 'theme.json')).mtimeMs / 1000));
    } catch (e) {
        log.debug(`mock preview ${themeId}: ${e}`);
    }
    return 'builtin';
}
