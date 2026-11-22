#!/usr/bin/env python3
"""Motor de caras do Ludrix — gera a cara embutida (Padrão = arquivo) em src/renderer/themes/arquivo/ e TODAS as
outras como PACOTES importáveis em temas/<slug>/ {theme.json,face.css,dark.css,light.css[,preview.png]}
(a partir de template.css + esqueleto + pele v2). Só a Padrão (e a Grafite legada) ficam dentro do app; o bloco
FACES de src/main/themes.ts é reescrito só com elas. Depois: python3 tools/faces/pack.py empacota temas/*
em entrega/temas/*.lxtheme assinados. Uso: python3 tools/faces/gen.py [slug ...]"""
import pathlib, re, json, urllib.parse, sys, math, random

ROOT = pathlib.Path(__file__).resolve().parents[2]
TPL = (ROOT / 'tools/faces/template.css').read_text(encoding='utf8')
OUT = ROOT / 'src/renderer/themes'
PACKS = ROOT / 'temas'
BUILTIN = {'arquivo'}
VERSION = json.loads((ROOT / 'version.json').read_text(encoding='utf8')).get('version', '4.2.0') if (ROOT / 'version.json').exists() else '4.2.0'

INTER = '"Inter",system-ui,sans-serif'
RUBIK = '"Rubik","Segoe UI",system-ui,sans-serif'
OUTFIT = '"Outfit","Segoe UI Variable Display","Segoe UI",system-ui,sans-serif'
MONO = '"Cascadia Mono","Consolas","DejaVu Sans Mono",ui-monospace,monospace'
SERIF = '"Georgia","DejaVu Serif","Times New Roman",serif'

# ------------------------------------------------------------------ SVG decor helpers
def uri(svg):
    return 'url("data:image/svg+xml,' + urllib.parse.quote(svg, safe="=:/ '();,.-%") + '")'

