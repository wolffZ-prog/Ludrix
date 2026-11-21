#!/usr/bin/env python3
"""Gera SYS_ICONS (logos dos consoles) em src/renderer/icons.js.

Fontes: logos SVG em tools/sysicons/src/<id>.svg (simple-icons e Wikimedia Commons,
marcas dos respectivos donos; usadas só como identificação de plataforma).
Cada logo vira monocromático (currentColor) com a cor da marca no <g color=…>,
aninhado num viewBox 48x32. Rode: python3 tools/sysicons.py
"""
import json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / 'tools' / 'sysicons' / 'src'
OUT = ROOT / 'src' / 'renderer' / 'icons.js'

# id -> (arquivo, cor da marca ou None=currentColor, opções)
def T(txt, color, size=None):
    n = len(txt)
    size = size or (22 if n <= 2 else 20 if n == 3 else 17.5)
    tl = f' textLength="{44 if n == 4 else 40 if n == 3 else 0}" lengthAdjust="spacingAndGlyphs"' if n >= 3 else ''
    return (None, color, {'raw': f'<text x="24" y="{16 + size * .36:.1f}" text-anchor="middle" font-family="Outfit,Inter,Rubik,system-ui,sans-serif" font-weight="800" font-size="{size}" letter-spacing="-.6"{tl} fill="currentColor">{txt}</text>'})


SPEC = {
    'nes':       T('NES', '#f0453f'),
    'snes':      T('SNES', '#f0453f'),
    'n64':       T('N64', '#5a7dff'),
    'gc':        ('nintendogamecube',      '#8f7ff0', {}),
    'wii':       ('wii',                   None,      {'scale': 1.15}),
    'wiiu':      ('wiiu',                  '#3fb6ea', {'scale': 1.25}),
    'switch':    ('nintendoswitch',        '#f0453f', {}),
    'gba':       T('GBA', '#7b6cf5'),
    'nds':       T('DS', None),
    '3ds':       T('3DS', '#f0453f'),
    'ps1':       ('playstation',           '#4f8ae8', {}),
    'ps2':       ('playstation',           '#4f8ae8', {'badge': '2'}),
    'ps3':       ('playstation',           '#4f8ae8', {'badge': '3'}),
    'psp':       ('playstation',           '#4f8ae8', {'badge': 'P'}),
    'genesis':   ('sega',                  '#4f8ae8', {}),
    'saturn':    (None,                    '#4f8ae8', {'raw': '<circle cx="24" cy="16" r="9" fill="currentColor"/><ellipse cx="24" cy="16" rx="21" ry="5.2" fill="none" stroke="currentColor" stroke-width="2.4" transform="rotate(-18 24 16)"/>'}),
    'dc':        ('dc',                    '#ff7a45', {'crop': '217 0 614 545'}),
    'xbox':      ('xbox',                  '#4cc45e', {}),
    'x360':      ('xbox',                  '#a0d04a', {'badge': '360'}),
    'sms':       T('SMS', '#f0453f'),
    'pce':       T('PCE', '#ff6a5e'),
    'atari2600': ('atari',                 '#ff4d5e', {}),
    'arcade':    (None,                    '#f5c04a', {'raw': '<rect x="12" y="4" width="24" height="26" rx="3" fill="currentColor"/><rect x="15" y="7" width="18" height="10" rx="1.5" fill="#000" opacity=".55"/><circle cx="20" cy="23" r="2.4" fill="#000" opacity=".55"/><circle cx="28" cy="22" r="1.8" fill="#000" opacity=".55"/><circle cx="32" cy="24" r="1.8" fill="#000" opacity=".55"/>'}),
    'dos':       T('DOS', '#9d8cff'),
    'pc':        ('windows',               '#3b9cff', {}),
}

ID_RE = re.compile(r'\bid="([^"]+)"')


def viewbox(svg):
    m = re.search(r'viewBox="([^"]+)"', svg)
    if m:
        return m.group(1)
    w = re.search(r'<svg[^>]*\swidth="([\d.]+)', svg); h = re.search(r'<svg[^>]*\sheight="([\d.]+)', svg)
    return f'0 0 {w.group(1)} {h.group(1)}'


