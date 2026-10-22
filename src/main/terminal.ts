import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cp from 'node:child_process';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import * as P from './paths';
import { humanSize } from './installer';
import { DEFAULT_CONFIG } from './store';

const WIN = process.platform === 'win32';

type Arg = [string, string, boolean];
interface Cmd { name: string; help: string; fn: (t: Terminal, a: string[]) => any; args: Arg[]; examples: string[]; group: string; aliases: string[]; danger: boolean; hidden: boolean }

const COMMANDS: Record<string, Cmd> = {};

function cmd(name: string, help: string, fn: (t: Terminal, a: string[]) => any, o: { args?: Arg[]; examples?: string[]; group?: string; aliases?: string[]; danger?: boolean; hidden?: boolean } = {}) {
    const c: Cmd = { name, help, fn, args: o.args || [], examples: o.examples || [], group: o.group || 'launcher', aliases: o.aliases || [], danger: Boolean(o.danger), hidden: Boolean(o.hidden) };
    COMMANDS[name] = c;
    for (const a of c.aliases)
        COMMANDS[a] = c;
}

function usage(c: Cmd, problem = '') {
    const syn = '/' + c.name + c.args.map((a) => (a[2] ? ` <${a[0]}>` : ` [${a[0]}]`)).join('');
    const lines: string[] = [];
    if (problem)
        lines.push(`Erro: ${problem}`);
    lines.push(`Uso: ${syn}`);
    lines.push(`  ${c.help}`);
    if (c.args.length) {
        lines.push('');
        lines.push('Argumentos:');
        const w = Math.max(...c.args.map((a) => a[0].length));
        for (const a of c.args)
            lines.push(`  ${a[0].padEnd(w)}   ${a[1]}${a[2] ? '' : '  (opcional)'}`);
    }
    if (c.examples.length) {
        lines.push('');
        lines.push('Exemplos:');
        for (const e of c.examples)
            lines.push(`  ${e}`);
    }
    if (c.aliases.length) {
        lines.push('');
        lines.push('Também: ' + c.aliases.map((a) => '/' + a).join(', '));
    }
    return { ok: !problem, usage: true, text: lines.join('\n') };
}

function human(n: number): string {
    n = Number(n || 0);
    for (const u of ['B', 'KB', 'MB', 'GB', 'TB']) {
        if (n < 1024)
            return u !== 'B' ? `${n.toFixed(1)} ${u}` : `${Math.trunc(n)} B`;
        n /= 1024;
    }
    return `${n.toFixed(1)} PB`;
}

function shlexSplit(s: string): string[] {
    const out: string[] = [];
    let cur = '';
    let has = false;
    let q: string | null = null;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (q) {
            if (ch === q) {
                q = null;
            }
            else if (q === '"' && ch === '\\' && i + 1 < s.length && '"\\$`\n'.includes(s[i + 1])) {
                cur += s[++i];
            }
            else
                cur += ch;
            continue;
        }
        if (ch === '"' || ch === "'") {
            q = ch;
            has = true;
            continue;
        }
        if (ch === '\\' && i + 1 < s.length) {
            cur += s[++i];
            has = true;
            continue;
        }
        if (/\s/.test(ch)) {
            if (has || cur) {
                out.push(cur);
                cur = '';
                has = false;
            }
            continue;
        }
        cur += ch;
        has = true;
    }
    if (q)
        throw new Error('No closing quotation');
    if (has || cur)
        out.push(cur);
    return out;
}

function ratio(a: string, b: string): number {
    if (!a.length && !b.length)
        return 1;
    const matches = (al: number, ah: number, bl: number, bh: number): number => {
        let bi = 0, bj = 0, bk = 0;
        for (let i = al; i < ah; i++) {
            for (let j = bl; j < bh; j++) {
                let k = 0;
                while (i + k < ah && j + k < bh && a[i + k] === b[j + k])
                    k++;
                if (k > bk) {
                    bi = i;
                    bj = j;
                    bk = k;
                }
            }
        }
        if (!bk)
            return 0;
        return bk + matches(al, bi, bl, bj) + matches(bi + bk, ah, bj + bk, bh);
    };
    return (2 * matches(0, a.length, 0, b.length)) / (a.length + b.length);
}

export function closeMatches(word: string, poss: string[], n = 3, cutoff = 0.6): string[] {
    const scored = poss.map((p) => [ratio(word, p), p] as [number, string]).filter(([r]) => r >= cutoff);
    scored.sort((x, y) => y[0] - x[0]);
    return scored.slice(0, n).map(([, p]) => p);
}

function list2cmdline(seq: string[]): string {
    const out: string[] = [];
    for (const arg of seq) {
        let bs = 0;
        let cur = '';
        const needq = !arg.length || /[ \t]/.test(arg);
        if (needq)
            cur += '"';
        for (const c of arg) {
            if (c === '\\')
                bs++;
            else if (c === '"') {
                cur += '\\'.repeat(bs * 2 + 1) + '"';
                bs = 0;
            }
            else {
                cur += '\\'.repeat(bs) + c;
                bs = 0;
            }
        }
        cur += '\\'.repeat(bs);
        if (needq)
            cur += '\\'.repeat(bs) + '"';
        out.push(cur);
    }
    return out.join(' ');
}

