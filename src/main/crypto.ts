/**
 * crypto.ts — porte de app/lxsign.py (assinatura Ed25519 dos pacotes .lxup/.lxtheme).
 *
 * O original implementava Ed25519 a mao em Python puro. Aqui usamos o
 * modulo nativo `node:crypto`, que suporta Ed25519 desde o Node 12 — mesma
 * curva, mesmas regras (RFC 8032), sem codigo proprio de aritmetica de curva.
 *
 * O formato do pacote e preservado byte a byte:
 *   - o ZIP traz uma entrada `signature.sig` com a assinatura em hexadecimal;
 *   - o "digest" e sha256 sobre, para cada entrada em ordem alfabetica
 *     (ignorando `signature.sig` e diretorios): nome + 0x00 + sha256(conteudo).
 * Um .lxup/.lxtheme assinado pelo Ludrix original continua validando aqui.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import * as log from './log';
/** Chave publica oficial do Ludrix (mesma do lxsign.py). */
const PUBLIC_KEY = '0271846c4fa9e6b47bd2b2fc89dd282e30531abe9ce1b8d522b44836761a1131'
const SIG_NAME = 'signature.sig'
/** Prefixo DER de um SubjectPublicKeyInfo Ed25519 (12 bytes + 32 da chave). */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
/** Prefixo DER de um PKCS#8 Ed25519 derivado do seed (16 bytes + 32 do seed). */
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
function sha256(data) {
    return crypto.createHash('sha256').update(data).digest();
}
function sha256Hex(data) {
    return sha256(data).toString('hex');
}
function sha256File(file) {
    const h = crypto.createHash('sha256');
    const buf = Buffer.alloc(1 << 20);
    const fd = fs.openSync(file, 'r');
    try {
        let read = 0;
        while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0)
            h.update(buf.subarray(0, read));
    }
    finally {
        fs.closeSync(fd);
    }
    return h.digest('hex');
}
function publicKeyObject(rawHex) {
    const raw = Buffer.from(String(rawHex).trim(), 'hex');
    if (raw.length !== 32)
        throw new Error('chave publica Ed25519 invalida');
    return crypto.createPublicKey({
        key: Buffer.concat([SPKI_PREFIX, raw]),
        format: 'der',
        type: 'spki',
    });
}
function privateKeyObject(seed) {
    if (seed.length !== 32)
        throw new Error('seed Ed25519 precisa ter 32 bytes');
    return crypto.createPrivateKey({
        key: Buffer.concat([PKCS8_PREFIX, seed]),
        format: 'der',
        type: 'pkcs8',
    });
}
/** Verifica uma assinatura Ed25519 (64 bytes) sobre uma mensagem. */
function verify(msg, sig, pubHex = exports.PUBLIC_KEY) {
    try {
        if (sig.length !== 64)
            return false;
        return crypto.verify(null, msg, publicKeyObject(pubHex), sig);
    }
    catch {
        return false;
    }
}
/** Assina uma mensagem com um seed de 32 bytes (uso do mantenedor). */
function sign(msg, seed) {
    return crypto.sign(null, msg, privateKeyObject(seed));
}
/** Deriva a chave publica (hex) a partir do seed — util para conferir o par. */
function publicKeyOf(seed) {
    const der = crypto.createPublicKey(privateKeyObject(seed)).export({ format: 'der', type: 'spki' });
    return der.subarray(der.length - 32).toString('hex');
}
function randomSeed() {
    return crypto.randomBytes(32);
}
/* ------------------------------- pacotes ------------------------------- */
/**
 * Digest de um ZIP: sha256 da concatenacao ordenada de
 * `nome + 0x00 + sha256(conteudo)`, ignorando a propria assinatura.
 */
