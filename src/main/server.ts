/**
 * server.ts — o servidor HTTP local, porte de app/core/server.py.
 *
 * O front-end nao sabe que o backend mudou de linguagem: ele continua chamando
 * os mesmos /api/* com o mesmo token no cabecalho. Isso e o que permite
 * reaproveitar os 7.600 linhas de interface do Ludrix sem tocar nelas.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import * as electron from 'electron';
import * as P from './paths';
import * as diagMod from './diag';
import * as log from './log';
import * as menuMod from './menu';
import { themePreviewSvg } from './preview';
import * as util from './util';
import * as server2 from './server2';
const TOKEN = crypto.randomBytes(18).toString('base64url')
/** Porta escolhida pelo sistema na inicializacao (usada pelo Modo Console). */
let LOCAL_PORT = 0;
function localPort() { return LOCAL_PORT; }
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const MAX_BODY = 32 * 1024 * 1024;
const CTYPES = {
    '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
    '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
    '.swf': 'application/x-shockwave-flash',
};
const PAGES = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/console': 'console/console.html',
    '/console/': 'console/console.html',
    '/terminal': 'terminal.html',
};
const PUBLIC_PREFIX = ['/ui/', '/thumb/', '/cover/', '/hero/', '/shot/', '/api/custom.css', '/api/custom/file/', '/flash/cover/', '/flash/ruffle/', '/flash/games/', '/flash/play/', '/api/import/cover', '/favicon.ico'];
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https: http:; " +
    "img-src 'self' data: blob: https: http:; font-src 'self' data: https: http:; media-src 'self' blob: data:; connect-src 'self'; " +
    "worker-src 'self' blob:; frame-src 'self' http://127.0.0.1:* http://localhost:* http:; object-src 'none'; base-uri 'none'; form-action 'none'";