function fmtTime(ts: number, withYear = false) {
    const d = new Date(ts * 1000);
    const p = (n: number) => String(n).padStart(2, '0');
    return withYear ? `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}` : `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const jd = (v: any) => JSON.stringify(v === undefined ? null : v);

export class Terminal {
    n: any;
    history: string[] = [];
    started = Date.now() / 1000;

    constructor(be: any) {
        this.n = be;
    }

    get front() {
        return require('./server2').frontFor(this.n);
    }

    async run(line: string, _source = 'terminal'): Promise<any> {
        line = String(line || '').trim();
        if (!line)
            return { ok: true, text: '' };
        if (!line.startsWith('/')) {
            const guess = this.closest(line.split(/\s+/)[0]);
            return { ok: false, text: guess ? `Comandos começam com "/". Você quis dizer /${guess}?  ( /help lista tudo )` : 'Comandos começam com "/".  Ex.: /help' };
        }
        let parts: string[];
        try {
            parts = shlexSplit(line.slice(1));
        }
        catch {
            parts = line.slice(1).split(/\s+/).filter(Boolean);
        }
        if (!parts.length)
            return { ok: false, text: 'Digite um comando depois da barra. Ex.: /help' };
        const name = parts[0].toLowerCase(), args = parts.slice(1);
        const c = COMMANDS[name];
        if (!c) {
            const guess = this.closest(name);
            return { ok: false, text: `Comando desconhecido: /${name}` + (guess ? `\nVocê quis dizer: /${guess}` : '') + '\nUse /help pra ver a lista.' };
        }
        const req = c.args.filter((a) => a[2]);
        if (args.length < req.length)
            return usage(c, `faltou o argumento <${req[args.length][0]}>`);
        this.history.push(line);
        this.history = this.history.slice(-200);
        let r: any;
        try {
            r = await c.fn(this, args);
        }
        catch (e: any) {
            const msg = String(e?.message || e);
            if (e?.code === 'EACCES' || e?.code === 'EPERM')
                return { ok: false, text: `Sem permissão: ${msg}` };
            return { ok: false, text: `Falhou: ${msg}` };
        }
        if (typeof r === 'string')
            return { ok: true, text: r };
        r = { ...(r || {}) };
        if (!('ok' in r))
            r.ok = true;
        if (!('text' in r))
            r.text = '';
        return r;
    }

    closest(name: string): string {
        const m = closeMatches(name.toLowerCase(), Object.entries(COMMANDS).filter(([, c]) => !c.hidden).map(([k]) => k), 1, 0.6);
        return m.length ? m[0] : '';
    }

    catalog() {
        const seen = new Set<string>();
        const out: any[] = [];
        for (const c of Object.values(COMMANDS)) {
            if (seen.has(c.name) || c.hidden)
                continue;
            seen.add(c.name);
            out.push({ name: c.name, help: c.help, args: c.args, examples: c.examples, group: c.group, aliases: c.aliases, danger: c.danger });
        }
        out.sort((a, b) => (a.group < b.group ? -1 : a.group > b.group ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        return out;
    }

    game(q: string): any | null {
        q = q.trim().toLowerCase();
        const lib = this.n.store.library;
        if (q in lib)
            return { key: q, ...lib[q] };
        let best: any = null;
        for (const [k, info] of Object.entries<any>(lib)) {
            const t = String(info.title || k).toLowerCase();
            if (t === q)
                return { key: k, ...info };
            if (t.includes(q) && (best === null || t.length < String(best.title || '').length))
                best = { key: k, ...info };
        }
        if (best)
            return best;
        for (const e of this.n.cat.entries.values()) {
            const t = String(e.title).toLowerCase();
            if (q === t || t.includes(q))
                return { key: e.key, title: e.title, installed: false };
        }
        return null;
    }

    open(target: string) {
        if (WIN)
            cp.spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        else if (process.platform === 'darwin')
            cp.spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
        else
            cp.spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
    }

    winOnly() {
        if (!WIN)
            throw new Error('esse comando só funciona no Windows');
    }

    version(): string {
        return String(this.front.updateStatus().current?.version || '?');
    }
}

cmd('help', 'Lista os comandos (ou explica um: /help <comando>)', (t, a) => {
    if (a.length) {
        const q = a[0].replace(/^\/+/, '').toLowerCase();
        const c = COMMANDS[q];
        if (c)
            return usage(c);
        const grp = t.catalog().filter((x) => x.group === q);
        if (grp.length)
            return grp.map((x) => `/${x.name.padEnd(18)} ${x.help}`).join('\n');
        return { ok: false, text: `Não conheço /${q}. Grupos: ` + Array.from(new Set(t.catalog().map((x) => x.group))).sort().join(', ') };
    }
    const out = [`LudrixHub ${t.version()} — terminal. Tudo começa com /. Aspas pra nomes com espaço.`, ''];
    let cur: string | null = null;
    for (const x of t.catalog()) {
        if (x.group !== cur) {
            cur = x.group;
            out.push(`[${cur}]`);
        }
        out.push(`  /${x.name.padEnd(18)} ${x.help}`);
    }
    out.push('', 'Dica: /help <comando> mostra argumentos e exemplos.  Setas ↑↓ = histórico · Tab = completar · Ctrl+L = limpar');
    return out.join('\n');
}, { args: [['comando', 'nome do comando pra ver detalhes', false]], examples: ['/help', '/help play', '/help windows'], group: 'ajuda', aliases: ['?', 'h'] });

cmd('clear', 'Limpa a tela do terminal', () => ({ ui: { clear: true } }), { group: 'ajuda', aliases: ['cls'] });

cmd('version', 'Versão do Ludrix, do Python e do sistema', (t) => {
    const sysName = WIN ? 'Windows' : process.platform === 'darwin' ? 'Darwin' : 'Linux';
    return `LudrixHub ${t.version()} (${P.FROZEN ? 'compilado' : 'código-fonte'})\nElectron ${process.versions.electron || '?'} · Node ${process.versions.node} · ${sysName} ${os.release()} (${os.arch()})\nPasta: ${P.ROOT}\nAberto há ${Math.floor((Date.now() / 1000 - t.started) / 60)} min`;
}, { group: 'ajuda', aliases: ['ver', 'about'] });

cmd('checkupdates', 'Procura atualização no feed e na pasta data\\updates', async (t) => {
    const r = await t.front.updateCheck();
    if (r.error)
        return { ok: false, text: r.error };
    const st = t.front.updateStatus();
    const av = r.available || st.available;
    const rem = r.remote || st.remote;
    const cur = st.current?.version;
    if (av)
        return `Pronta pra instalar: ${av.title || av.version} (você está na ${cur}).\nInstale com /installupdate ou em Ajustes → Atualizações.`;
    if (rem)
        return `Nova versão disponível pra baixar: ${rem.version} (você está na ${cur}). Use /downloadupdate.`;
    return `Nenhuma atualização. Você está na ${cur}.`;
}, { examples: ['/checkupdates'], aliases: ['update', 'checkupdate'] });

cmd('downloadupdate', 'Baixa a atualização encontrada por /checkupdates', (t) => {
    const r = t.front.updateDownload();
    return { ok: !r.error, text: r.error || 'Baixando… acompanhe em Fila.' };
});

cmd('installupdate', 'Instala a atualização já baixada e reabre o Ludrix', (t) => {
    const r = t.front.updateApply(true);
    return { ok: !r.error, text: r.error || 'Fechando pra aplicar a atualização…' };
}, { danger: true });

cmd('changelog', 'Mostra as novidades da versão instalada (ou de um pacote .lxup em updates/)', (t, a) => {
    const want = a.length ? a[0] : null;
    const cur = t.front.updateStatus().current || {};
    if (!want || want === cur.version) {
        let txt = String(cur.changelog || '');
        if (!txt) {
            const p = path.join(P.ROOT, 'CHANGELOG.md');
            if (fs.existsSync(p)) {
                const esc = String(cur.version || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const m = new RegExp(`^## +${esc}\\b[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(fs.readFileSync(p, 'utf8'));
                txt = m ? m[1].trim() : '';
            }
        }
        return txt ? `Novidades da ${cur.version}:\n\n${txt}` : `Sem changelog gravado pra ${cur.version}.`;
    }
    let files: string[] = [];
    try {
        files = fs.readdirSync(P.UPDATES).filter((f) => f.endsWith('.lxup')).sort();
    }
    catch { /* ignore */ }
    for (const f of files) {
        try {
            const m = JSON.parse(new AdmZip(path.join(P.UPDATES, f)).readAsText('manifest.json'));
            if (m.version === want)
                return `Novidades da ${want} (${f}):\n\n${m.changelog || ''}`;
        }
        catch {
            continue;
        }
    }
    return { ok: false, text: `Versão ${want} não encontrada, nem em updates/.` };
}, { args: [['versão', 'número, ex.: 4.0.0', false]], examples: ['/changelog', '/changelog 1.0.0'] });

