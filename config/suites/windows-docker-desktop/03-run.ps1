# Runs on the Windows test machine. Starts Docker Desktop, waits for the engine, runs the hello-world image.
# Docker Desktop is a desktop program. Run Command has no desktop, so whether this works is one of the things the test finds out.
$ErrorActionPreference = 'Continue'
$docker = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
if (-not (Test-Path $docker)) { "FAIL docker.exe not found: the install did not complete"; exit 1 }
$env:PATH += ';C:\Program Files\Docker\Docker\resources\bin'
& $docker desktop start 2>&1 | ForEach-Object { "start: $_" }
$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  & $docker info 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $ok = $true; break }
  Start-Sleep -Seconds 15
}
if (-not $ok) { "FAIL the Docker engine did not answer in 10 minutes"; exit 1 }
& $docker version --format 'server {{.Server.Version}} on {{.Server.Os}}/{{.Server.Arch}}'
& $docker run --rm hello-world 2>&1
if ($LASTEXITCODE -ne 0) { "FAIL docker run exit $LASTEXITCODE"; exit 1 }
"DONE"
