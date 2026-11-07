/* CloudLink 重设计原型：纯静态、假数据，只演示交互。 */
const $ = (s, r = document) => r.querySelector(s);
const ic = (n, c = '') => `<svg class="i ${c}" viewBox="0 0 24 24">${ICONS[n] || ''}</svg>`;
const MONO = new Set(['github', 'cursor', 'vercel', 'opencode', 'githubcopilot', 'windsurf']);
const logo = (n) => `<img src="brand/${n}.svg" alt="" class="${MONO.has(n) ? 'mono' : ''}">`;

const TARGETS = [
  { id: 'claude', name: 'Claude Code', logo: 'claude-color', tip: 'Claude Code\n护栏已开启' },
  { id: 'common', name: '通用目录', icon: 'blocks', tip: '通用目录\nCodex、Cursor、Gemini CLI 都读这里' },
  { id: 'trae', name: 'Trae', logo: 'trae-color', tip: 'Trae' },
];

const seed = () => ({
  resources: [
    { id: 'hk', kind: 'ssh', name: '香港边缘节点', alias: 'hk-edge', env: 'prod', status: 'ok', mode: 'ro', meta: 'Ubuntu 22.04', targets: ['claude', 'common'],
      addr: 'root@203.0.113.10:22', auth: '私钥 · ~/.ssh/cloudlink_hk_edge', jump: '无', purpose: '公网反向代理，承载 api.example.com 和 blog.example.com，运行 API 容器。',
      sites: ['api.example.com', 'blog.example.com'], rules: ['不要重启 nginx 容器，改配置后用 nginx -s reload', '不要动 /srv/data 下的任何文件'] },
    { id: 'sg', kind: 'ssh', name: '新加坡数据库', alias: 'sg-db', env: 'prod', status: 'ok', mode: 'rw', meta: 'Debian 12', targets: ['claude'],
      addr: 'admin@198.51.100.7:22', auth: '私钥 · ~/.ssh/id_ed25519', jump: 'hk-edge', purpose: 'PostgreSQL 主库，只在内网开放。', sites: [], rules: ['不要执行 DROP、TRUNCATE'] },
    { id: 'dev', kind: 'ssh', name: '开发机', alias: 'dev-box', env: 'dev', status: 'unverified', mode: 'rw', meta: '', targets: [],
      addr: 'dev@192.0.2.20:22', auth: '密码', jump: '无', purpose: '', sites: [], rules: [] },
    { id: 'cf', kind: 'cli', logo: 'cloudflare-color', name: 'Cloudflare', account: 'me@example.com', status: 'ok', mode: 'ro', meta: '2 个域名、1 个 Worker', targets: ['claude', 'common', 'trae'] },
    { id: 'gh', kind: 'cli', logo: 'github', name: 'GitHub', account: 'Furina-he', status: 'ok', mode: 'ro', meta: '3 个仓库', targets: ['claude', 'common'] },
    { id: 'vc', kind: 'cli', logo: 'vercel', name: 'Vercel', account: 'my-team', status: 'warn', warn: 'WSL 未登录', fix: '去登录', mode: 'ro', meta: '', targets: ['claude'] },
  ],
  agents: { claude: true, common: true, trae: true, kiro: true },
  kiroConflict: true,
  asks: [
    { id: 'n1', kind: 'note', agent: 'claude-color', who: 'Claude Code', res: 'hk-edge', text: 'nginx 配置放在 /opt/stack/nginx/conf.d，改完要运行 nginx -s reload。' },
    { id: 'n2', kind: 'note', agent: 'codex-color', who: 'Codex', res: 'sg-db', text: '每天 03:00 有备份任务，这段时间磁盘 IO 会升高，是正常现象。' },
    { id: 'a1', kind: 'approve', agent: 'codex-color', who: 'Codex', res: 'sg-db', text: 'systemctl restart postgresql' },
  ],
});

const S = {
  view: 'resources', detail: null, theme: 'light', layout: 'top', empty: false, tray: false,
  pop: null, dialog: null, toast: null, feed: 'all', settings: 'general', foldOthers: true,
  data: seed(),
};

const res = (id) => S.data.resources.find((r) => r.id === id);
const counts = () => ({ res: S.data.resources.length, pending: S.data.asks.length });

/* ── 外壳 ───────────────────────────────────────────── */
const NAV = [['resources', '资源', 'server'], ['agents', 'Agent', 'bot'], ['activity', '动态', 'activity'], ['settings', '设置', 'settings']];
const WINCTL = `<div class="winctl"><span><svg width="10" height="10"><path d="M0 5h10" stroke="currentColor"/></svg></span><span><svg width="10" height="10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor"/></svg></span><span><svg width="10" height="10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor"/></svg></span></div>`;

