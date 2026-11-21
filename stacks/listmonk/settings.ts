// A pure builder for what Listmonk keeps in its own tables and this project owns: its settings, the
// two staff roles, and the newsletter list. Testable without Pulumi.
//
// Listmonk reads its settings only from its `settings` table, which the database wins over any env var,
// so a start-up step writes them there (./index.ts). Anything left out, such as templates and the look of
// its public pages, stays where staff change it, in Listmonk.

export interface SmtpServer {
  host: string;
  port: number;
  /** `none` only for dev's Mailpit, which speaks plain SMTP inside the namespace. */
  tls: "STARTTLS" | "none";
  username: string;
  password: string;
}

export type Media =
  | { provider: "filesystem" }
  /** Cloud Storage, through its S3-compatible API, which takes an HMAC key. */
  | { provider: "s3"; bucket: string; accessKeyId: string; secretAccessKey: string };

export interface ListmonkSettingsArgs {
  /** Listmonk's own address, such as `https://mail.cyccommunitysailing.org`. */
  rootUrl: string;
  /** The newsletter's From, such as `CYC Community Sailing Center <info@cyccommunitysailing.org>`. */
  fromEmail: string;
  smtp: SmtpServer;
  /** Authentik's issuer for Listmonk's client. */
  oidcIssuer: string;
  oidcClientId: string;
  oidcClientSecret: string;
  /** Where the signup form may send a visitor back to, matched exactly. */
  trustedUrls: string[];
  media: Media;
  /** Take bounces and complaints from SES through SNS. Prod only. */
  sesBounces: boolean;
}

const WRITE = [
  "lists:get_all",
  "subscribers:get",
  "subscribers:get_all",
  "subscribers:manage",
  "subscribers:import",
  "campaigns:get",
  "campaigns:get_all",
  "campaigns:get_analytics",
  "campaigns:manage",
  "campaigns:manage_all",
  "bounces:get",
  "bounces:manage",
  "media:get",
  "media:manage",
  "templates:get",
  "templates:manage",
];

/** The roles staff get, named for the policies that give them (docs/newsletter.md). */
export const ROLES = {
  Write: WRITE,
  // Changing a campaign's status is what starts a send.
  Send: [...WRITE, "campaigns:send"],
};

/** An API login, with a role of its own that gives it only what it needs. */
export interface ApiLogin {
  username: string;
  role: string;
  permissions: string[];
}

/**
 * The API login access-334's sync uses to give each account the role its policies give
 * (cyc-seattle/platform#334). It may read and change accounts, and read roles, nothing else.
 */
export const ACCESS_SYNC: ApiLogin = {
  username: "access-sync",
  role: "Access sync",
  permissions: ["users:get", "users:manage", "roles:get"],
};

/** Dev's integration tests, which read whether a signup is on the list. Dev only. */
export const TESTS: ApiLogin = {
  username: "integration-tests",
  role: "Integration tests",
  permissions: ["subscribers:get_all", "lists:get_all"],
};

/** The role a sign-in creates an account with. Listmonk can't read a role from the sign-in. */
export const DEFAULT_ROLE = "Write";

export const LIST_NAME = "CSC Newsletter";

