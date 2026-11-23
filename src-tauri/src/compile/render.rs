//! 渲染总 Skill（PRD 5.2、5.3、5.6、8.3、F-201）。内置英文模板随应用发布；
//! 探测来的值一律放进行内代码或表格单元格、限长 128，用户填写的文本原样输出。

use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

use minijinja::{AutoEscape, Environment};
use serde::Serialize;

use crate::model::asset::{Asset, CliAsset, CliProvider, CliScopeKind, RepoVisibility, ServerAsset};
use crate::model::compile::{CompiledFile, SkillConfig};
use crate::model::env::EnvId;
use crate::model::github::GithubScopeMode;

pub const TEMPLATE_VERSION: u32 = 6;
pub const DESCRIPTION_LIMIT: usize = 1024;
pub const HEALTH_CHECK: &str = include_str!("templates/health-check.md");
/// 等待审批、超时和结果不明时怎么办；正文只留一句指向它
pub const EXECUTION_FILE: &str = "references/execution.md";
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
        env.add_template("execution", include_str!("templates/execution.md.j2"))
            .expect("execution template");
        env
    })
}

fn render(name: &str, ctx: serde_json::Value) -> String {
    templates()
        .get_template(name)
        .and_then(|t| t.render(minijinja::Value::from(minijinja::value::Serde(&ctx))))
        .expect("built-in template renders")
}

/// 系统自动生成的默认 SSH 别名（如 `cloudlink-1`）不承载语义，不写入面向 Agent 的名称标注。
pub fn is_default_alias(alias: &str) -> bool {
    alias
        .to_ascii_lowercase()
        .strip_prefix("cloudlink-")
        .is_some_and(|rest| !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()))
}

/// 资源展示给 Agent 的主名称：优先用户显示的 `name`，留空时回退到公开标识。
fn display_name(asset: &Asset) -> String {
    let name = one_line(asset.name());
    if name.is_empty() { public_handle(asset) } else { name }
}

/// 非系统默认（非 `cloudlink-N`）、未触发隐私脱敏、且与显示名称不同（忽略大小写）的语义 SSH Host。
fn semantic_alias(server: &ServerAsset) -> Option<String> {
    let raw = server.connection.ssh_alias.trim();
    if raw.is_empty() || is_default_alias(raw) {
        return None;
    }
    let public = server_handle(server);
    if public != raw {
        return None;
    }
    let name = one_line(&server.name);
    if name.is_empty() || name.eq_ignore_ascii_case(&public) {
        return None;
    }
    Some(public)
}

/// description 中的资源主语：始终以显示名称为主体；有不同语义 SSH 别名时附注 `名称 / alias`。
fn description_subject(asset: &Asset) -> String {
    let name = display_name(asset);
    match asset.as_server().and_then(semantic_alias) {
        Some(alias) => format!("{name} / {alias}"),
        None => name,
    }
}

/// SKILL.md 总览表第一列：主显显示名称；有不同语义 SSH 别名时同格附注 `名称 (\`alias\`)`。
fn overview_label(asset: &Asset) -> String {
    let name = cell(&display_name(asset));
    match asset.as_server().and_then(semantic_alias) {
        Some(alias) => format!("{name} ({})", code(&alias)),
        None => name,
    }
}

