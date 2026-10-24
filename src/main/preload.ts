import { contextBridge, webUtils } from 'electron';

contextBridge.exposeInMainWorld('lxn', {
    pathFor: (f: File) => {
        try {
            return webUtils.getPathForFile(f) || '';
        }
        catch {
            return '';
        }
    },
});
