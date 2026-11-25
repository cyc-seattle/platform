// The CI stack: Directus, its database, Mailpit, the Clubspot and Workspace fakes, Authentik and Listmonk
// in containers on the runner, with the same images, env, extensions and migrations as dev, and
// `backend`'s and `authentik`'s config applied through a local Pulumi backend. The integration tests run
// against it (docs/testing.md).
//
//   node scripts/ci-stack/index.ts key    prints the cache key: a hash of everything the config comes from
//   node scripts/ci-stack/index.ts up     starts the stack and writes $CI_STACK_DIR/target.json
//   node scripts/ci-stack/index.ts logs   prints the last of each service's log
//   node scripts/ci-stack/index.ts down   stops it
//
// The configured databases are cached in $CI_STACK_CACHE, since applying the config takes minutes and
// restoring it seconds. The cache never holds the license: Actions shares main's caches with every PR.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import type { CiStackTarget } from "../../src/ci-stack.ts";
import { discoverSchemaFiles } from "../../src/directus/client.ts";
import { authentikEnv, authentikImage } from "../../stacks/authentik/workloads.ts";
import { extensionDirs, migrationFiles } from "../../stacks/backend/directus-files.ts";
import { backendPolicies } from "../../stacks/backend/extensions.ts";
import { clubspotFakeImage, directusImage, workspaceFakeImage } from "../../stacks/backend/images.ts";
import { directusEnv, mailEnv } from "../../stacks/backend/workloads.ts";
import { ACCESS_SYNC, listmonkImage, listmonkSettings, settingsSql, TESTS } from "../../stacks/listmonk/settings.ts";

const root = path.resolve(import.meta.dirname, "../..");
const dir = path.resolve(process.env["CI_STACK_DIR"] ?? path.join(root, ".ci-stack"));
const cache = path.resolve(process.env["CI_STACK_CACHE"] ?? path.join(root, ".ci-stack-cache"));

// Named and numbered for the checkout, so another checkout's stack on the same machine never collides.
const checkout = createHash("sha256").update(root).digest("hex").slice(0, 8);
const basePort = Number(process.env["CI_STACK_PORT"] ?? 10_000 + (parseInt(checkout, 16) % 2000) * 10);
const ports = {
  directus: basePort,
  clubspotFake: basePort + 1,
  workspaceFake: basePort + 2,
  mailpit: basePort + 3,
  authentik: basePort + 4,
  listmonk: basePort + 5,
};
const compose = ["compose", "-p", `ci-stack-${checkout}`, "-f", path.join(import.meta.dirname, "compose.yaml")];
const local = (port: number) => `http://localhost:${port}`;

