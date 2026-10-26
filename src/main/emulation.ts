import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cp from 'node:child_process';
import AdmZip from 'adm-zip';
import * as P from './paths';
import * as log from './log';
import * as http from './http';
import * as presets from './presets';
import * as archive from './archive';
import * as downloader from './downloader';
import * as emuguide from './emuguide';
import { WebCache } from './webcache';
import { prog } from './jobs';
import { normalizeTitle } from './titles';
import { guessSystem } from './syshints';
import { which } from './sessions';

const WIN = process.platform === 'win32';
export const ROM_TITLE_RE = /\s*[\(\[].*?[\)\]]/g;
const now = () => Date.now() / 1000;
const isDir = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p: string) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const exists = (p: string) => { try { fs.statSync(p); return true; } catch { return false; } };

export const LINUX_BIN: Record<string, string[]> = {
    duckstation: ['duckstation-qt', 'duckstation-nogui', 'DuckStation'], pcsx2: ['pcsx2-qt', 'pcsx2', 'PCSX2'],
    ppsspp: ['PPSSPPSDL', 'PPSSPPQt', 'ppsspp'], rmg: ['RMG'], dolphin: ['dolphin-emu', 'dolphin-emu-nogui'],
    flycast: ['flycast'], xemu: ['xemu'], xenia: [], mgba: ['mgba-qt', 'mgba'], snes9x: ['snes9x-gtk', 'snes9x'],
    melonds: ['melonDS', 'melonds'], retroarch: ['retroarch'], rpcs3: ['rpcs3'], cemu: ['Cemu', 'cemu'],
    azahar: ['azahar', 'azahar-room'], eden: ['eden'], mesen: ['Mesen', 'mesen'], ares: ['ares'], mednafen: ['mednafen'],
    mame: ['mame'], stella: ['stella'], dosbox: ['dosbox-staging', 'dosbox'], simple64: ['simple64-gui'],
    redream: ['redream'], desmume: ['desmume'], bsnes: ['bsnes'], fceux: ['fceux'], blastem: ['blastem'],
    scummvm: ['scummvm'], 'dosbox-x': ['dosbox-x'], bizhawk: [], citron: ['citron'], yabause: ['kronos', 'yabause'],
    fbneo: ['fbneo'], supermodel: ['supermodel'], 'vba-m': ['visualboyadvance-m', 'vbam'], play: ['Play'],
};
export const LINUX_FLATPAK: Record<string, string> = {
    duckstation: 'org.duckstation.DuckStation', pcsx2: 'net.pcsx2.PCSX2', ppsspp: 'org.ppsspp.PPSSPP',
    rmg: 'com.github.Rosalie241.RMG', dolphin: 'org.DolphinEmu.dolphin-emu', flycast: 'org.flycast.Flycast',
    xemu: 'app.xemu.xemu', mgba: 'io.mgba.mGBA', snes9x: 'com.snes9x.Snes9x', melonds: 'net.kuribo64.melonDS',
    retroarch: 'org.libretro.RetroArch', rpcs3: 'net.rpcs3.RPCS3', cemu: 'info.cemu.Cemu', azahar: 'org.azahar_emu.Azahar',
    mesen: 'ca.mesen.Mesen', ares: 'dev.ares.ares', mame: 'org.mamedev.MAME', stella: 'io.github.stella_emu.Stella',
    dosbox: 'io.github.dosbox-staging', desmume: 'org.desmume.DeSmuME', bsnes: 'dev.bsnes.bsnes', fceux: 'org.fceux.FCEUX',
    scummvm: 'org.scummvm.ScummVM', 'dosbox-x': 'com.dosbox_x.DOSBox-X', simple64: 'io.github.simple64.simple64',
};

export function nativeEmulator(emuId: string): string | null {
    for (const name of LINUX_BIN[emuId] || []) {
        const w = which(name);
        if (w)
            return w;
    }
    const fp = LINUX_FLATPAK[emuId];
    if (fp && which('flatpak')) {
        try {
            const r = cp.spawnSync('flatpak', ['info', fp], { encoding: 'utf8', timeout: 8000 });
            if (r.status === 0) {
                const d = path.join(P.EMU_EMULATORS, emuId);
                fs.mkdirSync(d, { recursive: true });
                const sh = path.join(d, `${emuId}.sh`);
                if (!exists(sh)) {
                    fs.writeFileSync(sh, `#!/bin/sh\nexec flatpak run ${fp} "$@"\n`, 'utf8');
                    fs.chmodSync(sh, 0o755);
                }
                return sh;
            }
        }
        catch { /* sem flatpak */ }
    }
    return null;
}

function walk(dir: string, maxDepth: number, visit: (file: string, name: string) => void, depth = 0) {
    let ents: fs.Dirent[];
    try {
        ents = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (!e.name.startsWith('.') && depth < maxDepth)
                walk(p, maxDepth, visit, depth + 1);
        }
        else if (e.isFile() || e.isSymbolicLink())
            visit(p, e.name);
    }
}

function rglob(dir: string, name: string, maxDepth = 6): string[] {
    const out: string[] = [];
    const want = WIN ? name.toLowerCase() : name;
    walk(dir, maxDepth, (f, n) => {
        if ((WIN ? n.toLowerCase() : n) === want)
            out.push(f);
    });
    return out;
}

function rmrf(p: string) {
    try {
        fs.rmSync(p, { recursive: true, force: true });
    }
    catch { /* ignore */ }
}

export class EmulationManager {
    presets: any;
    SCAN_TTL = 900;
    private upd: any[] = [];
    private updAt = 0;
    private updRunning = false;
    private scanCache = new Map<string, { at: number; list: any[] }>();
    private scanRunning = new Set<string>();
    private exeCache = new Map<string, { at: number; exe: string | null }>();
    static REMOVED: Record<string, string> = { ryujinx: 'eden', sudachi: 'eden' };

