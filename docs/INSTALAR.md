# Instalar e usar

## Instalar
1. Baixe `Ludrix-<versão>.zip` em [Releases](https://github.com/wolffZ-prog/Ludrix/releases/latest).
2. Extraia em qualquer pasta — `D:\Jogos\Ludrix`, um pendrive, um HD externo. Evite `Arquivos de Programas` (permissão).
3. Abra `Ludrix.exe`. Na primeira vez ele termina os ajustes internos (barra "Aguarde, últimos ajustes finais..") e mostra as boas-vindas.

Nada é gravado no registro nem fora da pasta. Pra "desinstalar", apague a pasta. Pra levar pra outro PC, copie a pasta.

## Pastas
```
Ludrix\
  Ludrix.exe  LudrixConsole.exe  updater.exe
  app\          programa
  runtime\      Python e WebView2 embutidos (não mexer)
  data\         configurações, biblioteca, capas, cache, logs, atualizações
  games\        jogos baixados pela Store (_recomp\ para recompilações)
  emulation\    emuladores e BIOS
  downloads\    arquivos em andamento
  themes\       temas importados
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
`/` busca · `Esc` fecha · `F5` recarrega a biblioteca · `"` terminal interno · botão direito em qualquer jogo abre o menu completo.

## Problemas comuns
- **"Arquivos alterados"** na abertura: o Ludrix restaura sozinho da cópia local. Se persistir, extraia o zip da mesma versão por cima (a pasta `data\` é preservada).
- **Jogo não abre**: menu do jogo → Verificar arquivos; Central → Dependências.
- **Antivírus**: executáveis feitos com PyInstaller às vezes são marcados por engano. Os pacotes são assinados; confira o hash na release.
