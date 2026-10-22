# Segurança

## Versões com suporte
Só a última versão publicada em [Releases](https://github.com/wolffZ-prog/Ludrix/releases/latest) recebe correções.

## Como relatar
Abra uma **issue privada** ("Report a vulnerability" na aba Security) ou, se não aparecer, uma issue comum sem detalhes técnicos pedindo contato. Descreva: versão do Ludrix, passos pra reproduzir, impacto. Resposta em até 7 dias.

## O que o Ludrix faz hoje
- Servidor local ouve só em `127.0.0.1`, em porta aleatória; toda chamada exige token por sessão; checa `Host`, `Origin` e `Sec-Fetch-Site`; CSP na interface; renderer em sandbox, sem acesso ao Node.
- Atualizações (`.lxup`) são assinadas com Ed25519. A chave pública está em `src/main/crypto.ts`; a privada fica fora do repositório. Pacote sem assinatura válida não é aplicado.
- Endereço de atualização só `https`, limite de 600 MB.
- Extração de arquivos protegida contra caminhos com `..` e links simbólicos; abrir arquivos e pastas limitado às pastas do Ludrix e dos jogos cadastrados.
- Torrent sem DHT, UPnP, NAT-PMP ou descoberta local.
- Sem telemetria. A única rede que o Ludrix usa é a que você pede: fontes, metadados, downloads e checagem de atualização.

## Fora do escopo
Conteúdo das fontes que o usuário adiciona (sites, listas, torrents). O Ludrix não distribui jogos e não valida o que uma fonte de terceiros entrega além do que o instalador consegue checar.