const directusUrl = local(ports.directus);
const authentikUrl = local(ports.authentik);
const listmonkUrl = local(ports.listmonk);
// Directus reaches Authentik at the browser's address too, through ./compose.yaml's authentik-proxy, so the
// issuer it discovers is the one a browser signs in at.
const directusIssuer = `${authentikUrl}/application/o/directus/`;
// Where an app served on localhost may ask Directus's sign-in to send it back. Directus matches each exactly,
// path and all, so the app names its own.
const redirects = (process.env["CI_STACK_REDIRECTS"] ?? "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

function stackConfig(project: string): Record<string, unknown> {
  const file = path.join(import.meta.dirname, `Pulumi.${project}.yaml`);
  return (yaml.load(fs.readFileSync(file, "utf8")) as { config: Record<string, unknown> }).config;
}
const backendConfig = stackConfig("backend");
const get = <T>(key: string) => backendConfig[`backend:${key}`] as T;
const authentikBootstrapToken = stackConfig("authentik")["authentik:localBootstrapToken"] as string;
const siblings = stackConfig("authentik")["authentik:localSiblings"] as Record<string, string>;

// The newsletter list's ID, as dev's (stacks/listmonk/Pulumi.dev.yaml). Public: the website's form posts it.
const listId = "6053a494-582f-4f05-a19a-f84a21b8a012";
const listmonkTokens = {
  [ACCESS_SYNC.username]: "ci-listmonk-access-sync-token",
  [TESTS.username]: "ci-listmonk-tests-token",
};

/** What the cached databases depend on. */
function cacheKey(): string {
  const hash = createHash("sha256").update(directusImage);
  const walk = (entry: string) => {
    const full = path.join(root, entry);
    if (fs.statSync(full).isDirectory()) {
      for (const child of fs.readdirSync(full).sort()) walk(path.join(entry, child));
    } else {
      hash.update(entry).update(fs.readFileSync(full));
    }
  };
  for (const entry of [
    "schemas",
    "stacks/backend",
    "stacks/authentik",
    "src/directus",
    "src/app",
    "scripts/ci-stack",
    "scripts/wait-for-authentik",
    "pnpm-lock.yaml",
  ]) {
    walk(entry);
  }
  return `ci-stack-${hash.digest("hex").slice(0, 32)}`;
}

const run = (
  cmd: string,
  args: string[],
  options: { env?: Record<string, string>; cwd?: string; input?: Buffer } = {},
) =>
  execFileSync(cmd, args, {
    cwd: options.cwd ?? root,
    stdio: [options.input ? "pipe" : "inherit", "inherit", "inherit"],
    ...(options.input && { input: options.input }),
    env: { ...process.env, ...options.env },
  });
const output = (cmd: string, args: string[], env: Record<string, string> = {}, cwd = root) =>
  execFileSync(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"] });

/** Runs a command beside others, failing if it does. */
const runAsync = (cmd: string, args: string[], options: { env: Record<string, string>; cwd: string }) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: options.cwd, stdio: "inherit", env: { ...process.env, ...options.env } });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`))));
  });

function envFile(name: string, env: Record<string, string>): void {
  fs.writeFileSync(
    path.join(dir, name),
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
}

function writeFiles(licenseKey: string): void {
  const schemas = discoverSchemaFiles(path.join(root, "schemas")).map(({ name, path: file }) => ({
    name,
    schema: yaml.load(fs.readFileSync(file, "utf8")),
  }));
  const { extensions } = backendPolicies(schemas, {
    contactTo: get("contactTo"),
    formsOrigins: get("formsOrigins"),
    externalDomain: get("externalDomain"),
    formsPerIp: get("formsPerIp"),
    formsHostname: get("formsHostname"),
    websitePublishAppId: undefined,
    frozenPlansDeletable: get("frozenPlansDeletable"),
  });
  fs.rmSync(dir, { recursive: true, force: true });
  for (const { name, files } of extensionDirs(extensions)) {
    fs.mkdirSync(path.join(dir, "extensions", name), { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, "extensions", name, file), content);
    }
  }
  fs.mkdirSync(path.join(dir, "migrations"), { recursive: true });
  for (const [file, content] of Object.entries(migrationFiles())) {
    fs.writeFileSync(path.join(dir, "migrations", file), content);
  }
  fs.mkdirSync(path.join(dir, "authentik-access"));

  const env: Record<string, string> = {};
  for (const { name, value } of [
    ...directusEnv({
      domain: "localhost",
      adminEmail: get("directusAdminEmail"),
      dbHost: "postgres",
      communityRoleId: get("communityRoleId"),
      oidcClientId: siblings["backend.directusOidcClientId"]!,
      poolMax: 10,
      filesBucket: "none",
    }),
    ...mailEnv(true),
  ]) {
    env[name as string] = value as string;
  }
  for (const key of Object.keys(env).filter((key) => key.startsWith("STORAGE_GCS_"))) {
    delete env[key];
  }
  Object.assign(env, {
    PUBLIC_URL: directusUrl,
    DB_PASSWORD: "directus",
    KEY: "ci-key",
    SECRET: "ci-secret",
    ADMIN_PASSWORD: get<string>("localAdminPassword"),
    AUTH_AUTHENTIK_CLIENT_SECRET: siblings["backend.directusOidcClientSecret"]!,
    AUTH_AUTHENTIK_ISSUER_URL: directusIssuer,
    // Directus starts before a cold cache's Authentik has its Directus application, and finds it at the first sign-in.
    AUTH_AUTHENTIK_ISSUER_DISCOVERY_MUST_SUCCEED: "false",
    AUTH_AUTHENTIK_REDIRECT_ALLOW_LIST: [directusUrl, ...redirects].join(","),
    // An app on any localhost port, the stack being throwaway and local.
    CORS_ORIGIN: "true",
    STORAGE_LOCATIONS: "local",
    STORAGE_LOCAL_ROOT: "/directus/uploads",
    LOG_LEVEL: "warn",
    LICENSE_KEY: licenseKey,
  });
  envFile("directus.env", env);

  envFile("authentik.env", {
    ...Object.fromEntries(
      authentikEnv({
        dbHost: "postgres",
        dbPassword: { name: "AUTHENTIK_POSTGRESQL__PASSWORD", value: "authentik" },
        smtp: { host: "mailpit", port: 1025, useTls: false },
        connMaxAge: 0,
      }).map(({ name, value }) => [name, value as string]),
    ),
    AUTHENTIK_SECRET_KEY: "ci-authentik-secret-key",
    AUTHENTIK_BOOTSTRAP_TOKEN: authentikBootstrapToken,
    AUTHENTIK_BOOTSTRAP_PASSWORD: "ci-authentik-password",
    AUTHENTIK_LOG_LEVEL: "warning",
  });

  envFile("listmonk.env", {
    LISTMONK_app__address: "0.0.0.0:9000",
    LISTMONK_db__host: "postgres",
    LISTMONK_db__port: "5432",
    LISTMONK_db__database: "listmonk",
    LISTMONK_db__user: "listmonk",
    LISTMONK_db__password: "listmonk",
    LISTMONK_db__ssl_mode: "disable",
    LISTMONK_db__max_open: "10",
    LISTMONK_db__max_idle: "2",
    LISTMONK_ADMIN_USER: "admin",
    LISTMONK_ADMIN_PASSWORD: "ci-listmonk-admin-password",
  });
  const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
  fs.mkdirSync(path.join(dir, "listmonk"));
  fs.writeFileSync(
    path.join(dir, "listmonk", "settings.sql"),
    settingsSql(
      listmonkSettings({
        rootUrl: listmonkUrl,
        fromEmail: "CSC Newsletter CI <noreply@cyccommunitysailing.org>",
        smtp: { host: "mailpit", port: 1025, tls: "none", username: "", password: "" },
        oidcIssuer: "http://authentik-server:9000/application/o/listmonk/",
        oidcClientId: siblings["listmonk.oidcClientId"]!,
        oidcClientSecret: siblings["listmonk.oidcClientSecret"]!,
        trustedUrls: ["https://cyccommunitysailing.org/newsletter/check-your-email"],
        media: { provider: "filesystem" },
        sesBounces: false,
      }),
      listId,
      [ACCESS_SYNC, TESTS].map((login) => ({ login, tokenHash: sha256(listmonkTokens[login.username]!) })),
    ),
  );
}

const composeEnv = () => ({
  CI_STACK_DIR: dir,
  DIRECTUS_IMAGE: directusImage,
  CLUBSPOT_FAKE_IMAGE: clubspotFakeImage,
  WORKSPACE_FAKE_IMAGE: workspaceFakeImage,
  AUTHENTIK_IMAGE: authentikImage,
  LISTMONK_IMAGE: listmonkImage,
  DIRECTUS_PORT: String(ports.directus),
  CLUBSPOT_FAKE_PORT: String(ports.clubspotFake),
  WORKSPACE_FAKE_PORT: String(ports.workspaceFake),
  MAILPIT_PORT: String(ports.mailpit),
  AUTHENTIK_PORT: String(ports.authentik),
  LISTMONK_PORT: String(ports.listmonk),
});
const psqlArgs = (database: string) => [
  ...compose,
  "exec",
  "-T",
  "postgres",
  "psql",
  "-q",
  "-v",
  "ON_ERROR_STOP=1",
  "-U",
  database,
  "-d",
  database,
];
const psql = (sql: string) => run("docker", [...psqlArgs("directus"), "-c", sql], { env: composeEnv() });

/** The databases the cache holds, each restored as its own user, so the app still owns its tables. */
const cachedDatabases = ["directus", "authentik"];

/**
 * Applies a project's config with a stack whose state lives only in this run. Pulumi rewrites a
 * stack's config file, so it gets a copy, with `overrides` in place of the file's values.
 */
async function applyConfig(project: string, overrides: Record<string, unknown>): Promise<void> {
  const env = {
    PULUMI_BACKEND_URL: `file://${path.join(dir, "pulumi")}`,
    PULUMI_CONFIG_PASSPHRASE: "ci",
    PULUMI_SKIP_UPDATE_CHECK: "true",
  };
  const cwd = path.join(root, "stacks", project);
  const stack = ["--stack", `organization/${project}/ci`];
  const copy = path.join(cwd, "Pulumi.ci.yaml");
  fs.mkdirSync(path.join(dir, "pulumi"), { recursive: true });
  fs.writeFileSync(copy, yaml.dump({ config: { ...stackConfig(project), ...overrides } }));
  try {
    run("pulumi", ["stack", "select", "--create", ...stack, "--secrets-provider", "passphrase"], { env, cwd });
    await runAsync("pulumi", ["up", "--yes", "--skip-preview", "--suppress-progress", "--parallel", "32", ...stack], {
      env,
      cwd,
    });
  } finally {
    fs.rmSync(copy, { force: true });
  }
}

