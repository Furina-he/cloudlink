#!/bin/sh
set -eu

# Host keys belong to this disposable container, never to its build image.
if [ ! -f /etc/ssh/ssh_host_ed25519_key ]; then
  ssh-keygen -q -t ed25519 -N '' -f /etc/ssh/ssh_host_ed25519_key
fi
cat > /etc/ssh/sshd_config <<'CONFIG'
Port 2222
HostKey /etc/ssh/ssh_host_ed25519_key
PidFile /run/sshd.pid
PermitRootLogin no
PasswordAuthentication yes
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods any
AllowUsers cloudlink
AllowTcpForwarding no
AllowAgentForwarding no
X11Forwarding no
PermitTunnel no
PermitUserEnvironment no
PrintMotd no
Subsystem sftp internal-sftp
CONFIG

cat > /etc/nginx/nginx.conf <<'CONFIG'
user cloudlink;
pid /run/nginx.pid;
error_log /dev/stderr;
events { worker_connections 32; }
http {
  access_log /dev/stdout;
  server {
    listen 127.0.0.1:8080;
    location / { return 200 'cloudlink SSH target\n'; }
  }
}
CONFIG

nginx -g 'daemon off;' &
nginx_pid=$!
su-exec cloudlink redis-server --bind 127.0.0.1 --protected-mode yes --save '' --appendonly no &
redis_pid=$!
/usr/sbin/sshd -D -e &
sshd_pid=$!

cleanup() {
  kill "$sshd_pid" "$nginx_pid" "$redis_pid" 2>/dev/null || true
  wait "$sshd_pid" "$nginx_pid" "$redis_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 0' INT TERM
wait "$sshd_pid"
