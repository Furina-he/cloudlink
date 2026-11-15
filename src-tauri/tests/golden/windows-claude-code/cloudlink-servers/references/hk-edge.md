# hk-edge — Hong Kong edge proxy node

> Production | Mode: read-only | Snapshot: 2026-10-27

## Connect
Pass exactly one quoted remote command after `--`; the stable ID maps to the private SSH configuration. Do not replace this entry with a direct alias:

    'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' exec --env 'windows' --asset 'ast_01JB3Q8Z6W' -- '<command>'

PowerShell:

    & 'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' exec --env 'windows' --asset 'ast_01JB3Q8Z6W' -- '<command>'
- System: Ubuntu 24.04 LTS | 2 vCPU / 2 GB RAM | managed by 1Panel (/opt/1panel)
- Role: Public reverse proxy for api.example.com and blog.example.com, and host for the backend API containers

## Guardrails (must follow)
1. Memory is only 2 GB — never run npm run build, cargo build or other memory-heavy builds on this host
2. After editing OpenResty config, run docker exec openresty nginx -t and reload only if it passes
3. Never stop or restart the `openresty` container (critical)

## Key directories
| Key | Path | Purpose |
| --- | --- | --- |
| nginx-conf | `/opt/1panel/apps/openresty/openresty/conf/conf.d` | OpenResty site configs |
| compose-root | `/opt/1panel/docker/compose` | Docker Compose projects |

## Services
| Name | Kind | Image | Ports | Role | Critical |
| --- | --- | --- | --- | --- | --- |
| `openresty` | docker | `openresty:1.21` | `0.0.0.0:443->443/tcp` | Main gateway and SSL termination | yes |

## Sites served
`api.example.com`, `blog.example.com`

## Single-file transfer
Only new destination paths, never overwrite, recurse, glob or resume. Upload is a write and binds the source digest; a changed source invalidates approval. Download refuses credential paths and follows no local links. Failure may leave remote partial data; do not delete user directories. The remote existence check is not an exclusive safe-publication guarantee.

    'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' put --env 'windows' --asset 'ast_01JB3Q8Z6W' -- '<localFile>' '<remoteFile>'
    'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' get --env 'windows' --asset 'ast_01JB3Q8Z6W' -- '<remoteFile>' '<localFile>'

Windows SFTP rejects remote braces (`{`, `}`) and backslashes before transfer because its batch parser cannot safely quote them. Choose a different new path, not a different execution tool.

PowerShell:

    & 'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' put --env 'windows' --asset 'ast_01JB3Q8Z6W' -- '<localFile>' '<remoteFile>'
    & 'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' get --env 'windows' --asset 'ast_01JB3Q8Z6W' -- '<remoteFile>' '<localFile>'

## Notes
- 2026-10-31: The API is deployed from /opt/1panel/docker/compose/api with `docker compose up -d --build`.

Live metrics such as free disk or memory are not recorded here; check them on the host when needed (e.g. `df -h`, `free -m`).
