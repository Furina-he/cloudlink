"""Materialize the reviewed literal command fixtures; NEVER execute their contents."""
import json
from pathlib import Path

cases = []


def add(mode, expect, commands, category):
    for command in commands:
        cases.append({"id": f"{category}-{len(cases) + 1:03}", "mode": mode,
                      "command": command, "expect": expect})


def ssh(commands):
    return ["ssh hk-edge '" + command.replace("'", "'\"'\"'") + "'" for command in commands]


add("read-only", "allowed", ssh([
    "uptime", "nproc", "free -m", "free -h", "df -hP -x tmpfs -x devtmpfs -x overlay -x squashfs",
    "du -sh /opt/apps", "ls -la /var/log", "stat /var/log/app.log", "cat /etc/os-release",
    "head -n 20 /var/log/app.log", "tail -n 200 /var/log/app.log", "less /var/log/app.log",
    "grep -n error /var/log/app.log", "wc -l /var/log/app.log", "ps aux", "top -b -n 1", "top -b -n1",
    "ss -tln", "ss -H -tln", "netstat -tln", "ip addr", "ip address show", "ip route", "ip route show",
    "uname -srm", "hostname", "hostname -f", "date", "date -u", "date +%Y-%m-%d", "id", "whoami",
    "lsblk", "findmnt", "echo healthy", "command -v docker", "which nginx", "systemctl status nginx",
    "systemctl is-active api", "systemctl list-units --type=service", "systemctl --failed --no-legend --plain",
    'journalctl -u api -n 200 --no-pager', 'journalctl -p err --since "24 hours ago" --no-pager | tail -n 30',
    "docker ps", 'docker ps -a --format "{{.Names}}\\t{{.Status}}"', "docker logs --tail 200 api",
    "docker stats --no-stream", "docker images", "docker version", "docker info", "docker compose ps",
    "docker compose logs --tail 100", "docker compose config --services", "docker compose -f /opt/apps/compose.yml ps",
    "docker exec api cat /etc/os-release", "docker exec -u root api uptime", "docker exec gateway nginx -t",
    "nginx -t", "openssl x509 -in /var/www/certificate.crt -noout -enddate", "curl -sI https://example.com",
    "echo | openssl s_client -connect 127.0.0.1:443 -servername example.com 2>/dev/null | openssl x509 -noout -enddate",
    'uptime; nproc; free -m; df -hP -x tmpfs -x devtmpfs -x overlay -x squashfs; docker ps -a --format "{{.Names}}\\t{{.Status}}"; systemctl --failed --no-legend --plain; journalctl -p err --since "24 hours ago" --no-pager | tail -n 30',
    "docker ps && df -h", "docker ps || uptime", "uptime & free -m", "echo ok >/dev/null", "docker ps 2>&1",
    "uptime\nfree -m", "cat /var/log/app.log | grep error | wc -l",
]), "ssh-inspection")
add("read-only", "allowed", [
    "ssh -- hk-edge uptime", "ssh -p 22 hk-edge uptime", "ssh -l admin hk-edge uptime", "ssh -vvT hk-edge uptime",
    "ssh -o BatchMode=yes hk-edge uptime", "ssh -oBatchMode=yes -- hk-edge uptime", "ssh admin@hk-edge uptime",
    "ssh admin@203.0.113.10 uptime", "ssh 203.0.113.10 uptime", "/usr/bin/ssh hk-edge uptime",
    '"/usr/bin/ssh" hk-edge uptime', 's"s"h hk-edge uptime', "'ssh' hk-edge uptime", "ssh HK-EDGE uptime",
    "command ssh -- hk-edge uptime", "env LANG=C ssh -- hk-edge uptime", "ssh -F /tmp/config -- hk-edge uptime",
    "ssh ssh://admin@hk-edge:22 uptime", "ssh [2001:db8::10] uptime", "ssh admin@[2001:db8::10] uptime",
], "ssh-invocation")
add("read-only", "denied", ssh([
    "docker restart api", "docker stop api", "docker start api", "docker rm api", "docker run alpine",
    "docker pull nginx", "docker compose up -d", "docker compose down", "docker compose restart api",
    "docker exec api touch /tmp/x", "docker exec -u root api rm /tmp/x", 'docker exec api sh -c "uptime"',
    "sudo uptime", "sudo -n docker ps", 'sh -c "uptime"', 'bash -lc "docker ps"', "sh -s", "bash -s",
    "cat >/tmp/result", "echo hi > /tmp/out", "echo hi >> /tmp/out", "echo hi | tee /tmp/out",
    "sed -i s/a/b/ /tmp/file", "sed --in-place s/a/b/ /tmp/file", "touch /tmp/a", "mkdir /tmp/a",
    "rm /tmp/a", "cp /tmp/a /tmp/b", "mv /tmp/a /tmp/b", "chmod 644 /tmp/a", "chown root /tmp/a",
    "systemctl restart api", "systemctl start api", "systemctl enable api", "systemctl status api restart nginx",
    "journalctl --vacuum-time=1d", "journalctl --rotate", "journalctl --flush", "journalctl --setup-keys",
    "journalctl --update-catalog", "docker stats", "docker compose config", "docker images && docker restart api",
    "uptime; rm /tmp/a", "uptime | sh", "echo $(touch /tmp/x)", "echo `touch /tmp/x`", "cat < /tmp/input",
    "cat <<EOF\nhello\nEOF", "sh <<EOF\ntouch /tmp/x\nEOF", "for x in a; do uptime; done",
    "if true; then uptime; fi", "(uptime)", "{ uptime; }", "uptime > /dev/stdout", "uptime 2>/tmp/error",
    "uptime &>/tmp/all", "uptime 2>&file", "curl -sI -X DELETE https://example.com", "curl -sI -d data https://example.com",
    "curl -sI -o /tmp/head https://example.com", "curl -sI --output=/tmp/head https://example.com",
    "curl -sI --request=POST https://example.com", "curl -sI -K /tmp/curlrc", "nginx -s reload",
    'nginx -t -g "daemon off;"', "openssl x509 -noout -out /tmp/cert", "hostname compromised",
    "date -s 2025-01-01", "ss -K", "ip addr add 10.0.0.2/24 dev eth0", "ip route del default",
    "uname; sudo uptime", "cat /tmp/a && touch /tmp/b", 'echo "unterminated',
]), "ssh-readonly-block")
add("read-only", "denied", [
    "ssh hk-edge", "ssh -N hk-edge", "ssh -L 8080:localhost:80 hk-edge uptime", "ssh -R 8080:localhost:80 hk-edge uptime",
    "ssh -D 1080 hk-edge uptime", "ssh -W host:22 hk-edge", "ssh -oProxyCommand=evil hk-edge uptime",
    "ssh -o HostName=other hk-edge uptime", "ssh hk-edge -oProxyCommand=evil uptime", "scp /tmp/a hk-edge:/tmp/a",
    "scp hk-edge:/tmp/a /tmp/a", "scp -r /tmp/folder admin@hk-edge:/opt/a", "sftp hk-edge",
    "rsync -av /tmp/a hk-edge:/opt/a", "rsync -e ssh hk-edge:/tmp/a /tmp/a", 'bash -c "ssh hk-edge uptime"',
    "echo $(ssh hk-edge uptime)", "echo `ssh hk-edge uptime`", 'ssh hk-edge "echo $(touch /tmp/x)"',
], "ssh-shell-transfer")
secrets = [
    "cat .env", "cat .env.production", "head /app/.env.local", "tail /app/.env", "less /etc/shadow",
    "grep password /etc/shadow", "wc -c ~/.ssh/id_rsa", "ls ~/.ssh/", "cat /tmp/secret.pem",
    "cat /tmp/private.key", "cat /tmp/id_ed25519", "docker inspect api", "docker container inspect api",
    "docker --context default inspect api", "env", "printenv", "sudo printenv", "docker exec api env",
    "docker exec api printenv", "docker exec api cat .env", "echo data > ~/.ssh/authorized_keys",
    "cat /home/me/.aws/credentials", "cat ~/.oci/config",
]
for mode in ["read-only", "standard"]:
    add(mode, "denied", ssh(secrets), "credential-" + mode)
    add(mode, "denied", ["scp hk-edge:/app/.env /tmp/x", "scp /tmp/private.pem hk-edge:/tmp/x",
                         "sftp hk-edge:~/.ssh/id_rsa"], "transfer-secret-" + mode)
