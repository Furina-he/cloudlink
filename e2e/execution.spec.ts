import { expect, test, type Page } from "@playwright/test"
import { collectConsoleErrors, ready, shot } from "./helpers"

async function activity(page: Page, state = "waiting") {
  await ready(page, `?execution=${state}`)
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: /^动态/ })
    .click()
  await expect(
    page.getByRole("heading", { level: 1, name: "动态" })
  ).toBeVisible()
  await expect(page.locator("[id^=execution-req_mock_]").first()).toBeVisible()
}
async function fixtureCommand(
  page: Page,
  command: string,
  args: Record<string, unknown>
) {
  return page.evaluate(
    async ({ command, args }) => {
      const internals = (
        window as Window & {
          __TAURI_INTERNALS__: {
            invoke: (command: string, args: unknown) => Promise<unknown>
          }
        }
      ).__TAURI_INTERNALS__
      return internals.invoke(command, args)
    },
    { command, args }
  )
}

// Synthetic UI transitions are not proof of native permission consumption or execution.
test("原审批优先于折叠笔记，三条命令都完整呈现且来源不冒认品牌", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page)
  await activity(page)
  await expect(page.locator("[id^=execution-req_mock_]")).toHaveCount(3)
  await expect(
    page.getByRole("button", { name: "允许一次", exact: true })
  ).toHaveCount(3)
  const third = page.locator("#execution-req_mock_2")
  await expect(third.locator("code")).toHaveText(
    "sh -c 'cd /opt/apps/api && ./deploy.sh --production'"
  )
  await expect(third).toContainText("未识别来源")
  expect(errors).toEqual([])
})

test("允许一次只改变许可状态，原调用继续才运行；重复继续被拒绝", async ({
  page,
}) => {
  await activity(page)
  const card = page.locator("#execution-req_mock_0")
  await card.getByRole("button", { name: "允许一次", exact: true }).click()
  await expect(card.getByRole("status")).toHaveText("已允许，等 Agent 继续")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await fixtureCommand(page, "mock_execution_continue", {
    requestId: "req_mock_0",
  })
  await expect(card.getByRole("status")).toHaveText("执行中")
  const rejected = await page.evaluate(async () => {
    const internals = (
      window as Window & {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args: unknown) => Promise<unknown>
        }
      }
    ).__TAURI_INTERNALS__
    try {
      await internals.invoke("mock_execution_continue", {
        requestId: "req_mock_0",
      })
      return null
    } catch (error) {
      return error
    }
  })
  expect(rejected).toMatchObject({ id: "execution-stale" })
  await fixtureCommand(page, "mock_execution_finish", {
    requestId: "req_mock_0",
    exitCode: 0,
  })
  await expect(card.getByRole("status")).toHaveText("执行成功")
})

test("拒绝沿用原卡片，切只读使尚未启动许可取消", async ({ page }) => {
  await activity(page)
  const first = page.locator("#execution-req_mock_0")
  await first.getByRole("button", { name: "拒绝", exact: true }).click()
  await expect(first.getByRole("status")).toHaveText("已拒绝，未执行")
  await fixtureCommand(page, "set_mode", {
    assetId: "ast_sg_db",
    mode: "read-only",
  })
  await expect(
    page.getByRole("button", { name: "允许一次", exact: true })
  ).toHaveCount(0)
  const requests = (await fixtureCommand(
    page,
    "list_execution_requests",
    {}
  )) as { requestId: string; state: string }[]
  expect(
    requests
      .filter((request) => request.state === "cancelled")
      .map((request) => request.requestId)
  ).toEqual(["req_mock_1", "req_mock_2"])
  await expect(
    page
      .locator("[id^=execution-req_mock_]")
      .filter({ hasText: "已取消，未执行" })
      .first()
  ).toBeVisible()
})

for (const [state, text] of [
  ["expired", "已过期，未执行"],
  ["unknown", "结果未知，请勿重复执行"],
] as const) {
  test(`${state}不能冒称执行成功或恢复允许按钮`, async ({ page }) => {
    const errors = collectConsoleErrors(page)
    await activity(page, state)
    await expect(
      page.getByRole("button", { name: "允许一次", exact: true })
    ).toHaveCount(0)
    await expect(
      page.locator("[id^=execution-req_mock_]").first().getByRole("status")
    ).toHaveText(text)
    expect(errors).toEqual([])
  })
}

for (const state of ["waiting", "approved", "running", "unknown"] as const)
  for (const scheme of ["light", "dark"] as const) {
    test(`P8e 截图 ${state} ${scheme}`, async ({ page }) => {
      test.skip(
        process.env.P8_EXECUTION_SHOTS !== "1",
        "仅在隔离证据批次生成截图"
      )
      await page.emulateMedia({ colorScheme: scheme })
      await activity(page, state)
      await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.blur()
      )
      // Motion's layout transforms are not CSS/Web Animations and are not stopped
      // by screenshot({ animations: 'disabled' }). Capture the settled geometry.
      let previous = "",
        stable = 0
      await expect
        .poll(async () => {
          const geometry = await page.evaluate(() =>
            [
              ...document.querySelector(
                '[role="list"][aria-labelledby="feed-asks"]'
              )!.children,
            ].map((element) => {
              const rect = element.getBoundingClientRect()
              return {
                top: rect.top,
                bottom: rect.bottom,
                transform: getComputedStyle(element).transform,
              }
            })
          )
          const key = JSON.stringify(geometry)
          const settled = geometry.every(
            (item, index) =>
              item.transform === "none" &&
              (index === 0 || item.top >= geometry[index - 1].bottom - 0.5)
          )
          stable = settled && key === previous ? stable + 1 : 0
          previous = key
          return stable
        })
        .toBeGreaterThanOrEqual(3)
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth
        )
      ).toBe(true)
      await shot(page, `p8e-execution-${state}-${scheme}`)
    })
  }