cmd('debuglaunch', 'Mostra exatamente como o Ludrix abriria um jogo (comando, pasta, emulador) sem abrir', async (t, a) => {
    const g = t.game(a.join(' '));
    if (!g)
        return { ok: false, text: 'Jogo não encontrado. Tente um pedaço maior do nome ou /find <termo>.' };
    const key = g.key;
    const info = t.n.store.lib(key) || {};
    const out = [`Jogo: ${g.title}  [${key}]`];
    if (!Object.keys(info).length)
        return [...out, 'Não está instalado — nada pra lançar. (Está no catálogo de uma fonte.)'].join('\n');
    out.push(`Tipo: ${info.kind || 'pc'}   Pasta: ${info.dir || ''}`);
    if (info.kind === 'rom' && info.system) {
        const sid = info.system;
        const opts = t.n.emu.installedOptions(sid);
        const remembered = (t.n.store.config.game_emulator || {})[key];
        const dflt = t.n.emu.emulatorFor(sid);
        out.push(`Sistema: ${sid}   Emuladores instalados: ${opts.map((o: any) => o.id).join(', ') || 'nenhum'}   Padrão: ${dflt}` + (remembered ? `   Lembrado pra este jogo: ${remembered}` : ''));
        const lr = await t.n.emu.launchRom(info.exe, sid, remembered || null);
        if (lr.error)
            out.push(`ERRO: ${lr.message || lr.error}`);
        else {
            out.push('Comando: ' + list2cmdline([...lr.cmd, ...t.n.splitArgs(t.n.gameArgs(key))]));
            out.push(`Pasta de trabalho: ${lr.cwd}`);
            if (lr.hint)
                out.push('Aviso: ' + lr.hint);
        }
    }
    else {
        const exe = String(info.exe || '');
        out.push(`Executável: ${exe}   existe: ${exe && fs.existsSync(exe) ? 'sim' : 'NÃO'}`);
        out.push('Argumentos extras: ' + (t.n.gameArgs(key) || '(nenhum)'));
        out.push('Comando: ' + list2cmdline([exe, ...t.n.splitArgs(t.n.gameArgs(key))]));
    }
    out.push(`Modo Game automático: ${t.n.store.config.game_mode_auto ? 'sim' : 'não'}   Depois de abrir: ${t.n.store.config.after_launch || 'ask'}`);
    return out.join('\n');
}, { args: [['jogo', 'pedaço do nome ou chave', true]], examples: ['/debuglaunch "need for speed"', '/debuglaunch rom:ps2:Shadow'] });

cmd('play', 'Abre um jogo', async (t, a) => {
    const all = t.n.emu.allEmulators();
    const last = a[a.length - 1];
    let g = a.length === 1 || last in all ? t.game(a[0]) : t.game(a.join(' '));
    const emu = a.length > 1 && last in all ? last : null;
    if (!g && a.length > 1)
        g = t.game((emu ? a.slice(0, -1) : a).join(' '));
    if (!g)
        return { ok: false, text: 'Jogo não encontrado. /find <termo> ajuda a achar a chave.' };
    const r = await t.n.play(g.key, 'none', emu, null);
    if (r.choose_emulator)
        return `${g.title} tem mais de um emulador: ` + r.choose_emulator.map((o: any) => o.id).join(', ') + `\nUse: /play "${g.title}" <emulador>`;
    if (r.error)
        return { ok: false, text: r.message || r.error };
    return `Abrindo ${g.title}…` + (r.hint ? `  (${r.hint})` : '');
}, { args: [['jogo', 'pedaço do nome ou chave', true], ['emulador', 'id do emulador (só ROMs)', false]], examples: ['/play "gta san andreas"', '/play zelda melonds'], aliases: ['run', 'launch'] });

cmd('stop', 'Fecha um jogo aberto pelo Ludrix', (t, a) => {
    const act: string[] = t.n.sessions.keys();
    if (!act.length)
        return 'Nenhum jogo aberto pelo Ludrix agora.';
    let keys: string[];
    if (!a.length)
        keys = act;
    else {
        const g = t.game(a.join(' '));
        keys = g && act.includes(g.key) ? [g.key] : [];
    }
    if (!keys.length)
        return { ok: false, text: 'Esse jogo não está aberto. Abertos: ' + act.join(', ') };
    for (const k of keys)
        t.n.stopGame(k);
    return 'Fechando: ' + keys.join(', ');
}, { args: [['jogo', 'pedaço do nome (vazio = todos)', false]], examples: ['/stop', '/stop "pes 2013"'], aliases: ['kill'] });