add("standard", "allowed", ssh([
    "docker restart api", "docker stop api", "docker start api", "docker pull nginx", "docker compose up -d --build",
    "docker compose restart api", "systemctl restart api", "systemctl reload nginx", "touch /tmp/file",
    "mkdir /tmp/new", "rm /tmp/file", "rm -rf /opt/apps/old/cache", "echo ready >/tmp/result",
    "sed -i s/a/b/ /opt/apps/app.conf", "sudo docker restart api", 'docker exec api sh -c "echo ready"',
    'sh -c "docker restart api"', 'bash -lc "docker compose up -d"', "iptables -L -n", "iptables -t nat -S",
    "nft list ruleset", "ufw status verbose", "firewall-cmd --list-all", "firewall-cmd --get-active-zones",
    "firewall-cmd --query-port=443/tcp", "cat /etc/ssh/sshd_config", "docker system prune", "docker image prune",
    "unknown-new-tool query", "echo $(uptime)", "for x in a; do uptime; done", 'echo "unterminated',
]), "standard-routine")
add("standard", "allowed", ["ssh hk-edge", "scp /tmp/file hk-edge:/tmp/file", "rsync -av /tmp/a hk-edge:/opt/apps/a",
                            "sftp hk-edge", 'bash -c "ssh hk-edge uptime"'], "standard-shell-transfer")
