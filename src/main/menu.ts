import path from 'node:path';
import fs from 'node:fs';
import * as electron from 'electron';
import * as log from './log';
import * as P from './paths';
function fontFace(): string {
    try {
        const b = fs.readFileSync(path.join(P.UI, 'fonts', 'rubik.woff2'));
        return `@font-face{font-family:Rubik;src:url(data:font/woff2;base64,${b.toString('base64')}) format('woff2');font-weight:300 900}`;
    }
    catch {
        return '';
    }
}

export type MenuItem = { id?: string; sep?: boolean; label?: string; hint?: string; primary?: boolean; danger?: boolean; disabled?: boolean; title?: boolean; icon?: string | null; sub?: MenuItem[] | null };
export type MenuHead = { title?: string; sub?: string; thumb?: string | null };
export type MenuOpts = { items: MenuItem[]; title?: string; head?: MenuHead | null; colors?: any; ui?: any; light?: boolean; x: number; y: number; atCursor?: boolean; owner?: electron.BrowserWindow | null };

const DEF_DARK = { bg: '#1b1f26', text: '#e8ebf0', muted: '#8b93a1', primary: '#5c6b82', onprimary: '#ffffff', danger: '#ff6b6b', line: '#2c323c', hover: '#272d37', card: '#222731' };
const DEF_LIGHT = { bg: '#f4f5f7', text: '#1a1d22', muted: '#6b7280', primary: '#5c6b82', onprimary: '#ffffff', danger: '#d04545', line: '#dcdfe4', hover: '#e6e8ec', card: '#ffffff' };
function uiOf(u: any) {
    const o = u && typeof u === 'object' ? u : {};
    const r = Math.max(0, Math.min(20, Math.round(Number(o.r)) || 12));
    const font = String(o.font || '').replace(/[^\w\s,'"-]/g, '').slice(0, 120);
    return { r, font, rm: String(o.rm) === '1' ? 1 : 0, acr: String(o.acr) === '1' ? 1 : 0, light: String(o.light) === '1' ? 1 : 0 };
}

let current: electron.BrowserWindow | null = null;
let pool: electron.BrowserWindow | null = null;
let poolReady = false;
let seq = 0;
let visible = false;
let t0 = 0;

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
        primary: Boolean(it?.primary), danger: Boolean(it?.danger), disabled: Boolean(it?.disabled), title: Boolean(it?.title),
        icon: typeof it?.icon === 'string' && it.icon.startsWith('data:image/') ? it.icon : null,
        sub: Array.isArray(it?.sub) && it.sub.length ? strip(it.sub, pre + i + '.') : null,
    }));
}


