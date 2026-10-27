import fs from 'node:fs';
import path from 'node:path';
import * as cp from 'node:child_process';
import * as electron from 'electron';
import * as P from './paths';
import * as log from './log';

type Spec = { label?: string; fn?: () => any; sep?: boolean; sub?: Spec[]; danger?: boolean; primary?: boolean; disabled?: boolean; title?: boolean; icon_key?: string };
type Host = {
    be: any;
    show: () => void;
    quit: () => void;
    js: (code: string) => void;
    frameLast: () => any;
};

let tray: electron.Tray | null = null;
let host: Host | null = null;

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
    catch { }
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
    const lib: [string, any][] = Object.entries<any>(be.store.library).filter(([k, g]) => g && typeof g === 'object' && g.kind !== 'emulator' && !g.hidden && !be.sessions.active.has(k) && (g.installed || (g.exe || g.dir ? be.store.isInstalled(k) : Boolean(g.last_played))));
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
    if (rec.length) {
        specs.push({ label: 'Jogados recentemente', title: true });
        specs.push(...rec);
    }
    if (fav.length)
        specs.push({ label: 'Favoritos', sub: fav });
    if (rec.length || fav.length)
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

function nativeMenu() {
    const specs = traySpecs(false);
    const conv = (list: Spec[]): electron.MenuItemConstructorOptions[] => list.map((s) => s.sep ? { type: 'separator' } : s.title ? { label: String(s.label || ''), enabled: false } : {
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
        tray.setContextMenu(nativeMenu());
        tray.on('right-click', () => { try { tray?.setContextMenu(nativeMenu()); } catch { } });
    }
    catch (e: any) {
        log.warn('bandeja indisponível: %s', e?.message || e);
        tray = null;
    }
    return tray;
}
export function refresh() {
    if (tray) {
        try {
            tray.setContextMenu(nativeMenu());
        }
        catch { }
    }
}
export function notify(msg: string) {
    try {
        if (process.platform === 'win32' && tray)
            tray.displayBalloon({ title: 'LudrixHub', content: msg, iconType: 'info' });
        else if (electron.Notification.isSupported())
            new electron.Notification({ title: 'LudrixHub', body: msg, silent: true }).show();
    }
    catch { }
}
export function destroy() {
    try {
        tray?.destroy();
    }
    catch { }
    tray = null;
}
export const present = () => Boolean(tray);
