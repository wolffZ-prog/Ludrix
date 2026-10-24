import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lxm', {
    send: (t: string, v?: any) => ipcRenderer.send('lxm', t, v),
    on: (cb: (d: any) => void) => { ipcRenderer.on('lxm-show', (_e, d) => cb(d)); },
});