function shell() {
  const c = counts();
  const actions = `
    <div class="top-actions">
      <button class="ib" data-tip="搜索  Ctrl+F" data-act="noop">${ic('search')}</button>
      <button class="ib" data-tip="${S.layout === 'top' ? '切换到侧栏  Ctrl+Shift+S' : '切换到顶栏  Ctrl+Shift+S'}" data-act="layout">${ic(S.layout === 'top' ? 'panel-left' : 'panel-top')}</button>
      ${S.empty && S.view === 'resources' ? '' : `<button class="ib round-primary" data-tip="添加  Ctrl+N" data-act="add">${ic('plus')}</button>`}
    </div>${WINCTL}`;
  if (S.layout === 'top') {
    const seg = NAV.map(([k, l]) => `<button class="${S.view === k ? 'on' : ''}" data-nav="${k}">${l}${k === 'resources' ? ` <span class="count">${S.empty ? 0 : c.res}</span>` : ''}${k === 'activity' && c.pending ? '<span class="badge-dot"></span>' : ''}</button>`).join('');
    return `<div class="topbar"><div class="brand">CloudLink</div><div class="seg">${seg}</div><div class="top-right">${actions}</div></div><div class="content">${page()}</div>`;
  }
  const nav = NAV.map(([k, l, i]) => `<button class="${S.view === k ? 'on' : ''}" data-nav="${k}">${ic(i)}${l}${k === 'resources' ? `<span class="count">${S.empty ? 0 : c.res}</span>` : ''}${k === 'activity' && c.pending ? '<span class="badge-dot"></span>' : ''}</button>`).join('');
  const title = S.detail ? res(S.detail).name : NAV.find((n) => n[0] === S.view)[1];
  return `<aside class="sidebar"><div class="brand">CloudLink</div><nav class="nav">${nav}</nav>
    <div class="side-foot"><div class="row-mini"><span class="dot ok"></span>护栏运行中</div><div class="row-mini">今天拦截 2 条</div></div></aside>
    <div class="mainpane"><div class="pagebar"><h1>${title}</h1><div class="top-right" style="margin-left:auto">${actions}</div></div><div class="content">${page()}</div></div>`;
}

function page() {
  if (S.detail) return detail(res(S.detail));
  return { resources, agents, activity, settings }[S.view]();
}

/* ── 资源 ───────────────────────────────────────────── */
function targetGroup(r) {
  const on = (S.data.agents);
  return `<div class="targets">${TARGETS.filter((t) => on[t.id]).map((t) => {
    const lit = r.targets.includes(t.id);
    const locked = !lit && r.status === 'unverified';
    const tip = locked ? '先通过连接测试才能分发' : t.tip;
    return `<button class="tg ${lit ? 'on' : 'off'} ${locked ? 'locked' : ''}" data-tip="${tip}" data-target="${r.id}:${t.id}" aria-pressed="${lit}">${t.logo ? logo(t.logo) : ic(t.icon)}</button>`;
  }).join('')}</div>`;
}
const MODE = { ro: '只读巡检', rw: '标准运维' };
function modeText(r) {
  const hot = r.env === 'prod' && r.mode === 'rw';
  return `<span class="mode ${hot ? 'hot' : ''}" data-mode="${r.id}">${MODE[r.mode]}${ic('chevron-down', 'xs')}</span>`;
}
function rowStatus(r) {
  if (r.status === 'ok') return `<span class="dot ok" data-tip="${r.kind === 'cli' ? '已登录 ' + r.account : '已连接'}"></span>`;
  return statusBits(r) + '<span class="sep">·</span>';
}
function statusBits(r) {
  if (r.status === 'ok') return `<span class="dot ok"></span>${r.kind === 'cli' ? r.account : '已连接'}`;
  if (r.status === 'unverified') return `<span class="dot off"></span><span class="t-warn">未验证</span>`;
  return `<span class="dot warn"></span><span class="t-warn">${r.warn}</span>`;
}
function rowRes(r) {
  const tile = r.kind === 'ssh' ? `<div class="tile ssh">${ic('server')}</div>` : `<div class="tile">${logo(r.logo)}</div>`;
  const alias = r.alias ? `<span class="alias">${r.alias}</span>` : '';
  const env = r.env === 'prod' ? `<span class="env prod">生产</span>` : '';
  const fix = r.status === 'unverified' ? `<button class="btn sm" data-act="test" data-id="${r.id}">测试连接</button>`
    : r.fix ? `<button class="btn sm" data-act="fix" data-id="${r.id}">${r.fix}</button>` : '';
  return `<div class="row click" data-open="${r.id}" tabindex="0">${tile}
    <div class="who"><div class="name">${r.name}${alias}${env}</div>
      <div class="sub">${rowStatus(r)}${modeText(r)}</div></div>
    ${fix}${targetGroup(r)}${ic('chevron-right', 'sm chev')}</div>`;
}
function resources() {
  if (S.empty) return emptyState();
  const list = S.data.resources;
  const ssh = list.filter((r) => r.kind === 'ssh'), cli = list.filter((r) => r.kind === 'cli');
  return `<div class="page">
    <div class="group-head"><h2>服务器</h2><span class="n">${ssh.length}</span></div>
    <div class="list">${ssh.map(rowRes).join('')}</div>
    <div class="group-head"><h2>云平台</h2><span class="n">${cli.length}</span></div>
    <div class="list">${cli.map(rowRes).join('')}</div>
  </div>`;
}
function emptyState() {
  return `<div class="page"><div class="empty">
    <div class="mark">${ic('server')}</div>
    <h2>添加第一台服务器</h2>
    <p>添加之后，就可以直接对 Agent 说：</p>
    <div class="say">看看 hk-edge 的磁盘还剩多少<button class="ib" data-tip="复制" data-act="copy">${ic('copy', 'sm')}</button></div>
    <div class="ctas"><button class="btn primary" data-act="add-ssh">${ic('plus', 'sm')}添加服务器</button><button class="btn" data-act="import">从 ~/.ssh/config 导入 · 6 台</button></div>
    <div class="detected"><span>检测到</span><span class="logos"><span class="agent-av">${logo('claude-color')}</span><span class="agent-av">${logo('codex-color')}</span><span class="agent-av">${logo('cursor')}</span></span><span>Claude Code、Codex、Cursor，添加后会自动同步给它们</span></div>
  </div></div>`;
}

