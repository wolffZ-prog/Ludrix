import fs from 'node:fs';
import path from 'node:path';

const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

export function crc32(buf: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++)
        c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

const hex8 = (n: number) => n.toString(16).padStart(8, '0').toUpperCase();

export type PatchKind = 'ips' | 'ups' | 'bps';
export interface PatchResult { out: Buffer; kind: PatchKind; crcSource?: number; crcExpected?: number; mismatch: boolean; }

export function patchKind(p: string, head?: Buffer): PatchKind | null {
    const h = head || (() => { try { const fd = fs.openSync(p, 'r'); const b = Buffer.alloc(5); fs.readSync(fd, b, 0, 5, 0); fs.closeSync(fd); return b; } catch { return Buffer.alloc(0); } })();
    const s = h.toString('latin1');
    if (s.startsWith('PATCH'))
        return 'ips';
    if (s.startsWith('UPS1'))
        return 'ups';
    if (s.startsWith('BPS1'))
        return 'bps';
    const ext = path.extname(p).toLowerCase();
    return ext === '.ips' ? 'ips' : ext === '.ups' ? 'ups' : ext === '.bps' ? 'bps' : null;
}

class Reader {
    pos = 0;
    constructor(public b: Buffer) {}
    u8() { if (this.pos >= this.b.length) throw new Error('Patch truncado'); return this.b[this.pos++]; }
    u24be() { return (this.u8() << 16) | (this.u8() << 8) | this.u8(); }
    u16be() { return (this.u8() << 8) | this.u8(); }
    u32le(at: number) { return this.b.readUInt32LE(at); }
    varint() {
        let data = 0, shift = 1;
        for (;;) {
            const x = this.u8();
            data += (x & 0x7f) * shift;
            if (x & 0x80)
                break;
            shift *= 128;
            data += shift;
        }
        return data;
    }
}

function applyIps(src: Buffer, patch: Buffer): PatchResult {
    const r = new Reader(patch);
    r.pos = 5;
    let out = Buffer.from(src);
    const grow = (n: number) => { if (n > out.length) { const b = Buffer.alloc(n); out.copy(b); out = b; } };
    let truncate = -1;
    for (;;) {
        if (r.pos + 3 > patch.length)
            throw new Error('Patch IPS sem marcador de fim');
        if (patch.toString('latin1', r.pos, r.pos + 3) === 'EOF') {
            r.pos += 3;
            if (r.pos + 3 <= patch.length)
                truncate = r.u24be();
            break;
        }
        const off = r.u24be();
        const size = r.u16be();
        if (size === 0) {
            const n = r.u16be(), v = r.u8();
            grow(off + n);
            out.fill(v, off, off + n);
        }
        else {
            grow(off + size);
            patch.copy(out, off, r.pos, r.pos + size);
            r.pos += size;
        }
    }
    if (truncate >= 0 && truncate < out.length)
        out = out.subarray(0, truncate);
    return { out, kind: 'ips', mismatch: false };
}

function applyUps(src: Buffer, patch: Buffer): PatchResult {
    const r = new Reader(patch);
    r.pos = 4;
    const inSize = r.varint(), outSize = r.varint();
    const crcIn = patch.readUInt32LE(patch.length - 12), crcOut = patch.readUInt32LE(patch.length - 8), crcPatch = patch.readUInt32LE(patch.length - 4);
    if (crc32(patch.subarray(0, patch.length - 4)) !== crcPatch)
        throw new Error('O arquivo do patch está corrompido (CRC do patch não confere)');
    const crcSource = crc32(src);
    const mismatch = crcSource !== crcIn || src.length !== inSize;
    const out = Buffer.alloc(Math.max(inSize, outSize));
    src.copy(out, 0, 0, Math.min(src.length, out.length));
    let off = 0;
    while (r.pos < patch.length - 12) {
        off += r.varint();
        for (;;) {
            const x = r.u8();
            if (off < out.length)
                out[off] ^= x;
            off++;
            if (x === 0)
                break;
        }
    }
    const fin = out.subarray(0, outSize);
    return { out: fin, kind: 'ups', crcSource, crcExpected: crcIn, mismatch: mismatch || crc32(fin) !== crcOut };
}