cmd('find', 'Procura jogos na biblioteca e no catálogo', (t, a) => {
    const q = a.join(' ').toLowerCase();
    const libAll = t.n.store.library;
    const lib = Object.entries<any>(libAll).filter(([k, i]) => String(i.title || k).toLowerCase().includes(q));
    const cat = Array.from(t.n.cat.entries.values()).filter((e: any) => String(e.title).toLowerCase().includes(q) && !(e.key in libAll));
    const out: string[] = [];
    if (lib.length) {
        out.push(`Na biblioteca (${lib.length}):`);
        out.push(...lib.slice(0, 25).map(([k, i]) => `  ${String(i.title || k).padEnd(50)} ${k}`));
    }
    if (cat.length) {
        out.push(`Nas fontes (${cat.length}):`);
        out.push(...cat.slice(0, 25).map((e: any) => `  ${String(e.title).padEnd(50)} ${e.key}`));
    }
    return out.join('\n') || 'Nada com esse nome.';
}, { args: [['termo', 'pedaço do nome', true]], examples: ['/find zelda'], aliases: ['search'] });

cmd('library', 'Resumo da biblioteca: quantos jogos, tempo total, últimos jogados', (t) => {
    const lib = Object.entries<any>(t.n.store.library);
    const total = lib.reduce((s, [, i]) => s + Number(i.playtime || 0), 0);
    const roms = lib.filter(([, i]) => i.kind === 'rom').length;
    const recent = lib.map(([k, i]) => [Number(i.last_played || 0), String(i.title || k)] as [number, string]).sort((x, y) => y[0] - x[0] || (y[1] < x[1] ? -1 : 1)).slice(0, 5);
    const top = lib.map(([k, i]) => [Number(i.playtime || 0), String(i.title || k)] as [number, string]).sort((x, y) => y[0] - x[0] || (y[1] < x[1] ? -1 : 1)).slice(0, 5);
    const out = [`${lib.length} jogos (${roms} ROMs, ${lib.length - roms} PC) · ${(total / 3600).toFixed(1)} h jogadas · ${t.n.cat.entries.size} no catálogo das fontes`];
    if (recent.length && recent[0][0])
        out.push('Últimos: ' + recent.filter(([ts]) => ts).map(([, nm]) => nm).join(', '));
    if (top.length && top[0][0])
        out.push('Mais jogados: ' + top.filter(([p]) => p).map(([p, nm]) => `${nm} (${(p / 3600).toFixed(1)} h)`).join(', '));
    return out.join('\n');
}, { aliases: ['lib', 'stats'] });

cmd('check', 'Verifica a biblioteca: arquivos sumidos, pastas de trabalho e emuladores faltando', (t) => {
    const r = t.n.libraryCheck();
    const items: any[] = r.items || [];
    const emus: any[] = r.emus || [];
    const out = [`${r.total} jogos conferidos · ${items.length} com problema · ${emus.length} console(s) sem emulador`];
    for (const i of items.slice(0, 40))
        out.push(`  !! ${i.title}: ${i.problem} — ${i.path}`);
    for (const e of emus)
        out.push(`  !! ${e.name}: ${e.count} ROM(s) na biblioteca, emulador ${e.emulator || '?'} não instalado`);
    if (items.length > 40)
        out.push(`  … e mais ${items.length - 40}`);
    if (r.dupes && (Array.isArray(r.dupes) ? r.dupes.length : r.dupes))
        out.push(`  ${Array.isArray(r.dupes) ? r.dupes.length : r.dupes} grupo(s) com entradas repetidas — /dupes mostra`);
    return out.join('\n');
}, { aliases: ['verify', 'verificar'] });

cmd('origin', 'Jogos por origem (Steam, Epic, GOG, Playnite, ROM, manual)', (t) => {
    const cnt: Record<string, number> = {};
    for (const i of Object.values<any>(t.n.store.library)) {
        const o = i.store_src || (i.kind === 'rom' ? 'ROM' : i.source === 'playnite' ? 'Playnite' : 'Manual');
        cnt[o] = (cnt[o] || 0) + 1;
    }
    const rows = Object.entries(cnt);
    if (!rows.length)
        return 'Biblioteca vazia.';
    return rows.sort((x, y) => y[1] - x[1]).map(([o, n]) => `${String(n).padStart(4)}  ${o}`).join('\n');
}, { aliases: ['origins', 'sources_lib'] });

cmd('recent', 'Últimas sessões: jogo, quando e quanto tempo', (t, a) => {
    const n = a.length && /^\d+$/.test(a[0]) ? parseInt(a[0], 10) : 10;
    const rows = Object.entries<any>(t.n.store.library).filter(([, i]) => i.last_played)
        .map(([k, i]) => [Number(i.last_played || 0), String(i.title || k), Number(i.last_session || 0), Number(i.play_count || 0)] as [number, string, number, number])
        .sort((x, y) => y[0] - x[0]).slice(0, n);
    if (!rows.length)
        return 'Nenhuma sessão registrada.';
    return rows.map(([ts, title, sess, pc]) => `${fmtTime(ts)}  ${title}  (${Math.round(sess / 60)} min na última · ${pc}x)`).join('\n');
}, { args: [['n', 'quantas (padrão 10)', false]], aliases: ['sessions'] });

cmd('size', 'Tamanho da pasta de um jogo', async (t, a) => {
    const g = t.game(a.join(' '));
    if (!g)
        return 'Jogo não encontrado. /find <termo> ajuda a achar a chave.';
    const r = await t.n.folderSize(g.key);
    if (r.error)
        return r.error;
    const mb = Number(r.size || 0) / 2 ** 20;
    const size = mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
    return `${g.title}: ${size}` + (r.files ? ` · ${r.files} arquivos` : '') + (r.partial ? ' (parcial)' : '');
}, { args: [['jogo', 'pedaço do nome ou chave', true]], aliases: ['tamanho'] });

