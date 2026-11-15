//! Minimal edits to validated JSON. Byte ranges let unrelated settings, hooks,
//! key order, indentation and newlines survive installation and removal.

use std::collections::BTreeSet;
use std::ops::Range;

use serde_json::Value;

use crate::error::Result;

use super::owned::invalid;

#[derive(Debug)]
struct Member {
    key: String,
    value: Node,
}

#[derive(Debug)]
enum Kind {
    Object(Vec<Member>),
    Array(Vec<Node>),
    Scalar,
}

#[derive(Debug)]
struct Node {
    start: usize,
    end: usize,
    kind: Kind,
}

impl Node {
    fn object(&self) -> Result<&[Member]> {
        match &self.kind {
            Kind::Object(members) => Ok(members),
            _ => Err(invalid()),
        }
    }

    fn member(&self, key: &str) -> Result<Option<&Node>> {
        Ok(self
            .object()?
            .iter()
            .find(|member| member.key == key)
            .map(|member| &member.value))
    }

    fn array(&self) -> Result<&[Node]> {
        match &self.kind {
            Kind::Array(nodes) => Ok(nodes),
            _ => Err(invalid()),
        }
    }

    fn append(&self, bytes: &[u8], entry: &[u8]) -> Result<Vec<u8>> {
        let last = match &self.kind {
            Kind::Object(members) => members.last().map(|member| member.value.end),
            Kind::Array(nodes) => nodes.last().map(|node| node.end),
            Kind::Scalar => return Err(invalid()),
        };
        let position = last.unwrap_or(self.start + 1);
        let mut out = Vec::with_capacity(bytes.len() + entry.len() + 1);
        out.extend_from_slice(&bytes[..position]);
        if last.is_some() {
            out.push(b',');
        }
        out.extend_from_slice(entry);
        out.extend_from_slice(&bytes[position..]);
        Ok(out)
    }
}

struct Parser<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl Parser<'_> {
    fn whitespace(&mut self) {
        while self.bytes.get(self.position).is_some_and(u8::is_ascii_whitespace) {
            self.position += 1;
        }
    }

    fn string_end(&mut self) -> Result<()> {
        if self.bytes.get(self.position) != Some(&b'"') {
            return Err(invalid());
        }
        self.position += 1;
        loop {
            match self.bytes.get(self.position) {
                Some(b'\\') => self.position += 2,
                Some(b'"') => {
                    self.position += 1;
                    return Ok(());
                }
                Some(_) => self.position += 1,
                None => return Err(invalid()),
            }
        }
    }

    fn value(&mut self) -> Result<Node> {
        self.whitespace();
        let start = self.position;
        let kind = match self.bytes.get(self.position) {
            Some(b'{') => {
                self.position += 1;
                self.whitespace();
                let mut members = Vec::new();
                let mut seen = BTreeSet::new();
                while self.bytes.get(self.position) != Some(&b'}') {
                    let member_start = self.position;
                    self.string_end()?;
                    let key: String =
                        serde_json::from_slice(&self.bytes[member_start..self.position]).map_err(|_| invalid())?;
                    if !seen.insert(key.clone()) {
                        return Err(invalid());
                    }
                    self.whitespace();
                    if self.bytes.get(self.position) != Some(&b':') {
                        return Err(invalid());
                    }
                    self.position += 1;
                    let value = self.value()?;
                    members.push(Member { key, value });
                    self.whitespace();
                    if self.bytes.get(self.position) == Some(&b',') {
                        self.position += 1;
                        self.whitespace();
                    } else {
                        break;
                    }
                }
                if self.bytes.get(self.position) != Some(&b'}') {
                    return Err(invalid());
                }
                self.position += 1;
                Kind::Object(members)
            }
            Some(b'[') => {
                self.position += 1;
                self.whitespace();
                let mut nodes = Vec::new();
                while self.bytes.get(self.position) != Some(&b']') {
                    nodes.push(self.value()?);
                    self.whitespace();
                    if self.bytes.get(self.position) == Some(&b',') {
                        self.position += 1;
                    } else {
                        break;
                    }
                    self.whitespace();
                }
                if self.bytes.get(self.position) != Some(&b']') {
                    return Err(invalid());
                }
                self.position += 1;
                Kind::Array(nodes)
            }
            Some(b'"') => {
                self.string_end()?;
                Kind::Scalar
            }
            Some(_) => {
                while self
                    .bytes
                    .get(self.position)
                    .is_some_and(|byte| !byte.is_ascii_whitespace() && !matches!(byte, b',' | b'}' | b']'))
                {
                    self.position += 1;
                }
                Kind::Scalar
            }
            None => return Err(invalid()),
        };
        Ok(Node {
            start,
            end: self.position,
            kind,
        })
    }
}

