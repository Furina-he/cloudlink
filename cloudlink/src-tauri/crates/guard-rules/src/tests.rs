use super::*;

fn fixture(mode: &str) -> Value {
    json!({"version":1,"resources":[
        {"id":"ast-vps","kind":"vps","handle":"hk-edge","mode":mode,"envIds":["windows","wsl:Ubuntu"],"hosts":["203.0.113.10","2001:db8::10"],"criticalServices":["gateway"]},
        {"id":"ast-cf","kind":"cli","handle":"cloudflare","mode":mode,"provider":"cloudflare","account":"cf-1","scope":[{"id":"worker-api","kind":"worker","name":"api-gateway"},{"id":"database-1","kind":"d1","name":"appdb"},{"id":"kv-public","kind":"kv","name":"public-kv"},{"id":"bucket-1","kind":"r2","name":"assets"}]},
        {"id":"ast-vercel","kind":"cli","handle":"vercel","mode":mode,"provider":"vercel","account":"team_1","accountAliases":["team-one"],"scope":[{"id":"prj_1","kind":"project","name":"shop"},{"id":"domain-1","kind":"domain","name":"example.com"}]},
        {"id":"ast-oci","kind":"cli","handle":"oracle","mode":mode,"provider":"oracle","account":"main","scope":[{"id":"ocid1.instance.test","kind":"instance","name":"api"},{"id":"ocid1.volume.test","kind":"volume","name":"api-data"}]}
    ]})
}

