import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as cp from 'node:child_process';
import * as log from './log';
import * as playnite from './playnite';
import { normalizeTitle } from './titles';
import { guessSystem } from './repos';
import { findExecutables } from './installer';
import { decodeHtmlEntities } from './http';

export const ROM_EXTS = new Set(['.chd', '.iso', '.cue', '.bin', '.img', '.pbp', '.cso', '.z64', '.n64', '.v64', '.nds', '.gba', '.gb', '.gbc', '.sfc', '.smc',
    '.nes', '.md', '.gen', '.smd', '.gcm', '.rvz', '.wbfs', '.wad', '.gdi', '.cdi', '.xiso', '.xex', '.wua', '.wud', '.wux',
    '.rpx', '.nsp', '.xci', '.3ds', '.cci', '.sms', '.gg', '.pce', '.a26', '.zip', '.7z']);

export const ES_SYSTEMS: Record<string, string> = { psx: 'ps1', ps1: 'ps1', ps2: 'ps2', ps3: 'ps3', psp: 'psp', n64: 'n64', gc: 'gc', gamecube: 'gc', wii: 'wii',
    wiiu: 'wiiu', switch: 'switch', '3ds': '3ds', n3ds: '3ds', nds: 'nds', gba: 'gba', gb: 'gba', gbc: 'gba',
    snes: 'snes', nes: 'nes', megadrive: 'genesis', genesis: 'genesis', mastersystem: 'sms', gamegear: 'sms',
    pcengine: 'pce', tg16: 'pce', atari2600: 'atari2600', dreamcast: 'dc', saturn: 'saturn', xbox: 'xbox',
    xbox360: 'x360', arcade: 'arcade', mame: 'arcade', fbneo: 'arcade', dos: 'dos', pc: 'pc', windows: 'pc' };

export let PROGRESS: ((m: string) => void) | null = null;
export let EXT_GUESS: ((p: string) => string) | null = null;
export function setProgress(fn: ((m: string) => void) | null) {
    PROGRESS = fn;
}
export function setExtGuess(fn: ((p: string) => string) | null) {
    EXT_GUESS = fn;
}

const home = () => os.homedir();
const env = (name: string, dflt = '') => process.env[name] || dflt || home();
const WIN = process.platform === 'win32';

function exists(p: string): boolean {
    try {
        fs.statSync(p);
        return true;
    }
    catch {
        return false;
    }
}
function isDir(p: string): boolean {
    try {
        return fs.statSync(p).isDirectory();
    }
    catch {
        return false;
    }
}
function isFile(p: string): boolean {
    try {
        return fs.statSync(p).isFile();
    }
    catch {
        return false;
    }
}
function readText(p: string): string {
    return fs.readFileSync(p, 'utf8');
}
function listDir(p: string): string[] {
    try {
        return fs.readdirSync(p);
    }
    catch {
        return [];
    }
}
function stemOf(p: string): string {
    return path.parse(p).name;
}
function extOf(p: string): string {
    return path.extname(p).toLowerCase();
}

function xmlBlocks(src: string, tag: string): string[] {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'g');
    return [...src.matchAll(re)].map((m) => m[1]);
}
function xmlText(src: string, tag: string): string {
    const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`).exec(src);
    if (!m)
        return '';
    return decodeHtmlEntities(m[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')).trim();
}
function xmlAttr(src: string, tag: string, attr: string): string {
    const m = new RegExp(`<${tag}\\b[^>]*?\\s${attr}="([^"]*)"`, 'i').exec(src);
    return m ? decodeHtmlEntities(m[1]) : '';
}

