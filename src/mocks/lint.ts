// Mock 的 Lint（PRD 5.4）与编译入口。每条结果带服务器 id，界面据此定位到出问题的服务器
import type { Asset, CompilePreview, CompileStatus, EnvId, LintItem, Settings, SkillConfig } from "@/bindings"
import { handleOf } from "@/stores/assets"
import { renderSkill } from "./render"

/** 简化版密钥规则（真实实现复用 gitleaks 规则集） */
const SECRET_RULES: [string, RegExp][] = [
  ["generic-password", /password\s*[=:]\s*\S+/i],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["aws-access-key", /AKIA[0-9A-Z]{16}/],
  ["github-token", /gh[pousr]_[A-Za-z0-9]{36}/],
]
export const INJECTION = /ignore[\s_-]*(all[\s_-]*)?previous|system[\s_-]*prompt|忽略以上/i

export const secretRule = (text: string) => SECRET_RULES.find(([, re]) => re.test(text))?.[0] ?? null

const lineOf = (content: string, test: (line: string) => boolean) => {
  const i = content.split("\n").findIndex(test)
  return i < 0 ? undefined : i + 1
}

function skillSectionAt(content: string, lineIdx: number): "relations" | "conventions" {
  let section: "relations" | "conventions" = "conventions"
  const lines = content.split("\n")
  for (let i = 0; i <= lineIdx && i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      section = lines[i].startsWith("## How they fit together") ? "relations" : "conventions"
    }
  }
  return section
}

/** 编译一份总 Skill：某个运行环境里某个 Agent 的那一份，assets 是分发给它的服务器 */
export function compileSkill(envId: EnvId, agentKey: string, assets: Asset[], config: SkillConfig, settings: Settings): CompilePreview {
  const r = renderSkill(envId, assets, config, settings)
  const lint: LintItem[] = []
  const skill = r.files[0]?.content ?? ""
  for (const a of assets) {
    const alias = handleOf(a)
    const path = r.detailPath.get(a.id)!
    const content = r.files.find((f) => f.path === path)?.content ?? ""
    content.split("\n").forEach((line, i) => {
      const rule = secretRule(line)
      if (rule) lint.push({ id: "secret-detected", level: "error", assetId: a.id, params: { alias, line: i + 1, rule }, file: path, line: i + 1 })
    })
    if (INJECTION.test(a.notes)) {
      const noteLine = a.notes.split(/\r?\n/).find((l) => INJECTION.test(l)) ?? ""
      lint.push({
        id: "suspected-injection",
        level: "warning",
        assetId: a.id,
        params: { alias, source: "notes", value: noteLine.slice(0, 128) },
        file: path,
        line: lineOf(content, (l) => l.includes(noteLine.trim())),
      })
    }
    if (a.type === "cli") continue
    const host = a.connection.host ?? a.connection.resolved?.hostname
    if (!a.export.resolvedConnection && host) {
      const line = lineOf(content, (l) => l.includes(host))
      if (line) lint.push({ id: "export-disabled-field", level: "error", assetId: a.id, params: { alias, field: "HostName" }, file: path, line })
    }
    for (const s of a.services.filter((x) => x.source === "probe" && INJECTION.test(x.name))) {
      lint.push({ id: "suspected-injection", level: "warning", assetId: a.id, params: { alias, source: "probe", value: s.name }, file: path, line: lineOf(content, (l) => l.includes(s.name)) })
    }
    if (a.probe.lastSuccessAt) {
      const days = Math.floor((Date.now() - new Date(a.probe.lastSuccessAt).getTime()) / (24 * 3600 * 1000))
      if (days > 30) lint.push({ id: "probe-stale", level: "info", assetId: a.id, params: { alias, days } })
    }
  }
  // 全局内容（关系、约定）里的密钥：没有服务器 id
  skill.split("\n").forEach((line, i) => {
    const rule = secretRule(line)
    if (rule) {
      lint.push({
        id: "secret-detected",
        level: "error",
        params: { line: i + 1, rule, section: skillSectionAt(skill, i) },
        file: "SKILL.md",
        line: i + 1,
      })
    }
  })
  return {
    envId,
    agentKey,
    files: r.files,
    budget: {
      descriptionChars: r.descriptionChars,
      descriptionLimit: 1024,
      descriptionTrimmed: r.rawDescriptionChars > 1024,
      bodyLines: r.bodyLines,
      bodyLineLimit: settings.bodyLineLimit,
    },
    lint,
    blocked: lint.some((l) => l.level === "error"),
  }
}

export function toStatus(p: CompilePreview, previous?: CompileStatus): CompileStatus {
  return {
    envId: p.envId,
    agentKey: p.agentKey,
    blocked: p.blocked,
    errors: p.lint.filter((l) => l.level === "error").length,
    warnings: p.lint.filter((l) => l.level === "warning").length,
    // 受阻时保留上一次成功的产物（F-203 AC1）
    compiledAt: p.blocked ? (previous?.compiledAt ?? null) : new Date().toISOString(),
    lint: p.lint,
  }
}