/* ── 详情 ───────────────────────────────────────────── */
function detail(r) {
  const tile = r.kind === 'ssh' ? `<div class="tile ssh">${ic('server')}</div>` : `<div class="tile">${logo(r.logo)}</div>`;
  const envTxt = r.env === 'prod' ? '<span class="env prod">生产</span>' : '';
  const desc = r.mode === 'ro' ? 'Agent 只能查看，写操作会被护栏拦下' : '允许部署和重启，危险命令仍会拦下';
  const conn = r.kind === 'ssh' ? `
    <div class="group-head"><h2>连接</h2><div class="right"><button class="btn ghost sm">${ic('pencil', 'xs')}编辑</button></div></div>
    <div class="list">
      <div class="pref"><div class="lbl"><b>地址</b></div><div class="val">${r.addr}<button class="ib cp" data-tip="复制" data-act="copy">${ic('copy', 'xs')}</button></div></div>
      <div class="pref"><div class="lbl"><b>登录方式</b></div><div class="val">${r.auth}<button class="ib cp" data-tip="复制" data-act="copy">${ic('copy', 'xs')}</button></div></div>
      <div class="pref"><div class="lbl"><b>跳板机</b></div><div class="val">${r.jump}</div></div>
    </div>` : `
    <div class="group-head"><h2>账号</h2></div>
    <div class="list"><div class="pref"><div class="lbl"><b>当前账号</b></div><div class="val">${r.account}</div></div>
      <div class="pref"><div class="lbl"><b>开放范围</b><small>Agent 只会看到这些域名和项目</small></div><div class="field">${r.meta || '全部'}${ic('chevron-down', 'xs')}</div></div></div>`;
  const profile = r.kind === 'ssh' ? `
    <div class="group-head"><h2>Agent 需要知道的</h2></div>
    <div class="list">
      <div class="pref" style="display:block"><div class="lbl" style="margin-bottom:4px"><b>用途</b></div><textarea class="textarea" placeholder="这台服务器是做什么的">${r.purpose}</textarea></div>
      <div class="pref"><div class="lbl"><b>承载的站点</b><small>站点出问题时，Agent 能找到这台服务器</small></div>
        <div class="chips">${r.sites.map((s) => `<span class="chip">${s}<button>${ic('x', 'xs')}</button></span>`).join('')}<span class="chip add">+ 添加</span></div></div>
    </div>
    <div class="group-head"><h2>红线</h2><span class="n">${r.rules.length}</span><div class="right"><button class="btn ghost sm">${ic('plus', 'xs')}添加</button></div></div>
    <div class="list">${r.rules.map((t, i) => `<div class="rule"><span class="num">${i + 1}</span><span>${t}</span><button class="ib x" style="width:20px;height:20px">${ic('x', 'xs')}</button></div>`).join('')}
      <div class="honest">${ic('info', 'sm')}<span>红线写给 Agent 看。Claude Code 上护栏会强制拦截，能防手滑，防不了刻意绕过。</span></div></div>` : '';
  return `<div class="page">
    <button class="back" data-act="back">${ic('chevron-left', 'sm')}资源</button>
    <div class="dhead">${tile}<h1>${r.name}${r.alias ? `<span class="alias">${r.alias}</span>` : ''}${envTxt}</h1>
      <div class="actions"><button class="btn" data-act="test" data-id="${r.id}">测试连接</button><button class="ib">${ic('ellipsis')}</button></div></div>
    <div class="dstatus">${statusBits(r)}${r.meta ? `<span>·</span>${r.meta}` : ''}${r.kind === 'ssh' ? `<span>·</span>2 小时前探测<button class="ib" style="width:20px;height:20px">${ic('refresh-cw', 'xs')}</button>` : ''}</div>

    <div class="group-head"><h2>Agent 权限</h2></div>
    <div class="list">
      <div class="pref"><div class="lbl"><b>生产环境</b><small>默认只读巡检；切到标准运维要确认</small></div><div class="sw ${r.env === 'prod' ? 'on' : ''}" data-prod="${r.id}"></div></div>
      <div class="pref"><div class="lbl"><b>档位</b><small>${desc}</small></div>
        <div class="seg"><button class="${r.mode === 'ro' ? 'on' : ''}" data-setmode="${r.id}:ro">只读巡检</button><button class="${r.mode === 'rw' ? 'on' : ''}" data-setmode="${r.id}:rw">标准运维</button></div></div>
      <div class="pref"><div class="lbl"><b>给哪些 Agent</b><small>${r.targets.length ? `${r.targets.length} 个目录已同步` : '还没有同步给任何 Agent'}</small></div>${targetGroup(r)}</div>
      ${r.id === 'hk' ? `<div class="pref warn"><div class="lbl"><b><span class="t-warn">WSL Ubuntu-24.04 还用不了这台服务器</span></b><small>WSL 里没有这把私钥</small></div><button class="btn sm" data-act="copykey">复制到 WSL</button></div>` : ''}
    </div>
    ${conn}${profile}
    <div class="group-head"><h2>最近动态</h2><div class="right"><button class="btn ghost sm" data-nav="activity">查看全部${ic('chevron-right', 'xs')}</button></div></div>
    <div class="list feed">${feedRows.slice(0, 3).map(feedRow).join('')}</div>
  </div>`;
}

