/**
 * hosts.ts — porte de app/core/hosts.py.
 *
 * Transforma um link de hospedeiro (MEGA, Google Drive, MediaFire, Pixeldrain,
 * Gofile, 1fichier, Dropbox, buzzheavier, qiwi, itch.io) em um link direto de
 * download. A criptografia do MEGA (AES-128-CTR com contador de 8 bytes)
 * usa o `node:crypto` nativo, no lugar do pycryptodomex.
 */
import crypto from 'node:crypto';
import * as http from './http';
import * as log from './log';
class HostError extends Error {
    constructor(message) {
        super(message);
        this.name = 'HostError';
    }
}
/* ------------------------------ utilidades ------------------------------ */
function b64urlDecode(s) {
    const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(t + '='.repeat((4 - (t.length % 4)) % 4), 'base64');
}
function a32(b) {
    const out = [];
    for (let i = 0; i + 4 <= b.length; i += 4)
        out.push(b.readUInt32BE(i));
    return out;
}
/* -------------------------------- MEGA -------------------------------- */
const MEGA_API = 'https://g.api.mega.co.nz/cs';
function megaKeys(key) {
    if (key.length >= 8) {
        const k = [key[0] ^ key[4], key[1] ^ key[5], key[2] ^ key[6], key[3] ^ key[7]];
        const iv = Buffer.alloc(8);
        iv.writeUInt32BE(key[4] >>> 0, 0);
        iv.writeUInt32BE(key[5] >>> 0, 4);
        return { aes: Buffer.from(Uint8Array.from(k, (v) => v >>> 0)), iv };
    }
    return { aes: Buffer.alloc(16), iv: Buffer.alloc(8) };
}
function megaAttr(attrB64, aesKey) {
    try {
        const raw = b64urlDecode(attrB64);
        if (raw.length % 16)
            return {};
        const d = crypto.createDecipheriv('aes-128-cbc', aesKey, Buffer.alloc(16));
        d.setAutoPadding(false);
        const out = Buffer.concat([d.update(raw), d.final()]);
        let end = out.length;
        while (end > 0 && out[end - 1] === 0)
            end--;
        const text = out.subarray(0, end);
        if (!text.subarray(0, 4).equals(Buffer.from('MEGA')))
            return {};
        return JSON.parse(text.subarray(4).toString('utf8'));
    }
    catch {
        return {};
    }
}
/**
 * Descriptador AES-128-CTR do MEGA. O vetor de contador e
 * `iv8 || contador de bloco (64 bits, big-endian)` — exatamente como o
 * `Counter.new(64, prefix=iv8, initial_value=offset // 16)` do Python.
 */
