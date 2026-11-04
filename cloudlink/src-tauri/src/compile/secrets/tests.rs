//! 密钥扫描样本集：`tests/secret-corpus/positives.txt` 每行必须命中（漏放行 0），
//! `negatives.txt` 每行不能命中。样本里的假密钥用 `⟨⟩` 断开存放，读入时去掉，
//! 这样仓库里不出现连续的「像真的」令牌，不会触发 GitHub 的推送保护。

use super::*;

fn corpus(name: &str) -> Vec<String> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/secret-corpus")
        .join(name);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{}: {e}", path.display()))
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
        .map(|l| l.replace(['⟨', '⟩'], ""))
        .collect()
}

#[test]
fn bundled_rules_compile() {
    let s = Scanner::get();
    assert!(s.rule_count() > 200, "only {} rules compiled", s.rule_count());
}

#[test]
fn every_positive_sample_is_caught() {
    let s = Scanner::get();
    let missed: Vec<_> = corpus("positives.txt")
        .into_iter()
        .filter(|l| s.find_in_line(l).is_none())
        .collect();
    assert!(
        missed.is_empty(),
        "missed {} samples:\n{}",
        missed.len(),
        missed.join("\n")
    );
}

#[test]
fn negatives_are_not_flagged() {
    let s = Scanner::get();
    let flagged: Vec<_> = corpus("negatives.txt")
        .into_iter()
        .filter_map(|l| s.find_in_line(&l).map(|(id, _)| format!("{id}: {l}")))
        .collect();
    assert!(flagged.is_empty(), "false positives:\n{}", flagged.join("\n"));
}

#[test]
fn redaction_hides_the_secret_only() {
    let s = Scanner::get();
    let line = "export DB=1 password=devpass-2026 next";
    let out = s.redact(line);
    assert!(!out.contains("devpass-2026"), "{out}");
    assert!(out.starts_with("export DB=1 password="));
    assert!(out.ends_with(" next"));
}

#[test]
fn short_and_weak_password_assignments_are_blocked() {
    for value in ["a", "abc", "xxx", "changeme", "password", "example", "!!!"] {
        let line = format!("password={value}");
        assert!(Scanner::get().find_in_line(&line).is_some(), "missed {line}");
        assert!(
            !Scanner::get().redact(&line).ends_with(value),
            "failed to redact {line}"
        );
    }
    for line in [
        "password=\" \"",
        "password=' a'",
        "password=\"<your password>\"",
        "password=\"***\"",
    ] {
        let placeholder = line.contains('<') || line.contains("***");
        assert_eq!(Scanner::get().find_in_line(line).is_none(), placeholder, "{line}");
    }
}

#[test]
fn entropy_is_shannon() {
    assert_eq!(entropy("aaaa"), 0.0);
    assert!((entropy("ab") - 1.0).abs() < 1e-9);
}
