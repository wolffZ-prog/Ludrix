import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import * as cp from 'node:child_process';
import * as electron from 'electron';
import * as P from './paths';
import * as util from './util';
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

export { hardware, autostart, setAutostart };