    constructor(public store: any, public session: http.Session, public cache: WebCache) {
        this.presets = this.loadPresets();
        this.migrateRemoved();
        this.migratePaths();
        this.loadScanCache();
    }

    private scanCacheFile() {
        return path.join(P.CACHE, 'roms.json');
    }

    private loadScanCache() {
        try {
            const raw = JSON.parse(fs.readFileSync(this.scanCacheFile(), 'utf8'));
            if (raw && raw.format === 1 && raw.systems && typeof raw.systems === 'object') {
                for (const [sid, v] of Object.entries<any>(raw.systems))
                    if (v && Array.isArray(v.list))
                        this.scanCache.set(sid, { at: 0, list: v.list, stale: true } as any);
            }
        }
        catch { /* sem cache */ }
    }

    private saveScanCache() {
        try {
            const systems: Record<string, any> = {};
            for (const [sid, v] of this.scanCache)
                systems[sid] = { at: v.at, list: v.list };
            fs.mkdirSync(P.CACHE, { recursive: true });
            const f = this.scanCacheFile();
            fs.writeFileSync(f + '.tmp', JSON.stringify({ format: 1, systems }), 'utf8');
            fs.renameSync(f + '.tmp', f);
        }
        catch (e) {
            log.debug?.('roms cache: %s', e);
        }
    }

    private loadPresets() {
        const d = JSON.parse(JSON.stringify(presets.emulators() || { systems: {}, emulators: {} }));
        if (!WIN && d.systems?.pc)
            d.systems.pc.name = 'PC';
        return d;
    }

    private migrateRemoved() {
        const cfg = this.store.config;
        const R = EmulationManager.REMOVED;
        const ch: any = {};
        const se = { ...(cfg.system_emulator || {}) };
        for (const [sid, eid] of Object.entries<string>(se)) {
            if (R[eid]) {
                se[sid] = R[eid];
                ch.system_emulator = se;
            }
        }
        const ses: any = {};
        for (const [k, v] of Object.entries<any>(cfg.system_emulators || {}))
            ses[k] = (v || []).map((x: string) => R[x] || x);
        if (JSON.stringify(ses) !== JSON.stringify(cfg.system_emulators || {}))
            ch.system_emulators = ses;
        const ge: any = {};
        for (const [k, v] of Object.entries<string>(cfg.game_emulator || {}))
            ge[k] = R[v] || v;
        if (JSON.stringify(ge) !== JSON.stringify(cfg.game_emulator || {}))
            ch.game_emulator = ge;
        const ep: any = {};
        for (const [k, v] of Object.entries(cfg.emu_paths || {}))
            if (!R[k])
                ep[k] = v;
        if (Object.keys(ep).length !== Object.keys(cfg.emu_paths || {}).length)
            ch.emu_paths = ep;
        if (Object.keys(ch).length)
            this.store.setConfig(ch);
        for (const old of Object.keys(R))
            rmrf(path.join(P.EMU_EMULATORS, old));
    }

    sameFamily(eid: string, exe: string): boolean {
        const pc = this.presets.emulators[eid];
        if (!pc || !exe)
            return true;
        const stem = path.parse(exe).name.toLowerCase();
        const toks = new Set([eid.split('-')[0].toLowerCase()]);
        const m = String(pc.exe || '').toLowerCase().match(/[a-z0-9]+/);
        if (m)
            toks.add(m[0]);
        return [...toks].some((t) => t && stem.includes(t));
    }

    findFamilyExe(eid: string, near: string | null = null): string | null {
        const pc = this.presets.emulators[eid] || {};
        const want = String(pc.exe || '');
        if (!want)
            return null;
        const roots: string[] = [];
        if (near)
            roots.push(path.dirname(near), path.dirname(path.dirname(near)));
        for (const v of ['LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)']) {
            if (process.env[v]) {
                roots.push(process.env[v]!);
                if (v === 'LOCALAPPDATA')
                    roots.push(path.join(process.env[v]!, 'Programs'));
            }
        }
        const seen = new Set<string>();
        for (let r of roots) {
            try {
                r = fs.realpathSync(r);
            }
            catch {
                continue;
            }
            if (seen.has(r) || !isDir(r) || path.parse(r).root === r)
                continue;
            seen.add(r);
            for (const h of rglob(r, want, 2))
                if (isFile(h) && this.sameFamily(eid, h))
                    return h;
        }
        return null;
    }

    private migratePaths() {
        const cfg = this.store.config;
        const ep = { ...(cfg.emu_paths || {}) };
        const custom = { ...(cfg.custom_emulators || {}) };
        const bad = Object.entries<string>(ep).filter(([eid, exe]) => exe && !this.sameFamily(eid, exe));
        if (!bad.length)
            return;
        for (const [eid, exe] of bad) {
            delete ep[eid];
            log.warn('emulador %s apontava para %s (não é %s); desvinculado', eid, exe, this.presets.emulators[eid]?.exe);
            const real = this.findFamilyExe(eid, exe);
            if (real) {
                ep[eid] = real;
                log.info('emulador %s encontrado em %s', eid, real);
            }
            if (isFile(exe)) {
                const stem = path.parse(exe).name;
                const cid = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                if (cid && !custom[cid] && !this.presets.emulators[cid]) {
                    const systems = [...(this.presets.emulators[eid]?.systems || [])];
                    custom[cid] = { title: stem, exe, args: this.argsFor(eid, systems[0] || ''), systems, based_on: eid };
                }
            }
        }
        this.store.setConfig({ emu_paths: ep, custom_emulators: custom });
        this.forgetExe();
    }

