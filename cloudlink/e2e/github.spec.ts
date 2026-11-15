import { expect, test, type Page } from "@playwright/test"
import type { CliAsset, GithubSnapshotStatus } from "../src/bindings"
import {
  back,
  collectConsoleErrors,
  detailTitle,
  openServer,
  ready,
  row,
  shot,
} from "./helpers"

// P8c behavior tests use only synthetic Mock metadata, not user CLI accounts or credentials.
async function assets(page: Page) {
  return page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((name) => new URL(name).pathname === "/src/lib/ipc.ts")!
    const { ipc } = (await import(
      /* @vite-ignore */ url
    )) as typeof import("../src/lib/ipc")
    return ipc.listAssets()
  })
}
async function github(page: Page) {
  return (await assets(page)).find(
    (asset) => asset.id === "ast_github"
  ) as CliAsset
}
async function verifiedGithub(page: Page) {
  await expect
    .poll(async () => (await github(page)).github?.migrationPending)
    .toBe(false)
  await expect(
    page.getByText("归属 octo-dev · 登录 octo-dev", { exact: true })
  ).toBeVisible()
}
async function fixture(
  page: Page,
  patch: {
    status?: GithubSnapshotStatus
    extra?: boolean
    renamed?: boolean
    transferred?: boolean
  }
) {
  await page.evaluate(async (update) => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find(
        (name) => new URL(name).pathname === "/src/mocks/fixtures-github.ts"
      )!
    const module = (await import(
      /* @vite-ignore */ url
    )) as typeof import("../src/mocks/fixtures-github")
    Object.assign(module.githubFixture, update)
  }, patch)
}
async function openScope(page: Page) {
  await page.getByRole("button", { name: "管理范围", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "管理范围", exact: true })
  await expect(
    dialog.getByRole("checkbox", {
      name: "提供 octo-dev/shop-web 给 Agent",
      exact: true,
    })
  ).toBeVisible()
  return dialog
}

const scopeCheckbox = (page: Page, name: string) =>
  page
    .getByRole("dialog", { name: "管理范围", exact: true })
    .getByRole("checkbox", { name: `提供 ${name} 给 Agent`, exact: true })

