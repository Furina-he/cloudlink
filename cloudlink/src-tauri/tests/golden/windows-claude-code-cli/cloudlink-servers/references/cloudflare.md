# cloudflare — Cloudflare

> Production | Mode: read-only

## Connect
- Run `wrangler <command>` in the local shell; it is already logged in. Never print or export its credentials.
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