function regQuery(key: string, args: string[] = []): string {
    if (!WIN)
        return '';
    try {
        return cp.execFileSync('reg', ['query', key, ...args], { windowsHide: true, timeout: 8000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    }
    catch {
        return '';
    }
}
function regValue(out: string, name: string): string {
    const m = new RegExp(`^\\s+${name}\\s+REG_\\w+\\s+(.*)$`, 'im').exec(out);
    return m ? m[1].trim() : '';
}

export const LAUNCHERS: any[] = [
    { id: 'playnite', name: 'Playnite', icon: 'P',
        default: () => playniteDefault(),
        pick: 'file', pick_kind: 'archive', pick_alt: 'folder', alt_label: 'Ou apontar a pasta do Playnite…',
        what: "O arquivo .zip de BACKUP do Playnite. No Playnite: menu ☰ → Arquivo → Backup de dados → marque 'Biblioteca' e 'Arquivos da biblioteca' (capas) → salva um .zip. São lidos dele: jogos com pasta/executável/ROM, tempo jogado, favoritos, ano, capas e fundos, emuladores (exe + argumentos) e pastas de ROMs — tudo de uma vez.",
        tip: 'Também dá pra apontar direto a pasta do Playnite (%AppData%\\Playnite ou a pasta portátil) — funciona até com o Playnite aberto. Não precisa instalar nada no Playnite.' },
    { id: 'heroic', name: 'Heroic Games Launcher', icon: 'H',
        default: () => path.join(env('APPDATA'), 'heroic'),
        pick: 'folder',
        what: 'A pasta de configuração do Heroic (%AppData%\\heroic). São lidos os jogos instalados da Epic/GOG/Amazon e os jogos adicionados manualmente (sideload).',
        tip: 'Se usar a versão da Microsoft Store, a pasta fica em %LocalAppData%\\Packages\\…Heroic…\\LocalCache\\Roaming\\heroic.' },
    { id: 'steam', name: 'Steam', icon: 'S',
        default: () => path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'),
        pick: 'folder',
        what: 'A pasta de instalação da Steam (ex.: C:\\Program Files (x86)\\Steam). São lidos steamapps\\libraryfolders.vdf e os appmanifest_*.acf de todas as bibliotecas.',
        tip: "Os jogos ficam com 'Jogar' abrindo via steam://rungameid — a Steam precisa estar aberta. Jogos que não são da Steam (atalhos) não entram." },
    { id: 'epic', name: 'Epic Games Launcher', icon: 'E',
        default: () => path.join(env('ProgramData', 'C:\\ProgramData'), 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests'),
        pick: 'folder',
        what: 'A pasta de manifestos da Epic: C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests (arquivos .item).',
        tip: 'O executável é usado direto (sem passar pela Epic) — alguns jogos exigem a Epic aberta pra login.' },
    { id: 'gog', name: 'GOG Galaxy', icon: 'G',
        default: () => path.join(env('ProgramData', 'C:\\ProgramData'), 'GOG.com', 'Galaxy', 'storage', 'galaxy-2.0.db'),
        pick: 'file',
        what: 'O banco de dados do Galaxy: C:\\ProgramData\\GOG.com\\Galaxy\\storage\\galaxy-2.0.db. Pego só os jogos instalados.',
        tip: "Se der 'banco bloqueado', feche o GOG Galaxy antes de importar." },
    { id: 'esde', name: 'EmulationStation / RetroBat / Batocera', icon: 'R',
        default: () => path.join(home(), 'ES-DE'),
        pick: 'folder',
        what: 'A pasta de ROMs (a que tem uma subpasta por console: psx, snes, n64…). No RetroBat é <RetroBat>\\roms; no ES-DE é ~\\ROMs.',
        tip: "Cada subpasta é mapeada pro console certo e adicionada como 'pasta de ROMs' — o gamelist.xml (nome bonito, tempo jogado) é lido quando existir." },
    { id: 'launchbox', name: 'LaunchBox / BigBox', icon: 'L',
        default: () => 'C:\\Users\\Public\\LaunchBox',
        pick: 'folder',
        what: 'A pasta do LaunchBox (a que tem Data\\Platforms\\*.xml). Importo jogos de Windows (.exe) e ROMs com a plataforma reconhecida.',
        tip: "Plataformas com nome fora do padrão (ex.: 'Sony PSX') são mapeadas por palavras-chave." },
    { id: 'pegasus', name: 'Pegasus Frontend', icon: 'Pg',
        default: () => WIN ? path.join(env('LOCALAPPDATA'), 'pegasus-frontend') : path.join(home(), '.config', 'pegasus-frontend'),
        pick: 'file',
        what: 'Um arquivo metadata.pegasus.txt (ou metadata.txt) de uma coleção.',
        tip: "Cada 'collection' vira um console se o nome bater (PlayStation, SNES…)." },
    { id: 'xbox', name: 'Xbox / PC Game Pass', icon: 'X',
        default: () => xboxDefault(),
        pick: 'folder',
        what: 'A pasta XboxGames (fica na raiz do disco escolhido no app Xbox, ex.: C:\\XboxGames). Cada jogo tem Content\\MicrosoftGame.config, de onde saem nome e executável.',
        tip: 'Os jogos abrem pelo gamelaunchhelper.exe de cada pasta, que faz a verificação da assinatura Game Pass. Jogos instalados pela Microsoft Store antiga (WindowsApps) não entram.' },
    { id: 'ea', name: 'EA app', icon: 'EA',
        default: () => path.join(env('ProgramFiles', 'C:\\Program Files'), 'EA Games'),
        pick: 'folder',
        what: 'A pasta onde o EA app instala os jogos (padrão C:\\Program Files\\EA Games). O nome e o executável vêm de __Installer\\installerdata.xml de cada jogo.',
        tip: 'O executável é aberto direto; o EA app sobe sozinho quando o jogo exige login.' },
    { id: 'ubisoft', name: 'Ubisoft Connect', icon: 'U',
        default: () => path.join(env('ProgramFiles(x86)', 'C:\\Program Files (x86)'), 'Ubisoft', 'Ubisoft Game Launcher', 'games'),
        pick: 'folder',
        what: 'A pasta games do Ubisoft Connect (padrão C:\\Program Files (x86)\\Ubisoft\\Ubisoft Game Launcher\\games). O registro do Windows é lido para achar jogos instalados em outros discos.',
        tip: "Os jogos ficam com 'Jogar' abrindo via uplay://launch — o Ubisoft Connect precisa estar instalado." },
    { id: 'shortcuts', name: 'Atalhos (Área de trabalho / Menu Iniciar)', icon: '↗',
        default: () => path.join(home(), 'Desktop'),
        pick: 'folder',
        what: 'Uma pasta com atalhos .lnk (ex.: Área de trabalho). Cada atalho que aponta pra um .exe vira um jogo.',
        tip: 'Ignoro atalhos de programas comuns (navegadores, Office, desinstaladores).' },
];

export function listLaunchers(): any[] {
    return LAUNCHERS.map((l) => {
        let d = '', ex = false;
        try {
            d = l.default();
            ex = exists(d);
        }
        catch {
            d = '';
            ex = false;
        }
        const out: any = {};
        for (const [k, v] of Object.entries(l))
            if (k !== 'default')
                out[k] = v;
        return { ...out, default_path: d, detected: ex };
    });
}

function clean(t: string): string {
    return (t || '').replace(/\s*[\(\[].*?[\)\]]/g, '').replace(/\s{2,}/g, ' ').trim();
}

function sysFromName(name: string): string {
    const n = (name || '').toLowerCase().trim();
    if (ES_SYSTEMS[n])
        return ES_SYSTEMS[n];
    if (ES_SYSTEMS[n.replace(/ /g, '')])
        return ES_SYSTEMS[n.replace(/ /g, '')];
    return guessSystem(n);
}

function sysFromFile(p: string): string {
    if (EXT_GUESS) {
        try {
            return EXT_GUESS(p) || '';
        }
        catch {
            return '';
        }
    }
    return '';
}

function game(title: string, exe: string | null = null, rom: string | null = null, system = 'pc', playtime = 0, lastPlayed = 0, source = '', extra: any = null): any {
    return { title: normalizeTitle(title) || clean(title) || title, exe, rom, system: system || 'pc',
        playtime: Number(playtime || 0), last_played: Number(lastPlayed || 0), source, ...(extra || {}) };
}

function playniteDefault(): string {
    const cands: string[] = [];
    for (const d of [path.join(home(), 'Desktop'), path.join(home(), 'Downloads'), path.join(home(), 'Documents'), path.join(home(), 'Área de Trabalho'),
        path.join(home(), 'OneDrive', 'Desktop'), path.join(home(), 'OneDrive', 'Área de Trabalho')]) {
        if (isDir(d))
            for (const n of listDir(d))
                if (n.toLowerCase().endsWith('.zip') && looksPlayniteBackup(path.join(d, n)))
                    cands.push(path.join(d, n));
    }
    if (cands.length)
        return cands.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    return path.join(env('APPDATA'), 'Playnite');
}

function looksPlayniteBackup(z: string): boolean {
    try {
        if (fs.statSync(z).size < 100 * 1024)
            return false;
        const AdmZip = require('adm-zip');
        const entries = new AdmZip(z).getEntries().slice(0, 400);
        return entries.some((e: any) => e.entryName.replace(/\\/g, '/').toLowerCase().endsWith('library/games.db'));
    }
    catch {
        return false;
    }
}

export function playniteEmuOf(name: string): string {
    return playnite.emuOf(name);
}

export function playniteDropped(): any[] {
    return [...playnite.DROPPED];
}

function readPlaynite(p: string): any[] {
    playnite.setProgress(PROGRESS);
    playnite.setExtGuess(EXT_GUESS);
    playnite.DROPPED.length = 0;
    if (extOf(p) === '.json')
        throw new Error('A importação por .json foi aposentada. Use o backup do Playnite: no Playnite, Arquivo → Backup de dados → gera um .zip; selecione esse .zip aqui.');
    return playnite.read(p);
}

function readJson(p: string): any {
    return JSON.parse(readText(p));
}

function readHeroic(p: string): any[] {
    const out: any[] = [];
    const files = [path.join(p, 'sideload_apps', 'library.json'), path.join(p, 'gog_store', 'installed.json'),
        path.join(p, 'store_cache', 'legendary_library.json'), path.join(p, 'legendaryConfig', 'legendary', 'installed.json'),
        path.join(p, 'store_cache', 'gog_library.json'), path.join(p, 'nile_config', 'nile', 'installed.json')];
    if (!files.some(exists))
        throw new Error('Não parece a pasta do Heroic (não achei sideload_apps, gog_store nem legendaryConfig).');
    let f = files[0];
    if (exists(f)) {
        for (const g of readJson(f).games || []) {
            const exe = (g.install || {}).executable || g.executable;
            if (exe)
                out.push(game(g.title || '', exe, null, 'pc', 0, 0, 'heroic', { dir: (g.install || {}).install_path || '' }));
        }
    }
    f = files[3];
    if (exists(f)) {
        for (const g of Object.values<any>(readJson(f))) {
            const ip = g.install_path || '', e = g.executable || '';
            if (ip && e)
                out.push(game(g.title || '', path.join(ip, e), null, 'pc', 0, 0, 'heroic/epic', { dir: ip }));
        }
    }
    f = files[1];
    if (exists(f)) {
        const titles: Record<string, string> = {};
        if (exists(files[4])) {
            try {
                for (const g of readJson(files[4]).games || [])
                    titles[String(g.app_name)] = g.title;
            }
            catch { }
        }
        for (const g of readJson(f).installed || []) {
            const ip = g.install_path || '';
            if (ip)
                out.push(game(titles[String(g.appName)] || path.basename(ip), null, null, 'pc', 0, 0, 'heroic/gog', { dir: ip }));
        }
    }
    f = files[5];
    if (exists(f)) {
        try {
            for (const g of readJson(f)) {
                const ip = g.path || '';
                if (ip)
                    out.push(game(path.basename(ip), null, null, 'pc', 0, 0, 'heroic/amazon', { dir: ip }));
            }
        }
        catch { }
    }
    return out;
}

function readSteam(p: string): any[] {
    const sa = path.join(p, 'steamapps');
    if (!exists(sa))
        throw new Error('Pasta steamapps não encontrada aí dentro. Selecione a pasta onde a Steam está instalada.');
    const libs = [sa];
    const vdf = path.join(sa, 'libraryfolders.vdf');
    if (exists(vdf)) {
        for (const m of readText(vdf).matchAll(/"path"\s+"([^"]+)"/g)) {
            const lp = path.join(m[1].replace(/\\\\/g, '\\'), 'steamapps');
            if (exists(lp) && !libs.includes(lp))
                libs.push(lp);
        }
    }
    const out: any[] = [];
    const skip = /redistributable|steamworks common|proton|steam linux runtime|soundtrack|dedicated server|sdk|vr$/i;
    for (const lib of libs) {
        for (const n of listDir(lib)) {
            if (!/^appmanifest_.*\.acf$/.test(n))
                continue;
            const t = readText(path.join(lib, n));
            const g = (k: string) => (new RegExp(`"${k}"\\s+"([^"]*)"`).exec(t) || [null, ''])[1];
            const name = g('name'), appid = g('appid'), folder = g('installdir');
            if (!name || skip.test(name))
                continue;
            const d = path.join(lib, 'common', folder);
            const lp = g('LastPlayed');
            out.push(game(name, `steam://rungameid/${appid}`, null, 'pc', 0, Number(lp || 0), 'steam', { dir: d, steam_appid: appid }));
        }
    }
    return out;
}

function readEpic(p: string): any[] {
    const items = isDir(p) ? listDir(p).filter((n) => n.toLowerCase().endsWith('.item')).map((n) => path.join(p, n)) : [];
    if (!items.length)
        throw new Error('Nenhum arquivo .item nessa pasta. Selecione ...\\Epic\\EpicGamesLauncher\\Data\\Manifests.');
    const out: any[] = [];
    for (const it of items) {
        let d: any;
        try {
            d = readJson(it);
        }
        catch {
            continue;
        }
        if (d.bIsIncompleteInstall || !d.InstallLocation)
            continue;
        const exe = d.LaunchExecutable ? path.join(d.InstallLocation, d.LaunchExecutable) : null;
        out.push(game(d.DisplayName || '', exe, null, 'pc', 0, 0, 'epic', { dir: d.InstallLocation }));
    }
    return out;
}

function readGog(p: string): any[] {
    const db = isFile(p) ? p : path.join(p, 'galaxy-2.0.db');
    if (!exists(db))
        throw new Error('Selecione o arquivo galaxy-2.0.db.');
    const out: any[] = [];
    const seen = new Set<string>();
    for (const hive of ['HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', 'HKLM\\SOFTWARE\\GOG.com\\Games']) {
        const lst = regQuery(hive);
        for (const line of lst.split(/\r?\n/)) {
            const k = line.trim();
            if (!k.toLowerCase().startsWith(hive.toLowerCase() + '\\'))
                continue;
            const v = regQuery(k);
            const dir = regValue(v, 'path').replace(/[\\/]+$/, '');
            if (!dir || !isDir(dir) || seen.has(dir.toLowerCase()))
                continue;
            seen.add(dir.toLowerCase());
            out.push(game(regValue(v, 'gameName') || path.basename(dir), null, null, 'pc', 0, 0, 'gog', { dir }));
        }
    }
    if (!out.length) {
        const roots = [path.join(env('ProgramFiles(x86)', 'C:\\Program Files (x86)'), 'GOG Galaxy', 'Games'), path.join(env('ProgramFiles', 'C:\\Program Files'), 'GOG Galaxy', 'Games'), 'C:\\GOG Games'];
        for (const r of roots) {
            if (!isDir(r))
                continue;
            for (const n of listDir(r)) {
                const d = path.join(r, n);
                if (!isDir(d) || seen.has(d.toLowerCase()))
                    continue;
                const info = listDir(d).find((x) => /^goggame-\d+\.info$/i.test(x));
                if (!info)
                    continue;
                let title = n;
                try {
                    title = readJson(path.join(d, info)).name || n;
                }
                catch { }
                seen.add(d.toLowerCase());
                out.push(game(title, null, null, 'pc', 0, 0, 'gog', { dir: d }));
            }
        }
    }
    return out;
}

function readEsde(p: string): any[] {
    const roms = isDir(path.join(p, 'roms')) ? path.join(p, 'roms') : isDir(path.join(p, 'ROMs')) ? path.join(p, 'ROMs') : p;
    const subs = listDir(roms).map((n) => path.join(roms, n)).filter(isDir);
    const mapped = subs.map((d) => [d, ES_SYSTEMS[path.basename(d).toLowerCase()]] as [string, string | undefined]).filter(([, s]) => s && s !== 'pc') as Array<[string, string]>;
    if (!mapped.length)
        throw new Error("Nenhuma subpasta de console reconhecida (psx, snes, n64, megadrive…). Selecione a pasta 'roms'.");
    const out: any[] = [];
    for (const [d, sysid] of mapped) {
        const gl = path.join(d, 'gamelist.xml');
        let names = 0;
        if (exists(gl)) {
            try {
                names = xmlBlocks(readText(gl), 'game').length;
            }
            catch { }
        }
        out.push({ rom_dir: d, system: sysid, source: 'esde', title: `${path.basename(d)} (${listDir(d).length} arquivos)`, names });
    }
    return out;
}

function readLaunchbox(p: string): any[] {
    const plat = path.join(p, 'Data', 'Platforms');
    if (!isDir(plat))
        throw new Error('Data\\Platforms não encontrado. Selecione a pasta raiz do LaunchBox.');
    const out: any[] = [];
    for (const n of listDir(plat)) {
        if (!n.toLowerCase().endsWith('.xml'))
            continue;
        const fileSys = sysFromName(stemOf(n));
        let txt: string;
        try {
            txt = readText(path.join(plat, n));
        }
        catch {
            continue;
        }
        for (const g of xmlBlocks(txt, 'Game')) {
            const title = xmlText(g, 'Title');
            const app = xmlText(g, 'ApplicationPath');
            if (!title || !app)
                continue;
            const ap = path.isAbsolute(app) || /^[A-Za-z]:/.test(app) ? app : path.join(p, app);
            const pt = Number(xmlText(g, 'PlayTime') || 0);
            const lp = xmlText(g, 'LastPlayedDate');
            const sysid = sysFromName(xmlText(g, 'Platform')) || fileSys || sysFromFile(ap);
            if (['.exe', '.bat', '.lnk'].includes(extOf(ap)) || sysid === 'pc')
                out.push(game(title, ap, null, 'pc', pt, 0, 'launchbox', { dir: path.dirname(ap), lp_raw: lp }));
            else if (sysid)
                out.push(game(title, null, ap, sysid, pt, 0, 'launchbox'));
        }
    }
    return out;
}

function readPegasus(p: string): any[] {
    let f: string | null = null;
    if (isFile(p))
        f = p;
    else {
        const names = listDir(p);
        const a = names.find((n) => /^metadata.*\.txt$/i.test(n)) || names.find((n) => n.toLowerCase().endsWith('.metadata.pegasus.txt'));
        f = a ? path.join(p, a) : null;
    }
    if (!f)
        throw new Error('Selecione um metadata.pegasus.txt.');
    const out: any[] = [];
    let collSys = '';
    let cur: any = null;
    const base = path.dirname(f);
    const abs = (v: string) => path.isAbsolute(v) || /^[A-Za-z]:/.test(v);
    for (const line of readText(f).split(/\r?\n/)) {
        if (!line.trim() || line.startsWith('#'))
            continue;
        if (line.includes(':') && !line.startsWith(' ') && !line.startsWith('\t')) {
            const i = line.indexOf(':');
            const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim();
            if (k === 'collection') {
                collSys = sysFromName(v);
                cur = null;
            }
            else if (k === 'game') {
                cur = game(v, null, null, collSys || 'pc', 0, 0, 'pegasus');
                out.push(cur);
            }
            else if (cur && (k === 'file' || k === 'files')) {
                const fp = v && !abs(v) ? path.join(base, v) : v;
                if (fp) {
                    if (extOf(fp) === '.exe')
                        cur.exe = fp;
                    else
                        cur.rom = fp;
                }
            }
            else if (cur && k === 'launch' && v.toLowerCase().includes('.exe')) {
                const m = /"?([^"]+\.exe)"?/i.exec(v);
                if (m)
                    cur.exe = m[1];
            }
        }
        else if (cur && (line.startsWith(' ') || line.startsWith('\t')) && cur.rom == null && cur.exe == null) {
            const v = line.trim();
            const fp = abs(v) ? v : path.join(base, v);
            if (fp.toLowerCase().endsWith('.exe'))
                cur.exe = fp;
            else
                cur.rom = fp;
        }
    }
    return out.filter((g) => g.exe || g.rom);
}

