# Runs on the Windows test machine after the restart: a file written before it must still be there.
if (Test-Path 'C:\vmlab\marker.txt') { "MARKER AFTER RESTART: yes" } else { "FAIL marker missing after restart" }
"UPTIME MINUTES: $([int]((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalMinutes)"
"DONE"