function applyBps(src: Buffer, patch: Buffer): PatchResult {
    const r = new Reader(patch);
    r.pos = 4;
    const srcSize = r.varint(), tgtSize = r.varint(), metaSize = r.varint();
    r.pos += metaSize;
    const crcSrc = patch.readUInt32LE(patch.length - 12), crcTgt = patch.readUInt32LE(patch.length - 8), crcPatch = patch.readUInt32LE(patch.length - 4);
    if (crc32(patch.subarray(0, patch.length - 4)) !== crcPatch)
        throw new Error('O arquivo do patch está corrompido (CRC do patch não confere)');
    const crcSource = crc32(src);
    const mismatch = crcSource !== crcSrc || src.length !== srcSize;
    const out = Buffer.alloc(tgtSize);
    let o = 0, sRel = 0, tRel = 0;
    while (r.pos < patch.length - 12) {
        const d = r.varint();
        const cmd = d & 3;
        let len = Math.floor(d / 4) + 1;
        if (o + len > tgtSize)
            throw new Error('Patch BPS inválido (escreve além do tamanho final)');
        if (cmd === 0) {
            src.copy(out, o, o, o + len);
            o += len;
        }
        else if (cmd === 1) {
            patch.copy(out, o, r.pos, r.pos + len);
            r.pos += len;
            o += len;
        }
        else if (cmd === 2) {
            const v = r.varint();
            sRel += (v & 1 ? -1 : 1) * Math.floor(v / 2);
            if (sRel < 0 || sRel + len > src.length)
                throw new Error('Patch BPS inválido (leitura fora da ROM original)');
            src.copy(out, o, sRel, sRel + len);
            sRel += len;
            o += len;
        }
        else {
            const v = r.varint();
            tRel += (v & 1 ? -1 : 1) * Math.floor(v / 2);
            if (tRel < 0)
                throw new Error('Patch BPS inválido');
            while (len--)
                out[o++] = out[tRel++];
        }
    }
    return { out, kind: 'bps', crcSource, crcExpected: crcSrc, mismatch: mismatch || crc32(out) !== crcTgt };
}

export function applyPatch(romPath: string, patchPath: string): PatchResult {
    const patch = fs.readFileSync(patchPath);
    const kind = patchKind(patchPath, patch.subarray(0, 5));
    if (!kind)
        throw new Error('Formato de patch não reconhecido (aceita .ips, .ups e .bps)');
    const st = fs.statSync(romPath);
    if (st.size > 512 * 1024 * 1024)
        throw new Error('ROM grande demais para aplicar patch na memória (limite 512 MB)');
    const src = fs.readFileSync(romPath);
    if (kind === 'ips')
        return applyIps(src, patch);
    if (kind === 'ups')
        return applyUps(src, patch);
    return applyBps(src, patch);
}

export function describeMismatch(r: PatchResult) {
    if (!r.mismatch)
        return '';
    return r.crcExpected !== undefined ? `O patch espera uma ROM com CRC ${hex8(r.crcExpected)}; a sua tem ${hex8(r.crcSource || 0)}. Costuma ser outra região, outra revisão ou cabeçalho a mais.` : 'A ROM não confere com a esperada pelo patch.';
}

export function outputName(romPath: string, patchPath: string) {
    const ext = path.extname(romPath);
    const base = path.basename(romPath, ext);
    const tag = path.basename(patchPath, path.extname(patchPath)).replace(/[_]+/g, ' ').trim().slice(0, 60);
    let out = path.join(path.dirname(romPath), `${base} — ${tag}${ext}`);
    let n = 2;
    while (fs.existsSync(out))
        out = path.join(path.dirname(romPath), `${base} — ${tag} ${n++}${ext}`);
    return out;
}
