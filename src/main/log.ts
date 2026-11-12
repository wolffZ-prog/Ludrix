import fs from 'node:fs';
import path from 'node:path';
import * as P from './paths';
const MAX_BYTES = 1_000_000;
let started = false;
let queue: string[] = [];
let flushing = false;
let bytes = 0;
async function flush() {
    if (flushing || !queue.length)
        return;
    flushing = true;
    const chunk = queue.join('');
    queue = [];
    try {
        await fs.promises.appendFile(P.LOG_FILE, chunk, 'utf8');
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_BYTES) {
            await fs.promises.copyFile(P.LOG_FILE, P.LOG_FILE + '.1');
            await fs.promises.writeFile(P.LOG_FILE, '');
            bytes = 0;
        }
    }
    catch {
    }
    flushing = false;
    if (queue.length)
        setTimeout(flush, 50).unref?.();
}
function flushSync() {
    if (!queue.length)
        return;
    const chunk = queue.join('');
    queue = [];
    try {
        fs.appendFileSync(P.LOG_FILE, chunk, 'utf8');
    }
    catch {
    }
}
function emit(level, msg, ...rest) {
    if (!started)
        return;
    try {
        let text = String(msg);
        let i = 0;
        text = text.replace(/%[sdjo]/g, () => {
            const v = rest[i++];
            return v === undefined ? '?' : typeof v === 'string' ? v : JSON.stringify(v);
        });
        const tail = rest.slice(i).map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join(' ');
        queue.push(`${new Date().toISOString()} ${level} ${text}${tail ? ' ' + tail : ''}\n`);
        if (queue.length === 1)
            setTimeout(flush, 20).unref?.();
    }
    catch {
    }
}
function initLog() {
    try {
        fs.mkdirSync(path.dirname(P.LOG_FILE), { recursive: true });
        fs.appendFileSync(P.LOG_FILE, `\n---- ${new Date().toISOString()} Ludrix ----\n`, 'utf8');
        try {
            bytes = fs.statSync(P.LOG_FILE).size;
        }
        catch {
        }
        started = true;
        process.on('exit', flushSync);
    }
    catch {
        started = false;
    }
    process.on('uncaughtException', (e) => error('erro: ' + (e && e.stack ? e.stack : String(e))));
    process.on('unhandledRejection', (e) => error('promessa rejeitada: ' + String(e)));
}
const info = (m, ...r) => emit('INFO', m, ...r);
const warn = (m, ...r) => emit('WARN', m, ...r);
const error = (m, ...r) => emit('ERROR', m, ...r);
const debug = (m, ...r) => emit('DEBUG', m, ...r);

export { initLog, flushSync, info, warn, error, debug };