#[test]
fn command_corpus_has_no_false_allows_or_false_denials() {
    let corpus: Value = serde_json::from_str(include_str!("../../../tests/guard-corpus/commands.json")).unwrap();
    let cases = corpus.as_array().unwrap();
    assert!(
        cases.len() >= 200,
        "the P4c guard gate requires at least 200 literal commands"
    );
    let mut failures = Vec::new();
    for case in cases {
        let command = case["command"].as_str().unwrap();
        let result = evaluate(&fixture(case["mode"].as_str().unwrap()), "windows", command);
        let actual = if result.is_empty() {
            "ignored"
        } else if result.iter().any(|d| !d.allowed) {
            "denied"
        } else {
            "allowed"
        };
        if case["expect"] != actual {
            failures.push(format!(
                "{}: expected {}, got {actual}: {command}\n{result:?}",
                case["id"], case["expect"]
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} / {} cases failed:\n{}",
        failures.len(),
        cases.len(),
        failures.join("\n")
    );
    eprintln!(
        "guard corpus: {} literal cases, zero false allows, zero false denials",
        cases.len()
    );
}

#[test]
fn every_compiled_health_check_command_passes_in_read_only_mode() {
    let template = include_str!("../../../src/compile/templates/health-check.md");
    let mut count = 0;
    for line in template.lines().filter(|line| line.trim_start().starts_with("ssh ")) {
        let command = line
            .trim()
            .replace("<alias>", "hk-edge")
            .replace("<site>", "example.com");
        let result = evaluate(&fixture("read-only"), "windows", &command);
        assert!(
            !result.is_empty() && result.iter().all(|d| d.allowed),
            "health checklist rejected: {command}: {result:?}"
        );
        count += 1;
    }
    assert!(
        count >= 2,
        "test must remain tied to the compiler's inspection and certificate commands"
    );
}

#[test]
fn policy_missing_malformed_or_unknown_version_passes_without_a_record() {
    for value in [
        Value::Null,
        json!({}),
        json!({"version":2,"resources":[]}),
        json!({"version":1,"resources":[{"id":"broken"}]}),
    ] {
        assert!(!policy_valid(&value));
        assert!(evaluate(&value, "windows", "ssh hk-edge reboot").is_empty());
    }
    let mut policy = fixture("read-only");
    policy["resources"][1]["account"] = Value::Null;
    assert!(policy_valid(&policy));
    assert!(!evaluate(&policy, "windows", "ssh hk-edge reboot")[0].allowed);
    assert!(!evaluate(&policy, "windows", "wrangler deploy")[0].allowed);
}

#[test]
fn modes_use_current_policy_and_unparsed_standard_is_explicitly_marked() {
    let ro = fixture("read-only");
    let standard = fixture("standard");
    assert!(!evaluate(&ro, "windows", "ssh hk-edge 'echo $(uptime)'")[0].allowed);
    let parsed = evaluate(&standard, "windows", "ssh hk-edge 'echo $(uptime)'");
    assert!(parsed[0].allowed);
    assert_eq!(parsed[0].reason_id, Some("unparsed"));
    assert!(evaluate(&standard, "windows", "ssh hk-edge 'docker restart api'")[0].allowed);
    assert!(!evaluate(&ro, "windows", "ssh hk-edge 'docker restart api'")[0].allowed);
}

#[test]
fn account_selection_cannot_inherit_another_accounts_mode_or_scope() {
    let mut policy = fixture("standard");
    let second = json!({"id":"ast-vercel-2","kind":"cli","handle":"vercel-2","mode":"read-only","provider":"vercel","account":"team_2","scope":[{"id":"prj_2","kind":"project","name":"other"}]});
    policy["resources"].as_array_mut().unwrap().push(second);
    let bound = evaluate(&policy, "windows", "vercel --scope team_2 deploy");
    assert_eq!(bound.len(), 1);
    assert_eq!(bound[0].asset_id, "ast-vercel-2");
    assert!(!bound[0].allowed);
    assert!(evaluate(&policy, "windows", "vercel --scope team_1 deploy --project shop")[0].allowed);
    assert!(!evaluate(&policy, "windows", "vercel --scope team_2 logs shop")[0].allowed);
    assert!(evaluate(&policy, "windows", "vercel --scope team-one logs shop")[0].allowed);
}

#[test]
fn multiple_commands_cannot_erase_an_earlier_denial() {
    let result = evaluate(
        &fixture("read-only"),
        "windows",
        "ssh hk-edge reboot; ssh hk-edge uptime",
    );
    assert_eq!(result.len(), 1);
    assert!(!result[0].allowed);
    assert_eq!(result[0].reason_id, Some("host-reboot"));
}

#[test]
fn allow_does_not_emit_an_approval_and_denial_never_echoes_a_secret() {
    assert!(deny_output(&evaluate(&fixture("read-only"), "windows", "ssh hk-edge uptime")).is_none());
    let denied = evaluate(
        &fixture("read-only"),
        "windows",
        "ssh hk-edge 'echo password=fixture-value > .env'",
    );
    let output = deny_output(&denied).unwrap();
    assert_eq!(output["hookSpecificOutput"]["hookEventName"], "PreToolUse");
    assert_eq!(output["hookSpecificOutput"]["permissionDecision"], "deny");
    assert!(!output.to_string().contains("fixture-value"));
}

#[test]
fn compact_redaction_handles_assignments_tokens_headers_and_quoted_values() {
    for value in [
        "password=fixture-super-private",
        "PASSWORD='fixture secret with spaces'",
        "--token ghp_0123456789abcdefghijklmnop",
        "api_key=sk-0123456789abcdefghijklmnop",
        "Bearer sk-ant-0123456789abcdefghijklmnop",
        "https://example.com?token=github_pat_0123456789abcdefghijklmnop",
        "-----BEGIN OPENSSH PRIVATE KEY-----\nfixture-encoded-private\n-----END OPENSSH PRIVATE KEY-----",
        "-----BEGIN RSA PRIVATE KEY-----\nfixture-unclosed-private",
        "password = 'fixture secret with spaces'",
        "echo '{\"password\":\"fixture-super-private\"}'",
        "-----BEGIN CERTIFICATE-----\npublic\n-----END CERTIFICATE-----\n-----BEGIN RSA PRIVATE KEY-----\nfixture-encoded-private\n-----END RSA PRIVATE KEY-----",
    ] {
        let output = redact(value);
        assert!(output.contains("[已隐藏]"), "missed {value}");
        assert!(
            !output.contains("fixture-super-private")
                && !output.contains("fixture secret")
                && !output.contains("0123456789abcdefghijklmnop")
                && !output.contains("fixture-encoded-private")
                && !output.contains("fixture-unclosed-private"),
            "leaked {output}"
        );
    }
    assert_eq!(redact("ssh hk-edge uptime"), "ssh hk-edge uptime");
}

#[test]
fn conservative_parser_covers_control_prefixes_option_variants_and_critical_groups() {
    let cases = [
        ("read-only", "if true; then ssh hk-edge 'docker restart api'; fi"),
        ("read-only", "for host in hk-edge; do ssh hk-edge uptime; done"),
        ("read-only", "ssh hk-edge 'curl -sI -XDELETE https://example.com'"),
        ("read-only", "ssh hk-edge 'curl -sIo/tmp/output https://example.com'"),
        (
            "read-only",
            "ssh hk-edge 'curl -sI --config=/tmp/curlrc https://example.com'",
        ),
        (
            "read-only",
            "ssh hk-edge 'openssl s_client -connect localhost:443 -sess_out /tmp/session'",
        ),
        ("standard", "ssh hk-edge 'docker compose stop'"),
        ("standard", "ssh hk-edge 'docker compose restart'"),
        (
            "standard",
            "ssh hk-edge 'docker compose config --services --environment'",
        ),
        ("standard", "vercel --scope team_1 --scope other deploy"),
        ("read-only", "ssh hk-edge 'systemctl --failed set-environment FOO=bar'"),
        ("read-only", "ssh hk-edge 'systemctl --failed preset-all'"),
        (
            "read-only",
            "ssh hk-edge 'docker compose config --services --output=/tmp/leak'",
        ),
        ("read-only", "ssh hk-edge 'nginx -t -gdaemon=on'"),
        ("standard", "vercel --scope team_1 deploy"),
        ("standard", "vercel --scope team_1 --prod"),
        ("standard", "VERCEL_PROJECT_ID=unknown vercel --scope team_1 deploy"),
        ("standard", "vercel --scope team_1 deploy --name unknown"),
        ("standard", "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler deploy"),
        ("standard", "oci --profile main compute instance update"),
        (
            "standard",
            "CLOUDFLARE_ACCOUNT_ID=cf-1 wrangler deploy --name api-gateway --name outside",
        ),
    ];
    for (mode, command) in cases {
        let decisions = evaluate(&fixture(mode), "windows", command);
        assert!(
            decisions.iter().any(|d| !d.allowed),
            "unprotected {mode} command: {command}: {decisions:?}"
        );
    }
    assert!(evaluate(&fixture("read-only"), "windows", "ssh hk-edge 'echo env'")[0].allowed);
    assert!(
        evaluate(
            &fixture("standard"),
            "windows",
            "VERCEL_PROJECT_ID=prj_1 vercel --scope team_1 deploy"
        )[0]
        .allowed
    );
    assert!(
        evaluate(
            &fixture("standard"),
            "windows",
            "vercel --scope team_1 deploy --project shop"
        )[0]
        .allowed
    );
}
