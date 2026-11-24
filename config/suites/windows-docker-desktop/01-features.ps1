# Runs on the Windows test machine. Reports what the machine offers for Linux containers, then turns on the features
# Docker Desktop's WSL 2 backend needs. A restart follows (the suite does it).
$ErrorActionPreference = 'Continue'
"OS: $((Get-CimInstance Win32_OperatingSystem).Caption) $([Environment]::OSVersion.Version)"
$cs = Get-CimInstance Win32_ComputerSystem
"MODEL: $($cs.Manufacturer) $($cs.Model); logical CPUs $($cs.NumberOfLogicalProcessors)"
# Nested virtualization: on a cloud VM, the hypervisor must expose the CPU's virtualization to the guest.
$p = Get-CimInstance Win32_Processor | Select-Object -First 1
"VIRTUALIZATION EXPOSED TO THIS MACHINE: $($p.VirtualizationFirmwareEnabled); HYPERVISOR PRESENT: $($cs.HypervisorPresent)"
foreach ($f in 'Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform') {
  $r = & dism.exe /online /enable-feature /featurename:$f /all /norestart /quiet
  "FEATURE $f : dism exit $LASTEXITCODE"
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 3010) { "FAIL could not enable $f" }
}
"DONE"
