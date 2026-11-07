//! 渲染总 Skill（PRD 5.2、5.3、5.6、8.3、F-201）。内置英文模板随应用发布；
//! 探测来的值一律放进行内代码或表格单元格、限长 128，用户填写的文本原样输出。

use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

use minijinja::{AutoEscape, Environment};
use serde::Serialize;

use crate::model::asset::{Asset, CliAsset, CliProvider, CliScopeKind, EnvTag, ServerAsset};
use crate::model::compile::{CompiledFile, SkillConfig};

pub const TEMPLATE_VERSION: u32 = 1;
pub const DESCRIPTION_LIMIT: usize = 1024;
pub const HEALTH_CHECK: &str = include_str!("templates/health-check.md");
const TOC_THRESHOLD: usize = 100;

fn templates() -> &'static Environment<'static> {
    static ENV: OnceLock<Environment<'static>> = OnceLock::new();
    ENV.get_or_init(|| {
        let mut env = Environment::new();
        env.set_syntax(
            minijinja::syntax::SyntaxConfig::builder()
                .trim_blocks(true)
                .lstrip_blocks(true)
                .keep_trailing_newline(true)
                .build()
                .expect("syntax config"),
        );
        env.set_auto_escape_callback(|_| AutoEscape::None);
        env.add_template("skill", include_str!("templates/skill.md.j2"))
            .expect("skill template");
        env.add_template("server", include_str!("templates/server.md.j2"))
            .expect("server template");
        env.add_template("cli", include_str!("templates/cli.md.j2"))
            .expect("cli template");
        env
    })
}

fn render(name: &str, ctx: serde_json::Value) -> String {
    templates()
        .get_template(name)
        .and_then(|t| t.render(minijinja::Value::from(minijinja::value::Serde(&ctx))))
        .expect("built-in template renders")
}

pub fn env_word(tag: EnvTag) -> &'static str {
    match tag {
        EnvTag::Prod => "production",
        EnvTag::Staging => "staging",
        EnvTag::Dev => "development",
    }
}

fn title_case(s: &str) -> String {
    let mut c = s.chars();
    c.next()
        .map(|f| f.to_uppercase().chain(c).collect())
        .unwrap_or_default()
}

/// 行内代码：去掉反引号和控制字符，限长 128（PRD 8.3 规则 2）
pub fn code(s: &str) -> String {
    let clean: String = s.chars().filter(|c| *c != '`' && !c.is_control()).take(128).collect();
    format!("`{clean}`")
}

/// 表格单元格里的用户文本：竖线转义，换行并成空格
pub fn cell(s: &str) -> String {
    let one: String = s
        .split(['\r', '\n'])
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if one.is_empty() {
        "-".into()
    } else {
        one.replace('|', "\\|")
    }
}

/// 列表项里的用户文本：换行并成空格
fn one_line(s: &str) -> String {
    s.split(['\r', '\n'])
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// 系统描述这类探测值放在普通文本里时，只保留安全字符
fn plain_probe(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '.' | '_' | '-' | '/' | '(' | ')' | ',' | '+'))
        .take(64)
        .collect::<String>()
        .trim()
        .to_string()
}

/// 详情文件名：别名或标识转小写，`[a-z0-9-]` 以外的字符换成连字符；重名时按创建时间排后的加 `-2`（5.3）
pub fn detail_names(assets: &[&Asset]) -> BTreeMap<String, String> {
    let mut sorted: Vec<&&Asset> = assets.iter().collect();
    sorted.sort_by(|a, b| a.created_at().cmp(b.created_at()).then(a.id().cmp(b.id())));
    let mut used = BTreeSet::from(["health-check".to_string()]);
    let mut out = BTreeMap::new();
    for a in sorted {
        let base: String = a
            .handle()
            .to_lowercase()
            .chars()
            .map(|c| {
                if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' {
                    c
                } else {
                    '-'
                }
            })
            .collect();
        let mut name = base.clone();
        let mut n = 2;
        while used.contains(&name) {
            name = format!("{base}-{n}");
            n += 1;
        }
        used.insert(name.clone());
        out.insert(a.id().to_string(), name);
    }
    out
}

fn selected_scope(a: &CliAsset) -> Vec<&str> {
    a.cli
        .scope
        .iter()
        .filter(|s| s.selected)
        .map(|s| s.name.as_str())
        .collect()
}

/// 用途：用户写的用途，加上用途里没提到的站点（服务器）或勾选的范围（云平台）
pub fn role(a: &Asset) -> String {
    let summary = one_line(a.summary());
    let extra = match a {
        Asset::Vps(s) => {
            let sites: Vec<&str> = s
                .served_hostnames
                .iter()
                .map(String::as_str)
                .filter(|h| !summary.contains(h))
                .collect();
            if sites.is_empty() {
                String::new()
            } else {
                format!("serves {}", sites.join(", "))
            }
        }
        Asset::Cli(c) => selected_scope(c).join(", "),
    };
    [summary, extra]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("; ")
}

