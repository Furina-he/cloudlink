param(
  [Parameter(Mandatory = $true)][string]$Root,
  [Parameter(Mandatory = $true)][string]$RunId,
  [Parameter(Mandatory = $true)][ValidateSet('0.1.0', '0.1.1')][string]$Version,
  [Parameter(Mandatory = $true)][ValidateSet('prepare', 'commit')][string]$Operation,
  [ValidateSet('true', 'false')][string]$Restart = 'false'
)
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
Import-Module "$PSHOME\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1"

# This script is embedded in the signed test installer. It never consults a
# profile, KnownFolder or installation registry and never recursively deletes.
if ($RunId -notmatch '^[0-9a-f]{16}$' -or $Root -match '(^|[\\/])\.\.([\\/]|$)' -or -not [IO.Path]::IsPathRooted($Root)) { throw 'Invalid fixture identity' }
$Root = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
if ($Root -notmatch ('[\\/]test-results[\\/]p8[\\/]update-' + $RunId + '$')) { throw 'Not a P8 fixture root' }
$install = [IO.Path]::Combine($Root, 'install')
$stage = [IO.Path]::Combine($Root, 'installer-staging', $Version)
$names = @('cloudlink.exe', 'cloudlink-guard.exe')

function Assert-PlainPath([string]$Path, [bool]$Directory) {
  $pending = [Collections.Generic.Stack[string]]::new()
  $cursor = [IO.Path]::GetFullPath($Path)
  while ($cursor) { $pending.Push($cursor); $cursor = [IO.Path]::GetDirectoryName($cursor) }
  while ($pending.Count) {
    $cursor = $pending.Pop()
    $attributes = [IO.File]::GetAttributes($cursor)
    if (($attributes -band 0x400) -ne 0) { throw 'Fixture contains a reparse point' }
    if (($pending.Count -gt 0 -or $Directory) -and ($attributes -band 0x10) -eq 0) { throw 'Non-directory ancestor' }
    if ($pending.Count -eq 0 -and -not $Directory -and ($attributes -band 0x10) -ne 0) { throw 'Expected a plain file' }
  }
}
function Assert-PlainTree([string]$Directory) {
  Assert-PlainPath $Directory $true
  $pending = [Collections.Generic.Stack[string]]::new()
  $pending.Push($Directory)
  while ($pending.Count) {
    foreach ($entry in [IO.Directory]::EnumerateFileSystemEntries($pending.Pop())) {
      $attributes = [IO.File]::GetAttributes($entry)
      if (($attributes -band 0x400) -ne 0) { throw 'Linked installer entry' }
      if (($attributes -band 0x10) -ne 0) { $pending.Push($entry) }
    }
  }
}
function Read-Json([string]$Path) {
  Assert-PlainPath $Path $false
  if ([IO.FileInfo]::new($Path).Length -gt 65536) { throw 'Oversized fixture JSON' }
  return ([IO.File]::ReadAllText($Path) | ConvertFrom-Json)
}
function Assert-Owner([string]$Directory, [string]$Kind) {
  $marker = Read-Json ([IO.Path]::Combine($Directory, '.cloudlink.json'))
  if ($marker.managedBy -ne 'cloudlink' -or $marker.kind -ne $Kind -or $marker.runId -ne $RunId) { throw 'Fixture ownership changed' }
  return $marker
}
function File-Hash([string]$Path) {
  Assert-PlainPath $Path $false
  $algorithm = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($Path)
  try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $stream.Dispose(); $algorithm.Dispose() }
}
function Write-NewJson([string]$Path, $Value) {
  Assert-PlainPath ([IO.Path]::GetDirectoryName($Path)) $true
  $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 8 -Compress))
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } finally { $stream.Dispose() }
}
function Move-Retry([string]$From, [string]$To) {
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ($true) {
    Assert-PlainPath $From $false
    Assert-PlainPath ([IO.Path]::GetDirectoryName($To)) $true
    if ([IO.File]::Exists($To) -or [IO.Directory]::Exists($To)) { throw 'Move destination already exists' }
    try { [IO.File]::Move($From, $To); return }
    catch [IO.IOException] { if ([DateTime]::UtcNow -ge $deadline) { throw }; Start-Sleep -Milliseconds 100 }
  }
}

