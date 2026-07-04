import { test as base, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { AdminLoginPage, ConsultPage, DashboardPage, LoginPage } from "../pages/index.js";
import { logoutCurrentUser, revokeSeedUserSessions } from "../helpers/session.js";

const workerEmail = process.env.WORKER_EMAIL ?? "john@orca.com";
const workerPassword = process.env.WORKER_PASSWORD ?? "WorkerPass123!";
const expertEmail = process.env.EXPERT_EMAIL ?? "bob@orca.com";
const expertPassword = process.env.EXPERT_PASSWORD ?? "ExpertPass123!";
const adminEmail = process.env.ADMIN_EMAIL ?? "admin@orca.com";
const adminPassword = process.env.ADMIN_PASSWORD ?? "AdminPass123!";

type AuthFixtures = {
  loginPage: LoginPage;
  adminLoginPage: AdminLoginPage;
  dashboardPage: DashboardPage;
  consultPage: ConsultPage;
};

export const test = base.extend<AuthFixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  adminLoginPage: async ({ page }, use) => {
    await use(new AdminLoginPage(page));
  },
  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },
  consultPage: async ({ page }, use) => {
    await use(new ConsultPage(page));
  },
});

// SR-23: closing a Playwright context does not revoke the DB session — logout
// after each test so the next test can sign in as the same seed user.
test.afterEach(async ({ page }) => {
  await logoutCurrentUser(page);
});

export { expect, workerEmail, workerPassword, expertEmail, expertPassword, adminEmail, adminPassword };

async function loginWithSessionRecovery(
  page: Page,
  email: string,
  password: string,
  login: LoginPage
) {
  async function attempt() {
    await login.goto();
    await login.login(email, password);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  }

  try {
    await attempt();
  } catch {
    // Orphan server session (409) — afterEach logout missed or login failed mid-test.
    await revokeSeedUserSessions(email);
    await attempt();
  }
}

export async function loginAsWorker(page: Page) {
  await loginWithSessionRecovery(page, workerEmail, workerPassword, new LoginPage(page));
}

export async function loginAsExpert(page: Page) {
  await loginWithSessionRecovery(page, expertEmail, expertPassword, new LoginPage(page));
}

export async function loginAsAdmin(page: Page) {
  const login = new AdminLoginPage(page);
  await login.goto();
  await login.login(adminEmail, adminPassword);
  await expect(page).toHaveURL(/\/adm\/managementDashboard/);
}
