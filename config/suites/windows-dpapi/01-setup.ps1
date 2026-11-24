# Runs on the Windows test machine as the system account. Makes a folder every account may write to, so one account
# can leave the protected text there for another to try to open.
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force 'C:\vmlab\shared' | Out-Null
& icacls.exe 'C:\vmlab\shared' /grant '*S-1-1-0:(OI)(CI)M' | Out-Null
"OS: $((Get-CimInstance Win32_OperatingSystem).Caption) $([Environment]::OSVersion.Version); PowerShell $($PSVersionTable.PSVersion)"
"DONE"
