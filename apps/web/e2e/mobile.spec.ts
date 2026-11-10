import { expect, test } from "@playwright/test";
import { signInWithSandbox } from "./helpers.js";

function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  return expect
    .poll(
      () =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      { timeout: 10_000 },
    )
    .toBeLessThanOrEqual(1);
}

test("360px landing, navigation and create-task form stay usable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /One task budget/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to PoolGuard" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await signInWithSandbox(page);
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await page.getByRole("button", { name: "Close navigation" }).click();

  await page.goto("/app/tasks/new");
  await expect(page.getByRole("heading", { name: "Create task" })).toBeVisible();
  await expect(page.getByLabel("Task name")).toBeVisible();
  const next = page.getByRole("button", { name: "Continue" });
  await next.scrollIntoViewIfNeeded();
  await expect(next).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
