param([Parameter(Mandatory)][string]$InstallerUrl, [string]$InstallerSha256 = '')
# Runs on the Windows test machine inside the desktop session of an ordinary account. Downloads the installer, checks
# it against the pinned hash, and installs Docker Desktop for that account only (no administrator rights needed).
# With no pinned hash it prints the hash it saw and stops: a download is never trusted just because it arrived.
#
# --accept-license accepts Docker's Subscription Service Agreement for whoever runs this. Run it only if you may.
$ErrorActionPreference = 'Stop'
# Windows PowerShell draws a progress bar for a download, which makes a large one many times slower. Turn it off.
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
"WHO: $([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
$exe = Join-Path $env:TEMP 'DockerDesktopInstaller.exe'
Invoke-WebRequest -Uri $InstallerUrl -OutFile $exe -UseBasicParsing
$seen = (Get-FileHash -Algorithm SHA256 $exe).Hash.ToLower()
"SIZE: $((Get-Item $exe).Length) bytes"
"SHA256 SEEN: $seen"
if (-not $InstallerSha256) { "UNPINNED: no hash was given, so nothing was installed. Check the hash, then pin it in the run file."; "DONE"; exit 0 }
if ($seen -ne $InstallerSha256.ToLower()) { "FAIL hash differs from the pinned one"; exit 1 }
"PINNED: hash matches"
$p = Start-Process -FilePath $exe -ArgumentList 'install', '--user', '--quiet', '--accept-license', '--backend=wsl-2' -Wait -PassThru
"INSTALLER EXIT: $($p.ExitCode)"
if ($p.ExitCode -ne 0) { "FAIL installer exit $($p.ExitCode)"; exit 1 }
$found = @(Get-ChildItem -Path "$env:LOCALAPPDATA\Programs", "$env:ProgramFiles\Docker" -Recurse -Filter docker.exe -ErrorAction SilentlyContinue | Select-Object -First 1)
"DOCKER.EXE: " + $(if ($found) { $found[0].FullName } else { 'not found' })
if (-not $found) { "FAIL the installer said 0 but docker.exe is not there"; exit 1 }
"DONE"
