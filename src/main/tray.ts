import fs from 'node:fs';
import path from 'node:path';
import * as cp from 'node:child_process';
import * as electron from 'electron';
import * as P from './paths';
import * as log from './log';
import * as menu from './menu';

type Spec = { label?: string; fn?: () => any; sep?: boolean; sub?: Spec[]; danger?: boolean; primary?: boolean; disabled?: boolean; icon_key?: string };
type Host = {
    be: any;
    show: () => void;
    quit: () => void;
    js: (code: string) => void;
    frameLast: () => any;
};

let tray: electron.Tray | null = null;
let host: Host | null = null;
let busy = false;

function trayPlay(key: string) {
    return async () => {
        let r: any = {};
        try {
            r = (await host!.be.play(key, 'minimize')) || {};
        }
        catch (e: any) {
            r = { error: String(e?.message || e) };
        }
        if (r.ok && !r.choose_emulator && !r.pick_exe)
            return;
        host!.js(`play(${JSON.stringify(key)})`);
    };
}
function trayStop(key: string) {
    return () => {
        try {
            host!.be.stopGame(key);
        }
        catch (e: any) {
            log.warn('tray stop: %s', e?.message || e);
        }
    };
}
function trayView(v: string) {
    return () => host!.js(`setView('${v}')`);
}
function startFile(p: string) {
    if (p.startsWith('shell:'))
        cp.spawn('explorer.exe', [p], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else
        void electron.shell.openPath(p);
}
let clientsCache: { at: number; list: Spec[] } | null = null;
function trayClients(): Spec[] {
    if (process.platform !== 'win32')
        return [];
    if (clientsCache && Date.now() - clientsCache.at < 120_000)
        return clientsCache.list;
    const list = trayClientsScan();
    clientsCache = { at: Date.now(), list };
    return list;
}
function trayClientsScan(): Spec[] {
    const env = (k: string, d = '') => process.env[k] || d;
    const pf = env('ProgramFiles', 'C:\\Program Files'), pf86 = env('ProgramFiles(x86)', 'C:\\Program Files (x86)'), la = env('LOCALAPPDATA');
    const cands: [string, string[]][] = [
        ['Steam', [`${pf86}\\Steam\\steam.exe`, `${pf}\\Steam\\steam.exe`]],
        ['Epic Games', [`${pf86}\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe`, `${pf86}\\Epic Games\\Launcher\\Portal\\Binaries\\Win32\\EpicGamesLauncher.exe`]],
        ['GOG Galaxy', [`${pf86}\\GOG Galaxy\\GalaxyClient.exe`]],
        ['EA app', [`${pf}\\Electronic Arts\\EA Desktop\\EA Desktop\\EADesktop.exe`]],
        ['Ubisoft Connect', [`${pf86}\\Ubisoft\\Ubisoft Game Launcher\\UbisoftConnect.exe`, `${pf86}\\Ubisoft\\Ubisoft Game Launcher\\upc.exe`]],
        ['Battle.net', [`${pf86}\\Battle.net\\Battle.net Launcher.exe`]],
        ['Rockstar Games', [`${pf}\\Rockstar Games\\Launcher\\Launcher.exe`]],
        ['Amazon Games', [`${la}\\Amazon Games\\App\\Amazon Games.exe`]],
        ['itch', [`${la}\\itch\\itch.exe`]],
    ];
    try {
        const q = cp.spawnSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamExe'], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
        const m = /SteamExe\s+REG_SZ\s+(.+)/i.exec(String(q.stdout || ''));
        if (m)
            cands[0][1].unshift(m[1].trim().replace(/\//g, '\\'));
    }
    catch { /* sem registro */ }
    const out: Spec[] = [];
    for (const [name, exes] of cands) {
        const exe = exes.find((e) => e && fs.existsSync(e));
        if (exe)
            out.push({ label: name, fn: () => startFile(exe) });
    }
    if (la && fs.existsSync(path.join(la, 'Packages', 'Microsoft.GamingApp_8wekyb3d8bbwe')))
        out.push({ label: 'Xbox', fn: () => startFile('shell:AppsFolder\\Microsoft.GamingApp_8wekyb3d8bbwe!Microsoft.Xbox.App') });
    return out;
}
function trayGames(n = 10): [Spec[], Spec[]] {
    const be = host!.be;
    const lib: [string, any][] = Object.entries<any>(be.store.library).filter(([k, g]) => g && typeof g === 'object' && g.installed && g.kind !== 'emulator' && !be.sessions.active.has(k));
    const rec = lib.filter(([, g]) => g.last_played).sort((a, b) => Number(b[1].last_played || 0) - Number(a[1].last_played || 0));
    const fav = lib.filter(([, g]) => g.favorite).sort((a, b) => String(a[1].title || a[0]).toLowerCase().localeCompare(String(b[1].title || b[0]).toLowerCase()));
    const item = (k: string, g: any): Spec => ({ label: String(g.title || k).slice(0, 48), fn: trayPlay(k), icon_key: k });
    return [rec.slice(0, n).map(([k, g]) => item(k, g)), fav.slice(0, 15).map(([k, g]) => item(k, g))];
}
export function traySpecs(rich: boolean): Spec[] {
    const be = host!.be;
    const specs: Spec[] = [];
    const act: any[] = [...be.sessions.active.values()];
    for (const s of act) {
        const mins = Math.floor((Date.now() / 1000 - Number(s.started || Date.now() / 1000)) / 60);
        specs.push({ label: `Encerrar ${String(s.title || '').slice(0, 40)} · ${mins} min`, fn: trayStop(s.key), danger: true, icon_key: s.key });
    }
    if (act.length)
        specs.push({ sep: true });
    const [rec, fav] = trayGames();
    specs.push(...(rec.length ? rec : [{ label: 'Nenhum jogo recente', disabled: true }]));
    if (fav.length)
        specs.push({ label: 'Favoritos', sub: fav });
    specs.push({ sep: true });
    if (rich)
        specs.push({ label: 'Abrir Ludrix', fn: () => host!.show(), primary: true });
    const views: [string, string][] = [['home', 'Biblioteca'], ['store', 'Store'], ['emulation', 'Emuladores'], ['mods', 'Mods e ferramentas'], ['central', 'Central'], ['flash', 'Jogos rápidos'], ['downloads', 'Fila'], ['settings', 'Ajustes']];
    specs.push({ label: 'Ir para', sub: views.map(([v, n]) => ({ label: n, fn: trayView(v) })) });
    const cl = trayClients();
    if (cl.length)
        specs.push({ label: 'Lojas e clientes', sub: cl });
    const n = Object.keys(be.jobs.all() || {}).length;
    if (n)
        specs.push({ label: `Fila: ${n} em andamento`, fn: trayView('downloads') });
    specs.push({ sep: true });
    specs.push({ label: 'Verificar atualizações', fn: () => host!.js('checkUpdates()') });
    specs.push({ label: 'Abrir pasta do Ludrix', fn: () => be.openPath(P.ROOT) });
    if (rich) {
        specs.push({ sep: true });
        specs.push({ label: 'Sair', fn: () => host!.quit() });
    }
    return specs;
}

async function thumbData(key: string): Promise<string | null> {
    try {
        const p = await host!.be.hub.thumbPath(key, false);
        if (!p || !fs.existsSync(p))
            return null;
        const ext = path.extname(p).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
    }
    catch {
        return null;
    }
}

async function toMenuItems(specs: Spec[]): Promise<menu.MenuItem[]> {
    const out: menu.MenuItem[] = [];
    for (const s of specs) {
        if (s.sep) {
            out.push({ sep: true });
            continue;
        }
        out.push({ label: s.label, danger: s.danger, primary: s.primary, disabled: s.disabled, icon: s.icon_key ? await thumbData(s.icon_key) : null, sub: s.sub ? await toMenuItems(s.sub) : null });
    }
    return out;
}

function pickFn(specs: Spec[], pick: string): (() => any) | undefined {
    let node: Spec | undefined;
    let lst = specs;
    for (const part of String(pick).split('.')) {
        node = lst[Number(part)];
        lst = node?.sub || [];
    }
    return node?.fn;
}

async function popup() {
    if (busy || !host)
        return;
    busy = true;
    try {
        const specs = traySpecs(true);
        const fl = host.frameLast() || {};
        const r = await menu.show({ items: await toMenuItems(specs), colors: fl.colors || {}, light: fl.dark === false, x: 0, y: 0, atCursor: true });
        if (r?.ok && r.pick != null) {
            const fn = pickFn(specs, r.pick);
            if (fn) {
                try {
                    await fn();
                }
                catch (e: any) {
                    log.warn('bandeja: %s', e?.message || e);
                }
            }
        }
    }
    finally {
        busy = false;
    }
}

function nativeMenu() {
    const specs = traySpecs(false);
    const conv = (list: Spec[]): electron.MenuItemConstructorOptions[] => list.map((s) => s.sep ? { type: 'separator' } : {
        label: String(s.label || ''), enabled: !s.disabled, submenu: s.sub ? conv(s.sub) : undefined, click: s.fn ? () => { void Promise.resolve().then(s.fn!).catch((e) => log.warn('bandeja: %s', e?.message || e)); } : undefined,
    });
    return electron.Menu.buildFromTemplate([
        { label: 'Abrir Ludrix', click: () => host?.show() },
        { type: 'separator' },
        ...conv(specs),
        { type: 'separator' },
        { label: 'Sair', click: () => host?.quit() },
    ]);
}

export function build(h: Host) {
    host = h;
    if (tray)
        return tray;
    if (h.be.store.config.tray_enabled === false)
        return null;
    const iconPath = path.join(P.UI, 'icon.png');
    if (!fs.existsSync(iconPath))
        return null;
    try {
        const img = electron.nativeImage.createFromPath(iconPath).resize({ width: process.platform === 'win32' ? 32 : 22, height: process.platform === 'win32' ? 32 : 22 });
        tray = new electron.Tray(img);
        tray.setToolTip('LudrixHub');
        tray.on('click', () => h.show());
        tray.on('double-click', () => h.show());
        if (menu.available()) {
            tray.on('right-click', () => void popup());
        }
        else {
            tray.setContextMenu(nativeMenu());
            tray.on('right-click', () => { try { tray?.setContextMenu(nativeMenu()); } catch { /* */ } });
        }
    }
    catch (e: any) {
        log.warn('bandeja indisponível: %s', e?.message || e);
        tray = null;
    }
    return tray;
}
export function refresh() {
    if (tray && !menu.available()) {
        try {
            tray.setContextMenu(nativeMenu());
        }
        catch { /* */ }
    }
}
export function notify(msg: string) {
    try {
        if (process.platform === 'win32' && tray)
            tray.displayBalloon({ title: 'LudrixHub', content: msg, iconType: 'info' });
        else if (electron.Notification.isSupported())
            new electron.Notification({ title: 'LudrixHub', body: msg, silent: true }).show();
    }
    catch { /* */ }
}
export function destroy() {
    try {
        tray?.destroy();
    }
    catch { /* */ }
    tray = null;
}
export const present = () => Boolean(tray);
