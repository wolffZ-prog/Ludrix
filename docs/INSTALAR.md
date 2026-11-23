# Instalar e usar

## Instalar (setup)
1. Baixe `LudrixHub-Setup-<versão>-x64.exe` em [Releases](https://github.com/wolffZ-prog/Ludrix/releases/latest) (Windows 10/11 de 64 bits).
2. Escolha a pasta — o padrão é `C:\Users\<você>\Ludrix`; pode apontar para `D:\Jogos\Ludrix` ou qualquer disco com espaço. Não pede administrador e não aceita `Arquivos de Programas` (os jogos ficam dentro da pasta).
3. Abra pelo atalho. Na primeira vez ele mostra as boas-vindas e pergunta a pasta dos seus jogos.

O desinstalador (Configurações › Aplicativos ou o atalho no menu Iniciar) tira o programa e pergunta se apaga também jogos, saves e ajustes.

### Onde ficam seus dados (4.4+)
No Windows, ajustes, biblioteca, capas personalizadas, cópias de saves, temas importados, backups e logs ficam em **`%APPDATA%\.ludrixdata`** (`C:\Users\<você>\AppData\Roaming\.ludrixdata`) — fora da pasta do programa, longe de problemas de permissão e de antivírus que implicam com programas gravando na própria pasta. Jogos, emuladores e downloads continuam na pasta do Ludrix. Na primeira abertura da 4.4 o conteúdo de `data\` e `themes\` é movido para lá sozinho, e sobras de versões antigas (`app.old`, `runtime.old`, motor Python…) são apagadas.

Para manter tudo dentro da pasta (pendrive, HD externo), crie um arquivo vazio `portable.txt` ao lado de `Ludrix.exe` antes de abrir: os dados ficam em `data\` como antes. Ajustes › Sistema › Backup mostra qual pasta está em uso e abre as duas.

## Portátil (zip)
1. Baixe `Ludrix-<versão>.zip`.
2. Extraia em qualquer pasta — `D:\Jogos\Ludrix`, um pendrive, um HD externo. Evite `Arquivos de Programas` (permissão).
3. Abra `Ludrix.exe`.

Nada é gravado no registro. Com `portable.txt` na pasta nada é gravado fora dela: pra "desinstalar", apague a pasta; pra levar pra outro PC, copie a pasta. Sem o `portable.txt`, o zip se comporta como o setup e usa `%APPDATA%\.ludrixdata` para os dados. Setup e portátil são o mesmo programa com a mesma pasta por dentro; as atualizações `.lxup` servem para os dois.

## Vindo do 3.0.x
No Ludrix que você já usa: **Ajustes → Checar atualizações**. Ele baixa o `ludrix-4.0.0-full.lxup`, troca `app\` e `runtime\` (o motor Python sai, o Electron entra), mantém `data\`, `games\`, `emulation\` e reabre. Biblioteca, capas, configurações, emuladores e saves continuam onde estavam. Se o 4.0.0 não abrir duas vezes seguidas, o 3.0.x volta sozinho; quando abre bem, o backup do motor antigo é apagado.

## Pastas
```
Ludrix\
  Ludrix.exe  LudrixConsole.exe
  app\          programa (código, interface, catálogos)
  runtime\      Electron (não mexer)
  data\         só com portable.txt (senão fica em %APPDATA%\.ludrixdata): configurações, biblioteca,
                capas, cópias de saves, backups, temas importados, cache, logs, atualizações
  games\        jogos baixados pela Store (_recomp\ para recompilações)
  emulation\    emuladores, ROMs apontadas e BIOS
  downloads\    arquivos em andamento
```

## Primeiro uso
- **Biblioteca → + Adicionar jogo**: `.exe`, atalho, pasta inteira ou ROM. Arrastar o arquivo pra janela também funciona.
- **Importar de outro launcher**: Playnite, Steam, Epic, GOG, Ubisoft Connect, EA app, Battle.net, Amazon Games, itch.io.
- **Store → Fontes**: cole um link ou aponte um `.json`. Sem fonte a Store fica vazia — por escolha.
- **Emuladores**: escolha o console, instale o emulador, aponte a pasta de ROMs.
- **Central**: dependências que faltam e Minecraft.

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
