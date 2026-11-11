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
      sites: ['api.example.com', 'blog.example.com'], rules: ['不要重启 nginx 容器，改配置后用 nginx -s reload', '不要动 /srv/data 下的任何文件'],
      tags: ['edge', '1panel'], provider: 'Tencent Cloud', region: 'HK', notes: '- 2026-10-28: API 在 /opt/1panel/docker/compose/api 用 docker compose up -d --build 部署',
      services: [['openresty', 'Docker', 'openresty:1.21', '80, 443', '主网关与 SSL 终结', true], ['old-worker', 'Docker', 'worker:0.9', '—', '旧版队列消费者', false]],
      paths: [['OpenResty 站点配置', '/opt/1panel/apps/openresty/openresty/conf/'], ['Compose 编排目录', '/opt/1panel/docker/compose']], ports: ['0.0.0.0:22/tcp', '0.0.0.0:443/tcp'] },
    { id: 'sg', kind: 'ssh', name: '新加坡数据库', alias: 'sg-db', env: 'prod', status: 'ok', mode: 'rw', meta: 'Debian 12', targets: ['claude'],
      addr: 'admin@198.51.100.7:22', auth: '私钥 · ~/.ssh/id_ed25519', jump: 'hk-edge', purpose: 'PostgreSQL 主库，只在内网开放。', sites: [], rules: ['不要执行 DROP、TRUNCATE'],
      tags: ['db'], provider: 'AWS Lightsail', region: 'SG', notes: '', services: [['postgresql', 'systemd', '—', '—', '主数据库', true], ['redis', 'Docker', 'redis:7.4', '6379', '', false]],
      paths: [['PostgreSQL 数据目录', '/var/lib/postgresql/16/main']], ports: ['127.0.0.1:5432/tcp'] },
    { id: 'dev', kind: 'ssh', name: '开发机', alias: 'dev-box', env: 'dev', status: 'unverified', mode: 'rw', meta: '', targets: [],
      addr: 'dev@192.0.2.20:22', auth: '密码', jump: '无', purpose: '', sites: [], rules: [] },
    { id: 'cf', kind: 'cli', logo: 'cloudflare-color', name: 'Cloudflare', account: 'me@example.com', status: 'ok', mode: 'ro', meta: '2 个域名、1 个 Worker', targets: ['claude', 'common', 'trae'] },
    { id: 'gh', kind: 'cli', logo: 'github', name: 'GitHub', account: 'Furina-he', status: 'ok', mode: 'ro', meta: '3 个仓库', targets: ['claude', 'common'] },
    { id: 'vc', kind: 'cli', logo: 'vercel', name: 'Vercel', account: 'my-team', status: 'warn', warn: 'WSL 未登录', fix: '去登录', mode: 'ro', meta: '', targets: ['claude'] },
  ],
  agents: { claude: true, common: true, trae: true, kiro: true },
  kiroConflict: true,
  include: false, // 还没在 ~/.ssh/config 里加过 Include：第一次添加服务器时会问一次
  asks: [
    { id: 'n1', kind: 'note', agent: 'claude-color', who: 'Claude Code', res: 'hk-edge', text: 'nginx 配置放在 /opt/stack/nginx/conf.d，改完要运行 nginx -s reload。' },
    { id: 'n2', kind: 'note', agent: 'codex-color', who: 'Codex', res: 'sg-db', text: '每天 03:00 有备份任务，这段时间磁盘 IO 会升高，是正常现象。' },
    { id: 'a1', kind: 'approve', agent: 'codex-color', who: 'Codex', res: 'sg-db', text: 'systemctl restart postgresql' },
  ],
});

const S = {
  view: 'resources', detail: null, theme: 'light', layout: 'top', empty: false, tray: false,
  pop: null, dialog: null, toast: null, feed: 'all', settings: 'general', foldOthers: true,
  sub: null, sheet: null, sshBroken: false, sshManual: false, advOpen: false, flash: null,
  data: seed(),
};
const SUBS = { rules: '护栏规则' };

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
  const title = S.detail ? res(S.detail).name : S.sub ? SUBS[S.sub] : NAV.find((n) => n[0] === S.view)[1];
  return `<aside class="sidebar"><div class="brand">CloudLink</div><nav class="nav">${nav}</nav>
    <div class="side-foot"><div class="row-mini"><span class="dot ok"></span>护栏运行中</div><div class="row-mini">今天拦截 2 条</div></div></aside>
    <div class="mainpane"><div class="pagebar"><h1>${title}</h1><div class="top-right" style="margin-left:auto">${actions}</div></div><div class="content">${page()}</div></div>`;
}

