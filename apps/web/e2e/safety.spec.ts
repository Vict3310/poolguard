import { expect, test } from "@playwright/test";
import { createFundedTask, runScenario, signInWithSandbox } from "./helpers.js";

test("policy injection probe is denied by the contract and needs no model obedience", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithSandbox(page);

  const name = `E2E policy denial ${Date.now()}`;
  const taskId = await createFundedTask(page, { name, budgetNear: "0.02" });

  await runScenario(page, taskId, "C");
  await expect(page.getByText("Contract policy probe")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/PROVIDER_NOT_ALLOWED/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Run finished.", { exact: true })).toBeVisible({ timeout: 150_000 });

  await page.getByRole("link", { name: /Inspect the full task/ }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
});

test("dropped response recovers one settled payment and a delivered result", async ({ page }) => {
  test.setTimeout(210_000);
  await signInWithSandbox(page);

  const name = `E2E lost response ${Date.now()}`;
  const taskId = await createFundedTask(page, { name, budgetNear: "0.02" });

  await runScenario(page, taskId, "D");
  await expect(page.getByText("Run finished.", { exact: true })).toBeVisible({ timeout: 180_000 });

  await page.getByRole("link", { name: /Inspect the full task/ }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();

  const operations = page.getByRole("button", { name: /Open operation/ });
  await expect(operations).toHaveCount(1, { timeout: 30_000 });
  await operations.first().click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Payment settled", { exact: true })).toBeVisible();
  await expect(page.getByText("Result delivered", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Technical evidence/ }).click();
  await expect(page.getByText("Payout attempts", { exact: true })).toBeVisible();
  await expect(page.getByText("1", { exact: true }).last()).toBeVisible();
});
