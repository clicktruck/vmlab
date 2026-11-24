# Runs on the Windows test machine as whoever the step names. Looks for the secret alice saved. Prints READ: ok when it
# comes back, READ: not found when Windows says error 1168, and READ: error N for anything else.
$ErrorActionPreference = 'Continue'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class VmlabCredRead {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags; public uint Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
    public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredReadW(string target, uint type, uint flags, out IntPtr cred);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr p);
  public static int Read(string target, out string text) {
    text = ""; IntPtr p;
    if (!CredReadW(target, 1, 0, out p)) return Marshal.GetLastWin32Error();
    CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
    text = Marshal.PtrToStringUni(c.CredentialBlob, (int)c.CredentialBlobSize / 2);
    CredFree(p); return 0;
  }
}
"@
"WHO: $([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
if (-not (Test-Path 'C:\vmlab\shared\cred-saved.ok')) { 'FAIL nothing was saved, so nothing was tested'; exit 1 }
[string]$text = ''
$e = [VmlabCredRead]::Read('vmlab-test-secret', [ref]$text)
if ($e -eq 0 -and $text -eq 'vmlab-made-up-secret-0123456789') { 'READ: ok' }
elseif ($e -eq 1168) { 'READ: not found' }
else { "READ: error $e" }
"DONE"
