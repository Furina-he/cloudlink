//! 单元测试共用的夹具：PRD 3.3 的 hk-edge，加上 PRD 7.8 夹具里的 sg-db、dev-box 和 cloudflare。
//! 时间全部固定，黄金样例因此可以逐字节比对。

use std::collections::BTreeMap;

use crate::model::asset::*;
use crate::model::compile::{Convention, RelationNote, SkillConfig};
use crate::model::env::EnvId;

pub const NOW: &str = "2026-10-31T09:00:00Z";

fn wsl() -> EnvId {
    EnvId::wsl("Ubuntu-24.04")
}

fn rule(id: &str, text: &str) -> GuardrailRule {
    GuardrailRule {
        id: id.into(),
        text: text.into(),
    }
}

fn port(host_ip: &str, host: u16, container: u16) -> PortMapping {
    PortMapping {
        host_ip: host_ip.into(),
        host_port: host,
        container_port: container,
        proto: Proto::Tcp,
    }
}

/// PRD 3.3 的示例服务器（用户文本按 5.2 的说明写成英文）
pub fn hk_edge() -> ServerAsset {
    ServerAsset {
        tag: VpsTag::Tag,
        id: "ast_01JB3Q8Z6W".into(),
        name: "Hong Kong edge proxy node".into(),
        env_tag: EnvTag::Prod,
        summary:
            "Public reverse proxy for api.example.com and blog.example.com, and host for the backend API containers"
                .into(),
        agent: AssetAgent {
            agents: vec!["claude-code".into(), "universal".into()],
            mode: Mode::ReadOnly,
        },
        guardrails: Guardrails {
            rules: vec![
                rule(
                    "r1",
                    "Memory is only 2 GB — never run npm run build, cargo build or other memory-heavy builds on this host",
                ),
                rule(
                    "r2",
                    "After editing OpenResty config, run docker exec openresty nginx -t and reload only if it passes",
                ),
            ],
        },
        notes:
            "- 2026-10-31: The API is deployed from /opt/1panel/docker/compose/api with `docker compose up -d --build`."
                .into(),
        created_at: "2026-10-20T08:00:00Z".into(),
        updated_at: "2026-10-27T10:31:00Z".into(),
        provider: Some("Tencent Cloud".into()),
        region: Some("HK".into()),
        tags: vec!["edge".into(), "1panel".into()],
        connection: AssetConnection {
            source: ConnectionSource::Managed,
            ssh_alias: "hk-edge".into(),
            host: Some("203.0.113.10".into()),
            port: Some(22),
            user: Some("root".into()),
            auth: Some(AssetAuth {
                method: AuthMethod::Key,
                identity_file: BTreeMap::from([
                    (EnvId::windows(), r"C:\Users\me\.ssh\id_ed25519".to_string()),
                    (wsl(), "/home/me/.ssh/id_ed25519".to_string()),
                ]),
                generated_by_cloud_link: false,
                password_saved: false,
            }),
            proxy_jump: Some(None),
            defined_in: vec![EnvId::windows(), wsl()],
            resolved: Some(ResolvedConnection {
                hostname: "203.0.113.10".into(),
                user: "root".into(),
                port: 22,
                proxy_jump: None,
                resolved_at: "2026-10-27T10:30:00Z".into(),
            }),
            verified: Some(ConnectionVerified {
                ok: true,
                at: "2026-10-27T10:30:00Z".into(),
                env_ids: vec![EnvId::windows(), wsl()],
            }),
        },
        facts: AssetFacts {
            os: Some("Ubuntu 24.04 LTS".into()),
            kernel: Some("6.8.0-45-generic".into()),
            arch: Some("x86_64".into()),
            cpu_cores: Some(2),
            memory_total_mib: Some(1987),
            disk_total_gib: Some(40),
            panel: Some(Some(PanelInfo {
                kind: PanelType::OnePanel,
                install_path: "/opt/1panel".into(),
            })),
        },
        paths: vec![
            AssetPath {
                key: "nginx-conf".into(),
                label: "OpenResty site configs".into(),
                path: "/opt/1panel/apps/openresty/openresty/conf/conf.d".into(),
                source: FieldSource::Manual,
            },
            AssetPath {
                key: "compose-root".into(),
                label: "Docker Compose projects".into(),
                path: "/opt/1panel/docker/compose".into(),
                source: FieldSource::Manual,
            },
        ],
        services: vec![Service {
            kind: ServiceKind::Docker,
            name: "openresty".into(),
            image: Some("openresty:1.21".into()),
            ports: vec![port("0.0.0.0", 443, 443)],
            role: Some("Main gateway and SSL termination".into()),
            critical: true,
            source: FieldSource::Probe,
            last_seen_at: Some("2026-10-27T10:30:00Z".into()),
            missing: false,
            sanitized: None,
        }],
        served_hostnames: vec!["api.example.com".into(), "blog.example.com".into()],
        listening_ports: vec![ListeningPort {
            addr: "0.0.0.0".into(),
            port: 22,
            proto: Proto::Tcp,
        }],
        export: ExportFlags::default(),
        probe: AssetProbeInfo {
            last_run_id: Some("prb_01JB3R".into()),
            last_success_at: Some("2026-10-27T10:30:00Z".into()),
            status: ProbeState::Ok,
        },
    }
}