function page() {
    const css = `
${fontFace()}
:root{--bg:#1b1f26;--text:#e8ebf0;--muted:#8b93a1;--primary:#5c6b82;--onprimary:#fff;--danger:#ff6b6b;--line:#2c323c;--hover:#272d37;--card:#222731;--r:12px;--rr:7px;--font:Rubik,'Segoe UI',system-ui,sans-serif;--alpha:1;--sh:0 14px 34px rgba(0,0,0,.32),0 2px 6px rgba(0,0,0,.18)}
*{box-sizing:border-box;user-select:none;-webkit-user-select:none}html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}body{position:relative;left:0;top:0}
body{font:13px/1.25 var(--font);color:var(--text);-webkit-font-smoothing:antialiased}
.m{position:absolute;min-width:232px;max-width:340px;padding:6px;background:color-mix(in srgb,var(--bg) calc(var(--alpha)*100%),transparent);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh);opacity:0;transform:translateY(-4px) scale(.97);transform-origin:var(--ox,0) var(--oy,0);transition:opacity .09s ease-out,transform .14s cubic-bezier(.2,.85,.25,1.08)}
.m.on{opacity:1;transform:none}
html.rm .m,html.rm .r,html.rm .r .ic,html.rm .r .lb{transition:none!important}
.hd{display:grid;grid-template-columns:auto 1fr;gap:11px;align-items:center;padding:5px 6px 9px;margin:0 2px 4px;border-bottom:1px solid var(--line)}
.hd img{width:40px;height:54px;border-radius:calc(var(--rr) - 1px);object-fit:cover;background:var(--hover);display:block}
.hd .t{min-width:0}.hd b{display:block;font-size:13.5px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hd span{display:block;margin-top:3px;font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ttl{padding:6px 10px 4px;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.r{position:relative;display:flex;align-items:center;gap:9px;height:30px;padding:0 10px 0 8px;border-radius:var(--rr);white-space:nowrap;cursor:default;transition:background .1s}
.r .ic{width:22px;min-width:22px;height:22px;flex:none;display:grid;place-items:center;border-radius:6px;transition:background .12s,transform .14s cubic-bezier(.2,.85,.25,1.2)}.r .ic img{width:16px;height:16px;display:block}
.r .lb{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;transition:transform .14s cubic-bezier(.2,.85,.25,1)}
.r .ht{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;margin-left:10px}
.r .ar{width:14px;height:14px;color:var(--muted);margin-left:2px;margin-right:-3px}.r .ar svg{width:14px;height:14px;display:block}
.r.sel:not(.disabled){background:var(--hover)}
.r.sel:not(.disabled) .ic:has(img){background:color-mix(in srgb,var(--primary) 16%,transparent);transform:scale(1.06)}
.m.noic .r .ic{display:none}.m.noic .r{padding-left:12px}
.r.sel:not(.disabled) .lb{transform:translateX(2px)}
.r.danger{color:var(--danger)}.r.danger.sel:not(.disabled){background:color-mix(in srgb,var(--danger) 12%,transparent)}.r.danger.sel .ic:has(img){background:color-mix(in srgb,var(--danger) 16%,transparent)}
.r.disabled{opacity:.45}
.r.primary{height:34px;margin:2px 0 4px;background:var(--primary);color:var(--onprimary);font-weight:700;letter-spacing:-.005em}
.r.primary .ht{color:var(--onprimary);opacity:.75}.r.primary .ic:has(img){background:color-mix(in srgb,var(--onprimary) 14%,transparent)}
.r.primary.sel{background:color-mix(in srgb,var(--primary) 88%,var(--text))}.r.primary.sel .ic:has(img){background:color-mix(in srgb,var(--onprimary) 24%,transparent);transform:scale(1.06)}
.sep{height:1px;background:var(--line);margin:4px 10px}
.sub{transform:translateX(-6px) scale(.98)}
`;
    const js = `
let D=null,U={};const send=(t,v)=>window.lxm.send(t,v);
const CHEV='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
const rowHtml=(it)=>it.sep?'<div class="sep"></div>':it.title?'<div class="ttl">'+esc(it.label)+'</div>':'<div class="r '+(it.primary?'primary ':'')+(it.danger?'danger ':'')+(it.disabled?'disabled ':'')+'" data-id="'+it.id+'"><span class="ic">'+(it.icon?'<img src="'+it.icon+'" alt="">':'')+'</span><span class="lb">'+esc(it.label)+'</span>'+(it.hint?'<span class="ht">'+esc(it.hint)+'</span>':'')+(it.sub?'<span class="ar">'+CHEV+'</span>':'')+'</div>';
function build(items,cls){const m=document.createElement('div');m.className='m '+cls+(items.some(i=>i&&i.icon)?'':' noic');m.innerHTML=items.map(rowHtml).join('');return m}
let root=null,A=null,openSub=null,subOwner=null,subT=null,cur=-1;const pad=6;
function place(el,x,y,flipW){const r={width:el.offsetWidth,height:el.offsetHeight};let l=x,t=y,ox='0',oy='0';if(l+r.width>A.width-pad){l=Math.max(pad,(flipW?x-flipW-r.width:x-r.width));ox='100%'}if(t+r.height>A.height-pad){t=Math.max(pad,A.height-pad-r.height);oy='100%'}el.style.left=l+'px';el.style.top=t+'px';el.style.setProperty('--ox',ox);el.style.setProperty('--oy',oy)}
const M=44;function box(){const els=[root,openSub].filter(Boolean);if(!els.length)return null;let l=1e9,t=1e9,r=0,b=0;for(const e of els){l=Math.min(l,e.offsetLeft);t=Math.min(t,e.offsetTop);r=Math.max(r,e.offsetLeft+e.offsetWidth);b=Math.max(b,e.offsetTop+e.offsetHeight)}l=Math.max(0,l-M);t=Math.max(0,t-M);r=Math.min(A.width,r+M);b=Math.min(A.height,b+M);return{l:Math.round(l),t:Math.round(t),w:Math.round(r-l),h:Math.round(b-t)}}
function fit(){const r=box();if(!r)return null;document.body.style.left=(-r.l)+'px';document.body.style.top=(-r.t)+'px';return r}
function closeSub(){if(openSub){openSub.remove();openSub=null;subOwner&&subOwner.classList.remove('sel');subOwner=null;const r=fit();if(r)send('rect',r)}}
function find(id){const [a,b]=id.split('.');const it=D.items[+a];return b===undefined?it:(it.sub||[])[+b]}
function showSub(row){const it=find(row.dataset.id);if(!it||!it.sub)return;if(subOwner===row)return;closeSub();const m=build(it.sub,'sub');document.body.appendChild(m);const rr=row.getBoundingClientRect(),ox=-(parseFloat(document.body.style.left)||0),oy=-(parseFloat(document.body.style.top)||0);place(m,rr.right+ox+4,rr.top+oy-7,rr.width+8);requestAnimationFrame(()=>m.classList.add('on'));openSub=m;subOwner=row;row.classList.add('sel');wire(m);const fr=fit();if(fr)send('rect',fr)}
function wire(m){m.querySelectorAll('.r').forEach(r=>{r.addEventListener('mouseenter',()=>{m.querySelectorAll('.r.sel').forEach(z=>{if(z!==subOwner||m!==root)z.classList.remove('sel')});if(m===root&&subOwner&&subOwner!==r){clearTimeout(subT);subT=setTimeout(()=>{if(!r.matches(':hover'))return;closeSub();r.classList.add('sel')},120)}r.classList.add('sel');const it=find(r.dataset.id);if(it&&it.sub){clearTimeout(subT);subT=setTimeout(()=>showSub(r),140)}});
r.addEventListener('mouseup',e=>{if(e.button!==0&&e.button!==2)return;const it=find(r.dataset.id);if(!it||it.disabled)return;if(it.sub){showSub(r);return}send('pick',it.id)})})}
function clear(){closeSub();if(root){root.remove();root=null}cur=-1;clearTimeout(subT)}
function theme(c,u){const st=document.documentElement.style;for(const k in c)st.setProperty('--'+k,c[k]);const r=Math.max(4,Math.min(20,+u.r||12));st.setProperty('--r',r+'px');st.setProperty('--rr',Math.max(4,r-5)+'px');if(u.font)st.setProperty('--font',u.font+",Rubik,'Segoe UI',system-ui,sans-serif");st.setProperty('--alpha',u.acr?'.9':'1');st.setProperty('--sh',u.light?'0 14px 34px rgba(0,0,0,.16),0 2px 6px rgba(0,0,0,.08)':'0 14px 34px rgba(0,0,0,.32),0 2px 6px rgba(0,0,0,.18)');document.documentElement.classList.toggle('rm',!!u.rm)}
function render(d){D=d;A=d.area;U=d.ui||{};clear();theme(d.colors||{},U);
root=build(D.items,'root');
if(D.head){const h=document.createElement('div');h.className='hd';h.innerHTML=(D.head.thumb?'<img src="'+D.head.thumb+'" alt="">':'')+'<div class="t"><b>'+esc(D.head.title)+'</b>'+(D.head.sub?'<span>'+esc(D.head.sub)+'</span>':'')+'</div>';root.prepend(h)}
else if(D.title){const t=document.createElement('div');t.className='ttl';t.textContent=D.title;root.prepend(t)}
document.body.appendChild(root);const go=()=>{if(D!==d||!root)return;place(root,D.x,D.y);wire(root);const fr=fit();requestAnimationFrame(()=>{root&&root.classList.add('on');send('ready',{seq:d.seq,rect:fr})})};if(document.fonts&&document.fonts.status!=='loaded')document.fonts.ready.then(go);else go()}
window.lxm.on(d=>{if(d&&d.items)render(d);else clear()});
document.addEventListener('mousedown',e=>{if(!e.target.closest('.m'))send('cancel')});
document.addEventListener('contextmenu',e=>e.preventDefault());
const rows=()=>[...(openSub||root||document).querySelectorAll('.r:not(.disabled)')];
document.addEventListener('keydown',e=>{if(!root)return;const rs=rows();if(e.key==='Escape'){if(openSub){closeSub();return}send('cancel');return}
if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();rs.forEach(r=>r.classList.remove('sel'));cur=(cur+(e.key==='ArrowDown'?1:-1)+rs.length)%rs.length;rs[cur]&&rs[cur].classList.add('sel');return}
if(e.key==='ArrowRight'){const r=rs[cur];const it=r&&find(r.dataset.id);if(it&&it.sub){showSub(r);cur=-1}return}
if(e.key==='ArrowLeft'){if(openSub){closeSub();cur=-1}return}
if(e.key==='Enter'||e.key===' '){const r=rs[cur];if(!r)return;const it=find(r.dataset.id);if(!it)return;if(it.sub){showSub(r);cur=-1;return}send('pick',it.id)}});
send('loaded');
`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'unsafe-inline'"><style>${css}</style></head><body><script>${js}</script></body></html>`;
}

