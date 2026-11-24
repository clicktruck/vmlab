# Runs on the Windows test machine. Makes new files, locks each one a different way, and prints who may open it.
# Mirrors the usual way a program makes a saved secret private: give the current user full control, then stop the
# file inheriting. One line per file, so the whole answer fits in Run Command's 4 KB of output.
#   Scenario 1: a folder whose entries pass down to new files (the usual case).
#   Scenario 2: a folder that passes nothing down, so a new file gets the creating process's default entries
#               (explicit ones, not inherited). Some build machines are set up like this.
# Results so far (2026-11-23): in scenario 2, grant-then-inheritance:r (A) leaves the default entries in place, so the
# file is not private. Removing SYSTEM and Administrators by SID (old variant F) is dangerous: when the current user IS
# the system account it removes the only entry. Run 6 tried G (read the list back, remove every other entry by the NAME
# icacls printed): it failed for an administrator user, because icacls prints the logon-session entry as
# NT AUTHORITY\LogonSessionId_0_<n> and `/remove:g` with that name did nothing. Two fixes are tried now:
#   H  as G, but a logon-session name is turned into its SID (S-1-5-5-0-<n>) before removing, and the answer of each
#      removal is printed so a failure says why.
#   I  replace the whole list at once: `icacls /restore` with a one-entry list written for the current user's SID.
# The file's own `icacls /save` text is printed too, so a parser can be written from the real format.
$ErrorActionPreference = 'Continue'
$who = ((& whoami.exe /user /fo csv /nh) -replace '"', '').Trim()
$whoParts = $who -split ','
$whoName = $whoParts[0]
$sid = $whoParts[1]
"RUNNING AS: $who"
"OS: $((Get-CimInstance Win32_OperatingSystem).Caption) $([Environment]::OSVersion.Version)  TEMP=$env:TEMP"

function Line($label, $f) {
  $acl = Get-Acl $f
  $e = @(foreach ($r in $acl.Access) { "$($r.IdentityReference):$(([string]$r.FileSystemRights) -replace 'FullControl','F'):$(if ($r.IsInherited) {'inh'} else {'own'})" })
  "  $label protected=$($acl.AreAccessRulesProtected) entries=$($e.Count) [$($e -join '; ')]"
}
function Raw($label, $f) {
  # The text icacls itself prints, on one line, so a parser can be written from the real thing.
  "    raw $label : " + ((@(& icacls.exe $f) | Where-Object { $_.Trim() }) -join ' | ').Replace($f, '<file>') -replace '\s{2,}', ' '
}
function NewFile($dir, $n) { $p = Join-Path $dir $n; New-Item -ItemType File -Path $p | Out-Null; $p }

$script:log = @()
function KeepOnlyMe($f) {
  & icacls.exe $f /grant:r "*${sid}:(F)" | Out-Null
  & icacls.exe $f /inheritance:r | Out-Null
  foreach ($l in @(& icacls.exe $f)) {
    $t = $l.Trim()
    if ($t.StartsWith($f)) { $t = $t.Substring($f.Length).Trim() }
    if ($t -match '^(.+?):\(') {
      $p = $Matches[1]
      if ($p.ToLower() -ne $whoName.ToLower()) {
        $target = $p
        if ($p -match '^S-1-') { $target = "*$p" }
        elseif ($p -match 'LogonSessionId_(\d+)_(\d+)$') { $target = "*S-1-5-5-$($Matches[1])-$($Matches[2])" }
        $said = (& icacls.exe $f /remove:g $target 2>&1 | Out-String).Trim() -replace '\s+', ' '
        $script:log += "remove [$p] as [$target] -> $said"
      }
    }
  }
}
function ReplaceWhole($f) {
  $list = Join-Path $env:TEMP ('acl-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.txt')
  $dir = Split-Path -Parent $f
  $leaf = Split-Path -Leaf $f
  Set-Content -Path $list -Value @($leaf, "D:P(A;;FA;;;$sid)", '') -Encoding Unicode
  $said = (& icacls.exe $dir /restore $list 2>&1 | Out-String).Trim() -replace '\s+', ' '
  $script:log += "restore -> $said"
  Remove-Item $list -Force -ErrorAction SilentlyContinue
}
function SaveText($label, $f) {
  $list = Join-Path $env:TEMP ('save-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.txt')
  & icacls.exe $f /save $list | Out-Null
  "    save $label : " + ((Get-Content $list | Where-Object { $_.Trim() }) -join ' | ').Replace($f, '<file>') -replace '\s{2,}', ' '
  Remove-Item $list -Force -ErrorAction SilentlyContinue
}

function Variants($dir, $raw) {
  Line 'before ' (NewFile $dir 'before')
  $a = NewFile $dir 'A'; & icacls.exe $a /grant:r "*${sid}:(F)" | Out-Null; & icacls.exe $a /inheritance:r | Out-Null
  Line 'A grant,then inheritance:r ' $a
  if ($raw) { Raw 'after A' $a }
  $c = NewFile $dir 'C'
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule((New-Object System.Security.Principal.SecurityIdentifier($sid)), 'FullControl', 'Allow')))
  Set-Acl -Path $c -AclObject $acl
  Line 'C Set-Acl one rule         ' $c
  $h = NewFile $dir 'H'; $script:log = @(); KeepOnlyMe $h
  Line 'H A,then remove others (logon SID)' $h
  if ($raw) { SaveText 'of file A' $a; $script:log | ForEach-Object { "    $_" }; Raw 'after H' $h }
  $i = NewFile $dir 'I'; $script:log = @(); ReplaceWhole $i
  Line 'I replace whole list (restore)  ' $i
  if ($raw) { $script:log | ForEach-Object { "    $_" }; Raw 'after I' $i }
}

$root = Join-Path $env:TEMP ('acl-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$dir1 = Join-Path $root 'inherits'
New-Item -ItemType Directory -Force $dir1 | Out-Null
"=== SCENARIO 1: folder passes its entries down"
Variants $dir1 $false

$dir2 = Join-Path $root 'passes-nothing'
New-Item -ItemType Directory -Force $dir2 | Out-Null
& icacls.exe $dir2 /inheritance:r | Out-Null
& icacls.exe $dir2 /grant:r "*${sid}:(F)" | Out-Null
"=== SCENARIO 2: folder passes nothing down"
Variants $dir2 $true
"DONE"
