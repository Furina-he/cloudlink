# GitHub

> Mode: confirm-changes

## Connect
Use separate CLI arguments after `--`, without the provider binary or a shell wrapper. Never print or export credentials:

    'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' exec --env 'windows' --asset 'ast_01JB9CLI09' -- <command arguments>

PowerShell:

    & 'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' exec --env 'windows' --asset 'ast_01JB9CLI09' -- <command arguments>
- Host: `github.com`
- Owner: not verified; preserve the historical selection
- Effective `gh` login in this environment: not verified
- Snapshot: not verified. The owner is not the login identity; never switch accounts to expand access. A `gh` login does not identify SSH Git or custom Git credential helpers.
- Role: Source for the shop front end and the API

## Repositories
Manual scope: only the selected stable repository IDs represented below. Historical selections never expand automatically; an unverified owner must be confirmed in CloudLink, not inferred from names.
A valid login does not mean the repository scope was completely verified. Partial, offline or denied refreshes preserve known history and cannot enlarge authorization. Refresh through this read-only metadata entry before relying on a new repository, changed identity or deployment relation; failure is not permission to switch accounts or broaden scope:

    'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' discover --env 'windows' --asset 'ast_01JB9CLI09'

PowerShell:

    & 'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' discover --env 'windows' --asset 'ast_01JB9CLI09'

| Repository | Default branch | Visibility |
| --- | --- | --- |
| `octo/shop-web` | `main` | private |

Deleting repositories, exporting credentials, or force-pushing the default/unspecified branch cannot be approved. Ordinary commits/pushes are not blanket-protected by CloudLink. Deployment relations are collected evidence, not additional authorization.
For the specifically checked high-risk Git operations, use `--tool git` and explicit Git arguments/branch; the runner verifies the actual push remote and repository. This is not an arbitrary local-program runner:

    'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' exec --env 'windows' --asset 'ast_01JB9CLI09' --tool git -- <git arguments>

PowerShell:

    & 'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' exec --env 'windows' --asset 'ast_01JB9CLI09' --tool git -- <git arguments>
