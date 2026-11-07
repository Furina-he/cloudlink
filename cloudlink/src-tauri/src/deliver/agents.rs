//! 识别运行环境里装了哪些 Agent（2026-11-07）。
//! 数据来源：各 Agent 的官方文档或源码，以及 vercel-labs/skills 的 `src/agents.ts`（2026-11 核实）。
//! 大多数 Agent 读通用目录 `~/.agents/skills`，只有 Trae、Trae CN、Kiro、Continue 只认自己的目录，
//! 所以 CloudLink 只需要维护这几个目标；其他品牌的检测结果只用来告诉用户「谁会读到这份 Skill」。
//! 只读：查看目录或文件是否存在、列出编辑器扩展目录，不创建、不修改任何东西。

use std::collections::BTreeSet;
use std::fs;

use crate::env::EnvContext;
use crate::model::delivery::{AgentBrand, AgentId, DetectedAgent};

struct Brand {
    brand: AgentBrand,
    /// 家目录下的标志路径，任意一个存在即视为已安装。Windows 和 Linux 的写法放在一起：
    /// 另一个系统上不会有这些路径
    markers: &'static [&'static [&'static str]],
    /// VS Code 系编辑器扩展目录里的扩展 ID 前缀（小写，带版本号前的连字符）
    extensions: &'static [&'static str],
    /// 读取的目标，第一个是它主要使用的那个
    reads: &'static [AgentId],
}

use AgentBrand as B;
use AgentId::{ClaudeCode as Claude, Continue, Kiro, Trae, TraeCn, Universal};

const CATALOG: &[Brand] = &[
    Brand {
        brand: B::ClaudeCode,
        markers: &[&[".claude"]],
        extensions: &["anthropic.claude-code-"],
        reads: &[Claude],
    },
    Brand {
        brand: B::Codex,
        markers: &[&[".codex"]],
        extensions: &["openai.chatgpt-"],
        reads: &[Universal],
    },
    Brand {
        brand: B::Cursor,
        markers: &[&[".cursor"]],
        extensions: &[],
        reads: &[Universal, Claude],
    },
    Brand {
        brand: B::Windsurf,
        markers: &[&[".codeium", "windsurf"], &["AppData", "Roaming", "Windsurf"]],
        extensions: &[],
        reads: &[Universal],
    },
    // 只有 `~/.gemini` 不算：Antigravity 也会建这个目录
    Brand {
        brand: B::GeminiCli,
        markers: &[&[".gemini", "settings.json"]],
        extensions: &[],
        reads: &[Universal],
    },
    Brand {
        brand: B::Copilot,
        markers: &[&[".copilot"]],
        extensions: &["github.copilot-chat-"],
        reads: &[Universal],
    },
    Brand {
        brand: B::Opencode,
        markers: &[&[".config", "opencode"], &[".local", "share", "opencode"]],
        extensions: &[],
        reads: &[Universal, Claude],
    },
    Brand {
        brand: B::Cline,
        markers: &[&[".cline"]],
        extensions: &["saoudrizwan.claude-dev-"],
        reads: &[Universal],
    },
    Brand {
        brand: B::RooCode,
        markers: &[&[".roo"]],
        extensions: &["rooveterinaryinc.roo-cline-"],
        reads: &[Universal],
    },
    Brand {
        brand: B::KiloCode,
        markers: &[&[".kilo"], &[".kilocode"]],
        extensions: &["kilocode.kilo-code-"],
        reads: &[Universal],
    },
    Brand {
        brand: B::Goose,
        markers: &[&[".config", "goose"], &["AppData", "Roaming", "Block", "goose"]],
        extensions: &[],
        reads: &[Universal, Claude],
    },
    Brand {
        brand: B::Amp,
        markers: &[&[".config", "amp"]],
        extensions: &["sourcegraph.amp-"],
        reads: &[Universal, Claude],
    },
    Brand {
        brand: B::QwenCode,
        markers: &[&[".qwen"]],
        extensions: &[],
        reads: &[Universal],
    },
    Brand {
        brand: B::Droid,
        markers: &[&[".factory"]],
        extensions: &[],
        reads: &[Universal],
    },
    Brand {
        brand: B::Augment,
        markers: &[&[".augment"]],
        extensions: &["augment.vscode-augment-"],
        reads: &[Universal, Claude],
    },
    Brand {
        brand: B::Crush,
        markers: &[
            &[".config", "crush"],
            &[".local", "share", "crush"],
            &["AppData", "Local", "crush"],
        ],
        extensions: &[],
        reads: &[Universal, Claude],
    },
    Brand {
        brand: B::Junie,
        markers: &[&[".junie"]],
        extensions: &[],
        reads: &[Universal],
    },
    Brand {
        brand: B::Warp,
        markers: &[
            &[".warp"],
            &[".config", "warp-terminal"],
            &["AppData", "Local", "warp", "Warp"],
        ],
        extensions: &[],
        reads: &[Universal, Claude],
    },
    Brand {
        brand: B::Trae,
        markers: &[&[".trae"]],
        extensions: &[],
        reads: &[Trae],
    },
    Brand {
        brand: B::TraeCn,
        markers: &[&[".trae-cn"]],
        extensions: &[],
        reads: &[TraeCn],
    },
    Brand {
        brand: B::Kiro,
        markers: &[&[".kiro"]],
        extensions: &[],
        reads: &[Kiro],
    },
    Brand {
        brand: B::Continue,
        markers: &[&[".continue"]],
        extensions: &["continue.continue-"],
        reads: &[Continue],
    },
];

