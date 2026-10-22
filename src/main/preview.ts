import fs from 'node:fs';
import path from 'node:path';
import * as themes from './themes';

const BASE_DARK: Record<string, string> = { bg: '#000000', bg2: '#0a0a0a', card: '#161616', card2: '#222222', text: '#ffffff', muted: '#8a8a8a', line2: '#2a2a2a' };
const BASE_LIGHT: Record<string, string> = { bg: '#ffffff', bg2: '#f5f5f5', card: '#e9e9e9', card2: '#dcdcdc', text: '#000000', muted: '#707070', line2: '#d0d0d0' };

function parseVars(css: string): Record<string, string> {
    const out: Record<string, string> = {};
    const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)))
        out[m[1]] = m[2].trim();
    return out;
}

function rgb(raw: string | undefined, fallback: string): [number, number, number] {
    const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const s = String(raw || '').trim();
    const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(s);
    if (m)
        return [Number(m[1]), Number(m[2]), Number(m[3])];
    if (/^#[0-9a-fA-F]{6}$/.test(s))
        return hex(s);
    if (/^#[0-9a-fA-F]{3}$/.test(s))
        return hex('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]);
    return hex(fallback);
}

const css = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;

function half(x0: number, W: number, H: number, scheme: 'dark' | 'light', vars: Record<string, string>, accent: string, layout: string): string {
    const base = scheme === 'light' ? BASE_LIGHT : BASE_DARK;
    const col = (n: string) => rgb(vars[n], base[n]);
    const bg = col('bg'), bg2 = col('bg2'), card = col('card'), card2 = col('card2'), text = col('text'), muted = col('muted'), line = col('line2');
    const ac = /^#[0-9a-fA-F]{6}$/.test(accent) ? rgb(accent, '#ffffff') : text;
    const r = (x: number, y: number, w: number, h: number, fill: [number, number, number], extra = '') =>
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${css(fill)}"${extra}/>`;
    const parts: string[] = [r(x0, 0, W, H, bg)];
    let cx = x0 + 14, cy = 14, cw = W - 28, ch = H - 28;
    if (layout === 'side') {
        parts.push(r(x0, 0, 26, H, bg2), r(x0 + 26, 0, 1, H, line), r(x0 + 8, 8, 10, 10, ac));
        for (let i = 0; i < 6; i++)
            parts.push(r(x0 + 9, 32 + i * 16, 8, 8, i === 1 ? text : muted));
        parts.push(r(x0, 46, 2, 12, ac));
        cx = x0 + 34; cw = W - 40; cy = 10;
    }
    else if (layout === 'top') {
        parts.push(r(x0, 0, W, 18, bg2), r(x0, 18, W, 1, line), r(x0 + 8, 5, 8, 8, ac));
        for (let i = 0; i < 5; i++)
            parts.push(r(x0 + 26 + i * 22, 7, 14, 3, i === 0 ? text : muted));
        parts.push(r(x0 + 26, 16, 14, 2, ac));
        cy = 26; ch = H - 40;
    }
    else {
        parts.push(r(x0, H - 18, W, 18, bg2), r(x0, H - 18, W, 1, line));
        for (let i = 0; i < 7; i++)
            parts.push(r(x0 + W / 2 - 60 + i * 18, H - 13, 8, 8, i === 1 ? ac : muted));
        parts.push(r(x0 + W / 2 - 42, H - 18, 8, 2, ac));
        ch = H - 32;
    }
    const bh = Math.floor(ch * 0.44);
    const gid = `g${x0}${scheme}`;
    parts.push(`<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${css(card2)}"/><stop offset="1" stop-color="${css(bg)}"/></linearGradient></defs>`);
    const hx = layout !== 'side' ? cx - 14 : cx - 8;
    parts.push(`<rect x="${hx}" y="${cy - 14}" width="${x0 + W - hx}" height="${bh}" fill="url(#${gid})"/>`);
    parts.push(r(cx, cy + bh - 40, 14, 2, ac), r(cx, cy + bh - 32, cw * 0.42, 12, text), r(cx, cy + bh - 14, 22, 7, ac));
    parts.push(`<rect x="${cx + 26}" y="${cy + bh - 14}" width="22" height="7" fill="none" stroke="${css(line)}"/>`);
    let top = cy + bh + 6;
    parts.push(r(cx, top + 2, 8, 1, ac), r(cx + 12, top, cw * 0.3, 5, text));
    top += 12;
    const n = 6, gap = 5;
    const cw_ = (cw - gap * (n - 1)) / n;
    const hh = Math.min(ch - (top - cy) - 2, cw_ * 1.45);
    for (let i = 0; i < n; i++) {
        const x = cx + i * (cw_ + gap);
        parts.push(r(x, top, cw_, hh, i % 2 ? card : card2), r(x, top + hh + 3, cw_ * 0.7, 2, muted));
    }
    return parts.join('');
}

/** Prévia desenhada do tema (SVG), igual à montagem do Python com PIL. */
export function themePreviewSvg(themeId: string, accentCfg: string, cfg: Record<string, any>): string | null {
    let scheme: 'dark' | 'light' | 'split' = 'dark';
    let accent = String(accentCfg || '');
    let layout = '';
    let vars: Record<string, string> = {};
    const vs: Record<string, Record<string, string>> = {};
    const fs_ = themes.faceOf(themeId, cfg);
    if (fs_) {
        const [face, sch] = fs_;
        const info = (themes.FACES as any)[face];
        accent = accent || info.accent;
        layout = ({ rail: 'side', bottom: '' } as any)[info.layout] ?? info.layout;
        scheme = (sch as any) || 'split';
        for (const s of ['dark', 'light'] as const)
            vs[s] = parseVars(themes.faceVarsCss(face, s));
    }
    else if (themeId.startsWith('file:')) {
        const d = themes.themeDir(themeId.slice(5));
        const tj = path.join(d, 'theme.json');
        if (!fs.existsSync(tj))
            return null;
        try {
            const t = JSON.parse(fs.readFileSync(tj, 'utf8').replace(/^\uFEFF/, ''));
            scheme = t.scheme === 'light' ? 'light' : 'dark';
            accent = t.accent || accent;
            layout = t.layout || '';
            vars = t.vars || {};
        }
        catch {
            return null;
        }
    }
    else {
        return null;
    }
    const W = 320, H = 200;
    let body = '';
    if (scheme === 'split')
        body = half(0, W / 2, H, 'dark', vs.dark || {}, accent, layout) + half(W / 2, W / 2, H, 'light', vs.light || {}, accent, layout);
    else
        body = half(0, W, H, scheme, Object.keys(vs).length ? vs[scheme] : vars, accent, layout);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">${body}</svg>`;
}
