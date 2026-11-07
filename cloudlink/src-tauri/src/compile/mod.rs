//! 编译器（PRD 第五章、8.4、F-201 到 F-205）：每个「运行环境 × Agent」一份总 Skill。
//! 预览和发布调用同一个 `compile`，同一份输入得到逐字节相同的内容（F-204 AC）。

pub mod lint;
pub mod publish;
pub mod relations;
pub mod render;
pub mod secrets;

use crate::model::asset::Asset;
use crate::model::compile::{CompileBudget, CompilePreview, CompileStatus, LintLevel, SkillConfig};
use crate::model::env::EnvId;

pub struct CompileInput<'a> {
    pub env_id: &'a EnvId,
    pub agent_key: &'a str,
    /// 列入这一份的资源
    pub assets: &'a [&'a Asset],
    pub all_assets: &'a [Asset],
    pub config: &'a SkillConfig,
    /// 该运行环境写法的笔记收件箱目录
    pub inbox: &'a str,
    pub body_line_limit: u32,
    pub write_snapshot_time: bool,
    /// 编译时刻（秒），决定 `Snapshot:` 日期和探测是否过期
    pub now_secs: i64,
}

pub fn compile(input: &CompileInput) -> CompilePreview {
    let today = crate::time::format_date(input.now_secs);
    let rendered = render::render_skill(&render::RenderInput {
        assets: input.assets,
        all_assets: input.all_assets,
        config: input.config,
        inbox: input.inbox,
        snapshot: input.write_snapshot_time.then_some(today.as_str()),
    });
    let lint = lint::lint(&lint::LintInput {
        assets: input.assets,
        rendered: &rendered,
        body_line_limit: input.body_line_limit,
        now_secs: input.now_secs,
    });
    CompilePreview {
        env_id: input.env_id.clone(),
        agent_key: input.agent_key.to_string(),
        budget: CompileBudget {
            description_chars: rendered.description.text.chars().count() as u32,
            description_limit: render::DESCRIPTION_LIMIT as u32,
            body_lines: rendered.body_lines as u32,
            body_line_limit: input.body_line_limit,
        },
        blocked: lint.iter().any(|l| l.level == LintLevel::Error),
        lint,
        files: rendered.files,
    }
}

/// 受阻时保留上一次成功的产物和时间（F-203 AC1）
pub fn to_status(p: &CompilePreview, previous: Option<&CompileStatus>, now: &str) -> CompileStatus {
    CompileStatus {
        env_id: p.env_id.clone(),
        agent_key: p.agent_key.clone(),
        blocked: p.blocked,
        errors: p.lint.iter().filter(|l| l.level == LintLevel::Error).count() as u32,
        warnings: p.lint.iter().filter(|l| l.level == LintLevel::Warning).count() as u32,
        compiled_at: if p.blocked {
            previous.and_then(|s| s.compiled_at.clone())
        } else {
            Some(now.to_string())
        },
        lint: p.lint.clone(),
    }
}

#[cfg(test)]
mod tests;
