import fs from 'node:fs';
import path from 'node:path';
import * as P from './paths';
const MAX_BYTES = 1_000_000;
let started = false;
function rotate() {
    try {
        const st = fs.statSync(P.LOG_FILE);
        if (st.size > MAX_BYTES) {
            fs.copyFileSync(P.LOG_FILE, P.LOG_FILE + '.1');
            fs.writeFileSync(P.LOG_FILE, '');
        }
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
        const line = `${new Date().toISOString()} ${level} ${text}${tail ? ' ' + tail : ''}\n`;
        fs.appendFileSync(P.LOG_FILE, line, 'utf8');
        rotate();
    }
    catch {
    }
}
function initLog() {
    try {
        fs.mkdirSync(path.dirname(P.LOG_FILE), { recursive: true });
        fs.appendFileSync(P.LOG_FILE, `\n---- ${new Date().toISOString()} Ludrix ----\n`, 'utf8');
        started = true;
    }
    catch {
        started = false;
    }
    process.on('uncaughtException', (e) => (0, exports.error)('erro: ' + (e && e.stack ? e.stack : String(e))));
    process.on('unhandledRejection', (e) => (0, exports.error)('promessa rejeitada: ' + String(e)));
}
const info = (m, ...r) => emit('INFO', m, ...r);
const warn = (m, ...r) => emit('WARN', m, ...r);
const error = (m, ...r) => emit('ERROR', m, ...r);
const debug = (m, ...r) => emit('DEBUG', m, ...r);

export { initLog, info, warn, error, debug };
