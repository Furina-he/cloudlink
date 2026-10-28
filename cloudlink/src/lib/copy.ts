// 全部界面文案（PRD 6.13、9 国际化）。后端只返回 id 和参数，句子在这里拼
import type {
  ActivityKind,
  ActivityMessageId,
  AgentId,
  EnvId,
  EnvTag,
  IpcErrorId,
  LintId,
  Mode,
  MountStatus,
  ProbeErrorId,
  ProbeState,
  ProbeStep,
} from "@/bindings"
import type { ValidationKey } from "@/lib/schemas"

type Params = Record<string, string | number> | undefined
type Msg = (p: Params) => string

/** 取参数，缺省时用占位，避免文案里出现 undefined */
const v = (p: Params, key: string) => String(p?.[key] ?? "…")

const MODE_LABEL: Record<Mode, string> = { "read-only": "只读巡检", standard: "标准运维" }
const AGENT_LABEL: Record<AgentId, string> = {
  "claude-code": "Claude Code",
  universal: "通用 .agents（Codex 等）",
  cursor: "Cursor",
  "gemini-cli": "Gemini CLI",
  copilot: "GitHub Copilot",
  opencode: "OpenCode",
  custom: "自定义",
}
const envShort = (id: EnvId) =>
  id === "windows" ? "Windows" : id === "macos" ? "macOS" : id === "linux" ? "Linux" : "WSL"
const envLong = (id: EnvId) => (id.startsWith("wsl:") ? `WSL ${id.slice(4)}` : envShort(id))

const modeName = (p: Params, key: string) => MODE_LABEL[v(p, key) as Mode] ?? v(p, key)
const agentName = (p: Params) => AGENT_LABEL[v(p, "agent") as AgentId] ?? v(p, "agent")

export type ViewId = "assets" | "skills" | "mounts" | "activity" | "settings"