function page() {
  if (S.detail) return detail(res(S.detail));
  if (S.view === 'agents' && S.sub === 'rules') return rulesPage();
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
  return `<div class="row click${S.flash === r.id ? ' flash' : ''}" data-open="${r.id}" tabindex="0">${tile}
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
/* 2026-11-10：少用的字段折叠，首屏能看到红线。「更多信息」「探测结果」一律默认收起（已确认） */
function moreInfo(r) {
  const sum = [r.tags?.length ? `${r.tags.length} 个标签` : '', r.provider, r.region, r.notes ? '有笔记' : ''].filter(Boolean).join(' · ') || '标签、云厂商、地域、笔记';
  return `<details class="fold"><summary class="pref"><div class="lbl"><b>更多信息</b><small>${sum}</small></div>${ic('chevron-down', 'xs')}</summary>
    <div class="pref"><div class="lbl"><b>标签</b></div><div class="chips">${(r.tags || []).map((t) => `<span class="chip">${t}<button>${ic('x', 'xs')}</button></span>`).join('')}<span class="chip add">+ 添加</span></div></div>
    <div class="pref"><div class="lbl"><b>云厂商 · 地域</b></div><div class="val">${r.provider || '—'} · ${r.region || '—'}</div></div>
    <div class="pref" style="display:block"><div class="lbl" style="margin-bottom:4px"><b>笔记</b><small>你并入的 Agent 笔记会出现在这里，也可以直接编辑</small></div><textarea class="textarea" placeholder="还没有笔记">${r.notes || ''}</textarea></div>
  </details>`;
}
/* 服务与目录：默认一行摘要，点开看表 */
function probed(r) {
  if (!r.services) return '';
  const crit = r.services.filter((x) => x[5]).length;
  const sum = `${r.services.length} 个服务${crit ? `（${crit} 个关键）` : ''} · ${r.paths.length} 个关键目录 · ${r.ports.length} 个监听端口`;
  return `<div class="group-head"><h2>服务与目录</h2><div class="right"><button class="btn ghost sm">${ic('refresh-cw', 'xs')}重新探测</button></div></div>
    <div class="list"><details class="fold"><summary class="pref"><div class="lbl"><b>探测结果</b><small>${sum}</small></div>${ic('chevron-down', 'xs')}</summary>
      <table class="svc"><thead><tr><th>名称</th><th>镜像</th><th>端口</th><th>角色</th><th>关键</th></tr></thead><tbody>
      ${r.services.map((x) => `<tr><td><b>${x[0]}</b><small>${x[1]}</small></td><td class="mono">${x[2]}</td><td class="mono">${x[3]}</td><td><input class="inp sm" value="${x[4]}" placeholder="例如 反向代理"></td><td><div class="sw ${x[5] ? 'on' : ''}"></div></td></tr>`).join('')}
      </tbody></table>
      <div class="pref"><div class="lbl"><b>关键目录</b>${r.paths.map((x) => `<small>${x[0]} · <span class="mono">${x[1]}</span></small>`).join('')}</div><button class="btn ghost sm">${ic('plus', 'xs')}添加</button></div>
      <div class="pref"><div class="lbl"><b>监听端口</b></div><div class="chips">${r.ports.map((x) => `<span class="chip">${x}</span>`).join('')}</div></div>
    </details></div>`;
}
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
      ${moreInfo(r)}
    </div>
    ${probed(r)}
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
      <div class="row compact click" data-act="fold" style="justify-content:center;color:var(--muted);font-size:12px;gap:4px">其余 ${OTHERS.length} 个未检测到<span class="turn ${S.foldOthers ? '' : 'up'}">${ic('chevron-down', 'xs')}</span></div>
      ${S.foldOthers ? '' : `<div class="others">${OTHERS.map((o) => `<span>${o}</span>`).join('')}</div>`}
    </div>
    <div class="group-head"><h2>Skill 内容</h2></div>
    <div class="list">
      <div class="row compact click"><div class="who"><div class="name" style="font-size:13px">资源关系</div></div><span class="when">自动整理 5 条</span>${ic('chevron-right', 'sm chev')}</div>
      <div class="row compact click"><div class="who"><div class="name" style="font-size:13px">运维约定</div></div><span class="when">3 条</span>${ic('chevron-right', 'sm chev')}</div>
      <div class="row compact click" data-act="rules"><div class="who"><div class="name" style="font-size:13px">护栏规则</div></div><span class="when">拦截 ${GUARD.std.length + GUARD.always.length} 类危险操作</span>${ic('chevron-right', 'sm chev')}</div>
    </div>
    <div class="group-head"><h2>运行环境</h2></div>
    <div class="list">
      <div class="pref"><div class="lbl"><b>Windows</b></div><div class="sw on"></div></div>
      <div class="pref"><div class="lbl"><b>WSL Ubuntu-24.04</b></div><div class="sw on"></div></div>
    </div>
  </div>`;
}

