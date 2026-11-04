#!/bin/sh
set -eu

# The generated test password and public key arrive over stdin. Neither is a
# Docker argument, environment variable, image layer or bind-mounted user file.
IFS= read -r password
IFS= read -r public_key
case "$password" in
  ''|*[!A-Za-z0-9_-]*) exit 1 ;;
esac
case "$public_key" in
  'ssh-ed25519 '*) ;;
  *) exit 1 ;;
esac
printf 'cloudlink:%s\n' "$password" | chpasswd
printf '%s\n' "$public_key" > /home/cloudlink/.ssh/authorized_keys
chmod 600 /home/cloudlink/.ssh/authorized_keys
chown cloudlink:cloudlink /home/cloudlink/.ssh/authorized_keys
