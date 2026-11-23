# Development machine (dev-box)

> Mode: auto-ops

## Connect
Pass exactly one quoted remote command after `--`; the stable ID maps to the private SSH configuration. Do not replace this entry with a direct alias:

    'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' exec --env 'windows' --asset 'ast_01JB3QDEVB' -- '<command>'

PowerShell:

    & 'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' exec --env 'windows' --asset 'ast_01JB3QDEVB' -- '<command>'
- Role: Development machine

## Single-file transfer
Only new destination paths, never overwrite, recurse, glob or resume. Upload is a write and binds the source digest; a changed source invalidates approval. Download refuses credential paths and follows no local links. Failure may leave remote partial data; do not delete user directories. The remote existence check is not an exclusive safe-publication guarantee.

    'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' put --env 'windows' --asset 'ast_01JB3QDEVB' -- '<localFile>' '<remoteFile>'
    'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' get --env 'windows' --asset 'ast_01JB3QDEVB' -- '<remoteFile>' '<localFile>'

Windows SFTP rejects remote braces (`{`, `}`) and backslashes before transfer because its batch parser cannot safely quote them. Choose a different new path, not a different execution tool.

PowerShell:

    & 'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' put --env 'windows' --asset 'ast_01JB3QDEVB' -- '<localFile>' '<remoteFile>'
    & 'C:/Users/me/.cloudlink/bin/cloudlink-guard.exe' get --env 'windows' --asset 'ast_01JB3QDEVB' -- '<remoteFile>' '<localFile>'

Live metrics such as free disk or memory are not recorded here; check them on the host when needed (e.g. `df -h`, `free -m`).
