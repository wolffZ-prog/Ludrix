# Segurança

## Versões com suporte
Só a última versão publicada em [Releases](https://github.com/wolffZ-prog/Ludrix/releases/latest) recebe correções.

## Como relatar
Abra uma **issue privada** ("Report a vulnerability" na aba Security) ou, se não aparecer, uma issue comum sem detalhes técnicos pedindo contato. Descreva: versão do Ludrix, passos pra reproduzir, impacto. Resposta em até 7 dias.

## O que o Ludrix faz hoje
- Servidor local ouve só em `127.0.0.1`; toda chamada exige token por sessão; checa `Host`, `Origin` e `Sec-Fetch-*`; CSP na interface; corpo limitado a 32 MB.
- Atualizações (`.lxup`) e temas (`.lxtheme`) são assinados com Ed25519. A chave pública está em `app/lxsign.py`; a privada fica fora do repositório. Pacote sem assinatura válida não é aplicado. Restaurar versão anterior também exige assinatura.
- Endereço de atualização só `https`, limite de 600 MB.
- Extração de arquivos protegida contra caminhos com `..` e links simbólicos.
- Temas: `@import`, `url()` externo, `expression`, `behavior` e similares são removidos do CSS; importação limitada a 80 MB, 400 entradas, 40 MB por entrada.
- Integridade: cada arquivo do programa é conferido na abertura contra `app/integrity.json` e, nos `.pyc`, contra o registro local gerado na compilação; se algo foi alterado, o Ludrix restaura da própria cópia local.
- Sem telemetria. A única rede que o Ludrix usa é a que você pede: fontes, metadados, downloads e checagem de atualização.

## Fora do escopo
Conteúdo das fontes que o usuário adiciona (sites, listas, torrents). O Ludrix não distribui jogos e não valida o que uma fonte de terceiros entrega além do que o instalador consegue checar.