/// references/*.md 一级标题：主显显示名称；有不同语义 SSH 别名时 `# 名称 (alias)`。
fn detail_heading(asset: &Asset) -> String {
    let name = display_name(asset);
    match asset.as_server().and_then(semantic_alias) {
        Some(alias) => format!("{name} ({alias})"),
        None => name,
    }
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

/// 旧地址别名只在私有路由中保留；不改数据库、显示名称或用户 SSH 配置（8.7.6）。
pub fn server_handle(server: &ServerAsset) -> String {
    let alias = &server.connection.ssh_alias;
    let private_alias = !server.export.resolved_connection
        && [
            server.connection.host.as_deref(),
            server.connection.resolved.as_ref().map(|r| r.hostname.as_str()),
        ]
        .into_iter()
        .flatten()
        .any(|host| {
            !host.is_empty()
                && !server
                    .served_hostnames
                    .iter()
                    .any(|site| site.eq_ignore_ascii_case(host))
                && [
                    host.to_ascii_lowercase(),
                    host.replace(['.', ':'], "-"),
                    host.replace(['.', ':'], "_"),
                ]
                .iter()
                .any(|value| alias.to_ascii_lowercase().contains(&value.to_ascii_lowercase()))
        });
    if private_alias {
        format!("server-{}", server.id.to_ascii_lowercase().replace('_', "-"))
    } else {
        alias.clone()
    }
}

fn public_handle(asset: &Asset) -> String {
    asset
        .as_server()
        .map(server_handle)
        .unwrap_or_else(|| asset.handle().to_string())
}

/// 详情文件名：别名或标识转小写，`[a-z0-9-]` 以外的字符换成连字符；重名时按创建时间排后的加 `-2`（5.3）。
/// 两份固定的参考文件占着自己的名字。
pub fn detail_names(assets: &[&Asset]) -> BTreeMap<String, String> {
    let mut sorted: Vec<&&Asset> = assets.iter().collect();
    sorted.sort_by(|a, b| a.created_at().cmp(b.created_at()).then(a.id().cmp(b.id())));
    let mut used = BTreeSet::from(["health-check".to_string(), "execution".to_string()]);
    let mut out = BTreeMap::new();
    for a in sorted {
        let base: String = public_handle(a)
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

/// 云平台／GitHub 写入 description 与总览表时的精简范围概括（P10d）：
/// 超过 3 项时不再全量平铺，详细清单保留在各自的 `references/*.md` 中。
fn compact_cli_scope(c: &CliAsset) -> String {
    let items = selected_scope(c);
    let n = items.len();
    if c.cli_provider == CliProvider::Github {
        let owner = c
            .github
            .as_ref()
            .and_then(|g| g.owner.as_ref())
            .map(|o| one_line(&o.login))
            .filter(|s| !s.is_empty())
            .or_else(|| c.account.as_deref().map(one_line).filter(|s| !s.is_empty()));
        return match (owner, n) {
            (Some(o), 0) => o,
            (None, 0) => String::new(),
            (_, 1..=3) => items.join(", "),
            (Some(o), n) => format!("{o}, {n} repos"),
            (None, n) => format!("{} +{} more", items[..3].join(", "), n - 3),
        };
    }
    match n {
        0 => String::new(),
        1..=3 => items.join(", "),
        _ => format!("{} +{} more", items[..3].join(", "), n - 3),
    }
}

/// 用途：用户写的用途，加上用途里没提到的站点（服务器）或精简后的云平台范围
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
        Asset::Cli(c) => compact_cli_scope(c),
    };
    [summary, extra]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("; ")
}

/// 用途留空、也没有站点或范围可写时的替代说明：服务器补充探测到的服务名。
/// 只用在 description 和总览表，让没填用途的资源仍能对上任务；详情文件的 Role 只写用户填的。
fn stand_in(a: &Asset, with_services: bool) -> String {
    if let (Asset::Vps(s), true) = (a, with_services) {
        let mut services: Vec<_> = s.services.iter().filter(|x| !x.missing).collect();
        services.sort_by_key(|x| !x.critical);
        // 探测来的名字进了常驻的 description，只收常见的服务名写法，疑似指令的不收（8.3）
        let names: Vec<String> = services
            .iter()
            .map(|x| x.name.as_str())
            .filter(|n| {
                !n.is_empty()
                    && n.len() <= 64
                    && n.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-@".contains(&b))
                    && !super::lint::looks_like_injection(n)
            })
            .take(5)
            .map(code)
            .collect();
        if !names.is_empty() {
            return format!("runs {}", names.join(", "));
        }
    }
    String::new()
}

/// 总览表和 description 里的用途
fn role_or_stand_in(a: &Asset) -> String {
    let r = role(a);
    if r.is_empty() { stand_in(a, true) } else { r }
}

/// frontmatter 的值写成 YAML 双引号字符串。用途里的 `: `、` #`、引号放在裸值里，
/// 严格的 YAML 解析器会判整段 frontmatter 无效。
fn yaml_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            c if c.is_control() || matches!(c, '\u{2028}' | '\u{2029}' | '\u{feff}') => out.push(' '),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

pub struct Description {
    pub text: String,
    pub raw_chars: usize,
}

/// F-201 AC2：超过 1024 字符时依次去掉站点名、缩短用途、只列前若干项并注明其余数量。
/// 只写「有什么、管什么」：档位随时会切，而 description 在会话开始时就加载了，写进去只会过期。
pub fn description(assets: &[&Asset]) -> Description {
    let has_server = assets.iter().any(|a| a.as_server().is_some());
    let has_cli = assets.iter().any(|a| a.as_cli().is_some());
    // F-110：接了 GitHub 时，仓库相关的任务也要能触发这份 Skill
    let has_github = assets
        .iter()
        .any(|a| matches!(a, Asset::Cli(c) if c.cli_provider == CliProvider::Github));
    let has_cloud = assets
        .iter()
        .any(|a| matches!(a, Asset::Cli(c) if c.cli_provider != CliProvider::Github));
    let subject = match (has_server, has_cli) {
        (true, true) => "servers and cloud platforms",
        (false, true) => "cloud platforms",
        _ => "servers",
    };
    let mut targets = Vec::new();
    if has_server || !has_cli {
        targets.extend(["servers", "sites"]);
    }
    if has_cloud {
        targets.push("cloud projects");
    }
    if has_github {
        targets.push("repositories");
    }
    let targets = match targets.split_last() {
        Some((last, [])) => last.to_string(),
        Some((last, rest)) => format!("{} or {last}", rest.join(", ")),
        None => String::new(),
    };
    let mut topics = vec!["deployments", "logs"];
    if has_server || !has_cli {
        topics.push("Docker containers");
    }
    if has_cloud {
        topics.push("DNS");
    }
    let topics = if has_server || !has_cli {
        format!(
            "{}, configuration, troubleshooting, or a health check of the servers",
            topics.join(", ")
        )
    } else {
        format!("{}, configuration or troubleshooting", topics.join(", "))
    };
    let wrap = |list: &str| {
        format!("The user's {subject} and how to operate them — {list}. Use for any task on these {targets}: {topics}.")
    };
    let item = |a: &Asset, with_extra: bool, short: bool| {
        let r = if with_extra { role(a) } else { one_line(a.summary()) };
        let r = if r.is_empty() { stand_in(a, with_extra) } else { r };
        let text = if short && r.chars().count() > 40 {
            format!("{}…", r.chars().take(39).collect::<String>())
        } else {
            r
        };
        let label = description_subject(a);
        if text.is_empty() {
            label
        } else {
            format!("{label} ({text})")
        }
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
    label: String,
    binary: String,
    role: String,
    details: String,
}

pub struct RenderInput<'a> {
    pub env_id: &'a EnvId,
    /// 已解析为该运行环境写法的受管 console sidecar 绝对路径。
    pub runner: &'a str,
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
    "Never ask for or record passwords, private keys or IP addresses; use the Connect entry in the resource's details file.",
    "If a host does not match its details file, report the difference to the user instead of \"fixing\" the server to match the document.",
    "If CloudLink's guard blocks a command, report it to the user; never try to work around the block with scripts, encoding or other tools.",
];

/// Windows Agent 可用 Git Bash 或 PowerShell；分别引用，不截断路径、不拼远端 shell。
struct ExecutionEntry<'a> {
    env_id: &'a EnvId,
    runner: &'a str,
}

