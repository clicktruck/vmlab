# Runs on the Windows test machine as the system account, after the restart that signs `console` in at the screen.
# Asks the question again: does a stored-password task for the OTHER ordinary account (`probe`) start now?
# And a task that runs inside the signed-in account's own session, which is what a person's own program is.
$ErrorActionPreference = 'Continue'
$summary = New-Object System.Collections.Generic.List[string]
$dir = 'C:\vmlab\probe'
function Signed-In { ((@(Get-Process explorer -IncludeUserName -ErrorAction SilentlyContinue | ForEach-Object { $_.UserName }) -join ', ') + ' ').Trim() }
# A first sign-in on a new account can take minutes. Wait up to four for the desktop.
$t0 = Get-Date
do { Start-Sleep -Seconds 5; $who = Signed-In } while (-not $who -and ((Get-Date) - $t0).TotalSeconds -lt 240)
$before = "SIGNED IN AT THE SCREEN before the tests: [$who] after $([int]((Get-Date) - $t0).TotalSeconds)s (empty means nobody)"
$before; $summary.Add($before)
"SESSIONS: " + ((& quser.exe 2>&1 | Select-Object -Skip 1 | ForEach-Object { ($_ -replace '\s+', ' ').Trim() }) -join ' | ')
$st = Get-ItemProperty 'HKLM:\SYSTEM\Setup' -ErrorAction SilentlyContinue
"SETUP: OOBEInProgress=$($st.OOBEInProgress) SystemSetupInProgress=$($st.SystemSetupInProgress) ImageState=$((Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Setup\State' -ErrorAction SilentlyContinue).ImageState)"
& wevtutil.exe sl 'Microsoft-Windows-TaskScheduler/Operational' /e:true

function PayloadArgs($file) { "-NoProfile -ExecutionPolicy Bypass -File $dir\payload.ps1 -Out $file" }
function Wait-File($file, $seconds) {
  $t = Get-Date
  while (((Get-Date) - $t).TotalSeconds -lt $seconds) { if (Test-Path $file) { Start-Sleep -Milliseconds 300; return [int]((Get-Date) - $t).TotalSeconds }; Start-Sleep -Seconds 1 }
  return -1
}
function Report($label, $file, $task, $seconds) {
  $s = Wait-File $file $seconds
  if ($s -ge 0) { $line = "RAN     $label after ${s}s: $((Get-Content $file -ErrorAction SilentlyContinue | Select-Object -First 1))" }
  else { $line = "NOT RAN $label in ${seconds}s (task state: $([string](Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue).State))" }
  $line; $summary.Add($line)
  if ($s -lt 0) {
    Get-WinEvent -LogName 'Microsoft-Windows-TaskScheduler/Operational' -MaxEvents 120 -ErrorAction SilentlyContinue |
      Where-Object { $_.Message -match "\\$task\b" } | Sort-Object TimeCreated | Select-Object -Last 3 |
      ForEach-Object { $m = ($_.Message -replace '\s+', ' '); "    event $($_.Id): $($m.Substring(0, [Math]::Min(95, $m.Length)))" }
  }
  Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
}
$explicit = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -Priority 4 -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

# The first step kept `probe`'s password where only the system account can read it. It is NOT reset here: an
# administrator's reset can break the account's DPAPI keys, and then a "no" from DPAPI would mean nothing.
$pw = (Get-Content -Path 'C:\vmlab\system-only\probe.txt' -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not $pw) { "NOTE the saved password for probe was not found; B2 cannot be tried" }

# B again: a stored-password task for `probe`, who is NOT the account signed in at the screen.
if ($pw) {
  $f = "$dir\b2.txt"; $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (PayloadArgs $f)
  Register-ScheduledTask -TaskName 'pb2' -Action $act -Settings $explicit -User "$env:COMPUTERNAME\probe" -Password $pw -RunLevel Limited | Out-Null; Start-ScheduledTask -TaskName 'pb2'
  Report 'B2 task for probe, stored password, AFTER a sign-in at the screen' $f 'pb2' 75
}

# K: a task that runs in the signed-in account's own session ("only when the user is logged on"). No password stored.
& icacls.exe $dir /grant "$env:COMPUTERNAME\console:(OI)(CI)M" | Out-Null
$f = "$dir\k.txt"; $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ("-WindowStyle Hidden " + (PayloadArgs $f))
$pr = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\console" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'pk' -Action $act -Settings $explicit -Principal $pr | Out-Null; Start-ScheduledTask -TaskName 'pk'
Report 'K task in the signed-in session of console' $f 'pk' 60

# L: a stored-password task for `console` ITSELF, the account that is signed in. With B2 this tells a machine-wide
# hold (any sign-in frees every task) from a per-account one (only the signed-in account's tasks run).
$cpw = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -ErrorAction SilentlyContinue).DefaultPassword
if ($cpw) {
  $f = "$dir\l.txt"; $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (PayloadArgs $f)
  Register-ScheduledTask -TaskName 'pl' -Action $act -Settings $explicit -User "$env:COMPUTERNAME\console" -Password $cpw -RunLevel Limited | Out-Null; Start-ScheduledTask -TaskName 'pl'
  Report 'L task for console itself, stored password' $f 'pl' 75
} else { $n = 'NOT TRIED L: the sign-in password was no longer in the registry'; $n; $summary.Add($n) }

$after = "SIGNED IN AT THE SCREEN after the tests: [$(Signed-In)]"
$after; $summary.Add($after)
"=== SUMMARY"
$summary
"DONE"
