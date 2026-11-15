//! 分段解析。仅从成功且格式完整的段推断事实，先识别注入再清洗/截断。

use std::collections::{BTreeMap, BTreeSet};
use std::net::IpAddr;

use super::{MAX_OUTPUT, MAX_VALUE_CHARS, ProbeData};
use crate::model::asset::{FieldSource, ListeningPort, PanelInfo, PanelType, PortMapping, Proto, Service, ServiceKind};

const SECTIONS: [&str; 10] = [
    "os", "kernel", "cpu", "mem", "disk", "tools", "panel", "docker", "systemd", "listen",
];

pub(super) fn sanitized(raw: &str) -> (String, bool, bool) {
    let suspicious = crate::compile::lint::looks_like_injection(raw);
    let value: String = raw
        .trim()
        .chars()
        .take(MAX_VALUE_CHARS)
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '/' | '@' | '-') {
                c
            } else {
                '-'
            }
        })
        .collect();
    let changed = value != raw;
    let suspicious = suspicious || crate::compile::lint::looks_like_injection(&value);
    (value, changed, suspicious)
}

fn failure(data: &mut ProbeData, section: &str) {
    data.successful_sections.remove(section);
    if !data.failed_sections.iter().any(|s| s == section) {
        data.failed_sections.push(section.into());
    }
}

fn field(data: &mut ProbeData, key: &str, raw: &str) -> Option<String> {
    let (value, _, suspicious) = sanitized(raw);
    if suspicious {
        data.suspicious_fields.insert(key.into());
    }
    (!value.is_empty()).then_some(value)
}

