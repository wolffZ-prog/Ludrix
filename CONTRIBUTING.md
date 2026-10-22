# Contribuir

## Antes de abrir uma issue
- Confira se já não existe uma igual.
- Bug: diga a versão (Ajustes → Sistema), o que fez, o que esperava, o que aconteceu. Se tiver, anexe `data/logs/ludrix.log`.
- Ideia: explique o problema que ela resolve, não só a solução.

## Código
- TypeScript (processo principal) e JavaScript puro (interface). Node.js 20+, Electron 33. Sem dependências novas sem necessidade real.
- Código "puro": sem comentários nem docstrings. Nome bom vale mais que comentário.
- Nada síncrono e demorado no processo principal: leitura de disco e processos externos rodam em worker ou de forma assíncrona.
- Interface: texto direto, factual, impessoal. Sem exclamações, sem narrar mudanças, sem primeira pessoa. Ajuda explica uso.
- Nada roda em segundo plano sem o usuário ligar. Nada grava fora da pasta do Ludrix.
- Performance: sem `backdrop-filter` em elementos em massa; respeitar "Reduzir movimento".
- Antes do PR: `node tools\build.js check` precisa passar.

## Versões
Mudança grande sobe o número do meio; pequena sobe o último. O changelog de cada versão fica em `CHANGELOG.md` sob `## X.Y.Z` e vai parar dentro do `.lxup`.
