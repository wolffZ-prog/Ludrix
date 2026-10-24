export interface Issue { at: string; msg: string; }
export interface Report { format: 'ludrix' | 'hydra' | 'unknown'; games: number; usable: number; errors: Issue[]; warnings: Issue[]; skipped: number[]; }

export const KINDS = ['pc', 'rom', 'recomp', 'emulator', 'tool'];
const GAME_KEYS = new Set(['id', 'title', 'kind', 'system', 'creator', 'developer', 'publisher', 'year', 'description', 'cover', 'thumb', 'hero', 'genres', 'tags', 'page_url', 'files', 'magnet', 'torrent', 'github', 'asset', 'needs', 'exe', 'requires_rom', 'patches', 'size', 'host', 'prefer', 'version', 'note', 'notes', 'languages', 'repack', 'uploaded']);
const ROOT_KEYS = new Set(['name', 'format', 'kind', 'system', 'games', 'sources', 'version', 'description', 'author', 'updated', 'url', 'note', '$schema']);
const FILE_KEYS = new Set(['name', 'url', 'size', 'note', 'host']);
const MAX = 60;

const isStr = (v: any) => typeof v === 'string' && v.trim().length > 0;
const isHttp = (v: any) => typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim());
const isMagnet = (v: any) => typeof v === 'string' && /^magnet:\?/i.test(v.trim()) && /xt=urn:btih:[a-z0-9]{32,40}/i.test(v);
const isLocalPath = (v: any) => typeof v === 'string' && (/^[A-Za-z]:[\\/]/.test(v) || v.startsWith('\\\\') || v.startsWith('/'));