pub fn parse(raw: &str) -> ProbeData {
    if raw.len() > MAX_OUTPUT {
        return ProbeData::default();
    }
    let mut sections: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    let mut statuses: BTreeMap<&str, i32> = BTreeMap::new();
    let mut current = None;
    let mut complete = true;
    for line in raw.lines().map(|line| line.trim_end_matches('\r')) {
        if let Some(status) = line.strip_prefix("@@status ") {
            let words: Vec<_> = status.split_whitespace().collect();
            if words.len() != 2 || Some(words[0]) != current || !SECTIONS.contains(&words[0]) {
                complete = false;
                continue;
            }
            let Ok(code) = words[1].parse::<i32>() else {
                complete = false;
                continue;
            };
            if statuses.insert(words[0], code).is_some() {
                complete = false;
            }
            current = None;
        } else if let Some(section) = line.strip_prefix("@@") {
            if !SECTIONS.contains(&section) || sections.insert(section, Vec::new()).is_some() || current.is_some() {
                complete = false;
            }
            current = Some(section);
        } else if let Some(section) = current
            && let Some(lines) = sections.get_mut(section)
        {
            lines.push(line);
        }
    }
    complete &= current.is_none()
        && SECTIONS
            .iter()
            .all(|section| sections.contains_key(section) && statuses.contains_key(section));
    let mut data = ProbeData::default();
    for section in SECTIONS {
        if statuses.get(section) == Some(&0) {
            data.successful_sections.insert(section.into());
        } else {
            failure(&mut data, section);
        }
    }
    let lines = |section: &str| sections.get(section).cloned().unwrap_or_default();
    if data.successful_sections.contains("os") {
        let os = lines("os");
        let value = os
            .iter()
            .find_map(|line| line.strip_prefix("PRETTY_NAME="))
            .or_else(|| os.iter().find_map(|line| line.strip_prefix("NAME=")));
        if let Some(value) = value {
            data.facts.os = field(&mut data, "os", value.trim_matches(['\'', '"']));
        }
        if data.facts.os.is_none() {
            failure(&mut data, "os");
        }
    }
    if data.successful_sections.contains("kernel") {
        let kernel = lines("kernel");
        let words: Vec<_> = kernel
            .first()
            .map(|line| line.split_whitespace().collect())
            .unwrap_or_default();
        if words.len() >= 3 {
            data.facts.kernel = field(&mut data, "kernel", words[1]);
            data.facts.arch = field(&mut data, "arch", words[words.len() - 1]);
            if crate::compile::lint::looks_like_injection(kernel[0]) {
                data.suspicious_fields.extend(["kernel".into(), "arch".into()]);
            }
        } else {
            failure(&mut data, "kernel");
        }
    }
    if data.successful_sections.contains("cpu") {
        data.facts.cpu_cores = lines("cpu")
            .iter()
            .find_map(|line| line.trim().parse::<u32>().ok())
            .filter(|cores| *cores > 0);
        if data.facts.cpu_cores.is_none() {
            failure(&mut data, "cpu");
        }
    }
    if data.successful_sections.contains("mem") {
        data.facts.memory_total_mib = lines("mem").iter().find_map(|line| {
            let value = line
                .strip_prefix("MemTotal:")?
                .split_whitespace()
                .next()?
                .parse::<u64>()
                .ok()?;
            u32::try_from(value / 1024).ok().filter(|value| *value > 0)
        });
        if data.facts.memory_total_mib.is_none() {
            failure(&mut data, "mem");
        }
    }
    if data.successful_sections.contains("disk") {
        data.facts.disk_total_gib = lines("disk").iter().find_map(|line| {
            let words: Vec<_> = line.split_whitespace().collect();
            if words.len() < 6 || words.last().copied() != Some("/") {
                return None;
            }
            u32::try_from(words[1].parse::<u64>().ok()? / (1024 * 1024))
                .ok()
                .filter(|value| *value > 0)
        });
        if data.facts.disk_total_gib.is_none() {
            failure(&mut data, "disk");
        }
    }
    if data.successful_sections.contains("tools") {
        data.tools = lines("tools")
            .iter()
            .filter(|line| !line.trim().is_empty())
            .map(|line| sanitized(line).0)
            .collect();
    }
    if data.successful_sections.contains("panel") {
        let panel = lines("panel");
        data.facts.panel = Some(None);
        if let Some(line) = panel.iter().find(|line| !line.trim().is_empty()) {
            let mut words = line.split_whitespace();
            let kind = match words.next() {
                Some("1panel") => Some(PanelType::OnePanel),
                Some("bt") => Some(PanelType::Bt),
                _ => None,
            };
            if let (Some(kind), Some(path)) = (kind, words.next()) {
                let path = field(&mut data, "panel", path).unwrap_or_default();
                data.facts.panel = Some(Some(PanelInfo {
                    kind,
                    install_path: path,
                }));
                if crate::compile::lint::looks_like_injection(line) {
                    data.suspicious_fields.insert("panel".into());
                }
            } else {
                data.facts.panel = None;
                failure(&mut data, "panel");
            }
        }
    }
    for (section, kind) in [("docker", ServiceKind::Docker), ("systemd", ServiceKind::Systemd)] {
        if !data.successful_sections.contains(section) {
            continue;
        }
        let mut found = Vec::new();
        let mut names = BTreeSet::new();
        let mut good = true;
        for line in lines(section).into_iter().filter(|line| !line.trim().is_empty()) {
            let parsed = match kind {
                ServiceKind::Docker => docker(line),
                ServiceKind::Systemd => systemd(line),
            };
            let Some((service, suspicious)) = parsed else {
                good = false;
                break;
            };
            let key = service_key(&service);
            if !names.insert(key.clone()) {
                good = false;
                break;
            }
            if suspicious {
                data.suspicious_services.insert(key);
            }
            found.push(service);
        }
        if good {
            data.services.extend(found);
        } else {
            failure(&mut data, section);
        }
    }
    if data.successful_sections.contains("listen") {
        let mut good = true;
        for line in lines("listen").into_iter().filter(|line| !line.trim().is_empty()) {
            if line.starts_with("State") || line.starts_with("Proto") || line.starts_with("Active") {
                continue;
            }
            let Some(port) = listening(line) else {
                good = false;
                break;
            };
            if !data.listening_ports.contains(&port) {
                data.listening_ports.push(port);
            }
        }
        if !good {
            data.listening_ports.clear();
            failure(&mut data, "listen");
        }
        data.listening_ports
            .sort_by(|a, b| a.addr.cmp(&b.addr).then(a.port.cmp(&b.port)));
    }
    data.valid = complete && (data.facts.os.is_some() || data.facts.kernel.is_some());
    data
}

