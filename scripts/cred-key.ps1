<#
.SYNOPSIS
  Stores and retrieves the TypeSafe API key in Windows Credential Manager.

.DESCRIPTION
  The key lives as a generic Windows credential (target
  `visualizer/typesafe-apikey`) on this machine only. It is never written to
  a file in this repo, never baked into a build, and never printed except by
  `-Get`, which exists so the Electron main process can hand it to the local
  renderer over IPC. Prefer `-Check` to test for existence without touching
  the secret.

.EXAMPLE
  powershell -NoProfile -File scripts/cred-key.ps1 -Store
  powershell -NoProfile -File scripts/cred-key.ps1 -Check  # exit 0 = present
  powershell -NoProfile -File scripts/cred-key.ps1 -Clear
#>

param(
  [switch]$Store,
  [switch]$Get,
  [switch]$Check,
  [switch]$Clear,
  [string]$Target = 'visualizer/typesafe-apikey',
  # Non-interactive alternative to the hidden prompt (for scripts/tests):
  # pass a SecureString, never plaintext on the command line.
  [System.Security.SecureString]$SecureValue
)

$ErrorActionPreference = 'Stop'

$csharp = @'
using System;
using System.Runtime.InteropServices;

public static class CredMan {
  private const int GENERIC = 1;
  private const int PERSIST_LOCAL_MACHINE = 2;

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct CREDENTIAL {
    public int Flags;
    public int Type;
    public string TargetName;
    public string Comment;
    public long LastWritten;
    public int CredentialBlobSize;
    public IntPtr CredentialBlob;
    public int Persist;
    public int AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern bool CredWrite(ref CREDENTIAL cred, int flags);

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern bool CredRead(string target, int type, int flags, out IntPtr cred);

  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern bool CredFree(IntPtr cred);

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern bool CredDelete(string target, int type, int flags);

  public static void Write(string target, string secret) {
    byte[] blob = System.Text.Encoding.Unicode.GetBytes(secret);
    IntPtr blobPtr = Marshal.AllocCoTaskMem(blob.Length);
    try {
      Marshal.Copy(blob, 0, blobPtr, blob.Length);
      Array.Clear(blob, 0, blob.Length);
      var cred = new CREDENTIAL {
        Type = GENERIC,
        TargetName = target,
        CredentialBlobSize = blob.Length,
        CredentialBlob = blobPtr,
        Persist = PERSIST_LOCAL_MACHINE,
        UserName = "typesafe-api-key",
      };
      if (!CredWrite(ref cred, 0))
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally {
      Marshal.FreeCoTaskMem(blobPtr);
    }
  }

  public static string Read(string target) {
    IntPtr ptr;
    if (!CredRead(target, GENERIC, 0, out ptr)) return null;
    try {
      var cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
      if (cred.CredentialBlobSize <= 0) return null;
      byte[] blob = new byte[cred.CredentialBlobSize];
      Marshal.Copy(cred.CredentialBlob, blob, 0, blob.Length);
      return System.Text.Encoding.Unicode.GetString(blob);
    } finally {
      CredFree(ptr);
    }
  }

  public static bool Exists(string target) {
    IntPtr ptr;
    if (!CredRead(target, GENERIC, 0, out ptr)) return false;
    CredFree(ptr);
    return true;
  }

  public static bool Delete(string target) {
    return CredDelete(target, GENERIC, 0);
  }
}
'@

Add-Type -TypeDefinition $csharp -Language CSharp

if ($Store) {
  $sec = if ($null -ne $SecureValue) { $SecureValue } else { Read-Host 'TypeSafe API key (input hidden)' -AsSecureString }
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    [CredMan]::Write($Target, $plain)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
  Write-Host "stored -> $Target"
  exit 0
}

if ($Get) {
  $key = [CredMan]::Read($Target)
  if ($null -eq $key) { exit 1 }
  # The only path that prints the secret: consumed by the local Electron
  # main process over a captured pipe, never by a human-readable log.
  Write-Output $key
  exit 0
}

if ($Check) {
  if ([CredMan]::Exists($Target)) { exit 0 } else { exit 1 }
}

if ($Clear) {
  if ([CredMan]::Delete($Target)) { Write-Host "cleared -> $Target"; exit 0 }
  else { Write-Host "no credential at $Target"; exit 1 }
}

Write-Host 'usage: cred-key.ps1 -Store | -Get | -Check | -Clear [-Target <name>]'
exit 2
