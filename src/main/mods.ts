import fs from 'node:fs';
import path from 'node:path';
import * as P from './paths';
import * as presets from './presets';
import { Downloader, extract, findExecutables, flattenSingleFolder, safeFolderName } from './installer';
import { fileRef } from './repos';
import { prog } from './jobs';
import type { Cancel, Progress } from './jobs';
import * as compat from './compat';
import { applyPatch, describeMismatch, outputName, patchKind } from './rompatch';

export const MOD_DIRS = ['mods', 'Mods', 'mod', 'BepInEx/plugins', 'Data', 'data', 'plugins', 'addons', 'Addons', 'maps', 'Maps', 'Content/Paks/~mods'];
const SKIP_NAMES = new Set(['readme.txt', 'readme.md', 'leia-me.txt', 'leiame.txt', 'thumbs.db', '.ds_store', 'desktop.ini']);

type Cb = (p: Progress) => void;

function isDir(p: string) {
    try {
        return fs.statSync(p).isDirectory();
    }
    catch {
        return false;
    }
}
function exists(p: string) {
    try {
        fs.accessSync(p);
        return true;
    }
    catch {
        return false;
    }
}
function rglobFiles(root: string): string[] {
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
function copyTree(src: string, dst: string) {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, e.name), d = path.join(dst, e.name);
        if (e.isDirectory())
            copyTree(s, d);
        else if (e.isFile())
            fs.copyFileSync(s, d);
    }
}
function quotePlus(s: string) {
    return encodeURIComponent(s).replace(/%20/g, '+').replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
function reOk(pat: string): RegExp | null {
    try {
        return new RegExp(pat, 'i');
    }
    catch {
        return null;
    }
}

export class ModsManager {
    presets: any;
    constructor(private store: any, private s: any, private cache: any) {
        this.presets = this.load();
    }
    load(): any {
        try {
            const p = presets.mods();
            return p && typeof p === 'object' ? { sites: p.sites || [], tools: p.tools || [], profiles: p.profiles || {} } : { sites: [], tools: [], profiles: {} };
        }
        catch {
            return { sites: [], tools: [], profiles: {} };
        }
    }
    root(): string {
        const d = this.store.config.mods_dir;
        const p = d ? String(d) : P.TOOLS;
        fs.mkdirSync(p, { recursive: true });
        return p;
    }
    toolDir(tid: string) {
        return path.join(this.root(), tid);
    }
    toolExe(tid: string): string | null {
        const t = this.presets.tools.find((x: any) => x.id === tid);
        const d = this.toolDir(tid);
        if (!t || !exists(d))
            return null;
        if (t.exe) {
            const direct = path.join(d, t.exe);
            if (exists(direct))
                return direct;
            const hits = rglobFiles(d).filter((f) => path.basename(f) === t.exe);
            if (hits.length)
                return hits[0];
        }
        const exes = findExecutables(d, t.title || '');
        return exes.length ? exes[0] : null;
    }
    status() {
        const tools: any[] = [];
        for (const t of this.presets.tools) {
            const exe = this.toolExe(t.id);
            const info = this.store.lib(`tool:${t.id}`) || {};
            const pub: any = {};
            for (const [k, v] of Object.entries(t))
                if (k !== 'match')
                    pub[k] = v;
            tools.push({ ...pub, installed: Boolean(exe), exe_path: exe || '', dir: this.toolDir(t.id), version: info.version || '' });
        }
        const sites = this.presets.sites.map((s: any) => {
            const o: any = {};
            for (const [k, v] of Object.entries(s))
                if (k !== 'match')
                    o[k] = v;
            return o;
        });
        return { tools, sites, root: this.root() };
    }
    forGame(title: string, system = 'pc') {
        const low = String(title || '').toLowerCase();
        const tools: any[] = [];
        for (const t of this.presets.tools) {
            const pat = t.match || '.*';
            if (pat === '.*')
                continue;
            const re = reOk(pat);
            if (re && re.test(low))
                tools.push({ id: t.id, title: t.title, for: t.for || '', installed: Boolean(this.toolExe(t.id)), type: t.type });
        }
        const sites: any[] = [];
        const q = quotePlus(String(title || '').replace(/[([][^)\]]*?[)\]]/g, '').trim());
        for (const s of this.presets.sites) {
            const pat = s.match || '.*';
            const generic = pat === '.*';
            const re = generic ? null : reOk(pat);
            const hit = generic || (re ? re.test(low) : true);
            if (!hit)
                continue;
            if (system !== 'pc' && ['nexus', 'moddb', 'gamebanana'].includes(s.id))
                continue;
            if (system === 'pc' && ['romhacking', 'cdromance'].includes(s.id))
                continue;
            sites.push({ id: s.id, name: s.name, url: String(s.url).replace('{q}', q), desc: s.desc || '', specific: !generic });
        }
        sites.sort((a, b) => Number(!a.specific) - Number(!b.specific));
        return { tools, sites };
    }
    async install(tid: string, cb: Cb, cancel: Cancel): Promise<string> {
        const t = this.presets.tools.find((x: any) => x.id === tid);
        if (!t)
            throw new Error('Ferramenta desconhecida');
        if (t.type !== 'github_release')
            throw new Error('Essa ferramenta é só link — abra a página e baixe manualmente.');
        let rels = await this.cache.getJson(`gh_${t.repo}`, `https://api.github.com/repos/${t.repo}/releases?per_page=5`, 6 * 3600);
        rels = Array.isArray(rels) ? rels.filter((r: any) => !r.draft) : [];
        if (!rels.length)
            throw new Error('Nenhum release encontrado no GitHub');
        const rel = rels.find((r: any) => !r.prerelease) || rels[0];
        const pat = new RegExp(t.asset || 'win|x64|\\.zip$|\\.7z$', 'i');
        const assets = (rel.assets || []).filter((a: any) => pat.test(a.name) && !/pdb|symbols|src|source|linux|mac|arm64/i.test(a.name));
        if (!assets.length)
            throw new Error('Nenhum arquivo Windows encontrado no release');
        const a = assets[0];
        const dest = this.toolDir(tid);
        const tmp = path.join(P.DOWNLOADS, `tool_${tid}`);
        fs.mkdirSync(tmp, { recursive: true });
        const archive = path.join(tmp, a.name);
        cb(prog('download', 0, `Baixando ${t.title}...`));
        await new Downloader(this.s).download(fileRef(a.name, a.browser_download_url, Number(a.size || 0)) as any, archive, cb, cancel);
        if (exists(dest))
            fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(dest, { recursive: true });
        if (/\.(zip|7z|rar)$/i.test(path.basename(archive))) {
            cb(prog('extract', 0, 'Extraindo...'));
            await extract(archive, dest, cb, cancel);
            flattenSingleFolder(dest);
        }
        else
            fs.renameSync(archive, path.join(dest, path.basename(archive)));
        fs.rmSync(tmp, { recursive: true, force: true });
        const cur = this.store.lib(`tool:${tid}`) || {};
        this.store.setLib(`tool:${tid}`, { ...cur, dir: dest, title: t.title, kind: 'tool', version: rel.tag_name || '', installed_at: cur.installed_at || Date.now() / 1000 });
        cb(prog('done', 1.0, `${t.title} pronto`));
        return dest;
    }
    remove(tid: string) {
        fs.rmSync(this.toolDir(tid), { recursive: true, force: true });
        this.store.removeLib(`tool:${tid}`);
    }
    launch(tid: string) {
        const exe = this.toolExe(tid);
        if (!exe)
            return { error: 'Ferramenta não instalada' };
        try {
            compat.popen([exe], path.dirname(exe), this.store.config);
        }
        catch (e: any) {
            return { error: String(e?.message || e) };
        }
        return { ok: true };
    }
}

