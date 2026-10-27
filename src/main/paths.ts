import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
let eapp: any = null;
try {
    eapp = (require('electron') as any).app || null;
}
catch {
    eapp = null;
}
const FROZEN = Boolean(eapp && eapp.isPackaged);
function appDir() {
    const envApp = process.env.LUDRIX_APP;
    if (envApp && fs.existsSync(path.join(envApp, 'package.json')))
        return path.resolve(envApp);
    try {
        if (eapp)
            return path.resolve(eapp.getAppPath());
    }
    catch { }
    return path.resolve(__dirname, '..', '..');
}
function appRoot() {
    const home = process.env.LUDRIX_HOME;
    if (home && home.trim())
        return path.resolve(home.trim());
    const portable = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portable && portable.trim())
        return path.resolve(portable.trim());
    const ad = appDir();
    if (path.basename(ad).toLowerCase() === 'app' && !fs.existsSync(path.join(ad, 'src')))
        return path.dirname(ad);
    if (FROZEN) {
        const exeDir = path.dirname(eapp.getPath('exe'));
        if (process.platform === 'linux' && (process.env.APPIMAGE || !writable(exeDir)))
            return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'Ludrix');
        return exeDir;
    }
    return ad;
}
function writable(dir: string): boolean {
    try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; }
}
const ROOT = appRoot()
const DATA = path.join(exports.ROOT, 'data')
const CACHE = path.join(exports.DATA, 'cache')
const CACHE_WEB = path.join(exports.CACHE, 'web')
const CACHE_THUMBS = path.join(exports.CACHE, 'thumbs')
const CACHE_COVERS = path.join(exports.CACHE, 'covers')
const CACHE_META = path.join(exports.CACHE, 'meta')
const CACHE_SHOTS = path.join(exports.CACHE, 'shots')
const DOWNLOADS = path.join(exports.ROOT, 'downloads')
const GAMES = path.join(exports.ROOT, 'games')
const EMU = path.join(exports.ROOT, 'emulation')
const EMU_EMULATORS = path.join(exports.EMU, 'emulators')
const EMU_GAMES = path.join(exports.EMU, 'games')
const EMU_BIOS = path.join(exports.EMU, 'bios')
const TOOLS = path.join(exports.DATA, 'tools')
const THEMES = path.join(exports.ROOT, 'themes')
const FLASH = path.join(exports.GAMES, 'rapidos')
const REDISTS = path.join(exports.DOWNLOADS, 'redists')
const UPDATES = path.join(exports.DATA, 'updates')
const BIN = path.join(exports.DATA, 'bin')
const BACKUPS = path.join(exports.DATA, 'backups')
const APP_DIR = appDir();
const UI = fs.existsSync(path.join(APP_DIR, 'ui', 'index.html'))
    ? path.join(APP_DIR, 'ui')
    : FROZEN && fs.existsSync(path.join(process.resourcesPath, 'renderer'))
        ? path.join(process.resourcesPath, 'renderer')
        : path.join(APP_DIR, 'src', 'renderer');
const ASSETS = fs.existsSync(path.join(APP_DIR, 'assets'))
    ? path.join(APP_DIR, 'assets')
    : FROZEN && fs.existsSync(path.join(process.resourcesPath, 'assets'))
        ? path.join(process.resourcesPath, 'assets')
        : path.join(APP_DIR, 'src', 'main', 'assets');
const CONFIG_FILE = path.join(exports.DATA, 'config.json')
const LIBRARY_FILE = path.join(exports.DATA, 'library.json')
const LOG_FILE = path.join(exports.DATA, 'ludrix.log')
const INSTANCE_FILE = path.join(exports.DATA, 'instance.json')
const BOOT_FILE = path.join(exports.DATA, 'boot.json')
const PENDING_VERIFY = path.join(exports.UPDATES, 'pending_verify.json')
function bootRead() {
    try {
        const raw = JSON.parse(fs.readFileSync(exports.BOOT_FILE, 'utf8'));
        return raw && typeof raw === 'object' ? raw : {};
    }
    catch {
        return {};
    }
}
function bootWrite(d) {
    try {
        fs.mkdirSync(path.dirname(exports.BOOT_FILE), { recursive: true });
        fs.writeFileSync(exports.BOOT_FILE, JSON.stringify(d), 'utf8');
    }
    catch {
    }
}
function bootTries() {
    return Number(bootRead().tries || 0);
}
function bootBegin() {
    const d = bootRead();
    const tries = Number(d.tries || 0);
    d.tries = tries + 1;
    d.at = Date.now();
    bootWrite(d);
    return tries >= 2;
}
function bootOk() {
    const d = bootRead();
    if (d.tries) {
        d.tries = 0;
        bootWrite(d);
    }
    try {
        fs.rmSync(exports.PENDING_VERIFY, { force: true });
    }
    catch {
    }
}
function ensureDirs() {
    for (const d of [
        exports.DATA, exports.CACHE_WEB, exports.CACHE_THUMBS, exports.CACHE_COVERS, exports.CACHE_META, exports.CACHE_SHOTS,
        exports.DOWNLOADS, exports.GAMES, exports.EMU_EMULATORS, exports.EMU_GAMES, exports.EMU_BIOS, exports.UPDATES, exports.BACKUPS,
    ]) {
        try {
            fs.mkdirSync(d, { recursive: true });
        }
        catch {
        }
    }
}
function dirSize(p) {
    let total = 0;
    if (!fs.existsSync(p))
        return 0;
    const walk = (dir) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            try {
                if (e.isDirectory())
                    walk(full);
                else if (e.isFile())
                    total += fs.statSync(full).size;
            }
            catch {
            }
        }
    };
    walk(p);
    return total;
}
async function dirSizeAsync(p) {
    let total = 0;
    const walk = async (dir) => {
        let entries;
        try {
            entries = await fs.promises.readdir(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            try {
                if (e.isDirectory())
                    await walk(full);
                else if (e.isFile())
                    total += (await fs.promises.stat(full)).size;
            }
            catch {
            }
        }
    };
    if (fs.existsSync(p))
        await walk(p);
    return total;
}

export { APP_DIR, bootTries, bootBegin, bootOk, bootRead, bootWrite, ensureDirs, dirSize, dirSizeAsync, FROZEN, ROOT, DATA, CACHE, CACHE_WEB, CACHE_THUMBS, CACHE_COVERS, CACHE_META, CACHE_SHOTS, DOWNLOADS, GAMES, EMU, EMU_EMULATORS, EMU_GAMES, EMU_BIOS, TOOLS, THEMES, FLASH, REDISTS, UPDATES, BIN, BACKUPS, UI, ASSETS, CONFIG_FILE, LIBRARY_FILE, LOG_FILE, INSTANCE_FILE, BOOT_FILE, PENDING_VERIFY };
