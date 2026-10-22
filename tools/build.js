#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const VERSION_FILE = path.join(ROOT, 'version.json');
const OUT = process.env.LUDRIX_BUILD_OUT || path.join(ROOT, 'release');
const CACHE = process.env.LUDRIX_BUILD_CACHE || (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'), 'Ludrix-Dev', 'cache') : path.join(require('os').homedir(), '.cache', 'ludrix-build'));
const WIN = process.platform === 'win32';
const FEED_REPO = 'wolffZ-prog/Ludrix';
const FEED_BASE = `https://github.com/${FEED_REPO}/releases/latest/download`;

const vinfo = () => JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
const version = () => vinfo().version;
const rel = () => { const d = path.join(OUT, version()); fs.mkdirSync(d, { recursive: true }); return d; };
const log = (...a) => console.log(...a);
const die = (m, code = 1) => { console.error(m); process.exit(code); };
const run = (cmd, args, opts = {}) => {
    const r = cp.spawnSync(cmd, args, { stdio: 'inherit', shell: WIN, cwd: ROOT, ...opts });
    if (r.status !== 0)
        die(`${cmd} ${args.join(' ')} terminou com erro ${r.status}`);
};
const sha256File = (p) => { const h = crypto.createHash('sha256'); h.update(fs.readFileSync(p)); return h.digest('hex'); };
const AdmZip = () => require(path.join(ROOT, 'node_modules', 'adm-zip'));
const mod = (n) => {
    const f = path.join(ROOT, 'dist', 'main', n);
    if (!fs.existsSync(f))
        run(path.join(ROOT, 'node_modules', '.bin', WIN ? 'tsc.cmd' : 'tsc'), ['-p', 'tsconfig.json']);
    return require(f);
};

function changelogFor(v) {
    const p = path.join(ROOT, 'CHANGELOG.md');
    if (!fs.existsSync(p))
        return '';
    const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`^## +${esc}\\b[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(fs.readFileSync(p, 'utf8'));
    return (m ? m[1] : '').trim();
}
function changelogAll() {
    const p = path.join(ROOT, 'CHANGELOG.md');
    if (!fs.existsSync(p))
        return [];
    const out = [];
    const re = /^## +(\d+\.\d+\.\d+)[^\S\n]*(?:[—-]+[^\S\n]*(\d{4}-\d{2}-\d{2}))?[^\S\n]*(?:[—-]+[^\S\n]*([^\n]*))?\n([\s\S]*?)(?=^## |(?![\s\S]))/gm;
    let m;
    const txt = fs.readFileSync(p, 'utf8');
    while ((m = re.exec(txt)))
        out.push({ version: m[1], date: m[2] || '', title: (m[3] || '').trim(), text: m[4].trim() });
    return out;
}

/* ------------------------------ montagem ------------------------------ */
const SKIP_EXT = new Set(['.map', '.log', '.tmp', '.part', '.bak', '.ts']);
function copyTree(src, dst, filter = () => true) {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, e.name), d = path.join(dst, e.name);
        if (!filter(s, e))
            continue;
        if (e.isDirectory())
            copyTree(s, d, filter);
        else
            fs.copyFileSync(s, d);
    }
}
function rmrf(p) {
    fs.rmSync(p, { recursive: true, force: true });
}
function cmdBuild() {
    run(path.join(ROOT, 'node_modules', '.bin', WIN ? 'tsc.cmd' : 'tsc'), ['-p', 'tsconfig.json']);
}
function prodModules(dst) {
    const cache = path.join(CACHE, 'prod');
    const lock = path.join(ROOT, 'package-lock.json');
    const stamp = path.join(cache, '.lock-sha');
    const want = sha256File(lock) + '|' + process.platform + '|' + process.arch;
    if (!fs.existsSync(path.join(cache, 'node_modules')) || !fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== want) {
        log('instalando dependências de produção...');
        rmrf(cache);
        fs.mkdirSync(cache, { recursive: true });
        fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(cache, 'package.json'));
        fs.copyFileSync(lock, path.join(cache, 'package-lock.json'));
        run(WIN ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: cache });
        fs.writeFileSync(stamp, want);
    }
    copyTree(path.join(cache, 'node_modules'), dst, (p, e) => {
        if (e.isDirectory())
            return !['.bin', 'test', 'tests', '__tests__', 'docs', 'example', 'examples', '.github'].includes(e.name);
        const ext = path.extname(e.name).toLowerCase();
        return !['.md', '.markdown', '.ts', '.map', '.txt'].includes(ext) || /licen[cs]e/i.test(e.name);
    });
}
function cmdApp(dst = path.join(OUT, 'stage', 'app')) {
    cmdBuild();
    rmrf(dst);
    fs.mkdirSync(dst, { recursive: true });
    copyTree(path.join(ROOT, 'dist', 'main'), path.join(dst, 'main'), (p, e) => e.isDirectory() || !SKIP_EXT.has(path.extname(e.name)));
    copyTree(path.join(ROOT, 'src', 'renderer'), path.join(dst, 'ui'));
    copyTree(path.join(ROOT, 'src', 'main', 'assets'), path.join(dst, 'assets'));
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    fs.writeFileSync(path.join(dst, 'package.json'), JSON.stringify({ name: pkg.name, productName: 'LudrixHub', version: version(), main: 'main/boot.js', private: true, dependencies: pkg.dependencies }, null, 2));
    fs.copyFileSync(VERSION_FILE, path.join(dst, 'version.json'));
    for (const f of ['LICENSE', 'CHANGELOG.md'])
        if (fs.existsSync(path.join(ROOT, f)))
            fs.copyFileSync(path.join(ROOT, f), path.join(dst, f));
    prodModules(path.join(dst, 'node_modules'));
    const integrity = mod('integrity.js');
    integrity.write(dst, version());
    log('app:', dst);
    return dst;
}
function electronDist() {
    const d = path.join(ROOT, 'node_modules', 'electron', 'dist');
    if (!fs.existsSync(path.join(d, WIN ? 'electron.exe' : 'electron')))
        die('node_modules/electron/dist não encontrado — rode npm ci');
    return d;
}
function cmdRuntime(dst = path.join(OUT, 'stage', 'runtime')) {
    const src = electronDist();
    rmrf(dst);
    copyTree(src, dst, (p, e) => !(e.isFile() && e.name === 'default_app.asar'));
    const exe = path.join(dst, WIN ? 'electron.exe' : 'electron');
    const target = path.join(dst, WIN ? 'Ludrix.exe' : 'Ludrix');
    fs.renameSync(exe, target);
    const shim = path.join(dst, 'resources', 'app');
    fs.mkdirSync(shim, { recursive: true });
    for (const f of ['main.js', 'package.json'])
        fs.copyFileSync(path.join(ROOT, 'tools', 'runtime-shim', f), path.join(shim, f));
    const shimPkg = JSON.parse(fs.readFileSync(path.join(shim, 'package.json'), 'utf8'));
    shimPkg.version = version();
    fs.writeFileSync(path.join(shim, 'package.json'), JSON.stringify(shimPkg));
    if (WIN)
        brandExe(target, 'LudrixHub', 'Ludrix.exe');
    log('runtime:', dst);
    return dst;
}
function brandExe(exe, desc, orig) {
    let rcedit;
    try {
        rcedit = require(path.join(ROOT, 'node_modules', 'rcedit'));
    }
    catch {
        log('aviso: pacote rcedit ausente — ícone/versão do', path.basename(exe), 'ficam os do Electron');
        return;
    }
    const v = version();
    const icon = path.join(ROOT, 'src', 'main', 'assets', 'icons', 'icon.ico');
    const done = rcedit(exe, {
        'version-string': { CompanyName: 'WOLFFZ', FileDescription: desc, ProductName: 'LudrixHub', OriginalFilename: orig, LegalCopyright: 'MIT', InternalName: 'Ludrix' },
        'file-version': v, 'product-version': v, icon,
    });
    if (done && typeof done.then === 'function')
        return done.catch((e) => log('aviso: rcedit falhou:', e.message || e));
}
function cmdFolder() {
    const v = version();
    const folder = path.join(rel(), 'Ludrix');
    rmrf(folder);
    fs.mkdirSync(folder, { recursive: true });
    cmdApp(path.join(folder, 'app'));
    cmdRuntime(path.join(folder, 'runtime'));
    const bin = path.join(ROOT, 'src', 'main', 'assets', 'bin');
    for (const f of ['Ludrix.exe', 'LudrixConsole.exe'])
        fs.copyFileSync(path.join(bin, f), path.join(folder, f));
    for (const d of ['data', 'games', 'emulation', 'downloads'])
        fs.mkdirSync(path.join(folder, d), { recursive: true });
    fs.writeFileSync(path.join(folder, 'LEIA-ME.txt'), `LudrixHub ${v}\r\n\r\nAbra Ludrix.exe. Tudo fica nesta pasta (jogos, configurações, emuladores).\r\nLudrixConsole.exe abre o modo console (controle).\r\nAtualizações: dentro do Ludrix, em Ajustes > Checar atualizações.\r\n`);
    rmrf(path.join(OUT, 'stage'));
    log('pasta pronta:', folder);
    return folder;
}

/* ------------------------------ zip (streaming) ------------------------------ */
function sha256Stream(file) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash('sha256');
        fs.createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest())).on('error', reject);
    });
}
class ZipOut {
    constructor(out) {
        this.out = out;
        this.items = new Map();
    }
    file(arc, src) { this.items.set(arc, { src }); }
    data(arc, buf) { this.items.set(arc, { buf: Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8') }); }
    tree(folder, prefix, filter = () => true) {
        const walk = (dir, relp) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
                const p = path.join(dir, e.name), r = relp ? `${relp}/${e.name}` : e.name;
                if (!filter(p, e))
                    continue;
                if (e.isDirectory())
                    walk(p, r);
                else if (e.isFile())
                    this.file(prefix ? `${prefix}/${r}` : r, p);
            }
        };
        walk(folder, '');
    }
    async write(seed) {
        const yazl = require(path.join(ROOT, 'node_modules', 'yazl'));
        const zip = new yazl.ZipFile();
        const names = [...this.items.keys()].sort();
        const digest = crypto.createHash('sha256');
        for (const n of names) {
            const it = this.items.get(n);
            const h = it.buf ? crypto.createHash('sha256').update(it.buf).digest() : await sha256Stream(it.src);
            digest.update(Buffer.from(n, 'utf8'));
            digest.update(Buffer.from([0]));
            digest.update(h);
            if (it.buf)
                zip.addBuffer(it.buf, n, { mtime: new Date(), mode: 0o100644 });
            else
                zip.addFile(it.src, n, { mode: n.endsWith('.sh') || /\/(Ludrix|chrome-sandbox|chrome_crashpad_handler|ludrix-gamepad)$/.test(n) ? 0o100755 : 0o100644 });
        }
        if (seed) {
            const c = mod('crypto.js');
            const sig = c.sign(digest.digest(), seed);
            zip.addBuffer(Buffer.from(sig.toString('hex'), 'utf8'), c.SIG_NAME, { mtime: new Date(), mode: 0o100644 });
        }
        zip.end();
        const tmp = this.out + '.part';
        await new Promise((resolve, reject) => {
            const ws = fs.createWriteStream(tmp);
            zip.outputStream.pipe(ws).on('close', resolve).on('error', reject);
            zip.outputStream.on('error', reject);
        });
        fs.renameSync(tmp, this.out);
        return this.out;
    }
}
function seedOrDie(required) {
    const c = mod('crypto.js');
    const seed = c.loadSeed();
    if (!seed) {
        if (required)
            die(`assinatura: chave não encontrada (${c.keyPaths().join(', ')}). Nunca publique sem assinar.`, 4);
        log('aviso: sem chave — pacote não assinado');
        return null;
    }
    return seed;
}
function verifySigned(file) {
    const c = mod('crypto.js');
    const st = c.zipStatus(file);
    if (st !== 'ok')
        die(`assinatura de ${path.basename(file)} não confere (${st})`, 4);
    log('assinado:', path.basename(file));
}

async function cmdZip() {
    const v = version();
    const folder = path.join(rel(), 'Ludrix');
    if (!fs.existsSync(path.join(folder, 'runtime')))
        cmdFolder();
    const out = path.join(rel(), `Ludrix-${v}.zip`);
    const z = new ZipOut(out);
    z.tree(folder, 'Ludrix');
    await z.write(null);
    log('zip:', out, `(${Math.round(fs.statSync(out).size / 1024)} KB)`);
    return out;
}
async function cmdSrc() {
    const v = version();
    const out = path.join(rel(), `Ludrix-${v}-src.zip`);
    const z = new ZipOut(out);
    const skip = (p, e) => !(e.isDirectory() && ['node_modules', 'dist', 'release', 'build-cache', '.git'].includes(e.name));
    for (const d of ['src', 'tools'])
        z.tree(path.join(ROOT, d), `Ludrix-src/${d}`, skip);
    for (const f of ['package.json', 'package-lock.json', 'tsconfig.json', 'version.json', 'electron-builder.yml', 'build.bat', 'README.md', 'README.en.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE', '.gitignore'])
        if (fs.existsSync(path.join(ROOT, f)))
            z.file(`Ludrix-src/${f}`, path.join(ROOT, f));
    await z.write(seedOrDie(false));
    log('src:', out, `(${Math.round(fs.statSync(out).size / 1024)} KB)`);
    return out;
}
function manifest(kind, dirs, files, minVersion) {
    const v = version();
    return { version: v, kind, min_version: minVersion || '', date: new Date().toISOString().slice(0, 10), title: (kind === 'patch' ? 'Patch ' : 'Ludrix ') + v, changelog: changelogFor(v), changelog_all: changelogAll(), dirs, files };
}
function stageApp() {
    const folder = path.join(rel(), 'Ludrix');
    const app = path.join(folder, 'app');
    if (!fs.existsSync(path.join(app, 'main', 'boot.js')))
        cmdApp(app);
    return app;
}
async function cmdPatch(minVersion) {
    const v = version();
    const app = stageApp();
    const out = path.join(rel(), `ludrix-${v}-patch.lxup`);
    const seed = seedOrDie(true);
    const z = new ZipOut(out);
    z.data('manifest.json', JSON.stringify(manifest('patch', ['app'], {}, minVersion || (v.startsWith('4.') ? '4.0.0' : '')), null, 1));
    z.tree(app, 'app');
    await z.write(seed);
    log('patch:', out, `(${Math.round(fs.statSync(out).size / 1024)} KB)`);
    verifySigned(out);
    return out;
}
async function cmdFull() {
    const v = version();
    const folder = path.join(rel(), 'Ludrix');
    if (!fs.existsSync(path.join(folder, 'runtime')))
        cmdFolder();
    const out = path.join(rel(), `ludrix-${v}-full.lxup`);
    const seed = seedOrDie(true);
    const files = { 'Ludrix.exe': sha256File(path.join(folder, 'Ludrix.exe')), 'LudrixConsole.exe': sha256File(path.join(folder, 'LudrixConsole.exe')) };
    const z = new ZipOut(out);
    z.data('manifest.json', JSON.stringify(manifest('full', ['app', 'runtime'], files, null), null, 1));
    z.tree(path.join(folder, 'app'), 'app');
    z.tree(path.join(folder, 'runtime'), 'runtime');
    z.file('Ludrix.exe', path.join(folder, 'Ludrix.exe'));
    z.file('LudrixConsole.exe', path.join(folder, 'LudrixConsole.exe'));
    await z.write(seed);
    log('full:', out, `(${Math.round(fs.statSync(out).size / 1024)} KB)`);
    verifySigned(out);
    return out;
}
const vt = (v) => (String(v || '0').match(/\d+/g) || ['0']).slice(0, 3).map(Number);
const vlt = (a, b) => { const x = vt(a), y = vt(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); return false; };
function feedUrl(base, ver, name) {
    if (base.replace(/\/$/, '') === FEED_BASE)
        return `https://github.com/${FEED_REPO}/releases/download/v${ver}/${name}`;
    return base.replace(/\/$/, '') + '/' + name;
}
async function feedPrevious(base) {
    if (base.replace(/\/$/, '') !== FEED_BASE)
        return [];
    try {
        const r = await fetch(FEED_BASE + '/ludrix-updates.json', { headers: { 'User-Agent': 'ludrix-build', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000) });
        const data = await r.json();
        return (data.all || []).filter((it) => it && it.version && it.url).map((it) => ({ ...it, url: feedUrl(base, it.version, String(it.url).split('/').pop()) }));
    }
    catch (e) {
        log('feed: sem feed anterior pra herdar (' + String(e.message || e).slice(0, 60) + ')');
        return [];
    }
}
async function cmdFeed(base = FEED_BASE) {
    const v = version();
    const items = [];
    for (const kind of ['patch', 'full']) {
        const p = path.join(rel(), `ludrix-${v}-${kind}.lxup`);
        if (!fs.existsSync(p))
            continue;
        const m = JSON.parse(new (AdmZip())(p).readAsText('manifest.json'));
        items.push({ version: v, kind, url: feedUrl(base, v, path.basename(p)), sha256: sha256File(p), size: fs.statSync(p).size, min_version: m.min_version || '', title: m.title, changelog: m.changelog || '', date: m.date });
    }
    if (!items.length)
        die('feed: nenhum .lxup em ' + rel());
    const latest = items.find((i) => i.kind === 'patch') || items[0];
    const seen = new Set(items.map((i) => i.version + '|' + i.kind));
    const older = (await feedPrevious(base)).filter((i) => !seen.has(i.version + '|' + i.kind) && vlt(i.version, v)).sort((a, b) => vlt(a.version, b.version) ? 1 : -1);
    items.push(...older.slice(0, 12));
    const out = path.join(rel(), 'ludrix-updates.json');
    fs.writeFileSync(out, JSON.stringify({ latest, all: items }, null, 1));
    log('feed:', out, `(${items.length} pacote(s))`);
}
function cmdBump(v) {
    if (!/^\d+\.\d+\.\d+$/.test(v))
        die('versão inválida: ' + v);
    const info = vinfo();
    info.version = v;
    info.date = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(VERSION_FILE, JSON.stringify(info, null, 2) + '\n');
    for (const f of ['package.json', path.join('tools', 'runtime-shim', 'package.json')]) {
        const p = path.join(ROOT, f);
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        j.version = v;
        fs.writeFileSync(p, JSON.stringify(j, null, f === 'package.json' ? 2 : 0) + '\n');
    }
    const rc = path.join(ROOT, 'tools', 'native', 'launcher.rc');
    if (fs.existsSync(rc))
        fs.writeFileSync(rc, fs.readFileSync(rc, 'utf8').replace(/\d+,\d+,\d+,0/g, v.replace(/\./g, ',') + ',0').replace(/"\d+\.\d+\.\d+"/g, `"${v}"`));
    log('versão:', v);
}
function cmdCheck() {
    cmdBuild();
    const problems = [];
    for (const f of ['version.json', 'package.json'])
        try {
            JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
        }
        catch (e) {
            problems.push(`${f}: ${e.message}`);
        }
    const presets = path.join(ROOT, 'src', 'main', 'assets', 'presets');
    if (fs.existsSync(presets))
        for (const f of fs.readdirSync(presets).filter((n) => n.endsWith('.json')))
            try {
                JSON.parse(fs.readFileSync(path.join(presets, f), 'utf8'));
            }
            catch (e) {
                problems.push(`presets/${f}: ${e.message}`);
            }
    if (!changelogFor(version()))
        problems.push(`CHANGELOG.md sem a seção ## ${version()}`);
    for (const f of ['Ludrix.exe', 'LudrixConsole.exe', 'ludrix-gamepad.exe'])
        if (!fs.existsSync(path.join(ROOT, 'src', 'main', 'assets', 'bin', f)))
            problems.push(`falta src/main/assets/bin/${f} (tools/native/build.sh)`);
    if (problems.length) {
        for (const p of problems)
            log('PROBLEMA:', p);
        process.exit(3);
    }
    log('check: ok');
}
function cmdPublish() {
    const v = version();
    const files = [`ludrix-${v}-patch.lxup`, `ludrix-${v}-full.lxup`, 'ludrix-updates.json', `Ludrix-${v}.zip`, `Ludrix-${v}-src.zip`].map((f) => path.join(rel(), f)).filter((f) => fs.existsSync(f));
    if (!files.some((f) => f.endsWith('.lxup')))
        die('publish: gere o patch antes (build.js patch)', 5);
    const c = mod('crypto.js');
    for (const f of files)
        if (/\.(lxup|zip)$/.test(f) && !/Ludrix-\d.*\.zip$/.test(path.basename(f)) && c.zipStatus(f) !== 'ok')
            die(`publish: ${path.basename(f)} não está assinado`, 4);
    const notes = changelogFor(v) || `Ludrix ${v}`;
    const notesFile = path.join(rel(), 'release-notes.md');
    fs.writeFileSync(notesFile, notes);
    const r = cp.spawnSync(WIN ? 'gh.exe' : 'gh', ['release', 'create', `v${v}`, ...files, '--repo', FEED_REPO, '--title', `Ludrix ${v}`, '--notes-file', notesFile, '--latest'], { stdio: 'inherit' });
    try { fs.unlinkSync(notesFile); } catch { }
    if (r.error || r.status !== 0) {
        log('gh (GitHub CLI) falhou ou não existe' + (r.error ? ' (' + r.error.message + ')' : ' (código ' + r.status + ')') + '. Publique à mão:');
        log(`  1. https://github.com/${FEED_REPO}/releases/new   Tag: v${v}   Título: Ludrix ${v}`);
        log('  2. Arraste:');
        for (const f of files)
            log('     ', f);
        process.exit(r.status || 5);
    }
    log('publicado');
}
async function cmdAll(minVersion) {
    cmdCheck();
    cmdFolder();
    await cmdZip();
    await cmdPatch(minVersion);
    await cmdFull();
    await cmdSrc();
    await cmdFeed();
    rmrf(path.join(OUT, 'stage'));
    rmrf(path.join(ROOT, 'dist'));
    log('tudo em', rel());
}

const HELP = `uso: node tools/build.js <comando>
  check            compila e valida json/changelog/binários
  app              monta release/stage/app (código + ui + node_modules de produção + integrity.json)
  runtime          monta release/stage/runtime (Electron renomeado + shim)
  folder           pasta Ludrix/ completa em release/<versão>/
  zip              Ludrix-<v>.zip
  patch [min]      ludrix-<v>-patch.lxup (só app/), assinado
  full             ludrix-<v>-full.lxup (app/ + runtime/ + exes), assinado
  src              Ludrix-<v>-src.zip
  feed [base]      ludrix-updates.json
  all [min]        tudo acima
  bump X.Y.Z       troca a versão (version.json, package.json, shim, rc)
  publish          gh release create com os arquivos de release/<versão>/`;

(async () => {
    const [cmd, ...args] = process.argv.slice(2);
    switch (cmd) {
        case 'check': return cmdCheck();
        case 'build': return cmdBuild();
        case 'app': return void cmdApp();
        case 'runtime': return void cmdRuntime();
        case 'folder': return void cmdFolder();
        case 'zip': return cmdZip();
        case 'patch': return cmdPatch(args[0]);
        case 'full': return cmdFull();
        case 'src': return cmdSrc();
        case 'feed': return cmdFeed(args[0]);
        case 'all': return cmdAll(args[0]);
        case 'bump': return cmdBump(args[0]);
        case 'publish': return cmdPublish();
        default: log(HELP); process.exit(cmd ? 2 : 0);
    }
})().catch((e) => die(String(e && e.stack || e)));
