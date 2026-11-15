// Fixed bridges are exercised with subprocess functions injected in memory. No gh,
// login profiles, real HOME, repository, credentials or network calls are permitted.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const marker = 'credential-must-stay-private';
const pythonSource = readFileSync(join(__dirname, 'github.py'), 'utf8');
const psSource = readFileSync(join(__dirname, 'metadata.ps1'), 'utf8');

function python(operation, owner, mode) {
  const script = `
import json, subprocess, sys, os
from unittest.mock import patch
SOURCE=${JSON.stringify(pythonSource)}
MODE=${JSON.stringify(mode)}
OWNER=${JSON.stringify(owner)}
MARKER=${JSON.stringify(marker)}
user={'node_id':'U1','login':'user','type':'User','token':MARKER}
org={'node_id':'O1','login':'acme','type':'Organization','token':MARKER}
def reply(args,data=None,code=0,stderr=''):
    return subprocess.CompletedProcess(args,code,json.dumps(data).encode(),stderr.encode())
def fake(args, **kwargs):
    assert args[:6] == ['/isolated/gh','api','--hostname','github.com','--method','GET']
    endpoint=args[6]
    if endpoint=='user': return reply(args,user)
    if endpoint=='users/acme': return reply(args,org)
    if endpoint=='users/user': return reply(args,user)
    if endpoint.startswith('user/orgs?'): return reply(args,[org])
    if endpoint.startswith('user/repos?') and 'type=' in endpoint: return reply(args,code=1,stderr='HTTP 422: type cannot be combined with affiliation')
    if MODE=='denied': return reply(args,code=1,stderr='403 '+MARKER)
    if MODE=='offline': raise subprocess.TimeoutExpired(args,1)
    page=int(endpoint.rsplit('page=',1)[1])
    if MODE=='rate' and page==2: return reply(args,code=1,stderr='API rate limit exceeded '+MARKER)
    count=100 if page==1 and MODE in ('pages','rate','overflow') or MODE=='overflow' else 1
    repos=[]
    for i in range(count):
        n=(page-1)*100+i
        repos.append({'node_id':'R'+str(n),'full_name':('user' if OWNER=='user' else 'acme')+'/repo'+str(n), 'owner':user if OWNER=='user' else org,'private':True,'visibility':'private','default_branch':'main','archived':True,'token':MARKER})
    return reply(args,repos)
sys.argv=['bridge',${JSON.stringify(operation)},'github','/isolated/gh',OWNER,'github.com']
with patch.dict(os.environ,{},clear=True), patch('subprocess.run',fake):
    exec(compile(SOURCE,'github.py','exec'),{'__name__':'__main__'})
`;
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-I', '-c', script], { encoding: 'utf8', timeout: 8000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal((result.stdout + result.stderr).includes(marker), false);
  return JSON.parse(result.stdout.split('__CLOUDLINK_CLI_METADATA__').at(-1).trim());
}