def inner(svg):
    m = re.search(r'<svg[^>]*>(.*)</svg>', svg, re.S)
    body = m.group(1)
    body = re.sub(r'<(metadata|title|desc|sodipodi:namedview)\b.*?</\1>', '', body, flags=re.S)
    body = re.sub(r'<!--.*?-->', '', body, flags=re.S)
    body = re.sub(r'<\?xml.*?\?>', '', body, flags=re.S)
    return body


def mono(body, pid, opt):
    white = opt.get('white')
    drop = opt.get('drop_fill')
    if drop:
        body = re.sub(r'<(rect|path|polygon)[^>]*fill="%s"[^>]*/?>' % re.escape(drop), '', body, flags=re.I)

    def fix_style(m):
        parts = [p.strip() for p in m.group(1).split(';') if p.strip()]
        keep = []
        for p in parts:
            k, _, v = p.partition(':'); k = k.strip(); v = v.strip()
            if k in ('fill', 'stroke'):
                vl = v.lower()
                if vl == 'none':
                    keep.append(f'{k}:none')
                elif white and vl in ('#fff', '#ffffff', 'white'):
                    keep.append(f'{k}:{white}')
                else:
                    keep.append(f'{k}:currentColor')
            elif k.startswith('-inkscape') or k in ('display',):
                continue
            else:
                keep.append(f'{k}:{v}')
        return 'style="%s"' % ';'.join(keep)
    body = re.sub(r'style="([^"]*)"', fix_style, body)

    def fix_attr(m):
        k, v = m.group(1), m.group(2); vl = v.lower()
        if vl == 'none':
            return f'{k}="none"'
        if white and vl in ('#fff', '#ffffff', 'white'):
            return f'{k}="{white}"'
        if vl.startswith('url('):
            return f'{k}="currentColor"'
        return f'{k}="currentColor"'
    body = re.sub(r'\b(fill|stroke)="([^"]*)"', fix_attr, body)
    body = re.sub(r'<(linearGradient|radialGradient)\b.*?</\1>', '', body, flags=re.S)
    # ids únicos por ícone
    ids = set(ID_RE.findall(body))
    for i in sorted(ids, key=len, reverse=True):
        body = body.replace(f'id="{i}"', f'id="{pid}{i}"').replace(f'#{i}"', f'#{pid}{i}"').replace(f'#{i})', f'#{pid}{i})')
    return body


def build():
    out = {}
    for sid, (fname, color, opt) in SPEC.items():
        col = f' color="{color}"' if color else ''
        if fname is None:
            out[sid] = f'<g{col} fill="currentColor">{opt["raw"]}</g>'
            continue
        svg = (SRC / f'{fname}.svg').read_text(errors='ignore')
        vb = opt.get('crop') or viewbox(svg)
        body = mono(inner(svg), sid.replace('-', '') + '_', opt)
        badge = opt.get('badge')
        if badge:
            bw = 13 if len(badge) == 1 else 20
            nested = f'<svg viewBox="{vb}" x="{(48 - 26 - bw - 2) / 2:.1f}" y="3" width="26" height="26" fill="currentColor">{body}</svg>'
            nested += f'<text x="{(48 - 26 - bw - 2) / 2 + 28:.1f}" y="24" font-family="Outfit,Inter,Rubik,system-ui,sans-serif" font-weight="800" font-size="{16 if len(badge) == 1 else 12.5}" fill="currentColor" letter-spacing="-.4">{badge}</text>'
        else:
            sc = opt.get('scale', 1); w, h = 44 * sc, 28 * sc
            nested = f'<svg viewBox="{vb}" x="{24 - w / 2:.1f}" y="{16 - h / 2:.1f}" width="{w:.1f}" height="{h:.1f}" overflow="visible" fill="currentColor">{body}</svg>'
        out[sid] = f'<g{col} fill="currentColor">{nested}</g>'
    return out


def write(out):
    js = OUT.read_text()
    new = 'const SYS_ICONS = ' + json.dumps(out, ensure_ascii=False) + ';'
    js2, n = re.subn(r'const SYS_ICONS = \{.*?\};', lambda m: new, js, count=1, flags=re.S)
    assert n == 1
    OUT.write_text(js2)
    print('SYS_ICONS:', len(out), 'ícones,', len(new), 'chars')


if __name__ == '__main__':
    write(build())