function ctypeOf(file) {
    const ext = path.extname(file).toLowerCase();
    return CTYPES[ext] || 'application/octet-stream';
}
function hostOf(hostHeader) {
    const h = String(hostHeader || '').trim().toLowerCase();
    if (h.startsWith('['))
        return h.split(']')[0] + ']';
    return h.includes(':') && h.split(':').length === 2 ? h.split(':')[0] : h;
}
let SANDBOX_PORT = 0;
function sandboxBase(req) {
    const host = String(req.headers.host || '127.0.0.1').split(',')[0].trim();
    return `http://${hostOf(host)}:${SANDBOX_PORT}`;
}
function startSandbox() {
    const root = P.FLASH;
    const srv = http.createServer((req, res) => {
        let p = '/';
        try {
            p = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname);
        }
        catch { /* ignore */ }
        const t = path.resolve(root, p.replace(/^\/+/, ''));
        const ok = p.startsWith('/html/') && t.startsWith(path.resolve(root) + path.sep) && fs.existsSync(t) && fs.statSync(t).isFile();
        const body = ok ? fs.readFileSync(t) : Buffer.alloc(0);
        res.writeHead(ok ? 200 : 404, { 'Content-Type': ok ? ctypeOf(t) : 'text/plain', 'Content-Length': String(body.length), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=86400' });
        if (req.method !== 'HEAD')
            res.end(body);
        else
            res.end();
    });
    return new Promise<void>((resolve) => {
        srv.on('error', () => resolve());
        srv.listen(0, '127.0.0.1', () => {
            const addr = srv.address();
            SANDBOX_PORT = typeof addr === 'object' && addr ? addr.port : 0;
            resolve();
        });
    });
}
async function startServer(backend, getWindow) {
    await startSandbox();
    const server = http.createServer((req, res) => {
        void handle(req, res, backend, getWindow);
    });
    server.keepAliveTimeout = 30_000;
    server.headersTimeout = 35_000;
    return new Promise<any>((resolve, reject) => {
        server.on('error', reject);
        // portal no 127.0.0.1: o launcher nao deve ser alcancavel pela rede
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            const port = typeof addr === 'object' && addr ? addr.port : 0;
            LOCAL_PORT = port;
            log.info('servidor local em 127.0.0.1:%d', port);
            resolve({
                port,
                token: exports.TOKEN,
                close: () => {
                    try {
                        server.close();
                    }
                    catch {
                        /* ignore */
                    }
                },
            });
        });
    });
}
/* ------------------------------ utilidades ------------------------------ */
function send(res, code, body, ctype, cache = false) {
    let out = body;
    const headers = {
        'Content-Type': ctype,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': cache ? 'public, max-age=2592000, immutable' : 'no-store',
    };
    if (out.length > 4096 && /json|text|javascript|svg/.test(ctype) && String(res.req.headers['accept-encoding'] || '').includes('gzip')) {
        out = zlib.gzipSync(out, { level: 4 });
        headers['Content-Encoding'] = 'gzip';
    }
    if (ctype.startsWith('text/html'))
        headers['Content-Security-Policy'] = CSP;
    headers['Content-Length'] = String(out.length);
    res.writeHead(code, headers);
    if (res.req.method !== 'HEAD')
        res.end(out);
    else
        res.end();
}
function sendJson(res, data, code = 200) {
    send(res, code, Buffer.from(JSON.stringify(data ?? null), 'utf8'), 'application/json; charset=utf-8');
}
function sendFile(res, file, cache = false) {
    if (!file)
        return send(res, 404, Buffer.alloc(0), 'text/plain');
    try {
        const st = fs.statSync(file);
        if (!st.isFile())
            return send(res, 404, Buffer.alloc(0), 'text/plain');
        const ctype = ctypeOf(file);
        send(res, 200, fs.readFileSync(file), ctype, cache);
    }
    catch {
        send(res, 404, Buffer.alloc(0), 'text/plain');
    }
}
function readBody(req) {
    return new Promise<any>((resolve) => {
        const chunks = [];
        let size = 0;
        req.on('data', (c) => {
            size += c.length;
            if (size > MAX_BODY) {
                req.destroy();
                resolve({});
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw.trim())
                return resolve({});
            try {
                resolve(JSON.parse(raw));
            }
            catch {
                resolve({});
            }
        });
        req.on('error', () => resolve({}));
    });
}
/** Regra de acesso: paginas e estaticos sao livres; /api exige o token. */
function allowed(req, p) {
    // Se o navegador mandou Origin, ele tem de ser o proprio servidor.
    // Bloqueia qualquer pagina da web que tente chamar a API local.
    const origin = String(req.headers['origin'] || '');
    if (origin) {
        let same = false;
        try {
            same = new URL(origin).host === String(req.headers.host || '');
        }
        catch {
            same = false;
        }
        if (!same)
            return false;
    }
    if (LOCAL_HOSTS.has(hostOf(String(req.headers.host || '')))) {
        if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site')
            return false;
        if (req.method === 'GET' || req.method === 'HEAD') {
            if (p in PAGES)
                return true;
            if (PUBLIC_PREFIX.some((x) => p.startsWith(x)))
                return true;
            if (p.startsWith('/api/theme/') && !p.endsWith('/json'))
                return true;
            if (p === '/api/custom.css' || p.startsWith('/api/custom/file/'))
                return true;
        }
    }
    const given = String(req.headers['x-ludrix-token'] || '');
    return given.length === exports.TOKEN.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(exports.TOKEN));
}
/* -------------------------------- rotas -------------------------------- */
export let lastRoute = '';
async function handle(req, res, be, getWindow) {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const p = decodeURIComponent(url.pathname);
    const q = url.searchParams;
    if (p.startsWith('/api/'))
        lastRoute = `${req.method} ${p}`;
    try {
        if (!allowed(req, p))
            return sendJson(res, { error: 'forbidden' }, 403);
        if (req.method === 'GET' || req.method === 'HEAD')
            return await routeGet(req, res, p, q, be, getWindow);
        if (req.method === 'POST')
            return await routePost(req, res, p, q, be, getWindow);
        return sendJson(res, { error: 'method not allowed' }, 405);
    }
    catch (e: any) {
        const aborted = req.destroyed || res.destroyed || (e && typeof e === 'object' && !(e instanceof Error) && !Object.keys(e).length) || /aborted|ECONNRESET/i.test(String(e?.message || e?.code || ''));
        if (aborted)
            log.debug('%s %s: requisição interrompida pelo cliente', req.method, p);
        else
            log.error('%s %s: %s', req.method, p, e);
        try {
            sendJson(res, { error: String(e) }, 500);
        }
        catch {
            /* conexao ja caiu */
        }
    }
}
async function routeGet(req, res, p, q, be, getWindow) {
    // ---- paginas ----
    if (p in PAGES) {
        const file = path.join(P.UI, PAGES[p]);
        if (!fs.existsSync(file))
            return sendJson(res, { error: 'not found' }, 404);
        let html = fs.readFileSync(file, 'utf8');
        html = html.replace('<head>', `<head><meta name="ludrix-token" content="${exports.TOKEN}">`);
        try {
            const sp = be.customUX.splashPath();
            if (sp)
                html = html.replace('<div class="sl">', `<div class="sl img" style="background-image:url(/api/custom/file/${path.basename(sp)})">`);
        }
        catch { /* sem splash */ }
        return send(res, 200, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8');
    }
    // ---- arquivos estaticos da interface ----
    if (p.startsWith('/ui/')) {
        const target = path.resolve(P.UI, '.' + p.slice(3));
        if (!target.startsWith(path.resolve(P.UI)))
            return send(res, 403, Buffer.alloc(0), 'text/plain');
        return sendFile(res, target);
    }
    if (p === '/api/catalog') {
        P.bootOk();
        if (q.get('refresh')) {
            be.reloadCatalog(true);
            await new Promise((r) => setTimeout(r, 300));
        }
        return sendJson(res, await be.catalog());
    }
    if (p === '/api/home')
        return sendJson(res, await be.homePayload());
    if (p === '/api/status')
        return sendJson(res, be.statusPayload());
    if (p === '/api/notifications')
        return sendJson(res, be.notifications());
    if (p === '/api/cache')
        return sendJson(res, await be.cacheInfo());
    if (p === '/api/themes' || p === '/api/themes/full')
        return sendJson(res, be.themes());
    if (p === '/api/fonts')
        return sendJson(res, be.fonts());
    if (p === '/api/custom')
        return sendJson(res, be.custom());
    if (p === '/api/custom.css')
        return send(res, 200, Buffer.from(be.customCss(), 'utf8'), 'text/css; charset=utf-8');
    if (p.startsWith('/api/custom/file/')) {
        return sendFile(res, be.customFile(decodeURIComponent(p.slice(17))), true);
    }
    if (p === '/api/diag')
        return sendJson(res, await diagMod.report(be));
    if (p === '/api/flash')
        return sendJson(res, be.flash.status());
    if (p.startsWith('/flash/cover/'))
        return sendFile(res, be.flash.coverLocal(p.slice(13)), true);
    if (p.startsWith('/flash/play/'))
        return send(res, 200, Buffer.from(be.flash.playerHtml(p.slice(12), sandboxBase(req)), 'utf8'), 'text/html; charset=utf-8');
    if (p.startsWith('/flash/ruffle/') || p.startsWith('/flash/games/')) {
        const t = path.resolve(P.FLASH, p.slice(7));
        return t.startsWith(path.resolve(P.FLASH) + path.sep) ? sendFile(res, t, true) : send(res, 403, Buffer.alloc(0), 'text/plain');
    }
    if (p === '/api/config')
        return sendJson(res, be.publicConfig());
    // ---- temas ----
    if (p.startsWith('/api/theme/')) {
        const id = decodeURIComponent(p.slice(11));
        if (id.endsWith('/json'))
            return sendJson(res, be.themeJson(id.slice(0, -5)) || {});
        if (id.endsWith('/wallpaper'))
            return sendFile(res, be.themeWallpaper(id.slice(0, -10)), true);
        if (id.endsWith('/preview')) {
            const tid = id.slice(0, -8);
            const file = be.themePreview(tid);
            if (file)
                return sendFile(res, file, true);
            const svg = themePreviewSvg(tid, String(be.store.config.accent || ''), be.store.config);
            if (svg)
                return send(res, 200, Buffer.from(svg, 'utf8'), 'image/svg+xml; charset=utf-8');
            return sendFile(res, null, true);
        }
        if (id.includes('/file/')) {
            const [tid, rel] = id.split('/file/');
            return sendFile(res, be.themeFile(tid, rel), true);
        }
        const css = be.themeCss(id, String(q.get('s') || ''));
        return send(res, 200, Buffer.from(css, 'utf8'), 'text/css; charset=utf-8');
    }
    // ---- imagens ----
    if (p.startsWith('/thumb/'))
        return sendFile(res, await be.hub.thumbPath(decodeURIComponent(p.slice(7)), false), true);
    if (p.startsWith('/cover/'))
        return sendFile(res, await be.hub.coverPath(decodeURIComponent(p.slice(7))), true);
    if (p.startsWith('/hero/'))
        return sendFile(res, await be.hub.heroPath(decodeURIComponent(p.slice(6))), true);
    if (p.startsWith('/shot/')) {
        const raw = decodeURIComponent(p.slice(6));
        const i = raw.lastIndexOf('/');
        const n = i >= 0 ? raw.slice(i + 1) : '';
        return sendFile(res, /^\d+$/.test(n) ? await be.hub.shotPath(raw.slice(0, i), Number(n)) : null, true);
    }
    // ---- jogo / edicao / acoes ----
    if (p.startsWith('/api/game/')) {
        const d = await be.gamePayload(decodeURIComponent(p.slice(10)));
        return d ? sendJson(res, d) : sendJson(res, { error: 'not found' }, 404);
    }
    if (p.startsWith('/api/edit/'))
        return sendJson(res, await be.hub.editInfo(decodeURIComponent(p.slice(10))));
    if (p.startsWith('/api/actions/'))
        return sendJson(res, be.contextActions(decodeURIComponent(p.slice(13))));
    if (p.startsWith('/api/exes/'))
        return sendJson(res, be.exesOf(decodeURIComponent(p.slice(10))));
    if (p === '/api/hardware')
        return sendJson(res, await be.hardware(q.get('force') === '1'));
    if (p === '/api/bootstrap')
        return sendJson(res, be.bootstrapStatus());
    if (p === '/api/random')
        return sendJson(res, be.randomPick(String(q.get('f') || 'any'), String(q.get('x') || '').split(',').filter(Boolean)));
    if (p === '/api/favicon.ico')
        return sendFile(res, path.join(P.UI, 'icon.png'), true);
    // ---- Store, downloads, emulacao, mods, atualizacoes, importacoes... ----
    if (await (0, server2.routeGet2)(res, p, q, be, LOCAL_PORT))
        return;
    void req;
    return sendJson(res, { error: 'not found' }, 404);
}
async function routePost(req, res, p, _q, be, getWindow) {
    const b = await readBody(req);
    // ---- janela e interface ----
    if (p === '/api/window')
        return sendJson(res, await windowCmd(b, getWindow, be));
    if (p === '/api/ui_ready') {
        log.info('interface pronta em %sms (%s jogos instalados)', b.ms ?? 0, b.games ?? 0);
        P.bootOk();
        return sendJson(res, { ok: true });
    }
    if (p === '/api/log/ui') {
        diagMod.uiError(String(b?.msg || '').slice(0, 300), String(b?.src || '').slice(0, 120), Number(b?.line || 0));
        return sendJson(res, { ok: true });
    }
    if (p === '/api/safe_mode/restore')
        return sendJson(res, be.safeRestore());
    if (p === '/api/restart')
        return sendJson(res, be.restartApp());
    if (p === '/api/factory-reset')
        return sendJson(res, b?.confirm === 'APAGAR TUDO' ? be.factoryReset() : { error: 'sem confirmação' });
    // ---- configuracao ----
    if (p === '/api/config')
        return sendJson(res, be.setConfig(b || {}));
    if (p === '/api/discord/test')
        return sendJson(res, await be.discord.test());
    if (p === '/api/config/reset')
        return sendJson(res, be.resetConfig(b?.keys || []));
    if (p === '/api/file_assoc')
        return sendJson(res, 'on' in b ? be.setFileAssoc(Boolean(b.on)) : be.fileAssoc());
    if (p === '/api/start_menu')
        return sendJson(res, 'on' in b ? be.setStartMenu(Boolean(b.on)) : be.startMenu());
    if (p === '/api/autostart')
        return sendJson(res, be.setAutostart(b?.on));
    // ---- biblioteca ----
    if (p === '/api/play')
        return sendJson(res, await be.play(b.key, b.after ?? null, b.emulator ?? null, b.optimize ?? null, Boolean(b.force)));
    if (p === '/api/stop')
        return sendJson(res, be.stopGame(b.key));
    if (p === '/api/game/move')
        return sendJson(res, be.moveGame(b.key, b.dest || ''));
    if (p === '/api/game/relocate')
        return sendJson(res, await be.relocateGame(b.key, b.path ?? null));
    if (p === '/api/flash/played') {
        be.flash.markPlay(String(b.id || ''));
        return sendJson(res, { ok: true });
    }
    if (p === '/api/game/played')
        return sendJson(res, be.markPlayed(b.key, b.played !== false));
    if (p === '/api/fav')
        return sendJson(res, be.toggleFavorite(b.key));
    if (p === '/api/hide')
        return sendJson(res, be.toggleHidden(b.key));
    if (p === '/api/local/add')
        return sendJson(res, await be.addLocalGame(b.exe, b.title));
    if (p === '/api/drop/classify')
        return sendJson(res, be.classifyDrop(Array.isArray(b.paths) ? b.paths : []));
    if (p === '/api/local/guess')
        return sendJson(res, be.localGuess(b.path || ''));
    if (p === '/api/rename')
        return sendJson(res, be.hub.renameGame(b.key, b.title));
    if (p === '/api/edit/save')
        return sendJson(res, await be.hub.editSave(b.key, b.data || {}));
    if (p === '/api/edit/reset')
        return sendJson(res, be.hub.editReset(b.key));
    if (p === '/api/edit/copy')
        return sendJson(res, await be.hub.editCopy(b.key, b.from || ''));
    if (p === '/api/edit/candidates')
        return sendJson(res, await be.hub.editCandidates(b.key, String(b.source || ''), String(b.title || '')));
    if (p === '/api/edit/probe_id')
        return sendJson(res, await be.hub.editProbeId(b.key, String(b.source || ''), String(b.id || ''), String(b.title || '')));
    if (p === '/api/edit/probe')
        return sendJson(res, await be.hub.editProbe(b.key, b.source || '', b.title || ''));
    if (p === '/api/edit/webcovers')
        return sendJson(res, await be.hub.editWebCovers(b.key, b.title || '', b.kind || 'cover'));
    if (p === '/api/edit/websearch')
        return sendJson(res, await be.hub.editWebSearch(String(b.q || ''), String(b.engine || 'auto'), Number(b.page || 0), String(b.kind || 'cover')));
    if (p === '/api/shortcut')
        return sendJson(res, be.hub.setShortcut(b.key, b.exe ?? null, b.args ?? null));
    if (p === '/api/uninstall')
        return sendJson(res, await be.uninstall(b.key));
    if (p === '/api/uninstall/undo')
        return sendJson(res, be.undoRemove());
    if (p === '/api/set_exe')
        return sendJson(res, await be.setExe(b.key, b.rel));
    if (p === '/api/game/size')
        return sendJson(res, await be.folderSize(b.key));
    if (p === '/api/open')
        return sendJson(res, be.openPath(b.path || '', b.key || ''));
    if (p === '/api/open_select')
        return sendJson(res, be.openSelect(b.key));
    if (p === '/api/open_url')
        return sendJson(res, be.openUrl(b.url));
    if (p === '/api/library/check')
        return sendJson(res, be.libraryCheck());
    if (p === '/api/library/dupes')
        return sendJson(res, be.libraryDupes());
    if (p === '/api/library/merge')
        return sendJson(res, be.libraryMerge(b.keep, b.drop || []));
    if (p === '/api/library/export')
        return sendJson(res, await be.exportMetadata(b.keys || null, b.format || 'ludrix'));
    if (p === '/api/library/backups')
        return sendJson(res, be.libraryBackups());
    if (p === '/api/library/backup')
        return sendJson(res, be.libraryBackup());
    if (p === '/api/library/restore')
        return sendJson(res, be.libraryRestore(b.name));
    // ---- capas e metadados ----
    if (p === '/api/cover/set')
        return sendJson(res, await be.hub.setCover(b.key, b.path || null));
    if (p === '/api/cover/reset')
        return sendJson(res, be.hub.resetCover(b.key));
    if (p === '/api/metadata')
        return sendJson(res, await be.hub.fetchMetadata(b.key, Boolean(b.force)));
    if (p === '/api/metadata/refetch_all')
        return sendJson(res, be.hub.refetchAllMetadata());
    // ---- temas e aparencia ----
    if (p === '/api/theme/import')
        return sendJson(res, await be.themeImport(b.path));
    if (p === '/api/theme/delete')
        return sendJson(res, be.themeDelete(b.id));
    if (p === '/api/theme/export')
        return sendJson(res, be.themeExport(b.id, b.format || 'lxtheme'));
    if (p === '/api/theme/export_all')
        return sendJson(res, be.themeExportAll(b.format || 'zip'));
    if (p === '/api/theme/reload')
        return sendJson(res, be.themeReload(b.theme || ''));
    if (p === '/api/custom/set')
        return sendJson(res, be.customSet(b));
    if (p === '/api/custom/reset')
        return sendJson(res, be.customReset());
    if (p === '/api/custom/pick')
        return sendJson(res, await be.customUX.pick(String(b?.what || 'wallpaper')));
    if (p === '/api/custom/add')
        return sendJson(res, be.customUX.addFile(String(b?.what || 'wallpaper'), String(b?.path || '')));
    if (p === '/api/custom/remove')
        return sendJson(res, be.customUX.remove(String(b?.what || 'wallpaper'), String(b?.name || '')));
    if (p === '/api/custom/export')
        return sendJson(res, be.customUX.export(String(b?.name || ''), String(b?.dest || '')));
    // ---- sistema ----
    if (p === '/api/cache/images_gc')
        return sendJson(res, be.imageGc(Boolean(b.apply)));
    if (p === '/api/cache/clear')
        return sendJson(res, await be.clearCache(b.what || []));
    if (p === '/api/notifications/ack')
        return sendJson(res, be.notifAck(b.id, Boolean(b.clear)));
    // ---- seletores de arquivo ----
    if (p === '/api/pick_exe')
        return sendJson(res, await be.pickExe(b.initial || '', b.kind || 'exe'));
    if (p === '/api/pick_path')
        return sendJson(res, await be.pickPath(b.kind || 'exe', b.initial || ''));
    if (p === '/api/choose_folder')
        return sendJson(res, await be.chooseFolder(b.what || 'games', b.system || '', b.initial || ''));
    // ---- backup completo ----
    if (p === '/api/data/auto_backup') {
        if (b.pick) {
            const d = await require('./dialogs').pickFolder(be.autoBackupDir());
            if (d)
                be.store.setConfig({ auto_backup_dir: d });
            return sendJson(res, { ok: true, dir: be.autoBackupDir() });
        }
        if (b.reset) {
            be.store.setConfig({ auto_backup_dir: '' });
            return sendJson(res, { ok: true, dir: be.autoBackupDir() });
        }
        return sendJson(res, b.now ? be.autoBackup(true) : { ok: true, dir: be.autoBackupDir() });
    }
    if (p === '/api/data/export')
        return sendJson(res, await be.dataExport());
    if (p === '/api/data/inspect')
        return sendJson(res, await be.dataInspect(b?.path || null));
    if (p === '/api/data/import')
        return sendJson(res, be.dataImport(String(b?.path || '')));
    if (p === '/api/backup/export')
        return sendJson(res, be.backupExport(b?.dest || null));
    if (p === '/api/backup/import')
        return sendJson(res, await be.backupImport(b?.path || null));
    // ---- Store, downloads, emulacao, mods, atualizacoes, importacoes... ----
    if (await (0, server2.routePost2)(res, p, b, be, getWindow, LOCAL_PORT))
        return;
    return sendJson(res, { error: 'not found' }, 404);
}
/* ------------------------- comandos de janela ------------------------- */
let resizeTimer = null;
export function sysAccent(): string {
    try {
        if (process.platform !== 'win32' && process.platform !== 'darwin')
            return '';
        const c = String(electron.systemPreferences.getAccentColor() || '');
        return /^[0-9a-f]{6}/i.test(c) ? '#' + c.slice(0, 6).toLowerCase() : '';
    }
    catch {
        return '';
    }
}
async function windowCmd(b, getWindow, be) {
    const win = getWindow();
    const cmd = String(b?.cmd || '');
    if (cmd === 'ctx')
        return ctxMenu(b, win, be);
    if (cmd === 'show') {
        be.windowHooks?.show?.();
        return { ok: true };
    }
    if (!win)
        return { ok: false, error: 'janela indisponivel' };
    switch (cmd) {
        case 'sys_accent':
            return { ok: true, hex: sysAccent() };
        case 'notify_ui':
            be.push({ type: 'ui', ui: b.ui || {} });
            return { ok: true };
        case 'scheme': {
            try {
                const nt = require('electron').nativeTheme;
                if (nt)
                    nt.themeSource = b.light === true ? 'light' : b.light === false ? 'dark' : 'system';
            }
            catch { /* ignore */ }
            return { ok: true };
        }
        case 'minimize':
        case 'min':
            win.minimize();
            return { ok: true };
        case 'maximize':
        case 'max':
            return { ok: true, ...(be.windowHooks?.maximize?.() || {}) };
        case 'state':
            return { ok: true, max: win.isMaximized(), fs: win.isFullScreen() };
        case 'fullscreen':
            win.setFullScreen(b.on === undefined ? !win.isFullScreen() : Boolean(b.on));
            return { ok: true, fs: win.isFullScreen() };
        case 'frameless':
            return { ok: true, frameless: Boolean(be.store.config.frameless) && process.platform === 'win32' };
        case 'frame': {
            const want: any = {};
            for (const k of ['mode', 'bg', 'text', 'border', 'dark', 'corners'])
                want[k] = b[k];
            const idx = require('./index');
            const prev = idx.frameLast || {};
            if (b.colors && typeof b.colors === 'object')
                want.colors = b.colors;
            else
                want.colors = prev.colors;
            idx.setFrameLast(want);
            return { ok: true };
        }
        case 'to_window':
            return be.consoleSwap('window', true);
        case 'hide':
            be.windowHooks?.hide?.();
            return { ok: true };
        case 'show':
            win.show();
            win.focus();
            return { ok: true };
        case 'close':
            setTimeout(() => be.windowHooks?.close?.(), 50);
            return { ok: true };
        case 'quit':
            be.windowHooks?.quit?.();
            return { ok: true };
        case 'resize':
            startResize(String(b.dir || ''), win);
            return { ok: true };
        case 'resize_end':
            stopResize();
            return { ok: true };
        default:
            return { error: 'indisponível', native: true };
    }
}
async function ctxMenu(b, win, be) {
    if (!menuMod.available() || !win)
        return { ok: false };
    let head: any = null;
    if (b.head && typeof b.head === 'object') {
        let thumb: string | null = null;
        if (b.head.key) {
            try {
                const p = await be.hub.thumbPath(String(b.head.key), false);
                if (p && fs.existsSync(p))
                    thumb = `data:${path.extname(p).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg'};base64,${fs.readFileSync(p).toString('base64')}`;
            }
            catch { /* sem miniatura */ }
        }
        head = { title: String(b.head.title || '').slice(0, 60), sub: String(b.head.sub || '').slice(0, 60), thumb };
    }
    return menuMod.show({ items: b.items || [], title: String(b.title || ''), head, colors: b.colors || {}, ui: b.ui || {}, light: String(b.light) === '1', x: Number(b.x || 0), y: Number(b.y || 0), atCursor: String(b.at_cursor) === '1', owner: win });
}
/** Redimensionamento manual da janela sem moldura (arrastando as bordas). */
function startResize(dir, win) {
    stopResize();
    const start = win.getBounds();
    const origin = electron.screen.getCursorScreenPoint();
    const t0 = Date.now();
    resizeTimer = setInterval(() => {
        if (Date.now() - t0 > 15000 || win.isDestroyed() || !win.isFocused()) {
            stopResize();
            return;
        }
        const cur = electron.screen.getCursorScreenPoint();
        const dx = cur.x - origin.x;
        const dy = cur.y - origin.y;
        const b = { ...start };
        if (dir.includes('e'))
            b.width = Math.max(640, start.width + dx);
        if (dir.includes('s'))
            b.height = Math.max(480, start.height + dy);
        if (dir.includes('w')) {
            b.width = Math.max(640, start.width - dx);
            b.x = start.x + (start.width - b.width);
        }
        if (dir.includes('n')) {
            b.height = Math.max(480, start.height - dy);
            b.y = start.y + (start.height - b.height);
        }
        try {
            win.setBounds(b);
        }
        catch {
            stopResize();
        }
    }, 16);
    if (resizeTimer.unref)
        resizeTimer.unref();
}
function stopResize() {
    if (resizeTimer) {
        clearInterval(resizeTimer);
        resizeTimer = null;
    }
}
/** Diagnostico basico (Ajustes > Sistema). */

export { localPort, ctypeOf, startServer, send, sendJson, sendFile, util, TOKEN };
