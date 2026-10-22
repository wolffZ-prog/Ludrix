export const SYSTEM_HINTS: [string, RegExp][] = [
    ['ps2', /\bps2\b|playstation ?2/], ['ps3', /\bps3\b|playstation ?3/], ['psp', /\bpsp\b/],
    ['ps1', /\bpsx\b|\bps1\b|playstation(?! ?[23])|\bpsone\b/], ['dc', /dreamcast|\bdc\b(?!o)/], ['gc', /gamecube|\bgcn?\b/],
    ['wiiu', /wii ?u/], ['wii', /\bwii\b(?!ware)/], ['x360', /xbox ?360|\bx360\b/], ['xbox', /\bxbox\b/], ['switch', /switch|\bnsw\b/],
    ['3ds', /\b3ds\b/], ['nds', /\bnds\b|nintendo ds/], ['gba', /\bgba\b|game ?boy/], ['n64', /\bn64\b|nintendo 64/],
    ['snes', /\bsnes\b|super nintendo|super famicom/], ['nes', /\bnes\b|famicom/], ['saturn', /saturn/],
    ['genesis', /mega ?drive|genesis|\bmd\b/], ['sms', /master system|game ?gear/], ['pce', /pc ?engine|turbografx/],
    ['atari2600', /atari ?2600/], ['arcade', /mame|fbneo|arcade|naomi|model ?[23]|atomiswave|hbmame/], ['dos', /ms-?dos|dosbox/],
    ['pc', /windows|\bpc\b|teknoparrot/],
];

export function guessSystem(...texts: (string | null | undefined)[]): string {
    const t = texts.map((x) => x || '').join(' ').toLowerCase();
    for (const [sid, re] of SYSTEM_HINTS)
        if (re.test(t))
            return sid;
    return '';
}

export const EXT_SYSTEM: Record<string, string> = {
    nds: 'nds', gba: 'gba', gb: 'gba', gbc: 'gba', z64: 'n64', n64: 'n64', v64: 'n64', sfc: 'snes', smc: 'snes', nes: 'nes',
    md: 'genesis', gen: 'genesis', smd: 'genesis', rvz: 'gc', gcm: 'gc', gcz: 'gc', ciso: 'gc', wbfs: 'wii', wad: 'wii',
    cso: 'psp', pbp: 'psp', cdi: 'dc', gdi: 'dc', xiso: 'xbox', xex: 'x360', zar: 'x360', nsp: 'switch', xci: 'switch', nro: 'switch',
    '3ds': '3ds', cci: '3ds', cxi: '3ds', wua: 'wiiu', wud: 'wiiu', wux: 'wiiu', rpx: 'wiiu', sms: 'sms', gg: 'sms', pce: 'pce', a26: 'atari2600',
};

export function extSystem(...names: (string | null | undefined)[]): string {
    for (const n of names) {
        const ext = (n || '').split('/').pop()!.split('.').pop()!.toLowerCase();
        if (EXT_SYSTEM[ext])
            return EXT_SYSTEM[ext];
    }
    return '';
}