/* ── Agent ──────────────────────────────────────────── */
const OTHERS = ['Gemini CLI', 'Windsurf', 'GitHub Copilot', 'OpenCode', 'Continue', 'Cline', 'Roo Code', 'Goose', 'Amp'];
function agents() {
  const A = S.data.agents;
  const n = S.data.resources.filter((r) => r.targets.length).length;
  const agentRow = (id, av, name, sub, right) => `<div class="row">${av}<div class="who"><div class="name">${name}</div><div class="sub">${sub}</div></div>${right}<div class="sw ${A[id] ? 'on' : ''}" data-agent="${id}" role="switch" aria-checked="${!!A[id]}"></div></div>`;
  const noGuard = `<span class="guard" data-tip="这个 Agent 还没有护栏，靠红线约束">无护栏</span>`;
  const stack = `<span class="mini-logos">${['codex-color', 'cursor', 'gemini-color'].map((l) => `<span class="agent-av" data-tip="${{ 'codex-color': 'Codex', cursor: 'Cursor', 'gemini-color': 'Gemini CLI' }[l]}">${logo(l)}</span>`).join('')}</span>`;
  const conflict = S.data.kiroConflict;
  return `<div class="page">
    <div class="intro"><span>CloudLink 把服务器和云平台写成一个 Skill，自动同步给下面这些 Agent。</span><button class="btn">${ic('file-text', 'sm')}预览 Skill</button></div>
    <div class="group-head"><h2>已检测到</h2><span class="n">4</span></div>
    <div class="list">
      ${agentRow('claude', `<div class="tile">${logo('claude-color')}</div>`, 'Claude Code', `<span class="dot ok"></span>已同步<span class="sep">·</span>${n} 项资源<span class="sep">·</span>Windows、WSL`, `<button class="guard" data-tip="今天拦截 2 条" data-act="guard">${ic('shield-check', 'sm')}护栏已开启</button>`)}
      ${agentRow('common', `<div class="tile ssh">${ic('blocks')}</div>`, `通用目录${stack}`, `<span class="dot ok"></span>已同步<span class="sep">·</span>${n} 项资源<span class="sep">·</span>3 个 Agent 读取这里`, noGuard)}
      ${agentRow('trae', `<div class="tile">${logo('trae-color')}</div>`, 'Trae', `<span class="dot ok"></span>已同步<span class="sep">·</span>Windows`, noGuard)}
      ${agentRow('kiro', `<div class="tile">${logo('kiro-color')}</div>`, 'Kiro', conflict ? `<span class="dot warn"></span><span class="t-warn">目录里已有同名 Skill</span>` : `<span class="dot ok"></span>已同步<span class="sep">·</span>Windows`, conflict ? `<button class="btn sm" data-act="takeover">备份并接管</button>` : noGuard)}
      <div class="row compact click" data-act="fold" style="justify-content:center;color:var(--muted);font-size:12px;gap:4px">${S.foldOthers ? `其余 ${OTHERS.length} 个未检测到${ic('chevron-down', 'xs')}` : `收起${ic('chevron-down', 'xs')}`}</div>
      ${S.foldOthers ? '' : `<div class="row compact" style="color:var(--muted);font-size:12px">${OTHERS.join('、')}</div>`}
    </div>
    <div class="group-head"><h2>Skill 内容</h2></div>
    <div class="list">
      <div class="row compact click"><div class="who"><div class="name" style="font-size:13px">资源关系</div></div><span class="when">自动整理 5 条</span>${ic('chevron-right', 'sm chev')}</div>
      <div class="row compact click"><div class="who"><div class="name" style="font-size:13px">运维约定</div></div><span class="when">3 条</span>${ic('chevron-right', 'sm chev')}</div>
      <div class="row compact click"><div class="who"><div class="name" style="font-size:13px">护栏规则</div></div><span class="when">内置 18 条</span>${ic('chevron-right', 'sm chev')}</div>
    </div>
    <div class="group-head"><h2>运行环境</h2></div>
    <div class="list">
      <div class="pref"><div class="lbl"><b>Windows</b></div><div class="sw on"></div></div>
      <div class="pref"><div class="lbl"><b>WSL Ubuntu-24.04</b></div><div class="sw on"></div></div>
    </div>
  </div>`;
}

/* ── 动态 ───────────────────────────────────────────── */
const feedRows = [
  { agent: 'claude-color', cmd: 'docker ps', res: 'hk-edge', ok: 'ok', when: '2 分钟前' },
  { agent: 'claude-color', cmd: 'rm -rf /var/log/nginx/*', res: 'hk-edge', ok: 'denied', why: '只读档', when: '5 分钟前' },
  { agent: 'codex-color', cmd: 'wrangler deploy', res: 'Cloudflare', ok: 'denied', why: '只读档', when: '18 分钟前' },
  { agent: 'claude-color', cmd: 'df -h', res: 'sg-db', ok: 'ok', when: '1 小时前' },
  { agent: 'claude-color', cmd: 'systemctl status nginx', res: 'hk-edge', ok: 'ok', when: '3 小时前' },
];
const feedRow = (f) => `<div class="row"><span class="agent-av">${logo(f.agent)}</span>
  <div class="who"><code class="cmd">${f.cmd}</code></div>
  <span class="when col-res">${f.res}</span>
  <span class="col-state">${f.ok === 'ok' ? `<span class="dot ok"></span>已执行` : `<span class="dot err"></span><span class="t-err">已拦截 · ${f.why}</span>`}</span>
  <span class="when" style="width:60px;text-align:right">${f.when}</span></div>`;