pub struct Description {
    pub text: String,
    pub raw_chars: usize,
}

/// F-201 AC2：超过 1024 字符时依次去掉站点名、缩短用途、只列前若干项并注明其余数量
pub fn description(assets: &[&Asset]) -> Description {
    let has_cli = assets.iter().any(|a| matches!(a, Asset::Cli(_)));
    let wrap = |list: &str| {
        if has_cli {
            format!(
                "The user's servers and cloud platforms and how to operate them — {list}. Use for any task on these servers, sites or cloud projects: deployments, logs, Docker containers, DNS, configuration, troubleshooting, or a health check of the servers."
            )
        } else {
            format!(
                "The user's servers and how to operate them — {list}. Use for any task on these servers or sites: deployments, logs, Docker containers, configuration, troubleshooting, or a health check of the servers."
            )
        }
    };
    let item = |a: &Asset, with_extra: bool, short: bool| {
        let r = if with_extra { role(a) } else { one_line(a.summary()) };
        let text = if short && r.chars().count() > 40 {
            format!("{}…", r.chars().take(39).collect::<String>())
        } else {
            r
        };
        let mut tail = vec![env_word(a.env_tag())];
        if a.agent().mode == crate::model::asset::Mode::ReadOnly {
            tail.push("read-only");
        }
        let tail = tail.join(", ");
        let inner = [text, tail]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("; ");
        format!("{} ({inner})", a.handle())
    };
    let len = |s: &str| s.chars().count();
    let full = wrap(
        &assets
            .iter()
            .map(|a| item(a, true, false))
            .collect::<Vec<_>>()
            .join(", "),
    );
    let raw_chars = len(&full);
    if raw_chars <= DESCRIPTION_LIMIT {
        return Description { text: full, raw_chars };
    }
    for short in [false, true] {
        let t = wrap(
            &assets
                .iter()
                .map(|a| item(a, false, short))
                .collect::<Vec<_>>()
                .join(", "),
        );
        if len(&t) <= DESCRIPTION_LIMIT {
            return Description { text: t, raw_chars };
        }
    }
    for n in (1..assets.len()).rev() {
        let head = assets[..n]
            .iter()
            .map(|a| item(a, false, true))
            .collect::<Vec<_>>()
            .join(", ");
        let t = wrap(&format!("{head} and {} more", assets.len() - n));
        if len(&t) <= DESCRIPTION_LIMIT {
            return Description { text: t, raw_chars };
        }
    }
    Description {
        text: wrap(&format!("{} resources", assets.len())),
        raw_chars,
    }
}

#[derive(Serialize)]
struct Row {
    handle: String,
    binary: String,
    role: String,
    env: &'static str,
    mode: &'static str,
    details: String,
}

pub struct RenderInput<'a> {
    pub assets: &'a [&'a Asset],
    /// 全部资源：云平台范围里的「关联服务器」要按 id 找别名
    pub all_assets: &'a [Asset],
    pub config: &'a SkillConfig,
    /// 该运行环境写法的笔记收件箱目录（正斜杠）
    pub inbox: &'a str,
    /// `Snapshot:` 日期；设置里关闭时为 None
    pub snapshot: Option<&'a str>,
}

pub struct Rendered {
    pub files: Vec<CompiledFile>,
    pub description: Description,
    pub body_lines: usize,
    /// 资源 id → 详情文件路径
    pub detail_paths: BTreeMap<String, String>,
}

/// 内置红线（5.5），任何档位都注入、不可删除
pub const BUILTIN_RULES: [&str; 4] = [
    "Never read or print credential files (`.env`, `*.pem`, `*.key`, `id_*`, `/etc/shadow`, `~/.ssh/`) and never use `docker inspect` to view environment variables.",
    "Never ask for or record passwords, private keys or IP addresses; connect only through the SSH alias.",
    "If a host does not match its details file, report the difference to the user instead of \"fixing\" the server to match the document.",
    "If CloudLink's guard blocks a command, report it to the user; never try to work around the block with scripts, encoding or other tools.",
];

