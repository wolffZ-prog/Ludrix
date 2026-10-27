import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as electron from 'electron';
import * as P from './paths';
import * as log from './log';
import { DEFAULT_CONFIG } from './store';

export const SAFE_KEYS = ['theme', 'face', 'accent', 'layout', 'nav', 'custom', 'ctx_menu', 'animations', 'fx_type',
    'fx_intensity', 'glass', 'ui_scale', 'density', 'rail_icons', 'hero_enabled'];
const MIN_FREE = 512 * 1024 * 1024;
const WIN = process.platform === 'win32';

export function enterSafeMode(store: any) {
    const d = P.bootRead();
    const saved: any = {};
    for (const k of SAFE_KEYS)
        if (k in store.config)
            saved[k] = store.config[k];
    d.saved = saved;
    d.safe_at = Date.now() / 1000;
    d.tries = 0;
    P.bootWrite(d);
    const patch: any = {};
    for (const k of SAFE_KEYS)
        if (k in (DEFAULT_CONFIG as any))
            patch[k] = JSON.parse(JSON.stringify((DEFAULT_CONFIG as any)[k]));
    store.setConfig(patch);
    return saved;
}

export function savedSettings(): any {
    return { ...(P.bootRead().saved || {}) };
}

export function restoreSettings(store: any): boolean {
    const saved = savedSettings();
    if (!Object.keys(saved).length)
        return false;
    store.setConfig(saved);
    const d = P.bootRead();
    delete d.saved;
    P.bootWrite(d);
    return true;
}

export function freeBytes(p: string): number {
    let q = p;
    while (!fs.existsSync(q) && path.dirname(q) !== q)
        q = path.dirname(q);
    try {
        const st = (fs as any).statfsSync(q);
        return Number(st.bavail) * Number(st.bsize);
    }
    catch {
        return -1;
    }
}

export function human(n: number): string {
    n = Number(n);
    for (const u of ['B', 'KB', 'MB', 'GB', 'TB']) {
        if (n < 1024 || u === 'TB')
            return u === 'B' || u === 'KB' ? `${Math.trunc(n)} ${u}` : `${n.toFixed(1)} ${u}`;
        n /= 1024;
    }
    return `${n.toFixed(1)} TB`;
}

function anchorOf(p: string): string {
    const r = path.parse(p).root;
    return r || p;
}

export function ensureSpace(target: string, needed: number, what = 'baixar') {
    if (needed <= 0)
        return;
    const free = freeBytes(target);
    if (free < 0)
        return;
    const want = Math.trunc(needed * 1.05) + MIN_FREE;
    if (free < want)
        throw new Error(`Sem espaço para ${what}: precisa de ${human(want)} livres em ${anchorOf(target)}, tem ${human(free)}. Libere ${human(want - free)} ou mude a pasta de jogos em Ajustes.`);
}

export function writable(p: string): boolean {
    try {
        fs.mkdirSync(p, { recursive: true });
        const t = path.join(p, `.w${process.pid}`);
        fs.writeFileSync(t, 'ok', 'utf8');
        fs.unlinkSync(t);
        return true;
    }
    catch {
        return false;
    }
}

export function logTail(n = 30): string[] {
    try {
        const lines = fs.readFileSync(P.LOG_FILE, 'utf8').split(/\r?\n/);
        if (lines.length && lines[lines.length - 1] === '')
            lines.pop();
        return lines.slice(-n);
    }
    catch {
        return [];
    }
}

export function engineInfo(): string {
    return `Electron ${process.versions.electron} · Chromium ${(process.versions.chrome || '').split('.')[0]} · Node ${process.versions.node}`;
}

export const UI_ERRORS: string[] = [];

export function uiError(msg: string, src = '', line = 0) {
    const txt = src ? `${msg} (${src.split('/').pop()}:${line})` : msg;
    if (UI_ERRORS.length && UI_ERRORS[UI_ERRORS.length - 1] === txt)
        return;
    UI_ERRORS.push(txt);
    if (UI_ERRORS.length > 30)
        UI_ERRORS.splice(0, UI_ERRORS.length - 30);
    log.warn('UI: %s', txt);
}

