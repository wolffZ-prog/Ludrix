/**
 * backend.ts — o coracao do launcher. Substitui app/core/ludrix.py.
 *
 * Toda a logica de biblioteca (catalogo, sessoes de jogo, edicao, capas,
 * metadados, temas, cache, backup) vive aqui. O servidor HTTP local apenas
 * traduz as rotas /api/* em chamadas para esta classe.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as cp from 'node:child_process';
import os from 'node:os';
import * as electron from 'electron';
import AdmZip from 'adm-zip';
import * as P from './paths';
import * as log from './log';
import * as util from './util';
import { MetaHub } from './metahub';
import { ImportFront } from './importFront';
import * as compat from './compat';
import { Repack } from './repack';
import * as backup from './backup';
import * as diagMod from './diag';
import { ModsManager, GameMods } from './mods';
import { FlashManager } from './flash';
import { SaveManager } from './saves';
import { safeFolderName, freeBytes } from './installer';
import { Terminal } from './terminal';
import { CentralFront, expandVars, bedrockInstalled, BEDROCK_AUMID, BEDROCK_STORE, JAVA_STORE, wingetPath } from './central';
import * as presets from './presets';
import * as themes from './themes';
import * as sys from './system';
import { GameMode } from './gamemode';
import { Jobs, prog } from './jobs';
import { CustomUX } from './custom';
import { DEFAULT_CONFIG } from './store';
import * as dialogs from './dialogs';
import * as store from './store';
import { SessionManager, humanTime as humanSession } from './sessions';
import { EmulationManager } from './emulation';
import * as webcache from './webcache';
import * as images from './images';
import * as exporters from './exporters';
import * as gamepadMod from './gamepad';
import * as http from './http';
import { Catalog } from './catalog';
import { normalizeTitle, titleFromPath } from './titles';
/** Extensoes reconhecidas como jogo de PC. */
const EXE_EXT = ['.exe', '.bat', '.cmd', '.lnk', '.sh', '.x86_64', '.AppImage', '.bin', '.jar'];
/** Pastas/arquivos que nunca devem ser tratados como jogo. */
const JUNK = /^(_commonredist|redist|directx|vcredist|dotnet|physx|_redist|support|prerequisites|commonfiles|installer|dxsetup|vcredist_x|oalinst|dotnetfx|ue4prereq|directx_|dxwebsetup)/i;
function isWindowsCmd(cmd: string[]) {
    return /\.(exe|bat|cmd)$/i.test(String(cmd[0] || ''));
}
const URI_RE = /^[a-zA-Z][a-zA-Z0-9+.-]+:\/\//;
const URI_NAMES: [string, string][] = [['steam', 'Steam'], ['epicgames', 'Epic Games Launcher'], ['legendary', 'Legendary'], ['goggalaxy', 'GOG Galaxy'], ['gog', 'GOG Galaxy'],
    ['uplay', 'Ubisoft Connect'], ['ubisoft', 'Ubisoft Connect'], ['origin', 'EA app'], ['eadesktop', 'EA app'], ['battlenet', 'Battle.net'],
    ['amazon', 'Amazon Games'], ['itch', 'itch.io'], ['xbox', 'Xbox'], ['ms-windows-store', 'Microsoft Store'], ['http', 'navegador']];
