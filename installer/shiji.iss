; 拾级 Windows 安装脚本
;
; 编译命令由 scripts/win/build.mjs 组装,它会传入版本号、发布目录、输出目录与语言文件,并使用
; 随包发布的 Inno Setup 编译器(node_modules/innosetup/bin/ISCC.exe):
;
;   ISCC.exe /DShijiVersion=0.2.0 /DShijiStaging=..\staging /DShijiOutput=..\installer-output shiji.iss
;
; 设计约束:
;   * 只服务 Windows 10/11 x64,不签名,默认装到当前用户目录,不触发 UAC。
;   * 程序目录只放可执行内容;文章、生词、设置一律写在 %LOCALAPPDATA%\english-app\data。
;   * 离线词典(约 207 MB 下载)不打进基础包,只有勾选后才联网下载,下载前再次确认。
;   * AppId 是升级码,一经发布不得更改,否则旧版本不会被识别为同一个程序。

#define MyAppName "拾级"
#define MyAppExeName "node.exe"
#define MyAppLauncher "拾级.exe"
; 随包发布的图标文件;托盘、快捷方式与卸载列表都读它。文件名保持 ASCII:
; IconFilename 走的是图标资源提取 + 资源管理器图标缓存这条路径,和已经验证过的中文文件名不是同一条。
#define MyAppIcon "{app}\resources\icons\shiji.ico"

