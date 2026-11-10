import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  /** A new session for the same user, who signs in again. */
  again(): DirectusSession {
    return new DirectusSession(this.baseUrl, this.email, this.password);
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

  /** Uploads a file, as the Data Studio does. Returns the new file's `data`. */
  async upload(form: FormData): Promise<any> {
    const response = await fetch(`${this.baseUrl}/files`, {
      method: "POST",
      headers: { authorization: `Bearer ${await this.signIn()}` },
      body: form,
    });
    const body = parseJson(await response.text()) as any;
    if (response.status >= 300) {
      throw new Error(`${this.email}: upload: ${response.status} ${JSON.stringify(body)}`);
    }
    return body?.data;
  }

  /** A GET that doesn't throw on an error status, for a file's bytes, which aren't JSON. */
  async fetchAsset(id: string): Promise<number> {
    const response = await fetch(`${this.baseUrl}/assets/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${await this.signIn()}` },
    });
    await response.arrayBuffer();
    return response.status;
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
  const sent = typeof body === "object" && body !== null && "id" in body ? (body as { id: unknown }) : undefined;
  const attempt = () =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  // Dev's small Directus sheds load with a 503 ("Under pressure"), and the Gateway answers a slow or
  // restarting Directus with a 502 or 504, or a text body such as "upstream request timeout".
  for (let retry = 0; ; retry++) {
    const response = await attempt();
    const text = await response.text();
    const body = parseJson(text);
    const gatewayError = [502, 503, 504].includes(response.status) || (text !== "" && body === undefined);
    if (!gatewayError) {
      if (retry > 0 && method === "POST" && duplicateOfSentId(body, sent)) {
        // The Gateway timed out on a create that Directus still made, so this retry found the row.
        return send(baseUrl, token, "GET", `${path}/${encodeURIComponent(String(sent!.id))}`);
      }
      return { status: response.status, body };
    }
    if (retry === 3) {
      throw new Error(`${method} ${path}: ${response.status} ${text}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000 * 2 ** retry));
  }
}

/** Whether Directus refused a create because a row already has the id the create sent. */
function duplicateOfSentId(body: any, sent: { id: unknown } | undefined): boolean {
  const extensions = body?.errors?.[0]?.extensions;
  return (
    sent !== undefined &&
    extensions?.code === "RECORD_NOT_UNIQUE" &&
    extensions.field === "id" &&
    extensions.value === String(sent.id)
  );
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
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

/**
 * Whether dev's Directus runs with a license, from the backend stack's dev config. Without one,
 * Directus applies no relational permission rules, so `@licensed` features can't pass
 * (cyc-seattle/isthmia#172).
 */
export function devDirectusLicensed(): boolean {
  const config = readFileSync(join(import.meta.dirname, "../../stacks/backend/Pulumi.dev.yaml"), "utf8");
  return !/^\s*backend:licensed:\s*false\s*$/m.test(config);
}