fn parse(bytes: &[u8]) -> Result<Node> {
    // serde's depth limit and complete JSON validation precede range parsing.
    let value: Value = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    if !value.is_object() {
        return Err(invalid());
    }
    Parser { bytes, position: 0 }.value()
}

fn pre_tool(root: &Node) -> Result<Option<&Node>> {
    let Some(hooks) = root.member("hooks")? else {
        return Ok(None);
    };
    let pre_tool = hooks.member("PreToolUse")?;
    if let Some(pre_tool) = pre_tool {
        pre_tool.array()?;
    }
    Ok(pre_tool)
}

pub(super) fn validate(bytes: &[u8]) -> Result<()> {
    let root = parse(bytes)?;
    if let Some(pre_tool) = pre_tool(&root)? {
        for entry in pre_tool.array()? {
            let hooks = entry.member("hooks")?.ok_or_else(invalid)?;
            for hook in hooks.array()? {
                hook.object()?;
            }
        }
    }
    Ok(())
}

pub(super) fn append(bytes: &[u8], entry: &Value) -> Result<Vec<u8>> {
    validate(bytes)?;
    let root = parse(bytes)?;
    if let Some(pre_tool) = pre_tool(&root)? {
        return pre_tool.append(bytes, &serde_json::to_vec(entry)?);
    }
    let array = serde_json::to_string(&vec![entry])?;
    if let Some(hooks) = root.member("hooks")? {
        return hooks.append(bytes, format!("\"PreToolUse\":{array}").as_bytes());
    }
    root.append(bytes, format!("\"hooks\":{{\"PreToolUse\":{array}}}").as_bytes())
}

fn own_hook(bytes: &[u8], hook: &Node, command: &str) -> Result<bool> {
    let value: Value = serde_json::from_slice(&bytes[hook.start..hook.end]).map_err(|_| invalid())?;
    Ok(value["type"] == "command" && value["command"] == command)
}

/// An exact command match is used only with the corresponding ownership receipt.
pub(super) fn active(bytes: &[u8], command: &str) -> Result<bool> {
    validate(bytes)?;
    let root = parse(bytes)?;
    let Some(pre_tool) = pre_tool(&root)? else {
        return Ok(false);
    };
    for entry in pre_tool.array()? {
        let value: Value = serde_json::from_slice(&bytes[entry.start..entry.end]).map_err(|_| invalid())?;
        if value["matcher"] != "Bash" {
            continue;
        }
        if let Some(hooks) = entry.member("hooks")? {
            for hook in hooks.array()? {
                if own_hook(bytes, hook, command)? {
                    return Ok(true);
                }
            }
        }
    }
    Ok(false)
}

/// Used only to detect an installed command moved to another matcher/event.
/// Existing user-authored occurrences are counted from the original backup.
pub(super) fn command_count(bytes: &[u8], command: &str) -> Result<usize> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    Ok(value
        .get("hooks")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|events| events.values())
        .filter_map(Value::as_array)
        .flatten()
        .filter_map(|entry| entry.get("hooks").and_then(Value::as_array))
        .flatten()
        .filter(|hook| hook["type"] == "command" && hook["command"] == command)
        .count())
}

