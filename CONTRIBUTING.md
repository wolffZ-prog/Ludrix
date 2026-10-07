# Contribuir

## Antes de abrir uma issue
- Confira se já não existe uma igual.
- Bug: diga a versão (Ajustes → Sistema), o que fez, o que esperava, o que aconteceu. Se tiver, anexe `data/logs/ludrix.log`.
- Ideia: explique o problema que ela resolve, não só a solução.

## Código
- Python 3.11–3.14, sem dependências novas sem necessidade real.
- Código "puro": sem comentários nem docstrings. Nome bom vale mais que comentário.
- Interface: texto direto, factual, impessoal. Sem exclamações, sem narrar mudanças ("agora o X faz Y"), sem primeira pessoa. Ajuda explica uso.
- Nada roda em segundo plano sem o usuário ligar. Nada grava fora da pasta do Ludrix.
- Performance: sem `backdrop-filter` em elementos em massa; efeitos padrão "Leve".
- Antes do PR: `python tools\build.py check` precisa passar e `node --check app\ui\app.js` também.

## Temas
Temas novos não entram no Ludrix. São feitos no Ludrix Studio e distribuídos como `.lxtheme`. Recolorir o tema padrão por CSS não conta como tema novo.

## Versões
Mudança grande sobe o número do meio; pequena sobe o último. O changelog de cada versão fica em `CHANGELOG.md` sob `## X.Y.Z` e vai parar dentro do `.lxup`.
