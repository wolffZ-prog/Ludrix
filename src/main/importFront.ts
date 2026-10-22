import fs from 'node:fs';
import path from 'node:path';
import * as P from './paths';
import * as log from './log';
import * as dialogs from './dialogs';
import * as importers from './importers';
import * as scanner from './scanner';
import * as steamexport from './steamexport';
import { findExecutables } from './installer';
import { STATUSES } from './metahub';
import { decodeHtmlEntities } from './http';

const normcase = scanner.normcase;
const isDir = (p: string) => {
    try {
        return fs.statSync(p).isDirectory();
    }
    catch {
        return false;
    }
};
const isFile = (p: string) => {
    try {
        return fs.statSync(p).isFile();
    }
    catch {
        return false;
    }
};
const exists = (p: string) => fs.existsSync(p);
const later = () => new Promise<void>((r) => setTimeout(r, 0));

function list2cmdline(args: string[]): string {
    return args.map((a) => {
        if (a && !/[\s"]/.test(a))
            return a;
        let out = '"', bs = 0;
        for (const c of a) {
            if (c === '\\')
                bs++;
            else if (c === '"') {
                out += '\\'.repeat(bs * 2 + 1) + '"';
                bs = 0;
            }
            else {
                out += '\\'.repeat(bs) + c;
                bs = 0;
            }
        }
        return out + '\\'.repeat(bs * 2) + '"';
    }).join(' ');
}
function shQuote(s: string): string {
    return /^[a-zA-Z0-9_@%+=:,./-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\"'\"'") + "'";
}

export class ImportFront {
    state: any = null;
    skipped: any[] = [];
    constructor(public be: any) {
        importers.setExtGuess((p) => this.emu.guessSystemForFile(p) || '');
    }
    get store() {
        return this.be.store;
    }
    get emu() {
        return this.be.emu;
    }
    get hub() {
        return this.be.hub;
    }

    importCoverPath(p: string): string | null {
        const st = this.state || {};
        const ok = new Set<string>(((st.result || {}).games || []).map((g: any) => g.cover_file));
        return p && ok.has(p) && isFile(p) ? p : null;
    }

    importLaunchers(): any[] {
        return importers.listLaunchers();
    }

    async importPick(launcherId: string, mode = ''): Promise<any> {
        const l = importers.listLaunchers().find((x) => x.id === launcherId);
        if (!l)
            return { error: 'Launcher desconhecido' };
        const init = l.detected ? l.default_path : '';
        if ((mode || l.pick) === 'file') {
            const initDir = init && !isDir(init) ? path.dirname(init) : init;
            return { native: true, path: await dialogs.pickFile(l.pick_kind || 'any', initDir) };
        }
        return { native: true, path: await dialogs.pickFolder(init) };
    }

    private start(msg = 'Abrindo…'): any {
        const st = { done: false, msg, result: null as any };
        this.state = st;
        return st;
    }

    importScan(launcherId: string, p: string, opts: any = null): any {
        const st = this.start();
        importers.setProgress((m) => { st.msg = m; });
        setTimeout(async () => {
            try {
                st.result = await this.importScanSync(launcherId, p, opts || {});
            }
            catch (e: any) {
                log.error('import: %s', e?.stack || e);
                st.result = { error: String(e?.message || e) };
            }
            finally {
                st.done = true;
                importers.setProgress(null);
            }
        }, 0);
        return { async: true };
    }

    gameDirs(): string[] {
        const out = [String(this.store.gamesDir())];
        for (const d of this.store.config.game_dirs || [])
            if (d && !out.includes(d))
                out.push(d);
        return out;
    }

    async gameDirAdd(p: string | null = null): Promise<any> {
        if (!p) {
            p = await dialogs.pickFolder(String(this.store.gamesDir()));
            if (!p)
                return { ok: false };
        }
        if (!isDir(p))
            return { error: 'Pasta não encontrada' };
        const cur = (this.store.config.game_dirs || []).filter((d: string) => d);
        const norm = normcase(path.normalize(p));
        if (norm === normcase(path.normalize(String(this.store.gamesDir()))) || cur.some((d: string) => normcase(path.normalize(d)) === norm))
            return { ok: true, dirs: cur, dup: true };
        if (norm.startsWith(normcase(path.normalize(P.ROOT)) + path.sep))
            return { error: 'Essa pasta fica dentro do próprio Ludrix' };
        cur.push(p);
        this.store.setConfig({ game_dirs: cur });
        return { ok: true, dirs: cur };
    }

    gameDirRemove(p: string): any {
        const cur = (this.store.config.game_dirs || []).filter((d: string) => d && d !== p);
        this.store.setConfig({ game_dirs: cur });
        return { ok: true, dirs: cur };
    }

    scanIgnore(exes: string[]): any {
        const cur = [...(this.store.config.scan_ignored || [])];
        for (let e of exes || []) {
            e = String(e || '').toLowerCase();
            if (e && !cur.includes(e))
                cur.push(e);
        }
        this.store.setConfig({ scan_ignored: cur.slice(-2000) });
        return { ok: true, count: cur.length };
    }

    knownCover(known: [Set<string>, Set<string>]): Set<string> {
        const cover = new Set<string>();
        for (const x of [...known[0], ...known[1]]) {
            let cur = x;
            for (let i = 0; i < 12; i++) {
                cover.add(cur);
                const up = path.dirname(cur);
                if (!up || up === cur)
                    break;
                cur = up;
            }
        }
        return cover;
    }

    async scanNewGames(prog: scanner.Progress = null, quick = false): Promise<any[]> {
        const known = this.knownPc();
        const ignored = new Set<string>((this.store.config.scan_ignored || []).map((x: any) => String(x).toLowerCase()));
        let skip: Set<string> | null = null;
        if (quick) {
            skip = this.knownCover(known);
            for (const x of ignored)
                skip.add(normcase(path.normalize(x)));
        }
        const out: any[] = [], seen = new Set<string>();
        for (const d of this.gameDirs()) {
            if (!isDir(d))
                continue;
            let items: any[];
            try {
                items = await scanner.scanWindowsAsync(d, prog, 3000, skip);
            }
            catch (e: any) {
                log.debug('scan %s: %s', d, e?.message || e);
                continue;
            }
            for (const it of items) {
                let ex = String(it.exe).toLowerCase();
                if (ignored.has(ex)) {
                    const alts = (it.alt_exes || []).filter((a: string) => !ignored.has(a.toLowerCase()));
                    if (!alts.length)
                        continue;
                    it.exe = alts[0];
                    it.alt_exes = alts.slice(1);
                    it.confidence = 'média';
                    ex = it.exe.toLowerCase();
                }
                if (seen.has(ex) || this.isKnownPc(it, known))
                    continue;
                seen.add(ex);
                it.dup = false;
                it.root = d;
                out.push(it);
            }
        }
        return out;
    }

    knownPc(): [Set<string>, Set<string>] {
        const exes = new Set<string>(), dirs = new Set<string>();
        for (const v of Object.values<any>(this.store.library)) {
            const ex = String(v.exe || '');
            if (ex && !ex.includes('://'))
                exes.add(normcase(path.normalize(ex)));
            if (v.kind === 'rom')
                continue;
            const d = String(v.dir || '');
            if (d)
                dirs.add(normcase(path.normalize(d)));
        }
        return [exes, dirs];
    }

    isKnownPc(it: any, known: [Set<string>, Set<string>]): boolean {
        const [exes, dirs] = known;
        const ex = normcase(path.normalize(it.exe || ''));
        const d = normcase(path.normalize(it.dir || path.dirname(ex)));
        if (exes.has(ex) || dirs.has(d))
            return true;
        for (const a of it.alt_exes || [])
            if (exes.has(normcase(path.normalize(a))))
                return true;
        const pre = d + path.sep;
        for (const k of dirs)
            if (d.startsWith(k + path.sep) || k.startsWith(pre))
                return true;
        for (const e of exes)
            if (e.startsWith(pre))
                return true;
        return false;
    }

    autoScanDirs() {
        setTimeout(async () => {
            try {
                if (this.store.config.auto_scan_dirs === false || !this.store.config.welcome_done)
                    return;
                const t0 = Date.now();
                const items = await this.scanNewGames(null, true);
                log.info('varredura rápida das pastas de jogos: %d novo(s) em %ss', items.length, ((Date.now() - t0) / 1000).toFixed(1));
                if (items.length)
                    this.be.push({ type: 'new_games', count: items.length, games: items.slice(0, 300), dirs: this.gameDirs() });
            }
            catch (e: any) {
                log.debug('auto scan: %s', e?.message || e);
            }
        }, 25000);
    }

    private emulatorsPayload(): any[] {
        const emus = this.emu.allEmulators();
        return Object.entries<any>(emus).map(([k, v]) => ({ id: k, title: v.title || k, systems: v.systems || [], installed: Boolean(this.emu.emuExe(k)) }));
    }

    async folderScan(p: string | null, mode: string): Promise<any> {
        if (p === '*' && mode !== 'roms') {
            const st = this.start();
            setTimeout(async () => {
                try {
                    const items = await this.scanNewGames((m) => { st.msg = m; });
                    st.result = { games: items, count: items.length, path: this.gameDirs().join(' · '), mode, emulators: this.emulatorsPayload() };
                }
                catch (e: any) {
                    log.error('folder_scan all: %s', e?.stack || e);
                    st.result = { error: String(e?.message || e) };
                }
                finally {
                    st.done = true;
                }
            }, 0);
            return { async: true, path: p };
        }
        if (!p) {
            p = await dialogs.pickFolder(mode === 'windows' ? P.GAMES : P.EMU_GAMES);
            if (!p)
                return { ok: false };
        }
        if (!isDir(p))
            return { error: 'Pasta não encontrada' };
        const st = this.start();
        const root = p;
        setTimeout(async () => {
            try {
                const prog = (m: string) => { st.msg = m; };
                let items: any[];
                if (mode === 'roms') {
                    items = await scanner.scanRomsAsync(root, this.emu.presets.systems, prog);
                    const have = new Set<string>((this.store.config.rom_files || []).map((x: any) => x.path));
                    const dirs: string[] = [];
                    for (const v of Object.values<any>(this.store.config.rom_dirs || {}))
                        for (const d of v)
                            dirs.push(d);
                    for (const it of items)
                        it.dup = have.has(it.rom) || dirs.some((d) => it.rom.startsWith(d.replace(/[\\/]+$/, '') + path.sep));
                }
                else {
                    items = await scanner.scanWindowsAsync(root, prog);
                    const known = this.knownPc();
                    for (const it of items)
                        it.dup = this.isKnownPc(it, known);
                }
                st.result = { games: items, count: items.length, path: root, mode, emulators: this.emulatorsPayload() };
            }
            catch (e: any) {
                log.error('folder_scan: %s', e?.stack || e);
                st.result = { error: String(e?.message || e) };
            }
            finally {
                st.done = true;
            }
        }, 0);
        return { async: true, path: p };
    }

    async folderApply(games: any[], mode: string, opts: any = null): Promise<any> {
        opts = opts || {};
        let added = 0, skipped = 0;
        const keys: string[] = [];
        for (const g of games || []) {
            try {
                if (mode === 'roms') {
                    const rom = g.rom || '';
                    const sid = g.system || opts.system || '';
                    if (!rom || !exists(rom) || !this.emu.presets.systems[sid] || sid === 'pc') {
                        skipped++;
                        continue;
                    }
                    const r = this.emu.addRomFile(rom, sid);
                    this.be.setInstalled(r.key, { dir: path.dirname(rom), exe: rom, title: r.title, kind: 'rom', source: 'scan' });
                    if (g.title && g.title !== r.title)
                        this.be.applyTitle(r.key, g.title, false);
                    const emu = g.emulator || opts.emulator;
                    if (emu)
                        this.importPreferEmulator(sid, emu);
                    keys.push(r.key);
                }
                else {
                    const exe = g.exe || '';
                    if (!exe || !exists(exe)) {
                        skipped++;
                        continue;
                    }
                    const r = await this.be.addLocalGame(exe, g.title || null);
                    if (!r.key || r.existing) {
                        skipped++;
                        continue;
                    }
                    this.store.patchLib(r.key, { source: 'scan' });
                    if (g.args)
                        this.hub.setShortcut(r.key, null, String(g.args));
                    keys.push(r.key);
                }
                added++;
            }
            catch (e: any) {
                log.debug('folder_apply %s: %s', g.title, e?.message || e);
                skipped++;
            }
        }
        if (mode === 'roms' && opts.add_dir && opts.path) {
            if (opts.system)
                this.emu.addRomDir(opts.system, opts.path);
            else {
                const byDir = new Map<string, [string, string, number]>();
                for (const g of games || []) {
                    if (g.rom && g.system) {
                        const k = g.system + '\u0000' + path.dirname(g.rom);
                        const cur = byDir.get(k);
                        byDir.set(k, [g.system, path.dirname(g.rom), (cur ? cur[2] : 0) + 1]);
                    }
                }
                for (const [sid, d, n] of byDir.values())
                    if (n >= 2 || byDir.size === 1)
                        this.emu.addRomDir(sid, d);
            }
        }
        if (keys.length && this.store.config.auto_metadata)
            for (const k of keys)
                this.be.queueMeta(k);
        this.emu.invalidateScan();
        return { ok: true, added, skipped };
    }

    importPoll(): any {
        const st = this.state || { done: true, result: { error: 'Nada em andamento' } };
        if (st.done)
            return { done: true, ...(st.result || {}) };
        return { done: false, msg: st.msg };
    }

    async importScanSync(launcherId: string, p: string, opts: any = null): Promise<any> {
        let games: any[];
        try {
            games = importers.scan(launcherId, p, opts);
        }
        catch (e: any) {
            return { error: String(e?.message || e) };
        }
        const lib = Object.entries<any>(this.store.library);
        const knownExes = new Set(lib.map(([, i]) => String(i.exe || '').toLowerCase()));
        const knownTitles = new Map<string, Set<string>>();
        for (const [k, i] of lib) {
            const parts = k.split(':');
            const sid = i.system || (k.startsWith('rom:') && parts.length >= 3 ? parts[1] : 'pc');
            const t = String(i.title || '').toLowerCase();
            if (!knownTitles.has(t))
                knownTitles.set(t, new Set());
            knownTitles.get(t)!.add(sid);
        }
        for (const g of games) {
            g.dup = Boolean(knownExes.has(String(g.exe || g.rom || '').toLowerCase()) || (knownTitles.get(String(g.title).toLowerCase()) || new Set()).has(g.system || 'pc'));
            if (g.rom_dir)
                g.dup = ((this.store.config.rom_dirs || {})[g.system || ''] || []).includes(g.rom_dir);
            if (g.kind === 'emulator') {
                const vid = g.emulator || '';
                const ep = this.store.config.emu_paths || {};
                g.dup = Boolean(vid && (ep[vid] || this.emu.emuExe(vid)));
            }
        }
        const dropped = launcherId === 'playnite' ? importers.playniteDropped() : [];
        return { games, count: games.length, dropped: dropped.slice(0, 300) };
    }

    importApply(games: any[]): any {
        const st = this.start('Preparando…');
        if (Object.keys(this.store.library).length)
            this.be.libraryBackup();
        setTimeout(async () => {
            try {
                st.result = await this.importApplySync(games, (m) => { st.msg = m; });
            }
            catch (e: any) {
                log.error('import apply: %s', e?.stack || e);
                st.result = { error: String(e?.message || e) };
            }
            finally {
                st.done = true;
            }
        }, 0);
        return { async: true };
    }

    async importApplySync(games: any[], prog: (m: string) => void = () => { }): Promise<any> {
        let added = 0, skipped = 0;
        this.skipped = [];
        const rank = (g: any) => g.kind === 'emulator' ? 0 : g.rom_dir ? 1 : 2;
        games = [...(games || [])].sort((a, b) => rank(a) - rank(b) || Number(b.last_played || 0) - Number(a.last_played || 0) || Number(b.playtime || 0) - Number(a.playtime || 0));
        for (let i = 0; i < games.length; i++) {
            [added, skipped] = await this.importOne(games[i], added, skipped, prog, i, games.length);
            if (i % 10 === 9)
                await later();
        }
        this.emu.invalidateScan();
        if (games.some((g) => g.rom || g.rom_dir)) {
            prog('Atualizando lista de ROMs…');
            try {
                this.emu.scanAll(true);
            }
            catch (e: any) {
                log.debug('import rescan: %s', e?.message || e);
            }
        }
        try {
            this.hub.images.thumbs.t = 0;
            this.hub.covers.invalidateNames();
            this.hub.meta.touch();
        }
        catch { /* nada */ }
        return { ok: true, added, skipped, skipped_items: this.skipped.slice(0, 200) };
    }

    private async importOne(g: any, added: number, skipped: number, prog: (m: string) => void, i: number, n: number): Promise<[number, number]> {
        if (i % 5 === 0)
            prog(`Adicionando ${i + 1} de ${n}: ${g.title || ''}`);
        try {
            if (g.kind === 'emulator') {
                if (this.importEmulator(g))
                    added++;
                else
                    skipped = this.impSkip(g, skipped, !g.exe || !exists(g.exe) ? 'Emulador sem executável válido' : 'Emulador não reconhecido');
            }
            else if (g.rom_dir) {
                if (!g.system || !isDir(g.rom_dir))
                    return [added, this.impSkip(g, skipped, !g.system ? 'Console não identificado' : 'Pasta não existe', g.rom_dir)];
                this.emu.addRomDir(g.system, g.rom_dir);
                added++;
            }
            else if (g.rom) {
                if (!exists(g.rom))
                    return [added, this.impSkip(g, skipped, 'Arquivo não existe', g.rom)];
                const r = await require('./server2').frontFor(this.be).addRomFile(g.rom, g.system || null);
                if (r.error)
                    return [added, this.impSkip(g, skipped, r.error, g.rom)];
                const upd: any = {};
                for (const k of ['playtime', 'last_played'])
                    if (g[k])
                        upd[k] = g[k];
                upd.source = g.source || '';
                Object.assign(upd, this.impExtra(g));
                if (g.year)
                    upd.year = g.year;
                this.store.patchLib(r.key, upd);
                if (g.title && (g.title !== r.title || g.source === 'playnite'))
                    this.be.applyTitle(r.key, g.title, g.source === 'playnite');
                if (g.emulator && g.system)
                    this.importPreferEmulator(g.system, g.emulator);
                this.importCover(r.key, g);
                this.importFlags(r.key, g);
                added++;
            }
            else if (!g.exe && g.dir && isDir(g.dir)) {
                const exes = findExecutables(g.dir, g.title);
                if (!exes.length && g.alt_exe)
                    return this.importOne({ ...g, exe: g.alt_exe, alt_exe: '' }, added, skipped, prog, i, n);
                if (!exes.length)
                    return [added, this.impSkip(g, skipped, 'Nenhum executável na pasta', g.dir)];
                const r = await this.be.addLocalGame(exes[0], g.title, g.source !== 'playnite');
                if (r.existing)
                    return [added, this.impSkip(g, skipped, 'Já está na biblioteca', exes[0])];
                if (r.key) {
                    this.store.patchLib(r.key, { playtime: g.playtime || 0, last_played: g.last_played || 0, source: g.source || '', ...(g.year ? { year: g.year } : {}), ...this.impExtra(g) });
                    if (g.source === 'playnite')
                        this.be.applyTitle(r.key, g.title, true);
                    this.importCover(r.key, g);
                    this.importFlags(r.key, g);
                }
                added++;
            }
            else if (g.exe) {
                let exe = String(g.exe);
                if (!exe.includes('://') && !exists(exe)) {
                    if (g.dir && isDir(g.dir)) {
                        const exes = findExecutables(g.dir, g.title);
                        if (exes.length)
                            exe = exes[0];
                    }
                    if (!exists(exe))
                        return [added, this.impSkip(g, skipped, 'Arquivo não existe', exe)];
                }
                let r: any;
                if (exe.includes('://')) {
                    const title = g.title;
                    const key = 'local:' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                    const scheme = exe.split('://')[0].toLowerCase();
                    const src = scheme === 'steam' ? 'steam' : scheme.includes('epicgames') ? 'epic' : scheme.includes('gog') ? 'gog' : scheme === 'uplay' ? 'uplay'
                        : scheme.startsWith('origin') ? 'ea' : scheme === 'battlenet' ? 'battlenet' : scheme.includes('amazon') ? 'amazon' : 'url';
                    this.be.setInstalled(key, { dir: g.dir || '', exe, title, kind: 'local', source: src, steam_appid: g.steam_appid || '' });
                    if (this.store.config.auto_metadata)
                        this.be.queueMeta(key);
                    r = { key };
                }
                else {
                    r = await this.be.addLocalGame(exe, g.title, g.source !== 'playnite');
                }
                if (r.existing)
                    return [added, this.impSkip(g, skipped, 'Já está na biblioteca', exe)];
                if (r.key) {
                    this.store.patchLib(r.key, { playtime: g.playtime || 0, last_played: g.last_played || 0, source: g.source || '', ...(g.year ? { year: g.year } : {}), ...this.impExtra(g) });
                    if (g.source === 'playnite')
                        this.be.applyTitle(r.key, g.title, true);
                    if (g.args && !exe.includes('://'))
                        this.hub.setShortcut(r.key, null, String(g.args));
                    const wd = String(g.workdir || '').replace(/[\\/]+$/, '');
                    if (wd && !exe.includes('://') && isDir(wd) && normcase(wd) !== normcase(path.dirname(exe)))
                        this.store.patchLib(r.key, { workdir: wd });
                    this.importCover(r.key, g);
                    this.importFlags(r.key, g);
                    added++;
                }
                else {
                    skipped = this.impSkip(g, skipped, r.error || 'Não foi possível adicionar', exe);
                }
            }
            else {
                skipped = this.impSkip(g, skipped, 'Sem executável, ROM ou pasta');
            }
        }
        catch (e: any) {
            log.warn('import %s: %s', g.title, e?.message || e);
            skipped = this.impSkip(g, skipped, String(e?.message || e));
        }
        return [added, skipped];
    }

    private impSkip(g: any, skipped: number, why: string, p = ''): number {
        p = p || g.exe || g.rom || g.dir || '';
        this.skipped.push({ title: g.title || '?', why, path: p });
        log.info('import pulou: %s — %s (%s)', g.title || '?', why, p);
        return skipped + 1;
    }

    private impExtra(g: any): any {
        const out: any = {};
        if (g.added)
            out.installed_at = Number(g.added);
        if (g.play_count)
            out.play_count = Math.trunc(Number(g.play_count));
        return out;
    }

    private importFlags(key: string, g: any) {
        if (g.favorite)
            this.importFav(key);
        if (g.hidden) {
            try {
                if (!this.be.hiddenSet.has(key)) {
                    this.be.hiddenSet.add(key);
                    this.be.persistHidden();
                }
            }
            catch (e: any) {
                log.debug('import hidden: %s', e?.message || e);
            }
        }
    }

    private importFav(key: string) {
        try {
            const favs = [...(this.store.config.favorites || [])];
            if (!favs.includes(key)) {
                favs.push(key);
                this.store.setConfig({ favorites: favs });
                this.be.favorites.add(key);
            }
        }
        catch (e: any) {
            log.debug('import fav %s: %s', key, e?.message || e);
        }
    }

    private importCover(key: string, g: any) {
        const cf = g.cover_file || '';
        if (cf && isFile(cf) && !this.hub.covers.customPath(key)) {
            try {
                this.hub.covers.setCustom(key, cf, true);
                this.hub.images.invalidate(key);
            }
            catch (e: any) {
                log.debug('import cover %s: %s', key, e?.message || e);
            }
        }
        const meta: any = {};
        const bg = g.background_file || '';
        if (bg && isFile(bg)) {
            try {
                const dst = path.join(P.CACHE, 'backgrounds', key.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) + path.extname(bg).toLowerCase());
                fs.mkdirSync(path.dirname(dst), { recursive: true });
                fs.copyFileSync(bg, dst);
                meta.background_file = dst;
            }
            catch (e: any) {
                log.debug('import bg %s: %s', key, e?.message || e);
            }
        }
        if (g.description) {
            let txt = String(g.description).replace(/<br\s*\/?>|<\/p>/g, '\n');
            txt = decodeHtmlEntities(txt.replace(/<[^>]+>/g, ''));
            meta.summary = txt.replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
        }
        if (g.developers && g.developers.length)
            meta.developer = g.developers.join(', ');
        if (g.genres && g.genres.length)
            meta.genres = [...g.genres];
        if (g.year)
            meta.year = String(g.year);
        if (g.notes)
            meta.notes = String(g.notes).trim().slice(0, 2000);
        if (STATUSES.includes(g.status))
            meta.status = g.status;
        if (g.score)
            meta.score = Math.max(0, Math.min(10, Math.trunc(Number(g.score))));
        if (g.links && g.links.length)
            meta.links = g.links.filter((l: any) => l && typeof l === 'object' && l.url).slice(0, 8);
        if (Object.keys(meta).length)
            meta.imported = g.source || 'playnite';
        const extra: any = {};
        if (g.pn_source)
            extra.store_src = String(g.pn_source).slice(0, 40);
        if (g.play_count)
            extra.play_count = Math.trunc(Number(g.play_count));
        if (Object.keys(extra).length)
            this.store.patchLib(key, extra);
        if (Object.keys(meta).length) {
            try {
                const cur = this.hub.meta.get(key) || {};
                const merged: any = { ...cur };
                for (const [k, v] of Object.entries(meta))
                    if (!cur[k])
                        merged[k] = v;
                if (!('source' in merged))
                    merged.source = ['playnite'];
                const p = this.hub.meta.path(key);
                fs.mkdirSync(path.dirname(p), { recursive: true });
                fs.writeFileSync(p, JSON.stringify(merged, null, 1), 'utf8');
                this.hub.meta.touch();
            }
            catch (e: any) {
                log.debug('import meta %s: %s', key, e?.message || e);
            }
        }
        if (g.favorite)
            this.importFav(key);
    }

    importPreferEmulator(sid: string, vid: string) {
        try {
            if (this.emu.presets.emulators[vid] && (this.emu.emuExe(vid) || (this.store.config.emu_paths || {})[vid])) {
                if (this.emu.emulatorFor(sid) !== vid)
                    this.emu.setSystemEmulator(sid, vid);
            }
        }
        catch (e: any) {
            log.debug('prefer emu %s/%s: %s', sid, vid, e?.message || e);
        }
    }

    private importEmulator(g: any): boolean {
        let vid = g.emulator || '';
        let exe = g.exe || '';
        if ((!exe || !exists(exe)) && g.emu_dir && isDir(g.emu_dir)) {
            const want = vid ? ((this.emu.presets.emulators[vid] || {}).exe || '') : '';
            const exes = walkExes(g.emu_dir).filter((p) => !/unins|setup|updater|crash|vc_redist|dxsetup/i.test(path.basename(p)));
            let hits = exes.filter((p) => want && path.basename(p).toLowerCase() === want.toLowerCase());
            if (!hits.length && vid)
                hits = exes.filter((p) => path.parse(p).name.toLowerCase().includes(vid.split('-')[0]));
            if (!hits.length && exes.length === 1)
                hits = exes;
            exe = hits.length ? hits[0] : exe;
        }
        if (!exe || !exists(exe))
            return false;
        if (!vid)
            vid = importers.playniteEmuOf(path.parse(exe).name);
        if (this.emu.presets.emulators[vid] && !this.emu.sameFamily(vid, exe))
            vid = '';
        if (this.emu.presets.emulators[vid]) {
            this.emu.setEmulatorExe(vid, exe);
            for (const sid of g.systems || [])
                if (this.emu.presets.systems[sid] && !((this.emu.presets.emulators[vid].systems || []).includes(sid)))
                    this.emu.addSystemEmulator(sid, vid);
            return true;
        }
        const systems = (g.systems || []).filter((s: string) => s);
        if (!systems.length)
            return false;
        const title = String(g.title || path.parse(exe).name).replace(/^Emulador:\s*/, '');
        const args = String(g.args || '').replace(/\{ImagePath\}/g, '{rom}').replace(/\{ImageName\}/g, '{rom}').replace(/\{ImageNameNoExt\}/g, '{rom}');
        this.emu.addCustomEmulator({ title, exe, args: args || '{rom}', systems }, false);
        return true;
    }

    async exportSteam(user: string | null = null, keys: string[] | null = null): Promise<any> {
        const root = steamexport.steamRoot();
        if (!root)
            return { error: 'Steam não encontrada neste PC.' };
        if (steamexport.steamRunning())
            return { error: 'Feche a Steam antes de exportar. Com ela aberta, os atalhos novos seriam descartados ao sair.' };
        const us = steamexport.users(root);
        if (!us.length)
            return { error: 'Nenhuma conta da Steam já entrou neste PC (pasta userdata vazia).' };
        const pick = user ? us.find((u) => u.id === String(user)) : us.length === 1 ? us[0] : null;
        if (!pick)
            return { choose: us.map((u) => ({ id: u.id, name: u.name, shortcuts: u.shortcuts })) };
        const cat = (this.be.cat.payload() || {}).games || [];
        const sel = new Set(keys || []);
        const games: any[] = [];
        for (const g of cat) {
            const key = g.key;
            if (sel.size && !sel.has(key))
                continue;
            if (!sel.size && !(g.installed || key.startsWith('local:') || key.startsWith('rom:')))
                continue;
            if (g.kind === 'emulator')
                continue;
            const info = this.store.lib(key) || {};
            const exe = String(info.exe || '');
            if (!exe || exe.includes('://'))
                continue;
            const item: any = { title: g.title, last_played: Math.trunc(Number(g.last_played || 0)) };
            const sysid = g.system || info.system || 'pc';
            if (key.startsWith('rom:') || sysid !== 'pc') {
                const r = await this.emu.launchRom(exe, sysid);
                if (!r || !r.cmd)
                    continue;
                const cmd: string[] = r.cmd;
                Object.assign(item, { exe: cmd[0], dir: r.cwd || path.dirname(cmd[0]), args: process.platform === 'win32' ? list2cmdline(cmd.slice(1)) : cmd.slice(1).map(shQuote).join(' '), icon: cmd[0] });
            }
            else {
                if (!exists(exe))
                    continue;
                Object.assign(item, { exe, dir: info.workdir || info.dir || path.dirname(exe), args: this.be.gameArgs(key), icon: exe });
            }
            try {
                item.cover = (await this.hub.coverPath(key)) || '';
                item.hero = (await this.hub.heroPath(key)) || '';
            }
            catch { /* nada */ }
            games.push(item);
        }
        if (!games.length)
            return { error: 'Nenhum jogo com executável para enviar.' };
        const r = steamexport.exportShortcuts(pick.dir, games);
        if (r.ok)
            r.user = pick.name;
        return r;
    }
}

function walkExes(root: string, out: string[] = [], depth = 0): string[] {
    if (depth > 10)
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
            walkExes(p, out, depth + 1);
        else if (e.name.toLowerCase().endsWith('.exe'))
            out.push(p);
    }
    return out;
}