[Setup]
AppId={{B2937F70-3E59-46A9-878D-4D85FAAA5E69}
AppName={#MyAppName}
AppVersion={#ShijiVersion}
AppVerName={#MyAppName} {#ShijiVersion}
AppComments=拾级:英语阅读伴侣
DefaultGroupName={#MyAppName}
DefaultDirName={autopf}\{#MyAppName}
DisableProgramGroupPage=yes
DisableWelcomePage=no
MinVersion=10.0.19041
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir={#ShijiOutput}
OutputBaseFilename={#MyAppName}-Setup-{#ShijiVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupIconFile={#ShijiStaging}\resources\icons\shiji.ico
VersionInfoVersion={#ShijiVersion}.0
VersionInfoProductName={#MyAppName}
UninstallDisplayIcon={app}\resources\icons\shiji.ico
UninstallDisplayName={#MyAppName}
CloseApplications=yes
RestartApplications=no
SetupMutex=ShijiSetupMutex

[Languages]
Name: "zh_CN"; MessagesFile: "{#ShijiLanguage}"

[Tasks]
Name: "desktopicon"; Description: "在桌面创建快捷方式"; GroupDescription: "附加任务:"; Flags: unchecked
Name: "tray"; Description: "运行时在任务栏右下角显示拾级图标(单击即在浏览器打开)"; GroupDescription: "附加任务:"
Name: "autostart"; Description: "登录 Windows 后在后台启动拾级(不显示窗口)"; GroupDescription: "附加任务:"; Flags: unchecked
Name: "ecdict"; Description: "下载安装离线词典 ECDICT(约 207 MB,完成后约占 320 MB)"; GroupDescription: "可选内容(只有勾选才会联网):"; Flags: unchecked

[Files]
Source: "{#ShijiStaging}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs
Source: "{#ShijiStaging}\resources\*"; DestDir: "{app}\resources"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#ShijiStaging}\tools\*"; DestDir: "{app}\tools"; Flags: ignoreversion recursesubdirs

[Dirs]
Name: "{localappdata}\english-app\data"; Permissions: users-modify

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\runtime\{#MyAppLauncher}"; Parameters: """{app}\resources\server\index.mjs"" --open"; WorkingDir: "{app}"; Comment: "启动拾级并打开浏览器"; IconFilename: "{#MyAppIcon}"
Name: "{autoprograms}\{#MyAppName}\停止 {#MyAppName}"; Filename: "{app}\runtime\{#MyAppLauncher}"; Parameters: """{app}\resources\server\index.mjs"" --stop"; WorkingDir: "{app}"; Comment: "关闭后台服务"; IconFilename: "{#MyAppIcon}"
Name: "{autoprograms}\{#MyAppName}\安装离线词典"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\tools\fetch-ecdict.ps1"" -Runtime ""{app}\runtime\{#MyAppExeName}"""; WorkingDir: "{app}\tools"; Comment: "联网下载离线词典(约 207 MB)"; IconFilename: "{#MyAppIcon}"
Name: "{autoprograms}\{#MyAppName}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\runtime\{#MyAppLauncher}"; Parameters: """{app}\resources\server\index.mjs"" --open"; WorkingDir: "{app}"; Tasks: desktopicon; IconFilename: "{#MyAppIcon}"

[Registry]
; 开机自启走 Run 键而不是"启动"文件夹快捷方式:拾级.exe 已经是 GUI 子系统,不会再闪控制台,
; 而托盘菜单要切换自启时,读写一个注册表值比造一个 .lnk 简单得多(两边写的是同一个值)。
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: {#MyAppName}; ValueData: """{app}\runtime\{#MyAppLauncher}"" ""{app}\resources\server\index.mjs"" --serve"; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\runtime\{#MyAppLauncher}"; Parameters: """{app}\resources\server\index.mjs"" --open"; Description: "立即启动 {#MyAppName}"; WorkingDir: "{app}"; Flags: postinstall nowait skipifsilent

[Code]
const
  UninstallRegKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{B2937F70-3E59-46A9-878D-4D85FAAA5E69}_is1';
  ProgramFreeMB = 700;
  DictionaryExtraMB = 1600;
  DictionaryUrl = 'https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip';

var
  DownloadDictionary: Boolean;

function DataDir(): String;
begin
  Result := ExpandConstant('{localappdata}\english-app\data');
end;

function DictionaryFile(): String;
begin
  Result := ExpandConstant('{localappdata}\english-app\ecdict\english-words.db');
end;

function LauncherPath(const InstallDir: String): String;
begin
  Result := InstallDir + '\runtime\node.exe';
end;

{ Whether a dictionary file is already there. fetch-ecdict.ps1 still checks that it is a real
  SQLite database before reusing it, and re-downloads (and then verifies) when it is not. }
function DictionaryInstalled(): Boolean;
begin
  Result := FileExists(DictionaryFile());
end;

function AskYesNo(const Question: String; const Default: Boolean): Boolean;
begin
  if WizardSilent then
    Result := Default
  else
    Result := (MsgBox(Question, mbConfirmation, MB_YESNO or MB_DEFBUTTON1) = IDYES);
end;

{ Frees the port and releases node.exe, which is locked while the local server is running. }
procedure StopShiji(const InstallDir: String);
var
  Code: Integer;
  Script: String;
begin
  Script := InstallDir + '\resources\server\index.mjs';
  if (not FileExists(LauncherPath(InstallDir))) or (not FileExists(Script)) then Exit;
  Exec(LauncherPath(InstallDir), '"' + Script + '" --stop', InstallDir, SW_HIDE, ewWaitUntilTerminated, Code);
end;

function PreviousInstallDir(): String;
begin
  if RegQueryStringValue(HKCU, UninstallRegKey, 'InstallLocation', Result) then
    if Result <> '' then Exit;
  if RegQueryStringValue(HKLM, UninstallRegKey, 'InstallLocation', Result) then
    if Result <> '' then Exit;
  Result := '';
end;

{ Free megabytes on the drive holding Path, or -1 when it cannot be measured. }
function FreeSpaceMB(const Path: String): Int64;
var
  Free: Int64;
  Total: Int64;
begin
  Result := -1;
  if GetSpaceOnDisk64(Path, Free, Total) then Result := Free div (1024 * 1024);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Needed: Int64;
  AppFree: Int64;
  DataFree: Int64;
  Previous: String;
begin
  Result := '';
  NeedsRestart := False;
  DownloadDictionary := WizardIsTaskSelected('ecdict');

  if not IsWin64 then
  begin
    Result := '拾级需要 64 位的 Windows 10 或 Windows 11。';
    Exit;
  end;

  Previous := PreviousInstallDir();
  if Previous <> '' then StopShiji(Previous);
  StopShiji(ExpandConstant('{app}'));

  Needed := ProgramFreeMB;
  if DownloadDictionary then Needed := Needed + DictionaryExtraMB;
  AppFree := FreeSpaceMB(ExpandConstant('{app}'));
  DataFree := FreeSpaceMB(ExpandConstant('{localappdata}'));
  if ((AppFree >= 0) and (AppFree < Needed)) or ((DataFree >= 0) and (DataFree < Needed)) then
  begin
    Result := '磁盘空间不足:需要约 ' + IntToStr(Needed) + ' MB,程序目录所在磁盘剩余 ' +
      IntToStr(AppFree) + ' MB,用户目录所在磁盘剩余 ' + IntToStr(DataFree) + ' MB。' + #13#10 +
      '如果只想安装主程序,请返回上一步取消勾选离线词典。';
    Exit;
  end;

  if not DownloadDictionary then Exit;

  if DictionaryInstalled() then
  begin
    if not AskYesNo('本机已经装过离线词典,可以继续使用,不需要重新下载。' + #13#10 + #13#10 +
      '「是」重新下载并覆盖(约 207 MB 流量);' + #13#10 +
      '「否」保留现有词典。', False) then
      DownloadDictionary := False;
  end;

  if DownloadDictionary then
  begin
    if not AskYesNo('离线词典需要联网下载约 207 MB,下载过程中还会临时占用约 1.2 GB 空间。' + #13#10 + #13#10 +
      '现在开始下载吗?取消不影响使用,拾级会改用在线词典查词。', False) then
      DownloadDictionary := False;
  end;
end;

procedure InstallDictionary;
var
  Code: Integer;
  PowerShell: String;
  Script: String;
begin
  Script := ExpandConstant('{app}\tools\fetch-ecdict.ps1');
  if not FileExists(Script) then
  begin
    MsgBox('缺少 tools\fetch-ecdict.ps1,无法自动下载词典。拾级仍会使用在线词典查词。', mbError, MB_OK);
    Exit;
  end;
  PowerShell := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  if not FileExists(PowerShell) then
  begin
    MsgBox('这台电脑上的 PowerShell 不可用,无法自动下载词典。' + #13#10 + #13#10 +
      '稍后可通过“开始菜单 → 拾级 → 安装离线词典”重试。', mbInformation, MB_OK);
    Exit;
  end;
  WizardForm.StatusLabel.Caption := '正在下载并建立离线词典,请勿关闭窗口…';
  if not Exec(PowerShell,
    '-NoProfile -ExecutionPolicy Bypass -File "' + Script + '" -Runtime "' +
    ExpandConstant('{app}\runtime\node.exe') + '" -Force',
    ExpandConstant('{app}\tools'), SW_HIDE, ewWaitUntilTerminated, Code) then
    Code := -1;
  if (Code <> 0) and (Code <> 4) then
    MsgBox('离线词典没有安装成功(代码 ' + IntToStr(Code) + ')。' + #13#10 + #13#10 +
      '可以稍后运行“开始菜单 → 拾级 → 安装离线词典”,或手动下载:' + #13#10 + DictionaryUrl,
      mbInformation, MB_OK);
end;

{ 托盘默认开启;取消勾选时在程序目录留一个标记,服务端启动时读到它就不拉起托盘。 }
procedure ApplyTrayChoice;
var
  Marker: String;
begin
  Marker := ExpandConstant('{app}\resources\tray.disabled');
  if WizardIsTaskSelected('tray') then
    DeleteFile(Marker)
  else
    SaveStringToFile(Marker, 'unchecked during install', False);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep <> ssPostInstall then Exit;
  ApplyTrayChoice;
  if DownloadDictionary then InstallDictionary();
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    StopShiji(ExpandConstant('{app}'))
  else if (CurUninstallStep = usPostUninstall) and (not UninstallSilent) then
  begin
    if AskYesNo('是否同时删除学习记录(文章、卡住的词、设置)?' + #13#10 + #13#10 +
      '位置:' + DataDir() + #13#10 +
      '离线词典不会被删除,以后重装可以继续使用。', False) then
    begin
      DelTree(DataDir(), True, True, True);
      DelTree(ExpandConstant('{localappdata}\english-app\logs'), True, True, True);
      DeleteFile(ExpandConstant('{localappdata}\english-app\runtime.json'));
    end;
  end;
end;
