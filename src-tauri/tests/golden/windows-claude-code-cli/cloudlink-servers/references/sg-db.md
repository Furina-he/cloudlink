# sg-db — Singapore database

> Production | Mode: standard | Snapshot: 2026-10-28

## Connect
- `ssh sg-db '<command>'`
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

Live metrics such as free disk or memory are not recorded here; check them on the host when needed (e.g. `df -h`, `free -m`).
