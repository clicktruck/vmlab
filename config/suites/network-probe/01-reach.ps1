# Runs on the Windows test machine. One line per address: OK with the HTTP status, or FAIL with the reason.
# A reply of any kind (even 403 or 404) means the network path works; only a failure to connect is a FAIL.
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
"OS: $((Get-CimInstance Win32_OperatingSystem).Caption) $([Environment]::OSVersion.Version)"
$targets = @(
  'https://api.github.com/',
  'https://github.com/',
  'https://learn.microsoft.com/',
  'https://download.docker.com/',
  'https://desktop.docker.com/',
  'https://registry-1.docker.io/v2/',
  'https://pypi.org/',
  'https://github.com/Audiveris/audiveris/releases'
)
foreach ($u in $targets) {
  try {
    $r = Invoke-WebRequest -Uri $u -Method Head -UseBasicParsing -TimeoutSec 20 -ErrorAction Stop
    "OK   $($r.StatusCode) $u"
  } catch {
    if ($_.Exception.Response) { "OK   $([int]$_.Exception.Response.StatusCode) $u" }
    else { "FAIL $u : $($_.Exception.Message)" }
  }
}
"DONE"
