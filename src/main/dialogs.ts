import * as electron from 'electron';
let getWindow = () => null;
function bindWindow(fn) {
    getWindow = fn;
}
const KINDS = {
    exe: [{ name: 'Programa', extensions: process.platform === 'win32' ? ['exe', 'bat', 'lnk'] : ['exe', 'sh', 'x86_64', 'AppImage', 'bin'] }],
    json: [{ name: 'Lista de jogos', extensions: ['json'] }],
    rom: [{ name: 'ROM / imagem de disco', extensions: ['iso', 'chd', 'cue', 'bin', 'img', 'gba', 'gb', 'gbc', 'sfc', 'smc', 'nes', 'md', 'gen', 'smd', 'gcm', 'rvz', 'wbfs', 'wad', 'gdi', 'cdi', 'xex', 'wua', 'wud', 'wux', 'rpx', 'nsp', 'xci', '3ds', 'cci', 'sms', 'gg', 'pce', 'a26', 'zip', '7z', 'conf'] }],
    image: [{ name: 'Imagem', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    archive: [{ name: 'Arquivo de jogo', extensions: ['zip', '7z', 'rar', '001', 'iso'] }],
    patch: [{ name: 'Patch de ROM', extensions: ['ips', 'bps', 'ups'] }],
    theme: [{ name: 'Tema do Ludrix', extensions: ['lxtheme', 'zip', 'json'] }],
    backup: [{ name: 'Backup do Ludrix', extensions: ['zip'] }],
    save: [{ name: 'Save / pacote', extensions: ['zip', '7z', 'rar', 'sav', 'b', 'dat', 'bin', 'ps2', 'mcd', 'mcr', 'srm', 'gci', 'eep', 'sra', 'fla', 'mpk', 'psu', 'max', 'cbs', 'dsv', 'state*'] }],
    quick: [{ name: 'Jogo rápido', extensions: ['swf', 'zip', 'html'] }],
    lxup: [{ name: 'Atualização do Ludrix', extensions: ['lxup'] }],
    srczip: [{ name: 'Código-fonte do Ludrix', extensions: ['zip', 'lxup'] }],
    any: [],
};
async function pickFile(kind = 'exe', initial = '') {
    const win = getWindow();
    const filters = KINDS[kind] || KINDS.any;
    const opts: any = {
        properties: ['openFile'],
        filters: filters.length ? [...filters, { name: 'Todos', extensions: ['*'] }] : [{ name: 'Todos', extensions: ['*'] }],
    };
    if (initial)
        opts.defaultPath = initial;
    const res = win ? await electron.dialog.showOpenDialog(win, opts) : await electron.dialog.showOpenDialog(opts);
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
}
async function pickFiles(kind = 'exe', initial = '') {
    const win = getWindow();
    const filters = KINDS[kind] || KINDS.any;
    const opts: any = {
        properties: ['openFile', 'multiSelections'],
        filters: filters.length ? [...filters, { name: 'Todos', extensions: ['*'] }] : [{ name: 'Todos', extensions: ['*'] }],
    };
    if (initial)
        opts.defaultPath = initial;
    const res = win ? await electron.dialog.showOpenDialog(win, opts) : await electron.dialog.showOpenDialog(opts);
    return res.canceled || !res.filePaths.length ? null : res.filePaths;
}
async function pickFolder(initial = '') {
    const win = getWindow();
    const opts: any = { properties: ['openDirectory', 'createDirectory'] };
    if (initial)
        opts.defaultPath = initial;
    const res = win ? await electron.dialog.showOpenDialog(win, opts) : await electron.dialog.showOpenDialog(opts);
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
}
async function pickSave(defaultName, kind = 'any') {
    const win = getWindow();
    const filters = KINDS[kind] || KINDS.any;
    const opts: any = {
        defaultPath: defaultName,
        filters: (filters.length ? filters : [{ name: 'Todos', extensions: ['*'] }]),
    };
    const res = win ? await electron.dialog.showSaveDialog(win, opts) : await electron.dialog.showSaveDialog(opts);
    return res.canceled || !res.filePath ? null : res.filePath;
}
function openInShell(target) {
    try {
        if (target.startsWith('http://') || target.startsWith('https://'))
            electron.shell.openExternal(target);
        else
            electron.shell.openPath(target);
    }
    catch {
    }
}

export { bindWindow, pickFile, pickFiles, pickFolder, pickSave, openInShell };
