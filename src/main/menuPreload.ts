import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lxm', {
    send: (t: string, v?: any) => ipcRenderer.send('lxm', t, v),
});