fn removed_ranges(nodes: &[Node], removed: &[bool]) -> Vec<Range<usize>> {
    let mut ranges = Vec::new();
    let mut index = 0;
    while index < nodes.len() {
        if !removed[index] {
            index += 1;
            continue;
        }
        let start = index;
        while index + 1 < nodes.len() && removed[index + 1] {
            index += 1;
        }
        let end = index;
        let range = if end + 1 < nodes.len() {
            nodes[start].start..nodes[end + 1].start
        } else if start > 0 {
            nodes[start - 1].end..nodes[end].end
        } else {
            nodes[start].start..nodes[end].end
        };
        ranges.push(range);
        index += 1;
    }
    ranges
}

pub(super) fn remove(bytes: &[u8], command: &str) -> Result<Vec<u8>> {
    validate(bytes)?;
    let root = parse(bytes)?;
    let Some(pre_tool) = pre_tool(&root)? else {
        return Ok(bytes.to_vec());
    };
    let entries = pre_tool.array()?;
    let mut remove_entries = vec![false; entries.len()];
    let mut ranges = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        let value: Value = serde_json::from_slice(&bytes[entry.start..entry.end]).map_err(|_| invalid())?;
        if value["matcher"] != "Bash" {
            continue;
        }
        let Some(hooks) = entry.member("hooks")? else {
            continue;
        };
        let hooks = hooks.array()?;
        let remove_hooks: Vec<bool> = hooks
            .iter()
            .map(|hook| own_hook(bytes, hook, command))
            .collect::<Result<_>>()?;
        if !remove_hooks.iter().any(|remove| *remove) {
            continue;
        }
        let only_our_wrapper = entry
            .object()?
            .iter()
            .all(|member| matches!(member.key.as_str(), "matcher" | "hooks"));
        if remove_hooks.iter().all(|remove| *remove) && only_our_wrapper {
            remove_entries[index] = true;
        } else {
            ranges.extend(removed_ranges(hooks, &remove_hooks));
        }
    }
    ranges.extend(removed_ranges(entries, &remove_entries));
    ranges.sort_by_key(|range| range.start);
    let mut out = bytes.to_vec();
    for range in ranges.into_iter().rev() {
        out.drain(range);
    }
    validate(&out)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn append_changes_only_inserted_bytes() {
        let original = b"{\r\n  \"permissions\" : { \"deny\" : [] },\r\n  \"hooks\": { \"PreToolUse\" : [ {\"matcher\":\"Read\",\"hooks\":[]} ] }\r\n}";
        let entry = json!({"matcher":"Bash","hooks":[{"type":"command","command":"owned"}]});
        let out = append(original, &entry).unwrap();
        assert!(active(&out, "owned").unwrap());
        assert_eq!(remove(&out, "owned").unwrap(), original);
    }

    #[test]
    fn removal_preserves_other_hooks_and_external_whitespace() {
        let bytes = br#"{ "x": 7, "hooks": {"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"ours"},  {"type":"command","command":"user"},{"type":"command","command":"ours"}]}]}}"#;
        let result = remove(bytes, "ours").unwrap();
        assert_eq!(
            String::from_utf8(result).unwrap(),
            r#"{ "x": 7, "hooks": {"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"user"}]}]}}"#
        );
    }

    #[test]
    fn duplicate_keys_and_invalid_settings_are_rejected() {
        for bytes in [
            b"[]".as_slice(),
            br#"{"hooks":{},"hooks":{}}"#,
            br#"{"hooks":{"PreToolUse":{}}}"#,
            br#"{"hooks":{"PreToolUse":[1]}}"#,
            br#"{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":1}]}}"#,
        ] {
            assert!(validate(bytes).is_err());
        }
    }
}
