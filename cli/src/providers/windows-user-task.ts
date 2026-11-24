// Running a script as an ordinary Windows account WITH ITS PROFILE LOADED.
//
// Azure Run Command can start a script as a named user, but it does not load that user's profile (run 8, 2026-11-24:
// DPAPI failed with "not having the user profile loaded"). Anything per-user needs one, so a `user:NAME` step goes
// through a scheduled task instead: the task is registered with the account's password, so Windows logs the account on
// as a batch job and loads its profile, the way it would for a program that account had started.
//
// Two scripts run as the system account through Run Command:
//   CREATE_USER_SCRIPT  makes the account, puts it in Users only, and lets it log on as a batch job (once).
//   buildRunAsUserScript(...) holds the step's own script, runs it as the account through a task, waits, and prints
//                       what it printed. The wrapper's exit code is the script's exit code, as with a plain step.
// The account's password and the step's inputs travel as protected parameters, never in the script text.

/** Windows PowerShell: an ordinary local account, a member of Users only, allowed to log on as a batch job. */
export const CREATE_USER_SCRIPT = `param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Pw)
$ErrorActionPreference = 'Stop'
$secure = ConvertTo-SecureString $Pw -AsPlainText -Force
New-LocalUser -Name $Name -Password $secure -PasswordNeverExpires -AccountNeverExpires | Out-Null
Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $Name
# A scheduled task that stores the password logs the account on as a batch job, which Users do not have by default.
$sid = (New-Object Security.Principal.NTAccount($env:COMPUTERNAME, $Name)).Translate([Security.Principal.SecurityIdentifier]).Value
$cfg = Join-Path $env:TEMP ('vmlab-rights-' + [guid]::NewGuid().ToString('N') + '.inf')
$db = [IO.Path]::ChangeExtension($cfg, '.sdb')
& secedit.exe /export /cfg $cfg /areas USER_RIGHTS | Out-Null
$text = @(Get-Content $cfg)
$out = foreach ($l in $text) { if ($l -match '^SeBatchLogonRight\\s*=') { "$l,*$sid" } else { $l } }
if (-not ($text -match '^SeBatchLogonRight\\s*=')) { $out = foreach ($l in $out) { $l; if ($l -eq '[Privilege Rights]') { "SeBatchLogonRight = *$sid" } } }
Set-Content -Path $cfg -Value $out -Encoding Unicode
& secedit.exe /configure /db $db /cfg $cfg /areas USER_RIGHTS | Out-Null
Remove-Item $cfg, $db -Force -ErrorAction SilentlyContinue
'made the ordinary account ' + $Name
`;

/**
 * Windows PowerShell for the system account: make Windows sign this account in at the screen by itself after the next
 * restart. A desktop program (one with windows) needs a real desktop session, and so does anything that waits for
 * "someone has signed in". The password has to sit in the registry for Windows to use it, in clear: acceptable only
 * because the account, its password and the machine are all made for one run and deleted with it.
 */
export const SIGN_IN_SCRIPT = `param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Pw)
$ErrorActionPreference = 'Stop'
$k = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon'
Set-ItemProperty -Path $k -Name AutoAdminLogon -Value '1'
Set-ItemProperty -Path $k -Name DefaultUserName -Value $Name
Set-ItemProperty -Path $k -Name DefaultDomainName -Value $env:COMPUTERNAME
Set-ItemProperty -Path $k -Name DefaultPassword -Value $Pw
# No first sign-in questions and no welcome animation: nobody is there to answer or watch.
New-Item -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\OOBE' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\OOBE' -Name DisablePrivacyExperience -Value 1 -Type DWord
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name EnableFirstLogonAnimation -Value 0 -Type DWord
'set to sign in ' + $Name + ' at the screen after the next restart'
`;

/** A file name that is safe to write on the machine and to put in a command line. */
export const safeName = (name: string): string => name.replace(/[^A-Za-z0-9_.-]/g, '_');

