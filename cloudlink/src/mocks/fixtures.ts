// Mock 夹具（PRD 7.8）。时间都相对「现在」生成，保证「已过期」「2 小时前」这类状态稳定复现
import type {
  ActivityItem,
  Asset,
  Environment,
  Mount,
  MountRequest,
  ProbeChange,
  Settings,
  SshHostList,
  Target,
} from "@/bindings"

const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

export const WSL: Environment["id"] = "wsl:Ubuntu-24.04"

export const environments: Environment[] = [
  {
    id: "windows",
    label: "Windows",
    home: "C:\\Users\\me",
    sshConfigPath: "C:\\Users\\me\\.ssh\\config",
    available: true,
  },
  {
    id: WSL,
    label: "WSL - Ubuntu-24.04",
    home: "/home/me",
    sshConfigPath: "/home/me/.ssh/config",
    available: true,
  },
]

const builtinExport = { resolvedConnection: false, listeningPorts: false, image: true }

export const assets: Asset[] = [
  {
    id: "ast_hk_edge",
    type: "vps",
    name: "香港轻量反代与边缘节点",
    slug: "vps-hk-edge",
    envTag: "prod",
    provider: "Tencent Cloud",
    region: "HK",
    tags: ["edge", "1panel"],
    summary: "承担 api.example.com 与 blog.example.com 的公网反代及后端 API 容器托管",
    connection: {
      sshAlias: "hk-edge",
      definedIn: [WSL, "windows"],
      resolved: {
        hostname: "203.0.113.10",
        user: "root",
        port: 22,
        proxyJump: null,
        resolvedAt: ago(2 * HOUR),
      },
    },
    facts: {
      os: "Ubuntu 24.04 LTS",
      kernel: "6.8.0-45-generic",
      arch: "x86_64",
      cpuCores: 2,
      memoryTotalMiB: 1987,
      diskTotalGiB: 40,
      panel: { type: "1panel", installPath: "/opt/1panel" },
    },
    paths: [
      { key: "nginx-conf", label: "OpenResty 站点配置目录", path: "/opt/1panel/apps/openresty/openresty/conf/conf.d", source: "manual" },
      { key: "compose-root", label: "Docker Compose 编排目录", path: "/opt/1panel/docker/compose", source: "manual" },
      { key: "app-data", label: "业务持久化数据目录", path: "/data/apps", source: "manual" },
    ],
    services: [
      {
        kind: "docker",
        name: "openresty",
        image: "openresty:1.21",
        ports: [
          { hostIp: "0.0.0.0", hostPort: 80, containerPort: 80, proto: "tcp" },
          { hostIp: "0.0.0.0", hostPort: 443, containerPort: 443, proto: "tcp" },
        ],
        role: "主网关与 SSL 终结",
        critical: true,
        source: "probe",
        lastSeenAt: ago(2 * HOUR),
        missing: false,
      },
      {
        kind: "docker",
        name: "old-worker",
        image: "worker:0.9",
        ports: [],
        role: "旧版队列消费者",
        critical: false,
        source: "probe",
        lastSeenAt: ago(2 * HOUR),
        missing: false,
      },
    ],
    servedHostnames: ["api.example.com", "blog.example.com"],
    listeningPorts: [{ addr: "0.0.0.0", port: 22, proto: "tcp" }],
    guardrails: {
      defaultMode: "read-only",
      rules: [
        { id: "r1", text: "机器内存仅 2GB，严禁在宿主机直接执行 npm run build 或 cargo build 等高内存编译任务" },
        { id: "r2", text: "修改 OpenResty 配置后必须先执行 docker exec openresty nginx -t，校验通过才允许 reload" },
        { id: "r3", text: "禁止停止或重启 openresty 容器" },
      ],
    },
    export: builtinExport,
    notes: "",
    probe: { lastRunId: "prb_hk_1", lastSuccessAt: ago(2 * HOUR), status: "ok" },
    createdAt: ago(8 * DAY),
    updatedAt: ago(2 * HOUR),
  },
  {
    id: "ast_sg_db",
    type: "vps",
    name: "新加坡数据库主机",
    slug: "vps-sg-db",
    envTag: "prod",
    provider: "AWS Lightsail",
    region: "SG",
    tags: ["db"],
    summary: "运行 PostgreSQL 16 与 Redis，供 OpenPet 后端使用",
    connection: {
      sshAlias: "sg-db",
      // 只在 WSL 中定义：挂到 Windows 目标会触发「别名不可达」
      definedIn: [WSL],
      resolved: {
        hostname: "198.51.100.7",
        user: "deploy",
        port: 2222,
        proxyJump: null,
        resolvedAt: ago(41 * DAY),
      },
    },
    facts: { os: "Debian 12", kernel: "6.1.0-26-amd64", arch: "x86_64", cpuCores: 2, memoryTotalMiB: 3900, diskTotalGiB: 80, panel: null },
    paths: [{ key: "pg-data", label: "PostgreSQL 数据目录", path: "/var/lib/postgresql/16/main", source: "manual" }],
    services: [
      { kind: "systemd", name: "postgresql", ports: [], role: "主数据库", critical: true, source: "probe", lastSeenAt: ago(41 * DAY), missing: false },
      { kind: "docker", name: "redis", image: "redis:7.4", ports: [{ hostIp: "127.0.0.1", hostPort: 6379, containerPort: 6379, proto: "tcp" }], critical: false, source: "probe", lastSeenAt: ago(41 * DAY), missing: false },
    ],
    servedHostnames: [],
    listeningPorts: [{ addr: "127.0.0.1", port: 5432, proto: "tcp" }],
    guardrails: { defaultMode: "read-only", rules: [{ id: "r1", text: "禁止执行 DROP、TRUNCATE 或不带 WHERE 的 DELETE" }] },
    export: builtinExport,
    notes: "主从切换流程见团队 Wiki。",
    probe: { lastRunId: "prb_sg_1", lastSuccessAt: ago(41 * DAY), status: "stale" },
    createdAt: ago(60 * DAY),
    updatedAt: ago(41 * DAY),
  },
  {
    id: "ast_dev_box",
    type: "vps",
    name: "开发测试机",
    slug: "vps-dev-box",
    envTag: "dev",
    tags: [],
    summary: "个人开发与临时实验用机",
    connection: { sshAlias: "dev-box", definedIn: ["windows", WSL], resolved: null },
    facts: {},
    paths: [],
    services: [],
    servedHostnames: [],
    listeningPorts: [],
    guardrails: { defaultMode: "standard", rules: [] },
    export: builtinExport,
    notes: "",
    probe: { lastRunId: null, lastSuccessAt: null, status: "never" },
    createdAt: ago(1 * DAY),
    updatedAt: ago(1 * DAY),
  },
]

