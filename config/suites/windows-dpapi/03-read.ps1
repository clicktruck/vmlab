# Runs on the Windows test machine as whoever the step names. Tries to open what alice protected. Prints UNPROTECT: ok
# when the made-up secret came back, and UNPROTECT: DENIED with the first words of Windows' reason when it did not.
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Security
"WHO: $([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
$expected = 'vmlab-made-up-secret-0123456789'
# A refusal only means something if there was something to refuse. Without the file, say so and fail.
if (-not (Test-Path 'C:\vmlab\shared\alice.dpapi')) { 'FAIL the protected file is not there, so nothing was tested'; exit 1 }
# A refusal from an account that cannot use DPAPI at all proves nothing (an account started without its profile is
# refused everything). So the reader must first protect and open something of its own.
try {
  $mine = [Security.Cryptography.ProtectedData]::Protect([byte[]](1, 2, 3), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [void][Security.Cryptography.ProtectedData]::Unprotect($mine, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  'OWN DPAPI: ok'
} catch { 'FAIL this account cannot use DPAPI at all here, so its answer about another account means nothing'; exit 1 }
try {
  $blob = [Convert]::FromBase64String((Get-Content -Raw 'C:\vmlab\shared\alice.dpapi').Trim())
  $got = [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))
  if ($got -eq $expected) { 'UNPROTECT: ok' } else { 'UNPROTECT: wrong text came back' }
} catch { $m = $_.Exception.Message; "UNPROTECT: DENIED ($($m.Substring(0, [Math]::Min(80, $m.Length))))" }
try {
  $ss = ConvertTo-SecureString (Get-Content -Raw 'C:\vmlab\shared\alice.securestring').Trim() -ErrorAction Stop
  $got = [Net.NetworkCredential]::new('', $ss).Password
  if ($got -eq $expected) { 'SECURE STRING FORM: ok' } else { 'SECURE STRING FORM: wrong text came back' }
} catch { $m = $_.Exception.Message; "SECURE STRING FORM: DENIED ($($m.Substring(0, [Math]::Min(80, $m.Length))))" }
"DONE"