test.describe("P8c GitHub 归属与范围", () => {
  test("旧手选核实owner后仍manual，四列表区分登录身份且不扩第三个仓库", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await openServer(page, "github", "GitHub")
    await verifiedGithub(page)
    await expect(
      page.getByText("手动选择 · 已选 2 个", { exact: true })
    ).toBeVisible()
    const table = page.getByRole("table", { name: "已提供的 GitHub 仓库" })
    await expect(table.getByRole("columnheader")).toHaveText([
      "仓库名称",
      "默认分支",
      "可见性",
      "部署目标",
    ])
    await expect(
      table.getByText("octo-dev/shop-web", { exact: true })
    ).toBeVisible()
    await expect(
      table.getByText("octo-dev/notes", { exact: true })
    ).toHaveCount(0)
    const resource = await github(page)
    expect(resource.github).toMatchObject({
      mode: "manual",
      migrationPending: false,
      owner: { login: "octo-dev" },
    })
    expect(
      resource.cli.scope.filter((repo) => repo.selected).map((repo) => repo.id)
    ).toEqual(["repo:R_shop", "repo:R_api"])
    expect(errors).toEqual([])
  })

  test("模式来回保留手选，取消只改草稿；同底栏防丢与Ctrl+S不误提交", async ({
    page,
  }) => {
    await ready(page)
    await openServer(page, "github")
    await verifiedGithub(page)
    await expect(
      page.getByText("手动选择 · 已选 2 个", { exact: true })
    ).toBeVisible()
    const dialog = await openScope(page)
    await scopeCheckbox(page, "octo-dev/api").uncheck()
    await dialog.getByRole("button", { name: "自动跟随", exact: true }).click()
    await expect(
      dialog.getByText(/未来有权访问的仓库（含私有）也会自动加入/)
    ).toBeVisible()
    await dialog.getByRole("button", { name: "手动选择", exact: true }).click()
    await expect(scopeCheckbox(page, "octo-dev/api")).not.toBeChecked()
    expect(
      (await github(page)).cli.scope.find((repo) => repo.id === "repo:R_api")
        ?.selected
    ).toBe(true)
    await page.keyboard.press("Escape")
    await expect(dialog.getByRole("button", { name: "继续编辑" })).toBeFocused()
    await expect(page.getByRole("dialog")).toHaveCount(1)
    await expect(page.getByRole("alertdialog")).toHaveCount(0)
    await page.keyboard.press("Control+s")
    expect(
      (await github(page)).cli.scope.find((repo) => repo.id === "repo:R_api")
        ?.selected
    ).toBe(true)
    await dialog.getByRole("button", { name: "放弃修改" }).click()
    await expect(dialog).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "管理范围", exact: true })
    ).toBeFocused()
  })

  test("自动排除以stable ID跟随改名，新仓库自动加入且转出owner不保留", async ({
    page,
  }) => {
    await ready(page)
    await openServer(page, "github")
    await verifiedGithub(page)
    await expect(
      page.getByText("手动选择 · 已选 2 个", { exact: true })
    ).toBeVisible()
    const dialog = await openScope(page)
    await dialog.getByRole("button", { name: "自动跟随", exact: true }).click()
    await scopeCheckbox(page, "octo-dev/api").uncheck()
    await dialog.getByRole("button", { name: "保存范围", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await fixture(page, { extra: true, renamed: true, transferred: true })
    await page.getByRole("button", { name: "刷新仓库", exact: true }).click()
    await expect(
      page.getByRole("table").getByText("octo-dev/future-api", { exact: true })
    ).toBeVisible()
    const resource = await github(page)
    expect(resource.github?.excludedRepoIds).toContain("repo:R_api")
    expect(
      resource.cli.scope.find((repo) => repo.id === "repo:R_api")
    ).toMatchObject({ name: "octo-dev/api-renamed", selected: false })
    expect(resource.cli.scope.some((repo) => repo.id === "repo:R_notes")).toBe(
      false
    )
  })

  test("不完整快照能收窄，不能转自动扩大未来范围", async ({ page }) => {
    await ready(page)
    await openServer(page, "github")
    await verifiedGithub(page)
    await expect(
      page.getByText("手动选择 · 已选 2 个", { exact: true })
    ).toBeVisible()
    const dialog = await openScope(page)
    await fixture(page, { status: "partial" })
    await dialog.getByRole("button", { name: "刷新仓库", exact: true }).click()
    await expect(
      dialog.getByText(
        "仓库没有完整核对，保留上次范围；现在只能收窄，不能新增。"
      )
    ).toBeVisible()
    await expect(scopeCheckbox(page, "octo-dev/notes")).toBeDisabled()
    await scopeCheckbox(page, "octo-dev/api").uncheck()
    await dialog.getByRole("button", { name: "自动跟随", exact: true }).click()
    await expect(
      dialog.getByRole("button", { name: "保存范围", exact: true })
    ).toBeDisabled()
    await dialog.getByRole("button", { name: "手动选择", exact: true }).click()
    await expect(
      dialog.getByRole("button", { name: "保存范围", exact: true })
    ).toBeEnabled()
    await dialog.getByRole("button", { name: "保存范围", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect(
      (await github(page)).cli.scope
        .filter((repo) => repo.selected)
        .map((repo) => repo.id)
    ).toEqual(["repo:R_shop"])
  })

  for (const status of ["offline", "denied"] as const)
    test(`${status}保留上次快照，恢复完整核对后才允许扩围`, async ({
      page,
    }) => {
      await ready(page)
      await openServer(page, "github")
      await verifiedGithub(page)
      await expect(
        page.getByText("手动选择 · 已选 2 个", { exact: true })
      ).toBeVisible()
      const dialog = await openScope(page)
      await fixture(page, { status })
      await dialog
        .getByRole("button", { name: "刷新仓库", exact: true })
        .click()
      await expect(dialog.getByRole("alert")).toContainText(
        status === "offline"
          ? "暂时无法连接 GitHub，保留上次范围"
          : "当前登录身份无法完整访问此归属"
      )
      expect(
        (await github(page)).cli.scope.filter((repo) => repo.selected)
      ).toHaveLength(2)
      await dialog
        .getByRole("button", { name: "自动跟随", exact: true })
        .click()
      await expect(
        dialog.getByRole("button", { name: "保存范围", exact: true })
      ).toBeDisabled()
      await fixture(page, { status: "complete" })
      await dialog
        .getByRole("button", { name: "刷新仓库", exact: true })
        .click()
      await expect(
        dialog.getByRole("button", { name: "保存范围", exact: true })
      ).toBeEnabled()
      await page.keyboard.press("Escape")
      await dialog.getByRole("button", { name: "放弃修改" }).click()
    })

  test("保存失败保留完整草稿，搜索无匹配和未提供仓库不是同一种空状态", async ({
    page,
  }) => {
    await ready(page)
    await openServer(page, "github")
    await verifiedGithub(page)
    await expect(
      page.getByText("手动选择 · 已选 2 个", { exact: true })
    ).toBeVisible()
    const dialog = await openScope(page)
    await scopeCheckbox(page, "octo-dev/api").uncheck()
    await page.evaluate(async () => {
      const url = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((name) => new URL(name).pathname === "/src/lib/ipc.ts")!
      const { ipc } = (await import(
        /* @vite-ignore */ url
      )) as typeof import("../src/lib/ipc")
      const save = ipc.saveGithubScope
      ipc.saveGithubScope = async () => {
        ipc.saveGithubScope = save
        throw { id: "cli-scope-failed" }
      }
    })
    await dialog.getByRole("button", { name: "保存范围", exact: true }).click()
    await expect(
      dialog.getByRole("alert").filter({ hasText: "保存失败" })
    ).toBeVisible()
    await expect(scopeCheckbox(page, "octo-dev/api")).not.toBeChecked()
    await dialog
      .getByRole("textbox", { name: "搜索仓库" })
      .fill("does-not-exist")
    await expect(
      dialog.getByText("没有匹配的仓库。", { exact: true })
    ).toBeVisible()
    await dialog.getByRole("button", { name: "清除搜索" }).click()
    await expect(scopeCheckbox(page, "octo-dev/notes")).not.toBeChecked()
    await dialog.getByRole("button", { name: "保存范围", exact: true }).click()
    await expect(dialog).toHaveCount(0)
  })

  test("组织共用登录身份；默认auto，多个GitHub才显示归属副行", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page)
    await ready(page)
    await page.keyboard.press("Control+n")
    await page.getByRole("button", { name: /^GitHub/ }).click()
    const form = page.getByRole("region", { name: "添加 GitHub", exact: true })
    await expect(form.getByRole("radio", { name: /^octo-dev/ })).toBeDisabled()
    await expect(form.getByRole("radio", { name: /^octo-labs/ })).toBeChecked()
    await expect(
      form.getByRole("button", { name: "自动跟随", exact: true })
    ).toHaveAttribute("aria-pressed", "true")
    await expect(form.getByText(/包括私有仓库/)).toBeVisible()
    await expect(form.getByRole("button", { name: "保存并启用" })).toBeEnabled()
    await form.getByRole("button", { name: "保存并启用" }).click()
    await expect(row(page, "github-2")).toBeVisible()
    await expect(
      row(page, "github-2")
        .locator("..")
        .getByText("octo-labs", { exact: true })
    ).toBeVisible()
    await expect(
      row(page, "github").locator("..").getByText("octo-dev", { exact: true })
    ).toBeVisible()
    await openServer(page, "github-2", "GitHub")
    await expect(
      page.getByText("归属 octo-labs · 登录 octo-dev", { exact: true })
    ).toBeVisible()
    const resource = (await assets(page)).find(
      (asset) => asset.type === "cli" && asset.handle === "github-2"
    ) as CliAsset
    expect(resource.github).toMatchObject({
      mode: "auto",
      owner: { login: "octo-labs", kind: "organization" },
    })
    expect(resource.agent.mode).toBe("read-only")
    expect(resource.cli.scope.every((repo) => repo.selected)).toBe(true)
    if (process.env.P8_GITHUB_SHOTS === "1") {
      await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur()
      )
      await shot(page, "p8c-github-owner-identity-separated")
    }
    expect(errors).toEqual([])
  })
})