function askRow(a) {
  if (a.kind === 'approve') return `<div class="ask"><div class="top"><span class="agent-av">${logo(a.agent)}</span><b style="font-weight:500">${a.who} 想在 ${a.res} 上运行</b><span class="future">下个版本：执行通道</span></div>
    <div class="body"><code class="cmd">${a.text}</code></div><div class="acts"><button class="btn primary sm" data-ask="${a.id}:ok">允许一次</button><button class="btn sm" data-ask="${a.id}:no">拒绝</button></div></div>`;
  return `<div class="ask"><div class="top"><span class="agent-av">${logo(a.agent)}</span><b style="font-weight:500">${a.who} 记下了一条关于 ${a.res} 的笔记</b></div>
    <div class="body">${a.text}</div><div class="acts"><button class="btn primary sm" data-ask="${a.id}:ok">并入资源</button><button class="btn sm" data-ask="${a.id}:no">忽略</button></div></div>`;
}
function activity() {
  const asks = S.data.asks;
  const filters = [['all', '全部'], ['denied', '已拦截'], ['cmd', '命令']];
  const rows = feedRows.filter((f) => S.feed === 'all' || (S.feed === 'denied' ? f.ok === 'denied' : f.ok === 'ok'));
  return `<div class="page">
    ${asks.length ? `<div class="group-head"><h2>等你确认</h2><span class="n">${asks.length}</span></div><div class="list">${asks.map(askRow).join('')}</div>` : ''}
    <div class="group-head"><h2>操作记录</h2><div class="right"><div class="seg">${filters.map(([k, l]) => `<button class="${S.feed === k ? 'on' : ''}" data-feed="${k}">${l}</button>`).join('')}</div></div></div>
    <div class="daylabel">今天</div>
    <div class="list feed">${rows.map(feedRow).join('')}</div>
    <p style="font-size:12px;color:var(--muted);margin:10px 4px 0">目前只有 Claude Code 的命令会记录在这里。</p>
  </div>`;
}

/* ── 设置 ───────────────────────────────────────────── */
function settings() {
  return `<div class="page">
    <div class="group-head"><h2>外观</h2></div>
    <div class="list">
      <div class="pref"><div class="lbl"><b>主题</b></div><div class="seg"><button class="${S.theme === 'light' ? 'on' : ''}" data-theme="light">浅色</button><button class="${S.theme === 'dark' ? 'on' : ''}" data-theme="dark">深色</button><button>跟随系统</button></div></div>
      <div class="pref"><div class="lbl"><b>导航位置</b></div><div class="seg"><button class="${S.layout === 'top' ? 'on' : ''}" data-layout="top">顶栏</button><button class="${S.layout === 'side' ? 'on' : ''}" data-layout="side">侧栏</button></div></div>
    </div>
    <div class="group-head"><h2>启动与托盘</h2></div>
    <div class="list">
      <div class="pref"><div class="lbl"><b>关闭窗口时</b></div><div class="seg"><button class="on">留在托盘</button><button>退出</button></div></div>
      <div class="pref"><div class="lbl"><b>开机时启动</b></div><div class="sw"></div></div>
      <div class="pref"><div class="lbl"><b>检测更新</b><small>只读取 GitHub Releases 上的版本信息，不上传任何数据</small></div><div class="sw on"></div></div>
    </div>
    <div class="group-head"><h2>数据</h2></div>
    <div class="list">
      <div class="pref"><div class="lbl"><b>SSH 配置</b><small>~/.ssh/cloudlink.conf 已通过 Include 生效</small></div><button class="btn sm">打开</button></div>
      <div class="pref"><div class="lbl"><b>备份</b><small>覆盖或接管之前的版本保存在 ~/.cloudlink/backups</small></div><button class="btn sm">打开</button></div>
      <div class="pref"><div class="lbl"><b>重置 CloudLink</b><small>移除全部托管副本和设置，不会动你自己的文件</small></div><button class="btn sm" style="color:var(--red)">重置…</button></div>
    </div>
  </div>`;
}