function megaDecryptor(aesKey, iv8) {
    return (chunk, offset) => {
        if (!chunk.length)
            return chunk;
        const startBlock = Math.floor(offset / 16);
        const skip = offset % 16;
        const iv = Buffer.concat([iv8, Buffer.alloc(8)]);
        iv.writeBigUInt64BE(BigInt(startBlock), 8);
        const d = crypto.createDecipheriv('aes-128-ctr', aesKey, iv);
        d.setAutoPadding(false);
        if (skip)
            d.update(Buffer.alloc(skip));
        return Buffer.concat([d.update(chunk), d.final()]);
    };
}
async function megaApi(s, req, extra: any = {}) {
    const params = new URLSearchParams({ id: String(Date.now() % 1_000_000), ...extra });
    for (let i = 0; i < 4; i++) {
        const r = await s.post(`${MEGA_API}?${params.toString()}`, JSON.stringify([req]), {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30_000,
        });
        let j = null;
        try {
            j = await r.json();
        }
        catch {
            j = null;
        }
        if (Array.isArray(j) && j.length) {
            const res = j[0];
            if (typeof res === 'number' && res === -3) {
                await new Promise((r2) => setTimeout(r2, 1000 * (i + 1)));
                continue;
            }
            return res;
        }
        await new Promise((r2) => setTimeout(r2, 1000 * (i + 1)));
    }
    throw new HostError('MEGA nao respondeu');
}
const MEGA_ERR = {
    [-9]: 'MEGA: arquivo nao existe mais',
    [-16]: 'MEGA: arquivo bloqueado',
    [-18]: 'MEGA: arquivo temporariamente indisponivel',
};
async function megaList(url, s = http.shared) {
    let u = url.replace('#!', '/file/').replace('#F!', '/folder/');
    u = u.replace(/\/file\/([^!#/]+)!/, '/file/$1#').replace(/\/folder\/([^!#/]+)!/, '/folder/$1#');
    const m = /mega(?:\.co)?\.nz\/(file|folder)\/([A-Za-z0-9_-]+)#([A-Za-z0-9_-]+)(?:\/file\/([A-Za-z0-9_-]+))?/.exec(u);
    if (!m)
        throw new HostError('Link do MEGA sem a chave (precisa ser o link completo, com a parte depois do #)');
    const [, kind, hid, keyb64, sub] = m;
    if (kind === 'file') {
        const res = await megaApi(s, { a: 'g', g: 1, p: hid });
        if (typeof res === 'number')
            throw new HostError(MEGA_ERR[res] || `MEGA erro ${res}`);
        const key = a32(b64urlDecode(keyb64));
        const { aes, iv } = megaKeys(key);
        const at = megaAttr(String(res.at || ''), aes);
        return [{
                url: String(res.g),
                name: at.n || hid,
                size: Number(res.s || 0),
                decrypt: megaDecryptor(aes, iv),
                host: 'MEGA',
            }];
    }
    const fkey = Buffer.alloc(16);
    const parts = a32(b64urlDecode(keyb64)).slice(0, 4);
    parts.forEach((v, i) => fkey.writeUInt32BE(v >>> 0, i * 4));
    const tree = await megaApi(s, { a: 'f', c: 1, r: 1, ca: 1 }, { n: hid });
    if (typeof tree === 'number')
        throw new HostError('MEGA: pasta nao existe mais ou e privada');
    const out = [];
    for (const node of (tree.f || [])) {
        if (node.t !== 0)
            continue;
        if (sub && node.h !== sub)
            continue;
        const k = String(node.k || '');
        if (!k.includes(':'))
            continue;
        let dec;
        try {
            const d = crypto.createDecipheriv('aes-128-ecb', fkey, Buffer.alloc(0));
            d.setAutoPadding(false);
            dec = Buffer.concat([d.update(b64urlDecode(k.split(':')[1])), d.final()]);
        }
        catch {
            continue;
        }
        const key = a32(dec);
        const { aes, iv } = megaKeys(key);
        const at = megaAttr(String(node.a || node.at || ''), aes);
        out.push({
            url: '',
            name: at.n || node.h,
            size: Number(node.s || 0),
            decrypt: megaDecryptor(aes, iv),
            host: 'MEGA',
            note: JSON.stringify({ n: hid, h: node.h }),
        });
    }
    if (!out.length)
        throw new HostError('MEGA: nenhum arquivo nessa pasta');
    return out;
}
/** Pastas do MEGA nao dao link direto: e preciso pedir um por arquivo. */
async function megaFolderLink(res, s = http.shared) {
    const info = JSON.parse(res.note || '{}');
    const g = await megaApi(s, { a: 'g', g: 1, n: info.h }, { n: info.n });
    if (typeof g === 'number' || !g.g)
        throw new HostError('MEGA nao liberou o link desse arquivo (cota de transferencia?)');
    return String(g.g);
}
/* ----------------------------- Google Drive ----------------------------- */
const GD_ID_RE = /(?:\/file\/d\/|\/uc\?[^#]*id=|\/open\?[^#]*id=|\/d\/|[?&]id=)([A-Za-z0-9_-]{20,})/;
async function gdrive(url, s) {
    const m = GD_ID_RE.exec(url);
    if (!m)
        throw new HostError('Link do Google Drive sem id de arquivo (pastas nao sao suportadas)');
    const fid = m[1];
    const r = await s.request(`https://drive.google.com/uc?export=download&id=${fid}`, { timeout: 60_000 });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html')) {
        const name = (0, http.fileNameFromHeaders)(r.headers.get('content-disposition'), r.url, fid);
        return { url: r.url, name, size: Number(r.headers.get('content-length') || 0), host: 'Google Drive' };
    }
    const page = await r.text();
    const form = /<form[^>]+action="([^"]+)"([\s\S]*?)<\/form>/.exec(page);
    if (form && form[1].includes('download')) {
        const params = {};
        const re = /name="(\w+)"\s+value="([^"]*)"/g;
        let mm;
        while ((mm = re.exec(form[2])))
            params[mm[1]] = mm[2];
        const nm = /<span class="uc-name-size"><a[^>]*>([^<]+)<\/a>\s*\(([^)]+)\)/.exec(page);
        const qs = new URLSearchParams(params).toString();
        const target = `${(0, http.decodeHtmlEntities)(form[1])}${qs ? '?' + qs : ''}`;
        const r2 = await s.request(target, { timeout: 60_000 });
        if ((r2.headers.get('content-type') || '').includes('text/html')) {
            throw new HostError('O Google Drive nao liberou o arquivo (cota excedida ou pede login)');
        }
        const name = (0, http.fileNameFromHeaders)(r2.headers.get('content-disposition'), r2.url, nm?.[1] || fid);
        const size = Number(r2.headers.get('content-length') || 0) || (nm ? (0, http.numSize)(nm[2]) : 0);
        return { url: r2.url, name, size, host: 'Google Drive' };
    }
    if (/quota/i.test(page))
        throw new HostError('Google Drive: cota de download excedida — tente mais tarde');
    if (/accounts\.google\.com|Sign in/.test(page))
        throw new HostError('Google Drive: o arquivo nao e publico (pede login)');
    throw new HostError('Google Drive: nao achei o link de download nessa pagina');
}
/* -------------------------------- Gofile -------------------------------- */
const GOFILE_SALT = '12af056dacea0b';
let gofileTok = null;
async function gofileToken(s) {
    if (gofileTok && Date.now() - gofileTok.at < 6 * 3600_000)
        return gofileTok.t;
    for (let i = 0; i < 3; i++) {
        const r = await s.request('https://api.gofile.io/accounts', { method: 'POST', timeout: 20_000 });
        const j = await r.json().catch(() => ({}));
        const tok = j?.data?.token;
        if (tok) {
            gofileTok = { t: tok, at: Date.now() };
            return tok;
        }
        if (j?.status === 'error-rateLimit') {
            await new Promise((r2) => setTimeout(r2, 4000 + i * 4000));
            continue;
        }
        break;
    }
    throw new HostError('Gofile nao deu um token de convidado — tente de novo em 1 minuto');
}
async function gofileWt(tok, off = 0) {
    const w = Math.floor(Date.now() / 1000 / 14400) + off;
    return crypto.createHash('sha256').update(`${http.UA}::en-US::${tok}::${w}::${GOFILE_SALT}`).digest('hex');
}
async function gofileList(url, s = http.shared) {
    const m = /gofile\.io\/(?:d|f)\/([A-Za-z0-9]+)/.exec(url);
    if (!m)
        throw new HostError('Link do Gofile invalido (esperava gofile.io/d/<codigo>)');
    const code = m[1];
    const tok = await gofileToken(s);
    const params = new URLSearchParams({
        contentFilter: '', page: '1', pageSize: '1000', sortField: 'createTime', sortDirection: '-1',
    });
    const pw = new URL(url, 'https://x').searchParams.get('password');
    if (pw)
        params.set('password', crypto.createHash('sha256').update(pw).digest('hex'));
    let data = null;
    for (const off of [0, -1]) {
        const r = await s.request(`https://api.gofile.io/contents/${code}?${params.toString()}`, {
            timeout: 30_000,
            headers: { Authorization: `Bearer ${tok}`, 'X-Website-Token': await gofileWt(tok, off), 'X-BL': 'en-US' },
        });
        const j = await r.json().catch(() => ({}));
        const st = j?.status;
        if (st === 'ok') {
            data = j.data;
            break;
        }
        if (st === 'error-rateLimit') {
            await new Promise((r2) => setTimeout(r2, 5000));
            continue;
        }
        if (st === 'error-passwordRequired') {
            throw new HostError('Essa pasta do Gofile pede senha — adicione ?password=SENHA ao final do link');
        }
        if (st === 'error-notFound' || st === 'error-notPublic') {
            throw new HostError('Gofile: arquivo removido, expirado ou nao publico');
        }
    }
    if (!data)
        throw new HostError('Gofile recusou o acesso — abra no navegador');
    const items = data.type === 'folder' ? Object.values(data.children || {}) : [data];
    const out = [];
    for (const it of items) {
        if (it?.type !== 'file' || !it.link)
            continue;
        out.push({
            url: it.link,
            name: it.name || code,
            size: Number(it.size || 0),
            cookies: { accountToken: tok },
            headers: { 'User-Agent': http.UA },
            host: 'Gofile',
        });
    }
    if (!out.length)
        throw new HostError('Gofile: a pasta esta vazia (ou so tem subpastas)');
    return out;
}
/* ------------------------------- MediaFire ------------------------------- */
async function mediafire(url, s) {
    const r = await s.request(url, { timeout: 60_000 });
    const t = await r.text();
    if (r.status === 404 || /File Removed|Permission Denied/.test(t)) {
        throw new HostError('MediaFire: arquivo removido ou privado');
    }
    let link = (/href="(https:\/\/download\d+\.mediafire\.com\/[^"]+)"/.exec(t) || [])[1];
    if (!link) {
        const sc = (/data-scrambled-url="([^"]+)"/.exec(t) || [])[1];
        if (sc) {
            try {
                link = Buffer.from(sc, 'base64').toString('utf8');
            }
            catch {
                link = '';
            }
        }
    }
    if (!link)
        throw new HostError('MediaFire: nao achei o botao de download (captcha ou pagina mudou)');
    const name = (/<div class="filename">([^<]+)/.exec(t) || [])[1];
    const size = (/\(([\d.,]+\s*[KMGT]?B)\)/.exec(t) || [])[1];
    return {
        url: (0, http.decodeHtmlEntities)(link),
        name: name ? (0, http.decodeHtmlEntities)(name).trim() : 'arquivo',
        size: size ? (0, http.numSize)(size) : 0,
        host: 'MediaFire',
    };
}
/* ------------------------------ Pixeldrain ------------------------------ */
async function pixeldrain(url, s) {
    const m = /pixeldrain\.com\/(u|l|api\/file)\/([A-Za-z0-9]+)/.exec(url);
    if (!m)
        throw new HostError('Link do Pixeldrain invalido');
    const [, kind, pid] = m;
    if (kind === 'l') {
        const j = await s.getJson(`https://pixeldrain.com/api/list/${pid}`, { timeout: 30_000 });
        const files = j?.files || [];
        if (!files.length)
            throw new HostError('Pixeldrain: lista vazia ou removida');
        return files.map((f) => ({
            url: `https://pixeldrain.com/api/file/${f.id}?download`,
            name: f.name || f.id,
            size: Number(f.size || 0),
            host: 'Pixeldrain',
        }));
    }
    const j = await s.getJson(`https://pixeldrain.com/api/file/${pid}/info`, { timeout: 30_000 });
    if (j?.success === false && j?.value)
        throw new HostError('Pixeldrain: arquivo nao encontrado');
    return [{
            url: `https://pixeldrain.com/api/file/${pid}?download`,
            name: j?.name || pid,
            size: Number(j?.size || 0),
            host: 'Pixeldrain',
        }];
}
/* ------------------------------- 1fichier ------------------------------- */
async function fichier(url, s) {
    const r = await s.request(url, { timeout: 60_000 });
    const t = await r.text();
    if (/Le fichier demandé n'existe pas|The requested file could not be found/.test(t)) {
        throw new HostError('1fichier: arquivo nao existe mais');
    }
    const adz = (/name="adz"\s+value="([^"]+)"/.exec(t) || [])[1];
    if (!adz)
        throw new HostError('1fichier: pagina sem o formulario de download (pede espera/premium)');
    const r2 = await s.post(url, new URLSearchParams({ submit: 'Download', adz }), { timeout: 60_000 });
    const t2 = await r2.text();
    const link = (/href="(https:\/\/[^"]*1fichier\.com\/[^"]+)"[^>]*>\s*Click here to download/.exec(t2)
        || /<a[^>]+href="(https:\/\/[a-z0-9-]+\.1fichier\.com\/[^"]+)"/.exec(t2) || [])[1];
    if (!link) {
        const wait = (/You must wait (\d+) minutes/.exec(t2) || [])[1];
        throw new HostError(wait
            ? `1fichier pede espera de ${wait} min entre downloads gratis`
            : '1fichier nao liberou o link (limite gratis) — abra no navegador');
    }
    const name = (/<td class="normal">([^<]+\.\w{2,4})<\/td>/.exec(t) || [])[1];
    const size = (/<td class="normal">([\d.,]+\s*[KMG]B)<\/td>/.exec(t) || [])[1];
    return {
        url: link,
        name: name ? (0, http.decodeHtmlEntities)(name).trim() : 'arquivo',
        size: size ? (0, http.numSize)(size) : 0,
        host: '1fichier',
    };
}
/* ------------------------- Dropbox / buzzheavier ------------------------- */
function dropbox(url, s) {
    const u = url.replace(/[?&]dl=\d/, '');
    return direct(u + (u.includes('?') ? '&' : '?') + 'dl=1', s, 'Dropbox');
}
async function buzzheavier(url, s) {
    const m = /buzzheavier\.com\/([A-Za-z0-9]+)/.exec(url);
    if (!m)
        throw new HostError('Link do buzzheavier invalido');
    const r = await s.request(`https://buzzheavier.com/${m[1]}/download`, {
        timeout: 30_000, redirect: 'manual', headers: { 'HX-Request': 'true', Referer: url },
    });
    let loc = r.headers.get('HX-Redirect') || r.headers.get('location') || '';
    if (!loc)
        throw new HostError('buzzheavier nao deu o link');
    if (loc.startsWith('/'))
        loc = 'https://buzzheavier.com' + loc;
    return direct(loc, s, 'buzzheavier');
}
async function qiwi(url, s) {
    const m = /qiwi\.gg\/(?:file|folder)\/([A-Za-z0-9]+)/.exec(url);
    if (!m)
        throw new HostError('Link do qiwi invalido');
    const r = await s.request(url, { timeout: 30_000 });
    const t = await r.text();
    const title = (/<title>([^<]+)<\/title>/.exec(t) || [])[1] || '';
    const ext = (/\.(\w{2,4})\s*[-|]/.exec(title) || [])[1];
    const fn = title ? title.split(' - ')[0].trim() : m[1];
    return direct(`https://spyderrock.com/${m[1]}.${ext || 'zip'}`, s, 'qiwi', fn);
}
/* -------------------------------- itch.io -------------------------------- */
const ITCH_RE = /^https?:\/\/([a-z0-9-]+)\.itch\.io\/([a-z0-9-]+)/i;
const ITCH_OS = { windows8: 'windows', apple: 'mac', tux: 'linux', android: 'android' };
async function itchList(url, s = http.shared) {
    const m = ITCH_RE.exec(url);
    if (!m)
        throw new HostError('itch.io: link precisa ser a pagina do jogo (usuario.itch.io/jogo)');
    const base = `https://${m[1]}.itch.io/${m[2]}`;
    const want = (/(?:[#?&]upload=|#)(\d+)/.exec(url) || [])[1];
    const plat = ((/(?:[#?&]os=(windows|mac|linux|android))/i.exec(url) || [])[1] || '').toLowerCase();
    const r = await s.request(base, { timeout: 60_000 });
    if (r.status === 404)
        throw new HostError('itch.io: pagina nao encontrada');
    let csrf = s.getCookie(base, 'itchio_token');
    if (!csrf) {
        const setCookie = r.headers.get('set-cookie') || '';
        const cm = /itchio_token=([^;]+)/.exec(setCookie);
        if (cm)
            csrf = cm[1];
    }
    if (!csrf)
        throw new HostError('itch.io: o site nao devolveu o token da pagina');
    const r2 = await s.post(`${base}/download_url`, new URLSearchParams({ csrf_token: csrf }), { timeout: 60_000 });
    const j = await r2.json().catch(() => ({}));
    if (!j?.url) {
        throw new HostError(r2.status === 400 || r2.status === 403
            ? 'itch.io: esse jogo nao libera download gratuito'
            : `itch.io respondeu HTTP ${r2.status}`);
    }
    const page = await s.getText(j.url, { timeout: 60_000 });
    const out = [];
    for (const blk of page.split('<div class="upload">').slice(1)) {
        const uid = (/data-upload_id="(\d+)"/.exec(blk) || [])[1];
        if (!uid)
            continue;
        const name = (/<strong title="([^"]*)" class="name"/.exec(blk) || [])[1];
        const size = (/class="file_size"><span>([^<]+)/.exec(blk) || [])[1];
        const icons = [...blk.matchAll(/icon-(windows8|apple|tux|android)/g)].map((x) => x[1]);
        const ver = (/version_name">([^<]+)/.exec(blk) || [])[1];
        const oses = icons.map((i) => ITCH_OS[i]).filter(Boolean);
        out.push({
            url: `${base}/file/${uid}?source=game_download`,
            name: name ? (0, http.decodeHtmlEntities)(name).trim() : `upload ${uid}`,
            size: size ? (0, http.numSize)(size) : 0,
            headers: { 'X-Itch-Csrf': csrf },
            host: 'itch.io',
            lazy: true,
            note: oses.join(' ') + (ver ? ' · ' + ver.trim() : ''),
        });
    }
    if (!out.length)
        throw new HostError('itch.io: nao achei arquivos nessa pagina');
    if (want) {
        const pick = out.filter((o) => o.url.split('/file/')[1]?.split('?')[0] === want);
        if (pick.length)
            return pick;
    }
    if (plat) {
        const pick = out.filter((o) => (o.note || '').includes(plat));
        if (pick.length)
            return pick;
    }
    if (out.length > 1 && !want) {
        const win = out.filter((o) => (o.note || '').includes('windows'));
        if (win.length)
            return win;
    }
    return out;
}
/** O link do itch.io e temporario: e preciso troca-lo por um definitivo. */
async function itchFinal(res, s = http.shared) {
    const csrf = (res.headers || {})['X-Itch-Csrf'] || '';
    const r = await s.post(res.url, new URLSearchParams({ csrf_token: csrf }), { timeout: 60_000 });
    const j = await r.json().catch(() => ({}));
    if (!j?.url)
        throw new HostError(`itch.io nao liberou o arquivo (HTTP ${r.status})`);
    const fin: any = await direct(j.url, s, 'itch.io', res.name);
    fin.note = res.note;
    return fin;
}
/* ------------------------------- diretos ------------------------------- */
async function direct(url, s = http.shared, host = '', name = '') {
    const r = await s.request(url, { timeout: 60_000 });
    const ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (r.status >= 400)
        throw new HostError(`O servidor respondeu HTTP ${r.status}`);
    if (ct === 'text/html' || ct === 'application/xhtml+xml') {
        throw new HostError('Esse link abre uma pagina, nao um arquivo — o Ludrix nao conhece esse site');
    }
    return {
        url: r.url || url,
        name: (0, http.fileNameFromHeaders)(r.headers.get('content-disposition'), r.url || url, name || 'arquivo'),
        size: Number(r.headers.get('content-length') || 0),
        host: host || (0, http.hostOf)(url),
    };
}
/* ------------------------------- fachada ------------------------------- */
const KNOWN = [
    ['drive.google.com', 'Google Drive'], ['docs.google.com', 'Google Drive'],
    ['gofile.io', 'Gofile'], ['mega.nz', 'MEGA'], ['mega.co.nz', 'MEGA'],
    ['mediafire.com', 'MediaFire'], ['pixeldrain.com', 'Pixeldrain'], ['1fichier.com', '1fichier'],
    ['dropbox.com', 'Dropbox'], ['buzzheavier.com', 'buzzheavier'], ['qiwi.gg', 'qiwi'],
    ['files.catbox.moe', 'catbox'], ['itch.io', 'itch.io'],
];
function knownHost(url) {
    const h = (0, http.hostOf)(url);
    for (const [dom, name] of KNOWN)
        if (h === dom || h.endsWith('.' + dom))
            return name;
    return '';
}
function isTorrentUrl(url) {
    return url.startsWith('magnet:') || /\.torrent(\?|$)/i.test(url);
}
/** Resolve um link (ou lista de links) em downloads diretos. */
async function resolve(url, s = http.shared, depth = 0) {
    const u = String(url || '').trim();
    if (!/^https?:\/\//i.test(u))
        throw new HostError('Isso nao e um link http(s)');
    const h = (0, http.hostOf)(u);
    await http.assertPublicHost(h).catch(() => {
        throw new HostError(`Host bloqueado por segurança: ${h}`);
    });
    try {
        if (h.endsWith('google.com'))
            return [await gdrive(u, s)];
        if (h.endsWith('gofile.io'))
            return await gofileList(u, s);
        if (h.endsWith('mega.nz') || h.endsWith('mega.co.nz'))
            return await megaList(u, s);
        if (h.endsWith('mediafire.com'))
            return [await mediafire(u, s)];
        if (h.endsWith('pixeldrain.com'))
            return await pixeldrain(u, s);
        if (h.endsWith('1fichier.com'))
            return [await fichier(u, s)];
        if (h.endsWith('dropbox.com'))
            return [await dropbox(u, s)];
        if (h.endsWith('buzzheavier.com'))
            return [await buzzheavier(u, s)];
        if (h.endsWith('qiwi.gg'))
            return [await qiwi(u, s)];
        if (h.endsWith('.itch.io'))
            return await itchList(u, s);
        return [await direct(u, s)];
    }
    catch (e) {
        if (e instanceof HostError)
            throw e;
        if (e instanceof http.HttpError)
            throw new HostError(`Sem resposta de ${h} (${e.message})`);
        if (depth < 1)
            return resolve(u, s, depth + 1);
        log.error('hosts.resolve %s: %s', u, e);
        throw new HostError(`${knownHost(u) || h}: o site mudou e nao consegui achar o arquivo`);
    }
}
/** Transforma um link adiado (itch.io, pasta MEGA) no link final. */
async function finalize(res, s = http.shared) {
    if (res.host === 'itch.io' && res.lazy)
        return itchFinal(res, s);
    if (res.host === 'MEGA' && !res.url) {
        return { ...res, url: await megaFolderLink(res, s) };
    }
    return res;
}

export { megaList, megaFolderLink, gofileList, itchList, itchFinal, direct, knownHost, isTorrentUrl, resolve, finalize, HostError };