cmd('played', 'Marca um jogo como jogado hoje (ou /played <jogo> off para nunca jogado)', (t, a) => {
    const off = a.length > 0 && ['off', 'nao', 'não', 'false'].includes(a[a.length - 1].toLowerCase());
    const g = t.game((off ? a.slice(0, -1) : a).join(' '));
    if (!g)
        return 'Jogo não encontrado. /find <termo> ajuda a achar a chave.';
    const r = t.n.markPlayed(g.key, !off);
    return r.ok ? (off ? `${g.title}: marcado como nunca jogado` : `${g.title}: marcado como jogado hoje`) : (r.error || 'falhou');
}, { args: [['jogo', 'pedaço do nome ou chave', true], ['off', 'desmarca', false]], aliases: ['jogado'] });

cmd('undo', 'Desfaz a última remoção da biblioteca (até 10 minutos)', (t) => {
    const r = t.n.undoRemove();
    return r.ok ? `${r.title || r.key} de volta à biblioteca` : (r.error || 'falhou');
}, { aliases: ['desfazer'] });

cmd('fav', 'Marca ou desmarca um jogo como favorito', (t, a) => {
    const g = t.game(a.join(' '));
    if (!g)
        return 'Jogo não encontrado. /find <termo> ajuda a achar a chave.';
    const r = t.n.toggleFavorite(g.key);
    return `${g.title}: ${r.fav ? 'favorito' : 'não é mais favorito'}`;
}, { args: [['jogo', 'pedaço do nome ou chave', true]], aliases: ['favorito', 'favorite'] });

cmd('backups', 'Cópias da biblioteca: lista, /backups now cria uma agora, /backups restore <arquivo> devolve jogos que sumiram', (t, a) => {
    if (a[0] === 'now') {
        const r = t.n.libraryBackup();
        return r.ok ? `Cópia criada: ${r.file} (${r.games} jogos)` : (r.error || 'falhou');
    }
    if (a[0] === 'restore') {
        if (a.length < 2)
            return 'Uso: /backups restore <arquivo>';
        const r = t.n.libraryRestore(a[1]);
        return r.ok ? `${r.added} jogo(s) devolvido(s) de ${r.total}` : (r.error || 'falhou');
    }
    const bs: any[] = t.n.libraryBackups();
    if (!bs.length)
        return 'Nenhuma cópia ainda. A primeira é feita ao abrir o launcher.';
    return bs.map((b) => `${fmtTime(b.mtime, true)}  ${String(b.games).padStart(4)} jogos  ${b.file}`).join('\n');
}, { args: [['acao', 'now | restore', false], ['arquivo', 'nome do arquivo (restore)', false]], aliases: ['backup'] });

cmd('dupes', 'Jogos duplicados na biblioteca (mesmo nome ou mesmo executável)', (t) => {
    const raw = t.n.libraryDupes();
    const gs: any[][] = Array.isArray(raw) ? raw : (raw.dupes || raw.groups || []);
    if (!gs.length)
        return 'Nenhum duplicado.';
    const out = [`${gs.length} grupo(s) com duplicados`];
    for (const g of gs.slice(0, 30)) {
        out.push('  ' + g[0].title);
        for (const i of g)
            out.push(`     ${i.exists ? 'ok ' : '!! '}${i.key}  ${i.exe || '-'}`);
    }
    return out.join('\n');
}, { aliases: ['duplicados', 'duplicates'] });

cmd('config', 'Lê ou altera uma configuração do Ludrix', (t, a) => {
    const cfg = t.n.store.config;
    const hidden = new Set(['sgdb_key', 'notifications', 'flash_stats', 'title_overrides', 'game_args']);
    const DC: any = DEFAULT_CONFIG;
    if (!a.length) {
        const keys = Object.keys(DC).filter((k) => !hidden.has(k)).sort();
        return keys.map((k) => `${k.padEnd(24)} = ${jd(cfg[k]).slice(0, 60)}`).join('\n');
    }
    const k = a[0];
    if (!(k in DC)) {
        const m = closeMatches(k, Object.keys(DC), 3, 0.5);
        return { ok: false, text: `Não existe a configuração "${k}".` + (m.length ? ` Parecidas: ${m.join(', ')}` : '') };
    }
    if (a.length === 1)
        return `${k} = ${jd(hidden.has(k) ? '***' : cfg[k])}`;
    const raw = a.slice(1).join(' ');
    const cur = DC[k];
    let val: any;
    const tname = typeof cur === 'boolean' ? 'bool' : typeof cur === 'number' ? (Number.isInteger(cur) ? 'int' : 'float') : Array.isArray(cur) ? 'list' : cur === null ? 'NoneType' : typeof cur === 'object' ? 'dict' : 'str';
    try {
        if (tname === 'bool')
            val = ['1', 'true', 'on', 'sim', 'yes', 'ligado'].includes(raw.trim().toLowerCase());
        else if (tname === 'int') {
            if (!/^\s*[+-]?\d+\s*$/.test(raw))
                throw new Error('int');
            val = parseInt(raw, 10);
        }
        else if (tname === 'float') {
            val = Number(raw);
            if (Number.isNaN(val) || !raw.trim())
                throw new Error('float');
        }
        else if (tname === 'list' || tname === 'dict' || tname === 'NoneType')
            val = JSON.parse(raw);
        else
            val = raw;
    }
    catch {
        return usage(COMMANDS.config, `valor inválido pra ${k} (esperado ${tname})`);
    }
    t.n.setConfig({ [k]: val });
    const need = k in t.n.RESTART_KEYS;
    return { text: `${k} = ${jd(val)}` + (need ? '   *Requer Reinicialização!' : ''), ui: { config: true } };
}, { args: [['chave', 'nome da configuração (vazio = lista todas)', false], ['valor', 'novo valor (true/false, número, texto)', false]], examples: ['/config', '/config density', '/config density compact', '/config card_size 200', '/config theme file:steam'], aliases: ['set', 'cfg'] });