impl ExecutionEntry<'_> {
    fn call(&self, op: &str, asset_id: Option<&str>, tail: &str, powershell: bool) -> String {
        let quote = |s: &str| {
            if powershell {
                format!("'{}'", s.replace('\'', "''"))
            } else {
                format!("'{}'", s.replace('\'', "'\\''"))
            }
        };
        let mut command = format!("{}{} {op}", if powershell { "& " } else { "" }, quote(self.runner));
        if op != "status" {
            command.push_str(&format!(" --env {}", quote(self.env_id.as_str())));
        }
        if let Some(id) = asset_id {
            command.push_str(&format!(" --asset {}", quote(id)));
        }
        if !tail.is_empty() {
            command.push(' ');
            command.push_str(tail);
        }
        command
    }

    fn powershell(&self, op: &str, id: Option<&str>, tail: &str) -> Option<String> {
        (self.env_id == &EnvId::windows()).then(|| self.call(op, id, tail, true))
    }
}

pub fn render_skill(input: &RenderInput) -> Rendered {
    let entry = ExecutionEntry {
        env_id: input.env_id,
        runner: input.runner,
    };
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
        label: overview_label(a),
        binary: a
            .as_cli()
            .map(|c| c.cli.binary.as_str().to_string())
            .unwrap_or_default(),
        role: cell(&role_or_stand_in(a)),
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
    let title = match (servers.is_empty(), clis.is_empty()) {
        (false, false) => "Servers and cloud platforms",
        (true, false) => "Cloud platforms",
        _ => "Servers",
    };
    let skill = render(
        "skill",
        serde_json::json!({
            "description": yaml_string(&description.text),
            "title": title,
            "snapshot": input.snapshot,
            "servers": servers,
            "clis": clis,
            "relationships": super::relations::lines(input.assets, input.config),
            "rules": rules,
            "inbox": input.inbox,
            "example_name": example_name,}),
    );
    let execution = render(
        "execution",
        serde_json::json!({
            "wait": entry.call("wait", None, "'<requestId.ownerToken>'", false),
            "wait_ps": entry.powershell("wait", None, "'<requestId.ownerToken>'"),
            "status": entry.call("status", None, "", false),
            "status_ps": entry.powershell("status", None, ""),}),
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
            Asset::Vps(s) => render_server(s, input.snapshot, &entry),
            Asset::Cli(c) => render_cli(c, input.all_assets, &entry),
        };
        files.push(CompiledFile {
            path: detail_paths[a.id()].clone(),
            content: with_toc(content),
        });
    }
    files.push(CompiledFile {
        path: EXECUTION_FILE.into(),
        content: execution,
    });
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