/// VS Code 及其衍生编辑器（含 WSL 远程）的扩展目录
const EXTENSION_DIRS: &[&[&str]] = &[
    &[".vscode", "extensions"],
    &[".vscode-insiders", "extensions"],
    &[".vscode-oss", "extensions"],
    &[".vscode-server", "extensions"],
    &[".cursor", "extensions"],
    &[".cursor-server", "extensions"],
    &[".windsurf", "extensions"],
    &[".windsurf-server", "extensions"],
    &[".trae", "extensions"],
    &[".trae-cn", "extensions"],
    &[".kiro", "extensions"],
];

/// 已安装扩展的目录名（小写）
fn installed_extensions(env: &EnvContext) -> BTreeSet<String> {
    EXTENSION_DIRS
        .iter()
        .filter_map(|dir| fs::read_dir(env.host_in_home(dir)).ok())
        .flat_map(|entries| entries.filter_map(|e| e.ok()))
        .filter_map(|e| e.file_name().to_str().map(str::to_ascii_lowercase))
        .collect()
}

/// 这个环境里检测到的 Agent，按目录表顺序
pub fn detect(env: &EnvContext) -> Vec<DetectedAgent> {
    if !env.available {
        return Vec::new();
    }
    let extensions = installed_extensions(env);
    CATALOG
        .iter()
        .filter(|b| {
            b.markers.iter().any(|m| env.host_in_home(m).exists())
                || b.extensions
                    .iter()
                    .any(|prefix| extensions.iter().any(|e| e.starts_with(prefix)))
        })
        .map(|b| found(b.brand))
        .collect()
}

/// 某个品牌的检测结果（PATH 里找到命令时也用它补上）
pub fn found(brand: AgentBrand) -> DetectedAgent {
    let entry = CATALOG
        .iter()
        .find(|b| b.brand == brand)
        .expect("every brand is in the catalog");
    DetectedAgent {
        brand,
        reads: entry.reads.to_vec(),
    }
}

/// 目标算「已检测到」：有 Agent 把它当作主要目录
pub fn target_detected(agent: AgentId, agents: &[DetectedAgent]) -> bool {
    agents.iter().any(|a| a.reads.first() == Some(&agent))
}