/* ── 浮层 ───────────────────────────────────────────── */
function modePop() {
  const p = S.pop; if (!p) return '';
  const r = res(p.id);
  const confirm = p.confirm ? `<div class="confirm"><span><b style="font-weight:500">${r.alias || r.name}</b> 是生产环境。切到标准运维后，Agent 可以部署和重启。</span><div class="acts"><button class="btn sm" data-act="pop-cancel">取消</button><button class="btn primary sm" data-setmode="${r.id}:rw:yes">切换</button></div></div>` : '';
  return `<div class="pop" style="left:${p.x}px;top:${p.y}px">
    <div class="opt" data-pick="${r.id}:ro"><div class="ck">${r.mode === 'ro' ? ic('check', 'sm') : ''}</div><div><b>只读巡检</b><small>Agent 只能查看，写操作会被拦下</small></div></div>
    <div class="opt" data-pick="${r.id}:rw"><div class="ck">${r.mode === 'rw' ? ic('check', 'sm') : ''}</div><div><b>标准运维</b><small>允许部署和重启，危险命令仍会拦下</small></div></div>
    ${confirm}</div>`;
}
function addDialog() {
  const d = S.dialog; if (!d) return '';
  let body = '', foot = '', title = '添加';
  if (d.step === 'types') {
    const t = (id, av, b, s, tag) => `<div class="type" data-type="${id}">${av}<div><b>${b}</b><small>${s}</small>${tag ? `<span class="tag">${tag}</span>` : ''}</div></div>`;
    body = `<div class="types-label">服务器</div><div class="types">
      ${t('ssh', `<div class="tile ssh">${ic('server')}</div>`, 'SSH 服务器', '填地址和密码，自动换成免密密钥')}
      ${t('import', `<div class="tile ssh">${ic('download')}</div>`, '从 ~/.ssh/config 导入', '把已有的主机接进来', '发现 6 台')}
      </div><div class="types-label">云平台</div><div class="types three">
      ${t('cf', `<div class="tile">${logo('cloudflare-color')}</div>`, 'Cloudflare', '域名和 Worker', '已登录 · wrangler')}
      ${t('vc', `<div class="tile">${logo('vercel')}</div>`, 'Vercel', '前端和 Serverless 项目', '已登录 · vercel')}
      ${t('oci', `<div class="tile">${logo('oracle')}</div>`, 'Oracle Cloud', '云主机和防火墙', '未安装 oci')}
      </div><div class="types-label">代码托管</div><div class="types three">
      ${t('gh', `<div class="tile">${logo('github')}</div>`, 'GitHub', '仓库，以及它们部署到哪里', '已登录 · gh')}
      </div>`;
  } else if (d.step === 'ssh') {
    title = '添加 SSH 服务器';
    body = `<div class="form">
      <div class="fld"><label>地址</label><input class="inp mono" id="fHost" value="${d.host}" placeholder="203.0.113.10"></div>
      <div class="fld"><label>端口</label><input class="inp mono" value="22"></div>
      <div class="fld"><label>用户</label><input class="inp mono" value="root"></div>
      <div class="fld"><label>生产环境</label><div style="height:32px;display:flex;align-items:center"><div class="sw on"></div></div></div>
      <div class="fld full"><label>密码</label><input class="inp" type="password" value="password"><div class="preview-line">只用这一次。连接后换成免密密钥，密码不会保存。</div></div>
      <div class="fld full"><label>名称</label><input class="inp" id="fName" value="${d.name}" placeholder="香港边缘节点"><div class="preview-line">Agent 会用 <code class="cmd">ssh ${d.alias}</code> 连接它。</div></div>
    </div>`;
    foot = `<button class="btn ghost" data-act="dlg-back">返回</button><button class="btn primary" data-act="connect">连接并启用</button>`;
  } else if (d.step === 'run') {
    title = '正在连接';
    const STEPS = ['连接服务器', '核对主机指纹', '安装免密密钥', '同步给 Agent'];
    body = `<div class="steps">${STEPS.map((s, i) => {
      const st = i < d.at ? 'done' : i === d.at ? 'now' : '';
      const si = st === 'done' ? ic('check', 'sm') : st === 'now' ? (d.wait ? ic('key-round', 'sm') : '<span class="spin"></span>') : '<span class="dot off"></span>';
      const fp = i === 1 && d.wait ? `<div class="fp"><span>第一次连接这台服务器，请核对指纹：</span><code>SHA256:Yx3pV1m8qNfK0dT7uZbLe2QhR5cWsJ9aGiE4oXkP6nA</code><div><button class="btn primary sm" data-act="trust">指纹一致，继续</button> <button class="btn ghost sm" data-act="dlg-back">取消</button></div></div>` : '';
      return `<div class="step ${st}"><span class="si">${si}</span>${s}</div>${fp}`;
    }).join('')}</div>`;
  }
  return `<div class="scrim" data-act="scrim"><div class="dialog" data-stop>
    <header><h3>${title}</h3><button class="ib" data-act="dlg-close">${ic('x')}</button></header>
    <div class="dbody">${body}</div>${foot ? `<footer>${foot}</footer>` : ''}</div></div>`;
}
const toastEl = () => S.toast ? `<div class="toast">${S.toast.msg}${S.toast.undo ? `<button class="btn sm" data-act="undo">撤销</button>` : ''}</div>` : '';

function tray() {
  if (!S.tray) return '';
  const ssh = S.data.resources.filter((r) => r.mode);
  const hot = ssh.filter((r) => r.env === 'prod' && r.mode === 'rw').length;
  return `<div class="tray"><div class="th">CloudLink<small><span class="dot ok"></span>护栏运行中</small></div>
    <div class="tsec">档位</div>
    ${ssh.map((r) => `<div class="ti" data-tray="${r.id}">${r.alias || r.name}<span class="r ${r.env === 'prod' && r.mode === 'rw' ? 'hot' : ''}">${MODE[r.mode]}${ic('chevron-right', 'xs')}</span></div>`).join('')}
    <hr><div class="ti" data-act="all-ro">全部切回只读${hot ? `<span class="r hot">${hot} 台生产在运维档</span>` : ''}</div>
    <hr><div class="ti" data-act="tray-open">打开 CloudLink</div><div class="ti">退出</div></div>`;
}

