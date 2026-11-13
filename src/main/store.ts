import fs from 'node:fs';
import path from 'node:path';
import * as P from './paths';
import * as util from './util';
const RUNTIME: { frameless: boolean | null; acrylic: boolean } = { frameless: null, acrylic: false };
function setRuntimeFrameless(v: boolean) { RUNTIME.frameless = Boolean(v); }
function setRuntimeAcrylic(v: boolean) { RUNTIME.acrylic = Boolean(v); }
const DEFAULT_CONFIG = {
    native: true,
    theme: 'dark',
    theme_mode: '',
    face: 'padrao',
    accent: '',
    games_dir: '',
    shortcut_ask: true,
    bootstrap_done: false,
    pending_delete: [],
    keep_archive: false,
    dl_speed: 0,
    auto_metadata: true,
    web_covers: true,
    bg_warmup: false,
    auto_rename: true,
    title_overrides: {},
    meta_sources: {},
    torrent_enabled: true,
    torrent_max_down: 0,
    torrent_max_up: 100,
    torrent_seed_after: false,
    concurrent_downloads: 2,
    after_queue: 'none',
    disabled_repos: [],
    known_repos: null,
    after_launch: 'ask',
    home_spot: false,
    tray_enabled: true,
    tray_sleep: true,
    hotkey_enabled: true,
    hotkey: 'Ctrl+Shift+L',
    discord_enabled: false,
    discord_app_id: '',
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
    collections: [],
    win_notify: true,
    crash_watch: true,
    crash_mute: [],
    console_volume: 60,
    store_hide_installed: true,
    store_auto_refresh: 12,
    pause_downloads_playing: true,
    dl_max_down: 0,
    dl_schedule: false,
    dl_from: '23:00',
    dl_to: '07:00',
    notify_hidden: true,
    taskbar_progress: true,
    store_notify_new: true,
    card_size: 136,
    view_mode: 'mural',
    list_cols: ['year', 'genre', 'size', 'playtime', 'last', 'status'],
    game_backdrop: '',
    backdrop_blur: 10,
    backdrop_dim: 42,
    accent_from_cover: true,
    accent_mode: 'theme',
    theme_schedule: false,
    theme_light_from: '07:00',
    theme_light_to: '19:00',
    text_size: 0,
    card_ribbons: true,
    nav_hidden: [],
    nav_order: [],
    group_by: 'letter',
    sort_by: 'az',
    group_store: '',
    sort_store: 'fresh',
    launch_splash: 'short',
    detail_art: 'off',
    look: 0,
    card_hover: 'lift',
    reduce_motion: false,
    fog: 30,
    acrylic: false,
    parallax: true,
    high_contrast: false,
    clock: 'off',
    settings_adv: false,
    filter_panel: false,
    filter_presets: [],
    card_playtime: true,
    card_origin: false,
    warn_missing: true,
    game_dirs: [],
    watch_dirs: true,
    file_assoc: true,
    file_assoc_cmd: '',
    start_menu: true,
    start_menu_cmd: '',
    keymap: {},
    auto_backup: true,
    auto_backup_dir: '',
    auto_backup_at: 0,
    img_gc_at: 0,
    sweep_ver: '',
    sweep_at: 0,
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
    nav_hide_playing: false,
    cover_slideshow: false,
    cover_slideshow_secs: 45,
    flash_stats: {},
    nav: 'bottom',
    layout: 'side',
    game_args: {},
    repos_default_off: true,
    repos_initialized: false,
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
    emu_no_ask: false,
    ui_scale: 0,
    density: 'normal',
    glass: true,
    hero_enabled: true,
    language: 'pt-BR',
    popups: true,
    notify_sound: true,
    ui_sounds: true,
    ui_sounds_level: 'low',
    repack_auto_open: false,
    notifications: [],
    notif_seen: [],
    notif_hidden: [],
    animations: 'light',
    fx_type: 'controls',
    fx_intensity: 10,
    rail_icons: 'solid',
    status_position: 'bottom',
    gamepad_enabled: true,
    sofa_zoom: 1.15,
    nav_layout: 'top',
    gamepad_wake: false,
    mods_dir: '',
    update_feed: '',
    update_auto_check: true,
    pending_restart: [],
    gamepad_speed: 'normal',
    game_emulator: {},
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
const PROFILE_KEYS = new Set([
    'theme', 'theme_mode', 'face', 'accent', 'accent_from_cover', 'accent_mode', 'theme_schedule', 'theme_light_from', 'theme_light_to',
    'look', 'glass', 'fog', 'fx_type', 'fx_intensity', 'animations', 'reduce_motion', 'parallax', 'high_contrast', 'card_hover',
    'ui_scale', 'text_size', 'density', 'card_size', 'view_mode', 'list_cols', 'card_ribbons', 'card_playtime', 'card_origin', 'cover_slideshow', 'cover_slideshow_secs',
    'game_backdrop', 'backdrop_blur', 'backdrop_dim', 'detail_art', 'hero_enabled', 'home_spot', 'fav_first', 'store_hide_installed',
    'group_by', 'sort_by', 'group_store', 'sort_store', 'filter_panel', 'filter_presets', 'settings_adv',
    'layout', 'nav', 'nav_layout', 'nav_hidden', 'nav_order', 'rail_icons', 'status_position', 'clock',
    'language', 'popups', 'notify_sound', 'ui_sounds', 'ui_sounds_level', 'launch_splash', 'keymap', 'gamepad_speed', 'sofa_zoom',
    'discord_enabled', 'discord_app_id', 'favorites',
    'console_theme', 'console_sound', 'console_hint', 'console_card_size', 'console_clock24', 'console_start_view', 'console_vibrate', 'console_dim_idle', 'console_confirm_quit', 'console_sort', 'console_dl_pill',
]);
const PROFILE_COLORS = ['#5c6b82', '#c0392b', '#d68910', '#1e8449', '#1f618d', '#7d3c98', '#117a65', '#884ea0'];
type Profile = { id: string; name: string; color: string; created: number; avatar?: number };
type Profiles = { active: string; ask: boolean; list: Profile[] };
function sanitizeConfig(raw: Record<string, any>, fixed?: string[]) {
    const out = { ...raw };
    for (const k of Object.keys(DEFAULT_CONFIG)) {
        if (!(k in raw))
            continue;
        const v = coerce(k, raw[k], DEFAULT_CONFIG[k]);
        if (v !== raw[k] && fixed)
            fixed.push(k);
        out[k] = v;
    }
    return out;
}
class Store {
    config: Record<string, any>;
    base: Record<string, any>;
    overlay: Record<string, any> = {};
    profiles: Profiles = { active: '', ask: true, list: [] };
    library: Record<string, any>;
    configFixed: string[] = [];
    dirty: Set<string> = new Set();
    timer: any = null;
    static PROFILES_FILE = () => path.join(P.DATA, 'profiles.json');
    static profileFile = (id: string) => path.join(P.DATA, 'profiles', `${id}.json`);
    constructor() {
        this.base = { ...DEFAULT_CONFIG, ...sanitizeConfig(util.readJson(P.CONFIG_FILE, {}), this.configFixed) };
        this.config = this.base;
        this.migrateLook();
        this.library = util.readJson(P.LIBRARY_FILE, {});
        this.migrateSchema();
        this.loadProfiles();
    }
    loadProfiles() {
        const raw = util.readJson(Store.PROFILES_FILE(), null) as any;
        const list: Profile[] = Array.isArray(raw?.list) ? raw.list.filter((x) => x && typeof x.id === 'string' && /^[a-z0-9]{4,24}$/.test(x.id)).map((x) => ({
            id: x.id, name: String(x.name || '').slice(0, 32) || 'Perfil', color: /^#[0-9a-f]{6}$/i.test(String(x.color)) ? String(x.color) : PROFILE_COLORS[0], created: Number(x.created) || 0,
            ...(Number(x.avatar) > 0 ? { avatar: Number(x.avatar) } : {}),
        })) : [];
        this.profiles = { active: '', ask: raw ? raw.ask !== false : true, list };
        const active = String(raw?.active || '');
        if (list.some((x) => x.id === active))
            this.activate(active);
    }
    activate(id: string) {
        this.profiles.active = id;
        const file = util.readJson(Store.profileFile(id), {}) as any;
        const raw = sanitizeConfig(file);
        this.overlay = {};
        for (const k of Object.keys(raw))
            if (PROFILE_KEYS.has(k))
                this.overlay[k] = raw[k];
        const look = Number(file && file.look || 0);
        if (look < Store.OVERLAY_LOOK) {
            for (const [target, patch] of Store.OVERLAY_STEPS)
                if (look < target)
                    for (const [k, v] of Object.entries(patch))
                        if (PROFILE_KEYS.has(k))
                            this.overlay[k] = v;
            this.overlay.look = Store.OVERLAY_LOOK;
            this.writeOverlay();
        }
        this.config = { ...this.base, ...this.overlay };
    }
    static OVERLAY_STEPS: [number, Record<string, any>][] = [
        [13, { home_spot: false, card_origin: false, detail_art: 'off' }],
        [14, { nav_layout: 'top', view_mode: 'mural' }],
    ];
    static OVERLAY_LOOK = 14;
    writeOverlay() {
        if (!this.profiles.active)
            return;
        fs.mkdirSync(path.dirname(Store.profileFile(this.profiles.active)), { recursive: true });
        util.writeJson(Store.profileFile(this.profiles.active), { ...this.overlay, look: Store.OVERLAY_LOOK });
    }
    profileInfo() {
        const { active, ask, list } = this.profiles;
        return { active, ask, language: String(this.config.language || 'pt-BR'), list: list.map((x) => ({ ...x })) };
    }
    saveProfiles() {
        util.writeJson(Store.PROFILES_FILE(), this.profiles);
    }
    profileCreate(name: string, color?: string) {
        name = String(name || '').trim().slice(0, 32);
        if (!name)
            return { error: 'Dê um nome ao perfil.' };
        if (this.profiles.list.length >= 8)
            return { error: 'Limite de 8 perfis.' };
        const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
        const used = new Set(this.profiles.list.map((x) => x.color));
        const pick = PROFILE_COLORS.find((c) => !used.has(c)) || PROFILE_COLORS[this.profiles.list.length % PROFILE_COLORS.length];
        const prof: Profile = { id, name, color: /^#[0-9a-f]{6}$/i.test(String(color)) ? String(color) : pick, created: Date.now() };
        const seed: Record<string, any> = {};
        for (const k of PROFILE_KEYS)
            seed[k] = JSON.parse(JSON.stringify(this.config[k] ?? DEFAULT_CONFIG[k]));
        fs.mkdirSync(path.dirname(Store.profileFile(id)), { recursive: true });
        util.writeJson(Store.profileFile(id), seed);
        this.profiles.list.push(prof);
        if (!this.profiles.active) {
            this.flush();
            this.activate(id);
        }
        this.saveProfiles();
        return { ok: true, profile: { ...prof } };
    }
    profileUpdate(id: string, patch: { name?: string; color?: string }) {
        const prof = this.profiles.list.find((x) => x.id === id);
        if (!prof)
            return { error: 'Perfil não encontrado.' };
        if (typeof patch.name === 'string' && patch.name.trim())
            prof.name = patch.name.trim().slice(0, 32);
        if (typeof patch.color === 'string' && /^#[0-9a-f]{6}$/i.test(patch.color))
            prof.color = patch.color;
        this.saveProfiles();
        return { ok: true, profile: { ...prof } };
    }
    profileRemove(id: string) {
        const i = this.profiles.list.findIndex((x) => x.id === id);
        if (i < 0)
            return { error: 'Perfil não encontrado.' };
        const wasActive = this.profiles.active === id;
        if (wasActive)
            this.flush();
        this.profiles.list.splice(i, 1);
        for (const f of [Store.profileFile(id), Store.avatarFile(id)]) {
            try {
                fs.rmSync(f, { force: true });
            }
            catch { }
        }
        if (wasActive) {
            const next = this.profiles.list[0];
            if (next)
                this.activate(next.id);
            else {
                this.profiles.active = '';
                this.overlay = {};
                this.config = this.base;
            }
        }
        this.saveProfiles();
        return { ok: true, reload: wasActive };
    }
    static avatarFile = (id: string) => path.join(P.DATA, 'profiles', `${id}.png`);
    profileAvatar(id: string, png: Buffer | null) {
        const p = this.profiles.list.find((x) => x.id === id);
        if (!p)
            return { error: 'Perfil não encontrado.' };
        const file = Store.avatarFile(id);
        if (!png) {
            try {
                fs.rmSync(file, { force: true });
            }
            catch { }
            delete p.avatar;
            this.saveProfiles();
            return { ok: true };
        }
        if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47 || png.toString('ascii', 12, 16) !== 'IHDR')
            return { error: 'O arquivo precisa ser um PNG.' };
        const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
        if (w > 64 || h > 64)
            return { error: `A imagem tem ${w}×${h}; o máximo é 64×64.` };
        if (png.length > 256 * 1024)
            return { error: 'PNG grande demais (máximo 256 KB).' };
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, png);
        p.avatar = Date.now();
        this.saveProfiles();
        return { ok: true };
    }
    profileAsk(ask: boolean) {
        this.profiles.ask = Boolean(ask);
        this.saveProfiles();
        return { ok: true };
    }
    profileSwitch(id: string) {
        if (!this.profiles.list.some((x) => x.id === id))
            return { error: 'Perfil não encontrado.' };
        this.flush();
        if (id !== this.profiles.active)
            this.activate(id);
        this.saveProfiles();
        return { ok: true, active: id, language: String(this.config.language || 'pt-BR') };
    }
    static SCHEMA = 1;
    static SCHEMA_FILE = () => path.join(P.DATA, 'schema.json');
    schemaInfo: { version: number; app: string; at: number; newer?: boolean; migrated?: number[] } = { version: 0, app: '', at: 0 };
    migrateSchema() {
        const cur = util.readJson(Store.SCHEMA_FILE(), null) as any;
        const had = cur && Number.isFinite(Number(cur.version)) ? Number(cur.version) : (fs.existsSync(P.CONFIG_FILE) ? 0 : Store.SCHEMA);
        let app = '';
        try { app = String(require('./updates').currentVersion().version || ''); } catch { }
        if (had > Store.SCHEMA) {
            this.schemaInfo = { version: had, app: String(cur.app || ''), at: Number(cur.at || 0), newer: true };
            return;
        }
        const migrated: number[] = [];
        const steps: Record<number, () => void> = {
            0: () => {
                for (const [k, v] of Object.entries(this.library || {})) {
                    if (!v || typeof v !== 'object' || Array.isArray(v))
                        delete (this.library as any)[k];
                }
            },
        };
        for (let v = had; v < Store.SCHEMA; v++) {
            try { steps[v]?.(); migrated.push(v + 1); } catch (e) { void e; }
        }
        this.schemaInfo = { version: Store.SCHEMA, app, at: Date.now() / 1000, migrated };
        if (had !== Store.SCHEMA || !cur || cur.app !== app) {
            util.writeJson(Store.SCHEMA_FILE(), { version: Store.SCHEMA, app, at: Math.floor(Date.now() / 1000), files: ['config.json', 'library.json', 'repos.json', 'sources_state.json'] });
            if (migrated.length)
                this.markDirty('library');
        }
    }
    migrateLook() {
        if (this.config.layout === 'console')
            this.config.layout = '';
        if (!this.config.rail_icons)
            this.config.rail_icons = 'solid';
        if (this.config.card_size === 164)
            this.config.card_size = DEFAULT_CONFIG.card_size;
        if (this.config.backdrop_blur === 24 && this.config.backdrop_dim === 55) {
            this.config.backdrop_blur = DEFAULT_CONFIG.backdrop_blur;
            this.config.backdrop_dim = DEFAULT_CONFIG.backdrop_dim;
        }
        const steps = [
            [2, () => {
                    if (this.config.detail_art === 'blur')
                        this.config.detail_art = 'auto';
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
            [6, () => { if (this.config.face === 'temperado')
                    this.config.face = 'padrao'; }],
            [7, () => { if (this.config.animations === 'full')
                    this.config.animations = 'light'; }],
            [8, () => {
                    if (this.config.theme === 'system' && !this.config.theme_mode)
                        this.config.theme = 'dark';
                    if (['', 'rail'].includes(this.config.layout) && ['bottom', 'side'].includes(this.config.nav))
                        this.config.layout = 'side';
                }],
            [9, () => { this.config.update_auto_check = true; }],
            [10, () => {
                    if (this.config.view_mode === 'mural')
                        this.config.view_mode = 'grid';
                    this.config.layout = '';
                    this.config.cover_slideshow = false;
                }],
            [11, () => {
                    for (const k of ['home_spot_style', 'home_autoplay', 'guides', 'guides_done', 'start_done', 'start_hide', 'game_mode_auto', 'game_mode_ask', 'game_mode_plan', 'game_mode_quiet', 'game_mode_power', 'game_mode_priority', 'game_mode_reopen', 'game_mode_close'])
                        delete this.config[k];
                }],
            [12, () => {
                    for (const k of ['lights', 'home_rows', 'toolbar', 'toolbar_items'])
                        delete this.config[k];
                }],
            [13, () => {
                    this.config.nav_layout = 'rail';
                    this.config.home_spot = false;
                    this.config.card_origin = false;
                    this.config.acrylic = false;
                    this.config.detail_art = 'off';
                }],
            [14, () => {
                    this.config.nav_layout = 'top';
                    this.config.view_mode = 'mural';
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
    setConfig(patch) {
        const changed = [];
        for (const [k, v] of Object.entries(patch || {})) {
            if (!(k in DEFAULT_CONFIG))
                continue;
            const nv = coerce(k, v, DEFAULT_CONFIG[k]);
            if (JSON.stringify(this.config[k]) !== JSON.stringify(nv)) {
                this.config[k] = nv;
                if (this.config !== this.base) {
                    if (PROFILE_KEYS.has(k) && this.profiles.active)
                        this.overlay[k] = nv;
                    else
                        this.base[k] = nv;
                }
                changed.push(k);
            }
        }
        if (changed.length)
            this.markDirty('config');
        return { ok: true, changed };
    }
    resetConfig(keys) {
        const list = (keys || []).filter((k) => k in DEFAULT_CONFIG && !['language', 'welcome_done'].includes(k));
        const patch = {};
        for (const k of list)
            patch[k] = JSON.parse(JSON.stringify(DEFAULT_CONFIG[k]));
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
        }
        return false;
    }
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
        if (which === 'config') {
            util.writeJson(P.CONFIG_FILE, this.base);
            if (this.profiles.active)
                this.writeOverlay();
        }
        else
            util.writeJson(P.LIBRARY_FILE, this.library);
    }
    publicConfig(extra: any = {}) {
        const c = { ...this.config };
        c.games_dir_effective = this.gamesDir();
        c.downloads_dir = P.DOWNLOADS;
        c.root = P.ROOT;
        c.engine = `Electron ${process.versions.electron} · Chromium ${(process.versions.chrome || '').split('.')[0]}`;
        c.discord_status = (this as any).discordStatus ? (this as any).discordStatus() : { connected: false, error: '' };
        try {
            c.hotkey_status = require('./index').hotkeyStatus;
        }
        catch {
            c.hotkey_status = { ok: false, error: '', accel: '' };
        }
        c.os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
        c.appimage = Boolean(process.env.APPIMAGE);
        c.frameless = RUNTIME.frameless ?? Boolean(this.config.frameless);
        c.profiles = this.profileInfo();
        c.acrylic_on = RUNTIME.acrylic;
        c.win11 = process.platform === 'win32' && Number((require('node:os').release().split('.')[2] || '0')) >= 22000;
        return { ...c, ...extra };
    }
}

export { setRuntimeFrameless, setRuntimeAcrylic, DEFAULT_CONFIG, PROFILE_KEYS, PROFILE_COLORS, Store };
