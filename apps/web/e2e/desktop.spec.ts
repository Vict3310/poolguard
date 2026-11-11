import { expect, test } from "@playwright/test";
import { agreeToTerms, createFundedTask, runScenario, signInWithSandbox } from "./helpers.js";

test("public landing and authenticated gate are honest", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /One task budget/ })).toBeVisible();
  await expect(page.getByText(/Testnet prototype|test tokens have no monetary value/i).first()).toBeVisible();

  // The workspace redirects signed-out visitors to the sign-in page.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?next=%2Fapp/);
  await expect(page.getByRole("heading", { name: "Sign in to PoolGuard" })).toBeVisible();
  await expect(page.getByText(/local sandbox/i).first()).toBeVisible();
  await expect(page.getByText(/never asks for a seed phrase/i)).toBeVisible();
});

test("a new account is offered guided setup and unknown pages show a calm 404", async ({ page }) => {
  await page.goto("/login");
  await agreeToTerms(page);
  await page.getByRole("button", { name: /Use sandbox session/ }).click();
  await expect(page).toHaveURL(/\/(onboarding|app)/, { timeout: 30_000 });
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: /Let agents spend/ })).toBeVisible();
  await page.getByRole("button", { name: /Show me how/ }).click();
  await expect(page.getByRole("heading", { name: "Meet your two agents" })).toBeVisible();

  await page.goto("/this-page-does-not-exist");
  await expect(page.getByRole("heading", { name: /outside the pool/ })).toBeVisible();

  await page.goto("/app/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Motion preference" })).toBeVisible();
});

test("sandbox owner creates a funded task and both agents make a permitted purchase", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signInWithSandbox(page);

  const name = `E2E permitted purchase ${Date.now()}`;
  const taskId = await createFundedTask(page, {
    name,
    budgetNear: "0.05",
    documentLabel: "Northwind profile",
  });

  await runScenario(page, taskId, "A");
  await expect(page.getByText("Run finished.", { exact: false }).first()).toBeVisible({
    timeout: 150_000,
  });
  await expect(page.getByText(/Scripted fixture|Live model/).first()).toBeVisible();

  await page.getByRole("link", { name: /Inspect the full task/ }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByText(/2 documents extracted by the paid service/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Northwind Industrial Ltd").first()).toBeVisible();
});

test("two concurrent agents race one shared budget and the denial is visible", async ({ page }) => {
  test.setTimeout(210_000);
  await signInWithSandbox(page);

  const name = `E2E shared budget race ${Date.now()}`;
  const taskId = await createFundedTask(page, {
    name,
    budgetNear: "0.03",
    documentLabel: "Northwind profile",
  });

  await runScenario(page, taskId, "B");
  await expect(page.getByText("Run finished.", { exact: false }).first()).toBeVisible({
    timeout: 180_000,
  });
  await expect(
    page
      .getByText(/Fell back to Supplier document summary after a denial|INSUFFICIENT_AVAILABLE_BUDGET/)
      .first(),
  ).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: /Inspect the full task/ }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByText("Supplier document summary").first()).toBeVisible();
  await expect(page.getByText("Supplier document extraction").first()).toBeVisible();
});