/* 护栏规则：数的是「拦截几类」，不把放行的命令算进去；放行清单默认收起，按词换行，不做胶囊 */
const GUARD = {
  std: [
    ['删除数据卷', ['docker compose down -v', 'docker volume rm', 'docker volume prune']],
    ['删除数据', ['rm -r /var', 'mkfs', 'dropdb', 'redis-cli FLUSHALL']],
    ['重启或关闭主机', ['reboot', 'shutdown', 'systemctl poweroff']],
    ['修改防火墙', ['iptables -A', 'ufw allow', 'firewall-cmd --add-port']],
    ['修改 SSH 配置或停止 sshd', ['/etc/ssh/sshd_config', '~/.ssh/authorized_keys', 'systemctl stop sshd']],
    ['停止或删除标为「关键」的服务', ['docker stop &lt;关键服务&gt;', 'systemctl stop &lt;关键服务&gt;']],
    ['删库、删站或销毁云资源', ['wrangler delete', 'vercel project rm', 'vercel domains rm', 'oci compute instance terminate']],
  ],
  always: [
    ['读取凭据文件', ['cat .env', 'cat ~/.ssh/id_ed25519', 'cat /etc/shadow', 'printenv']],
    ['导出云平台的凭据', ['vercel env pull', 'wrangler secret', '~/.oci/config']],
  ],
  allow: [
    ['系统', ['uptime', 'free', 'df', 'du', 'ls', 'cat', 'head', 'tail', 'grep', 'ps', 'ss', 'ip addr', 'uname', 'hostname', 'lsblk']],
    ['服务与日志', ['systemctl status', 'systemctl is-active', 'systemctl list-units', 'journalctl', 'nginx -t', 'curl -sI']],
    ['Docker', ['docker ps', 'docker logs', 'docker stats --no-stream', 'docker images', 'docker compose ps', 'docker compose logs']],
    ['云平台', ['wrangler whoami', 'wrangler tail', 'vercel ls', 'vercel logs', 'oci … list', 'oci … get']],
  ],
};
function rulesPage() {
  const exs = (list) => `<div class="exs">${list.map((x) => `<code>${x}</code>`).join('')}</div>`;
  const cat = ([name, list]) => `<div class="pref top"><div class="lbl"><b>${name}</b>${exs(list)}</div></div>`;
  return `<div class="page">
    <button class="back" data-act="sub-back">${ic('chevron-left', 'sm')}Agent</button>
    <div class="intro" style="margin-top:10px"><span>护栏装在 Claude Code 上，在命令执行前检查。其他 Agent 没有护栏，只靠红线约束。</span></div>
    <div class="group-head"><h2>标准运维时拦下</h2><span class="n">${GUARD.std.length} 类</span></div>
    <div class="list">${GUARD.std.map(cat).join('')}</div>
    <div class="group-head"><h2>任何档位都拦下</h2><span class="n">${GUARD.always.length} 类</span></div>
    <div class="list">${GUARD.always.map(cat).join('')}</div>
    <div class="group-head"><h2>只读巡检时</h2></div>
    <div class="list">
      <details class="fold"><summary class="pref"><div class="lbl"><b>只放行查看类命令，其余都拦下</b><small>57 条，例如 df、docker ps、journalctl</small></div>${ic('chevron-down', 'xs')}</summary>
        ${GUARD.allow.map(cat).join('')}
      </details>
      <div class="honest">${ic('info', 'sm')}<span>护栏能防手滑，防不了刻意绕过。看不懂的命令：只读巡检时拦下，标准运维时放行，并在动态里标出来。</span></div>
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
/* 2026-11-10 第四轮：常用的留在外面，很少改的收进「高级」；说明只讲结果；SSH 配置正常时一行，出问题才展开 */
function settings() {
  const ssh = S.sshBroken
    ? `<div class="pref warn"><div class="lbl"><b><span class="t-warn">SSH 配置在 WSL Ubuntu-24.04 里还没生效</span></b><small>Agent 在 WSL 里还不能用别名连接服务器。<span class="link" data-act="ssh-manual">${S.sshManual ? '收起' : '想自己加？'}</span></small>
        ${S.sshManual ? `<small>在 WSL 的 ~/.ssh/config 开头加一行 <code class="cmd">Include ~/.ssh/cloudlink.conf</code></small>` : ''}</div><button class="btn sm" data-act="ssh-join">加入</button></div>`
    : `<div class="pref"><div class="lbl"><b>SSH 配置</b><small>Windows、WSL Ubuntu-24.04 都已生效</small></div><button class="btn sm">打开</button></div>`;
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
      <div class="pref"><div class="lbl"><b>自动下载更新</b><small>有新版本时在后台下载好，重启后生效</small></div><span class="when">当前 v0.2.0</span><div class="sw on"></div></div>
    </div>
    <div class="group-head"><h2>数据</h2></div>
    <div class="list">
      ${ssh}
      <div class="pref"><div class="lbl"><b>备份</b><small>覆盖或接管之前的版本都留了一份</small></div><button class="btn sm">打开</button></div>
      <div class="pref"><div class="lbl"><b>活动日志</b><small>测试连接、探测、同步、备份和更新的记录</small></div><button class="btn sm" data-act="log">查看</button></div>
    </div>
    <div class="group-head"><h2>危险操作</h2></div>
    <div class="list">
      <div class="pref"><div class="lbl"><b>停止全部同步</b><small>从所有 Agent 那里撤回 CloudLink 写的 Skill。资源和设置都保留，随时可以重新打开</small></div><button class="btn sm">停止同步…</button></div>
      <div class="pref"><div class="lbl"><b>重置 CloudLink</b><small>删除全部资源、保存的密码、护栏、笔记和记录，回到刚安装的样子。服务器本身和你自己的文件不受影响</small></div><button class="btn sm" style="color:var(--red)">重置…</button></div>
    </div>
    <div class="list" style="margin-top:18px">
      <details class="fold"${S.advOpen ? ' open' : ''}><summary class="pref" data-act="adv"><div class="lbl"><b>高级</b><small>探测、Skill 篇幅、数据目录</small></div>${ic('chevron-down', 'xs')}</summary>
        <div class="pref"><div class="lbl"><b>探测最长等多久</b><small>超过这个时间还没结果，就算探测失败</small></div><div class="field">60 秒${ic('chevron-down', 'xs')}</div></div>
        <div class="pref"><div class="lbl"><b>探测脚本</b><small>探测只读取信息，不会改动服务器</small></div><button class="btn sm">查看</button></div>
        <div class="pref"><div class="lbl"><b>Skill 太长时提醒</b><small>写给 Agent 的内容超过这个长度，会提醒你精简</small></div><div class="field">100 行${ic('chevron-down', 'xs')}</div></div>
        <div class="pref"><div class="lbl"><b>告诉 Agent 信息的采集时间</b><small>Agent 能判断服务器信息是不是过时了</small></div><div class="sw on"></div></div>
        <div class="pref"><div class="lbl"><b>数据目录</b><small class="mono">~/.cloudlink</small></div><button class="btn sm">打开</button></div>
      </details>
    </div>
  </div>`;
}

