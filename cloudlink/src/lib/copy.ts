// 全部界面文案（PRD 6.11、9 国际化）。后端只返回 id 和参数，句子在这里拼
import type {
  ActivityKind,
  ActivityMessageId,
  AgentBrand,
  AgentId,
  AgentNoteFlag,
  AuthMethod,
  CliProvider,
  CliScopeKind,
  DeliveryStatus,
  DistributeBlockReason,
  EnvId,
  GuardDetailId,
  GuardReasonId,
  GuardState,
  InclusionReasonId,
  IpcErrorId,
  LintId,
  LintLevel,
  Mode,
  OperationDecision,
  ProbeChange,
  ProbeChangeKind,
  ProbeState,
  ProbeStep,
  ProbeStepStatus,
  RelationKind,
  SshErrorId,
  TrayCopy,
} from "@/bindings"
import type { PanelTemplateId } from "@/lib/panelTemplates"
import type { ValidationKey } from "@/lib/schemas"
import type { CliEnvStatus, ConnState } from "@/stores/assets"
import type { UpdateTask } from "@/stores/update"

type Params = Record<string, string | number> | undefined
type Msg = (p: Params) => string

/** 名称后面紧跟中文时：以英文或数字结尾的名称留一个空格（「hk-edge 已添加」「东京节点已添加」） */
const spaced = (name: string) => (/[A-Za-z0-9]$/.test(name) ? `${name} ` : name)

/** 取参数，缺省时用占位，避免文案里出现 undefined */
const v = (p: Params, key: string) => String(p?.[key] ?? "…")

const MODE_LABEL: Record<Mode, string> = {
  "read-only": "只读巡检",
  standard: "标准运维",
}
const AGENT_LABEL: Record<AgentId, string> = {
  "claude-code": "Claude Code",
  universal: "通用目录",
  trae: "Trae",
  "trae-cn": "Trae CN",
  kiro: "Kiro",
  continue: "Continue",
  custom: "自定义目录",
}
/** 资源行上 Agent 按钮的短名称；自定义目录用用户填的名称 */
const AGENT_SHORT: Record<Exclude<AgentId, "custom">, string> = {
  "claude-code": "Claude Code",
  universal: "通用",
  trae: "Trae",
  "trae-cn": "Trae CN",
  kiro: "Kiro",
  continue: "Continue",
}
/** 检测到的 Agent 品牌（产品名，不翻译） */
const BRAND_NAME: Record<AgentBrand, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  windsurf: "Windsurf",
  "gemini-cli": "Gemini CLI",
  copilot: "GitHub Copilot",
  opencode: "OpenCode",
  cline: "Cline",
  "roo-code": "Roo Code",
  "kilo-code": "Kilo Code",
  goose: "Goose",
  amp: "Amp",
  "qwen-code": "Qwen Code",
  droid: "Factory Droid",
  augment: "Augment",
  crush: "Crush",
  junie: "Junie",
  warp: "Warp",
  trae: "Trae",
  "trae-cn": "Trae CN",
  kiro: "Kiro",
  continue: "Continue",
}
/** 关系句子里的一组名称：每个都是等宽片段（`名称`），用顿号分隔 */
const codeList = (p: Params, key: string) =>
  v(p, key)
    .split("、")
    .filter(Boolean)
    .map((x) => `\`${x}\``)
    .join("、")
const codeOf = (p: Params, key: string) => `\`${v(p, key)}\``
const envShort = (id: EnvId) =>
  id === "windows"
    ? "Windows"
    : id === "macos"
      ? "macOS"
      : id === "linux"
        ? "Linux"
        : "WSL"
const envLong = (id: EnvId) =>
  id.startsWith("wsl:") ? `WSL ${id.slice(4)}` : envShort(id)
const envOf = (p: Params) => envLong(v(p, "env") as EnvId)
/** 「Claude Code（Windows）」：一份总 Skill 属于哪个 Agent、哪个运行环境；没有 target 参数时只写运行环境 */
const targetOf = (p: Params) =>
  p?.target ? `${v(p, "target")}（${envOf(p)}）` : `${envOf(p)} `
/** Lint 的主语：资源的问题写标识（「hk-edge 里」），全局内容的问题写「资源关系或运维约定里」。行号在下面的位置里，文案不重复 */
const within = (p: Params) =>
  p?.alias ? `${p.alias} 里` : "资源关系或运维约定里"

/** ssh 错误分类（PRD 8.3）：标题 + 下一步。探测和测试连接共用 */
const SSH_ERROR: Record<SshErrorId, { title: Msg; hint: Msg }> = {
  "auth-failed": {
    title: (p) => `${v(p, "alias")} 拒绝了密钥认证`,
    hint: () =>
      "确认公钥已加入服务器的 ~/.ssh/authorized_keys；认证方式为 ssh-agent 时，在终端运行 ssh-add -l 确认密钥已加载。",
  },
  "password-rejected": {
    title: (p) => `${v(p, "alias")} 拒绝了密码`,
    hint: () =>
      "重新输入密码；确认服务器允许密码登录（PasswordAuthentication yes）。",
  },
  "host-key-unknown": {
    title: (p) => `本机还不认识 ${v(p, "alias")} 的主机密钥`,
    hint: () =>
      "点「测试连接」，核对指纹后信任。CloudLink 只沿用你在 known_hosts 里确认过的同一把公钥，不会自动信任陌生的主机密钥。",
  },
  "host-key-changed": {
    title: (p) =>
      `${v(p, "alias")} 的主机密钥变了，可能是重装了系统，也可能是中间人攻击`,
    hint: () => "核实之后，手动更新 known_hosts。",
  },
  "resolve-failed": {
    title: (p) => `无法解析 ${v(p, "alias")} 的地址`,
    hint: () =>
      "检查地址是否填写正确；导入的服务器检查 ssh config 中的 HostName。",
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
    hint: () => "用 ssh-agent 加载密钥，并把认证方式改为 ssh-agent。",
  },
  "key-permissions": {
    title: () => "私钥文件权限过宽，ssh 拒绝使用",
    hint: (p) =>
      String(p?.env ?? "").startsWith("wsl:")
        ? "WSL 中的 ssh 要求私钥只有你能读（600 权限）。用「复制到 WSL」放一份副本到 ~/.ssh/。"
        : "Windows 版 OpenSSH 拒绝其他用户也能读取的私钥，下载目录里的密钥常见这个问题。用「复制到 ~/.ssh」放一份只有你能读的副本，原文件不动。",
  },
  "key-not-found": {
    title: (p) => `找不到私钥文件 ${v(p, "path")}`,
    hint: () => "检查路径是否正确，或者重新选择私钥文件。",
  },
  "key-invalid": {
    title: (p) =>
      p?.reason === "putty"
        ? "这是 PuTTY 格式的私钥（.ppk），OpenSSH 不能直接使用"
        : p?.reason === "public-key"
          ? "选择的是公钥（.pub），不是私钥"
          : "无法识别这个私钥文件",
    hint: (p) =>
      p?.reason === "putty"
        ? "用 PuTTYgen 打开它，选 Conversions → Export OpenSSH key 导出后再选择导出的文件。"
        : p?.reason === "public-key"
          ? "选择同名但不带 .pub 的那个文件。"
          : "选择 OpenSSH 格式的私钥（以 -----BEGIN 开头）。",
  },
  partial: {
    title: (p) => `部分信息采集失败：${v(p, "section")} 需要权限`,
    hint: (p) => `把用户加入 ${v(p, "section")} 组，或者忽略这一段。`,
  },
  unknown: {
    title: (p) => `连接 ${v(p, "alias")} 失败`,
    hint: () => "打开日志目录查看详情，或稍后重试。",
  },
}
/** 活动和 IPC 错误里带着 ssh 错误 id（params.error） */
const sshTitle = (p: Params) =>
  SSH_ERROR[(p?.error as SshErrorId) ?? "unknown"]?.title(p) ?? v(p, "error")
const sshHint = (p: Params) =>
  (SSH_ERROR[(p?.error as SshErrorId) ?? "unknown"] ?? SSH_ERROR.unknown).hint(p)

/** 未列入的原因（F-303 AC2），参数里带 env */
const INCLUSION_REASON: Record<InclusionReasonId, Msg> = {
  "agent-off": () => "没有分发给这个 Agent",
  unverified: () => "还没有通过连接验证，请先测试连接",
  "env-unavailable": (p) => `${envOf(p)} 暂时不可用`,
  "password-only": () => "只用密码认证，Agent 无法输入密码",
  "not-defined": (p) => `${envOf(p)} 的 ssh config 里没有这个别名`,
  "not-written": (p) => `没有勾选在 ${envOf(p)} 里可用`,
  "include-missing": (p) => `SSH 配置在 ${envOf(p)} 里还没生效`,
  "no-key-in-env": (p) => `${envOf(p)} 中没有配置私钥`,
  "cli-not-installed": (p) => `${envOf(p)} 没有安装 ${v(p, "cli")}`,
  "cli-not-logged-in": (p) => `${envOf(p)} 的 ${v(p, "cli")} 还没有登录`,
}

/** 同上，用在已经写明运行环境的问题行副行里，不再重复环境名 */
const INCLUSION_REASON_IN_ENV: Record<InclusionReasonId, Msg> = {
  "agent-off": () => "没有分发给这个 Agent",
  unverified: () => "还没有通过连接验证，请先测试连接",
  "env-unavailable": () => "这个运行环境暂时不可用",
  "password-only": () => "只用密码认证，Agent 无法输入密码",
  "not-defined": () => "ssh config 里没有这个别名",
  "not-written": () => "没有勾选在这个运行环境里可用",
  "include-missing": () => "SSH 配置在这里还没生效",
  "no-key-in-env": () => "这里没有配置私钥",
  "cli-not-installed": (p) => `没有安装 ${v(p, "cli")}`,
  "cli-not-logged-in": (p) => `${v(p, "cli")} 还没有登录`,
}

/** 护栏未生效、不可用的原因（F-306 AC5） */
const GUARD_DETAIL: Record<GuardDetailId, Msg> = {
  "entry-missing": () => "settings.json 中的条目被删除了",
  "self-test-failed": () => "护栏程序自检失败",
  "hooks-disabled": () => "settings.json 设置了 disableAllHooks",
  "settings-invalid": () =>
    "settings.json 不是合法的 JSON，CloudLink 没有修改它",
  "interop-disabled": () => "WSL 互操作已关闭，护栏程序无法运行",
}

const DISTRIBUTE_BLOCK: Record<DistributeBlockReason, string> = {
  unverified: "连接还没有通过验证，先测试连接",
  failed: "最近一次连接失败，测试连接通过后才能分发",
  "password-only": "只用密码认证，Agent 无法输入密码；先改用密钥登录",
  "cli-not-ready": "CLI 还没有在任何运行环境里就绪；先安装并登录",
}

export type ViewId = "servers" | "agents" | "activity" | "settings"

