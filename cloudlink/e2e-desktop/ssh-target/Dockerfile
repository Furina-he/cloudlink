FROM alpine:3.22

RUN apk add --no-cache openssh nginx redis su-exec iproute2 procps \
    && adduser -D -s /bin/sh cloudlink \
    && mkdir -p /run/sshd /home/cloudlink/.ssh \
    && chmod 700 /home/cloudlink/.ssh \
    && chown cloudlink:cloudlink /home/cloudlink/.ssh

COPY entrypoint.sh configure.sh /usr/local/bin/
RUN chmod 755 /usr/local/bin/entrypoint.sh /usr/local/bin/configure.sh

EXPOSE 2222
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
