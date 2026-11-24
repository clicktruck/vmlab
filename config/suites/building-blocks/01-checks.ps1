param([string]$Greeting = '', [string]$Secret = '')
# Runs on the Windows test machine. Prints what each building block delivered, so the record can be checked.
$ErrorActionPreference = 'Continue'
"GREETING: $Greeting"
"SECRET LENGTH: $($Secret.Length)"
# On purpose: print the secret. vmlab must blank it out of the record. (A made-up value, never a real one.)
"SECRET ECHO: $Secret"
# Past the 4 KB that Run Command keeps: the first and last lines must both come back.
1..400 | ForEach-Object { 'LINE {0:000} ................................................' -f $_ }
$in = 'C:\vmlab\in\sample.txt'
if (Test-Path $in) { "INPUT FILE: $((Get-Content $in -Raw).Trim())" } else { "FAIL input file missing: $in" }
$src = 'C:\vmlab\src\example'
if (Test-Path $src) { "SOURCE FILES: $((Get-ChildItem -Recurse -File $src | Measure-Object).Count)" } else { "FAIL source missing: $src" }
New-Item -ItemType Directory -Force 'C:\vmlab\out' | Out-Null
"made on $env:COMPUTERNAME at $(Get-Date -Format o)" | Set-Content 'C:\vmlab\out\result.txt'
'still here' | Set-Content 'C:\vmlab\marker.txt'
"DONE"
