; P8-only NSIS fixture. The real Tauri updater downloads, verifies and launches it.
; Deliberately no system integration: only fixture-owned files may be changed.
Unicode true
RequestExecutionLevel user
Name "{{product_name}}"
OutFile "{{out_file}}"
InstallDir "__INSTALL_DIR__"
VIProductVersion "{{version_with_build}}"
VIAddVersionKey "ProductName" "{{product_name}}"
VIAddVersionKey "FileDescription" "CloudLink isolated P8 updater fixture"
VIAddVersionKey "FileVersion" "{{version}}"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!define FIXTURE_ROOT "__ROOT__"
!define FIXTURE_ID "__RUN_ID__"
!define FIXTURE_VERSION "{{version}}"
!define FIXTURE_TEMP "__TEMP__"
!define FIXTURE_STAGE "__STAGE__"
!define FIXTURE_RUNTIME "__RUNTIME_SOURCE__"
!define FIXTURE_GUARD "__GUARD_SOURCE__"
!define FIXTURE_POWERSHELL "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
Var UpdateMode

Function .onInit
  ; Validate inherited TEMP before NSIS extracts any plugin. A lost isolation
  ; environment is a failure, never a reason to use the system temp directory.
  ReadEnvStr $0 "TEMP"
  GetFullPathName $0 "$0"
  GetFullPathName $1 "${FIXTURE_TEMP}"
  ${If} $0 != $1
    SetErrorLevel 91
    Quit
  ${EndIf}
  GetFullPathName $0 "$INSTDIR"
  GetFullPathName $1 "__INSTALL_DIR__"
  ${If} $0 != $1
    SetErrorLevel 92
    Quit
  ${EndIf}
  StrCpy $UpdateMode "false"
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} "$0" "/UPDATE" $1
  ${IfNot} ${Errors}
    StrCpy $UpdateMode "true"
  ${EndIf}
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=installer-runtime.ps1 "${FIXTURE_RUNTIME}"
  Call CheckPrepare
FunctionEnd

Function CheckPrepare
  nsExec::ExecToStack '"${FIXTURE_POWERSHELL}" -NoLogo -NoProfile -NonInteractive -File "$PLUGINSDIR\installer-runtime.ps1" -Root "${FIXTURE_ROOT}" -RunId "${FIXTURE_ID}" -Version "${FIXTURE_VERSION}" -Operation prepare'
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "$1"
    SetErrorLevel 93
    Quit
  ${EndIf}
FunctionEnd

Page instfiles
Section Install
  SetOutPath "${FIXTURE_STAGE}"
  ClearErrors
  File /oname=cloudlink.exe "{{main_binary_path}}"
  File /oname=cloudlink-guard.exe "${FIXTURE_GUARD}"
  ${If} ${Errors}
    SetErrorLevel 94
    Quit
  ${EndIf}
  nsExec::ExecToStack '"${FIXTURE_POWERSHELL}" -NoLogo -NoProfile -NonInteractive -File "$PLUGINSDIR\installer-runtime.ps1" -Root "${FIXTURE_ROOT}" -RunId "${FIXTURE_ID}" -Version "${FIXTURE_VERSION}" -Operation commit -Restart $UpdateMode'
  Pop $0
  Pop $1
  ${If} $0 != 0
    DetailPrint "$1"
    SetErrorLevel 95
    Quit
  ${EndIf}
SectionEnd
