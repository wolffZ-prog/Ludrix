import fs from 'node:fs';
import path from 'node:path';
import * as cp from 'node:child_process';
import * as P from './paths';
import * as disc from './disc';
import * as compat from './compat';

const WIN = process.platform === 'win32';
const now = () => Date.now() / 1000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Waiter = { wait: () => Promise<void>; pid: number };

function launchElevated(exe: string): Waiter | { error: string } {
    if (!WIN) {
        try {
            const proc = compat.popen([exe], path.dirname(exe));
            return { pid: proc.pid || 0, wait: () => new Promise<void>((res) => { proc.on('exit', () => res()); proc.on('error', () => res()); }) };
        }
        catch (e: any) {
            return { error: String(e?.message || e) };
        }
    }
    const q = (a: string) => "'" + a.replace(/'/g, "''") + "'";
    const script = `$p = Start-Process -FilePath ${q(exe)} -WorkingDirectory ${q(path.dirname(exe))} -Verb RunAs -PassThru -ErrorAction Stop; if ($p) { [Console]::Out.WriteLine('PID=' + $p.Id); [Console]::Out.Flush(); $p.WaitForExit() } else { [Console]::Out.WriteLine('PID=0') }`;
    const child = cp.spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let pid = -1;
    let err = '';
    let out = '';
    child.stdout.on('data', (d) => {
        out += String(d);
        const m = /PID=(\d+)/.exec(out);
        if (m && pid < 0)
            pid = parseInt(m[1], 10);
    });
    child.stderr.on('data', (d) => { err += String(d); });
    const exited = new Promise<void>((res) => { child.on('exit', () => res()); child.on('error', () => res()); });
    const t0 = Date.now();
    while (pid < 0 && child.exitCode === null && Date.now() - t0 < 120_000)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    if (pid < 0) {
        const line = err.trim().split(/\r?\n/)[0] || '';
        return { error: /canceled by the user|cancelada pelo usu|1223/i.test(err) ? 'Você cancelou a permissão de administrador' : `Não consegui abrir o instalador${line ? ` (${line.slice(0, 120)})` : ''}` };
    }
    if (!pid)
        return { pid: 0, wait: () => sleep(30_000) };
    return { pid, wait: () => exited };
}

export class Repack {
    constructor(private be: any) {}

    get store() {
        return this.be.store;
    }

    run(key: string, force = false): any {
        const info = this.store.lib(key);
        if (!info || !info.repack)
            return { error: 'Esse item não é um repack pendente' };
        if (info.disc)
            return this.runDisc(key, info, force);
        const setup = String(info.repack);
        if (!fs.existsSync(setup))
            return { error: `Instalador não encontrado: ${setup}` };
        const waiter = launchElevated(setup);
        if ('error' in waiter) {
            this.be.openPath(path.dirname(setup));
            return { error: waiter.error + " — abri a pasta; rode o setup por lá e depois clique em 'Procurar instalação agora'." };
        }
        this.store.patchLib(key, { repack_state: 'installing' });
        this.be.act(`Instalando ${info.title} (setup aberto)…`);
        void (async () => {
            const t0 = now();
            const before = this.snapshotProgramDirs();
            const elapsed = await this.waitSetup(waiter, null, t0, String(info.title || ''));
            this.be.act('');
            const found = this.findRepackInstall(info, before, t0);
            if (found) {
                const real = this.repackFound(key, info, found);
                this.be.push({ type: 'done', key, title: info.title || '', kind: 'repack', exes: real.slice(0, 8), dir: found });
                this.be.notify('info', `${info.title} instalado`, `Encontrado em ${found}`, key);
            }
            else if (elapsed < 90) {
                this.store.patchLib(key, { repack_state: 'pending' });
                this.be.notify('repack', `${info.title}: instalação não concluída`, 'O instalador fechou antes de terminar. Clique em Instalar para tentar de novo.', key);
            }
            else {
                this.store.patchLib(key, { repack_state: 'pending' });
                this.be.notify('repack', `${info.title}: não achei a pasta instalada`, "O setup fechou mas não encontrei o jogo. Use 'Trocar executável…' pra apontar o .exe.", key);
            }
        })();
        return { ok: true };
    }

    runDisc(key: string, info: any, force = false): any {
        if (!WIN)
            return { error: 'Montar disco só funciona no Windows' };
        if (info.repack_state === 'installing')
            return { error: 'O instalador desse disco já está aberto' };
        const dp = info.disc || {};
        const img = String(dp.image || info.repack || '');
        if (!img || !fs.existsSync(img))
            return { error: `Imagem do disco não encontrada: ${img}` };
        const ext = path.extname(img).toLowerCase();
        if (['.mdf', '.nrg', '.ccd'].includes(ext))
            return { needs_tool: true, tool_only: true, image: img, message: `Imagem ${ext.toUpperCase().replace(/^\./, '')}: o Windows não monta esse formato sozinho. O WinCDEmu monta — depois abra o instalador pelo disco montado.` };
        if (dp.audio && !force)
            return { needs_tool: true, image: img, message: 'Este disco tem faixas de áudio além dos dados. O Windows só monta a parte de dados; se o jogo pedir o CD com música, use o WinCDEmu.' };
        const title = String(info.title || '');
        this.store.patchLib(key, { repack_state: 'installing' });
        void (async () => {
            let iso = img;
            let mounted: string | null = null;
            try {
                if (dp.convert || ext !== '.iso') {
                    const pr = path.parse(img);
                    iso = path.join(pr.dir, pr.name + '.ludrix.iso');
                    if (!fs.existsSync(iso)) {
                        this.be.act(`Convertendo disco de ${title}…`);
                        const cb = (f: number) => this.be.act(`Convertendo disco de ${title}… ${Math.floor(f * 100)}%`);
                        if (ext === '.cue')
                            await disc.cueToIso(img, iso, cb);
                        else {
                            const cue = path.join(pr.dir, pr.name + '.cue');
                            if (fs.existsSync(cue))
                                await disc.cueToIso(cue, iso, cb);
                            else
                                throw new Error('Esse .bin não tem .cue junto; não sei o formato das faixas');
                        }
                    }
                }
                this.be.act(`Montando disco de ${title}…`);
                mounted = await disc.mount(iso);
                const setup = disc.autorunTarget(mounted);
                if (!setup)
                    throw new Error(`Nenhum instalador no disco (${mounted})`);
                const before = this.snapshotProgramDirs();
                const t0 = now();
                const waiter = launchElevated(setup);
                if ('error' in waiter)
                    throw new Error(waiter.error);
                this.be.act(`Instalando ${title} (instalador aberto)…`);
                const elapsed = await this.waitSetup(waiter, mounted, t0, title);
                await sleep(2000);
                this.be.act('');
                const found = this.findRepackInstall(info, before, t0);
                if (found) {
                    const real = this.repackFound(key, info, found);
                    this.be.push({ type: 'done', key, title, kind: 'repack', exes: real.slice(0, 8), dir: found });
                    this.be.notify('info', `${title} instalado`, `Encontrado em ${found}`, key);
                }
                else {
                    this.store.patchLib(key, { repack_state: 'pending' });
                    if (elapsed < 90)
                        this.be.notify('repack', `${title}: instalação não concluída`, 'O instalador fechou antes de terminar (ou foi fechado). O disco foi desmontado; clique em Instalar para tentar de novo.', key);
                    else
                        this.be.notify('repack', `${title}: não achei a pasta instalada`, "O instalador fechou mas não encontrei o jogo. Se ele instalou, use 'Já instalei' e aponte o .exe; senão clique em Instalar para tentar de novo.", key);
                }
            }
            catch (ex: any) {
                this.be.act('');
                this.store.patchLib(key, { repack_state: 'pending' });
                const msg = String(ex?.message || ex).slice(0, 200);
                this.be.notify('error', `${title}: disco`, msg, key);
                this.be.push({ type: 'error', key, title, message: msg });
            }
            finally {
                if (mounted !== null)
                    await disc.unmount(iso);
            }
        })();
        return { ok: true, disc: true };
    }

    tool() {
        return { url: disc.WINCDEMU_URL, name: 'WinCDEmu' };
    }

    async waitSetup(waiter: Waiter, drive: string | null, t0: number, title: string): Promise<number> {
        await waiter.wait();
        if (!WIN)
            return now() - t0;
        const tick = (alive: any[]) => {
            const names = Array.from(new Set(alive.map((p) => String(p.Name || '')))).sort().slice(0, 2);
            this.be.act(names.length ? `Instalando ${title}… (${names.join(', ')})` : `Instalando ${title}…`);
        };
        return disc.waitInstall(waiter.pid, drive, t0, tick);
    }

    finish(key: string): any {
        const info = this.store.lib(key);
        if (!info || !info.repack)
            return { error: 'Esse item não é um repack pendente' };
        const found = this.findRepackInstall(info, {}, 0);
        if (!found)
            return { error: "Pasta instalada não encontrada. Use 'Já instalei' e aponte o .exe." };
        this.repackFound(key, info, found);
        return { ok: true, dir: found };
    }

    repackFound(key: string, info: any, found: string): string[] {
        const exes: string[] = this.be.findExecutables(found, String(info.title || ''));
        const real = exes.filter((x) => !path.basename(x).toLowerCase().includes('unins'));
        this.store.patchLib(key, { dir: found, exe: real.length ? real[0] : '', repack_state: 'done' });
        if (this.store.config.auto_metadata)
            this.be.queueMeta(key);
        return real;
    }

    snapshotProgramDirs(): Record<string, number> {
        const out: Record<string, number> = {};
        for (const r of this.repackRoots()) {
            try {
                for (const e of fs.readdirSync(r, { withFileTypes: true })) {
                    if (!e.isDirectory())
                        continue;
                    const d = path.join(r, e.name);
                    try {
                        out[d] = fs.statSync(d).mtimeMs / 1000;
                    }
                    catch { }
                }
            }
            catch { }
        }
        return out;
    }

    repackRoots(): string[] {
        const roots: string[] = [P.GAMES];
        const gd = this.store.config.games_dir;
        if (gd)
            roots.push(String(gd));
        if (WIN) {
            for (const env of ['ProgramFiles', 'ProgramFiles(x86)']) {
                const v = process.env[env];
                if (v)
                    roots.push(v);
            }
            for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
                for (const sub of ['Games', 'Jogos', 'Program Files', 'Program Files (x86)']) {
                    const p = path.join(`${letter}:\\`, sub);
                    if (fs.existsSync(p))
                        roots.push(p);
                }
            }
        }
        return Array.from(new Set(roots));
    }

    findRepackInstall(info: any, before: Record<string, number>, t0: number): string | null {
        const title = String(info.title || '');
        const words = (title.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2);
        let best: string | null = null, bestScore = 0;
        let own = '';
        try {
            own = info.dir ? fs.realpathSync(String(info.dir)) : '';
        }
        catch {
            own = String(info.dir || '');
        }
        for (const r of this.repackRoots()) {
            let subs: string[];
            try {
                subs = fs.readdirSync(r, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(r, e.name));
            }
            catch {
                continue;
            }
            for (const d of subs) {
                let st: fs.Stats;
                try {
                    st = fs.statSync(d);
                }
                catch {
                    continue;
                }
                const isNew = !(d in before) || st.mtimeMs / 1000 >= t0 - 5;
                if (!isNew)
                    continue;
                let rd = d;
                try {
                    rd = fs.realpathSync(d);
                }
                catch { }
                if (own && rd === own)
                    continue;
                const n = path.basename(d).toLowerCase();
                const hits = words.filter((w) => n.includes(w)).length;
                if (!hits)
                    continue;
                if (!hasExe(d))
                    continue;
                const score = hits * 10 + (d in before ? 0 : 5);
                if (score > bestScore) {
                    best = d;
                    bestScore = score;
                }
            }
        }
        return best;
    }
}

function hasExe(dir: string): boolean {
    const stack = [dir];
    while (stack.length) {
        const d = stack.pop() as string;
        let ents: fs.Dirent[];
        try {
            ents = fs.readdirSync(d, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const e of ents) {
            if (e.isFile() && e.name.toLowerCase().endsWith('.exe'))
                return true;
            if (e.isDirectory())
                stack.push(path.join(d, e.name));
        }
    }
    return false;
}
