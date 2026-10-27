import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import AdmZip from 'adm-zip';
import * as P from './paths';
import * as presets from './presets';
import { isErrorImage } from './images';
import { Downloader, safeMember } from './installer';
import { fileRef } from './repos';
import { prog } from './jobs';
import type { Cancel, Progress } from './jobs';

export const FLASH = P.FLASH;
export const RUFFLE = path.join(FLASH, 'ruffle');
export const GAMES = path.join(FLASH, 'games');
export const HTML = path.join(FLASH, 'html');
export const COVERS = path.join(FLASH, 'covers');
export const CUSTOM = path.join(FLASH, 'custom.json');
const SWF_MAGIC = ['FWS', 'CWS', 'ZWS'];
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

type Cb = (p: Progress) => void;

function slug(title: string) {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}
function isDir(p: string) {
    try {
        return fs.statSync(p).isDirectory();
    }
    catch {
        return false;
    }
}
function isFile(p: string) {
    try {
        return fs.statSync(p).isFile();
    }
    catch {
        return false;
    }
}
function rglob(root: string): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
        let ents: fs.Dirent[];
        try {
            ents = fs.readdirSync(d, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of ents) {
            const p = path.join(d, e.name);
            if (e.isDirectory())
                walk(p);
            else if (e.isFile())
                out.push(p);
        }
    };
    walk(root);
    return out;
}
function titleCase(s: string) {
    return s.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}
function qPath(s: string) {
    return encodeURIComponent(s).replace(/%2F/g, '/');
}

export function findEntry(d: string): string | null {
    let best: [[number, number, string], string] | null = null;
    for (const p of rglob(d)) {
        const ext = path.extname(p).toLowerCase();
        if (ext !== '.html' && ext !== '.htm')
            continue;
        const depth = path.relative(d, p).split(path.sep).length;
        const score: [number, number, string] = [depth, path.parse(p).name.toLowerCase() === 'index' ? 0 : 1, path.basename(p).toLowerCase()];
        if (best === null || score[0] < best[0][0] || (score[0] === best[0][0] && (score[1] < best[0][1] || (score[1] === best[0][1] && score[2] < best[0][2]))))
            best = [score, p];
    }
    return best ? best[1] : null;
}

export function swfSize(p: string): [number, number] | null {
    try {
        const raw = fs.readFileSync(p);
        const sig = raw.subarray(0, 3).toString('latin1');
        let body = raw.subarray(8, 8 + 64);
        if (sig === 'CWS') {
            try {
                body = zlib.inflateSync(raw.subarray(8, 8 + 4096), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).subarray(0, 64);
            }
            catch {
                return null;
            }
        }
        else if (sig !== 'FWS')
            return null;
        const nbits = body[0] >> 3;
        let bits = '';
        for (let i = 0; i < 32 && i < body.length; i++)
            bits += body[i].toString(2).padStart(8, '0');
        bits = bits.slice(5);
        const vals = [0, 1, 2, 3].map((i) => parseInt(bits.slice(i * nbits, (i + 1) * nbits), 2));
        const w = Math.floor((vals[1] - vals[0]) / 20), h = Math.floor((vals[3] - vals[2]) / 20);
        return 100 < w && w < 4000 && 100 < h && h < 4000 ? [w, h] : null;
    }
    catch {
        return null;
    }
}

export class FlashManager {
    presets: any;
    onCover: ((gid: string) => void) | null = null;
    private coverQ: string[] = [];
    private coverSeen = new Set<string>();
    private coverWorkers = 0;

    constructor(private store: any, private s: any, private cache: any) {
        this.presets = this.load();
    }

    coverLocal(gid: string): string | null {
        const p = path.join(COVERS, `${gid}.jpg`);
        if (isFile(p))
            return p;
        const g = this.presets.games.find((x: any) => x.id === gid);
        if (!g || !(g.item || String(g.cover || '').startsWith('http')))
            return null;
        if (!this.coverSeen.has(gid)) {
            this.coverSeen.add(gid);
            this.coverQ.push(gid);
        }
        while (this.coverWorkers < Math.min(3, this.coverQ.length)) {
            this.coverWorkers++;
            void this.coverWorker();
        }
        return null;
    }

