import { request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";

const baseURL = () => process.env.BASE_URL ?? "http://localhost:8080";

const adminEmail = process.env.ADMIN_EMAIL ?? "admin@orca.com";
const adminPassword = process.env.ADMIN_PASSWORD ?? "AdminPass123!";

type Tokens = { access?: string; refresh?: string; csrf?: string };

async function newApiContext(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: baseURL() });
}

async function fetchCsrf(api: APIRequestContext, refreshToken?: string): Promise<string | undefined> {
  const headers: Record<string, string> = refreshToken ? { "x-refresh-token": refreshToken } : {};
  const res = await api.get("/api/csrf-token", { headers });
  if (!res.ok()) return undefined;
  const data = (await res.json()) as { csrfToken?: string };
  return data.csrfToken;
}

async function mutatingRequest(
  api: APIRequestContext,
  method: "POST" | "DELETE",
  path: string,
  body: object | undefined,
  tokens: Tokens
): Promise<Awaited<ReturnType<APIRequestContext["post"]>>> {
  let csrf = tokens.csrf ?? (await fetchCsrf(api, tokens.refresh));
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (tokens.access) headers.Authorization = `Bearer ${tokens.access}`;
  if (tokens.refresh) headers["x-refresh-token"] = tokens.refresh;
  if (csrf) headers["x-csrf-token"] = csrf;

  const opts = { headers, data: body };
  let res = method === "POST" ? await api.post(path, opts) : await api.delete(path, { headers });

  if (res.status() === 403) {
    const err = await res.json().catch(() => ({}));
    const msg = `${(err as { error?: string }).error ?? ""}`.toLowerCase();
    if (msg.includes("csrf")) {
      csrf = await fetchCsrf(api, tokens.refresh);
      if (csrf) headers["x-csrf-token"] = csrf;
      res = method === "POST" ? await api.post(path, opts) : await api.delete(path, { headers });
    }
  }

  return res;
}

/** Admin terminates any live sessions for a seed user (SR-23 escape hatch). */
export async function revokeSeedUserSessions(email: string): Promise<void> {
  const api = await newApiContext();
  try {
    const csrf = await fetchCsrf(api);
    if (!csrf) return;

    const loginRes = await mutatingRequest(
      api,
      "POST",
      "/api/auth/admin/login",
      { email: adminEmail, password: adminPassword },
      { csrf }
    );
    if (!loginRes.ok()) return;

    const loginData = (await loginRes.json()) as { token?: string; refreshToken?: string };
    const tokens: Tokens = {
      access: loginData.token,
      refresh: loginData.refreshToken,
      csrf: await fetchCsrf(api, loginData.refreshToken),
    };

    const sessionsRes = await api.get("/api/admin/sessions", {
      headers: {
        Authorization: `Bearer ${tokens.access}`,
        ...(tokens.refresh ? { "x-refresh-token": tokens.refresh } : {}),
      },
    });
    if (!sessionsRes.ok()) return;

    const { sessions } = (await sessionsRes.json()) as {
      sessions?: Array<{ id: number; email: string }>;
    };

    for (const session of sessions ?? []) {
      if (session.email !== email) continue;
      await mutatingRequest(api, "DELETE", `/api/admin/sessions/${session.id}`, undefined, tokens);
    }

    await mutatingRequest(
      api,
      "POST",
      "/api/auth/logout",
      tokens.refresh ? { refreshToken: tokens.refresh } : {},
      tokens
    );
  } finally {
    await api.dispose();
  }
}

/** Sign out through the same UI path production uses (handles CSRF correctly). */
export async function logoutViaUi(page: Page): Promise<void> {
  const hasSession = await page.evaluate(() => !!sessionStorage.getItem("orca.session"));
  if (!hasSession) return;

  const url = page.url();
  const onLoginPage = /\/login|\/administratorLogin/.test(url);
  if (onLoginPage || url === "about:blank") {
    await logoutViaApi(page);
    return;
  }

  const isAdmin = url.includes("/adm/");
  if (isAdmin) {
    await page.locator('button[aria-haspopup="true"]').first().click();
  } else {
    await page.getByRole("button", { name: "Account menu" }).click();
  }

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/login|\/administratorLogin/, { timeout: 15_000 });
}

/** Best-effort API logout mirroring frontend apiFetch CSRF handling. */
export async function logoutViaApi(page: Page): Promise<void> {
  const ok = await page.evaluate(async () => {
    const refreshToken = sessionStorage.getItem("orca.refresh");
    const token = sessionStorage.getItem("orca.session");
    if (!refreshToken && !token) return true;

    async function getCsrf(): Promise<string | null> {
      try {
        const csrfRes = await fetch("/api/csrf-token", {
          credentials: "include",
          headers: refreshToken ? { "x-refresh-token": refreshToken } : {},
        });
        if (!csrfRes.ok) return sessionStorage.getItem("orca.csrf");
        const data = await csrfRes.json();
        return data.csrfToken ?? sessionStorage.getItem("orca.csrf");
      } catch {
        return sessionStorage.getItem("orca.csrf");
      }
    }

    async function postLogout(csrfToken: string | null): Promise<Response> {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (refreshToken) headers["x-refresh-token"] = refreshToken;
      if (csrfToken) headers["x-csrf-token"] = csrfToken;

      return fetch("/api/auth/logout", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
      });
    }

    let csrfToken = sessionStorage.getItem("orca.csrf") ?? (await getCsrf());
    let res = await postLogout(csrfToken);

    if (res.status === 403) {
      const err = await res.clone().json().catch(() => ({}));
      const msg = `${err.error ?? ""} ${err.message ?? ""}`.toLowerCase();
      if (msg.includes("csrf")) {
        csrfToken = await getCsrf();
        res = await postLogout(csrfToken);
      }
    }

    if (res.ok) {
      sessionStorage.removeItem("orca.session");
      sessionStorage.removeItem("orca.refresh");
      sessionStorage.removeItem("orca.csrf");
      return true;
    }

    return false;
  });

  if (!ok) {
    // Do not clear sessionStorage locally when the server session may still be live.
    return;
  }
}

export async function logoutCurrentUser(page: Page): Promise<void> {
  try {
    await logoutViaUi(page);
  } catch {
    await logoutViaApi(page);
  }
}