/* ── 原型控制 ───────────────────────────────────────── */
function proto() {
  return `<h4>原型控制</h4>
    <label>主题<span class="seg"><button class="${S.theme === 'light' ? 'on' : ''}" data-theme="light">浅</button><button class="${S.theme === 'dark' ? 'on' : ''}" data-theme="dark">深</button></span></label>
    <label>导航<span class="seg"><button class="${S.layout === 'top' ? 'on' : ''}" data-layout="top">顶栏</button><button class="${S.layout === 'side' ? 'on' : ''}" data-layout="side">侧栏</button></span></label>
    <label>空状态<span class="sw ${S.empty ? 'on' : ''}" data-act="toggle-empty"></span></label>
    <label>托盘菜单<span class="sw ${S.tray ? 'on' : ''}" data-act="toggle-tray"></span></label>
    <button class="btn" data-act="reset">重置数据</button>
    <p>可以试：点档位文字切换；点 Agent 图标同步；点一行进详情；点 + 走添加流程。</p>`;
}

/* ── 渲染与事件 ─────────────────────────────────────── */
function render() {
  document.documentElement.dataset.theme = S.theme;
  const win = $('#win');
  const scroll = $('.content', win)?.scrollTop || 0;
  win.className = 'window' + (S.layout === 'side' ? ' side' : '');
  win.innerHTML = shell() + modePop() + addDialog() + toastEl();
  const c = $('.content', win); if (c) c.scrollTop = scroll;
  $('#proto').innerHTML = proto();
  $('#trayHost').innerHTML = tray();
  document.querySelectorAll('.page').forEach((p) => { if (render.same) p.style.animation = 'none'; });
}
let toastTimer;
function toast(msg, undo) {
  S.toast = { msg, undo }; render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { S.toast = null; render.same = true; render(); render.same = false; }, undo ? 6000 : 2600);
}
function calm(fn) { render.same = true; fn(); render.same = false; }
const go = (fn) => { fn(); render(); };

function setMode(id, m, yes) {
  const r = res(id);
  if (m === r.mode) { S.pop = null; return calm(render); }
  if (m === 'rw' && r.env === 'prod' && !yes) {
    if (S.pop) { S.pop.confirm = true; return calm(render); }
    const el = document.activeElement;
    return confirmViaPop(r, el);
  }
  const old = r.mode; r.mode = m; S.pop = null;
  calm(() => toast(`${r.alias || r.name} 已切到${MODE[m]}`, () => { r.mode = old; }));
}
function confirmViaPop(r, el) {
  const w = $('#win').getBoundingClientRect(); const b = el.getBoundingClientRect();
  S.pop = { id: r.id, x: Math.min(b.left - w.left - 120, 700), y: b.bottom - w.top + 6, confirm: true };
  calm(render);
}