cmd('theme', 'Troca a cara ou o tema (ou lista os disponíveis)', (t, a) => {
    const ths: any[] = t.n.themes();
    const FACES = t.n.FACES || { padrao: { name: 'Padrão' } };
    const curFace = t.n.currentFace ? t.n.currentFace() : (t.n.store.config.face || 'padrao');
    if (!a.length) {
        const faces = Object.entries<any>(FACES).map(([id, f]) => `${id.padEnd(28)} ${f.name}` + (id === curFace ? '   ← cara atual' : '')).join('\n');
        return faces + '\n' + ths.map((x) => `${String(x.id).padEnd(28)} ${x.name}` + (x.id === t.n.store.config.theme ? '   ← atual' : '')).join('\n');
    }
    let tid = a[0].toLowerCase();
    if (tid in FACES) {
        const patch: any = { face: tid, accent: '' };
        if (String(t.n.store.config.theme || '').startsWith('file:'))
            patch.theme = 'system';
        t.n.setConfig(patch);
        return { text: `Cara: ${FACES[tid].name}`, ui: { config: true } };
    }
    if (['system', 'dark', 'light'].includes(tid)) {
        t.n.setConfig({ theme: tid });
        return { text: `Tema: ${tid} (${(FACES[curFace] || FACES.padrao).name})`, ui: { config: true } };
    }
    if (!ths.some((x) => x.id === tid)) {
        const cand = ths.filter((x) => String(x.id).toLowerCase().includes(tid) || String(x.name).toLowerCase().includes(tid));
        if (cand.length === 1)
            tid = cand[0].id;
        else
            return { ok: false, text: 'Tema não encontrado.' + (cand.length ? ' Parecidos: ' + cand.slice(0, 6).map((x) => x.id).join(', ') : '') };
    }
    t.n.setConfig({ theme: tid, accent: '' });
    return { text: `Tema: ${tid}`, ui: { config: true } };
}, { args: [['id', 'cara (grafite, aurora, ember, neon, duo, mono), system/dark/light ou file:<pasta>', false]], examples: ['/theme', '/theme aurora', '/theme light', '/theme file:steam'] });

cmd('restart', 'Reabre o Ludrix', (t) => {
    const r = t.n.restartApp();
    return { ok: !r.error, text: r.error || 'Reabrindo…' };
}, { danger: true, aliases: ['reboot'] });

cmd('quit', 'Fecha o Ludrix', (t) => {
    setTimeout(() => (t.n.windowHooks?.quit || (() => process.exit(0)))(), 500);
    return 'Até mais.';
}, { danger: true, aliases: ['exit'] });

cmd('log', 'Mostra as últimas linhas do ludrix.log', (t, a) => {
    const n = a.length && /^\d+$/.test(a[0]) ? parseInt(a[0], 10) : 40;
    const flt = a.length > 1 ? a.slice(1).join(' ') : '';
    let lines: string[];
    try {
        lines = fs.readFileSync(P.LOG_FILE, 'utf8').split(/\r?\n/);
        if (lines.length && lines[lines.length - 1] === '')
            lines.pop();
    }
    catch {
        return 'Sem log ainda.';
    }
    if (flt)
        lines = lines.filter((x) => x.toLowerCase().includes(flt.toLowerCase()));
    return lines.slice(-n).join('\n') || '(vazio)';
}, { args: [['linhas', 'quantas (padrão 40)', false], ['filtro', 'só linhas com esse texto', false]], examples: ['/log', '/log 100', '/log 200 ERROR'], aliases: ['tail'] });

cmd('openfolder', 'Abre uma pasta do Ludrix no Explorer', (t, a) => {
    const m: Record<string, string> = { root: P.ROOT, data: P.DATA, games: t.n.store.gamesDir(), downloads: P.DOWNLOADS, emulation: P.EMU, themes: P.THEMES, updates: P.UPDATES, cache: P.CACHE, log: P.LOG_FILE, tools: P.TOOLS, bios: P.EMU_BIOS };
    const p = m[a[0].toLowerCase()];
    if (!p)
        return usage(COMMANDS.openfolder, `não conheço "${a[0]}"`);
    if (!fs.existsSync(p))
        return { ok: false, text: `Não existe ainda: ${p}` };
    t.open(p);
    return `Abrindo ${p}`;
}, { args: [['qual', 'root | data | games | downloads | emulation | themes | updates | cache | log', true]], examples: ['/openfolder data', '/openfolder log'], aliases: ['folder'] });

cmd('cache', 'Mostra o tamanho do cache (ou limpa: /cache clear)', (t, a) => {
    if (a.length && a[0].toLowerCase() === 'clear') {
        const r = t.n.clearCache(['web', 'thumbs']);
        return 'Cache limpo. ' + JSON.stringify(r);
    }
    const info = t.n.cacheInfo();
    return Object.entries<any>(info).map(([k, v]) => `${k.padEnd(12)} ${typeof v === 'number' ? human(v) : v}`).join('\n');
}, { args: [['clear', 'escreva clear pra limpar miniaturas/web', false]], examples: ['/cache', '/cache clear'] });

cmd('sources', 'Lista as fontes da Store (e liga/desliga: /sources on|off <id>)', (t, a) => {
    if (!a.length) {
        const rs: any[] = t.front.repoList();
        return rs.map((r) => `${r.enabled ? '●' : '○'} ${String(r.id).padEnd(28)} ${r.name || ''}  [${r.type}]`).join('\n') || 'Nenhuma fonte. Cole um link em Store → Fontes.';
    }
    const act = a[0].toLowerCase();
    if (act === 'reload') {
        t.n.reloadCatalog(true);
        return 'Recarregando catálogo…';
    }
    if ((act === 'on' || act === 'off') && a.length > 1) {
        t.front.repoToggle(a[1], act === 'on');
        return `Fonte ${a[1]}: ${act === 'on' ? 'ligada' : 'desligada'}`;
    }
    return usage(COMMANDS.sources, 'ação inválida');
}, { args: [['ação', 'on | off | reload', false], ['id', 'id da fonte', false]], examples: ['/sources', '/sources off site-ankergames', '/sources reload'], aliases: ['repos'] });

