param([Parameter(Mandatory)][string]$InstallerUrl, [string]$InstallerSha256 = '')
# Runs on the Windows test machine. Downloads the installer, checks it against the pinned hash, installs it quietly.
# With no pinned hash it prints the hash it saw and stops: a download is never trusted just because it arrived.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$exe = Join-Path $env:TEMP 'DockerDesktopInstaller.exe'
Invoke-WebRequest -Uri $InstallerUrl -OutFile $exe -UseBasicParsing
$seen = (Get-FileHash -Algorithm SHA256 $exe).Hash.ToLower()
"SIZE: $((Get-Item $exe).Length) bytes"
"SHA256 SEEN: $seen"
if (-not $InstallerSha256) { "UNPINNED: no hash was given, so nothing was installed. Check the hash, then pin it in the run file."; "DONE"; exit 0 }
if ($seen -ne $InstallerSha256.ToLower()) { "FAIL hash differs from the pinned one"; exit 1 }
"PINNED: hash matches"
$p = Start-Process -FilePath $exe -ArgumentList 'install', '--quiet', '--accept-license', '--backend=wsl-2' -Wait -PassThru
"INSTALLER EXIT: $($p.ExitCode)"
if ($p.ExitCode -ne 0) { "FAIL installer exit $($p.ExitCode)"; exit 1 }
"DONE"
