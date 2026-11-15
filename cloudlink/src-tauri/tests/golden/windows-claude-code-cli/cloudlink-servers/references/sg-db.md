# sg-db — Singapore database

> Production | Mode: standard | Snapshot: 2026-10-28

## Connect
Pass exactly one quoted remote command after `--`; the stable ID maps to the private SSH configuration. Do not replace this entry with a direct alias:

    'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' exec --env 'windows' --asset 'ast_01JB3QSGDB' -- '<command>'

PowerShell:

    & 'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' exec --env 'windows' --asset 'ast_01JB3QSGDB' -- '<command>'
- System: Debian 12 | 2 vCPU / 4 GB RAM
- Role: PostgreSQL and Redis for the API

## Guardrails (must follow)
1. Never run DROP, TRUNCATE or DELETE without WHERE
2. Never stop or restart the `postgresql` service (critical)

## Key directories
| Key | Path | Purpose |
| --- | --- | --- |
| pg-data | `/var/lib/postgresql/16/main` | PostgreSQL data directory |

## Services
| Name | Kind | Image | Ports | Role | Critical |
| --- | --- | --- | --- | --- | --- |
| `postgresql` | systemd | - | - | Primary database | yes |
| `redis` | docker | `redis:7.4` | `127.0.0.1:6379->6379/tcp` | - | no |

## Single-file transfer
Only new destination paths, never overwrite, recurse, glob or resume. Upload is a write and binds the source digest; a changed source invalidates approval. Download refuses credential paths and follows no local links. Failure may leave remote partial data; do not delete user directories. The remote existence check is not an exclusive safe-publication guarantee.

    'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' put --env 'windows' --asset 'ast_01JB3QSGDB' -- '<localFile>' '<remoteFile>'
    'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' get --env 'windows' --asset 'ast_01JB3QSGDB' -- '<remoteFile>' '<localFile>'

Windows SFTP rejects remote braces (`{`, `}`) and backslashes before transfer because its batch parser cannot safely quote them. Choose a different new path, not a different execution tool.

PowerShell:

    & 'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' put --env 'windows' --asset 'ast_01JB3QSGDB' -- '<localFile>' '<remoteFile>'
    & 'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' get --env 'windows' --asset 'ast_01JB3QSGDB' -- '<remoteFile>' '<localFile>'

Live metrics such as free disk or memory are not recorded here; check them on the host when needed (e.g. `df -h`, `free -m`).
