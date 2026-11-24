# Runs on the Windows test machine as an ordinary user. Saves a made-up secret in Credential Manager with CredWrite,
# reads it back, tries each persistence kind, and tries a few sizes to find where Windows says no.
$ErrorActionPreference = 'Continue'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class VmlabCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags; public uint Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
    public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredWriteW(ref CREDENTIAL c, uint flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredReadW(string target, uint type, uint flags, out IntPtr cred);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredDeleteW(string target, uint type, uint flags);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr p);
  // 0 on success, else the Windows error number.
  public static int Write(string target, byte[] blob, uint persist) {
    IntPtr p = Marshal.AllocHGlobal(Math.Max(1, blob.Length));
    Marshal.Copy(blob, 0, p, blob.Length);
    CREDENTIAL c = new CREDENTIAL();
    c.Type = 1; c.TargetName = target; c.CredentialBlobSize = (uint)blob.Length; c.CredentialBlob = p; c.Persist = persist; c.UserName = "vmlab";
    bool ok = CredWriteW(ref c, 0);
    int e = ok ? 0 : Marshal.GetLastWin32Error();
    Marshal.FreeHGlobal(p);
    return e;
  }
  public static int Read(string target, out byte[] blob) {
    blob = new byte[0]; IntPtr p;
    if (!CredReadW(target, 1, 0, out p)) return Marshal.GetLastWin32Error();
    CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
    blob = new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob, blob, 0, blob.Length);
    CredFree(p); return 0;
  }
  public static int Delete(string target) { return CredDeleteW(target, 1, 0) ? 0 : Marshal.GetLastWin32Error(); }
}
"@
"WHO: $([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
$secret = 'vmlab-made-up-secret-0123456789'
$e = [VmlabCred]::Write('vmlab-test-secret', [Text.Encoding]::Unicode.GetBytes($secret), 2)
"WRITE (this machine): error $e"
[byte[]]$got = @()
$e = [VmlabCred]::Read('vmlab-test-secret', [ref]$got)
if ($e -eq 0 -and [Text.Encoding]::Unicode.GetString($got) -eq $secret) {
  'READ BACK: ok'
  # Proof for the later steps that there IS a saved secret: a refusal only means something if there was one to refuse.
  Set-Content -Path 'C:\vmlab\shared\cred-saved.ok' -Value 'saved'
} else { "FAIL read back, error $e" }
foreach ($kind in @(@(1, 'this sign-in only'), @(2, 'this machine'), @(3, 'enterprise'))) {
  $e = [VmlabCred]::Write("vmlab-persist-$($kind[0])", [Text.Encoding]::Unicode.GetBytes('x'), [uint32]$kind[0])
  "PERSIST $($kind[0]) ($($kind[1])): write error $e"
}
foreach ($n in 100, 1000, 2560, 2561, 5000) {
  $e = [VmlabCred]::Write('vmlab-size', (New-Object byte[] $n), 2)
  "SIZE $n bytes: write error $e"
}
"DONE"