document.addEventListener('click', (e) => {
  const t = e.target;
  const q = (s) => t.closest(s);
  let el;
  if ((el = q('[data-theme]')) && el.tagName === 'BUTTON') return calm(() => { S.theme = el.dataset.theme; render(); });
  if ((el = q('[data-layout]'))) return go(() => { S.layout = el.dataset.layout; });
  if ((el = q('[data-nav]'))) return go(() => { S.view = el.dataset.nav; S.detail = null; S.pop = null; });
  if ((el = q('[data-mode]'))) {
    e.stopPropagation();
    const w = $('#win').getBoundingClientRect(); const b = el.getBoundingClientRect();
    S.pop = { id: el.dataset.mode, x: Math.min(b.left - w.left, 720), y: b.bottom - w.top + 6 };
    return calm(render);
  }
  if ((el = q('[data-pick]'))) { const [id, m] = el.dataset.pick.split(':'); return setMode(id, m); }
  if ((el = q('[data-setmode]'))) { const [id, m, y] = el.dataset.setmode.split(':'); return setMode(id, m, !!y); }
  if ((el = q('[data-target]'))) {
    const [id, tg] = el.dataset.target.split(':'); const r = res(id);
    if (el.classList.contains('locked')) return calm(() => toast('先通过连接测试，才能同步给 Agent'));
    const before = [...r.targets];
    r.targets = r.targets.includes(tg) ? r.targets.filter((x) => x !== tg) : [...r.targets, tg];
    const name = TARGETS.find((x) => x.id === tg).name;
    return calm(() => toast(`${r.alias || r.name} ${r.targets.includes(tg) ? '已同步给' : '已从这里移除：'}${name}`, () => { r.targets = before; }));
  }
  if ((el = q('[data-prod]'))) { const r = res(el.dataset.prod); r.env = r.env === 'prod' ? 'dev' : 'prod'; return calm(render); }
  if ((el = q('[data-agent]'))) { const k = el.dataset.agent; S.data.agents[k] = !S.data.agents[k]; return calm(render); }
  if ((el = q('[data-feed]'))) { S.feed = el.dataset.feed; return calm(render); }
  if ((el = q('[data-ask]'))) {
    const [id, how] = el.dataset.ask.split(':');
    const before = [...S.data.asks]; const a = S.data.asks.find((x) => x.id === id);
    S.data.asks = S.data.asks.filter((x) => x.id !== id);
    const msg = a.kind === 'approve' ? (how === 'ok' ? '已允许一次' : '已拒绝') : (how === 'ok' ? `已并入 ${a.res}` : '已忽略');
    return calm(() => toast(msg, a.kind === 'note' ? () => { S.data.asks = before; } : null));
  }
  if ((el = q('[data-type]'))) {
    if (el.dataset.type === 'ssh') { S.dialog = { step: 'ssh', host: '203.0.113.42', name: '东京节点', alias: 'tokyo-1' }; return calm(render); }
    S.dialog = null; return calm(() => toast('原型只演示 SSH 服务器这条流程'));
  }
  if ((el = q('[data-tray]'))) {
    const r = res(el.dataset.tray); const old = r.mode; r.mode = r.mode === 'ro' ? 'rw' : 'ro';
    return calm(() => toast(`${r.alias || r.name} 已切到${MODE[r.mode]}`, () => { r.mode = old; }));
  }
  if ((el = q('[data-act]'))) {
    const a = el.dataset.act;
    if (a === 'scrim' && q('[data-stop]')) return;
    const acts = {
      noop() {},
      layout() { S.layout = S.layout === 'top' ? 'side' : 'top'; render(); },
      add() { S.dialog = { step: 'types' }; calm(render); },
      'add-ssh'() { S.dialog = { step: 'ssh', host: '203.0.113.42', name: '东京节点', alias: 'tokyo-1' }; calm(render); },
      import() { toast('原型只演示 SSH 服务器这条流程'); },
      copy() { toast('已复制'); },
      back() { S.detail = null; render(); },
      test() {
        const r = res(el.dataset.id); e.stopPropagation();
        if (r.status === 'unverified') { r.status = 'ok'; r.auth = '私钥 · ~/.ssh/cloudlink_dev_box'; r.meta = 'Ubuntu 24.04'; calm(() => toast(`${r.alias} 连接成功，已换成免密密钥`)); }
        else calm(() => toast(`${r.alias || r.name} 连接成功 · 128 ms`));
      },
      fix() { e.stopPropagation(); const r = res(el.dataset.id); r.status = 'ok'; r.fix = null; calm(() => toast('已打开终端，登录后自动刷新')); },
      copykey() { toast('私钥已复制到 WSL Ubuntu-24.04'); },
      takeover() { S.data.kiroConflict = false; calm(() => toast('旧版已备份，Kiro 已同步', () => { S.data.kiroConflict = true; })); },
      guard() { S.view = 'activity'; render(); },
      fold() { S.foldOthers = !S.foldOthers; calm(render); },
      'pop-cancel'() { S.pop = null; calm(render); },
      'dlg-close'() { S.dialog = null; calm(render); },
      scrim() { S.dialog = null; calm(render); },
      'dlg-back'() { S.dialog = { step: 'types' }; calm(render); },
      connect() { S.dialog = { ...S.dialog, step: 'run', at: 0, wait: false }; calm(render); setTimeout(() => { if (S.dialog?.step === 'run') { S.dialog.at = 1; S.dialog.wait = true; calm(render); } }, 900); },
      trust() {
        S.dialog.wait = false; S.dialog.at = 2; calm(render);
        setTimeout(() => { if (S.dialog) { S.dialog.at = 3; calm(render); } }, 900);
        setTimeout(() => {
          if (!S.dialog) return;
          S.data.resources.splice(2, 0, { id: 'tk', kind: 'ssh', name: '东京节点', alias: 'tokyo-1', env: 'prod', status: 'ok', mode: 'ro', meta: 'Ubuntu 24.04', targets: ['claude', 'common'], addr: 'root@203.0.113.42:22', auth: '私钥 · ~/.ssh/cloudlink_tokyo_1', jump: '无', purpose: '', sites: [], rules: [] });
          S.dialog = null; S.empty = false; S.view = 'resources'; S.detail = null; toast('东京节点已添加，并同步给 2 个目录');
        }, 1800);
      },
      undo() { const u = S.toast?.undo; if (u) u(); S.toast = null; calm(render); },
      'toggle-empty'() { S.empty = !S.empty; S.view = 'resources'; S.detail = null; render(); },
      'toggle-tray'() { S.tray = !S.tray; calm(render); },
      'all-ro'() {
        const hot = S.data.resources.filter((r) => r.mode === 'rw' && r.env === 'prod'); hot.forEach((r) => { r.mode = 'ro'; });
        calm(() => toast(hot.length ? `${hot.length} 台生产服务器已切回只读` : '生产服务器都在只读档', hot.length ? () => hot.forEach((r) => { r.mode = 'rw'; }) : null));
      },
      'tray-open'() { S.tray = false; calm(render); },
      reset() { S.data = seed(); S.detail = null; S.view = 'resources'; S.pop = null; S.dialog = null; S.toast = null; render(); },
    };
    if (acts[a]) return acts[a]();
  }
  if ((el = q('[data-open]'))) return go(() => { S.detail = el.dataset.open; S.pop = null; });
  if (S.pop && !q('.pop')) { S.pop = null; calm(render); }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'fName' && S.dialog) { S.dialog.name = e.target.value; }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (S.dialog) S.dialog = null; else if (S.pop) S.pop = null; else if (S.detail) S.detail = null; render(); }
  if (e.key === 'Enter' && e.target.dataset?.open) { S.detail = e.target.dataset.open; render(); }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); S.layout = S.layout === 'top' ? 'side' : 'top'; render(); }
  if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); S.dialog = { step: 'types' }; calm(render); }
});

render();