function powershell(owner, mode, source = psSource) {
  const at = source.search(/\r?\ntry \{\r?\n  if \(/);
  assert.ok(at > 0);
  const fake = `
$clOperation='github-scope';$clProvider='github';$clBinary='ClFake';$clAccount='${owner}';$clHost='github.com';$script:mode='${mode}'
function ClFake {
  if (($args[0..4] -join ' ') -ne 'api --hostname github.com --method GET') { throw 'unsafe-call' }
  $endpoint=$args[5]
  $user=@{node_id='U1';login='user';type='User';token='${marker}'}
  $org=@{node_id='O1';login='acme';type='Organization';token='${marker}'}
  if ($endpoint -eq 'user' -or $endpoint -eq 'users/user') { $user | ConvertTo-Json -Compress;return }
  if ($endpoint -eq 'users/acme') { $org | ConvertTo-Json -Compress;return }
  if ($endpoint -like 'user/orgs?*') { ConvertTo-Json -InputObject @($org) -Compress;return }
  if ($endpoint -like 'user/repos?*' -and $endpoint.Contains('type=')) {$global:LASTEXITCODE=1;Write-Error 'HTTP 422: type cannot be combined with affiliation' -ErrorAction Continue;return}
  if ($script:mode -eq 'denied') { $global:LASTEXITCODE=1; Write-Error '403 ${marker}' -ErrorAction Continue;return }
  $page=[int]($endpoint -replace '^.*page=','')
  if ($script:mode -eq 'rate' -and $page -eq 2) { $global:LASTEXITCODE=1;Write-Error 'API rate limit exceeded ${marker}' -ErrorAction Continue;return }
  $count=if (($page -eq 1 -and $script:mode -in @('pages','rate','overflow')) -or $script:mode -eq 'overflow') {100} else {1}
  $repoOwner=if ($clAccount -eq 'user') {$user} else {$org}
  $repos=@(0..($count-1) | ForEach-Object {
    $n=($page-1)*100+$_
    @{node_id=('R'+$n);full_name=($repoOwner.login+'/repo'+$n);owner=$repoOwner;private=$true;visibility='private';default_branch='main';archived=$true;token='${marker}'}
  })
  ConvertTo-Json -InputObject $repos -Depth 5 -Compress
}
`;
  const script = source.slice(0, at) + '\n' + fake + '\n' + source.slice(at);
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { encoding:'utf8',timeout:8000,env:{...process.env,CLOUDLINK_HOME:'D:/isolated-github-bridge'} });
  assert.equal(result.error, undefined);
  assert.equal((result.stdout+result.stderr).includes(marker), false);
  return JSON.parse(result.stdout.split('__CLOUDLINK_CLI_METADATA__').at(-1).trim());
}

for (const [name, bridge, options] of [
  ['Python', (owner, mode) => python('github-scope', owner, mode), {}],
  ['Windows', powershell, { skip: process.platform !== 'win32' }],
]) {
  test(name+' scopes one organization without conflating the effective user and owner', options, () => {
    const result=bridge('acme','normal');
    assert.equal(result.status,'complete');
    assert.equal(result.identity.id,'U1');
    assert.equal(result.owner.id,'O1');
    assert.equal(result.items.length,1);
    assert.deepEqual(result.items[0],{id:'repo:R0',kind:'repo',name:'acme/repo0',ownerId:'O1',defaultBranch:'main',visibility:'private',selected:false});
  });
  test(name+' fully follows pagination and includes private archived repositories', options, () => {
    const result=bridge('user','pages');
    assert.equal(result.status,'complete');
    assert.equal(result.items.length,101);
    assert.equal(result.items[100].id,'repo:R100');
    assert.equal(result.items.every(item=>item.name.startsWith('user/')),true);
  });
  test(name+' permission and rate-limit failure never publish partial additions', options, () => {
    const denied=bridge('acme','denied');
    assert.equal(denied.status,'denied');
    assert.equal(denied.reasonId,'permission-denied');
    assert.deepEqual(denied.items,[]);
    const limited=bridge('acme','rate');
    assert.equal(limited.status,'partial');
    assert.equal(limited.reasonId,'rate-limited');
    assert.deepEqual(limited.items,[]);
  });
  test(name+' a bounded catalog does not silently claim completeness', options, () => {
    const result=bridge('acme','overflow');
    assert.equal(result.status,'partial');
    assert.equal(result.reasonId,'pagination-incomplete');
    assert.deepEqual(result.items,[]);
  });
}

test('Windows bridge injection accepts LF and CRLF checkouts', { skip: process.platform !== 'win32' }, () => {
  const lf = psSource.replace(/\r\n/g, '\n');
  for (const source of [lf, lf.replace(/\n/g, '\r\n')]) {
    const result = powershell('acme', 'normal', source);
    assert.equal(result.status, 'complete');
    assert.equal(result.owner.id, 'O1');
  }
});

test('Python owner discovery is separate from scope and authentication uses the effective API user', () => {
  const result=python('github-owners','','normal');
  assert.deepEqual(result.owners,[{id:'U1',login:'user',kind:'user'},{id:'O1',login:'acme',kind:'organization'}]);
  assert.deepEqual(result.items,[]);
  assert.equal(python('identity','','normal').identity.id,'U1');
});

test('Python offline query is an explicit failed snapshot, not an empty complete scope', () => {
  const result=python('github-scope','acme','offline');
  assert.equal(result.status,'offline');
  assert.deepEqual(result.items,[]);
});