/// PRD 7.8：生产，imported，已验证，标准运维
pub fn sg_db() -> ServerAsset {
    ServerAsset {
        tag: VpsTag::Tag,
        id: "ast_01JB3QSGDB".into(),
        name: "Singapore database".into(),
        env_tag: EnvTag::Prod,
        summary: "PostgreSQL and Redis for the API".into(),
        agent: AssetAgent {
            agents: vec!["claude-code".into(), "universal".into()],
            mode: Mode::Standard,
        },
        guardrails: Guardrails {
            rules: vec![rule("r1", "Never run DROP, TRUNCATE or DELETE without WHERE")],
        },
        notes: String::new(),
        created_at: "2026-10-21T08:00:00Z".into(),
        updated_at: "2026-10-28T03:00:00Z".into(),
        provider: Some("AWS Lightsail".into()),
        region: Some("SG".into()),
        tags: vec!["db".into()],
        connection: AssetConnection {
            source: ConnectionSource::Imported,
            ssh_alias: "sg-db".into(),
            host: None,
            port: None,
            user: None,
            auth: None,
            proxy_jump: None,
            defined_in: vec![EnvId::windows(), wsl()],
            resolved: Some(ResolvedConnection {
                hostname: "198.51.100.7".into(),
                user: "deploy".into(),
                port: 2222,
                proxy_jump: None,
                resolved_at: "2026-10-28T03:00:00Z".into(),
            }),
            verified: Some(ConnectionVerified {
                ok: true,
                at: "2026-10-28T03:00:00Z".into(),
                env_ids: vec![EnvId::windows(), wsl()],
            }),
        },
        facts: AssetFacts {
            os: Some("Debian 12".into()),
            kernel: Some("6.1.0-26-amd64".into()),
            arch: Some("x86_64".into()),
            cpu_cores: Some(2),
            memory_total_mib: Some(3900),
            disk_total_gib: Some(80),
            panel: Some(None),
        },
        paths: vec![AssetPath {
            key: "pg-data".into(),
            label: "PostgreSQL data directory".into(),
            path: "/var/lib/postgresql/16/main".into(),
            source: FieldSource::Manual,
        }],
        services: vec![
            Service {
                kind: ServiceKind::Systemd,
                name: "postgresql".into(),
                image: None,
                ports: vec![],
                role: Some("Primary database".into()),
                critical: true,
                source: FieldSource::Probe,
                last_seen_at: Some("2026-10-28T03:00:00Z".into()),
                missing: false,
                sanitized: None,
            },
            Service {
                kind: ServiceKind::Docker,
                name: "redis".into(),
                image: Some("redis:7.4".into()),
                ports: vec![port("127.0.0.1", 6379, 6379)],
                role: None,
                critical: false,
                source: FieldSource::Probe,
                last_seen_at: Some("2026-10-28T03:00:00Z".into()),
                missing: false,
                sanitized: None,
            },
        ],
        served_hostnames: vec![],
        listening_ports: vec![ListeningPort {
            addr: "127.0.0.1".into(),
            port: 5432,
            proto: Proto::Tcp,
        }],
        export: ExportFlags::default(),
        probe: AssetProbeInfo {
            last_run_id: Some("prb_sg_1".into()),
            last_success_at: Some("2026-10-28T03:00:00Z".into()),
            status: ProbeState::Ok,
        },
    }
}

