import { deploymentEnv, devPlatform, secretValue } from "./support.ts";

export interface DirectusResponse {
  status: number;
  body: any;
}

/** One signed-in Directus user, who signs in again when the access token expires. */
export class DirectusSession {
  private token: Promise<string> | undefined;
  readonly baseUrl: string;
  readonly email: string;
  private readonly password: string;

  constructor(baseUrl: string, email: string, password: string) {
    this.baseUrl = baseUrl;
    this.email = email;
    this.password = password;
  }

  private signIn(): Promise<string> {
    this.token ??= (async () => {
      const response = await send(this.baseUrl, undefined, "POST", "/auth/login", {
        email: this.email,
        password: this.password,
      });
      const token = response.body?.data?.access_token;
      if (response.status !== 200 || typeof token !== "string") {
        throw new Error(`${this.email} can't sign in: ${response.status} ${JSON.stringify(response.body)}`);
      }
      return token;
    })();
    return this.token;
  }

  /** A REST call that doesn't throw on an error status, since several are expected. */
  async request(method: string, path: string, body?: unknown): Promise<DirectusResponse> {
    let response = await send(this.baseUrl, await this.signIn(), method, path, body);
    // A token lasts Directus's default 15 minutes, which a whole run can outlast.
    if (response.status === 401 && response.body?.errors?.[0]?.extensions?.code === "TOKEN_EXPIRED") {
      this.token = undefined;
      response = await send(this.baseUrl, await this.signIn(), method, path, body);
    }
    return response;
  }

  /** A REST call that must succeed. Returns the response's `data`. */
  async ok(method: string, path: string, body?: unknown): Promise<any> {
    const response = await this.request(method, path, body);
    if (response.status >= 300) {
      throw new Error(`${this.email}: ${method} ${path}: ${response.status} ${JSON.stringify(response.body)}`);
    }
    return response.body?.data;
  }
}

async function send(
  baseUrl: string,
  token: string | undefined,
  method: string,
  path: string,
  body?: unknown,
): Promise<DirectusResponse> {
  const attempt = () =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  let response = await attempt();
  // Dev's small Directus sheds load with a 503 ("Under pressure"), before any handler runs.
  for (let retry = 1; response.status === 503 && retry < 10; retry++) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    response = await attempt();
  }
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

/**
 * Signs in to dev's Directus as its built-in admin, with the password isthmia's `crm` wrote to the
 * `directus` Secret. The deploy identity already reads it, so no test token needs creating.
 */
export async function devDirectusAdmin(): Promise<DirectusSession> {
  const platform = await devPlatform();
  const email = await deploymentEnv(platform, "directus", "ADMIN_EMAIL");
  const password = await secretValue(platform, "directus", "ADMIN_PASSWORD");
  return new DirectusSession(`https://directus.${platform.domain}`, email, password);
}