Assert-PlainPath $Root $true
$null = Assert-Owner $Root 'update-test'
Assert-PlainTree $install
$previous = Assert-Owner $install 'update-test-install'
$product = 'CloudLink P8 Update ' + $RunId
$identifier = 'com.cloudlink.test.updater.r' + $RunId
if ($previous.productName -ne $product -or $previous.identifier -ne $identifier) { throw 'Installation identity changed' }
foreach ($name in $names) {
  $path = [IO.Path]::Combine($install, $name)
  if ($previous.version) {
    if ((File-Hash $path) -ne $previous.files.$name) { throw 'Installed payload was changed' }
  } elseif ([IO.File]::Exists($path) -or [IO.Directory]::Exists($path)) { throw 'Unowned installation payload' }
}
$environment = @{
  SystemRoot = 'C:\Windows'; WINDIR = 'C:\Windows'; SystemDrive = 'C:';
  COMSPEC = 'C:\Windows\System32\cmd.exe'; PATH = 'C:\Windows\System32;C:\Windows\System32\OpenSSH'; PATHEXT = '.COM;.EXE;.BAT;.CMD';
  HOME = [IO.Path]::Combine($Root, 'data', 'home'); USERPROFILE = [IO.Path]::Combine($Root, 'data', 'home');
  APPDATA = [IO.Path]::Combine($Root, 'os-profile', 'AppData', 'Roaming'); LOCALAPPDATA = [IO.Path]::Combine($Root, 'os-profile', 'AppData', 'Local');
  ProgramData = [IO.Path]::Combine($Root, 'os-profile', 'ProgramData'); TEMP = [IO.Path]::Combine($Root, 'tmp'); TMP = [IO.Path]::Combine($Root, 'tmp');
  CLOUDLINK_HOME = [IO.Path]::Combine($Root, 'data'); CLOUDLINK_USER_HOME = [IO.Path]::Combine($Root, 'data', 'home'); CLOUDLINK_WSL_ROOT = [IO.Path]::Combine($Root, 'data', 'wsl');
  CLOUDLINK_TEST_WSL_DISTROS = ''; PSModuleAnalysisCachePath = 'NUL'; PSModulePath = ''; NO_PROXY = '127.0.0.1,localhost,::1';
  GIT_CONFIG_NOSYSTEM = '1'; GIT_CONFIG_GLOBAL = 'NUL'; GH_PROMPT_DISABLED = '1'; WRANGLER_SEND_METRICS = 'false'; WRANGLER_LOG_PATH = 'NUL'
}
foreach ($name in @('HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'TEMP', 'TMP', 'CLOUDLINK_HOME', 'CLOUDLINK_USER_HOME', 'CLOUDLINK_WSL_ROOT')) {
  Assert-PlainPath $environment[$name] $true
  $actual = [Environment]::GetEnvironmentVariable($name)
  if (-not $actual -or [IO.Path]::GetFullPath($actual) -ne [IO.Path]::GetFullPath($environment[$name])) { throw 'Installer lost its isolated environment' }
}

if ($Operation -eq 'prepare') {
  Assert-PlainPath ([IO.Path]::GetDirectoryName($stage)) $true
  # Refuse leftovers; no automatic claiming, overwriting or recursive cleanup.
  if ([IO.File]::Exists($stage) -or [IO.Directory]::Exists($stage)) { throw 'Installer staging already exists; prepare a new fixture' }
  $null = [IO.Directory]::CreateDirectory($stage)
  Write-NewJson ([IO.Path]::Combine($stage, '.cloudlink.json')) @{ managedBy = 'cloudlink'; kind = 'update-test-staging'; runId = $RunId; version = $Version }
  exit 0
}

Assert-PlainTree $stage
$stagingOwner = Assert-Owner $stage 'update-test-staging'
if ($stagingOwner.version -ne $Version) { throw 'Staging version changed' }
if (@([IO.Directory]::EnumerateFileSystemEntries($stage)).Count -ne 3) { throw 'Unexpected staged payload' }
$files = @{}
foreach ($name in $names) { $files[$name] = File-Hash ([IO.Path]::Combine($stage, $name)) }
$backup = [IO.Path]::Combine($install, '.previous-' + $Version)
if ([IO.File]::Exists($backup) -or [IO.Directory]::Exists($backup)) { throw 'Backup already exists' }
$null = [IO.Directory]::CreateDirectory($backup)
Write-NewJson ([IO.Path]::Combine($backup, '.cloudlink.json')) @{ managedBy = 'cloudlink'; kind = 'update-test-backup'; runId = $RunId }
$moved = [Collections.Generic.List[string]]::new()
$placed = [Collections.Generic.List[string]]::new()
try {
  foreach ($name in $names) {
    if ($previous.version) { Move-Retry ([IO.Path]::Combine($install, $name)) ([IO.Path]::Combine($backup, $name)); $moved.Add($name) }
    Move-Retry ([IO.Path]::Combine($stage, $name)) ([IO.Path]::Combine($install, $name)); $placed.Add($name)
  }
  $marker = [IO.Path]::Combine($install, '.cloudlink.json')
  Move-Retry $marker ([IO.Path]::Combine($backup, 'installation.json'))
  Write-NewJson $marker @{ managedBy = 'cloudlink'; kind = 'update-test-install'; runId = $RunId; productName = $product; identifier = $identifier; version = $Version; files = $files }
} catch {
  # Preserve failed files as evidence and restore only the files moved by this attempt.
  foreach ($name in $placed) { Move-Retry ([IO.Path]::Combine($install, $name)) ([IO.Path]::Combine($stage, $name)) }
  foreach ($name in $moved) { Move-Retry ([IO.Path]::Combine($backup, $name)) ([IO.Path]::Combine($install, $name)) }
  if ([IO.File]::Exists([IO.Path]::Combine($backup, 'installation.json')) -and -not [IO.File]::Exists([IO.Path]::Combine($install, '.cloudlink.json'))) {
    Move-Retry ([IO.Path]::Combine($backup, 'installation.json')) ([IO.Path]::Combine($install, '.cloudlink.json'))
  }
  throw
}
Write-NewJson ([IO.Path]::Combine($Root, 'receipts', 'installed-' + $Version + '.json')) @{ managedBy = 'cloudlink'; kind = 'update-test-install-receipt'; runId = $RunId; version = $Version; files = $files }
if ($Restart -eq 'true') {
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = [IO.Path]::Combine($install, 'cloudlink.exe')
  $info.WorkingDirectory = $Root
  $info.UseShellExecute = $false
  $info.EnvironmentVariables.Clear()
  foreach ($name in $environment.Keys) { $info.EnvironmentVariables[$name] = $environment[$name] }
  $child = [Diagnostics.Process]::Start($info)
  Write-NewJson ([IO.Path]::Combine($Root, 'receipts', 'reopened-' + $Version + '.json')) @{ managedBy = 'cloudlink'; kind = 'update-test-reopen-receipt'; runId = $RunId; version = $Version; pid = $child.Id; createdAt = $child.StartTime.ToUniversalTime().ToString('o') }
  $child.Dispose()
}
