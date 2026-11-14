/* P8 GitHub 范围原型：全部为内存假数据，不运行 gh、不读取登录态。 */
const GH_OWNERS = [
  { login: 'Furina-he', kind: '个人账号' },
  { login: 'example-team', kind: '组织' },
  { login: 'demo-lab', kind: '组织' },
];
function githubCatalog(owner) {
  const names = owner === 'Furina-he' ? ['cloudlink', 'blog', 'ops-notes', 'sandbox'] : ['api', 'web', 'docs', 'sandbox'];
  return names.map((name, i) => ({ id: `${owner}:repo-${i + 1}`, name: `${owner}/${name}`, branch: i === 3 ? 'develop' : 'main', visibility: i === 0 || i === 2 ? '公开' : '私有', deployment: i === 1 ? 'Vercel' : i === 0 && owner !== 'Furina-he' ? '香港边缘节点' : '—' }));
}
function githubResource(owner, id = `github-${owner}`) {
  return { id, kind: 'cli', logo: 'github', name: 'GitHub', account: 'Furina-he', status: 'ok', mode: 'ro', env: 'prod', targets: ['claude', 'common'], meta: '4 个仓库',
    github: { owner, mode: 'auto', excludedIds: [], selectedIds: [], repos: githubCatalog(owner), state: 'ready' } };
}
function githubDraft(r) {
  const { mode, excludedIds, selectedIds } = r.github;
  return { mode, excludedIds: [...excludedIds], selectedIds: [...selectedIds] };
}
const githubIncluded = (scope, repos) => repos.filter((repo) => scope.mode === 'auto' ? !scope.excludedIds.includes(repo.id) : scope.selectedIds.includes(repo.id));
const githubStateLabel = (state) => ({ partial: '部分结果', offline: '无法刷新', denied: '权限不足', loading: '刷新中' })[state] || '';
function githubProblem(state) {
  return {
    partial: ['仓库列表不完整', '部分结果未取回。先保留上次记录，不把缺少的仓库当作已删除。'],
    offline: ['暂时无法刷新', '当前显示上次记录。恢复网络后重试，不会清空原来的范围。'],
    denied: ['当前身份无权访问此归属', '下方仅保留历史记录。先在 GitHub 检查账号授权，再重新检测；更改范围不能修复权限。'],
  }[state];
}
function githubRows(r, query = '') {
  const repos = githubIncluded(r.github, r.github.repos).filter((repo) => repo.name.toLowerCase().includes(query.trim().toLowerCase()));
  if (!repos.length) return `<div class="gh-empty">${query ? '没有匹配的仓库，试试其他名称。' : r.github.mode === 'manual' ? '还没有选择仓库。通过“管理范围”添加。' : '当前没有纳入的仓库。可检查排除项，或等待新仓库出现。'}</div>`;
  return `<table class="gh-repos"><thead><tr><th>仓库</th><th>默认分支</th><th>可见性</th><th>部署目标</th></tr></thead><tbody>${repos.map((repo) => `<tr><td>${esc(repo.name)}</td><td>${esc(repo.branch)}</td><td>${repo.visibility}</td><td>${repo.deployment === '—' ? '—' : `<span data-tip="${repo.deployment === 'Vercel' ? '来源：Vercel 项目绑定' : '来源：已登记工作目录的 Git remote'}；原型示例。关系不改变授权。">${esc(repo.deployment)}</span>`}</td></tr>`).join('')}</tbody></table>`;
}
function githubDetails(r) {
  const g = r.github, problem = githubProblem(g.state), count = githubIncluded(g, g.repos).length;
  return `<div class="group-head"><h2>仓库范围</h2><div class="right"><button class="btn ghost sm" data-gh-act="manage" data-id="${r.id}">${ic('pencil', 'xs')}管理范围</button></div></div>
    <div class="list">
      <div class="pref"><div class="lbl"><b>归属</b><small>${GH_OWNERS.find((o) => o.login === g.owner)?.kind || '账号／组织'} · 使用 ${esc(r.account)} 登录</small></div><div class="val">${esc(g.owner)}</div></div>
      <div class="pref"><div class="lbl"><b>${g.mode === 'auto' ? '自动跟随' : '手动选择'}</b><small>${g.mode === 'auto' ? '包括以后新增且有权访问的仓库；写操作仍按档位判断' : '只提供选中的仓库；以后新增的仓库不会自动纳入'}</small></div><span class="gh-value">${g.mode === 'auto' ? `排除 ${g.excludedIds.length} 个` : `选择 ${g.selectedIds.length} 个`}</span></div>
      ${problem ? `<div class="pref warn"><div class="lbl"><b>${problem[0]}</b><small>${problem[1]}</small></div><button class="btn sm" data-gh-act="refresh" data-id="${r.id}">重试</button></div>` : ''}
    </div>
    <div class="group-head"><h2>${g.state === 'ready' ? '仓库' : '上次记录'}</h2><span class="n">${count}</span><div class="right"><button class="btn ghost sm" data-gh-act="refresh" data-id="${r.id}" ${g.state === 'loading' ? 'disabled' : ''}>${ic('refresh-cw', 'xs')}${g.state === 'loading' ? '刷新中' : '刷新'}</button></div></div>
    <div class="list"><div class="gh-search"><label class="sr-only" for="gh-list-search">搜索仓库</label><input class="inp" id="gh-list-search" placeholder="搜索仓库" data-gh-search="detail" value="${esc(S.githubQuery || '')}"></div><div id="github-repositories">${githubRows(r, S.githubQuery)}</div></div>
    <p class="gh-note">${g.state === 'ready' ? '这里只提供仓库背景，不会更改 GitHub 的真实权限。' : '记录不代表当前仍有访问权限；实际操作时会重新核对。'}</p>`;
}
function githubScopeChoices(r) {
  const e = S.editor, d = e.draft, query = (e.search || '').trim().toLowerCase();
  const repos = r.github.repos.filter((repo) => repo.name.toLowerCase().includes(query));
  if (!repos.length) return '<p class="gh-empty">没有匹配的仓库。</p>';
  return repos.map((repo) => {
    const checked = githubIncluded(d, [repo]).length > 0;
    const added = checked && S.editor.kind !== 'github-add' && !githubIncluded(r.github, [repo]).length;
    return `<label class="gh-choice"><input type="checkbox" data-gh-repo="${esc(repo.id)}" aria-label="提供 ${esc(repo.name)}" ${checked ? 'checked' : ''}><span><b>${esc(repo.name)}</b><small>${repo.branch} · ${repo.visibility}</small></span><span class="gh-value">${added ? '将新增' : !checked && d.mode === 'auto' ? '已排除' : ''}</span></label>`;
  }).join('');
}
function githubScopeEditor(r) {
  const e = S.editor, d = e.draft, before = githubIncluded(r.github, r.github.repos), after = githubIncluded(d, r.github.repos);
  const adds = after.filter((repo) => !before.some((old) => old.id === repo.id)).length;
  const expanding = e.kind === 'github' && (r.github.mode !== 'auto' && d.mode === 'auto' || adds > 0);
  return `<section class="edit-section"><h2>提供哪些仓库信息</h2><div class="list">
      <div class="pref"><div class="lbl"><b>仓库归属</b><small>登录身份 ${esc(r.account)}；其他账号／组织单独接入</small></div><div class="val">${esc(r.github.owner)}</div></div>
      <div class="gh-mode"><div class="seg" role="group" aria-label="仓库同步方式"><button type="button" class="${d.mode === 'auto' ? 'on' : ''}" aria-pressed="${d.mode === 'auto'}" data-gh-mode="auto">自动跟随</button><button type="button" class="${d.mode === 'manual' ? 'on' : ''}" aria-pressed="${d.mode === 'manual'}" data-gh-mode="manual">手动选择</button></div><p>${d.mode === 'auto' ? '包括现在及以后新增且有权访问的仓库，也包括私有仓库。勾选表示提供给 Agent，取消勾选即可排除。' : '只提供下方勾选的仓库。切换到手动时，先保留目前纳入的仓库。'}</p></div>
    </div></section>
    <section class="edit-section"><h2>${d.mode === 'auto' ? `当前仓库 · ${after.length} 个已选` : `选择仓库 · ${d.selectedIds.length} 个`}</h2><div class="list">
      <div class="gh-search"><label class="sr-only" for="gh-scope-search">搜索范围内的仓库</label><input class="inp" id="gh-scope-search" placeholder="搜索仓库" value="${esc(e.search || '')}" data-gh-search="scope"></div><div id="github-choices">${githubScopeChoices(r)}</div>
    </div></section>
    ${expanding ? `<div class="gh-impact" role="status">${adds ? `保存后将新增 ${adds} 个当前仓库。` : ''}${r.github.mode !== 'auto' && d.mode === 'auto' ? '以后新增且有权访问的仓库也会自动纳入，包括私有仓库。' : ''}原来的档位和 Agent 选择不变。</div>` : ''}
    ${r.github.state !== 'ready' ? '<p class="gh-note">当前列表尚未完整核对：可以收窄范围，刷新成功后才能扩大范围。</p>' : ''}`;
}
function githubOwnerPicker() {
  return `<p class="gh-note">以 Furina-he 登录（原型示例）。选择一个归属接入；个人账号和组织各自一行，可以分别设置档位。</p><div class="list">${GH_OWNERS.map((owner) => {
    const added = S.data.resources.some((r) => r.github?.owner === owner.login);
    return `<button type="button" class="row gh-owner" data-gh-add-owner="${owner.login}" ${added ? 'disabled' : ''}><span class="tile">${logo('github')}</span><span class="who"><span class="name">${owner.login}</span><span class="sub">${owner.kind}</span></span>${added ? '<span class="gh-value">已接入</span>' : ic('chevron-right', 'sm')}</button>`;
  }).join('')}</div><p class="gh-note">以后加入的其他组织不会自动纳入。原型不读取或更改真实登录态。</p>`;
}
function githubStartAdd(owner) {
  if (S.data.resources.some((r) => r.github?.owner === owner)) return;
  const r = githubResource(owner);
  r.targets = TARGETS.filter((target) => S.data.agents[target.id]).map((target) => target.id);
  S.dialog = null;
  S.editor = { id: r.id, resource: r, kind: 'github-add', draft: githubDraft(r), initial: JSON.stringify(githubDraft(r)), errors: {}, error: '', open: {}, confirmLeave: false, returnFocus: '[data-act="add"]', scroll: $('.content')?.scrollTop || 0 };
  calm(render); $('#editor-title')?.focus({ preventScroll: true });
}
function githubValidateScope(r, d) {
  const added = githubIncluded(d, r.github.repos).some((repo) => !githubIncluded(r.github, r.github.repos).some((old) => old.id === repo.id));
  const removedExclusion = r.github.excludedIds.some((id) => !d.excludedIds.includes(id));
  if (r.github.state !== 'ready' && (added || removedExclusion && d.mode === 'auto' || r.github.mode !== 'auto' && d.mode === 'auto')) {
    S.editor.error = '仓库列表尚未完整核对。请刷新成功后再扩大范围；当前可以收窄范围。'; refreshEditorFeedback(); $('.editor-alert')?.scrollIntoView({ block: 'nearest' }); return false;
  }
  return true;
}
function githubSaveScope(r, d) {
  const adding = S.editor.kind === 'github-add';
  Object.assign(r.github, structuredClone(d));
  r.meta = `${githubIncluded(r.github, r.github.repos).length} 个仓库`;
  if (adding) { S.data.resources.push(r); S.view = 'resources'; S.detail = r.id; S.editor.scroll = 0; S.editor.returnFocus = '[data-gh-act="manage"]'; }
  closeResourceEditor(adding ? 'GitHub 归属已接入（原型模拟）' : '仓库范围已保存');
}
function githubRefresh(id) {
  const r = res(id); if (!r?.github || r.github.state === 'loading') return;
  r.github.state = 'loading'; calm(render);
  setTimeout(() => {
    if (res(id) !== r) return;
    const state = S.githubScenario || 'ready';
    if (state === 'ready') {
      r.github.repos = [...githubCatalog(r.github.owner), ...(S.data.githubNewRepos?.[r.github.owner] || [])];
      r.meta = `${githubIncluded(r.github, r.github.repos).length} 个仓库`;
    }
    r.github.state = state; r.status = state === 'ready' ? 'ok' : 'warn'; r.warn = githubProblem(state)?.[0];
    calm(render);
  }, 350);
}
function githubScenario(state) {
  S.githubScenario = state; S.toast = null;
  const r = res(S.detail)?.github ? res(S.detail) : S.data.resources.find((item) => item.github);
  if (!r) return;
  S.view = 'resources'; S.detail = r.id; S.sub = null;
  r.github.state = state; r.status = state === 'ready' ? 'ok' : 'warn'; r.warn = githubProblem(state)?.[0]; calm(render);
}
function githubClick(target) {
  let el;
  if ((el = target.closest('[data-gh-scenario]'))) { githubScenario(el.dataset.ghScenario); return true; }
  if ((el = target.closest('[data-gh-add-owner]'))) { githubStartAdd(el.dataset.ghAddOwner); return true; }
  if ((el = target.closest('[data-gh-mode]'))) {
    const d = S.editor.draft, r = S.editor.resource || res(S.editor.id);
    if (el.dataset.ghMode === d.mode) return true;
    if (el.dataset.ghMode === 'manual' && !S.editor.manualInitialized) {
      if (r.github.mode !== 'manual') d.selectedIds = githubIncluded(d, r.github.repos).map((repo) => repo.id);
      S.editor.manualInitialized = true;
    }
    d.mode = el.dataset.ghMode; S.editor.error = ''; renderEditorInPlace(); $(`[data-gh-mode="${d.mode}"]`)?.focus({ preventScroll: true }); return true;
  }
  if ((el = target.closest('[data-gh-repo]'))) {
    const d = S.editor.draft, key = d.mode === 'auto' ? 'excludedIds' : 'selectedIds', id = el.dataset.ghRepo;
    const include = d.mode === 'auto' ? !el.checked : el.checked;
    d[key] = include ? [...d[key], id] : d[key].filter((item) => item !== id);
    S.editor.error = ''; renderEditorInPlace(); document.querySelector(`[data-gh-repo="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }); return true;
  }
  if (!(el = target.closest('[data-gh-act]'))) return false;
  const action = el.dataset.ghAct;
  if (action === 'manage') openResourceEditor(el.dataset.id, 'github');
  if (action === 'refresh') githubRefresh(el.dataset.id);
  if (action === 'new-repo' || action === 'legacy') {
    const r = res(S.detail)?.github ? res(S.detail) : S.data.resources.find((item) => item.github); if (!r) return true;
    S.view = 'resources'; S.detail = r.id; S.githubQuery = '';
    if (action === 'legacy') {
      Object.assign(r.github, { mode: 'manual', selectedIds: r.github.repos.slice(0, 2).map((repo) => repo.id), excludedIds: [], state: 'ready' });
      r.status = 'ok'; r.meta = '2 个仓库'; S.githubScenario = 'ready'; calm(render);
      toast('已切到旧版手选示例：原范围保留，未自动扩大', null, false);
    } else {
      S.data.githubNewRepos ||= {}; const list = S.data.githubNewRepos[r.github.owner] ||= [], n = list.length + 1;
      list.push({ id: `${r.github.owner}:new-${n}`, name: `${r.github.owner}/new-project-${n}`, branch: 'main', visibility: '私有', deployment: '—' });
      S.githubScenario = 'ready'; githubRefresh(r.id);
    }
  }
  return true;
}
function githubInput(target) {
  const kind = target.dataset.ghSearch; if (!kind) return false;
  if (kind === 'scope') { S.editor.search = target.value; $('#github-choices').innerHTML = githubScopeChoices(S.editor.resource || res(S.editor.id)); }
  else { S.githubQuery = target.value; $('#github-repositories').innerHTML = githubRows(res(S.detail), target.value); }
  return true;
}