export const targets: Target[] = [
  {
    id: "tgt_cc_win",
    kind: "agent-global",
    envId: "windows",
    label: "Claude Code - 全局",
    agent: "claude-code",
    path: "C:\\Users\\me\\.claude\\skills",
    linkMode: "auto",
  },
  {
    id: "tgt_agents_wsl",
    kind: "agent-global",
    envId: WSL,
    label: "通用 .agents - 全局",
    agent: "universal",
    path: "/home/me/.agents/skills",
    linkMode: "auto",
  },
  {
    id: "tgt_openpet",
    kind: "project",
    envId: WSL,
    label: "OpenPet-Desktop",
    path: "\\\\wsl.localhost\\Ubuntu-24.04\\home\\me\\code\\OpenPet-Desktop",
    conventions: ["claude", "agents"],
    gitExclude: true,
    linkMode: "auto",
  },
  {
    id: "tgt_blog",
    kind: "project",
    envId: "windows",
    label: "Blog-Astro",
    path: "D:\\code\\Blog-Astro",
    conventions: ["claude"],
    gitExclude: true,
    linkMode: "auto",
  },
]

const OPENPET_WSL = "/home/me/code/OpenPet-Desktop"

export const mounts: Mount[] = [
  // ok，Windows 全局，复制模式；生产资产挂全局 → 常驻提示
  {
    id: "mnt_hk_cc",
    skillId: "skl_hk_edge",
    targetId: "tgt_cc_win",
    mode: "read-only",
    links: [{ path: "C:\\Users\\me\\.claude\\skills\\vps-hk-edge", kind: "copy" }],
    status: "ok",
    createdAt: ago(6 * DAY),
    checkedAt: ago(5 * 60 * 1000),
  },
  // alias-missing：sg-db 只在 WSL 定义，却挂在 Windows 全局
  {
    id: "mnt_sg_cc",
    skillId: "skl_sg_db",
    targetId: "tgt_cc_win",
    mode: "read-only",
    links: [{ path: "C:\\Users\\me\\.claude\\skills\\vps-sg-db", kind: "copy" }],
    status: "alias-missing",
    statusDetail: "windows",
    createdAt: ago(20 * DAY),
    checkedAt: ago(5 * 60 * 1000),
  },
  // ok，WSL 全局，符号链接
  {
    id: "mnt_dev_agents",
    skillId: "skl_dev_box",
    targetId: "tgt_agents_wsl",
    mode: "standard",
    links: [{ path: "/home/me/.agents/skills/vps-dev-box", kind: "symlink" }],
    status: "ok",
    createdAt: ago(1 * DAY),
    checkedAt: ago(5 * 60 * 1000),
  },
  // ok，WSL 项目，两个约定目录
  {
    id: "mnt_hk_openpet",
    skillId: "skl_hk_edge",
    targetId: "tgt_openpet",
    mode: "standard",
    links: [
      { path: `${OPENPET_WSL}/.claude/skills/vps-hk-edge`, kind: "symlink" },
      { path: `${OPENPET_WSL}/.agents/skills/vps-hk-edge`, kind: "symlink" },
    ],
    status: "ok",
    createdAt: ago(5 * DAY),
    checkedAt: ago(5 * 60 * 1000),
  },
  // broken：sg-db 挂在 OpenPet 上，链接被删
  {
    id: "mnt_sg_openpet",
    skillId: "skl_sg_db",
    targetId: "tgt_openpet",
    mode: "read-only",
    links: [
      { path: `${OPENPET_WSL}/.claude/skills/vps-sg-db`, kind: "symlink" },
      { path: `${OPENPET_WSL}/.agents/skills/vps-sg-db`, kind: "symlink" },
    ],
    status: "broken",
    createdAt: ago(20 * DAY),
    checkedAt: ago(5 * 60 * 1000),
  },
  // conflict：Blog-Astro 里已有手写的同名目录
  {
    id: "mnt_dev_blog",
    skillId: "skl_dev_box",
    targetId: "tgt_blog",
    mode: "read-only",
    links: [{ path: "D:\\code\\Blog-Astro\\.claude\\skills\\vps-dev-box", kind: "copy" }],
    status: "conflict",
    createdAt: ago(1 * DAY),
    checkedAt: ago(5 * 60 * 1000),
  },
  // stale-copy：Windows 项目的副本落后于最新编译
  {
    id: "mnt_hk_blog",
    skillId: "skl_hk_edge",
    targetId: "tgt_blog",
    mode: "read-only",
    links: [{ path: "D:\\code\\Blog-Astro\\.claude\\skills\\vps-hk-edge", kind: "copy" }],
    status: "stale-copy",
    createdAt: ago(4 * DAY),
    checkedAt: ago(5 * 60 * 1000),
  },
]