/// 按目录表顺序排列（补上 PATH 里找到的命令之后用）
pub fn sort(agents: &mut [DetectedAgent]) {
    let rank = |b: AgentBrand| CATALOG.iter().position(|c| c.brand == b).unwrap_or(usize::MAX);
    agents.sort_by_key(|a| rank(a.brand));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::Paths;

    fn home(tmp: &std::path::Path, dirs: &[&str], files: &[&str]) -> EnvContext {
        let env = EnvContext::windows(&Paths::isolated_in(tmp));
        for d in dirs {
            fs::create_dir_all(env.host_home.join(d)).unwrap();
        }
        for f in files {
            let path = env.host_home.join(f);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "{}").unwrap();
        }
        env
    }

    fn brands(env: &EnvContext) -> Vec<AgentBrand> {
        detect(env).into_iter().map(|a| a.brand).collect()
    }

    #[test]
    fn every_brand_is_listed_once_and_reads_a_builtin_target() {
        let mut seen = BTreeSet::new();
        for b in CATALOG {
            assert!(seen.insert(b.brand), "{:?} listed twice", b.brand);
            assert!(!b.reads.is_empty() && b.reads.iter().all(|a| AgentId::BUILTIN.contains(a)));
            assert!(!b.markers.is_empty());
        }
        // 每个内置目标都至少有一个 Agent 把它当主要目录
        for agent in AgentId::BUILTIN {
            assert!(CATALOG.iter().any(|b| b.reads[0] == agent), "{agent:?}");
        }
    }

    #[test]
    fn detects_folders_files_and_editor_extensions() {
        let tmp = tempfile::tempdir().unwrap();
        let env = home(
            tmp.path(),
            &[
                ".claude",
                ".cursor",
                ".codeium/windsurf",
                ".trae-cn",
                ".vscode/extensions/saoudrizwan.claude-dev-3.17.0",
                ".cursor/extensions/augment.vscode-augment-0.480.0-win32-x64",
                "AppData/Roaming/Block/goose",
            ],
            &[".gemini/settings.json"],
        );
        assert_eq!(
            brands(&env),
            [
                B::ClaudeCode,
                B::Cursor,
                B::Windsurf,
                B::GeminiCli,
                B::Cline,
                B::Goose,
                B::Augment,
                B::TraeCn
            ]
        );
        let found = detect(&env);
        assert!(target_detected(AgentId::Universal, &found));
        assert!(target_detected(AgentId::TraeCn, &found));
        assert!(!target_detected(AgentId::Trae, &found));
        assert!(!target_detected(AgentId::Kiro, &found));
    }

    #[test]
    fn a_bare_gemini_folder_or_unrelated_extension_is_not_an_agent() {
        let tmp = tempfile::tempdir().unwrap();
        // Antigravity 也建 ~/.gemini；cline 主题扩展不是 Cline
        let env = home(
            tmp.path(),
            &[".gemini/antigravity", ".vscode/extensions/someone.cline-theme-1.0.0"],
            &[],
        );
        assert!(brands(&env).is_empty());
        assert!(!target_detected(AgentId::Universal, &detect(&env)));
        assert!(!target_detected(AgentId::ClaudeCode, &detect(&env)));
    }

    #[test]
    fn cursor_alone_does_not_make_claude_code_detected() {
        let tmp = tempfile::tempdir().unwrap();
        let env = home(tmp.path(), &[".cursor"], &[]);
        let found = detect(&env);
        assert_eq!(found[0].reads, [AgentId::Universal, AgentId::ClaudeCode]);
        assert!(target_detected(AgentId::Universal, &found));
        assert!(
            !target_detected(AgentId::ClaudeCode, &found),
            "Cursor reads Claude's folder but is not Claude Code"
        );
    }

    #[test]
    fn unavailable_environment_reports_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let mut env = home(tmp.path(), &[".claude", ".kiro"], &[]);
        env.available = false;
        assert!(detect(&env).is_empty());
    }
}
