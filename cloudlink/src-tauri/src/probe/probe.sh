#!/bin/sh
# CloudLink probe v1. Read-only, POSIX sh, no sudo and no credential reads.
# Every section reports its own exit status; a failed section never implies absence.
finish() { printf '@@status %s %s\n' "$1" "$2"; }

printf '@@os\n'
cat /etc/os-release
finish os "$?"

printf '@@kernel\n'
uname -srm
finish kernel "$?"

printf '@@cpu\n'
if command -v nproc >/dev/null 2>&1; then
    nproc
else
    getconf _NPROCESSORS_ONLN
fi
finish cpu "$?"

printf '@@mem\n'
if [ -r /proc/meminfo ]; then
    while IFS=' ' read -r key value unit rest; do
        if [ "$key" = 'MemTotal:' ]; then
            printf 'MemTotal: %s kB\n' "$value"
            break
        fi
    done < /proc/meminfo
    finish mem 0
else
    finish mem 1
fi

printf '@@disk\n'
df -P -k /
finish disk "$?"

printf '@@tools\n'
for tool in nginx openresty docker pm2 1pctl bt caddy; do
    command -v "$tool" 2>/dev/null || :
done
finish tools 0

printf '@@panel\n'
if [ -d /opt/1panel ]; then
    printf '1panel\t/opt/1panel\n'
elif [ -d /www/server/panel ]; then
    printf 'bt\t/www/server/panel\n'
fi
finish panel 0

printf '@@docker\n'
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'
finish docker "$?"

printf '@@systemd\n'
systemctl list-units --type=service --state=running --no-legend --plain
finish systemd "$?"

printf '@@listen\n'
if command -v ss >/dev/null 2>&1; then
    ss -H -tln
else
    netstat -tln
fi
finish listen "$?"