function stackOutput<T>(project: string, name: string): T {
  const env = { PULUMI_BACKEND_URL: `file://${path.join(dir, "pulumi")}`, PULUMI_CONFIG_PASSPHRASE: "ci" };
  const args = ["stack", "output", name, "--show-secrets", "--json", "--stack", `organization/${project}/ci`];
  return JSON.parse(output("pulumi", args, env, path.join(root, "stacks", project)).toString()) as T;
}

/** What the group-policies hook reaches Authentik with, from inside the stack's network. */
function writeAuthentikAccess(token: string): void {
  fs.writeFileSync(path.join(dir, "authentik-access", "url"), "http://authentik-server:9000");
  fs.writeFileSync(path.join(dir, "authentik-access", "token"), token, { mode: 0o644 });
}

/**
 * Starts whatever isn't running. Directus exits if the license service refuses its activation, as it does
 * for a moment when several runs activate at once ("Activation in progress"), so it gets a few tries.
 */
function startAll(): void {
  for (let attempt = 1; ; attempt++) {
    try {
      run("docker", [...compose, "up", "-d", "--wait"], { env: composeEnv() });
      return;
    } catch (error) {
      if (attempt === 5) throw error;
      console.log(`The stack didn't start (attempt ${attempt}), so it tries again.`);
      execFileSync("sleep", [String(10 * attempt)]);
    }
  }
}

