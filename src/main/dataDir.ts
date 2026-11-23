import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Onde ficam os dados do Ludrix (config, biblioteca, cache, cópias, atualizações, temas instalados).
 * Sem dependência do Electron: o atualizador (processo à parte) e o verificador de integridade usam o mesmo cálculo.
 *
 *  - LUDRIX_DATA=<pasta>      força a pasta (o processo principal exporta isso para os filhos).
 *  - LUDRIX_HOME definido     modo dev/harness: tudo junto em <root>/data.
 *  - <root>/portable.txt      modo portátil (pendrive): tudo junto em <root>/data, como era antes da 4.4.
 *  - Windows (versão pronta)  %APPDATA%\.ludrixdata — fora da pasta do programa, longe do antivírus e de pastas sem permissão.
 *  - Linux/macOS              <root>/data (no AppImage o root já é ~/.local/share/Ludrix).
 */
export function dataDirOf(root: string, frozen = true): string {
    const env = String(process.env.LUDRIX_DATA || '').trim();
    if (env)
        return path.resolve(env);
    const local = path.join(root, 'data');
    if (String(process.env.LUDRIX_HOME || '').trim())
        return local;
    if (fs.existsSync(path.join(root, 'portable.txt')))
        return local;
    if (process.platform === 'win32' && frozen) {
        const roaming = String(process.env.APPDATA || '').trim() || path.join(os.homedir(), 'AppData', 'Roaming');
        return path.join(roaming, '.ludrixdata');
    }
    return local;
}

/** Nome amigável da pasta de dados para textos da interface (%APPDATA%\.ludrixdata ou data\). */
export function dataDirLabel(root: string, data: string): string {
    if (path.resolve(data) === path.resolve(path.join(root, 'data')))
        return 'data';
    const roaming = String(process.env.APPDATA || '').trim();
    if (roaming && data.toLowerCase().startsWith(roaming.toLowerCase()))
        return '%APPDATA%' + data.slice(roaming.length);
    return data;
}