function zipDigest(zipPath) {
    const zip = new AdmZip(zipPath);
    const h = crypto.createHash('sha256');
    const names = zip.getEntries().map((e) => e.entryName).sort();
    for (const n of names) {
        if (n === exports.SIG_NAME || n.endsWith('/'))
            continue;
        h.update(Buffer.from(n, 'utf8'));
        h.update(Buffer.from([0]));
        h.update(sha256(zip.readFile(n) || Buffer.alloc(0)));
    }
    return h.digest();
}
/** Estado da assinatura de um pacote zip. */
function zipStatus(zipPath, pubHex = exports.PUBLIC_KEY) {
    try {
        const zip = new AdmZip(zipPath);
        const entry = zip.getEntry(exports.SIG_NAME);
        if (!entry)
            return 'none';
        let hex = zip.readAsText(entry, 'utf8').trim();
        if (hex.startsWith('"'))
            hex = hex.replace(/^"|"$/g, '');
        const sig = Buffer.from(hex, 'hex');
        if (sig.length !== 64)
            return 'bad';
        return verify(zipDigest(zipPath), sig, pubHex) ? 'ok' : 'bad';
    }
    catch (e) {
        log.debug('assinatura: %s', e);
        return 'bad';
    }
}
function isSigned(zipPath, pubHex = exports.PUBLIC_KEY) {
    return zipStatus(zipPath, pubHex) === 'ok';
}
/**
 * Assina um ZIP: regrava sem a assinatura antiga, calcula o digest e
 * acrescenta `signature.sig` com a assinatura em hexadecimal.
 */
function signZip(zipPath, seed, keepExtraKeys = []) {
    try {
        const src = new AdmZip(zipPath);
        const out = new AdmZip();
        for (const e of src.getEntries()) {
            if (e.entryName === exports.SIG_NAME || e.isDirectory)
                continue;
            out.addFile(e.entryName, src.readFile(e) || Buffer.alloc(0), e.comment || '', e.attr || 0);
            if (keepExtraKeys.includes(e.entryName))
                continue;
        }
        const dir = path.dirname(zipPath);
        const base = path.basename(zipPath);
        const tmp = path.join(dir, `.${base}.${process.pid}.tmp`);
        out.writeZip(tmp);
        const sig = sign(zipDigest(tmp), seed);
        const signed = new AdmZip(tmp);
        signed.addFile(exports.SIG_NAME, Buffer.from(sig.toString('hex'), 'utf8'));
        signed.writeZip(zipPath);
        fs.rmSync(tmp, { force: true });
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: String(e) };
    }
}
/* --------------------------- chave do mantenedor --------------------------- */
function keyPaths() {
    const out = [];
    const env = process.env.LUDRIX_SIGN_KEY;
    if (env)
        out.push(env);
    out.push(path.join(os.homedir(), '.ludrix', 'ludrix-sign.key'));
    out.push(path.resolve(process.cwd(), 'chave', 'ludrix-sign.key'));
    return out;
}
/** Carrega o seed de assinatura do mantenedor, se existir. */
function loadSeed() {
    for (const p of keyPaths()) {
        try {
            if (!fs.existsSync(p))
                continue;
            const seed = Buffer.from(fs.readFileSync(p, 'utf8').trim(), 'hex');
            if (seed.length === 32)
                return seed;
        }
        catch {
            /* tenta o proximo caminho */
        }
    }
    return null;
}
function saveSeed(seed, file) {
    const dest = file || path.join(os.homedir(), '.ludrix', 'ludrix-sign.key');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, seed.toString('hex'), 'utf8');
    try {
        fs.chmodSync(dest, 0o600);
    }
    catch {
        /* sistemas sem chmod (Windows) */
    }
    return dest;
}
/** HMAC curto usado para identificar instalacoes em telemetria local. */
function shortId(input) {
    return sha256Hex(input).slice(0, 16);
}

export { sha256, sha256Hex, sha256File, verify, sign, publicKeyOf, randomSeed, zipDigest, zipStatus, isSigned, signZip, keyPaths, loadSeed, saveSeed, shortId, PUBLIC_KEY, SIG_NAME };