/** Each setting this project owns, by Listmonk's key. */
export function listmonkSettings(args: ListmonkSettingsArgs): Record<string, unknown> {
  const media: Record<string, unknown> =
    args.media.provider === "filesystem"
      ? { "upload.provider": "filesystem" }
      : {
          "upload.provider": "s3",
          "upload.s3.url": "https://storage.googleapis.com",
          "upload.s3.public_url": `https://storage.googleapis.com/${args.media.bucket}`,
          "upload.s3.aws_access_key_id": args.media.accessKeyId,
          "upload.s3.aws_secret_access_key": args.media.secretAccessKey,
          // Cloud Storage takes any region name through its S3 API.
          "upload.s3.aws_default_region": "auto",
          "upload.s3.bucket": args.media.bucket,
          "upload.s3.bucket_path": "/",
          // Public: a newsletter's pictures must load for everyone who opens it.
          "upload.s3.bucket_type": "public",
        };
  return {
    "app.site_name": "CSC Newsletter",
    "app.root_url": args.rootUrl,
    "app.from_email": args.fromEmail,
    // The website's signup form posts to it (cyc-seattle/csc-website#9).
    "app.enable_public_subscription_page": true,
    "app.send_optin_confirmation": true,
    "app.check_updates": false,
    "privacy.unsubscribe_header": true,
    // The confirmation is the record of consent, so keep where it came from.
    "privacy.record_optin_ip": true,
    "privacy.individual_tracking": false,
    "security.trusted_urls": args.trustedUrls,
    "security.oidc": {
      enabled: true,
      provider_url: args.oidcIssuer,
      provider_name: "CYC sign-in",
      client_id: args.oidcClientId,
      client_secret: args.oidcClientSecret,
      auto_create_users: true,
      // Filled in by the SQL with the role's ID, which only the database knows.
      default_user_role_id: null,
      default_list_role_id: null,
    },
    smtp: [
      {
        enabled: true,
        host: args.smtp.host,
        port: args.smtp.port,
        auth_protocol: args.smtp.tls === "none" ? "none" : "login",
        username: args.smtp.username,
        password: args.smtp.password,
        hello_hostname: "",
        max_conns: 10,
        idle_timeout: "15s",
        wait_timeout: "5s",
        max_msg_retries: 2,
        msg_retry_delay: "10ms",
        tls_type: args.smtp.tls,
        tls_skip_verify: false,
        email_headers: [],
        from_addresses: [],
      },
    ],
    "bounce.enabled": args.sesBounces,
    "bounce.webhooks_enabled": args.sesBounces,
    "bounce.ses_enabled": args.sesBounces,
    "bounce.actions": {
      soft: { count: 2, action: "none" },
      hard: { count: 1, action: "blocklist" },
      complaint: { count: 1, action: "blocklist" },
    },
    ...media,
  };
}

/** `value` as a dollar-quoted SQL string, so a password needs no escaping. */
function literal(value: string): string {
  const tag = "$cyc$";
  if (value.includes(tag)) {
    throw new Error(`listmonk: a setting holds ${tag}, which can't be quoted.`);
  }
  return `${tag}${value}${tag}`;
}

/**
 * The SQL that writes `settings`, the roles, and the list, safe to run at every start. The list keeps
 * any name staff give it; its ID is what the website's form posts.
 */
export function settingsSql(
  settings: Record<string, unknown>,
  listUuid: string,
  logins: { login: ApiLogin; tokenHash: string }[],
): string {
  if (!/^[0-9a-f-]{36}$/.test(listUuid)) {
    throw new Error(`listmonk: "${listUuid}" isn't a UUID.`);
  }
  for (const { login, tokenHash } of logins) {
    if (!/^[0-9a-f]{64}$/.test(tokenHash)) {
      throw new Error(`listmonk: ${login.username}'s token hash isn't a SHA-256 hex digest.`);
    }
  }
  const roleList: [string, string[]][] = [
    ...Object.entries(ROLES),
    ...logins.map(({ login }): [string, string[]] => [login.role, login.permissions]),
  ];
  const roles = roleList.map(
    ([name, permissions]) =>
      `INSERT INTO roles (type, name, permissions) VALUES ('user', ${literal(name)}, ARRAY[${permissions
        .map(literal)
        .join(", ")}]::text[])\n` +
      `  ON CONFLICT (type, name) WHERE name IS NOT NULL DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = NOW();`,
  );
  const values = Object.entries(settings).map(
    ([key, value]) =>
      `INSERT INTO settings (key, value) VALUES (${literal(key)}, ${literal(JSON.stringify(value))}::jsonb)\n` +
      `  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`,
  );
  return [
    "BEGIN;",
    ...roles,
    `INSERT INTO lists (uuid, name, type, optin) VALUES ('${listUuid}', ${literal(LIST_NAME)}, 'public', 'double')`,
    "  ON CONFLICT (uuid) DO UPDATE SET type = 'public', optin = 'double', updated_at = NOW();",
    // Listmonk keeps an API login's token as its SHA-256, and reads the logins at start.
    ...logins.flatMap(({ login, tokenHash }) => [
      "INSERT INTO users (username, password_login, password, email, name, type, user_role_id, status)",
      `  VALUES (${literal(login.username)}, false, '${tokenHash}', ${literal(`${login.username}@listmonk.invalid`)}, ` +
        `${literal(login.role)}, 'api', (SELECT id FROM roles WHERE type = 'user' AND name = ${literal(login.role)}), 'enabled')`,
      "  ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, user_role_id = EXCLUDED.user_role_id, status = 'enabled', updated_at = NOW();",
    ]),
    ...values,
    "UPDATE settings SET value = jsonb_set(value, '{default_user_role_id}', to_jsonb(" +
      `(SELECT id FROM roles WHERE type = 'user' AND name = ${literal(DEFAULT_ROLE)})))`,
    "  WHERE key = 'security.oidc';",
    "COMMIT;",
    "",
  ].join("\n");
}