pub(super) fn service_key(service: &Service) -> String {
    format!("{}:{}", service.kind.as_str(), service.name)
}

fn docker(line: &str) -> Option<(Service, bool)> {
    let fields: Vec<_> = line.splitn(4, '\t').collect();
    if fields.len() != 4 || fields[0].is_empty() || fields[1].is_empty() || fields[3].is_empty() {
        return None;
    }
    let (name, name_changed, name_suspicious) = sanitized(fields[0]);
    let (image, image_changed, image_suspicious) = sanitized(fields[1]);
    if name.is_empty() || image.is_empty() {
        return None;
    }
    Some((
        Service {
            kind: ServiceKind::Docker,
            name,
            image: Some(image),
            ports: port_mappings(fields[2])?,
            role: None,
            critical: false,
            source: FieldSource::Probe,
            last_seen_at: None,
            missing: false,
            sanitized: (name_changed || image_changed).then_some(true),
        },
        name_suspicious || image_suspicious,
    ))
}

fn systemd(line: &str) -> Option<(Service, bool)> {
    let unit = line.split_whitespace().next()?;
    let name = unit.strip_suffix(".service")?;
    let (name, changed, suspicious) = sanitized(name);
    if name.is_empty() {
        return None;
    }
    Some((
        Service {
            kind: ServiceKind::Systemd,
            name,
            image: None,
            ports: Vec::new(),
            role: None,
            critical: false,
            source: FieldSource::Probe,
            last_seen_at: None,
            missing: false,
            sanitized: changed.then_some(true),
        },
        suspicious,
    ))
}

fn address_port(value: &str) -> Option<(String, u16)> {
    let (address, port) = value.rsplit_once(':')?;
    let port = port.parse::<u16>().ok().filter(|port| *port > 0)?;
    let address = address.trim_matches(['[', ']']);
    let address = if address == "*" { "0.0.0.0" } else { address };
    let address = address.parse::<IpAddr>().ok()?.to_string();
    Some((address, port))
}

fn listening(line: &str) -> Option<ListeningPort> {
    let words: Vec<_> = line.split_whitespace().collect();
    if words.len() < 4 || !matches!(words[0], "LISTEN" | "tcp" | "tcp6") {
        return None;
    }
    let (addr, port) = address_port(words[3])?;
    Some(ListeningPort {
        addr,
        port,
        proto: Proto::Tcp,
    })
}

fn range(value: &str) -> Option<(u16, u16)> {
    let (start, end) = value.split_once('-').unwrap_or((value, value));
    let (start, end) = (start.parse::<u16>().ok()?, end.parse::<u16>().ok()?);
    (start > 0 && end >= start && end - start < 64).then_some((start, end))
}

fn port_mappings(value: &str) -> Option<Vec<PortMapping>> {
    let mut out = Vec::new();
    for mapping in value.split(',').map(str::trim).filter(|mapping| !mapping.is_empty()) {
        let Some((host, container)) = mapping.split_once("->") else {
            // 未发布到宿主机的 80/tcp，不是一个 host → container 映射。
            let (port, proto) = mapping.split_once('/')?;
            range(port)?;
            if !matches!(proto, "tcp" | "udp") {
                return None;
            }
            continue;
        };
        let (container, proto) = container.split_once('/')?;
        let proto = match proto {
            "tcp" => Proto::Tcp,
            "udp" => Proto::Udp,
            _ => return None,
        };
        let (host_ip, host_range) = host.rsplit_once(':')?;
        let host_ip = host_ip.trim_matches(['[', ']']).parse::<IpAddr>().ok()?.to_string();
        let (host_start, host_end) = range(host_range)?;
        let (container_start, container_end) = range(container)?;
        if host_end - host_start != container_end - container_start {
            return None;
        }
        for offset in 0..=host_end - host_start {
            out.push(PortMapping {
                host_ip: host_ip.clone(),
                host_port: host_start + offset,
                container_port: container_start + offset,
                proto,
            });
        }
    }
    out.sort_by(|a, b| {
        a.host_ip
            .cmp(&b.host_ip)
            .then(a.host_port.cmp(&b.host_port))
            .then(a.container_port.cmp(&b.container_port))
    });
    Some(out)
}
