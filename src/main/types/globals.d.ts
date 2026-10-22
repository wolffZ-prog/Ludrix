/**
 * Declaracoes minimas para bibliotecas que nao trazem tipos proprios.
 * So o suficiente para o compilador conferir o nosso uso.
 */

declare module 'adm-zip' {
  interface ZipEntry {
    entryName: string;
    isDirectory: boolean;
    header?: { size?: number; crc?: number };
    comment?: string;
    attr?: number;
    getData(): Buffer | null;
  }
  class AdmZip {
    constructor(input?: string | Buffer);
    getEntries(): ZipEntry[];
    getEntry(name: string): ZipEntry | null;
    readFile(entry: string | ZipEntry): Buffer | null;
    readAsText(entry: string | ZipEntry, encoding?: string): string;
    extractEntryTo(entry: string | ZipEntry, targetPath: string, maintainEntryPath?: boolean, overwrite?: boolean, keepOriginalPermission?: boolean, password?: string): boolean;
    extractAllTo(targetPath: string, overwrite?: boolean, password?: string): void;
    addLocalFolder(localPath: string, zipPath?: string, filter?: (filename: string) => boolean): void;
    addLocalFile(localPath: string, zipPath?: string, comment?: string, attr?: number): void;
    addFile(entryName: string, content: Buffer | string, comment?: string, attr?: number): void;
    writeZip(target?: string): void;
  }
  export = AdmZip;
}

declare module 'webtorrent' {
  interface TorrentFile {
    name: string;
    path: string;
    length: number;
    downloaded: number;
    progress: number;
    select(): void;
    deselect(): void;
  }
  interface Torrent {
    name: string;
    infoHash: string;
    magnetURI: string;
    length: number;
    downloaded: number;
    uploaded: number;
    downloadSpeed: number;
    uploadSpeed: number;
    progress: number;
    numPeers: number;
    ready: boolean;
    files: TorrentFile[];
    path: string;
    on(event: 'ready' | 'done' | 'error' | 'noPeers' | 'metadata', cb: (...args: any[]) => void): void;
    on(event: 'download' | 'upload', cb: (bytes: number) => void): void;
    once(event: string, cb: (...args: any[]) => void): void;
    destroy(opts?: { destroyStore?: boolean }, cb?: (err?: any) => void): void;
    pause(): void;
    resume(): void;
  }
  interface TorrentOptions {
    path?: string;
    maxWebConns?: number;
    store?: (chunkLength: number, storeOpts: any) => any;
    announce?: string[];
  }
  class WebTorrent {
    constructor(opts?: { maxConns?: number });
    readonly torrents: Torrent[];
    readonly downloadSpeed: number;
    readonly uploadSpeed: number;
    readonly ratio: number;
    readonly progress: number;
    add(input: string, opts?: TorrentOptions, cb?: (torrent: Torrent) => void): Torrent;
    seed(input: string | FileList | File[], opts?: TorrentOptions, cb?: (torrent: Torrent) => void): Torrent;
    get(id: string): Torrent | null;
    remove(id: string, opts?: { destroyStore?: boolean }, cb?: (err?: any) => void): void;
    destroy(cb?: (err?: any) => void): void;
    on(event: 'error' | 'torrent', cb: (...args: any[]) => void): void;
  }
  export = WebTorrent;
}