/* 活动日志：只记 CloudLink 自己做的事；Agent 的命令在「动态」页。筛选是两个下拉，时间对齐成一列 */
const LOG = [
  ['今天', [
    ['refresh-cw', '探测 hk-edge，更新了 3 处', '18:07'],
    ['check', '测试连接 sg-db，成功 · 128 ms', '18:04'],
    ['blocks', 'hk-edge 同步给 Claude Code、通用目录', '18:04'],
    ['wrench', '把 sg-db 切到标准运维', '17:52'],
    ['circle-alert', '测试连接 dev-box 失败：连接超时', '16:20', 'err'],
  ]],
  ['昨天', [
    ['download', '更新到 v0.2.0', '21:15'],
    ['folder-open', '接管 Kiro 的目录前，备份了原来的 Skill', '20:41'],
    ['shield-check', '给 Claude Code 装上护栏', '20:40'],
    ['plus', '添加 Cloudflare', '20:32'],
  ]],
];
function logSheet() {
  if (S.sheet !== 'log') return '';
  const row = ([i, text, when, st]) => `<div class="row log">${ic(i, 'sm')}<span class="txt ${st === 'err' ? 't-err' : ''}">${text}</span><span class="when">${when}</span></div>`;
  return `<div class="scrim side" data-act="scrim"><aside class="sheet" data-stop>
    <header><h3>活动日志</h3><div class="field">全部类型${ic('chevron-down', 'xs')}</div><div class="field">全部资源${ic('chevron-down', 'xs')}</div><button class="ib" data-act="dlg-close">${ic('x')}</button></header>
    <div class="sbody">${LOG.map(([day, rows]) => `<div class="daylabel">${day}</div><div class="list">${rows.map(row).join('')}</div>`).join('')}
      <p class="foot-note">这里只记 CloudLink 自己做的事。Agent 执行了什么命令，在<span class="link" data-nav="activity">动态</span>里看。</p>
    </div></aside></div>`;
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
/* 2026-11-10 第四轮：
   - 类型页改成分组列表（应用已是这样）
   - 表单先选中「密码」；底部不再有「授权给 / 默认档位」，改成一句话说明默认结果
   - 别名露在名称下面，可以直接改
   - 「加入 SSH 配置」是过程里的一步，不再叠一个对话框 */
function aliasOf(name, host) {
  const a = (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (a) return a;
  if (!host) return '';
  return /^[\d.]+$/.test(host) ? 'vps-' + host.replace(/\./g, '-') : host.split('.')[0];
}
const newSsh = () => ({ step: 'ssh', host: '203.0.113.42', port: '22', user: 'root', name: '东京节点', alias: aliasOf('东京节点', '203.0.113.42'), aliasTouched: false, auth: 'password', prod: true });
const AUTH = [['password', '密码'], ['key', '私钥文件'], ['agent', 'ssh-agent']];
function runSteps(d) {
  return [
    { k: 'conn', label: '连接服务器' },
    { k: 'fp', label: '核对主机指纹' },
    ...(d.needInc ? [{ k: 'inc', label: '让 Agent 能用别名连接' }] : []),
    { k: 'key', label: d.auth === 'password' ? '安装免密密钥' : '登录' },
    { k: 'sync', label: '同步给 Agent' },
  ];
}
function addDialog() {
  const d = S.dialog; if (!d) return '';
  let body = '', foot = '', title = '添加', back = false;
  if (d.step === 'types') {
    const t = (id, av, b, s, tag) => `<div class="row click" data-type="${id}">${av}<div class="who"><div class="name">${b}</div><div class="sub">${s}</div></div>${tag ? `<span class="tag">${tag}</span>` : ''}${ic('chevron-right', 'sm chev')}</div>`;
    body = `<div class="types-label">服务器</div><div class="list">
      ${t('ssh', `<div class="tile ssh">${ic('server')}</div>`, 'SSH 服务器', '填地址和密码，自动换成免密密钥')}
      ${t('import', `<div class="tile ssh">${ic('download')}</div>`, '从 ~/.ssh/config 导入', '把已有的主机接进来', '发现 6 台')}
      </div><div class="types-label">云平台</div><div class="list">
      ${t('cf', `<div class="tile">${logo('cloudflare-color')}</div>`, 'Cloudflare', '域名和 Worker', '已登录 · wrangler')}
      ${t('vc', `<div class="tile">${logo('vercel')}</div>`, 'Vercel', '前端和 Serverless 项目', '已登录 · vercel')}
      ${t('oci', `<div class="tile">${logo('oracle')}</div>`, 'Oracle Cloud', '云主机和防火墙', '未安装 oci')}
      </div><div class="types-label">代码托管</div><div class="list">
      ${t('gh', `<div class="tile">${logo('github')}</div>`, 'GitHub', '仓库，以及它们部署到哪里', '已登录 · gh')}
      </div>`;
  } else if (d.step === 'ssh') {
    title = '添加 SSH 服务器'; back = true;
    const auth = {
      password: `<div class="fld"><label>密码</label><input class="inp" type="password" data-f="password" value="${d.password ?? 'password'}"><div class="preview-line">只用这一次。连接后换成免密密钥，密码不会保存。</div></div>`,
      key: `<div class="fld"><label>私钥文件</label><div class="frow"><input class="inp mono" data-f="keyPath" value="${d.keyPath ?? '~/.ssh/id_ed25519'}"><button class="btn" data-act="noop">选择…</button></div><div class="preview-line">WSL 里的 Agent 也要用它时，添加后可以一键复制过去。</div></div>`,
      agent: `<div class="fld"><div class="preview-line" style="margin-top:0">用 ssh-agent 里已经加载的密钥登录。Windows 里有 2 把，WSL 里还没有。</div></div>`,
    }[d.auth];
    body = `<div class="form2">
      <div class="frow"><div class="fld grow"><label>地址</label><input class="inp mono" data-f="host" value="${d.host}" placeholder="203.0.113.10 或 example.com"></div>
        <div class="fld w96"><label>端口</label><input class="inp mono" data-f="port" value="${d.port}"></div></div>
      <div class="frow"><div class="fld w140"><label>用户</label><input class="inp mono" data-f="user" value="${d.user}"></div>
        <div class="fld grow"><label>名称<span class="opt-tag">可选</span></label><input class="inp" data-f="name" value="${d.name}" placeholder="留空就用地址"></div></div>
      <div class="alias-line">Agent 会用 <code class="cmd">ssh</code><input class="inp mono alias-inp" id="fAlias" data-f="alias" value="${d.alias}" placeholder="别名" style="width:${Math.max(8, d.alias.length + 3)}ch" spellcheck="false"> 连接它</div>
      <div class="fld"><label>登录方式</label><div class="seg">${AUTH.map(([k, l]) => `<button class="${d.auth === k ? 'on' : ''}" data-auth="${k}">${l}</button>`).join('')}</div></div>
      ${auth}
      <div class="list inset">
        <div class="pref"><div class="lbl"><b>生产环境</b><small>切到标准运维前会再确认一次</small></div><div class="sw ${d.prod ? 'on' : ''}" data-act="dlg-prod"></div></div>
        <details class="fold"><summary class="pref"><div class="lbl"><b>高级</b><small>跳板机、在哪些运行环境里可用</small></div>${ic('chevron-down', 'xs')}</summary>
          <div class="pref"><div class="lbl"><b>跳板机</b><small>要先经过另一台服务器才能连上时选它</small></div><div class="field">不使用${ic('chevron-down', 'xs')}</div></div>
          <div class="pref"><div class="lbl"><b>在哪些运行环境里可用</b></div><div class="checks"><span class="ck on">${ic('check', 'xs')}</span>Windows<span class="ck on">${ic('check', 'xs')}</span>WSL Ubuntu-24.04</div></div>
        </details>
      </div>
    </div>`;
    foot = `<span class="foot-hint">添加后先是只读巡检，并同步给全部 Agent</span><button class="btn ghost" data-act="dlg-close">取消</button><button class="btn primary" data-act="connect">连接并启用</button>`;
  } else if (d.step === 'run') {
    title = `连接 ${d.alias}`;
    const paused = {
      fp: `<div class="fp"><span>第一次连接这台服务器，请核对指纹：</span><code>SHA256:Yx3pV1m8qNfK0dT7uZbLe2QhR5cWsJ9aGiE4oXkP6nA</code><div><button class="btn primary sm" data-act="trust">指纹一致，继续</button> <button class="btn ghost sm" data-act="dlg-back-form">返回修改</button></div></div>`,
      inc: `<div class="fp"><span>要让 Agent 用 <code class="cmd">ssh ${d.alias}</code> 连上，需要在你的 SSH 配置开头加一行。只问这一次。</span>
        <details class="more"><summary class="link">了解详情</summary><div>在 Windows 和 WSL Ubuntu-24.04 的 ~/.ssh/config 开头加入 <code class="cmd">Include ~/.ssh/cloudlink.conf</code>。修改前会先备份，其余内容不动。</div></details>
        <div><button class="btn primary sm" data-act="inc-ok">加入</button> <button class="btn ghost sm" data-act="inc-skip">暂不加入</button></div></div>`,
    };
    body = `<div class="steps">${runSteps(d).map((s, i) => {
      const st = i < d.at ? 'done' : i === d.at ? 'now' : '';
      const waiting = st === 'now' && d.wait;
      const skipped = s.k === 'inc' && d.inc === 'skip' && st === 'done';
      const si = skipped ? '<span class="dot off"></span>' : st === 'done' ? ic('check', 'sm') : st === 'now' ? (waiting ? ic(s.k === 'fp' ? 'key-round' : 'file-text', 'sm') : '<span class="spin"></span>') : '<span class="dot off"></span>';
      return `<div class="step ${skipped ? '' : st}"><span class="si">${si}</span>${s.label}${skipped ? '<span class="when">暂不加入</span>' : ''}</div>${waiting ? paused[s.k] || '' : ''}`;
    }).join('')}</div>`;
  }
  return `<div class="scrim" data-act="scrim"><div class="dialog${d.step === 'types' ? '' : ' fixed'}" data-stop>
    <header>${back ? `<button class="ib" data-act="dlg-back" data-tip="返回">${ic('chevron-left')}</button>` : ''}<h3>${title}</h3><button class="ib" data-act="dlg-close">${ic('x')}</button></header>
    <div class="dbody">${body}</div>${foot ? `<footer>${foot}</footer>` : ''}</div></div>`;
}
/* 过程往前走一步；走到「核对指纹」「加入 SSH 配置」时停下来等人 */
function advance(d) {
  if (S.dialog !== d || d.step !== 'run') return;
  const steps = runSteps(d);
  d.at += 1; d.wait = false;
  if (d.at >= steps.length) return finishAdd(d);
  const k = steps[d.at].k;
  if (k === 'fp' || k === 'inc') { d.wait = true; return calm(render); }
  calm(render); setTimeout(() => advance(d), 900);
}
function finishAdd(d) {
  const skipped = d.inc === 'skip';
  const targets = skipped ? [] : TARGETS.filter((t) => S.data.agents[t.id]).map((t) => t.id);
  const name = d.name.trim() || d.host;
  S.data.resources = S.data.resources.filter((r) => r.id !== 'tk');
  S.data.resources.splice(2, 0, { id: 'tk', kind: 'ssh', name, alias: d.alias, env: d.prod ? 'prod' : 'dev', mode: 'ro', meta: 'Ubuntu 24.04', targets,
    status: skipped ? 'warn' : 'ok', warn: 'Agent 还连不上', fix: skipped ? '加入 SSH 配置' : null,
    addr: `${d.user}@${d.host}:${d.port}`, auth: d.auth === 'agent' ? 'ssh-agent' : `私钥 · ~/.ssh/cloudlink_${d.alias.replace(/-/g, '_')}`, jump: '无', purpose: '', sites: [], rules: [] });
  if (d.inc === 'ok') S.data.include = true;
  if (skipped) S.sshBroken = true;
  S.dialog = null; S.empty = false; S.view = 'resources'; S.detail = null; S.sub = null; S.flash = 'tk';
  toast(skipped ? `${name}已添加。加入 SSH 配置后才会同步给 Agent` : `${name}已添加，并同步给 ${targets.length} 个目录`);
  setTimeout(() => { S.flash = null; }, 2400);
}
const toastEl = () => S.toast ? `<div class="toast">${S.toast.msg}${S.toast.undo ? `<button class="btn sm" data-act="undo">撤销</button>` : ''}</div>` : '';

function tray() {
  if (!S.tray) return '';
  const ssh = S.data.resources.filter((r) => r.mode);
  const hot = ssh.filter((r) => r.env === 'prod' && r.mode === 'rw').length;
  return `<div class="tray"><div class="th">CloudLink<small><span class="dot ok"></span>护栏运行中</small></div>
    <div class="tsec">档位</div>
    ${ssh.map((r) => `<div class="ti" data-tray="${r.id}">${r.alias || r.name}<span class="r ${r.env === 'prod' && r.mode === 'rw' ? 'hot' : ''}">${MODE[r.mode]}${ic('chevron-right', 'xs')}</span></div>`).join('')}
    <hr><div class="ti" data-act="all-ro">生产资源全部切回只读${hot ? `<span class="r hot">${hot} 台在运维档</span>` : ''}</div>
    <hr><div class="ti" data-act="tray-open">打开 CloudLink</div><div class="ti">退出</div></div>`;
}

/* ── 原型控制 ───────────────────────────────────────── */
function proto() {
  return `<h4>原型控制</h4>
    <label>主题<span class="seg"><button class="${S.theme === 'light' ? 'on' : ''}" data-theme="light">浅</button><button class="${S.theme === 'dark' ? 'on' : ''}" data-theme="dark">深</button></span></label>
    <label>导航<span class="seg"><button class="${S.layout === 'top' ? 'on' : ''}" data-layout="top">顶栏</button><button class="${S.layout === 'side' ? 'on' : ''}" data-layout="side">侧栏</button></span></label>
    <label>空状态<span class="sw ${S.empty ? 'on' : ''}" data-act="toggle-empty"></span></label>
    <label>托盘菜单<span class="sw ${S.tray ? 'on' : ''}" data-act="toggle-tray"></span></label>
    <label>SSH 配置没生效<span class="sw ${S.sshBroken ? 'on' : ''}" data-act="toggle-ssh"></span></label>
    <button class="btn" data-act="reset">重置数据</button>
    <p>可以试：点档位文字切换；点 Agent 图标同步；点一行进详情；点 + 走添加流程（第一次会问要不要加入 SSH 配置）；Agent → 护栏规则；设置 → 活动日志、高级。</p>`;
}

/* ── 渲染与事件 ─────────────────────────────────────── */
function render() {
  document.documentElement.dataset.theme = S.theme;
  const win = $('#win');
  const scroll = $('.content', win)?.scrollTop || 0;
  win.className = 'window' + (S.layout === 'side' ? ' side' : '');
  win.innerHTML = shell() + modePop() + addDialog() + logSheet() + toastEl();
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
  if ((el = q('[data-nav]'))) return go(() => { S.view = el.dataset.nav; S.detail = null; S.pop = null; S.sub = null; S.sheet = null; });
  if ((el = q('[data-auth]'))) { S.dialog.auth = el.dataset.auth; return calm(render); }
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
    if (el.dataset.type === 'ssh') { S.dialog = newSsh(); return calm(render); }
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
      'add-ssh'() { S.dialog = newSsh(); calm(render); },
      import() { toast('原型只演示 SSH 服务器这条流程'); },
      copy() { toast('已复制'); },
      back() { S.detail = null; render(); },
      test() {
        const r = res(el.dataset.id); e.stopPropagation();
        if (r.status === 'unverified') { r.status = 'ok'; r.auth = '私钥 · ~/.ssh/cloudlink_dev_box'; r.meta = 'Ubuntu 24.04'; calm(() => toast(`${r.alias} 连接成功，已换成免密密钥`)); }
        else calm(() => toast(`${r.alias || r.name} 连接成功 · 128 ms`));
      },
      fix() {
        e.stopPropagation(); const r = res(el.dataset.id); r.status = 'ok'; r.fix = null;
        if (r.id !== 'tk') return calm(() => toast('已打开终端，登录后自动刷新'));
        S.data.include = true; S.sshBroken = false; r.targets = TARGETS.filter((t) => S.data.agents[t.id]).map((t) => t.id);
        calm(() => toast(`已加入 SSH 配置，${r.name}已同步给 ${r.targets.length} 个目录`));
      },
      copykey() { toast('私钥已复制到 WSL Ubuntu-24.04'); },
      takeover() { S.data.kiroConflict = false; calm(() => toast('旧版已备份，Kiro 已同步', () => { S.data.kiroConflict = true; })); },
      guard() { S.view = 'activity'; render(); },
      fold() { S.foldOthers = !S.foldOthers; calm(render); },
      rules() { S.sub = 'rules'; render(); $('.content').scrollTop = 0; },
      'sub-back'() { S.sub = null; render(); },
      log() { S.sheet = 'log'; calm(render); },
      adv() { S.advOpen = !S.advOpen; },
      'ssh-manual'() { S.sshManual = !S.sshManual; calm(render); },
      'ssh-join'() { S.sshBroken = false; S.sshManual = false; S.data.include = true; calm(() => toast('已加入，WSL 里的 Agent 现在可以连接了', () => { S.sshBroken = true; })); },
      'toggle-ssh'() { S.sshBroken = !S.sshBroken; S.view = 'settings'; S.detail = null; S.sub = null; render(); },
      'pop-cancel'() { S.pop = null; calm(render); },
      'dlg-close'() { S.dialog = null; S.sheet = null; calm(render); },
      scrim() { S.dialog = null; S.sheet = null; calm(render); },
      'dlg-back'() { S.dialog = { step: 'types' }; calm(render); },
      'dlg-back-form'() { S.dialog = { ...S.dialog, step: 'ssh' }; calm(render); },
      'dlg-prod'() { S.dialog.prod = !S.dialog.prod; calm(render); },
      connect() {
        const d = S.dialog = { ...S.dialog, step: 'run', at: 0, wait: false, inc: null, needInc: !S.data.include };
        if (!d.alias) d.alias = aliasOf(d.name, d.host) || 'server';
        calm(render); setTimeout(() => advance(d), 900);
      },
      trust() { advance(S.dialog); },
      'inc-ok'() { S.dialog.inc = 'ok'; advance(S.dialog); },
      'inc-skip'() { S.dialog.inc = 'skip'; advance(S.dialog); },
      undo() { const u = S.toast?.undo; if (u) u(); S.toast = null; calm(render); },
      'toggle-empty'() { S.empty = !S.empty; S.view = 'resources'; S.detail = null; render(); },
      'toggle-tray'() { S.tray = !S.tray; calm(render); },
      'all-ro'() {
        const hot = S.data.resources.filter((r) => r.mode === 'rw' && r.env === 'prod'); hot.forEach((r) => { r.mode = 'ro'; });
        calm(() => toast(hot.length ? `${hot.length} 台生产服务器已切回只读` : '生产服务器都在只读档', hot.length ? () => hot.forEach((r) => { r.mode = 'rw'; }) : null));
      },
      'tray-open'() { S.tray = false; calm(render); },
      reset() { S.data = seed(); S.detail = null; S.view = 'resources'; S.pop = null; S.dialog = null; S.toast = null; S.sub = null; S.sheet = null; S.sshBroken = false; S.sshManual = false; S.advOpen = false; S.flash = null; render(); },
    };
    if (acts[a]) return acts[a]();
  }
  if ((el = q('[data-open]'))) return go(() => { S.detail = el.dataset.open; S.pop = null; });
  if (S.pop && !q('.pop')) { S.pop = null; calm(render); }
});

