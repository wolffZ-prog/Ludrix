import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import * as electron from 'electron';
import * as P from './paths';
import * as log from './log';
import * as util from './util';
import * as dialogs from './dialogs';
import * as backendMod from './backend';
import * as serverMod from './server';
import * as store from './store';
import * as diagMod from './diag';
import * as server2 from './server2';
import * as trayMod from './tray';
import * as notifyMod from './notify';
import * as gamepadMod from './gamepad';
import * as imgdecode from './imgdecode';
let win = null;
let backend = null;
let server = null;
let allowClose = false;
const getWindow = () => win;
const CONSOLE = process.argv.includes('--console');
const MODE = CONSOLE ? 'console' : 'window';
try {
    const ud = path.join(P.CACHE, CONSOLE ? 'webview-console' : 'webview');
    fs.mkdirSync(ud, { recursive: true });
    electron.app.setPath('userData', ud);
    electron.app.setPath('sessionData', ud);
}
catch (e: any) {
    log.warn('userData: %s', e?.message || e);
}
if (process.platform === 'win32')
    electron.app.setAppUserModelId('com.ludrix.hub');
function pidAlive(pid: number) {
    if (!pid || pid === process.pid)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (e: any) {
        return e?.code === 'EPERM';
    }
}
async function closeOther(timeout = 6000) {
    const cur = util.readJson(P.INSTANCE_FILE, null);
    const pid = Number(cur?.pid || 0);
    if (!cur || !pidAlive(pid))
        return false;
    log.info('fechando %s (pid %s) para abrir %s', cur.mode, pid, MODE);
    if (cur.port) {
        try {
            await fetch(`http://127.0.0.1:${cur.port}/api/window`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ludrix-Token': cur.token || '' }, body: JSON.stringify({ cmd: 'quit' }), signal: AbortSignal.timeout(3000) });
        }
        catch (e) {
            log.debug('quit por http: %s', e);
        }
    }
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        if (!pidAlive(pid))
            return true;
        await new Promise((r) => setTimeout(r, 200));
    }
    try {
        process.kill(pid, 'SIGKILL');
    }
    catch { }
    await new Promise((r) => setTimeout(r, 500));
    return true;
}
const fileArgRe = /\.(lxup|lxtheme)$/i;
const gotLock = electron.app.requestSingleInstanceLock({ files: process.argv.slice(1).filter((a) => fileArgRe.test(a)).map((a) => path.resolve(a)), urls: process.argv.slice(1).filter((a) => notifyMod.isUrlArg(a)) });
if (!gotLock)
    electron.app.exit(0);
