import fs from 'node:fs';
import { Zip } from './updater';
import * as crypto from './crypto';

export const PROTECTED = ['data', 'cache', 'games', 'emulation', 'downloads', 'themes', 'flash', 'bin', 'tools', 'updates'];

export function readManifest(pkg: string): any {
    if (!fs.existsSync(pkg))
        throw new Error('Arquivo não encontrado');
    let z: Zip;
    try {
        z = new Zip(pkg);
    }
    catch {
        throw new Error('O arquivo está danificado — baixe de novo');
    }
    try {
        if (!z.names.has('manifest.json'))
            throw new Error('Esse arquivo não é uma atualização do Ludrix');
        let m: any;
        try {
            m = JSON.parse(z.read('manifest.json').toString('utf8'));
        }
        catch {
            throw new Error('O arquivo está danificado — baixe de novo');
        }
        if (!m.version || !['patch', 'full'].includes(m.kind))
            throw new Error('Pacote de atualização inválido — baixe de novo');
        for (const d of m.dirs || []) {
            if (PROTECTED.includes(d) || String(d).includes('/') || String(d).startsWith('.'))
                throw new Error(`Pacote tenta mexer numa pasta protegida: ${d}`);
            if (![...z.names].some((n) => n.startsWith(d + '/')))
                throw new Error(`Pacote incompleto: falta a pasta ${d}/`);
        }
        for (const f of Object.keys(m.files || {}))
            if (!z.names.has(f))
                throw new Error(`Pacote incompleto: falta ${f}`);
        if (m.kind === 'patch' && !(m.dirs || []).includes('app'))
            throw new Error('Patch sem a pasta app/');
        const signed = crypto.zipStatus(pkg);
        if (signed === 'none')
            throw new Error('Esse pacote não tem a assinatura do Ludrix — por segurança, não instalo');
        if (signed !== 'ok')
            throw new Error('A assinatura desse pacote não confere — o arquivo foi alterado ou não veio do Ludrix');
        m._path = pkg;
        m._size = fs.statSync(pkg).size;
        return m;
    }
    finally {
        z.close();
    }
}

export function readManifestAsync(pkg: string, sha256 = ''): Promise<any> {
    return new Promise((resolve, reject) => {
        let done = false;
        const fin = (fn: () => void) => { if (!done) { done = true; fn(); } };
        let w: any;
        try {
            const { Worker } = require('node:worker_threads');
            w = new Worker(__filename, { workerData: { pkg, sha256 } });
        }
        catch (e) {
            try {
                if (sha256 && crypto.sha256File(pkg).toLowerCase() !== sha256.toLowerCase())
                    throw new Error('O arquivo baixado veio diferente do esperado e foi descartado por segurança — tente de novo');
                resolve(readManifest(pkg));
            }
            catch (e2) {
                reject(e2);
            }
            return;
        }
        w.once('message', (m: any) => fin(() => (m && m.error ? reject(new Error(m.error)) : resolve(m.manifest))));
        w.once('error', (e: any) => fin(() => reject(e)));
        w.once('exit', (code: number) => fin(() => reject(new Error(code ? 'Não consegui verificar o pacote' : 'Verificação interrompida'))));
    });
}

(() => {
    let wt: any;
    try {
        wt = require('node:worker_threads');
    }
    catch {
        return;
    }
    if (wt.isMainThread || !wt.parentPort || !wt.workerData || !wt.workerData.pkg)
        return;
    const { pkg, sha256 } = wt.workerData;
    try {
        if (sha256 && crypto.sha256File(pkg).toLowerCase() !== String(sha256).toLowerCase())
            throw new Error('O arquivo baixado veio diferente do esperado e foi descartado por segurança — tente de novo');
        wt.parentPort.postMessage({ manifest: readManifest(pkg) });
    }
    catch (e: any) {
        wt.parentPort.postMessage({ error: String(e?.message || e) });
    }
})();
