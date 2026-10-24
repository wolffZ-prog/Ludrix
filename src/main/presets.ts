/**
 * presets.ts — carrega os catálogos que o projeto original mantinha em
 * app/presets/: categorias, 25 sistemas e 45 emuladores, dependencias,
 * locais de save, sites e ferramentas de mods, componentes opcionais e
 * os jogos rapidos (Flash/HTML5).
 *
 * Os arquivos sao os mesmos do original, sem alteracao.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as P from './paths';
import * as util from './util';
import * as log from './log';
const cache = new Map();
function load(name) {
    const hit = cache.get(name);
    if (hit !== undefined)
        return hit;
    let data = null;
    const candidates = [
        path.join(P.ASSETS, 'presets', name),
        path.resolve(__dirname, '..', '..', 'src', 'main', 'assets', 'presets', name),
        path.resolve(__dirname, 'assets', 'presets', name),
    ];
    for (const f of candidates) {
        if (fs.existsSync(f)) {
            data = (0, util.readJson)(f, null);
            if (data)
                break;
        }
    }
    if (!data)
        log.warn('preset ausente: %s', name);
    cache.set(name, data);
    return data;
}
function reload() {
    cache.clear();
}
const categories = () => load('categories.json');
const emulators = () => load('emulators.json');
const redists = () => load('redists.json');
const saves = () => load('saves.json');
const mods = () => load('mods.json');
const flash = () => load('flash.json');
function systems() {
    return ((0, exports.emulators)()?.systems || {});
}
/**
 * Cada emulador do preset e uma entrada de dicionario: aqui devolvemos o
 * dicionario com o proprio `id` ja dentro do objeto, para o resto do codigo
 * nao precisar ficar carregando a chave junto.
 */
function emulatorList() {
    const raw = ((0, exports.emulators)()?.emulators || {});
    const out = {};
    for (const [id, e] of Object.entries(raw))
        out[id] = { ...e, id };
    return out;
}
/** Nome amigavel de um sistema ("ps2" -> "PlayStation 2"). */
function systemName(id) {
    return systems()[id]?.name || (id === 'pc' ? 'PC' : id.toUpperCase());
}
/** Extensoes de ROM aceitas por um sistema. */
function systemExts(id) {
    const s = systems()[id];
    const exts = (s?.exts || s?.extensions || []);
    return exts.map((e) => (e.startsWith('.') ? e : '.' + e).toLowerCase());
}
/** Emuladores que atendem um sistema. */
function emulatorsFor(system) {
    return Object.values(emulatorList()).filter((e) => (e.systems || []).includes(system));
}
function allRomExts() {
    const set = new Set();
    for (const id of Object.keys(systems()))
        for (const e of systemExts(id))
            set.add(e);
    return [...set];
}

export { reload, systems, emulatorList, systemName, systemExts, emulatorsFor, allRomExts, categories, emulators, redists, saves, mods, flash };
