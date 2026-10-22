import * as log from './log';

type Opts = { maxH?: number; maxW?: number; fmt?: 'jpeg' | 'png'; quality?: number };
type Out = { buf: Buffer; w: number; h: number; probe: number[] };

const MAX_IN = 20 * 1024 * 1024;
const IDLE_MS = 45_000;
const PAGE = 'data:text/html;charset=utf-8,' + encodeURIComponent(
    '<!doctype html><title>ludrix-img</title><script>' +
    'window.__lx=async function(b64,maxW,maxH,fmt,q){' +
    'const bin=atob(b64);const u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);' +
    'const bmp=await createImageBitmap(new Blob([u8]));let w=bmp.width,h=bmp.height;' +
    'if(maxH&&h>maxH){w=Math.max(1,Math.round(w*maxH/h));h=maxH;}' +
    'if(maxW&&w>maxW){h=Math.max(1,Math.round(h*maxW/w));w=maxW;}' +
    'const c=new OffscreenCanvas(w,h);const ctx=c.getContext("2d");ctx.imageSmoothingQuality="high";' +
    'if(fmt==="image/jpeg"){ctx.fillStyle="#000";ctx.fillRect(0,0,w,h);}' +
    'ctx.drawImage(bmp,0,0,w,h);bmp.close();' +
    'const px=w>5&&h>5?Array.from(ctx.getImageData(5,5,1,1).data):[0,0,0,0];' +
    'const blob=await c.convertToBlob({type:fmt,quality:q});const a=new Uint8Array(await blob.arrayBuffer());' +
    'let s="";for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode.apply(null,a.subarray(i,i+32768));' +
    'return {w:w,h:h,px:px,b64:btoa(s)};};' +
    '</script>');

let win: any = null;
let ready: Promise<any> | null = null;
let idle: any = null;
let busy = 0;

function electron(): any {
    try {
        return require('electron');
    }
    catch {
        return null;
    }
}

function touch() {
    if (idle)
        clearTimeout(idle);
    idle = setTimeout(() => {
        if (busy > 0) {
            touch();
            return;
        }
        const w = win;
        win = null;
        ready = null;
        try {
            if (w && !w.isDestroyed())
                w.destroy();
        }
        catch { /* nada */ }
    }, IDLE_MS);
}

function getWin(): Promise<any> | null {
    const e = electron();
    if (!e || !e.app || !e.app.isReady())
        return null;
    if (ready)
        return ready;
    ready = new Promise((resolve, reject) => {
        try {
            const w = new e.BrowserWindow({
                show: false, width: 64, height: 64, skipTaskbar: true, focusable: false,
                webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, webgl: false, images: true, devTools: false },
            });
            w.on('closed', () => {
                if (win === w) {
                    win = null;
                    ready = null;
                }
            });
            w.webContents.on('render-process-gone', () => {
                try {
                    w.destroy();
                }
                catch { /* nada */ }
                if (win === w) {
                    win = null;
                    ready = null;
                }
            });
            const t = setTimeout(() => reject(new Error('decodificador não abriu')), 15_000);
            w.webContents.once('did-finish-load', () => {
                clearTimeout(t);
                win = w;
                resolve(w);
            });
            w.webContents.once('did-fail-load', (_e: any, code: number, desc: string) => {
                clearTimeout(t);
                reject(new Error(`decodificador: ${desc || code}`));
            });
            void w.loadURL(PAGE);
        }
        catch (e) {
            reject(e);
        }
    });
    ready.catch(() => {
        ready = null;
        win = null;
    });
    return ready;
}

function syncFallback(data: Buffer, o: Opts): Out | null {
    const e = electron();
    if (!e || !e.nativeImage)
        return null;
    try {
        let img = e.nativeImage.createFromBuffer(data);
        if (img.isEmpty())
            return null;
        let { width, height } = img.getSize();
        let w = width, h = height;
        if (o.maxH && h > o.maxH) {
            w = Math.max(1, Math.round(w * o.maxH / h));
            h = o.maxH;
        }
        if (o.maxW && w > o.maxW) {
            h = Math.max(1, Math.round(h * o.maxW / w));
            w = o.maxW;
        }
        if (w !== width || h !== height)
            img = img.resize({ width: w, height: h, quality: 'good' });
        let probe = [0, 0, 0, 0];
        try {
            const bmp: Buffer = img.toBitmap();
            const i = (5 * w + 5) * 4;
            if (bmp.length > i + 3)
                probe = [bmp[i + 2], bmp[i + 1], bmp[i], bmp[i + 3]];
        }
        catch { /* nada */ }
        const buf = (o.fmt || 'jpeg') === 'png' ? img.toPNG() : img.toJPEG(o.quality ?? 85);
        return { buf, w, h, probe };
    }
    catch {
        return null;
    }
}

export async function decode(data: Buffer, o: Opts = {}): Promise<Out | null> {
    if (!data || !data.length)
        return null;
    const fmt = (o.fmt || 'jpeg') === 'png' ? 'image/png' : 'image/jpeg';
    const q = Math.min(1, Math.max(0.1, (o.quality ?? 85) / 100));
    if (data.length <= MAX_IN) {
        const p = getWin();
        if (p) {
            busy += 1;
            try {
                const w = await p;
                touch();
                const expr = `window.__lx(${JSON.stringify(data.toString('base64'))},${o.maxW || 0},${o.maxH || 0},${JSON.stringify(fmt)},${q})`;
                const r = await Promise.race([
                    w.webContents.executeJavaScript(expr, true),
                    new Promise((_r, rej) => setTimeout(() => rej(new Error('decodificação demorou')), 30_000)),
                ]) as any;
                if (r && r.b64)
                    return { buf: Buffer.from(r.b64, 'base64'), w: r.w, h: r.h, probe: r.px || [0, 0, 0, 0] };
                return null;
            }
            catch (e: any) {
                const msg = String(e?.message || e);
                if (!/decod|InvalidStateError|could not be decoded|source image/i.test(msg))
                    log.debug(`imgdecode: ${msg.slice(0, 160)}`);
                if (/decodificador|demorou|destroyed|Render frame/i.test(msg))
                    return syncFallback(data, o);
                return null;
            }
            finally {
                busy -= 1;
                touch();
            }
        }
    }
    return syncFallback(data, o);
}

export function isErrorProbe(w: number, h: number, probe: number[]): boolean {
    if (w !== 180 || h !== 140)
        return false;
    const [r, g, b] = probe;
    return r > 235 && g < 110 && b < 110;
}

export function shutdown() {
    if (idle)
        clearTimeout(idle);
    const w = win;
    win = null;
    ready = null;
    try {
        if (w && !w.isDestroyed())
            w.destroy();
    }
    catch { /* nada */ }
}
