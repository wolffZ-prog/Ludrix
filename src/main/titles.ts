import path from 'node:path';

const SHORTCUT = /^(atalho (para|de|do|da)|shortcut to|acceso directo a|lien vers|verkn[üu]pfung mit|play|launch|jogar|iniciar|run|start|abrir|open)\s+|\s*[-–—]?\s*(atalho|shortcut|acceso directo|verkn[üu]pfung|lnk)\s*$/i;
const JUNK = /\b(x64|x86|win64|win32|dx1[12]|dx9|vulkan|shipping|launcher|setup|install(er)?|repack|reupload|multi ?\d+|fitgirl|dodi|elamigos|goldberg|steamrip|online-fix|build\s*\d+|update\s*\d+(\.\d+)*|v\s*\d+(\.\d+)+[a-z]?|\d+\s*dlcs?|all dlcs?|dlcs? included|bonus content|pt-?br|dublado|legendado|traduzido|crack(ed)?|iso|torrent|rohankar'?s?|recompiled|recomp)\b/gi;
const GROUPS = /\b(CODEX|PLAZA|SKIDROW|RELOADED|CPY|EMPRESS|RUNE|TENOKE|FLT|DODI|GOG|HOODLUM|DARKSiDERS|TiNYiSO|PROPHET|RAZOR1911|P2P|DOGE)\b/g;
const PAREN = /\s*[([{].*?[)\]}]/g;
const ROMAN = /^(i{1,3}|iv|v|vi{1,3}|ix|x{1,3}|xi{1,3}|xiv|xv|xvi{1,3}|xix|xx)$/i;
const SMALL = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'for', 'to', 'in', 'on', 'at', 'by', 'vs', 'de', 'do', 'da', 'dos', 'das', 'e', 'em', 'no', 'na', 'com', 'para', 'of the']);
const KEEP_UPPER = new Set(['GOTY', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XIII', 'XIV', 'XV', 'XVI', 'HD', '3D', '2D', '4K', 'VR', 'GT', 'GTA', 'NFS', 'PES', 'FIFA', 'NBA', 'NHL', 'NFL', 'MLB', 'UFC', 'WWE', 'F1', 'DOOM', 'FEAR', 'LEGO', 'SSX', 'DMC', 'MGS', 'RE', 'TES', 'USA', 'UK', 'DC', 'CD', 'DX', 'HL', 'TF', 'CS', 'GO', 'DS', 'SD', 'PSP', 'PS', 'AI', 'FF', 'KH', 'GB', 'GBA']);
const ABBR: Record<string, string> = {
    gta: 'Grand Theft Auto', nfs: 'Need for Speed', cod: 'Call of Duty', pes: 'Pro Evolution Soccer',
    mgs: 'Metal Gear Solid', dmc: 'Devil May Cry', tlou: 'The Last of Us', rdr: 'Red Dead Redemption',
    sotc: 'Shadow of the Colossus', botw: 'The Legend of Zelda: Breath of the Wild', totk: 'The Legend of Zelda: Tears of the Kingdom',
    ffvii: 'Final Fantasy VII', ffx: 'Final Fantasy X', re4: 'Resident Evil 4', re2: 'Resident Evil 2', re3: 'Resident Evil 3',
    hl2: 'Half-Life 2', csgo: 'Counter-Strike: Global Offensive', cs2: 'Counter-Strike 2', tf2: 'Team Fortress 2',
    l4d2: 'Left 4 Dead 2', acnh: 'Animal Crossing: New Horizons', smb: 'Super Mario Bros.', smw: 'Super Mario World',
    ssbm: 'Super Smash Bros. Melee', ssbu: 'Super Smash Bros. Ultimate', mk11: 'Mortal Kombat 11', mkx: 'Mortal Kombat X',
    sf6: 'Street Fighter 6', sfv: 'Street Fighter V', kh2: 'Kingdom Hearts II', gow: 'God of War', ac: "Assassin's Creed",
    bf1: 'Battlefield 1', bf4: 'Battlefield 4', bfv: 'Battlefield V', ds3: 'Dark Souls III', ds2: 'Dark Souls II',
    poe: 'Path of Exile', wow: 'World of Warcraft', lol: 'League of Legends', pubg: 'PUBG: Battlegrounds',
};
const DOT = /(?<=[A-Za-z]{2})\.(?=[A-Za-z0-9])|(?<=[A-Za-z0-9])\.(?=[A-Za-z]{2})/g;
const COMMA_THE = /^(.+?), (The|A|An|La|Le|Les|El|Los|Der|Die|Das)( - |: | )/i;
const CAMEL_OK = new Set(['bioshock', 'starcraft', 'warcraft', 'dirt', 'nier', 'wipeout', 'rollercoaster', 'simcity', 'timesplitters', 'dmc', 'motogp',
    'littlebigplanet', 'soulcalibur', 'blazblue', 'mechwarrior', 'goldeneye', 'pixeljunk', 'rimworld', 'towerfall', 'trackmania',
    'locoroco', 'warioware', 'parappa', 'ducktales', 'earthbound', 'starfox', 'yoshi', 'minecraft', 'overwatch', 'playerunknown',
    'deathloop', 'titanfall', 'everquest', 'runescape', 'hearthstone', 'counterstrike', 'wolfenstein', 'battletoads', 'megaman',
    'darksiders', 'dishonored', 'borderlands', 'mafia', 'iracing', 'supertux', 'openttd', 'openra', 'gtav', 'gtaiv', 'outrun', 'starwars']);

const isUpper = (w: string) => w === w.toUpperCase() && w !== w.toLowerCase();
const isLower = (w: string) => w === w.toLowerCase() && w !== w.toUpperCase();

function camelSplit(t: string) {
    const out: string[] = [];
    for (let w of t.split(' ')) {
        if (CAMEL_OK.has(w.replace(/\d+$/, '').toLowerCase())) {
            out.push(w.replace(/([A-Za-z]{3,})(\d)/g, '$1 $2'));
            continue;
        }
        if (w.length >= 5 && /[a-z][A-Z]/.test(w) && !isUpper(w))
            w = w.replace(/([a-z])([A-Z])/g, '$1 $2');
        w = w.replace(/([A-Za-z]{3,})(\d)/g, '$1 $2');
        w = w.replace(/(\d)([A-Z][a-z]{2,})/g, '$1 $2');
        out.push(w);
    }
    return out.join(' ');
}

function titleCase(t: string) {
    const out: string[] = [];
    t.split(' ').forEach((w, i) => {
        if (!w)
            return;
        const up = w.toUpperCase();
        if (KEEP_UPPER.has(up) || ROMAN.test(w))
            out.push(up);
        else if (i && SMALL.has(w.toLowerCase()))
            out.push(w.toLowerCase());
        else if (isUpper(w) && w.length > 4)
            out.push(w[0] + w.slice(1).toLowerCase());
        else if (isLower(w))
            out.push(w[0].toUpperCase() + w.slice(1));
        else
            out.push(w);
    });
    return out.join(' ');
}

export function normalizeTitle(raw: string, keepTags = false): string {
    let t = String(raw || '').trim();
    if (!t)
        return '';
    if (/\.(lnk|exe|url|bat|cmd|iso|chd|cue|bin|zip|7z|rar|json)$/i.test(t))
        t = t.slice(0, t.lastIndexOf('.'));
    t = t.replace(SHORTCUT, '').trim();
    t = t.replace(SHORTCUT, '').trim();
    if (!keepTags)
        t = t.replace(PAREN, '');
    t = t.split('_').join(' ');
    t = t.replace(DOT, ' ');
    if (!t.trim().includes(' '))
        t = camelSplit(t);
    t = t.replace(COMMA_THE, (_m, a, b, c) => `${b} ${a}${c}`);
    t = t.replace(/™|®|©/g, '');
    if (!t.trim().includes(' ') && t.includes('-'))
        t = t.split('-').join(' ');
    t = t.replace(/\s+-\s*(codex|plaza|skidrow|reloaded|cpy|empress|rune|tenoke|flt|dodi|fitgirl|elamigos|gog)\b.*$/i, '');
    t = t.replace(JUNK, ' ');
    t = t.replace(GROUPS, ' ');
    t = t.replace(/\s*[+&]\s*$/, '');
    t = t.replace(/\s{2,}/g, ' ').replace(/^[ \-–—:_.,+]+|[ \-–—:_.,+]+$/g, '');
    if (!t)
        t = String(raw).replace(PAREN, '').trim() || String(raw).trim();
    const low = t.toLowerCase();
    const plain = isLower(t) || isUpper(t) || !t.includes(' ');
    if (ABBR[low])
        return ABBR[low];
    const m = /^([a-z0-9]{2,5})\s+(.+)$/.exec(low);
    if (m && ABBR[m[1]] && m[1] !== 'ac') {
        const rest = t.slice(m[1].length + 1);
        t = ABBR[m[1]] + ' ' + (plain ? titleCase(rest) : rest);
    }
    else if (plain) {
        t = titleCase(t);
    }
    else {
        t = t.split(' ').map((w) => (ROMAN.test(w) ? w.toUpperCase() : w)).join(' ');
    }
    return t;
}

const BAD = /^(bin\s*\d*|binaries|win\s*\d+|x\s*\d+|x86|game|games?|jogos?|release|retail|shipping|system|exe|app|launcher|start|play|program files.*|steamapps|common|desktop|área de trabalho|area de trabalho|users?|[a-z])$/i;

export function titleFromPath(p: string): string {
    const name = path.basename(p);
    const folderTitle = () => {
        let q = path.dirname(p);
        while (path.dirname(q) !== q && (BAD.test(path.basename(q)) || path.basename(q).length < 3))
            q = path.dirname(q);
        return path.dirname(q) !== q ? normalizeTitle(path.basename(q)) : '';
    };
    let cand = normalizeTitle(name);
    const ext = path.extname(p).toLowerCase();
    if (['.exe', '.bat', '.cmd'].includes(ext)) {
        const f = folderTitle();
        if (f && !BAD.test(f) && f.length >= 3)
            return f;
    }
    if (!cand || cand.length < 3 || BAD.test(cand))
        cand = folderTitle() || cand;
    return cand;
}

export function cmp(t: string) {
    let s = String(t || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x00-\x7f]/g, '').toLowerCase();
    s = s.replace(/\(.*?\)|\[.*?\]/g, '');
    s = s.replace(/\b(the|a|an|of|and|&|edition|remastered|definitive|hd|goty|complete|video game)\b/g, ' ');
    s = s.replace(/[^a-z0-9 ]+/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
}

export function ratio(a: string, b: string): number {
    if (!a.length && !b.length)
        return 1;
    const matches = (x: string, y: string): number => {
        if (!x.length || !y.length)
            return 0;
        let best = 0, bi = 0, bj = 0;
        const prev = new Array(y.length + 1).fill(0);
        for (let i = 1; i <= x.length; i++) {
            let diag = 0;
            for (let j = 1; j <= y.length; j++) {
                const tmp = prev[j];
                if (x[i - 1] === y[j - 1]) {
                    prev[j] = diag + 1;
                    if (prev[j] > best) {
                        best = prev[j];
                        bi = i;
                        bj = j;
                    }
                }
                else {
                    prev[j] = 0;
                }
                diag = tmp;
            }
        }
        if (!best)
            return 0;
        return best + matches(x.slice(0, bi - best), y.slice(0, bj - best)) + matches(x.slice(bi), y.slice(bj));
    };
    return (2 * matches(a, b)) / (a.length + b.length);
}

export function similarity(a: string, b: string) {
    const na = cmp(a), nb = cmp(b);
    if (!na || !nb)
        return 0;
    if (na === nb)
        return 1;
    return ratio(na, nb);
}

const ROMAN_VAL: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15 };

function nums(t: string) {
    const out = new Set<string>();
    for (const tok of t.split(/\s+/)) {
        if (/^\d+$/.test(tok))
            out.add(String(Number(tok)));
        else if (ROMAN_VAL[tok])
            out.add(String(ROMAN_VAL[tok]));
    }
    return out;
}

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

export function sameNumbering(query: string, canonical: string) {
    return sameSet(nums(cmp(query)), nums(cmp(canonical)));
}

export function canonicalOk(query: string, canonical: string, minSim = 0.55) {
    if (!canonical)
        return false;
    const q = cmp(query), c = cmp(canonical);
    if (!q || !c)
        return false;
    if (!sameSet(nums(q), nums(c)))
        return false;
    if (q === c || q.split(' ').join('') === c.split(' ').join(''))
        return true;
    if (q.includes(c) || c.includes(q)) {
        const [short, long] = [q, c].sort((x, y) => x.length - y.length);
        if (short.length >= 4 && short.length / long.length >= 0.4)
            return true;
    }
    return ratio(q, c) >= minSim;
}

export function canonicalConfident(query: string, canonical: string) {
    const q = cmp(query), c = cmp(canonical);
    if (!q || !c || !sameSet(nums(q), nums(c)))
        return false;
    if (q === c || q.split(' ').join('') === c.split(' ').join(''))
        return true;
    if (q.includes(c) || c.includes(q)) {
        const [short, long] = [q, c].sort((x, y) => x.length - y.length);
        return short.length >= 4 && short.length / long.length >= 0.6;
    }
    return ratio(q, c) >= 0.85;
}
