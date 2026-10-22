import path from 'node:path';
import * as electron from 'electron';
import * as log from './log';

export type MenuItem = { id?: string; sep?: boolean; label?: string; hint?: string; primary?: boolean; danger?: boolean; disabled?: boolean; icon?: string | null; sub?: MenuItem[] | null };
export type MenuHead = { title?: string; sub?: string; thumb?: string | null };
export type MenuOpts = { items: MenuItem[]; title?: string; head?: MenuHead | null; colors?: any; light?: boolean; x: number; y: number; atCursor?: boolean; owner?: electron.BrowserWindow | null };

const DEF_DARK = { bg: '#1b1f26', text: '#e8ebf0', muted: '#8b93a1', primary: '#3ddc97', danger: '#ff6b6b', line: '#2c323c', hover: '#272d37' };
const DEF_LIGHT = { bg: '#f4f5f7', text: '#1a1d22', muted: '#6b7280', primary: '#17a673', danger: '#d04545', line: '#dcdfe4', hover: '#e6e8ec' };

let current: electron.BrowserWindow | null = null;
let seq = 0;

export const available = () => process.platform === 'win32' || process.env.LUDRIX_POPUP_MENU === '1';

function col(v: any, d: string) {
    return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d;
}
function esc(s: any) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function strip(items: MenuItem[], pre = ''): MenuItem[] {
    return (items || []).map((it, i) => ({
        id: pre + i, sep: Boolean(it?.sep), label: String(it?.label || '').slice(0, 80), hint: String(it?.hint || '').slice(0, 40),
        primary: Boolean(it?.primary), danger: Boolean(it?.danger), disabled: Boolean(it?.disabled),
        icon: typeof it?.icon === 'string' && it.icon.startsWith('data:image/') ? it.icon : null,
        sub: Array.isArray(it?.sub) && it.sub.length ? strip(it.sub, pre + i + '.') : null,
    }));
}