export function sizeOf(v: any): number {
    if (typeof v === 'number')
        return Number.isFinite(v) && v >= 0 ? Math.trunc(v) : -1;
    if (typeof v !== 'string' || !v.trim())
        return 0;
    const m = /^\s*([\d.,]+)\s*(TB|GB|MB|KB|B|TiB|GiB|MiB|KiB)?\s*$/i.exec(v);
    if (!m)
        return -1;
    const n = parseFloat(m[1].replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
    if (!Number.isFinite(n))
        return -1;
    const u = (m[2] || 'B').toLowerCase().replace('i', '');
    const mult: Record<string, number> = { tb: 2 ** 40, gb: 2 ** 30, mb: 2 ** 20, kb: 2 ** 10, b: 1 };
    return Math.trunc(n * (mult[u] || 1));
}

export function validateManifest(data: any, systems: Record<string, any> = {}): Report {
    const rep: Report = { format: 'unknown', games: 0, usable: 0, errors: [], warnings: [], skipped: [] };
    const err = (at: string, msg: string) => { if (rep.errors.length < MAX) rep.errors.push({ at, msg }); else if (rep.errors.length === MAX) rep.errors.push({ at: '…', msg: 'mais erros omitidos' }); };
    const warn = (at: string, msg: string) => { if (rep.warnings.length < MAX) rep.warnings.push({ at, msg }); else if (rep.warnings.length === MAX) rep.warnings.push({ at: '…', msg: 'mais avisos omitidos' }); };
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        err('raiz', Array.isArray(data) ? 'o JSON é uma lista; precisa ser um objeto { "games": [ … ] }' : 'o JSON não é um objeto');
        return rep;
    }
    if (Array.isArray(data.downloads) && !Array.isArray(data.games)) {
        rep.format = 'hydra';
        rep.games = data.downloads.length;
        data.downloads.forEach((d: any, i: number) => {
            const at = `item ${i + 1}${d && d.title ? ` "${String(d.title).slice(0, 50)}"` : ''}`;
            if (!d || typeof d !== 'object') { err(at, 'não é um objeto'); rep.skipped.push(i); return; }
            if (!isStr(d.title)) { err(at, 'sem "title"'); rep.skipped.push(i); return; }
            const uris = Array.isArray(d.uris) ? d.uris.filter((u: any) => typeof u === 'string') : [];
            if (!uris.length) { err(at, '"uris" vazio — nada para baixar'); rep.skipped.push(i); return; }
            if (!uris.some((u: string) => isMagnet(u) || isHttp(u)))
                warn(at, 'nenhum link reconhecível (http ou magnet) em "uris"');
            if (d.fileSize !== undefined && sizeOf(d.fileSize) < 0)
                warn(at, `"fileSize" ilegível: ${JSON.stringify(d.fileSize)}`);
            rep.usable++;
        });
        return rep;
    }
    if (!Array.isArray(data.games)) {
        err('raiz', 'não encontrei a lista "games" (nem "downloads" do formato Hydra)');
        return rep;
    }
    rep.format = 'ludrix';
    for (const k of Object.keys(data))
        if (!ROOT_KEYS.has(k))
            warn('raiz', `campo desconhecido "${k}" (ignorado)`);
    if (data.kind !== undefined && !KINDS.includes(String(data.kind)))
        warn('raiz', `"kind" ${JSON.stringify(data.kind)} não é um de: ${KINDS.join(', ')} — tratado como "pc"`);
    if (data.system !== undefined && String(data.system) !== 'pc' && !systems[String(data.system)])
        warn('raiz', `"system" ${JSON.stringify(data.system)} não é uma plataforma conhecida`);
    rep.games = data.games.length;
    if (!rep.games)
        warn('raiz', 'a lista "games" está vazia');
    const ids = new Map<string, number>();
    const titles = new Map<string, number>();
    data.games.forEach((g: any, i: number) => {
        const at = `jogo ${i + 1}${g && isStr(g.title) ? ` "${String(g.title).slice(0, 50)}"` : ''}`;
        if (!g || typeof g !== 'object' || Array.isArray(g)) { err(at, 'não é um objeto'); rep.skipped.push(i); return; }
        if (!isStr(g.title)) { err(at, 'sem "title" (texto) — obrigatório'); rep.skipped.push(i); return; }
        for (const k of Object.keys(g))
            if (!GAME_KEYS.has(k))
                warn(at, `campo desconhecido "${k}" (ignorado)`);
        const ident = isStr(g.id) ? String(g.id) : String(g.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (g.id !== undefined && !isStr(g.id))
            warn(at, '"id" não é texto — gerado a partir do título');
        else if (isStr(g.id) && !/^[a-z0-9][a-z0-9._-]*$/i.test(String(g.id)))
            warn(at, `"id" com caracteres fora de letras, números, ponto, hífen e sublinhado: ${JSON.stringify(g.id)}`);
        if (ids.has(ident)) { err(at, `"id" repetido (${ident}) — já usado no jogo ${ids.get(ident)! + 1}; este é ignorado`); rep.skipped.push(i); return; }
        ids.set(ident, i);
        const tnorm = String(g.title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (titles.has(tnorm))
            warn(at, `título igual ao do jogo ${titles.get(tnorm)! + 1} — os dois ficam no catálogo; se é o mesmo jogo, junte os arquivos num só`);
        else
            titles.set(tnorm, i);
        const kind = g.kind !== undefined ? String(g.kind) : (data.kind !== undefined ? String(data.kind) : 'pc');
        if (g.kind !== undefined && !KINDS.includes(String(g.kind)))
            warn(at, `"kind" ${JSON.stringify(g.kind)} desconhecido — tratado como "pc"`);
        const sys = g.system !== undefined ? String(g.system) : (data.system !== undefined ? String(data.system) : '');
        if (kind === 'rom' && sys && sys !== 'pc' && !systems[sys])
            warn(at, `"system" ${JSON.stringify(sys)} não é uma plataforma conhecida — será adivinhada pela extensão do arquivo`);
        if (kind === 'rom' && !sys)
            warn(at, 'ROM sem "system" — será adivinhada pela extensão ou pelo título');
        let ways = 0;
        const files = g.files;
        if (files !== undefined) {
            if (!Array.isArray(files))
                err(at, '"files" precisa ser uma lista [ { "name", "url", "size" } ]');
            else
                files.forEach((f: any, j: number) => {
                    const fat = `${at} › arquivo ${j + 1}`;
                    if (!f || typeof f !== 'object') { err(fat, 'não é um objeto'); return; }
                    for (const k of Object.keys(f))
                        if (!FILE_KEYS.has(k))
                            warn(fat, `campo desconhecido "${k}"`);
                    if (!isHttp(f.url) && !isLocalPath(f.url)) { err(fat, `"url" inválida: ${JSON.stringify(f.url ?? null)} (precisa começar com http:// ou https://)`); return; }
                    if (!isStr(f.name))
                        warn(fat, '"name" ausente — o nome vem do fim da url');
                    if (f.size !== undefined && sizeOf(f.size) < 0)
                        warn(fat, `"size" ilegível: ${JSON.stringify(f.size)} (use bytes ou "12.5 GB")`);
                    if (f.size === undefined || sizeOf(f.size) === 0)
                        warn(fat, 'sem "size" — o espaço necessário e o tempo estimado não aparecem antes de baixar');
                    ways++;
                });
        }
        if (g.magnet !== undefined) {
            if (isMagnet(g.magnet))
                ways++;
            else
                err(at, '"magnet" inválido — precisa começar com magnet:?xt=urn:btih:');
        }
        if (g.torrent !== undefined) {
            if (isHttp(g.torrent) || isLocalPath(g.torrent))
                ways++;
            else
                err(at, '"torrent" precisa ser um link http(s) para o .torrent');
        }
        if (g.github !== undefined) {
            if (isStr(g.github) && /^[\w.-]+\/[\w.-]+$/.test(String(g.github).trim().replace(/^\/+|\/+$/g, '')))
                ways++;
            else
                err(at, `"github" precisa ser "dono/repositorio": ${JSON.stringify(g.github)}`);
        }
        if (!ways) { err(at, 'nenhuma forma de download válida: informe "files", "magnet", "torrent" ou "github"'); rep.skipped.push(i); return; }
        if (g.size !== undefined && sizeOf(g.size) < 0)
            warn(at, `"size" ilegível: ${JSON.stringify(g.size)}`);
        if (g.year !== undefined && !/^(19|20)\d\d$/.test(String(g.year)))
            warn(at, `"year" estranho: ${JSON.stringify(g.year)}`);
        for (const k of ['cover', 'thumb', 'hero', 'page_url'])
            if (g[k] !== undefined && g[k] !== '' && !isHttp(g[k]) && !isLocalPath(g[k]))
                warn(at, `"${k}" não é um link http(s): ${JSON.stringify(g[k]).slice(0, 80)}`);
        for (const k of ['genres', 'tags'])
            if (g[k] !== undefined && !(Array.isArray(g[k]) && g[k].every((x: any) => typeof x === 'string')))
                warn(at, `"${k}" precisa ser uma lista de textos`);
        if (g.prefer !== undefined && !['', 'torrent', 'direct'].includes(String(g.prefer)))
            warn(at, `"prefer" aceita "torrent" ou "direct": ${JSON.stringify(g.prefer)}`);
        if (g.patches !== undefined && !Array.isArray(g.patches))
            warn(at, '"patches" precisa ser uma lista [ { "name", "url", "note" } ]');
        rep.usable++;
    });
    return rep;
}

export function reportSummary(r: Report | null | undefined): string {
    if (!r)
        return '';
    const parts = [`${r.usable} de ${r.games} ${r.games === 1 ? 'jogo' : 'jogos'} ok`];
    if (r.errors.length)
        parts.push(`${r.errors.length} ${r.errors.length === 1 ? 'erro' : 'erros'}`);
    if (r.warnings.length)
        parts.push(`${r.warnings.length} ${r.warnings.length === 1 ? 'aviso' : 'avisos'}`);
    return parts.join(' · ');
}