function ls(d: string): string[] {
    try {
        return fs.readdirSync(d);
    }
    catch {
        return [];
    }
}
function peArch(exe: string): string {
    try {
        const fd = fs.openSync(exe, 'r');
        const b = Buffer.alloc(4096);
        const n = fs.readSync(fd, b, 0, 4096, 0);
        fs.closeSync(fd);
        if (n < 64 || b.toString('latin1', 0, 2) !== 'MZ')
            return '';
        const pe = b.readUInt32LE(0x3c);
        if (pe + 6 > n || b.toString('latin1', pe, pe + 4) !== 'PE\0\0')
            return '';
        const m = b.readUInt16LE(pe + 4);
        return m === 0x8664 ? 'x64' : m === 0x14c ? 'x86' : m === 0xaa64 ? 'arm64' : '';
    }
    catch {
        return '';
    }
}

export interface Inspection {
    dir: string; exe: string; arch: string; engine: string; profile: any; modDir: string; create: boolean;
    loader: { id: string; name: string; installed: boolean; auto: boolean; url: string } | null;
    hooks: string[]; paks: string; game: string;
}

export class GameMods {
    constructor(private store: any, private mm: ModsManager, private emu: any = null) {}
    profile(id: string) {
        const p = this.mm.presets.profiles || {};
        return { id, ...(p[id] || p.generic || {}) };
    }
    inspectDir(root: string, exe: string, title: string): Inspection {
        const top = ls(root);
        const low = new Set(top.map((x) => x.toLowerCase()));
        const has = (n: string) => low.has(n.toLowerCase());
        const dirs = top.filter((x) => isDir(path.join(root, x)));
        const t = String(title || '').toLowerCase();
        const r: Inspection = { dir: root, exe, arch: exe ? peArch(exe) : '', engine: 'generic', profile: null, modDir: '', create: false, loader: null, hooks: [], paks: '', game: '' };
        const hooks: string[] = [];
        if (has('dinput8.dll'))
            hooks.push('dinput8.dll (ASI Loader / Script Hook)');
        if (has('version.dll'))
            hooks.push('version.dll (loader)');
        if (has('dxgi.dll') || has('d3d11.dll') || has('d3d9.dll'))
            hooks.push(has('ReShade.ini') ? 'ReShade' : 'dxgi/d3d (ReShade ou wrapper)');
        if (has('winmm.dll'))
            hooks.push('winmm.dll (loader)');
        if (has('xinput1_3.dll') && !has('dinput8.dll'))
            hooks.push('xinput1_3.dll (hook)');
        r.hooks = hooks;
        const dataDir = dirs.find((d) => /_data$/i.test(d) && (isDir(path.join(root, d, 'Managed')) || isDir(path.join(root, d, 'il2cpp_data')) || exists(path.join(root, d, 'globalgamemanagers')) || exists(path.join(root, d, 'data.unity3d'))));
        if (dataDir || has('UnityPlayer.dll')) {
            const il2 = has('GameAssembly.dll') || Boolean(dataDir && isDir(path.join(root, dataDir, 'il2cpp_data')));
            r.engine = il2 ? 'unity-il2cpp' : 'unity-mono';
            r.modDir = 'BepInEx/plugins';
            r.create = !isDir(path.join(root, 'BepInEx', 'plugins'));
            const bep = isDir(path.join(root, 'BepInEx', 'core'));
            const melon = isDir(path.join(root, 'MelonLoader'));
            r.loader = melon ? { id: 'melon', name: 'MelonLoader', installed: true, auto: false, url: 'https://github.com/LavaGang/MelonLoader/releases' }
                : { id: il2 ? 'bepinex6' : 'bepinex', name: il2 ? 'BepInEx 6 (IL2CPP)' : 'BepInEx 5', installed: bep, auto: !il2, url: il2 ? 'https://builds.bepinex.dev/projects/bepinex_be' : 'https://github.com/BepInEx/BepInEx/releases' };
            if (melon)
                r.modDir = 'Mods';
        }
        else if (has('Engine') && dirs.some((d) => d !== 'Engine' && isDir(path.join(root, d, 'Content')) && isDir(path.join(root, d, 'Binaries')))) {
            const proj = dirs.find((d) => d !== 'Engine' && isDir(path.join(root, d, 'Content')) && isDir(path.join(root, d, 'Binaries'))) || '';
            r.engine = 'unreal';
            r.game = proj;
            r.paks = `${proj}/Content/Paks`;
            r.modDir = `${proj}/Content/Paks/~mods`;
            r.create = !isDir(path.join(root, r.modDir));
        }
        else if (isDir(path.join(root, 'Data')) && ls(path.join(root, 'Data')).some((f) => /\.esm$/i.test(f))) {
            r.engine = 'creation';
            r.modDir = 'Data';
            const se = top.find((f) => /^(skse64?|f4se|obse|nvse|fose|sfse)_loader\.exe$/i.test(f));
            r.loader = { id: 'scriptextender', name: se ? se.replace(/_loader\.exe$/i, '').toUpperCase() : 'Script Extender', installed: Boolean(se), auto: false, url: 'https://www.nexusmods.com/' };
        }
        else if (has('bin') && dirs.some((d) => exists(path.join(root, d, 'gameinfo.txt')))) {
            const g = dirs.find((d) => exists(path.join(root, d, 'gameinfo.txt'))) || '';
            r.engine = 'source';
            r.game = g;
            r.modDir = `${g}/custom`;
            r.create = !isDir(path.join(root, r.modDir));
        }
        else if (has('data.win') || has('game.unx')) {
            r.engine = 'gamemaker';
            r.modDir = '';
        }
        else if (isDir(path.join(root, 'www')) && isDir(path.join(root, 'www', 'js')) || has('nw.dll') && isDir(path.join(root, 'js', 'plugins'))) {
            r.engine = 'rpgmaker';
            r.modDir = isDir(path.join(root, 'www')) ? 'www/js/plugins' : 'js/plugins';
        }
        else if (isDir(path.join(root, 'renpy')) && isDir(path.join(root, 'game'))) {
            r.engine = 'renpy';
            r.modDir = 'game';
        }
        else if (/friday night funkin|fnf|psych engine/.test(t) || (isDir(path.join(root, 'mods')) && isDir(path.join(root, 'assets')) && has('lime.ndll'))) {
            r.engine = 'fnf';
            r.modDir = 'mods';
            r.create = !isDir(path.join(root, 'mods'));
        }
        else if (/fifa (1[7-9]|2[0-3])|fc 2[4-9]|battlefield (1|v|4|2042|hardline)|need for speed (2015|payback|heat|unbound)|mass effect.*(andromeda|legendary)|star wars battlefront|dragon age inquisition|anthem|mirror's edge catalyst|plants vs. zombies garden/.test(t) || has('bf1.exe') || has('bfv.exe') || has('Data') && has('Update') && top.some((f) => /\.toc$/i.test(f))) {
            r.engine = 'frostbite';
            r.modDir = '';
        }
        else if (hooks.some((h) => /dinput8|ASI/.test(h)) || isDir(path.join(root, 'scripts')) && top.some((f) => /\.asi$/i.test(f))) {
            r.engine = 'scripthook';
            r.modDir = isDir(path.join(root, 'scripts')) ? 'scripts' : '';
        }
        else if (isDir(path.join(root, 'mods')) || isDir(path.join(root, 'Mods'))) {
            r.engine = 'generic';
            r.modDir = isDir(path.join(root, 'mods')) ? 'mods' : 'Mods';
        }
        r.profile = this.profile(r.engine);
        return r;
    }
    inspect(key: string) {
        const info = this.store.lib(key) || {};
        const title = String(info.title || key);
        const romKey = /^rom:([^:]+):/.exec(key);
        const system = String(info.system || (romKey ? romKey[1] : 'pc'));
        const isRom = info.kind === 'rom' || Boolean(romKey);
        const found = this.mm.forGame(title, system);
        const mods = this.read(key);
        if (isRom) {
            const rom = String(info.exe || info.path || '');
            const prof = this.profile('rom');
            return { key, title, system, rom: true, romPath: rom, romOk: Boolean(rom && exists(rom)), engine: 'rom', profile: prof, loader: null, hooks: [], modDir: '', dir: rom ? path.dirname(rom) : '', targets: [], mods, sites: found.sites, tools: ['flips', 'delta-patcher'].map((id) => this.mm.presets.tools.find((x: any) => x.id === id)).filter(Boolean).map((t: any) => ({ id: t.id, title: t.title, for: t.for || '', installed: Boolean(this.mm.toolExe(t.id)), type: t.type })), patchable: /\.(nes|sfc|smc|gb|gbc|gba|nds|md|gen|smd|bin|z64|n64|v64|pce|sms|gg|ws|wsc|ngp|ngc|a26|lnx|col|int|vb|32x|rom)$/i.test(rom) };
        }
        const root = this.gameDir(key);
        if (!root)
            return { key, title, system, rom: false, dir: '', engine: 'generic', profile: this.profile('generic'), loader: null, hooks: [], modDir: '', targets: [], mods, sites: found.sites, tools: found.tools, create: false };
        const insp = this.inspectDir(root, String(info.exe || ''), title);
        const targets = this.targets(key);
        if (insp.modDir && !targets.some((x) => x.path === insp.modDir))
            targets.splice(1, 0, { path: insp.modDir, label: `${insp.modDir}/${insp.create ? ' (será criada)' : ''}` });
        const tools = found.tools.slice();
        const want = insp.profile && insp.profile.tool;
        if (want && !tools.some((x: any) => x.id === want)) {
            const t = this.mm.presets.tools.find((x: any) => x.id === want);
            if (t)
                tools.unshift({ id: t.id, title: t.title, for: t.for || '', installed: Boolean(this.mm.toolExe(t.id)), type: t.type });
        }
        const sites = found.sites.slice();
        for (const sid of (insp.profile && insp.profile.sites) || []) {
            if (sites.some((x: any) => x.id === sid))
                continue;
            const sdef = this.mm.presets.sites.find((x: any) => x.id === sid);
            if (sdef)
                sites.push({ id: sdef.id, name: sdef.name, url: String(sdef.url).replace('{q}', encodeURIComponent(title)), desc: sdef.desc || '', specific: false });
        }
        const order = (insp.profile && insp.profile.sites) || [];
        sites.sort((a: any, b: any) => Number(!a.specific) - Number(!b.specific) || (order.indexOf(a.id) < 0 ? 99 : order.indexOf(a.id)) - (order.indexOf(b.id) < 0 ? 99 : order.indexOf(b.id)));
        return { ...insp, key, title, system, rom: false, targets, mods, sites, tools, suggest: insp.modDir || this.suggestTarget(key) };
    }
    async installLoader(key: string, cb: Cb, cancel: Cancel) {
        const root = this.gameDir(key);
        if (!root)
            throw new Error('Esse jogo não tem pasta instalada');
        const info = this.store.lib(key) || {};
        const insp = this.inspectDir(root, String(info.exe || ''), String(info.title || ''));
        if (!insp.loader || insp.loader.id !== 'bepinex')
            throw new Error('Instalação automática só para BepInEx 5 (jogos Unity Mono)');
        if (insp.loader.installed)
            throw new Error('BepInEx já está nesse jogo');
        const arch = insp.arch === 'x86' ? 'x86' : 'x64';
        let rels = await this.mm['cache'].getJson('gh_BepInEx/BepInEx', 'https://api.github.com/repos/BepInEx/BepInEx/releases?per_page=10', 6 * 3600);
        rels = Array.isArray(rels) ? rels.filter((r: any) => !r.draft && !r.prerelease && /^v?5\./.test(String(r.tag_name || ''))) : [];
        if (!rels.length)
            throw new Error('Nenhuma versão 5.x do BepInEx encontrada no GitHub');
        const rel = rels[0];
        const a = (rel.assets || []).find((x: any) => new RegExp(`^BepInEx_win_${arch}_5\\.`, 'i').test(x.name)) || (rel.assets || []).find((x: any) => new RegExp(`^BepInEx_${arch}_5\\.`, 'i').test(x.name));
        if (!a)
            throw new Error(`O release ${rel.tag_name} não tem o pacote Windows ${arch}`);
        const tmp = path.join(P.DOWNLOADS, 'loader_bepinex');
        fs.mkdirSync(tmp, { recursive: true });
        const archive = path.join(tmp, a.name);
        cb(prog('download', 0, `Baixando BepInEx ${rel.tag_name} (${arch})…`));
        await new Downloader(this.mm['s']).download(fileRef(a.name, a.browser_download_url, Number(a.size || 0)) as any, archive, cb, cancel);
        const r = await this.install(key, archive, `BepInEx ${String(rel.tag_name).replace(/^v/, '')}`, '', cb, cancel);
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.mkdirSync(path.join(root, 'BepInEx', 'plugins'), { recursive: true });
        cb(prog('done', 1.0, 'BepInEx instalado. Abra o jogo uma vez para ele criar as pastas de configuração.'));
        return r;
    }
    applyRomPatch(key: string, patchPath: string, force = false) {
        const info = this.store.lib(key) || {};
        const rom = String(info.exe || info.path || '');
        const rk = /^rom:([^:]+):/.exec(key);
        const system = String(info.system || (rk ? rk[1] : ''));
        if (!rom || !exists(rom))
            return { error: 'A ROM desse jogo não foi encontrada' };
        const pp = String(patchPath || '').trim().replace(/^"|"$/g, '');
        if (!pp || !exists(pp))
            return { error: 'Arquivo do patch não encontrado' };
        if (!patchKind(pp))
            return { error: 'Formato de patch não reconhecido (aceita .ips, .ups e .bps)' };
        let res;
        try {
            res = applyPatch(rom, pp);
        }
        catch (e: any) {
            return { error: String(e?.message || e) };
        }
        if (res.mismatch && !force)
            return { mismatch: true, error: describeMismatch(res) };
        const out = outputName(rom, pp);
        fs.writeFileSync(out, res.out);
        let added: any = null;
        try {
            added = this.emu && system ? this.emu.addRomFile(out, system) : null;
            if (added && added.key) {
                const ov = { ...(this.store.config.title_overrides || {}) };
                const tag = path.basename(pp, path.extname(pp)).replace(/[_]+/g, ' ').trim();
                ov[added.key] = `${String(info.title || added.title || '').trim()} — ${tag}`;
                this.store.setConfig({ title_overrides: ov });
                added.title = ov[added.key];
            }
        }
        catch { }
        return { ok: true, path: out, kind: res.kind, size: res.out.length, mismatch: res.mismatch, added };
    }
    base(key: string) {
        return path.join(P.DATA, 'mods', safeFolderName(key.replace(/:/g, '_')));
    }
    db(key: string) {
        return path.join(this.base(key), 'mods.json');
    }
    read(key: string): any[] {
        try {
            const v = JSON.parse(fs.readFileSync(this.db(key), 'utf8'));
            return Array.isArray(v) ? v : [];
        }
        catch {
            return [];
        }
    }
    write(key: string, lst: any[]) {
        fs.mkdirSync(this.base(key), { recursive: true });
        fs.writeFileSync(this.db(key), JSON.stringify(lst, null, 1), 'utf8');
    }
    gameDir(key: string): string | null {
        const info = this.store.lib(key) || {};
        const d = info.dir || (info.exe ? path.dirname(String(info.exe)) : '');
        return d && isDir(String(d)) ? String(d) : null;
    }
    targets(key: string) {
        const root = this.gameDir(key);
        if (!root)
            return [];
        const out = [{ path: '', label: 'Pasta do jogo (raiz)' }];
        for (const rel of MOD_DIRS)
            if (isDir(path.join(root, rel)) && !out.some((o) => o.path === rel))
                out.push({ path: rel, label: `${rel}/` });
        return out;
    }
    suggestTarget(key: string) {
        const t = this.targets(key).find((x) => x.path);
        return t ? t.path : '';
    }
    list(key: string) {
        const root = this.gameDir(key);
        const mods = this.read(key);
        for (const m of mods)
            m.size_h = m.size || 0;
        return { mods, targets: this.targets(key), suggest: this.suggestTarget(key), dir: root || '' };
    }
    check(key: string, src: string, target: string): [string, string, string] {
        const root = this.gameDir(key);
        if (!root)
            throw new Error('Esse jogo não tem pasta instalada');
        const srcp = String(src || '').trim().replace(/^"|"$/g, '');
        if (!src || !exists(srcp))
            throw new Error('Arquivo do mod não encontrado');
        target = String(target || '').trim().replace(/^[/\\]+|[/\\]+$/g, '').replace(/\\/g, '/');
        if (target.split('/').includes('..') || target.startsWith('/') || target.includes(':'))
            throw new Error('Pasta de destino inválida');
        return [root, srcp, target];
    }
    async install(key: string, src: string, title = '', target = '', cb: Cb | null = null, cancel: Cancel | null = null) {
        const [root, srcp, tgt] = this.check(key, src, target);
        target = tgt;
        const destRoot = target ? path.join(root, target) : root;
        fs.mkdirSync(destRoot, { recursive: true });
        title = String(title || '').trim() || path.parse(srcp).name.replace(/[_-]+/g, ' ').trim();
        let mid = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'mod';
        const mods = this.read(key);
        if (mods.some((m) => m.id === mid))
            mid += '-' + String(Math.floor(Date.now() / 1000)).slice(-4);
        const stage = path.join(this.base(key), mid, 'files');
        const backup = path.join(this.base(key), mid, 'backup');
        fs.rmSync(path.dirname(stage), { recursive: true, force: true });
        fs.mkdirSync(stage, { recursive: true });
        const cbx: Cb = cb || (() => undefined);
        const cn: Cancel = cancel || { aborted: false, pause: false, check: () => undefined };
        if (isDir(srcp))
            copyTree(srcp, stage);
        else if (/\.(zip|7z|rar|tar|gz|xz)$/i.test(path.basename(srcp))) {
            cbx(prog('extract', 0, 'Extraindo o mod…'));
            await extract(srcp, stage, cbx, cn);
            if (!target)
                flattenSingleFolder(stage);
        }
        else
            fs.copyFileSync(srcp, path.join(stage, path.basename(srcp)));
        if (target && isDir(path.join(stage, target)) && fs.readdirSync(stage).filter((x) => !SKIP_NAMES.has(x.toLowerCase())).length === 1) {
            const inner = path.join(stage, target);
            const tmp = path.join(path.dirname(stage), '_inner');
            fs.renameSync(inner, tmp);
            fs.rmSync(stage, { recursive: true, force: true });
            fs.renameSync(tmp, stage);
        }
        const files: string[] = [], replaced: string[] = [];
        let size = 0;
        for (const f of rglobFiles(stage).sort()) {
            const rel = path.relative(stage, f);
            const relPosix = rel.split(path.sep).join('/');
            if (SKIP_NAMES.has(path.basename(rel).toLowerCase()) && !rel.includes(path.sep))
                continue;
            const dst = path.join(destRoot, rel);
            if (exists(dst)) {
                const b = path.join(backup, rel);
                fs.mkdirSync(path.dirname(b), { recursive: true });
                fs.copyFileSync(dst, b);
                replaced.push(relPosix);
            }
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.copyFileSync(f, dst);
            files.push(relPosix);
            size += fs.statSync(f).size;
        }
        if (!files.length) {
            fs.rmSync(path.dirname(stage), { recursive: true, force: true });
            throw new Error('O mod não tinha arquivos pra copiar');
        }
        const rec = { id: mid, title, target, files, replaced, size, enabled: true, added: Date.now() / 1000, source: srcp };
        mods.push(rec);
        this.write(key, mods);
        cbx(prog('done', 1.0, `${title}: ${files.length} arquivos em ${target || 'pasta do jogo'}`));
        return { ok: true, mod: rec };
    }
    setEnabled(key: string, mid: string, on: boolean) {
        const root = this.gameDir(key);
        const mods = this.read(key);
        const m = mods.find((x) => x.id === mid);
        if (!m || !root)
            return { error: 'Mod não encontrado' };
        const destRoot = m.target ? path.join(root, m.target) : root;
        const stage = path.join(this.base(key), mid, 'files');
        const backup = path.join(this.base(key), mid, 'backup');
        if (on && !m.enabled) {
            for (const rel of m.files) {
                const srcf = path.join(stage, rel);
                if (exists(srcf)) {
                    const dst = path.join(destRoot, rel);
                    fs.mkdirSync(path.dirname(dst), { recursive: true });
                    fs.copyFileSync(srcf, dst);
                }
            }
        }
        else if (!on && m.enabled)
            this.pull(destRoot, m, backup);
        m.enabled = Boolean(on);
        this.write(key, mods);
        return { ok: true, enabled: m.enabled };
    }
    pull(destRoot: string, m: any, backup: string) {
        for (const rel of m.files) {
            const dst = path.join(destRoot, rel);
            fs.rmSync(dst, { force: true });
            const b = path.join(backup, rel);
            if (exists(b)) {
                fs.mkdirSync(path.dirname(dst), { recursive: true });
                fs.copyFileSync(b, dst);
            }
        }
        const dirs = Array.from(new Set(m.files.map((r: string) => path.dirname(r)))).sort((a: any, b: any) => b.length - a.length) as string[];
        for (const rel of dirs) {
            const d = path.join(destRoot, rel);
            try {
                if (rel !== '.' && rel !== '' && isDir(d) && !fs.readdirSync(d).length)
                    fs.rmdirSync(d);
            }
            catch { }
        }
    }
    remove(key: string, mid: string) {
        const r: any = this.setEnabled(key, mid, false);
        if (r.error)
            return r;
        this.write(key, this.read(key).filter((x) => x.id !== mid));
        fs.rmSync(path.join(this.base(key), mid), { recursive: true, force: true });
        return { ok: true };
    }
    summary() {
        const out: any[] = [];
        if (!isDir(path.join(P.DATA, 'mods')))
            return out;
        for (const [k, info] of Object.entries<any>(this.store.library)) {
            const mods = this.read(k);
            if (mods.length)
                out.push({ key: k, title: info.title || k, count: mods.length, on: mods.filter((m) => m.enabled).length, dir: this.gameDir(k) || '' });
        }
        out.sort((a, b) => String(a.title).toLowerCase().localeCompare(String(b.title).toLowerCase()));
        return out;
    }
}
