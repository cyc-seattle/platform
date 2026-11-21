import { describe, expect, it } from "vitest";
import {
  ACCESS_SYNC,
  listmonkSettings,
  ROLES,
  settingsSql,
  type ListmonkSettingsArgs,
} from "../stacks/listmonk/settings.ts";

const args: ListmonkSettingsArgs = {
  rootUrl: "https://mail.example.org",
  fromEmail: "Example <news@example.org>",
  smtp: { host: "email-smtp.us-west-2.amazonaws.com", port: 587, tls: "STARTTLS", username: "AKIA", password: "p" },
  oidcIssuer: "https://login.example.team/application/o/listmonk/",
  oidcClientId: "client",
  oidcClientSecret: "secret",
  trustedUrls: ["https://example.org/newsletter/check-your-email"],
  media: { provider: "s3", bucket: "media-prod", accessKeyId: "GOOG1", secretAccessKey: "hmac" },
  sesBounces: true,
};
const uuid = "3f1c2b6e-8d4a-4f7e-9a51-0c2d3e4f5a6b";
const hash = "a".repeat(64);

describe("Listmonk's settings", () => {
  it("signs staff in through Authentik, making an account with the Write role", () => {
    expect(listmonkSettings(args)["security.oidc"]).toMatchObject({
      enabled: true,
      provider_url: args.oidcIssuer,
      client_id: "client",
      client_secret: "secret",
      auto_create_users: true,
    });
    expect(settingsSql(listmonkSettings(args), uuid, hash)).toContain(
      "jsonb_set(value, '{default_user_role_id}', to_jsonb((SELECT id FROM roles WHERE type = 'user' AND name = $cyc$Write$cyc$)))",
    );
  });

  it("lets only Send start a send", () => {
    expect(ROLES.Write).not.toContain("campaigns:send");
    expect(ROLES.Send).toEqual([...ROLES.Write, "campaigns:send"]);
    for (const permissions of Object.values(ROLES)) {
      expect(
        permissions.filter((p) => p.startsWith("settings:") || p.startsWith("users:") || p.startsWith("roles:")),
      ).toEqual([]);
      // It reads every subscriber's every field, past any list.
      expect(permissions).not.toContain("subscribers:sql_query");
    }
  });

  it("blocks an address after one hard bounce or complaint from SES", () => {
    const settings = listmonkSettings(args);
    expect(settings).toMatchObject({
      "bounce.enabled": true,
      "bounce.webhooks_enabled": true,
      "bounce.ses_enabled": true,
    });
    expect(settings["bounce.actions"]).toEqual({
      soft: { count: 2, action: "none" },
      hard: { count: 1, action: "blocklist" },
      complaint: { count: 1, action: "blocklist" },
    });
    expect(listmonkSettings({ ...args, sesBounces: false })["bounce.ses_enabled"]).toBe(false);
  });

  it("keeps the confirmation's record and adds the unsubscribe header", () => {
    expect(listmonkSettings(args)).toMatchObject({
      "app.send_optin_confirmation": true,
      "privacy.record_optin_ip": true,
      "privacy.unsubscribe_header": true,
      "security.trusted_urls": args.trustedUrls,
    });
  });

  it("puts pictures in the public bucket, or in the pod in dev", () => {
    expect(listmonkSettings(args)).toMatchObject({
      "upload.provider": "s3",
      "upload.s3.url": "https://storage.googleapis.com",
      "upload.s3.public_url": "https://storage.googleapis.com/media-prod",
      "upload.s3.bucket": "media-prod",
      "upload.s3.bucket_type": "public",
    });
    const dev = listmonkSettings({ ...args, media: { provider: "filesystem" } });
    expect(dev["upload.provider"]).toBe("filesystem");
    expect(dev).not.toHaveProperty("upload.s3.bucket");
  });

  it("sends through SMTP with STARTTLS, or plain to dev's Mailpit", () => {
    expect(listmonkSettings(args)["smtp"]).toEqual([
      expect.objectContaining({ host: args.smtp.host, port: 587, tls_type: "STARTTLS", auth_protocol: "login" }),
    ]);
    const dev = listmonkSettings({
      ...args,
      smtp: { host: "mailpit", port: 1025, tls: "none", username: "", password: "" },
    });
    expect(dev["smtp"]).toEqual([expect.objectContaining({ tls_type: "none", auth_protocol: "none" })]);
  });
});

describe("The access sync's login", () => {
  it("is an API login that may only read and change accounts, with the token's hash", () => {
    expect(ACCESS_SYNC.permissions).toEqual(["users:get", "users:manage", "roles:get"]);
    const sql = settingsSql({}, uuid, hash);
    expect(sql).toContain(`'access-sync'`.replace(/'/g, "$cyc$"));
    expect(sql).toContain(`false, '${hash}'`);
    expect(sql).toContain(
      "'api', (SELECT id FROM roles WHERE type = 'user' AND name = $cyc$Access sync$cyc$), 'enabled')",
    );
  });
});

describe("The settings SQL", () => {
  it("writes every setting, the roles, and a double opt-in public list, safely run again", () => {
    const sql = settingsSql({ "app.root_url": "https://mail.example.org" }, uuid, hash);
    expect(sql.startsWith("BEGIN;\n")).toBe(true);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(sql).toContain(
      'INSERT INTO settings (key, value) VALUES ($cyc$app.root_url$cyc$, $cyc$"https://mail.example.org"$cyc$::jsonb)\n' +
        "  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();",
    );
    expect(sql).toContain(
      `INSERT INTO lists (uuid, name, type, optin) VALUES ('${uuid}', $cyc$CSC Newsletter$cyc$, 'public', 'double')`,
    );
    expect(sql).toContain("ON CONFLICT (uuid) DO UPDATE SET type = 'public', optin = 'double'");
    expect(sql.match(/INSERT INTO roles/g)).toHaveLength(3);
  });

  it("quotes a value with a quote in it, and refuses one it can't quote", () => {
    expect(settingsSql({ smtp: [{ password: "it's" }] }, uuid, hash)).toContain(`$cyc$[{"password":"it's"}]$cyc$`);
    expect(() => settingsSql({ smtp: [{ password: "a$cyc$b" }] }, uuid, hash)).toThrow(/can't be quoted/);
    expect(() => settingsSql({}, "'; DROP TABLE lists; --", hash)).toThrow(/isn't a UUID/);
    expect(() => settingsSql({}, uuid, "token")).toThrow(/SHA-256/);
  });
});
