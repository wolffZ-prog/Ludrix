import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lxu', {
    send: (cmd: string, arg?: any) => ipcRenderer.send('lxu', cmd, arg),
    on: (cb: (msg: any) => void) => { ipcRenderer.on('lxu', (_e, msg) => cb(msg)); },
});