add("standard", "denied", ssh([
    "docker compose down -v", "docker compose -f /opt/app/compose.yml down --volumes", "docker compose down --volumes=true",
    "docker compose down -tv", "docker volume rm data", "docker volume remove data", "docker volume prune",
    "docker system prune --volumes", "docker system prune --volumes=true", "docker-compose down -v",
    "rm -rf /", "rm -r /var", "rm --recursive /var/lib", "rm -Rf /home/me", "rm -r /var/../etc", "rm -rf /*",
    "mkfs /dev/vdb", "mkfs.ext4 /dev/vdb", "wipefs -a /dev/vdb", "dd if=/dev/zero of=/dev/vdb", "dropdb production",
    "redis-cli FLUSHALL", "redis-cli flushall", "redis-cli -h localhost FLUSHDB", 'psql -c "DROP DATABASE prod"',
    'mysql -e "DROP DATABASE prod"', "reboot", "shutdown -h now", "halt", "poweroff", "init 0", "init 6",
    "systemctl reboot", "systemctl poweroff", "iptables -F", "iptables -A INPUT -j DROP", "iptables -L -F",
    "nft flush ruleset", "nft add table inet test", "ufw disable", "ufw allow 80", "firewall-cmd --reload",
    "firewall-cmd --add-port=80/tcp", "echo changed >/etc/ssh/sshd_config", "sed -i s/yes/no/ /etc/ssh/sshd_config",
    "systemctl stop sshd", "systemctl restart ssh", "service ssh restart", "pkill sshd", "killall sshd",
    "docker stop gateway", "docker restart gateway", "docker kill gateway", "docker rm gateway",
    "docker container stop gateway", "docker compose stop gateway", "docker compose down", "systemctl stop gateway",
    "systemctl restart gateway.service", "sudo docker compose down -v", 'sh -c "docker volume rm data"',
    'docker exec api sh -c "reboot"',
]), "standard-danger")
add("read-only", "ignored", [
    "echo hello", "git status", "cat README.md", 'echo "ssh hk-edge docker restart api"', "ssh other-host docker restart api",
    "scp /tmp/a other-host:/tmp/a", "ssh -G hk-edge", "ssh -V", "ssh -Q cipher", "wrangler --version", "vercel --version",
    "oci --version", "wrangler --help", "vercel help deploy", 'echo "wrangler deploy"',
], "unrelated")
for mode in ["read-only", "standard"]:
    add(mode, "allowed", [
        "wrangler whoami", "vercel whoami", "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler tail api-gateway",
        "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler deployments list", "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler kv key list --namespace-id kv-public",
        "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler d1 info appdb", 'CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler d1 execute appdb --command "SELECT 1"',
        'CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler d1 execute appdb --command "SELECT name FROM users;"',
        "vercel --scope team_1 ls", "vercel ls --scope=team_1", "vercel --scope team_1 list", "vercel --scope team_1 inspect shop",
        "vercel --scope team_1 logs shop", "oci --profile main compute instance list --compartment-id ocid1.compartment.test",
        "oci compute instance get --profile main --instance-id ocid1.instance.test", "npx wrangler whoami", "pnpm exec vercel whoami",
        "bunx wrangler whoami", "CLOUDFLARE_ACCOUNT_ID=cf-1 npx wrangler d1 info appdb",
        "env CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler tail api-gateway",
    ], "cli-inspection-" + mode)
    add(mode, "denied", [
        "vercel env pull", "vercel env pull --scope team_1", "vercel --scope team_1 env ls", "vercel --scope team_1 env list",
        "vercel --scope team_1 pull", "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler secret get API_KEY", "wrangler secret read API_KEY",
        "wrangler secret list", "oci --profile main iam customer-secret-key list --user-id fake",
        "oci --profile main iam auth-token list --user-id fake", "oci --profile main secrets secret-bundle get --secret-id fake",
        "oci --profile main setup config", "wrangler tail api-gateway", "CLOUDFLARE_ACCOUNT_ID=wrong wrangler tail api-gateway",
        "vercel logs shop", "vercel --scope other logs shop", "oci --profile wrong compute instance list", "oci compute instance list",
        "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler tail foreign-worker", "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler d1 info foreign-db",
        "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler kv key list --namespace-id foreign-kv", "vercel --scope team_1 inspect foreign-project",
        "oci --profile main compute instance get --instance-id ocid1.instance.other",
    ], "cli-always-block-" + mode)