/** The step's inputs as JSON, for the wrapper to hand to the script by name. All values are strings. */
export function inputsJson(
  parameters: Record<string, string>,
  protectedParameters: Record<string, string>,
): string {
  return JSON.stringify({ ...parameters, ...protectedParameters });
}

/**
 * Windows PowerShell for the system account: write the step's script and a small runner into a folder only the
 * account (and the system) can use, register a task for the account, run it, wait, print what it printed, clean up.
 * `scriptName` and `scriptText` are the step's own; the text is embedded as base64 so no quoting can break it.
 */
export function buildRunAsUserScript(
  scriptName: string,
  scriptText: string,
  mode: 'background' | 'session' = 'background',
): string {
  const b64 = Buffer.from(scriptText, 'utf8').toString('base64');
  const name = safeName(scriptName);
  // background: Windows logs the account on as a batch job (a stored password), with its profile loaded.
  // session:    the task runs inside the desktop session of the account that is signed in at the screen.
  const register =
    mode === 'session'
      ? `$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $task -Action $action -Settings $settings -Principal $principal | Out-Null`
      : 'Register-ScheduledTask -TaskName $task -Action $action -Settings $settings -User $account -Password $Pw -RunLevel Limited | Out-Null';
  const waitForDesktop =
    mode === 'session'
      ? `# The account signs in by itself after a restart, which can take a minute or more. Wait for its desktop.
$t0 = Get-Date
do {
  $there = @(Get-Process explorer -IncludeUserName -ErrorAction SilentlyContinue | Where-Object { $_.UserName -eq $account }).Count -gt 0
  if (-not $there) { Start-Sleep -Seconds 5 }
} while ((-not $there) -and ((Get-Date) - $t0).TotalSeconds -lt 300)
if (-not $there) { "FAIL $Name is not signed in at the screen after 300 seconds, so the step was not started"; exit 126 }
`
      : '';
  return `param([Parameter(Mandatory)][string]$Name, [string]$Pw = '', [string]$ArgsJson = '{}', [int]$TimeoutSeconds = 600)
$ErrorActionPreference = 'Stop'
$ScriptB64 = '${b64}'
$ScriptName = '${name}'
$id = [guid]::NewGuid().ToString('N').Substring(0, 8)
$dir = "C:\\vmlab\\tasks\\$id"
New-Item -ItemType Directory -Force $dir | Out-Null
$account = "$env:COMPUTERNAME\\$Name"
${waitForDesktop}& icacls.exe $dir /inheritance:r /grant '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "\${account}:(OI)(CI)M" | Out-Null
[IO.File]::WriteAllBytes("$dir\\$ScriptName", [Convert]::FromBase64String($ScriptB64))
[IO.File]::WriteAllText("$dir\\args.json", $ArgsJson)
# The runner starts a fresh PowerShell on the step's script, so its exit code is what a plain step would give.
$runner = @'
$d = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Content -Path "$d\\started.txt" -Value 'started'
$argv = @()
$j = Get-Content -Raw "$d\\args.json" | ConvertFrom-Json
if ($j) { foreach ($p in $j.PSObject.Properties) { $argv += "-$($p.Name)"; $argv += [string]$p.Value } }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$d\\SCRIPTNAME" @argv *>&1 | Out-File -FilePath "$d\\out.txt" -Encoding utf8
exit $LASTEXITCODE
'@
[IO.File]::WriteAllText("$dir\\runner.ps1", $runner.Replace('SCRIPTNAME', $ScriptName))
$task = "vmlab-$id"
# The Task Scheduler's own log says why a task does not start. It is off by default, so turn it on first.
& wevtutil.exe sl 'Microsoft-Windows-TaskScheduler/Operational' /e:true 2>$null | Out-Null
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \`"$dir\\runner.ps1\`""
# Every setting that can hold a task back is set on purpose, never left to a default: power, missed starts, a second
# instance, and a time limit so Windows itself ends a step that hangs.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -Priority 4 -ExecutionTimeLimit (New-TimeSpan -Seconds ($TimeoutSeconds + 30))
${register}

function Show-Why {
  # What the machine can tell us, so a step that does not start is explained by the record and not guessed at.
  $ti = Get-ScheduledTaskInfo -TaskName $task
  "DIAG task state: $((Get-ScheduledTask -TaskName $task).State); last result: 0x$('{0:X}' -f [int64]$ti.LastTaskResult); last run: $($ti.LastRunTime)"
  "DIAG files in the task folder: $((Get-ChildItem $dir -Name -ErrorAction SilentlyContinue) -join ', ')"
  "DIAG processes of $($Name): $((Get-Process -IncludeUserName -ErrorAction SilentlyContinue | Where-Object { $_.UserName -like ('*\\' + $Name) } | ForEach-Object { $_.ProcessName }) -join ', ')"
  try { Add-Type -AssemblyName System.Windows.Forms; $ps = [System.Windows.Forms.SystemInformation]::PowerStatus; "DIAG power: line=$($ps.PowerLineStatus) battery=$($ps.BatteryChargeStatus); batteries: $(@(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue).Count)" } catch { "DIAG power: not readable" }
  Get-WinEvent -LogName 'Microsoft-Windows-TaskScheduler/Operational' -MaxEvents 80 -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -match [regex]::Escape($task) } | Sort-Object TimeCreated | Select-Object -Last 8 |
    ForEach-Object { $m = ($_.Message -replace '\\s+', ' '); "DIAG task event $($_.Id) at $($_.TimeCreated.ToString('HH:mm:ss')): $($m.Substring(0, [Math]::Min(120, $m.Length)))" }
  Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4624, 4625; StartTime = (Get-Date).AddMinutes(-5) } -MaxEvents 40 -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -match [regex]::Escape($Name) } | Select-Object -First 3 |
    ForEach-Object { $why = if ($_.Message -match 'Sub Status:\\s+(0x[0-9A-Fa-f]+)') { $Matches[1] } else { '' }; $kind = if ($_.Message -match 'Logon Type:\\s+(\\d+)') { $Matches[1] } else { '?' }; "DIAG security event $($_.Id) at $($_.TimeCreated.ToString('HH:mm:ss')), logon type $kind $why" }
}

$code = 1
try {
  # Client Windows holds a stored-password task in its queue until someone has signed in at the screen (run 11: Queued
  # with nobody signed in, started at once after a sign-in). Started through the scheduler's own interface with
  # "ignore the conditions" (flag 2), the same task ran in a second with nobody signed in.
  $scheduler = New-Object -ComObject Schedule.Service
  $scheduler.Connect()
  [void]$scheduler.GetFolder('\\').GetTask($task).RunEx($null, 2, 0, $null)
  $began = Get-Date
  $deadline = $began.AddSeconds($TimeoutSeconds)
  # "Started" means Windows was seen running the task, or the runner left its mark. A task that reads Ready before it
  # ever started has not finished: it has not begun.
  $started = $false; $done = $false; $stuck = $false
  do {
    Start-Sleep -Seconds 2
    $state = [string](Get-ScheduledTask -TaskName $task).State
    if ($state -eq 'Running' -or (Test-Path "$dir\\started.txt")) { $started = $true }
    $done = $started -and ($state -eq 'Ready')
    # A task that has not started after a minute is not going to. Stop now and say why.
    $stuck = (-not $started) -and (((Get-Date) - $began).TotalSeconds -ge 60)
  } while ((-not $done) -and (-not $stuck) -and (Get-Date) -lt $deadline)
  if ($stuck) {
    Show-Why
    Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
    'FAIL the step never started: Windows did not run its task within 60 seconds'; $code = 125
  }
  elseif (-not $done) {
    Show-Why
    Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
    "FAIL the step did not finish in $TimeoutSeconds seconds"; $code = 124
  }
  else { $code = [int](Get-ScheduledTaskInfo -TaskName $task).LastTaskResult }
} finally {
  if (Test-Path "$dir\\out.txt") { Get-Content -Raw "$dir\\out.txt" }
  Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
}
if ($code -gt 255 -or $code -lt 0) { 'FAIL the task ended with 0x{0:X}' -f $code; $code = 1 }
exit $code
`;
}