function drives(): string[] {
    if (!WIN)
        return ['/'];
    const out: string[] = [];
    for (let c = 65; c <= 90; c++) {
        const d = String.fromCharCode(c) + ':\\';
        if (exists(d))
            out.push(d);
    }
    return out;
}

function xboxDefault(): string {
    for (const d of drives())
        if (isDir(path.join(d, 'XboxGames')))
            return path.join(d, 'XboxGames');
    return 'C:\\XboxGames';
}

function readXbox(p: string): any[] {
    const roots = isDir(p) ? [p] : [];
    if (path.basename(p).toLowerCase() !== 'xboxgames')
        for (const d of drives()) {
            const x = path.join(d, 'XboxGames');
            if (isDir(x) && x !== p)
                roots.push(x);
        }
    const cfgs: string[] = [];
    for (const r of roots) {
        for (const n of listDir(r)) {
            for (const c of ['MicrosoftGame.config', 'MicrosoftGame.Config']) {
                const f = path.join(r, n, 'Content', c);
                if (isFile(f))
                    cfgs.push(f);
            }
        }
        if (path.basename(r).toLowerCase() !== 'xboxgames') {
            const f = path.join(r, 'Content', 'MicrosoftGame.config');
            if (isFile(f))
                cfgs.push(f);
        }
    }
    if (!cfgs.length)
        throw new Error('Nenhum MicrosoftGame.config encontrado. Selecione a pasta XboxGames (ex.: C:\\XboxGames).');
    const out: any[] = [];
    const seen = new Set<string>();
    for (const c of cfgs) {
        const content = path.dirname(c);
        if (seen.has(content.toLowerCase()))
            continue;
        seen.add(content.toLowerCase());
        let title = path.basename(path.dirname(content)), exe = '';
        try {
            const txt = readText(c);
            const dn = xmlAttr(txt, 'ShellVisuals', 'DefaultDisplayName');
            if (dn && !dn.startsWith('ms-resource'))
                title = dn;
            const en = xmlAttr(txt, 'Executable', 'Name');
            if (en)
                exe = path.join(content, en);
        }
        catch (e: any) {
            log.debug('xbox config %s: %s', c, e?.message || e);
        }
        const helper = path.join(content, 'gamelaunchhelper.exe');
        if (exists(helper))
            exe = helper;
        if (!exe || !exists(exe))
            continue;
        out.push(game(title, exe, null, 'pc', 0, 0, 'xbox', { dir: content }));
    }
    return out;
}