add("read-only", "denied", [
    "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler deploy --name api-gateway", "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler publish --name api-gateway",
    "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler kv key put --namespace-id kv-public key value",
    'CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler d1 execute appdb --command "DELETE FROM users"',
    'CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler d1 execute appdb --command "SELECT 1; DELETE FROM users"',
    "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler d1 execute appdb --file migrations.sql",
    'CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler d1 execute appdb --command "SELECT load_extension(1)"',
    "vercel --scope team_1 deploy", "vercel --scope team_1 --prod", "vercel --scope team_1 rm shop",
    "vercel --scope team_1 env add KEY", "vercel --scope team_1 env rm KEY",
    "oci --profile main compute instance update --instance-id ocid1.instance.test",
    "oci --profile main compute instance action --instance-id ocid1.instance.test --action STOP",
    "vercel --scope team_1 logs shop > /tmp/log", "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler deploy --name api-gateway && echo done",
], "cli-readonly-block")
add("standard", "allowed", [
    "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler deploy --name api-gateway", "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler publish --name api-gateway",
    "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler kv key put --namespace-id kv-public key value", "vercel --scope team_1 deploy --project shop",
    "vercel --scope team_1 --prod --project shop", "vercel --scope team_1 env add KEY --project shop",
    "oci --profile main compute instance update --instance-id ocid1.instance.test",
    "oci --profile main compute instance action --instance-id ocid1.instance.test --action STOP",
], "cli-standard-routine")
for mode in ["read-only", "standard"]:
    add(mode, "denied", [
        "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler d1 delete appdb", "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler r2 bucket delete assets",
        "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler delete --name api-gateway", "vercel --scope team_1 project rm shop",
        "vercel --scope team_1 domains rm example.com", "oci --profile main compute instance terminate --instance-id ocid1.instance.test",
        "oci --profile main bv volume delete --volume-id ocid1.volume.test",
    ], "cli-destroy-" + mode)

add("read-only", "denied", [
    "if true; then ssh hk-edge 'docker restart api'; fi", "for host in hk-edge; do ssh hk-edge uptime; done",
    "ssh hk-edge 'curl -sI -XDELETE https://example.com'", "ssh hk-edge 'curl -sIo/tmp/output https://example.com'",
    "ssh hk-edge 'curl -sI --config=/tmp/curlrc https://example.com'",
    "ssh hk-edge 'openssl s_client -connect localhost:443 -sess_out /tmp/session'",
    "ssh hk-edge 'systemctl --failed set-environment FOO=bar'", "ssh hk-edge 'systemctl --failed preset-all'",
    "ssh hk-edge 'docker compose config --services --output=/tmp/leak'", "ssh hk-edge 'nginx -t -gdaemon=on'",
], "review-readonly-variants")
add("standard", "denied", [
    "ssh hk-edge 'docker compose stop'", "ssh hk-edge 'docker compose restart'",
    "ssh hk-edge 'docker compose config --services --environment'", "vercel --scope team_1 --scope other deploy",
    "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler deploy --name api-gateway --name outside", "vercel --scope team_1 deploy",
    "vercel --scope team_1 --prod", "VERCEL_PROJECT_ID=unknown vercel --scope team_1 deploy",
    "vercel --scope team_1 deploy --name unknown", "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler deploy",
    "oci --profile main compute instance update",
], "review-standard-scopes")
add("standard", "allowed", ["VERCEL_PROJECT_ID=prj_1 vercel --scope team_1 deploy"], "explicit-project")
add("read-only", "allowed", ["ssh hk-edge 'echo env'"], "literal-non-command")

path = Path(__file__).with_name("commands.json")
path.write_text("[\n" + ",\n".join("  " + json.dumps(case, ensure_ascii=False) for case in cases) + "\n]\n", encoding="utf-8", newline="\n")
print(f"{len(cases)} literal command fixtures written")
