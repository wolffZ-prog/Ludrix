#!/usr/bin/env node
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const ROOT = path.resolve(__dirname, '..');
const R = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(R(p), 'utf8');
let fails = 0, warns = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m) => { fails++; console.log('  FAIL ' + m); };
const warn = (m) => { warns++; console.log('  aviso ' + m); };
const step = (t) => console.log('\n' + t);

step('1. TypeScript (tsc)');
{
  const tsc = R(process.platform === 'win32' ? 'node_modules/.bin/tsc.cmd' : 'node_modules/.bin/tsc');
  if (!fs.existsSync(tsc)) bad('node_modules ausente — rode npm i');
  else {
    const r = cp.spawnSync(tsc, ['-p', R('tsconfig.json'), '--noEmit'], { encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.status === 0) ok('compila sem erros'); else bad('tsc:\n' + (r.stdout || r.stderr).trim().split('\n').slice(0, 20).join('\n'));
  }
}

step('2. Sintaxe do renderer');
for (const f of fs.readdirSync(R('src/renderer')).filter((x) => x.endsWith('.js'))) {
  try { new Function(read('src/renderer/' + f)); ok(f); }
  catch (e) { bad(`${f}: ${e.message}`); }
}

step('3. JSONs');
for (const f of ['package.json', 'src/renderer/lang/en.json']) {
  try { JSON.parse(read(f)); ok(f); } catch (e) { bad(`${f}: ${e.message}`); }
}
try {
  const en = JSON.parse(read('src/renderer/lang/en.json'));
  const badStr = Object.entries(en.strings || {}).filter(([, v]) => typeof v !== 'string');
  if (badStr.length) bad(`en.json strings não-texto: ${badStr.slice(0, 5).map((x) => x[0]).join(', ')}`); else ok(`en.json ${Object.keys(en.strings || {}).length} strings, ${(en.patterns || []).length} padrões`);
  for (const [re] of en.patterns || []) { try { new RegExp(re); } catch (e) { bad(`en.json padrão inválido: ${re}`); } }
} catch { /* já reportado */ }

const RJS = fs.readdirSync(R('src/renderer')).filter((x) => x.endsWith('.js'));
const app = RJS.map((f) => read('src/renderer/' + f)).join('\n');
step('3b. Funções globais duplicadas entre os arquivos do renderer');
{
  const seen = new Map(), dups = [];
  for (const f of RJS) for (const m of read('src/renderer/' + f).matchAll(/^(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/gm)) { if (seen.has(m[1]) && seen.get(m[1]) !== f) dups.push(`${m[1]} (${seen.get(m[1])} e ${f})`); seen.set(m[1], f); }
  if (dups.length) bad(`duplicadas: ${dups.join(', ')}`); else ok(`${seen.size} funções, nenhuma duplicada`);
  const html = read('src/renderer/index.html');
  const notLoaded = RJS.filter((f) => !html.includes(`/ui/${f}"`) && f !== 'console.js');
  if (notLoaded.length) warn(`não carregados pelo index.html: ${notLoaded.join(', ')}`); else ok('index.html carrega todos');
}
const backend = read('src/main/backend.ts');

step('4. Menu de contexto: ids do backend × ctxDo');
{
  const start = backend.indexOf('contextActions(key');
  const nextM = backend.slice(start + 10).search(/\n    (?:async )?[a-zA-Z_]+\([^)]*\)(?::[^{]+)? \{\n/);
  const block = backend.slice(start, nextM > 0 ? start + 10 + nextM : start + 20000);
  const ids = new Set([...block.matchAll(/\bid: '([a-z_]+)'/g)].filter((m) => !/\bsub:/.test(block.slice(m.index, block.indexOf('\n', m.index)))).map((m) => m[1]));
  const ctx = app.slice(app.indexOf('async function ctxDo('), app.indexOf('\n}\n', app.indexOf('async function ctxDo(')));
  const handled = new Set([...ctx.matchAll(/case '([a-z_]+)'/g)].map((m) => m[1]));
  const prefixes = [...ctx.matchAll(/id\.startsWith\('([a-z_]+):'\)/g)].map((m) => m[1]);
  const missing = [...ids].filter((id) => !handled.has(id) && !prefixes.includes(id));
  if (missing.length) bad(`sem case em ctxDo: ${missing.join(', ')}`); else ok(`${ids.size} ids cobertos`);
  const icons = new Set([...block.matchAll(/\bicon: '([a-z_0-9]+)'/g)].map((m) => m[1]));
  const imap = app.slice(app.indexOf('const I = {'), app.indexOf('\n};', app.indexOf('const I = {')));
  const ikeys = new Set([...imap.matchAll(/^  ([a-z_0-9]+):/gm)].map((m) => m[1]));
  const noIcon = [...icons].filter((i) => !ikeys.has(i));
  if (noIcon.length) bad(`ícones do menu sem svg em I: ${noIcon.join(', ')}`); else ok(`${icons.size} ícones do menu existem`);
  step('5. Ícones usados no renderer × mapa I');
  const used = new Set([...app.matchAll(/\bI\.([a-z_0-9]+)\b/g)].map((m) => m[1]));
  const miss = [...used].filter((k) => !ikeys.has(k));
  if (miss.length) bad(`I.${miss.join(', I.')} não existem`); else ok(`${used.size} ícones usados existem`);
}

step('6. Chaves de config gravadas pelo renderer × DEFAULT_CONFIG');
{
  const store = read('src/main/store.ts');
  const dblock = store.slice(store.indexOf('const DEFAULT_CONFIG = {'), store.indexOf('\n};', store.indexOf('const DEFAULT_CONFIG = {')));
  const defaults = new Set([...dblock.matchAll(/^\s+([a-z_0-9]+):/gm)].map((m) => m[1]));
  const used = new Set();
  for (const m of app.matchAll(/setCfg\(\{\s*([a-z_0-9]+):/g)) used.add(m[1]);
  for (const m of app.matchAll(/\bsw\('([a-z_0-9]+)'/g)) used.add(m[1]);
  for (const m of app.matchAll(/\bcfgSel\('([a-z_0-9]+)'/g)) used.add(m[1]);
  const missing = [...used].filter((k) => !defaults.has(k));
  if (missing.length) bad(`sem default em store.ts (serão descartadas ao salvar): ${missing.join(', ')}`); else ok(`${used.size} chaves têm default`);
}

step('7. Rotas chamadas pelo renderer × servidor');
{
  const srv = read('src/main/server.ts') + read('src/main/server2.ts');
  const routes = new Set([...srv.matchAll(/p === '(\/api\/[a-z0-9_/.-]+)'/g)].map((m) => m[1]));
  const prefixes = [...srv.matchAll(/p\.startsWith\('(\/api\/[a-z0-9_/.-]+)'\)/g)].map((m) => m[1]);
  const calls = new Set([...app.matchAll(/api\.(?:get|post)\('(\/api\/[a-z0-9_/.-]+)'/g)].map((m) => m[1]));
  const miss = [...calls].filter((c) => !routes.has(c) && !prefixes.some((p) => c.startsWith(p)));
  if (miss.length) warn(`rotas sem match literal (podem ser dinâmicas): ${miss.join(', ')}`); else ok(`${calls.size} rotas conferem`);
}

if (process.argv.includes('--boot')) {
  step('8. Boot de teste');
  if (!process.env.DISPLAY && process.platform === 'linux') warn('sem DISPLAY — pulei o boot');
  else {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ludrix-check-'));
    const electron = R(process.platform === 'win32' ? 'node_modules/.bin/electron.cmd' : 'node_modules/.bin/electron');
    const child = cp.spawn(electron, ['--no-sandbox', ROOT], { env: { ...process.env, LUDRIX_HOME: home, LUDRIX_PORTABLE: '0' }, stdio: 'ignore', detached: true, shell: process.platform === 'win32' });
    const inst = path.join(home, 'data', 'instance.json');
    const t0 = Date.now();
    const wait = setInterval(() => {
      let port = 0;
      try { port = JSON.parse(fs.readFileSync(inst, 'utf8')).port; } catch { /* ainda não */ }
      if (port) {
        clearInterval(wait);
        const http = require('http');
        http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
          let body = '';
          res.on('data', (d) => body += d);
          res.on('end', () => {
            const tok = /ludrix-token" content="([^"]+)/.exec(body);
            if (!tok) { bad('página inicial sem token'); return done(); }
            http.get({ host: '127.0.0.1', port, path: '/api/config', headers: { 'X-Ludrix-Token': tok[1], Origin: `http://127.0.0.1:${port}` } }, (r2) => {
              let b2 = '';
              r2.on('data', (d) => b2 += d);
              r2.on('end', () => { try { JSON.parse(b2); ok(`app subiu em ${((Date.now() - t0) / 1000).toFixed(1)} s e /api/config responde`); } catch { bad('/api/config não devolveu JSON'); } done(); });
            }).on('error', () => { bad('/api/config falhou'); done(); });
          });
        }).on('error', () => { bad('servidor não respondeu'); done(); });
      } else if (Date.now() - t0 > 40000) { clearInterval(wait); bad('app não subiu em 40 s'); done(); }
    }, 500);
    const done = () => {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill(); } catch { /* */ } }
      setTimeout(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* */ } finish(); }, 1500);
    };
  }
} else finish();

function finish() {
  console.log(`\n${fails ? `${fails} problema(s)` : 'Tudo certo'}${warns ? ` · ${warns} aviso(s)` : ''}`);
  process.exit(fails ? 1 : 0);
}
