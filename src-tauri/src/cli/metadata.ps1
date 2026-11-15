# Static metadata bridge. Auth output and OCI configuration never leave this process.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
# Reassert these after the login profiles, which can replace inherited environment values.
$env:WRANGLER_SEND_METRICS = 'false'
$env:WRANGLER_WRITE_LOGS = 'false'
$env:WRANGLER_LOG_SANITIZE = 'true'
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
function Get-ClCf([string]$path, $query) {
  if ($path -notmatch '^/zones$|^/zones/[a-fA-F0-9]{32}/dns_records$|^/accounts/[a-fA-F0-9]{32}/(workers/scripts|pages/projects)$') { Throw-Cl 'cli-scope-failed' }
  $pairs = @($query.GetEnumerator() | ForEach-Object { [Uri]::EscapeDataString([string]$_.Key) + '=' + [Uri]::EscapeDataString([string]$_.Value) })
  $url = 'https://api.cloudflare.com/client/v4' + $path + '?' + ($pairs -join '&')
  $request = [Net.HttpWebRequest]::CreateHttp($url)
  $request.Method = 'GET'
  $request.AllowAutoRedirect = $false
  $request.Timeout = (Get-ClTimeout) * 1000
  $request.ReadWriteTimeout = $request.Timeout
  foreach ($key in $clAuthHeaders.Keys) { $request.Headers[$key] = $clAuthHeaders[$key] }
  $request.Accept = 'application/json'
  try { $response = $request.GetResponse() }
  catch {
    $failedResponse = $_.Exception.Response
    try {
      if ($failedResponse -and [int]$failedResponse.StatusCode -in @(401,403)) { Throw-Cl 'cli-scope-permission' }
      if ($failedResponse -and [int]$failedResponse.StatusCode -eq 404 -and $path -match '^/accounts/[^/]+/(workers/scripts|pages/projects)$') {
        return @{success=$true;result=@();result_info=@{total_pages=1}}
      }
      Throw-Cl 'cli-scope-failed'
    } finally { if ($failedResponse) { $failedResponse.Dispose() } }
  }
  try {
    if ([int]$response.StatusCode -ne 200) { Throw-Cl 'cli-scope-failed' }
    $stream = $response.GetResponseStream()
    $memory = [IO.MemoryStream]::new()
    try {
      $buffer = New-Object byte[] 8192
      while (($count = $stream.Read($buffer,0,$buffer.Length)) -gt 0) {
        if ($memory.Length + $count -gt $clMaxBytes) { Throw-Cl 'cli-scope-failed' }
        $memory.Write($buffer,0,$count)
        Get-ClTimeout > $null
      }
      $body = [Text.Encoding]::UTF8.GetString($memory.ToArray())
      try { $data = ConvertFrom-Json -InputObject $body -ErrorAction Stop } catch { Throw-Cl 'cli-scope-failed' }
      if ($data.success -ne $true -or $data.result -isnot [array]) {
        if (@($data.errors | Where-Object { $_.code -in @(10000,10001,9103,9106,9109) }).Count) { Throw-Cl 'cli-scope-permission' }
        Throw-Cl 'cli-scope-failed'
      }
      return $data
    } finally { $memory.Dispose(); $stream.Dispose() }
  } finally { $response.Dispose() }
}
function Get-ClCfList([string]$path, $query) {
  $all = [Collections.Generic.List[object]]::new()
  for ($page=1; $page -le $clMaxPages; $page++) {
    $query.page=$page; $query.per_page=100
    $data=Get-ClCf $path $query
    foreach ($item in $data.result) {
      if ($all.Count -ge 1000) { Throw-Cl 'cli-scope-failed' }
      $all.Add($item)
    }
    $total=$data.result_info.total_pages
    if ($null -ne $total -and ([string]$total -notmatch '^[0-9]{1,16}$' -or [decimal]$total -gt 9007199254740991)) { Throw-Cl 'cli-scope-failed' }
    if (($null -ne $total -and $page -ge $total) -or ($null -eq $total -and @($data.result).Count -lt 100)) { return ,$all.ToArray() }
  }
  Throw-Cl 'cli-scope-failed'
}
try {
  if ($clOperation -eq 'discover') {
    $name = switch ($clProvider) { 'cloudflare' { 'wrangler' } 'vercel' { 'vercel' } 'oracle' { 'oci' } 'github' { 'gh' } default { Throw-Cl 'cli-command-unsupported' } }
    $found = Get-Command -Name $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $clResult = if ($found) { @{ installed=$true; path=$found.Source } } else { @{ installed=$false } }
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
      # `--json` exits 0 whatever the auth state and never includes the token (only
      # `--show-token` would). gh always acts as the active account, so only it counts.
      $run=Invoke-ClCapture @('auth','status','--json','hosts')
      $data=ConvertFrom-ClJson $run.raw
      if ($run.code -eq 0 -and $null -ne $data) {
        $active=@($data.hosts.'github.com' | Where-Object { $_.active -eq $true }) | Select-Object -First 1
        if ($null -eq $active) { $clResult=@{loggedIn=$false} }
        elseif ($active.state -in @('success','timeout') -and $active.login -is [string] -and $active.login -cmatch $clGhOwner) { $clResult=@{loggedIn=$true;login=$active.login} }
        else { $clResult=@{loggedIn=$false;expired=($active.state -eq 'refresh_expired')} }
      } elseif ($run.diagnostic -match 'unknown flag') {
        # Older gh without `auth status --json`: ask the API whose token is active.
        $run=Invoke-ClCapture @('api','user','--jq','.login')
        $login=$run.raw.Trim()
        if ($run.code -eq 0 -and $login -cmatch $clGhOwner) { $clResult=@{loggedIn=$true;login=$login} }
        elseif ($run.diagnostic -match '401|Bad credentials') { $clResult=@{loggedIn=$false;expired=$true} }
        elseif ($run.diagnostic -match 'gh auth login|not logged') { $clResult=@{loggedIn=$false} }
        else { Throw-Cl 'cli-scope-failed' }
      } elseif ($run.diagnostic -match 'gh auth login|not logged') { $clResult=@{loggedIn=$false} }
      else { Throw-Cl 'cli-command-unsupported' }
    } else {
      try {
        $data=if ($clProvider -eq 'cloudflare') { Invoke-ClJson @('whoami','--json') } else { Invoke-ClJson @('whoami','--format=json') }
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
        foreach ($project in $data.projects) { Add-ClItem @{id=$project.id;kind='project';name=(Clean-Cl $project.name)} }
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
      $auth=Invoke-ClJson @('auth','token','--json')
      if ($auth.type -in @('oauth','api_token') -and $auth.token -is [string] -and $auth.token -and $auth.token -notmatch '[\x00-\x1f\x7f]') {
        $clAuthHeaders=@{Authorization=('Bearer '+$auth.token)}
      } elseif ($auth.type -eq 'api_key' -and $auth.key -is [string] -and $auth.key -and $auth.email -is [string] -and $auth.email -and ($auth.key+$auth.email) -notmatch '[\x00-\x1f\x7f]') {
        $clAuthHeaders=@{'X-Auth-Key'=$auth.key;'X-Auth-Email'=$auth.email}
      } else { Throw-Cl 'cli-command-unsupported' }
      $auth=$null
      try {
        $zones=Get-ClCfList '/zones' @{'account.id'=$clAccount}
        foreach ($zone in $zones) {
          if ($zone.account.id -ne $clAccount -or $zone.id -notmatch '^[a-fA-F0-9]{32}$') { Throw-Cl 'cli-scope-failed' }
          $addresses=[Collections.Generic.List[string]]::new()
          foreach ($type in @('A','AAAA')) {
            $records=Get-ClCfList ('/zones/'+$zone.id+'/dns_records') @{type=$type}
            foreach ($record in $records) { if ($record.content -is [string] -and $record.content -and $addresses.Count -lt 500) { $addresses.Add($record.content) } }
          }
          Add-ClItem @{id=('zone:'+$zone.id);kind='zone';name=(Clean-Cl $zone.name);addresses=@($addresses.ToArray())}
        }
        # The scripts endpoint is SinglePage and ignores page/per_page.
        $workers=Get-ClCf ('/accounts/'+$clAccount+'/workers/scripts') @{}
        foreach ($worker in $workers.result) {
          $workerId=if ($worker.tag -is [string] -and $worker.tag) { $worker.tag } else { $worker.id }
          Add-ClItem @{id=('worker:'+$workerId);kind='worker';name=(Clean-Cl $worker.id)}
        }
        $pages=Get-ClCfList ('/accounts/'+$clAccount+'/pages/projects') @{}
        foreach ($project in $pages) { Add-ClItem @{id=('pages:'+$project.name);kind='pages';name=(Clean-Cl $project.name)} }
      } finally { $clAuthHeaders=$null }
    } elseif ($clProvider -eq 'github') {
      if ($clAccount -cnotmatch $clGhOwner) { Throw-Cl 'cli-account-unavailable' }
      $owners=[Collections.Generic.List[string]]::new(); $owners.Add($clAccount)
      # Organisation membership needs read:org; without it only the user's own repositories are listed.
      $run=Invoke-ClCapture @('api','--method','GET','user/orgs','-f','per_page=100','--jq','[.[].login]')
      if ($run.code -eq 0) {
        # Assign first: @() around the call would wrap the returned array instead of unrolling it.
        $orgs=ConvertFrom-ClJson $run.raw
        foreach ($org in @($orgs)) {
          if ($org -is [string] -and $org -cmatch $clGhOwner -and -not $owners.Contains($org) -and $owners.Count -lt 20) { $owners.Add($org) }
        }
      }
      $seen=[Collections.Generic.HashSet[string]]::new()
      foreach ($owner in $owners) {
        $run=Invoke-ClCapture @('repo','list',$owner,'--limit','200','--json','id,nameWithOwner,defaultBranchRef,visibility,isArchived')
        if ($run.code -ne 0) {
          # An organisation can hide its repositories (SSO, removed membership); keep the others.
          if ($owner -ne $clAccount -and $run.diagnostic -match '403|404|not found|Could not resolve|SAML') { continue }
          if ($run.diagnostic -match '401|Bad credentials|gh auth login') { Throw-Cl 'cli-scope-permission' }
          Throw-Cl 'cli-command-unsupported'
        }
        $repos=ConvertFrom-ClJson $run.raw
        if ($repos -isnot [array]) { Throw-Cl 'cli-command-unsupported' }
        foreach ($repo in $repos) {
          if ($repo.isArchived -eq $true) { continue }
          if ($repo.id -isnot [string] -or $repo.id -cnotmatch '^[A-Za-z0-9_=-]{1,64}$' -or $repo.nameWithOwner -isnot [string] -or $repo.nameWithOwner -cnotmatch '^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$') { Throw-Cl 'cli-scope-failed' }
          if (-not $seen.Add($repo.id)) { continue }
          if ($clItems.Count -ge $clMaxItems) { break }
          $item=@{id=('repo:'+$repo.id);kind='repo';name=$repo.nameWithOwner}
          $branch=$repo.defaultBranchRef.name
          if ($branch -is [string] -and $branch) { $branch=$branch -replace '[\x00-\x1f\x7f]',''; $item.defaultBranch=$branch.Substring(0,[Math]::Min(255,$branch.Length)) }
          if ($repo.visibility -cin @('PUBLIC','PRIVATE','INTERNAL')) { $item.visibility=$repo.visibility.ToLowerInvariant() }
          Add-ClItem $item
        }
        if ($clItems.Count -ge $clMaxItems) { break }
      }
    } else { Throw-Cl 'cli-command-unsupported' }
    $clResult=@{items=@($clItems.ToArray())}
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