function readEa(p: string): any[] {
    if (!isDir(p))
        throw new Error('Selecione a pasta EA Games (ex.: C:\\Program Files\\EA Games).');
    const dirs = exists(path.join(p, '__Installer', 'installerdata.xml')) ? [p] : listDir(p).map((n) => path.join(p, n)).filter(isDir);
    const out: any[] = [];
    for (const d of dirs) {
        const xmlp = path.join(d, '__Installer', 'installerdata.xml');
        let title = path.basename(d), exe = '';
        if (exists(xmlp)) {
            try {
                const txt = readText(xmlp);
                const names: Record<string, string> = {};
                for (const m of txt.matchAll(/<gameTitle(?:\s+locale="([^"]*)")?[^>]*>([\s\S]*?)<\/gameTitle>/g))
                    names[m[1] || ''] = decodeHtmlEntities(m[2]).trim();
                title = names.en_US || names.pt_BR || Object.values(names).find(Boolean) || title;
                for (const m of txt.matchAll(/<filePath[^>]*>([\s\S]*?)<\/filePath>/g)) {
                    let v = decodeHtmlEntities(m[1]).trim();
                    v = v.replace(/^\[[^\]]*\]/, '').replace(/^[\\/]+/, '');
                    const cand = path.join(d, v);
                    if (v.toLowerCase().endsWith('.exe') && exists(cand) && !/installer|setup|launcher|cleanup|activation|touchup/i.test(path.basename(cand))) {
                        exe = cand;
                        break;
                    }
                }
            }
            catch (e: any) {
                log.debug('ea xml %s: %s', xmlp, e?.message || e);
            }
        }
        if (!exe) {
            try {
                const cands = findExecutables(d);
                exe = cands.length ? cands[0] : '';
            }
            catch {
                exe = '';
            }
        }
        if (!exe)
            continue;
        out.push(game(title, exe, null, 'pc', 0, 0, 'ea', { dir: d }));
    }
    if (!out.length)
        throw new Error('Nenhum jogo da EA encontrado nessa pasta.');
    return out;
}