export function memoryUsage(): any {
    try {
        const metrics = electron.app.getAppMetrics();
        let own = 0, web = 0, other = 0;
        for (const m of metrics) {
            const n = Number(m.memory?.privateBytes || m.memory?.workingSetSize || 0) * 1024;
            if (m.type === 'Browser')
                own += n;
            else if (m.type === 'Tab' || m.type === 'GPU')
                web += n;
            else
                other += n;
        }
        if (!own)
            own = process.memoryUsage().rss;
        return { own, web, other, total: own + web + other };
    }
    catch {
        return {};
    }
}

function fmtNow() {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtAt(ms: number) {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export async function report(be: any, apiOk: boolean | null = null): Promise<any> {
    const { find7z } = require('./installer');
    const torrent = require('./torrent');
    const compat = require('./compat');
    const store = be.store;
    const checks: any[] = [];
    const add = (id: string, name: string, ok: any, detail: any, warn = false) => checks.push({ id, name, ok: Boolean(ok), warn: Boolean(warn), detail: String(detail) });
    const ver = String(require('./backend').VERSION || '?');
    add('app', 'Ludrix', true, `${ver}${P.FROZEN ? ' (exe)' : ' (código-fonte)'}`);
    const sysName = WIN ? 'Windows' : process.platform === 'darwin' ? 'Darwin' : 'Linux';
    add('os', 'Sistema', true, `${sysName} ${os.release()} · Electron ${process.versions.electron || '?'} · ${os.arch()}`);
    add('root', 'Pasta do programa', true, P.ROOT);
    const low = P.ROOT.toLowerCase();
    if (WIN && (low.includes('program files') || low.startsWith('c:\\windows')))
        add('root_pf', 'Local da pasta', true, 'Dentro de Arquivos de Programas — o Windows bloqueia gravações aí. Mova a pasta Ludrix para outro lugar (ex.: C:\\Jogos\\Ludrix).', true);
    const fixed: string[] = store.configFixed || [];
    if (fixed.length)
        add('config', 'Ajustes (config.json)', true, `${fixed.length} campo(s) com valor inválido foram corrigidos ao abrir: ${fixed.slice(0, 8).join(', ')}`, true);
    const w = writable(P.DATA);
    add('write', 'Gravação em data/', w, w ? 'OK' : 'Sem permissão de escrita — ajustes e biblioteca não serão salvos');
    const gd = store.gamesDir();
    add('write_games', 'Gravação na pasta de jogos', writable(gd), gd);
    for (const [cid, name, p] of [['disk_root', 'Espaço livre (programa)', P.ROOT], ['disk_games', 'Espaço livre (jogos)', gd]] as Array<[string, string, string]>) {
        if (cid === 'disk_games' && path.parse(p).root === path.parse(P.ROOT).root)
            continue;
        const fb = freeBytes(p);
        add(cid, name, fb < 0 || fb >= 2 * 1024 ** 3, fb >= 0 ? `${human(fb)} em ${anchorOf(p)}` : 'não deu para medir', fb >= 0 && fb < 2 * 1024 ** 3);
    }
    add('engine', 'Motor da janela', true, engineInfo());
    if (!WIN) {
        try {
            const st = compat.status(store.config);
            if (st.runner === 'wine')
                add('proton', 'Jogos de Windows', Boolean(st.wine), `Wine do sistema: ${st.wine || 'não encontrado'}`, !st.wine);
            else {
                const ok = Boolean(st.proton_ready && st.runtime_ready);
                add('proton', 'Jogos de Windows', true, `umu + ${st.proton || 'GE-Proton'} ${ok ? 'prontos' : '(baixa na primeira vez que um jogo abrir)'}` + (st.python ? '' : ' · python3 do sistema não encontrado'), !st.python);
            }
        }
        catch (e: any) {
            add('proton', 'Jogos de Windows', true, `não verificado: ${e?.message || e}`, true);
        }
    }
    if (apiOk !== null)
        add('api', 'Servidor interno', apiOk, apiOk ? 'respondendo' : 'não respondeu');
    const mem = memoryUsage();
    if (mem.total) {
        const partsM = [`Ludrix ${human(mem.own)}`, `interface (Chromium) ${human(mem.web)}`];
        if (mem.other)
            partsM.push(`outros processos ${human(mem.other)}`);
        add('mem', 'Memória em uso', mem.total < 1024 * 1024 ** 2, partsM.join(' · ') + ` · total ${human(mem.total)}`, mem.total >= 1024 * 1024 ** 2);
    }
    const sz = find7z();
    add('7z', '7-Zip', true, sz || 'não encontrado — extração de .7z indisponível até baixar', !sz);
    add('torrent', 'Motor de torrent', true, torrent.available() ? 'presente (webtorrent)' : 'ausente', !torrent.available());
    const lib: Record<string, any> = store.library;
    let missing = 0;
    for (const e of Object.values(lib)) {
        const d = String(e.dir || ''), exe = String(e.exe || '');
        const p = exe && path.isAbsolute(exe) ? exe : (d && exe ? path.join(d, exe) : (d || null));
        if (p !== null && !fs.existsSync(p))
            missing += 1;
    }
    const n = Object.keys(lib).length;
    const roms = Object.keys(lib).filter((k) => k.startsWith('rom:')).length;
    const pn = Object.values(lib).filter((e) => e.source === 'playnite').length;
    const parts = [`${n} jogo` + (n !== 1 ? 's' : '')];
    if (roms)
        parts.push(`${n - roms} PC · ${roms} ROM` + (roms !== 1 ? 's' : ''));
    if (pn)
        parts.push(`${pn} do Playnite`);
    if (missing)
        parts.push(`${missing} com arquivo não encontrado`);
    add('library', 'Biblioteca', missing === 0, parts.join(' · '), missing > 0);
    let bk: Array<{ f: string; m: number }> = [];
    try {
        bk = fs.readdirSync(P.BACKUPS).filter((f) => /^library-.*\.json$/.test(f)).map((f) => ({ f, m: fs.statSync(path.join(P.BACKUPS, f)).mtimeMs })).sort((a, b) => a.m - b.m);
    }
    catch {
        bk = [];
    }
    if (bk.length)
        add('backups', 'Cópias da biblioteca', true, `${bk.length} cópia` + (bk.length !== 1 ? 's' : '') + ' · última em ' + fmtAt(bk[bk.length - 1].m));
    else
        add('backups', 'Cópias da biblioteca', true, 'nenhuma cópia ainda — a primeira é feita ao abrir o launcher', n > 0);
    const cfg = store.config;
    add('ui', 'Interface', !UI_ERRORS.length, `tema ${cfg.theme || 'system'} · navegação ${cfg.nav_pos || 'left'} · animações ${cfg.animations || 'full'}` + (UI_ERRORS.length ? ` · ${UI_ERRORS.length} erro(s) de interface nesta sessão` : ''), UI_ERRORS.length > 0);
    let online = false;
    try {
        online = Boolean(await be.online());
    }
    catch {
        online = false;
    }
    add('online', 'Internet', true, online ? 'conectado' : 'sem conexão (o Ludrix funciona offline; Store e capas ficam indisponíveis)', !online);
    add('safe', 'Modo seguro', true, be.safeMode ? 'ativo nesta sessão' : 'não', Boolean(be.safeMode));
    {
        const rec = require('./util').recovered() as any[];
        const guarded = ['config.json', 'library.json', 'repos.json', 'sources_state.json'];
        const withBak = guarded.filter((f) => fs.existsSync(path.join(P.DATA, f + '.bak'))).length;
        if (rec.length)
            add('data', 'Arquivos de dados', rec.every((r) => r.from), rec.map((r) => `${r.file} ${r.from ? 'restaurado de ' + r.from : 'corrompido e sem cópia'}`).join(' · '), true);
        else
            add('data', 'Arquivos de dados', true, `íntegros · ${withBak} de ${guarded.length} com cópia anterior (.bak)`);
    }
    const tail = logTail(30);
    const ok = checks.every((c) => c.ok);
    const lines = [`LudrixHub ${ver} — diagnóstico ${fmtNow()}`];
    for (const c of checks) {
        const mark = c.ok && !c.warn ? 'OK ' : (c.ok ? '!! ' : 'XX ');
        lines.push(`${mark}${c.name}: ${c.detail}`);
    }
    if (UI_ERRORS.length)
        lines.push('', '--- erros de interface ---', ...UI_ERRORS.slice(-10));
    if (tail.length)
        lines.push('', '--- últimas linhas do log ---', ...tail);
    return { ok, checks, log: tail, text: lines.join('\n') };
}

function sanitizeConfig(cfg: any) {
    const out: any = {};
    for (const [k, v] of Object.entries(cfg || {})) {
        if (/token|secret|key$|password|senha/i.test(k))
            out[k] = v ? '<oculto>' : v;
        else
            out[k] = v;
    }
    return out;
}
export async function zip(be: any): Promise<any> {
    const AdmZip = require('adm-zip');
    const rep = await report(be, true);
    const z = new AdmZip();
    z.addFile('diagnostico.txt', Buffer.from(rep.text, 'utf8'));
    try {
        if (fs.existsSync(P.LOG_FILE)) {
            const st = fs.statSync(P.LOG_FILE);
            const fd = fs.openSync(P.LOG_FILE, 'r');
            const n = Math.min(st.size, 2 * 1024 * 1024);
            const buf = Buffer.alloc(n);
            fs.readSync(fd, buf, 0, n, st.size - n);
            fs.closeSync(fd);
            z.addFile('ludrix.log', buf);
        }
    }
    catch { }
    z.addFile('config.json', Buffer.from(JSON.stringify(sanitizeConfig(be.store.config), null, 1), 'utf8'));
    for (const f of ['schema.json', 'boot.json', 'instance.json']) {
        try {
            if (fs.existsSync(path.join(P.DATA, f)))
                z.addLocalFile(path.join(P.DATA, f));
        }
        catch { }
    }
    const repos = (be.repos?.list?.() || []).map((r: any) => ({ id: r.id, type: r.type, name: r.name, enabled: r.enabled, url: String(r.url || '').replace(/[?#].*$/, ''), count: r.count, error: r.error }));
    z.addFile('fontes.json', Buffer.from(JSON.stringify(repos, null, 1), 'utf8'));
    const lib = Object.entries(be.store.library || {}).map(([k, e]: any) => ({ key: k, title: e.title, system: e.system, source: e.source, installed: e.installed, has_exe: Boolean(e.exe), has_dir: Boolean(e.dir) }));
    z.addFile('biblioteca-resumo.json', Buffer.from(JSON.stringify(lib, null, 1), 'utf8'));
    const mem = memoryUsage();
    const env = { versao: String(require('./backend').VERSION || '?'), electron: process.versions.electron, node: process.versions.node, so: `${process.platform} ${os.release()} ${os.arch()}`, memoria: mem, exe: P.FROZEN, pasta: P.ROOT, gerado: new Date().toISOString(), ui_erros: UI_ERRORS.slice(-20) };
    z.addFile('ambiente.json', Buffer.from(JSON.stringify(env, null, 1), 'utf8'));
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}`;
    fs.mkdirSync(P.BACKUPS, { recursive: true });
    const out = path.join(P.BACKUPS, `Ludrix-diagnostico-${stamp}.zip`);
    z.writeZip(out);
    try {
        electron.shell.showItemInFolder(out);
    }
    catch { }
    return { ok: true, path: out, size: fs.statSync(out).size };
}
