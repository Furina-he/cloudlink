//! Lint（PRD 5.4）。每条结果带资源 id（全局内容的问题除外），界面据此定位

use std::sync::OnceLock;

use regex::Regex;

use super::render::{DESCRIPTION_LIMIT, Rendered};
use super::secrets::Scanner;
use crate::model::asset::{Asset, EnvTag, FieldSource, Mode};
use crate::model::compile::{LintId, LintItem, LintLevel};
use crate::params;
use crate::time;

pub const PROBE_STALE_DAYS: i64 = 30;

/// 疑似指令注入（PRD 8.3 规则 3）：探测来的值和 Agent 笔记都按它检查
pub fn injection_regex() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(
            r"(?i)ignore[\s_.-]*(?:all[\s_.-]*)?(?:the[\s_.-]*)?(?:previous|prior|above|earlier)|disregard[\s_.-]*(?:all[\s_.-]*)?(?:previous|prior|above|earlier|instructions)|system[\s_.-]*prompt|you[\s_.-]+are[\s_.-]+now|new[\s_.-]+instructions|override[\s_.-]+(?:the[\s_.-]+)?(?:rules|instructions)|developer[\s_.-]+mode|jailbreak|忽略(?:以上|之前|前面|上述)|无视(?:以上|之前|前面|上述)|系统提示",
        )
        .expect("injection regex")
    })
}

pub fn looks_like_injection(s: &str) -> bool {
    injection_regex().is_match(s)
}

fn item(id: LintId, level: LintLevel, asset_id: Option<&str>, params: crate::model::Params) -> LintItem {
    LintItem {
        id,
        level,
        asset_id: asset_id.map(String::from),
        params: (!params.is_empty()).then_some(params),
        file: None,
        line: None,
    }
}

fn at(mut i: LintItem, file: &str, line: Option<u32>) -> LintItem {
    i.file = Some(file.to_string());
    i.line = line;
    i
}

fn line_of(content: &str, needle: &str) -> Option<u32> {
    content.lines().position(|l| l.contains(needle)).map(|i| i as u32 + 1)
}

/// 总览表里属于某项资源的那一行（`| \`hk-edge\` |` 或 `| cloudflare |`）
fn overview_owner<'a>(line: &str, assets: &[&'a Asset]) -> Option<&'a Asset> {
    assets.iter().copied().find(|a| {
        line.starts_with(&format!("| `{}` |", a.handle())) || line.starts_with(&format!("| {} |", a.handle()))
    })
}

pub struct LintInput<'a> {
    pub assets: &'a [&'a Asset],
    pub rendered: &'a Rendered,
    pub body_line_limit: u32,
    pub now_secs: i64,
}