function uriName(uri: string) {
    const scheme = String(uri || '').split('://')[0].toLowerCase();
    for (const [k, v] of URI_NAMES)
        if (scheme.includes(k))
            return v;
    return scheme || 'launcher';
}
/* ------------------------------ o backend ------------------------------ */
class Backend {
    /** Fachada de persistencia (config.json + library.json). */
    store: store.Store;
    sessions!: SessionManager;
    emu!: EmulationManager;
    cat!: Catalog;
    favorites: Set<string> = new Set();
    hiddenSet: Set<string> = new Set();
    categories: any[] = [];
    lastRemoved: any = null;
    boot: any = { done: false, i: 0, n: 0, step: '', errors: [], started: false };
    /** Gatilhos de UI que o processo principal registra (minimizar, sair...). */
    windowHooks: Record<string, (...a: any[]) => any>;
    gamepad: gamepadMod.GamepadWatcher | null = null;
    /** Fila de eventos para a UI; /api/status drena a cada poll. */
    events: any[] = [];
    gamemode: GameMode = new GameMode(() => this.store?.config || {});
    jobs: Jobs = new Jobs(this);
    customUX!: CustomUX;
    quiet = false;
    hub!: MetaHub;
    imp!: ImportFront;
    central!: CentralFront;
    repack!: Repack;
    terminal!: Terminal;
    mods!: ModsManager;
    gmods!: GameMods;
    flash!: FlashManager;
    saves!: SaveManager;
    constructor() {
        this.events = [];
        this.store = new store.Store();
        this.backupLibrary();
        this.hub = new MetaHub(this);
        this.imp = new ImportFront(this);
        this.central = new CentralFront(this);
        this.repack = new Repack(this);
        this.terminal = new Terminal(this);
        this.mods = new ModsManager(this.store, http.shared, webcache.shared);
        this.gmods = new GameMods(this.store);
        this.flash = new FlashManager(this.store, http.shared, webcache.shared);
        this.flash.onCover = (gid) => this.push({ type: 'flash_cover', id: gid });
        this.customUX = new CustomUX(this.store);
        this.customUX.pickFile = (initial, kind) => dialogs.pickFile(kind, initial);
        this.favorites = new Set(this.store.config.favorites || []);
        this.hiddenSet = new Set(this.store.config.hidden_games || []);
        this.loadCategories();
        this.sessions = new SessionManager(this.store);
        this.sessions.onStart = (sess) => this.onGameStart(sess);
        this.sessions.onEnd = (sess, elapsed) => this.onGameEnd(sess, elapsed);
        this.sessions.onBoost = (pid) => this.gamemode.boostPid(pid);
        if (process.platform !== 'win32')
            this.sessions.linuxWrap = (cmd, key) => this.linuxWrap(cmd, key);
        this.emu = new EmulationManager(this.store, http.shared, webcache.shared);
        this.saves = new SaveManager(this.store, this.emu);
        this.emu.ensureGameDirs();
        this.cat = new Catalog(this);
        this.categories = this.cat.categories;
        this.cat.onLoaded = () => this.afterCatalog();
        this.cat.onFirstPayload = () => { this.imp.autoScanDirs(); };
        this.sessions.startExternalWatch();
        this.store.setConfig({ pending_restart: [] });
        setTimeout(() => { try { this.flushPendingDelete(); } catch (e) { log.debug(`pending delete: ${e}`); } }, 50);
        if (!this.store.config.keep_archive)
            setTimeout(() => { try { require('./server2').frontFor(this).cleanDownloads(); } catch (e) { log.debug(`clean downloads: ${e}`); } }, 100);
        this.cat.reload(false);
        this.autoUpdateLoop();
    }
    loadCategories() {
        const file = P.ASSETS
            ? path.join(path.dirname(P.UI), 'presets', 'categories.json')
            : '';
        const direct = path.join(P.UI, '..', 'presets', 'categories.json');
        let data = null;
        for (const f of [path.join(P.ASSETS, 'presets', 'categories.json'), file, direct]) {
            const d = util.readJson(f, null);
            if (d && Array.isArray(d.categories)) {
                data = d;
                break;
            }
        }
        this.categories = (data?.categories || []).map((c) => ({
            id: c.id, name: c.name, icon: c.icon || '', match: c.match || '',
        }));
    }
    persistFav() {
        this.store.setConfig({ favorites: [...this.favorites].sort() });
    }
    persistHidden() {
        this.store.setConfig({ hidden_games: [...this.hiddenSet].sort() });
    }
    /* ----------------------------- catalogo ----------------------------- */
    cv(key) {
        return this.hub.cv(key, this.hub.meta.get(key));
    }
    categoryOf(title, genres) {
        const hay = `${title} ${(genres || []).join(' ')}`.toLowerCase();
        for (const c of this.categories) {
            if (!c.match)
                continue;
            try {
                if (new RegExp(c.match, 'i').test(hay))
                    return [c.id];
            }
            catch {
                /* regex invalida no preset: ignora */
            }
        }
        return ['other'];
    }
    localGames() {
        return this.cat.localGames();
    }
    async catalog() {
        return this.cat.payload();
    }
    reloadCatalog(force: boolean) {
        this.cat.reload(force);
    }
    afterCatalog() {
        try {
            this.central.minecraftAutoadd();
        }
        catch (e) {
            log.error('minecraft: %s', e);
        }
    }
    entry(key: string) {
        return this.cat.entry(key);
    }
    get entries() {
        return this.cat.entries;
    }
    get repos() {
        return this.cat.repos;
    }
    get catalogLoading() {
        return this.cat.state.loading;
    }
    get catalogErrors() {
        return this.cat.state.errors;
    }
    /** Estante/Inicio: secoes montadas a partir do catalogo. */
    async homePayload() {
        const cat = await this.catalog();
        const live = new Set(this.sessions.keys());
        const games = cat.games.filter((g) => g.installed && !g.hidden);
        const byKey = {};
        const sortedBy = (arr, f, n = 12) => [...arr].sort((a, b) => f(b) - f(a)).slice(0, n).map((g) => {
            byKey[g.key] = g;
            return g.key;
        });
        for (const g of games)
            byKey[g.key] = g;
        const sections = {
            playing: [...live].filter((k) => k in byKey),
            recent: sortedBy(games.filter((g) => g.last_played), (g) => g.last_played),
            added: sortedBy(games.filter((g) => g.added_at), (g) => g.added_at),
            favorites: games.filter((g) => g.fav).map((g) => g.key),
            most: sortedBy(games.filter((g) => (g.playtime || 0) >= 60), (g) => g.playtime || 0),
        };
        const total = games.reduce((s, g) => s + (g.playtime || 0), 0);
        const broken = cat.games.filter((g) => g.repo === 'local' && !g.installed).length;
        return {
            sections,
            games: byKey,
            stats: {
                count: games.length,
                playtime: total,
                playtime_h: util.humanTime(total),
                pc: games.filter((g) => ['pc', 'local', 'recomp'].includes(g.kind)).length,
                roms: games.filter((g) => g.kind === 'rom').length,
                missing: broken,
            },
        };
    }
    async gamePayload(key: string) {
        return this.cat.gamePayload(key);
    }
    editInfo(key: string) {
        return this.hub.editInfo(key);
    }
    /** Outros executaveis encontrados na pasta do jogo (para trocar o alvo). */
    exesOf(key) {
        const info = this.store.lib(key) || {};
        const dir = info.dir || (info.exe ? path.dirname(String(info.exe)) : '');
        if (!dir || !fs.existsSync(dir))
            return [];
        const out = [];
        const walk = (d, depth) => {
            if (depth > 3)
                return;
            let entries;
            try {
                entries = fs.readdirSync(d, { withFileTypes: true });
            }
            catch {
                return;
            }
            for (const e of entries) {
                const full = path.join(d, e.name);
                if (e.isDirectory()) {
                    if (!JUNK.test(e.name) && depth < 3)
                        walk(full, depth + 1);
                    continue;
                }
                if (EXE_EXT.includes(path.extname(e.name).toLowerCase()) && !JUNK.test(e.name))
                    out.push(full);
            }
        };
        walk(dir, 0);
        return out.slice(0, 200).sort();
    }
    /** Menu de contexto do botao direito. */
    contextActions(key) {
        const g = this.localGames().find((x) => x.key === key);
        const info = this.store.lib(key) || {};
        const live = this.sessions.keys().includes(key);
        const acts = [];
        if (g?.installed) {
            acts.push({ id: live ? 'stop' : 'play', label: live ? 'Parar' : 'Jogar', icon: live ? 'stop' : 'play' });
            acts.push({ id: 'open_folder', label: 'Abrir pasta', icon: 'folder' });
        }
        acts.push({ id: 'cover_set', label: 'Trocar capa', icon: 'image' });
        if (this.hub.covers.customPath(key))
            acts.push({ id: 'cover_reset', label: 'Remover capa', icon: 'trash' });
        acts.push({ id: 'edit', label: 'Editar', icon: 'edit' });
        acts.push({ sep: true });
        acts.push({ id: 'fav', label: g?.fav ? 'Tirar dos favoritos' : 'Favoritar', icon: 'star' });
        acts.push({ id: 'hide', label: g?.hidden ? 'Mostrar na biblioteca' : 'Esconder', icon: 'eye' });
        acts.push({ id: 'shortcut', label: 'Atalho na area de trabalho', icon: 'link' });
        if (String(info.exe || ''))
            acts.push({ id: 'set_exe', label: 'Trocar executavel', icon: 'exe' });
        acts.push({ sep: true });
        acts.push({ id: 'uninstall', label: 'Remover da biblioteca', icon: 'trash', danger: true });
        return acts;
    }
    activity: { text: string; since: number; busy: boolean } = { text: '', since: 0, busy: false };
    online_: boolean | null = null;
    act(text = '', busy: boolean | null = null) {
        this.activity = { text, since: text ? util.now() : 0, busy: busy !== null ? Boolean(busy) : Boolean(text) };
    }
    frontJobs(): Record<string, any> {
        return this.jobs.all();
    }
    retryTarget(name: string): ((...a: any[]) => any) | null {
        const front = require('./server2').frontFor(this);
        const map: Record<string, any> = {
            start_install: (...a: any[]) => front.install(...a),
            link_download: (...a: any[]) => front.linkDownload(...a),
            patch_download: (...a: any[]) => front.patchDownload(...a),
            emu_install: (...a: any[]) => front.installEmulator(...a),
            install_emulator: (...a: any[]) => front.installEmulator(...a),
            update_emulator: (...a: any[]) => front.updateEmulator(...a),
            install_tool: (...a: any[]) => this.installTool(a[0]),
        };
        const extra = this.retryExtra?.(name);
        return map[name] || extra || null;
    }
    retryExtra(_name: string): any {
        return null;
    }
    activityPayload(jobs: Record<string, any>) {
        let a: any = { ...this.activity };
        const n = Object.keys(jobs).length;
        if (a.busy && util.now() - a.since > 120 && !n && !this.catalogLoading)
            a = { text: '', since: 0, busy: false };
        if (n && !a.text) {
            const [k, j] = Object.entries(jobs)[0];
            a = { text: `${j.title || k}: ${j.detail || j.stage}`, since: util.now(), busy: true, fraction: j.fraction };
        }
        a.jobs = n;
        a.sessions = this.sessions.keys().length;
        return a;
    }
    statusPayload() {
        const jobs = this.frontJobs();
        return {
            jobs,
            events: this.events.splice(0),
            online: this.online_ ?? true,
            gamemode: this.gamemode.active,
            loading: this.catalogLoading,
            activity: this.activityPayload(jobs),
            meta_pending: this.hub.pending,
            sessions: this.sessions.status(),
        };
    }
    /**
     * Enfileira um evento para a UI (tema recarregado, capa nova,
     * atualizacao disponivel, download concluido...). O renderer drena
     * a fila em /api/status -- mesmo contrato do `_push` do Python.
     */
    push(ev: any) {
        this.events.push(ev);
        if (this.events.length > 100)
            this.events.shift();
    }
    notifications() {
        const out = [...(this.store.config.notifications || [])];
        const seen = new Set(this.store.config.notif_seen || []);
        const hidden = new Set(this.store.config.notif_hidden || []);
        for (const [k, info] of Object.entries(this.store.library) as [string, any][]) {
            if (info.repack_state === 'pending' && !hidden.has(k) && !out.some((x: any) => x.key === k && x.kind === 'repack'))
                out.push({ id: 'repack-' + k, kind: 'repack', title: `${info.title}: instalador pendente`, text: 'Repack baixado — abra o setup pelo launcher.', key: k, at: info.installed_at || 0, read: seen.has(k) });
        }
        out.sort((a: any, b: any) => Number(b.at || 0) - Number(a.at || 0));
        return out;
    }
    notifAck(nid: string | null | undefined, clear = false) {
        const lst = [...(this.store.config.notifications || [])].map((x: any) => ({ ...x }));
        const pend = Object.entries(this.store.library).filter(([, i]: any) => i.repack_state === 'pending').map(([k]) => k);
        let seen = [...(this.store.config.notif_seen || [])];
        let hidden = [...(this.store.config.notif_hidden || [])];
        let out = lst;
        if (clear) {
            out = [];
            hidden = [...new Set([...hidden, ...pend])].sort();
        }
        else {
            for (const x of out)
                if (nid == null || x.id === nid)
                    x.read = true;
            const keys = nid == null ? pend : pend.filter((k) => nid === 'repack-' + k);
            seen = [...new Set([...seen, ...keys])].sort();
        }
        this.store.setConfig({ notifications: out, notif_seen: seen, notif_hidden: hidden });
        return { ok: true };
    }
    notify(kind: string, title: string, text = '', key = '', action = '') {
        const n: any = { id: `${Date.now()}-${kind}`, kind, title, text, key, action, at: util.now(), read: false };
        const lst = (this.store.config.notifications || []).filter((x: any) => !(x.key && x.key === key && x.kind === kind));
        lst.push(n);
        const extra: any = {};
        if (key && kind === 'repack') {
            extra.notif_seen = (this.store.config.notif_seen || []).filter((k: string) => k !== key);
            extra.notif_hidden = (this.store.config.notif_hidden || []).filter((k: string) => k !== key);
        }
        this.store.setConfig({ notifications: lst.slice(-60), ...extra });
        this.push({ type: 'notify', ...n });
    }
    randomPick(filter = 'any', exclude = []) {
        let games = this.localGames().filter((g) => g.installed && !g.hidden);
        if (filter === 'unplayed')
            games = games.filter((g) => !g.playtime);
        else if (filter === 'fav')
            games = games.filter((g) => g.fav);
        else if (filter === 'pc')
            games = games.filter((g) => (g.system || 'pc') === 'pc');
        else if (filter === 'emu')
            games = games.filter((g) => (g.system || 'pc') !== 'pc');
        else if (filter === 'short') {
            games = games.filter((g) => g.system !== 'pc' ||
                ['arcade', 'corrida', 'esporte', 'luta', 'plataforma', 'puzzle']
                    .some((k) => (g.genres || []).join(' ').toLowerCase().includes(k)));
        }
        const ex = new Set(exclude);
        const pool = games.filter((g) => !ex.has(g.key));
        const use = pool.length ? pool : games;
        if (!use.length)
            return { error: 'Nenhum jogo instalado bate com esse filtro.' };
        // joga menos recentes pesam mais
        const weights = use.map((g) => 1 / (1 + (g.playtime || 0) / 3600));
        const total = weights.reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        let pick = use[0];
        for (let i = 0; i < use.length; i++) {
            r -= weights[i];
            if (r <= 0) {
                pick = use[i];
                break;
            }
        }
        return { game: pick };
    }
    /* ------------------------------ config ------------------------------ */
    RESTART_KEYS: Record<string, string> = { frameless: 'Janela sem moldura', acrylic: 'Vidro fosco', tray_enabled: 'Ícone na bandeja', torrent_enabled: 'Suporte a torrent' };
    safeMode = false;
    safeSaved: any = null;
    rolledBack: any = null;
    integrity: any = {};
    integrityReport(rep: any) {
        this.integrity = rep || {};
        if (!rep)
            return;
        if (rep.status === 'repaired')
            this.notify('ok', 'Arquivos do launcher reparados', `${(rep.fixed || []).length} arquivo(s) estavam alterados ou faltando e foram restaurados a partir do pacote da versão ${rep.version || ''}.`, 'integrity');
        else if (rep.status === 'damaged')
            this.notify('warn', 'Arquivos do launcher alterados', `${(rep.bad || []).length} arquivo(s) faltando ou diferente(s) do esperado. Ajustes › Sistema › Sobre › Verificar arquivos.`, 'integrity', 'integrity');
    }
    publicConfig() {
        const it = this.integrity || {};
        return this.store.publicConfig({
            native: true,
            version: VERSION,
            version_changelog: CHANGELOG,
            version_date: VERSION_DATE,
            frameless: this.store.publicConfig().frameless,
            integrity: { status: it.status || '', bad: (it.bad || []).length, fixed: (it.fixed || []).length, checked: it.checked || 0 },
            restart_labels: this.RESTART_KEYS,
            safe_mode: this.safeMode,
            safe_saved: Boolean(this.safeSaved),
            rolled_back: this.rolledBack,
        });
    }
    setConfig(patch) {
        patch = patch || {};
        const before = { ...this.store.config };
        this.store.setConfig(patch);
        const hot = Object.keys(this.RESTART_KEYS).filter((k) => k in patch && JSON.stringify(patch[k]) !== JSON.stringify(before[k]));
        if (hot.length) {
            const pend = [...(this.store.config.pending_restart || [])];
            for (const k of hot) {
                const i = pend.indexOf(k);
                if (i >= 0)
                    pend.splice(i, 1);
                else
                    pend.push(k);
            }
            this.store.setConfig({ pending_restart: pend });
        }
        if ('favorites' in patch)
            this.favorites = new Set(this.store.config.favorites || []);
        if ('hidden_games' in patch)
            this.hiddenSet = new Set(this.store.config.hidden_games || []);
        if ('autostart' in patch && patch.autostart !== before.autostart)
            log.info('iniciar com o sistema: %s', JSON.stringify(this.setAutostart(Boolean(this.store.config.autostart))));
        if (Object.keys(patch).some((k) => k.startsWith('torrent_'))) {
            try {
                require('./torrent').setQuiet(this.quiet);
            }
            catch { /* ignore */ }
        }
        if ('gamepad_wake' in patch && this.gamepad)
            (this.store.config.gamepad_wake ? this.gamepad.start() : this.gamepad.stop());
        if (patch.bg_warmup && !before.bg_warmup)
            void (this as any).warmUp?.();
        return this.publicConfig();
    }
    resetConfig(keys) {
        const list = (keys || []).filter((k: any) => typeof k === 'string' && k in DEFAULT_CONFIG && !['language', 'welcome_done'].includes(k));
        if (!list.length)
            return { error: 'Nada para redefinir.' };
        const patch: any = {};
        for (const k of list)
            patch[k] = JSON.parse(JSON.stringify(DEFAULT_CONFIG[k]));
        return this.setConfig(patch);
    }
    autostartCmd() {
        if (process.platform === 'win32' && P.FROZEN)
            return `"${path.join(P.ROOT, 'Ludrix.exe')}" --minimized`;
        if (process.env.APPIMAGE)
            return `"${process.env.APPIMAGE}" --minimized`;
        if (P.FROZEN)
            return `"${process.execPath}" --minimized`;
        return `"${process.execPath}" "${electron.app.getAppPath()}" --minimized`;
    }
    static RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    autostart() {
        let enabled = false, p = '';
        try {
            if (process.platform === 'win32') {
                const out = cp.execFileSync('reg', ['query', Backend.RUN_KEY, '/v', 'Ludrix'], { windowsHide: true, timeout: 8000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
                const m = /REG_\w+\s+(.*)$/m.exec(out);
                p = m ? m[1].trim() : '';
                enabled = Boolean(p);
            }
            else {
                p = path.join(os.homedir(), '.config', 'autostart', 'ludrix.desktop');
                enabled = fs.existsSync(p);
            }
        }
        catch { /* */ }
        return { supported: process.platform === 'win32' || process.platform === 'linux', enabled, path: p };
    }
    autostartSync() {
        if (!this.store.config.autostart)
            return;
        try {
            const st = this.autostart();
            if (st.supported && (!st.enabled || (process.platform === 'win32' && st.path !== this.autostartCmd())))
                this.setAutostart(true);
        }
        catch (e) {
            log.debug(`autostart sync: ${e}`);
        }
    }
    setAutostart(on: any) {
        const enable = Boolean(on);
        try {
            if (process.platform === 'win32') {
                if (enable)
                    cp.execFileSync('reg', ['add', Backend.RUN_KEY, '/v', 'Ludrix', '/t', 'REG_SZ', '/d', this.autostartCmd(), '/f'], { windowsHide: true, timeout: 8000, stdio: 'ignore' });
                else {
                    try { cp.execFileSync('reg', ['delete', Backend.RUN_KEY, '/v', 'Ludrix', '/f'], { windowsHide: true, timeout: 8000, stdio: 'ignore' }); } catch { /* */ }
                }
            }
            else if (process.platform === 'linux') {
                const p = path.join(os.homedir(), '.config', 'autostart', 'ludrix.desktop');
                if (enable) {
                    fs.mkdirSync(path.dirname(p), { recursive: true });
                    fs.writeFileSync(p, `[Desktop Entry]\nType=Application\nName=Ludrix\nExec=${this.autostartCmd()}\nX-GNOME-Autostart-enabled=true\n`, 'utf8');
                }
                else
                    fs.rmSync(p, { force: true });
            }
            else
                return { error: 'Só no Windows e Linux' };
        }
        catch (e: any) {
            return { error: `Não consegui configurar: ${e?.message || e}` };
        }
        this.store.setConfig({ autostart: enable });
        return { ok: true, ...this.autostart() };
    }
    /* ------------------------------- jogar ------------------------------- */
    async play(key: string, after: string | null = null, emulator: string | null = null, optimize: boolean | null = null, force = false): Promise<any> {
        if (this.sessions.has(key))
            return { error: 'Este jogo já está aberto', running: true, key };
        this.sessions.nextAfter = ['none', 'minimize', 'close'].includes(String(after)) ? String(after) : null;
        if (optimize === null || optimize === undefined)
            optimize = Boolean(this.store.config.game_mode_auto);
        this.sessions.nextOptimize = Boolean(optimize);
        if (key.startsWith('rom:')) {
            const r = this.emu.scanAll().find((x) => x.key === key);
            const kept = this.store.lib(key) || {};
            if (!r && !(kept.exe && kept.system && fs.existsSync(kept.exe)))
                return { error: 'ROM não encontrada', missing: 'rom', path: kept.exe || '', key };
            if (r) {
                if (!this.store.lib(key))
                    this.setInstalled(key, { dir: path.dirname(r.path), exe: r.path, title: r.title, kind: 'rom' });
                const em = this.pickEmulator(key, r.system, emulator);
                if (em && typeof em === 'object')
                    return em;
                const lr = await this.emu.launchRom(r.path, r.system, em as string | null, force);
                if (lr.error)
                    return lr;
                const res: any = await this.launch(key, [...lr.cmd, ...this.splitArgs(this.gameArgs(key))], lr.cwd, r.title);
                res.hint = lr.hint || '';
                return res;
            }
        }
        let info = this.store.lib(key);
        if (!info) {
            const lp = this.localPathOf(key);
            if (lp && fs.existsSync(lp)) {
                const e = this.entryOf(key) || {};
                this.setInstalled(key, { dir: path.dirname(lp), exe: lp, title: e.title || key, kind: e.kind || 'pc', system: e.system || '' });
                info = this.store.lib(key);
                if (this.store.config.auto_metadata)
                    this.queueMeta(key);
            }
            else
                return { error: 'Não instalado' };
        }
        if (info.kind === 'rom' && info.system) {
            if (info.exe && !fs.existsSync(info.exe))
                return { error: 'ROM não encontrada', missing: 'rom', path: info.exe, key, drive: this.driveMissing(info.exe) };
            const em = this.pickEmulator(key, info.system, emulator);
            if (em && typeof em === 'object')
                return em;
            const lr = await this.emu.launchRom(info.exe, info.system, em as string | null, force);
            if (lr.error)
                return lr;
            const res: any = await this.launch(key, [...lr.cmd, ...this.splitArgs(this.gameArgs(key))], lr.cwd, info.title || key);
            res.hint = lr.hint || '';
            return res;
        }
        const exeStr = String(info.exe || '');
        if (URI_RE.test(exeStr)) {
            try {
                await electron.shell.openExternal(exeStr);
            }
            catch (e: any) {
                return { error: `${uriName(exeStr)} não respondeu: ${e?.message || e}`, uri: exeStr };
            }
            this.store.patchLib(key, { last_played: util.now() });
            return { ok: true, tracked: false, hint: `Aberto pelo ${uriName(exeStr)} (o tempo de jogo não é contado).` };
        }
        if (info.mc) {
            if (info.mc === 'bedrock') {
                if (!bedrockInstalled())
                    return { error: 'O Minecraft Bedrock não está instalado neste PC.', mc_missing: 'bedrock', store: BEDROCK_STORE };
                await electron.shell.openExternal('shell:AppsFolder\\' + BEDROCK_AUMID);
                this.store.patchLib(key, { last_played: util.now() });
                return { ok: true, tracked: false, hint: 'Aberto pela Microsoft Store (o tempo de jogo não é contado).' };
            }
            const lid = String(info.mc_launcher || '');
            let spec: any = exeStr ? this.central.mc.launchSpec(exeStr) : { error: 'sem launcher' };
            if (spec.error || (spec.cmd && !(fs.existsSync(spec.cmd[spec.cmd.length - 1]) || spec.cmd[0] === 'flatpak'))) {
                const [it, fresh] = this.central.mced.javaLauncher(lid);
                if (!fresh)
                    return { error: 'Nenhum launcher de Minecraft encontrado. O Java Edition precisa de um launcher para abrir.', need_mc_launcher: true, recommend: this.central.mced.recommend(), winget: Boolean(wingetPath()), store: JAVA_STORE };
                if (fresh !== exeStr || (it && it.id !== lid))
                    this.store.patchLib(key, { exe: fresh, mc_launcher: it.id });
                spec = this.central.mc.launchSpec(fresh);
            }
            if (spec.error)
                return { error: spec.error };
            if (spec.shell) {
                if (process.platform === 'win32')
                    await electron.shell.openExternal(spec.shell);
                this.store.patchLib(key, { last_played: util.now() });
                return { ok: true, tracked: false, hint: 'Aberto pela Microsoft Store (o tempo de jogo não é contado).' };
            }
            return this.launch(key, [...spec.cmd, ...this.splitArgs(this.gameArgs(key))], spec.cwd, String(info.title || 'Minecraft'));
        }
        let exe = exeStr;
        if (!exe || !fs.existsSync(exe)) {
            const exes = info.dir ? this.findExecutables(String(info.dir), String(info.title || '')) : [];
            if (!exes.length) {
                const shown = exe || String(info.dir || '');
                return { error: 'Executável não encontrado', missing: 'exe', path: shown, key, drive: this.driveMissing(shown) };
            }
            exe = exes[0];
            this.store.patchLib(key, { exe });
        }
        const cmd = [exe, ...this.splitArgs(this.gameArgs(key))];
        const cwd = info.workdir && fs.existsSync(String(info.workdir)) && fs.statSync(String(info.workdir)).isDirectory() ? String(info.workdir) : path.dirname(exe);
        await this.runHook(info.pre_cmd, cwd, true);
        if (info.admin && process.platform === 'win32')
            return this.launchAdmin(key, exe, cmd.slice(1), cwd, String(info.title || path.parse(exe).name));
        return this.launch(key, cmd, cwd, String(info.title || path.parse(exe).name));
    }
    applyTitle(key: string, title: string, locked: boolean) {
        return this.hub.applyTitle(key, title, locked);
    }
    setInstalled(key: string, info: any) {
        const cur = this.store.lib(key) || {};
        const next = { ...cur, ...info };
        if (!next.installed_at)
            next.installed_at = util.now();
        this.store.setLib(key, next);
    }
    localPathOf(key: string): string | null {
        const e = this.cat.entry(key);
        return e ? (e.extra.local_path || null) : null;
    }
    entryOf(key: string): any {
        return this.cat.entry(key);
    }
    queueMeta(key: string, priority = 5) {
        this.hub.queueMeta(key, priority);
    }
    findExecutables(dir: string, title = ''): string[] {
        try {
            const { findMainExe } = require('./installer');
            const r = findMainExe(dir, title);
            if (Array.isArray(r))
                return r;
            return r ? [r] : [];
        }
        catch {
            return [];
        }
    }
    async launch(key: string, cmd: string[], cwd: string, title: string): Promise<any> {
        if (process.platform !== 'win32' && isWindowsCmd(cmd)) {
            const st: any = this.linuxStatus();
            if (st.error)
                return { error: st.error, linux_runner: true };
            if (!st.ready)
                return this.prepareLinux(key, cmd, cwd, title);
        }
        return this.sessions.launch(key, cmd, cwd, title);
    }
    linuxStatus(): any {
        return compat.status(this.store.config);
    }
    linuxPrepare(): any {
        const jk = 'linux:proton';
        if (this.jobs.has(jk))
            return { error: 'Já em andamento' };
        return this.jobs.run(jk, 'Proton (umu)', 'tool', async (cb, cancel) => {
            const r = await compat.prepare(this.store.config, (t, f) => cb({ stage: 'download', fraction: f, detail: t }), cancel);
            if (r.error)
                throw new Error(r.error);
            return { title: 'Proton' };
        });
    }
    linuxPrefixRemove(key: string | null = null): any {
        const game = key ? { ...(this.store.lib(key) || {}), key } : null;
        return compat.removePrefix(this.store.config, game);
    }
    linuxWrap(cmd: string[], key: string): { cmd: string[]; env?: any } {
        const game = key ? { ...(this.store.lib(key) || {}), key } : null;
        const [c, env] = compat.wrap(cmd, this.store.config, game);
        return { cmd: c, env: env || undefined };
    }
    prepareLinux(key: string, cmd: string[], cwd: string, title: string): any {
        const jk = 'linux:proton';
        if (this.jobs.has(jk))
            return { ok: true, tracked: false, preparing: true, hint: 'O Proton ainda está sendo baixado. O jogo abre sozinho quando terminar.' };
        const after = this.sessions.nextAfter;
        const optimize = this.sessions.nextOptimize;
        const game = { ...(this.store.lib(key) || {}), key };
        this.jobs.run(jk, 'Proton (umu) — primeira vez', 'tool', async (cb, cancel) => {
            const r = await compat.prepare(this.store.config, (t: string, f: number) => cb({ stage: 'download', fraction: f, detail: t }), cancel, game);
            if (r?.error)
                throw new Error(r.error);
            cb({ stage: 'install', fraction: 1, detail: 'Abrindo o jogo…' });
            this.sessions.nextAfter = after;
            this.sessions.nextOptimize = optimize;
            const res = this.sessions.launch(key, cmd, cwd, title);
            if (res.error)
                throw new Error(res.error);
            return { title };
        });
        return { ok: true, tracked: false, preparing: true, hint: 'Baixando o Proton e o runtime (só na primeira vez, ~1 GB). O jogo abre sozinho quando terminar; acompanhe na Fila.' };
    }
    async runHook(cmd: any, cwd: string, wait: boolean) {
        cmd = String(cmd || '').trim();
        if (!cmd)
            return;
        try {
            const child = cp.spawn(cmd, { shell: true, cwd, stdio: 'ignore', windowsHide: true, detached: !wait });
            child.on('error', (e) => {
                log.warn('comando do jogo falhou: %s', e);
                this.notify('warn', 'Comando antes/depois do jogo falhou', String(e?.message || e));
            });
            if (!wait) {
                child.unref();
                return;
            }
            await new Promise<void>((res) => {
                const t = setTimeout(res, 15_000);
                child.on('exit', () => { clearTimeout(t); res(); });
                child.on('error', () => { clearTimeout(t); res(); });
            });
        }
        catch (e: any) {
            log.warn('comando do jogo falhou: %s', e);
            this.notify('warn', 'Comando antes/depois do jogo falhou', String(e?.message || e));
        }
    }
    launchAdmin(key: string, exe: string, args: string[], cwd: string, title: string): Promise<any> {
        const q = (a: string) => "'" + a.replace(/'/g, "''") + "'";
        const argList = args.length ? ` -ArgumentList @(${args.map(q).join(',')})` : '';
        const ps = `$p = Start-Process -FilePath ${q(exe)} -WorkingDirectory ${q(cwd)}${argList} -Verb RunAs -PassThru; if ($p) { $p.Id } else { 0 }`;
        return new Promise((resolve) => {
            cp.execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 120_000 }, (err, stdout, stderr) => {
                const errTxt = String(stderr || err?.message || '');
                if (err || /canceled by the user|cancelada pelo usu/i.test(errTxt))
                    return resolve({ error: /canceled by the user|cancelada pelo usu|1223/i.test(errTxt) ? 'Permissão de administrador negada' : `Não foi possível abrir como administrador (${errTxt.trim().split('\n')[0] || 'erro'})` });
                const pid = Number(String(stdout || '').trim().split(/\s+/).pop() || 0);
                if (!pid) {
                    this.store.patchLib(key, { last_played: util.now() });
                    return resolve({ ok: true, tracked: false });
                }
                resolve(this.sessions.launchPid(key, pid, title));
            });
        });
    }
    pickEmulator(key: string, sid: string, emulator: string | null): string | null | any {
        if (emulator)
            return emulator;
        const remembered = (this.store.config.game_emulator || {})[key];
        const opts = this.emu.installedOptions(sid);
        const ids = new Set(opts.map((o) => o.id));
        if (remembered && ids.has(remembered))
            return remembered;
        if (opts.length > 1 && !this.store.config.emu_no_ask) {
            const dflt = this.emu.emulatorFor(sid);
            const miss = dflt && ids.has(dflt) ? '' : (this.emu.allEmulators()[dflt || '']?.title || dflt || '');
            return { choose_emulator: opts, system: sid, default: dflt, key, missing_default: miss };
        }
        return null;
    }
    setGameEmulator(key: string, emulator: string | null) {
        const ge = { ...(this.store.config.game_emulator || {}) };
        if (emulator)
            ge[key] = emulator;
        else
            delete ge[key];
        this.store.setConfig({ game_emulator: ge });
        return { ok: true };
    }
    gameArgs(key: string): string {
        return String((this.store.config.game_args || {})[key] || '');
    }
    splitArgs(a: string): string[] {
        if (!a.trim())
            return [];
        const out: string[] = [];
        const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(a)))
            out.push(process.platform === 'win32' && m[1] !== undefined ? `"${m[1]}"` : (m[1] ?? m[2] ?? m[3]));
        return out;
    }
    driveMissing(p: string): string {
        if (process.platform !== 'win32' || !/^[A-Za-z]:[\\/]/.test(p || ''))
            return '';
        const root = p.slice(0, 3);
        return fs.existsSync(root) ? '' : root.toUpperCase();
    }
    stopGame(key: string) {
        return this.sessions.terminate(key);
    }
    diagnoseCrash(key: string, info: any, rc: any): string {
        const exe = String(info.exe || '');
        if (info.mc) {
            const it = this.central.mc.item(String(info.mc_launcher || ''));
            return `O ${it ? it.title : 'launcher'} fechou logo ao abrir. Abra-o direto uma vez para ver o que ele pede (Java, conta, atualização); se não abrir, reinstale-o ou escolha outro launcher em Central › Minecraft.`;
        }
        if (info.kind === 'rom') {
            if (!fs.existsSync(exe))
                return `A ROM sumiu de ${path.dirname(exe)}. Apague o jogo da biblioteca e adicione de novo apontando o arquivo certo.`;
            try {
                if (fs.statSync(exe).size < 1024)
                    return 'A ROM tem menos de 1 KB — arquivo corrompido ou download incompleto. Apague e baixe de novo.';
            }
            catch { /* ignore */ }
            return 'O emulador fechou na hora. Causas comuns: ROM corrompida, BIOS/keys faltando ou emulador desatualizado. Teste abrir a ROM direto no emulador; se também falhar, apague o jogo e adicione de novo.';
        }
        if (!fs.existsSync(exe))
            return `O executável não existe mais (${exe}). A pasta foi movida ou apagada — remova o jogo e adicione de novo.`;
        try {
            if (fs.statSync(exe).size < 4096)
                return 'O executável tem menos de 4 KB: arquivo corrompido. Desinstale e baixe/instale de novo.';
        }
        catch { /* ignore */ }
        const code = rc !== null && rc !== undefined && rc !== 0 ? ` (código ${rc})` : '';
        if ([0xC0000135, 3221225781, -1073741515].includes(rc))
            return `Falta uma DLL${code}: instale os pacotes da aba Redists (Visual C++, DirectX) e tente de novo.`;
        if ([0xC0000005, 3221225477, -1073741819].includes(rc))
            return `Falha de acesso à memória${code}: arquivo do jogo corrompido ou incompatível. Verifique a instalação; se persistir, desinstale e instale de novo.`;
        if ([740, 0x2E4].includes(rc))
            return "O jogo exige permissão de administrador. Use 'Trocar executável' e marque 'Executar como administrador' no arquivo.";
        return `Fechou em poucos segundos${code}. Normalmente é instalação incompleta ou arquivo corrompido: verifique os Redists, ou desinstale e adicione o jogo de novo. Se ele só abre um launcher próprio, ignore este aviso.`;
    }
    onlineAt = 0;
    async online(force = false) {
        const now = util.now();
        if (!force && this.online_ !== null && now - this.onlineAt < 60)
            return this.online_;
        let ok = false;
        for (const host of ['archive.org', '1.1.1.1', '8.8.8.8']) {
            ok = await new Promise<boolean>((res) => {
                const sock = require('node:net').connect({ host, port: 443, timeout: 2500 });
                sock.once('connect', () => { sock.destroy(); res(true); });
                sock.once('timeout', () => { sock.destroy(); res(false); });
                sock.once('error', () => { sock.destroy(); res(false); });
            });
            if (ok)
                break;
        }
        this.online_ = ok;
        this.onlineAt = now;
        return ok;
    }
    updateTold = '';
    async autoCheckUpdates() {
        try {
            const front = require('./server2').frontFor(this);
            const up = front.updates;
            await up.check(true);
            const v = (up.available || up.remote || {}).version;
            if (v && v !== this.updateTold) {
                this.updateTold = v;
                this.push({ type: 'update_available', version: v });
            }
        }
        catch (e: any) {
            log.warn('update check: %s', e?.message || e);
        }
    }
    autoUpdateLoop() {
        let waits = [60, 300, 900];
        const tick = async () => {
            if (this.closing)
                return;
            let next = 6 * 3600;
            if (!this.store.config.update_auto_check)
                next = 600;
            else if (!(await this.online(true)))
                next = waits.length ? waits.shift()! : 1800;
            else {
                await this.autoCheckUpdates();
                waits = [60, 300, 900];
            }
            setTimeout(tick, next * 1000).unref?.();
        };
        setTimeout(tick, 20_000).unref?.();
    }
    alive(pid) {
        try {
            process.kill(pid, 0);
            return true;
        }
        catch {
            return false;
        }
    }
    static COMPAT_LAYERS: Record<string, string> = { '': '', win7: 'WIN7RTM', win8: 'WIN8RTM', winxp: 'WINXPSP3', dpi: 'HIGHDPIAWARE', nofs: 'DISABLEDXMAXIMIZEDWINDOWEDMODE' };
    compatLayer(key: string, layer: string) {
        if (process.platform !== 'win32')
            return { error: 'Modo de compatibilidade só existe no Windows' };
        const info = this.store.lib(key) || {};
        const exe = String(info.exe || '');
        const isFile = (q: string) => { try { return fs.statSync(q).isFile(); } catch { return false; } };
        if (!exe || exe.includes('://') || info.kind === 'rom' || !isFile(exe))
            return { error: 'Esse jogo não tem um executável próprio para aplicar o modo de compatibilidade' };
        if (!(layer in Backend.COMPAT_LAYERS))
            return { error: 'Modo desconhecido' };
        const sub = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers';
        const want = Backend.COMPAT_LAYERS[layer];
        const run = (args: string[]) => cp.execFileSync('reg', args, { windowsHide: true, timeout: 8000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        let cur = '';
        try {
            const out = run(['query', sub, '/v', exe]);
            const m = /REG_SZ\s+(.*)$/m.exec(out);
            cur = m ? m[1].trim() : '';
        }
        catch { cur = ''; }
        const all = new Set(Object.values(Backend.COMPAT_LAYERS).filter(Boolean));
        const flags = cur.replace(/~/g, ' ').split(/\s+/).filter(Boolean).filter((f) => !all.has(f) || f === want);
        if (want && !flags.includes(want))
            flags.push(want);
        if (flags.length)
            run(['add', sub, '/v', exe, '/t', 'REG_SZ', '/d', '~ ' + flags.join(' '), '/f']);
        else {
            try { run(['delete', sub, '/v', exe, '/f']); } catch { /* */ }
        }
        this.store.patchLib(key, { compat: layer });
        return { ok: true, layer };
    }
    titleOf(key: string) {
        const g = this.cat.slimCache.get(key);
        return g && g.d ? String(g.d.title || '') : '';
    }
    async relocateGame(key: string, newPath: string | null) {
        const info = this.store.lib(key);
        if (!info)
            return { error: 'Jogo não encontrado' };
        const isRom = info.kind === 'rom';
        if (!newPath) {
            if (isRom)
                newPath = await dialogs.pickFile('rom', info.exe ? path.dirname(String(info.exe)) : '');
            else
                newPath = await dialogs.pickFolder(info.dir ? path.dirname(String(info.dir)) : '');
            if (!newPath)
                return { cancel: true };
        }
        const nu = String(newPath).trim().replace(/^"+|"+$/g, '');
        const isFile = (q: string) => { try { return fs.statSync(q).isFile(); } catch { return false; } };
        const isDir = (q: string) => { try { return fs.statSync(q).isDirectory(); } catch { return false; } };
        if (isRom) {
            if (!isFile(nu))
                return { error: 'Arquivo não encontrado' };
            const old = String(info.exe || '');
            let sid = String(info.system || '');
            const lst = [...(this.store.config.rom_files || [])].map((x: any) => ({ ...x }));
            for (const x of lst)
                if (x.path === old) {
                    x.path = nu;
                    sid = sid || x.system || '';
                }
            if (old && sid && !lst.some((x: any) => x.path === nu))
                lst.push({ path: nu, system: sid });
            this.store.setConfig({ rom_files: lst });
            this.emu.invalidateScan();
            this.store.patchLib(key, { exe: nu, dir: path.dirname(nu), ...(sid ? { system: sid } : {}) });
            this.cat.slimCache.delete(key);
            return { ok: true, exe: nu };
        }
        if (!isDir(nu))
            return { error: 'Pasta não encontrada' };
        const oldDir = String(info.dir || '');
        const patch: Record<string, any> = { dir: nu };
        const exe = String(info.exe || '');
        const relOf = (p: string) => {
            const r = path.relative(oldDir, p);
            return r && !r.startsWith('..') && !path.isAbsolute(r) ? r : null;
        };
        if (exe) {
            let rel = path.isAbsolute(exe) ? (oldDir ? relOf(exe) : null) ?? path.basename(exe) : exe;
            let cand: string | null = path.join(nu, rel);
            if (!isFile(cand)) {
                const name = path.basename(rel);
                const hits: string[] = [];
                const walk = (d: string) => {
                    let ents: fs.Dirent[] = [];
                    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
                    for (const e of ents) {
                        const q = path.join(d, e.name);
                        if (e.name === name) hits.push(q);
                        if (e.isDirectory()) walk(q);
                    }
                };
                if (name) walk(nu);
                cand = hits.length ? hits[0] : null;
            }
            patch.exe = cand !== null ? (path.isAbsolute(exe) ? cand : path.relative(nu, cand)) : '';
        }
        const wd = String(info.workdir || '');
        if (wd) {
            const r = oldDir ? relOf(wd) : null;
            patch.workdir = r !== null ? path.join(nu, r) : '';
        }
        const sd = String(info.save_dir || '');
        if (sd && oldDir && sd.startsWith(oldDir)) {
            const r = relOf(sd);
            if (r !== null)
                patch.save_dir = path.join(nu, r);
        }
        this.store.patchLib(key, patch);
        this.cat.slimCache.delete(key);
        return { ok: true, dir: nu, exe: patch.exe ?? exe, need_exe: Boolean(exe) && !patch.exe };
    }
    moveGame(key: string, destParent: string) {
        const info = this.store.lib(key);
        if (!info)
            return { error: 'Jogo não encontrado' };
        if (info.kind === 'rom' || String(info.exe || '').includes('://'))
            return { error: 'Só jogos instalados em pasta podem ser movidos' };
        const src = String(info.dir || '');
        const isDir = (q: string) => { try { return fs.statSync(q).isDirectory(); } catch { return false; } };
        if (!src || !isDir(src))
            return { error: 'A pasta atual do jogo não existe' };
        const parent = String(destParent || '').trim().replace(/^"+|"+$/g, '');
        if (!parent || !isDir(parent))
            return { error: 'A pasta de destino não existe' };
        const dst = path.join(parent, path.basename(src));
        const real = (q: string) => { try { return fs.realpathSync(q); } catch { return path.resolve(q); } };
        if (fs.existsSync(dst) && real(dst) === real(src))
            return { error: 'O jogo já está nessa pasta' };
        if (fs.existsSync(dst))
            return { error: `Já existe uma pasta "${path.basename(src)}" no destino` };
        if (real(parent).startsWith(real(src) + path.sep))
            return { error: 'O destino fica dentro da própria pasta do jogo' };
        if (key in this.sessions.status())
            return { error: 'Feche o jogo antes de mover' };
        const title = info.title || this.titleOf(key) || key;
        const work = async (cb: (p: any) => void, cancel: any) => {
            const files: string[] = [];
            const walk = (d: string) => {
                for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                    const q = path.join(d, e.name);
                    if (e.isDirectory()) walk(q);
                    else if (e.isFile()) files.push(q);
                }
            };
            walk(src);
            const sizes = new Map(files.map((f) => [f, fs.statSync(f).size]));
            const total = [...sizes.values()].reduce((a, b) => a + b, 0) || 1;
            let done = 0;
            const free = freeBytes(parent);
            if (free >= 0 && free < total + 64 * 1024 * 1024)
                throw new Error(`Espaço insuficiente no destino (${util.humanSize(free)} livres, precisa de ${util.humanSize(total)})`);
            try {
                for (const f of files) {
                    cancel.check();
                    const rel = path.relative(src, f);
                    fs.mkdirSync(path.dirname(path.join(dst, rel)), { recursive: true });
                    await fs.promises.copyFile(f, path.join(dst, rel));
                    try { const st = fs.statSync(f); fs.utimesSync(path.join(dst, rel), st.atime, st.mtime); } catch { /* */ }
                    done += sizes.get(f) || 0;
                    cb(prog('move', done / total, `Movendo ${path.basename(rel)}`));
                }
            }
            catch (e) {
                fs.rmSync(dst, { recursive: true, force: true });
                throw e;
            }
            const patch: Record<string, any> = { dir: dst };
            const exe = String(info.exe || '');
            if (exe) {
                const r = path.relative(src, exe);
                if (r && !r.startsWith('..') && !path.isAbsolute(r))
                    patch.exe = path.join(dst, r);
            }
            const wd = String(info.workdir || '');
            if (wd) {
                const r = path.relative(src, wd);
                if (r !== null && !r.startsWith('..') && !path.isAbsolute(r))
                    patch.workdir = path.join(dst, r);
            }
            this.store.patchLib(key, patch);
            this.cat.slimCache.delete(key);
            fs.rmSync(src, { recursive: true, force: true });
            this.push({ type: 'moved', key, dir: dst });
            return { dir: dst };
        };
        return this.jobs.run(key, title, 'move', work);
    }
    markPlayed(key: string, played = true) {
        if (!this.store.lib(key))
            return { error: 'Jogo não encontrado' };
        this.store.patchLib(key, { last_played: played ? util.now() : 0 });
        this.act('');
        return { ok: true };
    }
    /* ------------------------- favoritos / ocultos ------------------------- */
    toggleFavorite(key) {
        if (this.favorites.has(key))
            this.favorites.delete(key);
        else
            this.favorites.add(key);
        this.persistFav();
        return { ok: true, fav: this.favorites.has(key) };
    }
    toggleHidden(key) {
        if (this.hiddenSet.has(key))
            this.hiddenSet.delete(key);
        else
            this.hiddenSet.add(key);
        this.persistHidden();
        return { ok: true, hidden: this.hiddenSet.has(key) };
    }
    /* ---------------------------- adicionar ---------------------------- */
    localGuess(fileOrDir) {
        const p = String(fileOrDir || '');
        if (!path.basename(p))
            return { guess: '' };
        const target = this.shortcutTarget(p);
        let guess = this.guessTitle(p);
        if (target && (guess.length < 3 || guess.toLowerCase() === path.basename(path.dirname(p)).toLowerCase()))
            guess = target.includes('://') ? guess : this.guessTitle(target);
        return { guess: guess || path.basename(p, path.extname(p)), target: target || '' };
    }
    shortcutTarget(p: string): string | null {
        const suf = path.extname(p).toLowerCase();
        if (suf === '.lnk') {
            try {
                return require('./importers').lnkTarget(p);
            }
            catch {
                return null;
            }
        }
        if (suf === '.url') {
            try {
                for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/))
                    if (line.toLowerCase().startsWith('url='))
                        return line.slice(4).trim();
            }
            catch { /* nada */ }
        }
        return null;
    }
    guessTitle(exe: string): string {
        let t = titleFromPath(exe);
        if (path.extname(exe).toLowerCase() === '.lnk' && (t.length < 3 || /^(play|jogar|start|launch|game|run)$/i.test(t))) {
            try {
                const target = require('./importers').lnkTarget(exe);
                if (target)
                    t = titleFromPath(target) || t;
            }
            catch { /* nada */ }
        }
        return t || path.basename(exe, path.extname(exe));
    }
    async addLocalGame(exePath, title, dirMatch = true) {
        if (!exePath) {
            exePath = await dialogs.pickFile('exe', '');
            if (!exePath)
                return { ok: false };
        }
        const exe = String(exePath);
        if (!fs.existsSync(exe))
            return { error: 'Arquivo não encontrado' };
        title = normalizeTitle(title || '') || this.localGuess(exe).guess;
        let key = 'local:' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const target = this.shortcutTarget(exe);
        let run = exe;
        let folder = path.dirname(exe);
        if (target && target.includes('://')) {
            run = target;
            folder = '';
        }
        else if (target && fs.existsSync(target)) {
            run = target;
            folder = path.dirname(target);
        }
        const norm = (v: any) => {
            const s = path.normalize(String(v || ''));
            return process.platform === 'win32' ? s.toLowerCase() : s;
        };
        for (const [k, v] of Object.entries<any>(this.store.library)) {
            if (v.kind === 'rom')
                continue;
            const vd = v.dir ? norm(v.dir) : '';
            const sameDir = Boolean(folder && vd) && norm(folder) === vd;
            const nested = Boolean(folder && vd) && (vd.startsWith(norm(folder) + path.sep) || norm(folder).startsWith(vd + path.sep));
            if (norm(v.exe) === norm(run) || (sameDir && dirMatch) || ((sameDir || nested) && normalizeTitle(v.title || '') === title))
                return { ok: true, key: k, title: v.title || title, existing: true };
        }
        if (this.store.lib(key))
            key += '-' + String(Math.trunc(Date.now() / 1000)).slice(-4);
        this.setInstalled(key, { dir: folder, exe: run, title, kind: 'local' });
        if (this.store.config.auto_metadata)
            this.queueMeta(key);
        return { ok: true, key, title };
    }
    /** Varre as pastas configuradas procurando executaveis de jogos. */
    scanDirs() {
        const dirs = [...(this.store.config.game_dirs || [])];
        if (this.store.config.games_dir)
            dirs.push(String(this.store.config.games_dir));
        if (!dirs.length)
            dirs.push(this.store.gamesDir());
        const ignored = new Set(this.store.config.scan_ignored || []);
        let added = 0;
        for (const d of dirs) {
            if (!fs.existsSync(d))
                continue;
            let entries;
            try {
                entries = fs.readdirSync(d, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const e of entries) {
                const full = path.join(d, e.name);
                if (e.isDirectory()) {
                    // uma pasta com executavel dentro conta como um jogo
                    const found = this.findMainExe(full);
                    if (found && !ignored.has(found)) {
                        this.addLocalGame(found, e.name);
                        added++;
                    }
                    continue;
                }
                if (EXE_EXT.includes(path.extname(e.name).toLowerCase()) && !JUNK.test(e.name) && !ignored.has(full)) {
                    this.addLocalGame(full, e.name.replace(/\.[^.]+$/, ''));
                    added++;
                }
            }
        }
        this.store.setConfig({ last_lib_check: util.now() });
        return { ok: true, added };
    }
    /** Procura o executavel principal dentro de uma pasta de jogo. */
    findMainExe(dir) {
        try {
            const files = fs.readdirSync(dir, { withFileTypes: true })
                .filter((f) => f.isFile() && EXE_EXT.includes(path.extname(f.name).toLowerCase()))
                .filter((f) => !JUNK.test(f.name))
                .map((f) => f.name);
            if (!files.length)
                return null;
            const cur = files.find((f) => this.localGuess(f).guess.toLowerCase() === path.basename(dir).toLowerCase());
            const picked = cur || files.sort((a, b) => fs.statSync(path.join(dir, b)).size - fs.statSync(path.join(dir, a)).size)[0];
            return path.join(dir, picked);
        }
        catch {
            return null;
        }
    }
    /* ------------------------------ editar ------------------------------ */
    renameGame(key: string, title: string) {
        return this.hub.renameGame(key, title);
    }
    editSave(key: string, data: any) {
        return this.hub.editSave(key, data);
    }
    editReset(key: string) {
        return this.hub.editReset(key);
    }
    editCopy(key: string, from: string) {
        return this.hub.editCopy(key, from);
    }
    async setExe(key: string, rel: string | null | undefined) {
        const info = this.store.lib(key);
        if (!info)
            return { error: 'Não instalado' };
        if (rel == null) {
            const chosen = await dialogs.pickFile('exe', String(info.dir || ''));
            if (!chosen)
                return { ok: false };
            this.store.patchLib(key, { exe: chosen });
        }
        else
            this.store.patchLib(key, { exe: path.join(String(info.dir || ''), String(rel)) });
        return { ok: true, exe: this.store.lib(key)?.exe };
    }
    /* ------------------------------ remover ------------------------------ */
    rmtreeForce(d: string) {
        for (let i = 0; i < 3; i++) {
            try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 }); } catch { /* */ }
            if (!fs.existsSync(d))
                return true;
            const t = Date.now();
            while (Date.now() - t < 700) { /* espera */ }
        }
        return !fs.existsSync(d);
    }
    async killProcsIn(d: string) {
        let root = '';
        try { root = fs.realpathSync(d); } catch { root = path.resolve(d); }
        root = root.toLowerCase().replace(/[\\/]+$/, '') + path.sep;
        try {
            const procsMod = await import('./procs');
            const hit: number[] = [];
            for (const p of await procsMod.list()) {
                if (p.pid && p.pid !== process.pid && p.exe && p.exe.toLowerCase().startsWith(root))
                    hit.push(p.pid);
            }
            if (hit.length)
                await procsMod.killTree(hit);
        }
        catch { /* */ }
    }
    flushPendingDelete() {
        const pend = [...(this.store.config.pending_delete || [])];
        if (!pend.length)
            return;
        const left = pend.filter((d: string) => fs.existsSync(d) && !this.rmtreeForce(d));
        if (JSON.stringify(left) !== JSON.stringify(pend))
            this.store.setConfig({ pending_delete: left });
    }
    async uninstall(key: string, _force = true) {
        if (this.sessions.has(key)) {
            try {
                this.sessions.terminate(key);
                await new Promise((r) => setTimeout(r, 1000));
            }
            catch { /* */ }
        }
        const info = this.store.removeLib(key);
        if (info && (key.startsWith('rom:') || key.startsWith('local:')))
            this.lastRemoved = { key, info: { ...info }, fav: this.favorites.has(key), args: (this.store.config.game_args || {})[key] || '', at: util.now() };
        const d = info ? info.dir : null;
        if (d && !key.startsWith('rom:') && !key.startsWith('local:')) {
            await this.killProcsIn(d);
            if (!this.rmtreeForce(d)) {
                const pend = [...(this.store.config.pending_delete || [])];
                if (!pend.includes(d)) {
                    pend.push(d);
                    this.store.setConfig({ pending_delete: pend });
                }
                this.notify('warn', 'Pasta em uso', `Alguns arquivos de ${path.basename(d)} ainda estão abertos por outro programa. O restante é apagado na próxima abertura do Ludrix.`);
            }
        }
        if (info && info.kind === 'rom' && info.exe) {
            this.emu.removeRomFile(info.exe);
            if (!key.startsWith('rom:')) {
                try {
                    const fp = fs.realpathSync(info.exe);
                    const eg = fs.realpathSync(P.EMU_GAMES);
                    if (fp.startsWith(eg + path.sep))
                        fs.rmSync(fp, { force: true });
                }
                catch { /* */ }
            }
            this.emu.invalidateScan();
        }
        this.act('');
        if (this.favorites.has(key)) {
            this.favorites.delete(key);
            this.persistFav();
        }
        return { ok: true };
    }
    undoRemove() {
        const lr = this.lastRemoved;
        if (!lr || util.now() - Number(lr.at || 0) > 600)
            return { error: 'Nada para desfazer' };
        const { key, info } = lr;
        if (this.store.lib(key))
            return { error: 'O jogo já está na biblioteca' };
        this.store.setLib(key, info);
        if (lr.fav) {
            this.favorites.add(key);
            this.persistFav();
        }
        if (lr.args) {
            const ga = { ...(this.store.config.game_args || {}) };
            ga[key] = lr.args;
            this.store.setConfig({ game_args: ga });
        }
        if (info.kind === 'rom' && info.exe && info.system) {
            try { this.emu.addRomFile(info.exe, info.system); } catch { /* */ }
        }
        this.lastRemoved = null;
        this.act('');
        return { ok: true, key, title: info.title || '' };
    }
    /* ------------------------------- capas ------------------------------- */
    coverPick(key: string, src: string | null = null) {
        return this.hub.setCover(key, src);
    }
    coverReset(key: string) {
        return this.hub.resetCover(key);
    }
    /* ----------------------------- metadados ----------------------------- */
    fetchMetadata(key: string, force = false) {
        return this.hub.fetchMetadata(key, force);
    }
    refetchAllMetadata() {
        return this.hub.refetchAllMetadata();
    }
    /* ------------------------------- temas ------------------------------- */
    themes() {
        return themes.themes();
    }
    faces() {
        return themes.faces();
    }
    themeCss(id: string, scheme: string) {
        return themes.themeCss(id, scheme, this.store.config);
    }
    themeJson(id: string) {
        return themes.themeJson(id);
    }
    themeWallpaper(id: string) {
        return themes.themeWallpaper(id);
    }
    themePreview(id: string) {
        return themes.themePreview(id);
    }
    themeFile(id: string, rel: string) {
        return themes.themeFile(id, rel);
    }
    themePalette() {
        return themes.themePalette(this.store.config);
    }
    themeSave(data: Record<string, any>) {
        return themes.themeSave(data || {});
    }
    themeReload(tid: string) {
        tid = String(tid || '');
        if (tid) {
            if (tid.startsWith('file:') && !fs.existsSync(path.join(themes.themeDir(tid.slice(5)), 'theme.json')))
                return { error: 'Tema não encontrado' };
            this.store.setConfig({ theme: tid });
        }
        this.push({ type: 'theme_reload', theme: tid });
        return { ok: true };
    }
    async themeImport(p: any) {
        let files = Array.isArray(p) ? p.map((x) => String(x).trim()) : String(p || '').split(/[\r\n;|]+/).map((x) => x.trim()).filter(Boolean);
        if (!files.length) {
            const picked = await dialogs.pickFiles('theme', path.join(os.homedir(), 'Downloads'));
            files = (picked || []).filter(Boolean);
            if (!files.length)
                return { ok: false };
        }
        return themes.themeImportMany(files);
    }
    themeDelete(id: string) {
        return themes.themeDelete(String(id || ''), this.store.config, (patch) => this.store.setConfig(patch));
    }
    themeExport(id: string, fmt = 'lxtheme') {
        return themes.themeExport(String(id || ''), fmt);
    }
    themeExportAll(fmt = 'zip') {
        return themes.themeExportAll(fmt);
    }
    custom() {
        return this.customUX.get();
    }
    customSet(patch) {
        return this.customUX.set(patch);
    }
    customReset() {
        return this.customUX.reset();
    }
    customCss() {
        return this.customUX.css();
    }
    customFile(name) {
        return this.customUX.file(name);
    }
    fonts() {
        return this.customUX.fonts();
    }
    /* ------------------------------- cache ------------------------------- */
    cacheInfo() {
        return {
            web: P.dirSize(P.CACHE_WEB),
            thumbs: P.dirSize(P.CACHE_THUMBS),
            covers: P.dirSize(P.CACHE_COVERS) + P.dirSize(P.CACHE_SHOTS),
            meta: P.dirSize(P.CACHE_META),
            downloads: P.dirSize(P.DOWNLOADS),
            log: fs.existsSync(P.LOG_FILE) ? fs.statSync(P.LOG_FILE).size : 0,
        };
    }
    clearCache(what: string[]) {
        what = what || [];
        const map: Record<string, string> = { web: P.CACHE_WEB, thumbs: P.CACHE_THUMBS, covers: P.CACHE_COVERS, meta: P.CACHE_META, downloads: P.DOWNLOADS };
        for (const w of [...what, ...(what.includes('covers') ? ['shots'] : [])]) {
            const d = map[w] || (w === 'shots' ? P.CACHE_SHOTS : null);
            if (d && fs.existsSync(d)) {
                const busy = new Set(w === 'downloads' ? [...this.jobs.jobs.values()].map((j: any) => safeFolderName(j.title)) : []);
                for (const child of fs.readdirSync(d)) {
                    if (busy.has(child))
                        continue;
                    try { fs.rmSync(path.join(d, child), { recursive: true, force: true }); } catch { /* */ }
                }
            }
            if (w === 'log' && fs.existsSync(P.LOG_FILE)) {
                try { fs.writeFileSync(P.LOG_FILE, ''); } catch { /* */ }
            }
        }
        if (what.includes('web') || what.includes('meta'))
            this.cat.reload(what.includes('web'));
        return this.cacheInfo();
    }
    /* ----------------------------- biblioteca ----------------------------- */
    libraryCheck() {
        const items: any[] = [];
        const ex = (q: string) => { try { fs.statSync(q); return true; } catch { return false; } };
        for (const [key, info] of Object.entries(this.store.library) as [string, any][]) {
            const exe = String(info.exe || '');
            const d = String(info.dir || '');
            const title = info.title || this.titleOf(key) || key;
            if (info.kind === 'rom') {
                if (exe && !ex(exe))
                    items.push({ key, title, kind: 'rom', path: exe, problem: 'A ROM não está mais em ' + path.dirname(exe) });
                continue;
            }
            if (exe.includes('://') || !d)
                continue;
            if (!ex(d))
                items.push({ key, title, kind: 'dir', path: d, problem: 'A pasta do jogo não existe mais' });
            else {
                const ep = exe ? (path.isAbsolute(exe) ? exe : path.join(d, exe)) : null;
                if (ep !== null && !ex(ep))
                    items.push({ key, title, kind: 'exe', path: ep, problem: 'A pasta existe, mas o executável sumiu' });
            }
            const wd = String(info.workdir || '');
            if (wd && !ex(wd))
                items.push({ key, title, kind: 'workdir', path: wd, problem: 'A pasta de trabalho configurada não existe mais' });
        }
        const emus: any[] = [];
        const used: Record<string, number> = {};
        for (const [key, info] of Object.entries(this.store.library) as [string, any][]) {
            if (info.kind === 'rom') {
                const parts = key.split(':');
                const sid = info.system || (parts.length >= 3 ? parts[1] : '');
                if (sid)
                    used[sid] = (used[sid] || 0) + 1;
            }
        }
        for (const sid of Object.keys(used).sort()) {
            const st: any = this.emu.systemStatus(sid);
            if (st && !st.installed)
                emus.push({ system: sid, name: st.name || sid, count: used[sid], emulator: st.emulator_title || st.emulator || '' });
        }
        this.store.setConfig({ last_lib_check: util.now() });
        return { total: Object.keys(this.store.library).length, items, emus, dupes: this.libraryDupes().length };
    }
    libraryDupes() {
        const lib = this.store.library as Record<string, any>;
        const byTitle = new Map<string, string[]>();
        const byExe = new Map<string, string[]>();
        const add = (m: Map<string, string[]>, k: string, v: string) => m.set(k, [...(m.get(k) || []), v]);
        for (const [k, i] of Object.entries(lib)) {
            const t = normalizeTitle(i.title || k);
            if (t)
                add(byTitle, t + '|' + String(i.system || (i.kind === 'rom' ? 'rom' : 'pc')).toLowerCase(), k);
            const e = String(i.exe || '').trim().toLowerCase().replace(/\\/g, '/');
            if (e)
                add(byExe, e, k);
            const d = String(i.dir || '').trim().toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
            if (d && i.kind !== 'rom')
                add(byExe, 'dir:' + d, k);
        }
        const seen = new Set<string>();
        const groups: any[] = [];
        for (const keys of [...byExe.values(), ...byTitle.values()]) {
            if (keys.length < 2)
                continue;
            const fresh = keys.filter((k) => !seen.has(k));
            if (fresh.length < 2)
                continue;
            fresh.forEach((k) => seen.add(k));
            const items = fresh.map((k) => {
                const i = lib[k];
                const exe = String(i.exe || '');
                return { key: k, title: i.title || k, exe, exists: Boolean(exe) && fs.existsSync(exe), playtime: i.playtime || 0, play_count: i.play_count || 0, source: i.store_src || i.source || '', kind: i.kind || 'local' };
            });
            items.sort((a, b) => (Number(b.exists) - Number(a.exists)) || (b.playtime - a.playtime) || (b.play_count - a.play_count));
            groups.push(items);
        }
        return groups;
    }
    /** Junta chaves duplicadas mantendo uma delas. */
    libraryMerge(keep: string, drop: string[]) {
        const lib = this.store.library as Record<string, any>;
        if (!(keep in lib))
            return { error: 'Entrada principal não encontrada' };
        drop = (drop || []).filter((k) => k in lib && k !== keep && (k.startsWith('local:') || k.startsWith('rom:')));
        if (!drop.length)
            return { error: 'Nada para juntar' };
        this.libraryBackup();
        const base = { ...lib[keep] };
        const patch: Record<string, any> = {};
        let pt = Number(base.playtime || 0);
        let pc = Math.trunc(Number(base.play_count || 0));
        let lp = Number(base.last_played || 0);
        let ia = Number(base.installed_at || 0);
        let notes = String(base.notes || '');
        for (const k of drop) {
            const i = lib[k];
            pt += Number(i.playtime || 0);
            pc += Math.trunc(Number(i.play_count || 0));
            lp = Math.max(lp, Number(i.last_played || 0));
            if (Number(i.installed_at || 0) && (!ia || Number(i.installed_at) < ia))
                ia = Number(i.installed_at);
            const n2 = String(i.notes || '').trim();
            if (n2 && !notes.includes(n2))
                notes = (notes + '\n' + n2).trim();
            for (const f of ['cover_url', 'store_src', 'steam_appid', 'workdir', 'args', 'store_id'])
                if (!base[f] && i[f])
                    patch[f] = i[f];
        }
        Object.assign(patch, { playtime: pt, play_count: pc, notes });
        if (lp) patch.last_played = lp;
        if (ia) patch.installed_at = ia;
        this.store.patchLib(keep, patch);
        if (drop.some((k) => this.favorites.has(k)) && !this.favorites.has(keep))
            this.favorites.add(keep);
        for (const k of drop) {
            this.store.removeLib(k);
            this.favorites.delete(k);
        }
        this.persistFav();
        this.emu.invalidateScan();
        this.act('');
        return { ok: true, kept: keep, removed: drop.length };
    }
    async exportMetadata(keys: string[] | null, fmt = 'ludrix') {
        const cat: any = await this.catalog();
        const sel = new Set(keys || []);
        const games = (cat.games || []).filter((g: any) => sel.size ? sel.has(g.key) : (g.installed || g.key.startsWith('local:') || g.key.startsWith('rom:')));
        if (!games.length)
            return { error: 'Nenhum jogo para exportar' };
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
        const out = path.join(P.DOWNLOADS, `ludrix-export-${stamp}`);
        const covers = path.join(out, 'covers');
        fs.mkdirSync(covers, { recursive: true });
        const rows: any[] = [];
        const heroic: any[] = [];
        for (const g of games) {
            const key = g.key;
            const m = this.hub.meta.get(key) || {};
            const info = this.store.lib(key) || {};
            let coverFile = '';
            let srcCover = this.hub.covers.customPath(key);
            if (!srcCover) {
                const cand = path.join(P.CACHE_COVERS, `${images.safe('c:' + key)}.webp`);
                if (fs.existsSync(cand))
                    srcCover = cand;
            }
            if (srcCover && fs.existsSync(srcCover)) {
                coverFile = safeFolderName(g.title).slice(0, 80) + path.extname(srcCover);
                try { fs.copyFileSync(srcCover, path.join(covers, coverFile)); } catch { coverFile = ''; }
            }
            const row = { key, title: g.title, kind: g.kind, system: g.system || 'pc',
                developer: m.developer || '', publisher: m.publisher || '', year: String(m.year || g.year || ''),
                genres: [...(m.genres || g.genres || [])], summary: m.summary || '', series: m.series || '',
                playtime_seconds: Math.trunc(Number(g.playtime || 0)), last_played: Math.trunc(Number(g.last_played || 0)), favorite: Boolean(g.fav),
                exe: info.exe || '', dir: info.dir || '', args: this.gameArgs(key), cover: coverFile ? 'covers/' + coverFile : '',
                cover_url: m.cover_url || '', hero_url: m.hero_url || '', links: [...(m.links || [])],
                steam_appid: m.steam_appid || '', wiki_url: m.wiki_url || '',
                play_count: Math.trunc(Number(info.play_count || 0)), source: info.source || '', store: info.store_src || '', notes: m.notes || '', status: m.status || '', score: Math.trunc(Number(m.score || 0)),
                workdir: info.workdir || '' };
            rows.push(row);
            if (info.exe && !String(info.exe).includes('://')) {
                const art = coverFile ? path.resolve(covers, coverFile) : '';
                const fileUrl = art ? 'file:///' + art.replace(/\\/g, '/') : '';
                heroic.push({ app_name: g.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || key, title: g.title,
                    runner: 'sideload', is_installed: true, canRunOffline: true, launchFullScreen: false, browserUrl: '',
                    art_cover: fileUrl, art_square: fileUrl, folder_name: info.dir || '',
                    install: { executable: info.exe || '', platform: 'Windows', is_dlc: false }, description: m.summary || '' });
            }
        }
        fs.writeFileSync(path.join(out, 'ludrix-library.json'), JSON.stringify({ format: 'ludrix-export', version: 1, exported_at: util.now(), games: rows }, null, 2), 'utf8');
        const csvCell = (v: any) => {
            const s = String(v ?? '');
            return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        const lines = [['Name', 'Platform', 'Developer', 'Publisher', 'ReleaseYear', 'Genres', 'Description', 'InstallDirectory', 'Path', 'Arguments', 'Playtime (min)', 'Favorite', 'Cover', 'PlayCount', 'LastActivity', 'Source', 'Notes', 'CompletionStatus', 'UserScore']];
        for (const r of rows) {
            const lp = r.last_played ? new Date(r.last_played * 1000) : null;
            lines.push([r.title, r.system === 'pc' ? 'PC' : r.system, r.developer, r.publisher, r.year, r.genres.join(', '),
                r.summary.replace(/\n/g, ' '), r.dir, r.exe, r.args, String(Math.floor(r.playtime_seconds / 60)), r.favorite ? '1' : '0', r.cover,
                String(r.play_count), lp ? `${lp.getFullYear()}-${pad(lp.getMonth() + 1)}-${pad(lp.getDate())}` : '', r.store || r.source, r.notes.replace(/\n/g, ' '), r.status, r.score ? String(r.score) : '']);
        }
        fs.writeFileSync(path.join(out, 'ludrix-library.csv'), '\uFEFF' + lines.map((l) => l.map(csvCell).join(';')).join('\r\n') + '\r\n', 'utf8');
        if (heroic.length) {
            const hd = path.join(out, 'heroic', 'sideload_apps');
            fs.mkdirSync(hd, { recursive: true });
            fs.writeFileSync(path.join(hd, 'library.json'), JSON.stringify({ games: heroic }, null, 2), 'utf8');
        }
        let pn: any = {};
        try {
            const names: Record<string, string> = {};
            for (const [k, v] of Object.entries(this.emu.presets.systems || {}) as [string, any][])
                names[k] = (v || {}).name || k;
            pn = exporters.buildPlaynite(out, rows, covers, String(VERSION || '1.0'), path.join(P.UI, 'icon.png'), names);
        }
        catch (e: any) {
            log.warn('export playnite: %s', e?.message || e);
        }
        fs.writeFileSync(path.join(out, 'LEIA-ME.txt'),
            'Exportação do LudrixHub\n\n' +
            'playnite/LudrixImport.pext — importa tudo no Playnite 10: dois cliques no .pext, depois menu Extensões > Ludrix > Importar. Veja playnite/COMO-IMPORTAR.txt.\n' +
            'ludrix-library.json  — tudo (nomes, metadados, caminhos, tempo jogado, capas em covers/). Formato aberto, legível.\n' +
            'ludrix-library.csv   — planilha (separador ;). Abre no Excel/LibreOffice.\n' +
            "heroic/sideload_apps/library.json — jogos com executável no formato de 'sideload' do Heroic Games Launcher: copie por cima\n" +
            '                       do arquivo homônimo na pasta de configuração do Heroic (com ele fechado) ou mescle a lista \'games\'.\n' +
            'covers/              — capas dos jogos (quando havia).\n', 'utf8');
        void fmt;
        return { ok: true, dir: out, count: rows.length, heroic: heroic.length, playnite: Boolean(pn && pn.pext) };
    }
    backupLibrary() {
        try {
            this.store.flush();
            const src = P.LIBRARY_FILE;
            if (!fs.existsSync(src) || fs.statSync(src).size < 3)
                return;
            const bdir = P.BACKUPS;
            fs.mkdirSync(bdir, { recursive: true });
            const d = new Date();
            const pad = (n: number) => String(n).padStart(2, '0');
            const dst = path.join(bdir, `library-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`);
            if (!fs.existsSync(dst))
                fs.copyFileSync(src, dst);
            const names = fs.readdirSync(bdir);
            const olds = names.filter((n) => /^library-\d{8}\.json$/.test(n)).sort();
            for (const f of olds.slice(0, Math.max(0, olds.length - 7)))
                fs.rmSync(path.join(bdir, f), { force: true });
            const manual = names.filter((n) => /^library-\d{8}-\d{6}\.json$/.test(n)).sort();
            for (const f of manual.slice(0, Math.max(0, manual.length - 10)))
                fs.rmSync(path.join(bdir, f), { force: true });
        }
        catch (e) {
            log.debug('backup library: %s', e);
        }
    }
    libraryBackup() {
        try {
            this.store.flush();
            const src = P.LIBRARY_FILE;
            if (!fs.existsSync(src))
                return { error: 'Biblioteca vazia' };
            fs.mkdirSync(P.BACKUPS, { recursive: true });
            const d = new Date();
            const pad = (n: number) => String(n).padStart(2, '0');
            const name = `library-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
            fs.copyFileSync(src, path.join(P.BACKUPS, name));
            return { ok: true, file: name, games: Object.keys(this.store.library).length };
        }
        catch (e: any) {
            return { error: String(e?.message || e) };
        }
    }
    libraryBackups() {
        const out: any[] = [];
        let names: string[] = [];
        try {
            names = fs.readdirSync(P.BACKUPS).filter((n) => /^library-.*\.json$/.test(n)).sort().reverse();
        }
        catch {
            names = [];
        }
        for (const f of names) {
            const p = path.join(P.BACKUPS, f);
            let n = -1;
            try {
                n = Object.keys(JSON.parse(fs.readFileSync(p, 'utf8'))).length;
            }
            catch {
                n = -1;
            }
            out.push({ file: f, path: p, games: n, mtime: fs.statSync(p).mtimeMs / 1000 });
        }
        return out;
    }
    libraryRestore(name: string) {
        const f = path.join(P.BACKUPS, path.basename(String(name || '')));
        if (!fs.existsSync(f))
            return { error: 'Backup não encontrado' };
        let data: any;
        try {
            data = JSON.parse(fs.readFileSync(f, 'utf8'));
        }
        catch (e: any) {
            return { error: `Backup ilegível: ${e?.message || e}` };
        }
        if (!data || typeof data !== 'object' || Array.isArray(data))
            return { error: 'Backup inválido' };
        if (Object.keys(this.store.library).length)
            this.libraryBackup();
        const cur = { ...this.store.library };
        let added = 0, fixed = 0;
        for (const [k, v] of Object.entries<any>(data)) {
            if (!v || typeof v !== 'object' || Array.isArray(v))
                continue;
            if (!(k in cur)) {
                this.setInstalled(k, v);
                added += 1;
                continue;
            }
            const patch: any = {};
            for (const fld of ['playtime', 'play_count']) {
                const nv = Number(v[fld] || 0), ov = Number(cur[k][fld] || 0);
                if (!Number.isNaN(nv) && !Number.isNaN(ov) && nv > ov)
                    patch[fld] = v[fld];
            }
            if (Object.keys(patch).length) {
                this.setInstalled(k, patch);
                fixed += 1;
            }
        }
        this.emu.invalidateScan();
        this.act('');
        return { ok: true, added, fixed, total: Object.keys(data).length };
    }
    /* -------------------------- backup completo -------------------------- */
    /** Empacota tudo (config, biblioteca, metadados, capas, temas) em um zip. */
    async dataExport() {
        const dest = await dialogs.pickFolder(P.ROOT);
        if (!dest)
            return { cancel: true };
        this.store.flush();
        return backup.exportData(String(dest), VERSION);
    }
    async dataInspect(file: string | null) {
        let p = file;
        if (!p) {
            p = await dialogs.pickFile('backup', P.ROOT);
            if (!p)
                return { cancel: true };
        }
        const r = backup.inspect(String(p));
        r.path = p;
        return r;
    }
    dataImport(file: string) {
        const r = backup.importData(String(file || ''), VERSION);
        if (r.ok)
            this.store.freeze();
        return r;
    }
    async modInstall(key: string, file: string | null, title = '', target = '', kind = '') {
        const info = this.store.lib(key);
        if (!info)
            return { error: 'Jogo não instalado' };
        let p = file;
        if (!p) {
            const dl = path.join(os.homedir(), 'Downloads');
            p = kind === 'dir' ? await dialogs.pickFolder(dl) : await dialogs.pickFile('archive', dl);
            if (!p)
                return { ok: false };
        }
        try {
            this.gmods.check(key, String(p), target);
        }
        catch (e: any) {
            return { error: String(e?.message || e) };
        }
        const jkey = `mod:${key}`;
        if (this.jobs.has(jkey))
            return { error: 'Já estou instalando um mod nesse jogo' };
        const src = String(p);
        return this.jobs.run(jkey, `${info.title || key} — mod`, 'tool', (cb, cancel) => this.gmods.install(key, src, title, target, cb, cancel));
    }
    installTool(tid: string) {
        const t = this.mods.presets.tools.find((x: any) => x.id === tid);
        if (!t)
            return { error: 'Ferramenta desconhecida' };
        return this.jobs.run(`tool:${tid}`, t.title, 'tool', async (cb, cancel) => ({ dir: await this.mods.install(tid, cb, cancel) }), { m: 'install_tool', a: [tid] });
    }
    async flashAdd(file: string | null, title = '', kind = '') {
        let p = file;
        if (!p) {
            p = kind === 'dir' ? await dialogs.pickFolder('') : await dialogs.pickFile('quick', '');
            if (!p)
                return { ok: false };
        }
        return this.flash.addCustom(String(p), title);
    }
    flashPlayWeb(gid: string) {
        const g = this.flash.presets.games.find((x: any) => x.id === gid);
        if (!g || !String(g.url || '').startsWith('http'))
            return { error: 'Esse jogo não tem endereço de site' };
        this.flash.markPlay(gid);
        const pop = this.windowHooks?.popup;
        if (pop) {
            try {
                pop({ title: g.title, url: g.url, w: Number(g.w || 1280), h: Number(g.h || 760) });
                return { ok: true, window: true };
            }
            catch (e) {
                log.warn('popup: %s', e);
            }
        }
        this.openUrl(g.url);
        return { ok: true, browser: true };
    }
    async flashCover(gid: string, file: string | null) {
        let p = file;
        if (!p) {
            p = await dialogs.pickFile('image', path.join(os.homedir(), 'Pictures'));
            if (!p)
                return { ok: false };
        }
        return this.flash.setCover(gid, String(p));
    }
    flashInstall(gid: string | null) {
        if (gid === 'ruffle')
            return this.jobs.run('flash:ruffle', 'Ruffle (player Flash)', 'flash', async (cb, cancel) => ({ ruffle: true, path: await this.flash.installRuffle(cb, cancel) }));
        if (gid === 'all')
            return this.jobs.run('flash:all', 'Jogos Rápidos', 'flash', (cb, cancel) => this.flash.installAllMissing(cb, cancel));
        const g = this.flash.presets.games.find((x: any) => x.id === gid);
        if (!g)
            return { error: 'Jogo desconhecido' };
        return this.jobs.run('flash:' + gid, g.title, 'flash', async (cb, cancel) => {
            if (!this.flash.ruffleReady())
                await this.flash.installRuffle(cb, cancel);
            await this.flash.installGame(String(gid), cb, cancel);
            return { flash: true, gid };
        });
    }
    CONSOLE_THEMES: Record<string, any> = {
        noite: { name: 'Noite', desc: 'Preto profundo, cinza-azulado do Ludrix', bg: '#0c0d10', bg2: '#15161b', card: '#1d1e24', text: '#f2f2f4', muted: '#8f929c', accent: '#5c6b82' },
        gelo: { name: 'Gelo', desc: 'Azul-noite e ciano', bg: '#071018', bg2: '#0d1a26', card: '#12283a', text: '#e9f4fb', muted: '#7f9ab0', accent: '#35c6f0' },
        brasa: { name: 'Brasa', desc: 'Vinho escuro e âmbar', bg: '#130a0b', bg2: '#1e0f12', card: '#2a161a', text: '#fbeeea', muted: '#a98a86', accent: '#ffa63d' },
        mata: { name: 'Mata', desc: 'Verde-musgo e lima', bg: '#090f0a', bg2: '#0f1a11', card: '#152418', text: '#eef6ec', muted: '#8aa08c', accent: '#a6e05a' },
        neve: { name: 'Neve', desc: 'Claro, cinza-gelo e azul', bg: '#eef0f3', bg2: '#ffffff', card: '#f7f8fa', text: '#1b1d24', muted: '#6a7080', accent: '#2f6df6', light: true },
    };
    async consolePayload() {
        const cat: any = await this.catalog();
        const games: any[] = (cat.games || []).filter((g: any) => g.installed);
        games.sort((a, b) => String(a.title || '').toLowerCase().localeCompare(String(b.title || '').toLowerCase()));
        const recent = games.filter((g) => g.last_played).sort((a, b) => b.last_played - a.last_played).slice(0, 14).map((g) => g.key);
        const c = this.store.config;
        const get = (k: string, d: any) => (c[k] === undefined ? d : c[k]);
        return {
            games, recent, favorites: games.filter((g) => g.fav).map((g) => g.key),
            systems: cat.systems, sessions: this.sessions.status(), gamepad: gamepadMod.connectedNow(),
            theme: get('console_theme', 'noite'), themes: this.CONSOLE_THEMES, language: get('language', 'pt-BR'),
            config: {
                console_gamepad_speed: get('gamepad_speed', 'normal'),
                console_sound: get('console_sound', true), game_mode_auto: Boolean(c.game_mode_auto), after_launch: get('after_launch', 'ask'),
                console_hint: get('console_hint', true), console_card_size: get('console_card_size', 'normal'),
                console_clock24: get('console_clock24', true), console_start_view: get('console_start_view', 'library'),
                console_vibrate: get('console_vibrate', true), console_dim_idle: Number(c.console_dim_idle || 0),
                console_confirm_quit: get('console_confirm_quit', true), console_sort: get('console_sort', 'title'), fav_first: Boolean(c.fav_first), console_dl_pill: get('console_dl_pill', true),
                save_auto_backup: Boolean(c.save_auto_backup), launch_splash: get('launch_splash', 'short'),
            },
            playing: this.sessions.keys().length > 0, version: VERSION, count: games.length,
        };
    }
    consoleCommand(mode: string): string[] {
        const appPath = electron.app.getAppPath();
        const skip = new Set(['--console', '--ludrix-after-update']);
        const args = process.argv.slice(1).filter((a) => !skip.has(a) && !(a === '.' || path.resolve(a) === appPath));
        const head = electron.app.isPackaged ? [process.execPath] : [process.execPath, appPath];
        return [...head, ...args, ...(mode === 'console' ? ['--console'] : [])];
    }
    consoleSwap(to: string, _force = false) {
        if (to !== 'window' && to !== 'console')
            return { error: 'modo desconhecido' };
        const cmd = this.consoleCommand(to);
        try {
            const child = cp.spawn(cmd[0], cmd.slice(1), { cwd: P.ROOT, detached: true, stdio: 'ignore', windowsHide: false, env: { ...process.env, LUDRIX_SWAP_FROM: String(process.pid) } });
            child.unref();
        }
        catch (e: any) {
            return { error: `Não foi possível abrir: ${e?.message || e}` };
        }
        setTimeout(() => this.windowHooks?.quit?.(), 1200);
        return { ok: true };
    }
    BACKUP_DIRS = ['data', 'themes'];
    BACKUP_EXTRA = ['data/cache/covers', 'data/cache/meta'];
    BACKUP_SKIP = ['data/cache/', 'data/tools/', 'data/bin/', 'data/updates/', 'data/pfx/'];
    backupExport(dest: string | null = null) {
        const st = backup.stamp('compact');
        let out: string;
        if (dest) {
            const d = String(dest);
            out = d.toLowerCase().endsWith('.zip') ? d : path.join(d, `ludrix-backup-${st}.zip`);
        }
        else
            out = path.join(P.UPDATES, 'backup', `ludrix-backup-${st}.zip`);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        let n = 0;
        const zip = new AdmZip();
        const walk = (d: string, fn: (f: string) => void) => {
            let ents: fs.Dirent[] = [];
            try {
                ents = fs.readdirSync(d, { withFileTypes: true });
            }
            catch {
                return;
            }
            for (const e of ents) {
                const f = path.join(d, e.name);
                if (e.isDirectory())
                    walk(f, fn);
                else if (e.isFile())
                    fn(f);
            }
        };
        for (const rel of [...this.BACKUP_DIRS, ...this.BACKUP_EXTRA]) {
            const base = path.join(P.ROOT, rel);
            if (!fs.existsSync(base))
                continue;
            walk(base, (f) => {
                const relp = path.relative(P.ROOT, f).split(path.sep).join('/');
                const ext = path.extname(f);
                if (ext === '.tmp' || ext === '.log' || relp.split('/').includes('webview'))
                    return;
                if (rel === 'data' && this.BACKUP_SKIP.some((s) => relp.startsWith(s)))
                    return;
                zip.addFile(relp, fs.readFileSync(f));
                n += 1;
            });
        }
        zip.addFile('ludrix-backup.json', Buffer.from(JSON.stringify({ version: VERSION, at: util.now(), files: n }), 'utf8'));
        zip.writeZip(out);
        return { ok: true, path: out, size: fs.statSync(out).size, files: n };
    }
    async backupImport(file: string | null = null) {
        let p = file;
        if (!p) {
            p = await dialogs.pickFile('archive', path.join(P.UPDATES, 'backup'));
            if (!p)
                return { cancel: true };
        }
        let zip: AdmZip;
        try {
            if (!fs.existsSync(String(p)))
                throw new Error('x');
            zip = new AdmZip(String(p));
        }
        catch {
            return { error: 'Isso não é um .zip válido' };
        }
        const entries = zip.getEntries();
        const names = entries.map((e) => e.entryName);
        if (!names.includes('ludrix-backup.json') && !names.some((x) => x.startsWith('data/')))
            return { error: 'Esse .zip não parece um backup do Ludrix (não tem data/ nem ludrix-backup.json)' };
        const okRoots = [...this.BACKUP_DIRS, ...this.BACKUP_EXTRA, 'cache/covers', 'cache/meta'];
        const root = path.resolve(P.ROOT);
        let n = 0;
        for (const e of entries) {
            const name = e.entryName;
            if (name.endsWith('/') || name === 'ludrix-backup.json' || !okRoots.some((r) => name.startsWith(r)) || name.includes('..'))
                continue;
            const destName = name.startsWith('cache/') ? 'data/' + name : name;
            const target = path.resolve(P.ROOT, destName);
            if (!target.startsWith(root + path.sep))
                continue;
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, e.getData());
            n += 1;
        }
        this.store.setConfig({ pending_restart: [] });
        setTimeout(() => this.restartApp(), 1200);
        return { ok: true, files: n, restart: true };
    }
    restartApp() {
        this.store.flush();
        try {
            electron.app.relaunch();
        }
        catch (e: any) {
            return { error: String(e?.message || e) };
        }
        setTimeout(() => this.windowHooks?.quit?.(), 600);
        return { ok: true };
    }
    safeDelTarget(p: string): boolean {
        let r: string, root: string;
        try {
            r = fs.realpathSync(p);
            root = fs.realpathSync(P.ROOT);
        }
        catch {
            return false;
        }
        const home = os.homedir();
        const inside = (child: string, parent: string) => child.startsWith(parent + path.sep);
        if (r === root || inside(root, r) || r === home || r === path.dirname(home) || path.dirname(r) === r)
            return false;
        if (inside(r, root))
            return true;
        const parts = r.split(path.sep).filter(Boolean);
        if (parts.length < 3 || r === home)
            return false;
        return !['usr', 'etc', 'bin', 'lib', 'tmp', 'var', 'opt', 'Windows', 'Program Files', 'Program Files (x86)', 'Users'].includes(parts[process.platform === 'win32' ? 1 : 0]);
    }
    factoryReset() {
        let targets = [P.DATA, P.CACHE, P.DOWNLOADS, P.GAMES, P.EMU, P.THEMES, P.UPDATES, P.TOOLS, P.BIN, P.FLASH, P.REDISTS];
        const gd = this.store.gamesDir();
        if (gd && gd !== P.GAMES)
            targets.push(gd);
        targets = targets.filter((t) => this.safeDelTarget(t));
        const exe = process.execPath;
        const args = process.argv.slice(1).filter((a) => a !== '--ludrix-after-update');
        try {
            for (const j of Array.from(this.jobs.jobs.keys())) {
                try {
                    this.jobs.cancel(j);
                }
                catch { /* ignore */ }
            }
            let child: cp.ChildProcess;
            if (process.platform === 'win32') {
                const q = (a: string) => "'" + a.replace(/'/g, "''") + "'";
                const script = `$pid0=${process.pid}; for($i=0;$i -lt 200;$i++){ if(-not (Get-Process -Id $pid0 -ErrorAction SilentlyContinue)){break}; Start-Sleep -Milliseconds 100 }; Start-Sleep -Milliseconds 500; foreach($t in @(${targets.map(q).join(',')})){ if($t -and (Test-Path -LiteralPath $t)){ for($k=0;$k -lt 5;$k++){ Remove-Item -LiteralPath $t -Recurse -Force -ErrorAction SilentlyContinue; if(-not (Test-Path -LiteralPath $t)){break}; Start-Sleep -Milliseconds 500 } } }; Start-Process -FilePath ${q(exe)}${args.length ? ` -ArgumentList @(${args.map(q).join(',')})` : ''} -WorkingDirectory ${q(P.ROOT)}`;
                child = cp.spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', script], { cwd: P.ROOT, detached: true, stdio: 'ignore', windowsHide: true });
            }
            else {
                const q = (a: string) => "'" + a.replace(/'/g, "'\\''") + "'";
                const script = `i=0; while kill -0 ${process.pid} 2>/dev/null && [ $i -lt 200 ]; do sleep 0.1; i=$((i+1)); done; sleep 0.5; for t in ${targets.map(q).join(' ')}; do k=0; while [ -d "$t" ] && [ $k -lt 5 ]; do rm -rf "$t"; sleep 0.5; k=$((k+1)); done; done; cd ${q(P.ROOT)}; exec ${q(exe)} ${args.map(q).join(' ')}`;
                child = cp.spawn('/bin/sh', ['-c', script], { cwd: P.ROOT, detached: true, stdio: 'ignore' });
            }
            child.unref();
        }
        catch (e: any) {
            return { error: String(e?.message || e) };
        }
        setTimeout(() => this.windowHooks?.quit?.(), 800);
        setTimeout(() => process.exit(0), 6000);
        return { ok: true, quit: true };
    }
    /* --------------------------- sistema/arquivos --------------------------- */
    /**
     * Pastas que o Ludrix tem permissao de abrir no explorador.
     * Especelho de `_path_allowed` (ludrix.py:2364). Sem isso o /api/open
     * abria qualquer caminho do PC — inclusive /etc e /root.
     */
    pathRoots() {
        const out = [P.ROOT, this.store.gamesDir() || P.GAMES];
        const home = electron.app.getPath('home');
        for (const d of ['Downloads', 'Pictures'])
            out.push(path.join(home, d));
        const cfg = this.store.config || {};
        for (const v of Object.values(cfg.rom_dirs || {})) {
            if (Array.isArray(v))
                out.push(...v.filter(Boolean).map(String));
            else if (v)
                out.push(String(v));
        }
        for (const info of Object.values(this.store.library)) {
            const ex = String(info.exe || '');
            const d = String(info.dir || (ex && !ex.includes('://') ? path.dirname(ex) : ''));
            if (d)
                out.push(d);
            if (info.workdir)
                out.push(String(info.workdir));
        }
        for (const v of Object.values(cfg.emu_paths || {}))
            if (typeof v === 'string' && v)
                out.push(path.dirname(v));
        for (const v of Object.values(cfg.custom_emulators || {}))
            if (v && typeof v === 'object' && v.exe)
                out.push(path.dirname(String(v.exe)));
        return out.filter(Boolean);
    }
    /** Um caminho so pode ser aberto se cair dentro de `pathRoots()`. */
    pathAllowed(target) {
        let r;
        try {
            r = fs.realpathSync(String(target || ''));
        }
        catch {
            return false;
        }
        for (const raw of this.pathRoots()) {
            let b;
            try {
                b = fs.realpathSync(raw);
            }
            catch {
                continue;
            }
            if (r === b || r.startsWith(b.endsWith(path.sep) ? b : b + path.sep))
                return true;
        }
        return false;
    }
    static OPEN_DOC_EXTS = new Set(['.txt', '.log', '.json', '.md', '.csv', '.ini', '.cfg', '.yaml', '.yml', '.png', '.jpg', '.jpeg', '.webp']);
    openPath(target: any, key = '') {
        const cands: any[] = [target];
        const info = key ? this.store.lib(key) : null;
        if (info) {
            const ex = String(info.exe || '');
            cands.push(info.dir, info.workdir, ex && !ex.includes('://') ? path.dirname(ex) : '');
        }
        let found = '';
        for (let c of cands) {
            c = expandVars(String(c || '').trim().replace(/^"+|"+$/g, '').trim());
            if (!c || c.includes('://'))
                continue;
            try {
                if (fs.existsSync(c)) {
                    found = c;
                    break;
                }
            }
            catch { continue; }
        }
        if (!found) {
            log.warn('abrir pasta: nenhum caminho existe %s', JSON.stringify(cands.filter(Boolean)));
            return { error: `Pasta não encontrada: ${target || (info || {}).dir || '?'}` };
        }
        let p = found;
        if (!this.pathAllowed(p))
            return { error: 'Essa pasta não é do Ludrix' };
        try {
            if (fs.statSync(p).isFile() && !Backend.OPEN_DOC_EXTS.has(path.extname(p).toLowerCase()))
                p = path.dirname(p);
        }
        catch { /* */ }
        if (process.platform === 'win32') {
            electron.shell.openPath(p).then((err) => {
                if (err) {
                    log.warn('startfile %s: %s', p, err);
                    cp.spawn('explorer.exe', [p], { detached: true, stdio: 'ignore' }).unref();
                }
            });
        }
        else if (process.platform === 'darwin')
            cp.spawn('open', [p], { detached: true, stdio: 'ignore' }).unref();
        else if (!compat.xdgOpen(p))
            void electron.shell.openPath(p);
        return { ok: true };
    }
    openSelect(key: string) {
        const info = this.store.lib(key) || {};
        const exe = String(info.exe || '');
        if (process.platform === 'win32' && exe && !exe.includes('://') && fs.existsSync(exe)) {
            cp.spawn('explorer', ['/select,', exe], { detached: true, stdio: 'ignore' }).unref();
            return { ok: true };
        }
        return this.openPath(info.dir || (exe && !exe.includes('://') ? path.dirname(exe) : ''));
    }
    openUrl(url) {
        const u = String(url || '').trim();
        if (!/^https?:\/\//i.test(u))
            return { error: 'Endereco invalido' };
        electron.shell.openExternal(u);
        return { ok: true };
    }
    /**
     * Seletor nativo de executavel / ROM / lista JSON.
     * Espelha `pick_exe` do Python (ludrix.py:3223).
     *
     * `native` e o sinal que a UI usa para decidir entre abrir o seletor ou
     * cair num campo de texto ("Modo navegador"). No Electron o dialogo
     * nativo sempre existe. `file` e a chave que `addLocal()` le -- sem ela
     * a funcao aborta em silencio, e era esse o sintoma de "nao le EXE".
     */
    async pickExe(initial = '', kind = 'exe') {
        const f = await dialogs.pickFile(kind, initial);
        const out: any = { native: true, file: f || null };
        if (f && kind === 'exe')
            Object.assign(out, this.localGuess(f));
        return out;
    }
    /**
     * Seletor de pasta (kind='folder') ou de arquivo.
     * Espelha `pick_path` do Python (ludrix.py:2281), que abria o seletor de
     * PASTA quando kind era 'folder'. A versao anterior chamava pickFile()
     * ate para pastas -- era isso que fazia o Ludrix "nao ler pasta".
     */
    async pickPath(kind = 'exe', initial = '') {
        const f = kind === 'folder'
            ? await dialogs.pickFolder(initial || P.ROOT)
            : await dialogs.pickFile(kind, initial);
        if (!f)
            return { native: true, cancel: true, path: '' };
        return { native: true, ok: true, path: f, file: f };
    }
    async chooseFolder(what = 'games', system = '', initial = '') {
        const f = await dialogs.pickFolder(initial || P.ROOT);
        if (!f)
            return { native: true, cancel: true };
        if (what === 'games')
            this.store.setConfig({ games_dir: f });
        if (what === 'scan') {
            const dirs = [...(this.store.config.game_dirs || [])];
            if (!dirs.includes(f))
                dirs.push(f);
            this.store.setConfig({ game_dirs: dirs });
        }
        if (what === 'roms' && system) {
            const romDirs = { ...(this.store.config.rom_dirs || {}) };
            romDirs[system] = [...new Set([...(romDirs[system] || []), f])];
            this.store.setConfig({ rom_dirs: romDirs });
        }
        return { native: true, ok: true, path: f, folder: f, what };
    }
    async folderSize(key: string) {
        const info = this.store.lib(key) || {};
        const d = String(info.dir || (info.exe && !String(info.exe).includes('://') ? path.dirname(String(info.exe)) : ''));
        let isDir = false;
        try { isDir = Boolean(d) && fs.statSync(d).isDirectory(); } catch { isDir = false; }
        if (!isDir)
            return { error: 'Pasta não encontrada' };
        const { walkFilesAsync } = require('./scanner');
        const items: Array<{ size: number }> = await walkFilesAsync([d], 24, []);
        let total = 0;
        for (const it of items)
            total += Number(it.size || 0);
        this.store.patchLib(key, { size: total });
        return { size: total, files: items.length, partial: false };
    }
    /* ---------------------------- Modo Game ---------------------------- */
    async gameModeRun() {
        return this.gamemode.optimize();
    }
    gameModeStatus() {
        return this.gamemode.snapshot();
    }
    async gameModeRestore() {
        const r = await this.gamemode.restore();
        if (this.quiet && !this.sessions.keys().length)
            this.setQuiet(false);
        return r;
    }
    setQuiet(on: boolean) {
        if (on === this.quiet)
            return;
        this.quiet = on;
        try {
            require('./torrent').setQuiet?.(on);
        }
        catch { /* ignore */ }        if (!on)
            this.hub.resumeQueue();
    }
    async onGameStart(sess: any) {
        if (sess.external) {
            this.push({ type: 'session_external', key: sess.key, title: sess.title });
            return;
        }
        if (sess.optimize) {
            try {
                const done: any = await this.gamemode.optimize();
                this.gamemode.boostPid(sess.pid);
                if (this.store.config.game_mode_quiet !== false) {
                    this.setQuiet(true);
                    done.quiet = true;
                }
                this.push({ type: 'gamemode', on: true, title: sess.title, ...done });
            }
            catch (e) {
                log.warn('gamemode: %s', e);
            }
        }
        const mode = sess.after || this.store.config.after_launch || 'ask';
        if (mode === 'ask')
            return;
        if (mode === 'close') {
            this.push({ type: 'closing', title: sess.title });
            setTimeout(() => this.windowHooks?.quit?.(), 1500);
        }
        else if (mode === 'minimize' && this.store.config.tray_enabled !== false)
            setTimeout(() => this.windowHooks?.hide?.(), 1000);
    }
    async onGameEnd(sess: any, elapsed: number) {
        if (!sess.external) {
            const info0 = this.store.lib(sess.key) || {};
            if (info0.post_cmd) {
                const exe0 = String(info0.exe || '');
                const cwd0 = info0.workdir && fs.existsSync(String(info0.workdir)) ? String(info0.workdir) : (exe0 && path.isAbsolute(exe0) ? path.dirname(exe0) : P.ROOT);
                void this.runHook(info0.post_cmd, cwd0, false);
            }
        }
        this.push({ type: 'session_end', key: sess.key, title: sess.title, elapsed, elapsed_h: humanSession(elapsed), crashed: Boolean(sess.crashed), rc: sess.rc ?? null });
        if (!sess.crashed && elapsed > 60 && (this.store.lib(sess.key) || {}).crash_count)
            this.store.patchLib(sess.key, { crash_count: 0 });
        if (sess.crashed) {
            const info = this.store.lib(sess.key) || {};
            const n = Number(info.crash_count || 0) + 1;
            this.store.patchLib(sess.key, { crash_count: n, last_crash: util.now(), last_rc: sess.rc ?? null });
            const why = this.diagnoseCrash(sess.key, info, sess.rc);
            this.notify('error', `${sess.title} fechou sozinho`, why, sess.key);
        }
        if (sess.optimize && this.gamemode.active) {
            try {
                const r: any = await this.gamemode.restore();
                this.push({ type: 'gamemode', on: false, title: sess.title, ...r });
            }
            catch (e) {
                log.warn('gamemode restore: %s', e);
            }
        }
        if (this.quiet && !this.sessions.keys().length)
            this.setQuiet(false);
        if (this.store.config.save_auto_backup !== false && elapsed > 45 && !sess.crashed)
            void this.autoSaveBackup(sess.key);
        if ((sess.after ?? this.store.config.after_launch) !== 'close' && !sess.external)
            this.windowHooks?.show?.();
    }
    async autoSaveBackup(key: string) {
        try {
            const g = await this.gamePayload(key);
            if (!g)
                return;
            const out = this.saves.autoBackup(key, g);
            if (out)
                log.info('save backup %s -> %s', key, out);
        }
        catch (e: any) {
            log.warn('save backup %s: %s', key, e?.message || e);
        }
    }
    async savesInfo(key: string, deep = false) {
        const g = await this.gamePayload(key);
        if (!g)
            return { error: 'Jogo não encontrado' };
        const loc = this.saves.locate(key, g, deep);
        loc.key = key;
        loc.title = g.title || '';
        loc.backups = this.saves.listBackups(key);
        loc.native = true;
        return loc;
    }
    async savesImport(key: string, source: string | null, dest: string | null) {
        const g = await this.gamePayload(key);
        if (!g)
            return { error: 'Jogo não encontrado' };
        let d = dest;
        if (!d)
            d = this.saves.locate(key, g).dir;
        if (!d)
            return { error: "Ainda não sei onde esse jogo salva — use 'Escolher pasta manualmente' primeiro." };
        let src = source;
        if (!src) {
            src = await dialogs.pickFile('save', path.join(os.homedir(), 'Downloads'));
            if (!src)
                return { ok: false };
        }
        return this.saves.importSave(key, String(src), String(d));
    }
    async savesImportFolder(key: string, dest: string | null) {
        const src = await dialogs.pickFolder(path.join(os.homedir(), 'Downloads'));
        if (!src)
            return { ok: false };
        return this.savesImport(key, String(src), dest);
    }
    async savesSetDir(key: string, folder: string | null) {
        let f = folder;
        if (!f) {
            f = await dialogs.pickFolder('');
            if (!f)
                return { ok: false };
        }
        return this.saves.setManual(key, String(f));
    }
    async savesExport(key: string, saveDir: string) {
        const g = (await this.gamePayload(key)) || {};
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const name = `${safeFolderName(String(g.title || key))}_save_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
        const dest = path.join(os.homedir(), 'Downloads', name);
        const r = this.saves.exportSave(key, saveDir, dest);
        if (r.ok)
            this.openPath(path.dirname(dest));
        return r;
    }
    hardware(force = false) {
        return sys.hardware(force);
    }
    /* ---------------------------- bootstrap ---------------------------- */
    bootstrapStatus() {
        return { ...this.boot };
    }
    bootstrapRun() {
        if (this.boot.started)
            return;
        this.boot.started = true;
        const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
        const steps: Array<[string, () => Promise<void> | void]> = [['Preparando as pastas', async () => { P.ensureDirs(); await sleep(300); }]];
        if (process.platform === 'win32') {
            steps.push(['Baixando o descompactador (7-Zip)', async () => {
                const { ensure7z } = require('./installer');
                if (!(await ensure7z(http.shared)))
                    throw new Error('não consegui baixar o 7-Zip; tento de novo quando precisar');
            }]);
            steps.push(['Conferindo Visual C++ e DirectX', () => {
                try {
                    this.central.redistsStatus();
                }
                catch { /* ignore */ }
            }]);
        }
        steps.push(['Lendo a biblioteca', async () => {
            for (let i = 0; i < 60; i++) {
                if (!this.cat.state.loading)
                    break;
                await sleep(250);
            }
        }]);
        this.boot.n = steps.length;
        this.boot.i = 0;
        void (async () => {
            for (let i = 0; i < steps.length; i++) {
                const [label, fn] = steps[i];
                this.boot.i = i;
                this.boot.step = label;
                try {
                    await fn();
                }
                catch (ex: any) {
                    log.warn('bootstrap %s: %s', label, ex);
                    this.boot.errors.push(`${label}: ${String(ex?.message || ex).slice(0, 120)}`);
                }
            }
            this.boot.i = steps.length;
            this.boot.step = 'Pronto';
            this.boot.done = true;
            if (!this.store.config.bootstrap_done)
                this.store.setConfig({ bootstrap_done: true });
        })();
    }
    safeRestore() {
        const ok = diagMod.restoreSettings(this.store);
        this.safeSaved = null;
        return { ok, config: this.publicConfig() };
    }
    /** Preparacao final: garante flush antes de sair. */
    closing = false;
    shutdown() {
        this.closing = true;
        this.gamepad?.stop();
        this.store.flush();
    }
}
const VINFO = require('./updates').currentVersion();
const VERSION = String(VINFO.version || '0.0.0');
const VERSION_DATE = String(VINFO.date || '');
const CHANGELOG = String(VINFO.changelog || '');

export { Backend, VERSION, VERSION_DATE, CHANGELOG };