function page(o: MenuOpts, c: any, area: electron.Rectangle, x: number, y: number) {
    const css = `
:root{--bg:${c.bg};--tx:${c.text};--mu:${c.muted};--pr:${c.primary};--dg:${c.danger};--ln:${c.line};--hv:${c.hover}}
*{box-sizing:border-box;user-select:none;-webkit-user-select:none}html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}
body{font:13px 'Segoe UI',Rubik,system-ui,sans-serif;color:var(--tx)}
.m{position:absolute;min-width:236px;max-width:360px;background:var(--bg);border:1px solid var(--ln);border-radius:10px;padding:6px;box-shadow:0 8px 28px rgba(0,0,0,.35);opacity:0;transition:opacity .06s}
.m.on{opacity:1}
.r{position:relative;display:flex;align-items:center;gap:10px;height:32px;padding:0 12px 0 12px;margin:0 0;border-radius:9px;white-space:nowrap;cursor:default}
.r .ic{width:16px;height:16px;flex:none;display:flex;align-items:center;justify-content:center}.r .ic img{width:16px;height:16px;display:block}
.r .lb{flex:1;overflow:hidden;text-overflow:ellipsis}.r .ht{font-size:11px;color:var(--mu);margin-left:8px}.r .ar{color:var(--mu);font-size:11px;margin-left:4px}
.r.primary{font-weight:600;color:var(--pr);background:color-mix(in srgb,var(--pr) 12%,transparent)}
.r.danger{color:var(--dg)}.r.disabled{color:var(--mu);opacity:.6}
.r.sel:not(.disabled){background:var(--hv)}.r.primary.sel{background:color-mix(in srgb,var(--pr) 22%,transparent)}
.sep{height:1px;background:var(--ln);margin:4px 8px}
.ttl{height:26px;line-height:26px;padding:0 12px;color:var(--mu);font-weight:600;font-size:12px}
.hd{display:flex;gap:12px;align-items:center;height:72px;padding:0 12px;border-bottom:1px solid var(--ln);margin:0 0 4px}
.hd img{width:42px;height:56px;border-radius:7px;object-fit:cover;flex:none;background:var(--hv)}
.hd .t{min-width:0}.hd b{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.hd span{display:block;font-size:11px;color:var(--mu);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sub{position:absolute;display:none}
`;
    const data = JSON.stringify({ items: o.items, title: String(o.title || '').slice(0, 60), head: o.head || null, x, y, area });
    const js = `
const D=${data};const send=(t,v)=>window.lxm.send(t,v);
const rowHtml=(it)=>it.sep?'<div class="sep"></div>':'<div class="r '+(it.primary?'primary ':'')+(it.danger?'danger ':'')+(it.disabled?'disabled ':'')+'" data-id="'+it.id+'"><span class="ic">'+(it.icon?'<img src="'+it.icon+'">':'')+'</span><span class="lb">'+esc(it.label)+'</span>'+(it.hint?'<span class="ht">'+esc(it.hint)+'</span>':'')+(it.sub?'<span class="ar">&#9656;</span>':'')+'</div>';
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function build(items,cls){const m=document.createElement('div');m.className='m '+cls;m.innerHTML=items.map(rowHtml).join('');return m}
const root=build(D.items,'root');
if(D.head){const h=document.createElement('div');h.className='hd';h.innerHTML=(D.head.thumb?'<img src="'+D.head.thumb+'">':'')+'<div class="t"><b>'+esc(D.head.title)+'</b>'+(D.head.sub?'<span>'+esc(D.head.sub)+'</span>':'')+'</div>';root.prepend(h)}
else if(D.title){const t=document.createElement('div');t.className='ttl';t.textContent=D.title;root.prepend(t)}
document.body.appendChild(root);
const A=D.area;const pad=6;
function place(el,x,y,flipW){const r=el.getBoundingClientRect();let l=x,t=y;if(l+r.width>A.width-pad)l=Math.max(pad,(flipW?x-flipW-r.width:x-r.width));if(t+r.height>A.height-pad)t=Math.max(pad,A.height-pad-r.height);el.style.left=l+'px';el.style.top=t+'px'}
place(root,D.x,D.y);requestAnimationFrame(()=>root.classList.add('on'));
let openSub=null,subOwner=null,subT=null;
function closeSub(){if(openSub){openSub.remove();openSub=null;subOwner&&subOwner.classList.remove('sel');subOwner=null}}
function find(id){const [a,b]=id.split('.');const it=D.items[+a];return b===undefined?it:(it.sub||[])[+b]}
function showSub(row){const it=find(row.dataset.id);if(!it||!it.sub)return;if(subOwner===row)return;closeSub();const m=build(it.sub,'sub');m.style.display='block';document.body.appendChild(m);const rr=row.getBoundingClientRect();place(m,rr.right+2,rr.top-6,rr.width+4);requestAnimationFrame(()=>m.classList.add('on'));openSub=m;subOwner=row;row.classList.add('sel');wire(m)}
function wire(m){m.querySelectorAll('.r').forEach(r=>{r.addEventListener('mouseenter',()=>{m.querySelectorAll('.r.sel').forEach(z=>{if(z!==subOwner||m!==root)z.classList.remove('sel')});if(m===root&&subOwner&&subOwner!==r){clearTimeout(subT);subT=setTimeout(()=>{if(!r.matches(':hover'))return;closeSub();r.classList.add('sel')},120)}r.classList.add('sel');const it=find(r.dataset.id);if(it&&it.sub){clearTimeout(subT);subT=setTimeout(()=>showSub(r),140)}});
r.addEventListener('mouseup',e=>{if(e.button!==0&&e.button!==2)return;const it=find(r.dataset.id);if(!it||it.disabled)return;if(it.sub){showSub(r);return}send('pick',it.id)})})}
wire(root);
document.addEventListener('mousedown',e=>{if(!e.target.closest('.m'))send('cancel')});
document.addEventListener('contextmenu',e=>e.preventDefault());
let cur=-1;const rows=()=>[...(openSub||root).querySelectorAll('.r:not(.disabled)')];
document.addEventListener('keydown',e=>{const rs=rows();if(e.key==='Escape'){if(openSub){closeSub();return}send('cancel');return}
if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();rs.forEach(r=>r.classList.remove('sel'));cur=(cur+(e.key==='ArrowDown'?1:-1)+rs.length)%rs.length;rs[cur]&&rs[cur].classList.add('sel');return}
if(e.key==='ArrowRight'){const r=rs[cur];const it=r&&find(r.dataset.id);if(it&&it.sub){showSub(r);cur=-1}return}
if(e.key==='ArrowLeft'){if(openSub){closeSub();cur=-1}return}
if(e.key==='Enter'||e.key===' '){const r=rs[cur];if(!r)return;const it=find(r.dataset.id);if(!it)return;if(it.sub){showSub(r);cur=-1;return}send('pick',it.id)}});
send('ready');
`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'"><style>${css}</style></head><body><script>${js}</script></body></html>`;
}

