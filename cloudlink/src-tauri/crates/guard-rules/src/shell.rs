//! A bounded lexer, deliberately not a shell interpreter. Expansions stay opaque.

#[derive(Debug, Clone, Default)]
pub(crate) struct Simple {
    pub words: Vec<String>,
    pub redirects: Vec<(String, String)>,
}

#[derive(Debug, Default)]
pub(crate) struct Parsed {
    pub commands: Vec<Simple>,
    pub embedded: Vec<String>,
    pub unparsed: bool,
    pub expansion: bool,
}

#[derive(Debug)]
enum Token {
    Word(String),
    Boundary,
    Redirect(String),
}

fn flush(tokens: &mut Vec<Token>, text: &mut String, started: &mut bool) {
    if *started {
        tokens.push(Token::Word(std::mem::take(text)));
        *started = false;
    }
}

fn substitution(chars: &[char], start: usize, backtick: bool) -> Option<(usize, String)> {
    let mut depth = 1usize;
    let mut quote = None;
    let mut index = start;
    while index < chars.len() {
        let c = chars[index];
        if c == '\\' {
            index += 2;
            continue;
        }
        if backtick && c == '`' {
            return Some((index + 1, chars[start..index].iter().collect()));
        }
        if let Some(q) = quote {
            if c == q {
                quote = None;
            }
        } else if c == '\'' || c == '"' {
            quote = Some(c);
        } else if !backtick {
            if c == '(' {
                depth += 1;
            } else if c == ')' {
                depth -= 1;
                if depth == 0 {
                    return Some((index + 1, chars[start..index].iter().collect()));
                }
            }
        }
        index += 1;
    }
    None
}

pub(crate) fn parse(input: &str) -> Parsed {
    let mut result = Parsed::default();
    if input.len() > 65_536 || input.contains('\0') {
        result.unparsed = true;
        return result;
    }
    let chars: Vec<char> = input.chars().collect();
    let mut tokens = Vec::new();
    let mut word = String::new();
    let mut started = false;
    let mut quote = None;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if quote == Some('\'') {
            if c == '\'' {
                quote = None;
            } else {
                word.push(c);
            }
            i += 1;
            continue;
        }
        if c == '\\' {
            if let Some(&next) = chars.get(i + 1) {
                if next != '\n' {
                    // In double quotes a backslash only escapes shell metacharacters.
                    if quote == Some('"') && !['$', '`', '"', '\\'].contains(&next) {
                        word.push('\\');
                    }
                    word.push(next);
                    started = true;
                }
                i += 2;
            } else {
                result.unparsed = true;
                i += 1;
            }
            continue;
        }
        if c == '`' || (c == '$' && chars.get(i + 1) == Some(&'(')) {
            started = true;
            result.expansion = true;
            let offset = if c == '`' { 1 } else { 2 };
            if let Some((end, inner)) = substitution(&chars, i + offset, c == '`') {
                result.embedded.push(inner);
                word.extend(chars[i..end].iter());
                i = end;
            } else {
                result.unparsed = true;
                word.extend(chars[i..].iter());
                break;
            }
            continue;
        }
        if c == '$' {
            result.expansion = true;
        }
        if quote == Some('"') {
            if c == '"' {
                quote = None;
            } else {
                word.push(c);
            }
            i += 1;
            continue;
        }
        match c {
            '\'' | '"' => {
                started = true;
                quote = Some(c);
            }
            ' ' | '\t' | '\r' => flush(&mut tokens, &mut word, &mut started),
            '\n' | ';' | '|' | '&' if !(c == '&' && chars.get(i + 1) == Some(&'>')) => {
                flush(&mut tokens, &mut word, &mut started);
                tokens.push(Token::Boundary);
                if chars.get(i + 1) == Some(&c) && (c == '|' || c == '&' || c == ';') {
                    i += 1;
                }
            }
            '#' if !started => {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
                tokens.push(Token::Boundary);
                continue;
            }
            '<' | '>' | '&' => {
                let mut op = String::new();
                if started && word.chars().all(|c| c.is_ascii_digit()) {
                    op.push_str(&std::mem::take(&mut word));
                    started = false;
                } else {
                    flush(&mut tokens, &mut word, &mut started);
                }
                op.push(c);
                if matches!(chars.get(i + 1), Some('>' | '<' | '&')) {
                    i += 1;
                    op.push(chars[i]);
                    if chars.get(i + 1) == Some(&chars[i]) && chars[i] == '<' {
                        i += 1;
                        op.push(chars[i]);
                    }
                }
                if op.contains("<<") {
                    result.unparsed = true;
                }
                tokens.push(Token::Redirect(op));
            }
            '(' | ')' | '{' | '}' => {
                result.unparsed = true;
                flush(&mut tokens, &mut word, &mut started);
                tokens.push(Token::Boundary);
            }
            _ => {
                word.push(c);
                started = true;
            }
        }
        i += 1;
        if tokens.len() > 4096 {
            result.unparsed = true;
            break;
        }
    }
    if quote.is_some() {
        result.unparsed = true;
    }
    flush(&mut tokens, &mut word, &mut started);
    let mut simple = Simple::default();
    let mut iter = tokens.into_iter();
    while let Some(token) = iter.next() {
        match token {
            Token::Word(w) => simple.words.push(w),
            Token::Boundary => {
                if !simple.words.is_empty() || !simple.redirects.is_empty() {
                    result.commands.push(std::mem::take(&mut simple));
                }
            }
            Token::Redirect(op) => {
                if let Some(Token::Word(target)) = iter.next() {
                    simple.redirects.push((op, target));
                } else {
                    result.unparsed = true;
                }
            }
        }
    }
    if !simple.words.is_empty() || !simple.redirects.is_empty() {
        result.commands.push(simple);
    }
    if result.commands.iter().any(|command| {
        command.words.first().is_some_and(|word| {
            [
                "if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done", "case", "esac", "!",
            ]
            .contains(&word.as_str())
        })
    }) {
        result.unparsed = true;
    }
    result
}