else {
    electron.app.on('second-instance', (_e, argv, _cwd, extra: any) => {
        const urls: string[] = Array.isArray(extra?.urls) ? extra.urls : (argv || []).filter((a: string) => notifyMod.isUrlArg(a));
        const files = Array.isArray(extra?.files) ? extra.files : (argv || []).filter((a: string) => fileArgRe.test(a));
        if (!urls.length || files.length)
            showWindow();
        for (const u of urls)
            handleUrlArg(u);
        for (const f of files)
            void handleFileArg(f);
    });
}
let mainUrl = '';
let standby = false;
let standbyTimer: any = null;
let pendingJs: string[] = [];
function createWindow(url, recreate = false) {
    mainUrl = url;
    const iconPath = path.join(P.UI, 'icon.png');
    const icon = fs.existsSync(iconPath) ? electron.nativeImage.createFromPath(iconPath) : undefined;
    const frameless = Boolean(backend?.store.config.frameless ?? true) && process.platform === 'win32';
    store.setRuntimeFrameless(frameless);
    const winBuild = process.platform === 'win32' ? Number((os.release().split('.')[2] || '0')) : 0;
    const acrylic = process.platform === 'win32' && winBuild >= 22621 && backend?.store.config.acrylic !== false;
    store.setRuntimeAcrylic(acrylic);
    const startHidden = !recreate && process.argv.includes('--minimized') && backend?.store.config.tray_enabled !== false;
    const area = electron.screen.getPrimaryDisplay().workAreaSize;
    const width = Math.min(1380, Math.max(640, area.width - 60));
    const height = Math.min(880, Math.max(480, area.height - 110));
    const dark = String(backend?.store.config.theme || 'dark') !== 'light';
    win = new electron.BrowserWindow({
        width,
        height,
        minWidth: Math.min(1000, width),
        minHeight: Math.min(660, height),
        title: 'Ludrix',
        ...(acrylic ? { backgroundMaterial: 'acrylic' as const } : { backgroundColor: dark ? '#14161c' : '#e9eaee' }),
        frame: !frameless,
        show: false,
        autoHideMenuBar: true,
        icon,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false,
            backgroundThrottling: false,
        },
    });
    win.setMenuBarVisibility(false);
    if (frameless)
        win.on('system-context-menu', (e) => { e.preventDefault(); });
    win.webContents.setWindowOpenHandler(({ url: target }) => {
        if (/^https?:/i.test(target))
            void electron.shell.openExternal(target);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, target) => {
        const base = `http://127.0.0.1:${server?.port ?? 0}`;
        if (!target.startsWith(base)) {
            e.preventDefault();
            void electron.shell.openExternal(target);
        }
    });
    win.once('ready-to-show', () => {
        if (!startHidden) {
            win?.show();
            if (recreate)
                win?.focus();
        }
        if (backend)
            win?.setTitle(`Ludrix ${backend.publicConfig().version || ''}`.trim());
    });
    for (const ev of ['maximize', 'unmaximize'] as const)
        win.on(ev, () => backend?.push({ type: 'win', max: ev === 'maximize' }));
    win.on('close', (e) => {
        if (allowClose)
            return;
        e.preventDefault();
        onClosing();
    });
    win.on('closed', () => {
        win = null;
        if (standby) {
            standby = false;
            return;
        }
        allowClose = true;
        electron.app.quit();
    });
    win.on('show', () => { clearTimeout(standbyTimer); standbyTimer = null; });
    win.on('hide', () => scheduleStandby());
    void win.loadURL(url);
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
        if (level >= 2)
            log.error('ui: %s (%s:%s)', message, String(sourceId || '').split('/').pop() || '', line);
    });
    win.webContents.on('did-fail-load', (_e, code, desc) => log.error('falha ao carregar a interface: %s %s', code, desc));
    win.webContents.on('did-finish-load', () => {
        if (pendingJs.length) {
            const codes = pendingJs.splice(0);
            setTimeout(() => { for (const c of codes) win?.webContents.executeJavaScript(c, true).catch((e) => log.warn('bandeja js: %s', e)); }, 900);
        }
        win?.webContents.executeJavaScript(`
      window.addEventListener('mouseup', function () {
        try {
          var t = document.querySelector('meta[name="ludrix-token"]');
          fetch('/api/window', { method:'POST', headers: {'Content-Type':'application/json','X-Ludrix-Token': (t && t.content) || ''}, body: JSON.stringify({cmd:'resize_end'}) });
        } catch (e) {}
      }, true);
    `).catch(() => undefined);
    });
    win.webContents.on('before-input-event', (e, input) => {
        if (input.key === 'F12') {
            win?.webContents.toggleDevTools();
            e.preventDefault();
        }
        else if (input.key === 'F11') {
            win?.setFullScreen(!win.isFullScreen());
            e.preventDefault();
        }
    });
}
function createConsoleWindow(url) {
    const iconPath = path.join(P.UI, 'console', 'icon.png');
    const icon = fs.existsSync(iconPath) ? electron.nativeImage.createFromPath(iconPath) : undefined;
    const bounds = electron.screen.getPrimaryDisplay().bounds;
    win = new electron.BrowserWindow({
        width: Math.min(1280, bounds.width),
        height: Math.min(720, bounds.height),
        minWidth: Math.min(960, bounds.width),
        minHeight: Math.min(540, bounds.height),
        title: 'LudrixHub Console',
        backgroundColor: '#0c0d10',
        frame: false,
        fullscreen: process.platform !== 'win32',
        show: false,
        autoHideMenuBar: true,
        icon,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false },
    });
    win.setMenuBarVisibility(false);
    win.webContents.setWindowOpenHandler(({ url: target }) => {
        if (/^https?:/i.test(target))
            void electron.shell.openExternal(target);
        return { action: 'deny' };
    });
    win.once('ready-to-show', () => {
        if (process.platform === 'win32') {
            win?.setBounds(bounds);
            win?.maximize();
        }
        win?.show();
        win?.focus();
    });
    win.on('closed', () => {
        win = null;
        allowClose = true;
        electron.app.quit();
    });
    void win.loadURL(url);
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
        if (level >= 2)
            log.error('ui: %s (%s:%s)', message, String(sourceId || '').split('/').pop() || '', line);
    });
    win.webContents.on('did-fail-load', (_e, code, desc) => log.error('falha ao carregar a interface: %s %s', code, desc));
    win.webContents.on('before-input-event', (e, input) => {
        if (input.key === 'F12') {
            win?.webContents.toggleDevTools();
            e.preventDefault();
        }
    });
}
let trayTold = false;
export let frameLast: any = {};
export function setFrameLast(v: any) { frameLast = v; }
function scheduleStandby() {
    clearTimeout(standbyTimer);
    standbyTimer = null;
    if (!win || CONSOLE)
        return;
    const cfg = backend?.store.config || {};
    if (cfg.tray_sleep === false || !canTray())
        return;
    standbyTimer = setTimeout(() => {
        standbyTimer = null;
        if (!win || win.isVisible() || !canTray() || (backend?.store.config || {}).tray_sleep === false)
            return;
        standby = true;
        const w = win;
        win = null;
        try {
            w.destroy();
            log.info('em espera na bandeja: janela liberada da memória');
            setTimeout(() => { try { backend?.standby(); } catch (e) { log.warn('em espera: %s', e); } }, 1000).unref?.();
        }
        catch (e) {
            standby = false;
            win = w;
            log.warn('em espera: %s', e);
        }
    }, 25_000);
    standbyTimer.unref?.();
}
function showWindow() {
    if (!win) {
        if (mainUrl && !CONSOLE)
            createWindow(mainUrl, true);
        return;
    }
    if (!win.isVisible())
        win.show();
    if (win.isMinimized())
        win.restore();
    win.focus();
}
function runJs(code: string) {
    if (win && !win.webContents.isLoading())
        win.webContents.executeJavaScript(code, true).catch((e) => log.warn('bandeja js: %s', e));
    else
        pendingJs.push(code);
}
let quitting = false;
export let hotkeyStatus: { ok: boolean; error: string; accel: string } = { ok: false, error: '', accel: '' };
function applyHotkey() {
    const gs = electron.globalShortcut;
    if (!gs)
        return hotkeyStatus;
    try {
        gs.unregisterAll();
    }
    catch { }
    const cfg = backend?.store.config || {};
    const accel = String(cfg.hotkey || '').trim();
    if (cfg.hotkey_enabled === false || !accel || CONSOLE) {
        hotkeyStatus = { ok: false, error: '', accel };
        return hotkeyStatus;
    }
    try {
        const ok = gs.register(accel, () => {
            if (!win) {
                showWindow();
                return;
            }
            if (win.isVisible() && win.isFocused() && !win.isMinimized())
                hideWindow();
            else
                showWindow();
        });
        hotkeyStatus = ok ? { ok: true, error: '', accel } : { ok: false, error: 'Esse atalho já está em uso por outro programa.', accel };
    }
    catch (e: any) {
        hotkeyStatus = { ok: false, error: 'Atalho inválido.', accel };
    }
    if (!hotkeyStatus.ok && hotkeyStatus.error)
        log.warn('atalho global %s: %s', accel, hotkeyStatus.error);
    return hotkeyStatus;
}
function canTray() {
    return Boolean(backend && backend.store.config.tray_enabled !== false && trayMod.present());
}
function hideWindow(msg: string | null = null) {
    if (!win)
        return;
    if (canTray()) {
        win.hide();
        if (msg === null)
            msg = backend.sessions.active.size ? 'Minimizado na bandeja. O tempo de jogo continua sendo contado.' : 'O Ludrix continua na bandeja, perto do relógio. Clique no ícone pra abrir de novo.';
        if (!trayTold) {
            trayMod.notify(msg);
            trayTold = true;
        }
    }
    else
        win.minimize();
}
function quitApp() {
    if (quitting)
        return;
    quitting = true;
    allowClose = true;
    setTimeout(() => { log.warn('saída forçada'); process.exit(0); }, 6000).unref();
    backend?.gamepad?.stop();
    trayMod.destroy();
    electron.app.quit();
}
function onClosing(): boolean {
    if (quitting)
        return true;
    const ct = canTray();
    const action = ct ? String(backend.store.config.close_action || 'ask') : 'quit';
    if (action === 'quit' && (!backend.sessions.active.size || !ct)) {
        quitApp();
        return true;
    }
    if (action === 'quit' || action === 'tray') {
        hideWindow();
        return false;
    }
    win?.webContents.executeJavaScript('window.onCloseAsk ? (onCloseAsk(), 1) : 0', true).then((r) => { if (!r) hideWindow(); }).catch(() => hideWindow());
    return false;
}
let emulationStatusCache = null;
function updateGuard() {
    const pv = P.PENDING_VERIFY;
    if (!fs.existsSync(pv))
        return false;
    let info: any;
    try {
        info = JSON.parse(fs.readFileSync(pv, 'utf8'));
    }
    catch {
        fs.rmSync(pv, { force: true });
        return false;
    }
    if (P.bootTries() < 2)
        return false;
    const backup = String(info.backup || '');
    if (!backup || !fs.existsSync(backup) || !fs.statSync(backup).isDirectory()) {
        log.warn('atualização %s não abriu, mas não há backup para voltar', info.version);
        fs.rmSync(pv, { force: true });
        return false;
    }
    log.error('a versão %s não conseguiu abrir duas vezes; voltando para %s', info.version, info.from);
    try {
        for (const d of info.dirs || []) {
            const src = path.join(backup, d);
            if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
                fs.rmSync(path.join(P.ROOT, d), { recursive: true, force: true });
                fs.cpSync(src, path.join(P.ROOT, d), { recursive: true });
            }
        }
        for (const f of info.files || []) {
            const src = path.join(backup, f);
            if (fs.existsSync(src) && fs.statSync(src).isFile())
                fs.copyFileSync(src, path.join(P.ROOT, f));
        }
    }
    catch (e) {
        log.error('rollback falhou: %s', e);
        fs.rmSync(pv, { force: true });
        return false;
    }
    fs.rmSync(pv, { force: true });
    P.bootOk();
    try {
        fs.writeFileSync(path.join(P.UPDATES, 'rolled_back.json'), JSON.stringify({ from: info.version, to: info.from, at: Date.now() / 1000 }), 'utf8');
    }
    catch { }
    electron.app.relaunch();
    electron.app.exit(0);
    return true;
}
function migrateLegacy() {
    if (!P.FROZEN)
        return;
    const junk = [path.join(P.ROOT, 'updater.exe'), path.join(P.ROOT, 'updater.exe.old'), path.join(P.ROOT, 'Ludrix.exe.old'), path.join(P.ROOT, 'LudrixConsole.exe.old'), path.join(P.APP_DIR, 'pyc.json')];
    const dirs = [path.join(P.APP_DIR, '__pycache__'), path.join(P.APP_DIR, 'core', '__pycache__')];
    let n = 0;
    for (const f of junk) {
        try {
            if (fs.existsSync(f)) {
                fs.rmSync(f, { force: true });
                n++;
            }
        }
        catch (e: any) {
            log.debug('legado %s: %s', f, e?.message || e);
        }
    }
    for (const d of dirs) {
        try {
            if (fs.existsSync(d)) {
                fs.rmSync(d, { recursive: true, force: true });
                n++;
            }
        }
        catch { }
    }
    if (n)
        log.info('restos da versão 3.x removidos (%d)', n);
}
function legacySweep() {
    if (fs.existsSync(P.PENDING_VERIFY))
        return;
    let n = 0;
    const bdir = path.join(P.UPDATES, 'backup');
    try {
        for (const d of fs.existsSync(bdir) ? fs.readdirSync(bdir) : []) {
            const full = path.join(bdir, d);
            if (fs.existsSync(path.join(full, 'app', 'main.py')) || fs.existsSync(path.join(full, 'runtime', 'python.exe')) || fs.existsSync(path.join(full, 'runtime', 'python3.dll'))) {
                fs.rmSync(full, { recursive: true, force: true });
                n++;
            }
        }
        for (const f of fs.existsSync(P.UPDATES) ? fs.readdirSync(P.UPDATES) : [])
            if (/^seed-[0-3]\./.test(f) || /^ludrix-[0-3]\..*\.lxup$/.test(f)) {
                fs.rmSync(path.join(P.UPDATES, f), { force: true });
                n++;
            }
    }
    catch (e: any) {
        log.debug('limpeza 3.x: %s', e?.message || e);
    }
    if (n)
        log.info('motor antigo (3.x) removido do backup (%d)', n);
}
async function main() {
    P.ensureDirs();
    log.initLog();
    log.info('Ludrix (Electron) iniciando em %s', P.ROOT);
    const args = process.argv.slice(1);
    if (updateGuard())
        return;
    const safe = CONSOLE ? false : P.bootBegin();
    migrateLegacy();
    await closeOther();
    backend = new backendMod.Backend();
    if (safe) {
        backend.safeMode = true;
        backend.safeSaved = diagMod.enterSafeMode(backend.store);
        log.warn('modo seguro: duas aberturas seguidas não completaram; aparência voltou ao padrão');
    }
    dialogs.bindWindow(getWindow);
    try {
        const integrity = await import('./integrity');
        const rep = integrity.bootCheck(P.APP_DIR, P.ROOT);
        if (rep.status === 'repaired')
            log.warn('arquivos reparados a partir do pacote da versão: %s', JSON.stringify((rep.fixed || []).map((b: any) => b.file)));
        if (rep.status === 'damaged')
            log.error('arquivos do launcher alterados/faltando: %s', JSON.stringify((rep.bad || []).map((b: any) => b.file)));
        backend.integrityReport(rep);
    }
    catch (e) {
        log.warn('verificação de arquivos falhou: %s', e);
    }
    server = await (0, serverMod.startServer)(backend, getWindow);
    setTimeout(legacySweep, 90000).unref();
    util.writeJson(P.INSTANCE_FILE, {
        mode: MODE,
        pid: process.pid,
        port: server.port,
        token: server.token || serverMod.TOKEN,
        at: util.now(),
    });
    backend.windowHooks = {
        refresh_tray: () => trayMod.refresh(),
        reload: () => win?.webContents.reload(),
        quit: () => quitApp(),
        hide: (msg?: string) => hideWindow(msg ?? null),
        close: () => onClosing(),
        minimize: () => win?.minimize(),
        maximize: () => { if (!win) return { max: false }; if (win.isMaximized()) win.unmaximize(); else win.maximize(); return { max: win.isMaximized() }; },
        popup: (b) => {
            const w = new electron.BrowserWindow({
                width: Math.max(640, Math.min(Number(b.w || 1280), 1920)), height: Math.max(480, Math.min(Number(b.h || 760), 1200)),
                minWidth: 480, minHeight: 360, backgroundColor: '#0b0d12', title: `${b.title || 'LudrixHub'} — LudrixHub`, autoHideMenuBar: true,
                webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
            });
            w.setMenuBarVisibility(false);
            void w.loadURL(String(b.url));
            return { ok: true };
        },
        show: () => showWindow(),
        hotkey: () => applyHotkey(),
        notify_hidden: (msg: string) => { if (win && !win.isVisible() && (backend?.store.config || {}).notify_hidden !== false) trayMod.notify(msg); },
        focused: () => Boolean(win && !win.isDestroyed() && win.isVisible() && win.isFocused() && !win.isMinimized()),
        progress: (v: number) => { try { win?.setProgressBar(v, { mode: v < 0 ? 'none' : v >= 1 ? 'none' : 'normal' }); } catch { } },
    };
    if (process.platform === 'win32')
        try {
            electron.systemPreferences.on('accent-color-changed', () => backend?.push({ type: 'sys_accent', hex: server.sysAccent() }));
        }
        catch { }
    if (CONSOLE)
        createConsoleWindow(`http://127.0.0.1:${server.port}/console`);
    else {
        createWindow(`http://127.0.0.1:${server.port}/index.html`);
        applyHotkey();
        trayMod.build({ be: backend, show: () => showWindow(), quit: () => quitApp(), js: (code) => { showWindow(); runJs(code); }, frameLast: () => frameLast });
        notifyMod.attach({ be: backend, show: () => showWindow(), openGame: (k) => { showWindow(); runJs(`openGame(${JSON.stringify(k)})`); }, play: (k) => { showWindow(); runJs(`play(${JSON.stringify(k)})`); } });
    }
    setTimeout(() => backend?.bootstrapRun(), 800);
    let lastTick = Date.now();
    const stall = setInterval(() => {
        const now = Date.now();
        const lag = now - lastTick - 1000;
        if (lag > 700)
            log.warn('processo principal travou %d ms (última rota: %s)', lag, serverMod.lastRoute || '-');
        lastTick = now;
    }, 1000);
    stall.unref?.();
    if (!CONSOLE) {
        const files = [...pendingFiles, ...process.argv.slice(1).filter((a) => fileArgRe.test(a)).map((a) => path.resolve(a))];
        const urls = [...pendingUrls, ...process.argv.slice(1).filter((a) => notifyMod.isUrlArg(a))];
        pendingFiles.length = 0;
        pendingUrls.length = 0;
        setTimeout(() => { for (const f of new Set(files)) void handleFileArg(f); for (const u of new Set(urls)) handleUrlArg(u); }, 2500);
    }
    setTimeout(() => backend?.autostartSync(), 1500);
    if (!CONSOLE) {
        try {
            backend.gamepad = new gamepadMod.GamepadWatcher(backend.store, (why) => {
                showWindow();
                runJs(`window.onGamepadWake && onGamepadWake('${why}')`);
            });
            gamepadMod.setWatcher(backend.gamepad);
            if (backend.store.config.gamepad_wake)
                backend.gamepad.start();
        }
        catch (e: any) {
            log.warn('gamepad: %s', e?.message || e);
        }
    }
    if (process.env.LUDRIX_SCREENSHOT) {
        setTimeout(async () => {
            try {
                const img = await win?.webContents.capturePage();
                if (img)
                    fs.writeFileSync(String(process.env.LUDRIX_SCREENSHOT), img.toPNG());
                if (process.env.LUDRIX_DUMP && win) {
                    const dump = await win.webContents.executeJavaScript(`(() => {
            const q = (s) => document.querySelectorAll(s).length;
            const vis = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el);
              return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden'; };
            const shown = [...document.querySelectorAll('*')].filter(vis);
            return {
              title: document.title,
              bodyClass: document.body.className,
              counts: { all: q('*'), cards: q('.card,.game,.cover,.tile'), buttons: q('button'), svg: q('svg'), imgs: q('img') },
              visibleTop: shown.slice(0, 400).map(e => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).slice(0,2).join('.') : '')).slice(0, 120),
              text: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 1200),
              theme: document.documentElement.dataset.light === '1' ? 'light' : 'dark',
              link: (document.getElementById('themeLink') || {}).href || '',
            };
          })()`);
                    fs.writeFileSync(String(process.env.LUDRIX_DUMP), JSON.stringify(dump, null, 1), 'utf8');
                }
            }
            catch (e) {
                log.warn('captura de tela: %s', e);
            }
            allowClose = true;
            electron.app.quit();
        }, 9000);
    }
    electron.app.on('before-quit', () => {
        allowClose = true;
        quitting = true;
        try {
            electron.globalShortcut.unregisterAll();
        }
        catch { }
        imgdecode.shutdown();
        backend?.shutdown();
        server?.close();
        try {
            fs.rmSync(P.INSTANCE_FILE, { force: true });
        }
        catch {
        }
    });
}
process.on('SIGTERM', () => quitApp());
process.on('SIGINT', () => quitApp());
electron.app.on('window-all-closed', () => {
    if (standby || (!win && mainUrl && !allowClose))
        return;
    electron.app.quit();
});
const pendingFiles: string[] = [];
const pendingUrls: string[] = [];
function handleUrlArg(u: string) {
    if (!backend || CONSOLE) {
        pendingUrls.push(u);
        return;
    }
    notifyMod.handleUrl(u);
}
async function handleFileArg(file) {
    if (!file || !fs.existsSync(file))
        return;
    if (!backend || CONSOLE) {
        pendingFiles.push(file);
        return;
    }
    const ext = path.extname(file).toLowerCase();
    try {
        if (ext === '.lxup') {
            const front = server2.frontFor(backend);
            const r: any = await front.updates.addFile(file);
            if (r.error)
                electron.dialog.showErrorBox('Atualização recusada', String(r.error));
            else
                backend.push({ type: 'update_available', version: r.available?.version, rev: Number(r.available?.rev || 0) });
        }
        else if (ext === '.lxtheme') {
            const themes = await import('./themes');
            const r: any = themes.themeImportOne(file);
            if (r.error)
                electron.dialog.showErrorBox('Tema', String(r.error));
            else
                win?.webContents.reload();
        }
    }
    catch (e) {
        log.warn('arquivo %s: %s', file, e);
    }
}
if (process.platform === 'darwin') {
    electron.app.on('open-file', (e, file) => {
        e.preventDefault();
        void handleFileArg(file);
    });
}
if (process.platform === 'linux')
    electron.app.commandLine.appendSwitch('disable-dev-shm-usage');
if (process.argv.includes('--no-gpu'))
    electron.app.disableHardwareAcceleration();
if (gotLock)
    void electron.app.whenReady().then(main).catch((e) => {
    try {
        log.error('falha ao iniciar: %s', e);
    }
    catch {
    }
    electron.dialog.showErrorBox('Ludrix', 'Não foi possível iniciar.\n\n' + String(e));
    electron.app.quit();
});
