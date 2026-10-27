import * as electron from 'electron';
import * as hwmod from './hardware';
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
