#define MyAppName "HtmlEditor"
#ifndef MyAppVersion
#define MyAppVersion "1.0.0"
#endif
#ifndef SourceDir
#define SourceDir "..\bin\Release\net10.0-windows10.0.19041.0\win-x64\publish"
#endif
#ifndef OutputDir
#define OutputDir "..\artifacts\installer"
#endif

#if !DirExists(SourceDir)
  #error "SourceDir does not exist. Run scripts\build-installer.ps1 or dotnet publish first."
#endif

#if !FileExists(SourceDir + "\HtmlEditor.exe")
  #error "HtmlEditor.exe was not found in SourceDir."
#endif

[Setup]
AppId={{0F466748-0F77-4F74-AB15-9897FD8298F1}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=HtmlEditor
AppPublisherURL=https://github.com/wwbgo/HtmlEditor
AppSupportURL=https://github.com/wwbgo/HtmlEditor/issues
AppUpdatesURL=https://github.com/wwbgo/HtmlEditor/releases/latest
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=HtmlEditor-Setup-{#MyAppVersion}-win-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
CloseApplicationsFilter=HtmlEditor.exe
UninstallDisplayIcon={app}\HtmlEditor.exe
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany=HtmlEditor
VersionInfoDescription=HtmlEditor Installer
VersionInfoProductName=HtmlEditor
VersionInfoProductVersion={#MyAppVersion}
#if FileExists(SourceDir + "\appicon.ico")
SetupIconFile={#SourceDir}\appicon.ico
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\HtmlEditor"; Filename: "{app}\HtmlEditor.exe"; WorkingDir: "{app}"
Name: "{userdesktop}\HtmlEditor"; Filename: "{app}\HtmlEditor.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\HtmlEditor.exe"; Description: "{cm:LaunchProgram,HtmlEditor}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\HtmlEditor.exe.WebView2"