/* 表单输入不重绘（会丢焦点）：只记到状态里；别名没被手改过时，跟着名称和地址变 */
document.addEventListener('input', (e) => {
  const f = e.target.dataset?.f; const d = S.dialog;
  if (!f || !d) return;
  d[f] = e.target.value;
  const a = $('#fAlias');
  if (f === 'alias') d.aliasTouched = true;
  else if ((f === 'name' || f === 'host') && !d.aliasTouched && a) { d.alias = aliasOf(d.name, d.host); a.value = d.alias; }
  if (a) a.style.width = `${Math.max(8, d.alias.length + 3)}ch`;
});
/* 在对话框里展开「高级」时，把它滚进视野 */
document.addEventListener('toggle', (e) => {
  if (e.target.open && e.target.closest?.('.dialog')) e.target.scrollIntoView({ block: 'end' });
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (S.dialog) S.dialog = null; else if (S.sheet) S.sheet = null; else if (S.pop) S.pop = null; else if (S.detail) S.detail = null; else if (S.sub) S.sub = null; render(); }
  if (e.key === 'Enter' && e.target.dataset?.open) { S.detail = e.target.dataset.open; render(); }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); S.layout = S.layout === 'top' ? 'side' : 'top'; render(); }
  if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); S.dialog = { step: 'types' }; calm(render); }
});

render();
