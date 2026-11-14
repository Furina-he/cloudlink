/* P8 当前页编辑弹窗：仅维护原型内存中的假数据，不读取文件、不连接服务器。 */
function profileDraft(r) {
  const d = { name: r.name, purpose: r.purpose || '', notes: r.notes || '', rules: structuredClone(r.rules || []) };
  if (r.kind === 'ssh') Object.assign(d, {
    sites: (r.sites || []).join('\n'), tags: (r.tags || []).join('，'), provider: r.provider || '', region: r.region || '',
    services: structuredClone(r.services || []), paths: structuredClone(r.paths || []),
  });
  return d;
}
function connectionDraft(r) {
  const address = r.addr.match(/^([^@]+)@(.+):(\d+)$/);
  const d = r.connection ? structuredClone(r.connection) : {
    alias: r.alias, host: address?.[2] || '', port: address?.[3] || '22', user: address?.[1] || '',
    method: r.auth.startsWith('密码') ? 'password' : r.auth.startsWith('ssh-agent') ? 'agent' : 'key',
    keyPath: r.auth.split(' · ')[1] || '', jump: r.jump === '无' ? '' : r.jump,
    exportConnection: false, exportPorts: false,
  };
  return { ...d, port: String(d.port), password: '' };
}
function openResourceEditor(id, kind) {
  const r = res(id); if (!r || kind === 'connection' && r.kind !== 'ssh') return;
  const draft = kind === 'profile' ? profileDraft(r) : kind === 'github' ? githubDraft(r) : connectionDraft(r);
  const returnFocus = S.pop?.kind === 'detail' || kind === 'profile' ? '.dhead [data-act="detail-menu"]' : kind === 'github' ? `[data-gh-act="manage"][data-id="${id}"]` : `[data-act="edit-connection"][data-id="${id}"]`;
  S.editor = { id, kind, draft, initial: JSON.stringify(draft), errors: {}, error: '', open: {}, confirmLeave: false, returnFocus, scroll: $('.content')?.scrollTop || 0 };
  if (kind === 'profile' && S.rename?.id === id) { draft.name = S.rename.value; S.rename = null; }
  S.pop = null; S.toast = null;
  calm(render);
  $('#editor-title')?.focus({ preventScroll: true });
}
function editorDirty() { return !!S.editor && JSON.stringify(S.editor.draft) !== S.editor.initial; }
function editorCanSave() { return S.editor?.kind === 'github-add' || editorDirty(); }
function editorValue(key) { return key.split('.').reduce((v, k) => v[k], S.editor.draft); }
function editorSetValue(key, value) {
  const keys = key.split('.'), last = keys.pop();
  const parent = keys.reduce((v, k) => v[k], S.editor.draft);
  parent[last] = value;
  delete S.editor.errors[key];
  refreshEditorFeedback();
}
function editorField(key, label, opts = {}) {
  const value = editorValue(key), error = S.editor.errors[key], id = 'edit-' + key.replaceAll('.', '-');
  const attrs = `id="${id}" data-editor-field="${key}" aria-invalid="${!!error}" aria-describedby="${id}-error"`;
  const control = opts.area
    ? `<textarea class="inp edit-area${opts.mono ? ' mono' : ''}" ${attrs} rows="${opts.rows || 3}" spellcheck="false">${esc(value)}</textarea>`
    : `<input class="inp${opts.mono ? ' mono' : ''}" ${attrs} type="${opts.password ? 'password' : 'text'}" ${opts.numeric ? 'inputmode="numeric"' : ''} value="${esc(value)}" autocomplete="off" spellcheck="false">`;
  const field = opts.copy ? `<div class="frow">${control}<button type="button" class="ib" aria-label="复制 ${label}" data-tip="复制 ${label}" data-editor-copy="${key}">${ic('copy', 'sm')}</button></div>` : control;
  return `<div class="edit-field${opts.full ? ' full' : ''}"><label for="${id}">${label}</label>${field}${opts.hint ? `<small>${opts.hint}</small>` : ''}<span class="edit-field-error" id="${id}-error" data-error-for="${key}" ${error ? '' : 'hidden'}>${esc(error || '')}</span></div>`;
}
function editorFold(key, label, hint, content) {
  return `<details class="list fold edit-fold" data-editor-fold="${key}" ${S.editor.open[key] ? 'open' : ''}>
    <summary class="pref"><div class="lbl"><b>${label}</b><small>${hint}</small></div>${ic('chevron-down', 'xs')}</summary>${content}</details>`;
}
function editorRows(kind) {
  const rows = S.editor.draft[kind];
  if (!rows.length) return '<p class="edit-empty">还没有记录，按需添加。</p>';
  return rows.map((row, i) => {
    const remove = `<button type="button" class="ib" aria-label="删除第 ${i + 1} ${kind === 'services' ? '个服务记录' : kind === 'paths' ? '个目录' : '条红线'}" data-editor-remove="${kind}:${i}">${ic('x', 'sm')}</button>`;
    if (kind === 'rules') return `<div class="edit-entry edit-rule"><span class="edit-index">${i + 1}</span>${editorField(`rules.${i}`, `红线 ${i + 1}`, { area: true, rows: 2 })}${remove}</div>`;
    if (kind === 'paths') return `<div class="edit-entry edit-path"><div class="edit-grid">${editorField(`paths.${i}.0`, `目录名称 ${i + 1}`)}${editorField(`paths.${i}.1`, `目录路径 ${i + 1}`, { mono: true })}</div>${remove}</div>`;
    const manual = row[6] === 'manual';
    const name = manual ? editorField(`services.${i}.0`, `服务名称 ${i + 1}`) : `<div class="edit-service-name"><b>${esc(row[0])}</b><small>${esc(row[1])} · 探测发现</small></div>`;
    return `<div class="edit-entry edit-service">${name}${editorField(`services.${i}.4`, `服务用途 ${i + 1}`)}<div class="edit-critical"><span>关键</span><button type="button" class="sw ${row[5] ? 'on' : ''}" role="switch" aria-label="关键服务 ${i + 1}" aria-checked="${!!row[5]}" data-editor-critical="${i}"></button></div>${remove}</div>`;
  }).join('');
}
function editorList(kind, label) {
  return `<div class="edit-list-head"><h3>${label}</h3><button type="button" class="btn ghost sm" data-editor-add="${kind}">${ic('plus', 'xs')}添加${kind === 'services' ? '服务记录' : kind === 'paths' ? '目录' : '红线'}</button></div><div id="edit-list-${kind}">${editorRows(kind)}</div>`;
}
function profileEditor(r) {
  const basic = `<section class="edit-section"><h2>基本信息</h2><div class="list edit-grid">${editorField('name', '名称', { full: true })}${editorField('purpose', '用途', { area: true, full: true })}${r.kind === 'ssh' ? editorField('sites', '承载的站点', { area: true, rows: 2, mono: true, full: true, hint: '每行一个域名。站点出问题时，Agent 能找到这台服务器。' }) : ''}</div></section>`;
  const extra = r.kind === 'ssh' ? editorFold('more', '更多信息', '标签、云厂商、地域', `<div class="edit-grid">${editorField('tags', '标签', { full: true, hint: '多个标签用逗号分隔。' })}${editorField('provider', '云厂商')}${editorField('region', '地域')}</div>`) : '';
  const inventory = r.kind === 'ssh' ? editorFold('inventory', '服务与目录', `${S.editor.draft.services.length} 个服务记录 · ${S.editor.draft.paths.length} 个目录`, `<p class="edit-note">这里只修改资料，不会创建、停止或删除远端服务。探测到的名称、镜像和端口不在这里改。</p>${editorList('services', '服务')}${editorList('paths', '关键目录')}`) : '';
  return `${basic}${extra}${inventory}<section class="edit-section"><h2>红线与笔记</h2><div class="list">${editorList('rules', '红线')}<div class="edit-grid edit-divider">${editorField('notes', '笔记', { area: true, rows: 4, full: true })}</div></div></section>`;
}
function connectionEditor() {
  const d = S.editor.draft;
  const login = d.method === 'key' ? editorField('keyPath', '私钥文件', { mono: true, full: true, hint: '填写现有私钥的位置，不会移动或覆盖这个文件。' }) : d.method === 'password' ? editorField('password', '密码', { password: true, full: true, hint: '留空保持原凭据；改了地址、端口或用户后，需要重新输入。原型不会保存密码。' }) : '<p class="edit-note full">使用 ssh-agent 中已经加载的密钥。</p>';
  const auth = `<div class="edit-field full"><span class="edit-label" id="edit-method-label">登录方式</span><div class="seg" role="group" aria-labelledby="edit-method-label">${AUTH.map(([k, label]) => `<button type="button" class="${d.method === k ? 'on' : ''}" aria-pressed="${d.method === k}" data-editor-method="${k}">${label}</button>`).join('')}</div></div>`;
  return `<section class="edit-section"><h2>连接信息</h2><div class="list edit-grid edit-connection-grid">${editorField('host', '地址', { mono: true })}${editorField('port', '端口', { numeric: true })}${editorField('user', '登录用户', { mono: true, full: true })}${auth}<div id="edit-login-fields" class="full">${login}</div></div></section>
    ${editorFold('connection', '高级', 'SSH 别名、跳板机、提供给 Agent 的连接信息', `<div class="edit-grid">${editorField('alias', 'SSH 别名', { mono: true, full: true, copy: true, hint: '终端连接时使用，改名称不会改变它。修改别名后，已有命令和脚本也要相应调整。' })}${editorField('jump', '跳板机别名', { mono: true, full: true, hint: '不需要跳板机时留空。' })}<label class="edit-check full"><input type="checkbox" data-editor-field="exportConnection" ${d.exportConnection ? 'checked' : ''}>向 Agent 提供地址、端口和登录用户</label><label class="edit-check full"><input type="checkbox" data-editor-field="exportPorts" ${d.exportPorts ? 'checked' : ''}>向 Agent 提供监听端口</label></div>`)}`;
}
function resourceEditorDialog() {
  const e = S.editor; if (!e) return '';
  const r = e.resource || res(e.id), profile = e.kind === 'profile', github = e.kind.startsWith('github'), adding = e.kind === 'github-add';
  const title = profile ? '编辑资料' : github ? adding ? '接入 GitHub' : '管理仓库范围' : '编辑连接';
  const hint = profile ? '只更新资料，不改变连接和权限' : github ? adding ? '默认只读，同步给已启用的 Agent' : '保存后更新仓库信息，档位和 Agent 选择不变' : '连接改动后需要重新验证';
  const save = profile ? '保存修改' : github ? adding ? '保存并启用' : '保存范围' : '保存连接';
  const footer = e.confirmLeave
    ? `<div data-editor-leave><span class="editor-foot-hint" role="alert">修改尚未保存，是否放弃？</span><button type="button" class="btn ghost" data-act="editor-keep">继续编辑</button><button type="button" class="btn primary" data-act="editor-discard">放弃修改</button></div>`
    : `<div><span class="editor-foot-hint">${hint}</span><button type="button" class="btn ghost" data-act="editor-back">取消</button><button type="button" class="btn primary" data-act="editor-save" ${editorCanSave() ? '' : 'disabled'}>${save}</button></div>`;
  return `<div class="editor-scrim" data-act="editor-back"><section class="resource-editor" id="resource-editor-dialog" data-editor-stop role="dialog" aria-modal="true" aria-labelledby="editor-title" aria-describedby="editor-resource">
    <header class="editor-heading"><div><h1 id="editor-title" tabindex="-1">${title}</h1><p id="editor-resource">${esc(r.name)}${r.alias || r.github?.owner ? ` <span class="mono">${esc(r.alias || r.github.owner)}</span>` : ''}</p></div><button class="ib" aria-label="关闭编辑" data-act="editor-back">${ic('x')}</button></header>
    <div class="editor-scroll" ${e.confirmLeave ? 'inert' : ''}><div class="editor-inner"><div class="editor-alert" role="alert" ${e.error ? '' : 'hidden'}>${esc(e.error)}</div>${profile ? profileEditor(r) : github ? githubScopeEditor(r) : connectionEditor()}</div></div>
    <footer class="editor-footer">${footer}</footer>
  </section></div>`;
}
function refreshEditorFeedback() {
  const e = S.editor; if (!e) return;
  document.querySelectorAll('[data-editor-field]').forEach((input) => {
    const key = input.dataset.editorField, error = e.errors[key];
    input.setAttribute('aria-invalid', String(!!error));
    const hint = document.querySelector(`[data-error-for="${key}"]`);
    if (hint) { hint.textContent = error || ''; hint.hidden = !error; }
  });
  const alert = $('.editor-alert'); if (alert) { alert.textContent = e.error; alert.hidden = !e.error; }
  const save = $('[data-act="editor-save"]'); if (save) save.disabled = !editorCanSave();
}
function editorListChange(kind, index) {
  const rows = S.editor.draft[kind];
  if (index == null) rows.push(kind === 'rules' ? '' : kind === 'paths' ? ['', ''] : ['', '手动记录', '—', '—', '', false, 'manual']);
  else rows.splice(index, 1);
  S.editor.errors = {};
  $(`#edit-list-${kind}`).innerHTML = editorRows(kind);
  refreshEditorFeedback();
  if (index == null) $(`#edit-list-${kind} .edit-entry:last-child input, #edit-list-${kind} .edit-entry:last-child textarea`)?.focus();
  else $(`[data-editor-add="${kind}"]`)?.focus({ preventScroll: true });
}
function editorMethod(method) {
  S.editor.draft.method = method; S.editor.draft.password = ''; S.editor.errors = {};
  renderEditorInPlace();
  $(`[data-editor-method="${method}"]`)?.focus({ preventScroll: true });
}
function renderEditorInPlace() {
  const scroll = $('.editor-scroll')?.scrollTop || 0;
  calm(render); $('.editor-scroll').scrollTop = scroll;
}
function closeResourceEditor(message) {
  const scroll = S.editor?.scroll || 0, returnFocus = S.editor?.returnFocus;
  S.editor = null; S.editorLeave = null; S.dialog = null;
  calm(render); $('.content').scrollTop = scroll;
  if (returnFocus) $(returnFocus)?.focus({ preventScroll: true });
  if (message) toast(message, null, false);
}
function requestEditorLeave(next = () => closeResourceEditor()) {
  if (!editorDirty()) return next();
  S.editorLeave = next; S.editor.confirmLeave = true;
  renderEditorInPlace(); $('[data-act="editor-keep"]')?.focus({ preventScroll: true });
}
function editorDiscard() {
  const next = S.editorLeave;
  S.editorLeave = null; S.dialog = null;
  if (next) next();
}
function editorKeep() {
  S.editorLeave = null; S.editor.confirmLeave = false; renderEditorInPlace();
  $('#editor-title')?.focus({ preventScroll: true });
}
function navigateFromEditor(next) {
  requestEditorLeave(() => { S.editor = null; S.editorLeave = null; S.dialog = null; next(); });
}
function editorValidate() {
  const e = S.editor, d = e.draft, errors = {};
  if (e.kind.startsWith('github')) return githubValidateScope(e.resource || res(e.id), d);
  if (e.kind === 'profile') {
    if (!d.name.trim()) errors.name = '请填写名称。';
    d.rules.forEach((text, i) => { if (!text.trim()) errors[`rules.${i}`] = '请填写红线，或删除这一条。'; });
    d.paths?.forEach((row, i) => { if (!row[0].trim()) errors[`paths.${i}.0`] = '请填写目录名称。'; if (!row[1].trim()) errors[`paths.${i}.1`] = '请填写目录路径。'; });
    d.services?.forEach((row, i) => { if (!row[0].trim()) errors[`services.${i}.0`] = '请填写服务名称。'; });
  } else {
    const old = JSON.parse(e.initial);
    if (!d.host.trim() || /\s/.test(d.host.trim()) || d.host.startsWith('-')) errors.host = '请填写 IP 或域名，不包含空格。';
    if (!/^\d+$/.test(d.port) || +d.port < 1 || +d.port > 65535) errors.port = '端口应为 1–65535。';
    if (!d.user.trim() || /\s/.test(d.user.trim()) || d.user.startsWith('-')) errors.user = '请填写有效的登录用户。';
    const aliasError = sshAliasError(d.alias, e.id);
    if (aliasError) errors.alias = aliasError;
    if (d.method === 'key' && !d.keyPath.trim()) errors.keyPath = '请填写私钥文件路径。';
    if (d.method === 'password' && !d.password && ['host', 'port', 'user', 'method'].some((key) => d[key] !== old[key])) errors.password = '连接目标或登录方式已改变，请重新输入密码。';
    if (d.jump.trim() && !S.data.resources.some((r) => r.id !== e.id && r.alias === d.jump.trim())) errors.jump = '请填写另一台已接入服务器的别名，或留空。';
  }
  e.errors = errors; e.error = '';
  refreshEditorFeedback();
  const first = Object.keys(errors)[0];
  if (first) {
    const input = document.querySelector(`[data-editor-field="${first}"]`);
    for (let parent = input?.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
    input?.focus({ preventScroll: true }); input?.scrollIntoView({ block: 'center' });
    return false;
  }
  return true;
}
function saveResourceEditor() {
  const e = S.editor; if (!e || e.confirmLeave || !editorCanSave() || !editorValidate()) return;
  if (S.renameFailure) {
    e.error = e.kind === 'profile' ? '资料未保存。修改仍保留在这里，请重试。' : e.kind.startsWith('github') ? '范围未保存。修改仍保留在这里，请重试。' : '连接未保存。修改仍保留在这里，请重试。';
    refreshEditorFeedback(); $('.editor-alert')?.scrollIntoView({ block: 'nearest' }); return;
  }
  const r = e.resource || res(e.id), d = e.draft;
  if (e.kind.startsWith('github')) return githubSaveScope(r, d);
  if (e.kind === 'profile') {
    Object.assign(r, { name: d.name.trim(), purpose: d.purpose.trim(), notes: d.notes, rules: d.rules.map((x) => x.trim()) });
    if (r.kind === 'ssh') Object.assign(r, {
      sites: d.sites.split(/[\n,，]+/).map((x) => x.trim()).filter(Boolean), tags: d.tags.split(/[,，\n]+/).map((x) => x.trim()).filter(Boolean),
      provider: d.provider.trim(), region: d.region.trim(), services: structuredClone(d.services), paths: d.paths.map((row) => row.map((x) => x.trim())), ports: r.ports || [],
    });
    closeResourceEditor('资料已保存');
  } else {
    const old = JSON.parse(e.initial);
    const changed = ['alias', 'host', 'port', 'user', 'method', 'keyPath', 'jump'].some((key) => d[key] !== old[key]) || !!d.password;
    const { password, ...connection } = d; // 密码不放进原型资源数据，也不回显。
    r.connection = { ...connection, port: Number(d.port) };
    r.alias = d.alias; r.addr = `${d.user.trim()}@${d.host.trim()}:${Number(d.port)}`;
    r.auth = d.method === 'key' ? `私钥 · ${d.keyPath.trim()}` : d.method === 'password' ? '密码' : 'ssh-agent';
    r.jump = d.jump.trim() || '无';
    if (changed) { r.status = 'unverified'; r.connectionChanged = true; }
    closeResourceEditor(changed ? '连接已保存。测试通过后恢复原来的同步范围。' : '连接选项已保存');
  }
}
