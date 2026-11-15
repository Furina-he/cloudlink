# github — GitHub

> Mode: read-only

## Connect
- Run `gh <command>` in the local shell; it is already logged in. Never print or export its credentials.
- Host: `github.com`
- Owner: not verified; preserve the historical selection
- Effective `gh` login in this environment: not verified
- Snapshot: not verified. The owner is not the login identity; never switch accounts to expand access. A `gh` login does not identify SSH Git or custom Git credential helpers.
- Role: Source for the shop front end and the API

## Repositories
Manual scope: only the selected stable repository IDs represented below. Historical selections never expand automatically; an unverified owner must be confirmed in CloudLink, not inferred from names.
Partial, offline or denied refreshes preserve known history and cannot enlarge authorization. Refresh through this read-only metadata entry before relying on a new repository, changed identity or deployment relation; failure is not permission to switch accounts or broaden scope:

    'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' discover --env 'windows' --asset 'ast_01JB9CLI09'

PowerShell:

    & 'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' discover --env 'windows' --asset 'ast_01JB9CLI09'

| Repository | Default branch | Visibility |
| --- | --- | --- |
| `octo/shop-web` | `main` | private |

Deleting repositories, exporting credentials, or force-pushing the default/unspecified branch cannot be approved. Ordinary commits/pushes are not blanket-protected by CloudLink. Deployment relations are collected evidence, not additional authorization.