function readUbisoft(p: string): any[] {
    const out: any[] = [];
    const seen = new Set<string>();
    if (WIN) {
        try {
            for (const sub of ['HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs', 'HKLM\\SOFTWARE\\Ubisoft\\Launcher\\Installs']) {
                const lst = regQuery(sub);
                for (const line of lst.split(/\r?\n/)) {
                    const k = line.trim();
                    if (!k.toLowerCase().startsWith(sub.toLowerCase() + '\\'))
                        continue;
                    const gid = k.slice(sub.length + 1);
                    const d = regValue(regQuery(k), 'InstallDir').replace(/\//g, '\\').replace(/\\+$/, '');
                    if (!d || !isDir(d) || seen.has(d.toLowerCase()))
                        continue;
                    seen.add(d.toLowerCase());
                    out.push(game(path.basename(d), `uplay://launch/${gid}/0`, null, 'pc', 0, 0, 'ubisoft', { dir: d, ubisoft_id: gid }));
                }
            }
        }
        catch (e: any) {
            log.debug('ubisoft reg: %s', e?.message || e);
        }
    }
    if (isDir(p)) {
        for (const n of listDir(p).sort()) {
            const d = path.join(p, n);
            if (!isDir(d) || seen.has(d.toLowerCase()))
                continue;
            let cands: string[] = [];
            try {
                cands = findExecutables(d);
            }
            catch {
                cands = [];
            }
            if (cands.length) {
                seen.add(d.toLowerCase());
                out.push(game(n, cands[0], null, 'pc', 0, 0, 'ubisoft', { dir: d }));
            }
        }
    }
    if (!out.length)
        throw new Error('Nenhum jogo da Ubisoft encontrado (registro vazio e pasta sem jogos).');
    return out;
}

function rglob(root: string, ext: string, out: string[] = [], depth = 0): string[] {
    if (depth > 12)
        return out;
    let ents: fs.Dirent[];
    try {
        ents = fs.readdirSync(root, { withFileTypes: true });
    }
    catch {
        return out;
    }
    for (const e of ents) {
        const p = path.join(root, e.name);
        if (e.isDirectory())
            rglob(p, ext, out, depth + 1);
        else if (e.name.toLowerCase().endsWith(ext))
            out.push(p);
    }
    return out;
}

function readShortcuts(p: string): any[] {
    const out: any[] = [];
    const skip = /uninstall|desinstal|readme|manual|chrome|firefox|edge|word|excel|discord|spotify|steam\.exe|epicgames|setup|config|launcher\.exe$|update/i;
    for (const lnk of rglob(p, '.lnk')) {
        const target = lnkTarget(lnk);
        if (!target || !target.toLowerCase().endsWith('.exe') || skip.test(target) || skip.test(stemOf(lnk)))
            continue;
        if (/\\windows\\|\\system32\\/i.test(target))
            continue;
        out.push(game(stemOf(lnk), target, null, 'pc', 0, 0, 'shortcut', { dir: path.dirname(target) }));
    }
    return out;
}

export function lnkTarget(p: string): string | null {
    try {
        const b = fs.readFileSync(p);
        if (b.length < 76 || b.readUInt32LE(0) !== 0x4c)
            return null;
        const flags = b.readUInt32LE(20);
        let pos = 76;
        if (flags & 1) {
            const ln = b.readUInt16LE(pos);
            pos += 2 + ln;
        }
        if (flags & 2) {
            const liFlags = b.readUInt32LE(pos + 8);
            const lbpOff = b.readUInt32LE(pos + 16);
            if (liFlags & 1) {
                const start = pos + lbpOff;
                const end = b.indexOf(0, start);
                return b.toString('latin1', start, end < 0 ? undefined : end);
            }
        }
    }
    catch { }
    try {
        if (WIN)
            return require('electron').shell.readShortcutLink(p).target || null;
    }
    catch { }
    return null;
}

export const READERS: Record<string, (p: string) => any[]> = { playnite: readPlaynite, heroic: readHeroic, steam: readSteam, epic: readEpic, gog: readGog, esde: readEsde,
    launchbox: readLaunchbox, pegasus: readPegasus, shortcuts: readShortcuts, xbox: readXbox, ea: readEa, ubisoft: readUbisoft };

export function scan(launcherId: string, p: string, opts: any = null): any[] {
    playnite.setIncludeHidden(Boolean((opts || {}).hidden));
    const fn = READERS[launcherId];
    if (!fn)
        throw new Error('Launcher desconhecido');
    if (!exists(p))
        throw new Error('Caminho não existe');
    return fn(p);
}
