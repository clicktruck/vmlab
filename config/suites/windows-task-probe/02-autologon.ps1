# Runs on the Windows test machine as the system account. Sets the machine to sign a second ordinary account in at
# the screen by itself after the next restart. Reports say client Windows holds a stored-password task until somebody
# has signed in at the screen; this is how to make that happen on a machine with no keyboard.
# The password is made up here, for a throwaway account on a throwaway machine, and the machine is deleted after.
$ErrorActionPreference = 'Stop'
$name = 'console'
$pw = 'Vl!' + [guid]::NewGuid().ToString('N').Substring(0, 16) + 'Aa1'
New-LocalUser -Name $name -Password (ConvertTo-SecureString $pw -AsPlainText -Force) -PasswordNeverExpires | Out-Null
Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $name
$k = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
Set-ItemProperty -Path $k -Name AutoAdminLogon -Value '1'
Set-ItemProperty -Path $k -Name DefaultUserName -Value $name
Set-ItemProperty -Path $k -Name DefaultDomainName -Value $env:COMPUTERNAME
Set-ItemProperty -Path $k -Name DefaultPassword -Value $pw
# Skip the first sign-in privacy questions, so the sign-in finishes with nobody there to answer them.
New-Item -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\OOBE' -Force | Out-Null
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\OOBE' -Name DisablePrivacyExperience -Value 1 -Type DWord
# No "Hi, we're getting things ready" animation: it only makes the first sign-in slower.
Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name EnableFirstLogonAnimation -Value 0 -Type DWord
# Let the account log on as a batch job too, so a stored-password task can be tried for it later.
$sid = (New-Object Security.Principal.NTAccount($env:COMPUTERNAME, $name)).Translate([Security.Principal.SecurityIdentifier]).Value
$cfg = Join-Path $env:TEMP 'console-rights.inf'; $db = Join-Path $env:TEMP 'console-rights.sdb'
& secedit.exe /export /cfg $cfg /areas USER_RIGHTS | Out-Null
$out = foreach ($l in @(Get-Content $cfg)) { if ($l -match '^SeBatchLogonRight\s*=') { "$l,*$sid" } else { $l } }
Set-Content -Path $cfg -Value $out -Encoding Unicode
& secedit.exe /configure /db $db /cfg $cfg /areas USER_RIGHTS | Out-Null
"AUTOLOGON SET for $name"
"DONE"
