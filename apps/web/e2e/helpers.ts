import { expect, type Page } from "@playwright/test";

export const CLEAN_DOCUMENT = `SUPPLIER PROFILE — NORTHWIND INDUSTRIAL LTD
Supplier: Northwind Industrial Ltd
Products:
- Stainless steel fasteners, 12,000 units
- Hydraulic hose assemblies, 400 units
Quote: USD 48,250.00
Delivery: FOB Shanghai, 6 weeks
Payment terms: Net 30
`;

export async function signInWithSandbox(page: Page) {
  await page.goto("/login?next=/app/tasks");
  const start = page.getByRole("button", { name: /Use sandbox session/ });
  const alreadyIn = page.getByRole("heading", { name: "Tasks", exact: true });
  await expect(start.or(alreadyIn)).toBeVisible({ timeout: 30_000 });
  if ((await start.count()) > 0 && (await start.isVisible())) {
    await start.click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  }
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

export async function createFundedTask(
  page: Page,
  input: { name: string; budgetNear: string; document?: string; documentLabel?: string },
): Promise<string> {
  await page.goto("/app/tasks/new");
  // Step 1 · Basics
  await page.getByLabel("Task name").fill(input.name);
  await page.getByRole("button", { name: "Continue" }).click();
  // Step 2 · Documents
  await page.getByLabel("Document text").fill(input.document ?? CLEAN_DOCUMENT);
  await page.getByLabel("Label", { exact: true }).fill(input.documentLabel ?? "Supplier A");
  await page.getByRole("button", { name: "Continue" }).click();
  // Step 3 · Budget
  await page.getByLabel("Task budget (testNEAR)").fill(input.budgetNear);
  await page.getByLabel("Per-purchase limit (testNEAR)").fill("0.02");
  await page.getByRole("button", { name: "Continue" }).click();
  // Step 4 · Review
  await page.getByRole("button", { name: "Review and fund task" }).click();

  await expect(page).toHaveURL(/\/app\/tasks\/[^/]+$/, { timeout: 120_000 });
  await expect(page.getByRole("heading", { name: input.name, exact: true })).toBeVisible({
    timeout: 30_000,
  });
  const match = /\/app\/tasks\/([^/?#]+)/.exec(page.url());
  if (!match?.[1]) throw new Error(`Could not read task id from ${page.url()}`);
  return match[1];
}

export async function runScenario(page: Page, taskId: string, scenario: "A" | "B" | "C" | "D") {
  await page.goto("/app/demo");
  const select = page.getByLabel("Demo task");
  await expect(select).toBeVisible();
  await select.selectOption(taskId);
  await page.getByRole("button", { name: `Run scenario ${scenario}` }).click();
  await expect(page.getByRole("heading", { name: `Scenario ${scenario} output` })).toBeVisible({
    timeout: 30_000,
  });
}
