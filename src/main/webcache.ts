import fs from 'node:fs';
import path from 'node:path';
import * as P from './paths';
import * as http from './http';

function fileFor(key: string) {
    return path.join(P.CACHE_WEB, key.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 150) + '.json');
}

function fresh(p: string, ttl: number) {
    try {
        const st = fs.statSync(p);
        return Date.now() - st.mtimeMs < ttl * 1000;
    }
    catch {
        return false;
    }
}

export class WebCache {
    constructor(public session: http.Session = http.shared) { }

    async getJson(key: string, url: string, ttl: number): Promise<any> {
        const p = fileFor(key);
        if (fresh(p, ttl)) {
            try {
                return JSON.parse(fs.readFileSync(p, 'utf8'));
            }
            catch { /* refaz */ }
        }
        const r = await this.session.request(url, { timeout: 30_000 });
        if (r.status >= 400)
            throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(data), 'utf8');
        return data;
    }

    getLocal(key: string, ttl: number): any {
        const p = fileFor(key);
        if (!fresh(p, ttl))
            return null;
        try {
            return JSON.parse(fs.readFileSync(p, 'utf8'));
        }
        catch {
            return null;
        }
    }

    setLocal(key: string, data: any) {
        const p = fileFor(key);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(data), 'utf8');
    }
}

export const shared = new WebCache();
