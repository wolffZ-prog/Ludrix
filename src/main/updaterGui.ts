import fs from 'node:fs';
import path from 'node:path';
import * as cp from 'node:child_process';
import { Worker } from 'node:worker_threads';
import * as electron from 'electron';
import { Apply, Restore, notesFor, writeResult, updatesDir } from './updater';

const APP = 'LudrixHub';
const WIN = process.platform === 'win32';

function argvOpt(name: string, dflt: string | null = null) {
    const i = process.argv.indexOf(name);
    if (i >= 0 && i + 1 < process.argv.length)
        return process.argv[i + 1];
    return dflt;
}
function lum(hex: string) {
    try {
        const h = hex.replace('#', '');
        const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    catch {
        return 0;
    }
}
function palette(root: string) {
    const p: any = { bg: '#232428', card: '#313237', text: '#f2f2f4', muted: '#9a9aa3', accent: '#5c6b82', red: '#e5312b', green: '#22c55e', line: '#3a3b41', bg2: '#2b2c31' };
    try {
        const t = JSON.parse(fs.readFileSync(path.join(updatesDir(root), 'theme.json'), 'utf8'));
        for (const k of Object.keys(p))
            if (typeof t[k] === 'string' && /^#[0-9a-f]{6}$/i.test(t[k]))
                p[k] = t[k];
        if (p.bg2 === p.bg)
            p.bg2 = p.card;
    }
    catch { /* padrão */ }
    p.accentFg = lum(p.accent) > 0.45 ? '#1c1d21' : '#ffffff';
    return p;
}
function touchesRuntime(m: any) {
    const dirs: string[] = m.dirs || [];
    const files = Object.keys(m.files || {});
    return dirs.includes('runtime') || files.some((f) => /^runtime\//.test(f));
}
function esc(s: string) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function mdHtml(text: string) {
    const out: string[] = [];
    let ul = false;
    const closeUl = () => { if (ul) { out.push('</ul>'); ul = false; } };
    const inline = (s: string) => esc(s.replace(/`/g, '')).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    for (const line of String(text || '').split(/\r?\n/)) {
        if (line.startsWith('## ')) { closeUl(); out.push(`<h3>${inline(line.slice(3).trim())}</h3>`); continue; }
        if (line.startsWith('### ')) { closeUl(); out.push(`<h4>${inline(line.slice(4).trim())}</h4>`); continue; }
        const li = /^\s*[-*] (.*)$/.exec(line);
        if (li) { if (!ul) { out.push('<ul>'); ul = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
        closeUl();
        if (line.trim())
            out.push(`<p>${inline(line)}</p>`);
    }
    closeUl();
    return out.join('');
}

function html(p: any, iconData: string, restore: boolean, fromVer: string) {
    const css = `
:root{--bg:${p.bg};--card:${p.card};--text:${p.text};--muted:${p.muted};--acc:${p.accent};--accfg:${p.accentFg};--red:${p.red};--ok:${p.green};--line:${p.line};--btn:${p.bg2}}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--text);font:13px Rubik,'Segoe UI',system-ui,sans-serif;display:flex;flex-direction:column;padding:18px 20px 16px;gap:8px;user-select:none;-webkit-user-select:none}
.head{display:flex;align-items:flex-start;gap:12px}.head img{width:40px;height:40px;border-radius:8px;flex:none}
.head .t{flex:1;min-width:0}.head .t b{display:block;font-size:17px;font-weight:600}.head .t span{color:var(--muted)}
.head .v{color:var(--muted);text-align:right;white-space:pre-line;line-height:1.35;font-size:12px}
#info{font-weight:600;margin-top:4px;min-height:17px}#info.err{color:var(--red)}
#kind{color:var(--muted);font-size:12px;min-height:15px}#kind.ok{color:var(--ok)}#kind.bad{color:var(--red)}
.box{flex:1;min-height:80px;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:auto;padding:10px 14px;user-select:text;-webkit-user-select:text}
.box::-webkit-scrollbar{width:10px}.box::-webkit-scrollbar-thumb{background:var(--line);border-radius:6px;border:2px solid var(--card)}
.box h3{color:var(--acc);font-size:14px;margin:10px 0 4px}.box h3:first-child{margin-top:0}.box h4{font-size:13px;margin:8px 0 2px}
.box p{margin:2px 0;line-height:1.45}.box ul{margin:2px 0 4px;padding-left:18px}.box li{line-height:1.45}
.box .mut{color:var(--muted)}.box .err{color:var(--red)}.box .okk{color:var(--ok)}.box .log{margin:1px 0;white-space:pre-wrap}
#status{color:var(--muted);font-size:12px;min-height:15px}#status.ok{color:var(--ok)}#status.err{color:var(--red)}
.bar{height:8px;background:var(--card);border-radius:4px;overflow:hidden}.bar i{display:block;height:100%;width:0;background:var(--acc);transition:width .15s}
.btns{display:flex;align-items:center;gap:8px;margin-top:4px}.btns .sp{flex:1}
button{border:0;border-radius:6px;padding:7px 14px;font:inherit;cursor:pointer;background:var(--btn);color:var(--text)}
button:hover{filter:brightness(1.12)}button:disabled{opacity:.5;cursor:default;filter:none}
button.pri{background:var(--acc);color:var(--accfg);font-weight:600}button.dan{background:var(--red);color:#fff}
`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'"><title>${APP} - Atualizador</title><style>${css}</style></head><body>
<div class="head">${iconData ? `<img src="${iconData}" alt="">` : ''}<div class="t"><b>${APP}</b><span id="sub">${restore ? 'Voltar de versão' : 'Atualizador'}</span></div><div class="v" id="vers"></div></div>
<div id="info"></div><div id="kind"></div>
<div class="box" id="box"></div>
<div id="status"></div><div class="bar"><i id="bar"></i></div>
<div class="btns"><button id="b_pick">Escolher arquivo…</button><button id="b_mode" style="display:none">Voltar de versão…</button><span class="sp"></span><button id="b_close">Cancelar</button><button id="b_apply" class="pri" disabled>Aplicar atualização</button></div>
<script>
const $=id=>document.getElementById(id);const box=$('box');
const S=m=>{if(m.html!==undefined){box.innerHTML=m.html;box.scrollTop=0}
if(m.append!==undefined){const d=document.createElement('div');d.className='log '+(m.cls||'mut');d.textContent=m.append;box.appendChild(d);box.scrollTop=box.scrollHeight}
if(m.info!==undefined){$('info').textContent=m.info;$('info').className=m.infoErr?'err':''}
if(m.kind!==undefined){$('kind').textContent=m.kind;$('kind').className=m.kindCls||''}
if(m.vers!==undefined)$('vers').textContent=m.vers;
if(m.status!==undefined){$('status').textContent=m.status;$('status').className=m.statusCls||''}
if(m.progress!==undefined)$('bar').style.width=Math.round(m.progress*100)+'%';
if(m.sub!==undefined)$('sub').textContent=m.sub;
if(m.buttons){for(const [id,b] of Object.entries(m.buttons)){const el=$(id);if(!el)continue;if(b.text!==undefined)el.textContent=b.text;if(b.show!==undefined)el.style.display=b.show?'':'none';if(b.disabled!==undefined)el.disabled=!!b.disabled;if(b.cls!==undefined)el.className=b.cls}}};
window.lxu.on(S);
for(const id of ['b_pick','b_mode','b_close','b_apply'])$(id).addEventListener('click',()=>window.lxu.send(id));
window.lxu.send('ready');
</script></body></html>`;
}

export function main() {
    const here = path.resolve(__dirname, '..', '..');
    const root = path.resolve(argvOpt('--root', here) as string);
    let restore = process.argv.includes('--restore');
    let pkg: string | null = restore ? argvOpt('--restore') : argvOpt('--apply');
    pkg = pkg && !pkg.startsWith('--') ? path.resolve(pkg) : null;
    const waitPid = Number(argvOpt('--wait-pid', '0') || 0);
    const rl = argvOpt('--relaunch');
    const relaunch: string[] | null = rl ? JSON.parse(rl) : null;
    let fromVer = argvOpt('--from', '') || '';
    if (!fromVer) {
        try {
            fromVer = JSON.parse(fs.readFileSync(path.join(root, 'app', 'version.json'), 'utf8')).version || '';
        }
        catch {
            fromVer = '';
        }
    }
    const logFile = path.join(updatesDir(root), 'updater.log');
    const flog = (s: string) => {
        try {
            fs.mkdirSync(updatesDir(root), { recursive: true });
            fs.appendFileSync(logFile, `${new Date().toISOString()} ${s}\n`);
        }
        catch { /* ignore */ }
    };
    const pal = palette(root);
    let iconData = '';
    let iconImg: electron.NativeImage | undefined;
    const appDir = (() => { try { return electron.app.getAppPath(); } catch { return path.resolve(__dirname, '..', '..'); } })();
    for (const c of [path.join(appDir, 'ui', 'icon.png'), path.join(appDir, 'src', 'renderer', 'icon.png'), path.join(root, 'app', 'ui', 'icon.png')]) {
        if (fs.existsSync(c)) {
            try {
                const buf = fs.readFileSync(c);
                iconData = 'data:image/png;base64,' + buf.toString('base64');
                iconImg = electron.nativeImage.createFromBuffer(buf);
            }
            catch { /* sem ícone */ }
            break;
        }
    }
    const state: { pkg: string | null; manifest: any; running: boolean; done: boolean } = { pkg, manifest: null, running: false, done: false };
    const workerFile = path.join(__dirname, 'updaterWork.js');
    let win: electron.BrowserWindow | null = null;
    const send = (m: any) => { try { win?.webContents.send('lxu', m); } catch { /* */ } };

    const opener = (p: string) => restore ? new Restore(p, root, () => undefined, () => undefined) : new Apply(p, root, () => undefined, () => undefined);

    const load = (p: string) => {
        let m: any;
        try {
            m = opener(p).read();
        }
        catch (e: any) {
            send({ info: 'Pacote inválido', infoErr: true, kind: String(e?.message || e), kindCls: 'bad', html: '', buttons: { b_apply: { disabled: true } } });
            state.manifest = null;
            return false;
        }
        state.pkg = p;
        state.manifest = m;
        const kind = ({ full: 'Nova versão do launcher', patch: 'Atualização', restore: 'Voltar de versão' } as any)[m.kind] || 'Atualização';
        const signed = ({ ok: 'assinado pelo Ludrix', none: 'SEM ASSINATURA - só continue se confia na origem', bad: 'ASSINATURA NÃO CONFERE - arquivo alterado' } as any)[m.signed] || '';
        const notes = notesFor(m, fromVer);
        send({
            info: m.title || kind, infoErr: false,
            kind: [kind, m.date || '', path.basename(p), signed].filter(Boolean).join('  -  '), kindCls: m.signed === 'ok' ? 'ok' : m.signed === 'bad' ? 'bad' : '',
            vers: `instalada  v${fromVer || '?'}\n${m.restore ? 'volta para' : 'nova'}  v${m.version}`,
            html: notes ? mdHtml(notes) : '<p class="mut">Sem notas de versão.</p>',
            status: 'Pronto. O Ludrix precisa estar fechado - se estiver aberto, ele é fechado sozinho.', statusCls: '',
            buttons: { b_apply: { disabled: false, text: m.restore ? 'Voltar para essa versão' : 'Aplicar atualização' } },
        });
        return true;
    };

    const relocate = async (): Promise<boolean> => {
        const exe = process.execPath;
        const runtime = path.join(root, 'runtime');
        const inRuntime = path.resolve(exe).toLowerCase().startsWith((path.resolve(runtime) + path.sep).toLowerCase());
        if (!inRuntime || process.argv.includes('--relocated'))
            return false;
        const tmp = path.join(updatesDir(root), 'tmp-runtime');
        send({ status: 'Preparando a troca do runtime…', progress: 0.02 });
        fs.rmSync(tmp, { recursive: true, force: true });
        await fs.promises.cp(runtime, tmp, { recursive: true, force: true });
        const rel = path.relative(runtime, exe);
        const args = [...(process.defaultApp ? [electron.app.getAppPath()] : []), ...process.argv.slice(process.defaultApp ? 2 : 1).filter((a) => a !== electron.app.getAppPath()), '--relocated'];
        if (!args.includes('--updater'))
            args.splice(process.defaultApp ? 1 : 0, 0, '--updater');
        flog(`runtime será trocado: continuando a partir de ${tmp}`);
        const child = cp.spawn(path.join(tmp, rel), args, { cwd: root, detached: true, stdio: 'ignore', windowsHide: false });
        child.unref();
        return true;
    };

    const startLauncher = () => {
        if (!relaunch || !relaunch.length)
            return;
        try {
            const env = { ...process.env };
            delete env.ELECTRON_RUN_AS_NODE;
            const child = cp.spawn(relaunch[0], relaunch.slice(1), { cwd: root, detached: true, stdio: 'ignore', windowsHide: false, env });
            child.unref();
        }
        catch (e: any) {
            send({ append: `não consegui reabrir: ${e?.message || e}`, cls: 'err' });
        }
    };

    const cleanupTmp = () => {
        if (!process.argv.includes('--relocated'))
            return;
        const tmp = path.join(updatesDir(root), 'tmp-runtime');
        try {
            if (WIN)
                cp.spawn('cmd', ['/c', `ping -n 4 127.0.0.1 >nul & rmdir /s /q "${tmp}"`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
            else
                cp.spawn('sh', ['-c', `sleep 3; rm -rf "${tmp}"`], { detached: true, stdio: 'ignore' }).unref();
        }
        catch { /* ignore */ }
    };

    const finish = (ok: boolean, err: string) => {
        const m = state.manifest || {};
        state.done = true;
        state.running = false;
        writeResult(root, { ok, version: m.version, kind: m.kind, restore: Boolean(m.restore), error: err, changelog: notesFor(m, fromVer), at: Date.now() / 1000 });
        flog(ok ? `ok: v${m.version}` : `ERRO: ${err}`);
        const btns: any = { b_pick: { show: false }, b_mode: { show: false }, b_close: { show: true, text: 'Fechar', disabled: false }, b_apply: { show: Boolean(relaunch), text: 'Abrir o Ludrix', disabled: false, cls: 'pri' } };
        if (ok)
            send({ progress: 1, status: `${m.restore ? 'Versão restaurada.' : 'Atualização instalada.'}  Agora o Ludrix está na v${m.version}.`, statusCls: 'ok', append: '', buttons: btns });
        else
            send({ progress: 0, status: 'Falhou - a versão anterior foi restaurada.', statusCls: 'err', append: 'ERRO: ' + err, cls: 'err', buttons: btns });
        if (ok)
            send({ append: 'Pronto. Quer abrir o Ludrix agora?', cls: 'okk' });
    };

    const doApply = async () => {
        if (state.running || state.done || !state.pkg || !state.manifest)
            return;
        state.running = true;
        send({ buttons: { b_apply: { disabled: true }, b_pick: { disabled: true }, b_mode: { disabled: true }, b_close: { disabled: true } }, html: '' });
        if (touchesRuntime(state.manifest)) {
            try {
                if (await relocate()) {
                    setTimeout(() => electron.app.exit(0), 300);
                    return;
                }
            }
            catch (e: any) {
                flog('não consegui copiar o runtime: ' + (e?.message || e));
                send({ append: `não consegui copiar o runtime: ${e?.message || e}`, cls: 'err' });
            }
        }
        let w: Worker;
        try {
            w = new Worker(workerFile, { workerData: { pkg: state.pkg, root, restore, waitPid } });
        }
        catch (e: any) {
            finish(false, `não consegui iniciar a aplicação: ${e?.message || e}`);
            return;
        }
        w.on('message', (m: any) => {
            if (m.log !== undefined)
                send({ append: m.log });
            if (m.progress !== undefined)
                send({ progress: m.progress, status: m.text || '', statusCls: '' });
            if (m.done) {
                if (m.manifest && Object.keys(m.manifest).length)
                    state.manifest = m.manifest;
                finish(Boolean(m.ok), String(m.error || ''));
            }
        });
        w.on('error', (e: any) => finish(false, String(e?.message || e)));
        w.on('exit', (code) => { if (!state.done) finish(false, `atualizador encerrou com código ${code}`); });
    };

    const choose = async () => {
        if (!win)
            return;
        const filters = restore
            ? [{ name: 'Atualização ou pacote do Ludrix (*.lxup;*.zip)', extensions: ['lxup', 'zip'] }, { name: 'Todos', extensions: ['*'] }]
            : [{ name: 'Atualização do Ludrix (*.lxup)', extensions: ['lxup'] }, { name: 'Todos', extensions: ['*'] }];
        const r = await electron.dialog.showOpenDialog(win, { title: restore ? 'Escolher versão' : 'Escolher atualização', defaultPath: updatesDir(root), filters, properties: ['openFile'] });
        if (!r.canceled && r.filePaths[0])
            load(r.filePaths[0]);
    };

    electron.app.setName(APP);
    electron.app.whenReady().then(() => {
        win = new electron.BrowserWindow({
            width: 620, height: 520, minWidth: 560, minHeight: 440, show: false, center: true, backgroundColor: pal.bg,
            title: `${APP} - Atualizador`, autoHideMenuBar: true, icon: iconImg,
            webPreferences: { preload: path.join(__dirname, 'updaterPreload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false },
        });
        win.setMenuBarVisibility(false);
        win.once('ready-to-show', () => win?.show());
        win.on('closed', () => { win = null; electron.app.quit(); });
        electron.ipcMain.on('lxu', (_e, cmd: string) => {
            if (cmd === 'ready') {
                if (state.pkg) {
                    const ok = load(state.pkg);
                    if (ok && waitPid && !restore)
                        setTimeout(() => void doApply(), 400);
                }
                else {
                    send({ buttons: { b_mode: { show: true } } });
                    if (restore)
                        send({ info: 'Escolha o pacote da versão que quer usar', html: '<p class="mut">Um arquivo ludrix-&lt;versão&gt;-patch.lxup ou -full.lxup. Só as pastas do programa são trocadas: jogos, configurações, temas e emuladores ficam como estão.</p>' });
                    else
                        send({ info: 'Escolha um arquivo .lxup pra atualizar', html: '<p class="mut">Também dá pra soltar o pacote na pasta data\\updates e usar "Checar atualizações" dentro do Ludrix.</p>' });
                }
                return;
            }
            if (cmd === 'b_apply') {
                if (state.done) {
                    startLauncher();
                    cleanupTmp();
                    win?.close();
                }
                else
                    void doApply();
                return;
            }
            if (cmd === 'b_close') {
                if (state.running)
                    return;
                cleanupTmp();
                win?.close();
                return;
            }
            if (cmd === 'b_pick') {
                if (!state.running)
                    void choose();
                return;
            }
            if (cmd === 'b_mode') {
                if (state.running)
                    return;
                restore = !restore;
                send({ sub: restore ? 'Voltar de versão' : 'Atualizador', buttons: { b_mode: { text: restore ? 'Atualizar…' : 'Voltar de versão…' } } });
                void choose();
            }
        });
        void win.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(html(pal, iconData, restore, fromVer), 'utf8').toString('base64'));
    });
    electron.app.on('window-all-closed', () => electron.app.quit());
}
