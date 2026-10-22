import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as P from './paths';
import * as http from './http';
import { fetchImage } from './imgfetch';
import * as imgdecode from './imgdecode';

export const THUMB_H = 300;
export const COVER_H = 720;
export const SHOT_H = 360;

const locks = new Map<string, Promise<void>>();

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) || Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => { release = r; });
    locks.set(key, prev.then(() => mine));
    return prev.then(fn).finally(() => {
        release();
        if (locks.get(key) === mine)
            locks.delete(key);
    });
}

export function safe(key: string): string {
    return crypto.createHash('sha1').update(key, 'utf8').digest('hex').slice(0, 20);
}

function nativeImage(): any {
    try {
        return require('electron').nativeImage;
    }
    catch {
        return null;
    }
}

export function isErrorImage(img: any): boolean {
    try {
        const { width, height } = img.getSize();
        if (width !== 180 || height !== 140)
            return false;
        const bmp: Buffer = img.toBitmap();
        const i = (5 * width + 5) * 4;
        const b = bmp[i], g = bmp[i + 1], r = bmp[i + 2];
        return r > 235 && g < 110 && b < 110;
    }
    catch {
        return false;
    }
}

export function convert(data: Buffer, maxH: number, quality: number): Buffer | null {
    const NI = nativeImage();
    if (!NI)
        return null;
    try {
        let img = NI.createFromBuffer(data);
        if (img.isEmpty())
            return null;
        if (isErrorImage(img))
            return null;
        const { width, height } = img.getSize();
        if (height > maxH)
            img = img.resize({ width: Math.max(1, Math.round(width * maxH / height)), height: maxH, quality: 'good' });
        return img.toJPEG(quality);
    }
    catch {
        return null;
    }
}

export async function convertAsync(data: Buffer, maxH: number, quality: number): Promise<Buffer | null> {
    const dec = await imgdecode.decode(data, { maxH, fmt: 'jpeg', quality });
    if (!dec)
        return null;
    if (imgdecode.isErrorProbe(dec.w, dec.h, dec.probe))
        return null;
    return dec.buf;
}

export function blurHero(src: string, dest: string): boolean {
    const NI = nativeImage();
    if (!NI)
        return false;
    try {
        let im = NI.createFromPath(src);
        if (im.isEmpty())
            return false;
        const w = 1280, h = 720;
        const sz = im.getSize();
        const k = Math.max(w / sz.width, h / sz.height);
        im = im.resize({ width: Math.max(w, Math.round(sz.width * k)), height: Math.max(h, Math.round(sz.height * k)), quality: 'good' });
        const s2 = im.getSize();
        const x = Math.floor((s2.width - w) / 2), y = Math.max(0, Math.floor((s2.height - h) / 3));
        im = im.crop({ x, y, width: w, height: h });
        im = im.resize({ width: 32, height: 18, quality: 'best' }).resize({ width: w, height: h, quality: 'best' });
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const tmp = dest + '.tmp';
        fs.writeFileSync(tmp, im.toJPEG(80));
        fs.renameSync(tmp, dest);
        return true;
    }
    catch {
        return false;
    }
}

class DirSet {
    names = new Set<string>();
    t = 0;
    constructor(public folder: string) { }
    get(): Set<string> {
        const now = Date.now() / 1000;
        if (now - this.t > 2.0) {
            try {
                this.names = new Set(fs.readdirSync(this.folder));
            }
            catch {
                this.names = new Set();
            }
            this.t = now;
        }
        return this.names;
    }
    add(name: string) {
        this.names.add(name);
    }
    discard(name: string) {
        this.names.delete(name);
    }
}

export class ImageCache {
    thumbs = new DirSet(P.CACHE_THUMBS);
    onThumb: ((key: string) => void) | null = null;
    constructor(public s: http.Session = http.shared) { }

    private async fetch(key: string, url: string, folder: string, maxH: number, quality: number): Promise<string | null> {
        if (!url)
            return null;
        const p = path.join(folder, `${safe(key)}.jpg`);
        if (fs.existsSync(p) && fs.statSync(p).size > 0)
            return p;
        return withLock(key, async () => {
            if (fs.existsSync(p) && fs.statSync(p).size > 0)
                return p;
            try {
                const got = await fetchImage(this.s, url, { quick: folder === P.CACHE_THUMBS || folder === P.CACHE_SHOTS });
                if (!got.data.length)
                    return null;
                const data = await convertAsync(got.data, maxH, quality);
                if (!data)
                    return null;
                fs.mkdirSync(folder, { recursive: true });
                const tmp = p.replace(/\.jpg$/, '.tmp');
                fs.writeFileSync(tmp, data);
                fs.renameSync(tmp, p);
                if (folder === P.CACHE_THUMBS) {
                    this.thumbs.add(path.basename(p));
                    if (this.onThumb && key.startsWith('t:')) {
                        try {
                            this.onThumb(key.slice(2));
                        }
                        catch { /* nada */ }
                    }
                }
                return p;
            }
            catch {
                return null;
            }
        });
    }

    thumb(key: string, url: string) {
        return this.fetch('t:' + key, url, P.CACHE_THUMBS, THUMB_H, 78);
    }
    cover(key: string, url: string) {
        return this.fetch('c:' + key, url, P.CACHE_COVERS, COVER_H, 84);
    }
    shot(key: string, i: number, url: string) {
        return this.fetch(`s:${key}:${i}`, url, P.CACHE_SHOTS, SHOT_H, 76);
    }

    async localHero(key: string, src: string): Promise<string | null> {
        const p = path.join(P.CACHE_COVERS, `${safe('hb:' + key)}.jpg`);
        try {
            if (fs.existsSync(p) && fs.statSync(p).mtimeMs >= fs.statSync(src).mtimeMs)
                return p;
            const data = await convertAsync(await fs.promises.readFile(src), COVER_H, 82);
            if (!data)
                return null;
            fs.mkdirSync(path.dirname(p), { recursive: true });
            const tmp = p.replace(/\.jpg$/, '.tmp');
            fs.writeFileSync(tmp, data);
            fs.renameSync(tmp, p);
            return p;
        }
        catch {
            return null;
        }
    }

    async localThumb(key: string, src: string): Promise<string> {
        const p = path.join(P.CACHE_THUMBS, `${safe('t:' + key)}.jpg`);
        try {
            if (fs.existsSync(p) && fs.statSync(p).mtimeMs >= fs.statSync(src).mtimeMs)
                return p;
            const data = await convertAsync(await fs.promises.readFile(src), THUMB_H, 80);
            if (!data)
                return src;
            fs.mkdirSync(path.dirname(p), { recursive: true });
            const tmp = p.replace(/\.jpg$/, '.tmp');
            fs.writeFileSync(tmp, data);
            fs.renameSync(tmp, p);
            this.thumbs.add(path.basename(p));
            return p;
        }
        catch {
            return src;
        }
    }

    hasThumb(key: string): boolean {
        return this.thumbs.get().has(`${safe('t:' + key)}.jpg`);
    }
    cachedThumb(key: string): string | null {
        const p = path.join(P.CACHE_THUMBS, `${safe('t:' + key)}.jpg`);
        return this.hasThumb(key) || fs.existsSync(p) ? p : null;
    }
    invalidate(key: string) {
        for (const f of [path.join(P.CACHE_THUMBS, `${safe('t:' + key)}.jpg`), path.join(P.CACHE_COVERS, `${safe('c:' + key)}.jpg`)])
            fs.rmSync(f, { force: true });
        this.thumbs.discard(`${safe('t:' + key)}.jpg`);
    }
}