pub fn render_skill(input: &RenderInput) -> Rendered {
    let names = detail_names(input.assets);
    let detail_paths: BTreeMap<String, String> = names
        .iter()
        .map(|(id, n)| (id.clone(), format!("references/{n}.md")))
        .collect();
    let description = description(input.assets);
    if input.assets.is_empty() {
        return Rendered {
            files: Vec::new(),
            description,
            body_lines: 0,
            detail_paths,
        };
    }
    let row = |a: &Asset| Row {
        handle: a.handle().to_string(),
        binary: a
            .as_cli()
            .map(|c| c.cli.binary.as_str().to_string())
            .unwrap_or_default(),
        role: cell(&role(a)),
        env: env_word(a.env_tag()),
        mode: a.agent().mode.as_str(),
        details: detail_paths[a.id()].clone(),
    };
    let servers: Vec<Row> = input
        .assets
        .iter()
        .filter(|a| a.as_server().is_some())
        .map(|a| row(a))
        .collect();
    let clis: Vec<Row> = input
        .assets
        .iter()
        .filter(|a| a.as_cli().is_some())
        .map(|a| row(a))
        .collect();
    let rules: Vec<String> = BUILTIN_RULES
        .iter()
        .map(|r| r.to_string())
        .chain(input.config.conventions.iter().map(|c| one_line(&c.text)))
        .collect();
    let example_name = input
        .assets
        .iter()
        .find(|a| a.as_server().is_some())
        .or(input.assets.first())
        .map(|a| names[a.id()].clone())
        .unwrap_or_default();
    let skill = render(
        "skill",
        serde_json::json!({
            "description": description.text.clone(),
            "snapshot": input.snapshot,
            "servers": servers,
            "clis": clis,
            "relationships": super::relations::lines(input.assets, input.config),
            "rules": rules,
            "inbox": input.inbox,
            "example_name": example_name,}),
    );
    let body_lines = skill
        .splitn(3, "---\n")
        .nth(2)
        .map(|b| b.trim_matches('\n').lines().count())
        .unwrap_or(0);

    let mut files = vec![CompiledFile {
        path: "SKILL.md".into(),
        content: skill,
    }];
    for a in input.assets {
        let content = match a {
            Asset::Vps(s) => render_server(s, input.snapshot),
            Asset::Cli(c) => render_cli(c, input.all_assets),
        };
        files.push(CompiledFile {
            path: detail_paths[a.id()].clone(),
            content: with_toc(content),
        });
    }
    files.push(CompiledFile {
        path: "references/health-check.md".into(),
        content: HEALTH_CHECK.to_string(),
    });
    Rendered {
        files,
        description,
        body_lines,
        detail_paths,
    }
}

/// 超过 100 行的参考文件，标题下加目录（5.3）
fn with_toc(content: String) -> String {
    if content.lines().count() <= TOC_THRESHOLD {
        return content;
    }
    let heads: Vec<&str> = content.lines().filter_map(|l| l.strip_prefix("## ")).collect();
    let toc: String = heads.iter().map(|h| format!("- {h}\n")).collect();
    match content.split_once("\n\n") {
        Some((title, rest)) => format!("{title}\n\n## Contents\n{toc}\n{rest}"),
        None => content,
    }
}

#[derive(Serialize)]
struct PathRow {
    key: String,
    path: String,
    label: String,
}

#[derive(Serialize)]
struct ServiceRow {
    name: String,
    kind: &'static str,
    image: String,
    ports: String,
    role: String,
    critical: &'static str,
}