    private async coverWorker() {
        try {
            while (this.coverQ.length) {
                const gid = this.coverQ.shift() as string;
                try {
                    if (await this.coverPath(gid) && this.onCover)
                        this.onCover(gid);
                }
                catch { }
                this.coverSeen.delete(gid);
            }
        }
        finally {
            this.coverWorkers--;
        }
    }

    load(): any {
        let d: any;
        try {
            d = presets.flash();
            if (!d || typeof d !== 'object')
                throw new Error('x');
            d = { ...d, games: [...(d.games || [])] };
        }
        catch {
            d = { games: [], ruffle_repo: 'ruffle-rs/ruffle' };
        }
        d.games = d.games.map((g: any) => ({ ...g, custom: false }));
        d.games.push(...this.custom());
        for (const g of d.games)
            if (g.type === undefined)
                g.type = 'swf';
        return d;
    }

    custom(): any[] {
        let lst: any[];
        try {
            lst = isFile(CUSTOM) ? JSON.parse(fs.readFileSync(CUSTOM, 'utf8')) : [];
            if (!Array.isArray(lst))
                lst = [];
        }
        catch {
            lst = [];
        }
        for (const g of lst)
            g.custom = true;
        return lst;
    }

    saveCustom(lst: any[]) {
        fs.mkdirSync(FLASH, { recursive: true });
        const clean = lst.map((g) => {
            const o: any = {};
            for (const [k, v] of Object.entries(g))
                if (k !== 'custom')
                    o[k] = v;
            return o;
        });
        fs.writeFileSync(CUSTOM, JSON.stringify(clean, null, 1), 'utf8');
    }

    newCustom(title: string, kind: string, extra: any = {}) {
        const lst = this.custom();
        let gid = 'my-' + (slug(title) || 'jogo');
        if (lst.some((g) => g.id === gid))
            gid += '-' + String(Math.floor(Date.now() / 1000)).slice(-4);
        const g = { id: gid, title, type: kind, item: '', file: '', size: 0, genre: 'Meu jogo', players: '', time: '',
            w: 800, h: 600, controls: '', tip: '', year: '', dev: '', cover: '', desc: '', url: '', ...extra };
        lst.push(g);
        this.saveCustom(lst);
        this.presets = this.load();
        return { ok: true, id: gid, title, type: kind };
    }

