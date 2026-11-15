//! Small deterministic rules available to the standalone hook without regex or OS services.

const HIDDEN: &str = "[已隐藏]";

fn secret_key(key: &str) -> bool {
    let key = key.trim_start_matches('-').to_ascii_lowercase();
    key.contains("password")
        || key.contains("passwd")
        || key.contains("secret")
        || key.contains("token")
        || key == "api_key"
        || key == "apikey"
        || key == "api-key"
        || key == "authorization"
}

fn token_prefix(word: &str) -> bool {
    [
        "sk-",
        "sk_",
        "ghp_",
        "gho_",
        "ghu_",
        "ghs_",
        "ghr_",
        "github_pat_",
        "AKIA",
        "ASIA",
        "xoxb-",
        "xoxp-",
    ]
    .iter()
    .any(|prefix| word.starts_with(prefix) && word.len() >= prefix.len() + 8)
        || word.starts_with("eyJ") && word.matches('.').count() == 2 && word.len() > 30
}

pub fn redact(text: &str) -> String {
    let mut text = text.to_string();
    // A private-key header makes everything up to its footer (or EOF) sensitive.
    let mut cursor = 0;
    while let Some(offset) = text[cursor..].find("-----BEGIN ") {
        let start = cursor + offset;
        let tail = &text[start..];
        let Some(header_end) = tail[11..].find("-----").map(|end| end + 11) else {
            if tail.contains("PRIVATE KEY") {
                text.replace_range(start.., HIDDEN);
            }
            break;
        };
        if !tail[..header_end].contains("PRIVATE KEY") {
            cursor = start + header_end + 5;
            continue;
        }
        let end = tail
            .find("-----END ")
            .and_then(|footer| tail[footer + 9..].find("-----").map(|n| start + footer + 9 + n + 5))
            .unwrap_or(text.len());
        text.replace_range(start..end, HIDDEN);
        cursor = start + HIDDEN.len();
    }
    let text = redact_assignments(&text);
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    let mut redact_next = false;
    while i < chars.len() {
        if chars[i].is_whitespace() || [';', '|', '&'].contains(&chars[i]) {
            out.push(chars[i]);
            i += 1;
            continue;
        }
        let start = i;
        let mut quote = None;
        while i < chars.len() {
            let c = chars[i];
            if let Some(q) = quote {
                if c == q {
                    quote = None;
                }
            } else if c == '\'' || c == '"' {
                quote = Some(c);
            } else if c.is_whitespace() || [';', '|', '&'].contains(&c) {
                break;
            }
            i += 1;
        }
        let word: String = chars[start..i].iter().collect();
        let bare = word.trim_matches(['\'', '"', ',', '(', ')']);
        if redact_next && (bare == "=" || bare == ":") {
            out.push_str(&word);
        } else if redact_next || token_prefix(bare) {
            out.push_str(HIDDEN);
            redact_next = false;
        } else if let Some((key, _)) = bare.split_once('=') {
            if secret_key(key) {
                out.push_str(key);
                out.push('=');
                out.push_str(HIDDEN);
            } else {
                out.push_str(&redact_tokens_inside(&word));
            }
        } else if secret_key(bare) || bare.eq_ignore_ascii_case("Bearer") || bare.eq_ignore_ascii_case("Basic") {
            out.push_str(&word);
            redact_next = true;
        } else {
            out.push_str(&redact_tokens_inside(&word));
        }
    }
    out
}

fn redact_assignments(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut output = String::new();
    let mut i = 0;
    while i < chars.len() {
        if !chars[i].is_ascii_alphabetic() && chars[i] != '_' && chars[i] != '-' {
            output.push(chars[i]);
            i += 1;
            continue;
        }
        let start = i;
        while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_' || chars[i] == '-') {
            i += 1;
        }
        let key: String = chars[start..i].iter().collect();
        let mut separator = i;
        if matches!(chars.get(separator), Some('\'' | '"')) {
            separator += 1;
        }
        while chars.get(separator).is_some_and(|c| c.is_whitespace()) {
            separator += 1;
        }
        if !secret_key(&key) || !matches!(chars.get(separator), Some('=' | ':')) {
            output.push_str(&key);
            continue;
        }
        let mut value_start = separator + 1;
        while chars.get(value_start).is_some_and(|c| c.is_whitespace()) {
            value_start += 1;
        }
        let quote = chars.get(value_start).copied().filter(|c| *c == '\'' || *c == '"');
        if quote.is_some() {
            value_start += 1;
        }
        output.extend(chars[start..value_start].iter());
        let mut end = value_start;
        while end < chars.len() {
            if chars[end] == '\\' && quote.is_some() {
                end = (end + 2).min(chars.len());
                continue;
            }
            if quote.is_some_and(|q| q == chars[end])
                || quote.is_none()
                    && (chars[end].is_whitespace() || ['\'', '"', ';', '|', '&', ',', '}', ']'].contains(&chars[end]))
            {
                break;
            }
            end += 1;
        }
        output.push_str(HIDDEN);
        i = end;
    }
    output
}

fn redact_tokens_inside(word: &str) -> String {
    let chars: Vec<char> = word.chars().collect();
    let mut out = String::new();
    let mut start = 0;
    while start < chars.len() {
        if chars[start].is_ascii_alphanumeric() || chars[start] == '_' || chars[start] == '-' {
            let mut end = start + 1;
            while end < chars.len() && (chars[end].is_ascii_alphanumeric() || ['_', '-', '.'].contains(&chars[end])) {
                end += 1;
            }
            let segment: String = chars[start..end].iter().collect();
            out.push_str(if token_prefix(&segment) { HIDDEN } else { &segment });
            start = end;
        } else {
            out.push(chars[start]);
            start += 1;
        }
    }
    out
}
