# Runs on the Windows test machine as the system account. Makes one ordinary account, then tries several ways of starting
# a small program as it. The program proves more than "it ran": it reports who it is, whether a profile is loaded, and
# whether DPAPI works (run 8 showed a script can run as a user and still have no usable profile).
# Run Command gives back only the LAST 4 KB, so the answers are repeated in a short SUMMARY at the very end.
# The password is made up here, for a throwaway account on a throwaway machine.
$ErrorActionPreference = 'Continue'
$summary = New-Object System.Collections.Generic.List[string]
"OS: $((Get-CimInstance Win32_OperatingSystem).Caption) $([Environment]::OSVersion.Version)"
try { Add-Type -AssemblyName System.Windows.Forms; $ps = [System.Windows.Forms.SystemInformation]::PowerStatus; "POWER: line=$($ps.PowerLineStatus) battery=$($ps.BatteryChargeStatus) batteries=$(@(Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue).Count)" } catch { "POWER: not readable" }
$st = Get-ItemProperty 'HKLM:\SYSTEM\Setup' -ErrorAction SilentlyContinue
"SETUP: OOBEInProgress=$($st.OOBEInProgress) SystemSetupInProgress=$($st.SystemSetupInProgress) ImageState=$((Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Setup\State' -ErrorAction SilentlyContinue).ImageState)"
"SIGNED IN AT THE SCREEN: " + ((@(Get-Process explorer -IncludeUserName -ErrorAction SilentlyContinue | ForEach-Object { $_.UserName }) -join ', ') + ' ').Trim() + ' (empty means nobody)'
"SERVICES: " + ((Get-Service Schedule, seclogon, ProfSvc -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Name)=$($_.Status)/$($_.StartType)" }) -join ' ')

$name = 'probe'
$pw = 'Vl!' + [guid]::NewGuid().ToString('N').Substring(0, 16) + 'Aa1'
New-LocalUser -Name $name -Password (ConvertTo-SecureString $pw -AsPlainText -Force) -PasswordNeverExpires | Out-Null
Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $name
$sid = (New-Object Security.Principal.NTAccount($env:COMPUTERNAME, $name)).Translate([Security.Principal.SecurityIdentifier]).Value
$cfg = Join-Path $env:TEMP 'probe-rights.inf'; $db = Join-Path $env:TEMP 'probe-rights.sdb'
& secedit.exe /export /cfg $cfg /areas USER_RIGHTS | Out-Null
$text = @(Get-Content $cfg)
$out = foreach ($l in $text) { if ($l -match '^SeBatchLogonRight\s*=') { "$l,*$sid" } else { $l } }
if (-not ($text -match '^SeBatchLogonRight\s*=')) { $out = foreach ($l in $out) { $l; if ($l -eq '[Privilege Rights]') { "SeBatchLogonRight = *$sid" } } }
Set-Content -Path $cfg -Value $out -Encoding Unicode
& secedit.exe /configure /db $db /cfg $cfg /areas USER_RIGHTS | Out-Null
& secedit.exe /export /cfg $cfg /areas USER_RIGHTS | Out-Null
"BATCH RIGHT GRANTED: " + [bool](@(Get-Content $cfg) -match "SeBatchLogonRight.*$sid")

# The later step needs this password again. Resetting it would be an administrator's reset, which can itself break
# the account's DPAPI keys and spoil the answer. So keep it where only the system account can read it.
$vault = 'C:\vmlab\system-only'
New-Item -ItemType Directory -Force $vault | Out-Null
& icacls.exe $vault /inheritance:r /grant '*S-1-5-18:(OI)(CI)F' | Out-Null
Set-Content -Path "$vault\probe.txt" -Value $pw

$dir = 'C:\vmlab\probe'
New-Item -ItemType Directory -Force $dir | Out-Null
& icacls.exe $dir /grant "*${sid}:(OI)(CI)M" | Out-Null
& wevtutil.exe sl 'Microsoft-Windows-TaskScheduler/Operational' /e:true
$account = "$env:COMPUTERNAME\$name"

# The program each way starts. One line: who, where the profile is, whether the user's registry is there, and DPAPI.
@'
param([string]$Out)
$r = @("who=" + [Security.Principal.WindowsIdentity]::GetCurrent().Name, "profile=" + $env:USERPROFILE, "hkcu=" + (Test-Path 'HKCU:\Software'))
try {
  Add-Type -AssemblyName System.Security
  $b = [Security.Cryptography.ProtectedData]::Protect([byte[]](1, 2, 3), $null, 'CurrentUser')
  [void][Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser')
  $r += 'dpapi=ok'
} catch { $m = $_.Exception.Message; $r += 'dpapi=NO(' + $m.Substring(0, [Math]::Min(45, $m.Length)) + ')' }
Set-Content -Path $Out -Value ($r -join ' ')
'@ | Set-Content -Path "$dir\payload.ps1"
function PayloadArgs($file) { "-NoProfile -ExecutionPolicy Bypass -File $dir\payload.ps1 -Out $file" }

function Wait-File($file, $seconds) {
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $seconds) { if (Test-Path $file) { Start-Sleep -Milliseconds 300; return [int]((Get-Date) - $t0).TotalSeconds }; Start-Sleep -Seconds 1 }
  return -1
}
function Report($label, $file, $task, $seconds) {
  $s = Wait-File $file $seconds
  if ($s -ge 0) { $line = "RAN     $label after ${s}s: $((Get-Content $file -ErrorAction SilentlyContinue | Select-Object -First 1))" }
  else {
    $st = if ($task) { [string](Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue).State } else { '' }
    $line = "NOT RAN $label in ${seconds}s (task state: $st)"
  }
  $line; $summary.Add($line)
  if ($task -and $s -lt 0) {
    # The scheduler's own words for this task: the reason is here if it is anywhere.
    Get-WinEvent -LogName 'Microsoft-Windows-TaskScheduler/Operational' -MaxEvents 120 -ErrorAction SilentlyContinue |
      Where-Object { $_.Message -match "\\$task\b" } | Sort-Object TimeCreated | Select-Object -Last 3 |
      ForEach-Object { $m = ($_.Message -replace '\s+', ' '); "    event $($_.Id): $($m.Substring(0, [Math]::Min(95, $m.Length)))" }
  }
  if ($task) { Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue }
}
$explicit = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -Priority 4 -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

# E first: a task as SYSTEM, to see whether tasks start at all on this machine. No profile to make, so it is quick.
$f = "$dir\e.txt"; $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (PayloadArgs $f)
Register-ScheduledTask -TaskName 'pe' -Action $act -User 'SYSTEM' -RunLevel Highest | Out-Null; Start-ScheduledTask -TaskName 'pe'
Report 'E task as SYSTEM, default settings' $f 'pe' 45

# B: a stored password, every setting explicit (what the wrapper does now). First use of the account: allow longer.
$f = "$dir\b.txt"; $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (PayloadArgs $f)
Register-ScheduledTask -TaskName 'pb' -Action $act -Settings $explicit -User $account -Password $pw -RunLevel Limited | Out-Null; Start-ScheduledTask -TaskName 'pb'
Report 'B task, stored password, explicit settings' $f 'pb' 75

# A: a stored password, default settings (what runs 9 and 10 did).
$f = "$dir\a.txt"; $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (PayloadArgs $f)
Register-ScheduledTask -TaskName 'pa' -Action $act -User $account -Password $pw -RunLevel Limited | Out-Null; Start-ScheduledTask -TaskName 'pa'
Report 'A task, stored password, default settings' $f 'pa' 40

# C: no stored password (S4U), explicit settings.
$f = "$dir\c.txt"; $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (PayloadArgs $f)
$pr = New-ScheduledTaskPrincipal -UserId $account -LogonType S4U -RunLevel Limited
Register-ScheduledTask -TaskName 'pc' -Action $act -Settings $explicit -Principal $pr | Out-Null; Start-ScheduledTask -TaskName 'pc'
Report 'C task, S4U no password, explicit settings' $f 'pc' 40

# D: schtasks.exe instead of the PowerShell cmdlets.
$f = "$dir\d.txt"
& schtasks.exe /create /tn pd /ru $account /rp $pw /sc once /st 23:59 /tr "powershell.exe $(PayloadArgs $f)" /f | Out-Null
& schtasks.exe /run /tn pd | Out-Null
Report 'D schtasks.exe, stored password' $f 'pd' 40

# J: a stored password, default settings, started through the scheduler's own interface with "ignore the conditions".
$f = "$dir\j.txt"; $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (PayloadArgs $f)
Register-ScheduledTask -TaskName 'pj' -Action $act -User $account -Password $pw -RunLevel Limited | Out-Null
try { $svc = New-Object -ComObject Schedule.Service; $svc.Connect(); [void]$svc.GetFolder('\').GetTask('pj').RunEx($null, 2, 0, $null) } catch { "    J could not start: $($_.Exception.Message)" }
Report 'J task, stored password, conditions ignored' $f 'pj' 40

# F and G: no Task Scheduler at all. Log the account on, load its profile, start the program with its token.
# Written for the C# 5 compiler that Windows PowerShell 5.1 uses: no newer syntax.
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class VmlabLaunch {
  [StructLayout(LayoutKind.Sequential)] struct LUID { public uint Low; public int High; }
  [StructLayout(LayoutKind.Sequential)] struct TOKEN_PRIVILEGES { public uint Count; public LUID Luid; public uint Attr; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX; public int dwY; public int dwXSize; public int dwYSize; public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute; public int dwFlags;
    public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct PROFILEINFO {
    public int dwSize; public int dwFlags; public string lpUserName; public string lpProfilePath; public string lpDefaultPath; public string lpServerName; public string lpPolicyPath; public IntPtr hProfile; }
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool LogonUserW(string u, string d, string p, int type, int prov, out IntPtr tok);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr h, uint acc, out IntPtr tok);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool LookupPrivilegeValueW(string sys, string name, out LUID luid);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool AdjustTokenPrivileges(IntPtr tok, bool disableAll, ref TOKEN_PRIVILEGES tp, int len, IntPtr prev, IntPtr retLen);
  [DllImport("userenv.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool LoadUserProfileW(IntPtr tok, ref PROFILEINFO pi);
  [DllImport("userenv.dll", SetLastError = true)] static extern bool UnloadUserProfile(IntPtr tok, IntPtr hProfile);
  [DllImport("userenv.dll", SetLastError = true)] static extern bool CreateEnvironmentBlock(out IntPtr env, IntPtr tok, bool inherit);
  [DllImport("userenv.dll", SetLastError = true)] static extern bool DestroyEnvironmentBlock(IntPtr env);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessAsUserW(IntPtr tok, string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessWithTokenW(IntPtr tok, int logonFlags, string app, StringBuilder cmd, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  static void Enable(string name) {
    IntPtr t; if (!OpenProcessToken(GetCurrentProcess(), 0x28, out t)) return;
    TOKEN_PRIVILEGES tp = new TOKEN_PRIVILEGES(); tp.Count = 1; tp.Attr = 2;
    if (LookupPrivilegeValueW(null, name, out tp.Luid)) AdjustTokenPrivileges(t, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
    CloseHandle(t);
  }
  // "exit=N", "timeout", or "error at STEP: win32 N". logonType 4 is a batch logon, 2 an interactive one.
  public static string Run(string user, string password, string commandLine, int logonType, int waitMs) {
    foreach (string p in new string[] { "SeAssignPrimaryTokenPrivilege", "SeIncreaseQuotaPrivilege", "SeBackupPrivilege", "SeRestorePrivilege", "SeTcbPrivilege" }) Enable(p);
    IntPtr tok;
    if (!LogonUserW(user, ".", password, logonType, 0, out tok)) return "error at LogonUser: win32 " + Marshal.GetLastWin32Error();
    PROFILEINFO prof = new PROFILEINFO(); prof.dwSize = Marshal.SizeOf(typeof(PROFILEINFO)); prof.lpUserName = user; prof.dwFlags = 1;
    if (!LoadUserProfileW(tok, ref prof)) { int e = Marshal.GetLastWin32Error(); CloseHandle(tok); return "error at LoadUserProfile: win32 " + e; }
    IntPtr env; if (!CreateEnvironmentBlock(out env, tok, false)) env = IntPtr.Zero;
    STARTUPINFO si = new STARTUPINFO(); si.cb = Marshal.SizeOf(typeof(STARTUPINFO)); si.lpDesktop = "";
    PROCESS_INFORMATION pi; string result;
    if (!CreateProcessAsUserW(tok, null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, false, 0x08000400, env, "C:\\", ref si, out pi)) {
      result = "error at CreateProcessAsUser: win32 " + Marshal.GetLastWin32Error();
    } else {
      uint w = WaitForSingleObject(pi.hProcess, (uint)waitMs); uint code = 0; GetExitCodeProcess(pi.hProcess, out code);
      result = (w == 0 ? "exit=" + code : "timeout"); CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    }
    if (env != IntPtr.Zero) DestroyEnvironmentBlock(env);
    UnloadUserProfile(tok, prof.hProfile); CloseHandle(tok);
    return result;
  }
  // The same, through the Secondary Logon service, which loads the profile itself (logon flag 1) and gives the
  // account access to the caller's window station. This is the route Ansible's "runas" takes.
  public static string RunWithToken(string user, string password, string commandLine, int logonType, int waitMs) {
    Enable("SeImpersonatePrivilege");
    IntPtr tok;
    if (!LogonUserW(user, ".", password, logonType, 0, out tok)) return "error at LogonUser: win32 " + Marshal.GetLastWin32Error();
    IntPtr env; if (!CreateEnvironmentBlock(out env, tok, false)) env = IntPtr.Zero;
    STARTUPINFO si = new STARTUPINFO(); si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
    PROCESS_INFORMATION pi; string result;
    if (!CreateProcessWithTokenW(tok, 1, null, new StringBuilder(commandLine), 0x08000400, env, "C:\\", ref si, out pi)) {
      result = "error at CreateProcessWithToken: win32 " + Marshal.GetLastWin32Error();
    } else {
      uint w = WaitForSingleObject(pi.hProcess, (uint)waitMs); uint code = 0; GetExitCodeProcess(pi.hProcess, out code);
      result = (w == 0 ? "exit=" + code : "timeout"); CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    }
    if (env != IntPtr.Zero) DestroyEnvironmentBlock(env);
    CloseHandle(tok);
    return result;
  }
}
'@
foreach ($way in @(@('F direct launch, batch logon, profile loaded', 'f', 4, 'Run'), @('G direct launch, interactive logon, profile loaded', 'g', 2, 'Run'), @('H token launch via Secondary Logon, batch logon', 'h', 4, 'RunWithToken'), @('I token launch via Secondary Logon, interactive logon', 'i', 2, 'RunWithToken'))) {
  $f = "$dir\$($way[1]).txt"
  $cmdLine = "powershell.exe $(PayloadArgs $f)"
  try {
    if ($way[3] -eq 'Run') { $r = [VmlabLaunch]::Run($name, $pw, $cmdLine, [int]$way[2], 45000) }
    else { $r = [VmlabLaunch]::RunWithToken($name, $pw, $cmdLine, [int]$way[2], 45000) }
  } catch { $r = 'threw: ' + $_.Exception.Message }
  if (Test-Path $f) { $line = "RAN     $($way[0]) ($r): $((Get-Content $f | Select-Object -First 1))" } else { $line = "NOT RAN $($way[0]) ($r)" }
  $line; $summary.Add($line)
}

"PROFILE FOLDER: " + (Test-Path "C:\Users\$name")
"--- User Profile Service, last events"
Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = 'Microsoft-Windows-User Profiles Service' } -MaxEvents 3 -ErrorAction SilentlyContinue |
  ForEach-Object { $m = ($_.Message -replace '\s+', ' '); "    $($_.Id): $($m.Substring(0, [Math]::Min(100, $m.Length)))" }
"=== SUMMARY"
$summary
"DONE"
