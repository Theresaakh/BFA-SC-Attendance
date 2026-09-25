import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email = "admin@e2e.test", password = "E2eAdminPass1") {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.describe.configure({ mode: "serial" });

test("unauthenticated users are sent to the login page", async ({ page, request }) => {
  await page.goto("/players");
  await expect(page).toHaveURL(/\/login\?next=%2Fplayers/);
  const api = await request.get("/api/search?q=john");
  expect(api.status()).toBe(401);
});

test("wrong password is rejected with a generic message", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", "admin@e2e.test");
  await page.fill("#password", "not-the-password");
  await page.click("button[type=submit]");
  await expect(page.getByRole("alert").filter({ hasText: "Incorrect" })).toContainText("Incorrect e-mail or password");
});

test("dashboard shows financial and attendance overview", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const invoices = page.locator("text=Total invoices").locator("..").locator("..");
  await expect(invoices).toContainText("5");
  await expect(page.getByText("Player attendance", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Unpaid & low attendance")).toBeVisible();
});

test("global search opens a player's combined profile", async ({ page }) => {
  await login(page);
  await page.getByRole("combobox", { name: "Global search" }).fill("John");
  await page.getByRole("option", { name: /John Smith/ }).click();
  await expect(page.getByRole("heading", { name: "John Smith" })).toBeVisible();
  await expect(page.getByText("INV/2026/0001")).toBeVisible();
  await expect(page.getByText("INV/2026/0002")).toBeVisible();
  await expect(page.getByText("Partially paid").first()).toBeVisible();
  // 2 of 3 sessions attended
  await expect(page.getByText("66.7%")).toBeVisible();
});

test("filters combine: branch + unpaid + attendance below 70%", async ({ page }) => {
  await login(page);
  await page.goto("/players");
  await page.selectOption("#f-branch", { label: "Furn El Chebbek" });
  await page.selectOption("#f-finance", "outstanding");
  await page.fill("#f-attMax", "70");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/finance=outstanding/);
  const table = page.locator("table");
  await expect(table).toContainText("John Smith");
  await expect(table).not.toContainText("Georges Abi Raad");
  await expect(table).not.toContainText("Elie Nassar");
});

test("an uncertain match is reviewed and accepted by the admin", async ({ page }) => {
  await login(page);
  await page.goto("/matching");
  const row = page.locator("tr", { hasText: "Elie Nassar" });
  await expect(row).toContainText("Nassar Elie");
  await row.getByRole("button", { name: "Link" }).click();
  await expect(page.locator("tr", { hasText: "Elie Nassar" })).toHaveCount(0);
  await page.goto("/matching?tab=linked");
  await expect(page.locator("tr", { hasText: "Elie Nassar" })).toContainText("Nassar Elie");
});

test("records can be linked manually", async ({ page }) => {
  await login(page);
  await page.goto("/matching?tab=customers");
  const row = page.locator("tr", { hasText: "Unrelated Company" });
  await row.getByRole("button", { name: "Link manually" }).click();
  await row.getByPlaceholder("Player name or ID").fill("Nour");
  await row.getByRole("button", { name: /Nour Fares/ }).click();
  await expect(page.locator("tr", { hasText: "Unrelated Company" })).toHaveCount(0);
  await page.goto("/matching?tab=linked&q=Nour");
  await expect(page.locator("tr", { hasText: "Nour Fares" })).toContainText("Manual");
});

test("Sync now reports unconfigured integrations and logs the failure", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByRole("status").filter({ hasText: /not configured/ })).toBeVisible({ timeout: 30_000 });
  await page.goto("/sync");
  await expect(page.locator("table")).toContainText("Failed");
  await expect(page.locator("table")).toContainText("Odoo invoices");
});

test("reports download as Excel and PDF", async ({ page }) => {
  await login(page);
  const xlsx = await page.request.get("/api/reports/player-summary?format=xlsx");
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
  const pdf = await page.request.get("/api/reports/unpaid-low-attendance?format=pdf");
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  await page.goto("/reports");
  const card = page.locator("form", { hasText: "Overdue invoices" }).first();
  const download = page.waitForEvent("download");
  await card.getByRole("button", { name: "Excel" }).click();
  expect((await download).suggestedFilename()).toMatch(/^bfa-overdue-invoices-\d{4}-\d{2}-\d{2}\.xlsx$/);
});

test("viewers have read-only access", async ({ page }) => {
  await login(page, "viewer@e2e.test", "E2eViewerPass1");
  await expect(page.getByRole("button", { name: "Sync now" })).toHaveCount(0);
  await page.goto("/matching?tab=players");
  await expect(page.getByText("You have read-only access")).toBeVisible();
  const res = await page.request.post("/api/sync", { data: {}, headers: { Origin: page.url().replace(/\/matching.*/, "") } });
  expect(res.status()).toBe(403);
});

test("cross-site requests and the cron endpoint are protected", async ({ page, request, baseURL }) => {
  await login(page);
  const csrf = await page.request.post("/api/sync", { data: {}, headers: { Origin: "https://evil.example" } });
  expect(csrf.status()).toBe(403);
  const cron = await request.post("/api/cron/sync", { headers: { Authorization: "Bearer wrong" } });
  expect(cron.status()).toBe(401);
  const res = await request.get(`${baseURL}/login`);
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
});
