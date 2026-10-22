/**
 * store.ts — espelha app/core/store.py: DEFAULT_CONFIG, coercao de tipos,
 * leitura/escrita de data/config.json e data/library.json.
 *
 * As chaves e os valores-padrao sao os mesmos do original, entao um data/
 * gerado pelo Ludrix em Python abre aqui sem migracao.
 */
import fs from 'node:fs';
import * as P from './paths';
import * as util from './util';
const RUNTIME: { frameless: boolean | null; acrylic: boolean } = { frameless: null, acrylic: false };
function setRuntimeFrameless(v: boolean) { RUNTIME.frameless = Boolean(v); }
function setRuntimeAcrylic(v: boolean) { RUNTIME.acrylic = Boolean(v); }
/** Os padroes de fabrica, na mesma ordem do dicionario Python. */
const DEFAULT_CONFIG = {
    native: true,
    theme: 'dark',
    theme_mode: '',
    face: 'padrao',
    lights: ['#9ec5ff', '#b48cff', '#7c4dff'],
    accent: '',
    games_dir: '',
    shortcut_ask: true,
    home_autoplay: true,
    bootstrap_done: false,
    pending_delete: [],
    keep_archive: false,
    dl_speed: 0,
    auto_metadata: true,
    web_covers: true,
    bg_warmup: false,
    bg_sites: false,
    auto_rename: true,
    title_overrides: {},
    sgdb_key: '',
    meta_sources: {},
    torrent_enabled: true,
    torrent_max_down: 0,
    torrent_max_up: 100,
    torrent_seed_after: false,
    concurrent_downloads: 2,
    disabled_repos: [],
    known_repos: null,
    after_launch: 'ask',
    dim_not_installed: true,
    home_spot: true,
    tray_enabled: true,
    close_action: 'ask',
    autostart: false,
    rom_dirs: {},
    rom_dest: {},
    custom_emulators: {},
    emu_paths: {},
    system_emulator: {},
    system_emulators: {},
    rom_files: [],
    hidden_games: [],
    favorites: [],
    store_hide_installed: true,
    card_size: 136,
    view_mode: 'mural',
    list_cols: ['year', 'genre', 'size', 'playtime', 'last', 'status'],
    game_backdrop: '',
    backdrop_blur: 10,
    backdrop_dim: 42,
    accent_from_cover: false,
    theme_schedule: false,
    theme_light_from: '07:00',
    theme_light_to: '19:00',
    text_size: 0,
    card_ribbons: true,
    nav_hidden: [],
    nav_order: [],
    group_by: 'letter',
    sort_by: 'az',
    launch_splash: 'short',
    detail_art: 'auto',
    look: 0,
    card_hover: 'lift',
    reduce_motion: false,
    acrylic: true,
    parallax: true,
    high_contrast: false,
    home_rows: [],
    home_spot_style: 'auto',
    clock: 'off',
    settings_adv: false,
    filter_panel: false,
    filter_presets: [],
    card_playtime: true,
    warn_missing: true,
    game_dirs: [],
    auto_scan_dirs: true,
    scan_ignore_rest: false,
    linux_runner: 'auto',
    linux_proton: '',
    linux_env: '',
    linux_runtime_updates: true,
    track_external: true,
    scan_ignored: [],
    last_lib_check: 0,
    last_import: '',
    import_hidden: false,
    seen_version: '',
    fav_first: false,
    frame_mode: 'theme',
    frame_corners: '',
    nav_hide_playing: false,
    cover_slideshow: false,
    cover_slideshow_secs: 45,
    flash_stats: {},
    store_page_size: 25,
    nav: 'bottom',
    layout: 'side',
    game_args: {},
    repos_default_off: true,
    repos_initialized: false,
    game_mode_auto: false,
    game_mode_ask: true,
    welcome_done: false,
    console_theme: 'noite',
    console_sound: true,
    console_hint: true,
    console_card_size: 'normal',
    console_clock24: true,
    console_start_view: 'library',
    console_vibrate: true,
    console_dim_idle: 0,
    console_confirm_quit: true,
    console_sort: 'title',
    console_dl_pill: true,
    guides: true,
    guides_done: [],
    start_done: [],
    start_hide: false,
    game_mode_plan: 'high',
    game_mode_quiet: true,
    game_mode_power: true,
    game_mode_priority: true,
    game_mode_reopen: true,
    game_mode_close: [],
    emu_no_ask: false,
    ui_scale: 0,
    density: 'normal',
    glass: true,
    hero_enabled: true,
    toolbar: true,
    toolbar_items: ['search', 'cats', 'sort', 'bell'],
    language: 'pt-BR',
    popups: true,
    notify_sound: true,
    repack_auto_open: false,
    notifications: [],
    notif_seen: [],
    notif_hidden: [],
    animations: 'light',
    fx_type: 'controls',
    fx_intensity: 10,
    rail_icons: 'solid',
    status_position: 'bottom',
    ctx_menu: '',
    gamepad_enabled: true,
    gamepad_wake: false,
    mods_dir: '',
    update_feed: '',
    update_auto_check: true,
    pending_restart: [],
    gamepad_speed: 'normal',
    game_emulator: {},
    terminal_enabled: false,
    terminal_settings: {},
    custom: {},
    minecraft_auto: true,
    save_auto_backup: true,
    frameless: true,
}
function coerce(key, value, def) {
    if (def === null || def === undefined)
        return value;
    if (value === null || value === undefined)
        return def;
    if (typeof def === 'boolean') {
        if (typeof value === 'boolean')
            return value;
        if (typeof value === 'number')
            return Boolean(value);
        if (typeof value === 'string') {
            const v = value.trim().toLowerCase();
            if (['true', 'false', '1', '0', 'sim', 'nao', 'não', 'yes', 'no', 'on', 'off'].includes(v)) {
                return ['true', '1', 'sim', 'yes', 'on'].includes(v);
            }
        }
        return def;
    }
    if (typeof def === 'number') {
        if (typeof value === 'boolean')
            return def;
        if (typeof value === 'number')
            return Number.isInteger(def) ? Math.trunc(value) : value;
        if (typeof value === 'string') {
            const n = Number.parseFloat(value);
            return Number.isFinite(n) ? (Number.isInteger(def) ? Math.trunc(n) : n) : def;
        }
        return def;
    }
    if (typeof def === 'string') {
        if (typeof value === 'string')
            return value;
        if (typeof value === 'number')
            return String(value);
        return def;
    }
    if (Array.isArray(def))
        return Array.isArray(value) ? value : def;
    if (typeof def === 'object')
        return value && typeof value === 'object' && !Array.isArray(value) ? value : def;
    return value;
}
class Store {
    /** Configuracao completa (150 chaves de DEFAULT_CONFIG). */
    config: Record<string, any>;
    /** Biblioteca: chave `local:<slug>` -> dados do jogo. */
    library: Record<string, any>;
    /** Chaves que vieram com tipo errado e foram corrigidas na carga. */
    configFixed: string[] = [];
    dirty: Set<string> = new Set();
    timer: any = null;
    constructor() {
        const raw = (0, util.readJson)(P.CONFIG_FILE, {});
        const out = { ...raw };
        for (const k of Object.keys(exports.DEFAULT_CONFIG)) {
            if (!(k in raw))
                continue;
            const v = coerce(k, raw[k], exports.DEFAULT_CONFIG[k]);
            if (v !== raw[k])
                this.configFixed.push(k);
            out[k] = v;
        }
        this.config = { ...exports.DEFAULT_CONFIG, ...out };
        this.migrateLook();
        this.library = (0, util.readJson)(P.LIBRARY_FILE, {});
    }
    /** Aplica as migracoes de "look" (versao de aparencia) do original. */
    migrateLook() {
        if (this.config.layout === 'console')
            this.config.layout = '';
        if (!this.config.rail_icons)
            this.config.rail_icons = 'solid';
        if (this.config.card_size === 164)
            this.config.card_size = exports.DEFAULT_CONFIG.card_size;
        if (this.config.backdrop_blur === 24 && this.config.backdrop_dim === 55) {
            this.config.backdrop_blur = exports.DEFAULT_CONFIG.backdrop_blur;
            this.config.backdrop_dim = exports.DEFAULT_CONFIG.backdrop_dim;
        }
        const steps = [
            [2, () => {
                    if (this.config.detail_art === 'blur')
                        this.config.detail_art = 'auto';
                    if (this.config.home_spot_style === 'painel')
                        this.config.home_spot_style = 'auto';
                    if (['taskbar', 'dock'].includes(this.config.nav))
                        this.config.nav = 'bottom';
                    if (['taskbar', 'dock'].includes(this.config.layout))
                        this.config.layout = 'bottom';
                    delete this.config.cursor;
                    delete this.config.cursor_size;
                    delete this.config.cursor_speed;
                }],
            [4, () => { if (this.config.face === 'grafite')
                    this.config.face = 'temperado'; }],
            [5, () => {
                    const lights = (this.config.lights || []).map((c) => String(c).toLowerCase());
                    const old = [['#19d3ff', '#3dff9a', '#ffb02e'], ['#19d3ff', '#ffb02e', '#ff6a3d']];
                    if (old.some((o) => JSON.stringify(o) === JSON.stringify(lights))) {
                        this.config.lights = [...exports.DEFAULT_CONFIG.lights];
                    }
                }],
            [6, () => { if (this.config.face === 'temperado')
                    this.config.face = 'padrao'; }],
            [7, () => { if (this.config.animations === 'full')
                    this.config.animations = 'light'; }],
            [8, () => {
                    if (this.config.theme === 'system' && !this.config.theme_mode)
                        this.config.theme = 'dark';
                    if (['', 'rail'].includes(this.config.layout) && ['bottom', 'side'].includes(this.config.nav))
                        this.config.layout = 'side';
                    if (['banner', 'painel'].includes(this.config.home_spot_style))
                        this.config.home_spot_style = 'auto';
                }],
            [9, () => { this.config.update_auto_check = true; }],
            [10, () => {
                    if (this.config.view_mode === 'mural')
                        this.config.view_mode = 'grid';
                    this.config.home_rows = [];
                    this.config.layout = '';
                    this.config.home_spot_style = 'auto';
                    this.config.cover_slideshow = false;
                }],
        ];
        for (const [target, fn] of (steps as any)) {
            if (Number(this.config.look || 0) < target) {
                this.config.look = target;
                fn();
                this.writeNow('config');
            }
        }
    }
    get(key) {
        return this.config[key];
    }
    /** Aplica um patch no config validando contra DEFAULT_CONFIG. */
    setConfig(patch) {
        const changed = [];
        for (const [k, v] of Object.entries(patch || {})) {
            if (!(k in exports.DEFAULT_CONFIG))
                continue;
            const nv = coerce(k, v, exports.DEFAULT_CONFIG[k]);
            if (JSON.stringify(this.config[k]) !== JSON.stringify(nv)) {
                this.config[k] = nv;
                changed.push(k);
            }
        }
        if (changed.length)
            this.markDirty('config');
        return { ok: true, changed };
    }
    resetConfig(keys) {
        const list = (keys || []).filter((k) => k in exports.DEFAULT_CONFIG && !['language', 'welcome_done'].includes(k));
        const patch = {};
        for (const k of list)
            patch[k] = JSON.parse(JSON.stringify(exports.DEFAULT_CONFIG[k]));
        return this.setConfig(patch);
    }
    lib(key) {
        return this.library[key];
    }
    setLib(key, info) {
        this.library[key] = info;
        this.markDirty('library');
    }
    patchLib(key, patch) {
        this.library[key] = { ...(this.library[key] || {}), ...patch };
        this.markDirty('library');
    }
    removeLib(key) {
        const info = this.library[key];
        delete this.library[key];
        this.markDirty('library');
        return info;
    }
    /** Um jogo conta como instalado quando o executavel/pasta existe. */
    isInstalled(key) {
        const i = this.library[key];
        if (!i)
            return false;
        try {
            if (i.exe && fs.existsSync(i.exe))
                return true;
            if (i.dir && fs.existsSync(i.dir))
                return true;
        }
        catch {
            /* ignore */
        }
        return false;
    }
    /** Pasta de jogos efetiva (configurada ou games/). */
    gamesDir() {
        const g = String(this.config.games_dir || '').trim();
        return g || P.GAMES;
    }
    markDirty(which) {
        this.dirty.add(which);
        if (this.timer)
            return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.flush();
        }, 400);
    }
    /** Escreve agora (usado antes de fechar/exportar). */
    frozen = false;
    freeze() {
        this.frozen = true;
        this.dirty.clear();
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
    flush() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.frozen) {
            this.dirty.clear();
            return;
        }
        for (const w of this.dirty)
            this.writeNow(w);
        this.dirty.clear();
    }
    writeNow(which) {
        if (this.frozen)
            return;
        if (which === 'config')
            (0, util.writeJson)(P.CONFIG_FILE, this.config);
        else
            (0, util.writeJson)(P.LIBRARY_FILE, this.library);
    }
    /** Config publicado para a interface (sem segredos). */
    publicConfig(extra: any = {}) {
        const c = { ...this.config };
        c.sgdb_key_set = Boolean(c.sgdb_key);
        c.sgdb_key = '';
        c.games_dir_effective = this.gamesDir();
        c.downloads_dir = P.DOWNLOADS;
        c.root = P.ROOT;
        c.webview2 = 'electron';
        c.os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
        c.appimage = Boolean(process.env.APPIMAGE);
        c.frameless = RUNTIME.frameless ?? Boolean(this.config.frameless);
        c.acrylic_on = RUNTIME.acrylic;
        return { ...c, ...extra };
    }
}

export { setRuntimeFrameless, setRuntimeAcrylic, DEFAULT_CONFIG, Store };