/**
 * F-303 AC2：「全局与项目档位不同」的挂载尝试。
 * dev-box 已以 standard 挂在 WSL 通用 .agents 全局，OpenPet（WSL，含 .agents）再以 read-only 挂载 → 阻止
 */
export const modeConflictAttempt: MountRequest = {
  skillId: "skl_dev_box",
  targetId: "tgt_openpet",
  mode: "read-only",
}

/** hk-edge 探测得到的 4 处差异（PRD 6.5 示例） */
export const hkEdgeProbeChanges: ProbeChange[] = [
  { id: "chg_1", kind: "added", field: "service", label: "api-gateway", after: "my-api:v1.2  127.0.0.1:8080->8080" },
  { id: "chg_2", kind: "changed", field: "os", label: "系统", before: "Ubuntu 22.04 LTS", after: "Ubuntu 24.04 LTS" },
  { id: "chg_3", kind: "missing", field: "service", label: "old-worker", before: "worker:0.9" },
  { id: "chg_4", kind: "changed", field: "listeningPorts", label: "监听端口", before: "22/tcp", after: "22/tcp, 9090/tcp" },
]

export const sshHosts: SshHostList = {
  scanned: [
    { envId: "windows", path: "C:\\Users\\me\\.ssh\\config" },
    { envId: WSL, path: "/home/me/.ssh/config" },
  ],
  hosts: [
    { alias: "hk-edge", definedIn: [WSL, "windows"], hostname: "203.0.113.10", user: "root", port: 22, imported: true },
    { alias: "sg-db", definedIn: [WSL], hostname: "198.51.100.7", user: "deploy", port: 2222, imported: true },
    { alias: "dev-box", definedIn: ["windows", WSL], hostname: "192.0.2.44", user: "ubuntu", port: 22, imported: true },
    { alias: "jp-relay", definedIn: ["windows"], hostname: "192.0.2.80", user: "ubuntu", port: 22, imported: false },
    { alias: "us-backup", definedIn: [WSL], hostname: "198.51.100.30", user: "backup", port: 22, imported: false },
  ],
  skippedPatterns: ["*", "*.internal"],
}

