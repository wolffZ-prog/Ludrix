import { parentPort, workerData } from 'node:worker_threads';
import * as scanner from './scanner';

const d: any = workerData || {};
const post = (m: any) => parentPort?.postMessage(m);
let lastMsg = '';
let lastAt = 0;
const prog = (msg: string) => {
    const now = Date.now();
    if (msg === lastMsg || now - lastAt < 150)
        return;
    lastMsg = msg;
    lastAt = now;
    post({ type: 'progress', msg });
};
function walkFiles(dirs: string[], maxDepth: number, exts: string[]): Array<{ path: string; size: number }> {
    const fs = require('node:fs');
    const path = require('node:path');
    const out: Array<{ path: string; size: number }> = [];
    const want = exts.map((e) => e.toLowerCase());
    let n = 0;
    const walk = (dir: string, depth: number) => {
        let ents: any[];
        try {
            ents = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of ents) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (!e.name.startsWith('.') && depth < maxDepth)
                    walk(p, depth + 1);
                continue;
            }
            if (!(e.isFile() || e.isSymbolicLink()))
                continue;
            const low = e.name.toLowerCase();
            if (want.length && !want.some((x) => low.endsWith(x)))
                continue;
            let size = 0;
            try {
                size = fs.statSync(p).size;
            }
            catch {
                continue;
            }
            out.push({ path: p, size });
            if (++n % 200 === 0)
                prog(`Lendo ${path.basename(dir)}… (${n})`);
        }
    };
    for (const d0 of dirs)
        walk(d0, 0);
    return out;
}
try {
    const skip = Array.isArray(d.skip) ? new Set<string>(d.skip) : null;
    if (d.mode === 'walk') {
        post({ type: 'done', items: walkFiles(d.dirs || [], d.maxDepth || 7, d.exts || []) });
        process.exit(0);
    }
    const items = d.mode === 'roms'
        ? scanner.scanRoms(String(d.root), d.systems || {}, prog, d.limit || 5000)
        : scanner.scanWindows(String(d.root), prog, d.limit || 3000, skip);
    post({ type: 'done', items });
}
catch (e: any) {
    post({ type: 'error', error: String(e?.stack || e?.message || e) });
}
