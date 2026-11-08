# github — GitHub

> Mode: read-only

## Connect
- Run `gh <command>` in the local shell; it is already logged in. Never print or export its credentials.
- Account: `octo`
- Commands run as the active `gh` account. If `gh auth status` shows an active account other than `octo`, stop and tell the user; never switch accounts.
- Role: Source for the shop front end and the API

## Repositories
Only operate on these repositories; ask the user before touching any other repository on the account.

| Repository | Default branch | Visibility |
| --- | --- | --- |
| `octo/shop-web` | `main` | private |