def svg(layers, w=1280, h=800, defs=''):
    return uri(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" preserveAspectRatio="xMidYMid slice"><defs>{defs}</defs>{"".join(layers)}</svg>')

def hairlines(stroke, op, seed=4, step=7):
    lines = ''.join(f'<path d="M-100 {y}H1400"/>' for y in range(0, 800, step))
    d = f'<filter id="w" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="turbulence" baseFrequency=".004 .02" numOctaves="2" seed="{seed}"/><feDisplacementMap in="SourceGraphic" scale="60"/></filter>'
    return d, f'<g filter="url(#w)" opacity="{op}" stroke="{stroke}" stroke-width=".6" fill="none">{lines}</g>'

def diag_bars(fill, op):
    return f'<g fill="{fill}" opacity="{op}"><path d="M60 560h120l-110 110h-70v-40z"/><path d="M230 560h150l-200 200h-150z"/><path d="M430 560h60l-200 200h-60z"/><path d="M540 560h150l-200 200h-150z"/><path d="M60 470h50l-50 50z"/></g>'

def pattern(pid, w, h, body):
    return f'<pattern id="{pid}" width="{w}" height="{h}" patternUnits="userSpaceOnUse">{body}</pattern>'

def fill_rect(pid, op=1):
    return f'<rect width="1280" height="800" fill="url(#{pid})" opacity="{op}"/>'

def hexgrid(stroke, op, size=28):
    w = size * math.sqrt(3); h = size * 1.5
    pts = lambda cx, cy: ' '.join(f'{cx + size * math.cos(math.radians(60 * i + 30)):.1f},{cy + size * math.sin(math.radians(60 * i + 30)):.1f}' for i in range(6))
    body = f'<polygon points="{pts(w / 2, size)}" fill="none" stroke="{stroke}" stroke-width="1"/><polygon points="{pts(0, size + h)}" fill="none" stroke="{stroke}" stroke-width="1"/><polygon points="{pts(w, size + h)}" fill="none" stroke="{stroke}" stroke-width="1"/>'
    return pattern('hx', f'{w:.2f}', f'{2 * h:.2f}', body), fill_rect('hx', op)

def grid(stroke, op, size=40, sw=1):
    return pattern('gr', size, size, f'<path d="M{size} 0H0V{size}" fill="none" stroke="{stroke}" stroke-width="{sw}"/>'), fill_rect('gr', op)

def dots(fill, op, gap=18, r=1.2):
    return pattern('dt', gap, gap, f'<circle cx="{gap / 2}" cy="{gap / 2}" r="{r}" fill="{fill}"/>'), fill_rect('dt', op)

def pegholes(fill, op, gap=34, r=4):
    return pattern('pg', gap, gap, f'<circle cx="{gap / 2}" cy="{gap / 2}" r="{r}" fill="{fill}"/>'), fill_rect('pg', op)

def scan(fill, op, step=4):
    return pattern('sc', 1, step, f'<rect width="1" height="1" fill="{fill}"/>'), fill_rect('sc', op)

def stripes(fill, op, w=18, angle=45):
    return pattern('st', w, w, f'<path d="M0 {w}L{w} 0M-{w / 2} {w / 2}L{w / 2} -{w / 2}M{w / 2} {w * 1.5}L{w * 1.5} {w / 2}" stroke="{fill}" stroke-width="{w / 3}"/>'), fill_rect('st', op)

def herringbone(stroke, op, w=24):
    return pattern('hb', w, w, f'<path d="M0 0L{w / 2} {w / 2}L0 {w}M{w} 0L{w / 2} {w / 2}L{w} {w}" fill="none" stroke="{stroke}" stroke-width="1"/>'), fill_rect('hb', op)

def circuit(stroke, op, seed=7, n=60):
    rnd = random.Random(seed); out = []
    for _ in range(n):
        x, y = rnd.randrange(0, 1280, 20), rnd.randrange(0, 800, 20); d = f'M{x} {y}'
        for _ in range(rnd.randint(2, 5)):
            if rnd.random() < .5: x += rnd.choice([-1, 1]) * rnd.randrange(40, 200, 20)
            else: y += rnd.choice([-1, 1]) * rnd.randrange(40, 160, 20)
            d += f'L{x} {y}'
        out.append(f'<path d="{d}"/><circle cx="{x}" cy="{y}" r="3"/>')
    return f'<g opacity="{op}" stroke="{stroke}" stroke-width="1.2" fill="none">{"".join(out)}</g>'

def topo(stroke, op, seed=3, n=14):
    d = f'<filter id="tp" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".006" numOctaves="3" seed="{seed}"/><feDisplacementMap in="SourceGraphic" scale="120"/></filter>'
    rings = ''.join(f'<ellipse cx="900" cy="560" rx="{80 + i * 60}" ry="{50 + i * 42}"/>' for i in range(n))
    return d, f'<g filter="url(#tp)" opacity="{op}" stroke="{stroke}" stroke-width="1" fill="none">{rings}</g>'

def waves(stroke, op, n=18, amp=26):
    paths = []
    for i in range(n):
        y = 120 + i * 40
        paths.append(f'<path d="M-50 {y} C 200 {y - amp}, 400 {y + amp}, 650 {y} S 1100 {y - amp}, 1350 {y}"/>')
    return f'<g opacity="{op}" stroke="{stroke}" stroke-width="1" fill="none">{"".join(paths)}</g>'

def dunes(fills, op):
    return f'<g opacity="{op}"><path d="M0 520 C 300 420, 520 640, 800 540 S 1150 440, 1280 500 V800 H0z" fill="{fills[0]}"/><path d="M0 640 C 260 560, 560 720, 860 640 S 1180 580, 1280 620 V800 H0z" fill="{fills[1]}"/></g>'

def halftone(fill, op, gap=10):
    rows = []
    for j in range(0, 800, gap):
        for i in range(0, 1280, gap):
            t = max(0, 1 - math.hypot(i - 1100, j - 650) / 560)
            if t > .05: rows.append(f'<circle cx="{i}" cy="{j}" r="{t * gap * .48:.1f}"/>')
    return f'<g fill="{fill}" opacity="{op}">{"".join(rows)}</g>'

def rivets(fill, op, inset=22, gap=160):
    pts = [(x, inset) for x in range(inset, 1281, gap)] + [(x, 800 - inset) for x in range(inset, 1281, gap)] + [(inset, y) for y in range(inset, 801, gap)] + [(1280 - inset, y) for y in range(inset, 801, gap)]
    return f'<g fill="{fill}" opacity="{op}">' + ''.join(f'<circle cx="{x}" cy="{y}" r="3"/>' for x, y in pts) + '</g>'

def frame(stroke, op, inset=10, sw=2):
    return f'<rect x="{inset}" y="{inset}" width="{1280 - 2 * inset}" height="{800 - 2 * inset}" fill="none" stroke="{stroke}" stroke-width="{sw}" opacity="{op}"/>'

def corners(stroke, op, size=40, inset=16, sw=2):
    i, s = inset, size
    return f'<g fill="none" stroke="{stroke}" stroke-width="{sw}" opacity="{op}"><path d="M{i} {i + s}V{i}H{i + s}"/><path d="M{1280 - i - s} {i}H{1280 - i}V{i + s}"/><path d="M{i} {800 - i - s}V{800 - i}H{i + s}"/><path d="M{1280 - i - s} {800 - i}H{1280 - i}V{800 - i - s}"/></g>'

def hazard(c1, c2, op, x=0, y=780, w=1280, h=20):
    return f'<g opacity="{op}"><rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{c1}"/><path d="{"".join(f"M{x + i} {y}l-{h} {h}h{h / 2}l{h} -{h}z" for i in range(0, w + h, int(h * 2)))}" fill="{c2}"/></g>'

def glowline(color, op, x=70):
    return f'<g opacity="{op}"><rect x="{x}" y="0" width="2" height="800" fill="{color}"/><rect x="{x - 12}" y="0" width="26" height="800" fill="{color}" opacity=".18"/></g>'

def chain(stroke, op, n=9):
    links = ''.join(f'<rect x="{1140}" y="{40 + i * 80}" width="34" height="60" rx="17" fill="none" stroke="{stroke}" stroke-width="5"/>' for i in range(n))
    return f'<g opacity="{op}">{links}</g>'

def wall(*layers):
    return ','.join(layers)

def rg(shape, x, y, color, stop=60):
    return f'radial-gradient({shape} at {x}% {y}%,{color},transparent {stop}%)'

# ------------------------------------------------------------------ paletas
def tokens(bg, ink, ink2, ink3, pnl, pnlh, pnl2, pnl3, line, hair, br, fill, onfill, inp, pop, wall_css, acc, blur=14, extra=''):
    return (f'  --arq-pnl:{pnl};--arq-pnlh:{pnlh};--arq-pnl2:{pnl2};--arq-pnl3:{pnl3};\n'
            f'  --arq-line:{line};--arq-hair:{hair};--arq-br:{br};\n'
            f'  --arq-ink:{ink};--arq-ink2:{ink2};--arq-ink3:{ink3};--arq-fill:{fill};--arq-onfill:{onfill};--arq-in:{inp};\n'
            f'  --arq-pop:{pop};--arq-acc:{acc};--arq-blur:{blur}px;--arq-bgc:{bg};\n'
            f'  --arq-wall:{wall_css};{extra}')

def dark_pal(bg, acc, ink='#eef0f3', ink2='#c7ccd4', ink3='#8a919c', pnl='rgba(10,12,16,.55)', pnlh='rgba(10,12,16,.72)', fill=None, onfill=None, wall_css=None, line='rgba(255,255,255,.18)', hair='rgba(255,255,255,.1)', br='rgba(255,255,255,.55)', pnl2='rgba(255,255,255,.06)', pnl3='rgba(255,255,255,.11)', inp='rgba(0,0,0,.25)', pop='rgba(14,16,20,.92)', blur=14, extra=''):
    return tokens(bg, ink, ink2, ink3, pnl, pnlh, pnl2, pnl3, line, hair, br, fill or ink, onfill or '#111', inp, pop, wall_css or f'linear-gradient(180deg,{bg},{bg})', acc, blur, extra)

def light_pal(bg, acc, ink='#15181d', ink2='#3c424b', ink3='#6a717c', pnl='rgba(255,255,255,.55)', pnlh='rgba(255,255,255,.78)', fill=None, onfill=None, wall_css=None, line='rgba(21,24,29,.22)', hair='rgba(21,24,29,.12)', br='rgba(21,24,29,.6)', pnl2='rgba(21,24,29,.05)', pnl3='rgba(21,24,29,.1)', inp='rgba(255,255,255,.5)', pop='rgba(246,244,240,.94)', blur=14, extra=''):
    return tokens(bg, ink, ink2, ink3, pnl, pnlh, pnl2, pnl3, line, hair, br, fill or ink, onfill or '#fff', inp, pop, wall_css or f'linear-gradient(180deg,{bg},{bg})', acc, blur, extra)

def scheme_css(bg, bg2, panel, card, card2, line, line2, text, muted, muted2, green, red, amber, light, deco):
    return (f':root{{\n  --bg:{bg};\n  --bg2:{bg2};\n  --panel:{panel};\n  --card:{card};\n  --card2:{card2};\n  --line:{line};\n  --line2:{line2};\n  --text:{text};\n  --muted:{muted};\n  --muted2:{muted2};\n'
            f'  --green:{green};\n  --green2:{green};\n  --red:{red};\n  --amber:{amber};\n  --shadow:0 24px 60px -30px rgba(0,0,0,{".35" if light else ".8"});\n  --glow1:transparent;\n  --glow2:transparent;\n  --glow3:transparent;\n'
            f'  --ph-from:{card};\n  --ph-to:{card2};\n  --img-fade:{bg};\n  --logo-bg:{text};\n  --mono:{text};\n  --mono2:{muted};\n  color-scheme:{"light" if light else "dark"};\n  --arq-deco:{deco};\n}}\n')

def mix(hex1, hex2, t):
    a = [int(hex1[i:i + 2], 16) for i in (1, 3, 5)]; b = [int(hex2[i:i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{round(a[i] + (b[i] - a[i]) * t):02x}' for i in range(3))

def dark_scheme(bg, acc, ink, deco, green='#8fd3a0', red='#ff7a6e', amber='#ffb347'):
    return scheme_css(bg, mix(bg, '#ffffff', .05), mix(bg, '#ffffff', .04), mix(bg, '#ffffff', .08), mix(bg, '#ffffff', .12), 'rgba(255,255,255,.1)', 'rgba(255,255,255,.22)', ink, mix(ink, bg, .25), mix(ink, bg, .5), green, red, amber, False, deco)

def light_scheme(bg, acc, ink, deco, green='#1f8a52', red='#c8382c', amber='#9a6200'):
    return scheme_css(bg, mix(bg, '#ffffff', .5), mix(bg, '#ffffff', .6), '#ffffff', mix(bg, '#000000', .04), 'rgba(21,24,29,.12)', 'rgba(21,24,29,.26)', ink, mix(ink, bg, .3), mix(ink, bg, .55), green, red, amber, True, deco)

# ------------------------------------------------------------------ tipografia / forma
EDITORIAL = dict(font_text=INTER, font_disp=INTER, font_mono=MONO, title_w=300, title_tt='uppercase', title_ls='.08em', h_w=300, h_size='14px', h_tt='uppercase', h_ls='4px', brand_w=300, brand_ls='-.5px', ltt='uppercase', lsk=1, r=0, rp=4, rs=0)
TECH = dict(font_text=INTER, font_disp=INTER, font_mono=MONO, title_w=700, title_tt='uppercase', title_ls='.04em', h_w=700, h_size='13px', h_tt='uppercase', h_ls='2px', brand_w=800, brand_ls='-.5px', ltt='uppercase', lsk=1, r=2, rp=4, rs=2)
DISPLAY = dict(font_text=INTER, font_disp=OUTFIT, font_mono=MONO, title_w=800, title_tt='uppercase', title_ls='-.01em', h_w=800, h_size='15px', h_tt='uppercase', h_ls='1px', brand_w=900, brand_ls='-.02em', ltt='uppercase', lsk=1, r=4, rp=6, rs=3)
SOFT = dict(font_text=RUBIK, font_disp=OUTFIT, font_mono=RUBIK, title_w=700, title_tt='none', title_ls='-.02em', h_w=700, h_size='17px', h_tt='none', h_ls='0', brand_w=800, brand_ls='-.02em', ltt='none', lsk=0, r=12, rp=18, rs=99)
ROUND = dict(SOFT, r=10, rp=14, rs=8)
PIXEL = dict(font_text=INTER, font_disp=MONO, font_mono=MONO, title_w=700, title_tt='uppercase', title_ls='.06em', h_w=700, h_size='13px', h_tt='uppercase', h_ls='3px', brand_w=700, brand_ls='0', ltt='uppercase', lsk=1, r=0, rp=0, rs=0)

def typ(base, **kw):
    d = dict(base); d.update(kw); return d

# ------------------------------------------------------------------ specs
F = []
def face(slug, name, desc, acc, layout, t, dark, light, dark_deco, light_deco, brand='©LUDRIX', sub='ARTWORK AND DESIGN CURATED AND COMPILED\\A BY LUDRIX.', year='MMXXVI', stamp='LDRX/: ARCHV/-01\\00a0\\00a0\\00a0\\00a0®', swatch=None, console=None):
    F.append(dict(slug=slug, name=name, desc=desc, acc=acc, layout=layout, t=t, dark=dark, light=light, dd=dark_deco, ld=light_deco, brand=brand, sub=sub, year=year, stamp=stamp, swatch=swatch, console=console))

W = 'rgba(255,255,255,'
K = 'rgba(0,0,0,'

# 29 ARQUIVO (padrão)
face('arquivo', 'Padrão', 'Editorial: fundo iridescente laranja e azul desfocado, linhas finas, painéis de vidro e tipografia leve com rótulos monoespaçados. Grafite no escuro, papel no claro.', '#ff7a3c', 'editorial', EDITORIAL,
     dict(bg='#1a1d22', pal=dark_pal('#1a1d22', '#ff7a3c', wall_css=wall(rg('ellipse 40% 30%', 30, 25, 'rgba(255,120,60,.55)'), rg('ellipse 50% 40%', 20, 40, 'rgba(90,170,200,.55)', 65), rg('ellipse 30% 50%', 55, 30, 'rgba(255,90,30,.45)'), rg('ellipse 60% 40%', 70, 80, 'rgba(120,190,220,.45)', 65), rg('ellipse 40% 30%', 30, 85, 'rgba(255,140,80,.35)'), 'linear-gradient(180deg,#3a3f47,#15181d)'))),
     dict(bg='#e9e6e1', pal=light_pal('#e9e6e1', '#ff7a3c', wall_css=wall(rg('ellipse 40% 30%', 30, 25, 'rgba(255,110,50,.62)'), rg('ellipse 50% 40%', 20, 40, 'rgba(70,160,200,.6)', 65), rg('ellipse 30% 50%', 55, 30, 'rgba(255,90,30,.5)'), rg('ellipse 60% 40%', 70, 80, 'rgba(100,180,220,.55)', 65), rg('ellipse 40% 30%', 30, 85, 'rgba(255,140,80,.42)'), 'linear-gradient(180deg,#f3f0ea,#dad6cf)'))),
     lambda: svg([hairlines('#dfe3e8', .16)[1], scan(W + '.07)', 1)[1], diag_bars('#5a5f66', .85)], defs=hairlines('#dfe3e8', .16)[0] + scan(W + '.07)', 1)[0]),
     lambda: svg([hairlines('#15181d', .11)[1], scan(K + '.04)', 1)[1], diag_bars('#9aa0a8', .55)], defs=hairlines('#15181d', .11)[0] + scan(K + '.04)', 1)[0]),
     sub='ARTWORK AND DESIGN CURATED AND COMPILED\\A BY LUDRIX. ARCHIVE 29.', stamp='LDRX/: ARCHV/-29\\00a0\\00a0\\00a0\\00a0®', swatch=(['#1a1d22', '#ff7a3c'], ['#e9e6e1', '#5aaac8']), console=('arquivo', 'arquivo-claro'))

# 01 METAL VERDE — chapa escura, verde terminal, mono
face('metal-verde', 'Metal Verde', 'Chapa de aço escura com rebites, HUD em verde terminal e rótulos monoespaçados; claro em alumínio escovado.', '#3ddc84', 'panel', typ(TECH, font_disp=MONO, title_w=700, h_w=700),
     dict(bg='#0b0d0f', pal=dark_pal('#0b0d0f', '#3ddc84', ink='#e6ecef', ink2='#aab3ba', ink3='#6f787f', pnl='rgba(16,20,23,.72)', pnlh='rgba(16,20,23,.9)', fill='#3ddc84', onfill='#06130c', line='rgba(61,220,132,.28)', hair='rgba(230,236,239,.09)', br='rgba(61,220,132,.6)', wall_css=wall('linear-gradient(135deg,#1c2227,#0b0d0f 55%,#141a1e)'))),
     dict(bg='#dfe6ea', pal=light_pal('#dfe6ea', '#1f9d63', fill='#1f9d63', onfill='#fff', line='rgba(21,24,29,.2)', wall_css=wall('linear-gradient(135deg,#eef3f5,#d3dbe0 60%,#e6ecef)'))),
     lambda: svg([grid('#3ddc84', .07, 40)[1], rivets('#3ddc84', .5), corners('#3ddc84', .6), scan(W + '.05)', 1)[1]], defs=grid('#3ddc84', .07, 40)[0] + scan(W + '.05)', 1)[0]),
     lambda: svg([grid('#15181d', .06, 40)[1], rivets('#15181d', .35), corners('#15181d', .4)], defs=grid('#15181d', .06, 40)[0]),
     brand='LUDRIX//04', sub='ADVANCED METAL INTERFACE\\A UNIT 01 · GREEN PHOSPHOR', year='SYS/OK', stamp='CPU 41° · GPU 58°\\00a0\\00a0▮▮▮▮▯', swatch=(['#0b0d0f', '#3ddc84'], ['#dfe6ea', '#1f9d63']))

# 02 CIRCUITO P&B — papel branco, traços de circuito pretos
face('circuito-pb', 'Circuito P&B', 'Papel branco com traços de circuito em preto, molduras finas e tipografia preta e pesada; no escuro, placa preta com traços brancos.', '#111111', 'panel', typ(TECH, font_disp=INTER, title_w=800, h_w=800, h_ls='1px', title_ls='-.02em'),
     dict(bg='#0e0e0e', pal=dark_pal('#0e0e0e', '#ffffff', ink='#f2f2f0', ink2='#c8c8c4', ink3='#8a8a86', pnl='rgba(20,20,20,.8)', pnlh='rgba(20,20,20,.94)', fill='#fff', onfill='#0e0e0e', line='rgba(255,255,255,.3)', hair='rgba(255,255,255,.12)', br='rgba(255,255,255,.8)')),
     dict(bg='#f2f2f0', pal=light_pal('#f2f2f0', '#111111', ink='#0e0e0e', ink2='#3a3a38', ink3='#6a6a66', pnl='rgba(255,255,255,.82)', pnlh='rgba(255,255,255,.95)', fill='#0e0e0e', onfill='#fff', line='rgba(14,14,14,.35)', hair='rgba(14,14,14,.14)', br='#0e0e0e')),
     lambda: svg([circuit('#ffffff', .22, 7), frame('#ffffff', .4, 14, 1.5)]),
     lambda: svg([circuit('#0e0e0e', .2, 7), frame('#0e0e0e', .6, 14, 1.5)]),
     brand='LXLB', sub='LUDRIX LIBRARY\\A MONOCHROME CIRCUIT BOARD', year='PCB-02', stamp='REV. B\\00a0\\00a0\\00a0\\00a0⌁', swatch=(['#0e0e0e', '#ffffff'], ['#f2f2f0', '#0e0e0e']))

# 03 HEX AZUL — azul elétrico, malha hexagonal
face('hex-azul', 'Hex Azul', 'Malha hexagonal e azul elétrico sobre fundo marinho; painéis escuros com brilho azul; claro em azul-gelo.', '#5aa0ff', 'panel', typ(DISPLAY, title_tt='none', title_w=800),
     dict(bg='#0b1a3a', pal=dark_pal('#0b1a3a', '#5aa0ff', ink='#dbe7ff', ink2='#9cc0f5', ink3='#5f7fb8', pnl='rgba(10,22,52,.7)', pnlh='rgba(10,22,52,.9)', fill='#5aa0ff', onfill='#06142e', line='rgba(90,160,255,.3)', hair='rgba(156,192,245,.12)', br='rgba(90,160,255,.7)', wall_css=wall(rg('ellipse 50% 40%', 80, 20, 'rgba(90,160,255,.35)'), 'linear-gradient(180deg,#12306a,#070f22)'))),
     dict(bg='#dbe7ff', pal=light_pal('#dbe7ff', '#1d4aa0', ink='#0b1a3a', ink2='#1d4aa0', ink3='#4e6a9e', fill='#1d4aa0', onfill='#fff', line='rgba(29,74,160,.3)', hair='rgba(29,74,160,.14)', br='rgba(29,74,160,.7)', wall_css=wall(rg('ellipse 50% 40%', 80, 20, 'rgba(90,160,255,.45)'), 'linear-gradient(180deg,#eaf1ff,#c9d9f6)'))),
     lambda: svg([hexgrid('#5aa0ff', .22, 26)[1]], defs=hexgrid('#5aa0ff', .22, 26)[0]),
     lambda: svg([hexgrid('#1d4aa0', .18, 26)[1]], defs=hexgrid('#1d4aa0', .18, 26)[0]),
     brand='Ludrix', sub='HEX GRID INTERFACE\\A BLUE SERIES', year='HX-03', stamp='LDRX/: HEX/-03\\00a0\\00a0⬡', swatch=(['#0b1a3a', '#5aa0ff'], ['#dbe7ff', '#1d4aa0']))

# 04 SAMPLER — preto fosco, botões de sampler, laranja queimado
face('sampler', 'Sampler', 'Painel de sampler: preto fosco, pads quadrados, LEDs laranja-queimado e rótulos serigrafados.', '#e8552a', 'panel', typ(TECH, title_w=800, title_tt='uppercase', h_ls='3px'),
     dict(bg='#141517', pal=dark_pal('#141517', '#e8552a', ink='#d6d6d6', ink2='#a3a4a8', ink3='#6a6b6f', pnl='rgba(43,44,48,.78)', pnlh='rgba(43,44,48,.94)', fill='#e8552a', onfill='#140804', line='rgba(214,214,214,.16)', hair='rgba(214,214,214,.08)', br='rgba(214,214,214,.5)', wall_css=wall('linear-gradient(180deg,#1b1c1f,#0f1012)'))),
     dict(bg='#d6d6d6', pal=light_pal('#d6d6d6', '#c2401c', ink='#141517', ink2='#3a3b3f', ink3='#6a6b6f', pnl='rgba(240,240,240,.7)', pnlh='rgba(240,240,240,.92)', fill='#c2401c', onfill='#fff', wall_css=wall('linear-gradient(180deg,#e4e4e4,#c9c9c9)'))),
     lambda: svg([dots('#d6d6d6', .12, 22, 1.4)[1], hazard('#e8552a', '#141517', .9, 0, 788, 1280, 12)], defs=dots('#d6d6d6', .12, 22, 1.4)[0]),
     lambda: svg([dots('#141517', .1, 22, 1.4)[1], hazard('#c2401c', '#d6d6d6', .9, 0, 788, 1280, 12)], defs=dots('#141517', .1, 22, 1.4)[0]),
     brand='LUDRIX SP-04', sub='SAMPLING LAUNCHER\\A 16 PADS · 4 BANKS', year='BANK A', stamp='PAD 01 · 16 BIT\\00a0\\00a0●', swatch=(['#141517', '#e8552a'], ['#d6d6d6', '#c2401c']))

# 05 HUD PRETO — preto absoluto, linhas brancas finas, cantos de mira
face('hud-preto', 'HUD Preto', 'Preto absoluto com linhas brancas finas, cantos de mira e dados monoespaçados; claro em cinza-chumbo invertido.', '#ffffff', 'editorial', typ(EDITORIAL, font_disp=MONO, title_w=400, title_ls='.14em', h_w=400),
     dict(bg='#050505', pal=dark_pal('#050505', '#ffffff', ink='#f4f4f4', ink2='#b5b5b5', ink3='#777777', pnl='rgba(12,12,12,.7)', pnlh='rgba(12,12,12,.92)', fill='#f4f4f4', onfill='#050505', line='rgba(255,255,255,.26)', hair='rgba(255,255,255,.1)', br='rgba(255,255,255,.7)', blur=8)),
     dict(bg='#e6e6e6', pal=light_pal('#e6e6e6', '#111111', ink='#0a0a0a', ink2='#3a3a3a', ink3='#6a6a6a', pnl='rgba(255,255,255,.6)', pnlh='rgba(255,255,255,.9)', fill='#0a0a0a', onfill='#fff', blur=8)),
     lambda: svg([grid('#ffffff', .05, 80)[1], corners('#ffffff', .8, 60, 18, 1.5), frame('#ffffff', .25, 18, 1), f'<g stroke="#fff" opacity=".5" stroke-width="1"><path d="M640 14v16M640 770v16M14 400h16M1250 400h16"/></g>'], defs=grid('#ffffff', .05, 80)[0]),
     lambda: svg([grid('#0a0a0a', .05, 80)[1], corners('#0a0a0a', .7, 60, 18, 1.5), frame('#0a0a0a', .3, 18, 1)], defs=grid('#0a0a0a', .05, 80)[0]),
     brand='LUDRIX', sub='HEADS-UP LAUNCHER\\A BLACK · NO COLOR', year='HUD/05', stamp='TRK 00 · LOCK\\00a0\\00a0+', swatch=(['#050505', '#ffffff'], ['#e6e6e6', '#0a0a0a']))

# 06 MECHA AMARELO — amarelo industrial, preto, listras de perigo
face('mecha-amarelo', 'Mecha Amarelo', 'Amarelo industrial e preto: painéis chapados, listras de perigo, botões grandes e rótulos estampados.', '#f5b400', 'panel', typ(DISPLAY, title_w=900, h_w=800, h_ls='2px'),
     dict(bg='#111216', pal=dark_pal('#111216', '#f5b400', ink='#f3f3f0', ink2='#c9c9c4', ink3='#8a8d94', pnl='rgba(24,25,30,.86)', pnlh='rgba(24,25,30,.96)', fill='#f5b400', onfill='#1a1400', line='rgba(245,180,0,.35)', hair='rgba(243,243,240,.1)', br='rgba(245,180,0,.8)', wall_css=wall('linear-gradient(180deg,#f5b400 0,#f5b400 64px,#111216 64px)'), blur=6)),
     dict(bg='#f5b400', pal=light_pal('#f5b400', '#111216', ink='#111216', ink2='#3a3200', ink3='#6a5a10', pnl='rgba(255,245,210,.72)', pnlh='rgba(255,245,210,.94)', fill='#111216', onfill='#f5b400', line='rgba(17,18,22,.35)', hair='rgba(17,18,22,.14)', br='#111216', wall_css=wall('linear-gradient(180deg,#ffc81e,#e8a800)'), blur=6)),
     lambda: svg([hazard('#f5b400', '#111216', 1, 0, 784, 1280, 16), hazard('#f5b400', '#111216', 1, 0, 0, 1280, 6), dots('#f5b400', .15, 28, 1.5)[1]], defs=dots('#f5b400', .15, 28, 1.5)[0]),
     lambda: svg([hazard('#111216', '#f5b400', 1, 0, 784, 1280, 16), dots('#111216', .12, 28, 1.5)[1]], defs=dots('#111216', .12, 28, 1.5)[0]),
     brand='LUDRIX', sub='HEAVY INDUSTRY LAUNCHER\\A UNIT 06 · CAUTION', year='MK-06', stamp='LOAD 41% · ARM\\00a0\\00a0⚠', swatch=(['#111216', '#f5b400'], ['#f5b400', '#111216']))

# 07 OLIVA 2044 — verde-oliva, lima, futurismo militar
face('oliva-2044', 'Oliva 2044', 'Verde-oliva profundo com lima ácido, painéis translúcidos e cantos chanfrados; claro em creme-oliva.', '#e6f08a', 'panel', typ(DISPLAY, title_w=700, h_w=700),
     dict(bg='#2b3318', pal=dark_pal('#2b3318', '#e6f08a', ink='#f2f6d0', ink2='#c9d67a', ink3='#8f9a5a', pnl='rgba(32,40,18,.68)', pnlh='rgba(32,40,18,.9)', fill='#e6f08a', onfill='#1e2408', line='rgba(230,240,138,.3)', hair='rgba(242,246,208,.1)', br='rgba(230,240,138,.7)', wall_css=wall(rg('ellipse 50% 50%', 85, 90, 'rgba(230,240,138,.25)'), 'linear-gradient(180deg,#3a4420,#1d2410)'))),
     dict(bg='#e8ecc8', pal=light_pal('#e8ecc8', '#4b5a1e', ink='#1d2410', ink2='#3f4a1c', ink3='#6f7a3e', fill='#4b5a1e', onfill='#f2f6d0', wall_css=wall(rg('ellipse 50% 50%', 85, 90, 'rgba(230,240,138,.6)'), 'linear-gradient(180deg,#f2f6d0,#dfe5b8)'))),
     lambda: svg([topo('#e6f08a', .14)[1], corners('#e6f08a', .5, 50, 16, 2)], defs=topo('#e6f08a', .14)[0]),
     lambda: svg([topo('#4b5a1e', .14)[1], corners('#4b5a1e', .5, 50, 16, 2)], defs=topo('#4b5a1e', .14)[0]),
     brand='LUDRIX', sub='FIELD LAUNCHER 2044\\A OLIVE DRAB · LIME', year='2044', stamp='SEC 07 · OLV\\00a0\\00a0↗', swatch=(['#2b3318', '#e6f08a'], ['#e8ecc8', '#4b5a1e']))

# 08 TOPOGRAFIA LIMA — preto com curvas de nível e lima neon
face('topografia-lima', 'Topografia Lima', 'Curvas de nível sobre preto, lima neon nos destaques e painéis sutis; claro em papel-mapa.', '#c6ff00', 'editorial', typ(TECH, title_w=800, title_tt='none', title_ls='-.02em'),
     dict(bg='#060606', pal=dark_pal('#060606', '#c6ff00', ink='#f1f3ea', ink2='#aab39a', ink3='#6e7762', pnl='rgba(14,15,12,.7)', pnlh='rgba(14,15,12,.92)', fill='#c6ff00', onfill='#0f1200', line='rgba(198,255,0,.3)', hair='rgba(241,243,234,.1)', br='rgba(198,255,0,.7)')),
     dict(bg='#f1f3ea', pal=light_pal('#f1f3ea', '#5f7a00', ink='#0f100c', ink2='#3a4030', ink3='#6e7762', fill='#0f100c', onfill='#c6ff00')),
     lambda: svg([topo('#9aa58a', .3, 5, 22)[1]], defs=topo('#9aa58a', .3, 5, 22)[0]),
     lambda: svg([topo('#6e7762', .3, 5, 22)[1]], defs=topo('#6e7762', .3, 5, 22)[0]),
     brand='Ludrix', sub='TOPOGRAPHIC LAUNCHER\\A CONTOUR 08 · LIME', year='ALT 760', stamp='LAT -23.69 · LON -46.56\\00a0\\00a0▲', swatch=(['#060606', '#c6ff00'], ['#f1f3ea', '#5f7a00']))

# 09 CIRCUITO LILÁS — lilás, rosa-pêssego, preto; traços
face('circuito-lilas', 'Circuito Lilás', 'Lilás com moldura preta arredondada, traços de circuito e detalhes em pêssego; claro em lilás-claro.', '#7b63c8', 'panel', typ(ROUND, font_disp=OUTFIT, title_w=800, title_tt='uppercase', title_ls='.02em', h_w=800, h_tt='uppercase', h_ls='1px', ltt='uppercase', lsk=.6, font_mono=MONO),
     dict(bg='#0a0a0a', pal=dark_pal('#0a0a0a', '#7b63c8', ink='#efd6cc', ink2='#cdb8ae', ink3='#8a7a74', pnl='rgba(42,31,74,.6)', pnlh='rgba(42,31,74,.9)', fill='#efd6cc', onfill='#2a1f4a', line='rgba(239,214,204,.22)', hair='rgba(239,214,204,.1)', br='rgba(239,214,204,.6)', wall_css=wall('linear-gradient(160deg,#7b63c8,#4a3a94 50%,#0a0a0a 92%)'))),
     dict(bg='#cdb8f0', pal=light_pal('#cdb8f0', '#4a3a94', ink='#1b1230', ink2='#3a2f5a', ink3='#6a5f8a', pnl='rgba(255,255,255,.55)', pnlh='rgba(255,255,255,.9)', fill='#1b1230', onfill='#efd6cc', wall_css=wall('linear-gradient(160deg,#e3d6f7,#b9a4e6 60%,#d7c7f2)'))),
     lambda: svg([circuit('#efd6cc', .22, 9, 50), f'<rect x="10" y="10" width="1260" height="780" rx="34" fill="none" stroke="#0a0a0a" stroke-width="14"/>']),
     lambda: svg([circuit('#1b1230', .16, 9, 50), f'<rect x="10" y="10" width="1260" height="780" rx="34" fill="none" stroke="#1b1230" stroke-width="10" opacity=".8"/>']),
     brand='LXLB', sub='LILAC CIRCUIT\\A LAUNCHER 09', year='LX/09', stamp='PCB · LILAC\\00a0\\00a0◍', swatch=(['#0a0a0a', '#7b63c8'], ['#cdb8f0', '#4a3a94']))

# 10 FATIAS — laranja vivo em fatias diagonais, tipografia redonda
face('fatias', 'Fatias', 'Fatias diagonais de laranja vivo sobre marrom profundo, cantos redondos e tipografia amigável; claro em creme-laranja.', '#ff7a2a', 'panel', typ(SOFT, lsk=0),
     dict(bg='#2a1206', pal=dark_pal('#2a1206', '#ff7a2a', ink='#ffe6c6', ink2='#e2bf98', ink3='#a07c5a', pnl='rgba(42,26,12,.72)', pnlh='rgba(42,26,12,.94)', fill='#ff7a2a', onfill='#2a1206', line='rgba(255,230,198,.2)', hair='rgba(255,230,198,.1)', br='rgba(255,122,42,.8)', wall_css=wall('linear-gradient(170deg,#ff7a2a 0 28%,#2a1206 28% 58%,#ffb15a 58% 62%,#2a1206 62%)'))),
     dict(bg='#ffe6c6', pal=light_pal('#ffe6c6', '#d85f14', ink='#2a1206', ink2='#5a3a1e', ink3='#8a6a4a', pnl='rgba(255,255,255,.6)', pnlh='rgba(255,255,255,.92)', fill='#ff7a2a', onfill='#2a1206', wall_css=wall('linear-gradient(170deg,#ff7a2a 0 22%,#ffe6c6 22% 60%,#ffd09a 60% 64%,#ffe6c6 64%)'))),
     lambda: svg([f'<path d="M0 0H1280V120L0 420z" fill="#ff7a2a" opacity=".12"/>']),
     lambda: svg([f'<path d="M0 0H1280V120L0 420z" fill="#ff7a2a" opacity=".16"/>']),
     brand='Ludrix', sub='Fatias · laranja', year='FATIAS', stamp='10', swatch=(['#2a1206', '#ff7a2a'], ['#ffe6c6', '#d85f14']))

# 11 PLACA NEPTUNE — placa roxa escura, magenta e amarelo
face('placa-neptune', 'Placa Neptune', 'Placa-mãe escura em roxo com trilhas, magenta e amarelo nos destaques e rótulos mono; claro em cinza-lavanda.', '#e03fa0', 'editorial', typ(TECH, font_disp=MONO, title_w=700, h_w=700),
     dict(bg='#07070a', pal=dark_pal('#07070a', '#e03fa0', ink='#f0ecf5', ink2='#b7aecb', ink3='#7b7290', pnl='rgba(42,37,53,.6)', pnlh='rgba(42,37,53,.92)', fill='#ffc83a', onfill='#1a1300', line='rgba(224,63,160,.35)', hair='rgba(240,236,245,.1)', br='rgba(224,63,160,.7)', wall_css=wall(rg('ellipse 40% 40%', 10, 90, 'rgba(224,63,160,.25)'), 'linear-gradient(180deg,#1b1724,#07070a)'))),
     dict(bg='#e9e4f2', pal=light_pal('#e9e4f2', '#b0167a', ink='#1b1724', ink2='#3a3350', ink3='#7b7290', fill='#b0167a', onfill='#fff', wall_css=wall(rg('ellipse 40% 40%', 10, 90, 'rgba(224,63,160,.25)'), 'linear-gradient(180deg,#f3f0f8,#dcd6e8)'))),
     lambda: svg([circuit('#e03fa0', .22, 11, 70), circuit('#ffc83a', .14, 12, 25), dots('#7b7290', .25, 16, 1)[1]], defs=dots('#7b7290', .25, 16, 1)[0]),
     lambda: svg([circuit('#b0167a', .18, 11, 70), circuit('#9a7a00', .12, 12, 25), dots('#3a3350', .18, 16, 1)[1]], defs=dots('#3a3350', .18, 16, 1)[0]),
     brand='LUDRIX', sub='NEPTUNE MAINBOARD\\A REV 11 · MAGENTA/YELLOW', year='NPT-11', stamp='PCIe x16 · VRM OK\\00a0\\00a0⏚', swatch=(['#07070a', '#e03fa0'], ['#e9e4f2', '#b0167a']))

# 12 TITÂNIO VERMELHO — cinza titânio, vermelho-laranja, branco
face('titanio-vermelho', 'Titânio Vermelho', 'Titânio escovado em cinza-azulado com um vermelho-laranja vivo nos controles; claro em titânio claro.', '#ff4a1a', 'panel', typ(TECH, title_w=800, title_tt='uppercase', h_ls='2px'),
     dict(bg='#2e323a', pal=dark_pal('#2e323a', '#ff4a1a', ink='#eef0f3', ink2='#c4c8cf', ink3='#8a8f98', pnl='rgba(58,62,70,.6)', pnlh='rgba(58,62,70,.92)', fill='#ff4a1a', onfill='#fff', line='rgba(238,240,243,.18)', hair='rgba(238,240,243,.09)', br='rgba(238,240,243,.5)', wall_css=wall('linear-gradient(180deg,#3a3e46,#262a31)'))),
     dict(bg='#dcdfe4', pal=light_pal('#dcdfe4', '#e03a0c', ink='#1d2026', ink2='#3a3e46', ink3='#6a6f78', fill='#e03a0c', onfill='#fff', wall_css=wall('linear-gradient(180deg,#eef0f3,#cfd3d9)'))),
     lambda: svg([hairlines('#eef0f3', .1, 2, 3)[1], f'<rect x="0" y="0" width="6" height="800" fill="#ff4a1a"/>'], defs=hairlines('#eef0f3', .1, 2, 3)[0]),
     lambda: svg([hairlines('#1d2026', .08, 2, 3)[1], f'<rect x="0" y="0" width="6" height="800" fill="#e03a0c"/>'], defs=hairlines('#1d2026', .08, 2, 3)[0]),
     brand='LUDRIX', sub='TITANIUM SERIES\\A RED EDITION 12', year='TI-12', stamp='GRADE 5 · Ti6Al4V\\00a0\\00a0■', swatch=(['#2e323a', '#ff4a1a'], ['#dcdfe4', '#e03a0c']))

# 13 APEX — preto, amarelo ácido, listras diagonais, tipografia display
face('apex', 'Apex', 'Preto com amarelo ácido, listras diagonais e tipografia display pesada em itálico; claro em cinza-claro com o mesmo amarelo.', '#f4e81e', 'editorial', typ(DISPLAY, title_w=900, title_ls='-.02em', h_w=900, h_ls='0'),
     dict(bg='#070707', pal=dark_pal('#070707', '#f4e81e', ink='#e8e8e8', ink2='#b8b8b8', ink3='#8a8a8a', pnl='rgba(16,16,16,.78)', pnlh='rgba(16,16,16,.95)', fill='#f4e81e', onfill='#111', line='rgba(232,232,232,.2)', hair='rgba(232,232,232,.09)', br='rgba(244,232,30,.8)', blur=8)),
     dict(bg='#e8e8e8', pal=light_pal('#e8e8e8', '#8a8000', ink='#070707', ink2='#3a3a3a', ink3='#6a6a6a', pnl='rgba(255,255,255,.65)', pnlh='rgba(255,255,255,.95)', fill='#070707', onfill='#f4e81e', blur=8)),
     lambda: svg([f'<g fill="#f4e81e"><path d="M0 0h14v800H0z"/></g>', stripes('#f4e81e', .06, 22)[1]], defs=stripes('#f4e81e', .06, 22)[0]),
     lambda: svg([f'<g fill="#070707"><path d="M0 0h14v800H0z"/></g>', stripes('#070707', .05, 22)[1]], defs=stripes('#070707', .05, 22)[0]),
     brand='LUDRIX', sub='APEX SERIES\\A LX/04 · RACE LAUNCHER', year='LX/04', stamp='LAP 13 · P1\\00a0\\00a0///', swatch=(['#070707', '#f4e81e'], ['#e8e8e8', '#070707']))

# 14 EMULATE AZUL — azul-aço, cartões claros, limpo
face('emulate-azul', 'Emulate Azul', 'Azul-aço com cartões claros e tipografia limpa, inspirado nos frontends de emulação; claro em azul-névoa.', '#7d99b4', 'panel', typ(TECH, title_w=700, title_tt='none', title_ls='-.01em', h_tt='none', h_ls='0', h_w=700, ltt='none', lsk=.4),
     dict(bg='#141a21', pal=dark_pal('#141a21', '#8fa6bd', ink='#d6e2ee', ink2='#8fa6bd', ink3='#5e7590', pnl='rgba(30,42,54,.72)', pnlh='rgba(30,42,54,.94)', fill='#d6e2ee', onfill='#141a21', line='rgba(143,166,189,.3)', hair='rgba(214,226,238,.1)', br='rgba(143,166,189,.7)', wall_css=wall('linear-gradient(180deg,#2e3f52,#141a21)'))),
     dict(bg='#d6e2ee', pal=light_pal('#d6e2ee', '#2e3f52', ink='#141a21', ink2='#2e3f52', ink3='#5e7590', fill='#2e3f52', onfill='#fff', wall_css=wall('linear-gradient(180deg,#e9f0f7,#c7d6e5)'))),
     lambda: svg([grid('#8fa6bd', .08, 48)[1]], defs=grid('#8fa6bd', .08, 48)[0]),
     lambda: svg([grid('#2e3f52', .07, 48)[1]], defs=grid('#2e3f52', .07, 48)[0]),
     brand='Ludrix', sub='EMULATE · BLUE', year='14', stamp='EMU/14', swatch=(['#141a21', '#8fa6bd'], ['#d6e2ee', '#2e3f52']))

# 15 RÁDIO MILITAR — bege-oliva, laranja, telinha verde
face('radio-militar', 'Rádio Militar', 'Rádio de campanha: bege-oliva fosco, telinha de fósforo verde, botões laranja e rótulos gravados.', '#ff6a3a', 'panel', typ(PIXEL, title_w=700),
     dict(bg='#3a3830', pal=dark_pal('#3a3830', '#ff6a3a', ink='#e8e2d4', ink2='#bfb8a6', ink3='#8e8777', pnl='rgba(74,70,60,.7)', pnlh='rgba(74,70,60,.94)', fill='#ff6a3a', onfill='#1a1008', line='rgba(232,226,212,.2)', hair='rgba(232,226,212,.1)', br='rgba(232,226,212,.55)', wall_css=wall('linear-gradient(180deg,#5a564c,#2e2c26)'))),
     dict(bg='#d9d2c0', pal=light_pal('#d9d2c0', '#d8501f', ink='#2e2c26', ink2='#4a463c', ink3='#8e8777', pnl='rgba(240,236,226,.7)', pnlh='rgba(240,236,226,.94)', fill='#d8501f', onfill='#fff', wall_css=wall('linear-gradient(180deg,#e8e2d4,#c9c2b0)'))),
     lambda: svg([dots('#e8e2d4', .14, 14, 1)[1], f'<rect x="1120" y="640" width="120" height="120" rx="60" fill="none" stroke="#e8e2d4" stroke-width="3" opacity=".25"/><rect x="1180" y="40" width="70" height="7" fill="#3ddc84" opacity=".7"/>'], defs=dots('#e8e2d4', .14, 14, 1)[0]),
     lambda: svg([dots('#2e2c26', .12, 14, 1)[1], f'<rect x="1120" y="640" width="120" height="120" rx="60" fill="none" stroke="#2e2c26" stroke-width="3" opacity=".25"/>'], defs=dots('#2e2c26', .12, 14, 1)[0]),
     brand='LUDRIX', sub='FIELD RADIO LAUNCHER\\A PRC-15 · OLIVE', year='CH 15', stamp='SQL · VOL · 146.520\\00a0\\00a0◉', swatch=(['#3a3830', '#ff6a3a'], ['#d9d2c0', '#d8501f']))

# 16 EMULATE AMARELO — amarelo gema, cinza, azul-céu
face('emulate-amarelo', 'Emulate Amarelo', 'Amarelo-gema com moldura grafite e toques de azul-céu; cartões claros e numeração grande; escuro em grafite com o mesmo amarelo.', '#f7d117', 'panel', typ(TECH, title_w=800, title_tt='none', title_ls='-.02em', h_tt='none', h_ls='0', h_w=800, ltt='none', lsk=.3),
     dict(bg='#1d1d1b', pal=dark_pal('#1d1d1b', '#f7d117', ink='#f2f2ee', ink2='#c2c2be', ink3='#8a8a86', pnl='rgba(40,40,38,.72)', pnlh='rgba(40,40,38,.94)', fill='#f7d117', onfill='#1d1d1b', line='rgba(247,209,23,.35)', hair='rgba(242,242,238,.1)', br='rgba(247,209,23,.8)', wall_css=wall('linear-gradient(180deg,#f7d117 0,#f7d117 8px,#1d1d1b 8px)'))),
     dict(bg='#f7d117', pal=light_pal('#f7d117', '#1d1d1b', ink='#1d1d1b', ink2='#3a3a38', ink3='#6a6a66', pnl='rgba(255,255,255,.62)', pnlh='rgba(255,255,255,.94)', fill='#1d1d1b', onfill='#f7d117', line='rgba(29,29,27,.3)', hair='rgba(29,29,27,.12)', br='#1d1d1b', wall_css=wall('linear-gradient(180deg,#ffdc2e,#f0c800)'))),
     lambda: svg([f'<text x="1180" y="770" font-family="Inter,sans-serif" font-weight="800" font-size="120" fill="#f7d117" opacity=".18" text-anchor="end">16</text>']),
     lambda: svg([f'<text x="1180" y="770" font-family="Inter,sans-serif" font-weight="800" font-size="120" fill="#1d1d1b" opacity=".12" text-anchor="end">16</text>']),
     brand='Ludrix', sub='EMULATE · YELLOW', year='16', stamp='EMU/16', swatch=(['#1d1d1b', '#f7d117'], ['#f7d117', '#1d1d1b']))

# 17 PEGBOARD VIDRO — painel perfurado + vidro fosco, azul
face('pegboard-vidro', 'Pegboard Vidro', 'Painel perfurado com vidro fosco por cima, cantos arredondados e azul nos destaques; creme no claro, grafite no escuro.', '#4f8cff', 'panel', typ(SOFT, font_mono=RUBIK, lsk=0),
     dict(bg='#2b2d31', pal=dark_pal('#2b2d31', '#4f8cff', ink='#f1f1f3', ink2='#c4c6cc', ink3='#8a8d94', pnl='rgba(255,255,255,.07)', pnlh='rgba(43,45,49,.9)', fill='#4f8cff', onfill='#fff', line='rgba(255,255,255,.14)', hair='rgba(255,255,255,.08)', br='rgba(255,255,255,.3)', wall_css=wall('linear-gradient(180deg,#34373c,#24262a)'), blur=22)),
     dict(bg='#efe5cf', pal=light_pal('#efe5cf', '#2f6df6', ink='#1f2024', ink2='#4a463e', ink3='#6a6358', pnl='rgba(255,255,255,.58)', pnlh='rgba(255,255,255,.92)', fill='#2f6df6', onfill='#fff', line='rgba(31,32,36,.14)', hair='rgba(31,32,36,.08)', br='rgba(31,32,36,.3)', wall_css=wall('linear-gradient(180deg,#f6efdc,#e6dcc4)'), blur=22)),
     lambda: svg([pegholes('#111214', .9, 34, 4)[1]], defs=pegholes('#111214', .9, 34, 4)[0]),
     lambda: svg([pegholes('#c9bfa6', .9, 34, 4)[1]], defs=pegholes('#c9bfa6', .9, 34, 4)[0]),
     brand='Ludrix', sub='Pegboard · vidro', year='', stamp='', swatch=(['#2b2d31', '#4f8cff'], ['#efe5cf', '#2f6df6']))

# 18 GARAN — grafite técnico com laranja, numeração P-137B
face('garan', 'Garan', 'Grafite técnico com laranja de sinalização, códigos de peça e cantos cortados; claro em cinza-cimento.', '#ff6a13', 'editorial', typ(TECH, font_disp=MONO, title_w=700, title_ls='.1em', h_w=700),
     dict(bg='#1a1c20', pal=dark_pal('#1a1c20', '#ff6a13', ink='#e6e6e3', ink2='#a7aab0', ink3='#6f737a', pnl='rgba(28,30,34,.78)', pnlh='rgba(28,30,34,.95)', fill='#ff6a13', onfill='#1a1000', line='rgba(230,230,227,.18)', hair='rgba(230,230,227,.09)', br='rgba(255,106,19,.7)')),
     dict(bg='#d8d9d6', pal=light_pal('#d8d9d6', '#e05a00', ink='#1a1c20', ink2='#3a3d44', ink3='#6f737a', fill='#e05a00', onfill='#fff')),
     lambda: svg([corners('#ff6a13', .9, 30, 14, 3), hazard('#ff6a13', '#1a1c20', .9, 1000, 788, 280, 12), f'<text x="30" y="776" font-family="Consolas,monospace" font-size="11" fill="#ff6a13" opacity=".8" letter-spacing="3">P-137B · GARAN · LUDRIX</text>']),
     lambda: svg([corners('#e05a00', .9, 30, 14, 3), hazard('#e05a00', '#d8d9d6', .9, 1000, 788, 280, 12)]),
     brand='P-137B', sub='GARAN SERIES LAUNCHER\\A PART NO. 18 · ORANGE', year='GRN-18', stamp='QC PASS · 09/26\\00a0\\00a0▣', swatch=(['#1a1c20', '#ff6a13'], ['#d8d9d6', '#e05a00']))

# 19 NEW HORIZONS — laranja-vermelho sólido, preto, tipografia gigante
face('new-horizons', 'New Horizons', 'Laranja-vermelho sólido com blocos pretos, aspas gigantes e listras de perigo; claro em laranja-claro.', '#ff4f14', 'editorial', typ(DISPLAY, title_w=900, title_ls='-.02em', h_w=900, h_ls='0'),
     dict(bg='#ff4f14', pal=dark_pal('#ff4f14', '#ff4f14', ink='#fff2ec', ink2='#ffd2c0', ink3='#f0a88e', pnl='rgba(20,8,4,.86)', pnlh='rgba(20,8,4,.96)', fill='#fff2ec', onfill='#ff4f14', line='rgba(255,242,236,.3)', hair='rgba(255,242,236,.12)', br='rgba(255,242,236,.8)', wall_css=wall('linear-gradient(180deg,#ff5a1e,#e8420a)'), blur=4)),
     dict(bg='#ffb89a', pal=light_pal('#ffb89a', '#c43400', ink='#2a1a10', ink2='#5a3020', ink3='#8a5a44', pnl='rgba(255,255,255,.6)', pnlh='rgba(255,255,255,.94)', fill='#2a1a10', onfill='#ffb89a', wall_css=wall('linear-gradient(180deg,#ffc8b0,#ffa380)'), blur=4)),
     lambda: svg([hazard('#06070a', '#ff4f14', 1, 0, 780, 1280, 20), f'<text x="1250" y="200" font-family="Outfit,Inter,sans-serif" font-weight="900" font-size="260" fill="#06070a" opacity=".25" text-anchor="end">“</text>']),
     lambda: svg([hazard('#2a1a10', '#ffb89a', 1, 0, 780, 1280, 20), f'<text x="1250" y="200" font-family="Outfit,Inter,sans-serif" font-weight="900" font-size="260" fill="#2a1a10" opacity=".18" text-anchor="end">“</text>']),
     brand='"LUDRIX"', sub='NEW HORIZONS\\A ISSUE 19 · ORANGE', year='"06"', stamp='NH/19\\00a0\\00a0■', swatch=(['#ff4f14', '#06070a'], ['#ffb89a', '#2a1a10']))

# 20 UNDERGLOW — grafite com luz azul-acinzentada por baixo dos painéis
face('underglow', 'Underglow', 'Grafite com painéis flutuantes e um brilho azul-acinzentado por baixo, cantos arredondados; claro em cinza-pérola.', '#6f7a86', 'panel', typ(ROUND, font_mono=RUBIK, lsk=0, title_tt='none'),
     dict(bg='#0f1114', pal=dark_pal('#0f1114', '#8fb0d6', ink='#e6ecf2', ink2='#aab4bf', ink3='#6f7a86', pnl='rgba(26,29,33,.82)', pnlh='rgba(26,29,33,.96)', fill='#e6ecf2', onfill='#0f1114', line='rgba(230,236,242,.12)', hair='rgba(230,236,242,.07)', br='rgba(230,236,242,.3)', wall_css=wall(rg('ellipse 60% 30%', 50, 100, 'rgba(111,122,134,.45)', 70), 'linear-gradient(180deg,#15181c,#0b0d10)'), extra='--arq-glow:0 18px 40px -18px rgba(143,176,214,.45);')),
     dict(bg='#e4e7eb', pal=light_pal('#e4e7eb', '#3f5a78', ink='#15181c', ink2='#3a424c', ink3='#6f7a86', pnl='rgba(255,255,255,.7)', pnlh='rgba(255,255,255,.95)', fill='#15181c', onfill='#fff', line='rgba(21,24,28,.1)', hair='rgba(21,24,28,.06)', br='rgba(21,24,28,.3)', wall_css=wall(rg('ellipse 60% 30%', 50, 100, 'rgba(111,122,134,.35)', 70), 'linear-gradient(180deg,#eef0f3,#d9dde3)'), extra='--arq-glow:0 18px 40px -18px rgba(63,90,120,.35);')),
     lambda: svg([]), lambda: svg([]),
     brand='Ludrix', sub='Underglow', year='', stamp='', swatch=(['#0f1114', '#8fb0d6'], ['#e4e7eb', '#3f5a78']))

# 21 RADIAN — grafite com arcos e círculos técnicos
face('radian', 'Radian', 'Grafite com arcos e escalas circulares gravadas, painéis cinza-aço e tipografia técnica; claro em cinza-pérola.', '#9aa0aa', 'editorial', typ(TECH, title_w=600, title_ls='.08em', h_w=600),
     dict(bg='#111317', pal=dark_pal('#111317', '#dfe3ea', ink='#dfe3ea', ink2='#9aa0aa', ink3='#6a7079', pnl='rgba(44,48,56,.6)', pnlh='rgba(44,48,56,.92)', fill='#dfe3ea', onfill='#111317', wall_css=wall(rg('circle 40%', 85, 30, 'rgba(122,128,138,.25)'), 'linear-gradient(180deg,#1c1f25,#0d0f12)'))),
     dict(bg='#dfe3ea', pal=light_pal('#dfe3ea', '#2c3038', ink='#111317', ink2='#3a3e46', ink3='#7a808a', fill='#2c3038', onfill='#fff', wall_css=wall(rg('circle 40%', 85, 30, 'rgba(122,128,138,.25)'), 'linear-gradient(180deg,#eef0f4,#cfd4dc)'))),
     lambda: svg([f'<g fill="none" stroke="#dfe3ea" opacity=".16" stroke-width="1">{"".join(f"<circle cx=\"1100\" cy=\"240\" r=\"{r}\"/>" for r in range(60, 520, 46))}</g>', f'<g stroke="#dfe3ea" opacity=".3" stroke-width="1">{"".join(f"<path d=\"M{1100 + 500 * math.cos(math.radians(a))} {240 + 500 * math.sin(math.radians(a))}L{1100 + 520 * math.cos(math.radians(a))} {240 + 520 * math.sin(math.radians(a))}\"/>" for a in range(0, 360, 6))}</g>']),
     lambda: svg([f'<g fill="none" stroke="#2c3038" opacity=".14" stroke-width="1">{"".join(f"<circle cx=\"1100\" cy=\"240\" r=\"{r}\"/>" for r in range(60, 520, 46))}</g>']),
     brand='LUDRIX', sub='RADIAN INSTRUMENT\\A SERIES 21 · GRAPHITE', year='RAD/21', stamp='θ 0.00 · 360°\\00a0\\00a0◯', swatch=(['#111317', '#dfe3ea'], ['#dfe3ea', '#2c3038']))

# 22 ONDAS — preto com ondas finas, laranja-coral e verde
face('ondas', 'Ondas', 'Preto profundo com ondas finas desenhadas, coral nos botões e verde nos estados; claro em cinza-névoa.', '#ff5a2a', 'editorial', typ(EDITORIAL, title_w=400, title_tt='none', title_ls='-.01em', h_w=500, h_tt='none', h_ls='0'),
     dict(bg='#050607', pal=dark_pal('#050607', '#ff5a2a', ink='#e8eaee', ink2='#c7ccd4', ink3='#8a919c', pnl='rgba(12,13,15,.7)', pnlh='rgba(12,13,15,.94)', fill='#ff5a2a', onfill='#1a0a04', line='rgba(232,234,238,.16)', hair='rgba(232,234,238,.08)', br='rgba(255,90,42,.7)')),
     dict(bg='#e8eaee', pal=light_pal('#e8eaee', '#e0431a', ink='#121418', ink2='#3a3f47', ink3='#6a717c', fill='#e0431a', onfill='#fff')),
     lambda: svg([waves('#8a919c', .22, 20, 30)]), lambda: svg([waves('#3a3f47', .16, 20, 30)]),
     brand='Ludrix', sub='ONDAS · 22', year='22', stamp='~ ~ ~', swatch=(['#050607', '#ff5a2a'], ['#e8eaee', '#e0431a']))

# 23 CORRENTE — preto, correntes/elos, verde-limão neon
face('corrente', 'Corrente', 'Preto com elos de corrente nas bordas, verde-limão neon e rótulos mono; claro em cinza-aço.', '#39ff5a', 'editorial', typ(TECH, font_disp=MONO, title_w=700, h_w=700),
     dict(bg='#070808', pal=dark_pal('#070808', '#39ff5a', ink='#e9ebee', ink2='#c7ccd4', ink3='#8a9099', pnl='rgba(14,15,16,.72)', pnlh='rgba(14,15,16,.94)', fill='#39ff5a', onfill='#04140a', line='rgba(57,255,90,.3)', hair='rgba(233,235,238,.09)', br='rgba(57,255,90,.7)')),
     dict(bg='#dfe3e6', pal=light_pal('#dfe3e6', '#0f8a2a', ink='#0b0d0e', ink2='#3a3f45', ink3='#6a7179', fill='#0f8a2a', onfill='#fff')),
     lambda: svg([chain('#9aa0aa', .5), chain('#9aa0aa', .5).replace('x="1140"', 'x="30"'), corners('#39ff5a', .7, 36, 12, 2)]),
     lambda: svg([chain('#3a3f45', .4), chain('#3a3f45', .4).replace('x="1140"', 'x="30"'), corners('#0f8a2a', .7, 36, 12, 2)]),
     brand='LUDRIX', sub='CHAIN LINK LAUNCHER\\A LINK 23 · LIME', year='LNK/23', stamp='Ø 12 MM · GRADE 80\\00a0\\00a0⛓', swatch=(['#070808', '#39ff5a'], ['#dfe3e6', '#0f8a2a']))

# 24 NEON MENTA — grafite esverdeado com linha neon menta
face('neon-menta', 'Neon Menta', 'Grafite esverdeado com uma linha neon menta que atravessa a tela e brilha nos destaques; claro em menta-gelo.', '#17ffb0', 'panel', typ(DISPLAY, title_w=700, title_tt='none', title_ls='-.01em', h_w=700, h_tt='none', h_ls='0', lsk=.6),
     dict(bg='#0c0e10', pal=dark_pal('#0c0e10', '#17ffb0', ink='#e6f2ee', ink2='#b7c4c0', ink3='#6f7a78', pnl='rgba(31,35,38,.72)', pnlh='rgba(31,35,38,.94)', fill='#17ffb0', onfill='#04140e', line='rgba(23,255,176,.3)', hair='rgba(230,242,238,.09)', br='rgba(23,255,176,.7)', wall_css=wall(rg('ellipse 30% 100%', 6, 50, 'rgba(23,255,176,.18)', 70), 'linear-gradient(180deg,#141a19,#0a0c0d)'), extra='--arq-glow:0 0 24px rgba(23,255,176,.45);')),
     dict(bg='#e6f2ee', pal=light_pal('#e6f2ee', '#0f8a68', ink='#0c1512', ink2='#1f5c4a', ink3='#5f7a72', fill='#0f8a68', onfill='#fff', wall_css=wall(rg('ellipse 30% 100%', 6, 50, 'rgba(23,255,176,.35)', 70), 'linear-gradient(180deg,#f0f8f5,#d3e6df)'), extra='--arq-glow:0 0 24px rgba(15,138,104,.3);')),
     lambda: svg([glowline('#17ffb0', .9, 70)]), lambda: svg([glowline('#0f8a68', .8, 70)]),
     brand='Ludrix', sub='NEON MINT · 24', year='', stamp='MINT/24', swatch=(['#0c0e10', '#17ffb0'], ['#e6f2ee', '#0f8a68']))

# 25 AÇO ESCOVADO — aço azulado com linhas de escova e azul-claro
face('aco-escovado', 'Aço Escovado', 'Aço escovado azulado, linhas horizontais finas e azul-gelo nos destaques; claro em aço claro.', '#9fd8ff', 'panel', typ(TECH, title_w=700, title_tt='uppercase', title_ls='.06em', h_w=700),
     dict(bg='#0d1014', pal=dark_pal('#0d1014', '#9fd8ff', ink='#e8edf3', ink2='#c9d4e0', ink3='#8a97a6', pnl='rgba(34,48,64,.6)', pnlh='rgba(34,48,64,.92)', fill='#9fd8ff', onfill='#0a1620', line='rgba(159,216,255,.3)', hair='rgba(232,237,243,.1)', br='rgba(159,216,255,.7)', wall_css=wall('linear-gradient(180deg,#223040,#0d1014)'))),
     dict(bg='#c9d4e0', pal=light_pal('#c9d4e0', '#1f6fa8', ink='#0d1014', ink2='#223040', ink3='#5e6e80', fill='#1f6fa8', onfill='#fff', wall_css=wall('linear-gradient(180deg,#e8edf3,#b8c6d6)'))),
     lambda: svg([hairlines('#e8edf3', .12, 9, 3)[1]], defs=hairlines('#e8edf3', .12, 9, 3)[0]),
     lambda: svg([hairlines('#0d1014', .1, 9, 3)[1]], defs=hairlines('#0d1014', .1, 9, 3)[0]),
     brand='LUDRIX', sub='BRUSHED STEEL\\A SERIES 25 · ICE BLUE', year='ST-25', stamp='AISI 304 · 2B\\00a0\\00a0▭', swatch=(['#0d1014', '#9fd8ff'], ['#c9d4e0', '#1f6fa8']))

# 26 NKH AREIA — areia/cinza quente, blocos, mono
face('nkh-areia', 'NKH Areia', 'Areia e cinza quente em blocos retos, cantos vivos e rótulos monoespaçados; escuro em carvão.', '#a89a8f', 'editorial', typ(TECH, font_disp=MONO, title_w=700, title_ls='.06em', h_w=700),
     dict(bg='#1a1917', pal=dark_pal('#1a1917', '#a89a8f', ink='#e6e1db', ink2='#bdb5ab', ink3='#8a847b', pnl='rgba(34,33,31,.78)', pnlh='rgba(34,33,31,.96)', fill='#a89a8f', onfill='#1a1917', line='rgba(230,225,219,.18)', hair='rgba(230,225,219,.09)', br='rgba(168,154,143,.7)')),
     dict(bg='#d9d0c4', pal=light_pal('#d9d0c4', '#6a5f55', ink='#1a1917', ink2='#3a3936', ink3='#6f6960', fill='#1a1917', onfill='#e6e1db')),
     lambda: svg([f'<g fill="#a89a8f" opacity=".16"><rect x="1120" y="40" width="120" height="120"/><rect x="1180" y="200" width="60" height="60"/><rect x="40" y="700" width="200" height="60"/></g>', grid('#e6e1db', .05, 60)[1]], defs=grid('#e6e1db', .05, 60)[0]),
     lambda: svg([f'<g fill="#6a5f55" opacity=".16"><rect x="1120" y="40" width="120" height="120"/><rect x="1180" y="200" width="60" height="60"/><rect x="40" y="700" width="200" height="60"/></g>', grid('#1a1917', .05, 60)[1]], defs=grid('#1a1917', .05, 60)[0]),
     brand='LUDRIX', sub='NKH SAND SERIES\\A BLOCK 26', year='NKH-26', stamp='SAND · 2026\\00a0\\00a0▪', swatch=(['#1a1917', '#a89a8f'], ['#d9d0c4', '#6a5f55']))

# 27 DUNA — dunas suaves, areia e azul-petróleo, tipografia leve
face('duna', 'Duna', 'Dunas suaves em areia e azul-petróleo, cantos redondos e tipografia leve; escuro em noite-petróleo.', '#8fb2b0', 'panel', typ(SOFT, font_disp=INTER, title_w=300, title_tt='none', h_w=500, lsk=0),
     dict(bg='#1c2630', pal=dark_pal('#1c2630', '#8fb2b0', ink='#efe6d2', ink2='#c8c0ae', ink3='#8a9290', pnl='rgba(28,38,48,.6)', pnlh='rgba(28,38,48,.92)', fill='#efe6d2', onfill='#1c2630', line='rgba(239,230,210,.16)', hair='rgba(239,230,210,.08)', br='rgba(239,230,210,.4)', wall_css=wall('linear-gradient(180deg,#2a3844,#141c24)'))),
     dict(bg='#efe6d2', pal=light_pal('#efe6d2', '#3f6a68', ink='#1c2630', ink2='#4a5450', ink3='#7a8480', pnl='rgba(255,255,255,.55)', pnlh='rgba(255,255,255,.92)', fill='#1c2630', onfill='#efe6d2', wall_css=wall('linear-gradient(180deg,#f6efe0,#e4dcc6)'))),
     lambda: svg([dunes(['#4a5450', '#8fb2b0'], .35)]), lambda: svg([dunes(['#b9c3c3', '#8fb2b0'], .45)]),
     brand='Ludrix', sub='Duna · 27', year='', stamp='', swatch=(['#1c2630', '#8fb2b0'], ['#efe6d2', '#3f6a68']))

# 28 HALFTONE COBRE — verde-petróleo escuro com retícula e cobre
face('halftone-cobre', 'Halftone Cobre', 'Verde-petróleo escuro com retícula de meio-tom e cobre quente nos destaques; claro em papel-creme.', '#d9834a', 'editorial', typ(TECH, title_w=800, title_tt='uppercase', title_ls='.02em', h_w=800),
     dict(bg='#13201f', pal=dark_pal('#13201f', '#d9834a', ink='#efe6da', ink2='#c9d2ce', ink3='#9aa7a2', pnl='rgba(16,28,27,.7)', pnlh='rgba(16,28,27,.94)', fill='#d9834a', onfill='#1a0e06', line='rgba(217,131,74,.3)', hair='rgba(239,230,218,.09)', br='rgba(217,131,74,.7)')),
     dict(bg='#efe6da', pal=light_pal('#efe6da', '#b0602a', ink='#13201f', ink2='#2f4442', ink3='#6f7b77', fill='#13201f', onfill='#efe6da')),
     lambda: svg([halftone('#d9834a', .5, 12)]), lambda: svg([halftone('#b0602a', .35, 12)]),
     brand='LUDRIX', sub='HALFTONE PRESS\\A COPPER 28', year='HT-28', stamp='150 LPI · 45°\\00a0\\00a0●', swatch=(['#13201f', '#d9834a'], ['#efe6da', '#b0602a']))

# 30 TOYOTAS — laranja sólido + grafite, katakana
face('toyotas', 'Toyotas', 'Laranja sólido com placa grafite, botão giratório e katakana ビブリオテカ; claro em laranja-claro com grafite.', '#f26a1b', 'panel', typ(DISPLAY, title_w=900, title_ls='.02em', h_w=800, h_ls='2px'),
     dict(bg='#1b1b1e', pal=dark_pal('#1b1b1e', '#f26a1b', ink='#ececec', ink2='#c7c7cc', ink3='#8a8a90', pnl='rgba(30,30,34,.84)', pnlh='rgba(30,30,34,.96)', fill='#f26a1b', onfill='#1b1b1e', line='rgba(242,106,27,.4)', hair='rgba(236,236,236,.1)', br='rgba(242,106,27,.8)', wall_css=wall('linear-gradient(90deg,#f26a1b 0,#f26a1b 228px,#1b1b1e 228px)'), blur=6)),
     dict(bg='#f26a1b', pal=light_pal('#f26a1b', '#1b1b1e', ink='#1b1b1e', ink2='#3a2a20', ink3='#7a4a30', pnl='rgba(255,243,236,.78)', pnlh='rgba(255,243,236,.96)', fill='#1b1b1e', onfill='#f26a1b', line='rgba(27,27,30,.3)', hair='rgba(27,27,30,.12)', br='#1b1b1e', wall_css=wall('linear-gradient(90deg,#1b1b1e 0,#1b1b1e 228px,#ff7a2a 228px)'), blur=6)),
     lambda: svg([f'<text x="40" y="770" font-family="Noto Sans CJK JP,Meiryo,sans-serif" font-weight="700" font-size="34" fill="#1b1b1e" opacity=".55">ビブリオテカ</text>', f'<circle cx="114" cy="420" r="48" fill="none" stroke="#1b1b1e" stroke-width="8" opacity=".5"/>']),
     lambda: svg([f'<text x="40" y="770" font-family="Noto Sans CJK JP,Meiryo,sans-serif" font-weight="700" font-size="34" fill="#f26a1b" opacity=".7">ビブリオテカ</text>', f'<circle cx="114" cy="420" r="48" fill="none" stroke="#f26a1b" stroke-width="8" opacity=".6"/>']),
     brand='LUDRIX', sub='TOYOTAS SERIES · GAME DECK\\A ビブリオテカ', year='TY-30', stamp='ゲーム · 30\\00a0\\00a0◎', swatch=(['#1b1b1e', '#f26a1b'], ['#f26a1b', '#1b1b1e']))

# 31 HEX ÂMBAR — grafite com hexágonos, espinha de peixe e âmbar
face('hex-ambar', 'Hex Âmbar', 'Grafite com hexágonos e espinha-de-peixe, painéis octogonais rebitados e frestas de luz âmbar; claro em cinza-quente.', '#ffb347', 'panel', typ(TECH, title_w=800, title_tt='uppercase', title_ls='.04em', h_w=800),
     dict(bg='#0c0e11', pal=dark_pal('#0c0e11', '#ffb347', ink='#dde1e7', ink2='#aab1bb', ink3='#6b7280', pnl='rgba(29,33,39,.78)', pnlh='rgba(29,33,39,.96)', fill='#ffb347', onfill='#1a1000', line='rgba(255,179,71,.3)', hair='rgba(221,225,231,.09)', br='rgba(255,179,71,.7)', wall_css=wall(rg('ellipse 40% 10%', 50, 0, 'rgba(255,179,71,.3)', 70), 'linear-gradient(180deg,#1a1d22,#0c0e11)'))),
     dict(bg='#dde1e7', pal=light_pal('#dde1e7', '#c77a10', ink='#0c0e11', ink2='#30353d', ink3='#6b7280', fill='#c77a10', onfill='#fff', wall_css=wall(rg('ellipse 40% 10%', 50, 0, 'rgba(255,179,71,.45)', 70), 'linear-gradient(180deg,#eef0f3,#cfd4dc)'))),
     lambda: svg([hexgrid('#6b7280', .18, 22)[1], herringbone('#ffb347', .08, 20)[1].replace('id="hb"', 'id="hb"'), f'<rect x="0" y="0" width="1280" height="3" fill="#ffb347" opacity=".9"/>'], defs=hexgrid('#6b7280', .18, 22)[0] + herringbone('#ffb347', .08, 20)[0]),
     lambda: svg([hexgrid('#30353d', .14, 22)[1], f'<rect x="0" y="0" width="1280" height="3" fill="#c77a10" opacity=".9"/>'], defs=hexgrid('#30353d', .14, 22)[0]),
     brand='LUDRIX', sub='HEX AMBER\\A CELL 31 · RIVETED', year='HX-31', stamp='AMBER · 2026\\00a0\\00a0⬢', swatch=(['#0c0e11', '#ffb347'], ['#dde1e7', '#c77a10']))

# ------------------------------------------------------------------ layout rules
LAYOUTS = {
    'editorial': '',
    'panel': '''& header.top{grid-column:2;grid-template-columns:minmax(0,1fr) auto auto auto;padding-left:var(--gap)!important}
  & .rail{grid-row:2/4;margin-top:0}
  & header.top .wctl,&.frameless header.top .wctl{grid-column:1/5}
  & footer.status{grid-column:2}
  & header.top .brandbtn{display:none!important}
  & header.top .crumb{grid-column:1;justify-content:flex-start;font:var(--arq-crumb-w,$H_W$) 22px/1 var(--font-disp);letter-spacing:$H_LS$;text-transform:$H_TT$;height:40px}
  & header.top .crumb small{font:400 9.5px var(--arq-mono);letter-spacing:calc(1.5px * var(--arq-lsk));text-transform:var(--arq-ltt);margin-left:6px;align-self:flex-end;padding-bottom:4px}
  & header.top .search{grid-column:3}
  & header.top .wctl,&.frameless header.top .wctl{grid-column:4}
  & header.top::before{content:"$YEAR$";grid-row:3;grid-column:1}
  & header.top .chips{grid-column:2/4}
  & header.top::after{grid-column:4}
  & .rail .brandrow{display:flex;align-items:center;gap:10px;height:40px;margin:4px 0 12px;padding:0 6px;width:auto;justify-content:flex-start}
  & .rail .brand{width:30px;height:30px;flex:none;filter:none;display:block}
  & .rail .brand svg,& .rail .brand img{width:30px;height:30px;display:block}
  & .rail .bname{display:block!important;font:$BRAND_W$ 15px/1 var(--font-disp);letter-spacing:$BRAND_LS$;color:var(--arq-ink);opacity:1;white-space:nowrap}
  & .rail .bname::after{content:" $BRAND_TAG$";font:400 8px var(--arq-mono);letter-spacing:calc(1.5px * var(--arq-lsk));color:var(--arq-ink3);text-transform:var(--arq-ltt)}''',
}

SQUARE = '& #app *:not(svg):not(path):not(circle),& .modal *:not(svg),& .ctx *,& .pal *,& .toast *{border-radius:0}'

def esc_css(s):
    return s.replace('"', '\\"')

# ---------------------------------------------------------- esqueletos (front-ends)
# rail = lateral à esquerda (Arquivo) · topbar = barra de navegação no topo · dock = dock embaixo
# split = coluna alta do jogo à esquerda + lateral só de ícones · rrail = lateral à direita
# list = gerenciador: busca na lateral, biblioteca em lista · icons = coluna só de ícones
SKEL = {
    'hud-preto': 'side', 'hex-ambar': 'side', 'hex-azul': 'icons', 'circuito-pb': 'side', 'sampler': 'dock', 'placa-neptune': 'panelbar', 'oliva-2044': 'band', 'topografia-lima': 'dock',
    'circuito-lilas': 'topbar', 'fatias': 'topbar', 'underglow': 'icons',
    'metal-verde': 'panelbar', 'aco-escovado': 'topbar', 'titanio-vermelho': 'panelbar',
    'apex': 'side', 'emulate-azul': 'panelbar', 'radio-militar': 'panelbar',
    'emulate-amarelo': 'panelbar', 'pegboard-vidro': 'band', 'garan': 'list', 'new-horizons': 'split',
    'radian': 'icons', 'ondas': 'topbar',
}
SKEL_LAYOUT = {'topbar': 'top', 'dock': 'bottom'}

def build(f):
    t = f['t']; slug = f['slug']
    r = t['r']; rp = t['rp']; rs = t['rs']
    tok_common = f'  --arq-r:{r}px;--arq-rp:{rp}px;--arq-rs:{rs}px;--arq-ltt:{t["ltt"]};--arq-lsk:{t["lsk"]};\n'
    css = TPL
    rep = {
        '$SLUG$': slug, '$FONT_TEXT$': t['font_text'], '$FONT_DISP$': t['font_disp'], '$FONT_MONO$': t['font_mono'],
        '$TOKENS_DARK$': tok_common + f['dark']['pal'], '$TOKENS_LIGHT$': f['light']['pal'],
        '$SQUARE_RULE$': SQUARE if r == 0 else '& .chip,& .tabs button,& .seg,& .vchip,& kbd,& .tag,& .badge,& .pill{border-radius:var(--arq-rs)}\n  & .sw:not(i),& .sw:not(i)::after{border-radius:var(--arq-rs)}',
        '$TITLE_W$': str(t['title_w']), '$TITLE_TT$': t['title_tt'], '$TITLE_LS$': t['title_ls'],
        '$H_W$': str(t['h_w']), '$H_SIZE$': t['h_size'], '$H_TT$': t['h_tt'], '$H_LS$': t['h_ls'],
        '$BRAND$': esc_css(f['brand']), '$BRAND_W$': str(t['brand_w']), '$BRAND_LS$': t['brand_ls'], '$BRAND_SUB$': f['sub'],
        '$BRAND_TAG$': '', '$YEAR$': f['year'], '$STAMP$': f['stamp'],
        '$LAYOUT_RULES$': LAYOUTS[f['layout']],
    }
    # layout rules may contain placeholders themselves
    for _ in range(2):
        for k, v in rep.items(): css = css.replace(k, v)
    if f['layout'] == 'panel' and not f['year']: css = css.replace('& header.top::before{content:"";', '& header.top::before{content:none;')
    if not f['year']: css = css.replace('content:"";grid-row:2;grid-column:1;align-self:center;font:800', 'content:none;grid-row:2;grid-column:1;align-self:center;font:800')
    if not f['stamp']: css = css.replace('& header.top::after{content:"";', '& header.top::after{content:none;')
    # painéis com brilho (underglow/neon)
    if 'arq-glow' in f['dark']['pal']:
        css += f'\nhtml body.bs.face.face[data-face={slug}] :is(.libpanel,.vpanel,.nowg,.rail){{box-shadow:var(--arq-glow)}}\n'
    d = (OUT if slug in BUILTIN else PACKS) / slug; d.mkdir(parents=True, exist_ok=True)
    # esqueleto (estrutura do front-end) + cara própria
    sk = SKEL.get(slug, 'rail')
    for label, path in (('esqueleto ' + sk, ROOT / 'tools' / 'faces' / 'skel' / f'{sk}.css'), ('v2: cara própria', ROOT / 'tools' / 'faces' / 'v2' / f'{slug}.css')):
        if path.exists():
            extra = path.read_text(encoding='utf8')
            extra = re.sub(r'^\s*@include (\S+)\s*$', lambda m: (ROOT / 'tools' / 'faces' / 'skel' / (m.group(1) + '.txt')).read_text(encoding='utf8'), extra, flags=re.M)
            for _ in range(2):
                for k, v in rep.items(): extra = extra.replace(k, v)
            css += '\n\n/* ===== ' + label + ' ===== */\nhtml body.bs.face.face[data-face=' + slug + ']{\n' + extra + '\n}\n'
    (d / 'face.css').write_text(css, encoding='utf8')
    (d / 'dark.css').write_text(dark_scheme(f['dark']['bg'], f['acc'], re.search(r'--arq-ink:(#[0-9a-f]{6})', f['dark']['pal']).group(1), f['dd']()), encoding='utf8')
    (d / 'light.css').write_text(light_scheme(f['light']['bg'], f['acc'], re.search(r'--arq-ink:(#[0-9a-f]{6})', f['light']['pal']).group(1), f['ld']()), encoding='utf8')
    return d

def pack_json(f):
    sw = f['swatch'] or ([f['dark']['bg'], f['acc']], [f['light']['bg'], f['acc']])
    return {'name': f['name'], 'description': f['desc'], 'author': 'Ludrix', 'version': VERSION, 'scheme': 'dark', 'schemes': ['dark', 'light'],
            'accent': f['acc'], 'layout': SKEL_LAYOUT.get(SKEL.get(f['slug'], 'rail'), 'rail'), 'face': f['slug'], 'category': 'Caras', 'tags': 'cara, escuro, claro',
            'swatch': {'dark': sw[0], 'light': sw[1]}, 'requires': '4.2.0'}

def write_faces_ts():
    p = ROOT / 'src/main/themes.ts'; s = p.read_text(encoding='utf8')
    a = s.index('export const FACES'); b = s.index('};', a) + 2
    lines = ['export const FACES: Record<string, { name: string; description: string; accent: string; layout: string; swatch: { dark: string[]; light: string[] } }> = {']
    for f in F:
        if f['slug'] not in BUILTIN: continue
        sw = f['swatch'] or ([f['dark']['bg'], f['acc']], [f['light']['bg'], f['acc']])
        lines.append(f"    '{f['slug']}': {{ name: {json.dumps(f['name'], ensure_ascii=False)}, description: {json.dumps(f['desc'], ensure_ascii=False)}, accent: '{f['acc']}', layout: '{SKEL_LAYOUT.get(SKEL.get(f['slug'],'rail'),'rail')}', swatch: {{ dark: {json.dumps(sw[0])}, light: {json.dumps(sw[1])} }} }},")
    lines.append("    grafite: { name: 'Grafite (Legacy)', description: 'A cara clássica do Ludrix: cinza médio no escuro, cinza claro com cartões brancos no claro. Mantida para quem prefere a interface antiga.', accent: '#6c9bd2', layout: 'side', swatch: { dark: ['#1b1d21', '#272a30'], light: ['#e7e9ee', '#ffffff'] } },")
    lines.append('};')
    s = s[:a] + '\n'.join(lines) + s[b:]
    p.write_text(s, encoding='utf8')

def write_face_list_js():
    (ROOT / 'src/renderer/faces.json').write_text(json.dumps([f['slug'] for f in F if f['slug'] in BUILTIN], ensure_ascii=False), encoding='utf8')

if __name__ == '__main__':
    only = set(sys.argv[1:])
    for f in F:
        if only and f['slug'] not in only: continue
        d = build(f)
        if f['slug'] not in BUILTIN:
            (d / 'theme.json').write_text(json.dumps(pack_json(f), ensure_ascii=False, indent=1), encoding='utf8')
        print('face' if f['slug'] in BUILTIN else 'pacote', d)
    if not only:
        write_faces_ts()
    print(len(F), 'faces:', len(BUILTIN), 'embutida(s) +', len(F) - len(BUILTIN), 'pacotes')
