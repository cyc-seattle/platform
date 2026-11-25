import { localTarget } from "./target.ts";

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

  /** Given a static `token`, the session uses it and never signs in with the password. */
  constructor(baseUrl: string, email: string, password: string, token?: string) {
    this.baseUrl = baseUrl;
    this.email = email;
    this.password = password;
    if (token !== undefined) {
      this.token = Promise.resolve(token);
    }
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

  /** A new session for the same user, who signs in again with the password. */
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
    // Directus sheds load with a 503 before it reads the upload, so a retry can't make a second file.
    for (let retry = 0; ; retry++) {
      const response = await fetch(`${this.baseUrl}/files`, {
        method: "POST",
        headers: { authorization: `Bearer ${await this.signIn()}` },
        body: form,
      });
      const body = parseJson(await response.text()) as any;
      if (response.status === 503 && retry < RETRIES) {
        await backOff(retry);
        continue;
      }
      if (response.status >= 300) {
        throw new Error(`${this.email}: upload: ${response.status} ${JSON.stringify(body)}`);
      }
      return body?.data;
    }
  }

  /** A GET that doesn't throw on an error status, for a file's bytes, which aren't JSON. */
  async fetchAsset(id: string): Promise<number> {
    for (let retry = 0; ; retry++) {
      const response = await fetch(`${this.baseUrl}/assets/${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${await this.signIn()}` },
      });
      await response.arrayBuffer();
      if (response.status !== 503 || retry === RETRIES) {
        return response.status;
      }
      await backOff(retry);
    }
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

const RETRIES = 3;
const backOff = (retry: number) => new Promise((resolve) => setTimeout(resolve, 5_000 * 2 ** retry));

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
  // Directus sheds load with a 503 ("Under pressure"). A 502, a 504, or a text body such as "upstream
  // request timeout" is a proxy's answer for a slow or restarting Directus.
  for (let retry = 0; ; retry++) {
    const response = await attempt();
    const text = await response.text();
    const body = parseJson(text);
    const gatewayError = [502, 503, 504].includes(response.status) || (text !== "" && body === undefined);
    if (!gatewayError) {
      if (retry > 0 && method === "POST" && duplicateOfSentId(body, sent)) {
        // A create timed out that Directus still made, so this retry found the row.
        return send(baseUrl, token, "GET", `${path}/${encodeURIComponent(String(sent!.id))}`);
      }
      return { status: response.status, body };
    }
    if (retry === RETRIES) {
      throw new Error(`${method} ${path}: ${response.status} ${text}`);
    }
    await backOff(retry);
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

/** Signs in to the CI stack's Directus as its built-in admin. */
export function directusAdmin(): Promise<DirectusSession> {
  const { url, adminEmail, adminPassword } = localTarget().directus;
  return Promise.resolve(new DirectusSession(url, adminEmail, adminPassword));
}