export const copy = {
  app: { name: "CloudLink", skipToMain: "跳到主内容" },

  nav: { servers: "资源", agents: "Agent", activity: "动态", settings: "设置" } satisfies Record<
    ViewId,
    string
  >,

  navBadge: {
    servers: (n: number) => `共 ${n} 项资源`,
    blocked: (n: number) => `${n} 项资源导致编译受阻`,
    agents: (n: number) => `${n} 个问题需要处理`,
  },

  shell: {
    nav: "主导航",
    openCommand: "打开命令面板",
    search: "搜索资源",
    add: "添加",
    navToSide: "导航移到左侧",
    navToTop: "导航移到顶部",
    activityPending: "有待确认的事项",
    minimize: "最小化",
    maximize: "最大化或还原",
    close: "关闭",
    guardOn: (n: number) => (n > 0 ? `护栏运行中 · 今天拦截 ${n} 条` : "护栏运行中"),
    guardOff: "护栏未生效",
    starting: "正在打开 CloudLink…",
    startFailed: "暂时无法打开 CloudLink",
    startFailedHint: "未能连接应用服务。请重试；若仍无法打开，请重启 CloudLink。",
    nativeThemeFailed: "原生窗口的主题未能同步",
    loadFailed: "加载数据失败",
    retry: "重试",
  },

  command: {
    title: "命令面板",
    description: "搜索视图、资源或操作",
    placeholder: "输入视图、资源名称、标识或操作",
    empty: "没有匹配的命令",
    groups: { navigate: "跳转", servers: "资源", system: "系统" },
    // 中文和英文之间留一个空格（「前往 Agent」），与其余文案一致
    goTo: (view: string) =>
      /^[A-Za-z]/.test(view) ? `前往 ${view}` : `前往${view}`,
    actions: {
      newServer: "添加 SSH 服务器",
      // 云平台和代码托管（GitHub）都走这一条，不写「云平台 CLI」
      addCli: (name: string) => `添加 ${name}`,
      importSsh: "从 ssh config 导入",
      // 以下几条针对打开着的那项资源，写出它的标识（输入标识也能搜到）；没打开资源时不出现
      testCurrent: (handle: string) => `测试 ${handle} 的连接`,
      recheckCli: (handle: string) => `重新检测 ${handle}`,
      probeCurrent: (handle: string) => `探测 ${handle}`,
      probeAll: "探测全部",
      // 动词在前，和其余命令一致；中文名称（「通用目录」）前不留空格，英文名称前留一个
      distributeTo: (agent: string, handle: string) => `把 ${handle} 分发给${/^[A-Za-z0-9]/.test(agent) ? " " : ""}${agent}`,
      stopTo: (agent: string, handle: string) => `停止把 ${handle} 分发给${/^[A-Za-z0-9]/.test(agent) ? " " : ""}${agent}`,
      setMode: (handle: string, mode: string) => `把 ${handle} 切换为「${mode}」`,
      preview: "预览 Skill",
      // 只动生产资源（F-407 AC2），名字里写明
      allReadOnly: "生产资源全部切回只读",
      theme: "切换主题",
    },
    back: "返回",
    theme: {
      system: "主题：跟随系统",
      light: "主题：浅色",
      dark: "主题：深色",
    },
    themeSet: {
      system: "已切换为跟随系统",
      light: "已切换为浅色主题",
      dark: "已切换为深色主题",
    },
  },

  env: {
    short: envShort,
    long: envLong,
  },

  agent: AGENT_LABEL,
  agentShort: AGENT_SHORT,
  brand: BRAND_NAME,
  /** 一份总 Skill 的名称：Agent（运行环境） */
  agentInEnv: (agent: string, env: string) => `${agent}（${env}）`,

  mode: MODE_LABEL,
  modeHint: {
    "read-only":
      "只允许巡检类命令，例如 docker ps、docker logs、df -h。需要改动时，Agent 先向你说明计划并停下。",
    standard:
      "允许常规部署和重启服务。删除数据、改防火墙或 SSH 配置、停止关键服务、重启主机前，必须先征得你同意。",
  } satisfies Record<Mode, string>,

  /** 资源行和详情的连接状态（6.11 状态词表）。changed 仍是「未验证」，另附一句提示（F-106 AC4） */
  connState: {
    connected: "已连接",
    unverified: "未验证",
    failed: "连接失败",
    changed: "未验证",
  } satisfies Record<ConnState, string>,
  connChangedHint: "连接信息已修改，请重新测试",
  testing: "连接中",

  auth: {
    key: "私钥文件",
    agent: "ssh-agent",
    password: "密码",
  } satisfies Record<AuthMethod, string>,

  distributeBlock: DISTRIBUTE_BLOCK,
  inclusion: {
    included: "已列入",
    excluded: "未列入",
    /** 详情页 Agent 权限卡里的问题行标题（DESIGN.md Settings-style List） */
    cannotUse: (env: string, agents: string, kind: "server" | "cli") =>
      `${env} 里的 ${agents} 还用不了这${kind === "cli" ? "个平台" : "台服务器"}`,
  },
  inclusionReason: INCLUSION_REASON,
  inclusionReasonInEnv: INCLUSION_REASON_IN_ENV,
  /** 未列入时的处理入口 */
  inclusionFix: {
    "password-only": "改用密钥登录",
    "not-written": "编辑连接",
    "include-missing": "加入 SSH 配置",
    "no-key-in-env": "配置私钥",
    "cli-not-installed": "去安装",
    "cli-not-logged-in": "去登录",
  } as Partial<Record<InclusionReasonId, string>>,

  delivery: {
    pending: "同步中",
    ok: "已同步",
    missing: "副本缺失",
    modified: "副本被改动",
    outdated: "待同步",
    conflict: "冲突",
    broken: "同步失败",
    shared: "共用目录",
  } satisfies Record<DeliveryStatus, string>,

  probeState: {
    never: "从未探测",
    ok: "正常",
    stale: "已过期",
    failed: "失败",
  } satisfies Record<ProbeState, string>,
  probing: "探测中",

  compileState: { ok: "正常", warning: "有警告", blocked: "编译受阻" },

  guardState: {
    active: "已生效",
    "not-installed": "未安装",
    broken: "未生效",
    unavailable: "不可用",
  } satisfies Record<GuardState, string>,
  guardDetail: GUARD_DETAIL,

  decision: { allowed: "已放行", denied: "已拦下" } satisfies Record<
    OperationDecision,
    string
  >,
  /** 护栏拦下或标注的原因（8.6） */
  guardReason: {
    "read-only": "只读巡检的资源，这不是巡检类命令",
    "credential-read": "读取凭据文件",
    "volume-delete": "删除数据卷",
    "data-delete": "删除数据",
    "host-reboot": "重启或关闭主机",
    firewall: "修改防火墙",
    "ssh-config": "修改 SSH 配置或停止 sshd",
    "critical-service": "停止或删除标为「关键」的服务",
    "file-transfer": "只读服务器上的文件传输",
    interactive: "只读服务器上的交互式登录或经标准输入执行脚本",
    "cli-env-export": "导出云平台 CLI 的凭据",
    "cli-write": "只读巡检的云平台，这不是查询或日志命令",
    "cli-destroy": "删库、删站或销毁云资源",
    "cli-account": "无法确认命令使用的是已绑定的云平台账号",
    "cli-scope": "命令目标不在已公开的范围内，或无法确认目标",
    unparsed: "无法确认是只读命令",
  } satisfies Record<GuardReasonId, string>,
  unparsedAllowed: "未能解析，已放行",

  probeStep: {
    "resolve-alias": "解析别名",
    connect: "建立连接",
    "collect-system": "采集系统信息",
    "collect-services": "采集服务",
    "collect-ports": "采集监听端口",
    merge: "合并结果",
  } satisfies Record<ProbeStep, string>,
  probeStepStatus: {
    running: "进行中",
    done: "完成",
    error: "失败",
  } satisfies Record<ProbeStepStatus, string>,

  sshError: SSH_ERROR,
  /** 需要在终端执行的命令（6.4：用 CodeBlock 配复制按钮展示） */
  sshCommands: {
    "auth-failed": (p: Params) => ["ssh-add -l", `ssh ${v(p, "alias")} true`],
    "needs-interaction": () => ["ssh-add -l"],
  } as Partial<Record<SshErrorId, (p: Params) => string[]>>,

  /** Lint 规则（PRD 5.4）。带 alias 参数时主语是这台服务器 */
  lint: {
    "description-too-long": (p) =>
      `description 有 ${v(p, "chars")} 个字符，已截断到 1024 以内。缩短用途可以让更多资源写进描述`,
    "secret-detected": (p) =>
      `${within(p)}疑似有密钥（${v(p, "rule")}），已阻断发布`,
    "export-disabled-field": (p) =>
      `已关闭导出的「${v(p, "field")}」出现在 ${v(p, "alias")} 的产物中，已阻断发布`,
    "missing-reference": (p) => `引用的 ${v(p, "path")} 不存在`,
    "body-too-long": (p) =>
      `Skill 正文 ${v(p, "lines")} 行，超过提醒的长度 ${v(p, "limit")} 行`,
    "prod-standard-no-guardrails": (p) =>
      `${v(p, "alias")} 是生产资源，使用标准运维档，但没有自定义红线，建议补充`,
    "probe-stale": (p) =>
      `${v(p, "alias")} 的探测数据已有 ${v(p, "days")} 天，建议重新探测`,
    "suspected-injection": (p) =>
      `${within(p)}有「${v(p, "value")}」，像是写给 Agent 的指令，请核实`,
    "publish-failed": (p) =>
      `${targetOf(p)}的编译产物无法写入。检查目录后重试。`,
  } satisfies Record<LintId, Msg>,
  lintLevel: { error: "错误", warning: "警告", info: "提示" } satisfies Record<
    LintLevel,
    string
  >,

  /** IPC 错误（后端只给 id） */
  ipcError: {
    "not-found": () => "对象不存在，可能已被删除。刷新后重试。",
    "alias-taken": (p) => `${v(p, "alias")} 已被其他资源使用，请换一个。`,
    "alias-conflict": (p) =>
      `${envOf(p)} 的 ssh config 里已有 Host ${v(p, "alias")}，请换一个别名。`,
    "cannot-distribute": (p) =>
      DISTRIBUTE_BLOCK[v(p, "reason") as DistributeBlockReason] ??
      "这项资源还不能分发",
    "password-missing": () =>
      "凭据库里没有这台服务器的密码，先填写密码并测试连接。",
    "password-target-changed": () =>
      "地址、端口、用户或认证方式改过了，已保存的密码不会发往新的目标。请重新填写密码再测试。",
    "connection-failed": (p) => `${sshTitle(p)}。认证方式没有切换。${sshHint(p)}`,
    "settings-invalid": (p) =>
      p?.path
        ? `${v(p, "path")} 不是合法的 JSON，CloudLink 没有修改它。修好后再试。`
        : "输入的内容或路径不符合要求，请检查后重试。",
    "interop-disabled": (p) =>
      `${envOf(p)} 的 WSL 互操作已关闭，请启用后重试。`,
    "target-exists": (p) =>
      p?.path
        ? `${v(p, "path")} 与已有目标冲突，或无法确认归属。请换一个目录，或检查后重试。`
        : "目标目录存在冲突，或无法确认归属。请检查后重试。",
    "source-missing": (p) =>
      p?.path
        ? `找不到 ${v(p, "path")}。请检查路径后重试。`
        : "找不到可用的源文件或最新编译产物。到 Agent 页点「检查全部」重新生成后再试；仍然失败请重新安装 CloudLink。",
    "compile-blocked": () =>
      "编译受阻，暂时无法创建或修复副本。请先处理检查结果中的错误。",
    "cli-account-unavailable": () =>
      "当前 CLI 无法访问这个账号。请登录对应账号后重新检测。",
    "cli-scope-permission": () =>
      "当前账号没有读取资源范围的权限。请检查权限后重试。",
    "cli-scope-failed": () =>
      "无法读取当前账号的资源范围，请重新检测并刷新范围。",
    "cli-command-unsupported": () =>
      "当前 CLI 的命令或输出格式不受支持，请更新 CLI 后重新检测。",
    "terminal-command-invalid": () =>
      "这条命令不在支持的安装或登录指引中，请重新打开指引。",
    "note-has-secret": () => "这条笔记仍然疑似包含密钥。删掉密钥后再并入。",
    "reset-incomplete": () => "数据清理尚未完成，已暂停资源变更与分发。请在「设置 → 危险操作」中再次清空数据，重试剩余清理。",
    "update-busy": (p) =>
      `${updateWaitText(v(p, "task") as UpdateTask, v(p, "name"))}。`,
    "update-download-failed": () =>
      "下载安装包失败。请检查网络后重试，或到 GitHub Releases 手动下载。",
    "update-signature-invalid": () =>
      "安装包签名校验失败，已丢弃。请稍后重试，或到 GitHub Releases 手动下载。",
    "update-install-failed": () =>
      "无法启动安装程序。请重试，或到 GitHub Releases 手动下载。",
    internal: (p) =>
      p?.message
        ? `内部错误：${v(p, "message")}。打开日志目录查看详情。`
        : "操作失败，请打开日志目录查看详情。",
  } satisfies Record<IpcErrorId, Msg>,

  common: {
    cancel: "取消",
    undo: "撤销",
    close: "关闭",
    clear: "清除",
    showOptions: "展开选项",
    remove: (value: string) => `移除 ${value}`,
    copy: "复制",
    copied: "已复制",
    copiedValue: (value: string) => `已复制 ${value}`,
    done: "完成",
    retry: "重试",
    openLogs: "打开日志目录",
    optional: "可选",
    none: "无",
    more: "更多操作",
    createValue: (value: string) => `使用「${value}」`,
    noOptions: "没有匹配的选项",
    reveal: "在文件夹中显示",
  },

  /** 资源配电盘（PRD 6.4） */
  /** 资源行（PRD 6.3，2026-11-08 重设计） */
  row: {
    prod: "生产",
    loggedIn: (account: string | null) => (account ? `已登录 ${account}` : "已登录"),
    modeShort: {
      "read-only": "只能查看，不能改动",
      standard: "可以部署和重启，危险操作先问你",
    } satisfies Record<Mode, string>,
    modeMenuLabel: (alias: string) => `${alias} 的档位`,
    prodConfirm: (alias: string) => `${alias} 是生产环境。切到标准运维后，Agent 可以部署和重启。`,
    switch: "切换",
  },

  servers: {
    add: "添加资源",
    addServer: "添加服务器",
    addCli: "云平台",
    importSsh: "从 ssh config 导入",
    searchPlaceholder: "搜索资源",
    searchLabel: "搜索资源",
    groupServers: "服务器",
    groupClis: "云平台",
    noMatch: "没有匹配的资源",
    noServers: "还没有服务器",
    noClis: "还没有接入云平台",
    connectCli: "连接云平台 CLI",
    clearSearch: "清除搜索",
    loading: "正在加载资源",
    loadFailedTitle: "没能加载资源",
    rowOpen: (handle: string, name: string, state: string) =>
      `${handle}，${name}，${state}`,
    modeToggle: (handle: string, mode: string, next: string) =>
      `${handle} 当前是${mode}，点击切换为${next}`,
    prodWritable: "生产环境已开启写权限",
    agentsLabel: (alias: string) => `将 ${alias} 分发给哪些 Agent`,
    agentToggle: (alias: string, agent: string) =>
      `将 ${alias} 分发给 ${agent}`,
    noAgents: "没有启用的 Agent",
    edit: "编辑",
    editLabel: (handle: string) => `编辑 ${handle}`,
    editConnection: "编辑连接",
    moreLabel: (handle: string) => `${handle} 的更多操作`,
    notesBadge: (n: number) => `笔记 ${n}`,
    linkedTo: (aliases: string) => `关联 ${aliases}`,
    probingLabel: "探测中",
    osLabel: (os: string) => `系统：${os}`,
  },

  /** 云平台 CLI（F-104、6.5） */
  cli: {
    name: {
      cloudflare: "Cloudflare",
      vercel: "Vercel",
      oracle: "Oracle Cloud",
      github: "GitHub",
    } satisfies Record<CliProvider, string>,
    blurb: {
      cloudflare: "域名和 Worker",
      vercel: "前端和 Serverless 项目",
      oracle: "云主机和防火墙",
      github: "仓库，以及它们部署到哪里",
    } satisfies Record<CliProvider, string>,
    status: {
      ready: "已就绪",
      "not-installed": "未安装",
      "not-logged-in": "未登录",
      expired: "登录已过期",
    } satisfies Record<CliEnvStatus, string>,
    checking: "检测中",
    unchecked: "尚未检测",
    fix: {
      "not-installed": "去安装",
      "not-logged-in": "去登录",
      expired: "去登录",
    } satisfies Record<Exclude<CliEnvStatus, "ready">, string>,
    /** 资源行：「WSL 未登录」 */
    envProblem: (env: string, status: string) => `${env} ${status}`,
    kind: {
      zone: "域名 (Zones)",
      worker: "Workers",
      pages: "Pages",
      project: "项目",
      instance: "计算实例",
      repo: "仓库",
    } satisfies Record<CliScopeKind, string>,
    kindCount: {
      zone: (n: number) => `${n} 个域名`,
      worker: (n: number) => `${n} 个 Worker`,
      pages: (n: number) => `${n} 个 Pages 项目`,
      project: (n: number) => `${n} 个项目`,
      instance: (n: number) => `${n} 台实例`,
      repo: (n: number) => `${n} 个仓库`,
    } satisfies Record<CliScopeKind, (n: number) => string>,
    scopeNone: "未选资源",
    versionAccount: (version: string, account?: string) =>
      account ? `${version} · ${account}` : version,
    envCheckTitle: "Agent 在这些运行环境里用它",
    envCheckLabel: "各运行环境的 CLI 状态",
    autoRefreshHint: "在终端完成操作后切回本窗口，将自动刷新状态。",
    noAgentEnvs:
      "还没有启用的 Agent，先到 Agent 页启用一个，这里才知道要检测哪个运行环境。",
    goAgents: "前往 Agent 页",
    openTerminal: "打开终端",
    switchAccount: "打开终端切换账号",
    terminalOpened: (env: string) => `已打开 ${env} 的终端，完成后切回本窗口`,
    recheck: "重新检测",
    refreshScope: "刷新资源范围",
    copyCommand: "复制命令",
    installGuide: "安装指引",
    installMethod: "安装方式",
    requires: { node: "需要先装好 Node.js", python: "需要先装好 Python 3" },
    commandCopied: "已复制命令",
    scopeTitle: "Agent 能看到哪些资源",
    scopeHint: "没勾选的，Agent 不知道它存在。勾选后立即生效。",
    selectAll: "全选",
    clearAll: "全不选",
    scopeLoading: "正在拉取账号下的资源…",
    scopeEmpty: "账号下没有可选的资源。",
    scopeWaiting: "至少一个运行环境就绪后，才能拉取账号下的资源。",
    scopeAllBound: "没有还没接入的账号。",
    linked: (alias: string) => `已关联服务器 ${alias}`,
    addAsServer: "同时加为 SSH 服务器",
    accountTitle: {
      cloudflare: "接入哪个账号",
      vercel: "接入哪个团队",
      oracle: "接入哪个 Profile",
      github: "接入哪个账号",
    } satisfies Record<CliProvider, string>,
    accountAdded: "已添加",
    allAccountsAdded: (login: string) =>
      `这次登录下的账号都已接入。要接入别的账号，先在终端运行 ${login} 换一个登录，再重新检测。`,
    pathLabel: "路径",
    accountLabel: "账号",
    versionLabel: "版本",
    loginHintOci: "使用长效的 ~/.oci/config，不用 1 小时过期的临时 session。",
    saveEnable: "保存并启用",
    saving: "正在保存",
    notReadyHint: "至少一个运行环境就绪后才能启用。",
    enabled: (name: string) => `已接入 ${name}`,
    delete: "移除云平台",
    deleteTitle: (name: string) => `移除 ${name}？`,
    deleteDescription:
      "它会从总 Skill 中移除。不会卸载本机的 CLI，也不会退出 CLI 的登录。",
    removed: (name: string) => `已移除 ${name}`,
    detectFailed: "检测失败，稍后再试。",
    nameHint: "写进总览表，默认是云平台的名称。",
  },

  /** 添加资源（PRD 6.5） */
  create: {
    title: "添加资源",
    titleSsh: "添加 SSH 服务器",
    titleCli: (name: string) => `添加 ${name}`,
    back: "返回选择类型",
    directGroup: "直连服务器",
    cliGroup: "云平台 CLI",
    groups: { servers: "服务器", clouds: "云平台", codeHosts: "代码托管" },
    sshPick: "填地址和密码，自动换成免密密钥",
    importPick: "从 ~/.ssh/config 导入",
    importPickBlurb: "把已有的主机接进来",
    importFound: (n: number) => `发现 ${n} 台`,
    importNone: "没有可导入的主机",
    pickBlurb: {
      cloudflare: "域名和 Worker",
      vercel: "前端和 Serverless 项目",
      oracle: "云主机和防火墙",
      github: "仓库，以及它们部署到哪里",
    } satisfies Record<CliProvider, string>,
    cliChecking: "正在检查…",
    cliReady: (binary: string) => `已登录 · ${binary}`,
    cliNotInstalled: (binary: string) => `未安装 ${binary}`,
    cliNotLoggedIn: "未登录",
    cliExpired: "登录已过期",
    ssh: "SSH 服务器",
    sshBlurb: "VPS 或云主机。填地址和认证方式，一步连接并启用",
    addedCount: (n: number) => `已接入 ${n} 个账号`,
    aliasLabel: "SSH 别名",
    aliasHint: "终端连接时使用。改名称或地址不会改变它，需要时再自定义。",
    aliasChangedHint: "修改别名后，已有命令和脚本也要相应调整。",
    defaultName: (n: number) => `服务器 ${n}`,
    nameFallback: (name: string) => `留空将使用“${name}”`,
    prodHint: "切到标准运维前会再确认一次",
    advancedHint: "SSH 别名、跳板机、在哪些运行环境里可用",
    footHint: "添加后先是只读巡检，并同步给全部 Agent",
    connectEnable: "连接并启用",
    working: "正在添加…",
    saveOnly: "仅保存（暂不启用）",
    passwordHint: "只用这一次。连接后换成免密密钥，密码不会保存。",
    keyHint: "WSL 里的 Agent 也要用它时，添加后可以一键复制过去。",
    /** 添加成功的提示条。名称以英文或数字结尾时后面留一个空格 */
    added: (name: string, dirs: number) =>
      dirs > 0 ? `${spaced(name)}已添加，并同步给 ${dirs} 个目录` : `${spaced(name)}已添加`,
    addedNoSshConfig: (name: string) => `${spaced(name)}已添加。加入 SSH 配置后才会同步给 Agent`,
    keepPassword: (alias: string) =>
      `${alias} 没能改用密钥登录，已保留密码。Agent 无法输入密码，这台服务器暂时不能同步。`,
  },

  /** 首次启动（PRD 6.8） */
  onboarding: {
    title: "添加第一台服务器",
    lead: "添加之后，就可以直接对 Agent 说：",
    example: "看看服务器的磁盘还剩多少",
    addSsh: "添加服务器",
    importSsh: (n: number) => `从 ~/.ssh/config 导入 · ${n} 台`,
    /** 最多写出 3 个名字，其余合成「等 N 个 Agent」，免得一行折成三行 */
    detected: (names: string[]) =>
      names.length > 3
        ? `检测到 ${names.slice(0, 3).join("、")} 等 ${names.length} 个 Agent，添加后会自动同步给它们`
        : `检测到 ${names.join("、")}，添加后会自动同步给它们`,
    noAgents: "没有检测到 Agent，可以在 Agent 页添加自定义目录",
  },

  /** 右侧检视面板（PRD 6.4） */
  detail: {
    notesPending: (n: number) => `${n} 条 Agent 笔记等你确认`,
    back: "资源",
    test: "测试连接",
    probe: "重新探测",
    refreshProbe: "立即探测",
    cancelProbe: "取消探测",
    preview: "预览 Skill",
    revealCompiled: "在文件夹中显示编译目录",
    copyAlias: "复制别名",
    aliasCopied: (alias: string) => `已复制 ${alias}`,
    aliasCopyFailed: "复制未完成，请选中别名后手动复制。",
    delete: "删除服务器",
    probedAt: (rel: string) => `${rel}探测`,
    staleAt: (rel: string) => `已过期，${rel}探测`,
    probeFailed: "上次探测失败",
    neverProbed: "从未探测",
    cores: (n: number) => `${n}C`,
    memory: (gb: number) => `${gb}G`,
    savedCompiled: "已保存",
    compileBlocked: (n: number) =>
      `编译受阻：这项资源有 ${n} 个错误，总 Skill 没有发布`,
    compileBlockedOther: (targets: string) =>
      `编译受阻：${targets}的总 Skill 里有其他资源出错，没有发布`,
    compileWarnings: (n: number) => `有警告：${n} 条`,
    showLint: "在预览中查看",
    saveFailed: "保存失败",
    saved: "已保存",
    editProfile: "编辑资料",
    saveProfile: "保存修改",
    profileHint: "只更新资料，不改变连接和权限",
    summaryEmpty: "还没有填写用途",
    notesEmpty: "还没有笔记",
    editor: {
      basic: "基本信息",
      otherInfoHint: "标签、云厂商与地域",
      rulesNotes: "红线与笔记",
      inventoryHint: "这里只修改资料，不会创建、停止或删除远端服务。探测到的名称、镜像和端口不在这里改。",
      inventorySummary: (services: number, paths: number) => `${services} 个服务记录 · ${paths} 个目录`,
      close: "关闭编辑",
      leave: "修改尚未保存，是否放弃？",
      failed: "修改未保存，输入仍保留在这里，请重试。",
      saving: "正在保存…",
      connectionHint: "连接改动后需要重新验证",
    },
    rename: {
      label: (name: string) => `重命名 ${name}`,
      input: "资源名称",
      hint: "点击重命名",
      empty: "名称不能为空。填好后按回车，或按 Esc 取消。",
      failed: "名称未保存。按回车重试，或按 Esc 取消。",
      saved: "名称已更新",
    },
    groups: {
      permission: "Agent 权限",
      connection: "连接",
      account: "账号",
      repos: "仓库",
      envs: "运行环境",
      knowledge: "Agent 需要知道的",
      probed: "服务与目录",
      guardrails: "红线",
      activity: "最近动态",
      services: "服务",
      paths: "关键目录",
      other: "其他信息",
      notes: "Agent 笔记",
      operations: "操作记录",
      advanced: "高级",
    },
    rows: {
      production: "生产环境",
      productionHint: "默认只读巡检；切到标准运维要确认",
      mode: "档位",
      agents: "给哪些 Agent",
      agentsSynced: (n: number) => (n ? `${n} 个目录已同步` : "还没有同步给任何 Agent"),
      address: "地址",
      auth: "登录方式",
      jump: "跳板机",
      definedIn: "写入的运行环境",
      name: "名称",
      nameHint: "列表和 Skill 里显示的名字",
      account: "当前账号",
      scope: "开放范围",
      scopeHint: "Agent 只会看到这些域名和项目",
      scopeAll: "全部",
      scopeEdit: "选择开放范围",
      reposHint: "Agent 只会看到这些仓库",
      repoBranch: "默认分支",
      visibility: { public: "公开", private: "私有", internal: "内部" },
      reposEmpty: "还没有开放任何仓库",
      notes: "笔记",
      notesHint: "你并入的 Agent 笔记会出现在这里，也可以直接编辑",
    },
    authMethod: { password: "密码", key: "私钥", agent: "ssh-agent" },
    /** 折叠行（PRD 6.4）：默认收起，副行写摘要 */
    more: "更多信息",
    moreEmpty: "标签、云厂商、地域、笔记",
    hasNotes: "有笔记",
    probedRow: "探测结果",
    probedSummary: (services: number, critical: number, paths: number, ports: number) =>
      [
        services ? `${services} 个服务${critical ? `（${critical} 个关键）` : ""}` : "还没有服务",
        paths ? `${paths} 个关键目录` : null,
        ports ? `${ports} 个监听端口` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    edit: "编辑",
    editConnection: "编辑连接",
    editConnectionHint: "保存后 Agent 就按新的信息连接。改了地址、端口、用户或登录方式，需要重新测试连接。",
    saveConnection: "保存连接",
    /** 导入的服务器：连接信息在用户自己的 ssh config 里，这里只能选让 Agent 知道哪些 */
    editExport: "让 Agent 知道哪些信息",
    editExportHint: "连接由你自己的 SSH 配置维护，这里只选择写给 Agent 的内容，不改动连接。",
    saveExport: "保存",
    honest: "红线写给 Agent 看。Claude Code 上护栏会强制拦截，能防手滑，防不了刻意绕过。",
    addRule: "添加",
    viewAll: "查看全部",
    activityEmpty: "还没有动态",
    recheck: "重新检测",
    saveBar: {
      unsaved: "未保存的修改",
      discard: "放弃",
      save: "保存",
      saving: "正在保存",
    },
    leave: {
      title: "放弃未保存的修改？",
      description: "离开后，还没保存的修改会丢失。",
      discard: "放弃修改",
      keep: "继续编辑",
    },
  },

  /** 检视面板控制头的档位和授权（PRD 6.4） */
  agentSection: {
    distribute: "授权",
    mode: "档位",
    noTargets: "还没有启用的 Agent",
    goAgents: "前往 Agent 页",
    agentKeyWarning:
      "Claude Code 在 Windows 上使用 Git Bash 的 ssh，读不到 Windows ssh-agent 服务里的密钥。请在 ssh config 中用 IdentityFile 指向它能直接读取的密钥，或者在 Git Bash 中加载 agent。",
    distributed: (alias: string, agent: string) =>
      `已把 ${alias} 分发给 ${agent}`,
    undistributed: (alias: string, agent: string) =>
      `${alias} 已停止分发给 ${agent}`,
    effectHint:
      "Claude Code 会自动加载变化；如果这次在会话运行中新建了 ~/.claude/skills，请在会话中执行 /reload-skills，已调用过的 Skill 要开新会话。Codex 没有生效时请重启。",
    modeChanged: (alias: string, mode: string) =>
      `${alias} 已切换为「${mode}」`,
  },
  deliveryFeedback: {
    partial: (name: string, n: number) => n ? `${name} 的选择已保存，${n} 个目录已同步，其余尚未完成` : `${name} 的选择已保存，但还没有同步成功`,
    withdrawPartial: (name: string) => `${name} 的选择已关闭，部分目录尚未完成撤回`,
    shared: (names: string[], name: string, on: boolean) => `${names.join(" 与 ")} 共用同一目录，${name}${on ? "已一起提供" : "已一起撤回"}`,
    sharedHint: (names: string[]) => `${names.join("、")} 共用同一目录，资源开关一起生效`,
    mismatchWith: (names: string[]) => `与 ${names.join("、")} 共用同一目录，资源选择不一致`,
    envReason: (env: string, reason: string) => `${env}：${reason}`,
    addedPartial: (name: string, n: number) => `${name} 已添加，${n ? `${n} 个目录已同步，其余尚未完成` : "但还没有同步成功"}`,
    joinedPartial: (name: string, n: number) => `已加入 SSH 配置，${name}${n ? `有 ${n} 个目录已同步，其余尚未完成` : "尚未同步成功"}`,
    targetProblem: (target: string, env: string, reason: string) => `${target}（${env}）：${reason}`,
    none: "没有已启用的同步目标，请到 Agent 页启用一个目录。",
    reasons: {
      conflict: "目录里已有同名 Skill，请到 Agent 页备份并接管",
      broken: "目录暂时无法写入，请检查目录及访问权限",
      pending: "尚未完成同步，请稍后检查 Agent 页",
      missing: "尚未写入 Skill，请检查 Agent 页",
      modified: "副本里的改动还未处理，请检查 Agent 页",
      outdated: "还没有更新到最新内容，请检查 Agent 页",
      "path-invalid": "目录位置不可用，请检查是否与数据或 SSH 目录重叠",
      "path-loop": "目录链接形成循环，请修正链接后重新检测",
      "path-unavailable": "目录链接目标不存在或无法访问，请检查链接与权限",
      "path-unsupported": "这个跨环境目录位置暂不支持，请改用该环境自己的目录",
      "sync-failed": "写入失败，请检查目录权限后重新检测",
      "withdraw-failed": "尚未完成撤回，请检查目录权限后重新检测",
      "shared-selection-mismatch": "共用目录的资源选择不一致，已按共同选择提供；开关一次可对齐",
      "shared-windows": "与 Windows 共用目录，未单独提供",
      "shared-agent": "目录仍由共用的其他 Agent 使用",
      "shared-directory": "与其他 Agent 共用同一目录",
      "compile-blocked": "内容检查未通过，请打开 Skill 预览查看原因",
      "not-included": "资源尚未提供给这个环境，请检查详情中的问题",
    } as Record<string, string>,
  },
  modeConfirm: {
    title: (alias: string) => `把 ${alias} 切换为标准运维？`,
    description:
      "所有已启用的 Agent 都会获得变更权限的指令，护栏只会拦下明显危险的命令。切换后资源行会一直以琥珀色提醒，干完活记得切回只读巡检。",
    confirm: "切换为标准运维",
  },

  /** 详情笔记分段（F-308） */
  notes: {
    pendingTitle: "待处理的 Agent 笔记",
    mergeAll: "全部并入",
    mergeAllSkipped: (n: number) => `另有 ${n} 条需要编辑后才能并入`,
    merge: "并入",
    editMerge: "编辑后并入",
    dismiss: "忽略",
    editLabel: "编辑笔记",
    confirmEdit: "并入",
    cancelEdit: "取消",
    flag: { secret: "疑似包含密钥", injection: "疑似注入" } satisfies Record<
      AgentNoteFlag,
      string
    >,
    secretHint: "命中密钥扫描，编辑删掉密钥后才能并入。",
    injectionHint: "里面像是写给 Agent 的指令，确认内容可信再并入。",
    dirtyHint: "详情有未保存的修改，先保存或放弃，再处理笔记。",
    field: "笔记",
    fieldHint: "并入后 Agent 下次就能读到。不要写密码、IP 和临时状态。",
    merged: (n: number) => `已并入 ${n} 条笔记`,
    dismissed: (n: number) => `已忽略 ${n} 条笔记`,
    none: "没有待处理的 Agent 笔记。Agent 摸清的部署方式和踩过的坑会出现在这里，你确认后才并入。",
  },

  /** 详情操作记录分段（F-307） */
  operations: {
    viewAll: "在活动中查看全部",
    onlyGuarded: "只记录经过护栏的命令（Claude Code）",
    empty: "还没有记录。只记录经过护栏的命令",
    expand: "展开命令",
    session: (id: string) => `会话 ${id}`,
    /** 展开后的最后一行：完整时间 · 运行环境 · 会话 */
    meta: (at: string, env: string, session: string) => `${at} · ${env} · 会话 ${session}`,
    listLabel: "最近的操作记录",
  },

  /** 详情连接分段、新建表单的连接字段（PRD 6.4、6.5） */
  connection: {
    edit: "编辑",
    doneEdit: "收起编辑",
    managedSummary: (target: string, auth: string) => `${target} · ${auth}`,
    writtenTo: (envs: string) => `写入 ${envs}`,
    importedNote: "连接信息由你的 ssh config 维护",
    importedFrom: (envs: string) => `来源环境：${envs}`,
    lockedField: "只读，不可编辑",
    resolvedNone:
      "还没有解析结果。下次探测时，CloudLink 会用 ssh -G 读取这个别名的生效配置。",
    resolvedAt: (rel: string) => `解析于${rel}`,
    advanced: "高级",
    advancedSummary: (alias: string) =>
      `别名 ${alias || "（未填写）"} · 跳板机 · 运行环境`,
    exportTitle: "让 Agent 知道哪些连接信息",
    exportResolved: "告诉 Agent 地址、用户和端口",
    exportResolvedHint: "默认不告诉。Agent 用别名就能连接，一般不需要知道这些。",
    exportListening: "告诉 Agent 监听端口",
    exportListeningHint: "默认不告诉。打开后，Agent 能看到这台服务器在监听哪些地址和端口。",
    listening: "监听端口",
    listeningEmpty: "还没有监听端口数据，探测后显示。",
    passwordSaved: "密码已保存在系统凭据库",
    deletePassword: "删除保存的密码",
    passwordDeleted: "已删除保存的密码",
    mismatchTitle: "ssh 生效的配置和录入的不一致",
    mismatch: (fields: string) =>
      `ssh -G 读到的 ${fields} 和这里录入的不同，可能被 ~/.ssh/config 里更靠前的规则覆盖了。到设置的「SSH 配置」确认它已生效，或者调整那条规则。`,
  },

  serverForm: {
    name: "名称",
    host: "地址",
    hostPlaceholder: "IP 或域名",
    port: "端口",
    user: "用户",
    auth: "登录方式",
    key: "私钥",
    keyPick: "选择",
    keyPickLabel: (env: string) => `为 ${env} 选择私钥文件`,
    keyLabel: (env: string) => `${env} 的私钥路径`,
    keyMntWarning: "这把私钥在 /mnt/ 下，权限过宽，ssh 会拒绝使用。",
    copyToWsl: "复制到 WSL",
    agentHint: "使用系统 ssh-agent 中已加载的密钥。",
    agentKeys: (env: string, n: number | null) =>
      n === null ? `${env}：ssh-agent 不可用` : `${env}：检测到 ${n} 把密钥`,
    password: "密码",
    passwordKeep: "已保存，留空则不修改",
    showPassword: "显示密码",
    hidePassword: "隐藏密码",
    passwordAlert:
      "Agent 无法输入密码。测试连接通过后，可以一键改用密钥登录，否则这台服务器不能分发。",
    env: "环境",
    alias: "别名",
    aliasHint:
      "Agent 用 ssh <别名> 连接。只能有字母、数字、点、下划线和连字符。",
    proxyJump: "跳板机",
    proxyJumpHint: "要先经过另一台服务器才能连上时选它。",
    proxyJumpPlaceholder: "选择或输入别名",
    envs: "在哪些运行环境里可用",
    envsHint: "Agent 在勾选的运行环境里才能用别名连上这台服务器。",
    cancel: "取消",
    undo: "撤销",
    save: "保存",
    saveAndProbe: "保存并探测",
    saving: "正在保存",
    unverifiedTitle: "连接还没有通过验证",
    unverifiedDescription:
      "连接未验证，保存后不能分发。服务器暂时关机时可以先保存，之后再测试连接。",
    unverifiedConfirm: "仍然保存",
    created: (alias: string) => `已保存 ${alias}`,
  },

  test: {
    button: "测试连接",
    cancel: "取消",
    undo: "撤销",
    running: "正在连接…",
    ok: (ms: string, os?: string) =>
      os ? `已连接 · ${ms} · ${os}` : `已连接 · ${ms}`,
    cancelled: "已取消测试",
    stale: "连接参数已修改，请重新测试",
    convertKey: "改用密钥登录",
  },

  hostKey: {
    title: "首次连接，请核对主机指纹",
    description: (alias: string) =>
      `CloudLink 还不认识 ${alias} 的主机密钥。请到服务器控制台或用其他可信方式核对下面的指纹，一致后再信任。`,
    trust: "指纹一致，继续",
    changedTitle: (alias: string) => `${alias} 的主机密钥与已知记录不符`,
    changedDescription:
      "可能是重装了系统，也可能是中间人攻击。CloudLink 已阻断这次连接。核实之后，手动更新 known_hosts。",
    /** 在服务器上自己核对的命令 */
    verifyHint: "在服务器控制台运行下面的命令，输出里应该有同一串指纹：",
    verifyCommand: "ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub",
    changedFix: (alias: string) => `确认服务器重装过之后，在终端运行 ssh-keygen -R ${alias} 删除旧记录，再测试连接。`,
  },

  /** 添加服务器时的连接过程（PRD 6.5）：逐步显示，问题就地修复 */
  connect: {
    title: (alias: string) => `连接 ${alias}`,
    target: (user: string, host: string, port: number) =>
      port === 22 ? `${user}@${host}` : `${user}@${host}:${port}`,
    steps: {
      key: "检查私钥",
      reach: "连接服务器",
      hostKey: "核对主机指纹",
      login: (method: string) => `登录（${method}）`,
      include: "让 Agent 能用别名连接",
      convert: "安装免密密钥",
      sync: "同步给 Agent",
    },
    detail: {
      checking: "正在检查…",
      connecting: "正在连接…",
      reached: (ms: string) => `已连通 · ${ms}`,
      hostKeyWaiting: "等待你核对",
      hostKeyKnown: "已在 known_hosts 中",
      hostKeyTrusted: "已信任，写入 known_hosts",
      hostKeyAdopted: (name: string) => `沿用 known_hosts 中 ${name} 的记录`,
      hostKeyTrusting: "已信任，正在登录…",
      loggingIn: "正在登录…",
      loggedIn: (os?: string) => (os ? `已登录 · ${os}` : "已登录"),
      includeWaiting: "等你决定",
      includeAdding: "正在加入…",
      includeAdded: "已加入",
      includeDeclined: "暂不加入",
      saving: "正在保存…",
      converting: "正在生成并安装密钥…",
      syncing: (dirs: number) => (dirs ? `同步给 ${dirs} 个目录，后台探测服务` : "后台探测服务"),
      skipped: "未执行",
    },
    /** 读屏用的步骤状态 */
    state: {
      pending: "未开始",
      running: "进行中",
      done: "已完成",
      attention: "等待确认",
      failed: "失败",
      skipped: "未执行",
    },
    newKey: (host: string) => `第一次连接 ${host}，请核对服务器出示的指纹：`,
    cancelled: "已取消连接",
    back: "返回修改",
    retry: "重新连接",
    copyFingerprint: "复制指纹",
    copyToSsh: "复制到 ~/.ssh",
    copyToWsl: "复制到 WSL",
  },

  /** 私钥预检（F-108）：显示在私钥路径下面 */
  keyCheck: {
    ok: (type: string, fp: string) => `${type} · ${fp}`,
    okPlain: "可以使用",
    missing: "找不到这个文件",
    permissionsWindows: "其他用户也能读取这把私钥，ssh 会拒绝使用。",
    permissionsWsl: "这把私钥权限过宽，ssh 会拒绝使用。",
    passphrase:
      "这把私钥设有密码短语，Agent 无法输入。先运行 ssh-add 把它加入 ssh-agent，再把认证方式改为 ssh-agent。",
    putty: "PuTTY 格式（.ppk）。用 PuTTYgen 导出为 OpenSSH 格式后再选择。",
    publicKey: "这是公钥。请选择同名但不带 .pub 的私钥文件。",
    invalid: "无法识别这个文件，请选择 OpenSSH 格式的私钥。",
    fix: "复制到 ~/.ssh",
  },

  /** 加入 SSH 配置（F-107 AC1）。Include 那一行只出现在「了解详情」里（PRD 6.13） */
  include: {
    title: "让 Agent 能用别名连接",
    ask: {
      lead: "要让 Agent 用",
      command: (alias: string) => `ssh ${alias}`,
      tail: "连上，需要在你的 SSH 配置开头加一行。只问这一次。",
    },
    /** 连接编辑对话框里没有具体别名时的一句 */
    description: "要让 Agent 用别名连上，需要在你的 SSH 配置开头加一行。只问这一次。",
    more: "了解详情",
    detail: {
      lead: (envs: string) => `在 ${envs} 的 ~/.ssh/config 开头加入`,
      tail: "修改前会先备份，其余内容不动。",
    },
    add: "加入",
    skip: "暂不加入",
    added: (env: string) => `已加入，${env} 里的 Agent 现在可以连接了`,
    skipped: "没有加入 SSH 配置。资源行和设置的「SSH 配置」里可以随时加入。",
    /** 资源行：所有运行环境都没加入（PRD 6.3、6.5） */
    rowProblem: "Agent 还连不上",
    rowFix: "加入 SSH 配置",
    joined: (name: string, dirs: number) =>
      dirs > 0 ? `已加入 SSH 配置，${spaced(name)}已同步给 ${dirs} 个目录` : "已加入 SSH 配置",
  },

  convertKey: {
    running: "正在生成密钥并安装公钥…",
    done: (alias: string) => `${alias} 已改用密钥登录，测试连接通过`,
    deletePassword: "删除保存的密码",
    needSave: "改用密钥登录前会先保存这台服务器。",
  },

  copyKey: {
    title: "把私钥复制到 WSL？",
    description: (source: string, env: string) =>
      `CloudLink 会把 ${source} 复制到 ${env} 的 ~/.ssh/，设置 600 权限，并把这一行改为副本的路径。目标位置已有同名文件时加后缀，不覆盖。`,
    titleWindows: "把私钥复制到 ~/.ssh？",
    descriptionWindows: (source: string) =>
      `CloudLink 会把 ${source} 复制到 Windows 的 ~/.ssh/，副本只有你能读取，并把私钥路径改为副本。原文件不动；同名文件已存在时加后缀，不覆盖。删除这台服务器时可以一并删除副本。`,
    confirm: "复制",
    done: (path: string) => `已复制到 ${path}`,
    noSource: "先填写 Windows 的私钥路径。",
  },

  basic: {
    name: "名称",
    production: "生产环境",
    productionHint: "新建时默认只读巡检，切到标准运维前会再确认",
    env: "环境",
    summary: "用途",
    summaryHint: "一句话说明它是做什么的。Agent 靠这句话判断一个任务该找哪项资源。",
    chars: (n: number) => `${n} 字符`,
    tags: "标签",
    tagsPlaceholder: "输入后选择或新建",
    provider: "云厂商",
    region: "地域",
    servedHostnames: "承载的站点",
    servedHostnamesHint:
      "这台服务器上跑的网站域名，例如 api.example.com。你说「某个站点打不开」时，Agent 能据此找到这台服务器。",
    servedHostnamesPlaceholder: "输入域名后选择「使用」",
    servedHostnamesEmpty: "输入域名，例如 api.example.com；不要写 IP 地址",
    summaryLine: (parts: string[]) => parts.join(" · "),
    tagCount: (n: number) => `${n} 个标签`,
  },

  paths: {
    hint: "告诉 Agent 配置、数据和日志放在哪里，它就不用每次去翻。",
    label: "用途",
    path: "路径",
    add: "添加路径",
    fromTemplate: "从面板模板添加",
    templateHint: "按默认安装位置填写；装在别处时请改成实际路径。",
    added: "已添加",
    empty: "还没有路径。添加常用目录，或者从 1Panel、宝塔模板里选。",
    labelAria: (n: number) => `第 ${n} 条路径的用途`,
    pathAria: (n: number) => `第 ${n} 条路径`,
    dragAria: (n: number) => `拖动排序：第 ${n} 条路径`,
    removeAria: (n: number) => `删除第 ${n} 条路径`,
  },

  /** 面板模板的名称和各目录的用途（目录本身见 lib/panelTemplates.ts） */
  panelTemplate: { "1panel": "1Panel", bt: "宝塔" } satisfies Record<
    PanelTemplateId,
    string
  >,
  pathTemplates: {
    "1panel-openresty-conf": "OpenResty 站点配置目录",
    "1panel-sites": "网站根目录",
    "1panel-openresty-log": "OpenResty 日志目录",
    "1panel-apps": "应用安装目录",
    "1panel-compose": "Docker Compose 编排目录",
    "1panel-backup": "备份目录",
    "bt-nginx-vhost": "Nginx 站点配置目录",
    "bt-wwwroot": "网站根目录",
    "bt-wwwlogs": "网站日志目录",
    "bt-nginx-conf": "Nginx 主配置目录",
    "bt-mysql-data": "MySQL 数据目录",
    "bt-backup-site": "网站备份目录",
    "bt-backup-db": "数据库备份目录",
  } as Record<string, string>,

  services: {
    hint: "探测到的 Docker 容器和 systemd 服务。角色和「关键」由你标注，重新探测不会覆盖；标为关键的服务，护栏会拦下停止或删除它的命令。",
    columns: {
      name: "名称",
      image: "镜像",
      ports: "端口",
      role: "角色",
      critical: "关键",
      actions: "操作",
    },
    kind: { docker: "Docker", systemd: "systemd" },
    /** 名称下面的一行：类型；手动添加的再标一句（探测到的是常态，不写） */
    meta: (kind: string, manual: boolean) => (manual ? `${kind} · 手动添加` : kind),
    rolePlaceholder: "例如 反向代理",
    missing: "未发现",
    missingTip: "上次探测有，这次没发现。标注保留，不会自动删除。",
    sanitized: "已清洗",
    sanitizedTip:
      "名称里有不允许的字符，已替换，防止往 Agent 上下文里注入指令。",
    add: "手动添加",
    edit: "编辑",
    remove: "删除",
    removeRecord: (name: string, n: number) => `删除${name ? ` ${name} 的` : `第 ${n} 个`}服务记录`,
    rowActions: (name: string) => `${name} 的操作`,
    roleAria: (name: string) => `${name} 的角色`,
    criticalAria: (name: string) => `把 ${name} 标为关键服务`,
    empty:
      "还没有服务。探测会自动采集 Docker 容器和 systemd 服务，也可以手动添加。",
    exportImage: "导出镜像版本",
    exportImageHint: "关闭后，Agent 看不到镜像名和版本。",
  },

  serviceDialog: {
    addTitle: "手动添加服务",
    editTitle: "编辑服务",
    description: "手动添加的服务不会被探测覆盖；探测发现同名服务时会合并。",
    kind: "类型",
    name: "名称",
    image: "镜像",
    imageHint: "例如 nginx:1.27。systemd 服务不用填。",
    ports: "端口映射",
    portsHint: "例如 127.0.0.1:8080->8080, 80->80/udp，多个用逗号分隔。",
    role: "角色",
    critical: "关键服务",
    criticalHint: "护栏会拦下停止、删除或 kill 它的命令，红线里也会点名提醒 Agent。",
    submitAdd: "添加服务",
    submitEdit: "保存修改",
  },

  guardrails: {
    advisoryTitle: "红线是写给 Agent 的指令。",
    advisoryDescription:
      "Claude Code 上的护栏会拦下只读服务器上的写操作和明显危险的命令，能防手滑，防不了刻意绕过。需要硬隔离时，请为只读场景配置低权限 SSH 用户。",
    custom: "自定义红线",
    customHint: "在任何档位下都会写进详情文件，逐字输出，顺序与这里一致。",
    add: "添加红线",
    empty: "还没有自定义红线。",
    ruleAria: (n: number) => `第 ${n} 条红线`,
    dragAria: (n: number) => `拖动排序：第 ${n} 条红线`,
    removeAria: (n: number) => `删除第 ${n} 条红线`,
    builtin: (n: number) => `内置红线（${n} 条，始终注入，不可删除）`,
    /** PRD 5.5：编译产物中的英文原文 + 界面上的中文说明 */
    builtinRules: [
      {
        text: "Never read or print credential files (.env, *.pem, *.key, id_*, /etc/shadow, ~/.ssh/) and never use docker inspect to view environment variables.",
        note: "不读取、不输出凭据类文件，不用 docker inspect 查看环境变量",
      },
      {
        text: "Never ask for or record passwords, private keys or IP addresses; connect only through the SSH alias.",
        note: "不询问、不记录密码、私钥或 IP；连接只通过 SSH 别名进行",
      },
      {
        text: 'If a host does not match its details file, report the difference to the user instead of "fixing" the server to match the document.',
        note: "现场情况与文档不一致时，先向用户报告，不要自行「修正」服务器去迎合文档",
      },
      {
        text: "If CloudLink's guard blocks a command, report it to the user; never try to work around the block with scripts, encoding or other tools.",
        note: "命令被护栏拦下时告诉用户，不要设法绕过",
      },
    ],
  },

  /** 预览 Skill（PRD 6.4，F-204） */
  preview: {
    title: "预览 Skill",
    draftTitle: "草稿预览",
    draftNote: "保存后发布",
    publishedNote: "当前已发布的内容",
    files: "文件",
    targetLabel: "Agent 与运行环境",
    viewLabel: "预览方式",
    rendered: "渲染",
    source: "源码",
    loading: "正在编译预览",
    failed: "预览编译失败",
    budget: "上限占用",
    description: "description",
    body: "Skill 正文",
    chars: (n: number, max: number) => `${n}/${max} 字符`,
    lines: (n: number, max: number) => `${n}/${max} 行`,
    near: "接近上限",
    over: "已超过上限",
    lint: "检查结果",
    lintNone: "没有发现问题",
    lintLocate: (file: string, line: number) => `定位到 ${file} 第 ${line} 行`,
    compiledDir: "编译目录",
    copyPath: "复制路径",
    pathCopied: "已复制编译目录",
    notIncluded: (alias: string, target: string, reason: string) =>
      `${alias} 目前未列入 ${target}的总 Skill：${reason}。下面按已列入计算。`,
    noTargets: "还没有启用的 Agent，下面按 Claude Code（Windows）计算。",
    emptyTitle: "没有可预览的内容",
    emptyDescription:
      "还没有分发给这个 Agent 的资源。在资源列表的资源行上点亮它之后，这里显示编译出的总 Skill。",
  },

  /** 探测 Sheet（PRD 6.4 探测流程） */
  probeSheet: {
    title: "探测",
    description: "以只读方式采集系统信息、服务和监听端口，不会改动服务器。",
    /** 标题里状态词在前，别名单独用等宽字体 */
    stateTitle: {
      idle: "探测",
      running: "正在探测",
      ok: "探测完成",
      failed: "探测失败",
      cancelled: "已取消探测",
    },
    lastProbed: (rel: string, state: string) =>
      `上次探测于${rel}，结果：${state}。`,
    cancelled: "已取消探测",
    cancel: "取消探测",
    retry: "重新探测",
    duration: (d: string) => `用时 ${d}`,
    applied: (n: number) => `已更新 ${n} 处`,
    noChanges: "未发现变化，已更新探测时间",
    held: (n: number) => `待确认 ${n} 处：疑似指令注入，没有自动合并`,
    confirmed: (n: number) => `已合并 ${n} 处待确认项`,
    undone: "已撤销本次更新",
    kind: {
      added: "新增",
      changed: "变化",
      missing: "未发现",
    } satisfies Record<ProbeChangeKind, string>,
    field: {
      service: "服务",
      os: "系统",
      kernel: "内核",
      listeningPorts: "监听端口",
      facts: "系统信息",
    } satisfies Record<ProbeChange["field"], string>,
    missingNote: "保留标注，标记为「未发现」",
    compare: (label: string) => `前后对比：${label}`,
    selectHeld: (label: string) => `合并这项：${label}`,
    viewScript: "查看探测脚本",
    undo: "撤销本次更新",
    mergeSelected: (n: number) => (n ? `合并所选 ${n} 项` : "合并所选"),
    commands: "在终端执行",
    testNow: "测试连接",
    partialTitle: "部分信息没有采集到",
    idle: (alias: string) =>
      `还没有探测过 ${alias}。探测会以只读方式采集系统信息、服务和监听端口。`,
    start: "开始探测",
    scriptTitle: "探测脚本",
    scriptDescription:
      "通过 ssh <别名> 'sh -s' 执行。只读，不使用 sudo，不采集环境变量、文件内容和密钥。",
  },

  probeToast: {
    view: "查看",
    undo: "撤销",
    updated: (alias: string, n: number) => `探测了 ${alias}，更新了 ${n} 处`,
    updatedHeld: (alias: string, n: number, held: number) =>
      `探测了 ${alias}，更新了 ${n} 处，${held} 处待确认`,
    heldOnly: (alias: string, held: number) =>
      `探测了 ${alias}，${held} 处待确认`,
    noChanges: (alias: string) => `探测了 ${alias}，未发现变化`,
    failed: (alias: string) => `探测 ${alias} 失败`,
    startedAll: (n: number) => `已开始探测 ${n} 台服务器`,
    nothingToProbe: "没有可以探测的服务器",
    undone: (alias: string) => `已撤销 ${alias} 的本次探测更新`,
  },

  importDialog: {
    title: "从 ssh config 导入主机",
    scanned: "已扫描：",
    columns: {
      alias: "别名",
      hostname: "HostName",
      user: "User",
      port: "Port",
      envs: "来源环境",
      status: "状态",
    },
    selectAll: "全选",
    selectRow: (alias: string) => `选择 ${alias}`,
    statusNew: "新",
    statusImported: "已导入",
    skipped: (n: number, patterns: string) =>
      `已跳过 ${n} 个通配 Host（${patterns}）`,
    skippedCodeHosts: (hosts: string) => `已跳过 ${hosts}（代码托管，不是服务器）`,
    probeAfter: "导入后测试连接并探测",
    submit: (n: number) => (n ? `导入 ${n} 台` : "导入"),
    loading: "正在扫描 ssh config",
    loadFailed: "没能读取 ssh config",
    emptyTitle: "ssh config 里没有可以导入的主机",
    emptyDescription:
      "CloudLink 自己写的 Host 不会出现在这里。在 ~/.ssh/config 中添加 Host 后重新打开，或者新建服务器。",
    done: (n: number) => `已导入 ${n} 台服务器`,
  },

  deleteDialog: {
    title: (alias: string) => `删除服务器 ${alias}？`,
    description: "它会从总 Skill 中移除，已分发的副本随之更新。",
    managed:
      "同时删除托管 ssh 配置中的条目和凭据库中的密码。CloudLink 只删除自己创建的内容。",
    imported: "连接信息在你自己的 ssh config 里，CloudLink 不会改动它。",
    removeKey: "一并删除 CloudLink 生成或复制的密钥",
    removeKeyHint: (paths: string) => `将删除：${paths}`,
    submit: "删除服务器",
    deleted: (alias: string) => `已删除 ${alias}`,
  },

  /** 对话框防误关（PRD 6.10） */
  discardDialog: {
    title: "放弃这些更改？",
    description: "还没提交的内容会丢失。",
    discard: "放弃更改",
    keep: "继续编辑",
  },

  /** 可排序列表的屏幕阅读器播报（路径、红线、运维约定） */
  sortable: {
    instructions:
      "按空格拿起。拿起后用上下方向键移动，再按空格放下，按 Esc 取消。",
    pickup: (n: number, total: number) => `已拿起第 ${n} 项，共 ${total} 项。`,
    over: (n: number) => `移动到第 ${n} 项。`,
    drop: (n: number) => `已放到第 ${n} 项。`,
    cancel: "已取消移动。",
  },

  validation: {
    "name-required": "请填写名称",
    "host-required": "请填写地址",
    "host-format": "地址要写成 IP 或域名，不要带协议和路径",
    "port-format": "端口是 1 到 65535 之间的整数",
    "user-required": "请填写用户",
    "alias-required": "请填写别名",
    "alias-format": "别名只能有字母、数字、点、下划线和连字符",
    "alias-taken": "这个别名已被其他服务器使用",
    "alias-conflict": "所选运行环境的 ssh config 里已有同名 Host",
    "key-required": "至少为一个运行环境选择私钥",
    "password-required": "请填写密码",
    "envs-required": "至少选择一个运行环境",
    "rule-empty": "红线内容不能为空",
    "convention-empty": "约定内容不能为空",
    "relation-empty": "关系内容不能为空",
    "path-label-required": "请填写用途",
    "path-required": "请填写路径",
    "service-name-required": "请填写服务名称",
    "service-duplicate": "已经有同类型、同名称的服务",
    "ports-format": "格式不对，例如 127.0.0.1:8080->8080, 80->80/udp",
    "hostname-format": "站点要写成域名，例如 api.example.com 或 *.example.com",
    "hostname-ip": "这里填域名，不要写 IP 地址（IP 默认不导出）",
    "dir-required": "请选择目录",
    "body-line-limit": "请输入 20 到 500 之间的整数",
    "probe-timeout": "请输入 10 到 120 之间的整数",
  } satisfies Record<ValidationKey, string>,

  /** Agent 视图（PRD 6.6） */
  /** Agent 视图（PRD 6.6，v0.2）：一行一个分发目标，Skill 内容，运行环境 */
  agents: {
    intro: "CloudLink 把服务器和云平台写成一个 Skill，自动同步给下面这些 Agent。",
    preview: "预览 Skill",
    detected: "已检测到",
    groupActions: "Agent 目录的更多操作",
    addCustom: "添加自定义目录",
    rowActions: (label: string) => `${label} 的更多操作`,
    enable: (label: string) => `给 ${label} 同步`,
    synced: "已同步",
    syncing: "同步中",
    awaitingResources: "还没有可提供的资源",
    disabled: "已停用",
    resources: (n: number) => `${n} 项资源`,
    readers: (n: number) => `${n} 个 Agent 读取这里`,
    readersLabel: "读取这个目录的 Agent",
    readersTooltip: (label: string, names: string) => `${label}：${names} 读取`,
    readersNone: "Codex、Cursor、Gemini CLI 等大多数 Agent 读取这里",
    /** 开关保持打开表示「想同步」，接管之前副本并没有写进去 */
    conflict: "还没同步：目录里已有同名 Skill",
    takeOver: "备份并接管",
    takeOverLabel: (label: string) => `备份并接管 ${label} 目录里的同名 Skill`,
    takenOver: (label: string) => `已接管 ${label} 里的同名 Skill，原来的版本已备份`,
    syncFailed: "同步没有成功，下次检查时会重试",
    guardOn: "护栏已开启",
    guardOnTip: (n: number) => `今天拦截 ${n} 条`,
    guardBroken: "护栏未生效",
    guardReinstall: "重新安装",
    guardInstall: "开启护栏",
    guardNone: "无护栏",
    guardNoneTip: "这个 Agent 还没有护栏，靠红线约束",
    guardRules: "查看护栏规则",
    removeGuard: "移除护栏",
    reveal: "在文件夹中显示",
    revealLabel: (label: string) => `在文件夹中显示 ${label} 的目录`,
    removeCustom: "移除这个目录",
    others: (n: number) => `其余 ${n} 个未检测到`,
    duplicate: (name: string, dir: string) =>
      `${name} 已经能从「${dir}」读到 Skill，这里再放一份会让它看到两份。`,
    content: "Skill 内容",
    relations: "资源关系",
    relationsCount: (n: number) => `自动整理 ${n} 条`,
    conventions: "运维约定",
    conventionsCount: (n: number) => `${n} 条`,
    rules: "护栏规则",
    rulesCount: (n: number) => `拦截 ${n} 类危险操作`,
    rulesBuiltin: "内置",
    back: "Agent",
    backLabel: "返回 Agent",
    environments: "运行环境",
    redetect: "重新检测",
    redetected: "已重新检测运行环境与 Agent",
    envUnavailable: "没有检测到，或者没有启动",
    envEnable: (label: string) => `启用 ${label}`,
    loading: "正在加载 Agent",
    compileBlocked: (targets: string) => `Skill 有错误，${targets}没有更新`,
    compileWarnings: (n: number) => `Skill 有 ${n} 条警告`,
    showLint: "查看",
  },

  skillContent: {
    title: "写进 Skill 的内容",
    hint: "所有 Agent 读到的是同一份。改动在底部保存后生效。",
    relations: "资源关系",
    relationsHint: "CloudLink 根据跳板机、域名解析、云主机等自动整理，资源变了会跟着更新。不对的可以隐藏或改写。",
    addRelation: "补充一条",
    relationsEmpty:
      "还没有能自动整理的关系。服务器经跳板机连接，或在云平台里把域名关联到服务器之后，会出现在这里。",
    /** 自动关系的中文说明，等宽片段用反引号标出 */
    relation: {
      "proxy-jump": (p: Params) => `${codeOf(p, "from")} 经跳板机 ${codeOf(p, "via")} 连接`,
      "same-host": (p: Params) => `${codeList(p, "aliases")} 是同一台机器`,
      dns: (p: Params) =>
        `${codeOf(p, "zone")} 的解析在 ${codeOf(p, "provider")} 管理，指向 ${codeOf(p, "to")}` +
        (p?.sites ? `，承载 ${codeList(p, "sites")}` : ""),
      site: (p: Params) =>
        `${codeOf(p, "to")} 承载的 ${codeList(p, "sites")} 属于 ${codeOf(p, "provider")} 管理的域名 ${codeOf(p, "zone")}`,
      instance: (p: Params) =>
        `${codeOf(p, "to")} 是 ${codeOf(p, "provider")} 的云主机实例 ${codeOf(p, "instance")}`,
    } satisfies Record<RelationKind, Msg>,
    autoAria: (n: number) => `自动整理的第 ${n} 条关系`,
    englishLabel: "写进 Skill 的原文",
    rewrite: "改写",
    rewriteAria: (n: number) => `改写自动整理的第 ${n} 条关系`,
    hide: "隐藏",
    hideAria: (n: number) => `隐藏自动整理的第 ${n} 条关系`,
    restore: "恢复",
    hiddenCount: (n: number) => `已隐藏 ${n} 条`,
    hiddenListLabel: "已隐藏的关系",
    rewritten: "改写",
    added: "补充",
    noteAria: (n: number) => `补充的第 ${n} 条关系`,
    rewriteNoteAria: (n: number) => `改写的第 ${n} 条关系（写进 Skill 的英文原文）`,
    notePlaceholder: "用一句英文写，例如 The API containers on hk-edge use the database on sg-db.",
    removeNote: (n: number) => `删除补充的第 ${n} 条关系`,
    removeRewrite: (n: number) => `删除第 ${n} 条改写，恢复自动整理的那一条`,
    conventions: "运维约定",
    conventionsHint: "写给每个 Agent 的约定，在任何服务器上都要遵守，排在内置红线之后。",
    addConvention: "添加约定",
    conventionsEmpty: "还没有运维约定。",
    conventionPlaceholder: "例如 Deploy with docker compose in /opt/apps/<name>",
    conventionAria: (n: number) => `第 ${n} 条运维约定`,
    dragAria: (n: number) => `拖动排序：第 ${n} 条运维约定`,
    removeAria: (n: number) => `删除第 ${n} 条运维约定`,
    healthCheck: "巡检清单",
    healthCheckHint: "内置，只执行只读命令，都在护栏的只读白名单里。",
    viewHealthCheck: "查看",
    saved: "已保存",
  },

  guard: {
    title: "护栏（Claude Code）",
    rules: "查看规则",
    deniedToday: (n: number) => `今天拦下 ${n} 条`,
    install: "安装",
    remove: "移除",
    reinstall: "重新安装",
    noTarget: "还没有启用 Claude Code 目标，启用后可以在这里安装护栏。",
    installTitle: (env: string) => `为 ${env} 的 Claude Code 安装护栏？`,
    installDescription:
      "装上之后，Claude Code 每次执行命令前，CloudLink 都会先检查一遍，越界的直接拦下。只改 Claude Code 的一处设置，改之前会先备份，其余设置原样保留，以后可以随时移除。",
    entryLabel: "将要加入的内容",
    backupLabel: "备份位置",
    installConfirm: "安装护栏",
    installed: (env: string) => `已为 ${env} 的 Claude Code 安装护栏`,
    removeTitle: (env: string) => `移除 ${env} 的护栏？`,
    removeDescription:
      "只撤掉 CloudLink 加的那一处设置。移除后，只读巡检只剩写给 Agent 的约定，不再拦截。",
    removeConfirm: "移除护栏",
    removed: (env: string) => `已移除 ${env} 的护栏`,
    /** 护栏规则页（PRD 6.6）：先讲拦什么，再讲只读巡检时放行什么 */
    intro: "护栏装在 Claude Code 上，在命令执行前检查。其他 Agent 没有护栏，只靠红线约束。",
    standardTitle: "标准运维时拦下",
    alwaysTitle: "任何档位都拦下",
    categoryCount: (n: number) => `${n} 类`,
    readOnlyTitle: "只读巡检时",
    readOnlyRow: "只放行查看类命令，其余都拦下",
    readOnlySummary: (n: number, examples: string[]) =>
      examples.length ? `${n} 条，例如 ${examples.join("、")}` : `${n} 条`,
    allowGroup: { system: "系统", services: "服务与日志", docker: "Docker", cloud: "云平台" },
    readOnlyNote:
      "带输出重定向、tee、命令替换、sudo 或原地修改参数的不放行；docker exec 里的命令同样要在清单内。交互式登录、经标准输入执行脚本、sh -c 包装和文件传输都拦下。",
    honest: "护栏能防手滑，防不了刻意绕过。看不懂的命令：只读巡检时拦下，标准运维时放行，并在动态里标出来。",
    loading: "正在加载规则",
  },

  targets: {
    enabledToast: (label: string) => `已同步给 ${label}`,
    enabledEmpty: (label: string) => `已启用 ${label}，还没有可提供的资源`,
    enabledPartial: (label: string) => `已启用 ${label}，有目录尚未完成同步`,
    disabledToast: (label: string) => `已停止同步给 ${label}，已撤回 CloudLink 写的 Skill`,
    disabledShared: (label: string) => `已停止同步给 ${label}，共用目录仍由其他 Agent 使用`,
    disabledConflict: (label: string) => `已停止同步给 ${label}，目录里原有的同名 Skill 未改动`,
    disabledPartial: (label: string) => `已停止同步给 ${label}，部分目录尚未完成撤回`,
    disableSharedDescription: "CloudLink 会停止给这个 Agent 同步。共用目录仍有其他 Agent 在用时会保留 Skill；只有不再使用的目录才会撤回自己写的内容。随时可以重新打开。",
    disableTitle: (label: string) => `停止同步给 ${label}？`,
    disableDescription:
      "CloudLink 会从这个 Agent 那里撤回自己写的 Skill，目录里的其他内容不受影响。随时可以重新打开。",
    disableConfirm: "停止同步",
    removeCustom: "移除",
    removeTitle: (label: string) => `移除自定义目录 ${label}？`,
    removeDescription: "CloudLink 会撤回自己写的 Skill，并不再同步这个目录。目录里的其他内容不受影响。",
    removed: (label: string) => `已移除 ${label}`,
  },

  customTarget: {
    title: "添加自定义目录",
    description:
      "Codex、Cursor、Gemini CLI 等大多数 Agent 已经读取通用目录，Trae、Kiro、Continue 检测到后会自动加入。只有 CloudLink 不认识的 Agent 才需要在这里指定它的全局 skills 目录。",
    name: "名称",
    path: "目录",
    pick: "选择目录",
    env: "运行环境",
    submit: "添加目录",
    added: (label: string) => `已添加 ${label}`,
  },

  /** 设置视图（PRD 6.8）：外观 / 启动与托盘 / 数据 / 危险操作 + 底部折叠的「高级」 */
  settings: {
    groups: {
      appearance: "外观",
      startup: "启动与托盘",
      data: "数据",
      danger: "危险操作",
    },
    theme: "主题",
    themeOption: { system: "跟随系统", light: "浅色", dark: "深色" },
    navPosition: "导航位置",
    navOption: { top: "顶栏", side: "侧栏" },
    closeWindow: "关闭窗口时",
    closeOption: { tray: "留在托盘", quit: "退出" },
    closeHint: "留在托盘时，护栏和托盘里的档位切换照常可用。",
    launchAtLogin: "开机时启动",
    autoCheckUpdates: "自动下载更新",
    autoCheckUpdatesHint: "有新版本时在后台下载好，重启后生效",
    currentVersion: (version: string) => `当前 v${version.replace(/^v/, "")}`,
    /** SSH 配置：都生效时一行，否则每个没生效的运行环境一条问题行 */
    sshConfig: "SSH 配置",
    sshConfigOk: (envs: string[]) => (envs.length > 1 ? `${envs.join("、")} 都已生效` : `${envs[0] ?? ""} 已生效`),
    sshConfigOpen: "打开 SSH 配置所在的文件夹",
    sshConfigMissing: (env: string) => `SSH 配置在 ${env} 里还没生效`,
    sshConfigMissingHint: (env: string) => `Agent 在 ${env} 里还不能用别名连接服务器。`,
    sshManualShow: "想自己加？",
    sshManualHide: "收起",
    sshManual: (env: string) => `在 ${env} 的 ~/.ssh/config 开头加一行`,
    sshJoinLabel: (env: string) => `把 SSH 配置加入 ${env}`,
    open: "打开",
    backups: "备份",
    backupsHint: "覆盖或接管之前的版本都留了一份",
    backupsOpen: "打开备份文件夹",
    activityLog: "活动日志",
    activityLogHint: "测试连接、探测、同步、备份和更新的记录",
    activityLogOpen: "查看",
    activityLogOpenLabel: "查看活动日志",
    removeAll: "停止全部同步",
    removeAllHint: "从所有 Agent 那里撤回 CloudLink 写的 Skill。资源和设置都保留，随时可以重新打开",
    removeAllButton: "停止同步",
    removeAllConfirm: "停止同步",
    removeAllDone: "已停止全部同步",
    reset: "重置 CloudLink",
    resetHint:
      "删除全部资源、保存的密码、护栏、笔记和记录，回到刚安装的样子。服务器本身和你自己的文件不受影响",
    /** 确认对话框里保留完整清单 */
    resetDataHint:
      "删除全部资源、CloudLink 写的 SSH 配置、凭据库中的密码、Claude Code 上的护栏、笔记收件箱、操作记录和活动日志，并恢复默认设置。服务器本身和你自己的文件不受影响。",
    resetPhrase: "重置",
    resetDone: "已重置 CloudLink",
    typeToConfirm: (text: string) => `输入「${text}」确认`,
    advanced: "高级",
    advancedHint: "探测、Skill 篇幅、数据目录",
    probeTimeout: "探测最长等多久",
    probeTimeoutHint: "超过这个时间还没结果，就算探测失败",
    probeScript: "探测脚本",
    probeScriptHint: "探测只读取信息，不会改动服务器",
    bodyLineLimit: "Skill 太长时提醒",
    bodyLineLimitHint: "写给 Agent 的内容超过这个长度，会提醒你精简",
    snapshot: "告诉 Agent 信息的采集时间",
    snapshotHint: "Agent 能判断服务器信息是不是过时了",
    dataDir: "数据目录",
    dataDirOpen: "打开数据目录",
    unitSeconds: "秒",
    unitLines: "行",
    saved: "设置已保存",
    loading: "正在加载设置",
  },

  /** 自动同步的备份与撤销（F-309） */
  allReadOnly: {
    done: (n: number) => `${n} 项生产资源已切回只读`,
    none: "没有处于标准运维的生产资源",
  },

  backups: {
    restored: (label: string) => `${label} 里的 Skill 被改动过，已恢复；改动的版本已备份`,
    takenOver: (label: string) => `已接管 ${label} 里的同名 Skill，原来的版本已备份`,
    undone: (label: string) => `已撤销，${label} 暂停自动同步，重新打开开关后恢复`,
  },

  /** 托盘菜单与系统通知（F-407）。{n} 由 Rust 替换 */
  tray: {
    tooltip: "CloudLink",
    guardOn: "● 护栏运行中",
    guardOff: "○ 护栏未开启",
    modesHeader: "档位",
    readOnly: "只读巡检",
    standard: "标准运维",
    allReadOnly: "生产资源全部切回只读",
    prodInStandard: "{n} 项在标准运维",
    open: "打开 CloudLink",
    quit: "退出",
    notifyTitle: "CloudLink",
    notifyAllReadOnly: "{n} 项生产资源已切回只读",
  } satisfies TrayCopy,

  activityKind: {
    connection: "测试连接",
    probe: "探测",
    compile: "更新 Skill",
    deliver: "同步",
    remove: "停止同步",
    repair: "修复",
    "ssh-config": "SSH 配置",
    guard: "护栏",
    mode: "档位",
    cli: "云平台",
    note: "笔记",
    "agent-op": "Agent 操作",
    update: "应用更新",
  } satisfies Record<ActivityKind, string>,

  /** 活动标题写成完整的句子（6.7）。反引号里的命令按等宽渲染 */
  activity: {
    "test-ok": (p) => `测试了 ${v(p, "alias")} 的连接，耗时 ${v(p, "ms")}ms`,
    "test-failed": (p) => `测试 ${v(p, "alias")} 的连接失败：${sshTitle(p)}`,
    "probe-updated": (p) =>
      `探测了 ${v(p, "alias")}，更新了 ${v(p, "count")} 处`,
    "probe-held": (p) =>
      `探测了 ${v(p, "alias")}，更新了 ${v(p, "count")} 处，${v(p, "held")} 处待确认`,
    "probe-no-changes": (p) => `探测了 ${v(p, "alias")}，未发现变化`,
    "probe-failed": (p) => `探测 ${v(p, "alias")} 失败：${sshTitle(p)}`,
    "probe-undone": (p) => `撤销了 ${v(p, "alias")} 的探测更新`,
    "compile-ok": (p) =>
      `更新了 ${targetOf(p)}的 Skill（${v(p, "count")} 项资源）`,
    "compile-blocked": (p) =>
      `${targetOf(p)}的 Skill 没有更新：${v(p, "count")} 个错误`,
    "deliver-ok": (p) => `把 Skill 同步到 ${v(p, "target")}（${envOf(p)}）`,
    "remove-ok": (p) =>
      `停止同步给 ${v(p, "target")}（${envOf(p)}），撤回了 CloudLink 写的 Skill`,
    "repair-ok": (p) => `修复了 ${v(p, "target")}（${envOf(p)}）里的 Skill`,
    "copy-restored": (p) =>
      `${v(p, "target")}（${envOf(p)}）里的 Skill 被改动过，已备份并恢复`,
    "copy-taken-over": (p) =>
      `接管了 ${v(p, "target")}（${envOf(p)}）里的同名 Skill，原来的版本已备份`,
    "backup-undone": (p) =>
      `把备份写回 ${v(p, "target")}（${envOf(p)}），暂停这个目录的自动同步`,
    "ssh-config-written": (p) =>
      `更新了 ${envOf(p)} 的 SSH 配置（${v(p, "count")} 台服务器）`,
    "ssh-include-added": (p) =>
      `把 SSH 配置加入了 ${envOf(p)}`,
    "guard-installed": (p) => `为 ${envOf(p)} 的 Claude Code 安装了护栏`,
    "guard-removed": (p) => `移除了 ${envOf(p)} 的护栏`,
    "mode-changed": (p) =>
      `把 ${v(p, "alias")} 切换为「${MODE_LABEL[v(p, "mode") as Mode] ?? v(p, "mode")}」`,
    "cli-detected": (p) =>
      `检测了 ${v(p, "alias")} 的 CLI：${v(p, "ready")}/${v(p, "total")} 个运行环境已就绪`,
    "cli-scope-updated": (p) =>
      `更新了 ${v(p, "alias")} 的资源范围（已选 ${v(p, "count")} 项）`,
    "notes-merged": (p) =>
      `并入了 ${v(p, "alias")} 的 ${v(p, "count")} 条 Agent 笔记`,
    "notes-dismissed": (p) =>
      `忽略了 ${v(p, "alias")} 的 ${v(p, "count")} 条 Agent 笔记`,
    "agent-op-allowed": (p) =>
      `Agent 在 ${v(p, "alias")} 上执行了 \`${v(p, "command")}\``,
    "agent-op-denied": (p) =>
      `Agent 在 ${v(p, "alias")} 上执行的 \`${v(p, "command")}\` 被护栏拦下`,
    "update-installing": (p) =>
      `开始把 CloudLink 从 ${v(p, "from")} 更新到 ${v(p, "to")}`,
  } satisfies Record<ActivityMessageId, Msg>,

  /** 动态视图（PRD 6.7，v0.2）：等你确认、操作记录 */
  feed: {
    asks: "等你确认",
    asksMore: (n: number) => `还有 ${n} 条`,
    asksCollapse: "收起",
    noteAsk: (alias: string) => `Agent 记下了一条关于 ${alias} 的笔记`,
    merge: "并入资源",
    dismiss: "忽略",
    edit: "编辑",
    needsEdit: "需编辑",
    secretHint: "里面像是有密钥，删掉以后才能并入。",
    injectionHint: "里面像是写给 Agent 的指令，不能并入，只能忽略。",
    editLabel: "编辑笔记",
    cancelEdit: "取消",
    merged: (alias: string) => `已并入 ${alias}`,
    dismissed: "已忽略这条笔记",
    log: "操作记录",
    filter: { all: "全部", denied: "已拦截", allowed: "已执行" },
    filterLabel: "按结果筛选",
    assetFilter: "按资源筛选",
    allAssets: "全部资源",
    allowed: "已执行",
    denied: "已拦截",
    unparsed: "未能解析，已放行",
    reasonShort: (id: GuardReasonId) =>
      ({
        "read-only": "只读档",
        "cli-write": "只读档",
        "file-transfer": "只读档",
        interactive: "只读档",
        "credential-read": "读取凭据",
        "cli-env-export": "导出凭据",
        "cli-account": "账号不符",
        "cli-scope": "超出范围",
        unparsed: "无法确认",
      })[id as string] ?? "危险操作",
    copyCommand: "复制命令",
    empty: "还没有记录。Agent 通过 ssh 或云平台 CLI 执行命令后会出现在这里。",
    noMatch: "没有符合筛选条件的记录",
    clearFilter: "清除筛选",
    loadMore: "加载更多",
    loading: "正在加载操作记录",
    scopeNote: "目前只有 Claude Code 的命令会记录在这里。",
    deletedAsset: "已删除的资源",
  },

  activityView: {
    kindFilter: "按类型筛选",
    assetFilter: "按资源筛选",
    allKinds: "全部类型",
    allAssets: "全部资源",
    loadMore: "加载更多",
    loading: "正在加载活动",
    today: "今天",
    yesterday: "昨天",
    emptyTitle: "还没有活动记录",
    emptyDescription: "测试连接、探测、同步、档位切换、备份和更新的记录会按天出现在这里。",
    noMatch: "没有符合筛选条件的记录",
    clearFilter: "清除筛选",
    failed: "失败",
    /** 底部说明：「这里只记 CloudLink 自己做的事。Agent 执行了什么命令，在[动态]里看。」 */
    footLead: "这里只记 CloudLink 自己做的事。Agent 执行了什么命令，在",
    footTail: "里看。",
  },

  /** 检测更新（F-406，PRD 6.15）。在后台下好才出现，提醒用中性色；按钮只写「更新」，版本号在读屏名称、悬停提示和对话框里 */
  update: {
    reminder: "更新",
    reminderLabel: (version: string) => `有新版本 ${version}，查看并更新`,
    failedLabel: (version: string) => `${version} 下载失败，查看详情`,
    installingLabel: "正在安装更新",
    announce: (version: string) => `有新版本 ${version}`,
    command: (version: string) => `重启以更新到 ${version}`,
    title: (version: string) => `新版本 ${version}`,
    description: (current: string, date: string | null) =>
      date ? `当前版本 ${current} · 发布于 ${date}` : `当前版本 ${current}`,
    noNotes: "这个版本没有附带更新说明。",
    restartHint:
      "安装时 CloudLink 会自动关闭并重新打开；护栏和已分发的 Skill 照常工作。",
    later: "稍后",
    install: "重启以更新",
    installing: "正在安装",
    retry: "重试",
    progress: (downloaded: string, total: string | null) =>
      total ? `已下载 ${downloaded} / ${total}` : `已下载 ${downloaded}`,
    downloadingHint: "正在后台下载，下好后就可以重启更新。",
    installingHint: "正在安装。CloudLink 即将关闭并重新打开。",
    /** 设置里「自动下载更新」下面的状态 */
    settingsDownloading: (version: string, percent: number | null) =>
      percent === null ? `正在下载 ${version}…` : `正在下载 ${version}… ${percent}%`,
    settingsReady: (version: string) => `${version} 已下载好，重启即可更新`,
    failed: "更新失败",
    wait: {
      connection: (name: string) => `正在测试 ${name} 的连接，结束后再安装`,
      probe: (name: string) => `正在探测 ${name}，结束后再安装`,
      cli: (name: string) => `正在检测 ${name} CLI，结束后再安装`,
      publish: () => "正在发布 Skill，结束后再安装",
    } satisfies Record<UpdateTask, (name: string) => string>,
  },

  toast: { undo: "撤销" },
}

/** 把 ipc 错误映射成一句可读的中文 */
export function ipcErrorText(id: IpcErrorId, params?: Params): string {
  return copy.ipcError[id](params)
}

/** 安装更新要等的任务（F-406 AC4）：界面自己判断的和后端 update-busy 返回的用同一句。CLI 的 name 是 provider */
export function updateWaitText(task: UpdateTask, name?: string): string {
  const shown =
    task === "cli"
      ? (copy.cli.name[name as CliProvider] ?? name ?? "…")
      : (name ?? "…")
  return (copy.update.wait[task] ?? copy.update.wait.publish)(shown)
}
