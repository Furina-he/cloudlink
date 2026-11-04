// 全部界面文案（PRD 6.11、9 国际化）。后端只返回 id 和参数，句子在这里拼
import type {
  ActivityKind,
  ActivityMessageId,
  AgentId,
  AgentNoteFlag,
  AuthMethod,
  CliProvider,
  CliScopeKind,
  DeliveryStatus,
  DistributeBlockReason,
  EnvId,
  EnvTag,
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
  SshErrorId,
} from "@/bindings"
import type { PanelTemplateId } from "@/lib/panelTemplates"
import type { ValidationKey } from "@/lib/schemas"
import type { CliEnvStatus, ConnState } from "@/stores/assets"
import type { DetailTab, SettingsSection } from "@/stores/ui"

type Params = Record<string, string | number> | undefined
type Msg = (p: Params) => string

/** 取参数，缺省时用占位，避免文案里出现 undefined */
const v = (p: Params, key: string) => String(p?.[key] ?? "…")

const MODE_LABEL: Record<Mode, string> = {
  "read-only": "只读巡检",
  standard: "标准运维",
}
const AGENT_LABEL: Record<AgentId, string> = {
  "claude-code": "Claude Code",
  universal: "Codex",
  custom: "自定义目录",
}
/** 回路行上 Agent 按钮的短名称；自定义目录用用户填的名称 */
const AGENT_SHORT: Record<Exclude<AgentId, "custom">, string> = {
  "claude-code": "Claude Code",
  universal: "Codex",
}
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
/** Lint 的主语：服务器的问题写别名，全局内容（关系、约定）的问题写「交给 Agent 的内容」 */
const subject = (p: Params) =>
  p?.alias ? `${p.alias} 的信息` : "交给 Agent 的内容"

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
      "点「测试连接」，核对指纹后信任。CloudLink 不会自动信任主机密钥。",
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
    hint: () =>
      "WSL 中把私钥放到 ~/.ssh/ 并设置 600 权限，可以用「复制到 WSL」。",
  },
  "key-not-found": {
    title: (p) => `找不到私钥文件 ${v(p, "path")}`,
    hint: () => "检查路径是否正确，或者重新选择私钥文件。",
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

/** 未列入的原因（F-303 AC2），参数里带 env */
const INCLUSION_REASON: Record<InclusionReasonId, Msg> = {
  "agent-off": () => "没有分发给这个 Agent",
  unverified: () => "还没有通过连接验证，请先测试连接",
  "env-unavailable": (p) => `${envOf(p)} 暂时不可用`,
  "password-only": () => "只用密码认证，Agent 无法输入密码",
  "not-defined": (p) => `${envOf(p)} 的 ssh config 里没有这个别名`,
  "not-written": (p) => `连接没有写入 ${envOf(p)}`,
  "include-missing": (p) =>
    `${envOf(p)} 的 ~/.ssh/config 还没有 Include 托管配置`,
  "no-key-in-env": (p) => `${envOf(p)} 中没有配置私钥`,
  "cli-not-installed": (p) => `${envOf(p)} 没有安装 ${v(p, "cli")}`,
  "cli-not-logged-in": (p) => `${envOf(p)} 的 ${v(p, "cli")} 还没有登录`,
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

export type ViewId = "servers" | "agents" | "settings"

export const copy = {
  app: { name: "CloudLink", skipToMain: "跳到主内容" },

  nav: { servers: "资源", agents: "Agent", settings: "设置" } satisfies Record<
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
      addCli: (name: string) => `添加云平台 CLI：${name}`,
      importSsh: "从 ssh config 导入",
      testCurrent: "测试当前服务器的连接",
      recheckCli: "重新检测当前云平台 CLI",
      probeCurrent: "探测当前服务器",
      probeAll: "探测全部",
      distributeTo: (agent: string) => `把当前资源分发给 ${agent}`,
      stopTo: (agent: string) => `当前资源停止分发给 ${agent}`,
      setMode: (mode: string) => `把当前资源切换为「${mode}」`,
      preview: "预览 Skill",
      checkAll: "检查全部分发",
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
    tag: { prod: "生产", staging: "预发", dev: "开发" } satisfies Record<
      EnvTag,
      string
    >,
    short: envShort,
    long: envLong,
  },

  agent: AGENT_LABEL,
  agentShort: AGENT_SHORT,
  /** 一份总 Skill 的名称：Agent（运行环境） */
  agentInEnv: (agent: string, env: string) => `${agent}（${env}）`,

  mode: MODE_LABEL,
  modeHint: {
    "read-only":
      "只允许巡检类命令，例如 docker ps、docker logs、df -h。需要改动时，Agent 先向你说明计划并停下。",
    standard:
      "允许常规部署和重启服务。删除数据、改防火墙或 SSH 配置、停止关键服务、重启主机前，必须先征得你同意。",
  } satisfies Record<Mode, string>,

  /** 回路行和详情的连接状态（6.11 状态词表）。changed 仍是「未验证」，另附一句提示（F-106 AC4） */
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
  inclusion: { included: "已列入", excluded: "未列入" },
  inclusionReason: INCLUSION_REASON,
  /** 未列入时的处理入口 */
  inclusionFix: {
    "password-only": "改用密钥登录",
    "not-written": "编辑连接",
    "include-missing": "加入 Include",
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
  } satisfies Record<DeliveryStatus, string>,
  deliveryOk: (n: number) => `已同步 ${n} 台`,
  deliveryNone: "还没有分发给它的资源",
  deliveryDetail: {
    pending: "正在写入副本。",
    ok: "",
    missing: "副本被外部程序删除了。点「修复」重新写入。",
    modified:
      "副本被改动过，内容和 CloudLink 的编译结果不一致。「修复」会覆盖这些改动。",
    outdated: "副本不是最新的编译结果，上次同步没有成功。点「修复」重新同步。",
    conflict:
      "目录里已有一个不是 CloudLink 创建的 cloudlink-servers，CloudLink 没有覆盖它。先手动处理，再点「检查」。",
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
    merge: "合并与编译",
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
      `${subject(p)}第 ${v(p, "line")} 行疑似包含密钥（${v(p, "rule")}），已阻断发布`,
    "export-disabled-field": (p) =>
      `已关闭导出的「${v(p, "field")}」出现在 ${v(p, "alias")} 的产物中，已阻断发布`,
    "missing-reference": (p) => `引用的 ${v(p, "path")} 不存在`,
    "body-too-long": (p) =>
      `SKILL.md 正文 ${v(p, "lines")} 行，超过上限 ${v(p, "limit")} 行`,
    "prod-standard-no-guardrails": (p) =>
      `${v(p, "alias")} 是生产资源，使用标准运维档，但没有自定义红线，建议补充`,
    "probe-stale": (p) =>
      `${v(p, "alias")} 的探测数据已有 ${v(p, "days")} 天，建议重新探测`,
    "suspected-injection": (p) =>
      `${subject(p)}里的「${v(p, "value")}」疑似包含指令，请核实`,
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
    "connection-failed": (p) => `${sshTitle(p)}。认证方式没有切换。`,
    "settings-invalid": (p) =>
      p?.path
        ? `${v(p, "path")} 不是合法的 JSON，CloudLink 没有修改它。修好后再试。`
        : "输入的内容或路径不符合要求，请检查后重试。",
    "interop-disabled": (p) =>
      `${envOf(p)} 的 WSL 互操作已关闭，请启用后重试。`,
    "target-exists": (p) =>
      p?.path
        ? `${v(p, "path")} 与已有目标冲突，或无法确认归属。`
        : "目标目录存在冲突，或无法确认归属。请检查后重试。",
    "source-missing": (p) =>
      p?.path
        ? `找不到 ${v(p, "path")}。`
        : "找不到可用的源文件或最新编译产物。",
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
    internal: (p) =>
      p?.message
        ? `内部错误：${v(p, "message")}。打开日志目录查看详情。`
        : "操作失败，请打开日志目录查看详情。",
  } satisfies Record<IpcErrorId, Msg>,

  common: {
    cancel: "取消",
    close: "关闭",
    clear: "清除",
    showOptions: "展开选项",
    remove: (value: string) => `移除 ${value}`,
    copy: "复制",
    copied: "已复制",
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
    } satisfies Record<CliProvider, string>,
    blurb: {
      cloudflare: "域名 DNS、Workers、Pages、D1",
      vercel: "前端项目部署、域名与运行日志",
      oracle: "云主机实例启停、防火墙安全列表与网络",
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
    /** 回路行：「WSL 未登录」 */
    envProblem: (env: string, status: string) => `${env} ${status}`,
    kind: {
      zone: "域名 (Zones)",
      worker: "Workers",
      pages: "Pages",
      project: "项目",
      instance: "计算实例",
    } satisfies Record<CliScopeKind, string>,
    kindCount: {
      zone: (n: number) => `${n} 个域名`,
      worker: (n: number) => `${n} 个 Worker`,
      pages: (n: number) => `${n} 个 Pages 项目`,
      project: (n: number) => `${n} 个项目`,
      instance: (n: number) => `${n} 台实例`,
    } satisfies Record<CliScopeKind, (n: number) => string>,
    scopeNone: "未选资源",
    versionAccount: (version: string, account?: string) =>
      account ? `${version} · ${account}` : version,
    envCheckTitle: "运行环境检查（仅检测已启用 Agent 的环境）",
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
    scopeTitle: "允许 Agent 操作的资源范围（未勾选的不公开）",
    scopeHint: "勾选立即生效，并重新编译。",
    selectAll: "全选",
    clearAll: "全不选",
    scopeLoading: "正在拉取账号下的资源…",
    scopeEmpty: "账号下没有可选的资源。",
    scopeWaiting: "至少一个运行环境就绪后，才能拉取账号下的资源。",
    linked: (alias: string) => `已关联服务器 ${alias}`,
    addAsServer: "同时加为 SSH 服务器",
    accountTitle: {
      cloudflare: "接入哪个账号",
      vercel: "接入哪个团队",
      oracle: "接入哪个 Profile",
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
    ssh: "SSH 服务器",
    sshBlurb: "VPS 或云主机。填地址和认证方式，一步连接并启用",
    addedCount: (n: number) => `已接入 ${n} 个账号`,
    aliasEcho: (alias: string) => `ssh ${alias}`,
    aliasEchoPrefix: "Agent 将通过",
    aliasEchoSuffix: "连接",
    aliasEmpty: "填写名称或地址后生成别名",
    grantAfter: "连接成功后授权给",
    grant: "授权给",
    defaultMode: "默认档位",
    prodStandardHint: "生产资源处于标准运维时，回路行会一直以琥珀色提醒。",
    connectEnable: "连接并启用",
    saveOnly: "仅保存（暂不启用）",
    passwordHint: "连接后自动配置免密密钥供 Agent 使用，不保留明文密码。",
    stage: {
      testing: "正在验证连接…",
      converting: "正在生成并安装免密密钥…",
      enabling: "已启用，正在后台探测服务…",
    },
    enabled: (alias: string) => `已启用 ${alias}，正在后台探测服务`,
    keepPassword: (alias: string) =>
      `${alias} 没能改用密钥登录，已保留密码。Agent 无法输入密码，这台服务器暂时不能分发。`,
  },

  /** 首次启动（PRD 6.8） */
  onboarding: {
    title: "还没有资源",
    description:
      "接入服务器（SSH）或云平台（CLI），CloudLink 会把它们编译成一个 Skill 交给本机的 Agent，并在 Claude Code 上用护栏守住档位。",
    addSsh: "添加 SSH 服务器",
    connectCli: "连接云平台 CLI（Cloudflare / Vercel / Oracle）",
    importSsh: "从 ssh config 导入",
  },

  /** 右侧检视面板（PRD 6.4） */
  detail: {
    back: "返回",
    test: "测试连接",
    probe: "重新探测",
    cancelProbe: "取消探测",
    preview: "预览 Skill",
    revealCompiled: "在文件夹中显示编译目录",
    copyAlias: "复制别名",
    aliasCopied: (alias: string) => `已复制 ${alias}`,
    delete: "删除服务器",
    probedAt: (rel: string) => `${rel}探测`,
    staleAt: (rel: string) => `已过期，${rel}探测`,
    probeFailed: "上次探测失败",
    neverProbed: "从未探测",
    cores: (n: number) => `${n}C`,
    memory: (gb: number) => `${gb}G`,
    savedCompiled: "已保存，已编译",
    compileBlocked: (n: number) =>
      `编译受阻：这项资源有 ${n} 个错误，总 Skill 没有发布`,
    compileBlockedOther: (targets: string) =>
      `编译受阻：${targets}的总 Skill 里有其他资源出错，没有发布`,
    compileWarnings: (n: number) => `有警告：${n} 条`,
    showLint: "在预览中查看",
    saveFailed: "保存失败",
    tabs: {
      profile: "画像与规则",
      connection: "连接配置",
      activity: "动态",
    } satisfies Record<DetailTab, string>,
    tabsLabel: "资源详情",
    activityCount: (n: number) => `动态 (${n})`,
    groups: {
      guardrails: "操作红线",
      services: "服务",
      paths: "关键目录",
      other: "其他信息",
      notes: "Agent 笔记",
      operations: "操作记录",
      advanced: "高级",
    },
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
      `${alias} 已切换为「${mode}」，已重新编译`,
  },
  modeConfirm: {
    title: (alias: string) => `把 ${alias} 切换为标准运维？`,
    description:
      "所有已启用的 Agent 都会获得变更权限的指令，护栏只会拦下明显危险的命令。切换后回路行会一直以琥珀色提醒，干完活记得切回只读巡检。",
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
    fieldHint: "写进这项资源详情文件的 Notes 一节。不要写密码、IP 和临时状态。",
    merged: (n: number) => `已并入 ${n} 条笔记，已重新编译`,
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
      `别名 ${alias || "（未填写）"} · 跳板机 · 写入的运行环境`,
    exportTitle: "导出到 Skill",
    exportResolved: "导出解析后的连接信息",
    exportResolvedHint:
      "默认不导出。打开后，地址、用户和端口会写进这台服务器的详情文件。",
    exportListening: "导出监听端口",
    exportListeningHint: "默认不导出。打开后，监听地址和端口会写进详情文件。",
    listening: "监听端口",
    listeningEmpty: "还没有监听端口数据，探测后显示。",
    passwordSaved: "密码已保存在系统凭据库",
    deletePassword: "删除保存的密码",
    passwordDeleted: "已删除保存的密码",
    mismatchTitle: "ssh 生效的配置和录入的不一致",
    mismatch: (fields: string) =>
      `ssh -G 读到的 ${fields} 和这里录入的不同，可能被 ~/.ssh/config 里更靠前的规则覆盖了。检查 Include 是否在 config 开头，或者调整那条规则。`,
  },

  serverForm: {
    name: "名称",
    host: "地址",
    hostPlaceholder: "IP 或域名",
    port: "端口",
    user: "用户",
    auth: "认证方式",
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
    proxyJumpHint: "另一台服务器的别名，可选。",
    proxyJumpPlaceholder: "选择或输入别名",
    envs: "写入的运行环境",
    envsHint:
      "托管配置写进这些运行环境的 ~/.ssh/cloudlink.conf，Agent 在其中才能连上。",
    cancel: "取消",
    save: "保存",
    saveAndProbe: "保存并探测",
    saving: "正在保存",
    required: "带 * 的为必填项",
    unverifiedTitle: "连接还没有通过验证",
    unverifiedDescription:
      "连接未验证，保存后不能分发。服务器暂时关机时可以先保存，之后再测试连接。",
    unverifiedConfirm: "仍然保存",
    created: (alias: string) => `已保存 ${alias}`,
  },

  test: {
    button: "测试连接",
    cancel: "取消",
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
    trust: "信任并继续",
    changedTitle: (alias: string) => `${alias} 的主机密钥与已知记录不符`,
    changedDescription:
      "可能是重装了系统，也可能是中间人攻击。CloudLink 已阻断这次连接。核实之后，手动更新 known_hosts。",
  },

  include: {
    title: "把托管配置加入 ~/.ssh/config？",
    description: (envs: string) =>
      `CloudLink 会把录入的连接写进自己托管的 ~/.ssh/cloudlink.conf。要让 Agent 用别名连上，需要在 ${envs} 的 ~/.ssh/config 开头加一行 Include。修改前先备份为 config.cloudlink-bak，其余内容不动。`,
    lineLabel: "将要加入开头的一行",
    add: "加入 Include",
    skip: "暂不加入",
    added: (env: string) => `已在 ${env} 的 ~/.ssh/config 开头加入 Include`,
    skipped:
      "没有加入 Include。服务器在这些运行环境中记为「未列入」，设置的「ssh 配置」里有手动添加的说明。",
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
    confirm: "复制",
    done: (path: string) => `已复制到 ${path}`,
    noSource: "先填写 Windows 的私钥路径。",
  },

  basic: {
    name: "名称",
    env: "环境",
    summary: "用途",
    summaryHint: "写进总览表和 description，帮助 Agent 判断任务涉及哪项资源。",
    chars: (n: number) => `${n} 字符`,
    tags: "标签",
    tagsPlaceholder: "输入后选择或新建",
    provider: "云厂商",
    region: "地域",
    servedHostnames: "承载的站点",
    servedHostnamesHint:
      "本机反代承载的域名，例如 api.example.com。会写进 description，你说「某个站点打不开」时 Agent 就能找到这台服务器。",
    servedHostnamesPlaceholder: "输入域名后选择「使用」",
    servedHostnamesEmpty: "输入域名，例如 api.example.com；不要写 IP 地址",
    summaryLine: (parts: string[]) => parts.join(" · "),
    tagCount: (n: number) => `${n} 个标签`,
  },

  paths: {
    hint: "告诉 Agent 关键目录在哪里，写进这台服务器的详情文件。",
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
    hint: "Docker 容器和 systemd 服务。角色和「关键」是人工标注，探测时保留；标为关键后，护栏会拦下停止或删除它的命令。",
    columns: {
      name: "名称",
      kind: "类型",
      image: "镜像",
      ports: "端口",
      role: "角色",
      critical: "关键",
      source: "来源",
      status: "状态",
      actions: "操作",
    },
    kind: { docker: "Docker", systemd: "systemd" },
    source: { probe: "探测", manual: "手动" },
    missing: "未发现",
    missingTip: "上次探测有，这次没发现。标注保留，不会自动删除。",
    sanitized: "已清洗",
    sanitizedTip:
      "名称里有不允许的字符，已替换，防止往 Agent 上下文里注入指令。",
    add: "手动添加",
    edit: "编辑",
    remove: "删除",
    rowActions: (name: string) => `${name} 的操作`,
    roleAria: (name: string) => `${name} 的角色`,
    criticalAria: (name: string) => `把 ${name} 标为关键服务`,
    empty:
      "还没有服务。探测会自动采集 Docker 容器和 systemd 服务，也可以手动添加。",
    exportImage: "导出镜像版本",
    exportImageHint: "关闭后，编译产物里不写镜像名和版本。",
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
    criticalHint:
      "护栏会拦下停止、删除或 kill 关键服务的命令，详情文件的红线里也会点名。",
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
    body: "正文",
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
      "还没有分发给这个 Agent 的资源。在资源配电盘的回路行上点亮它之后，这里显示编译出的总 Skill。",
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
    applied: (n: number) => `已更新 ${n} 处，已重新编译`,
    noChanges: "未发现变化，已更新探测时间",
    held: (n: number) => `待确认 ${n} 处：疑似指令注入，没有自动合并`,
    confirmed: (n: number) => `已合并 ${n} 处待确认项，已重新编译`,
    undone: "已撤销本次更新，已重新编译",
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
    probeAfter: "导入后测试连接并探测",
    submit: (n: number) => (n ? `导入 ${n} 台` : "导入"),
    loading: "正在扫描 ssh config",
    loadFailed: "没能读取 ssh config",
    emptyTitle: "ssh config 里没有可以导入的主机",
    emptyDescription:
      "CloudLink 托管配置里的 Host 不会出现在这里。在 ~/.ssh/config 中添加 Host 后重新打开，或者新建服务器。",
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
  agents: {
    summary: (included: number, enabled: number) =>
      `${included} 项资源已列入 · ${enabled} 个目标已启用`,
    problems: (n: number) => `${n} 个问题需要处理`,
    problemsLabel: (n: number) => `${n} 个问题需要处理，跳到第一个`,
    preview: "预览 Skill",
    checkAll: "检查全部",
    checked: (n: number) => `已检查 ${n} 个副本`,
    loading: "正在加载 Agent 目标",
    compileWarnings: (n: number) => `总 Skill 有 ${n} 条警告`,
    compileBlocked: (n: number, targets: string) =>
      `编译受阻：${n} 个错误，${targets}的总 Skill 没有发布`,
  },

  skillContent: {
    title: "交给 Agent 的内容",
    hint: "不属于任何一项资源，写进总 Skill 的 SKILL.md，原文逐字输出。",
    relationships: "基础设施之间的关系",
    relationshipsHint:
      "例如哪台反代哪台、哪些容器用哪台的数据库。用英文写，Agent 读起来最准确。",
    conventions: "运维约定",
    conventionsHint:
      "写进 SKILL.md 的「Rules for every server」，排在内置红线之后。",
    addConvention: "添加约定",
    conventionsEmpty: "还没有运维约定。",
    conventionAria: (n: number) => `第 ${n} 条运维约定`,
    dragAria: (n: number) => `拖动排序：第 ${n} 条运维约定`,
    removeAria: (n: number) => `删除第 ${n} 条运维约定`,
    healthCheck: "巡检清单",
    healthCheckHint:
      "内置，Agent 巡检时只执行只读命令，清单中的命令都能通过护栏的只读白名单。",
    viewHealthCheck: "查看",
    saved: "已保存，已重新编译",
  },

  guard: {
    title: "护栏（Claude Code）",
    rules: "查看规则",
    deniedToday: (n: number) => `今天拦下 ${n} 条`,
    install: "安装",
    remove: "移除",
    reinstall: "重新安装",
    boundary:
      "护栏只解析命令文本，能防手滑，防不了刻意绕过。Codex 没有护栏，它默认每条 ssh 都要你批准。",
    noTarget: "还没有启用 Claude Code 目标，启用后可以在这里安装护栏。",
    installTitle: (env: string) => `为 ${env} 的 Claude Code 安装护栏？`,
    installDescription:
      "CloudLink 会在 Claude Code 的用户级 settings.json 中加入下面这一条 PreToolUse hook。修改前先备份，其余设置和 hook 原样保留；以后移除时只删除这一条。",
    entryLabel: "将要加入的内容",
    backupLabel: "备份位置",
    installConfirm: "安装护栏",
    installed: (env: string) => `已为 ${env} 的 Claude Code 安装护栏`,
    removeTitle: (env: string) => `移除 ${env} 的护栏？`,
    removeDescription:
      "只删除 CloudLink 加入的那一条 hook。移除后，只读巡检只剩写给 Agent 的指令，没有拦截。",
    removeConfirm: "移除护栏",
    removed: (env: string) => `已移除 ${env} 的护栏`,
    rulesTitle: "护栏规则",
    rulesDescription:
      "只判定提到 CloudLink 中服务器的 ssh、scp、sftp、rsync 命令，以及已接入云平台的 wrangler、vercel、oci 命令。放行时交给 Claude Code 正常的权限流程，护栏不替你批准。",
    readOnlyTitle: "只读巡检：只放行这些命令",
    readOnlyNote:
      "不能有输出重定向、tee、命令替换、sudo 或原地修改参数；docker exec 里的命令同样要在白名单内。交互式登录、经标准输入执行脚本、sh -c 包装和文件传输都拦下。",
    standardTitle: "标准运维：拦下这些危险类别",
    alwaysTitle: "任何档位都拦下",
    unparsedNote:
      "解析不了的命令：只读资源上拦下，标准运维资源上放行并在记录中标注。",
    loading: "正在加载规则",
  },

  targets: {
    title: "分发目标",
    addCustom: "自定义目录",
    enable: (label: string, env: string) => `启用 ${label}（${env}）`,
    detected: "已检测到",
    notDetected: "未检测到",
    enabled: "已启用",
    disabled: "已停用",
    repair: "修复",
    actions: (label: string) => `${label} 的操作`,
    check: "检查",
    removeCustom: "移除",
    enabledToast: (label: string) => `已启用 ${label}，已写入总 Skill`,
    disabledToast: (label: string) =>
      `已停用 ${label}，已移除 CloudLink 分发的 cloudlink-servers`,
    disableTitle: (label: string) => `停用 ${label}？`,
    disableDescription:
      "CloudLink 会从这个目录移除自己分发的 cloudlink-servers，目录里的其他内容不受影响。",
    disableConfirm: "停用",
    repairTitle: "修复会覆盖副本里的改动",
    repairDescription: (path: string) =>
      `${path} 被改动过。修复会用 CloudLink 的编译结果覆盖它，改动会丢失。`,
    repairConfirm: "覆盖并修复",
    repaired: (label: string) => `已修复 ${label} 的副本`,
    removeTitle: (label: string) => `移除自定义目录 ${label}？`,
    removeDescription:
      "CloudLink 会删除自己分发的 cloudlink-servers，并不再同步这个目录。",
    removed: (label: string) => `已移除 ${label}`,
  },

  customTarget: {
    title: "添加自定义目录",
    description:
      "选择主流 Agent 自动填入默认目录与官方图标，或手动指定任意全局 skills 目录。",
    presets: "常见 Agent 快捷填充",
    name: "名称",
    path: "目录",
    pick: "选择目录",
    env: "运行环境",
    submit: "添加目录",
    added: (label: string) => `已添加 ${label}`,
  },

  /** 设置视图（PRD 6.7） */
  settings: {
    nav: "设置分区",
    section: {
      general: "通用",
      environments: "运行环境",
      ssh: "ssh 配置",
      compile: "编译",
      probe: "探测",
      activity: "活动",
      data: "数据",
      danger: "危险操作",
    } satisfies Record<SettingsSection, string>,
    sectionHint: {
      general: "主题、产物语言、默认档位",
      environments: "Windows 与 WSL 发行版",
      ssh: "托管配置与 Include",
      compile: "正文上限、快照时间",
      probe: "超时与探测脚本",
      activity: "活动日志与 Agent 操作",
      data: "数据目录与日志",
      danger: "移除全部分发、清空数据",
    } satisfies Record<SettingsSection, string>,
    saved: "设置已保存",
    loading: "正在加载设置",
    theme: "主题",
    themeOption: { system: "跟随系统", light: "浅色", dark: "深色" },
    outputLanguage: "编译产物语言",
    outputLanguageValue: "英文（English）",
    outputLanguageHint:
      "v0.1 固定输出英文：模板文字是英文，你填写的用途、红线、关系、约定和笔记原样输出。界面只有简体中文。",
    defaultMode: "新建非生产资源的默认档位",
    defaultModeHint: "生产资源新建时固定为只读巡检。",
    envList: "已检测到的运行环境",
    envEnabled: (label: string) => `启用 ${label}`,
    envHome: "主目录",
    envSshConfig: "ssh config",
    envUnavailableHint: "没有检测到这个环境，或者它没有启动。",
    redetect: "重新检测",
    redetected: "已重新检测运行环境与 Agent",
    sshHint:
      "录入的连接写进 CloudLink 托管的 ~/.ssh/cloudlink.conf，用户 config 开头的一行 Include 让它生效。",
    sshManaged: "托管文件",
    sshUserConfig: "用户 config",
    sshKnownHosts: "known_hosts",
    sshIncluded: "已加入 Include",
    sshNotIncluded: "未加入 Include",
    sshAddInclude: "加入 Include",
    sshManual:
      "也可以手动把下面这一行加到 config 的开头。放在末尾会被前面的 Host * 覆盖。",
    bodyLineLimit: "正文行数上限",
    bodyLineLimitHint:
      "SKILL.md 正文超过时给出警告，默认 100。Anthropic 建议正文不超过 500 行。",
    snapshot: "在 SKILL.md 中写入数据快照时间",
    snapshotHint: "让 Agent 知道这些信息采集于何时。",
    probeTimeout: "超时时间（秒）",
    probeTimeoutHint: "整个探测的超时。连接阶段固定 10 秒。",
    hostKey: "主机密钥策略",
    hostKeyValue: "严格校验（StrictHostKeyChecking=yes）",
    hostKeyHint:
      "固定，不提供选项。首次连接的主机，在测试连接时核对指纹后信任。",
    probeScript: "探测脚本",
    probeScriptHint:
      "只读，POSIX sh，不使用 sudo，不采集环境变量、文件内容和密钥。",
    sshPath: "Windows ssh 路径",
    sshPathHint: "默认用系统 OpenSSH 的绝对路径，不依赖 PATH 顺序。",
    dataDir: "数据目录",
    logDir: "日志目录",
    importExport: "导出或导入 JSON",
    importExportLater: "v0.5 提供",
    dangerHint:
      "这些操作不能撤销。CloudLink 只删除自己创建的副本、配置和数据。",
    removeAll: "移除全部分发",
    removeAllHint:
      "从所有 Agent 目标中移除 CloudLink 分发的 cloudlink-servers，并停用全部目标。资源信息保留。",
    removeAllConfirm: "移除全部",
    removeAllDone: "已移除全部分发",
    resetData: "清空数据",
    resetDataHint:
      "删除全部资源、托管 ssh 配置、凭据库中的密码、护栏的 hook、笔记收件箱、操作记录和活动日志，恢复默认设置。",
    resetDataConfirm: "清空数据",
    resetDone: "已清空数据",
    typeToConfirm: (text: string) => `输入「${text}」确认`,
    envUnavailable: "不可用",
  },

  activityKind: {
    connection: "测试连接",
    probe: "探测",
    compile: "编译",
    deliver: "分发",
    remove: "移除",
    repair: "修复",
    "ssh-config": "ssh 配置",
    guard: "护栏",
    mode: "档位",
    cli: "云平台 CLI",
    note: "笔记",
    "agent-op": "Agent 操作",
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
      `编译了 ${targetOf(p)}的总 Skill（${v(p, "count")} 项资源）`,
    "compile-blocked": (p) =>
      `${targetOf(p)}的总 Skill 编译受阻：${v(p, "count")} 个错误`,
    "deliver-ok": (p) => `把总 Skill 同步到 ${v(p, "target")}（${envOf(p)}）`,
    "remove-ok": (p) =>
      `从 ${v(p, "target")}（${envOf(p)}）移除了 cloudlink-servers`,
    "repair-ok": (p) => `修复了 ${v(p, "target")}（${envOf(p)}）的副本`,
    "ssh-config-written": (p) =>
      `写入了 ${envOf(p)} 的托管 ssh 配置（${v(p, "count")} 台服务器）`,
    "ssh-include-added": (p) =>
      `在 ${envOf(p)} 的 ~/.ssh/config 开头加入了 Include`,
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
  } satisfies Record<ActivityMessageId, Msg>,

  activityView: {
    title: "活动",
    kindFilter: "类型",
    assetFilter: "资源",
    assetPlaceholder: "全部资源",
    loadMore: "加载更多",
    loading: "正在加载活动",
    today: "今天",
    yesterday: "昨天",
    emptyTitle: "还没有活动记录",
    emptyDescription:
      "测试连接、CLI 检测、探测、编译、分发、档位切换、护栏和 Agent 操作的记录会按天出现在这里。",
    noMatch: "没有符合筛选条件的记录",
    clearFilter: "清除筛选",
    failed: "失败",
    retention:
      "日志在本地保留 30 天，不含原始探测输出、密码和解析后的连接信息。Agent 操作只记录经过护栏的命令（Claude Code）。",
  },

  toast: { undo: "撤销" },
}

/** 把 ipc 错误映射成一句可读的中文 */
export function ipcErrorText(id: IpcErrorId, params?: Params): string {
  return copy.ipcError[id](params)
}