// Explicit gate shots: parent runs them with the complete P8 evidence round and checks each file with analyze_image.
for (const nav of ["top", "side"] as const)
  for (const scheme of ["light", "dark"] as const)
    for (const [width, height] of [
      [1000, 680],
      [760, 520],
    ]) {
      test(`P8c 截图 ${nav} ${scheme} ${width}`, async ({ page }) => {
        test.skip(process.env.P8_GITHUB_SHOTS !== "1", "截图只在P8证据批次重拍")
        const errors = collectConsoleErrors(page)
        await page.addInitScript(
          (position) =>
            localStorage.setItem("cloudlink-nav-position", position),
          nav
        )
        await page.emulateMedia({ colorScheme: scheme })
        await page.setViewportSize({ width, height })
        await ready(page)
        await openServer(page, "github", "GitHub")
        await verifiedGithub(page)
        await expect(
          page.getByText("手动选择 · 已选 2 个", { exact: true })
        ).toBeVisible()
        await page.evaluate(() =>
          (document.activeElement as HTMLElement | null)?.blur()
        )
        await shot(page, `p8c-github-detail-${nav}-${scheme}-${width}`)
        const table = page.getByRole("table", { name: "已提供的 GitHub 仓库" })
        await table.scrollIntoViewIfNeeded()
        await expect(table).toBeInViewport({ ratio: 1 })
        await expect(table.getByRole("columnheader")).toHaveText([
          "仓库名称",
          "默认分支",
          "可见性",
          "部署目标",
        ])
        const tableGeometry = await table.evaluate((element) => ({
          scroll: element.scrollWidth,
          client: element.clientWidth,
        }))
        expect(tableGeometry.scroll).toBeLessThanOrEqual(
          tableGeometry.client + 1
        )
        await shot(page, `p8c-github-repositories-${nav}-${scheme}-${width}`)
        const dialog = await openScope(page)
        await dialog
          .getByRole("button", { name: "自动跟随", exact: true })
          .click()
        await expect(
          dialog.getByRole("button", { name: "保存范围", exact: true })
        ).toBeInViewport({ ratio: 1 })
        const geometry = await dialog.evaluate((root) => ({
          width: root.getBoundingClientRect().width,
          scroll: root.scrollWidth,
          client: root.clientWidth,
        }))
        expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1)
        expect(geometry.width).toBeLessThanOrEqual(
          Math.min(600, width - 32) + 1
        )
        await shot(page, `p8c-github-scope-${nav}-${scheme}-${width}`)
        await page.keyboard.press("Escape")
        await dialog.getByRole("button", { name: "放弃修改" }).click()
        await back(page)
        await expect(detailTitle(page)).toHaveCount(0)
        expect(errors).toEqual([])
      })
    }
