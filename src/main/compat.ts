import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cp from 'node:child_process';
import * as P from './paths';
import * as log from './log';
import * as http from './http';
import type { Cancel } from './jobs';

export const IS_WIN = process.platform === 'win32';
export const WIN_EXT = ['.exe', '.bat', '.cmd', '.msi', '.lnk'];
export const UMU_VER = '1.4.4';
export const UMU_URL = `https://github.com/Open-Wine-Components/umu-launcher/releases/download/${UMU_VER}/umu-launcher-${UMU_VER}-zipapp.tar`;
export const UMU_DIR = path.join(P.TOOLS, 'umu');
export const PFX_ROOT = path.join(P.DATA, 'pfx');
const SAVED_ENV = ['LD_LIBRARY_PATH', 'LD_PRELOAD', 'PYTHONHOME', 'PYTHONPATH', 'PYTHONNOUSERSITE', 'QT_PLUGIN_PATH', 'QML2_IMPORT_PATH',
    'QT_QPA_PLATFORM_PLUGIN_PATH', 'GI_TYPELIB_PATH', 'GSETTINGS_SCHEMA_DIR', 'XDG_DATA_DIRS', 'PATH', 'SSL_CERT_FILE', 'FONTCONFIG_FILE'];

const isFile = (p: string) => {
    try {
        return fs.statSync(p).isFile();
    }
    catch {
        return false;
    }
};
const isDir = (p: string) => {
    try {
        return fs.statSync(p).isDirectory();
    }
    catch {
        return false;
    }
};

export function isWindowsCmd(cmd: string[]): boolean {
    if (!cmd || !cmd.length)
        return false;
    const c = String(cmd[0]).toLowerCase();
    return WIN_EXT.some((e) => c.endsWith(e));
}

export function hostEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env))
        if (v !== undefined)
            env[k] = v;
    for (const k of SAVED_ENV) {
        const saved = process.env['LUDRIX_SAVE_' + k];
        if (saved !== undefined) {
            if (saved === '')
                delete env[k];
            else
                env[k] = saved;
        }
    }
    for (const k of Object.keys(env))
        if (k.startsWith('LUDRIX_SAVE_') || ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD'].includes(k))
            delete env[k];
    return env;
}

export function which(name: string, pathVar?: string): string | null {
    const pv = pathVar ?? process.env.PATH ?? '';
    const exts = IS_WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';') : [''];
    for (const d of pv.split(path.delimiter)) {
        if (!d)
            continue;
        for (const e of exts) {
            const f = path.join(d, name + (IS_WIN && name.toLowerCase().endsWith(e.toLowerCase()) ? '' : e));
            try {
                fs.accessSync(f, fs.constants.X_OK);
                if (fs.statSync(f).isFile())
                    return f;
            }
            catch { /* próximo */ }
        }
    }
    return null;
}

export function umuPath(): string | null {
    const local = path.join(UMU_DIR, 'umu-run');
    if (isFile(local))
        return local;
    return which('umu-run');
}


export function winePath(): string | null {
    return which('wine');
}

export function systemPython(): string | null {
    for (const n of ['python3', 'python']) {
        const w = which(n, hostEnv().PATH);
        if (w && !w.startsWith(process.env.APPDIR || '/nonexistent'))
            return w;
    }
    return null;
}

export function runner(config: any): string {
    const mode = String((config || {}).linux_runner || 'auto');
    if (mode === 'wine')
        return winePath() ? 'wine' : 'umu';
    return 'umu';
}

export function protonHome(): string {
    return path.join(os.homedir(), '.local', 'share', 'Steam', 'compatibilitytools.d');
}

export function protonChoice(config: any): string {
    const p = String((config || {}).linux_proton || '').trim();
    return p || 'GE-Proton';
}