cmd('unlockludrixpro', '', (t, a) => {
    const code = a.join(' ').trim().toLowerCase();
    if (crypto.createHash('sha256').update(code, 'utf8').digest('hex') !== '230ceb43cdbcd0ed5e87395a9701bc4134ef7346ff9d8839120ca5c2d90783b1')
        return { ok: false, text: 'Código inválido.' };
    return { text: ['', '      ___', '     /   \\', '    |  o  |    A lanterna negra está acesa.', '     \\___/', '      | |', '      |_|', ''].join('\n') };
}, { args: [['código', '', true]], hidden: true, aliases: ['unlock'] });

cmd('factoryreset', 'Apaga TUDO que o Ludrix criou (config, biblioteca, caches, fontes, temas, downloads, pastas de jogos/emulação) e reabre como na primeira vez', (t, a) => {
    if (a.join(' ').trim().toUpperCase() !== 'APAGAR TUDO')
        return { ok: false, text: 'Isso apaga permanentemente configurações, biblioteca, caches, fontes, temas, downloads e as pastas games/ e emulation/.\nNão tem volta. Se tem certeza: /factoryreset APAGAR TUDO' };
    const r = t.n.factoryReset();
    return { ok: !r.error, text: r.error || 'Fechando pra apagar tudo e reabrir zerado…' };
}, { args: [['confirmar', 'escreva APAGAR TUDO pra executar', true]], examples: ['/factoryreset APAGAR TUDO'], danger: true, aliases: ['reset', 'wipe'] });

cmd('console', 'Abre o Modo Console (programa separado; esta janela fecha)', async (t) => {
    const r = t.n.consoleSwap ? await t.n.consoleSwap('console', true) : { error: 'indisponível' };
    return r.ok ? 'Abrindo o Modo Console…' : `Não abriu: ${r.error}`;
}, { examples: ['/console'] });

cmd('analyze', 'Analisa um link como a aba Fontes faz (direto / torrent / ignorados)', async (t, a) => {
    const r = await t.front.detect(a[0]);
    if (r.error && !(r.results || []).length)
        return { ok: false, text: r.error };
    if (!(r.results || []).length)
        return 'Nada aproveitável nesse link.';
    const x = r.results[0];
    const out = [`${x.title}: ${x.detail || ''}`];
    for (const g of (r.games || []).slice(0, 30))
        out.push(`  ${String(g.title).padEnd(48)} ${g.files ? 'direto ' : ''}${g.magnet || g.torrent_url ? 'torrent' : ''}`);
    return out.join('\n');
}, { args: [['url', 'endereço da página', true]], examples: ['/analyze https://site.com/jogos'] });

cmd('emulators', 'Emuladores por console (instalados e padrão)', (t, a) => {
    const st = t.n.emu.status();
    const rows: string[] = [];
    for (const [sid, s] of Object.entries<any>(st.systems || {})) {
        if (a.length && sid !== a[0])
            continue;
        const inst = (s.installed_options || []).map((o: any) => o.id + (o.default ? '*' : ''));
        rows.push(`${sid.padEnd(10)} ${String(s.name).padEnd(22)} ${inst.join(', ') || '— nenhum instalado'}   (${s.rom_count || 0} jogos)`);
    }
    return rows.join('\n') + '\n(* = padrão do console. Pra vários emuladores no mesmo console: Emular → ⚙ do console.)';
}, { args: [['console', 'id do sistema, ex.: nds', false]], examples: ['/emulators', '/emulators nds'], aliases: ['emu'] });

cmd('gamemode', 'Modo Game: /gamemode on liga agora (plano de energia, apps da lista, Ludrix quieto), /gamemode off desliga', async (t, a) => {
    const act = (a[0] || 'status').toLowerCase();
    if (act === 'on')
        return JSON.stringify(await t.n.gameModeRun());
    if (act === 'off')
        return JSON.stringify(await t.n.gameModeRestore());
    return `Modo Game ${t.n.gamemode.active ? 'ATIVO' : 'inativo'}. ` + JSON.stringify(await t.n.gameModeStatus()).slice(0, 600);
}, { args: [['on|off|status', 'ação', false]], examples: ['/gamemode on', '/gamemode status'] });

cmd('hardware', 'Resumo do PC (CPU, RAM, GPU, discos)', async (t) => {
    const hw = await t.n.hardware();
    if (hw.error)
        return { ok: false, text: hw.error };
    const gp = (hw.gpus || []).map((g: any) => g.name || '').join(', ') || '?';
    const ram = hw.ram || {};
    const cpu = hw.cpu || {}, so = hw.os || {}, scr = hw.screen || {}, tier = hw.tier || {};
    return `CPU: ${cpu.name ?? '?'} (${cpu.cores ?? '?'} núcleos)\nRAM: ${ram.total_gb ?? '?'} GB\nGPU: ${gp}\nSO: ${so.name ?? '?'}\nTela: ${scr.w ?? '?'}×${scr.h ?? '?'}\nNível: ${tier.level ?? '?'} — ${tier.hint ?? ''}`;
}, { group: 'windows', aliases: ['hw', 'specs'] });

cmd('forcebackup', 'Faz um backup completo agora (config, biblioteca, fontes, temas, capas) num .zip', (t, a) => {
    const r = t.n.backupExport(a.length ? a[0] : null);
    return { ok: !r.error, text: r.error || `Backup salvo: ${r.path} (${human(r.size)}, ${r.files} arquivos)`, path: r.path };
}, { args: [['destino', 'pasta ou arquivo .zip (padrão: updates/backup)', false]], examples: ['/forcebackup', '/forcebackup D:\\backups'], group: 'backup', aliases: ['backup'] });

cmd('exportbackup', 'Igual a /forcebackup, mas abre a pasta ao terminar', (t, a) => {
    const r = t.n.backupExport(a.length ? a[0] : null);
    if (r.error)
        return { ok: false, text: r.error };
    t.open(path.dirname(r.path));
    return `Backup salvo: ${r.path}`;
}, { args: [['destino', 'pasta ou .zip', false]], group: 'backup' });

cmd('importbackup', 'Restaura um backup .zip do Ludrix (pede confirmação; reabre no fim)', async (t, a) => {
    const r = await t.n.backupImport(a.length ? a[0] : null);
    return { ok: !r.error, text: r.error || (r.cancel ? 'Cancelado.' : `Restaurado: ${r.files} arquivos. Reabrindo o Ludrix…`) };
}, { args: [['arquivo', 'caminho do .zip (vazio = escolher)', false]], examples: ['/importbackup', '/importbackup "D:\\backups\\ludrix-backup-2026-09-06.zip"'], group: 'backup', danger: true });

