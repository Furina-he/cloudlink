# Close only the isolated lifecycle fixture's main HWND. Does not focus a window,
# inject input, alter Windows settings, or act on the production installation.
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
Import-Module ([IO.Path]::Combine($PSHOME, 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1'))
$root = [IO.Path]::GetFullPath($env:CLOUDLINK_P8_EVIDENCE_ROOT)
$expected = [IO.Path]::GetFullPath($env:CLOUDLINK_P8_EXE)
$targetPid = [uint32]$env:CLOUDLINK_P8_PID
if (!$targetPid -or ![string]::Equals($expected, [IO.Path]::Combine($root, 'application\cloudlink.exe'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Not the isolated lifecycle executable' }
foreach ($leaf in @($root, $expected)) {
  $path = $leaf
  while ($path) {
    if (([IO.File]::GetAttributes($path) -band 0x400) -ne 0) { throw 'Isolated fixture has a reparse point' }
    $path = [IO.Path]::GetDirectoryName($path)
  }
}
foreach ($entry in @(@{path=$root;kind='p8-execution-lifecycle'}, @{path=[IO.Path]::GetDirectoryName($expected);kind='desktop-test-binary'})) {
  $markerPath = [IO.Path]::Combine($entry.path, '.cloudlink.json')
  if (([IO.File]::GetAttributes($markerPath) -band 0x400) -ne 0) { throw 'Isolated fixture marker is a reparse point' }
  $marker = ([IO.File]::ReadAllText($markerPath) | ConvertFrom-Json)
  if ($marker.managedBy -ne 'cloudlink' -or $marker.kind -ne $entry.kind) { throw 'Isolated fixture ownership does not match' }
}
$process = [Diagnostics.Process]::GetProcessById($targetPid)
if (![string]::Equals([IO.Path]::GetFullPath($process.MainModule.FileName), $expected, [StringComparison]::OrdinalIgnoreCase)) { throw 'PID belongs to another executable' }
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class CloudLinkLifecycleClose {
  public delegate bool EnumProc(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int GetWindowLong(IntPtr window, int index);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  public static IntPtr[] MainWindows(uint pid) {
    var windows=new List<IntPtr>();
    EnumProc callback=(window,unused)=>{
      uint owner; GetWindowThreadProcessId(window,out owner);
      if(owner==pid && (GetWindowLong(window,-16)&0x00c00000)!=0) {
        var title=new StringBuilder(512); GetWindowText(window,title,title.Capacity);
        if(title.ToString()=="CloudLink") windows.Add(window);
      }
      return true;
    };
    if(!EnumWindows(callback,IntPtr.Zero)) throw new InvalidOperationException("Cannot enumerate isolated windows");
    return windows.ToArray();
  }
}
'@
$windows = @([CloudLinkLifecycleClose]::MainWindows($targetPid))
if ($windows.Count -ne 1) { throw 'Expected exactly one isolated main HWND' }
$window = $windows[0]
[uint32]$owner = 0
[void][CloudLinkLifecycleClose]::GetWindowThreadProcessId($window, [ref]$owner)
if ($owner -ne $targetPid) { throw 'Isolated window ownership changed' }
$visible = [CloudLinkLifecycleClose]::IsWindowVisible($window)
if (![CloudLinkLifecycleClose]::PostMessage($window, 0x112, [IntPtr]0xf060, [IntPtr]::Zero)) { throw 'Cannot post isolated close request' }
@{pid=$targetPid;hwnd=$window.ToInt64();visibleBefore=$visible;method='Owned SC_CLOSE message; no keyboard/mouse injection or activation'} | ConvertTo-Json -Compress
