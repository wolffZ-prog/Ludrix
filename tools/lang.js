const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/renderer/lang/en.json'), 'utf8'));
const dict = en.strings || {};
const rx = (en.patterns || []).map(([a, b]) => [new RegExp(a, 'g'), b]);
const PT = /[ãõçáéíóúâêôà]|\b(de|da|dos|das|não|com|para|por|uma?|os|ou|em|na|nos|nas|que|ao|seu|sua|este|esta|isso|já|mais|sem|pelo|pela|jogo|jogos|pasta|arquivo|abrir|fechar|nenhum|nenhuma|todos|todas|aqui|agora|depois|antes|outro|outra|novo|nova|você)\b/i;
const SKIP = /^(https?:|\/|~\/|[a-z_]+:|#|\.|\{|[\w.-]+@|[a-z0-9.-]+\.(com|org|net)\b|[a-z-]+$|[\d\s.,:;%()\-+×·…]*$)/i;

function translated(k) {
    if (dict[k] !== undefined) return true;
    if (k.includes('\u0000')) {
        const sample = k.replace(/\u0000/g, '1');
        let v = sample;
        for (const [r, b] of rx) v = v.replace(r, b);
        return v !== sample && !PT.test(v);
    }
    let v = k;
    for (const [r, b] of rx) v = v.replace(r, b);
    return v !== k && !PT.test(v);
}

function segments(raw) {
    const out = [];
    for (const m of raw.matchAll(/(?:title|placeholder|aria-label|data-help)="([^"]*)"/g)) out.push(m[1]);
    const body = raw.replace(/\b[a-z-]+="[^"]*"/g, ' ').replace(/^[^<]*>/, ' ').replace(/<[^>]*$/, ' ').replace(/<[^>]*>/g, '\n');
    out.push(...body.split(/\\n|\n/));
    return out.map((s) => s.replace(/&[a-z]+;/g, ' ').replace(/\$\{[^}]*\}/g, '\u0000').replace(/^(\s*\u0000)+\s*|\s*(\u0000\s*)+$/g, '').trim()).filter((s) => s && !/^[\u0000\s]*$/.test(s));
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = args.length ? args : ['src/renderer/app.js', 'src/renderer/settings.js', 'src/renderer/detail.js', 'src/renderer/console/console.js', 'src/renderer/index.html'];
const miss = new Map();
for (const rel of files) {
    const f = path.join(ROOT, rel);
    const text = fs.readFileSync(f, 'utf8');
    const line = (pos) => text.slice(0, pos).split('\n').length;
    const take = (raw, pos) => {
        for (const s of segments(raw)) {
            if (SKIP.test(s) || !PT.test(s) || s.length < 3) continue;
            if (!translated(s) && !miss.has(s)) miss.set(s, `${path.basename(rel)}:${line(pos)}`);
        }
    };
    if (rel.endsWith('.html')) {
        take(text.replace(/<script[\s\S]*?<\/script>/g, ''), 0);
        for (const m of text.matchAll(/(?:title|placeholder|aria-label|data-help)="([^"]*)"/g)) take(m[1], m.index);
        continue;
    }
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const visit = (n) => {
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) take(n.text, n.getStart(sf));
        else if (ts.isTemplateExpression(n))
            take(n.head.text + n.templateSpans.map((sp) => '${}' + sp.literal.text).join(''), n.getStart(sf));
        ts.forEachChild(n, visit);
    };
    visit(sf);
}
const out = [...miss.entries()].sort((a, b) => a[1].localeCompare(b[1]));
if (process.argv.includes('--json')) console.log(JSON.stringify(Object.fromEntries(out.map(([k, v]) => [k, v])), null, 1));
else for (const [k, v] of out) console.log(`${v}\t${k.replace(/\u0000/g, '{…}')}`);
console.error(`sem tradução: ${out.length}`);
process.exit(out.length > 10 ? 1 : 0);