let pending: ((r: any) => void) | null = null;
function hideNow(r: any) {
    const w = current;
    visible = false;
    current = null;
    const fin = pending;
    pending = null;
    if (w && !w.isDestroyed()) {
        try {
            w.webContents.send('lxm-show', null);
            w.hide();
        }
        catch { /* */ }
    }
    if (fin)
        fin(r);
}
let areaOrigin = { x: 0, y: 0 };
function applyRect(w: electron.BrowserWindow, r: { l: number; t: number; w: number; h: number }): boolean {
    const want = { x: areaOrigin.x + Math.round(r.l), y: areaOrigin.y + Math.round(r.t), width: Math.max(8, Math.round(r.w)), height: Math.max(8, Math.round(r.h)) };
    try {
        w.setBounds(want);
        const got = w.getBounds();
        if (Math.abs(got.width - want.width) > 4 || Math.abs(got.height - want.height) > 4) {
            log.warn('menu popup: janela não aceitou %dx%d (ficou %dx%d)', want.width, want.height, got.width, got.height);
            return false;
        }
        w.webContents.invalidate();
        return true;
    }
    catch (e) {
        log.warn('menu popup: %s', e);
        return false;
    }
}
function ensureWin(): electron.BrowserWindow {
    if (pool && !pool.isDestroyed())
        return pool;
    poolReady = false;
    const area = electron.screen.getPrimaryDisplay().workArea;
    const w = new electron.BrowserWindow({
        x: area.x, y: area.y, width: 320, height: 420, show: false, frame: false, transparent: true, resizable: false, movable: false,
        minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, focusable: true, title: '',
        backgroundColor: '#00000000',
        webPreferences: { preload: path.join(__dirname, 'menuPreload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, backgroundThrottling: false },
    });
    w.setMenuBarVisibility(false);
    w.setAlwaysOnTop(true, 'pop-up-menu');
    w.on('closed', () => {
        if (pool === w) {
            pool = null;
            poolReady = false;
        }
        if (current === w)
            hideNow({ ok: false, cancelled: true });
    });
    w.on('blur', () => { if (visible && current === w) setTimeout(() => { if (visible && current === w) hideNow({ ok: false, cancelled: true }); }, 60); });
    w.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(page(), 'utf8').toString('base64')).catch((e) => log.warn('menu popup: %s', e));
    pool = w;
    return w;
}
electron.ipcMain.on('lxm', (e, t: string, v: any) => {
    if (!pool || pool.isDestroyed() || e.sender !== pool.webContents)
        return;
    if (t === 'loaded') {
        poolReady = true;
        return;
    }
    if (t === 'rect') {
        if (current === pool && v && v.w > 0 && v.h > 0)
            applyRect(pool, v);
        return;
    }
    if (t === 'ready') {
        const sq = v && typeof v === 'object' ? Number(v.seq) : Number(v);
        if (sq === seq && current === pool && !visible) {
            if (v && typeof v === 'object' && v.rect && v.rect.w > 0 && v.rect.h > 0 && !applyRect(pool, v.rect)) {
                hideNow({ ok: false });
                dispose();
                return;
            }
            visible = true;
            pool.show();
            pool.focus();
            if (!pool.isVisible()) {
                log.warn('menu popup: janela não apareceu');
                hideNow({ ok: false });
                return;
            }
            log.debug('menu popup: %d ms', Date.now() - t0);
        }
        return;
    }
    if (current !== pool)
        return;
    if (t === 'pick')
        hideNow({ ok: true, pick: String(v) });
    else if (t === 'cancel')
        hideNow({ ok: false, cancelled: true });
});
export function warm() {
    if (!available())
        return;
    try {
        ensureWin();
    }
    catch (e) {
        log.warn('menu popup warm: %s', e);
    }
}
export function dispose() {
    close();
    const w = pool;
    pool = null;
    poolReady = false;
    if (w && !w.isDestroyed()) {
        try {
            w.destroy();
        }
        catch { /* */ }
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
        const area = electron.screen.getDisplayNearestPoint(pt).workArea;
        const w = ensureWin();
        areaOrigin = { x: area.x, y: area.y };
        const my = ++seq;
        t0 = Date.now();
        current = w;
        pending = resolve;
        const payload = { seq: my, items, title: String(o.title || '').slice(0, 60), head: o.head || null, x: pt.x - area.x, y: pt.y - area.y, area: { width: area.width, height: area.height }, colors: c, ui: uiOf(o.ui) };
        const go = () => {
            if (seq !== my || current !== w)
                return;
            try {
                w.webContents.send('lxm-show', payload);
            }
            catch (e) {
                log.warn('menu popup: %s', e);
                hideNow({ ok: false });
            }
        };
        if (poolReady)
            go();
        else
            w.webContents.once('did-finish-load', () => setTimeout(go, 0));
        setTimeout(() => { if (seq === my && current === w && !visible) { log.warn('menu popup: sem resposta em 1,2 s'); hideNow({ ok: false }); } }, 1200);
    });
}
export const activeWindow = () => current;
export function close() {
    if (current)
        hideNow({ ok: false, cancelled: true });
}
