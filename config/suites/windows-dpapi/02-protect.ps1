# Runs on the Windows test machine as an ordinary user. Protects a made-up secret with DPAPI (this user's scope)
# two ways, saves the protected text where other accounts can read it, and proves this user can open it again.
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  "WHO: $([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
  $secret = 'vmlab-made-up-secret-0123456789'
  $plain = [Text.Encoding]::UTF8.GetBytes($secret)
  $blob = [Security.Cryptography.ProtectedData]::Protect($plain, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [IO.File]::WriteAllText('C:\vmlab\shared\alice.dpapi', [Convert]::ToBase64String($blob))
  $back = [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($blob, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))
  if ($back -eq $secret) { 'ROUNDTRIP: ok' } else { 'FAIL the text that came back differs' }
  "BLOB BYTES: $($blob.Length); the secret appears in it in clear: $([Text.Encoding]::UTF8.GetString($blob).Contains($secret))"
  # The same idea through the built-in text form, which also uses DPAPI for this user.
  $text = ConvertFrom-SecureString (ConvertTo-SecureString $secret -AsPlainText -Force)
  Set-Content -Path 'C:\vmlab\shared\alice.securestring' -Value $text
  "SECURE STRING FORM: written, $($text.Length) characters"
  "DONE"
} catch { "FAIL $($_.Exception.Message)" ; exit 1 }
