/**
 * system.ts — hardware, Modo Game e iniciar com o Windows.
 *
 * Substitui app/core/hardware.py e app/core/gamemode.py. O Modo Game e
 * intencionalmente conservador: ele fecha os processos que voce listou em
 * Ajustes > Modo Game e guarda a lista para reabri-los depois (so para itens
 * cujo executavel conhecemos).
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import * as cp from 'node:child_process';
import * as electron from 'electron';
import * as P from './paths';
import * as util from './util';
const MODE_FILE = path.join(P.DATA, 'gamemode.json');
import * as hwmod from './hardware';
function run(cmd, args, timeout = 6000) {
    return new Promise<any>((resolve) => {
        try {
            cp.execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 8 << 20 }, (err, stdout) => resolve(err ? '' : String(stdout || '')));
        }
        catch {
            resolve('');
        }
    });
}
function hardware(force = false) {
    return hwmod.detect(force);
}
function modeRead() {
    return (0, util.readJson)(MODE_FILE, { active: false, closed: [] });
}
function modeWrite(s) {
    (0, util.writeJson)(MODE_FILE, s);
}
function listRunning() {
    return new Promise<any>((resolve) => {
        if (process.platform !== 'win32') {
            resolve([]);
            return;
        }
        (0, cp.execFile)('tasklist', ['/FO', 'CSV', '/NH'], { timeout: 8000, windowsHide: true }, (err, out) => {
            if (err) {
                resolve([]);
                return;
            }
            const rows = [];
            for (const line of String(out || '').split(/\r?\n/)) {
                const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
                if (m)
                    rows.push({ name: m[1], pid: Number(m[2]) });
            }
            resolve(rows);
        });
    });
}
function kill(name) {
    return new Promise<any>((resolve) => {
        if (process.platform !== 'win32') {
            resolve(false);
            return;
        }
        (0, cp.execFile)('taskkill', ['/IM', name, '/F'], { timeout: 8000, windowsHide: true }, (err) => resolve(!err));
    });
}
/**
 * Fecha os programas configurados antes de jogar.
 * `plan` aceita "low" (so o que atrapalha), "high" (tudo da lista) etc.
 */
async function gameModeRun(cfg, plan = 'high') {
    const wanted = Array.isArray(cfg.game_mode_close) ? cfg.game_mode_close : [];
    if (!wanted.length)
        return { ok: true, closed: [], note: 'Nenhum programa configurado no Modo Game.' };
    const running = await listRunning();
    const targets = running.filter((r) => wanted.some((w) => w.toLowerCase() === r.name.toLowerCase()));
    const closed = [];
    for (const t of targets) {
        if (t.name.toLowerCase().endsWith('.exe') && /(ludrix|electron)/i.test(t.name))
            continue;
        if (await kill(t.name))
            closed.push({ name: t.name });
    }
    let power;
    if (process.platform === 'win32' && cfg.game_mode_power !== false) {
        // plano de energia alto desempenho (GUID padrao da Microsoft)
        const out = await run('powercfg', ['/getactivescheme']);
        const m = /GUID: ([0-9a-f-]+)/i.exec(out);
        if (m)
            power = m[1];
        await run('powercfg', ['/setactive', '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c']);
    }
    modeWrite({ active: true, closed, power, at: Date.now() });
    return { ok: true, closed, active: true, power_changed: Boolean(power) };
}
function gameModeStatus() {
    const s = modeRead();
    return { active: Boolean(s.active), closed: s.closed || [], plan: 'high' };
}
/** Reabre o que o Modo Game fechou e devolve o plano de energia anterior. */
async function gameModeRestore(cfg) {
    const s = modeRead();
    const reopened = [];
    for (const c of s.closed || []) {
        if (!c.exe || !fs.existsSync(c.exe))
            continue;
        try {
            (0, cp.spawn)(c.exe, [], { detached: true, stdio: 'ignore' }).unref();
            reopened.push(c.name);
        }
        catch {
            /* ignore */
        }
    }
    if (s.power && process.platform === 'win32' && cfg.game_mode_power !== false) {
        await run('powercfg', ['/setactive', s.power]);
    }
    modeWrite({ active: false, closed: [] });
    return { ok: true, reopened, restored_power: Boolean(s.power) };
}
/* --------------------------- iniciar com o SO --------------------------- */
function autostart() {
    try {
        const s = electron.app.getLoginItemSettings();
        return { enabled: Boolean(s.openAtLogin), supported: true };
    }
    catch {
        return { enabled: false, supported: false };
    }
}
function setAutostart(on) {
    try {
        electron.app.setLoginItemSettings({ openAtLogin: Boolean(on), path: process.execPath, args: [] });
        return { ok: true, enabled: autostart().enabled };
    }
    catch (e) {
        return { ok: false, enabled: false };
    }
}

export { hardware, gameModeRun, gameModeStatus, gameModeRestore, autostart, setAutostart };