/// PRD 7.8：开发机，managed，私钥认证（黄金样例里按已列入计算），标准运维，没有探测过
pub fn dev_box() -> ServerAsset {
    ServerAsset {
        tag: VpsTag::Tag,
        id: "ast_01JB3QDEVB".into(),
        name: "Development machine".into(),
        env_tag: EnvTag::Dev,
        summary: "Development machine".into(),
        agent: AssetAgent {
            agents: vec!["claude-code".into()],
            mode: Mode::Standard,
        },
        guardrails: Guardrails::default(),
        notes: String::new(),
        created_at: "2026-10-22T08:00:00Z".into(),
        updated_at: "2026-10-22T08:00:00Z".into(),
        provider: None,
        region: None,
        tags: vec![],
        connection: AssetConnection {
            source: ConnectionSource::Managed,
            ssh_alias: "dev-box".into(),
            host: Some("192.0.2.44".into()),
            port: Some(22),
            user: Some("ubuntu".into()),
            auth: Some(AssetAuth {
                method: AuthMethod::Key,
                identity_file: BTreeMap::from([(EnvId::windows(), r"C:\Users\me\.ssh\cloudlink_dev-box".to_string())]),
                generated_by_cloud_link: true,
                password_saved: false,
            }),
            proxy_jump: Some(None),
            defined_in: vec![EnvId::windows()],
            resolved: None,
            verified: Some(ConnectionVerified {
                ok: true,
                at: "2026-10-22T08:05:00Z".into(),
                env_ids: vec![EnvId::windows()],
            }),
        },
        facts: AssetFacts::default(),
        paths: vec![],
        services: vec![],
        served_hostnames: vec![],
        listening_ports: vec![],
        export: ExportFlags::default(),
        probe: AssetProbeInfo::default(),
    }
}

/// PRD 7.8：Cloudflare，两个环境都已就绪，选了 2 个域名和 1 个 Worker，example.com 关联 hk-edge
pub fn cloudflare() -> CliAsset {
    let ready = CliEnvState {
        installed: true,
        version: Some("3.99.0".into()),
        path: Some(r"C:\Users\me\AppData\Roaming\npm\wrangler.cmd".into()),
        authenticated: true,
        expired: false,
        account: Some("me@example.com".into()),
        accounts: Some(vec!["me@example.com".into(), "acme-corp".into()]),
        checked_at: "2026-11-02T09:00:00Z".into(),
    };
    CliAsset {
        tag: CliTag::Tag,
        id: "ast_01JB9CLI01".into(),
        name: "Cloudflare".into(),
        env_tag: EnvTag::Prod,
        summary: "DNS for the main domains and the edge API gateway Worker".into(),
        agent: AssetAgent {
            agents: vec!["claude-code".into()],
            mode: Mode::ReadOnly,
        },
        guardrails: Guardrails::default(),
        notes: String::new(),
        created_at: "2026-11-02T09:00:00Z".into(),
        updated_at: "2026-11-02T09:00:00Z".into(),
        cli_provider: CliProvider::Cloudflare,
        handle: "cloudflare".into(),
        account: Some("me@example.com".into()),
        cli: CliInfo {
            binary: CliBinary::Wrangler,
            env_states: BTreeMap::from([(EnvId::windows(), ready.clone()), (wsl(), ready)]),
            scope: vec![
                CliScopeItem {
                    id: "zone_1".into(),
                    kind: CliScopeKind::Zone,
                    name: "example.com".into(),
                    selected: true,
                    linked_asset_id: Some("ast_01JB3Q8Z6W".into()),
                    address: None,
                },
                CliScopeItem {
                    id: "zone_2".into(),
                    kind: CliScopeKind::Zone,
                    name: "personal.me".into(),
                    selected: false,
                    linked_asset_id: None,
                    address: None,
                },
                CliScopeItem {
                    id: "zone_3".into(),
                    kind: CliScopeKind::Zone,
                    name: "example.org".into(),
                    selected: true,
                    linked_asset_id: None,
                    address: None,
                },
                CliScopeItem {
                    id: "worker_1".into(),
                    kind: CliScopeKind::Worker,
                    name: "api-gateway".into(),
                    selected: true,
                    linked_asset_id: None,
                    address: None,
                },
            ],
        },
    }
}

/// PRD 3.3 的全局内容
pub fn skill_config() -> SkillConfig {
    SkillConfig {
        relation_notes: vec![RelationNote {
            id: "r1".into(),
            text: "hk-edge reverse-proxies api.example.com to the API containers on hk-edge; those containers use the PostgreSQL database on sg-db over the private network.".into(),
            replaces: None,
        }],
        conventions: vec![
            Convention { id: "c1".into(), text: "Deploy with docker compose in /opt/apps/<name>; never edit containers by hand".into() },
            Convention { id: "c2".into(), text: "Tell the user before restarting anything on a production server".into() },
        ],
        ..Default::default()
    }
}