pub fn render_server(a: &ServerAsset, snapshot_enabled: Option<&str>) -> String {
    let f = &a.facts;
    let alias = &a.connection.ssh_alias;
    let mut system = Vec::new();
    if let Some(os) = f.os.as_deref().map(plain_probe).filter(|s| !s.is_empty()) {
        system.push(os);
    }
    if let (Some(cpu), Some(mem)) = (f.cpu_cores, f.memory_total_mib) {
        system.push(format!(
            "{cpu} vCPU / {} GB RAM",
            ((f64::from(mem) / 1024.0).round() as u32).max(1)
        ));
    }
    if let Some(Some(p)) = &f.panel {
        let name = match p.kind {
            crate::model::asset::PanelType::OnePanel => "1Panel",
            crate::model::asset::PanelType::Bt => "aaPanel (BT)",
        };
        system.push(format!("managed by {name} ({})", plain_probe(&p.install_path)));
    }
    let rules: Vec<String> = a
        .guardrails
        .rules
        .iter()
        .map(|r| one_line(&r.text))
        .chain(a.services.iter().filter(|s| s.critical).map(|s| {
            let what = match s.kind {
                crate::model::asset::ServiceKind::Docker => "container",
                crate::model::asset::ServiceKind::Systemd => "service",
            };
            format!("Never stop or restart the {} {what} (critical)", code(&s.name))
        }))
        .collect();
    let resolved = match (&a.connection.resolved, a.export.resolved_connection) {
        (Some(r), true) => format!("HostName {}, User {}, Port {}", r.hostname, r.user, r.port),
        _ => String::new(),
    };
    let paths: Vec<PathRow> = a
        .paths
        .iter()
        .map(|p| PathRow {
            key: cell(&p.key),
            path: code(&p.path),
            label: cell(&p.label),
        })
        .collect();
    let services: Vec<ServiceRow> = a
        .services
        .iter()
        .map(|s| ServiceRow {
            name: code(&s.name),
            kind: s.kind.as_str(),
            image: match (&s.image, a.export.image) {
                (Some(i), true) => code(i),
                _ => "-".into(),
            },
            ports: if s.ports.is_empty() {
                "-".into()
            } else {
                s.ports
                    .iter()
                    .map(|p| {
                        code(&format!(
                            "{}:{}->{}/{}",
                            p.host_ip,
                            p.host_port,
                            p.container_port,
                            p.proto.as_str()
                        ))
                    })
                    .collect::<Vec<_>>()
                    .join(", ")
            },
            role: format!(
                "{}{}",
                s.role.as_deref().map(cell).unwrap_or_else(|| "-".into()),
                if s.missing { " (not seen in last probe)" } else { "" }
            ),
            critical: if s.critical { "yes" } else { "no" },
        })
        .collect();
    let ports: Vec<String> = if a.export.listening_ports {
        a.listening_ports
            .iter()
            .map(|p| code(&format!("{}:{}/{}", p.addr, p.port, p.proto.as_str())))
            .collect()
    } else {
        Vec::new()
    };
    let snapshot = snapshot_enabled
        .and(a.probe.last_success_at.as_deref())
        .map(|t| t.chars().take(10).collect::<String>());
    render(
        "server",
        serde_json::json!({
            "alias": alias,
            "name": one_line(&a.name),
            "env_title": title_case(env_word(a.env_tag)),
            "mode": a.agent.mode.as_str(),
            "snapshot": snapshot,
            "system": system.join(" | "),
            "role": role(&Asset::Vps(a.clone())),
            "resolved": resolved,
            "rules": rules,
            "paths": paths,
            "services": services,
            "sites": a.served_hostnames.iter().map(|h| code(h)).collect::<Vec<_>>().join(", "),
            "ports": ports,
            "notes": a.notes.trim(),}),
    )
}

fn scope_word(k: CliScopeKind) -> &'static str {
    match k {
        CliScopeKind::Zone => "DNS zone",
        CliScopeKind::Worker => "Worker",
        CliScopeKind::Pages => "Pages project",
        CliScopeKind::Project => "Project",
        CliScopeKind::Instance => "Compute instance",
    }
}

/// 同一家接了多个账号时，每条命令都要指明账号（F-104 AC5），不写凭据、不引入 Token
fn account_flag(p: CliProvider, account: &str) -> String {
    match p {
        CliProvider::Cloudflare => format!(
            "Target this account on every command: set `CLOUDFLARE_ACCOUNT_ID` to the id of {} from `wrangler whoami`.",
            code(account)
        ),
        CliProvider::Vercel => format!(
            "Target this team on every command: append {}.",
            code(&format!("--scope {account}"))
        ),
        CliProvider::Oracle => format!(
            "Target this profile on every command: append {}.",
            code(&format!("--profile {account}"))
        ),
    }
}

#[derive(Serialize)]
struct ScopeRow {
    kind: &'static str,
    name: String,
    linked: String,
}

pub fn render_cli(a: &CliAsset, all: &[Asset]) -> String {
    let account = a
        .account
        .clone()
        .or_else(|| a.cli.env_states.values().find_map(|s| s.account.clone()));
    let scope: Vec<ScopeRow> = a
        .cli
        .scope
        .iter()
        .filter(|s| s.selected)
        .map(|s| ScopeRow {
            kind: scope_word(s.kind),
            name: code(&s.name),
            linked: s
                .linked_asset_id
                .as_deref()
                .and_then(|id| all.iter().find(|x| x.id() == id && x.as_server().is_some()))
                .map(|x| code(x.handle()))
                .unwrap_or_else(|| "-".into()),
        })
        .collect();
    render(
        "cli",
        serde_json::json!({
            "handle": a.handle,
            "name": one_line(&a.name),
            "env_title": title_case(env_word(a.env_tag)),
            "mode": a.agent.mode.as_str(),
            "binary": a.cli.binary.as_str(),
            "account": account.as_deref().map(code),
            "account_flag": account.as_deref().map(|x| account_flag(a.cli_provider, x)),
            "role": one_line(&a.summary),
            "rules": a.guardrails.rules.iter().map(|r| one_line(&r.text)).collect::<Vec<_>>(),
            "scope": scope,
            "notes": a.notes.trim(),}),
    )
}
