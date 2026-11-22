#!/usr/bin/env python3
"""Empacota temas/<slug>/ em entrega/temas/<slug>.lxtheme (um por cara) + Ludrix-Caras-<n>.lxtheme (todas juntas),
assinados com a chave do Ludrix (dist/main/crypto.js: signZip + loadSeed) quando ela existir.
Uso: python3 tools/faces/pack.py [--out DIR] [slug ...]"""
import pathlib, zipfile, subprocess, sys, json, shutil

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / 'temas'
args = sys.argv[1:]
out = pathlib.Path(args[args.index('--out') + 1]) if '--out' in args else ROOT.parent / 'entrega' / 'temas'
only = {a for a in args if not a.startswith('--') and a != (str(out) if '--out' in args else None)}
FILES = ('theme.json', 'face.css', 'dark.css', 'light.css', 'preview.png', 'preview.jpg', 'LEIA-ME.txt')

def add(z, d):
    for n in FILES:
        f = d / n
        if f.exists(): z.write(f, f'{d.name}/{n}')

out.mkdir(parents=True, exist_ok=True)
dirs = sorted(d for d in SRC.iterdir() if (d / 'theme.json').exists() and (not only or d.name in only))
made = []
for d in dirs:
    p = out / f'{d.name}.lxtheme'
    with zipfile.ZipFile(p, 'w', zipfile.ZIP_DEFLATED) as z: add(z, d)
    made.append(p)
if not only:
    p = out / f'Ludrix-Caras-{len(dirs)}.lxtheme'
    with zipfile.ZipFile(p, 'w', zipfile.ZIP_DEFLATED) as z:
        for d in dirs: add(z, d)
    made.append(p)
# assinatura
js = "const c=require(process.argv[1]);const seed=c.loadSeed();if(!seed){console.log('sem chave');process.exit(0)}for(const f of process.argv.slice(2)){const r=c.signZip(f,seed);console.log(r.ok?'assinado':'ERRO '+r.error,f)}"
crypto = ROOT / 'dist/main/crypto.js'
if crypto.exists():
    r = subprocess.run(['node', '-e', js, str(crypto), *map(str, made)], capture_output=True, text=True, env={**__import__('os').environ, 'NODE_OPTIONS': ''})
    print(r.stdout.strip() or r.stderr.strip())
else:
    print('aviso: dist/main/crypto.js não existe (rode o tsc) — pacotes sem assinatura')
print(len(made), 'pacote(s) em', out)