fn render_server(a: &ServerAsset, snapshot_enabled: Option<&str>, entry: &ExecutionEntry) -> String {
    let f = &a.facts;
    let alias = server_handle(a);
    let use_entry = true;
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
            format!("Stopping or restarting the {} {what} is high risk (critical); request the user's one-time approval through the CloudLink runner", code(&s.name))
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
    let asset = Asset::Vps(a.clone());
    render(
        "server",
        serde_json::json!({
            "heading": detail_heading(&asset),
            "alias": alias,
            "execution": use_entry.then(|| entry.call("exec", Some(&a.id), "-- '<command>'", false)),
            "execution_ps": use_entry.then(|| entry.powershell("exec", Some(&a.id), "-- '<command>'")).flatten(),
            "put": use_entry.then(|| entry.call("put", Some(&a.id), "-- '<localFile>' '<remoteFile>'", false)),
            "get": use_entry.then(|| entry.call("get", Some(&a.id), "-- '<remoteFile>' '<localFile>'", false)),
            "put_ps": use_entry.then(|| entry.powershell("put", Some(&a.id), "-- '<localFile>' '<remoteFile>'")).flatten(),
            "get_ps": use_entry.then(|| entry.powershell("get", Some(&a.id), "-- '<remoteFile>' '<localFile>'")).flatten(),
            "mode": a.agent.mode.as_str(),
            "snapshot": snapshot,
            "system": system.join(" | "),
            "role": role(&asset),
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
        CliScopeKind::Repo => "Repository",
    }
}

/// 同一家接了多个账号时，每条命令都要指明账号（F-104 AC5），不写凭据、不引入 Token
fn account_flag(p: CliProvider, account: &str) -> String {
    match p {
        CliProvider::Cloudflare => format!(
            "Target this account on every command: set `CLOUDFLARE_ACCOUNT_ID` to the id of {} from `cf auth whoami`. Do not add `--profile`.",
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
        // GitHub 的 owner 与有效登录身份由分环境快照独立输出。
        CliProvider::Github => "The repository owner is not the active `gh` login; never switch accounts to expand access. The `gh` identity does not identify SSH Git or custom Git credential helpers.".into(),
    }
}

#[derive(Serialize)]
struct ScopeRow {
    kind: &'static str,
    name: String,
    linked: String,
}

#[derive(Serialize)]
struct RepoRow {
    name: String,
    branch: String,
    visibility: &'static str,
}

fn render_cli(a: &CliAsset, all: &[Asset], entry: &ExecutionEntry) -> String {
    let github = a.github.as_ref();
    let github_snapshot = github.and_then(|config| config.env_states.get(entry.env_id));
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
                .map(overview_label)
                .unwrap_or_else(|| "-".into()),
        })
        .collect();
    let repos: Vec<RepoRow> = a
        .cli
        .scope
        .iter()
        .filter(|s| s.selected && s.kind == CliScopeKind::Repo)
        .map(|s| RepoRow {
            name: code(&s.name),
            branch: s.default_branch.as_deref().map(code).unwrap_or_else(|| "-".into()),
            visibility: s.visibility.map(RepoVisibility::as_str).unwrap_or("-"),
        })
        .collect();
    let cloud_scope = (a.cli_provider != CliProvider::Github).then(|| a.effective_cloud_scope());
    let cloud_auto = cloud_scope
        .as_ref()
        .is_some_and(|config| config.mode == crate::model::asset::CloudScopeMode::Auto);
    let cloud_excluded: Vec<String> = cloud_scope
        .as_ref()
        .filter(|config| config.mode == crate::model::asset::CloudScopeMode::Auto)
        .map(|config| {
            config
                .excluded_ids
                .iter()
                .map(|id| {
                    a.cli
                        .scope
                        .iter()
                        .find(|s| &s.id == id)
                        .map_or_else(|| code(id), |s| format!("{} ({})", code(&s.name), code(&s.id)))
                })
                .collect()
        })
        .unwrap_or_default();
    let heading = detail_heading(&Asset::Cli(a.clone()));
    render(
        "cli",
        serde_json::json!({
            "heading": heading,
            "mode": a.agent.mode.as_str(),
            "binary": a.cli.binary.as_str(),
            "execution": Some(entry.call("exec", Some(&a.id), "-- <command arguments>", false)),
            "execution_ps": entry.powershell("exec", Some(&a.id), "-- <command arguments>"),
            "discover": entry.call("discover", Some(&a.id), "", false),
            "discover_ps": entry.powershell("discover", Some(&a.id), ""),
            "git": (a.cli_provider == CliProvider::Github).then(|| entry.call("exec", Some(&a.id), "--tool git -- <git arguments>", false)),
            "git_ps": (a.cli_provider == CliProvider::Github).then(|| entry.powershell("exec", Some(&a.id), "--tool git -- <git arguments>")).flatten(),
            "github_owner": github.and_then(|config| config.owner.as_ref()).map(|owner| code(&owner.login)),
            "github_identity": github_snapshot.and_then(|snapshot| snapshot.identity.as_ref()).map(|identity| code(&identity.login)),
            "github_host": code(github.map(|config| config.host.as_str()).unwrap_or("github.com")),
            "github_auto": github.is_some_and(|config| config.mode == GithubScopeMode::Auto && !config.migration_pending),
            "github_status": github_snapshot.map(|snapshot| serde_json::to_value(snapshot.status).expect("snapshot status")),
            "github_excluded": github.map(|config| config.excluded_repo_ids.iter().map(|id| code(id)).collect::<Vec<_>>()).unwrap_or_default(),
            "cloud_auto": cloud_auto,
            "cloud_excluded": cloud_excluded,
            "account": account.as_deref().map(code),
            "account_flag": account.as_deref().map(|x| account_flag(a.cli_provider, x)),
            "role": one_line(&a.summary),
            "provider_note": (a.cli_provider == CliProvider::Cloudflare).then_some(
                "Use `cf` for this account. Find a command with `cf cli search \"<task>\"` and preview a change with `--dry-run`. CloudLink supplies the account; do not add `--profile`. Live logs and changing a single secret currently go outside CloudLink."
            ),
            "rules": a.guardrails.rules.iter().map(|r| one_line(&r.text)).collect::<Vec<_>>(),
            "github": a.cli_provider == CliProvider::Github,
            "scope": scope,
            "repos": repos,
            "notes": a.notes.trim(),}),
    )
}