export const copy = {
  app: {
    name: "CloudLink",
    skipToMain: "跳到主内容",
  },

  nav: {
    assets: "资产",
    skills: "Skills",
    mounts: "挂载",
    activity: "活动",
    settings: "设置",
  } satisfies Record<ViewId, string>,

  navBadge: {
    assets: (n: number) => `共 ${n} 个资产`,
    skills: (n: number) => `${n} 个 Skill 编译受阻`,
    mounts: (n: number) => `${n} 个挂载失效或冲突`,
  },

  shell: {
    toggleSidebar: "折叠或展开侧栏",
    openCommand: "打开命令面板",
    breadcrumb: "当前位置",
    envStatusTitle: "运行环境",
    envAvailable: "可用",
    envUnavailable: "不可用",
    envStatusLink: "查看运行环境设置",
    envLoading: "正在检测运行环境",
    loadFailed: "加载数据失败",
    retry: "重试",
  },

  /** P1 占位：每个视图一个空状态，写明下一步要做什么 */
  placeholder: {
    assets: {
      title: "还没有打开任何资产",
      description: "从左侧列表选择一个资产，或者从 ~/.ssh/config 导入主机。资产编辑器在下一阶段提供。",
    },
    skills: {
      title: "Skill 总览尚未就绪",
      description: "这里会列出每个资产编译出的 Skill、变体和 Lint 结果。先在资产视图保存一个资产，就会生成对应的 Skill。",
    },
    mounts: {
      title: "挂载看板尚未就绪",
      description: "这里会用看板和矩阵把 Skill 挂到全局 Agent 或项目。先添加一个项目目标，再把 Skill 拖进去。",
    },
    activity: {
      title: "活动日志尚未就绪",
      description: "探测、编译、挂载和修复的记录会按天出现在这里，本地保留 30 天。",
    },
    settings: {
      title: "设置尚未就绪",
      description: "主题、运行环境、Agent 目标、编译、探测和数据设置会出现在这里。",
    },
  } satisfies Record<ViewId, { title: string; description: string }>,

  command: {
    title: "命令面板",
    description: "搜索视图、资产或操作",
    placeholder: "输入视图、资产名称、别名或操作",
    empty: "没有匹配的命令",
    groups: {
      navigate: "跳转",
      assets: "资产",
      actions: "操作",
      mount: "挂载",
    },
    goTo: (view: string) => `前往${view}`,
    actions: {
      newAsset: "新建资产",
      importSsh: "从 ssh config 导入",
      probeCurrent: "探测当前资产",
      probeAll: "探测全部",
      checkAll: "检查全部链接",
      theme: "切换主题",
    },
    mountCurrent: "挂载当前 Skill 到…",
    mountCurrentNone: "挂载当前 Skill 到…（先打开一个资产）",
    mountPageTitle: "选择挂载目标",
    back: "返回",
    theme: { system: "主题：跟随系统", light: "主题：浅色", dark: "主题：深色" },
    themeSet: { system: "已切换为跟随系统", light: "已切换为浅色主题", dark: "已切换为深色主题" },
    notReady: "这个操作将在后续阶段提供",
    checkAllDone: (n: number) => `已检查 ${n} 个挂载`,
  },

  env: {
    tag: { prod: "生产", staging: "预发", dev: "开发" } satisfies Record<EnvTag, string>,
    short: envShort,
    long: envLong,
  },

  agent: AGENT_LABEL,

  mode: MODE_LABEL,

  mountStatus: {
    pending: "挂载中",
    ok: "已挂载",
    broken: "已失效",
    conflict: "冲突",
    "stale-copy": "复制模式待同步",
    "alias-missing": "别名不可达",
  } satisfies Record<MountStatus, string>,
  mountOkCopy: "已挂载（复制）",

  probeState: {
    never: "从未探测",
    ok: "正常",
    stale: "已过期",
    failed: "失败",
  } satisfies Record<ProbeState, string>,
  probing: "探测中",

  compileState: { ok: "正常", warning: "有警告", blocked: "编译受阻" },

  probeStep: {
    "resolve-alias": "解析别名",
    connect: "建立连接",
    "collect-system": "采集系统信息",
    "collect-services": "采集服务",
    "collect-ports": "采集监听端口",
    diff: "生成差异",
  } satisfies Record<ProbeStep, string>,

  /** 探测错误分类（PRD 8.3）：标题 + 建议 */
  probeError: {
    "auth-failed": {
      title: (p) => `${v(p, "alias")} 拒绝了密钥认证`,
      hint: (p) => `在终端运行 ssh-add -l 确认密钥已加载，再执行 ssh ${v(p, "alias")} 测试。`,
    },
    "host-key-unknown": {
      title: (p) => `本机还不认识 ${v(p, "alias")} 的主机密钥`,
      hint: (p) => `在终端运行一次 ssh ${v(p, "alias")}，核对指纹后再探测。CloudLink 不会自动信任主机密钥。`,
    },
    "host-key-changed": {
      title: (p) => `${v(p, "alias")} 的主机密钥变了，可能是重装了系统，也可能是中间人攻击`,
      hint: () => "核实之后，手动更新 known_hosts 再探测。",
    },
    "resolve-failed": {
      title: (p) => `无法解析 ${v(p, "alias")} 的地址`,
      hint: () => "检查 ssh config 中的 HostName。",
    },
    timeout: {
      title: (p) => `连接 ${v(p, "alias")} 超时（10 秒）`,
      hint: () => "检查网络、防火墙和安全组。",
    },
    "connection-refused": {
      title: (p) => `${v(p, "alias")} 的 SSH 端口拒绝连接`,
      hint: () => "检查 sshd 是否运行、端口是否正确。",
    },
    "needs-interaction": {
      title: () => "密钥需要输入口令，但当前无法交互",
      hint: () => "用 ssh-agent 加载密钥后再探测。",
    },
    partial: {
      title: (p) => `部分信息采集失败：${v(p, "section")} 需要权限`,
      hint: (p) => `把用户加入 ${v(p, "section")} 组，或者忽略这一段。`,
    },
    unknown: {
      title: (p) => `探测 ${v(p, "alias")} 失败`,
      hint: () => "打开日志目录查看详情，或稍后重试。",
    },
  } satisfies Record<ProbeErrorId, { title: Msg; hint: Msg }>,
  probeCancelled: "已取消探测",

  /** Lint 规则（PRD 5.4） */
  lint: {
    "name-format": () => "name 只能包含小写字母、数字和单个连字符，最长 64 个字符",
    "reserved-name": (p) => `${v(p, "slug")} 是 Claude Code 的保留目录名，请换一个 slug`,
    "description-empty": () => "description 为空，需要写明「做什么」和「什么时候用」",
    "description-too-long": (p) => `description 有 ${v(p, "chars")} 个字符，超过上限 1024`,
    "secret-detected": (p) => `第 ${v(p, "line")} 行疑似包含密钥（${v(p, "rule")}），已阻断发布`,
    "export-disabled-field": (p) => `已关闭导出的「${v(p, "field")}」出现在产物中，已阻断发布`,
    "missing-reference": (p) => `引用的 ${v(p, "path")} 不存在`,
    "body-too-long": (p) => `正文 ${v(p, "lines")} 行，超过上限 ${v(p, "limit")} 行`,
    "description-missing-alias": () => "description 中没有出现别名或站点名，Agent 可能不会正确触发这个 Skill",
    "prod-standard-no-guardrails": () => "生产资产使用标准运维档，但没有任何自定义红线，建议补充",
    "probe-stale": (p) => `探测数据已有 ${v(p, "days")} 天，建议重新探测`,
    "suspected-injection": (p) => `探测得到的「${v(p, "value")}」疑似包含指令，请核实`,
  } satisfies Record<LintId, Msg>,

  /** IPC 错误（后端只给 id） */
  ipcError: {
    "not-found": () => "对象不存在，可能已被删除。刷新后重试。",
    "slug-taken": (p) => `slug ${v(p, "slug")} 已被其他资产使用，请换一个。`,
    "already-mounted": (p) => `${v(p, "slug")} 已在此目标挂载。`,
    "mode-conflict": (p) =>
      `无法挂载：${v(p, "slug")} 已以「${modeName(p, "globalMode")}」挂在 ${agentName(p)} 的全局目录，项目里不能再用「${modeName(p, "mode")}」。不同 Agent 对同名 Skill 的取舍不同，红线会因 Agent 而异。请先统一档位。`,
    "needs-confirm-prod-global": (p) =>
      `${v(p, "slug")} 是生产资产。挂到全局后，所有项目中读取这个全局目录的 Agent 都会看到它。`,
    "needs-confirm-alias-missing": (p) =>
      `${v(p, "alias")} 没有定义在 ${envLong(v(p, "env") as EnvId)} 的 ssh config 里，该环境中的 Agent 无法连接。`,
    internal: (p) => `内部错误：${v(p, "message")}。打开日志目录查看详情。`,
  } satisfies Record<IpcErrorId, Msg>,

  validation: {
    "slug-required": "请填写 slug",
    "slug-too-long": "slug 最长 64 个字符",
    "slug-format": "只能包含小写字母、数字和单个连字符，不能以连字符开头或结尾",
    "slug-reserved": "synced 是 Claude Code 的保留目录名",
    "slug-taken": "这个 slug 已被其他资产使用",
    "alias-required": "请填写 SSH 别名",
    "alias-format": "别名不能包含空格或通配符（*、?、!）",
    "rule-empty": "红线内容不能为空",
    "path-label-required": "请填写用途",
    "path-required": "请填写路径",
  } satisfies Record<ValidationKey, string>,

  activityKind: {
    probe: "探测",
    compile: "编译",
    mount: "挂载",
    unmount: "卸载",
    repair: "修复",
  } satisfies Record<ActivityKind, string>,

  activity: {
    "probe-changes": (p) => `探测了 ${v(p, "alias")}，发现 ${v(p, "count")} 处变更`,
    "probe-no-changes": (p) => `探测了 ${v(p, "alias")}，未发现变更`,
    "probe-failed": (p) => `探测 ${v(p, "alias")} 失败`,
    "compile-ok": (p) => `编译了 ${v(p, "slug")}（${v(p, "mode")}）`,
    "compile-blocked": (p) => `${v(p, "slug")} 编译受阻：${v(p, "count")} 个错误`,
    "mount-ok": (p) => `把 ${v(p, "slug")} 挂载到 ${v(p, "target")}`,
    "unmount-ok": (p) => `从 ${v(p, "target")} 卸载了 ${v(p, "slug")}`,
    "repair-ok": (p) => `修复了 ${v(p, "slug")} 在 ${v(p, "target")} 的链接`,
  } satisfies Record<ActivityMessageId, Msg>,

  toast: {
    unmounted: (slug: string) => `已卸载 ${slug}`,
    undo: "撤销",
  },

  /** dnd-kit 屏幕阅读器播报（PRD 6.13） */
  dnd: {
    pickup: (slug: string) => `已拿起 ${slug}。用方向键选择目标，空格放下，Esc 取消。`,
    over: (target: string) => `当前位于 ${target}。`,
    drop: (target: string) => `已挂载到 ${target}。`,
    cancel: "已取消挂载。",
  },
}

/** 把 ipc 错误映射成一句可读的中文 */
export function ipcErrorText(id: IpcErrorId, params?: Params): string {
  return copy.ipcError[id](params)
}
