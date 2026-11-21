# Static metadata bridge. Auth output and OCI configuration never leave this process.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
# Reassert these after the login profiles, which can replace inherited environment values.
$env:CF_SEND_TELEMETRY = 'false'
$env:VERCEL_TELEMETRY_DISABLED = '1'
$env:DO_NOT_TRACK = '1'
$env:NO_COLOR = '1'
$env:CI = '1'
$env:GH_PROMPT_DISABLED = '1'
$env:GH_NO_UPDATE_NOTIFIER = '1'
$env:GH_NO_EXTENSION_UPDATE_NOTIFIER = '1'
$env:GH_SPINNER_DISABLED = '1'
$clStarted = [DateTime]::UtcNow
$clMaxItems = 500
$clMaxPages = 10
$clMaxBytes = 1048576
$clGhOwner = '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'
function Throw-Cl([string]$id) { throw $id }
# A CLI installed after CloudLink started is on the registry PATH, not on the one this process
# inherited. Inherited entries keep their order; the registry only adds what is missing.
function Get-ClSystemPath { @([Environment]::GetEnvironmentVariable('Path','Machine'),[Environment]::GetEnvironmentVariable('Path','User')) }
function Update-ClPath {
  try {
    $seen=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $env:Path=@((@($env:Path)+@(Get-ClSystemPath)) -join ';' -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $seen.Add($_.TrimEnd('\')) }) -join ';'
  } catch {}
}
function Get-ClTimeout {
  $left = 25 - ([DateTime]::UtcNow - $clStarted).TotalSeconds
  if ($left -le 0) { Throw-Cl 'cli-scope-failed' }
  return [Math]::Max(1,[Math]::Min(8,[int]$left))
}
function Clean-Cl($text) {
  if ($text -isnot [string]) { return '' }
  $text = $text -replace '[\x00-\x1f\x7f]',''
  return $text.Substring(0,[Math]::Min(128,$text.Length))
}
function Invoke-ClCapture([string[]]$arguments) {
  Get-ClTimeout > $null
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $stdout = [Text.StringBuilder]::new()
  $stderr = [Text.StringBuilder]::new()
  $size = 0
  try {
    # Native commands set the global variable. Assigning the bare name here would create
    # a function-local copy that hides every non-zero exit code.
    $global:LASTEXITCODE = 0
    & $clBinary @arguments 2>&1 | ForEach-Object {
      # Windows PowerShell emits native stderr as ErrorRecord objects. Mixing those
      # into stdout breaks valid JSON whenever a successful CLI prints a diagnostic.
      $line = [string]$_
      $size += [Text.Encoding]::UTF8.GetByteCount($line) + 1
      if ($size -gt $clMaxBytes) { Throw-Cl 'cli-scope-failed' }
      if ($_ -is [Management.Automation.ErrorRecord]) { [void]$stderr.AppendLine($line) }
      else { [void]$stdout.AppendLine($line) }
      Get-ClTimeout > $null
    }
    $code = $global:LASTEXITCODE
  }
  finally { $ErrorActionPreference = $old }
  $raw = $stdout.ToString()
  return @{code=$code; raw=$raw; diagnostic=($stderr.ToString() + $raw)}
}
function ConvertFrom-ClJson([string]$raw) {
  if (-not $raw.Trim()) { return $null }
  try { return ,(ConvertFrom-Json -InputObject $raw -ErrorAction Stop) } catch { return $null }
}
function Invoke-ClJson([string[]]$arguments, [bool]$allowUnavailable = $false) {
  $run = Invoke-ClCapture $arguments
  $code = $run.code
  $raw = $run.raw
  $data = ConvertFrom-ClJson $raw
  if ($code -ne 0) {
    $diagnostic = $run.diagnostic
    if ($clOperation -eq 'identity') {
      if ($data.loggedIn -eq $false -or $data.authenticated -eq $false) { return ,$data }
      if ($diagnostic -match 'not authenticated|not logged|log in|login|expired|401|invalid.*token|NotAuthenticated|config file|key file') {
        return @{authenticated=$false;expired=($diagnostic -match 'expired|401|invalid.*token')}
      }
    }
    # A visible OCI compartment can deny compute or network access. Omit only that
    # unavailable metadata; malformed responses and other failures still fail the query.
    if ($allowUnavailable -and $diagnostic -match '403|404|NotAuthorizedOrNotFound|NotFound') { return ,@() }
    if ($diagnostic -match 'permission|forbidden|403|unauthorized|401|NotAuthorized') { Throw-Cl 'cli-scope-permission' }
    Throw-Cl 'cli-command-unsupported'
  }
  if ($null -eq $data) { Throw-Cl 'cli-command-unsupported' }
  return ,$data
}
function Get-ClOciConfig {
  $file = if ($env:OCI_CLI_CONFIG_FILE) { $env:OCI_CLI_CONFIG_FILE }
    elseif ($env:CLOUDLINK_HOME) { Join-Path $env:CLOUDLINK_HOME '.oci/config' }
    else { Join-Path $env:USERPROFILE '.oci/config' }
  $script:clOciConfigFile = $file
  $profiles = [Collections.Specialized.OrderedDictionary]::new([StringComparer]::Ordinal)
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $profiles }
  if ((Get-Item -LiteralPath $file).Length -gt 262144) { Throw-Cl 'cli-scope-failed' }
  $section = $null
  foreach ($line in [IO.File]::ReadLines($file)) {
    if ($line -match '^\s*\[([A-Za-z0-9_][A-Za-z0-9_.-]{0,127})\]\s*(?:[#;].*)?$') {
      $section = $Matches[1]
      if (-not $profiles.Contains($section)) { $profiles[$section] = '' }
      if ($profiles.Count -gt 100) { Throw-Cl 'cli-scope-failed' }
    } elseif ($section -and $line -match '^\s*tenancy\s*=\s*(ocid1\.tenancy\.[A-Za-z0-9_.-]+)\s*$') {
      # Only the public tenancy OCID is retained, never user/key_file/pass_phrase fields.
      $profiles[$section] = $Matches[1]
    }
  }
  return $profiles
}
function Get-ClOciArgs([string[]]$arguments) {
  return @('--profile',$clAccount,'--config-file',$script:clOciConfigFile,'--output','json') + $arguments
}
function Add-ClItem($item) {
  if ($clItems.Count -ge $clMaxItems -or $item.id -isnot [string] -or -not $item.id -or $item.id.Length -gt 256 -or $item.id -match '[\x00-\x1f\x7f]' -or $item.name -isnot [string] -or -not $item.name) { Throw-Cl 'cli-scope-failed' }
  $clItems.Add($item)
}
function Get-ClNext($data, $previous, $seen) {
  $cursor = $data.pagination.next
  if ($null -eq $cursor) { return $null }
  if ([string]$cursor -notmatch '^[0-9]{1,16}$') { Throw-Cl 'cli-scope-failed' }
  $next = [Int64]$cursor
  if ($next -gt 9007199254740991 -or $next -eq $previous -or -not $seen.Add([string]$next)) { Throw-Cl 'cli-scope-failed' }
  return $next
}
function Project-ClIdentity($data) {
  $out = @{}
  foreach ($key in @('loggedIn','authenticated','expired')) { if ($data.$key -is [bool]) { $out[$key]=$data.$key } }
  foreach ($key in @('email','username')) { if ($data.$key -is [string]) { $out[$key]=Clean-Cl $data.$key } }
  if ($null -ne $data.accounts) {
    $out.accounts=@($data.accounts | Select-Object -First 100 | Where-Object { $_.id -is [string] -and $_.id -match '^[a-fA-F0-9]{32}$' } | ForEach-Object { @{id=$_.id;name=(Clean-Cl $_.name)} })
  }
  foreach ($key in @('team','globalTeam')) {
    if ($data.$key.id -is [string] -and $data.$key.id -match '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') { $out[$key]=@{id=$data.$key.id;slug=(Clean-Cl $data.$key.slug);name=(Clean-Cl $data.$key.name)} }
  }
  return $out
}
function Get-ClCfList([string[]]$arguments, [int]$size = 100) {
  $all = [Collections.Generic.List[object]]::new()
  # List commands return one JSON page; keep the same item ceiling across sizes.
  $limit = [Math]::Ceiling($clMaxPages * 100 / $size)
  for ($page=1; $page -le $limit; $page++) {
    $data=Invoke-ClJson ($arguments + @('--page',[string]$page,'--per-page',[string]$size))
    if ($data -isnot [array]) { Throw-Cl 'cli-command-unsupported' }
    if ($data.Count -eq 0) { return ,$all.ToArray() }
    foreach ($item in $data) {
      if ($all.Count -ge 1000) { Throw-Cl 'cli-scope-failed' }
      $all.Add($item)
    }
    if ($data.Count -lt $size) { return ,$all.ToArray() }
  }
  Throw-Cl 'cli-scope-failed'
}
function Project-ClGithubSource($source) {
  if ($null -eq $source -or $source.type -cnotin @('github','github-limited','github-custom-host')) { return $null }
  $hostName=if ($source.type -ceq 'github-custom-host') {$source.host} else {'github.com'}
  $owner=if ($source.org) {$source.org} else {$source.owner}
  $repo=if ($source.repo) {$source.repo} else {$source.repo_name}
  if ($repo -is [string] -and $repo.Contains('/') -and -not $owner) {
    $parts=$repo.Split('/'); if ($parts.Count -eq 2) {$owner=$parts[0];$repo=$parts[1]}
  }
  if ((-not $owner -or -not $repo) -and $source.url -is [string] -and $source.url -notmatch '[\s@%?#\\]' -and $source.url -cmatch '^https://([^/]+)/([^/]+)/([^/]+?)(?:\.git)?$') {
    $hostName=$Matches[1];$owner=$Matches[2];$repo=$Matches[3]
  }
  if ($hostName -isnot [string] -or $hostName.Length -gt 253 -or $hostName -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$' -or $hostName.Contains('..') -or $owner -isnot [string] -or $owner -cnotmatch $clGhOwner -or $repo -isnot [string] -or $repo -cnotmatch '^[A-Za-z0-9._-]{1,100}$' -or $repo -in @('.','..')) { return $null }
  $result=@{host=$hostName.ToLowerInvariant();owner=$owner;repo=$repo}
  $id=if ($null -ne $source.repoId) {$source.repoId} else {$source.repo_id}
  if (($id -is [string] -or $id -is [int] -or $id -is [long] -or $id -is [decimal] -or $id -is [double]) -and [string]$id -cmatch '^[0-9]{1,20}$|^repo:[A-Za-z0-9_=-]{1,128}$') { $result.repoId=[string]$id }
  return $result
}
# GitHub uses the effective API identity, including environment-token precedence.
# Only these fixed endpoints run; response bodies and credentials never leave the bridge.
function Get-ClGhHost {
  $hostName = if ($clHost) { [string]$clHost } else { 'github.com' }
  if ($hostName.Length -gt 253 -or $hostName -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$' -or $hostName.Contains('..')) { Throw-Cl 'invalid-host' }
  return $hostName.ToLowerInvariant()
}
function Get-ClGhApi([string]$endpoint) {
  $run = Invoke-ClCapture @('api','--hostname',(Get-ClGhHost),'--method','GET',$endpoint)
  if ($run.code -ne 0) {
    if ($run.diagnostic -match 'rate.?limit|429') { Throw-Cl 'rate-limited' }
    if ($run.diagnostic -match '401|403|404|Bad credentials|not found|SAML|forbidden|not logged|gh auth login') { Throw-Cl 'permission-denied' }
    Throw-Cl 'offline'
  }
  $data = ConvertFrom-ClJson $run.raw
  if ($null -eq $data) { Throw-Cl 'invalid-metadata' }
  return ,$data
}
function Project-ClGhOwner($data) {
  if ($data.node_id -isnot [string] -or $data.node_id -cnotmatch '^[A-Za-z0-9_=-]{1,128}$' -or $data.login -isnot [string] -or $data.login -cnotmatch $clGhOwner -or $data.type -cnotin @('User','Organization')) { Throw-Cl 'invalid-metadata' }
  return @{id=$data.node_id;login=$data.login;kind=$(if ($data.type -ceq 'User') { 'user' } else { 'organization' })}
}
function Get-ClGhIdentity {
  $owner = Project-ClGhOwner (Get-ClGhApi 'user')
  if ($owner.kind -ne 'user') { Throw-Cl 'permission-denied' }
  return @{id=$owner.id;login=$owner.login;host=(Get-ClGhHost)}
}
function Get-ClGhPages([string]$endpoint, $owner, [int]$maximum) {
  $items=[Collections.Generic.List[object]]::new(); $seen=[Collections.Generic.HashSet[string]]::new()
  for ($page=1; $page -le 6; $page++) {
    $separator=if ($endpoint.Contains('?')) { '&' } else { '?' }
    $data=Get-ClGhApi ($endpoint+$separator+'per_page=100&page='+$page)
    if ($data -isnot [array]) { Throw-Cl 'invalid-metadata' }
    foreach ($raw in $data) {
      if ($null -eq $owner) { $item=Project-ClGhOwner $raw }
      else {
        $repoOwner=Project-ClGhOwner $raw.owner
        if ($repoOwner.id -cne $owner.id -or $repoOwner.login -ine $owner.login) { Throw-Cl 'owner-changed' }
        if ($raw.node_id -isnot [string] -or $raw.node_id -cnotmatch '^[A-Za-z0-9_=-]{1,128}$' -or $raw.full_name -isnot [string] -or $raw.full_name -cnotmatch '^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$' -or $raw.full_name.Split('/')[0] -ine $owner.login) { Throw-Cl 'invalid-metadata' }
        $item=@{id=('repo:'+$raw.node_id);kind='repo';name=$raw.full_name;ownerId=$owner.id;selected=$false}
        if (($raw.id -is [int] -or $raw.id -is [long] -or $raw.id -is [decimal] -or $raw.id -is [double]) -and [string]$raw.id -cmatch '^[0-9]{1,20}$') {$item.databaseId=[string]$raw.id}
        $branch=$raw.default_branch
        if ($branch -is [string] -and $branch -and $branch.Length -le 255 -and $branch -notmatch '[\x00-\x20\x7f`|\\~^:?*\[]') { $item.defaultBranch=$branch }
        if ($raw.visibility -cin @('public','private','internal')) { $item.visibility=$raw.visibility }
        elseif ($raw.private -is [bool]) { $item.visibility=$(if ($raw.private) { 'private' } else { 'public' }) }
      }
      if (-not $seen.Add($item.id) -or $items.Count -ge $maximum) { Throw-Cl 'pagination-incomplete' }
      $items.Add($item)
    }
    if ($data.Count -lt 100) { return ,$items.ToArray() }
  }
  Throw-Cl 'pagination-incomplete'
}
function Get-ClGithub {
  $result=@{status='complete';owners=@();items=@()}
  try {
    $identity=Get-ClGhIdentity; $result.identity=$identity
    $personal=@{id=$identity.id;login=$identity.login;kind='user'}; $result.owners=@($personal)
    if (-not $clAccount) {
      $orgs=Get-ClGhPages 'user/orgs' $null 100
      $result.owners=@($personal)+@($orgs)
    } else {
      if ($clAccount -cnotmatch $clGhOwner) { Throw-Cl 'invalid-owner' }
      $owner=Project-ClGhOwner (Get-ClGhApi ('users/'+$clAccount))
      if ($owner.kind -eq 'user' -and $owner.id -cne $identity.id) { Throw-Cl 'permission-denied' }
      $result.owner=$owner
      if ($owner.id -cne $personal.id) { $result.owners+=@($owner) }
      $endpoint=if ($owner.kind -eq 'user') { 'user/repos?affiliation=owner' } else { 'orgs/'+$owner.login+'/repos?type=all' }
      $result.items=Get-ClGhPages $endpoint $owner $clMaxItems
    }
    $after=Get-ClGhIdentity
    if ($after.id -cne $identity.id -or $after.login -cne $identity.login) { Throw-Cl 'identity-changed' }
  } catch {
    $reason=$_.Exception.Message
    $result.status=if ($reason -in @('permission-denied','identity-changed','invalid-owner')) { 'denied' } elseif ($reason -in @('pagination-incomplete','rate-limited','invalid-metadata','owner-changed','cli-scope-failed')) { 'partial' } else { 'offline' }
    $result.reasonId=if ($reason -in @('permission-denied','identity-changed','invalid-owner','pagination-incomplete','rate-limited','invalid-metadata','owner-changed','offline')) { $reason } else { 'offline' }
    $result.items=@()
  }
  return $result
}
try {
  Update-ClPath
  if ($clProvider -eq 'github' -and $clOperation -in @('github-scope','github-owners')) {
    $clResult=Get-ClGithub
  } elseif ($clOperation -eq 'discover') {
    $name = switch ($clProvider) { 'cloudflare' { 'cf' } 'vercel' { 'vercel' } 'oracle' { 'oci' } 'github' { 'gh' } default { Throw-Cl 'cli-command-unsupported' } }
    $found = Get-Command -Name $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $node = Get-Command -Name node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $nodeVersion = if ($node) { (& $node.Source --version 2>&1 | Out-String).Trim() } else { '' }
    $clResult = if ($found) { @{ installed=$true; path=$found.Source; nodeVersion=$nodeVersion } } else { @{ installed=$false; nodeVersion=$nodeVersion } }
  } elseif ($clOperation -eq 'version') {
    $old=$ErrorActionPreference; $ErrorActionPreference='Continue'
    try { $text=(& $clBinary --version 2>&1 | Out-String) } finally { $ErrorActionPreference=$old }
    $clResult=@{version=[regex]::Match($text,'\b[0-9]+\.[0-9]+(?:\.[0-9]+){0,2}\b').Value}
  } elseif ($clProvider -eq 'oracle' -and $clOperation -eq 'profiles') {
    $profiles=Get-ClOciConfig
    $names=@($profiles.Keys)
    if ($profiles.Contains('DEFAULT')) { $names=@('DEFAULT') + @($names | Where-Object { $_ -ne 'DEFAULT' }) }
    $clResult=@{profiles=$names}
  } elseif ($clOperation -eq 'identity') {
    if ($clProvider -eq 'oracle') {
      $profiles=Get-ClOciConfig
      if ($clAccount -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$' -or -not $profiles.Contains($clAccount)) { Throw-Cl 'cli-account-unavailable' }
      try {
        $checked=Invoke-ClJson (Get-ClOciArgs @('iam','region','list','--query','data[].name'))
        $clResult=if ($checked.authenticated -eq $false) { $checked } else { @{authenticated=$true; expired=$false} }
      } catch { $clResult=@{authenticated=$false; expired=$false} }
    } elseif ($clProvider -eq 'github') {
      try {
        $identity=Get-ClGhIdentity
        $clResult=@{loggedIn=$true;login=$identity.login;identity=$identity}
      } catch {
        if ($_.Exception.Message -eq 'permission-denied') { $clResult=@{loggedIn=$false;expired=$true} }
        else { Throw-Cl 'cli-scope-failed' }
      }
    } else {
      try {
        $data=if ($clProvider -eq 'cloudflare') { Invoke-ClJson @('auth','whoami','--json') } else { Invoke-ClJson @('whoami','--format=json') }
        $clResult=Project-ClIdentity $data
        if ($clProvider -eq 'vercel' -and $clResult.loggedIn -ne $false -and $clResult.authenticated -ne $false) {
          $teams=[Collections.Specialized.OrderedDictionary]::new([StringComparer]::Ordinal); $seen=[Collections.Generic.HashSet[string]]::new(); $next=$null
          for ($page=0; $page -lt $clMaxPages; $page++) {
            $arguments=@('teams','list','--format=json','--limit','100')
            if ($null -ne $next) { $arguments+=@('--next',[string]$next) }
            $listed=Invoke-ClJson $arguments
            if ($listed.teams -isnot [array]) { Throw-Cl 'cli-command-unsupported' }
            foreach ($team in $listed.teams) {
              if ($team.id -isnot [string] -or $team.id -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') { Throw-Cl 'cli-scope-failed' }
              $teams[$team.id]=@{id=$team.id;slug=(Clean-Cl $team.slug);name=(Clean-Cl $team.name);current=($team.current -eq $true)}
              if ($teams.Count -gt 100) { Throw-Cl 'cli-scope-failed' }
            }
            $next=Get-ClNext $listed $next $seen
            if ($null -eq $next) { break }
            if ($page -eq $clMaxPages-1) { Throw-Cl 'cli-scope-failed' }
          }
          $clResult.teams=@($teams.Values)
        }
      } catch {
        if ($_.Exception.Message -eq 'cli-scope-permission') { $clResult=@{authenticated=$false;expired=$true} }
        else { throw }
      }
    }
  } elseif ($clOperation -eq 'scope') {
    $clItems=[Collections.Generic.List[object]]::new()
    if ($clProvider -eq 'vercel') {
      if ($clAccount -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') { Throw-Cl 'cli-account-unavailable' }
      $next=$null; $seen=[Collections.Generic.HashSet[string]]::new()
      for ($page=0; $page -lt $clMaxPages; $page++) {
        $arguments=@('project','list','--scope',$clAccount,'--format=json','--limit','100')
        if ($null -ne $next) { $arguments+=@('--next',[string]$next) }
        $data=Invoke-ClJson $arguments
        if ($data.projects -isnot [array]) { Throw-Cl 'cli-command-unsupported' }
        foreach ($project in $data.projects) {
          $source=if ($project.link) {$project.link} else {$project.gitRepository}
          $repoSource=Project-ClGithubSource $source
          $item=@{id=$project.id;kind='project';name=(Clean-Cl $project.name)}
          if ($null -ne $repoSource) {$item.repoSource=$repoSource}
          Add-ClItem $item
        }
        $next=Get-ClNext $data $next $seen
        if ($null -eq $next) { break }
        if ($page -eq $clMaxPages-1) { Throw-Cl 'cli-scope-failed' }
      }
    } elseif ($clProvider -eq 'oracle') {
      if ($clAccount -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$') { Throw-Cl 'cli-account-unavailable' }
      $profiles=Get-ClOciConfig
      if (-not $profiles.Contains($clAccount)) { Throw-Cl 'cli-account-unavailable' }
      $tenancy=$profiles[$clAccount]
      if (-not $tenancy -and $profiles.Contains('DEFAULT')) { $tenancy=$profiles['DEFAULT'] }
      if (-not $tenancy) { Throw-Cl 'cli-scope-failed' }
      $compartments=Invoke-ClJson (Get-ClOciArgs @('iam','compartment','list','--compartment-id',$tenancy,'--access-level','ACCESSIBLE','--compartment-id-in-subtree','true','--all','--query','data[].id'))
      if ($compartments -isnot [array]) { Throw-Cl 'cli-command-unsupported' }
      $ids=@($tenancy) + @($compartments)
      if ($ids.Count -gt 100) { Throw-Cl 'cli-scope-failed' }
      $seen=[Collections.Generic.HashSet[string]]::new()
      foreach ($compartment in $ids) {
        if ($compartment -notmatch '^ocid1\.(tenancy|compartment)\.[A-Za-z0-9_.-]+$') { Throw-Cl 'cli-scope-failed' }
        # PS 5.1 removes inner quotes from native argv. Select the data array and
        # project dashed field names locally instead of passing quoted JMESPath.
        $instances=Invoke-ClJson (Get-ClOciArgs @('compute','instance','list','--compartment-id',$compartment,'--all','--query','data')) $true
        if ($instances -isnot [array]) { Throw-Cl 'cli-command-unsupported' }
        foreach ($instance in $instances) {
          if ($instance.id -notmatch '^ocid1\.instance\.[A-Za-z0-9_.-]+$') { Throw-Cl 'cli-scope-failed' }
          if ($instance.'lifecycle-state' -eq 'TERMINATED' -or -not $seen.Add($instance.id)) { continue }
          $vnics=Invoke-ClJson (Get-ClOciArgs @('compute','instance','list-vnics','--instance-id',$instance.id,'--all','--query','data')) $true
          if ($vnics -isnot [array]) { Throw-Cl 'cli-command-unsupported' }
          $publicIps=@($vnics | Where-Object { $_.'public-ip' -is [string] -and $_.'public-ip' } | ForEach-Object { $_.'public-ip' })
          $address=$null
          if ($publicIps.Count) { $address=$publicIps[0] }
          Add-ClItem @{id=$instance.id;kind='instance';name=(Clean-Cl $instance.'display-name');address=$address}
          Get-ClTimeout > $null
        }
      }
    } elseif ($clProvider -eq 'cloudflare') {
      if ($clAccount -notmatch '^[a-fA-F0-9]{32}$') { Throw-Cl 'cli-account-unavailable' }
      $env:CLOUDFLARE_ACCOUNT_ID = $clAccount
      $dnsReadable=$true
      $zones=Get-ClCfList @('zones','list','--account-id',$clAccount)
      foreach ($zone in $zones) {
        if ($zone.id -notmatch '^[a-fA-F0-9]{32}$' -or -not $zone.name -or ($zone.account -and $zone.account.id -and $zone.account.id -cne $clAccount)) { Throw-Cl 'cli-scope-failed' }
        $addresses=[Collections.Generic.List[string]]::new()
        if ($dnsReadable) {
          try {
            foreach ($type in @('A','AAAA')) {
              $records=Get-ClCfList @('dns','records','list','--zone',$zone.id,'--type',$type)
              foreach ($record in $records) { if ($record.content -is [string] -and $record.content -and $addresses.Count -lt 500) { $addresses.Add($record.content) } }
            }
          } catch {
            # Addresses only link a zone to a recorded server. A login that lists zones but
            # may not read their records keeps its catalog.
            if ($_.Exception.Message -ne 'cli-scope-permission') { throw }
            $dnsReadable=$false
          }
        }
        Add-ClItem @{id=('zone:'+$zone.id);kind='zone';name=(Clean-Cl $zone.name);addresses=@($addresses.ToArray())}
      }
      $workers=Get-ClCfList @('workers','list')
      foreach ($worker in $workers) {
        if (-not $worker.id -and -not $worker.name) { Throw-Cl 'cli-scope-failed' }
        $workerId=if ($worker.id) { $worker.id } else { $worker.name }
        $workerName=if ($worker.name) { $worker.name } else { $worker.id }
        Add-ClItem @{id=('worker:'+$workerId);kind='worker';name=(Clean-Cl $workerName)}
      }
      # The Pages API rejects per_page above 10 (400 Invalid list options), unlike the
      # Zones, DNS and Workers endpoints.
      $pages=Get-ClCfList @('pages','list') -size 10
      foreach ($project in $pages) {
        if (-not $project.name) { Throw-Cl 'cli-scope-failed' }
        $source=$project.source.config
        $repoSource=if ($project.source.type -ceq 'github') {Project-ClGithubSource @{type='github';owner=$source.owner;repo_name=$source.repo_name;repo_id=$source.repo_id}} else {$null}
        $item=@{id=('pages:'+$project.name);kind='pages';name=(Clean-Cl $project.name)}
        if ($null -ne $repoSource) {$item.repoSource=$repoSource}
        Add-ClItem $item
      }
    } elseif ($clProvider -eq 'github') {
      $clResult=Get-ClGithub
    } else { Throw-Cl 'cli-command-unsupported' }
    if ($clProvider -ne 'github') { $clResult=@{items=@($clItems.ToArray())} }
  } else { Throw-Cl 'cli-command-unsupported' }
  [Console]::WriteLine('__CLOUDLINK_CLI_METADATA__')
  [Console]::WriteLine((ConvertTo-Json -InputObject $clResult -Depth 8 -Compress))
} catch {
  $id=$_.Exception.Message
  if ($id -notin @('cli-account-unavailable','cli-scope-permission','cli-command-unsupported','cli-scope-failed')) { $id='cli-scope-failed' }
  [Console]::WriteLine('__CLOUDLINK_CLI_METADATA__')
  [Console]::WriteLine((ConvertTo-Json -InputObject @{error=$id} -Compress))
  exit 1
}