    addCustom(file: string, title = '', genre = '', w = 800, h = 600): any {
        file = String(file || '').trim().replace(/^"|"$/g, '');
        title = String(title || '').trim();
        if (/^https?:\/\//i.test(file))
            return this.addWeb(file, title);
        if (!fs.existsSync(file))
            return { error: 'Arquivo ou pasta não encontrado' };
        if (isDir(file))
            return this.addHtmlDir(file, title);
        const ext = path.extname(file).toLowerCase();
        if (ext === '.zip')
            return this.addHtmlZip(file, title);
        if (ext === '.swf') {
            const fd = fs.openSync(file, 'r');
            const head = Buffer.alloc(3);
            fs.readSync(fd, head, 0, 3, 0);
            fs.closeSync(fd);
            if (!SWF_MAGIC.includes(head.toString('latin1')))
                return { error: 'Esse arquivo não é um Flash (.swf) válido' };
            title = title || titleCase(path.parse(file).name.replace(/[_-]+/g, ' ').trim());
            const dims = swfSize(file);
            const r = this.newCustom(title, 'swf', { file: path.basename(file), size: fs.statSync(file).size, genre: genre || 'Meu jogo', w: dims ? dims[0] : w, h: dims ? dims[1] : h, desc: `Adicionado de ${file}` });
            fs.mkdirSync(GAMES, { recursive: true });
            fs.copyFileSync(file, this.gamePath(r.id));
            return r;
        }
        if (ext === '.html' || ext === '.htm')
            return this.addHtmlDir(path.dirname(file), title || path.basename(path.dirname(file)), path.basename(file));
        return { error: 'Aceito .swf (Flash), .zip ou pasta com index.html (HTML5) e links http(s) de jogos de site' };
    }

    addWeb(url: string, title = '') {
        url = String(url || '').trim();
        if (!/^https?:\/\/[^\s]+$/i.test(url))
            return { error: 'Cole o endereço completo do jogo (começando com http:// ou https://)' };
        if (!title)
            title = url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
        return this.newCustom(title, 'web', { url, genre: 'Jogo de site', desc: url });
    }

    addHtmlDir(src: string, title: string, entry = '') {
        const ent = entry ? path.join(src, entry) : findEntry(src);
        if (!ent || !fs.existsSync(ent))
            return { error: 'Nenhum index.html nessa pasta' };
        title = title || titleCase(path.basename(src).replace(/[_-]+/g, ' ').trim());
        const r = this.newCustom(title, 'html5', { desc: `Adicionado de ${src}` });
        const dst = this.htmlDir(r.id);
        fs.rmSync(dst, { recursive: true, force: true });
        fs.cpSync(src, dst, { recursive: true, filter: (p) => { const n = path.basename(p); return n !== '.git' && n !== '__MACOSX' && !n.endsWith('.map'); } });
        const lst = this.custom();
        for (const g of lst)
            if (g.id === r.id)
                g.size = rglob(dst).reduce((a, f) => a + fs.statSync(f).size, 0);
        this.saveCustom(lst);
        this.presets = this.load();
        return r;
    }

    addHtmlZip(src: string, title: string) {
        let z: AdmZip;
        try {
            z = new AdmZip(src);
        }
        catch {
            return { error: 'Esse .zip está danificado' };
        }
        const names = z.getEntries().map((e) => e.entryName);
        if (!names.some((n) => /\.html?$/i.test(n)))
            return { error: 'Esse .zip não tem nenhum .html dentro — pra jogos de Windows use a Biblioteca (Adicionar → Jogo de Windows)' };
        title = title || titleCase(path.parse(src).name.replace(/[_-]+/g, ' ').trim());
        const r = this.newCustom(title, 'html5', { size: fs.statSync(src).size, desc: `Adicionado de ${src}` });
        const dst = this.htmlDir(r.id);
        fs.rmSync(dst, { recursive: true, force: true });
        fs.mkdirSync(dst, { recursive: true });
        this.safeExtractAll(z, dst);
        return r;
    }

    safeExtractAll(z: AdmZip, dst: string) {
        for (const e of z.getEntries()) {
            if (e.isDirectory)
                continue;
            const d = safeMember(dst, e.entryName);
            fs.mkdirSync(path.dirname(d), { recursive: true });
            fs.writeFileSync(d, e.getData());
        }
    }

    updateCustom(gid: string, fields: any) {
        const lst = this.custom();
        const g = lst.find((x) => x.id === gid);
        if (!g)
            return { error: 'Jogo não encontrado' };
        for (const k of ['title', 'genre', 'tip', 'controls', 'w', 'h', 'players', 'time', 'url'])
            if (k in fields && fields[k] !== null && fields[k] !== undefined)
                g[k] = fields[k];
        this.saveCustom(lst);
        this.presets = this.load();
        return { ok: true };
    }

    setCover(gid: string, file: string) {
        fs.mkdirSync(COVERS, { recursive: true });
        let NI: any;
        try {
            NI = require('electron').nativeImage;
        }
        catch {
            return { error: 'Imagem inválida: sem decodificador' };
        }
        let img = NI.createFromPath(String(file || ''));
        if (!img || img.isEmpty())
            return { error: 'Imagem inválida: não foi possível abrir' };
        const { width, height } = img.getSize();
        const k = Math.min(1, 800 / Math.max(width, height));
        if (k < 1)
            img = img.resize({ width: Math.round(width * k), height: Math.round(height * k), quality: 'good' });
        fs.writeFileSync(path.join(COVERS, `${gid}.jpg`), img.toJPEG(86));
        return { ok: true };
    }

    async coverPath(gid: string): Promise<string | null> {
        const p = path.join(COVERS, `${gid}.jpg`);
        if (isFile(p))
            return p;
        const g = this.presets.games.find((x: any) => x.id === gid);
        if (!g || !(g.item || String(g.cover || '').startsWith('http')))
            return null;
        fs.mkdirSync(COVERS, { recursive: true });
        const urls: string[] = [];
        if (String(g.cover || '').startsWith('http'))
            urls.push(g.cover);
        else if (g.cover)
            urls.push(`https://archive.org/download/${g.item}/${qPath(g.cover)}`);
        if (g.item)
            urls.push(`https://archive.org/services/img/${g.item}`);
        let NI: any = null;
        try {
            NI = require('electron').nativeImage;
        }
        catch { }
        for (const u of urls) {
            try {
                const r = await this.s.get(u, { timeout: 20000 });
                if (r.status !== 200)
                    continue;
                const data = Buffer.from(await r.arrayBuffer());
                if (data.length < 2000 || !NI)
                    continue;
                let img = NI.createFromBuffer(data);
                if (img.isEmpty() || img.getSize().width < 120 || isErrorImage(img))
                    continue;
                const { width, height } = img.getSize();
                const k = Math.min(1, 800 / Math.max(width, height));
                if (k < 1)
                    img = img.resize({ width: Math.round(width * k), height: Math.round(height * k), quality: 'good' });
                fs.writeFileSync(p, img.toJPEG(86));
                return p;
            }
            catch {
                continue;
            }
        }
        return null;
    }

    ruffleReady() {
        return isFile(path.join(RUFFLE, 'ruffle.js'));
    }
    gamePath(gid: string) {
        return path.join(GAMES, `${gid}.swf`);
    }
    htmlDir(gid: string) {
        if (!ID_RE.test(gid || ''))
            throw new Error('id inválido');
        return path.join(HTML, gid);
    }
    entryUrl(gid: string): string | null {
        const d = path.join(HTML, gid);
        const ent = isDir(d) ? findEntry(d) : null;
        return ent ? `/flash/html/${gid}/${path.relative(d, ent).split(path.sep).join('/')}` : null;
    }
    isInstalled(g: any, have: Set<string> | null = null): boolean {
        const t = g.type || 'swf';
        if (t === 'web')
            return Boolean(g.url);
        if (t === 'html5')
            return isDir(path.join(HTML, g.id)) && findEntry(path.join(HTML, g.id)) !== null;
        return have !== null ? have.has(`${g.id}.swf`) : isFile(this.gamePath(g.id));
    }

    status() {
        const scores = this.store.config.flash_stats || {};
        const games: any[] = [];
        let have = new Set<string>();
        try {
            have = new Set(fs.readdirSync(GAMES));
        }
        catch { }
        let covers = new Set<string>();
        try {
            covers = new Set(fs.readdirSync(COVERS).map((x) => path.parse(x).name));
        }
        catch { }
        for (const g of this.presets.games) {
            const st = scores[g.id] || {};
            games.push({ ...g, installed: this.isInstalled(g, have), plays: st.plays || 0, last: st.last || 0, fav: Boolean(st.fav),
                has_cover: covers.has(g.id) || Boolean(g.item) || String(g.cover || '').startsWith('http') });
        }
        return { ruffle: this.ruffleReady(), games, dir: FLASH };
    }

    removeCustom(gid: string) {
        this.saveCustom(this.custom().filter((g) => g.id !== gid));
        fs.rmSync(this.gamePath(gid), { force: true });
        if (ID_RE.test(gid || ''))
            fs.rmSync(path.join(HTML, gid), { recursive: true, force: true });
        fs.rmSync(path.join(COVERS, `${gid}.jpg`), { force: true });
        this.presets = this.load();
        return { ok: true };
    }

    toggleFav(gid: string) {
        const st = { ...(this.store.config.flash_stats || {}) };
        const cur = { ...(st[gid] || {}) };
        cur.fav = !cur.fav;
        st[gid] = cur;
        this.store.setConfig({ flash_stats: st });
        return { ok: true, fav: cur.fav };
    }

    async prefetchCovers() {
        for (const g of this.presets.games) {
            if (g.item && !isFile(path.join(COVERS, `${g.id}.jpg`))) {
                try {
                    await this.coverPath(g.id);
                }
                catch { }
            }
        }
    }

    async installRuffle(cb: Cb, cancel: Cancel): Promise<string> {
        const repo = this.presets.ruffle_repo || 'ruffle-rs/ruffle';
        let rels = await this.cache.getJson(`gh_${repo}`, `https://api.github.com/repos/${repo}/releases?per_page=3`, 6 * 3600);
        rels = Array.isArray(rels) ? rels.filter((r: any) => !r.draft) : [];
        let asset: any = null;
        for (const r of rels) {
            asset = (r.assets || []).find((a: any) => String(a.name).endsWith('web-selfhosted.zip')) || null;
            if (asset)
                break;
        }
        if (!asset)
            throw new Error("Pacote não encontrado: 'web-selfhosted' do Ruffle no GitHub");
        const tmp = path.join(P.DOWNLOADS, 'ruffle.zip');
        fs.mkdirSync(path.dirname(tmp), { recursive: true });
        cb(prog('download', 0, 'Baixando o Ruffle (player de Flash)…'));
        await new Downloader(this.s).download(fileRef(asset.name, asset.browser_download_url, Number(asset.size || 0)) as any, tmp, cb, cancel);
        cb(prog('extract', 0, 'Extraindo…'));
        fs.rmSync(RUFFLE, { recursive: true, force: true });
        fs.mkdirSync(RUFFLE, { recursive: true });
        const z = new AdmZip(tmp);
        for (const e of z.getEntries()) {
            const n = e.entryName;
            if (!n.endsWith('.map') && !n.endsWith('/')) {
                const d = safeMember(RUFFLE, n);
                fs.mkdirSync(path.dirname(d), { recursive: true });
                fs.writeFileSync(d, e.getData());
            }
        }
        fs.rmSync(tmp, { force: true });
        fs.writeFileSync(path.join(RUFFLE, 'version.txt'), asset.name, 'utf8');
        return RUFFLE;
    }

    async installGame(gid: string, cb: Cb, cancel: Cancel): Promise<string> {
        const g = this.presets.games.find((x: any) => x.id === gid);
        if (!g)
            throw new Error('Jogo desconhecido');
        if (g.type === 'web')
            return FLASH;
        const url = String(g.url || '').startsWith('http') ? g.url : (g.item ? `https://archive.org/download/${g.item}/${qPath(g.file)}` : '');
        if (!url)
            throw new Error('Jogo próprio: o arquivo já deveria estar em flash/');
        cb(prog('download', 0, `Baixando ${g.title}…`));
        if (g.type === 'html5') {
            const dst = this.htmlDir(gid);
            const tmp = path.join(P.DOWNLOADS, `${gid}.zip`);
            fs.mkdirSync(path.dirname(tmp), { recursive: true });
            await new Downloader(this.s).download(fileRef(g.file || `${gid}.zip`, url, Number(g.size || 0)) as any, tmp, cb, cancel);
            cb(prog('extract', 0, 'Extraindo…'));
            fs.rmSync(dst, { recursive: true, force: true });
            fs.mkdirSync(dst, { recursive: true });
            try {
                this.safeExtractAll(new AdmZip(tmp), dst);
            }
            catch {
                fs.rmSync(dst, { recursive: true, force: true });
                throw new Error('O arquivo baixado não é um .zip válido');
            }
            finally {
                fs.rmSync(tmp, { force: true });
            }
            if (!findEntry(dst)) {
                fs.rmSync(dst, { recursive: true, force: true });
                throw new Error('O pacote não tem um index.html');
            }
            return dst;
        }
        fs.mkdirSync(GAMES, { recursive: true });
        const dest = this.gamePath(gid);
        await new Downloader(this.s).download(fileRef(g.file, url, 0) as any, dest, cb, cancel);
        const head = Buffer.alloc(3);
        const fd = fs.openSync(dest, 'r');
        fs.readSync(fd, head, 0, 3, 0);
        fs.closeSync(fd);
        if (fs.statSync(dest).size < 10_000 || !SWF_MAGIC.includes(head.toString('latin1'))) {
            fs.rmSync(dest, { force: true });
            throw new Error('O arquivo baixado não é um .swf válido');
        }
        return dest;
    }

    async installAllMissing(cb: Cb, cancel: Cancel) {
        let n = 0;
        if (!this.ruffleReady())
            await this.installRuffle(cb, cancel);
        for (const g of this.presets.games) {
            if (cancel.aborted)
                break;
            if ((g.type || 'swf') !== 'web' && !this.isInstalled(g)) {
                try {
                    await this.installGame(g.id, cb, cancel);
                    n += 1;
                }
                catch {
                    continue;
                }
            }
        }
        return { count: n };
    }

    removeGame(gid: string) {
        fs.rmSync(this.gamePath(gid), { force: true });
        if (ID_RE.test(gid || ''))
            fs.rmSync(path.join(HTML, gid), { recursive: true, force: true });
    }

    markPlay(gid: string) {
        const st = { ...(this.store.config.flash_stats || {}) };
        const cur = { ...(st[gid] || {}) };
        cur.plays = (cur.plays || 0) + 1;
        cur.last = Date.now() / 1000;
        st[gid] = cur;
        this.store.setConfig({ flash_stats: st });
    }

    playerHtml(gid: string, sandboxBase = ''): string {
        const g = this.presets.games.find((x: any) => x.id === gid);
        if (!g || !this.isInstalled(g))
            return "<h2 style='font-family:sans-serif;color:#ccc;background:#111;margin:0;padding:30px'>Jogo não instalado</h2>";
        const title = String(g.title).replace(/[<>&]/g, '');
        if (g.type === 'html5') {
            const src = sandboxBase + (this.entryUrl(gid) || '').replace(/^\/flash/, '');
            return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>html,body{margin:0;height:100%;background:#0b0d12;overflow:hidden}iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#0b0d12}</style></head>
<body><iframe src="${src}" sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms" allow="autoplay; fullscreen; gamepad" referrerpolicy="no-referrer"></iframe>
<script>document.addEventListener("keydown",e=>{if(e.key==="Escape")parent.postMessage("flash:close","*")});</script></body></html>`;
        }
        return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>html,body{margin:0;height:100%;background:#0b0d12;overflow:hidden}
#wrap{position:absolute;inset:0;display:grid;place-items:center}
ruffle-player{width:min(100vw,calc(100vh*${g.w}/${g.h}));height:min(100vh,calc(100vw*${g.h}/${g.w}));display:block;outline:0}
</style></head><body><div id="wrap"><div id="p"></div></div>
<script src="/flash/ruffle/ruffle.js"></script>
<script>
window.RufflePlayer=window.RufflePlayer||{};
window.RufflePlayer.config={autoplay:"on",unmuteOverlay:"hidden",letterbox:"on",backgroundColor:"#0b0d12",warnOnUnsupportedContent:false,showSwfDownload:false,quality:"high",contextMenu:"off",splashScreen:false,allowScriptAccess:false,logLevel:"error",scale:"showAll",base:"/flash/games/"};
window.addEventListener("DOMContentLoaded",()=>{const r=window.RufflePlayer.newest();const p=r.createPlayer();document.getElementById("p").appendChild(p);p.ruffle().load("/flash/games/${gid}.swf").catch(e=>{document.body.innerHTML="<p style='color:#eee;font-family:sans-serif;padding:20px'>Não carregou: "+e+"</p>"});
document.addEventListener("keydown",e=>{if(e.key==="Escape")parent.postMessage("flash:close","*")});});
</script></body></html>`;
    }
}