function expandUser(p: string): string {
    return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

export function protonReady(config: any): boolean {
    const p = protonChoice(config);
    if (p.includes(path.sep))
        return isFile(path.join(expandUser(p), 'proton'));
    const home = protonHome();
    if (!isDir(home))
        return false;
    for (const d of fs.readdirSync(home))
        if (d.startsWith(p) && isFile(path.join(home, d, 'proton')))
            return true;
    return false;
}

export function runtimeReady(): boolean {
    const base = path.join(os.homedir(), '.local', 'share', 'umu');
    if (!isDir(base))
        return false;
    if (isFile(path.join(base, 'umu')))
        return true;
    return fs.readdirSync(base).some((d) => d.startsWith('steamrt') && isDir(path.join(base, d)));
}

export function prefixFor(config: any, game: any | null): string {
    const g = game || {};
    if (g.pfx === 'own' && g.key) {
        const slug = String(g.key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
        return path.join(PFX_ROOT, slug);
    }
    return path.join(PFX_ROOT, 'shared');
}

export function envFor(config: any, game: any | null): Record<string, string> {
    config = config || {};
    const env = hostEnv();
    env.WINEPREFIX = prefixFor(config, game);
    env.GAMEID = String((game || {}).umu_id || '0');
    env.STORE = 'none';
    const pc = protonChoice(config);
    env.PROTONPATH = pc.includes(path.sep) ? expandUser(pc) : pc;
    if (!env.PROTON_VERB)
        env.PROTON_VERB = 'waitforexitandrun';
    if (config.linux_runtime_updates === false)
        env.UMU_RUNTIME_UPDATE = '0';
    for (const part of String(config.linux_env || '').split(/\s+/)) {
        if (part.includes('=')) {
            const i = part.indexOf('=');
            env[part.slice(0, i).trim()] = part.slice(i + 1);
        }
    }
    return env;
}

export function status(config: any = null): any {
    config = config || {};
    if (IS_WIN)
        return { linux: false };
    const r = runner(config);
    const umu = umuPath();
    const wine = winePath();
    const out: any = { linux: true, runner: r, umu: umu || '', wine: wine || '', python: systemPython() || '', proton: protonChoice(config),
        proton_ready: protonReady(config), runtime_ready: runtimeReady(), prefix_root: PFX_ROOT, appimage: Boolean(process.env.APPIMAGE) };
    if (r === 'wine') {
        out.ready = Boolean(wine);
        out.error = wine ? '' : 'Wine não encontrado no sistema';
    }
    else {
        out.ready = Boolean(umu) && out.proton_ready && out.runtime_ready;
        out.error = out.python ? '' : 'Python 3 do sistema não encontrado (o umu precisa dele). Instale python3 pela sua distro.';
    }
    return out;
}

let umuLock: Promise<string> | null = null;

export async function ensureUmu(cb: ((text: string, frac: number) => void) | null = null): Promise<string> {
    const p = path.join(UMU_DIR, 'umu-run');
    if (isFile(p))
        return p;
    if (umuLock)
        return umuLock;
    umuLock = (async () => {
        try {
            fs.mkdirSync(UMU_DIR, { recursive: true });
            const tmp = path.join(UMU_DIR, 'umu.tar');
            if (cb)
                cb('Baixando umu-launcher…', 0.02);
            const r = await http.shared.get(UMU_URL, { timeout: 60000, headers: { 'User-Agent': 'Ludrix' } });
            if (!r.ok)
                throw new Error(`HTTP ${r.status}`);
            fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
            untarNames(tmp, ['umu-run', 'umu_run.py'], UMU_DIR);
            try {
                fs.unlinkSync(tmp);
            }
            catch { /* nada */ }
            if (!isFile(p))
                throw new Error('pacote do umu sem umu-run');
            fs.chmodSync(p, 0o755);
            return p;
        }
        finally {
            umuLock = null;
        }
    })();
    return umuLock;
}

function untarNames(tar: string, names: string[], dest: string) {
    const b = fs.readFileSync(tar);
    let pos = 0;
    while (pos + 512 <= b.length) {
        const hdr = b.subarray(pos, pos + 512);
        if (hdr.every((x) => x === 0))
            break;
        let name = hdr.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
        const prefix = hdr.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
        if (prefix)
            name = prefix + '/' + name;
        const size = parseInt(hdr.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
        const type = String.fromCharCode(hdr[156]);
        pos += 512;
        if ((type === '0' || type === '\0') && names.includes(path.basename(name)))
            fs.writeFileSync(path.join(dest, path.basename(name)), b.subarray(pos, pos + size));
        pos += Math.ceil(size / 512) * 512;
    }
}

export function umuCmd(umu: string): string[] {
    const py = systemPython();
    return py ? [py, umu] : [umu];
}

const PCT = /(\d{1,3})\s*%/;
const TAG = /^\[[^\]]*\]\s*[A-Z]+:\s*/;

export async function prepare(config: any, cb: ((text: string, frac: number) => void) | null, cancel: Cancel | null, game: any | null = null): Promise<any> {
    const step = (text: string, frac: number) => {
        if (cb)
            cb(text, frac);
    };
    config = config || {};
    if (runner(config) === 'wine') {
        const pfx = prefixFor(config, game);
        fs.mkdirSync(pfx, { recursive: true });
        step('Criando prefixo do Wine…', 0.3);
        await new Promise<void>((resolve) => {
            const pr = cp.spawn('wineboot', ['-u'], { env: envFor(config, game), cwd: pfx, stdio: 'ignore' });
            const t = setTimeout(() => pr.kill(), 600000);
            pr.on('exit', () => { clearTimeout(t); resolve(); });
            pr.on('error', () => { clearTimeout(t); resolve(); });
        });
        return { ok: true };
    }
    const umu = await ensureUmu(step);
    const pfx = prefixFor(config, game);
    fs.mkdirSync(pfx, { recursive: true });
    const env = envFor(config, game);
    env.UMU_LOG = '1';
    step('Baixando o Proton e o runtime (uma vez só)…', 0.05);
    const cmd = umuCmd(umu);
    const result = await new Promise<{ rc: number | null; last: string; err?: string }>((resolve) => {
        const pr = cp.spawn(cmd[0], [...cmd.slice(1), ''], { env, cwd: pfx, stdio: ['ignore', 'pipe', 'pipe'] });
        let last = '', buf = '', done = false;
        const t0 = Date.now();
        const finish = (rc: number | null, err?: string) => {
            if (done)
                return;
            done = true;
            clearInterval(iv);
            resolve({ rc, last, err });
        };
        const onLine = (raw: string) => {
            let line = raw.trim();
            if (!line)
                return;
            line = line.replace(TAG, '');
            last = line;
            const m = PCT.exec(line);
            const frac = m ? Math.min(0.95, 0.05 + Number(m[1]) / 100 * 0.9) : -1;
            const low = line.toLowerCase();
            if (low.includes('download') || low.includes('fetch'))
                step(`Baixando ${line.split('Downloading ').pop()!.split(',')[0].replace(/\.+$/, '')}`, frac);
            else if (low.includes('extract') || low.includes('unpack'))
                step(`Extraindo ${path.basename(line.split(' -> ')[0])}`, -1);
            else if (low.includes('prefix') || low.includes('wineboot'))
                step('Criando o prefixo do Proton…', -1);
        };
        const onData = (d: Buffer) => {
            buf += d.toString('utf8');
            const parts = buf.split(/\r?\n/);
            buf = parts.pop() || '';
            parts.forEach(onLine);
        };
        pr.stdout!.on('data', onData);
        pr.stderr!.on('data', onData);
        const iv = setInterval(() => {
            if (cancel && cancel.aborted) {
                pr.kill();
                finish(null, 'cancelado');
            }
            else if (Date.now() - t0 > 3600000) {
                pr.kill();
                finish(null, 'demorou demais (1 h)');
            }
        }, 1000);
        pr.on('exit', (code) => { if (buf) onLine(buf); finish(code); });
        pr.on('error', (e) => finish(null, String(e?.message || e)));
    });
    if (result.err)
        return { error: result.err };
    if (result.rc !== 0 && result.rc !== null)
        log.warn('umu prepare rc=%s: %s', result.rc, result.last);
    const st = status(config);
    if (!st.ready)
        return { error: `O Proton não ficou pronto (${result.last.slice(-160) || 'sem detalhes'}). Veja o ludrix.log.` };
    return { ok: true };
}

export function wrap(cmd: string[], config: any = null, game: any | null = null): [string[], Record<string, string> | null, string] {
    config = config || {};
    if (IS_WIN || !cmd || !cmd.length)
        return [cmd, null, ''];
    const exe = cmd[0];
    if (isWindowsCmd(cmd)) {
        const w = winePath();
        if (runner(config) === 'wine' && w)
            return [[w, ...cmd], envFor(config, game), 'Wine'];
        const umu = umuPath();
        if (!umu)
            return [cmd, null, ''];
        return [[...umuCmd(umu), ...cmd], envFor(config, game), 'Proton'];
    }
    try {
        if (isFile(exe)) {
            try {
                fs.accessSync(exe, fs.constants.X_OK);
            }
            catch {
                fs.chmodSync(exe, fs.statSync(exe).mode | 0o111);
            }
        }
    }
    catch { /* nada */ }
    return [cmd, hostEnv(), ''];
}

export function popen(cmd: string[], cwd: string | null = null, config: any = null, game: any | null = null) {
    const [c, env] = wrap(cmd, config, game);
    return cp.spawn(c[0], c.slice(1), { cwd: cwd || undefined, env: env || undefined, detached: !IS_WIN, stdio: 'ignore', windowsHide: true });
}

export function xdgOpen(target: string): boolean {
    if (IS_WIN || !which('xdg-open'))
        return false;
    try {
        const pr = cp.spawn('xdg-open', [target], { env: hostEnv(), stdio: 'ignore', detached: true });
        pr.unref();
        return true;
    }
    catch {
        return false;
    }
}

export function removePrefix(config: any, game: any | null = null): any {
    const pfx = prefixFor(config, game);
    if (isDir(pfx) && path.resolve(pfx).startsWith(path.resolve(PFX_ROOT) + path.sep))
        fs.rmSync(pfx, { recursive: true, force: true });
    return { ok: true };
}