pub(crate) fn binary(word: &str) -> &str {
    let basename = word.rsplit(['/', '\\']).next().unwrap_or(word);
    basename
        .strip_suffix(".exe")
        .or_else(|| basename.strip_suffix(".cmd"))
        .unwrap_or(basename)
}

pub(crate) fn assignment(word: &str) -> Option<(&str, &str)> {
    let (key, value) = word.split_once('=')?;
    (!key.is_empty()
        && key
            .chars()
            .enumerate()
            .all(|(i, c)| c == '_' || c.is_ascii_alphabetic() || (i > 0 && c.is_ascii_digit())))
    .then_some((key, value))
}

/// Unwrap common local execution prefixes, retaining assignments for CLI identity matching.
pub(crate) fn executable(words: &[String]) -> usize {
    let mut i = 0;
    while i < words.len() {
        if assignment(&words[i]).is_some() {
            i += 1;
            continue;
        }
        match binary(&words[i]) {
            "if" | "then" | "else" | "elif" | "while" | "until" | "do" | "!" => {
                i += 1;
            }
            "env" => {
                i += 1;
                while i < words.len() && words[i].starts_with('-') {
                    if words[i] == "-u" || words[i] == "--unset" || words[i] == "-C" || words[i] == "--chdir" {
                        i += 1;
                    }
                    i += 1;
                }
            }
            "command" | "exec" | "nohup" => {
                i += 1;
                while i < words.len() && words[i].starts_with('-') {
                    i += 1;
                }
            }
            "sudo" => {
                i += 1;
                while i < words.len() && words[i].starts_with('-') {
                    if ["-u", "-g", "-h", "-p", "-C", "--user", "--group"].contains(&words[i].as_str()) {
                        i += 1;
                    }
                    i += 1;
                }
            }
            _ => break,
        }
    }
    i
}

pub(crate) fn writes_redirect(simple: &Simple) -> bool {
    simple.redirects.iter().any(|(op, target)| {
        if op.contains('<') {
            return true;
        }
        if target == "/dev/null" {
            return false;
        }
        !(op.ends_with(">&") && target.chars().all(|c| c.is_ascii_digit()))
    })
}
