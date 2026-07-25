Unicode true

!ifndef ARG_WAILS_AMD64_BINARY
  !error "ARG_WAILS_AMD64_BINARY is required"
!endif
!ifndef INFO_PRODUCTVERSION
  !define INFO_PRODUCTVERSION "0.0.0"
!endif

!define PRODUCT_NAME "OhneGuessr"
!define PRODUCT_EXECUTABLE "OhneGuessr.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\OhneBOhneGuessr"

RequestExecutionLevel user

!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "MUI.nsh"
!include "WinVer.nsh"
!include "x64.nsh"

VIProductVersion "${INFO_PRODUCTVERSION}.0"
VIFileVersion "${INFO_PRODUCTVERSION}.0"
VIAddVersionKey "CompanyName" "OhneB"
VIAddVersionKey "FileDescription" "${PRODUCT_NAME} Installer"
VIAddVersionKey "ProductVersion" "${INFO_PRODUCTVERSION}"
VIAddVersionKey "FileVersion" "${INFO_PRODUCTVERSION}"
VIAddVersionKey "LegalCopyright" "Copyright (c) 2026 OhneB"
VIAddVersionKey "ProductName" "${PRODUCT_NAME}"

ManifestDPIAware true

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
!define MUI_FINISHPAGE_NOAUTOCLOSE
!define MUI_FINISHPAGE_RUN "$INSTDIR\${PRODUCT_EXECUTABLE}"
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Name "${PRODUCT_NAME}"
OutFile "..\..\..\bin\OhneGuessr-amd64-installer.exe"
InstallDir "$LOCALAPPDATA\Programs\${PRODUCT_NAME}"
ShowInstDetails show

Var UpdatePID

Function .onInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "${PRODUCT_NAME} requires Windows 10 or later."
    Abort
  ${EndIf}
  ${IfNot} ${IsNativeAMD64}
    MessageBox MB_ICONSTOP "This installer requires 64-bit Windows."
    Abort
  ${EndIf}

  ${GetParameters} $R0
  ${GetOptions} $R0 "/UPDATEPID=" $UpdatePID
  StrCmp $UpdatePID "" done
  System::Call 'kernel32::OpenProcess(i 0x00100000, i 0, i $UpdatePID) i .r1'
  IntCmp $1 0 done
  System::Call 'kernel32::WaitForSingleObject(i r1, i 30000) i .r2'
  System::Call 'kernel32::CloseHandle(i r1)'
  IntCmp $2 0 done
  MessageBox MB_ICONSTOP "${PRODUCT_NAME} did not close in time. Please run the update again."
  Abort
done:
FunctionEnd

Section "${PRODUCT_NAME} (required)" SEC_APP
  SectionIn RO
  SetShellVarContext current

  SetRegView 64
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 == ""
    ReadRegStr $0 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
    ${If} $0 == ""
      InitPluginsDir
      SetOutPath "$PLUGINSDIR\webview2"
      File "MicrosoftEdgeWebview2Setup.exe"
      ExecWait '"$PLUGINSDIR\webview2\MicrosoftEdgeWebview2Setup.exe" /silent /install'
    ${EndIf}
  ${EndIf}

  SetOutPath $INSTDIR
  File "/oname=${PRODUCT_EXECUTABLE}" "${ARG_WAILS_AMD64_BINARY}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "OhneB"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${INFO_PRODUCTVERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${PRODUCT_EXECUTABLE}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" $0

  StrCmp $UpdatePID "" done
  Exec '"$INSTDIR\${PRODUCT_EXECUTABLE}"'
done:
SectionEnd

Section /o "Desktop shortcut" SEC_DESKTOP
  SetShellVarContext current
  CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
SectionEnd

Section "uninstall"
  SetShellVarContext current
  Delete "$SMPROGRAMS\${PRODUCT_NAME}.lnk"
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  RMDir /r $INSTDIR
SectionEnd
