# Instalar e usar

## Instalar
1. Baixe `Ludrix-<versão>.zip` em [Releases](https://github.com/wolffZ-prog/Ludrix/releases/latest).
2. Extraia em qualquer pasta — `D:\Jogos\Ludrix`, um pendrive, um HD externo. Evite `Arquivos de Programas` (permissão).
3. Abra `Ludrix.exe`. Na primeira vez ele mostra as boas-vindas e pergunta a pasta dos seus jogos.

Nada é gravado no registro nem fora da pasta. Pra "desinstalar", apague a pasta. Pra levar pra outro PC, copie a pasta.

## Vindo do 3.0.x
No Ludrix que você já usa: **Ajustes → Checar atualizações**. Ele baixa o `ludrix-4.0.0-full.lxup`, troca `app\` e `runtime\` (o motor Python sai, o Electron entra), mantém `data\`, `games\`, `emulation\` e reabre. Biblioteca, capas, configurações, emuladores e saves continuam onde estavam. Se o 4.0.0 não abrir duas vezes seguidas, o 3.0.x volta sozinho; quando abre bem, o backup do motor antigo é apagado.

## Pastas
```
Ludrix\
  Ludrix.exe  LudrixConsole.exe
  app\          programa (código, interface, catálogos)
  runtime\      Electron (não mexer)
  data\         configurações, biblioteca, capas, cache, logs, atualizações
  games\        jogos baixados pela Store (_recomp\ para recompilações)
  emulation\    emuladores, ROMs apontadas e BIOS
  downloads\    arquivos em andamento
```

## Primeiro uso
- **Biblioteca → + Adicionar jogo**: `.exe`, atalho, pasta inteira ou ROM. Arrastar o arquivo pra janela também funciona.
- **Importar de outro launcher**: Playnite, Steam, Epic, GOG, Ubisoft Connect, EA app, Battle.net, Amazon Games, itch.io.
- **Store → Fontes**: cole um link ou aponte um `.json`. Sem fonte a Store fica vazia — por escolha.
- **Emuladores**: escolha o console, instale o emulador, aponte a pasta de ROMs.
- **Central**: dependências que faltam, Modo Game, programas úteis.

## Janela e bandeja
- O X da janela pergunta: fechar, minimizar pra bandeja ou nada. Dá pra fixar em Ajustes → Geral.
- Iniciar com o Windows e começar minimizado são opcionais e vêm desligados.
- Modo Console: ícone na barra ou `LudrixConsole.exe`; abre sozinho com controle se você ligar isso.

## Atalhos
`/` busca · `Esc` fecha · `F5` recarrega a biblioteca · botão direito em qualquer jogo abre o menu completo.

## Problemas comuns
- **Jogo não abre**: menu do jogo → Verificar arquivos; Central → Dependências.
- **Pasta de jogos em HD lento**: a leitura roda fora da interface; o progresso aparece na Fila.
- **Antivírus**: os executáveis são pequenos lançadores em C e o runtime é o Electron oficial. Os pacotes de atualização são assinados.