    invalidateScan(sid: string | null = null) {
        for (const k of sid ? [sid] : [...this.scanCache.keys()]) {
            const hit = this.scanCache.get(k);
            if (hit)
                this.scanCache.set(k, { at: 0, list: hit.list });
        }
    }

    emuDir(emuId: string) {
        return path.join(P.EMU_EMULATORS, emuId);
    }

    allEmulators(): Record<string, any> {
        const out: Record<string, any> = { ...this.presets.emulators };
        for (const [eid, c] of Object.entries<any>(this.store.config.custom_emulators || {}))
            out[eid] = { ...c, custom: true, source: 'custom' };
        return out;
    }

    emulatorFor(sid: string): string | null {
        const pref = (this.store.config.system_emulator || {})[sid];
        if (pref && this.allEmulators()[pref])
            return pref;
        return this.presets.systems[sid]?.emulator || null;
    }

    installedOptions(sid: string) {
        const allemu = this.allEmulators();
        const sc = this.presets.systems[sid] || {};
        const dflt = this.emulatorFor(sid);
        const ids = Object.entries<any>(allemu).filter(([eid, ec]) => (ec.systems || []).includes(sid) || sc.emulator === eid).map(([eid]) => eid);
        for (const e of (this.store.config.system_emulators || {})[sid] || [])
            if (allemu[e] && !ids.includes(e))
                ids.push(e);
        const out = ids.filter((eid) => this.emuExe(eid)).map((eid) => ({ id: eid, title: allemu[eid].title || eid, default: eid === dflt }));
        out.sort((a, b) => Number(!a.default) - Number(!b.default) || a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
        return out;
    }

    addSystemEmulator(sid: string, eid: string) {
        const se = { ...(this.store.config.system_emulators || {}) };
        const lst = [...(se[sid] || [])];
        if (!lst.includes(eid))
            lst.push(eid);
        se[sid] = lst;
        this.store.setConfig({ system_emulators: se });
    }

    removeSystemEmulator(sid: string, eid: string) {
        const se = { ...(this.store.config.system_emulators || {}) };
        se[sid] = (se[sid] || []).filter((x: string) => x !== eid);
        this.store.setConfig({ system_emulators: se });
    }

    emuExe(emuId: string): string | null {
        const hit = this.exeCache.get(emuId);
        if (hit && now() - hit.at < 15)
            return hit.exe;
        const r = this.findExe(emuId);
        this.exeCache.set(emuId, { at: now(), exe: r });
        return r;
    }

    forgetExe(emuId: string | null = null) {
        if (emuId)
            this.exeCache.delete(emuId);
        else
            this.exeCache.clear();
    }

    private findExe(emuId: string): string | null {
        const cfg = this.allEmulators()[emuId];
        if (!cfg)
            return null;
        if (cfg.custom) {
            const p = String(cfg.exe || '');
            return p && exists(p) ? p : null;
        }
        const d = this.emuDir(emuId);
        const override = (this.store.config.emu_paths || {})[emuId];
        if (override && exists(override))
            return override;
        if (exists(d)) {
            const direct = path.join(d, cfg.exe);
            if (exists(direct))
                return direct;
            const hits = rglob(d, cfg.exe);
            if (hits.length)
                return hits[0];
            if (!WIN) {
                const base = String(cfg.exe).toLowerCase().endsWith('.exe') ? String(cfg.exe).slice(0, -4) : String(cfg.exe);
                for (const pat of [...(LINUX_BIN[emuId] || []), base]) {
                    if (pat.includes('*') || pat.includes('/'))
                        continue;
                    for (const h of rglob(d, pat))
                        if (isFile(h))
                            return h;
                }
                let app: string | null = null;
                walk(d, 6, (f, n) => {
                    if (!app && n.toLowerCase().endsWith('.appimage'))
                        app = f;
                });
                if (app)
                    return app;
            }
        }
        if (!WIN)
            return nativeEmulator(emuId);
        return null;
    }

    scanRomRoot(root: string) {
        const out: { system: string; name: string; dir: string; count: number; already: boolean }[] = [];
        if (!root || !isDir(root))
            return { error: 'Pasta não encontrada' };
        const byExt: Record<string, string[]> = {};
        for (const [sid, sc] of Object.entries<any>(this.presets.systems)) {
            if (sid === 'pc')
                continue;
            for (const e of sc.exts || [])
                (byExt[e.toLowerCase()] = byExt[e.toLowerCase()] || []).push(sid);
        }
        const alias: Record<string, string> = { psx: 'ps1', playstation: 'ps1', ps: 'ps1', psone: 'ps1', ps2: 'ps2', playstation2: 'ps2', psp: 'psp', n64: 'n64', nintendo64: 'n64', gc: 'gc', gamecube: 'gc', ngc: 'gc', wii: 'wii', dc: 'dc', dreamcast: 'dc', xbox: 'xbox', x360: 'x360', xbox360: 'x360', gba: 'gba', gb: 'gba', gbc: 'gba', gameboy: 'gba', snes: 'snes', sfc: 'snes', supernintendo: 'snes', nds: 'nds', ds: 'nds', genesis: 'genesis', megadrive: 'genesis', md: 'genesis', nes: 'nes', famicom: 'nes', ps3: 'ps3', wiiu: 'wiiu', switch: 'switch', nsw: 'switch', '3ds': '3ds', n3ds: '3ds', saturn: 'saturn', sms: 'sms', mastersystem: 'sms', gg: 'sms', gamegear: 'sms', pce: 'pce', pcengine: 'pce', tg16: 'pce', turbografx: 'pce', atari2600: 'atari2600', atari: 'atari2600', arcade: 'arcade', mame: 'arcade', fbneo: 'arcade', dos: 'dos', msdos: 'dos' };
        const known = new Set<string>();
        for (const v of Object.values<any>(this.store.config.rom_dirs || {}))
            for (const d of v || [])
                known.add(path.resolve(d).toLowerCase());
        const look = (dir: string, depth: number) => {
            let ents: fs.Dirent[] = [];
            try {
                ents = fs.readdirSync(dir, { withFileTypes: true });
            }
            catch {
                return;
            }
            const counts: Record<string, number> = {};
            let files = 0;
            for (const e of ents) {
                if (e.isFile()) {
                    files++;
                    const ext = path.extname(e.name).toLowerCase();
                    for (const sid of byExt[ext] || [])
                        counts[sid] = (counts[sid] || 0) + 1;
                }
            }
            const nameKey = path.basename(dir).toLowerCase().replace(/[^a-z0-9]/g, '');
            const hinted = alias[nameKey];
            let pick = '';
            if (hinted && (counts[hinted] || !Object.keys(counts).length) && files)
                pick = counts[hinted] ? hinted : '';
            if (!pick) {
                const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
                if (best && best[1] >= 1 && (!hinted || hinted === best[0]))
                    pick = best[0];
                else if (best && hinted && counts[hinted])
                    pick = hinted;
                else if (best && !hinted && best[1] >= 2)
                    pick = best[0];
            }
            if (pick && dir !== root) {
                out.push({ system: pick, name: this.presets.systems[pick]?.name || pick, dir, count: counts[pick] || 0, already: known.has(path.resolve(dir).toLowerCase()) || path.resolve(dir) === path.resolve(path.join(P.EMU_GAMES, pick)) });
                return;
            }
            if (depth <= 0)
                return;
            for (const e of ents)
                if (e.isDirectory() && !e.name.startsWith('.') && !/^(bios|saves?|states?|screenshots?|cheats|covers?|media|images|manuals|videos|music|dlc|updates?)$/i.test(e.name))
                    look(path.join(dir, e.name), depth - 1);
        };
        look(root, 2);
        return { root, found: out };
    }

    applyRomRoot(items: { system: string; dir: string }[]) {
        let n = 0;
        for (const it of items || []) {
            if (!this.presets.systems[it.system] || !isDir(it.dir))
                continue;
            this.addRomDir(it.system, it.dir);
            n++;
        }
        return { ok: true, added: n };
    }

    systemStatus(sid: string, allemu: Record<string, any> | null = null) {
        const sc = this.presets.systems[sid];
        if (!sc || sid === 'pc')
            return null;
        allemu = allemu || this.allEmulators();
        const emu = this.emulatorFor(sid);
        const exe = emu ? this.emuExe(emu) : null;
        const opts = new Set<string>(Object.entries<any>(allemu).filter(([eid, ec]) => (ec.systems || []).includes(sid) || sc.emulator === eid).map(([eid]) => eid));
        for (const e of (this.store.config.system_emulators || {})[sid] || [])
            opts.add(e);
        return {
            ...sc, id: sid, emulator: emu,
            emulator_title: allemu[emu || '']?.title || emu,
            installed: Boolean(exe),
            games_dir: path.join(P.EMU_GAMES, sid),
            extra_dirs: (this.store.config.rom_dirs || {})[sid] || [],
            dest: (this.store.config.rom_dest || {})[sid] || '',
            rom_count: this.scanSystem(sid).length,
            options: [...opts].sort((a, b) => Number(a !== sc.emulator) - Number(b !== sc.emulator) || a.localeCompare(b)),
            installed_options: this.installedOptions(sid),
            emu_dir: exe ? path.dirname(exe) : '',
            guide: sid in emuguide.GUIDES,
            setup_ok: exe && sid in emuguide.GUIDES ? !emuguide.missingRequired(sid, emu || '', exe).length : true,
            setup_missing: exe && sid in emuguide.GUIDES ? emuguide.missingRequired(sid, emu || '', exe) : [],
        };
    }

    guide(sid: string) {
        const emu = this.emulatorFor(sid);
        const exe = emu ? this.emuExe(emu) : null;
        const st = emuguide.status(sid, emu || '', exe);
        if (!st)
            return { error: 'Este console não precisa de configuração extra' };
        st.emulator_title = this.allEmulators()[emu || '']?.title || emu;
        st.installed = Boolean(exe);
        return st;
    }

    guideInstall(sid: string, what: string, p: string) {
        const emu = this.emulatorFor(sid);
        const exe = emu ? this.emuExe(emu) : null;
        return emuguide.install(sid, emu || '', exe, what, p);
    }

    status() {
        const systems: any = {};
        const allemu = this.allEmulators();
        for (const sid of Object.keys(this.presets.systems)) {
            const st = this.systemStatus(sid, allemu);
            if (st)
                systems[sid] = st;
        }
        const emus: any = {};
        for (const [eid, ec] of Object.entries<any>(allemu)) {
            const exe = this.emuExe(eid);
            emus[eid] = { ...ec, id: eid, installed: Boolean(exe), exe_path: exe || '',
                pointed: Boolean((this.store.config.emu_paths || {})[eid]),
                systems: ec.systems || Object.entries<any>(this.presets.systems).filter(([, sc]) => sc.emulator === eid).map(([s]) => s) };
        }
        if (Object.values<any>(emus).some((e) => e.installed) && (!this.updAt || now() - this.updAt > 12 * 3600) && !this.updRunning) {
            this.updRunning = true;
            this.checkUpdates().catch(() => undefined).finally(() => { this.updRunning = false; });
        }
        for (const u of this.upd)
            if (emus[u.id])
                emus[u.id].update = u.latest;
        return { systems, emulators: emus, bios_dir: P.EMU_BIOS, games_root: P.EMU_GAMES, updates: this.upd };
    }

    addCustomEmulator(data: any, makeDefault = true) {
        this.forgetExe();
        const exe = String(data.exe || '').trim();
        if (!exe || !isFile(exe))
            throw new Error('Executável não encontrado');
        const stem = path.parse(exe).name;
        const eid = String(data.id || data.title || stem).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (!eid)
            throw new Error('Dê um nome ao emulador');
        let args = data.args;
        if (typeof args === 'string')
            args = args.split(/\s+/).filter(Boolean);
        const systems = (data.systems || []).filter((s: string) => this.presets.systems[s]);
        const base = data.based_on;
        if (!args || !args.length) {
            if (base && this.presets.emulators[base])
                args = this.argsFor(base, systems[0] || '');
            if (!args || !args.length)
                args = ['{rom}'];
        }
        const custom = { ...(this.store.config.custom_emulators || {}) };
        custom[eid] = { title: data.title || stem, exe, args, systems, based_on: base || '' };
        const se = { ...(this.store.config.system_emulator || {}) };
        for (const sid of systems)
            if (makeDefault || !se[sid])
                se[sid] = eid;
        this.store.setConfig({ custom_emulators: custom, system_emulator: se });
        return { id: eid, ...custom[eid] };
    }

    setEmulatorExe(eid: string, exe: string | null) {
        this.forgetExe();
        const ep = { ...(this.store.config.emu_paths || {}) };
        if (exe) {
            if (!exists(exe))
                throw new Error('Executável não encontrado');
            ep[eid] = exe;
        }
        else
            delete ep[eid];
        this.store.setConfig({ emu_paths: ep });
        return { ok: true, exe: exe || '' };
    }

    removeCustomEmulator(eid: string) {
        this.forgetExe();
        const custom = { ...(this.store.config.custom_emulators || {}) };
        delete custom[eid];
        const se: any = {};
        for (const [k, v] of Object.entries(this.store.config.system_emulator || {}))
            if (v !== eid)
                se[k] = v;
        this.store.setConfig({ custom_emulators: custom, system_emulator: se });
    }

    setSystemEmulator(sid: string, eid: string | null) {
        const se = { ...(this.store.config.system_emulator || {}) };
        if (eid)
            se[sid] = eid;
        else
            delete se[sid];
        this.store.setConfig({ system_emulator: se });
    }

    addRomDir(sid: string, folder: string) {
        const rd: any = {};
        for (const [k, v] of Object.entries<any>(this.store.config.rom_dirs || {}))
            rd[k] = [...v];
        const lst = rd[sid] || (rd[sid] = []);
        if (!lst.includes(folder))
            lst.push(folder);
        this.store.setConfig({ rom_dirs: rd });
        this.invalidateScan(sid);
    }

    removeRomDir(sid: string, folder: string) {
        const rd: any = {};
        for (const [k, v] of Object.entries<any>(this.store.config.rom_dirs || {}))
            rd[k] = v.filter((x: string) => x !== folder);
        this.store.setConfig({ rom_dirs: rd });
        this.invalidateScan(sid);
    }

    guessSystemForFile(p: string): string {
        const ext = path.extname(p).toLowerCase();
        const cands = Object.entries<any>(this.presets.systems).filter(([, sc]) => (sc.exts || []).includes(ext)).map(([sid]) => sid);
        if (!cands.length)
            return '';
        if (cands.length === 1)
            return cands[0];
        const g = guessSystem(p);
        return cands.includes(g) ? g : cands[0];
    }

    addRomFile(p: string, sid: string) {
        if (!exists(p))
            throw new Error('Arquivo não encontrado');
        if (!this.presets.systems[sid] || sid === 'pc')
            throw new Error('Sistema inválido');
        const lst = (this.store.config.rom_files || []).filter((x: any) => x.path !== p);
        lst.push({ path: p, system: sid });
        this.store.setConfig({ rom_files: lst });
        this.invalidateScan(sid);
        const stem = path.parse(p).name;
        return { ok: true, key: `rom:${sid}:${stem}`, title: stem.replace(ROM_TITLE_RE, '').trim() };
    }

    removeRomFile(p: string) {
        const lst = (this.store.config.rom_files || []).filter((x: any) => x.path !== p);
        this.store.setConfig({ rom_files: lst });
        this.invalidateScan();
    }

    scanSystem(sid: string, wait = true): any[] {
        const hit = this.scanCache.get(sid);
        if (hit && hit.at && now() - hit.at < this.SCAN_TTL)
            return hit.list;
        if (!this.scanRunning.has(sid)) {
            this.scanRunning.add(sid);
            void this.scanBg(sid);
        }
        if (hit)
            return hit.list;
        if (!wait)
            return [];
        let out: any[] = [];
        try {
            const t0 = now();
            out = this.scanSystemUncached(sid);
            if (now() - t0 > 0.5)
                log.info('roms %s: %d em %ss', sid, out.length, (now() - t0).toFixed(1));
        }
        finally {
            this.scanRunning.delete(sid);
        }
        this.scanCache.set(sid, { at: now(), list: out });
        this.saveScanCache();
        return out;
    }

    private scanChain: Promise<void> = Promise.resolve();
    private scanBg(sid: string): Promise<void> {
        const run = this.scanChain.then(() => this.scanBgNow(sid));
        this.scanChain = run.catch(() => undefined);
        return run;
    }

    private async scanBgNow(sid: string) {
        try {
            const t0 = now();
            const sc = this.presets.systems[sid];
            if (!sc)
                return;
            const dirs = this.romDirs(sid).filter(isDir);
            let files: Array<{ path: string; size: number }> = [];
            if (dirs.length) {
                const scanner = await import('./scanner');
                files = await scanner.walkFilesAsync(dirs, 7, sc.exts || []);
            }
            const out = this.buildRomList(sid, files);
            if (now() - t0 > 0.5)
                log.info('roms %s: %d em %ss', sid, out.length, (now() - t0).toFixed(1));
            this.scanCache.set(sid, { at: now(), list: out });
            this.saveScanCache();
        }
        catch (e) {
            log.debug?.('romscan %s: %s', sid, e);
        }
        finally {
            this.scanRunning.delete(sid);
        }
    }

    scanPending() {
        return this.scanRunning.size > 0;
    }

    private romDirs(sid: string): string[] {
        return [path.join(P.EMU_GAMES, sid), ...((this.store.config.rom_dirs || {})[sid] || [])];
    }

    private scanSystemUncached(sid: string): any[] {
        const sc = this.presets.systems[sid];
        if (!sc)
            return [];
        const exts = new Set<string>(sc.exts || []);
        const files: Array<{ path: string; size: number }> = [];
        for (const d of this.romDirs(sid)) {
            if (!isDir(d))
                continue;
            walk(d, 7, (f, n) => {
                const low = n.toLowerCase();
                for (const e of exts) {
                    if (low.endsWith(e)) {
                        let size = 0;
                        try {
                            size = fs.statSync(f).size;
                        }
                        catch {
                            return;
                        }
                        files.push({ path: f, size });
                        break;
                    }
                }
            });
        }
        return this.buildRomList(sid, files);
    }

    private buildRomList(sid: string, found: Array<{ path: string; size: number }>): any[] {
        const sc = this.presets.systems[sid];
        if (!sc)
            return [];
        const exts = new Set<string>(sc.exts || []);
        const out: any[] = [];
        const seen = new Set<string>();
        const sizes = new Map<string, number>();
        for (const f of found)
            sizes.set(f.path, f.size);
        for (const rf of this.store.config.rom_files || []) {
            if (rf.system !== sid || sizes.has(rf.path))
                continue;
            try {
                const st = fs.statSync(rf.path);
                if (st.isFile())
                    sizes.set(rf.path, st.size);
            }
            catch { /* sumiu */ }
        }
        const have = new Set<string>([...sizes.keys()].map((p) => (WIN ? p.toLowerCase() : p)));
        const marker = sc.marker;
        const overrides = this.store.config.title_overrides || {};
        const files = [...sizes.keys()].sort();
        for (const f of files) {
            if (!exts.has(path.extname(f).toLowerCase()))
                continue;
            if (marker && !f.replace(/\\/g, '/').endsWith(marker))
                continue;
            if (path.extname(f).toLowerCase() === '.bin') {
                const cue = f.slice(0, -4) + '.cue';
                if (have.has(WIN ? cue.toLowerCase() : cue) || exists(cue))
                    continue;
            }
            let stem: string;
            let title: string;
            if (marker) {
                let root = f;
                for (let i = 0; i < (sc.title_up || 1); i++)
                    root = path.dirname(root);
                stem = path.basename(root);
                title = stem.replace(ROM_TITLE_RE, '').trim();
            }
            else {
                stem = path.parse(f).name;
                title = stem.replace(ROM_TITLE_RE, '').trim();
            }
            if (seen.has(title.toLowerCase()))
                continue;
            seen.add(title.toLowerCase());
            const key = `rom:${sid}:${stem}`;
            const ov = overrides[key];
            const shown = (ov && typeof ov === 'object' ? ov.title : ov) || normalizeTitle(title) || title;
            out.push({ key, title: shown, path: f, system: sid, size: sizes.get(f) || 0, kind: 'rom' });
        }
        return out;
    }

    scanAll(wait = true): any[] {
        const out: any[] = [];
        for (const sid of Object.keys(this.presets.systems))
            if (sid !== 'pc')
                out.push(...this.scanSystem(sid, wait));
        return out;
    }

    ensureGameDirs() {
        for (const sid of Object.keys(this.presets.systems))
            if (sid !== 'pc')
                fs.mkdirSync(path.join(P.EMU_GAMES, sid), { recursive: true });
    }

    private async latestRelease(cfg: any, ttl = 6 * 3600): Promise<any | null> {
        if (!['github', 'gitea'].includes(cfg.source))
            return null;
        const api = cfg.source === 'gitea'
            ? `${String(cfg.api).replace(/\/+$/, '')}/api/v1/repos/${cfg.repo}/releases?limit=5`
            : `https://api.github.com/repos/${cfg.repo}/releases?per_page=5`;
        let rels = await this.cache.getJson(`gh_${cfg.repo}`, api, ttl);
        rels = (Array.isArray(rels) ? rels : []).filter((r: any) => !r.draft);
        if (!rels.length)
            return null;
        return rels.find((r: any) => !r.prerelease) || rels[0];
    }

    static normVer(v: any) {
        return String(v || '').replace(/^[vV]|[^0-9a-zA-Z.\-]/g, '').trim().toLowerCase();
    }

    static relStamp(rel: any): string {
        const stamps = (rel.assets || []).map((a: any) => a.updated_at || a.created_at || '');
        stamps.push(rel.published_at || '');
        return stamps.length ? stamps.sort().pop() : '';
    }

    async checkUpdates(force = false) {
        const t = now();
        if (!force && this.updAt && t - this.updAt < 12 * 3600)
            return this.upd;
        const out: any[] = [];
        for (const [eid, cfg] of Object.entries<any>(this.presets.emulators)) {
            const info = this.store.lib(`emu:${eid}`) || {};
            const cur = info.version || '';
            if (!cur || !info.dir || !this.emuExe(eid) || (this.store.config.emu_paths || {})[eid])
                continue;
            let rel: any;
            try {
                rel = await this.latestRelease(cfg, force ? 60 : 6 * 3600);
            }
            catch (e) {
                log.debug?.('update check %s: %s', eid, e);
                continue;
            }
            if (!rel)
                continue;
            const latest = rel.tag_name || '';
            if (!latest)
                continue;
            if (/\d/.test(latest) && EmulationManager.normVer(latest) !== EmulationManager.normVer(cur))
                out.push({ id: eid, title: cfg.title || eid, current: cur, latest, url: rel.html_url || '' });
            else if (!/\d/.test(latest)) {
                const have = info.release_at || '';
                const nw = EmulationManager.relStamp(rel);
                if (have && nw && nw > have)
                    out.push({ id: eid, title: cfg.title || eid, current: have.slice(0, 10), latest: nw.slice(0, 10), url: rel.html_url || '' });
            }
        }
        this.upd = out;
        this.updAt = t;
        return out;
    }

    async installEmulator(emuId: string, cb: (p: any) => void, cancel: any, keep = false): Promise<string> {
        this.forgetExe();
        const cfg = this.presets.emulators[emuId];
        let dest = this.emuDir(emuId);
        const tmp = path.join(P.DOWNLOADS, `emu_${emuId}`);
        fs.mkdirSync(tmp, { recursive: true });
        if (cfg.source === 'manual')
            throw new Error(`${cfg.title} não tem download automático. Baixe em ${cfg.homepage || ''} e use 'Apontar .exe'.`);
        let name: string;
        let url: string;
        let size = 0;
        let version = '';
        let releaseAt = '';
        if (cfg.source === 'github' || cfg.source === 'gitea') {
            const rel = await this.latestRelease(cfg, keep ? 60 : 6 * 3600);
            if (!rel)
                throw new Error(`Nenhuma versão publicada encontrada em ${cfg.repo}`);
            let assets: any[] = [];
            if (!WIN) {
                const lpat = new RegExp(cfg.asset_linux || 'appimage|linux.*(x64|x86_64|64)|(x64|x86_64).*linux', 'i');
                assets = (rel.assets || []).filter((a: any) => lpat.test(a.name) && !/arm64|aarch64|\.sha|\.sig|\.zsync|source|dbg|symbols|flatpak/i.test(a.name));
                assets.sort((a: any, b: any) => Number(!a.name.toLowerCase().endsWith('.appimage')) - Number(!b.name.toLowerCase().endsWith('.appimage')));
            }
            if (!assets.length) {
                const pat = new RegExp(cfg.asset || 'win.*(x64|64)|(x64|64).*win|windows', 'i');
                assets = (rel.assets || []).filter((a: any) => pat.test(a.name) && !/installer|setup|symbols|pdb|dbg|arm64|linux|macos|\.dmg|appimage|source|\.sha|\.sig/i.test(a.name));
            }
            if (!assets.length)
                throw new Error(`Nenhum build ${!WIN ? 'de Linux ou ' : ''}Windows encontrado em ${cfg.repo}`);
            const a = assets[0];
            name = a.name;
            url = a.browser_download_url;
            size = Number(a.size || 0);
            version = rel.tag_name || '';
            releaseAt = EmulationManager.relStamp(rel);
        }
        else {
            url = cfg.url;
            name = url.split('/').pop()!;
            const m = url.match(/(\d+\.\d+(\.\d+)?|\d{4}[a-z]?)/);
            version = m ? m[1] : '';
        }
        cb(prog('download', 0, `Baixando ${cfg.title}...`));
        const archiveFile = await downloader.downloadFile({ url, dir: tmp, name, size }, (p: any) => cb(prog('download', p.frac, p.text || `Baixando ${cfg.title}...`, p.speed, p.eta)), cancel, this.session);
        const finalDest = dest;
        if (keep && exists(dest)) {
            dest = path.join(tmp, 'new');
            rmrf(dest);
        }
        else if (exists(dest))
            rmrf(dest);
        cb(prog('extract', 0, 'Extraindo...'));
        const low = archiveFile.toLowerCase();
        if (low.endsWith('.appimage')) {
            fs.mkdirSync(dest, { recursive: true });
            const fin = path.join(dest, path.basename(archiveFile));
            fs.renameSync(archiveFile, fin);
            fs.chmodSync(fin, 0o755);
        }
        else if (low.endsWith('.exe') && !isZip(archiveFile)) {
            try {
                await archive.extract(archiveFile, dest, { cancel, onProgress: (f: number, t: string) => cb(prog('extract', f, t)) });
            }
            catch {
                fs.mkdirSync(dest, { recursive: true });
                fs.renameSync(archiveFile, path.join(dest, cfg.exe));
            }
        }
        else
            await archive.extract(archiveFile, dest, { cancel, onProgress: (f: number, t: string) => cb(prog('extract', f, t)) });
        archive.normalizeRoot(dest, true);
        if (dest !== finalDest) {
            cb(prog('extract', 0.9, 'Atualizando arquivos (configurações e saves ficam)...'));
            fs.cpSync(dest, finalDest, { recursive: true, force: true });
            dest = finalDest;
        }
        rmrf(tmp);
        this.updAt = 0;
        const flag = cfg.portable_flag;
        if (flag) {
            const p = path.join(dest, flag);
            if (flag.endsWith('/'))
                fs.mkdirSync(p, { recursive: true });
            else if (!exists(p))
                fs.writeFileSync(p, '');
        }
        if (emuId === 'retroarch')
            await this.retroarchCores(dest, cb, cancel);
        this.store.patchLib(`emu:${emuId}`, { dir: dest, title: cfg.title, kind: 'emulator', version, release_at: releaseAt,
            installed_at: this.store.lib(`emu:${emuId}`)?.installed_at || now() });
        cb(prog('done', 1, `${cfg.title} ${version} instalado`));
        return dest;
    }

    private async retroarchCores(dest: string, cb: (p: any) => void, cancel: any) {
        const ra = this.presets.emulators.retroarch;
        const coresDir = path.join(dest, 'cores');
        fs.mkdirSync(coresDir, { recursive: true });
        const cores = ra.cores || {};
        const needed = new Set<string>();
        for (const [sid, sc] of Object.entries<any>(this.presets.systems))
            if (this.emulatorFor(sid) === 'retroarch' && (sc.core || cores[sid]))
                needed.add(sc.core || cores[sid]);
        for (const core of needed) {
            if (cancel?.aborted)
                return;
            cb(prog('extract', -1, `Baixando core ${core}...`));
            try {
                const r = await this.session.request(String(ra.cores_url).replace('{core}', core), { timeout: 60_000 });
                if (r.status >= 400)
                    continue;
                safeExtractAll(Buffer.from(await r.arrayBuffer()), coresDir);
            }
            catch { /* core opcional */ }
        }
    }

    async ensureCore(core: string): Promise<string | null> {
        const dest = path.join(this.emuDir('retroarch'), 'cores', `${core}_libretro.${WIN ? 'dll' : 'so'}`);
        if (exists(dest))
            return dest;
        try {
            const url = String(this.presets.emulators.retroarch.cores_url).replace('{core}', core);
            const r = await this.session.request(url, { timeout: 120_000 });
            if (r.status >= 400)
                return null;
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            safeExtractAll(Buffer.from(await r.arrayBuffer()), path.dirname(dest));
        }
        catch {
            return null;
        }
        return exists(dest) ? dest : null;
    }

    removeEmulator(emuId: string) {
        this.forgetExe();
        rmrf(this.emuDir(emuId));
        this.store.removeLib(`emu:${emuId}`);
    }

    async launchRom(romPath: string, sid: string, emuOverride: string | null = null, force = false): Promise<any> {
        const sc = this.presets.systems[sid];
        if (!sc)
            return { error: `Sistema desconhecido: ${sid}` };
        const emuId = emuOverride && this.allEmulators()[emuOverride] ? emuOverride : this.emulatorFor(sid);
        const exe = emuId ? this.emuExe(emuId) : null;
        if (!exe) {
            const title = this.allEmulators()[emuId || '']?.title || emuId;
            return { error: 'emu_missing', emulator: emuId, message: `${title} não está instalado.` };
        }
        const hint = '';
        const miss = sid in emuguide.GUIDES ? emuguide.missingRequired(sid, emuId!, exe) : [];
        if (miss.length && !force)
            return { error: 'needs_setup', system: sid, emulator: emuId, missing: miss,
                message: `${sc.name}: falta ${miss.join(', ')}. O guia do console mostra onde conseguir e instala no lugar certo.` };
        let args: string[];
        if (emuId === 'retroarch') {
            const coreName = sc.core || (this.presets.emulators.retroarch.cores || {})[sid];
            const core = coreName ? await this.ensureCore(coreName) : null;
            if (!core)
                return { error: 'emu_missing', emulator: emuId, message: `Core do RetroArch pra ${sc.name} não encontrado.` };
            args = ['-L', core, '-f', '{rom}'];
        }
        else
            args = this.argsFor(emuId!, sid);
        const sub: Record<string, string> = { '{rom}': romPath, '{romdir}': path.dirname(romPath), '{stem}': path.parse(romPath).name };
        const cmd = [exe, ...args.map((a) => EmulationManager.sub(a, sub))];
        const joined = args.join(' ');
        if (!Object.keys(sub).some((k) => joined.includes(k)))
            cmd.push(romPath);
        return { cmd, cwd: path.dirname(exe), hint };
    }

    static sub(a: string, sub: Record<string, string>) {
        for (const [k, v] of Object.entries(sub))
            a = a.split(k).join(v);
        return a;
    }

    argsFor(emuId: string, sid: string): string[] {
        const ec = this.allEmulators()[emuId] || {};
        if (ec.custom)
            return ec.args && ec.args.length ? ec.args : ['{rom}'];
        const ea = ec.args;
        if (ea && !Array.isArray(ea) && typeof ea === 'object')
            return ea[sid] || ea['*'] || ['{rom}'];
        if (Array.isArray(ea))
            return ea;
        const sc = this.presets.systems[sid] || {};
        if (sc.emulator === emuId && sc.args)
            return sc.args;
        return ['{rom}'];
    }

    openEmulatorGui(emuId: string) {
        const exe = this.emuExe(emuId);
        if (!exe)
            return { error: 'emu_missing', emulator: emuId, message: 'Emulador não instalado.' };
        try {
            const c = cp.spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore', windowsHide: false });
            c.on('error', (e) => log.warn('emulador %s: %s', emuId, e));
            c.unref();
        }
        catch (e: any) {
            return { error: String(e?.message || e) };
        }
        return { ok: true };
    }
}

function isZip(file: string) {
    try {
        const fd = fs.openSync(file, 'r');
        const b = Buffer.alloc(4);
        fs.readSync(fd, b, 0, 4, 0);
        fs.closeSync(fd);
        return b[0] === 0x50 && b[1] === 0x4b;
    }
    catch {
        return false;
    }
}

function safeExtractAll(buf: Buffer, dest: string) {
    const z = new AdmZip(buf);
    const root = path.resolve(dest);
    for (const e of z.getEntries()) {
        if (e.isDirectory)
            continue;
        const target = path.resolve(dest, e.entryName);
        if (!target.startsWith(root + path.sep))
            continue;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, e.getData());
    }
}

export const homeDir = () => os.homedir();