cmd('listbackups', 'Lista os backups em updates/backup', () => {
    const d = path.join(P.UPDATES, 'backup');
    let fsx: string[] = [];
    try {
        fsx = fs.readdirSync(d).filter((f) => /^ludrix-backup-.*\.zip$/.test(f)).sort().reverse();
    }
    catch { /* ignore */ }
    return fsx.map((f) => `${f.padEnd(40)} ${human(fs.statSync(path.join(d, f)).size)}`).join('\n') || 'Nenhum backup ainda. /forcebackup cria um.';
}, { group: 'backup' });

cmd('terminalsettings', 'Abre as configurações do terminal (fonte, tamanho, opacidade, cor)', () => ({ ui: { terminal_settings: true }, text: '' }), { group: 'ajuda', aliases: ['tsettings'] });

cmd('download', 'Baixa um link de hospedagem (Drive, MEGA, Gofile, MediaFire, Pixeldrain, 1fichier…) e instala como jogo', async (t, a) => {
    if (!a.length)
        return 'Uso: /download <link> [nome]';
    const url = a[0], name = a.slice(1).join(' ').trim() || null;
    const p = await t.front.linkPreview(url);
    if (p.error)
        return `Não deu: ${p.error}`;
    const r = await t.front.linkDownload(url, name || p.title, 'pc', 'pc', null);
    if (r.error)
        return `Não deu: ${r.error}`;
    const files = (p.files || []).slice(0, 12).map((f: any) => `  ${f.name}  ${f.size ? humanSize(f.size) : ''}`).join('\n');
    return `${p.host} → ${name || p.title}\n${files}\nBaixando pra downloads\\ — acompanhe na Fila.`;
}, { args: [['link', 'URL do arquivo ou pasta', true], ['nome', 'nome do jogo (opcional)', false]], examples: ['/download https://gofile.io/d/abc123', '/download https://mega.nz/file/xxx#yyy "Meu Jogo"'], aliases: ['dl', 'fetch'] });

cmd('open', 'Abre um programa do Windows, uma pasta do Ludrix ou um site', (t, a) => {
    const target = a.join(' ').trim();
    if (/[&|;`$<>]/.test(target))
        return { ok: false, text: 'Caracteres não permitidos.' };
    if (/^https?:\/\//i.test(target)) {
        const r = t.n.openUrl(target);
        return r.ok ? `Abrindo ${target}` : { ok: false, text: r.error || 'Não abriu' };
    }
    const gd = t.n.store.gamesDir() || P.GAMES;
    const alias: Record<string, string> = { games: gd, jogos: gd, downloads: P.DOWNLOADS, roms: P.EMU_GAMES, emulation: P.EMU, themes: P.THEMES, temas: P.THEMES, root: P.ROOT, ludrix: P.ROOT };
    const p = alias[target.toLowerCase()] || target;
    if (fs.existsSync(p)) {
        const dir = fs.statSync(p).isDirectory() ? p : path.dirname(p);
        const r = t.n.openPath(dir);
        return r.ok ? `Abrindo ${p}` : { ok: false, text: r.error || 'Não abriu' };
    }
    t.winOnly();
    const name = target.toLowerCase().replace(/\.exe$/, '');
    const allowed = new Set(['notepad', 'calc', 'mspaint', 'explorer', 'cmd', 'powershell', 'taskmgr', 'control', 'snippingtool', 'wordpad', 'charmap', 'msinfo32', 'dxdiag', 'regedit', 'devmgmt.msc', 'ms-settings:']);
    const which = (n: string): string | null => {
        for (const d of String(process.env.PATH || '').split(path.delimiter)) {
            for (const ext of ['', '.exe']) {
                const f = path.join(d, n + ext);
                if (fs.existsSync(f))
                    return f;
            }
        }
        return null;
    };
    const exe = which(name);
    const sysRoot = String(process.env.SystemRoot || 'C:\\Windows').toLowerCase();
    let inSys = false;
    if (exe) {
        try {
            inSys = fs.realpathSync(exe).toLowerCase().startsWith(sysRoot);
        }
        catch { /* ignore */ }
    }
    if (allowed.has(name) || inSys) {
        const argv = target.endsWith('.msc') || target.endsWith(':') ? ['explorer.exe', target] : [exe || name];
        cp.spawn(argv[0], argv.slice(1), { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        return `Abrindo ${target}`;
    }
    return { ok: false, text: 'Só abro programas do Windows, pastas do Ludrix ou sites. Use o caminho completo de uma pasta do Ludrix.' };
}, { args: [['alvo', 'ex.: notepad, calc, games, downloads, https://…', true]], examples: ['/open notepad', '/open https://archive.org', '/open downloads'], group: 'windows', aliases: ['start'] });

cmd('random', 'Sorteia um jogo da biblioteca pra você jogar agora', (t, a) => {
    let lib = Object.entries<any>(t.n.store.library);
    const f = (a[0] || '').toLowerCase();
    if (f === 'rom')
        lib = lib.filter(([, x]) => x.kind === 'rom');
    else if (f === 'pc')
        lib = lib.filter(([, x]) => x.kind !== 'rom');
    else if (f === 'never')
        lib = lib.filter(([, x]) => !x.last_played);
    if (!lib.length)
        return 'Nada pra sortear com esse filtro.';
    const [k, i] = lib[Math.floor(Math.random() * lib.length)];
    return { text: `>> ${i.title || k}   ( /play "${i.title || k}" pra abrir )`, ui: { open_game: k } };
}, { args: [['filtro', 'installed | rom | pc | never (nunca jogados)', false]], examples: ['/random', '/random never'], group: 'diversão', aliases: ['roll', 'dice'] });

cmd('history', 'Mostra os últimos comandos digitados', (t) => t.history.slice(-30).map((x, i) => `${String(i + 1).padStart(3)}  ${x}`).join('\n') || '(vazio)', { group: 'ajuda' });

export { COMMANDS, usage, shlexSplit };
