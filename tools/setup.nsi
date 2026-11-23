; LudrixHub — instalador simples (NSIS 3).
; Gerado por: node tools/build.js setup
; Defines esperados: VERSION, ARCH (x64), SRC (pasta Ludrix/ pronta), OUT (arquivo .exe de saída), ICON.
; Sem privilégios de administrador: instala na pasta que o usuário escolher (padrão: C:\Users\<nome>\Ludrix).
; Jogos, saves, emuladores e ajustes ficam DENTRO da pasta instalada (como na versão portátil), por isso
; nunca vai para Program Files.

Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
RequestExecutionLevel user
ManifestDPIAware true

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!ifndef VERSION
  !error "defina /DVERSION=x.y.z"
!endif
!ifndef ARCH
  !define ARCH "x64"
!endif
!ifndef SRC
  !error "defina /DSRC=<pasta Ludrix pronta>"
!endif
!ifndef OUT
  !define OUT "LudrixHub-Setup-${VERSION}-${ARCH}.exe"
!endif

Name "LudrixHub ${VERSION}"
OutFile "${OUT}"
BrandingText "LudrixHub ${VERSION} (${ARCH})"
InstallDir "$PROFILE\Ludrix"
InstallDirRegKey HKCU "Software\LudrixHub" "InstallDir"
ShowInstDetails nevershow
ShowUninstDetails nevershow

!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\LudrixHub"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "LudrixHub"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "Instalador do LudrixHub"
VIAddVersionKey "LegalCopyright" "WOLFFZ"
VIAddVersionKey "CompanyName" "WOLFFZ"

!ifdef ICON
  !define MUI_ICON "${ICON}"
  !define MUI_UNICON "${ICON}"
!endif
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "LudrixHub ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Este assistente instala o LudrixHub no seu PC.$\r$\n$\r$\nJogos, saves, emuladores e ajustes ficam dentro da pasta escolhida — escolha um disco com espaço para os jogos.$\r$\n$\r$\nNão precisa de administrador."
!define MUI_DIRECTORYPAGE_TEXT_TOP "Pasta onde o Ludrix vai morar (jogos e dados ficam aqui dentro). Pode trocar o disco ou a pasta."
!define MUI_FINISHPAGE_RUN "$INSTDIR\Ludrix.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o LudrixHub agora"
!define MUI_FINISHPAGE_NOREBOOTSUPPORT
!define MUI_UNCONFIRMPAGE_TEXT_TOP "O LudrixHub será removido desta pasta. Jogos, saves e ajustes podem ser mantidos (pergunto a seguir)."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Function .onInit
!if "${ARCH}" == "x64"
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP|MB_OK "O LudrixHub precisa de Windows 10/11 de 64 bits."
    Abort
  ${EndIf}
!endif
  ; já instalado? propõe a mesma pasta
  ReadRegStr $0 HKCU "Software\LudrixHub" "InstallDir"
  ${If} $0 != ""
    StrCpy $INSTDIR $0
  ${EndIf}
FunctionEnd

Function .onVerifyInstDir
  ; não deixa instalar em Program Files (sem permissão de escrita para os jogos)
  StrCpy $0 "$INSTDIR" 17
  ${If} $0 == "$PROGRAMFILES\"
    Abort
  ${EndIf}
  StrCpy $0 "$INSTDIR" 23
  ${If} $0 == "$PROGRAMFILES32\"
    Abort
  ${EndIf}
FunctionEnd

Section "LudrixHub (obrigatório)" SecMain
  SectionIn RO
  ; fecha o Ludrix se estiver aberto (silencioso; ignora erro)
  nsExec::ExecToStack 'taskkill /F /IM Ludrix.exe /T'
  nsExec::ExecToStack 'taskkill /F /IM LudrixConsole.exe /T'
  Pop $0
  Pop $0
  SetOutPath "$INSTDIR"
  ; app/ e runtime/ são substituídos por inteiro (a versão antiga sai); games/ emulation/ etc. nunca são tocados.
  ; Desde a 4.4 os dados (ajustes, biblioteca, saves copiados, backups, temas) ficam em %APPDATA%\.ludrixdata,
  ; fora da pasta do programa — nada aqui precisa de permissão de escrita depois de instalado.
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\runtime"
  File /r "${SRC}\app"
  File /r "${SRC}\runtime"
  File "${SRC}\Ludrix.exe"
  File "${SRC}\LudrixConsole.exe"
  File "${SRC}\LEIA-ME.txt"
  CreateDirectory "$INSTDIR\games"
  CreateDirectory "$INSTDIR\emulation"
  CreateDirectory "$INSTDIR\downloads"
  WriteUninstaller "$INSTDIR\Desinstalar LudrixHub.exe"
  WriteRegStr HKCU "Software\LudrixHub" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\LudrixHub" "Version" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "LudrixHub"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "WOLFFZ"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\Ludrix.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Desinstalar LudrixHub.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "URLInfoAbout" "https://github.com/wolffZ-prog/Ludrix"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR\app" "/S=0K" $0 $1 $2
  ${GetSize} "$INSTDIR\runtime" "/S=0K" $3 $1 $2
  IntOp $0 $0 + $3
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" $0
  CreateDirectory "$SMPROGRAMS\LudrixHub"
  CreateShortcut "$SMPROGRAMS\LudrixHub\LudrixHub.lnk" "$INSTDIR\Ludrix.exe"
  CreateShortcut "$SMPROGRAMS\LudrixHub\LudrixHub (modo console).lnk" "$INSTDIR\LudrixConsole.exe"
  CreateShortcut "$SMPROGRAMS\LudrixHub\Desinstalar LudrixHub.lnk" "$INSTDIR\Desinstalar LudrixHub.exe"
SectionEnd

Section "Atalho na área de trabalho" SecDesktop
  CreateShortcut "$DESKTOP\LudrixHub.lnk" "$INSTDIR\Ludrix.exe"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "O launcher completo (app + runtime). Atualizações seguintes chegam pelo próprio Ludrix."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "Cria um atalho do LudrixHub na área de trabalho."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  nsExec::ExecToStack 'taskkill /F /IM Ludrix.exe /T'
  nsExec::ExecToStack 'taskkill /F /IM LudrixConsole.exe /T'
  Pop $0
  Pop $0
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\runtime"
  Delete "$INSTDIR\Ludrix.exe"
  Delete "$INSTDIR\LudrixConsole.exe"
  Delete "$INSTDIR\LEIA-ME.txt"
  Delete "$INSTDIR\Desinstalar LudrixHub.exe"
  Delete "$DESKTOP\LudrixHub.lnk"
  RMDir /r "$SMPROGRAMS\LudrixHub"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\LudrixHub"
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Apagar também jogos, saves, emuladores e ajustes?$\r$\n$\r$\n$INSTDIR\games, emulation e downloads$\r$\n$APPDATA\.ludrixdata (ajustes, biblioteca, temas, backups)$\r$\n$\r$\nResponda NÃO para manter tudo e só tirar o programa." IDNO keep
    RMDir /r "$INSTDIR\data"
    RMDir /r "$INSTDIR\games"
    RMDir /r "$INSTDIR\emulation"
    RMDir /r "$INSTDIR\downloads"
    RMDir /r "$INSTDIR\themes"
    RMDir /r "$APPDATA\.ludrixdata"
  keep:
  RMDir "$INSTDIR"
SectionEnd
