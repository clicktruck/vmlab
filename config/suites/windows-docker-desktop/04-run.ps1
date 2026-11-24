# Runs on the Windows test machine inside the desktop session of the account that installed Docker Desktop.
# Starts Docker Desktop, waits for its engine, and runs the hello-world image. Docker Desktop is a desktop program,
# which is why this step runs in a signed-in session and not in the background.
$ErrorActionPreference = 'Continue'
$env:WSL_UTF8 = '1'
"WHO: $([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
$docker = @(Get-ChildItem -Path "$env:LOCALAPPDATA\Programs", "$env:ProgramFiles\Docker" -Recurse -Filter docker.exe -ErrorAction SilentlyContinue | Select-Object -First 1)
$app = @(Get-ChildItem -Path "$env:LOCALAPPDATA\Programs", "$env:ProgramFiles\Docker" -Recurse -Filter 'Docker Desktop.exe' -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not $docker -or -not $app) { "FAIL Docker Desktop is not installed for this account"; exit 1 }
$docker = $docker[0].FullName
$env:PATH += ';' + (Split-Path -Parent $docker)
"STARTING: $($app[0].FullName)"
Start-Process -FilePath $app[0].FullName
$ok = $false; $t0 = Get-Date
while (((Get-Date) - $t0).TotalMinutes -lt 15) {
  & $docker info 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $ok = $true; break }
  Start-Sleep -Seconds 15
}
"ENGINE: $(if ($ok) { 'answered' } else { 'did not answer' }) after $([int]((Get-Date) - $t0).TotalSeconds)s"
"WSL VERSION: " + ((& wsl.exe --version 2>&1 | Select-Object -First 2) -join ' | ')
"WSL DISTROS: " + ((& wsl.exe -l -v 2>&1 | Where-Object { "$_".Trim() }) -join ' | ')
if (-not $ok) {
  "PROCESSES: " + ((Get-Process | Where-Object { $_.ProcessName -match 'docker|vmmem|wsl' } | ForEach-Object { $_.ProcessName } | Sort-Object -Unique) -join ', ')
  Get-ChildItem "$env:LOCALAPPDATA\Docker\log" -Recurse -Filter *.log -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 3 |
    ForEach-Object { "--- last lines of $($_.Name)"; Get-Content $_.FullName -Tail 12 -ErrorAction SilentlyContinue }
  "FAIL the Docker engine did not answer in 15 minutes"; exit 1
}
& $docker version --format 'server {{.Server.Version}} on {{.Server.Os}}/{{.Server.Arch}}'
& $docker run --rm hello-world 2>&1
if ($LASTEXITCODE -ne 0) { "FAIL docker run exit $LASTEXITCODE"; exit 1 }
"DONE"
