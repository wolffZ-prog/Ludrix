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
            data = util.readJson(f, null);
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
    return (emulators()?.systems || {});
}
function emulatorList() {
    const raw = (emulators()?.emulators || {});
    const out = {};
    for (const [id, e] of Object.entries(raw))
        out[id] = { ...e, id };
    return out;
}
function systemName(id) {
    return systems()[id]?.name || (id === 'pc' ? 'PC' : id.toUpperCase());
}
function systemExts(id) {
    const s = systems()[id];
    const exts = (s?.exts || s?.extensions || []);
    return exts.map((e) => (e.startsWith('.') ? e : '.' + e).toLowerCase());
}
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