export const activeWindow = () => current;
export function close() {
    if (current) {
        try {
            current.close();
        }
        catch { /* */ }
        current = null;
    }
}

export function show(o: MenuOpts): Promise<any> {
    return new Promise((resolve) => {
        close();
        const items = strip(o.items || []);
        if (!items.length) {
            resolve({ ok: false });
            return;
        }
        const c = { ...(o.light ? DEF_LIGHT : DEF_DARK) };
        for (const k of Object.keys(c))
            (c as any)[k] = col(o.colors?.[k], (c as any)[k]);
        let pt = { x: Math.round(Number(o.x) || 0), y: Math.round(Number(o.y) || 0) };
        if (o.atCursor)
            pt = electron.screen.getCursorScreenPoint();
        const disp = electron.screen.getDisplayNearestPoint(pt);
        const area = disp.workArea;
        const my = ++seq;
        let done = false;
        const finish = (r: any) => {
            if (done)
                return;
            done = true;
            if (current === win)
                current = null;
            try {
                win.close();
            }
            catch { /* */ }
            resolve(r);
        };
        const win = new electron.BrowserWindow({
            x: area.x, y: area.y, width: area.width, height: area.height, show: false, frame: false, transparent: true, resizable: false, movable: false,
            minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, focusable: true,
            backgroundColor: '#00000000', parent: o.owner || undefined, title: '',
            webPreferences: { preload: path.join(__dirname, 'menuPreload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, backgroundThrottling: false },
        });
        current = win;
        win.setMenuBarVisibility(false);
        win.setAlwaysOnTop(true, 'pop-up-menu');
        const onMsg = (e: electron.IpcMainEvent, t: string, v: any) => {
            if (e.sender !== win.webContents)
                return;
            if (t === 'ready') {
                win.show();
                win.focus();
            }
            else if (t === 'pick')
                finish({ ok: true, pick: String(v) });
            else if (t === 'cancel')
                finish({ ok: false, cancelled: true });
        };
        electron.ipcMain.on('lxm', onMsg);
        win.on('blur', () => setTimeout(() => { if (seq === my && !done) finish({ ok: false, cancelled: true }); }, 60));
        win.on('closed', () => {
            electron.ipcMain.removeListener('lxm', onMsg);
            if (!done)
                finish({ ok: false, cancelled: true });
        });
        const html = page({ ...o, items, head: o.head || null }, c, area, pt.x - area.x, pt.y - area.y);
        win.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(html, 'utf8').toString('base64')).catch((e) => {
            log.warn('menu popup: %s', e);
            finish({ ok: false });
        });
        setTimeout(() => { if (!done && !win.isVisible()) finish({ ok: false }); }, 2500);
    });
}
