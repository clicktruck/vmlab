param([Parameter(Mandatory)][string]$WslMsiUrl, [Parameter(Mandatory)][string]$WslMsiSha256)
# Runs on the Windows test machine as the system account, after the restart that turns the Windows features on.
# Docker Desktop's WSL 2 backend needs the real WSL, and a fresh Windows has only a stub that asks to be updated.
# `wsl --update` does not work from the system account (run 17: "The handle is invalid", "requires elevation"), so
# install Microsoft's own WSL package from its GitHub release instead, pinned by version and hash.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$msi = Join-Path $env:TEMP 'wsl.x64.msi'
Invoke-WebRequest -Uri $WslMsiUrl -OutFile $msi -UseBasicParsing
$seen = (Get-FileHash -Algorithm SHA256 $msi).Hash.ToLower()
"WSL PACKAGE: $((Get-Item $msi).Length) bytes, SHA256 $seen"
if ($seen -ne $WslMsiSha256.ToLower()) { "FAIL the WSL package's hash differs from the pinned one"; exit 1 }
$log = Join-Path $env:TEMP 'wsl-msi.log'
$p = Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i', "`"$msi`"", '/quiet', '/norestart', '/l*v', "`"$log`"" -Wait -PassThru
"MSIEXEC EXIT: $($p.ExitCode)"
# 0 is done; 3010 is done, restart wanted (the suite restarts later anyway when it signs the test account in).
if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
  Get-Content $log -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { "  log: $_" }
  "FAIL the WSL package did not install"; exit 1
}
$exe = 'C:\Program Files\WSL\wsl.exe'
if (-not (Test-Path $exe)) { "FAIL $exe is not there after the install"; exit 1 }
"WSL INSTALLED: $exe, file version $((Get-Item $exe).VersionInfo.FileVersion)"
"DONE"