export const settings: Settings = {
  theme: "system",
  outputLanguage: "en",
  environments: [
    { id: "windows", enabled: true },
    { id: WSL, enabled: true },
  ],
  windowsJunction: false,
  defaultLinkMode: "auto",
  bodyLineLimit: 60,
  writeSnapshotTime: true,
  defaultMode: "read-only",
  probeTimeoutSec: 30,
  windowsSshPath: "C:\\Windows\\System32\\OpenSSH\\ssh.exe",
  dataDir: "C:\\Users\\me\\.cloudlink",
  logDir: "C:\\Users\\me\\.cloudlink\\logs",
}

export const activity: ActivityItem[] = [
  { id: "act_8", kind: "probe", at: ago(2 * HOUR), assetId: "ast_hk_edge", messageId: "probe-changes", params: { alias: "hk-edge", count: 2 }, durationMs: 3100, detail: "cat /etc/os-release\nuname -srm\ndocker ps --format …\nss -H -tln", ok: true },
  { id: "act_7", kind: "compile", at: ago(2 * HOUR - 60 * 1000), assetId: "ast_hk_edge", messageId: "compile-ok", params: { slug: "vps-hk-edge", mode: "read-only" }, durationMs: 42, ok: true },
  { id: "act_6", kind: "compile", at: ago(5 * HOUR), assetId: "ast_dev_box", messageId: "compile-blocked", params: { slug: "vps-dev-box", count: 1 }, durationMs: 38, ok: false },
  { id: "act_5", kind: "mount", at: ago(1 * DAY), assetId: "ast_dev_box", messageId: "mount-ok", params: { slug: "vps-dev-box", target: "通用 .agents - 全局" }, durationMs: 120, ok: true },
  { id: "act_4", kind: "unmount", at: ago(1 * DAY + 2 * HOUR), assetId: "ast_sg_db", messageId: "unmount-ok", params: { slug: "vps-sg-db", target: "Blog-Astro" }, durationMs: 60, ok: true },
  { id: "act_3", kind: "repair", at: ago(3 * DAY), assetId: "ast_hk_edge", messageId: "repair-ok", params: { slug: "vps-hk-edge", target: "OpenPet-Desktop" }, durationMs: 90, ok: true },
  { id: "act_2", kind: "probe", at: ago(41 * DAY), assetId: "ast_sg_db", messageId: "probe-no-changes", params: { alias: "sg-db" }, durationMs: 2400, ok: true },
  { id: "act_1", kind: "mount", at: ago(41 * DAY), assetId: "ast_hk_edge", messageId: "mount-ok", params: { slug: "vps-hk-edge", target: "OpenPet-Desktop" }, durationMs: 140, ok: true },
]

export const PROBE_SCRIPT = `#!/bin/sh
# CloudLink probe v1 — read-only, POSIX sh, no sudo
echo "@@os"; cat /etc/os-release 2>/dev/null
echo "@@kernel"; uname -srm
echo "@@cpu"; nproc 2>/dev/null || getconf _NPROCESSORS_ONLN
echo "@@mem"; grep MemTotal /proc/meminfo
echo "@@disk"; df -P -k /
echo "@@docker"; docker ps --format '{{.Names}}\\t{{.Image}}\\t{{.Ports}}\\t{{.Status}}' 2>&1
echo "@@listen"; ss -H -tln 2>/dev/null || netstat -tln
echo "@@systemd"; systemctl list-units --type=service --state=running --no-legend --plain 2>/dev/null
echo "@@tools"; command -v nginx openresty docker pm2 1pctl bt caddy
echo "@@panel"; test -d /opt/1panel && echo 1panel; test -d /www/server/panel && echo bt
`
