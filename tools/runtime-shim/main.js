const path = require('path');
const fs = require('fs');
let root = process.env.LUDRIX_ROOT || '';
if (!root || !fs.existsSync(path.join(root, 'app', 'main', 'boot.js')))
    root = path.resolve(path.dirname(process.execPath), '..');
process.env.LUDRIX_ROOT = root;
if (!process.env.LUDRIX_HOME)
    process.env.LUDRIX_HOME = root;
process.env.LUDRIX_APP = path.join(root, 'app');
const entry = path.join(root, 'app', 'main', 'boot.js');
if (!fs.existsSync(entry)) {
    const { app, dialog } = require('electron');
    app.whenReady().then(() => {
        dialog.showErrorBox('LudrixHub', 'A pasta app\\ não foi encontrada em ' + root + '.\n\nExtraia o pacote completo de novo por cima desta pasta.');
        app.exit(2);
    });
}
else
    require(entry);