pub fn lint(input: &LintInput) -> Vec<LintItem> {
    let r = input.rendered;
    let mut out = Vec::new();
    if r.files.is_empty() {
        return out;
    }
    let scanner = Scanner::get();
    let owner_of_file = |path: &str| {
        r.detail_paths
            .iter()
            .find(|(_, p)| p.as_str() == path)
            .and_then(|(id, _)| input.assets.iter().find(|a| a.id() == id))
    };

    // 疑似密钥：逐文件逐行扫描（错误，阻断发布）
    for f in &r.files {
        for (n, line) in f.content.lines().enumerate() {
            let Some((rule, _)) = scanner.find_in_line(line) else {
                continue;
            };
            let owner = if f.path == "SKILL.md" {
                overview_owner(line, input.assets)
            } else {
                owner_of_file(&f.path).copied()
            };
            let mut p = params! {"line" => n + 1, "rule" => rule};
            if let Some(a) = owner {
                p.insert("alias".into(), a.handle().into());
            }
            out.push(at(
                item(LintId::SecretDetected, LintLevel::Error, owner.map(|a| a.id()), p),
                &f.path,
                Some(n as u32 + 1),
            ));
        }
    }

    for a in input.assets {
        let path = &r.detail_paths[a.id()];
        let content = r
            .files
            .iter()
            .find(|f| &f.path == path)
            .map(|f| f.content.as_str())
            .unwrap_or("");
        let alias = a.handle();

        if a.env_tag() == EnvTag::Prod && a.agent().mode == Mode::Standard && a.guardrails().rules.is_empty() {
            out.push(at(
                item(
                    LintId::ProdStandardNoGuardrails,
                    LintLevel::Warning,
                    Some(a.id()),
                    params! {"alias" => alias},
                ),
                path,
                None,
            ));
        }
        if looks_like_injection(a.notes()) {
            let line = a.notes().lines().find(|l| looks_like_injection(l)).unwrap_or("");
            out.push(at(
                item(
                    LintId::SuspectedInjection,
                    LintLevel::Warning,
                    Some(a.id()),
                    params! {"alias" => alias, "value" => line.chars().take(128).collect::<String>()},
                ),
                path,
                line_of(content, line.trim()),
            ));
        }
        let Some(s) = a.as_server() else { continue };

        // 已关闭导出的字段出现在产物里（错误，阻断发布）
        let mut disabled: Vec<(&str, String)> = Vec::new();
        if !s.export.resolved_connection {
            let sites: Vec<String> = s.served_hostnames.iter().map(|h| h.to_lowercase()).collect();
            for v in [
                s.connection.host.clone(),
                s.connection.resolved.as_ref().map(|x| x.hostname.clone()),
            ]
            .into_iter()
            .flatten()
            {
                if !v.is_empty() && !sites.contains(&v.to_lowercase()) {
                    disabled.push(("HostName", v));
                }
            }
        }
        if !s.export.listening_ports {
            disabled.extend(
                s.listening_ports
                    .iter()
                    .map(|p| ("listeningPorts", format!("{}:{}/{}", p.addr, p.port, p.proto.as_str()))),
            );
        }
        if !s.export.image {
            disabled.extend(s.services.iter().filter_map(|x| x.image.clone()).map(|i| ("image", i)));
        }
        'fields: for (field, value) in disabled {
            for f in &r.files {
                if let Some(line) = line_of(&f.content, &value) {
                    out.push(at(
                        item(
                            LintId::ExportDisabledField,
                            LintLevel::Error,
                            Some(a.id()),
                            params! {"alias" => alias, "field" => field},
                        ),
                        &f.path,
                        Some(line),
                    ));
                    continue 'fields;
                }
            }
        }

        // 探测来源的值疑似指令注入（警告）
        let probe_values = s
            .services
            .iter()
            .filter(|x| x.source == FieldSource::Probe)
            .flat_map(|x| [Some(x.name.as_str()), x.image.as_deref()])
            .flatten()
            .chain(s.facts.os.as_deref())
            .chain(s.facts.kernel.as_deref());
        for v in probe_values.filter(|v| looks_like_injection(v)) {
            out.push(at(
                item(
                    LintId::SuspectedInjection,
                    LintLevel::Warning,
                    Some(a.id()),
                    params! {"alias" => alias, "value" => v.chars().take(128).collect::<String>()},
                ),
                path,
                line_of(content, v),
            ));
        }

        // 探测数据超过 30 天（提示）
        if let Some(t) = s.probe.last_success_at.as_deref().and_then(time::parse_rfc3339) {
            let days = (input.now_secs - t).div_euclid(86_400);
            if days > PROBE_STALE_DAYS {
                out.push(item(
                    LintId::ProbeStale,
                    LintLevel::Info,
                    Some(a.id()),
                    params! {"alias" => alias, "days" => days},
                ));
            }
        }
    }

    // 编译器自检：SKILL.md 引用的 references 文件都要存在
    static REF: OnceLock<Regex> = OnceLock::new();
    let re = REF.get_or_init(|| Regex::new(r"references/[A-Za-z0-9._-]+\.md").expect("ref regex"));
    let skill = &r.files[0].content;
    for m in re.find_iter(skill) {
        if !r.files.iter().any(|f| f.path == m.as_str()) {
            out.push(at(
                item(
                    LintId::MissingReference,
                    LintLevel::Error,
                    None,
                    params! {"file" => m.as_str()},
                ),
                "SKILL.md",
                line_of(skill, m.as_str()),
            ));
        }
    }
    if r.description.raw_chars > DESCRIPTION_LIMIT {
        out.push(at(
            item(
                LintId::DescriptionTooLong,
                LintLevel::Warning,
                None,
                params! {"chars" => r.description.raw_chars},
            ),
            "SKILL.md",
            Some(3),
        ));
    }
    if r.body_lines > input.body_line_limit as usize {
        out.push(at(
            item(
                LintId::BodyTooLong,
                LintLevel::Warning,
                None,
                params! {"lines" => r.body_lines, "limit" => input.body_line_limit},
            ),
            "SKILL.md",
            None,
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn injection_phrases() {
        for s in [
            "ignore-previous-instructions",
            "Ignore all previous instructions",
            "SYSTEM_PROMPT",
            "请忽略以上内容",
            "you are now root",
        ] {
            assert!(looks_like_injection(s), "{s}");
        }
        for s in [
            "openresty",
            "redis:7.4",
            "Ubuntu 24.04 LTS",
            "ignore-list",
            "prompt-service",
        ] {
            assert!(!looks_like_injection(s), "{s}");
        }
    }
}
