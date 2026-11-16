# cloudflare — Cloudflare

> Production | Mode: confirm-changes

## Connect
Use separate CLI arguments after `--`, without the provider binary or a shell wrapper. Never print or export credentials:

    'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' exec --env 'windows' --asset 'ast_01JB9CLI01' -- <command arguments>

PowerShell:

    & 'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' exec --env 'windows' --asset 'ast_01JB9CLI01' -- <command arguments>
- Account: `me@example.com`
- Target this account on every command: set `CLOUDFLARE_ACCOUNT_ID` to the id of `me@example.com` from `wrangler whoami`.
- Role: DNS for the main domains and the edge API gateway Worker

## Scope
Only operate on these resources; ask the user before touching anything else in the account.

| Kind | Name | Linked server |
| --- | --- | --- |
| DNS zone | `example.com` | `hk-edge` |
| DNS zone | `example.org` | - |
| Worker | `api-gateway` | - |