// The built-in admin's static token, for another repo's tests that call Directus as its admin.
const adminToken = "ci-admin-token";
const setAdminToken = () =>
  psql(`UPDATE directus_users SET token = '${adminToken}' WHERE email = '${get<string>("directusAdminEmail")}'`);

interface Tokens {
  clubspot: string;
  gsuite: string;
  /** The group-policies hook's Authentik token. */
  authentikAccess: string;
}

async function up(): Promise<void> {
  // A Directus made from scratch activates the license as pending, which never counts if the instance
  // is gone within 24 hours (docs/backend.md). Unlicensed, Directus's Core tier refuses the schema.
  const licenseKey = process.env["DIRECTUS_LICENSE_KEY"];
  if (!licenseKey) {
    throw new Error("Set DIRECTUS_LICENSE_KEY: unlicensed Directus allows only 25 collections.");
  }
  const started = Date.now();
  const elapsed = () => `${Math.round((Date.now() - started) / 1000)} s`;
  writeFiles(licenseKey);
  run("docker", [...compose, "up", "-d", "--wait", "postgres"], { env: composeEnv() });

  const key = cacheKey();
  const dump = (database: string) => path.join(cache, `${key}-${database}.sql`);
  const tokensFile = path.join(cache, `${key}.json`);
  let tokens: Tokens;
  if ([...cachedDatabases.map(dump), tokensFile].every((file) => fs.existsSync(file))) {
    for (const database of cachedDatabases) {
      run("docker", psqlArgs(database), { env: composeEnv(), input: fs.readFileSync(dump(database)) });
    }
    // A project of its own, so each run's activation is its own pending one.
    psql("UPDATE directus_settings SET project_id = gen_random_uuid(), license_key = NULL, license_token = NULL");
    // Authentik matches its sign-in Brand on host and port, and the cache may come from another checkout's port.
    run(
      "docker",
      [
        ...psqlArgs("authentik"),
        "-c",
        `UPDATE authentik_brands_brand SET domain = '${new URL(authentikUrl).host}' WHERE domain LIKE 'localhost:%'`,
      ],
      { env: composeEnv() },
    );
    tokens = JSON.parse(fs.readFileSync(tokensFile, "utf8"));
    writeAuthentikAccess(tokens.authentikAccess);
    setAdminToken();
    startAll();
    console.log(`Restored ${key} and started the stack in ${elapsed()}.`);
  } else {
    startAll();
    console.log(`Started the stack in ${elapsed()}. Applying the config, which ${key} hasn't cached.`);
    // Both finish before either's failure ends the run, so neither is left applying.
    const applied = await Promise.allSettled([
      applyConfig("backend", { "backend:localUrl": directusUrl }),
      applyConfig("authentik", { "authentik:localUrl": authentikUrl }),
    ]);
    const failed = applied.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    tokens = {
      ...stackOutput<{ clubspot: string; gsuite: string }>("backend", "syncTokens"),
      authentikAccess: stackOutput<string>("authentik", "localAccessToken"),
    };
    writeAuthentikAccess(tokens.authentikAccess);
    console.log(`Applied the config in ${elapsed()}.`);
    // Stopped, so nothing writes while it's dumped, and Directus doesn't write the license back. The proxy goes
    // too: it lives in Directus's network namespace, which a restart replaces.
    run("docker", [...compose, "stop", "authentik-proxy", "directus", "authentik-server", "authentik-worker"], {
      env: composeEnv(),
    });
    psql("UPDATE directus_settings SET license_key = NULL, license_token = NULL");
    fs.mkdirSync(cache, { recursive: true });
    for (const database of cachedDatabases) {
      // Straight to the file: Authentik's dump is past execFileSync's buffer.
      const file = fs.openSync(dump(database), "w");
      try {
        execFileSync(
          "docker",
          [...compose, "exec", "-T", "postgres", "pg_dump", "-U", "directus", "-d", database, "--no-owner", "--no-acl"],
          { cwd: root, env: { ...process.env, ...composeEnv() }, stdio: ["ignore", file, "inherit"] },
        );
      } finally {
        fs.closeSync(file);
      }
    }
    fs.writeFileSync(tokensFile, JSON.stringify(tokens));
    setAdminToken();
    startAll();
    console.log(`Cached the configured databases and restarted the stack in ${elapsed()}.`);
  }

  // What the tests reach, in place of dev's (test/features/target.ts).
  const target: CiStackTarget = {
    directus: {
      url: directusUrl,
      adminEmail: get<string>("directusAdminEmail"),
      adminPassword: get<string>("localAdminPassword"),
      adminToken,
      communityRoleId: get<string>("communityRoleId"),
      signInProvider: "authentik",
      redirects,
    },
    formsUrl: directusUrl,
    services: {
      "mailpit:8025": local(ports.mailpit),
      "clubspot-fake:1337": local(ports.clubspotFake),
      "workspace-fake:8080": local(ports.workspaceFake),
    },
    authentik: { url: authentikUrl, token: authentikBootstrapToken, directusIssuer },
    listmonk: {
      url: listmonkUrl,
      listId,
      apiUser: TESTS.username,
      apiToken: listmonkTokens[TESTS.username]!,
    },
    cronJobs: {
      "clubspot-sync": {
        DIRECTUS_TOKEN: tokens.clubspot,
        CLUBSPOT_SERVER_URL: "http://clubspot-fake:1337/parse",
        CLUBSPOT_CLUB_ID: "seedClub01",
        // The fake's seed (cyc-seattle/clubspot-sdk's README), for tests only.
        CLUBSPOT_EMAIL: "dockmaster@example.test",
        CLUBSPOT_PASSWORD: "fake-password",
      },
      "gsuite-sync": {
        DIRECTUS_TOKEN: tokens.gsuite,
        GSUITE_ROOT_URL: "http://workspace-fake:8080",
        GSUITE_SYNC_GROUP_OWNERS: "owner@example.test",
        GSUITE_SYNC_CUSTOMER: "C00000000",
      },
    },
  };
  fs.writeFileSync(path.join(dir, "target.json"), JSON.stringify(target, null, 2));
  console.log(`The CI stack is ready in ${elapsed()}: ${path.join(dir, "target.json")}`);
}

const command = process.argv[2];
if (command === "key") {
  console.log(cacheKey());
} else if (command === "up") {
  await up();
} else if (command === "logs") {
  run("docker", [...compose, "logs", "--tail", "200", "--no-color"], { env: composeEnv() });
} else if (command === "down") {
  run("docker", [...compose, "down", "-v", "--remove-orphans"], { env: composeEnv() });
} else {
  throw new Error("Usage: node scripts/ci-stack/index.ts key|up|logs|down");
}
