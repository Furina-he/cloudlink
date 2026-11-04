//! 密钥扫描（F-205）：内置 gitleaks 规则集（MIT，见 THIRD_PARTY_NOTICES），外加 CloudLink 自己的几条
//! （`password=` 这类赋值、私钥文件头）。同一套规则也用于 Agent 笔记和操作记录的检查与脱敏（P4c）。

use std::sync::OnceLock;

use regex::{Regex, RegexBuilder};
use serde::Deserialize;

#[derive(Deserialize)]
struct RuleFile {
    global: GlobalAllow,
    rules: Vec<RawRule>,
}

#[derive(Deserialize)]
struct GlobalAllow {
    regexes: Vec<String>,
    stopwords: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRule {
    id: String,
    regex: String,
    keywords: Vec<String>,
    entropy: Option<f64>,
    secret_group: Option<usize>,
    #[serde(default)]
    allowlists: Vec<RawAllow>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAllow {
    #[serde(default)]
    regexes: Vec<String>,
    #[serde(default)]
    stopwords: Vec<String>,
    regex_target: Option<String>,
    condition: Option<String>,
}

struct Allow {
    regexes: Vec<Regex>,
    stopwords: Vec<String>,
    /// `match`（整段命中）或 `line`；默认是提取出的密钥
    target: Option<String>,
    and: bool,
}

struct Rule {
    id: String,
    regex: Regex,
    keywords: Vec<String>,
    entropy: Option<f64>,
    secret_group: Option<usize>,
    allows: Vec<Allow>,
}

pub struct Scanner {
    rules: Vec<Rule>,
    global_regexes: Vec<Regex>,
    global_stopwords: Vec<String>,
}

fn build(pattern: &str) -> Option<Regex> {
    RegexBuilder::new(pattern)
        .size_limit(64 << 20)
        .dfa_size_limit(64 << 20)
        .build()
        .ok()
}

/// CloudLink 自己的规则：gitleaks 不覆盖、但 PRD 5.4 点名要拦的
const EXTRA_RULES: &[(&str, &str, &[&str])] = &[
    (
        "password-assignment",
        r#"(?i)(?:password|passwd|pwd|passphrase|secret|token|api[_-]?key)["']?\s*[:=]\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"'`<>]+))"#,
        &["pass", "pwd", "secret", "token", "key"],
    ),
    (
        "private-key-header",
        r"-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----",
        &["private key"],
    ),
    ("anthropic-api-key-any", r"\bsk-ant-[A-Za-z0-9_-]{20,}", &["sk-ant-"]),
];

/// 占位符：`password=<your password>`、`password=***` 之类不算
fn is_placeholder(secret: &str) -> bool {
    secret.starts_with(['<', '$', '{', '%'])
        || secret.chars().all(|c| c == '*')
        || secret.eq_ignore_ascii_case("[REDACTED]")
        || secret == "[已隐藏]"
}

/// Shannon 熵（每字符比特数）
pub fn entropy(s: &str) -> f64 {
    if s.is_empty() {
        return 0.0;
    }
    let mut counts = std::collections::HashMap::new();
    for c in s.chars() {
        *counts.entry(c).or_insert(0usize) += 1;
    }
    let n = s.chars().count() as f64;
    counts.values().map(|&c| c as f64 / n).map(|p| -p * p.log2()).sum()
}

impl Scanner {
    fn load() -> Scanner {
        let file: RuleFile = serde_json::from_str(include_str!("rules/gitleaks.json")).expect("bundled gitleaks rules");
        let mut rules = Vec::new();
        for r in file.rules {
            let Some(regex) = build(&r.regex) else {
                log::warn!("gitleaks rule {} does not compile with the regex crate; skipped", r.id);
                continue;
            };
            let allows = r
                .allowlists
                .into_iter()
                .map(|a| Allow {
                    regexes: a.regexes.iter().filter_map(|p| build(p)).collect(),
                    stopwords: a.stopwords.iter().map(|s| s.to_lowercase()).collect(),
                    target: a.regex_target,
                    and: a.condition.as_deref() == Some("AND"),
                })
                .collect();
            rules.push(Rule {
                id: r.id,
                regex,
                keywords: r.keywords,
                entropy: r.entropy,
                secret_group: r.secret_group,
                allows,
            });
        }
        for (id, pattern, keywords) in EXTRA_RULES {
            rules.push(Rule {
                id: (*id).to_string(),
                regex: build(pattern).expect("built-in rule"),
                keywords: keywords.iter().map(|k| k.to_string()).collect(),
                entropy: None,
                secret_group: None,
                allows: Vec::new(),
            });
        }
        Scanner {
            rules,
            global_regexes: file.global.regexes.iter().filter_map(|p| build(p)).collect(),
            global_stopwords: file.global.stopwords.iter().map(|s| s.to_lowercase()).collect(),
        }
    }

    pub fn get() -> &'static Scanner {
        static S: OnceLock<Scanner> = OnceLock::new();
        S.get_or_init(Scanner::load)
    }

    pub fn rule_count(&self) -> usize {
        self.rules.len()
    }

    fn allowed(&self, rule: &Rule, secret: &str, whole: &str, line: &str) -> bool {
        let lower = secret.to_lowercase();
        if self.global_regexes.iter().any(|r| r.is_match(secret))
            || self.global_stopwords.iter().any(|w| lower.contains(w))
        {
            return true;
        }
        rule.allows.iter().any(|a| {
            let target = match a.target.as_deref() {
                Some("match") => whole,
                Some("line") => line,
                _ => secret,
            };
            let by_regex = !a.regexes.is_empty() && a.regexes.iter().any(|r| r.is_match(target));
            let by_word = !a.stopwords.is_empty() && a.stopwords.iter().any(|w| lower.contains(w));
            if a.and {
                (a.regexes.is_empty() || by_regex) && (a.stopwords.is_empty() || by_word)
            } else {
                by_regex || by_word
            }
        })
    }

    /// 在一行里找密钥，返回命中的规则 id 和密钥在行内的字节范围
    pub fn find_in_line(&self, line: &str) -> Option<(String, std::ops::Range<usize>)> {
        let lower = line.to_lowercase();
        for rule in &self.rules {
            if !rule.keywords.is_empty() && !rule.keywords.iter().any(|k| lower.contains(k.as_str())) {
                continue;
            }
            for caps in rule.regex.captures_iter(line) {
                let whole = caps.get(0).expect("match");
                // gitleaks：没指定 secretGroup 时取第一个非空分组，没有分组就取整段
                let secret = match rule.secret_group {
                    Some(g) => caps.get(g),
                    None => caps.iter().skip(1).flatten().find(|m| !m.as_str().is_empty()),
                }
                .unwrap_or(whole);
                if rule.id == "password-assignment" && is_placeholder(secret.as_str()) {
                    continue;
                }
                if rule.entropy.is_some_and(|min| entropy(secret.as_str()) < min) {
                    continue;
                }
                // 明确的凭据赋值不能因为弱口令命中上游 stopword 而放行。
                if rule.id != "password-assignment" && self.allowed(rule, secret.as_str(), whole.as_str(), line) {
                    continue;
                }
                return Some((rule.id.clone(), secret.range()));
            }
        }
        None
    }

    /// 文本中第一处命中：(行号从 1 起, 规则 id)
    pub fn scan(&self, text: &str) -> Vec<(u32, String)> {
        text.lines()
            .enumerate()
            .filter_map(|(i, l)| self.find_in_line(l).map(|(id, _)| (i as u32 + 1, id)))
            .collect()
    }

    /// 脱敏：命中的片段替换为 `[REDACTED]`（界面显示为「已隐藏」）
    pub fn redact(&self, text: &str) -> String {
        text.split_inclusive('\n')
            .map(|seg| {
                let mut line = seg.to_string();
                for _ in 0..8 {
                    let Some((_, r)) = self.find_in_line(&line) else { break };
                    line.replace_range(r, "[REDACTED]");
                }
                line
            })
            .collect()
    }
}

#[cfg(test)]
mod tests;
