<#
	Sets up the optional offline dictionary for 拾级.

	The base installer stays small on purpose: ECDICT is a 207 MB download that becomes a
	320 MB SQLite file, so it is only fetched when the user ticks the box (or runs this
	script by hand afterwards).

	  fetch-ecdict.ps1 -Target "$env:LOCALAPPDATA\english-app\ecdict\english-words.db" `
	                   -Runtime "C:\Users\me\AppData\Local\Programs\拾级\runtime\node.exe" `
	                   [-SourceFile "D:\ecdict-sqlite-28.zip"] [-Force] [-Quiet]

	Exit codes: 0 installed, 4 already present, 3 checksum mismatch, 5 download failed,
	6 dictionary conversion failed, 7 missing tooling.
#>

[CmdletBinding()]
param(
	[string]$Target,
	[string]$Runtime,
	[string]$SourceFile,
	[switch]$Force,
	[switch]$KeepArchive,
	[switch]$Quiet
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Config = Get-Content -Raw -Encoding UTF8 (Join-Path $ScriptDir "ecdict.json") | ConvertFrom-Json

function Say($message) {
	if (-not $Quiet) { Write-Output $message }
}

function New-WorkDirectory($path) {
	New-Item -ItemType Directory -Force -Path $path | Out-Null
	return $path
}

function Test-SqliteDatabase($path) {
	if (-not (Test-Path -LiteralPath $path)) { return $false }
	if ((Get-Item -LiteralPath $path).Length -lt 50MB) { return $false }
	$stream = [System.IO.File]::OpenRead($path)
	try {
		$buffer = New-Object byte[] 15
		$read = $stream.Read($buffer, 0, 15)
		$header = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read)
	} finally {
		$stream.Dispose()
	}
	# A dictionary with the wrong header is a half-written file, not an installed one.
	return $header -eq "SQLite format 3"
}

if (-not $Target) {
	$Target = Join-Path $env:LOCALAPPDATA "english-app\ecdict\english-words.db"
}
$TargetDir = Split-Path -Parent $Target

if (Test-SqliteDatabase $Target) {
	if (-not $Force) {
		Say "离线词典已经安装,跳过。需要重建时加 -Force。"
		exit 4
	}
	Say "离线词典已存在,-Force 将重建。"
}

$Temp = New-WorkDirectory (Join-Path $env:TEMP ("shiji-ecdict-" + [Guid]::NewGuid().ToString("N").Substring(0, 8)))
$Archive = Join-Path $Temp $Config.name
$Extracted = Join-Path $Temp $Config.entry
$Partial = "$Target.part"

try {
	New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

	if ($SourceFile) {
		if (-not (Test-Path -LiteralPath $SourceFile)) { throw "找不到词典文件 $SourceFile" }
		Say "使用本地文件 $SourceFile"
		Copy-Item -LiteralPath $SourceFile -Destination $Archive -Force
	} else {
		Say ("正在下载离线词典,约 {0} MB…" -f $Config.downloadMb)
		$downloaded = $false
		if (Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue) {
			try {
				Start-BitsTransfer -Source $Config.url -Destination $Archive
				$downloaded = $true
			} catch {
				Say "BITS 不可用,改用普通 HTTP 下载。"
			}
		}
		if (-not $downloaded) {
			[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
			try {
				Invoke-WebRequest -Uri $Config.url -OutFile $Archive -UseBasicParsing
			} catch {
				throw "下载失败:$($_.Exception.Message)"
			}
		}
	}

	Say "正在校验 SHA-256…"
	$actual = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
	if ($actual -ne $Config.sha256) {
		Say ("校验失败:期望 {0},实际 {1}。文件已删除,不会使用。" -f $Config.sha256, $actual)
		exit 3
	}

	Say "正在解压词典…"
	$tar = Join-Path $env:SystemRoot "System32\tar.exe"
	if (Test-Path -LiteralPath $tar) {
		& $tar -xf $Archive -C $Temp $Config.entry
		if ($LASTEXITCODE -ne 0) { throw "tar.exe 解压失败" }
	} else {
		Expand-Archive -LiteralPath $Archive -DestinationPath $Temp -Force
	}
	if (-not (Test-Path -LiteralPath $Extracted)) { throw "压缩包里没有 $($Config.entry)" }

	if (-not $Runtime -or -not (Test-Path -LiteralPath $Runtime)) {
		Say "找不到随应用发布的 Node 运行时,无法建立词典索引。"
		exit 7
	}

	Say ("正在生成拾级使用的词表(约需 1-{0} 分钟)…" -f 5)
	& $Runtime (Join-Path $ScriptDir "build-dictionary.mjs") $Extracted $Partial
	if ($LASTEXITCODE -ne 0) { throw "词典转换失败,退出码 $LASTEXITCODE" }
	if (-not (Test-SqliteDatabase $Partial)) { throw "生成的词典文件不完整" }

	if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Force }
	Move-Item -LiteralPath $Partial -Destination $Target
	Say ("离线词典已安装:{0}({1:N0} MB)" -f $Target, ((Get-Item -LiteralPath $Target).Length / 1MB))
	exit 0
} catch {
	Say "字典安装失败:$($_.Exception.Message)"
	Say "拾级仍可使用在线查词,不影响其他功能。"
	if (Test-Path -LiteralPath $Partial) { Remove-Item -LiteralPath $Partial -Force }
	exit 6
} finally {
	if ($KeepArchive -and $SourceFile -eq $null) {
		Say "下载文件保留在 $Temp"
	} elseif (Test-Path -LiteralPath $Temp) {
		Remove-Item -LiteralPath $Temp -Recurse -Force
	}
}
